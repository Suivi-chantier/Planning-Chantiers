// ─────────────────────────────────────────────────────────────────────────────
// AFFICHAGE DES FACTURES ProGBat D'UN CHANTIER — règles pures.
//
// Ce module ne fait qu'une chose : dire, pour une facture ProGBat et ses
// règlements, ce qu'elle a encaissé et où elle en est. Aucun réseau, aucune
// base, aucune horloge — il se vérifie entièrement avec des objets littéraux
// (scripts/verif-factures-progbat-affichage.mjs).
//
// POURQUOI UN MODULE À PART
// ─────────────────────────
// progbatFacturation.mjs porte déjà etatReglementProgbat(), utilisé par la
// SYNCHRONISATION. Ses libellés sont ceux du registre (non_reglee, partielle,
// surpaiement…) et ne distinguent pas le vocabulaire d'un avoir. L'écran, lui,
// doit dire « Avoir non remboursé » et non « Facture non réglée ». Plutôt que
// d'élargir un module dont dépend l'écriture en base, l'affichage a ses propres
// règles, ici, et progbatFacturation.mjs n'est pas touché.
//
// TOUT EST SIGNÉ, ET LE RESTE NE PERD JAMAIS SON SIGNE
// ────────────────────────────────────────────────────
//     reste = montant_ttc − somme des règlements actifs
// Un avoir vaut −925,15 et se rembourse par une transaction négative. Prendre
// une valeur absolue quelque part ferait apparaître un encaissement là où il y
// a un remboursement.
//
// UN RÈGLEMENT ANNULÉ N'EXISTE PAS. `annule = true` sort de tous les totaux,
// de tous les états et de toutes les listes affichées.
//
// progbat_status N'ENTRE DANS AUCUN CALCUL : seules les transactions font foi.
// C'est la règle posée par la synchronisation, elle vaut aussi pour l'écran.
// ─────────────────────────────────────────────────────────────────────────────

/** Le centime. Les arrondis de ProGBat en produisent (1850,31 = 925,16 + 925,15). */
export const TOLERANCE_EUR = 0.01;

export const ETAT = Object.freeze({
  MONTANT_INCONNU: "montant_inconnu",
  // Facture ou acompte positif
  NON_REGLEE: "non_reglee",
  PARTIELLE: "partielle",
  REGLEE: "reglee",
  SUR_REGLEE: "sur_reglee",
  // Avoir négatif
  AVOIR_NON_REMBOURSE: "avoir_non_rembourse",
  AVOIR_PARTIEL: "avoir_partiel",
  AVOIR_REMBOURSE: "avoir_rembourse",
  AVOIR_SUR_REMBOURSE: "avoir_sur_rembourse",
  // Les deux
  SIGNE_INCOHERENT: "signe_incoherent",
});

/** Ce que l'écran affiche, mot pour mot. */
export const LIBELLE_ETAT = Object.freeze({
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

/** États qui méritent un œil : ils ne décrivent pas un déroulé normal. */
export const ETATS_ANOMALIE = Object.freeze([
  ETAT.MONTANT_INCONNU, ETAT.SUR_REGLEE, ETAT.AVOIR_SUR_REMBOURSE, ETAT.SIGNE_INCOHERENT,
]);

const arrondi = (n) => Math.round(n * 100) / 100;

/** Montant lisible, SIGNE conservé. null si illisible — surtout pas 0, qui se
 *  confondrait avec « soldé ». PostgREST rend un numeric en chaîne. */
export const montantOuNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Les règlements qui comptent. Un `annule = true` n'existe plus, nulle part. */
export const reglementsActifs = (reglements) =>
  (Array.isArray(reglements) ? reglements : []).filter((r) => r && r.annule !== true);

/** Somme SIGNÉE des règlements actifs, au centime. */
export function sommeReglements(reglements) {
  return arrondi(reglementsActifs(reglements).reduce((s, r) => s + (montantOuNull(r.montant) ?? 0), 0));
}

// ── DOCUMENTS D'ANNULATION ──────────────────────────────────────────────────
// Établi sur les 482 documents réels (section annulations_documents du
// diagnostic) : 50 documents portent un situationNumber entier strictement
// négatif ; les 50 références abs(situationNumber) existent ; les 50 documents
// référencés portent validated = 2 ; les 50 couples ont des toBePaid ET des
// atiTotal exactement inverses ; aucune référence ne manque.
//
//     situationNumber < 0  ⇒  document d'ANNULATION,
//                             qui neutralise le document d'identifiant
//                             abs(situationNumber).
//
// CE QUE CETTE RÈGLE N'EST PAS. Elle ne dépend NI du signe du montant — un
// document d'annulation peut être positif, F-260072 en est un —, NI du type
// (on observe bill-credit et advance-credit), NI du yard ou du devis, parfois
// absents. Se fier au montant négatif ou au mot « avoir » manquerait la moitié
// des cas et en inventerait d'autres.
//
// Le document annulé, lui, n'est PAS en base : validated = 2 l'écarte de la
// synchronisation. On ne le cherche donc pas — on se contente de nommer son
// identifiant.

/** Entier STRICT : -469 et "-469" oui ; 0, 3.5, "", "abc", true, null non. */
const entierStrict = (v) => {
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
};

/**
 * @returns { est_document_annulation, progbat_bill_id_reference }
 * La référence n'est renvoyée que si elle est exploitable : un entier
 * strictement négatif, dont la valeur absolue est un identifiant sûr.
 */
export function referenceAnnulationProgbat(facture) {
  const situation = entierStrict(facture?.progbat_situation_number);
  if (situation === null || situation >= 0) {
    return { est_document_annulation: false, progbat_bill_id_reference: null };
  }
  const reference = Math.abs(situation);
  if (!Number.isSafeInteger(reference) || reference <= 0) {
    return { est_document_annulation: false, progbat_bill_id_reference: null };
  }
  return { est_document_annulation: true, progbat_bill_id_reference: reference };
}

/**
 * Nature lisible d'un document ProGBat.
 * L'ordre est celui de la lecture métier : un acompte reste un acompte, même
 * si son montant est négatif — c'est son type qui le décrit, pas son signe.
 */
export function natureFactureProgbat(facture) {
  if (facture?.progbat_type === "advance") return "acompte";
  const ttc = montantOuNull(facture?.montant_ttc);
  if (ttc !== null && ttc < 0) return "avoir";
  return "facture";
}

export const LIBELLE_NATURE = Object.freeze({ acompte: "Acompte", avoir: "Avoir", facture: "Facture" });

/**
 * Le nom affiché. Le numéro d'abord — c'est ce que le client a reçu — puis le
 * code ProGBat, et en dernier recours l'identifiant technique, pour qu'une
 * facture sans numéro reste identifiable au lieu d'apparaître vide.
 */
export function libelleFactureProgbat(facture) {
  const numero = String(facture?.numero ?? "").trim();
  if (numero) return numero;
  const code = String(facture?.progbat_bill_code ?? "").trim();
  if (code) return code;
  const id = facture?.progbat_bill_id;
  return id === null || id === undefined || id === "" ? "Facture ProGBat" : `Facture ProGBat n°${id}`;
}

/**
 * OÙ EN EST UNE FACTURE.
 *
 * @param facture    { montant_ttc } — signé
 * @param reglements lignes de chantier_factures_reglements (annulées comprises,
 *                   elles sont écartées ici)
 * @returns { montant_du, somme_reglee, reste, nombre, etat, libelle, anomalie }
 *
 * Le montant à zéro est traité comme une facture positive : rien à encaisser,
 * donc tout encaissement est un sur-règlement.
 */
export function etatFactureProgbat(facture, reglements = []) {
  const montantDu = montantOuNull(facture?.montant_ttc);
  const actifs = reglementsActifs(reglements);
  const somme = sommeReglements(actifs);
  const base = { montant_du: montantDu, somme_reglee: somme, nombre: actifs.length };

  const rendre = (etat, reste) => ({
    ...base, reste, etat,
    libelle: LIBELLE_ETAT[etat],
    anomalie: ETATS_ANOMALIE.includes(etat),
  });

  if (montantDu === null) return rendre(ETAT.MONTANT_INCONNU, null);

  // Le reste garde TOUJOURS son signe, quel que soit l'état conclu.
  const reste = arrondi(montantDu - somme);
  const rienEncaisse = Math.abs(somme) <= TOLERANCE_EUR;

  // ── Avoir : montant négatif, remboursement négatif ──────────────────────
  if (montantDu < -TOLERANCE_EUR) {
    if (rienEncaisse) return rendre(ETAT.AVOIR_NON_REMBOURSE, reste);
    if (somme > 0) return rendre(ETAT.SIGNE_INCOHERENT, reste);      // encaissé sur un avoir
    if (Math.abs(reste) <= TOLERANCE_EUR) return rendre(ETAT.AVOIR_REMBOURSE, reste);
    if (Math.abs(somme) > Math.abs(montantDu) + TOLERANCE_EUR) return rendre(ETAT.AVOIR_SUR_REMBOURSE, reste);
    return rendre(ETAT.AVOIR_PARTIEL, reste);
  }

  // ── Facture, acompte, ou montant nul ────────────────────────────────────
  if (rienEncaisse) {
    // Une facture à zéro sans règlement est soldée, pas « non réglée ».
    return rendre(Math.abs(montantDu) <= TOLERANCE_EUR ? ETAT.REGLEE : ETAT.NON_REGLEE, reste);
  }
  if (somme < 0) return rendre(ETAT.SIGNE_INCOHERENT, reste);        // remboursé sur une facture
  if (Math.abs(reste) <= TOLERANCE_EUR) return rendre(ETAT.REGLEE, reste);
  if (somme > montantDu + TOLERANCE_EUR) return rendre(ETAT.SUR_REGLEE, reste);
  return rendre(ETAT.PARTIELLE, reste);
}

/**
 * Regroupe les règlements par facture. Les lignes annulées sont écartées dès
 * ici : elles ne doivent apparaître dans aucune liste affichée.
 * @returns Map facture_id → règlements actifs, triés par date puis identifiant
 */
export function grouperReglements(reglements) {
  const parFacture = new Map();
  for (const r of reglementsActifs(reglements)) {
    const cle = r?.facture_id === null || r?.facture_id === undefined ? null : String(r.facture_id);
    if (cle === null) continue;
    if (!parFacture.has(cle)) parFacture.set(cle, []);
    parFacture.get(cle).push(r);
  }
  for (const liste of parFacture.values()) {
    liste.sort((a, b) => String(a.date_reglement ?? "").localeCompare(String(b.date_reglement ?? ""))
      || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  }
  return parFacture;
}

/**
 * Le bandeau de tête : combien de factures, combien facturé, combien encaissé,
 * combien reste. Tout en TTC SIGNÉ — un avoir diminue le total facturé, son
 * remboursement diminue le total réglé, et le reste suit.
 *
 * Une facture au montant illisible n'entre pas dans les totaux (elle serait
 * comptée 0, ce qui est faux) mais reste comptée dans le nombre et signalée.
 */
export function totauxFacturesProgbat(factures, parFacture = new Map()) {
  const liste = Array.isArray(factures) ? factures : [];
  let totalFacture = 0;
  let totalRegle = 0;
  let sansMontant = 0;
  let anomalies = 0;

  for (const f of liste) {
    const reglements = parFacture.get(String(f?.id)) ?? [];
    const e = etatFactureProgbat(f, reglements);
    if (e.montant_du === null) { sansMontant++; if (e.anomalie) anomalies++; continue; }
    totalFacture += e.montant_du;
    totalRegle += e.somme_reglee;
    if (e.anomalie) anomalies++;
  }

  const total = arrondi(totalFacture);
  const regle = arrondi(totalRegle);
  return {
    nombre: liste.length,
    total_facture: total,
    total_regle: regle,
    reste: arrondi(total - regle),
    sans_montant: sansMontant,
    anomalies,
  };
}

const parDatePuisId = (a, b) =>
  String(a.facture?.date_facture ?? "").localeCompare(String(b.facture?.date_facture ?? ""))
  || (Number(a.facture?.progbat_bill_id ?? 0) - Number(b.facture?.progbat_bill_id ?? 0));

/**
 * Tout ce dont l'écran a besoin, en une passe, en DEUX groupes.
 *
 *   factures_actives    → ce qui est réellement dû et encaissé : montants,
 *                         états, totaux. Un vrai avoir (montant négatif, sans
 *                         situationNumber négatif) en fait partie et garde sa
 *                         logique de remboursement.
 *   documents_annulation → conservés pour l'historique, et EXCLUS de tout :
 *                         du nombre, du facturé, du réglé, du reste, des
 *                         états. Leurs règlements éventuels le sont aussi.
 *
 * Rien n'est supprimé : les deux groupes sortent d'ici, l'écran montre le
 * second dans un repli. Trié par date puis par identifiant ProGBat, pour un
 * ordre stable d'un chargement à l'autre.
 */
export function composerFacturesProgbat(factures, reglements) {
  const parFacture = grouperReglements(reglements);
  const reglementsDe = (f) => parFacture.get(String(f?.id)) ?? [];

  const actives = [];
  const annulations = [];
  const facturesActives = [];

  for (const f of Array.isArray(factures) ? factures : []) {
    const reference = referenceAnnulationProgbat(f);
    if (reference.est_document_annulation) {
      annulations.push({
        facture: f,
        reglements: reglementsDe(f),
        libelle: libelleFactureProgbat(f),
        reference,
      });
      continue;
    }
    facturesActives.push(f);
    actives.push({
      facture: f,
      reglements: reglementsDe(f),
      etat: etatFactureProgbat(f, reglementsDe(f)),
      nature: natureFactureProgbat(f),
      libelle: libelleFactureProgbat(f),
    });
  }

  actives.sort(parDatePuisId);
  annulations.sort(parDatePuisId);

  return {
    factures_actives: actives,
    documents_annulation: annulations,
    // Les totaux ne voient QUE les actives : c'est là que se joue la
    // correction. Un document d'annulation n'a ni dû, ni reste.
    totaux: totauxFacturesProgbat(facturesActives, parFacture),
  };
}
