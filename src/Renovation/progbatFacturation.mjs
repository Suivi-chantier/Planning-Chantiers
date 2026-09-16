// ─────────────────────────────────────────────────────────────────────────────
// FACTURES ET RÈGLEMENTS ProGBat — règles pures.
//
// Ce module ne parle à personne : ni réseau, ni Supabase, ni horloge. Il
// transforme ce que ProGBat renvoie en lignes de chantier_factures_client et
// chantier_factures_reglements, et il dit ce qu'une facture a réellement
// encaissé. Rien d'autre. C'est ce qui permet de le vérifier entièrement avec
// des doublures — scripts/verif-progbat-facturation.mjs.
//
// CE QUE LES DONNÉES RÉELLES ONT ÉTABLI
// ─────────────────────────────────────
//   validated = 0  → brouillon, ignoré ; validated = 1 → facture émise.
//   bill.id        → l'identité. Le numéro (code) n'en est PAS une.
//   yardId         → le chantier ; quoteId n'est qu'un repli (progbatLiaison).
//   type = "bill"  → y compris pour un AVOIR, dont les montants sont négatifs.
//   status = 1     → corrélé au règlement, mais ce sont les transactions qui
//                    font foi. progbat_status n'est jamais une preuve.
//
// LES MONTANTS — LE POINT LE PLUS IMPORTANT
// ─────────────────────────────────────────
// Sur une situation, `atiTotal` est CUMULATIF et `toBePaid` est l'exigible
// après déduction des acomptes :
//     atiTotal = 1850,31   deductedAdvance = 925,16   toBePaid = 925,15
// `netTotal` et `taxes` suivent atiTotal : ils ne décrivent donc pas le HT et
// la TVA exigibles sur ce document. D'où la règle, sans exception :
//     montant_ttc = toBePaid (signé)   montant_ht = null   montant_tva = null
// Aucune ventilation HT/TVA n'est reconstituée. Diviser par 1,20 donnerait un
// nombre plausible, faux, et qui finirait recopié dans un tableau comptable.
// Les montants ProGBat exacts sont tous conservés à part (progbat_*).
//
// TOUS LES MONTANTS SONT SIGNÉS. Un avoir vaut -925,15 et se règle par une
// transaction négative ; prendre une valeur absolue quelque part ferait
// apparaître un encaissement là où il y a un remboursement.
// ─────────────────────────────────────────────────────────────────────────────

// Tolérance de comparaison des montants : le centime. Les arrondis ProGBat
// eux-mêmes en produisent (1850,31 se scinde en 925,16 + 925,15).
export const TOLERANCE_EUR = 0.01;

// Motifs de refus, tous explicites : l'appelant doit pouvoir compter les
// brouillons ignorés sans les confondre avec des données illisibles.
export const REFUS = {
  BROUILLON: "brouillon",                 // validated ≠ 1
  BILL_ID_INVALIDE: "bill_id_invalide",   // pas d'entier strictement positif
  MONTANT_ABSENT: "montant_absent",       // toBePaid illisible
  FACTURE_MANUELLE: "facture_manuelle",   // fusion refusée : la cible est saisie à la main
  BILL_DIFFERENT: "bill_different",       // fusion refusée : ce n'est pas la même facture
  DOC_TYPE: "doc_type",                   // checking qui ne lettre pas une facture
  DOC_ID_INVALIDE: "doc_id_invalide",
  TRANSACTION_INVALIDE: "transaction_invalide",
  MONTANT_INVALIDE: "montant_invalide",
};

// États de règlement d'une facture. `partielle` n'est PAS un statut enregistré :
// le statut en base reste emise / encaissee / annulee, et l'état ci-dessous est
// DÉRIVÉ des règlements à chaque affichage.
export const ETAT_REGLEMENT = {
  NON_REGLEE: "non_reglee",
  PARTIELLE: "partielle",
  REGLEE: "reglee",
  SURPAIEMENT: "surpaiement",             // anomalie
  SIGNE_INCOHERENT: "signe_incoherent",   // anomalie
  MONTANT_INCONNU: "montant_inconnu",     // anomalie
};

// ── Normalisations élémentaires ─────────────────────────────────────────────

// Identifiant ProGBat exploitable : entier strictement positif. Même règle que
// progbatLiaison.mjs et progbatYards.mjs — 0, null, "" et "abc" sont « absent »,
// parce que ProGBat numérote à partir de 1.
export const idProgbat = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
};

// Montant : le SIGNE est conservé, toujours. null si illisible — surtout pas 0,
// qui se confondrait avec « facture soldée ».
export const montantOuNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const entierOuNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
};

const texteOuNull = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};

// Date seule : ProGBat renvoie tantôt "2026-09-16", tantôt un ISO complet.
const dateOuNull = (v) => {
  const s = texteOuNull(v, 40);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
};

// Booléen prudent : true/false seulement sur une valeur qui en est un sans
// ambiguïté. Tout le reste vaut null — on ne devine pas.
const booleenOuNull = (v) => {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return null;
};

const arrondi = (n) => Math.round(n * 100) / 100;

// ── Listes blanches des sous-objets ─────────────────────────────────────────
// Schéma ProGBat documenté :
//   taxDetails[] : level, rate, base, amount
//   deductions[] : label, amount, afterTaxes, direction ("plus"|"minus"), taxRate
// On RECONSTRUIT chaque entrée champ par champ : un champ ajouté demain par
// ProGBat ne peut pas entrer en base par omission. Une entrée qui ne porte
// aucun champ connu est écartée plutôt que stockée vide.
export const CHAMPS_TAX_DETAIL = Object.freeze(["level", "rate", "base", "amount"]);
export const CHAMPS_DEDUCTION = Object.freeze(["label", "amount", "afterTaxes", "direction", "taxRate"]);

const projeterTaxDetail = (d) => {
  const out = {
    level: texteOuNull(d?.level, 60),
    rate: montantOuNull(d?.rate),
    base: montantOuNull(d?.base),
    amount: montantOuNull(d?.amount),
  };
  return CHAMPS_TAX_DETAIL.some((c) => out[c] !== null) ? out : null;
};

const projeterDeduction = (d) => {
  const direction = texteOuNull(d?.direction, 10);
  const out = {
    label: texteOuNull(d?.label, 120),
    amount: montantOuNull(d?.amount),
    afterTaxes: booleenOuNull(d?.afterTaxes),
    direction: direction === "plus" || direction === "minus" ? direction : null,
    taxRate: montantOuNull(d?.taxRate),
  };
  return CHAMPS_DEDUCTION.some((c) => out[c] !== null) ? out : null;
};

const projeterListe = (valeur, projeter) => {
  if (!Array.isArray(valeur)) return null;
  return valeur.map(projeter).filter(Boolean);
};

// ── A. Facture ProGBat → ligne chantier_factures_client ─────────────────────
/**
 * @param facture  objet bill tel que ProGBat le renvoie (liste ou détail)
 * @param options  { synchroniseLe } horodatage à poser dans progbat_synced_at.
 *                 Injecté plutôt que lu d'une horloge : le module reste pur et
 *                 deux appels sur la même facture donnent le même résultat.
 * @returns { ok: true, ligne } | { ok: false, motif, raison }
 *
 * `ligne` est une ligne de chantier_factures_client prête à insérer : ni
 * chantier_id (c'est progbatLiaison qui le résout), ni ligne_id (c'est le
 * rapprochement), ni content[], ni client, ni adresse, ni payload brut.
 */
export function normaliserFactureProgbat(facture, { synchroniseLe = null } = {}) {
  const validated = entierOuNull(facture?.validated);
  if (validated !== 1) {
    return {
      ok: false,
      motif: REFUS.BROUILLON,
      raison: `Facture ProGBat non validée (validated = ${facture?.validated ?? "absent"}) : brouillon, non importée.`,
    };
  }

  const billId = idProgbat(facture?.id);
  if (billId === null) {
    return {
      ok: false,
      motif: REFUS.BILL_ID_INVALIDE,
      raison: "Facture ProGBat sans identifiant exploitable (bill.id) : non importée.",
    };
  }

  // toBePaid est LE montant dû. Sans lui, la facture n'est pas exploitable :
  // on refuse plutôt que de se rabattre sur atiTotal, qui est cumulatif.
  const toBePaid = montantOuNull(facture?.toBePaid);
  if (toBePaid === null) {
    return {
      ok: false,
      motif: REFUS.MONTANT_ABSENT,
      raison: `Facture ProGBat n° ${billId} sans montant exigible (toBePaid) : non importée.`,
    };
  }

  return {
    ok: true,
    ligne: {
      source: "progbat",

      // Identité et rattachement (le chantier lui-même est résolu ailleurs).
      progbat_bill_id: billId,
      progbat_bill_code: texteOuNull(facture?.code, 60),
      progbat_quote_id: idProgbat(facture?.quoteId),
      progbat_yard_id: idProgbat(facture?.yardId),
      progbat_business_id: idProgbat(facture?.businessId),
      progbat_type: texteOuNull(facture?.type, 40),
      progbat_situation_number: entierOuNull(facture?.situationNumber),
      progbat_status: entierOuNull(facture?.status),
      progbat_validated: validated,
      progbat_revision_number: entierOuNull(facture?.revisionNumber),
      progbat_document_date: dateOuNull(facture?.documentDate),
      progbat_due_date: dateOuNull(facture?.dueDate),

      // Montants ProGBat exacts, tous signés, aucun recalcul.
      progbat_deal_net_total: montantOuNull(facture?.dealNetTotal),
      progbat_deal_taxes: montantOuNull(facture?.dealTaxes),
      progbat_deal_ati_total: montantOuNull(facture?.dealAtiTotal),
      progbat_achievement: montantOuNull(facture?.achievement),
      progbat_previous_achievement: montantOuNull(facture?.previousAchievement),
      progbat_net_total: montantOuNull(facture?.netTotal),
      progbat_taxes: montantOuNull(facture?.taxes),
      progbat_ati_total: montantOuNull(facture?.atiTotal),
      progbat_holdback: montantOuNull(facture?.holdback),
      progbat_deducted_advance: montantOuNull(facture?.deductedAdvance),
      progbat_to_be_paid: toBePaid,
      progbat_ati_deductions: montantOuNull(facture?.atiDeductions),
      progbat_tax_details: projeterListe(facture?.taxDetails, projeterTaxDetail),
      progbat_deductions: projeterListe(facture?.deductions, projeterDeduction),
      progbat_dgd: booleenOuNull(facture?.dgd),
      progbat_synced_at: synchroniseLe,

      // Champs génériques du registre.
      numero: texteOuNull(facture?.code, 60),
      date_facture: dateOuNull(facture?.documentDate),
      // LE point : le TTC exigible, signé. Ni HT ni TVA — voir l'en-tête.
      montant_ttc: toBePaid,
      montant_ht: null,
      montant_tva: null,
      statut: "emise",
    },
  };
}

// ── B. Fusion idempotente ───────────────────────────────────────────────────
/**
 * Applique une facture ProGBat fraîchement lue sur la ligne déjà en base.
 *
 * @param existante ligne de chantier_factures_client (ou null → création)
 * @param entrante  `ligne` produite par normaliserFactureProgbat
 * @returns { ok: true, ligne, creation } | { ok: false, motif, raison }
 *
 * Ce que la source distante décide : tous les progbat_*, le numéro, la date et
 * montant_ttc. Ce qu'elle ne touche JAMAIS :
 *   - chantier_id           → posé par la résolution (progbatLiaison), qui peut
 *                             avoir été corrigée à la main ;
 *   - le statut             → l'encaissement et l'annulation sont du travail
 *                             humain ; ce lot ne décide d'aucune annulation
 *                             distante (progbat_status n'est pas une preuve) ;
 *   - ligne_id, rapprochement, raison SI ligne_id_verrouille = true.
 * Une facture source='manuel' n'est jamais transformée : elle est refusée.
 */
export function fusionnerFactureProgbat(existante, entrante) {
  if (!entrante || entrante.source !== "progbat" || !idProgbat(entrante.progbat_bill_id)) {
    return { ok: false, motif: REFUS.BILL_ID_INVALIDE, raison: "Facture entrante inexploitable." };
  }
  if (!existante) {
    // La création produit EXACTEMENT la même forme qu'une mise à jour : sans
    // cela, la deuxième synchronisation « modifierait » la facture rien qu'en
    // complétant les champs de rapprochement restés absents.
    return {
      ok: true,
      creation: true,
      ligne: {
        ...entrante,
        chantier_id: entrante.chantier_id ?? null,
        ligne_id: entrante.ligne_id ?? null,
        ligne_nom: entrante.ligne_nom ?? null,
        rapprochement: entrante.rapprochement ?? null,
        raison: entrante.raison ?? null,
        ligne_id_verrouille: false,
        ligne_id_modifie_par: null,
        ligne_id_modifie_le: null,
      },
    };
  }
  if (existante.source !== "progbat") {
    return {
      ok: false,
      motif: REFUS.FACTURE_MANUELLE,
      raison: "Cette facture a été saisie à la main : la synchronisation ProGBat ne la modifie pas.",
    };
  }
  if (idProgbat(existante.progbat_bill_id) !== idProgbat(entrante.progbat_bill_id)) {
    return {
      ok: false,
      motif: REFUS.BILL_DIFFERENT,
      raison: "La facture existante porte un autre bill.id : rapprochement impossible.",
    };
  }

  const verrouille = existante.ligne_id_verrouille === true;
  const ligne = {
    ...existante,
    ...entrante,
    // Le chantier reste celui déjà choisi, quoi qu'il arrive.
    chantier_id: existante.chantier_id ?? null,
    // Le statut suit l'humain, pas ProGBat.
    statut: existante.statut ?? entrante.statut,
    // L'échéance : corrigée à la main = intouchable. Sinon, une proposition de
    // rapprochement portée par l'entrante peut la mettre à jour ; à défaut, la
    // valeur en place est conservée — jamais effacée.
    ligne_id: verrouille ? existante.ligne_id ?? null : entrante.ligne_id ?? existante.ligne_id ?? null,
    ligne_nom: verrouille ? existante.ligne_nom ?? null : entrante.ligne_nom ?? existante.ligne_nom ?? null,
    rapprochement: verrouille ? existante.rapprochement ?? null : entrante.rapprochement ?? existante.rapprochement ?? null,
    raison: verrouille ? existante.raison ?? null : entrante.raison ?? existante.raison ?? null,
    ligne_id_verrouille: verrouille,
    ligne_id_modifie_par: existante.ligne_id_modifie_par ?? null,
    ligne_id_modifie_le: existante.ligne_id_modifie_le ?? null,
  };
  return { ok: true, creation: false, ligne };
}

// ── C. Lettrage d'une transaction → ligne de règlement ──────────────────────
/**
 * @param transaction ligne de GET /company/transactions
 * @param checking    une entrée de transaction.checking[]
 * @returns { ok: true, ligne } | { ok: false, motif, raison }
 *
 * `ligne.progbat_bill_id` désigne la facture à retrouver (checking.docId) :
 * l'appelant y substituera le facture_id local. Rien de bancaire ne sort ici —
 * ni bankAccountId, ni label, ni paymentNumber, ni IBAN.
 */
export function normaliserReglementProgbat(transaction, checking, { synchroniseLe = null } = {}) {
  // docType est comparé à "bill" EXACTEMENT : ProGBat n'énumère pas ses
  // valeurs, et un lettrage de facture fournisseur ou d'avoir d'achat ne doit
  // pas atterrir sur une facture client.
  if (checking?.docType !== "bill") {
    return {
      ok: false,
      motif: REFUS.DOC_TYPE,
      raison: `Lettrage ignoré : docType « ${checking?.docType ?? "absent"} » ne désigne pas une facture client.`,
    };
  }
  const billId = idProgbat(checking?.docId);
  if (billId === null) {
    return { ok: false, motif: REFUS.DOC_ID_INVALIDE, raison: "Lettrage sans identifiant de facture exploitable." };
  }
  const transactionId = idProgbat(transaction?.id);
  if (transactionId === null) {
    return { ok: false, motif: REFUS.TRANSACTION_INVALIDE, raison: "Transaction sans identifiant exploitable." };
  }
  const montant = montantOuNull(checking?.amount);
  if (montant === null) {
    return { ok: false, motif: REFUS.MONTANT_INVALIDE, raison: `Lettrage de la facture n° ${billId} sans montant lisible.` };
  }

  return {
    ok: true,
    ligne: {
      source: "progbat",
      progbat_transaction_id: transactionId,
      progbat_doc_type: "bill",
      progbat_bill_id: billId,          // → facture_id, résolu par l'appelant
      date_reglement: dateOuNull(transaction?.date),
      montant,                          // signé
      mode: texteOuNull(transaction?.paymentMode, 40),
      // `canceled` n'a AUCUNE sémantique documentée côté ProGBat et n'a pas été
      // établie sur les données réelles (voir progbat-test-connection, qui le
      // remonte tel quel sans l'interpréter). On le CONSERVE brut et on
      // n'annule rien : décider ici qu'un 1 signifie « annulé » ferait
      // disparaître un règlement réel de tous les soldes.
      progbat_canceled: entierOuNull(transaction?.canceled),
      annule: false,
      progbat_synced_at: synchroniseLe,
    },
  };
}

/** Tous les règlements d'une transaction, lettrages non-facture écartés. */
export function reglementsDeTransaction(transaction, options = {}) {
  const lignes = Array.isArray(transaction?.checking) ? transaction.checking : [];
  const retenus = [];
  const ignores = [];
  for (const c of lignes) {
    const r = normaliserReglementProgbat(transaction, c, options);
    if (r.ok) retenus.push(r.ligne);
    else ignores.push({ motif: r.motif, raison: r.raison });
  }
  return { retenus, ignores };
}

// ── D. État de règlement d'une facture ──────────────────────────────────────
/**
 * @param facture    ligne de chantier_factures_client (montant_ttc signé)
 * @param reglements lignes de chantier_factures_reglements
 * @returns { etat, anomalie, montant_du, somme_reglee, solde, nombre, raison }
 *
 * Fonctionne à l'identique pour une facture positive et pour un avoir négatif.
 * progbat_status n'entre PAS dans ce calcul : seules les transactions font foi.
 */
export function etatReglementProgbat(facture, reglements = []) {
  const montantDu = montantOuNull(facture?.montant_ttc);
  const vivants = (Array.isArray(reglements) ? reglements : []).filter((r) => r && r.annule !== true);
  const somme = arrondi(vivants.reduce((s, r) => s + (montantOuNull(r.montant) ?? 0), 0));
  const base = { somme_reglee: somme, nombre: vivants.length, montant_du: montantDu };

  if (montantDu === null) {
    return {
      ...base, etat: ETAT_REGLEMENT.MONTANT_INCONNU, anomalie: true, solde: null,
      raison: "Montant dû inconnu : l'état de règlement ne peut pas être établi.",
    };
  }

  const solde = arrondi(montantDu - somme);

  // Facture à zéro : tout règlement non nul est un surpaiement.
  if (Math.abs(montantDu) <= TOLERANCE_EUR) {
    return Math.abs(somme) <= TOLERANCE_EUR
      ? { ...base, etat: ETAT_REGLEMENT.REGLEE, anomalie: false, solde, raison: "Facture à zéro, rien à encaisser." }
      : { ...base, etat: ETAT_REGLEMENT.SURPAIEMENT, anomalie: true, solde,
          raison: `Facture à zéro mais ${somme.toFixed(2)} € encaissés.` };
  }

  // Signe : un avoir (négatif) se règle par un remboursement (négatif). Un
  // encaissement positif sur un avoir est une anomalie, pas un solde partiel.
  if (Math.abs(somme) > TOLERANCE_EUR && Math.sign(somme) !== Math.sign(montantDu)) {
    return {
      ...base, etat: ETAT_REGLEMENT.SIGNE_INCOHERENT, anomalie: true, solde,
      raison: `Sens contraire : facture de ${montantDu.toFixed(2)} €, règlements de ${somme.toFixed(2)} €.`,
    };
  }

  if (Math.abs(solde) <= TOLERANCE_EUR) {
    return { ...base, etat: ETAT_REGLEMENT.REGLEE, anomalie: false, solde, raison: "Facture réglée." };
  }
  if (Math.abs(somme) > Math.abs(montantDu) + TOLERANCE_EUR) {
    return {
      ...base, etat: ETAT_REGLEMENT.SURPAIEMENT, anomalie: true, solde,
      raison: `Encaissé ${somme.toFixed(2)} € pour ${montantDu.toFixed(2)} € dus.`,
    };
  }
  if (Math.abs(somme) <= TOLERANCE_EUR) {
    return { ...base, etat: ETAT_REGLEMENT.NON_REGLEE, anomalie: false, solde, raison: "Aucun règlement." };
  }
  return {
    ...base, etat: ETAT_REGLEMENT.PARTIELLE, anomalie: false, solde,
    raison: `Réglée en partie : ${somme.toFixed(2)} € sur ${montantDu.toFixed(2)} €, reste ${solde.toFixed(2)} €.`,
  };
}

// ── Correction humaine d'une échéance ───────────────────────────────────────
/**
 * Produit le PATCH qui corrige l'échéance d'une facture et VERROUILLE ce choix.
 * Aucun écran ne l'utilise encore ; la règle est posée ici pour que l'écran à
 * venir et la synchronisation ne puissent pas en avoir deux versions.
 *
 * @param facture  la facture concernée (lue pour son ligne_id actuel)
 * @param patch    { ligneId, ligneNom, utilisateurId, maintenant, raison }
 * @returns le patch à appliquer, ou null si rien ne change.
 */
export function corrigerLigneFacture(facture, { ligneId = null, ligneNom = null, utilisateurId = null, maintenant = null, raison = null } = {}) {
  const avant = facture?.ligne_id ?? null;
  const apres = ligneId === "" ? null : ligneId ?? null;
  if (avant === apres && facture?.ligne_id_verrouille === true) return null;
  return {
    ligne_id: apres,
    ligne_nom: ligneNom ?? null,
    // Le verrou est le cœur : à partir d'ici, fusionnerFactureProgbat ne
    // reprendra plus ni l'échéance ni son explication.
    ligne_id_verrouille: true,
    ligne_id_modifie_par: utilisateurId ?? null,
    ligne_id_modifie_le: maintenant ?? null,
    rapprochement: "corrige",
    raison: raison ?? "Échéance corrigée à la main.",
  };
}
