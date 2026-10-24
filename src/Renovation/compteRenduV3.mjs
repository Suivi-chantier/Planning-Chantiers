// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — NOUVEAU PARCOURS (CR-3 du projet refonte).
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
  suiviDepuisInfo, serialiserLigneV2, ORIGINE_NOUVELLE, ligneNouvelleTache,
} from "./compteRenduV2.mjs";

export const CODE_PARCOURS_V3 = "cr_parcours_v3";
// Réglage absent (jamais touché dans Admin) : le parcours est-il actif ?
export const PARCOURS_ACTIF_PAR_DEFAUT = false;

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

// Phrase courte de l'écran d'accueil : « terminée ce soir », « en cours ce soir »…
export function phraseAttendue(attendu) {
  if (!attendu || attendu.etat === "inconnu") return "à toi de dire où elle en est";
  if (attendu.etat === "termine") return "terminée ce soir";
  const r = REPERES.find(x => x.code === repereAttendu(attendu.avancement, null));
  return r ? `en cours ce soir (${r.label.toLowerCase()})` : "en cours ce soir";
}

// ── « Journée comme prévu » ─────────────────────────────────────────────────
// Chaque tâche PRÉVUE (venue du planning) reçoit son état attendu, par les
// MÊMES fonctions que la saisie manuelle (repères) ; la durée prévue est déjà
// préremplie au chargement (preremplirDurees). État inconnu → la ligne reste
// à compléter par l'ouvrier.
//   attendus : { [idx]: etatAttenduCeSoir(...) }
export const estLignePrevue = (t) => !!t && !t.origine && !t.libre;
export function lignesCommePrevu(taches, attendus = {}, infosParTache = {}) {
  return (taches || []).map((t, idx) => {
    if (!estLignePrevue(t)) return t;
    const a = attendus[idx];
    if (!a || a.etat === "inconnu") return t;
    const info = t.tache_id ? infosParTache[String(t.tache_id)] || null : null;
    const suivi = suiviDepuisInfo(info);
    const avancementActuel = info?.avancement ?? null;
    if (a.etat === "termine") return appliquerRepere(t, "termine", { avancementActuel, suivi });
    const code = repereAttendu(a.avancement, avancementActuel);
    if (code) return appliquerRepere(t, code, { avancementActuel, suivi });
    // Déjà au-delà de « presque fini » sans finir ce soir : en cours, avancement inchangé.
    const enCours = suivi ? appliquerChoixSuivi(t, "en_cours", suivi) : appliquerChoix(t, "en_cours", { avancementActuel });
    return suivi ? enCours : { ...enCours, avancement: String(Math.round(num(avancementActuel))) };
  });
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

// ── « Pas comme prévu » : tâches prévues non choisies ───────────────────────
// choisies : indices des lignes que l'ouvrier a retenues (détail).
export function prevuesNonChoisies(taches, choisies = []) {
  const set = new Set(choisies);
  return (taches || []).map((t, idx) => ({ t, idx })).filter(({ t, idx }) => estLignePrevue(t) && !set.has(idx));
}
// Une seule réponse pour toutes (ou tâche par tâche) : Pas commencé + motif.
export function appliquerNonFaite(t, motif, { avancementActuel = null } = {}) {
  return { ...appliquerChoix(t, "pas_commence", { avancementActuel }), motif: motif || null };
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
