// ─────────────────────────────────────────────────────────────────────────────
// progbatLiens — LE module unique des adresses de l'interface ProGBat
// (Refonte Opérations, lots 3 et 4 : docs/projets/refonte-operations.md).
//
// Module PUR : aucun réseau, aucun appel à ProGBat (ni lecture ni écriture) —
// il fabrique des liens que l'utilisateur ouvre lui-même dans son navigateur.
// Façade front : progbatLiens.js. Toute page qui veut « Ouvrir dans ProGBat »
// passe par ici ; aucune adresse ProGBat ne doit être recopiée ailleurs.
//
// Adresses relevées le 06/11/2026 par Loris. L'identifiant est celui de l'API
// ProGBat, PAS le numéro affiché : le devis D-260264 a l'identifiant 524
// (adresse …/quotes/524). Côté application :
//   - devis   : profero_projets.progbat_devis_id, progbat_quote_exports
//               .progbat_quote_id, chantier_factures_client.progbat_quote_id ;
//   - facture : chantier_factures_client.progbat_bill_id ;
//   - chantier ProGBat : progbat_business_id (rempli au lot 4).
//
// ProGBat gère plusieurs entreprises : le lien n'ouvre la bonne fiche que si
// l'entreprise « PROFERO RENOVATION » est active dans ProGBat (AVERTISSEMENT
// ci-dessous, à afficher dans l'infobulle des boutons).
// ─────────────────────────────────────────────────────────────────────────────

export const PROGBAT_BASE = "https://app.progbat.com/v5#/v5";

export const PROGBAT_AVERTISSEMENT_ENTREPRISE =
  "Le lien n'ouvre la bonne fiche que si l'entreprise « PROFERO RENOVATION » est active dans ProGBat (sélecteur d'entreprise en haut de ProGBat).";

/** Identifiant API ProGBat : entier strictement positif, sinon null. */
export function idProgbat(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Les 6 adresses du tableau du lot 4 (null si l'identifiant est inconnu). */
export const urlDevisProgbat = (quoteId) => {
  const id = idProgbat(quoteId);
  return id ? `${PROGBAT_BASE}/quotes/${id}` : null;
};
export const urlFactureProgbat = (billId) => {
  const id = idProgbat(billId);
  return id ? `${PROGBAT_BASE}/bills/${id}` : null;
};
export const urlListeFacturesSurligneeProgbat = (billId) => {
  const id = idProgbat(billId);
  return id ? `${PROGBAT_BASE}/bills?highlight=${id}` : null;
};
export const urlListeFacturesProgbat = () => `${PROGBAT_BASE}/bills`;
export const urlChantierProgbat = (businessId) => {
  const id = idProgbat(businessId);
  return id ? `${PROGBAT_BASE}/business/${id}` : null;
};
export const urlListeClientsProgbat = () => `${PROGBAT_BASE}/thirds/type-2`;

/**
 * Lien « Ouvrir dans ProGBat » prêt à afficher, avec repli explicite.
 *   cible : "devis" | "facture" | "chantier" | "clients"
 *   id    : identifiant API (quoteId, billId, businessId)
 * → { url, libelle, titre, repli, raison }
 *   url = null → pas de bouton ; `raison` dit pourquoi (à afficher).
 *   repli = true → le lien ouvre une liste, pas la fiche (raison expliquée).
 */
export function lienProgbat(cible, id, { nom = "" } = {}) {
  const avec = (url, libelle, raison = "", repli = false) => ({
    url, libelle, repli, raison,
    titre: `${raison ? `${raison} ` : ""}${PROGBAT_AVERTISSEMENT_ENTREPRISE}`,
  });
  const quoi = nom ? ` ${nom}` : "";
  switch (cible) {
    case "devis": {
      const url = urlDevisProgbat(id);
      return url
        ? avec(url, "Ouvrir le devis dans ProGBat")
        : { url: null, libelle: "", repli: false, raison: `Devis ProGBat${quoi} inconnu : aucun devis créé depuis l'application pour ce chantier.`, titre: "" };
    }
    case "facture": {
      const url = urlFactureProgbat(id);
      return url
        ? avec(url, "Ouvrir la facture dans ProGBat")
        : avec(urlListeFacturesProgbat(), "Ouvrir la liste des factures ProGBat",
          `Facture${quoi} pas encore connue de l'application : le lien ouvre la liste des factures.`, true);
    }
    case "chantier": {
      const url = urlChantierProgbat(id);
      return url
        ? avec(url, "Ouvrir le chantier dans ProGBat")
        : { url: null, libelle: "", repli: false, raison: "Chantier ProGBat pas encore créé ni rattaché (lot 4).", titre: "" };
    }
    case "clients":
      return avec(urlListeClientsProgbat(), "Ouvrir la liste des clients ProGBat");
    default:
      return { url: null, libelle: "", repli: false, raison: `Cible ProGBat inconnue : ${cible}`, titre: "" };
  }
}
