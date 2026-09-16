// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatCadences.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── IMPORT PONCTUEL DES CADENCES PROGBAT → PROFERO : RÈGLES PURES ───────────
// Module PUR (aucun accès réseau ni Supabase, aucune écriture). Il est utilisé :
//   • par l'Edge Function supabase/functions/progbat-library-cadences (copie
//     synchronisée par scripts/sync-progbat-edge-lib.mjs — ne pas éditer la copie) ;
//   • par l'interface (libellés, filtres) ;
//   • par scripts/verif-progbat-cadences.mjs.
//
// Stratégie métier
//   AVANT l'import  : ProGBat détient les cadences les plus fiables.
//   PENDANT l'import : ProGBat sert exceptionnellement de source pour initialiser
//                      bibliotheque_ratios.cadence (heures par unité d'ouvrage).
//   APRÈS l'import  : Profero est la SEULE source de vérité. Aucune synchronisation
//                      automatique ; toute relance repasse par analyse → aperçu → confirmation.
//
// Où ProGBat stocke la cadence (vérifié par GET sur des structures réelles le 16/09/2026,
// documentation https://progbat.readme.io/reference/structure-composition) :
//   • le détail d'une structure (GET /company/library/structures/{id}) n'a AUCUN champ de temps ;
//   • la composition (GET /company/structures/{id}/composition?exploded=true) liste des
//     composants { componentId, componentType, quantity, unitCode, … } ;
//   • le temps de main-d'œuvre est la QUANTITÉ (en heures) des composants qui référencent
//     un « job » horaire (GET /company/jobs : type = 2 et unitCode = H).
//
// Formule retenue
//   cadence ProGBat = Σ quantity des composants tels que
//       componentType === 2
//     ET unitCode normalisé === "H"
//     ET componentId ∈ { jobs ProGBat avec type === 2, unitCode === "H", id entier > 0 }
//     ET quantity nombre fini strictement positif.
//   Jamais déduite d'un prix, d'un coût, d'un libellé, de staffTime (toujours 0 observé)
//   ni d'une conversion jours → heures.
//
// Anomalies bloquantes (l'ouvrage n'est jamais modifié) : composant de type 2 hors des
// jobs horaires valides, job horaire avec une autre unité que H, quantité nulle /
// négative / non numérique, aucun composant de main-d'œuvre horaire, composant qui est
// lui-même une structure (composition non développée) ou de type inconnu, unité de la
// structure différente de celle de l'ouvrage Profero, structure introuvable, doublon de
// liaison, erreur de lecture.

import { parseCodeOuvrage, comparerCodes } from "./codeOuvrage.mjs";

export const METHODE_EXTRACTION = "Somme des jobs horaires — composition développée";
export const ENDPOINT_COMPOSITION = "GET /company/structures/{id}/composition?exploded=true";
/** Seuils d'avertissement : variation > 50 % ou cadence multipliée/divisée par ≥ 2. */
export const SEUIL_ECART_PCT = 50;
export const SEUIL_RATIO = 2;
/** Validité d'un plan d'import préparé (au-delà : relancer l'analyse). */
export const VALIDITE_PLAN_MS = 30 * 60 * 1000;
/** Rôles autorisés à administrer la bibliothèque (analyse ET import). */
export const ROLES_AUTORISES = Object.freeze(["admin", "conducteur"]);
/** Types ProGBat observés : 1 = matériau/élément, 2 = main-d'œuvre (job). 3 est absent de l'énumération des éléments (create-element : 1,2,4,5,6) → réservé aux structures. */
export const TYPE_MAIN_OEUVRE = 2;
export const TYPES_ELEMENTS_CONNUS = Object.freeze([1, 2, 4, 5, 6]);
export const TYPE_STRUCTURE_PRESUME = 3;

export const STATUTS = Object.freeze({
  a_importer: "a_importer",
  identique: "identique",
  non_lie: "non_lie",
  progbat_id_invalide: "progbat_id_invalide",
  structure_introuvable: "structure_introuvable",
  doublon_liaison: "doublon_liaison",
  cadence_absente: "cadence_absente",
  cadence_nulle: "cadence_nulle",
  cadence_negative: "cadence_negative",
  unite_non_convertible: "unite_non_convertible",
  unite_ouvrage_differente: "unite_ouvrage_differente",
  composition_ambigue: "composition_ambigue",
  erreur_lecture: "erreur_lecture",
});

export const STATUTS_LABELS = Object.freeze({
  a_importer: "À importer",
  identique: "Identique",
  non_lie: "Non lié",
  progbat_id_invalide: "Identifiant ProGBat invalide",
  structure_introuvable: "Structure introuvable",
  doublon_liaison: "Doublon de liaison",
  cadence_absente: "Cadence ProGBat absente",
  cadence_nulle: "Cadence ProGBat nulle",
  cadence_negative: "Cadence ProGBat négative",
  unite_non_convertible: "Unité non convertible en heures",
  unite_ouvrage_differente: "Unité de l'ouvrage différente",
  composition_ambigue: "Cadence ambiguë",
  erreur_lecture: "Erreur de lecture",
});

/** Statuts qui comptent comme « non exploitables » (anomalies) dans la synthèse. */
export const STATUTS_ANOMALIES = Object.freeze([
  "progbat_id_invalide", "structure_introuvable", "doublon_liaison", "cadence_absente",
  "cadence_nulle", "cadence_negative", "unite_non_convertible", "unite_ouvrage_differente",
  "composition_ambigue", "erreur_lecture",
]);

const str = (v) => String(v ?? "").trim();
const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

export function num(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Arrondi à 4 décimales (comparaison et stockage des cadences). */
export function arrondirCadence(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** « h », « H », «  H  » → "H" ; tout autre code est rendu normalisé en majuscules. */
export function normaliserUniteHeure(u) {
  return str(u).toUpperCase().replace(/\s+/g, "");
}
export const estUniteHeure = (u) => normaliserUniteHeure(u) === "H";

/** Unité d'ouvrage comparable : « m² » ≡ « m2 » ≡ « M2 » ; « U » ≡ « u ». */
export function cleUniteOuvrage(u) {
  return str(u).toLowerCase().replace(/\s+/g, "").replace(/²/g, "2").replace(/³/g, "3");
}

/** Identifiant ProGBat valide : entier strictement positif (texte ou nombre). */
export function progbatIdValide(v) {
  const s = str(v);
  if (!/^\d{1,12}$/.test(s)) return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Jobs horaires valides : type === 2 ET unitCode === H ET id entier > 0.
 * @returns {{ ids: Set<number>, jobs: Array<{id, code, label, unitCode}>, ignores: Array<{id, raison}> }}
 */
export function jobsHorairesValides(jobs = []) {
  const ids = new Set();
  const valides = [];
  const ignores = [];
  for (const j of Array.isArray(jobs) ? jobs : []) {
    const id = progbatIdValide(j?.id);
    if (id == null) { ignores.push({ id: j?.id ?? null, raison: "identifiant invalide" }); continue; }
    if (Number(j?.type) !== TYPE_MAIN_OEUVRE) { ignores.push({ id, raison: `type ${j?.type ?? "?"} ≠ 2` }); continue; }
    if (!estUniteHeure(j?.unitCode)) { ignores.push({ id, raison: `unité « ${str(j?.unitCode) || "?"} » ≠ H` }); continue; }
    ids.add(id);
    valides.push({ id, code: str(j?.code), label: str(j?.label), unitCode: "H" });
  }
  return { ids, jobs: valides, ignores };
}

/**
 * Extraction de la cadence d'UNE composition ProGBat (déjà développée).
 * @param composition  tableau renvoyé par GET /company/structures/{id}/composition?exploded=true
 * @param ctx.jobsHoraires  Set des identifiants de jobs horaires valides
 * @param ctx.structureIds  Set des identifiants de structures connues (détection d'une sous-structure non développée)
 * @returns {{ ok: boolean, cadence: number|null, statut: string|null, anomalies: string[], avertissements: string[], composants: Array }}
 *   ok = false ⇒ statut ∈ cadence_absente | cadence_nulle | cadence_negative | unite_non_convertible | composition_ambigue | erreur_lecture
 */
export function extraireCadence(composition, { jobsHoraires = new Set(), structureIds = new Set() } = {}) {
  const anomalies = [];
  const avertissements = [];
  const composants = [];
  if (!Array.isArray(composition)) {
    return { ok: false, cadence: null, statut: STATUTS.erreur_lecture, anomalies: ["Composition ProGBat illisible (réponse non tabulaire)"], avertissements, composants };
  }
  let somme = 0;
  let nbMO = 0;
  let ambigu = false;
  let uniteNonConvertible = false;
  let quantiteNulle = false;
  let quantiteNegative = false;

  for (const c of composition) {
    const type = Number(c?.componentType);
    const id = progbatIdValide(c?.componentId);
    const unite = normaliserUniteHeure(c?.unitCode);
    const q = num(c?.quantity);
    const resume = { componentId: id ?? c?.componentId ?? null, componentType: Number.isFinite(type) ? type : null, code: str(c?.componentCode), unitCode: str(c?.unitCode), quantity: q, retenu: false };
    composants.push(resume);

    // Sous-structure non développée : la somme ne peut pas être certaine.
    if (type === TYPE_STRUCTURE_PRESUME || (id != null && structureIds.has(id))) {
      ambigu = true;
      anomalies.push(`Composant ${id ?? "?"} est lui-même une structure : composition non développée`);
      continue;
    }
    if (!Number.isFinite(type) || !TYPES_ELEMENTS_CONNUS.includes(type)) {
      ambigu = true;
      anomalies.push(`Composant ${id ?? "?"} de type inconnu (${c?.componentType ?? "absent"})`);
      continue;
    }
    const jobHoraire = id != null && jobsHoraires.has(id);

    if (type === TYPE_MAIN_OEUVRE) {
      if (!jobHoraire) {
        ambigu = true;
        anomalies.push(`Composant de main-d'œuvre ${id ?? "?"} (${str(c?.componentCode) || "sans code"}) n'est pas un job horaire valide`);
        continue;
      }
      if (unite !== "H") {
        uniteNonConvertible = true;
        anomalies.push(`Job horaire ${id} exprimé en « ${str(c?.unitCode) || "?"} » au lieu de H`);
        continue;
      }
      if (q == null) { ambigu = true; anomalies.push(`Quantité non numérique pour le job horaire ${id}`); continue; }
      if (q === 0) { quantiteNulle = true; anomalies.push(`Quantité nulle pour le job horaire ${id}`); continue; }
      if (q < 0) { quantiteNegative = true; anomalies.push(`Quantité négative (${q}) pour le job horaire ${id}`); continue; }
      somme += q;
      nbMO += 1;
      resume.retenu = true;
      continue;
    }

    // Autres éléments (matériaux, matériel…) : jamais comptés. Un job horaire porté par
    // un composant d'un autre type est une incohérence bloquante.
    if (jobHoraire) {
      ambigu = true;
      anomalies.push(`Job horaire ${id} présent avec le type ${type} (attendu 2)`);
      continue;
    }
    if (unite === "H") avertissements.push(`Composant ${id ?? "?"} de type ${type} exprimé en heures : ignoré (pas un job de main-d'œuvre)`);
  }

  let statut = null;
  if (ambigu) statut = STATUTS.composition_ambigue;
  else if (uniteNonConvertible) statut = STATUTS.unite_non_convertible;
  else if (quantiteNegative && nbMO === 0) statut = STATUTS.cadence_negative;
  else if (quantiteNulle && nbMO === 0) statut = STATUTS.cadence_nulle;
  else if (quantiteNegative || quantiteNulle) statut = STATUTS.composition_ambigue;
  else if (nbMO === 0) { statut = STATUTS.cadence_absente; anomalies.push("Aucun composant de main-d'œuvre horaire dans la composition"); }

  if (statut) return { ok: false, cadence: null, statut, anomalies: uniq(anomalies), avertissements: uniq(avertissements), composants };
  const cadence = arrondirCadence(somme);
  if (cadence == null || cadence <= 0) {
    return { ok: false, cadence: null, statut: STATUTS.cadence_nulle, anomalies: ["Somme des heures nulle"], avertissements: uniq(avertissements), composants };
  }
  return { ok: true, cadence, statut: null, anomalies: [], avertissements: uniq(avertissements), composants, nb_composants_mo: nbMO };
}

/**
 * Écart entre la cadence Profero actuelle et la cadence ProGBat.
 * @returns {{ identique: boolean, ecart: number|null, ecart_pct: number|null, important: boolean, nouvelle: boolean }}
 */
export function comparerCadences(cadenceProfero, cadenceProgbat) {
  const a = arrondirCadence(cadenceProfero);
  const b = arrondirCadence(cadenceProgbat);
  if (b == null) return { identique: false, ecart: null, ecart_pct: null, important: false, nouvelle: false };
  if (a == null || a <= 0) return { identique: false, ecart: b, ecart_pct: null, important: false, nouvelle: true };
  const identique = Math.abs(a - b) < 0.00005;
  if (identique) return { identique: true, ecart: 0, ecart_pct: 0, important: false, nouvelle: false };
  const ecart = Math.round((b - a) * 10000) / 10000;
  const pct = Math.round(((b - a) / a) * 1000) / 10;
  const ratio = b / a;
  const important = Math.abs(pct) > SEUIL_ECART_PCT || ratio >= SEUIL_RATIO || ratio <= 1 / SEUIL_RATIO;
  return { identique: false, ecart, ecart_pct: pct, important, nouvelle: false };
}

/**
 * Construit le plan d'analyse/import à partir des données déjà lues.
 * @param params.ouvrages     lignes bibliotheque_ratios { id, libelle, unite, cadence, progbat_id }
 * @param params.structures   liste ProGBat GET /company/library/structures (id, unitCode, active…) — existence + unité
 * @param params.compositions Map<progbatId, { ok: true, data: [] } | { ok: false, status, message }>
 * @param params.jobs         liste ProGBat GET /company/jobs
 * @param params.preparedAt   ISO
 */
export function construirePlanCadences({ ouvrages = [], structures = [], compositions = new Map(), jobs = [], preparedAt = new Date().toISOString() } = {}) {
  const jh = jobsHorairesValides(jobs);
  const structParId = new Map();
  for (const s of Array.isArray(structures) ? structures : []) {
    const id = progbatIdValide(s?.id);
    if (id != null) structParId.set(id, s);
  }
  const structureIds = new Set(structParId.keys());

  // Doublons de liaison : plusieurs ouvrages Profero → une même structure.
  const parProgbat = new Map();
  for (const o of ouvrages) {
    const id = progbatIdValide(o?.progbat_id);
    if (id == null) continue;
    if (!parProgbat.has(id)) parProgbat.set(id, []);
    parProgbat.get(id).push(o.id);
  }

  const lignes = (Array.isArray(ouvrages) ? ouvrages : []).filter((o) => o && o.id).map((o) => {
    const parsed = parseCodeOuvrage(o.libelle);
    const base = {
      ouvrage_id: o.id,
      code: parsed?.code ?? null,
      libelle: str(o.libelle),
      libelle_court: parsed?.reste ?? str(o.libelle),
      unite: str(o.unite) || null,
      progbat_id: str(o.progbat_id) || null,
      cadence_avant: arrondirCadence(o.cadence),
      cadence_apres: null,
      ecart: null,
      ecart_pct: null,
      ecart_important: false,
      nouvelle_cadence: false,
      methode: null,
      statut: null,
      anomalies: [],
      avertissements: [],
      composants: [],
    };
    const brut = str(o.progbat_id);
    if (!brut) return { ...base, statut: STATUTS.non_lie };
    const pid = progbatIdValide(brut);
    if (pid == null) return { ...base, statut: STATUTS.progbat_id_invalide, anomalies: [`progbat_id « ${brut} » n'est pas un identifiant entier`] };
    if ((parProgbat.get(pid) || []).length > 1) {
      return { ...base, statut: STATUTS.doublon_liaison, anomalies: [`${parProgbat.get(pid).length} ouvrages Profero sont liés à la structure ProGBat ${pid}`] };
    }
    const s = structParId.get(pid);
    if (!s) return { ...base, statut: STATUTS.structure_introuvable, anomalies: [`Structure ProGBat ${pid} absente de la bibliothèque ProGBat`] };
    const avertissements = [];
    if (s.active === false) avertissements.push("Structure ProGBat inactive");
    if (str(s.unitCode) && str(o.unite) && cleUniteOuvrage(s.unitCode) !== cleUniteOuvrage(o.unite)) {
      return { ...base, statut: STATUTS.unite_ouvrage_differente, anomalies: [`Unité ProGBat « ${str(s.unitCode)} » ≠ unité Profero « ${str(o.unite)} » : la cadence par unité n'est pas comparable`], avertissements };
    }
    if (!str(s.unitCode)) avertissements.push("Structure ProGBat sans unité");

    const comp = compositions instanceof Map ? compositions.get(pid) : compositions?.[pid];
    if (!comp) return { ...base, statut: STATUTS.erreur_lecture, anomalies: ["Composition non lue"], avertissements };
    if (comp.ok !== true) {
      if (comp.status === 404) return { ...base, statut: STATUTS.structure_introuvable, anomalies: [`Composition introuvable (404) pour la structure ${pid}`], avertissements };
      return { ...base, statut: STATUTS.erreur_lecture, anomalies: [comp.message || `Lecture de la composition impossible (HTTP ${comp.status ?? "?"})`], avertissements };
    }
    const ext = extraireCadence(comp.data, { jobsHoraires: jh.ids, structureIds });
    if (!ext.ok) return { ...base, statut: ext.statut, anomalies: ext.anomalies, avertissements: [...avertissements, ...ext.avertissements], composants: ext.composants };
    const cmp = comparerCadences(base.cadence_avant, ext.cadence);
    const av = [...avertissements, ...ext.avertissements];
    if (cmp.important) av.push(`Écart important : ${cmp.ecart_pct > 0 ? "+" : ""}${cmp.ecart_pct} %`);
    if (cmp.nouvelle) av.push("Ouvrage Profero sans cadence : la valeur ProGBat sera la première cadence");
    return {
      ...base,
      cadence_apres: ext.cadence,
      ecart: cmp.ecart,
      ecart_pct: cmp.ecart_pct,
      ecart_important: cmp.important,
      nouvelle_cadence: cmp.nouvelle,
      methode: METHODE_EXTRACTION,
      statut: cmp.identique ? STATUTS.identique : STATUTS.a_importer,
      avertissements: uniq(av),
      composants: ext.composants,
    };
  }).sort((a, b) => comparerCodes(a.code || a.libelle, b.code || b.libelle));

  const compteurs = Object.fromEntries(Object.keys(STATUTS).map((k) => [k, 0]));
  for (const l of lignes) compteurs[l.statut] = (compteurs[l.statut] || 0) + 1;
  const synthese = {
    analyses: lignes.length,
    lies: lignes.filter((l) => l.statut !== STATUTS.non_lie).length,
    a_importer: compteurs.a_importer,
    identiques: compteurs.identique,
    non_exploitables: lignes.filter((l) => STATUTS_ANOMALIES.includes(l.statut)).length,
    non_lies: compteurs.non_lie,
    ecarts_importants: lignes.filter((l) => l.statut === STATUTS.a_importer && l.ecart_important).length,
    ecritures: 0,
  };
  return {
    prepared_at: preparedAt,
    methode: METHODE_EXTRACTION,
    endpoint: ENDPOINT_COMPOSITION,
    jobs_horaires: jh.jobs,
    jobs_ignores: jh.ignores,
    lignes,
    compteurs,
    synthese,
    garanties: { ecriture_pendant_analyse: false, ecriture_progbat: false, chiffrages_modifies: false },
  };
}

/** Données figées dans le hash du plan : uniquement ce qui sera écrit. */
export function donneesPourHashCadences(plan) {
  return {
    methode: plan?.methode ?? METHODE_EXTRACTION,
    items: (plan?.lignes || [])
      .filter((l) => l.statut === STATUTS.a_importer)
      .map((l) => ({ ouvrage_id: l.ouvrage_id, progbat_id: l.progbat_id, cadence_avant: l.cadence_avant, cadence_apres: l.cadence_apres }))
      .sort((a, b) => String(a.ouvrage_id).localeCompare(String(b.ouvrage_id))),
  };
}

/** SHA-256 hexadécimal d'une valeur JSON (Deno et Node ≥ 19 : crypto.subtle). */
export async function hacherPlanCadences(plan) {
  const bytes = new TextEncoder().encode(JSON.stringify(donneesPourHashCadences(plan)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lignes du plan à enregistrer côté serveur (sans les composants détaillés, compacts). */
export function itemsPourPlan(plan) {
  return (plan?.lignes || []).map((l) => ({
    ouvrage_id: l.ouvrage_id,
    code: l.code,
    progbat_id: l.progbat_id,
    cadence_avant: l.cadence_avant,
    cadence_apres: l.cadence_apres,
    methode: l.methode,
    statut: l.statut,
    ecart_important: l.ecart_important,
    avertissements: l.avertissements,
    anomalies: l.anomalies,
  }));
}

/** Texte de la confirmation explicite. */
export function texteConfirmation(synthese) {
  const s = synthese || {};
  const nonModifies = (s.non_lies || 0) + (s.non_exploitables || 0);
  return [
    "Importer les cadences ProGBat dans Profero ?",
    "",
    `${s.a_importer || 0} ouvrage(s) seront mis à jour.`,
    `${s.identiques || 0} ouvrage(s) possèdent déjà la même cadence.`,
    `${nonModifies} ouvrage(s) ne seront pas modifiés en raison d'une absence de liaison ou d'une anomalie.`,
    "",
    "Cette opération modifiera uniquement les cadences de la bibliothèque Profero.",
    "Les chiffrages déjà figés ne seront pas recalculés.",
    "Aucune donnée ne sera modifiée dans ProGBat.",
    "",
    "Après cette opération, Profero deviendra la source de vérité pour les cadences.",
  ].join("\n");
}

/** Contrôle de l'appelant : { http, body } si refusé, null si autorisé. */
export function controlerAppelant(appelant) {
  if (!appelant || !str(appelant.email)) return { http: 401, body: { ok: false, code: "non_authentifie", error: "Non authentifié." } };
  if (appelant.actif === false || !appelant.role) return { http: 403, body: { ok: false, code: "acces_refuse", error: "Compte inactif ou sans rôle." } };
  if (appelant.role === "ouvrier") return { http: 403, body: { ok: false, code: "acces_refuse", error: "Import réservé aux utilisateurs du bureau." } };
  if (!ROLES_AUTORISES.includes(appelant.role)) return { http: 403, body: { ok: false, code: "acces_refuse", error: "Import réservé aux administrateurs de la bibliothèque." } };
  return null;
}

/** Format « 2,50 H/U ». */
export function formatCadence(v, unite) {
  const n = num(v);
  if (n == null) return "—";
  const texte = n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return unite ? `${texte} H/${unite}` : `${texte} H`;
}
