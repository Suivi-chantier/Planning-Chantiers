// ─────────────────────────────────────────────────────────────────────────────
// progbatAutomatisation — Refonte Opérations, lot 4 (docs/projets/refonte-operations.md)
// Client ProGBat → chantier ProGBat → devis ; facture d'acompte à la signature ;
// lecture du statut des devis.
//
// Module PUR (aucun réseau, aucune base, aucune horloge propre) : tout accès
// externe est injecté (`depot` = Supabase, `progbat` = API ProGBat). Copié dans
// supabase/functions/progbat-operations/lib/ (le statut du devis, seul, dans
// progbat-devis-statut-cron/lib/ : progbatStatutDevis.mjs)
// par scripts/sync-progbat-edge-lib.mjs (ne pas éditer les copies). Testé dans
// Node par scripts/verif-refonte-lot4.mjs avec un faux client HTTP qui fait
// ÉCHOUER le test si une écriture part sans confirmation ni réservation.
//
// ProGBat est la VRAIE comptabilité : une écriture (POST) ne part que
//   1. sur une action explicite d'un utilisateur du bureau (bouton) ;
//   2. après CONFIRMATION de l'aperçu exact (empreinte `expectedHash` égale à
//      celle recalculée par le serveur au moment de l'écriture) ;
//   3. après RÉSERVATION en base (table progbat_ecritures, index unique partiel
//      (cible, cle) sur creating/created/uncertain) : une seconde réservation
//      concurrente est refusée par la base ;
//   4. jamais rejouée automatiquement : délai dépassé / réseau / 5xx = état
//      « incertain », qui BLOQUE toute nouvelle tentative tant que personne n'a
//      vérifié dans ProGBat (même principe que progbat_quote_exports).
//
// Valeurs relevées EN LECTURE le 06/11/2026 (compte rendu du lot 4) :
//   • /company/third-types : 1 Fournisseur, 2 Client, 3 Sous-traitant, 4 Prospect
//     → un client se crée avec type = 2 (113 clients de type 2 lus).
//   • legalType des 113 clients : 89 en 1 (particuliers, civilité « Mr et Mme »…),
//     24 en 0 (sociétés, civilité « SAS », « SARL »…) ; fournisseurs : tous en 0.
//   • Statut d'un devis (documenté) : 0 étude/brouillon, 1 accepté, 2 refusé, 6 en attente.
//   • POST /company/business : code, label, thirdId, address, postcode, city
//     obligatoires ; country ≤ 3 caractères (« FR ») ; yardLabel facultatif ;
//     la réponse documentée ne contient PAS le yard → relecture de
//     GET /company/business/{id}/yards.
//   • POST /company/quotes/{quoteId}/advance-bill : { advanceRate } (0,01 à 100),
//     réponse = facture brouillon (code provisoire « $… »).
// ─────────────────────────────────────────────────────────────────────────────

import { controlerFiche, genererCodeClient, genererNomChantierProgbat, genererCodeChantierProgbat, chantierDepuisProjet } from "./reglesSaisieProgbat.mjs";
import { etatsEtapesRepris } from "./cycleVieReprise.mjs";
import { STATUTS_DEVIS, STATUT_INTROUVABLE, interpreterStatutDevis, synchroniserStatutsDevis } from "./progbatStatutDevis.mjs";

export { STATUTS_DEVIS, STATUT_INTROUVABLE, interpreterStatutDevis, synchroniserStatutsDevis };

/** Étape « Devis signé » validée ? Même lecture que la fiche chantier (table du lot 3, sinon ancien cycle repris). */
export function devisSigneValide({ lignes = [], meta = null } = {}) {
  return etatsEtapesRepris({ lignes, meta }).etats.devis_signe?.fait === true;
}

export const TYPE_TIERS = Object.freeze({ fournisseur: 1, client: 2, sous_traitant: 3, prospect: 4 });
export const LIBELLES_TYPE_TIERS = Object.freeze({ 1: "Fournisseur", 2: "Client", 3: "Sous-traitant", 4: "Prospect" });
/** legalType ProGBat : 0 = société (personne morale), 1 = particulier. */
export const LEGAL_TYPE = Object.freeze({ societe: 0, particulier: 1 });
export const TAUX_ACOMPTE = 50;

export const CIBLES = Object.freeze(["client", "chantier", "acompte"]);
/** Droit (scope) ProGBat exigé par chaque écriture (documentation officielle). */
export const DROITS = Object.freeze({ client: "thirds.write", chantier: "business.write", acompte: "bills.write" });
export const ENDPOINTS = Object.freeze({
  client: "POST /v2/company/thirds",
  chantier: "POST /v2/company/business",
  acompte: "POST /v2/company/quotes/{quoteId}/advance-bill",
});
export const STATUTS_ECRITURE = Object.freeze(["creating", "created", "failed", "uncertain"]);
export const STATUTS_BLOQUANTS = Object.freeze(["creating", "created", "uncertain"]);
export const DELAI_CREATING_INCERTAIN_MS = 10 * 60 * 1000;
/** Clé planning_config : correspondance chargé d'affaires (utilisateurs.id) → managerId ProGBat. */
export const CLE_MANAGERS = "progbat_correspondance_managers";


export const ACTIONS = Object.freeze([
  "etat", "chercher_clients", "lier_client", "preparer_client", "creer_client",
  "preparer_chantier", "creer_chantier", "relire_chantier",
  "preparer_acompte", "creer_acompte", "statut_devis", "verifier_ecriture",
  "lister_clients_progbat", "importer_client_progbat",
]);
/** Actions qui ne portent pas sur un chiffrage (fiche Opération : choix d'un client ProGBat existant). */
export const ACTIONS_SANS_CHIFFRAGE = Object.freeze(["lister_clients_progbat", "importer_client_progbat"]);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v) => (v == null ? "" : String(v).trim());

/** Identifiant ProGBat : entier strictement positif, sinon null. */
export function idProgbat(v) {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Message court, sans séquence ressemblant à un jeton. */
export function nettoyerMessage(raw) {
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/bearer\s+\S+/gi, "[masqué]").replace(/[A-Za-z0-9_\-.]{24,}/g, "[masqué]").replace(/\s+/g, " ").trim();
  return s.slice(0, 240);
}

// ─── Pays → code ProGBat (« FR ») ────────────────────────────────────────────
const PAYS = Object.freeze({
  france: "FR", belgique: "BE", suisse: "CH", luxembourg: "LU", monaco: "MC",
  espagne: "ES", italie: "IT", allemagne: "DE", portugal: "PT", "royaume uni": "GB", "pays bas": "NL",
});
export function codePays(pays) {
  const brut = str(pays);
  if (!brut) return "FR";                                   // France par défaut (règle du lot 2)
  if (/^[A-Za-z]{2,3}$/.test(brut)) return brut.toUpperCase();
  const cle = brut.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return PAYS[cle] || null;
}

// ─── Normalisations (comparaison EXACTE après normalisation) ────────────────
export function normaliserTexte(s) {
  return str(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\bsaint\b/g, "st").replace(/\bsainte\b/g, "ste");
}
export const normaliserEmail = (s) => str(s).toLowerCase();
export function normaliserTelephone(s) {
  let d = str(s).replace(/[^\d+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  if (d.startsWith("0033")) d = "0" + d.slice(4);
  return d.replace(/\D/g, "");
}
const mots = (s) => normaliserTexte(s).split(" ").filter((m) => m.length >= 3);

// ─── Tiers ProGBat → résumé affichable ──────────────────────────────────────
/** Résumé d'un tiers ProGBat (pour proposer une correspondance). */
export function resumerTiers(t = {}) {
  if (t && typeof t.type_libelle === "string") return t;            // déjà résumé (liste servie au navigateur)
  const adresses = Array.isArray(t.addresses) ? t.addresses : [];
  const a = adresses.find((x) => x?.byDefault) || adresses[0] || {};
  const contacts = Array.isArray(t.contacts) ? t.contacts : [];
  const c = contacts.find((x) => x?.byDefault) || contacts[0] || {};
  return {
    id: idProgbat(t.id),
    code: str(t.code),
    type: Number.isInteger(t.type) ? t.type : null,
    type_libelle: LIBELLES_TYPE_TIERS[t.type] || `type ${t.type ?? "?"}`,
    nom: str(t.legalName) || str(t.businessName),
    societe: str(t.businessName),
    adresse: str(a.address), code_postal: str(a.postcode), ville: str(a.city),
    email: str(a.email) || str(c.email),
    telephone: str(a.phone) || str(a.mobile) || str(c.phone) || str(c.mobile),
  };
}

const PAYS_LIBELLE = Object.freeze({ FR: "France", BE: "Belgique", CH: "Suisse", LU: "Luxembourg", MC: "Monaco", ES: "Espagne", IT: "Italie", DE: "Allemagne", PT: "Portugal", GB: "Royaume-Uni", NL: "Pays-Bas" });

/**
 * Fiche client locale (table clients) pré-remplie depuis un client ProGBat
 * EXISTANT choisi par l'utilisateur (demande de Loris du 06/11 : les clients
 * existent déjà dans ProGBat, ne pas les recréer). Rien n'est deviné : le nom
 * ProGBat d'un particulier (« Mr et Mme DUPONT », « DUPONT Jean »…) n'a pas de
 * forme fixe, il va entier dans « nom » et le prénom reste à compléter si les
 * règles l'exigent. L'identifiant ProGBat (code) est repris tel quel.
 * → { fiche, manquants }
 */
export function ficheDepuisTiers(t = {}) {
  const adresses = Array.isArray(t.addresses) ? t.addresses : [];
  const a = adresses.find((x) => x?.byDefault) || adresses[0] || {};
  const contacts = Array.isArray(t.contacts) ? t.contacts : [];
  const c = contacts.find((x) => x?.byDefault) || contacts[0] || {};
  const societe = t.legalType === LEGAL_TYPE.societe;
  const pays = str(a.country);
  const fiche = {
    type: societe ? "societe" : "particulier",
    nom: societe ? "" : str(t.legalName) || str(c.lastname),
    prenom: "",
    raison_sociale: societe ? (str(t.businessName) || str(t.legalName)) : "",
    contact_nom: societe ? str(c.lastname) : "",
    adresse: str(a.address), adresse_complement: str(a.address2),
    code_postal: str(a.postcode), ville: str(a.city),
    pays: PAYS_LIBELLE[pays.toUpperCase()] || pays || "France",
    email: str(a.email) || str(c.email),
    telephone: str(a.phone) || str(a.mobile) || str(c.phone) || str(c.mobile),
    code_progbat: str(t.code),
    progbat_client_id: idProgbat(t.id) != null ? String(idProgbat(t.id)) : null,
  };
  return { fiche, manquants: controlerFiche("client", fiche) };
}

/**
 * Correspondances possibles entre une fiche client Profero et les tiers
 * ProGBat. Ce ne sont QUE des propositions : rien n'est jamais rattaché sans
 * un choix explicite de l'utilisateur. Critères (égalité après normalisation,
 * jamais une « ressemblance ») : identifiant « NOM VILLE », e-mail, téléphone,
 * adresse + code postal, nom complet ; plus faible : nom de famille / raison
 * sociale présent dans le nom ProGBat.
 */
export function chercherCorrespondances(client = {}, tiers = []) {
  const societe = client.type === "societe";
  const code = normaliserTexte(genererCodeClient(client));
  const email = normaliserEmail(client.email);
  const tel = normaliserTelephone(client.telephone);
  const adresse = normaliserTexte(client.adresse);
  const cp = str(client.code_postal).replace(/\s+/g, "");
  const nomComplet = normaliserTexte(societe ? client.raison_sociale : `${client.nom} ${client.prenom}`);
  const nomInverse = normaliserTexte(societe ? client.raison_sociale : `${client.prenom} ${client.nom}`);
  const famille = mots(societe ? client.raison_sociale : client.nom);
  const out = [];
  for (const t of tiers || []) {
    const r = resumerTiers(t);
    if (r.id == null) continue;
    const raisons = [];
    let fortes = 0;
    if (code && normaliserTexte(r.code) === code) { raisons.push("même identifiant ProGBat (« NOM VILLE »)"); fortes++; }
    if (email && normaliserEmail(r.email) === email) { raisons.push("même e-mail"); fortes++; }
    if (tel && tel.length >= 9 && normaliserTelephone(r.telephone) === tel) { raisons.push("même téléphone"); fortes++; }
    if (adresse && cp && normaliserTexte(r.adresse) === adresse && r.code_postal.replace(/\s+/g, "") === cp) { raisons.push("même adresse"); fortes++; }
    const nomT = normaliserTexte(r.nom);
    const nomS = normaliserTexte(r.societe);
    if (nomComplet && (nomT === nomComplet || nomT === nomInverse || nomS === nomComplet)) { raisons.push("même nom"); fortes++; }
    else if (famille.length) {
      const motsT = new Set([...mots(r.nom), ...mots(r.societe), ...mots(r.code)]);
      if (famille.every((m) => motsT.has(m))) raisons.push(societe ? "raison sociale présente dans le nom ProGBat" : "nom de famille présent dans le nom ProGBat");
    }
    if (raisons.length) out.push({ ...r, raisons, force: fortes });
  }
  return out.sort((a, b) => b.force - a.force || b.raisons.length - a.raisons.length || a.nom.localeCompare(b.nom, "fr")).slice(0, 12);
}

// ─── Corps des écritures (construits ici, jamais par le navigateur) ─────────
/** Corps de POST /company/thirds pour une fiche client Profero (table clients). */
export function construireCorpsClient(client = {}) {
  const erreurs = controlerFiche("client", client).map((m) => m.message);
  const societe = client.type === "societe";
  const code = genererCodeClient(client);
  if (!code) erreurs.push("Identifiant ProGBat du client impossible à générer (nom ou ville manquant)");
  const pays = codePays(client.pays);
  if (!pays) erreurs.push(`Pays du client non reconnu (« ${str(client.pays)} ») : indiquer France ou un code pays (FR, BE…)`);
  const legalName = societe ? str(client.raison_sociale) : [str(client.nom), str(client.prenom)].filter(Boolean).join(" ");
  const contactNom = societe ? str(client.contact_nom) : legalName;
  const adresse = {
    label: "Adresse principale", byDefault: true,
    address: str(client.adresse), postcode: str(client.code_postal), city: str(client.ville), country: pays || "",
  };
  if (str(client.adresse_complement)) adresse.address2 = str(client.adresse_complement);
  if (str(client.telephone)) adresse.phone = str(client.telephone);
  if (str(client.email)) adresse.email = str(client.email);
  const corps = {
    code, type: TYPE_TIERS.client, legalType: societe ? LEGAL_TYPE.societe : LEGAL_TYPE.particulier,
    legalName, address: adresse,
  };
  if (societe) corps.businessName = str(client.raison_sociale);
  if (contactNom) {
    corps.contact = { byDefault: true, lastname: contactNom };
    if (str(client.email)) corps.contact.email = str(client.email);
    if (str(client.telephone)) corps.contact.phone = str(client.telephone);
  }
  return { ok: erreurs.length === 0, corps, erreurs };
}

/**
 * Corps de POST /company/business (le « chantier ProGBat »).
 *   thirdId  : client ProGBat (obligatoire, déjà créé ou choisi)
 *   projet   : chiffrage (adresse du chantier, référence du logement)
 *   client   : fiche client (pour le libellé « client — logement » et le code)
 *   managerId: correspondance connue du chargé d'affaires, sinon null (créé sans)
 */
export function construireCorpsChantier({ thirdId = null, projet = {}, client = {}, clientAffichage = "", managerId = null } = {}) {
  const erreurs = [];
  const tid = idProgbat(thirdId);
  if (tid == null) erreurs.push("Client ProGBat du chantier inconnu : créer ou choisir d'abord le client ProGBat");
  const reference = str(projet.logement_reference);
  const fiche = chantierDepuisProjet(projet, { referenceLogement: reference });
  controlerFiche("chantier", { ...fiche, chantier_id: "x", charge_affaires_id: "x" }).forEach((m) => erreurs.push(m.message));
  const codeClient = genererCodeClient(client);
  const code = genererCodeChantierProgbat({ codeClient, reference });
  const label = genererNomChantierProgbat({ clientAffichage, reference });
  if (!code) erreurs.push("Code du chantier ProGBat impossible à générer (identifiant client ou référence du logement manquant)");
  if (!label) erreurs.push("Nom du chantier ProGBat impossible à générer");
  const pays = codePays(projet.chantier_pays);
  if (!pays) erreurs.push(`Pays du chantier non reconnu (« ${str(projet.chantier_pays)} »)`);
  const corps = {
    code, label, thirdId: tid ?? 0,
    address: fiche.adresse, postcode: fiche.code_postal, city: fiche.ville, country: pays || "FR",
    // Le yard (chantier technique) est demandé en même temps ; s'il n'est pas
    // renvoyé, il est relu (GET /company/business/{id}/yards).
    yardLabel: reference || label,
  };
  if (str(projet.chantier_adresse_complement)) corps.address2 = str(projet.chantier_adresse_complement);
  const mid = idProgbat(managerId);
  if (mid != null) corps.managerId = mid;
  return { ok: erreurs.length === 0, corps, erreurs, sans_responsable: mid == null };
}

/** Corps de POST /company/quotes/{quoteId}/advance-bill. */
export function construireCorpsAcompte() {
  return { advanceRate: TAUX_ACOMPTE };
}

/** Empreinte stable d'un corps (confirmation de l'aperçu). Pure : FNV-1a 64 bits sur la sérialisation canonique. */
export function serialiserCanonique(v) {
  if (Array.isArray(v)) return `[${v.map(serialiserCanonique).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${serialiserCanonique(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
export function empreinte(cible, corps) {
  const s = `${cible}|${serialiserCanonique(corps)}`;
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * prime) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, "0");
}

// ─── Réponses ProGBat ────────────────────────────────────────────────────────
/** Issue d'une écriture : created | uncertain | failed (mêmes règles que le devis). */
export function classerResultat(rep) {
  if (rep?.ok) return idProgbat(rep?.data?.id) != null ? "created" : "uncertain";
  if (rep?.timeout || rep?.reseau || !rep?.status || rep.status >= 500) return "uncertain";
  return "failed";
}

/** Message affiché tel quel à l'utilisateur pour un échec ProGBat. */
export function messageEchec(cible, rep) {
  const s = Number(rep?.status) || 0;
  const detail = nettoyerMessage(rep?.message || "");
  if (s === 403) return `Droit ProGBat manquant : ${DROITS[cible]} (ProGBat a répondu 403${detail ? ` : ${detail}` : ""}). À faire par Loris : ajouter ce droit à l'application ProGBat de Profero.`;
  if (s === 401) return "Jeton ProGBat refusé (401) : jeton invalide, expiré ou révoqué.";
  if (s === 400 || s === 422) return `ProGBat a refusé les informations envoyées (${s})${detail ? ` : ${detail}` : ""}.`;
  if (s === 404) return `ProGBat ne trouve pas la ressource (404)${detail ? ` : ${detail}` : ""}.`;
  if (s === 409) return `ProGBat signale un conflit (409)${detail ? ` : ${detail}` : ""}.`;
  if (s === 429) return "ProGBat limite les appels (429) : réessayer dans quelques minutes.";
  if (rep?.timeout) return "ProGBat n'a pas répondu à temps : on ne sait pas si l'écriture a eu lieu. Vérifier dans ProGBat avant toute nouvelle tentative.";
  if (rep?.reseau || !s) return "Connexion à ProGBat interrompue : on ne sait pas si l'écriture a eu lieu. Vérifier dans ProGBat avant toute nouvelle tentative.";
  if (s >= 500) return `ProGBat indisponible (${s}) : on ne sait pas si l'écriture a eu lieu. Vérifier dans ProGBat avant toute nouvelle tentative.`;
  return `Réponse inattendue de ProGBat (${s})${detail ? ` : ${detail}` : ""}.`;
}

/** Yard d'un chantier ProGBat, depuis la réponse de création ou la relecture des yards. */
export function extraireYard({ reponse = null, yards = null, yardLabel = "" } = {}) {
  const direct = idProgbat(reponse?.yardId) ?? idProgbat(reponse?.yard?.id) ?? (Array.isArray(reponse?.yards) && reponse.yards.length === 1 ? idProgbat(reponse.yards[0]?.id) : null);
  if (direct != null) {
    const y = Array.isArray(reponse?.yards) ? reponse.yards[0] : reponse?.yard;
    return { yardId: direct, label: str(y?.label) || str(reponse?.yardLabel) || str(yardLabel), numero: str(y?.publicYardNumber) || null, source: "reponse" };
  }
  const liste = (Array.isArray(yards) ? yards : []).filter((y) => idProgbat(y?.id) != null);
  if (liste.length === 1) return { yardId: idProgbat(liste[0].id), label: str(liste[0].label), numero: str(liste[0].publicYardNumber) || null, source: "relecture" };
  if (liste.length > 1) {
    const meme = liste.filter((y) => normaliserTexte(y.label) === normaliserTexte(yardLabel));
    if (meme.length === 1) return { yardId: idProgbat(meme[0].id), label: str(meme[0].label), numero: str(meme[0].publicYardNumber) || null, source: "relecture" };
    return { yardId: null, raison: `${liste.length} chantiers techniques (yards) sur ce chantier ProGBat : aucun ne porte le libellé attendu, choix impossible sans vous.` };
  }
  return { yardId: null, raison: "ProGBat n'a renvoyé aucun chantier technique (yard) pour ce chantier : relire plus tard (bouton « Relire le chantier ProGBat »)." };
}

// ─── Statut du devis ProGBat ─────────────────────────────────────────────────

/**
 * Ce que l'écran dit du statut lu dans ProGBat.
 *   statut         : valeur lue (progbat_devis_statut) ou null si jamais lue
 *   devisSigneFait : étape « Devis signé » validée dans l'application
 *   perdu          : chantier marqué perdu
 * → { niveau: "info"|"alerte"|null, message, action: "importer_signe"|"marquer_perdu"|null }
 */
export function decisionStatutDevis({ statut = null, devisSigneFait = false, perdu = false, luLe = null } = {}) {
  if (statut == null) return { niveau: null, message: "Statut du devis dans ProGBat : pas encore lu (lecture automatique toutes les heures en journée).", action: null };
  const s = interpreterStatutDevis(statut);
  const quand = luLe ? ` (lu le ${String(luLe).slice(0, 10).split("-").reverse().join("/")})` : "";
  if (s.code === "introuvable") return { niveau: "alerte", message: `Devis introuvable dans ProGBat${quand} : il a peut-être été supprimé. Vérifier dans ProGBat.`, action: null };
  if (s.code === "accepte" && !devisSigneFait) return { niveau: "alerte", message: `Devis accepté dans ProGBat${quand} : importer le devis signé.`, action: "importer_signe" };
  if (s.code === "refuse" && !perdu && !devisSigneFait) return { niveau: "alerte", message: `Devis refusé dans ProGBat${quand} : si l'affaire est perdue, utiliser « Marquer perdu ».`, action: "marquer_perdu" };
  return { niveau: "info", message: `Statut du devis dans ProGBat : ${s.libelle}${quand}.`, action: null };
}

// ─── Réservations (table progbat_ecritures) ──────────────────────────────────
export function resumerEcriture(e, maintenant = null) {
  if (!e) return null;
  let statut = e.statut;
  if (statut === "creating" && maintenant instanceof Date) {
    const debut = e.started_at ? new Date(e.started_at).getTime() : NaN;
    if (Number.isFinite(debut) && maintenant.getTime() - debut > DELAI_CREATING_INCERTAIN_MS) statut = "uncertain";
  }
  return {
    id: e.id ?? null, cible: e.cible, cle: e.cle, statut, statut_enregistre: e.statut,
    progbat_id: e.progbat_id ?? null, progbat_code: e.progbat_code ?? null,
    http_status: e.http_status ?? null, message: e.message ? nettoyerMessage(e.message) : null,
    started_at: e.started_at ?? null, finished_at: e.finished_at ?? null, created_by_email: e.created_by_email ?? null,
  };
}

export function evaluerBlocage(cible, derniere, { dejaLie = null } = {}) {
  if (dejaLie != null) return { bloque: true, code: "deja_lie", message: `Déjà relié à ProGBat (identifiant ${dejaLie}) : aucune nouvelle création.` };
  if (!derniere) return { bloque: false };
  if (derniere.statut === "uncertain") return { bloque: true, code: "etat_incertain", message: `Une tentative précédente (${cible}) est dans un état incertain : vérifier dans ProGBat avant toute nouvelle création (bouton « J'ai vérifié dans ProGBat »).` };
  if (derniere.statut === "creating") return { bloque: true, code: "creation_en_cours", message: "Une création est déjà en cours." };
  if (derniere.statut === "created") return { bloque: true, code: "deja_cree", message: `Déjà créé dans ProGBat (identifiant ${derniere.progbat_id ?? "?"}).` };
  return { bloque: false };
}

// ─── Contexte d'un chiffrage ─────────────────────────────────────────────────
/** Client effectif d'un chantier : celui du chantier, sinon celui de l'opération. */
export function clientEffectifId(chantier = {}, operation = {}) {
  return str(chantier?.client_id) || str(operation?.client_id) || null;
}
export function chargeAffairesEffectifId(chantier = {}, operation = {}) {
  return str(chantier?.charge_affaires_id) || str(operation?.charge_affaires_id) || null;
}
export function affichageClient(c = {}) {
  if (!c) return "";
  if (c.type === "societe") return str(c.raison_sociale);
  return [str(c.nom), str(c.prenom)].filter(Boolean).join(" ");
}

/**
 * État des trois étapes pour un chiffrage (aucune écriture).
 *   ctx = { projet, chantier, operation, client, ecritures: { client, chantier, acompte }, managers }
 */
export function etatEtapes(ctx = {}, maintenant = null) {
  const { projet = null, chantier = null, client = null } = ctx;
  const thirdId = idProgbat(client?.progbat_client_id);
  const businessId = idProgbat(chantier?.progbat_business_id);
  const yardId = idProgbat(chantier?.progbat_yard_id);
  const quoteId = idProgbat(projet?.progbat_devis_id);
  const managerId = idProgbat((ctx.managers || {})[chargeAffairesEffectifId(chantier, ctx.operation)]);
  const res = (c) => resumerEcriture(ctx.ecritures?.[c], maintenant);
  const etapes = {
    client: {
      fait: thirdId != null, thirdId, ecriture: res("client"),
      prerequis: !chantier ? "Chiffrage non rattaché à un chantier." : !client ? "Aucune fiche client sur le chantier ni sur l'opération." : null,
    },
    chantier: {
      fait: businessId != null, businessId, yardId, code: str(chantier?.progbat_business_code) || null, ecriture: res("chantier"),
      managerId, sans_responsable: managerId == null,
      prerequis: thirdId == null ? "Créer ou choisir d'abord le client ProGBat." : null,
    },
    devis: {
      fait: quoteId != null, quoteId,
      prerequis: thirdId == null || businessId == null ? "Le devis se crée après le client et le chantier ProGBat." : null,
    },
  };
  if (businessId != null && yardId == null) etapes.chantier.alerte = "Chantier ProGBat créé, mais son chantier technique (yard) n'est pas encore connu : « Relire le chantier ProGBat ».";
  return etapes;
}

/** Colonnes à reporter sur les chiffrages du chantier (sans devis) pour que le devis porte thirdId / businessId / yardId. */
export function reportProjets(projets = [], { thirdId = null, businessId = null, yardId = null } = {}) {
  const patch = {};
  if (idProgbat(thirdId) != null) patch.progbat_client_id = String(idProgbat(thirdId));
  if (idProgbat(businessId) != null) patch.progbat_business_id = String(idProgbat(businessId));
  if (idProgbat(yardId) != null) patch.progbat_yard_id = String(idProgbat(yardId));
  if (!Object.keys(patch).length) return [];
  return (projets || [])
    .filter((p) => p?.id && !str(p.progbat_devis_id))           // un devis déjà créé garde ses identifiants
    .map((p) => {
      const delta = {};
      for (const [k, v] of Object.entries(patch)) if (str(p[k]) !== v) delta[k] = v;
      return { id: p.id, patch: delta };
    })
    .filter((x) => Object.keys(x.patch).length);
}

// ─── Contrôle de l'appelant ──────────────────────────────────────────────────
export function controlerAppelant(appelant) {
  if (!appelant || !str(appelant.email)) return { http: 401, body: { ok: false, code: "non_authentifie", error: "Non authentifié." } };
  if (appelant.actif === false || appelant.role === "ouvrier" || !appelant.role) {
    return { http: 403, body: { ok: false, code: "acces_refuse", error: "Réservé aux utilisateurs du bureau." } };
  }
  return null;
}

// ─── Écriture protégée : réservation → POST → enregistrement ─────────────────
/**
 * Le SEUL chemin par lequel une écriture ProGBat peut partir.
 *   cible, cle   : clé de réservation (client.id, chantier.id, quoteId)
 *   corps        : corps du POST (déjà construit et confirmé)
 *   envoyer()    : fait le POST (adaptateur), appelé UNE fois au plus
 * → { statut, rep, reservationId, message }
 */
export async function ecrireAvecReservation({ cible, cle, corps, hash, appelant, depot, envoyer, maintenant }) {
  const reservation = await depot.reserverEcriture({
    cible, cle: String(cle), statut: "creating", payload_hash: hash,
    created_by: appelant?.id ?? null, created_by_email: str(appelant?.email) || null,
    started_at: maintenant.toISOString(), details: { endpoint: ENDPOINTS[cible] },
  });
  if (!reservation?.ok) {
    return {
      statut: "refuse",
      message: reservation?.conflit
        ? "Une autre création est en cours ou a déjà eu lieu pour cet élément (réservation refusée par la base) : rien n'a été envoyé à ProGBat."
        : `Réservation impossible (${nettoyerMessage(reservation?.erreur)}) : rien n'a été envoyé à ProGBat.`,
    };
  }
  const rep = await envoyer(corps);
  const statut = classerResultat(rep);
  const fin = new Date(maintenant.getTime()).toISOString();
  const patch = {
    statut, http_status: rep?.status ?? null, finished_at: fin,
    progbat_id: statut === "created" ? idProgbat(rep.data.id) : null,
    progbat_code: statut === "created" ? (str(rep.data.code) || null) : null,
    message: statut === "created" ? null : messageEchec(cible, rep),
  };
  const maj = await depot.majEcriture(reservation.id, patch);
  if (!maj?.ok && statut === "created") {
    // Créé dans ProGBat mais pas noté : on le dit, on ne rejoue rien.
    return { statut: "uncertain", rep, reservationId: reservation.id, message: `Créé dans ProGBat (identifiant ${patch.progbat_id}) mais l'enregistrement dans Profero a échoué : NE PAS recréer, signaler l'identifiant ${patch.progbat_id}.` };
  }
  return { statut, rep, reservationId: reservation.id, message: patch.message, progbat_id: patch.progbat_id, progbat_code: patch.progbat_code };
}

// ─── Point d'entrée de l'Edge Function progbat-operations ────────────────────
/**
 * depot (async) :
 *   chargerContexte(projectId) → { projet, chantier, operation, client, projetsChantier } | null
 *   dernieresEcritures({ client, chantier, acompte }) → { client, chantier, acompte } (lignes progbat_ecritures)
 *   lireManagers() → { [utilisateurId]: managerId }
 *   reserverEcriture(ligne) → { ok, id } | { ok: false, conflit? , erreur? }
 *   majEcriture(id, patch) → { ok }
 *   lierClient(clientId, thirdId) → { ok }
 *   lierChantier(chantierId, { businessId, yardId, code }) → { ok }
 *   enregistrerYard(chantierId, { yardId, label, numero }) → { ok }
 *   majProjets([{ id, patch }]) → { ok }
 *   majProjet(projectId, patch) → { ok }
 *   cycleVieChantier(chantierId) → { lignes (chantier_cycle_vie), meta (phasage) }
 *   facturesAcompteConnues(quoteId) → [{ progbat_bill_id, numero }]
 * progbat :
 *   lireTiers(type) → { ok, items } | { ok: false, status, message }
 *   lireTiersUn(id) → { ok, data } | ...
 *   creerTiers(corps) → réponse POST
 *   creerAffaire(corps) → réponse POST
 *   lireYards(businessId) → { ok, items } | ...
 *   lireDevis(quoteId) → { ok, data } | ...
 *   facturesDuDevis(quoteId) → { ok, items } | ...   (lecture des factures)
 *   creerAcompte(quoteId, corps) → réponse POST
 */
export async function traiterRequeteAutomatisation(requete = {}, { appelant, depot, progbat, maintenant = null } = {}) {
  if (!(maintenant instanceof Date)) return { http: 500, body: { ok: false, code: "horloge_absente", error: "Date du serveur non fournie." } };
  const refus = controlerAppelant(appelant);
  if (refus) return refus;
  const action = str(requete.action);
  if (!ACTIONS.includes(action)) return { http: 400, body: { ok: false, code: "action_invalide", error: `Action inconnue (${ACTIONS.join(", ")}).` } };
  if (progbat?.jetonPresent === false) return { http: 500, body: { ok: false, code: "secret_absent", error: "Jeton ProGBat non configuré côté serveur : aucune opération possible." } };
  if (ACTIONS_SANS_CHIFFRAGE.includes(action)) return traiterClientsProgbat(action, requete, { appelant, depot, progbat });
  const projectId = str(requete.projectId);
  if (!RE_UUID.test(projectId)) return { http: 400, body: { ok: false, code: "project_id_invalide", error: "projectId manquant ou invalide." } };

  const ctx = await depot.chargerContexte(projectId);
  if (!ctx?.projet) return { http: 404, body: { ok: false, code: "projet_introuvable", error: "Chiffrage introuvable." } };
  const { projet, chantier, operation, client } = ctx;
  const quoteId = idProgbat(projet.progbat_devis_id);
  const cles = {
    client: client?.id ? String(client.id) : null,
    chantier: chantier?.id ? String(chantier.id) : null,
    acompte: quoteId != null ? String(quoteId) : null,
  };
  const ecritures = { ...((await depot.dernieresEcritures(cles)) || {}) };
  // Après une écriture : relire les réservations pour que l'écran montre le vrai état.
  const rafraichir = async () => { Object.assign(ecritures, (await depot.dernieresEcritures(cles)) || {}); };
  const managers = (await depot.lireManagers?.()) || {};
  const etat = () => etatEtapes({ ...ctx, ecritures, managers }, maintenant);
  const ok = (extra = {}, journal = {}) => ({ http: 200, body: { ok: true, action, etapes: etat(), ...extra }, journal: { action, projectId, ...journal } });
  const non = (code, error, extra = {}) => ({ http: 200, body: { ok: false, action, code, error, aucune_ecriture: true, etapes: etat(), ...extra }, journal: { action, projectId, refus: code } });

  // ── état (aucune écriture ProGBat) ; report des identifiants sur les chiffrages sans devis
  if (action === "etat") {
    const report = reportProjets(ctx.projetsChantier || [projet], {
      thirdId: client?.progbat_client_id, businessId: chantier?.progbat_business_id, yardId: chantier?.progbat_yard_id,
    });
    if (report.length) await depot.majProjets(report);
    const generes = {
      code_client: genererCodeClient(client || {}),
      nom_chantier: genererNomChantierProgbat({ clientAffichage: affichageClient(client), reference: str(projet.logement_reference) }),
      code_chantier: genererCodeChantierProgbat({ codeClient: genererCodeClient(client || {}), reference: str(projet.logement_reference) }),
    };
    return ok({ aucune_ecriture_progbat: true, generes, report_projets: report.length, statut_devis: projet.progbat_devis_statut ?? null });
  }

  // ── recherche des clients ProGBat (lecture seule) ──
  if (action === "chercher_clients") {
    if (!client) return non("client_absent", "Aucune fiche client sur ce chantier ni sur son opération : la choisir ou la créer d'abord (parcours de chiffrage).");
    const lus = [];
    for (const type of [TYPE_TIERS.client, TYPE_TIERS.prospect]) {
      const r = await progbat.lireTiers(type);
      if (!r?.ok) return non("lecture_impossible", `Lecture des clients ProGBat impossible : ${r?.status === 403 ? `droit ProGBat manquant : thirds.read (403)` : nettoyerMessage(r?.message) || `erreur ${r?.status ?? "réseau"}`}. Aucune création possible tant que la recherche n'a pas pu se faire.`, { progbat_status: r?.status ?? null });
      lus.push(...(r.items || []));
    }
    const correspondances = chercherCorrespondances(client, lus);
    return ok({ aucune_ecriture: true, correspondances, nb_lus: lus.length, client_profero: { id: client.id, affichage: affichageClient(client), code_genere: genererCodeClient(client) } }, { nb: correspondances.length });
  }

  // ── rattacher un client ProGBat EXISTANT choisi par l'utilisateur (aucune écriture ProGBat) ──
  if (action === "lier_client") {
    if (!client) return non("client_absent", "Aucune fiche client sur ce chantier ni sur son opération.");
    if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
    const tid = idProgbat(requete.thirdId);
    if (tid == null) return non("third_id_invalide", "Client ProGBat non choisi.");
    const dejaLie = idProgbat(client.progbat_client_id);
    if (dejaLie != null && dejaLie !== tid) return non("deja_lie", `Cette fiche client est déjà reliée au client ProGBat ${dejaLie} : rien n'est changé.`);
    const lu = await progbat.lireTiersUn(tid);
    if (!lu?.ok) return non("tiers_introuvable", `Client ProGBat ${tid} illisible (${lu?.status ?? "réseau"}${lu?.message ? ` : ${nettoyerMessage(lu.message)}` : ""}) : rien n'est relié.`);
    const t = lu.data || {};
    if (![TYPE_TIERS.client, TYPE_TIERS.prospect].includes(t.type)) return non("type_tiers", `Le tiers ProGBat ${tid} n'est ni un client ni un prospect (${LIBELLES_TYPE_TIERS[t.type] || t.type}) : rien n'est relié.`);
    const r = await depot.lierClient(client.id, tid);
    if (!r?.ok) return non("enregistrement_impossible", `Enregistrement impossible : ${nettoyerMessage(r?.erreur)}`);
    client.progbat_client_id = String(tid);
    const report = reportProjets(ctx.projetsChantier || [projet], { thirdId: tid, businessId: chantier?.progbat_business_id, yardId: chantier?.progbat_yard_id });
    if (report.length) await depot.majProjets(report);
    return ok({ aucune_ecriture_progbat: true, thirdId: tid, message: `Fiche client reliée au client ProGBat existant ${resumerTiers(t).nom || tid} (n° ${tid}). Rien n'a été créé dans ProGBat.` }, { thirdId: tid });
  }

  // ── client : aperçu puis création ──
  if (action === "preparer_client" || action === "creer_client") {
    if (!client) return non("client_absent", "Aucune fiche client sur ce chantier ni sur son opération.");
    const c = construireCorpsClient(client);
    const hash = empreinte("client", c.corps);
    const blocage = evaluerBlocage("client", resumerEcriture(ecritures.client, maintenant), { dejaLie: idProgbat(client.progbat_client_id) });
    if (action === "preparer_client") {
      return ok({ aucune_ecriture: true, corps: c.corps, erreurs: c.erreurs, hash, blocage: blocage.bloque ? blocage : null, endpoint: ENDPOINTS.client, droit: DROITS.client });
    }
    if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
    if (blocage.bloque) return non(blocage.code, blocage.message);
    if (!c.ok) return non("fiche_incomplete", `Fiche client incomplète : ${c.erreurs.join(" ; ")}`);
    if (str(requete.expectedHash) !== hash) return non("hash_different", "La fiche client a changé depuis l'aperçu : relire l'aperçu puis confirmer.");
    // Choix explicite : la recherche est refaite ici ; toute correspondance
    // trouvée doit avoir été explicitement écartée par l'utilisateur.
    const lus = [];
    for (const type of [TYPE_TIERS.client, TYPE_TIERS.prospect]) {
      const r = await progbat.lireTiers(type);
      if (!r?.ok) return non("recherche_impossible", `Recherche des clients ProGBat impossible (${r?.status ?? "réseau"}) : aucune création sans recherche préalable.`);
      lus.push(...(r.items || []));
    }
    const ecartes = new Set((Array.isArray(requete.correspondancesEcartees) ? requete.correspondancesEcartees : []).map((x) => idProgbat(x)).filter((x) => x != null));
    const nonExaminees = chercherCorrespondances(client, lus).filter((m) => !ecartes.has(m.id));
    if (nonExaminees.length) return non("correspondances_non_examinees", `${nonExaminees.length} client(s) ProGBat ressemblant(s) n'ont pas été écartés explicitement : choisir l'un d'eux ou confirmer « aucun ne correspond ».`, { correspondances: nonExaminees });
    const w = await ecrireAvecReservation({ cible: "client", cle: client.id, corps: c.corps, hash, appelant, depot, envoyer: (corps) => progbat.creerTiers(corps), maintenant });
    await rafraichir();
    if (w.statut === "refuse") return non("reservation_refusee", w.message);
    if (w.statut !== "created") return { http: 200, body: { ok: false, action, code: w.statut === "uncertain" ? "etat_incertain" : "progbat_refus", statut: w.statut, error: w.message, progbat_status: w.rep?.status ?? null, a_faire_par_loris: w.rep?.status === 403 ? `Ajouter le droit ${DROITS.client}` : null, etapes: etat() }, journal: { action, projectId, statut: w.statut, http: w.rep?.status ?? 0 } };
    const l = await depot.lierClient(client.id, w.progbat_id);
    if (!l?.ok) return { http: 200, body: { ok: false, action, code: "enregistrement_incomplet", statut: "uncertain", error: `Client créé dans ProGBat (n° ${w.progbat_id}) mais non noté sur la fiche : NE PAS recréer ; le relier avec « Choisir ce client » (n° ${w.progbat_id}).`, etapes: etat() } };
    client.progbat_client_id = String(w.progbat_id);
    const report = reportProjets(ctx.projetsChantier || [projet], { thirdId: w.progbat_id });
    if (report.length) await depot.majProjets(report);
    return ok({ statut: "created", thirdId: w.progbat_id, message: `Client créé dans ProGBat (n° ${w.progbat_id}, ${c.corps.code}).` }, { statut: "created", thirdId: w.progbat_id });
  }

  // ── chantier ProGBat : aperçu puis création ──
  if (action === "preparer_chantier" || action === "creer_chantier") {
    if (!chantier) return non("chantier_absent", "Chiffrage non rattaché à un chantier.");
    const mid = idProgbat(managers[chargeAffairesEffectifId(chantier, operation)]);
    const c = construireCorpsChantier({ thirdId: client?.progbat_client_id, projet, client: client || {}, clientAffichage: affichageClient(client), managerId: mid });
    const hash = empreinte("chantier", c.corps);
    const blocage = evaluerBlocage("chantier", resumerEcriture(ecritures.chantier, maintenant), { dejaLie: idProgbat(chantier.progbat_business_id) });
    const info = c.sans_responsable ? "Correspondance du chargé d'affaires avec ProGBat inconnue : le chantier ProGBat sera créé sans responsable (Réglages → Outils → ProGBat : chargés d'affaires)." : null;
    if (action === "preparer_chantier") return ok({ aucune_ecriture: true, corps: c.corps, erreurs: c.erreurs, hash, blocage: blocage.bloque ? blocage : null, info, endpoint: ENDPOINTS.chantier, droit: DROITS.chantier });
    if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
    if (blocage.bloque) return non(blocage.code, blocage.message);
    if (!c.ok) return non("chantier_incomplet", `Informations incomplètes : ${c.erreurs.join(" ; ")}`);
    if (str(requete.expectedHash) !== hash) return non("hash_different", "Les informations du chantier ont changé depuis l'aperçu : relire l'aperçu puis confirmer.");
    const w = await ecrireAvecReservation({ cible: "chantier", cle: chantier.id, corps: c.corps, hash, appelant, depot, envoyer: (corps) => progbat.creerAffaire(corps), maintenant });
    await rafraichir();
    if (w.statut === "refuse") return non("reservation_refusee", w.message);
    if (w.statut !== "created") return { http: 200, body: { ok: false, action, code: w.statut === "uncertain" ? "etat_incertain" : "progbat_refus", statut: w.statut, error: w.message, progbat_status: w.rep?.status ?? null, a_faire_par_loris: w.rep?.status === 403 ? `Ajouter le droit ${DROITS.chantier}` : null, etapes: etat() }, journal: { action, projectId, statut: w.statut, http: w.rep?.status ?? 0 } };
    const businessId = w.progbat_id;
    // Yard : dans la réponse, sinon relecture (GET uniquement).
    let yard = extraireYard({ reponse: w.rep?.data, yardLabel: c.corps.yardLabel });
    if (yard.yardId == null && typeof progbat.lireYards === "function") {
      const ly = await progbat.lireYards(businessId);
      yard = ly?.ok ? extraireYard({ yards: ly.items, yardLabel: c.corps.yardLabel }) : { yardId: null, raison: `Relecture du chantier technique impossible (${ly?.status ?? "réseau"}) : « Relire le chantier ProGBat » plus tard.` };
    }
    const l = await depot.lierChantier(chantier.id, { businessId, yardId: yard.yardId, code: str(w.rep?.data?.code) || c.corps.code });
    if (!l?.ok) return { http: 200, body: { ok: false, action, code: "enregistrement_incomplet", statut: "uncertain", error: `Chantier créé dans ProGBat (n° ${businessId}) mais non noté dans Profero : NE PAS recréer, signaler le n° ${businessId}.`, etapes: etat() } };
    chantier.progbat_business_id = businessId; chantier.progbat_yard_id = yard.yardId; chantier.progbat_business_code = str(w.rep?.data?.code) || c.corps.code;
    if (yard.yardId != null) await depot.enregistrerYard(chantier.id, yard);
    const report = reportProjets(ctx.projetsChantier || [projet], { thirdId: client?.progbat_client_id, businessId, yardId: yard.yardId });
    if (report.length) await depot.majProjets(report);
    return ok({ statut: "created", businessId, yardId: yard.yardId, yard_raison: yard.raison || null, info, message: `Chantier créé dans ProGBat (n° ${businessId}${yard.yardId ? `, chantier technique ${yard.yardId}` : ""}).` }, { statut: "created", businessId, yardId: yard.yardId });
  }

  // ── relecture du yard d'un chantier ProGBat déjà créé (GET uniquement) ──
  if (action === "relire_chantier") {
    const businessId = idProgbat(chantier?.progbat_business_id);
    if (businessId == null) return non("chantier_progbat_absent", "Aucun chantier ProGBat relié.");
    const ly = await progbat.lireYards(businessId);
    if (!ly?.ok) return non("lecture_impossible", `Lecture impossible (${ly?.status ?? "réseau"}${ly?.status === 403 ? " : droit ProGBat manquant business.read" : ""}).`);
    const yard = extraireYard({ yards: ly.items, yardLabel: str(projet.logement_reference) });
    if (yard.yardId == null) return non("yard_inconnu", yard.raison);
    await depot.lierChantier(chantier.id, { businessId, yardId: yard.yardId, code: str(chantier.progbat_business_code) || null });
    chantier.progbat_yard_id = yard.yardId;
    await depot.enregistrerYard(chantier.id, yard);
    const report = reportProjets(ctx.projetsChantier || [projet], { thirdId: client?.progbat_client_id, businessId, yardId: yard.yardId });
    if (report.length) await depot.majProjets(report);
    return ok({ aucune_ecriture_progbat: true, yardId: yard.yardId, message: `Chantier technique ProGBat ${yard.yardId} enregistré.` });
  }

  // ── statut du devis (lecture seule) ──
  if (action === "statut_devis") {
    if (quoteId == null) return non("devis_absent", "Aucun devis ProGBat pour ce chiffrage.");
    const lu = await progbat.lireDevis(quoteId);
    if (!lu?.ok) return non("lecture_impossible", `Lecture du devis impossible (${lu?.status ?? "réseau"}).`);
    const s = interpreterStatutDevis(lu.data?.status);
    await depot.majProjet(projectId, { progbat_devis_statut: s.valeur, progbat_devis_statut_le: str(lu.data?.statusDate) || null, progbat_devis_statut_lu_le: maintenant.toISOString() });
    return ok({ aucune_ecriture_progbat: true, statut_devis: s });
  }

  // ── facture d'acompte : aperçu puis création ──
  if (action === "preparer_acompte" || action === "creer_acompte") {
    if (quoteId == null) return non("devis_absent", "Aucun devis ProGBat connu pour ce chiffrage : impossible de créer l'acompte depuis l'application.");
    if (!chantier) return non("chantier_absent", "Chiffrage non rattaché à un chantier.");
    const signe = devisSigneValide((await depot.cycleVieChantier(chantier.id)) || {});
    if (!signe) return non("devis_non_signe", "L'étape « Devis signé » n'est pas validée sur ce chantier : la facture d'acompte se crée après la signature.");
    const corps = construireCorpsAcompte();
    const hash = empreinte("acompte", { quoteId, ...corps });
    // Anti-doublon : facture d'acompte déjà connue (synchronisation des factures, ou ProGBat lu à l'instant)
    const connues = (await depot.facturesAcompteConnues(quoteId)) || [];
    let lues = [];
    let lectureOk = true;
    let lectureMessage = null;
    if (typeof progbat.facturesDuDevis === "function") {
      const lf = await progbat.facturesDuDevis(quoteId);
      if (lf?.ok) lues = (lf.items || []).filter((b) => Number(b?.quoteId) === quoteId && String(b?.type || "").startsWith("advance") && b.type !== "advance-credit");
      else { lectureOk = false; lectureMessage = `Lecture des factures ProGBat impossible (${lf?.status ?? "réseau"})`; }
    } else lectureOk = false;
    const existantes = [
      ...connues.map((f) => ({ id: idProgbat(f.progbat_bill_id), code: str(f.numero) || null })),
      ...lues.map((b) => ({ id: idProgbat(b.id), code: str(b.code) || null })),
    ].filter((f, i, a) => f.id == null || a.findIndex((g) => g.id === f.id) === i);
    const blocage = evaluerBlocage("acompte", resumerEcriture(ecritures.acompte, maintenant), { dejaLie: idProgbat(projet.progbat_acompte_bill_id) });
    const dejaExistante = existantes.length ? `Une facture d'acompte existe déjà pour ce devis dans ProGBat (${existantes.map((f) => f.code || `n° ${f.id}`).join(", ")}) : aucune nouvelle création.` : null;
    if (action === "preparer_acompte") {
      return ok({ aucune_ecriture: true, corps, hash, quoteId, existantes, deja_existante: dejaExistante, lecture_factures: lectureOk ? "ok" : lectureMessage, blocage: blocage.bloque ? blocage : null, endpoint: ENDPOINTS.acompte, droit: DROITS.acompte });
    }
    if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
    if (blocage.bloque) return non(blocage.code, blocage.message);
    if (dejaExistante) return non("acompte_existant", dejaExistante, { existantes });
    if (!lectureOk) return non("verification_impossible", `${lectureMessage || "Lecture des factures ProGBat indisponible"} : impossible de vérifier qu'aucune facture d'acompte n'existe déjà, rien n'est créé.`);
    if (str(requete.expectedHash) !== hash) return non("hash_different", "Aperçu périmé : relire puis confirmer.");
    const w = await ecrireAvecReservation({ cible: "acompte", cle: quoteId, corps, hash, appelant, depot, envoyer: (b) => progbat.creerAcompte(quoteId, b), maintenant });
    await rafraichir();
    if (w.statut === "refuse") return non("reservation_refusee", w.message);
    if (w.statut !== "created") return { http: 200, body: { ok: false, action, code: w.statut === "uncertain" ? "etat_incertain" : "progbat_refus", statut: w.statut, error: w.message, progbat_status: w.rep?.status ?? null, a_faire_par_loris: w.rep?.status === 403 ? `Ajouter le droit ${DROITS.acompte}` : null, etapes: etat() }, journal: { action, projectId, statut: w.statut, http: w.rep?.status ?? 0 } };
    await depot.majProjet(projectId, { progbat_acompte_bill_id: String(w.progbat_id), progbat_acompte_code: w.progbat_code || null });
    return ok({ statut: "created", billId: w.progbat_id, billCode: w.progbat_code, message: `Facture d'acompte (${TAUX_ACOMPTE} %) créée en BROUILLON dans ProGBat${w.progbat_code ? ` (${w.progbat_code})` : ""} : à valider puis émettre dans ProGBat.` }, { statut: "created", billId: w.progbat_id });
  }

  // ── « J'ai vérifié dans ProGBat » : lève un état incertain (aucune écriture ProGBat) ──
  if (action === "verifier_ecriture") {
    const cible = str(requete.cible);
    if (!CIBLES.includes(cible)) return non("cible_invalide", "Cible inconnue.");
    if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
    const e = resumerEcriture(ecritures[cible], maintenant);
    if (!e || e.statut !== "uncertain") return non("rien_a_lever", "Aucun état incertain à lever.");
    // L'utilisateur affirme que RIEN n'a été créé dans ProGBat : la réservation
    // passe en « failed » (n'est plus bloquante). S'il a trouvé l'élément, il
    // le relie (client) ou le signale (chantier/acompte) au lieu de lever.
    const r = await depot.majEcriture(e.id, { statut: "failed", message: `Vérifié dans ProGBat par ${str(appelant.email)} : rien n'avait été créé.`, finished_at: maintenant.toISOString() });
    if (!r?.ok) return non("enregistrement_impossible", "Enregistrement impossible.");
    ecritures[cible] = { ...ecritures[cible], statut: "failed" };
    return ok({ aucune_ecriture_progbat: true, message: "État incertain levé : une nouvelle tentative est possible." });
  }

  return { http: 400, body: { ok: false, code: "action_invalide", error: "Action non gérée." } };
}

// ─── Clients ProGBat existants (fiche Opération) — LECTURE ProGBat seulement ──
/**
 * lister_clients_progbat : clients (type 2) et prospects (type 4) ProGBat,
 *   résumés, pour la recherche dans l'application. GET uniquement.
 * importer_client_progbat { thirdId, confirmed } : fiche locale pré-remplie
 *   depuis le client ProGBat CHOISI ; réutilise la fiche locale qui porte
 *   déjà ce progbat_client_id (index unique en base). Aucune écriture ProGBat.
 * depot : clientParProgbatId(id) → ligne | null ; creerClientLocal(fiche) → { ok, client } | { ok: false, conflit?, erreur }
 */
export async function traiterClientsProgbat(action, requete = {}, { appelant, depot, progbat } = {}) {
  if (action === "lister_clients_progbat") {
    const clients = [];
    for (const type of [TYPE_TIERS.client, TYPE_TIERS.prospect]) {
      const r = await progbat.lireTiers(type);
      if (!r?.ok) return { http: 200, body: { ok: false, action, code: "lecture_impossible", progbat_status: r?.status ?? null, aucune_ecriture: true, error: `Liste des clients ProGBat illisible${r?.status === 403 ? " : droit ProGBat manquant thirds.read (403)" : ` (${r?.status || "réseau"}${r?.message ? ` : ${nettoyerMessage(r.message)}` : ""})`}.` } };
      clients.push(...(r.items || []).map(resumerTiers).filter((x) => x.id != null));
    }
    clients.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
    return { http: 200, body: { ok: true, action, aucune_ecriture: true, clients }, journal: { action, nb: clients.length } };
  }
  // importer_client_progbat
  const tid = idProgbat(requete.thirdId);
  const non = (code, error) => ({ http: 200, body: { ok: false, action, code, error, aucune_ecriture_progbat: true }, journal: { action, refus: code } });
  if (tid == null) return non("third_id_invalide", "Client ProGBat non choisi.");
  if (requete.confirmed !== true) return non("confirmation_requise", "Confirmation explicite requise.");
  const existant = await depot.clientParProgbatId(tid);
  if (existant) {
    return { http: 200, body: { ok: true, action, reutilise: true, client: existant, manquants: controlerFiche("client", existant), aucune_ecriture_progbat: true, message: "Ce client ProGBat a déjà sa fiche dans l'application : elle est réutilisée." }, journal: { action, thirdId: tid, reutilise: true } };
  }
  const lu = await progbat.lireTiersUn(tid);
  if (!lu?.ok) return non("tiers_illisible", `Client ProGBat ${tid} illisible (${lu?.status || "réseau"}) : aucune fiche créée.`);
  if (![TYPE_TIERS.client, TYPE_TIERS.prospect].includes(lu.data?.type)) return non("type_tiers", `Le tiers ProGBat ${tid} n'est ni un client ni un prospect : aucune fiche créée.`);
  const { fiche, manquants } = ficheDepuisTiers(lu.data);
  const cree = await depot.creerClientLocal({ ...fiche, cree_par: str(appelant?.email) || null });
  if (!cree?.ok) {
    if (cree?.conflit) {
      const deja = await depot.clientParProgbatId(tid);
      if (deja) return { http: 200, body: { ok: true, action, reutilise: true, client: deja, manquants: controlerFiche("client", deja), aucune_ecriture_progbat: true, message: "Fiche déjà créée à l'instant pour ce client ProGBat : elle est réutilisée." } };
    }
    return non("creation_locale_impossible", `Fiche client non créée : ${nettoyerMessage(cree?.erreur) || "erreur"}.`);
  }
  return {
    http: 200,
    body: { ok: true, action, reutilise: false, client: cree.client, manquants, aucune_ecriture_progbat: true, message: manquants.length ? `Fiche créée depuis ProGBat ; il manque (règles Profero) : ${manquants.map((m) => m.libelle).join(", ")}. Compléter la fiche ne modifie pas ProGBat.` : "Fiche créée depuis ProGBat." },
    journal: { action, thirdId: tid, reutilise: false },
  };
}

// ─── Bouton « Créer le devis » : client et chantier ProGBat d'abord ──────────
/**
 * Le devis ne se crée qu'avec son client ET son chantier ProGBat (plus de devis
 * « Chantier : Aucun »). Exception, pour ne pas bloquer le chiffrage tant que
 * Loris n'a pas ajouté les droits : si ProGBat a REFUSÉ la création (403,
 * droit manquant), l'utilisateur peut cocher « créer le devis comme avant ».
 * → { autorise, raison, contournement }
 */
export function decisionDevis(etapes) {
  if (!etapes) return { autorise: false, raison: "État ProGBat (client, chantier) pas encore chargé.", contournement: false };
  if (etapes.devis?.fait) return { autorise: true, raison: null, contournement: false };
  const manque = [];
  if (!etapes.client?.fait) manque.push("le client ProGBat");
  if (!etapes.chantier?.fait) manque.push("le chantier ProGBat");
  else if (etapes.chantier?.yardId == null) manque.push("le chantier technique (yard) du chantier ProGBat : « Relire le chantier ProGBat »");
  if (!manque.length) return { autorise: true, raison: null, contournement: false };
  const refus = ["client", "chantier"].filter((c) => etapes[c]?.ecriture?.statut === "failed" && Number(etapes[c]?.ecriture?.http_status) === 403);
  return {
    autorise: false,
    raison: `À faire avant de créer le devis : ${manque.join(", ")}.`,
    contournement: refus.length > 0,
    droits_manquants: refus.map((c) => DROITS[c]),
  };
}
