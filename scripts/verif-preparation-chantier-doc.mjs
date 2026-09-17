#!/usr/bin/env node
// Vérifie le gabarit PDF « Dossier de préparation »
// (src/Renovation/preparationChantierDoc.js). Aucun réseau, aucune base :
// le module est alimenté par un payload de RPC en dur et on inspecte le HTML
// produit.
//   node scripts/verif-preparation-chantier-doc.mjs
//
// Le module importe previsionnelDoc.js et preparationChantier.mjs : le dépôt
// n'a pas "type": "module", d'où le chargeur maison qui réécrit les imports
// relatifs (scripts/_chargeur.mjs).
import assert from "node:assert/strict";
import { chargerModuleSource } from "./_chargeur.mjs";

const { buildPreparationDocHTML, MENTION_PORTEE_MATERIAUX } =
  await chargerModuleSource("../src/Renovation/preparationChantierDoc.js", import.meta.url);
const { PHASE_A_ORGANISER } =
  await chargerModuleSource("../src/Renovation/preparationChantier.mjs", import.meta.url);

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Position de la première occurrence ; -1 si absente.
const pos = (html, s) => html.indexOf(s);
const compte = (html, s) => html.split(s).length - 1;
// Position du BANDEAU d'une phase. Indispensable : « À organiser » est aussi
// le libellé d'une tuile du résumé et l'état d'un ouvrage — chercher le texte
// nu situerait la phase bien avant sa vraie place.
const posPhase = (html, nom) => html.indexOf(`class="pc-phase-nom bc">${nom}<`);

// ─── FIXTURE ─────────────────────────────────────────────────────────────────
// Elle reproduit les cas limites réels : un ouvrage réparti sur DEUX phases
// (matériaux répétés), une phase « À organiser » donnée AVANT les autres et
// avec un ordre plus petit (elle doit quand même finir dernière), un matériau
// introuvable, une quantité totale inconnue, des caractères spéciaux.
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
  fournisseur: "Sider", quantite_par_unite: null, quantite_totale: null,
  commande_le: null, introuvable: false,
};

// Le MÊME ouvrage, vu depuis deux phases : tâches différentes, matériaux
// identiques (materiaux_portee = "ouvrage_complet").
const ouvrageCloisons = (taches) => ({
  id: "o1", code_ouvrage: "CLO-01",
  libelle: "Cloison 48 BA13 <hydro> & isolation — locaux \"humides\"",
  quantite: 40, unite: "m²",
  taches, materiaux: [MAT_PLAQUES, MAT_INTROUVABLE, MAT_SANS_QTE],
  materiaux_portee: "ouvrage_complet",
});

const PAYLOAD = {
  chantier_id: "c1", chantier_nom: "LAMARTINE", phasage_id: "p1", modele: "v2",
  phases: [
    // Volontairement en désordre, et « À organiser » en tête.
    { id: PHASE_A_ORGANISER, nom: "À organiser", ordre: 1, couleur: "#94a3b8", synthetique: true,
      ouvrages: [
        { id: "o9", code_ouvrage: null, libelle: "Reprise ponctuelle", quantite: null,
          unite: null, taches: [{ id: "t9", nom: "Tâche orpheline", ordre: null, avancement: null }],
          materiaux: [], materiaux_portee: "ouvrage_complet" },
        // Ouvrage SANS aucune tâche : la RPC le fait tomber ici (cf. la CTE
        // `paire`). Il ne doit ni disparaître, ni casser la mise en page.
        { id: "o8", code_ouvrage: null, libelle: "Ouvrage sans tâche", quantite: null,
          unite: null, taches: [], materiaux: [], materiaux_portee: "ouvrage_complet" },
      ] },
    { id: "g2", nom: "Doublages", ordre: 20, couleur: "#5b8af5", synthetique: false,
      ouvrages: [ouvrageCloisons([{ id: "t3", nom: "Bandes et enduits", ordre: 1, avancement: 0 }])] },
    { id: "g1", nom: "Démolition & dépose", ordre: 10, couleur: "#e0a800", synthetique: false,
      ouvrages: [ouvrageCloisons([
        { id: "t1", nom: "Pose ossature métallique", ordre: 1, avancement: 100 },
        { id: "t2", nom: "Plaquage BA13", ordre: 2, avancement: 45 },
      ])] },
    // Phase déclarée mais vide : masquée par phasesVisibles.
    { id: "g3", nom: "Phase vide", ordre: 30, couleur: "#c084fc", synthetique: false, ouvrages: [] },
  ],
  compteurs: { phases: 4, ouvrages_uniques: 3, taches: 4, taches_a_organiser: 1 },
};

const HTML = buildPreparationDocHTML({
  payload: PAYLOAD, chantierNom: "LAMARTINE", operationNom: "Îlot <Sud> & Ouest",
  adresse: '12 rue "des Lilas", Angers', logoUrl: "/logos/profero-reno-h.png",
  dateGen: "17 septembre 2026 à 14:32",
});

// ─── 1. ORDRE DES PHASES ─────────────────────────────────────────────────────
test("1. les phases suivent chrono_groupes.ordre, pas l'ordre du payload", () => {
  const demo = posPhase(HTML, "Démolition &amp; dépose");
  const doub = posPhase(HTML, "Doublages");
  assert.ok(demo > -1, "la phase Démolition est rendue");
  assert.ok(doub > -1, "la phase Doublages est rendue");
  assert.ok(demo < doub, "ordre 10 avant ordre 20, malgré l'ordre d'arrivée inverse");
  assert.ok(!HTML.includes("Phase vide"), "une phase sans ouvrage n'est pas imprimée");
});

// ─── 2. « À ORGANISER » EN DERNIER ───────────────────────────────────────────
test("2. « À organiser » passe en dernier malgré son ordre = 1", () => {
  const ao = posPhase(HTML, "À organiser");
  assert.ok(ao > -1, "la phase synthétique est rendue");
  assert.ok(ao > posPhase(HTML, "Doublages"), "elle suit toutes les phases réelles");
  assert.ok(HTML.includes("Hors planning"), "elle est signalée comme hors planning");
  assert.ok(HTML.includes("Tâche orpheline"), "et son contenu est bien imprimé");
});

// ─── 3. OUVRAGES ─────────────────────────────────────────────────────────────
test("3. ouvrages présents, libellé intégral, code, quantité et état", () => {
  // Libellé échappé mais NON tronqué (pas de clamp sur papier).
  assert.ok(HTML.includes("Cloison 48 BA13 &lt;hydro&gt; &amp; isolation — locaux &quot;humides&quot;"),
    "le libellé est rendu en entier");
  assert.ok(HTML.includes("CLO-01"), "le code ouvrage est rendu");
  assert.ok(HTML.includes("40 m²"), "la quantité et l'unité de l'ouvrage");
  assert.equal(compte(HTML, "CLO-01"), 2, "l'ouvrage apparaît dans CHACUNE de ses deux phases");
  // État calculé par etatOuvrage : 100 + 45 → En cours ; 0 seul → À faire.
  assert.ok(HTML.includes("En cours"), "état En cours présent");
  assert.ok(HTML.includes("À faire"), "état À faire présent");
  assert.ok(HTML.includes("Ouvrage sans tâche"), "un ouvrage sans aucune tâche reste imprimé");
  assert.ok(HTML.includes("Aucune tâche définie pour cet ouvrage dans cette phase."),
    "et son absence de tâche est dite explicitement");
  assert.ok(/pc-pastille[^>]*>À organiser</.test(HTML), "ouvrage sans tâche → état À organiser");
  assert.ok(HTML.includes("Aucun matériau prévu pour cet ouvrage."), "ouvrage sans matériau annoncé");
});

// ─── 4. TÂCHES LIMITÉES À LEUR PHASE ─────────────────────────────────────────
test("4. chaque phase ne montre que ses propres tâches", () => {
  const demo = posPhase(HTML, "Démolition &amp; dépose");
  const doub = posPhase(HTML, "Doublages");
  const ao   = posPhase(HTML, "À organiser");
  const dans = (s, debut, fin) => { const i = pos(HTML, s); return i > debut && i < fin; };
  assert.ok(dans("Pose ossature métallique", demo, doub), "t1 seulement dans Démolition");
  assert.ok(dans("Plaquage BA13<", demo, doub), "t2 seulement dans Démolition");
  assert.ok(dans("Bandes et enduits", doub, ao), "t3 seulement dans Doublages");
  assert.equal(compte(HTML, "Pose ossature métallique"), 1, "une tâche n'est jamais dupliquée");
  assert.equal(compte(HTML, "Bandes et enduits"), 1);
  // Avancement : affiché seulement entre 1 et 99 (règle avancementAffichable).
  assert.ok(HTML.includes("45 %"), "l'avancement intermédiaire est imprimé");
  assert.ok(!HTML.includes("100 %"), "100 % n'est pas répété, l'état le dit déjà");
  assert.ok(!HTML.includes("0 %"), "0 % n'est pas imprimé");
  // Cases à cocher vierges : 4 tâches + 6 matériaux (3 × 2 phases).
  assert.equal(compte(HTML, 'class="pc-case"'), 10, "une case vierge par tâche et par matériau");
});

// ─── 5. MATÉRIAUX ────────────────────────────────────────────────────────────
test("5. matériaux : nom, réf., fournisseur, quantités, badge Commandé", () => {
  assert.ok(HTML.includes("Réf. BA13-H"), "référence");
  assert.ok(HTML.includes("Point P"), "fournisseur");
  assert.ok(HTML.includes("42 m²"), "quantité totale + unité");
  assert.ok(HTML.includes("soit 1,05 m² par unité d&#39;ouvrage") || HTML.includes("soit 1,05 m² par unité d'ouvrage"),
    "quantité par unité d'ouvrage");
  assert.ok(HTML.includes("Commandé"), "badge Commandé quand commande_le est renseigné");
  assert.equal(compte(HTML, "Commandé"), 2, "répété dans les deux phases, jamais dédupliqué");
});

// ─── 6. MENTION OBLIGATOIRE SUR LA PORTÉE ────────────────────────────────────
test("6. la mention de portée accompagne CHAQUE bloc de matériaux", () => {
  const attendu = "Matériaux prévus pour l'ensemble de l'ouvrage — ne pas additionner avec les autres phases.";
  assert.equal(MENTION_PORTEE_MATERIAUX, attendu, "le libellé exact est figé");
  // 4 ouvrages rendus (CLO-01 × 2 phases + les 2 de « À organiser »).
  assert.equal(compte(HTML, attendu), 4, "une mention par bloc de matériaux, même vide");
  // Les matériaux sont bien RÉPÉTÉS, ni additionnés ni dédupliqués.
  assert.equal(compte(HTML, "Réf. BA13-H"), 2, "le même matériau réapparaît dans la seconde phase");
  assert.equal(compte(HTML, ">42 m²<"), 2,
    "la quantité est réaffichée à l'identique dans chaque phase, jamais cumulée");
  assert.ok(!HTML.includes(">84 m²<"), "aucune addition entre phases (42 + 42 ne devient pas 84)");
});

// ─── 7. QUANTITÉ INCONNUE ────────────────────────────────────────────────────
test("7. quantité totale nulle → « Quantité totale à définir »", () => {
  assert.ok(HTML.includes("Quantité totale à définir"), "libellé explicite");
  assert.equal(compte(HTML, "Quantité totale à définir"), 4,
    "2 matériaux sans quantité × 2 phases");
  assert.ok(!/NaN|Infinity|undefined|null m²/.test(HTML), "aucune valeur technique ne fuit");
});

// ─── 8. MATÉRIAU INTROUVABLE ─────────────────────────────────────────────────
test("8. matériau retiré de la bibliothèque : signalé, jamais masqué", () => {
  assert.ok(HTML.includes("Matériau introuvable"), "la ligne est conservée");
  assert.ok(HTML.includes("Retiré de la bibliothèque"), "avec un avertissement lisible");
  assert.ok(HTML.includes("pc-ligne-alerte"), "et un fond d'alerte sur la ligne");
});

// ─── 9. AUCUNE DONNÉE FINANCIÈRE ─────────────────────────────────────────────
test("9. aucun champ financier n'atteint le HTML", () => {
  // Payload VOLONTAIREMENT pollué : si le gabarit recopiait un objet reçu
  // (spread, Object.keys, to_jsonb côté SQL…), ces valeurs sortiraient.
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
    payload: sale, chantierNom: "LAMARTINE", logoUrl: "/l.png", dateGen: "17 septembre 2026 à 14:32",
  });
  assert.ok(!html.includes(POISON), "aucune valeur financière injectée ne ressort");
  // Second filet, sur le TEXTE : pas de symbole monétaire, pas de vocabulaire
  // de gestion. (La casse et les accents sont couverts par le i + la liste.)
  const interdits = [/€/, /\bmarge/i, /\bprix\b/i, /\bcoûts?\b/i, /\bcouts?\b/i, /\bfactur/i,
    /\bencaiss/i, /\bQCD\b/, /heures?\s+vendues/i, /\bHT\b/, /\bTTC\b/, /\bTVA\b/, /\bdébours/i];
  interdits.forEach(re => assert.ok(!re.test(html), `le motif ${re} ne doit pas apparaître`));
});

// ─── 10. ÉCHAPPEMENT HTML ────────────────────────────────────────────────────
test("10. tout le contenu interpolé est échappé", () => {
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
    payload: xss, chantierNom: '<script>alert("titre")</script>',
    operationNom: "<b>op</b>", adresse: '<img src=x onerror="alert(1)">',
    logoUrl: "/l.png", dateGen: "17 septembre 2026",
  });
  // On vérifie l'absence de balise EXÉCUTABLE, pas l'absence du texte : une
  // fois échappée, la chaîne « onerror= » a parfaitement le droit d'être
  // affichée — c'est même la preuve que l'échappement a eu lieu.
  assert.ok(!/<script/i.test(html), "aucune balise script dans le document");
  assert.ok(!/<img[^>]*onerror/i.test(html), "aucun gestionnaire d'événement sur une balise réelle");
  assert.ok(!/<b>|<i>|<u>|<em>/i.test(html), "aucune balise issue des libellés");
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"),
    "l'adresse hostile est rendue en texte inerte");
  assert.ok(!html.includes("<b>gras</b>"), "les balises des libellés sont neutralisées");
  assert.ok(html.includes("&lt;script&gt;alert"), "elles apparaissent en texte échappé");
  assert.ok(html.includes("&lt;b&gt;gras&lt;/b&gt; &amp; &quot;co&quot;"), "libellé d'ouvrage échappé");
  // La couleur de phase passe dans un attribut style : elle doit être échappée
  // pour ne pas fermer l'attribut.
  assert.ok(!html.includes('border-left-color:"><b>'), "la couleur ne peut pas casser l'attribut");
});

// ─── 11. ÉTATS PARTICULIERS DU MODÈLE ────────────────────────────────────────
test("11. absent / vide / legacy_v1 / ambigu : un message dédié, jamais un vide", () => {
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
      chantierNom: "X", logoUrl: "/l.png", dateGen: "17 septembre 2026",
    });
    assert.ok(html.includes(titre), `${modele} → « ${titre} »`);
    assert.ok(!html.includes("Déroulé des phases"), `${modele} : la section phases est omise`);
    assert.ok(html.includes("Observations générales de préparation"),
      `${modele} : la page de notes reste utilisable`);
  });
  // Modèle inconnu : traité comme une anomalie, pas ignoré.
  const inconnu = buildPreparationDocHTML({
    payload: { modele: "martien", phases: [], compteurs: {} },
    chantierNom: "X", logoUrl: "/l.png", dateGen: "",
  });
  assert.ok(inconnu.includes("Préparation indisponible"), "modèle inconnu signalé");
  // Payload absent (RPC muette) : le document ne part pas en exception.
  const rien = buildPreparationDocHTML({ chantierNom: "X", logoUrl: "/l.png" });
  assert.ok(rien.includes("Préparation indisponible"), "payload null géré");
});

// ─── 12. ENVELOPPE, HÉROS ET PAGINATION ──────────────────────────────────────
test("12. héros, enveloppe Profero et règles de coupure", () => {
  assert.ok(HTML.startsWith("<!DOCTYPE html>"), "document complet");
  assert.ok(HTML.includes("Dossier de préparation"), "eyebrow du héros");
  assert.ok(HTML.includes("LAMARTINE"), "nom du chantier");
  assert.ok(HTML.includes("Îlot &lt;Sud&gt; &amp; Ouest"), "opération de rattachement (échappée)");
  assert.ok(HTML.includes("12 rue &quot;des Lilas&quot;, Angers"), "adresse (échappée)");
  assert.ok(HTML.includes("Généré le 17 septembre 2026 à 14:32"), "date ET heure de génération");
  assert.ok(HTML.includes("Équipe chantier"), "badge « Support équipe chantier »");
  assert.ok(HTML.includes("3 phases") && HTML.includes("3 ouvrages")
    && HTML.includes("4 tâches") && HTML.includes("1 à organiser"), "compteurs dans le héros");
  // Enveloppe commune, non dupliquée.
  assert.ok(HTML.includes("Barlow+Condensed"), "typographies Profero");
  assert.ok(HTML.includes("Document confidentiel"), "pied commun");
  assert.ok(HTML.includes("size:A4"), "A4 portrait (pas de `landscape`)");
  assert.ok(!HTML.includes("landscape"), "aucune bascule paysage");
  // Pagination : numéros + rappel du chantier.
  assert.ok(HTML.includes('counter(page) " / " counter(pages)'), "numérotation de page");
  assert.ok(HTML.includes('@bottom-left  { content:"LAMARTINE"'), "nom du chantier en pied");
  // Coupures : phase sécable, bandeau et lignes protégés.
  assert.ok(/\.pc-phase\{[^}]*\}/.test(HTML), "la classe de phase existe");
  assert.ok(!/\.pc-phase\{[^}]*break-inside:avoid/.test(HTML),
    "une phase entière n'est JAMAIS insécable");
  assert.ok(/\.pc-phase-band\{[^}]*page-break-after:avoid/.test(HTML),
    "le bandeau de phase ne reste pas orphelin en bas de page");
  assert.ok(/\.pc-ligne\{[^}]*page-break-inside:avoid/.test(HTML), "lignes de matériaux protégées");
  assert.ok(HTML.includes("pc-ouvrage-compacte"), "une carte courte reste d'un seul tenant");
  assert.ok(/\.pc-final\{[^}]*page-break-before:always/.test(HTML), "saut de page avant le debrief");
});

// ─── 13. ZONES DE NOTES PAPIER ───────────────────────────────────────────────
test("13. zones de notes : une par phase + un debrief final", () => {
  assert.equal(compte(HTML, "Notes / points à vérifier sur chantier"), 3, "une zone par phase visible");
  assert.equal(compte(HTML, "Observations générales de préparation"), 1, "une zone finale");
  assert.ok(compte(HTML, 'class="pc-notes-ligne"') >= 3 * 3 + 12, "des lignes vierges à remplir");
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
