// ─── SYNCHRONISATION BIBLIOTHÈQUE PROGBAT — PLAN PUR ────────────────────────
// Construit un plan conservateur à partir de l'inventaire :
//   • un code métier unique déjà présent est seulement LIÉ dans Profero ;
//   • un ouvrage réellement absent et complet est CRÉÉ sous « Ouvrages V2 » ;
//   • aucune structure existante n'est modifiée ou supprimée ;
//   • aucun matériau/composant n'est créé dans cette première version.

import { arrondirMontant, num } from "./chiffragePricing.mjs";
import { normaliserLibelle } from "./progbatInventaire.mjs";

export const FAMILLE_CIBLE_DEFAUT = "Ouvrages V2";

const str = (v) => String(v ?? "").trim();
const arrondir4 = (v) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

export function cleUnite(v) {
  return str(v).toLowerCase().replace(/\s+/g, "").replace(/²/g, "2");
}

export function trouverFamilleCible(familles = [], libelle = FAMILLE_CIBLE_DEFAUT) {
  const cible = normaliserLibelle(libelle);
  const candidats = (familles || []).filter((f) =>
    f?.id != null && f.structureFamily !== false && normaliserLibelle(f.label) === cible
  );
  return {
    ok: candidats.length === 1,
    id: candidats.length === 1 ? Number(candidats[0].id) : null,
    libelle,
    candidats: candidats.map((f) => ({ id: Number(f.id), label: str(f.label) })),
    erreur: candidats.length === 0
      ? `Famille d'ouvrages ProGBat « ${libelle} » introuvable`
      : candidats.length > 1 ? `Plusieurs familles d'ouvrages ProGBat portent le nom « ${libelle} »` : null,
  };
}

export function trouverTva(taxes = [], tvaDefaut) {
  const attendu = num(tvaDefaut);
  if (attendu == null) return null;
  return (taxes || []).find((t) => {
    const r = num(t?.rate);
    return r != null && (Math.abs(r - attendu) < 0.001 || Math.abs(r * 100 - attendu) < 0.001);
  }) || null;
}

export function construirePayloadStructure(rapprochement, { familleId, unites = [], taxe } = {}) {
  const erreurs = [];
  const code = str(rapprochement?.profero?.code);
  const libelleCourt = str(rapprochement?.profero?.libelle_court);
  const cout = num(rapprochement?.prix?.cout_total_ht);
  const vente = num(rapprochement?.prix?.prix_vente_ht);
  const famille = num(familleId);
  const unite = (unites || []).find((u) => cleUnite(u?.code) === cleUnite(rapprochement?.profero?.unite));
  const taux = num(taxe?.rate);

  if (!code) erreurs.push("Code Profero absent");
  if (!libelleCourt) erreurs.push("Libellé absent");
  if (!Number.isInteger(famille) || famille <= 0) erreurs.push(`Famille ProGBat « ${FAMILLE_CIBLE_DEFAUT} » introuvable ou ambiguë`);
  if (!unite?.code) erreurs.push(`Unité « ${str(rapprochement?.profero?.unite)} » inconnue dans ProGBat`);
  if (cout == null || cout < 0) erreurs.push("Coût total HT invalide");
  if (vente == null || vente < 0) erreurs.push("Prix de vente HT invalide");
  if (taux == null) erreurs.push("TVA par défaut introuvable dans ProGBat");

  if (erreurs.length) return { ok: false, erreurs, payload: null };
  const achat = arrondirMontant(cout);
  const prixVente = arrondirMontant(vente);
  const edge = achat > 0 ? arrondir4((prixVente / achat - 1) * 100) : 0;
  return {
    ok: true,
    erreurs: [],
    payload: {
      code,
      label: `${code} : ${libelleCourt}`,
      unitCode: str(unite.code),
      families: [famille],
      purchaseNetUnitPrice: achat,
      edge,
      saleNetUnitPrice: prixVente,
      taxRate: taux > 0 && taux < 1 ? taux * 100 : taux,
      active: true,
      fixedPrice: true,
      technicalCom: `${code} : ${libelleCourt}`,
    },
  };
}

export function construirePlanSynchronisation({ inventaire, familles = [], unites = [], taxes = [], tvaDefaut = null, familleLabel = FAMILLE_CIBLE_DEFAUT } = {}) {
  const famille = trouverFamilleCible(familles, familleLabel);
  const taxe = trouverTva(taxes, tvaDefaut);
  const actions = [];
  const exclus = [];

  for (const r of inventaire?.rapprochements || []) {
    const ouvrageId = r?.profero?.id;
    if (!ouvrageId) continue;
    if (r.statut === "correspondance_code_a_confirmer" && r.correspondance?.id != null) {
      actions.push({
        type: "link",
        ouvrageId,
        code: r.profero.code,
        libelle: r.profero.libelle_court,
        progbatId: Number(r.correspondance.id),
        progbatLabel: r.correspondance.label || "",
      });
      continue;
    }
    if (r.statut === "nouveau_a_creer" && r.synchronisable) {
      const p = construirePayloadStructure(r, { familleId: famille.id, unites, taxe });
      if (p.ok) actions.push({ type: "create", ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, payload: p.payload });
      else exclus.push({ ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, raisons: p.erreurs });
      continue;
    }
    if (!["deja_lie"].includes(r.statut)) {
      exclus.push({ ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, raisons: r.blocages?.length ? r.blocages : [`Statut « ${r.statut} » à traiter manuellement`] });
    }
  }

  actions.sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "fr", { numeric: true }));
  return {
    famille,
    taxe: taxe ? { id: taxe.id ?? null, rate: num(taxe.rate), label: str(taxe.label) } : null,
    actions,
    exclus,
    compteurs: {
      a_lier: actions.filter((a) => a.type === "link").length,
      a_creer: actions.filter((a) => a.type === "create").length,
      exclus: exclus.length,
      total: actions.length,
    },
    garanties: { modifie_existants_progbat: false, supprime_progbat: false, cree_elements: false },
  };
}

export function donneesPourHash(plan) {
  return {
    famille: plan?.famille?.id ?? null,
    actions: (plan?.actions || []).map((a) => a.type === "link"
      ? { type: a.type, ouvrageId: a.ouvrageId, progbatId: a.progbatId }
      : { type: a.type, ouvrageId: a.ouvrageId, payload: a.payload }),
  };
}
