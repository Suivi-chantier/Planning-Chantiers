// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — espace « Justificatifs entreprise » (tâche 9
// du projet docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge (la date du jour arrive en
// paramètre, au format AAAA-MM-JJ), aucun effet de bord. Façade :
// securiteEntreprise.js.
//
//   - statut d'expiration : la vue securite_justificatifs_expiration FAIT FOI
//     (colonne `etat`) ; la page la lit. etatExpiration() reproduit sa règle
//     pour les scripts de vérification (contrôlée contre le SQL de la vue) et
//     n'est utilisée par la page que pour dire « sans date d'expiration »
//     (la vue écarte ces lignes) ;
//   - lignes de la page : jamais d'aptitude médicale pour un non-admin (ni
//     ligne, ni compte) — la base ne les lui renvoie déjà pas, on filtre
//     quand même ;
//   - ajout : contrôle du formulaire et chemin de stockage (non confidentiel
//     → chantier-documents sous securite/entreprise/ ; aptitude médicale →
//     bucket securite-confidentiel, confidentiel = true, admins seulement) ;
//   - affichage dans la fiche : personne affectée au planning du chantier ?
//     (mention seulement : la règle de validation ne dépend pas du planning,
//     pour que l'empreinte signée ne change pas quand le planning change).
// ─────────────────────────────────────────────────────────────────────────────
import {
  TYPES_JUSTIFICATIF_ENTREPRISE, TYPE_JUSTIFICATIF_CONFIDENTIEL, libelleJustificatif,
} from "./securite/points.mjs";

/** Délai de l'état « expire bientôt » : même valeur que la vue (current_date + 30). */
export const JOURS_EXPIRE_BIENTOT = 30;

/** Libellés des états de la vue (+ deux états d'affichage). */
export const LIBELLES_ETAT_EXPIRATION = Object.freeze({
  valide: "valide",
  expire_bientot: "expire sous 30 jours",
  expire: "expiré",
  sans_expiration: "sans date d'expiration",
  inconnu: "statut illisible",
});

/** Bucket des documents confidentiels (aptitudes médicales, admins seulement). */
export const BUCKET_CONFIDENTIEL = "securite-confidentiel";

const nettoye = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const estDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ""));
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
};
const plusJours = (iso, n) => {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
};

/**
 * Règle de la vue securite_justificatifs_expiration, reproduite :
 *   expire_le < aujourd'hui            → « expire »
 *   expire_le < aujourd'hui + 30 jours → « expire_bientot »
 *   sinon                              → « valide »
 * Sans date d'expiration : la vue n'a pas de ligne → « sans_expiration ».
 * Date illisible : « inconnu » (jamais « valide » par défaut).
 */
export function etatExpiration(expireLe, aujourdhui) {
  if (expireLe === null || expireLe === undefined || expireLe === "") return "sans_expiration";
  const d = String(expireLe).slice(0, 10);
  if (!estDate(d) || !estDate(aujourdhui)) return "inconnu";
  if (d < aujourdhui) return "expire";
  if (d < plusJours(aujourdhui, JOURS_EXPIRE_BIENTOT)) return "expire_bientot";
  return "valide";
}

/** Le type est-il confidentiel (aptitude médicale) ? */
export const estTypeConfidentiel = (type) => type === TYPE_JUSTIFICATIF_CONFIDENTIEL;

/** Types proposés à l'ajout : l'aptitude médicale seulement pour un admin. */
export function typesProposesEntreprise(estAdmin) {
  return TYPES_JUSTIFICATIF_ENTREPRISE.filter((t) => estAdmin === true || !estTypeConfidentiel(t));
}

/** Un justificatif est-il visible pour cet utilisateur ? (confidentiel → admin seulement) */
export function estVisible(j, estAdmin) {
  if (!j) return false;
  if (j.confidentiel === true || estTypeConfidentiel(j.type_code)) return estAdmin === true;
  return true;
}

/**
 * Lignes de la page « Justificatifs entreprise ».
 * @param {object} p
 * @param {Array?}  p.justificatifs  lignes securite_justificatifs de portée entreprise (null = illisibles)
 * @param {object?} p.etats          { [id]: etat } lu dans la vue (null = vue illisible)
 * @param {boolean} p.estAdmin
 * @returns {Array<{ justificatif, etat, libelleEtat, libelleType }>|null}
 *   Triées par expiration la plus proche (expirés d'abord), puis sans date
 *   d'expiration ; à égalité : personne, type. null = illisibles.
 *   État : celui de la vue ; une ligne avec date d'expiration absente de la
 *   vue (ou vue illisible) est « statut illisible », jamais « valide ».
 */
export function lignesJustificatifsEntreprise({ justificatifs, etats, estAdmin }) {
  if (!Array.isArray(justificatifs)) return null;
  const lignes = justificatifs
    .filter((j) => j && j.portee === "entreprise" && !j.archive_le && estVisible(j, estAdmin))
    .map((j) => {
      let etat;
      if (!j.expire_le) etat = "sans_expiration";
      else if (etats && typeof etats === "object" && etats[j.id]) etat = etats[j.id];
      else etat = "inconnu";
      if (!LIBELLES_ETAT_EXPIRATION[etat]) etat = "inconnu";
      return { justificatif: j, etat, libelleEtat: LIBELLES_ETAT_EXPIRATION[etat], libelleType: libelleJustificatif(j.type_code) };
    });
  const cle = (l) => (l.justificatif.expire_le ? String(l.justificatif.expire_le).slice(0, 10) : "9999-99-99");
  return lignes.sort((a, b) => cle(a).localeCompare(cle(b))
    || nettoye(a.justificatif.personne).localeCompare(nettoye(b.justificatif.personne), "fr")
    || a.libelleType.localeCompare(b.libelleType, "fr")
    || String(a.justificatif.id).localeCompare(String(b.justificatif.id)));
}

/** Comptes par état (sur les lignes visibles uniquement). */
export function comptesParEtat(lignes) {
  const c = { valide: 0, expire_bientot: 0, expire: 0, sans_expiration: 0, inconnu: 0 };
  (Array.isArray(lignes) ? lignes : []).forEach((l) => { c[l.etat] = (c[l.etat] || 0) + 1; });
  return c;
}

/** Filtres de la page : personne (texte exact, "" = toutes) et type ("" = tous). */
export function filtrerLignes(lignes, { personne = "", type = "" } = {}) {
  return (Array.isArray(lignes) ? lignes : []).filter((l) =>
    (!personne || nettoye(l.justificatif.personne) === personne) && (!type || l.justificatif.type_code === type));
}

/** Personnes distinctes (pour le filtre), « (sans personne) » à part. */
export function personnesDistinctes(lignes) {
  return [...new Set((Array.isArray(lignes) ? lignes : []).map((l) => nettoye(l.justificatif.personne)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "fr"));
}

/**
 * Contrôle du formulaire d'ajout d'un justificatif de l'espace entreprise.
 * @returns {{ ok: true, ligne, confidentiel } | { ok: false, erreurs }}
 *   `ligne` : colonnes de securite_justificatifs, sans fichier_path (posé
 *   après l'envoi du fichier).
 */
export function preparerJustificatifEntreprise({ form, aFichier, estAdmin }) {
  const erreurs = [];
  const f = form || {};
  const type = nettoye(f.type_code);
  if (!type) erreurs.push("Choisissez le type de document.");
  else if (!TYPES_JUSTIFICATIF_ENTREPRISE.includes(type)) erreurs.push("Type de document non prévu dans l'espace entreprise.");
  else if (estTypeConfidentiel(type) && estAdmin !== true) erreurs.push("Les aptitudes médicales sont réservées aux administrateurs.");
  if (!aFichier) erreurs.push("Choisissez un fichier ou prenez une photo.");
  const dd = nettoye(f.date_document), ex = nettoye(f.expire_le);
  if (dd && !estDate(dd)) erreurs.push("Date du document invalide.");
  if (ex && !estDate(ex)) erreurs.push("Date d'expiration invalide.");
  if (dd && ex && estDate(dd) && estDate(ex) && ex < dd) erreurs.push("La date d'expiration est avant la date du document.");
  const personne = nettoye(f.personne);
  if (["habilitation_electrique", "formation_ss4", "formation_echafaudage", TYPE_JUSTIFICATIF_CONFIDENTIEL].includes(type) && !personne) {
    erreurs.push("Indiquez la personne concernée (habilitation, formation ou aptitude : document nominatif).");
  }
  if (erreurs.length) return { ok: false, erreurs };
  const confidentiel = estTypeConfidentiel(type);
  return {
    ok: true,
    confidentiel,
    ligne: {
      portee: "entreprise",
      chantier_id: null,
      operation_id: null,
      point: null,
      type_code: type,
      date_document: dd || null,
      expire_le: ex || null,
      personne: personne || null,
      entreprise_nom: nettoye(f.entreprise_nom) || null,
      confidentiel,
    },
  };
}

/**
 * Dossier de stockage d'un justificatif de l'espace entreprise.
 *   non confidentiel : bucket chantier-documents, securite/entreprise/{type}
 *   aptitude médicale : bucket securite-confidentiel, entreprise/aptitude_medicale
 */
export function stockageJustificatifEntreprise(typeCode) {
  const t = nettoye(typeCode);
  if (!TYPES_JUSTIFICATIF_ENTREPRISE.includes(t)) throw new Error("Type de document inconnu.");
  return estTypeConfidentiel(t)
    ? { bucket: BUCKET_CONFIDENTIEL, dossier: `entreprise/${t}` }
    : { bucket: "chantier-documents", dossier: `securite/entreprise/${t}` };
}

// ─── Affichage dans la fiche d'un chantier ───────────────────────────────────

const normalise = (s) => nettoye(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Noms des personnes du planning d'un chantier (cases planning_cells.ouvriers). */
export function nomsPlanning(cellules) {
  if (!Array.isArray(cellules)) return null;
  const noms = new Set();
  for (const c of cellules) {
    for (const o of Array.isArray(c?.ouvriers) ? c.ouvriers : []) {
      const n = typeof o === "string" ? o : (o?.nom || o?.name || "");
      if (nettoye(n)) noms.add(nettoye(n));
    }
  }
  return [...noms];
}

/**
 * La personne d'un justificatif est-elle au planning du chantier ?
 * Correspondance souple : nom complet identique, ou nom du planning égal à un
 * mot du nom du justificatif (« Steven » ↔ « Steven Exemple »), sans accents
 * ni casse. Mention d'affichage seulement.
 * @returns {"affecte"|"non_retrouve"|"inconnue"} inconnue = planning illisible ou personne non renseignée
 */
export function affectationPersonne(personne, noms) {
  const p = normalise(personne);
  if (!p || !Array.isArray(noms)) return "inconnue";
  const mots = p.split(/[\s,.'-]+/).filter(Boolean);
  return noms.some((n) => { const x = normalise(n); return x && (x === p || mots.includes(x)); }) ? "affecte" : "non_retrouve";
}

/**
 * Texte affiché pour un justificatif rattaché depuis l'espace entreprise.
 * `affectation` : sortie de affectationPersonne() (habilitation), ou
 * "sans_objet" (formation, DUERP… : pas de mention d'affectation).
 */
export function texteRattache(j, { affectation = "inconnue", dateFr = (d) => d } = {}) {
  const validite = j?.expire_le ? `valable jusqu'au ${dateFr(j.expire_le)}` : "sans date d'expiration";
  const mention = !nettoye(j?.personne) ? ""
    : affectation === "sans_objet" ? ` · ${nettoye(j.personne)}`
    : affectation === "affecte" ? ` · ${nettoye(j.personne)} (au planning de ce chantier)`
    : affectation === "non_retrouve" ? ` · ${nettoye(j.personne)} (pas retrouvé au planning de ce chantier : à vérifier)`
    : ` · ${nettoye(j.personne)} (affectation au chantier inconnue)`;
  return `depuis l'espace entreprise, ${validite}${mention}`;
}
