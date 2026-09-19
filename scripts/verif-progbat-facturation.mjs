#!/usr/bin/env node
// Vérifie le stockage des factures et règlements ProGBat :
//   1. les règles pures src/Renovation/progbatFacturation.mjs ;
//   2. par analyse statique, la migration sql/202609_facturation_progbat.sql
//      (contraintes, unicité, RLS, triggers) — seul contrôle possible sans
//      base locale, et il attrape ce qui compte : une contrainte oubliée, un
//      grant d'écriture à authenticated, un index de dédoublonnage manquant.
//
// Aucun appel réseau, aucune base, aucune migration exécutée.
//   node scripts/verif-progbat-facturation.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  REFUS, ETAT_REGLEMENT, TOLERANCE_EUR,
  normaliserFactureProgbat, fusionnerFactureProgbat,
  normaliserReglementProgbat, reglementsDeTransaction,
  etatReglementProgbat, corrigerLigneFacture,
} from "../src/Renovation/progbatFacturation.mjs";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

// Facture réelle de situation : atiTotal CUMULATIF, acompte déduit, toBePaid
// exigible. Les champs client/adresse sont présents à dessein : ils ne doivent
// jamais ressortir.
const SITUATION = {
  id: 4711, code: "FA2026-0042", type: "bill", validated: 1, status: 0,
  documentDate: "2026-09-10T00:00:00.000Z", dueDate: "2026-10-10",
  quoteId: 453, yardId: 86, businessId: 83, situationNumber: 1, revisionNumber: 0,
  dealNetTotal: 1541.93, dealTaxes: 308.38, dealAtiTotal: 1850.31,
  achievement: 100, previousAchievement: 50,
  netTotal: 1541.93, taxes: 308.38, atiTotal: 1850.31,
  holdback: 0, deductedAdvance: 925.16, toBePaid: 925.15, atiDeductions: 0,
  dgd: false,
  taxDetails: [{ level: "1", rate: 20, base: 1541.93, amount: 308.38, secretInterne: "x" }],
  deductions: [{ label: "Acompte", amount: 925.16, afterTaxes: true, direction: "minus", taxRate: 20, thirdId: 7 }],
  clientName: "MOTTIMAC", clientBusinessName: "SCI MOTTIMAC", clientEmail: "contact@example.com",
  clientAddress: "10 Rue Alfred de Falloux", clientPostcode: "49520", clientCity: "Segré-en-Anjou Bleu",
  businessAddress: "10 Rue Alfred de Falloux", content: [{ label: "Ligne de devis", netUnitPrice: 12 }],
};

const AVOIR = { ...SITUATION, id: 4712, code: "AV2026-0007", situationNumber: null,
  dealAtiTotal: -1850.31, atiTotal: -925.15, netTotal: -770.96, taxes: -154.19,
  deductedAdvance: 0, toBePaid: -925.15, taxDetails: [], deductions: [] };

const ligneDe = (f, o) => {
  const r = normaliserFactureProgbat(f, o);
  assert.equal(r.ok, true, r.raison);
  return r.ligne;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. NORMALISATION D'UNE FACTURE
// ═══════════════════════════════════════════════════════════════════════════

test("brouillon refusé : validated ≠ 1 n'entre pas en base", () => {
  for (const v of [0, "0", null, undefined, 2]) {
    const r = normaliserFactureProgbat({ ...SITUATION, validated: v });
    assert.equal(r.ok, false, `validated=${v} doit être refusé`);
    assert.equal(r.motif, REFUS.BROUILLON);
  }
  // Et une facture validée passe.
  assert.equal(normaliserFactureProgbat(SITUATION).ok, true);
});

test("bill.id est la clé : sans lui, rien n'est importé", () => {
  for (const id of [0, -1, 1.5, "abc", null, undefined]) {
    const r = normaliserFactureProgbat({ ...SITUATION, id });
    assert.equal(r.ok, false, `id=${id} doit être refusé`);
    assert.equal(r.motif, REFUS.BILL_ID_INVALIDE);
  }
  // Le NUMÉRO, lui, n'est jamais une clé : une facture sans code s'importe.
  const sansCode = ligneDe({ ...SITUATION, code: null });
  assert.equal(sansCode.progbat_bill_id, 4711);
  assert.equal(sansCode.numero, null);
});

test("situation : montant_ttc = toBePaid, jamais atiTotal", () => {
  const l = ligneDe(SITUATION);
  assert.notEqual(SITUATION.atiTotal, SITUATION.toBePaid, "le jeu d'essai doit distinguer les deux");
  assert.equal(l.montant_ttc, 925.15);
  assert.equal(l.progbat_to_be_paid, 925.15);
  assert.equal(l.progbat_ati_total, 1850.31);
  assert.equal(l.progbat_deducted_advance, 925.16);
  // Le cumul et l'acompte restent lisibles séparément, et leur différence
  // retombe bien sur l'exigible : c'est la cohérence du jeu de données réel.
  assert.ok(Math.abs((l.progbat_ati_total - l.progbat_deducted_advance) - l.montant_ttc) <= 0.01);
});

test("HT et TVA restent null : aucune ventilation n'est inventée", () => {
  const l = ligneDe(SITUATION);
  assert.equal(l.montant_ht, null);
  assert.equal(l.montant_tva, null);
  // netTotal et taxes sont conservés à part, tels que ProGBat les donne : ils
  // suivent atiTotal cumulatif et ne sont donc pas le HT/TVA exigibles.
  assert.equal(l.progbat_net_total, 1541.93);
  assert.equal(l.progbat_taxes, 308.38);
  assert.notEqual(l.progbat_net_total, l.montant_ttc);
});

test("acompte : toBePaid = atiTotal, rien de déduit", () => {
  const acompte = { ...SITUATION, id: 4700, code: "FA2026-0001", situationNumber: null,
    atiTotal: 925.16, toBePaid: 925.16, deductedAdvance: 0, previousAchievement: 0 };
  const l = ligneDe(acompte);
  assert.equal(l.montant_ttc, 925.16);
  assert.equal(l.progbat_deducted_advance, 0);
  assert.equal(l.statut, "emise");
});

test("avoir négatif : type reste \"bill\", le signe est conservé", () => {
  const l = ligneDe(AVOIR);
  assert.equal(l.progbat_type, "bill");
  assert.equal(l.montant_ttc, -925.15);
  assert.equal(l.progbat_ati_total, -925.15);
  assert.equal(l.progbat_deal_ati_total, -1850.31);
  assert.ok(l.montant_ttc < 0, "aucune valeur absolue nulle part");
});

test("identifiants : 0 et invalides deviennent null, jamais 0", () => {
  const l = ligneDe({ ...SITUATION, quoteId: 0, yardId: "86", businessId: null });
  assert.equal(l.progbat_quote_id, null);     // quoteId = 0 = champ vide
  assert.equal(l.progbat_yard_id, 86);        // texte numérique accepté
  assert.equal(l.progbat_business_id, null);
});

test("taxDetails et deductions : liste blanche stricte", () => {
  const l = ligneDe(SITUATION);
  assert.deepEqual(Object.keys(l.progbat_tax_details[0]).sort(), ["amount", "base", "level", "rate"]);
  assert.deepEqual(Object.keys(l.progbat_deductions[0]).sort(),
    ["afterTaxes", "amount", "direction", "label", "taxRate"]);
  // Les champs non listés sont écartés, pas recopiés.
  assert.equal(l.progbat_tax_details[0].secretInterne, undefined);
  assert.equal(l.progbat_deductions[0].thirdId, undefined);
  // Une entrée sans aucun champ connu est écartée plutôt que stockée vide.
  const bruit = ligneDe({ ...SITUATION, taxDetails: [{ inconnu: 1 }, { rate: 10 }] });
  assert.equal(bruit.progbat_tax_details.length, 1);
  assert.equal(bruit.progbat_tax_details[0].rate, 10);
  // Absent → null (pas de tableau vide fabriqué) ; tableau vide → tableau vide.
  assert.equal(ligneDe({ ...SITUATION, taxDetails: undefined }).progbat_tax_details, null);
  assert.deepEqual(ligneDe({ ...SITUATION, deductions: [] }).progbat_deductions, []);
  // direction hors énumération documentée : écartée.
  const d = ligneDe({ ...SITUATION, deductions: [{ label: "X", direction: "sideways" }] });
  assert.equal(d.progbat_deductions[0].direction, null);
});

test("aucune fuite : ni client, ni adresse, ni e-mail, ni lignes de devis", () => {
  const l = ligneDe(SITUATION);
  const rendu = JSON.stringify(l);
  for (const interdit of ["MOTTIMAC", "contact@example.com", "Falloux", "Segré", "49520",
                          "clientName", "clientAddress", "content", "Ligne de devis", "secretInterne", "thirdId"]) {
    assert.ok(!rendu.includes(interdit), `${interdit} ne doit pas entrer en base`);
  }
  // La ligne ne porte que des clés connues du registre.
  const attendues = new Set([
    "source", "numero", "date_facture", "montant_ttc", "montant_ht", "montant_tva", "statut",
    "progbat_bill_id", "progbat_bill_code", "progbat_quote_id", "progbat_yard_id", "progbat_business_id",
    "progbat_type", "progbat_situation_number", "progbat_status", "progbat_validated",
    "progbat_revision_number", "progbat_document_date", "progbat_due_date",
    "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
    "progbat_achievement", "progbat_previous_achievement", "progbat_net_total", "progbat_taxes",
    "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance", "progbat_to_be_paid",
    "progbat_ati_deductions", "progbat_tax_details", "progbat_deductions", "progbat_dgd",
    "progbat_synced_at",
  ]);
  for (const k of Object.keys(l)) assert.ok(attendues.has(k), `clé inattendue : ${k}`);
  // Et pas de chantier_id : la résolution est le travail de progbatLiaison.
  assert.equal(l.chantier_id, undefined);
});

test("dates : ISO complet ou date seule, toujours une date seule en base", () => {
  const l = ligneDe(SITUATION);
  assert.equal(l.progbat_document_date, "2026-09-10");
  assert.equal(l.date_facture, "2026-09-10");
  assert.equal(l.progbat_due_date, "2026-10-10");
  assert.equal(ligneDe({ ...SITUATION, dueDate: null }).progbat_due_date, null);
});

test("toBePaid illisible : refus explicite, pas de repli sur atiTotal", () => {
  const r = normaliserFactureProgbat({ ...SITUATION, toBePaid: null });
  assert.equal(r.ok, false);
  assert.equal(r.motif, REFUS.MONTANT_ABSENT);
  // toBePaid = 0 est un montant valide, pas une absence.
  assert.equal(ligneDe({ ...SITUATION, toBePaid: 0 }).montant_ttc, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FUSION IDEMPOTENTE
// ═══════════════════════════════════════════════════════════════════════════

test("upsert répété : deux passages donnent exactement la même ligne", () => {
  const entrante = ligneDe(SITUATION, { synchroniseLe: "2026-09-16T10:00:00.000Z" });
  const creation = fusionnerFactureProgbat(null, entrante);
  assert.equal(creation.ok, true);
  assert.equal(creation.creation, true);

  const enBase = { ...creation.ligne, id: "uuid-1", chantier_id: "trottier" };
  const second = fusionnerFactureProgbat(enBase, entrante);
  assert.equal(second.creation, false);
  assert.deepEqual(second.ligne, enBase, "une synchronisation sans changement ne modifie rien");

  // Troisième passage sur le résultat du deuxième : toujours stable.
  assert.deepEqual(fusionnerFactureProgbat(second.ligne, entrante).ligne, enBase);
});

test("fusion : les montants suivent ProGBat, le chantier reste celui résolu", () => {
  const enBase = { id: "uuid-1", chantier_id: "trottier", ...ligneDe(SITUATION) };
  const corrigee = ligneDe({ ...SITUATION, toBePaid: 900.00, code: "FA2026-0042-B" });
  const { ligne } = fusionnerFactureProgbat(enBase, corrigee);
  assert.equal(ligne.montant_ttc, 900);
  assert.equal(ligne.progbat_to_be_paid, 900);
  assert.equal(ligne.numero, "FA2026-0042-B");
  assert.equal(ligne.chantier_id, "trottier", "le chantier résolu n'est jamais écrasé");
});

test("fusion : un statut humain n'est pas ramené à « emise »", () => {
  const enBase = { id: "uuid-1", chantier_id: "trottier", ...ligneDe(SITUATION), statut: "encaissee" };
  const { ligne } = fusionnerFactureProgbat(enBase, ligneDe(SITUATION));
  assert.equal(ligne.statut, "encaissee");
  // Et aucune annulation n'est décidée depuis ProGBat dans ce lot.
  const annulee = { ...enBase, statut: "annulee" };
  assert.equal(fusionnerFactureProgbat(annulee, ligneDe({ ...SITUATION, status: 9 })).ligne.statut, "annulee");
});

test("ligne_id verrouillé : jamais écrasé par la synchronisation", () => {
  const enBase = {
    id: "uuid-1", chantier_id: "trottier", ...ligneDe(SITUATION),
    ligne_id: "situation_1", ligne_nom: "Situation n° 1", rapprochement: "corrige",
    raison: "Corrigée à la main le 16/09.",
    ligne_id_verrouille: true, ligne_id_modifie_par: "u-1", ligne_id_modifie_le: "2026-09-16T09:00:00.000Z",
  };
  const entrante = { ...ligneDe(SITUATION), ligne_id: "acompte", ligne_nom: "Acompte", rapprochement: "auto", raison: "Proposé." };
  const { ligne } = fusionnerFactureProgbat(enBase, entrante);
  assert.equal(ligne.ligne_id, "situation_1");
  assert.equal(ligne.ligne_nom, "Situation n° 1");
  assert.equal(ligne.rapprochement, "corrige");
  assert.equal(ligne.raison, "Corrigée à la main le 16/09.");
  assert.equal(ligne.ligne_id_verrouille, true);
  assert.equal(ligne.ligne_id_modifie_par, "u-1");
  // Non verrouillé : une proposition peut mettre à jour l'échéance.
  const libre = { ...enBase, ligne_id_verrouille: false };
  assert.equal(fusionnerFactureProgbat(libre, entrante).ligne.ligne_id, "acompte");
  // …et l'absence de proposition n'efface jamais l'existant.
  assert.equal(fusionnerFactureProgbat(libre, ligneDe(SITUATION)).ligne.ligne_id, "situation_1");
});

test("facture manuelle : jamais transformée en facture ProGBat", () => {
  const manuelle = {
    id: "uuid-9", chantier_id: "trottier", source: "manuel", numero: "FA2026-0042",
    montant_ht: 1541.93, montant_tva: 308.38, montant_ttc: 1850.31, statut: "encaissee",
  };
  const r = fusionnerFactureProgbat(manuelle, ligneDe(SITUATION));
  assert.equal(r.ok, false);
  assert.equal(r.motif, REFUS.FACTURE_MANUELLE);
  assert.equal(manuelle.source, "manuel", "la facture manuelle n'est pas touchée");
  assert.equal(manuelle.montant_ht, 1541.93);
});

test("fusion : deux bill.id différents ne se rapprochent pas", () => {
  const enBase = { id: "uuid-1", ...ligneDe(SITUATION) };
  const r = fusionnerFactureProgbat(enBase, ligneDe(AVOIR));
  assert.equal(r.ok, false);
  assert.equal(r.motif, REFUS.BILL_DIFFERENT);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RÈGLEMENTS
// ═══════════════════════════════════════════════════════════════════════════

const TRANSACTION = {
  id: 9001, date: "2026-09-20", amount: 925.15, canceled: 0, paymentMode: "VIR",
  bankAccountId: 3, label: "VIR SEPA SCI MOTTIMAC", paymentNumber: "VIR-77",
  iban: "FR7630006000011234567890189",
  checking: [{ docType: "bill", docId: 4711, amount: 500, thirdId: 7 }],
};

test("règlement : docType « bill » exactement, rien d'autre", () => {
  for (const docType of ["supplierbill", "quote", "Bill", "BILL", "", null, undefined]) {
    const r = normaliserReglementProgbat(TRANSACTION, { docType, docId: 4711, amount: 100 });
    assert.equal(r.ok, false, `docType=${docType} doit être refusé`);
    assert.equal(r.motif, REFUS.DOC_TYPE);
  }
  assert.equal(normaliserReglementProgbat(TRANSACTION, TRANSACTION.checking[0]).ok, true);
});

test("règlement : identifiants exigés, montant signé, date reprise", () => {
  const r = normaliserReglementProgbat(TRANSACTION, { docType: "bill", docId: 4711, amount: -925.15 });
  const ligne = r.ligne;
  assert.equal(ligne.progbat_transaction_id, 9001);
  assert.equal(ligne.progbat_doc_type, "bill");
  // Le bill.id est une clé de RÉSOLUTION : il est rendu à côté de la ligne,
  // jamais dedans — chantier_factures_reglements n'a pas cette colonne.
  assert.equal(r.progbat_bill_id, 4711);
  assert.equal(ligne.progbat_bill_id, undefined);
  assert.equal(ligne.montant, -925.15, "le signe du lettrage est conservé");
  assert.equal(ligne.date_reglement, "2026-09-20");
  assert.equal(ligne.mode, "VIR");
  for (const docId of [0, -3, "x", null]) {
    assert.equal(normaliserReglementProgbat(TRANSACTION, { docType: "bill", docId, amount: 1 }).motif,
      REFUS.DOC_ID_INVALIDE);
  }
  assert.equal(normaliserReglementProgbat({ ...TRANSACTION, id: 0 }, TRANSACTION.checking[0]).motif,
    REFUS.TRANSACTION_INVALIDE);
  assert.equal(normaliserReglementProgbat(TRANSACTION, { docType: "bill", docId: 4711, amount: null }).motif,
    REFUS.MONTANT_INVALIDE);
});

test("règlement : aucune donnée bancaire ne sort", () => {
  const { retenus } = reglementsDeTransaction(TRANSACTION);
  const rendu = JSON.stringify(retenus);
  for (const interdit of ["bankAccountId", "label", "VIR SEPA", "paymentNumber", "VIR-77", "iban", "FR7630006000", "thirdId"]) {
    assert.ok(!rendu.includes(interdit), `${interdit} ne doit pas être stocké`);
  }
  assert.deepEqual(Object.keys(retenus[0].ligne).sort(), [
    "annule", "date_reglement", "mode", "montant", "progbat_canceled",
    "progbat_doc_type", "progbat_transaction_id", "source",
  ]);
});

test("règlement : la ligne ne porte QUE de vraies colonnes de la table", () => {
  // Une clé de trop (progbat_bill_id, progbat_synced_at…) ferait échouer
  // l'insert en production sur « column does not exist ». Les colonnes sont
  // lues dans la migration elle-même, pas recopiées à la main ici.
  const creation = SQL_CODE.slice(
    SQL_CODE.indexOf("create table if not exists public.chantier_factures_reglements"),
  );
  const corps = creation.slice(creation.indexOf("(") + 1, creation.indexOf("\n);"));
  const colonnes = new Set(
    corps.split("\n").map((l) => (/^\s{2}([a-z_]+)\s+\S/.exec(l) || [])[1]).filter(Boolean),
  );
  assert.ok(colonnes.has("progbat_transaction_id") && colonnes.has("montant") && colonnes.size >= 10,
    `colonnes mal relues : ${[...colonnes].join(", ")}`);
  const { retenus } = reglementsDeTransaction(TRANSACTION);
  for (const k of Object.keys(retenus[0].ligne)) {
    assert.ok(colonnes.has(k), `${k} n'est pas une colonne de chantier_factures_reglements`);
  }
  // Les deux clés qui n'en sont pas, nommément.
  assert.equal(colonnes.has("progbat_bill_id"), false);
  assert.equal(colonnes.has("progbat_synced_at"), false);
  assert.equal(retenus[0].ligne.progbat_synced_at, undefined);
  assert.equal(retenus[0].ligne.progbat_bill_id, undefined);
  // …et le bill.id reste disponible pour l'appelant, à côté de la ligne.
  assert.equal(retenus[0].progbat_bill_id, 4711);
});

test("règlement : canceled est conservé brut, jamais interprété", () => {
  // Sa sémantique n'est pas documentée : annuler sur un 1 ferait disparaître un
  // règlement réel de tous les soldes.
  for (const canceled of [0, 1, null, "2"]) {
    const { ligne } = normaliserReglementProgbat({ ...TRANSACTION, canceled }, TRANSACTION.checking[0]);
    assert.equal(ligne.annule, false, "aucune annulation n'est déduite de canceled");
    assert.equal(ligne.progbat_canceled, Number.isInteger(canceled) ? canceled : (canceled === "2" ? 2 : null));
  }
});

test("une transaction, plusieurs lettrages : seuls les « bill » sont retenus", () => {
  const t = { ...TRANSACTION, checking: [
    { docType: "bill", docId: 4711, amount: 400 },
    { docType: "supplierbill", docId: 88, amount: 300 },
    { docType: "bill", docId: 4712, amount: 225.15 },
  ] };
  const { retenus, ignores } = reglementsDeTransaction(t);
  assert.deepEqual(retenus.map((r) => r.progbat_bill_id), [4711, 4712]);
  assert.equal(ignores.length, 1);
  assert.equal(ignores[0].motif, REFUS.DOC_TYPE);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ÉTAT DE RÈGLEMENT
// ═══════════════════════════════════════════════════════════════════════════

const facture = (montant_ttc, extra = {}) => ({ source: "progbat", montant_ttc, ...extra });
const reglement = (montant, extra = {}) => ({ montant, annule: false, ...extra });

test("deux règlements partiels puis solde", () => {
  const f = facture(925.15);
  assert.equal(etatReglementProgbat(f, []).etat, ETAT_REGLEMENT.NON_REGLEE);

  const un = etatReglementProgbat(f, [reglement(400)]);
  assert.equal(un.etat, ETAT_REGLEMENT.PARTIELLE);
  assert.equal(un.solde, 525.15);
  assert.equal(un.anomalie, false);

  const deux = etatReglementProgbat(f, [reglement(400), reglement(500)]);
  assert.equal(deux.etat, ETAT_REGLEMENT.PARTIELLE);
  assert.equal(deux.solde, 25.15);

  const solde = etatReglementProgbat(f, [reglement(400), reglement(500), reglement(25.15)]);
  assert.equal(solde.etat, ETAT_REGLEMENT.REGLEE);
  assert.equal(solde.solde, 0);
  assert.equal(solde.somme_reglee, 925.15);
});

test("tolérance d'un centime : un solde de 0,01 € est une facture réglée", () => {
  assert.equal(TOLERANCE_EUR, 0.01);
  assert.equal(etatReglementProgbat(facture(925.15), [reglement(925.14)]).etat, ETAT_REGLEMENT.REGLEE);
  assert.equal(etatReglementProgbat(facture(925.15), [reglement(925.16)]).etat, ETAT_REGLEMENT.REGLEE);
  assert.equal(etatReglementProgbat(facture(925.15), [reglement(925.13)]).etat, ETAT_REGLEMENT.PARTIELLE);
});

test("règlement annulé : ignoré du calcul", () => {
  const f = facture(925.15);
  const r = etatReglementProgbat(f, [reglement(925.15, { annule: true })]);
  assert.equal(r.etat, ETAT_REGLEMENT.NON_REGLEE);
  assert.equal(r.somme_reglee, 0);
  assert.equal(r.nombre, 0);
  // Un règlement annulé au milieu d'autres ne compte pas non plus.
  const mixte = etatReglementProgbat(f, [reglement(400), reglement(525.15, { annule: true })]);
  assert.equal(mixte.etat, ETAT_REGLEMENT.PARTIELLE);
  assert.equal(mixte.somme_reglee, 400);
});

test("avoir négatif réglé par une transaction négative", () => {
  const f = facture(-925.15);
  assert.equal(etatReglementProgbat(f, []).etat, ETAT_REGLEMENT.NON_REGLEE);
  const partiel = etatReglementProgbat(f, [reglement(-400)]);
  assert.equal(partiel.etat, ETAT_REGLEMENT.PARTIELLE);
  assert.equal(partiel.solde, -525.15);
  const solde = etatReglementProgbat(f, [reglement(-400), reglement(-525.15)]);
  assert.equal(solde.etat, ETAT_REGLEMENT.REGLEE);
  assert.equal(solde.anomalie, false);
});

test("surpaiement : anomalie explicite, dans les deux sens", () => {
  const trop = etatReglementProgbat(facture(925.15), [reglement(1000)]);
  assert.equal(trop.etat, ETAT_REGLEMENT.SURPAIEMENT);
  assert.equal(trop.anomalie, true);
  assert.equal(trop.solde, -74.85);
  const tropAvoir = etatReglementProgbat(facture(-925.15), [reglement(-1000)]);
  assert.equal(tropAvoir.etat, ETAT_REGLEMENT.SURPAIEMENT);
  assert.equal(tropAvoir.anomalie, true);
});

test("signe incohérent : anomalie, jamais un solde partiel", () => {
  const a = etatReglementProgbat(facture(925.15), [reglement(-400)]);
  assert.equal(a.etat, ETAT_REGLEMENT.SIGNE_INCOHERENT);
  assert.equal(a.anomalie, true);
  const b = etatReglementProgbat(facture(-925.15), [reglement(400)]);
  assert.equal(b.etat, ETAT_REGLEMENT.SIGNE_INCOHERENT);
  assert.equal(b.anomalie, true);
  // Deux règlements de sens opposés qui s'annulent : somme nulle, non réglée.
  const c = etatReglementProgbat(facture(925.15), [reglement(400), reglement(-400)]);
  assert.equal(c.etat, ETAT_REGLEMENT.NON_REGLEE);
});

test("montant dû inconnu, facture à zéro : états explicites", () => {
  const inconnu = etatReglementProgbat(facture(null), [reglement(100)]);
  assert.equal(inconnu.etat, ETAT_REGLEMENT.MONTANT_INCONNU);
  assert.equal(inconnu.anomalie, true);
  assert.equal(etatReglementProgbat(facture(0), []).etat, ETAT_REGLEMENT.REGLEE);
  assert.equal(etatReglementProgbat(facture(0), [reglement(50)]).etat, ETAT_REGLEMENT.SURPAIEMENT);
});

test("progbat_status n'est jamais une preuve de paiement", () => {
  // status = 1 sur une facture sans aucun règlement : elle reste non réglée.
  const f = facture(925.15, { progbat_status: 1 });
  assert.equal(etatReglementProgbat(f, []).etat, ETAT_REGLEMENT.NON_REGLEE);
  const src = lire("src/Renovation/progbatFacturation.mjs");
  const corps = src.slice(src.indexOf("export function etatReglementProgbat"));
  assert.doesNotMatch(corps.slice(0, 2500), /progbat_status/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. CORRECTION HUMAINE
// ═══════════════════════════════════════════════════════════════════════════

test("correction d'une échéance : verrou, auteur, date, rapprochement corrigé", () => {
  const patch = corrigerLigneFacture(
    { ligne_id: "acompte", ligne_id_verrouille: false },
    { ligneId: "situation_1", ligneNom: "Situation n° 1", utilisateurId: "u-1", maintenant: "2026-09-16T09:00:00.000Z" },
  );
  assert.equal(patch.ligne_id, "situation_1");
  assert.equal(patch.ligne_id_verrouille, true);
  assert.equal(patch.ligne_id_modifie_par, "u-1");
  assert.equal(patch.ligne_id_modifie_le, "2026-09-16T09:00:00.000Z");
  assert.equal(patch.rapprochement, "corrige");
  // Détacher une facture de son échéance est aussi une correction verrouillée.
  assert.equal(corrigerLigneFacture({ ligne_id: "acompte" }, { ligneId: null }).ligne_id, null);
  // Rien à faire si le choix est déjà celui-là et déjà verrouillé.
  assert.equal(corrigerLigneFacture({ ligne_id: "situation_1", ligne_id_verrouille: true }, { ligneId: "situation_1" }), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. MIGRATION — analyse statique
// ═══════════════════════════════════════════════════════════════════════════
const SQL = lire("sql/202609_facturation_progbat.sql");
// Une règle « présente » en commentaire n'existe pas en base : tous les
// contrôles portent sur le code.
const SQL_CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

test("migration : additive, rejouable, sans perte", () => {
  assert.match(SQL_CODE, /add column if not exists source text not null default 'manuel'/);
  // Aucune suppression de colonne ni de table, aucune réécriture de données.
  assert.doesNotMatch(SQL_CODE, /drop column|drop table|truncate/i);
  for (const i of SQL_CODE.split(";").map((x) => x.trim().toLowerCase())) {
    assert.ok(!/^(update|delete\s+from)\b/.test(i), `instruction modifiant des données : ${i.slice(0, 60)}`);
  }
  // Rejouable : colonnes, index et contraintes sous garde.
  assert.equal((SQL_CODE.match(/add column if not exists/g) || []).length, 33);
  const contraintes = [...SQL_CODE.matchAll(/add constraint (\w+)/g)].map((m) => m[1]);
  assert.equal(contraintes.length, 8);
  // Rejouable : chaque contrainte est soit posée sous garde pg_constraint,
  // soit retirée juste avant (drop if exists). Les deux formes coexistent : la
  // table des règlements est neuve, celle des factures est réécrite.
  for (const c of contraintes) {
    const sousGarde = new RegExp(`conname = '${c}'`).test(SQL_CODE);
    const retiree = new RegExp(`drop constraint if exists ${c}`).test(SQL_CODE);
    assert.ok(sousGarde || retiree, `${c} doit être posée sous garde ou retirée d'abord`);
  }
});

test("migration : toutes les colonnes demandées existent", () => {
  const attendues = [
    "progbat_bill_id", "progbat_bill_code", "progbat_quote_id", "progbat_yard_id", "progbat_business_id",
    "progbat_type", "progbat_situation_number", "progbat_status", "progbat_validated",
    "progbat_revision_number", "progbat_document_date", "progbat_due_date",
    "progbat_deal_net_total", "progbat_deal_taxes", "progbat_deal_ati_total",
    "progbat_achievement", "progbat_previous_achievement", "progbat_net_total", "progbat_taxes",
    "progbat_ati_total", "progbat_holdback", "progbat_deducted_advance", "progbat_to_be_paid",
    "progbat_ati_deductions", "progbat_tax_details", "progbat_deductions", "progbat_dgd",
    "progbat_synced_at", "progbat_pdf_synced_at",
    "ligne_id_verrouille", "ligne_id_modifie_par", "ligne_id_modifie_le",
  ];
  for (const c of attendues) {
    assert.match(SQL_CODE, new RegExp(`add column if not exists ${c}\\s`), `colonne ${c} manquante`);
  }
  assert.match(SQL_CODE, /ligne_id_verrouille\s+boolean not null default false/);
});

test("migration : contraintes d'intégrité ProGBat", () => {
  assert.match(SQL_CODE, /check \(source in \('manuel', 'progbat'\)\)/);
  // bill.id ⇔ source progbat : la déduplication n'est ambiguë dans aucun sens.
  assert.match(SQL_CODE, /check \(\(source = 'progbat'\) = \(progbat_bill_id is not null\)\)/);
  // Identifiants strictement positifs (0 = champ vide chez ProGBat).
  assert.match(SQL_CODE, /progbat_bill_id\s+is null or progbat_bill_id\s+> 0/);
  assert.match(SQL_CODE, /progbat_yard_id\s+is null or progbat_yard_id\s+> 0/);
  assert.match(SQL_CODE, /progbat_quote_id\s+is null or progbat_quote_id\s+> 0/);
  // Détails JSON : des tableaux, ou rien.
  assert.match(SQL_CODE, /jsonb_typeof\(progbat_tax_details\) = 'array'/);
  assert.match(SQL_CODE, /jsonb_typeof\(progbat_deductions\)\s+= 'array'/);
  // Aucune contrainte fermée sur le type : ProGBat peut en ajouter.
  assert.doesNotMatch(SQL_CODE, /progbat_type in \(/);
  // Les statuts ne changent pas.
  assert.doesNotMatch(SQL_CODE, /statut in \(/);
  assert.doesNotMatch(SQL_CODE, /'partielle'/);
});

test("migration : invariants d'une facture ProGBat garantis par la base", () => {
  // Ce que le module écrit, la base doit l'exiger : sans ces invariants, une
  // ligne « à moitié ProGBat » (brouillon, TTC divergent du toBePaid, HT
  // reconstitué) pourrait s'installer sans que rien ne la signale.
  const inv = SQL_CODE.slice(
    SQL_CODE.indexOf('add constraint chantier_factures_client_progbat_invariants'),
    SQL_CODE.indexOf('add constraint chantier_factures_client_progbat_ids_positifs'),
  );
  assert.ok(inv.length > 0, 'contrainte d\'invariants absente');
  assert.match(inv, /source <> 'progbat' or \(/);
  assert.match(inv, /progbat_bill_id is not null and progbat_bill_id > 0/);
  assert.match(inv, /progbat_validated = 1/);
  assert.match(inv, /progbat_to_be_paid is not null/);
  assert.match(inv, /montant_ttc is not null/);
  assert.match(inv, /montant_ttc = progbat_to_be_paid/);
  assert.match(inv, /montant_ht is null/);
  assert.match(inv, /montant_tva is null/);
  // Les factures manuelles ne gagnent aucune exigence : rien ne devient
  // not null, et aucune contrainte ne les vise.
  assert.doesNotMatch(SQL_CODE, /montant_ht\s+set not null|alter column montant_ht|alter column montant_tva|alter column montant_ttc/);
  assert.doesNotMatch(SQL_CODE, /source = 'manuel' and/);
  // Rejouable : chaque contrainte est retirée avant d'être reposée.
  for (const c of ['source_check', 'progbat_identite', 'progbat_invariants',
                   'progbat_ids_positifs', 'progbat_json_tableaux']) {
    assert.match(SQL_CODE, new RegExp(`drop constraint if exists chantier_factures_client_${c}`),
      `${c} doit être retirée avant d'être reposée`);
    assert.ok(SQL_CODE.indexOf(`drop constraint if exists chantier_factures_client_${c}`)
      < SQL_CODE.indexOf(`add constraint chantier_factures_client_${c}`), `${c} : drop avant add`);
  }
  // L'ancienne contrainte de montant, remplacée par les invariants, est
  // explicitement retirée (le fichier a pu être lu avant correction).
  assert.match(SQL_CODE, /drop constraint if exists chantier_factures_client_progbat_montant/);
  assert.doesNotMatch(SQL_CODE, /add constraint chantier_factures_client_progbat_montant/);
});

test("migration : unicité — bill.id pour ProGBat, numéro pour le manuel", () => {
  assert.match(SQL_CODE, /create unique index if not exists uq_factures_client_progbat_bill\s*\n?\s*on public\.chantier_factures_client \(progbat_bill_id\)\s*\n?\s*where progbat_bill_id is not null/);
  assert.match(SQL_CODE, /uq_factures_client_numero_manuel[\s\S]{0,220}source = 'manuel'/);
  // L'ancien index (qui couvrait aussi les factures ProGBat) est retiré APRÈS
  // la création du nouveau : jamais de fenêtre sans protection.
  const posNouveau = SQL_CODE.indexOf("uq_factures_client_numero_manuel");
  const posDrop = SQL_CODE.indexOf("drop index if exists public.uq_factures_client_numero;");
  assert.ok(posNouveau > 0 && posDrop > posNouveau, "le nouvel index doit être créé avant le drop de l'ancien");
});

test("migration : garde-fou — INSERT et UPDATE, sur le rôle SQL réel", () => {
  assert.match(SQL_CODE, /create or replace function public\.protege_factures_progbat\(\)/);
  // BEFORE INSERT OR UPDATE : un INSERT direct de facture ProGBat depuis le
  // navigateur était la faille du premier jet.
  assert.match(SQL_CODE, /before insert or update on public\.chantier_factures_client/);
  // Le rôle SQL réel, pas une revendication du client.
  assert.match(SQL_CODE, /current_user not in \('authenticated', 'anon'\)/);
  assert.doesNotMatch(SQL_CODE, /request\.jwt\.claims/);
  // L'ancien garde-fou est retiré nommément, trigger ET fonction.
  assert.match(SQL_CODE, /drop trigger if exists trg_protege_champs_progbat_facture/);
  assert.match(SQL_CODE, /drop function if exists public\.protege_champs_progbat_facture\(\)/);
});

test("migration : garde-fou — OLD n'est jamais lu pendant un INSERT", () => {
  // Lire OLD sur INSERT lève « record \"old\" is not assigned yet » et casserait
  // TOUTE création de facture, y compris manuelle.
  const fn = SQL_CODE.slice(
    SQL_CODE.indexOf('create or replace function public.protege_factures_progbat'),
    SQL_CODE.indexOf('drop trigger if exists trg_protege_champs_progbat_facture'),
  );
  const branche = fn.slice(fn.indexOf("if tg_op = 'INSERT' then"));
  const avantRetour = branche.slice(0, branche.indexOf('return new;'));
  assert.doesNotMatch(avantRetour, /\bold\b/, 'la branche INSERT ne doit pas lire OLD');
  // Et rien ne lit OLD avant que la branche INSERT n'ait rendu la main.
  const avantBranche = fn.slice(fn.indexOf('begin'), fn.indexOf("if tg_op = 'INSERT' then"));
  assert.doesNotMatch(avantBranche, /\bold\b/);
});

test("migration : garde-fou — ce qui est gelé et ce qui reste libre", () => {
  const fn = SQL_CODE.slice(SQL_CODE.indexOf('create or replace function public.protege_factures_progbat'));
  const geles = fn.slice(fn.indexOf('champs_geles constant text[]'), fn.indexOf('];'));
  for (const c of ['numero', 'date_facture', 'montant_ht', 'montant_tva', 'montant_ttc',
                   'pct_du_marche', 'statut', 'date_encaissement', 'montant_encaisse',
                   'document_path', 'document_nom']) {
    assert.match(geles, new RegExp(`'${c}'`), `${c} doit être gelé`);
  }
  // Les champs du travail humain ne sont jamais gelés.
  for (const libre of ['chantier_id', 'ligne_id', 'ligne_nom', 'ligne_id_verrouille',
                       'ligne_id_modifie_par', 'ligne_id_modifie_le', 'rapprochement',
                       'raison', 'commentaire']) {
    assert.doesNotMatch(geles, new RegExp(`'${libre}'`), `${libre} doit rester modifiable`);
  }
  // Tous les progbat_* sont couverts d'un coup, présents et futurs.
  assert.match(fn, /k like 'progbat\\_%'/);
  assert.match(fn, /new\.source is distinct from old\.source/);
});

test("migration : table des règlements, colonnes et contraintes", () => {
  assert.match(SQL_CODE, /create table if not exists public\.chantier_factures_reglements/);
  assert.match(SQL_CODE, /facture_id\s+uuid not null[\s\S]{0,120}references public\.chantier_factures_client\(id\) on delete cascade/);
  assert.match(SQL_CODE, /montant\s+numeric\(14,2\) not null/);
  assert.match(SQL_CODE, /annule\s+boolean not null default false/);
  assert.match(SQL_CODE, /check \(source in \('manuel', 'progbat'\)\)/);
  // Un règlement ProGBat : transaction positive ET lettrage de facture.
  assert.match(SQL_CODE, /progbat_transaction_id is not null and progbat_transaction_id > 0/);
  assert.match(SQL_CODE, /progbat_doc_type = 'bill'/);
  // Unicité (transaction, facture) : une transaction ne règle qu'une fois une
  // facture, mais peut en régler plusieurs.
  assert.match(SQL_CODE, /create unique index if not exists uq_factures_reglements_progbat\s*\n?\s*on public\.chantier_factures_reglements \(progbat_transaction_id, facture_id\)\s*\n?\s*where progbat_transaction_id is not null/);
  // Rien de bancaire dans la table.
  for (const interdit of ["bank_account", "bankAccountId", "iban", "payment_number", "libelle_bancaire", "payload"]) {
    assert.ok(!SQL_CODE.includes(interdit), `${interdit} ne doit pas exister en colonne`);
  }
});

test("migration : règlements en lecture seule pour le bureau", () => {
  assert.match(SQL_CODE, /alter table public\.chantier_factures_reglements enable row level security/);
  assert.match(SQL_CODE, /create policy "reglements lecture bureau"[\s\S]{0,120}for select to authenticated/);
  assert.match(SQL_CODE, /using \(not public\.est_ouvrier\(\)\)/);
  assert.match(SQL_CODE, /revoke all on table public\.chantier_factures_reglements from public, anon, authenticated/);
  assert.match(SQL_CODE, /grant select on table public\.chantier_factures_reglements to authenticated/);
  // Aucune écriture accordée au navigateur dans ce lot.
  assert.doesNotMatch(SQL_CODE, /grant[^;]*insert[^;]*chantier_factures_reglements/i);
  assert.doesNotMatch(SQL_CODE, /for all to authenticated[\s\S]{0,80}chantier_factures_reglements/);
  // L'ordre compte : un revoke après le grant annulerait le grant.
  assert.ok(SQL_CODE.indexOf("revoke all on table public.chantier_factures_reglements")
    < SQL_CODE.indexOf("grant select on table public.chantier_factures_reglements"));
});

test("migration : data_history et updated_at, sous leurs gardes", () => {
  assert.match(SQL_CODE, /proname = 'log_data_history'/);
  assert.match(SQL_CODE, /trg_data_history before update or delete on public\.chantier_factures_reglements/);
  assert.match(SQL_CODE, /proname = 'set_updated_at'/);
  assert.match(SQL_CODE, /chantier_factures_reglements_set_updated_at/);
  assert.match(SQL_CODE, /column_name = 'updated_at'/);
});

test("migration : la facturation manuelle existante n'est pas touchée", () => {
  // Ni la table d'origine, ni son trigger updated_at, ni ses statuts.
  assert.doesNotMatch(SQL_CODE, /drop trigger if exists trg_touch_factures_client/);
  assert.doesNotMatch(SQL_CODE, /drop policy if exists "factures client bureau"/);
  // Les seuls `drop` visant la table sont des drop constraint de CE fichier :
  // aucune colonne, aucune contrainte de la migration d'origine.
  const drops = [...SQL_CODE.matchAll(/drop (\w+) if exists ([\w."]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  for (const d of drops) {
    assert.ok(/^(constraint chantier_factures_(client|reglements)_|index public\.uq_factures_client_numero$|trigger trg_|function public\.protege_|policy)/.test(d)
      || d.startsWith("trigger chantier_factures_reglements"),
      `drop inattendu : ${d}`);
  }
  // montant_encaisse reste en place pour l'historique manuel.
  assert.ok(!SQL_CODE.includes("drop column") && !/montant_encaisse[^;]*drop/i.test(SQL_CODE));
});


// ═══════════════════════════════════════════════════════════════════════════
// 7. POSTGRESQL RÉEL — le trigger et les contraintes, exécutés
// ═══════════════════════════════════════════════════════════════════════════
// Une analyse de texte ne prouve pas qu'un trigger PL/pgSQL fait ce qu'il dit :
// « OLD lu pendant un INSERT » ou « current_user mal comparé » ne se voient
// qu'à l'exécution. Ce volet joue donc les DEUX migrations telles quelles dans
// un PostgreSQL jetable, avec les rôles de Supabase, et vérifie les refus et
// les autorisations une par une.
//
// Opt-in, parce qu'il exige Docker :   node scripts/verif-progbat-facturation.mjs --pg
// Sans lui, le reste du harnais tourne hors ligne et les contrôles sur le
// trigger restent STATIQUES — ce que la sortie annonce explicitement.
const AVEC_PG = process.argv.includes("--pg") || process.env.VERIF_PG === "1";
const IMAGE_PG = process.env.VERIF_PG_IMAGE || "postgres:16-alpine";
const CONTENEUR = "pg-verif-progbat-facturation";

if (AVEC_PG) {
  const { execFileSync } = await import("node:child_process");
  const docker = (args, options = {}) =>
    execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });
  // ON_ERROR_STOP : la moindre erreur inattendue fait échouer le contrôle.
  const psql = (sql, role = null) =>
    docker(["exec", "-i", CONTENEUR, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1",
            "-X", "-q", "-t", "-A", "-f", "-"],
           { input: (role ? "set role " + role + ";\n" : "") + sql });

  // Un ordre censé être REFUSÉ. On exige le refus ET son code SQL : un échec
  // pour une autre raison (colonne absente, privilège manquant) serait un faux
  // positif rassurant.
  const refuse = (sql, role, codes, libelle) => {
    let sortie = "";
    try {
      sortie = psql(sql, role);
    } catch (e) {
      const msg = String(e?.stderr || e?.message || "");
      assert.ok(codes.some((c) => msg.includes(c)),
        libelle + " : refusé, mais pas pour la bonne raison →\n        " + msg.trim().split("\n").slice(0, 3).join(" | "));
      return;
    }
    assert.fail(libelle + " : l'ordre a été ACCEPTÉ alors qu'il devait être refusé. " + sortie);
  };

  test("pg : préparation d'un PostgreSQL jetable et application des migrations", () => {
    try { docker(["rm", "-f", CONTENEUR]); } catch { /* pas de conteneur résiduel */ }
    docker(["run", "-d", "--name", CONTENEUR, "-e", "POSTGRES_PASSWORD=verif", IMAGE_PG]);
    let pret = false;
    for (let i = 0; i < 60 && !pret; i++) {
      try { docker(["exec", CONTENEUR, "pg_isready", "-U", "postgres"]); pret = true; }
      catch { execFileSync("docker", ["exec", CONTENEUR, "sleep", "1"]); }
    }
    assert.ok(pret, "PostgreSQL n'a pas démarré");

    // Les rôles de Supabase, et rien d'autre. service_role porte BYPASSRLS,
    // comme chez Supabase : c'est lui que la synchronisation utilisera.
    psql(
      "do $$ begin\n" +
      "  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;\n" +
      "  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;\n" +
      "  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;\n" +
      "end $$;\n" +
      "grant usage on schema public to anon, authenticated, service_role;\n" +
      "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;\n" +
      // est_ouvrier() est la règle d'accès de l'application : ici, un utilisateur
      // du bureau (donc false), sinon aucune policy ne laisserait rien passer.
      "create or replace function public.est_ouvrier() returns boolean language sql stable as $f$ select false $f$;\n",
    );
    // Les deux migrations, telles qu'elles seront collées dans l'éditeur SQL.
    psql(lire("sql/202609_facturation_client.sql"));
    psql(lire("sql/202609_facturation_progbat.sql"));
    // Rejouable : on les applique une seconde fois, ce que fera tôt ou tard un
    // copier-coller de contrôle.
    psql(lire("sql/202609_facturation_client.sql"));
    psql(lire("sql/202609_facturation_progbat.sql"));

    const colonnes = psql("select count(*) from information_schema.columns where table_name = 'chantier_factures_client' and column_name like 'progbat_%';").trim();
    assert.equal(colonnes, "29");
    const trigger = psql("select tgname from pg_trigger where tgrelid = 'public.chantier_factures_client'::regclass and not tgisinternal order by 1;").trim();
    assert.match(trigger, /trg_protege_factures_progbat/);
    assert.doesNotMatch(trigger, /trg_protege_champs_progbat_facture/, "l'ancien trigger doit avoir disparu");
  });

  test("pg : authenticated ne peut pas CRÉER de facture ProGBat", () => {
    refuse(
      "insert into public.chantier_factures_client (chantier_id, source, progbat_bill_id, progbat_validated, progbat_to_be_paid, montant_ttc) " +
      "values ('trottier', 'progbat', 4711, 1, 925.15, 925.15);",
      "authenticated", ["ne se crée pas depuis l'application"],
      "INSERT source='progbat' par authenticated",
    );
  });

  test("pg : authenticated crée toujours une facture manuelle (OLD n'est pas lu)", () => {
    // Si le trigger lisait OLD pendant l'INSERT, PostgreSQL lèverait
    // « record "old" is not assigned yet » et TOUTE création échouerait.
    psql("insert into public.chantier_factures_client (chantier_id, source, numero, montant_ht, montant_tva, montant_ttc, statut) " +
         "values ('trottier', 'manuel', 'FA-MANUELLE-1', 100, 20, 120, 'emise');", "authenticated");
    const n = psql("select count(*) from public.chantier_factures_client where numero = 'FA-MANUELLE-1';").trim();
    assert.equal(n, "1");
    // Et il peut la modifier librement : rien n'est gelé sur une facture manuelle.
    psql("update public.chantier_factures_client set montant_ttc = 150, statut = 'encaissee' where numero = 'FA-MANUELLE-1';", "authenticated");
  });

  test("pg : service_role crée et synchronise une facture ProGBat", () => {
    psql(
      "insert into public.chantier_factures_client (id, chantier_id, source, numero, date_facture, montant_ttc, " +
      "progbat_bill_id, progbat_bill_code, progbat_validated, progbat_to_be_paid, progbat_ati_total, progbat_status) " +
      "values ('11111111-1111-1111-1111-111111111111', 'trottier', 'progbat', 'FA2026-0042', '2026-09-10', 925.15, " +
      "4711, 'FA2026-0042', 1, 925.15, 1850.31, 0);",
      "service_role",
    );
    // Et il peut la mettre à jour : c'est la synchronisation.
    psql("update public.chantier_factures_client set progbat_status = 1, montant_ttc = 900, progbat_to_be_paid = 900 " +
         "where progbat_bill_id = 4711;", "service_role");
    const m = psql("select montant_ttc from public.chantier_factures_client where progbat_bill_id = 4711;").trim();
    assert.equal(m, "900.00");
    psql("update public.chantier_factures_client set montant_ttc = 925.15, progbat_to_be_paid = 925.15 where progbat_bill_id = 4711;", "service_role");
  });

  test("pg : authenticated ne peut modifier NI les montants, NI le statut, NI le document", () => {
    const cible = " where progbat_bill_id = 4711;";
    const gele = "ne se modifient pas depuis l'application";
    for (const [libelle, set] of [
      ["montant_ttc", "montant_ttc = 1"],
      ["montant_ht", "montant_ht = 700"],
      ["montant_tva", "montant_tva = 140"],
      ["statut", "statut = 'encaissee'"],
      ["date_encaissement", "date_encaissement = '2026-09-30'"],
      ["montant_encaisse", "montant_encaisse = 925.15"],
      ["document_path", "document_path = 'chantiers/faux.pdf'"],
      ["document_nom", "document_nom = 'faux.pdf'"],
      ["numero", "numero = 'FA-BIDON'"],
      ["date_facture", "date_facture = '2020-01-01'"],
      ["pct_du_marche", "pct_du_marche = 12"],
      ["progbat_bill_code", "progbat_bill_code = 'AUTRE'"],
      ["progbat_to_be_paid", "progbat_to_be_paid = 1"],
      ["progbat_yard_id", "progbat_yard_id = 999"],
    ]) {
      refuse("update public.chantier_factures_client set " + set + cible, "authenticated", [gele],
        "UPDATE " + libelle + " par authenticated");
    }
  });

  test("pg : authenticated ne peut pas changer la source, dans aucun sens", () => {
    refuse("update public.chantier_factures_client set source = 'manuel', progbat_bill_id = null where progbat_bill_id = 4711;",
      "authenticated", ["La source d'une facture ne se change pas"], "progbat → manuel");
    refuse("update public.chantier_factures_client set source = 'progbat', progbat_bill_id = 5000, progbat_validated = 1, " +
      "progbat_to_be_paid = 120, montant_ht = null, montant_tva = null where numero = 'FA-MANUELLE-1';",
      "authenticated", ["La source d'une facture ne se change pas"], "manuel → progbat");
  });

  test("pg : authenticated garde la main sur le chantier, l'échéance et le verrou", () => {
    psql(
      "update public.chantier_factures_client set " +
      "chantier_id = 'trottier-bis', ligne_id = 'situation_1', ligne_nom = 'Situation n° 1', " +
      "ligne_id_verrouille = true, ligne_id_modifie_par = '22222222-2222-2222-2222-222222222222', " +
      "ligne_id_modifie_le = now(), rapprochement = 'corrige', raison = 'Corrigée à la main.', " +
      "commentaire = 'Vu avec la cliente.' where progbat_bill_id = 4711;",
      "authenticated",
    );
    const r = psql("select ligne_id || '|' || rapprochement || '|' || ligne_id_verrouille || '|' || chantier_id " +
                   "from public.chantier_factures_client where progbat_bill_id = 4711;").trim();
    assert.equal(r, "situation_1|corrige|true|trottier-bis");
  });

  test("pg : les invariants ProGBat sont refusés par la base, pas seulement par le code", () => {
    const base = "insert into public.chantier_factures_client (chantier_id, source, progbat_bill_id, progbat_validated, progbat_to_be_paid, montant_ttc";
    const inv = "chantier_factures_client_progbat_invariants";
    // Brouillon.
    refuse(base + ") values ('t', 'progbat', 5001, 0, 10, 10);", "service_role", [inv], "validated = 0");
    // toBePaid absent.
    refuse(base + ") values ('t', 'progbat', 5002, 1, null, 10);", "service_role", [inv], "toBePaid null");
    // TTC divergent du toBePaid.
    refuse(base + ") values ('t', 'progbat', 5003, 1, 10, 11);", "service_role", [inv], "montant_ttc ≠ toBePaid");
    // TTC absent.
    refuse(base + ") values ('t', 'progbat', 5004, 1, 10, null);", "service_role", [inv], "montant_ttc null");
    // HT ou TVA reconstitués.
    refuse(base + ", montant_ht) values ('t', 'progbat', 5005, 1, 10, 10, 8.33);", "service_role", [inv], "montant_ht non null");
    refuse(base + ", montant_tva) values ('t', 'progbat', 5006, 1, 10, 10, 1.67);", "service_role", [inv], "montant_tva non null");
    // Identité : pas de bill.id sans source progbat, ni l'inverse.
    refuse("insert into public.chantier_factures_client (chantier_id, source, progbat_bill_id) values ('t', 'manuel', 5007);",
      "service_role", ["chantier_factures_client_progbat_identite"], "bill.id sur une facture manuelle");
    refuse("insert into public.chantier_factures_client (chantier_id, source, montant_ttc) values ('t', 'progbat', 10);",
      "service_role", ["chantier_factures_client_progbat_identite"], "facture ProGBat sans bill.id");
    // Une facture ProGBat conforme passe, elle.
    psql(base + ") values ('t', 'progbat', 5100, 1, -925.15, -925.15);", "service_role");
  });

  test("pg : unicité — bill.id global, numéro seulement pour le manuel", () => {
    refuse("insert into public.chantier_factures_client (chantier_id, source, progbat_bill_id, progbat_validated, progbat_to_be_paid, montant_ttc) " +
      "values ('autre', 'progbat', 4711, 1, 925.15, 925.15);", "service_role",
      ["uq_factures_client_progbat_bill"], "même bill.id sur deux chantiers");
    // Deux factures ProGBat au même NUMÉRO ne se gênent pas (bill.id distincts).
    psql("insert into public.chantier_factures_client (chantier_id, source, numero, progbat_bill_id, progbat_validated, progbat_to_be_paid, montant_ttc) " +
      "values ('trottier', 'progbat', 'FA2026-0042', 5200, 1, 10, 10);", "service_role");
    // Alors qu'un doublon de numéro reste interdit entre factures manuelles.
    refuse("insert into public.chantier_factures_client (chantier_id, source, numero, montant_ttc) " +
      "values ('trottier', 'manuel', 'FA-MANUELLE-1', 50);", "authenticated",
      ["uq_factures_client_numero_manuel"], "doublon de numéro manuel");
  });

  test("pg : règlements — lecture bureau, écriture serveur seulement", () => {
    psql("insert into public.chantier_factures_reglements (facture_id, source, progbat_transaction_id, progbat_doc_type, date_reglement, montant, mode) " +
      "values ('11111111-1111-1111-1111-111111111111', 'progbat', 9001, 'bill', '2026-09-20', 400, 'VIR');", "service_role");
    // Le bureau lit…
    const vus = psql("select count(*) from public.chantier_factures_reglements;", "authenticated").trim();
    assert.equal(vus, "1");
    // …mais n'écrit pas : aucun privilège d'écriture ne lui a été accordé.
    refuse("insert into public.chantier_factures_reglements (facture_id, source, montant) " +
      "values ('11111111-1111-1111-1111-111111111111', 'manuel', 10);", "authenticated",
      ["permission denied", "droit refusé", "42501"], "INSERT règlement par authenticated");
    refuse("update public.chantier_factures_reglements set montant = 999;", "authenticated",
      ["permission denied", "droit refusé", "42501"], "UPDATE règlement par authenticated");
    refuse("delete from public.chantier_factures_reglements;", "authenticated",
      ["permission denied", "droit refusé", "42501"], "DELETE règlement par authenticated");
    // Un règlement ProGBat sans docType 'bill' est refusé par la base.
    refuse("insert into public.chantier_factures_reglements (facture_id, source, progbat_transaction_id, progbat_doc_type, montant) " +
      "values ('11111111-1111-1111-1111-111111111111', 'progbat', 9002, 'supplierbill', 10);", "service_role",
      ["chantier_factures_reglements_progbat_identite"], "docType supplierbill");
    // Deux fois la même transaction sur la même facture : refusé (idempotence).
    refuse("insert into public.chantier_factures_reglements (facture_id, source, progbat_transaction_id, progbat_doc_type, montant) " +
      "values ('11111111-1111-1111-1111-111111111111', 'progbat', 9001, 'bill', 400);", "service_role",
      ["uq_factures_reglements_progbat"], "doublon (transaction, facture)");
  });

  test("pg : la ligne produite par le module s'insère telle quelle", () => {
    // Le test qui fait le lien entre les deux moitiés du lot : la forme rendue
    // par normaliserReglementProgbat est-elle VRAIMENT insérable ?
    const { retenus } = reglementsDeTransaction({ ...TRANSACTION, id: 9500 });
    const ligne = retenus[0].ligne;
    const cles = Object.keys(ligne);
    const valeurs = cles.map((k) => {
      const v = ligne[k];
      if (v === null) return "null";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      return "'" + String(v).replace(/'/g, "''") + "'";
    });
    psql("insert into public.chantier_factures_reglements (facture_id, " + cles.join(", ") + ") values " +
      "('11111111-1111-1111-1111-111111111111', " + valeurs.join(", ") + ");", "service_role");
    const lu = psql("select montant || '|' || progbat_doc_type || '|' || annule from public.chantier_factures_reglements where progbat_transaction_id = 9500;").trim();
    assert.equal(lu, "500.00|bill|false");
  });

  test("pg : nettoyage du conteneur jetable", () => {
    docker(["rm", "-f", CONTENEUR]);
  });
}

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
console.log(`\nverif-progbat-facturation : ${cas.length - echecs}/${cas.length} contrôles passés`);
console.log(AVEC_PG
  ? "  (trigger et contraintes EXÉCUTÉS dans un PostgreSQL jetable)"
  : "  (trigger et contraintes vérifiés STATIQUEMENT — relancer avec --pg pour les exécuter)");
process.exit(echecs ? 1 : 0);
