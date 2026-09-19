#!/usr/bin/env node
// Vérifie l'AFFICHAGE des factures ProGBat d'un chantier :
//   1. les règles pures de src/Renovation/facturesProgbatAffichage.mjs ;
//   2. par analyse statique, que le bloc ajouté à FacturationChantier.jsx lit
//      la base et rien de plus — colonnes nommées, aucune écriture, aucune
//      donnée nominative demandée.
//
// Aucun réseau, aucune base, aucune migration, aucun déploiement.
//   node scripts/verif-factures-progbat-affichage.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const {
  ETAT, LIBELLE_ETAT, TOLERANCE_EUR,
  composerFacturesProgbat, etatFactureProgbat, grouperReglements,
  libelleFactureProgbat, natureFactureProgbat, referenceAnnulationProgbat,
  reglementsActifs, sommeReglements, totauxFacturesProgbat,
  croiserEcheancierProgbat, numeroSituationLigne, suggestionLigneProgbat,
  statutVisuelLigneProgbat,
} = await import(new URL("../src/Renovation/facturesProgbatAffichage.mjs", import.meta.url).href);

// La règle du patch de rattachement est celle de la synchronisation : on la
// vérifie ici telle qu'elle est utilisée, sans la redéfinir.
const { corrigerLigneFacture } =
  await import(new URL("../src/Renovation/progbatFacturation.mjs", import.meta.url).href);

const ECRAN = lire("src/Renovation/FacturationChantier.jsx");

// Fabriques courtes : seules les colonnes réellement lues sont présentes.
const fact = (o) => ({ id: "f-1", source: "progbat", montant_ttc: 1000, ...o });
const regl = (o) => ({ id: "r-1", facture_id: "f-1", montant: 0, annule: false, ...o });

// ═══════════════════════════════════════════════════════════════════════════
// 1. ÉTAT D'UNE FACTURE POSITIVE
// ═══════════════════════════════════════════════════════════════════════════
test("1. facture positive sans aucun règlement → Non réglée", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: 1000 }), []);
  assert.equal(e.etat, ETAT.NON_REGLEE);
  assert.equal(e.libelle, "Non réglée");
  assert.equal(e.somme_reglee, 0);
  assert.equal(e.reste, 1000, "le reste vaut le montant dû");
  assert.equal(e.nombre, 0);
  assert.equal(e.anomalie, false);
});

test("2. deux règlements partiels → Partiellement réglée, reste signé", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: 1000 }), [
    regl({ id: "r-1", montant: 400 }),
    regl({ id: "r-2", montant: 250.5 }),
  ]);
  assert.equal(e.etat, ETAT.PARTIELLE);
  assert.equal(e.libelle, "Partiellement réglée");
  assert.equal(e.somme_reglee, 650.5);
  assert.equal(e.reste, 349.5);
  assert.equal(e.nombre, 2);
  assert.equal(e.anomalie, false);
});

test("3. facture réglée, y compris au centime près", () => {
  const exact = etatFactureProgbat(fact({ montant_ttc: 925.15 }), [regl({ montant: 925.15 })]);
  assert.equal(exact.etat, ETAT.REGLEE);
  assert.equal(exact.reste, 0);

  // Un centime d'écart reste « Réglée » : c'est la tolérance, et elle existe
  // parce que ProGBat scinde 1850,31 en 925,16 + 925,15.
  assert.equal(TOLERANCE_EUR, 0.01);
  const auCentime = etatFactureProgbat(fact({ montant_ttc: 925.16 }), [regl({ montant: 925.15 })]);
  assert.equal(auCentime.etat, ETAT.REGLEE);
  assert.equal(auCentime.reste, 0.01, "le reste réel est conservé, il n'est pas effacé");

  // Deux centimes : ce n'est plus de l'arrondi.
  const deuxCentimes = etatFactureProgbat(fact({ montant_ttc: 925.17 }), [regl({ montant: 925.15 })]);
  assert.equal(deuxCentimes.etat, ETAT.PARTIELLE);
});

test("4. surpaiement → Sur-réglée, reste négatif, anomalie", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: 1000 }), [regl({ montant: 1200 })]);
  assert.equal(e.etat, ETAT.SUR_REGLEE);
  assert.equal(e.libelle, "Sur-réglée");
  assert.equal(e.reste, -200, "le reste passe en négatif, son signe n'est pas supprimé");
  assert.equal(e.anomalie, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. AVOIRS
// ═══════════════════════════════════════════════════════════════════════════
test("5. avoir sans remboursement → Avoir non remboursé", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: -925.15 }), []);
  assert.equal(e.etat, ETAT.AVOIR_NON_REMBOURSE);
  assert.equal(e.libelle, "Avoir non remboursé");
  assert.equal(e.reste, -925.15, "le reste d'un avoir est négatif");
  assert.equal(e.anomalie, false);
});

test("6. avoir partiellement remboursé", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: -900 }), [regl({ montant: -400 })]);
  assert.equal(e.etat, ETAT.AVOIR_PARTIEL);
  assert.equal(e.libelle, "Partiellement remboursé");
  assert.equal(e.somme_reglee, -400);
  assert.equal(e.reste, -500);
});

test("7. avoir entièrement remboursé par un règlement négatif", () => {
  const e = etatFactureProgbat(fact({ montant_ttc: -925.15 }), [regl({ montant: -925.15 })]);
  assert.equal(e.etat, ETAT.AVOIR_REMBOURSE);
  assert.equal(e.libelle, "Remboursé");
  assert.equal(e.reste, 0);
  assert.equal(e.anomalie, false);

  // Sur-remboursement : au-delà de la valeur absolue de l'avoir.
  const trop = etatFactureProgbat(fact({ montant_ttc: -900 }), [regl({ montant: -1000 })]);
  assert.equal(trop.etat, ETAT.AVOIR_SUR_REMBOURSE);
  assert.equal(trop.libelle, "Sur-remboursé");
  assert.equal(trop.reste, 100);
  assert.equal(trop.anomalie, true);
});

test("8. signe incohérent, dans les deux sens", () => {
  // Un remboursement sur une facture positive.
  const a = etatFactureProgbat(fact({ montant_ttc: 1000 }), [regl({ montant: -300 })]);
  assert.equal(a.etat, ETAT.SIGNE_INCOHERENT);
  assert.equal(a.libelle, "Signe incohérent");
  assert.equal(a.reste, 1300);
  assert.equal(a.anomalie, true);

  // Un encaissement sur un avoir.
  const b = etatFactureProgbat(fact({ montant_ttc: -900 }), [regl({ montant: 300 })]);
  assert.equal(b.etat, ETAT.SIGNE_INCOHERENT);
  assert.equal(b.reste, -1200);
  assert.equal(b.anomalie, true);

  // Deux règlements de sens contraires qui s'annulent : rien n'est encaissé.
  const c = etatFactureProgbat(fact({ montant_ttc: 1000 }), [regl({ id: "a", montant: 500 }), regl({ id: "b", montant: -500 })]);
  assert.equal(c.etat, ETAT.NON_REGLEE);
  assert.equal(c.somme_reglee, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RÈGLEMENTS ANNULÉS, TOTAUX, CAS LIMITES
// ═══════════════════════════════════════════════════════════════════════════
test("9. un règlement annulé n'entre dans AUCUN total ni AUCUNE liste", () => {
  const reglements = [
    regl({ id: "r-1", montant: 400, annule: false }),
    regl({ id: "r-2", montant: 600, annule: true }),
  ];
  const e = etatFactureProgbat(fact({ montant_ttc: 1000 }), reglements);
  assert.equal(e.somme_reglee, 400, "600 annulés ne sont pas encaissés");
  assert.equal(e.reste, 600);
  assert.equal(e.nombre, 1);
  assert.equal(e.etat, ETAT.PARTIELLE);

  assert.equal(reglementsActifs(reglements).length, 1);
  assert.equal(sommeReglements(reglements), 400);
  // Et il ne figure dans aucune liste affichable.
  const groupes = grouperReglements(reglements);
  assert.equal(groupes.get("f-1").length, 1);
  assert.equal(groupes.get("f-1")[0].id, "r-1");
  // Tout annulé = rien d'encaissé, jamais « réglée ».
  const tout = etatFactureProgbat(fact({ montant_ttc: 1000 }), [regl({ montant: 1000, annule: true })]);
  assert.equal(tout.etat, ETAT.NON_REGLEE);
  assert.equal(tout.nombre, 0);
});

test("10. totaux signés : un avoir diminue le facturé, son remboursement le réglé", () => {
  const factures = [
    fact({ id: "f-1", montant_ttc: 1000, date_facture: "2026-09-01", progbat_bill_id: 1 }),
    fact({ id: "f-2", montant_ttc: -250, date_facture: "2026-09-02", progbat_bill_id: 2 }),
  ];
  const reglements = [
    regl({ id: "r-1", facture_id: "f-1", montant: 400 }),
    regl({ id: "r-2", facture_id: "f-2", montant: -250 }),
    regl({ id: "r-3", facture_id: "f-1", montant: 999, annule: true }),
  ];
  const { factures_actives: lignes, totaux } = composerFacturesProgbat(factures, reglements);
  assert.equal(totaux.nombre, 2);
  assert.equal(totaux.total_facture, 750, "1000 − 250");
  assert.equal(totaux.total_regle, 150, "400 − 250, l'annulé exclu");
  assert.equal(totaux.reste, 600);
  assert.equal(totaux.anomalies, 0);
  assert.equal(lignes.length, 2);
  assert.equal(lignes[0].etat.etat, ETAT.PARTIELLE);
  assert.equal(lignes[1].etat.etat, ETAT.AVOIR_REMBOURSE);
  // Ordre stable : par date, puis par identifiant ProGBat.
  assert.deepEqual(lignes.map((l) => l.facture.id), ["f-1", "f-2"]);
});

test("11. aucune facture manuelle n'entre : le module ne voit que ce qu'on lui donne", () => {
  // Le filtre est dans la requête (source = 'progbat', vérifié plus bas) ; ici
  // on vérifie que le module n'invente rien à partir d'une liste vide, et que
  // les totaux d'une liste vide sont neutres — pas nuls par accident.
  const vide = composerFacturesProgbat([], []);
  assert.deepEqual(vide.factures_actives, []);
  assert.deepEqual(vide.documents_annulation, []);
  assert.deepEqual(vide.totaux, { nombre: 0, total_facture: 0, total_regle: 0, reste: 0, sans_montant: 0, anomalies: 0 });
  // Une facture manuelle glissée par erreur ne serait pas « corrigée » en
  // silence : elle produirait un état comme une autre. C'est la REQUÊTE qui
  // garantit qu'elle n'arrive jamais ici.
  assert.match(ECRAN, /\.eq\("source", "progbat"\)/);
  assert.ok(!/\.eq\("source", "manuel"\)/.test(ECRAN));
});

test("12. absence de règlement, montant illisible, facture à zéro", () => {
  // Aucun règlement du tout : l'écran doit rester affichable.
  const sansRegl = composerFacturesProgbat([fact({ id: "f-9", montant_ttc: 500 })], []);
  assert.equal(sansRegl.factures_actives[0].reglements.length, 0);
  assert.equal(sansRegl.factures_actives[0].etat.etat, ETAT.NON_REGLEE);
  assert.equal(sansRegl.totaux.reste, 500);

  // Montant illisible : signalé, jamais compté 0 dans les totaux.
  const inconnu = etatFactureProgbat(fact({ montant_ttc: null }), [regl({ montant: 100 })]);
  assert.equal(inconnu.etat, ETAT.MONTANT_INCONNU);
  assert.equal(inconnu.libelle, "Montant inconnu");
  assert.equal(inconnu.reste, null);
  assert.equal(inconnu.anomalie, true);
  const t = totauxFacturesProgbat([fact({ id: "f-1", montant_ttc: null })], grouperReglements([]));
  assert.equal(t.nombre, 1);
  assert.equal(t.total_facture, 0);
  assert.equal(t.sans_montant, 1);

  // Facture à zéro : soldée sans règlement, sur-réglée au moindre encaissement.
  assert.equal(etatFactureProgbat(fact({ montant_ttc: 0 }), []).etat, ETAT.REGLEE);
  assert.equal(etatFactureProgbat(fact({ montant_ttc: 0 }), [regl({ montant: 50 })]).etat, ETAT.SUR_REGLEE);

  // Un numeric rendu en chaîne par PostgREST se lit comme un nombre.
  const chaine = etatFactureProgbat(fact({ montant_ttc: "925.15" }), [regl({ montant: "925.15" })]);
  assert.equal(chaine.etat, ETAT.REGLEE);
  assert.equal(chaine.reste, 0);

  // Un règlement orphelin (sans facture_id) n'est rattaché à personne.
  assert.equal(grouperReglements([regl({ facture_id: null, montant: 10 })]).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 bis. DOCUMENTS D'ANNULATION
// ═══════════════════════════════════════════════════════════════════════════
// Règle établie sur les 482 documents réels : 50 situationNumber négatifs,
// 50 références existantes, toutes à validated = 2, tous les montants
// exactement inverses. Elle ne dépend NI du signe du montant NI du type.
test("13. situationNumber négatif → document d'annulation, quel que soit le signe du montant", () => {
  const negatif = referenceAnnulationProgbat(fact({ montant_ttc: -15639.11, progbat_situation_number: -469 }));
  assert.deepEqual(negatif, { est_document_annulation: true, progbat_bill_id_reference: 469 });

  // F-260072 : un document d'annulation POSITIF. Se fier au signe du montant
  // ou au mot « avoir » le manquerait.
  const positif = referenceAnnulationProgbat(fact({ montant_ttc: 4200.5, progbat_situation_number: -481 }));
  assert.deepEqual(positif, { est_document_annulation: true, progbat_bill_id_reference: 481 });

  // Ni le type ne compte : bill-credit, advance-credit, bill…
  for (const type of ["bill", "bill-credit", "advance-credit", "advance", null]) {
    const r = referenceAnnulationProgbat(fact({ progbat_type: type, progbat_situation_number: -469 }));
    assert.equal(r.est_document_annulation, true, `type ${type}`);
  }
});

test("14. la référence accepte la chaîne, refuse tout le reste", () => {
  assert.deepEqual(referenceAnnulationProgbat(fact({ progbat_situation_number: "-469" })),
    { est_document_annulation: true, progbat_bill_id_reference: 469 });
  assert.deepEqual(referenceAnnulationProgbat(fact({ progbat_situation_number: " -469 " })),
    { est_document_annulation: true, progbat_bill_id_reference: 469 });

  const refuse = { est_document_annulation: false, progbat_bill_id_reference: null };
  for (const v of [0, "0", 3, "3", null, undefined, "", "   ", "abc", "-abc", true, false, -3.5, 3.5, "-4.5", NaN, {}, [], Number.MIN_SAFE_INTEGER - 10]) {
    assert.deepEqual(referenceAnnulationProgbat(fact({ progbat_situation_number: v })), refuse,
      `situationNumber ${JSON.stringify(v)} doit être refusé`);
  }
  // Champ absent : ce n'est pas une annulation.
  assert.deepEqual(referenceAnnulationProgbat({}), refuse);
  assert.deepEqual(referenceAnnulationProgbat(null), refuse);
});

test("15. un vrai avoir sans situationNumber négatif reste une facture ACTIVE", () => {
  const factures = [
    fact({ id: "f-1", montant_ttc: 1000, progbat_situation_number: 2, date_facture: "2026-09-01", progbat_bill_id: 1 }),
    fact({ id: "f-2", montant_ttc: -250, progbat_situation_number: null, date_facture: "2026-09-02", progbat_bill_id: 2 }),
  ];
  const { factures_actives, documents_annulation, totaux } = composerFacturesProgbat(factures, []);
  assert.equal(documents_annulation.length, 0);
  assert.equal(factures_actives.length, 2, "le vrai avoir reste actif");
  assert.equal(factures_actives[1].nature, "avoir");
  assert.equal(factures_actives[1].etat.etat, ETAT.AVOIR_NON_REMBOURSE, "il garde sa logique de remboursement");
  assert.equal(totaux.nombre, 2);
  assert.equal(totaux.total_facture, 750);
});

test("16. les documents d'annulation sortent du nombre, du facturé, du réglé et du reste", () => {
  const factures = [
    fact({ id: "f-1", montant_ttc: 1000, date_facture: "2026-09-01", progbat_bill_id: 1 }),
    fact({ id: "f-2", montant_ttc: -1000, progbat_situation_number: -469, date_facture: "2026-09-02", progbat_bill_id: 2, progbat_bill_code: "F-260042" }),
  ];
  const reglements = [
    regl({ id: "r-1", facture_id: "f-1", montant: 1000 }),
    // Cas exceptionnel : un règlement rattaché au document d'annulation.
    regl({ id: "r-2", facture_id: "f-2", montant: -1000 }),
  ];
  const { factures_actives, documents_annulation, totaux } = composerFacturesProgbat(factures, reglements);

  assert.equal(totaux.nombre, 1, "le document d'annulation ne compte pas");
  assert.equal(totaux.total_facture, 1000, "son montant n'entre pas dans le facturé");
  assert.equal(totaux.total_regle, 1000, "son règlement n'entre pas dans le réglé");
  assert.equal(totaux.reste, 0);
  assert.equal(factures_actives.length, 1);

  // Conservé pour l'historique, avec sa référence et ses règlements attachés.
  assert.equal(documents_annulation.length, 1);
  const a = documents_annulation[0];
  assert.equal(a.facture.id, "f-2");
  assert.equal(a.libelle, "F-260042");
  assert.equal(a.reference.progbat_bill_id_reference, 469);
  assert.equal(a.reference.est_document_annulation, true);
  assert.equal(a.reglements.length, 1, "ses règlements restent accessibles, hors totaux");
  // Aucun état ne lui est attribué : ni réglée, ni avoir non remboursé.
  assert.equal(a.etat, undefined);
  assert.equal(a.nature, undefined);
});

test("17. cas réel #83 TROTTIER - T2 - R+2 : 4 actives, 29 714,27 € facturés et réglés, 0 € restant", () => {
  // Les deux factures annulées (id 469 et 485, validated = 2) ne sont PAS en
  // base : la synchronisation les écarte. Seuls leurs avoirs d'annulation le
  // sont, plus les quatre factures réellement dues.
  const factures = [
    fact({ id: "f-1", progbat_bill_id: 460, progbat_bill_code: "F-260030", numero: "F-260030", montant_ttc: 7000, date_facture: "2026-05-02", progbat_situation_number: 1 }),
    fact({ id: "f-2", progbat_bill_id: 465, progbat_bill_code: "F-260033", numero: "F-260033", montant_ttc: 8000, date_facture: "2026-05-20", progbat_situation_number: 2 }),
    fact({ id: "f-3", progbat_bill_id: 492, progbat_bill_code: "F-260050", numero: "F-260050", montant_ttc: 7714.27, date_facture: "2026-07-03", progbat_situation_number: 5 }),
    fact({ id: "f-4", progbat_bill_id: 495, progbat_bill_code: "F-260055", numero: "F-260055", montant_ttc: 7000, date_facture: "2026-07-20", progbat_situation_number: 6 }),
    fact({ id: "f-5", progbat_bill_id: 480, progbat_bill_code: "F-260042", numero: "F-260042", montant_ttc: -15639.11, date_facture: "2026-06-20", progbat_situation_number: -469 }),
    fact({ id: "f-6", progbat_bill_id: 490, progbat_bill_code: "F-260044", numero: "F-260044", montant_ttc: -16317.15, date_facture: "2026-06-28", progbat_situation_number: -485 }),
  ];
  const reglements = [
    regl({ id: "r-1", facture_id: "f-1", montant: 7000, date_reglement: "2026-05-15" }),
    regl({ id: "r-2", facture_id: "f-2", montant: 8000, date_reglement: "2026-06-02" }),
    regl({ id: "r-3", facture_id: "f-3", montant: 7714.27, date_reglement: "2026-07-18" }),
    regl({ id: "r-4", facture_id: "f-4", montant: 7000, date_reglement: "2026-08-04" }),
  ];
  const { factures_actives, documents_annulation, totaux } = composerFacturesProgbat(factures, reglements);

  assert.equal(totaux.nombre, 4, "Factures actives : 4");
  assert.equal(totaux.total_facture, 29714.27, "Facturé TTC : 29 714,27 €");
  assert.equal(totaux.total_regle, 29714.27, "Réglé : 29 714,27 €");
  assert.equal(totaux.reste, 0, "Reste à régler : 0,00 €");
  assert.equal(totaux.anomalies, 0);
  assert.equal(factures_actives.length, 4);
  for (const l of factures_actives) assert.equal(l.etat.etat, ETAT.REGLEE);

  assert.equal(documents_annulation.length, 2, "Documents d'annulation ProGBat (2)");
  const par = Object.fromEntries(documents_annulation.map((d) => [d.libelle, d.reference.progbat_bill_id_reference]));
  assert.equal(par["F-260042"], 469, "F-260042 neutralise le document ProGBat n°469");
  assert.equal(par["F-260044"], 485, "F-260044 neutralise le document ProGBat n°485");
  // Plus jamais « avoir non remboursé ».
  for (const d of documents_annulation) {
    assert.equal(d.etat, undefined);
    assert.ok(!JSON.stringify(d.reference).includes("rembours"));
  }

  // L'ancien comportement, pour mémoire : c'est bien ce qu'on corrige.
  const avant = totauxFacturesProgbat(factures, grouperReglements(reglements));
  assert.equal(avant.total_facture, -2241.99);
  assert.equal(avant.reste, -31956.26);
});

test("18. l'écran n'affiche que les actives, et replie les annulations", () => {
  // Le bloc principal est alimenté par factures_actives.
  assert.match(ECRAN, /factures_actives: lignes, documents_annulation: annulations, totaux/);
  assert.match(ECRAN, /kpiProgbat\("Factures actives"/);
  assert.match(ECRAN, /Documents d'annulation ProGBat \(\{annulations\.length\}\)/);
  assert.match(ECRAN, /Neutralise le document ProGBat n°\{reference\.progbat_bill_id_reference\}/);
  assert.match(ECRAN, /\{reglements\.length\} règlement\(s\) associé\(s\), exclus des totaux actifs\./);
  // Replié par défaut : un <details> sans `open`.
  assert.ok(!/<details[^>]*\bopen\b/.test(ECRAN));
  // Aucun état, aucun reste sur un document d'annulation : le bloc replié ne
  // rend ni `etat.libelle`, ni « Reste ».
  // Le bloc replié SEUL : du titre à la fermeture du <details>. Sans cette
  // borne, la tranche emporterait tout le reste du composant.
  // Le titre AVEC sa parenthèse : c'est le <summary>, pas le commentaire qui
  // le précède et qui, lui, a le droit d'expliquer la règle.
  const debutBloc = ECRAN.indexOf("Documents d'annulation ProGBat (");
  const bloc = ECRAN.slice(debutBloc, ECRAN.indexOf("</details>", debutBloc));
  assert.ok(debutBloc > 0 && bloc.length > 200 && bloc.length < 4000, "bloc d'annulation correctement borné");
  // Sur le RENDU seul : un commentaire JSX qui explique la règle n'est pas du
  // texte affiché.
  const rendu = bloc.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  assert.ok(!rendu.includes("etat.libelle"), "aucun état affiché sur une annulation");
  assert.ok(!rendu.includes("Reste "), "aucun reste à payer affiché sur une annulation");
  assert.ok(!/rembours/i.test(rendu), "ni dette ni remboursement supposé");
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 ter. RATTACHEMENT À UNE ÉCHÉANCE
// ═══════════════════════════════════════════════════════════════════════════
const ECHEANCIER = [
  { id: "acompte", nom: "Facture d'acompte", pct: 50 },
  { id: "demarrage", nom: "Facture de démarrage", pct: 20 },
  { id: "situation_1", nom: "Facture de situation n° 1", pct: 15 },
  { id: "situation_2", nom: "Facture de situation n° 2", pct: 10 },
  { id: "solde", nom: "Facture de solde", pct: 5 },
];

test("19. numéro de situation d'une ligne : libellé, identifiant, et refus si ambigu", () => {
  assert.equal(numeroSituationLigne({ id: "situation_1", nom: "Facture de situation n° 1" }), 1);
  assert.equal(numeroSituationLigne({ id: "situation_2", nom: "Facture de situation n° 2" }), 2);
  assert.equal(numeroSituationLigne({ id: "situation_3", nom: "Autre libellé" }), 3, "l'identifiant suffit");
  assert.equal(numeroSituationLigne({ id: "x", nom: "Situation n°4" }), 4, "le libellé suffit");
  assert.equal(numeroSituationLigne({ id: "situation_1", nom: "Facture de situation n° 2" }), null, "contradiction → aucun numéro");
  assert.equal(numeroSituationLigne({ id: "acompte", nom: "Facture d'acompte" }), null);
  assert.equal(numeroSituationLigne({ id: "solde", nom: "Facture de solde" }), null);
  assert.equal(numeroSituationLigne({}), null);
});

test("20. suggestion : situation n° 1 unique → proposée, jamais enregistrée", () => {
  const f = fact({ progbat_situation_number: 1, montant_ttc: 4457.14, numero: "F-260081" });
  const s = suggestionLigneProgbat(f, ECHEANCIER);
  assert.equal(s.ligne_id, "situation_1");
  assert.equal(s.ligne_nom, "Facture de situation n° 1");
  assert.equal(s.numero_situation, 1);
  assert.match(s.raison, /une seule échéance/i);
  // Et la situation n° 2.
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 2, montant_ttc: 100 }), ECHEANCIER).ligne_id, "situation_2");
});

test("21. aucune suggestion pour situationNumber = 0, absent ou non exploitable", () => {
  // L'acompte et le démarrage du chantier #83 sont TOUS DEUX à 0 : impossible
  // de trancher, donc rien n'est proposé.
  for (const v of [0, "0", null, undefined, "", "abc", true, 1.5, -1, "-3"]) {
    assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: v, montant_ttc: 100 }), ECHEANCIER), null,
      `situationNumber ${JSON.stringify(v)} ne doit rien proposer`);
  }
});

test("22. aucune suggestion si plusieurs lignes portent le même numéro", () => {
  const ambigu = [...ECHEANCIER, { id: "situation_1_bis", nom: "Facture de situation n° 1 (avenant)", pct: 5 }];
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 1, montant_ttc: 100 }), ambigu), null);
  // Et rien non plus si aucune ligne ne porte ce numéro.
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 9, montant_ttc: 100 }), ECHEANCIER), null);
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 1, montant_ttc: 100 }), []), null);
});

test("23. aucune suggestion pour une annulation ni pour un avoir actif négatif", () => {
  // Un document d'annulation ne se rattache à aucune échéance, même si son
  // situationNumber négatif pourrait ressembler à un numéro.
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: -469, montant_ttc: -15639.11 }), ECHEANCIER), null);
  // Un vrai avoir actif : hors périmètre de ce lot.
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 1, montant_ttc: -500 }), ECHEANCIER), null);
  // Montant illisible : rien non plus.
  assert.equal(suggestionLigneProgbat(fact({ progbat_situation_number: 1, montant_ttc: null }), ECHEANCIER), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 quater. CROISEMENT ÉCHÉANCIER × ProGBat
// ═══════════════════════════════════════════════════════════════════════════
// Fabrique une entrée d'état de ligne telle que etatFacturation() la produit.
const ligneEtat = (o) => ({
  id: "situation_1", nom: "Facture de situation n° 1", pct: 15,
  montantAttendu: 1500, factures: [], montantEmis: 0, montantEncaisse: 0, ...o,
});
const croiser = (lignesEtat, factures, reglements, ref = 10000, totauxManuels = { emis: 0, encaisse: 0 }) =>
  croiserEcheancierProgbat({
    lignesEtat,
    actives: composerFacturesProgbat(factures, reglements).factures_actives,
    montantReference: ref, totauxManuels,
  });

test("24. ligne intégralement réglée : tout son HT prévu, facturé et encaissé", () => {
  const c = croiser(
    [ligneEtat({ montantAttendu: 1500 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1800, numero: "F-1" })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 1800 })],
  );
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.ttc_du, 1800);
  assert.equal(pg.regle, 1800);
  assert.equal(pg.ratio, 1);
  assert.equal(pg.equivalent_ht, 1500, "tout le HT prévu de la ligne");
  assert.equal(pg.etat, ETAT.REGLEE);
  assert.equal(pg.anomalie, null);
  assert.equal(c.totaux.facture_ht, 1500);
  assert.equal(c.totaux.encaisse_ht, 1500);
  assert.equal(c.totaux.reste_a_facturer_ht, 8500, "marché 10 000 − 1 500");
  assert.equal(c.actif, true);
});

test("25. règlement partiel : HT équivalent au prorata", () => {
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 2000 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 500 })],
  );
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.ratio, 0.25);
  assert.equal(pg.equivalent_ht, 250);
  assert.equal(pg.etat, ETAT.PARTIELLE);
  assert.equal(c.totaux.facture_ht, 1000, "la ligne est facturée en entier");
  assert.equal(c.totaux.encaisse_ht, 250, "mais encaissée au quart");
});

test("26. surpaiement : le ratio est borné à 1, jamais au-delà du HT prévu", () => {
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 5000 })],
  );
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.ratio, 1);
  assert.equal(pg.equivalent_ht, 1000, "borné : on n'encaisse pas plus que le HT prévu");
  assert.equal(pg.etat, ETAT.SUR_REGLEE);
  assert.equal(c.totaux.encaisse_ht, 1000);
});

test("27. signe incohérent, TTC nul ou avoir seul : aucun équivalent HT", () => {
  // a. Remboursement sur une facture positive.
  const a = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: -300 })],
  );
  const pa = a.parLigne.get("situation_1");
  assert.equal(pa.anomalie, "signe_incoherent");
  assert.equal(pa.equivalent_ht, null);
  assert.equal(pa.ratio, null);
  assert.equal(a.totaux.facture_ht, 1000, "la ligne reste facturée");
  assert.equal(a.totaux.encaisse_ht, 0, "mais rien n'est encaissé en équivalent");
  assert.equal(a.totaux.anomalies, 1);

  // b. Un avoir actif SEUL rattaché à la ligne : TTC total négatif.
  const b = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: -900 })],
    [],
  );
  assert.equal(b.parLigne.get("situation_1").anomalie, "ttc_non_positif");
  assert.equal(b.totaux.encaisse_ht, 0);

  // c. Montant illisible.
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: null })],
    [],
  );
  assert.equal(c.parLigne.get("situation_1").anomalie, "montant_illisible");
  assert.equal(c.parLigne.get("situation_1").equivalent_ht, null);
});

test("28. plusieurs factures sur une même ligne : un seul comptage", () => {
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [
      fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 600, date_facture: "2026-09-01", progbat_bill_id: 1 }),
      fact({ id: "f-2", ligne_id: "situation_1", montant_ttc: 600, date_facture: "2026-09-02", progbat_bill_id: 2 }),
    ],
    [
      regl({ id: "r-1", facture_id: "f-1", montant: 600 }),
      regl({ id: "r-2", facture_id: "f-2", montant: 300 }),
    ],
  );
  assert.equal(c.parLigne.size, 1);
  assert.equal(c.lignesLiees, 1, "la ligne n'est comptée qu'une fois");
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.ttc_du, 1200, "les deux factures s'additionnent");
  assert.equal(pg.regle, 900);
  assert.equal(pg.ratio, 0.75);
  assert.equal(c.totaux.facture_ht, 1000, "le HT prévu de la ligne, une seule fois");
  assert.equal(c.totaux.encaisse_ht, 750);
});

test("29. facture manuelle ET ProGBat sur la même ligne : un comptage, un avertissement", () => {
  const lignes = [ligneEtat({
    montantAttendu: 1000,
    factures: [{ id: "man-1", numero: "MAN-1", montant_ht: 900, statut: "encaissee" }],
    montantEmis: 900, montantEncaisse: 900,
  })];
  const c = croiser(
    lignes,
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 1200 })],
    10000,
    { emis: 900, encaisse: 900 },   // totaux manuels actuels
  );
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.doublon_manuel, true, "le doublon est signalé");
  assert.equal(c.totaux.doublons, 1);
  // 900 manuels retirés, 1000 de HT prévu ajoutés : la ligne compte UNE fois.
  assert.equal(c.totaux.facture_ht, 1000);
  assert.equal(c.totaux.encaisse_ht, 1000);
});

test("30. aucun rattachement ProGBat : les totaux manuels sont rigoureusement intacts", () => {
  const lignes = [
    ligneEtat({ id: "acompte", nom: "Facture d'acompte", montantAttendu: 5000,
      factures: [{ id: "man-1", montant_ht: 4800, statut: "encaissee" }], montantEmis: 4800, montantEncaisse: 4800 }),
    ligneEtat({ id: "solde", nom: "Facture de solde", montantAttendu: 500 }),
  ];
  const totauxManuels = { emis: 4800, encaisse: 4800 };
  // Des factures ProGBat existent, mais AUCUNE n'est rattachée.
  const c = croiser(lignes, [fact({ id: "f-1", ligne_id: null, montant_ttc: 1200 })], [], 10000, totauxManuels);
  assert.equal(c.actif, false);
  assert.equal(c.lignesLiees, 0);
  assert.equal(c.parLigne.size, 0);
  assert.equal(c.totaux.facture_ht, 4800, "exactement le total manuel");
  assert.equal(c.totaux.encaisse_ht, 4800);
  assert.equal(c.totaux.reste_a_facturer_ht, 5200);
});

test("31. un document d'annulation n'est jamais rattaché ni compté", () => {
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [
      fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 }),
      // Même si un ligne_id traînait sur une annulation, elle est écartée en
      // amont par composerFacturesProgbat : elle n'atteint pas le croisement.
      fact({ id: "f-2", ligne_id: "situation_1", montant_ttc: -1200, progbat_situation_number: -469 }),
    ],
    [
      regl({ id: "r-1", facture_id: "f-1", montant: 1200 }),
      regl({ id: "r-2", facture_id: "f-2", montant: -1200 }),
    ],
  );
  const pg = c.parLigne.get("situation_1");
  assert.equal(pg.entrees.length, 1, "seule la facture active est liée");
  assert.equal(pg.ttc_du, 1200, "l'annulation n'entre pas dans le TTC dû");
  assert.equal(pg.regle, 1200, "son règlement non plus");
  assert.equal(pg.equivalent_ht, 1000);
  assert.equal(c.totaux.encaisse_ht, 1000);
});

test("32. cas réel #83 : quatre échéances réglées, le solde non facturé", () => {
  // Marché et pourcentages RÉELS de l'échéancier — aucun montant en dur : les
  // HT prévus sont calculés depuis le marché et les pourcentages.
  const marche = 29714.27 / 0.95;   // les 4 lignes rattachées couvrent 95 %
  const ht = (pct) => Math.round((marche * pct) / 100 * 100) / 100;
  const lignes = [
    ligneEtat({ id: "acompte", nom: "Facture d'acompte", pct: 50, montantAttendu: ht(50) }),
    ligneEtat({ id: "demarrage", nom: "Facture de démarrage", pct: 20, montantAttendu: ht(20) }),
    ligneEtat({ id: "situation_1", nom: "Facture de situation n° 1", pct: 15, montantAttendu: ht(15) }),
    ligneEtat({ id: "situation_2", nom: "Facture de situation n° 2", pct: 10, montantAttendu: ht(10) }),
    ligneEtat({ id: "solde", nom: "Facture de solde", pct: 5, montantAttendu: ht(5) }),
  ];
  const factures = [
    fact({ id: "f-45", numero: "F-260045", ligne_id: "acompte", montant_ttc: 12000, progbat_situation_number: 0, date_facture: "2026-05-02", progbat_bill_id: 400 }),
    fact({ id: "f-50", numero: "F-260050", ligne_id: "demarrage", montant_ttc: 7000, progbat_situation_number: 0, date_facture: "2026-06-03", progbat_bill_id: 410 }),
    fact({ id: "f-81", numero: "F-260081", ligne_id: "situation_1", montant_ttc: 6000, progbat_situation_number: 1, date_facture: "2026-07-03", progbat_bill_id: 470 }),
    fact({ id: "f-111", numero: "F-260111", ligne_id: "situation_2", montant_ttc: 4714.27, progbat_situation_number: 2, date_facture: "2026-08-03", progbat_bill_id: 500 }),
    // Les deux annulations restent dans l'historique, rattachées à rien.
    fact({ id: "f-42", numero: "F-260042", montant_ttc: -15639.11, progbat_situation_number: -469, date_facture: "2026-06-20", progbat_bill_id: 480 }),
    fact({ id: "f-44", numero: "F-260044", montant_ttc: -16317.15, progbat_situation_number: -485, date_facture: "2026-06-28", progbat_bill_id: 490 }),
  ];
  const reglements = [
    regl({ id: "r-45", facture_id: "f-45", montant: 12000 }),
    regl({ id: "r-50", facture_id: "f-50", montant: 7000 }),
    regl({ id: "r-81", facture_id: "f-81", montant: 6000 }),
    regl({ id: "r-111", facture_id: "f-111", montant: 4714.27 }),
  ];

  const compose = composerFacturesProgbat(factures, reglements);
  assert.equal(compose.factures_actives.length, 4);
  assert.equal(compose.documents_annulation.length, 2, "F-260042 et F-260044 restent dans l'historique");

  const c = croiserEcheancierProgbat({
    lignesEtat: lignes, actives: compose.factures_actives,
    montantReference: marche, totauxManuels: { emis: 0, encaisse: 0 },
  });

  assert.equal(c.lignesLiees, 4, "quatre échéances portent une facture ProGBat");
  for (const id of ["acompte", "demarrage", "situation_1", "situation_2"]) {
    const pg = c.parLigne.get(id);
    assert.equal(pg.etat, ETAT.REGLEE, `${id} doit être réglée`);
    assert.equal(pg.ratio, 1);
    assert.equal(pg.anomalie, null);
    assert.equal(pg.equivalent_ht, pg.montant_attendu_ht, `${id} contribue pour tout son HT prévu`);
  }
  assert.equal(c.parLigne.has("solde"), false, "la ligne de solde reste non facturée");

  // Facturé = les 95 % rattachés ; reste à facturer = les 5 % du solde.
  const attendu95 = Math.round((lignes.slice(0, 4).reduce((s, l) => s + l.montantAttendu, 0)) * 100) / 100;
  assert.equal(c.totaux.facture_ht, attendu95);
  assert.equal(c.totaux.encaisse_ht, attendu95, "tout est réglé");
  assert.equal(c.totaux.reste_a_facturer_ht, Math.round((marche - attendu95) * 100) / 100);
  assert.equal(c.totaux.anomalies, 0);
  assert.equal(c.totaux.doublons, 0);

  // Les suggestions : rien pour l'acompte ni le démarrage (situationNumber 0),
  // les deux situations proposables.
  assert.equal(suggestionLigneProgbat(factures[0], ECHEANCIER), null);
  assert.equal(suggestionLigneProgbat(factures[1], ECHEANCIER), null);
  assert.equal(suggestionLigneProgbat(factures[2], ECHEANCIER).ligne_id, "situation_1");
  assert.equal(suggestionLigneProgbat(factures[3], ECHEANCIER).ligne_id, "situation_2");
});

test("33. écriture de rattachement : payload borné, UPDATE contrôlé, aucun effet", () => {
  // Le patch vient de corrigerLigneFacture : aucune colonne ProGBat, aucun
  // montant. Seulement le rattachement, son verrou et sa trace.
  const patch = corrigerLigneFacture({ id: "f-1", ligne_id: null }, {
    ligneId: "situation_1", ligneNom: "Facture de situation n° 1",
    utilisateurId: "u-1", maintenant: "2026-09-17T10:00:00.000Z", raison: "test",
  });
  assert.deepEqual(Object.keys(patch).sort(), [
    "ligne_id", "ligne_id_modifie_le", "ligne_id_modifie_par", "ligne_id_verrouille",
    "ligne_nom", "raison", "rapprochement",
  ].sort());
  assert.equal(patch.ligne_id, "situation_1");
  assert.equal(patch.ligne_id_verrouille, true);
  assert.equal(patch.rapprochement, "corrige");
  // Détachement : les mêmes colonnes, vidées.
  const detach = corrigerLigneFacture({ id: "f-1", ligne_id: "situation_1" }, {
    ligneId: null, maintenant: "2026-09-17T10:00:00.000Z", raison: "retrait",
  });
  assert.equal(detach.ligne_id, null);
  assert.equal(detach.ligne_nom, null);

  // Côté écran : l'UPDATE est borné par l'id ET par source='progbat', demande
  // .select("id"), et n'est un succès qu'à exactement une ligne.
  assert.match(ECRAN, /\.update\(\{ \.\.\.patch, ligne_id_modifie_par: session\?\.user\?\.id \?\? null \}\)/);
  assert.match(ECRAN, /\.eq\("id", facture\.id\)\s*\n\s*\.eq\("source", "progbat"\)\s*\n\s*\.select\("id"\)/);
  assert.match(ECRAN, /if \(n !== 1\)/);
  assert.match(ECRAN, /aucune facture ProGBat ne correspond/);
  assert.match(ECRAN, /lignes auraient été modifiées alors qu'une seule était visée/);

  // AUCUNE écriture dans un effet : le seul useEffect du module appelle la
  // lecture, et les deux écritures partent d'un onClick / onChange.
  const effets = [...ECRAN.matchAll(/React\.useEffect\(\(\) => \{([\s\S]*?)\}, \[/g)].map((m) => m[1]);
  for (const corps of effets) {
    for (const verbe of [".update(", ".insert(", ".delete(", ".upsert("]) {
      assert.ok(!corps.includes(verbe), `aucun ${verbe} dans un useEffect`);
    }
  }
  assert.ok(ECRAN.includes("onRattacher?.(facture"), "le rattachement part d'un clic");
  assert.ok(ECRAN.includes("onDetacher?.(facture"), "le détachement aussi");
  assert.ok(ECRAN.includes("window.confirm("), "le détachement demande confirmation");
});

test("34. écran : l'import manuel disparaît sur une échéance couverte par ProGBat", () => {
  assert.match(ECRAN, /\{!f && !pg && \(/, "import manuel seulement sans facture ProGBat");
  assert.match(ECRAN, /Facturée dans ProGBat — import manuel inutile\./);
  // Le bandeau bascule sur l'équivalent HT, et le dit.
  assert.match(ECRAN, /const bandeau = croisement\.actif \?/);
  assert.match(ECRAN, /Équivalent HT <strong>selon l'échéancier<\/strong>/);
  // Aucun HT reconstitué depuis un TTC, nulle part.
  for (const source of [ECRAN, lire("src/Renovation/facturesProgbatAffichage.mjs")]) {
    assert.ok(!/\/\s*1[.,]2\b/.test(source), "aucune division par 1,2 : le HT ne se reconstitue pas");
    assert.ok(!/montant_ttc\s*\/\s*\(?1\s*\+/.test(source), "aucun HT déduit d'un taux de TVA");
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 quinquies. ÉTAT VISUEL D'UNE ÉCHÉANCE COUVERTE PAR ProGBat
// ═══════════════════════════════════════════════════════════════════════════
/** Le style de la ligne « situation_1 » pour un jeu facture/règlements donné. */
const visuel = (factures, reglements, ligne = ligneEtat({ montantAttendu: 1000 })) =>
  statutVisuelLigneProgbat(croiser([ligne], factures, reglements).parLigne.get("situation_1"));

test("35. ligne sans facture ProGBat : aucun style imposé, le manuel reste maître", () => {
  assert.equal(statutVisuelLigneProgbat(null), null);
  assert.equal(statutVisuelLigneProgbat(undefined), null);
  // Une facture ProGBat non rattachée ne couvre aucune ligne.
  const c = croiser([ligneEtat({ montantAttendu: 1000 })], [fact({ id: "f-1", ligne_id: null, montant_ttc: 500 })], []);
  assert.equal(c.parLigne.size, 0);
  assert.equal(statutVisuelLigneProgbat(c.parLigne.get("situation_1")), null,
    "sans couverture ProGBat, l'écran garde STATUT_STYLE");
});

test("36. facture émise sans aucun règlement → ÉMISE, jamais « à émettre »", () => {
  const v = visuel([fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })], []);
  assert.equal(v.cle, "emise");
  assert.equal(v.label, "émise");
  assert.equal(v.couleur, "#4db8ff");
  assert.equal(v.plein, true, "la bordure est pleine : l'échéance est engagée, pas future");
  assert.equal(v.coche, false);
  assert.equal(v.alerte, false, "aucune carte orange");
});

test("37. paiement partiel → PARTIELLEMENT RÉGLÉE, distinct d'émise et de réglée", () => {
  const v = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 400 })],
  );
  assert.equal(v.cle, "partielle");
  assert.equal(v.label, "partiellement réglée");
  assert.equal(v.coche, false, "pas de coche tant que tout n'est pas réglé");
  assert.equal(v.alerte, false);
  // Distinct des deux voisins : ni le bleu d'émise, ni le vert plein de réglée.
  const emise = visuel([fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })], []);
  const reglee = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 1200 })],
  );
  assert.notEqual(v.couleur, emise.couleur);
  assert.notEqual(`${v.couleur}|${v.plein}`, `${reglee.couleur}|${reglee.plein}`);
});

test("38. totalement réglée, à la tolérance du centime → RÉGLÉE, vert, cochée", () => {
  const v = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 925.16 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 925.15 })],
  );
  assert.equal(v.cle, "reglee");
  assert.equal(v.label, "réglée");
  assert.equal(v.couleur, "#22c55e");
  assert.equal(v.coche, true, "cercle coché vert");
  assert.equal(v.alerte, false, "la carte n'est plus orange");
});

test("39. surpayée → SURPAYÉE, avertissement, jamais présentée comme réglée", () => {
  const v = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1000 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 1500 })],
  );
  assert.equal(v.cle, "surpayee");
  assert.equal(v.label, "surpayée");
  assert.equal(v.couleur, "#f59e0b");
  assert.equal(v.coche, false, "surpayée n'est pas cochée comme soldée");
  assert.equal(v.alerte, true);
});

test("40. anomalies → À VÉRIFIER, jamais un état réglé inventé", () => {
  // a. Signe incohérent : remboursement sur une facture positive.
  const signe = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: -300 })],
  );
  assert.equal(signe.cle, "a_verifier");
  assert.equal(signe.label, "à vérifier");
  assert.equal(signe.couleur, "#e15a5a");
  assert.equal(signe.coche, false);
  assert.equal(signe.alerte, true);

  // b. TTC non positif : un avoir actif seul sur la ligne. Surtout pas « réglée ».
  const avoir = visuel([fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: -900 })], []);
  assert.equal(avoir.cle, "a_verifier");
  assert.equal(avoir.coche, false, "un avoir actif ne coche jamais l'échéance");

  // c. Avoir actif remboursé : l'anomalie ttc_non_positif prime sur l'état.
  const rembourse = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: -900 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: -900 })],
  );
  assert.equal(rembourse.cle, "a_verifier");
  assert.equal(rembourse.coche, false);

  // d. Montant illisible.
  const illisible = visuel([fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: null })], []);
  assert.equal(illisible.cle, "a_verifier");
});

test("41. manuel + ProGBat sur la même ligne → DOUBLON À VÉRIFIER, prioritaire", () => {
  const ligne = ligneEtat({
    montantAttendu: 1000,
    factures: [{ id: "man-1", numero: "MAN-1", montant_ht: 900, statut: "encaissee" }],
    montantEmis: 900, montantEncaisse: 900,
  });
  // Même entièrement réglée côté ProGBat, le doublon passe devant.
  const v = visuel(
    [fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 1200 })],
    [regl({ id: "r-1", facture_id: "f-1", montant: 1200 })],
    ligne,
  );
  assert.equal(v.cle, "doublon");
  assert.equal(v.label, "doublon à vérifier");
  assert.equal(v.coche, false, "on ne coche pas une ligne dont on ignore quel document fait foi");
  assert.equal(v.alerte, true);
});

test("42. plusieurs factures ProGBat sur une ligne → UN seul état agrégé", () => {
  const v = visuel(
    [
      fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 600, progbat_bill_id: 1 }),
      fact({ id: "f-2", ligne_id: "situation_1", montant_ttc: 600, progbat_bill_id: 2 }),
    ],
    [
      regl({ id: "r-1", facture_id: "f-1", montant: 600 }),
      regl({ id: "r-2", facture_id: "f-2", montant: 600 }),
    ],
  );
  assert.equal(v.cle, "reglee", "les deux factures soldées donnent UNE échéance réglée");
  // L'une réglée, l'autre pas → partiel, pas deux pastilles.
  const partiel = visuel(
    [
      fact({ id: "f-1", ligne_id: "situation_1", montant_ttc: 600, progbat_bill_id: 1 }),
      fact({ id: "f-2", ligne_id: "situation_1", montant_ttc: 600, progbat_bill_id: 2 }),
    ],
    [regl({ id: "r-1", facture_id: "f-1", montant: 600 })],
  );
  assert.equal(partiel.cle, "partielle");
});

test("43. un document d'annulation ne donne aucun état à une échéance", () => {
  // Seule une facture ACTIVE couvre une ligne : l'annulation est écartée en
  // amont, la ligne n'existe donc pas dans le croisement.
  const c = croiser(
    [ligneEtat({ montantAttendu: 1000 })],
    [fact({ id: "f-2", ligne_id: "situation_1", montant_ttc: -1200, progbat_situation_number: -469 })],
    [],
  );
  assert.equal(c.parLigne.size, 0);
  assert.equal(statutVisuelLigneProgbat(c.parLigne.get("situation_1")), null,
    "la ligne garde son affichage manuel");
});

test("44. cas réel #83 : quatre pastilles RÉGLÉE vertes, le solde intact", () => {
  const marche = 29714.27 / 0.95;
  const ht = (pct) => Math.round((marche * pct) / 100 * 100) / 100;
  const lignes = [
    ligneEtat({ id: "acompte", nom: "Facture d'acompte", pct: 50, montantAttendu: ht(50) }),
    ligneEtat({ id: "demarrage", nom: "Facture de démarrage", pct: 20, montantAttendu: ht(20) }),
    ligneEtat({ id: "situation_1", nom: "Facture de situation n° 1", pct: 15, montantAttendu: ht(15) }),
    ligneEtat({ id: "situation_2", nom: "Facture de situation n° 2", pct: 10, montantAttendu: ht(10) }),
    ligneEtat({ id: "solde", nom: "Facture de solde", pct: 5, montantAttendu: ht(5) }),
  ];
  const factures = [
    fact({ id: "f-45", numero: "F-260045", ligne_id: "acompte", montant_ttc: 12000, progbat_bill_id: 400 }),
    fact({ id: "f-50", numero: "F-260050", ligne_id: "demarrage", montant_ttc: 7000, progbat_bill_id: 410 }),
    fact({ id: "f-81", numero: "F-260081", ligne_id: "situation_1", montant_ttc: 6000, progbat_situation_number: 1, progbat_bill_id: 470 }),
    fact({ id: "f-111", numero: "F-260111", ligne_id: "situation_2", montant_ttc: 4714.27, progbat_situation_number: 2, progbat_bill_id: 500 }),
    fact({ id: "f-42", numero: "F-260042", montant_ttc: -15639.11, progbat_situation_number: -469, progbat_bill_id: 480 }),
    fact({ id: "f-44", numero: "F-260044", montant_ttc: -16317.15, progbat_situation_number: -485, progbat_bill_id: 490 }),
  ];
  const reglements = [
    regl({ id: "r-45", facture_id: "f-45", montant: 12000 }),
    regl({ id: "r-50", facture_id: "f-50", montant: 7000 }),
    regl({ id: "r-81", facture_id: "f-81", montant: 6000 }),
    regl({ id: "r-111", facture_id: "f-111", montant: 4714.27 }),
  ];
  const c = croiserEcheancierProgbat({
    lignesEtat: lignes,
    actives: composerFacturesProgbat(factures, reglements).factures_actives,
    montantReference: marche, totauxManuels: { emis: 0, encaisse: 0 },
  });

  for (const id of ["acompte", "demarrage", "situation_1", "situation_2"]) {
    const v = statutVisuelLigneProgbat(c.parLigne.get(id));
    assert.equal(v.cle, "reglee", `${id} doit afficher RÉGLÉE`);
    assert.equal(v.couleur, "#22c55e", `${id} doit être vert`);
    assert.equal(v.coche, true);
    assert.equal(v.alerte, false, `${id} ne doit plus être orange`);
  }
  // Le solde n'est couvert par aucune facture ProGBat : rien ne le touche.
  assert.equal(statutVisuelLigneProgbat(c.parLigne.get("solde")), null,
    "le solde garde sa pastille « prévue » et son bouton d'import");

  // Les montants du bandeau ne bougent pas d'un centime : ce lot n'est que visuel.
  const attendu95 = Math.round(lignes.slice(0, 4).reduce((s, l) => s + l.montantAttendu, 0) * 100) / 100;
  assert.equal(c.totaux.facture_ht, attendu95);
  assert.equal(c.totaux.encaisse_ht, attendu95);
});

test("45. écran : la pastille suit ProGBat, l'import reste masqué, rien n'est recalculé", () => {
  // Le style vient du helper pur, pas d'un calcul refait dans le JSX.
  assert.match(ECRAN, /const vis = statutVisuelLigneProgbat\(pg\);/);
  assert.match(ECRAN, /const st = vis \|\| STATUT_STYLE\[l\.statut\] \|\| STATUT_STYLE\.attente;/);
  assert.match(ECRAN, /const alerte = vis \? vis\.alerte : l\.prete;/);
  assert.match(ECRAN, /const coche = vis \? vis\.coche : l\.statut === "encaissee";/);
  // L'import manuel reste masqué sur une échéance couverte par ProGBat.
  assert.match(ECRAN, /\{!f && !pg && \(/);
  // Aucun useEffect ajouté : le module n'en a toujours qu'un, celui de lecture.
  assert.equal((ECRAN.match(/React\.useEffect\(/g) || []).length, 2,
    "un effet de lecture ProGBat + celui, préexistant, de la modale d'import");
  // Aucune requête ni écriture supplémentaire : ce lot est purement visuel.
  assert.equal((ECRAN.match(/supabase\.from\(/g) || []).length, 6,
    "le nombre de requêtes est inchangé");
  assert.deepEqual([...new Set((ECRAN.match(/supabase\.from\("[a-z_]+"\)/g) || []))].sort(), [
    'supabase.from("chantier_factures_client")',
    'supabase.from("chantier_factures_reglements")',
  ], "les mêmes deux tables qu'avant, et elles seules");
  // Une seule écriture dans tout l'écran ProGBat : le rattachement.
  assert.equal((ECRAN.match(/\.update\(\{ \.\.\.patch/g) || []).length, 1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. NATURE ET LIBELLÉ
// ═══════════════════════════════════════════════════════════════════════════
test("nature : acompte, avoir, facture — dans cet ordre", () => {
  assert.equal(natureFactureProgbat(fact({ progbat_type: "advance", montant_ttc: 500 })), "acompte");
  assert.equal(natureFactureProgbat(fact({ progbat_type: "advance", montant_ttc: -500 })), "acompte",
    "un acompte reste un acompte : son type prime sur son signe");
  assert.equal(natureFactureProgbat(fact({ progbat_type: "bill", montant_ttc: -925.15 })), "avoir");
  assert.equal(natureFactureProgbat(fact({ progbat_type: "bill", montant_ttc: 925.15 })), "facture");
  assert.equal(natureFactureProgbat(fact({ progbat_type: null, montant_ttc: null })), "facture");
});

test("libellé : numéro, puis code, puis repli sur l'identifiant ProGBat", () => {
  assert.equal(libelleFactureProgbat({ numero: "FA-1001", progbat_bill_code: "X", progbat_bill_id: 7 }), "FA-1001");
  assert.equal(libelleFactureProgbat({ numero: "  ", progbat_bill_code: "FA-CODE", progbat_bill_id: 7 }), "FA-CODE");
  assert.equal(libelleFactureProgbat({ numero: null, progbat_bill_code: null, progbat_bill_id: 7 }), "Facture ProGBat n°7");
  assert.equal(libelleFactureProgbat({}), "Facture ProGBat");
});

test("libellés d'état : exactement ceux attendus par l'écran", () => {
  assert.deepEqual(LIBELLE_ETAT, {
    montant_inconnu: "Montant inconnu",
    non_reglee: "Non réglée",
    partielle: "Partiellement réglée",
    reglee: "Réglée",
    sur_reglee: "Sur-réglée",
    avoir_non_rembourse: "Avoir non remboursé",
    avoir_partiel: "Partiellement remboursé",
    avoir_rembourse: "Remboursé",
    avoir_sur_rembourse: "Sur-remboursé",
    signe_incoherent: "Signe incohérent",
  });
});

test("progbat_status n'entre dans aucun calcul", () => {
  const source = lire("src/Renovation/facturesProgbatAffichage.mjs")
    .split("\n").filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*")).join("\n");
  assert.ok(!source.includes("progbat_status"), "seules les transactions font foi");
  // Deux factures identiques, status différents : même état.
  const a = etatFactureProgbat(fact({ montant_ttc: 1000, progbat_status: 1 }), []);
  const b = etatFactureProgbat(fact({ montant_ttc: 1000, progbat_status: 0 }), []);
  assert.equal(a.etat, b.etat);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. L'ÉCRAN — lecture seule, colonnes nommées, rien de nominatif
// ═══════════════════════════════════════════════════════════════════════════
test("écran : uniquement des SELECT, colonnes nommées, aucun select(*)", () => {
  // Le bloc ProGBat ajouté.
  assert.match(ECRAN, /from\("chantier_factures_client"\)\s*\n?\s*\.select\("id,numero,date_facture/);
  assert.match(ECRAN, /from\("chantier_factures_reglements"\)\s*\n?\s*\.select\("id,facture_id,date_reglement,montant,progbat_transaction_id,annule"\)/);
  assert.ok(!ECRAN.includes('.select("*")'), "aucun select(*) dans cet écran");

  // Aucune écriture ajoutée sur la table des règlements, ni d'appel aux
  // fonctions de synchronisation.
  for (const verbe of ["insert(", "update(", "upsert(", "delete("]) {
    assert.ok(!new RegExp(`chantier_factures_reglements"\\)[\\s\\S]{0,120}\\.${verbe.replace("(", "\\(")}`).test(ECRAN),
      `aucune écriture ${verbe} sur les règlements`);
  }
  // Sur le CODE seul : une fonction NOMMÉE dans un commentaire n'est pas un
  // appel, mais un appel réel doit être introuvable.
  const CODE = ECRAN.split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
  for (const fonction of ["progbat-billing-sync", "progbat-billing-dry-run", "functions.invoke"]) {
    assert.ok(!CODE.includes(fonction), `${fonction} n'a rien à faire dans cet écran`);
  }
});

test("écran : aucune donnée nominative, bancaire ni payload n'est demandée", () => {
  for (const colonne of [
    "client", "adresse", "address", "email", "telephone", "phone",
    "bank", "iban", "paymentNumber", "payload", "progbat_tax_details",
    "progbat_deductions", "extraction",
  ]) {
    assert.ok(!new RegExp(`select\\("[^"]*${colonne}`, "i").test(ECRAN),
      `la colonne « ${colonne} » ne doit pas être sélectionnée`);
  }
  // Le mode de règlement n'est pas lu non plus : il n'est pas nécessaire.
  assert.ok(!/select\("id,facture_id,date_reglement,montant,progbat_transaction_id,annule,mode/.test(ECRAN));
});

test("écran : le bloc manuel ne reçoit plus les factures ProGBat", () => {
  // Depuis la synchronisation, chantier_factures_client contient les deux
  // régimes. Le chargement de l'échéancier manuel doit donc filtrer.
  const PAGE = lire("src/Renovation/PageChantiers.jsx");
  assert.match(PAGE, /from\("chantier_factures_client"\)[\s\S]{0,160}\.eq\("source", "manuel"\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
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
console.log(`\nverif-factures-progbat-affichage : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
