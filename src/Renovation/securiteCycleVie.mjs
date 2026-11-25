// ─────────────────────────────────────────────────────────────────────────────
// securiteCycleVie — la fiche sécurité dans le cycle de vie du chantier
// (tâche 7 du projet docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// dates, auteurs et lignes arrivent en paramètre. Façade front :
// securiteCycleVie.js ; le script scripts/verif-securite-cycle-vie.mjs
// l'importe directement.
//
// Ce que ce module décide :
//   1. l'ÉTAT de l'étape « Fiche sécurité validée » (étape fiche_securite du
//      cycle de vie) : à créer / brouillon / validée / à mettre à jour /
//      verrouillée, et l'état à enregistrer dans chantier_cycle_vie ;
//   2. le CHANGEMENT DE STATUT d'un chantier : libre, bloqué (passage en
//      « en cours » sans fiche validée), ou suivi d'un verrouillage (passage en
//      « terminé ») ;
//   3. le FORÇAGE du démarrage par un admin (motif obligatoire) : champs de la
//      fiche et entrée du journal du chantier ;
//   4. le VERROUILLAGE à la clôture : changement de la fiche et entrée du
//      journal ;
//   5. les ALERTES de la fiche (préparées pour la table notifications, voir
//      alertesSecurite) et l'alerte « chantier déjà en cours sans fiche
//      validée » affichée dans l'appli.
//
// Invariant « une impossibilité reste visible » : un état de fiche illisible
// ou en cours de chargement ne vaut jamais « à créer » ni « validée », et un
// démarrage ne passe jamais sur une fiche qu'on n'a pas pu lire.
// ─────────────────────────────────────────────────────────────────────────────
import { statutDuChantier } from "./chantierActif.mjs";

/** Identifiant de l'étape du cycle de vie (cycleVie.mjs, phase Préparation). */
export const ETAPE_FICHE_SECURITE = "fiche_securite";
/** Événement du journal des statuts (même valeur que securiteVersion.mjs). */
export const EVENEMENT_FICHE_SECURITE = "fiche_securite";
/** Longueur minimale du motif de forçage (même règle que « Mettre à jour »). */
export const MOTIF_FORCAGE_MIN = 5;

export const STATUT_EN_COURS = "en_cours";
export const STATUT_TERMINE = "termine";
export const STATUT_PLANIFIE = "planifie";

const txt = (v) => (v == null ? "" : String(v).trim());
const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const jj = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : "";
};
const versionDe = (fiche) => (Number.isInteger(fiche?.version) && fiche.version >= 1 ? fiche.version : null);
const vTxt = (fiche) => (versionDe(fiche) ? `v${versionDe(fiche)}` : "version inconnue");
/** Forçage présent sur la fiche : colonnes de securite_fiches ou vue securite_fiches_etat. */
const estForcee = (fiche) => !!(fiche && (fiche.forcage_le || fiche.demarrage_force === true));

export const LIBELLES_ETAT_FICHE = Object.freeze({
  a_creer: "fiche à créer",
  brouillon: "fiche en brouillon",
  validee: "fiche validée",
  a_mettre_a_jour: "fiche à mettre à jour",
  verrouillee: "fiche verrouillée",
});

// ─── 1. État de l'étape « Fiche sécurité validée » ──────────────────────────

/**
 * État de la fiche d'un chantier, pour l'étape du cycle de vie et les écrans.
 * @param {object}  p
 * @param {object?} p.fiche   ligne securite_fiches (ou securite_fiches_etat), null = aucune fiche
 * @param {string}  p.lecture "ok" | "chargement" | "erreur"
 * @returns {{ code, libelle, fait, raison, version, forcee }}
 *   code : a_creer | brouillon | validee | a_mettre_a_jour | verrouillee
 *          | illisible | chargement | inconnu
 *   fait : la fiche de la version en cours a été validée (validée, ou
 *          verrouillée après validation).
 */
export function etatFicheSecurite({ fiche = null, lecture = "ok" } = {}) {
  if (lecture === "chargement") {
    return { code: "chargement", libelle: "chargement…", fait: false, raison: "État de la fiche sécurité en cours de lecture.", version: null, forcee: false };
  }
  if (lecture !== "ok") {
    return { code: "illisible", libelle: "état illisible", fait: false, version: null, forcee: false,
      raison: "État de la fiche sécurité illisible : on ne sait pas si elle est validée." };
  }
  if (!fiche) {
    return { code: "a_creer", libelle: LIBELLES_ETAT_FICHE.a_creer, fait: false, version: null, forcee: false,
      raison: "Aucune fiche sécurité pour ce chantier : à créer depuis la page Opération (bouton « Fiche sécurité »)." };
  }
  const forcee = estForcee(fiche);
  const suffixeForcage = forcee
    ? ` Démarrage forcé${fiche.forcage_par ? ` par ${fiche.forcage_par}` : ""}${fiche.forcage_le ? ` le ${jj(fiche.forcage_le)}` : ""}.`
    : "";
  const version = versionDe(fiche);
  switch (fiche.statut) {
    case "brouillon":
      return { code: "brouillon", libelle: `${LIBELLES_ETAT_FICHE.brouillon} ${vTxt(fiche)}`, fait: false, version, forcee,
        raison: `Fiche sécurité ${vTxt(fiche)} en brouillon : à compléter, signer et valider.${suffixeForcage}` };
    case "validee":
      return { code: "validee", libelle: `${LIBELLES_ETAT_FICHE.validee} ${vTxt(fiche)}`, fait: true, version, forcee,
        raison: `Fiche sécurité ${vTxt(fiche)} validée${fiche.validee_le ? ` le ${jj(fiche.validee_le)}` : ""}${fiche.validee_par ? ` par ${fiche.validee_par}` : ""}.${suffixeForcage}` };
    case "a_mettre_a_jour":
      return { code: "a_mettre_a_jour", libelle: `${LIBELLES_ETAT_FICHE.a_mettre_a_jour} (${vTxt(fiche)})`, fait: false, version, forcee,
        raison: `Fiche sécurité ${vTxt(fiche)} à mettre à jour : un changement doit être repris dans une nouvelle version.${suffixeForcage}` };
    case "verrouillee": {
      // Verrouillée = chantier terminé. « Faite » seulement si elle avait été
      // validée : une fiche verrouillée en brouillon (démarrage forcé) ne l'est pas.
      const validee = !!fiche.validee_le;
      return { code: "verrouillee", libelle: `${LIBELLES_ETAT_FICHE.verrouillee} ${vTxt(fiche)}`, fait: validee, version, forcee,
        raison: validee
          ? `Fiche sécurité ${vTxt(fiche)} verrouillée (chantier terminé), validée le ${jj(fiche.validee_le)}.${suffixeForcage}`
          : `Fiche sécurité ${vTxt(fiche)} verrouillée (chantier terminé) sans avoir été validée.${suffixeForcage}` };
    }
    default:
      return { code: "inconnu", libelle: `état inconnu (${fiche.statut ?? "vide"})`, fait: false, version, forcee,
        raison: `État de fiche inattendu (${fiche.statut ?? "vide"}) : à vérifier.` };
  }
}

/**
 * État à enregistrer dans chantier_cycle_vie pour l'étape fiche_securite.
 * Seuls les états CONNUS s'enregistrent : illisible / chargement / inconnu →
 * null (on n'écrit pas ce qu'on ne sait pas).
 * La fiche est rangée sous `fiche` (et non `donnees`, réservé aux champs
 * typés d'une étape et lu tel quel par l'export d'opération).
 */
export function etatEtapePourEcriture({ fiche = null, lecture = "ok", auteur = "", le = "" } = {}) {
  const e = etatFicheSecurite({ fiche, lecture });
  if (!LIBELLES_ETAT_FICHE[e.code]) return null;
  return {
    fait: e.fait,
    date: txt(le) || null,
    auteur: txt(auteur),
    fiche: { statut: e.code, version: e.version, forcee: e.forcee },
  };
}

/** L'état enregistré diffère-t-il de l'état à écrire ? (synchronisation) */
export function etapeADesynchroniser(etatEnregistre, aEcrire) {
  if (!aEcrire) return false;
  if (!estObjet(etatEnregistre)) return true;
  const f = estObjet(etatEnregistre.fiche) ? etatEnregistre.fiche : {};
  return !!etatEnregistre.fait !== !!aEcrire.fait
    || f.statut !== aEcrire.fiche.statut
    || (f.version ?? null) !== (aEcrire.fiche.version ?? null)
    || !!f.forcee !== !!aEcrire.fiche.forcee;
}

/**
 * Évaluation de l'étape pour la frise (appelée par evaluerEtape, cycleVie.mjs).
 *   ficheSecurite : { fiche, lecture } lu par l'écran (prioritaire), ou absent
 *   etatEnregistre : ligne chantier_cycle_vie de l'étape (dernier état connu)
 * → { fait, auto: true, raison }
 */
export function evaluerEtapeFicheSecurite({ ficheSecurite = null, etatEnregistre = null } = {}) {
  if (ficheSecurite && (ficheSecurite.lecture === "ok" || !estObjet(etatEnregistre))) {
    const e = etatFicheSecurite(ficheSecurite);
    return { fait: e.fait, auto: true, raison: e.raison };
  }
  if (estObjet(etatEnregistre) && estObjet(etatEnregistre.fiche) && LIBELLES_ETAT_FICHE[etatEnregistre.fiche.statut]) {
    const f = etatEnregistre.fiche;
    const v = Number.isInteger(f.version) ? ` v${f.version}` : "";
    const quand = etatEnregistre.date ? ` (enregistré le ${jj(etatEnregistre.date)})` : "";
    const lecture = ficheSecurite ? " La fiche n'a pas pu être relue : dernier état enregistré" : " Dernier état enregistré";
    return { fait: !!etatEnregistre.fait, auto: true,
      raison: `${lecture.trim()} : ${LIBELLES_ETAT_FICHE[f.statut]}${v}${f.forcee ? ", démarrage forcé" : ""}${quand}.` };
  }
  if (estObjet(etatEnregistre) && typeof etatEnregistre.fait === "boolean") {
    return { fait: etatEnregistre.fait, auto: true,
      raison: `Dernier état enregistré : ${etatEnregistre.fait ? "fiche validée" : "fiche non validée"}${etatEnregistre.date ? ` (le ${jj(etatEnregistre.date)})` : ""}.` };
  }
  return { fait: false, auto: true, raison: "État de la fiche sécurité non chargé." };
}

// ─── 2. Changement de statut d'un chantier ──────────────────────────────────

/**
 * Que faire quand un écran veut passer un chantier de `ancienStatut` à
 * `nouveauStatut` ?
 * @param {object}  p
 * @param {object}  p.chantier
 * @param {string?} p.ancienStatut  statut affiché (défaut : celui du chantier)
 * @param {string}  p.nouveauStatut
 * @param {object?} p.fiche         ligne securite_fiches, null = aucune fiche
 * @param {string}  p.lecture       "ok" | "chargement" | "erreur" (lecture de la fiche)
 * @param {boolean} p.estAdmin      profil.role === "admin" (comme le reste de l'appli)
 * @returns {{ action: "libre"|"bloque"|"verrouiller", raison, etat, ... }}
 *   bloque     : forcagePossible (admin et fiche lue), creerFiche (pas de
 *                fiche : le forçage la crée en brouillon), forcageSurFiche
 *                (false si la fiche est verrouillée : le motif ne peut aller
 *                qu'au journal)
 *   verrouiller: la fiche doit passer en « verrouillée » APRÈS l'enregistrement du statut
 *   libre      : alerteFicheACreer (passage en planifié sans fiche)
 */
export function decisionChangementStatut({ chantier = null, ancienStatut, nouveauStatut, fiche = null, lecture = "ok", estAdmin = false } = {}) {
  const avant = txt(ancienStatut !== undefined ? ancienStatut : statutDuChantier(chantier)) || null;
  const apres = txt(nouveauStatut) || null;
  const etat = etatFicheSecurite({ fiche, lecture });
  if (!apres || apres === avant) return { action: "libre", raison: "Statut inchangé.", etat };

  if (apres === STATUT_EN_COURS) {
    if (etat.code === "validee") {
      return { action: "libre", raison: `Démarrage autorisé : ${etat.libelle}.`, etat };
    }
    if (etat.code === "chargement" || etat.code === "illisible") {
      return { action: "bloque", etat, forcagePossible: false, creerFiche: false, forcageSurFiche: false,
        raison: etat.code === "chargement"
          ? "La fiche sécurité est en cours de lecture : réessayez dans un instant."
          : "La fiche sécurité n'a pas pu être lue : impossible de vérifier qu'elle est validée. Réessayez." };
    }
    const pourquoi = {
      a_creer: "ce chantier n'a pas encore de fiche sécurité",
      brouillon: `la fiche sécurité ${vTxt(fiche)} est encore en brouillon`,
      a_mettre_a_jour: `la fiche sécurité ${vTxt(fiche)} est à mettre à jour`,
      verrouillee: `la fiche sécurité ${vTxt(fiche)} est verrouillée (chantier terminé)`,
      inconnu: `l'état de la fiche sécurité est inattendu (${fiche?.statut ?? "vide"})`,
    }[etat.code] || "la fiche sécurité n'est pas validée";
    return {
      action: "bloque", etat,
      raison: `Démarrage impossible : ${pourquoi}. Le passage « En cours » exige une fiche sécurité validée.`,
      forcagePossible: !!estAdmin,
      creerFiche: etat.code === "a_creer",
      forcageSurFiche: etat.code !== "verrouillee",
    };
  }

  if (apres === STATUT_TERMINE) {
    if (fiche && fiche.statut !== "verrouillee" && lecture === "ok") {
      return { action: "verrouiller", etat, raison: `Chantier terminé : la fiche sécurité ${vTxt(fiche)} sera verrouillée.` };
    }
    if (lecture !== "ok") {
      return { action: "libre", etat, verrouillageInconnu: true,
        raison: "Fiche sécurité illisible : son verrouillage n'a pas pu être vérifié ; rouvrir la fiche pour le faire." };
    }
    return { action: "libre", etat, raison: fiche ? "Fiche sécurité déjà verrouillée." : "Pas de fiche sécurité : rien à verrouiller (aucune fiche n'est créée pour un chantier terminé)." };
  }

  if (apres === STATUT_PLANIFIE && etat.code === "a_creer") {
    return { action: "libre", etat, alerteFicheACreer: true,
      raison: "Chantier planifié : sa fiche sécurité est à créer (elle devra être validée avant le démarrage)." };
  }
  return { action: "libre", etat, raison: "Changement sans effet sur la fiche sécurité." };
}

// ─── 3. Forçage du démarrage (admin) ────────────────────────────────────────

/** Motif de forçage : obligatoire, MOTIF_FORCAGE_MIN caractères au moins. */
export function validerMotifForcage(motif) {
  const m = txt(motif);
  if (!m) return { ok: false, erreur: "Le motif du forçage est obligatoire." };
  if (m.length < MOTIF_FORCAGE_MIN) return { ok: false, erreur: `Motif trop court (${MOTIF_FORCAGE_MIN} caractères au moins).` };
  return { ok: true, motif: m };
}

/**
 * Écritures d'un forçage. Ordre à respecter par l'appelant :
 *   1. fiche (création en brouillon avec le forçage, ou ajout du forçage) —
 *      sauf fiche verrouillée (forcageSurFiche false) ;
 *   2. journal du chantier ;
 *   3. statut du chantier « en cours ».
 * Si une étape échoue, on s'arrête : le statut ne change pas.
 * @returns {{ ok: true, ficheInsert?, fichePatch?, conditionFiche?, journal } | { ok: false, erreurs }}
 */
export function preparerForcage({ chantier, ancienStatut, fiche = null, lecture = "ok", estAdmin = false, motif, auteur, le }) {
  const erreurs = [];
  if (!chantier?.id) erreurs.push("Chantier inconnu.");
  if (!estAdmin) erreurs.push("Seul un administrateur peut forcer le démarrage.");
  if (lecture !== "ok") erreurs.push("Fiche sécurité illisible : forçage impossible tant qu'elle n'a pas été relue.");
  const m = validerMotifForcage(motif);
  if (!m.ok) erreurs.push(m.erreur);
  if (!txt(le)) erreurs.push("Date du forçage inconnue.");
  if (erreurs.length) return { ok: false, erreurs };
  const d = decisionChangementStatut({ chantier, ancienStatut, nouveauStatut: STATUT_EN_COURS, fiche, lecture, estAdmin });
  if (d.action !== "bloque") return { ok: false, erreurs: ["Aucun forçage nécessaire : la fiche est validée."] };

  const qui = txt(auteur) || null;
  const champsForcage = { forcage_motif: m.motif, forcage_par: qui, forcage_le: txt(le) };
  const avant = txt(ancienStatut !== undefined ? ancienStatut : statutDuChantier(chantier)) || null;
  const etatTxt = d.etat.code === "a_creer" ? "aucune fiche (créée en brouillon)" : d.etat.libelle;
  const journal = {
    chantier_id: String(chantier.id),
    evenement: EVENEMENT_FICHE_SECURITE,
    ancien_statut: avant,
    nouveau_statut: STATUT_EN_COURS,
    motif: m.motif,
    detail: `Démarrage forcé sans fiche sécurité validée — ${etatTxt}${d.forcageSurFiche ? "" : " ; fiche verrouillée : motif tracé ici seulement"}`,
    auteur: qui,
  };
  if (!fiche) {
    return { ok: true, ficheInsert: { chantier_id: String(chantier.id), cree_par: qui, maj_par: qui, ...champsForcage }, journal };
  }
  if (!d.forcageSurFiche) return { ok: true, journal };
  return {
    ok: true,
    fichePatch: { ...champsForcage, maj_par: qui },
    // L'écriture ne passe que si la fiche n'a pas changé d'état entre-temps.
    conditionFiche: { id: fiche.id, statut: fiche.statut, version: fiche.version },
    journal,
  };
}

// ─── 4. Verrouillage à la clôture ───────────────────────────────────────────

/**
 * Écritures du verrouillage. Ordre à respecter par l'appelant : le statut
 * « terminé » est enregistré D'ABORD (un verrouillage ne s'annule pas, même
 * par un admin : on ne verrouille pas une fiche pour un statut qui n'aurait
 * pas été enregistré), puis la fiche, puis le journal. Un échec du
 * verrouillage est affiché tel quel, jamais présenté comme fait.
 * @returns {{ ok: true, fichePatch, conditionFiche, journal } | { ok: false, erreurs }}
 */
export function preparerVerrouillage({ chantier, fiche, auteur }) {
  if (!chantier?.id) return { ok: false, erreurs: ["Chantier inconnu."] };
  if (!fiche?.id) return { ok: false, erreurs: ["Pas de fiche sécurité à verrouiller."] };
  if (fiche.statut === "verrouillee") return { ok: false, erreurs: ["Fiche déjà verrouillée."] };
  const qui = txt(auteur) || null;
  return {
    ok: true,
    fichePatch: { statut: "verrouillee", maj_par: qui },
    conditionFiche: { id: fiche.id, statut: fiche.statut, version: fiche.version },
    journal: {
      chantier_id: String(chantier.id),
      evenement: EVENEMENT_FICHE_SECURITE,
      ancien_statut: fiche.statut,
      nouveau_statut: "verrouillee",
      motif: null,
      detail: `Fiche sécurité ${vTxt(fiche)} verrouillée : chantier terminé${fiche.statut === "validee" ? "" : ` (elle était « ${LIBELLES_ETAT_FICHE[fiche.statut] || fiche.statut} », jamais validée sur cette version)`}`,
      auteur: qui,
    },
  };
}

/** Chantier terminé dont la fiche n'est pas verrouillée (verrouillage à refaire). */
export function verrouillageEnAttente({ chantier, fiche, lecture = "ok" }) {
  return lecture === "ok" && statutDuChantier(chantier) === STATUT_TERMINE && !!fiche && fiche.statut !== "verrouillee";
}

// ─── 5. Alertes ─────────────────────────────────────────────────────────────

/**
 * Alerte affichée dans l'appli pour un chantier DÉJÀ en cours dont la fiche
 * n'est pas validée (mise en service : pas de blocage rétroactif, mais
 * l'écart reste visible). null = rien à signaler (ou état inconnu : la
 * pastille dit déjà « état illisible »).
 */
export function alerteChantierEnCours({ chantier, fiche = null, lecture = "ok" }) {
  if (lecture !== "ok" || statutDuChantier(chantier) !== STATUT_EN_COURS) return null;
  const e = etatFicheSecurite({ fiche, lecture });
  if (e.fait) return null;
  if (e.forcee) return `Chantier en cours, démarrage forcé : ${e.libelle}, à valider.`;
  return `Chantier déjà en cours sans fiche sécurité validée (${e.libelle}).`;
}

/** Ajoute `n` jours à une date AAAA-MM-JJ (calendrier, sans fuseau). */
export function ajouterJours(dateIso, n) {
  const s = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [a, m, j] = s.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

export const TYPES_ALERTE_SECURITE = Object.freeze({
  fiche_a_creer: "Fiche sécurité à créer",
  fiche_non_validee_j7: "Fiche sécurité non validée à 7 jours du démarrage",
  justificatif_expire: "Justificatif expiré sur un chantier en cours",
  fiche_a_mettre_a_jour: "Fiche sécurité à mettre à jour",
});

/**
 * Alertes de la fiche sécurité à écrire dans la table notifications (une
 * ligne par alerte et par chantier). Utilisé par la tâche planifiée du
 * serveur (tâche 7b : api/_cron/cron-alertes-securite.js, via
 * securiteAlertesPush.mjs, notification S1) : la table notifications n'est
 * écrite que par le serveur (aucun droit pour un compte connecté).
 * @param {object} p
 * @param {Array}  p.chantiers      [{ id, nom, statut, archive_le? }]
 * @param {object} p.fiches         { [chantierId]: ligne securite_fiches } — chantier absent = pas de fiche
 * @param {object} p.premieresDates { [chantierId]: "AAAA-MM-JJ" } première date prévue du phasage ; absent = inconnue
 * @param {object} p.expires        { [chantierId]: nombre de justificatifs REQUIS expirés, non
 *                                  confidentiels (securiteAlertesPush.nbRequisExpires) }
 * @param {string} p.aujourdhui     "AAAA-MM-JJ" (fourni par l'appelant)
 * @returns {Array<{ type, chantier_id, titre, texte, lien, cle }>}
 *   cle = clé de regroupement (une alerte par type, chantier et jour) ;
 *   les chantiers dont la première date est inconnue sont listés à part
 *   (`type: "date_inconnue"`) : jamais traités comme « pas d'alerte ».
 */
export function alertesSecurite({ chantiers = [], fiches = {}, premieresDates = {}, expires = {}, aujourdhui } = {}) {
  const jour = String(aujourdhui || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return [];
  const limite = ajouterJours(jour, 7);
  const lien = (id) => `/?page=chantiers&chantier=${encodeURIComponent(String(id))}`;
  const out = [];
  const pousser = (type, c, texte) => out.push({ type, chantier_id: String(c.id), titre: `${TYPES_ALERTE_SECURITE[type] || type} — ${c.nom || c.id}`, texte, lien: lien(c.id), cle: `securite-${type}-${c.id}-${jour}` });
  for (const c of Array.isArray(chantiers) ? chantiers : []) {
    if (!c?.id || c.archive_le) continue;
    const statut = statutDuChantier(c);
    const fiche = Object.prototype.hasOwnProperty.call(fiches || {}, c.id) ? fiches[c.id] : null;
    const etat = etatFicheSecurite({ fiche, lecture: "ok" });
    if (statut === STATUT_PLANIFIE && etat.code === "a_creer") {
      pousser("fiche_a_creer", c, "Chantier planifié sans fiche sécurité : à créer et valider avant le démarrage.");
    }
    if (statut === STATUT_PLANIFIE && !etat.fait) {
      const d = premieresDates?.[c.id] ? String(premieresDates[c.id]).slice(0, 10) : null;
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        out.push({ type: "date_inconnue", chantier_id: String(c.id), titre: "", texte: "Première date prévue du phasage inconnue : alerte à 7 jours impossible à calculer.", lien: lien(c.id), cle: null });
      } else if (d <= limite) {
        pousser("fiche_non_validee_j7", c, `Démarrage prévu le ${jj(d)} : ${etat.libelle}, non validée.`);
      }
    }
    const nbExp = Number(expires?.[c.id]) || 0;
    if (statut === STATUT_EN_COURS && nbExp > 0) {
      pousser("justificatif_expire", c, `${nbExp} justificatif${nbExp > 1 ? "s" : ""} expiré${nbExp > 1 ? "s" : ""} sur la fiche sécurité d'un chantier en cours.`);
    }
    if (etat.code === "a_mettre_a_jour" && statut !== STATUT_TERMINE) {
      pousser("fiche_a_mettre_a_jour", c, `${etat.libelle} : nouvelle version à valider.`);
    }
  }
  return out;
}
