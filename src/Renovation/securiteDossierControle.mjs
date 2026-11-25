// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — « Dossier de contrôle » (tâche 9b du projet
// docs/projets/fiche-securite-chantier.md).
//
// Un fichier ZIP à présenter en cas de contrôle (inspection du travail,
// CARSAT, OPPBTP) : le PDF de la DERNIÈRE VERSION VALIDÉE + les justificatifs
// de cette version (ceux du chantier et ceux de l'espace entreprise
// rattachés, tels qu'ils ont été figés) ; pour un administrateur seulement,
// les aptitudes médicales valides rattachées aux points concernés qui les
// attendent (rangées dans un dossier « Confidentiel »).
//
// Module PUR : aucun accès Supabase, aucune horloge (la date arrive en
// paramètre), aucun effet de bord. Façade : securiteDossierControle.js.
//   - planDossierControle() : quels fichiers, de quel stockage, sous quel nom ;
//     JAMAIS de document confidentiel pour un non-admin (ni fichier, ni ligne
//     dans A_LIRE.txt, ni compte) ;
//   - texteALire() : fichier « A_LIRE.txt » qui liste ce qui n'a pas pu être
//     lu (un fichier illisible ne fait pas échouer le dossier en silence) ;
//   - zipStocke() : écriture d'un ZIP « stocké » (sans compression : les PDF
//     et photos sont déjà compressés), sans bibliothèque. CRC-32 et en-têtes
//     au format ZIP standard (APPNOTE), noms en UTF-8 (bit 11).
// ─────────────────────────────────────────────────────────────────────────────
import { POINTS_FICHE, TYPE_JUSTIFICATIF_CONFIDENTIEL, libelleJustificatif } from "./securite/points.mjs";
import { FORMATS_CONTENU_LISIBLES } from "./securiteVersion.mjs";
import { pointEstConcerne, estExpire, estJustificatifActif } from "./securiteValidation.mjs";

export const BUCKET_DOCUMENTS = "chantier-documents";
export const BUCKET_PREUVES = "securite-preuves";
export const BUCKET_CONFIDENTIEL = "securite-confidentiel";
export const NOM_A_LIRE = "A_LIRE.txt";

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const txt = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const liste = (v) => (Array.isArray(v) ? v : []);

/** Morceau de nom de fichier sûr (sans accents, sans « / », 60 caractères au plus). */
export function segmentNom(s, max = 60) {
  const t = txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/[-.]*\.\.[-.]*/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return t.slice(0, max).replace(/[-.]+$/g, "");
}

/** Nom du fichier ZIP proposé au téléchargement. */
export function nomZip({ chantierNom, version, date }) {
  return `Dossier-controle-${segmentNom(chantierNom) || "chantier"}-v${Number.isInteger(version) ? version : "x"}-${txt(date).slice(0, 10) || "date"}.zip`;
}

/** Document confidentiel ? (type aptitude médicale ou marqué confidentiel). */
export const estConfidentiel = (j) => !!j && (j.confidentiel === true || j.type_code === TYPE_JUSTIFICATIF_CONFIDENTIEL);

/**
 * Dernière version validée (numéro le plus haut parmi les versions figées).
 * @returns {{ ok: true, version } | { ok: false, raison }} raison = texte du
 *   bouton désactivé.
 */
export function derniereVersionPourDossier(versions) {
  if (!Array.isArray(versions)) return { ok: false, raison: "versions illisibles : dossier impossible pour l'instant" };
  const v = [...versions].filter((x) => x && Number.isInteger(x.version)).sort((a, b) => b.version - a.version)[0];
  if (!v) return { ok: false, raison: "aucune version validée : validez d'abord la fiche" };
  if (!v.pdf_path) return { ok: false, raison: `le PDF de la v${v.version} n'est pas généré : générez-le d'abord` };
  if (v.empreinteVerifiee === false) return { ok: false, raison: `le contenu figé de la v${v.version} ne correspond plus à son empreinte : dossier refusé` };
  if (!estObjet(v.contenu) || !FORMATS_CONTENU_LISIBLES.includes(v.contenu.format)) return { ok: false, raison: `contenu figé de la v${v.version} illisible` };
  return { ok: true, version: v };
}

/**
 * Aptitudes médicales à joindre pour un ADMIN : actives, non expirées à la date
 * du dossier, rattachées aux points concernés (selon le contenu figé) qui
 * attendent ce type. Pour un non-admin : toujours [].
 */
export function aptitudesRattachees({ contenu, aptitudes, aujourdhui, estAdmin }) {
  if (estAdmin !== true || !estObjet(contenu)) return [];
  const points = POINTS_FICHE.filter((p) => pointEstConcerne(contenu.reponses, p)
    && p.justificatifs.some((j) => j.type_code === TYPE_JUSTIFICATIF_CONFIDENTIEL));
  if (!points.length) return [];
  return liste(aptitudes)
    .filter((a) => a && a.portee === "entreprise" && a.type_code === TYPE_JUSTIFICATIF_CONFIDENTIEL && estJustificatifActif(a) && !estExpire(a, aujourdhui))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((a) => ({ ...a, point: points[0].numero }));
}

const pt = (n) => `P${String(Number(n) || 0).padStart(2, "0")}`;

/**
 * Plan du dossier.
 * @param {object} p
 * @param {object}  p.version     ligne de version AVEC contenu (sortie ok de derniereVersionPourDossier)
 * @param {string}  p.chantierNom
 * @param {boolean} p.estAdmin
 * @param {Array}   p.aptitudes   aptitudes médicales lues (admin seulement ; ignorées sinon)
 * @param {string}  p.aujourdhui  AAAA-MM-JJ
 * @returns {{ fichiers: Array<{ nom, bucket, path, libelle }> }}
 *   Ordre : PDF, justificatifs du chantier, espace entreprise, confidentiel.
 */
export function planDossierControle({ version, chantierNom, estAdmin, aptitudes = [], aujourdhui }) {
  const contenu = version.contenu;
  const pris = new Set();
  const unique = (nom) => {
    if (!pris.has(nom.toLowerCase())) { pris.add(nom.toLowerCase()); return nom; }
    const i = nom.lastIndexOf("."), base = i > 0 ? nom.slice(0, i) : nom, ext = i > 0 ? nom.slice(i) : "";
    for (let k = 2; ; k++) { const c = `${base}-${k}${ext}`; if (!pris.has(c.toLowerCase())) { pris.add(c.toLowerCase()); return c; } }
  };
  const nomDoc = (dossier, j) => {
    const fichier = segmentNom(j.fichier_nom) || segmentNom(String(j.fichier_path || "").split("/").pop()) || "document";
    const parts = [pt(j.point), segmentNom(libelleJustificatif(j.type_code), 40), segmentNom(j.personne, 30), fichier].filter(Boolean);
    return unique(`${dossier}/${parts.join("_")}`);
  };
  const fichiers = [{
    nom: unique(`00_Fiche-securite-${segmentNom(chantierNom) || "chantier"}-v${version.version}.pdf`),
    bucket: BUCKET_PREUVES, path: version.pdf_path, libelle: `PDF de la fiche validée (v${version.version})`,
  }];
  const garder = (j) => estObjet(j) && txt(j.fichier_path) && (estAdmin === true || !estConfidentiel(j));
  const tri = (a, b) => (Number(a.point) || 0) - (Number(b.point) || 0) || String(a.id).localeCompare(String(b.id));
  for (const j of liste(contenu.justificatifs).filter(garder).sort(tri)) {
    fichiers.push({ nom: nomDoc("Chantier", j), bucket: estConfidentiel(j) ? BUCKET_CONFIDENTIEL : BUCKET_DOCUMENTS, path: j.fichier_path, libelle: `${libelleJustificatif(j.type_code)} (point ${j.point})` });
  }
  const vus = new Set();
  for (const j of liste(contenu.justificatifs_entreprise).filter(garder).sort(tri)) {
    if (vus.has(j.id)) continue; // un même document rattaché à plusieurs points : un seul fichier
    vus.add(j.id);
    fichiers.push({ nom: nomDoc("Espace-entreprise", j), bucket: estConfidentiel(j) ? BUCKET_CONFIDENTIEL : BUCKET_DOCUMENTS, path: j.fichier_path, libelle: `${libelleJustificatif(j.type_code)}${j.personne ? ` — ${txt(j.personne)}` : ""} (espace entreprise)` });
  }
  for (const a of aptitudesRattachees({ contenu, aptitudes, aujourdhui, estAdmin })) {
    if (!txt(a.fichier_path)) continue;
    fichiers.push({ nom: nomDoc("Confidentiel", a), bucket: BUCKET_CONFIDENTIEL, path: a.fichier_path, libelle: `${libelleJustificatif(a.type_code)}${a.personne ? ` — ${txt(a.personne)}` : ""} (confidentiel)` });
  }
  return { fichiers };
}

/**
 * Contenu de A_LIRE.txt quand des fichiers n'ont pas pu être lus.
 * @param {Array<{ nom, libelle, raison }>} manquants
 */
export function texteALire({ manquants, chantierNom, version, date }) {
  const l = liste(manquants);
  return [
    `Dossier de contrôle — ${txt(chantierNom) || "chantier"} — fiche sécurité v${version}`,
    `Préparé le ${txt(date)}.`,
    "",
    `ATTENTION : ${l.length} document${l.length > 1 ? "s" : ""} n'${l.length > 1 ? "ont" : "a"} pas pu être lu${l.length > 1 ? "s" : ""} et ne figure${l.length > 1 ? "nt" : ""} pas dans ce dossier :`,
    ...l.map((m) => `- ${m.libelle} (fichier prévu : ${m.nom}) : ${txt(m.raison) || "lecture impossible"}`),
    "",
    "Les retrouver dans l'application (fiche sécurité du chantier ou page « Justificatifs entreprise ») avant de présenter le dossier.",
    "",
  ].join("\r\n");
}

// ─── ZIP « stocké » ──────────────────────────────────────────────────────────

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (polynôme ZIP) d'un tableau d'octets. */
export function crc32(octets) {
  let c = 0xffffffff;
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Date et heure au format DOS, à partir de « AAAA-MM-JJTHH:MM:SS » (heure locale fournie par l'appelant). */
function dosDateHeure(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(txt(iso));
  if (!m) return { date: (1 << 5) | 1, heure: 0 }; // 1980-01-01
  const [a, mo, j, h = 0, mi = 0, s = 0] = m.slice(1).map((x) => Number(x || 0));
  return { date: (((Math.max(a, 1980) - 1980) & 0x7f) << 9) | (mo << 5) | j, heure: (h << 11) | (mi << 5) | Math.floor(s / 2) };
}

/**
 * ZIP sans compression.
 * @param {Array<{ nom: string, octets: Uint8Array }>} fichiers
 * @param {string} horodatage  « AAAA-MM-JJTHH:MM:SS » (aucune horloge ici)
 * @returns {Uint8Array}
 */
export function zipStocke(fichiers, horodatage) {
  const enc = new TextEncoder();
  const { date, heure } = dosDateHeure(horodatage);
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const f of fichiers) {
    const nom = enc.encode(f.nom);
    const data = f.octets instanceof Uint8Array ? f.octets : new Uint8Array(f.octets || []);
    const crc = crc32(data);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
    loc.setUint16(10, heure, true); loc.setUint16(12, date, true); loc.setUint32(14, crc, true);
    loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, nom.length, true); loc.setUint16(28, 0, true);
    locaux.push(new Uint8Array(loc.buffer), nom, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, heure, true); cen.setUint16(14, date, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nom.length, true);
    cen.setUint16(30, 0, true); cen.setUint16(32, 0, true); cen.setUint16(34, 0, true); cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true); cen.setUint32(42, decalage, true);
    centraux.push(new Uint8Array(cen.buffer), nom);
    decalage += 30 + nom.length + data.length;
  }
  if (decalage > 0xffffffff || fichiers.length > 0xffff) throw new Error("Dossier trop volumineux pour un ZIP simple (4 Go).");
  const tailleCentral = centraux.reduce((s, x) => s + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); fin.setUint16(4, 0, true); fin.setUint16(6, 0, true);
  fin.setUint16(8, fichiers.length, true); fin.setUint16(10, fichiers.length, true);
  fin.setUint32(12, tailleCentral, true); fin.setUint32(16, decalage, true); fin.setUint16(20, 0, true);
  const morceaux = [...locaux, ...centraux, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(morceaux.reduce((s, x) => s + x.length, 0));
  let i = 0;
  for (const m of morceaux) { out.set(m, i); i += m.length; }
  return out;
}
