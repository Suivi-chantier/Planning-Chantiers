// src/Invest/dossiers/questionnaireDossier.mjs — Questionnaire « Projet &
// situation » du Dossier Invest (Chantier 1.1, Tranche 2d).
//
// Catalogue VERSIONNÉ (pas de table administrable) : sections, questions,
// options et règles d'affichage conditionnel. Le questionnaire porte le
// CONTEXTE, la SITUATION et les OBJECTIFS du dossier. Il ne redemande pas :
//   - les faits durables du foyer (personnes, revenus, dettes, biens,
//     structures) : Situation patrimoniale (2c) ;
//   - les calculs et conclusions : Analyse (future) ;
//   - les recommandations : Stratégie (future).
// Aucune valeur par défaut : une question non répondue reste vide (jamais
// « France », « 15 ans »… hérités de l'ancien écran Structuration).
//
// Clés : « <section>__<question> ». La base connaît seulement le libellé des
// sections (invest_questionnaire_section) pour des résumés de journal lisibles.
//
// Module PUR. Façade front : ./questionnaireDossier.js.

export const QUESTIONNAIRE_VERSION = 1;

const OUI_NON = { oui: "Oui", non: "Non" };
const OUI_NON_NSP = { oui: "Oui", non: "Non", ne_sait_pas: "Ne sait pas" };
const est = (cle, ...valeurs) => (r) => valeurs.includes(valeurDe(r, cle));
const contient = (cle, v) => (r) => (valeurDe(r, cle) || []).includes(v);
const ou = (...f) => (r) => f.some((x) => x(r));

export const SECTIONS_QUESTIONNAIRE = Object.freeze([
  {
    cle: "foyer", lettre: "A", libelle: "Foyer & situation familiale",
    aide: "Les identités, professions et enfants sont dans la Situation patrimoniale : ne les ressaisissez pas ici.",
    questions: [
      { cle: "foyer__situation_familiale", libelle: "Situation familiale", type: "choix",
        options: { celibataire: "Célibataire", marie: "Marié·e", pacse: "Pacsé·e", concubinage: "Concubinage", divorce: "Divorcé·e", separe: "Séparé·e", veuf: "Veuf·ve" } },
      { cle: "foyer__regime_matrimonial", libelle: "Régime matrimonial", type: "choix", visibleSi: est("foyer__situation_familiale", "marie"),
        options: { communaute_reduite_acquets: "Communauté réduite aux acquêts", separation_biens: "Séparation de biens", participation_acquets: "Participation aux acquêts", communaute_universelle: "Communauté universelle", autre: "Autre", inconnu: "Inconnu" } },
      { cle: "foyer__contrat_mariage", libelle: "Contrat de mariage", type: "choix", options: OUI_NON_NSP, visibleSi: est("foyer__situation_familiale", "marie") },
      { cle: "foyer__date_union", libelle: "Date du mariage ou du PACS", type: "date", visibleSi: est("foyer__situation_familiale", "marie", "pacse") },
      { cle: "foyer__regime_pacs", libelle: "Régime du PACS", type: "choix", visibleSi: est("foyer__situation_familiale", "pacse"),
        options: { separation: "Séparation des patrimoines", indivision: "Indivision", inconnu: "Inconnu" } },
      { cle: "foyer__separation_en_cours", libelle: "Séparation ou divorce en cours", type: "choix", options: OUI_NON, visibleSi: est("foyer__situation_familiale", "marie", "pacse", "concubinage") },
      { cle: "foyer__complement_charge", libelle: "Précisions sur les personnes à charge ou la garde (si utile)", type: "texte_long" },
      { cle: "foyer__testament", libelle: "Testament rédigé", type: "choix", options: OUI_NON_NSP },
      { cle: "foyer__donations_anterieures", libelle: "Donations déjà consenties ou reçues", type: "choix", options: OUI_NON_NSP },
      { cle: "foyer__donations_detail", libelle: "Détail des donations", type: "texte_long", visibleSi: est("foyer__donations_anterieures", "oui") },
      { cle: "foyer__clause_beneficiaire_a_revoir", libelle: "Clause bénéficiaire d'assurance-vie à revoir", type: "choix", options: OUI_NON_NSP },
    ],
  },
  {
    cle: "pro", lettre: "B", libelle: "Situation professionnelle",
    aide: "Profession et employeur de chaque personne : Situation patrimoniale. Ici, le contexte utile à la mission.",
    questions: [
      { cle: "pro__stabilite", libelle: "Stabilité professionnelle", type: "choix", options: { stable: "Stable", changement_envisage: "Changement envisagé", en_transition: "En transition" } },
      { cle: "pro__changement_detail", libelle: "Changement envisagé", type: "texte_long", visibleSi: est("pro__stabilite", "changement_envisage", "en_transition") },
      { cle: "pro__periode_essai", libelle: "Période d'essai en cours", type: "choix", options: OUI_NON },
      { cle: "pro__fin_periode_essai", libelle: "Fin de la période d'essai", type: "date", visibleSi: est("pro__periode_essai", "oui") },
      { cle: "pro__projet_entrepreneurial", libelle: "Projet entrepreneurial", type: "choix", options: OUI_NON },
      { cle: "pro__projet_entrepreneurial_detail", libelle: "Projet entrepreneurial : détail", type: "texte_long", visibleSi: est("pro__projet_entrepreneurial", "oui") },
      { cle: "pro__evolution_revenus", libelle: "Évolution des revenus anticipée", type: "choix", options: { hausse: "Hausse", stable: "Stable", baisse: "Baisse", incertaine: "Incertaine" } },
      { cle: "pro__evolution_revenus_detail", libelle: "Évolution des revenus : précisions", type: "texte_long", visibleSi: est("pro__evolution_revenus", "hausse", "baisse", "incertaine") },
      { cle: "pro__particularites", libelle: "Autres particularités professionnelles", type: "texte_long" },
    ],
  },
  {
    cle: "fiscalite", lettre: "C", libelle: "Fiscalité",
    aide: "Informations déclarées par le client. Aucune conclusion fiscale ici.",
    questions: [
      { cle: "fiscalite__residence_foyer", libelle: "Résidence fiscale du foyer", type: "choix", options: { france: "France", etranger: "Étranger", mixte: "Mixte (plusieurs pays)" } },
      { cle: "fiscalite__pays", libelle: "Pays concernés", type: "texte", visibleSi: est("fiscalite__residence_foyer", "etranger", "mixte") },
      { cle: "fiscalite__tmi", libelle: "Tranche marginale d'imposition (si connue)", type: "choix", options: { "0": "0 %", "11": "11 %", "30": "30 %", "41": "41 %", "45": "45 %", inconnue: "Inconnue" } },
      { cle: "fiscalite__impot_revenu", libelle: "Impôt sur le revenu annuel (€)", type: "montant" },
      { cle: "fiscalite__ifi", libelle: "Assujetti à l'IFI", type: "choix", options: OUI_NON_NSP },
      { cle: "fiscalite__ifi_montant", libelle: "IFI annuel (€)", type: "montant", visibleSi: est("fiscalite__ifi", "oui") },
      { cle: "fiscalite__deficit_foncier", libelle: "Déficit foncier reportable", type: "choix", options: OUI_NON_NSP },
      { cle: "fiscalite__deficit_foncier_montant", libelle: "Déficit foncier reportable (€)", type: "montant", visibleSi: est("fiscalite__deficit_foncier", "oui") },
      { cle: "fiscalite__particularites", libelle: "Particularités fiscales déclarées", type: "texte_long" },
    ],
  },
  {
    cle: "international", lettre: "D", libelle: "International",
    aide: "À compléter seulement si le foyer est concerné. Aucune conclusion fiscale ici.",
    questions: [
      { cle: "international__concerne", libelle: "Le foyer est-il concerné par une situation internationale ?", type: "choix", options: OUI_NON },
      { cle: "international__expatriation", libelle: "Expatriation", type: "choix", visibleSi: est("international__concerne", "oui"),
        options: { actuelle: "Actuelle", envisagee: "Envisagée", aucune: "Aucune" } },
      { cle: "international__pays", libelle: "Pays", type: "texte", visibleSi: est("international__concerne", "oui") },
      { cle: "international__date", libelle: "Date prévue ou connue", type: "date", visibleSi: est("international__expatriation", "actuelle", "envisagee") },
      { cle: "international__revenus_etrangers", libelle: "Revenus de source étrangère", type: "choix", options: OUI_NON_NSP, visibleSi: est("international__concerne", "oui") },
      { cle: "international__contrat_etranger", libelle: "Contrat de travail étranger", type: "choix", options: OUI_NON_NSP, visibleSi: est("international__concerne", "oui") },
      { cle: "international__actifs_etranger", libelle: "Actifs à l'étranger", type: "texte_long", visibleSi: est("international__concerne", "oui") },
      { cle: "international__structures_etrangeres", libelle: "Structures étrangères", type: "texte_long", visibleSi: est("international__concerne", "oui") },
      { cle: "international__problematiques", libelle: "Problématiques transfrontalières déclarées", type: "texte_long", visibleSi: est("international__concerne", "oui") },
    ],
  },
  {
    cle: "objectifs", lettre: "E", libelle: "Objectifs d'investissement",
    aide: "L'apport souhaité est le montant que le client veut mobiliser ; il est distinct de l'épargne détenue (Situation patrimoniale).",
    questions: [
      { cle: "objectifs__objectif_principal", libelle: "Objectif principal", type: "choix",
        options: { rendement: "Revenus complémentaires / rendement", patrimoine: "Constitution de patrimoine", retraite: "Préparation de la retraite", fiscalite: "Optimisation fiscale", transmission: "Transmission", autre: "Autre" } },
      { cle: "objectifs__objectifs_secondaires", libelle: "Objectifs secondaires", type: "choix_multiple",
        options: { rendement: "Rendement", patrimoine: "Patrimoine", retraite: "Retraite", fiscalite: "Fiscalité", transmission: "Transmission", protection: "Protection de la famille" } },
      { cle: "objectifs__horizon", libelle: "Horizon", type: "choix", options: { moins_5: "Moins de 5 ans", "5_10": "5 à 10 ans", "10_15": "10 à 15 ans", plus_15: "Plus de 15 ans" } },
      { cle: "objectifs__budget", libelle: "Budget envisagé (€)", type: "montant" },
      { cle: "objectifs__apport_souhaite", libelle: "Apport que le client souhaite mobiliser (€)", type: "montant", aide: "Distinct de l'épargne détenue." },
      { cle: "objectifs__rythme", libelle: "Rythme d'acquisition", type: "choix", options: { une_operation: "Une opération", plusieurs: "Plusieurs opérations", progressif: "Progressif, au fil des opportunités" } },
      { cle: "objectifs__rendement_minimum", libelle: "Rendement minimum souhaité (%)", type: "pourcentage" },
      { cle: "objectifs__cashflow", libelle: "Cash-flow recherché", type: "choix", options: { positif: "Positif", equilibre: "À l'équilibre", effort_accepte: "Effort d'épargne accepté" } },
      { cle: "objectifs__effort_mensuel_max", libelle: "Effort mensuel maximum accepté (€)", type: "montant", visibleSi: est("objectifs__cashflow", "effort_accepte") },
      { cle: "objectifs__autofinancement_minimum", libelle: "Autofinancement minimum (%)", type: "pourcentage" },
      { cle: "objectifs__zones", libelle: "Zones recherchées", type: "texte" },
      { cle: "objectifs__typologies", libelle: "Typologies", type: "choix_multiple",
        options: { appartement: "Appartement", maison: "Maison", immeuble: "Immeuble", local: "Local commercial", parking: "Parking", colocation: "Colocation" } },
      { cle: "objectifs__gestion", libelle: "Mode de gestion souhaité", type: "choix", options: { deleguee: "Déléguée", autonome: "Autonome", mixte: "Mixte" } },
      { cle: "objectifs__travaux", libelle: "Travaux acceptés", type: "choix", options: { aucun: "Aucun", rafraichissement: "Rafraîchissement", renovation: "Rénovation", lourds: "Travaux lourds" } },
      { cle: "objectifs__implication", libelle: "Niveau d'implication souhaité", type: "choix", options: { faible: "Faible", moyen: "Moyen", fort: "Fort" } },
      { cle: "objectifs__urgence", libelle: "Urgence / calendrier", type: "choix", options: { immediate: "Immédiate", "3_mois": "Sous 3 mois", "6_mois": "Sous 6 mois", "12_mois": "Sous 12 mois", sans_urgence: "Sans urgence" } },
    ],
  },
  {
    cle: "banque", lettre: "F", libelle: "Banque & financement déclaré",
    aide: "Déclarations du client. Aucune capacité d'emprunt calculée ici : ce sera l'Analyse.",
    questions: [
      { cle: "banque__principale", libelle: "Banque principale", type: "texte" },
      { cle: "banque__relation", libelle: "Relation bancaire déclarée", type: "choix", options: { bonne: "Bonne", moyenne: "Moyenne", difficile: "Difficile", inconnue: "Inconnue" } },
      { cle: "banque__courtier", libelle: "Courtier", type: "choix", options: OUI_NON },
      { cle: "banque__courtier_nom", libelle: "Courtier : nom", type: "texte", visibleSi: est("banque__courtier", "oui") },
      { cle: "banque__refus_recents", libelle: "Refus de financement récents", type: "choix", options: OUI_NON },
      { cle: "banque__refus_detail", libelle: "Refus : détail", type: "texte_long", visibleSi: est("banque__refus_recents", "oui") },
      { cle: "banque__financement_en_discussion", libelle: "Financement en cours de discussion", type: "choix", options: OUI_NON },
      { cle: "banque__financement_detail", libelle: "Financement en discussion : détail", type: "texte_long", visibleSi: est("banque__financement_en_discussion", "oui") },
      { cle: "banque__contraintes", libelle: "Contraintes particulières connues", type: "texte_long" },
    ],
  },
  {
    cle: "detention", lettre: "G", libelle: "Détention & structuration",
    aide: "Souhaits et déclarations du client, pas la recommandation Profero. Les structures existantes sont dans la Situation patrimoniale.",
    questions: [
      { cle: "detention__investir", libelle: "Investir", type: "choix", options: { seul: "Seul", couple: "En couple", famille: "En famille", associes: "Avec des associés", indifferent: "Indifférent" } },
      { cle: "detention__associes_envisages", libelle: "Associés envisagés", type: "texte_long", visibleSi: est("detention__investir", "associes", "famille") },
      { cle: "detention__preferences", libelle: "Préférences de détention déclarées", type: "choix_multiple",
        options: { nom_propre: "Nom propre", sci_ir: "SCI à l'IR", sci_is: "SCI à l'IS", lmnp: "LMNP", holding: "Holding", indifferent: "Indifférent" } },
      { cle: "detention__structures_envisagees", libelle: "Structures envisagées par le client", type: "texte_long" },
      { cle: "detention__transmission", libelle: "Préoccupation de transmission", type: "choix", options: OUI_NON },
      { cle: "detention__protection_conjoint", libelle: "Protection du conjoint / de la famille", type: "choix", options: OUI_NON,
        visibleSi: ou(est("detention__investir", "couple", "famille"), est("foyer__situation_familiale", "marie", "pacse", "concubinage")) },
      { cle: "detention__objectifs_successoraux", libelle: "Objectifs successoraux", type: "texte_long",
        visibleSi: ou(est("detention__transmission", "oui"), est("objectifs__objectif_principal", "transmission"), contient("objectifs__objectifs_secondaires", "transmission")) },
    ],
  },
]);

export const QUESTIONS = Object.freeze(SECTIONS_QUESTIONNAIRE.flatMap((s) => s.questions.map((q) => ({ ...q, section: s.cle }))));

/**
 * Clés autorisées par version du catalogue, triées. C'est la SEULE source :
 * scripts/generer-questionnaire-cles-sql.mjs en tire la fonction SQL
 * invest_questionnaire_cles(version), et un test exige que la base et ce
 * module contiennent exactement le même ensemble.
 */
export const CLES_PAR_VERSION = Object.freeze({ 1: Object.freeze(QUESTIONS.map((q) => q.cle).sort()) });
const PAR_CLE = Object.fromEntries(QUESTIONS.map((q) => [q.cle, q]));
export const STATUTS_QUESTIONNAIRE = Object.freeze({ brouillon: "Brouillon", soumis: "Soumis", a_verifier: "À vérifier", valide: "Validé" });
export const VERIFICATIONS = Object.freeze({ non_verifiee: "Non vérifiée", verifiee: "Vérifiée", a_corriger: "À corriger" });
export const SOURCES = Object.freeze({ client: "Client", profero: "Profero", reprise: "Reprise" });

/** Valeur d'une réponse (null si absente). `r` = questionnaire_data. */
export function valeurDe(r, cle) { const v = r?.[cle]?.valeur; return v === undefined ? null : v; }
export const estRepondue = (v) => !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
export const questionVisible = (q, r) => !q.visibleSi || q.visibleSi(r || {});
export const questionsVisibles = (section, r) => section.questions.filter((q) => questionVisible(q, r));

/** Progression : questions VISIBLES répondues. Une réponse masquée n'est ni comptée ni supprimée. */
export function progression(r = {}) {
  const sections = SECTIONS_QUESTIONNAIRE.map((s) => {
    const vis = questionsVisibles(s, r);
    const faites = vis.filter((q) => estRepondue(valeurDe(r, q.cle)));
    const aCorriger = vis.filter((q) => r[q.cle]?.verification === "a_corriger").length;
    const verifiees = faites.filter((q) => r[q.cle]?.verification === "verifiee").length;
    return { cle: s.cle, libelle: s.libelle, visibles: vis.length, repondues: faites.length, verifiees, aCorriger,
      pourcentage: vis.length ? Math.round((faites.length / vis.length) * 100) : 0 };
  });
  const visibles = sections.reduce((a, s) => a + s.visibles, 0), repondues = sections.reduce((a, s) => a + s.repondues, 0);
  return { sections, visibles, repondues, pourcentage: visibles ? Math.round((repondues / visibles) * 100) : 0,
    aCorriger: sections.reduce((a, s) => a + s.aCorriger, 0), masqueesConservees: Object.keys(r).filter((k) => PAR_CLE[k] && !questionVisible(PAR_CLE[k], r) && estRepondue(valeurDe(r, k))).length };
}

/**
 * Réponses à envoyer pour une section : seulement les questions dont la
 * VALEUR a changé (une réponse inchangée garde sa vérification). La base
 * complète provenance, dates et vérification ; elle ne supprime jamais une
 * réponse (vider = valeur null).
 */
export function reponsesModifiees(r = {}, saisie = {}, source = "profero") {
  const out = {};
  for (const [cle, v] of Object.entries(saisie)) {
    if (!PAR_CLE[cle]) throw new Error(`Question inconnue : ${cle}`);
    const avant = valeurDe(r, cle);
    const norm = (x) => (estRepondue(x) ? (Array.isArray(x) ? [...x].sort() : x) : null);
    if (JSON.stringify(norm(avant)) === JSON.stringify(norm(v))) continue;
    out[cle] = { valeur: norm(v) === null ? null : v, source };
  }
  return out;
}

/** Synthèse affichée : Budget · apport souhaité · zones · objectif · horizon. */
export function syntheseObjectifs(r = {}) {
  const lib = (cle) => { const v = valeurDe(r, cle); return v == null ? null : PAR_CLE[cle].options?.[v] ?? v; };
  return {
    budget: valeurDe(r, "objectifs__budget"), apport: valeurDe(r, "objectifs__apport_souhaite"), zones: valeurDe(r, "objectifs__zones"),
    objectif: lib("objectifs__objectif_principal"), horizon: lib("objectifs__horizon"),
  };
}

/** Libellé lisible d'une valeur (choix, choix multiple, oui/non…). */
export function libelleValeur(q, v) {
  if (!estRepondue(v)) return "—";
  if (q.type === "choix") return q.options?.[v] ?? String(v);
  if (q.type === "choix_multiple") return (v || []).map((x) => q.options?.[x] ?? x).join(", ");
  if (q.type === "montant") return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`;
  if (q.type === "pourcentage") return `${v} %`;
  if (q.type === "date") return String(v).slice(0, 10).split("-").reverse().join("/");
  return String(v);
}
