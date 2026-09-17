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
} = await import(new URL("../src/Renovation/facturesProgbatAffichage.mjs", import.meta.url).href);

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
