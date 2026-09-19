#!/usr/bin/env node
// Vérifie le gabarit PDF « Préparation de chantier »
// (src/Renovation/preparationChantierDoc.js). Aucun réseau, aucune base :
// le module est alimenté par un payload de RPC en dur et on inspecte le HTML
// produit.
//   node scripts/verif-preparation-chantier-doc.mjs
//
// Le module importe previsionnelDoc.js, preparationChantier.mjs et
// preparationDocCommun.mjs : le dépôt n'a pas "type": "module", d'où le
// chargeur maison qui réécrit les imports relatifs (scripts/_chargeur.mjs).
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const { buildPreparationDocHTML, MENTION_PORTEE_MATERIAUX } =
  await chargerModuleSource("../src/Renovation/preparationChantierDoc.js", import.meta.url);
const { PHASE_A_ORGANISER } =
  await chargerModuleSource("../src/Renovation/preparationChantier.mjs", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const pos = (html, s) => html.indexOf(s);
const compte = (html, s) => html.split(s).length - 1;
// Position du BANDEAU d'une phase. Indispensable : « À organiser » est aussi
// une ligne de la synthèse de tête — chercher le texte nu situerait la phase
// bien avant sa vraie place.
const posPhase = (html, nom) => html.indexOf(`class="pc-ph-nom bc">${nom}<`);

// ─── FIXTURE ─────────────────────────────────────────────────────────────────
// Reproduit les cas limites réels de FOURMOND 001 : un ouvrage réparti sur
// DEUX phases (ses matériaux ne doivent sortir qu'une fois), une phase
// « À organiser » donnée AVANT les autres et avec un ordre plus petit, un
// ouvrage sans tâche, un ouvrage sans matériau, un matériau introuvable, une
// quantité totale inconnue, un libellé très long, des caractères spéciaux.
const MAT_PLAQUES = {
  materiau_id: "m1", nom: 'Plaque BA13 <standard> & "hydro"', reference: "BA13-H",
  unite: "m²", fournisseur: "Point P", quantite_par_unite: 1.05, quantite_totale: 42,
  commande_le: "2026-09-10", introuvable: false,
};
const MAT_INTROUVABLE = {
  materiau_id: "m2", nom: "Matériau introuvable", reference: null, unite: null,
  fournisseur: null, quantite_par_unite: null, quantite_totale: null,
  commande_le: null, introuvable: true,
};
const MAT_SANS_QTE = {
  materiau_id: "m3", nom: "Bande à joint", reference: "BJ-50", unite: "rlx",
  fournisseur: "Sider", quantite_par_unite: 0.25, quantite_totale: null,
  commande_le: null, introuvable: false,
};

// Libellé de devis long (les vrais font 319 caractères en moyenne, 778 au max).
const LIB_LONG = "Cloison de distribution 98/48 <hydro> & isolation — ossature métallique "
  + "simple peau, parement BA13 hydrofuge sur faces exposées, isolation laine minérale 45 mm, "
  + "bandes et enduits toutes finitions, y compris calfeutrement périphérique, traitement des "
  + "points singuliers, réservations pour appareillages et toutes sujétions de mise en œuvre "
  + "conformément au CCTP des locaux \"humides\".";

// Le MÊME ouvrage (même id), vu depuis deux phases : tâches différentes,
// matériaux identiques (materiaux_portee = "ouvrage_complet").
const cloison = (taches) => ({
  id: "o1", code_ouvrage: "CLO-01", libelle: LIB_LONG, quantite: 148.5, unite: "m²",
  taches, materiaux: [MAT_PLAQUES, MAT_INTROUVABLE, MAT_SANS_QTE],
  materiaux_portee: "ouvrage_complet",
});

const PAYLOAD = {
  chantier_id: "c1", chantier_nom: "FOURMOND 001", phasage_id: "p1", modele: "v2",
  phases: [
    // Volontairement en désordre, et « À organiser » en tête.
    { id: PHASE_A_ORGANISER, nom: "À organiser", ordre: 1, couleur: "#94a3b8", synthetique: true,
      ouvrages: [
        // Ouvrage SANS aucune tâche : la RPC le fait tomber ici.
        { id: "o8", code_ouvrage: null, libelle: "Ouvrage sans tâche", quantite: null,
          unite: null, taches: [], materiaux: [], materiaux_portee: "ouvrage_complet" }] },
    { id: "g2", nom: "Doublages", ordre: 20, couleur: "#5b8af5", synthetique: false,
      ouvrages: [cloison([{ id: "t3", nom: "Bandes et enduits", ordre: 1, avancement: 0 }])] },
    { id: "g1", nom: "Démolition &amp; dépose", ordre: 10, couleur: "#e0a800", synthetique: false,
      ouvrages: [cloison([
        { id: "t1", nom: "Pose ossature métallique", ordre: 1, avancement: 100 },
        { id: "t2", nom: "Plaquage BA13", ordre: 2, avancement: 45 },
      ])] },
    // Phase déclarée mais vide : masquée par phasesVisibles.
    { id: "g3", nom: "Phase vide", ordre: 30, couleur: "#c084fc", synthetique: false, ouvrages: [] },
  ],
  compteurs: { phases: 4, ouvrages_uniques: 2, taches: 3, taches_a_organiser: 0 },
};

const HTML = buildPreparationDocHTML({
  payload: PAYLOAD, chantierNom: "FOURMOND 001", operationNom: "Îlot <Sud> & Ouest",
  adresse: '12 rue "des Lilas", Angers', logoUrl: "/logos/profero-reno-h.png",
  dateGen: "18 septembre 2026",
});

// ─── 1. CHAQUE PHASE VISIBLE UNE FOIS ────────────────────────────────────────
test("1. chaque phase visible apparaît une fois, dans l'ordre réel", () => {
  assert.equal(compte(HTML, 'class="pc-ph-band"'), 3, "3 phases visibles, une fois chacune");
  const demo = posPhase(HTML, "Démolition &amp;amp; dépose");
  const doub = posPhase(HTML, "Doublages");
  assert.ok(demo > -1 && doub > -1, "les deux phases réelles sont rendues");
  assert.ok(demo < doub, "ordre 10 avant ordre 20, malgré l'ordre d'arrivée inverse");
  assert.ok(!HTML.includes("Phase vide"), "une phase sans ouvrage n'est pas imprimée");
  // La synthèse de tête liste les mêmes phases, une ligne chacune.
  // L'ÉLÉMENT rendu, pas le nom de classe : la feuille de style le déclare aussi.
  assert.equal(compte(HTML, 'class="pc-t pc-synth"'), 1, "une seule table de synthèse");
  assert.equal(compte(HTML, 'class="pc-c-dot"'), 3, "une ligne de synthèse par phase visible");
});

// ─── 2. « À ORGANISER » EN DERNIER ───────────────────────────────────────────
test("2. « À organiser » reste en dernier malgré son ordre = 1", () => {
  const ao = posPhase(HTML, "À organiser");
  assert.ok(ao > -1, "la phase synthétique est rendue");
  assert.ok(ao > posPhase(HTML, "Doublages"), "elle suit toutes les phases réelles");
  assert.ok(HTML.includes("Hors planning"), "elle est signalée");
});

// ─── 3. CHAQUE TÂCHE UNE FOIS, DANS LA BONNE PHASE ───────────────────────────
test("3. chaque tâche apparaît exactement une fois, dans sa phase", () => {
  const demo = posPhase(HTML, "Démolition &amp;amp; dépose");
  const doub = posPhase(HTML, "Doublages");
  const ao   = posPhase(HTML, "À organiser");
  const dans = (s, a, b) => { const i = pos(HTML, s); return i > a && i < b; };
  assert.ok(dans("Pose ossature métallique", demo, doub), "t1 dans Démolition");
  assert.ok(dans("Plaquage BA13<", demo, doub), "t2 dans Démolition");
  assert.ok(dans("Bandes et enduits<", doub, ao), "t3 dans Doublages");
  assert.equal(compte(HTML, "Pose ossature métallique"), 1, "jamais dupliquée");
  assert.equal(compte(HTML, "Bandes et enduits<"), 1, "jamais dupliquée");
  // Une ligne de tâche par tâche : 3 tâches, 3 cases dans le déroulé.
  assert.equal(compte(HTML, 'class="pc-c-nom">Pose'), 1);
  // Avancement affiché seulement entre 1 et 99.
  assert.ok(HTML.includes("45 %"), "l'avancement intermédiaire est imprimé");
  assert.ok(!HTML.includes("100 %") && !HTML.includes("0 %"), "ni 0 % ni 100 % ne sont imprimés");
  assert.ok(HTML.includes(">faite<"), "une tâche terminée est signalée");
});

// ─── 4. LIBELLÉS DE TÂCHES NON TRONQUÉS ──────────────────────────────────────
test("4. aucun libellé de tâche n'est tronqué", () => {
  ["Pose ossature métallique", "Plaquage BA13", "Bandes et enduits"].forEach(n =>
    assert.ok(HTML.includes(`>${n}</td>`), `« ${n} » est rendu en entier`));
  assert.ok(!/…<\/td>/.test(HTML.replace(/class="pc-ouv-lib"[\s\S]*?<\/div>/g, "")),
    "aucune ellipse dans une cellule de tâche");
});

// ─── 5. OUVRAGE DANS CHACUNE DE SES PHASES, LIBELLÉ INTÉGRAL AU DÉROULÉ ──────
test("5. l'ouvrage apparaît dans chaque phase où il a des tâches", () => {
  // CLO-01 est dans Démolition ET Doublages : 2 fois au déroulé + 1 fois dans
  // l'index des matériaux = 3 occurrences du code.
  assert.equal(compte(HTML, "CLO-01"), 3, "2 passages au déroulé + 1 repère dans l'index");
  // Libellé INTÉGRAL au déroulé (pas de clamp, pas d'ellipse), deux fois.
  const libEchappe = LIB_LONG.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  assert.equal(compte(HTML, libEchappe), 2, "le libellé complet est imprimé à chaque passage");
  assert.ok(HTML.includes("Ouvrage sans tâche"), "un ouvrage sans tâche reste imprimé");
  assert.ok(HTML.includes("Aucune tâche prévue pour cet ouvrage dans cette phase."),
    "et son absence de tâche est dite");
});

// ─── 6 & 7. MATÉRIAUX CONSOLIDÉS, UNE SEULE FOIS PAR OUVRAGE ─────────────────
test("6. chaque matériau n'apparaît qu'une fois, pour son ouvrage", () => {
  assert.equal(compte(HTML, "Matériaux prévus"), 1, "une seule section matériaux");
  assert.equal(compte(HTML, "BA13-H"), 1, "la référence n'est imprimée qu'une fois");
  assert.equal(compte(HTML, "Bande à joint<"), 1, "idem pour les autres lignes");
  assert.equal(compte(HTML, 'class="pc-c-mat"'), 3, "3 lignes de matériaux, pas 6");
  // Les matériaux ne doivent plus figurer dans le déroulé des phases.
  const deroule = HTML.slice(pos(HTML, "Déroulé des travaux"), pos(HTML, "Matériaux prévus"));
  assert.ok(!deroule.includes("Point P"), "aucun fournisseur dans le déroulé");
  assert.ok(!deroule.includes("BA13-H"), "aucune référence dans le déroulé");
});

test("7. un ouvrage sur plusieurs phases ne multiplie pas ses matériaux", () => {
  // L'ouvrage o1 traverse 2 phases ; ses 3 matériaux sortent 3 fois au total.
  assert.equal(compte(HTML, 'class="pc-mat-bloc"'), 1, "un seul bloc pour l'ouvrage o1");
  assert.equal(compte(HTML, "Commandé"), 1, "le badge n'est pas répété par phase");
  assert.ok(HTML.includes(MENTION_PORTEE_MATERIAUX), "la règle de portée est écrite");
  assert.ok(MENTION_PORTEE_MATERIAUX.includes("ne se commande qu'une fois"),
    "et dit explicitement de ne pas commander deux fois");
});

// ─── 8. AUCUNE QUANTITÉ ADDITIONNÉE ──────────────────────────────────────────
test("8. les quantités ne sont jamais additionnées", () => {
  assert.equal(compte(HTML, ">42 m²<"), 1, "la quantité sort telle quelle, une fois");
  assert.ok(!HTML.includes("84 m²"), "42 + 42 ne devient jamais 84");
  assert.ok(!HTML.includes("297"), "la quantité d'ouvrage n'est pas doublée non plus");
  assert.ok(HTML.includes("148,5 m²"), "la quantité d'ouvrage est imprimée telle quelle");
});

// ─── 9 & 10. MATÉRIAU INTROUVABLE / QUANTITÉ INCONNUE ────────────────────────
test("9. un matériau retiré de la bibliothèque reste signalé", () => {
  assert.ok(HTML.includes("Matériau introuvable"), "la ligne est conservée");
  assert.ok(HTML.includes("retiré de la bibliothèque"), "avec son avertissement");
  assert.ok(HTML.includes("pc-l-alerte"), "et un fond d'alerte");
});

test("10. une quantité totale inconnue reste signalée", () => {
  assert.ok(HTML.includes("Quantité à définir"), "libellé explicite");
  // La quantité par unité ne réapparaît QUE dans ce cas — c'est alors la seule
  // information exploitable.
  assert.ok(HTML.includes("par unité d&#39;ouvrage") || HTML.includes("par unité d'ouvrage"),
    "le repli par unité d'ouvrage est proposé");
  assert.equal(compte(HTML, "par unité d&#39;ouvrage") + compte(HTML, "par unité d'ouvrage"), 1,
    "et uniquement là : jamais quand le total est connu");
});

// ─── 11, 12, 13. ZONES DE NOTES ──────────────────────────────────────────────
test("11. une seule zone de notes, en fin de document", () => {
  assert.equal(compte(HTML, 'class="pc-notes"'), 1, "une seule zone");
  assert.equal(compte(HTML, "Observations et points à vérifier"), 1, "un seul titre");
  const nb = compte(HTML, 'class="pc-notes-l"');
  assert.ok(nb >= 5 && nb <= 8, `entre 5 et 8 lignes manuscrites (${nb})`);
});

test("12. aucune zone de notes par phase", () => {
  assert.ok(!HTML.includes("Notes / points à vérifier sur chantier"),
    "l'ancienne zone par phase a disparu");
  assert.ok(!HTML.includes("Observations générales de préparation"),
    "l'ancienne page finale a disparu");
  // 3 phases visibles mais UNE zone : elle n'est pas répétée.
  assert.equal(compte(HTML, 'class="pc-notes-titre"'), 1);
});

test("13. aucune page forcée pour les notes ni ailleurs", () => {
  assert.ok(!/page-break-before\s*:\s*always/.test(HTML), "aucun saut de page forcé");
  assert.ok(!/break-before\s*:\s*page/.test(HTML), "aucun break-before:page");
  assert.ok(!/\.pc-notes\{[^}]*page-break-before/.test(HTML), "la zone de notes suit le flux");
});

// ─── 14. AUCUNE DONNÉE FINANCIÈRE ────────────────────────────────────────────
test("14. aucun champ financier n'atteint le HTML", () => {
  // Payload VOLONTAIREMENT pollué : si le gabarit recopiait un objet reçu
  // (spread, Object.keys…), ces valeurs sortiraient.
  const sale = JSON.parse(JSON.stringify(PAYLOAD));
  const POISON = "999777555";
  sale.prix_total_chantier = POISON;
  sale.phases.forEach(p => {
    p.marge_phase = POISON;
    (p.ouvrages || []).forEach(o => {
      o.prix_ht = POISON; o.cout_materiaux = POISON; o.taux_marge = POISON;
      (o.taches || []).forEach(t => { t.heures_vendues = POISON; t.ratio = POISON; t.montant = POISON; });
      (o.materiaux || []).forEach(m => { m.prix_unitaire = POISON; m.coefficient = POISON; });
    });
  });
  const html = buildPreparationDocHTML({
    payload: sale, chantierNom: "FOURMOND 001", logoUrl: "/l.png", dateGen: "18 septembre 2026",
  });
  assert.ok(!html.includes(POISON), "aucune valeur financière injectée ne ressort");
  const interdits = [/€/, /\bmarge/i, /\bprix\b/i, /\bcoûts?\b/i, /\bcouts?\b/i, /\bfactur/i,
    /\bencaiss/i, /\bQCD\b/, /heures?\s+vendues/i, /\bHT\b/, /\bTTC\b/, /\bTVA\b/, /\bdébours/i];
  interdits.forEach(re => assert.ok(!re.test(html), `le motif ${re} ne doit pas apparaître`));
});

// ─── 15. ÉCHAPPEMENT HTML ET CSS ─────────────────────────────────────────────
test("15. échappement HTML et CSS de tout le contenu interpolé", () => {
  const xss = {
    chantier_id: "c1", chantier_nom: "X", phasage_id: "p1", modele: "v2",
    phases: [{ id: "g1", nom: '<script>alert("phase")</script>', ordre: 1, couleur: '"><b>', synthetique: false,
      ouvrages: [{ id: "o1", code_ouvrage: "<img src=x onerror=1>", libelle: "<b>gras</b> & \"co\"",
        quantite: 1, unite: "<i>u</i>",
        taches: [{ id: "t1", nom: "<script>alert(1)</script>", ordre: 1, avancement: 50 }],
        materiaux: [{ materiau_id: "m1", nom: "<b>mat</b>", reference: '"x"', unite: "<u>",
          fournisseur: "<em>f</em>", quantite_par_unite: 1, quantite_totale: 2,
          commande_le: null, introuvable: false }],
        materiaux_portee: "ouvrage_complet" }] }],
    compteurs: { phases: 1, ouvrages_uniques: 1, taches: 1, taches_a_organiser: 0 },
  };
  const html = buildPreparationDocHTML({
    payload: xss, chantierNom: '</style><script>alert("titre")</script>',
    operationNom: "<b>op</b>", adresse: '<img src=x onerror="alert(1)">',
    logoUrl: "/l.png", dateGen: "18 septembre 2026",
  });
  // HTML : aucune balise EXÉCUTABLE. Le texte échappé, lui, a le droit d'être là.
  assert.ok(!/<script/i.test(html), "aucune balise script");
  assert.ok(!/<img[^>]*onerror/i.test(html), "aucun gestionnaire d'événement sur une balise réelle");
  assert.ok(!html.includes("<b>gras</b>"), "les balises des libellés sont neutralisées");
  assert.ok(html.includes("&lt;script&gt;alert"), "elles apparaissent en texte échappé");
  assert.ok(!html.includes('border-left-color:"><b>'), "une couleur ne peut pas casser l'attribut");
  // CSS : le nom du chantier passe dans un content: de @page, dans le <style>.
  assert.ok(!html.includes("</style><script>"), "le <style> ne peut pas être fermé");
  assert.ok(html.includes("\\3c "), "les chevrons passent en échappement CSS hexadécimal");
});

// ─── 16. ÉTATS PARTICULIERS DU MODÈLE ────────────────────────────────────────
test("16. absent / vide / legacy_v1 / ambigu : un message dédié, jamais un vide", () => {
  const attendus = {
    absent:    "Aucun phasage trouvé",
    vide:      "Préparation non renseignée",
    legacy_v1: "Préparation indisponible",
    ambigu:    "Chantier à vérifier",
  };
  Object.entries(attendus).forEach(([modele, titre]) => {
    const html = buildPreparationDocHTML({
      payload: { chantier_id: "c1", chantier_nom: "X", phasage_id: null, modele,
        phases: [], compteurs: { phases: 0, ouvrages_uniques: 0, taches: 0, taches_a_organiser: 0 } },
      chantierNom: "X", logoUrl: "/l.png", dateGen: "18 septembre 2026",
    });
    assert.ok(html.includes(titre), `${modele} → « ${titre} »`);
    assert.ok(!html.includes("Déroulé des travaux"), `${modele} : le déroulé est omis`);
    assert.ok(!html.includes("Matériaux prévus"), `${modele} : la section matériaux est omise`);
    assert.ok(html.includes("Observations et points à vérifier"),
      `${modele} : la zone de notes reste utilisable`);
  });
  // Modèle inconnu et payload nul : anomalies, jamais ignorées.
  assert.ok(buildPreparationDocHTML({ payload: { modele: "martien", phases: [], compteurs: {} },
    chantierNom: "X", logoUrl: "/l.png", dateGen: "" }).includes("Préparation indisponible"),
    "modèle inconnu signalé");
  assert.ok(buildPreparationDocHTML({ chantierNom: "X", logoUrl: "/l.png" })
    .includes("Préparation indisponible"), "payload nul géré");
});

// ─── 17. HÉROS, PAGINATION, DENSITÉ ──────────────────────────────────────────
test("17. héros compact, pagination et règles de coupure", () => {
  assert.ok(HTML.startsWith("<!DOCTYPE html>"), "document complet");
  assert.ok(HTML.includes("Préparation de chantier"), "eyebrow");
  assert.ok(HTML.includes("FOURMOND 001"), "nom du chantier");
  assert.ok(HTML.includes("Îlot &lt;Sud&gt; &amp; Ouest"), "opération (échappée)");
  assert.ok(HTML.includes("12 rue &quot;des Lilas&quot;, Angers"), "adresse (échappée)");
  assert.ok(HTML.includes("Généré le 18 septembre 2026"), "date de génération");
  assert.ok(HTML.includes("3 phases") && HTML.includes("2 ouvrages") && HTML.includes("3 tâches"),
    "compteurs du héros");
  assert.ok(HTML.includes("size:A4") && !HTML.includes("landscape"), "A4 portrait");
  assert.ok(HTML.includes('counter(page) " / " counter(pages)'), "numérotation de page");
  assert.ok(HTML.includes('@bottom-left  { content:"FOURMOND 001"'), "chantier en pied de page");
  // Coupures : phase et ouvrage sécables, bandeaux et lignes protégés.
  assert.ok(!/\.pc-ph\{[^}]*break-inside:avoid/.test(HTML), "une phase entière n'est jamais insécable");
  assert.ok(!/\.pc-ouv\{[^}]*break-inside:avoid/.test(HTML), "un ouvrage entier n'est jamais insécable");
  assert.ok(/\.pc-ph-band\{[^}]*page-break-after:avoid/.test(HTML), "bandeau de phase non orphelin");
  assert.ok(/\.pc-ouv-tete\{[^}]*page-break-after:avoid/.test(HTML), "en-tête d'ouvrage solidaire");
  assert.ok(/\.pc-l\{[^}]*page-break-inside:avoid/.test(HTML), "lignes tâche/matériau protégées");
  // Densité : aucune taille de police sous 7pt pour du contenu lisible.
  const tailles = [...HTML.matchAll(/font-size:\s*([0-9.]+)pt/g)].map(m => parseFloat(m[1]));
  assert.ok(Math.min(...tailles) >= 6, "aucune police en dessous de 6pt (badges compris)");
  assert.ok(HTML.includes("font-size:9pt"), "le texte courant reste à 9pt");
});

let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-preparation-chantier-doc : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
