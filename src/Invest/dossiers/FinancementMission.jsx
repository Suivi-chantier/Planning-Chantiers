// src/Invest/dossiers/FinancementMission.jsx — onglet Financement de la fiche Mission.
//
// Quatre blocs : le DOSSIER bancaire (avancement, pièces obligatoires reçues, conditions générales), le PLAN DE
// FINANCEMENT du scénario retenu (emplois contre ressources, écart), les BANQUES consultées (statut, montants,
// conditions, retenue) et la synthèse des prêts retenus. Les chiffres viennent de calculFinancement.mjs, la capacité
// du client de calculAnalyse.mjs : rien n'est recalculé ici ni stocké en double. « Transmis aux banques » est un
// geste explicite. Ni l'étape du parcours, ni la stratégie, ni les pièces ne sont modifiées.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { calculerAnalyse, validerHypotheses } from "./calculAnalyse";
import { mensualiteCredit } from "./calculStrategie";
import {
  STATUTS_BANQUE, STATUTS_RETENABLES, STATUTS_DOSSIER, MAX_BANQUES, scenarioRetenu, planFinancement, syntheseCredits, pipelineBanques, alertesBanques,
  completudeDossierClient, erreursBanque, erreursLignes, nettoyerLignes,
} from "./calculFinancement";

const eur = (v) => (v == null ? "Non évaluable" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const VERT = "#16a34a", ORANGE = "#d97706", ROUGE = "#dc2626";
const nouvelId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const nbOuNull = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const CHAMPS_BANQUE = [["montant_demande", "Montant demandé (€)"], ["montant_accorde", "Montant accordé (€)"], ["taux_pct", "Taux (%)"], ["duree_ans", "Durée (ans)"],
  ["assurance_mensuelle", "Assurance (€/mois)"], ["frais_dossier", "Frais de dossier (€)"], ["frais_garantie", "Frais de garantie (€)"]];
const versBanque = (r) => ({ id: r.id, banque: r.banque || "", contact: r.contact || "", statut: r.statut, garantie: r.garantie || "", conditions: r.conditions || "", commentaire: r.commentaire || "",
  demande_le: r.demande_le || "", reponse_le: r.reponse_le || "", validite_offre_le: r.validite_offre_le || "", retenue: !!r.retenue,
  ...Object.fromEntries(CHAMPS_BANQUE.map(([cle]) => [cle, r[cle] ?? ""])) });
const versLigne = (l) => ({ libelle: l?.libelle || "", montant: l?.montant ?? "" });

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

export default function FinancementMission({ T, fiche, client, dossier, profil, modifiable, onOnglet }) {
  const [chargement, setChargement] = useState(true);
  const [ligne, setLigne] = useState(null);
  const [lecture, setLecture] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [hypAnalyse, setHypAnalyse] = useState({});
  const [pieces, setPieces] = useState([]);
  const [scenarioId, setScenarioId] = useState("");
  const [dossierStatut, setDossierStatut] = useState("a_constituer");
  const [transmisLe, setTransmisLe] = useState("");
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [autresEmplois, setAutresEmplois] = useState([]);
  const [autresRessources, setAutresRessources] = useState([]);
  const [banques, setBanques] = useState([]);
  const [retirees, setRetirees] = useState([]);
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [dateTransmission, setDateTransmission] = useState(aujourdhui());
  const auteur = profil?.nom || profil?.email || null;

  const charger = useCallback(async () => {
    const [rf, rb, rs, ra, rp] = await Promise.all([
      supabase.from("invest_dossier_financements").select("*").eq("dossier_id", dossier.id).maybeSingle(),
      supabase.from("invest_dossier_banques").select("*").eq("dossier_id", dossier.id).order("created_at", { ascending: true }),
      supabase.from("invest_dossier_scenarios").select("id,ordre,libelle,hypotheses,recommande").eq("dossier_id", dossier.id).order("ordre", { ascending: true }),
      supabase.from("invest_dossier_analyses").select("hypotheses").eq("dossier_id", dossier.id).maybeSingle(),
      supabase.from("invest_dossier_pieces").select("genre,libelle,obligatoire,statut").eq("dossier_id", dossier.id),
    ]);
    setLecture([rf.error, rb.error, rs.error].filter(Boolean).map((e) => e.message).join(" · "));
    const f = rf.data || null;
    setLigne(f); setScenarios(rs.data || []); setHypAnalyse(ra.data?.hypotheses || {}); setPieces(rp.data || []);
    setScenarioId(f?.scenario_id || ""); setDossierStatut(f?.dossier_statut || "a_constituer"); setTransmisLe(f?.transmis_le || "");
    setConditions(f?.conditions || ""); setNotes(f?.notes || "");
    setAutresEmplois((Array.isArray(f?.autres_emplois) ? f.autres_emplois : []).map(versLigne)); setAutresRessources((Array.isArray(f?.autres_ressources) ? f.autres_ressources : []).map(versLigne));
    setBanques((rb.data || []).map(versBanque)); setRetirees([]); setModifie(false); setChargement(false);
  }, [dossier.id]);
  useEffect(() => { charger(); }, [charger]);

  const analyse = useMemo(() => calculerAnalyse({ situation: fiche.situation, projet: fiche.projet, hypotheses: validerHypotheses(hypAnalyse).valides }), [fiche.situation, fiche.projet, hypAnalyse]);
  const mensualiteMax = analyse.capacite.calculable ? analyse.capacite.mensualiteMax : null;
  const retenu = useMemo(() => scenarioRetenu(scenarios, scenarioId), [scenarios, scenarioId]);
  const plan = useMemo(() => planFinancement({ scenario: retenu.scenario, banques, autresEmplois, autresRessources }), [retenu, banques, autresEmplois, autresRessources]);
  const synthese = useMemo(() => syntheseCredits(banques, mensualiteMax), [banques, mensualiteMax]);
  const alertes = useMemo(() => alertesBanques(banques, aujourdhui()), [banques]);
  const pipeline = useMemo(() => pipelineBanques(banques), [banques]);
  const completude = useMemo(() => completudeDossierClient(pieces), [pieces]);
  const transmis = dossierStatut === "transmis";
  const peutEditer = modifiable;
  const touche = (f) => (...a) => { f(...a); setModifie(true); };
  const majBanque = (id, patch) => touche(setBanques)((l) => l.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const ajouterBanque = () => touche(setBanques)((l) => [...l, { id: nouvelId(), nouveau: true, banque: "", contact: "", statut: "a_consulter", garantie: "", conditions: "", commentaire: "", demande_le: "", reponse_le: "", validite_offre_le: "", retenue: false, ...Object.fromEntries(CHAMPS_BANQUE.map(([cle]) => [cle, ""])) }]);
  const retirerBanque = (b) => {
    if (!window.confirm(`Retirer la banque « ${b.banque || "sans nom"} » ?`)) return;
    if (!b.nouveau) setRetirees((r) => [...r, b.id]);
    touche(setBanques)((l) => l.filter((x) => x.id !== b.id));
  };
  const retenable = (b) => STATUTS_RETENABLES.includes(b.statut) && nbOuNull(b.montant_accorde) !== null;

  const enregistrer = async (extra = {}, confirmation = "Financement enregistré.") => {
    const problemes = [...banques.flatMap((b, i) => erreursBanque(b).map((e) => `Banque ${i + 1} : ${e}`)), ...erreursLignes(autresEmplois, "Emploi"), ...erreursLignes(autresRessources, "Ressource")];
    if (problemes.length) { setErreur(problemes.join(" ")); return false; }
    setOccupe(true); setErreur(""); setMessage("");
    try {
      if (retirees.length) { const r = await supabase.from("invest_dossier_banques").delete().in("id", retirees).select("id"); if (r.error) throw new Error(r.error.message); }
      if (banques.length) {
        const lignes = banques.map((b) => ({ id: b.id, dossier_id: dossier.id, client_id: client.id, banque: b.banque.trim(), contact: b.contact.trim() || null, statut: b.statut,
          garantie: b.garantie.trim() || null, conditions: b.conditions.trim() || null, commentaire: b.commentaire.trim() || null,
          demande_le: b.demande_le || null, reponse_le: b.reponse_le || null, validite_offre_le: b.validite_offre_le || null, retenue: !!b.retenue && retenable(b),
          ...Object.fromEntries(CHAMPS_BANQUE.map(([cle]) => [cle, nbOuNull(b[cle])])), updated_at: new Date().toISOString() }));
        const r = await supabase.from("invest_dossier_banques").upsert(lignes, { onConflict: "id" }).select("id");
        if (r.error) throw new Error(r.error.message);
      }
      const champs = { dossier_id: dossier.id, client_id: client.id, scenario_id: scenarioId || null, dossier_statut: dossierStatut, transmis_le: transmisLe || null, conditions: conditions.trim() || null,
        autres_emplois: nettoyerLignes(autresEmplois), autres_ressources: nettoyerLignes(autresRessources), notes: notes.trim() || null, updated_by: auteur, updated_at: new Date().toISOString(), ...extra };
      const r = await supabase.from("invest_dossier_financements").upsert(champs, { onConflict: "dossier_id" }).select("dossier_id");
      if (r.error) throw new Error(r.error.message);
      if (!r.data?.length) throw new Error("Enregistrement refusé : droits insuffisants.");
      setMessage(confirmation); setOccupe(false); await charger(); return true;
    } catch (e) { setErreur(e.message || String(e)); setOccupe(false); return false; }   // saisie conservée : on peut réessayer
  };
  const marquerTransmis = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTransmission)) { setErreur("Indiquez la date de transmission."); return; }
    if (!window.confirm(`Marquer le dossier comme transmis aux banques le ${dateFr(dateTransmission)} ?`)) return;
    enregistrer({ dossier_statut: "transmis", transmis_le: dateTransmission }, "Dossier marqué comme transmis aux banques.");
  };
  const annulerTransmission = () => {
    if (!window.confirm("Annuler la transmission aux banques ?\n\nLe dossier repasse « prêt à transmettre » et la date de transmission est retirée.")) return;
    enregistrer({ dossier_statut: "pret", transmis_le: null }, "Transmission annulée.");
  };

  if (chargement) return <Carte T={T} titre="Financement"><div style={{ fontSize: 13, color: T.textMuted }}>Chargement du financement…</div></Carte>;
  const couleurPlan = plan.etat === "equilibre" ? VERT : plan.etat === "insuffisant" ? ROUGE : ORANGE;
  const lignesLibres = (liste, set, nom) => (
    <>
      {liste.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px auto", gap: 6, marginTop: 6 }}>
          <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Intitulé" aria-label={`${nom} : intitulé`} value={l.libelle} disabled={!peutEditer} onChange={(e) => touche(set)((x) => x.map((y, k) => (k === i ? { ...y, libelle: e.target.value } : y)))} />
          <input className="inv-inp" inputMode="decimal" style={{ textAlign: "right" }} placeholder="Montant" aria-label={`${nom} : montant`} value={l.montant} disabled={!peutEditer} onChange={(e) => touche(set)((x) => x.map((y, k) => (k === i ? { ...y, montant: e.target.value } : y)))} />
          {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => touche(set)((x) => x.filter((_, k) => k !== i))} title="Retirer">✕</button>}
        </div>
      ))}
      {peutEditer && <button type="button" className="inv-btn inv-btn-sm" style={{ marginTop: 8 }} onClick={() => touche(set)((x) => [...x, { libelle: "", montant: "" }])}>＋ Ajouter une ligne</button>}
    </>
  );
  const tableau = (titre, lignes, total) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 900, color: T.textSub, paddingBottom: 4, borderBottom: `1px solid ${T.border}` }}>{titre}</div>
      {lignes.map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, fontSize: 13 }}><span style={{ color: T.text }}>{l.libelle}</span><b style={{ color: T.text }}>{eur(l.montant)}</b></div>)}
      {lignes.length === 0 && <div style={{ fontSize: 12.5, color: T.textMuted, padding: "6px 0" }}>Aucune ligne.</div>}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13.5, fontWeight: 900, color: T.text }}><span>Total</span><span>{eur(total)}</span></div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`.mod-carte input,.mod-carte select,.mod-carte textarea{width:100%;min-width:0;box-sizing:border-box}`}</style>
      {message && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: T.accentBg, color: T.text }}>{message}</div>}
      {erreur && <div style={{ fontSize: 12.5, color: ROUGE }}>{erreur}</div>}
      {lecture && <div style={{ fontSize: 12.5, color: ROUGE }}>Lecture incomplète : {lecture}.</div>}
      {alertes.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{alertes.map((a) => <span key={a.code + a.banque} style={{ fontSize: 11.5, fontWeight: 800, color: a.niveau === "danger" ? ROUGE : ORANGE, background: `${a.niveau === "danger" ? ROUGE : ORANGE}14`, borderRadius: 8, padding: "3px 10px" }}>{a.libelle}</span>)}</div>}

      <Carte T={T} titre="Le dossier de financement" droite={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textMuted, flexWrap: "wrap" }}>
          {transmis && <span style={{ color: VERT, fontWeight: 800 }}>✓ Transmis aux banques le {dateFr(transmisLe)}</span>}
          <button className="inv-btn inv-btn-sm" onClick={() => onOnglet("documents")}>Ouvrir les Documents</button>
        </div>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub }}>Avancement du dossier bancaire
            <select className="inv-sel" value={dossierStatut} disabled={!peutEditer || transmis} onChange={(e) => touche(setDossierStatut)(e.target.value)}>
              {Object.entries(STATUTS_DOSSIER).filter(([k]) => k !== "transmis" || transmis).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></label>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: T.textSub }}>Pièces obligatoires du client</div>
            {!completude.disponible ? <div style={{ fontSize: 12.5, color: T.textMuted, marginTop: 4 }}>Aucune pièce obligatoire suivie : préparez la liste dans l'onglet Documents.</div> : (
              <>
                <div style={{ fontSize: 14, fontWeight: 900, color: completude.manquantes.length ? ORANGE : VERT, marginTop: 4 }}>{completude.recues} / {completude.total} reçues{completude.manquantes.length === 0 && " ✓"}</div>
                {completude.manquantes.length > 0 && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>Manquent : {completude.manquantes.join(", ")}</div>}
              </>
            )}
          </div>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub, marginTop: 12 }}>Conditions générales (assurance, garanties, conditions suspensives…)
          <textarea className="inv-textarea" rows={3} value={conditions} disabled={!peutEditer} onChange={(e) => touche(setConditions)(e.target.value)} style={{ resize: "vertical", fontWeight: 500 }} /></label>
        {modifiable && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
            {transmis ? <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={annulerTransmission}>Annuler la transmission</button> : (
              <>
                <input className="inv-inp" type="date" aria-label="Date de transmission" value={dateTransmission} max={aujourdhui()} onChange={(e) => setDateTransmission(e.target.value)} />
                <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={marquerTransmis}>Marquer le dossier comme transmis aux banques</button>
              </>
            )}
          </div>
        )}
      </Carte>

      <Carte T={T} titre="Plan de financement" droite={
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.textSub, fontWeight: 700 }}>Scénario retenu
          <select className="inv-sel" aria-label="Scénario retenu" value={scenarioId} disabled={!peutEditer} onChange={(e) => touche(setScenarioId)(e.target.value)}>
            <option value="">{scenarios.some((s) => s.recommande) ? "Le scénario recommandé" : "Aucun"}</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>#{s.ordre} {s.libelle}{s.recommande ? " ★" : ""}</option>)}
          </select></label>}>
        {!plan.evaluable ? (
          <div style={{ fontSize: 13, color: T.textMuted }}>{plan.raison} <button className="inv-btn inv-btn-sm" style={{ marginLeft: 8 }} onClick={() => onOnglet("strategie")}>Ouvrir la Stratégie</button></div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>Scénario : <b style={{ color: T.text }}>{retenu.scenario.libelle}</b>{retenu.origine === "recommande" ? " (recommandé)" : ""}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20 }}>
              <div>{tableau("Emplois (ce qu'il faut payer)", plan.emplois, plan.totalEmplois)}{lignesLibres(autresEmplois, setAutresEmplois, "Emploi")}</div>
              <div>{tableau("Ressources (ce qui finance)", plan.ressources, plan.totalRessources)}{lignesLibres(autresRessources, setAutresRessources, "Ressource")}</div>
            </div>
            <div style={{ marginTop: 12, fontSize: 13.5, fontWeight: 800, color: couleurPlan }}>
              {plan.etat === "equilibre" ? "Le plan est équilibré." : plan.etat === "insuffisant" ? `Il manque ${eur(-plan.ecart)} de ressources.` : `Excédent de ${eur(plan.ecart)} : à affecter ou à réduire.`}
            </div>
            {plan.aucunPretRetenu && <div style={{ fontSize: 11.5, color: ORANGE, marginTop: 4 }}>⚠ Aucune banque retenue : le plan n'inclut pas encore de prêt. Retenez une banque dans la liste ci-dessous.</div>}
            {!plan.apportRenseigne && <div style={{ fontSize: 11.5, color: ORANGE, marginTop: 4 }}>⚠ Apport non renseigné dans le scénario : le plan n'en tient pas compte.</div>}
          </>
        )}
      </Carte>

      <Carte T={T} titre={`Banques consultées · ${banques.length}`} droite={peutEditer && banques.length < MAX_BANQUES && <button className="inv-btn inv-btn-sm" onClick={ajouterBanque}>＋ Ajouter une banque</button>}>
        {banques.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {Object.entries(STATUTS_BANQUE).filter(([k]) => pipeline[k] > 0).map(([k, l]) => <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: T.textSub, border: `1px solid ${T.border}`, borderRadius: 999, padding: "2px 10px" }}>{l} · {pipeline[k]}</span>)}</div>}
        {banques.length === 0 && <div style={{ fontSize: 13, color: T.textMuted }}>Aucune banque consultée pour l'instant.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 12 }}>
          {banques.map((b) => {
            const m = nbOuNull(b.montant_accorde) ?? nbOuNull(b.montant_demande), t = nbOuNull(b.taux_pct), d = nbOuNull(b.duree_ans);
            const mensualite = m !== null && t !== null && d !== null ? Math.round(mensualiteCredit(m, t, d)) : null;
            return (
              <div key={b.id} className="mod-carte" style={{ border: `${b.retenue ? 2 : 1}px solid ${b.retenue ? VERT : T.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input className="inv-inp" style={{ textAlign: "left", flex: 1, fontWeight: 800 }} placeholder="Banque" aria-label="Banque" value={b.banque} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { banque: e.target.value })} />
                  {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => retirerBanque(b)} title="Retirer cette banque">✕</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Contact (conseiller, e-mail, téléphone)" aria-label="Contact" value={b.contact} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { contact: e.target.value })} />
                  <select className="inv-sel" aria-label="Statut" value={b.statut} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { statut: e.target.value, ...(STATUTS_RETENABLES.includes(e.target.value) ? {} : { retenue: false }) })}>
                    {Object.entries(STATUTS_BANQUE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {CHAMPS_BANQUE.map(([cle, libelle]) => (
                    <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}
                      <input className="inv-inp" inputMode="decimal" style={{ textAlign: "right" }} value={b[cle]} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { [cle]: e.target.value })} /></label>
                  ))}
                </div>
                <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Garantie (Crédit Logement, hypothèque, caution…)" aria-label="Garantie" value={b.garantie} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { garantie: e.target.value })} />
                <textarea className="inv-textarea" rows={2} placeholder="Conditions de l'offre" aria-label="Conditions de l'offre" value={b.conditions} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { conditions: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  {[["demande_le", "Demande"], ["reponse_le", "Réponse"], ["validite_offre_le", "Validité de l'offre"]].map(([cle, libelle]) => (
                    <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}
                      <input className="inv-inp" type="date" value={b[cle]} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { [cle]: e.target.value })} /></label>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                  <span style={{ color: T.textSub, fontWeight: 700 }}>{mensualite === null ? "Mensualité : taux, durée ou montant manquant" : `Mensualité estimée : ${eur(mensualite)} /mois`}</span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 800, color: b.retenue ? VERT : T.textSub, opacity: retenable(b) ? 1 : 0.6 }}
                    title={retenable(b) ? "Inclure ce prêt dans le plan de financement" : "Il faut un accord de principe ou une offre, et un montant accordé"}>
                    <input type="checkbox" style={{ width: "auto" }} checked={b.retenue} disabled={!peutEditer || !retenable(b)} onChange={(e) => majBanque(b.id, { retenue: e.target.checked })} /> Retenue</label>
                </div>
                <textarea className="inv-textarea" rows={1} placeholder="Commentaire" aria-label="Commentaire" value={b.commentaire} disabled={!peutEditer} onChange={(e) => majBanque(b.id, { commentaire: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
              </div>
            );
          })}
        </div>
        {synthese.nombre > 0 && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>Prêts retenus</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
              <Chiffre T={T} libelle="Montant total" valeur={eur(synthese.montantTotal)} fort />
              <Chiffre T={T} libelle="Mensualité (hors assurance)" valeur={synthese.mensualite === null ? "Taux ou durée manquant" : `${eur(synthese.mensualite)} /mois`} />
              <Chiffre T={T} libelle="Assurance" valeur={`${eur(synthese.assurance)} /mois`} />
              <Chiffre T={T} libelle="Total mensuel" valeur={synthese.mensualiteAvecAssurance === null ? "Non évaluable" : `${eur(synthese.mensualiteAvecAssurance)} /mois`} fort />
              <Chiffre T={T} libelle="Taux moyen pondéré" valeur={synthese.tauxMoyenPct === null ? "Non évaluable" : `${String(synthese.tauxMoyenPct).replace(".", ",")} %`} />
            </div>
            {synthese.compatibleCapacite !== null && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: synthese.compatibleCapacite ? VERT : ROUGE }}>{synthese.compatibleCapacite ? "✓ Mensualité totale dans la capacité du client" : "✗ Mensualité totale au-dessus de la capacité du client"} (maximum {eur(mensualiteMax)} /mois, d'après l'Analyse)</div>}
          </div>
        )}
      </Carte>

      <Carte T={T} titre="Notes">
        <textarea className="inv-textarea" rows={3} aria-label="Notes" value={notes} disabled={!peutEditer} onChange={(e) => touche(setNotes)(e.target.value)} style={{ resize: "vertical", fontWeight: 500, width: "100%" }} />
      </Carte>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {peutEditer && <button className="inv-btn inv-btn-blue" disabled={occupe || !modifie} onClick={() => enregistrer()}>Enregistrer</button>}
        {modifie && <span style={{ fontSize: 11.5, color: ORANGE, fontWeight: 700 }}>Modifications non enregistrées</span>}
        {!modifiable && <span style={{ fontSize: 12, color: T.textMuted }}>Mission close : consultation seule.</span>}
      </div>
    </div>
  );
}
