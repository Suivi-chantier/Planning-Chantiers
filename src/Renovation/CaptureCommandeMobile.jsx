import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase, photoTransform } from "../supabase";
import { FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent, PHASES_DEFAUT } from "../constants";
import { Icon } from "../ui";
import {
  Camera, Image as ImageIcon, Plus, Trash2, Check, X, Loader2,
  ChevronLeft, AlertTriangle, FileText, ShoppingCart, Truck, Search, Split,
} from "lucide-react";

const EDGE_ANALYSE_COMMANDE =
  "https://yooksnzhlffqgpzkcjhl.supabase.co/functions/v1/analyse-commande";

const LS_DERNIER_CHANTIER = "capture_cmd_dernier_chantier";

// id de phase -> libellé lisible (ex: "demolition" -> "Démolition")
const PHASE_LABEL = Object.fromEntries(PHASES_DEFAUT.map(p => [p.id, p.label]));

const TYPES_EVENEMENT = [
  { id: "comptoir",  label: "Comptoir",  icon: ShoppingCart },
  { id: "commande",  label: "Commande",  icon: FileText },
  { id: "livraison", label: "Livraison", icon: Truck },
];

// Parse souple : "12,5 m²" -> 12.5 ; "" / non numérique -> null
function toNum(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

// Upload vers le bucket "photos" (réutilise le pattern de RapportMobile)
async function uploadPhoto(file, pathPrefix) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `${pathPrefix}/${safe}`;
    const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
    if (error) { console.error("upload photo:", error); return { error: error.message || "Erreur upload" }; }
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    if (!data?.publicUrl) return { error: "URL publique introuvable" };
    return { url: data.publicUrl };
  } catch (e) {
    console.error("upload photo (catch):", e);
    return { error: e.message || "Erreur réseau" };
  }
}

// Lit un fichier en base64 (sans le préfixe data:)
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result).split(",")[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

// Appel IA — `images` = [{ base64, mediaType }] (BL pouvant tenir sur
// plusieurs pages/photos). Renvoie l'objet JSON extrait (ou jette une erreur).
async function analyseCommande(images) {
  const response = await fetch(EDGE_ANALYSE_COMMANDE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

const ligneVide = () => ({ libelle: "", reference: "", quantite: "", unite: "U", prix_unitaire: "", prix_total: "", chantier_id: "", phase_id: "" });

export default function CaptureCommandeMobile({ chantiers = [], T, branch = "renovation", profil = null }) {
  const acc = getBranchAccent(branch);
  const [step, setStep] = useState("home");      // home | setup | analyzing | verify
  const [recents, setRecents] = useState([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [phasages, setPhasages] = useState([]);

  // Brouillon de saisie
  const [chantierDefaut, setChantierDefaut] = useState(() => localStorage.getItem(LS_DERNIER_CHANTIER) || "");
  const [typeEvenement, setTypeEvenement] = useState("comptoir");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photos, setPhotos] = useState([]); // [{ file, preview, mediaType }] — BL multi-pages
  const [repartir, setRepartir] = useState(false);
  const [dejaPaye, setDejaPaye] = useState(false); // payé direct / pas de facture à venir
  const [form, setForm] = useState({
    fournisseur: "", doc_type: "bl", doc_numero: "", numero_en_attente: false,
    date_doc: "", montant_ht: "", lignes: [ligneVide()],
  });
  const [iaErr, setIaErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const fileCam = useRef(null);
  const fileGal = useRef(null);

  const nomChantier = useCallback(
    (id) => chantiers.find(c => String(c.id) === String(id))?.nom || id || "",
    [chantiers]
  );

  const loadRecents = useCallback(async () => {
    setLoadingRecents(true);
    const { data } = await supabase
      .from("commandes")
      .select("id, type_evenement, doc_type, doc_numero, numero_en_attente, fournisseur_nom, montant_ht, date_doc, statut_completude, photo_url, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setRecents(data || []);
    setLoadingRecents(false);
  }, []);

  useEffect(() => { loadRecents(); }, [loadRecents]);

  // Phasages (1 par chantier) — pour le sélecteur de phase par ligne
  useEffect(() => {
    supabase.from("phasages").select("id, chantier_id, plan_travaux")
      .then(({ data }) => setPhasages(data || []));
  }, []);

  const phasageForChantier = useCallback(
    (cid) => phasages.find(p => String(p.chantier_id) === String(cid)) || null,
    [phasages]
  );
  // Liste des phases (id + libellé) définies dans le plan de travaux du chantier
  const phasesForChantier = useCallback((cid) => {
    const ph = phasageForChantier(cid);
    if (!ph?.plan_travaux) return [];
    return Object.entries(ph.plan_travaux)
      .filter(([k, v]) => k !== "meta" && !k.includes("__") && Array.isArray(v) && v.length > 0)
      .map(([id]) => ({ id, label: PHASE_LABEL[id] || id }));
  }, [phasageForChantier]);

  // ── Démarrer une nouvelle saisie ──
  const nouvelleCommande = () => {
    setForm({
      fournisseur: "", doc_type: "bl", doc_numero: "", numero_en_attente: false,
      date_doc: "", montant_ht: "", lignes: [ligneVide()],
    });
    setPhotoUrl(""); setPhotos([]); setRepartir(false);
    setIaErr(""); setSaveErr("");
    setTypeEvenement("comptoir");
    setStep("setup");
  };

  // ── Capture multi-photos ──
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

  // ── Analyse de toutes les pages capturées ──
  const lancerAnalyse = async () => {
    if (!photos.length) return;
    setIaErr("");
    setDejaPaye(typeEvenement === "comptoir"); // pré-coché pour les achats comptoir
    setStep("analyzing");

    const [ups, ia] = await Promise.allSettled([
      Promise.all(photos.map(p => uploadPhoto(p.file, "commandes"))),
      (async () => {
        const images = await Promise.all(photos.map(async p => ({ base64: await fileToBase64(p.file), mediaType: p.mediaType })));
        return analyseCommande(images);
      })(),
    ]);

    // photo_url = 1re page réussie (vignette dans la liste)
    if (ups.status === "fulfilled") {
      const firstUrl = ups.value.find(u => u?.url)?.url;
      if (firstUrl) setPhotoUrl(firstUrl);
    }

    if (ia.status === "fulfilled" && ia.value) {
      const p = ia.value;
      const lignes = Array.isArray(p.lignes) && p.lignes.length
        ? p.lignes.map(l => ({
            libelle: l.designation || l.libelle || "",
            reference: l.reference || "",
            quantite: l.quantite != null ? String(l.quantite) : "",
            unite: "U",
            prix_unitaire: l.prix_unitaire != null ? String(l.prix_unitaire) : "",
            prix_total: l.prix_total != null ? String(l.prix_total) : "",
            chantier_id: "",
            phase_id: "",
          }))
        : [ligneVide()];
      setForm({
        fournisseur: p.fournisseur || "",
        doc_type: ["ticket", "bon_commande", "bl"].includes(p.doc_type) ? p.doc_type : "bl",
        doc_numero: p.doc_numero || "",
        numero_en_attente: false,
        date_doc: p.date_doc || "",
        montant_ht: p.montant_ht != null ? String(p.montant_ht) : "",
        lignes,
      });
    } else {
      const err = ia.status === "rejected" ? (ia.reason?.message || "Analyse impossible") : "Analyse impossible";
      setIaErr(err + " — tu peux saisir manuellement.");
    }
    setStep("verify");
  };

  // ── Validation & enregistrement ──
  const docMissing = !form.doc_numero.trim() && !form.numero_en_attente;

  const lignesCompletes = form.lignes.length > 0 && form.lignes.every(l => {
    const ch = repartir ? l.chantier_id : chantierDefaut;
    const prix = toNum(l.prix_total) ?? toNum(l.prix_unitaire);
    return ch && prix != null;
  });
  const estComplete = !!form.doc_numero.trim() && lignesCompletes;

  const enregistrer = async () => {
    if (docMissing) return;
    setSaving(true); setSaveErr("");
    // mémorise le dernier chantier choisi
    if (chantierDefaut) localStorage.setItem(LS_DERNIER_CHANTIER, chantierDefaut);

    const { data: cmd, error: e1 } = await supabase
      .from("commandes")
      .insert({
        type_evenement: typeEvenement,
        doc_type: form.doc_type,
        doc_numero: form.doc_numero.trim() || null,
        numero_en_attente: !!form.numero_en_attente,
        fournisseur_nom: form.fournisseur.trim() || null,
        date_doc: form.date_doc || null,
        montant_ht: toNum(form.montant_ht),
        photo_url: photoUrl || null,
        saisi_par: profil?.nom || profil?.email || null,
        statut_completude: estComplete ? "complete" : "a_completer",
        statut_facturation: dejaPaye ? "facture" : "en_attente_facture",
        source: "mobile",
      })
      .select("id")
      .single();

    if (e1 || !cmd) { setSaveErr("Erreur enregistrement : " + (e1?.message || "inconnue")); setSaving(false); return; }

    const lignesPayload = form.lignes
      .filter(l => l.libelle.trim() || toNum(l.quantite) != null || toNum(l.prix_total) != null)
      .map(l => {
        const pu = toNum(l.prix_unitaire);
        const pt = toNum(l.prix_total);
        const q = toNum(l.quantite);
        const effCh = (repartir ? l.chantier_id : chantierDefaut) || null;
        const phaseId = l.phase_id || null;
        const phRow = (phaseId && effCh) ? phasageForChantier(effCh) : null;
        return {
          commande_id: cmd.id,
          libelle: l.libelle.trim() || "",
          reference: l.reference.trim() || null,
          quantite: q,
          unite: l.unite || "U",
          prix_unitaire: pu,
          prix_total: pt != null ? pt : (pu != null && q != null ? pu * q : null),
          prix_verrouille: dejaPaye, // coût définitif si payé direct
          chantier_id: effCh,
          phasage_id: phRow ? phRow.id : null,
          phase_id: phRow ? phaseId : null,
        };
      });

    if (lignesPayload.length) {
      const { error: e2 } = await supabase.from("commande_lignes").insert(lignesPayload);
      if (e2) { setSaveErr("Commande créée mais erreur sur les lignes : " + e2.message); setSaving(false); return; }
    }

    setSaving(false);
    await loadRecents();
    setStep("home");
  };

  // ── Styles partagés ──
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "11px 12px",
    background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
    color: T.text, fontSize: 16, fontFamily: "inherit", outline: "none",
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
    width: "100%", padding: "15px", border: "none", borderRadius: RADIUS.md,
    background: disabled ? T.border : acc.accent, color: disabled ? T.textSub : acc.onAccent,
    fontSize: 16, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  });

  const page = {
    flex: 1, minHeight: 0, overflowY: "auto",
    background: T.bg, color: T.text,
    fontFamily: "inherit", padding: SPACING.lg, paddingBottom: 96,
    maxWidth: 620, margin: "0 auto", boxSizing: "border-box",
  };

  // ── EN-TÊTE ──
  const Header = ({ titre, onBack }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: SPACING.lg }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
          width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
          color: T.text, cursor: "pointer", flexShrink: 0,
        }}>
          <Icon as={ChevronLeft} size={20} />
        </button>
      )}
      <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, color: T.text }}>{titre}</h1>
    </div>
  );

  // ════════════ ÉCRAN ACCUEIL ════════════
  if (step === "home") {
    return (
      <div style={page}>
        <Header titre="Saisie commande" />
        <button onClick={nouvelleCommande} style={{ ...btnPrimary(false), marginBottom: SPACING.xl }}>
          <Icon as={Camera} size={20} strokeWidth={2.2} /> Nouvelle commande
        </button>

        <div style={labelStyle}>Commandes récentes</div>
        {loadingRecents ? (
          <div style={{ textAlign: "center", padding: 30, color: T.textSub }}>
            <Icon as={Loader2} size={22} className="spin" /> Chargement…
          </div>
        ) : recents.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: T.textSub }}>
            Aucune commande pour l'instant.
          </div>
        ) : (
          recents.map(c => {
            const docManquant = !c.doc_numero && !c.numero_en_attente;
            const sem = docManquant ? SEMANTIC.danger
              : c.statut_completude === "complete" ? SEMANTIC.success : SEMANTIC.warning;
            const statutLabel = docManquant ? "N° manquant"
              : c.statut_completude === "complete" ? "Complète" : "À compléter";
            return (
              <div key={c.id} style={{ ...card, marginBottom: SPACING.sm, display: "flex", gap: 12, alignItems: "center" }}>
                {c.photo_url
                  ? <img src={photoTransform(c.photo_url, { width: 88, height: 88, quality: 60 })} alt=""
                      style={{ width: 44, height: 44, borderRadius: RADIUS.md, objectFit: "cover", flexShrink: 0 }} />
                  : <div style={{ width: 44, height: 44, borderRadius: RADIUS.md, background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon as={FileText} size={18} color={T.textSub} />
                    </div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: FONT.base.size, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.fournisseur_nom || "Fournisseur ?"}
                  </div>
                  <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>
                    {c.doc_numero ? `N° ${c.doc_numero}` : c.numero_en_attente ? "N° en attente" : "Sans n°"}
                    {c.montant_ht != null ? ` · ${c.montant_ht} € HT` : ""}
                  </div>
                </div>
                <span style={{
                  fontSize: FONT.xs.size, fontWeight: 700, padding: "4px 8px", borderRadius: RADIUS.pill,
                  color: sem.color, background: sem.bg, border: `1px solid ${sem.border}`, whiteSpace: "nowrap",
                }}>{statutLabel}</span>
              </div>
            );
          })
        )}
        <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
      </div>
    );
  }

  // ════════════ ÉCRAN SETUP (chantier + type + capture) ════════════
  if (step === "setup") {
    return (
      <div style={page}>
        <Header titre="Nouvelle commande" onBack={() => setStep("home")} />

        <div style={card}>
          <label style={labelStyle}>Chantier par défaut</label>
          <select value={chantierDefaut} onChange={e => setChantierDefaut(e.target.value)} style={inputStyle}>
            <option value="">— Choisir un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom || c.id}</option>)}
          </select>
          <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 6 }}>
            Appliqué à toutes les lignes (modifiable ensuite).
          </div>
        </div>

        <div style={card}>
          <label style={labelStyle}>Type</label>
          <div style={{ display: "flex", gap: 8 }}>
            {TYPES_EVENEMENT.map(t => {
              const on = typeEvenement === t.id;
              return (
                <button key={t.id} onClick={() => setTypeEvenement(t.id)} style={{
                  flex: 1, padding: "12px 4px", borderRadius: RADIUS.md, cursor: "pointer",
                  border: `1px solid ${on ? acc.accent : T.border}`,
                  background: on ? acc.bg10 : T.bg, color: on ? acc.accent : T.textSub,
                  fontFamily: "inherit", fontWeight: on ? 700 : 500, fontSize: FONT.sm.size,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                }}>
                  <Icon as={t.icon} size={18} strokeWidth={on ? 2.2 : 1.75} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <input ref={fileCam} type="file" accept="image/*" capture="environment" hidden
          onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
        <input ref={fileGal} type="file" accept="image/*,application/pdf" multiple hidden
          onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />

        {/* Pages capturées (un BL peut tenir sur plusieurs pages) */}
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

  // ════════════ ÉCRAN ANALYSE EN COURS ════════════
  if (step === "analyzing") {
    return (
      <div style={{ ...page, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "70vh" }}>
        {photos[0]?.preview && photos[0]?.mediaType !== "application/pdf" && (
          <img src={photos[0].preview} alt="" style={{ width: 160, height: 160, objectFit: "cover", borderRadius: RADIUS.lg, marginBottom: SPACING.lg, opacity: 0.5 }} />
        )}
        <Icon as={Loader2} size={34} color={acc.accent} className="spin" />
        <div style={{ marginTop: SPACING.md, fontSize: FONT.md.size, fontWeight: 600, color: T.text }}>Analyse du document…</div>
        <div style={{ marginTop: 4, fontSize: FONT.sm.size, color: T.textSub }}>
          {photos.length > 1 ? `${photos.length} pages` : "1 page"} · lecture du numéro, fournisseur et lignes
        </div>
        <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
      </div>
    );
  }

  // ════════════ ÉCRAN VÉRIFICATION ════════════
  const setLigne = (i, patch) => setForm(f => ({ ...f, lignes: f.lignes.map((l, j) => j === i ? { ...l, ...patch } : l) }));
  const addLigne = () => setForm(f => ({ ...f, lignes: [...f.lignes, ligneVide()] }));
  const delLigne = (i) => setForm(f => ({ ...f, lignes: f.lignes.filter((_, j) => j !== i) }));
  // Scinde une ligne en deux (quantité + prix répartis), pour affecter chaque
  // moitié à un chantier différent. Active le mode "Répartir".
  const splitLigne = (i) => {
    setForm(f => {
      const l = f.lignes[i];
      const q = toNum(l.quantite);
      const pt = toNum(l.prix_total);
      const q1 = q != null ? Math.ceil(q / 2) : null;
      const q2 = q != null ? q - q1 : null;
      const pt1 = (pt != null && q && q > 0) ? +(pt * q1 / q).toFixed(2) : null;
      const pt2 = (pt != null && q && q > 0) ? +(pt - pt1).toFixed(2) : null;
      const a = { ...l, quantite: q1 != null ? String(q1) : l.quantite, prix_total: pt1 != null ? String(pt1) : l.prix_total };
      const b = { ...l, quantite: q2 != null ? String(q2) : "", prix_total: pt2 != null ? String(pt2) : "", chantier_id: "", phase_id: "" };
      const lignes = [...f.lignes];
      lignes.splice(i, 1, a, b);
      return { ...f, lignes };
    });
    setRepartir(true);
  };

  return (
    <div style={page}>
      <Header titre="Vérifier & enregistrer" onBack={() => setStep("setup")} />

      {iaErr && (
        <div style={{ ...card, display: "flex", gap: 10, alignItems: "flex-start", background: SEMANTIC.warning.bg, border: `1px solid ${SEMANTIC.warning.border}` }}>
          <Icon as={AlertTriangle} size={18} color={SEMANTIC.warning.color} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: FONT.sm.size, color: T.text }}>{iaErr}</span>
        </div>
      )}

      {/* En-tête document */}
      <div style={card}>
        <div style={{ marginBottom: SPACING.md }}>
          <label style={labelStyle}>Numéro du document {docMissing && <span style={{ color: SEMANTIC.danger.color }}>· obligatoire</span>}</label>
          <input
            value={form.doc_numero}
            onChange={e => setForm(f => ({ ...f, doc_numero: e.target.value }))}
            placeholder="N° de BL / ticket / commande"
            style={{ ...inputStyle, borderColor: docMissing ? SEMANTIC.danger.color : T.border }}
          />
          {docMissing && (
            <div style={{ fontSize: FONT.xs.size, color: SEMANTIC.danger.color, marginTop: 6 }}>
              Numéro introuvable. Saisis-le, ou active « Numéro en attente » si tu l'auras plus tard.
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={form.numero_en_attente}
              onChange={e => setForm(f => ({ ...f, numero_en_attente: e.target.checked }))}
              style={{ width: 18, height: 18, accentColor: acc.accent }} />
            <span style={{ fontSize: FONT.base.size, color: T.text }}>Numéro en attente (fourni plus tard)</span>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: SPACING.md }}>
          <div>
            <label style={labelStyle}>Type doc.</label>
            <select value={form.doc_type} onChange={e => setForm(f => ({ ...f, doc_type: e.target.value }))} style={inputStyle}>
              <option value="bl">Bon de livraison</option>
              <option value="ticket">Ticket</option>
              <option value="bon_commande">Bon de commande</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={form.date_doc} onChange={e => setForm(f => ({ ...f, date_doc: e.target.value }))} style={inputStyle} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Fournisseur</label>
            <input value={form.fournisseur} onChange={e => setForm(f => ({ ...f, fournisseur: e.target.value }))} placeholder="Nom" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Montant HT (€)</label>
            <input inputMode="decimal" value={form.montant_ht} onChange={e => setForm(f => ({ ...f, montant_ht: e.target.value }))} placeholder="0.00" style={inputStyle} />
          </div>
        </div>
      </div>

      {/* Facturation */}
      <div style={card}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={dejaPaye} onChange={e => setDejaPaye(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: acc.accent }} />
          <span style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text }}>Déjà payé / pas de facture à venir</span>
        </label>
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginTop: 8 }}>
          {dejaPaye
            ? "Coût définitif (prix verrouillés) — n'apparaîtra pas dans le rapprochement de factures."
            : "En attente d'une facture fournisseur — le coût sera confirmé au rapprochement."}
        </div>
      </div>

      {/* Ventilation chantier */}
      <div style={card}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={repartir} onChange={e => setRepartir(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: acc.accent }} />
          <span style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text }}>Répartir sur plusieurs chantiers</span>
        </label>
        {!repartir && (
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginTop: 8 }}>
            Toutes les lignes → <strong style={{ color: acc.accent }}>{nomChantier(chantierDefaut) || "aucun chantier"}</strong>
          </div>
        )}
      </div>

      {/* Lignes */}
      <div style={labelStyle}>Articles ({form.lignes.length})</div>
      {form.lignes.map((l, i) => {
        const effCh = repartir ? l.chantier_id : chantierDefaut;
        const phaseOpts = effCh ? phasesForChantier(effCh) : [];
        return (
        <div key={i} style={card}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input value={l.libelle} onChange={e => setLigne(i, { libelle: e.target.value })} placeholder="Désignation" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => splitLigne(i)} title="Diviser pour répartir sur 2 chantiers" style={{ background: acc.bg10, border: `1px solid ${acc.border}`, borderRadius: RADIUS.md, width: 44, flexShrink: 0, color: acc.accent, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon as={Split} size={18} />
            </button>
            <button onClick={() => delLigne(i)} style={{ background: SEMANTIC.danger.bg, border: `1px solid ${SEMANTIC.danger.border}`, borderRadius: RADIUS.md, width: 44, flexShrink: 0, color: SEMANTIC.danger.color, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon as={Trash2} size={18} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            <input inputMode="decimal" value={l.quantite} onChange={e => setLigne(i, { quantite: e.target.value })} placeholder="Qté" style={inputStyle} />
            <input inputMode="decimal" value={l.prix_unitaire} onChange={e => setLigne(i, { prix_unitaire: e.target.value })} placeholder="PU €" style={inputStyle} />
            <input inputMode="decimal" value={l.prix_total} onChange={e => setLigne(i, { prix_total: e.target.value })} placeholder="Total €" style={inputStyle} />
          </div>
          {repartir && (
            <select value={l.chantier_id} onChange={e => setLigne(i, { chantier_id: e.target.value, phase_id: "" })} style={inputStyle}>
              <option value="">— Chantier de cette ligne —</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom || c.id}</option>)}
            </select>
          )}
          {phaseOpts.length > 0 && (
            <select value={l.phase_id} onChange={e => setLigne(i, { phase_id: e.target.value })} style={{ ...inputStyle, marginTop: repartir ? 8 : 0 }}>
              <option value="">— Phase (optionnel) —</option>
              {phaseOpts.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
        </div>
        );
      })}

      <button onClick={addLigne} style={{
        width: "100%", padding: "12px", borderRadius: RADIUS.md, cursor: "pointer",
        border: `1px dashed ${T.border}`, background: "transparent", color: T.textSub,
        fontFamily: "inherit", fontWeight: 600, fontSize: 14, marginBottom: SPACING.lg,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        <Icon as={Plus} size={16} /> Ajouter une ligne
      </button>

      {saveErr && (
        <div style={{ ...card, background: SEMANTIC.danger.bg, border: `1px solid ${SEMANTIC.danger.border}`, color: SEMANTIC.danger.color, fontSize: FONT.sm.size }}>
          {saveErr}
        </div>
      )}

      <div style={{ marginBottom: 8, fontSize: FONT.sm.size, color: T.textSub, textAlign: "center" }}>
        {estComplete
          ? <span style={{ color: SEMANTIC.success.color, fontWeight: 600 }}>✓ Commande complète</span>
          : "Sera enregistrée « à compléter » (chantier/prix/numéro manquants)"}
      </div>

      <button onClick={enregistrer} disabled={docMissing || saving} style={btnPrimary(docMissing || saving)}>
        {saving ? <Icon as={Loader2} size={20} className="spin" /> : <Icon as={Check} size={20} strokeWidth={2.5} />}
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>

      <style>{`@keyframes spinkf{to{transform:rotate(360deg)}}.spin{animation:spinkf 1s linear infinite}`}</style>
    </div>
  );
}
