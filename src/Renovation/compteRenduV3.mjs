// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — NOUVEAU PARCOURS (CR-3 du projet refonte), devenu
// PARCOURS UNIQUE à CR-6 (plus de « Journée comme prévu » / « Pas comme prévu »).
//
// Module PUR (aucun accès Supabase, aucune horloge). Façade : compteRenduV3.js.
//
// PRINCIPE : le parcours change l'ÉCRAN, pas les lignes. Il produit les mêmes
// lignes que le formulaire « cr_v2 » (compteRenduV2.mjs) : mêmes statuts, même
// avancement, mêmes champs. Deux champs facultatifs s'ajoutent :
//   collegue    { ouvrier, accord, etat }  — la tâche avait déjà été déclarée
//               ce jour-là par un collègue : confirmée (accord true) ou
//               contestée (accord false, son état à lui dans `etat`) ;
//   proposition.motif_hd  — pour une tâche créée par l'ouvrier : introuvable
//               (A) | imprevu (B) | demande_client (C), les motifs de l'étape 4.
// Depuis le parcours unique (CR-6), deux autres champs facultatifs :
//   prevu       { etat, avancement, repere } — le prévu affiché comme repère
//               sur une ligne prévue (voir prevuMemorise) ;
//   liaison     { texte_planning, proposee } — ligne du planning non liée que
//               l'ouvrier a rattachée à une tâche du phasage (ou transformée
//               en tâche créée) : le texte d'origine du planning, et si la
//               tâche choisie était la proposition en tête.
// La chaîne existante (Validation, pointages, bilan) les lit sans changement
// de sens : un champ inconnu est ignoré.
//
// ÉTAT ATTENDU CE SOIR (règle simple, voir etatAttenduCeSoir) : le moteur de
// planning ne dit pas qu'une tâche « doit finir » un jour donné ; on le déduit
// du planning lui-même (toutes personnes confondues, fonction serveur
// ouvrier_journee_cr) :
//   - la tâche est encore planifiée APRÈS aujourd'hui → « en cours », avec
//     l'avancement attendu = avancement + reste × heures du jour ÷ (heures du
//     jour + heures planifiées après) ;
//   - aujourd'hui est son DERNIER jour planifié → « terminée ce soir », sauf si
//     les heures du jour couvrent moins de la moitié de ce qui reste à faire
//     (heures estimées × reste) : alors « en cours » (planning pas prolongé) ;
//   - ligne du planning sans tâche du phasage, ou planning illisible → état
//     inconnu : l'ouvrier le dit lui-même (jamais deviné).
// ─────────────────────────────────────────────────────────────────────────────
import {
  appliquerChoix, appliquerChoixSuivi, changerMinutes, minutesDe, poserReste, choixDeLigne,
  suiviDepuisInfo, serialiserLigneV2, ORIGINE_NOUVELLE, ligneNouvelleTache, ajouterDepuisPhasage,
} from "./compteRenduV2.mjs";
import { ressemblanceNomsV2 } from "./horsDevisV2.mjs";

export const CODE_PARCOURS_V3 = "cr_parcours_v3";
// Réglage absent (jamais touché dans Admin) : le parcours est actif pour tous
// (CR-3 terminé le 25/10/2026, pas de déploiement progressif). Admin → éteint
// = retour immédiat au formulaire v2.
export const PARCOURS_ACTIF_PAR_DEFAUT = true;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const vide = (v) => v === undefined || v === null || String(v).trim() === "";
const net = (v) => String(v ?? "").trim();

// Réglage Admin (planning_config.cr_parcours_v3 = { actif: bool }).
export function parcoursActif(valeur, defaut = PARCOURS_ACTIF_PAR_DEFAUT) {
  if (valeur && typeof valeur === "object" && typeof valeur.actif === "boolean") return valeur.actif;
  if (typeof valeur === "boolean") return valeur;
  return defaut;
}

// ── Repères concrets (au lieu d'un pourcentage libre) ───────────────────────
// Mappés sur les valeurs que la chaîne attend déjà (boutons 25/50/75 du v2,
// 100 = Terminé).
export const REPERES = Object.freeze([
  { code: "commence",     label: "Commencé",     avancement: 25 },
  { code: "moitie",       label: "À moitié",     avancement: 50 },
  { code: "presque_fini", label: "Presque fini", avancement: 75 },
  { code: "termine",      label: "Terminé",      avancement: 100 },
]);
export const libelleRepere = (code) => REPERES.find(r => r.code === code)?.label || null;

// Repère affiché pour une ligne (null tant qu'aucun état n'est choisi).
export function repereDeLigne(t) {
  const choix = choixDeLigne(t);
  if (choix === "termine") return "termine";
  if (choix !== "en_cours") return null;
  const av = Math.round(num(t.avancement));
  return REPERES.find(r => r.code !== "termine" && r.avancement === av)?.code || null;
}

// Un repère est proposable s'il fait avancer la tâche (au-dessus de
// l'avancement actuel). Terminé l'est toujours.
export function repereProposable(code, avancementActuel) {
  const r = REPERES.find(x => x.code === code);
  if (!r) return false;
  return r.code === "termine" || avancementActuel == null || r.avancement > num(avancementActuel);
}

// Applique un repère : Terminé = choix Terminé ; sinon En cours + avancement.
// suivi : tâche suivie en quantité (suiviDepuisInfo) — l'avancement y est
// calculé depuis la quantité posée, le repère ne fixe alors que l'état.
export function appliquerRepere(t, code, { avancementActuel = null, suivi = null } = {}) {
  const r = REPERES.find(x => x.code === code);
  if (!r || !repereProposable(code, avancementActuel)) return t;
  if (r.code === "termine") {
    return suivi ? appliquerChoixSuivi(t, "termine", suivi) : appliquerChoix(t, "termine", { avancementActuel });
  }
  if (suivi) return appliquerChoixSuivi(t, "en_cours", suivi);
  const enCours = appliquerChoix(t, "en_cours", { avancementActuel });
  return { ...enCours, avancement: String(r.avancement) };
}

// Repère le plus proche d'un avancement attendu, parmi ceux qui font avancer
// la tâche ; aucun (déjà au-delà de « presque fini ») → null.
export function repereAttendu(avancementAttendu, avancementActuel) {
  const candidats = REPERES.filter(r => r.code !== "termine" && repereProposable(r.code, avancementActuel));
  if (!candidats.length) return null;
  return candidats.reduce((best, r) =>
    Math.abs(r.avancement - avancementAttendu) < Math.abs(best.avancement - avancementAttendu) ? r : best).code;
}

// ── État attendu ce soir ────────────────────────────────────────────────────
// prevue : { heures_jour, heures_apres, derniere_date } (ouvrier_journee_cr),
// info   : la tâche telle que la renvoie ouvrier_mes_phases (avancement,
//          heures_estimees), ou null.
// → { etat: "termine" | "en_cours" | "inconnu", avancement: number|null, raison }
export function etatAttenduCeSoir({ prevue = null, info = null } = {}) {
  if (!prevue) return { etat: "inconnu", avancement: null, raison: "pas de tâche du phasage ou planning illisible" };
  const av = Math.max(0, Math.min(100, num(info?.avancement)));
  if (av >= 100) return { etat: "termine", avancement: 100, raison: "déjà terminée au phasage" };
  const hj = num(prevue.heures_jour), ha = num(prevue.heures_apres);
  if (ha > 0) {
    const attendu = hj > 0 ? av + (100 - av) * (hj / (hj + ha)) : av;
    return { etat: "en_cours", avancement: Math.min(95, Math.round(attendu)), raison: "encore planifiée après aujourd'hui" };
  }
  const he = num(info?.heures_estimees);
  const reste = he > 0 ? he * (100 - av) / 100 : null;
  if (reste == null || hj >= reste * 0.5) {
    return { etat: "termine", avancement: 100, raison: "dernier jour planifié" };
  }
  return {
    etat: "en_cours", avancement: Math.min(95, Math.round(av + (hj / he) * 100)),
    raison: "dernier jour planifié, mais les heures du jour couvrent moins de la moitié du reste",
  };
}

// Phrase courte de l'état attendu : « terminée ce soir », « en cours ce soir »…
export function phraseAttendue(attendu) {
  if (!attendu || attendu.etat === "inconnu") return "à toi de dire où elle en est";
  if (attendu.etat === "termine") return "terminée ce soir";
  const r = REPERES.find(x => x.code === repereAttendu(attendu.avancement, null));
  return r ? `en cours ce soir (${r.label.toLowerCase()})` : "en cours ce soir";
}

// ── PARCOURS UNIQUE (CR-6) ──────────────────────────────────────────────────
// Plus de « Journée comme prévu » ni de « Pas comme prévu » : pour chaque
// chantier du jour, l'ouvrier voit directement la liste de ses tâches PRÉVUES
// (venues du planning), heures préremplies avec la durée prévue
// (preremplirDurees), et choisit LUI-MÊME l'état de chaque tâche. L'état
// attendu ce soir n'est plus jamais appliqué : il est affiché en petit comme
// repère (« prévu : terminée ce soir ») et mémorisé sur la ligne envoyée
// (`prevu`), pour mesurer plus tard la part des états déclarés identiques au
// prévu. (Décision du 26/10/2026 : l'état attendu n'est juste qu'environ une
// fois sur deux.)
export const estLignePrevue = (t) => !!t && !t.origine && !t.libre;

// Le repère affiché sous une tâche prévue ; null quand le prévu est inconnu
// (ligne du planning sans tâche du phasage, ou planning illisible) : rien
// n'est affiché plutôt qu'un faux repère.
export function phrasePrevu(attendu) {
  if (!attendu || attendu.etat === "inconnu") return null;
  return `prévu : ${phraseAttendue(attendu)}`;
}

// Ce qui est mémorisé sur la ligne prévue envoyée (champ `prevu`) :
//   { etat: "termine" | "en_cours" | "inconnu", avancement: 0-100 | null,
//     repere: code du repère affiché (commence…termine) | null }
// « inconnu » est écrit tel quel : une ligne sans repère n'est pas confondue
// avec un rapport plus ancien (qui n'a pas de champ `prevu` du tout).
export function prevuMemorise(attendu) {
  if (!attendu || (attendu.etat !== "termine" && attendu.etat !== "en_cours")) {
    return { etat: "inconnu", avancement: null, repere: null };
  }
  if (attendu.etat === "termine") return { etat: "termine", avancement: 100, repere: "termine" };
  const av = Math.round(num(attendu.avancement));
  return { etat: "en_cours", avancement: av, repere: repereAttendu(av, null) };
}

// « Pas commencé » du parcours unique : statut non_faite, 0 h, avancement du
// phasage INCHANGÉ (comme avant : la chaîne ne fait jamais reculer un
// avancement), et AUCUN motif.
export function appliquerPasCommence(t, { avancementActuel = null, suivi = null } = {}) {
  const next = suivi ? appliquerChoixSuivi(t, "pas_commence", suivi) : appliquerChoix(t, "pas_commence", { avancementActuel });
  return { ...next, motif: null };
}
// Libellé du bouton : une tâche déjà avancée « n'a pas avancé aujourd'hui »
// (même effet), pour ne pas laisser croire qu'on la remet à zéro.
export const libellePasCommence = (avancementActuel) => (num(avancementActuel) > 0 ? "Pas avancé aujourd'hui" : "Pas commencé");

// Juste avant l'envoi (parcours unique), sur les lignes PRÉVUES seulement :
//   - une tâche prévue SANS heures et SANS état part comme « pas commencé »
//     (non_faite, 0 h, avancement inchangé, sans motif) ;
//   - chaque ligne prévue mémorise le prévu affiché (`prevu`).
// Une tâche prévue AVEC des heures et sans état n'arrive jamais ici : l'envoi
// est bloqué avant (problemesLigne, règle « etat »).
//   attendus : { [idx]: etatAttenduCeSoir(...) } — les mêmes que l'écran.
export function finaliserParcours(taches, { attendus = {}, infosParTache = {} } = {}) {
  return (taches || []).map((t, idx) => {
    if (!estLignePrevue(t)) return t;
    let next = t;
    if (!choixDeLigne(t) && minutesDe(t) <= 0) {
      const info = t.tache_id ? infosParTache[String(t.tache_id)] || null : null;
      next = appliquerPasCommence(t, { avancementActuel: info?.avancement ?? null, suivi: suiviDepuisInfo(info) });
    }
    return { ...next, prevu: prevuMemorise(attendus[idx]) };
  });
}

// « J'ai fait autre chose » : les tâches choisies dans le phasage s'AJOUTENT à
// la liste ; aucune ligne déjà là n'est effacée ni modifiée, une tâche déjà
// dans la journée n'est jamais ajoutée deux fois.
export function ajouterChoixPhasage(taches, choix = [], chantier = null) {
  let arr = [...(taches || [])];
  for (const x of choix || []) arr = ajouterDepuisPhasage(arr, { ...x, nom: net(x?.nomAffiche) || net(x?.nom) }, chantier);
  return arr;
}

// Brouillon repris dans le parcours unique. Un brouillon de l'ancien parcours
// (CR-3 : parcours { ecran, branche, choisies }) ou un brouillon du formulaire
// v2 sans parcours s'ouvre sur la liste : chaque ligne est gardée telle
// quelle (heures, état déjà choisi, avancement, motifs, photos, remarques,
// tâches ajoutées ou créées). Seul l'écran change.
export function reprendreBrouillonParcours(brouillon) {
  const taches = Array.isArray(brouillon?.taches) ? brouillon.taches.map(t => ({ ...t })) : [];
  return { taches, ecran: "detail" };
}

// ── Ligne du planning non liée à une tâche du phasage ───────────────────────
// L'ouvrier choisit la tâche dans le phasage ; la proposition la plus probable
// est en tête. Score (0..1), du plus au moins important :
//   - ressemblance des noms (ressemblanceNomsV2, la même que la proposition du
//     cas A des tâches hors devis), nom personnalisé ou nom du devis : 45 % ;
//   - part des mots de la ligne retrouvés dans le nom de la tâche : 20 % ;
//   - part des mots retrouvés dans l'ouvrage, le lot ou la pièce : 10 % ;
//   - tâche pas encore terminée : 25 % (une ligne du planning porte sur du
//     travail à faire ; les terminées sont masquées dans le phasage).
// Les mots d'action du planning (« terminer », « finir », « continuer »…) ne
// comptent pas. Proposée seulement si les noms se ressemblent vraiment.
const MOTS_ACTION = new Set(["terminer", "termine", "terminee", "finir", "fini", "finie", "continuer", "commencer",
  "suite", "fin", "faire", "les", "des", "une", "pour", "avec", "dans", "sur", "aux", "par", "est"]);
const normLiaison = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const motsLiaison = (s) => normLiaison(s).split(" ").filter(m => m.length >= 3 && !MOTS_ACTION.has(m));
const motsProches = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4));
function couverture(mots, cible) {
  if (!mots.length) return 0;
  const b = motsLiaison(cible);
  return mots.filter(m => b.some(x => motsProches(m, x))).length / mots.length;
}
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Tâches du phasage à plat avec leur lot et leur pièce (arbre de phasageMobileV1).
export function tachesPourLiaison(arbre) {
  const pieces = new Map((arbre?.pieces || []).map(p => [p.id, p.nom]));
  return (arbre?.lots || []).flatMap(l => (l.ouvrages || []).flatMap(o => (o.taches || []).map(x => ({
    id: String(x.id), nom: net(x.nomAffiche) || net(x.nom), nomDevis: net(x.nomDevis) || net(x.nom),
    ouvrage: net(o.libelle), ouvrageDevis: net(o.libelleDevis), lot: net(l.label), piece: pieces.get(x.pieceId) || null,
    etat: x.etat || null, avancement: x.avancement ?? null, tache: x,
  }))));
}

// texte : la ligne du planning ; taches : tachesPourLiaison(arbre) ;
// exclure : tache_id déjà dans la journée (jamais proposées).
// → [{ id, nom, lot, ouvrage, piece, score, raisons, tache }] (meilleure d'abord)
export function propositionsLiaison({ texte, taches = [], exclure = [], max = 3 } = {}) {
  const propre = motsLiaison(texte).join(" ");
  const mots = motsLiaison(texte);
  if (!mots.length) return [];
  const exclus = new Set((exclure || []).map(String));
  return (taches || []).filter(x => x?.id && !exclus.has(String(x.id))).map(x => {
    const simNom = Math.max(ressemblanceNomsV2(propre, x.nom), ressemblanceNomsV2(propre, x.nomDevis || ""));
    const couvNom = couverture(mots, `${x.nom} ${x.nomDevis || ""}`);
    const couvCtx = couverture(mots, `${x.ouvrage || ""} ${x.ouvrageDevis || ""} ${x.lot || ""} ${x.piece || ""}`);
    const aFaire = x.etat !== "terminee" && num(x.avancement) < 100;
    const raisons = [];
    if (simNom >= 0.8) raisons.push("nom très proche"); else if (simNom >= 0.3 || couvNom >= 0.5) raisons.push("mots en commun");
    if (couvCtx > 0) raisons.push("même ouvrage, lot ou pièce");
    if (aFaire) raisons.push("pas encore terminée");
    return {
      id: x.id, nom: x.nom, lot: x.lot, ouvrage: x.ouvrage, piece: x.piece, tache: x.tache,
      score: r2(0.45 * simNom + 0.2 * couvNom + 0.1 * couvCtx + (aFaire ? 0.25 : 0)), simNom, couvNom, raisons,
    };
  }).filter(p => p.simNom >= 0.3 || p.couvNom >= 0.5)
    .sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, max)
    .map(({ simNom, couvNom, ...p }) => p);
}

// La ligne du planning est rattachée à la tâche choisie : elle GARDE ses
// heures (et ses photos, sa remarque) ; son nom devient celui de la tâche,
// le texte du planning est gardé dans `liaison`. L'état est à redire :
// l'avancement de référence est désormais celui de la tâche choisie.
export function lierLigneATache(t, tache, { proposee = false } = {}) {
  const { quantite_jour, unite, collegue, ...reste } = t || {};
  return {
    ...reste,
    tache_id: String(tache?.id),
    planifie: net(tache?.nomAffiche) || net(tache?.nom) || net(t?.planifie),
    statut: null, avancement: "", bloque: false, motif: null,
    liaison: { texte_planning: net(t?.liaison?.texte_planning) || net(t?.planifie), proposee: !!proposee },
  };
}

// … ou il crée une tâche (une seule question, le motif A / B / C) : la ligne
// devient une tâche créée, avec ses heures, ses photos et sa remarque.
export function creerTacheDepuisLigne(t, { nom, ouvrage = null, motif, photos = [] } = {}, chantier = null) {
  const toutes = [...new Set([...(Array.isArray(t?.photos) ? t.photos : []), ...(photos || [])])];
  const neuve = ligneTacheCreee({ nom, ouvrage, motif, photos: toutes }, chantier || { id: t?.chantier_id, nom: t?.chantier_nom, couleur: t?.chantier_couleur });
  return {
    ...neuve,
    heures_reelles: t?.heures_reelles ?? "",
    ...(t?.heures_prevues != null ? { heures_prevues: t.heures_prevues } : {}),
    remarque: t?.remarque || "",
    liaison: { texte_planning: net(t?.liaison?.texte_planning) || net(t?.planifie), proposee: false },
  };
}

// ── Temps : raccourcis et « le reste ici » ──────────────────────────────────
export const RACCOURCIS_MINUTES = Object.freeze([
  { code: "1h", label: "1 h", minutes: 60 },
  { code: "2h", label: "2 h", minutes: 120 },
  { code: "4h", label: "4 h", minutes: 240 },
  { code: "journee", label: "Journée", minutes: null },
]);
// Minutes d'une journée de travail sur les tâches : cible − trajets − indirectes.
export function minutesJourneeTaches({ cibleHeures, trajetMinutes = 0, indirectesHeures = 0 }) {
  return Math.max(0, Math.round(num(cibleHeures) * 60 - num(trajetMinutes) - num(indirectesHeures) * 60));
}
export function appliquerRaccourci(t, code, { minutesJournee = 0 } = {}) {
  const r = RACCOURCIS_MINUTES.find(x => x.code === code);
  if (!r) return t;
  return changerMinutes(t, r.minutes == null ? minutesJournee : r.minutes);
}
// « Le reste ici » : tout le temps restant de la journée sur cette tâche
// (resteMin > 0), ou le trop-plein retiré (resteMin < 0, jamais sous 0).
export function resteIci(t, resteMin) {
  if (!resteMin) return t;
  const cible = minutesDe(t) + resteMin;
  return cible < 0 ? changerMinutes(t, 0) : poserReste(t, resteMin);
}

// ── Frise horaire (option de l'ouvrier, désactivée par défaut) ──────────────
// heures « HH:MM ». segments : [{ cle, debut }] dans l'ordre de la journée ; un
// segment va jusqu'au début du suivant (le dernier jusqu'au départ). La pause
// est retirée du segment qui la contient.
//   → { durees: { [cle]: minutes }, total, erreurs: [texte] }
export const minutesDeHeure = (h) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(net(h));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function dureesDepuisFrise({ arrivee, depart, pause = null, segments = [] }) {
  const erreurs = [];
  const a = minutesDeHeure(arrivee), d = minutesDeHeure(depart);
  if (a == null || d == null || d <= a) erreurs.push("heures d'arrivée et de départ à vérifier");
  const pd = pause ? minutesDeHeure(pause.debut) : null, pf = pause ? minutesDeHeure(pause.fin) : null;
  const avecPause = pd != null && pf != null && pf > pd;
  const debuts = segments.map(s => minutesDeHeure(s.debut));
  if (debuts.some(x => x == null)) erreurs.push("une heure de changement est vide");
  for (let i = 1; i < debuts.length; i++) if (debuts[i] != null && debuts[i - 1] != null && debuts[i] < debuts[i - 1]) erreurs.push("les heures de changement ne sont pas dans l'ordre");
  if (debuts.length && a != null && debuts[0] != null && debuts[0] < a) erreurs.push("une tâche commence avant l'arrivée");
  if (debuts.length && d != null && debuts[debuts.length - 1] != null && debuts[debuts.length - 1] > d) erreurs.push("une tâche commence après le départ");
  const durees = {};
  if (erreurs.length) return { durees, total: 0, erreurs: [...new Set(erreurs)] };
  let total = 0;
  segments.forEach((s, i) => {
    const deb = debuts[i], fin = i + 1 < segments.length ? debuts[i + 1] : d;
    let min = Math.max(0, fin - deb);
    if (avecPause) min -= Math.max(0, Math.min(fin, pf) - Math.max(deb, pd));
    durees[s.cle] = (durees[s.cle] || 0) + Math.max(0, min);
    total += Math.max(0, min);
  });
  return { durees, total, erreurs };
}
// Pose les durées calculées sur les lignes (clé = index de la ligne).
export function appliquerFrise(taches, durees) {
  return (taches || []).map((t, idx) => (durees[idx] != null ? changerMinutes(t, durees[idx]) : t));
}

// ── Tâche créée par l'ouvrier : une seule question ─────────────────────────
// « Pourquoi elle n'est pas dans la liste ? » → motif de l'étape 4, et la
// nature v2 la plus proche (pour les écrans qui la lisent encore).
export const MOTIFS_CREATION = Object.freeze([
  { code: "introuvable",    label: "Je ne l'ai pas trouvée", nature: "oubli_phasage" },
  { code: "imprevu",        label: "Travail imprévu",        nature: "imprevu" },
  { code: "demande_client", label: "Demande du client",      nature: "demande_client" },
]);
export function ligneTacheCreee({ nom, ouvrage = null, motif, photos = [] }, chantier) {
  const m = MOTIFS_CREATION.find(x => x.code === motif);
  const ligne = ligneNouvelleTache({ nom, ouvrage, nature: m?.nature || null, photos }, chantier);
  return { ...ligne, proposition: { ...ligne.proposition, motif_hd: m ? m.code : null } };
}

// ── Tâches faites à plusieurs ───────────────────────────────────────────────
// declarations (ouvrier_journee_cr) → { [tache_id]: [{ ouvrier, statut, avancement, bloque, ... }] }
// (la dernière déclaration de chaque collègue ; Pas commencé ignoré).
export function declarationsParTache(declarations = []) {
  const out = {};
  (declarations || []).forEach(d => {
    const id = net(d?.tache_id);
    if (!id || d.statut === "non_faite" && !d.bloque) return;
    const liste = out[id] || (out[id] = []);
    const i = liste.findIndex(x => x.ouvrier === d.ouvrier);
    if (i >= 0) liste[i] = d; else liste.push(d);
  });
  return out;
}
export function etatDeclaration(d) {
  if (!d) return null;
  if (d.bloque) return "bloque";
  if (d.statut === "faite") return "termine";
  if (d.statut === "en_cours") return "en_cours";
  return null;
}
// « Davy a déclaré : bandes SDB terminées »
export function phraseCollegue(d, nomTache) {
  const e = etatDeclaration(d);
  const etat = e === "termine" ? "terminée" : e === "bloque" ? "bloquée"
    : e === "en_cours" ? `en cours${vide(d.avancement) ? "" : ` (${Math.round(num(d.avancement))} %)`}` : "déclarée";
  return `${net(d?.ouvrier) || "Un collègue"} a déclaré : ${net(nomTache) || "cette tâche"} ${etat}`;
}
// D'accord : même état que le collègue ; l'ouvrier n'ajoute que son temps.
export function confirmerCollegue(t, d, { avancementActuel = null, suivi = null } = {}) {
  const e = etatDeclaration(d);
  let next = t;
  if (e === "termine") next = appliquerRepere(t, "termine", { avancementActuel, suivi });
  else if (e === "en_cours") {
    next = suivi ? appliquerChoixSuivi(t, "en_cours", suivi) : { ...appliquerChoix(t, "en_cours", { avancementActuel }), avancement: vide(d.avancement) ? "" : String(Math.round(num(d.avancement))) };
  } else if (e === "bloque") next = { ...appliquerChoix(t, "bloque", { avancementActuel }), motif: t.motif ?? null };
  return { ...next, collegue: { ouvrier: net(d.ouvrier), accord: true, etat: e } };
}
// Pas d'accord : l'ouvrier dit son propre état ; la Validation le signale.
export function contesterCollegue(t, d) {
  return { ...t, collegue: { ouvrier: net(d?.ouvrier), accord: false, etat: etatDeclaration(d) } };
}

// Écriture d'une ligne : celle du v2, plus `collegue` s'il existe.
export function serialiserLigneV3(t) {
  const out = serialiserLigneV2(t);
  if (t.collegue && net(t.collegue.ouvrier)) {
    out.collegue = { ouvrier: net(t.collegue.ouvrier), accord: t.collegue.accord === true, etat: t.collegue.etat || null };
  }
  if (t.origine === ORIGINE_NOUVELLE && t.proposition?.motif_hd && out.proposition) {
    out.proposition = { ...out.proposition, motif_hd: t.proposition.motif_hd };
  }
  if (t.prevu && typeof t.prevu === "object") {
    const e = ["termine", "en_cours"].includes(t.prevu.etat) ? t.prevu.etat : "inconnu";
    out.prevu = {
      etat: e,
      avancement: e === "inconnu" || t.prevu.avancement == null ? null : Math.round(num(t.prevu.avancement)),
      repere: e === "inconnu" ? null : (REPERES.some(r => r.code === t.prevu.repere) ? t.prevu.repere : null),
    };
  }
  if (t.liaison && net(t.liaison.texte_planning)) {
    out.liaison = { texte_planning: net(t.liaison.texte_planning), proposee: t.liaison.proposee === true };
  }
  return out;
}

// ── Retour après l'envoi ────────────────────────────────────────────────────
// Message court et factuel tiré de ce qui vient d'être envoyé. Aucun chiffre
// d'avancement du chantier : il n'existe pas de chiffre « chantier » partagé
// avec l'écran ouvrier, et l'avancement ne bouge qu'à la validation.
export function messageRetour({ prenom = "", taches = [] } = {}) {
  const lignes = (taches || []).filter(t => net(t.planifie));
  const terminees = lignes.filter(t => choixDeLigne(t) === "termine").map(t => net(t.planifie));
  const enCours = lignes.filter(t => choixDeLigne(t) === "en_cours").length;
  const bloquees = lignes.filter(t => choixDeLigne(t) === "bloque").length;
  const morceaux = [];
  if (terminees.length === 1) morceaux.push(`${terminees[0]} terminée`);
  else if (terminees.length > 1) morceaux.push(`${terminees.length} tâches terminées`);
  if (enCours) morceaux.push(`${enCours} en cours`);
  if (bloquees) morceaux.push(`${bloquees} bloquée${bloquees > 1 ? "s" : ""}`);
  const merci = `Merci${net(prenom) ? ` ${net(prenom)}` : ""} !`;
  return morceaux.length
    ? `${merci} ${morceaux.join(", ")}. Ton conducteur va valider ta journée.`
    : `${merci} Ta journée est envoyée à ton conducteur.`;
}
