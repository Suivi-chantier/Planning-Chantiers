// ─────────────────────────────────────────────────────────────────────────────
// chantiersTables — passage « objet chantier de l'application » ↔ ligne des
// tables public.chantiers / public.operations, et calcul des écritures
// LIGNE PAR LIGNE (Refonte Opérations, lot 1).
//
// Module PUR : aucun accès Supabase, aucune horloge. Les écritures réelles sont
// faites par chantiersDonnees.js, qui s'appuie sur ce calcul.
//
// Pourquoi un diff : l'application manipule toujours une LISTE de chantiers
// (même forme que l'ancien bloc planning_config "chantiers"). Pour ne plus
// réécrire les autres chantiers, on compare la liste voulue au dernier état
// connu du serveur et on n'envoie que ce qui a changé : les champs modifiés
// d'un chantier modifié, un INSERT pour un nouveau. Jamais de suppression : un
// chantier absent de la liste reste en base (l'archivage est un geste
// explicite, voir archiverChantier).
// ─────────────────────────────────────────────────────────────────────────────

/** Champs portés par une colonne ; tout le reste va dans `donnees` (jsonb). */
export const COLONNES_CHANTIER = Object.freeze(["id", "nom", "couleur", "statut", "operation_id"]);
export const COLONNES_OPERATION = Object.freeze(["id", "nom", "adresse", "couleur"]);
/** Champs propres aux tables, jamais recopiés dans `donnees`. */
const CHAMPS_TECHNIQUES = ["ordre", "donnees", "archive_le", "created_at", "updated_at", "creee_automatiquement"];

const COULEUR_DEFAUT = "#888888";
const txt = (v) => (v == null ? "" : String(v));
const texteOuNull = (v) => { const s = txt(v).trim(); return s || null; };

function restes(objet, colonnes) {
  const out = {};
  Object.keys(objet || {}).forEach((k) => {
    if (colonnes.includes(k) || CHAMPS_TECHNIQUES.includes(k)) return;
    if (objet[k] === undefined) return;
    out[k] = objet[k];
  });
  return out;
}

/** Comparaison profonde stable (ordre des clés indifférent). */
export function memeValeur(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => memeValeur(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && memeValeur(a[k], b[k]));
}

// ─── Lignes → objets de l'application (même forme que l'ancien bloc) ────────
export function depuisLigneChantier(ligne) {
  if (!ligne || !ligne.id) return null;
  const o = { ...(ligne.donnees && typeof ligne.donnees === "object" ? ligne.donnees : {}) };
  o.id = ligne.id;
  o.nom = txt(ligne.nom);
  o.couleur = ligne.couleur || COULEUR_DEFAUT;
  if (texteOuNull(ligne.statut)) o.statut = ligne.statut;
  if (texteOuNull(ligne.operation_id)) o.operation_id = ligne.operation_id;
  if (ligne.archive_le) o.archive_le = ligne.archive_le;
  return o;
}

export function depuisLigneOperation(ligne) {
  if (!ligne || !ligne.id) return null;
  const o = { ...(ligne.donnees && typeof ligne.donnees === "object" ? ligne.donnees : {}) };
  o.id = ligne.id;
  o.nom = txt(ligne.nom);
  o.adresse = txt(ligne.adresse);
  o.couleur = ligne.couleur || COULEUR_DEFAUT;
  if (ligne.creee_automatiquement) o.creee_automatiquement = true;
  if (ligne.archive_le) o.archive_le = ligne.archive_le;
  return o;
}

/** Tri d'affichage = ordre de l'ancien bloc (ordre, puis création, puis id). */
export function trierLignes(lignes) {
  return [...(Array.isArray(lignes) ? lignes : [])].sort((a, b) =>
    (Number(a.ordre) || 0) - (Number(b.ordre) || 0)
    || txt(a.created_at).localeCompare(txt(b.created_at))
    || txt(a.id).localeCompare(txt(b.id)));
}

// ─── Objets de l'application → champs de ligne ──────────────────────────────
export function versChampsChantier(objet) {
  return {
    id: txt(objet.id).trim(),
    nom: txt(objet.nom),
    couleur: texteOuNull(objet.couleur) || COULEUR_DEFAUT,
    statut: texteOuNull(objet.statut),
    operation_id: texteOuNull(objet.operation_id),
    donnees: restes(objet, COLONNES_CHANTIER),
  };
}

export function versChampsOperation(objet) {
  return {
    id: txt(objet.id).trim(),
    nom: txt(objet.nom),
    adresse: txt(objet.adresse),
    couleur: texteOuNull(objet.couleur) || COULEUR_DEFAUT,
    donnees: restes(objet, COLONNES_OPERATION),
  };
}

/**
 * Écritures nécessaires pour passer de `connues` (lignes serveur, Map id →
 * ligne) à `liste` (objets voulus, dans l'ordre voulu).
 *   → { inserts: [ligne], updates: [{ id, patch }] }
 * Règles :
 *   - seuls les champs qui changent sont envoyés (un chantier modifié ne
 *     réécrit ni les autres chantiers, ni ses propres champs inchangés) ;
 *   - operation_id vide n'est jamais envoyé : on ne détache pas un chantier
 *     (à la création, la base lui crée une opération à son nom) ;
 *   - l'ordre n'est réécrit que si l'ordre relatif des éléments connus a
 *     changé (une liste locale à laquelle manque un chantier créé par un
 *     collègue ne déplace rien) ;
 *   - un élément absent de `liste` n'est jamais supprimé ni archivé.
 */
export function calculerEcritures(connues, liste, { type = "chantier" } = {}) {
  const versChamps = type === "operation" ? versChampsOperation : versChampsChantier;
  const champsComparés = type === "operation"
    ? ["nom", "adresse", "couleur", "donnees"]
    : ["nom", "couleur", "statut", "operation_id", "donnees"];
  const map = connues instanceof Map ? connues : new Map();
  const voulus = [];
  const vus = new Set();
  (Array.isArray(liste) ? liste : []).forEach((o) => {
    if (!o || typeof o !== "object") return;
    const champs = versChamps(o);
    if (!champs.id || vus.has(champs.id)) return;
    vus.add(champs.id);
    voulus.push(champs);
  });

  // Ordre relatif des éléments déjà connus : a-t-il changé ?
  const idsConnusDansListe = voulus.map((c) => c.id).filter((id) => map.has(id));
  const ordreServeur = trierLignes(idsConnusDansListe.map((id) => map.get(id))).map((l) => l.id);
  const ordreChange = idsConnusDansListe.some((id, i) => id !== ordreServeur[i]);
  const ordreMax = [...map.values()].reduce((m, l) => Math.max(m, Number(l.ordre) || 0), -1);

  const inserts = [];
  const updates = [];
  let suivant = ordreMax + 1;
  voulus.forEach((champs, position) => {
    const connue = map.get(champs.id);
    if (!connue) {
      const ligne = { ...champs, ordre: suivant++ };
      if (type !== "operation" && !ligne.operation_id) delete ligne.operation_id;
      inserts.push(ligne);
      return;
    }
    const patch = {};
    champsComparés.forEach((k) => {
      if (k === "operation_id" && !champs.operation_id) return;
      const avant = k === "donnees" ? (connue.donnees || {}) : (connue[k] ?? null);
      if (!memeValeur(avant, champs[k] ?? null)) patch[k] = champs[k];
    });
    if (ordreChange) {
      const rang = idsConnusDansListe.indexOf(champs.id);
      const ordreVoulu = rang >= 0 ? rang : position;
      if ((Number(connue.ordre) || 0) !== ordreVoulu) patch.ordre = ordreVoulu;
    }
    if (Object.keys(patch).length) updates.push({ id: champs.id, patch });
  });
  return { inserts, updates };
}
