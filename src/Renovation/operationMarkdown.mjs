// ─────────────────────────────────────────────────────────────────────────────
// operationMarkdown — GÉNÉRATEUR du fichier Markdown « opération complète »,
// destiné à être déposé comme source dans un projet ChatGPT.
//
// Module PUR : aucun réseau, aucun React, aucune horloge, aucune dépendance npm.
// Tout arrive par le « modèle d'export » construit par operationExportData.js.
// Couvert par scripts/verif-operation-markdown.mjs.
//
// RÈGLES DU DOCUMENT — elles priment sur toute considération de mise en page :
//
//  1. RIEN N'EST INVENTÉ. Une donnée absente s'écrit « Non renseigné » (dans un
//     tableau) ou « Aucune information enregistrée. » (pour une section vide).
//     Jamais de null/undefined/[object Object]/NaN, jamais de résumé déduit.
//  2. AUCUN CHIFFRE N'EST RECALCULÉ ICI. Les montants, heures et avancements
//     arrivent déjà calculés par computeChantierFinance (la source de vérité de
//     l'application) ; ce module ne fait que les mettre en forme, avec les
//     MÊMES formateurs que l'écran (eur / fmtH de chantierFinance).
//  3. AUCUNE URL SIGNÉE, AUCUN JETON, AUCUN CHEMIN DE STOCKAGE. Des documents
//     on n'écrit que les métadonnées (nom, type, date, auteur).
//  4. L'ORDRE ENREGISTRÉ EST L'ORDRE IMPRIMÉ. Les chantiers suivent l'ordre du
//     référentiel, les phases leur `ordre`, les tâches leur `chrono_ordre`.
//     Aucun tri alphabétique de confort.
//  5. UNE VALEUR SAISIE NE DOIT JAMAIS CASSER LE DOCUMENT : les barres
//     verticales sont échappées dans les cellules, les retours à la ligne
//     écrasés, le HTML retiré, les titres vides remplacés.
// ─────────────────────────────────────────────────────────────────────────────
import { eur, fmtH } from "../chantierFinance.mjs";
import { HORIZON_ECHEANCES_JOURS } from "./operationExportModele.mjs";

export const ND = "Non renseigné";
export const AUCUNE = "Aucune information enregistrée.";
export const VERSION_EXPORT = 1;

// ─── 1. NETTOYAGE ET FORMATAGE ───────────────────────────────────────────────

const estVide = (v) =>
  v === null || v === undefined
  || (typeof v === "number" && !Number.isFinite(v))
  || (typeof v === "string" && v.trim() === "");

// Retire les balises HTML et décode les entités courantes. `&amp;` est traité
// EN DERNIER : l'inverse transformerait « &amp;lt; » en « < ».
export function sansHtml(valeur) {
  return String(valeur ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u202f\u2007\u2060]/g, " ")
    // Caractères de contrôle : invisibles mais capables de casser un éditeur.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, "");
}

// Texte affichable. Un objet ne s'écrit JAMAIS tel quel ([object Object]) ;
// un tableau devient une énumération de ses éléments affichables.
export function txt(valeur, defaut = ND) {
  if (estVide(valeur)) return defaut;
  if (typeof valeur === "boolean") return valeur ? "Oui" : "Non";
  if (Array.isArray(valeur)) {
    const items = valeur.map((v) => txt(v, "")).filter((s) => s !== "");
    return items.length > 0 ? items.join(", ") : defaut;
  }
  if (typeof valeur === "object") return defaut;
  const s = sansHtml(valeur).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s === "" ? defaut : s;
}

// Cellule de tableau : une seule ligne, barres verticales échappées, longueur
// bornée (un commentaire de 4 000 signes rendrait le tableau illisible).
export function cellule(valeur, { defaut = ND, max = 300 } = {}) {
  let s = txt(valeur, defaut)
    .replace(/\n+/g, " · ")
    .replace(/\|/g, "\\|")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (s === "") s = defaut;
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}

// Bloc de texte long : les paragraphes sont conservés, le reste nettoyé.
// Renvoie "" si rien à dire (l'appelant décide alors d'écrire AUCUNE).
export function bloc(valeur) {
  const s = txt(valeur, "");
  return s === "" ? "" : s;
}

const nombreOuNull = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function nombre(valeur, unite = "", { defaut = ND, decimales = 2 } = {}) {
  const n = nombreOuNull(valeur);
  if (n === null) return defaut;
  const s = n.toLocaleString("fr-FR", { maximumFractionDigits: decimales });
  return unite ? `${s} ${unite}` : s;
}

// Montant CALCULÉ : arrondi à l'euro, comme partout dans l'application (eur()).
// Un total d'export qui ne tomberait pas sur le chiffre affiché à l'écran
// serait pire qu'inutile.
export function euros(valeur, { defaut = ND } = {}) {
  const n = nombreOuNull(valeur);
  return n === null ? defaut : eur(n);
}

// Montant SAISI ou reçu tel quel (montant d'une facture, acompte encaissé du
// cycle de vie…). Les centimes en font partie : les arrondir ferait perdre
// l'information exacte que quelqu'un a enregistrée. Un montant rond reste
// écrit sans décimales.
export function montantExact(valeur, { defaut = ND } = {}) {
  const n = nombreOuNull(valeur);
  if (n === null) return defaut;
  const entier = Math.round(n * 100) % 100 === 0;
  return `${n.toLocaleString("fr-FR", {
    minimumFractionDigits: entier ? 0 : 2,
    maximumFractionDigits: 2,
  })} €`;
}

export function heures(valeur, { defaut = ND } = {}) {
  const n = nombreOuNull(valeur);
  return n === null ? defaut : `${fmtH(n)} h`;
}

export function pourcent(valeur, { defaut = ND, decimales = 0 } = {}) {
  const n = nombreOuNull(valeur);
  return n === null ? defaut : `${n.toLocaleString("fr-FR", { maximumFractionDigits: decimales })} %`;
}

// Date au format français, SANS objet Date : une chaîne « 2026-09-18 » ne doit
// pas glisser d'un jour selon le fuseau de la machine.
// Accepte « YYYY-MM-DD[…] », « DD/MM/YYYY » (rapports.date_rapport) et
// « DD-MM-YYYY ». Toute autre forme est rendue telle quelle (nettoyée).
export function dateFR(valeur, { defaut = ND } = {}) {
  if (estVide(valeur)) return defaut;
  const s = String(valeur).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const fr = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (fr) return `${fr[1]}/${fr[2]}/${fr[3]}`;
  return txt(s, defaut);
}

// Date + heure. L'heure n'est affichée que si l'horodatage en porte une.
export function dateHeureFR(valeur, { defaut = ND } = {}) {
  if (estVide(valeur)) return defaut;
  const s = String(valeur).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return dateFR(s, { defaut });
  return `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}`;
}

// Nom de fichier compatible Windows : accents dépliés, caractères interdits
// retirés, espaces en tirets, longueur bornée, noms de périphériques réservés
// neutralisés (CON, PRN, AUX, NUL, COM1-9, LPT1-9).
const RESERVES_WINDOWS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export function assainirNomFichier(valeur, { max = 60, defaut = "operation" } = {}) {
  let s = sansHtml(valeur)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/['’`]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_. ]+$/g, "")
    .slice(0, max)
    .replace(/^[-_.]+|[-_. ]+$/g, "");
  if (s === "") s = defaut;
  if (RESERVES_WINDOWS.test(s)) s = `_${s}`;
  return s;
}

export function nomFichierMarkdownOperation(nomOperation, dateISO) {
  const base = assainirNomFichier(nomOperation);
  const jour = /^\d{4}-\d{2}-\d{2}/.test(String(dateISO ?? "")) ? String(dateISO).slice(0, 10) : "";
  return `${base}_operation-complete${jour ? `_${jour}` : ""}.md`;
}

// ─── 2. BRIQUES MARKDOWN ─────────────────────────────────────────────────────

// Valeur de frontmatter YAML : toujours entre guillemets doubles, guillemets et
// antislashs échappés, retours à la ligne écrasés. Un nom d'opération contenant
// « " » ne doit pas casser l'analyse YAML du fichier.
export function yamlValeur(valeur) {
  const s = txt(valeur, "").replace(/\n+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${s}"`;
}

// Titre jamais vide (règle 5 : « éviter les titres vides »).
const titre = (niveau, texte, defaut) => `${"#".repeat(niveau)} ${txt(texte, defaut)}`;

// Une cellule ne portant aucune information. `cellule()` a déjà remplacé le
// vide par « Non renseigné » : c'est ce marqueur qu'on reconnaît ici.
const celluleVide = (v) => {
  const s = String(v ?? "").trim();
  return s === "" || s === ND || s === "—";
};

/**
 * Tableau Markdown.
 * `colonnes` = [{ t: en-tête, a: "l"|"c"|"r", garder: true }]
 * `lignes`   = tableau de tableaux de chaînes DÉJÀ passées par cellule().
 *
 * DEUX RÈGLES ANTI-BRUIT, la raison d'être de cette fonction :
 *  1. une colonne dont AUCUNE ligne ne porte de valeur est retirée. Écrire
 *     « Non renseigné » cent-six fois dans une colonne « Dépendances » vide
 *     n'informe de rien et noie le reste ; la colonne disparaît, et la section
 *     le signale. `garder: true` protège les colonnes dont l'absence est en
 *     elle-même une information (adresse, date de démarrage, montant d'une
 *     facture existante, responsable d'une action ouverte).
 *  2. une LIGNE entièrement vide n'est pas écrite.
 *
 * Retour : { lignes, colonnesRetirees } — le générateur décide s'il mentionne
 * les colonnes retirées.
 */
export function construireTableau(colonnes, lignes, { defaut = AUCUNE } = {}) {
  const cols = (colonnes || []).filter(Boolean);
  const brutes = (Array.isArray(lignes) ? lignes : [])
    .filter((l) => Array.isArray(l) && l.some((v) => !celluleVide(v)));
  if (brutes.length === 0) return { lignes: defaut === null ? [] : [defaut], colonnesRetirees: [] };

  const garde = cols.map((c, i) => c.garder === true || brutes.some((l) => !celluleVide(l[i])));
  const colonnesRetirees = cols.filter((_, i) => !garde[i]).map((c) => txt(c.t, "—"));
  const gardees = cols.filter((_, i) => garde[i]);
  // Tout retirer laisserait un tableau sans colonne : on garde alors la
  // première, pour que les lignes restent rattachables.
  const finales = gardees.length > 0 ? gardees : cols.slice(0, 1);
  const index = cols.map((_, i) => i).filter((i) => (gardees.length > 0 ? garde[i] : i === 0));

  const sep = finales.map((c) => (c.a === "r" ? "---:" : c.a === "c" ? ":---:" : "---"));
  return {
    lignes: [
      `| ${finales.map((c) => cellule(c.t, { defaut: "—" })).join(" | ")} |`,
      `|${sep.join("|")}|`,
      ...brutes.map((l) => `| ${index.map((i) => l[i] ?? ND).join(" | ")} |`),
    ],
    colonnesRetirees,
  };
}

// Forme courte : seulement les lignes du tableau.
export function tableau(colonnes, lignes, options) {
  return construireTableau(colonnes, lignes, options).lignes;
}

/**
 * Liste à puces « label : valeur ».
 *
 * Une paire peut s'écrire [label, valeur] ou [label, valeur, { garder: true }].
 * Par défaut une valeur absente est SILENCIEUSEMENT OMISE : un champ secondaire
 * vide n'a rien à dire. `garder: true` force l'affichage avec « Non renseigné »
 * pour les absences qui, elles, sont des informations.
 * Si tout est vide, la liste vaut « Aucune information enregistrée. ».
 */
export function listeDefinitions(paires, { defaut = AUCUNE } = {}) {
  const lignes = (paires || [])
    .filter(Boolean)
    .map(([label, valeur, opts]) => {
      const rendu = cellule(valeur, { max: 600 });
      if (celluleVide(rendu) && !(opts && opts.garder === true)) return null;
      return `- **${txt(label, "—")}** : ${rendu}`;
    })
    .filter(Boolean);
  return lignes.length > 0 ? lignes : (defaut === null ? [] : [defaut]);
}

// Paragraphes d'un texte long, préservés tels quels (règle 5).
export function paragraphes(valeur) {
  const b = bloc(valeur);
  if (b === "") return [];
  return b.split(/\n{2,}/).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join("  \n"));
}

// Section : titre + contenu, ou titre + « Aucune information enregistrée. ».
function section(niveau, nom, contenu) {
  const corps = (Array.isArray(contenu) ? contenu : [contenu]).filter((l) => l !== null && l !== undefined);
  return [titre(niveau, nom, "Section"), "", ...(corps.length > 0 ? corps : [AUCUNE]), ""];
}

// ─── 3. GÉNÉRATEUR ───────────────────────────────────────────────────────────

const pluriel = (n, singulier, plurielMot) => `${n} ${n > 1 ? (plurielMot || `${singulier}s`) : singulier}`;

// ── MARGES : nommer ce qui est mesuré ────────────────────────────────────────
// `margeChantier` de computeChantierFinance est le vendu moins les coûts
// ENREGISTRÉS à l'instant T. Sur un chantier à 0 % d'avancement, presque aucun
// coût n'est engagé : l'indicateur frôle alors 100 % du vendu et n'a aucune
// valeur prédictive. Le calcul n'est pas touché — seul son nom l'est, et une
// mise en garde l'accompagne tant que l'avancement est faible.
const LABEL_MARGE_PROVISOIRE = "Marge provisoire sur coûts enregistrés";
// En dessous de ce seuil d'avancement, la marge provisoire est trompeuse.
const SEUIL_AVANCEMENT_MARGE_FIABLE = 20;

function avertissementMarge(avancement, vendu) {
  const av = typeof avancement === "number" ? avancement : parseFloat(avancement);
  if (!(vendu > 0) || !Number.isFinite(av) || av >= SEUIL_AVANCEMENT_MARGE_FIABLE) return [];
  return [
    "",
    `> **Attention** : la « ${LABEL_MARGE_PROVISOIRE.toLowerCase()} » n'est pas`,
    `> représentative de la marge finale — l'avancement n'est que de ${pourcent(av)} et`,
    "> la majorité des coûts n'est pas encore engagée. Pour la préparation, c'est la",
    "> **marge prévisionnelle au devis** qui fait foi.",
  ];
}

// ── ADRESSE DE L'OPÉRATION ───────────────────────────────────────────────────
// Une adresse déduite des chantiers n'est pas une adresse enregistrée sur
// l'opération : le libellé le dit, il n'est jamais présenté comme une saisie.
function adresseOperation(op) {
  const a = op?.adresse;
  // Compatibilité : un modèle ancien passait une simple chaîne.
  if (typeof a === "string" || a === null || a === undefined) {
    return { label: "Adresse principale", valeur: a || null, liste: [] };
  }
  if (a.origine === "operation") return { label: "Adresse principale", valeur: a.valeur, liste: a.liste || [] };
  if (a.origine === "chantiers") {
    return {
      label: "Adresse principale déduite des chantiers",
      valeur: a.valeur,
      liste: a.liste || [],
      note: "L'opération elle-même n'a pas d'adresse enregistrée ; tous ses chantiers partagent celle-ci.",
    };
  }
  if (a.origine === "multisite") {
    return {
      label: "Adresses des chantiers (opération multisite)",
      valeur: (a.liste || []).join(" · "),
      liste: a.liste || [],
      note: "L'opération n'a pas d'adresse enregistrée et ses chantiers sont à des adresses différentes.",
    };
  }
  return { label: "Adresse principale", valeur: null, liste: [] };
}

/**
 * Construit le document Markdown complet d'une opération.
 * @param {object} modele  modèle d'export (voir operationExportData.js)
 * @returns {string} le fichier Markdown, prêt à être téléchargé en UTF-8.
 */
export function construireMarkdownOperation(modele) {
  const m = modele || {};
  const op = m.operation || {};
  const gen = m.genere || {};
  const agg = m.agg || {};
  const chantiers = Array.isArray(m.chantiers) ? m.chantiers : [];
  const erreurs = Array.isArray(gen.erreurs) ? gen.erreurs : [];
  const restrictions = Array.isArray(gen.restrictions) ? gen.restrictions : [];
  // Une source en panne ET une source fermée au rôle rendent toutes deux le
  // document incomplet — mais pas pour la même raison, et le lecteur doit
  // pouvoir les distinguer.
  const complet = erreurs.length === 0 && restrictions.length === 0;

  const L = [];
  const push = (...lignes) => lignes.forEach((l) => L.push(l));

  const adresseOp = adresseOperation(op);

  // ── Frontmatter YAML ──
  push(
    "---",
    "type: operation_profero",
    `version_export: ${VERSION_EXPORT}`,
    `operation_id: ${yamlValeur(op.id)}`,
    // Aucune référence métier n'existe au niveau opération : recopier
    // l'identifiant technique laisserait croire à un numéro de dossier.
    ...(op.reference ? [`reference: ${yamlValeur(op.reference)}`] : ["reference: null"]),
    `nom: ${yamlValeur(op.nom)}`,
    `nombre_chantiers: ${chantiers.length}`,
    `exporte_le: ${yamlValeur(gen.le)}`,
    `export_complet: ${complet ? "true" : "false"}`,
    ...(erreurs.length > 0 ? [`sources_en_erreur: ${erreurs.length}`] : []),
    ...(restrictions.length > 0 ? [`sections_non_accessibles: ${restrictions.length}`] : []),
    'application: "Profero"',
    "---",
    "",
  );

  // ── Titre + avertissement d'instantané ──
  push(
    titre(1, `Opération — ${txt(op.nom, "sans nom")}`, "Opération"),
    "",
    "> Document généré automatiquement par l'application Profero.",
    `> Il constitue un instantané des informations enregistrées au ${txt(gen.leFr)}.`,
    "> Les informations peuvent évoluer après cette date.",
    "",
  );

  if (erreurs.length > 0) {
    push(
      "> [!ATTENTION] **Export incomplet.** Les sources suivantes n'ont pas pu être lues ;",
      "> les sections qui en dépendent sont vides ou partielles :",
      ...erreurs.map((e) => `> - ${cellule(e, { max: 400 })}`),
      "",
    );
  }
  if (restrictions.length > 0) {
    push(
      "> [!ATTENTION] **Document partiel : certaines catégories ne sont pas accessibles",
      "> au compte qui a lancé l'export.** Ce n'est pas une panne — l'application les",
      "> réserve à d'autres rôles. Un export lancé par un compte habilité les contiendra :",
      ...restrictions.map((r) => `> - ${cellule(r, { max: 400 })}`),
      "",
    );
  }

  // ── 1. Synthèse ──
  const statuts = m.statutsLabels || {};
  const repartition = Object.entries(op.statuts || {})
    .map(([id, n]) => `${n} ${txt(statuts[id] || id).toLowerCase()}`)
    .join(", ");
  push(...section(2, "1. Synthèse de l'opération", [
    ...listeDefinitions([
      ["Opération", op.nom],
      [adresseOp.label, adresseOp.valeur, { garder: true }],
      ["Nombre de chantiers rattachés", chantiers.length === 0 ? "0" : String(chantiers.length)],
      ["Répartition par statut", repartition],
      ["Chantiers chiffrés (avec phasage)", `${agg.nbAvecPhasage ?? 0} sur ${agg.nbChantiers ?? chantiers.length}`],
      ["Avancement global (pondéré par le vendu HT)", pourcent(agg.avancement), { garder: true }],
      ["Vendu HT", euros(agg.vendu), { garder: true }],
      // La marge AU DEVIS vient en premier : c'est l'indicateur de pilotage.
      ["Marge prévisionnelle au devis", agg.vendu > 0
        ? `${euros(agg.margePrev)} (${pourcent(agg.margePrevPct, { decimales: 1 })})` : null, { garder: true }],
      [LABEL_MARGE_PROVISOIRE, agg.vendu > 0
        ? `${euros(agg.marge)} (${pourcent(agg.margePct, { decimales: 1 })})` : null],
      ["Heures réelles / heures vendues", `${heures(agg.hReelles)} / ${heures(agg.hVendues)}`],
      ["Période de travaux planifiée", m.bornes?.debut || m.bornes?.fin
        ? `${dateFR(m.bornes.debut)} → ${dateFR(m.bornes.fin)}` : null],
    ]),
    ...avertissementMarge(agg.avancement, agg.vendu),
    "",
    "Méthode de calcul : chaque chantier est passé par le module de calcul unique de",
    "l'application (`computeChantierFinance`), puis les montants sont sommés.",
    "L'avancement de l'opération est pondéré par le vendu HT de chaque chantier —",
    "jamais une moyenne simple.",
  ]));

  // ── 2. Informations générales ──
  push(...section(2, "2. Informations générales", [
    ...listeDefinitions([
      ["Identifiant interne de l'opération", op.id],
      ["Nom", op.nom],
      [adresseOp.label, adresseOp.valeur, { garder: true }],
      ["Nombre total de chantiers", String(chantiers.length)],
      ["Vendu HT", euros(agg.vendu), { garder: true }],
      ["Main-d'œuvre prévisionnelle", euros(agg.moPrev)],
      ["Matériaux prévisionnels", euros(agg.matPrev)],
      ["Frais généraux prévisionnels", euros(agg.fgPrev)],
      ["Marge prévisionnelle au devis", euros(agg.margePrev), { garder: true }],
      ["Coût main-d'œuvre enregistré à ce jour", euros(agg.moReel)],
      ["Coût matériaux enregistré à ce jour", euros(agg.mat)],
      ["Frais généraux enregistrés à ce jour", euros(agg.fg)],
      [LABEL_MARGE_PROVISOIRE, euros(agg.marge)],
      ["Heures vendues", heures(agg.hVendues)],
      ["Heures réelles", heures(agg.hReelles)],
      ["Date de l'export", txt(gen.leFr)],
    ]),
    ...(adresseOp.note ? ["", adresseOp.note] : []),
    "",
    "L'application ne stocke ni description, ni conducteur de travaux, ni référence",
    "de dossier au niveau de l'opération : ces champs n'existent pas et ne sont donc",
    "pas absents par oubli de saisie.",
  ]));

  // ── 3. Client, contacts et intervenants ──
  const contacts = Array.isArray(m.contacts) ? m.contacts : [];
  const intervenants = Array.isArray(m.intervenants) ? m.intervenants : [];
  push(...section(2, "3. Client, contacts et intervenants", [
    ...(contacts.length > 0 ? [
      "### Clients enregistrés (issus du chiffrage rattaché)",
      "",
      ...tableau(
        [{ t: "Chantier" }, { t: "Client" }, { t: "Société" }, { t: "Téléphone" }, { t: "Email" }, { t: "Adresse" }],
        contacts.map((c) => [
          cellule(c.chantierNom), cellule(c.nom), cellule(c.societe),
          cellule(c.telephone), cellule(c.email), cellule(c.adresse),
        ]),
      ),
      "",
    ] : [
      "Aucun client n'est rattaché à ces chantiers dans l'application (le référentiel",
      "client vit dans le module Chiffrage, relié au chantier uniquement lorsqu'un",
      "devis y a été rattaché).",
      "",
    ]),
    "### Intervenants (équipes affectées aux phases)",
    "",
    ...tableau(
      [{ t: "Équipe" }, { t: "Nature" }, { t: "Responsable(s)" }, { t: "Membres" }, { t: "Chantiers concernés" }],
      intervenants.map((e) => [
        cellule(e.nom),
        // La nature vient du référentiel des équipes : l'équipe « Externe »
        // regroupe des prestataires, elle n'a ni responsable ni membre interne.
        cellule(e.externe === true ? "Prestataire externe"
          : e.externe === false ? "Équipe interne" : "Nature non renseignée au référentiel"),
        cellule(e.responsables), cellule(e.membres), cellule(e.chantiers),
      ]),
    ),
  ]));

  // ── 4. Contraintes, accès et consignes ──
  const consignes = Array.isArray(m.consignes) ? m.consignes : [];
  push(...section(2, "4. Contraintes, accès et consignes", [
    ...(consignes.length > 0 ? [
      ...tableau(
        [{ t: "Chantier" }, { t: "Source" }, { t: "Contenu" }],
        consignes.map((n) => [cellule(n.chantierNom), cellule(n.source), cellule(n.contenu, { max: 600 })]),
      ),
      "",
      "Le détail intégral de ces notes figure dans la fiche de chaque chantier.",
    ] : [
      "Aucune contrainte d'accès ni consigne particulière n'est enregistrée pour les",
      "chantiers de cette opération (notes de chantier et notes de planning vides).",
    ]),
  ]));

  // ── 5. Liste des chantiers ──
  push(...section(2, "5. Liste des chantiers", tableau(
    // Adresse et dates de démarrage : leur absence est une information, elles
    // restent affichées même vides (règle `garder`).
    [
      { t: "Chantier" }, { t: "Référence" }, { t: "Adresse", garder: true }, { t: "Statut" },
      { t: "Avancement", a: "r" }, { t: "Début prévu", garder: true }, { t: "Fin prévue" }, { t: "Équipe" },
    ],
    chantiers.map((c) => [
      cellule(c.nom),
      cellule(c.id),
      cellule(c.adresse),
      cellule(c.statutLabel),
      cellule(c.finance ? pourcent(c.finance.avancementChantier) : ND),
      cellule(dateFR(c.planning?.debut)),
      cellule(dateFR(c.planning?.fin)),
      cellule(c.equipes),
    ]),
  )));

  // ── 6. Planning général ──
  push(...section(2, "6. Planning général de l'opération", [
    ...listeDefinitions([
      ["Première date de travaux planifiée", dateFR(m.bornes?.debut)],
      ["Dernière date de travaux planifiée", dateFR(m.bornes?.fin)],
    ]),
    "",
    ...tableau(
      [
        { t: "Chantier" }, { t: "Début prévu", garder: true }, { t: "Fin prévue" },
        { t: "Phases", a: "r" }, { t: "Tâches", a: "r" }, { t: "Tâches datées", a: "r" },
        { t: "Avancement", a: "r" },
      ],
      chantiers.map((c) => [
        cellule(c.nom),
        cellule(dateFR(c.planning?.debut)),
        cellule(dateFR(c.planning?.fin)),
        cellule(String((c.phases || []).length)),
        cellule(String(c.nbTaches ?? 0)),
        cellule(String(c.nbTachesDatees ?? 0)),
        cellule(c.finance ? pourcent(c.finance.avancementChantier) : ND),
      ]),
    ),
    "",
    "L'ordre des phases est celui enregistré dans le plan de travaux du chantier",
    "(`plan_travaux.meta.chrono_groupes`) ; il n'est jamais réordonné ici.",
  ]));

  // ── 7. Équipes et affectations ──
  const affectations = Array.isArray(m.affectations) ? m.affectations : [];
  push(...section(2, "7. Équipes et affectations", [
    "### Heures réellement pointées par ouvrier",
    "",
    ...tableau(
      [{ t: "Ouvrier" }, { t: "Heures", a: "r" }, { t: "Coût main-d'œuvre", a: "r" }, { t: "Chantiers" }],
      affectations.map((o) => [
        cellule(o.nom), cellule(heures(o.heures)), cellule(euros(o.cout)), cellule(o.chantiers),
      ]),
    ),
    "",
    "### Équipes rattachées aux phases",
    "",
    ...tableau(
      [{ t: "Chantier" }, { t: "Phase" }, { t: "Équipe" }, { t: "Ouvriers affectés aux tâches" }],
      chantiers.flatMap((c) => (c.phases || []).map((p) => [
        cellule(c.nom), cellule(p.nom), cellule(p.equipeNom), cellule(p.ouvriers),
      ])),
    ),
  ]));

  // ── 8. Approvisionnements et commandes transversales ──
  const cmd = Array.isArray(m.commandes) ? m.commandes : [];
  const besoins = Array.isArray(m.besoins) ? m.besoins : [];
  push(...section(2, "8. Approvisionnements et commandes transversales", [
    "### Commandes passées (toutes chantiers de l'opération)",
    "",
    ...tableau(
      [
        { t: "Date" }, { t: "Fournisseur" }, { t: "Document" }, { t: "Chantier" },
        { t: "Article" }, { t: "Référence" }, { t: "Quantité", a: "r" },
        { t: "PU HT", a: "r" }, { t: "Total HT", a: "r" }, { t: "Statut" },
      ],
      cmd.map((l) => [
        cellule(dateFR(l.date)), cellule(l.fournisseur), cellule(l.document), cellule(l.chantierNom),
        cellule(l.libelle), cellule(l.reference),
        cellule(l.quantite === null ? ND : nombre(l.quantite, l.unite || "")),
        cellule(euros(l.prixUnitaire)), cellule(euros(l.prixTotal)), cellule(l.statut),
      ]),
    ),
    "",
    ...(cmd.length > 0
      ? [`Total des lignes de commande de l'opération : **${euros(m.totalCommandes)}**.`, ""]
      : []),
    "### Besoins matériaux exprimés par les équipes",
    "",
    ...tableau(
      [
        { t: "Chantier" }, { t: "Article" }, { t: "Quantité", a: "r" }, { t: "Demandeur" },
        { t: "Priorité" }, { t: "Statut" }, { t: "Demandé le" }, { t: "Note" },
      ],
      besoins.map((b) => [
        cellule(b.chantierNom), cellule(b.article),
        cellule(b.quantite === null ? ND : nombre(b.quantite, b.unite || "")),
        cellule(b.demandeur), cellule(b.priorite), cellule(b.statut),
        cellule(dateFR(b.date)), cellule(b.notes),
      ]),
    ),
  ]));

  // ── 9. Avancement général ──
  push(...section(2, "9. Avancement général", [
    ...tableau(
      [
        { t: "Chantier" }, { t: "Statut" }, { t: "Avancement", a: "r", garder: true },
        { t: "Vendu HT", a: "r", garder: true }, { t: "Marge prév. au devis", a: "r", garder: true },
        { t: "Coût MO enregistré", a: "r" }, { t: "Matériaux enregistrés", a: "r" },
        { t: "Marge provisoire", a: "r" }, { t: "Marge provisoire %", a: "r" },
        { t: "Heures réelles / vendues", a: "r" },
      ],
      chantiers.map((c) => {
        const b = c.finance;
        if (!b) return [cellule(c.nom), cellule(c.statutLabel), ...Array(7).fill("Sans phasage")];
        return [
          cellule(c.nom), cellule(c.statutLabel), cellule(pourcent(b.avancementChantier)),
          cellule(b.prixHTChantier > 0 ? euros(b.prixHTChantier) : ND),
          cellule(b.prixHTChantier > 0 ? euros(b.margePrevChantier) : ND),
          cellule(euros(b.coutMOTotalChantier)), cellule(euros(b.coutMatChantier)),
          cellule(b.prixHTChantier > 0 ? euros(b.margeChantier) : ND),
          cellule(b.prixHTChantier > 0 ? pourcent(b.margePctChantier, { decimales: 1 }) : ND),
          cellule(`${heures(b.heuresReellesTotalChantier)} / ${heures(b.heuresVenduesChantier)}`),
        ];
      }),
    ),
    "",
    `**Total opération** — avancement ${pourcent(agg.avancement)} · vendu ${euros(agg.vendu)} · `
    + `marge prévisionnelle au devis ${euros(agg.margePrev)} · coût MO enregistré ${euros(agg.moReel)} · `
    + `matériaux enregistrés ${euros(agg.mat)} · ${LABEL_MARGE_PROVISOIRE.toLowerCase()} ${euros(agg.marge)} `
    + `(${pourcent(agg.margePct, { decimales: 1 })}) · heures ${heures(agg.hReelles)} / ${heures(agg.hVendues)}.`,
    ...avertissementMarge(agg.avancement, agg.vendu),
  ]));

  // ── 10. Points de vigilance ──
  const alertes = Array.isArray(m.alertes) ? m.alertes : [];
  const reserves = Array.isArray(m.reservesOuvertes) ? m.reservesOuvertes : [];
  const actions = Array.isArray(m.actions) ? m.actions : [];
  push(...section(2, "10. Points de vigilance, problèmes et décisions", [
    "### Alertes calculées par l'application",
    "",
    ...tableau(
      [{ t: "Chantier" }, { t: "Gravité" }, { t: "Alerte" }],
      alertes.map((a) => [cellule(a.chantierNom), cellule(a.gravite), cellule(a.message, { max: 400 })]),
    ),
    "",
    "### Réserves ouvertes (contrôles de groupe)",
    "",
    ...tableau(
      [{ t: "Chantier" }, { t: "Groupe" }, { t: "Tâche" }, { t: "Commentaire" }, { t: "Auteur" }, { t: "Ouverte le" }],
      reserves.map((r) => [
        cellule(r.chantierNom), cellule(r.groupeNom), cellule(r.tacheNom),
        cellule(r.commentaire, { max: 400 }), cellule(r.auteur), cellule(dateFR(r.date)),
      ]),
    ),
    "",
    "### Actions à réaliser (tâches partagées rattachées à un chantier)",
    "",
    ...tableau(
      // Une action ouverte sans responsable ni échéance est un risque : ces
      // deux colonnes restent visibles même quand elles sont vides partout.
      [
        { t: "Chantier" }, { t: "Action" }, { t: "Responsable(s)", garder: true },
        { t: "Échéance", garder: true }, { t: "Priorité" }, { t: "Statut" },
      ],
      actions.map((t) => [
        cellule(t.chantierNom), cellule(t.texte), cellule(t.assignes),
        cellule(dateFR(t.echeance)), cellule(t.priorite), cellule(t.statut),
      ]),
    ),
  ]));

  // ── 11. Documents disponibles ──
  const docs = Array.isArray(m.documents) ? m.documents : [];
  push(...section(2, "11. Documents disponibles", [
    ...tableau(
      [{ t: "Chantier" }, { t: "Document" }, { t: "Catégorie" }, { t: "Type" }, { t: "Date" }, { t: "Déposé par" }],
      docs.map((d) => [
        cellule(d.chantierNom), cellule(d.nom), cellule(d.categorie),
        cellule(d.type), cellule(dateFR(d.date)), cellule(d.auteur),
      ]),
    ),
    "",
    "> **Les fichiers eux-mêmes ne sont pas inclus dans cet export.** Seules les",
    "> métadonnées sont listées ci-dessus. Les plans, photos, PDF de devis, PV de",
    "> réception et autres documents importants doivent être ajoutés séparément",
    "> comme sources du projet ChatGPT.",
  ]));

  // ── Détail des chantiers ──
  push(titre(1, "Détail des chantiers", "Détail des chantiers"), "");
  if (chantiers.length === 0) {
    push("Aucun chantier n'est rattaché à cette opération.", "");
  }
  chantiers.forEach((c, i) => {
    push("---", "");
    push(...ficheChantier(c, i + 1, m));
  });

  push("---", "");
  push(
    `*Fin du document — ${pluriel(chantiers.length, "chantier")}, généré par Profero le ${txt(gen.leFr)}.*`,
    "",
  );

  // Une seule ligne vide consécutive au maximum : le fichier reste lisible.
  // Les espaces insécables (fins ou non) du formatage fr-FR sont ramenés à
  // l'espace ordinaire : invisibles à l'écran, ils font diverger deux textes
  // identiques et surprennent à la relecture d'un fichier .md. La règle vaut
  // pour TOUT le document, prose comprise — sansHtml l'applique déjà aux
  // valeurs, ce passage final couvre les phrases assemblées ici.
  return `${L.join("\n").replace(/[\u00a0\u202f\u2007\u2060]/g, " ").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// ─── 4. FICHE D'UN CHANTIER ──────────────────────────────────────────────────

// Largeur des colonnes de texte long dans les tableaux. Au-delà, le tableau
// devient illisible pour un humain ; le texte intégral est alors restitué
// ailleurs, en bloc (voir descriptionsOuvrages).
const LARGEUR_INTITULE = 120;
const LARGEUR_REFERENCE = 80;

// Descriptions intégrales des ouvrages : tout ce que le tableau a dû tronquer,
// plus le libellé de devis et la fiche de bibliothèque quand ils existent.
function descriptionsOuvrages(ouvrages) {
  // Le numéro est celui de la LIGNE du tableau ci-dessus : c'est lui qui permet
  // de faire le lien, beaucoup d'ouvrages n'ayant pas de code renseigné.
  const aDetailler = (ouvrages || [])
    .map((o, i) => ({ o, n: i + 1 }))
    .filter(({ o }) => (o.libelle && o.libelle.length > LARGEUR_INTITULE) || o.libelleDevis || o.bibliothequeLibelle);
  if (aDetailler.length === 0) return [];
  return [
    "### Descriptions complètes des ouvrages",
    "",
    ...aDetailler.flatMap(({ o, n }) => {
      const titreOuvrage = o.code ? `Ouvrage ${n} — ${txt(o.code)}` : `Ouvrage ${n}`;
      const defs = [
        ["Lot", o.lotLabel],
        ["Quantité", o.quantite == null ? null : nombre(o.quantite, o.unite || "")],
        ["Prix de vente HT", o.prixHT == null ? null : euros(o.prixHT)],
        ["Libellé de devis", o.libelleDevis],
        ["Fiche de bibliothèque", o.bibliothequeLibelle],
        ["Cadence de référence", o.cadence == null ? null : `${nombre(o.cadence)} h / ${txt(o.cadenceUnite, "unité")}`],
        ["Coefficient de vente référencé", o.coefficientVente == null ? null : nombre(o.coefficientVente)],
        ["Taux horaire de vente référencé", o.tauxHoraireVente == null ? null : nombre(o.tauxHoraireVente, "€/h")],
      ].filter(([, v]) => v !== null && v !== undefined);
      return [
        `#### ${titreOuvrage}`,
        "",
        ...paragraphes(o.libelle),
        "",
        ...(defs.length > 0 ? [...listeDefinitions(defs), ""] : []),
      ];
    }),
  ];
}

function ficheChantier(c, rang, m) {
  const out = [];
  const push = (...l) => l.forEach((x) => out.push(x));
  const b = c.finance;

  push(titre(1, `Chantier ${rang} — ${txt(c.nom, "sans nom")}`, `Chantier ${rang}`), "");

  // Informations générales. Adresse et date de démarrage restent affichées
  // même absentes (leur absence bloque la préparation) ; les réglages
  // secondaires du phasage disparaissent quand ils ne sont pas renseignés.
  push(...section(2, "Informations générales", listeDefinitions([
    ["Identifiant interne", c.id],
    ["Nom", c.nom],
    ["Opération de rattachement", m.operation?.nom],
    ["Adresse", c.adresse, { garder: true }],
    ["Statut", c.statutLabel],
    ["Avancement global", b ? pourcent(b.avancementChantier) : "Sans phasage — aucun avancement calculable", { garder: true }],
    ["Équipe(s) affectée(s)", c.equipes],
    ["Début prévu", dateFR(c.planning?.debut), { garder: true }],
    ["Fin prévue", dateFR(c.planning?.fin)],
    ["Phasage enregistré", c.phasage?.id ? `oui (modifié le ${dateHeureFR(c.phasage.updatedAt)})` : "non", { garder: true }],
    ["Montant de devis saisi", c.phasage ? euros(c.phasage.montantDevis) : null],
    ["Taux de frais généraux", c.phasage && c.phasage.fgTauxHoraire != null
      ? nombre(c.phasage.fgTauxHoraire, "€/h") : null],
    ["Marge vendue cible", c.phasage && c.phasage.margeCible != null ? pourcent(c.phasage.margeCible) : null],
    ["Reprise d'antériorité", c.phasage && (c.phasage.repriseHeures || c.phasage.repriseTaux)
      ? `${heures(c.phasage.repriseHeures)} à ${nombre(c.phasage.repriseTaux, "€/h")}` : null],
    ["Phase du cycle de vie", c.cycleVie?.phaseLabel],
  ])));

  // Devis, lots et ouvrages
  const ouvrages = Array.isArray(c.ouvrages) ? c.ouvrages : [];
  push(...section(2, "Devis, lots et ouvrages", [
    ...(Array.isArray(c.lots) && c.lots.length > 0 ? [
      "### Lots",
      "",
      ...tableau(
        [
          { t: "Lot" }, { t: "Ouvrages", a: "r" }, { t: "Heures vendues", a: "r" },
          { t: "Heures réelles", a: "r" }, { t: "Avancement", a: "r" }, { t: "Dérive", a: "r" },
        ],
        c.lots.map((l) => [
          cellule(l.label), cellule(String(l.nbOuvrages)),
          cellule(heures(l.heuresVendues)), cellule(heures(l.heuresReelles)),
          cellule(pourcent(l.avancement)),
          cellule(l.ratioDerive == null ? ND : `×${nombre(l.ratioDerive, "", { decimales: 2 })}`),
        ]),
      ),
      "",
    ] : []),
    "### Ouvrages",
    "",
    ...tableau(
      [
        { t: "N°", a: "r" }, { t: "Code" }, { t: "Intitulé" }, { t: "Lot" }, { t: "Unité" }, { t: "Quantité", a: "r" },
        { t: "Prix vente HT", a: "r" }, { t: "Coût matériaux prévu", a: "r" },
        { t: "Heures devis", a: "r" }, { t: "Heures estimées", a: "r" }, { t: "Heures réelles", a: "r" },
        { t: "Coût MO réel", a: "r" }, { t: "Avancement", a: "r" }, { t: "Sous-tâches", a: "r" },
      ],
      ouvrages.map((o, i) => [
        cellule(String(i + 1)),
        cellule(o.code), cellule(o.libelle, { max: LARGEUR_INTITULE }), cellule(o.lotLabel), cellule(o.unite),
        cellule(nombre(o.quantite)), cellule(euros(o.prixHT)), cellule(euros(o.coutMateriaux)),
        cellule(heures(o.heuresDevis)), cellule(heures(o.heuresEstimees)), cellule(heures(o.heuresReelles)),
        cellule(euros(o.coutMOReel)), cellule(pourcent(o.avancement)), cellule(String((o.taches || []).length)),
      ]),
    ),
    "",
    // Les descriptions d'ouvrage font couramment 300 à 800 signes (elles
    // reprennent le texte du devis). Tronquées dans le tableau pour qu'il reste
    // lisible, elles sont restituées ICI en entier : l'export ne perd rien.
    ...descriptionsOuvrages(ouvrages),
    ...conditionsChiffrage(c),
  ]));

  // Sous-tâches des ouvrages — RÉCAPITULATIF SEULEMENT.
  // Le détail complet de chaque tâche (ratio, heures, dates, ouvriers,
  // dépendances) est écrit UNE SEULE FOIS, dans « Plan de travaux et tâches ».
  // Le répéter ici triplait le volume du fichier sans rien apprendre de plus.
  const recapOuvrages = ouvrages.filter((o) => (o.taches || []).length > 0);
  push(...section(2, "Sous-tâches des ouvrages (récapitulatif)", [
    ...tableau(
      [
        { t: "Ouvrage (réf.)" }, { t: "Sous-tâches", a: "r" }, { t: "H. estimées", a: "r" },
        { t: "H. vendues", a: "r" }, { t: "H. réelles", a: "r" }, { t: "Avancement", a: "r" },
        { t: "Phases traversées" },
      ],
      recapOuvrages.map((o) => {
        const ts = o.taches || [];
        const somme = (cle) => ts.reduce((s, t) => s + (t[cle] || 0), 0);
        return [
          cellule(o.reference), cellule(String(ts.length)),
          cellule(heures(somme("heuresEstimees"))), cellule(heures(somme("heuresVendues"))),
          cellule(heures(somme("heuresReelles"))), cellule(pourcent(o.avancement)),
          cellule([...new Set(ts.map((t) => t.phaseNom).filter(Boolean))]),
        ];
      }),
    ),
    ...(recapOuvrages.length > 0 ? [
      "",
      "**Le détail de chaque sous-tâche** — ordre d'exécution, ratio, heures, date",
      "prévue, ouvriers et dépendances — figure dans la section « Plan de travaux et",
      "tâches » ci-dessous, classé par phase : c'est la liste de référence, elle",
      "n'est écrite qu'une fois. La colonne « Ouvrage (réf.) » y renvoie au numéro de",
      "ligne du tableau des ouvrages ci-dessus.",
    ] : []),
  ]));

  // Matériaux prévisionnels
  const mats = Array.isArray(c.materiaux) ? c.materiaux : [];
  push(...section(2, "Matériaux prévisionnels", [
    ...tableau(
      [
        { t: "Ouvrage (réf.)" }, { t: "Matériau" }, { t: "Référence" }, { t: "Fournisseur" },
        { t: "Unité" }, { t: "Qté / unité d'ouvrage", a: "r" }, { t: "Qté prévisionnelle", a: "r" },
        { t: "Qté commandée", a: "r" }, { t: "Statut" }, { t: "Marqué commandé le" },
      ],
      mats.map((x) => [
        cellule(x.ouvrageRef), cellule(x.nom), cellule(x.reference), cellule(x.fournisseur),
        cellule(x.unite), cellule(nombre(x.quantiteParUnite)), cellule(nombre(x.quantiteTotale)),
        cellule(x.quantiteCommandee === null ? ND : nombre(x.quantiteCommandee)),
        cellule(x.statut), cellule(dateFR(x.commandeLe)),
      ]),
    ),
    ...(mats.length > 0 ? [
      "",
      "Les quantités commandées proviennent des lignes de commande rattachées à",
      "l'ouvrage ou au matériau ; « Non renseigné » signifie qu'aucune ligne n'a été",
      "trouvée, pas qu'il reste zéro à commander.",
    ] : []),
    ...(c.suggestionsMateriaux?.length > 0 ? [
      "",
      "### Matériaux signalés manquants par les équipes",
      "",
      ...tableau(
        [
          { t: "Désignation" }, { t: "Référence" }, { t: "Fournisseur" }, { t: "Ouvrage" },
          { t: "Quantité", a: "r" }, { t: "Précision" }, { t: "Signalé par" },
          { t: "Statut" }, { t: "Signalé le" },
        ],
        c.suggestionsMateriaux.map((s) => [
          cellule(s.designation), cellule(s.reference), cellule(s.fournisseur),
          cellule(s.ouvrage, { max: LARGEUR_REFERENCE }),
          cellule(nombre(s.quantite, s.unite || "")),
          cellule(s.precision), cellule(s.auteur), cellule(s.statut), cellule(dateFR(s.date)),
        ]),
      ),
    ] : []),
  ]));

  // Plan de travaux et tâches — LISTE CANONIQUE.
  // C'est ici, et nulle part ailleurs, que chaque tâche est décrite en entier.
  // Les autres sections s'y réfèrent. Colonnes du tableau de tâches : celles
  // qui restent vides d'un bout à l'autre d'une phase disparaissent d'elles-
  // mêmes (règle de construireTableau), la date prévue restant toujours
  // affichée — une tâche sans date ne partira jamais.
  const phases = Array.isArray(c.phases) ? c.phases : [];
  const colonnesTache = [
    { t: "Ordre", a: "r" }, { t: "Tâche" }, { t: "Ouvrage (réf.)" },
    { t: "Date prévue", garder: true }, { t: "Ratio", a: "r" },
    { t: "H. estimées", a: "r" }, { t: "H. vendues", a: "r" }, { t: "H. réelles", a: "r" },
    { t: "Avancement", a: "r" }, { t: "État" }, { t: "Ouvriers" }, { t: "Dépendances" },
  ];
  const ligneTache = (t) => [
    cellule(t.ordre === null || t.ordre === undefined ? ND : String(t.ordre)),
    cellule(t.nom), cellule(t.ouvrageRef), cellule(dateFR(t.datePrevue)),
    // Le ratio est un POURCENTAGE de l'ouvrage : sans son unité, « 25 » se lit
    // comme des heures ou une quantité.
    cellule(t.ratio === null || t.ratio === undefined ? ND : pourcent(t.ratio)),
    cellule(heures(t.heuresEstimees)), cellule(heures(t.heuresVendues)), cellule(heures(t.heuresReelles)),
    cellule(pourcent(t.avancement)), cellule(t.etat), cellule(t.ouvriers), cellule(t.dependances),
  ];
  push(...section(2, "Plan de travaux et tâches", [
    ...(phases.length === 0 && !(c.tachesHorsPhase?.length > 0) ? [AUCUNE] : []),
    ...phases.flatMap((p, i) => {
      const t = construireTableau(colonnesTache, (p.taches || []).map(ligneTache), { defaut: null });
      return [
        `### Phase ${i + 1} — ${txt(p.nom, "sans nom")}`,
        "",
        ...listeDefinitions([
          ["Ordre enregistré", p.ordre === null || p.ordre === undefined ? null : String(p.ordre)],
          ["Groupe type", p.groupeTypeNom],
          ["Équipe", p.equipeNom ? `${p.equipeNom}${p.equipeExterne === true ? " (prestataire externe)" : ""}` : null],
          ["Tâches", `${p.nbTaches ?? 0} (dont ${p.nbTachesDatees ?? 0} datée(s))`, { garder: true }],
          ["Heures estimées / vendues", `${heures(p.heuresEstimees)} / ${heures(p.heuresVendues)}`],
          ["Avancement", pourcent(p.avancement), { garder: true }],
          ["Terminée", p.termine ? "Oui" : "Non"],
          ["Période", p.debut || p.fin ? `${dateFR(p.debut)} → ${dateFR(p.fin)}` : null],
          ["Dernier contrôle", p.controle
            ? `${dateFR(p.controle.date)} — ${p.controle.nbConformes}/${p.controle.nbTaches} conformes (${txt(p.controle.auteur)})` : null],
        ]),
        "",
        ...(t.lignes.length > 0 ? t.lignes : ["Aucune tâche rattachée à cette phase."]),
        ...(t.colonnesRetirees.length > 0
          ? ["", `*Colonnes sans aucune valeur sur cette phase, retirées : ${t.colonnesRetirees.join(", ")}.*`]
          : []),
        "",
      ];
    }),
    ...(c.tachesHorsPhase?.length > 0 ? (() => {
      const t = construireTableau(colonnesTache, c.tachesHorsPhase.map(ligneTache), { defaut: null });
      return [
        "### Tâches non rattachées à une phase (« à organiser »)",
        "",
        ...t.lignes,
        ...(t.colonnesRetirees.length > 0
          ? ["", `*Colonnes sans aucune valeur, retirées : ${t.colonnesRetirees.join(", ")}.*`] : []),
        "",
      ];
    })() : []),
    ...(c.jalons?.length > 0 ? [
      "### Jalons",
      "",
      ...tableau(
        [{ t: "Jalon" }, { t: "Type" }, { t: "Phase rattachée" }, { t: "Date" }],
        c.jalons.map((j) => [cellule(j.nom), cellule(j.type), cellule(j.groupeNom), cellule(dateFR(j.date))]),
      ),
      "",
    ] : []),
  ]));

  // Planning prévisionnel
  push(...section(2, "Planning prévisionnel", [
    ...(c.previsionnel?.blocs?.length > 0 ? [
      ...(c.previsionnel.livraison ? [`**Livraison annoncée : ${cellule(c.previsionnel.livraison)}**`, ""] : []),
      ...c.previsionnel.blocs.flatMap((bl) => [
        `**${cellule(bl.titre)}**`,
        ...(bl.lignes || []).map((x) => `- ${cellule(x, { max: 400 })}`),
        "",
      ]),
      ...(c.previsionnel.note ? paragraphes(c.previsionnel.note) : []),
    ] : [
      "Aucun planning prévisionnel client n'est rédigé pour ce chantier.",
    ]),
    "",
    "### Semaines planifiées (planning hebdomadaire)",
    "",
    ...tableau(
      [{ t: "Semaine" }, { t: "Jour" }, { t: "Prévu" }, { t: "Réalisé" }, { t: "Ouvriers" }],
      (c.planningCells || []).map((x) => [
        cellule(x.semaine), cellule(x.jour), cellule(x.planifie), cellule(x.reel), cellule(x.ouvriers),
      ]),
    ),
  ]));

  // Équipes et affectations
  push(...section(2, "Équipes et affectations", [
    ...tableau(
      [{ t: "Ouvrier" }, { t: "Heures pointées", a: "r" }, { t: "Coût", a: "r" }, { t: "Taux horaire", a: "r" }],
      (c.ouvriersHeures || []).map((o) => [
        cellule(o.nom), cellule(heures(o.heures)), cellule(euros(o.cout)),
        cellule(o.taux ? nombre(o.taux, "€/h") : ND),
      ]),
    ),
    "",
    ...(b ? listeDefinitions([
      ["Heures vendues", heures(b.heuresVenduesChantier)],
      ["Heures réelles (total, trajets et indirect compris)", heures(b.heuresReellesTotalChantier)],
      ["Heures pointées sur les tâches du plan", heures(b.heuresReellesChantier)],
      ["Heures de trajet", heures(b.trajetHeures)],
      ["Heures indirectes hors trajet", heures(b.indirectHeures)],
      ["Heures restantes estimées", heures(b.heuresRestantes)],
    ]) : []),
  ]));

  // Avancement réel
  push(...section(2, "Avancement réel", [
    ...(b ? listeDefinitions([
      ["Avancement global", pourcent(b.avancementChantier)],
      ["Vendu HT", euros(b.prixHTChantier)],
      ["Écart avec le montant de devis saisi", b.montantDevis ? euros(b.ecartVendu) : null],
      ["Coût main-d'œuvre réel", euros(b.coutMOTotalChantier)],
      ["Coût matériaux réel (commandes)", euros(b.coutMatChantier)],
      ["Matériaux prévus au devis", euros(b.commandesPrevChantier)],
      ["Frais généraux", euros(b.fgChantier)],
      ["Marge nette", `${euros(b.margeChantier)} (${pourcent(b.margePctChantier, { decimales: 1 })})`],
      ["Marge prévisionnelle", `${euros(b.margePrevChantier)} (${pourcent(b.margePrevPctChantier, { decimales: 1 })})`],
      ["Reste à faire", `${heures(b.heuresRestantes)} · ${euros(b.resteAFaireEuros)}`],
      ["Marge à terminaison (projection)", euros(b.margeATerminaison)],
      ["Situation à facturer (projection)", b.situationAFacturer == null ? "% facturé non disponible" : euros(b.situationAFacturer)],
      ["Reste à commander (projection)", b.resteACommander == null ? "bibliothèque matériaux non chargée" : euros(b.resteACommander)],
    ]) : ["Ce chantier n'a pas de phasage exploitable : aucun chiffre n'est calculable."]),
    "",
    ...(c.avancementHistorique?.length > 0 ? [
      "### Historique d'avancement",
      "",
      ...tableau(
        [{ t: "Date" }, { t: "Avancement", a: "r" }, { t: "Tâches terminées", a: "r" }],
        c.avancementHistorique.map((h) => [
          cellule(dateFR(h.date)), cellule(pourcent(h.avancement)),
          cellule(`${h.tachesTerminees ?? ND} / ${h.tachesTotal ?? ND}`),
        ]),
      ),
      "",
    ] : []),
    ...(c.heuresParMois?.length > 0 ? [
      "### Heures par mois",
      "",
      ...tableau(
        [{ t: "Mois" }, { t: "Heures", a: "r" }, { t: "Coût", a: "r" }, { t: "Ouvriers" }],
        c.heuresParMois.map((x) => [
          cellule(x.label), cellule(heures(x.heures)), cellule(euros(x.cout)), cellule(x.ouvriers),
        ]),
      ),
    ] : []),
  ]));

  // Comptes rendus chantier
  const rapports = Array.isArray(c.rapports) ? c.rapports : [];
  push(...section(2, "Comptes rendus chantier", [
    ...(rapports.length === 0 ? [AUCUNE] : rapports.flatMap((r) => [
      `### ${dateFR(r.date)} — ${txt(r.ouvrier, "auteur inconnu")}`,
      "",
      ...listeDefinitions([
        ["Statut du rapport", r.statut],
        ["Validé par", r.validePar],
        ["Heures déclarées", heures(r.heures)],
        ["Trajet", r.trajetMin ? `${nombre(r.trajetMin, "min")}` : null],
        ["Photos jointes", r.nbPhotos > 0 ? `${r.nbPhotos} (non incluses dans cet export)` : "aucune"],
      ]),
      "",
      ...(r.taches?.length > 0 ? [
        ...tableau(
          [{ t: "Tâche déclarée" }, { t: "Statut" }, { t: "Avancement", a: "r" }, { t: "Heures", a: "r" }, { t: "Remarque" }],
          r.taches.map((t) => [
            cellule(t.libelle), cellule(t.statut), cellule(pourcent(t.avancement)),
            cellule(heures(t.heures)), cellule(t.remarque, { max: 400 }),
          ]),
        ),
        "",
      ] : []),
      ...(bloc(r.remarque) ? ["**Remarque :**", "", ...paragraphes(r.remarque), ""] : []),
    ])),
  ]));

  // Visites et observations
  const visites = Array.isArray(c.visites) ? c.visites : [];
  push(...section(2, "Visites et observations", [
    ...(visites.length === 0 ? [AUCUNE] : visites.flatMap((v) => [
      `### Visite du ${dateFR(v.date)}`,
      "",
      ...listeDefinitions([
        ["Intervenant", v.intervenant],
        ["Statut", v.statut],
        ["Météo", v.meteo],
        ["Lots audités", v.nbLots ? String(v.nbLots) : null],
      ]),
      "",
      ...(bloc(v.note) ? ["**Note générale :**", "", ...paragraphes(v.note), ""] : []),
      ...(v.observations?.length > 0 ? [
        ...tableau(
          [{ t: "Ouvrage / point" }, { t: "Élément" }, { t: "Statut" }, { t: "Commentaire" }],
          v.observations.map((o) => [
            cellule(o.ouvrage, { max: LARGEUR_REFERENCE }), cellule(o.nom), cellule(o.statut), cellule(o.commentaire, { max: 400 }),
          ]),
        ),
        "",
      ] : []),
    ])),
  ]));

  // Commandes et approvisionnements
  push(...section(2, "Commandes et approvisionnements", [
    ...tableau(
      [
        { t: "Date" }, { t: "Fournisseur" }, { t: "Document" }, { t: "Article" },
        { t: "Référence" }, { t: "Quantité", a: "r" }, { t: "PU HT", a: "r" },
        { t: "Total HT", a: "r" }, { t: "Ouvrage (réf.)" }, { t: "Statut" },
      ],
      (c.commandes || []).map((l) => [
        cellule(dateFR(l.date)), cellule(l.fournisseur), cellule(l.document), cellule(l.libelle),
        cellule(l.reference), cellule(l.quantite === null ? ND : nombre(l.quantite, l.unite || "")),
        cellule(euros(l.prixUnitaire)), cellule(euros(l.prixTotal)),
        cellule(l.ouvrageRef), cellule(l.statut),
      ]),
    ),
    "",
    ...((c.commandes || []).length > 0
      ? [`Total des commandes de ce chantier : **${euros(c.totalCommandes)}**.`, ""]
      : []),
    "### Besoins exprimés",
    "",
    ...tableau(
      [{ t: "Article" }, { t: "Quantité", a: "r" }, { t: "Demandeur" }, { t: "Priorité" }, { t: "Statut" }, { t: "Demandé le" }],
      (c.besoins || []).map((x) => [
        cellule(x.article), cellule(x.quantite === null ? ND : nombre(x.quantite, x.unite || "")),
        cellule(x.demandeur), cellule(x.priorite), cellule(x.statut), cellule(dateFR(x.date)),
      ]),
    ),
  ]));

  // Problèmes, blocages et décisions
  push(...section(2, "Problèmes, blocages et décisions", [
    "### Alertes de l'application",
    "",
    ...tableau(
      [{ t: "Gravité" }, { t: "Alerte" }],
      (c.alertes || []).map((a) => [cellule(a.gravite), cellule(a.message, { max: 500 })]),
    ),
    "",
    "### Réserves",
    "",
    ...tableau(
      [{ t: "Groupe" }, { t: "Tâche" }, { t: "État" }, { t: "Commentaire" }, { t: "Auteur" }, { t: "Ouverte le" }, { t: "Levée le" }],
      (c.reserves || []).map((r) => [
        cellule(r.groupeNom), cellule(r.tacheNom), cellule(r.statut),
        cellule(r.commentaire, { max: 400 }), cellule(r.auteur),
        cellule(dateFR(r.date)), cellule(dateFR(r.leveeLe)),
      ]),
    ),
    "",
    "### Contrôles de groupe réalisés",
    "",
    ...tableau(
      [{ t: "Groupe" }, { t: "Date" }, { t: "Auteur" }, { t: "Tâches contrôlées", a: "r" }, { t: "Conformes", a: "r" }],
      (c.controles || []).map((x) => [
        cellule(x.groupeNom), cellule(dateFR(x.date)), cellule(x.auteur),
        cellule(x.nbTaches === null ? ND : String(x.nbTaches)),
        cellule(x.nbConformes === null ? ND : String(x.nbConformes)),
      ]),
    ),
    "",
    "### Décisions et étapes validées (cycle de vie)",
    "",
    ...tableau(
      [{ t: "Phase" }, { t: "Étape" }, { t: "État" }, { t: "Date" }, { t: "Auteur" }, { t: "Données saisies" }],
      (c.cycleVie?.etapes || []).map((e) => [
        cellule(e.phaseNom), cellule(e.nom), cellule(e.fait ? "Validée" : "À faire"),
        cellule(dateFR(e.date)), cellule(e.auteur), cellule(donneesEtape(e.donnees)),
      ]),
    ),
    ...(c.notes?.length > 0 ? [
      "",
      "### Notes de chantier",
      "",
      ...c.notes.flatMap((n) => [`**${cellule(n.source)}** (${dateHeureFR(n.date)}) :`, "", ...paragraphes(n.contenu), ""]),
    ] : []),
  ]));

  // Actions restantes et prochaines échéances
  push(...section(2, "Actions restantes et prochaines échéances", [
    "### Tâches partagées ouvertes",
    "",
    ...tableau(
      // Une action ouverte sans responsable ni échéance appelle une décision :
      // ces deux colonnes restent visibles même vides partout.
      [
        { t: "Action" }, { t: "Responsable(s)", garder: true }, { t: "Échéance", garder: true },
        { t: "Priorité" }, { t: "Statut" }, { t: "Note" },
      ],
      (c.todos || []).map((t) => [
        cellule(t.texte), cellule(t.assignes), cellule(dateFR(t.echeance)),
        cellule(t.priorite), cellule(t.statut), cellule(t.note, { max: 300 }),
      ]),
    ),
    "",
    `### Tâches du plan qui appellent une décision (retard, sans date, ou sous ${HORIZON_ECHEANCES_JOURS} jours)`,
    "",
    ...tableau(
      [
        { t: "Motif" }, { t: "Date prévue", garder: true }, { t: "Phase" }, { t: "Tâche" },
        { t: "Ouvrage (réf.)" }, { t: "Avancement", a: "r" }, { t: "Ouvriers" },
      ],
      (c.echeances || []).map((t) => [
        cellule(t.motif), cellule(dateFR(t.datePrevue)), cellule(t.phaseNom), cellule(t.nom),
        cellule(t.ouvrageRef), cellule(pourcent(t.avancement)), cellule(t.ouvriers),
      ]),
    ),
    "",
    ...((c.nbTachesAVenirHorsEcheances || 0) > 0 ? [
      `${pluriel(c.nbTachesAVenirHorsEcheances, "autre tâche non terminée est planifiée", `autres tâches non terminées sont planifiées`)} `
      + `au-delà de ${HORIZON_ECHEANCES_JOURS} jours : elles figurent, en détail, dans « Plan de travaux et tâches ».`,
      "",
    ] : []),
    "### Prochaine étape du cycle de vie",
    "",
    c.cycleVie?.prochaine
      ? `- **${cellule(c.cycleVie.prochaine.nom)}** (phase ${cellule(c.cycleVie.prochaine.phaseNom)}) — ${cellule(c.cycleVie.prochaine.hint, { max: 400 })}`
      : AUCUNE,
  ]));

  // Données budgétaires
  push(...section(2, "Données budgétaires", [
    ...(b ? [
      ...tableau(
        [{ t: "Poste" }, { t: "Prévu au devis", a: "r" }, { t: "Enregistré à ce jour", a: "r" }],
        [
          ["Vendu HT", euros(b.prixHTChantier), euros(b.prixHTChantier)],
          ["Main-d'œuvre", euros(b.moPrevChantier), euros(b.coutMOTotalChantier)],
          ["Matériaux", euros(b.commandesPrevChantier), euros(b.coutMatChantier)],
          ["Frais généraux", euros(b.fgPrevChantier), euros(b.fgChantier)],
          ["Marge", euros(b.margePrevChantier), euros(b.margeChantier)],
          ["Heures", heures(b.heuresVenduesChantier), heures(b.heuresReellesTotalChantier)],
        ].map((r) => r.map((x) => cellule(x))),
      ),
      "",
      "La colonne « Enregistré à ce jour » ne contient que les coûts déjà saisis :",
      `la ligne Marge y est donc la « ${LABEL_MARGE_PROVISOIRE.toLowerCase()} », pas la marge finale.`,
      ...avertissementMarge(b.avancementChantier, b.prixHTChantier),
      "",
      ...listeDefinitions([
        ["Taux de main-d'œuvre prévisionnel appliqué", nombre(b.tauxMOPrevEff, "€/h")],
        ["Taux de frais généraux appliqué", b.fgTauxHoraire > 0 ? nombre(b.fgTauxHoraire, "€/h") : "non réglé"],
        ["Déboursé prévisionnel", euros(b.deboursePrevChantier)],
        ["Montant de devis saisi", b.montantDevis ? euros(b.montantDevis) : null],
      ]),
      "",
      ...facturationChantier(c.facturation),
      "Tous ces montants proviennent du module de calcul unique de l'application ;",
      "aucun n'est recalculé pour cet export.",
    ] : ["Ce chantier n'a pas de phasage exploitable : aucune donnée budgétaire n'est calculable."]),
  ]));

  // Documents disponibles
  push(...section(2, "Documents disponibles", [
    ...tableau(
      [{ t: "Document" }, { t: "Catégorie" }, { t: "Type" }, { t: "Date" }, { t: "Déposé par" }],
      (c.documents || []).map((d) => [
        cellule(d.nom), cellule(d.categorie), cellule(d.type), cellule(dateFR(d.date)), cellule(d.auteur),
      ]),
    ),
    "",
    "> Fichiers non inclus : seules les métadonnées sont listées. Ajouter les plans,",
    "> photos et PDF utiles directement comme sources du projet ChatGPT.",
  ]));

  return out;
}

// ── DONNÉES SAISIES SUR UNE ÉTAPE DU CYCLE DE VIE ────────────────────────────
// Elles arrivent typées (date / montant / nombre / booléen / liste). Aucune
// paire clé-valeur brute ni JSON ne doit apparaître dans le document :
// « montant : 20210.62 » devient « Montant : 20 210,62 € ».
export function donneesEtape(donnees) {
  const liste = Array.isArray(donnees) ? donnees : [];
  if (liste.length === 0) return null;
  const rendues = liste.map((d) => {
    // Compatibilité : un modèle plus ancien passait des chaînes déjà formées.
    if (typeof d === "string") return d;
    const label = txt(d?.label || d?.cle, "Donnée");
    const v = d?.valeur;
    const valeur = d?.type === "date" ? dateFR(v)
      : d?.type === "montant" ? montantExact(v)
        : d?.type === "nombre" ? nombre(v)
          : d?.type === "booleen" ? (v ? "Oui" : "Non")
            : d?.type === "liste" ? txt(Array.isArray(v) ? v : [v])
              : txt(v);
    return `${label} : ${valeur}`;
  }).filter(Boolean);
  return rendues.length > 0 ? rendues.join(" · ") : null;
}

// ── FACTURATION CLIENT ───────────────────────────────────────────────────────
//
// Deux familles de factures cohabitent et ne se mesurent pas de la même façon :
// les factures ProGBat sont en TTC (leur montant HT est volontairement vide en
// base, il ne décrit pas le HT exigible), les factures saisies à la main sont
// en HT. Le tableau porte donc une colonne « Base » et ne mélange jamais les
// deux dans un total.
//
// UN MONTANT INCONNU N'EST PAS ZÉRO : une facture sans montant est listée,
// comptée à part, et le total annonce qu'il ne porte que sur les montants
// connus — jamais un « 0 € » qui ferait croire à l'absence de facturation.
function facturationChantier(f) {
  if (!f || !Array.isArray(f.lignes) || f.lignes.length === 0) return [];
  const sansMontant = f.lignes.filter((l) => !l.montantConnu).length;
  const totaux = [];

  if (f.progbat) {
    const p = f.progbat;
    if (p.sansMontant > 0 && p.nb === p.sansMontant) {
      totaux.push(`- **Factures ProGBat** : total non calculable, le montant des ${p.nb} factures est manquant.`);
    } else if (p.sansMontant > 0) {
      totaux.push(`- **Factures ProGBat** — total des montants connus : ${montantExact(p.totalTTC)} TTC `
        + `(${pluriel(p.sansMontant, "facture est écartée", "factures sont écartées")} du total, montant manquant).`);
    } else {
      totaux.push(`- **Factures ProGBat** — total facturé : ${montantExact(p.totalTTC)} TTC · `
        + `réglé ${montantExact(p.totalRegle)} · reste ${montantExact(p.reste)}.`);
    }
    if (p.anomalies > 0) {
      totaux.push(`- ${pluriel(p.anomalies, "facture ProGBat présente une anomalie", "factures ProGBat présentent une anomalie")} `
        + "de règlement (sur-règlement, signe incohérent ou montant illisible) — voir la colonne « État ».");
    }
  }
  if (f.manuel) {
    const mm = f.manuel;
    if (mm.totalHT === null) {
      totaux.push(`- **Factures saisies à la main** : total HT non calculable, `
        + `le montant ${pluriel(mm.sansMontant, "de la facture est manquant", "de plusieurs factures est manquant")}.`);
    } else if (mm.sansMontant > 0) {
      totaux.push(`- **Factures saisies à la main** — total des montants connus : ${montantExact(mm.totalHT)} HT `
        + `(${pluriel(mm.sansMontant, "facture écartée", "factures écartées")} du total, montant manquant).`);
    } else {
      totaux.push(`- **Factures saisies à la main** — total facturé : ${montantExact(mm.totalHT)} HT.`);
    }
  }

  return [
    "### Facturation client",
    "",
    ...tableau(
      [
        { t: "Numéro" }, { t: "Date" }, { t: "Libellé" }, { t: "Nature" }, { t: "Source" },
        // Le montant d'une facture qui existe DOIT rester visible, même
        // inconnu : c'est une anomalie à traiter, pas un champ facultatif.
        { t: "Montant", a: "r", garder: true }, { t: "Base" },
        { t: "Réglé", a: "r" }, { t: "Reste", a: "r" }, { t: "État" },
      ],
      f.lignes.map((l) => [
        cellule(l.numero), cellule(dateFR(l.date)), cellule(l.libelle),
        cellule(l.nature), cellule(l.source),
        cellule(l.montantConnu ? montantExact(l.montant) : ND),
        cellule(l.montantConnu ? l.base : null),
        cellule(l.regle === null ? null : montantExact(l.regle)),
        cellule(l.reste === null ? null : montantExact(l.reste)),
        cellule(l.etat),
      ]),
    ),
    "",
    ...totaux,
    ...(sansMontant > 0 ? [
      "",
      `> ${pluriel(sansMontant, "facture n'a pas de montant enregistré", "factures n'ont pas de montant enregistré")} : `
      + "ces lignes sont exclues des totaux ci-dessus. **Un montant inconnu n'est pas",
      "> un montant nul** — le total réel est donc supérieur à celui affiché.",
    ] : []),
    "",
    "Les montants et les états de règlement sont ceux calculés par le module de",
    "facturation de l'application ; l'export n'en refait aucun.",
    "",
  ];
}

// Conditions de vente du chiffrage rattaché (coefficient / taux horaire par
// ouvrage). Ces personnalisations vivent dans le module Chiffrage : elles ne
// sont présentes que si un devis a été rattaché au chantier.
function conditionsChiffrage(c) {
  const ch = c.chiffrage;
  if (!ch) return [];
  const lignes = Array.isArray(ch.lignes) ? ch.lignes : [];
  return [
    "### Conditions de vente du chiffrage rattaché",
    "",
    ...listeDefinitions([
      ["Devis / projet", ch.reference],
      ["Mode de coefficient", ch.modeCoefficient],
      ["Coefficient global", ch.coefficientGlobal],
      ["Mode de taux horaire", ch.modeTauxHoraire],
      ["Taux horaire global", ch.tauxHoraireGlobal],
    ]),
    "",
    ...tableau(
      [
        { t: "Code" }, { t: "Ouvrage" }, { t: "Zone" }, { t: "Quantité", a: "r" },
        { t: "PU vente HT", a: "r" }, { t: "Coefficient", a: "r" }, { t: "Origine coef." },
        { t: "Taux horaire", a: "r" }, { t: "Origine taux" },
      ],
      lignes.map((l) => [
        cellule(l.code), cellule(l.libelle), cellule(l.zone), cellule(nombre(l.quantite, l.unite || "")),
        cellule(euros(l.prixUnitaire)), cellule(nombre(l.coefficient)), cellule(l.coefficientSource),
        cellule(l.tauxHoraire === null ? ND : nombre(l.tauxHoraire, "€/h")), cellule(l.tauxHoraireSource),
      ]),
    ),
    "",
  ];
}
