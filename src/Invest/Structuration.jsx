import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar
} from "./_shared";

const STRUCT_DOC_CATEGORIES = [
  { id:"identite", label:"Identité & situation personnelle", description:"État civil, domicile et situation familiale" },
  { id:"revenus", label:"Revenus & activité professionnelle", description:"Capacité de revenus et stabilité professionnelle" },
  { id:"engagements", label:"Charges & engagements financiers", description:"Crédits, charges et engagements hors bilan" },
  { id:"immobilier", label:"Patrimoine immobilier existant", description:"Détention, fiscalité, flux et financement des biens" },
  { id:"financier", label:"Patrimoine financier & retraite", description:"Épargne, placements, retraite et produits fiscaux" },
  { id:"bancaire", label:"Épargne & étude bancaire", description:"Apport, relevés et pièces nécessaires au financement" },
  { id:"structures", label:"Structures, fiscalité & transmission", description:"SCI, sociétés, IFI et cadre patrimonial" },
  { id:"mission", label:"Mission & conformité", description:"Contrat, consentement et mise en œuvre" },
];

const STRUCT_DOCS_DEFAULT = [
  { id:"piece_identite", categorie:"identite", label:"Pièce d'identité valide", required:true, statut:"À demander", commentaire:"" },
  { id:"justificatif_domicile", categorie:"identite", label:"Justificatif de domicile de moins de 3 mois", required:true, statut:"À demander", commentaire:"" },
  { id:"situation_familiale", categorie:"identite", label:"Livret de famille / justificatif de situation familiale", required:false, statut:"À demander", commentaire:"" },
  { id:"contrat_mariage", categorie:"identite", label:"Contrat de mariage / PACS / jugement de divorce", required:false, statut:"À demander", commentaire:"" },

  { id:"bulletins_salaire", categorie:"revenus", label:"3 derniers bulletins de salaire", required:false, statut:"À demander", commentaire:"Salarié" },
  { id:"contrat_travail", categorie:"revenus", label:"Contrat de travail / attestation employeur", required:false, statut:"À demander", commentaire:"Salarié" },
  { id:"avis_imposition", categorie:"revenus", label:"2 derniers avis d'imposition", required:true, statut:"À demander", commentaire:"" },
  { id:"bilans_entreprise", categorie:"revenus", label:"2 ou 3 derniers bilans comptables", required:false, statut:"À demander", commentaire:"TNS / chef d'entreprise" },
  { id:"liasse_fiscale", categorie:"revenus", label:"Dernière liasse fiscale", required:false, statut:"À demander", commentaire:"TNS / chef d'entreprise" },
  { id:"remuneration_dividendes", categorie:"revenus", label:"Attestation de rémunération et dividendes", required:false, statut:"À demander", commentaire:"Dirigeant" },
  { id:"urssaf", categorie:"revenus", label:"Attestation URSSAF", required:false, statut:"À demander", commentaire:"Indépendant" },
  { id:"kbis_statuts_pro", categorie:"revenus", label:"Extrait Kbis / statuts de société professionnelle", required:false, statut:"À demander", commentaire:"" },

  { id:"credits_en_cours", categorie:"engagements", label:"Liste des crédits en cours", required:true, statut:"À demander", commentaire:"" },
  { id:"tableau_credits", categorie:"engagements", label:"Échéanciers / tableaux d'amortissement des prêts", required:true, statut:"À demander", commentaire:"" },
  { id:"baux_quittances_perso", categorie:"engagements", label:"Baux et quittances de résidence principale", required:false, statut:"À demander", commentaire:"Si locataire" },
  { id:"pensions", categorie:"engagements", label:"Justificatifs de pensions versées ou reçues", required:false, statut:"À demander", commentaire:"" },
  { id:"charges_fixes", categorie:"engagements", label:"Charges fixes mensuelles principales", required:false, statut:"À demander", commentaire:"" },
  { id:"cautions", categorie:"engagements", label:"Cautions bancaires / garanties / avals", required:false, statut:"À demander", commentaire:"" },

  { id:"actes_notaries", categorie:"immobilier", label:"Actes de propriété de tous les biens", required:true, statut:"À demander", commentaire:"" },
  { id:"amortissements_immo", categorie:"immobilier", label:"Tableaux d'amortissement des crédits immobiliers", required:true, statut:"À demander", commentaire:"" },
  { id:"baux", categorie:"immobilier", label:"Baux locatifs et justificatifs de loyers", required:true, statut:"À demander", commentaire:"" },
  { id:"taxes_foncieres", categorie:"immobilier", label:"Taxes foncières des biens détenus", required:true, statut:"À demander", commentaire:"" },
  { id:"charges_copro", categorie:"immobilier", label:"Charges de copropriété et derniers PV d'AG", required:false, statut:"À demander", commentaire:"" },
  { id:"dpe_ddt", categorie:"immobilier", label:"Diagnostics, DPE et DDT", required:false, statut:"À demander", commentaire:"" },
  { id:"pno", categorie:"immobilier", label:"Assurances PNO / GLI", required:false, statut:"À demander", commentaire:"" },
  { id:"declarations_locatives", categorie:"immobilier", label:"Déclarations ou résultats locatifs / LMNP / foncier", required:false, statut:"À demander", commentaire:"" },

  { id:"releves_placements", categorie:"financier", label:"Relevés livrets et épargne", required:true, statut:"À demander", commentaire:"" },
  { id:"assurance_vie", categorie:"financier", label:"Relevés assurance-vie", required:false, statut:"À demander", commentaire:"" },
  { id:"pea_cto", categorie:"financier", label:"Comptes-titres / PEA", required:false, statut:"À demander", commentaire:"" },
  { id:"scpi_opci", categorie:"financier", label:"SCPI / OPCI / actifs immobiliers papier", required:false, statut:"À demander", commentaire:"" },
  { id:"per_retraite", categorie:"financier", label:"PER / épargne retraite / épargne salariale", required:false, statut:"À demander", commentaire:"" },
  { id:"produits_defiscalisants", categorie:"financier", label:"Produits défiscalisants en cours", required:false, statut:"À demander", commentaire:"Pinel, Denormandie, Malraux..." },

  { id:"releves_bancaires", categorie:"bancaire", label:"Relevés bancaires des 3 derniers mois", required:true, statut:"À demander", commentaire:"" },
  { id:"epargne_disponible", categorie:"bancaire", label:"Justificatif d'épargne disponible / apport", required:true, statut:"À demander", commentaire:"" },
  { id:"epargne_programmee", categorie:"bancaire", label:"Justificatifs d'épargne programmée", required:false, statut:"À demander", commentaire:"" },
  { id:"bonus_primes", categorie:"bancaire", label:"Bonus / primes / revenus exceptionnels", required:false, statut:"À demander", commentaire:"" },
  { id:"tresorerie_societe", categorie:"bancaire", label:"Trésorerie de société mobilisable", required:false, statut:"À demander", commentaire:"Investissement via structure" },
  { id:"situation_bancaire", categorie:"bancaire", label:"Relevé de situation bancaire / simulation existante", required:false, statut:"À demander", commentaire:"" },
  { id:"assurance_habitation", categorie:"bancaire", label:"Assurance habitation résidence principale", required:false, statut:"À demander", commentaire:"Étude bancaire" },
  { id:"rib", categorie:"bancaire", label:"RIB", required:false, statut:"À demander", commentaire:"" },

  { id:"statuts_societes", categorie:"structures", label:"Statuts SCI / sociétés de détention", required:false, statut:"À demander", commentaire:"" },
  { id:"kbis_sci", categorie:"structures", label:"Kbis / RIB / PV d'AG des SCI", required:false, statut:"À demander", commentaire:"" },
  { id:"bilans_sci", categorie:"structures", label:"Bilans et liasses fiscales des SCI / holdings", required:false, statut:"À demander", commentaire:"" },
  { id:"organigramme_detention", categorie:"structures", label:"Organigramme de détention actuel", required:false, statut:"À demander", commentaire:"" },
  { id:"declaration_ifi", categorie:"structures", label:"Déclaration IFI / éléments d'assiette", required:false, statut:"À demander", commentaire:"Si concerné" },
  { id:"deficits_reportables", categorie:"structures", label:"Déficits fonciers / amortissements reportables", required:false, statut:"À demander", commentaire:"" },

  { id:"contrat_mission", categorie:"mission", label:"Lettre de mission Structuration Patrimoniale signée", required:true, statut:"À demander", commentaire:"" },
  { id:"consentement_rgpd", categorie:"mission", label:"Consentement RGPD / certification des informations", required:true, statut:"À demander", commentaire:"" },
  { id:"rapport_restitution", categorie:"mission", label:"Rapport de restitution transmis", required:false, statut:"À demander", commentaire:"À l'issue de la phase 1" },
  { id:"pv_restitution", categorie:"mission", label:"Compte rendu de réunion de restitution", required:false, statut:"À demander", commentaire:"" },
];

const STRUCT_DEFAULT_LOTS = [
  { adresse:"", type:"T2", structure:"PP direct", regime:"Foncier réel", loyer_mois:"", mensualite:"", crd:"", valeur:"", charges_annuelles:"", travaux_a_prevoir:"" },
];

const firstStructValue = (...vals) => {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return v;
  }
  return "";
};

const getStructClientStrategy = (client) => (
  client?.strategie_data ||
  client?.donnees_strategie ||
  client?.strategie ||
  client?.profil_investisseur ||
  {}
);

const getStructNested = (obj, ...keys) => {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return "";
    cur = cur[k];
  }
  return cur ?? "";
};

function buildStructDefault(client) {
  const strategie = getStructClientStrategy(client);
  const zones = firstStructValue(
    strategie?.zones, strategie?.zone_recherche, strategie?.zones_recherchees, strategie?.ville_recherchee,
    getStructNested(strategie, "recherche", "zones"), getStructNested(strategie, "criteres", "zones")
  );
  const objectifPrincipal = firstStructValue(
    strategie?.objectif_principal, strategie?.objectif, strategie?.strategie,
    getStructNested(strategie, "objectifs", "principal"),
    "Accélération patrimoniale"
  );
  const budgetClient = firstStructValue(
    client?.budget, strategie?.budget, strategie?.budget_max, strategie?.budget_global,
    getStructNested(strategie, "financement", "budget"), getStructNested(strategie, "criteres", "budget")
  );
  const apportClient = firstStructValue(
    strategie?.apport, strategie?.apport_disponible, getStructNested(strategie, "financement", "apport")
  );
  const rendementCible = firstStructValue(
    strategie?.rendement_cible, strategie?.rendement_minimum, getStructNested(strategie, "objectifs", "rendement_cible")
  );
  const fiscalite = firstStructValue(
    strategie?.fiscalite_recommandee, strategie?.fiscalite, strategie?.regime_fiscal, getStructNested(strategie, "fiscalite", "regime")
  );
  return {
    version: 1,
    collecte: {
      profil: {
        prenom: client?.prenom || "", nom: client?.nom || "", email: client?.email || "", telephone: client?.telephone || "", conseiller: client?.conseiller || "",
        source_crm: client?.source || "", statut_crm: client?.statut || "", budget_crm: budgetClient || "", etape_crm: client?.etape || "", notes_crm: client?.notes_rapides || "",
        date_naissance:"", age:"", adresse:"", situation_familiale:"", regime_matrimonial:"", contrat_mariage:"", enfants:"", enfants_details:"",
        profession:"", statut_pro:"", employeur:"", anciennete:"", revenus_nets_mois:"", revenus_conjoint_mois:"", revenus_locatifs_nets_mois:"", dividendes_an:"", autres_revenus_an:"", impot_revenu:"", tmi:"", residence_fiscale:"France", regime_locatif:"", dispositifs_fiscaux:"", deficit_foncier:"", ifi:"",
      },
      qualification: {
        date_r1:"", source_lead:"", prescripteur:"", origine_commentaire:"", objectif_classement:"", budget_min:"", budget_max:"", type_bien_vise:"", zone_geographique:"", niveau_levier:"", niveau_implication:"",
        charges_fixes_mois:"", credits_conso_mois:"", pensions_mois:"", engagements_hors_bilan:"", situation_bancaire:"RAS", accompagnements:"", niveau_complexite:"", justification_complexite:"", alertes:"", consentement_rgpd:"",
      },
      patrimoine: {
        residence_principale_statut:"", rp_valeur:"", rp_crd:"", residence_secondaire_valeur:"", patrimoine_professionnel:"", patrimoine_pro_commentaires:"", retraite:"", liberalites:"", lots: STRUCT_DEFAULT_LOTS.map(x=>({...x})),
      },
      financement: {
        banque_principale:"", relation_bancaire:"", mensualites_total:"", apport_disponible:apportClient || "", capacite_avec_revente:budgetClient || "", financable_sans_revente:"",
        taux_moyen:"", duree_initiale:"", premiere_echeance:"", bien_premiere_echeance:"", montant_libere_echeance:"", mensualite_max:"", epargne_precaution:"", refinancement_envisage:"",
      },
      structures: {
        sci_existante:"", sci_regime:fiscalite || "", sci_associes:"", sci_biens:"", sci_resultat:"", sci_optimisee:"", holding_envisagee:"", nouvelles_sci:"", transmission:"",
      },
      objectifs: {
        objectif_principal:objectifPrincipal || "Accélération patrimoniale", horizon:firstStructValue(strategie?.horizon, getStructNested(strategie, "objectifs", "horizon"), "15 ans"), rendement_cible:rendementCible || "", rythme_achat:firstStructValue(strategie?.rythme_achat, getStructNested(strategie, "objectifs", "rythme_achat")) || "", zones:Array.isArray(zones) ? zones.join(", ") : (zones || ""), gestion_locative:firstStructValue(strategie?.gestion_locative, getStructNested(strategie, "exploitation", "gestion_locative")) || "", temps_immo:"", delegation:"", travaux:firstStructValue(strategie?.travaux, getStructNested(strategie, "criteres", "travaux")) || "", protection_famille:"", revenus_immediats:"", valorisation_capital:"", transmission_priorite:"", reduction_impots:"", projets_3_5_ans:"",
      },
      patrimoine_financier: { liquidites:"", assurance_vie:"", pea_cto:"", per:"", epargne_salariale:"", autres:"" },
      rdv: { motivations:"", objections:"", notes:"", issue:"", relance:"", prochaine_action:"", date_r2:"", lieu_r2:"", documents_prioritaires:"", email_recap_date:"", signature_client:"" },
      documents: STRUCT_DOCS_DEFAULT.map(x=>({...x})),
    },
    analyse: {
      diagnostic:"", strategie_recommandee:"", points_attention:"", conclusion:"", analyse_performance:"", analyse_bancaire:"", analyse_fiscale:"", analyse_structure:"", analyse_transmission:"", analyse_risques:"", arbitrages:"", professionnels_a_mobiliser:"", hypothese_centrale:"",
      contexte_client:"", projet_etudie:"", investissement_total:"", cashflow_cible:"", revenus_exceptionnels:"",
      point_majeur:"", point_vigilance:"", strategie_fiscale:"", simulation_fiscale:"", capacite_emprunt:"",
      calendrier:"", points_forts:"", points_preparer:"", note_finale:"",
      scenarios: [
        { id:"s1", nom:"Conserver & optimiser", objectif:"Optimiser fiscalité, gestion et refinancement sans arbitrage majeur", statut:"À étudier" },
        { id:"s2", nom:"Arbitrer & réinvestir", objectif:"Céder les actifs peu performants pour reconstituer capacité d’emprunt", statut:"À étudier" },
        { id:"s3", nom:"Structurer en société", objectif:"SCI IS / Holding / démembrement selon objectifs de capitalisation et transmission", statut:"À étudier" },
      ],
      preconisations: [
        { id:"p1", axe:"Financement", priorite:"Haute", titre:"Clarifier la capacité d’emprunt résiduelle", detail:"Comparer la lecture bancaire actuelle avec un scénario d’arbitrage ou de refinancement.", action:"Collecter échéanciers et CRD exacts", statut:"À faire" },
        { id:"p2", axe:"Fiscalité", priorite:"Haute", titre:"Comparer IR / LMNP / SCI IS", detail:"Évaluer la charge fiscale actuelle et l’intérêt d’une structure à l’IS selon l’horizon et les flux.", action:"Reconstituer résultat fiscal par bien", statut:"À faire" },
        { id:"p3", axe:"Transmission", priorite:"Moyenne", titre:"Préparer la transmission du patrimoine immobilier", detail:"Étudier donation de parts, démembrement et SCI familiale si enfants / conjoint concernés.", action:"Valider situation familiale et objectifs", statut:"À faire" },
      ],
    },
  };
}

const STRUCT_STATUTS = ["Collecte", "Analyse", "Préconisations", "Restitution", "Phase 2", "Terminé"];
const STRUCT_PHASES = ["Phase 1 — Audit & Conseil", "Phase 2 — Suivi patrimonial", "Phase 1 + Phase 2"];
const STRUCT_DOC_STATUTS = ["À demander", "Demandé", "Reçu", "Validé", "À vérifier", "Non applicable"];
const STRUCT_LOT_TYPES = ["Studio","T1","T2","T3","T4","T5+","Commerce","Immeuble","SCPI","Autre"];
const STRUCT_DETENTION = ["PP direct","SCI IR","SCI IS","SARL famille","Holding SAS","Démembrement","Autre"];
const STRUCT_REGIMES = ["Foncier réel","Micro-foncier","LMNP réel","Micro-BIC","SCI IS","LMP","Non défini"];


// Champ stable utilisé par la page Structuration Patrimoniale.
// Important : il est défini hors du composant principal pour éviter que React
// démonte/remonte l'input à chaque frappe, ce qui faisait perdre le focus.
function StructField({ T=THEMES_INV.dark, label, value, onChange, type="text", placeholder="", options=null, wide=false, compact=false }) {
  const controlStyle = {
    width:"100%",
    minHeight: compact ? 38 : 42,
    padding: compact ? "9px 10px" : "10px 12px",
    background:T.input || "rgba(255,255,255,0.08)",
    color:T.text || "#f5f0e8",
    border:`1px solid ${T.border || "rgba(255,255,255,0.18)"}`,
    borderRadius:RADIUS.md,
    fontSize: compact ? FONT.sm.size : FONT.sm.size + 1,
    fontWeight:600,
    lineHeight:1.35,
  };
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : "auto", minWidth:0 }}>
      <label style={{ fontSize:compact ? FONT.xs.size + 2 : FONT.sm.size, color:T.textSub || T.text, textTransform:"none", letterSpacing:.15, fontWeight:900, display:"block", marginBottom:6, lineHeight:1.25 }}>{label}</label>
      {options ? (
        <select className="inv-sel" value={value || ""} onChange={e=>onChange(e.target.value)} style={controlStyle}>
          <option value="">—</option>{options.map(o=><option key={o} value={o}>{o}</option>)}
        </select>
      ) : type === "textarea" ? (
        <textarea className="inv-textarea" rows={compact ? 2 : 3} value={value || ""} placeholder={placeholder} onChange={e=>onChange(e.target.value)} style={{ ...controlStyle, minHeight:compact ? 58 : 82, resize:"vertical" }} />
      ) : (
        <input className="inv-inp" type={type} value={value || ""} placeholder={placeholder} onChange={e=>onChange(e.target.value)} style={{ ...controlStyle, textAlign:type === "number" ? "right" : "left" }} />
      )}
    </div>
  );
}

function StructurationPatrimoniale({ profil, T=THEMES_INV.dark, initialClientId }) {
  const [clients, setClients] = useState([]);
  const [dossiers, setDossiers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dossier, setDossier] = useState(null);
  const [data, setData] = useState(buildStructDefault(null));
  const [tab, setTab] = useState("audit");
  const [filter, setFilter] = useState("Tous");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [newClientId, setNewClientId] = useState(initialClientId || "");
  const [showClientCreator, setShowClientCreator] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    prenom:"",
    nom:"",
    email:"",
    telephone:"",
    conseiller:profil?.nom || "",
    source:"Structuration patrimoniale",
    statut:"Prospect",
  });
  const saveTimerRef = useRef(null);
  const initialHandledRef = useRef(false);
  const loadedDossierIdRef = useRef(null);
  const dataRef = useRef(data);
  const dossierRef = useRef(dossier);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { dossierRef.current = dossier; }, [dossier]);

  const fmtEur = (v) => {
    const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
    return n ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits:0 }).format(n) + " €" : "—";
  };
  const fmtPct = v => Number.isFinite(Number(v)) ? `${Math.round(Number(v) * 100)} %` : "—";
  const toN = (v) => Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")) || 0;
  const clientFullName = (c) => [c?.prenom, c?.nom].filter(Boolean).join(" ") || c?.email || "Client";
  const sortClientsByName = (list=[]) => [...list].sort((a,b) => clientFullName(a).localeCompare(clientFullName(b), "fr", { sensitivity:"base" }));
  const openClientCreator = () => {
    setNewClientForm(prev => ({
      prenom:"",
      nom:"",
      email:"",
      telephone:"",
      conseiller:prev.conseiller || profil?.nom || dossierRef.current?.conseiller || "",
      source:"Structuration patrimoniale",
      statut:"Prospect",
    }));
    setShowClientCreator(true);
  };
  const currentClient = clients.find(c => c.id === dossier?.client_id) || dossier?.client || null;

  const calc = useCallback((d = data) => {
    const lots = d.collecte?.patrimoine?.lots || [];
    const valeurLots = lots.reduce((s,l)=>s+toN(l.valeur),0);
    const loyers = lots.reduce((s,l)=>s+toN(l.loyer_mois),0);
    const mensualitesLots = lots.reduce((s,l)=>s+toN(l.mensualite),0);
    const crdLots = lots.reduce((s,l)=>s+toN(l.crd),0);
    const rpVal = toN(d.collecte?.patrimoine?.rp_valeur);
    const rpCrd = toN(d.collecte?.patrimoine?.rp_crd);
    const patrimoineFinancier = Object.values(d.collecte?.patrimoine_financier || {}).reduce((s,v)=>s+toN(v),0);
    const patrimoineBrut = valeurLots + rpVal + patrimoineFinancier;
    const crdTotal = crdLots + rpCrd;
    const patrimoineNet = patrimoineBrut - crdTotal;
    const revenusPro = toN(d.collecte?.profil?.revenus_nets_mois);
    const autresRevMois = (toN(d.collecte?.profil?.dividendes_an)+toN(d.collecte?.profil?.autres_revenus_an))/12;
    const revenusRetenus = revenusPro + autresRevMois + loyers * 0.70;
    const mensualitesTotal = toN(d.collecte?.financement?.mensualites_total) || mensualitesLots;
    const tauxEndettement = revenusRetenus ? mensualitesTotal / revenusRetenus : 0;
    const cashflowMois = loyers - mensualitesLots;
    const rendementBrut = valeurLots ? (loyers*12)/valeurLots : 0;
    const ltv = patrimoineBrut ? crdTotal / patrimoineBrut : 0;
    const ifiBase = Math.max(0, valeurLots + rpVal * 0.70 - crdTotal);
    const docs = d.collecte?.documents || [];
    const docsRecus = docs.filter(x=>["Reçu", "Validé", "À vérifier", "Non applicable"].includes(x.statut)).length;
    const docsObligatoires = docs.filter(x=>x.required);
    const docsObligatoiresOk = docsObligatoires.filter(x=>["Reçu", "Validé", "Non applicable"].includes(x.statut)).length;
    const required = [
      d.collecte?.profil?.nom, d.collecte?.profil?.prenom, d.collecte?.profil?.situation_familiale,
      d.collecte?.profil?.profession, d.collecte?.profil?.revenus_nets_mois, d.collecte?.profil?.tmi,
      d.collecte?.patrimoine?.lots?.some(l => toN(l.valeur) || toN(l.loyer_mois)),
      d.collecte?.financement?.banque_principale, d.collecte?.financement?.apport_disponible,
      d.collecte?.objectifs?.objectif_principal, d.collecte?.objectifs?.horizon, d.collecte?.qualification?.niveau_implication, d.collecte?.rdv?.prochaine_action,
      d.analyse?.diagnostic, d.analyse?.strategie_recommandee,
    ];
    const completion = Math.min(100, Math.round(((required.filter(Boolean).length / required.length) * 0.70 + (docsObligatoires.length ? docsObligatoiresOk/docsObligatoires.length : 0) * 0.30) * 100));
    const tarif = patrimoineBrut <= 500000 ? { phase1:2500, phase2:190, tranche:"0 à 500 k€" }
      : patrimoineBrut <= 1500000 ? { phase1:4500, phase2:390, tranche:"500 k€ à 1,5 M€" }
      : patrimoineBrut <= 5000000 ? { phase1:7500, phase2:590, tranche:"1,5 M€ à 5 M€" }
      : { phase1:10000, phase2:890, tranche:"+5 M€ — sur devis" };
    return { valeurLots, loyers, mensualitesLots, crdLots, rpVal, rpCrd, patrimoineFinancier, patrimoineBrut, crdTotal, patrimoineNet, revenusRetenus, tauxEndettement, cashflowMois, rendementBrut, ltv, ifiBase, docsRecus, docsObligatoires:docsObligatoires.length, docsObligatoiresOk, completion, tarif };
  }, [data]);

  const mergeStructData = (d) => {
    const base = buildStructDefault(d?.client || null);
    const incoming = d?.donnees || {};
    const merged = { ...base, ...incoming };
    merged.collecte = { ...base.collecte, ...(incoming.collecte || {}) };
    merged.collecte.profil = { ...base.collecte.profil, ...(incoming.collecte?.profil || {}) };
    merged.collecte.qualification = { ...base.collecte.qualification, ...(incoming.collecte?.qualification || {}) };
    merged.collecte.patrimoine = { ...base.collecte.patrimoine, ...(incoming.collecte?.patrimoine || {}) };
    merged.collecte.financement = { ...base.collecte.financement, ...(incoming.collecte?.financement || {}) };
    merged.collecte.structures = { ...base.collecte.structures, ...(incoming.collecte?.structures || {}) };
    merged.collecte.objectifs = { ...base.collecte.objectifs, ...(incoming.collecte?.objectifs || {}) };
    merged.collecte.patrimoine_financier = { ...base.collecte.patrimoine_financier, ...(incoming.collecte?.patrimoine_financier || {}) };
    merged.collecte.rdv = { ...base.collecte.rdv, ...(incoming.collecte?.rdv || {}) };
    const docIncoming = incoming.collecte?.documents || [];
    const docIndex = new Map(docIncoming.map(doc => [doc.id, doc]));
    merged.collecte.documents = STRUCT_DOCS_DEFAULT.map(doc => ({ ...doc, ...(docIndex.get(doc.id) || {}) })).concat(docIncoming.filter(doc => !STRUCT_DOCS_DEFAULT.some(baseDoc => baseDoc.id === doc.id)));
    merged.analyse = { ...base.analyse, ...(incoming.analyse || d?.analyse_data || {}) };
    if (!Array.isArray(merged.analyse.scenarios)) merged.analyse.scenarios = base.analyse.scenarios;
    if (!Array.isArray(merged.analyse.preconisations)) merged.analyse.preconisations = base.analyse.preconisations;
    return merged;
  };

  const charger = useCallback(async () => {
    setLoading(true); setError("");
    const [clientsRes, dossiersRes] = await Promise.all([
      supabase.from("invest_clients").select("*").order("nom"),
      supabase.from("invest_structuration_patrimoniale").select("*, client:invest_clients(*)").order("updated_at", { ascending:false }),
    ]);
    if (clientsRes.error) setError(clientsRes.error.message);
    if (dossiersRes.error) {
      setError("Table invest_structuration_patrimoniale introuvable ou non accessible. Lancez la migration SQL fournie.");
      setDossiers([]);
    } else {
      const list = dossiersRes.data || [];
      setDossiers(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
    }
    setClients(sortClientsByName(clientsRes.data || []));
    setLoading(false);
  }, [selectedId]);

  useEffect(() => { charger(); }, []);

  useEffect(() => {
    const d = dossiers.find(x => x.id === selectedId) || null;
    setDossier(d);
    dossierRef.current = d;
    if (!d) { loadedDossierIdRef.current = null; return; }
    if (loadedDossierIdRef.current === d.id) { setNewClientId(d.client_id || ""); return; }
    loadedDossierIdRef.current = d.id;
    const merged = mergeStructData(d);
    dataRef.current = merged;
    setData(merged);
    setNewClientId(d.client_id || "");
  }, [selectedId, dossiers]);

  const sauvegarder = useCallback(async () => {
    const currentDossier = dossierRef.current;
    const currentData = dataRef.current;
    if (!selectedId || !currentDossier) return;
    setSaving(true);
    const payload = {
      titre: currentDossier.titre,
      statut: currentDossier.statut,
      phase: currentDossier.phase,
      conseiller: currentDossier.conseiller,
      client_id: currentDossier.client_id || null,
      donnees: currentData,
      analyse_data: currentData.analyse || {},
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await supabase.from("invest_structuration_patrimoniale").update(payload).eq("id", selectedId).select("*, client:invest_clients(*)").single();
    setSaving(false);
    if (error) { setError("Impossible d'enregistrer : " + error.message); return; }
    setError("");
    setSaved(true); setTimeout(()=>setSaved(false), 1600);
    if (updated) {
      const hydrated = { ...updated, donnees: currentData, analyse_data: currentData.analyse || {} };
      setDossiers(prev => prev.map(x => x.id === selectedId ? hydrated : x));
      setDossier(hydrated);
      dossierRef.current = hydrated;
    }
  }, [selectedId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => sauvegarder(), 850);
  }, [sauvegarder]);
  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const mutateData = useCallback((updater) => {
    setData(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      dataRef.current = next;
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const patchDossier = (fields) => {
    setDossier(prev => {
      const next = prev ? { ...prev, ...fields } : prev;
      dossierRef.current = next;
      return next;
    });
    setDossiers(prev => prev.map(x => x.id === selectedId ? { ...x, ...fields } : x));
    scheduleSave();
  };

  const updateSection = (section, key, value) => {
    mutateData(prev => ({
      ...prev,
      collecte: { ...prev.collecte, [section]: { ...(prev.collecte?.[section] || {}), [key]: value } }
    }));
  };
  const updateAnalyse = (key, value) => mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), [key]:value } }));
  const updateLot = (idx, key, value) => mutateData(prev => {
    const lots = [...(prev.collecte?.patrimoine?.lots || [])];
    lots[idx] = { ...(lots[idx] || {}), [key]:value };
    return { ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots } } };
  });
  const addLot = () => mutateData(prev => ({ ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots:[...(prev.collecte?.patrimoine?.lots || []), { ...STRUCT_DEFAULT_LOTS[0], id:`lot-${Date.now()}` }] } } }));
  const removeLot = (idx) => { if (!window.confirm("Supprimer ce lot ?")) return; mutateData(prev => ({ ...prev, collecte:{ ...prev.collecte, patrimoine:{ ...(prev.collecte?.patrimoine || {}), lots:(prev.collecte?.patrimoine?.lots || []).filter((_,i)=>i!==idx) } } })); };
  const updateDoc = (idx, key, value) => mutateData(prev => {
    const docs = [...(prev.collecte?.documents || [])];
    docs[idx] = { ...(docs[idx] || {}), [key]:value };
    return { ...prev, collecte:{ ...prev.collecte, documents:docs } };
  });
  const updateScenario = (idx, key, value) => mutateData(prev => {
    const scenarios = [...(prev.analyse?.scenarios || [])];
    scenarios[idx] = { ...(scenarios[idx] || {}), [key]:value };
    return { ...prev, analyse:{ ...(prev.analyse || {}), scenarios } };
  });
  const updateReco = (idx, key, value) => mutateData(prev => {
    const preconisations = [...(prev.analyse?.preconisations || [])];
    preconisations[idx] = { ...(preconisations[idx] || {}), [key]:value };
    return { ...prev, analyse:{ ...(prev.analyse || {}), preconisations } };
  });
  const addReco = () => mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), preconisations:[...(prev.analyse?.preconisations || []), { id:`p${Date.now()}`, axe:"Stratégie", priorite:"Moyenne", titre:"Nouvelle préconisation", detail:"", action:"", statut:"À faire" }] } }));
  const removeReco = (idx) => { if (!window.confirm("Supprimer cette préconisation ?")) return; mutateData(prev => ({ ...prev, analyse:{ ...(prev.analyse || {}), preconisations:(prev.analyse?.preconisations || []).filter((_,i)=>i!==idx) } })); };

  const fillStructEmpty = (current = {}, prefill = {}) => {
    const out = { ...(current || {}) };
    Object.entries(prefill || {}).forEach(([k,v]) => {
      if (v === null || v === undefined || v === "") return;
      if (out[k] === null || out[k] === undefined || out[k] === "") out[k] = v;
    });
    return out;
  };

  const reintegrerInfosClientCRM = useCallback(() => {
    const clientId = dossierRef.current?.client_id || newClientId;
    if (!clientId) { alert("Sélectionnez d’abord un client."); return; }
    const client = clients.find(x => x.id === clientId);
    if (!client) { alert("Client introuvable dans le CRM."); return; }
    const base = buildStructDefault(client);
    mutateData(prev => {
      const currentProfil = prev.collecte?.profil || {};
      const baseProfil = base.collecte.profil || {};
      return {
        ...prev,
        collecte: {
          ...prev.collecte,
          profil: { ...fillStructEmpty(currentProfil, baseProfil), prenom:baseProfil.prenom || currentProfil.prenom || "", nom:baseProfil.nom || currentProfil.nom || "", email:baseProfil.email || currentProfil.email || "", telephone:baseProfil.telephone || currentProfil.telephone || "", conseiller:baseProfil.conseiller || currentProfil.conseiller || "", source_crm:baseProfil.source_crm || currentProfil.source_crm || "", statut_crm:baseProfil.statut_crm || currentProfil.statut_crm || "", budget_crm:baseProfil.budget_crm || currentProfil.budget_crm || "", etape_crm:baseProfil.etape_crm || currentProfil.etape_crm || "", notes_crm:baseProfil.notes_crm || currentProfil.notes_crm || "" },
          financement: fillStructEmpty(prev.collecte?.financement || {}, base.collecte.financement || {}),
          structures: fillStructEmpty(prev.collecte?.structures || {}, base.collecte.structures || {}),
          objectifs: fillStructEmpty(prev.collecte?.objectifs || {}, base.collecte.objectifs || {}),
          rdv: fillStructEmpty(prev.collecte?.rdv || {}, base.collecte.rdv || {}),
        },
      };
    });
  }, [clients, newClientId, mutateData]);

  const creerDossier = async (clientId = newClientId, clientOverride = null) => {
    if (!clientId) { alert("Sélectionnez un client avant de créer un dossier."); return; }
    const existing = dossiers.find(d => d.client_id === clientId);
    if (existing && window.confirm("Un dossier existe déjà pour ce client. L’ouvrir ?")) { setSelectedId(existing.id); return; }
    const c = clientOverride || clients.find(x => x.id === clientId);
    const base = buildStructDefault(c);
    const payload = {
      client_id: clientId,
      titre: `Structuration patrimoniale — ${clientFullName(c)}`,
      statut: "Collecte",
      phase: "Phase 1 — Audit & Conseil",
      conseiller: profil?.nom || c?.conseiller || "",
      donnees: base,
      analyse_data: base.analyse,
      created_by: profil?.email || profil?.nom || null,
      updated_at: new Date().toISOString(),
    };
    const { data: created, error } = await supabase.from("invest_structuration_patrimoniale").insert(payload).select("*, client:invest_clients(*)").single();
    if (error) { alert("Impossible de créer le dossier : " + error.message); return; }
    setDossiers(prev => [created, ...prev]);
    loadedDossierIdRef.current = null;
    setSelectedId(created.id);
    setTab("audit");
  };

  const creerClientEtDossier = async () => {
    const form = {
      prenom:String(newClientForm.prenom || "").trim(),
      nom:String(newClientForm.nom || "").trim(),
      email:String(newClientForm.email || "").trim(),
      telephone:String(newClientForm.telephone || "").trim(),
      conseiller:String(newClientForm.conseiller || profil?.nom || "").trim(),
      source:String(newClientForm.source || "Structuration patrimoniale").trim(),
      statut:String(newClientForm.statut || "Prospect").trim(),
    };
    if (!form.prenom && !form.nom && !form.email) {
      alert("Renseignez au minimum un prénom, un nom ou un email pour créer le client.");
      return;
    }
    setCreatingClient(true);
    setError("");

    const now = new Date().toISOString();
    const payloads = [
      { ...form, etape:"1 Signature contrat", notes_rapides:"Client créé depuis l'onglet Structuration patrimoniale", updated_at:now },
      { prenom:form.prenom, nom:form.nom, email:form.email, telephone:form.telephone, conseiller:form.conseiller, source:form.source, statut:form.statut, updated_at:now },
      { prenom:form.prenom, nom:form.nom, email:form.email, telephone:form.telephone, conseiller:form.conseiller },
      { prenom:form.prenom, nom:form.nom, email:form.email },
    ];

    let created = null;
    let lastError = null;
    for (const payload of payloads) {
      const cleaned = Object.fromEntries(Object.entries(payload).filter(([,v]) => v !== undefined && v !== null && v !== ""));
      const { data: inserted, error: insertError } = await supabase.from("invest_clients").insert(cleaned).select("*").single();
      if (!insertError && inserted) {
        created = inserted;
        break;
      }
      lastError = insertError;
      const msg = String(insertError?.message || "");
      const canRetryWithSmallerPayload = /column|schema cache|Could not find|PGRST204|violates not-null constraint/i.test(msg);
      if (!canRetryWithSmallerPayload) break;
    }

    setCreatingClient(false);
    if (!created) {
      setError("Impossible de créer le client : " + (lastError?.message || "erreur inconnue"));
      return;
    }

    setClients(prev => sortClientsByName([created, ...prev.filter(x => x.id !== created.id)]));
    setNewClientId(created.id);
    setShowClientCreator(false);
    setNewClientForm({
      prenom:"",
      nom:"",
      email:"",
      telephone:"",
      conseiller:profil?.nom || "",
      source:"Structuration patrimoniale",
      statut:"Prospect",
    });
    await creerDossier(created.id, created);
  };

  const supprimerDossier = async (id) => {
    const target = dossiers.find(d => d.id === id);
    if (!target) return;
    const label = target.client ? clientFullName(target.client) : (target.titre || "ce dossier");
    const ok = window.confirm(`Supprimer définitivement le dossier de structuration de ${label} ?\n\nCette action supprimera le dossier et ses données d'analyse. Les documents associés seront également supprimés si le bucket est accessible.`);
    if (!ok) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaving(true); setError("");
    try {
      const bucket = supabase.storage.from("invest-documents");
      const folder = `structuration/${id}`;
      const { data: files } = await bucket.list(folder);
      if (Array.isArray(files) && files.length > 0) await bucket.remove(files.map(f => `${folder}/${f.name}`));
    } catch (e) { console.warn("Suppression documents impossible", e); }
    const { error } = await supabase.from("invest_structuration_patrimoniale").delete().eq("id", id);
    setSaving(false);
    if (error) { setError("Impossible de supprimer le dossier : " + error.message); return; }
    const remaining = dossiers.filter(d => d.id !== id);
    setDossiers(remaining);
    if (selectedId === id) { loadedDossierIdRef.current = null; setSelectedId(remaining[0]?.id || null); }
  };

  useEffect(() => {
    if (!initialClientId || initialHandledRef.current || loading) return;
    initialHandledRef.current = true;
    const existing = dossiers.find(d => d.client_id === initialClientId);
    if (existing) setSelectedId(existing.id);
    else { setNewClientId(initialClientId); setTimeout(() => creerDossier(initialClientId), 80); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, loading, dossiers.length]);

  const filteredDossiers = dossiers.filter(d => filter === "Tous" || d.statut === filter);
  const c = calc();
  const p = data.collecte?.profil || {};
  const q = data.collecte?.qualification || {};
  const pat = data.collecte?.patrimoine || {};
  const fin = data.collecte?.financement || {};
  const st = data.collecte?.structures || {};
  const obj = data.collecte?.objectifs || {};
  const pf = data.collecte?.patrimoine_financier || {};
  const rdv = data.collecte?.rdv || {};
  const docs = data.collecte?.documents || [];
  const lots = pat.lots || [];

  const statusColors = {
    "Collecte": { bg:SEMANTIC.info.bg, color:SEMANTIC.info.color, border:SEMANTIC.info.border },
    "Analyse": { bg:SEMANTIC.warning.bg, color:SEMANTIC.warning.color, border:SEMANTIC.warning.border },
    "Préconisations": { bg:T.accentBg, color:T.accent, border:T.accentBorder },
    "Restitution": { bg:SEMANTIC.success.bg, color:SU, border:SEMANTIC.success.border },
    "Phase 2": { bg:"rgba(80,200,120,0.10)", color:SU, border:"rgba(80,200,120,0.25)" },
    "Terminé": { bg:T.input, color:T.textMuted, border:T.border },
  };
  const chipStyle = (status) => ({ fontSize:FONT.xs.size, fontWeight:800, padding:"3px 8px", borderRadius:999, background:statusColors[status]?.bg || T.input, color:statusColors[status]?.color || T.textSub, border:`1px solid ${statusColors[status]?.border || T.border}`, display:"inline-flex", alignItems:"center", gap:4 });
  const cardStyle = { background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl, boxShadow:T.shadow, overflow:"hidden" };
  const cardHd = (label, tone="") => <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, background:tone === "gold" ? T.accentBg : "rgba(255,255,255,0.025)", color:tone === "gold" ? T.accent : T.text, fontWeight:950, letterSpacing:.15, textTransform:"none", fontSize:FONT.md.size, lineHeight:1.25 }}>{label}</div>;
  const kpi = (label, value, sub, tone="") => <div style={{ ...cardStyle, padding:"15px 16px", borderLeft:`4px solid ${tone === "gold" ? T.accent : tone === "red" ? DA : tone === "green" ? SU : T.accentBorder}` }}><div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:FONT.h2.size, fontWeight:850, color:T.text, lineHeight:1.05 }}>{value}</div><div style={{ color:T.textSub || T.textMuted, fontSize:FONT.xs.size+1, textTransform:"none", letterSpacing:.2, fontWeight:900, marginTop:4 }}>{label}</div>{sub && <div style={{ color:T.textSub, fontSize:FONT.xs.size+2, marginTop:5, lineHeight:1.35 }}>{sub}</div>}</div>;

  const renderProgress = (pct, height=5) => <div style={{ width:"100%", height, background:T.input, borderRadius:999, overflow:"hidden" }}><div style={{ width:`${Math.max(0, Math.min(100, pct || 0))}%`, height:"100%", background:T.accent, borderRadius:999 }}/></div>;

  const renderClientCreator = () => !showClientCreator ? null : (
    <div style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(0,0,0,0.58)", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ ...cardStyle, width:"min(720px, 96vw)", background:T.card, boxShadow:"0 24px 80px rgba(0,0,0,0.45)" }}>
        <div style={{ padding:"18px 20px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", gap:16, alignItems:"flex-start", background:T.sidebar }}>
          <div>
            <div style={{ color:T.text, fontSize:FONT.xl.size, fontWeight:950, lineHeight:1.15 }}>Créer un nouveau client</div>
            <div style={{ color:T.textSub, fontSize:FONT.sm.size, marginTop:4 }}>Le client sera ajouté au CRM puis un dossier de structuration sera ouvert automatiquement.</div>
          </div>
          <button className="inv-btn inv-btn-sm" onClick={()=>setShowClientCreator(false)} style={{ background:"rgba(255,255,255,0.06)", color:T.textSub, border:`1px solid ${T.border}` }}><Icon as={X} size={14}/></button>
        </div>
        <div style={{ padding:20, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:14 }}>
          <StructField T={T} label="Prénom" value={newClientForm.prenom} onChange={v=>setNewClientForm(prev=>({...prev, prenom:v}))} />
          <StructField T={T} label="Nom" value={newClientForm.nom} onChange={v=>setNewClientForm(prev=>({...prev, nom:v}))} />
          <StructField T={T} label="Email" type="email" value={newClientForm.email} onChange={v=>setNewClientForm(prev=>({...prev, email:v}))} />
          <StructField T={T} label="Téléphone" value={newClientForm.telephone} onChange={v=>setNewClientForm(prev=>({...prev, telephone:v}))} />
          <StructField T={T} label="Conseiller référent" value={newClientForm.conseiller} onChange={v=>setNewClientForm(prev=>({...prev, conseiller:v}))} />
          <StructField T={T} label="Source" value={newClientForm.source} onChange={v=>setNewClientForm(prev=>({...prev, source:v}))} options={["Structuration patrimoniale","Recommandation","Réseau personnel","Site web","Événement","Partenaire","Autre"]} />
          <StructField T={T} label="Statut CRM" value={newClientForm.statut} onChange={v=>setNewClientForm(prev=>({...prev, statut:v}))} options={["Prospect","Client","À recontacter","En cours","Perdu"]} />
          <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"flex-end", gap:10 }}>
            <button className="inv-btn" onClick={()=>setShowClientCreator(false)} style={{ background:T.input, color:T.textSub, border:`1px solid ${T.border}` }}>Annuler</button>
            <button className="inv-btn inv-btn-gold" onClick={creerClientEtDossier} disabled={creatingClient}>
              {creatingClient ? <><Icon as={RefreshCw} size={13} style={{animation:"spin 1s linear infinite"}}/> Création…</> : <><Icon as={Plus} size={14}/> Créer client + dossier</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSidebarDossiers = () => (
    <div style={{ background:T.sidebar, borderRadius:RADIUS.xl, overflow:"hidden", border:`1px solid ${T.sidebarBorder}`, height:"100%", minHeight:0, display:"flex", flexDirection:"column" }}>
      <div style={{ padding:"20px 18px 16px", borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:22, color:T.text, fontWeight:500 }}>Profero Invest</div>
        <div style={{ fontSize:FONT.xs.size, letterSpacing:2.4, textTransform:"uppercase", color:T.accent, marginTop:2 }}>Gestion des dossiers</div>
      </div>
      <div style={{ padding:14, borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 38px", gap:7 }}>
          <select className="inv-sel" value={newClientId} onChange={e=>setNewClientId(e.target.value)} style={{ minWidth:0 }}>
            <option value="">Créer un dossier depuis un client CRM…</option>
            {clients.map(c=><option key={c.id} value={c.id}>{clientFullName(c)}</option>)}
          </select>
          <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>creerDossier()} title="Créer le dossier"><Icon as={Plus} size={13}/></button>
        </div>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={openClientCreator} style={{ width:"100%", marginTop:8, justifyContent:"center" }}><Icon as={Users} size={13}/> Nouveau client</button>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:5, marginTop:10 }}>
          {["Tous","Collecte","Analyse","Phase 2"].map(f => <button key={f} onClick={()=>setFilter(f)} style={{ border:`1px solid ${filter === f ? T.accentBorder : T.sidebarBorder}`, background:filter === f ? T.accentBg : "rgba(255,255,255,0.03)", color:filter === f ? T.accent : T.textMuted, borderRadius:RADIUS.sm+2, fontSize:FONT.xs.size, padding:"6px 2px", cursor:"pointer", fontWeight:800 }}>{f}</button>)}
        </div>
      </div>
      <div style={{ padding:12, overflowY:"auto", flex:1 }}>
        {loading ? <div style={{ color:T.textMuted, padding:18, textAlign:"center" }}>Chargement…</div> : filteredDossiers.length === 0 ? <div style={{ color:T.textMuted, textAlign:"center", padding:24, lineHeight:1.6 }}>Aucun dossier<br/>dans ce filtre</div> : filteredDossiers.map(d => {
          const active = d.id === selectedId;
          const metaData = mergeStructData(d);
          const cc = calc(metaData);
          return <button key={d.id} onClick={()=>{ setSelectedId(d.id); setTab("audit"); }} style={{ width:"100%", textAlign:"left", border:`1px solid ${active ? T.accentBorder : "transparent"}`, background:active ? T.accentBg : "transparent", borderRadius:RADIUS.md, padding:"11px 11px", marginBottom:8, cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"flex-start" }}>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ color:active ? T.accent : T.text, fontWeight:900, fontSize:FONT.sm.size+1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.client ? clientFullName(d.client) : d.titre || "Nouveau dossier"}</div>
                <div style={{ color:T.textMuted, fontSize:FONT.xs.size, marginTop:2 }}>{d.conseiller || "Sans conseiller"} · {new Date(d.updated_at || d.created_at).toLocaleDateString("fr-FR")}</div>
              </div>
              <span style={chipStyle(d.statut || "Collecte")}>{d.statut || "Collecte"}</span>
            </div>
            <div style={{ marginTop:8 }}>{renderProgress(cc.completion, 3)}</div>
            <div style={{ marginTop:5, color:T.textMuted, fontSize:FONT.xs.size }}>{cc.completion} % complété</div>
          </button>;
        })}
      </div>
    </div>
  );

  const renderListView = () => {
    const count = (status) => dossiers.filter(d => d.statut === status).length;
    const avgCompletion = dossiers.length ? Math.round(dossiers.reduce((s,d)=>s+calc(mergeStructData(d)).completion,0)/dossiers.length) : 0;
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:SPACING.md, ...cardStyle, padding:"18px 20px" }}>
        <div>
          <div style={{ fontSize:FONT.h2.size, fontWeight:900, color:T.text }}>Tableau de bord structuration</div>
          <div style={{ color:T.textSub, fontSize:FONT.sm.size }}>Pilotage des missions de collecte, analyse, restitution et suivi patrimonial</div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          <button className="inv-btn inv-btn-blue" onClick={openClientCreator}><Icon as={Users} size={14}/> Nouveau client</button>
          <button className="inv-btn inv-btn-gold" onClick={()=>newClientId ? creerDossier() : alert("Sélectionnez un client dans la colonne de gauche ou créez un nouveau client.")}><Icon as={Plus} size={14}/> Nouveau dossier</button>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Dossiers total", dossiers.length, "Portefeuille structuration")}
        {kpi("En collecte", count("Collecte"), "Données & documents")}
        {kpi("En analyse", count("Analyse") + count("Préconisations"), "Stratégie à formaliser", "gold")}
        {kpi("Complétude moyenne", `${avgCompletion} %`, "Qualité des dossiers", avgCompletion > 70 ? "green" : "red")}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:SPACING.md }}>
        {dossiers.map(d => {
          const md = mergeStructData(d);
          const cc = calc(md);
          const initials = ((d.client?.prenom || md.collecte?.profil?.prenom || "?")[0] + (d.client?.nom || md.collecte?.profil?.nom || "?")[0]).toUpperCase();
          return <button key={d.id} onClick={()=>{ setSelectedId(d.id); setTab("audit"); }} style={{ ...cardStyle, padding:16, textAlign:"left", cursor:"pointer", fontFamily:"inherit" }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
              <div style={{ width:42, height:42, borderRadius:"50%", background:T.accentBg, color:T.accent, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900 }}>{initials}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:900, color:T.text, fontSize:FONT.md.size }}>{d.client ? clientFullName(d.client) : d.titre}</div>
                <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1 }}>{d.conseiller || "Sans conseiller"}</div>
              </div>
              <span style={chipStyle(d.statut || "Collecte")}>{d.statut || "Collecte"}</span>
            </div>
            <div style={{ marginTop:14, display:"flex", justifyContent:"space-between", color:T.textMuted, fontSize:FONT.xs.size, fontWeight:800 }}><span>Progression</span><span>{cc.completion} %</span></div>
            <div style={{ marginTop:5 }}>{renderProgress(cc.completion, 5)}</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12, color:T.textSub, fontSize:FONT.xs.size+1 }}>
              <span>Patrimoine : <b style={{ color:T.text }}>{fmtEur(cc.patrimoineBrut)}</b></span>
              <span>Docs : <b style={{ color:T.text }}>{cc.docsRecus}/{docs.length || STRUCT_DOCS_DEFAULT.length}</b></span>
            </div>
          </button>;
        })}
      </div>
    </div>;
  };

  const renderDossierHeader = () => (
    <div style={{ ...cardStyle, overflow:"hidden" }}>
      <div style={{ background:T.sidebar, padding:"16px 18px", display:"flex", alignItems:"center", gap:SPACING.md, borderBottom:`1px solid ${T.sidebarBorder}` }}>
        <button className="inv-btn inv-btn-sm" onClick={()=>setSelectedId(null)} style={{ background:"rgba(255,255,255,0.06)", color:T.textSub, border:`1px solid ${T.sidebarBorder}` }}><Icon as={ArrowLeft} size={13}/> Dossiers</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:25, fontWeight:500, color:T.text, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{currentClient ? clientFullName(currentClient) : (dossier?.titre || "Dossier structuration")}</div>
          <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1, marginTop:2 }}>{dossier?.phase || "Phase 1"} · Créé le {dossier?.created_at ? new Date(dossier.created_at).toLocaleDateString("fr-FR") : "—"}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {saving && <span style={{ color:T.accent, fontSize:FONT.xs.size, fontWeight:800 }}><Icon as={RefreshCw} size={12} style={{animation:"spin 1s linear infinite"}}/> Enregistrement…</span>}
          {saved && <span style={{ color:SU, fontSize:FONT.xs.size, fontWeight:900 }}><Icon as={Check} size={13}/> Sauvegardé</span>}
          <select className="inv-sel" value={dossier?.statut || "Collecte"} onChange={e=>patchDossier({ statut:e.target.value })} style={{ minWidth:140 }}>{STRUCT_STATUTS.map(s=><option key={s} value={s}>{s}</option>)}</select>
          <select className="inv-sel" value={dossier?.phase || "Phase 1 — Audit & Conseil"} onChange={e=>patchDossier({ phase:e.target.value })} style={{ minWidth:210 }}>{STRUCT_PHASES.map(s=><option key={s} value={s}>{s}</option>)}</select>
          <button className="inv-btn inv-btn-blue" onClick={reintegrerInfosClientCRM} disabled={!dossier?.client_id}><Icon as={RefreshCw} size={13}/> Réimporter CRM</button>
          <button className="inv-btn inv-btn-gold" onClick={()=>sauvegarder()}><Icon as={Save} size={13}/> Enregistrer</button>
          <button className="inv-btn inv-btn-sm" onClick={()=>supprimerDossier(dossier.id)} style={{ background:SEMANTIC.danger.bg, color:DA, border:`1px solid ${SEMANTIC.danger.border}` }}><Icon as={Trash2} size={13}/></button>
        </div>
      </div>
      <div style={{ padding:"14px 18px", display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Patrimoine brut", fmtEur(c.patrimoineBrut), c.tarif.tranche)}
        {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `LTV ${fmtPct(c.ltv)}`)}
        {kpi("Cash-flow locatif", `${fmtEur(c.cashflowMois)}/mois`, `Loyers ${fmtEur(c.loyers)}/mois`, c.cashflowMois >= 0 ? "green" : "red")}
        {kpi("Endettement indicatif", fmtPct(c.tauxEndettement), "Lecture bancaire à qualifier", c.tauxEndettement > 0.35 ? "red" : "green")}
        {kpi("Mission Phase 1", fmtEur(c.tarif.phase1), `Phase 2 ${fmtEur(c.tarif.phase2)}/mois`, "gold")}
      </div>
      <div style={{ padding:"0 18px 16px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", color:T.textMuted, fontSize:FONT.xs.size, marginBottom:6, fontWeight:800 }}><span>Progression du dossier</span><span>{c.completion} %</span></div>
        {renderProgress(c.completion, 6)}
      </div>
    </div>
  );

  const tabItems = [
    { id:"audit", label:"Audit · Collecte de données" },
    { id:"profil", label:"Profil patrimonial" },
    { id:"patrimoine", label:"Patrimoine & financement" },
    { id:"documents", label:"Documents" },
    { id:"analyse", label:"Analyse & préconisations" },
  ];
  const renderTabs = () => <div style={{ ...cardStyle, display:"flex", gap:0, padding:"0 14px", overflowX:"auto", flexShrink:0 }}>{tabItems.map(t => <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"12px 14px", border:"none", borderBottom:`2px solid ${tab === t.id ? T.accent : "transparent"}`, background:tab === t.id ? T.accentBg : "transparent", color:tab === t.id ? T.text : T.textSub, cursor:"pointer", fontFamily:"inherit", fontWeight:900, fontSize:FONT.sm.size, whiteSpace:"nowrap" }}>{t.label}</button>)}</div>;

  const renderAudit = () => {
    const fieldProps = { T, compact:true };
    const criticalDocs = docs.filter(doc => doc.required).slice(0, 12);
    const auditKpis = [
      ["Patrimoine brut déclaré", fmtEur(c.patrimoineBrut)],
      ["Patrimoine net estimé", fmtEur(c.patrimoineNet)],
      ["Taux d'endettement", fmtPct(c.tauxEndettement)],
      ["Pièces indispensables", `${c.docsObligatoiresOk}/${c.docsObligatoires}`],
    ];
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:SPACING.md }}>
        {auditKpis.map(([lab,val],i)=><div key={lab} style={{ ...cardStyle, padding:"12px 14px", borderTop:`3px solid ${i===2 && c.tauxEndettement > .35 ? DA : T.accent}` }}><div style={{ color:T.textMuted, fontSize:FONT.xs.size, textTransform:"uppercase", fontWeight:900, letterSpacing:.7 }}>{lab}</div><div style={{ color:T.text, fontSize:FONT.xl.size, fontWeight:900, marginTop:5 }}>{val}</div></div>)}
      </div>
      <div style={{ ...cardStyle, padding:"11px 14px", borderLeft:`4px solid ${T.accent}`, background:T.accentBg }}>
        <div style={{ color:T.text, fontWeight:900, fontSize:FONT.sm.size }}>Trame de rendez-vous patrimonial immobilier</div>
        <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginTop:3 }}>Renseignez dans l'ordre : qualification → foyer → revenus/fiscalité → objectifs → patrimoine déclaré → alertes et suite. Les données alimentent automatiquement les onglets Profil patrimonial, Patrimoine & financement et Analyse.</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:SPACING.md, alignItems:"start" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("01 — Cadre du rendez-vous & origine du lead", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Date du R1" type="date" value={q.date_r1} onChange={v=>updateSection("qualification","date_r1",v)} />
            <StructField {...fieldProps} label="Conseiller référent" value={p.conseiller || dossier?.conseiller} onChange={v=>updateSection("profil","conseiller",v)} />
            <StructField {...fieldProps} label="Source du lead" value={q.source_lead} onChange={v=>updateSection("qualification","source_lead",v)} options={["Recommandation","Réseau personnel","Site web","Événement","Partenaire","Autre"]} />
            <StructField {...fieldProps} label="Prescripteur" value={q.prescripteur} onChange={v=>updateSection("qualification","prescripteur",v)} />
            <StructField {...fieldProps} label="Contexte / origine de la demande" type="textarea" value={q.origine_commentaire} onChange={v=>updateSection("qualification","origine_commentaire",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("02 — Identité, famille & protection", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Prénom" value={p.prenom} onChange={v=>updateSection("profil","prenom",v)} />
            <StructField {...fieldProps} label="Nom" value={p.nom} onChange={v=>updateSection("profil","nom",v)} />
            <StructField {...fieldProps} label="Date de naissance" type="date" value={p.date_naissance} onChange={v=>updateSection("profil","date_naissance",v)} />
            <StructField {...fieldProps} label="Situation familiale" value={p.situation_familiale} onChange={v=>updateSection("profil","situation_familiale",v)} options={["Célibataire","Marié(e)","Pacsé(e)","Divorcé(e)","Concubinage","Veuf/veuve"]} />
            <StructField {...fieldProps} label="Régime matrimonial" value={p.regime_matrimonial} onChange={v=>updateSection("profil","regime_matrimonial",v)} options={["Communauté réduite aux acquêts","Séparation de biens","Participation aux acquêts","Communauté universelle","Non applicable"]} />
            <StructField {...fieldProps} label="Contrat mariage / PACS" value={p.contrat_mariage} onChange={v=>updateSection("profil","contrat_mariage",v)} options={["Oui","Non","À vérifier","Non applicable"]} />
            <StructField {...fieldProps} label="Enfants à charge" type="number" value={p.enfants} onChange={v=>updateSection("profil","enfants",v)} />
            <StructField {...fieldProps} label="Détail enfants / transmission" value={p.enfants_details} onChange={v=>updateSection("profil","enfants_details",v)} wide />
            <StructField {...fieldProps} label="Adresse" value={p.adresse} onChange={v=>updateSection("profil","adresse",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("03 — Activité, revenus & fiscalité", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Profession / fonction" value={p.profession} onChange={v=>updateSection("profil","profession",v)} />
            <StructField {...fieldProps} label="Statut professionnel" value={p.statut_pro} onChange={v=>updateSection("profil","statut_pro",v)} options={["Salarié CDI","Salarié CDD","TNS / Indépendant","Chef d'entreprise","Profession libérale","Fonctionnaire","Retraité","Autre"]} />
            <StructField {...fieldProps} label="Employeur / secteur" value={p.employeur} onChange={v=>updateSection("profil","employeur",v)} />
            <StructField {...fieldProps} label="Revenus client / mois" type="number" value={p.revenus_nets_mois} onChange={v=>updateSection("profil","revenus_nets_mois",v)} />
            <StructField {...fieldProps} label="Revenus conjoint / mois" type="number" value={p.revenus_conjoint_mois} onChange={v=>updateSection("profil","revenus_conjoint_mois",v)} />
            <StructField {...fieldProps} label="Revenus locatifs nets / mois" type="number" value={p.revenus_locatifs_nets_mois} onChange={v=>updateSection("profil","revenus_locatifs_nets_mois",v)} />
            <StructField {...fieldProps} label="Dividendes / an" type="number" value={p.dividendes_an} onChange={v=>updateSection("profil","dividendes_an",v)} />
            <StructField {...fieldProps} label="Impôt sur le revenu N-1" type="number" value={p.impot_revenu} onChange={v=>updateSection("profil","impot_revenu",v)} />
            <StructField {...fieldProps} label="TMI estimée" value={p.tmi} onChange={v=>updateSection("profil","tmi",v)} options={["0 %","11 %","30 %","41 %","45 %","À vérifier"]} />
            <StructField {...fieldProps} label="Régime revenus locatifs" value={p.regime_locatif} onChange={v=>updateSection("profil","regime_locatif",v)} options={["Micro-foncier","Foncier réel","LMNP micro-BIC","LMNP réel","LMP","SCI IS","Non applicable"]} />
            <StructField {...fieldProps} label="IFI" value={p.ifi} onChange={v=>updateSection("profil","ifi",v)} options={["Non assujetti","Assujetti","Proche du seuil","À vérifier"]} />
            <StructField {...fieldProps} label="Déficits / dispositifs actifs" value={p.dispositifs_fiscaux} onChange={v=>updateSection("profil","dispositifs_fiscaux",v)} wide />
          </div></div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("04 — Objectifs & critères de stratégie", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Revenus complémentaires","Constitution patrimoine","Retraite","Défiscalisation","Transmission","Accélération patrimoniale","Mix"]} />
            <StructField {...fieldProps} label="Horizon d'investissement" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["Court terme < 5 ans","Moyen terme 5-15 ans","Long terme > 15 ans","À définir"]} />
            <StructField {...fieldProps} label="Budget acquisition min." type="number" value={q.budget_min} onChange={v=>updateSection("qualification","budget_min",v)} />
            <StructField {...fieldProps} label="Budget acquisition max." type="number" value={q.budget_max} onChange={v=>updateSection("qualification","budget_max",v)} />
            <StructField {...fieldProps} label="Type de bien visé" value={q.type_bien_vise} onChange={v=>updateSection("qualification","type_bien_vise",v)} options={["Appartement","Maison","Immeuble de rapport","Local commercial","SCPI","Pas de préférence"]} />
            <StructField {...fieldProps} label="Zone géographique" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} />
            <StructField {...fieldProps} label="Niveau de levier" value={q.niveau_levier} onChange={v=>updateSection("qualification","niveau_levier",v)} options={["Faible < 70 % LTV","Standard 70-80 %","Élevé > 80 %","Sans préférence"]} />
            <StructField {...fieldProps} label="Niveau d'implication" value={q.niveau_implication} onChange={v=>updateSection("qualification","niveau_implication",v)} options={["Autonome","Accompagné","Clé-en-main"]} />
            <StructField {...fieldProps} label="Projets à 3-5 ans" type="textarea" value={obj.projets_3_5_ans} onChange={v=>updateSection("objectifs","projets_3_5_ans",v)} wide />
          </div></div>
          <div style={cardStyle}>{cardHd("05 — Photo patrimoniale déclarative", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Statut résidence principale" value={pat.residence_principale_statut} onChange={v=>updateSection("patrimoine","residence_principale_statut",v)} options={["Propriétaire — crédit en cours","Propriétaire — crédit soldé","Locataire","Hébergé(e)"]} />
            <StructField {...fieldProps} label="Valeur résidence principale" type="number" value={pat.rp_valeur} onChange={v=>updateSection("patrimoine","rp_valeur",v)} />
            <StructField {...fieldProps} label="CRD résidence principale" type="number" value={pat.rp_crd} onChange={v=>updateSection("patrimoine","rp_crd",v)} />
            <StructField {...fieldProps} label="Épargne liquide disponible" type="number" value={pf.liquidites} onChange={v=>updateSection("patrimoine_financier","liquidites",v)} />
            <StructField {...fieldProps} label="Apport mobilisable" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)} />
            <StructField {...fieldProps} label="Mensualités crédits en cours" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)} />
            <StructField {...fieldProps} label="Charges fixes mensuelles" type="number" value={q.charges_fixes_mois} onChange={v=>updateSection("qualification","charges_fixes_mois",v)} />
            <StructField {...fieldProps} label="Crédits conso / pensions" type="number" value={q.credits_conso_mois} onChange={v=>updateSection("qualification","credits_conso_mois",v)} />
          </div><div style={{ padding:"0 14px 14px", color:T.textSub, fontSize:FONT.xs.size+1 }}>Le détail des biens, crédits, placements et structures est complété dans l'onglet <b style={{color:T.text}}>Patrimoine & financement</b>.</div></div>
          <div style={cardStyle}>{cardHd("06 — Qualification, alertes & suite", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}>
            <StructField {...fieldProps} label="Complexité attribuée" value={q.niveau_complexite} onChange={v=>updateSection("qualification","niveau_complexite",v)} options={["Simple","Intermédiaire","Complexe"]} />
            <StructField {...fieldProps} label="Situation bancaire / conformité" value={q.situation_bancaire} onChange={v=>updateSection("qualification","situation_bancaire",v)} options={["RAS","Incident récent","FICP","Surendettement","À vérifier"]} />
            <StructField {...fieldProps} label="Justification du niveau" type="textarea" value={q.justification_complexite} onChange={v=>updateSection("qualification","justification_complexite",v)} wide />
            <StructField {...fieldProps} label="Points d'alerte détectés" type="textarea" value={q.alertes} onChange={v=>updateSection("qualification","alertes",v)} placeholder="Endettement, revenus, objectifs, structure, risques..." wide />
            <StructField {...fieldProps} label="Décision issue du RDV" value={rdv.issue} onChange={v=>updateSection("rdv","issue",v)} options={["Dossier ouvert — R2 planifié","En attente de pièces","Dossier non qualifié","À recontacter","Phase 1 signée"]} />
            <StructField {...fieldProps} label="Date R2 / relance" type="date" value={rdv.date_r2 || rdv.relance} onChange={v=>updateSection("rdv","date_r2",v)} />
            <StructField {...fieldProps} label="Prochaine action" value={rdv.prochaine_action} onChange={v=>updateSection("rdv","prochaine_action",v)} wide />
            <StructField {...fieldProps} label="Consentement RGPD" value={q.consentement_rgpd} onChange={v=>updateSection("qualification","consentement_rgpd",v)} options={["Obtenu","À obtenir","Refusé"]} />
          </div></div>
          <div style={cardStyle}>{cardHd("Pièces prioritaires à demander avant analyse")}<div style={{ padding:14, display:"flex", flexDirection:"column", gap:6 }}>
            {criticalDocs.map((doc,i)=><div key={doc.id} style={{ display:"grid", gridTemplateColumns:"1fr 115px", gap:8, alignItems:"center", padding:"5px 7px", background:T.input, borderRadius:RADIUS.md }}><div style={{ color:T.text, fontSize:FONT.xs.size+1, fontWeight:800 }}>{doc.label}</div><select className="inv-sel" value={doc.statut || "À demander"} onChange={e=>updateDoc(docs.findIndex(x=>x.id===doc.id),"statut",e.target.value)} style={{ fontSize:FONT.xs.size+1 }}>{STRUCT_DOC_STATUTS.map(x=><option key={x}>{x}</option>)}</select></div>)}
          </div></div>
        </div>
      </div>
    </div>;
  };

  const renderProfil = () => <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
      {kpi("Patrimoine brut", fmtEur(c.patrimoineBrut), "Base déclarative")}
      {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `CRD ${fmtEur(c.crdTotal)}`)}
      {kpi("Revenus retenus", `${fmtEur(c.revenusRetenus)}/mois`, "Lecture prudentielle")}
      {kpi("Endettement", fmtPct(c.tauxEndettement), c.tauxEndettement > .35 ? "Vigilance bancaire" : "À valider sur pièces", c.tauxEndettement > .35 ? "red" : "green")}
      {kpi("Complexité", q.niveau_complexite || "À qualifier", p.tmi || "TMI à préciser", "gold")}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"1.05fr .95fr", gap:SPACING.md, alignItems:"start" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Profil personnel & familial", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Prénom" value={p.prenom} onChange={v=>updateSection("profil","prenom",v)} />
          <StructField T={T} label="Nom" value={p.nom} onChange={v=>updateSection("profil","nom",v)} />
          <StructField T={T} label="Date de naissance" type="date" value={p.date_naissance} onChange={v=>updateSection("profil","date_naissance",v)} />
          <StructField T={T} label="Situation familiale" value={p.situation_familiale} onChange={v=>updateSection("profil","situation_familiale",v)} options={["Célibataire","Marié(e)","Pacsé(e)","Divorcé(e)","Concubinage","Veuf/veuve"]}/>
          <StructField T={T} label="Régime matrimonial" value={p.regime_matrimonial} onChange={v=>updateSection("profil","regime_matrimonial",v)} options={["Communauté réduite aux acquêts","Séparation de biens","Participation aux acquêts","Communauté universelle","Non applicable"]}/>
          <StructField T={T} label="Enfants à charge" type="number" value={p.enfants} onChange={v=>updateSection("profil","enfants",v)}/>
          <StructField T={T} label="Enfants / objectifs transmission" value={p.enfants_details} onChange={v=>updateSection("profil","enfants_details",v)} wide/>
          <StructField T={T} label="Adresse" value={p.adresse} onChange={v=>updateSection("profil","adresse",v)} wide/>
        </div></div>
        <div style={cardStyle}>{cardHd("Profession, revenus & fiscalité")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Profession / fonction" value={p.profession} onChange={v=>updateSection("profil","profession",v)} />
          <StructField T={T} label="Statut professionnel" value={p.statut_pro} onChange={v=>updateSection("profil","statut_pro",v)} options={["Salarié CDI","Salarié CDD","TNS / Indépendant","Chef d'entreprise","Profession libérale","Fonctionnaire","Retraité","Autre"]}/>
          <StructField T={T} label="Employeur / secteur" value={p.employeur} onChange={v=>updateSection("profil","employeur",v)} />
          <StructField T={T} label="Revenus client / mois" type="number" value={p.revenus_nets_mois} onChange={v=>updateSection("profil","revenus_nets_mois",v)}/>
          <StructField T={T} label="Revenus conjoint / mois" type="number" value={p.revenus_conjoint_mois} onChange={v=>updateSection("profil","revenus_conjoint_mois",v)}/>
          <StructField T={T} label="Dividendes / an" type="number" value={p.dividendes_an} onChange={v=>updateSection("profil","dividendes_an",v)}/>
          <StructField T={T} label="IR N-1" type="number" value={p.impot_revenu} onChange={v=>updateSection("profil","impot_revenu",v)}/>
          <StructField T={T} label="TMI" value={p.tmi} onChange={v=>updateSection("profil","tmi",v)} options={["0 %","11 %","30 %","41 %","45 %","À vérifier"]}/>
          <StructField T={T} label="IFI" value={p.ifi} onChange={v=>updateSection("profil","ifi",v)} options={["Non assujetti","Proche du seuil","Assujetti","À vérifier"]}/>
          <StructField T={T} label="Régime locatif actuel" value={p.regime_locatif} onChange={v=>updateSection("profil","regime_locatif",v)} options={["Micro-foncier","Foncier réel","LMNP micro-BIC","LMNP réel","LMP","SCI IS","Non applicable"]}/>
          <StructField T={T} label="Dispositifs / déficits reportables" value={p.dispositifs_fiscaux} onChange={v=>updateSection("profil","dispositifs_fiscaux",v)} wide/>
        </div></div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Vision patrimoniale & objectif client", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:SPACING.md }}>
          <StructField T={T} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Revenus complémentaires","Constitution patrimoine","Retraite","Défiscalisation","Transmission","Accélération patrimoniale","Mix"]}/>
          <StructField T={T} label="Horizon" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["Court terme < 5 ans","Moyen terme 5-15 ans","Long terme > 15 ans","À définir"]}/>
          <StructField T={T} label="Niveau d'implication" value={q.niveau_implication} onChange={v=>updateSection("qualification","niveau_implication",v)} options={["Autonome","Accompagné","Clé-en-main"]}/>
          <StructField T={T} label="Niveau de levier" value={q.niveau_levier} onChange={v=>updateSection("qualification","niveau_levier",v)} options={["Faible < 70 % LTV","Standard 70-80 %","Élevé > 80 %","Sans préférence"]}/>
          <StructField T={T} label="Zones souhaitées" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} wide/>
          <StructField T={T} label="Projets 3-5 ans / transmission" type="textarea" value={obj.projets_3_5_ans} onChange={v=>updateSection("objectifs","projets_3_5_ans",v)} wide/>
        </div></div>
        <div style={cardStyle}>{cardHd("Qualification & alertes R1")}<div style={{ padding:16, display:"grid", gap:SPACING.md }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}><StructField T={T} label="Niveau de complexité" value={q.niveau_complexite} onChange={v=>updateSection("qualification","niveau_complexite",v)} options={["Simple","Intermédiaire","Complexe"]}/><StructField T={T} label="Situation bancaire" value={q.situation_bancaire} onChange={v=>updateSection("qualification","situation_bancaire",v)} options={["RAS","Incident récent","FICP","Surendettement","À vérifier"]}/></div>
          <StructField T={T} label="Justification du niveau" type="textarea" value={q.justification_complexite} onChange={v=>updateSection("qualification","justification_complexite",v)} wide/>
          <StructField T={T} label="Alertes / vigilances" type="textarea" value={q.alertes} onChange={v=>updateSection("qualification","alertes",v)} wide/>
          <div style={{ display:"flex", gap:8, alignItems:"center", color:T.textSub, fontSize:FONT.sm.size }}><Icon as={Check} size={13}/><span>Consentement RGPD : <b style={{ color:T.text }}>{q.consentement_rgpd || "À obtenir"}</b></span></div>
        </div></div>
      </div>
    </div>
  </div>;

  const renderPatrimoine = () => <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(6,minmax(0,1fr))", gap:SPACING.md }}>
      {kpi("Immobilier brut", fmtEur(c.valeurLots + c.rpVal), "Biens + RP")}
      {kpi("Financier", fmtEur(c.patrimoineFinancier), "Épargne & placements")}
      {kpi("CRD total", fmtEur(c.crdTotal), "Dette immobilière", "red")}
      {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `LTV ${fmtPct(c.ltv)}`, "gold")}
      {kpi("Cash-flow locatif", `${fmtEur(c.cashflowMois)}/mois`, `Loyers ${fmtEur(c.loyers)}/mois`, c.cashflowMois >= 0 ? "green" : "red")}
      {kpi("Rendement brut", fmtPct(c.rendementBrut), "Sur actifs locatifs")}
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(340px,.8fr)", gap:SPACING.md, alignItems:"start" }}>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Inventaire immobilier & lecture de performance", "gold")}<div style={{ padding:14 }}>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginBottom:10 }}>Un actif par ligne : valeur, dette, flux et régime de détention. Cette base alimente l'analyse de levier, l'arbitrage et la fiscalité.</div>
          <div style={{ overflowX:"auto", border:`1px solid ${T.border}`, borderRadius:RADIUS.md }}><table className="inv-table" style={{ minWidth:980 }}><thead><tr><th>#</th><th>Bien / adresse</th><th>Type</th><th>Détention</th><th>Fiscalité</th><th>Loyer</th><th>Mensualité</th><th>CRD</th><th>Valeur</th><th>Équité</th><th></th></tr></thead><tbody>{lots.map((l,i)=>{ const equity = toN(l.valeur)-toN(l.crd); return <tr key={l.id || i}><td style={{ color:T.accent, fontWeight:900 }}>{i+1}</td><td><input className="inv-inp" value={l.adresse || ""} onChange={e=>updateLot(i,"adresse",e.target.value)} placeholder="Adresse"/></td><td><select className="inv-sel" value={l.type || ""} onChange={e=>updateLot(i,"type",e.target.value)}>{STRUCT_LOT_TYPES.map(o=><option key={o}>{o}</option>)}</select></td><td><select className="inv-sel" value={l.structure || ""} onChange={e=>updateLot(i,"structure",e.target.value)}>{STRUCT_DETENTION.map(o=><option key={o}>{o}</option>)}</select></td><td><select className="inv-sel" value={l.regime || ""} onChange={e=>updateLot(i,"regime",e.target.value)}>{STRUCT_REGIMES.map(o=><option key={o}>{o}</option>)}</select></td><td><input className="inv-inp" type="number" value={l.loyer_mois || ""} onChange={e=>updateLot(i,"loyer_mois",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.mensualite || ""} onChange={e=>updateLot(i,"mensualite",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.crd || ""} onChange={e=>updateLot(i,"crd",e.target.value)} style={{textAlign:"right"}}/></td><td><input className="inv-inp" type="number" value={l.valeur || ""} onChange={e=>updateLot(i,"valeur",e.target.value)} style={{textAlign:"right"}}/></td><td style={{ color:equity >= 0 ? SU : DA, fontWeight:900, whiteSpace:"nowrap" }}>{fmtEur(equity)}</td><td><button className="inv-rm" onClick={()=>removeLot(i)}>×</button></td></tr>})}</tbody></table></div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginTop:12, flexWrap:"wrap" }}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addLot}><Icon as={Plus} size={12}/> Ajouter un actif</button><div style={{ display:"flex", gap:14, color:T.textSub, fontSize:FONT.xs.size+1, fontWeight:800 }}><span>Valeur <b style={{color:T.text}}>{fmtEur(c.valeurLots)}</b></span><span>Loyers <b style={{color:T.text}}>{fmtEur(c.loyers)}/mois</b></span><span>CRD <b style={{color:T.text}}>{fmtEur(c.crdLots)}</b></span></div></div>
        </div></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Résidence principale & autres actifs")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Statut RP" value={pat.residence_principale_statut} onChange={v=>updateSection("patrimoine","residence_principale_statut",v)} options={["Propriétaire — crédit en cours","Propriétaire — crédit soldé","Locataire","Hébergé(e)"]}/><StructField T={T} compact label="Valeur RP" type="number" value={pat.rp_valeur} onChange={v=>updateSection("patrimoine","rp_valeur",v)}/><StructField T={T} compact label="CRD RP" type="number" value={pat.rp_crd} onChange={v=>updateSection("patrimoine","rp_crd",v)}/><StructField T={T} compact label="Patrimoine professionnel" type="number" value={pat.patrimoine_professionnel} onChange={v=>updateSection("patrimoine","patrimoine_professionnel",v)}/><StructField T={T} compact label="Commentaires actifs pro / libéralités" type="textarea" value={pat.patrimoine_pro_commentaires || pat.liberalites} onChange={v=>updateSection("patrimoine","patrimoine_pro_commentaires",v)} wide/></div></div>
          <div style={cardStyle}>{cardHd("Patrimoine financier & retraite")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Liquidités / livrets" type="number" value={pf.liquidites} onChange={v=>updateSection("patrimoine_financier","liquidites",v)}/><StructField T={T} compact label="Assurance-vie" type="number" value={pf.assurance_vie} onChange={v=>updateSection("patrimoine_financier","assurance_vie",v)}/><StructField T={T} compact label="PEA / CTO" type="number" value={pf.pea_cto} onChange={v=>updateSection("patrimoine_financier","pea_cto",v)}/><StructField T={T} compact label="PER / retraite" type="number" value={pf.per} onChange={v=>updateSection("patrimoine_financier","per",v)}/><StructField T={T} compact label="Épargne salariale" type="number" value={pf.epargne_salariale} onChange={v=>updateSection("patrimoine_financier","epargne_salariale",v)}/><StructField T={T} compact label="Autres placements" type="number" value={pf.autres} onChange={v=>updateSection("patrimoine_financier","autres",v)}/></div></div>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
        <div style={cardStyle}>{cardHd("Financement & capacité bancaire", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="Banque principale" value={fin.banque_principale} onChange={v=>updateSection("financement","banque_principale",v)}/><StructField T={T} compact label="Relation bancaire" value={fin.relation_bancaire} onChange={v=>updateSection("financement","relation_bancaire",v)} options={["Banque unique","Plusieurs banques","Via courtier","Mix"]}/><StructField T={T} compact label="Mensualités totales" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)}/><StructField T={T} compact label="Apport disponible" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)}/><StructField T={T} compact label="Épargne de précaution" type="number" value={fin.epargne_precaution} onChange={v=>updateSection("financement","epargne_precaution",v)}/><StructField T={T} compact label="Mensualité max supportable" type="number" value={fin.mensualite_max} onChange={v=>updateSection("financement","mensualite_max",v)}/><StructField T={T} compact label="Capacité avec revente" type="number" value={fin.capacite_avec_revente} onChange={v=>updateSection("financement","capacite_avec_revente",v)}/><StructField T={T} compact label="Finançable sans revente" value={fin.financable_sans_revente} onChange={v=>updateSection("financement","financable_sans_revente",v)} options={["Oui","Non — bloqué","Partiellement","À confirmer"]}/><StructField T={T} compact label="Taux moyen portefeuille" type="number" value={fin.taux_moyen} onChange={v=>updateSection("financement","taux_moyen",v)}/><StructField T={T} compact label="Refinancement envisagé" value={fin.refinancement_envisage} onChange={v=>updateSection("financement","refinancement_envisage",v)} options={["Oui","Non","À étudier"]}/></div></div>
        <div style={cardStyle}>{cardHd("Structures de détention & transmission", "gold")}<div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:10 }}><StructField T={T} compact label="SCI existante" value={st.sci_nom || st.sci_existante} onChange={v=>updateSection("structures","sci_nom",v)}/><StructField T={T} compact label="Régime SCI" value={st.sci_regime} onChange={v=>updateSection("structures","sci_regime",v)} options={["IR","IS","Non défini","Pas de SCI"]}/><StructField T={T} compact label="Associés" value={st.sci_associes} onChange={v=>updateSection("structures","sci_associes",v)}/><StructField T={T} compact label="Résultat dernier bilan" type="number" value={st.sci_resultat} onChange={v=>updateSection("structures","sci_resultat",v)}/><StructField T={T} compact label="Nouvelles SCI" value={st.nouvelles_sci} onChange={v=>updateSection("structures","nouvelles_sci",v)} options={["Oui — 1 SCI / projet","À définir","Non"]}/><StructField T={T} compact label="Holding" value={st.holding} onChange={v=>updateSection("structures","holding",v)} options={["Oui","Non","À étudier"]}/><StructField T={T} compact label="Transmission / protection" type="textarea" value={st.transmission} onChange={v=>updateSection("structures","transmission",v)} wide/></div></div>
        <div style={{ ...cardStyle, padding:14 }}><div style={{ fontWeight:900, color:T.text, marginBottom:8 }}>Lecture d'analyse immédiate</div><div style={{ display:"grid", gap:7, color:T.textSub, fontSize:FONT.xs.size+1 }}><div>• Endettement indicatif : <b style={{color:c.tauxEndettement > .35 ? DA : SU}}>{fmtPct(c.tauxEndettement)}</b></div><div>• LTV globale : <b style={{color:T.text}}>{fmtPct(c.ltv)}</b></div><div>• Base IFI indicative : <b style={{color:T.text}}>{fmtEur(c.ifiBase)}</b></div><div>• Cash-flow locatif : <b style={{color:c.cashflowMois >= 0 ? SU : DA}}>{fmtEur(c.cashflowMois)}/mois</b></div><div>• Point à qualifier : <b style={{color:T.text}}>{q.alertes || "Renseigner les alertes dans l'audit"}</b></div></div></div>
      </div>
    </div>
  </div>;

  const renderFinancement = () => <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
    <div style={cardStyle}>{cardHd("Situation bancaire", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:SPACING.md }}><StructField T={T} label="Banque principale" value={fin.banque_principale} onChange={v=>updateSection("financement","banque_principale",v)}/><StructField T={T} label="Relation bancaire" value={fin.relation_bancaire} onChange={v=>updateSection("financement","relation_bancaire",v)} options={["4 banques en concurrence","Banque unique","Via courtier","Mix banques + courtier"]}/><StructField T={T} label="Mensualités totales" type="number" value={fin.mensualites_total} onChange={v=>updateSection("financement","mensualites_total",v)}/><StructField T={T} label="Apport disponible" type="number" value={fin.apport_disponible} onChange={v=>updateSection("financement","apport_disponible",v)}/><StructField T={T} label="Capacité avec revente" type="number" value={fin.capacite_avec_revente} onChange={v=>updateSection("financement","capacite_avec_revente",v)}/><StructField T={T} label="Finançable sans revente" value={fin.financable_sans_revente} onChange={v=>updateSection("financement","financable_sans_revente",v)} options={["Oui","Non — bloqué","Partiellement","À confirmer"]}/><StructField T={T} label="Taux moyen" type="number" value={fin.taux_moyen} onChange={v=>updateSection("financement","taux_moyen",v)}/><StructField T={T} label="Durée initiale" value={fin.duree_initiale} onChange={v=>updateSection("financement","duree_initiale",v)} options={["15 ans","20 ans","25 ans","Mix"]}/></div></div>
    <div style={cardStyle}>{cardHd("Objectifs & structures", "gold")}<div style={{ padding:16, display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:SPACING.md }}><StructField T={T} label="Objectif principal" value={obj.objectif_principal} onChange={v=>updateSection("objectifs","objectif_principal",v)} options={["Cash-flow","Capitalisation","Transmission","Défiscalisation","Accélération patrimoniale","Mix"]}/><StructField T={T} label="Horizon" value={obj.horizon} onChange={v=>updateSection("objectifs","horizon",v)} options={["5 ans","10 ans","15 ans","20 ans","20 ans +"]}/><StructField T={T} label="Rendement cible" type="number" value={obj.rendement_cible} onChange={v=>updateSection("objectifs","rendement_cible",v)}/><StructField T={T} label="Rythme d'achat" value={obj.rythme_achat} onChange={v=>updateSection("objectifs","rythme_achat",v)} options={["1 bien / an","2 biens / an","1 bien / 2 ans","Opportuniste"]}/><StructField T={T} label="Zones" value={obj.zones} onChange={v=>updateSection("objectifs","zones",v)} /><StructField T={T} label="Gestion locative" value={obj.gestion_locative} onChange={v=>updateSection("objectifs","gestion_locative",v)} options={["Lui-même","Agence","Mix","À déléguer"]}/><StructField T={T} label="SCI existante" value={st.sci_existante} onChange={v=>updateSection("structures","sci_existante",v)} /><StructField T={T} label="Régime SCI" value={st.sci_regime} onChange={v=>updateSection("structures","sci_regime",v)} options={["IR","IS","Non défini","Pas de SCI"]}/><StructField T={T} label="Holding envisagée" value={st.holding_envisagee} onChange={v=>updateSection("structures","holding_envisagee",v)} options={["Oui","Non","À étudier"]}/><StructField T={T} label="Transmission" value={st.transmission} onChange={v=>updateSection("structures","transmission",v)} /></div></div>
  </div>;

  const renderDocuments = () => <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) 370px", gap:SPACING.md, alignItems:"start" }}>
    <div style={cardStyle}>{cardHd("Liste des documents à fournir — audit & stratégie", "gold")}<div style={{ padding:14 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,minmax(0,1fr))", gap:10, marginBottom:14 }}>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>TOTAL</div><div style={{color:T.text,fontWeight:900,fontSize:FONT.xl.size}}>{docs.length}</div></div>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>REÇUS / TRAITÉS</div><div style={{color:SU,fontWeight:900,fontSize:FONT.xl.size}}>{c.docsRecus}</div></div>
        <div style={{ ...cardStyle, padding:10 }}><div style={{color:T.textMuted,fontSize:FONT.xs.size,fontWeight:900}}>OBLIGATOIRES VALIDÉS</div><div style={{color:T.accent,fontWeight:900,fontSize:FONT.xl.size}}>{c.docsObligatoiresOk}/{c.docsObligatoires}</div></div>
      </div>
      {STRUCT_DOC_CATEGORIES.map(cat => { const catDocs = docs.filter(doc => doc.categorie === cat.id); const complete = catDocs.filter(doc => ["Reçu","Validé","Non applicable"].includes(doc.statut)).length; return <div key={cat.id} style={{ marginBottom:14, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
        <div style={{ padding:"9px 10px", display:"flex", justifyContent:"space-between", gap:8, background:T.input, borderBottom:`1px solid ${T.border}` }}><div><div style={{color:T.text,fontSize:FONT.sm.size,fontWeight:900}}>{cat.label}</div><div style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>{cat.description}</div></div><div style={{color:T.accent,fontWeight:900,fontSize:FONT.sm.size,whiteSpace:"nowrap"}}>{complete}/{catDocs.length}</div></div>
        <div style={{ padding:8, display:"flex", flexDirection:"column", gap:6 }}>{catDocs.map(doc => { const idx = docs.findIndex(x=>x.id===doc.id); return <div key={doc.id} style={{ display:"grid", gridTemplateColumns:"minmax(180px,1fr) 128px minmax(180px,.8fr)", gap:8, alignItems:"center", padding:"6px 8px", borderRadius:RADIUS.md, background:doc.required ? T.accentBg : "transparent" }}><div style={{color:T.text,fontSize:FONT.xs.size+1,fontWeight:doc.required ? 900 : 700}}>{doc.label}{doc.required && <span style={{color:DA,marginLeft:4}}>*</span>}</div><select className="inv-sel" value={doc.statut || "À demander"} onChange={e=>updateDoc(idx,"statut",e.target.value)} style={{fontSize:FONT.xs.size+1}}>{STRUCT_DOC_STATUTS.map(o=><option key={o}>{o}</option>)}</select><input className="inv-inp" value={doc.commentaire || ""} onChange={e=>updateDoc(idx,"commentaire",e.target.value)} placeholder="Commentaire" style={{fontSize:FONT.xs.size+1}}/></div>})}</div>
      </div> })}
      <div style={{ color:T.textMuted, fontSize:FONT.xs.size+1 }}>* Pièces nécessaires pour lancer l'analyse dans de bonnes conditions. Les documents complémentaires sont à demander selon la situation du client.</div>
    </div></div>
    <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={cardStyle}>{cardHd("Fichiers transmis")}<div style={{ padding:14 }}><div style={{ color:T.textSub, fontSize:FONT.xs.size+1, marginBottom:10 }}>Déposez les documents reçus dans le dossier sécurisé du client.</div>{selectedId ? <DocumentsSection folder={`structuration/${selectedId}`} T={T} /> : <div style={{ color:T.textMuted }}>Créez d'abord un dossier.</div>}</div></div>
      <div style={{ ...cardStyle, padding:14, borderLeft:`4px solid ${T.accent}` }}><div style={{color:T.text,fontWeight:900,marginBottom:8}}>À demander prioritairement</div>{docs.filter(d=>d.required && !["Reçu","Validé","Non applicable"].includes(d.statut)).slice(0,8).map(d=><div key={d.id} style={{color:T.textSub,fontSize:FONT.xs.size+1,padding:"5px 0",borderBottom:`1px solid ${T.border}`}}>• {d.label}</div>)}</div>
    </div>
  </div>;

  const renderNotes = () => <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}>
    <div style={cardStyle}>{cardHd("Notes RDV", "gold")}<div style={{ padding:16, display:"grid", gap:SPACING.md }}><StructField T={T} label="Motivations captées" type="textarea" value={rdv.motivations} onChange={v=>updateSection("rdv","motivations",v)} wide/><StructField T={T} label="Objections / résistances" type="textarea" value={rdv.objections} onChange={v=>updateSection("rdv","objections",v)} wide/><StructField T={T} label="Notes libres" type="textarea" value={rdv.notes} onChange={v=>updateSection("rdv","notes",v)} wide/></div></div>
    <div style={cardStyle}>{cardHd("Issue & suivi")}
      <div style={{ padding:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:SPACING.md }}><StructField T={T} label="Issue" value={rdv.issue} onChange={v=>updateSection("rdv","issue",v)} options={["Phase 1 signée","Phase 1 + Phase 2 signées","Réflexion — relance fixée","Refus","Contrat à envoyer"]}/><StructField T={T} label="Date de relance" type="date" value={rdv.relance} onChange={v=>updateSection("rdv","relance",v)}/><StructField T={T} label="Prochaine action" value={rdv.prochaine_action} onChange={v=>updateSection("rdv","prochaine_action",v)} wide/></div>
    </div>
  </div>;

  const renderReport = () => {
    const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
    const win = window.open("", "_blank", "width=1080,height=900");
    if (!win) { alert("Autorisez les pop-ups pour générer la note patrimoniale."); return; }
    const clientName = currentClient ? clientFullName(currentClient) : [p.prenom, p.nom].filter(Boolean).join(" ") || dossier?.titre || "Client";
    const reportTitle = data.analyse?.projet_etudie || "Votre projet immobilier";
    const investmentTotal = toN(data.analyse?.investissement_total) || c.patrimoineBrut || c.valeurLots;
    const cashflowTarget = toN(data.analyse?.cashflow_cible) || c.cashflowMois;
    const lotsRows = lots.map((l,i)=>`<tr><td>${esc(l.adresse || `Lot ${i+1}`)}</td><td>${esc(l.type || "—")}</td><td>${esc(l.structure || "—")}</td><td>${esc(l.regime || "—")}</td><td>${esc(fmtEur(l.valeur))}</td><td>${esc(fmtEur(l.loyer_mois))}</td><td>${esc(fmtEur(l.mensualite))}</td><td>${esc(fmtEur(l.crd))}</td></tr>`).join("") || `<tr><td colspan="8">Aucun lot renseigné</td></tr>`;
    const pfRows = [
      ["Liquidités / livrets", pf.liquidites], ["Assurance-vie", pf.assurance_vie], ["PEA / CTO", pf.pea_cto], ["PER", pf.per], ["Épargne salariale", pf.epargne_salariale], ["Autres placements", pf.autres]
    ].filter(([,v])=>toN(v)>0).map(([label,v])=>`<tr><td>${esc(label)}</td><td>${esc(clientName)}</td><td>${esc(fmtEur(v))}</td><td>À préciser</td></tr>`).join("") || `<tr><td colspan="4">Aucun placement financier renseigné</td></tr>`;
    const maxLoyer = Math.max(1, ...lots.map(l => toN(l.loyer_mois)));
    const loyerBars = lots.map((l,i)=>{ const val = toN(l.loyer_mois); const h = Math.max(6, Math.round((val/maxLoyer)*112)); return `<div class="bar-item"><div class="bar-val">${esc(fmtEur(val))}</div><div class="bar" style="height:${h}px"></div><div class="bar-lab">${esc(l.type || `Lot ${i+1}`)}</div></div>`; }).join("") || `<div class="empty">Aucun loyer renseigné</div>`;
    const projectionRows = Array.from({length:8}, (_,i)=>{ const an=i+1; const revenus = c.loyers*12*an; const cf = c.cashflowMois*12*an; return `<div class="proj-row"><span>An ${an}</span><div class="proj-line"><i style="width:${Math.min(100, an*12)}%"></i></div><b>${esc(fmtEur(revenus))}</b><b class="green">${esc(fmtEur(cf))}</b></div>`; }).join("");
    const recos = (data.analyse?.preconisations || []).map(r=>`<div class="reco"><div class="reco-top"><b>${esc(r.axe || "Stratégie")}</b><span>${esc(r.priorite || "Moyenne")}</span></div><h4>${esc(r.titre || "Préconisation")}</h4><p>${esc(r.detail || "À préciser")}</p><small>Action : ${esc(r.action || "À définir")}</small></div>`).join("");
    const splitLines = (txt, fallback=[]) => String(txt || "").split(/\n|;/).map(x=>x.trim()).filter(Boolean).length ? String(txt || "").split(/\n|;/).map(x=>x.trim()).filter(Boolean) : fallback;
    const timeline = splitLines(data.analyse?.calendrier, ["Collecte complète des documents", "Analyse des structures actuelles", "Simulation fiscale et bancaire", "Restitution de la note patrimoniale", "Mise en œuvre avec notaire / expert-comptable / banque"]).map((x,i)=>`<div class="step"><em>${String(i+1).padStart(2,"0")}</em><strong>${esc(x)}</strong></div>`).join("");
    const pointsForts = splitLines(data.analyse?.points_forts, ["Patrimoine immobilier déjà constitué", "Capacité d'épargne à qualifier", "Effet de levier bancaire à optimiser", "Vision long terme compatible avec une structuration patrimoniale"]);
    const pointsPrep = splitLines(data.analyse?.points_preparer, ["Finaliser les documents manquants", "Valider le régime fiscal cible", "Confirmer la capacité bancaire", "Sécuriser les hypothèses de loyers et de charges"]);
    const atoutsHtml = pointsForts.map(x=>`<li>${esc(x)}</li>`).join("");
    const prepHtml = pointsPrep.map(x=>`<li>${esc(x)}</li>`).join("");
    const fiscalRows = [
      ["Structure actuelle", st.sci_nom || "Détention actuelle à préciser", st.sci_regime || "À qualifier"],
      ["Structure cible", st.nouvelles_sci || "À définir", st.holding || "Holding à arbitrer"],
      ["Objectif fiscal", data.analyse?.strategie_fiscale || obj.objectif_principal || "Optimisation IR / IS / LMNP selon horizon", "Simulation à valider"],
      ["Transmission", st.transmission || "À préciser", "Donation, démembrement ou SCI familiale à étudier"]
    ].map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join("");
    const debtRows = [
      ["Revenus professionnels", p.revenus_nets_mois, "100 % — à qualifier"],
      ["Dividendes / autres revenus", Math.round((toN(p.dividendes_an)+toN(p.autres_revenus_an))/12), "Selon stabilité"],
      ["Loyers retenus", Math.round(c.loyers*0.70), "70 % méthode prudentielle"],
      ["Mensualités actuelles", toN(fin.mensualites_total) || c.mensualitesLots, "Crédits en cours"]
    ].map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(fmtEur(r[1]))}/mois</td><td>${esc(r[2])}</td></tr>`).join("");
    const caution = data.analyse?.point_vigilance || data.analyse?.points_attention || "Point de vigilance à formaliser : sécuriser les hypothèses fiscales, bancaires et locatives avant toute mise en œuvre.";
    const highlight = data.analyse?.point_majeur || data.analyse?.contexte_client || "Atout majeur : la structuration doit transformer les données patrimoniales du client en plan d'action clair, chiffré et pilotable.";

    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(clientName)} — Note patrimoniale</title><style>
      @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=DM+Sans:wght@300;400;500;700;900&display=swap');
      *{box-sizing:border-box}body{margin:0;background:#eef1f4;color:#0D1B2A;font-family:'DM Sans',Arial,sans-serif}.page{width:210mm;min-height:297mm;margin:0 auto 10mm;background:#fff;padding:16mm 14mm;position:relative;overflow:hidden}.cover{background:#0D1B2A;color:#F5F0E8}.brand{font-family:'Cormorant Garamond',serif;font-size:20px;letter-spacing:.5px}.brand-sub{font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C}.doc-date{position:absolute;right:16mm;top:14mm;text-align:right;color:rgba(245,240,232,.55);font-size:10px}.eyebrow{font-size:9px;letter-spacing:4px;text-transform:uppercase;color:#C9A84C;font-weight:700}.cover-title{font-family:'Cormorant Garamond',serif;font-size:48px;line-height:.96;font-weight:300;margin:18mm 0 6mm}.cover-title em{color:#C9A84C;font-style:italic}.cover-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14mm;margin-top:12mm}.cover-k{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#C9A84C}.cover-v{font-size:16px;font-weight:700;margin-top:4px}.quote{position:absolute;left:14mm;right:14mm;bottom:36mm;border-left:2px solid #C9A84C;padding:8mm;color:rgba(245,240,232,.75);font-family:'Cormorant Garamond',serif;font-size:15px;line-height:1.55;background:rgba(255,255,255,.03)}.footer{position:absolute;left:14mm;right:14mm;bottom:8mm;border-top:1px solid rgba(13,27,42,.12);padding-top:5mm;font-size:8px;color:#8a96a3;display:flex;justify-content:space-between}.cover .footer{border-color:rgba(245,240,232,.15);color:rgba(245,240,232,.35)}h2{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:400;margin:0 0 7mm;color:#0D1B2A}.sec{font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#C9A84C;font-weight:800;margin-bottom:2mm}.line{height:1px;background:#e6e6e6;margin-bottom:6mm}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin-bottom:6mm}.card{border:1px solid #e5e8ec;border-top:3px solid #C9A84C;padding:4mm;background:#fff}.card.green{border-top-color:#2D6A4F}.card.blue{border-top-color:#185FA5}.card b{display:block;font-size:20px}.card span{font-size:8px;text-transform:uppercase;color:#7A8A9A;letter-spacing:.8px;font-weight:900}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.box{border:1px solid #e5e8ec;background:#fff;margin-bottom:6mm}.box h3{margin:0;background:#0D1B2A;color:white;font-size:12px;text-transform:uppercase;letter-spacing:1.2px;padding:3mm 4mm}.box .bd{padding:4mm;font-size:11px;line-height:1.65}.note{border:1px solid #E2C97E;background:#fff9e7;padding:5mm;margin:5mm 0;font-size:13px;line-height:1.7}.note b{color:#854F0B}table{width:100%;border-collapse:collapse;font-size:10.5px}th{background:#0D1B2A;color:white;text-align:left;padding:2.6mm;font-size:8px;text-transform:uppercase;letter-spacing:1px}td{border-bottom:1px solid #edf0f2;padding:2.4mm}tr.total td{background:#0D1B2A;color:white;font-weight:900}.bar-chart{height:150px;display:flex;gap:8mm;align-items:flex-end;justify-content:center;border:1px solid #eef1f4;padding:6mm 4mm 8mm}.bar-item{text-align:center;min-width:18mm}.bar{width:13mm;background:#12385f;margin:2mm auto 0;border-radius:2px 2px 0 0}.bar-val{font-size:9px;font-weight:900;color:#12385f}.bar-lab{font-size:8px;color:#738090;margin-top:2mm}.proj-row{display:grid;grid-template-columns:22mm 1fr 24mm 24mm;gap:4mm;align-items:center;font-size:10px;margin:2mm 0}.proj-line{height:4px;background:#eef1f4;border-radius:99px;overflow:hidden}.proj-line i{display:block;height:100%;background:#12385f}.green{color:#2D6A4F}.red{color:#7B2D2D}.reco{border-left:3px solid #C9A84C;background:#fbf7eb;padding:4mm;margin-bottom:3mm}.reco-top{display:flex;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#7A8A9A}.reco h4{margin:1mm 0;font-size:13px;color:#0D1B2A}.reco p{margin:0 0 2mm;font-size:11px}.step{border:1px solid #e5e8ec;padding:5mm;margin-bottom:4mm}.step em{font-family:'Cormorant Garamond',serif;font-size:28px;color:#C9A84C;font-style:normal;margin-right:5mm}.step strong{font-size:12px}.cols{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.pill-list{list-style:none;margin:0;padding:0}.pill-list li{padding:3mm 4mm;margin-bottom:3mm;border-radius:4px;border:1px solid #d9efe4;background:#effaf4;color:#2D6A4F;font-size:11px}.pill-list.warn li{border-color:#f3dfa7;background:#fff8df;color:#854F0B}.dark-call{background:#0D1B2A;color:#F5F0E8;padding:8mm;margin-top:8mm;font-family:'Cormorant Garamond',serif;font-size:16px;line-height:1.6;border-left:3px solid #C9A84C}.no-print{position:fixed;right:16px;top:16px;z-index:10}.btn{background:#0D1B2A;color:white;border:0;border-radius:8px;padding:11px 16px;font-weight:900;cursor:pointer}.empty{font-size:11px;color:#8a96a3;align-self:center}@media print{body{background:white}.page{margin:0;page-break-after:always}.page:last-child{page-break-after:auto}.no-print{display:none}@page{size:A4;margin:0}}
    </style></head><body><div class="no-print"><button class="btn" onclick="window.print()">Imprimer / PDF</button></div>

    <section class="page cover"><div class="brand">Profero Invest</div><div class="brand-sub">Conseil en structuration du patrimoine immobilier</div><div class="doc-date">Note patrimoniale<br/>${new Date().toLocaleDateString("fr-FR",{month:"long",year:"numeric"})}</div><div style="margin-top:34mm" class="eyebrow">Note patrimoniale & stratégie d'investissement</div><div class="cover-title">Votre projet<br/><em>immobilier</em></div><div style="font-size:17px">${esc(clientName)}</div><div class="cover-grid"><div><div class="cover-k">Projet</div><div class="cover-v">${esc(reportTitle)}</div></div><div><div class="cover-k">Patrimoine / investissement total</div><div class="cover-v">${esc(fmtEur(investmentTotal))}</div></div><div><div class="cover-k">Cash-flow cible</div><div class="cover-v">${esc(fmtEur(cashflowTarget))}/mois</div></div></div><div class="quote">${esc(data.analyse?.note_finale || data.analyse?.contexte_client || `Cette note synthétise la situation patrimoniale de ${clientName}, les points clés identifiés, les arbitrages structurants et les prochaines étapes pour transformer le patrimoine existant en stratégie immobilière lisible et pilotable.`)}</div><div class="footer"><span>Profero Invest — document confidentiel</span><span>01</span></div></section>

    <section class="page"><div class="sec">01 — Qui vous êtes</div><h2>Votre profil patrimonial</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(p.revenus_nets_mois))}</b><span>Revenus nets mensuels</span></div><div class="card"><b>${esc(fmtEur(c.patrimoineFinancier))}</b><span>Patrimoine financier</span></div><div class="card"><b>${esc(fmtEur(fin.apport_disponible))}</b><span>Apport disponible</span></div><div class="card green"><b>${esc(p.tmi || "—")}</b><span>TMI déclarée</span></div></div><div class="note"><b>Atout majeur —</b> ${esc(highlight)}</div><div class="box"><h3>Situation personnelle & professionnelle</h3><div class="bd"><table><tbody><tr><td>Client</td><td><b>${esc(clientName)}</b></td></tr><tr><td>Situation familiale</td><td>${esc(p.situation_familiale || "À préciser")}</td></tr><tr><td>Régime matrimonial</td><td>${esc(p.regime_matrimonial || "À préciser")}</td></tr><tr><td>Profession</td><td>${esc(p.profession || "À préciser")}</td></tr><tr><td>Statut professionnel</td><td>${esc(p.statut_pro || p.statut_professionnel || "À préciser")}</td></tr><tr><td>Résidence fiscale</td><td>${esc(p.residence_fiscale || "France")}</td></tr></tbody></table></div></div><div class="box"><h3>Votre patrimoine financier détaillé</h3><div class="bd"><table><thead><tr><th>Actif</th><th>Titulaire</th><th>Montant</th><th>Disponibilité</th></tr></thead><tbody>${pfRows}<tr class="total"><td colspan="2">TOTAL</td><td colspan="2">${esc(fmtEur(c.patrimoineFinancier))}</td></tr></tbody></table></div></div><div class="footer"><span>Profero Invest</span><span>02</span></div></section>

    <section class="page"><div class="sec">02 — Ce que vous avez déjà bâti</div><h2>Patrimoine immobilier existant</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(c.valeurLots))}</b><span>Valeur locative détenue</span></div><div class="card"><b>${esc(fmtEur(c.crdLots))}</b><span>Capital restant dû</span></div><div class="card green"><b>${esc(fmtEur(c.loyers))}/mois</b><span>Loyers mensuels</span></div><div class="card ${c.cashflowMois>=0?'green':'red'}"><b>${esc(fmtEur(c.cashflowMois))}/mois</b><span>Cash-flow locatif</span></div></div><div class="box"><h3>Inventaire immobilier</h3><div class="bd"><table><thead><tr><th>#</th><th>Bien</th><th>Type</th><th>Structure</th><th>Fiscalité</th><th>Valeur</th><th>Loyer</th><th>CRD</th></tr></thead><tbody>${lotsRows}</tbody></table></div></div><div class="grid2"><div class="box"><h3>Structure actuelle</h3><div class="bd"><table><tbody><tr><td>SCI existante</td><td>${esc(st.sci_nom || st.sci_existante || "À préciser")}</td></tr><tr><td>Régime</td><td>${esc(st.sci_regime || "À préciser")}</td></tr><tr><td>Associés</td><td>${esc(st.sci_associes || "À préciser")}</td></tr><tr><td>Résultat / bilan</td><td>${esc(fmtEur(st.sci_resultat))}</td></tr></tbody></table></div></div><div class="box"><h3>Lecture Profero</h3><div class="bd">${esc(data.analyse?.diagnostic || "Diagnostic patrimonial à compléter : performance des actifs, structure de détention, fiscalité, transmission et capacité bancaire.")}</div></div></div><div class="footer"><span>Profero Invest</span><span>03</span></div></section>

    <section class="page"><div class="sec">03 — Le projet / l'opportunité</div><h2>${esc(reportTitle)}</h2><div class="line"></div><div class="cards"><div class="card"><b>${esc(fmtEur(c.rendementBrut*100))}</b><span>Rendement brut indicatif</span></div><div class="card green"><b>${esc(fmtEur(c.cashflowMois))}</b><span>Cash-flow actuel / cible</span></div><div class="card"><b>${esc(fmtEur(c.loyers))}/mois</b><span>Rentrée locative</span></div><div class="card blue"><b>${esc(fmtEur(investmentTotal))}</b><span>Base patrimoniale</span></div></div><div class="grid2"><div class="box"><h3>Paramètres clés</h3><div class="bd"><table><tbody><tr><td>Projet étudié</td><td>${esc(reportTitle)}</td></tr><tr><td>Objectif principal</td><td>${esc(obj.objectif_principal || "À préciser")}</td></tr><tr><td>Horizon</td><td>${esc(obj.horizon || "À préciser")}</td></tr><tr><td>Zones cibles</td><td>${esc(obj.zones || "À préciser")}</td></tr><tr><td>Apport disponible</td><td>${esc(fmtEur(fin.apport_disponible))}</td></tr><tr><td>Capacité avec revente</td><td>${esc(fmtEur(fin.capacite_avec_revente))}</td></tr></tbody></table></div></div><div class="box"><h3>Loyers mensuels par lot</h3><div class="bd"><div class="bar-chart">${loyerBars}</div></div></div></div><div class="note"><b>Point de vigilance —</b> ${esc(caution)}</div><div class="footer"><span>Profero Invest</span><span>04</span></div></section>

    <section class="page"><div class="sec">04 — Le cœur de la stratégie</div><h2>Optimisation fiscale & architecture patrimoniale</h2><div class="line"></div><div class="box"><h3>Architecture patrimoniale cible</h3><div class="bd"><table><thead><tr><th>Thème</th><th>Lecture actuelle / cible</th><th>Point de décision</th></tr></thead><tbody>${fiscalRows}</tbody></table></div></div><div class="grid2"><div class="box"><h3>Pourquoi structurer ?</h3><div class="bd">${esc(data.analyse?.strategie_recommandee || "La structuration vise à aligner la fiscalité, le financement, la transmission et l'exploitation du patrimoine avec les objectifs de long terme du client.")}</div></div><div class="box"><h3>Simulation fiscale à réaliser</h3><div class="bd">${esc(data.analyse?.simulation_fiscale || "À compléter : comparaison détention directe / SCI IR / SCI IS / LMNP, imputation des déficits, effort d'épargne, fiscalité annuelle et impact transmission.")}</div></div></div><div class="box"><h3>Préconisations opérationnelles</h3><div class="bd">${recos || "Préconisations à compléter dans l'onglet Analyse."}</div></div><div class="footer"><span>Profero Invest</span><span>05</span></div></section>

    <section class="page"><div class="sec">05 — Le dossier bancaire</div><h2>Capacité d'emprunt & taux d'endettement</h2><div class="line"></div><div class="grid2"><div class="box"><h3>Revenus retenus par la banque</h3><div class="bd"><table><thead><tr><th>Source</th><th>Montant</th><th>Méthode</th></tr></thead><tbody>${debtRows}<tr class="total"><td>Total revenus retenus</td><td>${esc(fmtEur(c.revenusRetenus))}/mois</td><td>Lecture indicative</td></tr></tbody></table></div></div><div class="box"><h3>Taux d'endettement</h3><div class="bd"><div class="cards" style="grid-template-columns:1fr 1fr"><div class="card ${c.tauxEndettement>0.35?'red':'green'}"><b>${esc(fmtPct(c.tauxEndettement))}</b><span>Endettement indicatif</span></div><div class="card"><b>${esc(fmtEur(c.crdTotal))}</b><span>CRD total</span></div></div>${esc(data.analyse?.capacite_emprunt || "À compléter : lecture bancaire, marge de manœuvre, apport mobilisable, scénarios avec ou sans revente / refinancement.")}</div></div></div><div class="note"><b>Point à valider —</b> ${esc(data.analyse?.revenus_exceptionnels || "Identifier les revenus que la banque retiendra réellement et ceux qui doivent être sécurisés par une hypothèse prudente.")}</div><div class="footer"><span>Profero Invest</span><span>06</span></div></section>

    <section class="page"><div class="sec">06 — Ce qui nous attend</div><h2>Calendrier & prochaines étapes</h2><div class="line"></div>${timeline}<div class="footer"><span>Profero Invest</span><span>07</span></div></section>

    <section class="page"><div class="sec">07 — Ce qu'il faut retenir</div><h2>Synthèse & points d'action</h2><div class="line"></div><div class="cols"><div><h3 style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400">Points forts du dossier</h3><ul class="pill-list">${atoutsHtml}</ul></div><div><h3 style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:400">Points à préparer</h3><ul class="pill-list warn">${prepHtml}</ul></div></div><div class="dark-call">${esc(data.analyse?.conclusion || "Vous disposez d'une base patrimoniale qui peut devenir beaucoup plus lisible, finançable et transmissible à condition de structurer les détentions, qualifier les flux et sécuriser le calendrier de mise en œuvre.")}</div><div class="footer"><span>Profero Invest — conseil en structuration du patrimoine immobilier</span><span>08</span></div></section>

    </body></html>`);
    win.document.close();
  };

  const renderAnalyse = () => {
    const alertesAuto = [
      c.tauxEndettement > .35 ? `Endettement indicatif élevé : ${fmtPct(c.tauxEndettement)}` : null,
      c.ltv > .80 ? `Levier élevé : LTV ${fmtPct(c.ltv)}` : null,
      p.ifi === "Assujetti" || c.ifiBase > 1300000 ? "IFI à traiter dans la stratégie" : null,
      q.situation_bancaire && q.situation_bancaire !== "RAS" ? `Situation bancaire : ${q.situation_bancaire}` : null,
      c.docsObligatoiresOk < c.docsObligatoires ? `${c.docsObligatoires - c.docsObligatoiresOk} pièces obligatoires à obtenir` : null,
      !st.sci_regime && c.valeurLots > 500000 ? "Structure de détention à qualifier" : null,
    ].filter(Boolean);
    const readiness = Math.round((c.completion * .7) + ((c.docsObligatoires ? c.docsObligatoiresOk/c.docsObligatoires : 0) * 30));
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,minmax(0,1fr))", gap:SPACING.md }}>
        {kpi("Patrimoine net", fmtEur(c.patrimoineNet), `Brut ${fmtEur(c.patrimoineBrut)}`, "gold")}
        {kpi("Endettement", fmtPct(c.tauxEndettement), c.tauxEndettement > .35 ? "Vigilance" : "À valider", c.tauxEndettement > .35 ? "red" : "green")}
        {kpi("Cash-flow", `${fmtEur(c.cashflowMois)}/mois`, `Rendement ${fmtPct(c.rendementBrut)}`, c.cashflowMois >= 0 ? "green" : "red")}
        {kpi("IFI indicatif", fmtEur(c.ifiBase), "Assiette à confirmer")}
        {kpi("Dossier prêt", `${readiness} %`, `${c.docsObligatoiresOk}/${c.docsObligatoires} pièces clés`, readiness >= 75 ? "green" : "red")}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"minmax(320px,.75fr) minmax(0,1.25fr)", gap:SPACING.md, alignItems:"start" }}>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Feu tricolore de décision", "gold")}<div style={{padding:14}}>
            {alertesAuto.length ? alertesAuto.map((a,i)=><div key={i} style={{padding:"8px 10px",marginBottom:6,background:SEMANTIC.warning.bg,border:`1px solid ${SEMANTIC.warning.border}`,borderRadius:RADIUS.md,color:T.text,fontSize:FONT.xs.size+1,fontWeight:700}}>⚠ {a}</div>) : <div style={{padding:"10px",background:SEMANTIC.success.bg,border:`1px solid ${SEMANTIC.success.border}`,borderRadius:RADIUS.md,color:SU,fontWeight:900}}>Aucune alerte automatique majeure identifiée</div>}
            <div style={{marginTop:10}}><StructField T={T} label="Points d'attention conseiller" type="textarea" value={data.analyse?.points_attention} onChange={v=>updateAnalyse("points_attention",v)} wide compact/></div>
          </div></div>
          <div style={cardStyle}>{cardHd("Livrable & restitution")}<div style={{padding:14,display:"grid",gap:10}}><StructField T={T} compact label="Titre du projet / dossier" value={data.analyse?.projet_etudie} onChange={v=>updateAnalyse("projet_etudie",v)}/><StructField T={T} compact label="Contexte à afficher en couverture" type="textarea" value={data.analyse?.contexte_client} onChange={v=>updateAnalyse("contexte_client",v)} wide/><StructField T={T} compact label="Conclusion de restitution" type="textarea" value={data.analyse?.conclusion} onChange={v=>updateAnalyse("conclusion",v)} wide/><button className="inv-btn inv-btn-blue" onClick={renderReport}><Icon as={FileText} size={13}/> Générer la note patrimoniale PDF</button></div></div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:SPACING.md }}>
          <div style={cardStyle}>{cardHd("Matrice d'analyse patrimoniale", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
            <StructField T={T} compact label="Performance des actifs / arbitrages" type="textarea" value={data.analyse?.analyse_performance} onChange={v=>updateAnalyse("analyse_performance",v)} wide/>
            <StructField T={T} compact label="Capacité bancaire / refinancement" type="textarea" value={data.analyse?.analyse_bancaire || data.analyse?.capacite_emprunt} onChange={v=>updateAnalyse("analyse_bancaire",v)} wide/>
            <StructField T={T} compact label="Fiscalité actuelle & cible" type="textarea" value={data.analyse?.analyse_fiscale || data.analyse?.strategie_fiscale} onChange={v=>updateAnalyse("analyse_fiscale",v)} wide/>
            <StructField T={T} compact label="Structures de détention" type="textarea" value={data.analyse?.analyse_structure} onChange={v=>updateAnalyse("analyse_structure",v)} wide/>
            <StructField T={T} compact label="Transmission & protection familiale" type="textarea" value={data.analyse?.analyse_transmission} onChange={v=>updateAnalyse("analyse_transmission",v)} wide/>
            <StructField T={T} compact label="Risques / conditions de mise en œuvre" type="textarea" value={data.analyse?.analyse_risques} onChange={v=>updateAnalyse("analyse_risques",v)} wide/>
          </div></div>
          <div style={cardStyle}>{cardHd("Diagnostic & recommandation centrale", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}><StructField T={T} compact label="Diagnostic patrimonial" type="textarea" value={data.analyse?.diagnostic} onChange={v=>updateAnalyse("diagnostic",v)} wide/><StructField T={T} compact label="Stratégie recommandée" type="textarea" value={data.analyse?.strategie_recommandee} onChange={v=>updateAnalyse("strategie_recommandee",v)} wide/><StructField T={T} compact label="Arbitrages à envisager" type="textarea" value={data.analyse?.arbitrages} onChange={v=>updateAnalyse("arbitrages",v)} wide/><StructField T={T} compact label="Professionnels à mobiliser" type="textarea" value={data.analyse?.professionnels_a_mobiliser} onChange={v=>updateAnalyse("professionnels_a_mobiliser",v)} wide/></div></div>
        </div>
      </div>
      <div style={cardStyle}>{cardHd("Scénarios stratégiques comparés", "gold")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:SPACING.md}}>{(data.analyse?.scenarios || []).map((scenario,i)=><div key={scenario.id || i} style={{padding:12,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,background:T.input,display:"grid",gap:8}}><StructField T={T} compact label="Scénario" value={scenario.nom} onChange={v=>updateScenario(i,"nom",v)}/><StructField T={T} compact label="Objectif / bénéfice recherché" type="textarea" value={scenario.objectif} onChange={v=>updateScenario(i,"objectif",v)}/><StructField T={T} compact label="Statut" value={scenario.statut} onChange={v=>updateScenario(i,"statut",v)} options={["À étudier","Recommandé","Alternative","À écarter"]}/></div>)}</div></div>
      <div style={cardStyle}>{cardHd("Plan de préconisations opérationnelles", "gold")}<div style={{padding:14,display:"flex",flexDirection:"column",gap:8}}>{(data.analyse?.preconisations || []).map((r,i)=><div key={r.id || i} style={{display:"grid",gridTemplateColumns:"125px 104px minmax(180px,1fr) minmax(190px,1.25fr) minmax(180px,1fr) 36px",gap:8,alignItems:"center",padding:9,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,background:T.input}}><select className="inv-sel" value={r.axe || ""} onChange={e=>updateReco(i,"axe",e.target.value)}>{["Financement","Fiscalité","Structure","Transmission","Arbitrage","Gestion","Documents","Stratégie"].map(o=><option key={o}>{o}</option>)}</select><select className="inv-sel" value={r.priorite || ""} onChange={e=>updateReco(i,"priorite",e.target.value)}>{["Haute","Moyenne","Basse"].map(o=><option key={o}>{o}</option>)}</select><input className="inv-inp" value={r.titre || ""} onChange={e=>updateReco(i,"titre",e.target.value)} placeholder="Préconisation"/><input className="inv-inp" value={r.detail || ""} onChange={e=>updateReco(i,"detail",e.target.value)} placeholder="Justification"/><input className="inv-inp" value={r.action || ""} onChange={e=>updateReco(i,"action",e.target.value)} placeholder="Action / intervenant / délai"/><button className="inv-rm" onClick={()=>removeReco(i)}>×</button></div>)}<button className="inv-btn inv-btn-blue inv-btn-sm" onClick={addReco} style={{alignSelf:"flex-start"}}><Icon as={Plus} size={12}/> Ajouter une préconisation</button></div></div>
      <div style={cardStyle}>{cardHd("Calendrier & synthèse finale")}<div style={{padding:14,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}><StructField T={T} compact label="Calendrier — une étape par ligne" type="textarea" value={data.analyse?.calendrier} onChange={v=>updateAnalyse("calendrier",v)} wide/><StructField T={T} compact label="Points forts — une ligne par point" type="textarea" value={data.analyse?.points_forts} onChange={v=>updateAnalyse("points_forts",v)} wide/><StructField T={T} compact label="Points à préparer — une ligne par point" type="textarea" value={data.analyse?.points_preparer} onChange={v=>updateAnalyse("points_preparer",v)} wide/><StructField T={T} compact label="Texte final de synthèse" type="textarea" value={data.analyse?.note_finale} onChange={v=>updateAnalyse("note_finale",v)} wide/></div></div>
    </div>;
  };

  const renderContent = () => {
    if (!selectedId || !dossier) return renderListView();
    const map = { audit:renderAudit, profil:renderProfil, patrimoine:renderPatrimoine, documents:renderDocuments, analyse:renderAnalyse };
    return <div style={{ display:"flex", flexDirection:"column", gap:SPACING.sm, minHeight:0, height:"100%" }}>
      <div style={{ flexShrink:0 }}>{renderDossierHeader()}</div>
      <div style={{ flexShrink:0 }}>{renderTabs()}</div>
      <div style={{ minHeight:0, overflowY:"auto", paddingRight:4, maxHeight:"calc(100vh - 335px)" }}>{map[tab]?.()}</div>
    </div>;
  };

  return <div style={{ padding:`${SPACING.md}px ${SPACING.xl}px`, maxWidth:1800, margin:"0 auto", height:"calc(100vh - 24px)", overflow:"hidden" }}>
    <style>{`
      .structuration-compact{font-size:14px;line-height:1.45}
      .structuration-compact .inv-inp,
      .structuration-compact .inv-sel,
      .structuration-compact .inv-textarea{
        color:${T.text}!important;
        background:${T.input}!important;
        font-size:14px!important;
        line-height:1.35!important;
        min-height:38px;
        font-weight:600;
      }
      .structuration-compact .inv-textarea{min-height:74px}
      .structuration-compact .inv-inp:focus,
      .structuration-compact .inv-sel:focus,
      .structuration-compact .inv-textarea:focus{
        outline:2px solid ${T.accentBorder};
        border-color:${T.accent}!important;
      }
      .structuration-compact .inv-table th{
        font-size:12px!important;
        letter-spacing:.25px!important;
        text-transform:none!important;
        white-space:nowrap;
      }
      .structuration-compact .inv-table td{
        font-size:13px!important;
        line-height:1.35!important;
      }
      .structuration-compact option{color:#0D1B2A;background:#fff}
      .structuration-compact ::placeholder{color:${T.textMuted}!important;opacity:.9}
    `}</style>
    {renderClientCreator()}
    <div className="structuration-compact" style={{ display:"grid", gridTemplateColumns:"320px minmax(0,1fr)", gap:SPACING.md, alignItems:"start", height:"100%", minHeight:0 }}>
      <div style={{ height:"100%", minHeight:0 }}>{renderSidebarDossiers()}</div>
      <div style={{ minWidth:0, height:"100%", minHeight:0, overflow:"hidden" }}>
        {error && <div style={{ marginBottom:SPACING.sm, padding:"10px 12px", background:SEMANTIC.warning.bg, border:`1px solid ${SEMANTIC.warning.border}`, color:WA, borderRadius:RADIUS.md }}>{error}</div>}
        {renderContent()}
      </div>
    </div>
  </div>;
}

// ─── SIDEBAR INVEST ───────────────────────────────────────────────────────────

export default StructurationPatrimoniale;
export { StructurationPatrimoniale };
