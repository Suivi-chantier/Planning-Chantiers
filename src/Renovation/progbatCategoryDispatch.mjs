// ─── CLASSEMENT DES OUVRAGES PROGBAT PAR FAMILLE MÉTIER ────────────────────
// Module pur : prépare un plan à partir des liens Profero, des lots configurés
// et de l'inventaire ProGBat. Aucun accès réseau ni base de données.

import { parseCodeOuvrage } from "./codeOuvrage.mjs";
import { normaliserLibelle } from "./progbatInventaire.mjs";

const str = (v) => String(v ?? "").trim();
const entier = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function extraireIdsFamilles(structure) {
  const brut = structure?.families ?? structure?.familyIds ?? structure?.family_ids;
  if (!Array.isArray(brut)) return { connu: false, ids: [] };
  return {
    connu: true,
    ids: [...new Set(brut.map((x) => entier(x?.id ?? x)).filter(Boolean))].sort((a, b) => a - b),
  };
}

export function normaliserLots(lots = []) {
  return (Array.isArray(lots) ? lots : [])
    .map((l) => ({ id: str(l?.id), label: str(l?.label), prefixe: str(l?.code_prefixe).toUpperCase() }))
    .filter((l) => l.label && /^[A-Z]{1,5}$/.test(l.prefixe));
}

export function trouverFamilleMetier(familles = [], label) {
  const cle = normaliserLibelle(label);
  const candidats = (Array.isArray(familles) ? familles : []).filter((f) =>
    entier(f?.id) && f?.structureFamily === true && normaliserLibelle(f?.label) === cle
  );
  return {
    ok: candidats.length === 1,
    absente: candidats.length === 0,
    ambigue: candidats.length > 1,
    id: candidats.length === 1 ? entier(candidats[0].id) : null,
    label: str(label),
    candidats: candidats.map((f) => ({ id: entier(f.id), label: str(f.label) })),
  };
}

const memeEnsemble = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function construirePlanClassement({ ouvrages = [], structures = [], familles = [], lots = [], historique = [], historiqueFamilles = [] } = {}) {
  const lotsPropres = normaliserLots(lots);
  const lotsParPrefixe = new Map();
  const prefixesAmbigus = new Set();
  for (const lot of lotsPropres) {
    if (lotsParPrefixe.has(lot.prefixe)) prefixesAmbigus.add(lot.prefixe);
    else lotsParPrefixe.set(lot.prefixe, lot);
  }
  const structuresParId = new Map((Array.isArray(structures) ? structures : [])
    .filter((s) => entier(s?.id)).map((s) => [String(entier(s.id)), s]));
  const dernierParStructure = new Map();
  for (const h of historique || []) {
    const sid = entier(h?.progbat_structure_id);
    if (sid && !dernierParStructure.has(String(sid))) dernierParStructure.set(String(sid), h);
  }
  const dernierParFamille = new Map();
  for (const h of historiqueFamilles || []) {
    const cle = normaliserLibelle(h?.family_label);
    if (cle && !dernierParFamille.has(cle)) dernierParFamille.set(cle, h);
  }
  const familleIncertaine = new Set([...dernierParFamille.entries()]
    .filter(([, h]) => ["creating", "uncertain"].includes(h?.statut)).map(([cle]) => cle));

  const exclus = [];
  const dejaClasses = [];
  const candidatsParStructure = new Map();

  for (const o of Array.isArray(ouvrages) ? ouvrages : []) {
    const ouvrageId = str(o?.id);
    const structureId = entier(o?.progbat_id);
    const code = parseCodeOuvrage(o?.libelle);
    if (!ouvrageId || !structureId) continue;
    if (!code) {
      exclus.push({ ouvrageId, structureId, code: null, libelle: str(o?.libelle), raison: "Code d’ouvrage absent ou invalide" });
      continue;
    }
    if (prefixesAmbigus.has(code.prefixe)) {
      exclus.push({ ouvrageId, structureId, code: code.code, libelle: code.reste, raison: `Préfixe « ${code.prefixe} » utilisé par plusieurs lots Profero` });
      continue;
    }
    const lot = lotsParPrefixe.get(code.prefixe);
    if (!lot) {
      exclus.push({ ouvrageId, structureId, code: code.code, libelle: code.reste, raison: `Préfixe « ${code.prefixe} » sans lot configuré dans Profero` });
      continue;
    }
    const structure = structuresParId.get(String(structureId));
    if (!structure) {
      exclus.push({ ouvrageId, structureId, code: code.code, libelle: code.reste, raison: `Ouvrage ProGBat id ${structureId} introuvable` });
      continue;
    }
    const famille = trouverFamilleMetier(familles, lot.label);
    if (famille.ambigue) {
      exclus.push({ ouvrageId, structureId, code: code.code, libelle: code.reste, raison: `Plusieurs familles ProGBat portent le nom « ${lot.label} »` });
      continue;
    }
    if (familleIncertaine.has(normaliserLibelle(lot.label)) && famille.absente) {
      exclus.push({ ouvrageId, structureId, code: code.code, libelle: code.reste, raison: `Création de la famille « ${lot.label} » incertaine : vérification manuelle requise` });
      continue;
    }
    const entree = {
      ouvrageId, structureId, code: code.code, libelle: code.reste,
      prefixe: code.prefixe, lotId: lot.id, familleLabel: lot.label,
      familleId: famille.id, familleActuelleIds: extraireIdsFamilles(structure),
    };
    if (!candidatsParStructure.has(String(structureId))) candidatsParStructure.set(String(structureId), []);
    candidatsParStructure.get(String(structureId)).push(entree);
  }

  const actions = [];
  for (const groupes of candidatsParStructure.values()) {
    const labels = [...new Set(groupes.map((x) => normaliserLibelle(x.familleLabel)))];
    if (labels.length !== 1) {
      for (const x of groupes) exclus.push({ ...x, raison: "Un même ouvrage ProGBat est lié à plusieurs catégories Profero" });
      continue;
    }
    const x = groupes[0];
    const ouvrageIds = groupes.map((g) => g.ouvrageId);
    const codes = [...new Set(groupes.map((g) => g.code))];
    const ancien = dernierParStructure.get(String(x.structureId));
    if (["categorizing", "uncertain"].includes(ancien?.statut)) {
      for (const g of groupes) exclus.push({ ...g, raison: `Classement ${ancien.statut} : vérification manuelle requise` });
      continue;
    }
    const suiviIdentique = ancien?.statut === "categorized"
      && normaliserLibelle(ancien?.family_label) === normaliserLibelle(x.familleLabel)
      && (!x.familleId || entier(ancien?.progbat_family_id) === x.familleId);
    const apiIdentique = x.familleId && x.familleActuelleIds.connu && memeEnsemble(x.familleActuelleIds.ids, [x.familleId]);
    if (suiviIdentique || apiIdentique) {
      dejaClasses.push({ structureId: x.structureId, ouvrageIds, codes, familleLabel: x.familleLabel, familleId: x.familleId ?? entier(ancien?.progbat_family_id) });
      continue;
    }
    actions.push({
      type: "categorize", structureId: x.structureId, ouvrageId: x.ouvrageId,
      ouvrageIds, codes, libelle: x.libelle, familleLabel: x.familleLabel,
      familleId: x.familleId, anciennesFamilles: x.familleActuelleIds,
    });
  }

  const famillesACreer = [...new Map(actions.filter((a) => !a.familleId)
    .map((a) => [normaliserLibelle(a.familleLabel), {
      label: a.familleLabel,
      payload: { label: a.familleLabel, elementFamily: false, structureFamily: true, craftFamily: false },
    }])).values()].sort((a, b) => a.label.localeCompare(b.label, "fr"));
  actions.sort((a, b) => a.familleLabel.localeCompare(b.familleLabel, "fr") || a.codes[0].localeCompare(b.codes[0], "fr", { numeric: true }));
  exclus.sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "fr", { numeric: true }));

  return {
    actions, famillesACreer, exclus, dejaClasses, lots: lotsPropres,
    compteurs: { a_classer: actions.length, familles_a_creer: famillesACreer.length, deja_classes: dejaClasses.length, exclus: exclus.length },
    garanties: { champs_modifies: ["families"], supprime_ouvrage: false, modifie_prix: false, modifie_libelle: false, modifie_composition: false },
  };
}

export function donneesClassementPourHash(plan) {
  return {
    famillesACreer: (plan?.famillesACreer || []).map((f) => f.payload),
    actions: (plan?.actions || []).map((a) => ({
      structureId: a.structureId, ouvrageIds: a.ouvrageIds,
      familleLabel: a.familleLabel, familleId: a.familleId,
    })),
  };
}
