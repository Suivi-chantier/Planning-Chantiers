// Moteur déterministe de rapprochement : aucune dépendance à la base ou à l'horloge.
// Montants comparés en centimes pour éviter les erreurs de virgule flottante.
export const centimes = value => value == null || value === "" ? null : Math.round(Number(value) * 100);

export function normaliserNumero(value, regles = {}) {
  let numero = String(value ?? "").trim().toUpperCase();
  if (!numero) return "";
  numero = numero.replace(/\s+/g, "");
  for (const prefixe of regles.prefixes || []) {
    if (numero.startsWith(prefixe.toUpperCase())) numero = numero.slice(prefixe.length);
  }
  if (regles.retirerAgence) {
    // Rexel : la facture écrit « CL-<agence>-619330811-02 », la base « 619330811-02 / 4900 ».
    numero = numero.replace(/^CL-\d{4}-(?=\d)/, "");
    if (/^\d[\d-]*\/\d{4}$/.test(numero)) numero = numero.split("/")[0];
  }
  if (regles.retirerClient && /^\d+\s*\/\s*\d{6}$/.test(numero)) numero = numero.split("/")[0];
  if (regles.retirerZeros !== false) numero = numero.replace(/^0+(?=\d)/, "");
  return numero.replace(/\s*([/-])\s*/g, "$1");
}

// ── N° de commande fournisseur ─────────────────────────────────────────────
// Rexel imprime sur chaque bloc BL « Notre Réf: 4900000917429 du 22/09/2026 » :
// agence (4 chiffres) + n° de commande (9 chiffres). La même commande s'écrit
// « 4900-000917429 » sur l'extranet et l'accusé de réception, et « 000917429 /
// 4900 » ou « 917429/4900 » dans l'appli. « Votre commande : FOURMOND » est la
// référence du client (souvent un nom de chantier), jamais un n° de commande.
const nettoyerCommande = value => String(value ?? "").trim()
  .replace(/^notre\s*r[ée]f(?:[ée]rence)?\.?\s*:?\s*/i, "")
  .replace(/\s+du\s+\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*$/i, "")
  .trim();

// Un n° de commande contient des chiffres et pas de mot : « FOURMOND »,
// « TOUR BOUTON », « MONTILLERS T3 » sont des références client.
export function estNumeroCommande(value) {
  const v = nettoyerCommande(value);
  return /\d/.test(v) && !/\p{L}{3,}/u.test(v);
}

// « 4900000917429 », « 4900-000917429 », « 000917429 / 4900 », « 917429/4900 »
// → « 4900-917429 » (agence-n°, zéros de tête ignorés). Autre forme → null.
export function normaliserCommandeRexel(value) {
  const v = nettoyerCommande(value).replace(/\s+/g, "");
  const sansZeros = n => n.replace(/^0+(?=\d)/, "");
  let m = v.match(/^(\d{4})-?(\d{9})$/);
  if (m) return `${m[1]}-${sansZeros(m[2])}`;
  m = v.match(/^(\d{1,9})\/(\d{4})$/);
  if (m) return `${m[2]}-${sansZeros(m[1])}`;
  return null;
}

// Clé de comparaison d'un n° de commande. La lecture agence + n° ne s'applique
// qu'aux fournisseurs à agence (règle retirerAgence : Rexel). "" = pas un n°.
export function cleCommande(value, regles = {}) {
  if (!estNumeroCommande(value)) return "";
  if (regles.retirerAgence) {
    const rexel = normaliserCommandeRexel(value);
    if (rexel) return `agence:${rexel}`;
  }
  return normaliserNumero(nettoyerCommande(value), regles);
}

const jours = (a, b) => {
  if (!a || !b) return Infinity;
  const x = Date.parse(a + "T00:00:00Z"), y = Date.parse(b + "T00:00:00Z");
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity;
};
const montant = row => centimes(row.montant_ht);
const memeMontant = (a, b, tolerance) => a != null && b != null && Math.abs(a - b) <= tolerance;

// Ne jamais lier automatiquement deux documents à la même livraison.
// Les appariements par montant et combinaison sont des propositions uniquement.
export function rapprocherFacture({ livraisons = [], documents = [], fournisseurId, regles = {}, toleranceHt = 0.05, dateFacture, periodeDebut, periodeFin }) {
  const tolerance = centimes(toleranceHt);
  const eligible = documents.filter(d => d.fournisseur_id === fournisseurId &&
    d.statut_facturation === "en_attente_facture" &&
    !d.remplace_par_id && (!dateFacture || !d.date_doc ||
      (Date.parse(dateFacture) - Date.parse(d.date_doc)) / 86400000 <= 60 &&
      Date.parse(d.date_doc) <= Date.parse(dateFacture)));
  const utilises = new Set();
  const resultat = [];
  for (const livraison of livraisons) {
    const nBl = normaliserNumero(livraison.bl_numero, regles);
    const nCommande = cleCommande(livraison.commande_numero, regles);
    const nFacture = normaliserNumero(livraison.facture_numero, regles);
    const candidats = eligible.filter(d => !utilises.has(d.id));
    const numero = (d, n) => n && [d.doc_numero, d.commande_numero].some(v => normaliserNumero(v, regles) === n);
    const uniques = (n) => candidats.filter(d => numero(d, n));
    // N° de commande : comparé au n° de commande fournisseur du document ET à
    // son doc_numero (commande saisie avec son n° de commande Rexel).
    const memeCommande = d => [d.numero_commande_fournisseur, d.commande_numero, d.doc_numero]
      .some(v => cleCommande(v, regles) === nCommande);
    const stricts = nBl ? uniques(nBl) : [];
    const commandes = !stricts.length && nCommande ? candidats.filter(memeCommande) : [];
    const factures = !stricts.length && !commandes.length && nFacture ? uniques(nFacture) : [];
    const choix = stricts.length ? stricts : commandes.length ? commandes : factures;
    let trouve = choix.length === 1 ? choix[0] : null;
    let mode = stricts.length ? "numero" : commandes.length ? "commande" : "numero_facture";
    // Une référence de commande peut couvrir plusieurs BL : jamais d'attribution
    // automatique sans confirmation si le montant ne correspond pas.
    if (trouve && mode === "commande" && !memeMontant(montant(livraison), montant(trouve), tolerance)) trouve = null;
    if (trouve) {
      utilises.add(trouve.id);
      const ecart = montant(livraison) == null || montant(trouve) == null ? null : montant(livraison) - montant(trouve);
      resultat.push({ livraison, document: trouve, mode, confirmationRequise: false, ecartCentimes: ecart, conforme: ecart != null && Math.abs(ecart) <= tolerance });
      continue;
    }
    // Même n° de commande mais montant différent : proposition « via n° de commande ».
    const modeChoix = mode === "commande" ? "commande" : "numero_ambigu";
    const propositions = [...choix.map(d => ({ document: d, mode: modeChoix })),
      ...candidats.filter(d => !choix.includes(d) && jours(livraison.date_livraison, d.date_doc) <= 3 &&
        memeMontant(montant(livraison), montant(d), tolerance)).map(d => ({ document: d, mode: "montant" }))];
    resultat.push({ livraison, document: null, mode: null, confirmationRequise: propositions.length > 0, propositions, conforme: false });
  }
  // Détecter les bons de commande couvrant 2 ou 3 livraisons.
  // Un regroupement reste une suggestion et n'est jamais lié automatiquement.
  const nonLies = resultat.filter(r => !r.document);
  for (const doc of eligible.filter(d => !utilises.has(d.id))) {
    const cible = montant(doc);
    if (cible == null) continue;
    const poss = nonLies.filter(r => montant(r.livraison) != null).slice(0, 25);
    for (let i = 0; i < poss.length; i++) {
      for (let j = i + 1; j < poss.length; j++) {
        const paire = [poss[i], poss[j]];
        const sommes = [[...paire]];
        for (let k = j + 1; k < poss.length; k++) sommes.push([...paire, poss[k]]);
        for (const groupe of sommes) {
          if (Math.abs(groupe.reduce((n, r) => n + montant(r.livraison), 0) - cible) > tolerance) continue;
          for (const r of groupe) {
            r.propositions.push({ document: doc, mode: "regroupement", bls: groupe.map(x => x.livraison.bl_numero) });
            r.confirmationRequise = true;
          }
        }
      }
    }
  }
  const inverses = eligible.filter(d => !utilises.has(d.id) &&
    (!periodeDebut || d.date_doc >= periodeDebut) && (!periodeFin || d.date_doc <= periodeFin));
  return { rapprochements: resultat, absentsFacture: inverses };
}

// Statut d'une liaison BL ↔ document d'achat : il ne dépend QUE des montants.
// La façon dont la liaison a été trouvée (numéro, montant, proposition choisie…)
// reste dans mode_rapprochement pour la traçabilité, sans changer le statut.
// Plusieurs BL liés au même document (regroupement) sont comparés ensemble.
export function statutLiaisonBl(bl, tous = [bl], toleranceHt = 0.05) {
  if (!bl?.commande_id) return "manquant";
  const lies = tous.filter(x => x.commande_id === bl.commande_id);
  if (!lies.includes(bl)) lies.push(bl);
  const montants = lies.map(x => centimes(x.montant_ht));
  const commande = centimes(bl.commandeMontant ?? bl.montant_commande_ht);
  if (commande == null || montants.some(m => m == null)) return "ecart";
  const somme = montants.reduce((n, m) => n + m, 0);
  return Math.abs(somme - commande) <= centimes(toleranceHt) ? "rapproche" : "ecart";
}

export function verifierTotalFacture({ livraisons = [], frais = [], total_ht, toleranceHt = 0.05 }) {
  const somme = [...livraisons, ...frais].reduce((s, l) => s + (centimes(l.montant_ht) || 0), 0);
  const attendu = centimes(total_ht);
  return { sommeCentimes: somme, ecartCentimes: attendu == null ? null : attendu - somme,
    conforme: attendu != null && Math.abs(attendu - somme) <= centimes(toleranceHt) };
}

// Frais liés au compte ou à la facture (absents du bon de livraison).
export const estFraisFacturation = (libelle) => /frais\s*(de\s*)?factur/i.test(String(libelle ?? ""));

/**
 * Règle fournisseur « montant du BL » (fournisseurs.regles_numero.montant_bl) :
 *   "sous_total_bl" (défaut, ex. Rexel) : montant imprimé par BL, inchangé ;
 *   "total_ht_facture" (ex. Partedis) : le bon d'emporte est valorisé port,
 *     énergie et éco-taxe compris. Pour une facture à UN SEUL BL, montant du BL
 *     = TOTAL HT de la facture − « Frais facturation » ; seuls ces frais de
 *     facturation restent en frais de facture. Plusieurs BL : rien n'est
 *     réparti automatiquement (frais proposés, à confirmer).
 * @returns { bls, frais, applique: boolean }
 */
export function appliquerRegleMontantBl({ regles = {}, bls = [], frais = [], totalHt }) {
  const total = centimes(totalHt);
  if (regles.montant_bl !== "total_ht_facture" || bls.length !== 1 || total == null) {
    return { bls, frais, applique: false };
  }
  const fraisFacturation = frais.filter(f => estFraisFacturation(f?.libelle));
  const montantBl = total - fraisFacturation.reduce((n, f) => n + (centimes(f.montant_ht) || 0), 0);
  return {
    bls: [{ ...bls[0], montant_ht: montantBl / 100 }],
    frais: fraisFacturation,
    applique: true,
  };
}
