// ─── LOGOS ────────────────────────────────────────────────────────────────────
// Servis depuis public/logos/ par Vite (URLs relatives à la racine).
export const LOGO_GROUPE_H = "/logos/groupe-profero-h.png";
export const LOGO_GROUPE_V = "/logos/groupe-profero-v.png";
export const LOGO_RENO_H   = "/logos/profero-reno-h.png";
export const LOGO_RENO_V   = "/logos/profero-reno-v.png";
export const LOGO_INVEST_H = "/logos/profero-invest-h.png";
export const LOGO_INVEST_V = "/logos/profero-invest-v.png";


export const PROFERO_YELLOW = "#FFC200";
export const PROFERO_YELLOW_LIGHT = "#FFD84D";

export const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
export const JOURS_JS = [null,"Lundi","Mardi","Mercredi","Jeudi","Vendredi",null];

// Palette vive (Tailwind 500/600) — couleurs bien distinctes pour
// différencier les chantiers d'un coup d'œil.
export const COULEURS_PALETTE = [
  "#ef4444", // rouge
  "#f97316", // orange
  "#eab308", // jaune
  "#84cc16", // vert lime
  "#22c55e", // vert
  "#14b8a6", // teal
  "#0ea5e9", // bleu ciel
  "#3b82f6", // bleu
  "#6366f1", // indigo
  "#a855f7", // violet
  "#ec4899", // rose
  "#64748b", // gris ardoise
  "#d97706", // ambre foncé
  "#0891b2", // cyan foncé
  "#7c3aed", // violet foncé
  "#be123c", // rouge bourgogne
];

export const STATUTS = {
  besoin_ouvrier:{ label:"⚡ Besoin équipe", color:"#b060ff", bg:"rgba(176,96,255,0.12)", border:"rgba(176,96,255,0.35)" },
  a_commander:   { label:"À commander",     color:"#e05c5c", bg:"rgba(224,92,92,0.12)",  border:"rgba(224,92,92,0.3)"  },
  commande:      { label:"Commandé",         color:"#f5a623", bg:"rgba(245,166,35,0.12)", border:"rgba(245,166,35,0.3)" },
  retire:        { label:"Retiré ✓",         color:"#50c878", bg:"rgba(80,200,120,0.12)", border:"rgba(80,200,120,0.3)" },
};

export const THEMES = {
  dark: {
    bg:"#1e2128", surface:"#262a32", modal:"#2a2e37",
    card:"rgba(255,255,255,0.04)", cardHover:"rgba(255,194,0,0.07)",
    cardFill:"rgba(255,194,0,0.06)", border:"rgba(255,255,255,0.07)",
    borderHover:"rgba(255,194,0,0.4)", text:"#f0f0f0", textSub:"#9aa5c0",
    textMuted:"#5b6a8a", accent:"#FFC200", accentSub:"#e6ae00",
    tagBg:"rgba(255,194,0,0.18)", tagColor:"#FFC200",
    tagReelBg:"rgba(80,200,120,0.2)", tagReelColor:"#7ee8a2",
    planColor:"#FFD84D", reelColor:"#b0f0c0",
    cmdColor:"#f5d08a", cmdBg:"rgba(245,208,138,0.06)", cmdBorder:"rgba(245,208,138,0.2)",
    noteColor:"#c0b8f0", noteBg:"rgba(180,160,245,0.06)", noteBorder:"rgba(180,160,245,0.2)",
    emptyColor:"#3a4060", headerBorder:"rgba(255,255,255,0.07)",
    scrollThumb:"#3a4060", labelText:"#111318",
    fieldBg:"rgba(255,255,255,0.05)", fieldBorder:"rgba(255,255,255,0.1)",
    sectionDivider:"rgba(255,255,255,0.06)",
    sidebar:"#16181d", sidebarActive:"rgba(255,194,0,0.12)", sidebarBorder:"rgba(255,255,255,0.06)",
    widgetBg:"rgba(255,255,255,0.02)", inputBg:"rgba(255,255,255,0.06)",
  },
  light: {
    bg:"#f7f7f7", surface:"#ffffff", modal:"#ffffff",
    card:"rgba(0,0,0,0.02)", cardHover:"rgba(0,0,0,0.05)",
    cardFill:"rgba(91,138,245,0.05)", border:"rgba(0,0,0,0.09)",
    borderHover:"rgba(0,0,0,0.22)", text:"#1a1f2e", textSub:"#4a5568",
    textMuted:"#8a9ab0", accent:"#4070e8", accentSub:"#3060d0",
    tagBg:"rgba(64,112,232,0.15)", tagColor:"#3060c0",
    tagReelBg:"rgba(40,160,80,0.12)", tagReelColor:"#207040",
    planColor:"#3060c0", reelColor:"#207040",
    cmdColor:"#b06000", cmdBg:"rgba(200,140,0,0.06)", cmdBorder:"rgba(200,140,0,0.2)",
    noteColor:"#6050b0", noteBg:"rgba(100,80,200,0.06)", noteBorder:"rgba(100,80,200,0.2)",
    emptyColor:"#c0c8d8", headerBorder:"rgba(0,0,0,0.08)",
    scrollThumb:"#c0c8d8", labelText:"#1a1f2e",
    fieldBg:"rgba(0,0,0,0.03)", fieldBorder:"rgba(0,0,0,0.1)",
    sectionDivider:"rgba(0,0,0,0.06)",
    sidebar:"#1a1f2e", sidebarActive:"rgba(91,138,245,0.2)", sidebarBorder:"rgba(255,255,255,0.08)",
    widgetBg:"rgba(0,0,0,0.02)", inputBg:"rgba(0,0,0,0.04)",
  },
};

export function getWeekId(y,w){return`${y}-W${String(w).padStart(2,"0")}`;}
export function getCurrentWeek(){
  const now=new Date(),jan1=new Date(now.getFullYear(),0,1);
  const w=Math.ceil(((now-jan1)/86400000+jan1.getDay()+1)/7);
  return{year:now.getFullYear(),week:w};
}
export function getTodayJour(){
  const d=new Date().getDay();
  return JOURS_JS[d]||null;
}
export function emptyCell(){return{planifie:"",reel:"",ouvriers:[],taches:[]};}
export function parseTachesFromPlanifie(planifie,tachesExistantes){
  if(tachesExistantes&&tachesExistantes.length>0)return tachesExistantes;
  if(!planifie?.trim())return[];
  return planifie.split("\n").filter(l=>l.trim()).map(l=>({
    id:Math.random().toString(36).slice(2),text:l.trim(),ouvriers:[]
  }));
}
export function emptyCommande(){return{chantier_id:"",article:"",fournisseur:"",quantite:"",statut:"a_commander",priorite:"normal",ouvrier_demandeur:"",notes:""};}

export const DEFAULT_OUVRIERS=["JP","Stev","Kev","Reza","Hamed","Mady","Yann","Julien","Steven"];
export const DEFAULT_CHANTIERS=[
  {id:"lamartine",nom:"LAMARTINE",couleur:"#c8d8f0"},
  {id:"lou",nom:"LOU",couleur:"#ffd6cc"},
  {id:"philibert",nom:"PHILIBERT",couleur:"#fce4a0"},
  {id:"arthur",nom:"ARTHUR",couleur:"#d4edda"},
  {id:"metois",nom:"METOIS",couleur:"#d1f7e4"},
  {id:"gildas",nom:"GILDAS BAUGE 2",couleur:"#e8d0e8"},
];

// ─── BIBLIOTHÈQUE DES RATIOS ──────────────────────────────────────────────────
export const BIBLIOTHEQUE_INITIALE = [
  { identifiant:"cloison_48_standard_isol", libelle:"Cloison 48, BA13 standard + isol", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine minérale",ratio:15},
      {nom:"Plaquage BA13",ratio:35},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"cloison_48_hydro_isol", libelle:"Cloison 48 BA13 Hydro + isol", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine minérale",ratio:15},
      {nom:"Plaquage BA13 Hydro",ratio:35},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"cloison_48_standard_sans_isol", libelle:"Cloison 48, BA13 standard sans isolation", unite:"m²",
    sous_taches:[{nom:"Pose ossature métallique",ratio:30},{nom:"Plaquage BA13",ratio:40},{nom:"Bandes et enduits",ratio:30}]},
  { identifiant:"cloison_70_standard_isol", libelle:"Cloison 70, BA13 standard + isol", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine minérale",ratio:15},
      {nom:"Plaquage BA13",ratio:35},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"cloison_70_hydro_isol", libelle:"Cloison 70 BA13 Hydro + isol", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine minérale",ratio:15},
      {nom:"Plaquage BA13 Hydro",ratio:35},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"double_cloison_sad", libelle:"DOUBLE Cloison placo SAD + isol", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature double",ratio:20},{nom:"Isolation laine minérale",ratio:10},
      {nom:"Plaquage double parement",ratio:40},{nom:"Bandes et enduits",ratio:30}]},
  { identifiant:"doublage_om_laine_120", libelle:"Doublage ossature métallique + laine 120", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine 120mm",ratio:20},
      {nom:"Plaquage BA13",ratio:30},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"doublage_om_laine_140", libelle:"Doublage ossature métallique + laine 140", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature métallique",ratio:25},{nom:"Isolation laine 140mm",ratio:20},
      {nom:"Plaquage BA13",ratio:30},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"doublage_om_sans_laine", libelle:"Doublage ossature métallique SANS lainage", unite:"m²",
    sous_taches:[{nom:"Pose ossature métallique",ratio:35},{nom:"Plaquage BA13",ratio:40},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"plafond_ba13_suspente", libelle:"Plafond BA13 suspente longue (sans isolation)", unite:"m²",
    sous_taches:[{nom:"Pose ossature et suspentes",ratio:35},{nom:"Plaquage BA13",ratio:40},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"faux_plafond_rampant_laine_240", libelle:"Faux plafond rampant, laine épaisseur 240mm", unite:"m²",
    sous_taches:[
      {nom:"Pose ossature",ratio:25},{nom:"Isolation laine 240mm",ratio:20},
      {nom:"Plaquage BA13",ratio:30},{nom:"Bandes et enduits",ratio:25}]},
  { identifiant:"lainage_plafond_200", libelle:"Lainage plafond ep 200", unite:"m²",
    sous_taches:[{nom:"Pose isolation",ratio:100}]},
  { identifiant:"install_elec_t1_sans_chauf", libelle:"Installation électrique Logement T1 SANS chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t1_avec_chauf", libelle:"Installation électrique Logement T1 AVEC chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t2_sans_chauf", libelle:"Installation électrique Logement T2 SANS chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t2_avec_chauf", libelle:"Installation électrique Logement T2 AVEC chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t3_sans_chauf", libelle:"Installation électrique Logement T3 SANS chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t3_avec_chauf", libelle:"Installation électrique Logement T3 AVEC chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t4_sans_chauf", libelle:"Installation électrique Logement T4 sans chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"install_elec_t4_avec_chauf", libelle:"Installation électrique Logement T4 AVEC chauffage", unite:"U",
    sous_taches:[{nom:"Saignées et passages de câbles",ratio:20},{nom:"Pose boîtes et appareillages",ratio:25},{nom:"Réseau et câblage",ratio:30},{nom:"Tableau électrique",ratio:15},{nom:"Finitions et tests (CONSUEL)",ratio:10}]},
  { identifiant:"tableau_2r_t1", libelle:"Tableau 2R T1", unite:"U",
    sous_taches:[{nom:"Pose et fixation coffret",ratio:20},{nom:"Raccordement des circuits",ratio:60},{nom:"Tests et vérifications",ratio:20}]},
  { identifiant:"radiateur_1000w", libelle:"Radiateur 1000W", unite:"U",
    sous_taches:[{nom:"Fixation murale",ratio:40},{nom:"Raccordement électrique",ratio:60}]},
  { identifiant:"radiateur_1500w", libelle:"Radiateur 1500W", unite:"U",
    sous_taches:[{nom:"Fixation murale",ratio:40},{nom:"Raccordement électrique",ratio:60}]},
  { identifiant:"radiateur_2000w", libelle:"Radiateur 2000W", unite:"U",
    sous_taches:[{nom:"Fixation murale",ratio:40},{nom:"Raccordement électrique",ratio:60}]},
  { identifiant:"vmc_hygro", libelle:"VMC Hygro simple flux", unite:"U",
    sous_taches:[{nom:"Pose appareil et fixation",ratio:30},{nom:"Pose des bouches",ratio:30},{nom:"Raccordements électrique et conduits",ratio:40}]},
  { identifiant:"prise_simple", libelle:"Prise de courant simple ODACE", unite:"U", sous_taches:[{nom:"Dépose + repose",ratio:100}]},
  { identifiant:"prise_double", libelle:"Prise de courant double ODACE", unite:"U", sous_taches:[{nom:"Dépose + repose",ratio:100}]},
  { identifiant:"prise_triple", libelle:"Prise de courant Triple ODACE", unite:"U", sous_taches:[{nom:"Dépose + repose",ratio:100}]},
  { identifiant:"prise_usbc", libelle:"Prise de courant + Usb-c", unite:"U", sous_taches:[{nom:"Dépose + repose",ratio:100}]},
  { identifiant:"mise_a_terre", libelle:"Circuit de mise à la terre avec piquet", unite:"U", sous_taches:[{nom:"Pose piquet et câblage",ratio:100}]},
  { identifiant:"chauffe_eau_40l", libelle:"Chauffe-eau plat électrique 40 litres", unite:"U",
    sous_taches:[{nom:"Pose et fixation",ratio:20},{nom:"Canalisations eau froide/chaude",ratio:40},{nom:"Évacuation",ratio:20},{nom:"Raccordement électrique + groupe sécu",ratio:20}]},
  { identifiant:"chauffe_eau_65l", libelle:"Chauffe-eau plat électrique 65 litres", unite:"U",
    sous_taches:[{nom:"Pose et fixation",ratio:20},{nom:"Canalisations eau froide/chaude",ratio:40},{nom:"Évacuation",ratio:20},{nom:"Raccordement électrique + groupe sécu",ratio:20}]},
  { identifiant:"chauffe_eau_80l", libelle:"Chauffe-eau plat électrique 80 litres", unite:"U",
    sous_taches:[{nom:"Pose et fixation",ratio:20},{nom:"Canalisations eau froide/chaude",ratio:40},{nom:"Évacuation",ratio:20},{nom:"Raccordement électrique + groupe sécu",ratio:20}]},
  { identifiant:"wc_sol", libelle:"WC au sol", unite:"U",
    sous_taches:[{nom:"Pose et fixation",ratio:40},{nom:"Raccordement évacuation",ratio:35},{nom:"Raccordement alimentation + robinet",ratio:25}]},
  { identifiant:"meuble_vasque_60", libelle:"Meuble simple vasque 60cm", unite:"U",
    sous_taches:[{nom:"Pose meuble et fixation",ratio:40},{nom:"Raccordement alimentation",ratio:30},{nom:"Raccordement évacuation",ratio:30}]},
  { identifiant:"meuble_vasque_80", libelle:"Meuble simple vasque 80cm", unite:"U",
    sous_taches:[{nom:"Pose meuble et fixation",ratio:40},{nom:"Raccordement alimentation",ratio:30},{nom:"Raccordement évacuation",ratio:30}]},
  { identifiant:"receveur_douche_80", libelle:"Receveur de douche 80x80 cm", unite:"U",
    sous_taches:[{nom:"Pose receveur + étanchéité + bonde",ratio:20},{nom:"Pose porte et paroi vitrée",ratio:20},{nom:"Pose Dumawall",ratio:25},{nom:"Robinetterie mitigeur thermostatique",ratio:20},{nom:"Raccordements alimentation et évacuation",ratio:15}]},
  { identifiant:"porte_pvc_2000x800", libelle:"Porte 2000 x 800 PVC", unite:"U",
    sous_taches:[{nom:"Dépose existant",ratio:20},{nom:"Pose et calage",ratio:50},{nom:"Calfeutrage + finitions + quincaillerie",ratio:30}]},
  { identifiant:"escalier_quart_tournant", libelle:"Escalier 1/4 tournant bas gauche/droite sapin", unite:"U",
    sous_taches:[{nom:"Préparation et traçage",ratio:15},{nom:"Pose de la structure",ratio:50},{nom:"Fixation rampe et finitions",ratio:35}]},
  { identifiant:"plancher_solives_osb_3m", libelle:"Plancher Solive 63x175 + OSB18 portée ≤3m", unite:"m²",
    sous_taches:[{nom:"Pose solives et fixations murales",ratio:45},{nom:"Pose OSB découpe et vissage",ratio:40},{nom:"Bande résiliente et finitions",ratio:15}]},
  { identifiant:"plancher_solives_osb_4m5", libelle:"Plancher Solive 63x175 + OSB18 portée >3m", unite:"m²",
    sous_taches:[{nom:"Pose solives et fixations murales",ratio:45},{nom:"Pose OSB découpe et vissage",ratio:40},{nom:"Bande résiliente et finitions",ratio:15}]},
  { identifiant:"peinture_finition_c", libelle:"Peinture Finition C sur plaques de plâtre", unite:"m²",
    sous_taches:[{nom:"Ponçage et époussetage",ratio:20},{nom:"Impression",ratio:20},{nom:"Reprise enduit",ratio:25},{nom:"Couche de finition",ratio:35}]},
  { identifiant:"parquet_stratifie_10mm", libelle:"Parquet stratifié ép 10mm + sous-couche", unite:"m²",
    sous_taches:[{nom:"Préparation sol et sous-couche",ratio:25},{nom:"Pose des lames",ratio:55},{nom:"Pose plinthes et finitions",ratio:20}]},
  { identifiant:"parquet_pvc", libelle:"Parquet lame PVC ép 3/4mm + sous-couche", unite:"m²",
    sous_taches:[{nom:"Préparation sol et sous-couche",ratio:25},{nom:"Pose des lames",ratio:55},{nom:"Pose plinthes et finitions",ratio:20}]},
  { identifiant:"ragreage_fibre", libelle:"Ragréage fibre", unite:"m²",
    sous_taches:[{nom:"Préparation du support",ratio:30},{nom:"Application ragréage",ratio:70}]},
];

// ─── DESIGN SYSTEM ─────────────────────────────────────────────────────────────
// Tokens partagés par toute l'app. À utiliser au lieu de couleurs/valeurs
// codées en dur pour assurer la cohérence visuelle.

// Palette neutre — 9 niveaux du clair au foncé
export const NEUTRAL = {
  50:  "#f8f9fb",
  100: "#f0f2f6",
  200: "#dbdfe6",
  300: "#b6bcc8",
  400: "#7d8595",
  500: "#5a6273",
  600: "#3f4555",
  700: "#2a2e37",
  800: "#1e2128",
  900: "#16181d",
};

// Couleurs d'accentuation par branche.
// Utiliser via getBranchAccent(branch) plutôt que d'accéder direct au map.
export const BRANCH_ACCENTS = {
  renovation: {
    name: "Profero Rénovation",
    accent:      "#FFC200",
    accentDark:  "#e6ae00",
    accentLight: "#FFD84D",
    bg10:        "rgba(255,194,0,0.10)",
    bg20:        "rgba(255,194,0,0.20)",
    border:      "rgba(255,194,0,0.35)",
    onAccent:    "#1a1f2e", // texte sur fond accent
  },
  invest: {
    name: "Profero Invest",
    accent:      "#4070e8",
    accentDark:  "#3060d0",
    accentLight: "#6a90f5",
    bg10:        "rgba(64,112,232,0.10)",
    bg20:        "rgba(64,112,232,0.20)",
    border:      "rgba(64,112,232,0.35)",
    onAccent:    "#ffffff",
  },
  groupe: {
    name: "Groupe Profero",
    accent:      "#c9a14f",
    accentDark:  "#a8843e",
    accentLight: "#dbb96d",
    bg10:        "rgba(201,161,79,0.10)",
    bg20:        "rgba(201,161,79,0.20)",
    border:      "rgba(201,161,79,0.35)",
    onAccent:    "#1a1f2e",
  },
};

export function getBranchAccent(branch = "renovation") {
  return BRANCH_ACCENTS[branch] || BRANCH_ACCENTS.renovation;
}

// Espacements (multiples de 4 px). Utiliser en JS : SPACING.md, en CSS : 16
export const SPACING = { xs:4, sm:8, md:12, lg:16, xl:24, xxl:32, xxxl:48 };

// Rayons de bordure
export const RADIUS = { sm:4, md:6, lg:8, xl:12, pill:9999 };

// Tailles de police (px) — échelle restreinte pour limiter la cacophonie
export const FONT = {
  xs:   { size: 11, line: 16, weight: 600, tracking: 0.4 },
  sm:   { size: 12, line: 18, weight: 500, tracking: 0   },
  base: { size: 14, line: 20, weight: 500, tracking: 0   },
  md:   { size: 15, line: 22, weight: 600, tracking: 0   },
  lg:   { size: 17, line: 24, weight: 700, tracking: 0   },
  xl:   { size: 20, line: 28, weight: 700, tracking: 0   },
  h2:   { size: 24, line: 32, weight: 800, tracking: -0.2 },
  h1:   { size: 32, line: 40, weight: 800, tracking: -0.4 },
};

// Sémantique couleurs (statuts)
export const SEMANTIC = {
  success: { color:"#4caf78", bg:"rgba(76,175,120,0.12)", border:"rgba(76,175,120,0.30)" },
  warning: { color:"#f5a623", bg:"rgba(245,166,35,0.12)", border:"rgba(245,166,35,0.30)" },
  danger:  { color:"#e15a5a", bg:"rgba(225,90,90,0.12)",  border:"rgba(225,90,90,0.30)"  },
  info:    { color:"#5b8af5", bg:"rgba(91,138,245,0.12)", border:"rgba(91,138,245,0.30)" },
};

// Élévation (box-shadow)
export const SHADOW = {
  sm: "0 1px 2px rgba(0,0,0,0.08)",
  md: "0 2px 6px rgba(0,0,0,0.12)",
  lg: "0 8px 24px rgba(0,0,0,0.20)",
};
