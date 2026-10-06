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
// La « précision » est écrite dans le champ remarque existant.
// ─────────────────────────────────────────────────────────────────────────────
import { etatHeures } from "./mesPhasesV1.mjs";
import { CODE_MOTIF_AUTRE, explicationLigne, NATURES_TACHE, libelleNature } from "./motifsCompteRendu.mjs";
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
  temps: "indique le temps passé",
  avancement: "indique l'avancement",
  motif: "choisis un motif",
  motif_depassement: "dis pourquoi les heures vendues sont dépassées",
  precision: "précise le motif « Autre »",
  photo: "ajoute une photo (demande du client)",
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
export function brouillonV2VersV1(taches) {
  return (taches || []).map(t => {
    const { bloque, motif, motif_depassement, depassement, origine, proposition, ...reste } = t;
    const remarque = explicationLigne(t);
    if (origine === ORIGINE_NOUVELLE) {
      return { ...reste, libre: true, remarque: [texteProposition(proposition), remarque].filter(Boolean).join(" — ") };
    }
    const base = origine === ORIGINE_PHASAGE ? { ...reste, libre: true } : { ...reste };
    return motif ? { ...base, remarque } : base;
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
