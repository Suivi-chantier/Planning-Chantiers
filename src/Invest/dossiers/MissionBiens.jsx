// src/Invest/dossiers/MissionBiens.jsx — onglet « Recherche & biens » : le point d'entrée de la recherche immobilière.
// Les biens viennent du Stock (invest_biens) ; la mission ne les recopie pas. Le lien client ↔ bien est la proposition
// (invest_propositions), dont le statut devient celui de la recherche : À analyser · Proposé · Visite prévue · Visité ·
// Refusé · Retenu. Aucun bien n'est jamais supprimé : retenir un bien n'efface pas les autres.
import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { STATUTS_BIEN_MISSION, VALEUR_PROPOSITION } from "./offre2Vue";
import { Bloc, Pastille, EtatVide, Donnee, COULEURS, eur, dateFr } from "./MissionUi";

const ORDRE = ["retenu", "visite_prevue", "visite", "a_analyser", "propose", "refuse"];
const COULEUR_STATUT = { retenu: COULEURS.termine, visite_prevue: COULEURS.cours, visite: COULEURS.cours, a_analyser: "#d97706", propose: COULEURS.avenir, refuse: COULEURS.bloque };
const ACTIONS = [["a_analyser", "Analyser"], ["propose", "Proposer"], ["visite_prevue", "Visite"], ["visite", "Visité"], ["refuse", "Refuser"], ["retenu", "Retenir"]];

function CarteBien({ T, l, principal, modifiable, onStatut, onOpenBien, occupe }) {
  const b = l.bien;
  const infos = [
    { libelle: "Prix", valeur: b.prix, type: "eur" }, { libelle: "Surface", valeur: b.surface === null ? null : `${b.surface} m²` }, { libelle: "Typologie", valeur: b.typologie },
    { libelle: "Travaux", valeur: b.travaux, type: "eur" }, { libelle: "Loyers", valeur: b.loyers === null ? null : `${eur(b.loyers)} / mois` },
    { libelle: "Rendement", valeur: b.rendement, type: "pct" }, { libelle: "Cash-flow", valeur: b.cashflow === null ? null : `${eur(b.cashflow)} / mois` },
  ];
  return (
    <div style={{ border: `${principal ? 2 : 1}px solid ${principal ? COULEURS.termine : T.border}`, borderRadius: 10, padding: "9px 12px", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{b.adresse || "Bien sans adresse"}</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2, flexWrap: "wrap" }}>
            <Pastille couleur={COULEUR_STATUT[l.statut]}>{STATUTS_BIEN_MISSION[l.statut]}</Pastille>
            {l.statutBrut && l.statutBrut.toLowerCase() !== VALEUR_PROPOSITION[l.statut] && <span style={{ fontSize: 11, color: T.textMuted }}>({l.statutBrut})</span>}
            {l.date && <span style={{ fontSize: 11, color: T.textMuted }}>depuis le {dateFr(l.date)}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {onOpenBien && b.id && <button className="inv-btn inv-btn-sm" onClick={() => onOpenBien(b.id)}>Voir</button>}
          {l.brut?.lien_rentabilite && <a className="inv-btn inv-btn-sm" href={l.brut.lien_rentabilite} target="_blank" rel="noreferrer">Simulateur</a>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: "5px 12px", marginTop: 7 }}>
        {infos.map((i) => <Donnee key={i.libelle} T={T} {...i} />)}
      </div>
      {l.commentaire && <div style={{ fontSize: 12, color: T.textSub, marginTop: 6, whiteSpace: "pre-wrap" }}>{l.commentaire}</div>}
      {modifiable && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 8 }}>
          {ACTIONS.filter(([s]) => s !== l.statut).map(([s, lib]) => (
            <button key={s} className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => onStatut(l, s)}
              style={s === "retenu" ? { color: COULEURS.termine, fontWeight: 800 } : s === "refuse" ? { color: COULEURS.bloque } : undefined}>{lib}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MissionBiens({ T, client, m, modifiable, recharger, onMessage, onOpenBien }) {
  const s = m.synthR;
  const [stock, setStock] = useState(null);
  const [ajout, setAjout] = useState(false);
  const [choix, setChoix] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState("");
  const [filtre, setFiltre] = useState("tous");

  useEffect(() => {
    if (!ajout || stock) return;
    supabase.from("invest_biens").select("id,adresse,ville,prix_vente,statut").order("created_at", { ascending: false }).limit(500).then((r) => setStock(r.error ? [] : r.data || []));
  }, [ajout, stock]);

  const ecrire = async (promesse, ok) => {
    setOccupe(true); setErreur("");
    const r = await promesse;
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return false; }
    if (r.data && !r.data.length) { setErreur("Modification refusée : droits insuffisants."); return false; }
    onMessage?.(ok); recharger(); return true;
  };
  const changer = async (l, statut) => {
    if (statut === "retenu" && s.retenu && s.retenu.propositionId !== l.propositionId
      && !window.confirm(`Un seul bien peut être le bien retenu.\n\n« ${s.retenu.bien.adresse || "Le bien actuel"} » reste dans la recherche (statut « à analyser »). Retenir « ${l.bien.adresse || "ce bien"} » ?`)) return;
    if (statut === "refuse" && !window.confirm(`Écarter « ${l.bien.adresse || "ce bien"} » ? Il reste dans la liste, statut « refusé ».`)) return;
    if (statut === "retenu" && s.retenu && s.retenu.propositionId !== l.propositionId) {
      const r1 = await supabase.from("invest_propositions").update({ statut: VALEUR_PROPOSITION.a_analyser }).eq("id", s.retenu.propositionId).select("id");
      if (r1.error) { setErreur(r1.error.message); return; }
    }
    await ecrire(supabase.from("invest_propositions").update({ statut: VALEUR_PROPOSITION[statut] }).eq("id", l.propositionId).select("id"), `Bien : ${STATUTS_BIEN_MISSION[statut].toLowerCase()}.`);
  };
  const ajouter = async () => {
    if (!choix) return;
    const ok = await ecrire(supabase.from("invest_propositions").insert({ client_id: client.id, bien_id: choix, statut: VALEUR_PROPOSITION.a_analyser, commentaire: "", lien_dossier: "", date_proposition: new Date().toISOString().slice(0, 10) }).select("id"), "Bien ajouté à la recherche.");
    if (ok) { setAjout(false); setChoix(""); }
  };

  const dejaLa = new Set(m.lignes.map((l) => l.bienId));
  const visibles = m.lignes.filter((l) => filtre === "tous" || l.statut === filtre).sort((a, b) => ORDRE.indexOf(a.statut) - ORDRE.indexOf(b.statut));
  const compteurs = [["etudies", "étudiés", s.etudies], ["aAnalyser", "à analyser", s.aAnalyser], ["visites", "visités", s.visites], ["ecartes", "écartés", s.ecartes], ["retenus", "retenu", s.retenus]];

  return (
    <>
      <Bloc T={T} titre="Recherche" action={modifiable && !ajout && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setAjout(true)}>＋ Ajouter un bien</button>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
          {compteurs.map(([k, l, n]) => (
            <div key={k} style={{ padding: "6px 10px", borderRadius: 9, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: n ? T.text : T.textMuted }}>{n}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted }}>{l}</div>
            </div>
          ))}
        </div>
        {s.plusieursRetenus && <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>⚠ Plusieurs biens sont « retenus » : un seul peut être le bien principal.</div>}
        {ajout && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <select className="inv-sel" value={choix} onChange={(e) => setChoix(e.target.value)} aria-label="Bien du Stock" style={{ minWidth: 260 }}>
              <option value="">{stock === null ? "Chargement du Stock…" : "Choisir un bien du Stock de biens…"}</option>
              {(stock || []).filter((b) => !dejaLa.has(b.id)).map((b) => <option key={b.id} value={b.id}>{[b.adresse, b.ville].filter(Boolean).join(", ") || "Sans adresse"}{b.prix_vente ? ` — ${eur(b.prix_vente)}` : ""}</option>)}
            </select>
            <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={!choix || occupe} onClick={ajouter}>Ajouter à la recherche</button>
            <button className="inv-btn inv-btn-sm" onClick={() => { setAjout(false); setChoix(""); }}>Annuler</button>
            {stock && stock.length === 0 && <span style={{ fontSize: 12, color: T.textMuted }}>Aucun bien dans le Stock : ajoutez-le d'abord dans « Stock de biens ».</span>}
          </div>
        )}
        {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
      </Bloc>

      <Bloc T={T} titre="Bien retenu">
        {s.retenu ? <CarteBien T={T} l={s.retenu} principal modifiable={modifiable} onStatut={changer} onOpenBien={onOpenBien} occupe={occupe} />
          : <EtatVide T={T} titre="Aucun bien retenu pour le moment." texte={s.etudies ? "Choisissez le bien à acquérir dans la liste ci-dessous." : "Ajoutez un bien du Stock pour démarrer la recherche."} />}
      </Bloc>

      <Bloc T={T} titre={`Biens étudiés · ${s.etudies}`} action={
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[["tous", "Tous"], ...Object.entries(STATUTS_BIEN_MISSION)].map(([k, l]) => (
            <button key={k} className="inv-btn inv-btn-sm" onClick={() => setFiltre(k)} style={filtre === k ? { background: T.accentBg, color: T.accent } : undefined}>{l}</button>
          ))}
        </div>}>
        {m.lignes.length === 0 ? <EtatVide T={T} titre="Aucun bien étudié" texte="Les biens proposés au client apparaissent ici, avec leur statut." action={modifiable && <button className="inv-btn inv-btn-sm" onClick={() => setAjout(true)}>Ajouter / rechercher un bien</button>} />
          : visibles.length === 0 ? <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucun bien avec ce statut.</div>
          : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 8 }}>
              {visibles.filter((l) => !(l.statut === "retenu" && s.retenu?.propositionId === l.propositionId)).map((l) => <CarteBien key={l.propositionId} T={T} l={l} modifiable={modifiable} onStatut={changer} onOpenBien={onOpenBien} occupe={occupe} />)}
            </div>}
      </Bloc>
    </>
  );
}
