// ─── Modal « Conditions de vente de cette ligne » ────────────────────────────
// Coefficient et taux horaire de vente propres à UN SEUL ouvrage sélectionné du
// chiffrage. Trois modes indépendants par paramètre :
//   heritage   → condition globale du chiffrage si elle existe, sinon ouvrage
//   ouvrage    → force le paramètre d'origine de l'ouvrage (ignore le global)
//   specifique → VALEUR SAISIE à la main, FIGÉE sur cette ligne
//
// Il n'y a plus de liste : en mode « specifique » on tape la valeur. Les
// référentiels (Réglages) ne servent qu'à pré-remplir le champ.
//
// Rien n'est écrit depuis ce composant : la simulation serveur
// (simuler_conditions_ligne, lecture seule) précède toujours l'application
// (appliquer_conditions_ligne, atomique : version + hash contrôlés, recalcul de
// la seule ligne concernée, audit). Le navigateur transmet un mode et, en mode
// « specifique », la valeur saisie — jamais un prix ni une marge, qui restent
// calculés par le serveur depuis les données figées de la ligne.
//
// Ni la bibliothèque, ni les autres lignes, ni les autres chiffrages, ni les
// référentiels (Réglages) ne sont modifiés ici.
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon, InputNombre } from "../ui";
import { SlidersHorizontal, Check, X, AlertTriangle, Lock, Info, RotateCcw, Package, History, Pencil } from "lucide-react";
import { formaterCoefficient } from "./coefficientsVente.mjs";
import { formaterTauxHT } from "./tauxHorairesVente.mjs";
import { num } from "./chiffragePricing.mjs";
import {
  MODE_LIGNE_SPECIFIQUE, VALEUR_HERITAGE, VALEUR_OUVRAGE,
  lireModesLigne, champConditionLigne,
  lireConditionsProjet, chiffrageModifiable, resumerSimulationLigne, libelleSource,
  messageErreurRpc,
} from "./conditionsChiffrage.mjs";

const fmtEur2 = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtPct = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const fmtDate = (d) => d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function ConditionsVenteLigne({ T, acc, projet, projetId, ligne, coefficients = [], tauxHoraires = [], onApplique, onClose }) {
  const conditions = lireConditionsProjet(projet);
  const verrou = chiffrageModifiable(projet);
  const modesLigne = lireModesLigne(ligne);

  // Choix en cours : un mode par paramètre + la valeur tapée en mode « specifique ».
  const [choix, setChoix] = useState(() => ({
    coefficient: { mode: modesLigne.coefficient.mode, valeur: modesLigne.coefficient.valeur ?? null },
    taux: { mode: modesLigne.tauxHoraire.mode, valeur: modesLigne.tauxHoraire.valeur ?? null },
  }));
  const [simulation, setSimulation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [historique, setHistorique] = useState(null);

  // Modes à refléter dans l'aperçu (choix courant de l'utilisateur)
  const modesChoisis = {
    coefficient: { mode: choix.coefficient.mode, id: null, valeur: choix.coefficient.mode === MODE_LIGNE_SPECIFIQUE ? num(choix.coefficient.valeur) : null, libelle: null },
    tauxHoraire: { mode: choix.taux.mode, id: null, valeur: choix.taux.mode === MODE_LIGNE_SPECIFIQUE ? num(choix.taux.valeur) : null, libelle: null },
  };
  const selCoef = champConditionLigne({ type: "coefficient", referentiel: coefficients, ligne, conditions, modes: modesLigne });
  const selTaux = champConditionLigne({ type: "taux", referentiel: tauxHoraires, ligne, conditions, modes: modesLigne });
  const apercuCoef = champConditionLigne({ type: "coefficient", referentiel: coefficients, ligne, conditions, modes: modesChoisis });
  const apercuTaux = champConditionLigne({ type: "taux", referentiel: tauxHoraires, ligne, conditions, modes: modesChoisis });

  const memeValeur = (a, b) => num(a) != null && num(b) != null && Math.abs(num(a) - num(b)) < 0.00005;
  const inchange = (c, sel) => c.mode === sel.mode && (c.mode !== MODE_LIGNE_SPECIFIQUE || memeValeur(c.valeur, sel.valeur));
  const modifie = !inchange(choix.coefficient, selCoef) || !inchange(choix.taux, selTaux);
  // Une valeur saisie invalide (vide, nulle, négative) bloque la simulation.
  const saisieIncomplete = (choix.coefficient.mode === MODE_LIGNE_SPECIFIQUE && !(num(choix.coefficient.valeur) > 0))
    || (choix.taux.mode === MODE_LIGNE_SPECIFIQUE && !(num(choix.taux.valeur) > 0));

  /** Simulation serveur : aucune écriture. Relancée à chaque changement de mode ou de valeur. */
  const simuler = useCallback(async (modeCoef, valCoef, modeTaux, valTaux) => {
    if (!projetId || !ligne?.id) return;
    if ((modeCoef === MODE_LIGNE_SPECIFIQUE && !(num(valCoef) > 0)) || (modeTaux === MODE_LIGNE_SPECIFIQUE && !(num(valTaux) > 0))) {
      setSimulation(null); setErreur(null); return;   // saisie en cours : on n'interroge pas le serveur
    }
    setBusy(true); setErreur(null);
    const { data, error } = await supabase.rpc("simuler_conditions_ligne", {
      p_projet_id: projetId, p_ligne_id: ligne.id,
      p_mode_coefficient: modeCoef, p_coefficient_valeur: modeCoef === MODE_LIGNE_SPECIFIQUE ? num(valCoef) : null,
      p_mode_taux: modeTaux, p_taux_valeur: modeTaux === MODE_LIGNE_SPECIFIQUE ? num(valTaux) : null,
    });
    setBusy(false);
    if (error) { setSimulation(null); setErreur(messageErreurRpc(error)); return; }
    setSimulation(resumerSimulationLigne(data));
  }, [projetId, ligne?.id]);

  // Saisie au clavier : on laisse retomber la frappe avant d'interroger le serveur.
  useEffect(() => {
    const t = setTimeout(() => simuler(choix.coefficient.mode, choix.coefficient.valeur, choix.taux.mode, choix.taux.valeur), 350);
    return () => clearTimeout(t);
  }, [choix.coefficient.mode, choix.coefficient.valeur, choix.taux.mode, choix.taux.valeur, simuler]);

  /** Application atomique : version + hash de la simulation, confirmations explicites. */
  async function appliquer() {
    if (!simulation || busy || !simulation.possible || !simulation.change) return;
    setBusy(true); setErreur(null);
    const { data, error } = await supabase.rpc("appliquer_conditions_ligne", {
      p_projet_id: projetId, p_ligne_id: ligne.id,
      p_mode_coefficient: choix.coefficient.mode, p_coefficient_valeur: choix.coefficient.mode === MODE_LIGNE_SPECIFIQUE ? num(choix.coefficient.valeur) : null,
      p_mode_taux: choix.taux.mode, p_taux_valeur: choix.taux.mode === MODE_LIGNE_SPECIFIQUE ? num(choix.taux.valeur) : null,
      p_version_attendue: simulation.version, p_hash_attendu: simulation.hash,
      p_confirmer_prix_manuel: simulation.prixManuel === true,
      p_confirmer_conversion_v1: simulation.conversionV1 === true,
    });
    setBusy(false);
    if (error) { setErreur(messageErreurRpc(error)); simuler(choix.coefficient.mode, choix.coefficient.valeur, choix.taux.mode, choix.taux.valeur); return; }
    if (onApplique) await onApplique(data);
    if (onClose) onClose();
  }

  async function chargerHistorique() {
    if (historique) { setHistorique(null); return; }
    const { data } = await supabase.from("chiffrage_ligne_conditions_historique").select("*").eq("ligne_id", ligne.id).order("date", { ascending: false }).limit(20);
    setHistorique(data || []);
  }

  // ─── Styles ────────────────────────────────────────────────────────────────
  const select = { padding: "7px 10px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", width: "100%" };
  const btnP = { display: "inline-flex", alignItems: "center", gap: 6, background: acc.accent, color: acc.onAccent, border: "none", borderRadius: RADIUS.md, padding: "9px 18px", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer" };
  const btnS = { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", color: T.textSub, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "5px 9px", fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 600, cursor: "pointer" };
  const note = (couleur) => ({ marginTop: 10, padding: "8px 10px", borderRadius: RADIUS.md, background: `${couleur}1a`, border: `1px solid ${couleur}55`, color: couleur, fontSize: FONT.xs.size + 1, fontWeight: 600, display: "flex", alignItems: "flex-start", gap: 8, lineHeight: 1.5 });
  const lbl = { fontSize: FONT.xs.size, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 };
  const desactive = !verrou.ok || busy;

  // Un paramètre de ligne = un mode +, en mode « valeur saisie », un CHAMP LIBRE.
  // Le champ s'ouvre pré-rempli avec la valeur qui s'applique aujourd'hui (ou la
  // valeur par défaut des Réglages) et reste entièrement modifiable.
  const selecteur = (type) => {
    const estCoef = type === "coefficient";
    const sel = estCoef ? selCoef : selTaux;
    const apercu = estCoef ? apercuCoef : apercuTaux;
    const cour = estCoef ? choix.coefficient : choix.taux;
    const setCour = (patch) => setChoix(c => estCoef
      ? { ...c, coefficient: { ...c.coefficient, ...patch } }
      : { ...c, taux: { ...c.taux, ...patch } });
    const fmt = estCoef ? formaterCoefficient : formaterTauxHT;
    const nom = estCoef ? "coefficient" : "taux horaire";
    const courant = inchange(cour, sel);
    const saisieOk = num(cour.valeur) > 0;
    // Bascule en « valeur saisie » : champ pré-rempli avec ce qui s'applique déjà.
    const passerEnSaisie = () => setCour({ mode: MODE_LIGNE_SPECIFIQUE, valeur: num(cour.valeur) ?? apercu.suggestion ?? sel.suggestion ?? null });
    const choixMode = (mode, label, icone, actif, titre) => (
      <button type="button" disabled={desactive || !actif} onClick={() => mode === MODE_LIGNE_SPECIFIQUE ? passerEnSaisie() : setCour({ mode, valeur: null })}
        title={titre}
        style={{ ...btnS, fontWeight: cour.mode === mode ? 800 : 600,
          color: cour.mode === mode ? acc.accent : T.textSub,
          borderColor: cour.mode === mode ? acc.accent : T.border,
          background: cour.mode === mode ? acc.bg10 : "transparent",
          opacity: !actif ? .45 : 1 }}>
        <Icon as={icone} size={10} /> {label}
      </button>
    );
    return (
      <div style={{ flex: 1, minWidth: 250 }}>
        <div style={lbl}>{estCoef ? "Coefficient de vente appliqué" : "Taux horaire de vente appliqué"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {choixMode(VALEUR_HERITAGE, "Conditions du chiffrage", RotateCcw, true, sel.texteHeritage)}
          {choixMode(VALEUR_OUVRAGE, "Paramètre de l'ouvrage", Package, sel.ouvrageDisponible, sel.texteOuvrage)}
          {choixMode(MODE_LIGNE_SPECIFIQUE, "Valeur saisie", Pencil, true, `Saisir librement le ${nom} de CETTE ligne. La valeur sera figée dessus.`)}
        </div>
        {cour.mode === MODE_LIGNE_SPECIFIQUE && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <InputNombre
              valeur={cour.valeur ?? ""}
              onValeur={(v) => setCour({ valeur: v })}
              disabled={desactive}
              min={estCoef ? "0.0001" : "0.01"}
              step={estCoef ? "0.01" : "0.5"}
              placeholder={sel.suggestion != null ? String(sel.suggestion) : (estCoef ? "1,50" : "80")}
              title={`${estCoef ? "Coefficient" : "Taux horaire"} propre à cette ligne : ni la bibliothèque, ni les autres lignes, ni les autres chiffrages ne sont modifiés.`}
              style={{ ...select, width: 130, textAlign: "center", fontWeight: 800,
                borderColor: saisieOk ? T.border : "rgba(225,90,90,.6)", color: saisieOk ? T.text : "#e15a5a" }}
            />
            <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{estCoef ? "× sur les matériaux" : "€ HT / h"}</span>
            {!saisieOk && <span style={{ fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>{estCoef ? "Coefficient à saisir" : "Taux horaire à saisir"}</span>}
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: T.text, fontWeight: 700 }}>
          {apercu.applique.valide ? `${estCoef ? "Coefficient appliqué" : "Taux horaire appliqué"} : ${fmt(apercu.applique.valeur)}` : `${estCoef ? "Coefficient" : "Taux horaire"} non déterminable`}
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Origine : {libelleSource(apercu.applique.source)}</div>
        {!courant && (
          <div style={{ marginTop: 6, fontSize: FONT.xs.size, color: acc.accent, fontWeight: 700 }}>
            Modifié : {sel.applique.valide ? fmt(sel.applique.valeur) : "—"} → {apercu.applique.valide ? fmt(apercu.applique.valeur) : "—"}
          </div>
        )}
      </div>
    );
  };

  const ligneComparaison = (label, a, b, fort = false) => (
    <tr>
      <td style={{ padding: "6px 8px", color: T.textSub, borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{label}</td>
      <td style={{ padding: "6px 8px", textAlign: "right", color: T.textMuted, textDecoration: a === b ? "none" : "line-through", borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{a}</td>
      <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: fort ? 900 : 800, color: a === b ? T.textMuted : T.text, borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>{b}</td>
    </tr>
  );

  const s = simulation;
  const peutAppliquer = !!s && s.possible && s.change && verrou.ok && !busy && !saisieIncomplete;
  const libelleBouton = !s ? "Appliquer à cet ouvrage"
    : s.prixManuel ? "Remplacer le prix manuel et appliquer"
    : s.conversionV1 ? "Convertir au calcul actuel et appliquer"
    : "Appliquer à cet ouvrage";

  return (
    <div onClick={() => !busy && onClose && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.modal, borderRadius: RADIUS.xl, padding: 24, width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon as={SlidersHorizontal} size={18} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Conditions de vente de cette ligne</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ligne?.code_ouvrage ? `${ligne.code_ouvrage} · ` : ""}{ligne?.item}{ligne?.zone ? ` · ${ligne.zone}` : ""}
            </div>
          </div>
          <button type="button" onClick={() => onClose && onClose()} style={{ ...btnS, padding: "6px 8px" }}><Icon as={X} size={12} /></button>
        </div>

        {!verrou.ok && <div style={note("#e15a5a")}><Icon as={Lock} size={12} /> <span>{verrou.motif}</span></div>}
        {verrou.ok && verrou.avertissements.map((a, i) => (
          <div key={i} style={note("#f5a623")}><Icon as={AlertTriangle} size={12} /> <span>{a}</span></div>
        ))}

        <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
          {selecteur("coefficient")}
          {selecteur("taux")}
        </div>

        <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.5 }}>
          La valeur saisie est <strong style={{ color: T.textSub }}>figée sur cette seule ligne</strong> : les autres lignes du chiffrage, les autres chiffrages et l'ouvrage de la bibliothèque ne changent pas.
          Les valeurs par défaut des Réglages ne servent qu'à pré-remplir le champ : les modifier ensuite ne touche pas cette ligne.
        </div>

        {/* ── Aperçu (simulation serveur, rien n'est encore enregistré) ── */}
        {s && !s.possible && (
          <div style={note("#e15a5a")}><Icon as={AlertTriangle} size={12} /> <span>{s.blocage}</span></div>
        )}
        {s && s.possible && s.prixManuel && (
          <div style={note("#f5a623")}>
            <Icon as={Info} size={12} />
            <span>
              Cette ligne utilise actuellement un prix de vente saisi manuellement.<br />
              Changer son coefficient ou son taux horaire nécessite de remplacer ce prix manuel par un prix calculé.<br />
              <strong>Prix manuel actuel : {fmtEur2(s.avant.prix)} · Nouveau prix calculé : {fmtEur2(s.apres.prix)}</strong>
            </span>
          </div>
        )}
        {s && s.possible && s.conversionV1 && (
          <div style={note("#f5a623")}>
            <Icon as={Info} size={12} />
            <span>
              Cette ligne a été calculée avec l'ancienne formule (coefficient appliqué au coût total).<br />
              L'appliquer la fait passer au calcul actuel : matériaux et coût direct × coefficient, main-d'œuvre = cadence × taux horaire. Les coûts et la cadence figés ne changent pas.
            </span>
          </div>
        )}
        {s && s.avertissements.map((a, i) => (
          <div key={i} style={note("#f5a623")}><Icon as={AlertTriangle} size={12} /> <span>{a}</span></div>
        ))}

        {s && s.possible && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm.size, marginTop: 14 }}>
            <thead><tr>{["", "Actuel", modifie ? "Après application" : "Inchangé"].map((h, i) => (
              <th key={i} style={{ textAlign: i === 0 ? "left" : "right", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6, padding: "4px 8px", borderBottom: `1px solid ${T.border}` }}>{h}</th>
            ))}</tr></thead>
            <tbody>
              {ligneComparaison("Coefficient", formaterCoefficient(s.avant.coefficient), formaterCoefficient(s.apres.coefficient))}
              {ligneComparaison("Origine du coefficient", libelleSource(s.avant.coefficient_source), libelleSource(s.apres.coefficient_source))}
              {ligneComparaison("Taux horaire", formaterTauxHT(s.avant.taux), formaterTauxHT(s.apres.taux))}
              {ligneComparaison("Origine du taux", libelleSource(s.avant.taux_source), libelleSource(s.apres.taux_source))}
              {ligneComparaison(`Prix de vente HT / ${ligne?.unite || "u"}`, fmtEur2(s.avant.prix), fmtEur2(s.apres.prix), true)}
              {ligneComparaison("Marge unitaire", `${fmtEur2(s.avant.marge)} (${fmtPct(s.avant.marge_pct)})`, `${fmtEur2(s.apres.marge)} (${fmtPct(s.apres.marge_pct)})`)}
              {ligneComparaison(`Total de la ligne (× ${s.quantite ?? 0})`, fmtEur2(s.avant.total), fmtEur2(s.apres.total))}
            </tbody>
          </table>
        )}

        {s && s.possible && modifie && (
          <div style={{ marginTop: 10, fontSize: FONT.xs.size + 1, color: T.textMuted, lineHeight: 1.5 }}>
            Calculé depuis les <strong style={{ color: T.textSub }}>données figées de cette ligne</strong> : coût matériaux, coût direct, cadence et coûts de main-d'œuvre inchangés.
            Quantité, unité, zone, TVA, matériaux et composition ne sont pas touchés, et rien n'est rechargé depuis la bibliothèque.
          </div>
        )}
        {s && s.possible && !s.change && !modifie && (
          <div style={{ marginTop: 10, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Aucun changement en attente : la ligne utilise déjà ces paramètres.</div>
        )}

        {erreur && <div style={note("#e15a5a")}><Icon as={AlertTriangle} size={12} /> <span>{erreur}</span></div>}

        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={chargerHistorique} style={btnS}><Icon as={History} size={11} /> {historique ? "Masquer l'historique" : "Historique de la ligne"}</button>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            <button type="button" disabled={busy} onClick={() => onClose && onClose()} style={{ background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer" }}>Annuler</button>
            <button type="button" disabled={!peutAppliquer} onClick={appliquer} style={{ ...btnP, opacity: peutAppliquer ? 1 : .45, cursor: peutAppliquer ? "pointer" : "not-allowed" }}>
              <Icon as={Check} size={13} /> {busy ? "Application…" : libelleBouton}
            </button>
          </div>
        </div>

        {historique && (
          <div style={{ marginTop: 12, borderTop: `1px solid ${T.sectionDivider || T.border}`, paddingTop: 8 }}>
            {historique.length === 0 ? (
              <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Aucun changement de conditions enregistré pour cette ligne.</div>
            ) : historique.map(h => (
              <div key={h.id} style={{ fontSize: FONT.xs.size + 1, color: T.textSub, padding: "5px 0", borderBottom: `1px solid ${T.sectionDivider || T.border}`, lineHeight: 1.5 }}>
                <strong style={{ color: T.text }}>{fmtDate(h.date)}</strong> · {h.utilisateur_email || "utilisateur inconnu"} ·{" "}
                coefficient {h.ancien_mode_coefficient} {formaterCoefficient(h.ancien_coefficient)} → {h.nouveau_mode_coefficient} {formaterCoefficient(h.nouveau_coefficient)} ·{" "}
                taux {h.ancien_mode_taux} {formaterTauxHT(h.ancien_taux)} → {h.nouveau_mode_taux} {formaterTauxHT(h.nouveau_taux)} ·{" "}
                prix {fmtEur2(h.ancien_prix_unitaire)} → {fmtEur2(h.nouveau_prix_unitaire)} · marge {fmtPct(h.ancienne_marge_pct)} → {fmtPct(h.nouvelle_marge_pct)}
                {h.prix_manuel_remplace ? " · prix manuel remplacé" : ""}{h.conversion_v1 ? " · converti depuis l'ancienne formule" : ""}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
