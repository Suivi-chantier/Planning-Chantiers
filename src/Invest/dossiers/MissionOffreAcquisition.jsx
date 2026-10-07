// src/Invest/dossiers/MissionOffreAcquisition.jsx — onglet « Offre & acquisition » : un vrai workflow.
// OFFRE (lue et écrite sur la fiche du bien retenu, comme le module « offre d'achat » du Stock) puis ACQUISITION :
// offre acceptée → compromis → conditions suspensives → acte authentique, sur invest_dossier_acquisitions (la structure
// existante : aucune seconde acquisition). Les champs absents (notaire vendeur, séquestre, frais, compromis prévu) vivent
// dans la colonne optionnelle `suivi` ; sans elle ils sont indiqués « à connecter ».
import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import AcquisitionMission from "./AcquisitionMission";
import { erreursAcquisition, nettoyerConditions, etatConditions, MAX_CONDITIONS } from "./calculAcquisition";
import { patchOffre, statutsOffreProposes, offreAcceptee, STATUTS_CONDITION, TYPES_CONDITION, statutCondition, nombreOuNull } from "./offre2Vue";
import { Bloc, Pastille, EtatVide, Donnee, Pipeline, COULEURS, eur, dateFr, aujourdhuiIso } from "./MissionUi";

const nouvelId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const COULEUR_COND = { a_verifier: "#d97706", en_cours: COULEURS.cours, levee: COULEURS.termine, non_realisee: COULEURS.bloque, na: COULEURS.avenir };
const Champ = ({ T, libelle, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700, minWidth: 0 }}>{libelle}{children}</label>
);

function Offre({ T, m, modifiable, recharger, onMessage, naviguer }) {
  const bien = m.synthR.retenu?.brut || null;
  const o = m.offre;
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    if (!bien) { setF(null); return; }
    setF({ statut: o?.statut || "", prixConseille: o?.prixConseille ?? "", prixPropose: o?.prixPropose ?? "", dateOffre: o?.dateOffre || "", dateLimite: o?.dateLimite || "", negociation: o?.negociation || "" });
  }, [bien?.id, bien?.updated_at]);
  if (!m.synthR.retenu) return <Bloc T={T} titre="Offre"><EtatVide T={T} titre="Aucune offre : aucun bien retenu" texte="Retenez d'abord le bien à acquérir." action={<button className="inv-btn inv-btn-sm" onClick={() => naviguer("biens")}>Recherche & biens</button>} /></Bloc>;
  if (!f) return null;
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const enregistrer = async () => {
    setErreur("");
    let patch;
    try { patch = patchOffre(bien, f); } catch (e) { setErreur(e.message); return; }
    setOccupe(true);
    const r = await supabase.from("invest_biens").update(patch).eq("id", bien.id).select("id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Enregistrement refusé : droits insuffisants sur le Stock de biens."); return; }
    onMessage?.("Offre enregistrée."); recharger();
  };
  const accepte = offreAcceptee(f.statut);
  return (
    <Bloc T={T} titre={`Offre · ${m.synthR.retenu.bien.adresse || "bien retenu"}`} action={accepte && <Pastille couleur={COULEURS.termine}>✓ OFFRE ACCEPTÉE</Pastille>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <Donnee T={T} libelle="Prix affiché" valeur={o?.prixAffiche ?? null} type="eur" fort />
        <Champ T={T} libelle="Prix conseillé (€)"><input className="inv-inp" inputMode="decimal" value={f.prixConseille} disabled={!modifiable} onChange={maj("prixConseille")} placeholder="Non renseigné" /></Champ>
        <Champ T={T} libelle="Prix proposé (€)"><input className="inv-inp" inputMode="decimal" value={f.prixPropose} disabled={!modifiable} onChange={maj("prixPropose")} placeholder="Non renseigné" /></Champ>
        <Champ T={T} libelle="Statut de l'offre"><select className="inv-sel" value={f.statut} disabled={!modifiable} onChange={maj("statut")}><option value="">Aucune offre</option>{statutsOffreProposes(f.statut).map((s) => <option key={s}>{s}</option>)}</select></Champ>
        <Champ T={T} libelle="Date d'offre"><input className="inv-inp" type="date" value={f.dateOffre} disabled={!modifiable} onChange={maj("dateOffre")} /></Champ>
        <Champ T={T} libelle="Date limite"><input className="inv-inp" type="date" value={f.dateLimite} disabled={!modifiable} onChange={maj("dateLimite")} /></Champ>
      </div>
      <div style={{ marginTop: 8 }}><Champ T={T} libelle="Commentaires / négociation (internes, jamais visibles par le client)"><textarea className="inv-textarea" rows={2} value={f.negociation} disabled={!modifiable} onChange={maj("negociation")} /></Champ></div>
      {o?.vide && !f.statut && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Aucune offre créée : choisissez un statut (« À préparer ») pour l'ouvrir.</div>}
      {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
      {modifiable && <div style={{ marginTop: 8 }}><button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={enregistrer}>{o?.vide ? "Préparer l'offre" : "Enregistrer l'offre"}</button></div>}
    </Bloc>
  );
}

function Acquisition({ T, client, fiche, m, modifiable, recharger, onMessage }) {
  const a = m.acquisition, offreOk = offreAcceptee(m.offre?.statut);
  const suiviOk = !!a && Object.prototype.hasOwnProperty.call(a, "suivi");
  const [f, setF] = useState(null);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    if (!a) { setF(null); return; }
    const s = a.suivi || {};
    setF({ offre_acceptee_le: a.offre_acceptee_le || "", compromis_signe_le: a.compromis_signe_le || "", signature_prevue_le: a.signature_prevue_le || "", acte_signe_le: a.acte_signe_le || "",
      prix_signe: a.prix_signe ?? "", notaire: a.notaire || "", notaire_contact: a.notaire_contact || "",
      compromis_prevu_le: s.compromis_prevu_le || "", sequestre: s.sequestre ?? "", notaire_vendeur: s.notaire_vendeur || "", frais: s.frais ?? "",
      conditions: (Array.isArray(a.conditions_suspensives) ? a.conditions_suspensives : []).map((c) => ({ libelle: c?.libelle || "", echeance: c?.echeance || "", levee_le: c?.levee_le || "", statut: statutCondition(c), type: c?.type || "" })) });
  }, [a?.id, a?.updated_at]);

  const creer = async () => {
    setOccupe(true); setErreur("");
    const r = await supabase.from("invest_dossier_acquisitions").insert({ dossier_id: fiche.dossier.id, client_id: client.id, libelle: m.synthR.retenu?.bien.adresse || "Bien retenu", bien_id: m.synthR.retenu?.bienId || null,
      offre_acceptee_le: aujourdhuiIso() }).select("id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    onMessage?.("Acquisition ouverte : offre acceptée."); recharger();
  };
  if (!a) {
    return (
      <Bloc T={T} titre="Acquisition">
        <Pipeline T={T} etapes={m.progression.etapes} />
        <div style={{ marginTop: 10 }}>
          {offreOk
            ? <EtatVide T={T} titre="Offre acceptée : l'acquisition n'est pas encore ouverte" texte="Ouvrez le suivi pour saisir le compromis, les conditions suspensives et l'acte." action={modifiable && <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={creer}>Passer à l'acquisition</button>} />
            : <EtatVide T={T} titre="Aucune acquisition suivie" texte="Elle s'ouvre lorsque l'offre est acceptée." />}
          {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
        </div>
      </Bloc>
    );
  }
  if (!f) return null;
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const majCond = (i, patch) => setF((x) => ({ ...x, conditions: x.conditions.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const changerStatut = (i, statut) => majCond(i, { statut, levee_le: statut === "levee" ? (f.conditions[i].levee_le || aujourdhuiIso()) : "" });
  const ligne = () => ({
    ...Object.fromEntries(["offre_acceptee_le", "compromis_signe_le", "signature_prevue_le", "acte_signe_le"].map((k) => [k, f[k] || null])),
    prix_signe: f.prix_signe === "" ? null : nombreOuNull(f.prix_signe), notaire: f.notaire.trim() || null, notaire_contact: f.notaire_contact.trim() || null,
    conditions_suspensives: nettoyerConditions(f.conditions.map((c) => ({ ...c, statut: c.statut === "a_verifier" && !c.levee_le ? "" : c.statut, type: c.type }))),
  });
  const enregistrer = async () => {
    setErreur("");
    const patch = ligne();
    const verif = erreursAcquisition({ ...a, ...patch, prix_signe: patch.prix_signe ?? "" });
    if (verif.length) { setErreur(verif.join(" ")); return; }
    if (suiviOk) patch.suivi = { ...(a.suivi || {}), compromis_prevu_le: f.compromis_prevu_le || null, sequestre: f.sequestre === "" ? null : nombreOuNull(f.sequestre), notaire_vendeur: f.notaire_vendeur.trim() || null, frais: f.frais === "" ? null : nombreOuNull(f.frais) };
    patch.updated_at = new Date().toISOString();
    setOccupe(true);
    const r = await supabase.from("invest_dossier_acquisitions").update(patch).eq("id", a.id).select("id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Enregistrement refusé : droits insuffisants."); return; }
    onMessage?.("Acquisition enregistrée."); recharger();
  };
  const cond = etatConditions(a.conditions_suspensives, aujourdhuiIso());
  const dis = !modifiable;
  const Sec = ({ titre, children }) => (<div style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, paddingTop: 8, marginTop: 8 }}><div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textSub, marginBottom: 6 }}>{titre}</div>{children}</div>);
  const grille = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 };
  return (
    <Bloc T={T} titre={`Acquisition · ${a.libelle || "bien"}`} action={m.progression.courante && <Pastille couleur={COULEURS.cours}>En cours : {m.progression.courante}</Pastille>}>
      <Pipeline T={T} etapes={m.progression.etapes} />
      <Sec titre="Offre acceptée"><div style={grille}><Champ T={T} libelle="Date d'acceptation"><input className="inv-inp" type="date" disabled={dis} value={f.offre_acceptee_le} onChange={maj("offre_acceptee_le")} /></Champ></div></Sec>
      <Sec titre="Compromis">
        <div style={grille}>
          {suiviOk && <Champ T={T} libelle="Date prévue"><input className="inv-inp" type="date" disabled={dis} value={f.compromis_prevu_le} onChange={maj("compromis_prevu_le")} /></Champ>}
          <Champ T={T} libelle="Date signée"><input className="inv-inp" type="date" disabled={dis} value={f.compromis_signe_le} onChange={maj("compromis_signe_le")} /></Champ>
          <Champ T={T} libelle="Prix définitif (€)"><input className="inv-inp" inputMode="decimal" disabled={dis} value={f.prix_signe} onChange={maj("prix_signe")} placeholder="Non renseigné" /></Champ>
          {suiviOk && <Champ T={T} libelle="Dépôt / séquestre (€)"><input className="inv-inp" inputMode="decimal" disabled={dis} value={f.sequestre} onChange={maj("sequestre")} placeholder="Non suivi" /></Champ>}
          <Champ T={T} libelle="Notaire acquéreur"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.notaire} onChange={maj("notaire")} /></Champ>
          <Champ T={T} libelle="Contact notaire"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.notaire_contact} onChange={maj("notaire_contact")} /></Champ>
          {suiviOk && <Champ T={T} libelle="Notaire vendeur"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.notaire_vendeur} onChange={maj("notaire_vendeur")} /></Champ>}
        </div>
        {!suiviOk && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 6 }}>Date prévue du compromis, séquestre, notaire vendeur et frais : à connecter (évolution de la base en attente).</div>}
      </Sec>
      <Sec titre={`Conditions suspensives${f.conditions.length ? ` · ${cond.levees} / ${cond.total} levée${cond.levees > 1 ? "s" : ""}` : ""}`}>
        {f.conditions.length === 0 && <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucune condition suspensive suivie.</div>}
        {f.conditions.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1.5fr) 125px 150px auto", gap: 6, alignItems: "center", marginTop: 5 }}>
            <select className="inv-sel" aria-label="Type" disabled={dis} value={c.type} onChange={(e) => majCond(i, { type: e.target.value })}><option value="">Type…</option>{TYPES_CONDITION.map((t) => <option key={t}>{t}</option>)}</select>
            <input className="inv-inp" style={{ textAlign: "left" }} aria-label="Condition" placeholder="Intitulé de la condition" disabled={dis} value={c.libelle} onChange={(e) => majCond(i, { libelle: e.target.value })} />
            <input className="inv-inp" type="date" aria-label="Échéance" disabled={dis} value={c.echeance} onChange={(e) => majCond(i, { echeance: e.target.value })} />
            <select className="inv-sel" aria-label="Statut" disabled={dis} value={c.statut} onChange={(e) => changerStatut(i, e.target.value)} style={{ color: COULEUR_COND[c.statut], fontWeight: 800 }}>
              {Object.entries(STATUTS_CONDITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {!dis && <button type="button" className="inv-btn inv-btn-sm" title="Retirer" onClick={() => setF((x) => ({ ...x, conditions: x.conditions.filter((_, k) => k !== i) }))}>✕</button>}
          </div>
        ))}
        {!dis && f.conditions.length < MAX_CONDITIONS && <button className="inv-btn inv-btn-sm" style={{ marginTop: 8 }} onClick={() => setF((x) => ({ ...x, conditions: [...x.conditions, { libelle: "", echeance: "", levee_le: "", statut: "a_verifier", type: "" }] }))}>＋ Ajouter une condition</button>}
        {m.progression.aucuneCondition && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 6 }}>Compromis signé sans condition suspensive : l'acte peut être programmé.</div>}
      </Sec>
      <Sec titre="Acte authentique">
        <div style={grille}>
          <Champ T={T} libelle="Date prévisionnelle"><input className="inv-inp" type="date" disabled={dis} value={f.signature_prevue_le} onChange={maj("signature_prevue_le")} /></Champ>
          <Champ T={T} libelle="Date réelle"><input className="inv-inp" type="date" disabled={dis} value={f.acte_signe_le} onChange={maj("acte_signe_le")} /></Champ>
          {suiviOk && <Champ T={T} libelle="Frais d'acquisition (€)"><input className="inv-inp" inputMode="decimal" disabled={dis} value={f.frais} onChange={maj("frais")} placeholder="Non renseigné" /></Champ>}
          <div style={{ alignSelf: "end" }}>{a.acte_signe_le ? <Pastille couleur={COULEURS.termine}>✓ Acte signé le {dateFr(a.acte_signe_le)}</Pastille> : <Pastille couleur={COULEURS.avenir}>Acte non signé</Pastille>}</div>
        </div>
      </Sec>
      {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 8 }}>{erreur}</div>}
      {modifiable && <div style={{ marginTop: 10 }}><button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={enregistrer}>Enregistrer l'acquisition</button></div>}
    </Bloc>
  );
}

export default function MissionOffreAcquisition(props) {
  const { T, fiche, client, profil, modifiable } = props;
  return (
    <>
      <Offre {...props} />
      <Acquisition {...props} />
      <details style={{ marginTop: 2 }}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 800, color: T.textSub }}>Vue détaillée des acquisitions (jalons, travaux, plusieurs biens)</summary>
        <div style={{ marginTop: 8 }}><AcquisitionMission T={T} fiche={fiche} client={client} dossier={fiche.dossier} profil={profil} modifiable={modifiable} /></div>
      </details>
    </>
  );
}
