// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu du soir — RÈGLES du formulaire bêta « cr_v2 ».
//
// Module PUR (aucun accès Supabase, aucune horloge : l'heure de première saisie
// arrive en paramètre). Façade : compteRenduV2.js.
//
// PRINCIPE : le formulaire v2 écrit des lignes que la chaîne existante
// (Validation, pointages, bilan, heures salariés) lit SANS CHANGEMENT. Aucune
// nouvelle valeur de statut ; on AJOUTE des champs, on n'en renomme aucun.
//
//   Choix de l'ouvrier   statut       heures        avancement          bloque
//   Terminé              faite        > 0           100 (auto)          —
//   En cours             en_cours     > 0           25/50/75/libre      —
//   Pas commencé         non_faite    0             celui du phasage    —
//   Bloqué, 0 h          non_faite    0             choisi (prérempli)  true
//   Bloqué, avec heures  en_cours     > 0           choisi (prérempli)  true
//
// « Pas commencé » garde l'avancement du phasage (l'ancien formulaire envoyait
// 0, que la Validation proposait ensuite d'appliquer). Sans tâche du phasage
// ou sans données, on retombe sur 0, comme avant.
//
// Champs AJOUTÉS à une ligne (tous facultatifs) :
//   bloque             true si « Bloqué »
//   motif              code de MOTIFS_STATUT (Bloqué / Pas commencé)
//   motif_depassement  code de MOTIFS_DEPASSEMENT
//   heures_prevues     durée prévue au planning pour cette personne (mesure)
//   depassement        { tache_id, heures_vendues, heures_avant, heures_jour }
//                      relevé figé à la saisie — la Validation ne l'affiche
//                      que tant que la ligne n'a été ni réaffectée ni découpée.
// La « précision » est écrite dans le champ remarque existant.
// ─────────────────────────────────────────────────────────────────────────────
import { etatHeures } from "./mesPhasesV1.mjs";
import { CODE_MOTIF_AUTRE, explicationLigne } from "./motifsCompteRendu.mjs";
import { serialiserLigneV1, totalJournee } from "./compteRenduEnvoi.mjs";

export const FORMULAIRE_V2 = "v2";
export const CODE_BETA_CR_V2 = "cr_v2";
export const PAS_MINUTES = 15;

export const CHOIX = Object.freeze({
  pas_commence: "Pas commencé",
  en_cours:     "En cours",
  termine:      "Terminé",
  bloque:       "Bloqué",
});

const vide = (v) => v === undefined || v === null || String(v).trim() === "";
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// ── Minutes ↔ heures ────────────────────────────────────────────────────────
// L'écran compte en minutes ; la ligne garde heures_reelles en heures
// décimales (comme l'ancien formulaire), écrites depuis des minutes entières.
export const minutesDe = (t) => Math.round(num(t?.heures_reelles) * 60);
export const heuresDepuisMinutes = (min) => (min > 0 ? String(min / 60) : "");

// ── Choix affiché, déduit des champs stockés ────────────────────────────────
export function choixDeLigne(t) {
  if (t?.bloque) return "bloque";
  if (t?.statut === "faite") return "termine";
  if (t?.statut === "en_cours") return "en_cours";
  if (t?.statut === "non_faite") return "pas_commence";
  return null;
}

// Statut stocké d'une ligne « Bloqué » : en cours si des heures, sinon non faite.
const statutBloque = (minutes) => (minutes > 0 ? "en_cours" : "non_faite");

// Applique un choix à une ligne. avancementActuel = avancement du phasage
// (null si inconnu).
export function appliquerChoix(t, choix, { avancementActuel = null } = {}) {
  const min = minutesDe(t);
  const avPhasage = avancementActuel != null ? String(Math.round(num(avancementActuel))) : null;
  const sansMotif = { motif: null };
  switch (choix) {
    case "termine":
      return { ...t, ...sansMotif, bloque: false, statut: "faite", avancement: "100" };
    case "en_cours":
      return {
        ...t, ...sansMotif, bloque: false, statut: "en_cours",
        // En venant de Terminé (100) ou de Pas commencé, on force un vrai choix.
        avancement: t.statut === "faite" || (t.statut === "non_faite" && !t.bloque) ? "" : (t.avancement ?? ""),
      };
    case "pas_commence":
      return {
        ...t, bloque: false, statut: "non_faite", heures_reelles: "",
        motif: t.bloque || t.statut === "non_faite" ? t.motif ?? null : null,
        avancement: avPhasage ?? "0",
      };
    case "bloque":
      return {
        ...t, bloque: true, statut: statutBloque(min),
        motif: t.statut === "non_faite" || t.bloque ? t.motif ?? null : null,
        avancement: !vide(t.avancement) && t.statut !== "faite" ? t.avancement : (avPhasage ?? "0"),
      };
    default:
      return t;
  }
}

// Change le temps passé (en minutes). « Pas commencé » n'a pas d'heures : y
// ajouter du temps le fait passer en « En cours ». « Bloqué » suit les heures.
export function changerMinutes(t, minutes) {
  const min = Math.max(0, Math.round(minutes));
  let next = { ...t, heures_reelles: heuresDepuisMinutes(min) };
  if (t.bloque) next.statut = statutBloque(min);
  else if (t.statut === "non_faite" && min > 0) next = { ...next, statut: "en_cours", motif: null, avancement: "" };
  return next;
}

// ── Total, reste, ajustement au quart d'heure ──────────────────────────────
// Le reste se calcule en minutes entières. Les trajets se saisissent à la
// minute près : le reste peut donc ne pas être un multiple de 15 min. Quand
// il est inférieur à 15 min (en plus ou en moins), chaque carte propose de
// le poser d'un coup : l'ouvrier peut TOUJOURS atteindre la cible.
export function resteJournee({ taches, trajetMatin, trajetSoir, heuresIndirectes, cibleHeures }) {
  const tot = totalJournee({ taches, trajetMatin, trajetSoir, heuresIndirectes });
  const resteMin = Math.round((num(cibleHeures) - tot.totalH) * 60);
  return { ...tot, resteMin, exact: resteMin === 0 };
}
export const ajustementPossible = (resteMin) => resteMin !== 0 && Math.abs(resteMin) < PAS_MINUTES;

// Pose le reste (positif ou négatif) sur une ligne.
export function poserReste(t, resteMin) {
  return changerMinutes(t, minutesDe(t) + resteMin);
}

// ── Dépassement (avec les heures du jour) ───────────────────────────────────
// info : la tâche telle que la renvoie ouvrier_mes_phases (heures_vendues,
// heures_validees, heures_en_attente, hors_devis, avancement…), ou null.
// Réutilise etatHeures de l'onglet Phases — aucun nouveau calcul, aucun seuil.
export function etatAvecAujourdhui(info, t) {
  if (!info || info.hors_devis || num(info.heures_vendues) <= 0) return null;
  const aujourdhui = minutesDe(t) / 60;
  const avancement = vide(t.avancement) ? num(info.avancement) : num(t.avancement);
  return {
    vendues: num(info.heures_vendues),
    avant: num(info.heures_validees) + num(info.heures_en_attente),
    aujourdhui,
    etat: etatHeures({
      vendues: info.heures_vendues, validees: info.heures_validees,
      attente: num(info.heures_en_attente) + aujourdhui, avancement,
    }),
  };
}

// Motif de dépassement requis : la tâche a des heures vendues, reçoit des
// heures aujourd'hui, et validées + en attente + aujourd'hui > vendues.
export function motifDepassementRequis(info, t) {
  const e = etatAvecAujourdhui(info, t);
  return !!e && e.aujourdhui > 0 && e.avant + e.aujourdhui > e.vendues + 1e-9;
}

// Relevé figé à la saisie, écrit sur la ligne avec le motif.
export function releveDepassement(info, t) {
  const e = etatAvecAujourdhui(info, t);
  if (!e) return null;
  return {
    tache_id: t.tache_id || null,
    heures_vendues: e.vendues,
    heures_avant: Math.round(e.avant * 100) / 100,
    heures_jour: Math.round(e.aujourdhui * 10000) / 10000,
  };
}

// ── Contrôle d'une ligne et de la journée ───────────────────────────────────
// infosParTache : { [tache_id]: info } (peut être vide si les données n'ont
// pas pu être chargées : on ne demande alors pas de motif de dépassement).
export function problemesLigne(t, infosParTache = {}) {
  const p = [];
  const choix = choixDeLigne(t);
  const min = minutesDe(t);
  if (t.libre && !t.chantier_id) p.push("chantier");
  if (!String(t.planifie ?? "").trim()) p.push("intitule");
  if (!choix) { p.push("statut"); return p; }
  if ((choix === "termine" || choix === "en_cours") && min <= 0) p.push("temps");
  if ((choix === "en_cours" || choix === "bloque") && vide(t.avancement)) p.push("avancement");
  if ((choix === "pas_commence" || choix === "bloque") && !t.motif) p.push("motif");
  const info = t.tache_id ? infosParTache[String(t.tache_id)] : null;
  if (motifDepassementRequis(info, t) && !t.motif_depassement) p.push("motif_depassement");
  const autre = t.motif === CODE_MOTIF_AUTRE
    || (t.motif_depassement === CODE_MOTIF_AUTRE && motifDepassementRequis(info, t));
  if (autre && !String(t.remarque ?? "").trim()) p.push("precision");
  return p;
}

export const LIBELLES_PROBLEMES = Object.freeze({
  chantier: "choisis le chantier",
  intitule: "décris la tâche",
  statut: "choisis un statut",
  temps: "indique le temps passé",
  avancement: "indique l'avancement",
  motif: "choisis un motif",
  motif_depassement: "dis pourquoi les heures vendues sont dépassées",
  precision: "précise le motif « Autre »",
});

// État du bouton d'envoi : on n'envoie que si toutes les lignes sont complètes
// ET que le total tombe exactement sur la cible.
export function etatEnvoi({ taches, trajetMatin, trajetSoir, heuresIndirectes, cibleHeures, infosParTache = {}, indirectesInvalides = 0 }) {
  const r = resteJournee({ taches, trajetMatin, trajetSoir, heuresIndirectes, cibleHeures });
  const remplies = (taches || []).filter(t => String(t.planifie ?? "").trim() || t.libre);
  const lignes = remplies.map((t, i) => ({ i, problemes: problemesLigne(t, infosParTache) }))
    .filter(x => x.problemes.length > 0);
  const phrase = r.resteMin > 0 ? `Place encore ${fmtMinutes(r.resteMin)} pour envoyer`
    : r.resteMin < 0 ? `Tu dépasses de ${fmtMinutes(-r.resteMin)}`
    : lignes.length > 0 ? `Complète ${lignes.length} tâche${lignes.length > 1 ? "s" : ""} pour envoyer`
    : indirectesInvalides > 0 ? "Complète tes heures indirectes pour envoyer"
    : null;
  return { ...r, lignesIncompletes: lignes, peutEnvoyer: r.exact && lignes.length === 0 && indirectesInvalides === 0, phrase };
}

// « 8 h 20 », « 45 min », « 2 h »
export function fmtMinutes(min) {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

// ── Juste avant l'envoi ─────────────────────────────────────────────────────
// Fige le relevé de dépassement sur les lignes qui en ont besoin, et retire un
// motif de dépassement devenu sans objet (heures réduites depuis, tâche hors
// devis, données indisponibles) : on n'envoie jamais un motif qui ne
// correspond à rien. Le motif de statut ne s'envoie que pour Bloqué / Pas commencé.
export function finaliserLignesV2(taches, infosParTache = {}) {
  return (taches || []).map(t => {
    const info = t.tache_id ? infosParTache[String(t.tache_id)] : null;
    const requis = motifDepassementRequis(info, t);
    const choix = choixDeLigne(t);
    const next = { ...t };
    if (!(choix === "bloque" || choix === "pas_commence")) next.motif = null;
    if (requis && t.motif_depassement) next.depassement = releveDepassement(info, t);
    else { next.motif_depassement = null; next.depassement = null; }
    return next;
  });
}

// ── Écriture d'une ligne v2 ─────────────────────────────────────────────────
// La base v1 (mêmes champs, mêmes conversions), puis les champs ajoutés.
export function serialiserLigneV2(t) {
  const base = serialiserLigneV1(t);
  const out = { ...base };
  if (t.bloque) out.bloque = true;
  if (t.motif) out.motif = t.motif;
  if (t.motif_depassement) out.motif_depassement = t.motif_depassement;
  if (t.heures_prevues != null && t.heures_prevues !== "") out.heures_prevues = num(t.heures_prevues);
  if (t.motif_depassement && t.depassement) out.depassement = t.depassement;
  return out;
}

// ── Brouillons (case décochée / cochée en cours de journée) ────────────────
// Un brouillon v2 relu par l'ANCIEN formulaire : le motif devient du texte
// dans la remarque (« Attente de matériel — précision »), rien n'est perdu ;
// les champs propres au v2 sont retirés, l'ancien formulaire ne les connaît pas.
export function brouillonV2VersV1(taches) {
  return (taches || []).map(t => {
    const { bloque, motif, motif_depassement, depassement, ...reste } = t;
    const remarque = explicationLigne(t);
    return motif ? { ...reste, remarque } : { ...reste };
  });
}
// Un brouillon de l'ancien formulaire relu par le v2 : la remarque devient la
// précision, le statut devient le choix ; un motif manquant sera demandé.
export const brouillonV1VersV2 = (taches) => (taches || []).map(t => ({ ...t }));

// Préremplissage du temps passé avec la durée prévue au planning (à la
// première ouverture de la journée seulement, jamais sur un brouillon).
export function preremplirDurees(taches) {
  return (taches || []).map(t => {
    const h = num(t.heures_prevues);
    return h > 0 && vide(t.heures_reelles) ? { ...t, heures_reelles: heuresDepuisMinutes(Math.round(h * 60)) } : t;
  });
}

// Colonnes ajoutées au rapport par le formulaire v2.
export function colonnesRapportV2(saisieDebutISO) {
  return { formulaire_version: FORMULAIRE_V2, saisie_debut_le: saisieDebutISO || null };
}
