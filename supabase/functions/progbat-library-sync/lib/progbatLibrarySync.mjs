// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatLibrarySync.mjs (node scripts/sync-progbat-edge-lib.mjs)
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

/**
 * Famille ProGBat qui accueillera les ouvrages créés. Les trois causes d'échec
 * sont distinguées, parce qu'elles ne se corrigent pas de la même façon :
 *   • aucune famille de ce nom              → la créer dans ProGBat ;
 *   • une famille de ce nom, mais qui n'est pas une famille d'OUVRAGES
 *     (structureFamily = false)             → cocher « ouvrages » dessus ;
 *   • plusieurs familles de ce nom          → en supprimer/renommer une.
 * `disponibles` liste les familles d'ouvrages réellement utilisables, pour que
 * l'écran puisse montrer ce qui existe au lieu d'un simple « introuvable ».
 */
export function trouverFamilleCible(familles = [], libelle = FAMILLE_CIBLE_DEFAUT) {
  const cible = normaliserLibelle(libelle);
  const liste = (familles || []).filter((f) => f?.id != null);
  const resume = (f) => ({ id: Number(f.id), label: str(f.label), structureFamily: f?.structureFamily !== false });
  // Homonymes : même nom, quel que soit le type de famille.
  const homonymes = liste.filter((f) => normaliserLibelle(f.label) === cible);
  const candidats = homonymes.filter((f) => f.structureFamily !== false);
  const ok = candidats.length === 1;
  let erreur = null;
  if (candidats.length > 1) erreur = `Plusieurs familles d'ouvrages ProGBat portent le nom « ${libelle} »`;
  else if (!candidats.length && homonymes.length) {
    erreur = `La famille ProGBat « ${libelle} » existe mais n'est pas une famille d'ouvrages : cocher « ouvrages » dessus dans ProGBat`;
  } else if (!candidats.length) {
    erreur = `Famille d'ouvrages ProGBat « ${libelle} » introuvable : la créer dans ProGBat (bibliothèque → familles), au nom exact « ${libelle} »`;
  }
  return {
    ok,
    id: ok ? Number(candidats[0].id) : null,
    libelle,
    candidats: candidats.map(resume),
    homonymes: homonymes.map(resume),
    disponibles: liste.filter((f) => f.structureFamily !== false).map((f) => str(f.label)).filter(Boolean).sort((a, b) => a.localeCompare(b, "fr")),
    erreur,
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

export function construirePayloadStructure(rapprochement, { familleId, unites = [], taxe, familleErreur = null } = {}) {
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
  // La cause exacte vient de trouverFamilleCible : elle dit quoi corriger dans ProGBat.
  if (!Number.isInteger(famille) || famille <= 0) erreurs.push(str(familleErreur) || `Famille ProGBat « ${FAMILLE_CIBLE_DEFAUT} » introuvable ou ambiguë`);
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
      const p = construirePayloadStructure(r, { familleId: famille.id, unites, taxe, familleErreur: famille.erreur });
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

/**
 * Restreint un plan global à quelques ouvrages Profero (envoi d'un ouvrage
 * depuis sa fiche de bibliothèque, sans toucher au reste). Les règles ne
 * changent pas : le plan complet est construit normalement, puis filtré.
 * Un identifiant demandé qui n'apparaît ni en action ni en exclusion est
 * rendu dans `hors_plan` (déjà lié, ou inconnu de l'inventaire).
 * @returns le plan inchangé si aucun périmètre n'est demandé.
 */
export function restreindrePlan(plan, ouvrageIds) {
  const demandes = (ouvrageIds || []).map((x) => str(x)).filter(Boolean);
  if (!plan || !demandes.length) return plan;
  const voulu = new Set(demandes);
  const actions = (plan.actions || []).filter((a) => voulu.has(str(a.ouvrageId)));
  const exclus = (plan.exclus || []).filter((e) => voulu.has(str(e.ouvrageId)));
  const vus = new Set([...actions, ...exclus].map((x) => str(x.ouvrageId)));
  return {
    ...plan,
    actions,
    exclus,
    perimetre: { ouvrageIds: [...voulu].sort() },
    hors_plan: demandes.filter((id) => !vus.has(id)),
    compteurs: {
      a_lier: actions.filter((a) => a.type === "link").length,
      a_creer: actions.filter((a) => a.type === "create").length,
      exclus: exclus.length,
      total: actions.length,
    },
  };
}

/**
 * État de synchronisation d'un ouvrage Profero tel que l'inventaire le voit.
 * Sert à expliquer sur la fiche pourquoi un ouvrage n'a aucune action à faire
 * (déjà lié) ou ne peut pas être créé (blocages).
 */
export function etatOuvragePourSync(inventaire, ouvrageId) {
  const cible = str(ouvrageId);
  const r = (inventaire?.rapprochements || []).find((x) => str(x?.profero?.id) === cible);
  if (!r) return null;
  return {
    ouvrageId: cible,
    code: r.profero?.code ?? null,
    libelle: r.profero?.libelle_court ?? null,
    statut: r.statut,
    synchronisable: r.synchronisable === true,
    blocages: r.blocages || [],
    notes: r.notes || [],
    progbatId: r.profero?.progbat_id ?? r.correspondance?.id ?? null,
    progbatLabel: str(r.correspondance?.label) || null,
    candidats: (r.candidats || []).map((c) => ({ id: c?.id ?? null, label: str(c?.label) })),
  };
}

export function donneesPourHash(plan) {
  return {
    famille: plan?.famille?.id ?? null,
    // Le périmètre entre dans l'empreinte : un aperçu préparé pour un seul
    // ouvrage ne peut pas servir à confirmer une synchronisation globale.
    perimetre: plan?.perimetre?.ouvrageIds ?? null,
    actions: (plan?.actions || []).map((a) => a.type === "link"
      ? { type: a.type, ouvrageId: a.ouvrageId, progbatId: a.progbatId }
      : { type: a.type, ouvrageId: a.ouvrageId, payload: a.payload }),
  };
}
