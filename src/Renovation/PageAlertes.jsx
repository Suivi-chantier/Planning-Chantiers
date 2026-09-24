// ─────────────────────────────────────────────────────────────────────────────
// AFFICHAGE PROVISOIRE — le futur dashboard réutilisera alertesV1 ;
// ne pas mettre de logique ici.
//
// Ce fichier est JETABLE. Le livrable du chantier 09 est le moteur
// src/Renovation/alertesV1.mjs. Cette page n'existe que pour rendre les
// alertes visibles tout de suite à la hiérarchie, qui ouvre l'application.
// Tout ce qui décide d'un niveau, d'un tri, d'un impact ou d'un libellé vit
// dans le module : ici on ne fait que lire deux semaines de relevés et
// afficher ce qu'il renvoie.
//
// Ce que cette page ne fait PAS, volontairement : aucune notification, aucun
// e-mail, aucune écriture, aucun « marquer comme lu » — ce dernier demandera
// une table, il viendra avec les notifications.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { getWeekId, getCurrentWeek } from "../constants";
import { preparerSemainesAttentionV1 } from "./pointsAttentionDonneesV1.js";
// Mêmes helpers de semaine ISO que le Bilan Semaine : une seule façon de
// nommer une semaine dans l'application.
import { lundiSemaineISOv1, ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";
import { semaineISOv1 } from "./planningEngineDataHelpersV1.js";
import {
  alertesV1, etatAlertesV1, libelleMotifAlerteV1,
  NIVEAU_CRITIQUE, NIVEAU_A_SURVEILLER, NIVEAU_INFO,
  ETAT_RELEVE_ABSENT,
} from "./alertesV1.js";
import { formaterEurosV1 } from "./pointsAttentionV1.js";
import { AlertTriangle, Eye, Info, ChevronDown, ChevronUp, Bell } from "lucide-react";

// Chantiers jamais affichés. C'est une DONNÉE de l'entreprise (DÉPOT est le
// stock interne, pas un chantier), passée en paramètre au moteur — le module
// n'écrit aucun nom en dur dans sa logique.
const CHANTIERS_EXCLUS = ["DÉPOT"];

const COULEURS = {
  [NIVEAU_CRITIQUE]:     { texte: "#e15a5a", fond: "rgba(225,90,90,.10)",  bord: "rgba(225,90,90,.32)",  icone: AlertTriangle, label: "Critique" },
  [NIVEAU_A_SURVEILLER]: { texte: "#f5a623", fond: "rgba(245,166,35,.10)", bord: "rgba(245,166,35,.32)", icone: Eye,           label: "À surveiller" },
  [NIVEAU_INFO]:         { texte: "#8a8a8a", fond: "rgba(138,138,138,.10)",bord: "rgba(138,138,138,.30)",icone: Info,          label: "Information" },
};

function CarteAlerte({ alerte, T, onOuvrirChantier }) {
  const c = COULEURS[alerte.niveau] || COULEURS[NIVEAU_INFO];
  return (
    <div
      onClick={() => onOuvrirChantier && onOuvrirChantier(alerte)}
      style={{
        background: T.surface, border: `1px solid ${c.bord}`, borderLeft: `3px solid ${c.texte}`,
        borderRadius: RADIUS.lg, padding: "12px 14px", marginBottom: 10,
        cursor: onOuvrirChantier ? "pointer" : "default",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <Icon as={c.icone} size={13} color={c.texte}/>
        <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>{alerte.nom}</span>
        {alerte.impactEuros != null && (
          <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: c.texte,
            background: c.fond, border: `1px solid ${c.bord}`, padding: "1px 8px", borderRadius: RADIUS.pill }}>
            {formaterEurosV1(alerte.impactEuros)}
          </span>
        )}
        {alerte.avancement != null && (
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>avancement {alerte.avancement} %</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
        {alerte.motifs.map(m => (
          <span key={m} style={{ fontSize: FONT.xs.size, fontWeight: 600, color: T.textSub,
            background: T.card, border: `1px solid ${T.border}`, padding: "1px 8px", borderRadius: RADIUS.pill }}>
            {libelleMotifAlerteV1(m)}
          </span>
        ))}
      </div>

      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.55 }}>
        {alerte.explication}
      </div>

      {/* Drapeau de fiabilité : un FAIT, sans montant de correction. On ignore
          de combien la marge est surestimée, et supposer un taux de frais
          généraux produirait un chiffre inventé. */}
      {alerte.fiabilite && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8,
          fontSize: FONT.xs.size, fontWeight: 700, color: "#f5a623",
          background: "rgba(245,166,35,.10)", border: "1px solid rgba(245,166,35,.32)",
          padding: "2px 9px", borderRadius: RADIUS.pill }}>
          <Icon as={AlertTriangle} size={10}/>
          {alerte.fiabilite.message}
        </div>
      )}
    </div>
  );
}

export default function PageAlertes({ T, branch = "renovation", onOuvrirChantier = null }) {
  const acc = getBranchAccent(branch);
  const [lignes, setLignes] = useState(null); // null = pas encore lu
  const [erreur, setErreur] = useState(null);
  const [infoOuvert, setInfoOuvert] = useState(false);

  // Les deux semaines nécessaires à la comparaison : la courante et la
  // précédente. Même mécanisme que le Bilan Semaine.
  const semaines = useMemo(() => {
    const now = new Date();
    const courante = getWeekId(now.getFullYear(), getCurrentWeek());
    const lundi = lundiSemaineISOv1(courante);
    const precedente = lundi ? semaineISOv1(ajouterJoursV1(lundi, -7))?.week_id : null;
    return precedente ? [courante, precedente] : [courante];
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data, error } = await supabase
        .from("chantier_snapshots_hebdo")
        .select("chantier_id, chantier_nom, week_id, date_snapshot, created_at, avancement, heures_reelles, marge, marge_terminaison, warnings")
        .in("week_id", semaines)
        .order("date_snapshot", { ascending: true });
      if (annule) return;
      if (error) { setErreur(error.message); setLignes([]); return; }
      setLignes(data || []);
    })();
    return () => { annule = true; };
  }, [semaines.join(",")]);

  // Tout le calcul est DÉLÉGUÉ. Le dédoublonnage des relevés vient du module
  // de données, la détection des dérives de pointsAttentionV1 (appelé par
  // alertesV1), le classement d'alertesV1.
  const resultat = useMemo(() => {
    if (lignes === null) return null;
    // preparerSemainesAttentionV1 rend UN TABLEAU par semaine demandée, dans
    // l'ordre de `weekIds` : [0] = semaine courante, [1] = précédente.
    const [courants, precedents] = preparerSemainesAttentionV1({ lignes, weekIds: semaines });
    return alertesV1({
      snapshotsCourants: courants || [],
      snapshotsPrecedents: precedents || [],
      exclusions: CHANTIERS_EXCLUS,
    });
  }, [lignes, semaines.join(",")]);

  const etat = resultat ? etatAlertesV1(resultat) : null;
  const parNiveau = n => (resultat?.alertes || []).filter(a => a.niveau === n);
  const critiques = parNiveau(NIVEAU_CRITIQUE);
  const aSurveiller = parNiveau(NIVEAU_A_SURVEILLER);
  const infos = parNiveau(NIVEAU_INFO);

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg, padding: "18px 16px 40px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Icon as={Bell} size={18} color={acc.accent}/>
          <h1 style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, margin: 0 }}>Alertes</h1>
          {critiques.length > 0 && (
            <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: "#fff",
              background: "#e15a5a", padding: "1px 9px", borderRadius: RADIUS.pill }}>
              {critiques.length}
            </span>
          )}
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 16, fontStyle: "italic" }}>
          Affichage provisoire — le tableau de bord à venir réutilisera le même moteur.
        </div>

        {lignes === null && (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 40, fontSize: FONT.sm.size }}>
            Lecture du relevé hebdomadaire…
          </div>
        )}

        {erreur && (
          <div style={{ padding: "12px 14px", borderRadius: RADIUS.lg, marginBottom: 14,
            background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.35)",
            fontSize: FONT.sm.size, color: T.textSub }}>
            <Icon as={AlertTriangle} size={13} color="#f5a623"/> Le relevé n'a pas pu être lu. Rien n'est affiché : ce n'est pas « aucune alerte ».
          </div>
        )}

        {/* Relevé absent : ton NEUTRE, jamais vert. On ne sait pas, ce n'est
            pas une bonne nouvelle. Le message vient d'etatPointsAttentionV1. */}
        {etat && etat.statut === ETAT_RELEVE_ABSENT && (
          <div style={{ padding: "14px 16px", borderRadius: RADIUS.lg,
            background: T.card, border: `1px solid ${T.border}`, color: T.textSub, fontSize: FONT.sm.size }}>
            {etat.message}
          </div>
        )}

        {etat && etat.statut !== ETAT_RELEVE_ABSENT && (
          <>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginBottom: 14 }}>
              {etat.message}
              {resultat.margeSurestimee.length > 0 && (
                <span style={{ color: T.textMuted }}>
                  {" "}· {resultat.margeSurestimee.length} chantier{resultat.margeSurestimee.length > 1 ? "s" : ""} dont la marge est surestimée (frais généraux non renseignés).
                </span>
              )}
            </div>

            {critiques.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <h2 style={{ fontSize: FONT.sm.size, fontWeight: 800, color: "#e15a5a", margin: "0 0 8px" }}>
                  Critique ({critiques.length})
                </h2>
                {critiques.map(a => <CarteAlerte key={a.chantierId} alerte={a} T={T} onOuvrirChantier={onOuvrirChantier}/>)}
              </section>
            )}

            {aSurveiller.length > 0 && (
              <section style={{ marginBottom: 18 }}>
                <h2 style={{ fontSize: FONT.sm.size, fontWeight: 800, color: "#f5a623", margin: "0 0 8px" }}>
                  À surveiller ({aSurveiller.length})
                </h2>
                {aSurveiller.map(a => <CarteAlerte key={a.chantierId} alerte={a} T={T} onOuvrirChantier={onOuvrirChantier}/>)}
              </section>
            )}

            {/* « Info » repliée par défaut : c'est le bruit de fond. Son nombre
                reste visible pour qu'on sache qu'elle n'est pas vide. */}
            {infos.length > 0 && (
              <section>
                <button onClick={() => setInfoOuvert(v => !v)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6,
                    background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
                    padding: "6px 12px", color: T.textSub, fontFamily: "inherit",
                    fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}>
                  <Icon as={infoOuvert ? ChevronUp : ChevronDown} size={12}/>
                  Information ({infos.length})
                </button>
                {infoOuvert && infos.map(a => <CarteAlerte key={a.chantierId} alerte={a} T={T} onOuvrirChantier={onOuvrirChantier}/>)}
              </section>
            )}

            {resultat.alertes.length === 0 && (
              <div style={{ padding: "14px 16px", borderRadius: RADIUS.lg,
                background: T.card, border: `1px dashed ${T.border}`, color: T.textSub, fontSize: FONT.sm.size }}>
                Aucune alerte sur le relevé de cette semaine.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
