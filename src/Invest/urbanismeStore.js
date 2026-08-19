import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// URBANISME — référentiel et persistance de la Fiche de Demande Urbanisme (FDU)
//
// Ce fichier ne contient aucun JSX : d'un côté le référentiel métier (nature
// des demandes, grille des pièces, délais d'instruction), de l'autre les
// fonctions pures qui en tirent la complétude et le rétroplanning. La page
// Urbanisme.jsx ne fait que les afficher.
//
// Pourquoi séparer : la règle « une FDU incomplète repart au commercial » et
// les délais d'instruction sont du métier, pas de l'interface. Ils doivent
// pouvoir évoluer (une commune, un délai qui change) sans toucher aux écrans,
// et être lisibles par quelqu'un qui ne lit pas React.
// ─────────────────────────────────────────────────────────────────────────────

export const URBA_TABLE = "invest_urbanisme_dossiers";

/* ============ Bloc 1 — identification ============ */

export const URBA_ENTITES = ["Profero Invest", "Profero Rénovation"];

export const URBA_ORIGINES_CONTRAINTE = [
  "Date compromis",
  "Condition suspensive",
  "Date acte",
  "Démarrage chantier prévu",
  "Autre",
];

/* ============ Cycle de vie ============ */

// `commercial` : le dossier est dans les mains du commercial, pas du pôle
// urbanisme. C'est ce qui permet de compter ce qui traîne côté terrain.
export const URBA_STATUTS = [
  { id:"brouillon",      label:"Brouillon",              tone:"commercial", color:"#94A3B8", aide:"FDU en cours de saisie par le commercial" },
  { id:"transmis",       label:"Transmise",              tone:"urbanisme",  color:"#5b8af5", aide:"Reçue par le pôle urbanisme, en cours de vérification" },
  { id:"attente_pieces", label:"En attente de pièces",   tone:"commercial", color:"#f5a623", aide:"Repartie au commercial : blocs ou pièces manquants" },
  { id:"complet",        label:"Complet",                tone:"urbanisme",  color:"#4caf78", aide:"Dossier complet, prêt à déposer en mairie" },
  { id:"depose",         label:"Déposé",                 tone:"mairie",     color:"#4070e8", aide:"Dépôt effectué, instruction en cours" },
  { id:"pieces_mairie",  label:"Pièces mairie",          tone:"mairie",     color:"#f97316", aide:"Pièces complémentaires demandées : le délai repart à zéro" },
  { id:"accorde",        label:"Accordé",                tone:"mairie",     color:"#4caf78", aide:"Autorisation obtenue, recours des tiers en cours" },
  { id:"refuse",         label:"Refusé",                 tone:"mairie",     color:"#e15a5a", aide:"Refus notifié" },
  { id:"purge",          label:"Purgé",                  tone:"mairie",     color:"#22c55e", aide:"Recours des tiers purgé, chantier démarrable" },
  { id:"abandonne",      label:"Abandonné",              tone:"commercial", color:"#5b6a8a", aide:"Demande abandonnée" },
];

export const urbaStatut = (id) =>
  URBA_STATUTS.find(s => s.id === id) || URBA_STATUTS[0];

// Statuts pour lesquels le dépôt n'est pas encore fait : ce sont eux que
// l'échéance « date maximum de dépôt » concerne.
export const URBA_STATUTS_AVANT_DEPOT = ["brouillon", "transmis", "attente_pieces", "complet"];

export const URBA_AUTORISATIONS = ["DP", "PC", "À trancher"];

/* ============ Bloc 4 — nature de la demande ============ */

// `blocs` : les blocs de détail que cocher cette nature rend obligatoires.
export const URBA_NATURES = [
  { id:"division",      label:"Division de logement(s)",                        blocs:["division", "surfaces"] },
  { id:"menuiseries",   label:"Changement de menuiseries",                      blocs:["facade"] },
  { id:"ouverture",     label:"Création ou modification d'ouverture",           blocs:["facade"], aide:"ex. porte de garage → baie vitrée" },
  { id:"velux",         label:"Création de fenêtre(s) de toit / Velux",         blocs:["facade"] },
  { id:"ravalement",    label:"Ravalement / modification d'aspect extérieur",   blocs:["facade"], aide:"enduit, bardage, couleur" },
  { id:"extension",     label:"Extension / surélévation",                       blocs:["surfaces"] },
  { id:"destination",   label:"Changement de destination",                      blocs:["surfaces"], aide:"ex. local commercial → habitation" },
  { id:"cloture",       label:"Clôture, portail, muret",                        blocs:[] },
  { id:"stationnement", label:"Création / modification de stationnement",       blocs:["stationnement"] },
  { id:"autre",         label:"Autre",                                          blocs:[] },
];

// Natures qui touchent l'aspect extérieur : elles imposent le tableau du
// bloc 6, point n°1 de blocage et rédhibitoire en secteur ABF.
export const URBA_NATURES_FACADE = ["menuiseries", "ouverture", "velux", "ravalement", "extension"];

/* ============ § 3 — grille : quoi fournir selon le type de demande ============ */

// Grille indicative : la commune et le PLU font foi, le pôle urbanisme tranche
// après vérification. Elle sert à deux choses — l'afficher au commercial, et
// déduire quelles pièces sont attendues (voir `urbaExigences`).
export const URBA_GRILLE = [
  { nature:"menuiseries",   travaux:"Changement de menuiseries à l'identique", autorisation:"DP",
    plansNiveaux:"Non",                plansFacades:"Oui (existant / projeté)", photos:"Oui", menuiseries:"Oui, ligne par ligne",            surfaces:"Non" },
  { nature:"ouverture",     travaux:"Création d'ouverture", autorisation:"DP",
    plansNiveaux:"Oui",                plansFacades:"Oui",                      photos:"Oui", menuiseries:"Oui + cotes de positionnement",  surfaces:"Non" },
  { nature:"velux",         travaux:"Fenêtre de toit / Velux", autorisation:"DP",
    plansNiveaux:"Oui (niveau concerné)", plansFacades:"Oui (toiture)",         photos:"Oui", menuiseries:"Oui (modèle + versant)",         surfaces:"Non" },
  { nature:"division",      travaux:"Division en logements", autorisation:"DP ou PC selon commune",
    plansNiveaux:"Oui, tous niveaux",  plansFacades:"Oui si façade modifiée",    photos:"Oui", menuiseries:"Oui",                            surfaces:"Oui" },
  { nature:"extension",     travaux:"Extension / surélévation", autorisation:"DP < 20 m² (ou 40 m² en zone U), PC au-delà",
    plansNiveaux:"Oui",                plansFacades:"Oui",                      photos:"Oui", menuiseries:"Oui",                            surfaces:"Oui" },
  { nature:"destination",   travaux:"Changement de destination", autorisation:"DP (PC si façade modifiée)",
    plansNiveaux:"Oui",                plansFacades:"Oui si modification",      photos:"Oui", menuiseries:"Selon",                          surfaces:"Oui" },
  { nature:"ravalement",    travaux:"Ravalement / bardage", autorisation:"DP (selon commune)",
    plansNiveaux:"Non",                plansFacades:"Oui",                      photos:"Oui", menuiseries:"Non",                            surfaces:"Non" },
];

/* ============ § 2 — checklist des pièces à joindre ============ */

// `requis(ctx)` renvoie true quand la pièce est obligatoire pour ce dossier.
// ctx = { natures:Set, facade:bool, abf:bool, dejaProprietaire, societeExistante,
//         copro, coproPartiesCommunes, autorisation }
export const URBA_PIECES = [
  { id:"plans_niveaux", label:"Plan de chaque niveau avec délimitation des futurs logements, surface et typologie",
    format:"PDF coté, échelle indiquée", quand:"Toute division / création de logement", producteur:"Commercial (via architecte / métreur / dessinateur)",
    requis:(c) => c.natures.has("division") || c.natures.has("ouverture") || c.natures.has("velux") || c.natures.has("extension") || c.natures.has("destination") },

  { id:"plan_masse", label:"Plan de masse de la parcelle",
    format:"PDF", quand:"PC, division, extension, stationnement", producteur:"Commercial",
    requis:(c) => c.autorisation === "PC" || c.natures.has("division") || c.natures.has("extension") || c.natures.has("stationnement") },

  { id:"plan_coupe", label:"Plan de coupe du terrain et de la construction",
    format:"PDF", quand:"Extension, surélévation, modification du volume", producteur:"Architecte / dessinateur",
    requis:(c) => c.natures.has("extension") },

  { id:"plans_facades", label:"Plans de façades existantes et projetées",
    format:"PDF", quand:"Toute modification d'aspect extérieur", producteur:"Architecte / dessinateur",
    requis:(c) => c.facade },

  { id:"photos_facades", label:"Photos des façades concernées",
    format:"JPEG, nettes, de jour, façade entière", quand:"Dès que la façade n'est pas visible depuis la rue (Maps inexploitable)", producteur:"Commercial ou équipe terrain",
    requis:(c) => c.facade || c.facadeNonVisible },

  { id:"photos_environnement", label:"Photos environnement proche et lointain",
    format:"JPEG", quand:"Toute DP / PC", producteur:"Commercial",
    requis:() => true },

  { id:"extrait_cadastral", label:"Extrait cadastral",
    format:"PDF", quand:"Systématique", producteur:"Pôle urbanisme",
    requis:() => true },

  { id:"compromis", label:"Compromis de vente ou attestation du propriétaire",
    format:"PDF", quand:"Si le client n'est pas encore propriétaire", producteur:"Commercial",
    requis:(c) => !c.dejaProprietaire },

  { id:"kbis", label:"Kbis / statuts de la société",
    format:"PDF", quand:"Si société existante", producteur:"Commercial",
    requis:(c) => c.societeExistante },

  { id:"devis_menuiseries", label:"Devis ou fiches techniques menuiseries",
    format:"PDF", quand:"Si ABF ou modèle imposé", producteur:"Profero Rénovation",
    requis:(c) => c.abf && c.facade },

  { id:"accord_ag", label:"Accord d'AG de copropriété",
    format:"PDF", quand:"Travaux touchant les parties communes", producteur:"Commercial",
    requis:(c) => c.coproPartiesCommunes },

  { id:"notice_materiaux", label:"Notice descriptive des matériaux et couleurs",
    format:"Texte", quand:"Systématique en ABF", producteur:"Commercial + Rénovation",
    requis:(c) => c.abf },
];

// Une pièce compte comme au dossier à partir de « Reçue » : « Demandée » ne
// protège de rien le jour du dépôt.
export const URBA_PIECE_STATUTS = [
  { id:"a_produire",  label:"À produire",  color:"#94A3B8", acquise:false },
  { id:"demandee",    label:"Demandée",    color:"#f5a623", acquise:false },
  { id:"recue",       label:"Reçue",       color:"#5b8af5", acquise:true  },
  { id:"validee",     label:"Validée",     color:"#4caf78", acquise:true  },
  { id:"sans_objet",  label:"Sans objet",  color:"#5b6a8a", acquise:true  },
];

export const urbaPieceStatut = (id) =>
  URBA_PIECE_STATUTS.find(s => s.id === id) || URBA_PIECE_STATUTS[0];

// Cadrage des photos — consigne à transmettre aux équipes terrain.
export const URBA_CADRAGE_PHOTOS = [
  "Une photo de la façade entière, de face, sans obstacle, de jour",
  "Une photo par menuiserie concernée, avec un mètre déroulé ou un repère d'échelle",
  "Une photo de l'environnement immédiat (mitoyens, rue)",
];

export const URBA_NOMMAGE_FICHIERS = "ADRESSE_FACADE-NORD_01.jpg";

/* ============ § 4 — les délais ============ */

// `ouvres` = jours ouvrés, `mois` = mois calendaires. Deux colonnes : régime
// standard et secteur ABF.
export const URBA_DELAIS = [
  { id:"prep_dp",         etape:"Préparation du dossier en interne (DP)",              std:{ ouvres:10 }, abf:{ ouvres:15 } },
  { id:"prep_pc",         etape:"Préparation du dossier en interne (PC ou division)",  std:{ ouvres:20 }, abf:{ ouvres:25 } },
  { id:"instr_dp",        etape:"Instruction déclaration préalable",                   std:{ mois:1 },    abf:{ mois:2 } },
  { id:"instr_pc_mi",     etape:"Instruction PC maison individuelle",                  std:{ mois:2 },    abf:{ mois:3 } },
  { id:"instr_pc",        etape:"Instruction PC autres cas",                           std:{ mois:3 },    abf:{ mois:4 } },
  { id:"pieces_mairie",   etape:"Demande de pièces complémentaires par la mairie",     texte:"Peut survenir dans le 1er mois, relance le délai à zéro", texteAbf:"idem" },
  { id:"recours",         etape:"Affichage sur le terrain + recours des tiers",         std:{ mois:2 },    abf:{ mois:2 }, apres:"instruction" },
  { id:"retrait",         etape:"Retrait possible par l'administration",               std:{ mois:3 },    abf:{ mois:3 }, apres:"instruction" },
];

// Règle commerciale : ce qu'un commercial peut promettre devant un client.
export const URBA_REGLE_COMMERCIALE =
  "Entre le dépôt et un démarrage de chantier purgé de tout recours, compter "
  + "3 mois minimum pour une DP simple et 5 à 6 mois pour un PC en secteur ABF. "
  + "Toute promesse plus courte est un risque de litige.";

/* ============ § 5 — todo du commercial ============ */

export const URBA_TODO = [
  { id:"e1", titre:"Étape 1 — Dès la visite du bien", items:[
    { id:"e1a", label:"Relever l'adresse exacte + prendre les références cadastrales" },
    { id:"e1b", label:"Prendre les photos de toutes les façades, y compris non visibles de la rue" },
    { id:"e1c", label:"Relever les dimensions des menuiseries existantes" },
    { id:"e1d", label:"Repérer les possibilités de stationnement sur la parcelle" },
    { id:"e1e", label:"Vérifier si le bien est en périmètre ABF (site officiel / mairie)" },
  ]},
  { id:"e2", titre:"Étape 2 — Dès l'accord client / signature du compromis", items:[
    { id:"e2a", label:"Confirmer l'identité du demandeur (société ou personne physique) et récupérer SIRET ou état civil complet" },
    { id:"e2b", label:"Fixer avec le client la date maximum de dépôt en fonction des conditions suspensives" },
    { id:"e2c", label:"Commander les plans (métreur / dessinateur / architecte) en précisant le rendu attendu" },
    { id:"e2d", label:"Alerter le client si un architecte est obligatoire (personne morale + PC)" },
  ]},
  { id:"e3", titre:"Étape 3 — Avant d'envoyer la FDU au pôle urbanisme", items:[
    { id:"e3a", label:"Bloc 6 rempli ligne par ligne (aucune case vide)" },
    { id:"e3b", label:"Plans reçus, cotés, lisibles, au bon format" },
    { id:"e3c", label:"Photos nommées et classées dans le Drive du chantier" },
    { id:"e3d", label:"Surfaces calculées (emprise au sol + surface de plancher, existant et créé)" },
    { id:"e3e", label:"Toutes les pièces déposées dans le dossier Drive dédié" },
    { id:"e3f", label:"Relire la checklist des pièces et cocher" },
  ]},
  { id:"e4", titre:"Étape 4 — Après le dépôt", items:[
    { id:"e4a", label:"Récupérer le récépissé de dépôt et le classer" },
    { id:"e4b", label:"Poser l'échéance de fin d'instruction dans Google Agenda (agenda partagé Urbanisme)" },
    { id:"e4c", label:"Faire poser le panneau d'affichage réglementaire dès obtention + constat d'huissier si enjeu fort" },
    { id:"e4d", label:"Informer le client de la date de purge du recours des tiers" },
  ]},
];

/* ============ § 6 — les 6 oublis à éliminer ============ */

// Chaque oubli porte son propre test : le panneau anti-oubli ne récite pas une
// liste, il dit lequel des six manque sur CE dossier.
export const URBA_OUBLIS = [
  { id:"o1", label:"Le détail précis des menuiseries (nombre, emplacement, dimensions, modèle)", rang:"n°1",
    test:(d) => !urbaFacadeConcernee(d) || urbaLignesFacadeCompletes(d) },
  { id:"o2", label:"Les photos des façades non visibles depuis la rue",
    test:(d) => {
      const p = d?.pieces?.photos_facades;
      return !urbaFacadeConcernee(d) || urbaPieceStatut(p?.statut).acquise;
    }},
  { id:"o3", label:"Le SIRET ou l'état civil complet du demandeur",
    test:(d) => urbaDemandeurComplet(d) },
  { id:"o4", label:"Les références cadastrales",
    test:(d) => (d?.bien?.cadastre || []).some(p => txt(p?.section) && txt(p?.numero)) },
  { id:"o5", label:"Les surfaces (emprise au sol / surface de plancher, existant vs créé)",
    test:(d) => !urbaSurfacesConcernees(d) || urbaSurfacesRemplies(d) },
  { id:"o6", label:"La date maximum de dépôt et sa justification",
    test:(d) => txt(d?.identification?.date_max_depot) && txt(d?.identification?.origine_contrainte) },
];

/* ============ Dossier vide ============ */

const txt = (v) => String(v ?? "").trim();

export const urbaLigneFacadeVide = (n = 1) => ({
  id: "l" + n + "_" + Math.random().toString(36).slice(2, 7),
  facade:"", niveau:"", piece:"", existant:"", projete:"",
  largeur:"", hauteur:"", materiau:"", couleur:"", type_ouverture:"", modele:"",
});

export const urbaLogementVide = (n = 1) => ({
  id: "g" + n + "_" + Math.random().toString(36).slice(2, 7),
  numero:"", niveau:"", typologie:"", surface_habitable:"", surface_plancher:"",
});

export const urbaBatimentVide = (nom = "Bâtiment principal") => ({
  id: "b_" + Math.random().toString(36).slice(2, 7),
  nom,
  emprise_existant:"", emprise_cree:"",
  plancher_existant:"", plancher_cree:"",
  taxable_existant:"", taxable_cree:"",
  niveaux_existant:"", niveaux_cree:"",
});

export function urbaDossierVide(base = {}) {
  return {
    identification: {
      reference: base.reference || "",
      entite: base.entite || "Profero Invest",
      commercial: base.commercial || "",
      date_demande: base.date_demande || "",
      date_max_depot: base.date_max_depot || "",
      origine_contrainte: "",
      origine_autre: "",
      date_notaire: "",
      date_travaux: "",
      deja_proprietaire: "",           // 'Oui' | 'Non'
    },
    demandeur: {
      type: "societe",                 // 'societe' (existante) | 'a_creer'
      societe: { denomination:"", forme:"", siret:"", adresse_siege:"", representant:"", qualite:"", telephone:"", email:"" },
      futur:   { nom:"", naissance_date:"", naissance_lieu:"", adresse:"", telephone:"", email:"", date_immatriculation:"", depot_particulier:"" },
      architecte_alerte: false,        // le point de vigilance a été remonté au client
    },
    bien: {
      adresse: base.adresse || "", code_postal: base.code_postal || "", commune: base.commune || "",
      cadastre: [{ id:"p1", section:"", numero:"", surface:"" }],
      zone_plu:"", abf:"À vérifier",
      copro:"", copro_parties_communes:false,
      occupation:"", servitudes:"", assainissement:"",
      contact_nom:"", contact_tel:"",
      facade_non_visible:false,
    },
    nature: { natures:[], autre_precision:"", autorisation:"À trancher", pc_maison_individuelle:false },
    division: {
      nb_avant:"", nb_apres:"", logements:[urbaLogementVide(1)],
      exploitation:"", compteurs:{ eau:"", elec:"", gaz:"" }, acces:"", acces_precision:"",
    },
    facade: {
      lignes:[urbaLigneFacadeVide(1)],
      vitrage:"", petits_bois:"", volets:"", velux_precisions:"", cotes_positionnement:"",
    },
    surfaces: { batiments:[urbaBatimentVide()] },
    stationnement: {
      possible:"", nb_places:"", emplacement:"", couvertes:"", non_couvertes:"",
      derogation:"", derogation_justification:"", local_velo:"", local_poubelles:"",
    },
    complement: "",
    pieces: {},                        // { [pieceId]: { statut, responsable, lien, commentaire } }
    todo: {},                          // { [itemId]: true }
    validation: {
      commercial_nom: base.commercial || "", commercial_date:"", commercial_visa:"",
      reception_nom:"", reception_date:"", reception_visa:"", notes:"",
    },
    suivi: {
      date_depot:"", recepisse_lien:"",
      date_pieces_mairie:"", date_reponse_pieces:"",
      date_decision:"", decision:"",
      date_affichage:"", agenda_pose:false, client_informe:false,
    },
  };
}

/* ============ Lecture du dossier ============ */

export const urbaNaturesSet = (d) => new Set((d?.nature?.natures) || []);

export const urbaFacadeConcernee = (d) => {
  const s = urbaNaturesSet(d);
  return URBA_NATURES_FACADE.some(n => s.has(n));
};

export const urbaSurfacesConcernees = (d) => {
  const s = urbaNaturesSet(d);
  return s.has("division") || s.has("extension") || s.has("destination");
};

export const urbaDivisionConcernee = (d) => urbaNaturesSet(d).has("division");

export const urbaStationnementConcerne = (d) => urbaNaturesSet(d).has("stationnement");

export const urbaEstABF = (d) => d?.bien?.abf === "Oui";

export const urbaSocieteExistante = (d) => (d?.demandeur?.type || "societe") === "societe";

// Personne morale : société existante, ou société à créer dont le dépôt n'est
// pas fait au nom du particulier.
export const urbaPersonneMorale = (d) =>
  urbaSocieteExistante(d) || d?.demandeur?.futur?.depot_particulier !== "Oui";

// Lignes du bloc 6 réellement renseignées (une ligne vide ne compte pas).
export const urbaLignesFacade = (d) =>
  (d?.facade?.lignes || []).filter(l =>
    txt(l?.facade) || txt(l?.existant) || txt(l?.projete) || txt(l?.largeur) || txt(l?.hauteur)
  );

const LIGNE_FACADE_CHAMPS = ["facade", "niveau", "existant", "projete", "largeur", "hauteur", "materiau", "couleur", "type_ouverture"];

export const urbaLigneFacadeManques = (l = {}) =>
  LIGNE_FACADE_CHAMPS.filter(k => !txt(l[k]));

export const urbaLignesFacadeCompletes = (d) => {
  const lignes = urbaLignesFacade(d);
  return lignes.length > 0 && lignes.every(l => urbaLigneFacadeManques(l).length === 0);
};

export function urbaDemandeurComplet(d) {
  if (urbaSocieteExistante(d)) {
    const s = d?.demandeur?.societe || {};
    const siret = txt(s.siret).replace(/\s/g, "");
    return Boolean(txt(s.denomination) && txt(s.forme) && siret.length === 14
      && txt(s.adresse_siege) && txt(s.representant) && txt(s.qualite)
      && (txt(s.telephone) || txt(s.email)));
  }
  const f = d?.demandeur?.futur || {};
  return Boolean(txt(f.nom) && txt(f.naissance_date) && txt(f.naissance_lieu)
    && txt(f.adresse) && (txt(f.telephone) || txt(f.email)));
}

export const urbaSurfacesRemplies = (d) =>
  (d?.surfaces?.batiments || []).some(b =>
    txt(b?.emprise_existant) !== "" && txt(b?.plancher_existant) !== ""
    && (txt(b?.emprise_cree) !== "" || txt(b?.plancher_cree) !== "")
  );

// Surface de plancher totale après travaux, tous bâtiments confondus. Sert au
// seuil des 150 m² qui déclenche l'architecte pour une personne physique.
export const urbaSurfacePlancherTotale = (d) =>
  (d?.surfaces?.batiments || []).reduce((s, b) =>
    s + num(b?.plancher_existant) + num(b?.plancher_cree), 0);

const num = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const urbaTotal = (existant, cree) => {
  if (txt(existant) === "" && txt(cree) === "") return "";
  const t = num(existant) + num(cree);
  return Number.isInteger(t) ? String(t) : t.toFixed(2).replace(".", ",");
};

/* ============ Architecte obligatoire ============ */

// Personne morale : architecte obligatoire pour tout PC, sans seuil de surface.
// Personne physique : exemption jusqu'à 150 m² de surface de plancher.
// Ce n'est pas un détail administratif — ça change le budget ET le délai, donc
// ça doit être su avant de promettre une date.
export function urbaArchitecte(d) {
  const pc = (d?.nature?.autorisation || "") === "PC";
  if (!pc) {
    return { obligatoire:false, motif:"", incertain:(d?.nature?.autorisation || "") === "À trancher" };
  }
  if (urbaPersonneMorale(d)) {
    return {
      obligatoire:true,
      motif:"Le demandeur est une personne morale (SCI, SAS…) : le recours à un architecte est obligatoire pour tout permis de construire, sans seuil de surface.",
      incertain:false,
    };
  }
  const sp = urbaSurfacePlancherTotale(d);
  if (sp > 150) {
    return {
      obligatoire:true,
      motif:"Personne physique au-delà de 150 m² de surface de plancher (" + sp.toFixed(0) + " m² après travaux) : l'exemption ne joue plus.",
      incertain:false,
    };
  }
  return {
    obligatoire:false,
    motif:"Personne physique sous 150 m² de surface de plancher : exemption applicable.",
    incertain:sp === 0,
  };
}

/* ============ Pièces attendues ============ */

export function urbaContexte(d) {
  return {
    natures: urbaNaturesSet(d),
    facade: urbaFacadeConcernee(d),
    facadeNonVisible: Boolean(d?.bien?.facade_non_visible),
    abf: urbaEstABF(d),
    dejaProprietaire: (d?.identification?.deja_proprietaire || "") === "Oui",
    societeExistante: urbaSocieteExistante(d),
    copro: (d?.bien?.copro || "") === "Oui",
    coproPartiesCommunes: (d?.bien?.copro || "") === "Oui" && Boolean(d?.bien?.copro_parties_communes),
    autorisation: d?.nature?.autorisation || "",
  };
}

// Pièces attendues pour ce dossier, avec leur état.
export function urbaExigences(d) {
  const ctx = urbaContexte(d);
  return URBA_PIECES.map(p => {
    const etat = d?.pieces?.[p.id] || {};
    const requis = p.requis(ctx);
    const statut = etat.statut || "a_produire";
    return {
      ...p,
      requis,
      statut,
      acquise: urbaPieceStatut(statut).acquise,
      responsable: etat.responsable || "",
      lien: etat.lien || "",
      commentaire: etat.commentaire || "",
      manquante: requis && !urbaPieceStatut(statut).acquise,
    };
  });
}

export const urbaPiecesManquantes = (d) => urbaExigences(d).filter(p => p.manquante);

// Lignes de la grille § 3 qui concernent ce dossier.
export const urbaGrilleActive = (d) => {
  const s = urbaNaturesSet(d);
  return URBA_GRILLE.filter(g => s.has(g.nature));
};

/* ============ Complétude — la règle d'or ============ */

// Une FDU incomplète n'est pas prise en charge et repart au commercial. Cette
// fonction est ce qui donne un sens vérifiable à cette phrase : elle liste
// champ par champ ce qui manque, bloc par bloc, en ne réclamant que les blocs
// que la nature de la demande rend applicables.
export function urbaChampsRequis(d) {
  const L = [];
  const add = (bloc, label, ok) => L.push({ bloc, label, ok:Boolean(ok) });

  const id = d?.identification || {};
  add("1", "N° de dossier / référence chantier", txt(id.reference));
  add("1", "Entité concernée", txt(id.entite));
  add("1", "Commercial demandeur", txt(id.commercial));
  add("1", "Date de la demande", txt(id.date_demande));
  add("1", "Date maximum de dépôt", txt(id.date_max_depot));
  add("1", "Origine de la contrainte de date", txt(id.origine_contrainte)
    && (id.origine_contrainte !== "Autre" || txt(id.origine_autre)));
  add("1", "Date prévisionnelle de démarrage des travaux", txt(id.date_travaux));
  add("1", "Le client est-il déjà propriétaire ?", txt(id.deja_proprietaire));

  add("2", urbaSocieteExistante(d)
        ? "Société : dénomination, forme, SIRET à 14 chiffres, siège, représentant, contact"
        : "Futur dirigeant : état civil complet, adresse, contact",
      urbaDemandeurComplet(d));

  const b = d?.bien || {};
  add("3", "Adresse complète du bien", txt(b.adresse) && txt(b.commune));
  add("3", "Références cadastrales (section + numéro)",
    (b.cadastre || []).some(p => txt(p?.section) && txt(p?.numero)));
  add("3", "Périmètre ABF tranché (Oui / Non)", b.abf === "Oui" || b.abf === "Non");
  add("3", "Bien en copropriété ?", txt(b.copro));
  add("3", "Bien occupé ou vacant", txt(b.occupation));
  add("3", "Assainissement", txt(b.assainissement));
  add("3", "Contact sur place (photos / mesures)", txt(b.contact_nom) && txt(b.contact_tel));

  const nat = d?.nature || {};
  add("4", "Nature de la demande (au moins une case)", (nat.natures || []).length > 0);
  if ((nat.natures || []).includes("autre")) {
    add("4", "Précision « Autre »", txt(nat.autre_precision));
  }

  if (urbaDivisionConcernee(d)) {
    const dv = d?.division || {};
    add("5", "Nombre de logements avant / après", txt(dv.nb_avant) && txt(dv.nb_apres));
    add("5", "Détail par logement (niveau, typologie, surfaces)",
      (dv.logements || []).some(g => txt(g?.niveau) && txt(g?.typologie) && txt(g?.surface_habitable)));
    add("5", "Type d'exploitation visé", txt(dv.exploitation));
    add("5", "Accès aux logements", txt(dv.acces));
  }

  if (urbaFacadeConcernee(d)) {
    const lignes = urbaLignesFacade(d);
    add("6", "Tableau façade / toiture : au moins une ligne", lignes.length > 0);
    add("6", "Tableau façade / toiture : aucune case vide", lignes.length > 0 && urbaLignesFacadeCompletes(d));
    if (urbaNaturesSet(d).has("velux")) {
      add("6", "Velux : versant, dimensions, modèle", txt(d?.facade?.velux_precisions));
    }
    if (urbaNaturesSet(d).has("ouverture")) {
      add("6", "Création : cotes de positionnement (nu du mur, allège)", txt(d?.facade?.cotes_positionnement));
    }
    add("6", "Vitrage, petits bois, volets", txt(d?.facade?.vitrage) && txt(d?.facade?.volets));
  }

  if (urbaSurfacesConcernees(d)) {
    add("7", "Surfaces : emprise au sol et surface de plancher (existant + créé)", urbaSurfacesRemplies(d));
  }

  if (urbaStationnementConcerne(d)) {
    const st = d?.stationnement || {};
    add("8", "Stationnement possible sur la parcelle ?", txt(st.possible));
    if (st.possible === "Oui") {
      add("8", "Nombre de places + emplacement reporté sur le plan de masse", txt(st.nb_places) && txt(st.emplacement));
    }
    if (st.possible === "Non") {
      add("8", "Dérogation à formuler + justification", txt(st.derogation)
        && (st.derogation !== "Oui" || txt(st.derogation_justification)));
    }
  }

  add("9", "Informations complémentaires (champ libre obligatoire)", txt(d?.complement));

  add("10", "Visa du commercial (fiche complète et vérifiée)",
    txt(d?.validation?.commercial_nom) && txt(d?.validation?.commercial_date) && txt(d?.validation?.commercial_visa));

  return L;
}

export function urbaCompletude(d) {
  const champs = urbaChampsRequis(d);
  const manquants = champs.filter(c => !c.ok);
  const pieces = urbaPiecesManquantes(d);
  const total = champs.length;
  const ok = total - manquants.length;
  return {
    champs,
    manquants,
    pieces,
    total,
    ok,
    pct: total ? Math.round((ok / total) * 100) : 0,
    // La FDU ne part que si les champs ET les pièces obligatoires sont là.
    transmissible: manquants.length === 0 && pieces.length === 0,
  };
}

/* ============ Dates ============ */

const parseISO = (s) => {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
};

export const urbaISO = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

// Jours ouvrés : n peut être négatif pour remonter dans le temps (c'est ce que
// fait le rétroplanning depuis la date maximum de dépôt).
export function urbaJoursOuvres(date, n) {
  const d = parseISO(date) || (date instanceof Date ? new Date(date) : null);
  if (!d) return null;
  const pas = n < 0 ? -1 : 1;
  let restant = Math.abs(n);
  const out = new Date(d);
  while (restant > 0) {
    out.setDate(out.getDate() + pas);
    const j = out.getDay();
    if (j !== 0 && j !== 6) restant--;
  }
  return out;
}

export function urbaAjouterMois(date, n) {
  const d = parseISO(date) || (date instanceof Date ? new Date(date) : null);
  if (!d) return null;
  const out = new Date(d);
  const jour = out.getDate();
  out.setMonth(out.getMonth() + n);
  // 31 janvier + 1 mois = 28/29 février, et pas le 2 ou 3 mars.
  if (out.getDate() < jour) out.setDate(0);
  return out;
}

export const urbaFmtDate = (d) => {
  const x = d instanceof Date ? d : parseISO(d);
  return x ? x.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" }) : "—";
};

export const urbaJoursRestants = (date) => {
  const x = parseISO(date);
  if (!x) return null;
  const now = new Date(); now.setHours(12, 0, 0, 0);
  return Math.round((x - now) / 86400000);
};

/* ============ Rétroplanning ============ */

// Délai d'instruction applicable, en mois.
export function urbaDelaiInstruction(d) {
  const abf = urbaEstABF(d);
  const a = d?.nature?.autorisation || "";
  if (a === "DP") return { mois: abf ? 2 : 1, libelle:"Instruction déclaration préalable" };
  if (a === "PC") {
    if (d?.nature?.pc_maison_individuelle) return { mois: abf ? 3 : 2, libelle:"Instruction PC maison individuelle" };
    return { mois: abf ? 4 : 3, libelle:"Instruction PC autres cas" };
  }
  // Autorisation non tranchée : on annonce le cas le plus long, jamais le plus
  // court — un commercial qui lit cet écran ne doit pas repartir avec une date
  // optimiste qu'il faudra démentir.
  return { mois: abf ? 4 : 3, libelle:"Autorisation à trancher — hypothèse la plus longue" };
}

export function urbaDelaiPreparation(d) {
  const abf = urbaEstABF(d);
  const lourd = (d?.nature?.autorisation || "") === "PC" || urbaDivisionConcernee(d);
  const base = lourd ? 20 : 10;
  return { ouvres: base + (abf ? 5 : 0), lourd };
}

// Le rétroplanning complet. C'est l'outil à montrer au client : il part de la
// date maximum de dépôt (ou du dépôt réel s'il a eu lieu) et va jusqu'au
// démarrage de chantier purgé de tout recours.
export function urbaRetroplanning(d) {
  const id = d?.identification || {};
  const suivi = d?.suivi || {};
  const abf = urbaEstABF(d);
  const prep = urbaDelaiPreparation(d);
  const instr = urbaDelaiInstruction(d);

  const dateMaxDepot = id.date_max_depot || "";
  // Une demande de pièces complémentaires relance l'instruction à zéro : le
  // point de départ devient la date de réponse à la mairie.
  const departInstruction = suivi.date_reponse_pieces || suivi.date_depot || dateMaxDepot || "";

  const lancementInterne = dateMaxDepot ? urbaJoursOuvres(dateMaxDepot, -prep.ouvres) : null;
  const finInstruction   = departInstruction ? urbaAjouterMois(departInstruction, instr.mois) : null;
  const finRecours       = finInstruction ? urbaAjouterMois(finInstruction, 2) : null;
  const finRetrait       = finInstruction ? urbaAjouterMois(finInstruction, 3) : null;

  const etapes = [
    { id:"lancement",  label:"Lancer la préparation en interne",
      date:lancementInterne, delai:prep.ouvres + " jours ouvrés" + (abf ? " (dont +5 ABF)" : ""),
      aide:prep.lourd ? "PC ou division" : "DP" },
    { id:"depot",      label:suivi.date_depot ? "Dépôt effectué" : "Dépôt en mairie (au plus tard)",
      date:parseISO(suivi.date_depot || dateMaxDepot), delai:"—",
      aide:suivi.date_depot ? "Récépissé à classer" : (txt(id.origine_contrainte) || "Contrainte à justifier") },
    { id:"instruction", label:"Fin d'instruction",
      date:finInstruction, delai:instr.mois + (instr.mois > 1 ? " mois" : " mois"),
      aide:instr.libelle + (suivi.date_reponse_pieces ? " — relancée après pièces complémentaires" : "") },
    { id:"recours",    label:"Purge du recours des tiers",
      date:finRecours, delai:"2 mois après affichage", aide:"Affichage sur le terrain dès obtention" },
    { id:"retrait",    label:"Fin du délai de retrait par l'administration",
      date:finRetrait, delai:"3 mois", aide:"Sécurité maximale avant engagement de dépenses" },
  ];

  const alertes = [];
  if (!dateMaxDepot) {
    alertes.push({ level:"danger", label:"Date maximum de dépôt non renseignée : aucun rétroplanning possible." });
  } else if (lancementInterne && !suivi.date_depot) {
    const reste = urbaJoursRestants(urbaISO(lancementInterne));
    if (reste !== null && reste < 0 && URBA_STATUTS_AVANT_DEPOT.includes(d?._statut || "brouillon")) {
      alertes.push({ level:"danger", label:"La préparation devait démarrer le " + urbaFmtDate(lancementInterne) + " : " + Math.abs(reste) + " jour(s) de retard." });
    } else if (reste !== null && reste <= 7) {
      alertes.push({ level:"warning", label:"Préparation à lancer avant le " + urbaFmtDate(lancementInterne) + " (dans " + reste + " jour(s))." });
    }
  }

  if (id.date_travaux && finRecours) {
    const travaux = parseISO(id.date_travaux);
    if (travaux && travaux < finRecours) {
      alertes.push({
        level:"danger",
        label:"Démarrage travaux annoncé le " + urbaFmtDate(travaux) + ", or le recours des tiers n'est purgé que le "
          + urbaFmtDate(finRecours) + ". Date intenable en l'état.",
      });
    }
  }

  if (id.date_notaire && dateMaxDepot) {
    const notaire = parseISO(id.date_notaire);
    const depot = parseISO(dateMaxDepot);
    if (notaire && depot && depot > notaire && (d?.identification?.deja_proprietaire || "") !== "Oui") {
      alertes.push({ level:"warning", label:"Dépôt prévu après la signature notaire : vérifier l'autorisation du propriétaire actuel." });
    }
  }

  if ((d?.nature?.autorisation || "") === "À trancher") {
    alertes.push({ level:"warning", label:"Régime d'autorisation non tranché : les délais affichés retiennent l'hypothèse la plus longue." });
  }

  const arch = urbaArchitecte(d);
  if (arch.obligatoire && !d?.demandeur?.architecte_alerte) {
    alertes.push({ level:"warning", label:"Architecte obligatoire — le point n'a pas encore été remonté au client (budget et délai impactés)." });
  }

  return {
    abf, prep, instr, etapes, alertes,
    lancementInterne, finInstruction, finRecours, finRetrait,
    // Ce que le commercial peut promettre, en mois depuis le dépôt.
    moisJusquauChantier: instr.mois + 2,
  };
}

/* ============ Supabase ============ */

const COLONNES_LISTE = [
  "id", "reference", "entite", "commercial", "adresse", "code_postal", "commune",
  "statut", "natures", "autorisation", "abf",
  "date_demande", "date_max_depot", "date_depot", "date_fin_instruction",
  "completude", "nb_menuiseries", "nb_pieces_manquantes",
  "bien_id", "client_id", "auteur", "transmis_le", "created_at", "updated_at",
].join(",");

export async function listerDossiers() {
  const { data, error } = await supabase
    .from(URBA_TABLE)
    .select(COLONNES_LISTE)
    .order("updated_at", { ascending:false });
  if (error) throw error;
  return data || [];
}

export async function chargerDossier(id) {
  const { data, error } = await supabase.from(URBA_TABLE).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function creerDossier(row) {
  const { data, error } = await supabase.from(URBA_TABLE).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function majDossier(id, patch) {
  const { error } = await supabase.from(URBA_TABLE).update(patch).eq("id", id);
  if (error) throw error;
}

export async function supprimerDossier(id) {
  const { error } = await supabase.from(URBA_TABLE).delete().eq("id", id);
  if (error) throw error;
}

// Colonnes dénormalisées reconstruites à chaque enregistrement : la liste de
// suivi n'a alors jamais à ouvrir le JSONB pour trier ou alerter.
export function urbaColonnes(donnees, statut) {
  const c = urbaCompletude(donnees);
  const id = donnees?.identification || {};
  const b = donnees?.bien || {};
  const retro = urbaRetroplanning({ ...donnees, _statut:statut });
  return {
    reference: txt(id.reference) || "Sans référence",
    entite: id.entite || "Profero Invest",
    commercial: txt(id.commercial) || null,
    adresse: txt(b.adresse) || null,
    code_postal: txt(b.code_postal) || null,
    commune: txt(b.commune) || null,
    natures: donnees?.nature?.natures || [],
    autorisation: donnees?.nature?.autorisation || null,
    abf: b.abf || "À vérifier",
    date_demande: id.date_demande || null,
    date_max_depot: id.date_max_depot || null,
    date_depot: donnees?.suivi?.date_depot || null,
    date_fin_instruction: retro.finInstruction ? urbaISO(retro.finInstruction) : null,
    completude: c.pct,
    nb_menuiseries: urbaLignesFacade(donnees).length,
    nb_pieces_manquantes: c.pieces.length,
    donnees,
  };
}
