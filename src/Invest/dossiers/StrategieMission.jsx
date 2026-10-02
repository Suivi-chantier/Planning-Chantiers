// src/Invest/dossiers/StrategieMission.jsx — onglet Stratégie de la fiche Mission.
//
// La stratégie se démontre avec des BLOCS que l'on active selon le client : objectifs, point de départ chiffré,
// scénarios comparés (1 à 4), cadre fiscal et juridique, risques, feuille de route, recommandation. Les chiffres
// de départ viennent de l'onglet Analyse (calculAnalyse.mjs), les indicateurs des scénarios de calculStrategie.mjs :
// rien n'est recalculé ici. Valider exige une recommandation et fige les chiffres du moment ; « présentée au
// client » est un geste explicite. Ni l'étape du parcours ni le Projet ne sont modifiés.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { calculerAnalyse, validerHypotheses, LIBELLES_VERDICT } from "./calculAnalyse";
import {
  BLOCS, BLOCS_PAR_DEFAUT, REGIMES, NIVEAUX_RISQUE, CHAMPS_SCENARIO, MAX_SCENARIOS, normaliserBlocs, erreursScenario, normaliserHypotheses,
  indicateursScenario, nettoyerRisques, nettoyerFeuilleRoute, chiffresPourValidation, ecartsDepuisValidation,
} from "./calculStrategie";

const eur = (v) => (v == null ? "Non évaluable" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const pctTxt = (v) => (v == null ? "Non évaluable" : `${String(v).replace(".", ",")} %`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const VERT = "#16a34a", ORANGE = "#d97706", ROUGE = "#dc2626";
const nouvelId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

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
const versSaisie = (h = {}) => Object.fromEntries(CHAMPS_SCENARIO.map(([cle]) => [cle, h[cle] ?? ""]));
const ligneDe = (r) => ({ id: r.id, ordre: r.ordre, libelle: r.libelle || "", description: r.description || "", hypotheses: versSaisie(r.hypotheses), avantages: r.avantages || "", inconvenients: r.inconvenients || "", recommande: !!r.recommande });

export default function StrategieMission({ T, fiche, client, dossier, profil, modifiable, onOnglet }) {
  const [chargement, setChargement] = useState(true);
  const [ligne, setLigne] = useState(null);                 // stratégie enregistrée (null = aucune)
  const [lecture, setLecture] = useState("");
  const [hypAnalyse, setHypAnalyse] = useState({});          // hypothèses de l'onglet Analyse (même chiffre, même source)
  const [analyseValidee, setAnalyseValidee] = useState(null);
  const [blocs, setBlocs] = useState([...BLOCS_PAR_DEFAUT]);
  const [messageCle, setMessageCle] = useState("");
  const [fiscal, setFiscal] = useState({ regime: "", detention: "", notes: "" });
  const [risques, setRisques] = useState([]);
  const [feuille, setFeuille] = useState([]);
  const [recommandation, setRecommandation] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [retires, setRetires] = useState([]);                // scénarios enregistrés à supprimer à l'enregistrement
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [datePresentation, setDatePresentation] = useState(aujourdhui());
  const auteur = profil?.nom || profil?.email || null;

  const charger = useCallback(async () => {
    const [rs, rc, ra] = await Promise.all([
      supabase.from("invest_dossier_strategies").select("*").eq("dossier_id", dossier.id).maybeSingle(),
      supabase.from("invest_dossier_scenarios").select("*").eq("dossier_id", dossier.id).order("ordre", { ascending: true }),
      supabase.from("invest_dossier_analyses").select("hypotheses,statut").eq("dossier_id", dossier.id).maybeSingle(),
    ]);
    const manques = [rs.error, rc.error].filter(Boolean).map((e) => e.message);
    setLecture(manques.join(" · "));
    const s = rs.data || null;
    setLigne(s); setHypAnalyse(ra.data?.hypotheses || {}); setAnalyseValidee(ra.data ? ra.data.statut === "validee" : null);
    setBlocs(normaliserBlocs(s ? s.blocs : BLOCS_PAR_DEFAUT));
    setMessageCle(s?.message_cle || ""); setFiscal({ regime: s?.fiscal?.regime || "", detention: s?.fiscal?.detention || "", notes: s?.fiscal?.notes || "" });
    setRisques(Array.isArray(s?.risques) ? s.risques : []); setFeuille(Array.isArray(s?.feuille_route) ? s.feuille_route : []);
    setRecommandation(s?.recommandation || "");
    setScenarios((rc.data || []).map(ligneDe)); setRetires([]); setModifie(false); setChargement(false);
  }, [dossier.id]);
  useEffect(() => { charger(); }, [charger]);

  const analyse = useMemo(() => calculerAnalyse({ situation: fiche.situation, projet: fiche.projet, hypotheses: validerHypotheses(hypAnalyse).valides }), [fiche.situation, fiche.projet, hypAnalyse]);
  const contexte = { mensualiteMax: analyse.capacite.calculable ? analyse.capacite.mensualiteMax : null, epargneDisponible: analyse.epargneDisponible };
  const indicateurs = useMemo(() => Object.fromEntries(scenarios.map((s) => [s.id, indicateursScenario(s.hypotheses, contexte)])), [scenarios, analyse]); // eslint-disable-line react-hooks/exhaustive-deps
  const scenariosPourChiffres = scenarios.map((s) => ({ id: s.id, libelle: s.libelle, recommande: s.recommande }));
  const courant = chiffresPourValidation({ analyse, scenarios: scenariosPourChiffres, indicateurs });
  const valide = ligne?.statut === "validee";
  const ecarts = valide ? ecartsDepuisValidation(ligne.chiffres_valides, courant) : [];
  const peutEditer = modifiable && !valide;
  const actif = (cle) => blocs.includes(cle);
  const touche = (f) => (...a) => { f(...a); setModifie(true); };

  const basculerBloc = (cle) => touche(setBlocs)((b) => normaliserBlocs(b.includes(cle) ? b.filter((x) => x !== cle) : [...b, cle]));
  const majScenario = (id, patch) => touche(setScenarios)((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const majHyp = (id, cle, v) => touche(setScenarios)((l) => l.map((s) => (s.id === id ? { ...s, hypotheses: { ...s.hypotheses, [cle]: v } } : s)));
  const ajouterScenario = () => {
    const ordre = [1, 2, 3, 4].find((o) => !scenarios.some((s) => s.ordre === o));
    touche(setScenarios)((l) => [...l, { id: nouvelId(), ordre, libelle: "", description: "", hypotheses: versSaisie(), avantages: "", inconvenients: "", recommande: false, nouveau: true }]);
  };
  const retirerScenario = (s) => {
    if (!window.confirm(`Retirer le scénario « ${s.libelle || "sans titre"} » ?`)) return;
    if (!s.nouveau) setRetires((r) => [...r, s.id]);
    touche(setScenarios)((l) => l.filter((x) => x.id !== s.id));
  };
  const recommander = (id) => touche(setScenarios)((l) => l.map((s) => ({ ...s, recommande: s.id === id ? !s.recommande : false })));

  const enregistrer = async (extra = {}, confirmation = "Stratégie enregistrée.") => {
    const problemes = scenarios.flatMap((s, i) => erreursScenario(s).map((e) => `Scénario ${i + 1} : ${e}`));
    if (problemes.length) { setErreur(problemes.join(" ")); return false; }
    setOccupe(true); setErreur(""); setMessage("");
    try {
      if (retires.length) { const r = await supabase.from("invest_dossier_scenarios").delete().in("id", retires).select("id"); if (r.error) throw new Error(r.error.message); }
      if (scenarios.length) {
        // un seul scénario recommandé à la fois : on libère d'abord, puis on écrit
        const lib = await supabase.from("invest_dossier_scenarios").update({ recommande: false }).eq("dossier_id", dossier.id).select("id");
        if (lib.error) throw new Error(lib.error.message);
        const lignes = scenarios.map((s) => ({ id: s.id, dossier_id: dossier.id, client_id: client.id, ordre: s.ordre, libelle: s.libelle.trim(), description: s.description.trim() || null,
          hypotheses: normaliserHypotheses(s.hypotheses), avantages: s.avantages.trim() || null, inconvenients: s.inconvenients.trim() || null, recommande: s.recommande, updated_at: new Date().toISOString() }));
        const r = await supabase.from("invest_dossier_scenarios").upsert(lignes, { onConflict: "id" }).select("id");
        if (r.error) throw new Error(r.error.message);
      }
      const champs = { dossier_id: dossier.id, client_id: client.id, blocs: normaliserBlocs(blocs), message_cle: messageCle.trim() || null,
        fiscal: { regime: fiscal.regime || null, detention: fiscal.detention.trim() || null, notes: fiscal.notes.trim() || null },
        risques: nettoyerRisques(risques), feuille_route: nettoyerFeuilleRoute(feuille), recommandation: recommandation.trim() || null,
        updated_by: auteur, updated_at: new Date().toISOString(), ...extra };
      const r = await supabase.from("invest_dossier_strategies").upsert(champs, { onConflict: "dossier_id" }).select("dossier_id");
      if (r.error) throw new Error(r.error.message);
      if (!r.data?.length) throw new Error("Enregistrement refusé : droits insuffisants.");
      setMessage(confirmation); setOccupe(false); await charger(); return true;
    } catch (e) { setErreur(e.message || String(e)); setOccupe(false); return false; }   // on ne recharge pas : la saisie en cours est conservée, on peut réessayer
  };
  const validerStrategie = async () => {
    if (!recommandation.trim()) { setErreur("La recommandation est obligatoire pour valider la stratégie."); return; }
    if (!window.confirm("Valider cette stratégie ?\n\nLes chiffres du moment sont figés. Si la situation du client ou ses scénarios changent ensuite, l'écran vous le signalera.")) return;
    const chiffres = chiffresPourValidation({ analyse, scenarios: scenariosPourChiffres, indicateurs });
    await enregistrer({ statut: "validee", valide_le: new Date().toISOString(), valide_par: auteur, chiffres_valides: chiffres }, "Stratégie validée.");
  };
  const rouvrir = async () => {
    if (!window.confirm(`Rouvrir la stratégie en brouillon ?\n\nLa validation et les chiffres figés seront retirés${ligne?.presentee_le ? ", ainsi que la date de présentation au client" : ""}.`)) return;
    await enregistrer({ statut: "brouillon", valide_le: null, valide_par: null, chiffres_valides: null, presentee_le: null }, "Stratégie rouverte en brouillon.");
  };
  const presenter = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePresentation)) { setErreur("Indiquez la date de présentation."); return; }
    if (!window.confirm(`Marquer la stratégie comme présentée au client le ${dateFr(datePresentation)} ?`)) return;
    setOccupe(true); setErreur("");
    const r = await supabase.from("invest_dossier_strategies").update({ presentee_le: datePresentation, updated_by: auteur, updated_at: new Date().toISOString() }).eq("dossier_id", dossier.id).select("dossier_id");
    setOccupe(false);
    if (r.error) { setErreur(r.error.message); return; }
    if (!r.data?.length) { setErreur("Modification refusée : droits insuffisants."); return; }
    setMessage("Stratégie marquée comme présentée au client."); await charger();
  };

  if (chargement) return <Carte T={T} titre="Stratégie"><div style={{ fontSize: 13, color: T.textMuted }}>Chargement de la stratégie…</div></Carte>;
  const pj = fiche.projet, c = analyse.capacite, b = analyse.budget;
  const champTexte = (valeur, set, props = {}) => <input className="inv-inp" style={{ textAlign: "left", width: "100%" }} value={valeur} disabled={!peutEditer} onChange={(e) => touche(set)(e.target.value)} {...props} />;
  const zone = (valeur, set, rows = 3, label) => <textarea className="inv-textarea" rows={rows} aria-label={label} value={valeur} disabled={!peutEditer} onChange={(e) => touche(set)(e.target.value)} style={{ resize: "vertical", fontWeight: 500, width: "100%" }} />;
  const couleurFlux = (v) => (v == null ? T.textMuted : v < 0 ? ROUGE : VERT);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {message && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: T.accentBg, color: T.text }}>{message}</div>}
      {erreur && <div style={{ fontSize: 12.5, color: ROUGE }}>{erreur}</div>}
      {lecture && <div style={{ fontSize: 12.5, color: ROUGE }}>Lecture incomplète : {lecture}.</div>}
      {valide && ecarts.length > 0 && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: `${ORANGE}18`, color: T.text, border: `1px solid ${ORANGE}55` }}>
        <b style={{ color: ORANGE }}>Les chiffres ont changé depuis la validation</b> ({ecarts.join(", ")}). Relisez la stratégie, puis rouvrez-la pour la valider de nouveau.</div>}

      <Carte T={T} titre="Stratégie" droite={
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.textMuted, flexWrap: "wrap" }}>
          {valide ? <span style={{ color: VERT, fontWeight: 800 }}>✓ Validée le {dateFr(ligne.valide_le)}{ligne.valide_par ? ` par ${ligne.valide_par}` : ""}</span> : <span>{ligne ? "Brouillon" : "Pas encore enregistrée"}</span>}
          {ligne?.presentee_le && <span style={{ color: VERT, fontWeight: 800 }}>· Présentée au client le {dateFr(ligne.presentee_le)}</span>}
        </div>}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub }}>Message clé (la thèse en une phrase)
          {champTexte(messageCle, setMessageCle, { placeholder: "Ex. : transformer l'épargne disponible en patrimoine locatif sans dépasser 35 % d'endettement" })}
        </label>
        <div style={{ marginTop: 12, fontSize: 11.5, fontWeight: 800, color: T.textSub }}>Blocs affichés pour ce client</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {BLOCS.map(([cle, libelle]) => (
            <button key={cle} type="button" disabled={!peutEditer} aria-pressed={actif(cle)} onClick={() => basculerBloc(cle)}
              style={{ cursor: peutEditer ? "pointer" : "default", border: `1px solid ${actif(cle) ? T.accent : T.border}`, background: actif(cle) ? T.accentBg : "transparent", color: actif(cle) ? T.accent : T.textMuted, borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 800 }}>
              {actif(cle) ? "✓ " : ""}{libelle}</button>
          ))}
        </div>
      </Carte>

      {actif("objectifs") && (
        <Carte T={T} titre="Objectifs et contraintes" droite={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("projet")}>Ouvrir le Projet</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
            <Chiffre T={T} libelle="Objectif principal" valeur={pj.objectif || "Non renseigné"} />
            <Chiffre T={T} libelle="Horizon" valeur={pj.horizon || "Non renseigné"} />
            <Chiffre T={T} libelle="Budget visé" valeur={pj.budget == null ? "Non renseigné" : eur(pj.budget)} fort />
            <Chiffre T={T} libelle="Apport souhaité" valeur={pj.apport == null ? "Non renseigné" : eur(pj.apport)} fort />
            <Chiffre T={T} libelle="Zones recherchées" valeur={pj.zones || "Non renseignées"} />
          </div>
        </Carte>
      )}

      {actif("point_depart") && (
        <Carte T={T} titre="Point de départ chiffré" droite={<div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5, color: T.textMuted }}>
          <span>{analyseValidee === null ? "Analyse non enregistrée" : analyseValidee ? "Analyse validée" : "Analyse en brouillon"}</span><button className="inv-btn inv-btn-sm" onClick={() => onOnglet("analyse")}>Ouvrir l'Analyse</button></div>}>
          {!c.calculable ? <div style={{ fontSize: 13, color: T.textMuted }}>{c.raison}</div> : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
                <Chiffre T={T} libelle="Revenus mensuels" valeur={eur(analyse.revenus)} />
                <Chiffre T={T} libelle="Taux d'endettement actuel" valeur={pctTxt(analyse.tauxEndettementPct)} />
                <Chiffre T={T} libelle="Mensualité maximale supportable" valeur={`${eur(c.mensualiteMax)} /mois`} />
                <Chiffre T={T} libelle="Épargne disponible" valeur={eur(analyse.epargneDisponible)} />
                <Chiffre T={T} libelle="Capacité d'achat indicative" valeur={eur(c.capaciteAchat)} fort />
              </div>
              <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 800, color: b.verdict === "compatible" ? VERT : b.verdict === "au_dessus" ? ROUGE : T.textMuted }}>{LIBELLES_VERDICT[b.verdict]}{b.renseigne && ` : ${b.ecart >= 0 ? "marge de" : "manque"} ${eur(Math.abs(b.ecart))}`}</div>
            </>
          )}
        </Carte>
      )}

      {actif("scenarios") && (
        <Carte T={T} titre={`Scénarios comparés · ${scenarios.length}`} droite={peutEditer && scenarios.length < MAX_SCENARIOS && <button className="inv-btn inv-btn-sm" onClick={ajouterScenario}>＋ Ajouter un scénario</button>}>
          {scenarios.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>Aucun scénario. Comparez 2 à 4 options (par exemple : acheter ancien et rénover, acheter neuf, acheter en SCI…).</div> : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 12 }}>
              {scenarios.map((s, i) => {
                const ind = indicateurs[s.id];
                return (
                  <div key={s.id} style={{ border: `${s.recommande ? 2 : 1}px solid ${s.recommande ? VERT : T.border}`, borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 900, color: T.textMuted }}>#{i + 1}</span>
                      <input className="inv-inp" style={{ textAlign: "left", flex: 1, fontWeight: 800 }} placeholder="Intitulé du scénario" aria-label="Intitulé du scénario" value={s.libelle} disabled={!peutEditer} onChange={(e) => majScenario(s.id, { libelle: e.target.value })} />
                      {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => retirerScenario(s)} title="Retirer ce scénario">✕</button>}
                    </div>
                    <textarea className="inv-textarea" rows={2} placeholder="Description (en deux phrases)" aria-label="Description" value={s.description} disabled={!peutEditer} onChange={(e) => majScenario(s.id, { description: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      {CHAMPS_SCENARIO.map(([cle, libelle, unite]) => (
                        <label key={cle} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700, gridColumn: cle === "chargesMensuelles" ? "1 / -1" : undefined }}>{libelle} ({unite})
                          <input className="inv-inp" inputMode="decimal" style={{ textAlign: "right" }} value={s.hypotheses[cle]} disabled={!peutEditer} onChange={(e) => majHyp(s.id, cle, e.target.value)} />
                        </label>
                      ))}
                    </div>
                    <div style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, paddingTop: 8 }}>
                      {!ind.evaluable ? <div style={{ fontSize: 12, color: T.textMuted }}>{ind.raison}</div> : (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <Chiffre T={T} libelle="Coût total" valeur={eur(ind.cout)} />
                          <Chiffre T={T} libelle="Montant emprunté" valeur={eur(ind.emprunt)} />
                          <Chiffre T={T} libelle="Mensualité (hors assurance)" valeur={ind.mensualite === null ? "Taux ou durée manquant" : `${eur(ind.mensualite)} /mois`} />
                          <Chiffre T={T} libelle="Rendement brut / net" valeur={`${pctTxt(ind.rendementBrutPct)} / ${pctTxt(ind.rendementNetPct)}`} />
                          <Chiffre T={T} libelle="Cash-flow mensuel" valeur={ind.cashflowMensuel === null ? "Non évaluable" : `${eur(ind.cashflowMensuel)} /mois`} couleur={couleurFlux(ind.cashflowMensuel)} fort />
                          <Chiffre T={T} libelle="Effort d'épargne" valeur={ind.effortEpargneMensuel === null ? "Non évaluable" : `${eur(ind.effortEpargneMensuel)} /mois`} />
                        </div>
                      )}
                      {ind.evaluable && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, fontWeight: 800 }}>
                          {ind.compatibleCapacite !== null && <span style={{ color: ind.compatibleCapacite ? VERT : ROUGE }}>{ind.compatibleCapacite ? "✓ Mensualité dans la capacité" : "✗ Mensualité au-dessus de la capacité"}</span>}
                          {ind.apportDisponible !== null && <span style={{ color: ind.apportDisponible ? VERT : ROUGE }}>{ind.apportDisponible ? "✓ Apport couvert par l'épargne" : "✗ Apport supérieur à l'épargne"}</span>}
                          {!ind.apportRenseigne && <span style={{ color: ORANGE }}>⚠ Apport non renseigné : financement à 100 %</span>}
                        </div>
                      )}
                    </div>
                    <textarea className="inv-textarea" rows={2} placeholder="Avantages" aria-label="Avantages" value={s.avantages} disabled={!peutEditer} onChange={(e) => majScenario(s.id, { avantages: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
                    <textarea className="inv-textarea" rows={2} placeholder="Inconvénients" aria-label="Inconvénients" value={s.inconvenients} disabled={!peutEditer} onChange={(e) => majScenario(s.id, { inconvenients: e.target.value })} style={{ resize: "vertical", fontWeight: 500 }} />
                    <button type="button" className="inv-btn inv-btn-sm" disabled={!peutEditer} aria-pressed={s.recommande} onClick={() => recommander(s.id)}
                      style={s.recommande ? { background: "#dcfce7", border: "1px solid #86efac", color: "#166534" } : undefined}>{s.recommande ? "★ Scénario recommandé" : "☆ Recommander ce scénario"}</button>
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 10 }}>Indicatif : hors fiscalité, assurance emprunteur et vacance locative. Un indicateur « non évaluable » signale une donnée manquante, jamais un zéro.</div>
        </Carte>
      )}

      {actif("fiscal") && (
        <Carte T={T} titre="Cadre fiscal et juridique" droite={<span style={{ fontSize: 11.5, color: T.textMuted }}>À valider par le conseil fiscal et juridique du client</span>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub }}>Régime envisagé
              <select className="inv-sel" value={fiscal.regime} disabled={!peutEditer} onChange={(e) => touche(setFiscal)((f) => ({ ...f, regime: e.target.value }))}>
                <option value="">Non défini</option>{Object.entries(REGIMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub }}>Mode de détention
              {champTexte(fiscal.detention, (v) => setFiscal((f) => ({ ...f, detention: v })), { placeholder: "Ex. : en indivision, via une SCI familiale…" })}</label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 800, color: T.textSub, marginTop: 10 }}>Notes
            {zone(fiscal.notes, (v) => setFiscal((f) => ({ ...f, notes: v })), 3, "Notes fiscales et juridiques")}</label>
        </Carte>
      )}

      {actif("risques") && (
        <Carte T={T} titre={`Risques et points d'attention · ${risques.length}`} droite={peutEditer && <button className="inv-btn inv-btn-sm" onClick={() => touche(setRisques)((l) => [...l, { libelle: "", niveau: "moyen", mesure: "" }])}>＋ Ajouter un risque</button>}>
          {risques.length === 0 && <div style={{ fontSize: 13, color: T.textMuted }}>Aucun risque identifié pour l'instant.</div>}
          {risques.map((r, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 110px minmax(0,2fr) auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Risque" aria-label="Risque" value={r.libelle || ""} disabled={!peutEditer} onChange={(e) => touche(setRisques)((l) => l.map((x, k) => (k === i ? { ...x, libelle: e.target.value } : x)))} />
              <select className="inv-sel" aria-label="Niveau" value={r.niveau || "moyen"} disabled={!peutEditer} onChange={(e) => touche(setRisques)((l) => l.map((x, k) => (k === i ? { ...x, niveau: e.target.value } : x)))}>{Object.entries(NIVEAUX_RISQUE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Mesure pour le réduire" aria-label="Mesure" value={r.mesure || ""} disabled={!peutEditer} onChange={(e) => touche(setRisques)((l) => l.map((x, k) => (k === i ? { ...x, mesure: e.target.value } : x)))} />
              {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => touche(setRisques)((l) => l.filter((_, k) => k !== i))} title="Retirer">✕</button>}
            </div>
          ))}
        </Carte>
      )}

      {actif("feuille_route") && (
        <Carte T={T} titre={`Feuille de route · ${feuille.length}`} droite={peutEditer && <button className="inv-btn inv-btn-sm" onClick={() => touche(setFeuille)((l) => [...l, { etape: "", echeance: "", responsable: "" }])}>＋ Ajouter une étape</button>}>
          {feuille.length === 0 && <div style={{ fontSize: 13, color: T.textMuted }}>Aucune étape planifiée pour l'instant.</div>}
          {feuille.map((f, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,3fr) 150px minmax(0,1.5fr) auto", gap: 8, marginBottom: 6, alignItems: "center" }}>
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Étape" aria-label="Étape" value={f.etape || ""} disabled={!peutEditer} onChange={(e) => touche(setFeuille)((l) => l.map((x, k) => (k === i ? { ...x, etape: e.target.value } : x)))} />
              <input className="inv-inp" type="date" aria-label="Échéance" value={f.echeance || ""} disabled={!peutEditer} onChange={(e) => touche(setFeuille)((l) => l.map((x, k) => (k === i ? { ...x, echeance: e.target.value } : x)))} />
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Responsable" aria-label="Responsable" value={f.responsable || ""} disabled={!peutEditer} onChange={(e) => touche(setFeuille)((l) => l.map((x, k) => (k === i ? { ...x, responsable: e.target.value } : x)))} />
              {peutEditer && <button type="button" className="inv-btn inv-btn-sm" onClick={() => touche(setFeuille)((l) => l.filter((_, k) => k !== i))} title="Retirer">✕</button>}
            </div>
          ))}
        </Carte>
      )}

      {actif("recommandation") && (
        <Carte T={T} titre="Recommandation" droite={<span style={{ fontSize: 11.5, color: T.textMuted }}>Obligatoire pour valider</span>}>
          {zone(recommandation, setRecommandation, 5, "Recommandation")}
        </Carte>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {peutEditer && <button className="inv-btn inv-btn-blue" disabled={occupe || !modifie} onClick={() => enregistrer()}>Enregistrer</button>}
        {peutEditer && ligne && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={validerStrategie} title="Fige les chiffres du moment">Valider la stratégie</button>}
        {modifiable && valide && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={rouvrir}>Rouvrir en brouillon</button>}
        {modifiable && valide && !ligne.presentee_le && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input className="inv-inp" type="date" aria-label="Date de présentation" value={datePresentation} max={aujourdhui()} onChange={(e) => setDatePresentation(e.target.value)} />
            <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={presenter}>Marquer comme présentée au client</button>
          </span>
        )}
        {modifie && <span style={{ fontSize: 11.5, color: ORANGE, fontWeight: 700 }}>Modifications non enregistrées</span>}
        {peutEditer && !ligne && <span style={{ fontSize: 11.5, color: T.textMuted }}>Enregistrez d'abord pour pouvoir valider.</span>}
        {!modifiable && <span style={{ fontSize: 12, color: T.textMuted }}>Mission close : consultation seule.</span>}
      </div>
    </div>
  );
}
