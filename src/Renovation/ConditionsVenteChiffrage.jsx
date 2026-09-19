// ─── Bloc « Conditions de vente du chiffrage » ───────────────────────────────
// Coefficient et taux horaire GLOBAUX propres à un chiffrage, indépendants l'un
// de l'autre. Rien n'est écrit depuis ce composant : la simulation (RPC
// simuler_conditions_chiffrage, lecture seule) précède toujours l'application
// (RPC appliquer_conditions_chiffrage, atomique : paramètres + recalcul ciblé
// des lignes + historique, refusée si le chiffrage a changé entre-temps).
import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon, InputNombre } from "../ui";
import { SlidersHorizontal, Check, X, AlertTriangle, History, Lock } from "lucide-react";
import { formaterCoefficient } from "./coefficientsVente.mjs";
import { formaterTauxHT } from "./tauxHorairesVente.mjs";
import { num, validerValeurCoefficient, validerTauxHoraire } from "./chiffragePricing.mjs";
import {
  MODE_OUVRAGE, MODE_GLOBAL, lireConditionsProjet, chiffrageModifiable, resumerSimulation,
  libelleCondition, messageErreurRpc, valeurParDefautReferentiel,
} from "./conditionsChiffrage.mjs";

export { messageErreurRpc };

const fmtEur2 = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtPct = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const fmtDate = (d) => d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function ConditionsVenteChiffrage({ T, acc, projet, projetId, coefficients = [], tauxHoraires = [], nbLignes = 0, onApplique }) {
  const courantes = lireConditionsProjet(projet);
  const verrou = chiffrageModifiable(projet);
  const [brouillon, setBrouillon] = useState(courantes);
  const [simulation, setSimulation] = useState(null);   // résultat RPC (lecture seule) ⇒ modal
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  const [historique, setHistorique] = useState(null);   // null = replié
  const [ouvert, setOuvert] = useState(false);

  // Resynchroniser le brouillon quand le projet change (ou après application / realtime)
  const cle = `${projetId}|${projet?.conditions_version}|${projet?.mode_coefficient}|${projet?.coefficient_global_id}|${projet?.mode_taux_horaire}|${projet?.taux_horaire_global_id}`;
  useEffect(() => { setBrouillon(lireConditionsProjet(projet)); setErreur(null); setHistorique(null); }, [cle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Valeurs proposees par defaut dans les champs libres (Reglages) : elles ne
  // servent QU'A pre-remplir, elles n'imposent plus rien.
  const defautCoef = valeurParDefautReferentiel(coefficients, "valeur");
  const defautTaux = valeurParDefautReferentiel(tauxHoraires, "taux_ht");

  // Valeur tapee pour chaque parametre (utilisee par le mode global).
  const valCoefBrouillon = brouillon.coefficient.mode === MODE_GLOBAL ? (num(brouillon.coefficient.valeur) ?? null) : null;
  const valTauxBrouillon = brouillon.tauxHoraire.mode === MODE_GLOBAL ? (num(brouillon.tauxHoraire.valeur) ?? null) : null;
  const ctrlCoef = validerValeurCoefficient(valCoefBrouillon);
  const ctrlTaux = validerTauxHoraire(valTauxBrouillon);
  const memeValeur = (a, b) => num(a) != null && num(b) != null && Math.abs(num(a) - num(b)) < 0.00005;
  const modifie = brouillon.coefficient.mode !== courantes.coefficient.mode || brouillon.tauxHoraire.mode !== courantes.tauxHoraire.mode
    || (brouillon.coefficient.mode === MODE_GLOBAL && !memeValeur(valCoefBrouillon, courantes.coefficient.valeur))
    || (brouillon.tauxHoraire.mode === MODE_GLOBAL && !memeValeur(valTauxBrouillon, courantes.tauxHoraire.valeur));
  const incomplet = (brouillon.coefficient.mode === MODE_GLOBAL && !ctrlCoef.valide) || (brouillon.tauxHoraire.mode === MODE_GLOBAL && !ctrlTaux.valide);

  // Passage en mode global : le champ s'ouvre pre-rempli (valeur deja figee sur
  // le chiffrage, sinon valeur par defaut des Reglages).
  const setModeCoef = (mode) => setBrouillon(b => ({ ...b, coefficient: { ...b.coefficient, mode, valeur: mode === MODE_GLOBAL ? (num(b.coefficient.valeur) ?? num(courantes.coefficient.valeur) ?? defautCoef) : null } }));
  const setModeTaux = (mode) => setBrouillon(b => ({ ...b, tauxHoraire: { ...b.tauxHoraire, mode, valeur: mode === MODE_GLOBAL ? (num(b.tauxHoraire.valeur) ?? num(courantes.tauxHoraire.valeur) ?? defautTaux) : null } }));

  /** Simulation serveur : aucune écriture. Ouvre la confirmation. */
  async function simuler({ coefValeur = valCoefBrouillon, tauxValeur = valTauxBrouillon, modeCoef = brouillon.coefficient.mode, modeTaux = brouillon.tauxHoraire.mode, motif = null } = {}) {
    if (!projetId || busy) return;
    setBusy(true); setErreur(null); setSucces(null);
    const { data, error } = await supabase.rpc("simuler_conditions_chiffrage", {
      p_projet_id: projetId, p_mode_coefficient: modeCoef, p_coefficient_valeur: modeCoef === MODE_GLOBAL ? coefValeur : null,
      p_mode_taux: modeTaux, p_taux_valeur: modeTaux === MODE_GLOBAL ? tauxValeur : null,
    });
    setBusy(false);
    if (error) { setErreur(messageErreurRpc(error)); return; }
    setSimulation({ brut: data, resume: resumerSimulation(data), params: { modeCoef, coefValeur, modeTaux, tauxValeur }, motif });
  }

  /** Application atomique : version + hash de la simulation transmis, refusée si le chiffrage a bougé. */
  async function appliquer() {
    if (!simulation || busy) return;
    const { params, resume } = simulation;
    setBusy(true); setErreur(null);
    const { data, error } = await supabase.rpc("appliquer_conditions_chiffrage", {
      p_projet_id: projetId, p_mode_coefficient: params.modeCoef, p_coefficient_valeur: params.modeCoef === MODE_GLOBAL ? params.coefValeur : null,
      p_mode_taux: params.modeTaux, p_taux_valeur: params.modeTaux === MODE_GLOBAL ? params.tauxValeur : null,
      p_version_attendue: resume.version, p_hash_attendu: resume.hash,
    });
    setBusy(false);
    if (error) { setSimulation(null); setErreur(messageErreurRpc(error)); return; }
    setSimulation(null);
    const r = resumerSimulation(data);
    setSucces(`Conditions appliquées : ${r.nbRecalculees} ligne${r.nbRecalculees > 1 ? "s" : ""} recalculée${r.nbRecalculees > 1 ? "s" : ""}${r.nbIgnorees ? `, ${r.nbIgnorees} inchangée${r.nbIgnorees > 1 ? "s" : ""} (voir détail)` : ""} · total HT ${fmtEur2(r.totalAvant)} → ${fmtEur2(r.totalApres)}.`);
    if (onApplique) await onApplique(data);
  }

  async function chargerHistorique() {
    if (historique) { setHistorique(null); return; }
    const { data } = await supabase.from("chiffrage_conditions_historique").select("*").eq("projet_id", projetId).order("date", { ascending: false }).limit(30);
    setHistorique(data || []);
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  const carte = { marginBottom: 12, padding: "12px 14px", borderRadius: RADIUS.lg, background: T.card, border: `1px solid ${T.border}` };
  const titre = { fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: acc.accent, display: "inline-flex", alignItems: "center", gap: 6 };
  const radio = (checked, disabled) => ({ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, color: disabled ? T.textMuted : T.text, cursor: disabled ? "not-allowed" : "pointer", fontWeight: checked ? 700 : 500 });
  const champ = { padding: "7px 10px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", fontWeight: 700, width: 130, textAlign: "center", outline: "none" };
  const btnP = { display: "inline-flex", alignItems: "center", gap: 6, background: acc.accent, color: acc.onAccent, border: "none", borderRadius: RADIUS.md, padding: "8px 16px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer" };
  const btnS = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: T.textSub, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "7px 12px", fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer" };
  const note = (couleur) => ({ marginTop: 8, padding: "7px 10px", borderRadius: RADIUS.md, background: `${couleur}1a`, border: `1px solid ${couleur}55`, color: couleur, fontSize: FONT.xs.size + 1, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
  const desactive = !verrou.ok || busy;

  // Un paramètre global = un mode (par ouvrage / global) + une VALEUR LIBRE.
  // Aucune liste : le champ s'ouvre pré-rempli avec la valeur par défaut des
  // Réglages (ou celle déjà figée sur ce chiffrage) et reste modifiable.
  const selecteur = (type) => {
    const estCoef = type === "coefficient";
    const cond = estCoef ? brouillon.coefficient : brouillon.tauxHoraire;
    const courante = estCoef ? courantes.coefficient : courantes.tauxHoraire;
    const valeur = estCoef ? valCoefBrouillon : valTauxBrouillon;
    const ctrl = estCoef ? ctrlCoef : ctrlTaux;
    const setMode = estCoef ? setModeCoef : setModeTaux;
    const setValeur = (v) => setBrouillon(b => estCoef
      ? { ...b, coefficient: { ...b.coefficient, valeur: v } }
      : { ...b, tauxHoraire: { ...b.tauxHoraire, valeur: v } });
    const defaut = estCoef ? defautCoef : defautTaux;
    const nom = estCoef ? "coefficient" : "taux horaire";
    const fmt = estCoef ? formaterCoefficient : formaterTauxHT;
    const fige = courante.mode === MODE_GLOBAL && memeValeur(valeur, courante.valeur);
    return (
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 }}>{estCoef ? "Coefficient de vente" : "Taux horaire de vente"}</div>
        <label style={radio(cond.mode === MODE_OUVRAGE, desactive)}>
          <input type="radio" name={`${type}-${projetId}`} checked={cond.mode === MODE_OUVRAGE} disabled={desactive} onChange={() => setMode(MODE_OUVRAGE)} />
          Utiliser le {nom} de chaque ouvrage
        </label>
        <label style={{ ...radio(cond.mode === MODE_GLOBAL, desactive), marginTop: 6 }}>
          <input type="radio" name={`${type}-${projetId}`} checked={cond.mode === MODE_GLOBAL} disabled={desactive} onChange={() => setMode(MODE_GLOBAL)} />
          Appliquer un {nom} global au chiffrage
        </label>
        {cond.mode === MODE_GLOBAL && (
          <div style={{ marginTop: 6, marginLeft: 24, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <InputNombre
              valeur={cond.valeur ?? ""}
              onValeur={setValeur}
              disabled={desactive}
              min={estCoef ? "0.0001" : "0.01"}
              step={estCoef ? "0.01" : "0.5"}
              placeholder={defaut != null ? String(defaut) : (estCoef ? "1,50" : "80")}
              title={`Valeur libre : saisis le ${nom} à appliquer à tout ce chiffrage. Elle sera figée sur le chiffrage.`}
              style={{ ...champ, borderColor: ctrl.valide ? T.border : "rgba(225,90,90,.6)", color: ctrl.valide ? T.text : "#e15a5a" }}
            />
            <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{estCoef ? "× sur les matériaux" : "€ HT / h"}</span>
            {defaut != null && !memeValeur(valeur, defaut) && (
              <button type="button" disabled={desactive} onClick={() => setValeur(defaut)}
                style={{ ...btnS, padding: "4px 9px" }} title={`Reprend la valeur par défaut des Réglages (${fmt(defaut)}).`}>
                Défaut {fmt(defaut)}
              </button>
            )}
            {fige && (
              <span title="Valeur déjà figée sur ce chiffrage" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size, color: T.textMuted }}>
                <Icon as={Lock} size={10} /> figée
              </span>
            )}
            {!ctrl.valide && (
              <span style={{ fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>{ctrl.erreur}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  const resumeCourant = `${libelleCondition(courantes.coefficient, "coefficient")} · ${libelleCondition(courantes.tauxHoraire, "taux")}`;

  return (
    <div style={carte}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={titre}><Icon as={SlidersHorizontal} size={11} /> Conditions de vente du chiffrage</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>{resumeCourant}</span>
          <button type="button" onClick={() => setOuvert(o => !o)} style={btnS}>{ouvert ? "Replier" : "Modifier"}</button>
        </div>
      </div>

      {!verrou.ok && (
        <div style={note("#e15a5a")}><Icon as={Lock} size={12} /> {verrou.motif}</div>
      )}
      {verrou.ok && verrou.avertissements.map((a, i) => (
        <div key={i} style={note("#f5a623")}><Icon as={AlertTriangle} size={12} /> {a}</div>
      ))}

      {ouvert && (
        <>
          <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
            {selecteur("coefficient")}
            {selecteur("taux")}
          </div>
          <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.5 }}>
            Les valeurs sont <strong style={{ color: T.textSub }}>figées sur ce chiffrage</strong> : un changement ultérieur dans les Réglages ne modifie ni les lignes ni le total sans une nouvelle application volontaire.
            Les coûts, quantités, cadences et ouvrages de la bibliothèque ne sont jamais modifiés. Rien n'est enregistré avant la confirmation.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" disabled={desactive || !modifie || incomplet} onClick={() => simuler()} style={{ ...btnP, opacity: desactive || !modifie || incomplet ? .5 : 1, cursor: desactive || !modifie || incomplet ? "not-allowed" : "pointer" }}>
              <Icon as={SlidersHorizontal} size={13} /> {busy ? "Simulation…" : `Simuler sur ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}`}
            </button>
            {modifie && <button type="button" onClick={() => setBrouillon(courantes)} style={btnS}><Icon as={X} size={11} /> Rétablir</button>}
            <button type="button" onClick={chargerHistorique} style={{ ...btnS, marginLeft: "auto" }}><Icon as={History} size={11} /> {historique ? "Masquer l'historique" : "Historique"}</button>
          </div>
        </>
      )}

      {erreur && <div style={note("#e15a5a")}><Icon as={AlertTriangle} size={12} /> {erreur}</div>}
      {succes && <div style={note("#22c55e")}><Icon as={Check} size={12} /> {succes}</div>}

      {historique && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${T.sectionDivider || T.border}`, paddingTop: 8 }}>
          {historique.length === 0 ? (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Aucun changement de conditions enregistré pour ce chiffrage.</div>
          ) : historique.map(h => (
            <div key={h.id} style={{ fontSize: FONT.xs.size + 1, color: T.textSub, padding: "5px 0", borderBottom: `1px solid ${T.sectionDivider || T.border}`, lineHeight: 1.5 }}>
              <strong style={{ color: T.text }}>{fmtDate(h.date)}</strong> · {h.utilisateur_email || "utilisateur inconnu"} ·{" "}
              coefficient : {h.ancien_mode_coefficient === MODE_GLOBAL ? `${h.ancien_coefficient_libelle || "global"} ${formaterCoefficient(h.ancien_coefficient_valeur)}` : "par ouvrage"} → {h.nouveau_mode_coefficient === MODE_GLOBAL ? `${h.nouveau_coefficient_libelle || "global"} ${formaterCoefficient(h.nouveau_coefficient_valeur)}` : "par ouvrage"} ·{" "}
              taux : {h.ancien_mode_taux === MODE_GLOBAL ? `${h.ancien_taux_libelle || "global"} ${formaterTauxHT(h.ancien_taux_valeur)}` : "par ouvrage"} → {h.nouveau_mode_taux === MODE_GLOBAL ? `${h.nouveau_taux_libelle || "global"} ${formaterTauxHT(h.nouveau_taux_valeur)}` : "par ouvrage"} ·{" "}
              {h.nb_lignes_recalculees} ligne{h.nb_lignes_recalculees > 1 ? "s" : ""} recalculée{h.nb_lignes_recalculees > 1 ? "s" : ""}{h.nb_lignes_ignorees ? `, ${h.nb_lignes_ignorees} inchangée${h.nb_lignes_ignorees > 1 ? "s" : ""}` : ""} ·{" "}
              total HT {fmtEur2(h.ancien_total_ht)} → {fmtEur2(h.nouveau_total_ht)}{h.ancienne_marge != null ? ` · marge ${fmtEur2(h.ancienne_marge)} (${fmtPct(h.ancienne_marge_pct)}) → ${fmtEur2(h.nouvelle_marge)} (${fmtPct(h.nouvelle_marge_pct)})` : ""}
            </div>
          ))}
        </div>
      )}

      {/* ── MODAL DE CONFIRMATION (résultat de la simulation serveur, rien n'est encore écrit) ── */}
      {simulation && (() => {
        const r = simulation.resume, av = r.avant, ap = r.apres;
        const ligneParam = (label, a, b) => (
          <tr>
            <td style={{ padding: "6px 8px", color: T.textSub, borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{label}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", color: T.textMuted, textDecoration: a === b ? "none" : "line-through", borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{a}</td>
            <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 800, color: T.text, borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{b}</td>
          </tr>
        );
        const coefTxt = (mode, lib, val) => mode === MODE_GLOBAL ? (lib ? `${lib} — ${formaterCoefficient(val)}` : `Coefficient global ${formaterCoefficient(val)}`) : "Coefficient de chaque ouvrage";
        const tauxTxt = (mode, lib, val) => mode === MODE_GLOBAL ? (lib ? `${lib} — ${formaterTauxHT(val)}` : `Taux horaire global ${formaterTauxHT(val)}`) : "Taux horaire de chaque ouvrage";
        const ecart = r.ecart ?? 0;
        return (
          <div onClick={() => !busy && setSimulation(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: T.modal, borderRadius: RADIUS.xl, padding: 24, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon as={SlidersHorizontal} size={18} /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Appliquer les conditions de vente</div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{simulation.motif || "Simulation depuis les données figées des lignes — rien n'est encore enregistré."}</div>
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm.size, marginBottom: 14 }}>
                <thead><tr>{["", "Actuel", "Après application"].map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "right", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6, padding: "4px 8px", borderBottom: `1px solid ${T.border}` }}>{h}</th>)}</tr></thead>
                <tbody>
                  {ligneParam("Coefficient", coefTxt(av.mode_coefficient, av.coefficient_libelle, av.coefficient_valeur), coefTxt(ap.mode_coefficient, ap.coefficient_libelle, ap.coefficient_valeur))}
                  {ligneParam("Taux horaire", tauxTxt(av.mode_taux_horaire, av.taux_libelle, av.taux_valeur), tauxTxt(ap.mode_taux_horaire, ap.taux_libelle, ap.taux_valeur))}
                  {ligneParam("Total HT du chiffrage", fmtEur2(r.totalAvant), fmtEur2(r.totalApres))}
                  {ligneParam("Écart", "", `${ecart > 0 ? "+" : ""}${fmtEur2(ecart)}`)}
                  {ligneParam("Marge", r.margeAvant != null ? `${fmtEur2(r.margeAvant)} (${fmtPct(r.margeAvantPct)})` : "non calculable", r.margeApres != null ? `${fmtEur2(r.margeApres)} (${fmtPct(r.margeApresPct)})` : "non calculable")}
                </tbody>
              </table>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 12 }}>
                <strong style={{ color: T.text }}>{r.nbRecalculees}</strong> ligne{r.nbRecalculees > 1 ? "s" : ""} recalculée{r.nbRecalculees > 1 ? "s" : ""} (coefficient et taux appliqués, prix matériaux, prix main-d'œuvre, prix unitaire, total et marge).
                {r.nbSansSnapshot > 0 && <> <strong style={{ color: T.text }}>{r.nbSansSnapshot}</strong> ligne{r.nbSansSnapshot > 1 ? "s" : ""} à prix saisi (sans calcul figé) inchangée{r.nbSansSnapshot > 1 ? "s" : ""}.</>}
                {/* Les dérogations de ligne ne suivent PAS le changement global : elles ne sont
                    donc jamais comptées comme recalculées. */}
                {(r.nbCoefSpecifiques > 0 || r.nbTauxSpecifiques > 0 || r.nbModeOuvrage > 0 || r.nbInchangees > 0) && (
                  <div style={{ marginTop: 6 }}>
                    {r.nbCoefSpecifiques > 0 && <div><strong style={{ color: T.text }}>{r.nbCoefSpecifiques}</strong> coefficient{r.nbCoefSpecifiques > 1 ? "s" : ""} spécifique{r.nbCoefSpecifiques > 1 ? "s" : ""} conservé{r.nbCoefSpecifiques > 1 ? "s" : ""}</div>}
                    {r.nbTauxSpecifiques > 0 && <div><strong style={{ color: T.text }}>{r.nbTauxSpecifiques}</strong> taux horaire{r.nbTauxSpecifiques > 1 ? "s" : ""} spécifique{r.nbTauxSpecifiques > 1 ? "s" : ""} conservé{r.nbTauxSpecifiques > 1 ? "s" : ""}</div>}
                    {r.nbModeOuvrage > 0 && <div><strong style={{ color: T.text }}>{r.nbModeOuvrage}</strong> ligne{r.nbModeOuvrage > 1 ? "s" : ""} forcée{r.nbModeOuvrage > 1 ? "s" : ""} sur les paramètres de l'ouvrage</div>}
                    {r.nbInchangees > 0 && <div><strong style={{ color: T.text }}>{r.nbInchangees}</strong> ligne{r.nbInchangees > 1 ? "s" : ""} déjà à ces conditions (aucun changement)</div>}
                  </div>
                )}
                <div style={{ marginTop: 4, color: T.textMuted, fontSize: FONT.xs.size + 1 }}>Inchangés : coûts matériaux, main-d'œuvre et direct figés · quantités et unités · cadences · zones · ouvrages de la bibliothèque · autres chiffrages.</div>
              </div>
              {r.ignorees.length > 0 && (
                <div style={{ marginBottom: 12, padding: "8px 10px", borderRadius: RADIUS.md, background: "rgba(245,166,35,0.12)", border: "1px solid rgba(245,166,35,0.4)" }}>
                  <div style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", fontWeight: 700, marginBottom: 4 }}>{r.ignorees.length} ligne{r.ignorees.length > 1 ? "s" : ""} non recalculable{r.ignorees.length > 1 ? "s" : ""} (laissée{r.ignorees.length > 1 ? "s" : ""} telle{r.ignorees.length > 1 ? "s" : ""} quelle{r.ignorees.length > 1 ? "s" : ""}) :</div>
                  {r.ignorees.map(l => <div key={l.id} style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>• {l.item} — {l.raison}</div>)}
                </div>
              )}
              {r.avertissements.map((a, i) => (
                <div key={i} style={{ ...note("#f5a623"), marginTop: 0, marginBottom: 10 }}><Icon as={AlertTriangle} size={12} /> {a}</div>
              ))}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" disabled={busy} onClick={() => setSimulation(null)} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer" }}>Annuler</button>
                <button type="button" disabled={busy} onClick={appliquer} style={{ ...btnP, padding: "9px 18px", opacity: busy ? .6 : 1 }}>
                  <Icon as={Check} size={13} /> {busy ? "Application…" : "Appliquer les conditions"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
