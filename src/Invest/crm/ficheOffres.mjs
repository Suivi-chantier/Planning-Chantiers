// src/Invest/crm/ficheOffres.mjs — logique PURE de la fiche client « poste de pilotage ».
//
// Aucun accès Supabase, aucune horloge (la date du jour arrive en paramètre), aucun effet de bord.
// Ce module ne crée AUCUNE donnée : il relit ce qui existe déjà (étapes de mission, tâches, acquisitions,
// questionnaire du dossier, patrimoine 2c, dossier de structuration, checklist de pièces) et le présente.
//   · frises Offre 2 (Projet → … → Location) et Offre 3 (Situation → … → Mise en œuvre)
//   · cartes de mission (une par mission ; une étude de structuration compte comme une mission Offre 3)
//   · « À faire maintenant » : toutes les sources, une priorité DÉRIVÉE (aucune colonne de priorité n'existe)
//   · état du dossier : patrimoine, documents, portail, anomalies réelles
//   · pièces par catégories, activité filtrable
// Une valeur absente reste « non renseignée » (null) : jamais 0, jamais une valeur inventée.
import { syntheseObjectifs } from "../dossiers/questionnaireDossier.mjs";
import { stadeAcquisition } from "../dossiers/calculAcquisition.mjs";
import { calculerParcours, docsRequisRecus } from "../structurationParcours.mjs";
import { avancementCollecte } from "../structurationCollecte.mjs";

const jour = (v) => (v ? String(v).slice(0, 10) : null);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const plein = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const nb = (a) => (Array.isArray(a) ? a : []);

// ── Frises ──────────────────────────────────────────────────────────────────────────────────────
export const FRISE_OFFRE2 = Object.freeze(["Projet", "Recherche", "Bien", "Offre", "Financement", "Travaux", "Location"]);
export const FRISE_OFFRE3 = Object.freeze(["Situation", "Objectifs", "Patrimoine", "Analyse", "Stratégie", "Préconisations", "Mise en œuvre"]);

const ETAPE_FINIE = new Set(["terminee", "non_applicable"]);
const statutEtape = (etapes, cle) => etapes.find((e) => e.etape === cle && !e.operation_id)?.statut ?? null;
/** fait : toutes finies · cours : au moins une entamée · avenir : aucune ligne ou rien d'entamé. */
function etatGroupe(etapes, cles) {
  const st = cles.map((c) => statutEtape(etapes, c)).filter(Boolean);
  if (st.length === 0) return "avenir";
  if (st.every((s) => ETAPE_FINIE.has(s))) return "fait";
  return st.some((s) => s !== "a_venir") ? "cours" : "avenir";
}

function assembler(libelles, etats) {
  const etapes = libelles.map((libelle, i) => ({ cle: String(i), libelle, etat: etats[i] }));
  const courante = etapes.find((e) => e.etat === "cours") || etapes.find((e) => e.etat === "avenir") || null;
  return { etapes, courante: courante ? courante.libelle : null, terminee: etapes.every((e) => e.etat === "fait") };
}

/**
 * Frise de l'Offre 2, déduite des 11 étapes internes (jamais stockée) et des acquisitions de la mission.
 * Projet = signature → stratégie ; Bien = opportunités ; Offre = offre acceptée ; Travaux / Location : dates des acquisitions.
 */
export function friseOffre2({ etapes = [], acquisitions = [] } = {}) {
  const acq = acquisitions.filter((a) => !jour(a.abandon_le));
  const stades = acq.map(stadeAcquisition);
  const rang = ["recherche", "offre_acceptee", "sous_compromis", "acte_signe", "en_travaux", "prete_louer", "en_location"];
  const atteint = (s) => stades.some((x) => rang.indexOf(x) >= rang.indexOf(s));
  const projet = etatGroupe(etapes, ["signature", "collecte", "documents", "analyse", "strategie"]);
  const recherche = etatGroupe(etapes, ["recherche"]);
  const bien = etatGroupe(etapes, ["opportunites"]);
  const offre = atteint("offre_acceptee") ? "fait" : (bien === "fait" ? "cours" : "avenir");
  const financement = etatGroupe(etapes, ["financement"]);
  const travaux = acq.some((a) => jour(a.travaux_fin_le)) ? "fait" : acq.some((a) => jour(a.travaux_debut_le)) ? "cours" : "avenir";
  const location = acq.some((a) => jour(a.mise_location_le)) ? "fait" : atteint("prete_louer") ? "cours" : "avenir";
  return assembler(FRISE_OFFRE2, [projet, recherche, bien, offre, financement, travaux, location]);
}

const ETAT_PARCOURS = { fait: "fait", en_cours: "cours", a_faire: "avenir" };
const groupe = (parEtape, cles) => {
  const l = parEtape.filter((e) => cles.includes(e.cle));
  const faites = l.reduce((s, e) => s + e.faites, 0), total = l.reduce((s, e) => s + e.total, 0);
  return total > 0 && faites === total ? "fait" : faites > 0 ? "cours" : "avenir";
};

/**
 * Frise de l'Offre 3 : lue sur le dossier de structuration quand il existe (collecte, diagnostic, stratégies,
 * préconisations, mise en œuvre) ; à défaut sur les étapes de la mission (collecte, analyse, stratégie, restitution).
 */
export function friseOffre3({ donnees = null, dossier = null, etapes = [] } = {}) {
  if (donnees) {
    const p = calculerParcours(donnees), c = avancementCollecte(donnees);
    const e = (cle) => ETAT_PARCOURS[p.etapes.find((x) => x.cle === cle)?.etat] ?? "avenir";
    return { ...assembler(FRISE_OFFRE3, [groupe(c.parEtape, ["foyer", "flux"]), groupe(c.parEtape, ["objectifs"]), groupe(c.parEtape, ["patrimoine", "dettes"]),
      e("diagnostic"), e("strategies"), e("preconisation"), e("mise_en_oeuvre")]), source: "structuration" };
  }
  const collecte = etatGroupe(etapes, ["signature", "collecte"]);
  const restitue = plein(dossier?.restitution_le);
  return { ...assembler(FRISE_OFFRE3, [collecte, collecte, collecte, etatGroupe(etapes, ["analyse"]), etatGroupe(etapes, ["strategie"]),
    restitue ? "fait" : (etatGroupe(etapes, ["strategie"]) === "fait" ? "cours" : "avenir"), "avenir"]), source: "etapes" };
}

// ── Missions ────────────────────────────────────────────────────────────────────────────────────
/** Champs d'une mission Offre 2 : valeur ou null (affiché « À compléter »). */
export function champsOffre2({ dossier, acquisitions = [] }) {
  const syn = syntheseObjectifs(dossier?.questionnaire_data || {});
  const acq = acquisitions.filter((a) => !jour(a.abandon_le));
  const bien = acq.length ? acq[acq.length - 1] : null;
  const prix = acq.find((a) => a.prix_signe != null && a.prix_signe !== "")?.prix_signe ?? null;
  const val = (v) => (plein(v) ? v : null);
  return [
    { cle: "projet", libelle: "Projet", valeur: val(dossier?.libelle) },
    { cle: "bien", libelle: "Bien", valeur: val(bien?.libelle) },
    { cle: "budget", libelle: "Budget", valeur: val(syn.budget), type: "eur" },
    { cle: "apport", libelle: "Apport", valeur: val(syn.apport), type: "eur" },
    { cle: "capacite", libelle: "Capacité bancaire", valeur: null },
    { cle: "secteur", libelle: "Secteur", valeur: val(Array.isArray(syn.zones) ? syn.zones.join(", ") : syn.zones) },
    { cle: "objectif", libelle: "Objectif", valeur: val(syn.objectif) },
    { cle: "prix", libelle: "Prix", valeur: val(prix), type: "eur" },
  ];
}

/**
 * Cartes de mission du client.
 * @param vue sortie de construireClient (missions pilotées) ; @param structuration ligne invest_structuration_patrimoniale ou null
 * Une étude de structuration SANS mission Offre 3 en cours est présentée comme une mission Offre 3 (sans référence de mission).
 */
export function construireMissions({ vue, dossiers = [], etapes = [], acquisitions = [], structuration = null, client = null, aujourdhui }) {
  const donnees = structuration?.donnees && typeof structuration.donnees === "object" ? structuration.donnees : null;
  const parcours = donnees ? calculerParcours(donnees) : null;
  const dossierPar = new Map(dossiers.map((d) => [d.id, d]));

  const carte = (m) => {
    const d = dossierPar.get(m.dossierId);
    const offre3 = m.offre.code === "offre3";
    const mesEtapes = etapes.filter((e) => e.dossier_id === m.dossierId);
    const frise = offre3 ? friseOffre3({ donnees, dossier: d, etapes: mesEtapes }) : friseOffre2({ etapes: mesEtapes, acquisitions: acquisitions.filter((a) => a.dossier_id === m.dossierId) });
    return {
      cle: m.dossierId, dossierId: m.dossierId, offre: offre3 ? "offre3" : "offre2", offreLibelle: m.offre.court ? `${m.offre.court} — ${m.offre.libelle}` : m.offre.libelle,
      reference: m.reference, intitule: m.libelle || m.offre.libelle, conseiller: m.conseiller, statut: m.statutLibelle,
      frise, etape: frise.courante || m.jalon, prochaineAction: m.action || null, echeance: m.echeance, retardJours: m.retardJours,
      blocages: m.blocages, balle: m.balle,
      champs: offre3 ? champsOffre3({ parcours, donnees }) : champsOffre2({ dossier: d, acquisitions: acquisitions.filter((a) => a.dossier_id === m.dossierId) }),
      etude: offre3 && !!structuration,
    };
  };
  const enCours = (vue?.missionsEnCours || []).map(carte);

  // Étude de structuration : mission Offre 3 portée par le dossier de structuration (qui coexiste avec une mission Offre 2).
  if (structuration && !enCours.some((c) => c.offre === "offre3")) {
    const frise = friseOffre3({ donnees });
    enCours.push({
      cle: `etude-${structuration.id}`, dossierId: null, offre: "offre3", offreLibelle: "Offre 3 — Accompagnement patrimonial global",
      reference: null, intitule: "Étude patrimoniale", conseiller: client?.conseiller || null, statut: "En cours",
      frise, etape: frise.courante, prochaineAction: parcours?.prochainPoint?.libelle || null, echeance: jour(donnees?.mise_en_oeuvre?.prochaine_revue_le),
      retardJours: 0, blocages: [], balle: null, champs: champsOffre3({ parcours, donnees }), etude: true,
    });
  }
  // Offre 2 d'abord, Offre 3 ensuite ; à offre égale, le plus urgent d'abord (ordre déjà donné par le pilotage).
  enCours.sort((a, b) => (a.offre === b.offre ? 0 : a.offre === "offre2" ? -1 : 1));
  const terminees = (vue?.missionsTerminees || []).map((m) => ({ ...m, offre3: m.offre?.code === "offre3" }));
  return { enCours, terminees };
}

function champsOffre3({ parcours, donnees }) {
  const recos = preconisationsSuivies(donnees);
  const faites = recos.filter((r) => r.etat === "realise").length;
  return [
    { cle: "avancement", libelle: "Avancement de l'étude", valeur: parcours ? `${parcours.pourcentage} %` : null },
    { cle: "recos", libelle: "Préconisations réalisées", valeur: recos.length ? `${faites} / ${recos.length}` : null },
  ];
}

// ── Préconisations de l'Offre 3 = actions suivies ───────────────────────────────────────────────
export const STATUTS_PRECONISATION = Object.freeze({
  a_valider: "À valider", a_faire: "À faire", en_cours: "En cours", realise: "Réalisé", abandonne: "Abandonné",
});
const DEPUIS_LIBELLE = Object.freeze({ "à valider": "a_valider", "à faire": "a_faire", "en cours": "en_cours", "réalisé": "realise", "realise": "realise", "fait": "realise", "abandonné": "abandonne", "abandonne": "abandonne" });
const PRIORITE_RECO = Object.freeze({ haute: "Haute", moyenne: "Normale", normale: "Normale", basse: "Faible", faible: "Faible", urgente: "Urgente" });

/**
 * Préconisations du dossier de structuration, avec leur état de suivi. Tant que la stratégie recommandée n'est pas
 * rédigée, les trois préconisations modèles d'un dossier neuf ne sont pas de vraies préconisations : on ne les compte pas.
 * Le statut historique « À faire » est conservé tel quel (jamais réécrit sans action de l'utilisateur).
 */
export function preconisationsSuivies(donnees) {
  if (!donnees || !plein(donnees.analyse?.strategie_recommandee)) return [];
  return nb(donnees.analyse?.preconisations).filter((r) => plein(r.titre)).map((r, i) => ({
    id: r.id || `p${i}`, index: i, titre: String(r.titre), action: plein(r.action) ? String(r.action) : null, axe: r.axe || null,
    etat: DEPUIS_LIBELLE[String(r.statut || "").trim().toLowerCase()] ?? "a_valider",
    priorite: PRIORITE_RECO[String(r.priorite || "").trim().toLowerCase()] ?? "Normale", echeance: jour(r.echeance),
  }));
}

/** Copie des données de structuration avec le statut d'UNE préconisation modifié (le reste est intact). */
export function majStatutPreconisation(donnees, index, etat) {
  if (!STATUTS_PRECONISATION[etat]) throw new Error("Statut de préconisation inconnu.");
  const liste = nb(donnees?.analyse?.preconisations);
  if (!liste[index]) throw new Error("Préconisation introuvable.");
  const suivante = liste.map((r, i) => (i === index ? { ...r, statut: STATUTS_PRECONISATION[etat] } : r));
  return { ...donnees, analyse: { ...(donnees.analyse || {}), preconisations: suivante } };
}

// ── Pièces ──────────────────────────────────────────────────────────────────────────────────────
export const CATEGORIES_DOCUMENTS = Object.freeze([
  { cle: "identite", libelle: "Identité" }, { cle: "revenus", libelle: "Revenus" }, { cle: "banque", libelle: "Banque" },
  { cle: "patrimoine", libelle: "Patrimoine" }, { cle: "profero", libelle: "Profero" },
]);
export const EXIGENCES = Object.freeze({ obligatoire: "Obligatoire", conditionnel: "Selon le cas", facultatif: "Facultatif" });
export const ETATS_DOCUMENT = Object.freeze({ "": "À demander", demande: "Demandé", recu: "Reçu", valide: "Validé", na: "Non applicable" });

/**
 * Catalogue des pièces suivies. Les cinq premières sont celles de la checklist existante (clés inchangées :
 * invest_clients.strategie_data.documents_checklist) ; les autres sont des pièces usuelles d'un dossier de financement,
 * ajoutées sans toucher aux anciennes clés.
 */
export const CATALOGUE_DOCUMENTS = Object.freeze([
  { cle: "identite", libelle: "Pièce d’identité", categorie: "identite", exigence: "obligatoire" },
  { cle: "avis_imposition", libelle: "Dernier avis d’imposition", categorie: "revenus", exigence: "obligatoire" },
  { cle: "bulletins_salaire", libelle: "Trois derniers bulletins de salaire", categorie: "revenus", exigence: "conditionnel" },
  { cle: "solvabilite", libelle: "Dossier de solvabilité / banque", categorie: "banque", exigence: "obligatoire" },
  { cle: "releves_bancaires", libelle: "Relevés de comptes des trois derniers mois", categorie: "banque", exigence: "obligatoire" },
  { cle: "simulation", libelle: "Simulation bancaire ou enveloppe validée", categorie: "banque", exigence: "conditionnel" },
  { cle: "tableaux_amortissement", libelle: "Tableaux d’amortissement des crédits en cours", categorie: "patrimoine", exigence: "conditionnel" },
  { cle: "strategie", libelle: "Stratégie d’investissement validée", categorie: "profero", exigence: "obligatoire" },
  { cle: "accord_mandat", libelle: "Contrat / mandat Profero signé", categorie: "profero", exigence: "obligatoire" },
]);

/** Valeur stockée → état : l'historique `true` vaut « reçu ». */
export const etatDocument = (v) => (v === true ? "recu" : (typeof v === "string" && v in ETATS_DOCUMENT ? v : ""));
const recu = (e) => e === "recu" || e === "valide";

/** Pièces par catégorie (catégories vides masquées), compteur « X / X reçus » et pièces obligatoires à demander. */
export function syntheseDocuments(checklist = {}, demandes = {}) {
  const lignes = CATALOGUE_DOCUMENTS.map((d) => ({ ...d, etat: etatDocument(checklist?.[d.cle]), demandeLe: jour(demandes?.[d.cle]) }));
  const suivies = lignes.filter((l) => l.etat !== "na");
  const obligatoires = suivies.filter((l) => l.exigence === "obligatoire");
  return {
    categories: CATEGORIES_DOCUMENTS.map((c) => ({ ...c, lignes: lignes.filter((l) => l.categorie === c.cle) })).filter((c) => c.lignes.length),
    recus: obligatoires.filter((l) => recu(l.etat)).length,
    total: obligatoires.length,
    aDemander: obligatoires.filter((l) => l.etat === "").map((l) => l.cle),
    demandes: obligatoires.filter((l) => l.etat === "demande").map((l) => l.cle),
  };
}

/** Pièces obligatoires de l'étude patrimoniale : { recus, requis } ou null sans étude. */
export const piecesEtude = (donnees) => (donnees ? docsRequisRecus(donnees) : null);

// ── Patrimoine ──────────────────────────────────────────────────────────────────────────────────
export const SECTIONS_PATRIMOINE = Object.freeze([
  { cle: "foyer", libelle: "Foyer", tables: ["invest_personnes"] },
  { cle: "revenus", libelle: "Revenus & charges", tables: ["invest_postes_financiers"], famille: ["revenu", "charge"] },
  { cle: "epargne", libelle: "Épargne & placements", tables: ["invest_postes_financiers"], famille: ["actif_financier"] },
  { cle: "credits", libelle: "Crédits & engagements", tables: ["invest_engagements"] },
  { cle: "immobilier", libelle: "Immobilier", tables: ["invest_actifs_patrimoniaux"] },
  { cle: "structures", libelle: "Sociétés / structures", tables: ["invest_structures"] },
]);

/**
 * Complétude du patrimoine du client (UN patrimoine par client). Une section « vide » est NON RENSEIGNÉE, pas à 0 €.
 * Le pourcentage compte les sections de base qui comportent au moins une ligne : foyer, revenus & charges, épargne,
 * immobilier et crédits ; les structures sont facultatives (n'entrent pas dans le pourcentage).
 */
export function completudePatrimoine(collecte = {}, donneesEtude = null) {
  const actifs = (t) => nb(collecte[t]).filter((r) => r && !r.archive_le);
  const sections = SECTIONS_PATRIMOINE.map((s) => {
    const lignes = actifs(s.tables[0]).filter((r) => !s.famille || s.famille.includes(r.famille));
    return { cle: s.cle, libelle: s.libelle, lignes: lignes.length, renseignee: lignes.length > 0 };
  });
  // Fiscalité : seule la tranche d'imposition de l'étude patrimoniale existe aujourd'hui (aucune table 2c) ; hors pourcentage.
  const tmi = donneesEtude?.collecte?.profil?.tmi;
  sections.push({ cle: "fiscalite", libelle: "Fiscalité", lignes: plein(tmi) && !/v[ée]rifier/i.test(String(tmi)) ? 1 : 0, renseignee: plein(tmi) && !/v[ée]rifier/i.test(String(tmi)), detail: plein(tmi) ? String(tmi) : null });
  const base = sections.filter((s) => !["structures", "fiscalite"].includes(s.cle));
  const faites = base.filter((s) => s.renseignee).length;
  return { sections, pourcentage: Math.round((faites / base.length) * 100), manquantes: base.filter((s) => !s.renseignee).map((s) => s.libelle), vide: sections.filter((s) => s.cle !== "fiscalite").every((s) => !s.renseignee) };
}

// ── À faire maintenant ──────────────────────────────────────────────────────────────────────────
export const PRIORITES = Object.freeze(["Urgente", "Haute", "Normale", "Faible"]);
const RANG = Object.freeze({ Urgente: 0, Haute: 1, Normale: 2, Faible: 3 });

/**
 * Priorité DÉRIVÉE (il n'existe pas de colonne de priorité sur les tâches) :
 * retard > 7 jours ou blocage → Urgente · en retard ou échéance sous 3 jours → Haute · échéance datée → Normale · sans échéance → Faible.
 */
export function prioriteDerivee({ echeance, retardJours = 0, bloque = false }, aujourdhui) {
  if (bloque || retardJours > 7) return "Urgente";
  if (retardJours > 0) return "Haute";
  if (echeance) { const n = joursEntre(aujourdhui, echeance); return n <= 3 ? "Haute" : "Normale"; }
  return "Faible";
}

const TACHE_OUVERTE = new Set(["a_faire", "en_cours", "bloque"]);

/** Tri commun : le retard d'abord, puis la priorité, puis la date. */
export function trierActions(items = []) {
  return [...items].sort((a, b) => (b.retardJours > 0) - (a.retardJours > 0) || RANG[a.priorite] - RANG[b.priorite]
    || String(a.echeance || "9999").localeCompare(String(b.echeance || "9999")) || a.titre.localeCompare(b.titre, "fr"));
}

/**
 * Actions à faire, toutes sources confondues : tri retard → priorité → date. `tout` = liste complète, `visibles` = cinq premières.
 * Sources : prochaine action de chaque mission, tâches de mission, pièces à demander, patrimoine incomplet, préconisations de l'Offre 3.
 */
export function actionsAFaire({ missions = [], taches = [], dossiers = [], documents = null, patrimoine = null, donnees = null, aVerifier = { depots: 0, reponses: 0 }, aujourdhui, max = 5 }) {
  const refs = new Map(dossiers.map((d) => [d.id, d.reference]));
  const items = [];
  const doublons = new Set();
  for (const m of missions.filter((x) => x.dossierId && x.prochaineAction)) {
    const retard = m.retardJours || 0;
    items.push({ id: `m-${m.dossierId}`, source: "mission", titre: m.prochaineAction, mission: m.reference, dossierId: m.dossierId, echeance: m.echeance, retardJours: retard,
      priorite: prioriteDerivee({ echeance: m.echeance, retardJours: retard, bloque: m.blocages.length > 0 }, aujourdhui), boutons: ["ouvrir"] });
    doublons.add(`${m.dossierId}|${m.prochaineAction}`);
  }
  for (const t of taches.filter((x) => TACHE_OUVERTE.has(x.status))) {
    const titre = t.action_title || "Action";
    if (doublons.has(`${t.dossier_id}|${titre}`)) continue;
    const ech = jour(t.due_date);
    const retard = ech && ech < aujourdhui ? joursEntre(ech, aujourdhui) : 0;
    items.push({ id: t.id, source: "tache", titre, mission: refs.get(t.dossier_id) ?? null, dossierId: t.dossier_id || null, echeance: ech, retardJours: retard,
      priorite: prioriteDerivee({ echeance: ech, retardJours: retard, bloque: t.status === "bloque" }, aujourdhui), boutons: ["terminer", "reporter", ...(t.dossier_id ? ["ouvrir"] : [])] });
  }
  if (documents && documents.aDemander.length > 0) {
    items.push({ id: "documents", source: "document", titre: `Demander ${documents.aDemander.length} pièce${documents.aDemander.length > 1 ? "s" : ""} manquante${documents.aDemander.length > 1 ? "s" : ""}`,
      mission: null, dossierId: null, echeance: null, retardJours: 0, priorite: "Normale", boutons: ["demander"] });
  }
  if (patrimoine && !patrimoine.vide && patrimoine.manquantes.length > 0) {
    items.push({ id: "patrimoine", source: "patrimoine", titre: `Compléter le patrimoine : ${patrimoine.manquantes.join(", ").toLowerCase()}`,
      mission: null, dossierId: null, echeance: null, retardJours: 0, priorite: "Faible", boutons: ["completer"] });
  }
  const nVerif = (aVerifier.depots || 0) + (aVerifier.reponses || 0);
  if (nVerif > 0) {
    items.push({ id: "verifications", source: "verification", titre: `Vérifier ce que le client a envoyé (${[aVerifier.reponses ? `${aVerifier.reponses} réponse${aVerifier.reponses > 1 ? "s" : ""}` : null, aVerifier.depots ? `${aVerifier.depots} pièce${aVerifier.depots > 1 ? "s" : ""}` : null].filter(Boolean).join(", ")})`,
      mission: null, dossierId: null, echeance: null, retardJours: 0, priorite: "Haute", boutons: ["ouvrir_etude"] });
  }
  for (const r of preconisationsSuivies(donnees).filter((x) => ["a_valider", "a_faire", "en_cours"].includes(x.etat))) {
    const retard = r.echeance && r.echeance < aujourdhui ? joursEntre(r.echeance, aujourdhui) : 0;
    items.push({ id: `reco-${r.id}`, source: "preconisation", titre: `Préconisation ${STATUTS_PRECONISATION[r.etat].toLowerCase()} : ${r.titre}`, mission: "Offre 3", dossierId: null,
      echeance: r.echeance, retardJours: retard, priorite: retard > 7 ? "Urgente" : r.priorite, boutons: ["ouvrir_etude"] });
  }
  const tri = trierActions(items);
  return { tout: tri, visibles: tri.slice(0, max), total: tri.length };
}

// ── État du dossier ─────────────────────────────────────────────────────────────────────────────
/**
 * Synthèse « État du dossier ». `portail` : "actif" | "non_active" | null (illisible : jamais présenté comme « non activé »).
 * Les anomalies sont réelles et rien d'autre : dossier sans mission, retard, blocage, coordonnées manquantes, pièces déposées à vérifier.
 */
export function etatDossier({ patrimoine, documents, portail, missions = [], client = {}, depotsAVerifier = 0, reponsesAVerifier = 0 }) {
  const anomalies = [];
  const retards = missions.filter((m) => m.retardJours > 0);
  if (retards.length) anomalies.push({ code: "retard", libelle: `${retards.length} mission${retards.length > 1 ? "s" : ""} en retard (jusqu'à ${Math.max(...retards.map((m) => m.retardJours))} j)` });
  const bloquees = missions.filter((m) => m.blocages?.length);
  if (bloquees.length) anomalies.push({ code: "bloquee", libelle: `${bloquees.length} mission${bloquees.length > 1 ? "s" : ""} bloquée${bloquees.length > 1 ? "s" : ""}` });
  if (!plein(client.email)) anomalies.push({ code: "email", libelle: "E-mail non renseigné" });
  if (!plein(client.telephone)) anomalies.push({ code: "telephone", libelle: "Téléphone non renseigné" });
  if (depotsAVerifier > 0) anomalies.push({ code: "depots", libelle: `${depotsAVerifier} pièce${depotsAVerifier > 1 ? "s" : ""} déposée${depotsAVerifier > 1 ? "s" : ""} à vérifier` });
  if (reponsesAVerifier > 0) anomalies.push({ code: "reponses", libelle: `${reponsesAVerifier} réponse${reponsesAVerifier > 1 ? "s" : ""} du client à vérifier` });
  return {
    patrimoine: patrimoine.vide ? null : patrimoine.pourcentage,
    documents: { recus: documents.recus, total: documents.total },
    portail,
    missionsActives: missions.length,
    anomalies,
  };
}

// ── Activité ────────────────────────────────────────────────────────────────────────────────────
export const FILTRES_ACTIVITE = Object.freeze([
  { cle: "tout", libelle: "Tout" }, { cle: "notes", libelle: "Notes" }, { cle: "appels", libelle: "Appels" },
  { cle: "emails", libelle: "Emails" }, { cle: "rdv", libelle: "RDV" }, { cle: "missions", libelle: "Missions" },
]);
/** Événements de mission purement techniques (changement de balle, d'échéance, de prochaine action…) : masqués par défaut. */
export const EVENEMENTS_TECHNIQUES = Object.freeze(["dossier_modifie", "conseiller_change", "etape_balle_change", "etape_echeance_change", "etape_prochaine_action_change", "reprise_importee"]);

/** Catégorie d'un élément d'historique (pour le filtre). Un e-mail du CRM est une note « document » qui le dit. */
export function categorieActivite(h) {
  if (h.genre === "mission") return EVENEMENTS_TECHNIQUES.includes(h.typeEvenement) ? "technique" : "missions";
  if (h.type === "Appel" || h.type === "Relance") return "appels";
  if (h.type === "Rendez-vous") return "rdv";
  if (h.type === "Document" && /e-?mail|envoy[ée]e? à/i.test(h.texte || "")) return "emails";
  return "notes";
}

/** Historique filtré. Les événements techniques n'apparaissent que si `technique` est vrai (Journal système). */
export function filtrerActivite(historique = [], { filtre = "tout", technique = false } = {}) {
  return historique.filter((h) => {
    const c = categorieActivite(h);
    if (c === "technique") return technique && (filtre === "tout" || filtre === "missions");
    return filtre === "tout" || filtre === c;
  });
}
