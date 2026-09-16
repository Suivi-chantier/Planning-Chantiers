// src/Renovation/ProgbatCadencesImport.jsx — Réglages → Outils → Maintenance → ProGBat
// Import PONCTUEL des cadences ProGBat vers la bibliothèque Profero, en deux
// étapes distinctes : 1. Analyser (lecture seule, plan figé côté serveur)
// 2. Confirmer l'import (le navigateur n'envoie que planId + planHash + confirmed).
// Aucune analyse automatique, aucune synchronisation récurrente : après l'import,
// Profero est la source de vérité pour les cadences.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Clock, RefreshCw, ShieldCheck, AlertTriangle, Download, X, Check } from "lucide-react";
import { STATUTS, STATUTS_LABELS, STATUTS_ANOMALIES, formatCadence, texteConfirmation } from "./progbatCadences.mjs";

const FONCTION = "progbat-library-cadences";
const COULEURS = {
  a_importer: "#4db8ff", identique: "#22c55e", non_lie: "#9aa5c0",
  progbat_id_invalide: "#e15a5a", structure_introuvable: "#e15a5a", doublon_liaison: "#f59e0b",
  cadence_absente: "#f59e0b", cadence_nulle: "#f59e0b", cadence_negative: "#e15a5a",
  unite_non_convertible: "#e15a5a", unite_ouvrage_differente: "#f59e0b", composition_ambigue: "#f59e0b", erreur_lecture: "#e15a5a",
};
const FILTRES = [
  ["tous", "Tous"], ["changements", "Changements"], ["identiques", "Identiques"], ["anomalies", "Anomalies"], ["non_lies", "Non liés"],
];

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtEcart = (l) => {
  if (l.ecart == null) return "—";
  const signe = l.ecart > 0 ? "+" : "";
  const pct = l.ecart_pct == null ? "" : ` (${l.ecart_pct > 0 ? "+" : ""}${l.ecart_pct} %)`;
  return `${signe}${l.ecart.toLocaleString("fr-FR", { maximumFractionDigits: 4 })} H/${l.unite || "u"}${pct}`;
};

async function invoquer(body) {
  const { data, error } = await supabase.functions.invoke(FONCTION, { body });
  if (error && !data) {
    let corps = null;
    try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
    if (corps) return corps;
    throw new Error(error.message || "Appel de la fonction impossible.");
  }
  return data;
}

export default function ProgbatCadencesImport({ T, acc }) {
  const [loading, setLoading] = useState(false);
  const [analyse, setAnalyse] = useState(null);
  const [erreur, setErreur] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [confirmation, setConfirmation] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [dernierImport, setDernierImport] = useState(null);

  // Statut seulement (aucune analyse ni lecture ProGBat au chargement).
  useEffect(() => {
    let actif = true;
    invoquer({ action: "status" }).then((d) => { if (actif && d?.ok) setDernierImport(d.dernier_import || null); }).catch(() => {});
    return () => { actif = false; };
  }, []);

  const analyser = async () => {
    setLoading(true); setErreur(""); setResultat(null); setConfirmation(false); setAnalyse(null);
    try {
      const d = await invoquer({ action: "analyser" });
      if (!d?.ok) throw new Error((d?.error || "Analyse impossible.") + (d?.progbat_status ? ` · code HTTP ProGBat ${d.progbat_status}` : "") + (d?.etape ? ` · étape « ${d.etape} »` : ""));
      setAnalyse(d); setFiltre("tous");
      if (d.dernier_import) setDernierImport(d.dernier_import);
    } catch (e) { setErreur(e?.message || "Erreur inattendue."); }
    setLoading(false);
  };

  const importer = async () => {
    if (!analyse?.planId || !analyse?.planHash) return;
    setImportLoading(true); setErreur("");
    try {
      // Seuls l'identifiant du plan, son hash et la confirmation partent : jamais de cadence.
      const d = await invoquer({ action: "confirmer", planId: analyse.planId, planHash: analyse.planHash, confirmed: true });
      setResultat(d);
      setConfirmation(false);
      if (d?.ok) {
        setAnalyse(null);
        const s = await invoquer({ action: "status" }).catch(() => null);
        if (s?.ok) setDernierImport(s.dernier_import || null);
      } else {
        setErreur(d?.error || "Import refusé.");
        setAnalyse(null); // le plan n'est plus valable : repasser par l'analyse
      }
    } catch (e) { setErreur(e?.message || "Connexion interrompue : relancer l'analyse avant toute nouvelle tentative."); setConfirmation(false); }
    setImportLoading(false);
  };

  const lignes = useMemo(() => {
    const all = analyse?.plan?.lignes || [];
    if (filtre === "changements") return all.filter((l) => l.statut === STATUTS.a_importer);
    if (filtre === "identiques") return all.filter((l) => l.statut === STATUTS.identique);
    if (filtre === "anomalies") return all.filter((l) => STATUTS_ANOMALIES.includes(l.statut));
    if (filtre === "non_lies") return all.filter((l) => l.statut === STATUTS.non_lie);
    return all;
  }, [analyse, filtre]);

  const s = analyse?.plan?.synthese;
  const th = { textAlign: "left", padding: "6px 8px", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: FONT.xs.size + 1, color: T.text, borderBottom: `1px solid ${T.border}`, verticalAlign: "top" };
  const badge = (statut) => (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: FONT.xs.size, fontWeight: 700, color: COULEURS[statut] || T.textSub, background: `${COULEURS[statut] || "#888"}22`, whiteSpace: "nowrap" }}>
      {STATUTS_LABELS[statut] || statut}
    </span>
  );
  const chip = (actif, label, onClick, color) => (
    <button key={label} onClick={onClick} style={{
      padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700,
      border: `1.5px solid ${actif ? (color || acc.accent) : T.border}`, background: actif ? `${color || acc.accent}22` : "transparent",
      color: actif ? (color || acc.accent) : T.textSub,
    }}>{label}</button>
  );
  const compteFiltre = (k) => {
    const all = analyse?.plan?.lignes || [];
    if (k === "tous") return all.length;
    if (k === "changements") return s?.a_importer ?? 0;
    if (k === "identiques") return s?.identiques ?? 0;
    if (k === "anomalies") return s?.non_exploitables ?? 0;
    return s?.non_lies ?? 0;
  };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 14, marginTop: 14 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
        <Icon as={Clock} size={11} />
        Importer les cadences depuis ProGBat
      </div>

      <div style={{ padding: "8px 12px", marginBottom: 12, borderRadius: RADIUS.md, background: "rgba(77,184,255,0.10)", border: "1px solid rgba(77,184,255,0.35)", color: T.text, fontSize: FONT.xs.size + 1, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700 }}>Cet outil importe ponctuellement les cadences actuellement enregistrées dans ProGBat.</div>
        <div>Après l’import, Profero devient la source de vérité. Les modifications ultérieures réalisées dans ProGBat ne seront pas réimportées automatiquement.</div>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", background: T.card, borderRadius: RADIUS.md }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, marginBottom: 2 }}>1. Analyser les cadences · 2. Confirmer l’import</div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.55 }}>
            L’analyse lit, pour chaque ouvrage Profero lié (bibliotheque_ratios.progbat_id), la composition ProGBat développée et additionne les heures des jobs de main-d’œuvre horaires. Aucune modification pendant l’analyse ; l’import n’a lieu qu’après confirmation explicite, en une seule transaction.
          </div>
          <div style={{ fontSize: FONT.xs.size, color: dernierImport ? T.text : T.textMuted, marginTop: 6, fontWeight: dernierImport ? 600 : 400 }}>
            {dernierImport
              ? <>Dernier import ProGBat : {fmtDate(dernierImport.finished_at || dernierImport.started_at)} ({dernierImport.nb_modifies} cadence(s){dernierImport.created_by_email ? `, ${dernierImport.created_by_email}` : ""}).<br/>Depuis cet import, Profero est la source de vérité pour les cadences.</>
              : "Aucun import ProGBat appliqué à ce jour. Profero reste la source de vérité pour les cadences."}
          </div>
        </div>
        <button onClick={analyser} disabled={loading || importLoading} style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
          background: loading ? T.border : acc.accent, color: loading ? T.textMuted : acc.onAccent,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer",
        }}>
          <Icon as={RefreshCw} size={11} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          {loading ? "Analyse en cours…" : "Analyser les cadences"}
        </button>

        {erreur && <div style={{ flex: "1 1 100%", color: "#e15a5a", fontSize: FONT.xs.size + 1, fontWeight: 700 }}>⚠ {erreur}</div>}
        {resultat?.ok && (
          <div style={{ flex: "1 1 100%", padding: "9px 12px", borderRadius: RADIUS.md, color: "#22c55e", background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.28)", fontWeight: 700 }}>
            {resultat.nb_modifies > 0 ? `Import terminé : ${resultat.nb_modifies} cadence(s) mise(s) à jour.` : "0 cadence à modifier : aucune écriture effectuée."}
            <div style={{ color: T.textSub, fontWeight: 500 }}>Aucune donnée modifiée dans ProGBat · aucun chiffrage existant recalculé · Profero est la source de vérité pour les cadences.</div>
          </div>
        )}

        {analyse?.plan && (
          <div style={{ flex: "1 1 100%", fontSize: FONT.xs.size + 1, lineHeight: 1.7, color: T.text }}>
            {/* Synthèse */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginBottom: 8 }}>
              {[
                [s.analyses, "ouvrages Profero analysés"], [s.lies, "ouvrages liés à ProGBat"], [s.a_importer, "cadences à importer", "#4db8ff"],
                [s.identiques, "cadences déjà identiques", "#22c55e"], [s.non_exploitables, "cadences non exploitables", s.non_exploitables ? "#f59e0b" : null],
                [s.non_lies, "ouvrages non liés"], [s.ecarts_importants, "écarts importants (> 50 % ou ×/÷ 2)", s.ecarts_importants ? "#f59e0b" : null], [s.ecritures, "écriture effectuée"],
              ].map(([n, label, color]) => (
                <div key={label} style={{ padding: "6px 10px", borderRadius: RADIUS.md, background: T.surface, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: color || T.text }}>{n}</div>
                  <div style={{ color: T.textSub, fontSize: FONT.xs.size }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ color: T.textMuted, fontSize: FONT.xs.size }}>
              Méthode : {analyse.plan.methode} · {analyse.plan.endpoint} · jobs horaires reconnus : {(analyse.plan.jobs_horaires || []).map((j) => `${j.id} ${j.label || j.code}`).join(", ") || "aucun"}
              {(analyse.plan.jobs_ignores || []).length > 0 && ` · jobs ignorés : ${analyse.plan.jobs_ignores.map((j) => `${j.id} (${j.raison})`).join(", ")}`}
              {analyse.progbat?.nb_compositions_en_erreur > 0 && <span style={{ color: "#e15a5a" }}> · {analyse.progbat.nb_compositions_en_erreur} composition(s) en erreur de lecture</span>}
              <br/>Plan figé côté serveur le {fmtDate(analyse.plan.prepared_at)}, valable jusqu’à {fmtDate(analyse.valide_jusqua)} · hash {String(analyse.planHash).slice(0, 12)}…
            </div>

            {/* Filtres */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 10px", alignItems: "center" }}>
              {FILTRES.map(([k, label]) => chip(filtre === k, `${label} (${compteFiltre(k)})`, () => setFiltre(k), k === "changements" ? "#4db8ff" : k === "identiques" ? "#22c55e" : k === "anomalies" ? "#f59e0b" : undefined))}
              <div style={{ flex: 1 }} />
              <button onClick={() => setConfirmation(true)} disabled={!s.a_importer || importLoading} style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
                background: s.a_importer ? acc.accent : T.border, color: s.a_importer ? acc.onAccent : T.textMuted,
                fontFamily: "inherit", fontWeight: 800, cursor: s.a_importer ? "pointer" : "not-allowed",
              }}><Icon as={Download} size={13}/>{s.a_importer ? `Confirmer l’import (${s.a_importer})` : "0 cadence à modifier"}</button>
            </div>

            {/* Tableau */}
            <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.md }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={th}>Code</th>
                    <th style={th}>Ouvrage Profero</th>
                    <th style={{ ...th, textAlign: "right" }}>ID ProGBat</th>
                    <th style={{ ...th, textAlign: "right" }}>Cadence Profero</th>
                    <th style={{ ...th, textAlign: "right" }}>Cadence ProGBat</th>
                    <th style={{ ...th, textAlign: "right" }}>Écart</th>
                    <th style={th}>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.length === 0 && <tr><td style={{ ...td, color: T.textSub }} colSpan={7}>Aucun ouvrage pour ce filtre.</td></tr>}
                  {lignes.map((l) => (
                    <tr key={l.ouvrage_id} style={l.ecart_important && l.statut === STATUTS.a_importer ? { background: "rgba(245,158,11,.08)" } : undefined}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{l.code || <span style={{ color: T.textMuted }}>—</span>}</td>
                      <td style={{ ...td, maxWidth: 380 }} title={l.libelle}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{l.libelle_court}</div>
                        {l.statut === STATUTS.a_importer && (
                          <div style={{ color: T.textSub, fontSize: FONT.xs.size }}>
                            Cadence Profero : {formatCadence(l.cadence_avant, l.unite)} · Cadence ProGBat : {formatCadence(l.cadence_apres, l.unite)} · Écart : {fmtEcart(l)}
                          </div>
                        )}
                        {l.anomalies?.length > 0 && <ul style={{ margin: "2px 0 0", paddingLeft: 14, color: "#e15a5a", fontSize: FONT.xs.size }}>{l.anomalies.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                        {l.avertissements?.length > 0 && <ul style={{ margin: "2px 0 0", paddingLeft: 14, color: "#f59e0b", fontSize: FONT.xs.size }}>{l.avertissements.map((a, i) => <li key={i}>{a}</li>)}</ul>}
                      </td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{l.progbat_id || <span style={{ color: T.textMuted }}>—</span>}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{formatCadence(l.cadence_avant, l.unite)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontWeight: l.statut === STATUTS.a_importer ? 800 : 400 }}>{formatCadence(l.cadence_apres, l.unite)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", color: l.ecart_important ? "#f59e0b" : T.text, fontWeight: l.ecart_important ? 800 : 400 }}>
                        {l.ecart_important && <Icon as={AlertTriangle} size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />}{fmtEcart(l)}
                      </td>
                      <td style={td}>{badge(l.statut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, color: T.textMuted, fontSize: FONT.xs.size }}>
              Les lignes surlignées présentent un écart important : elles restent importables si la donnée ProGBat est certaine, mais méritent un contrôle avant confirmation. Une cadence absente, nulle, négative ou ambiguë n’écrase jamais une cadence Profero.
            </div>
          </div>
        )}
      </div>

      {confirmation && analyse?.plan && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.62)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={() => !importLoading && setConfirmation(false)}>
          <div onMouseDown={(e) => e.stopPropagation()} style={{ width: "min(600px,96vw)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <Icon as={ShieldCheck} size={20} color={acc.accent}/>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Importer les cadences ProGBat dans Profero ?</div>
            </div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", color: T.textSub, lineHeight: 1.6, fontSize: FONT.sm.size }}>
              {texteConfirmation(s).split("\n").slice(2).join("\n")}
            </pre>
            {s.ecarts_importants > 0 && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: RADIUS.md, background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)", color: T.text }}>
                <Icon as={AlertTriangle} size={12} style={{ color: "#f59e0b", marginRight: 6, verticalAlign: "-1px" }}/>
                {s.ecarts_importants} cadence(s) présentent un écart important (variation &gt; 50 % ou ×/÷ 2). Vérifier le filtre « Changements » avant d’importer.
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
              <button onClick={() => setConfirmation(false)} disabled={importLoading} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", cursor: "pointer" }}><Icon as={X} size={12}/>Annuler</button>
              <button onClick={importer} disabled={importLoading} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent, fontFamily: "inherit", fontWeight: 800, cursor: importLoading ? "wait" : "pointer" }}>
                <Icon as={Check} size={12}/>{importLoading ? "Import en cours…" : "Importer les cadences"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
