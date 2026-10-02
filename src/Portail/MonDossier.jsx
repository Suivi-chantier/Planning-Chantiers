// src/Portail/MonDossier.jsx — « Mes informations » : le client renseigne et corrige ses données (espace client).
//
// Le client n'écrit PAS dans le dossier : sa saisie est enregistrée en brouillon, puis envoyée à son conseiller,
// qui la vérifie avant de l'intégrer (migration 20261002180000). L'écran passe uniquement par
// portail_enregistrer_reponse / portail_reponses / portail_donnees_dossier / portail_maj_telephone.
// Il n'importe aucun module du bureau (le client ne reçoit pas le code de l'application collaborateurs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { SECTIONS, SCHEMA, avancementClient } from "./portailChamps";

const C = { texte: "#111827", doux: "#667085", bord: "rgba(15,23,42,.12)", or: "#d6a84c", vert: "#16a34a", bleu: "#2563eb", ambre: "#b45309", rouge: "#b91c1c", marine: "#071426" };
const CSS = `
  .md-grille{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .md-champ label{display:block;font-size:13px;font-weight:700;margin-bottom:5px}
  .md-champ .pc-input{min-height:44px}
  .md-unite{color:${C.doux};font-weight:500}
  .md-liste-item{border:1px solid ${C.bord};border-radius:12px;padding:12px;margin-top:10px}
  .md-onglets{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .md-onglet{flex:1 0 150px;text-align:left;font:inherit;border:1px solid ${C.bord};border-radius:12px;background:#fff;padding:10px 12px;cursor:pointer}
  .md-onglet[aria-selected="true"]{border-color:${C.or};background:#fff8e6}
`;
const STATUT = {
  vide: { t: "À compléter", c: C.doux }, brouillon: { t: "Brouillon enregistré", c: C.ambre },
  soumis: { t: "Envoyé à votre conseiller", c: C.bleu }, valide: { t: "Pris en compte", c: C.vert }, refuse: { t: "À revoir avec votre conseiller", c: C.rouge },
};
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");

function Champ({ def, valeur, onChange, id }) {
  const lib = <>{def.l}{def.u ? <span className="md-unite"> ({def.u})</span> : null}</>;
  if (def.t === "bool") {
    return <div className="md-champ" style={{ gridColumn: "1 / -1" }}><label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
      <input type="checkbox" checked={valeur === true} onChange={(e) => onChange(e.target.checked)} />{def.l}</label></div>;
  }
  if (def.t === "enum") {
    return <div className="md-champ"><label htmlFor={id}>{lib}</label>
      <select id={id} className="pc-input" value={valeur ?? ""} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{def.o.map((o) => <option key={o}>{o}</option>)}</select></div>;
  }
  const type = def.t === "date" ? "date" : "text";
  return <div className="md-champ"><label htmlFor={id}>{lib}</label>
    <input id={id} className="pc-input" type={type} inputMode={def.t === "num" ? "decimal" : undefined} value={valeur ?? ""} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Section({ cle, valeurs, setValeurs, desactive }) {
  const sch = SCHEMA[cle];
  const maj = (k, v) => setValeurs({ ...valeurs, [k]: v });
  const majItem = (liste, i, k, v) => setValeurs({ ...valeurs, [liste]: valeurs[liste].map((it, j) => (j === i ? { ...it, [k]: v } : it)) });
  return (
    <fieldset disabled={desactive} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="md-grille">
        {Object.entries(sch.champs).map(([k, def]) => <Champ key={k} id={`md-${cle}-${k}`} def={def} valeur={valeurs[k]} onChange={(v) => maj(k, v)} />)}
      </div>
      {Object.entries(sch.listes).map(([liste, l]) => {
        const items = Array.isArray(valeurs[liste]) ? valeurs[liste] : [];
        return (
          <div key={liste} style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800 }}>{l.l}</div>
            {items.map((it, i) => (
              <div key={i} className="md-liste-item">
                <div className="md-grille">{Object.entries(l.champs).map(([k, def]) => <Champ key={k} id={`md-${cle}-${liste}-${i}-${k}`} def={def} valeur={it[k]} onChange={(v) => majItem(liste, i, k, v)} />)}</div>
                <button type="button" className="pc-btn" style={{ marginTop: 10, minHeight: 36, padding: "5px 11px", fontSize: 13 }} onClick={() => setValeurs({ ...valeurs, [liste]: items.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            ))}
            {items.length < l.max && <button type="button" className="pc-btn" style={{ marginTop: 10 }} onClick={() => setValeurs({ ...valeurs, [liste]: [...items, {}] })}>{l.ajout}</button>}
          </div>
        );
      })}
    </fieldset>
  );
}

export default function MonDossier({ telephoneActuel }) {
  const [etat, setEtat] = useState("chargement");               // chargement | pret | erreur
  const [reponses, setReponses] = useState({});                  // section -> { statut, donnees, soumis_le, ... }
  const [connu, setConnu] = useState({});                        // valeurs déjà connues de Profero
  const [valeurs, setValeurs] = useState({});                    // section -> valeurs en cours de saisie
  const [ouverte, setOuverte] = useState(SECTIONS[0].cle);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [tel, setTel] = useState(telephoneActuel || "");
  const [messageTel, setMessageTel] = useState("");

  const charger = useCallback(async () => {
    const [r, d] = await Promise.all([
      supabase.from("portail_reponses").select("section,statut,donnees,soumis_le,traite_le,note_traitement,modifie_le"),
      supabase.rpc("portail_donnees_dossier"),
    ]);
    if (r.error || d.error) { setEtat("erreur"); return; }
    const rep = Object.fromEntries((r.data || []).map((x) => [x.section, x]));
    const dos = d.data || {};
    setReponses(rep); setConnu(dos);
    setValeurs(Object.fromEntries(SECTIONS.map((s) => [s.cle, { ...(dos[s.cle] || {}), ...(rep[s.cle]?.donnees || {}) }])));
    setEtat("pret");
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const progression = useMemo(() => avancementClient(reponses), [reponses]);
  const enregistrer = async (soumettre) => {
    setOccupe(true); setErreur(""); setMessage("");
    const { error } = await supabase.rpc("portail_enregistrer_reponse", { p_section: ouverte, p_donnees: valeurs[ouverte] || {}, p_soumettre: soumettre });
    setOccupe(false);
    if (error) { setErreur("Votre saisie n'a pas pu être enregistrée. Réessayez dans un instant ou contactez votre conseiller."); return; }
    setMessage(soumettre ? "Merci ! Votre conseiller vérifie ces informations et les intègre à votre dossier." : "Brouillon enregistré. Vous pouvez poursuivre plus tard.");
    await charger();
  };
  const majTel = async () => {
    setMessageTel("");
    const { error } = await supabase.rpc("portail_maj_telephone", { p_telephone: tel });
    setMessageTel(error ? "Numéro invalide : utilisez des chiffres, des espaces et le signe +." : "Numéro enregistré.");
  };

  if (etat === "chargement") return <div style={{ color: C.doux }}>Chargement de vos informations…</div>;
  if (etat === "erreur") return <div role="alert" style={{ color: C.rouge }}>Impossible d'afficher vos informations pour le moment. Réessayez plus tard ou contactez votre conseiller.</div>;
  const sec = SECTIONS.find((s) => s.cle === ouverte);
  const st = reponses[ouverte]?.statut || "vide";
  return (
    <div>
      <style>{CSS}</style>
      <p style={{ margin: "0 0 12px", color: C.doux, fontSize: 14 }}>
        Renseignez ou corrigez vos informations à votre rythme, par grandes parties. Des montants approximatifs suffisent pour commencer. Ce que vous envoyez est vérifié par votre conseiller avant d'être intégré à votre dossier.
        {" "}<strong>{progression.envoyees} partie{progression.envoyees > 1 ? "s" : ""} sur {progression.total} envoyée{progression.envoyees > 1 ? "s" : ""}.</strong>
      </p>
      <div className="md-onglets" role="tablist">
        {progression.parSection.map((s) => (
          <button key={s.cle} role="tab" aria-selected={s.cle === ouverte} className="md-onglet" onClick={() => { setOuverte(s.cle); setMessage(""); setErreur(""); }}>
            <div style={{ fontWeight: 800 }}>{s.libelle}</div>
            <div style={{ fontSize: 12, color: (STATUT[s.statut] || STATUT.vide).c, fontWeight: 700 }}>{(STATUT[s.statut] || STATUT.vide).t}</div>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{sec.libelle}</div>
        <div style={{ color: C.doux, fontSize: 14, margin: "2px 0 12px" }}>{sec.intro}</div>
        {st === "soumis" && <div style={{ color: C.bleu, fontSize: 14, marginBottom: 10 }}>Envoyé le {dateFr(reponses[ouverte].soumis_le)} : en attente de la vérification de votre conseiller. Vous pouvez encore corriger puis renvoyer.</div>}
        {st === "valide" && <div style={{ color: C.vert, fontSize: 14, marginBottom: 10 }}>Ces informations ont été prises en compte{reponses[ouverte].traite_le ? ` le ${dateFr(reponses[ouverte].traite_le)}` : ""}. Vous pouvez les corriger si besoin.</div>}
        {st === "refuse" && <div style={{ color: C.rouge, fontSize: 14, marginBottom: 10 }}>Votre conseiller souhaite revenir avec vous sur cette partie{reponses[ouverte].note_traitement ? ` : « ${reponses[ouverte].note_traitement} »` : "."}</div>}
        <Section cle={ouverte} valeurs={valeurs[ouverte] || {}} setValeurs={(v) => setValeurs({ ...valeurs, [ouverte]: v })} desactive={occupe} />
        {erreur && <div role="alert" style={{ color: C.rouge, marginTop: 12 }}>{erreur}</div>}
        {message && <div role="status" style={{ color: C.vert, marginTop: 12 }}>{message}</div>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <button className="pc-btn" disabled={occupe} onClick={() => enregistrer(false)}>Enregistrer le brouillon</button>
          <button className="pc-btn pc-btn-or" disabled={occupe} onClick={() => enregistrer(true)}>Envoyer à mon conseiller</button>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${C.bord}`, marginTop: 18, paddingTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Votre téléphone</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="pc-input" style={{ maxWidth: 260 }} inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} aria-label="Votre numéro de téléphone" />
          <button className="pc-btn" onClick={majTel}>Enregistrer</button>
          {messageTel && <span role="status" style={{ color: messageTel.startsWith("Numéro invalide") ? C.rouge : C.vert, fontSize: 14 }}>{messageTel}</span>}
        </div>
        <div style={{ color: C.doux, fontSize: 13, marginTop: 6 }}>Pour changer votre adresse e-mail (votre identifiant de connexion), contactez votre conseiller.</div>
      </div>
    </div>
  );
}
