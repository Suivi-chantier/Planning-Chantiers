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
//   origine            "phasage" : tâche choisie dans le phasage (« J'ai fait
//                      autre chose ») ; "libre" : tâche décrite en texte libre ;
//                      "nouvelle" : tâche absente du phasage, PROPOSÉE par
//                      l'ouvrier dans un ouvrage (créée à la validation).
//                      Absent sur les tâches venues du planning.
//   proposition        (origine "nouvelle") { ouvrage_id, ouvrage_libelle,
//                      nature, demandeur? } — ouvrage_id null = « Divers /
//                      hors devis » (créé à la validation s'il n'existe pas).
//   quantite_jour      (tâche suivie en quantité, voir suiviQuantite.mjs)
//   unite              « posé aujourd'hui » et son unité (m², ml, m³, U).
//                      L'avancement reste rempli, calculé depuis le total
//                      (100 si Terminé) : toute la chaîne existante le lit.
//   photos_apres       photos « après » d'une tâche Terminée : sous-ensemble
//                      de `photos`, qui garde TOUTES les photos de la ligne.
//   photo_apres_manquante      Terminé sans photo « après » (la photo est
//                              RECOMMANDÉE, jamais exigée : décision du
//                              14/10/2026, l'ouvrier n'a plus de bouton à
//                              toucher pour chaque tâche sans photo) ;
//   photo_apres_hors_connexion   … et le téléphone était hors ligne ;
//   photo_apres_bouton           … ancien bouton « Je ne peux pas envoyer la
//                                photo » (06-14/10/2026) : relu sur les
//                                brouillons de cette période, plus proposé.
// La « précision » est écrite dans le champ remarque existant.
// ─────────────────────────────────────────────────────────────────────────────
import { etatHeures } from "./mesPhasesV1.mjs";
import {
  MODE_QUANTITE, etatSuivi, avancementQuantite, resteAPoser, quantiteValide, fmtQuantite, arrondi2,
} from "./suiviQuantite.mjs";
import { CODE_MOTIF_AUTRE, explicationLigne, NATURES_TACHE, libelleNature, precisionSuffisante } from "./motifsCompteRendu.mjs";
import { serialiserLigneV1, totalJournee } from "./compteRenduEnvoi.mjs";

export const FORMULAIRE_V2 = "v2";
export const ORIGINE_PHASAGE = "phasage";
export const ORIGINE_LIBRE = "libre";
export const ORIGINE_NOUVELLE = "nouvelle";
// Nature pour laquelle une photo est obligatoire (preuve de la demande).
export const NATURE_PHOTO_OBLIGATOIRE = "demande_client";
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

// ── Quantités posées (tâche suivie en quantité) ─────────────────────────────
// Suivi d'une tâche du jour, depuis les infos de la RPC ouvrier_mes_phases.
// null = suivi en pourcentage, OU infos indisponibles (hors connexion, RPC
// d'avant l'étape 4) : la carte retombe alors sur le pourcentage, rien ne
// bloque l'envoi.
export function suiviDepuisInfo(info) {
  if (!info || info.quantite_validee === undefined) return null;
  const s = etatSuivi(
    { quantite: info.quantite, suivi_pourcent: info.suivi_pourcent === true, hors_devis: info.hors_devis_marque === true,
      quantite_reprise: info.quantite_reprise, quantite_terminee: info.quantite_terminee, avancement: info.avancement },
    { unite: info.ouvrage_unite, quantite: info.ouvrage_quantite, libelle: info.ouvrage_libelle },
    { validee: info.quantite_validee, attente: info.quantite_en_attente },
  );
  return s.mode === MODE_QUANTITE ? s : null;
}
const suiviDeLigne = (t, infosParTache) => (t?.tache_id ? suiviDepuisInfo(infosParTache?.[String(t.tache_id)]) : null);

// Total de la tâche avec aujourd'hui : départ + validé + en attente + aujourd'hui.
export const totalAvecJour = (suivi, t) => arrondi2(suivi.cumul + suivi.attente + (vide(t?.quantite_jour) ? 0 : quantiteValide(t.quantite_jour)));

// La ligne attend-elle une quantité ? Terminé, En cours, Bloqué avec heures.
// (« Pas commencé » et « Bloqué à 0 h » : pas de quantité.)
export function quantiteAttendue(t) {
  const choix = choixDeLigne(t);
  return choix === "termine" || choix === "en_cours" || (choix === "bloque" && minutesDe(t) > 0);
}

// Avancement de la ligne : 100 si Terminé (ou tâche déjà marquée terminée),
// sinon calculé depuis le total ; vide tant que rien n'est saisi.
function avancementLigne(t, suivi) {
  if (t.statut === "faite" && !t.bloque) return "100";
  if (vide(t.quantite_jour)) return suivi.terminee ? "100" : "";
  return String(avancementQuantite({ cumul: totalAvecJour(suivi, t), quantite: suivi.quantite, terminee: suivi.terminee }));
}

// Saisie de « posé aujourd'hui » : chiffres et une virgule seulement (jamais
// négatif) ; le texte tapé est gardé tel quel (« 12, » en cours de frappe),
// converti en nombre à l'envoi. Vide = pas encore saisi.
export function changerQuantiteJour(t, valeur, suivi) {
  const q = String(valeur ?? "").replace(/[^0-9.,]/g, "").replace(/\./g, ",").replace(/,(?=.*,)/g, "");
  const next = { ...t, quantite_jour: q, unite: suivi.unite };
  return { ...next, avancement: avancementLigne(next, suivi) };
}

// Choix de statut sur une tâche en quantité : Terminé préremplit ce qui
// reste à poser (modifiable) ; Pas commencé / Bloqué à 0 h effacent la
// quantité ; En cours demande une quantité (avancement calculé).
export function appliquerChoixSuivi(t, choix, suivi) {
  let next = appliquerChoix(t, choix, { avancementActuel: suivi.avancement });
  if (!quantiteAttendue(next)) {
    const { quantite_jour, unite, ...reste } = next;
    return reste;
  }
  if (choix === "termine" && vide(next.quantite_jour)) {
    next = { ...next, quantite_jour: String(resteAPoser(suivi.quantite, suivi.cumul + suivi.attente)) };
  }
  next = { ...next, unite: suivi.unite };
  return { ...next, avancement: avancementLigne(next, suivi) };
}

// Après un changement de temps : « Bloqué » qui retombe à 0 h perd sa quantité.
export function apresMinutesSuivi(t, suivi) {
  if (quantiteAttendue(t)) return vide(t.quantite_jour) ? t : { ...t, avancement: avancementLigne(t, suivi) };
  const { quantite_jour, unite, ...reste } = t;
  return reste;
}

// ── Photos « après » ────────────────────────────────────────────────────────
// `photos` garde TOUTES les photos de la ligne (rien ne change pour ceux qui
// les lisent) ; `photos_apres` en désigne une partie.
const liste = (v) => (Array.isArray(v) ? v : []);
export const photosApres = (t) => liste(t?.photos_apres).filter(p => liste(t?.photos).includes(p));
export const photosAutres = (t) => liste(t?.photos).filter(p => !liste(t?.photos_apres).includes(p));
// Le sélecteur « Photos de la tâche » ne montre que les autres photos.
export function majPhotosAutres(t, autres) {
  const apres = photosApres(t);
  return { ...t, photos: [...liste(autres), ...apres.filter(p => !liste(autres).includes(p))], photos_apres: apres };
}
// Le sélecteur « Photo après » : ajoutées aussi à `photos`, retirées des deux.
export function majPhotosApres(t, apres) {
  const nouvelles = liste(apres);
  const autres = photosAutres(t);
  const next = { ...t, photos: [...autres, ...nouvelles.filter(p => !autres.includes(p))], photos_apres: nouvelles };
  if (nouvelles.length > 0) { delete next.photo_apres_bouton; delete next.photo_apres_manquante; delete next.photo_apres_hors_connexion; }
  return next;
}
// Ancien bouton « Je ne peux pas envoyer la photo » (plus proposé depuis le
// 14/10/2026) : gardé pour relire les brouillons de la période.
export const signalerPhotoImpossible = (t, oui = true) => {
  const next = { ...t };
  if (oui) next.photo_apres_bouton = true; else delete next.photo_apres_bouton;
  return next;
};
// Terminé sans photo « après » ? Repère seulement (la carte la recommande, la
// ligne part marquée photo_apres_manquante) : n'empêche JAMAIS l'envoi.
export function photoApresManquante(t) {
  return choixDeLigne(t) === "termine" && photosApres(t).length === 0;
}

// ── Contrôle d'une ligne et de la journée ───────────────────────────────────
// infosParTache : { [tache_id]: info } (peut être vide si les données n'ont
// pas pu être chargées : on ne demande alors pas de motif de dépassement, et
// la tâche se saisit en pourcentage).
// La photo « après » n'est PAS un problème : recommandée, jamais exigée.
//
// parcours (parcours unique du compte rendu, CR-6) : deux règles changent,
// tout le reste est identique au formulaire v2 —
//   - « Pas commencé » ne demande AUCUN motif (seul « Bloqué » en demande) ;
//   - une tâche PRÉVUE (venue du planning) sans heures et sans état n'est pas
//     un problème : elle part comme « pas commencé » (finaliserParcours,
//     compteRenduV3.mjs). Avec des heures, l'état reste obligatoire (« etat »).
// Sans `parcours`, le formulaire v2 garde exactement ses règles d'avant.
const lignePrevue = (t) => !!t && !t.origine && !t.libre;
export function problemesLigne(t, infosParTache = {}, { parcours = false } = {}) {
  const p = [];
  const choix = choixDeLigne(t);
  const min = minutesDe(t);
  const suivi = suiviDeLigne(t, infosParTache);
  if (t.libre && !t.chantier_id) p.push("chantier");
  if (!String(t.planifie ?? "").trim()) p.push("intitule");
  if (!choix) {
    if (parcours && lignePrevue(t) && min <= 0) return p;
    p.push(parcours ? "etat" : "statut"); return p;
  }
  if ((choix === "termine" || choix === "en_cours") && min <= 0) p.push("temps");
  if (suivi) {
    if (quantiteAttendue(t) && vide(t.quantite_jour)) p.push("quantite");
  } else if ((choix === "en_cours" || choix === "bloque") && vide(t.avancement)) p.push("avancement");
  if ((choix === "bloque" || (choix === "pas_commence" && !parcours)) && !t.motif) p.push("motif");
  const info = t.tache_id ? infosParTache[String(t.tache_id)] : null;
  if (motifDepassementRequis(info, t) && !t.motif_depassement) p.push("motif_depassement");
  const autre = t.motif === CODE_MOTIF_AUTRE
    || (t.motif_depassement === CODE_MOTIF_AUTRE && motifDepassementRequis(info, t));
  if (autre && !precisionSuffisante(t.remarque)) p.push("precision");
  if (photoManquante(t)) p.push("photo");
  return p;
}

// Nouvelle tâche « demandée par le client » sans aucune photo.
const photoManquante = (t) => t?.origine === ORIGINE_NOUVELLE
  && t.proposition?.nature === NATURE_PHOTO_OBLIGATOIRE
  && !(Array.isArray(t.photos) && t.photos.length > 0);

export const LIBELLES_PROBLEMES = Object.freeze({
  chantier: "choisis le chantier",
  intitule: "décris la tâche",
  statut: "choisis un statut",
  etat: "dis où elle en est (Pas commencé, Commencé, À moitié, Presque fini, Terminé ou Bloqué)",
  temps: "indique le temps passé",
  avancement: "indique l'avancement",
  motif: "choisis un motif",
  motif_depassement: "dis pourquoi les heures prévues sont dépassées",
  precision: "précise le motif « Autre » en quelques mots",
  photo: "ajoute une photo (demande du client)",
  quantite: "indique la quantité posée",
});

// État du bouton d'envoi : on n'envoie que si toutes les lignes sont complètes
// ET que le total tombe exactement sur la cible.
// parcours : règles du parcours unique (voir problemesLigne).
export function etatEnvoi({ taches, trajetMatin, trajetSoir, heuresIndirectes, cibleHeures, infosParTache = {}, indirectesInvalides = 0, horsConnexion = false, parcours = false }) {
  const r = resteJournee({ taches, trajetMatin, trajetSoir, heuresIndirectes, cibleHeures });
  const remplies = (taches || []).filter(t => String(t.planifie ?? "").trim() || t.libre);
  // idx : position de la ligne dans `taches` (pour y emmener l'ouvrier).
  const lignes = remplies.map((t, i) => ({ i, idx: taches.indexOf(t), problemes: problemesLigne(t, infosParTache, { parcours }) }))
    .filter(x => x.problemes.length > 0);
  const phrase = r.resteMin > 0 ? `Place encore ${fmtMinutes(r.resteMin)} pour envoyer`
    : r.resteMin < 0 ? `Tu dépasses de ${fmtMinutes(-r.resteMin)}`
    : lignes.length === 1 && parcours ? `Complète « ${String(taches[lignes[0].idx]?.planifie ?? "").trim() || "la tâche ajoutée"} » pour envoyer`
    : lignes.length > 0 ? `Complète ${lignes.length} tâche${lignes.length > 1 ? "s" : ""} pour envoyer`
    : indirectesInvalides > 0 ? "Complète tes heures indirectes pour envoyer"
    : null;
  return { ...r, lignesIncompletes: lignes, indirectesInvalides, peutEnvoyer: r.exact && lignes.length === 0 && indirectesInvalides === 0, phrase };
}

// Ce qui empêche l'envoi, en clair, pour le montrer à l'ouvrier : le temps
// à placer (ou en trop), chaque tâche incomplète avec ce qui lui manque, les
// heures indirectes incomplètes. Vide quand l'envoi est possible.
//   [{ type: "temps" | "ligne" | "indirectes", texte, idx?, nom? }]
export function resumeManques(envoi, taches) {
  if (!envoi || envoi.peutEnvoyer) return [];
  const out = [];
  if (envoi.resteMin > 0) {
    out.push({ type: "temps", texte: `place encore ${fmtMinutes(envoi.resteMin)} (temps des tâches, trajets ou heures indirectes)` });
  } else if (envoi.resteMin < 0) {
    out.push({ type: "temps", texte: `tu dépasses de ${fmtMinutes(-envoi.resteMin)} : retire du temps sur une tâche ou un trajet` });
  }
  (envoi.lignesIncompletes || []).forEach(l => {
    const t = (taches || [])[l.idx];
    out.push({
      type: "ligne", idx: l.idx,
      nom: String(t?.planifie ?? "").trim() || "Tâche ajoutée",
      texte: l.problemes.map(p => LIBELLES_PROBLEMES[p] || p).join(", "),
    });
  });
  if (envoi.indirectesInvalides > 0) {
    out.push({ type: "indirectes", texte: "complète tes heures indirectes (motif, chantier et heures)" });
  }
  return out;
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
// Quantité : retirée d'une ligne qui n'en attend pas (Pas commencé, Bloqué à
// 0 h). Photo « après » : un Terminé sans photo part marqué
// photo_apres_manquante, avec la raison (hors connexion ou bouton).
export function finaliserLignesV2(taches, infosParTache = {}, { horsConnexion = false } = {}) {
  return (taches || []).map(t => {
    const info = t.tache_id ? infosParTache[String(t.tache_id)] : null;
    const requis = motifDepassementRequis(info, t);
    const choix = choixDeLigne(t);
    const next = { ...t };
    if (!(choix === "bloque" || choix === "pas_commence")) next.motif = null;
    if (requis && t.motif_depassement) next.depassement = releveDepassement(info, t);
    else { next.motif_depassement = null; next.depassement = null; }
    if (!quantiteAttendue(t)) { delete next.quantite_jour; delete next.unite; }
    delete next.photo_apres_manquante; delete next.photo_apres_hors_connexion;
    if (choix === "termine" && photosApres(t).length === 0) {
      next.photo_apres_manquante = true;
      if (horsConnexion && !t.photo_apres_bouton) next.photo_apres_hors_connexion = true;
    } else delete next.photo_apres_bouton;
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
  // Tâche ajoutée par l'ouvrier : choisie dans le phasage, ou décrite en texte
  // libre (une carte libre sans origine, d'un brouillon plus ancien, compte
  // comme libre). Les tâches du planning ne portent pas ce champ.
  const origine = t.origine === ORIGINE_PHASAGE ? ORIGINE_PHASAGE
    : t.origine === ORIGINE_NOUVELLE && t.proposition ? ORIGINE_NOUVELLE
    : (t.libre || t.origine === ORIGINE_LIBRE ? ORIGINE_LIBRE : null);
  if (origine) out.origine = origine;
  // Nouvelle tâche proposée : tache_id et phase_id restent vides (comme une
  // ligne libre) ; la Validation crée la tâche puis rattache la ligne.
  if (origine === ORIGINE_NOUVELLE) out.proposition = propositionPropre(t.proposition);
  // Quantité posée (tâche suivie en quantité) : nombre >= 0 et son unité.
  if (!vide(t.quantite_jour) && t.unite) { out.quantite_jour = quantiteValide(t.quantite_jour); out.unite = t.unite; }
  // Photo « après » : sous-ensemble de photos, ou raison de son absence.
  const apres = photosApres(t);
  if (apres.length > 0) out.photos_apres = apres;
  if (t.photo_apres_manquante) out.photo_apres_manquante = true;
  if (t.photo_apres_hors_connexion) out.photo_apres_hors_connexion = true;
  if (t.photo_apres_bouton) out.photo_apres_bouton = true;
  return out;
}

const texte = (v) => String(v ?? "").trim();
function propositionPropre(p) {
  const out = {
    ouvrage_id: p?.ouvrage_id || null,
    ouvrage_libelle: texte(p?.ouvrage_libelle) || DIVERS_HORS_DEVIS,
    nature: p?.nature || null,
  };
  if (texte(p?.demandeur)) out.demandeur = texte(p.demandeur);
  return out;
}

// ── « Nouvelle tâche » : une tâche absente du phasage, proposée par l'ouvrier ─
// Libellé de l'ouvrage fourre-tout, tel que la Validation le crée depuis
// toujours (même comparaison : casse et espaces ignorés).
export const DIVERS_HORS_DEVIS = "Divers / hors devis";
export const estOuvrageDivers = (libelle) => texte(libelle).toLowerCase() === DIVERS_HORS_DEVIS.toLowerCase();

// Ouvrages du chantier proposés dans l'écran « Nouvelle tâche », depuis les
// phases de l'onglet Phases (construireMesPhases) : un ouvrage par id, avec
// son code et les noms des phases où il apparaît. « Divers / hors devis » en
// dernier ; s'il n'existe pas encore, une entrée sans id le représente (la
// Validation le créera, comme elle le fait déjà pour les tâches libres).
export function ouvragesProposables(phases) {
  const parId = new Map();
  (phases || []).forEach(p => (p.ouvrages || []).forEach(o => {
    if (!o?.id) return;
    const e = parId.get(o.id) || { id: o.id, libelle: texte(o.libelle) || "(sans nom)", code: texte(o.code) || null, phases: [] };
    if (p.nom && !p.synthetique && !e.phases.includes(p.nom)) e.phases.push(p.nom);
    parId.set(o.id, e);
  }));
  const tous = [...parId.values()].map(o => ({ ...o, divers: estOuvrageDivers(o.libelle) }));
  const divers = tous.filter(o => o.divers);
  return [
    ...tous.filter(o => !o.divers),
    ...(divers.length ? divers : [{ id: null, libelle: DIVERS_HORS_DEVIS, code: null, phases: [], divers: true }]),
  ];
}

const normRecherche = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
// Toutes les tâches du chantier (une par id), depuis les phases de l'onglet
// Phases — pour proposer une tâche EXISTANTE avant d'en créer une nouvelle.
export function tachesDuChantier(phases) {
  const vues = new Map();
  (phases || []).forEach(p => (p.ouvrages || []).forEach(o => (o.taches || []).forEach(t => {
    if (!t?.id || vues.has(String(t.id))) return;
    vues.set(String(t.id), {
      id: String(t.id), nom: texte(t.nom), tache: t,
      ouvrage_id: o.id || null, ouvrage_libelle: texte(o.libelle), phase_nom: p.synthetique ? null : (p.nom || null),
    });
  })));
  return [...vues.values()];
}

const MOTS_VIDES = new Set(["les", "des", "une", "pour", "avec", "dans", "sur", "aux", "par", "est"]);
const mots = (s) => normRecherche(s).split(/[^a-z0-9]+/).filter(m => m.length >= 3 && !MOTS_VIDES.has(m));
// Part des mots tapés qu'on retrouve dans le nom de la tâche (début de mot
// accepté : mêmes 4 premières lettres, « peindre » retrouve « peinture »).
function ressemblance(nom, cible) {
  const a = mots(nom);
  if (a.length === 0) return 0;
  const b = mots(cible);
  const proches = (m, x) => m === x || x.startsWith(m) || m.startsWith(x) || (m.length >= 4 && x.length >= 4 && m.slice(0, 4) === x.slice(0, 4));
  return a.filter(m => b.some(x => proches(m, x))).length / a.length;
}

// « C'est peut-être celle-ci ? » : d'abord les tâches au nom proche de ce que
// l'ouvrier tape (tout le chantier), puis celles de l'ouvrage choisi.
export function suggestionsNouvelleTache({ nom, ouvrageId = null, taches = [], max = 6 }) {
  const parNom = texte(nom).length >= 3
    ? (taches || []).map(t => ({ ...t, score: ressemblance(nom, t.nom) }))
        .filter(t => t.score > 0.5).sort((x, y) => y.score - x.score).slice(0, 3)
    : [];
  const deja = new Set(parNom.map(t => t.id));
  const dansOuvrage = ouvrageId ? (taches || []).filter(t => t.ouvrage_id === ouvrageId && !deja.has(t.id)) : [];
  return [...parNom.map(t => ({ ...t, raison: "nom" })), ...dansOuvrage.map(t => ({ ...t, raison: "ouvrage" }))].slice(0, max);
}

// Ménage, nettoyage, évacuation, approvisionnement : le plus souvent des
// heures indirectes, pas une tâche du chantier (simple suggestion).
const DEBUTS_INDIRECTS = ["menage", "nettoy", "aspira", "evacu", "dechet", "encombrant", "appro", "rangement", "ranger"];
export function ressembleIndirect(nom) {
  return normRecherche(nom).split(/[^a-z0-9]+/).some(m => DEBUTS_INDIRECTS.some(d => m.startsWith(d)));
}

// Recherche sur le libellé, le code et les phases (accents et casse ignorés).
export function rechercherOuvrages(liste, q) {
  const n = normRecherche(q);
  if (!n) return liste || [];
  return (liste || []).filter(o => normRecherche([o.libelle, o.code, ...(o.phases || [])].join(" ")).includes(n));
}

// Ce qui manque encore sur l'écran « Nouvelle tâche ».
//   saisie : { nom, ouvrage (entrée d'ouvragesProposables), nature, demandeur, photos }
export function problemesNouvelleTache(saisie) {
  const p = [];
  if (!saisie?.ouvrage) p.push("ouvrage");
  if (!texte(saisie?.nom)) p.push("nom");
  if (!NATURES_TACHE.some(n => n.code === saisie?.nature)) p.push("nature");
  else if (saisie.nature === NATURE_PHOTO_OBLIGATOIRE && !(Array.isArray(saisie.photos) && saisie.photos.length > 0)) p.push("photo");
  return p;
}
export const LIBELLES_NOUVELLE_TACHE = Object.freeze({
  ouvrage: "choisis l'ouvrage",
  nom: "dis ce que tu as fait",
  nature: "dis pourquoi cette tâche",
  photo: "ajoute au moins une photo",
});

// La carte de la journée : une carte v2 normale (temps, statut, avancement),
// sans tâche du phasage — donc sans jauge ni motif de dépassement.
export function ligneNouvelleTache(saisie, chantier) {
  const o = saisie?.ouvrage || null;
  return {
    chantier_id: chantier?.id || "",
    chantier_nom: chantier?.nom || chantier?.id || "",
    chantier_couleur: chantier?.couleur || "#c8d8f0",
    planifie: texte(saisie?.nom),
    tache_id: null,
    phase_id: null,
    statut: null,
    remarque: "",
    heures_reelles: "",
    avancement: "0",
    photos: Array.isArray(saisie?.photos) ? saisie.photos : [],
    origine: ORIGINE_NOUVELLE,
    proposition: propositionPropre({
      ouvrage_id: o?.id || null, ouvrage_libelle: o?.libelle, nature: saisie?.nature, demandeur: saisie?.demandeur,
    }),
  };
}

// « Modifier » depuis la carte : on garde temps, statut, avancement, précision.
export function modifierNouvelleTache(ligne, saisie) {
  const neuve = ligneNouvelleTache(saisie, { id: ligne.chantier_id, nom: ligne.chantier_nom, couleur: ligne.chantier_couleur });
  return { ...ligne, planifie: neuve.planifie, photos: neuve.photos, proposition: neuve.proposition };
}

// Saisie de l'écran reconstituée depuis une carte (pour « Modifier »).
export function saisieDepuisLigne(ligne, ouvrages) {
  const p = ligne?.proposition || {};
  const ouvrage = (ouvrages || []).find(o => (p.ouvrage_id ? o.id === p.ouvrage_id : o.divers && !o.id))
    || (p.ouvrage_id ? { id: p.ouvrage_id, libelle: p.ouvrage_libelle, code: null, phases: [], divers: false } : null);
  return { nom: ligne?.planifie || "", ouvrage, nature: p.nature || null, demandeur: p.demandeur || "", photos: ligne?.photos || [] };
}

// « Nouvelle tâche dans « Cuisine » — Demande du client (demandée par M. X) »
export function texteProposition(p) {
  if (!p) return "";
  const nature = libelleNature(p.nature);
  const qui = texte(p.demandeur) ? ` (demandée par ${texte(p.demandeur)})` : "";
  return `Nouvelle tâche dans « ${texte(p.ouvrage_libelle) || DIVERS_HORS_DEVIS} »${nature ? ` — ${nature}` : ""}${qui}`;
}

// ── « J'ai fait autre chose » : une tâche choisie dans le phasage ──────────
// Crée une carte IDENTIQUE à une tâche venue du planning : même tache_id,
// phase_id vide (les lignes du planning n'en portent pas : la phase chrono
// n'est pas la phase des rapports — la mettre changerait les pointages),
// 0 h, aucun statut, avancement prérempli depuis le phasage. Seul ajout :
// origine = "phasage".
export function ligneDepuisPhasage(tache, chantier) {
  return {
    chantier_id: chantier?.id || "",
    chantier_nom: chantier?.nom || chantier?.id || "",
    chantier_couleur: chantier?.couleur || "#c8d8f0",
    planifie: String(tache?.nom ?? "").trim() || "(sans nom)",
    tache_id: tache?.id || null,
    phase_id: null,
    statut: null,
    remarque: "",
    heures_reelles: "",
    avancement: String(Math.round(num(tache?.avancement))),
    photos: [],
    origine: ORIGINE_PHASAGE,
  };
}

// Une tâche du phasage est-elle déjà dans la journée (planifiée ou ajoutée) ?
export const tacheDejaDansJournee = (taches, tacheId) =>
  !!tacheId && (taches || []).some(t => String(t.tache_id ?? "") === String(tacheId));

// Ajoute la carte si la tâche n'y est pas déjà (jamais de doublon).
export function ajouterDepuisPhasage(taches, tache, chantier) {
  if (!tache?.id || tacheDejaDansJournee(taches, tache.id)) return taches;
  return [...(taches || []), ligneDepuisPhasage(tache, chantier)];
}

// Une carte ajoutée par l'ouvrier (phasage ou texte libre) peut être retirée
// avant l'envoi ; une tâche du planning, non.
export const carteRetirable = (t) => !!t?.libre || t?.origine === ORIGINE_PHASAGE || t?.origine === ORIGINE_NOUVELLE;

// ── Brouillons (case décochée / cochée en cours de journée) ────────────────
// Un brouillon v2 relu par l'ANCIEN formulaire : le motif devient du texte
// dans la remarque (« Attente de matériel — précision »), rien n'est perdu ;
// les champs propres au v2 sont retirés, l'ancien formulaire ne les connaît pas.
// Une carte ajoutée depuis le phasage devient, dans l'ancien formulaire, une
// tâche ajoutée (libre: true) : l'ouvrier peut encore la retirer, et elle
// garde son tache_id (la Validation la rattache à sa tâche).
// Une nouvelle tâche proposée devient une tâche libre ; l'ouvrage et la
// nature passent en tête de la remarque (« Nouvelle tâche dans « … » — … »).
// La quantité posée passe aussi en texte (« Posé : 12 m² ») ; l'avancement en
// % déjà calculé reste, et les photos « après » restent dans `photos`.
export function brouillonV2VersV1(taches) {
  return (taches || []).map(t => {
    const {
      bloque, motif, motif_depassement, depassement, origine, proposition,
      quantite_jour, unite, photos_apres, photo_apres_manquante, photo_apres_hors_connexion, photo_apres_bouton,
      ...reste
    } = t;
    const pose = !vide(quantite_jour) && unite ? `Posé : ${fmtQuantite(quantiteValide(quantite_jour))} ${unite}` : "";
    const avecPose = (rem) => [pose, rem].filter(Boolean).join(" — ");
    const remarque = explicationLigne(t);
    if (origine === ORIGINE_NOUVELLE) {
      return { ...reste, libre: true, remarque: avecPose([texteProposition(proposition), remarque].filter(Boolean).join(" — ")) };
    }
    const base = origine === ORIGINE_PHASAGE ? { ...reste, libre: true } : { ...reste };
    if (motif) return { ...base, remarque: avecPose(remarque) };
    return pose ? { ...base, remarque: avecPose(String(base.remarque ?? "").trim()) } : base;
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
