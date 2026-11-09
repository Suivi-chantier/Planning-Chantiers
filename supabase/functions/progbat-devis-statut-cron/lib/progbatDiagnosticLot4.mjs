// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatDiagnosticLot4.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// progbatDiagnosticLot4 — vérifications EN LECTURE du lot 4 (Refonte
// Opérations, docs/projets/refonte-operations.md, « À vérifier avant de coder »).
//
// Module PUR : aucun réseau, aucune horloge. La lecture est injectée
// (`lire(chemin, jeton)` → { ok, status, data, message }) ; ce module décide
// QUOI lire et RÉDUIT chaque réponse à sa FORME (noms de champs + type) et à
// quelques valeurs techniques non personnelles (identifiants, type, statut).
// Jamais un nom, une adresse, un e-mail ou un téléphone de client ne sort :
// le diagnostic sert à connaître la structure de l'API, pas les clients.
// Exception assumée : la liste des UTILISATEURS ProGBat (salariés Profero),
// dont le nom et l'e-mail servent à la correspondance managerId ↔ chargé
// d'affaires.
//
// Aucun autre verbe que GET n'est employé : `PLAN_DIAGNOSTIC` ne contient que
// des chemins, et l'adaptateur (Edge Function progbat-devis-statut-cron) ne
// sait faire qu'un GET pour ce diagnostic.
// ─────────────────────────────────────────────────────────────────────────────

import { decouperNomPrenom } from "./progbatNomPrenom.mjs";

/** Champs dont la VALEUR peut sortir (techniques, jamais personnels). */
export const CHAMPS_VALEUR = Object.freeze([
  "id", "type", "legalType", "thirdType", "editable", "canBill", "businessManager", "status", "state", "validated", "thirdId", "businessId", "yardId",
  "quoteId", "managerId", "userId", "companyId", "advanceRate", "prospect", "isProspect",
  "category", "kind", "role", "scope", "scopes", "permissions", "createdAt", "updatedAt",
  "documentDate", "validityDate", "revisionNumber", "parentId", "civility", "country",
  "active", "enabled", "archived", "deleted", "public", "default", "isDefault",
]);

/** Champs dont on compte la répartition des valeurs dans une liste. */
export const CHAMPS_REPARTITION = Object.freeze(["type", "legalType", "thirdType", "status", "state", "validated", "managerId", "prospect", "isProspect", "category", "kind", "civility", "country", "active", "archived"]);

/** Liste des lectures (GET uniquement). `jeton` : "devis" (PROGBAT_PRIVATE_ACCESS_TOKEN) ou "facturation" (PROGBAT_BILLING_ACCESS_TOKEN). */
export const PLAN_DIAGNOSTIC = Object.freeze([
  { cle: "me", chemin: "/me", jetons: ["devis", "facturation"] },
  { cle: "thirds_type_1", chemin: "/company/thirds?type=1", liste: true, jetons: ["devis", "facturation"] },
  { cle: "thirds_type_2", chemin: "/company/thirds?type=2", liste: true, jetons: ["devis", "facturation"] },
  { cle: "thirds_type_3", chemin: "/company/thirds?type=3", liste: true, jetons: ["devis"] },
  { cle: "third_types", chemin: "/company/third-types", liste: true, jetons: ["devis", "facturation"] },
  { cle: "clients_me", chemin: "/clients/me", jetons: ["devis"] },
  { cle: "business_liste", chemin: "/company/business", liste: true, jetons: ["devis", "facturation"] },
  { cle: "business_2", chemin: "/company/business/2", jetons: ["devis", "facturation"] },
  { cle: "business_2_yards", chemin: "/company/business/2/yards", jetons: ["devis", "facturation"] },
  { cle: "yards", chemin: "/company/yards", liste: true, jetons: ["facturation"] },
  { cle: "quote_524", chemin: "/company/quotes/524", jetons: ["devis", "facturation"] },
  { cle: "quotes_liste", chemin: "/company/quotes", liste: true, jetons: ["devis"] },
  { cle: "bills_liste", chemin: "/company/bills", liste: true, jetons: ["facturation", "devis"] },
  { cle: "users", chemin: "/company/users", personnel: true, jetons: ["devis"] },
  { cle: "employees", chemin: "/company/employees", personnel: true, jetons: ["devis"] },
  { cle: "members", chemin: "/company/members", personnel: true, jetons: ["devis"] },
  { cle: "collaborators", chemin: "/company/collaborators", personnel: true, jetons: ["devis"] },
  { cle: "managers", chemin: "/company/managers", personnel: true, jetons: ["devis"] },
  { cle: "staff", chemin: "/company/staff", personnel: true, jetons: ["devis"] },
]);

/** Champs de personnel (salariés) autorisés pour la correspondance managerId. */
export const CHAMPS_PERSONNEL = Object.freeze(["id", "firstname", "lastname", "firstName", "lastName", "email", "role", "active", "userId"]);

const typeDe = (v) => (v === null ? "null" : Array.isArray(v) ? "tableau" : typeof v);

/** Forme d'un objet : { champ: type } ; objets imbriqués décrits sur un niveau. */
export function formeObjet(o, profondeur = 0) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return typeDe(o);
  const f = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v && typeof v === "object" && !Array.isArray(v) && profondeur < 1) f[k] = formeObjet(v, profondeur + 1);
    else if (Array.isArray(v) && v.length && typeof v[0] === "object" && profondeur < 1) f[k] = [formeObjet(v[0], profondeur + 1)];
    else f[k] = typeDe(v);
  }
  return f;
}

/** Valeurs techniques autorisées d'un objet (liste blanche). */
export function valeursTechniques(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const out = {};
  for (const k of CHAMPS_VALEUR) if (k in o && (o[k] === null || typeof o[k] !== "object" || Array.isArray(o[k]))) out[k] = o[k];
  // Code de devis / facture (« D-260264 », « F-… ») : pas une donnée personnelle.
  if (typeof o.code === "string" && /^[A-Z]{1,3}-?\d+$/.test(o.code.trim())) out.code = o.code.trim();
  // Imbriqués : yard / third / business → seulement leurs id
  for (const k of ["yard", "third", "business", "manager"]) {
    if (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) out[`${k}.id`] = o[k].id ?? null;
  }
  // Libellé d'un TYPE de tiers (« Client », « Prospect »…) : pas une donnée personnelle.
  if (typeof o.label === "string" && "canBill" in o) out.label = o.label;
  if (Array.isArray(o.yards)) out["yards.ids"] = o.yards.map((y) => y?.id ?? null);
  return out;
}

/** Répartition des valeurs (CHAMPS_REPARTITION) sur une liste d'objets. */
export function repartition(items) {
  const r = {};
  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    for (const k of CHAMPS_REPARTITION) {
      if (!(k in it)) continue;
      const v = it[k];
      const cle = v === null ? "null" : typeof v === "object" ? "objet" : String(v);
      r[k] = r[k] || {};
      r[k][cle] = (r[k][cle] || 0) + 1;
    }
  }
  return r;
}

/** Longueurs et forme des codes (sans les codes eux-mêmes : ils contiennent des noms). */
export function statsCodes(items) {
  const codes = (items || []).map((i) => (typeof i?.code === "string" ? i.code : null)).filter((c) => c != null);
  if (!codes.length) return null;
  const l = codes.map((c) => c.length);
  return {
    nombre: codes.length, longueur_min: Math.min(...l), longueur_max: Math.max(...l),
    majuscules_chiffres_espaces: codes.filter((c) => /^[A-Z0-9 ]+$/.test(c)).length,
    commence_par_diese: codes.filter((c) => c.startsWith("#")).length,
  };
}

/** Réduit une réponse ProGBat à ce qui peut sortir du diagnostic. */
export function reduireReponse(etape, rep) {
  const base = { status: rep?.status ?? 0, ok: !!rep?.ok };
  if (!rep?.ok) return { ...base, message: String(rep?.message || "").slice(0, 300) };
  const d = rep.data;
  if (etape.personnel) {
    const liste = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : d && typeof d === "object" ? [d] : [];
    return {
      ...base, nombre: liste.length, forme: liste.length ? formeObjet(liste[0]) : null,
      personnes: liste.slice(0, 60).map((p) => Object.fromEntries(CHAMPS_PERSONNEL.filter((k) => p && k in p).map((k) => [k, p[k]]))),
    };
  }
  if (Array.isArray(d)) {
    return {
      ...base, nombre_page: d.length, total: rep.total ?? null,
      forme: d.length ? formeObjet(d[0]) : null,
      repartition: repartition(d),
      codes: statsCodes(d),
      echantillon: d.slice(0, 5).map(valeursTechniques),
    };
  }
  if (d && typeof d === "object") {
    // /me : on cherche tout champ qui ressemble à des droits (scopes)
    const droits = {};
    for (const k of Object.keys(d)) if (/scope|permission|right|droit|grant/i.test(k)) droits[k] = d[k];
    return { ...base, forme: formeObjet(d), valeurs: valeursTechniques(d), droits };
  }
  return { ...base, forme: typeDe(d) };
}

/**
 * Exécute le plan (GET uniquement) et rend un rapport sans donnée personnelle
 * de client. `lire(chemin, jeton, { liste })` est injecté.
 */
export async function diagnostiquer({ lire, jetonsDisponibles = { devis: true, facturation: true }, cles = null }) {
  const rapport = {};
  for (const etape of PLAN_DIAGNOSTIC) {
    if (Array.isArray(cles) && !cles.includes(etape.cle)) continue;
    rapport[etape.cle] = { chemin: etape.chemin };
    for (const j of etape.jetons) {
      if (!jetonsDisponibles[j]) { rapport[etape.cle][j] = { status: null, ok: false, message: "jeton non configuré" }; continue; }
      const rep = await lire(etape.chemin, j, { liste: !!etape.liste });
      rapport[etape.cle][j] = reduireReponse(etape, rep);
    }
  }
  return rapport;
}

// ─── Remplissage des fiches clients ProGBat (demande de Loris du 07/11) ─────
// Pour savoir QUELLES données d'un client ProGBat on peut reprendre : pour
// chaque champ (y compris adresses[] et contacts[]), le nombre de clients où
// il est renseigné. Jamais une valeur : seulement des noms de champs et des
// comptes. Le découpage nom / prénom des particuliers est compté par issue.

const renseigne = (v) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "") && !(Array.isArray(v) && v.length === 0);

/** { "champ": n, "addresses[].email": n, ... } : nombre d'objets où le champ est renseigné. */
export function tauxRemplissage(items) {
  const compte = {};
  const plus = (k, ok) => { compte[k] = compte[k] || 0; if (ok) compte[k]++; };
  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    for (const [k, v] of Object.entries(it)) {
      if (Array.isArray(v)) {
        plus(`${k}[] (au moins un)`, v.length > 0);
        const champs = new Set(v.flatMap((x) => (x && typeof x === "object" ? Object.keys(x) : [])));
        for (const c of champs) plus(`${k}[].${c}`, v.some((x) => x && renseigne(x[c])));
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [c, w] of Object.entries(v)) plus(`${k}.${c}`, renseigne(w));
      } else plus(k, renseigne(v));
    }
  }
  return compte;
}

/** Issue du découpage nom / prénom sur les particuliers (legalType 1) : comptes seulement. */
export function statsDecoupage(items) {
  const r = { particuliers: 0, decoupes: 0, ambigus: {} };
  for (const it of items || []) {
    if (!it || it.legalType !== 1) continue;
    r.particuliers++;
    const d = decouperNomPrenom(it.legalName || it.businessName || "");
    if (d.decoupe) r.decoupes++;
    else r.ambigus[d.raison] = (r.ambigus[d.raison] || 0) + 1;
  }
  return r;
}

/**
 * Lecture du remplissage : liste des clients (type 2), puis le DÉTAIL
 * GET /company/thirds/{id} de chacun (au plus `max`), puis, sur le premier,
 * les sous-ressources éventuelles (contacts, addresses). GET uniquement.
 * `lire(chemin, { liste })` est injecté.
 */
export async function diagnostiquerRemplissageClients({ lire, max = 150, type = 2 }) {
  const l = await lire(`/company/thirds?type=${type}`, { liste: true });
  if (!l?.ok) return { liste: { status: l?.status ?? 0, ok: false, message: String(l?.message || "").slice(0, 300) } };
  const items = Array.isArray(l.data) ? l.data : [];
  const ids = items.map((t) => t?.id).filter((x) => Number.isInteger(x)).slice(0, max);
  const details = [];
  const erreurs = {};
  for (const id of ids) {
    const r = await lire(`/company/thirds/${id}`, { liste: false });
    if (r?.ok && r.data && typeof r.data === "object") details.push(r.data);
    else erreurs[String(r?.status ?? 0)] = (erreurs[String(r?.status ?? 0)] || 0) + 1;
  }
  const sous = {};
  if (ids.length) {
    for (const s of ["contacts", "addresses", "emails", "phones"]) {
      const r = await lire(`/company/thirds/${ids[0]}/${s}`, { liste: false });
      sous[s] = r?.ok ? { status: r.status, ok: true, forme: Array.isArray(r.data) ? (r.data.length ? [formeObjet(r.data[0])] : "tableau vide") : formeObjet(r.data) } : { status: r?.status ?? 0, ok: false };
    }
  }
  const champsListe = new Set(items.flatMap((t) => (t && typeof t === "object" ? Object.keys(t) : [])));
  const champsDetail = new Set(details.flatMap((t) => (t && typeof t === "object" ? Object.keys(t) : [])));
  const premierAvec = (cle) => details.find((d) => Array.isArray(d?.[cle]) && d[cle].length) || items.find((d) => Array.isArray(d?.[cle]) && d[cle].length) || null;
  return {
    total_liste: items.length,
    details_lus: details.length,
    details_en_erreur: erreurs,
    champs_detail_absents_de_la_liste: [...champsDetail].filter((k) => !champsListe.has(k)).sort(),
    forme_contact: premierAvec("contacts") ? formeObjet(premierAvec("contacts").contacts[0]) : null,
    forme_adresse: premierAvec("addresses") ? formeObjet(premierAvec("addresses").addresses[0]) : null,
    remplissage_liste: tauxRemplissage(items),
    remplissage_detail: tauxRemplissage(details),
    remplissage_detail_particuliers: tauxRemplissage(details.filter((d) => d?.legalType === 1)),
    remplissage_detail_societes: tauxRemplissage(details.filter((d) => d?.legalType === 0)),
    legalType: repartition(items).legalType || null,
    decoupage_nom_prenom: statsDecoupage(details.length ? details : items),
    sous_ressources_premier: sous,
  };
}
