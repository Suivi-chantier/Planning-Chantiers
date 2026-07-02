import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, photoTransform } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import {
  Receipt, Image as ImageIcon, Camera, Loader2, Check, X, AlertTriangle,
  ChevronLeft, FileText, Plus, Link2, CheckCircle2, Search,
} from "lucide-react";

const EDGE_ANALYSE_FACTURE =
  "https://yooksnzhlffqgpzkcjhl.supabase.co/functions/v1/analyse-facture";

// Tolérance d'écart de montant (remises, arrondis) avant de signaler un "écart"
const TOLERANCE_ECART = 1.0;

function toNum(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

// Normalisation pour l'appariement par numéro (trim, casse, espaces)
const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");

async function uploadPhoto(file, pathPrefix) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `${pathPrefix}/${safe}`;
    const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
    if (error) return { error: error.message || "Erreur upload" };
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    if (!data?.publicUrl) return { error: "URL publique introuvable" };
    return { url: data.publicUrl };
  } catch (e) {
    return { error: e.message || "Erreur réseau" };
  }
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result).split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// `images` = [{ base64, mediaType }] (facture pouvant tenir sur plusieurs pages).
async function analyseFacture(images) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(EDGE_ANALYSE_FACTURE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session?.access_token}`,
      "apikey": import.meta.env.VITE_SUPABASE_KEY,
    },
    body: JSON.stringify({ images }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Erreur Edge Function");
  const anthropic = data.content ? data : (data.data || data);
  const textContent = anthropic.content?.find(c => c.type === "text")?.text || "";
  let clean = textContent.replace(/```json|```/g, "").trim();
  if (clean[0] !== "{") {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) clean = match[0];
  }
  return JSON.parse(clean);
}

// "2026-06" -> "juin 2026"
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function moisLabel(ym) {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
}

// Modale de détail : facture (avec ses BL rapprochés) ou reçu/ticket comptant (avec ses lignes).
function HistoDetail({ item, chantiersMap, T, acc, onClose }) {
  const isFacture = item.kind === "facture";
  const c = item.row;
  const [blLignes, setBlLignes] = useState([]);
  useEffect(() => {
    if (isFacture) {
      supabase.from("facture_bl").select("bl_numero, montant_ht, statut").eq("facture_id", c.id)
        .then(({ data }) => setBlLignes(data || []));
    }
  }, [isFacture, c.id]);
  const dateStr = (d) => d ? new Date(d).toLocaleDateString("fr-FR") : "—";
  const fmtEur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nomCh = (id) => chantiersMap[String(id)]?.nom || (id ? String(id) : "—");
  const lignes = c.lignes || [];
  const info = (label, val) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: FONT.sm.size, color: T.textSub }}>{label}</span>
      <span style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 600, textAlign: "right" }}>{val}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000 }} />
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1001, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div onClick={e => e.stopPropagation()} style={{
          background: T.surface, width: "100%", maxWidth: 620, maxHeight: "92vh",
          borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
          display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -8px 40px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "flex-start", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.fournisseur_nom || (isFacture ? "Facture" : "Reçu")}</div>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginTop: 2 }}>{isFacture ? "Facture fournisseur" : "Reçu / ticket payé comptant"}</div>
            </div>
            <button onClick={onClose} aria-label="Fermer" style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: T.text, cursor: "pointer", flexShrink: 0 }}>
              <Icon as={X} size={18} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
            {c.photo_url && (
              <a href={c.photo_url} target="_blank" rel="noreferrer">
                <img src={photoTransform(c.photo_url, { width: 560, quality: 70 })} alt="" style={{ width: "100%", borderRadius: RADIUS.md, marginBottom: SPACING.md, border: `1px solid ${T.border}` }} />
              </a>
            )}
            {isFacture ? (
              <>
                {info("Numéro", c.numero || "—")}
                {info("Date", dateStr(c.date_facture))}
                {info("Période", c.periode || "—")}
                {info("Montant HT", `${fmtEur(c.montant_ht)} €`)}
                {info("Statut", c.statut === "rapprochee" ? "Rapprochée" : c.statut === "archivee" ? "Archivée" : "À rapprocher")}
                <div style={{ fontSize: FONT.xs.size, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: T.textSub, margin: "14px 0 6px" }}>
                  BL rapprochés ({blLignes.length})
                </div>
                {blLignes.length === 0 ? (
                  <div style={{ fontSize: FONT.sm.size, color: T.textSub, fontStyle: "italic" }}>Aucun BL rattaché (facture archivée sans rapprochement).</div>
                ) : blLignes.map((b, i) => {
                  const sem = b.statut === "rapproche" ? SEMANTIC.success : b.statut === "ecart" ? SEMANTIC.warning : SEMANTIC.danger;
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ fontSize: FONT.sm.size, color: T.text }}>BL n° {b.bl_numero || "?"}</span>
                      <span style={{ fontSize: FONT.sm.size, color: T.textSub }}>{b.montant_ht != null ? `${fmtEur(b.montant_ht)} €` : "—"}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, color: sem.color }}>{b.statut}</span>
                    </div>
                  );
                })}
              </>
            ) : (
              <>
                {info("Type", c.doc_type === "ticket" ? "Ticket" : c.doc_type === "bl" ? "Bon de livraison" : "Bon de commande")}
                {info("Numéro", c.doc_numero || "—")}
                {info("Date", dateStr(c.date_doc))}
                {info("Montant HT", `${fmtEur(c.montant_ht)} €`)}
                <div style={{ fontSize: FONT.xs.size, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, color: T.textSub, margin: "14px 0 6px" }}>
                  Articles ({lignes.length})
                </div>
                {lignes.map(l => (
                  <div key={l.id} style={{ padding: "7px 0", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <span style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 600 }}>{l.libelle || "—"}</span>
                      <span style={{ fontSize: FONT.sm.size, color: T.textSub, whiteSpace: "nowrap" }}>
                        {l.quantite != null ? `${l.quantite}${l.unite ? " " + l.unite : ""}` : ""}
                        {l.prix_total != null ? ` · ${fmtEur(l.prix_total)} €` : ""}
                      </span>
                    </div>
                    {l.chantier_id && <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 2 }}>↳ {nomCh(l.chantier_id)}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function RapprochementFactures({ T, branch = "renovation", profil = null }) {
  const acc = getBranchAccent(branch);
  const [step, setStep] = useState("home"); // home | capture | analyzing | review
  const [historique, setHistorique] = useState([]); // factures + reçus/tickets comptant
  const [loadingHist, setLoadingHist] = useState(true);
  const [detail, setDetail] = useState(null);        // { kind, row } affiché dans la modale
  const [recherche, setRecherche] = useState("");
  const [chantiersMap, setChantiersMap] = useState({}); // id -> { nom, couleur }
  const [photoUrl, setPhotoUrl] = useState("");
  const [photos, setPhotos] = useState([]); // [{ file, preview, mediaType }] — facture multi-pages
  const [iaErr, setIaErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [fact, setFact] = useState({ fournisseur: "", numero: "", date_facture: "", periode: "", montant_ht: "" });
  const [bls, setBls] = useState([]); // { bl_numero, montant_ht, commande_id, commandeMontant, fournisseurCmd, statut }
  const fileCam = useRef(null);
  const fileGal = useRef(null);

  // Historique complet = factures + reçus/tickets payés comptant (commandes
  // doc_type='ticket' ou type_evenement='comptoir'), unifiés et triés par date.
  const loadHistorique = useCallback(async () => {
    setLoadingHist(true);
    const [fRes, cRes] = await Promise.all([
      supabase.from("factures")
        .select("id, fournisseur_nom, numero, date_facture, periode, montant_ht, statut, photo_url, created_at")
        .order("created_at", { ascending: false }).limit(1000),
      supabase.from("commandes")
        .select("id, fournisseur_nom, doc_numero, doc_type, type_evenement, date_doc, montant_ht, statut_completude, statut_facturation, photo_url, notes, created_at, lignes:commande_lignes(id, libelle, quantite, unite, prix_unitaire, prix_total, chantier_id, lot_id)")
        .or("doc_type.eq.ticket,type_evenement.eq.comptoir")
        .order("created_at", { ascending: false }).limit(1000),
    ]);
    const factures = (fRes.data || []).map(f => ({
      key: `f_${f.id}`, kind: "facture", id: f.id,
      fournisseur: f.fournisseur_nom || "", numero: f.numero || "",
      montant: f.montant_ht, statut: f.statut,
      dateISO: f.date_facture || (f.created_at || "").slice(0, 10),
      raw: f,
    }));
    const recus = (cRes.data || []).map(c => ({
      key: `c_${c.id}`, kind: "recu", id: c.id,
      fournisseur: c.fournisseur_nom || "", numero: c.doc_numero || "",
      montant: c.montant_ht, statut: "recu",
      dateISO: c.date_doc || (c.created_at || "").slice(0, 10),
      raw: c,
    }));
    const all = [...factures, ...recus].sort((a, b) => (b.dateISO || "").localeCompare(a.dateISO || ""));
    setHistorique(all);
    setLoadingHist(false);
  }, []);

  useEffect(() => { loadHistorique(); }, [loadHistorique]);

  // Chantiers (pour afficher les noms dans le détail d'un reçu)
  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantiers").maybeSingle()
      .then(({ data }) => {
        const map = {};
        (Array.isArray(data?.value) ? data.value : []).forEach(c => { map[String(c.id)] = { nom: c.nom || c.id, couleur: c.couleur }; });
        setChantiersMap(map);
      });
  }, []);

  // Apparie une liste de BL aux commandes NON encore facturées, par NUMÉRO,
  // quel que soit le doc_type : une commande saisie comme "ticket" ou "bon de
  // commande" mais portant le n° de BL doit quand même être retrouvée.
  const matchBls = useCallback(async (blsList, fournisseurFacture) => {
    const { data } = await supabase
      .from("commandes")
      .select("id, doc_numero, fournisseur_nom, montant_ht, statut_facturation")
      .neq("statut_facturation", "facture")
      .limit(2000);
    const candidates = data || [];
    return blsList.map(bl => {
      const matches = candidates.filter(c => c.doc_numero && norm(c.doc_numero) === norm(bl.bl_numero));
      let chosen = null;
      if (matches.length === 1) chosen = matches[0];
      else if (matches.length > 1) chosen = matches.find(c => norm(c.fournisseur_nom) === norm(fournisseurFacture)) || matches[0];
      return {
        bl_numero: bl.bl_numero || "",
        montant_ht: bl.montant_ht != null ? String(bl.montant_ht) : "",
        commande_id: chosen?.id || null,
        commandeMontant: chosen?.montant_ht ?? null,
        fournisseurCmd: chosen?.fournisseur_nom || "",
        statut: chosen ? "rapproche" : "manquant",
      };
    });
  }, []);

  const nouvelleFacture = () => {
    setFact({ fournisseur: "", numero: "", date_facture: "", periode: "", montant_ht: "" });
    setBls([]); setPhotoUrl(""); setPhotos([]); setIaErr(""); setSaveErr("");
    setStep("capture");
  };

  const addPhotos = (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setPhotos(prev => [...prev, ...files.map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
      mediaType: f.type === "application/pdf" ? "application/pdf" : f.type,
    }))]);
  };
  const removePhoto = (i) => setPhotos(prev => prev.filter((_, j) => j !== i));

  const lancerAnalyse = async () => {
    if (!photos.length) return;
    setIaErr(""); setSaveErr("");
    setFact({ fournisseur: "", numero: "", date_facture: "", periode: "", montant_ht: "" });
    setBls([]); setPhotoUrl("");
    setStep("analyzing");

    const [ups, ia] = await Promise.allSettled([
      Promise.all(photos.map(p => uploadPhoto(p.file, "factures"))),
      (async () => {
        const images = await Promise.all(photos.map(async p => ({ base64: await fileToBase64(p.file), mediaType: p.mediaType })));
        return analyseFacture(images);
      })(),
    ]);

    if (ups.status === "fulfilled") {
      const firstUrl = ups.value.find(u => u?.url)?.url;
      if (firstUrl) setPhotoUrl(firstUrl);
    }

    if (ia.status === "fulfilled" && ia.value) {
      const p = ia.value;
      setFact({
        fournisseur: p.fournisseur || "",
        numero: p.numero || "",
        date_facture: p.date_facture || "",
        periode: p.periode || "",
        montant_ht: p.montant_ht != null ? String(p.montant_ht) : "",
      });
      const blsRaw = Array.isArray(p.bls) ? p.bls : [];
      const matched = await matchBls(blsRaw, p.fournisseur || "");
      setBls(matched);
    } else {
      setIaErr((ia.status === "rejected" ? (ia.reason?.message || "Analyse impossible") : "Analyse impossible") + " — vérifie le document.");
    }
    setStep("review");
  };

  // Saisir un BL manquant : crée une commande minimale (chantier à affecter plus tard)
  const saisirBl = async (i) => {
    const bl = bls[i];
    const montant = toNum(bl.montant_ht);
    const { data: cmd, error } = await supabase.from("commandes").insert({
      type_evenement: "livraison", doc_type: "bl", doc_numero: bl.bl_numero || null,
      numero_en_attente: false, fournisseur_nom: fact.fournisseur || null,
      date_doc: fact.date_facture || null, montant_ht: montant, source: "facture",
      saisi_par: profil?.nom || profil?.email || null,
      statut_completude: "a_completer", statut_facturation: "en_attente_facture",
    }).select("id").single();
    if (error || !cmd) { alert("Erreur création BL : " + (error?.message || "inconnue")); return; }
    await supabase.from("commande_lignes").insert({
      commande_id: cmd.id, libelle: "(à détailler — saisi depuis facture)",
      prix_total: montant, chantier_id: null,
    });
    setBls(prev => prev.map((b, j) => j === i
      ? { ...b, commande_id: cmd.id, commandeMontant: montant, fournisseurCmd: fact.fournisseur, statut: "rapproche" }
      : b));
  };

  // Statut d'affichage d'un BL (ajoute la détection d'écart)
  const blStatut = (b) => {
    if (!b.commande_id) return "manquant";
    const m = toNum(b.montant_ht);
    if (m != null && b.commandeMontant != null && Math.abs(b.commandeMontant - m) > TOLERANCE_ECART) return "ecart";
    return "rapproche";
  };

  const aucunManquant = bls.length > 0 && bls.every(b => blStatut(b) !== "manquant");
  const totalBl = bls.reduce((s, b) => s + (toNum(b.montant_ht) || 0), 0);
  const montantFacture = toNum(fact.montant_ht);
  const ecartTotal = montantFacture != null ? montantFacture - totalBl : null;

  const confirmer = async () => {
    if (!aucunManquant || saving) return;
    setSaving(true); setSaveErr("");

    const { data: f, error: e1 } = await supabase.from("factures").insert({
      fournisseur_nom: fact.fournisseur || null, numero: fact.numero || null,
      date_facture: fact.date_facture || null, periode: fact.periode || null,
      montant_ht: montantFacture, photo_url: photoUrl || null,
      statut: "a_rapprocher", saisi_par: profil?.nom || profil?.email || null,
    }).select("id").single();
    if (e1 || !f) { setSaveErr("Erreur facture : " + (e1?.message || "inconnue")); setSaving(false); return; }

    for (const b of bls) {
      const m = toNum(b.montant_ht);
      const statut = blStatut(b);
      const { error: eb } = await supabase.from("facture_bl").insert({
        facture_id: f.id, commande_id: b.commande_id || null,
        bl_numero: b.bl_numero || null, montant_ht: m, statut,
      });
      if (eb) { setSaveErr("Erreur liaison BL : " + eb.message); setSaving(false); return; }
      if (b.commande_id) {
        await supabase.from("commandes").update({ statut_facturation: "facture", facture_id: f.id }).eq("id", b.commande_id);
        await supabase.from("commande_lignes").update({ prix_verrouille: true }).eq("commande_id", b.commande_id);
      }
    }
    await supabase.from("factures").update({ statut: "rapprochee" }).eq("id", f.id);
    setSaving(false);
    await loadHistorique();
    setStep("home");
  };

  // Archive la facture SANS rapprocher les BL (période de transition / fournisseur
  // sans BL saisi). Ne crée aucune liaison et ne modifie aucune commande.
  const archiverSansRapprocher = async () => {
    if (saving) return;
    if (!confirm("Archiver cette facture sans rapprocher les BL ?\n\nAucune commande ne sera modifiée. À utiliser pour les factures d'une période antérieure à la saisie des BL, ou les fournisseurs sans BL.")) return;
    setSaving(true); setSaveErr("");
    const { error } = await supabase.from("factures").insert({
      fournisseur_nom: fact.fournisseur || null, numero: fact.numero || null,
      date_facture: fact.date_facture || null, periode: fact.periode || null,
      montant_ht: montantFacture, photo_url: photoUrl || null,
      statut: "archivee", saisi_par: profil?.nom || profil?.email || null,
    }).select("id").single();
    if (error) { setSaveErr("Erreur archivage : " + error.message); setSaving(false); return; }
    setSaving(false);
    await loadHistorique();
    setStep("home");
  };

  // ── Styles ──
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px",
    background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
    color: T.text, fontSize: 15, fontFamily: "inherit", outline: "none",
  };
  const labelStyle = {
    display: "block", fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 0.6,
    textTransform: "uppercase", color: T.textSub, marginBottom: 6,
  };
  const card = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
    padding: SPACING.lg, marginBottom: SPACING.md,
  };
  const btnPrimary = (disabled) => ({
    width: "100%", padding: "14px", border: "none", borderRadius: RADIUS.md,
    background: disabled ? T.border : acc.accent, color: disabled ? T.textSub : acc.onAccent,
    fontSize: 16, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  });
  const page = {
    flex: 1, minHeight: 0, overflowY: "auto",
    background: T.bg, color: T.text, fontFamily: "inherit",
    padding: SPACING.lg, paddingBottom: 96, maxWidth: 860, margin: "0 auto", boxSizing: "border-box",
  };

  const Header = ({ titre, onBack }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACING.lg }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
          width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
          color: T.text, cursor: "pointer", flexShrink: 0,
        }}><Icon as={ChevronLeft} size={20} /></button>
      )}
      <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, color: T.text }}>{titre}</h1>
    </div>
  );

  // ════════════ ACCUEIL ════════════
  if (step === "home") {
    const q = recherche.trim().toLowerCase();
    const qn = q.replace(/\s+/g, "");
    const histFiltre = historique.filter(it => {
      if (!q) return true;
      return (it.fournisseur || "").toLowerCase().includes(q)
        || (it.numero || "").toLowerCase().includes(q)
        || (it.numero || "").toLowerCase().replace(/\s+/g, "").includes(qn);
    });
    const groupesMap = new Map();
    for (const it of histFiltre) {
      const mois = (it.dateISO || "").slice(0, 7) || "____";
      if (!groupesMap.has(mois)) groupesMap.set(mois, { mois, items: [], total: 0 });
      const g = groupesMap.get(mois);
      g.items.push(it);
      g.total += Number(it.montant) || 0;
    }
    const groupesMois = [...groupesMap.values()].sort((a, b) => b.mois.localeCompare(a.mois));
    const fmtEur = (n) => (Number(n) || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
    const badgeInfo = (it) => {
      if (it.kind === "recu") return { label: "Payé comptant", sem: SEMANTIC.success };
      if (it.statut === "rapprochee") return { label: "Rapprochée", sem: SEMANTIC.success };
      if (it.statut === "archivee") return { label: "Archivée", sem: SEMANTIC.info };
      return { label: "À rapprocher", sem: SEMANTIC.warning };
    };

    return (
      <div style={page}>
        <Header titre="Rapprochement factures" />
        <button onClick={nouvelleFacture} style={{ ...btnPrimary(false), marginBottom: SPACING.md }}>
          <Icon as={Receipt} size={20} strokeWidth={2.2} /> Nouvelle facture
        </button>

        {/* Recherche */}
        <div style={{ position: "relative", marginBottom: SPACING.md }}>
          <Icon as={Search} size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.textSub, pointerEvents: "none" }} />
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Rechercher (fournisseur, n°…)"
            style={{ ...inputStyle, paddingLeft: 36 }} />
        </div>

        <div style={labelStyle}>Historique ({histFiltre.length})</div>
        {loadingHist ? (
          <div style={{ textAlign: "center", padding: 30, color: T.textSub }}><Icon as={Loader2} size={22} className="spin" /> Chargement…</div>
        ) : histFiltre.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: T.textSub }}>{recherche ? `Aucun résultat pour « ${recherche} ».` : "Aucune facture ni reçu pour l'instant."}</div>
        ) : (
          groupesMois.map(g => (
            <div key={g.mois} style={{ marginBottom: SPACING.md }}>
              <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: acc.accent, margin: "10px 2px 8px" }}>
                <span style={{ textTransform: "capitalize" }}>{moisLabel(g.mois)}</span>
                <span style={{ color: T.textSub, fontWeight: 600 }}> · {g.items.length} doc · {fmtEur(g.total)} € HT</span>
              </div>
              {g.items.map(it => {
                const badge = badgeInfo(it);
                return (
                  <div key={it.key} onClick={() => setDetail({ kind: it.kind, row: it.raw })}
                    style={{ ...card, marginBottom: SPACING.sm, display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
                    <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon as={it.kind === "facture" ? Receipt : FileText} size={16} color={T.textSub} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: FONT.base.size, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.fournisseur || "Fournisseur ?"}</div>
                      <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>
                        {it.kind === "facture" ? "Facture" : "Reçu comptant"}
                        {it.numero ? ` · N° ${it.numero}` : ""}
                        {it.montant != null ? ` · ${fmtEur(it.montant)} € HT` : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 700, padding: "4px 8px", borderRadius: RADIUS.pill, color: badge.sem.color, background: badge.sem.bg, border: `1px solid ${badge.sem.border}`, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {badge.label}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
        {detail && <HistoDetail item={detail} chantiersMap={chantiersMap} T={T} acc={acc} onClose={() => setDetail(null)} />}
        <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
      </div>
    );
  }

  // ════════════ CAPTURE (multi-pages) ════════════
  if (step === "capture") {
    return (
      <div style={page}>
        <Header titre="Nouvelle facture" onBack={() => setStep("home")} />

        <input ref={fileCam} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
        <input ref={fileGal} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />

        {photos.length > 0 && (
          <div style={card}>
            <label style={labelStyle}>{photos.length} page{photos.length > 1 ? "s" : ""} capturée{photos.length > 1 ? "s" : ""}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {photos.map((ph, i) => (
                <div key={i} style={{ position: "relative", width: 72, height: 72 }}>
                  {ph.mediaType === "application/pdf"
                    ? <div style={{ width: 72, height: 72, borderRadius: RADIUS.md, background: T.bg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon as={FileText} size={22} color={T.textSub} /></div>
                    : <img src={ph.preview} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: RADIUS.md, border: `1px solid ${T.border}` }} />}
                  <button onClick={() => removePhoto(i)} aria-label="Retirer" style={{ position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: "50%", background: SEMANTIC.danger.color, color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, lineHeight: 1 }}>×</button>
                  <span style={{ position: "absolute", bottom: -6, left: -6, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: acc.accent, color: acc.onAccent, fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button onClick={() => fileCam.current?.click()} style={{
          width: "100%", padding: "13px", borderRadius: RADIUS.md, cursor: "pointer",
          border: `1px solid ${T.border}`, background: T.surface, color: T.text,
          fontFamily: "inherit", fontWeight: 600, fontSize: 15, marginBottom: SPACING.sm,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Icon as={Camera} size={18} /> {photos.length ? "Ajouter une page (photo)" : "Prendre une photo"}
        </button>
        <button onClick={() => fileGal.current?.click()} style={{
          width: "100%", padding: "13px", borderRadius: RADIUS.md, cursor: "pointer",
          border: `1px solid ${T.border}`, background: T.surface, color: T.text,
          fontFamily: "inherit", fontWeight: 600, fontSize: 15, marginBottom: SPACING.lg,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <Icon as={ImageIcon} size={18} /> Galerie / PDF
        </button>

        <button onClick={lancerAnalyse} disabled={!photos.length} style={btnPrimary(!photos.length)}>
          <Icon as={Search} size={20} strokeWidth={2.2} />
          {photos.length ? `Analyser (${photos.length} page${photos.length > 1 ? "s" : ""})` : "Analyser"}
        </button>
      </div>
    );
  }

  // ════════════ ANALYSE ════════════
  if (step === "analyzing") {
    return (
      <div style={{ ...page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
        {photos[0]?.preview && photos[0]?.mediaType !== "application/pdf" && <img src={photos[0].preview} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: RADIUS.lg, marginBottom: SPACING.lg, opacity: 0.5 }} />}
        <Icon as={Loader2} size={34} color={acc.accent} className="spin" />
        <div style={{ marginTop: SPACING.md, fontSize: FONT.md.size, fontWeight: 600 }}>Analyse de la facture…</div>
        <div style={{ marginTop: 4, fontSize: FONT.sm.size, color: T.textSub }}>
          {photos.length > 1 ? `${photos.length} pages` : "1 page"} · lecture des numéros de BL référencés
        </div>
        <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
      </div>
    );
  }

  // ════════════ REVUE / RAPPROCHEMENT ════════════
  const nbManquants = bls.filter(b => blStatut(b) === "manquant").length;

  return (
    <div style={page}>
      <Header titre="Rapprocher la facture" onBack={() => setStep("home")} />

      {iaErr && (
        <div style={{ ...card, display: "flex", gap: 10, alignItems: "flex-start", background: SEMANTIC.warning.bg, border: `1px solid ${SEMANTIC.warning.border}` }}>
          <Icon as={AlertTriangle} size={18} color={SEMANTIC.warning.color} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: FONT.sm.size }}>{iaErr}</span>
        </div>
      )}

      {/* En-tête facture */}
      <div style={card}>
        <div className="responsive-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Fournisseur</label><input value={fact.fournisseur} onChange={e => setFact(f => ({ ...f, fournisseur: e.target.value }))} style={inputStyle} /></div>
          <div><label style={labelStyle}>N° facture</label><input value={fact.numero} onChange={e => setFact(f => ({ ...f, numero: e.target.value }))} style={inputStyle} /></div>
        </div>
        <div className="responsive-grid-3" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div><label style={labelStyle}>Date</label><input type="date" value={fact.date_facture} onChange={e => setFact(f => ({ ...f, date_facture: e.target.value }))} style={inputStyle} /></div>
          <div><label style={labelStyle}>Période</label><input value={fact.periode} onChange={e => setFact(f => ({ ...f, periode: e.target.value }))} placeholder="2026-06" style={inputStyle} /></div>
          <div><label style={labelStyle}>Montant HT (€)</label><input inputMode="decimal" value={fact.montant_ht} onChange={e => setFact(f => ({ ...f, montant_ht: e.target.value }))} style={inputStyle} /></div>
        </div>
      </div>

      {/* Liste des BL */}
      <div style={labelStyle}>Bons de livraison référencés ({bls.length})</div>
      {bls.length === 0 && (
        <div style={{ ...card, color: T.textSub, fontSize: FONT.sm.size }}>Aucun BL détecté sur la facture. Vérifie le document ou saisis manuellement les commandes.</div>
      )}
      {bls.map((b, i) => {
        const st = blStatut(b);
        const sem = st === "rapproche" ? SEMANTIC.success : st === "ecart" ? SEMANTIC.warning : SEMANTIC.danger;
        const icon = st === "rapproche" ? CheckCircle2 : st === "ecart" ? AlertTriangle : X;
        const label = st === "rapproche" ? "Apparié" : st === "ecart" ? "Écart de montant" : "BL manquant";
        return (
          <div key={i} style={{ ...card, marginBottom: SPACING.sm, borderLeft: `3px solid ${sem.color}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Icon as={icon} size={20} color={sem.color} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: FONT.base.size }}>BL n° {b.bl_numero || "?"}</div>
                <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>
                  Facture : {toNum(b.montant_ht) != null ? `${toNum(b.montant_ht)} € HT` : "—"}
                  {b.commande_id && b.commandeMontant != null ? ` · Commande : ${b.commandeMontant} € HT` : ""}
                </div>
              </div>
              <span style={{ fontSize: FONT.xs.size, fontWeight: 700, padding: "4px 8px", borderRadius: RADIUS.pill, color: sem.color, background: sem.bg, border: `1px solid ${sem.border}`, whiteSpace: "nowrap" }}>{label}</span>
            </div>
            {st === "manquant" && (
              <button onClick={() => saisirBl(i)} style={{
                marginTop: 10, width: "100%", padding: "10px", borderRadius: RADIUS.md, cursor: "pointer",
                border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
                fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <Icon as={Plus} size={16} /> Saisir ce BL (chantier à affecter ensuite)
              </button>
            )}
          </div>
        );
      })}

      {/* Bloc comparaison */}
      <div style={{ ...card, marginTop: SPACING.md }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.sm.size, color: T.textSub, marginBottom: 4 }}>
          <span>Total des BL</span><span>{totalBl.toFixed(2)} € HT</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.sm.size, color: T.textSub, marginBottom: 4 }}>
          <span>Montant facture</span><span>{montantFacture != null ? `${montantFacture.toFixed(2)} € HT` : "—"}</span>
        </div>
        {ecartTotal != null && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: FONT.base.size, fontWeight: 700, marginTop: 6, color: Math.abs(ecartTotal) > TOLERANCE_ECART ? SEMANTIC.warning.color : SEMANTIC.success.color }}>
            <span>Écart (remises comprises)</span><span>{ecartTotal.toFixed(2)} €</span>
          </div>
        )}
      </div>

      {saveErr && (
        <div style={{ ...card, background: SEMANTIC.danger.bg, border: `1px solid ${SEMANTIC.danger.border}`, color: SEMANTIC.danger.color, fontSize: FONT.sm.size }}>{saveErr}</div>
      )}

      <div style={{ marginBottom: 8, fontSize: FONT.sm.size, color: T.textSub, textAlign: "center" }}>
        {nbManquants > 0
          ? <span style={{ color: SEMANTIC.danger.color, fontWeight: 600 }}>{nbManquants} BL manquant(s) — saisis-les pour pouvoir confirmer.</span>
          : <span style={{ color: SEMANTIC.success.color, fontWeight: 600 }}>✓ Tous les BL sont appariés</span>}
      </div>

      <button onClick={confirmer} disabled={!aucunManquant || saving} style={btnPrimary(!aucunManquant || saving)}>
        {saving ? <Icon as={Loader2} size={20} className="spin" /> : <Icon as={Check} size={20} strokeWidth={2.5} />}
        {saving ? "Rapprochement…" : "Confirmer le rapprochement"}
      </button>

      <button onClick={archiverSansRapprocher} disabled={saving} style={{
        width: "100%", marginTop: SPACING.sm, padding: "12px", borderRadius: RADIUS.md,
        border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
        fontFamily: "inherit", fontWeight: 600, fontSize: 14, cursor: saving ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        Archiver sans rapprocher
      </button>
      <div style={{ marginTop: 6, fontSize: FONT.xs.size, color: T.textSub, textAlign: "center" }}>
        Pour une facture d'avant la saisie des BL, ou un fournisseur sans BL (coûts déjà saisis autrement).
      </div>

      <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
    </div>
  );
}
