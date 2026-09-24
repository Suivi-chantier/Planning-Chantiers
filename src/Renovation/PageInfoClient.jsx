import React, { useState, useEffect, useRef } from "react";
import { supabase, getClientId } from "../supabase";
import { PlanEditor, PlanEditorErrorBoundary } from "./Plans";
import { FONT, RADIUS, SHADOW, getBranchAccent, LOGO_RENO_H, loadLots } from "../constants";
import { Icon } from "../ui";
import AdresseInput from "../AdresseAutocomplete";
import StylusCanvas, { renderStrokesDataURL } from "./StylusCanvas";
import { buildChiffrageDocHTML } from "./chiffrageDoc";
import { renderPlanDataURL } from "./planRendu";
import { parseCodeOuvrage } from "./codeOuvrage.mjs";
import ProgbatApercuDevis from "./ProgbatApercuDevis.jsx";
import ConditionsVenteChiffrage from "./ConditionsVenteChiffrage.jsx";
import ConditionsVenteLigne from "./ConditionsVenteLigne.jsx";
import { lireConditionsProjet, decrireConditionsLigne, lireModesLigne, libelleSource } from "./conditionsChiffrage.mjs";
import { expliquerPrixMainOeuvre, formaterTauxHT, diagnostiquerListe } from "./tauxHorairesVente.mjs";
import { expliquerPrixMateriaux, formaterCoefficient, diagnostiquerCoefficients } from "./coefficientsVente.mjs";
// Archives de la bibliothèque. ATTENTION au périmètre : on filtre UNIQUEMENT
// le catalogue « Ajouter depuis la bibliothèque ». La requête chargerBiblio()
// n'est PAS filtrée, parce qu'elle sert aussi à recalculer des lignes de devis
// déjà posées (actualiserApresBiblio) : un ouvrage archivé doit continuer d'y
// être lu normalement.
import {
  CLE_ARCHIVES_BIBLIOTHEQUE, lireArchivesV1, filtrerPourChoixV1,
} from "./archivesBibliothequeV1.js";
import {
  ZONE_DEFAUT, ZONES_SUGGEREES, TYPES_LOGEMENT, TVA_TAUX_USUELS,
  calculerOuvrage, creerSnapshotOuvrage, differencesSnapshot, appliquerActualisation,
  ligneEstSnapshot, totalLigneHT, totauxDevis, grouperParLotZone,
  lireLogementProjet, verifierPreparationDevis, normaliserUnite, num as numOrNull,
} from "./chiffragePricing.mjs";
import {
  UserCircle, Plus, Trash2, Search, Calendar, MapPin, FileText, Hammer,
  Ruler, Settings, FileDown, Check, X, AlertTriangle, Menu,
  Pencil, Download, ChevronRight, Building2, Layers,
  Camera, Copy, Euro, ChevronLeft as ChevronLeftIcon,
  ImagePlus, ArrowUp, ArrowDown, Send, StickyNote, Edit2, Image as ImageIcon,
  Video, Film, Library, Wallet, Clock, PenTool, Type as TypeIcon, Play,
  RefreshCw, Home, Receipt, Info, Lock, SlidersHorizontal, Package,
} from "lucide-react";

// Ordre des lots = chronologie d'un chantier (démolition → finitions).
const CATEGORIES_DEFAUT = {
  "Démolition": ["Dépose cuisine","Démolition salle de bain","Dépose baignoire"],
  "Maçonnerie": ["Marche béton","Escalier sapin","Poutre sapin"],
  "Plaquiste": ["Cloison BA13 standard","Cloison BA13 Hydro","Faux plafond","Goulotte GTL"],
  "Ventilation": ["VMC Hygro simple flux","VMC auto simple flux","Bouche VMC","Aérateur extracteur"],
  "Électricité": ["Prise courant simple","Prise courant double","Interrupteur va-et-vient","Installation électrique T1 SANS chauffage","Installation électrique T1 AVEC chauffage","Installation électrique T2 SANS chauffage","Installation électrique T2 AVEC chauffage","Installation électrique T3 SANS chauffage","Installation électrique T3 AVEC chauffage","Radiateur 1500W","Radiateur 1000W","Radiateur 2000W","Tableau 2R T1"],
  "Plomberie": ["Colonne douche thermostatique","Chauffe-eau 40 litres","Chauffe-eau 80 litres","Receveur douche 80x80","Receveur douche 90x90","WC au sol","WC suspendu","Meuble vasque simple"],
  "Menuiseries": ["Fenêtre PVC 600x750","Fenêtre PVC 1200x1400","Volet roulant PVC","Velux 78x98"],
  "Sols & Peinture": ["Parquet stratifié","Ragréage sol","Peinture finition C","Escalier 1/4 tournant"],
};
const UNITES = { "Électricité":"U","Plomberie":"U","Ventilation":"U","Plaquiste":"m²","Sols & Peinture":"m²","Menuiseries":"U","Maçonnerie":"U","Démolition":"m²" };

// ─── STATUTS DE PROJET (flux commercial) ─────────────────────────────────────
const STATUTS_PROJET = [
  { id: "prospect",       label: "Prospect",         color: "#94a3b8" },
  { id: "rdv_planifie",   label: "RDV planifié",     color: "#5b9cf6" },
  { id: "visite_faite",   label: "Visite faite",     color: "#22c55e" },
  { id: "chiffrage",      label: "Chiffrage",        color: "#f5a623" },
  { id: "devis_envoye",   label: "Devis envoyé",     color: "#a78bfa" },
  { id: "signe",          label: "Signé",            color: "#10b981" },
  { id: "abandonne",      label: "Abandonné",        color: "#e15a5a" },
];
const statutMeta = (id) => STATUTS_PROJET.find(s => s.id === id) || STATUTS_PROJET[0];
// Un chiffrage « terminé » (devis parti chez le client, signé ou abandonné) ne
// se réactualise plus tout seul : ses prix ont été communiqués. On signale
// l'écart, et l'actualisation reste possible ligne par ligne (bouton ↻).
const STATUTS_CHIFFRAGE_FIGE = ["devis_envoye", "signe", "abandonne"];
const chiffrageEstTermine = (statut) => STATUTS_CHIFFRAGE_FIGE.includes(statut || "prospect");

// ─── UPLOAD PHOTO (bucket "photos") ──────────────────────────────────────────
async function uploadInfoClientPhoto(file, projetId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `info-client/${projetId}/${safe}`;
  const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
  if (error) { console.error("upload photo:", error); return null; }
  const { data } = supabase.storage.from("photos").getPublicUrl(path);
  return data?.publicUrl || null;
}

// Champs ajoutés par sql/202609_chiffrage_devis_logement.sql (1 projet = 1
// logement = 1 futur devis ProGBat). Servent au repli si la base n'est pas à
// jour, au merge Realtime et à la duplication.
const CHAMPS_DEVIS = [
  "client_societe", "client_email", "client_telephone", "client_adresse", "client_adresse_complement", "client_code_postal", "client_ville", "client_pays",
  "chantier_adresse", "chantier_adresse_complement", "chantier_code_postal", "chantier_ville", "chantier_pays",
  "logement_reference", "type_logement",
  "devis_objet", "devis_date", "devis_validite", "tva_pct", "devis_num_commande_client", "devis_conditions",
];
const CHAMPS_DEVIS_DATE = ["devis_date", "devis_validite"];
const CHAMPS_DEVIS_NUM  = ["tva_pct"];
const CHAMPS_DEVIS_VIDES = Object.fromEntries(CHAMPS_DEVIS.map(f => [f, ""]));
const erreurColonnesDevis = (error) => !!error && CHAMPS_DEVIS.some(c => (error?.message || "").includes(c));
// Colonnes de snapshot d'une ligne (profero_ouvrages_selectionnes) de la même migration
const COLONNES_LIGNE_V3 = ["zone", "code_ouvrage", "cout_materiaux_unitaire", "cout_main_oeuvre_unitaire", "cout_direct_unitaire", "cout_total_unitaire", "taux_marge_pct", "coef_vente", "coefficient_vente_id", "taux_horaire_vente_id", "taux_horaire_vente", "coefficient_source", "coefficient_origine_valeur", "coefficient_origine_libelle", "coefficient_global_id", "taux_horaire_source", "taux_horaire_origine_valeur", "taux_horaire_origine_libelle", "taux_horaire_global_id", "mode_coefficient_ligne", "coefficient_ligne_id", "coefficient_ligne_valeur", "coefficient_ligne_libelle", "mode_taux_horaire_ligne", "taux_horaire_ligne_id", "taux_horaire_ligne_valeur", "taux_horaire_ligne_libelle", "tva_pct", "calcul_version", "calcul_detail", "ordre"];
const fmtCoef = (k) => k == null ? "—" : `× ${Number(k).toLocaleString("fr-FR", { maximumFractionDigits: 3 })}`;
const erreurColonnesLigne = (error) => !!error && COLONNES_LIGNE_V3.some(c => (error?.message || "").includes(c));
const sansColonnesLigneV3 = (row) => { const r = { ...row }; COLONNES_LIGNE_V3.forEach(c => { delete r[c]; }); return r; };
const fmtEur2 = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtPct = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

// État vide d'un projet (formulaire + reset). `logements` (ancien tableau) est
// conservé en lecture seule pour les anciens projets.
const INFOS_VIDES = { client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"", date_visite:"", observations:"", logements:[], statut:"prospect", notes:"", budget_client:"", delai_souhaite:"", ...CHAMPS_DEVIS_VIDES };

// Médias : photos ET vidéos dans le même bucket "photos" (max 50 Mo, limite
// par défaut du stockage Supabase).
const MAX_MEDIA_OCTETS = 50 * 1024 * 1024;
const estFichierVideo = (f) => (f?.type || "").startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f?.name || "");

// Dessins au stylet : repère logique d'une page de notes (portrait) et d'un
// croquis (paysage). Le rendu s'adapte à la largeur de l'écran.
const NOTE_W = 1000, NOTE_H = 1400;
const CROQUIS_W = 1400, CROQUIS_H = 1000;
const fmtEur = (n) => Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";

// Code en tête d'un libellé de la bibliothèque : « D-001 : Dépose… »,
// « E-002.3 : Tableau… », « COUV-001 : Reprise… ». Détecteur unique
// (codeOuvrage.mjs) partagé avec l'import, le planning et les lots.
function decoderLibelleCode(libelle) {
  const c = parseCodeOuvrage(libelle);
  return c ? { code: c.code, prefixe: c.prefixe, num: c.numeroValeur, reste: c.reste } : null;
}

// `onModifierMateriaux` / `retourBiblio` : aller-retour avec la page Bibliothèque
// (bouton « Modifier matériaux » d'une ligne d'ouvrage). Au retour, les lignes
// de CE chiffrage issues de l'ouvrage modifié sont réactualisées automatiquement
// tant que le chiffrage n'est pas terminé.
export default function PageInfoClient({ T, branch = "renovation", chantiers = [], onModifierMateriaux = null, retourBiblio = null, onRetourBiblioConsomme = null }) {
  const acc = getBranchAccent(branch);
  const [projets, setProjets]         = useState([]);
  const [projetId, setProjetId]       = useState(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [infos, setInfos]             = useState(INFOS_VIDES);
  const [ouvrages, setOuvrages]       = useState([]);
  const [cotes, setCotes]             = useState([]);
  // Plans riches (table `plans` partagée avec la page Plans) liés au projet
  const [richPlans, setRichPlans]     = useState([]); // liste allégée [{id,name,thumbnail,chantier_id,updated_at}]
  const [editingPlan, setEditingPlan] = useState(null); // plan complet ouvert dans l'éditeur
  const [linkingPlan, setLinkingPlan] = useState(null); // plan à lier à un chantier
  const [linkChantier, setLinkChantier] = useState("");
  const [toDeletePlan, setToDeletePlan] = useState(null);
  const [categories, setCategories]   = useState(CATEGORIES_DEFAUT);
  // Un seul flux d'onglets (au lieu de gauche/droite) — bien plus clair
  const [tab, setTab]                 = useState("client");
  const [search, setSearch]           = useState("");
  const [filtresCat, setFiltresCat]   = useState([]);
  const [filtreStatut, setFiltreStatut] = useState("all");
  const [searchProjets, setSearchProjets] = useState("");
  const [showModal, setShowModal]     = useState(false);
  const [showProgbat, setShowProgbat] = useState(false);   // aperçu du payload ProGBat (aucun envoi)
  const [newCat, setNewCat]           = useState("Électricité");
  const [newLib, setNewLib]           = useState("");
  const [catParam, setCatParam]       = useState("");
  const [mobileShowProjets, setMobileShowProjets] = useState(false);
  const [toDelete, setToDelete]       = useState(null);
  const [deleting, setDeleting]       = useState(false);
  const [toDeleteOuvrage, setToDeleteOuvrage] = useState(null);
  // Gestion bibliothèque depuis l'onglet Ouvrages
  const [manageMode, setManageMode]   = useState(false);
  const [editLib, setEditLib]         = useState(null); // { cat, idx, value }
  const [addLibCat, setAddLibCat]     = useState(null); // nom du lot en cours d'ajout
  const [addLibVal, setAddLibVal]     = useState("");
  const [newLotName, setNewLotName]   = useState("");
  const [editLot, setEditLot]         = useState(null); // { nom, value }
  const [toDeleteLot, setToDeleteLot] = useState(null); // nom du lot à supprimer
  const [reordering, setReordering]   = useState(false);
  const [photos, setPhotos]           = useState([]); // [{ id, url, label, created_at }]
  const [uploadingCount, setUploadingCount] = useState(0);
  const [lightbox, setLightbox]       = useState(null); // { urls:[], idx:0 }
  const [exporting, setExporting]     = useState(false);
  const photoInputRef = useRef(null);
  // Dessins au stylet (table profero_dessins) : pages de notes manuscrites + croquis
  const [dessins, setDessins]         = useState([]);
  const [notesMode, setNotesMode]     = useState("texte");   // "texte" | "manuscrit"
  const [notePageId, setNotePageId]   = useState(null);
  const [croquisOuvert, setCroquisOuvert] = useState(null);  // id du croquis en édition
  const [toDeleteDessin, setToDeleteDessin] = useState(null);
  const dessinOuvertRef = useRef(null);
  const vignetteCache = useRef(new Map());
  // Bibliothèque d'ouvrages (page Bibliothèque) : source principale de l'onglet
  // Ouvrages — seuls les libellés codés (« D-001 : … ») sont proposés.
  const [biblio, setBiblio]           = useState(null);      // { ouvrages, lots, materiaux, coutHoraire, tvaDefaut } chargé au montage
  // Liste des ouvrages archivés. « Indisponible » au départ : rien n'est
  // masqué tant que la lecture n'a pas répondu.
  const [archivesBiblio, setArchivesBiblio] = useState({ disponible: false, ids: [], raison: null });
  const [biblioBusy, setBiblioBusy]   = useState(null);
  const [showAnciens, setShowAnciens] = useState(false);     // anciens ouvrages du chiffrage (masqués par défaut)
  // Colonnes/table de la v2 absentes en base (SQL 202609_chiffrage_v2 pas encore lancé)
  const [schemaV2Manquant, setSchemaV2Manquant] = useState(false);
  // Colonnes v3 (devis / logement / snapshot) absentes (SQL 202609_chiffrage_devis_logement pas lancé)
  const [schemaDevisManquant, setSchemaDevisManquant] = useState(false);
  // Zone dans laquelle le prochain « Ajouter » place l'ouvrage (libre, suggestions)
  const [zoneAjout, setZoneAjout]     = useState(ZONE_DEFAUT);
  // Actualisation d'une ligne depuis la bibliothèque : { ligne, ouvrage, calcul, diffs, patch }
  const [actualisation, setActualisation] = useState(null);
  // Résultat du retour de la Bibliothèque (« Modifier matériaux ») :
  // { libelle, nb, aucun?, fige?, supprime?, erreur? } — bandeau informatif.
  const [majBiblio, setMajBiblio]     = useState(null);
  const retourTraiteRef = useRef(null);
  // Duplication « pour un autre logement » : { reference, type }
  const [dupliquerModal, setDupliquerModal] = useState(null);
  const [dupliquant, setDupliquant]   = useState(false);
  const [toDeleteLigne, setToDeleteLigne] = useState(null);
  const [voirDetailLigne, setVoirDetailLigne] = useState(null); // ligne dont on affiche le détail du coût
  const [conditionsLigne, setConditionsLigne] = useState(null); // ligne dont on modifie coefficient / taux horaire
  // Timers de debounce, indexés par clé. BUG corrigé : auparavant un seul ref
  // partagé annulait les saves des autres opérations (ex : taper un nom client
  // puis modifier une quantité d'ouvrage avant 800ms écrasait la save du nom).
  const saveTimers = useRef({});
  // Statut de sauvegarde : "saved" | "pending" | "saving" | "error"
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved");
  // Set des champs `infos` modifiés localement depuis la dernière save terminée.
  // Sert au merge Realtime : on garde nos valeurs locales sur ces champs et on
  // prend la version remote pour les autres.
  const dirtyInfosRef = useRef(new Set());

  // Thème
  const bg      = T.bg      || "#0d0f12";
  const surface = T.surface || "#13161b";
  const card    = T.card    || "#1a1d24";
  const border  = T.border  || "#2a2d35";
  const text    = T.text    || "#f0f0f0";
  const textSub = T.textSub || "#888";
  const accent  = T.accent  || "#FFC300";

  // Styles réutilisables
  const inp = { width:"100%", padding:"9px 12px", background:card, border:`1px solid ${border}`, borderRadius:7, color:text, fontSize:13, fontFamily:"inherit" };
  const ta  = { ...inp, resize:"vertical", minHeight:64 };
  const btn = { background:accent, color:"#000", border:"none", borderRadius:7, padding:"8px 16px", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer" };
  const btnSec = { background:"transparent", color:textSub, border:`1px solid ${border}`, borderRadius:7, padding:"8px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer" };
  const btnDng = { background:"transparent", color:"#e05c5c", border:"1px solid rgba(224,92,92,0.3)", borderRadius:7, padding:"5px 10px", fontFamily:"inherit", fontSize:11, cursor:"pointer" };
  const iconBtnSec = { display:"inline-flex", alignItems:"center", justifyContent:"center", width:28, height:28, background:"transparent", color:textSub, border:`1px solid ${border}`, borderRadius:7, cursor:"pointer", padding:0, flexShrink:0 };
  const iconBtnDng = { ...iconBtnSec, color:"#e05c5c", border:"1px solid rgba(224,92,92,0.3)" };
  const lbl  = { display:"block", fontSize:11, fontWeight:700, color:textSub, marginBottom:5, textTransform:"uppercase", letterSpacing:.5 };
  const h2s  = { color:accent, fontSize:11, fontWeight:700, marginTop:18, marginBottom:8, paddingBottom:5, borderBottom:`1px solid ${border}`, textTransform:"uppercase", letterSpacing:.7 };
  const tabS = (a) => ({ padding:"7px 16px", border:a?"none":`1px solid ${border}`, borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:700, background:a?accent:card, color:a?"#000":textSub, letterSpacing:.4, textTransform:"uppercase", transition:"all .12s" });

  // ─── INIT ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    chargerProjets(retourBiblio?.projetId || null);
    chargerCategories();
    chargerBiblio();
    if (retourBiblio?.projetId) setTab("ouvrages");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── DATA ────────────────────────────────────────────────────────────────────
  // `preferId` : projet à rouvrir en priorité (retour de la Bibliothèque).
  async function chargerProjets(preferId = null) {
    setLoading(true);
    const { data } = await supabase.from("profero_projets").select("*").order("created_at", { ascending:false });
    if (data) {
      setProjets(data);
      const cible = (preferId && data.some(p => p.id === preferId)) ? preferId : data[0]?.id;
      if (cible) chargerProjet(cible); else setLoading(false);
    }
    else setLoading(false);
  }

  async function chargerCategories() {
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").order("ordre");
    if (data && data.length > 0) { const c={}; data.forEach(r => { c[r.nom]=r.ouvrages||[]; }); setCategories(c); }
    else { await supabase.from("profero_categories_ouvrages").insert(Object.entries(CATEGORIES_DEFAUT).map(([nom,ouvrages],i)=>({nom,ouvrages,ordre:i}))); }
  }

  // Ligne profero_projets → état `infos` du formulaire (chaînes vides plutôt que null)
  function infosDepuisProjet(p) {
    const base = { ...INFOS_VIDES, client_nom:p.client_nom||"", client_prenom:p.client_prenom||"", adresse_bien:p.adresse_bien||"", description_projet:p.description_projet||"", date_visite:p.date_visite||"", observations:p.observations||"", logements:Array.isArray(p.logements)?p.logements:[], statut:p.statut||"prospect", notes:p.notes||"", budget_client:p.budget_client ?? "", delai_souhaite:p.delai_souhaite||"" };
    CHAMPS_DEVIS.forEach(f => { base[f] = p[f] == null ? "" : p[f]; });
    return base;
  }

  async function chargerProjet(id) {
    setLoading(true);
    // Reset dirty + status quand on change de projet (les modifs en attente sur
    // le projet précédent ont déjà leur projetId capturé dans la closure du
    // debounce, donc elles iront bien sur le bon projet).
    dirtyInfosRef.current.clear();
    setAutoSaveStatus("saved");
    setProjetId(id);
    setEditingPlan(null);
    setCroquisOuvert(null); setNotePageId(null);
    const [{ data:p },{ data:o },{ data:c },{ data:pl },{ data:ds }] = await Promise.all([
      supabase.from("profero_projets").select("*").eq("id",id).single(),
      supabase.from("profero_ouvrages_selectionnes").select("*").eq("projet_id",id),
      supabase.from("profero_cotes").select("*").eq("projet_id",id),
      supabase.from("plans").select("id,name,thumbnail,chantier_id,updated_at").eq("projet_id",id).order("updated_at",{ascending:false}),
      supabase.from("profero_dessins").select("*").eq("projet_id",id).order("ordre").order("created_at"),
    ]);
    if (p) setInfos(infosDepuisProjet(p));
    setDessins(ds || []);
    setOuvrages(o||[]); setCotes(c||[]);
    setRichPlans(pl || []);
    setPhotos(Array.isArray(p?.photos) ? p.photos : []);
    setLoading(false);
  }

  // ─── PLANS RICHES (table `plans`) ─────────────────────────────────────────────
  async function nouveauPlan() {
    if (!projetId) return;
    const base = infos.client_nom ? `Plan ${infos.client_nom}` : "Nouveau plan";
    const { data } = await supabase.from("plans").insert({
      name: base, projet_id: projetId, chantier_id: "",
      data: { segments:[], symbols:[], viewport:{x:0,y:0,scale:1}, threshold:0.5 },
      thumbnail: "",
    }).select().single();
    if (data) { setRichPlans(p => [data, ...p]); setEditingPlan(data); }
  }
  async function ouvrirPlan(id) {
    const { data } = await supabase.from("plans").select("*").eq("id", id).single();
    if (data) setEditingPlan(data);
  }
  function onSavePlan(updated) {
    setRichPlans(p => p.map(x => x.id === updated.id ? { ...x, name:updated.name, thumbnail:updated.thumbnail, updated_at:updated.updated_at } : x));
  }
  async function lierPlanChantier() {
    if (!linkingPlan) return;
    await supabase.from("plans").update({ chantier_id: linkChantier || "" }).eq("id", linkingPlan.id);
    setRichPlans(p => p.map(x => x.id === linkingPlan.id ? { ...x, chantier_id: linkChantier || "" } : x));
    setLinkingPlan(null); setLinkChantier("");
  }
  async function supprimerPlan(id) {
    await supabase.from("plans").delete().eq("id", id);
    setRichPlans(p => p.filter(x => x.id !== id));
    setToDeletePlan(null);
  }

  // ─── Subscription Realtime sur le projet en cours ─────────────────────────
  // Champs scalaires : on prend la version remote sauf si l'utilisateur a
  // touché ce champ localement depuis sa dernière save (dirtyInfosRef).
  // Pour les tables liées (ouvrages_selectionnes, cotes, plans) on s'abonne
  // aussi pour refléter les ajouts/suppressions/modifs des autres.
  useEffect(() => {
    if (!projetId) return;
    const clientId = getClientId();
    const projChan = supabase
      .channel(`info-client-projet-${projetId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "profero_projets", filter: `id=eq.${projetId}` },
        ({ new: remote }) => {
          if (!remote) return;
          if (remote.last_client_id === clientId) return; // notre propre save
          const dirty = dirtyInfosRef.current;
          setInfos(prev => {
            const merged = { ...prev };
            ["client_nom","client_prenom","adresse_bien","description_projet","date_visite","observations","notes","logements","statut","budget_client","delai_souhaite", ...CHAMPS_DEVIS].forEach(f => {
              if (!dirty.has(f) && remote[f] !== undefined && remote[f] !== null) merged[f] = remote[f];
              else if (!dirty.has(f) && remote[f] === null && (f === "date_visite" || f === "budget_client" || CHAMPS_DEVIS_DATE.includes(f) || CHAMPS_DEVIS_NUM.includes(f))) merged[f] = "";
            });
            return merged;
          });
          if (!dirty.has("photos") && Array.isArray(remote.photos)) setPhotos(remote.photos);
          setProjets(prev => prev.map(p => p.id === remote.id ? { ...p, ...remote } : p));
        }
      )
      .subscribe();
    const ouvChan = supabase
      .channel(`info-client-ouvrages-${projetId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "profero_ouvrages_selectionnes", filter: `projet_id=eq.${projetId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setOuvrages(prev => prev.some(o => o.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === "UPDATE") {
            setOuvrages(prev => prev.map(o => o.id === payload.new.id ? fusionnerLigneDistante("ouvrages", o, payload.new) : o));
          } else if (payload.eventType === "DELETE") {
            setOuvrages(prev => prev.filter(o => o.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    const coteChan = supabase
      .channel(`info-client-cotes-${projetId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "profero_cotes", filter: `projet_id=eq.${projetId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setCotes(prev => prev.some(c => c.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === "UPDATE") {
            setCotes(prev => prev.map(c => c.id === payload.new.id ? fusionnerLigneDistante("cotes", c, payload.new) : c));
          } else if (payload.eventType === "DELETE") {
            setCotes(prev => prev.filter(c => c.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    // Dessins (notes manuscrites / croquis) : on ignore les UPDATE du dessin
    // qu'on est en train d'éditer (sinon le tracé distant écraserait le nôtre).
    const dessinChan = supabase
      .channel(`info-client-dessins-${projetId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "profero_dessins", filter: `projet_id=eq.${projetId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setDessins(prev => prev.some(d => d.id === payload.new.id) ? prev : [...prev, payload.new]);
          } else if (payload.eventType === "UPDATE") {
            if (dessinOuvertRef.current === payload.new.id) return;
            setDessins(prev => prev.map(d => d.id === payload.new.id ? fusionnerLigneDistante("dessins", d, payload.new) : d));
          } else if (payload.eventType === "DELETE") {
            setDessins(prev => prev.filter(d => d.id !== payload.old.id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(projChan);
      supabase.removeChannel(ouvChan);
      supabase.removeChannel(coteChan);
      supabase.removeChannel(dessinChan);
    };
  }, [projetId]);

  async function savePhotos(newPhotos, pid = projetId) {
    setPhotos(newPhotos);
    if (!pid) return;
    setAutoSaveStatus("saving");
    const { error } = await supabase.from("profero_projets").update({ photos: newPhotos }).eq("id", pid);
    if (error) { console.error("savePhotos:", error); setAutoSaveStatus("error"); return; }
    setAutoSaveStatus("saved");
  }

  // Photos ET vidéos : même flux d'upload, un champ `type` distingue les deux.
  // Chaque média porte un titre (`label`) et un commentaire libre.
  async function onPhotoFiles(files) {
    if (!projetId) return;
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    const tropGros = arr.filter(f => f.size > MAX_MEDIA_OCTETS);
    if (tropGros.length > 0) alert(`Fichier${tropGros.length > 1 ? "s" : ""} trop volumineux (max ${Math.round(MAX_MEDIA_OCTETS / 1048576)} Mo) : ${tropGros.map(f => f.name).join(", ")}`);
    const ok = arr.filter(f => f.size <= MAX_MEDIA_OCTETS);
    if (ok.length === 0) { if (photoInputRef.current) photoInputRef.current.value = ""; return; }
    setUploadingCount(ok.length);
    const news = [];
    for (const f of ok) {
      const url = await uploadInfoClientPhoto(f, projetId);
      if (url) news.push({ id: Math.random().toString(36).slice(2), url, type: estFichierVideo(f) ? "video" : "image", label: "", commentaire: "", created_at: new Date().toISOString() });
      setUploadingCount(n => n - 1);
    }
    if (news.length > 0) await savePhotos([...photos, ...news]);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }
  const removePhoto = (i) => savePhotos(photos.filter((_, idx) => idx !== i));
  const updatePhotoField = (i, field, value) => {
    dirtyInfosRef.current.add("photos");
    const next = photos.map((p, idx) => idx === i ? { ...p, [field]: value } : p);
    setPhotos(next);
    const pid = projetId;
    debounce("photos", async () => { await savePhotos(next, pid); dirtyInfosRef.current.delete("photos"); });
  };

  // Champs de LIGNE en cours de saisie (ouvrage, cote, dessin).
  //
  // Le temps reel applique chaque UPDATE recu sur la ligne correspondante --
  // y compris l'echo de NOTRE propre enregistrement, qui part 800 ms apres la
  // derniere frappe et revient encore plus tard. Si l'utilisateur a repris sa
  // saisie entre-temps, cet echo reecrit la valeur telle qu'elle etait a
  // l'envoi : le champ "revient en arriere" en pleine frappe.
  //
  // On note donc, par ligne et par champ, un numero de frappe. Tant que le
  // champ est note, le temps reel garde la valeur locale pour CE champ (les
  // autres champs de la ligne, eux, sont bien mis a jour). Le champ est libere
  // un court instant apres son enregistrement, et seulement si aucune frappe
  // n'est arrivee depuis. Meme principe que dirtyInfosRef pour les champs du
  // projet.
  const saisieLignesRef = useRef({ ouvrages: new Map(), cotes: new Map(), dessins: new Map() });

  function marquerSaisieLigne(table, id, champ) {
    const lignes = saisieLignesRef.current[table];
    if (!lignes.has(id)) lignes.set(id, new Map());
    const champs = lignes.get(id);
    const n = (champs.get(champ) || 0) + 1;
    champs.set(champ, n);
    return n;
  }

  function libererSaisieLigne(table, id, champ, n, delai = 1500) {
    setTimeout(() => {
      const champs = saisieLignesRef.current[table].get(id);
      if (!champs || champs.get(champ) !== n) return;   // l'utilisateur a retape
      champs.delete(champ);
      if (champs.size === 0) saisieLignesRef.current[table].delete(id);
    }, delai);
  }

  function fusionnerLigneDistante(table, local, distant) {
    const fusion = { ...local, ...distant };
    const champs = saisieLignesRef.current[table].get(distant.id);
    if (champs) champs.forEach((_n, champ) => { fusion[champ] = local[champ]; });
    return fusion;
  }

  // Debounce avec timer dédié par clé : évite que des opérations indépendantes
  // (saveInfos, update ouvrage, update cote…) s'écrasent mutuellement.
  function debounce(key, fn, d=800) {
    setAutoSaveStatus("pending");
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => {
      delete saveTimers.current[key];
      fn();
    }, d);
  }

  async function saveInfos(v, pid = projetId) {
    if (!pid) return;
    setSaving(true);
    setAutoSaveStatus("saving");
    // Snapshot des champs dirty AVANT save : on ne nettoiera que ces clés après,
    // pour ne pas perdre des modifs faites pendant la requête.
    const dirtyAtSave = new Set(dirtyInfosRef.current);
    const payload = {
      client_nom:          v.client_nom          ?? "",
      client_prenom:       v.client_prenom       ?? "",
      adresse_bien:        v.adresse_bien        ?? "",
      description_projet:  v.description_projet  ?? "",
      // date_visite peut être de type DATE en base ; on envoie null si vide
      date_visite:         v.date_visite || null,
      observations:        v.observations        ?? "",
      notes:               v.notes               ?? "",
      budget_client:       v.budget_client === "" || v.budget_client == null ? null : parseFloat(v.budget_client),
      delai_souhaite:      v.delai_souhaite      ?? "",
      logements:           v.logements           ?? [],
      statut:              v.statut              ?? "prospect",
      last_client_id:      getClientId(),
      ...payloadDevis(v),
    };
    let { error } = await supabase.from("profero_projets").update(payload).eq("id", pid);
    if (erreurColonnesDevis(error)) {
      // Colonnes v3 absentes (SQL 202609_chiffrage_devis_logement pas lancé) : on sauve le reste
      setSchemaDevisManquant(true);
      const reduit = { ...payload };
      CHAMPS_DEVIS.forEach(f => { delete reduit[f]; });
      ({ error } = await supabase.from("profero_projets").update(reduit).eq("id", pid));
    }
    if (error && /budget_client|delai_souhaite/.test(error.message || "")) {
      // Colonnes v2 absentes (SQL 202609_chiffrage_v2 pas lancé) : on sauve le reste
      setSchemaV2Manquant(true);
      const { budget_client, delai_souhaite, ...ancien } = payload;
      CHAMPS_DEVIS.forEach(f => { delete ancien[f]; });
      ({ error } = await supabase.from("profero_projets").update(ancien).eq("id", pid));
    }
    setSaving(false);
    if (error) {
      console.error("saveInfos projet error:", error);
      setAutoSaveStatus("error");
      return;
    }
    dirtyAtSave.forEach(f => dirtyInfosRef.current.delete(f));
    setAutoSaveStatus("saved");
    setProjets(prev => prev.map(p => p.id===pid ? { ...p, ...v } : p));
  }
  // Champs v3 du projet → payload Supabase (dates et TVA : null si vides)
  function payloadDevis(v) {
    const out = {};
    CHAMPS_DEVIS.forEach(f => {
      const val = v[f];
      if (CHAMPS_DEVIS_DATE.includes(f)) out[f] = val || null;
      else if (CHAMPS_DEVIS_NUM.includes(f)) out[f] = val === "" || val == null ? null : parseFloat(val);
      else out[f] = val ?? "";
    });
    return out;
  }
  function updInfo(f,v) {
    dirtyInfosRef.current.add(f);
    const u = { ...infos, [f]: v };
    setInfos(u);
    const pid = projetId;
    debounce("infos", () => saveInfos(u, pid));
  }
  // Plusieurs champs d'un coup (ex : reprise de l'adresse de visite dans l'adresse chantier)
  function updInfos(patch) {
    Object.keys(patch).forEach(f => dirtyInfosRef.current.add(f));
    const u = { ...infos, ...patch };
    setInfos(u);
    const pid = projetId;
    debounce("infos", () => saveInfos(u, pid));
  }
  // TVA du projet : répercutée sur les lignes qui « suivent le projet » (TVA
  // nulle ou égale à l'ancienne valeur). Les lignes à TVA spécifique gardent la leur.
  async function updTvaProjet(valeur) {
    const ancienne = numOrNull(infos.tva_pct);
    const nouvelle = valeur === "" ? null : parseFloat(valeur);
    updInfo("tva_pct", valeur);
    if (!projetId || nouvelle == null || Number.isNaN(nouvelle)) return;
    const cibles = ouvrages.filter(o => numOrNull(o.tva_pct) == null || (ancienne != null && numOrNull(o.tva_pct) === ancienne));
    if (cibles.length === 0) return;
    setOuvrages(p => p.map(o => cibles.some(c => c.id === o.id) ? { ...o, tva_pct: nouvelle } : o));
    const { error } = await supabase.from("profero_ouvrages_selectionnes").update({ tva_pct: nouvelle }).in("id", cibles.map(c => c.id));
    if (erreurColonnesLigne(error)) setSchemaDevisManquant(true);
  }

  async function togOuvrage(cat,item) {
    if (!projetId) return;
    const ex=ouvrages.find(o=>o.category===cat&&o.item===item);
    if (ex) { await supabase.from("profero_ouvrages_selectionnes").delete().eq("id",ex.id); setOuvrages(p=>p.filter(o=>!(o.category===cat&&o.item===item))); }
    else { const{data}=await supabase.from("profero_ouvrages_selectionnes").insert({projet_id:projetId,category:cat,item,quantite:"",unite:UNITES[cat]||"U"}).select().single(); if(data) setOuvrages(p=>[...p,data]); }
  }
  async function updQte(id,q) {
    const n = marquerSaisieLigne("ouvrages", id, "quantite");
    setOuvrages(p => p.map(o => o.id===id ? { ...o, quantite: q } : o));
    debounce(`ouvrage-qte-${id}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_ouvrages_selectionnes").update({ quantite: q }).eq("id", id);
      setAutoSaveStatus(error ? "error" : "saved");
      libererSaisieLigne("ouvrages", id, "quantite", n);
    });
  }
  async function updUnite(id,u) {
    const n = marquerSaisieLigne("ouvrages", id, "unite");
    setOuvrages(p => p.map(o => o.id===id ? { ...o, unite: u } : o));
    setAutoSaveStatus("saving");
    const { error } = await supabase.from("profero_ouvrages_selectionnes").update({ unite: u }).eq("id", id);
    setAutoSaveStatus(error ? "error" : "saved");
    libererSaisieLigne("ouvrages", id, "unite", n);
  }
  // Zone de l'occurrence (texte libre avec suggestions) — propre à la ligne
  function updZone(id, zone) {
    const n = marquerSaisieLigne("ouvrages", id, "zone");
    setOuvrages(p => p.map(o => o.id===id ? { ...o, zone } : o));
    debounce(`ouvrage-zone-${id}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_ouvrages_selectionnes").update({ zone: (zone || "").trim() || ZONE_DEFAUT }).eq("id", id);
      if (erreurColonnesLigne(error)) setSchemaDevisManquant(true);
      setAutoSaveStatus(error ? "error" : "saved");
      libererSaisieLigne("ouvrages", id, "zone", n);
    });
  }
  // TVA spécifique d'une ligne ("" = suit la TVA du projet)
  async function updTvaLigne(id, valeur) {
    const v = valeur === "" ? null : parseFloat(valeur);
    const n = marquerSaisieLigne("ouvrages", id, "tva_pct");
    setOuvrages(p => p.map(o => o.id===id ? { ...o, tva_pct: v } : o));
    setAutoSaveStatus("saving");
    const { error } = await supabase.from("profero_ouvrages_selectionnes").update({ tva_pct: v }).eq("id", id);
    if (erreurColonnesLigne(error)) setSchemaDevisManquant(true);
    setAutoSaveStatus(error ? "error" : "saved");
    libererSaisieLigne("ouvrages", id, "tva_pct", n);
  }
  // Suppression d'UNE occurrence : uniquement par son id de ligne. Les autres
  // occurrences du même bibliotheque_id ne sont jamais touchées.
  async function supprimerLigne(id) {
    setToDeleteLigne(null);
    const { error } = await supabase.from("profero_ouvrages_selectionnes").delete().eq("id", id);
    if (error) { alert("Suppression impossible : " + error.message); return; }
    setOuvrages(p => p.filter(o => o.id !== id));
  }
  async function updPrix(id,prix) {
    const n = marquerSaisieLigne("ouvrages", id, "prix_unitaire");
    setOuvrages(p => p.map(o => o.id===id ? { ...o, prix_unitaire: prix } : o));
    debounce(`ouvrage-prix-${id}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_ouvrages_selectionnes")
        .update({ prix_unitaire: prix==="" ? null : parseFloat(prix) }).eq("id", id);
      setAutoSaveStatus(error ? "error" : "saved");
      libererSaisieLigne("ouvrages", id, "prix_unitaire", n);
    });
  }

  async function ajoutCote() { if(!projetId) return; const{data}=await supabase.from("profero_cotes").insert({projet_id:projetId,nom:"",largeur:"",hauteur:"",localisation:""}).select().single(); if(data) setCotes(p=>[...p,data]); }
  async function updCote(id,f,v) {
    const n = marquerSaisieLigne("cotes", id, f);
    setCotes(p => p.map(c => c.id===id ? { ...c, [f]: v } : c));
    debounce(`cote-${id}-${f}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_cotes").update({ [f]: v }).eq("id", id);
      setAutoSaveStatus(error ? "error" : "saved");
      libererSaisieLigne("cotes", id, f, n);
    });
  }
  async function delCote(id) { await supabase.from("profero_cotes").delete().eq("id",id); setCotes(p=>p.filter(c=>c.id!==id)); }

  async function nouveauProjet() {
    const today = new Date().toISOString().split("T")[0];
    const base = {
      client_nom:"", client_prenom:"", adresse_bien:"", description_projet:"",
      date_visite:today, observations:"", logements:[], statut:"prospect",
    };
    // Pré-remplissages sûrs : pays, date de préparation du devis, TVA réglée dans Admin (sinon vide)
    const v3 = { client_pays:"France", chantier_pays:"France", devis_date:today, tva_pct: biblio?.tvaDefaut ?? null };
    let { data, error } = await supabase.from("profero_projets").insert({ ...base, ...v3 }).select().single();
    if (erreurColonnesDevis(error)) {
      setSchemaDevisManquant(true);
      ({ data } = await supabase.from("profero_projets").insert(base).select().single());
    }
    if(data){ setProjets(p=>[data,...p]); chargerProjet(data.id); }
  }

  // Duplication « pour un autre logement » : même client, même adresse de
  // chantier, mêmes ouvrages/zones/quantités et SNAPSHOTS FIGÉS (aucun recalcul
  // depuis la bibliothèque), plans, côtes, dessins et médias. La référence du
  // nouveau logement est demandée (modale) ; le statut repart à « prospect ».
  async function dupliquerProjet({ reference, type } = {}) {
    if (!projetId || dupliquant) return;
    const src = projets.find(p => p.id === projetId);
    if (!src) return;
    setDupliquant(true);
    try {
    const today = new Date().toISOString().split("T")[0];
    // 1) Création du nouveau projet (copie des infos + photos, statut reset à prospect)
    const baseDup = {
      client_nom:      src.client_nom || "",
      client_prenom:   src.client_prenom || "",
      adresse_bien:    src.adresse_bien || "",
      description_projet: src.description_projet || "",
      date_visite:     today,
      observations:    src.observations || "",
      notes:           src.notes || "",
      logements:       [],                 // le nouveau projet = UN logement (champs ci-dessous)
      statut:          "prospect",
      photos:          src.photos || [],
    };
    const v2 = { budget_client: src.budget_client ?? null, delai_souhaite: src.delai_souhaite || "" };
    const v3 = { ...payloadDevis({ ...infos, ...src }), logement_reference: (reference || "").trim(), type_logement: type || infos.type_logement || "", devis_date: today, devis_validite: null };
    let { data: nouveau, error } = await supabase.from("profero_projets").insert({ ...baseDup, ...v2, ...v3 }).select().single();
    if (erreurColonnesDevis(error)) {
      setSchemaDevisManquant(true);
      ({ data: nouveau, error } = await supabase.from("profero_projets").insert({ ...baseDup, ...v2 }).select().single());
    }
    if (!nouveau) {
      // Colonnes v2 absentes (SQL pas lancé) : copie sans budget/délai
      setSchemaV2Manquant(true);
      ({ data: nouveau } = await supabase.from("profero_projets").insert(baseDup).select().single());
    }
    if (!nouveau) return;
    // 2) Clone des lignes : tout est recopié (zone, quantité, snapshot financier,
    //    TVA, ordre, lien bibliothèque) sauf l'identité de la ligne.
    const ouvrSrc = ouvrages.map(o => {
      const { id, projet_id, created_at, updated_at, progbat_ligne_id, ...reste } = o;
      return { ...reste, projet_id: nouveau.id };
    });
    if (ouvrSrc.length > 0) {
      const { error: errL } = await supabase.from("profero_ouvrages_selectionnes").insert(ouvrSrc);
      if (erreurColonnesLigne(errL)) {
        setSchemaDevisManquant(true);
        await supabase.from("profero_ouvrages_selectionnes").insert(ouvrSrc.map(sansColonnesLigneV3));
      }
    }
    // 3) Clone côtes
    const cotesSrc = cotes.map(c => ({
      projet_id: nouveau.id,
      nom: c.nom, largeur: c.largeur, hauteur: c.hauteur, localisation: c.localisation,
    }));
    if (cotesSrc.length > 0) await supabase.from("profero_cotes").insert(cotesSrc);
    // 4) Clone plans riches (table `plans`) — récupère les blobs complets de la source
    const { data: plansFull } = await supabase.from("plans").select("name,data,thumbnail").eq("projet_id", projetId);
    if (plansFull && plansFull.length > 0) {
      await supabase.from("plans").insert(plansFull.map(p => ({
        name: p.name, data: p.data, thumbnail: p.thumbnail,
        projet_id: nouveau.id, chantier_id: "",
      })));
    }
    // 4b) Clone dessins au stylet (pages manuscrites + croquis)
    const { data: dessinsSrc } = await supabase.from("profero_dessins").select("type,nom,ordre,largeur,hauteur,fond,strokes").eq("projet_id", projetId);
    if (dessinsSrc && dessinsSrc.length > 0) {
      await supabase.from("profero_dessins").insert(dessinsSrc.map(d => ({ ...d, projet_id: nouveau.id })));
    }
    // 5) Refresh
    setProjets(p => [nouveau, ...p]);
    setDupliquerModal(null);
    chargerProjet(nouveau.id);
    } finally {
      setDupliquant(false);
    }
  }

  async function confirmSuppProjet() {
    if (!toDelete) return;
    setDeleting(true);
    await supabase.from("profero_projets").delete().eq("id", toDelete.id);
    const r = projets.filter(p => p.id !== toDelete.id);
    setProjets(r);
    if (toDelete.id === projetId) {
      if (r.length > 0) chargerProjet(r[0].id);
      else {
        setProjetId(null);
        setInfos(INFOS_VIDES);
        setOuvrages([]); setCotes([]); setRichPlans([]); setEditingPlan(null); setDessins([]);
      }
    }
    setDeleting(false);
    setToDelete(null);
  }

  async function ajoutOuvrageLib() {
    if(!newLib.trim()) return;
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",newCat).single();
    if(data){ const l=[...(data.ouvrages||[]),newLib.trim()]; await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[newCat]:l})); setNewLib(""); }
  }
  async function delOuvrageLib(cat,idx) {
    const{data}=await supabase.from("profero_categories_ouvrages").select("*").eq("nom",cat).single();
    if(data){ const l=data.ouvrages.filter((_,i)=>i!==idx); await supabase.from("profero_categories_ouvrages").update({ouvrages:l}).eq("id",data.id); setCategories(p=>({...p,[cat]:l})); }
    setToDeleteOuvrage(null);
  }

  // ─── Gestion bibliothèque (ouvrages + lots) ───────────────────────────────────
  async function renameOuvrageLib(cat, idx, nouveau) {
    const v = (nouveau || "").trim();
    setEditLib(null);
    if (!v) return;
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").eq("nom", cat).single();
    if (!data) return;
    const ancien = (data.ouvrages || [])[idx];
    if (!ancien || ancien === v) return;
    const l = data.ouvrages.map((x, i) => i === idx ? v : x);
    await supabase.from("profero_categories_ouvrages").update({ ouvrages: l }).eq("id", data.id);
    setCategories(p => ({ ...p, [cat]: l }));
    // Réaligne les ouvrages déjà sélectionnés (stockés par libellé)
    await supabase.from("profero_ouvrages_selectionnes").update({ item: v }).eq("category", cat).eq("item", ancien);
    setOuvrages(prev => prev.map(o => (o.category === cat && o.item === ancien) ? { ...o, item: v } : o));
  }
  async function addOuvrageToCat(cat, lib) {
    const v = (lib || "").trim();
    if (!v) return;
    const { data } = await supabase.from("profero_categories_ouvrages").select("*").eq("nom", cat).single();
    if (!data) return;
    const l = [...(data.ouvrages || []), v];
    await supabase.from("profero_categories_ouvrages").update({ ouvrages: l }).eq("id", data.id);
    setCategories(p => ({ ...p, [cat]: l }));
    setAddLibCat(null); setAddLibVal("");
  }
  async function createLot(nom) {
    const v = (nom || "").trim();
    setNewLotName("");
    if (!v || categories[v]) return;
    const { data: rows } = await supabase.from("profero_categories_ouvrages").select("ordre");
    const maxOrdre = (rows || []).reduce((m, r) => Math.max(m, r.ordre ?? 0), -1);
    await supabase.from("profero_categories_ouvrages").insert({ nom: v, ouvrages: [], ordre: maxOrdre + 1 });
    setCategories(p => ({ ...p, [v]: [] }));
  }
  async function renameLot(ancien, nouveau) {
    const v = (nouveau || "").trim();
    setEditLot(null);
    if (!v || v === ancien || categories[v]) return;
    const { data } = await supabase.from("profero_categories_ouvrages").select("id").eq("nom", ancien).single();
    if (!data) return;
    await supabase.from("profero_categories_ouvrages").update({ nom: v }).eq("id", data.id);
    // Rebranche les sélections existantes sur le nouveau nom de lot
    await supabase.from("profero_ouvrages_selectionnes").update({ category: v }).eq("category", ancien);
    setOuvrages(prev => prev.map(o => o.category === ancien ? { ...o, category: v } : o));
    setCategories(p => { const next = {}; Object.entries(p).forEach(([k, val]) => { next[k === ancien ? v : k] = val; }); return next; });
  }
  async function deleteLot(nom) {
    setToDeleteLot(null);
    const { data } = await supabase.from("profero_categories_ouvrages").select("id").eq("nom", nom).single();
    if (data) await supabase.from("profero_categories_ouvrages").delete().eq("id", data.id);
    // Retire les sélections de ce lot pour le projet courant
    if (projetId) {
      await supabase.from("profero_ouvrages_selectionnes").delete().eq("projet_id", projetId).eq("category", nom);
      setOuvrages(prev => prev.filter(o => o.category !== nom));
    }
    setCategories(p => { const next = { ...p }; delete next[nom]; return next; });
  }
  async function reorderLot(nom, dir) {
    const keys = Object.keys(categories);
    const i = keys.indexOf(nom), j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    setReordering(true);
    const reordered = [...keys];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    // Réassigne un ordre séquentiel propre à tous les lots (auto-réparateur)
    await Promise.all(reordered.map((n, idx) =>
      supabase.from("profero_categories_ouvrages").update({ ordre: idx }).eq("nom", n)
    ));
    setCategories(p => { const next = {}; reordered.forEach(n => { next[n] = p[n]; }); return next; });
    setReordering(false);
  }

  // ─── DESSINS AU STYLET (profero_dessins) ─────────────────────────────────────
  async function creerDessin(type) {
    if (!projetId) return null;
    const liste = dessins.filter(d => d.type === type);
    const payload = type === "note"
      ? { projet_id: projetId, type, nom: `Page ${liste.length + 1}`,    ordre: liste.length, largeur: NOTE_W,    hauteur: NOTE_H,    fond: "lignes", strokes: [] }
      : { projet_id: projetId, type, nom: `Croquis ${liste.length + 1}`, ordre: liste.length, largeur: CROQUIS_W, hauteur: CROQUIS_H, fond: "grille", strokes: [] };
    const { data, error } = await supabase.from("profero_dessins").insert(payload).select().single();
    if (error) {
      setSchemaV2Manquant(true);
      alert("Impossible de créer le dessin : " + error.message + "\n\nLa table profero_dessins n'existe pas encore : lancer sql/202609_chiffrage_v2.sql dans Supabase.");
      return null;
    }
    setDessins(p => [...p, data]);
    if (type === "note") setNotePageId(data.id); else setCroquisOuvert(data.id);
    return data;
  }
  function updDessinStrokes(id, strokes) {
    setDessins(p => p.map(d => d.id === id ? { ...d, strokes } : d));
    debounce(`dessin-${id}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_dessins").update({ strokes, updated_at: new Date().toISOString() }).eq("id", id);
      setAutoSaveStatus(error ? "error" : "saved");
    }, 1000);
  }
  function updDessinChamp(id, champ, valeur) {
    const n = marquerSaisieLigne("dessins", id, champ);
    setDessins(p => p.map(d => d.id === id ? { ...d, [champ]: valeur } : d));
    debounce(`dessin-${champ}-${id}`, async () => {
      setAutoSaveStatus("saving");
      const { error } = await supabase.from("profero_dessins").update({ [champ]: valeur }).eq("id", id);
      setAutoSaveStatus(error ? "error" : "saved");
      libererSaisieLigne("dessins", id, champ, n);
    }, champ === "nom" ? 800 : 0);
  }
  async function supprimerDessin(id) {
    await supabase.from("profero_dessins").delete().eq("id", id);
    setDessins(p => p.filter(d => d.id !== id));
    if (notePageId === id) setNotePageId(null);
    if (croquisOuvert === id) setCroquisOuvert(null);
    setToDeleteDessin(null);
  }
  // Vignette PNG d'un dessin (cache par id + nombre de tracés + fond)
  function vignetteDessin(d) {
    const key = `${d.id}:${(d.strokes || []).length}:${d.fond}`;
    const cache = vignetteCache.current;
    if (!cache.has(key)) {
      cache.set(key, renderStrokesDataURL(d.strokes || [], { largeur: d.largeur || CROQUIS_W, hauteur: d.hauteur || CROQUIS_H, fond: d.fond || "grille", pixelWidth: 480 }));
      if (cache.size > 60) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }

  // ─── BIBLIOTHÈQUE D'OUVRAGES (source principale de l'onglet Ouvrages) ────────
  // Seuls les ouvrages dont le libellé commence par un code (« D-001 : … »)
  // sont proposés ; le préfixe du code renvoie au lot de travaux
  // (code_prefixe, planning_config.lots_travaux). Les anciens ouvrages du
  // chiffrage (profero_categories_ouvrages) restent disponibles mais masqués.
  async function chargerBiblio() {
    const [{ data: ouv }, lots, { data: mats }, { data: cfg }, { data: tauxH }, { data: coefV }] = await Promise.all([
      supabase.from("bibliotheque_ratios").select("*").order("libelle"),
      loadLots(),
      supabase.from("materiaux_bibliotheque").select("id,nom,unite,prix_unitaire"),
      supabase.from("planning_config").select("key,value").in("key", ["taux_mo_previsionnel", "chiffrage_tva_defaut"]),
      supabase.from("taux_horaires_vente").select("*"),   // prix MO = cadence × taux de l'ouvrage
      supabase.from("coefficients_vente").select("*"),    // prix matériaux = coût × coefficient de l'ouvrage
    ]);
    // Archivés : lus à part, et appliqués uniquement au catalogue d'ajout.
    const { data: arch, error: errArch } = await supabase.from("planning_config")
      .select("value").eq("key", CLE_ARCHIVES_BIBLIOTHEQUE).maybeSingle();
    setArchivesBiblio(lireArchivesV1(errArch, arch));
    const taux = parseFloat((cfg || []).find(r => r.key === "taux_mo_previsionnel")?.value);
    const tva  = parseFloat((cfg || []).find(r => r.key === "chiffrage_tva_defaut")?.value);
    const b = {
      ouvrages: ouv || [], lots: lots || [], materiaux: mats || [],
      coutHoraire: Number.isFinite(taux) && taux > 0 ? taux : null,   // null = marge non calculable (le prix reste calculable)
      tauxHoraires: tauxH || [],                                        // vide = bloquant (aucun prix MO)
      coefficients: coefV || [],                                        // vide = bloquant (aucun prix matériaux)
      tvaDefaut: Number.isFinite(tva) ? tva : null,
    };
    setBiblio(b);
    return b;   // l'appelant peut calculer tout de suite, sans attendre le state
  }
  // Calcul du prix d'un ouvrage de bibliothèque avec le contexte courant ET les
  // conditions de vente FIGÉES du chiffrage (coefficient / taux global éventuels) :
  // l'origine (paramètres de l'ouvrage) est figée sur la ligne, l'appliqué aussi.
  const conditionsProjet = lireConditionsProjet(projets.find(p => p.id === projetId));
  // `modesLigne` : pour une ligne existante (actualisation), ses dérogations sont
  // reprises telles quelles — actualiser ne remet jamais une ligne en héritage.
  const calculBiblio = (o, modesLigne = null) => calculerOuvrage(o, { materiaux: biblio?.materiaux || [], coutHoraire: biblio?.coutHoraire ?? null, tauxHoraires: biblio?.tauxHoraires || [], coefficientsVente: biblio?.coefficients || [], conditions: conditionsProjet, modesLigne });

  // Après application des conditions (RPC) : recharger CE projet et SES lignes,
  // sans changer de projet ni toucher aux autres chiffrages.
  async function rechargerApresConditions() {
    if (!projetId) return;
    const [{ data: p }, { data: o }] = await Promise.all([
      supabase.from("profero_projets").select("*").eq("id", projetId).maybeSingle(),
      supabase.from("profero_ouvrages_selectionnes").select("*").eq("projet_id", projetId),
    ]);
    if (p) setProjets(prev => prev.map(x => x.id === p.id ? { ...x, ...p } : x));
    if (o) setOuvrages(o);
  }
  // Après application des conditions d'UNE ligne (RPC) : recharger cette seule
  // ligne et le projet (version de concurrence). Aucun autre chiffrage touché.
  async function rechargerApresConditionsLigne(res) {
    const id = res?.ligne_id;
    const [{ data: p }, { data: o }] = await Promise.all([
      supabase.from("profero_projets").select("*").eq("id", projetId).maybeSingle(),
      id ? supabase.from("profero_ouvrages_selectionnes").select("*").eq("id", id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (p) setProjets(prev => prev.map(x => x.id === p.id ? { ...x, ...p } : x));
    if (o) setOuvrages(prev => prev.map(x => x.id === o.id ? o : x));
  }

  // Occurrences déjà présentes dans le devis pour un ouvrage de bibliothèque
  const occurrencesDe = (o) => ouvrages.filter(x => x.bibliotheque_id === o.id);

  // « Ajouter » : chaque clic crée UNE NOUVELLE occurrence (id propre, zone,
  // quantité, snapshot financier figé au moment de l'ajout). Aucune bascule
  // ajout/suppression : la suppression se fait depuis la ligne du devis.
  async function ajouterDepuisBiblio(o, lotLabel) {
    if (!projetId || biblioBusy) return;
    setBiblioBusy(o.id);
    try {
      const calcul = calculBiblio(o);
      const zone = (zoneAjout || "").trim() || ZONE_DEFAUT;
      const snapshot = creerSnapshotOuvrage(o, calcul, { zone, tvaPct: numOrNull(infos.tva_pct), quantite: "" });
      const ordre = ouvrages.filter(x => (x.zone || ZONE_DEFAUT) === zone && x.category === lotLabel).length;
      const complet = { projet_id: projetId, category: lotLabel, ...snapshot, ordre };
      let { data, error } = await supabase.from("profero_ouvrages_selectionnes").insert(complet).select().single();
      if (erreurColonnesLigne(error)) {
        // Colonnes v3 absentes (SQL 202609_chiffrage_devis_logement pas lancé) : ligne minimale
        setSchemaDevisManquant(true);
        const base = sansColonnesLigneV3(complet);
        ({ data, error } = await supabase.from("profero_ouvrages_selectionnes").insert(base).select().single());
        if (error && /bibliotheque_id/.test(error.message || "")) {
          setSchemaV2Manquant(true);
          const { bibliotheque_id, ...sansLien } = base;
          ({ data, error } = await supabase.from("profero_ouvrages_selectionnes").insert(sansLien).select().single());
        }
      }
      if (error) { alert("Ajout impossible : " + error.message); return; }
      if (data) setOuvrages(p => p.some(x => x.id === data.id) ? p : [...p, data]);
    } finally {
      setBiblioBusy(null);
    }
  }

  // « Actualiser depuis la bibliothèque » : recharge l'ouvrage source, calcule
  // les différences avec le snapshot de CETTE ligne et ouvre une confirmation.
  // Rien n'est écrit ici.
  async function preparerActualisation(ligne) {
    if (!ligne?.bibliotheque_id) return;
    const { data: o } = await supabase.from("bibliotheque_ratios").select("*").eq("id", ligne.bibliotheque_id).maybeSingle();
    if (!o) { alert("L'ouvrage source n'existe plus dans la bibliothèque : la ligne garde son snapshot."); return; }
    const calcul = calculBiblio(o, lireModesLigne(ligne));
    const diffs = differencesSnapshot(ligne, o, calcul);
    setActualisation({ ligne, ouvrage: o, calcul, diffs, patch: appliquerActualisation(ligne, o, calcul) });
  }
  async function confirmerActualisation() {
    if (!actualisation) return;
    const { ligne, patch } = actualisation;
    setAutoSaveStatus("saving");
    const { error } = await supabase.from("profero_ouvrages_selectionnes").update(patch).eq("id", ligne.id);   // UNIQUEMENT cette ligne
    if (erreurColonnesLigne(error)) setSchemaDevisManquant(true);
    setAutoSaveStatus(error ? "error" : "saved");
    if (!error) setOuvrages(p => p.map(o => o.id === ligne.id ? { ...o, ...patch } : o));
    setActualisation(null);
  }

  // ─── « MODIFIER MATÉRIAUX » : ALLER-RETOUR AVEC LA BIBLIOTHÈQUE ──────────────
  // Aller : on ouvre la fiche de l'ouvrage source dans la page Bibliothèque
  // (c'est là que les matériaux se modifient). Rien n'est écrit ici.
  function ouvrirMateriauxBiblio(ligne) {
    if (!onModifierMateriaux || !ligne?.bibliotheque_id) return;
    onModifierMateriaux({ ouvrageId: ligne.bibliotheque_id, projetId });
  }

  // Retour : TOUTES les lignes de CE chiffrage issues de l'ouvrage modifié sont
  // recalculées et réécrites (les autres chiffrages ne sont jamais touchés).
  // Un chiffrage terminé (devis envoyé / signé / abandonné) garde ses prix figés :
  // on signale seulement l'écart, l'actualisation reste possible ligne par ligne.
  async function actualiserApresBiblio(ouvrageId, lignesProjet, statut) {
    const lignes = lignesProjet.filter(o => o.bibliotheque_id === ouvrageId);
    if (lignes.length === 0) return;
    // La bibliothèque est rechargée : les matériaux (prix, nouveaux liens) et
    // l'ouvrage viennent d'être modifiés, le state local serait périmé.
    const [{ data: o }, b] = await Promise.all([
      supabase.from("bibliotheque_ratios").select("*").eq("id", ouvrageId).maybeSingle(),
      chargerBiblio(),
    ]);
    if (!o) { setMajBiblio({ libelle: lignes[0].item, nb: lignes.length, supprime: true }); return; }
    const majs = lignes.map(l => {
      const calcul = calculerOuvrage(o, {
        materiaux: b.materiaux, coutHoraire: b.coutHoraire, tauxHoraires: b.tauxHoraires,
        coefficientsVente: b.coefficients, conditions: conditionsProjet, modesLigne: lireModesLigne(l),
      });
      return { ligne: l, diffs: differencesSnapshot(l, o, calcul), patch: appliquerActualisation(l, o, calcul) };
    }).filter(m => m.diffs.length > 0);
    if (majs.length === 0) { setMajBiblio({ libelle: o.libelle, nb: lignes.length, aucun: true }); return; }
    if (chiffrageEstTermine(statut)) { setMajBiblio({ libelle: o.libelle, nb: majs.length, fige: true, statut }); return; }
    setAutoSaveStatus("saving");
    let erreur = null;
    for (const m of majs) {
      const { error } = await supabase.from("profero_ouvrages_selectionnes").update(m.patch).eq("id", m.ligne.id);
      if (error) { erreur = error; if (erreurColonnesLigne(error)) setSchemaDevisManquant(true); break; }
    }
    setAutoSaveStatus(erreur ? "error" : "saved");
    if (!erreur) setOuvrages(prev => prev.map(x => {
      const m = majs.find(y => y.ligne.id === x.id);
      return m ? { ...x, ...m.patch } : x;
    }));
    setMajBiblio({ libelle: o.libelle, nb: majs.length, diffs: majs[0].diffs, erreur: erreur?.message || null });
  }

  // Déclenchement du retour : une seule fois par couple (projet, ouvrage), une
  // fois le projet visé chargé avec ses lignes.
  useEffect(() => {
    if (!retourBiblio?.ouvrageBiblioId || loading || !projetId) return;
    // Le chiffrage d'origine n'existe plus : on abandonne sans rien écrire.
    if (projetId !== retourBiblio.projetId) { onRetourBiblioConsomme?.(); return; }
    const cle = `${retourBiblio.projetId}:${retourBiblio.ouvrageBiblioId}`;
    if (retourTraiteRef.current === cle) return;
    retourTraiteRef.current = cle;
    setTab("ouvrages");
    actualiserApresBiblio(retourBiblio.ouvrageBiblioId, ouvrages, infos.statut);
    onRetourBiblioConsomme?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retourBiblio, loading, projetId, ouvrages]);

  // ─── EXPORT WORD ─────────────────────────────────────────────────────────────
  async function handleExportWord() {
    if (!projetId || exporting) return;
    setExporting(true);
    try {
      // Les plans riches stockent l'aperçu PNG dans `thumbnail` ; l'API attend
      // un champ `data` en data:image. On mappe les vignettes disponibles.
      const plansSnap = (richPlans || [])
        .filter(p => typeof p.thumbnail === "string" && p.thumbnail.startsWith("data:image"))
        .map(p => ({ nom: p.name, data: p.thumbnail }));
      // Document CLIENT : lignes groupées lot → zone, prix de vente et TVA
      // uniquement (aucun coût interne ni marge n'est transmis).
      const payload = { infos, ouvrages, cotes, plans: plansSnap, photos, groupes: groupesDevis, totaux: totauxProjet, logement: logementInfo, lotsOrdre };
      const res = await fetch("/api/generate-info-client-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (infos.client_nom || "client").replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `Fiche-${safe}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export docx:", e);
      alert("Erreur lors de la génération du document : " + e.message);
    }
    setExporting(false);
  }

  // ─── EXPORT PDF (gabarit Profero commun, chiffrageDoc.js) ────────────────────
  // La fenêtre est ouverte SYNCHRONEMENT dans le geste du clic (sinon Safari la
  // bloque), puis remplie une fois les rendus (plans, dessins) prêts.
  // `interne` = synthèse interne avec coûts et marge (jamais pour le client).
  async function exporterPDF(interne = false) {
    if (!projetId || exporting) return;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
    w.document.write(`<!doctype html><html lang='fr'><body style='font-family:Arial,sans-serif;padding:40px;color:#666;'>Préparation ${interne ? "de la synthèse interne" : "du dossier de chiffrage"}…</body></html>`);
    w.document.close();
    setExporting(true);
    try {
      // Plans : rendu haute résolution depuis les données complètes (repli : vignette)
      let plansImgs = [];
      if (richPlans.length > 0) {
        const { data: full } = await supabase.from("plans").select("id,data").in("id", richPlans.map(p => p.id));
        plansImgs = richPlans.map(p => {
          const f = (full || []).find(x => x.id === p.id);
          let image = "";
          try { image = f?.data ? renderPlanDataURL(f.data, { largeur: 1000, hauteur: 700, dpi: 2 }) : ""; } catch { image = ""; }
          if (!image && typeof p.thumbnail === "string" && p.thumbnail.startsWith("data:image")) image = p.thumbnail;
          return { nom: p.name, image };
        }).filter(p => p.image);
      }
      const rendu = (d, pixelWidth) => renderStrokesDataURL(d.strokes || [], { largeur: d.largeur || NOTE_W, hauteur: d.hauteur || NOTE_H, fond: d.fond || "lignes", pixelWidth });
      const notesImgs   = dessins.filter(d => d.type === "note"    && (d.strokes || []).length > 0).map(d => ({ nom: d.nom, image: rendu(d, 1400) }));
      const croquisImgs = dessins.filter(d => d.type === "croquis" && (d.strokes || []).length > 0).map(d => ({ nom: d.nom, image: rendu(d, 1600) }));
      const st = statutMeta(infos.statut);
      const html = buildChiffrageDocHTML({
        infos, statut: { label: st.label, color: st.color },
        ouvrages, lotsOrdre, groupes: groupesDevis, totaux: totauxProjet, logement: logementInfo, preparation, interne,
        cotes,
        notesPages: interne ? [] : notesImgs, plans: interne ? [] : plansImgs, croquis: interne ? [] : croquisImgs,
        medias: interne ? [] : photos.map(p => ({ type: p.type === "video" ? "video" : "image", url: p.url, label: p.label, commentaire: p.commentaire })),
        logoUrl: `${window.location.origin}${LOGO_RENO_H}`,
        dateGen: new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }),
      });
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.document.title = `${interne ? "Synthese-interne" : "Chiffrage"}-${(infos.client_nom || "client").replace(/[^a-zA-Z0-9-_]/g, "_")}${logementInfo.reference ? "-" + logementInfo.reference.replace(/[^a-zA-Z0-9-_]/g, "_") : ""}`;
      // Attendre les photos distantes + les polices (8 s max) avant d'imprimer.
      await new Promise(res => {
        const debut = Date.now();
        const tick = () => {
          const imgs = Array.from(w.document.images || []);
          const ok = w.document.readyState === "complete" && imgs.every(i => i.complete);
          if (ok || Date.now() - debut > 8000) res(); else setTimeout(tick, 150);
        };
        tick();
      });
      try { await (w.document.fonts?.ready || Promise.resolve()); } catch {}
      setTimeout(() => { w.focus(); w.print(); }, 200);
    } catch (e) {
      console.error("Export PDF chiffrage:", e);
      alert("Erreur lors de la génération du PDF : " + (e.message || e));
      try { w.close(); } catch {}
    }
    setExporting(false);
  }

  // ─── COMPUTED ────────────────────────────────────────────────────────────────
  // Filtrage projets (recherche + statut)
  const projetsFiltres = projets.filter(p => {
    if (filtreStatut !== "all" && (p.statut || "prospect") !== filtreStatut) return false;
    if (searchProjets.trim()) {
      const q = searchProjets.toLowerCase();
      const name = `${p.client_nom || ""} ${p.client_prenom || ""} ${p.adresse_bien || ""}`.toLowerCase();
      if (!name.includes(q)) return false;
    }
    return true;
  });

  // Stats par statut
  const statsParStatut = STATUTS_PROJET.reduce((acc, s) => {
    acc[s.id] = projets.filter(p => (p.statut || "prospect") === s.id).length;
    return acc;
  }, {});

  // Totaux du devis (module pur chiffragePricing) : vente HT, coûts figés,
  // marge pondérée, TVA/TTC, écart budget. `estimationTotale` = vente HT.
  const budgetClient = infos.budget_client === "" || infos.budget_client == null ? null : parseFloat(infos.budget_client);
  const totauxProjet = totauxDevis(ouvrages, { tvaPctDefaut: numOrNull(infos.tva_pct), budgetClient });
  const estimationTotale = totauxProjet.venteHT;
  const lotsOrdre = [...(biblio?.lots || []).map(l => l.label), ...Object.keys(categories)];
  const groupesDevis = grouperParLotZone(ouvrages, lotsOrdre);          // LOT → ZONE → OUVRAGES
  const logementInfo = lireLogementProjet(infos);                        // repli sur l'ancien `logements`
  const preparation = verifierPreparationDevis(infos, ouvrages, totauxProjet);
  const couleurLot = (label) => (biblio?.lots || []).find(l => l.label === label)?.couleur || "#8a90a0";
  const coutHoraireManquant = !!biblio && biblio.coutHoraire == null;
  const diagTaux = biblio ? diagnostiquerListe(biblio.tauxHoraires || []) : null;
  const diagCoef = biblio ? diagnostiquerCoefficients(biblio.coefficients || []) : null;
  const tvaManquante = numOrNull(infos.tva_pct) == null;

  // Dessins au stylet
  const notesPages  = dessins.filter(d => d.type === "note");
  const croquisList = dessins.filter(d => d.type === "croquis");
  const pageActive  = notesPages.find(d => d.id === notePageId) || notesPages[0] || null;
  const croquisActif = croquisList.find(d => d.id === croquisOuvert) || null;
  dessinOuvertRef.current = croquisActif?.id || (tab === "notes" && notesMode === "manuscrit" ? pageActive?.id : null) || null;

  // Bibliothèque : ouvrages codés, groupés par lot (préfixe du code → code_prefixe)
  const groupesBiblio = (() => {
    const lots = biblio?.lots || [];
    const map = new Map();
    // SEUL endroit filtré de cet écran : c'est ici que l'utilisateur CHOISIT un
    // ouvrage à ajouter au devis. Partout ailleurs (preparerActualisation,
    // actualiserApresBiblio, calculBiblio sur une ligne existante), biblio.ouvrages
    // reste complet — un ouvrage archivé déjà posé dans un devis doit continuer
    // d'être lu, affiché et recalculé normalement.
    filtrerPourChoixV1(biblio?.ouvrages || [], archivesBiblio).forEach(o => {
      const c = decoderLibelleCode(o.libelle);
      if (!c) return;
      const lot = lots.find(l => (l.code_prefixe || "").toUpperCase() === c.prefixe);
      const key = lot ? lot.label : c.prefixe;
      if (!map.has(key)) map.set(key, { label: key, couleur: lot?.couleur || "#8a90a0", prefixe: c.prefixe, ordre: lot ? lots.indexOf(lot) : 999, items: [] });
      map.get(key).items.push({ ...o, _code: c });
    });
    return [...map.values()]
      .sort((a, b) => a.ordre - b.ordre || a.label.localeCompare(b.label))
      .map(g => ({ ...g, items: g.items.sort((a, b) => a._code.num - b._code.num || a._code.code.localeCompare(b._code.code)) }));
  })();
  const nbBiblio = groupesBiblio.reduce((s, g) => s + g.items.length, 0);
  const nbAnciens = Object.values(categories).flat().length;
  const nbAnciensSel = ouvrages.filter(o => !o.bibliotheque_id && (categories[o.category] || []).includes(o.item)).length;

  // ─── RENDU ───────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,color:T.textMuted,fontSize:FONT.sm.size}}>
      Chargement…
    </div>
  );

  const projetActif = projets.find(p => p.id === projetId);
  // Ligne d'édition d'une occurrence du devis : zone · quantité × unité × prix
  // · TVA · total. Le prix de vente d'une ligne issue de la bibliothèque est
  // FIGÉ (snapshot) et ne se saisit pas ; les anciennes lignes (sans snapshot)
  // gardent leur prix saisi à la main.
  const ligneEdition = (sel) => {
    const snap = ligneEstSnapshot(sel);
    const pu = numOrNull(sel.prix_unitaire);
    const total = totalLigneHT(sel);
    const erreursSnap = snap ? (sel.calcul_detail?.erreurs || []) : [];
    const condLigne = decrireConditionsLigne(sel);
    const tvaLigne = numOrNull(sel.tva_pct);
    const pill = (c) => ({ display:"inline-flex", alignItems:"center", gap:4, fontSize:FONT.xs.size+1, fontWeight:800, color:c, background:c+"1a", border:`1px solid ${c}40`, borderRadius:RADIUS.sm, padding:"4px 8px", whiteSpace:"nowrap" });
    return (
      <div className="ouvrage-edit-row" style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap", alignItems:"center" }}>
        <input list="pic-zones" placeholder="Zone" value={sel.zone ?? ZONE_DEFAUT} onChange={e=>updZone(sel.id,e.target.value)}
          className="zone-input" title="Zone de cette occurrence (libre, suggestions proposées)"
          style={{...inp,width:150,padding:"5px 8px",fontSize:FONT.xs.size+1}}/>
        <input type="number" placeholder="Qté" value={sel.quantite||""} onChange={e=>updQte(sel.id,e.target.value)}
          className="qte-input"
          style={{...inp,width:70,padding:"5px 8px",fontSize:FONT.xs.size+1}}/>
        <select value={sel.unite||"U"} onChange={e=>updUnite(sel.id,e.target.value)}
          className="unit-select"
          style={{...inp,width:70,padding:"5px 8px",fontSize:FONT.xs.size+1,cursor:"pointer"}}>
          <option value="U">Unité</option><option value="m">m</option><option value="m²">m²</option><option value="ml">ml</option><option value="m3">m³</option><option value="kg">kg</option><option value="forfait">Forfait</option>{!["U","m","m²","ml","m3","kg","forfait"].includes(sel.unite||"U") && <option value={sel.unite}>{sel.unite}</option>}
        </select>
        <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>×</span>
        {snap ? (
          pu != null ? (
            <button type="button" onClick={()=>setVoirDetailLigne(sel)} title={`Prix de vente HT unitaire figé (coût matériaux + main-d'œuvre + marge). Cliquer pour le détail.${condLigne.lignes.length ? "\n" + condLigne.lignes.join("\n") : ""}`} style={{ ...pill(condLigne.derogation ? "#a78bfa" : condLigne.global ? "#4db8ff" : "#22c55e"), cursor:"pointer", fontFamily:"inherit" }}>
              <Icon as={Lock} size={10}/>{fmtEur2(pu)}{(condLigne.global || condLigne.derogation) && <span style={{fontWeight:600,opacity:.85}}>· {condLigne.court}</span>}
            </button>
          ) : (
            <button type="button" onClick={()=>setVoirDetailLigne(sel)} title={erreursSnap.join(" · ") || "Prix non calculable"} style={{ ...pill("#e15a5a"), cursor:"pointer", fontFamily:"inherit" }}>
              <Icon as={AlertTriangle} size={10}/>Prix incalculable
            </button>
          )
        ) : (
          <div className="prix-wrap" style={{position:"relative",width:100}} title="Ancienne ligne : prix de vente HT saisi à la main">
            <input type="number" placeholder="Prix" step="0.01" value={sel.prix_unitaire ?? ""} onChange={e=>updPrix(sel.id,e.target.value)}
              style={{...inp,width:"100%",padding:"5px 22px 5px 8px",fontSize:FONT.xs.size+1,color:"#22c55e",fontWeight:700}}/>
            <span style={{position:"absolute",right:8,top:"50%",transform:"translateY(-50%)",fontSize:FONT.xs.size,color:T.textMuted,pointerEvents:"none"}}>€</span>
          </div>
        )}
        <select value={tvaLigne ?? ""} onChange={e=>updTvaLigne(sel.id,e.target.value)} title="TVA de la ligne (vide = TVA du projet)"
          style={{...inp,width:"auto",padding:"5px 6px",fontSize:FONT.xs.size,cursor:"pointer",color:T.textSub}}>
          <option value="">TVA projet{!tvaManquante ? ` ${infos.tva_pct} %` : " ?"}</option>
          {TVA_TAUX_USUELS.map(t => <option key={t} value={t}>TVA {t} %</option>)}
          {tvaLigne != null && !TVA_TAUX_USUELS.includes(tvaLigne) && <option value={tvaLigne}>TVA {tvaLigne} %</option>}
        </select>
        {total != null && total > 0 && (
          <span className="total-badge" style={{ ...pill("#22c55e"), marginLeft:"auto" }}>= {fmtEur2(total)}</span>
        )}
        {condLigne.badge && (
          <span title={condLigne.lignes.join("\n")} style={{ ...pill("#a78bfa"), fontWeight:700 }}>{condLigne.badge}</span>
        )}
        <button title={`Coefficient et taux horaire de vente de CETTE ligne (aucun autre ouvrage, aucun autre chiffrage, ni la bibliothèque).${condLigne.lignes.length ? "\n" + condLigne.lignes.join("\n") : ""}`}
          onClick={()=>setConditionsLigne(sel)} style={iconBtnSec}><Icon as={SlidersHorizontal} size={12}/></button>
        {sel.bibliotheque_id && onModifierMateriaux && (
          <button title={`Ouvrir « ${sel.item} » dans la bibliothèque pour en modifier les matériaux. Au retour, les lignes de ce chiffrage issues de cet ouvrage sont réactualisées (sauf chiffrage terminé).`}
            onClick={()=>ouvrirMateriauxBiblio(sel)}
            style={{ ...iconBtnSec, width:"auto", gap:5, padding:"0 9px", fontFamily:"inherit", fontSize:FONT.xs.size, fontWeight:700, whiteSpace:"nowrap" }}>
            <Icon as={Package} size={12}/> Modifier matériaux
          </button>
        )}
        {sel.bibliotheque_id && (
          <button title="Actualiser depuis la bibliothèque (affiche les différences, puis confirmation)" onClick={()=>preparerActualisation(sel)} style={iconBtnSec}><Icon as={RefreshCw} size={12}/></button>
        )}
        <button title="Retirer cette ligne du devis" onClick={()=>setToDeleteLigne(sel)} style={iconBtnDng}><Icon as={Trash2} size={12}/></button>
      </div>
    );
  };
  // Petit sélecteur de TVA (projet) : taux usuels + saisie libre
  const selecteurTva = (value, onChange, { large = false } = {}) => {
    const v = value === "" || value == null ? "" : String(value);
    const usuel = v === "" || TVA_TAUX_USUELS.map(String).includes(v);
    return (
      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        {TVA_TAUX_USUELS.map(t => {
          const a = v !== "" && parseFloat(v) === t;
          return <button key={t} type="button" onClick={()=>onChange(String(t))} style={{ ...(a?btn:btnSec), padding: large ? "8px 14px" : "6px 12px" }}>{t} %</button>;
        })}
        <div style={{ position:"relative", width:110 }}>
          <input type="number" min="0" max="100" step="0.1" placeholder="Autre" value={usuel && v !== "" ? "" : v} onChange={e=>onChange(e.target.value)}
            style={{...inp, padding:"7px 24px 7px 10px"}}/>
          <span style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",fontSize:FONT.xs.size,color:T.textMuted,pointerEvents:"none"}}>%</span>
        </div>
        {v === "" && <span style={{ fontSize:FONT.xs.size+1, color:"#e15a5a", fontWeight:700, display:"inline-flex", alignItems:"center", gap:4 }}><Icon as={AlertTriangle} size={11}/> À choisir</span>}
      </div>
    );
  };


  return (
    <div className="pic-page" style={{ flex:1, minWidth:0, width:"100%", display:"flex", height:"100%", background:T.bg, overflow:"hidden", position:"relative" }}>
      <style>{`
        .pic-mobile-bar{display:none}

        /* ─────────────────────────────────────────────────────────────
           POLISH GLOBAL (toutes tailles) — focus, transitions, ombres
           ───────────────────────────────────────────────────────────── */
        .pic-page *{box-sizing:border-box}

        /* Champs de saisie : transition douce + anneau de focus accent */
        .pic-page .pic-body input:not([type=checkbox]):not([type=range]),
        .pic-page .pic-body select,
        .pic-page .pic-body textarea,
        .pic-page .pic-list-panel input,
        .pic-page .pic-list-panel select{
          transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        }
        .pic-page .pic-body input:not([type=checkbox]):not([type=range]):focus,
        .pic-page .pic-body select:focus,
        .pic-page .pic-body textarea:focus,
        .pic-page .pic-list-panel input:focus,
        .pic-page .pic-list-panel select:focus{
          border-color:${acc.accent}!important;
          box-shadow:0 0 0 3px ${acc.bg10}!important;
          outline:none;
        }
        .pic-page .pic-body input::placeholder,
        .pic-page .pic-body textarea::placeholder{color:${T.textMuted};opacity:.8}

        /* Cartes génériques : survol = légère élévation */
        .pic-page .pic-card{transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
        .pic-page .pic-card:hover{transform:translateY(-2px);box-shadow:${SHADOW.md};border-color:${acc.border}}

        /* Onglets : transition + survol */
        .pic-page .pic-tabs button{transition:transform .12s ease, background .12s ease, color .12s ease, box-shadow .12s ease}
        .pic-page .pic-tabs button:hover{transform:translateY(-1px)}

        /* Boutons : feedback de survol discret */
        .pic-page button{transition:transform .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease}
        .pic-page button:active{transform:translateY(1px)}

        /* Barres de défilement discrètes */
        .pic-page .pic-list-panel ::-webkit-scrollbar,
        .pic-page .pic-body::-webkit-scrollbar{width:9px;height:9px}
        .pic-page .pic-list-panel ::-webkit-scrollbar-thumb,
        .pic-page .pic-body::-webkit-scrollbar-thumb{background:${T.border};border-radius:9px;border:2px solid transparent;background-clip:padding-box}
        .pic-page .pic-list-panel ::-webkit-scrollbar-thumb:hover,
        .pic-page .pic-body::-webkit-scrollbar-thumb:hover{background:${T.textMuted}}
        .pic-page .pic-list-panel,
        .pic-page .pic-body{scrollbar-width:thin;scrollbar-color:${T.border} transparent}

        /* Le contenu occupe toute la largeur disponible */
        .pic-page .pic-section-narrow{width:100%}

        /* ── TABLETTE (768–1180px) : cibles tactiles confortables ── */
        @media(min-width:768px) and (max-width:1180px){
          .pic-page .pic-list-panel{width:300px!important}
          .pic-page .pic-body{padding:20px 24px!important}
          .pic-page .pic-body input:not([type=checkbox]):not([type=range]),
          .pic-page .pic-body select,
          .pic-page .pic-tabs button{min-height:44px}
          .pic-page .pic-tabs button{padding:9px 16px!important;font-size:13px!important}
          /* On garde les lignes d'édition d'ouvrage compactes */
          .pic-page .ouvrage-edit-row input,
          .pic-page .ouvrage-edit-row select{min-height:36px!important}
        }

        /* ── GRAND ÉCRAN (≥1600px) : un peu plus d'air ── */
        @media(min-width:1600px){
          .pic-page .pic-body{padding:26px 36px!important}
        }

        @media(max-width:767px){
          /* Sans cette règle, le parent reste en flex-row : la mobile-bar avec
             width:100% + flex-shrink:0 prend toute la largeur ET toute la hauteur
             (align-items:stretch), et le contenu principal a 0px de large. */
          .pic-page{flex-direction:column!important}

          .pic-page .pic-list-panel{position:absolute;left:0;top:0;bottom:0;width:88%!important;max-width:320px!important;z-index:60;transform:translateX(-100%);transition:transform .25s;box-shadow:4px 0 24px rgba(0,0,0,0.4)}
          .pic-page .pic-list-panel.open{transform:translateX(0)}
          .pic-page .pic-drawer-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:55;opacity:0;pointer-events:none;transition:opacity .2s}
          .pic-page .pic-drawer-backdrop.open{opacity:1;pointer-events:auto}
          .pic-page .pic-mobile-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:${T.surface};border-bottom:1px solid ${T.border};flex-shrink:0;width:100%}
          .pic-page .pic-form-grid{grid-template-columns:1fr!important;gap:8px!important}

          /* Header projet : padding réduit, statut + actions sur leur propre ligne */
          .pic-page .pic-projet-header{padding:10px 12px!important}
          .pic-page .pic-projet-header-row{flex-wrap:wrap!important;gap:8px!important;margin-bottom:8px!important}
          .pic-page .pic-projet-actions{flex:1 1 100%;display:flex;gap:6px;order:10}
          .pic-page .pic-projet-actions select{flex:1}
          .pic-page .pic-projet-name{font-size:15px!important}

          /* Onglets : scroll horizontal au lieu de wrap, plus compacts */
          .pic-page .pic-tabs{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -12px;padding:0 12px;scrollbar-width:none}
          .pic-page .pic-tabs::-webkit-scrollbar{display:none}
          .pic-page .pic-tabs button{flex-shrink:0;padding:7px 11px!important;white-space:nowrap}

          /* Body des onglets : padding réduit */
          .pic-page .pic-body{padding:14px 12px!important}

          /* Ligne d'édition d'ouvrage : inputs compacts (anti CSS global 42px+10/12px) */
          .pic-page .ouvrage-edit-row{gap:5px!important}
          .pic-page .ouvrage-edit-row input,
          .pic-page .ouvrage-edit-row select{
            min-height:34px!important;
            padding:5px 8px!important;
            font-size:14px!important;
          }
          .pic-page .ouvrage-edit-row .qte-input{width:64px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .unit-select{width:64px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .prix-wrap{width:96px!important;flex-shrink:0}
          .pic-page .ouvrage-edit-row .total-badge{flex:1 1 100%;margin-left:0!important;justify-content:flex-end}

          /* Cartes côtes : grille 2x2 reste lisible */
          .pic-page .cote-card input{min-height:34px!important;padding:5px 8px!important;font-size:14px!important}

          /* Labels un peu plus lisibles sur mobile */
          .pic-page .lbl{font-size:12px!important}
        }
      `}</style>

      {/* ── BARRE MOBILE ── */}
      <div className="pic-mobile-bar">
        <button onClick={()=>setMobileShowProjets(true)} style={{
          display:"inline-flex",alignItems:"center",gap:6,
          background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,
          padding:"7px 12px",color:T.text,fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
        }}>
          <Icon as={Menu} size={13}/>
          Projets
        </button>
        <div style={{flex:1,minWidth:0,fontSize:FONT.sm.size,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {projetId ? (infos.client_nom?`${infos.client_nom} ${infos.client_prenom||""}`:"Sans client") : "Aucun projet"}
        </div>
      </div>

      <div className={`pic-drawer-backdrop ${mobileShowProjets?"open":""}`} onClick={()=>setMobileShowProjets(false)}/>

      {/* ── SIDEBAR LISTE PROJETS ── */}
      <div className={`pic-list-panel ${mobileShowProjets?"open":""}`} style={{
        width:280,flexShrink:0,display:"flex",flexDirection:"column",
        background:T.surface,borderRight:`1px solid ${T.border}`,
      }}>
        {/* Header sidebar */}
        <div style={{padding:"14px 14px",borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{
              width:34,height:34,borderRadius:RADIUS.lg,flexShrink:0,
              background:`linear-gradient(135deg, ${acc.accent}, ${acc.accentDark})`,color:acc.onAccent,
              display:"flex",alignItems:"center",justifyContent:"center",boxShadow:SHADOW.sm,
            }}>
              <Icon as={UserCircle} size={19} strokeWidth={2}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,letterSpacing:-.2,display:"flex",alignItems:"center",gap:8}}>
                Chiffrage
                {(() => {
                  const c = autoSaveStatus === "saved" ? "#22c55e"
                          : autoSaveStatus === "saving" ? acc.accent
                          : autoSaveStatus === "error"  ? "#e15a5a"
                          : "#f5a623";
                  const lbl = autoSaveStatus === "saved" ? "Sauvegardé"
                            : autoSaveStatus === "saving" ? "Sauvegarde…"
                            : autoSaveStatus === "error"  ? "Erreur"
                            : "Modif en cours";
                  return <span style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    fontSize:9,fontWeight:700,letterSpacing:.6,textTransform:"uppercase",
                    color:c,background:c+"18",border:`1px solid ${c}40`,
                    borderRadius:99,padding:"2px 8px",
                  }}>
                    <span style={{width:6,height:6,borderRadius:"50%",background:c}}/>
                    {lbl}
                  </span>;
                })()}
              </div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>
                {projets.length} projet{projets.length>1?"s":""}
              </div>
            </div>
            <button onClick={nouveauProjet} title="Nouveau projet" style={{
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              background:acc.accent,color:acc.onAccent,border:"none",
              borderRadius:RADIUS.md,width:30,height:30,cursor:"pointer",
            }}>
              <Icon as={Plus} size={14}/>
            </button>
          </div>

          {/* Recherche */}
          <div style={{position:"relative",marginBottom:8}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
            <input value={searchProjets} onChange={e=>setSearchProjets(e.target.value)} placeholder="Rechercher…"
              style={{
                width:"100%",background:T.fieldBg||T.card,
                border:`1px solid ${T.fieldBorder||T.border}`,borderRadius:RADIUS.md,
                padding:"7px 10px 7px 28px",color:T.text,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",
              }}/>
          </div>

          {/* Filtre statut */}
          <select value={filtreStatut} onChange={e=>setFiltreStatut(e.target.value)} style={{
            width:"100%",background:T.fieldBg||T.card,border:`1px solid ${T.fieldBorder||T.border}`,
            borderRadius:RADIUS.md,padding:"7px 10px",color:T.text,
            fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",cursor:"pointer",
          }}>
            <option value="all">Tous les statuts</option>
            {STATUTS_PROJET.map(s => (
              <option key={s.id} value={s.id}>{s.label} ({statsParStatut[s.id] || 0})</option>
            ))}
          </select>
        </div>

        {/* Liste */}
        <div style={{flex:1,overflowY:"auto",padding:8}}>
          {projets.length===0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",marginTop:20,lineHeight:1.8}}>
              Aucun projet<br/>
              <button onClick={nouveauProjet} style={{
                display:"inline-flex",alignItems:"center",gap:5,marginTop:10,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"7px 14px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
              }}>
                <Icon as={Plus} size={12}/>
                Créer
              </button>
            </div>
          )}
          {projetsFiltres.length===0 && projets.length>0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",padding:"16px 12px",fontStyle:"italic"}}>
              Aucun projet pour ces filtres.
            </div>
          )}
          {projetsFiltres.map(p => {
            const act=p.id===projetId;
            const st=statutMeta(p.statut);
            return (
              <div key={p.id} className="pic-card" onClick={()=>{chargerProjet(p.id);setMobileShowProjets(false);}} style={{
                padding:"11px 13px",borderRadius:RADIUS.lg,marginBottom:7,cursor:"pointer",
                background:act?`linear-gradient(135deg, ${acc.bg10}, ${acc.bg20})`:T.card,
                border:`1px solid ${act?acc.accent:T.border}`,
                borderLeft:`3px solid ${st.color}`,
                boxShadow:act?SHADOW.sm:"none",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <span style={{fontSize:FONT.sm.size,fontWeight:700,color:act?acc.accent:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {p.client_nom?`${p.client_nom} ${p.client_prenom||""}`:"Sans client"}
                  </span>
                  <span style={{
                    fontSize:FONT.xs.size-1,fontWeight:700,padding:"1px 6px",borderRadius:RADIUS.sm,
                    background:st.color+"22",color:st.color,whiteSpace:"nowrap",flexShrink:0,
                  }}>{st.label}</span>
                </div>
                {(() => {
                  const lg = lireLogementProjet(p);
                  const txt = [lg.reference, lg.type].filter(Boolean).join(" · ");
                  if (!txt && !lg.aVerifier) return null;
                  return (
                    <div style={{fontSize:FONT.xs.size,color:lg.aVerifier?"#f5a623":T.textSub,marginTop:2,display:"flex",alignItems:"center",gap:4,fontWeight:600}}>
                      <Icon as={lg.aVerifier?AlertTriangle:Home} size={9}/>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{lg.aVerifier ? `À vérifier : ${lg.legacy.join(" · ")}` : txt}</span>
                    </div>
                  );
                })()}
                {(p.chantier_adresse || p.adresse_bien) && (
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"flex",alignItems:"center",gap:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    <Icon as={MapPin} size={9}/>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.chantier_adresse ? [p.chantier_adresse, p.chantier_ville].filter(Boolean).join(", ") : p.adresse_bien}</span>
                  </div>
                )}
                {p.date_visite && (
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Calendar} size={9}/>
                    {new Date(p.date_visite).toLocaleDateString("fr-FR")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENU PRINCIPAL ── */}
      {!projetId ? (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:T.textSub,padding:24}}>
          <div style={{
            width:72,height:72,borderRadius:RADIUS.xl,
            background:`linear-gradient(135deg, ${acc.accent}, ${acc.accentDark})`,color:acc.onAccent,
            display:"flex",alignItems:"center",justifyContent:"center",boxShadow:SHADOW.lg,
          }}>
            <Icon as={UserCircle} size={34} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.md.size,fontWeight:700,color:T.text}}>Sélectionne ou crée un projet</div>
          <button onClick={nouveauProjet} style={{
            display:"inline-flex",alignItems:"center",gap:6,
            background:acc.accent,color:acc.onAccent,border:"none",
            borderRadius:RADIUS.md,padding:"10px 20px",cursor:"pointer",
            fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
          }}>
            <Icon as={Plus} size={14}/>
            Nouveau projet
          </button>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          {/* En-tête projet + statut + onglets */}
          <div className="pic-projet-header" style={{
            padding:"16px 22px",borderBottom:`1px solid ${T.border}`,
            background:`linear-gradient(180deg, ${acc.bg10}, ${T.surface} 90%)`,
            flexShrink:0, boxShadow:SHADOW.sm, position:"relative", zIndex:2,
          }}>
            <div className="pic-projet-header-row" style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.lg,flexShrink:0,
                background:`linear-gradient(135deg, ${acc.accent}, ${acc.accentDark})`,color:acc.onAccent,
                display:"flex",alignItems:"center",justifyContent:"center",boxShadow:SHADOW.sm,
              }}>
                <Icon as={UserCircle} size={22} strokeWidth={2}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div className="pic-projet-name" style={{fontSize:FONT.lg.size+2,fontWeight:800,color:T.text,letterSpacing:-.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {infos.client_nom ? `${infos.client_nom} ${infos.client_prenom||""}` : "Nouveau projet"}
                </div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,display:"flex",flexWrap:"wrap",gap:10}}>
                  {(logementInfo.reference || logementInfo.type) && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,color:acc.accent,fontWeight:700}}>
                      <Icon as={Home} size={11}/>{[logementInfo.reference, logementInfo.type].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {logementInfo.aVerifier && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,color:"#f5a623",fontWeight:700}} title={logementInfo.message}>
                      <Icon as={AlertTriangle} size={11}/>Ancien projet multi-logements : à vérifier
                    </span>
                  )}
                  {(infos.chantier_adresse || infos.adresse_bien) && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={MapPin} size={11}/>{infos.chantier_adresse ? [infos.chantier_adresse, infos.chantier_code_postal, infos.chantier_ville].filter(Boolean).join(" ") : infos.adresse_bien}
                    </span>
                  )}
                  {infos.date_visite && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={Calendar} size={11}/>{new Date(infos.date_visite).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                  {budgetClient != null && !isNaN(budgetClient) && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,color:"#22c55e",fontWeight:700}}>
                      <Icon as={Wallet} size={11}/>{fmtEur(budgetClient)}
                    </span>
                  )}
                  {infos.delai_souhaite && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={Clock} size={11}/>{infos.delai_souhaite}
                    </span>
                  )}
                </div>
              </div>
              {/* Statut + actions : sur mobile passent en row dédiée pleine largeur */}
              <div className="pic-projet-actions">
                <select value={infos.statut || "prospect"} onChange={e=>updInfo("statut",e.target.value)}
                  style={{
                    padding:"7px 12px",borderRadius:RADIUS.md,border:`1px solid ${statutMeta(infos.statut).color}55`,
                    background:statutMeta(infos.statut).color+"18",color:statutMeta(infos.statut).color,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,outline:"none",cursor:"pointer",
                  }}>
                  {STATUTS_PROJET.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button onClick={()=>setDupliquerModal({ reference: "", type: logementInfo.type || "" })} title="Dupliquer pour un autre logement (mêmes client, adresse, ouvrages et prix figés)" style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid ${T.border}`,
                  borderRadius:RADIUS.md,padding:"7px 10px",color:T.textSub,cursor:"pointer",
                }}>
                  <Icon as={Copy} size={13}/>
                </button>
                <button onClick={()=>setToDelete(projetActif)} title="Supprimer ce projet" style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid rgba(224,92,92,0.3)`,
                  borderRadius:RADIUS.md,padding:"7px 10px",color:"#e15a5a",cursor:"pointer",
                }}>
                  <Icon as={Trash2} size={13}/>
                </button>
              </div>
            </div>

            {/* Onglets unifiés (scroll horizontal sur mobile) */}
            <div className="pic-tabs" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[
                { id:"client",   label:"Client & projet", icon:UserCircle },
                { id:"notes",    label:"Notes",           icon:StickyNote },
                { id:"ouvrages", label:"Ouvrages",        icon:Hammer },
                { id:"plan",     label:"Plan & côtes",    icon:Ruler },
                { id:"photos",   label:"Photos & vidéos", icon:Camera },
                { id:"params",   label:"Paramètres",      icon:Settings },
                { id:"export",   label:"Export",          icon:FileDown },
              ].map(t => {
                const a=tab===t.id;
                return (
                  <button key={t.id} onClick={()=>setTab(t.id)} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    padding:"8px 15px",borderRadius:RADIUS.lg,
                    border:a?"1px solid transparent":`1px solid ${T.border}`,
                    background:a?`linear-gradient(135deg, ${acc.accent}, ${acc.accentDark})`:T.card,
                    color:a?acc.onAccent:T.textSub,
                    boxShadow:a?SHADOW.sm:"none",
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                  }}>
                    <Icon as={t.icon} size={12}/>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Corps onglet */}
          <div className="pic-body" style={{flex:1,overflowY:"auto",padding:"18px 22px",background:T.bg,minWidth:0}}>
            {schemaV2Manquant && (
              <div style={{ marginBottom:12, padding:"9px 12px", borderRadius:RADIUS.md, background:"rgba(245,166,35,0.12)", border:"1px solid rgba(245,166,35,0.4)", color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <Icon as={AlertTriangle} size={13}/>
                Base non à jour : lancer <code style={{fontFamily:"monospace"}}>sql/202609_chiffrage_v2.sql</code> dans Supabase pour activer budget/délai, notes manuscrites, croquis et le lien bibliothèque.
              </div>
            )}
            {schemaDevisManquant && (
              <div style={{ marginBottom:12, padding:"9px 12px", borderRadius:RADIUS.md, background:"rgba(225,90,90,0.10)", border:"1px solid rgba(225,90,90,0.4)", color:"#e15a5a", fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <Icon as={AlertTriangle} size={13}/>
                Base non à jour : lancer <code style={{fontFamily:"monospace"}}>sql/202609_chiffrage_devis_logement.sql</code> dans Supabase pour enregistrer client/chantier/logement/devis, les zones et les prix figés des lignes. En attendant, ces champs ne sont PAS sauvegardés.
              </div>
            )}

            {tab==="client" && (() => {
              const carte = (titre, icon, children, { warn = false } = {}) => (
                <div style={{ background:T.surface, border:`1px solid ${warn ? "rgba(245,166,35,0.5)" : T.border}`, borderRadius:RADIUS.xl, padding:18, marginBottom:14, boxShadow:SHADOW.sm }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:warn ? "#f5a623" : acc.accent, marginBottom:14, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={icon} size={12}/>{titre}
                  </div>
                  {children}
                </div>
              );
              const grille = (children, cols = "1fr 1fr") => <div className="pic-form-grid" style={{ display:"grid", gridTemplateColumns:cols, gap:12, alignItems:"start" }}>{children}</div>;
              // Champs d'adresse : suggestions Base Adresse Nationale. Le choix d'une
              // suggestion remplit rue + code postal + ville (+ pays) du même préfixe d'un coup.
              const patchAdresse = (prefixe, s, complet) => complet
                ? { [`${prefixe}_adresse`]: s.adresse || s.label, [`${prefixe}_code_postal`]: s.codePostal, [`${prefixe}_ville`]: s.ville, [`${prefixe}_pays`]: infos[`${prefixe}_pays`] || "France" }
                : { [`${prefixe}_code_postal`]: s.codePostal || infos[`${prefixe}_code_postal`] || "", [`${prefixe}_ville`]: s.ville || infos[`${prefixe}_ville`] || "" };
              const champ = (label, f, props = {}) => (
                <div style={props.span ? { gridColumn:"1 / -1" } : undefined}>
                  <label style={lbl}>{label}</label>
                  {props.adresse
                    ? <AdresseInput style={inp} inputMode={props.inputMode} value={infos[f] ?? ""} placeholder={props.placeholder || ""}
                        type={props.adresse.type} champ={props.adresse.champ}
                        onChange={v=>updInfo(f,v)}
                        onSelect={s=>updInfos(patchAdresse(props.adresse.prefixe, s, props.adresse.champ === "rue"))} />
                    : <input style={inp} type={props.type || "text"} inputMode={props.inputMode} value={infos[f] ?? ""} onChange={e=>updInfo(f,e.target.value)} placeholder={props.placeholder || ""} />}
                </div>
              );
              const typeCourant = infos.type_logement || (logementInfo.repli ? logementInfo.type : "");
              return (
              <div className="pic-section-narrow">
                {/* ── Carte : ancien projet multi-logements (lecture seule) ── */}
                {logementInfo.aVerifier && carte("Ancien projet à vérifier", AlertTriangle, (
                  <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6 }}>
                    Ce projet a été créé avec l'ancienne « composition » : <strong style={{color:T.text}}>{logementInfo.legacy.join(" · ")}</strong>.
                    Désormais <strong style={{color:T.text}}>un projet = un logement = un devis</strong>. Rien n'a été découpé automatiquement : renseigne ci-dessous le logement que CE projet représente, puis utilise <strong style={{color:T.text}}>Dupliquer</strong> pour créer les autres logements (ouvrages, zones et prix figés recopiés).
                  </div>
                ), { warn:true })}

                {/* ── Carte : client ── */}
                {carte("Client", UserCircle, grille(<>
                  {champ("Nom", "client_nom", { placeholder:"Dupont" })}
                  {champ("Prénom", "client_prenom", { placeholder:"Jean" })}
                  {champ("Société (si applicable)", "client_societe", { placeholder:"SCI Les Tilleuls" })}
                  {champ("E-mail", "client_email", { type:"email", placeholder:"jean.dupont@mail.fr" })}
                  {champ("Téléphone", "client_telephone", { type:"tel", placeholder:"06 12 34 56 78" })}
                  <div style={{ gridColumn:"1 / -1", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginTop:4 }}>
                    <span style={{ ...lbl, marginBottom:0 }}>Adresse de facturation</span>
                    {infos.chantier_adresse && (
                      <button type="button" onClick={()=>updInfos({ client_adresse:infos.chantier_adresse, client_adresse_complement:infos.chantier_adresse_complement, client_code_postal:infos.chantier_code_postal, client_ville:infos.chantier_ville, client_pays:infos.chantier_pays || "France" })}
                        style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5, padding:"5px 10px"}}><Icon as={Copy} size={11}/> Même adresse que le chantier</button>
                    )}
                  </div>
                  {champ("Adresse", "client_adresse", { span:true, placeholder:"12 rue des Lilas", adresse:{ prefixe:"client", champ:"rue" } })}
                  {champ("Complément", "client_adresse_complement", { placeholder:"Bâtiment B, 3e étage" })}
                  {champ("Code postal", "client_code_postal", { inputMode:"numeric", placeholder:"49000", adresse:{ prefixe:"client", type:"commune", champ:"cp" } })}
                  {champ("Ville", "client_ville", { placeholder:"Angers", adresse:{ prefixe:"client", type:"commune", champ:"ville" } })}
                  {champ("Pays", "client_pays", { placeholder:"France" })}
                </>))}

                {/* ── Carte : chantier & logement ── */}
                {carte("Chantier & logement", Home, <>
                  {grille(<>
                    <div style={{ gridColumn:"1 / -1", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
                      <span style={{ ...lbl, marginBottom:0 }}>Adresse du chantier</span>
                      {infos.adresse_bien && !infos.chantier_adresse && (
                        <button type="button" onClick={()=>updInfos({ chantier_adresse:(infos.adresse_bien || "").split("\n")[0].trim(), chantier_pays: infos.chantier_pays || "France" })}
                          title="Recopie la première ligne de l'adresse saisie à la visite ; code postal et ville restent à compléter."
                          style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5, padding:"5px 10px"}}><Icon as={Copy} size={11}/> Reprendre l'adresse de visite</button>
                      )}
                    </div>
                    {champ("Adresse", "chantier_adresse", { span:true, placeholder:"12 rue des Lilas", adresse:{ prefixe:"chantier", champ:"rue" } })}
                    {champ("Complément", "chantier_adresse_complement", { placeholder:"Escalier A, porte gauche" })}
                    {champ("Code postal", "chantier_code_postal", { inputMode:"numeric", placeholder:"49000", adresse:{ prefixe:"chantier", type:"commune", champ:"cp" } })}
                    {champ("Ville", "chantier_ville", { placeholder:"Angers", adresse:{ prefixe:"chantier", type:"commune", champ:"ville" } })}
                    {champ("Pays", "chantier_pays", { placeholder:"France" })}
                    <div style={{gridColumn:"1 / -1"}}>
                      <label style={lbl}>Adresse saisie à la visite (historique / repli)</label>
                      <AdresseInput multiline style={{...ta, minHeight:48}} value={infos.adresse_bien} onChange={v=>updInfo("adresse_bien",v)} placeholder="Rue, code postal, ville" />
                    </div>
                  </>)}
                  <div style={{ ...h2s, marginTop:16 }}>Logement de ce devis</div>
                  {grille(<>
                    {champ("Référence du logement", "logement_reference", { placeholder:"Appartement 101, Logement 3, Studio RDC…" })}
                    <div>
                      <label style={lbl}>Type de logement{logementInfo.repli && !infos.type_logement ? <span style={{ color:"#f5a623", marginLeft:6 }}>· repris de l'ancienne composition, à confirmer</span> : null}</label>
                      <select style={{...inp, cursor:"pointer"}} value={typeCourant} onChange={e=>updInfo("type_logement",e.target.value)}>
                        <option value="">— Choisir —</option>
                        {TYPES_LOGEMENT.map(t => <option key={t} value={t}>{t}</option>)}
                        {typeCourant && !TYPES_LOGEMENT.includes(typeCourant) && <option value={typeCourant}>{typeCourant}</option>}
                      </select>
                    </div>
                  </>)}
                  <div style={{ fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:8, lineHeight:1.5 }}>
                    Un projet = un logement = un devis. Pour un immeuble, crée un projet par logement (bouton <Icon as={Copy} size={10}/> Dupliquer dans l'en-tête).
                  </div>
                </>)}

                {/* ── Carte : devis ── */}
                {carte("Devis", Receipt, <>
                  {grille(<>
                    {champ("Objet du devis", "devis_objet", { span:true, placeholder:"Rénovation complète de l'appartement 101" })}
                    {champ("Date du devis / de préparation", "devis_date", { type:"date" })}
                    {champ("Date de validité", "devis_validite", { type:"date" })}
                    <div style={{ gridColumn:"1 / -1" }}>
                      <label style={lbl}>Taux de TVA par défaut du devis</label>
                      {selecteurTva(infos.tva_pct, updTvaProjet, { large:true })}
                      <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:6 }}>Répercuté sur les lignes qui suivent le projet ; une ligne peut porter sa propre TVA.</div>
                    </div>
                    {champ("N° de commande client (optionnel)", "devis_num_commande_client", { placeholder:"BC-2026-014" })}
                    <div style={{gridColumn:"1 / -1"}}>
                      <label style={lbl}>Observations / conditions particulières</label>
                      <textarea style={{...ta, minHeight:70}} value={infos.devis_conditions || ""} onChange={e=>updInfo("devis_conditions",e.target.value)} placeholder="Acompte, accès, délais, exclusions…" />
                    </div>
                  </>)}
                </>)}

                {/* ── Carte : visite ── */}
                {carte("Visite & projet", FileText, grille(<>
                  <div><label style={lbl}>Description du projet</label><textarea style={{...ta,minHeight:90}} value={infos.description_projet} onChange={e=>updInfo("description_projet",e.target.value)} placeholder="Ex : rénovation complète du T2 du 1er étage" /></div>
                  <div><label style={lbl}>Observations générales</label><textarea style={{...ta,minHeight:90}} value={infos.observations} onChange={e=>updInfo("observations",e.target.value)} placeholder="Notes, accès, contraintes…" /></div>
                  <div><label style={lbl}>Date de visite</label><input type="date" style={inp} value={infos.date_visite} onChange={e=>updInfo("date_visite",e.target.value)} /></div>
                </>))}

                {/* ── Carte : budget & délai ── */}
                <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, padding:18, marginBottom:14, boxShadow:SHADOW.sm }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:acc.accent, marginBottom:14, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Wallet} size={12}/>
                    Budget & délai
                  </div>
                  <div className="pic-form-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, alignItems:"start" }}>
                    <div>
                      <label style={lbl}>Budget client (€ HT)</label>
                      <div style={{position:"relative"}}>
                        <input type="number" step="100" min="0" inputMode="decimal" style={{...inp, paddingRight:30, fontWeight:700, color:"#22c55e"}} value={infos.budget_client ?? ""} onChange={e=>updInfo("budget_client",e.target.value)} placeholder="Ex : 45000" />
                        <span style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:FONT.xs.size,color:T.textMuted,pointerEvents:"none"}}>€</span>
                      </div>
                    </div>
                    <div>
                      <label style={lbl}>Délai souhaité</label>
                      <input style={inp} value={infos.delai_souhaite || ""} onChange={e=>updInfo("delai_souhaite",e.target.value)} placeholder="Ex : livraison avant juin 2027, 3 mois de travaux…" />
                    </div>
                  </div>
                  {budgetClient != null && !isNaN(budgetClient) && estimationTotale > 0 && (() => {
                    const ecart = estimationTotale - budgetClient;
                    const c = ecart > 0 ? "#e15a5a" : "#22c55e";
                    return (
                      <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"9px 12px", borderRadius:RADIUS.md, background:c+"12", border:`1px solid ${c}40`, fontSize:FONT.xs.size+1, color:T.textSub }}>
                        <Icon as={Euro} size={12} color={c}/>
                        <span>Vente HT du devis <strong style={{color:T.text}}>{fmtEur(estimationTotale)}</strong></span>
                        <span>·</span>
                        <span>Écart budget <strong style={{color:c}}>{ecart > 0 ? "+" : "−"}{fmtEur(Math.abs(ecart))}</strong></span>
                      </div>
                    );
                  })()}
                </div>
              </div>
              );
            })()}

            {tab==="notes" && (
              <div className="pic-section-narrow">
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:acc.accent, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={StickyNote} size={12}/>
                    {notesMode === "manuscrit" ? "Notes manuscrites" : "Notes libres"}
                  </div>
                  <div style={{ display:"inline-flex", gap:3, background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:3 }}>
                    {[{ id:"texte", label:"Clavier", icon:TypeIcon }, { id:"manuscrit", label:`Stylet${notesPages.length ? ` (${notesPages.length})` : ""}`, icon:PenTool }].map(m => {
                      const a = notesMode === m.id;
                      return (
                        <button key={m.id} onClick={()=>setNotesMode(m.id)} style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px", borderRadius:RADIUS.sm, border:"none", background:a?acc.accent:"transparent", color:a?acc.onAccent:T.textSub, fontFamily:"inherit", fontSize:FONT.xs.size+1, fontWeight:700, cursor:"pointer" }}>
                          <Icon as={m.icon} size={12}/>{m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {notesMode === "texte" ? (
                  <textarea
                    value={infos.notes || ""}
                    onChange={e=>updInfo("notes", e.target.value)}
                    placeholder="Prends des notes librement : contraintes, échanges client, idées de chiffrage, points à vérifier…"
                    style={{ ...ta, minHeight:"calc(100vh - 320px)", lineHeight:1.7, fontSize:FONT.base.size, padding:16, borderRadius:RADIUS.xl, boxShadow:SHADOW.sm }}
                  />
                ) : (
                  <>
                    <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                      {notesPages.map((d, i) => (
                        <button key={d.id} onClick={()=>setNotePageId(d.id)} style={tabS(pageActive?.id === d.id)}>{d.nom || `Page ${i+1}`}</button>
                      ))}
                      <button onClick={()=>creerDessin("note")} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                        <Icon as={Plus} size={11}/> Page
                      </button>
                    </div>
                    {pageActive ? (
                      <>
                        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                          <input value={pageActive.nom || ""} onChange={e=>updDessinChamp(pageActive.id, "nom", e.target.value)} placeholder="Nom de la page" style={{...inp, flex:"1 1 180px", maxWidth:320}}/>
                          <select value={pageActive.fond || "lignes"} onChange={e=>updDessinChamp(pageActive.id, "fond", e.target.value)} style={{...inp, width:"auto", cursor:"pointer"}}>
                            <option value="lignes">Lignes</option><option value="grille">Grille</option><option value="blanc">Blanc</option>
                          </select>
                          <button title="Supprimer cette page" onClick={()=>setToDeleteDessin(pageActive)} style={iconBtnDng}><Icon as={Trash2} size={12}/></button>
                        </div>
                        <StylusCanvas key={pageActive.id} strokes={pageActive.strokes || []} onChange={s=>updDessinStrokes(pageActive.id, s)}
                          largeur={pageActive.largeur || NOTE_W} hauteur={pageActive.hauteur || NOTE_H} fond={pageActive.fond || "lignes"} T={T} acc={acc}/>
                      </>
                    ) : (
                      <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"36px 24px", textAlign:"center", color:T.textSub }}>
                        <div style={{ width:48,height:48,borderRadius:RADIUS.lg, background:acc.bg10,color:acc.accent, display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}>
                          <Icon as={PenTool} size={24} strokeWidth={1.5}/>
                        </div>
                        <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucune page manuscrite</div>
                        <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6,marginBottom:14}}>Écris directement au stylet sur la tablette : la page se sauvegarde toute seule et se retrouve dans le PDF.</div>
                        <button onClick={()=>creerDessin("note")} style={{...btn, display:"inline-flex", alignItems:"center", gap:6}}>
                          <Icon as={Plus} size={12}/> Nouvelle page manuscrite
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {tab==="ouvrages" && (
              <>
                <datalist id="pic-zones">{ZONES_SUGGEREES.map(z => <option key={z} value={z}/>)}</datalist>

                {/* ── Retour de la bibliothèque après « Modifier matériaux » ── */}
                {majBiblio && (() => {
                  const ko  = majBiblio.supprime || majBiblio.erreur;
                  const att = majBiblio.fige || majBiblio.aucun;
                  const col = ko ? "#e15a5a" : att ? "#f5a623" : "#22c55e";
                  const texte = majBiblio.supprime
                    ? `L'ouvrage « ${majBiblio.libelle} » n'existe plus dans la bibliothèque : les ${majBiblio.nb} ligne${majBiblio.nb>1?"s":""} gardent leur prix figé.`
                    : majBiblio.erreur
                      ? `Actualisation impossible : ${majBiblio.erreur}`
                      : majBiblio.aucun
                        ? `« ${majBiblio.libelle} » : rien n'a changé, les ${majBiblio.nb} ligne${majBiblio.nb>1?"s":""} de ce devis sont déjà à jour.`
                        : majBiblio.fige
                          ? `« ${majBiblio.libelle} » a changé dans la bibliothèque, mais ce chiffrage est ${statutMeta(majBiblio.statut).label.toLowerCase()} : les prix restent figés. Utilise ↻ sur une ligne pour l'actualiser quand même.`
                          : `« ${majBiblio.libelle} » : ${majBiblio.nb} ligne${majBiblio.nb>1?"s":""} de ce devis actualisée${majBiblio.nb>1?"s":""} depuis la bibliothèque${majBiblio.diffs?.length ? " (" + majBiblio.diffs.map(d=>d.label.toLowerCase()).join(", ") + ")" : ""}.`;
                  return (
                    <div style={{ marginBottom:10, padding:"9px 12px", borderRadius:RADIUS.md, background:col+"1a", border:`1px solid ${col}66`, color:col, fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <Icon as={ko ? AlertTriangle : att ? Info : Check} size={13}/>
                      <span style={{ flex:1, minWidth:200 }}>{texte}</span>
                      <button onClick={()=>setMajBiblio(null)} title="Masquer" style={{ ...iconBtnSec, width:22, height:22, color:col, border:`1px solid ${col}66` }}><Icon as={X} size={11}/></button>
                    </div>
                  );
                })()}

                {/* ── Bandeaux bloquants ── */}
                {/* Les prix viennent des valeurs SAISIES sur chaque ouvrage : un
                    référentiel vide n'empêche plus de chiffrer, il prive seulement
                    les champs libres d'une valeur proposée par défaut. */}
                {((diagCoef && !diagCoef.ok) || (diagTaux && !diagTaux.ok)) && (
                  <div style={{ marginBottom:10, padding:"9px 12px", borderRadius:RADIUS.md, background:"rgba(245,166,35,0.12)", border:"1px solid rgba(245,166,35,0.4)", color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <Icon as={Info} size={13}/>
                    Aucune valeur par défaut dans les Réglages → Taux horaires{diagCoef && !diagCoef.ok && diagTaux && !diagTaux.ok ? "" : diagCoef && !diagCoef.ok ? " (coefficients de vente)" : " (taux horaires)"} : les coefficients et taux horaires restent à saisir sur chaque fiche d'ouvrage.
                  </div>
                )}
                {coutHoraireManquant && (
                  <div style={{ marginBottom:10, padding:"9px 12px", borderRadius:RADIUS.md, background:"rgba(245,166,35,0.12)", border:"1px solid rgba(245,166,35,0.4)", color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <Icon as={AlertTriangle} size={13}/>
                    Coût horaire chargé non configuré (Réglages → Taux → taux horaire moyen) : les prix sont calculés, mais la marge des lignes ajoutées ne le sera pas.
                  </div>
                )}
                {tvaManquante && ouvrages.length > 0 && (
                  <div style={{ marginBottom:10, padding:"9px 12px", borderRadius:RADIUS.md, background:"rgba(245,166,35,0.12)", border:"1px solid rgba(245,166,35,0.4)", color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <Icon as={AlertTriangle} size={13}/>
                    <span>Taux de TVA du devis non choisi : pas de total TTC.</span>
                    {selecteurTva(infos.tva_pct, updTvaProjet)}
                  </div>
                )}

                {/* ══ CONDITIONS DE VENTE DU CHIFFRAGE (coefficient / taux global figés, RPC atomique) ══ */}
                {projetActif && (
                  <ConditionsVenteChiffrage T={T} acc={acc} projet={projetActif} projetId={projetId} coefficients={biblio?.coefficients || []} tauxHoraires={biblio?.tauxHoraires || []} nbLignes={ouvrages.length} onApplique={rechargerApresConditions}/>
                )}

                {/* ══ DEVIS : LOT → ZONE → OUVRAGES ══ */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:acc.accent, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Receipt} size={11}/>
                    Devis — ouvrages retenus
                    <span style={{color:T.textMuted}}>· {ouvrages.length} ligne{ouvrages.length>1?"s":""}{logementInfo.reference ? ` · ${logementInfo.reference}` : ""}</span>
                  </div>
                  {ouvrages.length > 0 && (
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                      <button onClick={()=>setShowModal(true)} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                        <Icon as={FileText} size={11}/> Aperçu du devis
                      </button>
                      <button onClick={()=>setShowProgbat(true)} title="Aperçu du devis ProGBat reconstruit par le serveur, puis création d'un brouillon après confirmation." style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                        <Icon as={Send} size={11}/> {projets.find(p=>p.id===projetId)?.progbat_devis_id ? "Devis ProGBat (brouillon créé)" : "Aperçu ProGBat"}
                      </button>
                      <button onClick={async()=>{ if(!window.confirm("Retirer TOUTES les lignes de ce devis ?")) return; await supabase.from("profero_ouvrages_selectionnes").delete().eq("projet_id",projetId); setOuvrages([]); }}
                        style={{...btnDng, display:"inline-flex", alignItems:"center", gap:5, padding:"8px 14px"}}>
                        <Icon as={X} size={11}/> Tout retirer
                      </button>
                    </div>
                  )}
                </div>

                {ouvrages.length === 0 ? (
                  <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"22px 20px", textAlign:"center", color:T.textSub, marginBottom:14 }}>
                    <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:3}}>Aucun ouvrage dans ce devis</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>Choisis la zone puis clique sur « Ajouter » dans la bibliothèque ci-dessous. Le même ouvrage peut être ajouté plusieurs fois (une ligne par zone).</div>
                  </div>
                ) : groupesDevis.map(g => (
                  <div key={g.lot} style={{ marginBottom:14 }}>
                    <div style={{ ...h2s, marginTop:6, display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ width:9, height:9, borderRadius:"50%", background:couleurLot(g.lot), flexShrink:0 }}/>
                      <span style={{flex:1}}>{g.lot}</span>
                      <span style={{ fontSize:FONT.xs.size+1, fontWeight:800, color:g.total > 0 ? "#22c55e" : T.textMuted, textTransform:"none", letterSpacing:0 }}>{fmtEur2(g.total)}</span>
                    </div>
                    {g.zones.map(z => (
                      <div key={z.zone} style={{ marginLeft:12, marginBottom:8, paddingLeft:10, borderLeft:`2px solid ${couleurLot(g.lot)}55` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                          <Icon as={Home} size={11} color={T.textSub}/>
                          <span style={{ fontSize:FONT.xs.size+1, fontWeight:800, color:T.textSub, textTransform:"uppercase", letterSpacing:.6, flex:1 }}>{z.zone} <span style={{ color:T.textMuted, fontWeight:600 }}>({z.lignes.length})</span></span>
                          {g.zones.length > 1 && <span style={{ fontSize:FONT.xs.size, fontWeight:700, color:T.textMuted }}>{fmtEur2(z.total)}</span>}
                        </div>
                        {z.lignes.map(sel => {
                          const c = decoderLibelleCode(sel.code_ouvrage ? `${sel.code_ouvrage} : ${sel.item}` : sel.item) || (sel.code_ouvrage ? { code: sel.code_ouvrage, reste: sel.item } : null);
                          const snap = ligneEstSnapshot(sel);
                          const libelleCourt = c ? (decoderLibelleCode(sel.item)?.reste || sel.item) : sel.item;
                          return (
                            <div key={sel.id} style={{ padding:"9px 12px", background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, marginBottom:6 }}>
                              <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                                {c && <span style={{ fontFamily:"ui-monospace, Menlo, Consolas, monospace", fontSize:FONT.xs.size, fontWeight:800, color:couleurLot(g.lot), background:couleurLot(g.lot)+"1f", border:`1px solid ${couleurLot(g.lot)}55`, padding:"1px 7px", borderRadius:RADIUS.sm, flexShrink:0, marginTop:1, whiteSpace:"nowrap" }}>{c.code}</span>}
                                <div style={{ flex:1, minWidth:0, fontSize:FONT.sm.size, color:T.text, fontWeight:600, lineHeight:1.45 }}>{libelleCourt}</div>
                                {!snap && <span title="Ligne ancienne ou hors bibliothèque : prix saisi à la main, pas de coût figé" style={{ fontSize:FONT.xs.size-1, fontWeight:700, color:T.textMuted, border:`1px solid ${T.border}`, borderRadius:RADIUS.pill, padding:"1px 7px", whiteSpace:"nowrap" }}>prix saisi</span>}
                              </div>
                              {ligneEdition(sel)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}

                {/* ── Totaux & préparation du devis ── */}
                {(() => {
                  const t = totauxProjet;
                  const carteKpi = (label, valeur, { color = T.text, sub = null, flex = 1 } = {}) => (
                    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:"10px 14px", flex, minWidth:150 }}>
                      <div style={{ fontSize:FONT.xs.size, color:T.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:.6 }}>{label}</div>
                      <div style={{ fontSize:FONT.lg.size, fontWeight:800, color, lineHeight:1.15, marginTop:3, letterSpacing:-.3 }}>{valeur}</div>
                      {sub && <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:2 }}>{sub}</div>}
                    </div>
                  );
                  return (
                    <div style={{ marginTop:8, marginBottom:20 }}>
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                        {carteKpi("Total vente HT", fmtEur2(t.venteHT), { color: t.venteHT > 0 ? "#22c55e" : T.textMuted, sub: t.nbLignesSansPrix > 0 ? `${t.nbLignesSansPrix} ligne${t.nbLignesSansPrix>1?"s":""} sans prix` : `${t.nbLignes} ligne${t.nbLignes>1?"s":""}`, flex:"2 1 200px" })}
                        {carteKpi("Coût total", t.coutsIncomplets && t.nbLignesAvecCout === 0 ? "—" : fmtEur2(t.coutTotal), { sub: `matériaux ${fmtEur2(t.coutMateriaux)} · MO ${fmtEur2(t.coutMainOeuvre)}${t.coutDirect > 0 ? ` · direct ${fmtEur2(t.coutDirect)}` : ""}${t.coutsIncomplets ? " · partiel" : ""}` })}
                        {carteKpi("Marge", t.marge == null ? "—" : fmtEur2(t.marge), { color: t.marge == null ? T.textMuted : t.marge >= 0 ? "#22c55e" : "#e15a5a", sub: t.tauxMargeReel == null ? (t.coutsIncomplets ? "non fiable : lignes sans coût figé" : "—") : `taux réel global ${fmtPct(t.tauxMargeReel)} (pondéré)` })}
                        {carteKpi("TVA", t.tva == null ? "à choisir" : fmtEur2(t.tva), { color: t.tva == null ? "#f5a623" : T.text, sub: Object.entries(t.tvaDetail || {}).map(([k, v]) => `${k} % → ${fmtEur2(v)}`).join(" · ") || null })}
                        {carteKpi("Total TTC", t.ttc == null ? "—" : fmtEur2(t.ttc), { color: t.ttc == null ? T.textMuted : T.text })}
                        {budgetClient != null && !isNaN(budgetClient) && carteKpi("Budget client", fmtEur2(budgetClient), { sub: t.ecartBudget == null ? "écart : —" : `écart ${t.ecartBudget > 0 ? "+" : "−"}${fmtEur2(Math.abs(t.ecartBudget))}`, color: t.ecartBudget == null ? T.text : t.ecartBudget > 0 ? "#e15a5a" : "#22c55e" })}
                      </div>
                      {/* Préparation du devis (futur brouillon ProGBat) */}
                      <div style={{ marginTop:10, padding:"10px 14px", borderRadius:RADIUS.lg, background:preparation.pret ? "rgba(34,197,94,0.08)" : T.surface, border:`1px solid ${preparation.pret ? "rgba(34,197,94,0.35)" : T.border}` }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:FONT.sm.size, fontWeight:800, color:preparation.pret ? "#22c55e" : T.text }}>
                          <Icon as={preparation.pret ? Check : Info} size={14}/>
                          {preparation.pret ? "Devis complet : prêt à être préparé" : `Devis à compléter (${preparation.bloquants.length} point${preparation.bloquants.length>1?"s":""} bloquant${preparation.bloquants.length>1?"s":""})`}
                        </div>
                        {preparation.bloquants.length > 0 && (
                          <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
                            {preparation.bloquants.map((b, i) => <div key={i} style={{ fontSize:FONT.xs.size+1, color:"#e15a5a", display:"flex", gap:6, alignItems:"flex-start" }}><Icon as={X} size={11} style={{marginTop:2,flexShrink:0}}/>{b}</div>)}
                          </div>
                        )}
                        {preparation.avertissements.length > 0 && (
                          <div style={{ display:"flex", flexDirection:"column", gap:3, marginTop:6 }}>
                            {preparation.avertissements.map((a, i) => <div key={i} style={{ fontSize:FONT.xs.size+1, color:"#f5a623", display:"flex", gap:6, alignItems:"flex-start" }}><Icon as={AlertTriangle} size={11} style={{marginTop:2,flexShrink:0}}/>{a}</div>)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* ══ BIBLIOTHÈQUE : catalogue avec bouton Ajouter ══ */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:12, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={manageMode ? Settings : Library} size={11}/>
                    {manageMode ? "Gérer les anciens lots & ouvrages" : "Ajouter depuis la bibliothèque"}
                    {!manageMode && biblio && <span style={{color:acc.accent}}>· {nbBiblio}</span>}
                  </div>
                  {!manageMode && (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:T.surface, border:`1px solid ${acc.accent}55`, borderRadius:RADIUS.md, padding:"5px 10px" }}>
                      <Icon as={Home} size={12} color={acc.accent}/>
                      <span style={{ fontSize:FONT.xs.size+1, fontWeight:700, color:T.textSub }}>Ajouter dans la zone</span>
                      <input list="pic-zones" value={zoneAjout} onChange={e=>setZoneAjout(e.target.value)} placeholder={ZONE_DEFAUT}
                        style={{...inp, width:170, padding:"5px 8px", fontSize:FONT.xs.size+1, fontWeight:700, color:acc.accent}}/>
                    </div>
                  )}
                  <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                    <button onClick={()=>{ setShowAnciens(v=>!v); if (showAnciens) { setManageMode(false); setEditLib(null); setEditLot(null); setAddLibCat(null); } }}
                      style={{ ...btnSec, display:"inline-flex", alignItems:"center", gap:5, ...(showAnciens ? { borderColor:acc.accent, color:acc.accent } : {}) }}>
                      <Icon as={Layers} size={11}/>
                      {showAnciens ? "Masquer les anciens ouvrages" : `Anciens ouvrages (${nbAnciens})`}
                      {!showAnciens && nbAnciensSel > 0 && <span style={{ background:acc.accent, color:acc.onAccent, borderRadius:RADIUS.pill, padding:"0 6px", fontSize:FONT.xs.size-1 }}>{nbAnciensSel} coché{nbAnciensSel>1?"s":""}</span>}
                    </button>
                    {showAnciens && (
                      <button onClick={()=>{ setManageMode(m=>!m); setEditLib(null); setEditLot(null); setAddLibCat(null); }}
                        style={{ ...(manageMode?btn:btnSec), display:"inline-flex", alignItems:"center", gap:5 }}>
                        <Icon as={manageMode?Check:Settings} size={11}/>
                        {manageMode ? "Terminer" : "Gérer"}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{position:"relative",marginBottom:10}}>
                  <Icon as={Search} size={13} color={T.textMuted} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
                  <input style={{...inp,padding:"9px 12px 9px 30px"}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un ouvrage (code ou libellé)…" />
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:14 }}>
                  {[...groupesBiblio.map(g => g.label), ...(showAnciens ? Object.keys(categories).filter(c => !groupesBiblio.some(g => g.label === c)) : [])].map(cat => {
                    const a=filtresCat.includes(cat);
                    return <div key={cat} onClick={()=>setFiltresCat(p=>p.includes(cat)?p.filter(c=>c!==cat):[...p,cat])} style={{ padding:"3px 10px", borderRadius:RADIUS.pill, border:`1px solid ${a?acc.accent:T.border}`, background:a?acc.bg10:"transparent", color:a?acc.accent:T.textSub, fontSize:FONT.xs.size, fontWeight:700, cursor:"pointer", textTransform:"uppercase", letterSpacing:.4 }}>{cat}</div>;
                  })}
                </div>

                {/* ── Ouvrages codés de la bibliothèque, par lot ── */}
                {!manageMode && (
                  !biblio ? (
                    <div style={{color:T.textMuted,fontSize:FONT.sm.size,textAlign:"center",padding:20}}>Chargement de la bibliothèque…</div>
                  ) : nbBiblio === 0 ? (
                    <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"28px 22px", textAlign:"center", color:T.textSub, marginBottom:14 }}>
                      <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun ouvrage codé dans la bibliothèque</div>
                      <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>Seuls les ouvrages dont le libellé commence par un code (ex : « D-001 : Dépose… ») sont proposés ici. Complète les codes dans la page Bibliothèque.</div>
                    </div>
                  ) : groupesBiblio.map(g => {
                    const q = search.trim().toLowerCase();
                    const vis = g.items.filter(o => (filtresCat.length===0 || filtresCat.includes(g.label)) && (!q || o._code.code.toLowerCase().includes(q) || (o.libelle||"").toLowerCase().includes(q)));
                    if (vis.length === 0) return null;
                    return (
                      <div key={g.label}>
                        <div style={{ ...h2s, display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ width:9, height:9, borderRadius:"50%", background:g.couleur, flexShrink:0 }}/>
                          <span style={{flex:1}}>{g.label} ({g.items.length})</span>
                          <span style={{ fontSize:FONT.xs.size-1, fontWeight:800, letterSpacing:.5, color:T.textSub, background:T.card, border:`1px solid ${T.border}`, padding:"1px 7px", borderRadius:RADIUS.sm }}>{g.prefixe}</span>
                        </div>
                        {vis.map(o => {
                          const occ = occurrencesDe(o), busy = biblioBusy === o.id;
                          const calc = calculBiblio(o);
                          return (
                            <div key={o.id} style={{ padding:"9px 12px", background:occ.length?acc.bg10:T.card, border:`1px solid ${occ.length?acc.accent+"88":T.border}`, borderRadius:RADIUS.md, marginBottom:6, display:"flex", alignItems:"flex-start", gap:10, transition:"all .12s", opacity:busy?.6:1 }}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                                  <span style={{ fontFamily:"ui-monospace, Menlo, Consolas, monospace", fontSize:FONT.xs.size, fontWeight:800, color:g.couleur, background:g.couleur+"1f", border:`1px solid ${g.couleur}55`, padding:"1px 7px", borderRadius:RADIUS.sm, flexShrink:0, marginTop:1, whiteSpace:"nowrap" }}>{o._code.code}</span>
                                  <div style={{ fontSize:FONT.sm.size, color:T.text, fontWeight:500, lineHeight:1.45, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{o._code.reste}</div>
                                </div>
                                <div style={{ fontSize:FONT.xs.size, color:T.textMuted, marginTop:3, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                                  <span>{normaliserUnite(o.unite)}{o.cadence ? ` · ${o.cadence} h / ${normaliserUnite(o.unite)}` : " · sans cadence"}</span>
                                  {calc.complet ? (
                                    <span style={{ color:"#22c55e", fontWeight:800 }} title={`Matériaux ${expliquerPrixMateriaux(calc.coutMateriauxUnitaire, calc.coefVente) || fmtEur2(calc.prixMateriauxUnitaire)} (${calc.coefficient.libelle || "coefficient"}) + main-d'œuvre ${expliquerPrixMainOeuvre(calc.mainOeuvre.heures, calc.mainOeuvre.tauxVente) || "—"} (${calc.tauxHoraire.libelle || "taux"})${calc.tauxMargePct != null ? ` · marge ${calc.tauxMargePct} % du prix de vente` : " · marge non calculable"}`}>
                                      {fmtEur2(calc.prixVenteUnitaire)} HT / {calc.unite} · MO {calc.mainOeuvre.tauxVente} €/h
                                    </span>
                                  ) : (
                                    <span style={{ color:"#e15a5a", fontWeight:700, display:"inline-flex", alignItems:"center", gap:4 }} title={calc.erreurs.join(" · ")}>
                                      <Icon as={AlertTriangle} size={10}/> prix incalculable ({calc.erreurs.length})
                                    </span>
                                  )}
                                  {occ.length > 0 && <span style={{ color:acc.accent, fontWeight:800 }}>· {occ.length} dans le devis ({occ.map(x => x.zone || ZONE_DEFAUT).join(", ")})</span>}
                                </div>
                              </div>
                              <button disabled={busy} onClick={()=>ajouterDepuisBiblio(o, g.label)}
                                title={calc.complet ? `Ajouter dans « ${(zoneAjout||"").trim() || ZONE_DEFAUT} » au prix figé de ${fmtEur2(calc.prixVenteUnitaire)} HT / ${calc.unite}` : `Ajouter sans prix (à compléter dans la Bibliothèque : ${calc.erreurs.join(" · ")})`}
                                style={{ ...(calc.complet ? btn : btnSec), display:"inline-flex", alignItems:"center", gap:5, padding:"7px 12px", flexShrink:0, cursor:busy?"wait":"pointer" }}>
                                <Icon as={Plus} size={12}/> Ajouter
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })
                )}

                {/* ── Anciens ouvrages du chiffrage (masqués par défaut) ── */}
                {showAnciens && (
                  <>
                    {!manageMode && (
                      <div style={{ ...h2s, marginTop:24, color:T.textMuted, display:"flex", alignItems:"center", gap:8 }}>
                        <Icon as={Layers} size={11}/> Anciens ouvrages du chiffrage ({nbAnciens})
                      </div>
                    )}
                    {manageMode && (
                      <div style={{ display:"flex", gap:6, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
                        <input style={{...inp, flex:"1 1 200px"}} value={newLotName} onChange={e=>setNewLotName(e.target.value)}
                          placeholder="Nouveau lot (ex : Carrelage, Isolation…)" onKeyDown={e=>e.key==="Enter"&&createLot(newLotName)} />
                        <button onClick={()=>createLot(newLotName)} style={{...btn, display:"inline-flex", alignItems:"center", gap:5}}>
                          <Icon as={Plus} size={12}/> Créer un lot
                        </button>
                      </div>
                    )}

                    {Object.entries(categories).map(([cat,items],catIndex,arr) => {
                      const vis=items.filter(item=>(!search||item.toLowerCase().includes(search.toLowerCase()))&&(filtresCat.length===0||filtresCat.includes(cat)));
                      if(vis.length===0 && !manageMode) return null;
                      return (
                        <div key={cat}>
                          {manageMode ? (
                            <div style={{ ...h2s, display:"flex", alignItems:"center", gap:8 }}>
                              {editLot && editLot.nom===cat ? (
                                <input autoFocus style={{...inp, flex:1, padding:"5px 8px", fontSize:FONT.xs.size+1, textTransform:"none", letterSpacing:0}}
                                  value={editLot.value} onChange={e=>setEditLot({nom:cat, value:e.target.value})}
                                  onKeyDown={e=>{ if(e.key==="Enter") renameLot(cat, editLot.value); if(e.key==="Escape") setEditLot(null); }}
                                  onBlur={()=>renameLot(cat, editLot.value)} />
                              ) : (
                                <span style={{flex:1}}>{cat} ({items.length})</span>
                              )}
                              <button title="Monter" disabled={catIndex===0||reordering} onClick={()=>reorderLot(cat,-1)} style={{...iconBtnSec, opacity:(catIndex===0||reordering)?.4:1}}><Icon as={ArrowUp} size={12}/></button>
                              <button title="Descendre" disabled={catIndex===arr.length-1||reordering} onClick={()=>reorderLot(cat,1)} style={{...iconBtnSec, opacity:(catIndex===arr.length-1||reordering)?.4:1}}><Icon as={ArrowDown} size={12}/></button>
                              <button title="Renommer le lot" onClick={()=>setEditLot({nom:cat, value:cat})} style={iconBtnSec}><Icon as={Edit2} size={12}/></button>
                              <button title="Supprimer le lot" onClick={()=>setToDeleteLot(cat)} style={iconBtnDng}><Icon as={Trash2} size={12}/></button>
                            </div>
                          ) : (
                            <div style={h2s}>{cat} ({items.length})</div>
                          )}
                          {vis.map((item) => {
                            const idx=items.indexOf(item);
                            const sel=ouvrages.find(o=>o.category===cat&&o.item===item), chk=!!sel;
                            const isEditing=editLib&&editLib.cat===cat&&editLib.idx===idx;
                            return (
                              <div key={idx} style={{ padding:"9px 12px", background:chk&&!manageMode?acc.bg10:T.card, border:`1px solid ${chk&&!manageMode?acc.accent:T.border}`, borderRadius:RADIUS.md, marginBottom:6, display:"flex", alignItems:"flex-start", gap:10, transition:"all .12s" }}>
                                {!manageMode && <input type="checkbox" checked={chk} onChange={()=>togOuvrage(cat,item)} style={{ accentColor:acc.accent, width:15, height:15, marginTop:2, flexShrink:0, cursor:"pointer" }} />}
                                <div style={{flex:1,minWidth:0}}>
                                  {isEditing ? (
                                    <input autoFocus style={{...inp, padding:"5px 8px", fontSize:FONT.sm.size}}
                                      value={editLib.value} onChange={e=>setEditLib({cat,idx,value:e.target.value})}
                                      onKeyDown={e=>{ if(e.key==="Enter") renameOuvrageLib(cat,idx,editLib.value); if(e.key==="Escape") setEditLib(null); }}
                                      onBlur={()=>renameOuvrageLib(cat,idx,editLib.value)} />
                                  ) : (
                                    <div style={{ fontSize:FONT.sm.size, color:chk&&!manageMode?acc.accent:T.text, fontWeight:chk&&!manageMode?700:500 }}>{item}</div>
                                  )}
                                  <div style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{cat}{chk && sel?.bibliotheque_id ? " · repris de la bibliothèque" : ""}</div>
                                  {chk && !manageMode && ligneEdition(sel)}
                                </div>
                                {manageMode && !isEditing && (
                                  <div style={{display:"flex", gap:4, flexShrink:0}}>
                                    <button title="Renommer l'ouvrage" onClick={()=>setEditLib({cat,idx,value:item})} style={iconBtnSec}><Icon as={Edit2} size={12}/></button>
                                    <button title="Supprimer l'ouvrage" onClick={()=>setToDeleteOuvrage({cat,idx,label:item})} style={iconBtnDng}><Icon as={Trash2} size={12}/></button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {manageMode && (
                            addLibCat===cat ? (
                              <div style={{display:"flex", gap:6, marginBottom:10, alignItems:"center"}}>
                                <input autoFocus style={{...inp, flex:1, padding:"7px 10px", fontSize:FONT.sm.size}}
                                  value={addLibVal} onChange={e=>setAddLibVal(e.target.value)}
                                  placeholder={`Nouvel ouvrage dans « ${cat} »`}
                                  onKeyDown={e=>{ if(e.key==="Enter") addOuvrageToCat(cat, addLibVal); if(e.key==="Escape"){setAddLibCat(null);setAddLibVal("");} }} />
                                <button onClick={()=>addOuvrageToCat(cat, addLibVal)} style={{...btn, padding:"7px 12px"}}><Icon as={Check} size={12}/></button>
                                <button onClick={()=>{setAddLibCat(null);setAddLibVal("");}} style={{...btnSec, padding:"7px 12px"}}><Icon as={X} size={12}/></button>
                              </div>
                            ) : (
                              <button onClick={()=>{setAddLibCat(cat);setAddLibVal("");}} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5, marginBottom:10}}>
                                <Icon as={Plus} size={11}/> Ajouter un ouvrage
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}

                  </>
                )}

              </>
            )}

            {tab==="plan" && (
              editingPlan ? (
                <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 240px)", minHeight:480, margin:"-18px -22px" }}>
                  <PlanEditorErrorBoundary onClose={()=>setEditingPlan(null)}>
                    <PlanEditor plan={editingPlan} onSave={onSavePlan} onClose={()=>setEditingPlan(null)} T={T} chantiers={chantiers}/>
                  </PlanEditorErrorBoundary>
                </div>
              ) : (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Ruler} size={11}/>
                    Plans & côtes
                  </div>
                  <button onClick={nouveauPlan} style={{...btn, display:"inline-flex", alignItems:"center", gap:5}}>
                    <Icon as={Plus} size={12}/> Nouveau plan
                  </button>
                </div>
                <p style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:12,lineHeight:1.6}}>
                  Importe un .dxf et dessine au stylet (palette de couleurs, symboles, cotation). Un plan peut ensuite être envoyé vers la page Plans en le liant à un chantier.
                </p>

                {richPlans.length===0 ? (
                  <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"32px 24px", textAlign:"center", color:T.textSub }}>
                    <div style={{ width:48,height:48,borderRadius:RADIUS.lg, background:acc.bg10,color:acc.accent, display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}>
                      <Icon as={Ruler} size={24} strokeWidth={1.5}/>
                    </div>
                    <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun plan</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>Crée un plan pour importer un .dxf ou dessiner à main levée.</div>
                  </div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
                    {richPlans.map(p => {
                      const ch = chantiers.find(c=>c.id===p.chantier_id);
                      return (
                        <div key={p.id} className="pic-card" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:SHADOW.sm }}>
                          <div style={{ position:"relative", aspectRatio:"4/3", background:T.card, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}
                            onClick={()=>ouvrirPlan(p.id)}>
                            {p.thumbnail ? (
                              <img src={p.thumbnail} alt={p.name||""} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }}/>
                            ) : (
                              <Icon as={ImageIcon} size={28} color={T.textMuted}/>
                            )}
                          </div>
                          <div style={{ padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
                            <div style={{ fontSize:FONT.sm.size, fontWeight:700, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.name||"Plan"}</div>
                            {ch && (
                              <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:FONT.xs.size, color:"#22c55e", fontWeight:600 }}>
                                <Icon as={Building2} size={10}/> {ch.nom}
                              </div>
                            )}
                            <div style={{ display:"flex", gap:6 }}>
                              <button onClick={()=>ouvrirPlan(p.id)} style={{...btnSec, flex:1, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:4, padding:"6px 8px"}}>
                                <Icon as={Pencil} size={11}/> Ouvrir
                              </button>
                              <button title="Envoyer vers Plans / lier à un chantier" onClick={()=>{ setLinkingPlan(p); setLinkChantier(p.chantier_id||""); }} style={iconBtnSec}>
                                <Icon as={Send} size={12}/>
                              </button>
                              <button title="Supprimer le plan" onClick={()=>setToDeletePlan(p)} style={iconBtnDng}>
                                <Icon as={Trash2} size={12}/>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Croquis à main levée (stylet) ── */}
                <div style={{...h2s, marginTop:20, display:"flex", alignItems:"center", gap:8}}>
                  <span style={{flex:1}}>Croquis à main levée {croquisList.length > 0 && `(${croquisList.length})`}</span>
                  {!croquisActif && (
                    <button onClick={()=>creerDessin("croquis")} style={{...btn, display:"inline-flex", alignItems:"center", gap:5, padding:"6px 12px", textTransform:"none", letterSpacing:0}}>
                      <Icon as={Plus} size={11}/> Nouveau croquis
                    </button>
                  )}
                </div>
                {croquisActif ? (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
                      <button onClick={()=>setCroquisOuvert(null)} style={{...btnSec, display:"inline-flex", alignItems:"center", gap:5}}>
                        <Icon as={ChevronLeftIcon} size={12}/> Retour
                      </button>
                      <input value={croquisActif.nom || ""} onChange={e=>updDessinChamp(croquisActif.id, "nom", e.target.value)} placeholder="Nom du croquis (ex : Implantation cuisine)" style={{...inp, flex:"1 1 200px", maxWidth:360}}/>
                      <select value={croquisActif.fond || "grille"} onChange={e=>updDessinChamp(croquisActif.id, "fond", e.target.value)} style={{...inp, width:"auto", cursor:"pointer"}}>
                        <option value="grille">Grille</option><option value="lignes">Lignes</option><option value="blanc">Blanc</option>
                      </select>
                      <button title="Supprimer ce croquis" onClick={()=>setToDeleteDessin(croquisActif)} style={iconBtnDng}><Icon as={Trash2} size={12}/></button>
                    </div>
                    <StylusCanvas key={croquisActif.id} strokes={croquisActif.strokes || []} onChange={s=>updDessinStrokes(croquisActif.id, s)}
                      largeur={croquisActif.largeur || CROQUIS_W} hauteur={croquisActif.hauteur || CROQUIS_H} fond={croquisActif.fond || "grille"} T={T} acc={acc}/>
                  </div>
                ) : croquisList.length === 0 ? (
                  <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"22px 20px", textAlign:"center", color:T.textSub, marginBottom:8 }}>
                    <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text,marginBottom:3}}>Aucun croquis</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>Dessine librement au stylet : implantation, détail, cotes rapides. Les croquis rejoignent le PDF du dossier.</div>
                  </div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12, marginBottom:8 }}>
                    {croquisList.map(d => (
                      <div key={d.id} className="pic-card" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden", display:"flex", flexDirection:"column", boxShadow:SHADOW.sm }}>
                        <div style={{ position:"relative", aspectRatio:"7/5", background:"#fff", cursor:"pointer" }} onClick={()=>setCroquisOuvert(d.id)}>
                          <img src={vignetteDessin(d)} alt={d.nom||""} style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"contain" }}/>
                        </div>
                        <div style={{ padding:"8px 10px", display:"flex", flexDirection:"column", gap:6 }}>
                          <div style={{ fontSize:FONT.sm.size, fontWeight:700, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.nom||"Croquis"}</div>
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={()=>setCroquisOuvert(d.id)} style={{...btnSec, flex:1, display:"inline-flex", alignItems:"center", justifyContent:"center", gap:4, padding:"6px 8px"}}>
                              <Icon as={Pencil} size={11}/> Ouvrir
                            </button>
                            <button title="Supprimer le croquis" onClick={()=>setToDeleteDessin(d)} style={iconBtnDng}>
                              <Icon as={Trash2} size={12}/>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{...h2s, marginTop:20}}>Côtes menuiseries / huisseries</div>
                <button onClick={ajoutCote} style={{
                  display:"inline-flex",alignItems:"center",gap:5,marginBottom:10,
                  background:acc.accent,color:acc.onAccent,border:"none",
                  borderRadius:RADIUS.md,padding:"7px 14px",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
                }}>
                  <Icon as={Plus} size={11}/>
                  Ajouter une côte
                </button>
                {cotes.length===0 && <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",padding:14,fontStyle:"italic"}}>Aucune côte enregistrée</div>}
                {cotes.map(c => (
                  <div key={c.id} className="cote-card" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:12, marginBottom:8 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:6 }}>
                      <input style={{...inp,fontSize:FONT.xs.size+1}} value={c.nom||""} onChange={e=>updCote(c.id,"nom",e.target.value)} placeholder="Fenêtre salon" />
                      <input style={{...inp,fontSize:FONT.xs.size+1}} value={c.localisation||""} onChange={e=>updCote(c.id,"localisation",e.target.value)} placeholder="Localisation" />
                      <input type="number" style={{...inp,fontSize:FONT.xs.size+1}} value={c.largeur||""} onChange={e=>updCote(c.id,"largeur",e.target.value)} placeholder="Largeur (cm)" />
                      <input type="number" style={{...inp,fontSize:FONT.xs.size+1}} value={c.hauteur||""} onChange={e=>updCote(c.id,"hauteur",e.target.value)} placeholder="Hauteur (cm)" />
                    </div>
                    <button onClick={()=>delCote(c.id)} style={{...btnDng, display:"inline-flex", alignItems:"center", gap:4}}>
                      <Icon as={Trash2} size={10}/>
                      Supprimer
                    </button>
                  </div>
                ))}
              </>
              )
            )}

            {tab==="photos" && (
              <>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, gap:10, flexWrap:"wrap" }}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Camera} size={11}/>
                    Photos & vidéos du projet
                    {photos.length > 0 && <span style={{color:acc.accent}}>· {photos.length}</span>}
                  </div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <label style={{ display:"inline-flex", alignItems:"center", gap:6, background:acc.accent, color:acc.onAccent, border:"none", borderRadius:RADIUS.md, padding:"9px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800 }}>
                      <Icon as={Camera} size={13}/>
                      Photo
                      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={e=>onPhotoFiles(e.target.files)} style={{display:"none"}}/>
                    </label>
                    <label style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#5b9cf6", color:"#fff", border:"none", borderRadius:RADIUS.md, padding:"9px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800 }}>
                      <Icon as={Video} size={13}/>
                      Filmer
                      <input type="file" accept="video/*" capture="environment" onChange={e=>onPhotoFiles(e.target.files)} style={{display:"none"}}/>
                    </label>
                    <label style={{ display:"inline-flex", alignItems:"center", gap:6, background:"transparent", color:T.text, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, padding:"9px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:700 }}>
                      <Icon as={ImagePlus} size={13}/>
                      Importer
                      <input type="file" accept="image/*,video/*" multiple onChange={e=>onPhotoFiles(e.target.files)} style={{display:"none"}}/>
                    </label>
                  </div>
                </div>
                {uploadingCount > 0 && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, color:"#f5a623", fontSize:FONT.xs.size+1, fontWeight:600, marginBottom:10 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}>
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                    </svg>
                    Upload en cours… {uploadingCount} restant{uploadingCount > 1 ? "s" : ""} (les vidéos peuvent prendre un moment)
                  </div>
                )}
                {photos.length === 0 ? (
                  <div style={{ background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl, padding:"40px 24px", textAlign:"center", color:T.textSub }}>
                    <div style={{ width:48,height:48,borderRadius:RADIUS.lg, background:acc.bg10,color:acc.accent, display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12 }}>
                      <Icon as={Camera} size={24} strokeWidth={1.5}/>
                    </div>
                    <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun média</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>
                      Prends des photos ou filme sur place (état de l'existant, points d'attention) — l'appareil s'ouvre directement sur mobile. Max 50 Mo par vidéo.
                    </div>
                  </div>
                ) : (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:12 }}>
                    {photos.map((ph, i) => {
                      const isVideo = ph.type === "video";
                      return (
                        <div key={ph.id || i} className="pic-card" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden", boxShadow:SHADOW.sm }}>
                          <div style={{ position:"relative", aspectRatio:"4/3", background:isVideo?"#0b0d12":T.card, cursor:"pointer" }} onClick={()=>setLightbox({ idx:i })}>
                            {isVideo ? (
                              <video src={ph.url} preload="metadata" muted playsInline style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}/>
                            ) : (
                              <img src={ph.url} alt={ph.label||""} loading="lazy" style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}/>
                            )}
                            {isVideo && (
                              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
                                <span style={{ width:40, height:40, borderRadius:"50%", background:"rgba(0,0,0,0.55)", color:"#fff", display:"inline-flex", alignItems:"center", justifyContent:"center", border:"2px solid rgba(255,255,255,0.7)" }}>
                                  <Icon as={Play} size={16}/>
                                </span>
                              </div>
                            )}
                            <span style={{ position:"absolute", top:6, left:6, display:"inline-flex", alignItems:"center", gap:4, background:"rgba(0,0,0,0.6)", color:"#fff", borderRadius:RADIUS.sm, padding:"2px 7px", fontSize:FONT.xs.size-1, fontWeight:700, letterSpacing:.5, textTransform:"uppercase" }}>
                              <Icon as={isVideo?Film:Camera} size={10}/>{isVideo?"Vidéo":"Photo"}
                            </span>
                            <button onClick={(e)=>{e.stopPropagation();removePhoto(i);}} title={isVideo?"Supprimer cette vidéo":"Supprimer cette photo"}
                              style={{ position:"absolute", top:6, right:6, display:"inline-flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.65)", color:"#fff", border:"none", borderRadius:"50%", width:26, height:26, cursor:"pointer", padding:0 }}>
                              <Icon as={Trash2} size={11}/>
                            </button>
                            {ph.label && (
                              <div style={{ position:"absolute", left:0, right:0, bottom:0, padding:"18px 10px 8px", background:"linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.7))", color:"#fff", fontSize:FONT.sm.size, fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", pointerEvents:"none" }}>
                                {ph.label}
                              </div>
                            )}
                          </div>
                          <div style={{ padding:"8px 10px", display:"flex", flexDirection:"column", gap:2 }}>
                            <input value={ph.label || ""} onChange={e=>updatePhotoField(i, "label", e.target.value)}
                              placeholder={isVideo ? "Titre de la vidéo" : "Titre de la photo"}
                              style={{ width:"100%", background:"transparent", border:"none", color:T.text, fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:700, outline:"none", padding:"3px 0" }}/>
                            <input value={ph.commentaire || ""} onChange={e=>updatePhotoField(i, "commentaire", e.target.value)}
                              placeholder="Commentaire (ex : Salon — mur sud, fissure)"
                              style={{ width:"100%", background:"transparent", border:"none", borderTop:`1px dashed ${T.border}`, color:T.textSub, fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none", padding:"5px 0 2px" }}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {tab==="params" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Settings} size={11}/>
                  Bibliothèque d'ouvrages
                </div>
                <label style={lbl}>Catégorie à modifier</label>
                <select style={{...inp,marginBottom:10}} value={catParam} onChange={e=>setCatParam(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {Object.keys(categories).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                {catParam && (
                  <>
                    <div style={h2s}>Ouvrages ({(categories[catParam]||[]).length})</div>
                    {(categories[catParam]||[]).map((item,idx) => (
                      <div key={idx} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, marginBottom:6 }}>
                        <span style={{flex:1,fontSize:FONT.sm.size,color:T.text}}>{item}</span>
                        <button onClick={()=>setToDeleteOuvrage({cat:catParam,idx,label:item})} title="Supprimer"
                          style={{...btnDng, display:"inline-flex", alignItems:"center", justifyContent:"center", padding:"4px 8px"}}>
                          <Icon as={Trash2} size={11}/>
                        </button>
                      </div>
                    ))}
                  </>
                )}
                <div style={{...h2s,marginTop:20}}>Ajouter un ouvrage</div>
                <label style={lbl}>Catégorie</label>
                <select style={{...inp,marginBottom:8}} value={newCat} onChange={e=>setNewCat(e.target.value)}>
                  {Object.keys(categories).map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <label style={lbl}>Libellé</label>
                <input style={{...inp,marginBottom:8}} value={newLib} onChange={e=>setNewLib(e.target.value)} placeholder="Ex : Installation électrique T2" onKeyDown={e=>e.key==="Enter"&&ajoutOuvrageLib()} />
                <button onClick={ajoutOuvrageLib} style={{
                  display:"inline-flex",alignItems:"center",gap:5,
                  background:acc.accent,color:acc.onAccent,border:"none",
                  borderRadius:RADIUS.md,padding:"8px 16px",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                }}>
                  <Icon as={Plus} size={12}/>
                  Ajouter
                </button>
              </>
            )}

            {tab==="export" && (
              <>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={FileDown} size={11}/>
                  Export du dossier
                </div>
                <p style={{color:T.textSub,fontSize:FONT.sm.size,marginBottom:14,lineHeight:1.7}}>
                  Le dossier de chiffrage reprend le design des documents Profero (même en-tête que le prévisionnel et la fiche opération) : tout ce qui a été saisi pendant la visite, prêt à imprimer ou à enregistrer en PDF.
                </p>
                <div style={{ background:acc.bg10, border:`1px solid ${acc.accent}33`, borderRadius:RADIUS.md, padding:"12px 14px", marginBottom:18 }}>
                  <div style={{display:"inline-flex",alignItems:"center",gap:5,color:acc.accent,fontWeight:700,marginBottom:8,fontSize:FONT.sm.size}}>
                    <Icon as={FileText} size={12}/>
                    Contenu du dossier
                  </div>
                  {[
                    `Client (${infos.client_societe ? "société, " : ""}contact, adresse de facturation), chantier${logementInfo.reference || logementInfo.type ? ` et logement ${[logementInfo.reference, logementInfo.type].filter(Boolean).join(" · ")}` : ""}, statut, budget et délai`,
                    `Devis : objet, dates, TVA ${tvaManquante ? "(à choisir)" : `${infos.tva_pct} %`}, conditions`,
                    `Notes${notesPages.some(d => (d.strokes||[]).length) ? " + pages manuscrites" : ""}`,
                    `Ouvrages par LOT puis ZONE : quantité, unité, PU HT, total HT${totauxProjet.ttc != null ? ", TVA et TTC" : ""}${budgetClient != null ? " et écart budget" : ""} — sans coûts ni marge`,
                    "Côtes menuiseries / huisseries",
                    `Plans (${richPlans.length}) et croquis à main levée (${croquisList.filter(d => (d.strokes||[]).length).length})`,
                    `Photos & vidéos (${photos.length}) avec titres et commentaires`,
                  ].map(i=>(
                    <div key={i} style={{fontSize:FONT.xs.size+1,color:T.textSub,marginBottom:4,display:"inline-flex",alignItems:"center",gap:5,width:"100%"}}>
                      <Icon as={Check} size={10} color={acc.accent}/>
                      {i}
                    </div>
                  ))}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <button onClick={()=>exporterPDF(false)} disabled={exporting} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:acc.accent,color:acc.onAccent,border:"none",
                    borderRadius:RADIUS.md,padding:"10px 18px",cursor:exporting?"not-allowed":"pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,opacity:exporting?.6:1,
                  }}>
                    <Icon as={Download} size={13}/>
                    {exporting ? "Génération…" : "Dossier PDF (client)"}
                  </button>
                  <button onClick={()=>exporterPDF(true)} disabled={exporting} title="Document INTERNE : coûts matériaux / main-d'œuvre, marge par ligne et globale. Ne pas envoyer au client." style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"transparent",color:"#e15a5a",border:"1px solid rgba(225,90,90,0.45)",
                    borderRadius:RADIUS.md,padding:"10px 18px",cursor:exporting?"not-allowed":"pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,opacity:exporting?.6:1,
                  }}>
                    <Icon as={Lock} size={13}/>
                    Synthèse interne PDF (coûts & marge)
                  </button>
                  <button onClick={handleExportWord} disabled={exporting} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"transparent",color:T.textSub,border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"10px 18px",cursor:exporting?"not-allowed":"pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,opacity:exporting?.6:1,
                  }}>
                    <Icon as={FileDown} size={13}/>
                    Word (.docx)
                  </button>
                </div>
                <p style={{color:T.textMuted,fontSize:FONT.xs.size+1,marginTop:14,lineHeight:1.6,fontStyle:"italic"}}>
                  Le PDF s'ouvre dans la fenêtre d'impression du navigateur : choisir « Enregistrer au format PDF » comme destination. Les vidéos y figurent par leur titre et leur lien (une vidéo ne s'imprime pas).
                </p>
              </>
            )}
          </div>
        </div>
      )}


{/* ── LIGHTBOX PHOTOS & VIDÉOS ── */}
      {lightbox && photos[lightbox.idx] && (() => {
        const m = photos[lightbox.idx];
        const isVideo = m.type === "video";
        return (
          <div onClick={()=>setLightbox(null)} style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.92)", zIndex:1200,
            display:"flex", alignItems:"center", justifyContent:"center",
            padding:20, flexDirection:"column", gap:14,
          }}>
            {isVideo ? (
              <video key={m.url} src={m.url} controls autoPlay playsInline onClick={e=>e.stopPropagation()}
                style={{ maxWidth:"100%", maxHeight:"calc(100vh - 160px)", borderRadius:8, background:"#000" }}/>
            ) : (
              <img src={m.url} alt={m.label||""} onClick={e=>e.stopPropagation()}
                style={{ maxWidth:"100%", maxHeight:"calc(100vh - 160px)", objectFit:"contain", borderRadius:8 }}/>
            )}
            {(m.label || m.commentaire) && (
              <div onClick={e=>e.stopPropagation()} style={{ color:"#fff", textAlign:"center", maxWidth:720 }}>
                {m.label && <div style={{ fontSize:15, fontWeight:800 }}>{m.label}</div>}
                {m.commentaire && <div style={{ fontSize:13, opacity:.75, marginTop:3 }}>{m.commentaire}</div>}
              </div>
            )}
            <div onClick={e=>e.stopPropagation()} style={{ display:"flex", gap:12, alignItems:"center" }}>
              {photos.length > 1 && (
                <>
                  <button onClick={()=>setLightbox(l=>({...l,idx:(l.idx-1+photos.length)%photos.length}))}
                    style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit" }}>
                    <Icon as={ChevronLeftIcon} size={16}/>
                  </button>
                  <span style={{ color:"#fff", fontSize:13, fontWeight:600 }}>{lightbox.idx + 1} / {photos.length}</span>
                  <button onClick={()=>setLightbox(l=>({...l,idx:(l.idx+1)%photos.length}))}
                    style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit" }}>
                    <Icon as={ChevronRight} size={16}/>
                  </button>
                </>
              )}
              <button onClick={()=>setLightbox(null)}
                style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", color:"#fff", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>
                Fermer
              </button>
            </div>
          </div>
        );
      })()}


{/* ── MODAL SÉLECTION OUVRAGES ── */}
      {showModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}
          onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div style={{
            background:T.modal||T.surface,borderRadius:RADIUS.xl,
            padding:0,maxWidth:560,width:"100%",maxHeight:"85vh",
            border:`1px solid ${T.border}`,boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
            display:"flex",flexDirection:"column",overflow:"hidden",
          }}>
            <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.sectionDivider||T.border}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:32,height:32,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={Check} size={16}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Aperçu du devis{logementInfo.reference ? ` — ${logementInfo.reference}` : ""}</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1}}>{ouvrages.length} ligne{ouvrages.length>1?"s":""} · LOT → ZONE → OUVRAGES · {fmtEur2(totauxProjet.venteHT)} HT{totauxProjet.ttc != null ? ` · ${fmtEur2(totauxProjet.ttc)} TTC` : ""}</div>
              </div>
              <button onClick={()=>setShowModal(false)} title="Fermer" style={{
                display:"inline-flex",alignItems:"center",justifyContent:"center",
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,width:30,height:30,cursor:"pointer",color:T.textSub,
              }}>
                <Icon as={X} size={13}/>
              </button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"16px 22px"}}>
              {ouvrages.length===0 ? <div style={{color:T.textMuted,textAlign:"center",padding:20,fontSize:FONT.sm.size,fontStyle:"italic"}}>Aucun ouvrage dans le devis</div> : (
                groupesDevis.map(g=>(
                  <div key={g.lot} style={{marginBottom:14}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:5,background:acc.bg10,color:acc.accent,padding:"4px 10px",borderRadius:RADIUS.sm,fontWeight:700,fontSize:FONT.xs.size+1,border:`1px solid ${acc.accent}33`,textTransform:"uppercase"}}>
                        <Icon as={Layers} size={11}/>{g.lot}
                      </span>
                      <span style={{flex:1}}/>
                      <span style={{fontSize:FONT.xs.size+1,fontWeight:800,color:T.textSub}}>{fmtEur2(g.total)}</span>
                    </div>
                    {g.zones.map(z=>(
                      <div key={z.zone} style={{marginLeft:8,marginBottom:6}}>
                        <div style={{fontSize:FONT.xs.size+1,fontWeight:800,color:T.textSub,textTransform:"uppercase",letterSpacing:.5,padding:"2px 0 4px"}}>{z.zone}</div>
                        {z.lignes.map(it=>{
                          const tot = totalLigneHT(it);
                          return (
                            <div key={it.id} style={{display:"flex",gap:8,padding:"5px 12px",fontSize:FONT.sm.size,color:T.text,borderLeft:`2px solid ${T.border}`,marginBottom:4}}>
                              <span style={{flex:1,minWidth:0}}>{it.code_ouvrage ? <strong style={{fontFamily:"ui-monospace, Menlo, Consolas, monospace",marginRight:6}}>{it.code_ouvrage}</strong> : null}{decoderLibelleCode(it.item)?.reste || it.item}</span>
                              <span style={{color:T.textMuted,whiteSpace:"nowrap"}}>{it.quantite ? `${it.quantite} ${it.unite || "U"}` : "—"}{numOrNull(it.prix_unitaire) != null ? ` × ${fmtEur2(it.prix_unitaire)}` : ""}</span>
                              <span style={{fontWeight:800,color:tot != null ? "#22c55e" : T.textMuted,whiteSpace:"nowrap",minWidth:80,textAlign:"right"}}>{tot != null ? fmtEur2(tot) : "sans prix"}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div style={{padding:"14px 22px",borderTop:`1px solid ${T.sectionDivider||T.border}`,display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setShowModal(false)} style={{
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"9px 22px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
              }}>Fermer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DEVIS PROGBAT : aperçu reconstruit par le serveur + création d'un brouillon après confirmation ── */}
      {showProgbat && (
        <ProgbatApercuDevis T={T} acc={acc} projetId={projetId} projet={infos} lignes={ouvrages} lotsOrdre={lotsOrdre} onClose={()=>setShowProgbat(false)} onDevisCree={()=>chargerProjets()}/>
      )}

      {/* ── MODAL ACTUALISER UNE LIGNE DEPUIS LA BIBLIOTHÈQUE ── */}
      {actualisation && (() => {
        const { ligne, calcul, diffs } = actualisation;
        const fmtVal = (champ, v) => v == null ? "—" : /taux_horaire/.test(champ) ? `${fmtEur2(v)}/h` : /taux/.test(champ) ? fmtPct(v) : /coef/.test(champ) ? fmtCoef(v) : /cout|prix/.test(champ) ? fmtEur2(v) : String(v);
        return (
          <div onClick={()=>setActualisation(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)" }}>
            <div onClick={e=>e.stopPropagation()} style={{ background:T.modal,borderRadius:RADIUS.xl,padding:24, width:"100%",maxWidth:560,border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={RefreshCw} size={18}/></div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Actualiser depuis la bibliothèque</div>
                  <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ligne.code_ouvrage ? `${ligne.code_ouvrage} · ` : ""}{ligne.item} · zone {ligne.zone || ZONE_DEFAUT}</div>
                </div>
              </div>
              {diffs.length === 0 ? (
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>Cette ligne est déjà identique au calcul actuel de la bibliothèque. Rien à actualiser.</div>
              ) : (
                <>
                  <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:12}}>
                    Seule <strong style={{color:T.text}}>cette ligne</strong> sera mise à jour (zone, quantité et TVA conservées). Les autres lignes et les autres devis ne bougent pas.
                    {!calcul.complet && <div style={{color:"#e15a5a",fontWeight:700,marginTop:6}}>Le calcul actuel est incomplet : {calcul.erreurs.join(" · ")}</div>}
                  </div>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:FONT.sm.size,marginBottom:18}}>
                    <thead><tr>{["Champ","Ligne actuelle","Bibliothèque"].map((h,i)=><th key={h} style={{textAlign:i===0?"left":"right",fontSize:FONT.xs.size,color:T.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:.6,padding:"4px 8px",borderBottom:`1px solid ${T.border}`}}>{h}</th>)}</tr></thead>
                    <tbody>{diffs.map(d=>(
                      <tr key={d.champ}>
                        <td style={{padding:"6px 8px",color:T.textSub,borderBottom:`1px solid ${T.sectionDivider||T.border}`}}>{d.label}</td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:T.textMuted,textDecoration:"line-through",borderBottom:`1px solid ${T.sectionDivider||T.border}`}}>{fmtVal(d.champ,d.avant)}</td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontWeight:800,color:T.text,borderBottom:`1px solid ${T.sectionDivider||T.border}`}}>{fmtVal(d.champ,d.apres)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </>
              )}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setActualisation(null)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer"}}>{diffs.length === 0 ? "Fermer" : "Annuler"}</button>
                {diffs.length > 0 && (
                  <button onClick={confirmerActualisation} style={{display:"inline-flex",alignItems:"center",gap:6,background:acc.accent,color:acc.onAccent,border:"none",borderRadius:RADIUS.md,padding:"9px 18px",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer"}}>
                    <Icon as={Check} size={13}/> Actualiser cette ligne
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL DÉTAIL DU PRIX D'UNE LIGNE (snapshot) ── */}
      {voirDetailLigne && (() => {
        const l = voirDetailLigne, d = l.calcul_detail || {};
        const cond = decrireConditionsLigne(l);
        const row = (label, val, strong = false) => (
          <div style={{display:"flex",justifyContent:"space-between",gap:12,padding:"5px 0",borderBottom:`1px solid ${T.sectionDivider||T.border}`,fontSize:FONT.sm.size}}>
            <span style={{color:T.textSub}}>{label}</span><span style={{fontWeight:strong?800:600,color:T.text}}>{val}</span>
          </div>
        );
        return (
          <div onClick={()=>setVoirDetailLigne(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)" }}>
            <div onClick={e=>e.stopPropagation()} style={{ background:T.modal,borderRadius:RADIUS.xl,padding:24, width:"100%",maxWidth:520,border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Lock} size={18}/></div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Prix figé de la ligne</div>
                  <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.code_ouvrage ? `${l.code_ouvrage} · ` : ""}{l.item}</div>
                </div>
              </div>
              <div style={{marginBottom:14}}>
                {row("Zone", l.zone || ZONE_DEFAUT)}
                {row(`Coût matériaux / ${l.unite || "u"}`, fmtEur2(l.cout_materiaux_unitaire))}
                {row(`Coût main-d'œuvre / ${l.unite || "u"}`, `${fmtEur2(l.cout_main_oeuvre_unitaire)}${d.heures_unitaires != null && d.cout_horaire != null ? ` (${d.heures_unitaires} h × ${d.cout_horaire} €/h chargé)` : ""}`)}
                {numOrNull(l.cout_direct_unitaire) > 0 && row(`Coût direct / ${l.unite || "u"}`, fmtEur2(l.cout_direct_unitaire))}
                {row(`Coût total / ${l.unite || "u"}`, fmtEur2(l.cout_total_unitaire), true)}
                {(l.coef_vente != null || d.coef_vente != null) && row(d.version >= 2 ? "Coefficient appliqué" : "Coefficient de vente (coût total)", `${d.coefficient_applique?.libelle ? `${d.coefficient_applique.libelle} — ` : (d.coefficient_vente_libelle ? `${d.coefficient_vente_libelle} — ` : "")}${formaterCoefficient(l.coef_vente ?? d.coef_vente)}`)}
                {(l.coef_vente != null || d.coef_vente != null) && row("Origine du coefficient", libelleSource(cond.coefficient.source))}
                {cond.coefficient.source !== "ouvrage" && row("Coefficient d'origine de l'ouvrage", cond.coefficient.origine != null ? `${d.coefficient_vente_libelle ? `${d.coefficient_vente_libelle} — ` : ""}${formaterCoefficient(cond.coefficient.origine)}` : "non figé sur cette ligne")}
                {d.prix_materiaux_unitaire != null && row(`Prix matériaux HT / ${l.unite || "u"}`, `${expliquerPrixMateriaux(l.cout_materiaux_unitaire, l.coef_vente ?? d.coef_vente) || fmtEur2(d.prix_materiaux_unitaire)}${d.prix_direct_unitaire ? ` + coût direct ${fmtEur2(d.prix_direct_unitaire)}` : ""}`)}
                {(l.taux_horaire_vente != null || d.taux_horaire_vente != null) && row("Taux horaire appliqué", `${d.taux_applique?.libelle ? `${d.taux_applique.libelle} — ` : (d.taux_horaire_vente_libelle ? `${d.taux_horaire_vente_libelle} — ` : "")}${formaterTauxHT(l.taux_horaire_vente ?? d.taux_horaire_vente)}`)}
                {(l.taux_horaire_vente != null || d.taux_horaire_vente != null) && row("Origine du taux horaire", libelleSource(cond.tauxHoraire.source))}
                {cond.tauxHoraire.source !== "ouvrage" && row("Taux horaire d'origine de l'ouvrage", cond.tauxHoraire.origine != null ? `${d.taux_horaire_vente_libelle ? `${d.taux_horaire_vente_libelle} — ` : ""}${formaterTauxHT(cond.tauxHoraire.origine)}` : "non figé sur cette ligne")}
                {d.prix_main_oeuvre_unitaire != null && row(`Prix main-d'œuvre HT / ${l.unite || "u"}`, expliquerPrixMainOeuvre(d.heures_unitaires, l.taux_horaire_vente ?? d.taux_horaire_vente) || fmtEur2(d.prix_main_oeuvre_unitaire))}
                {row("Marge sur prix de vente", fmtPct(l.taux_marge_pct))}
                {row(`Prix de vente HT / ${l.unite || "u"}`, fmtEur2(l.prix_unitaire), true)}
                {row("TVA de la ligne", numOrNull(l.tva_pct) != null ? fmtPct(l.tva_pct) : `TVA du projet${!tvaManquante ? ` (${infos.tva_pct} %)` : ""}`)}
                {row("Calcul figé le", d.date ? new Date(d.date).toLocaleString("fr-FR") : (l.calcul_version || "—"))}
              </div>
              {Array.isArray(d.materiaux) && d.materiaux.length > 0 && (
                <div style={{marginBottom:14}}>
                  <div style={{...lbl}}>Matériaux (pour 1 {l.unite || "u"})</div>
                  {d.materiaux.map((m,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:FONT.xs.size+1,color:T.textSub,padding:"3px 0"}}>
                      <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nom}</span>
                      <span style={{whiteSpace:"nowrap"}}>{m.quantite ?? "?"} {m.unite || ""} × {fmtEur2(m.prix_unitaire)} = <strong style={{color:T.text}}>{fmtEur2(m.total)}</strong></span>
                    </div>
                  ))}
                </div>
              )}
              {(d.erreurs || []).length > 0 && (
                <div style={{marginBottom:14,padding:"8px 10px",borderRadius:RADIUS.md,background:"rgba(225,90,90,0.10)",border:"1px solid rgba(225,90,90,0.35)"}}>
                  {(d.erreurs || []).map((e,i)=><div key={i} style={{fontSize:FONT.xs.size+1,color:"#e15a5a",fontWeight:600}}>• {e}</div>)}
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:4}}>Corrige l'ouvrage dans la page Bibliothèque puis utilise « Actualiser » sur cette ligne.</div>
                </div>
              )}
              <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <button onClick={()=>{ setConditionsLigne(l); setVoirDetailLigne(null); }} title="Choisir le coefficient et le taux horaire de vente de CETTE ligne uniquement"
                  style={{display:"inline-flex",alignItems:"center",gap:6,background:"transparent",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 14px",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700}}>
                  <Icon as={SlidersHorizontal} size={13}/> Conditions de vente de cette ligne
                </button>
                <button onClick={()=>setVoirDetailLigne(null)} style={{background:acc.accent,color:acc.onAccent,border:"none",borderRadius:RADIUS.md,padding:"9px 22px",cursor:"pointer",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800}}>Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL CONDITIONS DE VENTE D'UNE LIGNE (dérogation coefficient / taux) ── */}
      {conditionsLigne && (
        <ConditionsVenteLigne T={T} acc={acc} projet={projetActif} projetId={projetId}
          ligne={ouvrages.find(o => o.id === conditionsLigne.id) || conditionsLigne}
          coefficients={biblio?.coefficients || []} tauxHoraires={biblio?.tauxHoraires || []}
          onApplique={rechargerApresConditionsLigne} onClose={()=>setConditionsLigne(null)}/>
      )}

      {/* ── MODAL RETIRER UNE LIGNE DU DEVIS ── */}
      {toDeleteLigne && (
        <div onClick={()=>setToDeleteLigne(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.modal,borderRadius:RADIUS.xl,padding:24, width:"100%",maxWidth:440,border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Trash2} size={20}/></div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Retirer cette ligne ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              <strong style={{color:T.text}}>{toDeleteLigne.code_ouvrage ? `${toDeleteLigne.code_ouvrage} · ` : ""}{decoderLibelleCode(toDeleteLigne.item)?.reste || toDeleteLigne.item}</strong> — zone <strong style={{color:T.text}}>{toDeleteLigne.zone || ZONE_DEFAUT}</strong>.
              {ouvrages.filter(o => o.bibliotheque_id && o.bibliotheque_id === toDeleteLigne.bibliotheque_id).length > 1 && <><br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les autres occurrences de cet ouvrage dans le devis sont conservées.</span></>}
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeleteLigne(null)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer"}}>Annuler</button>
              <button onClick={()=>supprimerLigne(toDeleteLigne.id)} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#e15a5a",color:"#fff",border:"none",borderRadius:RADIUS.md,padding:"9px 18px",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer"}}>
                <Icon as={Trash2} size={13}/> Retirer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL DUPLIQUER POUR UN AUTRE LOGEMENT ── */}
      {dupliquerModal && (
        <div onClick={()=>!dupliquant&&setDupliquerModal(null)} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000, display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)" }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:T.modal,borderRadius:RADIUS.xl,padding:24, width:"100%",maxWidth:480,border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}><Icon as={Copy} size={18}/></div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Dupliquer pour un autre logement</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:14}}>
              Le nouveau projet reprend le client, l'adresse du chantier, les ouvrages avec leurs zones, quantités et <strong style={{color:T.text}}>prix figés</strong> (aucun recalcul depuis la bibliothèque), les plans, côtes, dessins et médias. Statut remis à « Prospect ».
            </div>
            <label style={lbl}>Référence du nouveau logement</label>
            <input autoFocus style={{...inp, marginBottom:10}} value={dupliquerModal.reference} onChange={e=>setDupliquerModal(m=>({...m, reference:e.target.value}))} placeholder="Appartement 102, Logement 4, Studio 1er…"
              onKeyDown={e=>{ if(e.key==="Enter") dupliquerProjet(dupliquerModal); if(e.key==="Escape") setDupliquerModal(null); }}/>
            <label style={lbl}>Type de logement</label>
            <select style={{...inp, marginBottom:20, cursor:"pointer"}} value={dupliquerModal.type} onChange={e=>setDupliquerModal(m=>({...m, type:e.target.value}))}>
              <option value="">— Choisir —</option>
              {TYPES_LOGEMENT.map(t => <option key={t} value={t}>{t}</option>)}
              {dupliquerModal.type && !TYPES_LOGEMENT.includes(dupliquerModal.type) && <option value={dupliquerModal.type}>{dupliquerModal.type}</option>}
            </select>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setDupliquerModal(null)} disabled={dupliquant} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",opacity:dupliquant?.5:1}}>Annuler</button>
              <button onClick={()=>dupliquerProjet(dupliquerModal)} disabled={dupliquant} style={{display:"inline-flex",alignItems:"center",gap:6,background:acc.accent,color:acc.onAccent,border:"none",borderRadius:RADIUS.md,padding:"9px 18px",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",opacity:dupliquant?.6:1}}>
                <Icon as={Copy} size={13}/> {dupliquant ? "Duplication…" : "Créer le logement"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION PROJET ── */}
      {toDelete && (
        <div onClick={()=>!deleting&&setToDelete(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,
                background:"rgba(224,92,92,0.12)",color:"#e15a5a",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce projet&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le projet <strong style={{color:T.text}}>« {toDelete.client_nom||"Sans client"} {toDelete.client_prenom||""} »</strong> sera supprimé avec ses ouvrages, ses côtes et ses plans.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Cette action est irréversible.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDelete(null)} disabled={deleting} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",opacity:deleting?.5:1,
              }}>Annuler</button>
              <button onClick={confirmSuppProjet} disabled={deleting} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                cursor:"pointer",opacity:deleting?.6:1,
              }}>
                <Icon as={Trash2} size={13}/>
                {deleting?"Suppression…":"Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION OUVRAGE BIBLIOTHÈQUE ── */}
      {toDeleteOuvrage && (
        <div onClick={()=>setToDeleteOuvrage(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cet ouvrage ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              L'ouvrage <strong style={{color:T.text}}>« {toDeleteOuvrage.label} »</strong> sera retiré de la bibliothèque <strong style={{color:T.text}}>{toDeleteOuvrage.cat}</strong>.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeleteOuvrage(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={()=>delOuvrageLib(toDeleteOuvrage.cat,toDeleteOuvrage.idx)} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION LOT ── */}
      {toDeleteLot && (
        <div onClick={()=>setToDeleteLot(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce lot ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le lot <strong style={{color:T.text}}>« {toDeleteLot} »</strong> et tous ses ouvrages seront supprimés de la bibliothèque. Les ouvrages de ce lot sélectionnés sur ce projet seront également retirés.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeleteLot(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={()=>deleteLot(toDeleteLot)} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL LIER UN PLAN À UN CHANTIER ── */}
      {linkingPlan && (
        <div onClick={()=>{setLinkingPlan(null);setLinkChantier("");}} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={Send} size={18}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Envoyer vers la page Plans</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:16}}>
              Lie le plan <strong style={{color:T.text}}>« {linkingPlan.name||"Plan"} »</strong> à un chantier. Il apparaîtra alors dans la page <strong style={{color:T.text}}>Plans</strong>, filtrable par ce chantier.
            </div>
            <label style={lbl}>Chantier</label>
            <select style={{...inp, marginBottom:20}} value={linkChantier} onChange={e=>setLinkChantier(e.target.value)}>
              <option value="">— Aucun (non lié) —</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>{setLinkingPlan(null);setLinkChantier("");}} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={lierPlanChantier} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Check} size={13}/>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION PLAN ── */}
      {toDeletePlan && (
        <div onClick={()=>setToDeletePlan(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce plan ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le plan <strong style={{color:T.text}}>« {toDeletePlan.name||"Plan"} »</strong> sera définitivement supprimé{toDeletePlan.chantier_id ? " (y compris depuis la page Plans)" : ""}.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeletePlan(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={()=>supprimerPlan(toDeletePlan.id)} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── MODAL SUPPRESSION DESSIN (page manuscrite / croquis) ── */}
      {toDeleteDessin && (
        <div onClick={()=>setToDeleteDessin(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer {toDeleteDessin.type === "note" ? "cette page" : "ce croquis"} ?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              <strong style={{color:T.text}}>« {toDeleteDessin.nom || (toDeleteDessin.type === "note" ? "Page" : "Croquis")} »</strong> et ses {(toDeleteDessin.strokes||[]).length} trait{(toDeleteDessin.strokes||[]).length>1?"s":""} seront définitivement supprimés.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDeleteDessin(null)} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer"}}>Annuler</button>
              <button onClick={()=>supprimerDessin(toDeleteDessin.id)} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#e15a5a",color:"#fff",border:"none",borderRadius:RADIUS.md,padding:"9px 18px",fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer"}}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
