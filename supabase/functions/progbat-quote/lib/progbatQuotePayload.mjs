// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatQuotePayload.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── PROGBAT — PAYLOAD DE CRÉATION D'UN DEVIS (APERÇU, AUCUN APPEL) ─────────
// Module PUR : reçoit un projet Profero (profero_projets), ses lignes
// (profero_ouvrages_selectionnes) et la liste des taux de TVA ProGBat, et rend
// le body de `POST /v2/company/quotes` tel que le documente l'OpenAPI
// officielle (https://progbat.readme.io/reference/create-quote.md), accompagné
// des contrôles bloquants, des avertissements et d'une synthèse des totaux.
//
// Il ne lit ni n'écrit Supabase, n'appelle jamais ProGBat et n'importe pas les
// rapprochements de bibliothèque : SEULES les valeurs FIGÉES dans le chiffrage
// (snapshot de chaque ligne) sont transmises. Rien n'est recalculé depuis la
// bibliothèque. Testé par scripts/verif-progbat-quote-payload.mjs.
//
// Champs du body officiel (CreateQuoteRequest, additionalProperties: false) :
//   validityDate, thirdId, businessId, yardId, businessLabel, yardLabel,
//   businessAddress, businessAddress2, businessPostcode, businessCity,
//   businessCountry, clientCivility, clientName, clientBusinessName,
//   clientAddress, clientAddress2, clientPostcode, clientCity, clientCountry,
//   clientSiret, object, defaultTaxRateId, clientOrderNumber, content.
// Lignes (CreateQuoteLine / SubLine / LeafLine) : lineType (title | element |
// comment), label, quantity, unit, netUnitPrice, taxRateId, elementId,
// elementType, content. Les titres s'imbriquent sur DEUX niveaux au maximum
// (lot → zone) ; les feuilles sont des `element`.
//
// Liaison à la bibliothèque ProGBat (elementId) : chaque ligne d'ouvrage porte
// l'`elementId` de la structure ProGBat liée à l'ouvrage Profero d'origine
// (bibliotheque_ratios.progbat_id, RECHARGÉ côté serveur et vérifié par l'API :
// la source de vérité est la liaison actuelle, jamais le snapshot ni le
// navigateur). Conformément à l'OpenAPI, label, quantity, unit, netUnitPrice et
// taxRateId sont TOUJOURS transmis avec l'elementId : les valeurs figées par
// Profero prennent le dessus sur celles de la bibliothèque ProGBat, tandis que
// la composition de l'ouvrage ProGBat est chargée dans le devis. Un devis
// hybride (lignes liées + lignes libres) est interdit : toute ligne non liée,
// sans progbat_id valide ou dont la structure est introuvable rend le payload
// invalide. `elementType` n'est jamais envoyé (le type de la structure suffit).
//
// Règles d'arrondi (explicites, testées) :
//   • netUnitPrice : prix de vente HT unitaire figé, arrondi à 2 décimales par
//     arrondirMontant (l'unique politique monétaire du chiffrage) ;
//   • quantity    : valeur figée, 4 décimales au plus (float nettoyé) ;
//   • total HT du payload = arrondirMontant(Σ quantity × netUnitPrice) —
//     même méthode que totauxDevis (somme brute puis un seul arrondi), ce qui
//     permet la comparaison au centime avec le total affiché dans Profero ;
//   • la somme des lignes arrondies une à une est aussi calculée : un écart
//     avec le total est signalé en avertissement (ProGBat peut arrondir par ligne).
//
// Ce qui n'est JAMAIS transmis : coûts d'achat, coût de main-d'œuvre, coût
// direct, coût total, coefficient de vente, taux de marge, marge, elementType
// (voir CLES_INTERDITES + auditerPayload).

import { parseCodeOuvrage } from "./codeOuvrage.mjs";
import {
  num, arrondirMontant, normaliserUnite, ligneEstSnapshot, totauxDevis,
  grouperParLotZone, lireLogementProjet,
} from "./chiffragePricing.mjs";

export const ENDPOINT_CREATION_DEVIS = "POST /v2/company/quotes";
export const ENDPOINT_TAUX_TVA = "GET /v2/company/taxes";
export const PROFONDEUR_TITRES_MAX = 2;
export const LIBELLE_ZONE_MANQUANTE = "Zone non renseignée";
export const LIBELLE_LOT_MANQUANT = "Lot non renseigné";
export const DECIMALES_QUANTITE = 4;

/** Clés acceptées par l'OpenAPI (CreateQuoteRequest). Toute autre clé est refusée par ProGBat. */
export const CLES_PAYLOAD_AUTORISEES = Object.freeze([
  "validityDate", "thirdId", "businessId", "yardId", "businessLabel", "yardLabel",
  "businessAddress", "businessAddress2", "businessPostcode", "businessCity", "businessCountry",
  "clientCivility", "clientName", "clientBusinessName", "clientAddress", "clientAddress2",
  "clientPostcode", "clientCity", "clientCountry", "clientSiret",
  "object", "defaultTaxRateId", "clientOrderNumber", "content",
]);
/** Clés acceptées pour une ligne (CreateQuoteLine / SubLine / LeafLine). */
export const CLES_LIGNE_AUTORISEES = Object.freeze([
  "lineType", "label", "quantity", "unit", "netUnitPrice", "taxRateId", "elementId", "elementType", "content",
]);
/** Clés qui ne doivent apparaître NULLE PART dans le payload (données internes ; elementType non justifié). */
export const CLES_INTERDITES = Object.freeze([
  "elementType",
  "cout_materiaux_unitaire", "cout_main_oeuvre_unitaire", "cout_direct_unitaire", "cout_total_unitaire",
  "coutMateriaux", "coutMainOeuvre", "coutDirect", "coutTotal", "coutHoraire",
  "coef_vente", "coefVente", "coefficient_vente_id", "coefficient_vente", "taux_horaire_vente_id", "taux_horaire_vente",
  "coefficient_source", "coefficient_origine_valeur", "coefficient_origine_libelle", "coefficient_global_id",
  "taux_horaire_source", "taux_horaire_origine_valeur", "taux_horaire_origine_libelle", "taux_horaire_global_id",
  "mode_coefficient", "mode_taux_horaire", "coefficient_global_valeur", "coefficient_global_libelle", "taux_horaire_global_valeur", "taux_horaire_global_libelle", "conditions_version",
  "taux_marge_pct", "tauxMarge", "tauxMargePct", "marge", "margeUnitaire",
  "calcul_detail", "calcul_version", "bibliotheque_id", "progbat_id", "progbat_ligne_id",
]);

const str = (v) => String(v ?? "").trim();
const estEntier = (v) => Number.isInteger(v) || (typeof v === "string" && /^-?\d+$/.test(v.trim()));
const versEntier = (v) => estEntier(v) ? Number(v) : null;

// ─── Liaisons Profero → ProGBat ──────────────────────────────────────────────
/**
 * Normalise les liaisons { bibliotheque_id → { progbat_id, existe } } en Map
 * indexée par identifiant Profero (chaîne). `existe` : true si la structure a
 * été confirmée par l'API ProGBat, false si elle est introuvable, null si non vérifiée.
 */
export function indexerLiaisons(liaisons) {
  const map = new Map();
  if (!liaisons) return map;
  const entrees = liaisons instanceof Map ? [...liaisons.entries()]
    : Array.isArray(liaisons) ? liaisons.map((l) => [l?.bibliotheque_id ?? l?.id, l])
    : Object.entries(liaisons);
  entrees.forEach(([k, v]) => {
    if (k == null || v == null) return;
    map.set(String(k), { progbat_id: v.progbat_id ?? null, existe: v.existe === undefined ? null : v.existe });
  });
  return map;
}

/**
 * Résout l'elementId d'une ligne depuis la liaison ACTUELLE de son ouvrage
 * Profero (jamais depuis le snapshot ni le navigateur).
 * @returns {{ elementId: number|null, code: string|null, message: string|null }}
 */
export function resoudreElementId(ligne, liaisons) {
  const bibId = ligne?.bibliotheque_id != null && str(ligne.bibliotheque_id) ? str(ligne.bibliotheque_id) : "";
  if (!bibId) return { elementId: null, code: "ouvrage_sans_identifiant", message: "ouvrage sans identifiant de bibliothèque Profero : impossible de le lier à ProGBat" };
  const l = (liaisons instanceof Map ? liaisons : indexerLiaisons(liaisons)).get(bibId);
  if (!l || l.progbat_id == null || str(l.progbat_id) === "") return { elementId: null, code: "ouvrage_non_lie", message: "ouvrage non lié à la bibliothèque ProGBat" };
  const pid = versEntier(l.progbat_id);
  if (pid == null || pid <= 0) return { elementId: null, code: "progbat_id_invalide", message: `identifiant ProGBat invalide (${str(l.progbat_id)})` };
  if (l.existe === false) return { elementId: null, code: "structure_introuvable", message: `ouvrage ProGBat #${pid} introuvable dans la bibliothèque ProGBat (supprimé ?)` };
  return { elementId: pid, code: null, message: null };
}

/** Arrondi d'une quantité : 4 décimales au plus (nettoyage des flottants), null si invalide. */
export function arrondirQuantite(q) {
  const v = num(q);
  if (v == null) return null;
  const f = 10 ** DECIMALES_QUANTITE;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * f) / f;
}

/** « 2026-10-15 », Date ou ISO complet → « AAAA-MM-JJ » ; null si absent ou invalide. */
export function formaterDateISO(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = str(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ─── Taux de TVA ProGBat ─────────────────────────────────────────────────────
/**
 * Indexe la réponse de GET /company/taxes ([{ id, rate, label, saleDefault }])
 * par taux numérique. Les identifiants sont ceux de ProGBat : jamais fixés en dur.
 * @returns {{ parTaux: Map<number, {id:number, rate:number, label:string, saleDefault:boolean}>, doublons: number[], invalides: number }}
 */
export function indexerTauxTva(taxes) {
  const parTaux = new Map();
  const doublons = [];
  let invalides = 0;
  (Array.isArray(taxes) ? taxes : []).forEach((t) => {
    const rate = num(t?.rate);
    const id = versEntier(t?.id);
    if (rate == null || id == null) { invalides++; return; }
    const cle = Math.round(rate * 1000) / 1000;
    if (parTaux.has(cle)) { doublons.push(cle); return; }   // premier taux conservé
    parTaux.set(cle, { id, rate: cle, label: str(t?.label), saleDefault: t?.saleDefault === true });
  });
  return { parTaux, doublons, invalides };
}

/** Taux (%) → identifiant ProGBat. { id, erreur } — id null si aucun taux ne correspond. */
export function trouverTaxRateId(tvaPct, taxes) {
  const pct = num(tvaPct);
  if (pct == null) return { id: null, taux: null, erreur: "TVA absente" };
  const index = taxes instanceof Map ? taxes : indexerTauxTva(taxes).parTaux;
  const cle = Math.round(pct * 1000) / 1000;
  const t = index.get(cle);
  if (!t) return { id: null, taux: cle, erreur: `Aucun taux de TVA ProGBat à ${formaterPct(cle)}` };
  return { id: t.id, taux: cle, erreur: null };
}

export function formaterPct(p) {
  const v = num(p);
  return v == null ? "—" : `${String(v).replace(".", ",")} %`;
}

// ─── Client ──────────────────────────────────────────────────────────────────
/**
 * Identité du client telle qu'elle sera transmise : société ⇒ professionnel
 * (clientBusinessName + contact en clientName), sinon particulier (clientName).
 */
export function identiteClient(projet = {}) {
  const societe = str(projet.client_societe);
  const nom = str(projet.client_nom);
  const prenom = str(projet.client_prenom);
  const contact = [nom, prenom].filter(Boolean).join(" ");
  const type = societe ? "professionnel" : "particulier";
  const affichage = societe ? (contact ? `${societe} (${contact})` : societe) : contact;
  return { type, societe, contact, affichage, vide: !societe && !contact };
}

// ─── Lignes → contenu LOT → ZONE → OUVRAGES ─────────────────────────────────
/** Libellé d'une ligne d'élément : « CODE — Libellé » (code et libellé figés sur la ligne). */
export function libelleElement(ligne = {}) {
  const parse = parseCodeOuvrage(ligne.item);
  const code = str(ligne.code_ouvrage) || parse?.code || null;
  const libelle = (parse?.reste ? str(parse.reste) : str(ligne.item)) || null;
  return { code, libelle, label: code && libelle ? `${code} — ${libelle}` : (libelle || code || "") };
}

/**
 * Convertit UNE occurrence du chiffrage en ligne `element`. Ne recalcule rien :
 * une ligne sans snapshot est déclarée incompatible.
 * @returns {{ element: object|null, apercu: object, erreurs: Array<{code,message}>, avertissements: string[] }}
 */
export function convertirLigne(ligne = {}, { taxes, tvaPctDefaut = null, liaisons = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  const ref = str(ligne.code_ouvrage) || str(ligne.item) || `ligne ${ligne.id ?? "?"}`;
  const err = (code, message) => erreurs.push({ code, message: `${ref} — ${message}`, ligne_id: ligne.id ?? null });

  // Liaison ProGBat : source de vérité = liaison actuelle de l'ouvrage Profero.
  // Toute valeur `elementId` / `progbat_id` portée par la ligne elle-même est ignorée.
  const liaison = resoudreElementId(ligne, liaisons);
  if (liaison.code) err(liaison.code, liaison.message);
  const elementId = liaison.elementId;

  if (!ligneEstSnapshot(ligne)) err("snapshot_absent", "ancienne ligne sans snapshot de prix (incompatible : ajouter l'ouvrage depuis la bibliothèque, il n'est pas recalculé automatiquement)");
  if (!str(ligne.category)) err("lot_absent", "lot absent");
  if (!str(ligne.zone)) err("zone_absente", "zone absente");

  const { code, libelle, label } = libelleElement(ligne);
  if (!code) err("code_absent", "ouvrage sans code");
  if (!libelle) err("libelle_absent", "ouvrage sans libellé");

  const qBrute = num(ligne.quantite);
  const quantity = arrondirQuantite(qBrute);
  if (qBrute == null) err("quantite_invalide", "quantité absente ou invalide");
  else if (qBrute <= 0) err("quantite_invalide", `quantité nulle ou négative (${qBrute})`);
  else if (quantity !== qBrute) avertissements.push(`${ref} : quantité arrondie à ${DECIMALES_QUANTITE} décimales (${qBrute} → ${quantity})`);

  const uniteBrute = str(ligne.unite);
  const unit = uniteBrute ? normaliserUnite(uniteBrute) : null;
  if (!unit) err("unite_absente", "unité absente");

  const puBrut = num(ligne.prix_unitaire);
  const netUnitPrice = puBrut == null || puBrut < 0 ? null : arrondirMontant(puBrut);
  if (puBrut == null) err("prix_invalide", "prix unitaire HT absent");
  else if (puBrut < 0) err("prix_invalide", `prix unitaire HT négatif (${puBrut})`);
  else {
    if (puBrut === 0) avertissements.push(`${ref} : prix unitaire HT à 0 €`);
    if (Math.abs(netUnitPrice - puBrut) >= 0.000001) avertissements.push(`${ref} : prix unitaire arrondi à 2 décimales (${puBrut} → ${netUnitPrice})`);
  }

  const tvaPct = num(ligne.tva_pct) ?? num(tvaPctDefaut);
  const tax = trouverTaxRateId(tvaPct, taxes);
  if (tvaPct == null) err("tva_absente", "TVA absente (ni sur la ligne, ni sur le projet)");
  else if (tax.id == null) err("tva_sans_correspondance", tax.erreur);

  const totalHT = quantity != null && quantity > 0 && netUnitPrice != null ? arrondirMontant(quantity * netUnitPrice) : null;
  // elementId + label + quantity + unit + netUnitPrice + taxRateId, toujours ensemble :
  // les valeurs figées Profero priment, la composition ProGBat est chargée.
  const element = { lineType: "element" };
  if (elementId != null) element.elementId = elementId;
  element.label = label;
  if (quantity != null && quantity > 0) element.quantity = quantity;
  if (unit) element.unit = unit;
  if (netUnitPrice != null) element.netUnitPrice = netUnitPrice;
  if (tax.id != null) element.taxRateId = tax.id;

  return {
    element,
    apercu: {
      ligne_id: ligne.id ?? null, code, libelle, label, quantite: quantity, unite: unit,
      prix_unitaire_ht: netUnitPrice, total_ht: totalHT, tva_pct: tvaPct, taxRateId: tax.id,
      bibliotheque_id: ligne.bibliotheque_id ?? null, progbat_id: elementId, lie: elementId != null,
      snapshot: ligneEstSnapshot(ligne), erreurs: erreurs.map(e => e.code),
    },
    // valeurs BRUTES pour la comparaison des totaux (même méthode que totauxDevis)
    brut: { quantite: qBrute, prixUnitaire: puBrut, prixArrondi: netUnitPrice, quantiteArrondie: quantity, tvaPct },
    erreurs, avertissements,
  };
}

/**
 * Regroupe les occurrences par LOT puis ZONE (ordre : lots du chiffrage, zones
 * suggérées, puis `ordre` / code / date de chaque ligne — même tri que la page
 * Chiffrage) et rend le `content` du devis. Deux occurrences d'un même ouvrage
 * dans deux zones restent deux lignes ; dans la même zone aussi (jamais fusionnées).
 */
export function construireContenuDevis(lignes = [], { lotsOrdre = [], taxes = null, tvaPctDefaut = null, liaisons = null } = {}) {
  const erreurs = [];
  const avertissements = [];
  const indexLiaisons = liaisons instanceof Map ? liaisons : indexerLiaisons(liaisons);
  // Zones / lots vides : marqués par un libellé d'aperçu, jamais remplacés par un défaut silencieux
  const marquees = (lignes || []).map((l) => ({
    ...l,
    category: str(l?.category) || LIBELLE_LOT_MANQUANT,
    zone: str(l?.zone) || LIBELLE_ZONE_MANQUANTE,
    __zone_manquante: !str(l?.zone),
    __lot_manquant: !str(l?.category),
    __orig: l,   // la ligne d'origine est celle qui est contrôlée et convertie
  }));
  const index = taxes instanceof Map ? taxes : indexerTauxTva(taxes).parTaux;
  const groupes = grouperParLotZone(marquees, lotsOrdre);

  let sommeBrute = 0, sommeArrondie = 0, sommeTva = 0;
  let nbZones = 0, nbLignes = 0, nbSansSnapshot = 0, nbLies = 0;
  const tvaDetail = {};
  const content = [];
  const apercu = [];

  groupes.forEach((g) => {
    const lotManquant = g.lot === LIBELLE_LOT_MANQUANT && g.zones.some(z => z.lignes.some(l => l.__lot_manquant));
    const zonesApercu = [];
    const zonesContent = [];
    let totalLot = 0;
    g.zones.forEach((z) => {
      nbZones++;
      const zoneManquante = z.lignes.some(l => l.__zone_manquante);
      const elements = [];
      const lignesApercu = [];
      let totalZone = 0;
      z.lignes.forEach((l) => {
        nbLignes++;
        const conv = convertirLigne(l.__orig ?? l, { taxes: index, tvaPctDefaut, liaisons: indexLiaisons });
        if (!conv.apercu.snapshot) nbSansSnapshot++;
        if (conv.apercu.lie) nbLies++;
        erreurs.push(...conv.erreurs);
        avertissements.push(...conv.avertissements);
        elements.push(conv.element);
        lignesApercu.push(conv.apercu);
        const { quantite, prixArrondi, quantiteArrondie, tvaPct } = conv.brut;
        if (quantite != null && quantite > 0 && prixArrondi != null) {
          sommeBrute += quantiteArrondie * prixArrondi;
          const ht = arrondirMontant(quantiteArrondie * prixArrondi);
          sommeArrondie += ht;
          totalZone += ht;
          if (tvaPct != null) { sommeTva += ht * tvaPct / 100; tvaDetail[tvaPct] = (tvaDetail[tvaPct] || 0) + ht * tvaPct / 100; }
        }
      });
      zonesContent.push({ lineType: "title", label: `ZONE ${z.zone}`, content: elements });
      zonesApercu.push({ zone: z.zone, zone_manquante: zoneManquante, total_ht: arrondirMontant(totalZone), lignes: lignesApercu });
      totalLot += totalZone;
    });
    content.push({ lineType: "title", label: `LOT ${g.lot}`, content: zonesContent });
    apercu.push({ lot: g.lot, lot_manquant: lotManquant, total_ht: arrondirMontant(totalLot), zones: zonesApercu });
  });

  const totalHT = arrondirMontant(sommeBrute);
  const totalLignesArrondies = arrondirMontant(sommeArrondie);
  if (totalHT != null && totalLignesArrondies != null && Math.abs(totalHT - totalLignesArrondies) >= 0.005) {
    avertissements.push(`Somme des lignes arrondies une à une (${totalLignesArrondies.toFixed(2)} €) ≠ total HT (${totalHT.toFixed(2)} €) : ProGBat peut afficher un écart d'un centime`);
  }
  const tva = arrondirMontant(sommeTva);
  return {
    content, apercu, erreurs, avertissements,
    compteurs: { lots: groupes.length, zones: nbZones, lignes: nbLignes, lignes_sans_snapshot: nbSansSnapshot, lies: nbLies },
    totaux: {
      ht: totalHT ?? 0,
      ht_lignes_arrondies: totalLignesArrondies ?? 0,
      tva: tva ?? 0,
      tva_detail: Object.fromEntries(Object.entries(tvaDetail).map(([k, v]) => [k, arrondirMontant(v)])),
      ttc: arrondirMontant((totalHT ?? 0) + (tva ?? 0)) ?? 0,
    },
  };
}

// ─── En-tête du devis (client, affaire, chantier, objet, validité, TVA) ──────
/**
 * Champs d'en-tête du body officiel construits depuis profero_projets.
 *   • thirdId si `progbat_client_id` est un entier ProGBat ; sinon coordonnées
 *     structurées du client (clientName / clientBusinessName / clientAddress…) ;
 *   • businessId / yardId si `progbat_business_id` / `progbat_yard_id` sont
 *     renseignés (colonnes réservées, absentes aujourd'hui) ; sinon
 *     businessLabel, yardLabel et adresse structurée du chantier ;
 *   • object, validityDate, defaultTaxRateId, clientOrderNumber (si renseigné).
 */
export function construireEnTeteDevis(projet = {}, { taxes = null, aujourdHui = new Date() } = {}) {
  const erreurs = [];
  const avertissements = [];
  const err = (code, message) => erreurs.push({ code, message });
  const champs = {};
  const index = taxes instanceof Map ? taxes : indexerTauxTva(taxes).parTaux;

  const logement = lireLogementProjet(projet);
  if (!logement.reference) err("logement_reference_absente", "Référence du logement manquante (ex : Appartement 101)");
  if (logement.aVerifier) err("logement_multiple", "Ancien projet multi-logements : un devis ProGBat = un logement, découper le projet");
  if (!logement.type) avertissements.push("Type de logement non renseigné");
  else if (logement.repli) avertissements.push(logement.message);

  // ── Client ──
  const client = identiteClient(projet);
  const thirdId = versEntier(projet.progbat_client_id);
  if (str(projet.progbat_client_id) && thirdId == null) err("client_progbat_invalide", `Identifiant client ProGBat non numérique (${str(projet.progbat_client_id)})`);
  if (client.vide) err("client_absent", "Identité ou raison sociale du client manquante");
  if (thirdId != null) {
    champs.thirdId = thirdId;
    avertissements.push(`Client ProGBat existant (thirdId ${thirdId}) : ses coordonnées ProGBat feront foi, celles du projet ne sont pas transmises`);
  } else {
    if (client.societe) { champs.clientBusinessName = client.societe; if (client.contact) champs.clientName = client.contact; }
    else if (client.contact) champs.clientName = client.contact;
    const adr = str(projet.client_adresse), cp = str(projet.client_code_postal), ville = str(projet.client_ville);
    if (!adr) err("client_adresse_absente", "Adresse de facturation du client manquante");
    if (!cp) err("client_code_postal_absent", "Code postal de facturation du client manquant");
    if (!ville) err("client_ville_absente", "Ville de facturation du client manquante");
    if (adr) champs.clientAddress = adr;
    if (str(projet.client_adresse_complement)) champs.clientAddress2 = str(projet.client_adresse_complement);
    if (cp) champs.clientPostcode = cp;
    if (ville) champs.clientCity = ville;
    if (str(projet.client_pays)) champs.clientCountry = str(projet.client_pays);
    else avertissements.push("Pays du client non renseigné");
  }

  // ── Affaire & chantier ──
  const businessId = versEntier(projet.progbat_business_id);
  const yardId = versEntier(projet.progbat_yard_id);
  if (str(projet.progbat_business_id) && businessId == null) err("affaire_progbat_invalide", "Identifiant d'affaire ProGBat non numérique");
  if (str(projet.progbat_yard_id) && yardId == null) err("chantier_progbat_invalide", "Identifiant de chantier ProGBat non numérique");
  if (businessId != null) champs.businessId = businessId;
  if (yardId != null) champs.yardId = yardId;
  if (businessId == null) {
    const adrChantier = str(projet.chantier_adresse);
    const repli = !adrChantier && str(projet.adresse_bien);
    const adresse = adrChantier || str(projet.adresse_bien);
    if (!adresse) err("chantier_adresse_absente", "Adresse du chantier manquante");
    else if (repli) avertissements.push("Adresse du chantier reprise de l'ancien champ « adresse du bien » : à structurer (rue, code postal, ville)");
    const cp = str(projet.chantier_code_postal), ville = str(projet.chantier_ville);
    if (!cp) avertissements.push("Code postal du chantier non renseigné");
    if (!ville) avertissements.push("Ville du chantier non renseignée");
    const label = [client.affichage, logement.reference].filter(Boolean).join(" — ");
    if (label) champs.businessLabel = label;
    if (adresse) champs.businessAddress = adresse;
    if (str(projet.chantier_adresse_complement)) champs.businessAddress2 = str(projet.chantier_adresse_complement);
    if (cp) champs.businessPostcode = cp;
    if (ville) champs.businessCity = ville;
    if (str(projet.chantier_pays)) champs.businessCountry = str(projet.chantier_pays);
  }
  if (yardId == null) {
    const yardLabel = logement.reference ? `${logement.reference}${logement.type ? ` (${logement.type})` : ""}` : "";
    if (yardLabel) champs.yardLabel = yardLabel;
  }

  // ── Devis ──
  const objet = str(projet.devis_objet);
  if (!objet) err("objet_absent", "Objet du devis manquant");
  else champs.object = objet;

  const validite = formaterDateISO(projet.devis_validite);
  if (!validite) err("validite_absente", str(projet.devis_validite) ? `Date de validité invalide (${str(projet.devis_validite)})` : "Date de validité du devis manquante");
  else {
    champs.validityDate = validite;
    const ref = formaterDateISO(aujourdHui);
    if (ref && validite < ref) avertissements.push(`Date de validité déjà dépassée (${validite})`);
  }

  const tvaProjet = num(projet.tva_pct);
  if (tvaProjet == null) err("tva_projet_absente", "Taux de TVA du devis non choisi");
  else {
    const t = trouverTaxRateId(tvaProjet, index);
    if (t.id == null) err("tva_sans_correspondance", `${t.erreur} (TVA par défaut du devis)`);
    else champs.defaultTaxRateId = t.id;
  }

  if (str(projet.devis_num_commande_client)) champs.clientOrderNumber = str(projet.devis_num_commande_client);

  return { champs, erreurs, avertissements, logement, client, tvaProjet };
}

// ─── Audit structurel du payload (indépendant de la construction) ────────────
function auditerLigne(ligne, profondeurTitres, chemin, erreurs, elementIdsAutorises) {
  if (!ligne || typeof ligne !== "object") { erreurs.push({ code: "ligne_invalide", message: `${chemin} : ligne non objet` }); return; }
  Object.keys(ligne).forEach((k) => {
    if (CLES_INTERDITES.includes(k)) erreurs.push({ code: "cle_interdite", message: `${chemin} : clé interdite « ${k} »` });
    else if (!CLES_LIGNE_AUTORISEES.includes(k)) erreurs.push({ code: "cle_inconnue", message: `${chemin} : clé hors OpenAPI « ${k} »` });
  });
  if (!["title", "element", "comment"].includes(ligne.lineType)) erreurs.push({ code: "line_type_invalide", message: `${chemin} : lineType « ${ligne.lineType} »` });
  if (!str(ligne.label)) erreurs.push({ code: "label_vide", message: `${chemin} : label vide` });
  if (ligne.lineType !== "element" && "elementId" in ligne) erreurs.push({ code: "element_id_hors_element", message: `${chemin} : elementId interdit sur un ${ligne.lineType}` });
  if (ligne.lineType === "title") {
    if (profondeurTitres + 1 > PROFONDEUR_TITRES_MAX) erreurs.push({ code: "profondeur_titres", message: `${chemin} : ${profondeurTitres + 1} niveaux de titres (max ${PROFONDEUR_TITRES_MAX})` });
    if (!Array.isArray(ligne.content)) erreurs.push({ code: "titre_sans_contenu", message: `${chemin} : titre sans content` });
    else ligne.content.forEach((s, i) => auditerLigne(s, profondeurTitres + 1, `${chemin}.content[${i}]`, erreurs, elementIdsAutorises));
  } else {
    if ("content" in ligne) erreurs.push({ code: "element_avec_contenu", message: `${chemin} : un element ne porte pas de content` });
    if (ligne.lineType === "element") {
      // elementId obligatoire : entier positif, et présent parmi les progbat_id actuels des ouvrages Profero du devis
      if (!(Number.isInteger(ligne.elementId) && ligne.elementId > 0)) erreurs.push({ code: "element_id_absent", message: `${chemin} : elementId manquant ou non entier positif (ouvrage non lié à la bibliothèque ProGBat)` });
      else if (elementIdsAutorises && !elementIdsAutorises.has(ligne.elementId)) erreurs.push({ code: "element_id_inconnu", message: `${chemin} : elementId ${ligne.elementId} ne correspond à aucun progbat_id actuel d'ouvrage Profero` });
      if (!(typeof ligne.quantity === "number" && ligne.quantity > 0)) erreurs.push({ code: "quantity_invalide", message: `${chemin} : quantity manquante ou ≤ 0` });
      if (!str(ligne.unit)) erreurs.push({ code: "unit_absente", message: `${chemin} : unit manquante` });
      if (!(typeof ligne.netUnitPrice === "number" && Number.isFinite(ligne.netUnitPrice) && ligne.netUnitPrice >= 0)) erreurs.push({ code: "net_unit_price_invalide", message: `${chemin} : netUnitPrice manquant ou invalide` });
      else if (Math.abs(ligne.netUnitPrice * 100 - Math.round(ligne.netUnitPrice * 100)) > 1e-6) erreurs.push({ code: "net_unit_price_decimales", message: `${chemin} : netUnitPrice non arrondi à 2 décimales` });
      if (!Number.isInteger(ligne.taxRateId)) erreurs.push({ code: "tax_rate_id_absent", message: `${chemin} : taxRateId manquant` });
    }
  }
}

/**
 * Vérifie un payload déjà construit : clés conformes à l'OpenAPI, aucune donnée
 * interne ni elementType, deux niveaux de titres au plus, éléments complets et
 * TOUS liés (elementId entier positif, uniquement sur les lignes `element`,
 * et — si `elementIdsAutorises` est fourni — égal au progbat_id actuel d'un ouvrage Profero).
 * @returns {Array<{code, message}>} vide si conforme
 */
export function auditerPayload(payload, { elementIdsAutorises = null } = {}) {
  const erreurs = [];
  const autorises = elementIdsAutorises == null ? null : (elementIdsAutorises instanceof Set ? elementIdsAutorises : new Set(elementIdsAutorises));
  if (!payload || typeof payload !== "object") return [{ code: "payload_invalide", message: "Payload absent" }];
  Object.keys(payload).forEach((k) => {
    if (CLES_INTERDITES.includes(k)) erreurs.push({ code: "cle_interdite", message: `payload : clé interdite « ${k} »` });
    else if (!CLES_PAYLOAD_AUTORISEES.includes(k)) erreurs.push({ code: "cle_inconnue", message: `payload : clé hors OpenAPI « ${k} »` });
  });
  ["thirdId", "businessId", "yardId", "defaultTaxRateId"].forEach((k) => {
    if (k in payload && !Number.isInteger(payload[k])) erreurs.push({ code: "entier_attendu", message: `payload.${k} doit être un entier` });
  });
  if ("validityDate" in payload && !formaterDateISO(payload.validityDate)) erreurs.push({ code: "validity_date_invalide", message: "payload.validityDate n'est pas une date AAAA-MM-JJ" });
  if (!Array.isArray(payload.content)) erreurs.push({ code: "content_absent", message: "payload.content absent" });
  else payload.content.forEach((l, i) => auditerLigne(l, 0, `content[${i}]`, erreurs, autorises));
  // Filet : le JSON sérialisé ne doit contenir aucune clé interdite, à quelque profondeur que ce soit
  const json = JSON.stringify(payload);
  CLES_INTERDITES.forEach((k) => { if (json.includes(`"${k}"`)) erreurs.push({ code: "cle_interdite_profonde", message: `« ${k} » présent dans le JSON` }); });
  return dedoublonner(erreurs);
}

function dedoublonner(liste) {
  const vus = new Set();
  return liste.filter((e) => { const k = typeof e === "string" ? e : `${e.code}|${e.message}`; if (vus.has(k)) return false; vus.add(k); return true; });
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────
/**
 * Construit l'aperçu complet du futur devis ProGBat d'un logement.
 * @param {object} p.projet    ligne profero_projets
 * @param {Array}  p.lignes    lignes profero_ouvrages_selectionnes du projet
 * @param {Array}  p.lotsOrdre libellés de lots dans l'ordre du chiffrage
 * @param {Array|null} p.taxes réponse de GET /company/taxes (null = non chargés)
 * @param {Date}   p.aujourdHui  date de référence (tests)
 * @returns {{ valide, payload, erreurs, avertissements, totaux, compteurs, apercu, entete }}
 *   Le payload est TOUJOURS rendu (pour inspection) mais `valide` = false dès
 *   qu'un contrôle bloquant échoue : aucun envoi ne doit alors avoir lieu.
 */
export function construirePayloadDevisProGBat({ projet = {}, lignes = [], lotsOrdre = [], taxes = null, liaisons = null, aujourdHui = new Date() } = {}) {
  const erreurs = [];
  const avertissements = [];
  const indexLiaisons = indexerLiaisons(liaisons);
  if (liaisons == null) erreurs.push({ code: "liaisons_non_chargees", message: "Liaisons à la bibliothèque ProGBat non chargées : aucun elementId ne peut être déterminé" });
  const { parTaux, doublons, invalides } = indexerTauxTva(taxes);
  if (!Array.isArray(taxes)) erreurs.push({ code: "taux_tva_non_charges", message: "Taux de TVA ProGBat non chargés : aucun taxRateId ne peut être déterminé" });
  else if (parTaux.size === 0) erreurs.push({ code: "taux_tva_vides", message: "ProGBat n'a renvoyé aucun taux de TVA exploitable" });
  if (doublons.length) avertissements.push(`Plusieurs taux ProGBat identiques (${[...new Set(doublons)].map(formaterPct).join(", ")}) : le premier est utilisé`);
  if (invalides) avertissements.push(`${invalides} taux ProGBat ignoré(s) (identifiant ou valeur manquante)`);

  const entete = construireEnTeteDevis(projet, { taxes: parTaux, aujourdHui });
  erreurs.push(...entete.erreurs);
  avertissements.push(...entete.avertissements);

  const tvaPctDefaut = num(projet.tva_pct);
  if (!(lignes || []).length) erreurs.push({ code: "aucune_ligne", message: "Aucun ouvrage dans le devis" });
  const contenu = construireContenuDevis(lignes, { lotsOrdre, taxes: parTaux, tvaPctDefaut, liaisons: indexLiaisons });
  erreurs.push(...contenu.erreurs);
  avertissements.push(...contenu.avertissements);
  // Règle bloquante : tous les ouvrages liés, jamais de devis hybride
  if (contenu.compteurs.lignes > 0 && contenu.compteurs.lies < contenu.compteurs.lignes) {
    erreurs.push({ code: "ouvrages_non_lies", message: `Ouvrages liés à la bibliothèque ProGBat : ${contenu.compteurs.lies} / ${contenu.compteurs.lignes} — tous les ouvrages doivent être liés (aucun devis hybride)` });
  }

  // Comparaison au centime avec le total HT affiché dans Profero (totauxDevis)
  const profero = totauxDevis(lignes, { tvaPctDefaut, budgetClient: projet.budget_client });
  const ecart = arrondirMontant((contenu.totaux.ht ?? 0) - (profero.venteHT ?? 0));
  if (Math.abs(ecart) >= 0.005) {
    erreurs.push({ code: "total_different", message: `Total HT du payload (${contenu.totaux.ht.toFixed(2)} €) ≠ total HT Profero (${(profero.venteHT ?? 0).toFixed(2)} €) : écart ${ecart.toFixed(2)} €` });
  }

  const payload = { ...entete.champs, content: contenu.content };
  // Audit structurel : filet indépendant. Les défauts déjà signalés ligne par
  // ligne (prix, quantité, unité, TVA, libellé, liaison) ne sont pas répétés.
  const CODES_LIGNE_AUDIT = ["quantity_invalide", "unit_absente", "net_unit_price_invalide", "tax_rate_id_absent", "label_vide", "element_id_absent"];
  const dejaSignalesParLigne = contenu.erreurs.length > 0;
  const elementIdsAutorises = new Set([...indexLiaisons.values()].map((l) => versEntier(l.progbat_id)).filter((n) => n != null && n > 0));
  const audit = auditerPayload(payload, { elementIdsAutorises }).filter(e => !(dejaSignalesParLigne && CODES_LIGNE_AUDIT.includes(e.code)));
  erreurs.push(...audit);

  const erreursFinales = dedoublonner(erreurs);
  return {
    valide: erreursFinales.length === 0,
    payload,
    erreurs: erreursFinales,
    avertissements: dedoublonner(avertissements),
    totaux: {
      ht: contenu.totaux.ht,
      ht_profero: profero.venteHT ?? 0,
      ecart_ht: ecart ?? 0,
      ht_lignes_arrondies: contenu.totaux.ht_lignes_arrondies,
      tva: contenu.totaux.tva,
      tva_detail: contenu.totaux.tva_detail,
      ttc: contenu.totaux.ttc,
      tva_profero: profero.tva,
      ttc_profero: profero.ttc,
    },
    compteurs: contenu.compteurs,
    apercu: contenu.apercu,
    liaisons: Object.fromEntries([...indexLiaisons.entries()].map(([k, v]) => [k, { progbat_id: versEntier(v.progbat_id), existe: v.existe }])),
    entete: {
      logement: entete.logement,
      client: entete.client,
      tva_pct: entete.tvaProjet,
      taxRateId: entete.champs.defaultTaxRateId ?? null,
      objet: entete.champs.object ?? null,
      validite: entete.champs.validityDate ?? null,
      thirdId: entete.champs.thirdId ?? null,
      businessLabel: entete.champs.businessLabel ?? null,
      yardLabel: entete.champs.yardLabel ?? null,
      adresse_chantier: [entete.champs.businessAddress, entete.champs.businessAddress2, [entete.champs.businessPostcode, entete.champs.businessCity].filter(Boolean).join(" "), entete.champs.businessCountry].filter(Boolean).join(", ") || null,
      adresse_client: [entete.champs.clientAddress, entete.champs.clientAddress2, [entete.champs.clientPostcode, entete.champs.clientCity].filter(Boolean).join(" "), entete.champs.clientCountry].filter(Boolean).join(", ") || null,
    },
    endpoint: ENDPOINT_CREATION_DEVIS,
  };
}

// ─── Sérialisation canonique & hash ──────────────────────────────────────────
/**
 * JSON déterministe : clés d'objet triées récursivement, tableaux dans leur
 * ordre (l'ordre des lignes est porteur de sens), undefined ignoré. Le même
 * payload produit toujours la même chaîne, côté navigateur comme côté serveur.
 */
export function serialiserCanonique(valeur) {
  const canon = (v) => {
    if (v === undefined) return undefined;
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
    return Object.keys(v).sort().reduce((acc, k) => { const c = canon(v[k]); if (c !== undefined) acc[k] = c; return acc; }, {});
  };
  return JSON.stringify(canon(valeur));
}

/** SHA-256 (hexadécimal) de la sérialisation canonique — Web Crypto : navigateur, Deno et Node ≥ 20. */
export async function hacherPayload(payload) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto indisponible : impossible de calculer le hash du payload");
  const octets = new TextEncoder().encode(serialiserCanonique(payload));
  const digest = await subtle.digest("SHA-256", octets);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
