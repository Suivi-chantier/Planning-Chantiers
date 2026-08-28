import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots, loadGroupesTypes, loadEquipes, getCurrentWeek, getWeekId, LOGO_RENO_H } from "../constants";
import { Icon } from "../ui";
import {
  ListChecks, Sparkles, Building2, Boxes, Hammer, ClipboardList,
  ChevronDown, Plus, Trash2, FileSpreadsheet, X, Check, AlertTriangle,
  Pencil, Settings, FileDown, GanttChartSquare, LayoutGrid,
  Banknote, HardHat, Receipt, TrendingUp, TrendingDown, Percent, Clock, Target,
  FileText, User, Calendar, Link2, Car, ListOrdered, GripVertical, FolderPlus, Flag,
  ChevronUp, ChevronRight, Filter, CalendarClock, ClipboardCheck, Network,
} from "lucide-react";
import { parseDevisExcel } from "../devisImport";
import {
  buildChronoInitFromGroupesTypes, sortByChrono,
  estJalonControle, JALON_TYPE_REPERE, buildJalonControle, completerJalonsControle,
} from "./chronoTemplate";
// Écran de contrôle de fin de groupe (Point 2 b) — overlay plein écran monté
// depuis la vue chrono (bouton « Contrôler » du jalon de contrôle).
import ControleGroupe from "./ControleGroupe";
// État de contrôle d'un groupe (badge signalé, jamais bloquant).
import { etatControleGroupe } from "./controles";
import { confirmPerteMassive } from "../guards";
// Méthode des rangs (Point 4a) : calculs PURS — chaînage par défaut déduit de
// l'ordre des groupes + chrono_ordre, rangs, incohérences. Rien n'est stocké.
import { calculerRangs, predecesseursEffectifs, positionsManuelles, cycleApresPatch, organiserTaches, reordonnancementPropose } from "./rang";
import { fetchPointages } from "../pointages";
// SOURCE DE VÉRITÉ des calculs financiers et d'avancement : src/chantierFinance.js.
// Ce composant ne calcule plus rien — il lit les Donnee du module et garde la présentation.
import {
  computeChantierFinance, indexPointagesParTache,
  tachePointages as cfTachePointages,
  tacheHeuresReelles as cfTacheHeuresReelles,
  tacheHeuresVendues,
  tachePointagesParOuvrier as cfTachePointagesParOuvrier,
  heuresReellesOuvrage as cfHeuresReellesOuvrage,
  heuresVenduesOuvrage, prixHTOuvrage, coutMatOuvrage, totalLignes,
  avancementOuvrage, avancementOuvrageDetail, avancementTacheDetail,
  ouvragesDuLot as cfOuvragesDuLot,
  avancementLotDetail as cfAvancementLotDetail,
  avancementChantierDetail as cfAvancementChantierDetail,
  couleurDerive, couleurDepassement, couleurMarge,
  fmtH, eur,
  heuresParMois as cfHeuresParMois,
} from "../chantierFinance";
// Composants partagés (KPI, infobulles, modale de ventilation) — communs avec
// la page Bilan semaine. La présentation vit là, le contenu dans les Donnee.
import { KpiCard, KpiDetailModal, cfgFromDonnee, InfoBulle } from "./chantierFinanceUI";
// Prévisionnel client : structure, génération auto depuis les groupes datés et
// gabarit PDF — module partagé avec le Chemin de fer (prévisionnel d'opération).
import {
  defaultPrevisionnel, normalizePrevisionnel,
  blocsAutoDepuisGroupes, buildPrevisionnelDocHTML,
} from "./previsionnelDoc";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte du phasage : vue 3 colonnes (Lots → Ouvrages → Tâches) pour un
// chantier sélectionné en haut de page. Lit/écrit dans les mêmes tables
// Supabase que la v1 (`phasages`, `bibliotheque_ratios`, `planning_config`).
// Les ouvrages portent un nouveau champ `lot_id` qui les rattache à un lot.

const rid = () => Math.random().toString(36).slice(2, 10);

// Membres proposables d'une équipe : responsable + membres, par prénom
// (la clé de jointure de toute l'appli), sans doublon. Un membre avec une
// date_dispo FUTURE (embauche à venir, ex : Keita en septembre) reste visible
// dans l'Admin mais n'est ni proposé au pré-remplissage ni compté ici tant
// que sa date n'est pas atteinte. L'équipe Externe (externe: true, sans
// membres) renvoie donc une liste vide.
const membresEquipe = (eq) => {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const list = [
    eq?.responsable,
    ...(eq?.membres || [])
      .filter(m => !m.date_dispo || String(m.date_dispo).slice(0, 10) <= aujourdhui)
      .map(m => m.ouvrier),
  ].filter(Boolean);
  return [...new Set(list)];
};

const JOURS_SEM = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

// Arrondit un nombre d'heures au quart d'heure le plus proche (0,25 / 0,5 /
// 0,75 / 1 …). Utilisé UNIQUEMENT pour la durée envoyée au planning hebdo (ce
// que voient les ouvriers) — les heures restent exactes dans le phasage.
const arrondiQuart = (h) => {
  const n = parseFloat(h);
  if (isNaN(n)) return null;
  return Math.round(n * 4) / 4;
};

// Répartit un total d'heures entre des tâches selon leur poids. Base de
// pondération en cascade : ratio (copié de la biblio) → heures_estimees →
// parts égales. Renvoie un tableau de valeurs EXACTES (2 décimales, non
// arrondies) aligné sur `taches`. Si `total` est vide, renvoie des null.
function repartirHeures(total, taches) {
  const t = Array.isArray(taches) ? taches : [];
  const tot = parseFloat(total);
  if (isNaN(tot) || t.length === 0) return t.map(() => null);
  let poids = t.map(x => parseFloat(x.ratio) || 0);
  let somme = poids.reduce((s, p) => s + p, 0);
  if (somme <= 0) {
    poids = t.map(x => parseFloat(x.heures_estimees) || 0);
    somme = poids.reduce((s, p) => s + p, 0);
  }
  if (somme <= 0) {
    poids = t.map(() => 1);
    somme = t.length;
  }
  return poids.map(p => parseFloat((tot * p / somme).toFixed(2)));
}

// Convertit un weekId "YYYY-W##" + un jour ("Lundi", etc.) en date ISO
// yyyy-mm-dd. ISO 8601 : la semaine 1 contient le 4 janvier.
function getDateFromWeekAndDay(weekId, jourName) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || "");
  if (!m) return "";
  const year = parseInt(m[1], 10), week = parseInt(m[2], 10);
  const idx = JOURS_SEM.indexOf(jourName);
  if (idx < 0) return "";
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  const d = new Date(mon);
  d.setDate(mon.getDate() + idx);
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// ─── PRÉVISIONNEL CLIENT ──────────────────────────────────────────────────────
// Structure, normalisation et gabarit PDF : src/Renovation/previsionnelDoc.js
// (module PARTAGÉ avec le Chemin de fer pour le prévisionnel d'opération).
// Stocké dans phasage.plan_travaux.meta.previsionnel.

// ─── ÉDITEUR PRÉVISIONNEL CLIENT ──────────────────────────────────────────────
// Formulaire d'édition du calendrier prévisionnel (sous-titre, livraison,
// blocs mois/encadrés). Les modifications remontent via updatePrev (debounce +
// persistance dans meta.previsionnel). Le rendu final se voit dans l'export PDF.
// onGenerer : remplit les blocs automatiquement depuis les groupes planifiés
// (date_prevue) — la saisie manuelle reste possible pour retoucher.
function PrevisionnelEditor({ prev, updatePrev, chantier, T, acc, onGenerer }) {
  const p = prev || defaultPrevisionnel();

  const setField = (field, val) => updatePrev(cur => ({ ...cur, [field]: val }));
  const setBlocs = (fn) => updatePrev(cur => ({ ...cur, blocs: fn(cur.blocs || []) }));
  const addMois = () => setBlocs(bs => [...bs, { id: rid(), type: "mois", titre: "", lignes: [""] }]);
  const addEncadre = () => setBlocs(bs => [...bs, { id: rid(), type: "encadre", titre: "Étape conditionnelle", texte: "" }]);
  const updateBloc = (id, patch) => setBlocs(bs => bs.map(b => b.id === id ? { ...b, ...patch } : b));
  const removeBloc = (id) => setBlocs(bs => bs.filter(b => b.id !== id));
  const moveBloc = (id, dir) => setBlocs(bs => {
    const i = bs.findIndex(b => b.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= bs.length) return bs;
    const next = [...bs]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const addLigne = (blocId) => setBlocs(bs => bs.map(b => b.id === blocId ? { ...b, lignes: [...(b.lignes || []), ""] } : b));
  const updateLigne = (blocId, idx, val) => setBlocs(bs => bs.map(b => b.id === blocId ? { ...b, lignes: (b.lignes || []).map((l, i) => i === idx ? val : l) } : b));
  const removeLigne = (blocId, idx) => setBlocs(bs => bs.map(b => b.id === blocId ? { ...b, lignes: (b.lignes || []).filter((_, i) => i !== idx) } : b));

  const inputStyle = {
    width: "100%", padding: "8px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${T.border}`, background: T.inputBg, color: T.text,
    fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
  };
  const labelStyle = {
    display: "block", fontSize: 9, fontWeight: 700, letterSpacing: .6,
    textTransform: "uppercase", color: T.textMuted, marginBottom: 5,
  };
  const cardStyle = {
    background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 16,
  };
  const iconBtn = (title, onClick, opts = {}) => (
    <button onClick={onClick} title={title} disabled={opts.disabled} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 26, height: 26, borderRadius: RADIUS.sm, flexShrink: 0,
      border: `1px solid ${T.border}`, background: "transparent",
      color: opts.danger ? "#e15a5a" : T.textSub,
      cursor: opts.disabled ? "default" : "pointer", opacity: opts.disabled ? .35 : 1,
      fontSize: 13, fontWeight: 700, lineHeight: 1,
    }}>{opts.children}</button>
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "20px 22px", background: T.bg || T.surface }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* En-tête d'aide + génération automatique depuis les tâches datées */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", background: acc.bg10, border: `1px solid ${acc.border}`, borderRadius: RADIUS.lg }}>
          <Icon as={Calendar} size={16} color={acc.accent} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.55, flex: 1 }}>
            Prépare un <strong style={{ color: T.text }}>calendrier prévisionnel à communiquer au client</strong>. Si les tâches sont déjà datées, <strong style={{ color: T.text }}>génère les étapes automatiquement</strong> depuis le planning, retouche si besoin, puis exporte en PDF via le bouton <strong style={{ color: T.text }}>PDF Prévisionnel</strong>.
          </div>
          {onGenerer && (
            <button onClick={onGenerer} title="Remplit les mois automatiquement depuis les groupes de tâches datés (date prévue)" style={{
              display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: "none", background: acc.accent, color: "#1a1f2e",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            }}>
              <Icon as={Sparkles} size={14} /> Générer depuis le planning
            </button>
          )}
        </div>

        {/* Bloc identité : sous-titre + livraison */}
        <div style={cardStyle}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Sous-titre du chantier</label>
            <input style={inputStyle} value={p.sous_titre} placeholder="ex : Rénovation — appartements 1 à 5"
              onChange={e => setField("sous_titre", e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Livraison — mois</label>
              <input style={inputStyle} value={p.livraison_mois} placeholder="ex : Oct."
                onChange={e => setField("livraison_mois", e.target.value)} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={labelStyle}>Livraison — année</label>
              <input style={inputStyle} value={p.livraison_annee} placeholder="ex : 2026"
                onChange={e => setField("livraison_annee", e.target.value)} />
            </div>
          </div>
        </div>

        {/* Blocs */}
        {(p.blocs || []).length === 0 && (
          <div style={{ textAlign: "center", padding: "26px 16px", color: T.textMuted, fontSize: FONT.sm.size, border: `1px dashed ${T.border}`, borderRadius: RADIUS.lg }}>
            Aucune étape. Ajoute un mois pour commencer.
          </div>
        )}

        {(p.blocs || []).map((b, idx) => (
          <div key={b.id} style={{
            ...cardStyle,
            borderLeft: `4px solid ${b.type === "encadre" ? "#f5c400" : acc.accent}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Icon as={b.type === "encadre" ? AlertTriangle : Calendar} size={14} color={b.type === "encadre" ? "#d4a017" : acc.accent} />
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted }}>
                {b.type === "encadre" ? "Encadré conditionnel" : "Mois"}
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {iconBtn("Monter", () => moveBloc(b.id, -1), { disabled: idx === 0, children: "↑" })}
                {iconBtn("Descendre", () => moveBloc(b.id, +1), { disabled: idx === (p.blocs.length - 1), children: "↓" })}
                {iconBtn("Supprimer", () => removeBloc(b.id), { danger: true, children: <Icon as={Trash2} size={13} /> })}
              </div>
            </div>

            {b.type === "encadre" ? (
              <>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Titre de l'encadré</label>
                  <input style={inputStyle} value={b.titre} placeholder="ex : Étape conditionnelle"
                    onChange={e => updateBloc(b.id, { titre: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Texte</label>
                  <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical", lineHeight: 1.5 }}
                    value={b.texte} placeholder="ex : la réalisation des sols est subordonnée à l'intervention d'Enedis…"
                    onChange={e => updateBloc(b.id, { texte: e.target.value })} />
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Titre du mois</label>
                  <input style={inputStyle} value={b.titre} placeholder="ex : Fin juillet 2026"
                    onChange={e => updateBloc(b.id, { titre: e.target.value })} />
                </div>
                <label style={labelStyle}>Étapes prévues</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {(b.lignes || []).map((ligne, li) => (
                    <div key={li} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f5c400", flexShrink: 0 }} />
                      <input style={{ ...inputStyle, flex: 1 }} value={ligne} placeholder="ex : Pose de la baie vitrée — appartement 2"
                        onChange={e => updateLigne(b.id, li, e.target.value)} />
                      {iconBtn("Retirer la ligne", () => removeLigne(b.id, li), { danger: true, children: <Icon as={X} size={13} /> })}
                    </div>
                  ))}
                  <button onClick={() => addLigne(b.id)} style={{
                    alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "5px 10px", borderRadius: RADIUS.sm, marginTop: 2,
                    border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
                    fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
                  }}>
                    <Icon as={Plus} size={12} /> Ajouter une étape
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {/* Boutons d'ajout de blocs */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={addMois} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: RADIUS.md,
            border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
          }}>
            <Icon as={Plus} size={14} /> Ajouter un mois
          </button>
          <button onClick={addEncadre} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 16px", borderRadius: RADIUS.md,
            border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
          }}>
            <Icon as={AlertTriangle} size={14} /> Ajouter un encadré conditionnel
          </button>
        </div>

        {/* Mention de bas de page */}
        <div style={cardStyle}>
          <label style={labelStyle}>Mention de bas de page</label>
          <textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical", lineHeight: 1.5 }}
            value={p.note_bas} onChange={e => setField("note_bas", e.target.value)} />
        </div>

      </div>
    </div>
  );
}

function PagePhasageV2({ chantiers = [], ouvriers = [], tauxHoraires = {}, tauxMOPrev = 0, T, branch = "renovation", profil = null }) {
  const acc = getBranchAccent(branch);

  // ── État ────────────────────────────────────────────────────────────────
  const [lots, setLots] = useState(LOTS_DEFAUT);
  const [chantierId, setChantierId] = useState(() => {
    try { return localStorage.getItem("phasage_v2_chantier") || ""; } catch { return ""; }
  });
  const [phasage, setPhasage] = useState(null);
  const [loadingPhasage, setLoadingPhasage] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [selectedOuvrageId, setSelectedOuvrageId] = useState(null);
  // Glisser-déposer : ouvrage en cours de déplacement + lot survolé (cible)
  const [draggedOuvrageId, setDraggedOuvrageId] = useState(null);
  const [dragOverLotId, setDragOverLotId] = useState(null);
  // Les lots vides (sans ouvrage) sont masqués par défaut ; ce flag les révèle
  // pour pouvoir y ajouter un premier ouvrage manuellement.
  const [showEmptyLots, setShowEmptyLots] = useState(false);
  // Registre de pointage du chantier (P8). Les heures réelles et le coût MO des
  // tâches sont dérivés de ce registre (taux figé par ouvrier), avec repli sur
  // l'ancien champ heures_reelles pour les chantiers sans pointage.
  const [pointages, setPointages] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved"); // saved | pending | saving | error
  const saveTimerRef = useRef(null);
  const newOuvrageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  // Modales d'édition : id de l'ouvrage / de la tâche en cours d'édition
  const [editingOuvrageId, setEditingOuvrageId] = useState(null);
  const [editingTache, setEditingTache] = useState(null); // { ouvrageId, tacheId }
  // Comptes rendus (rapports) du chantier — pour le bouton "voir le dernier CR"
  const [rapports, setRapports] = useState([]);
  const [rapportModal, setRapportModal] = useState(null); // { rapport, tacheNom }
  const [rapportsModal, setRapportsModal] = useState(null); // { tacheNom, rapports } — tous les CR d'une tâche
  // Repli du bandeau KPI (on ne garde que la barre d'avancement). Préférence
  // d'affichage locale, mémorisée entre les sessions.
  const [kpiCollapsed, setKpiCollapsed] = useState(() => {
    try {
      const memo = localStorage.getItem("p2_kpi_collapsed");
      if (memo != null) return memo === "1";
    } catch { /* ignore */ }
    // Sans préférence mémorisée : replié par défaut sur MOBILE — la douzaine
    // de cartes empilées occupait tout l'écran et repoussait la vue (qui
    // porte le scroll) hors de portée.
    return typeof window !== "undefined" && window.innerWidth < 768;
  });
  const toggleKpiCollapsed = () => setKpiCollapsed(v => {
    const n = !v;
    try { localStorage.setItem("p2_kpi_collapsed", n ? "1" : "0"); } catch { /* ignore */ }
    return n;
  });
  // Lignes de commande du chantier + panneau "Matériaux & commandes"
  const [commandeLignes, setCommandeLignes] = useState([]);
  const [matPanel, setMatPanel] = useState(null); // { type: 'lot'|'ouvrage', id }
  const [matKpiModal, setMatKpiModal] = useState(false); // modale "toutes les commandes du chantier"
  const [kpiDetail, setKpiDetail] = useState(null); // détail d'un KPI : "vendu" | "heures" | "mo" | "fg" | "marge"
  const [moisModal, setMoisModal] = useState(false); // modale « heures par mois / par ouvrier »
  const [moisOuvert, setMoisOuvert] = useState({});  // { "2026-07": true } — mois dépliés dans la modale
  // Champs « reprise » : état LOCAL (saisie fluide) sauvegardé à la sortie du champ.
  // Piloter les <input> directement par meta + saveMeta à chaque frappe créait une
  // course (relecture DB → réécriture) qui effaçait la valeur de l'autre champ.
  const [repriseHInput, setRepriseHInput] = useState("");
  const [repriseTInput, setRepriseTInput] = useState("");
  // Form d'ajout de référence dans le panneau
  const [refForm, setRefForm] = useState({ materiau_id: "", libelle: "", quantite: "", prix: "", unite: "U" });
  const [refSaving, setRefSaving] = useState(false);
  // Modale suivi direction (marge cible, seuil prime, prime chantier)
  const [showSuiviDirection, setShowSuiviDirection] = useState(false);
  // Mode d'affichage : "list" (3 colonnes Lots/Ouvrages/Tâches) | "gantt" (timeline)
  //                     | "previsionnel" (calendrier client + export PDF)
  const [viewMode, setViewMode] = useState("list");
  // Prévisionnel client : édité localement puis persisté (debounce) dans
  // plan_travaux.meta.previsionnel. Chargé une fois par chantier.
  const [prev, setPrev] = useState(null);
  const prevLoadedRef = useRef(null);
  const prevSaveTimerRef = useRef(null);
  // Form planification (envoyer une tâche dans planning_cells)
  const initialSemaine = (() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); })();
  const [planifSemaine, setPlanifSemaine] = useState(initialSemaine);
  const [planifJour, setPlanifJour] = useState("Lundi");
  const [planifDuree, setPlanifDuree] = useState("");
  const [planifMsg, setPlanifMsg] = useState(null); // { ok: bool, txt: string }
  const [planifSaving, setPlanifSaving] = useState(false);
  // Reset le form de planification quand on ouvre une nouvelle tâche.
  useEffect(() => {
    if (!editingTache) return;
    const o = ouvrages.find(x => x.id === editingTache.ouvrageId);
    const t = o?.taches?.find(x => x.id === editingTache.tacheId);
    setPlanifSemaine(initialSemaine);
    setPlanifJour("Lundi");
    // Durée pré-remplie = heures VENDUES de la tâche, arrondies à 0,25 (ce que
    // verront les ouvriers). Repli sur les heures estimées si pas d'heures
    // vendues calculées.
    const hBase = t?.heures_vendues != null ? t.heures_vendues : t?.heures_estimees;
    const hArrondi = arrondiQuart(hBase);
    setPlanifDuree(hArrondi != null ? String(hArrondi) : "");
    setPlanifMsg(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTache?.tacheId]);

  // Aligne l'affectation sur le réalisé : à l'ouverture d'une tâche qui a des
  // pointages, on ajoute les ouvriers du registre (ceux qui ont réellement
  // pointé) à la liste des ouvriers assignés, sans retirer les affectations
  // manuelles existantes. N'écrit que s'il manque effectivement un ouvrier.
  useEffect(() => {
    if (!editingTache) return;
    const o = ouvrages.find(x => x.id === editingTache.ouvrageId);
    const t = o?.taches?.find(x => x.id === editingTache.tacheId);
    if (!t) return;
    const regOuvriers = [...new Set(tachePointages(t).map(p => p.ouvrier).filter(Boolean))];
    if (regOuvriers.length === 0) return;
    const actuels = Array.isArray(t.ouvriers) ? t.ouvriers : [];
    const manquants = regOuvriers.filter(n => !actuels.includes(n));
    if (manquants.length > 0) updateTache(o.id, t.id, { ouvriers: [...actuels, ...manquants] });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTache?.tacheId, pointages]);

  // Construit la liste des 12 prochaines semaines pour le select.
  const semainesFutures = (() => {
    const list = [];
    const now = getCurrentWeek();
    for (let i = 0; i < 12; i++) {
      let w = now.week + i, y = now.year;
      while (w > 52) { w -= 52; y += 1; }
      list.push(getWeekId(y, w));
    }
    return list;
  })();

  // Envoie une tâche dans planning_cells (week + chantier + jour). Si la
  // cellule existe déjà, on ajoute la tâche à son tableau au lieu de
  // remplacer. Met aussi à jour date_prevue sur la tâche source.
  const envoyerDansPlanning = async (ouvrageId, tache) => {
    if (!chantierId || !planifSemaine || !planifJour) {
      setPlanifMsg({ ok: false, txt: "Choisis une semaine et un jour." });
      return;
    }
    setPlanifSaving(true);
    setPlanifMsg(null);
    try {
      const { data: ex } = await supabase.from("planning_cells")
        .select("*")
        .eq("week_id", planifSemaine).eq("chantier_id", chantierId).eq("jour", planifJour)
        .maybeSingle();
      const base = ex || { planifie: "", reel: "", ouvriers: [], taches: [] };
      const ouvriersTache = Array.isArray(tache.ouvriers) ? tache.ouvriers : [];
      // La durée affichée sur le planning est toujours arrondie à 0,25.
      const duree = arrondiQuart(planifDuree) || 0;
      // tache_id : lie la ligne du planning à la tâche du phasage — déplacer
      // la ligne dans le planning semaine met alors à jour date_prevue.
      // Tâche externe (prestataire) : le marqueur suit dans le planning comme
      // repère — texte suffixé « (externe) » et flag sur la tâche de cellule.
      // Aucun ouvrier interne n'est ajouté, donc rien ne change aux heures.
      const newTask = { id: rid(), tache_id: tache.id, text: tache.nom || "", duree, ouvriers: ouvriersTache, ...(tache.externe ? { externe: true } : {}) };
      const ligne = (tache.nom || "") + (tache.externe ? " (externe)" : "");
      const nouveauPlanifie = base.planifie ? `${base.planifie}\n${ligne}` : ligne;
      const upsertPayload = {
        week_id: planifSemaine,
        chantier_id: chantierId,
        jour: planifJour,
        planifie: nouveauPlanifie,
        taches: [...(base.taches || []), newTask],
        reel: base.reel || "",
        ouvriers: [...new Set([...(base.ouvriers || []), ...ouvriersTache])],
      };
      const { error } = await supabase.from("planning_cells").upsert(upsertPayload, { onConflict: "week_id,chantier_id,jour" });
      if (error) throw error;
      // Met à jour la date_prevue sur la tâche d'origine. date_prevue = date
      // de DÉBUT : une tâche peut être posée sur plusieurs jours, envoyer un
      // jour de continuation (plus tard) ne recule pas le début.
      const exactDate = getDateFromWeekAndDay(planifSemaine, planifJour);
      const dejaISO = tache.date_prevue ? String(tache.date_prevue).slice(0, 10) : "";
      if (exactDate && (!dejaISO || exactDate < dejaISO)) {
        updateTache(ouvrageId, tache.id, { date_prevue: exactDate });
      }
      setPlanifMsg({ ok: true, txt: `✓ Envoyé dans ${planifSemaine} · ${planifJour}` });
    } catch (e) {
      console.error("envoyerDansPlanning:", e);
      setPlanifMsg({ ok: false, txt: e.message || "Erreur lors de l'envoi." });
    }
    setPlanifSaving(false);
  };
  // Bibliothèque ouvrages (sert au matching à l'import devis)
  const [bibliotheque, setBibliotheque] = useState([]);
  // Bibliothèque matériaux (sert à valoriser les materiaux_liens d'un ouvrage)
  const [materiauxBiblio, setMateriauxBiblio] = useState([]);
  // État de la modale d'import (null si fermée)
  // { items: [...], unknownLotHeaders: [...], parsing: bool, error: string|null }
  const [importState, setImportState] = useState(null);

  // Charge les lots (config Admin)
  useEffect(() => { loadLots().then(setLots); }, []);
  // Charge les groupes types (référentiel Admin) : sert à initialiser les
  // groupes de la vue Chronologique. [] tant que le chargement n'est pas fini,
  // pour ne jamais initialiser un chantier avec une liste partielle.
  const [groupesTypes, setGroupesTypes] = useState([]);
  useEffect(() => { loadGroupesTypes().then(setGroupesTypes); }, []);
  // Charge les équipes (référentiel Admin) : sert à proposer l'équipe par
  // défaut sur les groupes de la vue Chronologique.
  const [equipes, setEquipes] = useState([]);
  useEffect(() => { loadEquipes().then(setEquipes); }, []);
  // Charge la bibliothèque d'ouvrages
  useEffect(() => {
    supabase.from("bibliotheque_ratios").select("*").order("libelle")
      .then(({ data }) => setBibliotheque(data || []));
  }, []);
  // Charge la bibliothèque matériaux (pour le prix unitaire lors du calcul du
  // coût matériaux à l'import devis).
  useEffect(() => {
    supabase.from("materiaux_bibliotheque")
      .select("id,nom,unite,prix_unitaire")
      .then(({ data }) => setMateriauxBiblio(data || []));
  }, []);

  // Mémorise le dernier chantier ouvert
  useEffect(() => {
    if (chantierId) {
      try { localStorage.setItem("phasage_v2_chantier", chantierId); } catch {}
    }
  }, [chantierId]);

  // Charge le phasage du chantier sélectionné. Au passage on normalise les
  // ids : les tâches importées en v1 (ou via devis biblio) n'ont pas
  // toujours de champ `id`. Sans id, tous les updateTache(undefined)
  // matchaient toutes les tâches de l'ouvrage en même temps. On assigne
  // un id manquant ici, et on persiste silencieusement si on a dû en
  // créer (sinon chaque reload réassignerait des ids différents).
  useEffect(() => {
    if (!chantierId) { setPhasage(null); return; }
    let cancelled = false;
    setLoadingPhasage(true);
    supabase.from("phasages").select("*").eq("chantier_id", chantierId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== "PGRST116") console.warn("PhasageV2 load:", error.message);
        let mutated = false;
        if (data && Array.isArray(data.ouvrages)) {
          data.ouvrages = data.ouvrages.map(o => {
            const oid = o.id || (() => { mutated = true; return rid(); })();
            let taches = (o.taches || []).map(t => {
              if (t.id) return t;
              mutated = true;
              return { ...t, id: rid() };
            });
            // Backfill heures_vendues : pour un ouvrage importé avant cette
            // fonctionnalité, si l'ouvrage a des heures vendues mais qu'aucune
            // tâche n'en porte encore, on les répartit (ratio → estimées →
            // parts égales). Valeurs exactes ; l'arrondi reste côté planning.
            const heuresDevis = parseFloat(o.heures_devis);
            const aucuneVendue = taches.length > 0 && taches.every(t => t.heures_vendues == null);
            if (!isNaN(heuresDevis) && aucuneVendue) {
              const parts = repartirHeures(heuresDevis, taches);
              taches = taches.map((t, i) => ({ ...t, heures_vendues: parts[i] }));
              mutated = true;
            }
            return { ...o, id: oid, taches };
          });
        }
        setPhasage(data || null);
        setLoadingPhasage(false);
        // Si on a assigné de nouveaux ids, on les persiste pour que le
        // prochain chargement parte sur des ids stables.
        if (mutated && data?.id) {
          supabase.from("phasages").update({
            ouvrages: data.ouvrages,
            updated_at: new Date().toISOString(),
          }).eq("id", data.id).then(({ error: err }) => {
            if (err) console.warn("Persist normalized ids:", err.message);
          });
        }
      });
    return () => { cancelled = true; };
  }, [chantierId]);

  // Reset des sélections quand on change de chantier
  useEffect(() => { setSelectedLotId(null); setSelectedOuvrageId(null); }, [chantierId]);

  // Charge le registre de pointage du chantier (heures réelles + coût MO).
  useEffect(() => {
    if (!chantierId) { setPointages([]); return; }
    let cancelled = false;
    fetchPointages({ chantier_id: chantierId }).then(pts => { if (!cancelled) setPointages(pts); });
    return () => { cancelled = true; };
  }, [chantierId]);
  // Index { tache_id: [pointages] } — pointages "tâche" productifs uniquement.
  const pointagesParTache = indexPointagesParTache(pointages);

  // Charge les comptes rendus (rapports) du chantier, du plus récent au plus ancien.
  useEffect(() => {
    if (!chantierId) { setRapports([]); return; }
    let cancelled = false;
    supabase.from("rapports").select("*").eq("chantier_id", chantierId)
      .order("submitted_at", { ascending: false })
      .then(({ data }) => { if (!cancelled) setRapports(data || []); });
    return () => { cancelled = true; };
  }, [chantierId]);

  // Charge les lignes de commande du chantier (avec le statut de la commande parente).
  const loadCommandeLignes = React.useCallback(async () => {
    if (!chantierId) { setCommandeLignes([]); return; }
    const { data } = await supabase.from("commande_lignes")
      .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, commande:commandes(statut_completude, statut_facturation, fournisseur_nom, doc_numero)")
      .eq("chantier_id", chantierId);
    setCommandeLignes(data || []);
  }, [chantierId]);
  useEffect(() => { loadCommandeLignes(); }, [loadCommandeLignes]);

  const ouvrages = phasage?.ouvrages || [];
  const chantier = chantiers.find(c => c.id === chantierId);

  // ─── CALCULS : une seule passe du module (source de vérité) ──────────────
  const fin = useMemo(() => computeChantierFinance({
    phasage, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots,
  }), [phasage, pointages, commandeLignes, tauxHoraires, tauxMOPrev, lots]);

  // Dernier compte rendu contenant une tâche liée à `t` : on matche par tache_id
  // (tâches créées/planifiées en V2) OU par nom (tâches migrées depuis la V1,
  // dont l'id a été régénéré). `rapports` est déjà trié du plus récent au plus ancien.
  const rapportPourTache = (t) => {
    if (!t) return null;
    const nom = (t.nom || "").trim().toLowerCase();
    return rapports.find(r => (r.taches || []).some(x =>
      (x.tache_id && String(x.tache_id) === String(t.id)) ||
      (nom && (x.planifie || x.nom || "").trim().toLowerCase() === nom)
    )) || null;
  };
  // TOUS les comptes rendus liés à la tâche `t` (même logique de matching que
  // rapportPourTache, mais renvoie l'ensemble, du plus récent au plus ancien).
  const rapportsPourTache = (t) => {
    if (!t) return [];
    const nom = (t.nom || "").trim().toLowerCase();
    return rapports.filter(r => (r.taches || []).some(x =>
      (x.tache_id && String(x.tache_id) === String(t.id)) ||
      (nom && (x.planifie || x.nom || "").trim().toLowerCase() === nom)
    ));
  };

  // Date d'un compte rendu (minuit locale) : date_rapport au format FR
  // « DD/MM/YYYY » (anciens CR) ou ISO (récents), repli sur submitted_at.
  const dateDuRapport = (r) => {
    const s = r.date_rapport;
    if (s) {
      const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
      const d = new Date(s);
      if (!isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); return d; }
    }
    if (r.submitted_at) {
      const d = new Date(r.submitted_at);
      if (!isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); return d; }
    }
    return null;
  };
  // Fenêtre d'exécution RÉELLE d'une tâche d'après ses comptes rendus :
  // { debut, fin } (premier / dernier CR daté) ou null si aucun. Sert aux
  // vues Gantt à placer les tâches réalisées mais jamais datées (pas de
  // date_prevue) au lieu de les laisser dans « Non planifiées ».
  const crWindowPourTache = (t) => {
    const ds = rapportsPourTache(t).map(dateDuRapport).filter(Boolean);
    if (!ds.length) return null;
    const ts = ds.map(d => d.getTime());
    return { debut: new Date(Math.min(...ts)), fin: new Date(Math.max(...ts)) };
  };

  // ─── Panneau "Matériaux & commandes" (ouvrage / lot) ──────────────────────
  const matBiblioById = (() => { const m = {}; materiauxBiblio.forEach(x => { m[String(x.id)] = x; }); return m; })();
  // Lignes de commande rattachées à un lot.
  const lignesDuLot = (lotId) => commandeLignes.filter(l => l.lot_id === lotId);
  // Lignes rattachées à un ouvrage : par ouvrage_id, ou (à défaut) par matériau présent dans ses liens.
  const lignesDeLOuvrage = (o) => commandeLignes.filter(l =>
    l.ouvrage_id === o.id ||
    (!l.ouvrage_id && l.materiau_id && (o.materiaux_liens || []).some(ml => String(ml.materiau_id) === String(l.materiau_id)))
  );
  // Matériaux "prévus de base" d'un ouvrage (depuis materiaux_liens, valorisés via biblio).
  const prevusOuvrage = (o) => (o.materiaux_liens || [])
    .filter(ml => ml && ml.materiau_id != null)
    .map(ml => {
      const m = matBiblioById[String(ml.materiau_id)];
      return { materiau_id: ml.materiau_id, nom: m?.nom || "(matériau inconnu)", unite: m?.unite || "U", prix: parseFloat(m?.prix_unitaire) || 0, quantite: ml.quantite };
    });
  const estCommande = (materiauId, lignes) => materiauId != null && lignes.some(l => String(l.materiau_id) === String(materiauId));
  const statutLigne = (l) => {
    const c = l.commande || {};
    if (c.statut_facturation === "facture") return { label: "Facturé", color: "#22c55e" };
    if (c.statut_completude === "complete") return { label: "Complété", color: "#5b8af5" };
    return { label: "À compléter", color: "#eab308" };
  };

  // Crée une commande (statut à compléter) + sa ligne, liée au lot (+ ouvrage optionnel).
  const ajouterReference = async (lotId, ouvrageId) => {
    const libelle = (refForm.libelle || matBiblioById[String(refForm.materiau_id)]?.nom || "").trim();
    if (!libelle) { return; }
    setRefSaving(true);
    try {
      const q = parseFloat(refForm.quantite) || null;
      const pu = parseFloat(refForm.prix) || null;
      const { data: cmd, error: cErr } = await supabase.from("commandes").insert({
        type_evenement: "commande", doc_type: "bon_commande", numero_en_attente: true,
        montant_ht: (pu != null && q != null) ? +(pu * q).toFixed(2) : pu,
        source: "manuel", statut_completude: "a_completer", statut_facturation: "en_attente_facture",
        notes: "Ajouté depuis Phasage V2",
      }).select("id").single();
      if (cErr || !cmd) throw new Error(cErr?.message || "création commande");
      const { error: lErr } = await supabase.from("commande_lignes").insert({
        commande_id: cmd.id,
        libelle,
        quantite: q,
        unite: refForm.unite || "U",
        prix_unitaire: pu,
        prix_total: (pu != null && q != null) ? +(pu * q).toFixed(2) : null,
        materiau_id: refForm.materiau_id || null,
        chantier_id: chantierId,
        phasage_id: phasage?.id || null,
        lot_id: lotId || null,
        ouvrage_id: ouvrageId || null,
      });
      if (lErr) throw new Error(lErr.message);
      setRefForm({ materiau_id: "", libelle: "", quantite: "", prix: "", unite: "U" });
      await loadCommandeLignes();
    } catch (e) {
      console.error("ajouterReference:", e);
      alert("Erreur lors de l'ajout : " + (e.message || e));
    }
    setRefSaving(false);
  };

  // Rattache (ou détache) une ligne de commande à un ouvrage.
  const affecterLigneOuvrage = async (ligneId, ouvrageId) => {
    await supabase.from("commande_lignes").update({ ouvrage_id: ouvrageId || null }).eq("id", ligneId);
    await loadCommandeLignes();
  };

  // ─── PERSISTANCE ────────────────────────────────────────────────────────
  // Crée la ligne phasages si elle n'existe pas encore pour ce chantier.
  const ensurePhasage = async () => {
    if (phasage?.id) return phasage;
    const { data, error } = await supabase.from("phasages").insert({
      chantier_id: chantierId,
      chantier_nom: chantier?.nom || chantierId,
      ouvrages: [],
    }).select().single();
    if (error) { console.error("ensurePhasage:", error.message); return null; }
    setPhasage(data);
    return data;
  };

  // Autosave debounced 800ms : on push tout le tableau ouvrages à chaque
  // modif. Simple et fiable pour la v2 ; le merge collab par id pourra être
  // ajouté plus tard si nécessaire.
  // Garde anti-écrasement : avant d'écrire on relit le distant ; si on
  // s'apprête à supprimer > 50 % des ouvrages alors que le distant en
  // a plus de 2, on demande confirmation. Évite qu'un state local périmé
  // (V2 n'a pas de sub realtime, donc il ne sait pas si V1 a modifié) ne
  // wipe le travail d'un collègue.
  const scheduleSave = (ouvragesNext) => {
    setAutoSaveStatus("pending");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const p = await ensurePhasage();
      if (!p?.id) { setAutoSaveStatus("error"); return; }
      const { data: remote } = await supabase.from("phasages")
        .select("ouvrages").eq("id", p.id).maybeSingle();
      const remoteO = Array.isArray(remote?.ouvrages) ? remote.ouvrages.length : 0;
      const nextO   = Array.isArray(ouvragesNext) ? ouvragesNext.length : 0;
      const ok = confirmPerteMassive({
        label: "Ouvrages",
        avant: remoteO,
        apres: nextO,
        seuilMin: 2,
        contexte: "Sauvegarde du phasage : on s'apprête à écraser le distant par un état plus réduit.",
      });
      if (!ok) {
        setAutoSaveStatus("error");
        // Resynchronise depuis le distant pour stopper le ping-pong
        const { data: full } = await supabase.from("phasages")
          .select("*").eq("id", p.id).maybeSingle();
        if (full) setPhasage(full);
        return;
      }
      const { error } = await supabase.from("phasages").update({
        ouvrages: ouvragesNext,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      setAutoSaveStatus(error ? "error" : "saved");
      if (error) console.warn("PhasageV2 save:", error.message);
    }, 800);
  };

  const updateOuvrages = (next) => {
    setPhasage(p => ({ ...(p || { chantier_id: chantierId }), ouvrages: next }));
    scheduleSave(next);
  };

  // ─── CRUD OUVRAGES ──────────────────────────────────────────────────────
  const createOuvrage = (lotId) => {
    const newO = {
      id: rid(),
      libelle: "",
      lot_id: lotId === "_orphans" ? null : lotId,
      heures_devis: null,
      quantite: null,
      unite: "U",
      prix_ht: null,
      cout_materiaux: null,
      taches: [],
    };
    const next = [...ouvrages, newO];
    updateOuvrages(next);
    setSelectedOuvrageId(newO.id);
    // Ouvre directement la modale d'édition pour le nouveau
    setEditingOuvrageId(newO.id);
  };

  const updateOuvrage = (id, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === id ? { ...o, ...patch } : o));
  };

  // Met à jour les heures vendues de l'ouvrage ET redistribue heures_vendues
  // sur ses tâches (selon leur ratio, à défaut leurs heures estimées, à défaut
  // à parts égales). Valeurs exactes ; l'arrondi à 0,25 est fait au planning.
  const setOuvrageHeuresDevis = (id, value) => {
    updateOuvrages(ouvrages.map(o => {
      if (o.id !== id) return o;
      const parts = repartirHeures(value, o.taches || []);
      const taches = (o.taches || []).map((t, i) => ({ ...t, heures_vendues: parts[i] }));
      return { ...o, heures_devis: value, taches };
    }));
  };

  // Déplace un ouvrage vers un lot (drag & drop). lotId === null => "Sans lot".
  const moveOuvrageToLot = (ouvrageId, lotId) => {
    const o = ouvrages.find(x => x.id === ouvrageId);
    if (!o || o.lot_id === lotId) return;
    updateOuvrage(ouvrageId, { lot_id: lotId });
  };

  const deleteOuvrage = (id) => {
    const o = ouvrages.find(x => x.id === id);
    if (!o) return;
    if (!window.confirm(`Supprimer l'ouvrage « ${o.libelle || "sans libellé"} » et toutes ses tâches ?`)) return;
    updateOuvrages(ouvrages.filter(x => x.id !== id));
    if (selectedOuvrageId === id) setSelectedOuvrageId(null);
  };

  // ─── CRUD TÂCHES ────────────────────────────────────────────────────────
  const createTache = (ouvrageId) => {
    const newT = { id: rid(), nom: "", ratio: null, heures_estimees: null, heures_vendues: null, heures_reelles: null, avancement: 0, ouvriers: [] };
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: [...(o.taches || []), newT] }
      : o));
    setEditingTache({ ouvrageId, tacheId: newT.id });
  };

  // Toggle un ouvrier dans le tableau ouvriers d'une tâche (multi-select).
  const toggleOuvrier = (ouvrageId, tacheId, nom) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).map(t => {
          if (t.id !== tacheId) return t;
          const list = Array.isArray(t.ouvriers) ? [...t.ouvriers] : [];
          const idx = list.indexOf(nom);
          if (idx >= 0) list.splice(idx, 1); else list.push(nom);
          return { ...t, ouvriers: list };
        }) }
      : o));
  };

  // Initiales pour les badges ouvriers (2 lettres max).
  const initiales = (nom) => {
    if (!nom) return "?";
    const parts = String(nom).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  // Liaisons vers le module (mêmes noms et signatures qu'avant : le reste du
  // composant est inchangé). Le registre indexé et les taux sont pré-liés.
  const tachePointages = (t) => cfTachePointages(t, pointagesParTache);
  const tacheHeuresReelles = (t) => cfTacheHeuresReelles(t, pointagesParTache);
  const tachePointagesParOuvrier = (t) => cfTachePointagesParOuvrier(t, pointagesParTache);
  const heuresReellesOuvrage = (o) => cfHeuresReellesOuvrage(o, pointagesParTache);
  const heuresReellesLot = (lotId) => fin.lots.find(l => l.id === lotId)?.heuresReelles || 0;
  const heuresVenduesLot = (lotId) => fin.lots.find(l => l.id === lotId)?.heuresVendues || 0;

  // Scalaires chantier — calculés une seule fois par computeChantierFinance.
  const {
    prixHTChantier, heuresVenduesChantier, heuresReellesTotalChantier,
    coutMOTotalChantier, coutMatChantier, commandesPrevChantier,
    moPrevChantier, tauxMOPrevEff, fgTauxHoraire, fgChantier,
    margeChantier, margePctChantier,
    margePrevChantier, margePrevPctChantier,
    repriseHeures, repriseTaux, repriseCout,
  } = fin.brut;
  const trajetStats   = { heures: fin.brut.trajetHeures,   cout: fin.brut.trajetCout };
  const indirectStats = { heures: fin.brut.indirectHeures, cout: fin.brut.indirectCout };
  // Recharge les champs locaux depuis meta uniquement quand on change de chantier
  // (pas à chaque saveMeta, sinon on écraserait la frappe en cours).
  useEffect(() => {
    const m = phasage?.plan_travaux?.meta || {};
    setRepriseHInput(m.reprise_heures ?? "");
    setRepriseTInput(m.reprise_taux ?? "");
  }, [phasage?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heures ventilées PAR MOIS / PAR OUVRIER (module) + mois en cours (horloge,
  // donc côté UI). Le détail par mois reste accessible via la modale.
  const heuresParMois = useMemo(() => cfHeuresParMois(pointages), [pointages]);
  const heuresTotalTousMois = useMemo(() => heuresParMois.reduce((s, m) => s + m.heures, 0), [heuresParMois]);
  const moisCourant = useMemo(() => {
    const d = new Date();
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return { k, label, heures: heuresParMois.find(m => m.mois === k)?.heures || 0 };
  }, [heuresParMois]);

  const fmtEur = (n) => eur(n);
  // Date de référence des infobulles <Donnee> (« à date du ... ») — horloge
  // côté UI, jamais dans le module.
  const todayRefISO = new Date().toISOString().slice(0, 10);

  // ─── SUIVI DIRECTION (scalaires stockés dans plan_travaux.meta) ─────────
  // Compatibilité v1 : on lit/écrit dans phasage.plan_travaux.meta avec les
  // mêmes clés. La v1 PlanTravaux continue de fonctionner si on bascule.
  const meta = phasage?.plan_travaux?.meta || {};
  const margeCible  = fin.meta.margeCible;
  const seuilPrime  = fin.meta.seuilPrime;
  const primeChant  = fin.meta.prime;
  // Sauvegarde des meta dans plan_travaux. Le reste de plan_travaux est
  // conservé (les tâches v1 par phase, etc.).
  // CRITIQUE : on relit plan_travaux depuis la DB AVANT d'écrire, pas depuis
  // le state React. Sans sub realtime en V2, le state local peut être
  // périmé si V1 a modifié plan_travaux entretemps — et écrire l'ancien
  // state wiperait tout le travail V1 (incident du 2026-06-03).
  const saveMeta = async (patch) => {
    if (!chantierId) return;
    const p = await ensurePhasage();
    if (!p?.id) return;
    const { data: fresh, error: fetchErr } = await supabase.from("phasages")
      .select("plan_travaux").eq("id", p.id).maybeSingle();
    if (fetchErr) { console.warn("saveMeta fetch:", fetchErr.message); return; }
    const currentPlan = fresh?.plan_travaux || {};
    const newMeta = { ...(currentPlan.meta || {}), ...patch };
    const newPlan = { ...currentPlan, meta: newMeta };
    setPhasage(prev => ({ ...prev, plan_travaux: newPlan }));
    const { error } = await supabase.from("phasages").update({
      plan_travaux: newPlan, updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (error) console.warn("saveMeta:", error.message);
  };

  // Reprise : on écrit TOUJOURS les deux champs ensemble (une seule écriture),
  // pour qu'aucun ne puisse effacer l'autre en cas de saisie rapide.
  const saveReprise = () => saveMeta({
    reprise_heures: repriseHInput === "" ? null : parseFloat(repriseHInput),
    reprise_taux:   repriseTInput === "" ? null : parseFloat(repriseTInput),
  });

  // ─── PRÉVISIONNEL : chargement (1×/chantier) + sauvegarde debounced ──────
  // On charge depuis meta.previsionnel une seule fois par chantier (une fois
  // le phasage résolu), pour ne pas écraser une édition en cours quand
  // saveMeta re-set le state phasage.
  useEffect(() => {
    if (!chantierId) { setPrev(null); prevLoadedRef.current = null; return; }
    if (loadingPhasage) return;
    if (prevLoadedRef.current === chantierId) return;
    setPrev(normalizePrevisionnel(phasage?.plan_travaux?.meta?.previsionnel));
    prevLoadedRef.current = chantierId;
  }, [chantierId, loadingPhasage, phasage]);

  const updatePrev = (updater) => {
    setPrev(cur => {
      const base = cur || defaultPrevisionnel();
      const next = typeof updater === "function" ? updater(base) : updater;
      setAutoSaveStatus("pending");
      if (prevSaveTimerRef.current) clearTimeout(prevSaveTimerRef.current);
      prevSaveTimerRef.current = setTimeout(async () => {
        setAutoSaveStatus("saving");
        try { await saveMeta({ previsionnel: next }); setAutoSaveStatus("saved"); }
        catch (e) { setAutoSaveStatus("error"); console.warn("save previsionnel:", e?.message || e); }
      }, 800);
      return next;
    });
  };

  // Génère les blocs du prévisionnel depuis les groupes chrono déjà planifiés
  // (bornes des date_prevue) — module partagé previsionnelDoc. Remplace les
  // blocs existants (après confirmation) ; sous-titre et mention de bas de
  // page sont conservés, la livraison est recalculée depuis le planning.
  const genererPrevisionnelAuto = () => {
    const toutesTaches = ouvrages.flatMap(o => o?.taches || []);
    const items = chronoGroupes
      .slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0))
      .map(g => {
        const taches = toutesTaches.filter(t => t.chrono_groupe_id === g.id);
        if (taches.length === 0) return null;
        const dates = taches.map(t => (t.date_prevue || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
        return { nom: g.nom || "", debut: dates[0] || "", fin: dates[dates.length - 1] || "", ordre: g.ordre ?? 0 };
      })
      .filter(Boolean);
    const auto = blocsAutoDepuisGroupes(items);
    if (auto.nbDates === 0) {
      alert("Aucun groupe de tâches daté sur ce chantier. Planifie les tâches (vue Chronologique ou Planning) puis regénère.");
      return;
    }
    const cur = normalizePrevisionnel(prev);
    if ((cur.blocs || []).length > 0 &&
      !window.confirm("Remplacer les étapes actuelles du prévisionnel par celles générées depuis le planning ?")) return;
    updatePrev(c => ({
      ...c,
      blocs: auto.blocs,
      livraison_mois: auto.livraison_mois,
      livraison_annee: auto.livraison_annee,
    }));
  };

  const updateTache = (ouvrageId, tacheId, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).map(t => t.id === tacheId ? { ...t, ...patch } : t) }
      : o));
  };

  const deleteTache = (ouvrageId, tacheId) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).filter(t => t.id !== tacheId) }
      : o));
  };

  // ─── VUE CHRONOLOGIQUE ────────────────────────────────────────────────────
  // Groupes de tâches personnalisés (libres), stockés dans meta.chrono_groupes
  // ([{ id, nom, couleur, ordre, groupe_type_id? }] — groupe_type_id présent
  // quand le groupe a été semé depuis un groupe type : il permet de retrouver
  // l'équipe par défaut). Chaque tâche porte chrono_groupe_id +
  // chrono_ordre (dans ouvrages[].taches). La date reste date_prevue (partagée
  // avec le Gantt). Ordre/affectation → applyChrono ; date → updateTache.
  const chronoGroupes = Array.isArray(phasage?.plan_travaux?.meta?.chrono_groupes)
    ? phasage.plan_travaux.meta.chrono_groupes : [];
  const setChronoGroupes = (next) => saveMeta({ chrono_groupes: next });
  // Jalons de la vue chronologique ([{ id, nom, date, groupe_id, ordre }]).
  // Ce sont des repères (livraison, réception…) intercalés entre les tâches
  // d'un groupe. Ordonnés avec les tâches via le même index `ordre`.
  const chronoJalons = Array.isArray(phasage?.plan_travaux?.meta?.chrono_jalons)
    ? phasage.plan_travaux.meta.chrono_jalons : [];
  const setChronoJalons = (next) => saveMeta({ chrono_jalons: next });
  // Écriture COMBINÉE groupes + jalons en UN SEUL saveMeta. Indispensable :
  // saveMeta relit la DB avant d'écrire (non debouncé) — deux appels dans le
  // même tick se perdent mutuellement un patch. Même principe que saveReprise.
  const setChronoGroupesEtJalons = (g, j) => saveMeta({ chrono_groupes: g, chrono_jalons: j });
  // Applique en un seul passage un lot d'affectations
  // { [tacheId]: { groupe_id, ordre } } sur les tâches concernées.
  const applyChrono = (assignments) => {
    updateOuvrages(ouvrages.map(o => ({
      ...o,
      taches: (o.taches || []).map(t =>
        assignments[t.id]
          ? { ...t, chrono_groupe_id: assignments[t.id].groupe_id, chrono_ordre: assignments[t.id].ordre }
          : t),
    })));
  };
  // Applique en un seul passage un patch libre par tâche
  // { [tacheId]: { …champs } } — utilisé pour dater/décaler un groupe entier.
  const patchTaches = (patchesById) => {
    updateOuvrages(ouvrages.map(o => ({
      ...o,
      taches: (o.taches || []).map(t => patchesById[t.id] ? { ...t, ...patchesById[t.id] } : t),
    })));
  };

  // ── Écriture GARDÉE des prédécesseurs (Point 4a) ─────────────────────────
  // patchMap : { [tacheId]: string[] | null } — tableau = explicite ([] =
  // parallèle libre), null = revenir au chaînage par défaut. Refuse l'écriture
  // si elle créerait un cycle (message avec la boucle), sinon UN SEUL
  // patchTaches. Le chaînage par défaut n'est JAMAIS écrit en base.
  const appliquerPredecesseurs = (patchMap) => {
    const cycle = cycleApresPatch(ouvrages, chronoGroupes, patchMap);
    if (cycle) {
      const nomDe = (id) => {
        for (const o of ouvrages) { const t = (o.taches || []).find(x => String(x.id) === String(id)); if (t) return t.nom || "(sans nom)"; }
        return "(tâche supprimée)";
      };
      alert(`Impossible : cela créerait une boucle de dépendances :\n${[...cycle, cycle[0]].map(nomDe).join(" → ")}\n\nRien n'a été modifié.`);
      return false;
    }
    patchTaches(Object.fromEntries(
      Object.entries(patchMap).map(([id, v]) => [id, { predecesseurs: Array.isArray(v) ? v : null }])
    ));
    return true;
  };

  // ─── Semis de la vue Chrono depuis les GROUPES TYPES (référentiel Admin) ─
  // Un phasage est « vierge côté chrono » quand il n'a AUCUN groupe et
  // qu'aucune tâche ne porte d'affectation. Dans ce cas le semis s'applique
  // sans confirmation (auto à l'ouverture de la vue si des tâches existent,
  // ou via le bouton). Un phasage qui a déjà des groupes n'est JAMAIS
  // retouché sans action explicite : le bouton demande alors quoi faire
  // (ajouter les groupes types manquants — défaut — ou tout remplacer).
  const chronoVierge = chronoGroupes.length === 0 &&
    !ouvrages.some(o => (o.taches || []).some(t => t.chrono_groupe_id));
  const normNom = (s) => (s || "").toString().trim().toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "");
  // Groupes types absents du chantier : ni liés (groupe_type_id) ni homonymes.
  const gtManquants = groupesTypes.filter(gt =>
    !chronoGroupes.some(g => g.groupe_type_id === gt.id || normNom(g.nom) === normNom(gt.nom)));
  const initChronoDepuisGroupesTypes = (mode) => {
    if (groupesTypes.length === 0) return;
    if (mode === "remplacer" || chronoVierge) {
      const init = buildChronoInitFromGroupesTypes(ouvrages, groupesTypes, rid);
      if (!init) return;
      // Reclasse TOUTES les tâches : celles dont le lot n'est rattaché à
      // aucun groupe type repassent « à classer » (l'ancien groupe disparaît).
      const assignments = { ...init.assignments };
      ouvrages.forEach(o => (o.taches || []).forEach(t => {
        if (!assignments[t.id]) assignments[t.id] = { groupe_id: null, ordre: 0 };
      }));
      // Les jalons étaient accrochés aux anciens groupes → supprimés aussi
      // (même règle que la suppression manuelle d'un groupe), et chaque
      // nouveau groupe reçoit son jalon de contrôle. UNE seule écriture
      // (l'ancien couple setChronoJalons + setChronoGroupes se perdait un
      // patch : race du read-before-write de saveMeta).
      setChronoGroupesEtJalons(init.groupes, completerJalonsControle(init.groupes, [], rid) || []);
      applyChrono(assignments);
      return;
    }
    // mode "ajouter" (défaut) : complète sans toucher à l'existant. Un groupe
    // homonyme pas encore lié adopte le lien groupe_type_id ; les groupes
    // types absents sont créés vides à leur rang d'exécution. Les groupes,
    // affectations et jalons existants ne bougent pas.
    const next = chronoGroupes.map(g => {
      if (g.groupe_type_id) return g;
      const gt = groupesTypes.find(x => normNom(x.nom) === normNom(g.nom));
      return gt ? { ...g, groupe_type_id: gt.id } : g;
    });
    const crees = groupesTypes
      .filter(gt => !next.some(g => g.groupe_type_id === gt.id))
      .map(gt => ({ id: rid(), nom: gt.nom, couleur: gt.couleur, ordre: gt.ordre ?? 0, groupe_type_id: gt.id }));
    const adoptes = next.some((g, i) => g !== chronoGroupes[i]);
    if (!crees.length && !adoptes) return;
    const tousGroupes = [...next, ...crees];
    // Jalons de contrôle des groupes créés (et rattrapage des manquants),
    // dans la MÊME écriture que les groupes (race saveMeta sinon).
    const nextJalons = completerJalonsControle(tousGroupes, chronoJalons, rid);
    if (nextJalons) setChronoGroupesEtJalons(tousGroupes, nextJalons);
    else setChronoGroupes(tousGroupes);
  };
  // ─── Équipe par défaut d'un groupe chrono ─────────────────────────────────
  // Résolution : groupe.groupe_type_id → groupe type → equipe_id → équipe.
  // Renvoie null ou { equipe, noms, prioritaires } : `noms` = les OUVRIERS
  // PRIORITAIRES du groupe type s'ils sont définis (ex : Peinture → Margaux,
  // pas Davy), sinon toute l'équipe disponible. Toujours proposé, jamais imposé.
  const propositionPourGroupe = (g) => {
    if (!g?.groupe_type_id) return null;
    const gt = groupesTypes.find(x => x.id === g.groupe_type_id);
    if (!gt?.equipe_id) return null;
    const equipe = equipes.find(e => e.id === gt.equipe_id);
    if (!equipe) return null;
    const dispo = membresEquipe(equipe); // filtre déjà les date_dispo futures
    const prios = (gt.ouvriers_prio || []).filter(p => dispo.includes(p));
    return { equipe, noms: prios.length ? prios : dispo, prioritaires: prios.length > 0 };
  };
  // Pré-remplit taches[].ouvriers des tâches du groupe avec les ouvriers
  // proposés. mode "ajouter" : complète sans retirer les ouvriers déjà
  // saisis ; mode "remplacer" : écrase (après confirmation côté UI). Passe
  // par patchTaches — le même mécanisme que le reste de la vue chrono — et le
  // flux vers le planning reste envoyerDansPlanning, qui lit taches[].ouvriers
  // à l'envoi : aucun second chemin.
  const affecterOuvriersAuGroupe = (groupeId, noms, mode) => {
    if (!noms?.length) return;
    const patch = {};
    ouvrages.forEach(o => (o.taches || []).forEach(t => {
      if (t.chrono_groupe_id !== groupeId) return;
      const actuels = Array.isArray(t.ouvriers) ? t.ouvriers : [];
      const next = mode === "remplacer" ? noms : [...actuels, ...noms.filter(n => !actuels.includes(n))];
      if (next.length !== actuels.length || next.some((n, i) => n !== actuels[i])) patch[t.id] = { ouvriers: next };
    }));
    if (Object.keys(patch).length) patchTaches(patch);
  };
  // Marque (ou démarque) les tâches d'un groupe comme réalisées par un
  // PRESTATAIRE EXTERNE (équipe externe: true). Le marqueur `externe` est un
  // simple repère : on n'ajoute AUCUN ouvrier interne, donc pas d'heures
  // internes ni d'effectif interne — les calculs existants ne voient rien.
  const marquerGroupeExterne = (groupeId, on) => {
    const patch = {};
    ouvrages.forEach(o => (o.taches || []).forEach(t => {
      if (t.chrono_groupe_id !== groupeId) return;
      if (!!t.externe !== !!on) patch[t.id] = { externe: !!on };
    }));
    if (Object.keys(patch).length) patchTaches(patch);
  };

  // Semis automatique à l'ouverture de la vue Chrono : uniquement sur un
  // phasage vierge qui a des tâches, une seule application par chantier.
  const chronoAutoGenRef = useRef(null);
  useEffect(() => {
    if (viewMode !== "chrono" || loadingPhasage || !chantierId) return;
    // Anti-course au changement de chantier : dans le commit où chantierId
    // vient de changer, `phasage` (donc `ouvrages`) est encore celui de
    // l'ancien chantier et loadingPhasage capturé vaut encore false. On
    // n'agit que si le phasage chargé appartient bien au chantier courant.
    if (phasage?.chantier_id !== chantierId) return;
    if (groupesTypes.length === 0) return; // référentiel pas encore chargé
    if (!chronoVierge) return;
    if (!ouvrages.some(o => (o.taches || []).length > 0)) return;
    if (chronoAutoGenRef.current === chantierId) return;
    chronoAutoGenRef.current = chantierId;
    initChronoDepuisGroupesTypes("init");
  }, [viewMode, loadingPhasage, chantierId, phasage, chronoVierge, ouvrages, groupesTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Contrôles & réserves du chantier (Point 2 b) : alimentent le badge d'état
  // des groupes de la vue chrono. Rechargés à la fermeture de l'écran de
  // contrôle (controleVersion). Tables absentes (SQL pas lancé) → listes
  // vides, badge simplement absent : jamais bloquant.
  const [controlesChantier, setControlesChantier] = useState([]);
  const [reservesChantier, setReservesChantier] = useState([]);
  const [controleVersion, setControleVersion] = useState(0);
  useEffect(() => {
    if (!chantierId) { setControlesChantier([]); setReservesChantier([]); return; }
    let actif = true;
    (async () => {
      const [rc, rr] = await Promise.all([
        supabase.from("controles_groupe")
          .select("id, groupe_id, date_controle, nb_taches, nb_conformes")
          .eq("chantier_id", chantierId),
        supabase.from("reserves")
          .select("id, groupe_id, controle_id, statut, created_at, levee_le")
          .eq("chantier_id", chantierId),
      ]);
      if (!actif) return;
      setControlesChantier(rc.error ? [] : (rc.data || []));
      setReservesChantier(rr.error ? [] : (rr.data || []));
    })();
    return () => { actif = false; };
  }, [chantierId, controleVersion]);

  // Rattrapage Point 2 b : garantit à chaque groupe déjà existant son jalon
  // de contrôle. Ajout SEUL (rien d'autre ne bouge), une seule écriture, une
  // seule fois par chantier chargé — la garde est posée AVANT l'écriture car
  // chaque saveMeta fait changer `phasage` et relancerait l'effet.
  const controleBackfillRef = useRef(null);
  useEffect(() => {
    if (loadingPhasage || !chantierId) return;
    if (phasage?.chantier_id !== chantierId) return; // anti-course au changement de chantier
    if (controleBackfillRef.current === chantierId) return;
    controleBackfillRef.current = chantierId;
    const next = completerJalonsControle(chronoGroupes, chronoJalons, rid);
    if (next) setChronoJalons(next);
  }, [loadingPhasage, chantierId, phasage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Déplace une tâche vers un autre ouvrage (réparation des tâches atterries
  // dans « Divers / hors devis »). La tâche garde son id : ses pointages
  // (heures réelles + coût) suivent automatiquement. On ne touche pas aux
  // heures vendues (elles vivent au niveau ouvrage). Retourne true si déplacé.
  const moveTacheToOuvrage = (fromOuvrageId, tacheId, toOuvrageId) => {
    if (!toOuvrageId || fromOuvrageId === toOuvrageId) return false;
    const from = ouvrages.find(o => o.id === fromOuvrageId);
    const tache = from?.taches?.find(t => t.id === tacheId);
    if (!tache) return false;
    updateOuvrages(ouvrages.map(o => {
      if (o.id === fromOuvrageId) return { ...o, taches: (o.taches || []).filter(t => t.id !== tacheId) };
      if (o.id === toOuvrageId)   return { ...o, taches: [...(o.taches || []), tache] };
      return o;
    }));
    return true;
  };

  // ─── IMPORT DEVIS ───────────────────────────────────────────────────────
  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState({ items: [], unknownLotHeaders: [], parsing: true, error: null });
    try {
      const { items, unknownLotHeaders } = await parseDevisExcel(file, lots, bibliotheque);
      setImportState({ items, unknownLotHeaders, parsing: false, error: null });
    } catch (err) {
      console.error("Parsing devis:", err);
      setImportState({ items: [], unknownLotHeaders: [], parsing: false, error: err.message || "Impossible de lire le fichier." });
    }
    // Reset input pour permettre re-import du même fichier après cancel
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateImportItem = (key, patch) => {
    setImportState(s => ({ ...s, items: s.items.map(it => it._key === key ? { ...it, ...patch } : it) }));
  };
  const toggleAllImport = (val) => {
    setImportState(s => ({ ...s, items: s.items.map(it => ({ ...it, selectionne: val })) }));
  };

  const confirmImport = () => {
    if (!importState) return;
    const selected = importState.items.filter(it => it.selectionne);
    if (selected.length === 0) { setImportState(null); return; }
    const newOuvrages = selected.map(it => {
      // Heures estimées = cadence biblio × quantité (si dispo), sinon null.
      const cadence = parseFloat(it.match?.cadence) || null;
      const heuresEstimees = cadence && it.quantite ? parseFloat((cadence * it.quantite).toFixed(2)) : null;
      // Tâches : copies des sous_taches de la biblio. Le ratio de chaque
      // sous-tâche répartit DEUX grandeurs de l'ouvrage :
      //   • les heures ESTIMÉES (cadence × quantité) → heures_estimees
      //   • les heures VENDUES (heures_devis) → heures_vendues
      // On stocke le `ratio` sur la tâche pour pouvoir redistribuer plus tard
      // (recalcul à la modif des heures vendues de l'ouvrage). Les heures
      // vendues restent EXACTES ici ; l'arrondi à 0,25 se fait seulement à
      // l'envoi dans le planning hebdo.
      const sousTaches = it.match?.sous_taches || [];
      const sumRatios = sousTaches.reduce((s, st) => s + (parseFloat(st.ratio) || 0), 0);
      const heuresDevis = parseFloat(it.heures);
      const taches = sousTaches.map(st => {
        const ratio = parseFloat(st.ratio) || 0;
        const part = (sumRatios > 0 && ratio > 0) ? ratio / sumRatios : null;
        const heuresTache = (heuresEstimees != null && part != null)
          ? parseFloat((heuresEstimees * part).toFixed(2))
          : null;
        const heuresVenduesTache = (!isNaN(heuresDevis) && part != null)
          ? parseFloat((heuresDevis * part).toFixed(2))
          : null;
        return {
          id: rid(),
          nom: st.nom || "",
          ratio,
          heures_estimees: heuresTache,
          heures_vendues: heuresVenduesTache,
          avancement: 0,
        };
      });
      // Matériaux liés : copies des materiaux_liens de la biblio. Le coût
      // matériaux est auto-calculé = quantité_ouvrage × Σ(qté_par_unité × prix_unitaire).
      // Si l'utilisateur a déjà saisi manuellement un cout_materiaux, on ne l'écrase pas.
      const liens = (it.match?.materiaux_liens || [])
        .filter(ml => ml && ml.materiau_id != null)
        .map(ml => ({
          materiau_id: ml.materiau_id,
          quantite: ml.quantite == null ? null : parseFloat(ml.quantite),
        }));
      const qOuvrage = parseFloat(it.quantite) || 0;
      const coutMatParUnite = liens.reduce((s, ml) => {
        const m = materiauxBiblio.find(x => x.id === ml.materiau_id);
        if (!m || ml.quantite == null) return s;
        return s + (parseFloat(m.prix_unitaire) || 0) * (parseFloat(ml.quantite) || 0);
      }, 0);
      const coutMateriaux = qOuvrage > 0 && coutMatParUnite > 0
        ? parseFloat((qOuvrage * coutMatParUnite).toFixed(2))
        : null;
      return {
        id: rid(),
        libelle: it.libelle,
        lot_id: it.lot_id || null,
        heures_devis: it.heures,
        quantite: it.quantite,
        unite: it.unite || "U",
        prix_ht: it.prix_ht,
        heures_estimees: heuresEstimees,
        bibliotheque_id: it.match?.id || null,
        materiaux_liens: liens,
        ...(coutMateriaux != null ? { cout_materiaux: coutMateriaux } : {}),
        taches,
      };
    });
    updateOuvrages([...ouvrages, ...newOuvrages]);
    setImportState(null);
  };

  // Comptes pour les badges
  const countByLot = lots.reduce((acc, l) => {
    acc[l.id] = ouvrages.filter(o => o.lot_id === l.id).length;
    return acc;
  }, {});
  const orphans = ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id)).length;

  // ─── AVANCEMENT : liaisons vers le module (mêmes noms qu'avant) ──────────
  // avancementOuvrage / avancementOuvrageDetail / avancementTacheDetail sont
  // importés tels quels ; les fonctions par lot / chantier sont pré-liées.
  const ouvragesDuLot = (lotId) => cfOuvragesDuLot(ouvrages, lots, lotId);
  const avancementLot = (lotId) => fin.lots.find(l => l.id === lotId)?.avancement || 0;
  const avancementLotDetail = (lotId) => cfAvancementLotDetail(ouvrages, lots, lotId);
  const avancementChantier = fin.brut.avancementChantier;
  const avancementChantierDetail = cfAvancementChantierDetail(ouvrages);

  const ouvragesLot = selectedLotId
    ? ouvrages.filter(o => (selectedLotId === "_orphans"
        ? (!o.lot_id || !lots.some(l => l.id === o.lot_id))
        : o.lot_id === selectedLotId))
    : [];
  const selectedOuvrage = ouvrages.find(o => o.id === selectedOuvrageId) || null;
  const taches = selectedOuvrage?.taches || [];

  // ── Styles ──────────────────────────────────────────────────────────────
  const colHeader = {
    padding: "10px 14px",
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    display: "flex", alignItems: "center", gap: 8,
    fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
    color: T.textMuted,
    flexShrink: 0,
  };
  const colBody = { flex: 1, overflowY: "auto", padding: "10px 10px" };
  const emptyColMsg = (label) => (
    <div style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size + 1, fontStyle: "italic" }}>
      {label}
    </div>
  );
  const addBtn = {
    marginLeft: "auto",
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 9px", borderRadius: RADIUS.sm + 2,
    border: "none", background: acc.accent, color: acc.onAccent,
    fontSize: 10, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
    cursor: "pointer", fontFamily: "inherit",
  };
  const iconBtnDanger = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26, borderRadius: RADIUS.sm,
    background: "transparent", border: `1px solid transparent`,
    color: "#e15a5a", cursor: "pointer",
    transition: "all .12s",
  };
  const inp = {
    padding: "6px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
    color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit",
    outline: "none", width: "100%",
  };
  const lbl = {
    display: "block", fontSize: 9, fontWeight: 700, letterSpacing: .6,
    textTransform: "uppercase", color: T.textMuted, marginBottom: 4,
  };

  // ─── EXPORT PDF DU PHASAGE ──────────────────────────────────────────────
  // Pipeline window.print() : le navigateur fait une vraie pagination texte
  // (pas de rastérisation comme html2pdf) → coupures de page propres et
  // qualité d'impression nette. Même approche que le Bilan semaine et le
  // Compte rendu client.
  const buildRapportHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = chantier?.nom || chantierId;

    // ── Bandeau en-tête (table-layout pour rendu prévisible)
    const kpiCell = (val, label, color) => `
      <td style="padding:10pt 12pt;vertical-align:middle;text-align:center;border-left:1pt solid rgba(255,255,255,.12);white-space:nowrap;">
        <div style="color:${color};font-size:13pt;font-weight:800;line-height:1;">${val}</div>
        <div style="color:rgba(255,255,255,.55);font-size:7pt;letter-spacing:.08em;text-transform:uppercase;margin-top:3pt;">${label}</div>
      </td>`;

    // ── Carte ouvrage
    const ouvrageHTML = (o, lotColor) => {
      const taches = o.taches || [];
      const av = avancementOuvrage(o);
      const avColor = av >= 100 ? "#22c55e" : lotColor;
      const ouvragesInfos = [];
      if (o.heures_devis) ouvragesInfos.push(`${o.heures_devis}h`);
      if (o.quantite)     ouvragesInfos.push(`${o.quantite} ${o.unite || ""}`);
      if (o.prix_ht)      ouvragesInfos.push(`${o.prix_ht.toLocaleString("fr-FR")} €`);
      const tachesHTML = taches.length === 0 ? "" : `
        <ul style="margin:4pt 0 0;padding:0 0 0 14pt;list-style:none;">
          ${taches.map(t => {
            const tav = parseInt(t.avancement) || 0;
            const tavColor = tav >= 100 ? "#22c55e" : "#666";
            const hr = tacheHeuresReelles(t);
            const he = parseFloat(t.heures_estimees);
            // Format heures explicite : "réel X h / est. Y h" (labels au lieu
            // de "(X/Y)" qui était ambigu quand plusieurs ouvriers).
            const heuresStr = (hr > 0 || (he != null && !isNaN(he)))
              ? ` <span style="color:#888;font-size:8.5pt;">· réel ${fmtH(hr) || 0}h / est. ${he != null && !isNaN(he) ? `${fmtH(he)}h` : "—"}</span>`
              : "";
            // Heures par ouvrier : on additionne les pointages par ouvrier
            // pour éviter l'ambiguïté "(7h) Davy, Hamed" (chacun ? cumulé ?).
            const pts = tachePointages(t);
            let ouvriersStr = "";
            if (pts.length > 0) {
              const parOuv = {};
              pts.forEach(p => {
                const k = p.ouvrier || "—";
                parOuv[k] = (parOuv[k] || 0) + (parseFloat(p.heures) || 0);
              });
              const detail = Object.entries(parOuv)
                .sort((a, b) => b[1] - a[1])
                .map(([ouv, h]) => `${esc(ouv)} ${fmtH(h)}h`)
                .join(" · ");
              ouvriersStr = ` <span style="color:#5b8af5;font-size:8.5pt;font-weight:600;">${detail}</span>`;
            } else if (Array.isArray(t.ouvriers) && t.ouvriers.length > 0) {
              // Pas encore de pointages : on affiche les ouvriers assignés sans heures
              ouvriersStr = ` <span style="color:#5b8af5;font-size:8.5pt;font-weight:600;">${t.ouvriers.map(esc).join(", ")}</span>`;
            }
            const dateStr = t.date_prevue ? ` <span style="color:#999;font-size:8pt;">📅 ${new Date(t.date_prevue).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</span>` : "";
            return `<li style="font-size:9pt;color:#222;padding:2pt 0;break-inside:avoid;page-break-inside:avoid;">
              <span style="color:${tavColor};font-weight:800;display:inline-block;width:32pt;">${tav}%</span>
              <span>${esc(t.nom || "(sans nom)")}</span>${heuresStr}${ouvriersStr}${dateStr}
            </li>`;
          }).join("")}
        </ul>`;
      return `
        <div class="ouvrage" style="border:1pt solid #e0e0e0;border-left:4pt solid ${lotColor};margin:0 0 8pt;padding:8pt 12pt;break-inside:avoid;page-break-inside:avoid;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8pt;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:800;font-size:10pt;color:#1a1f2e;">${esc(o.libelle || "(sans libellé)")}</div>
              ${ouvragesInfos.length > 0 ? `<div style="font-size:8.5pt;color:#666;margin-top:2pt;">${ouvragesInfos.join(" · ")}</div>` : ""}
            </div>
            <div style="text-align:right;white-space:nowrap;">
              <span style="font-size:11pt;font-weight:800;color:${avColor};">${av}%</span>
            </div>
          </div>
          ${tachesHTML}
        </div>`;
    };

    // ── Sections par lot
    const lotsAvecOuvrages = lots
      .map(l => ({ ...l, _ouvrages: ouvragesDuLot(l.id) }))
      .filter(l => l._ouvrages.length > 0);
    const orphansList = ouvragesDuLot("_orphans");

    const lotSection = (lotLabel, lotColor, codePrefix, lotOuvrages, av) => `
      <section style="margin:0 0 14pt;">
        <div class="lot-header" style="background:color-mix(in srgb, ${lotColor} 18%, transparent);border-left:5pt solid ${lotColor};padding:8pt 12pt;margin:0 0 6pt;display:flex;align-items:center;justify-content:space-between;break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;">
          <div style="display:flex;align-items:center;gap:10pt;">
            <span style="font-size:13pt;font-weight:800;color:#1a1f2e;letter-spacing:.3pt;text-transform:uppercase;">${esc(lotLabel)}</span>
            ${codePrefix ? `<span style="font-size:8pt;font-weight:700;letter-spacing:.5pt;color:#444;background:rgba(0,0,0,.06);padding:1pt 6pt;border-radius:3pt;">${esc(codePrefix)}</span>` : ""}
            <span style="font-size:8pt;color:#666;">${lotOuvrages.length} ouvrage${lotOuvrages.length>1?"s":""}</span>
          </div>
          <span style="font-size:12pt;font-weight:800;color:${av >= 100 ? "#22c55e" : lotColor};">${av}%</span>
        </div>
        ${lotOuvrages.map(o => ouvrageHTML(o, lotColor)).join("")}
      </section>`;

    const sectionsHTML = lotsAvecOuvrages.map(l =>
      lotSection(l.label, l.couleur, l.code_prefixe, l._ouvrages, avancementLot(l.id))
    ).join("");
    const orphansHTML = orphansList.length > 0
      ? lotSection("Sans lot", "#888888", "", orphansList, avancementLot("_orphans"))
      : "";

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Phasage ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1f2e;font-size:10pt;line-height:1.4;}
  .page{max-width:780pt;margin:0 auto;}
  .ouvrage, .lot-header, ul, li { break-inside: avoid; page-break-inside: avoid; }
  .lot-header { page-break-after: avoid; }
  @page{margin:14mm 12mm 16mm;size:A4;}
  @page {
    @bottom-left   { content: "Profero Rénovation"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body><div class="page">
  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;margin:0 0 14pt;">
    <tr>
      <td style="padding:12pt 16pt;vertical-align:middle;width:80pt;">
        <img src="${logoUrl}" alt="Profero" style="height:30pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:12pt 8pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:7pt;font-weight:700;letter-spacing:1.4pt;text-transform:uppercase;">Phasage chantier</div>
        <div style="color:#fff;font-size:15pt;font-weight:800;margin-top:2pt;line-height:1.1;">${esc(titre)}</div>
        <div style="color:rgba(255,255,255,.5);font-size:8pt;margin-top:3pt;">Édité le ${dateGen}</div>
      </td>
      ${kpiCell(`${avancementChantier}%`, "Avancement", avancementChantier >= 100 ? "#50c878" : "#f5c400")}
      ${kpiCell(`${heuresReellesTotalChantier.toFixed(0)}h / ${heuresVenduesChantier.toFixed(0)}h`, "Heures", "#5b9cf6")}
      ${kpiCell(`${Math.round(prixHTChantier).toLocaleString("fr-FR")} €`, "Vendu", "#f5c400")}
      ${kpiCell(`${Math.round(coutMOTotalChantier).toLocaleString("fr-FR")} €`, "Coût MO", "#60a5fa")}
      ${kpiCell(`${Math.round(coutMatChantier).toLocaleString("fr-FR")} €`, "Matériaux", "#f97316")}
      ${kpiCell(`${Math.round(fgChantier).toLocaleString("fr-FR")} €`, `FG ${fgTauxHoraire ? fgTauxHoraire+"€/h" : ""}`, "#a78bfa")}
      ${kpiCell(`${margeChantier >= 0 ? "+" : ""}${Math.round(margeChantier).toLocaleString("fr-FR")} €`,
        `Marge ${prixHTChantier > 0 ? margePctChantier.toFixed(0) + "%" : ""}`,
        margeChantier >= 0 ? "#50c878" : "#ff6b6b")}
    </tr>
  </table>
  ${sectionsHTML || `<div style="text-align:center;padding:40pt;color:#999;">Aucun ouvrage dans ce phasage.</div>`}
  ${orphansHTML}
</div></body></html>`;
  };

  const exportRapportPDF = () => {
    try {
      const html = buildRapportHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Phasage-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
  };

  // ─── EXPORT PDF DU PRÉVISIONNEL CLIENT ──────────────────────────────────
  // Gabarit PROFERO partagé (previsionnelDoc) — le même document sert au
  // Chemin de fer pour le prévisionnel global d'une opération.
  const buildPrevisionnelHTML = () => buildPrevisionnelDocHTML({
    titre: chantier?.nom || chantierId,
    cardLabel: "Chantier",
    logoUrl: `${window.location.origin}${LOGO_RENO_H}`,
    previsionnel: prev,
  });

  const exportPrevisionnelPDF = () => {
    try {
      const html = buildPrevisionnelHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Previsionnel-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      // Le gabarit charge Barlow depuis Google Fonts : on attend les polices
      // avant d'imprimer (sinon l'aperçu part avec le repli Arial).
      w.onload = () => {
        const go = () => setTimeout(() => { w.focus(); w.print(); }, 150);
        (w.document.fonts?.ready || Promise.resolve()).then(go, go);
      };
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
  };

  // ─── EXPORT PDF DU PLANNING CHRONOLOGIQUE ───────────────────────────────
  // Feuille de route interne : une section par groupe (dans l'ordre chrono),
  // chaque tâche datée avec heures/avancement, jalons intercalés, retards
  // signalés. Reflète la vue Chronologique. Non destiné au client (≠ Prévi).
  const buildChronoHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateLongue = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const dateCourte = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    const titre = chantier?.nom || chantierId;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parseD = (s) => { if (!s) return null; const d = new Date(s); if (isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d; };
    const fmtD = (d) => d ? d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "—";
    const grs = chronoGroupes.slice().sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    const groupeIds = new Set(grs.map(g => g.id));
    const tItems = [];
    ouvrages.forEach(o => { const lot = lots.find(l => l.id === o.lot_id) || null; (o.taches || []).forEach(t => tItems.push({ o, lot, t })); });

    const entriesFor = (gid) => {
      const es = [];
      tItems.forEach(({ o, lot, t }) => { if (t.chrono_groupe_id === gid) es.push({ kind: "tache", ordre: t.chrono_ordre ?? 1e9, o, lot, t }); });
      chronoJalons.forEach(j => { if ((j.groupe_id ?? null) === gid) es.push({ kind: "jalon", ordre: j.ordre ?? 1e9, j }); });
      // Même règle de tri que entriesOfGroup (vue chrono) : le jalon de
      // CONTRÔLE reste toujours en fin de groupe, quel que soit son ordre.
      es.sort((a, b) => {
        const ca = a.kind === "jalon" && estJalonControle(a.j) ? 1 : 0;
        const cb = b.kind === "jalon" && estJalonControle(b.j) ? 1 : 0;
        if (ca !== cb) return ca - cb;
        return (a.ordre - b.ordre) || (a.kind === b.kind ? 0 : a.kind === "tache" ? -1 : 1);
      });
      return es;
    };
    const rowTache = ({ o, lot, t }) => {
      const d = parseD(t.date_prevue);
      const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
      const late = d && d < today && av < 100;
      const hv = parseFloat(t.heures_vendues) || 0;
      const ctx = (lot?.label ? esc(lot.label) + " · " : "") + esc(o.libelle || "—");
      return `<tr>
        <td style="padding:5pt 8pt;white-space:nowrap;color:${late ? "#c0392b" : "#333"};font-weight:${late ? 700 : 400};border-bottom:0.5pt solid #eee;vertical-align:top;">${late ? "⚠ " : ""}${fmtD(d)}</td>
        <td style="padding:5pt 8pt;border-bottom:0.5pt solid #eee;"><strong>${esc(t.nom || "(sans nom)")}</strong><div style="color:#999;font-size:8pt;">${ctx}</div></td>
        <td style="padding:5pt 8pt;text-align:right;white-space:nowrap;color:#555;border-bottom:0.5pt solid #eee;vertical-align:top;">${hv > 0 ? `${Math.round(hv * 10) / 10} h` : ""}</td>
        <td style="padding:5pt 8pt;text-align:right;white-space:nowrap;font-weight:700;color:${av >= 100 ? "#1e8e3e" : "#555"};border-bottom:0.5pt solid #eee;vertical-align:top;">${av}%</td>
      </tr>`;
    };
    const rowJalon = ({ j }) => `<tr>
        <td style="padding:5pt 8pt;white-space:nowrap;color:#8a6d00;font-weight:700;border-bottom:0.5pt solid #eee;vertical-align:top;">${fmtD(parseD(j.date))}</td>
        <td colspan="3" style="padding:5pt 8pt;border-bottom:0.5pt solid #eee;background:#fdf6df;"><span style="color:#8a6d00;font-weight:800;">⚑ ${esc(j.nom || "Jalon")}</span></td>
      </tr>`;

    const groupHTML = grs.map(g => {
      const es = entriesFor(g.id);
      // Un groupe « vide » contient désormais toujours son jalon de contrôle :
      // on l'ignore dans le PDF comme avant s'il n'a rien d'autre.
      if (!es.some(e => e.kind === "tache" || !estJalonControle(e.j))) return "";
      const couleur = g.couleur || "#5b8af5";
      let dmin = null, dmax = null, hv = 0, wsum = 0, wtot = 0, nbT = 0;
      es.forEach(e => {
        if (e.kind === "tache") {
          nbT++;
          const d = parseD(e.t.date_prevue); if (d) { if (!dmin || d < dmin) dmin = d; if (!dmax || d > dmax) dmax = d; }
          const h = parseFloat(e.t.heures_vendues) || 0, av = parseInt(e.t.avancement) || 0; hv += h; if (h > 0) { wsum += h * av; wtot += h; }
        } else { const d = parseD(e.j.date); if (d) { if (!dmin || d < dmin) dmin = d; if (!dmax || d > dmax) dmax = d; } }
      });
      const avg = wtot > 0 ? Math.round(wsum / wtot) : 0;
      const range = dmin ? (dmax && +dmax !== +dmin ? `${fmtD(dmin)} → ${fmtD(dmax)}` : fmtD(dmin)) : "";
      return `<section style="margin:0 0 14pt;break-inside:avoid;page-break-inside:avoid;">
        <table style="width:100%;border-collapse:collapse;border-left:5pt solid ${couleur};background:color-mix(in srgb, ${couleur} 15%, #ffffff);border-radius:0 4pt 4pt 0;margin-bottom:3pt;">
          <tr><td style="padding:6pt 12pt;font-weight:800;font-size:11pt;color:#1a1f2e;">${esc(g.nom || "Groupe")}</td>
          <td style="padding:6pt 12pt;text-align:right;font-size:8.5pt;color:#555;white-space:nowrap;">${nbT} tâche${nbT > 1 ? "s" : ""}${range ? ` · ${range}` : ""}${hv > 0 ? ` · ${Math.round(hv * 10) / 10} h` : ""} · ${avg}%</td></tr>
        </table>
        <table style="width:100%;border-collapse:collapse;font-size:9pt;">${es.map(e => e.kind === "tache" ? rowTache(e) : rowJalon(e)).join("")}</table>
      </section>`;
    }).join("");

    const unassigned = tItems.filter(({ t }) => !t.chrono_groupe_id || !groupeIds.has(t.chrono_groupe_id));
    const unHTML = unassigned.length ? `<section style="margin:0 0 14pt;break-inside:avoid;">
        <div style="background:#f3f4f6;border-left:5pt solid #999;padding:6pt 12pt;border-radius:0 4pt 4pt 0;font-weight:800;font-size:11pt;color:#555;margin-bottom:3pt;">Non classées <span style="font-weight:400;font-size:8.5pt;">(${unassigned.length})</span></div>
        <table style="width:100%;border-collapse:collapse;font-size:9pt;">${unassigned.map(rowTache).join("")}</table>
      </section>` : "";

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Planning ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1f2e;font-size:10pt;line-height:1.4;}
  .page{max-width:720pt;margin:0 auto;}
  @page{margin:14mm 12mm 14mm;size:A4;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body><div class="page">
  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;border-radius:10pt;overflow:hidden;margin:0 0 16pt;">
    <tr>
      <td style="padding:14pt 16pt;vertical-align:middle;width:150pt;"><img src="${logoUrl}" alt="Profero" style="height:34pt;object-fit:contain;display:block;"/></td>
      <td style="padding:14pt 8pt;vertical-align:middle;text-align:center;"><div style="color:#cfcfcf;font-size:15pt;font-weight:800;">Planning chantier</div></td>
      <td style="padding:14pt 16pt;vertical-align:middle;text-align:right;white-space:nowrap;">
        <div style="color:#fff;font-size:11pt;font-weight:800;">${esc(titre)}</div>
        <div style="color:rgba(255,255,255,.55);font-size:8.5pt;margin-top:2pt;text-transform:capitalize;">${dateLongue}</div>
      </td>
    </tr>
  </table>
  ${groupHTML || `<div style="text-align:center;padding:30pt;color:#999;">Aucun groupe. Créez des groupes dans la vue Chronologique.</div>`}
  ${unHTML}
  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;border-radius:8pt;overflow:hidden;margin-top:16pt;">
    <tr>
      <td style="padding:8pt 14pt;color:rgba(255,255,255,.7);font-size:8pt;">PROFERO — Planning interne</td>
      <td style="padding:8pt 14pt;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;">${dateCourte}</td>
    </tr>
  </table>
</div></body></html>`;
  };

  const exportChronoPDF = () => {
    try {
      const html = buildChronoHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Planning-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
  };

  // ─── EXPORT PDF DE LA VUE GANTT ─────────────────────────────────────────
  // Landscape A4 avec table : 1 colonne label + 1fr × N jours. Pour chaque
  // tâche, on colore les cellules de date_prevue jusqu'à +durée jours
  // ouvrés. Le label de la tâche se met dans la 1re cellule colorée.
  const buildGanttHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = chantier?.nom || chantierId;

    // Helpers dates (mêmes règles que GanttV2)
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const addDays    = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
    const isWeekend  = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
    const parseDate  = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
    const isoDay     = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const todayISO   = isoDay(startOfDay(new Date()));

    // Construit les rows. Tâches jamais datées mais avec des comptes rendus
    // liés : placées sur leur fenêtre réelle premier → dernier CR (fromCR),
    // comme dans l'écran Gantt.
    const rows = [];
    const orphans = [];
    ouvrages.forEach(o => {
      const lot = lots.find(l => l.id === o.lot_id) || { id: "_x", label: "Sans lot", couleur: "#888" };
      (o.taches || []).forEach(t => {
        const d = parseDate(t.date_prevue);
        if (d) { rows.push({ lot, ouvrage: o, tache: t, date: d }); return; }
        const win = crWindowPourTache(t);
        if (win) rows.push({ lot, ouvrage: o, tache: t, date: win.debut, dateFin: win.fin, fromCR: true });
        else orphans.push({ lot, ouvrage: o, tache: t });
      });
    });

    if (rows.length === 0) {
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Gantt ${esc(titre)}</title></head><body style="font-family:Arial;padding:40pt;text-align:center;color:#666;">Aucune tâche planifiée pour ce chantier.</body></html>`;
    }

    // Plage de dates
    const dates = rows.flatMap(r => r.dateFin ? [r.date, r.dateFin] : [r.date]);
    let dateMin = new Date(Math.min(...dates.map(d => d.getTime())));
    let dateMax = new Date(Math.max(...dates.map(d => d.getTime())));
    dateMin = addDays(dateMin, -2);
    dateMax = addDays(dateMax, 10);
    const days = [];
    for (let d = startOfDay(dateMin); d <= dateMax; d = addDays(d, 1)) {
      if (!isWeekend(d)) days.push(new Date(d));
    }
    const dayIndex = (d) => {
      const target = isoDay(d);
      return days.findIndex(x => isoDay(x) === target);
    };
    const dureeJours = (t) => {
      const h = parseFloat(t.heures_estimees);
      if (!h || isNaN(h) || h <= 0) return 1;
      return Math.max(1, Math.ceil(h / 7));
    };

    // Mois pour l'en-tête (rowspans en colspan ici)
    const monthsHeader = [];
    let lastMonthKey = "";
    days.forEach((d) => {
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k !== lastMonthKey) {
        monthsHeader.push({ label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), span: 1 });
        lastMonthKey = k;
      } else {
        monthsHeader[monthsHeader.length - 1].span += 1;
      }
    });

    // Tri des rows
    rows.sort((a, b) => {
      if (a.lot.id !== b.lot.id) return a.lot.id.localeCompare(b.lot.id);
      if (a.ouvrage.id !== b.ouvrage.id) return (a.ouvrage.libelle || "").localeCompare(b.ouvrage.libelle || "");
      return a.date.getTime() - b.date.getTime();
    });
    // Non planifiées : ordre chrono métier (même règle que l'écran Gantt).
    sortByChrono(orphans, chronoGroupes);

    // Build les lignes regroupées par lot
    let html = "";
    let lastLotId = null;
    rows.forEach((r) => {
      if (r.lot.id !== lastLotId) {
        html += `<tr class="lot-row" style="background:color-mix(in srgb, ${r.lot.couleur} 18%, #fff);">
          <td colspan="${days.length + 1}" style="padding:5pt 8pt;font-size:8pt;font-weight:800;letter-spacing:.5pt;text-transform:uppercase;color:#1a1f2e;border-top:1pt solid #ccc;border-bottom:1pt solid #ccc;">
            <span style="display:inline-block;width:9pt;height:9pt;background:${r.lot.couleur};border-radius:2pt;vertical-align:middle;margin-right:6pt;"></span>
            ${esc(r.lot.label)}
          </td>
        </tr>`;
        lastLotId = r.lot.id;
      }
      // fromCR : la barre couvre la fenêtre réelle premier → dernier CR
      // (mêmes règles que l'écran Gantt) ; sinon date_prevue + durée estimée.
      let startIdx = dayIndex(r.date);
      if (startIdx < 0 && r.fromCR) startIdx = days.findIndex(x => x.getTime() >= r.date.getTime());
      let spanDays;
      if (r.fromCR) {
        let end = days.length - 1;
        while (end > startIdx && days[end].getTime() > r.dateFin.getTime()) end--;
        spanDays = Math.max(1, end - startIdx + 1);
      } else {
        spanDays = Math.min(days.length - Math.max(0, startIdx), dureeJours(r.tache));
      }
      const av = Math.max(0, Math.min(100, parseInt(r.tache.avancement) || 0));
      const barColor = av >= 100 ? "#22c55e" : r.lot.couleur;
      const cells = days.map((d, i) => {
        const inBar = startIdx >= 0 && i >= startIdx && i < startIdx + spanDays;
        const isFirst = inBar && i === startIdx;
        const today = isoDay(d) === todayISO;
        const bg = inBar
          ? `color-mix(in srgb, ${barColor} 70%, transparent)`
          : (today ? "#fff4b8" : "transparent");
        return `<td style="border-right:0.5pt solid #eee;padding:0;height:18pt;background:${bg};font-size:7pt;color:#000;overflow:hidden;white-space:nowrap;">
          ${isFirst ? `<div style="padding:0 4pt;font-weight:700;overflow:hidden;text-overflow:ellipsis;">${esc((r.tache.nom || "").slice(0, 40))}${av > 0 ? ` · ${av}%` : ""}</div>` : ""}
        </td>`;
      }).join("");
      html += `<tr style="break-inside:avoid;page-break-inside:avoid;">
        <td style="padding:4pt 8pt;border-right:1pt solid #ccc;border-bottom:0.5pt solid #eee;font-size:8pt;color:#1a1f2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140pt;">
          <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;">${esc(r.tache.nom || "(sans nom)")}</div>
          <div style="font-size:7pt;color:#888;overflow:hidden;text-overflow:ellipsis;">${esc(r.ouvrage.libelle || "")}${r.fromCR ? " · d'après CR" : ""}</div>
        </td>
        ${cells}
      </tr>`;
    });

    // En-têtes : mois + jours
    const monthHeaders = monthsHeader.map(m =>
      `<th colspan="${m.span}" style="border-right:1pt solid #ccc;border-bottom:0.5pt solid #ccc;padding:3pt 5pt;font-size:7.5pt;font-weight:700;text-transform:capitalize;color:#444;background:#fafafa;">${esc(m.label)}</th>`
    ).join("");
    const dayHeaders = days.map(d => {
      const today = isoDay(d) === todayISO;
      return `<th style="border-right:0.5pt solid #eee;padding:2pt 0;font-size:6.5pt;font-weight:${today ? 800 : 600};color:${today ? "#9a7a00" : "#666"};background:${today ? "#fff4b8" : "#fafafa"};text-align:center;">${d.getDate()}</th>`;
    }).join("");

    const orphansHTML = orphans.length === 0 ? "" : `
      <div style="margin-top:14pt;padding:8pt 12pt;background:#fff8dc;border:1pt dashed #d4a017;border-radius:4pt;break-inside:avoid;">
        <div style="font-size:8pt;font-weight:700;color:#9a7a00;letter-spacing:.4pt;text-transform:uppercase;margin-bottom:6pt;">Tâches non planifiées (${orphans.length})</div>
        <ul style="margin:0;padding:0 0 0 14pt;font-size:8pt;color:#333;">
          ${orphans.map(r => `<li style="margin-bottom:2pt;">${esc(r.tache.nom || "(sans nom)")} <span style="color:#888;">— ${esc(r.ouvrage.libelle || "")}</span></li>`).join("")}
        </ul>
      </div>`;

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Gantt ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1f2e;font-size:9pt;}
  table{border-collapse:collapse;table-layout:fixed;width:100%;}
  th,td{vertical-align:middle;}
  thead{display:table-header-group;}
  tbody{display:table-row-group;}
  @page{size:A4 landscape;margin:8mm;}
  @page {
    @bottom-left   { content: "Profero Rénovation — Gantt"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
  <table style="margin-bottom:10pt;width:100%;border-collapse:collapse;background:#0a0a0a;">
    <tr>
      <td style="padding:8pt 12pt;vertical-align:middle;width:60pt;">
        <img src="${logoUrl}" alt="Profero" style="height:24pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:8pt 6pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:6.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;">Gantt chantier</div>
        <div style="color:#fff;font-size:12pt;font-weight:800;line-height:1.1;margin-top:1pt;">${esc(titre)}</div>
      </td>
      <td style="padding:8pt 10pt;vertical-align:middle;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;white-space:nowrap;">
        ${rows.length} tâche${rows.length>1?"s":""} planifiée${rows.length>1?"s":""} · Édité le ${dateGen}
      </td>
    </tr>
  </table>
  <table>
    <colgroup>
      <col style="width:140pt;"/>
      ${days.map(() => `<col/>`).join("")}
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" style="border-right:1pt solid #ccc;border-bottom:1pt solid #ccc;background:#fafafa;padding:4pt 8pt;font-size:7.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;color:#444;text-align:left;">Tâche / Ouvrage</th>
        ${monthHeaders}
      </tr>
      <tr>${dayHeaders}</tr>
    </thead>
    <tbody>
      ${html}
    </tbody>
  </table>
  ${orphansHTML}
</body></html>`;
  };

  const exportGanttPDF = () => {
    try {
      const html = buildGanttHTML();
      const w = window.open("", "_blank", "width=1100,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Gantt-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF Gantt : " + (e.message || e));
    }
  };

  // ── Export PDF Rang (Point 4a) — l'ordre logique par rangs ──────────────────
  // Même patron que les autres exports : HTML → fenêtre → print. Portrait A4.
  const buildRangHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = chantier?.nom || chantierId;

    const { parRang, sources, incoherences } = calculerRangs(ouvrages, chronoGroupes);
    const effectifs = predecesseursEffectifs(ouvrages, chronoGroupes);
    const index = new Map();
    ouvrages.forEach(o => (o.taches || []).forEach(t => { if (t?.id != null) index.set(String(t.id), t); }));
    const gById = new Map((chronoGroupes || []).map(g => [g.id, g]));
    const nomDe = (id) => index.get(String(id))?.nom || "(tâche supprimée)";

    if (parRang.length === 0) {
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Rang ${esc(titre)}</title></head><body style="font-family:Arial;padding:40pt;text-align:center;color:#666;">Aucune tâche à ranger — organise d'abord la vue Chronologique.</body></html>`;
    }

    const bandes = parRang.map((ids, i) => {
      const visibles = ids.filter(id => sources.get(id) !== "hors_chaine");
      if (visibles.length === 0) return "";
      const lignes = visibles.map(id => {
        const t = index.get(id);
        const g = gById.get(t?.chrono_groupe_id);
        const preds = effectifs.get(id)?.ids || [];
        const src = sources.get(id);
        const h = parseFloat(t?.heures_vendues) || parseFloat(t?.heures_estimees) || 0;
        return `<tr style="break-inside:avoid;">
          <td style="padding:3pt 8pt;border-bottom:0.5pt solid #eee;font-size:8pt;white-space:nowrap;">
            <span style="display:inline-block;width:8pt;height:8pt;background:${g?.couleur || "#888"};border-radius:2pt;vertical-align:middle;margin-right:5pt;"></span>
            <strong>${esc(t?.nom || "(sans nom)")}</strong>
          </td>
          <td style="padding:3pt 8pt;border-bottom:0.5pt solid #eee;font-size:7.5pt;color:#666;white-space:nowrap;">${esc(g?.nom || "à classer")}</td>
          <td style="padding:3pt 8pt;border-bottom:0.5pt solid #eee;font-size:7.5pt;color:#666;text-align:right;white-space:nowrap;">${h ? `${h} h` : "—"}</td>
          <td style="padding:3pt 8pt;border-bottom:0.5pt solid #eee;font-size:7.5pt;color:#666;">
            ${preds.length === 0 ? "<em>aucun prédécesseur</em>" : `← ${preds.map(nomDe).map(esc).join(", ")}`}
            <span style="color:#999;"> (${src === "explicite" ? "saisi" : "auto"})</span>
          </td>
        </tr>`;
      }).join("");
      return `<div style="break-inside:avoid;margin-bottom:8pt;">
        <div style="padding:4pt 8pt;background:#f3f4f6;border-left:3pt solid #1a1f2e;font-size:8.5pt;font-weight:800;color:#1a1f2e;">
          Rang ${i + 1}${visibles.length > 1 ? ` — ${visibles.length} tâches en parallèle` : ""}
        </div>
        <table style="width:100%;border-collapse:collapse;">${lignes}</table>
      </div>`;
    }).join("");

    const { cycles, bloquees, ordresContradictoires, introuvables } = incoherences;
    const incoHTML = (cycles.length + bloquees.length + ordresContradictoires.length + introuvables.length) === 0 ? "" : `
      <div style="margin-top:10pt;padding:8pt 12pt;background:#fdf0f0;border:1pt dashed #e15a5a;border-radius:4pt;break-inside:avoid;">
        <div style="font-size:8pt;font-weight:700;color:#b34040;letter-spacing:.4pt;text-transform:uppercase;margin-bottom:6pt;">Incohérences détectées</div>
        <ul style="margin:0;padding:0 0 0 14pt;font-size:8pt;color:#333;">
          ${cycles.map(c => `<li>Cycle : ${c.map(nomDe).map(esc).join(" → ")} → ${esc(nomDe(c[0]))}</li>`).join("")}
          ${bloquees.map(id => `<li>« ${esc(nomDe(id))} » : bloquée par un cycle en amont</li>`).join("")}
          ${ordresContradictoires.map(x => `<li>« ${esc(nomDe(x.tacheId))} » est placée avant son prédécesseur « ${esc(nomDe(x.predId))} »</li>`).join("")}
          ${introuvables.map(x => `<li>« ${esc(nomDe(x.tacheId))} » référence une tâche supprimée (ignorée)</li>`).join("")}
        </ul>
      </div>`;

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Rang ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1f2e;font-size:9pt;}
  @page{size:A4;margin:12mm;}
  @page {
    @bottom-left   { content: "Profero Rénovation — Ordre logique (rangs)"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
  <table style="margin-bottom:10pt;width:100%;border-collapse:collapse;background:#0a0a0a;">
    <tr>
      <td style="padding:8pt 12pt;vertical-align:middle;width:60pt;">
        <img src="${logoUrl}" alt="Profero" style="height:24pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:8pt 6pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:6.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;">Ordre logique — méthode des rangs</div>
        <div style="color:#fff;font-size:12pt;font-weight:800;line-height:1.1;margin-top:1pt;">${esc(titre)}</div>
      </td>
      <td style="padding:8pt 10pt;vertical-align:middle;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;white-space:nowrap;">
        Les tâches d'un même rang peuvent se faire en même temps · Édité le ${dateGen}
      </td>
    </tr>
  </table>
  ${bandes}
  ${incoHTML}
</body></html>`;
  };

  const exportRangPDF = () => {
    try {
      const html = buildRangHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Rang-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF Rang : " + (e.message || e));
    }
  };

  // ── Statut sauvegarde ──
  const statusColor = autoSaveStatus === "saved"  ? "#22c55e"
                    : autoSaveStatus === "saving" ? acc.accent
                    : autoSaveStatus === "error"  ? "#e15a5a"
                    : "#f5a623";
  const statusLbl = autoSaveStatus === "saved"  ? "Sauvegardé"
                  : autoSaveStatus === "saving" ? "Sauvegarde…"
                  : autoSaveStatus === "error"  ? "Erreur"
                  : "Modif en cours";

  const noChantier = !chantierId;

  return (
    <div className="p2-root" style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
      {/* CSS bubbles — couleur de chaque bulle = --bubble-color (var inline). */}
      <style>{`
        /* Mobile : le scroll passe au niveau de la PAGE (sur desktop chaque
           vue scrolle en interne sous le bandeau KPI ; sur mobile ce bandeau
           empilé pouvait dépasser l'écran et rendre la vue inatteignable). */
        @media(max-width:767px) {
          .p2-root { overflow-y: auto !important; }
          .p2-kpi-grid { grid-template-columns: 1fr 1fr !important; gap: 8px !important; }
        }
        .p2-bubble {
          --c: var(--bubble-color, #888);
          /* --av : 0% par défaut. Surchargé inline sur les bulles tâches
             avec le % d'avancement. Le linear-gradient crée une vraie
             barre de progression à l'intérieur de la bulle : la partie
             gauche (jusqu'à --av) est saturée, la droite reste discrète. */
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 45%, transparent) 0,
            color-mix(in srgb, var(--c) 45%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 10%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 10%, transparent) 100%
          );
          border: 1px solid color-mix(in srgb, var(--c) 25%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 11px 14px;
          margin: 8px 4px;
          cursor: pointer;
          color: ${T.text};
          font-size: ${FONT.sm.size}px;
          transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease;
          will-change: transform;
        }
        .p2-bubble:hover {
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 60%, transparent) 0,
            color-mix(in srgb, var(--c) 60%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) 100%
          );
          border-color: color-mix(in srgb, var(--c) 55%, transparent);
          transform: scale(1.02);
          box-shadow: 0 6px 18px color-mix(in srgb, var(--c) 28%, transparent);
        }
        .p2-bubble.active {
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 55%, transparent) 0,
            color-mix(in srgb, var(--c) 55%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) 100%
          );
          border-color: var(--c);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 32%, transparent);
        }
        .p2-bubble-form {
          background: color-mix(in srgb, var(--c) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 14px 16px;
          margin: 8px 4px;
          box-shadow: 0 4px 16px color-mix(in srgb, var(--c) 18%, transparent);
        }
        .p2-edit-btn:hover {
          background: var(--c) !important;
          border-color: var(--c) !important;
          color: #000 !important;
        }
        /* Bouton "voir le dernier compte rendu" : masqué, révélé au survol de la bulle. */
        .p2-cr-btn { opacity: 0; transition: opacity .12s, background .12s, color .12s; }
        .p2-bubble:hover .p2-cr-btn { opacity: 1; }
        .p2-cr-btn:hover {
          background: var(--c) !important;
          border-color: var(--c) !important;
          color: #000 !important;
        }
        .p2-kpi-clic { transition: border-color .12s, transform .12s, box-shadow .12s; }
        .p2-kpi-clic:hover {
          border-color: #f97316 !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(249,115,22,0.18);
        }
        /* Bulle tâche : un panneau d'accès rapide se déplie au hover,
           permettant d'éditer heures réelles + ouvriers sans ouvrir la modale.
           Tout est en CSS pour rester fluide (pas de state React qui flicker). */
        .p2-tache-expand {
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          transition: max-height .22s ease, opacity .15s ease, margin-top .22s ease, padding .22s ease;
          margin-top: 0;
          padding-top: 0;
        }
        .p2-bubble:hover .p2-tache-expand {
          max-height: 220px;
          opacity: 1;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
        }
        .p2-mini-chip {
          padding: 3px 9px;
          border-radius: 99px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          border: 1px solid ${T.border};
          background: rgba(255,255,255,0.04);
          color: ${T.textSub};
          transition: all .12s;
        }
        .p2-mini-chip.sel {
          background: color-mix(in srgb, var(--c) 30%, transparent);
          border-color: var(--c);
          color: ${T.text};
        }
        .p2-mini-chip:hover {
          background: color-mix(in srgb, var(--c) 20%, transparent);
        }
      `}</style>

      {/* ── Header avec sélecteur chantier ── */}
      <div style={{
        padding: "14px 22px", borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: RADIUS.md, flexShrink: 0,
          background: acc.bg10, color: acc.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={ListChecks} size={18} strokeWidth={2}/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>Phasage</div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: acc.bg10, color: acc.accent, border: `1px solid ${acc.border}`,
            borderRadius: RADIUS.pill, padding: "2px 9px",
            fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
          }}>
            <Icon as={Sparkles} size={10}/>
            V2
          </span>
        </div>

        {/* Badge statut sauvegarde — visible seulement si on a un chantier ouvert */}
        {chantierId && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
            color: statusColor, background: statusColor + "18", border: `1px solid ${statusColor}40`,
            borderRadius: 99, padding: "2px 8px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}/>
            {statusLbl}
          </span>
        )}

        {/* Boutons d'action chantier */}
        {chantierId && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFilePicked} style={{ display: "none" }}/>
            {/* Toggle Liste / Gantt */}
            <div style={{
              marginLeft: "auto",
              display: "inline-flex", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.card, overflow: "hidden",
            }}>
              {[
                { id: "list",         icon: LayoutGrid,        label: "Liste" },
                { id: "chrono",       icon: ListOrdered,       label: "Chronologique" },
                { id: "rang",         icon: Network,           label: "Rang" },
                { id: "gantt",        icon: GanttChartSquare,  label: "Gantt" },
                { id: "previsionnel", icon: Calendar,          label: "Prévisionnel" },
              ].map(opt => {
                const active = viewMode === opt.id;
                return (
                  <button key={opt.id} onClick={() => setViewMode(opt.id)}
                    title={opt.label}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "7px 12px", border: "none",
                      background: active ? acc.bg10 : "transparent",
                      color: active ? acc.accent : T.textSub,
                      fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                      cursor: "pointer", transition: "all .12s",
                    }}>
                    <Icon as={opt.icon} size={13}/>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <button onClick={viewMode === "gantt" ? exportGanttPDF : viewMode === "previsionnel" ? exportPrevisionnelPDF : viewMode === "chrono" ? exportChronoPDF : viewMode === "rang" ? exportRangPDF : exportRapportPDF}
              title={viewMode === "gantt" ? "Exporter le Gantt en PDF (paysage)" : viewMode === "previsionnel" ? "Exporter le prévisionnel client en PDF" : viewMode === "chrono" ? "Exporter le planning chantier en PDF (par groupe)" : viewMode === "rang" ? "Exporter l'ordre logique par rangs en PDF" : "Exporter le phasage en PDF"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
                transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = acc.accent; e.currentTarget.style.borderColor = acc.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border; }}>
              <Icon as={FileDown} size={14}/>
              PDF {viewMode === "gantt" ? "Gantt" : viewMode === "previsionnel" ? "Prévisionnel" : viewMode === "chrono" ? "Planning" : viewMode === "rang" ? "Rang" : ""}
            </button>
            <button onClick={() => setShowSuiviDirection(true)} title="Suivi direction (marge cible, prime)"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
                cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = acc.accent; e.currentTarget.style.borderColor = acc.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border; }}>
              <Icon as={Settings} size={14}/>
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={FileSpreadsheet} size={14}/>
              Importer un devis
            </button>
          </>
        )}

        {/* Sélecteur chantier */}
        <div style={{ position: "relative", marginLeft: chantierId ? 0 : "auto", minWidth: 240 }}>
          <Icon as={Building2} size={13} color={T.textMuted}
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
          <select
            value={chantierId}
            onChange={e => setChantierId(e.target.value)}
            style={{
              width: "100%",
              appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
              padding: "9px 32px 9px 32px",
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: T.fieldBg || T.card,
              color: chantierId ? T.text : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600,
              outline: "none", cursor: "pointer",
            }}>
            <option value="">— Sélectionner un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
          <Icon as={ChevronDown} size={13} color={T.textMuted}
            style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
        </div>
      </div>

      {/* ── Sous-header chantier (KPI + barre d'avancement, persistant) ── */}
      {chantierId && !loadingPhasage && ouvrages.length > 0 && (() => {
        const margeColor = couleurMarge(margeChantier, margePctChantier);
        return (
          <div style={{
            flexShrink: 0,
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
            padding: "10px 22px 12px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {!kpiCollapsed && (
            <div className="p2-kpi-grid" style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}>
              <KpiCard T={T} icon={Banknote} iconColor="#f5c400" label={fin.venduHT.label}
                donnee={fin.venduHT} dateRef={todayRefISO}
                value={fin.venduHT.valeurTexte}
                sub={fin.venduHT.sousLabel}
                onClick={() => setKpiDetail("vendu")}/>
              <KpiCard T={T} icon={Target} iconColor="#818cf8" label={fin.moPrev.label}
                donnee={fin.moPrev} dateRef={todayRefISO}
                value={fin.moPrev.valeurTexte}
                sub={fin.moPrev.sousLabel}
                onClick={() => setKpiDetail("mo_prev")}/>
              <KpiCard T={T} icon={Boxes} iconColor="#fb923c" label={fin.matPrev.label}
                donnee={fin.matPrev} dateRef={todayRefISO}
                value={fin.matPrev.valeurTexte}
                sub={fin.matPrev.sousLabel}
                onClick={() => setKpiDetail("commandes_prev")}/>
              <KpiCard T={T}
                icon={margePrevChantier >= 0 ? TrendingUp : TrendingDown}
                iconColor={couleurMarge(margePrevChantier, margePrevPctChantier)} label={fin.margePrev.label}
                donnee={fin.margePrev} dateRef={todayRefISO}
                value={fin.margePrev.valeurTexte}
                sub={fin.margePrev.sousLabel}
                onClick={() => setKpiDetail("marge_prev")}/>
              <KpiCard T={T} icon={Clock} iconColor="#5b9cf6" label={fin.heuresReelles.label}
                donnee={fin.heuresReelles} dateRef={todayRefISO}
                value={fin.heuresReelles.valeurTexte}
                sub={fin.heuresReelles.sousLabel}
                accent={couleurDerive(heuresReellesTotalChantier, heuresVenduesChantier)}
                onClick={() => setKpiDetail("heures")}/>
              <KpiCard T={T} icon={Calendar} iconColor="#5b9cf6" label="Heures ce mois"
                value={moisCourant.heures > 0 ? `${moisCourant.heures.toFixed(0)}h` : "—"}
                sub={moisCourant.heures > 0
                  ? `${moisCourant.label} · voir le détail`
                  : `${moisCourant.label} · aucun pointage`}
                onClick={() => setMoisModal(true)}/>
              <KpiCard T={T} icon={HardHat} iconColor="#60a5fa" label={fin.moReel.label}
                donnee={fin.moReel} dateRef={todayRefISO}
                value={fin.moReel.valeurTexte}
                sub={fin.moReel.sousLabel}
                accent={coutMOTotalChantier > prixHTChantier && prixHTChantier > 0 ? "#e15a5a" : null}
                onClick={() => setKpiDetail("mo")}/>
              <KpiCard T={T} icon={Car} iconColor="#f59e0b" label={fin.trajets.label}
                donnee={fin.trajets} dateRef={todayRefISO}
                value={fin.trajets.valeurTexte}
                sub={fin.trajets.sousLabel}
                onClick={() => setKpiDetail("trajet")}/>
              <KpiCard T={T} icon={Clock} iconColor="#f59e0b" label={fin.indirect.label}
                donnee={fin.indirect} dateRef={todayRefISO}
                value={fin.indirect.valeurTexte}
                sub={fin.indirect.sousLabel}
                onClick={() => setKpiDetail("indirect")}/>
              <KpiCard T={T} icon={Receipt} iconColor="#f97316" label={fin.matReel.label}
                donnee={fin.matReel} dateRef={todayRefISO}
                value={fin.matReel.valeurTexte}
                sub={fin.matReel.sousLabel}
                onClick={() => setMatKpiModal(true)}/>
              <KpiCard T={T} icon={Percent} iconColor="#a78bfa" label={fin.fg.label}
                donnee={fin.fg} dateRef={todayRefISO}
                value={fin.fg.valeurTexte}
                sub={fin.fg.sousLabel}
                onClick={() => setKpiDetail("fg")}/>
              <KpiCard T={T}
                icon={margeChantier >= 0 ? TrendingUp : TrendingDown}
                iconColor={margeColor} label={fin.marge.label}
                donnee={fin.marge} dateRef={todayRefISO}
                value={fin.marge.valeurTexte}
                sub={fin.marge.sousLabel}
                accent={margeColor} bold={true}
                onClick={() => setKpiDetail("marge")}/>
              {(margeCible > 0 || primeChant > 0) && (
                <KpiCibleEtPrime T={T}
                  margeCible={margeCible} margePct={margePctChantier}
                  prime={primeChant} seuilPrime={seuilPrime}
                  prixHT={prixHTChantier}/>
              )}
            </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textMuted,
                letterSpacing: .6, textTransform: "uppercase", whiteSpace: "nowrap",
              }}>
                Avancement
              </div>
              <InfoBulle contenu={avancementChantierDetail} T={T} style={{ flex: 1 }}>
                <div style={{
                  flex: 1, position: "relative", height: 18,
                  background: "rgba(255,255,255,0.06)", borderRadius: 9,
                  overflow: "hidden", cursor: "help",
                  border: `1px solid ${T.border}`,
                }}>
                  <div style={{
                    width: `${Math.min(100, avancementChantier)}%`, height: "100%",
                    background: avancementChantier >= 100
                      ? "linear-gradient(90deg, #16a34a, #22c55e)"
                      : `linear-gradient(90deg, color-mix(in srgb, ${acc.accent} 80%, transparent), ${acc.accent})`,
                    transition: "width .4s ease",
                    boxShadow: avancementChantier > 0 ? `0 0 8px color-mix(in srgb, ${acc.accent} 50%, transparent)` : "none",
                  }}/>
                </div>
              </InfoBulle>
              <div style={{
                fontSize: FONT.lg.size, fontWeight: 800,
                color: avancementChantier >= 100 ? "#22c55e" : T.text,
                minWidth: 54, textAlign: "right",
                letterSpacing: -.3,
              }}>
                {avancementChantier}%
              </div>
              <button onClick={toggleKpiCollapsed}
                title={kpiCollapsed ? "Afficher les indicateurs" : "Masquer les indicateurs (ne garder que la barre)"}
                style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
                  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
                  transition: "all .12s",
                }}
                onMouseEnter={e => { e.currentTarget.style.color = acc.accent; e.currentTarget.style.borderColor = acc.border; }}
                onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border; }}>
                <Icon as={kpiCollapsed ? ChevronDown : ChevronUp} size={16}/>
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Body 3 colonnes ── */}
      {noChantier ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{
            background: T.card, border: `1px dashed ${T.border}`,
            borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
            maxWidth: 460, color: T.textMuted,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: RADIUS.lg,
              background: acc.bg10, color: acc.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
            }}>
              <Icon as={Building2} size={26} strokeWidth={1.5}/>
            </div>
            <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              Choisis un chantier
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6 }}>
              Sélectionne un chantier en haut à droite pour afficher ses lots, ouvrages et tâches.
            </div>
          </div>
        </div>
      ) : loadingPhasage ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
          Chargement du phasage…
        </div>
      ) : viewMode === "previsionnel" ? (
        <PrevisionnelEditor prev={prev} updatePrev={updatePrev} chantier={chantier} T={T} acc={acc} onGenerer={genererPrevisionnelAuto} />
      ) : viewMode === "chrono" ? (
        <ChronoView
          ouvrages={ouvrages} lots={lots} groupes={chronoGroupes} jalons={chronoJalons}
          acc={acc} T={T}
          applyChrono={applyChrono} patchTaches={patchTaches} setGroupes={setChronoGroupes} setJalons={setChronoJalons}
          setGroupesEtJalons={setChronoGroupesEtJalons}
          updateTache={updateTache}
          onInitGroupesTypes={groupesTypes.length > 0 ? initChronoDepuisGroupesTypes : null}
          chronoVierge={chronoVierge} nbGtManquants={gtManquants.length}
          propositionPourGroupe={propositionPourGroupe} onAffecterOuvriers={affecterOuvriersAuGroupe}
          onMarquerExterne={marquerGroupeExterne}
          onClickTache={(ouvrageId, tacheId) => setEditingTache({ ouvrageId, tacheId })}
          rapportsPourTache={rapportsPourTache}
          onShowRapports={(tache, list) => setRapportsModal({ tacheNom: tache.nom, tacheId: tache.id, rapports: list })}
          controleCtx={{
            chantierId,
            chantierNom: chantiers.find(c => c.id === chantierId)?.nom || phasage?.chantier_nom || "",
            phasageId: phasage?.id || null,
            auteur: profil?.nom || profil?.email || "",
          }}
          controlesChantier={controlesChantier} reservesChantier={reservesChantier}
          onControleChange={() => setControleVersion(v => v + 1)}
        />
      ) : viewMode === "gantt" ? (
        <GanttV2
          ouvrages={ouvrages} lots={lots} jalons={chronoJalons} groupes={chronoGroupes} acc={acc} T={T}
          avancementOuvrage={avancementOuvrage}
          tacheHeuresReelles={tacheHeuresReelles}
          crWindowPourTache={crWindowPourTache}
          onClickTache={(ouvrageId, tacheId) => setEditingTache({ ouvrageId, tacheId })}
        />
      ) : viewMode === "rang" ? (
        <RangView
          ouvrages={ouvrages} groupes={chronoGroupes} acc={acc} T={T}
          onClickTache={(ouvrageId, tacheId) => setEditingTache({ ouvrageId, tacheId })}
          appliquerPredecesseurs={appliquerPredecesseurs}
          applyChrono={applyChrono}
        />
      ) : (
        <div className={`p2-cols ${selectedOuvrageId ? "show-taches" : selectedLotId ? "show-ouvrages" : "show-lots"}`}
          style={{ flex: 1, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) minmax(0, 1.2fr)", minHeight: 0 }}>
          {/* ── Colonne 1 : Lots ── */}
          <div className="p2-pane p2-pane-lots" style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}><Icon as={Boxes} size={12}/> Lots</div>
            <div style={colBody}>
              {/* On masque les lots vides (aucun ouvrage, donc aucune tâche).
                  On garde le lot actuellement sélectionné même vide, pour
                  pouvoir y ajouter un premier ouvrage sans qu'il disparaisse.
                  Le bouton « lots vides » en bas les révèle tous au besoin. */}
              {lots.filter(l => showEmptyLots || (countByLot[l.id] || 0) > 0 || selectedLotId === l.id).map(l => {
                const active = selectedLotId === l.id;
                const count = countByLot[l.id] || 0;
                const av = count > 0 ? avancementLot(l.id) : 0;
                const bubbleColor = av >= 100 ? "#22c55e" : l.couleur;
                return (
                  <div key={l.id} className={`p2-bubble ${active ? "active" : ""}`}
                    style={{ "--bubble-color": bubbleColor, "--av": `${av}%`,
                      display: "flex", alignItems: "center", gap: 10,
                      outline: dragOverLotId === l.id ? `2px dashed ${l.couleur}` : "none",
                      outlineOffset: 2 }}
                    onClick={() => { setSelectedLotId(l.id); setSelectedOuvrageId(null); }}
                    onDragOver={draggedOuvrageId ? (e => { e.preventDefault(); if (dragOverLotId !== l.id) setDragOverLotId(l.id); }) : undefined}
                    onDragLeave={() => { if (dragOverLotId === l.id) setDragOverLotId(null); }}
                    onDrop={draggedOuvrageId ? (e => { e.preventDefault(); moveOuvrageToLot(draggedOuvrageId, l.id); setDraggedOuvrageId(null); setDragOverLotId(null); }) : undefined}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: T.text }}>{l.label}</span>
                      {(() => {
                        const hr = heuresReellesLot(l.id);
                        const hv = heuresVenduesLot(l.id);
                        if (hr === 0 && hv === 0) return null;
                        const col = couleurDepassement(hr, hv);
                        return (
                          <InfoBulle contenu={hv > 0 ? `Réalisé ${fmtH(hr)}h sur ${fmtH(hv)}h vendues` : `${fmtH(hr)}h réelles`} T={T}>
                            <div style={{ fontSize: FONT.xs.size, color: col || T.textMuted, fontWeight: col ? 700 : 400, marginTop: 2, cursor: "help" }}>
                              {fmtH(hr)}h / {hv > 0 ? `${fmtH(hv)}h` : "—"}
                            </div>
                          </InfoBulle>
                        );
                      })()}
                    </div>
                    {l.code_prefixe && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: .5,
                        padding: "1px 6px", borderRadius: RADIUS.sm,
                        background: "rgba(255,255,255,0.10)", color: T.text, opacity: .65,
                      }}>{l.code_prefixe}</span>
                    )}
                    {count > 0 && (
                      <>
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: "2px 8px",
                          borderRadius: RADIUS.pill,
                          background: "rgba(0,0,0,0.18)", color: T.text,
                        }}>{count}</span>
                        <InfoBulle contenu={avancementLotDetail(l.id)} T={T}>
                          <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                            {av}%
                          </span>
                        </InfoBulle>
                      </>
                    )}
                    <button
                      className="p2-cr-btn"
                      onClick={e => { e.stopPropagation(); setMatPanel({ type: "lot", id: l.id }); }}
                      title="Matériaux & commandes de ce lot"
                      style={{
                        background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                        color: T.text, borderRadius: RADIUS.sm,
                        width: 24, height: 24, padding: 0, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>
                      <Icon as={Receipt} size={11}/>
                    </button>
                  </div>
                );
              })}
              {orphans > 0 && (() => {
                const av = avancementLot("_orphans");
                const bubbleColor = av >= 100 ? "#22c55e" : T.textMuted;
                return (
                  <div className={`p2-bubble ${selectedLotId === "_orphans" ? "active" : ""}`}
                    style={{ "--bubble-color": bubbleColor, "--av": `${av}%`, marginTop: 14,
                      display: "flex", alignItems: "center", gap: 10, opacity: .85,
                      outline: dragOverLotId === "_orphans" ? "2px dashed #888888" : "none",
                      outlineOffset: 2 }}
                    onClick={() => { setSelectedLotId("_orphans"); setSelectedOuvrageId(null); }}
                    onDragOver={draggedOuvrageId ? (e => { e.preventDefault(); if (dragOverLotId !== "_orphans") setDragOverLotId("_orphans"); }) : undefined}
                    onDragLeave={() => { if (dragOverLotId === "_orphans") setDragOverLotId(null); }}
                    onDrop={draggedOuvrageId ? (e => { e.preventDefault(); moveOuvrageToLot(draggedOuvrageId, null); setDraggedOuvrageId(null); setDragOverLotId(null); }) : undefined}>
                    <span style={{ flex: 1, fontStyle: "italic", color: T.textMuted, fontWeight: 600 }}>Sans lot</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 8px",
                      borderRadius: RADIUS.pill, background: "rgba(0,0,0,0.18)", color: T.text,
                    }}>{orphans}</span>
                    <InfoBulle contenu={avancementLotDetail("_orphans")} T={T}>
                      <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                        {av}%
                      </span>
                    </InfoBulle>
                  </div>
                );
              })()}
              {(() => {
                const nbVides = lots.filter(l => (countByLot[l.id] || 0) === 0 && selectedLotId !== l.id).length;
                if (nbVides === 0 && !showEmptyLots) return null;
                return (
                  <button onClick={() => setShowEmptyLots(v => !v)}
                    style={{
                      marginTop: 12, width: "100%", background: "transparent",
                      border: `1px dashed ${T.border}`, color: T.textMuted,
                      borderRadius: RADIUS.md, padding: "7px 10px", cursor: "pointer",
                      fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700,
                    }}>
                    {showEmptyLots
                      ? "Masquer les lots vides"
                      : `+ ${nbVides} lot${nbVides > 1 ? "s" : ""} vide${nbVides > 1 ? "s" : ""}`}
                  </button>
                );
              })()}
            </div>
          </div>

          {/* ── Colonne 2 : Ouvrages ── */}
          <div className="p2-pane p2-pane-ouvrages" style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}>
              <button className="mobile-only" onClick={() => { setSelectedLotId(null); setSelectedOuvrageId(null); }}
                style={{ alignItems: "center", gap: 4, background: "transparent", border: `1px solid ${T.border}`, color: T.textSub, borderRadius: RADIUS.sm, padding: "3px 9px", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                ‹ Lots
              </button>
              <Icon as={Hammer} size={12}/> Ouvrages
              {selectedLotId && (
                <>
                  {ouvragesLot.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{ouvragesLot.length}</span>
                  )}
                  <button onClick={() => createOuvrage(selectedLotId)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Ouvrage
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedLotId
                ? emptyColMsg("Sélectionne un lot à gauche")
                : ouvragesLot.length === 0
                  ? emptyColMsg("Aucun ouvrage pour ce lot — clique « + Ouvrage »")
                  : ouvragesLot.map(o => {
                    const active = selectedOuvrageId === o.id;
                    const nbTaches = (o.taches || []).length;
                    const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
                    const av = nbTaches > 0 ? avancementOuvrage(o) : 0;
                    const bubbleColor = av >= 100 ? "#22c55e" : lotColor;
                    return (
                      <div key={o.id} className={`p2-bubble ${active ? "active" : ""}`}
                        draggable
                        title="Glisse cet ouvrage sur un lot à gauche pour le reclasser"
                        style={{ "--bubble-color": bubbleColor, "--av": `${av}%`,
                          display: "flex", alignItems: "center", gap: 10,
                          cursor: "grab",
                          opacity: draggedOuvrageId === o.id ? 0.4 : 1 }}
                        onClick={() => setSelectedOuvrageId(o.id)}
                        onDragStart={e => { setDraggedOuvrageId(o.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); }}
                        onDragEnd={() => { setDraggedOuvrageId(null); setDragOverLotId(null); }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.libelle || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans libellé)</span>}
                          </div>
                          {(() => {
                            const hr = heuresReellesOuvrage(o);
                            const hv = heuresVenduesOuvrage(o);
                            const showH = hr > 0 || hv > 0;
                            if (!showH && !o.quantite && !o.prix_ht) return null;
                            const col = couleurDepassement(hr, hv);
                            return (
                              <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>
                                {showH && (
                                  <InfoBulle contenu={hv > 0 ? `Réalisé ${fmtH(hr)}h sur ${fmtH(hv)}h vendues` : `${fmtH(hr)}h réelles`} T={T}>
                                    <span style={{ color: col || T.textMuted, fontWeight: col ? 700 : 400, cursor: "help" }}>
                                      {fmtH(hr)}h / {hv > 0 ? `${fmtH(hv)}h` : "—"}
                                    </span>
                                  </InfoBulle>
                                )}
                                {o.quantite ? `${showH ? " · " : ""}${o.quantite} ${o.unite || ""}` : ""}
                                {o.prix_ht ? `${(showH||o.quantite) ? " · " : ""}${o.prix_ht.toLocaleString("fr-FR")} €` : ""}
                              </div>
                            );
                          })()}
                        </div>
                        {nbTaches > 0 && (
                          <>
                            <span style={{
                              fontSize: 10, fontWeight: 800, padding: "2px 8px",
                              borderRadius: RADIUS.pill,
                              background: "rgba(0,0,0,0.18)", color: T.text, flexShrink: 0,
                            }}>{nbTaches}</span>
                            <InfoBulle contenu={avancementOuvrageDetail(o)} T={T}>
                              <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                                {av}%
                              </span>
                            </InfoBulle>
                          </>
                        )}
                        <button
                          className="p2-cr-btn"
                          onClick={e => { e.stopPropagation(); setMatPanel({ type: "ouvrage", id: o.id }); }}
                          title="Matériaux & commandes de cet ouvrage"
                          style={{
                            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                            color: T.text, borderRadius: RADIUS.sm,
                            width: 26, height: 26, padding: 0, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                          <Icon as={Receipt} size={12}/>
                        </button>
                        <button
                          className="p2-edit-btn"
                          onClick={e => { e.stopPropagation(); setEditingOuvrageId(o.id); }}
                          title="Modifier l'ouvrage"
                          style={{
                            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                            color: T.text, borderRadius: RADIUS.sm,
                            width: 26, height: 26, padding: 0, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0, transition: "all .12s",
                          }}>
                          <Icon as={Pencil} size={12}/>
                        </button>
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* ── Colonne 3 : Tâches ── */}
          <div className="p2-pane p2-pane-taches" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={colHeader}>
              <button className="mobile-only" onClick={() => setSelectedOuvrageId(null)}
                style={{ alignItems: "center", gap: 4, background: "transparent", border: `1px solid ${T.border}`, color: T.textSub, borderRadius: RADIUS.sm, padding: "3px 9px", fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                ‹ Ouvrages
              </button>
              <Icon as={ClipboardList} size={12}/> Tâches
              {selectedOuvrage && (
                <>
                  {taches.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{taches.length}</span>
                  )}
                  <button onClick={() => createTache(selectedOuvrage.id)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Tâche
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedOuvrage
                ? emptyColMsg("Sélectionne un ouvrage")
                : taches.length === 0
                  ? emptyColMsg("Aucune tâche — clique « + Tâche »")
                  : (() => {
                    const tacheColor = lots.find(l => l.id === selectedOuvrage.lot_id)?.couleur || acc.accent;
                    return taches.map(t => {
                      const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
                      const bubbleColor = av >= 100 ? "#22c55e" : tacheColor;
                      return (
                        <div key={t.id} className="p2-bubble"
                          style={{ "--bubble-color": bubbleColor, "--av": `${av}%`, display: "flex", flexDirection: "column", gap: 0 }}
                          onClick={() => setEditingTache({ ouvrageId: selectedOuvrage.id, tacheId: t.id })}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.nom || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans nom)</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                              {(() => {
                                const hr = tacheHeuresReelles(t);
                                const hv = tacheHeuresVendues(t);
                                if (hr > 0 || hv > 0) {
                                  const col = couleurDepassement(hr, hv);
                                  return (
                                    <InfoBulle contenu={hv > 0 ? `Réalisé ${fmtH(hr)}h sur ${fmtH(hv)}h vendues (${Math.round(hr/hv*100)}%)` : `${fmtH(hr)}h réelles`} T={T}>
                                      <span style={{ fontSize: FONT.xs.size, color: col || T.textMuted, fontWeight: col ? 700 : 400, whiteSpace: "nowrap", cursor: "help" }}>
                                        {fmtH(hr)}h / {hv > 0 ? `${fmtH(hv)}h` : "—"}
                                      </span>
                                    </InfoBulle>
                                  );
                                }
                                return null;
                              })()}
                              {t.date_prevue && (() => {
                                const d = new Date(t.date_prevue);
                                if (isNaN(d.getTime())) return null;
                                const lbl = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                                return (
                                  <span title={`Planifié le ${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 3,
                                      fontSize: 10, fontWeight: 700,
                                      padding: "1px 7px", borderRadius: RADIUS.sm,
                                      background: "rgba(91,138,245,0.16)", color: "#5b8af5",
                                      border: "1px solid rgba(91,138,245,0.35)",
                                    }}>
                                    📅 {lbl}
                                  </span>
                                );
                              })()}
                              {Array.isArray(t.ouvriers) && t.ouvriers.length > 0 && (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: -4, marginLeft: 4 }}
                                  title={t.ouvriers.join(", ")}>
                                  {t.ouvriers.slice(0, 3).map((n, idx) => (
                                    <span key={n} style={{
                                      width: 18, height: 18, borderRadius: "50%",
                                      background: `color-mix(in srgb, ${tacheColor} 60%, transparent)`,
                                      border: `1.5px solid ${T.surface}`,
                                      color: T.text, fontSize: 9, fontWeight: 800,
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      marginLeft: idx === 0 ? 0 : -6, position: "relative", zIndex: 3 - idx,
                                    }}>{initiales(n)}</span>
                                  ))}
                                  {t.ouvriers.length > 3 && (
                                    <span style={{
                                      fontSize: 9, fontWeight: 800, color: T.textMuted,
                                      marginLeft: 4,
                                    }}>+{t.ouvriers.length - 3}</span>
                                  )}
                                </div>
                              )}
                              <InfoBulle contenu={avancementTacheDetail(t)} T={T} style={{ marginLeft: "auto" }}>
                                <span style={{ fontSize: FONT.xs.size, color: av >= 100 ? "#22c55e" : T.textMuted, fontWeight: 800, cursor: "help" }}>
                                  {av}%
                                </span>
                              </InfoBulle>
                            </div>
                          </div>
                          {(() => {
                            const rapport = rapportPourTache(t);
                            if (!rapport) return null;
                            return (
                              <button
                                className="p2-cr-btn"
                                onClick={e => { e.stopPropagation(); setRapportModal({ rapport, tacheNom: t.nom }); }}
                                title="Voir le dernier compte rendu lié à cette tâche"
                                style={{
                                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                                  color: T.text, borderRadius: RADIUS.sm,
                                  width: 26, height: 26, padding: 0, cursor: "pointer",
                                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                                  flexShrink: 0,
                                }}>
                                <Icon as={FileText} size={12}/>
                              </button>
                            );
                          })()}
                          <button
                            className="p2-edit-btn"
                            onClick={e => { e.stopPropagation(); setEditingTache({ ouvrageId: selectedOuvrage.id, tacheId: t.id }); }}
                            title="Modifier la tâche"
                            style={{
                              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                              color: T.text, borderRadius: RADIUS.sm,
                              width: 26, height: 26, padding: 0, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              flexShrink: 0, transition: "all .12s",
                            }}>
                            <Icon as={Pencil} size={12}/>
                          </button>
                          </div>
                          {/* ── Panneau d'accès rapide (déplié au hover) ── */}
                          <div className="p2-tache-expand" onClick={e => e.stopPropagation()}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, minWidth: 70 }}>
                                Heures réelles
                              </span>
                              <input type="number" step="0.5" min="0" value={tacheHeuresReelles(t) || ""}
                                onClick={e => e.stopPropagation()}
                                readOnly={tachePointages(t).length > 0}
                                title={tachePointages(t).length > 0 ? "Heures issues du registre de pointage (validation de fin de journée) — non modifiable ici" : undefined}
                                onChange={e => { if (tachePointages(t).length > 0) return; updateTache(selectedOuvrage.id, t.id, { heures_reelles: e.target.value === "" ? null : parseFloat(e.target.value) }); }}
                                placeholder="0"
                                style={{
                                  width: 70, padding: "4px 8px", borderRadius: RADIUS.sm,
                                  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
                                  color: T.text, fontSize: FONT.xs.size + 1, fontFamily: "inherit",
                                  outline: "none", textAlign: "right",
                                  opacity: tachePointages(t).length > 0 ? 0.65 : 1,
                                  cursor: tachePointages(t).length > 0 ? "not-allowed" : "text",
                                }}/>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, marginLeft: 8 }}>
                                Avanc.
                              </span>
                              <input type="number" step="5" min="0" max="100" value={t.avancement ?? ""}
                                onClick={e => e.stopPropagation()}
                                onChange={e => updateTache(selectedOuvrage.id, t.id, { avancement: e.target.value === "" ? 0 : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                                placeholder="0"
                                style={{
                                  width: 60, padding: "4px 8px", borderRadius: RADIUS.sm,
                                  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
                                  color: T.text, fontSize: FONT.xs.size + 1, fontFamily: "inherit",
                                  outline: "none", textAlign: "right",
                                }}/>
                              <span style={{ fontSize: 10, color: T.textMuted }}>%</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, minWidth: 70 }}>
                                Ouvriers
                              </span>
                              {ouvriers.length === 0 ? (
                                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>aucun configuré</span>
                              ) : ouvriers.map(nom => {
                                const sel = (t.ouvriers || []).includes(nom);
                                return (
                                  <button key={nom}
                                    className={`p2-mini-chip ${sel ? "sel" : ""}`}
                                    onClick={e => { e.stopPropagation(); toggleOuvrier(selectedOuvrage.id, t.id, nom); }}>
                                    {nom}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Modale suivi direction ── */}
      {showSuiviDirection && (
        <ItemEditModal
          title="Suivi direction"
          color={acc.accent}
          T={T} accent={acc.accent}
          onClose={() => setShowSuiviDirection(false)}
          onDelete={null}
        >
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5, marginBottom: 4 }}>
            Objectifs RH / pilotage de ce chantier. Visible dans le footer et utilisé par Dashboard Analyse.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ModalField label="Marge vendue cible (%)">
              <input type="number" step="1" min="0" max="100" value={meta.marge_vendue_cible ?? ""}
                onChange={e => saveMeta({ marge_vendue_cible: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="30" style={modalInp(T)}/>
            </ModalField>
            <ModalField label="FG — Taux horaire (€/h)">
              <input type="number" step="0.5" min="0" value={meta.fg_taux_horaire ?? ""}
                onChange={e => saveMeta({ fg_taux_horaire: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="5" style={modalInp(T)}/>
            </ModalField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ModalField label="Seuil prime (%)">
              <input type="number" step="1" min="0" max="100" value={meta.seuil_prime ?? ""}
                onChange={e => saveMeta({ seuil_prime: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="25" style={modalInp(T)}/>
            </ModalField>
            <ModalField label="Prime chantier (€)">
              <input type="number" step="50" min="0" value={meta.prime ?? ""}
                onChange={e => saveMeta({ prime: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="300" style={modalInp(T)}/>
            </ModalField>
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5, margin: "8px 0 4px", paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <strong style={{ color: T.text }}>Reprise d'heures antérieures</strong> — chantier démarré avant l'application.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ModalField label="Heures avant l'app (h)">
              <input type="number" step="1" min="0" value={repriseHInput}
                onChange={e => setRepriseHInput(e.target.value)}
                onBlur={saveReprise}
                placeholder="0" style={modalInp(T)}/>
            </ModalField>
            <ModalField label="Taux horaire moyen (€/h)">
              <input type="number" step="0.5" min="0" value={repriseTInput}
                onChange={e => setRepriseTInput(e.target.value)}
                onBlur={saveReprise}
                placeholder="21" style={modalInp(T)}/>
            </ModalField>
          </div>
          {repriseHeures > 0 && (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 2 }}>
              Coût de reprise ajouté : <strong style={{ color: T.text }}>{fmtEur(repriseCout)}</strong> ({fmtH(repriseHeures)} h × {repriseTaux || 0} €/h).
            </div>
          )}

          <div style={{
            marginTop: 4, padding: "10px 12px", borderRadius: RADIUS.md,
            background: T.card, border: `1px solid ${T.border}`,
            fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.6,
          }}>
            <div><strong style={{ color: T.text }}>Marge cible</strong> : objectif de marge nette pour considérer le chantier rentable.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Frais généraux</strong> : taux horaire (€/h) multiplié par les heures réelles du chantier (tâches + trajets + indirect). Couvre admin, transport, etc. Déduit de la marge.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Seuil prime</strong> : marge minimale à partir de laquelle l'équipe touche la prime.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Prime chantier</strong> : montant attribué à l'équipe si le seuil est dépassé.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Reprise d'heures</strong> : heures (et coût) déjà consommés avant l'app. Ajoutées aux « Heures totales », au « Coût MO » et à la marge, mais rangées à part (« avant l'application »), sans fausser la répartition par mois ni par ouvrier.</div>
          </div>
        </ItemEditModal>
      )}

      {/* ── Modale import devis ── */}
      {importState && (
        <ImportDevisModal
          state={importState}
          lots={lots}
          bibliotheque={bibliotheque}
          T={T} accent={acc.accent} accentBorder={acc.border} accentBg10={acc.bg10}
          onUpdateItem={updateImportItem}
          onToggleAll={toggleAllImport}
          onClose={() => setImportState(null)}
          onConfirm={confirmImport}
        />
      )}

      {/* ── Modale édition ouvrage ── */}
      {matKpiModal && (() => {
        const lignes = commandeLignes;
        const total = totalLignes(lignes);
        const sansPrix = (l) => l.prix_total == null && l.prix_unitaire == null;
        const sansPrixCount = lignes.filter(sansPrix).length;
        const lotLabelOf = (id) => lots.find(l => l.id === id)?.label || (id || null);
        const ouvrageLabelOf = (id) => ouvrages.find(o => o.id === id)?.libelle || null;
        return (
          <div onClick={() => setMatKpiModal(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
                width: "min(680px, 100%)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <Icon as={Receipt} size={18}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>Commandes du chantier</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                    {chantier?.nom || ""} · {lignes.length} ligne{lignes.length > 1 ? "s" : ""}
                    {sansPrixCount > 0 && <span style={{ color: "#f5a623", fontWeight: 700 }}> · {sansPrixCount} sans prix</span>}
                  </div>
                </div>
                <button onClick={() => setMatKpiModal(false)} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}><Icon as={X} size={18}/></button>
              </div>
              <div style={{ padding: "12px 20px" }}>
                {lignes.length === 0 ? (
                  <div style={{ fontSize: FONT.sm.size, color: T.textMuted, fontStyle: "italic" }}>Aucune commande liée à ce chantier pour l'instant.</div>
                ) : lignes.map(l => {
                  const st = statutLigne(l);
                  const lot = lotLabelOf(l.lot_id);
                  const ouv = ouvrageLabelOf(l.ouvrage_id);
                  const noPrix = sansPrix(l);
                  return (
                    <div key={l.id} style={{ padding: "9px 0 9px 10px", borderBottom: `1px solid ${T.border}`, borderLeft: noPrix ? "3px solid #f5a623" : "3px solid transparent", marginLeft: -10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: FONT.sm.size, fontWeight: 600, color: T.text }}>{l.libelle || "(sans libellé)"}</span>
                        <span style={{ fontSize: FONT.xs.size, color: noPrix ? "#f5a623" : T.textMuted, fontWeight: noPrix ? 700 : 400, whiteSpace: "nowrap" }}>
                          {l.quantite != null ? `${l.quantite}${l.unite ? " " + l.unite : ""}` : ""}
                          {l.prix_total != null ? ` · ${fmtEur(l.prix_total)} €` : (l.prix_unitaire != null ? ` · ${fmtEur(l.prix_unitaire)} €` : " · ⚠ prix manquant")}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: st.color, flexShrink: 0, minWidth: 70, textAlign: "right" }}>{st.label}</span>
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 10, color: T.textMuted, flexWrap: "wrap" }}>
                        {l.commande?.fournisseur_nom && <span>🏷️ {l.commande.fournisseur_nom}</span>}
                        {lot && <span>📦 {lot}</span>}
                        {ouv && <span>↳ {ouv}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.card }}>
                <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.textMuted }}>Total</span>
                <span style={{ fontSize: 16, fontWeight: 900, color: "#50c878" }}>{fmtEur(total)} € HT</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Détail générique d'un KPI (Vendu / Heures / Coût MO / FG / Marge) ── */}
      {kpiDetail && (() => {
        // Tout le CONTENU (titres, sous-titres, lignes, totaux, messages vides)
        // vient des objets Donnee du module. Ne restent ici que la présentation :
        // icône et couleurs par KPI.
        const margeColor = couleurMarge(margeChantier, margePctChantier);
        const PRESENTATION = {
          vendu:          { d: fin.venduHT,      icon: Banknote, color: "#f5c400" },
          heures:         { d: fin.heuresReelles, icon: Clock,   color: "#5b9cf6",
                            totalColor: couleurDepassement(heuresReellesTotalChantier, heuresVenduesChantier) || "#5b9cf6" },
          mo:             { d: fin.moReel,       icon: HardHat,  color: "#60a5fa" },
          fg:             { d: fin.fg,           icon: Percent,  color: "#a78bfa" },
          marge:          { d: fin.marge,        icon: margeChantier >= 0 ? TrendingUp : TrendingDown, color: margeColor },
          mo_prev:        { d: fin.moPrev,       icon: Target,   color: "#818cf8" },
          commandes_prev: { d: fin.matPrev,      icon: Boxes,    color: "#fb923c" },
          marge_prev:     { d: fin.margePrev,    icon: margePrevChantier >= 0 ? TrendingUp : TrendingDown,
                            color: couleurMarge(margePrevChantier, margePrevPctChantier) },
          trajet:         { d: fin.trajets,      icon: Car,      color: "#f59e0b" },
          indirect:       { d: fin.indirect,     icon: Clock,    color: "#f59e0b" },
        };
        const pres = PRESENTATION[kpiDetail];
        if (!pres) return null;
        const cfg = {
          icon: pres.icon, color: pres.color,
          title: pres.d.titre, subtitle: pres.d.sousTitre, empty: pres.d.vide,
          rows: pres.d.ventilation,
          total: pres.d.totalTexte != null ? pres.d.totalTexte : pres.d.valeur,
          totalLabel: pres.d.totalLabel,
          totalColor: pres.totalColor || pres.color,
          totalIsText: pres.d.totalTexte != null,
        };

        return <KpiDetailModal cfg={cfg} sousTitrePrefixe={chantier?.nom} T={T} onClose={() => setKpiDetail(null)}/>;
      })()}

      {moisModal && (
        <div onClick={() => setMoisModal(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
              width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0,
                background: "color-mix(in srgb, #5b9cf6 20%, transparent)", color: "#5b9cf6",
                display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon as={Calendar} size={16}/>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>Heures par mois</div>
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                  {chantier?.nom ? `${chantier.nom} · ` : ""}temps réel passé (tâches + trajets + indirect)
                </div>
              </div>
              <button onClick={() => setMoisModal(false)} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}><Icon as={X} size={18}/></button>
            </div>
            <div style={{ padding: "8px 12px" }}>
              {repriseHeures > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", marginBottom: 6,
                  border: `1px dashed ${T.border}`, borderRadius: RADIUS.md, background: T.card }}>
                  <Icon as={Clock} size={15} color={T.textMuted} style={{ flexShrink: 0 }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>Avant l'application</div>
                    <div style={{ fontSize: 10, color: T.textMuted }}>reprise d'antériorité{repriseCout > 0 ? ` · ${fmtEur(repriseCout)}` : ""}</div>
                  </div>
                  <span style={{ fontSize: FONT.sm.size, fontWeight: 900, color: T.textMuted, whiteSpace: "nowrap" }}>{fmtH(repriseHeures)} h</span>
                </div>
              )}
              {heuresParMois.length === 0 && repriseHeures === 0 ? (
                <div style={{ padding: "16px 8px", fontSize: FONT.sm.size, color: T.textMuted, fontStyle: "italic" }}>
                  Aucune heure pointée sur ce chantier.
                </div>
              ) : heuresParMois.map(m => {
                const ouvert = !!moisOuvert[m.mois];
                return (
                  <div key={m.mois} style={{ marginBottom: 6, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
                    <button onClick={() => setMoisOuvert(prev => ({ ...prev, [m.mois]: !prev[m.mois] }))}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "11px 14px",
                        background: ouvert ? T.card : "transparent", border: "none", cursor: "pointer",
                        fontFamily: "inherit", textAlign: "left" }}>
                      <Icon as={ChevronDown} size={15} color={T.textMuted}
                        style={{ transform: ouvert ? "none" : "rotate(-90deg)", transition: "transform .15s", flexShrink: 0 }}/>
                      <span style={{ flex: 1, fontSize: FONT.sm.size, fontWeight: 700, color: T.text, textTransform: "capitalize" }}>{m.label}</span>
                      <span style={{ fontSize: 11, color: T.textMuted }}>{m.ouvriers.length} ouvrier{m.ouvriers.length > 1 ? "s" : ""}</span>
                      <span style={{ fontSize: FONT.sm.size, fontWeight: 900, color: "#5b9cf6", whiteSpace: "nowrap", minWidth: 54, textAlign: "right" }}>{fmtH(m.heures)} h</span>
                    </button>
                    {ouvert && (
                      <div style={{ padding: "2px 14px 8px 39px" }}>
                        {m.ouvriers.map(o => (
                          <div key={o.nom} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: `1px solid ${T.border}` }}>
                            <Icon as={User} size={13} color={T.textMuted} style={{ flexShrink: 0 }}/>
                            <span style={{ flex: 1, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.nom}</span>
                            <span style={{ fontSize: 10, color: T.textMuted, whiteSpace: "nowrap" }}>{fmtEur(o.cout)}</span>
                            <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text, whiteSpace: "nowrap", minWidth: 48, textAlign: "right" }}>{fmtH(o.heures)} h</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.card }}>
              <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.textMuted }}>Total{repriseHeures > 0 ? " (reprise incluse)" : " pointé"}</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: "#5b9cf6" }}>{fmtH(heuresTotalTousMois + repriseHeures)} h</span>
            </div>
          </div>
        </div>
      )}

      {matPanel && (() => {
        const isLot = matPanel.type === "lot";
        const lot = isLot ? lots.find(l => l.id === matPanel.id) : null;
        const ouvrage = !isLot ? ouvrages.find(o => o.id === matPanel.id) : null;
        if (!isLot && !ouvrage) return null;
        const scopeLotId = isLot ? matPanel.id : (ouvrage?.lot_id || null);
        const titre = isLot ? (lot?.label || "Lot") : (ouvrage?.libelle || "Ouvrage");
        const ouvragesDuLot = ouvrages.filter(o => isLot ? (o.lot_id === matPanel.id) : (o.lot_id === ouvrage?.lot_id));
        const lignes = isLot ? lignesDuLot(matPanel.id) : lignesDeLOuvrage(ouvrage);
        const prevus = isLot
          ? ouvragesDuLot.flatMap(o => prevusOuvrage(o).map(p => ({ ...p, ouvrageLibelle: o.libelle })))
          : prevusOuvrage(ouvrage);
        const close = () => { setMatPanel(null); setRefForm({ materiau_id: "", libelle: "", quantite: "", prix: "", unite: "U" }); };
        const fmtEur = (n) => (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 });
        return (
          <div onClick={close}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
                width: "min(640px, 100%)", maxHeight: "88vh", overflow: "auto",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <Icon as={Receipt} size={18}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis" }}>Matériaux & commandes</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{isLot ? "Lot" : "Ouvrage"} · {titre}</div>
                </div>
                <button onClick={close} style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}><Icon as={X} size={18}/></button>
              </div>

              {/* ── Matériaux prévus de base ── */}
              <div style={{ padding: "12px 20px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .6, color: T.textMuted, marginBottom: 8 }}>
                  Matériaux prévus {prevus.length > 0 ? `(${prevus.length})` : ""}
                </div>
                {prevus.length === 0 ? (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>Aucun matériau lié aux ouvrages.</div>
                ) : prevus.map((p, i) => {
                  const ok = estCommande(p.materiau_id, lignes);
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ flex: 1, fontSize: FONT.sm.size, color: T.text }}>
                        {p.nom}
                        {p.quantite != null && <span style={{ color: T.textMuted }}> · {p.quantite} {p.unite}</span>}
                        {isLot && p.ouvrageLibelle && <span style={{ color: T.textMuted, fontSize: FONT.xs.size }}> — {p.ouvrageLibelle}</span>}
                      </span>
                      {ok
                        ? <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: FONT.xs.size, fontWeight: 800, color: "#22c55e" }}><Icon as={Check} size={12}/> commandé</span>
                        : <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>○ non commandé</span>}
                    </div>
                  );
                })}
              </div>

              {/* ── Références commandées & liées ── */}
              <div style={{ padding: "4px 20px 12px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .6, color: T.textMuted, margin: "6px 0 8px" }}>
                  Références commandées {lignes.length > 0 ? `(${lignes.length})` : ""}
                </div>
                {lignes.length === 0 ? (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>Aucune commande liée pour l'instant.</div>
                ) : lignes.map(l => {
                  const st = statutLigne(l);
                  return (
                    <div key={l.id} style={{ padding: "8px 0", borderBottom: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: FONT.sm.size, fontWeight: 600, color: T.text }}>{l.libelle || "(sans libellé)"}</span>
                        <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                          {l.quantite != null ? `${l.quantite}${l.unite ? " " + l.unite : ""}` : ""}
                          {l.prix_total != null ? ` · ${fmtEur(l.prix_total)} €` : (l.prix_unitaire != null ? ` · ${fmtEur(l.prix_unitaire)} €` : "")}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: st.color, flexShrink: 0 }}>{st.label}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <span style={{ fontSize: 9, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5 }}>Ouvrage</span>
                        <select value={l.ouvrage_id || ""} onChange={e => affecterLigneOuvrage(l.id, e.target.value)}
                          style={{ flex: 1, padding: "4px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                            background: T.fieldBg || T.card, color: T.text, fontSize: FONT.xs.size, fontFamily: "inherit", outline: "none" }}>
                          <option value="">— Lot uniquement —</option>
                          {ouvragesDuLot.map(o => <option key={o.id} value={o.id}>{o.libelle || "(sans libellé)"}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ── Ajouter une référence ── */}
              <div style={{ padding: "12px 20px 18px", borderTop: `1px solid ${T.border}`, background: T.card }}>
                <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .6, color: T.textMuted, marginBottom: 8 }}>
                  Ajouter une référence {!isLot && <span style={{ color: T.textMuted, fontWeight: 600, textTransform: "none" }}>· liée à cet ouvrage</span>}
                </div>
                <select value={refForm.materiau_id}
                  onChange={e => {
                    const m = matBiblioById[String(e.target.value)];
                    setRefForm(f => ({ ...f, materiau_id: e.target.value,
                      libelle: m ? (m.nom || "") : f.libelle,
                      unite: m?.unite || f.unite || "U",
                      prix: m?.prix_unitaire != null ? String(m.prix_unitaire) : f.prix }));
                  }}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                    background: T.fieldBg || T.surface, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none", marginBottom: 8 }}>
                  <option value="">— Matériau de la bibliothèque (optionnel) —</option>
                  {materiauxBiblio.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
                </select>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={refForm.libelle} onChange={e => setRefForm(f => ({ ...f, libelle: e.target.value }))}
                    placeholder="Libellé (ou saisie libre)"
                    style={{ flex: 1, padding: "8px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                      background: T.fieldBg || T.surface, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none" }}/>
                  <input type="number" step="0.5" min="0" value={refForm.quantite} onChange={e => setRefForm(f => ({ ...f, quantite: e.target.value }))}
                    placeholder="Qté"
                    style={{ width: 70, padding: "8px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                      background: T.fieldBg || T.surface, color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none" }}/>
                  <input type="number" step="0.01" min="0" value={refForm.prix} onChange={e => setRefForm(f => ({ ...f, prix: e.target.value }))}
                    placeholder="PU €"
                    style={{ width: 80, padding: "8px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                      background: T.fieldBg || T.surface, color: "#50c878", fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none" }}/>
                </div>
                <button disabled={refSaving || !(refForm.libelle.trim() || refForm.materiau_id)}
                  onClick={() => ajouterReference(scopeLotId, isLot ? null : ouvrage.id)}
                  style={{ marginTop: 10, width: "100%", padding: "9px 14px", borderRadius: RADIUS.md, border: "none",
                    background: (refSaving || !(refForm.libelle.trim() || refForm.materiau_id)) ? T.border : acc.accent,
                    color: "#fff", fontWeight: 800, fontSize: FONT.sm.size, fontFamily: "inherit",
                    cursor: (refSaving || !(refForm.libelle.trim() || refForm.materiau_id)) ? "not-allowed" : "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon as={Plus} size={14}/> {refSaving ? "Ajout…" : "Ajouter (statut à compléter)"}
                </button>
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 6, fontStyle: "italic" }}>
                  La référence apparaîtra dans la page Commandes (à compléter) et basculera en « passée » une fois complétée/facturée.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {rapportModal && (() => {
        const r = rapportModal.rapport;
        const cibleNom = (rapportModal.tacheNom || "").trim().toLowerCase();
        const taches = Array.isArray(r.taches) ? r.taches : [];
        const statutColor = (s) => s === "faite" ? "#22c55e" : s === "en_cours" ? "#eab308" : s === "non_faite" ? "#e05c5c" : T.textMuted;
        const statutLbl = (s) => s === "faite" ? "Faite" : s === "en_cours" ? "En cours" : s === "non_faite" ? "Non faite" : (s || "—");
        return (
          <div onClick={() => setRapportModal(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
                width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <Icon as={FileText} size={18}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>Dernier compte rendu</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, display: "flex", gap: 12, marginTop: 2, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={User} size={11}/> {r.ouvrier || "—"}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={Calendar} size={11}/> {r.date_rapport || "—"}</span>
                    {r.chantier_nom && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={Building2} size={11}/> {r.chantier_nom}</span>}
                  </div>
                </div>
                <button onClick={() => setRapportModal(null)}
                  style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}>
                  <Icon as={X} size={18}/>
                </button>
              </div>
              <div style={{ padding: "12px 20px" }}>
                {taches.length === 0 ? (
                  <div style={{ color: T.textMuted, fontStyle: "italic", fontSize: FONT.sm.size }}>Aucune tâche dans ce compte rendu.</div>
                ) : taches.map((x, i) => {
                  const isCible = cibleNom && (x.planifie || x.nom || "").trim().toLowerCase() === cibleNom;
                  return (
                    <div key={i} style={{
                      padding: "10px 12px", marginBottom: 8, borderRadius: 10,
                      background: isCible ? "color-mix(in srgb, #5b8af5 16%, transparent)" : T.card,
                      border: `1px solid ${isCible ? "rgba(91,138,245,0.5)" : T.border}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontWeight: 700, fontSize: FONT.sm.size, color: T.text }}>{x.planifie || x.nom || "(sans nom)"}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, color: statutColor(x.statut) }}>{statutLbl(x.statut)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: FONT.xs.size, color: T.textMuted }}>
                        {x.heures_reelles != null && x.heures_reelles !== "" && <span>{x.heures_reelles}h réelles</span>}
                        {x.avancement != null && x.avancement !== "" && <span>{x.avancement}%</span>}
                      </div>
                      {x.remarque && <div style={{ marginTop: 6, fontSize: FONT.xs.size, color: T.textSub, fontStyle: "italic" }}>« {x.remarque} »</div>}
                    </div>
                  );
                })}
                {r.remarque && (
                  <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, background: T.card, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5, color: T.textMuted, marginBottom: 4 }}>Remarque générale</div>
                    <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>{r.remarque}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Modale : TOUS les comptes rendus liés à une tâche (vue Chronologique) ── */}
      {rapportsModal && (() => {
        const cibleNom = (rapportsModal.tacheNom || "").trim().toLowerCase();
        const cibleId = rapportsModal.tacheId;
        const list = rapportsModal.rapports || [];
        const statutColor = (s) => s === "faite" ? "#22c55e" : s === "en_cours" ? "#eab308" : s === "non_faite" ? "#e05c5c" : T.textMuted;
        const statutLbl = (s) => s === "faite" ? "Faite" : s === "en_cours" ? "En cours" : s === "non_faite" ? "Non faite" : (s || "—");
        // Entrées de tâche d'un rapport qui correspondent à la tâche ciblée
        // (par tache_id pour les tâches V2, sinon par nom pour les migrées V1).
        const entriesCible = (r) => (Array.isArray(r.taches) ? r.taches : []).filter(x =>
          (cibleId != null && x.tache_id != null && String(x.tache_id) === String(cibleId)) ||
          (cibleNom && (x.planifie || x.nom || "").trim().toLowerCase() === cibleNom));
        return (
          <div onClick={() => setRapportsModal(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 800,
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
                width: "min(600px, 100%)", maxHeight: "85vh", overflow: "auto",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
                <Icon as={FileText} size={18}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Comptes rendus — {rapportsModal.tacheNom || "tâche"}
                  </div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>
                    {list.length} compte{list.length > 1 ? "s" : ""} rendu{list.length > 1 ? "s" : ""} lié{list.length > 1 ? "s" : ""}
                  </div>
                </div>
                <button onClick={() => setRapportsModal(null)}
                  style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", flexShrink: 0 }}>
                  <Icon as={X} size={18}/>
                </button>
              </div>
              <div style={{ padding: "12px 20px" }}>
                {list.length === 0 ? (
                  <div style={{ color: T.textMuted, fontStyle: "italic", fontSize: FONT.sm.size }}>Aucun compte rendu lié à cette tâche.</div>
                ) : list.map((r, ri) => {
                  const entries = entriesCible(r);
                  return (
                    <div key={r.id || ri} style={{
                      marginBottom: 12, borderRadius: 12,
                      border: `1px solid ${T.border}`, background: T.card, overflow: "hidden",
                    }}>
                      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 12, flexWrap: "wrap", fontSize: FONT.xs.size, color: T.textMuted }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 700, color: T.textSub }}><Icon as={Calendar} size={12}/> {r.date_rapport || "—"}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={User} size={12}/> {r.ouvrier || "—"}</span>
                        {r.chantier_nom && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Building2} size={12}/> {r.chantier_nom}</span>}
                      </div>
                      <div style={{ padding: "10px 12px" }}>
                        {(entries.length ? entries : []).map((x, i) => (
                          <div key={i} style={{ padding: "8px 10px", marginBottom: entries.length > 1 ? 6 : 0, borderRadius: 8, background: T.surface, border: `1px solid ${T.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ flex: 1, fontWeight: 700, fontSize: FONT.sm.size, color: T.text }}>{x.planifie || x.nom || "(sans nom)"}</span>
                              <span style={{ fontSize: 10, fontWeight: 800, color: statutColor(x.statut) }}>{statutLbl(x.statut)}</span>
                            </div>
                            <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: FONT.xs.size, color: T.textMuted }}>
                              {x.heures_reelles != null && x.heures_reelles !== "" && <span>{x.heures_reelles}h réelles</span>}
                              {x.avancement != null && x.avancement !== "" && <span>{x.avancement}%</span>}
                            </div>
                            {x.remarque && <div style={{ marginTop: 6, fontSize: FONT.xs.size, color: T.textSub, fontStyle: "italic" }}>« {x.remarque} »</div>}
                          </div>
                        ))}
                        {r.remarque && (
                          <div style={{ marginTop: entries.length ? 8 : 0, fontSize: FONT.xs.size, color: T.textSub }}>
                            <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5, color: T.textMuted }}>Remarque générale : </span>
                            {r.remarque}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {editingOuvrageId && (() => {
        const o = ouvrages.find(x => x.id === editingOuvrageId);
        if (!o) return null;
        const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
        return (
          <ItemEditModal
            title="Modifier l'ouvrage"
            color={lotColor}
            T={T} accent={acc.accent}
            onClose={() => setEditingOuvrageId(null)}
            onDelete={() => { deleteOuvrage(o.id); setEditingOuvrageId(null); }}
          >
            <ModalField label="Libellé">
              <input autoFocus value={o.libelle || ""}
                onChange={e => updateOuvrage(o.id, { libelle: e.target.value })}
                placeholder="Nom de l'ouvrage" style={{ ...modalInp(T), fontWeight: 600 }}/>
            </ModalField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <ModalField label="Heures vendues">
                <input type="number" step="0.5" min="0" value={o.heures_devis ?? ""}
                  onChange={e => setOuvrageHeuresDevis(o.id, e.target.value === "" ? null : parseFloat(e.target.value))}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
              <ModalField label="Quantité">
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" step="0.01" min="0" value={o.quantite ?? ""}
                    onChange={e => updateOuvrage(o.id, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    placeholder="0" style={{ ...modalInp(T), flex: 1 }}/>
                  <input value={o.unite || ""}
                    onChange={e => updateOuvrage(o.id, { unite: e.target.value })}
                    placeholder="U" style={{ ...modalInp(T), width: 56, textAlign: "center" }}/>
                </div>
              </ModalField>
              <ModalField label="Prix HT (€)">
                <input type="number" step="0.01" min="0" value={o.prix_ht ?? ""}
                  onChange={e => updateOuvrage(o.id, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
            </div>
            <ModalField label="Coût matériaux (€)">
              <input type="number" step="0.01" min="0" value={o.cout_materiaux ?? ""}
                onChange={e => updateOuvrage(o.id, { cout_materiaux: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="0" style={modalInp(T)}/>
            </ModalField>

            {/* ── Matériaux liés (depuis la biblio ouvrage) ─────────────── */}
            {(() => {
              const liens = (o.materiaux_liens || []).filter(ml => ml && ml.materiau_id != null);
              if (liens.length === 0) return null;
              const qOuvrage = parseFloat(o.quantite) || 0;
              const lignes = liens.map(ml => {
                const m = materiauxBiblio.find(x => x.id === ml.materiau_id);
                const qParU = parseFloat(ml.quantite) || 0;
                const prixU = m ? (parseFloat(m.prix_unitaire) || 0) : 0;
                const qTot  = qOuvrage * qParU;
                const cout  = qTot * prixU;
                return { m, ml, qParU, prixU, qTot, cout };
              });
              const totalCout = lignes.reduce((s, l) => s + l.cout, 0);
              return (
                <ModalField label={`Matériaux liés (${liens.length})`}>
                  <div style={{
                    background: T.card, border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md, overflow: "hidden",
                  }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 70px 90px 80px",
                      gap: 8, padding: "6px 10px",
                      background: T.surface, borderBottom: `1px solid ${T.border}`,
                      fontSize: 10, fontWeight: 700, color: T.textMuted,
                      textTransform: "uppercase", letterSpacing: 0.6,
                    }}>
                      <div>Matériau</div>
                      <div style={{ textAlign: "center" }}>Qté/u</div>
                      <div style={{ textAlign: "center" }}>Qté totale</div>
                      <div style={{ textAlign: "right" }}>Coût</div>
                    </div>
                    {lignes.map((l, i) => (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "1fr 70px 90px 80px",
                        gap: 8, padding: "7px 10px",
                        borderTop: i === 0 ? "none" : `1px solid ${T.sectionDivider}`,
                        fontSize: FONT.xs.size + 1, color: T.text, alignItems: "center",
                      }}>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.m ? l.m.nom : <span style={{ color: T.textMuted, fontStyle: "italic" }}>Matériau introuvable</span>}
                        </div>
                        <div style={{ textAlign: "center", color: T.textSub }}>
                          {l.qParU || "—"}
                        </div>
                        <div style={{ textAlign: "center", color: T.textSub }}>
                          {l.qTot > 0 ? `${l.qTot.toFixed(2)} ${l.m?.unite || ""}` : "—"}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 700 }}>
                          {l.cout > 0 ? `${l.cout.toFixed(2)} €` : "—"}
                        </div>
                      </div>
                    ))}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 10px", borderTop: `1px solid ${T.border}`,
                      background: T.surface,
                    }}>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600 }}>
                        Total calculé
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>
                          {totalCout.toFixed(2)} €
                        </div>
                        <button
                          onClick={() => updateOuvrage(o.id, { cout_materiaux: parseFloat(totalCout.toFixed(2)) })}
                          disabled={!(totalCout > 0)}
                          title="Recopier ce total dans le champ Coût matériaux"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "4px 10px", borderRadius: RADIUS.sm, border: "none",
                            background: totalCout > 0 ? acc.accent : T.border,
                            color: acc.onAccent || "#fff",
                            fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                            cursor: totalCout > 0 ? "pointer" : "default",
                            opacity: totalCout > 0 ? 1 : .5,
                          }}>
                          Recalculer
                        </button>
                      </div>
                    </div>
                  </div>
                </ModalField>
              );
            })()}

            <ModalField label="Lot">
              <select value={o.lot_id || ""}
                onChange={e => updateOuvrage(o.id, { lot_id: e.target.value || null })}
                style={{ ...modalInp(T), cursor: "pointer" }}>
                <option value="">— Sans lot —</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </ModalField>
          </ItemEditModal>
        );
      })()}

      {/* ── Modale édition tâche ── */}
      {editingTache && (() => {
        const o = ouvrages.find(x => x.id === editingTache.ouvrageId);
        const t = o?.taches?.find(x => x.id === editingTache.tacheId);
        if (!t) return null;
        const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
        return (
          <ItemEditModal
            title="Modifier la tâche"
            color={lotColor}
            T={T} accent={acc.accent}
            onClose={() => setEditingTache(null)}
            onDelete={() => { deleteTache(o.id, t.id); setEditingTache(null); }}
          >
            <ModalField label="Description">
              <textarea autoFocus value={t.nom || ""}
                onChange={e => updateTache(o.id, t.id, { nom: e.target.value })}
                placeholder="Description de la tâche" rows={2}
                style={{ ...modalInp(T), fontWeight: 600, resize: "vertical", minHeight: 60 }}/>
            </ModalField>
            {/* Rattachement : permet de reclasser une tâche vers le bon ouvrage
                (ex. tâches atterries dans « Divers / hors devis »). La tâche
                garde son id, ses pointages la suivent. */}
            <ModalField label="Ouvrage">
              <select value={o.id}
                onChange={e => {
                  const toId = e.target.value;
                  if (moveTacheToOuvrage(o.id, t.id, toId)) setEditingTache({ ouvrageId: toId, tacheId: t.id });
                }}
                style={{ ...modalInp(T), cursor: "pointer" }}>
                {ouvrages.map(ov => {
                  const lotLabel = ov.lot_id ? lots.find(l => l.id === ov.lot_id)?.label : null;
                  return (
                    <option key={ov.id} value={ov.id}>
                      {(ov.libelle || "(sans libellé)") + (lotLabel ? ` — ${lotLabel}` : "")}
                    </option>
                  );
                })}
              </select>
            </ModalField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <ModalField label="Heures estimées">
                <input type="number" step="0.5" min="0" value={t.heures_estimees ?? ""}
                  onChange={e => updateTache(o.id, t.id, { heures_estimees: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
              <ModalField label="Heures réelles">
                <input type="number" step="0.5" min="0" value={tacheHeuresReelles(t) || ""}
                  readOnly={tachePointages(t).length > 0}
                  title={tachePointages(t).length > 0 ? "Heures issues du registre de pointage (validation de fin de journée) — non modifiable ici" : undefined}
                  onChange={e => { if (tachePointages(t).length > 0) return; updateTache(o.id, t.id, { heures_reelles: e.target.value === "" ? null : parseFloat(e.target.value) }); }}
                  placeholder="0"
                  style={{ ...modalInp(T), opacity: tachePointages(t).length > 0 ? 0.65 : 1, cursor: tachePointages(t).length > 0 ? "not-allowed" : "text" }}/>
                {tachePointages(t).length > 0 && (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 4, fontStyle: "italic" }}>
                    Depuis le registre de pointage ({tachePointages(t).length} pointage{tachePointages(t).length > 1 ? "s" : ""})
                  </div>
                )}
              </ModalField>
              <ModalField label="Avancement (%)">
                <input type="number" step="5" min="0" max="100" value={t.avancement ?? ""}
                  onChange={e => updateTache(o.id, t.id, { avancement: e.target.value === "" ? 0 : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
            </div>
            {/* Ventilation du coût MO réel depuis le registre de pointage :
                qui a réellement travaillé, combien d'heures et à quel taux. */}
            {tachePointages(t).length > 0 && (() => {
              const detail = tachePointagesParOuvrier(t);
              const total = detail.reduce((s, d) => s + d.cout, 0);
              return (
                <div style={{
                  background: T.fieldBg || T.card, border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md, padding: "10px 12px",
                }}>
                  <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>
                    Réalisé par (registre de pointage)
                  </div>
                  {detail.map(d => (
                    <div key={d.ouvrier} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.xs.size + 1, color: T.text, marginBottom: 4 }}>
                      <span style={{ flex: 1, fontWeight: 700 }}>{d.ouvrier}</span>
                      <span style={{ color: T.textSub }}>{fmtH(d.heures)}h × {d.taux.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €</span>
                      <span style={{ fontWeight: 800, minWidth: 64, textAlign: "right" }}>{fmtEur(d.cout)}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${T.border}`, fontSize: FONT.sm.size }}>
                    <span style={{ flex: 1, fontWeight: 800, color: T.textSub }}>Coût MO total</span>
                    <span style={{ fontWeight: 800, color: acc.accent }}>{fmtEur(total)}</span>
                  </div>
                </div>
              );
            })()}
            <ModalField label={`Ouvriers assignés${(t.ouvriers||[]).length > 0 ? ` (${t.ouvriers.length})` : ""}`}>
              {ouvriers.length === 0 ? (
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>
                  Aucun ouvrier configuré — ajoute-en dans Réglages → Ouvriers.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ouvriers.map(nom => {
                    const selected = (t.ouvriers || []).includes(nom);
                    return (
                      <button key={nom}
                        onClick={() => toggleOuvrier(o.id, t.id, nom)}
                        style={{
                          padding: "5px 12px", borderRadius: RADIUS.pill,
                          border: `1px solid ${selected ? acc.accent : T.border}`,
                          background: selected ? acc.bg10 : "transparent",
                          color: selected ? acc.accent : T.textSub,
                          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                          cursor: "pointer", transition: "all .12s",
                        }}>
                        {nom}
                      </button>
                    );
                  })}
                </div>
              )}
            </ModalField>

            {/* ── Prédécesseurs (ordre logique — vue Rang, Point 4a) ── */}
            <ModalField label="Prédécesseurs (ordre logique — vue Rang)">
              <PredsEditor key={t.id}
                ouvrages={ouvrages} groupes={chronoGroupes} tacheId={t.id}
                T={T} acc={acc} appliquerPredecesseurs={appliquerPredecesseurs}/>
            </ModalField>

            {/* ── Section Planification ── */}
            <div style={{
              marginTop: 6, paddingTop: 14,
              borderTop: `1px dashed ${T.border}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
                color: T.textMuted, marginBottom: 10,
              }}>
                Envoyer dans le planning semaine
              </div>
              {t.date_prevue && (
                <div style={{
                  fontSize: FONT.xs.size + 1, color: T.textSub, marginBottom: 10,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Icon as={Check} size={11} color="#22c55e"/>
                  <span>Déjà planifié le <strong style={{ color: T.text }}>{new Date(t.date_prevue).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></span>
                  <button onClick={() => updateTache(o.id, t.id, { date_prevue: "" })}
                    style={{
                      marginLeft: "auto", background: "transparent", border: `1px solid ${T.border}`,
                      color: T.textMuted, borderRadius: RADIUS.sm, padding: "2px 8px",
                      fontFamily: "inherit", fontSize: FONT.xs.size, cursor: "pointer",
                    }}>
                    Effacer la date
                  </button>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr auto", gap: 8, alignItems: "flex-end" }}>
                <ModalField label="Semaine">
                  <select value={planifSemaine} onChange={e => setPlanifSemaine(e.target.value)}
                    style={{ ...modalInp(T), cursor: "pointer" }}>
                    {semainesFutures.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </ModalField>
                <ModalField label="Jour">
                  <select value={planifJour} onChange={e => setPlanifJour(e.target.value)}
                    style={{ ...modalInp(T), cursor: "pointer" }}>
                    {JOURS_SEM.map(j => <option key={j} value={j}>{j}</option>)}
                  </select>
                </ModalField>
                <ModalField label="Durée (h)">
                  <input type="number" step="0.25" min="0" value={planifDuree}
                    onChange={e => setPlanifDuree(e.target.value)}
                    placeholder="0" style={modalInp(T)}/>
                </ModalField>
                <button onClick={() => envoyerDansPlanning(o.id, t)}
                  disabled={planifSaving}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "9px 16px", borderRadius: RADIUS.md, border: "none",
                    background: planifSaving ? T.border : acc.accent,
                    color: planifSaving ? T.textMuted : "#000",
                    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                    cursor: planifSaving ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  <Icon as={Check} size={13}/>
                  {planifSaving ? "Envoi…" : "Envoyer"}
                </button>
              </div>
              {planifMsg && (
                <div style={{
                  marginTop: 8, padding: "6px 10px", borderRadius: RADIUS.sm,
                  fontSize: FONT.xs.size + 1, fontWeight: 700,
                  background: planifMsg.ok ? "rgba(34,197,94,0.10)" : "rgba(225,90,90,0.10)",
                  border: `1px solid ${planifMsg.ok ? "rgba(34,197,94,0.30)" : "rgba(225,90,90,0.30)"}`,
                  color: planifMsg.ok ? "#22c55e" : "#e15a5a",
                }}>
                  {planifMsg.txt}
                </div>
              )}
            </div>
          </ItemEditModal>
        );
      })()}
    </div>
  );
}

// ─── VUE CHRONOLOGIQUE ────────────────────────────────────────────────────────
// Reprend TOUTES les tâches créées (tous ouvrages) et permet de :
//  • créer des groupes de tâches libres (nom + couleur),
//  • ranger/ordonner tâches ET jalons par glisser-déposer (dans/entre groupes),
//  • intercaler des jalons (repères datés : livraison, réception…),
//  • dater chaque tâche (écrit date_prevue, partagé avec le Gantt),
//  • ouvrir tous les comptes rendus liés à une tâche.
// Persistance : groupes → meta.chrono_groupes ; jalons → meta.chrono_jalons ;
// affectation + ordre des tâches → sur la tâche (chrono_groupe_id /
// chrono_ordre) via applyChrono ; date → updateTache.
const CHRONO_PALETTE = ["#5b8af5", "#22c55e", "#f5a623", "#e15a5a", "#a855f7", "#14b8a6", "#ec4899", "#f97316"];

// ─── ÉDITEUR DE PRÉDÉCESSEURS (Point 4a) ─────────────────────────────────────
// Partagé entre la modale de tâche et la vue Rang. Application IMMÉDIATE à
// chaque geste via appliquerPredecesseurs (garde anti-cycle + un seul
// patchTaches) — comme les autres champs de la modale. Le défaut n'est jamais
// écrit : « Revenir au défaut » remet le champ à null.
function PredsEditor({ ouvrages, groupes, tacheId, T, acc, appliquerPredecesseurs }) {
  const [search, setSearch] = useState("");
  const id = String(tacheId);
  const tache = useMemo(() => {
    for (const o of ouvrages || []) { const t = (o.taches || []).find(x => String(x.id) === id); if (t) return t; }
    return null;
  }, [ouvrages, id]);
  const effectifs = useMemo(() => predecesseursEffectifs(ouvrages, groupes), [ouvrages, groupes]);
  const { groupesTries, parGroupe, horsGroupe } = useMemo(
    () => organiserTaches(ouvrages, groupes), [ouvrages, groupes]);

  if (!tache) return null;
  const explicite = Array.isArray(tache.predecesseurs);
  const courants = new Set((effectifs.get(id)?.ids || []).map(String));

  const basculer = (predId) => {
    const next = new Set(courants);
    if (next.has(predId)) next.delete(predId); else next.add(predId);
    appliquerPredecesseurs({ [id]: [...next] });
  };

  const norm = (s) => (s || "").toString().toLowerCase();
  const filtre = norm(search);
  const sections = [
    ...groupesTries.map(g => ({ g, taches: (parGroupe.get(g.id) || []) })),
    { g: { id: "__hors__", nom: "À classer", couleur: "#888" }, taches: horsGroupe },
  ].map(s => ({
    ...s,
    taches: s.taches.filter(t => String(t.id) !== id && (!filtre || norm(t.nom).includes(filtre))),
  })).filter(s => s.taches.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{
          padding: "1px 8px", borderRadius: 999, fontWeight: 800, fontSize: FONT.xs.size - 1,
          background: explicite ? acc.bg10 : "transparent",
          color: explicite ? acc.accent : T.textMuted,
          border: `1px solid ${explicite ? acc.border : T.border}`,
        }}>{explicite ? "saisi" : "auto (chaînage par défaut)"}</span>
        <button onClick={() => appliquerPredecesseurs({ [id]: [] })}
          title="Aucun prédécesseur : la tâche peut se faire dès le départ"
          style={{ padding: "3px 10px", borderRadius: 999, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
          Parallèle libre
        </button>
        {explicite && (
          <button onClick={() => appliquerPredecesseurs({ [id]: null })}
            title="Efface la saisie : le chaînage par défaut (déduit de la Chrono) reprend la main"
            style={{ padding: "3px 10px", borderRadius: 999, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
            Revenir au défaut
          </button>
        )}
      </div>
      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une tâche…"
        style={{
          width: "100%", padding: "6px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
          background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none",
        }}/>
      <div style={{ maxHeight: 180, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.sm, padding: "6px 8px" }}>
        {sections.length === 0 && (
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>Aucune tâche ne correspond.</div>
        )}
        {sections.map(({ g, taches }) => (
          <div key={g.id} style={{ marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size - 1, fontWeight: 800, letterSpacing: .4, textTransform: "uppercase", color: T.textMuted, margin: "3px 0" }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: g.couleur || "#888", display: "inline-block" }}/>
              {g.nom}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {taches.map(t => {
                const sel = courants.has(String(t.id));
                return (
                  <button key={t.id} onClick={() => basculer(String(t.id))}
                    style={{
                      padding: "2px 9px", borderRadius: 999, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      border: `1px solid ${sel ? acc.accent : T.border}`,
                      background: sel ? acc.bg10 : "transparent",
                      color: sel ? acc.accent : T.textSub,
                      fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: sel ? 800 : 600, cursor: "pointer",
                    }}>
                    {t.nom || "(sans nom)"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
        Cocher/décocher enregistre aussitôt. Une saisie qui créerait une boucle est refusée.
      </div>
    </div>
  );
}

// ─── VUE RANG (Point 4a) — l'ordre logique déduit des prédécesseurs ──────────
// Une bande par rang : les tâches d'une même bande peuvent se faire EN MÊME
// TEMPS. Le chaînage vient du calcul pur de rang.js (défaut déduit de la
// Chrono, exceptions via tache.predecesseurs). Le clic sur une carte ouvre la
// modale de la tâche (qui contient l'éditeur de prédécesseurs) ; la case de
// sélection permet les actions groupées : parallèles libres, retour au
// défaut, même prédécesseur, chaîner la sélection — chacune en UN SEUL
// patchTaches gardé anti-cycle (appliquerPredecesseurs).
function RangView({ ouvrages, groupes, acc, T, onClickTache, appliquerPredecesseurs, applyChrono }) {
  const calc = useMemo(() => calculerRangs(ouvrages, groupes), [ouvrages, groupes]);
  const effectifs = useMemo(() => predecesseursEffectifs(ouvrages, groupes), [ouvrages, groupes]);
  const [selection, setSelection] = useState(() => new Set());
  const [picker, setPicker] = useState(false);       // choix du prédécesseur commun
  const [pickerSearch, setPickerSearch] = useState("");
  const [apercu, setApercu] = useState(false);       // aperçu du réordonnancement
  // Réordonnancement proposé (Prompt 5) : jamais appliqué sans confirmation.
  const proposition = useMemo(() => reordonnancementPropose(ouvrages, groupes), [ouvrages, groupes]);
  const nbDeplacements = proposition.changements.reduce((s, c) => s + c.deplacements.length, 0);
  const confirmerReordonnancement = () => {
    applyChrono(proposition.assignments);
    setApercu(false);
  };
  const index = useMemo(() => {
    const m = new Map();
    (ouvrages || []).forEach(o => (o.taches || []).forEach(t => { if (t?.id != null) m.set(String(t.id), { tache: t, ouvrageId: o.id }); }));
    return m;
  }, [ouvrages]);
  const gById = useMemo(() => new Map((groupes || []).map(g => [g.id, g])), [groupes]);

  const basculerSelection = (id) => setSelection(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const patchSelection = (valeur) => {
    if (selection.size === 0) return;
    appliquerPredecesseurs(Object.fromEntries([...selection].map(id => [id, valeur])));
  };
  // Chaîner la sélection dans l'ordre manuel : la 2e suit la 1re, etc.
  // La première garde ses prédécesseurs actuels (on ne chaîne QUE la suite).
  const chainerSelection = () => {
    if (selection.size < 2) return;
    const pos = positionsManuelles(ouvrages, groupes);
    const ordonnes = [...selection].sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity));
    const patch = {};
    for (let i = 1; i < ordonnes.length; i++) patch[ordonnes[i]] = [ordonnes[i - 1]];
    appliquerPredecesseurs(patch);
  };
  const memePredecesseur = (predId) => {
    setPicker(false); setPickerSearch("");
    appliquerPredecesseurs(Object.fromEntries([...selection].map(id => [id, [String(predId)]])));
  };

  const { parRang, sources, incoherences } = calc;
  const { cycles, bloquees, ordresContradictoires, introuvables } = incoherences;
  const nbInco = cycles.length + bloquees.length + ordresContradictoires.length + introuvables.length;
  const horsChaine = [...sources.entries()].filter(([, s]) => s === "hors_chaine").map(([id]) => id);

  const nomDe = (id) => index.get(String(id))?.tache?.nom || "(tâche supprimée)";
  const clic = (id) => { const e = index.get(String(id)); if (e) onClickTache(e.ouvrageId, e.tache.id); };

  // Puce cliquable vers une tâche (bandeau d'incohérences).
  const puce = (id) => (
    <button key={id} onClick={() => clic(id)} title="Ouvrir la tâche"
      style={{
        display: "inline-flex", alignItems: "center", padding: "1px 8px", borderRadius: 999,
        border: `1px solid ${T.border}`, background: T.surface, color: T.text,
        fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer",
      }}>{nomDe(id)}</button>
  );

  // Carte d'une tâche dans sa bande de rang.
  const carte = (id) => {
    const e = index.get(String(id));
    if (!e) return null;
    const t = e.tache;
    const g = gById.get(t.chrono_groupe_id);
    const src = sources.get(String(id));
    const preds = effectifs.get(String(id))?.ids || [];
    const h = parseFloat(t.heures_vendues) || parseFloat(t.heures_estimees) || 0;
    return (
      <div key={id} onClick={() => clic(id)}
        title={preds.length ? `Après : ${preds.map(nomDe).join(", ")}` : "Aucun prédécesseur"}
        style={{
          borderLeft: `4px solid ${g?.couleur || "#888"}`, border: `1px solid ${T.border}`,
          borderLeftWidth: 4, borderLeftColor: g?.couleur || "#888",
          borderRadius: RADIUS.sm, background: T.surface, padding: "7px 10px",
          minWidth: 180, maxWidth: 280, cursor: "pointer",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <input type="checkbox" checked={selection.has(String(id))}
            onClick={e => e.stopPropagation()}
            onChange={() => basculerSelection(String(id))}
            title="Sélectionner pour une action groupée"
            style={{ margin: 0, cursor: "pointer", flexShrink: 0 }}/>
          <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {t.nom || "(sans nom)"}
          </div>
        </div>
        <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {g?.nom || "à classer"}{h ? ` · ${fmtH(h)}` : ""}
        </div>
        <div style={{ fontSize: FONT.xs.size, marginTop: 4, display: "flex", alignItems: "baseline", gap: 5, minWidth: 0 }}>
          <span style={{
            flexShrink: 0, padding: "0 6px", borderRadius: 999, fontWeight: 800, fontSize: FONT.xs.size - 1,
            background: src === "explicite" ? acc.bg10 : "transparent",
            color: src === "explicite" ? acc.accent : T.textMuted,
            border: `1px solid ${src === "explicite" ? acc.border : T.border}`,
          }} title={src === "explicite" ? "Prédécesseurs saisis sur la tâche" : "Chaînage par défaut, déduit de l'ordre de la Chronologique"}>
            {src === "explicite" ? "saisi" : "auto"}
          </span>
          <span style={{ color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preds.length === 0 ? "aucun prédécesseur" : `← ${preds.map(nomDe).join(", ")}`}
          </span>
        </div>
      </div>
    );
  };

  if (parRang.length === 0 && horsChaine.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
        <div style={{ textAlign: "center", color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.7 }}>
          <Icon as={Network} size={30} style={{ color: T.textMuted }} /><br />
          Aucune tâche à ranger.<br />
          Organise d'abord la vue <strong>Chronologique</strong> (groupes + ordre) : le chaînage par défaut s'en déduit tout seul.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 18px", minHeight: 0 }}>
      {/* Message d'intention + légende des badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12, fontSize: FONT.xs.size + 1, color: T.textSub }}>
        <span><strong style={{ color: T.text }}>Les tâches d'un même rang peuvent se faire en même temps.</strong></span>
        <span><span style={{ padding: "0 6px", borderRadius: 999, border: `1px solid ${T.border}`, color: T.textMuted, fontWeight: 800, fontSize: FONT.xs.size - 1 }}>auto</span> = déduit de l'ordre de la Chrono</span>
        <span><span style={{ padding: "0 6px", borderRadius: 999, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, fontSize: FONT.xs.size - 1 }}>saisi</span> = prédécesseurs renseignés</span>
        {proposition.changements.length > 0 && (
          <button onClick={() => setApercu(true)}
            title="L'ordre manuel de la Chrono contredit les rangs : voir ce qui bougerait, puis confirmer (ou non)"
            style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: RADIUS.md,
              border: "1px solid #d4a017", background: "rgba(212,160,23,0.1)", color: "#b8860b",
              fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer",
            }}>
            <Icon as={ListOrdered} size={13}/>
            Réordonner selon les rangs ({nbDeplacements} tâche{nbDeplacements > 1 ? "s" : ""})
          </button>
        )}
      </div>

      {/* Aperçu du réordonnancement : rien ne bouge sans confirmation */}
      {apercu && (
        <div onClick={() => setApercu(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(3px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.modal || T.surface, borderRadius: RADIUS.xl, padding: 22,
            width: "100%", maxWidth: 620, maxHeight: "82vh", overflow: "auto",
            border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, marginBottom: 6 }}>
              Réordonner selon les rangs
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.6, marginBottom: 14 }}>
              Aperçu : {nbDeplacements} tâche{nbDeplacements > 1 ? "s" : ""} changerai{nbDeplacements > 1 ? "en" : ""}t de place, <strong>à l'intérieur de leur groupe</strong> uniquement.
              Aucune date ne bouge, aucune tâche ne change de groupe, l'ordre des groupes est inchangé.
            </div>
            {proposition.changements.map(ch => {
              const bouge = new Set(ch.deplacements.map(d => d.tacheId));
              return (
                <div key={ch.groupe.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .4, textTransform: "uppercase", color: T.textSub, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: ch.groupe.couleur || "#888", display: "inline-block" }}/>
                    {ch.groupe.nom}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {ch.apres.map((id, i) => {
                      const aBouge = bouge.has(id);
                      const avantIdx = ch.avant.indexOf(id);
                      return (
                        <div key={id} style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "4px 10px",
                          borderRadius: RADIUS.sm, fontSize: FONT.xs.size + 1,
                          background: aBouge ? acc.bg10 : "transparent",
                          border: `1px solid ${aBouge ? acc.border : "transparent"}`,
                          color: T.text,
                        }}>
                          <span style={{ width: 20, textAlign: "right", fontWeight: 800, color: aBouge ? acc.accent : T.textMuted }}>{i + 1}.</span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: aBouge ? 700 : 500 }}>{nomDe(id)}</span>
                          {aBouge && (
                            <span style={{ fontSize: FONT.xs.size, color: T.textMuted, whiteSpace: "nowrap" }}>était n° {avantIdx + 1}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {proposition.nonReordonnables.length > 0 && (
              <div style={{ fontSize: FONT.xs.size + 1, color: "#b8860b", marginBottom: 12 }}>
                ⚠ Non réordonné{proposition.nonReordonnables.length > 1 ? "s" : ""} : {proposition.nonReordonnables.map(g => g.nom).join(", ")} — résous d'abord le cycle signalé dans les incohérences.
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
              <button onClick={() => setApercu(false)} style={{
                background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md, padding: "9px 18px", color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={confirmerReordonnancement} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: acc.accent, color: acc.onAccent || "#000", border: "none",
                borderRadius: RADIUS.md, padding: "9px 18px",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>
                <Icon as={Check} size={13}/>
                Confirmer le réordonnancement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barre d'actions groupées (dès qu'une tâche est cochée) */}
      {selection.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          border: `1px solid ${acc.border}`, background: acc.bg10,
          borderRadius: RADIUS.md, padding: "8px 12px", marginBottom: 12,
        }}>
          <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: acc.accent }}>
            {selection.size} tâche{selection.size > 1 ? "s" : ""} sélectionnée{selection.size > 1 ? "s" : ""}
          </span>
          {[
            ["Parallèles libres", () => patchSelection([]), "Aucun prédécesseur pour la sélection : ces tâches peuvent démarrer librement", true],
            ["Même prédécesseur…", () => setPicker(p => !p), "Donner LE MÊME prédécesseur à toute la sélection (= parallèles entre elles)", true],
            ["Chaîner dans l'ordre", chainerSelection, "La 2e suit la 1re, la 3e suit la 2e… (ordre de la Chrono)", selection.size >= 2],
            ["Revenir au défaut", () => patchSelection(null), "Efface les saisies : le chaînage par défaut reprend la main", true],
          ].map(([label, fn, title, enabled]) => (
            <button key={label} onClick={enabled ? fn : undefined} disabled={!enabled} title={title}
              style={{
                padding: "4px 12px", borderRadius: 999, border: `1px solid ${T.border}`,
                background: T.surface, color: enabled ? T.text : T.textMuted,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                cursor: enabled ? "pointer" : "not-allowed", opacity: enabled ? 1 : .55,
              }}>{label}</button>
          ))}
          <button onClick={() => { setSelection(new Set()); setPicker(false); }}
            title="Tout désélectionner"
            style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 999, border: "none", background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer" }}>
            <Icon as={X} size={12}/>
          </button>
          {/* Choix du prédécesseur commun */}
          {picker && (
            <div style={{ flexBasis: "100%", marginTop: 6 }}>
              <input autoFocus value={pickerSearch} onChange={e => setPickerSearch(e.target.value)}
                placeholder="Choisir le prédécesseur commun — rechercher une tâche…"
                style={{
                  width: "100%", padding: "6px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none", marginBottom: 6,
                }}/>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 120, overflow: "auto" }}>
                {[...index.entries()]
                  .filter(([tid]) => !selection.has(tid))
                  .filter(([, e]) => !pickerSearch || (e.tache.nom || "").toLowerCase().includes(pickerSearch.toLowerCase()))
                  .map(([tid, e]) => {
                    const g = gById.get(e.tache.chrono_groupe_id);
                    return (
                      <button key={tid} onClick={() => memePredecesseur(tid)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999,
                          maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
                          fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 600, cursor: "pointer",
                        }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: g?.couleur || "#888", flexShrink: 0 }}/>
                        {e.tache.nom || "(sans nom)"}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bandeau d'incohérences */}
      {nbInco > 0 && (
        <div style={{
          border: "1px dashed #e15a5a", background: "rgba(225,90,90,0.06)",
          borderRadius: RADIUS.md, padding: "10px 14px", marginBottom: 14,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: "#c04747", marginBottom: 8 }}>
            <Icon as={AlertTriangle} size={13} />
            {nbInco} incohérence{nbInco > 1 ? "s" : ""} détectée{nbInco > 1 ? "s" : ""}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: FONT.xs.size + 1, color: T.textSub }}>
            {cycles.map((c, i) => (
              <div key={`cy${i}`} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong style={{ color: "#c04747" }}>Cycle :</strong>
                {c.map((id, j) => <React.Fragment key={id}>{j > 0 && <span>→</span>}{puce(id)}</React.Fragment>)}
                <span>→ {nomDe(c[0])}</span>
              </div>
            ))}
            {ordresContradictoires.map((x, i) => (
              <div key={`oc${i}`} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong style={{ color: "#b8860b" }}>Ordre contradictoire :</strong>
                {puce(x.tacheId)} <span>est placée avant son prédécesseur</span> {puce(x.predId)}
              </div>
            ))}
            {bloquees.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong>Bloquées par un cycle :</strong>
                {bloquees.map(puce)}
              </div>
            )}
            {introuvables.map((x, i) => (
              <div key={`in${i}`} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <strong>Prédécesseur supprimé :</strong>
                {puce(x.tacheId)} <span>référence une tâche qui n'existe plus (ignorée)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Les bandes de rangs */}
      {parRang.map((ids, i) => {
        const visibles = ids.filter(id => sources.get(id) !== "hors_chaine");
        if (visibles.length === 0) return null;
        return (
          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
            <div style={{
              flexShrink: 0, width: 64, textAlign: "center", padding: "7px 0",
              borderRadius: RADIUS.sm, background: acc.bg10, color: acc.accent,
              fontWeight: 800, fontSize: FONT.xs.size + 1,
            }}>
              Rang {i + 1}
              {visibles.length > 1 && (
                <div style={{ fontSize: FONT.xs.size - 1, fontWeight: 700, color: T.textSub, marginTop: 1 }}>
                  ×{visibles.length} en //
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1, minWidth: 0 }}>
              {visibles.map(carte)}
            </div>
          </div>
        );
      })}

      {/* Tâches à classer : hors chaîne, jamais chaînées de force */}
      {horsChaine.length > 0 && (
        <div style={{
          marginTop: 14, padding: "10px 14px", borderRadius: RADIUS.md,
          border: `1px dashed ${T.border}`, background: "transparent",
        }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>
            À classer ({horsChaine.length}) — hors chaînage tant qu'elles ne sont pas dans un groupe
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {horsChaine.map(carte)}
          </div>
        </div>
      )}
    </div>
  );
}

function ChronoView({ ouvrages, lots, groupes, jalons, acc, T, applyChrono, patchTaches, setGroupes, setJalons, setGroupesEtJalons, updateTache, onClickTache, rapportsPourTache, onShowRapports, onInitGroupesTypes, chronoVierge, nbGtManquants, propositionPourGroupe, onAffecterOuvriers, onMarquerExterne, controleCtx, controlesChantier = [], reservesChantier = [], onControleChange }) {
  const [drag, setDrag] = useState(null);        // { kind: 'tache'|'jalon', id, ouvrageId? }
  const [controleOuvert, setControleOuvert] = useState(null); // groupe dont le contrôle est ouvert
  const todayISO = new Date().toISOString().slice(0, 10);     // ancienneté des réserves (badge)
  const [overKey, setOverKey] = useState(null);  // clé de la zone/ligne survolée
  // Tout est REPLIÉ par défaut : on mémorise les groupes DÉPLIÉS (local à la
  // vue) — un nouveau groupe ou un autre chantier arrive donc toujours replié.
  const [deplies, setDeplies] = useState(() => new Set());      // ids de groupes dépliés
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(true); // repli de « À classer »
  const [focusOpen, setFocusOpen] = useState(true);             // encart « Où en est-on ? »
  const [selected, setSelected] = useState(() => new Set());    // ids de tâches sélectionnées (multi)
  const [hideDone, setHideDone] = useState(false);              // masquer les tâches à 100 %
  const [onlyTodo, setOnlyTodo] = useState(false);              // n'afficher que « À classer »
  const [filterLot, setFilterLot] = useState("");               // filtrer par lot
  // Édition nom + couleur des groupes : brouillon local, persisté au blur pour
  // éviter un aller-retour DB (saveMeta) à chaque frappe.
  const [drafts, setDrafts] = useState({});      // { [id]: { nom?, couleur? } }
  const gVal = (g, key) => (drafts[g.id]?.[key] ?? g[key] ?? "");
  const setDraft = (id, key, v) => setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: v } }));
  const commit = (g, key) => {
    const v = drafts[g.id]?.[key];
    if (v == null || v === g[key]) return;
    const nextGroupes = groupes.map(x => x.id === g.id ? { ...x, [key]: v } : x);
    // Renommage : le jalon de contrôle suit le nom de son groupe, dans la
    // MÊME écriture (deux saveMeta successifs se perdraient un patch).
    if (key === "nom") {
      const nextJalons = jalons.map(j =>
        ((j.groupe_id ?? null) === g.id && estJalonControle(j)) ? { ...j, nom: `Contrôle — ${v}` } : j);
      if (nextJalons.some((j, i) => j !== jalons[i])) {
        setGroupesEtJalons(nextGroupes, nextJalons);
        return;
      }
    }
    setGroupes(nextGroupes);
  };
  // Confirmation avant de semer un chantier qui a DÉJÀ des groupes
  // (ajouter les manquants vs tout remplacer).
  const [initConfirm, setInitConfirm] = useState(false);
  // Confirmation avant d'affecter une équipe à un groupe dont des tâches ont
  // déjà des ouvriers saisis (ajouter aux existants vs remplacer).
  // { groupeId, equipe, nbAvecOuvriers } ou null.
  const [affectConfirm, setAffectConfirm] = useState(null);
  // Nom des jalons : brouillon local, persisté au blur (même logique).
  const [jNameDraft, setJNameDraft] = useState({});
  const jNom = (j) => jNameDraft[j.id] ?? j.nom ?? "";
  const commitJNom = (j) => {
    const v = jNameDraft[j.id];
    if (v != null && v !== j.nom) setJalons(jalons.map(x => x.id === j.id ? { ...x, nom: v } : x));
  };

  // ── Auto-scroll pendant le glisser-déposer ──
  // Le drag & drop HTML5 ne fait pas défiler le conteneur : sans ça,
  // impossible d'atteindre un groupe situé plus bas. On fait défiler quand
  // le curseur entre dans la zone haute/basse du conteneur scrollable.
  const scrollRef = useRef(null);
  const scrollVel = useRef(0);
  const rafRef = useRef(0);
  const runAutoScroll = () => {
    const el = scrollRef.current;
    if (el && scrollVel.current !== 0) {
      el.scrollTop += scrollVel.current;
      rafRef.current = requestAnimationFrame(runAutoScroll);
    } else {
      rafRef.current = 0;
    }
  };
  const stopAutoScroll = () => {
    scrollVel.current = 0;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  };
  const onRootDragOver = (e) => {
    const el = scrollRef.current;
    if (!el || !drag) return;
    const rect = el.getBoundingClientRect();
    const EDGE = 70;   // hauteur de la zone sensible (px)
    const MAX = 20;    // vitesse max (px/frame)
    const y = e.clientY;
    let v = 0;
    if (y < rect.top + EDGE) v = -Math.ceil(MAX * Math.min(1, (rect.top + EDGE - y) / EDGE));
    else if (y > rect.bottom - EDGE) v = Math.ceil(MAX * Math.min(1, (y - (rect.bottom - EDGE)) / EDGE));
    scrollVel.current = v;
    if (v !== 0 && !rafRef.current) rafRef.current = requestAnimationFrame(runAutoScroll);
  };
  // Arrête l'auto-scroll dès que le drag se termine (drop, dragend, annulation).
  useEffect(() => { if (!drag) stopAutoScroll(); }, [drag]);

  const isoDay = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Liste plate de toutes les tâches du chantier.
  const items = [];
  ouvrages.forEach(o => {
    const lot = lots.find(l => l.id === o.lot_id) || null;
    (o.taches || []).forEach(t => items.push({ ouvrageId: o.id, ouvrage: o, lot, tache: t }));
  });

  const groupesTries = [...groupes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const groupeIds = new Set(groupesTries.map(g => g.id));
  const itemsOfGroup = (gid) => items
    .filter(it => it.tache.chrono_groupe_id === gid)
    .sort((a, b) => {
      const oa = a.tache.chrono_ordre ?? 1e9, ob = b.tache.chrono_ordre ?? 1e9;
      if (oa !== ob) return oa - ob;
      return (a.tache.nom || "").localeCompare(b.tache.nom || "");
    });
  const unassigned = items
    .filter(it => !it.tache.chrono_groupe_id || !groupeIds.has(it.tache.chrono_groupe_id))
    .sort((a, b) => (a.tache.nom || "").localeCompare(b.tache.nom || ""));

  // Entrées ordonnées d'un groupe = tâches + jalons fusionnés par `ordre`.
  // À égalité d'ordre, la tâche passe avant le jalon (stable).
  const entriesOfGroup = (gid) => {
    const es = [];
    items.forEach(it => {
      if (it.tache.chrono_groupe_id === gid)
        es.push({ kind: "tache", id: it.tache.id, ordre: it.tache.chrono_ordre ?? 1e9, it });
    });
    jalons.forEach(j => {
      if ((j.groupe_id ?? null) === gid)
        es.push({ kind: "jalon", id: j.id, ordre: j.ordre ?? 1e9, jalon: j });
    });
    // Invariant Point 2 b : le jalon de CONTRÔLE reste TOUJOURS en fin de
    // groupe, quel que soit son ordre stocké. Cette règle de tri est le point
    // unique qui tient l'invariant face à tous les chemins qui posent une
    // entrée « en fin de groupe » (drag & drop, moveTacheToGroup, bulkAssign,
    // addJalon) — pas besoin de normaliser les ordres après coup.
    es.sort((a, b) => {
      const ca = a.kind === "jalon" && estJalonControle(a.jalon) ? 1 : 0;
      const cb = b.kind === "jalon" && estJalonControle(b.jalon) ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return (a.ordre - b.ordre) || (a.kind === b.kind ? 0 : a.kind === "tache" ? -1 : 1);
    });
    return es;
  };

  // ── Groupes : CRUD ──
  const addGroupe = () => {
    const ordre = groupes.reduce((m, g) => Math.max(m, g.ordre ?? 0), 0) + 1;
    const couleur = CHRONO_PALETTE[groupes.length % CHRONO_PALETTE.length];
    const g = { id: rid(), nom: "Nouveau groupe", couleur, ordre };
    // Chaque groupe naît avec son jalon de contrôle, en UNE écriture.
    setGroupesEtJalons([...groupes, g], [...jalons, buildJalonControle(g, rid)]);
  };
  const deleteGroupe = (g) => {
    // Détache les tâches du groupe supprimé (retour à « À classer »)…
    const toDetach = itemsOfGroup(g.id);
    if (toDetach.length) {
      const assignments = {};
      toDetach.forEach(it => { assignments[it.tache.id] = { groupe_id: null, ordre: 0 }; });
      applyChrono(assignments);
    }
    // … et supprime ses jalons (repères ET contrôle : le contrôle suit son
    // groupe). UNE seule écriture groupes+jalons — l'ancien enchaînement
    // setJalons puis setGroupes se perdait un patch (race saveMeta).
    const nextJalons = jalons.filter(j => (j.groupe_id ?? null) !== g.id);
    const nextGroupes = groupes.filter(x => x.id !== g.id);
    if (nextJalons.length !== jalons.length) setGroupesEtJalons(nextGroupes, nextJalons);
    else setGroupes(nextGroupes);
  };

  // ── Jalons : CRUD ──
  // Le bouton « Jalon » crée toujours un REPÈRE manuel (type explicite ; les
  // jalons historiques sans type restent des repères — cf. chronoTemplate).
  const addJalon = (groupeId) => {
    const ordre = entriesOfGroup(groupeId).reduce((m, e) => Math.max(m, e.ordre ?? 0), -1) + 1;
    setJalons([...jalons, { id: rid(), nom: "Jalon", date: null, groupe_id: groupeId, ordre, type: JALON_TYPE_REPERE }]);
  };
  const setJalonDate = (j, date) => setJalons(jalons.map(x => x.id === j.id ? { ...x, date: date || null } : x));
  // Un jalon de contrôle est obligatoire : jamais supprimable à la main
  // (garde au niveau fonction, pas seulement au niveau bouton).
  const deleteJalon = (j) => {
    if (estJalonControle(j)) return;
    setJalons(jalons.filter(x => x.id !== j.id));
  };

  // ── Glisser-déposer ──
  // Dépose l'entrée traînée (tâche OU jalon) dans `groupeId` à la position
  // `index` (null → à la fin). Renumérote le groupe cible : les tâches via
  // applyChrono, les jalons via setJalons, dans le même espace d'ordre.
  const handleDrop = (groupeId, index) => {
    if (!drag) return;
    // Garde-fou : un jalon de CONTRÔLE ne se déplace jamais (ni dans son
    // groupe, ni vers un autre). Il n'est pas draggable côté rendu, mais on
    // protège aussi ici (le drop est le seul endroit qui réécrit groupe_id).
    if (drag.kind === "jalon") {
      const jDrag = jalons.find(x => x.id === drag.id);
      if (jDrag && estJalonControle(jDrag)) { setDrag(null); setOverKey(null); return; }
    }
    const entries = entriesOfGroup(groupeId).filter(e => !(e.kind === drag.kind && e.id === drag.id));
    const pos = index == null ? entries.length : Math.min(index, entries.length);
    entries.splice(pos, 0, { kind: drag.kind, id: drag.id });
    const tacheAssign = {};
    const jalonOrdre = {};
    entries.forEach((e, i) => {
      if (e.kind === "tache") tacheAssign[e.id] = { groupe_id: groupeId, ordre: i };
      else jalonOrdre[e.id] = i;
    });
    if (Object.keys(tacheAssign).length) applyChrono(tacheAssign);
    if (Object.keys(jalonOrdre).length) {
      setJalons(jalons.map(j => jalonOrdre[j.id] != null ? { ...j, groupe_id: groupeId, ordre: jalonOrdre[j.id] } : j));
    }
    setDrag(null); setOverKey(null);
  };
  const handleDropUnassigned = () => {
    if (!drag) return;
    // Les jalons appartiennent toujours à un groupe : on ignore leur dépôt ici.
    if (drag.kind === "tache") applyChrono({ [drag.id]: { groupe_id: null, ordre: 0 } });
    setDrag(null); setOverKey(null);
  };
  // Affecte une tâche à un groupe (ou à « À classer » si groupeId null) via la
  // liste déroulante : elle se place en fin du groupe cible. No-op si elle y est
  // déjà, pour éviter un ré-ordonnancement inutile.
  const moveTacheToGroup = (tacheId, currentGroupeId, groupeId) => {
    if ((currentGroupeId ?? null) === (groupeId ?? null)) return;
    if (groupeId == null) { applyChrono({ [tacheId]: { groupe_id: null, ordre: 0 } }); return; }
    const ordre = entriesOfGroup(groupeId).reduce((m, e) => Math.max(m, e.ordre ?? -1), -1) + 1;
    applyChrono({ [tacheId]: { groupe_id: groupeId, ordre } });
  };

  // ── Dates (règles jours ouvrés, cohérentes avec le Gantt) ──
  const H_PER_DAY = 7;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
  const isWeekend = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
  const nextWorkDay = (d) => { let x = startOfDay(d); while (isWeekend(x)) x = addDays(x, 1); return x; };
  const addWorkDays = (start, n) => { let x = startOfDay(start), r = Math.max(0, n); while (r > 0) { x = addDays(x, 1); if (!isWeekend(x)) r--; } return x; };
  const parseD = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
  const today = startOfDay(new Date());
  const todayLbl = today.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const fmtShort = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  // Tâche en retard : datée dans le passé et pas terminée.
  const overdueT = (t) => { const d = parseD(t.date_prevue); return !!d && d < today && (parseInt(t.avancement) || 0) < 100; };

  // ── Synthèse d'un groupe (fenêtre de dates, heures vendues, avancement pondéré, retards) ──
  const groupStats = (gid) => {
    const its = itemsOfGroup(gid);
    let hv = 0, wsum = 0, wtot = 0, dmin = null, dmax = null, nbLate = 0;
    its.forEach(({ tache: t }) => {
      const h = parseFloat(t.heures_vendues) || 0;
      const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
      hv += h;
      if (h > 0) { wsum += h * av; wtot += h; }
      const d = parseD(t.date_prevue);
      if (d) { if (!dmin || d < dmin) dmin = d; if (!dmax || d > dmax) dmax = d; }
      if (overdueT(t)) nbLate++;
    });
    jalons.forEach(j => { if ((j.groupe_id ?? null) === gid) { const d = parseD(j.date); if (d) { if (!dmin || d < dmin) dmin = d; if (!dmax || d > dmax) dmax = d; } } });
    const avg = wtot > 0 ? Math.round(wsum / wtot)
      : (its.length ? Math.round(its.reduce((s, { tache: t }) => s + (parseInt(t.avancement) || 0), 0) / its.length) : 0);
    return { count: its.length, hv, avg, dmin, dmax, nbLate };
  };

  // ── Réordonner les groupes (flèches ↑/↓) : renumérote tout le monde ──
  const reorderGroupe = (idx, dir) => {
    const arr = [...groupesTries];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    const ordreById = {}; arr.forEach((g, i) => { ordreById[g.id] = i; });
    setGroupes(groupes.map(g => ({ ...g, ordre: ordreById[g.id] ?? g.ordre })));
  };

  // ── Dater tout un groupe : répartit les dates en jours ouvrés depuis `startStr`,
  //    chaque tâche durant ⌈heures/7⌉ jours (comme le Gantt). ──
  const planGroupe = (gid, startStr) => {
    const start = parseD(startStr);
    if (!start) return;
    let cur = nextWorkDay(start);
    const patch = {};
    itemsOfGroup(gid).forEach(({ tache: t }) => {
      patch[t.id] = { date_prevue: isoDay(cur) };
      const h = parseFloat(t.heures_vendues) || parseFloat(t.heures_estimees) || H_PER_DAY;
      const dur = Math.max(1, Math.ceil(h / H_PER_DAY));
      cur = nextWorkDay(addWorkDays(cur, dur));
    });
    if (Object.keys(patch).length) patchTaches(patch);
  };
  // ── Décaler tout un groupe (tâches datées + jalons) de `days` jours calendaires. ──
  const shiftGroupe = (gid, days) => {
    const patch = {};
    itemsOfGroup(gid).forEach(({ tache: t }) => { const d = parseD(t.date_prevue); if (d) patch[t.id] = { date_prevue: isoDay(addDays(d, days)) }; });
    if (Object.keys(patch).length) patchTaches(patch);
    if (jalons.some(j => (j.groupe_id ?? null) === gid && j.date)) {
      setJalons(jalons.map(j => (j.groupe_id ?? null) === gid && j.date ? { ...j, date: isoDay(addDays(parseD(j.date), days)) } : j));
    }
  };

  // ── Multi-sélection + affectation en masse ──
  const toggleSelect = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSelect = () => setSelected(new Set());
  const bulkAssign = (groupeId) => {
    const ids = [...selected];
    if (!ids.length) return;
    const a = {};
    if (groupeId == null) { ids.forEach(id => { a[id] = { groupe_id: null, ordre: 0 }; }); }
    else { let base = entriesOfGroup(groupeId).reduce((m, e) => Math.max(m, e.ordre ?? -1), -1); ids.forEach(id => { base += 1; a[id] = { groupe_id: groupeId, ordre: base }; }); }
    applyChrono(a);
    clearSelect();
  };

  // ── Filtres d'affichage (n'altèrent pas les données ni les synthèses) ──
  const passFilters = (it) => {
    const t = it.tache;
    if (hideDone && (parseInt(t.avancement) || 0) >= 100) return false;
    if (filterLot && (it.lot?.id || "") !== filterLot) return false;
    return true;
  };
  // Lots réellement présents parmi les tâches (pour le filtre).
  const lotsPresent = lots.filter(l => items.some(it => it.lot?.id === l.id));

  // ── Rendu d'une ligne tâche (fonction, PAS un composant, pour ne pas
  //    remonter les <input> à chaque frappe et perdre le focus). ──
  const renderRow = (it, color, groupeId, index) => {
    const t = it.tache;
    const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
    const c = av >= 100 ? "#22c55e" : color;
    const dragging = drag?.kind === "tache" && drag?.id === t.id;
    const rowKey = `row:${groupeId || "_u"}:${index}`;
    const isOver = overKey === rowKey && !dragging;
    const crs = rapportsPourTache(t);
    const late = overdueT(t);
    const sel = selected.has(t.id);
    return (
      <div key={t.id} className="chrono-row"
        onDragStart={e => { setDrag({ kind: "tache", id: t.id, ouvrageId: it.ouvrageId }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); }}
        onDragEnd={e => { e.currentTarget.draggable = false; setDrag(null); setOverKey(null); }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag && overKey !== rowKey) setOverKey(rowKey); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); groupeId ? handleDrop(groupeId, index) : handleDropUnassigned(); }}
        onClick={() => onClickTache(it.ouvrageId, t.id)}
        style={{
          "--c": c,
          display: "flex", alignItems: "center", gap: 10,
          padding: "9px 12px", margin: "6px 0",
          borderRadius: RADIUS.md,
          border: `1px solid ${sel ? acc.accent : T.border}`,
          borderLeft: `4px solid ${late ? "#e15a5a" : c}`,
          borderTop: isOver ? `2px solid ${color}` : `1px solid ${sel ? acc.accent : T.border}`,
          background: sel ? acc.bg10 : T.card, cursor: "pointer",
          opacity: dragging ? 0.4 : 1,
          transition: "border-color .12s, box-shadow .12s",
        }}>
        <input type="checkbox" checked={sel}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleSelect(t.id)}
          title="Sélectionner pour une action groupée"
          style={{ flexShrink: 0, cursor: "pointer", width: 15, height: 15, accentColor: acc.accent }} />
        <span
          onMouseDown={e => { const row = e.currentTarget.parentElement; if (row) row.draggable = true; }}
          onMouseUp={e => { const row = e.currentTarget.parentElement; if (row) row.draggable = false; }}
          onClick={e => e.stopPropagation()}
          title="Glisser pour déplacer / ordonner"
          style={{ display: "inline-flex", flexShrink: 0, cursor: "grab" }}>
          <Icon as={GripVertical} size={14} color={T.textMuted} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t.externe && (
              <span title="Réalisée par un prestataire externe — aucune heure interne"
                style={{
                  display: "inline-block", verticalAlign: "middle", marginRight: 6,
                  padding: "0 5px", borderRadius: 4, border: "1px solid #f5a623",
                  color: "#f5a623", fontSize: 9, fontWeight: 800, letterSpacing: .4, lineHeight: "14px",
                }}>EXT</span>
            )}
            {t.nom || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans nom)</span>}
          </div>
          <div style={{ fontSize: FONT.xs.size, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(it.lot?.label ? it.lot.label + " · " : "") + (it.ouvrage.libelle || "—")}
          </div>
        </div>
        {groupesTries.length > 0 && (
          <select
            value={t.chrono_groupe_id && groupeIds.has(t.chrono_groupe_id) ? t.chrono_groupe_id : ""}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onChange={e => { e.stopPropagation(); moveTacheToGroup(t.id, t.chrono_groupe_id, e.target.value || null); }}
            title="Attribuer à un groupe"
            style={{
              maxWidth: 150, flexShrink: 0, padding: "5px 8px", borderRadius: RADIUS.sm,
              border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
              color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600,
              outline: "none", cursor: "pointer",
            }}>
            <option value="">À classer</option>
            {groupesTries.map(g => <option key={g.id} value={g.id}>{g.nom || "(groupe)"}</option>)}
          </select>
        )}
        {crs.length > 0 && (
          <button className="chrono-cr-btn"
            onClick={e => { e.stopPropagation(); onShowRapports(t, crs); }}
            title={`${crs.length} compte${crs.length > 1 ? "s" : ""} rendu${crs.length > 1 ? "s" : ""} lié${crs.length > 1 ? "s" : ""} à cette tâche`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
              padding: "4px 8px", borderRadius: RADIUS.sm,
              border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
              fontFamily: "inherit", fontSize: 10, fontWeight: 800, cursor: "pointer",
            }}>
            <Icon as={FileText} size={12} />
            {crs.length}
          </button>
        )}
        {late && <Icon as={AlertTriangle} size={13} color="#e15a5a" title="En retard : date passée et tâche non terminée" style={{ flexShrink: 0 }} />}
        <input type="date" value={isoDay(t.date_prevue)}
          onClick={e => e.stopPropagation()}
          onChange={e => updateTache(it.ouvrageId, t.id, { date_prevue: e.target.value || null })}
          title="Date prévue (partagée avec le Gantt)"
          style={{
            padding: "5px 8px", borderRadius: RADIUS.sm,
            border: `1px solid ${late ? "#e15a5a" : T.border}`, background: T.fieldBg || T.card,
            color: late ? "#e15a5a" : (t.date_prevue ? T.text : T.textMuted),
            fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none", flexShrink: 0,
            fontWeight: late ? 700 : 400,
          }} />
        <InfoBulle contenu={`${av}% réalisé`} T={T}>
          <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.textMuted, minWidth: 34, textAlign: "right", flexShrink: 0 }}>
            {av}%
          </span>
        </InfoBulle>
      </div>
    );
  };

  // ── Rendu d'un jalon. Deux natures (cf. chronoTemplate) :
  //  - repère (défaut, jalons historiques inclus) : comportement inchangé —
  //    renommable, datable, supprimable, glissable ;
  //  - contrôle : géré automatiquement (Point 2 b) — figé : ni drag, ni
  //    renommage, ni date, ni suppression. On garde onDragOver/onDrop sur sa
  //    ligne pour pouvoir déposer une tâche/un repère À SA POSITION.
  const renderJalon = (j, color, groupeId, index) => {
    const rowKey = `row:${groupeId || "_u"}:${index}`;
    if (estJalonControle(j)) {
      const isOverC = overKey === rowKey;
      return (
        <div key={"j" + j.id} className="chrono-jalon chrono-jalon-controle"
          title="Jalon de contrôle de fin de groupe — créé automatiquement, non déplaçable (Point 2 b)"
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag && overKey !== rowKey) setOverKey(rowKey); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); groupeId ? handleDrop(groupeId, index) : handleDropUnassigned(); }}
          style={{
            "--c": color,
            display: "flex", alignItems: "center", gap: 9,
            padding: "7px 12px", margin: "6px 0",
            borderRadius: RADIUS.md,
            border: `1.5px solid ${color}`,
            borderTop: isOverC ? `2px solid ${color}` : `1.5px solid ${color}`,
            background: `color-mix(in srgb, ${color} 8%, transparent)`,
          }}>
          <Icon as={ClipboardCheck} size={14} color={color} style={{ flexShrink: 0 }} />
          <span style={{
            flex: 1, minWidth: 0, color: T.text, fontSize: FONT.sm.size, fontWeight: 800,
            letterSpacing: .2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{j.nom || "Contrôle"}</span>
          <span style={{
            flexShrink: 0, fontSize: 9.5, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase",
            color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
            borderRadius: 999, padding: "2px 8px",
          }}>contrôle</span>
          {/* Ouvre l'écran de contrôle du groupe (audit par exception) */}
          <button onClick={() => { const g = groupes.find(x => x.id === (j.groupe_id ?? groupeId)); if (g) setControleOuvert(g); }}
            title="Contrôler ce groupe (audit par exception : tout conforme par défaut)"
            style={{
              flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 999,
              border: "none", background: color, color: "#fff",
              fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            }}>
            <Icon as={ClipboardCheck} size={12}/> Contrôler
          </button>
        </div>
      );
    }
    const dragging = drag?.kind === "jalon" && drag?.id === j.id;
    const isOver = overKey === rowKey && !dragging;
    const dateLbl = j.date ? new Date(j.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
    return (
      <div key={"j" + j.id} className="chrono-jalon" draggable
        onDragStart={e => { setDrag({ kind: "jalon", id: j.id }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.id); }}
        onDragEnd={() => { setDrag(null); setOverKey(null); }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag && overKey !== rowKey) setOverKey(rowKey); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); groupeId ? handleDrop(groupeId, index) : handleDropUnassigned(); }}
        style={{
          "--c": color,
          display: "flex", alignItems: "center", gap: 9,
          padding: "7px 12px", margin: "6px 0",
          borderRadius: RADIUS.md,
          border: `1.5px dashed ${color}`,
          borderTop: isOver ? `2px solid ${color}` : `1.5px dashed ${color}`,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          opacity: dragging ? 0.4 : 1,
          transition: "border-color .12s, box-shadow .12s",
        }}>
        <Icon as={GripVertical} size={14} color={T.textMuted} style={{ flexShrink: 0, cursor: "grab" }} />
        <Icon as={Flag} size={13} color={color} style={{ flexShrink: 0 }} />
        <input value={jNom(j)}
          onChange={e => setJNameDraft(d => ({ ...d, [j.id]: e.target.value }))}
          onBlur={() => commitJNom(j)}
          placeholder="Nom du jalon"
          style={{
            flex: 1, minWidth: 0, background: "transparent", border: "none",
            borderBottom: "1px solid transparent",
            color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            letterSpacing: .2, outline: "none",
          }}
          onFocus={e => { e.target.style.borderBottomColor = `color-mix(in srgb, ${color} 60%, transparent)`; }}
          onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderBottomColor = "transparent"; }} />
        <input type="date" value={isoDay(j.date)}
          onChange={e => setJalonDate(j, e.target.value)}
          title={dateLbl ? `Jalon prévu le ${dateLbl}` : "Dater le jalon"}
          style={{
            padding: "5px 8px", borderRadius: RADIUS.sm,
            border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
            color: j.date ? T.text : T.textMuted,
            fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none", flexShrink: 0,
          }} />
        <button onClick={() => deleteJalon(j)} title="Supprimer le jalon"
          style={{
            width: 26, height: 26, borderRadius: RADIUS.sm, flexShrink: 0,
            border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted,
            cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
          <Icon as={Trash2} size={12} />
        </button>
      </div>
    );
  };

  const iconBtn = (extra) => ({
    width: 26, height: 26, borderRadius: RADIUS.sm, flexShrink: 0,
    border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted,
    cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontFamily: "inherit", ...extra,
  });

  const renderGroup = (g, gIndex) => {
    const allEntries = entriesOfGroup(g.id);
    const entries = allEntries.filter(e => e.kind !== "tache" || passFilters(e.it));
    const couleur = gVal(g, "couleur") || "#5b8af5";
    const emptyOver = overKey === `group:${g.id}`;
    const isCollapsed = !deplies.has(g.id);
    const st = groupStats(g.id);
    // État de contrôle (Point 2 b) : « terminé » = TOUTES les tâches à 100 %
    // (définition canonique, cf. statsGroupeChrono) — pas l'avancement pondéré.
    const tachesG = itemsOfGroup(g.id);
    const termine = tachesG.length > 0 && tachesG.every(({ tache: t }) => (parseInt(t.avancement) || 0) >= 100);
    const etatCtrl = etatControleGroupe(g.id, { reserves: reservesChantier, controles: controlesChantier, termine, todayISO });
    const rangeLbl = st.dmin ? (st.dmax && +st.dmax !== +st.dmin ? `${fmtShort(st.dmin)} – ${fmtShort(st.dmax)}` : fmtShort(st.dmin)) : null;
    const hvLbl = st.hv > 0 ? `${Math.round(st.hv * 10) / 10} h vendues` : null;
    return (
      <div key={g.id} style={{ marginBottom: 18 }}>
        {/* Ligne titre */}
        <div className="chrono-group-title" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <button onClick={() => setDeplies(s => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
            title={isCollapsed ? "Déplier" : "Replier"}
            style={{ ...iconBtn({ border: "none", width: 22 }) }}>
            <Icon as={isCollapsed ? ChevronRight : ChevronDown} size={16} />
          </button>
          <input type="color" value={couleur}
            onChange={e => setDraft(g.id, "couleur", e.target.value)}
            onBlur={() => commit(g, "couleur")}
            title="Couleur du groupe"
            style={{ width: 24, height: 24, padding: 0, border: "none", background: "none", cursor: "pointer", flexShrink: 0 }} />
          <input value={gVal(g, "nom")}
            onChange={e => setDraft(g.id, "nom", e.target.value)}
            onBlur={() => commit(g, "nom")}
            placeholder="Nom du groupe"
            style={{
              flex: 1, minWidth: 0, background: "transparent", border: "none",
              borderBottom: "1px solid transparent",
              color: T.text, fontFamily: "inherit", fontSize: FONT.md.size, fontWeight: 800, outline: "none",
            }}
            onFocus={e => { e.target.style.borderBottomColor = T.border; }}
            onMouseLeave={e => { if (document.activeElement !== e.target) e.target.style.borderBottomColor = "transparent"; }} />
          <span style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, background: T.card, borderRadius: RADIUS.pill, padding: "2px 9px", flexShrink: 0 }}>
            {st.count}
          </span>
          {st.nbLate > 0 && (
            <span title={`${st.nbLate} tâche(s) en retard`}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 800, color: "#e15a5a", background: "rgba(225,90,90,0.12)", border: "1px solid rgba(225,90,90,0.35)", borderRadius: RADIUS.pill, padding: "2px 8px", flexShrink: 0 }}>
              <Icon as={AlertTriangle} size={11} /> {st.nbLate}
            </span>
          )}
          {/* État de contrôle du groupe (Point 2 b) : signalé, JAMAIS bloquant.
              Rouge « Contrôle à faire » quand le groupe est terminé sans
              contrôle ; vert/orange/rouge selon les réserves une fois
              contrôlé. Clic = accès direct à l'écran de contrôle. Visible
              groupe replié (les groupes le sont par défaut). */}
          {etatCtrl?.couleur && (
            <button onClick={() => setControleOuvert(g)}
              title={`${etatCtrl.raison} Ouvrir le contrôle.`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 800, color: etatCtrl.couleur,
                background: `color-mix(in srgb, ${etatCtrl.couleur} 12%, transparent)`,
                border: `1px solid color-mix(in srgb, ${etatCtrl.couleur} 40%, transparent)`,
                borderRadius: RADIUS.pill, padding: "2px 8px", flexShrink: 0,
                cursor: "pointer", fontFamily: "inherit",
              }}>
              <Icon as={ClipboardCheck} size={11} /> {etatCtrl.etat === "a_controler" ? "Contrôle à faire" : etatCtrl.label}
            </button>
          )}
          <div style={{ display: "inline-flex", gap: 2, flexShrink: 0 }}>
            <button onClick={() => reorderGroupe(gIndex, -1)} disabled={gIndex === 0} title="Monter le groupe"
              style={iconBtn({ width: 22, opacity: gIndex === 0 ? 0.35 : 1, cursor: gIndex === 0 ? "default" : "pointer" })}>
              <Icon as={ChevronUp} size={13} />
            </button>
            <button onClick={() => reorderGroupe(gIndex, +1)} disabled={gIndex === groupesTries.length - 1} title="Descendre le groupe"
              style={iconBtn({ width: 22, opacity: gIndex === groupesTries.length - 1 ? 0.35 : 1, cursor: gIndex === groupesTries.length - 1 ? "default" : "pointer" })}>
              <Icon as={ChevronDown} size={13} />
            </button>
          </div>
          <button onClick={() => addJalon(g.id)} title="Ajouter un jalon dans ce groupe"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
              padding: "5px 9px", borderRadius: RADIUS.sm,
              border: `1px solid ${T.border}`, background: "transparent", color: T.textSub,
              fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}>
            <Icon as={Flag} size={12} /> Jalon
          </button>
          <button onClick={() => deleteGroupe(g)} title="Supprimer le groupe (les tâches repassent « à classer »)"
            style={iconBtn({ width: 28, height: 28 })}>
            <Icon as={Trash2} size={13} />
          </button>
        </div>

        {/* Ligne synthèse + planification */}
        {!isCollapsed && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "0 0 8px 30px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: FONT.xs.size, color: T.textMuted, flexWrap: "wrap" }}>
              {rangeLbl && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Calendar} size={12} /> {rangeLbl}</span>}
              {hvLbl && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Clock} size={12} /> {hvLbl}</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 72, height: 6, borderRadius: 99, background: T.border, overflow: "hidden", display: "inline-block" }}>
                  <span style={{ display: "block", height: "100%", width: `${st.avg}%`, background: st.avg >= 100 ? "#22c55e" : couleur, transition: "width .2s" }} />
                </span>
                <strong style={{ color: st.avg >= 100 ? "#22c55e" : T.textSub }}>{st.avg}%</strong>
              </span>
            </div>
            {/* Équipe par défaut (groupe type → équipe) : proposée, jamais imposée.
                `noms` = ouvriers prioritaires du groupe type si définis, sinon
                toute l'équipe disponible. */}
            {(() => {
              const prop = propositionPourGroupe?.(g);
              if (!prop) return null;
              const eq = prop.equipe;
              const noms = prop.noms;
              const tachesGroupe = itemsOfGroup(g.id).map(it => it.tache);
              if (eq.externe) {
                // Prestataire externe : pas d'ouvriers internes à pré-remplir.
                // Le bouton marque les tâches du groupe `externe: true` — un
                // repère (groupe + planning) qui n'ajoute aucune heure interne.
                const marquees = tachesGroupe.filter(t => t.externe).length;
                const toutesMarquees = tachesGroupe.length > 0 && marquees === tachesGroupe.length;
                return (
                  <button
                    disabled={tachesGroupe.length === 0}
                    onClick={() => onMarquerExterne?.(g.id, !toutesMarquees)}
                    title={tachesGroupe.length === 0
                      ? "Aucune tâche dans ce groupe"
                      : toutesMarquees
                        ? `Tâches marquées « ${eq.nom} » (prestataire) — cliquer pour retirer le marquage`
                        : `Marquer les ${tachesGroupe.length} tâche(s) du groupe comme réalisées par le prestataire externe — aucun ouvrier interne, aucune heure interne`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 9px", borderRadius: 999,
                      border: `1px solid ${toutesMarquees ? "#f5a623" : T.border}`,
                      background: toutesMarquees ? "rgba(245,166,35,0.12)" : "transparent",
                      color: toutesMarquees ? "#f5a623" : T.textSub,
                      fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                      cursor: tachesGroupe.length === 0 ? "default" : "pointer",
                      opacity: tachesGroupe.length === 0 ? .55 : 1,
                    }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: eq.couleur || "#888" }} />
                    {toutesMarquees ? `${eq.nom} (externe) ✓` : `Marquer externe · ${eq.nom}`}
                  </button>
                );
              }
              if (noms.length === 0) {
                // Équipe interne sans membre disponible (tous « à venir »,
                // ou équipe vide) : simple repère visuel.
                return (
                  <span title="Aucun membre disponible aujourd'hui — se règle dans Admin → Équipes"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "3px 9px", borderRadius: 999, border: `1px solid ${T.border}`,
                      fontSize: 10, fontWeight: 700, color: T.textSub,
                    }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: eq.couleur || "#888" }} />
                    {eq.nom}
                  </span>
                );
              }
              const nbAvecOuvriers = tachesGroupe.filter(t => (t.ouvriers || []).length > 0).length;
              const dejaTous = tachesGroupe.length > 0 &&
                tachesGroupe.every(t => noms.every(n => (t.ouvriers || []).includes(n)));
              return (
                <button
                  disabled={tachesGroupe.length === 0 || dejaTous}
                  onClick={() => nbAvecOuvriers > 0
                    ? setAffectConfirm({ groupeId: g.id, equipe: eq, noms, nbAvecOuvriers })
                    : onAffecterOuvriers(g.id, noms, "ajouter")}
                  title={tachesGroupe.length === 0
                    ? "Aucune tâche dans ce groupe"
                    : dejaTous
                      ? `${noms.join(", ")} — déjà affectés à toutes les tâches du groupe`
                      : `Pré-remplir les ouvriers des ${tachesGroupe.length} tâche(s) du groupe avec ${noms.join(", ")}${prop.prioritaires ? " (prioritaires sur ce groupe)" : " (toute l'équipe)"} — proposé, jamais imposé`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 9px", borderRadius: 999,
                    border: `1px solid color-mix(in srgb, ${eq.couleur || "#888"} 55%, transparent)`,
                    background: `color-mix(in srgb, ${eq.couleur || "#888"} 10%, transparent)`,
                    color: T.text, fontFamily: "inherit", fontSize: 10, fontWeight: 700,
                    cursor: (tachesGroupe.length === 0 || dejaTous) ? "default" : "pointer",
                    opacity: (tachesGroupe.length === 0 || dejaTous) ? .55 : 1,
                  }}>
                  <Icon as={HardHat} size={11} />
                  {dejaTous
                    ? (prop.prioritaires ? `${noms.join(" + ")} affecté${noms.length > 1 ? "s" : ""}` : `Équipe ${eq.nom} affectée`)
                    : (prop.prioritaires ? `Affecter ${noms.join(" + ")} (${eq.nom})` : `Affecter l'équipe ${eq.nom}`)}
                </button>
              );
            })()}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: .3, color: T.textMuted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={CalendarClock} size={12} /> Dater dès le
              </span>
              <input type="date"
                onChange={e => { if (e.target.value) { planGroupe(g.id, e.target.value); e.target.value = ""; } }}
                title="Répartir automatiquement les dates des tâches en jours ouvrés à partir de cette date"
                style={{ padding: "4px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none" }} />
              {[["−1 j", -1], ["+1 j", 1], ["+1 sem.", 7]].map(([lbl, d]) => (
                <button key={lbl} onClick={() => shiftGroupe(g.id, d)} title={`Décaler tout le groupe de ${d > 0 ? "+" : ""}${d} jour(s)`}
                  style={{ padding: "4px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Corps */}
        {!isCollapsed && (
          <div
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag && overKey !== `group:${g.id}`) setOverKey(`group:${g.id}`); }}
            onDrop={e => { e.preventDefault(); handleDrop(g.id, null); }}
            style={{
              borderRadius: RADIUS.lg,
              border: `1.5px dashed ${emptyOver ? couleur : T.border}`,
              background: emptyOver ? `color-mix(in srgb, ${couleur} 8%, transparent)` : "transparent",
              padding: "4px 10px", minHeight: 52, transition: "border-color .12s, background .12s",
            }}>
            {/* Le jalon de contrôle étant toujours présent, « liste vide » ne
                signifie plus « groupe vide » : on teste l'absence de tâches. */}
            {!allEntries.some(e => e.kind === "tache") ? (
              <div style={{ textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size, padding: "14px 0 4px", fontStyle: "italic" }}>
                Glissez des tâches ici, ajoutez un jalon…
              </div>
            ) : !entries.some(e => e.kind === "tache") ? (
              <div style={{ textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size, padding: "14px 0 4px", fontStyle: "italic" }}>
                Aucune tâche ne correspond au filtre.
              </div>
            ) : null}
            {entries.map(e => {
              const ui = allEntries.findIndex(x => x.kind === e.kind && x.id === e.id);
              return e.kind === "tache"
                ? renderRow(e.it, couleur, g.id, ui)
                : renderJalon(e.jalon, couleur, g.id, ui);
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={scrollRef} onDragOver={onRootDragOver} onDrop={stopAutoScroll} className="chrono-root"
      style={{ flex: 1, overflowY: "auto", padding: "18px 22px", minHeight: 0 }}>
      <style>{`
        .chrono-row:hover {
          border-color: color-mix(in srgb, var(--c) 55%, transparent) !important;
          box-shadow: 0 3px 12px color-mix(in srgb, var(--c) 20%, transparent);
        }
        /* Bouton "comptes rendus" : masqué, révélé au survol de la ligne. */
        .chrono-cr-btn { opacity: 0; transition: opacity .12s, color .12s, border-color .12s; }
        .chrono-row:hover .chrono-cr-btn { opacity: 1; }
        .chrono-cr-btn:hover {
          border-color: color-mix(in srgb, var(--c) 60%, transparent) !important;
          color: var(--c) !important;
        }
        /* ── Mobile : la ligne de tâche (8 éléments en ligne sur desktop)
           passe sur DEUX lignes — nom + % en haut, groupe + date en bas —
           au lieu de déborder de l'écran. Desktop inchangé. ── */
        @media(max-width:767px) {
          .chrono-root { padding: 12px 10px !important; }
          .chrono-row { flex-wrap: wrap; row-gap: 8px; }
          .chrono-row > *:last-child { order: 4; margin-left: auto; } /* le % reste en 1re ligne, calé à droite */
          .chrono-row > select {
            order: 5; flex: 1 1 48%; min-width: 0; max-width: none !important;
            font-size: 16px !important; /* anti-zoom iOS */
          }
          .chrono-row > input[type=date] {
            order: 6; flex: 1 1 36%; min-width: 0;
            font-size: 16px !important;
          }
          .chrono-row .chrono-cr-btn { order: 7; opacity: 1; } /* pas de survol au doigt */
          .chrono-jalon { flex-wrap: wrap; row-gap: 6px; }
          .chrono-jalon > input[type=date] { font-size: 16px !important; }
          /* Ligne titre du groupe : le nom garde une largeur lisible, les
             badges/boutons passent à la ligne si besoin. */
          .chrono-group-title { flex-wrap: wrap; row-gap: 6px; }
          .chrono-group-title > input:not([type=color]) { flex: 1 1 140px !important; }
        }
      `}</style>

      {/* Barre d'action */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: FONT.md.size, fontWeight: 800, color: T.text }}>Vue chronologique</div>
          <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
            Regroupez, ordonnez (glisser-déposer), datez les tâches et intercalez des jalons.
          </div>
        </div>
        <span style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: FONT.xs.size, fontWeight: 700, color: T.textSub,
          background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.pill, padding: "4px 10px",
        }}>
          <Icon as={CalendarClock} size={12} /> Aujourd'hui · {todayLbl}
        </span>
        {/* Semis depuis les groupes types (référentiel Admin). Sur un phasage
            vierge : application directe. Sinon : confirmation (ajouter les
            manquants — défaut — ou tout remplacer). */}
        {onInitGroupesTypes && (
          <button onClick={() => chronoVierge ? onInitGroupesTypes("init") : setInitConfirm(true)}
            title="Créer les groupes du chantier depuis le référentiel des groupes types (Admin) et classer les tâches par lot"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: `1px dashed ${T.border}`, background: "transparent", color: T.textSub,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
            <Icon as={Sparkles} size={14} /> Initialiser depuis les groupes types
          </button>
        )}
        <button onClick={addGroupe}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: RADIUS.md,
            border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
          }}>
          <Icon as={FolderPlus} size={14} /> Nouveau groupe
        </button>
      </div>

      {/* Confirmation : le chantier a déjà des groupes — rien ne bouge sans choix explicite. */}
      {initConfirm && (
        <div onClick={() => setInitConfirm(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.modal || T.surface, borderRadius: RADIUS.xl, padding: 24,
            width: "100%", maxWidth: 500, border: `1px solid ${T.border}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon as={Sparkles} size={20} />
              </div>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Initialiser depuis les groupes types</div>
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 18 }}>
              Ce chantier a déjà <strong style={{ color: T.text }}>{groupes.length} groupe{groupes.length > 1 ? "s" : ""}</strong>.
              {nbGtManquants > 0
                ? <> Tu peux <strong style={{ color: T.text }}>ajouter les {nbGtManquants} groupe{nbGtManquants > 1 ? "s" : ""} type{nbGtManquants > 1 ? "s" : ""} manquant{nbGtManquants > 1 ? "s" : ""}</strong> sans rien toucher à l'existant (recommandé), ou tout remplacer.</>
                : <> Tous les groupes types y sont déjà. Tu peux tout remplacer pour repartir du référentiel.</>}
              <br /><span style={{ color: "#e15a5a", fontSize: FONT.xs.size + 1 }}>« Tout remplacer » supprime les groupes et jalons actuels, reclasse les tâches par lot et perd l'ordre manuel.</span>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button onClick={() => setInitConfirm(false)} style={{
                background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md, padding: "9px 16px", color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={() => { onInitGroupesTypes("remplacer"); setInitConfirm(false); }} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: "transparent", color: "#e15a5a", border: "1px solid #e15a5a",
                borderRadius: RADIUS.md, padding: "9px 16px",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
              }}>
                <Icon as={AlertTriangle} size={13} />
                Tout remplacer
              </button>
              {nbGtManquants > 0 && (
                <button onClick={() => { onInitGroupesTypes("ajouter"); setInitConfirm(false); }} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: acc.accent, color: acc.onAccent, border: "none",
                  borderRadius: RADIUS.md, padding: "9px 16px",
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
                }}>
                  <Icon as={Plus} size={13} />
                  Ajouter les manquants ({nbGtManquants})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation : des tâches du groupe ont déjà des ouvriers saisis. */}
      {affectConfirm && (() => {
        const { groupeId, equipe, noms, nbAvecOuvriers } = affectConfirm;
        return (
          <div onClick={() => setAffectConfirm(null)} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)",
          }}>
            <div onClick={e => e.stopPropagation()} style={{
              background: T.modal || T.surface, borderRadius: RADIUS.xl, padding: 24,
              width: "100%", maxWidth: 500, border: `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0, background: `color-mix(in srgb, ${equipe.couleur || "#888"} 14%, transparent)`, color: equipe.couleur || T.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon as={HardHat} size={20} />
                </div>
                <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Affecter l'équipe {equipe.nom}&nbsp;?</div>
              </div>
              <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 18 }}>
                Ouvriers proposés : <strong style={{ color: T.text }}>{noms.join(", ")}</strong>.
                <br />{nbAvecOuvriers} tâche{nbAvecOuvriers > 1 ? "s" : ""} de ce groupe {nbAvecOuvriers > 1 ? "ont" : "a"} déjà des ouvriers saisis.
                Tu peux <strong style={{ color: T.text }}>ajouter l'équipe aux ouvriers existants</strong> (recommandé) ou les remplacer.
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                <button onClick={() => setAffectConfirm(null)} style={{
                  background: "transparent", border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md, padding: "9px 16px", color: T.textSub,
                  fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
                }}>Annuler</button>
                <button onClick={() => { onAffecterOuvriers(groupeId, noms, "remplacer"); setAffectConfirm(null); }} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: "transparent", color: "#e15a5a", border: "1px solid #e15a5a",
                  borderRadius: RADIUS.md, padding: "9px 16px",
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
                }}>
                  <Icon as={AlertTriangle} size={13} />
                  Remplacer les ouvriers
                </button>
                <button onClick={() => { onAffecterOuvriers(groupeId, noms, "ajouter"); setAffectConfirm(null); }} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  background: acc.accent, color: acc.onAccent, border: "none",
                  borderRadius: RADIUS.md, padding: "9px 16px",
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
                }}>
                  <Icon as={Plus} size={13} />
                  Ajouter aux existants
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {items.length === 0 && groupesTries.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl }}>
          Aucune tâche pour ce chantier.
        </div>
      ) : (
        <>
          {/* Encart « Où en est-on ? » : synthèse d'avancement + prochaines tâches
              (exploite l'ordre défini : groupes triés → tâches triées). */}
          {(() => {
            const plan = groupesTries.flatMap(g => itemsOfGroup(g.id).map(it => ({ it, g })));
            const total = plan.length;
            if (total === 0) return null;
            const avOf = (t) => Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
            const done = plan.filter(x => avOf(x.it.tache) >= 100).length;
            const enCours = plan.filter(x => { const a = avOf(x.it.tache); return a > 0 && a < 100; }).length;
            const pct = Math.round((done / total) * 100);
            // Ordre des « prochaines tâches » : la DATE prime (croissante) ;
            // à défaut de date (ou à date égale), on suit l'ordre manuel.
            const idxOf = new Map(plan.map((x, i) => [x.it.tache.id, i]));
            const incomplete = plan.filter(x => avOf(x.it.tache) < 100).sort((a, b) => {
              const da = parseD(a.it.tache.date_prevue), db = parseD(b.it.tache.date_prevue);
              const ka = da ? da.getTime() : Infinity, kb = db ? db.getTime() : Infinity;
              if (ka !== kb) return ka - kb;
              return idxOf.get(a.it.tache.id) - idxOf.get(b.it.tache.id);
            });
            const nextTasks = incomplete.slice(0, 6);
            const currentGroup = incomplete[0]?.g || null;
            // « Prochain jalon » = repères datés uniquement (les jalons de
            // contrôle, non datés, vivent dans l'ordre du groupe — Point 2 b).
            const upJalons = jalons.filter(j => { if (estJalonControle(j)) return false; const d = parseD(j.date); return d && d >= today; }).sort((a, b) => parseD(a.date) - parseD(b.date));
            const nextJalon = upJalons[0] || null;
            const daysTo = nextJalon ? Math.round((parseD(nextJalon.date) - today) / 86400000) : null;
            const nbLate = plan.filter(x => overdueT(x.it.tache)).length;
            const nbUnassigned = unassigned.length;
            return (
              <div style={{ marginBottom: 18, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, background: T.card, overflow: "hidden" }}>
                <div onClick={() => setFocusOpen(o => !o)}
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: focusOpen ? `1px solid ${T.border}` : "none" }}>
                  <Icon as={focusOpen ? ChevronDown : ChevronRight} size={16} color={T.textMuted} />
                  <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>Où en est-on ?</span>
                  <span style={{ marginLeft: "auto", fontSize: FONT.xs.size + 1, fontWeight: 800, color: pct >= 100 ? "#22c55e" : acc.accent }}>{done}/{total} tâches · {pct}%</span>
                </div>
                {focusOpen && (
                  <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 160, height: 10, borderRadius: 99, background: T.border, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? "#22c55e" : acc.accent, transition: "width .3s" }} />
                      </div>
                      <div style={{ display: "flex", gap: 12, fontSize: FONT.xs.size, color: T.textSub, flexWrap: "wrap" }}>
                        <span><strong style={{ color: "#22c55e" }}>{done}</strong> terminées</span>
                        <span><strong style={{ color: acc.accent }}>{enCours}</strong> en cours</span>
                        <span><strong>{total - done - enCours}</strong> à faire</span>
                        {nbLate > 0 && <span style={{ color: "#e15a5a", fontWeight: 700 }}>⚠ {nbLate} en retard</span>}
                        {nbUnassigned > 0 && <span style={{ color: T.textMuted }}>{nbUnassigned} non classée{nbUnassigned > 1 ? "s" : ""}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: FONT.xs.size }}>
                      {currentGroup && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.textSub }}>
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5, color: T.textMuted }}>Étape en cours</span>
                          <span style={{ width: 9, height: 9, borderRadius: 3, background: currentGroup.couleur || acc.accent }} />
                          <strong style={{ color: T.text }}>{currentGroup.nom || "(groupe)"}</strong>
                        </span>
                      )}
                      {nextJalon && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.textSub }}>
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5, color: T.textMuted }}>Prochain jalon</span>
                          <Icon as={Flag} size={12} color="#f5a623" />
                          <strong style={{ color: T.text }}>{nextJalon.nom || "Jalon"}</strong>
                          <span style={{ color: T.textMuted }}>· {daysTo === 0 ? "aujourd'hui" : daysTo === 1 ? "demain" : `dans ${daysTo} j`} ({fmtShort(parseD(nextJalon.date))})</span>
                        </span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: .6, color: T.textMuted, marginBottom: 6 }}>Prochaines tâches</div>
                      {nextTasks.length === 0 ? (
                        <div style={{ fontSize: FONT.sm.size, color: "#22c55e", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <Icon as={Check} size={14} /> Tout est terminé 🎉
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                          {nextTasks.map(({ it, g }, idx) => {
                            const t = it.tache; const a = avOf(t); const late = overdueT(t); const d = parseD(t.date_prevue);
                            return (
                              <div key={t.id} onClick={() => onClickTache(it.ouvrageId, t.id)}
                                style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: RADIUS.sm, background: T.surface, border: `1px solid ${idx === 0 ? acc.border : T.border}`, cursor: "pointer" }}>
                                <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, background: idx === 0 ? acc.accent : T.card, color: idx === 0 ? (acc.onAccent || "#000") : T.textMuted, border: `1px solid ${idx === 0 ? acc.accent : T.border}` }}>{idx + 1}</span>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: g.couleur || acc.accent, flexShrink: 0 }} />
                                <span style={{ flex: 1, minWidth: 0, fontSize: FONT.sm.size, fontWeight: idx === 0 ? 800 : 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.nom || "(sans nom)"}</span>
                                {a > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: acc.accent, flexShrink: 0 }}>en cours {a}%</span>}
                                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nom || ""}</span>
                                {d && <span style={{ fontSize: FONT.xs.size, fontWeight: late ? 800 : 600, color: late ? "#e15a5a" : T.textSub, flexShrink: 0, whiteSpace: "nowrap" }}>{late ? "⚠ " : ""}{fmtShort(d)}</span>}
                              </div>
                            );
                          })}
                          {incomplete.length > nextTasks.length && (
                            <div style={{ fontSize: FONT.xs.size, color: T.textMuted, paddingLeft: 2 }}>+ {incomplete.length - nextTasks.length} autre{incomplete.length - nextTasks.length > 1 ? "s" : ""} à venir</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Barre de filtres */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap", fontSize: FONT.xs.size }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.textMuted, fontWeight: 700 }}>
              <Icon as={Filter} size={13} /> Filtres
            </span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} style={{ cursor: "pointer", accentColor: acc.accent }} />
              Masquer les terminées
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={onlyTodo} onChange={e => setOnlyTodo(e.target.checked)} style={{ cursor: "pointer", accentColor: acc.accent }} />
              Seulement « À classer »
            </label>
            {lotsPresent.length > 0 && (
              <select value={filterLot} onChange={e => setFilterLot(e.target.value)}
                style={{ padding: "4px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer" }}>
                <option value="">Tous les lots</option>
                {lotsPresent.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            )}
            {(hideDone || onlyTodo || filterLot) && (
              <button onClick={() => { setHideDone(false); setOnlyTodo(false); setFilterLot(""); }}
                style={{ padding: "4px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
                Réinitialiser
              </button>
            )}
          </div>

          {/* Barre d'action groupée (sélection multiple) */}
          {selected.size > 0 && (
            <div style={{
              position: "sticky", top: 0, zIndex: 5,
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              marginBottom: 14, padding: "8px 12px", borderRadius: RADIUS.md,
              background: acc.bg10, border: `1px solid ${acc.border}`,
            }}>
              <span style={{ fontSize: FONT.sm.size, fontWeight: 800, color: acc.accent }}>
                {selected.size} tâche{selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: FONT.xs.size, color: T.textSub }}>Envoyer vers :</span>
              <select value="" onChange={e => { if (e.target.value !== "") bulkAssign(e.target.value === "_unassigned" ? null : e.target.value); }}
                style={{ padding: "5px 9px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: T.fieldBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer" }}>
                <option value="">— choisir un groupe —</option>
                {groupesTries.map(g => <option key={g.id} value={g.id}>{g.nom || "(groupe)"}</option>)}
                <option value="_unassigned">À classer</option>
              </select>
              <button onClick={clearSelect}
                style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
                Effacer la sélection
              </button>
            </div>
          )}

          {/* À classer */}
          {(() => {
            const shown = unassigned.filter(passFilters);
            if (shown.length === 0) return null;
            return (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <button onClick={() => setUnassignedCollapsed(v => !v)}
                    title={unassignedCollapsed ? "Déplier" : "Replier"}
                    style={{ width: 22, height: 22, borderRadius: RADIUS.sm, border: "none", background: "transparent", color: T.textMuted, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon as={unassignedCollapsed ? ChevronRight : ChevronDown} size={15} />
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted }}>À classer</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, background: T.card, borderRadius: RADIUS.pill, padding: "2px 9px" }}>{shown.length}</span>
                </div>
                {!unassignedCollapsed && (
                  <div
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (drag && overKey !== "unassigned") setOverKey("unassigned"); }}
                    onDrop={e => { e.preventDefault(); handleDropUnassigned(); }}
                    style={{
                      borderRadius: RADIUS.lg,
                      border: `1.5px dashed ${overKey === "unassigned" ? acc.accent : T.border}`,
                      background: overKey === "unassigned" ? acc.bg10 : "transparent",
                      padding: "4px 10px",
                    }}>
                    {shown.map((it, i) => renderRow(it, T.textMuted, null, i))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Groupes */}
          {onlyTodo ? null : groupesTries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: RADIUS.xl }}>
              <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>Aucun groupe</div>
              <div style={{ fontSize: FONT.sm.size }}>Créez un premier groupe, puis glissez-y les tâches « à classer ».</div>
            </div>
          ) : (
            groupesTries.map((g, i) => renderGroup(g, i))
          )}
        </>
      )}

      {/* ── Écran de contrôle de fin de groupe (Point 2 b) : overlay plein
          écran, tâches lues DIRECTEMENT du phasage (aucune copie). ── */}
      {controleOuvert && (
        <ControleGroupe
          chantierId={controleCtx?.chantierId}
          chantierNom={controleCtx?.chantierNom}
          phasageId={controleCtx?.phasageId}
          auteur={controleCtx?.auteur || ""}
          groupe={controleOuvert}
          taches={itemsOfGroup(controleOuvert.id).map(it => ({
            id: it.tache.id, nom: it.tache.nom || "", ouvrage: it.ouvrage?.libelle || "",
          }))}
          onClose={() => { setControleOuvert(null); onControleChange?.(); }}
        />
      )}
    </div>
  );
}

function GanttV2({ ouvrages, lots, jalons, groupes, acc, T, avancementOuvrage, tacheHeuresReelles, crWindowPourTache, onClickTache }) {
  const DAY_PX = 28, ROW_H = 30, LABEL_W = 280, HEADER_H = 56;
  // Lots repliés (local à la vue, non persisté).
  const [collapsedLots, setCollapsedLots] = useState(() => new Set());
  const toggleLot = (lotId) => setCollapsedLots(s => {
    const n = new Set(s);
    n.has(lotId) ? n.delete(lotId) : n.add(lotId);
    return n;
  });
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const addDays    = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
  const isWeekend  = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
  const parseDate  = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
  const fmtDay     = (d) => d.toLocaleDateString("fr-FR", { day: "numeric" });
  const fmtMonth   = (d) => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const isoDay     = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const todayISO   = isoDay(startOfDay(new Date()));

  // ── Construit la liste plate { lot, ouvrage, tache } pour les tâches qui
  //    ont une date_prevue. Les tâches jamais datées mais déjà travaillées
  //    (au moins un compte rendu lié) sont placées sur leur fenêtre
  //    d'exécution réelle (premier → dernier CR), marquées fromCR. Les
  //    autres vont dans le bloc « Non planifiées ».
  const rows = [];
  const orphans = [];
  ouvrages.forEach(o => {
    const lot = lots.find(l => l.id === o.lot_id) || { id: "_x", label: "Sans lot", couleur: "#888" };
    (o.taches || []).forEach(t => {
      const d = parseDate(t.date_prevue);
      if (d) { rows.push({ lot, ouvrage: o, tache: t, date: d }); return; }
      const win = crWindowPourTache(t);
      if (win) rows.push({ lot, ouvrage: o, tache: t, date: win.debut, dateFin: win.fin, fromCR: true });
      else orphans.push({ lot, ouvrage: o, tache: t });
    });
  });

  // ── Plage de dates : du min des date_prevue à +35 jours après le max.
  //    Si rien de planifié, on affiche aujourd'hui + 30 jours.
  const dates = rows.flatMap(r => r.dateFin ? [r.date, r.dateFin] : [r.date]);
  let dateMin = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : startOfDay(new Date());
  let dateMax = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : addDays(new Date(), 30);
  // 3 jours de marge avant, 14 jours après le max (ou heures longues).
  dateMin = addDays(dateMin, -3);
  dateMax = addDays(dateMax, 14);

  // Liste des jours affichés (skip weekends)
  const days = [];
  for (let d = startOfDay(dateMin); d <= dateMax; d = addDays(d, 1)) {
    if (!isWeekend(d)) days.push(new Date(d));
  }
  const dayIndex = (d) => {
    const target = isoDay(d);
    return days.findIndex(x => isoDay(x) === target);
  };
  const totalWidth = days.length * DAY_PX;

  // Groupes pour entêtes de mois
  const monthsHeader = [];
  let lastMonthKey = "";
  days.forEach((d, i) => {
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (k !== lastMonthKey) {
      monthsHeader.push({ label: fmtMonth(d), startIdx: i, span: 1 });
      lastMonthKey = k;
    } else {
      monthsHeader[monthsHeader.length - 1].span += 1;
    }
  });

  // Tri des rows : par lot.id puis par ouvrage puis par date
  rows.sort((a, b) => {
    if (a.lot.id !== b.lot.id) return a.lot.id.localeCompare(b.lot.id);
    if (a.ouvrage.id !== b.ouvrage.id) return (a.ouvrage.libelle || "").localeCompare(b.ouvrage.libelle || "");
    return a.date.getTime() - b.date.getTime();
  });

  // Tri des non planifiées : ordre chrono métier (groupes de la vue
  // Chronologique), plus dans l'ordre de saisie du devis.
  sortByChrono(orphans, groupes);

  // ── Sections par lot : tâches datées + non planifiées du même lot sous un
  //    seul en-tête repliable. Ordre des sections = ordre d'apparition dans
  //    les rows triées, puis les lots qui n'ont que du non-planifié.
  const lotSections = [];
  const sectionByLot = new Map();
  const sectionFor = (lot) => {
    let s = sectionByLot.get(lot.id);
    if (!s) { s = { lot, dated: [], unplanned: [] }; sectionByLot.set(lot.id, s); lotSections.push(s); }
    return s;
  };
  rows.forEach(r => sectionFor(r.lot).dated.push(r));
  orphans.forEach(r => sectionFor(r.lot).unplanned.push(r));
  // Avancement d'un lot : pondéré par les heures vendues quand elles existent,
  // sinon moyenne simple des tâches.
  const avancementSection = (s) => {
    const ts = [...s.dated, ...s.unplanned].map(r => r.tache);
    if (!ts.length) return 0;
    let wsum = 0, wtot = 0, sum = 0;
    ts.forEach(t => {
      const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
      const h = parseFloat(t.heures_vendues) || 0;
      sum += av;
      if (h > 0) { wsum += h * av; wtot += h; }
    });
    return Math.round(wtot > 0 ? wsum / wtot : sum / ts.length);
  };

  // Longueur en jours (skip weekends) à partir des heures estimées (~ 7h/jour)
  const dureeJours = (t) => {
    const h = parseFloat(t.heures_estimees);
    if (!h || isNaN(h) || h <= 0) return 1;
    return Math.max(1, Math.ceil(h / 7));
  };

  if (rows.length === 0 && orphans.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{
          background: T.card, border: `1px dashed ${T.border}`,
          borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
          maxWidth: 460, color: T.textMuted,
        }}>
          <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Aucune tâche à afficher
          </div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6 }}>
            Ajoute des tâches et planifie-les (modale tâche → "Envoyer dans le planning") pour les voir sur le Gantt.
          </div>
        </div>
      </div>
    );
  }

  // ── Rendu
  return (
    <div style={{ flex: 1, overflow: "auto", background: T.bg, padding: 0 }}>
      <div style={{ position: "relative", width: LABEL_W + totalWidth, minWidth: "100%" }}>
        {/* Header dates (sticky) */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: T.surface, borderBottom: `1px solid ${T.border}`,
          height: HEADER_H,
          display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
        }}>
          <div style={{
            borderRight: `1px solid ${T.border}`,
            padding: "10px 14px", display: "flex", alignItems: "center",
            fontSize: FONT.xs.size, fontWeight: 800, color: T.textMuted, letterSpacing: .8, textTransform: "uppercase",
          }}>
            Tâche / Ouvrage
          </div>
          <div style={{ position: "relative", height: HEADER_H }}>
            {/* Ligne mois */}
            <div style={{ display: "flex", height: HEADER_H / 2, borderBottom: `1px solid ${T.border}` }}>
              {monthsHeader.map((m, i) => (
                <div key={i} style={{
                  width: m.span * DAY_PX, padding: "0 8px",
                  display: "flex", alignItems: "center",
                  fontSize: FONT.xs.size, fontWeight: 700, color: T.text,
                  borderRight: `1px solid ${T.border}`,
                }}>
                  {m.label}
                </div>
              ))}
            </div>
            {/* Ligne jours */}
            <div style={{ display: "flex", height: HEADER_H / 2 }}>
              {days.map((d, i) => {
                const today = isoDay(d) === todayISO;
                return (
                  <div key={i} style={{
                    width: DAY_PX, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: today ? 800 : 600,
                    color: today ? acc.accent : T.textMuted,
                    background: today ? acc.bg10 : "transparent",
                    borderRight: `1px solid ${T.border}`,
                  }}>
                    {fmtDay(d)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sections par lot : en-tête repliable, tâches datées puis non
            planifiées du lot (celles-ci sans barre, ordre chrono métier). */}
        {(() => {
          const els = [];
          let stripe = 0;
          // Cellule label commune (nom + ouvrage + avancement à droite).
          const labelCell = (r, note, clickable) => {
            const av = Math.max(0, Math.min(100, parseInt(r.tache.avancement) || 0));
            return (
              <div onClick={clickable ? () => onClickTache(r.ouvrage.id, r.tache.id) : undefined}
                style={{ padding: "0 10px 0 14px", borderRight: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: clickable ? "pointer" : "default" }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 1 }}>
                  <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.tache.nom || "(sans nom)"}
                  </div>
                  <div style={{ fontSize: 9, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.ouvrage.libelle || "(sans libellé)"}{note || ""}
                  </div>
                </div>
                <InfoBulle contenu={`${av}% réalisé`} T={T}>
                  <span style={{
                    flexShrink: 0, fontSize: 10, fontWeight: 800, minWidth: 32, textAlign: "right",
                    color: av >= 100 ? "#22c55e" : av > 0 ? acc.accent : T.textMuted,
                  }}>
                    {av}%
                  </span>
                </InfoBulle>
              </div>
            );
          };
          const dayGrid = () => days.map((d, i) => {
            const today = isoDay(d) === todayISO;
            return (
              <div key={i} style={{
                position: "absolute", left: i * DAY_PX, top: 0, width: DAY_PX, height: "100%",
                borderRight: `1px solid ${T.border}`,
                background: today ? `color-mix(in srgb, ${acc.accent} 8%, transparent)` : "transparent",
              }}/>
            );
          });
          lotSections.forEach(sec => {
            const lot = sec.lot;
            const isCollapsed = collapsedLots.has(lot.id);
            const total = sec.dated.length + sec.unplanned.length;
            const avLot = avancementSection(sec);
            // En-tête de lot (clic = replier/déplier)
            els.push(
              <div key={`lot-${lot.id}`} onClick={() => toggleLot(lot.id)}
                title={isCollapsed ? "Déplier le lot" : "Replier le lot"}
                style={{
                  display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                  background: `color-mix(in srgb, ${lot.couleur} 14%, transparent)`,
                  borderTop: `1px solid ${T.border}`,
                  borderBottom: `1px solid ${T.border}`,
                  height: 26, alignItems: "center", cursor: "pointer",
                }}>
                <div style={{ padding: "0 10px 0 14px", borderRight: `1px solid ${T.border}`, height: "100%", display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Icon as={isCollapsed ? ChevronRight : ChevronDown} size={13} color={T.textMuted} style={{ flexShrink: 0 }} />
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: lot.couleur, flexShrink: 0 }}/>
                  <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: T.text, textTransform: "uppercase", letterSpacing: .5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lot.label}</span>
                  <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: 10, fontWeight: 800, color: avLot >= 100 ? "#22c55e" : T.textSub }}>
                    {avLot}%
                  </span>
                </div>
                <div style={{ padding: "0 10px", fontSize: 10, fontWeight: 700, color: T.textMuted }}>
                  {total} tâche{total > 1 ? "s" : ""}
                  {sec.unplanned.length > 0 ? ` · ${sec.unplanned.length} non planifiée${sec.unplanned.length > 1 ? "s" : ""}` : ""}
                </div>
              </div>
            );
            if (isCollapsed) return;
            // Tâches datées (ou placées d'après les CR)
            sec.dated.forEach(r => {
              // fromCR : la barre couvre la fenêtre réelle premier → dernier
              // CR (jours ouvrés affichés, en glissant au jour ouvré suivant
              // si un CR tombe un week-end) ; sinon date_prevue + durée.
              let startIdx = dayIndex(r.date);
              if (startIdx < 0 && r.fromCR) startIdx = days.findIndex(x => x.getTime() >= r.date.getTime());
              let spanDays;
              if (r.fromCR) {
                let end = days.length - 1;
                while (end > startIdx && days[end].getTime() > r.dateFin.getTime()) end--;
                spanDays = Math.max(1, end - startIdx + 1);
              } else {
                spanDays = Math.min(days.length - Math.max(0, startIdx), dureeJours(r.tache));
              }
              const left = startIdx >= 0 ? startIdx * DAY_PX : 0;
              const widthBar = spanDays * DAY_PX - 4;
              const av = Math.max(0, Math.min(100, parseInt(r.tache.avancement) || 0));
              const barColor = av >= 100 ? "#22c55e" : r.lot.couleur;
              const hr = tacheHeuresReelles(r.tache);
              const dateLbl = r.fromCR
                ? `${r.date.toLocaleDateString("fr-FR")} → ${r.dateFin.toLocaleDateString("fr-FR")} (d'après les comptes rendus — pas de date prévue)`
                : r.date.toLocaleDateString("fr-FR");
              const tooltip = `${r.tache.nom || "(sans nom)"} — ${dateLbl} — ${av}%${r.tache.heures_estimees ? ` — ${hr || 0}h/${r.tache.heures_estimees}h` : ""}`;
              stripe += 1;
              els.push(
                <div key={`row-${r.tache.id}`} style={{
                  display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                  height: ROW_H, borderBottom: `1px solid ${T.border}`,
                  background: stripe % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                }}>
                  {labelCell(r, r.fromCR ? " · d'après CR" : "", true)}
                  <div style={{ position: "relative", height: ROW_H }}>
                    {dayGrid()}
                    {/* Barre tâche */}
                    {startIdx >= 0 && (
                      <div onClick={() => onClickTache(r.ouvrage.id, r.tache.id)}
                        title={tooltip}
                        style={{
                          position: "absolute", left: left + 2, top: 4, width: Math.max(20, widthBar),
                          height: ROW_H - 8, borderRadius: 5,
                          background: `linear-gradient(to right,
                            color-mix(in srgb, ${barColor} 80%, transparent) 0,
                            color-mix(in srgb, ${barColor} 80%, transparent) ${av}%,
                            color-mix(in srgb, ${barColor} 30%, transparent) ${av}%,
                            color-mix(in srgb, ${barColor} 30%, transparent) 100%)`,
                          border: r.fromCR ? `1.5px dashed ${barColor}` : `1px solid ${barColor}`,
                          color: "#000", fontSize: 10, fontWeight: 800,
                          display: "flex", alignItems: "center", padding: "0 8px",
                          cursor: "pointer", overflow: "hidden",
                          boxShadow: `0 2px 4px color-mix(in srgb, ${barColor} 30%, transparent)`,
                        }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.tache.nom || ""} {av > 0 ? `· ${av}%` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            });
            // Tâches non planifiées du lot (pas de date, pas de CR)
            sec.unplanned.forEach(r => {
              stripe += 1;
              els.push(
                <div key={`unp-${r.tache.id}`} style={{
                  display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                  height: ROW_H, borderBottom: `1px solid ${T.border}`,
                  background: stripe % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                  opacity: .6,
                }}>
                  {labelCell(r, " · non planifiée", true)}
                  <div onClick={() => onClickTache(r.ouvrage.id, r.tache.id)}
                    style={{ position: "relative", height: ROW_H, cursor: "pointer" }}>
                    {dayGrid()}
                    <div style={{ position: "sticky", left: LABEL_W + 14, display: "inline-flex", alignItems: "center", height: "100%", paddingLeft: 14, fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic", whiteSpace: "nowrap" }}>
                      Non planifiée — clique pour planifier
                    </div>
                  </div>
                </div>
              );
            });
          });
          return els;
        })()}

        {/* Jalons : repères verticaux datés (issus de la vue Chronologique) */}
        {(jalons || []).some(j => j.date) && (() => {
          const xForDate = (d) => {
            if (!d) return null;
            let idx = dayIndex(d);
            if (idx < 0) idx = days.findIndex(x => x.getTime() >= d.getTime());
            return idx < 0 ? null : idx * DAY_PX;
          };
          const col = "#f5a623";
          return (
            <div style={{ position: "absolute", left: LABEL_W, top: HEADER_H, width: totalWidth, bottom: 0, pointerEvents: "none", zIndex: 6 }}>
              {jalons.filter(j => j.date).map((j, i) => {
                const x = xForDate(parseDate(j.date));
                if (x == null) return null;
                return (
                  <div key={j.id} style={{ position: "absolute", left: x, top: 0, bottom: 0 }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderLeft: `2px dashed ${col}` }} />
                    <div style={{
                      position: "absolute", left: 3, top: 2 + (i % 4) * 16, whiteSpace: "nowrap",
                      display: "inline-flex", alignItems: "center", gap: 3,
                      background: col, color: "#000", fontSize: 9, fontWeight: 800,
                      padding: "1px 6px", borderRadius: 4, boxShadow: "0 1px 3px rgba(0,0,0,.3)",
                    }}>
                      ⚑ {j.nom || "Jalon"}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── KPI compact (footer phasage v2) ──────────────────────────────────────────
function KpiBlock({ T, label, value, sub, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
        color: T.textMuted,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{
          fontSize: FONT.sm.size + 2, fontWeight: 800, letterSpacing: -.2,
          color: accent || T.text,
        }}>
          {value}
        </span>
        {sub && (
          <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: accent || T.textMuted }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── KPI fusionné : Marge cible + Prime équipe ────────────────────────────────
function KpiCibleEtPrime({ T, margeCible, margePct, prime, seuilPrime, prixHT }) {
  const cibleAtteinte = margeCible > 0 && prixHT > 0 && margePct >= margeCible;
  const primeAcquise  = prime > 0 && seuilPrime > 0 && prixHT > 0 && margePct >= seuilPrime;
  const line = (label, value, sub, ok) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted, minWidth: 38 }}>{label}</span>
        <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: ok ? "#22c55e" : T.text, letterSpacing: -.2 }}>{value}</span>
      </div>
      {sub && (
        <span style={{ fontSize: 9, fontWeight: 700, color: ok ? "#22c55e" : T.textMuted, whiteSpace: "nowrap" }}>
          {sub}
        </span>
      )}
    </div>
  );
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: RADIUS.md, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted,
      }}>
        <span style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          background: "color-mix(in srgb, #ec4899 18%, transparent)",
          color: "#ec4899",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={Target} size={11} strokeWidth={2.4}/>
        </span>
        Objectifs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {margeCible > 0 && line(
          "Cible",
          `${margeCible}%`,
          prixHT > 0 ? (cibleAtteinte ? "✓ atteinte" : `+${(margeCible - margePct).toFixed(1)}% à faire`) : null,
          cibleAtteinte,
        )}
        {prime > 0 && line(
          "Prime",
          `${Math.round(prime).toLocaleString("fr-FR")} €`,
          seuilPrime > 0 ? (primeAcquise ? "✓ acquise" : `seuil ${seuilPrime}%`) : null,
          primeAcquise,
        )}
      </div>
    </div>
  );
}

// ─── KPI Card (variante visuelle avec icône) ──────────────────────────────────
// ─── Composants modale d'édition ───────────────────────────────────────────────
const modalInp = (T) => ({
  width: "100%", padding: "9px 12px", borderRadius: RADIUS.md,
  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
  color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none",
});
function ModalField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", marginBottom: 5, opacity: .65 }}>{label}</div>
      {children}
    </div>
  );
}
function ItemEditModal({ title, color, T, accent, onClose, onDelete, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl,
        border: `1px solid ${T.border}`, borderLeft: `5px solid ${color}`,
        width: "100%", maxWidth: 560,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", maxHeight: "90vh",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0,
            background: `color-mix(in srgb, ${color} 20%, transparent)`,
            color: color, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={Pencil} size={14}/>
          </div>
          <div style={{ flex: 1, fontSize: FONT.md.size, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>{title}</div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted, cursor: "pointer",
            padding: 6, borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center",
          }}><Icon as={X} size={18}/></button>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {children}
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: onDelete ? "space-between" : "flex-end", gap: 10 }}>
          {onDelete && (
            <button onClick={onDelete} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: "1px solid rgba(225,90,90,0.3)", background: "transparent", color: "#e15a5a",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={Trash2} size={13}/>
              Supprimer
            </button>
          )}
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
            background: accent, color: "#000",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
          }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modale d'import devis ────────────────────────────────────────────────────
function ImportDevisModal({ state, lots, bibliotheque = [], T, accent, accentBorder, accentBg10, onUpdateItem, onToggleAll, onClose, onConfirm }) {
  const { items, unknownLotHeaders, parsing, error } = state;
  // Groupe les items par lot pour l'affichage
  const groups = (() => {
    const map = new Map();
    items.forEach(it => {
      const k = it.lot_id || "_orphans";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    });
    return Array.from(map.entries());
  })();
  const nbSel       = items.filter(i => i.selectionne).length;
  const nbMatchCode = items.filter(i => i.matchBy === "code").length;
  const nbMatchLbl  = items.filter(i => i.matchBy === "libelle").length;
  const nbMatchMan  = items.filter(i => i.matchBy === "manuel").length;

  // Bibliothèque triée par libellé pour le sélecteur de liaison manuelle
  const biblioSorted = [...bibliotheque].sort((a, b) =>
    (a.libelle || "").localeCompare(b.libelle || "", "fr"));

  // Lie (ou délie) manuellement un ouvrage importé à une fiche biblio.
  // Tout le reste (tâches, matériaux, cadence) est recalculé depuis it.match
  // au moment de la confirmation → il suffit de mettre à jour match/unite.
  const linkBiblio = (key, bid, prevUnite) => {
    if (!bid) { onUpdateItem(key, { match: null, matchBy: null, score: 0 }); return; }
    const b = biblioSorted.find(x => String(x.id) === String(bid));
    if (!b) return;
    onUpdateItem(key, { match: b, matchBy: "manuel", score: 1, unite: b.unite || prevUnite || "U" });
  };

  const lotLabel = (id) => id === "_orphans" ? "Sans lot" : (lots.find(l => l.id === id)?.label || id);
  const lotCouleur = (id) => id === "_orphans" ? T.textMuted : (lots.find(l => l.id === id)?.couleur || T.textMuted);

  const inp = {
    padding: "5px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
    background: T.fieldBg || T.card, color: T.text, fontSize: FONT.xs.size + 1,
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl, border: `1px solid ${T.border}`,
        width: "100%", maxWidth: 980, maxHeight: "92vh",
        display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: accentBg10, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={FileSpreadsheet} size={17}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>Importer un devis</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              {parsing ? "Analyse en cours…"
                : error ? "Erreur"
                : `${items.length} ouvrage${items.length > 1 ? "s" : ""} détecté${items.length > 1 ? "s" : ""} · ${nbMatchCode} par code · ${nbMatchLbl} par similarité${nbMatchMan > 0 ? ` · ${nbMatchMan} manuel${nbMatchMan > 1 ? "s" : ""}` : ""} · ${nbSel} sélectionné${nbSel > 1 ? "s" : ""}`}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 6,
            borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center",
          }}><Icon as={X} size={18}/></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {parsing ? (
            <div style={{ padding: 60, textAlign: "center", color: T.textMuted }}>Lecture du fichier…</div>
          ) : error ? (
            <div style={{ padding: 16, borderRadius: RADIUS.md, background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.3)", color: "#e15a5a", fontSize: FONT.sm.size }}>
              <Icon as={AlertTriangle} size={14} style={{ verticalAlign: "middle", marginRight: 6 }}/>
              {error}
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
              Aucun ouvrage détecté dans ce fichier.
              {unknownLotHeaders.length > 0 && (
                <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                  En-têtes potentiels trouvés : {unknownLotHeaders.slice(0, 5).join(" · ")}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Actions globales */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => onToggleAll(true)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout cocher</button>
                <button onClick={() => onToggleAll(false)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout décocher</button>
                {unknownLotHeaders.length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                    {unknownLotHeaders.length} en-tête{unknownLotHeaders.length > 1 ? "s" : ""} non reconnu{unknownLotHeaders.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Liste groupée par lot */}
              {groups.map(([lotId, lotItems]) => (
                <div key={lotId} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", marginBottom: 4,
                    background: T.card, borderRadius: RADIUS.sm,
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: lotCouleur(lotId), flexShrink: 0 }}/>
                    <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text, letterSpacing: .5, textTransform: "uppercase" }}>
                      {lotLabel(lotId)}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.surface, color: T.textMuted,
                    }}>{lotItems.length}</span>
                  </div>
                  {lotItems.map(it => (
                    <div key={it._key} style={{
                      display: "grid",
                      gridTemplateColumns: "24px minmax(0, 1fr) 70px 70px 80px 110px",
                      gap: 8, alignItems: "center",
                      padding: "8px 10px",
                      borderBottom: `1px solid ${T.border}`,
                      opacity: it.selectionne ? 1 : .45,
                    }}>
                      <input type="checkbox" checked={it.selectionne}
                        onChange={e => onUpdateItem(it._key, { selectionne: e.target.checked })}
                        style={{ cursor: "pointer", accentColor: accent }}/>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.libelle}
                        </div>
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {it.match ? (
                            <>
                              <Icon as={it.matchBy === "manuel" ? Link2 : Check} size={10}
                                color={it.matchBy === "code" ? "#22c55e" : it.matchBy === "manuel" ? accent : "#5b8af5"}/>
                              <span>
                                {it.matchBy === "code"
                                  ? <>Match par <strong>code</strong> ({it.code})</>
                                  : it.matchBy === "manuel"
                                    ? <>Lié <strong>manuellement</strong></>
                                    : <>Match par similarité ({Math.round(it.score * 100)}%)</>}
                                {" · "}{(it.match.sous_taches || []).length} sous-tâche{(it.match.sous_taches || []).length > 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontStyle: "italic" }}>
                              {it.code ? `Code ${it.code} inconnu en biblio — créé sans tâches` : "Pas de match biblio — créé sans tâches"}
                            </span>
                          )}
                          {/* Liaison manuelle à une fiche de la bibliothèque */}
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Icon as={Link2} size={10} color={T.textMuted}/>
                            <select value={it.match?.id ?? ""}
                              onChange={e => linkBiblio(it._key, e.target.value, it.unite)}
                              title="Lier manuellement cet ouvrage à une fiche de la bibliothèque"
                              style={{
                                ...inp, padding: "2px 4px", fontSize: FONT.xs.size,
                                cursor: "pointer", maxWidth: 220,
                                borderColor: it.matchBy === "manuel" ? accent : T.border,
                              }}>
                              <option value="">{it.match ? "— Délier —" : "Lier à la biblio…"}</option>
                              {biblioSorted.map(b => (
                                <option key={b.id} value={b.id}>{b.libelle}</option>
                              ))}
                            </select>
                          </span>
                        </div>
                      </div>
                      <input type="number" step="0.5" value={it.heures ?? ""}
                        onChange={e => onUpdateItem(it._key, { heures: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="h" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.quantite ?? ""}
                        onChange={e => onUpdateItem(it._key, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="qté" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.prix_ht ?? ""}
                        onChange={e => onUpdateItem(it._key, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="€ HT" style={{ ...inp, textAlign: "right" }}/>
                      <select value={it.lot_id || ""}
                        onChange={e => onUpdateItem(it._key, { lot_id: e.target.value || null })}
                        style={{ ...inp, cursor: "pointer" }}>
                        <option value="">Sans lot</option>
                        {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {!parsing && !error && items.length > 0 && `${nbSel} ouvrage${nbSel > 1 ? "s" : ""} à importer`}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={onConfirm} disabled={parsing || !!error || nbSel === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                background: (parsing || !!error || nbSel === 0) ? T.border : accent,
                color: (parsing || !!error || nbSel === 0) ? T.textMuted : "#000",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: (parsing || !!error || nbSel === 0) ? "default" : "pointer",
              }}>
              <Icon as={Check} size={13}/>
              Importer {nbSel > 0 ? `(${nbSel})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PagePhasageV2;
