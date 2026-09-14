// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatInventaire.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── INVENTAIRE PROGBAT — RAPPROCHEMENT PUR (LECTURE SEULE) ──────────────────
// Compare la bibliothèque d'ouvrages Profero (bibliotheque_ratios) avec les
// « structures » de la bibliothèque ProGBat. Module PUR : aucun accès réseau ni
// Supabase, aucune écriture. Il est utilisé :
//   • par l'Edge Function supabase/functions/progbat-library-inventory (copie
//     synchronisée par scripts/sync-progbat-edge-lib.mjs — ne pas éditer la copie) ;
//   • par le script de vérification scripts/verif-progbat-inventaire.mjs.
//
// Règles de rapprochement, appliquées DANS CET ORDRE pour chaque ouvrage Profero :
//   1. progbat_id enregistré ET présent dans ProGBat        → deja_lie
//   2. un seul ouvrage ProGBat avec le même code normalisé  → correspondance_code_a_confirmer
//   3. plusieurs ouvrages ProGBat avec ce code              → ambigu (tous les candidats)
//   4. libellé strictement identique après normalisation   → correspondance_libelle_a_examiner
//   5. rien de fiable ni probable                           → nouveau_a_creer
//   Les structures ProGBat qu'aucune règle n'a touchées     → progbat_non_lie
// Aucune de ces correspondances n'est enregistrée : c'est une simulation.
//
// Normalisation des codes (volontairement limitée) : espaces retirés, majuscules,
// seuls lettres, chiffres, tirets et points sont conservés. La structure du code
// n'est jamais réécrite (« D-001 » et « D001 » restent différents).

import { parseCodeOuvrage, comparerCodes } from "./codeOuvrage.mjs";
import { calculerOuvrage, num, normaliserUnite } from "./chiffragePricing.mjs";

export const STATUTS = Object.freeze({
  deja_lie: "deja_lie",
  correspondance_code_a_confirmer: "correspondance_code_a_confirmer",
  ambigu: "ambigu",
  correspondance_libelle_a_examiner: "correspondance_libelle_a_examiner",
  nouveau_a_creer: "nouveau_a_creer",
  progbat_non_lie: "progbat_non_lie",
});

/** Ordre d'affichage des statuts et libellés lisibles. */
export const STATUTS_ORDRE = Object.freeze([
  "deja_lie",
  "correspondance_code_a_confirmer",
  "ambigu",
  "correspondance_libelle_a_examiner",
  "nouveau_a_creer",
  "progbat_non_lie",
]);

export const STATUTS_LABELS = Object.freeze({
  deja_lie: "Déjà lié",
  correspondance_code_a_confirmer: "Code identique (à confirmer)",
  ambigu: "Ambigu",
  correspondance_libelle_a_examiner: "Libellé identique (à examiner)",
  nouveau_a_creer: "Nouveau à créer",
  progbat_non_lie: "ProGBat seul (non lié)",
});

const str = (v) => String(v ?? "").trim();
const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

// ─── Normalisations ──────────────────────────────────────────────────────────
/** « d-001 » → « D-001 » ; « D 001 » → « D001 » (espaces retirés, structure conservée). */
export function normaliserCode(code) {
  return str(code).toUpperCase().replace(/[^A-Z0-9\-.]/g, "");
}

/** Libellé comparable : sans accents, minuscules, espaces réduits, ponctuation finale retirée. */
export function normaliserLibelle(libelle) {
  return str(libelle)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")   // marques diacritiques (après décomposition NFD)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s:.\-–—;,]+$/g, "")
    .trim();
}

/** Code Profero normalisé (« COUV-001 ») lu en tête de libellé, ou null. */
export function codeProfero(ouvrage) {
  return parseCodeOuvrage(ouvrage?.libelle)?.code ?? null;
}

/** Libellé Profero sans son code de tête. */
export function libelleCourtProfero(ouvrage) {
  return parseCodeOuvrage(ouvrage?.libelle)?.reste ?? str(ouvrage?.libelle);
}

// ─── Complétude d'un ouvrage Profero ─────────────────────────────────────────
/**
 * Contrôle qu'un ouvrage Profero est suffisamment renseigné pour être créé un
 * jour dans ProGBat. Réutilise calculerOuvrage (source unique des règles de
 * prix) et ajoute les contrôles propres à la synchronisation.
 * @param ouvrage  ligne bibliotheque_ratios
 * @param ctx      { materiaux, coutHoraire, tvaDefaut, tauxTvaProgbat?, unitesProgbat? }
 * @returns {{ code, libelleCourt, unite, blocages: string[], avertissements: string[], synchronisable: boolean, prix }}
 */
export function verifierCompletude(ouvrage, { materiaux = [], coutHoraire = null, tvaDefaut = null, tauxTvaProgbat = null, unitesProgbat = null } = {}) {
  const blocages = [];
  const avertissements = [];
  const libelle = str(ouvrage?.libelle);
  const code = parseCodeOuvrage(libelle);

  if (!libelle) blocages.push("Libellé vide");
  if (!code) blocages.push("Code d'ouvrage absent en tête de libellé (ex. « D-001 : … »)");
  else if (!str(code.reste) || normaliserLibelle(code.reste) === normaliserLibelle(libelle)) {
    blocages.push("Libellé réduit au code : aucun descriptif après le code");
  }
  if (!str(ouvrage?.unite)) blocages.push("Unité absente");

  const calc = calculerOuvrage(ouvrage, { materiaux, coutHoraire });
  // calc.erreurs couvre : cadence absente, coût horaire non configuré, matériau
  // introuvable / sans prix / sans quantité, aucun matériau (hors MO seule),
  // coût direct négatif, coefficient de vente absent ou < 1.
  blocages.push(...calc.erreurs);
  avertissements.push(...calc.avertissements);
  if (calc.coutMateriauxUnitaire == null && !calc.erreurs.some((e) => /mat[ée]riau/i.test(e))) blocages.push("Coût matériaux non calculable");
  if (calc.coutMainOeuvreUnitaire == null && !calc.erreurs.some((e) => /cadence|horaire/i.test(e))) blocages.push("Coût de main-d'œuvre non calculable");
  if (calc.prixVenteUnitaire == null && blocages.length === 0) blocages.push("Prix de vente HT non calculable");

  // TVA : la bibliothèque n'a pas de TVA par ouvrage ; la règle applicable est
  // la TVA par défaut du chiffrage (planning_config.chiffrage_tva_defaut).
  const tva = num(tvaDefaut);
  if (tva == null) {
    blocages.push("Aucune règle de TVA : TVA par défaut du chiffrage non réglée (Réglages → Taux)");
  } else if (Array.isArray(tauxTvaProgbat) && tauxTvaProgbat.length > 0) {
    const connue = tauxTvaProgbat.some((t) => {
      const r = num(t?.rate);
      return r != null && (Math.abs(r - tva) < 0.001 || Math.abs(r * 100 - tva) < 0.001);
    });
    if (!connue) avertissements.push(`TVA ${tva} % absente des taux actifs ProGBat`);
  }

  // Unité : signalée (pas bloquante) si ProGBat ne la connaît pas.
  const unite = normaliserUnite(ouvrage?.unite);
  if (str(ouvrage?.unite) && Array.isArray(unitesProgbat) && unitesProgbat.length > 0) {
    const codes = new Set(unitesProgbat.map((u) => normaliserCode(u?.code)));
    if (!codes.has(normaliserCode(unite)) && !codes.has(normaliserCode(ouvrage.unite))) {
      avertissements.push(`Unité « ${unite} » inconnue dans ProGBat`);
    }
  }

  return {
    code: code?.code ?? null,
    libelleCourt: code?.reste ?? libelle,
    unite,
    blocages: uniq(blocages),
    avertissements: uniq(avertissements),
    synchronisable: blocages.length === 0,
    prix: {
      cout_total_ht: calc.coutTotalUnitaire,
      prix_vente_ht: calc.prixVenteUnitaire,
      coef_vente: calc.coefVente,
      taux_marge_pct: calc.tauxMargePct,
    },
  };
}

// ─── Rapprochement ───────────────────────────────────────────────────────────
function indexerStructures(structures) {
  return (Array.isArray(structures) ? structures : [])
    .filter((s) => s && s.id != null)
    .map((s) => {
      const label = str(s.label);
      const parse = parseCodeOuvrage(label);
      return {
        id: s.id,
        idStr: String(s.id),
        code: str(s.code),
        codeNorm: normaliserCode(s.code),
        label,
        labelNorm: normaliserLibelle(label),
        labelSansCodeNorm: parse ? normaliserLibelle(parse.reste) : null,
        unitCode: str(s.unitCode),
        prixVente: num(s.saleNetUnitPrice),
        actif: s.active !== false,
        type: s.type ?? null,
      };
    });
}

const resumeStructure = (s) => ({
  id: s.id,
  code: s.code || null,
  label: s.label,
  unitCode: s.unitCode || null,
  prix_vente_ht: s.prixVente,
  actif: s.actif,
});

/**
 * Rapproche la bibliothèque Profero des structures ProGBat.
 * @param params.ouvrages     lignes bibliotheque_ratios
 * @param params.structures   structures ProGBat (id, code, label, unitCode, saleNetUnitPrice, active…)
 * @param params.materiaux    materiaux_bibliotheque (id, nom, unite, prix_unitaire)
 * @param params.coutHoraire  planning_config.taux_mo_previsionnel
 * @param params.tvaDefaut    planning_config.chiffrage_tva_defaut
 * @param params.taxes        taux de TVA ProGBat (id, rate, label, saleDefault)
 * @param params.unites       unités ProGBat (id, code)
 */
export function rapprocherBibliotheque({ ouvrages = [], structures = [], materiaux = [], coutHoraire = null, tvaDefaut = null, taxes = null, unites = null } = {}) {
  const structs = indexerStructures(structures);
  const parId = new Map();
  const parCode = new Map();
  const parLabel = new Map();
  const push = (map, k, s) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(s); };
  structs.forEach((s) => {
    parId.set(s.idStr, s);
    push(parCode, s.codeNorm, s);
    push(parLabel, s.labelNorm, s);
    if (s.labelSansCodeNorm && s.labelSansCodeNorm !== s.labelNorm) push(parLabel, s.labelSansCodeNorm, s);
  });

  const utilises = new Set();
  const ctx = { materiaux, coutHoraire, tvaDefaut, tauxTvaProgbat: taxes, unitesProgbat: unites };

  const rapprochements = (Array.isArray(ouvrages) ? ouvrages : [])
    .filter(Boolean)
    .map((o) => {
      const compl = verifierCompletude(o, ctx);
      const notes = [];
      let statut = null;
      let correspondance = null;
      let candidats = [];

      // 1. progbat_id déjà enregistré
      const pid = str(o.progbat_id);
      if (pid) {
        const s = parId.get(pid);
        if (s) { statut = STATUTS.deja_lie; correspondance = resumeStructure(s); utilises.add(s.idStr); }
        else notes.push(`progbat_id « ${pid} » enregistré mais introuvable dans ProGBat : lien à revoir`);
      }

      // 2 & 3. code strictement identique (unique → à confirmer ; plusieurs → ambigu)
      const codeNorm = normaliserCode(compl.code);
      if (!statut && codeNorm) {
        const memes = parCode.get(codeNorm) || [];
        if (memes.length === 1) {
          statut = STATUTS.correspondance_code_a_confirmer;
          correspondance = resumeStructure(memes[0]);
          utilises.add(memes[0].idStr);
        } else if (memes.length > 1) {
          statut = STATUTS.ambigu;
          candidats = memes.map(resumeStructure);
          memes.forEach((s) => utilises.add(s.idStr));
        }
      }

      // 4. libellé identique (suggestion seulement)
      if (!statut) {
        const cles = uniq([normaliserLibelle(compl.libelleCourt), normaliserLibelle(o.libelle)]);
        const trouves = new Map();
        cles.forEach((k) => (parLabel.get(k) || []).forEach((s) => trouves.set(s.idStr, s)));
        if (trouves.size > 0) {
          statut = STATUTS.correspondance_libelle_a_examiner;
          candidats = [...trouves.values()].map(resumeStructure);
          trouves.forEach((s) => utilises.add(s.idStr));
        }
      }

      // 5. nouveau
      if (!statut) statut = STATUTS.nouveau_a_creer;

      return {
        profero: {
          id: o.id ?? null,
          code: compl.code,
          libelle: str(o.libelle),
          libelle_court: compl.libelleCourt,
          unite: compl.unite,
          progbat_id: pid || null,
        },
        statut,
        correspondance,
        candidats,
        synchronisable: compl.synchronisable,
        pret_a_creer: statut === STATUTS.nouveau_a_creer && compl.synchronisable,
        blocages: compl.blocages,
        avertissements: compl.avertissements,
        notes,
        prix: compl.prix,
      };
    })
    .sort((a, b) => comparerCodes(a.profero.code || a.profero.libelle, b.profero.code || b.profero.libelle));

  // 6. structures ProGBat sans équivalent Profero (signalées, jamais supprimées)
  const progbat_non_lies = structs
    .filter((s) => !utilises.has(s.idStr))
    .map((s) => ({ ...resumeStructure(s), statut: STATUTS.progbat_non_lie }))
    .sort((a, b) => comparerCodes(a.code || a.label, b.code || b.label));

  const compteurs = Object.fromEntries(STATUTS_ORDRE.map((k) => [k, 0]));
  rapprochements.forEach((r) => { compteurs[r.statut] = (compteurs[r.statut] || 0) + 1; });
  compteurs.progbat_non_lie = progbat_non_lies.length;

  return {
    rapprochements,
    ambiguites: rapprochements.filter((r) => r.statut === STATUTS.ambigu),
    bloques: rapprochements
      .filter((r) => !r.synchronisable)
      .map((r) => ({ id: r.profero.id, code: r.profero.code, libelle_court: r.profero.libelle_court, statut: r.statut, blocages: r.blocages })),
    progbat_non_lies,
    compteurs,
    nb_ouvrages_profero: rapprochements.length,
    nb_structures_progbat: structs.length,
    nb_synchronisables: rapprochements.filter((r) => r.synchronisable).length,
    nb_prets_a_creer: rapprochements.filter((r) => r.pret_a_creer).length,
  };
}

/** Motifs de blocage agrégés : [{ motif, nb }] triés par fréquence. */
export function motifsBlocage(rapprochements = []) {
  const m = new Map();
  (rapprochements || []).forEach((r) => (r.blocages || []).forEach((b) => m.set(b, (m.get(b) || 0) + 1)));
  return [...m.entries()].map(([motif, nb]) => ({ motif, nb })).sort((a, b) => b.nb - a.nb || a.motif.localeCompare(b.motif));
}
