// ─────────────────────────────────────────────────────────────────────────────
// securiteDonnees — lecture et écriture de la fiche de préparation sécurité
// côté page Opération (tâche 2 du projet docs/projets/fiche-securite-chantier.md).
//
//   - état des fiches des chantiers d'une opération : vue securite_fiches_etat ;
//   - données du bâtiment : table securite_operations (une ligne par opération,
//     enregistrée par upsert sur operation_id). Aucune suppression.
//
// Chaque fonction renvoie { …, erreur } : une lecture en échec n'est jamais
// confondue avec « aucune donnée » (l'écran affiche « état illisible »).
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { uploadDocumentChantier, urlDocumentChantier, supprimerDocumentChantier, derniereErreurDocument, deposerPreuveSecurite, urlPreuveSecurite, lirePreuveSecurite } from "./storageChantier.js";
import { journaliserStatut } from "./chantiersDonnees.js";
import {
  serialisationCanonique, contenuVersion, motifDepuisJournal, entreeJournalValidation, entreeJournalMiseAJour,
  preparerMiseAJour, dossierJustificatifs, cheminSignature, EVENEMENT_JOURNAL,
} from "./securiteVersion.js";
import { etatValidation, justificatifsPourPastille } from "./securiteValidation.js";
import { cheminPdfVersion } from "./securitePdf.js";
import { loadPhasagesPourLiaison } from "./phasagePlanning.js";

const COLS_ETAT = "fiche_id, chantier_id, version, statut, points_completes, signe_etablie_par, signe_chef_equipe, nb_signatures_accueil, nb_justificatifs_chantier, demarrage_force";
const COLS_BATIMENT = "operation_id, date_permis_construire, avant_1997, avant_1949, copropriete, etage, ascenseur_utilisable, reperage_amiante_statut, notes, maj_par, updated_at";

/** État des fiches de plusieurs chantiers → { parChantier: { [id]: ligne }, erreur }. */
export async function chargerEtatFiches(chantierIds) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { parChantier: {}, erreur: null };
  try {
    const { data, error } = await supabase.from("securite_fiches_etat").select(COLS_ETAT).in("chantier_id", ids);
    if (error) return { parChantier: {}, erreur: error.message };
    const parChantier = {};
    (data || []).forEach((l) => { parChantier[l.chantier_id] = l; });
    return { parChantier, erreur: null };
  } catch (e) {
    return { parChantier: {}, erreur: e?.message || String(e) };
  }
}

/** Données du bâtiment d'une opération → { ligne (null = jamais saisie), erreur }. */
export async function chargerBatiment(operationId) {
  if (!operationId) return { ligne: null, erreur: "opération inconnue" };
  try {
    const { data, error } = await supabase.from("securite_operations").select(COLS_BATIMENT)
      .eq("operation_id", String(operationId)).maybeSingle();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data || null, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}

/**
 * Enregistre la ligne préparée par preparerEnregistrementBatiment (module pur).
 * Relit la ligne écrite : « avant 1997 / avant 1949 » sont calculés par la base.
 */
export async function enregistrerBatiment(ligne, auteur) {
  try {
    const { data, error } = await supabase.from("securite_operations")
      .upsert({ ...ligne, maj_par: auteur || null }, { onConflict: "operation_id" })
      .select(COLS_BATIMENT).single();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}

// ─── Fiche d'un chantier (tâche 3) ───────────────────────────────────────────
// Table securite_fiches. Création en brouillon (valeurs par défaut de la base),
// lecture, et enregistrement du contenu préparé par contenuAEnregistrer()
// (module pur securiteFiche.mjs). Aucune suppression.

const COLS_FICHE = "id, chantier_id, version, statut, donnees_base, intervenants, reponses, synthese_risques, validee_le, validee_par, cree_par, maj_par, created_at, updated_at";

/** Fiche d'un chantier → { ligne (null = pas de fiche), erreur }. */
export async function chargerFiche(chantierId) {
  if (!chantierId) return { ligne: null, erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_fiches").select(COLS_FICHE)
      .eq("chantier_id", String(chantierId)).maybeSingle();
    if (error) return { ligne: null, erreur: error.message };
    return { ligne: data || null, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e) };
  }
}

/**
 * Crée la fiche d'un chantier, en brouillon (défauts de la base : version 1,
 * contenu vide). Si une fiche existe déjà (créée entre-temps par quelqu'un
 * d'autre : clé unique sur chantier_id), on relit et on renvoie celle-là.
 * → { ligne, existait, erreur }
 */
export async function creerFiche(chantierId, auteur) {
  if (!chantierId) return { ligne: null, existait: false, erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_fiches")
      .insert({ chantier_id: String(chantierId), cree_par: auteur || null, maj_par: auteur || null })
      .select(COLS_FICHE).single();
    if (!error) return { ligne: data, existait: false, erreur: null };
    if (error.code === "23505") {
      const r = await chargerFiche(chantierId);
      return { ligne: r.ligne, existait: true, erreur: r.erreur || (r.ligne ? null : error.message) };
    }
    return { ligne: null, existait: false, erreur: error.message };
  } catch (e) {
    return { ligne: null, existait: false, erreur: e?.message || String(e) };
  }
}

/**
 * Enregistre le contenu d'une fiche EN BROUILLON. L'écriture n'a lieu que si
 * la fiche est toujours en brouillon ET n'a pas été modifiée ailleurs depuis
 * la dernière lecture (même updated_at) : sinon rien n'est écrit et l'écran
 * dit pourquoi (jamais d'écrasement silencieux).
 * → { ligne, erreur, conflit }
 */
export async function enregistrerFiche(ficheId, contenu, { updatedAt, auteur } = {}) {
  if (!ficheId) return { ligne: null, erreur: "fiche inconnue", conflit: null };
  try {
    let q = supabase.from("securite_fiches")
      .update({ ...contenu, maj_par: auteur || null })
      .eq("id", ficheId).eq("statut", "brouillon");
    if (updatedAt) q = q.eq("updated_at", updatedAt);
    const { data, error } = await q.select(COLS_FICHE);
    if (error) return { ligne: null, erreur: error.message, conflit: null };
    if (data && data.length === 1) return { ligne: data[0], erreur: null, conflit: null };
    // 0 ligne écrite : relire pour dire pourquoi.
    const { data: actuelle, error: e2 } = await supabase.from("securite_fiches").select(COLS_FICHE).eq("id", ficheId).maybeSingle();
    if (e2) return { ligne: null, erreur: e2.message, conflit: null };
    if (!actuelle) return { ligne: null, erreur: "fiche introuvable (ou non visible avec vos droits)", conflit: null };
    if (actuelle.statut !== "brouillon") return { ligne: actuelle, erreur: "la fiche n'est plus en brouillon", conflit: "statut" };
    return { ligne: actuelle, erreur: "la fiche a été modifiée par quelqu'un d'autre", conflit: "modifiee_ailleurs" };
  } catch (e) {
    return { ligne: null, erreur: e?.message || String(e), conflit: null };
  }
}

// ─── Tâche 4 : justificatifs, signatures, validation, versions ──────────────
// Règles (module pur) : securiteValidation.mjs ; contenu figé et empreinte :
// securiteVersion.mjs. Ici : lectures, écritures, hachage sha256 (Web Crypto).
// Rien n'est supprimé : un justificatif retiré est archivé (archive_le) ;
// versions et signatures sont immuables en base.

const COLS_JUSTIF = "id, portee, chantier_id, point, type_code, personne, entreprise_nom, fichier_path, fichier_nom, date_document, expire_le, confidentiel, ajoute_par, created_at, archive_le";
const COLS_SIGNATURE = "id, fiche_id, version, type, signataire_nom, signataire_entreprise, auth_user_id, image_path, empreinte_version, signe_le";
const COLS_VERSION = "id, fiche_id, version, motif_changement, empreinte, pdf_path, cree_par, cree_le";

const msg = (e) => e?.message || String(e);

/** Date du jour locale AAAA-MM-JJ (les règles pures la reçoivent en paramètre). */
export function dateDuJourLocale() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Justificatifs ACTIFS (non archivés) d'un chantier → { liste, erreur }. */
export async function chargerJustificatifs(chantierId) {
  if (!chantierId) return { liste: null, erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_justificatifs").select(COLS_JUSTIF)
      .eq("portee", "chantier").eq("chantier_id", String(chantierId)).is("archive_le", null);
    if (error) return { liste: null, erreur: error.message };
    return { liste: data || [], erreur: null };
  } catch (e) {
    return { liste: null, erreur: msg(e) };
  }
}

/**
 * Ajoute un justificatif de chantier : fichier dans chantier-documents sous
 * securite/chantiers/{chantier_id}/p{point}/, puis ligne securite_justificatifs.
 * Si la ligne est refusée, le fichier tout juste envoyé est retiré (il n'est
 * rattaché à rien). → { ligne, erreur }
 */
export async function ajouterJustificatif({ ligne, fichier, auteur }) {
  try {
    const envoi = await uploadDocumentChantier(fichier, dossierJustificatifs(ligne.chantier_id, ligne.point));
    if (!envoi) return { ligne: null, erreur: derniereErreurDocument() || "envoi du fichier impossible" };
    const { data, error } = await supabase.from("securite_justificatifs")
      .insert({ ...ligne, fichier_path: envoi.path, fichier_nom: envoi.nom || null, ajoute_par: auteur || null })
      .select(COLS_JUSTIF).single();
    if (error) {
      await supprimerDocumentChantier(envoi.path);
      return { ligne: null, erreur: error.message };
    }
    return { ligne: data, erreur: null };
  } catch (e) {
    return { ligne: null, erreur: msg(e) };
  }
}

/** Retire un justificatif : archivage (archive_le), jamais suppression. → { erreur } */
export async function archiverJustificatif(id) {
  try {
    const { data, error } = await supabase.from("securite_justificatifs")
      .update({ archive_le: new Date().toISOString() })
      .eq("id", id).is("archive_le", null).select("id");
    if (error) return { erreur: error.message };
    if (!data || data.length !== 1) return { erreur: "justificatif déjà retiré ou introuvable" };
    return { erreur: null };
  } catch (e) {
    return { erreur: msg(e) };
  }
}

/** URL signée (10 min) d'un justificatif. → { url, erreur } */
export async function urlJustificatif(path) {
  const url = await urlDocumentChantier(path);
  return { url, erreur: url ? null : (derniereErreurDocument() || "lecture impossible") };
}

/** URL signée (10 min) d'une image de signature. → { url, erreur } */
export async function urlImageSignature(path) {
  const url = await urlPreuveSecurite(path);
  return { url, erreur: url ? null : (derniereErreurDocument() || "lecture impossible") };
}

/** Signatures d'une fiche (toutes versions) → { liste, erreur }. */
export async function chargerSignatures(ficheId) {
  if (!ficheId) return { liste: null, erreur: "fiche inconnue" };
  try {
    const { data, error } = await supabase.from("securite_signatures").select(COLS_SIGNATURE)
      .eq("fiche_id", ficheId).order("signe_le", { ascending: true });
    if (error) return { liste: null, erreur: error.message };
    return { liste: data || [], erreur: null };
  } catch (e) {
    return { liste: null, erreur: msg(e) };
  }
}

/** Versions figées d'une fiche (sans le contenu) → { liste, erreur }. */
export async function chargerVersions(ficheId) {
  if (!ficheId) return { liste: null, erreur: "fiche inconnue" };
  try {
    const { data, error } = await supabase.from("securite_fiches_versions").select(COLS_VERSION)
      .eq("fiche_id", ficheId).order("version", { ascending: true });
    if (error) return { liste: null, erreur: error.message };
    return { liste: data || [], erreur: null };
  } catch (e) {
    return { liste: null, erreur: msg(e) };
  }
}

/** Motif de la version en cours, relu dans le journal du chantier → { motif, trouve, erreur }. */
export async function chargerMotifVersion(chantierId, version) {
  if (version === 1) return { motif: null, trouve: true, erreur: null };
  try {
    const { data, error } = await supabase.from("chantiers_statut_journal")
      .select("evenement, nouveau_statut, motif, detail, le")
      .eq("chantier_id", String(chantierId)).eq("evenement", EVENEMENT_JOURNAL);
    if (error) return { motif: null, trouve: false, erreur: error.message };
    return { ...motifDepuisJournal(data || [], version), erreur: null };
  } catch (e) {
    return { motif: null, trouve: false, erreur: msg(e) };
  }
}

/** sha256 hexadécimal d'un texte (Web Crypto, UTF-8). */
export async function sha256Hex(texte) {
  const octets = new TextEncoder().encode(texte);
  const h = await crypto.subtle.digest("SHA-256", octets);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Empreinte d'un contenu de version (sérialisation canonique puis sha256). */
export async function empreinteContenu(contenu) {
  return sha256Hex(serialisationCanonique(contenu));
}

/**
 * Relit en base tout ce qui entre dans la version figée et calcule son
 * empreinte. Utilisé AVANT chaque signature et à la validation, pour ne
 * jamais signer ni figer autre chose que ce qui est en base.
 * → { fiche, batiment, justificatifs, motif, contenu, empreinte, contexte, erreur }
 */
export async function lireContenuAFiger({ chantier, op, clientLibelle, clientErreur = null }) {
  const [f, b, j] = await Promise.all([chargerFiche(chantier.id), chargerBatiment(op.id), chargerJustificatifs(chantier.id)]);
  if (f.erreur || !f.ligne) return { erreur: `fiche illisible (${f.erreur || "absente"})` };
  const mo = await chargerMotifVersion(chantier.id, f.ligne.version);
  if (mo.erreur) return { erreur: `historique du chantier illisible (${mo.erreur})` };
  const contexte = { adresse: op.adresse || null, batiment: b.ligne, batimentErreur: b.erreur, clientErreur, motifTrouve: mo.trouve };
  if (j.erreur || b.erreur) {
    return { fiche: f.ligne, justificatifs: j.liste, contexte, erreur: j.erreur ? `justificatifs illisibles (${j.erreur})` : `bâtiment illisible (${b.erreur})` };
  }
  const contenu = contenuVersion({ fiche: f.ligne, chantier, operation: op, clientLibelle, batiment: b.ligne, justificatifs: j.liste, motif: mo.motif });
  const empreinte = await empreinteContenu(contenu);
  return { fiche: f.ligne, batiment: b.ligne, justificatifs: j.liste, motif: mo.motif, contenu, empreinte, contexte, erreur: null };
}

/**
 * Signature « établie par » ou « chef d'équipe » de la version en cours.
 * Refusée si le contenu en base n'est plus celui affiché (empreinte
 * différente) ou si la fiche n'est pas complète. Image PNG déposée dans
 * securite-preuves sous signatures/{fiche_id}/ (nom nouveau à chaque fois).
 * `pourMoi` : la personne connectée signe (compte rattaché) ; sinon le compte
 * est laissé vide (la base refuse de signer au nom d'un autre compte).
 * → { signature, erreur }
 */
export async function signerFiche({ chantier, op, clientLibelle, clientErreur, type, nom, entreprise, pourMoi, png, empreinteAttendue, aujourdhui }) {
  try {
    if (!["etablie_par", "chef_equipe"].includes(type)) return { signature: null, erreur: "type de signature inconnu" };
    if (!String(nom || "").trim()) return { signature: null, erreur: "nom du signataire obligatoire" };
    if (!png) return { signature: null, erreur: "signature vide" };
    const a = await lireContenuAFiger({ chantier, op, clientLibelle, clientErreur });
    if (a.erreur) return { signature: null, erreur: a.erreur };
    if (a.empreinte !== empreinteAttendue) return { signature: null, erreur: "la fiche (ou le bâtiment, le client, un justificatif) a changé depuis son affichage : fermez puis rouvrez la fiche avant de signer" };
    const etat = etatValidation({ fiche: a.fiche, contexte: a.contexte, justificatifs: a.justificatifs, signatures: [], empreinte: a.empreinte, aujourdhui });
    if (!etat.contenuComplet) return { signature: null, erreur: "la fiche n'est pas complète : la signature se fait en dernier" };
    const alea = (() => { try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); } })();
    const chemin = cheminSignature({ ficheId: a.fiche.id, version: a.fiche.version, type, horodatage: Date.now(), alea });
    const depot = await deposerPreuveSecurite(png, chemin, "image/png");
    if (!depot) return { signature: null, erreur: derniereErreurDocument() || "image de signature non enregistrée" };
    const ligne = {
      fiche_id: a.fiche.id, version: a.fiche.version, type,
      signataire_nom: String(nom).trim(), signataire_entreprise: String(entreprise || "").trim() || null,
      image_path: depot.path, empreinte_version: a.empreinte,
      ...(pourMoi ? {} : { auth_user_id: null }), // pourMoi : défaut de la base = compte connecté
    };
    const { data, error } = await supabase.from("securite_signatures").insert(ligne).select(COLS_SIGNATURE).single();
    if (error) return { signature: null, erreur: `${error.message} (l'image déposée reste conservée, sans effet)` };
    return { signature: data, erreur: null };
  } catch (e) {
    return { signature: null, erreur: msg(e) };
  }
}

/**
 * Validation de la fiche. Ordre des écritures :
 *   1. relecture complète, règles strictes, empreinte recalculée, les 2
 *      signatures doivent porter CETTE empreinte sur la version en cours ;
 *   2. ligne securite_fiches_versions (contenu complet + empreinte) ;
 *      si elle existe déjà (essai précédent interrompu) : même empreinte → on
 *      continue ; empreinte différente → arrêt, `versionDejaFigee` ;
 *   3. fiche → « validée » (seulement si toujours en brouillon, même version,
 *      non modifiée depuis la relecture) ;
 *   4. entrée au journal du chantier (événement fiche_securite).
 * → { ligne, erreur, manquants, versionDejaFigee, avertissement }
 */
export async function validerFicheSecurite({ chantier, op, clientLibelle, clientErreur, auteur, aujourdhui }) {
  try {
    const a = await lireContenuAFiger({ chantier, op, clientLibelle, clientErreur });
    if (a.erreur) return { erreur: a.erreur };
    const s = await chargerSignatures(a.fiche.id);
    if (s.erreur) return { erreur: `signatures illisibles (${s.erreur})` };
    const etat = etatValidation({ fiche: a.fiche, contexte: a.contexte, justificatifs: a.justificatifs, signatures: s.liste, empreinte: a.empreinte, aujourdhui });
    if (!etat.peutValider) return { erreur: "la fiche n'est pas validable", manquants: etat };

    const { error: eV } = await supabase.from("securite_fiches_versions").insert({
      fiche_id: a.fiche.id, version: a.fiche.version, contenu: a.contenu, motif_changement: a.motif,
      empreinte: a.empreinte, cree_par: auteur || null,
    });
    if (eV) {
      if (eV.code !== "23505") return { erreur: `version non enregistrée (${eV.message})` };
      const { data: ex, error: eX } = await supabase.from("securite_fiches_versions").select("empreinte")
        .eq("fiche_id", a.fiche.id).eq("version", a.fiche.version).maybeSingle();
      if (eX || !ex) return { erreur: `version existante illisible (${eX?.message || "introuvable"})` };
      if (ex.empreinte !== a.empreinte) {
        return { erreur: `la v${a.fiche.version} a déjà été figée avec un autre contenu (validation interrompue puis fiche modifiée)`, versionDejaFigee: true };
      }
    }

    const { data, error } = await supabase.from("securite_fiches")
      .update({ statut: "validee", validee_le: new Date().toISOString(), validee_par: auteur || null, maj_par: auteur || null })
      .eq("id", a.fiche.id).eq("statut", "brouillon").eq("version", a.fiche.version).eq("updated_at", a.fiche.updated_at)
      .select(COLS_FICHE);
    if (error) return { erreur: `version figée, mais fiche non passée en « validée » (${error.message}) : relancez la validation` };
    if (!data || data.length !== 1) return { erreur: "version figée, mais la fiche a été modifiée au même moment : rechargez puis relancez la validation" };

    const j = await journaliserStatut(entreeJournalValidation({ chantierId: chantier.id, version: a.fiche.version, auteur, empreinte: a.empreinte }));
    return { ligne: data[0], erreur: null, avertissement: j.ok ? null : `Fiche validée, mais l'historique du chantier n'a pas été complété (${j.erreur}).` };
  } catch (e) {
    return { erreur: msg(e) };
  }
}

/**
 * « Mettre à jour » : nouvelle version en brouillon, motif obligatoire.
 * Le journal est écrit AVANT la fiche : le motif y est relu à la validation
 * de la nouvelle version (et figé dans sa ligne de version).
 * → { ligne, erreur }
 */
export async function mettreAJourFiche({ fiche, motif, auteur, versionDejaFigee = false }) {
  try {
    const prep = preparerMiseAJour(fiche, motif, { versionDejaFigee });
    if (!prep.ok) return { ligne: null, erreur: prep.erreur };
    const j = await journaliserStatut(entreeJournalMiseAJour({ chantierId: fiche.chantier_id, versionAvant: prep.versionAvant, statutAvant: fiche.statut, auteur, motif }));
    if (!j.ok) return { ligne: null, erreur: `historique du chantier non écrit (${j.erreur}) : rien n'a été modifié` };
    const { data, error } = await supabase.from("securite_fiches")
      .update({ ...prep.patch, maj_par: auteur || null })
      .eq("id", fiche.id).eq("statut", fiche.statut).eq("version", fiche.version)
      .select(COLS_FICHE);
    if (error) return { ligne: null, erreur: error.message };
    if (!data || data.length !== 1) return { ligne: null, erreur: "la fiche a changé entre-temps : rechargez-la" };
    return { ligne: data[0], erreur: null };
  } catch (e) {
    return { ligne: null, erreur: msg(e) };
  }
}

/**
 * Données de la pastille rouge du panneau : réponses des fiches et
 * justificatifs actifs des chantiers, passés à la MÊME règle que la fiche
 * (justificatifsPourPastille). → { parChantier: { [id]: { manquants, expires } | null }, erreur }
 */
export async function chargerJustificatifsPastilles(chantierIds, aujourdhui) {
  const ids = [...new Set((chantierIds || []).filter(Boolean).map(String))];
  if (!ids.length) return { parChantier: {}, erreur: null };
  try {
    const [f, j] = await Promise.all([
      supabase.from("securite_fiches").select("chantier_id, reponses").in("chantier_id", ids),
      supabase.from("securite_justificatifs").select("chantier_id, point, type_code, expire_le, archive_le, date_document, created_at")
        .eq("portee", "chantier").in("chantier_id", ids).is("archive_le", null),
    ]);
    if (f.error || j.error) return { parChantier: {}, erreur: (f.error || j.error).message };
    const parChantier = {};
    (f.data || []).forEach((l) => {
      const justifs = (j.data || []).filter((x) => x.chantier_id === l.chantier_id);
      parChantier[l.chantier_id] = justificatifsPourPastille({ reponses: l.reponses, justificatifs: justifs, aujourdhui });
    });
    return { parChantier, erreur: null };
  } catch (e) {
    return { parChantier: {}, erreur: msg(e) };
  }
}

// ─── Tâche 5 : PDF de chaque version validée ─────────────────────────────────
// Le PDF est construit à partir du CONTENU FIGÉ de la version (jamais de la
// fiche courante), déposé dans securite-preuves sous versions/{fiche_id}/
// (nom nouveau à chaque fois : le bucket refuse tout remplacement), puis
// rattaché à la version par pdf_path — une seule fois (déclencheur en base).
// Mise en page : securitePdf.mjs ; rendu navigateur : securitePdfRendu.js.

const COLS_VERSION_CONTENU = `${COLS_VERSION}, contenu`;

/**
 * Tout ce qu'il faut pour le PDF d'une version figée. Le contenu est
 * contrôlé contre son empreinte : un contenu qui ne correspond plus à
 * l'empreinte signée ne donne pas de PDF (impossibilité visible).
 * → { version (ligne avec contenu), versions, signatures, erreur }
 */
export async function chargerDonneesPdfVersion(ficheId, numero) {
  if (!ficheId || !Number.isInteger(numero)) return { erreur: "version inconnue" };
  try {
    const [v, vs, s] = await Promise.all([
      supabase.from("securite_fiches_versions").select(COLS_VERSION_CONTENU).eq("fiche_id", ficheId).eq("version", numero).maybeSingle(),
      chargerVersions(ficheId),
      chargerSignatures(ficheId),
    ]);
    if (v.error) return { erreur: `version illisible (${v.error.message})` };
    if (!v.data) return { erreur: `v${numero} introuvable` };
    if (vs.erreur) return { erreur: `historique des versions illisible (${vs.erreur})` };
    if (s.erreur) return { erreur: `signatures illisibles (${s.erreur})` };
    const h = await empreinteContenu(v.data.contenu);
    if (h !== v.data.empreinte) return { erreur: "le contenu figé ne correspond pas à son empreinte" };
    return { version: v.data, versions: vs.liste, signatures: s.liste, erreur: null };
  } catch (e) {
    return { erreur: msg(e) };
  }
}

/** Image d'une signature (securite-preuves) → { blob, erreur }. */
export async function lireImageSignature(path) {
  const blob = await lirePreuveSecurite(path);
  return { blob, erreur: blob ? null : (derniereErreurDocument() || "lecture impossible") };
}

/**
 * Dépose le PDF d'une version et le rattache (pdf_path, une seule fois).
 * Si un autre poste l'a rattaché entre-temps, c'est le sien qui fait foi :
 * le fichier déposé ici reste stocké, sans effet (rien ne s'efface).
 * → { path, erreur, avertissement }
 */
export async function enregistrerPdfVersion({ ligne, blob }) {
  try {
    if (!ligne?.id) return { path: null, erreur: "version inconnue" };
    if (ligne.pdf_path) return { path: ligne.pdf_path, erreur: null, avertissement: null };
    if (!blob) return { path: null, erreur: "PDF vide" };
    const alea = (() => { try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); } })();
    const chemin = cheminPdfVersion({ ficheId: ligne.fiche_id, version: ligne.version, horodatage: Date.now(), alea });
    const depot = await deposerPreuveSecurite(blob, chemin, "application/pdf");
    if (!depot) return { path: null, erreur: derniereErreurDocument() || "PDF non déposé" };
    const { data, error } = await supabase.from("securite_fiches_versions")
      .update({ pdf_path: chemin }).eq("id", ligne.id).is("pdf_path", null)
      .select("id, pdf_path");
    if (error) return { path: null, erreur: `PDF déposé mais non rattaché à la version (${error.message})` };
    if (data && data.length === 1) return { path: chemin, erreur: null, avertissement: null };
    const { data: ex, error: eX } = await supabase.from("securite_fiches_versions").select("pdf_path").eq("id", ligne.id).maybeSingle();
    if (!eX && ex?.pdf_path) {
      return { path: ex.pdf_path, erreur: null, avertissement: "Un PDF avait déjà été enregistré pour cette version par un autre poste : c'est celui-là qui fait foi." };
    }
    return { path: null, erreur: `PDF déposé mais non rattaché à la version (${eX?.message || "version introuvable"})` };
  } catch (e) {
    return { path: null, erreur: msg(e) };
  }
}

/** Lien signé (10 min) de téléchargement du PDF d'une version. → { url, erreur } */
export async function urlPdfVersion(path, nomFichier) {
  const url = await urlPreuveSecurite(path, 600, { download: nomFichier || true });
  return { url, erreur: url ? null : (derniereErreurDocument() || "lecture impossible") };
}

// ─── Tâche 6 : pré-remplissage (lecture seule) ───────────────────────────────
// Sources des propositions (règles : securitePreRemplissage.mjs, module pur).
// Chaque source a sa propre erreur : une source illisible donne « à
// compléter » avec la raison, jamais « non concerné ». Aucune écriture.
//   - phasage : même lecture que la page Planning (loadPhasagesPourLiaison :
//     null = lecture en échec, chantier absent = pas de phasage) ;
//   - planning : planning_cells des chantiers non archivés de l'opération
//     (celui de la fiche + les autres, pour signaler les jours isolés où
//     quelqu'un travaille sur un autre logement du même bâtiment) ;
//   - ressources : planning_resources (reconnaître les prestataires) ;
//   - commandes : commande_lignes du chantier, en aide au point 8 (bons
//     remplacés par leur BL et lignes de migration écartés, même règle que
//     achatsParMois.mjs : une livraison n'est pas comptée deux fois).

const PAGE = 1000;
async function toutesLesLignes(requete) {
  const out = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await requete().range(debut, debut + PAGE - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}

/**
 * Tout ce qu'il faut pour calculer les propositions d'une fiche.
 * → { phasage, planning, planningOperation, ressources, commandes } (chacun avec son `erreur`)
 */
export async function chargerDonneesPreRemplissage({ chantier, op }) {
  const id = String(chantier.id);
  const lirePhasage = async () => {
    try {
      const m = await loadPhasagesPourLiaison([id]);
      if (m === null) return { ouvrages: null, erreur: "lecture du phasage impossible" };
      return { ouvrages: m[id] ? m[id].ouvrages : null, erreur: null };
    } catch (e) { return { ouvrages: null, erreur: msg(e) }; }
  };
  const lirePlanning = async () => {
    try {
      let ids = [id];
      const noms = {};
      let erreurOp = null;
      if (op?.id) {
        const { data, error } = await supabase.from("chantiers").select("id, nom, archive_le").eq("operation_id", String(op.id));
        if (error) erreurOp = error.message;
        else (data || []).filter((c) => !c.archive_le).forEach((c) => { noms[c.id] = c.nom; if (c.id !== id) ids.push(c.id); });
      }
      const { data, error } = await toutesLesLignes(() => supabase.from("planning_cells")
        .select("chantier_id, week_id, jour, ouvriers").in("chantier_id", ids).order("id"));
      if (error) return { planning: { cellules: null, erreur: error.message }, planningOperation: { cellules: null, erreur: error.message } };
      return {
        planning: { cellules: data.filter((c) => c.chantier_id === id), erreur: null },
        planningOperation: erreurOp ? { cellules: null, erreur: erreurOp } : { cellules: data.filter((c) => c.chantier_id !== id), nomsChantiers: noms, erreur: null },
      };
    } catch (e) {
      return { planning: { cellules: null, erreur: msg(e) }, planningOperation: { cellules: null, erreur: msg(e) } };
    }
  };
  const lireRessources = async () => {
    try {
      const { data, error } = await supabase.from("planning_resources").select("id, nom, nom_planning, kind, actif");
      return error ? { liste: null, erreur: error.message } : { liste: data || [], erreur: null };
    } catch (e) { return { liste: null, erreur: msg(e) }; }
  };
  const lireCommandes = async () => {
    try {
      const { data: lignes, error } = await toutesLesLignes(() => supabase.from("commande_lignes")
        .select("id, commande_id, libelle, quantite, unite, lot_id").eq("chantier_id", id).order("id"));
      if (error) return { lignes: null, erreur: error.message };
      const idsCmd = [...new Set(lignes.map((l) => l.commande_id).filter(Boolean))];
      if (!idsCmd.length) return { lignes: [], erreur: null };
      const { data: cmds, error: e2 } = await supabase.from("commandes").select("id, source, remplace_par_id").in("id", idsCmd);
      if (e2) return { lignes: null, erreur: e2.message };
      const ecartees = new Set((cmds || []).filter((c) => c.source === "migration" || c.remplace_par_id).map((c) => c.id));
      return { lignes: lignes.filter((l) => !ecartees.has(l.commande_id)), erreur: null };
    } catch (e) { return { lignes: null, erreur: msg(e) }; }
  };
  const [phasage, pl, ressources, commandes] = await Promise.all([lirePhasage(), lirePlanning(), lireRessources(), lireCommandes()]);
  return { phasage, planning: pl.planning, planningOperation: pl.planningOperation, ressources, commandes };
}

// ─── Tâche 8 : accueil de l'équipe, mise à jour proposée ─────────────────────
// Règles (module pur) : securiteAccueil.mjs. Ici : lectures et écritures.
//   - l'ouvrier lit la fiche et les versions figées des chantiers non archivés,
//     et seulement SES signatures (règles de la base, migration 20261125121322) ;
//   - signature d'accueil : image dans securite-preuves sous
//     signatures/{fiche_id}/ (nom toujours nouveau), puis ligne
//     securite_signatures (type accueil, version en cours, empreinte de la
//     version figée). Ouvrier : son compte (défaut de la base = auth.uid()) ;
//     bureau (tablette) : sous-traitant sans compte, auth_user_id vide.
//   - « à mettre à jour » : seulement sur clic au bureau, jamais en arrière-plan.

/**
 * Versions figées d'une fiche AVEC leur contenu ; chaque contenu est contrôlé
 * contre son empreinte (empreinteVerifiee). → { liste, erreur }
 */
export async function chargerVersionsAvecContenu(ficheId) {
  if (!ficheId) return { liste: null, erreur: "fiche inconnue" };
  try {
    const { data, error } = await supabase.from("securite_fiches_versions").select(COLS_VERSION_CONTENU)
      .eq("fiche_id", ficheId).order("version", { ascending: true });
    if (error) return { liste: null, erreur: error.message };
    const liste = [];
    for (const v of data || []) {
      let ok = false;
      try { ok = (await empreinteContenu(v.contenu)) === v.empreinte; } catch { ok = false; }
      liste.push({ ...v, empreinteVerifiee: ok });
    }
    return { liste, erreur: null };
  } catch (e) {
    return { liste: null, erreur: msg(e) };
  }
}

/**
 * Tout ce que l'ouvrier connecté doit voir pour un chantier : fiche, versions
 * (avec contenu) et ses propres signatures. → { fiche, versions, signatures, erreur }
 */
export async function chargerAccueilChantier(chantierId) {
  const f = await chargerFiche(chantierId);
  if (f.erreur) return { fiche: null, versions: [], signatures: [], erreur: f.erreur };
  if (!f.ligne) return { fiche: null, versions: [], signatures: [], erreur: null };
  const [v, s] = await Promise.all([chargerVersionsAvecContenu(f.ligne.id), chargerSignatures(f.ligne.id)]);
  if (v.erreur) return { fiche: f.ligne, versions: [], signatures: [], erreur: `versions illisibles (${v.erreur})` };
  if (s.erreur) return { fiche: f.ligne, versions: v.liste, signatures: [], erreur: `signatures illisibles (${s.erreur})` };
  return { fiche: f.ligne, versions: v.liste, signatures: s.liste, erreur: null };
}

/**
 * Signature d'accueil sur la version validée en cours.
 * `sansCompte` : signature prise au bureau pour une personne sans compte
 * (sous-traitant) : auth_user_id vide. Sinon : compte connecté (ouvrier).
 * Relit la fiche et la version juste avant : refus si la fiche a changé
 * (version, statut) depuis l'affichage. → { signature, erreur }
 */
export async function signerAccueil({ ficheId, chantierId, version, empreinte, nom, entreprise, png, sansCompte = false, statutsPermis = ["validee"] }) {
  try {
    if (!String(nom || "").trim()) return { signature: null, erreur: "nom du signataire obligatoire" };
    if (!png) return { signature: null, erreur: "signature vide" };
    const f = await chargerFiche(chantierId);
    if (f.erreur || !f.ligne) return { signature: null, erreur: `fiche illisible (${f.erreur || "absente"})` };
    if (f.ligne.id !== ficheId || f.ligne.version !== version) return { signature: null, erreur: "la fiche a changé depuis son affichage : rechargez-la avant de signer" };
    if (!statutsPermis.includes(f.ligne.statut)) return { signature: null, erreur: "la fiche n'est plus validée : signature impossible pour l'instant" };
    const { data: v, error: eV } = await supabase.from("securite_fiches_versions").select("empreinte")
      .eq("fiche_id", ficheId).eq("version", version).maybeSingle();
    if (eV || !v) return { signature: null, erreur: `version figée illisible (${eV?.message || "introuvable"})` };
    if (v.empreinte !== empreinte) return { signature: null, erreur: "le contenu de la version ne correspond plus à celui affiché : rechargez" };
    const alea = (() => { try { return crypto.randomUUID().slice(0, 8); } catch { return Math.random().toString(36).slice(2, 10); } })();
    const chemin = cheminSignature({ ficheId, version, type: "accueil", horodatage: Date.now(), alea });
    const depot = await deposerPreuveSecurite(png, chemin, "image/png");
    if (!depot) return { signature: null, erreur: derniereErreurDocument() || "image de signature non enregistrée" };
    const ligne = {
      fiche_id: ficheId, version, type: "accueil",
      signataire_nom: String(nom).trim(), signataire_entreprise: String(entreprise || "").trim() || null,
      image_path: depot.path, empreinte_version: empreinte,
      ...(sansCompte ? { auth_user_id: null } : {}), // sinon : défaut de la base = compte connecté
    };
    const { data, error } = await supabase.from("securite_signatures").insert(ligne).select(COLS_SIGNATURE).single();
    if (error) return { signature: null, erreur: `${error.message} (l'image déposée reste conservée, sans effet)` };
    return { signature: data, erreur: null };
  } catch (e) {
    return { signature: null, erreur: msg(e) };
  }
}

/**
 * Passe une fiche validée en « à mettre à jour » (clic au bureau). Écriture
 * seulement si la fiche est toujours validée, à la même version ; puis
 * entrée au journal du chantier. `prep` : preparerAMettreAJour (module pur).
 * → { ligne, erreur, avertissement }
 */
export async function marquerAMettreAJour({ fiche, prep }) {
  try {
    if (!prep?.ok) return { ligne: null, erreur: prep?.raison || "passage impossible" };
    const { data, error } = await supabase.from("securite_fiches").update(prep.patch)
      .eq("id", fiche.id).eq("statut", "validee").eq("version", fiche.version).select(COLS_FICHE);
    if (error) return { ligne: null, erreur: error.message };
    if (!data || data.length !== 1) return { ligne: null, erreur: "la fiche a changé entre-temps : rechargez-la" };
    const j = await journaliserStatut(prep.journal);
    return { ligne: data[0], erreur: null, avertissement: j.ok ? null : `Fiche marquée, mais l'historique du chantier n'a pas été complété (${j.erreur}).` };
  } catch (e) {
    return { ligne: null, erreur: msg(e) };
  }
}

/**
 * Tout ce qu'il faut pour savoir si une mise à jour est proposée pour la fiche
 * validée d'un chantier (panneau de l'opération) : fiche, sources du
 * pré-remplissage, bâtiment, justificatifs. Lecture seule.
 * → { fiche, sources, justificatifs, erreur }
 */
export async function chargerDonneesMiseAJourProposee({ chantier, op }) {
  const f = await chargerFiche(chantier.id);
  if (f.erreur || !f.ligne) return { fiche: null, erreur: f.erreur || "fiche absente" };
  const [d, b, j] = await Promise.all([chargerDonneesPreRemplissage({ chantier, op }), chargerBatiment(op.id), chargerJustificatifs(chantier.id)]);
  return {
    fiche: f.ligne,
    sources: { ...d, batiment: { ligne: b.ligne, erreur: b.erreur } },
    justificatifs: j.erreur ? null : j.liste,
    erreur: null,
  };
}
