// src/Renovation/ProgbatInventaireAdmin.jsx — Réglages → Outils → Maintenance
// Inventaire en lecture seule, puis synchronisation conservatrice explicitement
// confirmée : lier les codes uniques et créer les absents sous « Ouvrages V2 ».
// Jamais de modification/suppression d'une structure ProGBat existante.
import React, { useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { RefreshCw, Boxes, AlertTriangle, Check, X, Link2, UploadCloud, ShieldCheck } from "lucide-react";
import { STATUTS_ORDRE, STATUTS_LABELS } from "./progbatInventaire.mjs";
import ProgbatClassementFamilles from "./ProgbatClassementFamilles";

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
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncPlan, setSyncPlan] = useState(null);
  const [syncErreur, setSyncErreur] = useState(null);
  const [syncResultat, setSyncResultat] = useState(null);
  const [confirmation, setConfirmation] = useState(false);

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

  const preparerSynchronisation = async () => {
    setSyncLoading(true); setSyncErreur(null); setSyncResultat(null); setConfirmation(false);
    try {
      const { data, error } = await supabase.functions.invoke("progbat-library-sync", { body: { action: "prepare" } });
      if (error && !data) throw error;
      if (!data?.ok) throw new Error(data?.error || "Préparation de la synchronisation impossible.");
      setSyncPlan(data);
    } catch (e) { setSyncErreur(e?.message || "Erreur inattendue."); }
    setSyncLoading(false);
  };

  const executerSynchronisation = async () => {
    if (!syncPlan?.planHash) return;
    setSyncLoading(true); setSyncErreur(null);
    try {
      const { data, error } = await supabase.functions.invoke("progbat-library-sync", {
        body: { action: "sync", expectedPlanHash: syncPlan.planHash, confirmed: true },
      });
      if (error && !data) throw error;
      if (!data) throw new Error("Réponse vide de la synchronisation.");
      setSyncResultat(data); setConfirmation(false); setSyncPlan(null);
      await analyser();
      if (!data.ok && !data.resultats) setSyncErreur(data.error || "Synchronisation interrompue.");
    } catch (e) { setSyncErreur(e?.message || "Connexion interrompue : vérifier ProGBat avant de recommencer."); }
    setSyncLoading(false);
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
  const SOURCE_LABEL = { descriptif: "descriptif", libelle: "libellé", champ: "champ API" };
  // Correspondance ProGBat : code MÉTIER détecté + source exacte, identifiant
  // numérique, libellé nettoyé ; le code technique API en ligne secondaire.
  // Tous les textes arrivent déjà nettoyés du HTML par la fonction (jamais de innerHTML ici).
  const Candidat = ({ c }) => (
    <div>
      <div style={{ fontWeight: 600 }}>
        {c.code
          ? <>{c.code}<span style={{ color: T.textMuted, fontWeight: 500 }}> (source : {SOURCE_LABEL[c.source_code] || "?"})</span></>
          : <span style={{ color: T.textMuted }}>sans code métier détectable</span>}
        <span style={{ color: T.textMuted, fontWeight: 500 }}> · id ProGBat {c.id}{c.unitCode ? ` · ${c.unitCode}` : ""}</span>
      </div>
      <div style={{ color: T.textSub }} title={c.descriptif || c.label}>{c.label || <em>sans libellé</em>}</div>
      {c.descriptif && c.descriptif !== c.label && (
        <div style={{ color: T.textMuted, fontSize: FONT.xs.size, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }} title={c.descriptif}>{c.descriptif}</div>
      )}
      {c.code_api && <div style={{ color: T.textMuted, fontSize: FONT.xs.size }}>code technique API : {c.code_api}</div>}
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
        L’analyse et la préparation sont en lecture seule. Une écriture n’a lieu qu’après l’aperçu et une confirmation explicite.
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
        {result && <button onClick={preparerSynchronisation} disabled={syncLoading || loading} style={{
          display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: RADIUS.md,
          border: `1px solid ${acc.accent}`, background: "transparent", color: acc.accent,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800,
          cursor: syncLoading || loading ? "not-allowed" : "pointer", opacity: syncLoading || loading ? .55 : 1,
        }}>
          <Icon as={ShieldCheck} size={12}/>{syncLoading ? "Préparation…" : "Préparer la synchronisation"}
        </button>}

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

        {syncErreur && <div style={{ flex: "1 1 100%", color: "#e15a5a", fontSize: FONT.xs.size + 1, fontWeight: 700 }}>⚠ {syncErreur}</div>}
        {syncResultat && <div style={{ flex: "1 1 100%", padding: "9px 12px", borderRadius: RADIUS.md,
          color: syncResultat.ok ? "#22c55e" : "#f59e0b", background: syncResultat.ok ? "rgba(34,197,94,.08)" : "rgba(245,158,11,.08)",
          border: `1px solid ${syncResultat.ok ? "rgba(34,197,94,.28)" : "rgba(245,158,11,.28)"}`, fontWeight: 700 }}>
          Synchronisation terminée : {syncResultat.compteurs?.linked || 0} liaison(s), {syncResultat.compteurs?.created || 0} création(s)
          {(syncResultat.compteurs?.failed || syncResultat.compteurs?.uncertain || syncResultat.compteurs?.conflit) ? ` · ${syncResultat.compteurs?.failed || 0} échec(s), ${syncResultat.compteurs?.uncertain || 0} état(s) incertain(s), ${syncResultat.compteurs?.conflit || 0} conflit(s)` : ""}.
          {(syncResultat.compteurs?.uncertain || 0) > 0 && <div>Vérifier manuellement dans ProGBat avant toute nouvelle tentative.</div>}
        </div>}

        {syncPlan?.plan && (
          <div style={{ flex: "1 1 100%", padding: 12, borderRadius: RADIUS.md, background: T.surface, border: `1px solid ${T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, color: T.text }}>Plan de synchronisation contrôlé par le serveur</div>
                <div style={{ color: T.textSub }}>
                  <strong>{syncPlan.plan.compteurs.a_lier}</strong> code(s) unique(s) à lier · <strong>{syncPlan.plan.compteurs.a_creer}</strong> ouvrage(s) à créer · <strong>{syncPlan.plan.compteurs.exclus}</strong> exclu(s)
                </div>
                <div style={{ color: syncPlan.plan.dossier?.ok ? "#22c55e" : "#f59e0b" }}>
                  Famille cible : {syncPlan.plan.famille?.ok ? `Ouvrages V2 (id ${syncPlan.plan.famille.id})` : syncPlan.plan.famille?.erreur}
                  {syncPlan.plan.taxe ? ` · TVA ${syncPlan.plan.taxe.rate} %` : " · TVA par défaut non configurée"}
                </div>
              </div>
              <button onClick={() => setConfirmation(true)} disabled={!syncPlan.plan.compteurs.total || syncLoading} style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: RADIUS.md, border: "none",
                background: syncPlan.plan.compteurs.total ? acc.accent : T.border, color: syncPlan.plan.compteurs.total ? acc.onAccent : T.textMuted,
                fontFamily: "inherit", fontWeight: 800, cursor: syncPlan.plan.compteurs.total ? "pointer" : "not-allowed",
              }}><Icon as={UploadCloud} size={13}/>Synchroniser</button>
            </div>
            <div style={{ marginTop: 8, color: T.textMuted }}>
              Garanties : aucun ouvrage ProGBat existant modifié, aucune suppression, aucun matériau créé. Les créations reprennent le coût et le prix de vente calculés dans Profero.
            </div>
            {syncPlan.plan.actions?.length > 0 && <div style={{ marginTop: 8, maxHeight: 180, overflowY: "auto", borderTop: `1px solid ${T.border}` }}>
              {syncPlan.plan.actions.map(a => <div key={`${a.type}-${a.ouvrageId}`} style={{ display: "flex", gap: 8, padding: "5px 2px", borderBottom: `1px solid ${T.border}` }}>
                <Icon as={a.type === "link" ? Link2 : UploadCloud} size={12} style={{ marginTop: 3, color: a.type === "link" ? "#4db8ff" : "#22c55e" }}/>
                <span><strong>{a.code}</strong> — {a.libelle} · {a.type === "link" ? `lier à l’id ProGBat ${a.progbatId}` : `créer à ${fmtPrix(a.payload?.saleNetUnitPrice)} HT`}</span>
              </div>)}
            </div>}
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
                <span>Codes métier ProGBat : <strong style={{ color: T.text }}>{result.sources_codes.descriptif ?? 0}</strong> lus dans le descriptif · <strong style={{ color: T.text }}>{result.sources_codes.libelle}</strong> dans le libellé · <strong style={{ color: T.text }}>{result.sources_codes.champ}</strong> dans le champ API · <strong style={{ color: T.text }}>{result.sources_codes.aucun}</strong> sans code détectable</span>
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
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th style={th}>Id ProGBat</th>
                        <th style={th}>Code métier</th>
                        <th style={th}>Source</th>
                        <th style={th}>Libellé</th>
                        <th style={th}>Code technique API</th>
                        <th style={th}>Unité</th>
                        <th style={th}>PV HT</th>
                        <th style={th}>Actif</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.progbat_non_lies.map(s => (
                        <tr key={s.id}>
                          <td style={td}>{s.id}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{s.code || "—"}</td>
                          <td style={{ ...td, color: T.textSub }}>{SOURCE_LABEL[s.source_code] || "—"}</td>
                          <td style={{ ...td, maxWidth: 420 }} title={s.descriptif || s.label}>
                            {s.label || <em style={{ color: T.textMuted }}>sans libellé</em>}
                            {s.descriptif && s.descriptif !== s.label && <div style={{ color: T.textMuted, fontSize: FONT.xs.size, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.descriptif}</div>}
                          </td>
                          <td style={{ ...td, color: T.textMuted, fontSize: FONT.xs.size, maxWidth: 220, wordBreak: "break-all" }}>{s.code_api || "—"}</td>
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
      <ProgbatClassementFamilles T={T} acc={acc} />
      {confirmation && syncPlan?.plan && <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.62)", display: "grid", placeItems: "center", padding: 20 }} onMouseDown={() => !syncLoading && setConfirmation(false)}>
        <div onMouseDown={e => e.stopPropagation()} style={{ width: "min(580px,96vw)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: 20, boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}><Icon as={ShieldCheck} size={20} color={acc.accent}/><div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Confirmer la synchronisation</div></div>
          <div style={{ color: T.textSub, lineHeight: 1.6 }}>
            Profero va enregistrer <strong>{syncPlan.plan.compteurs.a_lier} liaison(s)</strong> par code unique et créer <strong>{syncPlan.plan.compteurs.a_creer} nouvel(aux) ouvrage(s)</strong> dans « Ouvrages V2 ».
          </div>
          <div style={{ marginTop: 10, padding: 10, borderRadius: RADIUS.md, background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.25)", color: T.text }}>
            Aucun ouvrage existant ne sera modifié ou supprimé dans ProGBat.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
            <button onClick={() => setConfirmation(false)} disabled={syncLoading} style={{ padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", cursor: "pointer" }}>Annuler</button>
            <button onClick={executerSynchronisation} disabled={syncLoading} style={{ padding: "8px 14px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent, fontFamily: "inherit", fontWeight: 800, cursor: syncLoading ? "wait" : "pointer" }}>{syncLoading ? "Synchronisation…" : "Confirmer"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
