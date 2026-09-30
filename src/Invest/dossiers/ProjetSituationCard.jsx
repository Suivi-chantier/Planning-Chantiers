// src/Invest/dossiers/ProjetSituationCard.jsx — « Projet & situation » du
// Dossier Invest (Chantier 1.1, Tranche 2d) : contexte, situation et objectifs
// du DOSSIER (≠ Situation patrimoniale du foyer, 2c).
//
// Sections progressives, questions conditionnelles (catalogue
// questionnaireDossier.mjs), sauvegarde par section, vérification réponse par
// réponse, soumission et validation. Les écritures passent par les fonctions
// invest_questionnaire_* : la base pose provenance, dates et vérificateur, et
// refuse toute modification d'un dossier clos.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  SECTIONS_QUESTIONNAIRE, QUESTIONNAIRE_VERSION, STATUTS_QUESTIONNAIRE, VERIFICATIONS, SOURCES,
  valeurDe, questionsVisibles, progression, reponsesModifiees, syntheseObjectifs, libelleValeur, estRepondue,
} from "./questionnaireDossier";

const COULEUR = { non_verifiee: "#64748b", verifiee: "#16a34a", a_corriger: "#dc2626" };
const COULEUR_STATUT = { brouillon: "#64748b", soumis: "#2563eb", a_verifier: "#d97706", valide: "#16a34a" };
const eur = (v) => (v == null || v === "" ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

export default function ProjetSituationCard({ T, dossierId = null, dossierEnCoursId = null }) {
  const [dossier, setDossier] = useState(null);
  const [etat, setEtat] = useState({ chargement: false, erreur: "", absent: false });
  const [ouverte, setOuverte] = useState(null);
  const [saisie, setSaisie] = useState({});
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);

  const charger = useCallback(async () => {
    if (!dossierId) { setDossier(null); return; }
    setEtat((e) => ({ ...e, chargement: true }));
    const { data, error } = await supabase.from("invest_dossiers")
      .select("id,reference,statut,questionnaire_version,questionnaire_data,questionnaire_statut,questionnaire_modifie_le,questionnaire_soumis_le,questionnaire_valide_le,questionnaire_valide_par_id")
      .eq("id", dossierId).maybeSingle();
    if (error) {
      const absent = error.code === "42703" || /questionnaire_/.test(error.message || "");
      setEtat({ chargement: false, erreur: absent ? "" : error.message, absent });
      return;
    }
    setDossier(data); setEtat({ chargement: false, erreur: "", absent: false });
  }, [dossierId]);
  useEffect(() => { charger(); setOuverte(null); setSaisie({}); setMessage(""); }, [charger]);

  const r = dossier?.questionnaire_data || {};
  const modifiable = !!dossier && dossier.id === dossierEnCoursId && !["clos", "abandonne"].includes(dossier.statut);
  const prog = useMemo(() => progression(r), [r]);
  const syn = useMemo(() => syntheseObjectifs(r), [r]);

  const rpc = async (nom, params, succes) => {
    setEnCours(true); setMessage("");
    const { error } = await supabase.rpc(nom, params);
    setEnCours(false);
    if (error) { setMessage(`Refusé : ${error.message}`); return false; }
    setMessage(succes); await charger(); return true;
  };
  const enregistrerSection = async (section) => {
    let patch;
    try { patch = reponsesModifiees(r, saisie, "profero"); } catch (e) { setMessage(e.message); return; }
    if (!Object.keys(patch).length) { setMessage("Aucune modification dans cette section."); return; }
    if (await rpc("invest_questionnaire_enregistrer", { p_dossier_id: dossier.id, p_reponses: patch, p_version: QUESTIONNAIRE_VERSION },
      `${section.libelle} : ${Object.keys(patch).length} réponse(s) enregistrée(s).`)) setSaisie({});
  };
  const verifier = (cles, statut) => {
    let commentaire = null;
    if (statut === "a_corriger") {
      commentaire = window.prompt("Qu'est-ce qui est à corriger ?", "");
      if (commentaire === null || !commentaire.trim()) return;
    }
    rpc("invest_questionnaire_verifier", { p_dossier_id: dossier.id, p_cles: cles, p_statut: statut, p_commentaire: commentaire },
      statut === "verifiee" ? `${cles.length} réponse(s) vérifiée(s).` : "Réponse signalée à corriger.");
  };
  const changerStatut = (statut, libelle) => rpc("invest_questionnaire_statut", { p_dossier_id: dossier.id, p_statut: statut }, `Questionnaire ${libelle}.`);

  if (!dossierId) return null;
  if (etat.absent) {
    return <div className="inv-card"><div className="inv-card-hd">Projet & situation</div><div className="inv-card-bd" style={{ fontSize: 12, color: T.textMuted }}>Le questionnaire n'est pas encore installé sur cette base.</div></div>;
  }
  const qs = dossier?.questionnaire_statut || "brouillon";

  return (
    <div className="inv-card" id="projet-situation">
      <div className="inv-card-hd" style={{ justifyContent: "space-between" }}>
        <span>Projet & situation {dossier ? `· ${dossier.reference}` : ""}</span>
        <span style={{ fontSize: 10, fontWeight: 900, color: COULEUR_STATUT[qs], border: `1px solid ${COULEUR_STATUT[qs]}55`, borderRadius: 999, padding: "2px 8px" }}>{STATUTS_QUESTIONNAIRE[qs]}</span>
      </div>
      <div className="inv-card-bd" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 11.5, color: T.textMuted }}>
          Contexte, situation et objectifs de CE dossier. Les faits durables du foyer (personnes, revenus, crédits, biens, structures) sont dans la Situation patrimoniale.{" "}
          {!modifiable && <b style={{ color: "#b45309" }}>Lecture seule{dossier && ["clos", "abandonne"].includes(dossier.statut) ? " : dossier clos" : " : ce n'est pas le dossier en cours"}.</b>}
        </div>
        {etat.erreur && <div style={{ fontSize: 12, color: "#be123c" }}>⚠ {etat.erreur}</div>}
        {message && <div style={{ fontSize: 12, padding: "6px 9px", borderRadius: 8, background: T.accentBg, color: T.text }}>{message}</div>}

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: "8px 10px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 6 }}>
          {[["Budget", eur(syn.budget)], ["Apport souhaité", eur(syn.apport)], ["Zones", syn.zones || "—"], ["Objectif", syn.objectif || "—"], ["Horizon", syn.horizon || "—"]].map(([l, v]) => (
            <div key={l}><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 800, textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 13, fontWeight: 900, color: T.text }}>{v}</div></div>
          ))}
          <div style={{ gridColumn: "1 / -1", fontSize: 10.5, color: T.textMuted }}>L'apport souhaité est déclaratif ; il est distinct de l'épargne détenue (Situation patrimoniale). Aucune capacité d'emprunt n'est calculée ici.</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: T.text }}>
          <b>{prog.pourcentage} %</b> <span style={{ color: T.textMuted }}>({prog.repondues}/{prog.visibles} questions affichées)</span>
          {prog.aCorriger > 0 && <span style={{ color: "#dc2626" }}>{prog.aCorriger} à corriger</span>}
          {dossier?.questionnaire_soumis_le && <span style={{ color: T.textMuted }}>soumis le {dateFr(dossier.questionnaire_soumis_le)}</span>}
          {dossier?.questionnaire_valide_le && <span style={{ color: T.textMuted }}>validé le {dateFr(dossier.questionnaire_valide_le)}</span>}
          {modifiable && (qs === "brouillon") && <button className="inv-btn inv-btn-sm" onClick={() => changerStatut("soumis", "soumis")} disabled={enCours}>Soumettre</button>}
          {modifiable && qs !== "valide" && <button className="inv-btn inv-btn-sm inv-btn-blue" onClick={() => changerStatut("valide", "validé")} disabled={enCours || prog.aCorriger > 0}
            title={prog.aCorriger ? "Des réponses sont à corriger" : "Une correction ultérieure restera possible ; le questionnaire repassera « à vérifier »."}>Valider le questionnaire</button>}
        </div>

        {SECTIONS_QUESTIONNAIRE.map((s) => {
          const p = prog.sections.find((x) => x.cle === s.cle);
          const vus = questionsVisibles(s, { ...r, ...Object.fromEntries(Object.entries(saisie).map(([k, v]) => [k, { valeur: v }])) });
          const ouvert = ouverte === s.cle;
          const aVerifier = vus.filter((q) => estRepondue(valeurDe(r, q.cle)) && r[q.cle]?.verification !== "verifiee").map((q) => q.cle);
          return (
            <div key={s.cle} style={{ border: `1px solid ${ouvert ? T.accent : T.border}`, borderRadius: 12 }}>
              <button onClick={() => { setOuverte(ouvert ? null : s.cle); setSaisie({}); }} style={{ width: "100%", textAlign: "left", background: "transparent", border: 0, padding: "8px 10px", cursor: "pointer", color: T.text, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span><b>{s.lettre} — {s.libelle}</b></span>
                <span style={{ fontSize: 11, color: T.textMuted }}>{p.repondues}/{p.visibles}{p.verifiees ? ` · ${p.verifiees} vérifiée(s)` : ""}{p.aCorriger ? ` · ${p.aCorriger} à corriger` : ""}</span>
              </button>
              {ouvert && (
                <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
                  {s.aide && <div style={{ fontSize: 11, color: T.textMuted }}>{s.aide}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 8 }}>
                    {vus.map((q) => (
                      <Question key={q.cle} T={T} q={q} reponse={r[q.cle]} valeur={q.cle in saisie ? saisie[q.cle] : valeurDe(r, q.cle)}
                        modifiable={modifiable && !enCours} onChange={(v) => setSaisie((x) => ({ ...x, [q.cle]: v }))}
                        onVerifier={(st) => verifier([q.cle], st)} />
                    ))}
                  </div>
                  {modifiable && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => enregistrerSection(s)} disabled={enCours}>Enregistrer la section</button>
                      {aVerifier.length > 0 && <button className="inv-btn inv-btn-sm" onClick={() => verifier(aVerifier, "verifiee")} disabled={enCours}>Vérifier les {aVerifier.length} réponse(s)</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {prog.masqueesConservees > 0 && <div style={{ fontSize: 11, color: T.textMuted }}>{prog.masqueesConservees} réponse(s) conservée(s) mais masquée(s) par les réponses actuelles.</div>}
      </div>
    </div>
  );
}

function Question({ T, q, reponse, valeur, modifiable, onChange, onVerifier }) {
  const ver = reponse?.verification;
  const champ = () => {
    const dis = !modifiable;
    switch (q.type) {
      case "choix": return <select className="inv-sel" disabled={dis} value={valeur ?? ""} onChange={(e) => onChange(e.target.value || null)}><option value="">—</option>{Object.entries(q.options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>;
      case "choix_multiple": return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{Object.entries(q.options).map(([k, l]) => (
          <label key={k} style={{ fontSize: 11.5 }}><input type="checkbox" disabled={dis} checked={(valeur || []).includes(k)}
            onChange={(e) => onChange(e.target.checked ? [...(valeur || []), k] : (valeur || []).filter((x) => x !== k))} /> {l}</label>))}</div>);
      case "montant": case "pourcentage": return <input className="inv-inp" type="number" step="any" disabled={dis} value={valeur ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
      case "date": return <input className="inv-inp" type="date" disabled={dis} value={valeur ? String(valeur).slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || null)} />;
      case "texte_long": return <textarea className="inv-textarea" rows={2} disabled={dis} value={valeur ?? ""} onChange={(e) => onChange(e.target.value || null)} />;
      default: return <input className="inv-inp" disabled={dis} value={valeur ?? ""} onChange={(e) => onChange(e.target.value || null)} style={{ textAlign: "left" }} />;
    }
  };
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: "7px 9px", background: T.input }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6, fontSize: 11.5, fontWeight: 800, color: T.text }}>
        <span>{q.libelle}</span>
        {reponse && estRepondue(reponse.valeur) && <span style={{ fontSize: 9.5, fontWeight: 900, color: COULEUR[ver], whiteSpace: "nowrap" }}>{VERIFICATIONS[ver]}</span>}
      </div>
      {q.aide && <div style={{ fontSize: 10.5, color: T.textMuted }}>{q.aide}</div>}
      <div style={{ marginTop: 4 }}>{modifiable ? champ() : <div style={{ fontSize: 12.5 }}>{libelleValeur(q, valeur)}</div>}</div>
      {reponse && estRepondue(reponse.valeur) && (
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 3 }}>
          {SOURCES[reponse.source] || reponse.source}{reponse.modifie_le ? ` · ${dateFr(reponse.modifie_le)}` : ""}{reponse.verifie_le ? ` · vérifiée le ${dateFr(reponse.verifie_le)}` : ""}
          {ver === "a_corriger" && reponse.verification_commentaire && <span style={{ color: "#dc2626" }}> · à corriger : {reponse.verification_commentaire}</span>}
        </div>
      )}
      {modifiable && reponse && estRepondue(reponse.valeur) && (
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          {ver !== "verifiee" && <button className="inv-btn inv-btn-sm" style={{ padding: "1px 6px" }} onClick={() => onVerifier("verifiee")}>Vérifier</button>}
          <button className="inv-btn inv-btn-sm" style={{ padding: "1px 6px" }} onClick={() => onVerifier("a_corriger")}>À corriger</button>
        </div>
      )}
    </div>
  );
}
