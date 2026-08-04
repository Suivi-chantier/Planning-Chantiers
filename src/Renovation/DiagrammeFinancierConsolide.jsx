// DiagrammeFinancierConsolide — onglet « Diagramme financier » de la page
// direction (Point 5, Prompt 5) : les 6 courbes cumulées à l'échelle de
// l'entreprise, somme mensuelle des chantiers.
//
// RÉUTILISE EXACTEMENT le module et le composant du diagramme par chantier :
// seriesReellesChantier + consoliderSeries (diagrammeFinancier.mjs) et
// DiagrammeFinancierChart — aucun calcul ni rendu dupliqué.
//
// RÈGLE : un chantier SANS référence figée n'entre pas dans les courbes de
// référence consolidées ; le bandeau indique explicitement inclus / exclus.
//
// Accès : ce composant vit dans DashboardAnalyse (admin-only via src/access.js)
// → verrouillage bureau hérité ; la table des références est de plus protégée
// par sa RLS bureau-only.
//
// Performance : tout est chargé en UNE passe (Promise.all + regroupement par
// chantier côté client, patron de DashboardAnalyse/loadPhasagesOperation),
// jamais un appel par chantier.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase";
import { computeChantierFinance } from "../chantierFinance";
import {
  seriesReellesChantier, consoliderSeries, fusionnerSeriesPourGraphe,
  rapprochementEtatsChantiers,
} from "./diagrammeFinancier";
import { loadReferencesFinancieres } from "./referenceFinanciere";
import { exporterDiagrammePDF } from "./diagrammeFinancierPdf";
import DiagrammeFinancierChart from "./DiagrammeFinancierChart";

const JOURS_ACTIVITE = 21; // même règle que le cron snapshot : pointage récent

export default function DiagrammeFinancierConsolide({ T, acc }) {
  const [etat, setEtat] = useState({ charge: false, entrees: [], erreurs: [], rapprochement: null });
  const [periode, setPeriode] = useState("12");   // "12" | "24" | "tout" (mois)
  const [actifsSeuls, setActifsSeuls] = useState(false);
  const [masques, setMasques] = useState({});     // masquage de séries via la légende
  const [voirExclus, setVoirExclus] = useState(false);
  const [voirOrphelines, setVoirOrphelines] = useState(false);
  const grapheRef = useRef(null);                 // conteneur du graphe (export PDF)

  useEffect(() => {
    let actif = true;
    (async () => {
      const erreurs = [];
      const [phRes, ptsRes, clRes, cfgRes] = await Promise.all([
        supabase.from("phasages").select("id, chantier_id, chantier_nom, ouvrages, plan_travaux, prix_vendu, updated_at"),
        supabase.from("pointages").select("*"),
        supabase.from("commande_lignes")
          .select("id, quantite, prix_unitaire, prix_total, materiau_id, ouvrage_id, chantier_id, created_at, commande:commandes(date_doc, created_at)"),
        supabase.from("planning_config").select("key,value").in("key", ["taux_horaires", "taux_mo_previsionnel", "etats_financiers"]),
      ]);
      [["phasages", phRes], ["pointages", ptsRes], ["lignes de commande", clRes], ["réglages", cfgRes]]
        .forEach(([nom, r]) => { if (r.error) erreurs.push(`${nom} : ${r.error.message}`); });

      // Un phasage par chantier : le plus récent (même règle que le cron).
      const parChantier = {};
      (phRes.data || []).forEach((ph) => {
        const cur = parChantier[ph.chantier_id];
        if (!cur || String(ph.updated_at || "") > String(cur.updated_at || "")) parChantier[ph.chantier_id] = ph;
      });
      const phasages = Object.values(parChantier).filter((ph) => (ph.ouvrages || []).length > 0);

      const cfg = Object.fromEntries((cfgRes.data || []).map((r) => [r.key, r.value]));
      const tauxHoraires = cfg.taux_horaires || {};
      const tauxMOPrev = parseFloat(cfg.taux_mo_previsionnel) || 0;
      const etatsFinanciers = cfg.etats_financiers || null;

      const ptsByChantier = {};
      (ptsRes.data || []).forEach((p) => { (ptsByChantier[p.chantier_id] ||= []).push(p); });
      const clByChantier = {};
      (clRes.data || []).forEach((l) => { (clByChantier[l.chantier_id] ||= []).push(l); });

      // Références figées courantes, en UNE requête (.in).
      const refsRes = await loadReferencesFinancieres(phasages.map((ph) => ph.chantier_id));
      if (refsRes.erreur) erreurs.push(`références figées : ${refsRes.erreur}`);

      const entrees = phasages.map((ph) => {
        const pointages = ptsByChantier[ph.chantier_id] || [];
        const commandeLignes = clByChantier[ph.chantier_id] || [];
        const finance = computeChantierFinance({ phasage: ph, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots: [] });
        const reelles = seriesReellesChantier({
          finance, pointages, commandeLignes, etatsFinanciers,
          chantierNom: ph.chantier_nom || ph.chantier_id,
        });
        return {
          chantierId: ph.chantier_id,
          nom: ph.chantier_nom || ph.chantier_id,
          reelles,
          reference: refsRes.parChantier[ph.chantier_id]?.series || null,
          avancement: finance.brut.avancementChantier,
          dernierPointage: finance.fraicheur?.dernierPointage || null,
        };
      });
      // Rapprochement global : lignes d'États financiers sans chantier
      // correspondant (noms à corriger) et chantiers sans ligne — c'est LE
      // risque de faux chiffres de la jointure par nom, rendu visible ici.
      const rapprochement = rapprochementEtatsChantiers(
        { avancement: etatsFinanciers?.avancement },
        phasages.map((ph) => ({ id: ph.chantier_id, nom: ph.chantier_nom || ph.chantier_id })),
      );
      if (actif) setEtat({ charge: true, entrees, erreurs, rapprochement });
    })();
    return () => { actif = false; };
  }, []);

  // Filtre « chantiers actifs » : pointage dans les 21 derniers jours OU
  // avancement strictement entre 1 et 99 (même règle que le cron snapshot).
  const entreesFiltrees = useMemo(() => {
    if (!actifsSeuls) return etat.entrees;
    const seuil = new Date(Date.now() - JOURS_ACTIVITE * 86400000).toISOString().slice(0, 10);
    return etat.entrees.filter((e) =>
      (e.dernierPointage && e.dernierPointage >= seuil) ||
      (e.avancement > 0 && e.avancement < 100));
  }, [etat.entrees, actifsSeuls]);

  const consolide = useMemo(() => consoliderSeries(entreesFiltrees), [entreesFiltrees]);

  const dataGraphe = useMemo(() => {
    const rows = fusionnerSeriesPourGraphe({ reelles: consolide.reelles, reference: consolide.reference });
    if (periode === "tout") return rows;
    const d = new Date(); d.setMonth(d.getMonth() - parseInt(periode, 10) + 1);
    const cutoff = d.toISOString().slice(0, 7);
    return rows.filter((r) => r.mois >= cutoff);
  }, [consolide, periode]);

  const stats = consolide.stats;
  const fmtListe = (liste) => liste.map((c) => c.nom).join(" · ");
  const pastille = (couleur, texte) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.textSub }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: couleur, display: "inline-block" }}/>{texte}
    </span>
  );
  const select = {
    padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`,
    background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: 12.5, outline: "none",
  };

  if (!etat.charge) {
    return <div style={{ color: T.textMuted, fontSize: 13, padding: 20 }}>Chargement du diagramme consolidé…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {etat.erreurs.length > 0 && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(225,90,90,.12)",
          border: "1px solid rgba(225,90,90,.4)", fontSize: 12.5, color: "#e15a5a", fontWeight: 600 }}>
          Sources en erreur (les chiffres ci-dessous sont incomplets) : {etat.erreurs.join(" — ")}
        </div>
      )}

      {/* Bandeau : périmètre + inclus/exclus de la référence + filtres */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 18px" }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>
          {entreesFiltrees.length} chantier{entreesFiltrees.length > 1 ? "s" : ""}
          {actifsSeuls ? " actifs" : ""} · courbes de référence : {stats.nbAvecReference} inclus / {stats.sansReference.length} exclus
        </div>
        {stats.sansReference.length > 0 && (
          <button onClick={() => setVoirExclus(v => !v)} style={{ ...select, cursor: "pointer", fontWeight: 700 }}>
            {voirExclus ? "Masquer les exclus" : "Voir les exclus"}
          </button>
        )}
        <div style={{ flex: 1 }}/>
        {dataGraphe.length > 0 && (
          <button title="Exporter le diagramme en PDF"
            style={{ ...select, cursor: "pointer", fontWeight: 700 }}
            onClick={() => exporterDiagrammePDF({
              titre: "Diagramme financier consolidé — tous chantiers",
              sousTitre: `${entreesFiltrees.length} chantier(s)${actifsSeuls ? " actifs" : ""} · référence : ${stats.nbAvecReference} inclus / ${stats.sansReference.length} exclus · ${periode === "tout" ? "tout l'historique" : `${periode} derniers mois`}`,
              conteneur: grapheRef.current,
              lignesInfos: stats.sansReference.length > 0
                ? [`Sans référence figée (hors courbes de référence) : ${fmtListe(stats.sansReference)}`] : [],
            })}>
            PDF
          </button>
        )}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
          <input type="checkbox" checked={actifsSeuls} onChange={(e) => setActifsSeuls(e.target.checked)}/>
          Chantiers actifs seulement
        </label>
        <select value={periode} onChange={(e) => setPeriode(e.target.value)} style={select}>
          <option value="12">12 derniers mois</option>
          <option value="24">24 derniers mois</option>
          <option value="tout">Tout l'historique</option>
        </select>
      </div>

      {voirExclus && stats.sansReference.length > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 10, border: `1px dashed ${T.border}`, fontSize: 12.5, color: T.textSub }}>
          <strong>Sans référence figée</strong> (hors courbes de référence — prendre la référence depuis la fiche chantier) : {fmtListe(stats.sansReference)}
        </div>
      )}
      {stats.nonApparies.length > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(245,166,35,.12)",
          border: "1px solid rgba(245,166,35,.4)", fontSize: 12.5, color: "#b97a10", fontWeight: 600 }}>
          {stats.nonApparies.length} chantier{stats.nonApparies.length > 1 ? "s" : ""} non apparié{stats.nonApparies.length > 1 ? "s" : ""} aux
          États financiers (jointure par nom) — absent{stats.nonApparies.length > 1 ? "s" : ""} des recettes et de la valeur générée réelles : {fmtListe(stats.nonApparies)}
        </div>
      )}

      {/* Lignes d'États financiers ORPHELINES : le vrai risque de faux
          chiffres de la jointure par nom — liste pour corriger les noms. */}
      {etat.rapprochement && etat.rapprochement.lignesNonAppariees.length > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 10, border: `1px dashed rgba(245,166,35,.55)`, fontSize: 12.5, color: T.textSub }}>
          <button onClick={() => setVoirOrphelines(v => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
              fontSize: 12.5, fontWeight: 800, color: "#b97a10" }}>
            {voirOrphelines ? "▾" : "▸"} {etat.rapprochement.lignesNonAppariees.length} ligne(s) des États financiers sans chantier correspondant — corriger les noms pour les rattacher
          </button>
          {voirOrphelines && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: "2px 18px" }}>
              {etat.rapprochement.lignesNonAppariees.map((l, i) => (
                <span key={i}>· {l.nom}{l.devis ? ` (${l.devis})` : ""}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Le graphique — même composant que la fiche chantier */}
      {dataGraphe.length > 0 ? (
        <div ref={grapheRef} style={{ background: T.cardBg || "transparent", border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 14px 6px", minWidth: 0 }}>
          <DiagrammeFinancierChart T={T} data={dataGraphe} hauteur={340}
            masques={masques}
            onToggleSerie={(k) => k && setMasques((m) => ({ ...m, [k]: !m[k] }))}/>
          <div style={{ fontSize: 11.5, color: T.textMuted, textAlign: "center", margin: "2px 0 8px" }}>
            Trait plein = réel · pointillés = référence figée · somme des chantiers, cumuls mensuels € HT · clic sur la légende = masquer/afficher
          </div>
        </div>
      ) : (
        <div style={{ color: T.textMuted, fontSize: 13 }}>
          Aucune donnée mensuelle sur la période choisie.
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {pastille("#22c55e", "Valeur générée (avancement × marché)")}
        {pastille("#5B8AF5", "Facturation")}
        {pastille("#e15a5a", "Dépenses (MO + matériaux)")}
      </div>
    </div>
  );
}
