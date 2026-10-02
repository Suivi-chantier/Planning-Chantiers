// src/Portail/portailChamps.mjs — Champs que le client peut renseigner dans son espace, et leur correspondance avec le dossier.
//
// Module pur (aucune base, aucune horloge). Reflet de public.portail_schema_reponses() (migration
// 20261002180000) : la base est la SEULE source de ce qui est accepté, ce fichier y ajoute les libellés
// pour l'écran et la correspondance avec le dossier de structuration. scripts/verif-portail-reponses.mjs
// compare les deux (types, choix, plafonds) : une divergence fait échouer le test.
//
// Le client n'écrit jamais dans le dossier. Sa saisie est validée par un collaborateur, puis appliquée
// par appliquerSection() depuis le CRM.

const enumC = (l, o) => ({ t: "enum", o, l });
const num = (l, u = "") => ({ t: "num", l, u });
const txt = (l) => ({ t: "text", l });

const SIT = ["Célibataire", "Marié(e)", "Pacsé(e)", "Divorcé(e)", "Concubinage", "Veuf/veuve"];
const REGIME = ["Communauté réduite aux acquêts", "Séparation de biens", "Participation aux acquêts", "Communauté universelle", "Non applicable"];
const ACTIVITE = ["Salarié CDI", "Salarié CDD", "Sportif professionnel", "TNS / Indépendant", "Chef d'entreprise", "Profession libérale", "Contrat étranger", "Autre"];
const RP = ["Propriétaire — crédit en cours", "Propriétaire — crédit soldé", "Locataire", "Hébergé(e)"];
const OBJECTIFS = ["Créer du patrimoine", "Revenus complémentaires", "Indépendance financière", "Retraite", "Résidence principale", "Études des enfants", "Protéger le conjoint", "Transmettre", "Réduire la fiscalité", "Diversifier", "Expatriation", "Préparer la cession d'une entreprise", "Autre"];

export const SECTIONS = Object.freeze([
  { cle: "foyer", libelle: "Votre foyer", intro: "Qui vous êtes et qui compose votre foyer." },
  { cle: "flux", libelle: "Revenus et charges", intro: "Ce qui rentre et ce qui sort chaque mois, en montants approximatifs." },
  { cle: "patrimoine", libelle: "Votre patrimoine", intro: "Votre résidence, vos biens locatifs, votre épargne." },
  { cle: "dettes", libelle: "Vos autres dettes", intro: "Les crédits en dehors de l'immobilier : auto, consommation, études…" },
  { cle: "objectifs", libelle: "Vos objectifs", intro: "Ce que vous voulez atteindre, et à quelle échéance." },
]);

export const SCHEMA = Object.freeze({
  foyer: {
    champs: {
      situation_familiale: enumC("Situation familiale", SIT), regime_matrimonial: enumC("Régime matrimonial (si marié ou pacsé)", REGIME),
      statut_pro: enumC("Activité", ACTIVITE), profession: txt("Profession"),
    },
    listes: { enfants_liste: { max: 8, l: "Vos enfants", ajout: "Ajouter un enfant", champs: {
      prenom: txt("Prénom"), naissance: { t: "date", l: "Date de naissance" }, union: enumC("Union", ["Commun", "Union précédente"]),
      a_charge: enumC("À charge", ["Oui", "Non"]), besoins: txt("Études, besoins particuliers") } } },
  },
  flux: {
    champs: {
      revenus_nets_mois: num("Vos revenus nets", "€ par mois"), revenus_conjoint_mois: num("Revenus nets de votre conjoint", "€ par mois"),
      dividendes_an: num("Dividendes", "€ par an"), autres_revenus_an: num("Autres revenus récurrents", "€ par an"),
      revenus_exceptionnels_an: num("Revenus exceptionnels (prime, cession…)", "€ par an"),
      charges_logement: num("Logement : loyer ou mensualité de votre résidence", "€ par mois"), charges_assurances: num("Assurances", "€ par mois"),
      charges_vehicules: num("Véhicules", "€ par mois"), charges_scolarite: num("Enfants, scolarité, garde", "€ par mois"),
      charges_abonnements: num("Abonnements", "€ par mois"), charges_courantes: num("Dépenses courantes", "€ par mois"),
      charges_loisirs: num("Loisirs et voyages", "€ par mois"), charges_autres: num("Autres charges fixes", "€ par mois"),
      epargne_reelle_mois: num("Ce que vous mettez réellement de côté", "€ par mois"),
    },
    listes: {},
  },
  patrimoine: {
    champs: {
      residence_principale_statut: enumC("Votre résidence principale", RP), rp_valeur: num("Valeur estimée de votre résidence", "€"), rp_crd: num("Capital restant dû sur votre résidence", "€"),
      aucun_bien: { t: "bool", l: "Je ne possède aucun bien locatif" },
      liquidites: num("Comptes et livrets", "€"), assurance_vie: num("Assurance-vie", "€"), pea_cto: num("PEA, compte-titres", "€"),
      per: num("PER, retraite", "€"), epargne_salariale: num("Épargne salariale", "€"), autres_placements: num("Autres placements", "€"),
    },
    listes: { lots: { max: 10, l: "Vos biens locatifs", ajout: "Ajouter un bien", champs: {
      adresse: txt("Adresse ou nom du bien"),
      type: enumC("Type", ["Studio", "T1", "T2", "T3", "T4", "T5+", "Commerce", "Immeuble", "SCPI", "Autre"]),
      structure: enumC("Détention", ["PP direct", "SCI IR", "SCI IS", "SARL famille", "Holding SAS", "Démembrement", "Autre"]),
      valeur: num("Valeur estimée", "€"), loyer_mois: num("Loyer", "€ par mois"), mensualite: num("Mensualité du prêt", "€ par mois"), crd: num("Capital restant dû", "€") } } },
  },
  dettes: {
    champs: { aucune_autre_dette: { t: "bool", l: "Je n'ai aucune autre dette" } },
    listes: { dettes: { max: 10, l: "Vos autres dettes", ajout: "Ajouter une dette", champs: {
      type: enumC("Type", ["Prêt étudiant", "Crédit auto", "Crédit consommation", "Prêt professionnel", "Découvert", "Dette familiale", "Caution personnelle", "Autre"]),
      capital_restant: num("Capital restant dû", "€"), mensualite: num("Mensualité", "€ par mois"), taux: num("Taux", "%") } } },
  },
  objectifs: {
    champs: {
      profil_tolerance_endettement: enumC("Votre tolérance à l'endettement", ["Faible", "Moyenne", "Élevée"]),
      profil_cashflow_negatif_max: num("Effort mensuel que vous accepteriez sur un investissement", "€ par mois"),
      profil_appetence_travaux: enumC("Les travaux", ["Aucune", "Limitée", "Forte"]),
      profil_appetence_gestion: enumC("La gestion locative", ["Délègue tout", "Partage", "Gère lui-même"]),
    },
    listes: { objectifs_mesures: { max: 6, l: "Vos objectifs", ajout: "Ajouter un objectif", champs: {
      type: enumC("Objectif", OBJECTIFS), libelle: txt("En clair (ex. 2 500 € par mois de revenus nets)"), montant: num("Montant visé", "€"),
      echeance: num("Année visée", ""), priorite: enumC("Priorité (1 = la plus importante)", ["1", "2", "3"]), flexibilite: enumC("Souplesse", ["Fixe", "Souple", "Très souple"]) } } },
  },
});

/** Le schéma réduit à ce que la base connaît (type, choix, plafond) : pour le comparer à la base. */
export function schemaTechnique() {
  const champ = (d) => (d.t === "enum" ? { t: "enum", o: d.o } : { t: d.t });
  const out = {};
  for (const [s, v] of Object.entries(SCHEMA)) {
    out[s] = { champs: Object.fromEntries(Object.entries(v.champs).map(([k, d]) => [k, champ(d)])),
      listes: Object.fromEntries(Object.entries(v.listes).map(([k, l]) => [k, { max: l.max, champs: Object.fromEntries(Object.entries(l.champs).map(([kk, d]) => [kk, champ(d)])) }])) };
  }
  return out;
}

// Où se trouve chaque donnée dans le dossier (chemins relatifs à donnees.collecte).
const CHEMINS = Object.freeze({
  foyer: { situation_familiale: ["profil", "situation_familiale"], regime_matrimonial: ["profil", "regime_matrimonial"], statut_pro: ["profil", "statut_pro"], profession: ["profil", "profession"], enfants_liste: ["enfants_liste"] },
  flux: {
    revenus_nets_mois: ["profil", "revenus_nets_mois"], revenus_conjoint_mois: ["profil", "revenus_conjoint_mois"], dividendes_an: ["profil", "dividendes_an"],
    autres_revenus_an: ["profil", "autres_revenus_an"], revenus_exceptionnels_an: ["profil", "revenus_exceptionnels_an"],
    charges_logement: ["charges", "logement"], charges_assurances: ["charges", "assurances"], charges_vehicules: ["charges", "vehicules"], charges_scolarite: ["charges", "scolarite"],
    charges_abonnements: ["charges", "abonnements"], charges_courantes: ["charges", "courantes"], charges_loisirs: ["charges", "loisirs"], charges_autres: ["charges", "autres"],
    epargne_reelle_mois: ["charges", "epargne_reelle_mois"],
  },
  patrimoine: {
    residence_principale_statut: ["patrimoine", "residence_principale_statut"], rp_valeur: ["patrimoine", "rp_valeur"], rp_crd: ["patrimoine", "rp_crd"], aucun_bien: ["patrimoine", "aucun_bien"],
    liquidites: ["patrimoine_financier", "liquidites"], assurance_vie: ["patrimoine_financier", "assurance_vie"], pea_cto: ["patrimoine_financier", "pea_cto"],
    per: ["patrimoine_financier", "per"], epargne_salariale: ["patrimoine_financier", "epargne_salariale"], autres_placements: ["patrimoine_financier", "autres"], lots: ["patrimoine", "lots"],
  },
  dettes: { aucune_autre_dette: ["patrimoine", "aucune_autre_dette"], dettes: ["dettes"] },
  objectifs: {
    profil_tolerance_endettement: ["profil_immo", "tolerance_endettement"], profil_cashflow_negatif_max: ["profil_immo", "cashflow_negatif_max"],
    profil_appetence_travaux: ["profil_immo", "appetence_travaux"], profil_appetence_gestion: ["profil_immo", "appetence_gestion"], objectifs_mesures: ["objectifs_mesures"],
  },
});
export const cheminsPortail = CHEMINS;

const lire = (obj, chemin) => chemin.reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const vide = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** Les valeurs du dossier pour une section (reflet de portail_donnees_dossier, avant nettoyage). */
export function extraireSection(donnees, section) {
  const c = donnees?.collecte || {};
  const out = {};
  for (const [cle, chemin] of Object.entries(CHEMINS[section])) out[cle] = lire(c, chemin);
  return out;
}

/** Applique une réponse VALIDÉE du client au dossier. Renvoie un nouveau dossier ; l'ancien n'est pas modifié. */
export function appliquerSection(donnees, section, reponse) {
  const next = structuredClone(donnees || {});
  next.collecte = next.collecte || {};
  const poser = (chemin, valeur) => {
    let o = next.collecte;
    chemin.slice(0, -1).forEach((k) => { o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}; o = o[k]; });
    o[chemin[chemin.length - 1]] = valeur;
  };
  const sch = SCHEMA[section];
  for (const cle of Object.keys(sch.champs)) {
    if (!(cle in (reponse || {}))) continue;                       // champ non renseigné par le client : le dossier est conservé
    poser(CHEMINS[section][cle], reponse[cle]);
  }
  for (const cle of Object.keys(sch.listes)) {
    if (!Array.isArray(reponse?.[cle])) continue;
    const anciens = lire(next.collecte, CHEMINS[section][cle]);
    const base = Array.isArray(anciens) ? anciens : [];
    // Les éléments sont rapprochés par POSITION (le client part de la liste du dossier) : les champs que le client
    // ne voit pas (prix d'achat, taxe foncière, identifiant…) sont conservés ; ce qu'il retire est retiré.
    poser(CHEMINS[section][cle], reponse[cle].map((el, i) => ({ ...(base[i] || {}), ...el })));
  }
  return next;
}

/** Différences entre une réponse et le dossier, lisibles par un collaborateur. */
export function ecarts(donnees, section, reponse) {
  const sch = SCHEMA[section];
  const actuel = extraireSection(donnees, section);
  const lignes = [];
  const fmt = (v, d) => (vide(v) ? "—" : d.t === "bool" ? (v === true || v === "true" ? "Oui" : "Non") : `${v}${d.u ? " " + d.u.replace("€ par", "€/").replace("€", "€") : ""}`);
  for (const [cle, d] of Object.entries(sch.champs)) {
    if (!(cle in (reponse || {}))) continue;
    const avant = actuel[cle], apres = reponse[cle];
    if (String(avant ?? "") === String(apres ?? "")) continue;
    lignes.push({ cle, libelle: d.l, avant: fmt(avant, d), apres: fmt(apres, d), nouveau: vide(avant) });
  }
  for (const [cle, l] of Object.entries(sch.listes)) {
    if (!Array.isArray(reponse?.[cle])) continue;
    const avant = Array.isArray(actuel[cle]) ? actuel[cle] : [];
    const apres = reponse[cle];
    const champs = Object.keys(l.champs);
    const nb = Math.max(avant.length, apres.length);
    for (let i = 0; i < nb; i++) {
      if (i >= apres.length) { lignes.push({ cle: `${cle}[${i}]`, libelle: `${l.l} n° ${i + 1}`, avant: "présent dans le dossier", apres: "retiré par le client", nouveau: false, retrait: true }); continue; }
      if (i >= avant.length) { lignes.push({ cle: `${cle}[${i}]`, libelle: `${l.l} n° ${i + 1}`, avant: "—", apres: champs.map((k) => apres[i][k]).filter((x) => !vide(x)).join(" · "), nouveau: true }); continue; }
      for (const k of champs) {
        if (!(k in apres[i])) continue;
        if (String(avant[i][k] ?? "") === String(apres[i][k] ?? "")) continue;
        lignes.push({ cle: `${cle}[${i}].${k}`, libelle: `${l.l} n° ${i + 1} — ${l.champs[k].l}`, avant: fmt(avant[i][k], l.champs[k]), apres: fmt(apres[i][k], l.champs[k]), nouveau: vide(avant[i][k]) });
      }
    }
  }
  return lignes;
}

/** Avancement du client dans « Mon dossier » : sections remplies / à relire. */
export function avancementClient(reponses = {}) {
  const parSection = SECTIONS.map((s) => {
    const r = reponses[s.cle];
    return { ...s, statut: r?.statut || "vide" };
  });
  const envoyees = parSection.filter((s) => ["soumis", "valide"].includes(s.statut)).length;
  return { parSection, envoyees, total: SECTIONS.length };
}
