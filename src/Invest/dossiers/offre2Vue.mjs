// src/Invest/dossiers/offre2Vue.mjs — logique PURE de l'intérieur d'une mission Offre 2.
//
// Offre 2 = accompagnement à l'investissement immobilier : un projet, un bien retenu, une offre, une acquisition,
// un financement, des travaux éventuels, puis la transmission. Ce module ne crée AUCUNE donnée : il relit les
// données qui existent (étapes du parcours à 11 étapes, propositions de biens, fiche du bien, acquisitions,
// financement et banques, questionnaire du projet) et les présente dans le nouveau parcours.
//   · le parcours à 11 étapes n'est PAS modifié : la frise est un mapping d'affichage (ETAPE_VERS_JALON)
//   · une donnée absente reste `null` (« non renseigné ») : jamais 0
//   · le client (patrimoine, documents) n'est pas recopié ici : on n'en lit que la complétude
// Module pur : aucun accès base, aucune horloge (date du jour en paramètre).
import { valeurDe, QUESTIONS } from "./questionnaireDossier.mjs";
import { stadeAcquisition, coutAcquisition } from "./calculAcquisition.mjs";
import { STATUTS_BANQUE } from "./calculFinancement.mjs";
import { calculerAnalyse, validerHypotheses } from "./calculAnalyse.mjs";
import { completudePatrimoine, syntheseDocuments, actionsAFaire, trierActions } from "../crm/ficheOffres.mjs";

const jour = (v) => (v ? String(v).slice(0, 10) : null);
const plein = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const nb = (a) => (Array.isArray(a) ? a : []);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
/** Nombre ou null : « » et absent donnent null, 0 reste 0. */
export const nombreOuNull = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(String(v).replace(/[\s  €%]/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };

// ── Navigation et parcours ──────────────────────────────────────────────────────────────────────
export const NAV_OFFRE2 = Object.freeze([
  { cle: "ensemble", libelle: "Vue d'ensemble" }, { cle: "projet", libelle: "Projet" }, { cle: "biens", libelle: "Recherche & biens" },
  { cle: "offre", libelle: "Offre & acquisition" }, { cle: "financement", libelle: "Financement" }, { cle: "travaux", libelle: "Travaux" },
  { cle: "transmission", libelle: "Transmission" },
]);
/** Anciennes clés d'onglet de la mission → onglet actuel (aucune entrée de navigation n'est perdue). */
export const ONGLET_MISSION_HERITE = Object.freeze({ situation: "projet", documents: "ensemble", analyse: "projet", strategie: "projet", opportunites: "biens", acquisition: "offre" });
export const ongletMissionValide = (cle) => (NAV_OFFRE2.some((o) => o.cle === cle) ? cle : ONGLET_MISSION_HERITE[cle] ?? "ensemble");

export const JALONS_MISSION = Object.freeze([
  { cle: "projet", libelle: "Projet", onglet: "projet" }, { cle: "recherche", libelle: "Recherche", onglet: "biens" }, { cle: "bien", libelle: "Bien", onglet: "biens" },
  { cle: "offre", libelle: "Offre", onglet: "offre" }, { cle: "acquisition", libelle: "Acquisition", onglet: "offre" }, { cle: "financement", libelle: "Financement", onglet: "financement" },
  { cle: "travaux", libelle: "Travaux", onglet: "travaux" }, { cle: "transmission", libelle: "Transmission", onglet: "transmission" },
]);
/** Mapping de compatibilité des 11 étapes historiques vers les jalons (affichage seulement ; rien n'est écrit en base). */
export const ETAPE_VERS_JALON = Object.freeze({
  signature: "projet", collecte: "projet", documents: "projet", analyse: "projet", strategie: "projet",
  recherche: "recherche", opportunites: "bien", financement: "financement", structuration: "acquisition", acquisition: "acquisition", suivi: "suivi",
});
export const ETATS_JALON = Object.freeze({ termine: "Terminé", cours: "En cours", avenir: "À venir", bloque: "Bloqué", na: "Non applicable" });

const FINIE = new Set(["terminee", "non_applicable"]);
const lire = (etapes, cle) => etapes.find((e) => e.etape === cle && !e.operation_id);

// ── Biens de la recherche ───────────────────────────────────────────────────────────────────────
export const STATUTS_BIEN_MISSION = Object.freeze({
  a_analyser: "À analyser", propose: "Proposé", visite_prevue: "Visite prévue", visite: "Visité", refuse: "Refusé", retenu: "Retenu",
});
/** Valeurs écrites par la fiche (statut de proposition). Les anciennes valeurs de l'ancienne vue CRM restent lues. */
export const VALEUR_PROPOSITION = Object.freeze({ a_analyser: "en analyse", propose: "proposé", visite_prevue: "visite prévue", visite: "visité", refuse: "refusé", retenu: "retenu" });
const DEPUIS_VALEUR = Object.freeze({ "en analyse": "a_analyser", "à analyser": "a_analyser", "proposé": "propose", "intéressé": "propose", "visite prévue": "visite_prevue", "visite programmée": "visite_prevue",
  "visité": "visite", "refusé": "refuse", "retenu": "retenu", "offre en cours": "retenu" });
/** Statut d'une proposition → statut de la recherche. Valeur inconnue : « Proposé » (jamais perdue ni masquée). */
export const statutBien = (valeur) => DEPUIS_VALEUR[String(valeur || "").trim().toLowerCase()] ?? "propose";

/** Données utiles d'un bien (une absence est `null`). Le bien du Stock n'est pas recopié : on le lit. */
export function resumeBien(bien = {}) {
  const v = bien.visite_data || {};
  const prix = nombreOuNull(bien.prix_vente ?? v.general?.prix_affiche);
  const travaux = nombreOuNull(bien.prix_travaux ?? v.finance?.budget_travaux_ttc);
  return {
    id: bien.id ?? null, adresse: [bien.adresse, bien.ville].filter(Boolean).join(", ") || null,
    prix, surface: nombreOuNull(v.general?.surface_totale ?? bien.surface), typologie: v.general?.type_bien || null, travaux,
    loyers: nombreOuNull(v.configuration?.total_loyers_mensuels ?? v.finance?.loyers_bruts_mensuels),
    rendement: nombreOuNull(bien.rendement_brut ?? v.finance?.rendement_brut_calcule ?? v.finance?.rendement_brut),
    cashflow: nombreOuNull(bien.cashflow_estime ?? v.finance?.cashflow_mensuel_estime ?? v.finance?.cashflow_mensuel),
  };
}

/** Lignes de la recherche : une par proposition, tous les biens conservés (un bien retenu n'efface pas les autres). */
export function lignesRecherche(propositions = []) {
  return propositions.filter((p) => p && p.bien_id !== undefined).map((p) => ({
    propositionId: p.id, bienId: p.bien_id ?? p.bien?.id ?? null, statut: statutBien(p.statut), statutBrut: p.statut || null,
    date: jour(p.date_proposition || p.created_at), commentaire: p.commentaire || null, bien: resumeBien(p.bien || {}), brut: p.bien || null,
  })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

/** Synthèse : étudiés, à analyser (pas encore tranchés), visités, écartés, retenu. Un seul bien principal. */
export function syntheseRecherche(lignes = []) {
  const n = (s) => lignes.filter((l) => l.statut === s).length;
  const retenus = lignes.filter((l) => l.statut === "retenu");
  return {
    etudies: lignes.length, aAnalyser: n("a_analyser") + n("propose"), visitePrevue: n("visite_prevue"), visites: n("visite"), ecartes: n("refuse"), retenus: retenus.length,
    retenu: retenus[0] ?? null,
    plusieursRetenus: retenus.length > 1,
  };
}

// ── Offre ───────────────────────────────────────────────────────────────────────────────────────
export const STATUTS_OFFRE = Object.freeze(["À préparer", "Envoyée", "En négociation", "Contre-offre", "Acceptée", "Refusée", "Abandonnée"]);
/** Anciennes valeurs de la fiche du bien, conservées telles quelles (et affichées dans la liste pour ne rien écraser). */
export const STATUTS_OFFRE_HERITES = Object.freeze(["À envoyer", "Relance à faire"]);
export const offreAcceptee = (statut) => statut === "Acceptée";
export const statutsOffreProposes = (courant) => [...STATUTS_OFFRE, ...(courant && !STATUTS_OFFRE.includes(courant) ? [courant] : [])];

/** Offre d'achat lue sur la fiche du bien (invest_biens.visite_data.offre_achat + montant_offre). Vide si le bien n'a aucune offre. */
export function lireOffre(bien = null) {
  if (!bien) return null;
  const o = bien.visite_data?.offre_achat || {};
  const prixPropose = nombreOuNull(bien.montant_offre);
  const vide = !plein(o.statut) && prixPropose === null && !plein(o.prix_recommande);
  return {
    vide, statut: plein(o.statut) ? o.statut : null,
    prixAffiche: nombreOuNull(bien.prix_vente ?? bien.visite_data?.general?.prix_affiche), prixConseille: nombreOuNull(o.prix_recommande), prixPropose,
    dateOffre: jour(o.date_offre), dateLimite: jour(o.date_limite), negociation: o.arguments || "", marge: o.marge_negociation || "", conditions: o.conditions || "", relance: jour(o.date_relance || bien.date_relance),
  };
}
/** Charge utile pour invest_biens : la fiche du bien garde ses autres données ; seules les clés de l'offre sont modifiées. */
export function patchOffre(bien, saisie) {
  const actuel = bien?.visite_data?.offre_achat || {};
  const statut = saisie.statut ?? actuel.statut ?? "";
  if (statut && !STATUTS_OFFRE.includes(statut) && statut !== actuel.statut) throw new Error("Statut d'offre inconnu.");
  const propose = saisie.prixPropose === "" || saisie.prixPropose == null ? null : nombreOuNull(saisie.prixPropose);
  if (saisie.prixPropose !== "" && saisie.prixPropose != null && propose === null) throw new Error("Prix proposé invalide.");
  if (propose !== null && propose < 0) throw new Error("Le prix proposé ne peut pas être négatif.");
  const conseille = saisie.prixConseille === "" || saisie.prixConseille == null ? "" : nombreOuNull(saisie.prixConseille);
  if (conseille === null) throw new Error("Prix conseillé invalide.");
  const offre = { ...actuel, statut, prix_recommande: conseille === "" ? "" : conseille,
    date_offre: saisie.dateOffre || "", date_limite: saisie.dateLimite || "", arguments: saisie.negociation ?? actuel.arguments ?? "" };
  return { visite_data: { ...(bien?.visite_data || {}), offre_achat: offre }, montant_offre: propose };
}

// ── Acquisition ─────────────────────────────────────────────────────────────────────────────────
export const STATUTS_CONDITION = Object.freeze({ a_verifier: "À vérifier", en_cours: "En cours", levee: "Levée", non_realisee: "Non réalisée", na: "Non applicable" });
export const TYPES_CONDITION = Object.freeze(["Financement", "Urbanisme", "Division", "Vente préalable", "Autre"]);
/** Statut d'une condition : le champ `statut` s'il existe, sinon déduit de la date de levée historique. */
export const statutCondition = (c = {}) => (c.statut && STATUTS_CONDITION[c.statut] ? c.statut : jour(c.levee_le) ? "levee" : "a_verifier");

export const ETAPES_ACQUISITION = Object.freeze([
  { cle: "offre", libelle: "Offre acceptée" }, { cle: "compromis", libelle: "Compromis" }, { cle: "conditions", libelle: "Conditions suspensives" }, { cle: "acte", libelle: "Acte authentique" },
]);
/** Progression de l'acquisition depuis les dates existantes (et l'offre du bien quand aucune acquisition n'existe encore). */
export function progressionAcquisition({ acquisition = null, offre = null } = {}) {
  const a = acquisition || {};
  const offreOk = !!jour(a.offre_acceptee_le) || offreAcceptee(offre?.statut);
  const compromis = !!jour(a.compromis_signe_le), acte = !!jour(a.acte_signe_le);
  const conds = nb(a.conditions_suspensives).filter((c) => c && String(c.libelle || "").trim());
  const ouvertes = conds.filter((c) => ["a_verifier", "en_cours", "non_realisee"].includes(statutCondition(c)));
  const conditionsOk = compromis && conds.length > 0 && ouvertes.length === 0;
  const etats = { offre: offreOk ? "termine" : "avenir", compromis: compromis ? "termine" : offreOk ? "cours" : "avenir",
    conditions: acte || conditionsOk ? "termine" : compromis ? "cours" : "avenir", acte: acte ? "termine" : conditionsOk || (compromis && conds.length === 0) ? "cours" : "avenir" };
  const courante = ETAPES_ACQUISITION.find((e) => etats[e.cle] === "cours") || null;
  return { etapes: ETAPES_ACQUISITION.map((e) => ({ ...e, etat: etats[e.cle] })), courante: courante?.libelle ?? null, conditions: conds.length, conditionsOuvertes: ouvertes.length,
    aucuneCondition: compromis && conds.length === 0, acte };
}

// ── Financement ─────────────────────────────────────────────────────────────────────────────────
export const PIPELINE_FINANCEMENT = Object.freeze(["À constituer", "Complet", "Transmis", "Étude banque", "Accord", "Offre de prêt", "Acceptée"]);
/** Position dans le pipeline : la plus avancée entre l'état du dossier bancaire et le statut des banques. Non démarré si aucune donnée. */
export function statutFinancement({ financement = null, banques = [] } = {}) {
  const parBanque = { dossier_depose: 3, accord_principe: 4, offre_recue: 5, offre_acceptee: 6 };
  const depuisDossier = { a_constituer: 0, en_cours: 0, pret: 1, transmis: 2 }[financement?.dossier_statut] ?? 0;
  const rang = Math.max(depuisDossier, ...nb(banques).map((b) => parBanque[b.statut] ?? 0));
  const demarre = !!financement || nb(banques).length > 0;
  const refus = nb(banques).length > 0 && nb(banques).every((b) => ["refus", "abandon"].includes(b.statut));
  return { rang, libelle: PIPELINE_FINANCEMENT[rang], demarre, refus, nbBanques: nb(banques).length, acceptee: rang === 6, etapes: PIPELINE_FINANCEMENT.map((l, i) => ({ libelle: l, etat: i < rang ? "termine" : i === rang ? (demarre ? "cours" : "avenir") : "avenir" })) };
}
export const libelleStatutBanque = (s) => STATUTS_BANQUE[s] ?? s ?? "—";

// ── Travaux et transmission (suivi_offre2, colonne optionnelle) ──────────────────────────────────
export const MODES_TRAVAUX = Object.freeze({ aucun: "Pas de travaux", externes: "Travaux externes", profero: "Travaux Profero Rénovation" });
/** Travaux : le mode (colonne `suivi_offre2`), sinon déduit du budget (0 € saisi = pas de travaux ; vide = non renseigné). */
export function lireTravaux({ acquisition = null, suivi = null } = {}) {
  const t = suivi?.travaux || {};
  const budget = nombreOuNull(acquisition?.budget_travaux);
  const mode = MODES_TRAVAUX[t.mode] ? t.mode : budget === 0 ? "aucun" : null;
  const debut = jour(acquisition?.travaux_debut_le), fin = jour(acquisition?.travaux_fin_le);
  const etat = mode === "aucun" ? "na" : fin ? "termine" : debut ? "cours" : mode ? "avenir" : "inconnu";
  return { mode, budget, debut, fin, etat, responsable: t.responsable || "", chantier: t.chantier || "", notes: t.notes || "", livraisonPrevue: jour(t.livraison_prevue) };
}
export function lireTransmission(suivi = null) {
  const t = suivi?.transmission || {};
  return { date: jour(t.date), destinataire: t.destinataire || "", notes: t.notes || "", documents: nb(t.documents).filter(plein).map(String) };
}

// ── Frise principale ────────────────────────────────────────────────────────────────────────────
function etatGroupe(etapes, cles) {
  const l = cles.map((c) => lire(etapes, c)).filter(Boolean);
  if (!l.length) return "avenir";
  if (l.some((e) => e.statut === "bloquee")) return "bloque";
  if (l.every((e) => FINIE.has(e.statut))) return l.every((e) => e.statut === "non_applicable") ? "na" : "termine";
  return l.some((e) => e.statut !== "a_venir") ? "cours" : "avenir";
}

/**
 * Frise Projet → Recherche → Bien → Offre → Acquisition → Financement → Travaux → Transmission.
 * @param principaleCle étape historique active du pilotage (sert à désigner l'étape actuelle, comme avant)
 */
export function friseMission({ etapes = [], lignes = [], offre = null, acquisition = null, financement = null, banques = [], suivi = null, principaleCle = null, clos = false } = {}) {
  const synth = syntheseRecherche(lignes);
  const finance = statutFinancement({ financement, banques });
  const trav = lireTravaux({ acquisition, suivi }), transm = lireTransmission(suivi);
  const acqStade = acquisition ? stadeAcquisition(acquisition) : null;
  const offreOk = !!jour(acquisition?.offre_acceptee_le) || offreAcceptee(offre?.statut);
  const acteOk = !!jour(acquisition?.acte_signe_le) || etatGroupe(etapes, ["acquisition"]) === "termine";
  const projet = etatGroupe(etapes, ["signature", "collecte", "documents", "analyse", "strategie"]);
  const recherche = (synth.etudies > 0 || synth.retenu) ? (synth.retenu ? "termine" : "cours") : etatGroupe(etapes, ["recherche"]);
  const bien = synth.retenu || offreOk ? "termine" : synth.etudies > 0 ? "cours" : etatGroupe(etapes, ["opportunites"]);
  const offreJ = offreOk ? "termine" : offre && !offre.vide && ["Refusée", "Abandonnée"].includes(offre.statut) ? "bloque" : synth.retenu ? "cours" : "avenir";
  const acqJ = acteOk ? "termine" : offreOk || etatGroupe(etapes, ["structuration", "acquisition"]) !== "avenir" ? (etatGroupe(etapes, ["acquisition"]) === "bloque" ? "bloque" : "cours") : "avenir";
  const finJ = finance.acceptee || etatGroupe(etapes, ["financement"]) === "termine" ? "termine" : etatGroupe(etapes, ["financement"]) === "bloque" || finance.refus ? "bloque" : finance.demarre || etatGroupe(etapes, ["financement"]) !== "avenir" ? "cours" : "avenir";
  const travJ = trav.etat === "inconnu" ? "avenir" : trav.etat;
  const suiviEtat = etatGroupe(etapes, ["suivi"]);
  const transJ = transm.date || clos ? "termine" : acteOk && ["termine", "na"].includes(travJ) ? "cours" : suiviEtat === "cours" && trav.etat === "inconnu" ? "cours" : "avenir";
  const etats = { projet, recherche, bien, offre: offreJ, acquisition: acqJ, financement: finJ, travaux: travJ, transmission: transJ };
  // L'étape actuelle : celle de l'étape historique active (inchangé pour les anciennes missions), corrigée par les données du bien.
  let courante = null;
  const hist = principaleCle ? ETAPE_VERS_JALON[principaleCle] : null;
  if (hist === "suivi") courante = trav.etat !== "inconnu" && trav.etat !== "termine" && trav.etat !== "na" ? "travaux" : "transmission";
  else if (hist === "bien" && synth.retenu) courante = offreOk ? "acquisition" : "offre";
  else if (hist === "acquisition") courante = offreOk ? "acquisition" : "offre";
  else courante = hist;
  if (!courante || !["cours", "bloque"].includes(etats[courante])) courante = JALONS_MISSION.find((j) => ["cours", "bloque"].includes(etats[j.cle]))?.cle ?? JALONS_MISSION.find((j) => etats[j.cle] === "avenir")?.cle ?? null;
  const jalons = JALONS_MISSION.map((j) => ({ ...j, etat: etats[j.cle], etatLibelle: ETATS_JALON[etats[j.cle]], courant: j.cle === courante }));
  return { jalons, courante, libelleCourant: jalons.find((j) => j.courant)?.libelle ?? null, terminee: jalons.every((j) => ["termine", "na"].includes(j.etat)),
    detailAcquisition: acqStade };
}

// ── Projet : critères de recherche ──────────────────────────────────────────────────────────────
const OPTIONS = Object.fromEntries(QUESTIONS.map((q) => [q.cle, q.options || null]));
const libelleChoix = (cle, v) => (v === null || v === undefined || v === "" ? null : Array.isArray(v) ? (v.length ? v.map((x) => OPTIONS[cle]?.[x] ?? x).join(", ") : null) : OPTIONS[cle]?.[v] ?? v);
/** Objectifs et critères de recherche, lus dans le questionnaire du projet (null = à compléter). */
export function criteresProjet(data = {}) {
  const v = (cle) => valeurDe(data, cle);
  const c = (cle) => libelleChoix(cle, v(cle));
  return {
    objectifs: [
      { cle: "objectif", libelle: "Objectif principal", valeur: c("objectifs__objectif_principal") }, { cle: "horizon", libelle: "Horizon", valeur: c("objectifs__horizon") },
      { cle: "budget", libelle: "Budget visé", valeur: nombreOuNull(v("objectifs__budget")), type: "eur" }, { cle: "apport", libelle: "Apport souhaité", valeur: nombreOuNull(v("objectifs__apport_souhaite")), type: "eur" },
      { cle: "zones", libelle: "Zones recherchées", valeur: plein(v("objectifs__zones")) ? String(v("objectifs__zones")) : null }, { cle: "typologies", libelle: "Typologie recherchée", valeur: c("objectifs__typologies") },
      { cle: "cashflow", libelle: "Cash-flow recherché", valeur: c("objectifs__cashflow") }, { cle: "urgence", libelle: "Calendrier", valeur: c("objectifs__urgence") },
    ],
    criteres: [
      { cle: "budget_max", libelle: "Budget maximum", valeur: nombreOuNull(v("objectifs__budget")), type: "eur" }, { cle: "zone", libelle: "Zone", valeur: plein(v("objectifs__zones")) ? String(v("objectifs__zones")) : null },
      { cle: "type", libelle: "Type de bien", valeur: c("objectifs__typologies") }, { cle: "travaux", libelle: "Travaux acceptés", valeur: c("objectifs__travaux") },
      { cle: "rendement", libelle: "Rentabilité cible", valeur: nombreOuNull(v("objectifs__rendement_minimum")), type: "pct" }, { cle: "cashflow_cible", libelle: "Cash-flow cible", valeur: c("objectifs__cashflow") },
      { cle: "autofinancement", libelle: "Autofinancement minimum", valeur: nombreOuNull(v("objectifs__autofinancement_minimum")), type: "pct" }, { cle: "gestion", libelle: "Gestion souhaitée", valeur: c("objectifs__gestion") },
    ],
  };
}

// ── Anomalies, actions, clôture ─────────────────────────────────────────────────────────────────
/** Alertes réelles de la mission. `sansAction` : aucune étape active ne porte une vraie prochaine action. */
export function anomaliesMission({ aFaire = null, pilotage = null, completudePatrimoine = null, documents = null, capaciteEvaluee = null, synthRecherche = null, offre = null }) {
  const a = [];
  const balleProfero = aFaire?.balleType === "profero" || (!aFaire?.balleType && !!aFaire);
  if (aFaire?.sansAction && balleProfero) a.push({ code: "sans_action", niveau: "warning", libelle: "Aucune prochaine action définie alors que Profero a la balle.", cible: "definir" });
  for (const b of pilotage?.blocages || []) a.push({ code: `bloque-${b.etape}`, niveau: "danger", libelle: `Bloqué : ${b.etape}${b.motif ? ` — ${b.motif}` : ""}`, cible: "etape" });
  if (synthRecherche?.plusieursRetenus) a.push({ code: "plusieurs_retenus", niveau: "warning", libelle: "Plusieurs biens sont marqués « retenu » : un seul peut être le bien principal.", cible: "biens" });
  if (offre && !offre.vide && ["Refusée", "Abandonnée"].includes(offre.statut)) a.push({ code: "offre_refusee", niveau: "warning", libelle: `Offre ${offre.statut.toLowerCase()} : choisir la suite.`, cible: "offre" });
  if (completudePatrimoine && (completudePatrimoine.vide || completudePatrimoine.pourcentage < 100)) a.push({ code: "patrimoine", niveau: "info", libelle: completudePatrimoine.vide ? "Situation patrimoniale à compléter" : `Situation patrimoniale incomplète (${completudePatrimoine.pourcentage} %)`, cible: "client:patrimoine" });
  if (documents && documents.total > 0 && documents.recus < documents.total) a.push({ code: "documents", niveau: "info", libelle: `Documents manquants : ${documents.recus} / ${documents.total} reçus`, cible: "client:documents" });
  if (capaciteEvaluee === false) a.push({ code: "capacite", niveau: "info", libelle: "Capacité bancaire non évaluée", cible: "projet" });
  const rang = { danger: 0, warning: 1, info: 2 };
  return a.sort((x, y) => rang[x.niveau] - rang[y.niveau]);
}

/** Étape historique sur laquelle ouvrir le panneau « prochaine action » : l'étape principale, sinon la première non terminée. */
export function etapeADefinir({ pilotage = null, parcours = [] }) {
  return pilotage?.principale?.cle ?? parcours.find((e) => e.present && !FINIE.has(e.statut))?.cle ?? parcours.find((e) => e.present)?.cle ?? null;
}

/**
 * Checklist de transmission et conditions de clôture. Un point « non applicable » est explicite (travaux, par exemple) ;
 * « Terminer la mission » n'est proposé que quand tout est fait.
 */
export function checklistTransmission({ acquisition = null, finance = null, travaux = null, transmission = null, documents = null, clos = false }) {
  const acte = !!jour(acquisition?.acte_signe_le);
  const items = [
    { cle: "acte", libelle: "Acte authentique signé", etat: acte ? "ok" : "a_faire" },
    { cle: "financement", libelle: "Financement finalisé", etat: finance?.acceptee ? "ok" : "a_faire" },
    { cle: "travaux", libelle: "Travaux terminés / non applicables", etat: travaux?.etat === "termine" ? "ok" : travaux?.etat === "na" ? "na" : "a_faire" },
    { cle: "documents", libelle: "Documents finaux disponibles", etat: documents && documents.total > 0 && documents.recus >= documents.total ? "ok" : "a_faire" },
    { cle: "transmis", libelle: "Dossier transmis pour mise en location / gestion", etat: transmission?.date ? "ok" : "a_faire" },
  ];
  const manquants = items.filter((i) => i.etat === "a_faire");
  return { items, manquants, terminable: !clos && manquants.length === 0 };
}

/** Synthèse financière de l'opération. Rien n'est inventé : les frais, loyer et rentabilité absents restent null. */
export function syntheseOperation({ acquisition = null, bien = null, banques = [], apport = null, transmission = null }) {
  const cout = acquisition ? coutAcquisition(acquisition) : { prix: null, travaux: null, total: null };
  const retenues = nb(banques).filter((b) => b.retenue);
  const montants = retenues.map((b) => nombreOuNull(b.montant_accorde)).filter((m) => m !== null);
  const financement = montants.length ? montants.reduce((s, m) => s + m, 0) : null;
  return {
    prixAchat: cout.prix, travaux: cout.travaux, frais: null, coutGlobal: cout.total, financement, apport: nombreOuNull(apport),
    loyerCible: bien?.loyers ?? null, rendementCible: bien?.rendement ?? null,
    dateAcquisition: jour(acquisition?.acte_signe_le), dateTransmission: transmission?.date ?? null,
  };
}

/** Copie de `suivi_offre2` avec une section remplacée (les autres sections restent intactes). */
export function majSuivi(suivi, section, valeurs) {
  if (!["travaux", "transmission"].includes(section)) throw new Error("Section inconnue.");
  return { ...(suivi && typeof suivi === "object" ? suivi : {}), [section]: { ...((suivi || {})[section] || {}), ...valeurs } };
}

/** Nombre de jours de retard d'une échéance (0 si non dépassée ou absente). */
export const retardJours = (echeance, aujourdhui) => (echeance && jour(echeance) < aujourdhui ? joursEntre(jour(echeance), aujourdhui) : 0);

// ── Activité récente de la mission ──────────────────────────────────────────────────────────────
const TECHNIQUES = new Set(["dossier_modifie", "conseiller_change", "etape_balle_change", "etape_echeance_change", "etape_prochaine_action_change", "reprise_importee"]);
const LIBELLE_NOTE = { appel: "Appel", "rendez-vous": "Rendez-vous", relance: "Relance", commentaire: "Note", document: "Document", autre: "Note" };
/**
 * Événements pertinents, du plus récent au plus ancien : appels et notes du client, événements de la mission
 * (hors événements techniques) et biens proposés ou écartés. Le journal système n'est pas repris.
 */
export function activiteMission({ evenements = [], notes = [], lignes = [], max = 5 } = {}) {
  const ev = evenements.filter((e) => !TECHNIQUES.has(e.type)).map((e) => ({ id: `e-${e.id}`, quand: e.survenu_le || null, genre: "Mission", texte: e.resume || "", auteur: e.auteur_libelle || null }));
  const no = notes.map((n) => ({ id: `n-${n.id}`, quand: n.date || n.created_at || null, genre: LIBELLE_NOTE[n.type] ?? "Note", texte: n.contenu || "", auteur: n.auteur || null }));
  const bi = lignes.filter((l) => l.date).map((l) => ({ id: `b-${l.propositionId}`, quand: l.date, genre: "Bien", auteur: null,
    texte: `${l.statut === "refuse" ? "Bien refusé" : l.statut === "retenu" ? "Bien retenu" : "Bien proposé"} : ${l.bien.adresse || "adresse non renseignée"}` }));
  return [...ev, ...no, ...bi].sort((a, b) => String(b.quand || "").localeCompare(String(a.quand || ""))).slice(0, max);
}

// ── Modèle de la mission (assemble tout ce que les onglets affichent) ───────────────────────────
/**
 * @param extra { propositions, acquisitions, financement, banques, strategie, scenarios, hypotheses, notes } (lectures de la mission)
 * @param donnees données déjà chargées par la fiche dossier : { etapes, taches, evenements, collecte }
 * @param fiche sortie de construireFiche ; @param strategieClient strategie_data du client (checklist de pièces)
 */
export function construireModeleMission({ extra, donnees, fiche, strategieClient = {}, aujourdhui }) {
  const d = fiche.dossier;
  const lignes = lignesRecherche(extra.propositions);
  const synthR = syntheseRecherche(lignes);
  const offre = lireOffre(synthR.retenu?.brut);
  const acqs = nb(extra.acquisitions).filter((a) => !a.abandon_le);
  const acquisition = (synthR.retenu && acqs.find((a) => a.bien_id && a.bien_id === synthR.retenu.bienId)) || acqs[0] || null;
  const suiviDisponible = Object.prototype.hasOwnProperty.call(d, "suivi_offre2");
  const suivi = suiviDisponible ? d.suivi_offre2 : null;
  const frise = friseMission({ etapes: donnees.etapes, lignes, offre, acquisition, financement: extra.financement, banques: extra.banques, suivi, principaleCle: fiche.pilotage?.principale?.cle ?? null, clos: fiche.entete.clos });
  const finance = statutFinancement({ financement: extra.financement, banques: extra.banques });
  const docs = syntheseDocuments(strategieClient.documents_checklist || {}, strategieClient.documents_demandes || {});
  const patrimoine = completudePatrimoine(donnees.collecte || {}, null);
  const analyse = calculerAnalyse({ situation: fiche.situation, projet: fiche.projet, hypotheses: validerHypotheses(extra.hypotheses || {}).valides });
  const capaciteEvaluee = patrimoine.sections.find((s) => s.cle === "revenus")?.renseignee ? analyse.capacite.calculable : false;
  const criteres = criteresProjet(d.questionnaire_data || {});
  const etapeDefinir = etapeADefinir({ pilotage: fiche.pilotage, parcours: fiche.parcours });
  const anomalies = anomaliesMission({ aFaire: fiche.aFaire, pilotage: fiche.pilotage, completudePatrimoine: patrimoine, documents: docs, capaciteEvaluee, synthRecherche: synthR, offre });

  // À faire maintenant : tâches ouvertes de la mission + prochaine action réelle + « définir » + blocages.
  const af = fiche.aFaire;
  const missions = af && !af.sansAction ? [{ dossierId: d.id, reference: d.reference, prochaineAction: af.action, echeance: af.echeance, retardJours: af.retardJours, blocages: fiche.pilotage?.blocages || [] }] : [];
  const base = actionsAFaire({ missions, taches: nb(donnees.taches).filter((t) => t.dossier_id === d.id), dossiers: [d], aujourdhui, max: 99 }).tout
    .map((a) => (a.source === "mission" ? { ...a, mission: af.etape, boutons: ["ouvrir_etape"] } : { ...a, boutons: a.boutons.filter((b) => b !== "ouvrir") }));
  const sup = [];
  if (af?.sansAction) sup.push({ id: "definir", source: "definir", titre: "Définir la prochaine action", mission: af.etape || frise.libelleCourant, echeance: af.echeance, retardJours: af.retardJours || 0, priorite: af.retardJours ? "Urgente" : "Haute", boutons: ["definir"] });
  for (const b of fiche.pilotage?.blocages || []) sup.push({ id: `bloc-${b.etape}`, source: "blocage", titre: `Débloquer ${b.etape}${b.motif ? ` : ${b.motif}` : ""}`, mission: b.etape, echeance: null, retardJours: 0, priorite: "Urgente", boutons: ["ouvrir_etape"] });
  const toutes = trierActions([...sup, ...base]);
  const actions = { tout: toutes, visibles: toutes.slice(0, 5), total: toutes.length };
  return { lignes, synthR, offre, acquisition, strategie: extra.strategie || null, scenarios: nb(extra.scenarios), suivi, suiviDisponible, frise, finance, docs, patrimoine, analyse, capaciteEvaluee, criteres, etapeDefinir, anomalies, actions,
    activite: activiteMission({ evenements: donnees.evenements, notes: extra.notes, lignes }),
    travaux: lireTravaux({ acquisition, suivi }), transmission: lireTransmission(suivi), progression: progressionAcquisition({ acquisition, offre }) };
}
