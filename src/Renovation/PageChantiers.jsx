import React, { useState, useEffect, useRef } from "react";
import { supabase, photoTransform, getClientId } from "../supabase";
import { getBranchAccent, FONT, RADIUS, PHASES_DEFAUT, loadPhases, calcAvancementPondere } from "../constants";
import { indexPointagesParTache, heuresEff, coutMOEff, sumLibreEtIndirect } from "../pointages";
import { Icon } from "../ui";
import {
  HardHat, Building2, ArrowLeft, Pencil, Camera, Link2, MapPin,
  ChevronLeft, ChevronRight, ExternalLink, X, Check, ClipboardList,
  Wallet, Banknote, Receipt, TrendingDown, TrendingUp, Image as ImageIcon,
  Clock, Search, Package, Calendar, Info, StickyNote, Bold, Italic, Underline,
  Palette, List, ListOrdered,
} from "lucide-react";

// PHASES dynamiques : chargées depuis Admin → Phases (fallback sur défaut)
let PHASES = [...PHASES_DEFAUT];
loadPhases().then(p => { PHASES = p; });

// Format heures : 1 décimale max, sans .0 si entier (évite "11.200000003h")
const fmtH = (n) => +(parseFloat(n) || 0).toFixed(1);

const STATUTS = {
  en_cours: { label: "En cours",  color: "#FFC300", bg: "rgba(255,195,0,0.15)"  },
  termine:  { label: "Terminé",   color: "#22c55e", bg: "rgba(34,197,94,0.15)"  },
  planifie: { label: "Planifié",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" },
  en_pause: { label: "En pause",  color: "#f97316", bg: "rgba(249,115,22,0.15)" },
};

function StatutBadge({ statut }) {
  const s = STATUTS[statut] || STATUTS.en_cours;
  return (
    <span style={{
      fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8,
      textTransform: "uppercase", padding: "3px 10px",
      borderRadius: RADIUS.pill, color: s.color, background: s.bg,
      border: `1px solid ${s.color}40`,
    }}>{s.label}</span>
  );
}

function ProgressBar({ value, color, height = 6 }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <div style={{ width: "100%", height, borderRadius: height, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
      <div style={{
        height: "100%", width: `${pct}%`, borderRadius: height,
        background: pct >= 100 ? "#22c55e" : (color || "#FFC300"),
        transition: "width .4s ease",
      }}/>
    </div>
  );
}

// ─── CALCULS ─────────────────────────────────────────────────────────────────
// P9 : coût MO dérivé du registre de pointage. Si le chantier n'a aucun pointage
// (legacy), on retombe sur l'ancien calcul heures_reelles × ouvriers[0].
// Le caller passe pointagesIndexes (résultat de indexPointagesParTache) et
// extraStats ({coutLibre, coutIndirect}) pour ajouter les heures hors-tâches.
function calcFinances(phasage, tauxHoraires = {}, pointagesIndexes = {}, extraStats = {}) {
  if (!phasage?.plan_travaux) return { coutMO: 0, coutMat: 0, coutTotal: 0, prixVendu: 0, marge: 0, margePct: 0 };
  const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
  const coutMOTaches = allTaches.reduce((s, t) => s + coutMOEff(t, pointagesIndexes, tauxHoraires), 0);
  const coutMO   = coutMOTaches + (extraStats.coutLibre || 0) + (extraStats.coutIndirect || 0);
  const coutMat  = allTaches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
  const coutTotal = coutMO + coutMat;
  const prixVendu = parseFloat(phasage.prix_vendu) || 0;
  const marge     = prixVendu - coutTotal;
  const margePct  = prixVendu > 0 ? (marge / prixVendu) * 100 : 0;
  return { coutMO, coutMat, coutTotal, prixVendu, marge, margePct };
}

function calcAvancement(phasage) {
  // V2 : avancement depuis les tâches des ouvrages (pondéré prix_ht/heures via
  // calcAvancementPondere). Repli V1 : tâches de plan_travaux.
  const ouvrages = phasage?.ouvrages || [];
  if (ouvrages.length > 0) {
    const allTaches = ouvrages.flatMap(o => (o.taches || []).map(t => ({ ...t, ouvrage_id: o.id })));
    return calcAvancementPondere(ouvrages, allTaches);
  }
  if (!phasage?.plan_travaux) return 0;
  const allTaches = PHASES.flatMap(ph => (phasage.plan_travaux[ph.id] || []));
  return calcAvancementPondere(ouvrages, allTaches);
}

function getLastTaches(phasage, n = 5) {
  if (!phasage?.plan_travaux) return [];
  return PHASES.flatMap(ph =>
    (phasage.plan_travaux[ph.id] || []).map(t => ({ ...t, phaseLabel: ph.label, phaseCouleur: ph.couleur }))
  )
    .filter(t => (parseFloat(t.avancement) || 0) > 0)
    .sort((a, b) => (parseFloat(b.avancement) || 0) - (parseFloat(a.avancement) || 0))
    .slice(0, n);
}

// ─── CORRESPONDANCE NOM CHANTIER (robuste, insensible à la casse et accents) ─
function normalise(str) {
  return (str || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

function chantierMatchCR(chantierNom, crAdresse) {
  const nom = normalise(chantierNom);
  const adr = normalise(crAdresse || "");
  if (!nom || !adr) return false;
  if (adr.includes(nom)) return true;
  const mots = nom.split(" ").filter(m => m.length > 2);
  if (mots.length === 0) return false;
  return mots.some(m => adr.includes(m));
}

function trouverPhasage(phasages, chantier) {
  if (!chantier) return null;
  // 1. Match exact par chantier_id (lien explicite)
  const exact = phasages.find(p => p.chantier_id === chantier.id);
  if (exact) return exact;

  // 2. Match par nom normalisé : on cherche dans les deux sens et par mot.
  const nomCh = normalise(chantier.nom);
  const motsCh = nomCh.split(" ").filter(m => m.length > 2);
  if (motsCh.length === 0) return null;

  return phasages.find(p => {
    const nomPh = normalise(p.chantier_nom || "");
    if (!nomPh) return false;
    // Inclusion directe dans les deux sens
    if (nomPh.includes(nomCh) || nomCh.includes(nomPh)) return true;
    // Au moins un mot significatif en commun
    const motsPh = nomPh.split(" ").filter(m => m.length > 2);
    return motsCh.some(m => motsPh.includes(m));
  }) || null;
}

const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

// ─── WIDGET NOTES (par chantier) ──────────────────────────────────────────────
// Éditeur riche minimal avec contentEditable natif + document.execCommand :
// gras, italique, souligné. Aucune dépendance externe. Autosave debounced
// 800ms. Subscription Realtime sur chantier_notes filtrée par chantier_id pour
// la collab. Quand un remote arrive pendant qu'on est focus, on l'ignore pour
// ne pas perdre le curseur (le local va écraser au prochain save de toute façon).
// Palette de couleurs pour le texte des notes. "default" reset à la couleur
// héritée du thème (= variable T.text). 6 teintes choisies pour rester lisibles
// sur fond sombre comme sur fond clair.
const NOTE_COLORS = [
  { id: "default", label: "Défaut",  value: null      },
  { id: "red",     label: "Rouge",   value: "#e15a5a" },
  { id: "orange",  label: "Orange",  value: "#f5a623" },
  { id: "yellow",  label: "Jaune",   value: "#FFC300" },
  { id: "green",   label: "Vert",    value: "#22c55e" },
  { id: "blue",    label: "Bleu",    value: "#5b9cf6" },
  { id: "purple",  label: "Violet",  value: "#a78bfa" },
];

function NotesChantier({ chantierId, T, accent }) {
  const [loading, setLoading]             = useState(true);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const editorRef    = useRef(null);
  const saveTimer    = useRef(null);
  const isFocusedRef = useRef(false);
  const isDirtyRef   = useRef(false);
  const savedSelectionRef = useRef(null); // sauve la sélection avant ouvrir le menu couleur

  // Applique le HTML reçu de la base dans le contentEditable sans casser le
  // curseur si l'utilisateur n'est pas en train d'écrire.
  const applyHtml = (html) => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html || "";
  };

  // Chargement initial
  useEffect(() => {
    if (!chantierId) { setLoading(false); return; }
    setLoading(true);
    isDirtyRef.current = false;
    supabase.from("chantier_notes").select("contenu").eq("chantier_id", chantierId).maybeSingle()
      .then(({ data, error }) => {
        if (error && error.code !== "PGRST116") console.warn("Chargement notes :", error.message);
        applyHtml(data?.contenu || "");
        setLoading(false);
      });
  }, [chantierId]);

  // Autosave debounced
  const scheduleSave = (html) => {
    setAutoSaveStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("chantier_notes").upsert({
        chantier_id: chantierId,
        contenu: html,
        last_client_id: getClientId(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "chantier_id" });
      if (error) { console.error("Save notes :", error.message); setAutoSaveStatus("error"); return; }
      isDirtyRef.current = false;
      setAutoSaveStatus("saved");
    }, 800);
  };

  const onInput = () => {
    isDirtyRef.current = true;
    scheduleSave(editorRef.current?.innerHTML || "");
  };

  // Subscription Realtime — applique le contenu remote si on ne tape pas
  useEffect(() => {
    if (!chantierId) return;
    const clientId = getClientId();
    const ch = supabase.channel(`chantier-notes-${chantierId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chantier_notes", filter: `chantier_id=eq.${chantierId}` },
        (payload) => {
          const remote = payload?.new;
          if (!remote) return;
          if (remote.last_client_id === clientId) return;
          if (isFocusedRef.current && isDirtyRef.current) return; // l'utilisateur tape, on ne touche pas
          applyHtml(remote.contenu || "");
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chantierId]);

  // Toolbar : exécute la commande sur la sélection courante puis trigger save
  const exec = (cmd, arg = undefined) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    // Restaure la sélection si on l'a sauvegardée (utilisé par le menu couleur
    // qui fait perdre le focus le temps du clic sur une pastille).
    if (savedSelectionRef.current) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
      savedSelectionRef.current = null;
    }
    document.execCommand(cmd, false, arg);
    onInput();
  };

  // Mémorise la sélection courante avant d'ouvrir le menu couleur (le clic sur
  // une pastille ferait perdre le focus du contenteditable).
  const memoSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  // Applique une couleur (ou reset si null/default).
  const applyColor = (value) => {
    if (value) {
      exec("foreColor", value);
    } else {
      // Reset : on remet la couleur héritée. Astuce : foreColor avec "inherit"
      // n'est pas universellement supporté ; on passe par removeFormat pour les
      // attributs de style/font, puis on rapplique bold/italic/underline si la
      // sélection les avait — trop complexe pour un cas marginal. Plus simple :
      // foreColor avec la couleur texte du thème.
      exec("foreColor", T?.text || "#f0f0f0");
    }
    setColorMenuOpen(false);
  };

  const statusColor = autoSaveStatus === "saved" ? "#22c55e"
                    : autoSaveStatus === "saving" ? accent
                    : autoSaveStatus === "error"  ? "#e15a5a"
                    : "#f5a623";
  const statusLbl = autoSaveStatus === "saved" ? "Sauvegardé"
                  : autoSaveStatus === "saving" ? "Sauvegarde…"
                  : autoSaveStatus === "error"  ? "Erreur"
                  : "Modif en cours";

  const text     = T?.text     || "#f0f0f0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface  = T?.surface  || "#262a32";
  const border   = T?.border   || "rgba(255,255,255,0.07)";
  const card     = T?.card     || "rgba(255,255,255,0.04)";

  const toolBtn = (active = false) => ({
    width: 30, height: 30, borderRadius: RADIUS.sm,
    background: active ? accent + "22" : "transparent",
    border: `1px solid ${border}`, color: text,
    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontFamily: "inherit", padding: 0,
  });

  return (
    <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 12px", borderBottom: `1px solid ${border}`,
        background: surface,
      }}>
        <button onClick={() => exec("bold")}       title="Gras (Ctrl+B)"       style={toolBtn()}><Icon as={Bold} size={13}/></button>
        <button onClick={() => exec("italic")}     title="Italique (Ctrl+I)"   style={toolBtn()}><Icon as={Italic} size={13}/></button>
        <button onClick={() => exec("underline")}  title="Souligné (Ctrl+U)"   style={toolBtn()}><Icon as={Underline} size={13}/></button>
        {/* Séparateur */}
        <div style={{ width: 1, height: 18, background: border, margin: "0 2px" }}/>
        {/* Couleur de texte */}
        <div style={{ position: "relative" }}>
          <button
            onMouseDown={memoSelection}
            onClick={() => setColorMenuOpen(o => !o)}
            title="Couleur de texte"
            style={{ ...toolBtn(colorMenuOpen) }}
          >
            <Icon as={Palette} size={13}/>
          </button>
          {colorMenuOpen && (
            <>
              <div onClick={() => setColorMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 99 }}/>
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100,
                background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.md,
                padding: 6, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                display: "flex", gap: 6,
              }}>
                {NOTE_COLORS.map(c => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyColor(c.value)}
                    title={c.label}
                    style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: c.value || `linear-gradient(135deg, ${text} 50%, ${textMuted} 50%)`,
                      border: c.value ? `2px solid ${border}` : `2px dashed ${textMuted}`,
                      cursor: "pointer", padding: 0,
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        {/* Listes */}
        <button onClick={() => exec("insertUnorderedList")} title="Liste à puces"     style={toolBtn()}><Icon as={List} size={13}/></button>
        <button onClick={() => exec("insertOrderedList")}   title="Liste numérotée" style={toolBtn()}><Icon as={ListOrdered} size={13}/></button>
        <div style={{ flex: 1 }}/>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 9, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
          color: statusColor, background: statusColor + "18", border: `1px solid ${statusColor}40`,
          borderRadius: 99, padding: "2px 8px",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}/>
          {statusLbl}
        </span>
      </div>
      {/* Éditeur */}
      <div
        ref={editorRef}
        contentEditable={!loading}
        suppressContentEditableWarning
        onInput={onInput}
        onFocus={() => { isFocusedRef.current = true; }}
        onBlur={() => { isFocusedRef.current = false; }}
        data-placeholder="Écrire des notes sur ce chantier…"
        style={{
          minHeight: 110, padding: "12px 16px",
          color: text, fontSize: FONT.sm.size + 1, lineHeight: 1.6,
          outline: "none", fontFamily: "inherit",
        }}
      />
      <style>{`
        [contenteditable=true]:empty:before {
          content: attr(data-placeholder);
          color: ${textMuted};
          opacity: .55;
          pointer-events: none;
        }
        [contenteditable=true] b, [contenteditable=true] strong { font-weight: 800; }
        [contenteditable=true] i, [contenteditable=true] em     { font-style: italic; }
        [contenteditable=true] u                                { text-decoration: underline; }
        [contenteditable=true] ul                               { list-style: disc;    padding-left: 22px; margin: 4px 0; }
        [contenteditable=true] ol                               { list-style: decimal; padding-left: 22px; margin: 4px 0; }
        [contenteditable=true] li                               { margin: 2px 0; }
      `}</style>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
export default function PageChantiers({ chantiers = [], setChantiers, saveConfig, tauxHoraires = {}, T, branch = "renovation", initialSelectedId = null, onSelectionConsumed }) {
  const acc = getBranchAccent(branch);
  const [phasages, setPhasages]         = useState([]);
  // P9 : pointages globaux (tous chantiers) pour dériver heures réelles + coût MO
  // dans calcFinances, suivi par ouvrage et totaux par tâche.
  const [pointages, setPointages]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState(initialSelectedId);
  const [statutFilter, setStatutFilter] = useState("tous");
  const [statutMenuOpen, setStatutMenuOpen] = useState(false);

  // Statut effectif d'un chantier : chantier.statut (source de vérité) ; fallback
  // sur phasage.statut pour compat avec l'existant ; défaut "en_cours" si phasage
  // présent, "planifie" sinon.
  const getStatut = (chantier, phasage) =>
    chantier?.statut || phasage?.statut || (phasage ? "en_cours" : "planifie");

  // Met à jour le statut d'un chantier dans la config globale.
  const updateChantierStatut = (chantierId, nouveauStatut) => {
    if (!setChantiers || !saveConfig) return;
    const u = chantiers.map(c => c.id === chantierId ? { ...c, statut: nouveauStatut } : c);
    setChantiers(u);
    saveConfig("chantiers", u);
  };
  // Si un nouvel ID est demandé en prop (ex : navigation depuis le dashboard),
  // on l'applique et on signale au parent qu'il peut le reset.
  useEffect(() => {
    if (initialSelectedId && initialSelectedId !== selected) {
      setSelected(initialSelectedId);
      onSelectionConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedId]);
  const [photoMap, setPhotoMap]         = useState({});
  const [uploading, setUploading]       = useState(false);
  const [compteRendus, setCompteRendus] = useState([]);
  const [loadingCR, setLoadingCR]       = useState(false);
  const [showLierModal, setShowLierModal] = useState(false);
  const [showLierPhasage, setShowLierPhasage] = useState(false);
  const [tousCRs, setTousCRs]           = useState([]);
  // Adresses des chantiers (stockées en planning_config sous "chantier_adresses")
  // → mapping { chantier_id: { adresse, lat, lon } }
  const [chantierAdresses, setChantierAdresses] = useState({});
  const [adresseDraft, setAdresseDraft]     = useState("");
  const [adresseSaving, setAdresseSaving]   = useState(false);
  const [adresseError, setAdresseError]     = useState("");
  const [rapportsEquipe, setRapportsEquipe] = useState([]);
  const [lightboxGal, setLightboxGal]     = useState(null);
  const [loadingTous, setLoadingTous]   = useState(false);
  const fileInputRef                    = useRef(null);

  const bg      = T?.bg      || "#1e2128";
  const surface = T?.surface || "#262a32";
  const card    = T?.card    || "rgba(255,255,255,0.04)";
  const border  = T?.border  || "rgba(255,255,255,0.07)";
  const text    = T?.text    || "#f0f0f0";
  const textSub = T?.textSub || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // ── Chargement phasages ──
  // select("*") plutôt que la liste explicite : évite les erreurs si une
  // colonne (statut, plan_travaux, photo_batiment…) n'existe pas dans le
  // schéma de cette instance.
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase.from("phasages").select("*");
      // Charge les pointages en parallèle. Si la table n'existe pas, on garde []
      // — calcFinances retombera sur le repli legacy automatiquement.
      const { data: pts, error: ptsErr } = await supabase.from("pointages").select("*");
      if (ptsErr?.code === "42P01") setPointages([]);
      else setPointages(pts || []);
      if (error) {
        console.warn("Chargement phasages :", error.message);
        setPhasages([]);
      } else if (data) {
        setPhasages(data);
        // photoMap est indexé par chantier.id. Comme un phasage peut être lié par
        // nom (et pas par chantier_id exact), on passe par trouverPhasage pour
        // chaque chantier afin de retrouver la photo correspondante.
        const pm = {};
        chantiers.forEach(c => {
          const ph = trouverPhasage(data, c);
          if (ph?.photo_batiment) pm[c.id] = ph.photo_batiment;
        });
        setPhotoMap(pm);
      }
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantiers]);

  // ── Chargement adresses des chantiers (planning_config) ──
  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantier_adresses").maybeSingle()
      .then(({ data }) => setChantierAdresses(data?.value || {}));
  }, []);

  // Resync draft quand on change de chantier
  useEffect(() => {
    if (selected) {
      const existing = chantierAdresses[selected];
      setAdresseDraft(existing?.adresse || "");
      setAdresseError("");
    }
  }, [selected, chantierAdresses]);

  // Géocode + sauvegarde l'adresse via Nominatim (OSM, gratuit, sans clé)
  const handleSaveAdresse = async () => {
    if (!adresseDraft.trim()) return;
    setAdresseSaving(true);
    setAdresseError("");
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adresseDraft.trim())}&format=json&limit=1&addressdetails=0`;
      const r = await fetch(url, { headers: { "Accept-Language": "fr" } });
      const data = await r.json();
      if (!data || data.length === 0) {
        setAdresseError("Adresse non trouvée — vérifiez l'orthographe ou ajoutez la ville/CP.");
      } else {
        const newAdresse = {
          adresse: adresseDraft.trim(),
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
        };
        const updated = { ...chantierAdresses, [selected]: newAdresse };
        await supabase.from("planning_config").upsert(
          { key: "chantier_adresses", value: updated, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
        setChantierAdresses(updated);
      }
    } catch (e) {
      console.error("Géocodage:", e);
      setAdresseError("Erreur lors du géocodage — réessayez.");
    }
    setAdresseSaving(false);
  };

  const handleRemoveAdresse = async () => {
    if (!selected) return;
    const updated = { ...chantierAdresses };
    delete updated[selected];
    await supabase.from("planning_config").upsert(
      { key: "chantier_adresses", value: updated, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    setChantierAdresses(updated);
    setAdresseDraft("");
  };

  // ── Chargement comptes rendus ──
  useEffect(() => {
    if (!selected || loading) { setCompteRendus([]); return; }
    const loadCR = async () => {
      setLoadingCR(true);
      const chantier = chantiers.find(c => c.id === selected);
      const phasage  = trouverPhasage(phasages, chantier);
      const { data: dataById } = await supabase
        .from("cr_comptes_rendus")
        .select("*")
        .eq("chantier_id", selected)
        .order("date_visite", { ascending: false })
        .limit(5);
      if (dataById && dataById.length > 0) {
        setCompteRendus(dataById);
      } else {
        const { data, error } = await supabase
          .from("cr_comptes_rendus")
          .select("*")
          .order("date_visite", { ascending: false })
          .limit(150);
        if (!error && data) {
          const nomsCibles = [chantier?.nom, phasage?.chantier_nom, chantier?.id].filter(Boolean);
          const filtered = data.filter(cr =>
            nomsCibles.some(nom => chantierMatchCR(nom, cr.adresse))
          );
          setCompteRendus(filtered.slice(0, 5));
        }
      }
      setLoadingCR(false);
    };
    loadCR();
  }, [selected, loading, chantiers, phasages]);

  // ── Chargement rapports équipe (table "rapports") pour la galerie photos ──
  useEffect(() => {
    if (!selected) { setRapportsEquipe([]); return; }
    const load = async () => {
      const { data } = await supabase
        .from("rapports")
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, taches, photos_chantier")
        .eq("chantier_id", selected)
        .order("date_rapport", { ascending: false })
        .limit(120);
      if (data) setRapportsEquipe(data);
      else {
        const { data: d2 } = await supabase
          .from("rapports")
          .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, taches")
          .eq("chantier_id", selected)
          .order("date_rapport", { ascending: false })
          .limit(120);
        setRapportsEquipe(d2 || []);
      }
    };
    load();
  }, [selected]);

  const photosEquipe = (() => {
    const all = [];
    rapportsEquipe.forEach(r => {
      (r.photos_chantier || []).forEach(url => {
        all.push({ url, ouvrier: r.ouvrier, date: r.date_rapport, source: "Vue chantier" });
      });
      (r.taches || []).forEach(t => {
        (t.photos || []).forEach(url => {
          all.push({ url, ouvrier: r.ouvrier, date: r.date_rapport, source: t.planifie || "Tâche" });
        });
      });
    });
    return all;
  })();

  const ouvrirLierModal = async () => {
    setShowLierModal(true);
    setLoadingTous(true);
    const { data } = await supabase
      .from("cr_comptes_rendus")
      .select("*")
      .order("date_visite", { ascending: false });
    setTousCRs((data || []).filter(cr => cr.chantier_id !== selected));
    setLoadingTous(false);
  };

  // Lie un phasage existant à ce chantier en mettant à jour son chantier_id.
  // Permet de réparer manuellement les liens cassés (chantiers renommés, etc.)
  const lierPhasage = async (phasageId) => {
    const ch = chantiers.find(c => c.id === selected);
    if (!ch) return;
    const { error } = await supabase.from("phasages")
      .update({ chantier_id: selected, chantier_nom: ch.nom })
      .eq("id", phasageId);
    if (error) { console.error("Lier phasage:", error); return; }
    setPhasages(prev => prev.map(p => p.id === phasageId
      ? { ...p, chantier_id: selected, chantier_nom: ch.nom }
      : p));
    setShowLierPhasage(false);
  };

  const lierCR = async (crId) => {
    await supabase.from("cr_comptes_rendus").update({ chantier_id: selected }).eq("id", crId);
    setTousCRs(prev => prev.filter(cr => cr.id !== crId));
    const { data } = await supabase
      .from("cr_comptes_rendus")
      .select("*")
      .eq("chantier_id", selected)
      .order("date_visite", { ascending: false })
      .limit(5);
    if (data) setCompteRendus(data);
  };

  const handlePhotoUpload = async (e, chantierId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const ext  = file.name.split(".").pop();
      // Cache-buster pour forcer le rafraîchissement de l'image après upsert
      const path = `chantiers/${chantierId}/batiment.${ext}`;
      const { error: upErr } = await supabase.storage.from("photos").upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("photos").getPublicUrl(path);
      const url = urlData?.publicUrl;
      // Recherche du phasage : par chantier_id exact, sinon par fuzzy match
      // (un phasage peut être lié par nom plutôt qu'id).
      const chantier = chantiers.find(c => c.id === chantierId);
      const phasage  = trouverPhasage(phasages, chantier);
      if (phasage) {
        const { error: updErr } = await supabase.from("phasages")
          .update({ photo_batiment: url }).eq("id", phasage.id);
        if (updErr) throw updErr;
        setPhasages(prev => prev.map(p => p.id === phasage.id ? { ...p, photo_batiment: url } : p));
      } else {
        // Pas de phasage → on en crée un minimal pour persister la photo.
        const { data: newPh, error: insErr } = await supabase.from("phasages")
          .insert({ chantier_id: chantierId, chantier_nom: chantier?.nom, ouvrages: [], photo_batiment: url })
          .select().single();
        if (insErr) throw insErr;
        if (newPh) setPhasages(prev => [...prev, newPh]);
      }
      setPhotoMap(prev => ({ ...prev, [chantierId]: url }));
    } catch (err) {
      console.error("Erreur upload photo:", err);
      const msg = err?.message || err?.error || String(err);
      alert(`Erreur upload photo : ${msg}\n\nVérifiez que le bucket 'photos' existe et que les politiques RLS autorisent l'upload sur le chemin 'chantiers/*'.`);
    }
    setUploading(false);
  };

  const selectedChantier = chantiers.find(c => c.id === selected);
  const selectedPhasage  = trouverPhasage(phasages, selectedChantier);
  const avancement       = selectedPhasage ? calcAvancement(selectedPhasage) : 0;
  // P9 : pointages du chantier sélectionné → index pour heuresEff/coutMOEff + extras (libre/indirect)
  const pointagesChantierSelected = selectedPhasage
    ? pointages.filter(p => p.chantier_id === selectedPhasage.chantier_id)
    : [];
  const ptsIndexSelected = indexPointagesParTache(pointagesChantierSelected);
  const extraSelected = sumLibreEtIndirect(pointagesChantierSelected);
  const finances         = selectedPhasage ? calcFinances(selectedPhasage, tauxHoraires, ptsIndexSelected, extraSelected) : null;
  const adresseGeo       = selected ? chantierAdresses[selected] : null;

  // Heures vendues vs réelles par OUVRAGE (suivi des dérives).
  // Source : ouvrage.heures_devis pour les vendues, somme des heures_reelles
  // des tâches rattachées à l'ouvrage (toutes phases confondues) pour le réel.
  // Tâches sans ouvrage_id → groupées sous "Sans ouvrage" en fin de liste.
  const heuresParOuvrage = (() => {
    if (!selectedPhasage) return [];
    const ouvrages = selectedPhasage.ouvrages || [];
    const tachesParOuvrage = new Map();
    const orphan = { reelles: 0, vendues: 0 };
    PHASES.forEach(ph => {
      (selectedPhasage.plan_travaux?.[ph.id] || []).forEach(t => {
        const hR = heuresEff(t, ptsIndexSelected); // P9 : dérivé du registre, repli legacy
        const hV = parseFloat(t.heures_vendues) || 0;
        if (t.ouvrage_id) {
          if (!tachesParOuvrage.has(t.ouvrage_id)) tachesParOuvrage.set(t.ouvrage_id, { reelles: 0, phasesCount: {} });
          const entry = tachesParOuvrage.get(t.ouvrage_id);
          entry.reelles += hR;
          entry.phasesCount[ph.id] = (entry.phasesCount[ph.id] || 0) + 1;
        } else {
          orphan.reelles += hR;
          orphan.vendues += hV;
        }
      });
    });
    const result = ouvrages.map(o => {
      const entry = tachesParOuvrage.get(o.id) || { reelles: 0, phasesCount: {} };
      const vendues = parseFloat(o.heures_devis) || 0;
      // Couleur = celle de la phase dominante (la plus de tâches), fallback accent
      let domPhaseId = null, maxCount = 0;
      Object.entries(entry.phasesCount).forEach(([phId, count]) => {
        if (count > maxCount) { maxCount = count; domPhaseId = phId; }
      });
      const couleur = PHASES.find(p => p.id === domPhaseId)?.couleur || acc.accent;
      return { id: o.id, label: o.libelle || "(sans nom)", couleur, vendues, reelles: entry.reelles };
    }).filter(o => o.vendues > 0 || o.reelles > 0);
    if (orphan.vendues > 0 || orphan.reelles > 0) {
      result.push({ id: "_orphan", label: "Sans ouvrage rattaché", couleur: textMuted, ...orphan });
    }
    return result;
  })();
  const totalHeures = heuresParOuvrage.reduce((s, o) => ({
    vendues: s.vendues + o.vendues,
    reelles: s.reelles + o.reelles,
  }), { vendues: 0, reelles: 0 });

  // ── Styles communs (cohérent avec autres pages) ──
  const sectionTitle = {
    fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
    letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 12,
    display: "flex", alignItems: "center", gap: 8,
  };

  // ─── VUE LISTE ────────────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="pchan-list" style={{ flex: 1, overflowY: "auto", background: bg, padding: "28px 32px" }}>
        <style>{`
          .chantier-card { transition: all .18s; cursor: pointer; }
          .chantier-card:hover { transform: translateY(-2px); box-shadow: 0 12px 36px rgba(0,0,0,0.4); border-color: ${acc.border} !important; }
          @media(max-width:768px) { .chantiers-grid { grid-template-columns: 1fr !important; } }
          @media(max-width:767px) {
            .pchan-list{padding:14px 12px!important}
            .pchan-list h1{font-size:22px!important}
            .pchan-list .pchan-list-header{flex-direction:column;align-items:flex-start!important;gap:10px!important}
            .pchan-list .pchan-stats{width:100%;gap:8px!important}
            .pchan-list .pchan-stats > div{flex:1;min-width:0!important;padding:8px 10px!important}
            .pchan-list .chantier-card .chantier-card-photo{height:130px!important}
            .pchan-list .chantier-card .chantier-card-body{padding:12px 14px!important;gap:8px!important}
            .pchan-list .chantier-card .chantier-card-name{font-size:15px!important}
          }
        `}</style>

        <div className="pchan-list-header" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={HardHat} size={20} strokeWidth={2}/>
          </div>
          <div>
            <h1 style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>Mes chantiers</h1>
            <p style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3 }}>
              {chantiers.length} chantier{chantiers.length > 1 ? "s" : ""} · {phasages.length} phasage{phasages.length > 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* ── Filtres par statut ── */}
        {(() => {
          const counts = chantiers.reduce((acc, c) => {
            const ph = trouverPhasage(phasages, c);
            const s = getStatut(c, ph);
            acc[s] = (acc[s] || 0) + 1;
            return acc;
          }, {});
          const filters = [
            { key: "tous",     label: "Tous",      count: chantiers.length, color: textSub },
            { key: "planifie", label: "Planifié",  count: counts.planifie || 0, color: STATUTS.planifie.color, bg: STATUTS.planifie.bg },
            { key: "en_cours", label: "En cours",  count: counts.en_cours || 0, color: STATUTS.en_cours.color, bg: STATUTS.en_cours.bg },
            { key: "termine",  label: "Terminé",   count: counts.termine  || 0, color: STATUTS.termine.color,  bg: STATUTS.termine.bg  },
          ];
          return (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
              {filters.map(f => {
                const active = statutFilter === f.key;
                return (
                  <button key={f.key} onClick={() => setStatutFilter(f.key)} style={{
                    display: "inline-flex", alignItems: "center", gap: 8,
                    padding: "7px 14px", borderRadius: RADIUS.pill,
                    border: `1px solid ${active ? (f.color || acc.accent) : border}`,
                    background: active ? (f.bg || acc.bg10) : "transparent",
                    color: active ? (f.color || acc.accent) : textSub,
                    fontSize: FONT.sm.size, fontWeight: 700,
                    cursor: "pointer", fontFamily: "inherit",
                    transition: "all .15s",
                  }}>
                    {f.label}
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700,
                      padding: "1px 7px", borderRadius: RADIUS.pill,
                      background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                      color: active ? (f.color || acc.accent) : textMuted,
                    }}>{f.count}</span>
                  </button>
                );
              })}
            </div>
          );
        })()}

        {(() => {
          const chantiersFiltres = chantiers.filter(chantier => {
            if (statutFilter === "tous") return true;
            return getStatut(chantier, trouverPhasage(phasages, chantier)) === statutFilter;
          });
          if (loading) {
            return <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>Chargement…</div>;
          }
          if (chantiers.length === 0) {
            return (
              <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
                <div style={{
                  width: 64, height: 64, borderRadius: RADIUS.xl,
                  background: acc.bg10, color: acc.accent,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 16,
                }}>
                  <Icon as={HardHat} size={28}/>
                </div>
                <div style={{ fontSize: FONT.base.size, color: text, fontWeight: 600 }}>Aucun chantier</div>
                <div style={{ fontSize: FONT.sm.size, opacity: .7, marginTop: 4 }}>Ajoutez-en dans les réglages.</div>
              </div>
            );
          }
          if (chantiersFiltres.length === 0) {
            return (
              <div style={{ textAlign: "center", padding: 60, color: textMuted }}>
                <div style={{ fontSize: FONT.base.size, color: text, fontWeight: 600 }}>Aucun chantier avec ce statut</div>
                <button onClick={() => setStatutFilter("tous")} style={{
                  marginTop: 12, padding: "7px 14px", borderRadius: RADIUS.md,
                  border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
                  fontSize: FONT.sm.size, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}>Voir tous les chantiers</button>
              </div>
            );
          }
          return (
          <div className="chantiers-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
            {chantiersFiltres.map(chantier => {
              const phasage = trouverPhasage(phasages, chantier);
              const av      = phasage ? calcAvancement(phasage) : null;
              const ptsCh   = phasage ? pointages.filter(p => p.chantier_id === phasage.chantier_id) : [];
              const ptsIdx  = indexPointagesParTache(ptsCh);
              const extras  = sumLibreEtIndirect(ptsCh);
              const fin     = phasage ? calcFinances(phasage, tauxHoraires, ptsIdx, extras) : null;
              const photo   = photoMap[chantier.id];
              const statut  = getStatut(chantier, phasage);

              return (
                <div key={chantier.id} className="chantier-card"
                  onClick={() => setSelected(chantier.id)}
                  style={{
                    background: surface, border: `1px solid ${border}`,
                    borderRadius: RADIUS.xl, overflow: "hidden",
                    display: "flex", flexDirection: "column",
                    borderTop: `3px solid ${chantier.couleur}`,
                  }}>
                  <div className="chantier-card-photo" style={{ height: 160, background: "rgba(255,255,255,0.04)", position: "relative", overflow: "hidden", flexShrink: 0 }}>
                    {photo ? (
                      <img src={photo} alt={chantier.nom} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    ) : (
                      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: textMuted }}>
                        <Icon as={Building2} size={32} strokeWidth={1.5} style={{ opacity: .35 }}/>
                        <span style={{ fontSize: FONT.xs.size, opacity: .6 }}>Aucune photo</span>
                      </div>
                    )}
                    {statut && <div style={{ position: "absolute", top: 10, right: 10 }}><StatutBadge statut={statut}/></div>}
                    {phasage && (
                      <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: FONT.xs.size, color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.55)", borderRadius: RADIUS.sm, padding: "2px 8px", fontWeight: 600 }}>
                        {phasage.chantier_nom}
                      </div>
                    )}
                  </div>

                  <div className="chantier-card-body" style={{ padding: "14px 16px", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="chantier-card-name" style={{
                      fontSize: FONT.md.size, fontWeight: 700, color: text,
                      letterSpacing: -0.2,
                    }}>{chantier.nom}</div>

                    {av !== null ? (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                          <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Avancement</span>
                          <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: av >= 100 ? "#22c55e" : acc.accent }}>{av}%</span>
                        </div>
                        <ProgressBar value={av} color={acc.accent}/>
                      </div>
                    ) : (
                      <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, opacity: .55, fontStyle: "italic" }}>
                        Pas de phasage créé
                      </div>
                    )}

                    {fin && fin.prixVendu > 0 && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: RADIUS.md, padding: "8px 10px" }}>
                          <div style={{ fontSize: FONT.xs.size, color: textMuted, marginBottom: 2 }}>Marché</div>
                          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text }}>{fmt(fin.prixVendu)}</div>
                        </div>
                        <div style={{
                          flex: 1,
                          background: fin.marge >= 0 ? "rgba(34,197,94,0.10)" : "rgba(225,90,90,0.10)",
                          borderRadius: RADIUS.md, padding: "8px 10px",
                        }}>
                          <div style={{ fontSize: FONT.xs.size, color: textMuted, marginBottom: 2 }}>Marge</div>
                          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: fin.marge >= 0 ? "#22c55e" : "#e15a5a" }}>
                            {fmt(fin.marge)}{" "}
                            <span style={{ fontSize: FONT.xs.size, opacity: .7, fontWeight: 600 }}>({fin.margePct.toFixed(0)}%)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
    );
  }

  // ─── VUE DÉTAILLÉE ───────────────────────────────────────────────────────────
  return (
    <div className="pchan-detail" style={{ flex: 1, overflowY: "auto", background: bg }}>
      <style>{`
        .ch-stat-card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: ${RADIUS.lg}px; padding: 14px 16px; }
        .ch-photo-upload:hover { border-color: ${acc.accent} !important; background: ${acc.bg10} !important; }
        .tache-row { border-bottom: 1px solid rgba(255,255,255,0.05); transition: background .12s; }
        .tache-row:hover { background: rgba(255,255,255,0.04); }
        .tache-row:last-child { border-bottom: none; }
        @media(max-width:768px) { .ch-fin-grid { grid-template-columns: 1fr 1fr !important; } .ch-content-grid { grid-template-columns: 1fr !important; } .ch-map-grid { grid-template-columns: 1fr !important; } .ch-budget-grid { grid-template-columns: 1fr !important; } .ch-budget-totaux { grid-template-columns: 1fr 1fr !important; } }
        @media(max-width:767px) {
          .pchan-detail .pchan-detail-header{padding:12px 14px!important;gap:10px!important}
          .pchan-detail .pchan-detail-header h1{font-size:18px!important}
          .pchan-detail .pchan-detail-body{padding:14px 12px!important;gap:18px!important}
          .pchan-detail .ch-photo-upload{height:180px!important}
          .pchan-detail .ch-stat-card{padding:12px!important}
          .pchan-detail .ch-stat-card > div:nth-child(2){font-size:16px!important}
          .pchan-detail .ch-fin-grid{grid-template-columns:1fr 1fr!important;gap:8px!important}
        }
      `}</style>

      {/* Header */}
      <div className="pchan-detail-header" style={{
        background: surface, borderBottom: `1px solid ${border}`,
        padding: "14px 28px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <button onClick={() => { setSelected(null); setCompteRendus([]); }} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "transparent", border: `1px solid ${border}`,
          borderRadius: RADIUS.md, padding: "6px 12px",
          color: textSub, fontSize: FONT.sm.size, fontWeight: 600,
          cursor: "pointer", fontFamily: "inherit",
          transition: "border-color .12s, color .12s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = textSub; }}>
          <Icon as={ArrowLeft} size={14}/>
          Retour
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: FONT.xl.size, fontWeight: 800, color: text, margin: 0, letterSpacing: -0.3 }}>{selectedChantier?.nom || "Chantier"}</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {/* Sélecteur de statut — toujours présent (même sans phasage) */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setStatutMenuOpen(o => !o)}
                title="Changer le statut"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "transparent", border: "none", padding: 0,
                  cursor: setChantiers ? "pointer" : "default",
                  fontFamily: "inherit",
                }}>
                <StatutBadge statut={getStatut(selectedChantier, selectedPhasage)}/>
                {setChantiers && (
                  <Icon as={ChevronLeft} size={11} color={textMuted} style={{ transform: "rotate(-90deg)" }}/>
                )}
              </button>
              {statutMenuOpen && setChantiers && (
                <>
                  <div onClick={() => setStatutMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 100 }}/>
                  <div style={{
                    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 101,
                    background: surface, border: `1px solid ${border}`,
                    borderRadius: RADIUS.md, boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
                    padding: 6, minWidth: 160,
                    display: "flex", flexDirection: "column", gap: 2,
                  }}>
                    {["planifie", "en_cours", "en_pause", "termine"].map(s => {
                      const def = STATUTS[s];
                      const isCur = getStatut(selectedChantier, selectedPhasage) === s;
                      return (
                        <button key={s} onClick={() => {
                          updateChantierStatut(selectedChantier.id, s);
                          setStatutMenuOpen(false);
                        }} style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "7px 10px", borderRadius: RADIUS.sm, border: "none",
                          background: isCur ? def.bg : "transparent",
                          color: isCur ? def.color : text,
                          fontSize: FONT.sm.size, fontWeight: 600, textAlign: "left",
                          cursor: "pointer", fontFamily: "inherit",
                        }}
                          onMouseEnter={e => { if (!isCur) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                          onMouseLeave={e => { if (!isCur) e.currentTarget.style.background = "transparent"; }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: def.color, flexShrink: 0 }}/>
                          {def.label}
                          {isCur && <Icon as={Check} size={12} style={{ marginLeft: "auto" }}/>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            {selectedPhasage ? (
              <>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>{selectedPhasage.chantier_nom}</span>
                {selectedPhasage.updated_at && (
                  <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, opacity: .6 }}>
                    · Phasage maj {new Date(selectedPhasage.updated_at).toLocaleDateString("fr-FR")}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: FONT.sm.size, color: textMuted, opacity: .55, fontStyle: "italic" }}>Aucun phasage trouvé pour ce chantier</span>
            )}
          </div>
        </div>
      </div>

      <div className="pchan-detail-body" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200, margin: "0 auto" }}>

        {/* ── Section 1 : Photo + avancement ── */}
        <div className="ch-content-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20 }}>
          <div>
            <div style={sectionTitle}>
              <Icon as={Camera} size={13}/> Photo du bâtiment
            </div>
            <div className="ch-photo-upload" style={{
              height: 240, borderRadius: RADIUS.xl, overflow: "hidden", position: "relative",
              border: `2px dashed ${border}`, cursor: "pointer", transition: "all .18s",
              background: "rgba(255,255,255,0.03)",
            }} onClick={() => fileInputRef.current?.click()}>
              {photoMap[selected] ? (
                <>
                  <img src={photoMap[selected]} alt="Bâtiment" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "10px 14px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))", display: "flex", justifyContent: "flex-end" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
                      <Icon as={Pencil} size={11}/>
                      Modifier
                    </span>
                  </div>
                </>
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: textMuted }}>
                  {uploading ? (
                    <>
                      <Icon as={Camera} size={32} strokeWidth={1.5}/>
                      <span style={{ fontSize: FONT.sm.size }}>Upload en cours…</span>
                    </>
                  ) : (
                    <>
                      <Icon as={Camera} size={36} strokeWidth={1.5} style={{ opacity: .5 }}/>
                      <span style={{ fontSize: FONT.sm.size }}>Cliquer pour ajouter une photo</span>
                      <span style={{ fontSize: FONT.xs.size, opacity: .55 }}>JPG, PNG, WEBP</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handlePhotoUpload(e, selected)}/>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={sectionTitle}>
              <Icon as={TrendingUp} size={13}/> Avancement global
            </div>
            {selectedPhasage ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
                <AvancementCircle value={avancement} accent={acc.accent}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FONT.sm.size, color: textMuted, marginBottom: 8 }}>Détail par phase</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 170, overflowY: "auto" }}>
                    {PHASES.map(ph => {
                      const taches = selectedPhasage.plan_travaux?.[ph.id] || [];
                      if (taches.length === 0) return null;
                      const totalH = taches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
                      const av = totalH > 0
                        ? Math.round(taches.reduce((s, t) => s + ((parseFloat(t.avancement)||0)*(parseFloat(t.heures_vendues)||0)),0)/totalH)
                        : Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement)||0), 0) / taches.length);
                      return (
                        <div key={ph.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: ph.couleur, flexShrink: 0 }}/>
                          <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, minWidth: 140, flexShrink: 0 }}>{ph.label}</span>
                          <div style={{ flex: 1 }}><ProgressBar value={av} color={ph.couleur} height={5}/></div>
                          <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: text, minWidth: 32, textAlign: "right" }}>{av}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                padding: "24px 24px 20px", textAlign: "center", color: textMuted, fontSize: FONT.sm.size,
                background: card, borderRadius: RADIUS.lg, border: `1px solid ${border}`,
              }}>
                <Icon as={ClipboardList} size={28} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 8 }}/>
                <div style={{ color: text, fontWeight: 600, marginBottom: 4 }}>Aucun phasage lié à ce chantier</div>
                <div style={{ opacity: .65, fontSize: FONT.xs.size + 1, marginBottom: 14 }}>
                  Soit le phasage existe déjà mais n'est pas lié, soit il faut le créer depuis la page Phasage.
                </div>
                {phasages.length > 0 && (
                  <button onClick={() => setShowLierPhasage(true)} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "7px 14px", borderRadius: RADIUS.md, border: `1px solid ${acc.border}`,
                    background: acc.bg10, color: acc.accent,
                    fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                    cursor: "pointer",
                  }}>
                    <Icon as={Link2} size={12}/>
                    Lier un phasage existant
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modale liaison phasage */}
        {showLierPhasage && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:800, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowLierPhasage(false)}>
            <div style={{ background:surface, border:`1px solid ${border}`, borderRadius:RADIUS.xl, width:"100%", maxWidth:560, maxHeight:"80vh", display:"flex", flexDirection:"column", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e=>e.stopPropagation()}>
              <div style={{ padding:"16px 20px 12px", borderBottom:`1px solid ${border}`, flexShrink:0, display:"flex", alignItems:"center", gap:10 }}>
                <Icon as={Link2} size={16} color={acc.accent}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:FONT.md.size, fontWeight:800, color:text, letterSpacing:-.2 }}>
                    Lier un phasage existant
                  </div>
                  <div style={{ fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3 }}>
                    À <span style={{color:acc.accent, fontWeight:600}}>{selectedChantier?.nom}</span>
                  </div>
                </div>
                <button onClick={()=>setShowLierPhasage(false)} title="Fermer" style={{
                  background:"transparent", border:"none", color:textMuted,
                  cursor:"pointer", padding:4, borderRadius:RADIUS.sm,
                  display:"inline-flex", alignItems:"center",
                }}>
                  <Icon as={X} size={18}/>
                </button>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
                {phasages.length === 0 ? (
                  <div style={{ textAlign:"center", padding:40, color:textMuted, opacity:.65, fontSize:FONT.sm.size }}>
                    Aucun phasage n'existe encore. Créez-en un depuis la page Phasage.
                  </div>
                ) : (
                  phasages.map(p => {
                    const dejaChantier = chantiers.find(c => c.id === p.chantier_id);
                    return (
                      <div key={p.id} style={{
                        display:"flex", alignItems:"center", gap:12,
                        padding:"11px 14px", borderRadius:RADIUS.md, marginBottom:8,
                        background:card, border:`1px solid ${border}`,
                      }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:FONT.sm.size + 1, fontWeight:700, color:text, marginBottom:2 }}>
                            {p.chantier_nom || "(sans nom)"}
                          </div>
                          <div style={{ fontSize:FONT.xs.size + 1, color:textMuted }}>
                            chantier_id: <code style={{ background:"rgba(255,255,255,0.06)", padding:"1px 5px", borderRadius:3, fontSize:FONT.xs.size }}>{p.chantier_id || "—"}</code>
                          </div>
                          {dejaChantier && dejaChantier.id !== selected && (
                            <div style={{
                              display:"inline-block", marginTop:4,
                              fontSize:FONT.xs.size, color:"#f97316",
                              background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.3)",
                              borderRadius:RADIUS.sm, padding:"1px 6px", fontWeight:600,
                            }}>
                              Actuellement lié à : {dejaChantier.nom}
                            </div>
                          )}
                        </div>
                        <button onClick={()=>lierPhasage(p.id)} style={{
                          display:"inline-flex", alignItems:"center", gap:5,
                          flexShrink:0, padding:"6px 12px", borderRadius:RADIUS.md, border:"none",
                          background:acc.accent, color:acc.onAccent,
                          fontSize:FONT.xs.size + 1, fontWeight:700,
                          cursor:"pointer", fontFamily:"inherit",
                        }}>
                          <Icon as={Check} size={11}/>
                          Lier
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div style={{ padding:"10px 18px", borderTop:`1px solid ${border}`, display:"flex", justifyContent:"flex-end", flexShrink:0 }}>
                <button onClick={()=>setShowLierPhasage(false)} style={{
                  padding:"7px 16px", borderRadius:RADIUS.md, border:`1px solid ${border}`,
                  background:"transparent", color:textSub,
                  cursor:"pointer", fontFamily:"inherit",
                  fontSize:FONT.sm.size, fontWeight: 600,
                }}>Fermer</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Section : Localisation (adresse + carte + street view) ── */}
        <div>
          <div style={sectionTitle}>
            <Icon as={MapPin} size={13}/> Localisation
          </div>
          <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, padding: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                value={adresseDraft}
                onChange={e => setAdresseDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveAdresse(); }}
                placeholder="Ex : 10 rue de la Paix, 75002 Paris"
                style={{
                  flex: 1, minWidth: 200,
                  padding: "9px 12px 9px 32px",
                  borderRadius: RADIUS.md,
                  border: `1px solid ${border}`,
                  background: T?.inputBg || card, color: text,
                  fontFamily: "inherit", fontSize: FONT.base.size,
                  outline: "none",
                  backgroundImage: "none",
                  position: "relative",
                }}
              />
              <button onClick={handleSaveAdresse} disabled={!adresseDraft.trim() || adresseSaving} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 16px",
                borderRadius: RADIUS.md, border: "none",
                background: !adresseDraft.trim() || adresseSaving ? textMuted : acc.accent,
                color: acc.onAccent, fontFamily: "inherit",
                fontSize: FONT.sm.size, fontWeight: 800,
                cursor: !adresseDraft.trim() || adresseSaving ? "not-allowed" : "pointer",
              }}>
                <Icon as={Search} size={13}/>
                {adresseSaving ? "Recherche…" : adresseGeo ? "Mettre à jour" : "Localiser"}
              </button>
              {adresseGeo && (
                <button onClick={handleRemoveAdresse} title="Retirer l'adresse" style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "9px 11px",
                  borderRadius: RADIUS.md, border: `1px solid ${border}`,
                  background: "transparent", color: "#e15a5a",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Icon as={X} size={13}/>
                </button>
              )}
            </div>
            {adresseError && (
              <div style={{
                marginTop: 10, padding: "6px 12px", borderRadius: RADIUS.md,
                background: "rgba(225,90,90,0.10)", color: "#e15a5a",
                fontSize: FONT.xs.size + 1, fontWeight: 600,
              }}>{adresseError}</div>
            )}

            {adresseGeo && (() => {
              // Si une clé Google Maps Embed est fournie via VITE_GOOGLE_MAPS_KEY,
              // on utilise l'API officielle qui permet d'afficher Street View
              // directement en iframe. Sinon, fallback sur la carte basique
              // (sans clé) + bouton qui ouvre Street View dans un nouvel onglet.
              const gMapsKey = import.meta.env.VITE_GOOGLE_MAPS_KEY;
              const mapSrc = gMapsKey
                ? `https://www.google.com/maps/embed/v1/place?key=${gMapsKey}&q=${adresseGeo.lat},${adresseGeo.lon}&zoom=17`
                : `https://www.google.com/maps?q=${adresseGeo.lat},${adresseGeo.lon}&z=17&output=embed`;
              const svSrc = gMapsKey
                ? `https://www.google.com/maps/embed/v1/streetview?key=${gMapsKey}&location=${adresseGeo.lat},${adresseGeo.lon}&heading=0&pitch=0&fov=90`
                : null;
              return (
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
                  marginTop: 14,
                }} className="ch-map-grid">
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: textMuted, letterSpacing: .8, textTransform: "uppercase" }}>
                        Vue carte
                      </span>
                      <a href={`https://www.google.com/maps/dir/?api=1&destination=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 4,
                           fontSize: FONT.xs.size, color: acc.accent, textDecoration: "none",
                           fontWeight: 700,
                         }}>
                        <Icon as={ExternalLink} size={11}/>
                        Itinéraire
                      </a>
                    </div>
                    <iframe
                      title="Carte du chantier"
                      src={mapSrc}
                      style={{ width: "100%", height: 280, border: 0, borderRadius: RADIUS.lg, display: "block" }}
                      loading="lazy"
                      allowFullScreen
                    />
                  </div>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: textMuted, letterSpacing: .8, textTransform: "uppercase" }}>
                        Street View
                      </span>
                      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "inline-flex", alignItems: "center", gap: 4,
                           fontSize: FONT.xs.size, color: acc.accent, textDecoration: "none",
                           fontWeight: 700,
                         }}>
                        <Icon as={ExternalLink} size={11}/>
                        Plein écran
                      </a>
                    </div>
                    {svSrc ? (
                      <iframe
                        title="Street View"
                        src={svSrc}
                        style={{ width: "100%", height: 280, border: 0, borderRadius: RADIUS.lg, display: "block" }}
                        loading="lazy"
                        allowFullScreen
                      />
                    ) : (
                      <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${adresseGeo.lat},${adresseGeo.lon}`}
                         target="_blank" rel="noopener noreferrer"
                         style={{
                           display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
                           width: "100%", height: 280,
                           borderRadius: RADIUS.lg,
                           background: `linear-gradient(135deg, ${acc.bg10}, ${acc.bg20})`,
                           border: `1px dashed ${acc.border}`,
                           color: acc.accent,
                           textDecoration: "none",
                           cursor: "pointer", transition: "transform .15s, border-color .15s",
                         }}
                         onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = acc.accent; }}
                         onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.borderColor = acc.border; }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: "50%",
                          background: acc.bg20, color: acc.accent,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <Icon as={MapPin} size={24}/>
                        </div>
                        <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, textAlign: "center", maxWidth: 260, lineHeight: 1.4 }}>
                          Configurez VITE_GOOGLE_MAPS_KEY pour afficher Street View intégré
                        </div>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, color: textMuted }}>
                          <Icon as={ExternalLink} size={11}/>
                          Cliquer pour ouvrir Street View dans Google Maps
                        </span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })()}
            {!adresseGeo && (
              <div style={{
                marginTop: 12, fontSize: FONT.xs.size + 1, color: textMuted, opacity: .7,
              }}>
                Saisissez l'adresse du chantier pour afficher la carte et le Street View.
              </div>
            )}
          </div>
        </div>

        {/* ── Section : Notes du chantier ── */}
        <div>
          <div style={sectionTitle}>
            <Icon as={StickyNote} size={13}/> Notes du chantier
          </div>
          <NotesChantier chantierId={selected} T={T} accent={acc.accent}/>
        </div>

        {/* ── Section : Suivi des heures par ouvrage ── */}
        {heuresParOuvrage.length > 0 && (
          <div>
            <div style={sectionTitle}>
              <Icon as={Clock} size={13}/> Suivi des heures par ouvrage
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {/* Totaux en haut */}
              {totalHeures.vendues > 0 && (() => {
                const drift = (totalHeures.reelles / totalHeures.vendues) * 100;
                const col = drift > 120 ? "#ef4444" : drift > 100 ? "#f59e0b" : "#22c55e";
                return (
                  <div style={{
                    padding: "14px 16px",
                    borderBottom: `1px solid ${border}`,
                    display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: textMuted, letterSpacing: 1, textTransform: "uppercase" }}>
                      Total chantier
                    </span>
                    <span style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -0.3 }}>
                      {fmtH(totalHeures.reelles)}h
                      <span style={{ fontSize: FONT.sm.size, color: textMuted, fontWeight: 600, marginLeft: 4 }}>
                        / {fmtH(totalHeures.vendues)}h vendues
                      </span>
                    </span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: col,
                      background: col + "18", border: `1px solid ${col}40`,
                      borderRadius: RADIUS.pill, padding: "3px 10px",
                      marginLeft: "auto",
                    }}>
                      <Icon as={drift > 100 ? TrendingUp : TrendingDown} size={11}/>
                      {drift.toFixed(0)}%
                    </span>
                  </div>
                );
              })()}
              {heuresParOuvrage.map(o => {
                const drift = o.vendues > 0 ? (o.reelles / o.vendues) * 100 : (o.reelles > 0 ? 999 : 0);
                const col = drift > 120 ? "#ef4444" : drift > 100 ? "#f59e0b" : "#22c55e";
                const widthVendu  = Math.min(100, drift);
                const widthOver   = Math.min(80, Math.max(0, drift - 100));
                return (
                  <div key={o.id} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: o.couleur, flexShrink: 0 }}/>
                      <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                      <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: col, flexShrink: 0 }}>
                        {fmtH(o.reelles)}h / {fmtH(o.vendues)}h
                        {o.vendues > 0 && (
                          <span style={{ fontSize: FONT.xs.size, opacity: .8, marginLeft: 5, fontWeight: 700 }}>
                            ({drift.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden", display: "flex" }}>
                      <div style={{ width: `${widthVendu}%`, background: col, transition: "width .4s ease" }}/>
                      {widthOver > 0 && (
                        <div style={{
                          width: `${widthOver}%`,
                          background: "repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, rgba(239,68,68,0.6) 4px, rgba(239,68,68,0.6) 8px)",
                        }}/>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 2 : Finances ── */}
        {finances && finances.prixVendu > 0 && (
          <div>
            <div style={sectionTitle}>
              <Icon as={Wallet} size={13}/> Finances du chantier
            </div>
            <div className="ch-fin-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
              {[
                { label: "Prix marché HT",    val: fmt(finances.prixVendu), color: text,       sub: "Vendu au client",  icon: Banknote },
                { label: "Coût main d'œuvre", val: fmt(finances.coutMO),   color: "#60a5fa",  sub: "Heures réelles",  icon: HardHat },
                { label: "Coût matériaux",    val: fmt(finances.coutMat),  color: "#f59e0b",  sub: "Matériaux",        icon: Receipt },
                { label: "Marge brute",       val: fmt(finances.marge),
                  color: finances.marge >= 0 ? "#22c55e" : "#e15a5a",
                  sub: `${finances.margePct.toFixed(1)}% du marché`,
                  icon: finances.marge >= 0 ? TrendingUp : TrendingDown,
                  bold: true },
              ].map(s => (
                <div key={s.label} className="ch-stat-card">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, marginBottom: 6, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase" }}>
                    <Icon as={s.icon} size={11}/>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: s.bold ? 800 : 700, color: s.color, lineHeight: 1.15, letterSpacing: -0.3 }}>{s.val}</div>
                  <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 4, opacity: .75 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {finances.coutTotal > 0 && (
              <div style={{ marginTop: 12, background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "12px 16px" }}>
                <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginBottom: 8 }}>Décomposition du coût total ({fmt(finances.coutTotal)})</div>
                <div style={{ display: "flex", height: 8, borderRadius: 6, overflow: "hidden", gap: 2 }}>
                  <div style={{ flex: finances.coutMO || 0.001, background: "#60a5fa" }}/>
                  <div style={{ flex: finances.coutMat || 0.001, background: "#f59e0b" }}/>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "#60a5fa", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#60a5fa" }}/>
                    Main d'œuvre {finances.coutTotal > 0 ? `${Math.round((finances.coutMO/finances.coutTotal)*100)}%` : ""}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: "#f59e0b" }}/>
                    Matériaux {finances.coutTotal > 0 ? `${Math.round((finances.coutMat/finances.coutTotal)*100)}%` : ""}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 2bis : Budget prévisionnel & suivi des coûts ── */}
        {selectedPhasage && (() => {
          const TAUX_DEFAUT = 20;
          const allTaches   = PHASES.flatMap(ph => (selectedPhasage.plan_travaux?.[ph.id] || []));
          // Taux moyen pondéré : on tente d'abord par sous-tâche (ancien modèle
          // qui avait heures_vendues pondérées par ratio). Sinon on retombe sur
          // une moyenne arithmétique des taux des ouvriers assignés.
          let sumPond = 0, sumPoids = 0;
          allTaches.forEach(t => {
            const hV = parseFloat(t.heures_vendues) || 0;
            if (hV <= 0) return;
            const pO = (t.ouvriers || [])[0] || "";
            const taux = pO ? (parseFloat(tauxHoraires?.[pO]) || TAUX_DEFAUT) : TAUX_DEFAUT;
            sumPond  += hV * taux;
            sumPoids += hV;
          });
          // Heures vendues : nouveau modèle = somme des heures_devis des ouvrages
          // (source de vérité depuis le refactor). Fallback : somme par tâche.
          const totalHVenduOuvrages = (selectedPhasage.ouvrages || []).reduce(
            (s, o) => s + (parseFloat(o.heures_devis) || 0), 0
          );
          const totalHVendues = totalHVenduOuvrages > 0 ? totalHVenduOuvrages : sumPoids;
          // Taux moyen : si pas de pondération par sous-tâche, moyenne
          // arithmétique des taux des ouvriers assignés (fallback TAUX_DEFAUT).
          let tauxMoyen = sumPoids > 0 ? sumPond / sumPoids : 0;
          if (tauxMoyen === 0 && allTaches.length > 0) {
            const tauxParTache = allTaches.map(t => {
              const pO = (t.ouvriers || [])[0] || "";
              return pO ? (parseFloat(tauxHoraires?.[pO]) || TAUX_DEFAUT) : TAUX_DEFAUT;
            });
            tauxMoyen = tauxParTache.reduce((a, b) => a + b, 0) / tauxParTache.length;
          }
          const coutMOPrev     = totalHVendues * tauxMoyen;
          const coutMOReel     = finances?.coutMO || 0;

          // Agrégats matériaux par phase
          const lignesPhases = PHASES.map(ph => {
            const taches    = selectedPhasage.plan_travaux?.[ph.id] || [];
            const matsPrev  = selectedPhasage.plan_travaux?.[ph.id + "__materiaux_prevus"] || [];
            const coutCmd   = parseFloat(selectedPhasage.plan_travaux?.[ph.id + "__cout_commandes"]) || 0;
            const dateCmd   = selectedPhasage.plan_travaux?.[ph.id + "__date_commande"] || null;
            const coutPrev  = matsPrev.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
            const coutMatTaches = taches.reduce((s, t) => s + (parseFloat(t.cout_materiel) || 0), 0);
            const coutReel  = coutMatTaches + coutCmd;
            return {
              id: ph.id, label: ph.label, couleur: ph.couleur, emoji: ph.emoji,
              matsPrev, coutPrev, coutReel, coutCmd, dateCmd,
              hasMat: matsPrev.length > 0 || coutCmd > 0 || coutMatTaches > 0,
              statutCmd: coutCmd > 0 ? "commande" : "a_commander",
            };
          }).filter(l => l.hasMat);

          const totalMatPrev = lignesPhases.reduce((s, l) => s + l.coutPrev, 0);
          const totalMatReel = lignesPhases.reduce((s, l) => s + l.coutReel, 0);
          const coutTotalPrev = coutMOPrev + totalMatPrev;
          const coutTotalReel = coutMOReel + totalMatReel;
          const prixVendu    = parseFloat(selectedPhasage.prix_vendu) || 0;
          const margePrev    = prixVendu - coutTotalPrev;
          const margeReel    = prixVendu - coutTotalReel;
          const aucunMatPrev = lignesPhases.every(l => l.matsPrev.length === 0);

          const fmtH = (n) => `${(+(parseFloat(n) || 0).toFixed(1))}h`;
          const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;

          return (
            <div>
              <div style={sectionTitle}>
                <Icon as={TrendingUp} size={13}/> Budget prévisionnel & suivi des coûts
              </div>

              <div className="ch-budget-grid" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
                {/* ── SECTION 1 : Main d'œuvre ── */}
                <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                    <Icon as={HardHat} size={12} color="#60a5fa"/>
                    Main d'œuvre
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Heures vendues</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace" }}>{fmtH(totalHVendues)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                        Taux moyen pondéré
                        <span style={{ fontSize: 10, color: textMuted, opacity: .7, marginLeft: 5, fontStyle: "italic" }}>(défaut 20 €/h)</span>
                      </span>
                      <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text, fontFamily: "'DM Mono',monospace" }}>{tauxMoyen.toFixed(2)} €/h</span>
                    </div>
                    <div style={{ height: 1, background: border, margin: "2px 0" }}/>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Coût MO prévisionnel</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: "#60a5fa", fontFamily: "'DM Mono',monospace" }}>{fmt(coutMOPrev)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>Coût MO réel</span>
                      <span style={{ fontSize: FONT.md.size, fontWeight: 800, color: coutMOReel > coutMOPrev && coutMOPrev > 0 ? "#e15a5a" : text, fontFamily: "'DM Mono',monospace" }}>{fmt(coutMOReel)}</span>
                    </div>
                  </div>
                </div>

                {/* ── SECTION 2 : Matériaux ── */}
                <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, color: textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>
                    <Icon as={Package} size={12} color="#f59e0b"/>
                    Matériaux par phase
                  </div>

                  {lignesPhases.length === 0 || aucunMatPrev ? (
                    <div style={{
                      padding: "20px 14px", textAlign: "center",
                      background: card, borderRadius: RADIUS.md, border: `1px dashed ${border}`,
                      color: textMuted,
                    }}>
                      <Icon as={Package} size={24} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 6 }}/>
                      <div style={{ fontSize: FONT.sm.size, color: text, fontWeight: 600, marginBottom: 3 }}>
                        Aucun matériau prévisionnel défini
                      </div>
                      <div style={{ fontSize: FONT.xs.size + 1, opacity: .8, lineHeight: 1.5 }}>
                        Ajoute des matériaux par phase depuis la page <strong style={{ color: text }}>Phasage</strong>.
                      </div>
                    </div>
                  ) : (
                    <div className="ch-budget-mat-wrap" style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${border}` }}>
                            {[
                              { l: "Phase",          align: "left",   w: 160 },
                              { l: "Matériaux prévus", align: "left",  w: null },
                              { l: "Prévu HT",       align: "right",  w: 90 },
                              { l: "Réel HT",        align: "right",  w: 90 },
                              { l: "Statut",         align: "center", w: 100 },
                              { l: "À cmd. avant",   align: "center", w: 110 },
                            ].map(h => (
                              <th key={h.l} style={{
                                padding: "8px 8px", fontSize: 10, fontWeight: 700, color: textMuted,
                                textTransform: "uppercase", letterSpacing: .8, textAlign: h.align,
                                width: h.w || undefined,
                              }}>{h.l}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {lignesPhases.map(l => (
                            <tr key={l.id} style={{ borderBottom: `1px solid ${border}` }}>
                              <td style={{ padding: "8px 8px" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.couleur, flexShrink: 0 }}/>
                                  <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: text }}>{l.emoji ? `${l.emoji} ` : ""}{l.label}</span>
                                </span>
                              </td>
                              <td style={{ padding: "8px 8px", fontSize: FONT.xs.size + 1, color: textSub, lineHeight: 1.5 }}>
                                {l.matsPrev.length === 0 ? (
                                  <span style={{ color: textMuted, fontStyle: "italic" }}>—</span>
                                ) : (
                                  l.matsPrev.map((m, i) => (
                                    <span key={m.id}>
                                      <span style={{ color: text, fontWeight: 600 }}>{m.libelle}</span>
                                      <span style={{ color: textMuted }}> ({m.quantite}{m.unite ? ` ${m.unite}` : ""})</span>
                                      {i < l.matsPrev.length - 1 && <span style={{ color: textMuted }}> · </span>}
                                    </span>
                                  ))
                                )}
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "right", fontSize: FONT.sm.size, fontWeight: 700, color: "#f59e0b", fontFamily: "'DM Mono',monospace" }}>
                                {l.coutPrev > 0 ? fmt(l.coutPrev) : "—"}
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "right", fontSize: FONT.sm.size, fontWeight: 700, color: l.coutReel > l.coutPrev && l.coutPrev > 0 ? "#e15a5a" : text, fontFamily: "'DM Mono',monospace" }}>
                                {l.coutReel > 0 ? fmt(l.coutReel) : "—"}
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "center" }}>
                                <span style={{
                                  fontSize: 10, fontWeight: 700, letterSpacing: .5,
                                  padding: "2px 8px", borderRadius: RADIUS.pill,
                                  textTransform: "uppercase",
                                  background: l.statutCmd === "commande" ? "rgba(34,197,94,0.15)" : "rgba(245,166,35,0.15)",
                                  color:      l.statutCmd === "commande" ? "#22c55e" : "#f59e0b",
                                  border:    `1px solid ${l.statutCmd === "commande" ? "#22c55e44" : "#f59e0b44"}`,
                                }}>
                                  {l.statutCmd === "commande" ? "Commandé" : "À commander"}
                                </span>
                              </td>
                              <td style={{ padding: "8px 8px", textAlign: "center", fontSize: FONT.xs.size + 1, color: l.dateCmd ? textSub : textMuted, fontStyle: l.dateCmd ? "normal" : "italic" }}>
                                {fmtDate(l.dateCmd) || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* ── TOTAUX ── */}
              <div style={{ marginTop: 12, background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: "14px 16px" }}>
                <div className="ch-budget-totaux" style={{ display: "grid", gridTemplateColumns: prixVendu > 0 ? "repeat(6,1fr)" : "repeat(4,1fr)", gap: 12 }}>
                  {[
                    { l: "MO prévisionnel",  v: coutMOPrev,  color: "#60a5fa" },
                    { l: "MO réel",          v: coutMOReel,  color: coutMOReel > coutMOPrev && coutMOPrev > 0 ? "#e15a5a" : text },
                    { l: "Matériaux prév.",  v: totalMatPrev, color: "#f59e0b" },
                    { l: "Matériaux réel",   v: totalMatReel, color: totalMatReel > totalMatPrev && totalMatPrev > 0 ? "#e15a5a" : text },
                    ...(prixVendu > 0 ? [
                      { l: "Marge prévisionnelle", v: margePrev, color: margePrev >= 0 ? "#22c55e" : "#e15a5a", bold: true, sub: `Coût ${fmt(coutTotalPrev)} vs ${fmt(prixVendu)}` },
                      { l: "Marge constatée",      v: margeReel, color: margeReel >= 0 ? "#22c55e" : "#e15a5a", bold: true, sub: `Coût ${fmt(coutTotalReel)} vs ${fmt(prixVendu)}` },
                    ] : []),
                  ].map(t => (
                    <div key={t.l}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: .6, marginBottom: 4 }}>{t.l}</div>
                      <div style={{ fontSize: t.bold ? 17 : 15, fontWeight: t.bold ? 800 : 700, color: t.color, fontFamily: "'DM Mono',monospace", letterSpacing: -0.3 }}>
                        {fmt(t.v)}
                      </div>
                      {t.sub && <div style={{ fontSize: 10, color: textMuted, marginTop: 3, opacity: .85 }}>{t.sub}</div>}
                    </div>
                  ))}
                </div>
                {prixVendu === 0 && (
                  <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, color: textMuted, fontStyle: "italic" }}>
                    <Icon as={Info} size={11}/>
                    Prix vendu non renseigné dans le phasage — la marge n'est pas affichée.
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Section 3 : Comptes rendus ── */}
        <div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ ...sectionTitle, marginBottom: 0 }}>
                <Icon as={ClipboardList} size={13}/> Derniers comptes rendus client
              </div>
              <button onClick={ouvrirLierModal} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                fontSize: FONT.xs.size + 1, fontWeight: 600,
                padding: "5px 10px", borderRadius: RADIUS.md,
                border: `1px solid ${border}`, background: "transparent", color: textSub,
                cursor: "pointer", fontFamily: "inherit",
                transition: "border-color .12s, color .12s",
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = acc.accent; e.currentTarget.style.color = acc.accent; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = textSub; }}>
                <Icon as={Link2} size={11}/>
                Lier un CR
              </button>
            </div>

            {/* Modale liaison CRs existants */}
            {showLierModal && (
              <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:800, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={()=>setShowLierModal(false)}>
                <div style={{ background:surface, border:`1px solid ${border}`, borderRadius:RADIUS.xl, width:"100%", maxWidth:560, maxHeight:"80vh", display:"flex", flexDirection:"column", boxShadow:"0 24px 60px rgba(0,0,0,0.6)" }} onClick={e=>e.stopPropagation()}>
                  <div style={{ padding:"16px 20px 12px", borderBottom:`1px solid ${border}`, flexShrink:0, display:"flex", alignItems:"center", gap:10 }}>
                    <Icon as={Link2} size={16} color={acc.accent}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:FONT.md.size, fontWeight:800, color:text, letterSpacing:-.2 }}>
                        Lier un compte rendu
                      </div>
                      <div style={{ fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3 }}>
                        À <span style={{color:acc.accent, fontWeight:600}}>{selectedChantier?.nom}</span>
                      </div>
                    </div>
                    <button onClick={()=>setShowLierModal(false)} title="Fermer" style={{
                      background:"transparent", border:"none", color:textMuted,
                      cursor:"pointer", padding:4, borderRadius:RADIUS.sm,
                      display:"inline-flex", alignItems:"center",
                    }}>
                      <Icon as={X} size={18}/>
                    </button>
                  </div>
                  <div style={{ flex:1, overflowY:"auto", padding:"12px 16px" }}>
                    {loadingTous ? (
                      <div style={{ textAlign:"center", padding:40, color:textMuted, fontSize:FONT.sm.size }}>Chargement…</div>
                    ) : tousCRs.length === 0 ? (
                      <div style={{ textAlign:"center", padding:40, color:textMuted, opacity:.65, fontSize:FONT.sm.size }}>
                        Tous les comptes rendus sont déjà liés à un chantier.
                      </div>
                    ) : (
                      tousCRs.map(cr => {
                        const nomClient = cr.client_nom1 ? `${cr.client_prenom1||""} ${cr.client_nom1}`.trim() : "Sans client";
                        const dejaLie = cr.chantier_id && cr.chantier_id !== selected;
                        return (
                          <div key={cr.id} style={{
                            display:"flex", alignItems:"center", gap:12,
                            padding:"11px 14px", borderRadius:RADIUS.md, marginBottom:8,
                            background:card, border:`1px solid ${border}`,
                          }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:2 }}>
                                <span style={{ fontSize:FONT.sm.size + 1, fontWeight:700, color:text }}>{nomClient}</span>
                                {dejaLie && (
                                  <span style={{
                                    fontSize:FONT.xs.size, color:"#f97316",
                                    background:"rgba(249,115,22,0.12)", border:"1px solid rgba(249,115,22,0.3)",
                                    borderRadius:RADIUS.sm, padding:"1px 6px", fontWeight:600,
                                  }}>
                                    Lié à un autre chantier
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize:FONT.xs.size + 1, color:textMuted }}>
                                {cr.type_visite || "Visite"}{cr.date_visite ? ` · ${new Date(cr.date_visite).toLocaleDateString("fr-FR")}` : ""}
                              </div>
                              {cr.adresse && <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:FONT.xs.size, color:textMuted, opacity:.55, marginTop:2 }}>
                                <Icon as={MapPin} size={9}/> {cr.adresse}
                              </div>}
                              {cr.resume && <div style={{
                                fontSize:FONT.xs.size + 1, color:textMuted, marginTop:3, opacity:.75,
                                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                              }}>{cr.resume}</div>}
                            </div>
                            <button onClick={()=>lierCR(cr.id)} style={{
                              display:"inline-flex", alignItems:"center", gap:5,
                              flexShrink:0, padding:"6px 12px", borderRadius:RADIUS.md, border:"none",
                              background:acc.accent, color:acc.onAccent,
                              fontSize:FONT.xs.size + 1, fontWeight:700,
                              cursor:"pointer", fontFamily:"inherit",
                            }}>
                              <Icon as={Check} size={11}/>
                              Lier
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                  <div style={{ padding:"10px 18px", borderTop:`1px solid ${border}`, display:"flex", justifyContent:"flex-end", flexShrink:0 }}>
                    <button onClick={()=>setShowLierModal(false)} style={{
                      padding:"7px 16px", borderRadius:RADIUS.md, border:`1px solid ${border}`,
                      background:"transparent", color:textSub,
                      cursor:"pointer", fontFamily:"inherit",
                      fontSize:FONT.sm.size, fontWeight: 600,
                    }}>Fermer</button>
                  </div>
                </div>
              </div>
            )}

            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {loadingCR ? (
                <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: FONT.sm.size }}>Chargement…</div>
              ) : compteRendus.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: textMuted, fontSize: FONT.sm.size }}>
                  <div style={{ opacity: .55, marginBottom: 8 }}>Aucun compte rendu client pour ce chantier.</div>
                  <div style={{ fontSize: FONT.xs.size + 1, opacity: .55, lineHeight: 1.6 }}>
                    Dans la page « Compte rendu client », renseignez<br/>
                    <strong style={{ color: text, opacity: .75 }}>{selectedChantier?.nom}</strong> dans le champ <em>Adresse</em><br/>
                    pour lier automatiquement les CRs à ce chantier.
                  </div>
                </div>
              ) : (
                compteRendus.map((cr, i) => (
                  <div key={cr.id || i} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: text }}>
                          {cr.date_visite ? new Date(cr.date_visite).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}
                        </span>
                        {cr.type_visite && (
                          <span style={{ fontSize: FONT.xs.size, color: textMuted, background: "rgba(255,255,255,0.06)", borderRadius: RADIUS.sm, padding: "1px 6px", fontWeight: 600 }}>{cr.type_visite}</span>
                        )}
                      </div>
                      {cr.avancement != null && (
                        <span style={{ fontSize: FONT.xs.size + 1, color: acc.accent, fontWeight: 700 }}>{cr.avancement}%</span>
                      )}
                    </div>
                    {cr.adresse && (
                      <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize: FONT.xs.size, color: textMuted, opacity: .55, marginBottom: 3 }}>
                        <Icon as={MapPin} size={9}/> {cr.adresse}
                      </div>
                    )}
                    {cr.resume && (
                      <p style={{ fontSize: FONT.xs.size + 1, color: textMuted, margin: 0, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {cr.resume}
                      </p>
                    )}
                    {cr.prochaine_etape && (
                      <div style={{ fontSize: FONT.xs.size + 1, color: "#3b82f6", marginTop: 5, fontWeight: 600 }}>→ {cr.prochaine_etape}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* ── Section : Activité équipe récente (rapports ouvriers) ── */}
        {rapportsEquipe.length > 0 && (
          <div>
            <div style={{ ...sectionTitle, marginBottom: 12 }}>
              <Icon as={HardHat} size={13}/>
              Activité équipe récente
              <span style={{ color: acc.accent, fontWeight: 800, marginLeft: 4 }}>· {rapportsEquipe.length}</span>
            </div>
            <div style={{ background: card, border: `1px solid ${border}`, borderRadius: RADIUS.xl, overflow: "hidden" }}>
              {rapportsEquipe.slice(0, 8).map(r => {
                const taches = r.taches || [];
                const nbFaites    = taches.filter(t => t.statut === "faite").length;
                const nbEnCours   = taches.filter(t => t.statut === "en_cours").length;
                const nbNonFaites = taches.filter(t => t.statut === "non_faite").length;
                const totalHeures = taches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
                return (
                  <div key={r.id} className="tache-row" style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        fontSize: FONT.sm.size + 1, fontWeight: 700, color: text,
                      }}>
                        <Icon as={HardHat} size={13} color={acc.accent}/>
                        {r.ouvrier}
                      </span>
                      <span style={{ fontSize: FONT.xs.size + 1, color: textMuted }}>
                        {r.date_rapport}
                      </span>
                      {totalHeures > 0 && (
                        <span style={{ fontSize: FONT.xs.size + 1, color: "#f59e0b", fontWeight: 700 }}>
                          {fmtH(totalHeures)}h
                        </span>
                      )}
                      <div style={{ marginLeft: "auto", display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {nbFaites > 0 && (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#22c55e", background: "rgba(34,197,94,0.10)",
                            border: "1px solid rgba(34,197,94,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            <Icon as={Check} size={9}/> {nbFaites} faite{nbFaites > 1 ? "s" : ""}
                          </span>
                        )}
                        {nbEnCours > 0 && (
                          <span style={{
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#f59e0b", background: "rgba(245,158,11,0.10)",
                            border: "1px solid rgba(245,158,11,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            {nbEnCours} en cours
                          </span>
                        )}
                        {nbNonFaites > 0 && (
                          <span style={{
                            fontSize: FONT.xs.size, fontWeight: 700,
                            color: "#e15a5a", background: "rgba(225,90,90,0.10)",
                            border: "1px solid rgba(225,90,90,0.25)",
                            borderRadius: RADIUS.pill, padding: "1px 7px",
                          }}>
                            {nbNonFaites} non faite{nbNonFaites > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {taches.length > 0 && (
                      <div style={{
                        fontSize: FONT.xs.size + 1, color: textMuted, lineHeight: 1.5,
                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                      }}>
                        {taches.map(t => t.planifie).filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })}
              {rapportsEquipe.length > 8 && (
                <div style={{ padding: "10px 16px", textAlign: "center", fontSize: FONT.xs.size + 1, color: textMuted, borderTop: `1px solid ${border}` }}>
                  + {rapportsEquipe.length - 8} rapport{rapportsEquipe.length - 8 > 1 ? "s" : ""} plus ancien{rapportsEquipe.length - 8 > 1 ? "s" : ""}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section 4 : Galerie photos équipe ── */}
        <div>
          <div style={{ ...sectionTitle, marginBottom: 12 }}>
            <Icon as={ImageIcon} size={13}/>
            Photos des équipes
            {photosEquipe.length > 0 && <span style={{color:acc.accent, fontWeight: 800, marginLeft: 4 }}>· {photosEquipe.length}</span>}
          </div>
          {photosEquipe.length === 0 ? (
            <div style={{
              background: card, border: `2px dashed ${border}`, borderRadius: RADIUS.xl,
              padding: "32px 20px", textAlign: "center", color: textMuted,
            }}>
              <Icon as={Camera} size={32} strokeWidth={1.5} style={{ opacity: .4, marginBottom: 10 }}/>
              <div style={{ fontSize: FONT.base.size, fontWeight: 600, marginBottom: 5, color: text }}>Aucune photo pour ce chantier</div>
              <div style={{ fontSize: FONT.xs.size + 1, opacity: .6 }}>
                Les photos jointes par les ouvriers à leur compte rendu apparaîtront ici.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
              {photosEquipe.map((ph, i) => (
                <div key={i}
                  onClick={() => setLightboxGal({ urls: photosEquipe.map(p => p.url), idx: i, items: photosEquipe })}
                  style={{
                    position:"relative", aspectRatio:"1/1", borderRadius:RADIUS.lg, overflow:"hidden",
                    border:`1px solid ${border}`, cursor:"pointer", background:"#0a0c10",
                  }}>
                  <img src={photoTransform(ph.url,{width:256,height:256})} alt="" loading="lazy"
                    style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                  <div style={{position:"absolute",bottom:0,left:0,right:0,
                    background:"linear-gradient(transparent, rgba(0,0,0,0.78))",
                    padding:"14px 8px 6px",color:"#fff"}}>
                    <div style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:FONT.xs.size,fontWeight:700}}>
                      <Icon as={HardHat} size={10}/> {ph.ouvrier}
                    </div>
                    <div style={{fontSize:FONT.xs.size - 1,opacity:.8,marginTop:1}}>{new Date(ph.date).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Lightbox galerie */}
      {lightboxGal && (
        <div onClick={()=>setLightboxGal(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:14
        }}>
          <img src={photoTransform(lightboxGal.urls[lightboxGal.idx],{width:1920,height:1920,resize:"contain",quality:80})} alt="" style={{
            maxWidth:"100%",maxHeight:"calc(100vh - 140px)",objectFit:"contain",borderRadius:RADIUS.md
          }} onClick={e=>e.stopPropagation()}/>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}} onClick={e=>e.stopPropagation()}>
            {lightboxGal.urls.length > 1 && (
              <>
                <button onClick={()=>setLightboxGal(l=>({...l, idx:(l.idx-1+l.urls.length)%l.urls.length}))}
                  style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:RADIUS.md,padding:"8px 12px",cursor:"pointer",
                    fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronLeft} size={16}/>
                </button>
                <span style={{color:"#fff",fontSize:FONT.sm.size,fontWeight:600}}>{lightboxGal.idx+1} / {lightboxGal.urls.length}</span>
                <button onClick={()=>setLightboxGal(l=>({...l, idx:(l.idx+1)%l.urls.length}))}
                  style={{
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:RADIUS.md,padding:"8px 12px",cursor:"pointer",
                    fontFamily:"inherit",
                  }}>
                  <Icon as={ChevronRight} size={16}/>
                </button>
              </>
            )}
            {lightboxGal.items && lightboxGal.items[lightboxGal.idx] && (
              <span style={{display:"inline-flex",alignItems:"center",gap:6,color:"rgba(255,255,255,0.85)",fontSize:FONT.xs.size + 1}}>
                <Icon as={HardHat} size={11}/>
                {lightboxGal.items[lightboxGal.idx].ouvrier} · {new Date(lightboxGal.items[lightboxGal.idx].date).toLocaleDateString("fr-FR")} · {lightboxGal.items[lightboxGal.idx].source}
              </span>
            )}
            <a href={lightboxGal.urls[lightboxGal.idx]} target="_blank" rel="noopener noreferrer"
              style={{
                display:"inline-flex",alignItems:"center",gap:5,
                background:acc.accent,color:acc.onAccent,borderRadius:RADIUS.md,padding:"7px 12px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,textDecoration:"none",
              }}>
              <Icon as={ExternalLink} size={12}/>
              Ouvrir
            </a>
            <button onClick={()=>setLightboxGal(null)} style={{
              background:"rgba(255,255,255,0.1)",
              border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:RADIUS.md,
              padding:"7px 14px",cursor:"pointer",fontFamily:"inherit",
              fontSize:FONT.sm.size,fontWeight:600,
            }}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cercle d'avancement ──────────────────────────────────────────────────────
function AvancementCircle({ value, accent }) {
  const r    = 46;
  const circ = 2 * Math.PI * r;
  const pct  = Math.min(100, Math.max(0, value || 0));
  const dash = (pct / 100) * circ;
  const color = pct >= 100 ? "#22c55e" : accent;
  return (
    <div style={{ position: "relative", width: 110, height: 110, flexShrink: 0 }}>
      <svg width="110" height="110" viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="9"/>
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
          style={{ transition: "stroke-dasharray .5s ease" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1, letterSpacing: -0.3 }}>{pct}%</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 2, letterSpacing: .3, textTransform: "uppercase", fontWeight: 600 }}>avancement</span>
      </div>
    </div>
  );
}
