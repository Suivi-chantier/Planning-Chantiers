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
  const { ligne } = normaliserReglementProgbat(TRANSACTION, { docType: "bill", docId: 4711, amount: -925.15 });
  assert.equal(ligne.progbat_transaction_id, 9001);
  assert.equal(ligne.progbat_doc_type, "bill");
  assert.equal(ligne.progbat_bill_id, 4711);
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
  assert.deepEqual(Object.keys(retenus[0]).sort(), [
    "annule", "date_reglement", "mode", "montant", "progbat_bill_id", "progbat_canceled",
    "progbat_doc_type", "progbat_synced_at", "progbat_transaction_id", "source",
  ]);
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
  for (const c of contraintes) {
    assert.ok(new RegExp(`conname = '${c}'`).test(SQL_CODE), `${c} doit être posée sous garde`);
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
  // Montants : TTC exigé côté ProGBat, HT et TVA libres.
  assert.match(SQL_CODE, /check \(source <> 'progbat' or montant_ttc is not null\)/);
  assert.doesNotMatch(SQL_CODE, /montant_ht\s+set not null|alter column montant_ht/);
  // Détails JSON : des tableaux, ou rien.
  assert.match(SQL_CODE, /jsonb_typeof\(progbat_tax_details\) = 'array'/);
  assert.match(SQL_CODE, /jsonb_typeof\(progbat_deductions\)\s+= 'array'/);
  // Aucune contrainte fermée sur le type : ProGBat peut en ajouter.
  assert.doesNotMatch(SQL_CODE, /progbat_type in \(/);
  // Les statuts ne changent pas.
  assert.doesNotMatch(SQL_CODE, /statut in \(/);
  assert.doesNotMatch(SQL_CODE, /'partielle'/);
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

test("migration : garde-fou sur les champs ProGBat depuis le navigateur", () => {
  assert.match(SQL_CODE, /create or replace function public\.protege_champs_progbat_facture\(\)/);
  assert.match(SQL_CODE, /before update on public\.chantier_factures_client/);
  // Seul `authenticated` est bloqué : service_role (synchronisation) et
  // l'éditeur SQL (aucune revendication) doivent pouvoir écrire.
  assert.match(SQL_CODE, /role_appelant <> 'authenticated'/);
  assert.match(SQL_CODE, /request\.jwt\.claims/);
  // La comparaison couvre TOUTES les colonnes progbat_*, présentes et futures.
  assert.match(SQL_CODE, /k like 'progbat\\_%'/);
  assert.match(SQL_CODE, /new\.source is distinct from old\.source/);
  // Et ce qui reste modifiable par un humain n'est pas touché par le trigger.
  for (const libre of ["ligne_id", "rapprochement", "statut"]) {
    assert.doesNotMatch(SQL_CODE, new RegExp(`raise exception[^;]*${libre}`), `${libre} doit rester modifiable`);
  }
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
  assert.doesNotMatch(SQL_CODE, /alter table public\.chantier_factures_client\s+drop/);
  // montant_encaisse reste en place pour l'historique manuel.
  assert.ok(!SQL_CODE.includes("drop column") && !/montant_encaisse[^;]*drop/i.test(SQL_CODE));
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
console.log(`\nverif-progbat-facturation : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
