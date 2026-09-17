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

// ─────────────────────────────────────────────────────────────────────────────
// RATTACHEMENT À UNE ÉCHÉANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Numéro de situation porté par une ligne d'échéancier, ou null.
 *
 * Lu sur le LIBELLÉ (« Facture de situation n° 2 ») et sur l'identifiant
 * (« situation_2 »), qui sont les deux seules formes que produisent
 * normaliserEcheancier() et l'écran de réglage. Si les deux sont présents et se
 * contredisent, la ligne n'a PAS de numéro : mieux vaut aucune suggestion
 * qu'une suggestion tirée d'une ambiguïté.
 */
export function numeroSituationLigne(ligne) {
  const surNom = /situation\s*n\s*[°ºo]?\s*(\d{1,3})(?!\d)/i.exec(String(ligne?.nom ?? ""));
  const surId = /^situation[_-]?(\d{1,3})$/i.exec(String(ligne?.id ?? "").trim());
  const a = surNom ? Number(surNom[1]) : null;
  const b = surId ? Number(surId[1]) : null;
  if (a !== null && b !== null && a !== b) return null;
  const n = a ?? b;
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Suggestion de rattachement — UNE PROPOSITION, JAMAIS UNE ÉCRITURE.
 * L'écran doit la présenter comme telle et exiger une confirmation.
 *
 * Ne suggère QUE sur un fait certain : le numéro de situation. Aucun
 * rapprochement par montant, date, client, adresse ou libellé approximatif —
 * ce sont ces rapprochements-là qui cochent la mauvaise ligne d'argent.
 *
 * Refuse, dans cet ordre :
 *   • un document d'annulation — il ne se rattache à aucune échéance ;
 *   • un avoir actif (montant négatif) — hors périmètre de ce lot ;
 *   • situationNumber = 0 — ce peut être l'acompte comme le démarrage ;
 *   • plusieurs lignes portant le même numéro — ambiguïté.
 */
export function suggestionLigneProgbat(facture, echeancier = []) {
  if (referenceAnnulationProgbat(facture).est_document_annulation) return null;
  const ttc = montantOuNull(facture?.montant_ttc);
  if (ttc === null || ttc < 0) return null;
  const numero = entierStrict(facture?.progbat_situation_number);
  if (numero === null || numero <= 0) return null;

  const candidates = (Array.isArray(echeancier) ? echeancier : [])
    .filter((l) => numeroSituationLigne(l) === numero);
  if (candidates.length !== 1) return null;

  const ligne = candidates[0];
  const id = String(ligne?.id ?? "").trim();
  if (!id) return null;
  return {
    ligne_id: id,
    ligne_nom: String(ligne?.nom ?? "").slice(0, 80) || null,
    numero_situation: numero,
    raison: `Situation n° ${numero} : une seule échéance porte ce numéro.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CROISEMENT ÉCHÉANCIER × FACTURES ProGBat
// ─────────────────────────────────────────────────────────────────────────────
// Le bandeau du haut raisonne en HT. Une facture ProGBat n'a QUE son TTC
// (montant_ht est volontairement NULL : netTotal et taxes suivent atiTotal
// cumulatif et ne décrivent pas le HT exigible). Reconstituer un HT en divisant
// le TTC donnerait un nombre plausible, faux, et qui finirait dans un tableau
// comptable.
//
// LA BASE HT EST DONC CELLE DE L'ÉCHÉANCIER, jamais celle de la facture :
//     facturé   → le HT PRÉVU de la ligne, dès qu'une facture ProGBat active
//                 lui est rattachée ;
//     encaissé  → ce même HT prévu, au prorata de ce qui est réellement réglé
//                 côté ProGBat :  ratio = règlements actifs / TTC dû, borné à
//                 [0, 1].
// Une ligne entièrement réglée pèse donc tout son HT prévu ; une ligne à moitié
// réglée, la moitié. C'est un ÉQUIVALENT, et l'écran doit le dire.

/** Pourquoi un ensemble lié ne permet aucun équivalent HT. */
export const ANOMALIE_LIGNE = Object.freeze({
  MONTANT_ILLISIBLE: "montant_illisible",
  TTC_NON_POSITIF: "ttc_non_positif",       // total nul, négatif, ou uniquement un avoir
  SIGNE_INCOHERENT: "signe_incoherent",
});
export const LIBELLE_ANOMALIE_LIGNE = Object.freeze({
  montant_illisible: "Montant ProGBat illisible : aucun équivalent HT n'est calculé.",
  ttc_non_positif: "Total TTC nul ou négatif (avoir seul) : aucun équivalent HT n'est calculé.",
  signe_incoherent: "Règlements de sens contraire au montant dû : aucun équivalent HT n'est calculé.",
});

/**
 * @param lignesEtat  etat.lignes d'etatFacturation() — chacune porte déjà son
 *                    montantAttendu (HT prévu), ses factures MANUELLES et ses
 *                    montantEmis / montantEncaisse manuels.
 * @param actives     entrées actives de composerFacturesProgbat() —
 *                    { facture, reglements, etat, libelle }
 * @param montantReference marché HT
 * @param totauxManuels    etat.totaux — le calcul manuel actuel, intact
 *
 * @returns { parLigne: Map, totaux, lignesLiees, actif }
 *
 * `totaux` part des totaux MANUELS et n'y touche que pour les lignes reprises
 * par ProGBat : la contribution manuelle de ces lignes est retirée, celle de
 * l'échéancier est ajoutée. Sans aucun rattachement ProGBat, les totaux sont
 * donc rigoureusement ceux d'aujourd'hui — le manuel ne bouge pas d'un centime.
 */
export function croiserEcheancierProgbat({
  lignesEtat = [], actives = [], montantReference = 0, totauxManuels = null,
} = {}) {
  const parLigne = new Map();
  const attachees = new Map();
  for (const entree of Array.isArray(actives) ? actives : []) {
    const id = String(entree?.facture?.ligne_id ?? "").trim();
    if (!id) continue;
    if (!attachees.has(id)) attachees.set(id, []);
    attachees.get(id).push(entree);
  }

  let emisRetire = 0;
  let encaisseRetire = 0;
  let emisAjoute = 0;
  let encaisseAjoute = 0;
  let lignesLiees = 0;

  for (const ligne of Array.isArray(lignesEtat) ? lignesEtat : []) {
    const entrees = attachees.get(String(ligne?.id)) ?? [];
    if (!entrees.length) continue;
    lignesLiees++;

    const attendu = montantOuNull(ligne?.montantAttendu) ?? 0;
    const montants = entrees.map((e) => montantOuNull(e?.facture?.montant_ttc));
    const illisible = montants.some((m) => m === null);
    const ttcDu = arrondi(montants.reduce((s, m) => s + (m ?? 0), 0));
    const regle = arrondi(entrees.reduce((s, e) => s + sommeReglements(e?.reglements), 0));

    let anomalie = null;
    if (illisible) anomalie = ANOMALIE_LIGNE.MONTANT_ILLISIBLE;
    else if (ttcDu <= TOLERANCE_EUR) anomalie = ANOMALIE_LIGNE.TTC_NON_POSITIF;
    else if (regle < -TOLERANCE_EUR) anomalie = ANOMALIE_LIGNE.SIGNE_INCOHERENT;

    // Borné à [0, 1] : un surpaiement ne fait pas facturer plus que prévu, et
    // un remboursement ne fait pas descendre l'encaissé sous zéro.
    const ratio = anomalie ? null : Math.max(0, Math.min(1, regle / ttcDu));
    const equivalentHt = anomalie ? null : arrondi(ratio * attendu);

    // L'état affiché sur la ligne réutilise la règle des factures : un ensemble
    // lié se lit comme une facture unique de ttcDu réglée de `regle`.
    const etatLigne = etatFactureProgbat(
      { montant_ttc: illisible ? null : ttcDu },
      entrees.flatMap((e) => (Array.isArray(e?.reglements) ? e.reglements : [])),
    );

    // Une ligne portant AUSSI une facture manuelle : on ne compte qu'une fois
    // (ProGBat prime), et on le signale — rien n'est supprimé ni modifié.
    const doublonManuel = Array.isArray(ligne?.factures) && ligne.factures.length > 0;

    parLigne.set(String(ligne.id), {
      ligne_id: String(ligne.id),
      ligne_nom: ligne?.nom ?? null,
      montant_attendu_ht: attendu,
      entrees,
      numeros: entrees.map((e) => e.libelle),
      ttc_du: illisible ? null : ttcDu,
      regle,
      ratio,
      equivalent_ht: equivalentHt,
      etat: etatLigne.etat,
      libelle_etat: etatLigne.libelle,
      anomalie,
      libelle_anomalie: anomalie ? LIBELLE_ANOMALIE_LIGNE[anomalie] : null,
      doublon_manuel: doublonManuel,
    });

    emisRetire += montantOuNull(ligne?.montantEmis) ?? 0;
    encaisseRetire += montantOuNull(ligne?.montantEncaisse) ?? 0;
    emisAjoute += attendu;
    encaisseAjoute += equivalentHt ?? 0;
  }

  const ref = montantOuNull(montantReference) ?? 0;
  const emisManuel = montantOuNull(totauxManuels?.emis) ?? 0;
  const encaisseManuel = montantOuNull(totauxManuels?.encaisse) ?? 0;
  const factureHt = arrondi(emisManuel - emisRetire + emisAjoute);
  const encaisseHt = arrondi(encaisseManuel - encaisseRetire + encaisseAjoute);

  return {
    parLigne,
    lignesLiees,
    actif: lignesLiees > 0,
    totaux: {
      facture_ht: factureHt,
      encaisse_ht: encaisseHt,
      reste_a_facturer_ht: arrondi(ref - factureHt),
      reste_a_encaisser_ht: arrondi(factureHt - encaisseHt),
      pct_facture: ref > 0 ? Math.round((factureHt / ref) * 1000) / 10 : null,
      pct_encaisse: ref > 0 ? Math.round((encaisseHt / ref) * 1000) / 10 : null,
      anomalies: [...parLigne.values()].filter((l) => l.anomalie).length,
      doublons: [...parLigne.values()].filter((l) => l.doublon_manuel).length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAT VISUEL D'UNE ÉCHÉANCE COUVERTE PAR ProGBat
// ─────────────────────────────────────────────────────────────────────────────
// La pastille d'une ligne d'échéancier vient du cycle MANUEL : elle regarde les
// factures déposées à la main et le déclencheur (« à émettre » dès 40 %
// d'avancement). Sur une ligne facturée et encaissée dans ProGBat, elle affiche
// donc « prévue » ou « à émettre » — l'inverse de la réalité.
//
// Ce qui suit ne touche QUE l'apparence : la pastille, le cercle et la couleur
// de la carte. Aucune donnée n'est écrite, etatFacturation() n'est ni modifié
// ni rappelé, et les lignes SANS facture ProGBat gardent exactement leur
// affichage d'aujourd'hui.
//
// L'ORDRE DE PRIORITÉ EST DÉLIBÉRÉ. Un doublon manuel/ProGBat passe avant tout :
// c'est la seule situation où l'on ne sait pas quel document fait foi, et elle
// doit se voir avant l'état financier. Vient ensuite l'anomalie — jamais
// masquée par un état qui paraîtrait sain. L'état des règlements ne décide
// qu'en dernier.
export const STATUT_VISUEL_PROGBAT = Object.freeze({
  DOUBLON: "doublon",
  A_VERIFIER: "a_verifier",
  SURPAYEE: "surpayee",
  REGLEE: "reglee",
  PARTIELLE: "partielle",
  EMISE: "emise",
});

// `plein` : bordure pleine (l'échéance est engagée) ou pointillée (en cours).
// `coche` : pastille verte cochée — réservée à ce qui est réellement soldé.
// `alerte` : la carte prend le fond d'avertissement au lieu de rester neutre.
const STYLES_VISUELS = Object.freeze({
  doublon:    { label: "doublon à vérifier",      couleur: "#f59e0b", plein: true,  coche: false, alerte: true  },
  a_verifier: { label: "à vérifier",              couleur: "#e15a5a", plein: true,  coche: false, alerte: true  },
  surpayee:   { label: "surpayée",                couleur: "#f59e0b", plein: true,  coche: false, alerte: true  },
  reglee:     { label: "réglée",                  couleur: "#22c55e", plein: true,  coche: true,  alerte: false },
  // Vert POINTILLÉ : en route vers le vert plein, et distinct du bleu « émise ».
  partielle:  { label: "partiellement réglée",    couleur: "#22c55e", plein: false, coche: false, alerte: false },
  emise:      { label: "émise",                   couleur: "#4db8ff", plein: true,  coche: false, alerte: false },
});

/**
 * @param pg entrée de croiserEcheancierProgbat().parLigne — elle porte déjà
 *           l'état agrégé, l'anomalie et le doublon. RIEN n'est recalculé ici.
 * @returns { cle, label, couleur, plein, coche, alerte } | null si la ligne
 *          n'est couverte par aucune facture ProGBat active (l'appelant garde
 *          alors son affichage manuel, intact).
 */
export function statutVisuelLigneProgbat(pg) {
  if (!pg) return null;
  const cle = pg.doublon_manuel ? STATUT_VISUEL_PROGBAT.DOUBLON
    : pg.anomalie ? STATUT_VISUEL_PROGBAT.A_VERIFIER
    : pg.etat === ETAT.SUR_REGLEE || pg.etat === ETAT.AVOIR_SUR_REMBOURSE ? STATUT_VISUEL_PROGBAT.SURPAYEE
    : pg.etat === ETAT.SIGNE_INCOHERENT || pg.etat === ETAT.MONTANT_INCONNU ? STATUT_VISUEL_PROGBAT.A_VERIFIER
    // Un avoir remboursé n'est pas une échéance « réglée » au sens du client :
    // ttc_du <= 0 produit déjà l'anomalie ttc_non_positif, qui a la priorité.
    : pg.etat === ETAT.REGLEE ? STATUT_VISUEL_PROGBAT.REGLEE
    : pg.etat === ETAT.PARTIELLE || pg.etat === ETAT.AVOIR_PARTIEL ? STATUT_VISUEL_PROGBAT.PARTIELLE
    : STATUT_VISUEL_PROGBAT.EMISE;          // non réglée : la facture existe, rien n'est encaissé
  return { cle, ...STYLES_VISUELS[cle] };
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
