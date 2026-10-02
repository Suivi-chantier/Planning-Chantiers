// src/Invest/dossiers/AnalyseMission.jsx — onglet Analyse de la fiche Mission.
//
// Trois blocs : la situation actuelle du foyer (chiffres déjà saisis dans la Situation patrimoniale),
// la capacité d'investissement INDICATIVE (hypothèses modifiables) comparée au budget du Projet, et la
// lecture de l'analyste (points forts, vigilance, conclusion) à enregistrer puis à valider.
// Les chiffres viennent de calculAnalyse.mjs, jamais recalculés ici. Valider fige les chiffres du moment ;
// si la situation change ensuite, l'écran le signale. L'étape « Analyse » du parcours n'est pas modifiée.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  HYPOTHESES_DEFAUT, LIBELLES_HYPOTHESES, LIBELLES_VERDICT, validerHypotheses, calculerAnalyse, chiffresPourValidation, ecartsDepuisValidation,
} from "./calculAnalyse";

const eur = (v) => (v == null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR"); };
const VERT = "#16a34a", ORANGE = "#d97706", ROUGE = "#dc2626";
const TEXTES = [["points_forts", "Points forts"], ["points_vigilance", "Points de vigilance"], ["conclusion", "Conclusion de l'analyste"]];

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
      <div style={{ fontSize: fort ? 17 : 14, fontWeight: 900, color: couleur || T.text, overflow: "hidden", textOverflow: "ellipsis" }}>{valeur}</div>
    </div>
  );
}

export default function AnalyseMission({ T, fiche, client, dossier, profil, modifiable, onOuvrirEtape, onOnglet }) {
  const [ligne, setLigne] = useState(undefined);              // undefined = chargement ; null = aucune analyse enregistrée
  const [erreurLecture, setErreurLecture] = useState("");
  const [hyp, setHyp] = useState({ tauxPct: "", dureeAns: "", endettementMaxPct: "" });
  const [textes, setTextes] = useState({ points_forts: "", points_vigilance: "", conclusion: "" });
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const auteur = profil?.nom || profil?.email || null;

  const charger = useCallback(async () => {
    const r = await supabase.from("invest_dossier_analyses").select("*").eq("dossier_id", dossier.id).maybeSingle();
    if (r.error) { setErreurLecture(r.error.message); setLigne(null); return; }
    setErreurLecture(""); setLigne(r.data || null);
    const h = r.data?.hypotheses || {};
    setHyp({ tauxPct: h.tauxPct ?? "", dureeAns: h.dureeAns ?? "", endettementMaxPct: h.endettementMaxPct ?? "" });
    setTextes({ points_forts: r.data?.points_forts || "", points_vigilance: r.data?.points_vigilance || "", conclusion: r.data?.conclusion || "" });
    setModifie(false);
  }, [dossier.id]);
  useEffect(() => { charger(); }, [charger]);

  const { valides, erreurs } = useMemo(() => validerHypotheses(hyp), [hyp]);
  const analyse = useMemo(() => calculerAnalyse({ situation: fiche.situation, projet: fiche.projet, hypotheses: valides }), [fiche.situation, fiche.projet, valides]);
  const valide = ligne?.statut === "validee";
  const ecarts = valide ? ecartsDepuisValidation(ligne.chiffres_valides, analyse) : [];
  const etapeAnalyse = fiche.parcours.find((e) => e.cle === "analyse");
  const situationVide = Object.values(fiche.situation.lignes || {}).every((n) => n === 0);
  const peutEditer = modifiable && !valide;

  const enregistrer = async (extra = {}, confirmation = "Analyse enregistrée.") => {
    if (erreurs.length) { setErreur(`Hypothèses à corriger : ${erreurs.join(" ")}`); return; }
    setOccupe(true); setErreur(""); setMessage("");
    const hypotheses = Object.fromEntries(Object.entries(valides));
    const champs = { dossier_id: dossier.id, client_id: client.id, hypotheses, points_forts: textes.points_forts.trim() || null, points_vigilance: textes.points_vigilance.trim() || null,
      conclusion: textes.conclusion.trim() || null, updated_by: auteur, updated_at: new Date().toISOString(), ...extra };
    const r = await supabase.from("invest_dossier_analyses").upsert(champs, { onConflict: "dossier_id" }).select("dossier_id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Enregistrement refusé : droits insuffisants."); return; }
    setMessage(confirmation); await charger();
  };
  const validerAnalyse = () => {
    if (!textes.conclusion.trim()) { setErreur("La conclusion est obligatoire pour valider l'analyse."); return; }
    if (!window.confirm("Valider cette analyse ?\n\nLes chiffres du moment sont figés. Si la situation du foyer change ensuite, l'écran vous le signalera.")) return;
    enregistrer({ statut: "validee", valide_le: new Date().toISOString(), valide_par: auteur, chiffres_valides: chiffresPourValidation(analyse) }, "Analyse validée.");
  };
  const rouvrir = () => {
    if (!window.confirm("Rouvrir l'analyse en brouillon ?\n\nLa validation et les chiffres figés seront retirés.")) return;
    enregistrer({ statut: "brouillon", valide_le: null, valide_par: null, chiffres_valides: null }, "Analyse rouverte en brouillon.");
  };

  const c = analyse.capacite, b = analyse.budget;
  const couleurVerdict = b.verdict === "compatible" ? VERT : b.verdict === "au_dessus" ? ROUGE : T.textMuted;
  const champ = (cle) => (
    <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11.5, color: T.textSub, fontWeight: 700 }}>{LIBELLES_HYPOTHESES[cle]}
      <input className="inv-inp" inputMode="decimal" style={{ width: 110, textAlign: "right" }} value={hyp[cle]} placeholder={String(HYPOTHESES_DEFAUT[cle])} disabled={!peutEditer}
        onChange={(e) => { setHyp((x) => ({ ...x, [cle]: e.target.value })); setModifie(true); }} />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {message && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: T.accentBg, color: T.text }}>{message}</div>}
      {erreur && <div style={{ fontSize: 12.5, color: ROUGE }}>{erreur}</div>}
      {erreurLecture && <div style={{ fontSize: 12.5, color: ROUGE }}>Analyse enregistrée illisible : {erreurLecture}. Les chiffres ci-dessous restent calculés.</div>}
      {valide && ecarts.length > 0 && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: `${ORANGE}18`, color: T.text, border: `1px solid ${ORANGE}55` }}>
        <b style={{ color: ORANGE }}>Les chiffres ont changé depuis la validation</b> ({ecarts.join(", ")}). Relisez l'analyse, puis rouvrez-la pour la valider de nouveau.</div>}

      <Carte T={T} titre="Situation actuelle du foyer" droite={
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: T.textMuted }}>
          {etapeAnalyse && <span>Étape Analyse : <b style={{ color: T.text }}>{etapeAnalyse.statutLibelle}</b></span>}
          {etapeAnalyse?.present && <button className="inv-btn inv-btn-sm" onClick={() => onOuvrirEtape("analyse")}>Ouvrir l'étape</button>}
        </div>}>
        {situationVide ? (
          <div style={{ fontSize: 13, color: T.textMuted }}>La Situation patrimoniale n'est pas renseignée : l'analyse ne peut rien chiffrer. <button className="inv-btn inv-btn-sm" style={{ marginLeft: 8 }} onClick={() => onOnglet("situation")}>Renseigner la situation</button></div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
              <Chiffre T={T} libelle="Revenus mensuels" valeur={eur(analyse.revenus)} fort />
              <Chiffre T={T} libelle="Charges mensuelles" valeur={eur(analyse.charges)} />
              <Chiffre T={T} libelle="Crédits en cours (mensualités + assurances)" valeur={eur(analyse.creditsEnCours)} />
              <Chiffre T={T} libelle="Reste mensuel après charges et crédits" valeur={analyse.resteMensuel === null ? "Non évaluable" : eur(analyse.resteMensuel)} couleur={analyse.resteMensuel !== null && analyse.resteMensuel < 0 ? ROUGE : undefined} fort />
              <Chiffre T={T} libelle="Taux d'endettement actuel" valeur={analyse.tauxEndettementPct === null ? "Non évaluable" : `${String(analyse.tauxEndettementPct).replace(".", ",")} %`} couleur={analyse.tauxEndettementPct !== null && analyse.tauxEndettementPct > analyse.hypotheses.endettementMaxPct ? ROUGE : undefined} fort />
              <Chiffre T={T} libelle="Épargne disponible" valeur={eur(analyse.epargneDisponible)} />
              <Chiffre T={T} libelle="Patrimoine net simplifié" valeur={eur(analyse.patrimoineNet)} />
            </div>
            {analyse.avertissements.map((a) => <div key={a} style={{ fontSize: 11.5, color: ORANGE, marginTop: 6 }}>⚠ {a}</div>)}
          </>
        )}
      </Carte>

      <Carte T={T} titre="Capacité d'investissement (indicative)" droite={<span style={{ fontSize: 11.5, color: T.textMuted }}>Hors frais de notaire, garanties et revenus locatifs futurs</span>}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          {["tauxPct", "dureeAns", "endettementMaxPct"].map(champ)}
          <span style={{ fontSize: 11.5, color: T.textMuted, paddingBottom: 6 }}>Valeurs par défaut si vide : {HYPOTHESES_DEFAUT.tauxPct} % · {HYPOTHESES_DEFAUT.dureeAns} ans · {HYPOTHESES_DEFAUT.endettementMaxPct} %</span>
        </div>
        {erreurs.length > 0 && <div style={{ fontSize: 12, color: ROUGE, marginBottom: 8 }}>{erreurs.join(" ")} Les valeurs par défaut sont utilisées en attendant.</div>}
        {!c.calculable ? <div style={{ fontSize: 13, color: T.textMuted }}>{c.raison}</div> : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
              <Chiffre T={T} libelle="Mensualité maximale supportable" valeur={`${eur(c.mensualiteMax)} /mois`} />
              <Chiffre T={T} libelle="Capital empruntable" valeur={eur(c.capitalEmpruntable)} />
              <Chiffre T={T} libelle="Apport souhaité (Projet)" valeur={c.apport === null ? "Non renseigné" : eur(c.apport)} />
              <Chiffre T={T} libelle="Capacité d'achat indicative" valeur={eur(c.capaciteAchat)} fort />
              <Chiffre T={T} libelle="Budget visé (Projet)" valeur={b.renseigne ? eur(b.valeur) : "Non renseigné"} />
            </div>
            <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 800, color: couleurVerdict }}>
              {LIBELLES_VERDICT[b.verdict]}{b.renseigne && ` : ${b.ecart >= 0 ? "marge de" : "manque"} ${eur(Math.abs(b.ecart))}`}
            </div>
            {c.apport === null && <div style={{ fontSize: 11.5, color: ORANGE, marginTop: 4 }}>⚠ Apport non renseigné dans le Projet : la capacité d'achat se limite au capital empruntable.</div>}
            {!b.renseigne && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 4 }}>Renseignez le budget dans le Projet pour le comparer à la capacité. <button className="inv-btn inv-btn-sm" style={{ marginLeft: 6 }} onClick={() => onOnglet("projet")}>Ouvrir le Projet</button></div>}
          </>
        )}
      </Carte>

      <Carte T={T} titre="Lecture de l'analyste" droite={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textMuted }}>
          {valide ? <span style={{ color: VERT, fontWeight: 800 }}>✓ Validée le {dateFr(ligne.valide_le)}{ligne.valide_par ? ` par ${ligne.valide_par}` : ""}</span> : <span>{ligne ? "Brouillon" : "Pas encore enregistrée"}</span>}
        </div>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
          {TEXTES.map(([cle, libelle]) => (
            <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub }}><span>{libelle}{cle === "conclusion" && <span style={{ color: ORANGE }}> *</span>}</span>
              <textarea className="inv-textarea" rows={5} value={textes[cle]} disabled={!peutEditer} onChange={(e) => { setTextes((x) => ({ ...x, [cle]: e.target.value })); setModifie(true); }} style={{ resize: "vertical", fontWeight: 500 }} />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          {peutEditer && <button className="inv-btn inv-btn-blue" disabled={occupe || !modifie} onClick={() => enregistrer()}>Enregistrer</button>}
          {peutEditer && ligne && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={validerAnalyse} title="Fige les chiffres du moment">Valider l'analyse</button>}
          {modifiable && valide && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={rouvrir}>Rouvrir en brouillon</button>}
          {modifie && <span style={{ fontSize: 11.5, color: ORANGE, fontWeight: 700 }}>Modifications non enregistrées</span>}
          {peutEditer && !ligne && <span style={{ fontSize: 11.5, color: T.textMuted }}>Enregistrez d'abord pour pouvoir valider.</span>}
          {!modifiable && <span style={{ fontSize: 12, color: T.textMuted }}>Mission close : consultation seule.</span>}
        </div>
      </Carte>
    </div>
  );
}
