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
  libelleFactureProgbat, natureFactureProgbat, reglementsActifs,
  sommeReglements, totauxFacturesProgbat,
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
  const { lignes, totaux } = composerFacturesProgbat(factures, reglements);
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
  assert.deepEqual(vide.lignes, []);
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
  assert.equal(sansRegl.lignes[0].reglements.length, 0);
  assert.equal(sansRegl.lignes[0].etat.etat, ETAT.NON_REGLEE);
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
