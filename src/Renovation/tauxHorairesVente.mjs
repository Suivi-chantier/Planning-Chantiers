// ─── TAUX HORAIRES DE VENTE — RÈGLES PURES ───────────────────────────────────
// Liste configurable des taux horaires de vente de main-d'œuvre (table Supabase
// taux_horaires_vente). Module PUR : aucun accès Supabase. Il porte les règles
// de gestion partagées par Réglages → Taux horaires (TauxHorairesVenteAdmin.jsx),
// la fiche ouvrage (Bibliotheque.jsx) et le Chiffrage, ainsi que la traduction
// des erreurs Supabase en messages lisibles. Testé par
// scripts/verif-taux-horaires-vente.mjs.
//
// Les garanties fortes vivent en base (migration 20260915140000) : un seul
// défaut, défaut toujours actif, défaut ni désactivable ni supprimable, au moins
// un actif, taux inactif/inexistant refusé sur un ouvrage, RLS écriture admin.
// Ce module ne fait que les anticiper côté interface (boutons grisés, messages)
// et ne remplace jamais le contrôle serveur.

import { arrondirMontant, num, validerTauxHoraire } from "./chiffragePricing.mjs";

/** Taux créé par la migration : actif et par défaut. */
export const TAUX_STANDARD = Object.freeze({ libelle: "Taux standard", taux_ht: 80 });

const str = (v) => String(v ?? "").trim();

// ─── Formatage ───────────────────────────────────────────────────────────────
/** 80 → « 80,00 € HT/h » (2 décimales, fr-FR). */
export function formaterTauxHT(taux) {
  const t = num(taux);
  if (t == null) return "—";
  return `${t.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT/h`;
}

/** « Taux standard — 80,00 € HT/h » (+ « (désactivé) » si demandé et inactif). */
export function libelleTaux(taux, { mentionInactif = true } = {}) {
  if (!taux) return "—";
  const base = `${str(taux.libelle) || "Sans libellé"} — ${formaterTauxHT(taux.taux_ht)}`;
  return mentionInactif && taux.actif === false ? `${base} (désactivé)` : base;
}

/** « 2,50 h × 80,00 €/h = 200,00 € HT » — explication du prix MO d'un ouvrage. */
export function expliquerPrixMainOeuvre(cadence, tauxHT) {
  const h = num(cadence), t = num(tauxHT);
  if (h == null || h <= 0 || t == null || t <= 0) return null;
  const fmt2 = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt2(h)} h × ${fmt2(t)} €/h = ${fmt2(arrondirMontant(h * t))} € HT`;
}

// ─── Lecture de la liste ─────────────────────────────────────────────────────
export function indexerTaux(liste = []) {
  const map = new Map();
  (liste || []).forEach(t => { if (t && t.id != null) map.set(String(t.id), t); });
  return map;
}

/** Taux actifs, triés : défaut d'abord, puis libellé. */
export function tauxActifs(liste = []) {
  return (liste || []).filter(t => t && t.actif !== false).sort(comparerTaux);
}

/** Le taux actif par défaut, ou null s'il n'en existe pas (état anormal signalé par l'interface). */
export function tauxParDefaut(liste = []) {
  return (liste || []).find(t => t && t.est_defaut === true && t.actif !== false) ?? null;
}

export function comparerTaux(a, b) {
  if ((a?.est_defaut === true) !== (b?.est_defaut === true)) return a?.est_defaut ? -1 : 1;
  if ((a?.actif !== false) !== (b?.actif !== false)) return a?.actif !== false ? -1 : 1;
  return str(a?.libelle).localeCompare(str(b?.libelle), "fr");
}

/**
 * Options de la liste déroulante d'une fiche ouvrage : les taux actifs, plus le
 * taux courant de l'ouvrage s'il est désactivé (affiché « (désactivé) », pour
 * permettre d'en choisir un autre). Jamais les autres taux inactifs.
 * @returns {Array<{ id, libelle, taux_ht, actif, est_defaut, texte, desactive }>}
 */
export function optionsSelectTaux(liste = [], idCourant = null) {
  const actifs = tauxActifs(liste);
  const options = actifs.map(t => ({ id: String(t.id), libelle: t.libelle, taux_ht: num(t.taux_ht), actif: true, est_defaut: t.est_defaut === true, texte: libelleTaux(t), desactive: false }));
  const courant = idCourant != null ? indexerTaux(liste).get(String(idCourant)) : null;
  if (courant && courant.actif === false) {
    options.push({ id: String(courant.id), libelle: courant.libelle, taux_ht: num(courant.taux_ht), actif: false, est_defaut: false, texte: libelleTaux(courant), desactive: true });
  }
  return options;
}

/**
 * Identifiant à présélectionner dans une fiche : le taux enregistré sur l'ouvrage
 * (même désactivé), sinon le taux actif par défaut, sinon null.
 */
export function tauxSelectionne(liste = [], idCourant = null) {
  const index = indexerTaux(liste);
  if (idCourant != null && index.has(String(idCourant))) return String(idCourant);
  const d = tauxParDefaut(liste);
  return d ? String(d.id) : null;
}

/**
 * Le taux choisi pour un ouvrage est-il enregistrable ? Il doit exister et être
 * actif, sauf s'il est déjà celui de l'ouvrage (conservation d'un taux désactivé).
 */
export function validerTauxOuvrage(liste = [], idChoisi, idActuel = null) {
  if (idChoisi == null || str(idChoisi) === "") return { valide: false, erreur: "Taux horaire de main-d'œuvre obligatoire : sélectionner un taux dans la liste" };
  const t = indexerTaux(liste).get(String(idChoisi));
  if (!t) return { valide: false, erreur: "Taux horaire inconnu : recharger la page puis choisir un taux de la liste" };
  if (t.actif === false && String(idChoisi) !== String(idActuel ?? "")) return { valide: false, erreur: `Le taux « ${t.libelle} » est désactivé : choisir un taux actif` };
  return { valide: true, erreur: null, taux: t };
}

// ─── Saisie d'un taux (Réglages) ─────────────────────────────────────────────
/**
 * Contrôle d'un formulaire de taux (ajout ou modification).
 * @returns {{ valide, erreurs: string[], valeur: { libelle, taux_ht }|null }}
 */
export function validerSaisieTaux({ libelle, taux_ht } = {}, liste = [], idEnCours = null) {
  const erreurs = [];
  const lib = str(libelle);
  if (!lib) erreurs.push("Le libellé est obligatoire");
  const t = validerTauxHoraire(taux_ht);
  if (!t.valide) erreurs.push(t.erreur);
  const doublon = (liste || []).find(x => x && String(x.id) !== String(idEnCours ?? "") && str(x.libelle).toLowerCase() === lib.toLowerCase());
  if (lib && doublon) erreurs.push(`Un taux « ${doublon.libelle} » existe déjà`);
  return { valide: erreurs.length === 0, erreurs, valeur: erreurs.length === 0 ? { libelle: lib, taux_ht: t.valeur } : null };
}

/** Peut-on désactiver ce taux ? Jamais le taux par défaut, jamais le dernier actif. */
export function peutDesactiver(taux, liste = []) {
  if (!taux) return { ok: false, raison: "Taux inconnu" };
  if (taux.actif === false) return { ok: false, raison: "Ce taux est déjà désactivé" };
  if (taux.est_defaut) return { ok: false, raison: "Le taux par défaut ne peut pas être désactivé : définir d'abord un autre taux actif par défaut" };
  const autresActifs = (liste || []).filter(t => t && t.actif !== false && String(t.id) !== String(taux.id));
  if (autresActifs.length === 0) return { ok: false, raison: "Il doit rester au moins un taux actif" };
  return { ok: true, raison: null };
}

/** Peut-on réactiver ce taux ? Seulement s'il est désactivé. */
export function peutReactiver(taux) {
  if (!taux) return { ok: false, raison: "Taux inconnu" };
  if (taux.actif !== false) return { ok: false, raison: "Ce taux est déjà actif" };
  return { ok: true, raison: null };
}

/** Peut-on définir ce taux comme taux par défaut ? Il doit être actif et ne pas l'être déjà. */
export function peutDefinirDefaut(taux) {
  if (!taux) return { ok: false, raison: "Taux inconnu" };
  if (taux.actif === false) return { ok: false, raison: "Un taux désactivé ne peut pas être le taux par défaut : le réactiver d'abord" };
  if (taux.est_defaut) return { ok: false, raison: "Ce taux est déjà le taux par défaut" };
  return { ok: true, raison: null };
}

/**
 * Avertissement à afficher AVANT d'enregistrer une modification de valeur.
 * Rend null si la valeur ne change pas (un simple renommage n'affecte aucun prix).
 */
export function avertissementModificationTaux(ancien, nouveauTauxHT, { nbOuvrages = null } = {}) {
  const a = num(ancien?.taux_ht), n = num(nouveauTauxHT);
  if (a == null || n == null || Math.abs(a - n) < 0.005) return null;
  const qui = nbOuvrages != null ? `des ${nbOuvrages} ouvrage${nbOuvrages > 1 ? "s" : ""} utilisant ce taux` : "des ouvrages utilisant ce taux";
  return `Cette modification (${formaterTauxHT(a)} → ${formaterTauxHT(n)}) affectera le prix calculé ${qui} pour les futurs chiffrages. Les devis déjà figés ne seront pas modifiés.`;
}

/** Invariants de la liste (affichés en bandeau si la base est dans un état anormal). */
export function diagnostiquerListe(liste = []) {
  const actifs = tauxActifs(liste);
  const defauts = (liste || []).filter(t => t && t.est_defaut === true);
  const problemes = [];
  if ((liste || []).length === 0) problemes.push("Aucun taux horaire : la migration 20260915140000_taux_horaires_vente.sql n'a pas été appliquée");
  else {
    if (actifs.length === 0) problemes.push("Aucun taux actif : aucun prix de main-d'œuvre ne peut être calculé");
    if (defauts.length === 0) problemes.push("Aucun taux par défaut : les nouveaux ouvrages n'auront pas de taux présélectionné");
    if (defauts.length > 1) problemes.push("Plusieurs taux par défaut : état incohérent");
    if (defauts.some(t => t.actif === false)) problemes.push("Le taux par défaut est désactivé : état incohérent");
  }
  return { ok: problemes.length === 0, problemes, nbActifs: actifs.length, defaut: tauxParDefaut(liste) };
}

// ─── Erreurs Supabase → message ─────────────────────────────────────────────
/**
 * Traduit une erreur PostgREST/Postgres en message clair. Ne masque jamais
 * l'échec : si rien n'est reconnu, le message brut est rendu.
 */
export function messageErreurSupabase(error, { action = "L'enregistrement" } = {}) {
  if (!error) return null;
  const code = str(error.code);
  const brut = str(error.message) || str(error.details) || "erreur inconnue";
  if (code === "42501" || /row-level security|permission denied/i.test(brut)) {
    return `${action} a été refusé : la modification des taux horaires est réservée aux administrateurs.`;
  }
  if (code === "23505") {
    if (/defaut/i.test(brut)) return `${action} a échoué : il existe déjà un taux par défaut.`;
    if (/libelle/i.test(brut)) return `${action} a échoué : un taux porte déjà ce libellé.`;
    return `${action} a échoué : doublon (${brut}).`;
  }
  if (code === "23514") {
    if (/taux_ht/i.test(brut)) return `${action} a échoué : le taux HT/h doit être strictement supérieur à zéro.`;
    if (/libelle/i.test(brut)) return `${action} a échoué : le libellé ne peut pas être vide.`;
    if (/defaut_actif/i.test(brut)) return `${action} a échoué : un taux désactivé ne peut pas être le taux par défaut.`;
    return `${action} a échoué : contrainte non respectée (${brut}).`;
  }
  if (code === "23503") return `${action} a échoué : ce taux horaire n'existe pas (ou plus). Recharger la page.`;
  if (code === "P0001") return `${action} a échoué : ${brut}`;
  if (/PGRST|Failed to fetch|NetworkError/i.test(brut)) return `${action} a échoué : connexion à Supabase impossible (${brut}). Rien n'a été enregistré.`;
  return `${action} a échoué : ${brut}`;
}
