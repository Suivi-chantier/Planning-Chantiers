// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — DICTÉE et PRÉREMPLISSAGE PAR L'IA (CR-4 du projet).
//
// Module PUR (aucun accès Supabase, aucune horloge, aucun appel réseau).
// Façade : dicteeCrV1.js. Utilisé par l'écran ouvrier (RapportMobile) ET par
// la tâche IA serveur api/_ia/taches/cr_dictee.js (même validation des deux
// côtés : la sortie du modèle n'est jamais appliquée sans être passée ici).
//
// PRINCIPES
// - L'ouvrier raconte sa journée (micro du navigateur, ou dictée du clavier
//   dans le champ texte). Le texte d'origine est TOUJOURS conservé tel quel
//   (colonne rapports.dictee), à côté de la remarque reformulée.
// - L'IA PROPOSE ; l'ouvrier voit un résumé, corrige, et c'est lui qui envoie.
// - Le texte de l'ouvrier est une DONNÉE, jamais une instruction : il est
//   transmis dans un champ JSON, et la sortie est validée strictement — seules
//   des tâches de la liste fournie, des états connus et des durées plausibles
//   passent. Une sortie invalide = rien n'est prérempli.
// - Rien n'est prérempli sans certitude : une proposition « incertaine », ou
//   une réponse marquée ambiguë, reste une simple suggestion à toucher.
// - Les lignes produites sont celles du parcours CR-3 (appliquerRepere,
//   changerMinutes, ligneDepuisPhasage) : la chaîne existante (validation,
//   pointages, bilan) les lit sans changement de sens.
// ─────────────────────────────────────────────────────────────────────────────
import { REPERES, appliquerRepere } from "./compteRenduV3.mjs";
import { changerMinutes, ligneDepuisPhasage, suiviDepuisInfo, PAS_MINUTES } from "./compteRenduV2.mjs";

export const TACHE_IA_DICTEE = "cr_dictee";
export const TEXTE_MAX = 2000;
export const TEXTE_MIN = 8;
export const CANDIDATES_MAX = 150;
export const PROPOSITIONS_MAX = 20;
export const MATERIEL_MAX = 8;
export const REMARQUE_MAX = 600;
export const ETATS_DICTEE = Object.freeze(REPERES.map(r => r.code)); // commence | moitie | presque_fini | termine

const net = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const court = (v, max) => net(v).slice(0, max);

// ── Entrée envoyée à l'IA ───────────────────────────────────────────────────
// chantiers : [{ id, nom, taches: [{ id, nom, ouvrage, piece, avancement, prevue }] }]
//   (tâches du phasage déjà chargées sur le téléphone ; les terminées ne sont
//   gardées que si elles étaient prévues aujourd'hui).
// minutesJournee : minutes de travail sur les tâches (cible − trajets − indirectes).
// → { texte, minutes_journee, chantiers } — tailles plafonnées, prévues d'abord.
export function preparerEntreeDictee({ texte, chantiers = [], minutesJournee = 0 } = {}) {
  let reste = CANDIDATES_MAX;
  const out = [];
  for (const ch of chantiers || []) {
    if (!net(ch?.id) || reste <= 0) continue;
    const taches = (ch.taches || [])
      .filter(t => net(t?.id) && (t.prevue || num(t.avancement) < 100))
      .sort((a, b) => (b.prevue ? 1 : 0) - (a.prevue ? 1 : 0))
      .slice(0, reste)
      .map(t => ({
        id: String(t.id), nom: court(t.nom, 120), ouvrage: court(t.ouvrage, 120) || null,
        piece: court(t.piece, 60) || null, avancement: Math.round(Math.max(0, Math.min(100, num(t.avancement)))),
        prevue: !!t.prevue,
      }));
    reste -= taches.length;
    out.push({ id: String(ch.id), nom: court(ch.nom, 120), taches });
  }
  return {
    texte: String(texte ?? "").trim().slice(0, TEXTE_MAX),
    minutes_journee: Math.max(0, Math.round(num(minutesJournee))),
    chantiers: out,
  };
}

// Contrôle de l'entrée (serveur ET écran) : true ou [erreurs].
export function verifierEntreeDictee(e) {
  const err = [];
  if (!e || typeof e !== "object") return ["Entrée manquante"];
  if (typeof e.texte !== "string" || e.texte.trim().length < TEXTE_MIN) err.push("Texte trop court");
  if (typeof e.texte === "string" && e.texte.length > TEXTE_MAX) err.push("Texte trop long");
  if (!Number.isInteger(e.minutes_journee) || e.minutes_journee < 0 || e.minutes_journee > 16 * 60) err.push("Durée de journée invalide");
  if (!Array.isArray(e.chantiers) || e.chantiers.length > 6) err.push("De 0 à 6 chantiers");
  else {
    let n = 0;
    for (const c of e.chantiers) {
      if (!c || typeof c.id !== "string" || !Array.isArray(c.taches)) { err.push("Chantier invalide"); break; }
      n += c.taches.length;
      if (c.taches.some(t => !t || typeof t.id !== "string" || typeof t.nom !== "string")) { err.push("Tâche invalide"); break; }
    }
    if (n > CANDIDATES_MAX) err.push("Trop de tâches");
  }
  return err.length ? err : true;
}

// ── Sortie du modèle ────────────────────────────────────────────────────────
// Attendu :
// { ambigu: bool,
//   taches: [{ tache_id, etat, minutes|null, certitude: "sure"|"incertaine", extrait }],
//   remarque: "…",                         (reformulée, français correct)
//   materiel: [{ texte, recherche }] }     (demandes de matériel détectées)
// → true ou [erreurs]. Toute erreur = la sortie entière est refusée.
export function validerSortieDictee(s, entree) {
  const err = [];
  if (!s || typeof s !== "object" || Array.isArray(s)) return ["Réponse non structurée"];
  if (typeof s.ambigu !== "boolean") err.push("ambigu manquant");
  const ids = new Set((entree?.chantiers || []).flatMap(c => (c.taches || []).map(t => String(t.id))));
  if (!Array.isArray(s.taches) || s.taches.length > PROPOSITIONS_MAX) err.push("Liste de tâches invalide");
  else {
    const vus = new Set();
    let totalSures = 0;
    for (const p of s.taches) {
      if (!p || typeof p !== "object") { err.push("Proposition invalide"); continue; }
      const id = String(p.tache_id ?? "");
      if (!ids.has(id)) err.push(`Tâche inconnue : ${id.slice(0, 40)}`);
      if (vus.has(id)) err.push(`Tâche en double : ${id.slice(0, 40)}`);
      vus.add(id);
      if (!ETATS_DICTEE.includes(p.etat)) err.push(`État inconnu : ${String(p.etat).slice(0, 20)}`);
      if (!["sure", "incertaine"].includes(p.certitude)) err.push("Certitude manquante");
      if (p.minutes != null) {
        if (!Number.isInteger(p.minutes) || p.minutes <= 0 || p.minutes % PAS_MINUTES !== 0) err.push("Durée invalide (minutes, par quart d'heure)");
        else if (p.certitude === "sure") totalSures += p.minutes;
      }
      if (p.extrait != null && (typeof p.extrait !== "string" || p.extrait.length > 200)) err.push("Extrait invalide");
    }
    const max = Number.isInteger(entree?.minutes_journee) ? entree.minutes_journee : 0;
    if (max > 0 && totalSures > max) err.push("Les durées dépassent la journée");
  }
  if (typeof s.remarque !== "string" || s.remarque.length > REMARQUE_MAX) err.push("Remarque invalide");
  if (!Array.isArray(s.materiel) || s.materiel.length > MATERIEL_MAX) err.push("Liste de matériel invalide");
  else if (s.materiel.some(m => !m || typeof m.texte !== "string" || !m.texte.trim() || m.texte.length > 120
    || typeof m.recherche !== "string" || m.recherche.length > 60)) err.push("Demande de matériel invalide");
  return err.length ? err : true;
}

// Propositions à PRÉREMPLIR : seulement les sûres, et rien si la réponse est
// ambiguë. Les autres restent des suggestions.
export function propositionsCertaines(sortie) {
  if (!sortie || sortie.ambigu) return [];
  return (sortie.taches || []).filter(p => p.certitude === "sure");
}
export function suggestionsIncertaines(sortie) {
  if (!sortie) return [];
  return (sortie.taches || []).filter(p => sortie.ambigu || p.certitude !== "sure");
}

// ── Application aux lignes du compte rendu ──────────────────────────────────
// taches : lignes actuelles ; propositions : propositionsCertaines(sortie) ou
// une suggestion touchée par l'ouvrier ; candidats : Map(tache_id → { tache,
// chantier }) (tâche du phasage + chantier { id, nom, couleur }) ;
// infosParTache : avancement / suivi en quantité (ouvrier_mes_phases).
// → { taches, indices: [idx des lignes touchées], ignorees: [tache_id] }
// Une tâche déjà au-delà du repère proposé n'est pas reculée (appliquerRepere
// refuse un repère sous l'avancement actuel) : elle est comptée ignorée.
export function appliquerPropositions(taches, propositions, { candidats = new Map(), infosParTache = {} } = {}) {
  let arr = [...(taches || [])];
  const indices = [];
  const ignorees = [];
  for (const p of propositions || []) {
    const id = String(p.tache_id);
    let idx = arr.findIndex(t => String(t.tache_id ?? "") === id);
    if (idx < 0) {
      const c = candidats.get(id);
      if (!c) { ignorees.push(id); continue; }
      arr = [...arr, ligneDepuisPhasage(c.tache, c.chantier)];
      idx = arr.length - 1;
    }
    const info = infosParTache[id] || null;
    const avancementActuel = info?.avancement ?? candidats.get(id)?.tache?.avancement ?? null;
    let t = appliquerRepere(arr[idx], p.etat, { avancementActuel, suivi: suiviDepuisInfo(info) });
    if (t === arr[idx]) { ignorees.push(id); continue; }
    if (Number.isInteger(p.minutes) && p.minutes > 0) t = changerMinutes(t, p.minutes);
    arr = arr.map((x, i) => (i === idx ? t : x));
    indices.push(idx);
  }
  return { taches: arr, indices, ignorees };
}

// ── Ce qui part dans rapports.dictee ────────────────────────────────────────
// null quand rien n'a été raconté. Le texte d'origine n'est jamais modifié.
export function dicteeAEnvoyer({ texteOrigine, source = "clavier", remarqueReformulee = null, relue = false, prerempli = 0 } = {}) {
  const texte = String(texteOrigine ?? "").trim();
  if (!texte) return null;
  return {
    texte_origine: texte.slice(0, TEXTE_MAX),
    source: source === "micro" ? "micro" : "clavier",
    remarque_reformulee: net(remarqueReformulee) ? String(remarqueReformulee).trim().slice(0, REMARQUE_MAX) : null,
    relue: !!relue,
    prerempli: Math.max(0, Math.round(num(prerempli))),
  };
}

// Remarque à afficher à la validation : la remarque envoyée, sinon la
// reformulation (non relue par l'ouvrier si analysée à l'envoi), sinon le
// texte d'origine. Toujours avec l'origine accessible à côté.
//   → { texte, libelle, origine } ou null
export function remarqueAffichee(rapport) {
  const d = rapport?.dictee && typeof rapport.dictee === "object" ? rapport.dictee : null;
  const remarque = net(rapport?.remarque);
  const origine = d ? net(d.texte_origine) || null : null;
  if (remarque) return { texte: remarque, libelle: "Remarque générale", origine: origine && origine !== remarque ? origine : null };
  if (d && net(d.remarque_reformulee)) {
    return { texte: net(d.remarque_reformulee), libelle: d.relue ? "Remarque reformulée" : "Remarque reformulée par l'IA (non relue par l'ouvrier)", origine };
  }
  if (origine) return { texte: origine, libelle: "Texte dicté", origine: null };
  return null;
}

// ── Reconnaissance vocale du navigateur ─────────────────────────────────────
// Concatène un morceau reconnu au texte existant (espace, majuscule de début).
export function ajouterTranscription(texte, morceau) {
  const m = net(morceau);
  if (!m) return String(texte ?? "");
  const base = String(texte ?? "").replace(/\s+$/, "");
  const majuscule = m.charAt(0).toUpperCase() + m.slice(1);
  if (!base) return majuscule;
  return `${base} ${/[.!?]$/.test(base) ? majuscule : m}`;
}

// Résumé lisible d'une proposition (écran ouvrier).
export function libelleProposition(p, candidats = new Map()) {
  const c = candidats.get(String(p?.tache_id));
  const nom = c ? net(c.tache?.nomAffiche || c.tache?.nom) || "Tâche" : "Tâche";
  const etat = REPERES.find(r => r.code === p?.etat)?.label || "";
  const min = Number.isInteger(p?.minutes) && p.minutes > 0 ? p.minutes : null;
  const duree = min == null ? "" : ` · ${Math.floor(min / 60) ? `${Math.floor(min / 60)} h` : ""}${min % 60 ? `${Math.floor(min / 60) ? " " : ""}${min % 60} min` : ""}`;
  return `${nom} → ${etat}${duree}`;
}
