// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — définition des 12 points de la « Procédure
// de préparation de chantier — v2 » (tâche 3 du projet
// docs/projets/fiche-securite-chantier.md).
//
// La spécification nomme ce fichier `securite/points.ts` ; le dépôt est en
// JavaScript : configuration en module pur `.mjs` (importable par Node pour
// les vérifications), façade `points.js` pour le front.
//
// LA BASE NE STOCKE QUE LES RÉPONSES. Ajouter une case = ajouter une ligne
// ici. Ne jamais renommer le `code` d'une case déjà utilisée : les réponses
// enregistrées y sont rattachées par ce code (une case retirée d'ici n'efface
// rien en base, la réponse est conservée telle quelle).
//
// Libellés des cases : proposés à partir de la spécification (le PDF v2 n'est
// pas dans le dépôt) — à faire relire par François.
//
// `concerneSi` : énoncé de la règle de proposition automatique (tâche 6,
// pré-remplissage), affiché tel quel. Le calcul est fait par
// securitePreRemplissage.mjs à partir des déclencheurs listés plus bas
// (DECLENCHEURS_PRE_REMPLISSAGE) ; une proposition ne valide jamais un point
// seule (un clic sur « Appliquer la proposition » est toujours nécessaire).
//
// Justificatifs : `type_code` = valeurs du check de
// securite_justificatifs.type_code (contrôlé par scripts/verif-securite-fiche.mjs).
// `requis: true` = attendu pour valider un point « concerné » (règle appliquée
// à la tâche 4) ; `requis: false` = selon la situation.
//
// Module PUR : aucune donnée Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────

/** Statuts possibles d'un point (identiques à la structure `reponses`). */
export const STATUTS_POINT = Object.freeze([
  Object.freeze({ id: "a_completer",  label: "À compléter" }),
  Object.freeze({ id: "concerne",     label: "Concerné" }),
  Object.freeze({ id: "non_concerne", label: "Non concerné" }),
]);

/** Statuts qui comptent un point comme complété (même liste que la vue securite_fiches_etat). */
export const STATUTS_POINT_COMPLETE = Object.freeze(["concerne", "non_concerne"]);

/** Libellés des types de justificatifs (check securite_justificatifs.type_code). */
export const LIBELLES_JUSTIFICATIFS = Object.freeze({
  reperage_amiante:             "Repérage amiante avant travaux",
  dta:                          "Dossier technique amiante (DTA)",
  mode_operatoire_amiante:      "Mode opératoire amiante (SS4)",
  formation_ss4:                "Attestation de formation amiante SS4",
  aptitude_medicale:            "Aptitude médicale (confidentiel)",
  pv_echafaudage:               "PV de réception de l'échafaudage",
  formation_echafaudage:        "Formation montage / utilisation d'échafaudage",
  habilitation_electrique:      "Habilitation électrique",
  recepisse_dict:               "Récépissé de DICT",
  autorisation_voirie:          "Autorisation de voirie",
  fiche_remise_epi:             "Fiche de remise des EPI",
  consigne_travail_isole:       "Consigne de travail isolé",
  accord_sanitaires:            "Accord pour l'usage de sanitaires",
  contrat_location:             "Contrat de location (matériel, base vie)",
  pgc:                          "Plan général de coordination (PGC)",
  ppsps:                        "PPSPS",
  registre_journal:             "Registre-journal de coordination",
  contrat_sous_traitance:       "Contrat de sous-traitance",
  kbis:                         "Extrait Kbis",
  attestation_decennale:        "Attestation d'assurance décennale",
  attestation_vigilance_urssaf: "Attestation de vigilance URSSAF",
  duerp:                        "Document unique (DUERP)",
  photo:                        "Photo",
  autre:                        "Autre document",
});

const c = (code, libelle) => Object.freeze({ code, libelle });
const j = (type_code, requis = false) => Object.freeze({ type_code, requis });

/**
 * Les 12 points, dans l'ordre du PDF v2.
 *   section : "intervenants" (point 1, colonne `intervenants`),
 *             "donnees_base" (point 2, colonne `donnees_base`),
 *             "synthese" (point 3, colonne `synthese_risques`),
 *             "carte" (points 4 à 12, colonne `reponses`, clé `cle`).
 * L'écran affiche la synthèse (point 3) APRÈS les cartes 4 à 12, comme le PDF.
 */
export const POINTS_FICHE = Object.freeze([
  Object.freeze({
    numero: 1, cle: "p1", section: "intervenants", titre: "Intervenants",
    objet: "Responsable du chantier, client, adresse, entreprises présentes.",
    cases: Object.freeze([]),
    justificatifs: Object.freeze([j("contrat_sous_traitance"), j("kbis"), j("attestation_vigilance_urssaf"), j("attestation_decennale")]),
    concerneSi: "Toujours concerné : Profero et chaque prestataire présent au planning du chantier sont proposés ; responsable saisi à la main.",
  }),
  Object.freeze({
    numero: 2, cle: "p2", section: "donnees_base", titre: "Données de base",
    objet: "Lots, dates, effectif, occupation des lieux, accès ; données du bâtiment.",
    cases: Object.freeze([]),
    justificatifs: Object.freeze([j("autorisation_voirie")]),
    concerneSi: "Toujours concerné : lots = lots distincts du phasage ; date de dépose des sanitaires = plus petite date prévue des tâches de dépose de WC, lavabo ou douche.",
  }),
  Object.freeze({
    numero: 3, cle: "p3", section: "synthese", titre: "Synthèse des risques",
    objet: "Les 2 ou 3 risques principaux du chantier, à rappeler à chaque accueil.",
    cases: Object.freeze([]),
    justificatifs: Object.freeze([j("duerp")]),
    concerneSi: "Risques proposés dans cet ordre : amiante, chute de hauteur, électricité, poussières (2 ou 3 lignes à garder).",
  }),
  Object.freeze({
    numero: 4, cle: "p4", section: "carte", titre: "Amiante",
    objet: "Bâtiment dont le permis est antérieur au 1er juillet 1997.",
    cases: Object.freeze([
      c("reperage_consulte",    "Repérage amiante avant travaux (ou DTA) consulté"),
      c("zones_signalees",      "Zones et matériaux amiantés identifiés et signalés à l'équipe"),
      c("mode_operatoire_ss4",  "Mode opératoire SS4 établi pour toute intervention sur matériau amianté"),
      c("intervenants_ss4",     "Intervenants formés SS4 et aptes médicalement"),
      c("arret_si_decouverte",  "Consigne d'arrêt immédiat en cas de matériau suspect découvert"),
    ]),
    justificatifs: Object.freeze([j("reperage_amiante", true), j("dta"), j("mode_operatoire_amiante"), j("formation_ss4"), j("aptitude_medicale")]),
    concerneSi: "Concerné si le permis de construire est antérieur au 1er juillet 1997 ; date inconnue = à compléter.",
  }),
  Object.freeze({
    numero: 5, cle: "p5", section: "carte", titre: "Chute de hauteur",
    objet: "Faux plafonds, plafonds, menuiseries extérieures, trémies, toiture.",
    cases: Object.freeze([
      c("zones_listees",       "Zones de travail en hauteur listées"),
      c("tremies_protegees",   "Trémies et vides protégés (garde-corps, platelage)"),
      c("echafaudage_verifie", "Échafaudage monté et vérifié (PV de réception)"),
      c("pirl_prevues",        "Plateformes individuelles roulantes prévues (pas d'escabeau comme poste de travail)"),
      c("protection_collective", "Protection collective en priorité ; harnais seulement à défaut"),
    ]),
    justificatifs: Object.freeze([j("pv_echafaudage"), j("formation_echafaudage"), j("contrat_location")]),
    concerneSi: "Concerné si un ouvrage de faux plafond, plafond, menuiserie extérieure, trémie ou toiture est prévu au phasage.",
  }),
  Object.freeze({
    numero: 6, cle: "p6", section: "carte", titre: "Électricité",
    objet: "Toujours concerné : réseaux existants, consignation, habilitations.",
    cases: Object.freeze([
      c("consignation",          "Mise hors tension / consignation avant intervention"),
      c("habilitation_verifiee", "Habilitation électrique des intervenants vérifiée"),
      c("reseaux_reperes",       "Réseaux encastrés repérés avant perçage ou saignée"),
      c("coffret_chantier",      "Alimentation de chantier protégée (coffret avec différentiel 30 mA)"),
      c("dict_faite",            "DICT faite si travaux à proximité de réseaux extérieurs"),
    ]),
    justificatifs: Object.freeze([j("habilitation_electrique", true), j("recepisse_dict")]),
    concerneSi: "Toujours concerné ; lot électricité au phasage = habilitation exigée pour au moins un intervenant.",
  }),
  Object.freeze({
    numero: 7, cle: "p7", section: "carte", titre: "Poussières et silice",
    objet: "Démolition, maçonnerie, cloisons, carrelage, ponçage.",
    cases: Object.freeze([
      c("aspiration_source", "Outils avec aspiration à la source"),
      c("travail_humide",    "Travail à l'humide quand c'est possible"),
      c("zone_confinee",     "Zone de travail isolée des parties occupées"),
      c("nettoyage_aspirateur", "Nettoyage par aspirateur, pas de balayage à sec"),
      c("masques_ffp3",      "Masques FFP3 fournis et portés"),
    ]),
    justificatifs: Object.freeze([j("fiche_remise_epi")]),
    concerneSi: "Concerné si un lot démolition, maçonnerie ou murs-cloisons, ou un ouvrage de carrelage ou de ponçage, est prévu au phasage.",
  }),
  Object.freeze({
    numero: 8, cle: "p8", section: "carte", titre: "Manutention",
    objet: "Étage sans ascenseur utilisable, plaques, sacs, menuiseries.",
    cases: Object.freeze([
      c("livraisons_planifiees", "Livraisons planifiées (lieu, horaire, au plus près de la zone de travail)"),
      c("aides_manutention",     "Aides à la manutention prévues (diable, monte-matériaux, lève-plaque)"),
      c("port_a_deux",           "Charges lourdes ou encombrantes portées à deux"),
      c("acces_degages",         "Cheminements et escaliers dégagés"),
      c("ascenseur_protege",     "Ascenseur protégé s'il est utilisé"),
    ]),
    justificatifs: Object.freeze([j("contrat_location")]),
    concerneSi: "Concerné si le logement est à l'étage 1 ou plus sans ascenseur utilisable ; quantités commandées en aide.",
  }),
  Object.freeze({
    numero: 9, cle: "p9", section: "carte", titre: "Travail isolé",
    objet: "Jours où une seule personne est présente sur le chantier.",
    cases: Object.freeze([
      c("jours_identifies",   "Jours de travail isolé identifiés"),
      c("moyen_alerte",       "Moyen d'alerte (téléphone chargé, appel de contrôle convenu)"),
      c("travaux_interdits",  "Travaux dangereux interdits en travail isolé"),
      c("consigne_remise",    "Consigne de travail isolé remise"),
    ]),
    justificatifs: Object.freeze([j("consigne_travail_isole", true)]),
    concerneSi: "Concerné si au moins un jour planifié n'a qu'une seule personne sur le chantier.",
  }),
  Object.freeze({
    numero: 10, cle: "p10", section: "carte", titre: "Équipements de protection individuelle (EPI)",
    objet: "Toujours concerné : EPI à fournir selon les risques des points 4 à 8.",
    cases: Object.freeze([
      c("chaussures",      "Chaussures de sécurité"),
      c("gants",           "Gants adaptés"),
      c("lunettes",        "Lunettes de protection"),
      c("casque",          "Casque"),
      c("auditives",       "Protections auditives"),
      c("masque_ffp3",     "Masque FFP3"),
      c("harnais",         "Harnais (si pas de protection collective)"),
      c("combinaison",     "Combinaison jetable"),
    ]),
    justificatifs: Object.freeze([j("fiche_remise_epi", true)]),
    concerneSi: "Toujours concerné ; EPI ajoutés selon les points 4, 5 et 7 et le lot démolition.",
  }),
  Object.freeze({
    numero: 11, cle: "p11", section: "carte", titre: "Sanitaires",
    objet: "Toujours concerné : WC, point d'eau, solution après dépose des sanitaires.",
    cases: Object.freeze([
      c("sanitaires_disponibles", "WC et point d'eau disponibles pendant toute la durée du chantier"),
      c("solution_apres_depose",  "Solution de remplacement prévue à partir de la dépose des sanitaires"),
      c("vestiaire_repas",        "Lieu pour se changer et prendre les repas"),
      c("eau_potable",            "Eau potable disponible"),
      c("trousse_secours",        "Trousse de premiers secours sur place"),
    ]),
    justificatifs: Object.freeze([j("accord_sanitaires"), j("contrat_location")]),
    concerneSi: "Toujours concerné ; solution de remplacement exigée à partir de la date de dépose des sanitaires.",
  }),
  Object.freeze({
    numero: 12, cle: "p12", section: "carte", titre: "Coordination",
    objet: "Plus d'une entreprise au point 1, même successivement.",
    cases: Object.freeze([
      c("planning_partage",  "Planning d'intervention partagé avec chaque entreprise"),
      c("documents_legaux",  "Contrats et documents légaux des sous-traitants à jour"),
      c("ppsps_recus",       "PPSPS reçus (si requis)"),
      c("pgc_transmis",      "PGC transmis (si coordonnateur SPS)"),
      c("registre_tenu",     "Registre-journal de coordination tenu"),
      c("accueil_commun",    "Accueil sécurité commun organisé"),
    ]),
    justificatifs: Object.freeze([j("ppsps"), j("pgc"), j("registre_journal"), j("contrat_sous_traitance")]),
    concerneSi: "Concerné si plus d'une entreprise au point 1, même successivement.",
  }),
]);

/** Points affichés en carte (4 à 12), dans l'ordre. */
export const POINTS_CARTES = Object.freeze(POINTS_FICHE.filter((p) => p.section === "carte"));

/** Clés autorisées dans la colonne `reponses` (p4 … p12). */
export const CLES_REPONSES = Object.freeze(POINTS_CARTES.map((p) => p.cle));

export function pointParNumero(numero) {
  return POINTS_FICHE.find((p) => p.numero === Number(numero)) || null;
}

export function pointParCle(cle) {
  return POINTS_FICHE.find((p) => p.cle === cle) || null;
}

export function libelleJustificatif(typeCode) {
  return LIBELLES_JUSTIFICATIFS[typeCode] || (typeCode ? `type inconnu (${typeCode})` : "type non renseigné");
}

export function libelleStatutPoint(id) {
  const s = STATUTS_POINT.find((x) => x.id === id);
  return s ? s.label : (id ? `statut inconnu (${id})` : "À compléter");
}

// ─── Déclencheurs du pré-remplissage (tâche 6) ───────────────────────────────
// LISTE UNIQUE des lots et codes d'ouvrage qui déclenchent les propositions.
// Origine (relevé sur la vraie base le 25/11/2026, lecture seule) :
//   - lots : planning_config « lots_travaux » (Admin → Lots). Les lots
//     « Sol » et « Plafond » ont été créés dans l'appli : leur identifiant est
//     généré (lot_1783405744817, lot_1783409027948), pas un mot.
//   - codes : en tête du libellé des ouvrages (« PL-002 : … »), lus par
//     codeOuvrage.mjs, d'après bibliotheque_ratios et les ouvrages des
//     phasages. Un code écrit « D-14 » ou « D-014 » est le même (on compare le
//     préfixe et la valeur du numéro). Un préfixe seul (« PL ») couvre tous
//     les numéros.
//   - mots du libellé : SEULEMENT pour un ouvrage sans code (beaucoup
//     d'ouvrages anciens ou importés n'en ont pas : « Faux-plafond SDB »,
//     « Pose d'un carrelage »…). Comparaison sans accents ni majuscules.
// Ajouter un code ici suffit : le module de calcul n'en contient aucun.
export const DECLENCHEURS_PRE_REMPLISSAGE = Object.freeze({
  /** Lot démolition (points 2, 7, 10 et dépose des sanitaires). */
  lotDemolition: "demolition",
  /** Lot électricité (point 6 : habilitation exigée). */
  lotElectricite: "electricite",
  /** Point 5 — chute de hauteur. */
  chuteHauteur: Object.freeze({
    lots: Object.freeze(["lot_1783409027948"]), // « Plafond »
    codes: Object.freeze([
      "PL",                 // faux-plafonds et plafonds (PL-001 à PL-004…)
      "COUV",               // couverture (COUV-001)
      "LOC-001",            // location d'échafaudage roulant
      "V-002",              // sortie de toiture VMC
      "D-014",              // dépose d'un faux-plafond (écrit aussi « D-14 »)
      "D-020",              // création d'une trémie d'escalier
      "D-031",              // dépose d'une menuiserie extérieure
      "ME-021", "ME-022", "ME-023", "ME-024", // portes-fenêtres, baies vitrées
      "ME-031", "ME-032", "ME-033", "ME-034", "ME-035", // fenêtres, baie
      "ME-036", "ME-037",   // fenêtres de toit
      "ME-038", "ME-039", "ME-040", // fenêtres
      "ME-044", "ME-045", "ME-046", "ME-047", "ME-048", "ME-049", // baie et fenêtres aluminium / PVC
    ]),
    mots: Object.freeze(["faux plafond", "faux-plafond", "plafond", "plafonds", "fenetre", "fenetres", "porte-fenetre",
      "baie vitree", "tremie", "toiture", "couverture", "velux", "echafaudage", "rampant", "ardoise", "chenal", "chenau"]),
  }),
  /** Point 7 — poussières et silice. */
  poussieres: Object.freeze({
    lots: Object.freeze(["demolition", "maconnerie", "murs_cloison"]),
    codes: Object.freeze([
      "S-004",              // carrelage au sol
      "S-007",              // faïence murale
      "P-1005",             // réfection des joints de faïence
      "D-023",              // dépose de faïence
      "ME-0014",            // ponçage d'une porte
    ]),
    mots: Object.freeze(["carrelage", "faience", "carreaux", "poncage"]),
  }),
  /** Point 2 (et 11) — dépose des sanitaires (WC, lavabo, douche). */
  deposeSanitaires: Object.freeze({
    lots: Object.freeze(["demolition"]), // les mots ne valent que dans ce lot (ou sans lot)
    codes: Object.freeze([
      "D-004",              // dépose totale de la salle de bain
      "D-015",              // dépose d'un lavabo ou lave-mains
      "D-016",              // dépose de WC
      "D-017",              // démolition d'un receveur de douche
      "D-026",              // dépose d'une baignoire
    ]),
    // « dépose » + un de ces mots dans le libellé
    mots: Object.freeze(["wc", "lavabo", "lave-mains", "douche", "receveur", "baignoire", "salle de bain"]),
  }),
  /** Point 8 — quantités commandées affichées en aide (libellé ou unité). */
  manutention: Object.freeze({
    // « plaque » seul est écarté : « ODACE PLAQUE 2 POSTES » est une plaque d'interrupteur.
    plaques: Object.freeze(["plq", "plaque de platre", "plaques de platre", "plaque platre", "ba13", "ba 13", "ba18", "placo"]),
    // « kg » = un poids de 20 kg ou plus écrit dans le libellé (« SAC 25 KG », « 25KG ») ;
    // un joint de 2 kg n'est pas une charge lourde.
    sacs: Object.freeze(["sac", "sacs", "kg"]),
    menuiseries: Object.freeze(["fenetre", "porte", "bloc-porte", "baie", "menuiserie", "velux", "chassis"]),
  }),
  /** Point 1 — entreprise toujours présente. */
  entreprisePrincipale: "Profero",
});
