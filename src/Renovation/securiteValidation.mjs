// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — règles de validation, justificatifs et
// signatures (tâche 4 du projet docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge (la date du jour arrive en
// paramètre, au format AAAA-MM-JJ), aucun effet de bord. Façade : securiteValidation.js.
//
// DEUX CHIFFRES DIFFÉRENTS, VOLONTAIREMENT :
//   - « n/12 renseignés » = indicateur d'avancement, calculé comme la vue
//     securite_fiches_etat (securiteFiche.mjs, compterPointsCompletes) : un
//     point compte dès qu'il a quelque chose ;
//   - « éléments manquants pour valider » = règle STRICTE ci-dessous. Une
//     fiche peut afficher 12/12 et ne pas être validable ; l'écran affiche
//     les deux côte à côte (« 12/12 renseignés, 2 éléments manquants pour
//     valider ») avec la liste détaillée.
//
// Règle stricte, point par point :
//   1  responsable (nom ET téléphone), au moins une entreprise nommée, aucune
//      entreprise sans nom, adresse du chantier renseignée sur l'opération ;
//   2  au moins un lot, début et fin prévus (fin ≥ début), effectif maximum,
//      logement occupé oui / non ;
//   3  au moins 2 lignes de risques ;
//   4…12 « Concerné » ou « Non concerné » choisi ; si « Concerné », au moins
//      une case cochée ou une mesure retenue.
// Justificatifs : chaque justificatif `requis` (securite/points.mjs) d'un
// point concerné (points 1 à 3 : toujours concernés) doit être joint au point,
// non retiré et non expiré — OU couvert par un justificatif permanent de
// l'espace entreprise (tâche 9) : même type, type rattachable
// (TYPES_RATTACHABLES_ENTREPRISE), non retiré, non confidentiel, non expiré.
// Amiante (point 4) : bloquant si le permis est antérieur au 1er juillet 1997
// sans repérage reçu ; bloquant aussi si la date du permis est inconnue sans
// repérage reçu (on ne peut pas savoir : l'impossibilité reste visible).
// Signatures : « établie par » et « chef d'équipe » sur la version en cours
// ET avec l'empreinte du contenu qui sera figé (securiteVersion.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import {
  POINTS_FICHE, STATUTS_POINT, STATUTS_POINT_COMPLETE, libelleJustificatif, TYPES_RATTACHABLES_ENTREPRISE,
} from "./securite/points.mjs";
import { compterPointsCompletes, NB_POINTS_FICHE } from "./securiteFiche.mjs";
import { libelleReperageAmiante } from "./securitePastilles.mjs";

/** Texte d'engagement affiché au-dessus du tracé (spécification, écran 3). */
export const TEXTE_ENGAGEMENT = "Je reconnais avoir été informé des risques et des consignes de ce chantier.";

/** Signatures exigées pour valider, dans l'ordre d'affichage. */
export const SIGNATURES_REQUISES = Object.freeze([
  Object.freeze({ type: "etablie_par", libelle: "Établie par" }),
  Object.freeze({ type: "chef_equipe", libelle: "Chef d'équipe" }),
]);

/** Repérage amiante considéré comme reçu. */
export const REPERAGES_RECUS = Object.freeze(["recu_sans_amiante", "recu_amiante_present"]);

/** Nombre minimal de lignes de la synthèse des risques pour valider. */
export const MIN_LIGNES_SYNTHESE = 2;

/** Types toujours proposés à l'ajout, en plus de ceux du point. */
export const TYPES_JUSTIFICATIF_LIBRES = Object.freeze(["photo", "autre"]);

/** Types jamais proposés au niveau du chantier (espace entreprise, tâche 9). */
export const TYPES_JUSTIFICATIF_EXCLUS_CHANTIER = Object.freeze(["aptitude_medicale"]);

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const nettoye = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const estDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
};
const pluriel = (n, s, p) => `${n} ${n > 1 ? p : s}`;

// ─── Justificatifs ───────────────────────────────────────────────────────────

/** Types proposés à l'ajout sur un point (sans l'aptitude médicale). */
export function typesJustificatifPoint(point) {
  const duPoint = (point?.justificatifs || []).map((j) => j.type_code);
  return [...new Set([...duPoint, ...TYPES_JUSTIFICATIF_LIBRES])]
    .filter((t) => !TYPES_JUSTIFICATIF_EXCLUS_CHANTIER.includes(t));
}

export const estJustificatifActif = (j) => !!j && !j.archive_le;

/** Expiré : date d'expiration strictement avant aujourd'hui (même règle que la vue securite_justificatifs_expiration). */
export function estExpire(j, aujourdhui) {
  return !!(j && j.expire_le && aujourdhui && String(j.expire_le) < String(aujourdhui));
}

/** Justificatifs actifs d'un point, les plus récents d'abord. */
export function justificatifsDuPoint(justificatifs, numero) {
  return (Array.isArray(justificatifs) ? justificatifs : [])
    .filter((j) => estJustificatifActif(j) && Number(j.point) === Number(numero))
    .sort((a, b) => String(b.date_document || "").localeCompare(String(a.date_document || ""))
      || String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

/** Un point est-il concerné ? Points 1 à 3 : toujours ; 4 à 12 : statut « concerne ». */
export function pointEstConcerne(reponses, point) {
  if (point.section !== "carte") return true;
  const r = estObjet(reponses) ? reponses[point.cle] : null;
  return estObjet(r) && r.statut === "concerne";
}

// ─── Espace entreprise (tâche 9) ─────────────────────────────────────────────

/**
 * Justificatif permanent de l'espace entreprise pouvant entrer dans une fiche
 * pour le type `typeCode` (expiré compris : l'appelant teste l'expiration).
 * Jamais confidentiel : le contenu figé et la règle doivent donner le même
 * résultat pour un admin et pour un non-admin.
 */
export function estEntrepriseRattachable(j, typeCode) {
  return !!j && j.portee === "entreprise" && estJustificatifActif(j) && j.confidentiel !== true
    && j.type_code === typeCode && TYPES_RATTACHABLES_ENTREPRISE.includes(typeCode);
}

/**
 * Justificatifs permanents VALIDES (non expirés) rattachés à un point :
 * points concernés seulement, types attendus sur le point et rattachables.
 * @returns {Array<{ numero, type_code, justificatif }>|null} null = espace
 *   entreprise illisible. Tri : point, type, expiration la plus lointaine
 *   d'abord (sans expiration en tête), puis id — ordre stable.
 */
export function justificatifsEntrepriseRattaches({ reponses, justificatifsEntreprise, aujourdhui }) {
  if (!Array.isArray(justificatifsEntreprise)) return null;
  const out = [];
  for (const p of POINTS_FICHE) {
    if (!pointEstConcerne(reponses, p)) continue;
    for (const t of new Set(p.justificatifs.map((x) => x.type_code))) {
      justificatifsEntreprise
        .filter((x) => estEntrepriseRattachable(x, t) && !estExpire(x, aujourdhui))
        .forEach((x) => out.push({ numero: p.numero, type_code: t, justificatif: x }));
    }
  }
  const cleExp = (j) => (j.expire_le ? String(j.expire_le) : "9999-99-99");
  return out.sort((a, b) => a.numero - b.numero || a.type_code.localeCompare(b.type_code)
    || cleExp(b.justificatif).localeCompare(cleExp(a.justificatif)) || String(a.justificatif.id).localeCompare(String(b.justificatif.id)));
}

/**
 * Justificatifs requis manquants (absents ou tous expirés) sur les points
 * concernés. MÊME fonction pour la fiche, la pastille du panneau, la mise à
 * jour proposée et les alertes S1.
 * `justificatifsEntreprise` : justificatifs de portée entreprise (tâche 9) ;
 * un requis est satisfait par un justificatif du chantier joint au point OU
 * par un justificatif permanent valide du même type (estEntrepriseRattachable).
 * @returns {Array<{numero, type_code, libelle, raison: "absent"|"expire"}>|null}
 *   null = justificatifs (du chantier ou de l'entreprise) illisibles.
 */
export function justificatifsRequisManquants({ reponses, justificatifs, aujourdhui, justificatifsEntreprise = [] }) {
  if (!Array.isArray(justificatifs) || !Array.isArray(justificatifsEntreprise)) return null;
  const out = [];
  for (const p of POINTS_FICHE) {
    if (!pointEstConcerne(reponses, p)) continue;
    for (const j of p.justificatifs) {
      if (!j.requis) continue;
      const joints = justificatifsDuPoint(justificatifs, p.numero).filter((x) => x.type_code === j.type_code);
      if (joints.some((x) => !estExpire(x, aujourdhui))) continue;
      const entreprise = justificatifsEntreprise.filter((x) => estEntrepriseRattachable(x, j.type_code));
      if (entreprise.some((x) => !estExpire(x, aujourdhui))) continue;
      out.push({ numero: p.numero, type_code: j.type_code, libelle: libelleJustificatif(j.type_code), raison: joints.length || entreprise.length ? "expire" : "absent" });
    }
  }
  return out;
}

/** Nombre de justificatifs actifs expirés (pour la pastille « expiré »). */
export function nbJustificatifsExpires(justificatifs, aujourdhui) {
  if (!Array.isArray(justificatifs)) return null;
  return justificatifs.filter((j) => estJustificatifActif(j) && estExpire(j, aujourdhui)).length;
}

/**
 * Données de la pastille rouge pour un chantier : { manquants, expires }, ou
 * null quand on ne sait pas (fiche ou justificatifs illisibles) — la pastille
 * n'invente alors aucun rouge.
 */
export function justificatifsPourPastille({ reponses, justificatifs, aujourdhui, justificatifsEntreprise = [] }) {
  const m = justificatifsRequisManquants({ reponses, justificatifs, aujourdhui, justificatifsEntreprise });
  const e = nbJustificatifsExpires(justificatifs, aujourdhui);
  if (m === null || e === null) return null;
  return { manquants: m.length, expires: e };
}

/**
 * Contrôle du formulaire d'ajout d'un justificatif de chantier.
 * @returns {{ ok: true, ligne } | { ok: false, erreurs }}
 *   `ligne` : colonnes de securite_justificatifs, sans fichier_path (posé
 *   après l'envoi du fichier).
 */
export function preparerJustificatif({ chantierId, point, form, aFichier }) {
  const erreurs = [];
  const f = form || {};
  if (!nettoye(chantierId)) erreurs.push("Chantier inconnu.");
  const p = POINTS_FICHE.find((x) => x.numero === Number(point?.numero ?? point));
  if (!p) erreurs.push("Point inconnu.");
  const type = nettoye(f.type_code);
  if (!type) erreurs.push("Choisissez le type de document.");
  else if (TYPES_JUSTIFICATIF_EXCLUS_CHANTIER.includes(type)) erreurs.push("Les aptitudes médicales se déposent dans l'espace entreprise (confidentiel), pas sur la fiche du chantier.");
  else if (p && !typesJustificatifPoint(p).includes(type)) erreurs.push("Type de document non prévu pour ce point.");
  if (!aFichier) erreurs.push("Choisissez un fichier ou prenez une photo.");
  const dd = nettoye(f.date_document), ex = nettoye(f.expire_le);
  if (dd && !estDate(dd)) erreurs.push("Date du document invalide.");
  if (ex && !estDate(ex)) erreurs.push("Date d'expiration invalide.");
  if (dd && ex && estDate(dd) && estDate(ex) && ex < dd) erreurs.push("La date d'expiration est avant la date du document.");
  if (erreurs.length) return { ok: false, erreurs };
  return {
    ok: true,
    ligne: {
      portee: "chantier",
      chantier_id: String(chantierId),
      operation_id: null,
      point: p.numero,
      type_code: type,
      date_document: dd || null,
      expire_le: ex || null,
      personne: nettoye(f.personne) || null,
      entreprise_nom: nettoye(f.entreprise_nom) || null,
      confidentiel: false,
    },
  };
}

// ─── Amiante (point 4) ───────────────────────────────────────────────────────

/**
 * @param {object} p { batiment (ligne securite_operations ou null), erreur (lecture) }
 * @returns {string|null} message bloquant, null = condition remplie.
 */
export function blocageAmiante({ batiment = null, erreur = null } = {}) {
  if (erreur) return `Données du bâtiment illisibles (${erreur}) : la condition amiante du point 4 ne peut pas être vérifiée.`;
  const statut = batiment?.reperage_amiante_statut || "a_completer";
  if (REPERAGES_RECUS.includes(statut)) return null;
  if (!batiment || !batiment.date_permis_construire || (batiment.avant_1997 !== true && batiment.avant_1997 !== false)) {
    return "Amiante (point 4) : date du permis de construire non renseignée dans le bloc Bâtiment de l'opération, et repérage amiante non reçu — impossible de savoir si le repérage est obligatoire.";
  }
  if (batiment.avant_1997 === true) {
    return `Amiante (point 4) : permis antérieur au 1er juillet 1997 et repérage amiante pas encore reçu (statut : ${libelleReperageAmiante(statut).toLowerCase()}).`;
  }
  return null;
}

// ─── Règle stricte des points ────────────────────────────────────────────────

/** Éléments manquants d'un point (règle stricte). [] = point prêt. */
export function manquantsDuPoint(point, fiche, { adresse = null } = {}) {
  const m = [];
  if (point.section === "intervenants") {
    const it = Array.isArray(fiche?.intervenants) ? fiche.intervenants.filter(estObjet) : [];
    const resp = it.find((e) => e.type === "responsable");
    if (!nettoye(resp?.nom)) m.push("nom du responsable du chantier");
    if (!nettoye(resp?.telephone)) m.push("téléphone du responsable");
    const ent = it.filter((e) => e.type === "entreprise");
    if (!ent.some((e) => nettoye(e.nom))) m.push("au moins une entreprise intervenante");
    if (ent.some((e) => !nettoye(e.nom))) m.push("nom d'une entreprise saisie");
    if (!nettoye(adresse)) m.push("adresse du chantier (à saisir sur l'opération)");
  } else if (point.section === "donnees_base") {
    const d = estObjet(fiche?.donnees_base) ? fiche.donnees_base : {};
    if (!Array.isArray(d.lots) || !d.lots.length) m.push("lots prévus");
    if (!estDate(d.date_debut)) m.push("date de début prévue");
    if (!estDate(d.date_fin)) m.push("date de fin prévue");
    if (estDate(d.date_debut) && estDate(d.date_fin) && d.date_fin < d.date_debut) m.push("date de fin postérieure au début");
    if (!Number.isInteger(d.effectif_max) || d.effectif_max < 1) m.push("effectif maximum");
    if (d.site_occupe !== true && d.site_occupe !== false) m.push("logement occupé : oui ou non");
  } else if (point.section === "synthese") {
    const n = (Array.isArray(fiche?.synthese_risques) ? fiche.synthese_risques : []).filter((l) => typeof l === "string" && l.trim()).length;
    if (n < MIN_LIGNES_SYNTHESE) m.push(`${MIN_LIGNES_SYNTHESE} risques principaux au moins (${n} saisi${n > 1 ? "s" : ""})`);
  } else {
    const r = estObjet(fiche?.reponses) ? fiche.reponses[point.cle] : null;
    const statut = estObjet(r) ? r.statut : undefined;
    if (statut !== undefined && !STATUTS_POINT.some((s) => s.id === statut)) m.push(`statut inconnu (${statut})`);
    else if (!STATUTS_POINT_COMPLETE.includes(statut)) m.push("« Concerné » ou « Non concerné » à choisir");
    else if (statut === "concerne") {
      const cases = estObjet(r.cases) ? Object.values(r.cases).filter((v) => v === true).length : 0;
      if (!cases && !nettoye(r.mesures)) m.push("au moins une case cochée ou une mesure retenue");
    }
  }
  return m;
}

// ─── Signatures ──────────────────────────────────────────────────────────────

/**
 * État d'une signature requise pour la fiche en cours.
 * @returns {{ etat: "signee"|"contenu_modifie"|"a_signer", signature }}
 *   signee : version en cours ET empreinte du contenu actuel ;
 *   contenu_modifie : signée sur la version en cours mais un contenu
 *   différent (modifié après la signature) : à refaire.
 */
export function etatSignature({ signatures, type, fiche, empreinte }) {
  const liste = (Array.isArray(signatures) ? signatures : [])
    .filter((s) => s && s.type === type && String(s.fiche_id) === String(fiche?.id))
    .sort((a, b) => String(b.signe_le || "").localeCompare(String(a.signe_le || "")));
  const courante = liste.filter((s) => s.version === fiche?.version);
  const valide = empreinte ? courante.find((s) => s.empreinte_version === empreinte) : null;
  if (valide) return { etat: "signee", signature: valide };
  if (courante.length) return { etat: "contenu_modifie", signature: courante[0] };
  return { etat: "a_signer", signature: null };
}

/**
 * Libellé d'une signature de l'historique.
 * `empreinteVersion` : empreinte de la version figée correspondante (si elle existe).
 */
export function libelleSignature(sig, { fiche, empreinteCourante = null, empreintesVersions = {} } = {}) {
  if (!sig) return "";
  if (sig.version !== fiche?.version) return `signée sur la v${sig.version}`;
  const figee = empreintesVersions[sig.version];
  if (figee) return sig.empreinte_version === figee ? `signée sur la v${sig.version} (version validée)` : `signée sur un contenu non retenu de la v${sig.version}`;
  if (empreinteCourante && sig.empreinte_version === empreinteCourante) return "valable pour le contenu actuel";
  return `signée sur un contenu antérieur de la v${sig.version} — à refaire`;
}

// ─── Synthèse : peut-on signer, peut-on valider ? ───────────────────────────

/**
 * @param {object} p
 * @param {object}  p.fiche          ligne securite_fiches ENREGISTRÉE
 * @param {object}  p.contexte       { adresse, batiment, batimentErreur, clientErreur, motifTrouve }
 * @param {Array?}  p.justificatifs  actifs du chantier (null = illisibles)
 * @param {Array?}  p.signatures     signatures de la fiche (null = illisibles)
 * @param {string?} p.empreinte      empreinte du contenu actuel (null = non calculée)
 * @param {string}  p.aujourdhui     AAAA-MM-JJ
 * @param {Array?}  p.justificatifsEntreprise justificatifs de portée entreprise
 *                  non confidentiels (null = illisibles)
 */
export function etatValidation({ fiche, contexte = {}, justificatifs = null, signatures = null, empreinte = null, aujourdhui = null, justificatifsEntreprise = [] }) {
  const nbPoints = compterPointsCompletes(fiche);
  const pointsIncomplets = [];
  for (const p of POINTS_FICHE) {
    const m = manquantsDuPoint(p, fiche, { adresse: contexte.adresse });
    if (m.length) pointsIncomplets.push({ numero: p.numero, titre: p.titre, manquants: m });
  }
  const bloquants = [];
  if (!fiche) bloquants.push("Fiche absente.");
  else if (fiche.statut !== "brouillon") bloquants.push("La fiche n'est pas en brouillon.");
  const amiante = blocageAmiante({ batiment: contexte.batiment, erreur: contexte.batimentErreur });
  if (amiante) bloquants.push(amiante);
  if (contexte.clientErreur) bloquants.push(`Client illisible (${contexte.clientErreur}) : il ne peut pas être figé dans la version.`);
  if (contexte.motifTrouve === false) bloquants.push(`Motif de la mise à jour de la v${fiche?.version} introuvable dans l'historique du chantier.`);
  const justifs = justificatifsRequisManquants({ reponses: fiche?.reponses, justificatifs, aujourdhui, justificatifsEntreprise });
  if (justifs === null) bloquants.push(Array.isArray(justificatifs)
    ? "Justificatifs de l'espace entreprise illisibles : impossible de vérifier ceux qui sont requis."
    : "Justificatifs illisibles : impossible de vérifier ceux qui sont requis.");

  const elementsContenu = pointsIncomplets.reduce((s, p) => s + p.manquants.length, 0) + (justifs?.length || 0) + bloquants.length;
  const contenuComplet = elementsContenu === 0;

  const sigs = SIGNATURES_REQUISES.map((s) => ({ ...s, ...etatSignature({ signatures, type: s.type, fiche, empreinte }) }));
  const signaturesManquantes = [];
  if (signatures === null) signaturesManquantes.push("Signatures illisibles.");
  else if (!empreinte) signaturesManquantes.push("Empreinte du contenu non calculée : signatures non vérifiables.");
  else sigs.forEach((s) => {
    if (s.etat === "a_signer") signaturesManquantes.push(`Signature « ${s.libelle} »`);
    if (s.etat === "contenu_modifie") signaturesManquantes.push(`Signature « ${s.libelle} » à refaire : la fiche a changé depuis`);
  });

  const nbManquants = elementsContenu + signaturesManquantes.length;
  const avancement = nbPoints === null ? `?/${NB_POINTS_FICHE}` : `${nbPoints}/${NB_POINTS_FICHE}`;
  const resume = nbManquants === 0
    ? `${avancement} renseignés, prête à valider`
    : `${avancement} renseignés, ${pluriel(nbManquants, "élément manquant", "éléments manquants")} pour valider`;
  return {
    nbPoints,
    pointsIncomplets,
    justificatifsManquants: justifs || [],
    bloquants,
    contenuComplet,
    signatures: sigs,
    signaturesManquantes,
    peutSigner: contenuComplet && !!empreinte && signatures !== null,
    peutValider: contenuComplet && signaturesManquantes.length === 0,
    nbManquants,
    resume,
  };
}
