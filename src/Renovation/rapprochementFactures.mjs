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
  if (regles.retirerAgence && /^\d+\s*\/\s*\d{4}$/.test(numero)) numero = numero.split("/")[0];
  if (regles.retirerClient && /^\d+\s*\/\s*\d{6}$/.test(numero)) numero = numero.split("/")[0];
  if (regles.retirerZeros !== false) numero = numero.replace(/^0+(?=\d)/, "");
  return numero.replace(/\s*([/-])\s*/g, "$1");
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
    const nCommande = normaliserNumero(livraison.commande_numero, regles);
    const nFacture = normaliserNumero(livraison.facture_numero, regles);
    const candidats = eligible.filter(d => !utilises.has(d.id));
    const numero = (d, n) => n && [d.doc_numero, d.commande_numero].some(v => normaliserNumero(v, regles) === n);
    const uniques = (n) => candidats.filter(d => numero(d, n));
    const stricts = nBl ? uniques(nBl) : [];
    const commandes = !stricts.length && nCommande ? uniques(nCommande) : [];
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
    const propositions = [...choix.map(d => ({ document: d, mode: "numero_ambigu" })),
      ...candidats.filter(d => !choix.includes(d) && jours(livraison.date_livraison, d.date_doc) <= 3 &&
        memeMontant(montant(livraison), montant(d), tolerance)).map(d => ({ document: d, mode: "montant" }))];
    resultat.push({ livraison, document: null, mode: null, confirmationRequise: propositions.length > 0, propositions, conforme: false });
  }
  const inverses = eligible.filter(d => !utilises.has(d.id) &&
    (!periodeDebut || d.date_doc >= periodeDebut) && (!periodeFin || d.date_doc <= periodeFin));
  return { rapprochements: resultat, absentsFacture: inverses };
}

export function verifierTotalFacture({ livraisons = [], frais = [], total_ht, toleranceHt = 0.05 }) {
  const somme = [...livraisons, ...frais].reduce((s, l) => s + (centimes(l.montant_ht) || 0), 0);
  const attendu = centimes(total_ht);
  return { sommeCentimes: somme, ecartCentimes: attendu == null ? null : attendu - somme,
    conforme: attendu != null && Math.abs(attendu - somme) <= centimes(toleranceHt) };
}
