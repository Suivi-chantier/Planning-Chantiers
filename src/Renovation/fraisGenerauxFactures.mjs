// Frais de factures fournisseurs imputés en « frais généraux » (rapprochement),
// regroupés par mois de facture pour l'onglet Frais généraux des États
// financiers. Module pur : les lignes arrivent en paramètre.
//
// Seules les factures VALIDÉES (statut « rapprochee ») comptent : une facture
// encore à rapprocher peut changer. Le résultat est une INFORMATION affichée à
// côté du total mensuel saisi à la main : il n'y est pas ajouté (ce total peut
// déjà venir de la comptabilité, l'ajouter compterait deux fois ces frais).

const centimes = (v) => (v == null || v === "" ? 0 : Math.round(Number(v) * 100));

/**
 * @param lignes [{ montant_ht, libelle, facture: { numero, date_facture, statut, fournisseur_nom } }]
 * @param annee  ex. 2026
 * @returns { parMois: { "01": 4.2, … }, total, detail: [{ mois, numero, fournisseur, libelle, montant }] }
 */
export function fraisGenerauxParMois(lignes = [], annee) {
  const parMoisC = {};
  const detail = [];
  for (const l of lignes) {
    const f = l?.facture;
    if (!f || f.statut !== "rapprochee" || !f.date_facture) continue;
    const [a, m] = String(f.date_facture).split("-");
    if (Number(a) !== Number(annee) || !m) continue;
    parMoisC[m] = (parMoisC[m] || 0) + centimes(l.montant_ht);
    detail.push({ mois: m, numero: f.numero || "", fournisseur: f.fournisseur_nom || "", libelle: l.libelle || "", montant: centimes(l.montant_ht) / 100 });
  }
  const parMois = Object.fromEntries(Object.entries(parMoisC).map(([k, v]) => [k, v / 100]));
  const total = Object.values(parMoisC).reduce((n, v) => n + v, 0) / 100;
  detail.sort((x, y) => x.mois.localeCompare(y.mois) || x.numero.localeCompare(y.numero));
  return { parMois, total, detail };
}
