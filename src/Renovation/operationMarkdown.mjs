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

export function euros(valeur, { defaut = ND } = {}) {
  const n = nombreOuNull(valeur);
  return n === null ? defaut : eur(n);
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

// Tableau Markdown. `colonnes` = [{ t: en-tête, a: "l"|"c"|"r" }].
// `lignes` = tableau de tableaux de chaînes DÉJÀ passées par cellule().
export function tableau(colonnes, lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) return [AUCUNE];
  const sep = colonnes.map((c) => (c.a === "r" ? "---:" : c.a === "c" ? ":---:" : "---"));
  return [
    `| ${colonnes.map((c) => cellule(c.t, { defaut: "—" })).join(" | ")} |`,
    `|${sep.join("|")}|`,
    ...lignes.map((l) => `| ${l.join(" | ")} |`),
  ];
}

// Liste à puces « label : valeur », les entrées vides sont conservées avec
// « Non renseigné » (savoir qu'une information manque est une information).
export function listeDefinitions(paires) {
  const lignes = (paires || [])
    .filter(Boolean)
    .map(([label, valeur]) => `- **${txt(label, "—")}** : ${cellule(valeur, { max: 600 })}`);
  return lignes.length > 0 ? lignes : [AUCUNE];
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
  const complet = erreurs.length === 0;

  const L = [];
  const push = (...lignes) => lignes.forEach((l) => L.push(l));

  // ── Frontmatter YAML ──
  push(
    "---",
    "type: operation_profero",
    `version_export: ${VERSION_EXPORT}`,
    `operation_id: ${yamlValeur(op.id)}`,
    `reference: ${yamlValeur(op.reference || op.id)}`,
    `nom: ${yamlValeur(op.nom)}`,
    `nombre_chantiers: ${chantiers.length}`,
    `exporte_le: ${yamlValeur(gen.le)}`,
    `export_complet: ${complet ? "true" : "false"}`,
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

  if (!complet) {
    push(
      "> [!ATTENTION] **Export incomplet.** Les sources suivantes n'ont pas pu être lues ;",
      "> les sections qui en dépendent sont vides ou partielles :",
      ...erreurs.map((e) => `> - ${cellule(e, { max: 400 })}`),
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
      ["Adresse principale", op.adresse],
      ["Nombre de chantiers rattachés", chantiers.length === 0 ? "0" : String(chantiers.length)],
      ["Répartition par statut", repartition],
      ["Chantiers chiffrés (avec phasage)", `${agg.nbAvecPhasage ?? 0} sur ${agg.nbChantiers ?? chantiers.length}`],
      ["Avancement global (pondéré par le vendu HT)", pourcent(agg.avancement)],
      ["Vendu HT", euros(agg.vendu)],
      ["Marge nette à date", agg.vendu > 0 ? `${euros(agg.marge)} (${pourcent(agg.margePct, { decimales: 1 })})` : ND],
      ["Marge prévisionnelle (au devis)", agg.vendu > 0 ? `${euros(agg.margePrev)} (${pourcent(agg.margePrevPct, { decimales: 1 })})` : ND],
      ["Heures réelles / heures vendues", `${heures(agg.hReelles)} / ${heures(agg.hVendues)}`],
      ["Période de travaux planifiée", m.bornes?.debut || m.bornes?.fin
        ? `${dateFR(m.bornes.debut)} → ${dateFR(m.bornes.fin)}` : null],
    ]),
    "",
    "Méthode de calcul : chaque chantier est passé par le module de calcul unique de",
    "l'application (`computeChantierFinance`), puis les montants sont sommés.",
    "L'avancement de l'opération est pondéré par le vendu HT de chaque chantier —",
    "jamais une moyenne simple.",
  ]));

  // ── 2. Informations générales ──
  push(...section(2, "2. Informations générales", listeDefinitions([
    ["Identifiant interne de l'opération", op.id],
    ["Nom", op.nom],
    ["Adresse principale", op.adresse],
    ["Couleur de repérage", op.couleur],
    ["Nombre total de chantiers", String(chantiers.length)],
    ["Vendu HT", euros(agg.vendu)],
    ["Coût main-d'œuvre réel", euros(agg.moReel)],
    ["Coût matériaux réel", euros(agg.mat)],
    ["Frais généraux", euros(agg.fg)],
    ["Main-d'œuvre prévisionnelle", euros(agg.moPrev)],
    ["Matériaux prévisionnels", euros(agg.matPrev)],
    ["Frais généraux prévisionnels", euros(agg.fgPrev)],
    ["Marge nette à date", euros(agg.marge)],
    ["Marge prévisionnelle", euros(agg.margePrev)],
    ["Heures vendues", heures(agg.hVendues)],
    ["Heures réelles", heures(agg.hReelles)],
    ["Date de l'export", txt(gen.leFr)],
    ["Description / observations générales de l'opération",
      m.observationsOperation || "L'application ne stocke pas de description au niveau de l'opération."],
  ])));

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
    "### Intervenants internes (équipes affectées)",
    "",
    ...tableau(
      [{ t: "Équipe" }, { t: "Responsable(s)" }, { t: "Membres" }, { t: "Type" }, { t: "Chantiers concernés" }],
      intervenants.map((e) => [
        cellule(e.nom), cellule(e.responsables), cellule(e.membres),
        cellule(e.externe ? "Prestataire externe" : "Interne"), cellule(e.chantiers),
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
    [
      { t: "Chantier" }, { t: "Référence" }, { t: "Adresse" }, { t: "Statut" },
      { t: "Avancement", a: "r" }, { t: "Début prévu" }, { t: "Fin prévue" }, { t: "Équipe" },
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
        { t: "Chantier" }, { t: "Début prévu" }, { t: "Fin prévue" },
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
        { t: "Chantier" }, { t: "Statut" }, { t: "Avancement", a: "r" },
        { t: "Vendu HT", a: "r" }, { t: "Coût MO réel", a: "r" }, { t: "Matériaux réels", a: "r" },
        { t: "Marge prév.", a: "r" }, { t: "Marge", a: "r" }, { t: "Marge %", a: "r" },
        { t: "Heures réelles / vendues", a: "r" },
      ],
      chantiers.map((c) => {
        const b = c.finance;
        if (!b) return [cellule(c.nom), cellule(c.statutLabel), ...Array(8).fill("Sans phasage")];
        return [
          cellule(c.nom), cellule(c.statutLabel), cellule(pourcent(b.avancementChantier)),
          cellule(b.prixHTChantier > 0 ? euros(b.prixHTChantier) : ND),
          cellule(euros(b.coutMOTotalChantier)), cellule(euros(b.coutMatChantier)),
          cellule(b.prixHTChantier > 0 ? euros(b.margePrevChantier) : ND),
          cellule(b.prixHTChantier > 0 ? euros(b.margeChantier) : ND),
          cellule(b.prixHTChantier > 0 ? pourcent(b.margePctChantier, { decimales: 1 }) : ND),
          cellule(`${heures(b.heuresReellesTotalChantier)} / ${heures(b.heuresVenduesChantier)}`),
        ];
      }),
    ),
    "",
    `**Total opération** — avancement ${pourcent(agg.avancement)} · vendu ${euros(agg.vendu)} · `
    + `coût MO ${euros(agg.moReel)} · matériaux ${euros(agg.mat)} · marge ${euros(agg.marge)} `
    + `(${pourcent(agg.margePct, { decimales: 1 })}) · heures ${heures(agg.hReelles)} / ${heures(agg.hVendues)}.`,
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
      [{ t: "Chantier" }, { t: "Action" }, { t: "Responsable(s)" }, { t: "Échéance" }, { t: "Priorité" }, { t: "Statut" }],
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

  // Informations générales
  push(...section(2, "Informations générales", listeDefinitions([
    ["Identifiant interne", c.id],
    ["Nom", c.nom],
    ["Opération de rattachement", m.operation?.nom],
    ["Adresse", c.adresse],
    ["Statut", c.statutLabel],
    ["Avancement global", b ? pourcent(b.avancementChantier) : "Sans phasage — aucun avancement calculable"],
    ["Équipe(s) affectée(s)", c.equipes],
    ["Début prévu", dateFR(c.planning?.debut)],
    ["Fin prévue", dateFR(c.planning?.fin)],
    ["Phasage enregistré", c.phasage?.id ? `oui (modifié le ${dateHeureFR(c.phasage.updatedAt)})` : "non"],
    ["Montant de devis saisi", c.phasage ? euros(c.phasage.montantDevis) : null],
    ["Taux de frais généraux (€/h)", c.phasage ? nombre(c.phasage.fgTauxHoraire) : null],
    ["Marge vendue cible", c.phasage ? pourcent(c.phasage.margeCible) : null],
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

  // Sous-tâches des ouvrages
  const lignesTaches = ouvrages.flatMap((o) => (o.taches || []).map((t) => [
    cellule(o.reference), cellule(t.ordre === null || t.ordre === undefined ? ND : String(t.ordre)),
    cellule(t.nom), cellule(t.phaseNom),
    cellule(t.ratio === null || t.ratio === undefined ? ND : nombre(t.ratio)),
    cellule(heures(t.heuresEstimees)), cellule(heures(t.heuresVendues)), cellule(heures(t.heuresReelles)),
    cellule(pourcent(t.avancement)), cellule(t.etat),
    cellule(dateFR(t.datePrevue)), cellule(t.ouvriers), cellule(t.dependances),
  ]));
  push(...section(2, "Sous-tâches des ouvrages", [
    ...tableau(
      [
        { t: "Ouvrage (réf.)" }, { t: "Ordre", a: "r" }, { t: "Sous-tâche" }, { t: "Phase" },
        { t: "Ratio", a: "r" }, { t: "H. estimées", a: "r" }, { t: "H. vendues", a: "r" },
        { t: "H. réelles", a: "r" }, { t: "Avancement", a: "r" }, { t: "État" },
        { t: "Date prévue" }, { t: "Ouvriers" }, { t: "Dépendances" },
      ],
      lignesTaches,
    ),
    ...(lignesTaches.length > 0 ? [
      "",
      "Les sous-tâches sont listées dans l'ordre enregistré au phasage ; la colonne",
      "« Ordre » reprend `chrono_ordre`, l'ordre d'exécution décidé par le conducteur.",
      "La colonne « Ouvrage (réf.) » renvoie au numéro de ligne du tableau des",
      "ouvrages ci-dessus (`#3` = 3ᵉ ouvrage), suivi de son code quand il en a un.",
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
        [{ t: "Désignation" }, { t: "Quantité", a: "r" }, { t: "Précision" }, { t: "Statut" }, { t: "Signalé le" }],
        c.suggestionsMateriaux.map((s) => [
          cellule(s.designation), cellule(nombre(s.quantite, s.unite || "")),
          cellule(s.precision), cellule(s.statut), cellule(dateFR(s.date)),
        ]),
      ),
    ] : []),
  ]));

  // Plan de travaux et phasage
  const phases = Array.isArray(c.phases) ? c.phases : [];
  push(...section(2, "Plan de travaux et phasage", [
    ...(phases.length === 0 ? [AUCUNE] : phases.flatMap((p, i) => [
      `### Phase ${i + 1} — ${txt(p.nom, "sans nom")}`,
      "",
      ...listeDefinitions([
        ["Ordre enregistré", p.ordre === null || p.ordre === undefined ? null : String(p.ordre)],
        ["Groupe type", p.groupeTypeNom],
        ["Équipe", p.equipeNom],
        ["Tâches", `${p.nbTaches ?? 0} (dont ${p.nbTachesDatees ?? 0} datée(s))`],
        ["Heures estimées / vendues", `${heures(p.heuresEstimees)} / ${heures(p.heuresVendues)}`],
        ["Avancement", pourcent(p.avancement)],
        ["Terminée", p.termine ? "Oui" : "Non"],
        ["Période", p.debut || p.fin ? `${dateFR(p.debut)} → ${dateFR(p.fin)}` : null],
        ["Dernier contrôle", p.controle ? `${dateFR(p.controle.date)} — ${p.controle.nbConformes}/${p.controle.nbTaches} conformes (${txt(p.controle.auteur)})` : null],
      ]),
      "",
      ...tableau(
        [
          { t: "Ordre", a: "r" }, { t: "Tâche" }, { t: "Ouvrage (réf.)" }, { t: "Date prévue" },
          { t: "H. estimées", a: "r" }, { t: "Avancement", a: "r" }, { t: "Ouvriers" },
        ],
        (p.taches || []).map((t) => [
          cellule(t.ordre === null || t.ordre === undefined ? ND : String(t.ordre)),
          cellule(t.nom), cellule(t.ouvrageRef), cellule(dateFR(t.datePrevue)),
          cellule(heures(t.heuresEstimees)), cellule(pourcent(t.avancement)), cellule(t.ouvriers),
        ]),
      ),
      "",
    ])),
    ...(c.tachesHorsPhase?.length > 0 ? [
      "### Tâches non rattachées à une phase (« à organiser »)",
      "",
      ...tableau(
        [{ t: "Tâche" }, { t: "Ouvrage (réf.)" }, { t: "H. estimées", a: "r" }, { t: "Avancement", a: "r" }],
        c.tachesHorsPhase.map((t) => [
          cellule(t.nom), cellule(t.ouvrageRef), cellule(heures(t.heuresEstimees)), cellule(pourcent(t.avancement)),
        ]),
      ),
      "",
    ] : []),
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
        cellule(dateFR(e.date)), cellule(e.auteur), cellule(e.donnees),
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
      [{ t: "Action" }, { t: "Responsable(s)" }, { t: "Échéance" }, { t: "Priorité" }, { t: "Statut" }, { t: "Note" }],
      (c.todos || []).map((t) => [
        cellule(t.texte), cellule(t.assignes), cellule(dateFR(t.echeance)),
        cellule(t.priorite), cellule(t.statut), cellule(t.note, { max: 300 }),
      ]),
    ),
    "",
    "### Tâches du plan non terminées et datées",
    "",
    ...tableau(
      [{ t: "Date prévue" }, { t: "Phase" }, { t: "Tâche" }, { t: "Ouvrage (réf.)" }, { t: "Avancement", a: "r" }, { t: "Ouvriers" }],
      (c.echeances || []).map((t) => [
        cellule(dateFR(t.datePrevue)), cellule(t.phaseNom), cellule(t.nom),
        cellule(t.ouvrageRef), cellule(pourcent(t.avancement)), cellule(t.ouvriers),
      ]),
    ),
    "",
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
        [{ t: "Poste" }, { t: "Prévisionnel", a: "r" }, { t: "Réel / à date", a: "r" }],
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
      ...listeDefinitions([
        ["Taux de main-d'œuvre prévisionnel appliqué", nombre(b.tauxMOPrevEff, "€/h")],
        ["Taux de frais généraux appliqué", b.fgTauxHoraire > 0 ? nombre(b.fgTauxHoraire, "€/h") : "non réglé"],
        ["Déboursé prévisionnel", euros(b.deboursePrevChantier)],
        ["Montant de devis saisi", b.montantDevis ? euros(b.montantDevis) : null],
      ]),
      "",
      ...(c.facturesClient?.length > 0 ? [
        "### Facturation client",
        "",
        ...tableau(
          [{ t: "Numéro" }, { t: "Date" }, { t: "Libellé" }, { t: "Montant HT", a: "r" }, { t: "Statut" }, { t: "Encaissée le" }],
          c.facturesClient.map((f) => [
            cellule(f.numero), cellule(dateFR(f.date)), cellule(f.libelle),
            cellule(euros(f.montantHT)), cellule(f.statut), cellule(dateFR(f.dateEncaissement)),
          ]),
        ),
        "",
        `Total facturé HT : **${euros(c.totalFacture)}**.`,
      ] : []),
      "",
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
