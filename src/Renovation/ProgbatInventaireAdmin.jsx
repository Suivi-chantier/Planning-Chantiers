// src/Renovation/ProgbatInventaireAdmin.jsx — Réglages → Outils → Maintenance
// Carte « Inventaire de la bibliothèque » : simulation EN LECTURE SEULE du
// rapprochement bibliothèque Profero ↔ structures ProGBat, via l'Edge Function
// progbat-library-inventory (supabase.functions.invoke : la session est
// transmise automatiquement ; aucun jeton ni en-tête n'est manipulé ici).
// Aucun bouton d'écriture (synchroniser / créer / lier / modifier / supprimer).
import React, { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { RefreshCw, Boxes, AlertTriangle, Check, X } from "lucide-react";
import { STATUTS_ORDRE, STATUTS_LABELS } from "./progbatInventaire.mjs";

const COULEURS_STATUT = {
  deja_lie: "#22c55e",
  correspondance_code_a_confirmer: "#4db8ff",
  ambigu: "#f59e0b",
  correspondance_libelle_a_examiner: "#c084fc",
  nouveau_a_creer: "#9aa5c0",
  progbat_non_lie: "#e15a5a",
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const fmtPrix = (n) => (typeof n === "number" && Number.isFinite(n)) ? n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "—";

export default function ProgbatInventaire({ T, acc }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [filtre, setFiltre] = useState("tous");
  const [seulementBloques, setSeulementBloques] = useState(false);

  const analyser = async () => {
    setLoading(true); setErreur(null);
    try {
      const { data, error } = await supabase.functions.invoke("progbat-library-inventory");
      if (error && !data) {
        let body = null;
        try { body = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
        setErreur({ message: body?.error || error.message || "Appel de la fonction impossible.", status: body?.progbat_status ?? null });
      } else if (data && data.ok) {
        setResult(data); setFiltre("tous"); setSeulementBloques(false);
      } else {
        setErreur({ message: data?.error || "Réponse inattendue de la fonction.", status: data?.progbat_status ?? null, etape: data?.etape, progbat: data?.progbat });
      }
    } catch (e) {
      setErreur({ message: e?.message || "Erreur inattendue.", status: null });
    }
    setLoading(false);
  };

  const lignes = useMemo(() => {
    if (!result) return [];
    return (result.rapprochements || []).filter(r =>
      (filtre === "tous" || r.statut === filtre) && (!seulementBloques || !r.synchronisable)
    );
  }, [result, filtre, seulementBloques]);

  const th = { textAlign: "left", padding: "6px 8px", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted, borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" };
  const td = { padding: "6px 8px", fontSize: FONT.xs.size + 1, color: T.text, borderBottom: `1px solid ${T.border}`, verticalAlign: "top" };
  const badge = (statut) => (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: FONT.xs.size, fontWeight: 700, color: COULEURS_STATUT[statut] || T.textSub, background: `${COULEURS_STATUT[statut] || "#888"}22`, whiteSpace: "nowrap" }}>
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
  const SOURCE_LABEL = { champ: "champ API", libelle: "libellé" };
  // Correspondance ProGBat : code détecté + sa source, puis libellé original.
  const Candidat = ({ c }) => (
    <div>
      <div style={{ fontWeight: 600 }}>
        {c.code
          ? <>{c.code}<span style={{ color: T.textMuted, fontWeight: 500 }}> ({SOURCE_LABEL[c.source_code] || "?"}{c.code_api && c.code_api !== c.code ? `, champ brut « ${c.code_api} »` : ""})</span></>
          : <span style={{ color: T.textMuted }}>sans code détectable</span>}
        <span style={{ color: T.textMuted, fontWeight: 500 }}> · id {c.id}{c.unitCode ? ` · ${c.unitCode}` : ""}</span>
      </div>
      <div style={{ color: T.textSub }} title={c.label}>{c.label}</div>
      {c.prix_vente_ht != null && <div style={{ color: T.textMuted, fontSize: FONT.xs.size }}>PV HT ProGBat {fmtPrix(c.prix_vente_ht)}</div>}
    </div>
  );

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 14, marginTop: 14 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
        <Icon as={Boxes} size={11} />
        Inventaire de la bibliothèque
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 12, borderRadius: RADIUS.md, background: "rgba(77,184,255,0.10)", border: "1px solid rgba(77,184,255,0.35)", color: T.text, fontSize: FONT.xs.size + 1, fontWeight: 700 }}>
        <Icon as={AlertTriangle} size={13} style={{ color: "#4db8ff" }} />
        Simulation en lecture seule — aucune donnée ProGBat ou Profero n’est modifiée.
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", background: T.card, borderRadius: RADIUS.md }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, marginBottom: 2 }}>Analyser la bibliothèque</div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.55 }}>
            Compare les ouvrages Profero avec les ouvrages (« structures ») de ProGBat : déjà liés, codes identiques à confirmer, ambiguïtés, nouveaux à créer, ouvrages présents uniquement dans ProGBat, et ouvrages Profero incomplets. Rien n’est enregistré.
          </div>
          <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 4 }}>
            Dernière analyse : {result ? fmtDate(result.analyse_le) : "aucune dans cette session"}
          </div>
        </div>
        <button onClick={analyser} disabled={loading} style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
          background: loading ? T.border : acc.accent, color: loading ? T.textMuted : acc.onAccent,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer",
        }}>
          <Icon as={RefreshCw} size={11} style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
          {loading ? "Analyse en cours…" : "Analyser la bibliothèque"}
        </button>

        {erreur && (
          <div style={{ flex: "1 1 100%", fontSize: FONT.xs.size + 1, lineHeight: 1.6, color: "#e15a5a", fontWeight: 600 }}>
            ⚠ {erreur.message}{erreur.status ? ` · code HTTP ProGBat ${erreur.status}` : ""}{erreur.etape ? ` · étape « ${erreur.etape} »` : ""}
            {erreur.progbat && (
              <div style={{ color: T.textSub, fontWeight: 500, marginTop: 4 }}>
                {Object.entries(erreur.progbat).map(([k, v]) => `${k} : HTTP ${v?.status ?? "—"}${v?.erreur ? ` (${v.erreur})` : ""}`).join(" · ")}
              </div>
            )}
          </div>
        )}

        {result && (
          <div style={{ flex: "1 1 100%", fontSize: FONT.xs.size + 1, lineHeight: 1.7, color: T.text }}>
            {/* Synthèse */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", color: T.textSub, marginBottom: 8 }}>
              <span>Compte ProGBat : <strong style={{ color: T.text }}>{[result.compte_progbat?.prenom, result.compte_progbat?.nom].filter(Boolean).join(" ") || "—"}</strong></span>
              <span>Ouvrages Profero : <strong style={{ color: T.text }}>{result.nb_ouvrages_profero}</strong></span>
              <span>Ouvrages ProGBat : <strong style={{ color: T.text }}>{result.nb_structures_progbat}</strong>{result.progbat?.structures?.pages > 1 ? ` (${result.progbat.structures.pages} pages)` : ""}</span>
              <span>Éléments ProGBat : <strong style={{ color: T.text }}>{result.progbat?.elements?.ok ? result.nb_elements_progbat : `HTTP ${result.progbat?.elements?.status ?? "—"}`}</strong></span>
              <span>TVA ProGBat : <strong style={{ color: T.text }}>{result.progbat?.taxes?.ok ? ((result.taux_tva || []).map(t => `${t.rate}${t.saleDefault ? " (défaut)" : ""}`).join(" · ") || "aucune") : `HTTP ${result.progbat?.taxes?.status ?? "—"}`}</strong></span>
              <span>Prêts à synchroniser : <strong style={{ color: T.text }}>{result.nb_synchronisables} / {result.nb_ouvrages_profero}</strong></span>
              {result.sources_codes && (
                <span>Codes ProGBat : <strong style={{ color: T.text }}>{result.sources_codes.champ}</strong> dans le champ API · <strong style={{ color: T.text }}>{result.sources_codes.libelle}</strong> extraits du libellé · <strong style={{ color: T.text }}>{result.sources_codes.aucun}</strong> sans code détectable</span>
              )}
              {result.profero?.tva_defaut == null && <span style={{ color: "#f59e0b" }}>TVA par défaut du chiffrage non réglée</span>}
              {result.profero?.cout_horaire == null && <span style={{ color: "#f59e0b" }}>Coût horaire de référence non réglé</span>}
            </div>
            {(result.progbat?.structures?.tronque || result.progbat?.elements?.tronque) && (
              <div style={{ color: "#f59e0b", fontWeight: 600 }}>⚠ Liste ProGBat tronquée (plafond de pages atteint) : le comptage est partiel.</div>
            )}
            {(result.progbat?.elements?.erreur || result.progbat?.taxes?.erreur || result.progbat?.unites?.erreur) && (
              <div style={{ color: T.textSub }}>
                {["elements", "taxes", "unites"].filter(k => result.progbat?.[k]?.erreur).map(k => `${k} : ${result.progbat[k].erreur}`).join(" · ")}
              </div>
            )}

            {/* Compteurs / filtres par statut */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "8px 0 10px" }}>
              {chip(filtre === "tous", `Tous (${result.nb_ouvrages_profero})`, () => setFiltre("tous"))}
              {STATUTS_ORDRE.filter(s => s !== "progbat_non_lie").map(s =>
                chip(filtre === s, `${STATUTS_LABELS[s]} (${result.compteurs?.[s] ?? 0})`, () => setFiltre(s), COULEURS_STATUT[s])
              )}
              {chip(seulementBloques, `Bloqués (${(result.bloques || []).length})`, () => setSeulementBloques(v => !v), "#e15a5a")}
            </div>

            {/* Tableau des rapprochements */}
            <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.md }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={th}>Code Profero</th>
                    <th style={th}>Libellé Profero</th>
                    <th style={th}>Unité</th>
                    <th style={th}>Id ProGBat</th>
                    <th style={th}>Correspondance ProGBat proposée</th>
                    <th style={th}>Statut</th>
                    <th style={th}>Prêt</th>
                    <th style={th}>Blocages</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.length === 0 && (
                    <tr><td style={{ ...td, color: T.textSub }} colSpan={8}>Aucun ouvrage pour ce filtre.</td></tr>
                  )}
                  {lignes.map(r => (
                    <tr key={r.profero.id || r.profero.libelle}>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r.profero.code || <span style={{ color: T.textMuted }}>—</span>}</td>
                      <td style={{ ...td, maxWidth: 360 }} title={r.profero.libelle}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.profero.libelle_court}</div>
                        {r.prix?.prix_vente_ht != null && <div style={{ color: T.textMuted, fontSize: FONT.xs.size }}>PV HT {fmtPrix(r.prix.prix_vente_ht)}</div>}
                      </td>
                      <td style={td}>{r.profero.unite || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{r.profero.progbat_id || <span style={{ color: T.textMuted }}>—</span>}</td>
                      <td style={{ ...td, maxWidth: 320 }}>
                        {r.correspondance && <Candidat c={r.correspondance} />}
                        {!r.correspondance && r.candidats?.length > 0 && (
                          <div style={{ display: "grid", gap: 6 }}>
                            {r.candidats.map(c => <Candidat key={c.id} c={c} />)}
                          </div>
                        )}
                        {!r.correspondance && !(r.candidats?.length) && <span style={{ color: T.textMuted }}>—</span>}
                        {r.notes?.length > 0 && <div style={{ color: "#f59e0b", fontSize: FONT.xs.size }}>{r.notes.join(" · ")}</div>}
                      </td>
                      <td style={td}>{badge(r.statut)}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {r.synchronisable
                          ? <Icon as={Check} size={13} style={{ color: "#22c55e" }} />
                          : <Icon as={X} size={13} style={{ color: "#e15a5a" }} />}
                      </td>
                      <td style={{ ...td, maxWidth: 320, color: r.blocages?.length ? "#e15a5a" : T.textMuted }}>
                        {r.blocages?.length ? (
                          <ul style={{ margin: 0, paddingLeft: 14 }}>{r.blocages.map((b, i) => <li key={i}>{b}</li>)}</ul>
                        ) : "—"}
                        {r.avertissements?.length > 0 && (
                          <ul style={{ margin: "2px 0 0", paddingLeft: 14, color: "#f59e0b" }}>{r.avertissements.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Motifs de blocage */}
            {(result.motifs_blocage || []).length > 0 && (
              <div style={{ marginTop: 10, color: T.textSub }}>
                <div style={{ fontWeight: 700, color: T.text }}>Principaux motifs de blocage</div>
                <ul style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                  {result.motifs_blocage.slice(0, 8).map(m => <li key={m.motif}>{m.motif} — <strong>{m.nb}</strong></li>)}
                </ul>
              </div>
            )}

            {/* Ouvrages présents uniquement dans ProGBat */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>
                Ouvrages ProGBat sans équivalent Profero ({(result.progbat_non_lies || []).length})
              </div>
              <div style={{ color: T.textSub, marginBottom: 6 }}>Signalés pour information : ils ne seront jamais supprimés automatiquement.</div>
              {(result.progbat_non_lies || []).length > 0 && (
                <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.md }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th style={th}>Id ProGBat</th>
                        <th style={th}>Code détecté</th>
                        <th style={th}>Source</th>
                        <th style={th}>Libellé</th>
                        <th style={th}>Unité</th>
                        <th style={th}>PV HT</th>
                        <th style={th}>Actif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.progbat_non_lies.map(s => (
                        <tr key={s.id}>
                          <td style={td}>{s.id}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{s.code || "—"}{s.code_api && s.code_api !== s.code ? <div style={{ color: T.textMuted, fontWeight: 500, fontSize: FONT.xs.size }}>champ brut « {s.code_api} »</div> : null}</td>
                          <td style={{ ...td, color: T.textSub }}>{SOURCE_LABEL[s.source_code] || "—"}</td>
                          <td style={{ ...td, maxWidth: 480 }}>{s.label}</td>
                          <td style={td}>{s.unitCode || "—"}</td>
                          <td style={td}>{fmtPrix(s.prix_vente_ht)}</td>
                          <td style={td}>{s.actif ? "oui" : "non"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, color: T.textMuted, fontSize: FONT.xs.size }}>
              {result.message} Analyse du {fmtDate(result.analyse_le)} en {Math.round((result.duree_ms || 0) / 100) / 10} s.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
