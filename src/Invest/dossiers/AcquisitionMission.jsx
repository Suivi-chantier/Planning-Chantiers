// src/Invest/dossiers/AcquisitionMission.jsx — onglet Acquisition de la fiche Mission.
//
// Une carte par acquisition (un bien) : stade déduit des dates, jalons (offre, compromis, acte, clés, travaux,
// mise en location), conditions suspensives avec échéance et levée, notaire, prix signé et budget travaux, alertes
// d'échéance. Les calculs viennent de calculAcquisition.mjs ; rien n'est stocké en double (le stade se déduit).
// Ni l'étape du parcours, ni les opérations de la Tranche 5, ni le financement ne sont modifiés.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  STADES, JALONS, MAX_ACQUISITIONS, MAX_CONDITIONS, stadeAcquisition, etatConditions, alertesAcquisition, finRetractation,
  coutAcquisition, syntheseAcquisitions, erreursAcquisition, nettoyerConditions,
} from "./calculAcquisition";

const eur = (v) => (v == null ? "Non évaluable" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const VERT = "#16a34a", ORANGE = "#d97706", ROUGE = "#dc2626";
const nouvelId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nbOuNull = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const COULEUR_STADE = { abandonnee: ROUGE, en_location: VERT, prete_louer: VERT };
const versAcq = (r) => ({
  id: r.id, libelle: r.libelle || "", bien_id: r.bien_id || "", prix_signe: r.prix_signe ?? "", budget_travaux: r.budget_travaux ?? "", notaire: r.notaire || "",
  notaire_contact: r.notaire_contact || "", abandon_motif: r.abandon_motif || "", commentaire: r.commentaire || "",
  ...Object.fromEntries([...JALONS.map(([k]) => k), "abandon_le"].map((k) => [k, r[k] || ""])),
  conditions_suspensives: (Array.isArray(r.conditions_suspensives) ? r.conditions_suspensives : []).map((c) => ({ libelle: c?.libelle || "", echeance: c?.echeance || "", levee_le: c?.levee_le || "" })),
});

function Carte({ T, titre, droite, children }) {
  return (
    <section style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: T.shadowSm, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted }}>{titre}</div>{droite}
      </div>{children}
    </section>
  );
}
function Chiffre({ T, libelle, valeur, couleur, fort }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}</div>
      <div style={{ fontSize: fort ? 16 : 13.5, fontWeight: 900, color: couleur || T.text }}>{valeur}</div>
    </div>
  );
}

export default function AcquisitionMission({ T, fiche, client, dossier, profil, modifiable }) {
  const [chargement, setChargement] = useState(true);
  const [acqs, setAcqs] = useState([]);
  const [retirees, setRetirees] = useState([]);
  const [biens, setBiens] = useState([]);
  const [lecture, setLecture] = useState("");
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const peutEditer = modifiable;

  const charger = useCallback(async () => {
    const [ra, rb] = await Promise.all([
      supabase.from("invest_dossier_acquisitions").select("*").eq("dossier_id", dossier.id).order("created_at", { ascending: true }),
      supabase.from("invest_biens").select("id,adresse,ville").order("created_at", { ascending: false }).limit(300),
    ]);
    setLecture([ra.error].filter(Boolean).map((e) => e.message).join(" · "));
    setAcqs((ra.data || []).map(versAcq)); setBiens(rb.data || []); setRetirees([]); setModifie(false); setChargement(false);
  }, [dossier.id]);
  useEffect(() => { charger(); }, [charger]);

  const jour = aujourdhui();
  const synthese = useMemo(() => syntheseAcquisitions(acqs), [acqs]);
  const touche = (f) => (...a) => { f(...a); setModifie(true); };
  const maj = (id, patch) => touche(setAcqs)((l) => l.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const majCondition = (id, i, patch) => touche(setAcqs)((l) => l.map((a) => (a.id === id ? { ...a, conditions_suspensives: a.conditions_suspensives.map((c, k) => (k === i ? { ...c, ...patch } : c)) } : a)));
  const ajouter = () => touche(setAcqs)((l) => [...l, {
    id: nouvelId(), nouveau: true, libelle: "", bien_id: "", prix_signe: "", budget_travaux: "", notaire: "", notaire_contact: "", abandon_motif: "", commentaire: "",
    ...Object.fromEntries([...JALONS.map(([k]) => k), "abandon_le"].map((k) => [k, ""])), conditions_suspensives: [],
  }]);
  const retirer = (a) => {
    if (!window.confirm(`Retirer l'acquisition « ${a.libelle || "sans libellé"} » ?`)) return;
    if (!a.nouveau) setRetirees((r) => [...r, a.id]);
    touche(setAcqs)((l) => l.filter((x) => x.id !== a.id));
  };

  const enregistrer = async () => {
    const problemes = acqs.flatMap((a, i) => erreursAcquisition(a).map((e) => `Acquisition ${i + 1} : ${e}`));
    if (problemes.length) { setErreur(problemes.join(" ")); return; }
    setOccupe(true); setErreur(""); setMessage("");
    try {
      if (retirees.length) { const r = await supabase.from("invest_dossier_acquisitions").delete().in("id", retirees).select("id"); if (r.error) throw new Error(r.error.message); }
      if (acqs.length) {
        const lignes = acqs.map((a) => ({
          id: a.id, dossier_id: dossier.id, client_id: client.id, libelle: a.libelle.trim(), bien_id: a.bien_id || null,
          prix_signe: nbOuNull(a.prix_signe), budget_travaux: nbOuNull(a.budget_travaux), notaire: a.notaire.trim() || null, notaire_contact: a.notaire_contact.trim() || null,
          ...Object.fromEntries([...JALONS.map(([k]) => k), "abandon_le"].map((k) => [k, a[k] || null])),
          abandon_motif: a.abandon_le ? a.abandon_motif.trim() || null : null, commentaire: a.commentaire.trim() || null,
          conditions_suspensives: nettoyerConditions(a.conditions_suspensives), updated_at: new Date().toISOString(),
        }));
        const r = await supabase.from("invest_dossier_acquisitions").upsert(lignes, { onConflict: "id" }).select("id");
        if (r.error) throw new Error(r.error.message);
        if (r.data?.length !== lignes.length) throw new Error("Enregistrement refusé : droits insuffisants.");
      }
      setMessage("Acquisitions enregistrées."); setOccupe(false); await charger();
    } catch (e) { setErreur(e.message || String(e)); setOccupe(false); }   // saisie conservée : on peut réessayer
  };

  if (chargement) return <Carte T={T} titre="Acquisition"><div style={{ fontSize: 13, color: T.textMuted }}>Chargement des acquisitions…</div></Carte>;
  const champDate = (a, cle, libelle) => (
    <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}
      <input className="inv-inp" type="date" value={a[cle]} disabled={!peutEditer} onChange={(e) => maj(a.id, { [cle]: e.target.value })} /></label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`.mod-carte input,.mod-carte select,.mod-carte textarea{width:100%;min-width:0;box-sizing:border-box}`}</style>
      {lecture && <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 700 }}>Lecture impossible : {lecture}</div>}
      {erreur && <div role="alert" style={{ fontSize: 12.5, color: ROUGE, fontWeight: 700 }}>{erreur}</div>}
      {message && <div style={{ fontSize: 12.5, color: VERT, fontWeight: 700 }}>{message}</div>}

      <Carte T={T} titre="Synthèse">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
          <Chiffre T={T} libelle="Acquisitions suivies" valeur={synthese.nombre} fort />
          <Chiffre T={T} libelle="En cours" valeur={synthese.enCours} />
          <Chiffre T={T} libelle="Acte signé ou au-delà" valeur={synthese.realisees} />
          <Chiffre T={T} libelle="Coût des acquisitions réalisées" valeur={synthese.realisees === 0 ? "Aucune" : synthese.coutRealise === null ? "Prix manquant" : eur(synthese.coutRealise)} />
        </div>
        {synthese.nombre > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {Object.entries(STADES).filter(([k]) => synthese.parStade[k] > 0).map(([k, l]) => <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 999, padding: "2px 10px" }}>{l} · {synthese.parStade[k]}</span>)}</div>}
      </Carte>

      <Carte T={T} titre={`Acquisitions · ${acqs.length}`} droite={peutEditer && acqs.length < MAX_ACQUISITIONS && <button className="inv-btn inv-btn-sm" onClick={ajouter}>＋ Ajouter une acquisition</button>}>
        {acqs.length === 0 && <div style={{ fontSize: 13, color: T.textMuted }}>Aucune acquisition suivie pour l'instant. Ajoutez-en une dès qu'une offre est acceptée.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 12 }}>
          {acqs.map((a) => {
            const stade = stadeAcquisition(a), cond = etatConditions(a.conditions_suspensives, jour), alertes = alertesAcquisition(a, jour), cout = coutAcquisition(a), retr = finRetractation(a);
            return (
              <div key={a.id} className="mod-carte" style={{ border: `1px solid ${T.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="inv-inp" style={{ textAlign: "left", flex: 1, fontWeight: 800 }} placeholder="Adresse ou nom du bien" aria-label="Libellé" value={a.libelle} disabled={!peutEditer} onChange={(e) => maj(a.id, { libelle: e.target.value })} />
                  {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => retirer(a)} title="Retirer cette acquisition">✕</button>}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: COULEUR_STADE[stade] || T.text }}>Stade : {STADES[stade]}{a.abandon_le && a.abandon_motif ? ` — ${a.abandon_motif}` : ""}</div>
                {alertes.map((x, i) => <div key={i} style={{ fontSize: 12, fontWeight: 700, color: x.niveau === "rouge" ? ROUGE : x.niveau === "orange" ? ORANGE : T.textSub }}>{x.niveau === "info" ? "ℹ" : "⚠"} {x.texte}</div>)}
                <select className="inv-sel" aria-label="Bien du stock" value={a.bien_id} disabled={!peutEditer} onChange={(e) => maj(a.id, { bien_id: e.target.value })}>
                  <option value="">Bien du stock : aucun lien</option>
                  {biens.map((b) => <option key={b.id} value={b.id}>{[b.adresse, b.ville].filter(Boolean).join(", ") || b.id}</option>)}</select>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {JALONS.map(([k, l]) => champDate(a, k, l))}
                </div>
                {retr && <div style={{ fontSize: 11.5, color: T.textMuted }}>Fin indicative du délai de rétractation : {dateFr(retr)} (10 jours après le compromis, à confirmer avec le notaire).</div>}

                <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted, marginTop: 4 }}>
                  Conditions suspensives{cond.total > 0 ? ` · ${cond.levees}/${cond.total} levée${cond.levees > 1 ? "s" : ""}` : ""}</div>
                {a.conditions_suspensives.map((c, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) auto", gap: 6, alignItems: "end" }}>
                    <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Ex. obtention du prêt" aria-label="Condition suspensive" value={c.libelle} disabled={!peutEditer} onChange={(e) => majCondition(a.id, i, { libelle: e.target.value })} />
                    <label style={{ fontSize: 10, color: T.textMuted, fontWeight: 700 }}>Échéance<input className="inv-inp" type="date" value={c.echeance} disabled={!peutEditer} onChange={(e) => majCondition(a.id, i, { echeance: e.target.value })} /></label>
                    <label style={{ fontSize: 10, color: c.levee_le ? VERT : T.textMuted, fontWeight: 700 }}>Levée le<input className="inv-inp" type="date" value={c.levee_le} disabled={!peutEditer} onChange={(e) => majCondition(a.id, i, { levee_le: e.target.value })} /></label>
                    {peutEditer && <button type="button" className="inv-btn inv-btn-sm" title="Retirer" onClick={() => touche(setAcqs)((l) => l.map((x) => (x.id === a.id ? { ...x, conditions_suspensives: x.conditions_suspensives.filter((_, k) => k !== i) } : x)))}>✕</button>}
                  </div>
                ))}
                {peutEditer && a.conditions_suspensives.length < MAX_CONDITIONS && <button type="button" className="inv-btn inv-btn-sm" style={{ alignSelf: "flex-start" }}
                  onClick={() => touche(setAcqs)((l) => l.map((x) => (x.id === a.id ? { ...x, conditions_suspensives: [...x.conditions_suspensives, { libelle: "", echeance: "", levee_le: "" }] } : x)))}>＋ Ajouter une condition</button>}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                  <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Notaire (étude)" aria-label="Notaire" value={a.notaire} disabled={!peutEditer} onChange={(e) => maj(a.id, { notaire: e.target.value })} />
                  <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Contact (e-mail, téléphone)" aria-label="Contact du notaire" value={a.notaire_contact} disabled={!peutEditer} onChange={(e) => maj(a.id, { notaire_contact: e.target.value })} />
                  {[["prix_signe", "Prix signé (€)"], ["budget_travaux", "Budget travaux (€)"]].map(([k, l]) => (
                    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{l}
                      <input className="inv-inp" inputMode="decimal" style={{ textAlign: "right" }} value={a[k]} disabled={!peutEditer} onChange={(e) => maj(a.id, { [k]: e.target.value })} /></label>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: T.textSub, fontWeight: 700 }}>
                  Coût d'acquisition : {cout.total === null ? "Non évaluable (prix signé manquant)" : eur(cout.total)}{cout.total !== null && !cout.travauxRenseignes ? " — travaux non budgétés" : ""}</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 6 }}>
                  {champDate(a, "abandon_le", "Abandon (date)")}
                  <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>Motif d'abandon
                    <input className="inv-inp" style={{ textAlign: "left" }} value={a.abandon_motif} disabled={!peutEditer || !a.abandon_le} onChange={(e) => maj(a.id, { abandon_motif: e.target.value })} /></label>
                </div>
                <textarea className="inv-textarea" rows={2} placeholder="Commentaire" aria-label="Commentaire" value={a.commentaire} disabled={!peutEditer} onChange={(e) => maj(a.id, { commentaire: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
              </div>
            );
          })}
        </div>
      </Carte>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {peutEditer && <button className="inv-btn inv-btn-blue" disabled={occupe || !modifie} onClick={enregistrer}>Enregistrer</button>}
        {modifie && <span style={{ fontSize: 11.5, color: ORANGE, fontWeight: 700 }}>Modifications non enregistrées</span>}
        {!modifiable && <span style={{ fontSize: 12, color: T.textMuted }}>Mission close : consultation seule.</span>}
      </div>
    </div>
  );
}
