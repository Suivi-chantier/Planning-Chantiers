// Vérification CR-6B : écart orange « avancement incohérent avec les heures »
// à la validation (3 cas, seuils réglables, données manquantes) et avancement
// retenu d'une tâche faite à plusieurs gardé après un rechargement de la page.
// Exemple issu des tests, données fictives : chantier « C1 », ouvriers
// « Ouvrier A » / « Ouvrier B », tâches t1…t6.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLE_CONFIG_AVANCEMENT_INCOHERENT, SEUILS_AVANCEMENT_INCOHERENT_DEFAUT, normaliserSeuilsAvancementIncoherent,
  avancementDeclare, ecartAvancementIncoherent, ecartsAvancementIncoherentRapport, declarationsParTache,
  heuresJourParTache, donneesTachesIncoherence, veilleDe,
} from "../src/Renovation/avancementIncoherentV1.mjs";
import {
  classerRapport, peutValiderDirect, poserArbitrage, appliquerArbitrages, CLE_STOCKAGE_ARBITRAGES,
  arbitragesDuJour, stockerArbitragesDuJour, fusionnerArbitrages, arbitragesEncoreUtiles,
} from "../src/Renovation/validationJourneeV1.mjs";
import { lignesDepuisRapport } from "../src/Renovation/lignesValidation.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };
const cas = (e) => (e ? e.cas : []);

// ── Réglages ────────────────────────────────────────────────────────────────
eq(CLE_CONFIG_AVANCEMENT_INCOHERENT, "seuils_avancement_incoherent", "clé planning_config dédiée");
eq(normaliserSeuilsAvancementIncoherent(null), { ...SEUILS_AVANCEMENT_INCOHERENT_DEFAUT }, "réglage jamais enregistré = valeurs par défaut");
eq(normaliserSeuilsAvancementIncoherent(null), { ratioHeuresMin: 0.5, heuresPrevuesMin: 2, gainSansHeuresPts: 25, retourTermineeActif: true }, "défauts : 0,5 ; 2 h ; 25 points ; cas 3 actif");
eq(normaliserSeuilsAvancementIncoherent({ ratioHeuresMin: "0,4", heuresPrevuesMin: "abc", gainSansHeuresPts: -3, retourTermineeActif: "oui" }),
  { ratioHeuresMin: 0.4, heuresPrevuesMin: 2, gainSansHeuresPts: 25, retourTermineeActif: true }, "valeur illisible ou négative : défaut ; virgule acceptée");

// ── Avancement déclaré ──────────────────────────────────────────────────────
eq(avancementDeclare({ statut: "faite", avancement: 40 }), 100, "Terminée = 100");
eq(avancementDeclare({ statut: "en_cours", avancement: "75" }), 75, "En cours = pourcentage déclaré");
eq(avancementDeclare({ statut: "en_cours" }), null, "En cours sans pourcentage : inconnu");
eq(avancementDeclare({ statut: "non_faite" }), null, "Pas commencé : aucun avancement déclaré");
eq(avancementDeclare({ statut: "faite", bloque: true }), null, "bloquée : pas contrôlée ici");

// ── Cas 1 : avancement en avance sur les heures ─────────────────────────────
const base = { nom: "Bandes chambre", statut: "faite", avancementDeclare: 100, avancementAvant: 30, heuresAvant: 0, heuresJour: 2, heuresPrevues: 10 };
const e1 = ecartAvancementIncoherent(base);
eq(cas(e1), [1], "terminée avec 2 h pour 10 h prévues : cas 1");
eq(e1.niveau, "orange", "écart orange");
eq(e1.texte, "« Bandes chambre » déclarée terminée avec 2 h pour 10 h prévues", "texte en clair (exemple du cahier)");
eq(ecartAvancementIncoherent({ ...base, statut: "en_cours", avancementDeclare: 80, heuresAvant: 1, heuresJour: 2 }).texte,
  "« Bandes chambre » déclarée à 80 % avec 3 h pour 10 h prévues", "en cours : pourcentage et heures avant + du jour");
eq(cas(ecartAvancementIncoherent({ ...base, heuresAvant: 2.9, heuresJour: 2 })), [1], "4,9 h pour 10 h (0,49) : juste en dessous de 0,5 → écart");
eq(ecartAvancementIncoherent({ ...base, heuresAvant: 3, heuresJour: 2 }), null, "5 h pour 10 h (0,5 pile) : pas d'écart");
eq(ecartAvancementIncoherent({ ...base, heuresAvant: 3.1, heuresJour: 2 }), null, "5,1 h pour 10 h (0,51) : pas d'écart");
eq(cas(ecartAvancementIncoherent({ ...base, statut: "en_cours", avancementDeclare: 50, heuresAvant: 0, heuresJour: 2.4 })), [1], "50 % avec 2,4 h pour 10 h : 2,4 ÷ 5 = 0,48 → écart");
eq(ecartAvancementIncoherent({ ...base, heuresPrevues: 1.5, heuresJour: 0.25 }), null, "tâche de moins de 2 h prévues : ignorée");
eq(cas(ecartAvancementIncoherent({ ...base, heuresPrevues: 2, heuresJour: 0.25 })), [1], "tâche de 2 h prévues pile : contrôlée");
eq(ecartAvancementIncoherent({ ...base, avancementAvant: 100, statut: "faite" }), null, "avancement inchangé (déjà à 100 %) : rien reproché au compte rendu du jour");

// ── Cas 2 : gain d'au moins 25 points sans heure ce jour-là ─────────────────
const b2 = { nom: "Enduit séjour", statut: "en_cours", avancementAvant: 50, heuresAvant: 8, heuresJour: 0, heuresPrevues: 10 };
eq(ecartAvancementIncoherent({ ...b2, avancementDeclare: 74 }), null, "+24 points sans heure : pas d'écart");
const e2 = ecartAvancementIncoherent({ ...b2, avancementDeclare: 75 });
eq(cas(e2), [2], "+25 points sans heure : cas 2");
eq(e2.texte, "« Enduit séjour » passe de 50 % à 75 % (+25 points) sans aucune heure pointée dessus ce jour-là", "texte du cas 2 en clair");
eq(ecartAvancementIncoherent({ ...b2, avancementDeclare: 90, heuresJour: 0.5 }), null, "une heure pointée (par n'importe qui) ce jour-là : pas de cas 2");
eq(cas(ecartAvancementIncoherent({ ...b2, statut: "faite", avancementDeclare: 100, heuresAvant: 9 })), [2], "terminée sans heure ce jour-là, +50 points : cas 2");
ok(/passe de 50 % à terminée/.test(ecartAvancementIncoherent({ ...b2, statut: "faite", avancementDeclare: 100, heuresAvant: 9 }).texte), "« à terminée » écrit en clair");
const e12 = ecartAvancementIncoherent({ ...b2, avancementAvant: 0, heuresAvant: 0, statut: "faite", avancementDeclare: 100 });
eq(cas(e12), [1, 2], "terminée avec 0 h du tout : cas 1 et 2, UN seul écart");
ok(/ ; /.test(e12.texte), "les deux textes réunis");

// ── Cas 3 : tâche terminée qui revient « en cours » ─────────────────────────
const b3 = { nom: "Faïence douche", avancementAvant: 100, heuresAvant: 12, heuresJour: 2, heuresPrevues: 10 };
const e3 = ecartAvancementIncoherent({ ...b3, statut: "en_cours", avancementDeclare: 60 });
eq(cas(e3), [3], "terminée la veille, déclarée en cours 60 % : cas 3");
eq(e3.texte, "« Faïence douche » était terminée et revient « en cours 60 % »", "texte du cas 3 en clair");
eq(cas(ecartAvancementIncoherent({ ...b3, statut: "en_cours", avancementDeclare: null })), [3], "en cours sans pourcentage : cas 3 quand même");
eq(ecartAvancementIncoherent({ ...b3, statut: "non_faite", avancementDeclare: null, heuresJour: 0 }), null, "« Pas avancé aujourd'hui » sur une tâche terminée : PAS de cas 3");
eq(ecartAvancementIncoherent({ ...b3, statut: "en_cours", avancementDeclare: 100 }), null, "« en cours 100 % » : pas un retour en arrière");
eq(ecartAvancementIncoherent({ ...b3, statut: "faite", avancementDeclare: 100 }), null, "re-déclarée terminée : rien");
eq(ecartAvancementIncoherent({ ...b3, avancementAvant: 95, statut: "en_cours", avancementDeclare: 60 }), null, "à 95 % la veille : pas « terminée », pas de cas 3");
eq(ecartAvancementIncoherent({ ...b3, statut: "en_cours", avancementDeclare: 60, bloque: true }), null, "bloquée : déjà rouge, pas contrôlée ici");
eq(ecartAvancementIncoherent({ ...b3, statut: "en_cours", avancementDeclare: 60 }, { retourTermineeActif: false }), null, "cas 3 désactivé dans Admin : rien");

// ── Seuils réglés autrement ─────────────────────────────────────────────────
eq(ecartAvancementIncoherent({ ...base, heuresAvant: 2.9, heuresJour: 2 }, { ratioHeuresMin: 0.3 }), null, "ratio réglé à 0,3 : 0,49 ne déclenche plus");
eq(cas(ecartAvancementIncoherent({ ...base, heuresAvant: 0.9, heuresJour: 2 }, { ratioHeuresMin: 0.3 })), [1], "ratio réglé à 0,3 : 0,29 déclenche");
eq(cas(ecartAvancementIncoherent({ ...base, heuresPrevues: 1.5, heuresJour: 0.25 }, { heuresPrevuesMin: 1 })), [1], "minimum réglé à 1 h : la tâche de 1,5 h est contrôlée");
eq(cas(ecartAvancementIncoherent({ ...b2, avancementDeclare: 74 }, { gainSansHeuresPts: 20 })), [2], "gain réglé à 20 points : +24 déclenche");
eq(ecartAvancementIncoherent({ ...b2, avancementDeclare: 75 }, { gainSansHeuresPts: 30 }), null, "gain réglé à 30 points : +25 ne déclenche plus");

// ── Données manquantes : rien d'inventé ─────────────────────────────────────
eq(ecartAvancementIncoherent({ ...base, heuresPrevues: null }), null, "heures prévues inconnues : pas de cas 1");
eq(ecartAvancementIncoherent({ ...base, heuresPrevues: 0 }), null, "0 h prévue : traitée comme inconnue");
eq(ecartAvancementIncoherent({ ...base, heuresAvant: null }), null, "heures d'avant illisibles : pas de cas 1");
eq(ecartAvancementIncoherent({ ...b2, avancementDeclare: 90, avancementAvant: null }), null, "avancement de la veille inconnu : pas de cas 2");
eq(ecartAvancementIncoherent({ ...b2, avancementDeclare: 90, heuresJour: null }), null, "heures du jour inconnues : pas de cas 2");
eq(ecartAvancementIncoherent({ ...b3, avancementAvant: null, statut: "en_cours", avancementDeclare: 60 }), null, "avancement de la veille inconnu : pas de cas 3");
eq(ecartAvancementIncoherent({ ...base, avancementAvant: null }).cas, [1], "avancement de la veille inconnu : le cas 1 (qui n'en a pas besoin) reste contrôlé");

// ── Assemblage des données (mêmes sources que la barre de budget) ───────────
eq(veilleDe("2026-11-01"), "2026-10-31", "veille d'un 1er du mois");
eq(veilleDe("2026-03-01"), "2026-02-28", "veille du 1er mars");
const ouvrages = [{ id: "o1", taches: [
  { id: "t1", nom: "Bandes chambre", heures_vendues: 10, avancement: 100 },
  { id: "t2", nom: "Enduit séjour", heures_vendues: 10, avancement: 75 },
  { id: "t3", nom: "Faïence douche", heures_vendues: 10, avancement: 60 },
  { id: "t4", nom: "Joints", heures_vendues: 0, avancement: 20 },
  { id: "t5", nom: "Nettoyage", heures_vendues: 1.5, avancement: 0 },
] }];
const JOUR = "2026-10-21";
const journal = [
  { tache_id: "t1", avancement_avant: 0, avancement_apres: 30, date_realisation: "2026-10-19", created_at: "2026-10-19T18:00:00Z" },
  { tache_id: "t1", avancement_avant: 30, avancement_apres: 100, date_realisation: "2026-10-21", created_at: "2026-10-21T18:00:00Z" },
  { tache_id: "t2", avancement_avant: 0, avancement_apres: 50, date_realisation: "2026-10-20", created_at: "2026-10-20T18:00:00Z" },
  { tache_id: "t3", avancement_avant: 60, avancement_apres: 100, date_realisation: "2026-10-18", created_at: "2026-10-18T18:00:00Z" },
  { tache_id: "t3", avancement_avant: 100, avancement_apres: 60, date_realisation: "2026-10-21", created_at: "2026-10-21T19:00:00Z" },
];
const pointagesAvant = [
  { tache_id: "t2", heures: 5, type_pointage: "tache", date: "2026-10-20" },
  { tache_id: "t2", heures: 3, type_pointage: null, date: "2026-10-19" },
  { tache_id: "t2", heures: 1, type_pointage: "trajet", date: "2026-10-19" },
  { tache_id: "t2", heures: 4, type_pointage: "tache", date: JOUR },
  { tache_id: "t3", heures: 12, type_pointage: "tache", date: "2026-10-18" },
];
const donnees = donneesTachesIncoherence({ ouvrages, pointagesAvant, journal, date: JOUR });
eq(donnees.t1, { heuresAvant: 0, heuresPrevues: 10, avancementAvant: 30 }, "t1 : 30 % la veille d'après le journal (la validation du jour ne compte pas)");
eq(donnees.t2.heuresAvant, 8, "heures avant : pointages « tâche » datés avant le jour (ni trajet, ni le jour même)");
eq(donnees.t3.avancementAvant, 100, "t3 : terminée la veille");
eq(donnees.t4, { heuresAvant: 0, heuresPrevues: null, avancementAvant: 20 }, "jamais modifiée : avancement actuel ; 0 h prévue → inconnu");
eq(donneesTachesIncoherence({ ouvrages, pointagesAvant: null, journal: null, date: JOUR }).t1,
  { heuresAvant: null, heuresPrevues: 10, avancementAvant: null }, "registre et journal illisibles : inconnus, jamais zéro");

// ── Un compte rendu : écart orange, plus de « Valider » direct ──────────────
const rA = { id: "rA", ouvrier: "Ouvrier A", chantier_id: "C1", date_rapport: JOUR, statut: "en_attente", trajet_matin_min: 0, trajet_soir_min: 0,
  taches: [{ tache_id: "t1", planifie: "Bandes chambre", statut: "faite", avancement: 100, heures_reelles: 2 }] };
const rB = { id: "rB", ouvrier: "Ouvrier B", chantier_id: "C1", date_rapport: JOUR, statut: "en_attente", trajet_matin_min: 0, trajet_soir_min: 0,
  taches: [
    { tache_id: "t2", planifie: "Enduit séjour", statut: "en_cours", avancement: 75, heures_reelles: 0 },
    { tache_id: "t3", planifie: "Faïence douche", statut: "en_cours", avancement: 60, heures_reelles: 3 },
    { tache_id: "t5", planifie: "Nettoyage", statut: "faite", avancement: 100, heures_reelles: 0.25 },
  ] };
const rC = { id: "rC", ouvrier: "Ouvrier C", chantier_id: "C1", date_rapport: JOUR, statut: "en_attente", trajet_matin_min: 0, trajet_soir_min: 0,
  taches: [{ tache_id: "t3", planifie: "Faïence douche", statut: "non_faite", heures_reelles: 0 }, { tache_id: "t2", planifie: "Enduit séjour", statut: "en_cours", avancement: 60, heures_reelles: 7 }] };
const hJour = heuresJourParTache([rA, rB]);
eq(hJour, { t1: 2, t2: 0, t3: 3, t5: 0.25 }, "heures du jour : toutes les personnes, tous les comptes rendus du jour");
eq(heuresJourParTache([rA, rB, rC]).t2, 7, "heures d'un collègue sur la même tâche comptées");
const ctxInc = { seuils: null, donneesParTache: donnees, heuresJourParTache: hJour };
const ecB = ecartsAvancementIncoherentRapport(rB, ctxInc);
eq(ecB.map(e => [e.tache_id, e.cas]), [["t2", [2]], ["t3", [3]]], "B : t2 +25 points sans heure (cas 2), t3 terminée revient en cours (cas 3) ; t5 (1,5 h prévue) ignorée");
eq(ecartsAvancementIncoherentRapport(rB, { ...ctxInc, heuresJourParTache: heuresJourParTache([rA, rB, rC]) }).map(e => e.tache_id), ["t3"],
  "un collègue a pointé 7 h sur t2 ce jour-là : plus de cas 2");
eq(ecartsAvancementIncoherentRapport(rC, { ...ctxInc, heuresJourParTache: heuresJourParTache([rA, rB, rC]) }), [], "C : « pas avancé aujourd'hui » sur la tâche terminée ne déclenche rien");
eq(ecartsAvancementIncoherentRapport(rB, { ...ctxInc, avancementDeclareParTache: { t2: 60 } }).map(e => e.tache_id), ["t3"],
  "tâche suivie en quantité : l'avancement calculé depuis la quantité remplace le pourcentage");
eq(ecartsAvancementIncoherentRapport(rB, { ...ctxInc, donneesParTache: {} }), [], "tâches sans données : rien ne se déclenche");
const doublon = declarationsParTache({ taches: [
  { tache_id: "t9", planifie: "X", statut: "en_cours", avancement: 40, heures_reelles: 1 },
  { tache_id: "t9", planifie: "X", statut: "faite", avancement: 100, heures_reelles: 2 },
  { planifie: "Libre", statut: "faite", heures_reelles: 1 },
] });
eq([...doublon.values()].map(d => [d.tache_id, d.statut, d.avancement, d.heures]), [["t9", "faite", 100, 3]], "deux lignes sur une tâche : heures additionnées, Terminée l'emporte ; ligne libre ignorée");

const ctxPage = { avancementParTache: { t1: 30 }, ouvriersPlanifies: ["Ouvrier A", "Ouvrier B"], heuresAttendues: 2, heuresJourOuvrier: 2 };
const sans = classerRapport(rA, ctxPage);
eq(sans.niveau, "comme_prevu", "sans le contrôle : A serait « comme prévu »");
ok(peutValiderDirect(rA, sans), "… avec « Valider » direct");
const avec = classerRapport(rA, { ...ctxPage, avancementIncoherent: ctxInc });
eq(avec.niveau, "ecarts", "avec le contrôle : écart orange");
ok(avec.ecarts.some(e => e.code === "avancement_incoherent" && e.texte === "« Bandes chambre » déclarée terminée avec 2 h pour 10 h prévues"), "texte affiché dans la ligne du compte rendu");
ok(!peutValiderDirect(rA, avec), "cas 1 : plus de « Valider » direct");
const cB = classerRapport(rB, { ...ctxPage, heuresAttendues: null, avancementIncoherent: ctxInc });
ok(cB.niveau === "ecarts" && !peutValiderDirect(rB, cB), "cas 2 et 3 : écart orange, plus de « Valider » direct");
eq(cB.ecarts.filter(e => e.code === "avancement_incoherent").length, 2, "un écart par tâche concernée");
eq(classerRapport(rA, ctxPage).ecarts.filter(e => e.code === "avancement_incoherent"), [], "contexte absent (données non chargées) : aucun écart inventé");

// ── Avancement retenu gardé après un rechargement ───────────────────────────
eq(CLE_STOCKAGE_ARBITRAGES, "profero.validation.arbitrages.v1", "clé du stockage du navigateur");
// Le conducteur retient 80 % pour t1 (faite par A et B), puis recharge la page.
const memoire = poserArbitrage({}, "C1", "t1", 80);
let stockage = stockerArbitragesDuJour(null, JOUR, memoire);
stockage = stockerArbitragesDuJour(stockage, "2026-10-20", poserArbitrage({}, "C1", "t7", 40));
const relu = arbitragesDuJour(stockage, JOUR);   // « rechargement » : la page relit le stockage
eq(relu, { C1: { t1: 80 } }, "après rechargement : l'avancement retenu est relu");
eq(arbitragesDuJour(stockage, "2026-10-20"), { C1: { t7: 40 } }, "chaque jour garde les siens");
const r1 = { id: "r1", chantier_id: "C1", statut: "en_attente", taches: [{ tache_id: "t1", statut: "en_cours", avancement: 50, heures_reelles: 4 }] };
const r2 = { id: "r2", chantier_id: "C1", statut: "en_attente", taches: [{ tache_id: "t1", statut: "faite", avancement: 100, heures_reelles: 3 }] };
eq(appliquerArbitrages(lignesDepuisRapport(r2), relu.C1)[0].avancement_arbitre, 80, "relu puis appliqué au compte rendu ouvert");
eq(arbitragesEncoreUtiles(relu, [{ ...r1, statut: "valide" }, r2]), { C1: { t1: 80 } }, "un seul des deux validé : gardé pour l'autre");
const apres = arbitragesEncoreUtiles(relu, [{ ...r1, statut: "valide" }, { ...r2, statut: "valide" }]);
eq(apres, {}, "les deux validés : oublié");
stockage = stockerArbitragesDuJour(stockage, JOUR, apres);
eq(arbitragesDuJour(stockage, JOUR), {}, "nettoyé du stockage après validation");
eq(arbitragesDuJour(stockage, "2026-10-20"), { C1: { t7: 40 } }, "les autres jours ne sont pas touchés");
eq(arbitragesDuJour(stockerArbitragesDuJour(stockage, JOUR, memoire, { garderDepuis: "2026-10-21" }), "2026-10-20"), {}, "jours trop anciens oubliés");
eq(arbitragesDuJour("pas du JSON", JOUR), {}, "stockage illisible : aucun arbitrage, pas d'erreur");
eq(arbitragesDuJour(JSON.stringify({ [JOUR]: { C1: { t1: "abc", t2: 140 } } }), JOUR), { C1: { t2: 100 } }, "valeurs relues nettoyées (0-100)");
eq(fusionnerArbitrages({ C1: { t1: 60, t2: 30 } }, { C1: { t1: 80 } }), { C1: { t1: 80, t2: 30 } }, "mémoire de la page + stockage : la mémoire l'emporte");

// ── Branchement à l'écran ───────────────────────────────────────────────────
const V = readFileSync(new URL("../src/Renovation/Validation.jsx", import.meta.url), "utf8");
const A = readFileSync(new URL("../src/Renovation/Admin.jsx", import.meta.url), "utf8");
const SA = readFileSync(new URL("../src/Renovation/SeuilsAvancementIncoherentAdmin.jsx", import.meta.url), "utf8");
ok(/donneesTachesIncoherence\(\{/.test(V) && /heuresJourParTache\(rapports\.filter/.test(V) && /avancementIncoherent: \{/.test(V), "la page de la journée passe les données du contrôle à classerRapport");
ok(/lireToutParTranches\(\(a, b\) => supabase\.from\("pointages"\)/.test(V) && /from\("avancement_journal"\)/.test(V), "registre et journal lus par tranches (jamais tronqués)");
ok(/CLE_CONFIG_AVANCEMENT_INCOHERENT/.test(V) && /normaliserSeuilsAvancementIncoherent\(/.test(V), "seuils lus dans planning_config (défauts sinon)");
ok(/try \{ return window\.localStorage\.getItem\(CLE_STOCKAGE_ARBITRAGES\); \} catch/.test(V) && /rechargerArbitrages\(dateFilter, rs \|\| \[\]\)/.test(V), "avancement retenu relu au chargement, dans un try/catch");
ok(/onAppliquerArbitrage=\{appliquerArbitrage\}/.test(V), "« Appliquer aux deux » enregistre aussi dans le navigateur");
ok(/<SeuilsAvancementIncoherentAdmin T=\{T\} saveConfig=\{saveConfig\}\/>/.test(A) && /saveConfig\?\.\(CLE_CONFIG_AVANCEMENT_INCOHERENT/.test(SA), "réglages dans Admin, enregistrés comme les autres seuils");
ok(/type="checkbox"/.test(SA) && /retourTermineeActif/.test(SA), "cas 3 activable");

console.log(`verif-cr6-avancement-incoherent : ${nbOk} contrôles OK (données fictives)`);
