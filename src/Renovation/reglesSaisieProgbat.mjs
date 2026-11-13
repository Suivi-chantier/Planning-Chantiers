// ─────────────────────────────────────────────────────────────────────────────
// reglesSaisieProgbat — LA liste des règles de saisie exigées pour créer un
// devis dans ProGBat (Refonte Opérations, lot 2 : docs/projets/refonte-operations.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun import. Façade
// front : reglesSaisieProgbat.js. Copié tel quel dans l'Edge Function
// progbat-quote (scripts/sync-progbat-edge-lib.mjs).
//
// UNE SEULE LISTE, deux utilisateurs :
//   1. les formulaires (fiche client, parcours de chiffrage, page Chiffrage) :
//      astérisque sur chaque champ obligatoire, enregistrement refusé, liste
//      de ce qui manque sous le bouton « Créer le devis dans ProGBat » ;
//   2. le contrôle d'avant-envoi construireEnTeteDevis()
//      (progbatQuotePayload.mjs), côté navigateur ET côté serveur.
// scripts/verif-refonte-lot2.mjs prouve que les deux lisent cette liste.
//
// `profero: true` (prénom, e-mail, téléphone) : règle PROFERO, exigée pour un
// NOUVEAU client créé depuis l'application (cahier des charges du lot 2). Elle
// ne s'applique pas à un client relié à ProGBat (`progbat_client_id`
// renseigné) : il existe déjà dans ProGBat, l'application ne le crée pas
// (demande de Loris du 07/11). Ce qui lui manque dans ProGBat même reste
// visible, sans bloquer : notesFiche() → « Absent dans ProGBat : e-mail ».
//
// `serveur: true` : la règle porte sur un champ du chiffrage (profero_projets)
// et est donc AUSSI vérifiée par construireEnTeteDevis. Les autres (chantier
// rattaché, chargé d'affaires) portent sur des données que le serveur ne lit
// pas : elles bloquent le bouton dans l'application.
// ─────────────────────────────────────────────────────────────────────────────

const txt = (v) => (v == null ? "" : String(v).trim());

export const TYPES_CLIENT = Object.freeze([
  Object.freeze({ id: "particulier", label: "Particulier" }),
  Object.freeze({ id: "societe", label: "Société" }),
]);

const estSociete = (c) => c && c.type === "societe";
const estParticulier = (c) => c && c.type === "particulier";
/** Fiche reliée à un client ProGBat existant ? */
export const estLieProgbat = (c) => !!c && c.progbat_client_id != null && txt(c.progbat_client_id) !== "";

/**
 * Règles. `si(valeurs)` : la règle ne s'applique que dans ce cas (ex. prénom
 * pour un particulier). `code` : code d'erreur du contrôle d'avant-envoi
 * (codes historiques conservés : client_absent, client_adresse_absente…).
 */
export const REGLES_SAISIE = Object.freeze([
  // ── Fiche client ──
  { id: "client_type", fiche: "client", champ: "type", libelle: "Type de client (particulier ou société)", code: "client_type_absent", serveur: true,
    valide: (c) => estSociete(c) || estParticulier(c) },
  { id: "client_nom", fiche: "client", champ: "nom", libelle: "Nom du client", code: "client_absent", serveur: true, si: estParticulier },
  { id: "client_prenom", fiche: "client", champ: "prenom", libelle: "Prénom du client", court: "prénom", code: "client_prenom_absent", serveur: true, profero: true, si: estParticulier },
  { id: "client_raison_sociale", fiche: "client", champ: "raison_sociale", libelle: "Raison sociale", code: "client_absent", serveur: true, si: estSociete },
  { id: "client_contact", fiche: "client", champ: "contact_nom", libelle: "Nom du contact (société)", code: "client_contact_absent", serveur: true, si: estSociete },
  { id: "client_adresse", fiche: "client", champ: "adresse", libelle: "Adresse de facturation du client", code: "client_adresse_absente", serveur: true },
  { id: "client_code_postal", fiche: "client", champ: "code_postal", libelle: "Code postal de facturation du client", code: "client_code_postal_absent", serveur: true },
  { id: "client_ville", fiche: "client", champ: "ville", libelle: "Ville de facturation du client", code: "client_ville_absente", serveur: true },
  { id: "client_pays", fiche: "client", champ: "pays", libelle: "Pays du client (France par défaut)", code: "client_pays_absent", serveur: true },
  { id: "client_email", fiche: "client", champ: "email", libelle: "E-mail du client (règle Profero)", court: "e-mail", code: "client_email_absent", serveur: true, profero: true },
  { id: "client_telephone", fiche: "client", champ: "telephone", libelle: "Téléphone du client (règle Profero)", court: "téléphone", code: "client_telephone_absent", serveur: true, profero: true },
  // ── Chantier ──
  { id: "chantier_rattache", fiche: "chantier", champ: "chantier_id", libelle: "Chantier et opération du chiffrage (impossible de chiffrer sans opération)", code: "chantier_non_rattache", serveur: false },
  { id: "chantier_adresse", fiche: "chantier", champ: "adresse", libelle: "Adresse du chantier", code: "chantier_adresse_absente", serveur: true },
  { id: "chantier_code_postal", fiche: "chantier", champ: "code_postal", libelle: "Code postal du chantier", code: "chantier_code_postal_absent", serveur: true },
  { id: "chantier_ville", fiche: "chantier", champ: "ville", libelle: "Ville du chantier", code: "chantier_ville_absente", serveur: true },
  { id: "chantier_reference", fiche: "chantier", champ: "reference_logement", libelle: "Référence du logement (ex : T2 - R+2)", code: "logement_reference_absente", serveur: true },
  { id: "chantier_charge_affaires", fiche: "chantier", champ: "charge_affaires_id", libelle: "Chargé d'affaires du chantier", code: "charge_affaires_absent", serveur: false },
  // ── Devis (déjà bloquants avant le lot 2, inchangés) ──
  { id: "devis_objet", fiche: "devis", champ: "objet", libelle: "Objet du devis", code: "objet_absent", serveur: true },
  { id: "devis_validite", fiche: "devis", champ: "validite", libelle: "Date de validité du devis", code: "validite_absente", serveur: true },
  { id: "devis_tva", fiche: "devis", champ: "tva_pct", libelle: "Taux de TVA du devis", code: "tva_projet_absente", serveur: true },
].map((r) => Object.freeze(r)));

/** Champs GÉNÉRÉS automatiquement (jamais saisis) — pour l'affichage et le lot 4. */
export const CHAMPS_GENERES = Object.freeze([
  Object.freeze({ fiche: "client", champ: "code_progbat", libelle: "Identifiant ProGBat du client", regle: "« NOM VILLE » : genererCodeClient()" }),
  Object.freeze({ fiche: "chantier", champ: "nom_progbat", libelle: "Nom du chantier ProGBat", regle: "« client — référence du logement » : genererNomChantierProgbat()" }),
  Object.freeze({ fiche: "chantier", champ: "code_progbat", libelle: "Code du chantier ProGBat", regle: "« code client + référence » : genererCodeChantierProgbat()" }),
]);

export const FICHES = Object.freeze(["client", "chantier", "devis"]);

const reglesDe = (fiche) => REGLES_SAISIE.filter((r) => r.fiche === fiche);

/** Condition propre de la règle (ex. prénom : particulier seulement). */
function conditionRemplie(r, valeurs) {
  return typeof r.si !== "function" || r.si(valeurs || {});
}

/** La règle s'applique-t-elle ? Une règle Profero ne s'applique pas à un client relié à ProGBat. */
function regleApplicable(r, valeurs) {
  if (r.profero && estLieProgbat(valeurs)) return false;
  return conditionRemplie(r, valeurs);
}

function regleRespectee(r, valeurs) {
  if (typeof r.valide === "function") return r.valide(valeurs || {});
  const v = (valeurs || {})[r.champ];
  if (typeof v === "number") return Number.isFinite(v);
  return txt(v) !== "";
}

/** Le champ porte-t-il un astérisque ? (dépend du type de client) */
export function estObligatoire(fiche, champ, valeurs = {}) {
  return reglesDe(fiche).some((r) => r.champ === champ && regleApplicable(r, valeurs));
}

/**
 * Ce qui manque sur une fiche → [{ id, code, champ, libelle, message }].
 * `serveurSeulement` : seulement les règles que le serveur peut vérifier.
 */
export function controlerFiche(fiche, valeurs = {}, { serveurSeulement = false } = {}) {
  return reglesDe(fiche)
    .filter((r) => (!serveurSeulement || r.serveur) && regleApplicable(r, valeurs) && !regleRespectee(r, valeurs))
    .map((r) => ({ id: r.id, code: r.code, champ: r.champ, libelle: r.libelle, message: `${r.libelle} : à renseigner` }));
}

/**
 * Client relié à ProGBat : règles Profero non respectées parce que ProGBat
 * n'a pas l'information. Jamais bloquant, affiché en note discrète.
 * → [{ id, champ, court, message: "Absent dans ProGBat : e-mail" }] ; [] si la
 * fiche n'est pas reliée à ProGBat (là, ces règles bloquent : controlerFiche).
 */
export function notesFiche(fiche, valeurs = {}) {
  if (!estLieProgbat(valeurs)) return [];
  return reglesDe(fiche)
    .filter((r) => r.profero && conditionRemplie(r, valeurs) && !regleRespectee(r, valeurs))
    .map((r) => ({ id: r.id, champ: r.champ, court: r.court || r.libelle, message: `Absent dans ProGBat : ${r.court || r.libelle}` }));
}

/** Une seule ligne : « Absent dans ProGBat : prénom, e-mail » ou "" (rien à signaler). */
export function noteAbsentsProgbat(valeurs = {}) {
  const n = notesFiche("client", valeurs);
  return n.length ? `Absent dans ProGBat : ${n.map((x) => x.court).join(", ")}` : "";
}

// ─── Passage chiffrage (profero_projets) ↔ fiches ───────────────────────────
/** Client tel que le chiffrage le porte (colonnes client_* de profero_projets). */
export function clientDepuisProjet(projet = {}) {
  const societe = txt(projet.client_societe);
  if (societe) {
    return {
      type: "societe", nom: "", prenom: "", raison_sociale: societe,
      contact_nom: [txt(projet.client_nom), txt(projet.client_prenom)].filter(Boolean).join(" "),
      adresse: txt(projet.client_adresse), code_postal: txt(projet.client_code_postal), ville: txt(projet.client_ville),
      pays: txt(projet.client_pays), email: txt(projet.client_email), telephone: txt(projet.client_telephone),
      progbat_client_id: txt(projet.progbat_client_id) || null,
    };
  }
  return {
    type: "particulier", nom: txt(projet.client_nom), prenom: txt(projet.client_prenom), raison_sociale: "", contact_nom: "",
    adresse: txt(projet.client_adresse), code_postal: txt(projet.client_code_postal), ville: txt(projet.client_ville),
    pays: txt(projet.client_pays), email: txt(projet.client_email), telephone: txt(projet.client_telephone),
    progbat_client_id: txt(projet.progbat_client_id) || null,
  };
}

/** Colonnes client_* du chiffrage depuis une fiche client (copie pour le devis). */
export function projetDepuisClient(client = {}) {
  const societe = client.type === "societe";
  return {
    client_societe: societe ? txt(client.raison_sociale) : "",
    client_nom: societe ? txt(client.contact_nom) : txt(client.nom),
    client_prenom: societe ? "" : txt(client.prenom),
    client_adresse: txt(client.adresse),
    client_adresse_complement: txt(client.adresse_complement),
    client_code_postal: txt(client.code_postal),
    client_ville: txt(client.ville),
    client_pays: txt(client.pays),
    client_email: txt(client.email),
    client_telephone: txt(client.telephone),
  };
}

/** Écart entre le chiffrage et la fiche client (champs client_* différents). */
export function ecartsClientProjet(projet = {}, client = {}) {
  const attendu = projetDepuisClient(client);
  return Object.keys(attendu).filter((k) => txt(projet[k]) !== attendu[k]);
}

/**
 * Chantier tel que le chiffrage le porte. L'ancien champ « adresse du bien »
 * reste un repli pour l'adresse (avertissement), jamais pour le code postal
 * ni la ville.
 */
export function chantierDepuisProjet(projet = {}, { referenceLogement = null } = {}) {
  return {
    adresse: txt(projet.chantier_adresse) || txt(projet.adresse_bien),
    code_postal: txt(projet.chantier_code_postal),
    ville: txt(projet.chantier_ville),
    reference_logement: referenceLogement != null ? txt(referenceLogement) : txt(projet.logement_reference),
  };
}

export function devisDepuisProjet(projet = {}) {
  const tva = projet.tva_pct === "" || projet.tva_pct == null ? null : Number(String(projet.tva_pct).replace(",", "."));
  return { objet: txt(projet.devis_objet), validite: txt(projet.devis_validite), tva_pct: Number.isFinite(tva) ? tva : null };
}

/**
 * Tout ce qui manque pour créer le devis d'un chiffrage, dans l'ordre des
 * fiches. Utilisé par le bouton « Créer le devis dans ProGBat ».
 *   projet        : ligne profero_projets (ou l'état du formulaire)
 *   rattachement  : { chantier_id, charge_affaires_id } — null si le
 *                   chiffrage n'est rattaché à aucun chantier
 *   clientProgbat : vrai si le client existe déjà dans ProGBat (thirdId) : ses
 *                   coordonnées ProGBat font foi, la fiche n'est pas contrôlée
 */
export function manquantsAvantDevis({ projet = {}, rattachement = null, referenceLogement = null, clientProgbat = false } = {}) {
  const client = clientProgbat ? [] : controlerFiche("client", clientDepuisProjet(projet));
  const chantier = controlerFiche("chantier", {
    ...chantierDepuisProjet(projet, { referenceLogement }),
    chantier_id: rattachement?.chantier_id || "",
    charge_affaires_id: rattachement?.charge_affaires_id || "",
  });
  const devis = controlerFiche("devis", devisDepuisProjet(projet));
  return [...client, ...chantier, ...devis];
}

// ─── Identifiants générés ───────────────────────────────────────────────────
/**
 * Normalisation ProGBat « NOM VILLE » : majuscules, sans accents, ponctuation
 * remplacée par un espace, « SAINT(E) » abrégé en « ST(E) ».
 * Ex. (données fictives) : Corral + Saint-Barthélemy-d'Anjou →
 * « CORRAL ST BARTHELEMY D ANJOU ».
 */
export function normaliserCode(s, { garderPlus = false } = {}) {
  const sansAccents = txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const motif = garderPlus ? /[^A-Z0-9+]+/g : /[^A-Z0-9]+/g;
  return sansAccents.replace(motif, " ").trim().split(/\s+/).filter(Boolean)
    .map((m) => (m === "SAINT" ? "ST" : m === "SAINTE" ? "STE" : m)).join(" ");
}

/** Identifiant ProGBat du client : nom (ou raison sociale) + ville. "" si incomplet. */
export function genererCodeClient(client = {}) {
  const base = client.type === "societe" ? client.raison_sociale : client.nom;
  if (!txt(base) || !txt(client.ville)) return "";
  return normaliserCode(`${base} ${client.ville}`);
}

/** Nom du chantier ProGBat : « client — référence du logement » (businessLabel). */
export function genererNomChantierProgbat({ clientAffichage = "", reference = "" } = {}) {
  return [txt(clientAffichage), txt(reference)].filter(Boolean).join(" — ");
}

/** Code du chantier ProGBat : code client + référence normalisée (« + » gardé : R+2). */
export function genererCodeChantierProgbat({ codeClient = "", reference = "" } = {}) {
  if (!txt(codeClient) || !txt(reference)) return "";
  return `${normaliserCode(codeClient)} ${normaliserCode(reference, { garderPlus: true })}`.trim();
}

// ─── Astérisques du formulaire de chiffrage (colonnes de profero_projets) ───
/** Colonne du chiffrage → (fiche, champ) de la règle. Le contact d'une société va dans client_nom. */
const CHAMPS_PROJET = Object.freeze({
  client_prenom: ["client", "prenom"],
  client_adresse: ["client", "adresse"],
  client_code_postal: ["client", "code_postal"],
  client_ville: ["client", "ville"],
  client_pays: ["client", "pays"],
  client_email: ["client", "email"],
  client_telephone: ["client", "telephone"],
  chantier_adresse: ["chantier", "adresse"],
  chantier_code_postal: ["chantier", "code_postal"],
  chantier_ville: ["chantier", "ville"],
  logement_reference: ["chantier", "reference_logement"],
  devis_objet: ["devis", "objet"],
  devis_validite: ["devis", "validite"],
  tva_pct: ["devis", "tva_pct"],
});

/** Le champ du formulaire de chiffrage porte-t-il un astérisque ? */
export function estObligatoireProjet(colonne, projet = {}) {
  const client = clientDepuisProjet(projet);
  if (colonne === "client_nom") return estObligatoire("client", client.type === "societe" ? "contact_nom" : "nom", client);
  const cible = CHAMPS_PROJET[colonne];
  if (!cible) return false;
  return estObligatoire(cible[0], cible[1], cible[0] === "client" ? client : {});
}
