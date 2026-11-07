// ─────────────────────────────────────────────────────────────────────────────
// commandesAPasserPushV1 — quels articles de « Commandes à passer » la
// notification C3 annonce, et quand (projet docs/projets/notifications-push.md,
// tâche 10, décision de la direction : réponse « a »).
//
// La LISTE vient de commandesAPasserV1.mjs (même code que la page, inchangé).
// Ce module ne fait que choisir, dans cette liste :
//   - FENÊTRE : un article est annoncé quand sa date de besoin tombe dans les
//     7 prochains jours, aujourd'hui inclus (J à J+6, date de Paris) ;
//   - SANS DATE de besoin : jamais annoncé ;
//   - UNE SEULE FOIS : chaque article annoncé est inscrit dans
//     notifications_etat (type C3, cle_objet = cleCommandeAPasser) ;
//   - ARRIÉRÉ : au premier passage (pas encore de ligne de référence
//     « _reference »), les articles déjà en retard (date de besoin < J) sont
//     enregistrés comme vus SANS ENVOI. Ensuite, un article qui arrive déjà en
//     retard sans avoir été annoncé est lui aussi enregistré sans envoi.
//   - Date de besoin plus lointaine : rien, il sera annoncé en entrant dans la
//     fenêtre.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Le
// jour de Paris arrive en paramètre (AAAA-MM-JJ).
// ─────────────────────────────────────────────────────────────────────────────

import { lienPage } from "../../supabase/functions/_partage/notificationsPushV1.mjs";

/** Ligne de référence : marque que le premier passage (arriéré) est fait. */
export const CLE_REFERENCE_C3 = "_reference";
/** Nombre de jours de la fenêtre, aujourd'hui inclus (J à J+6). */
export const JOURS_FENETRE_C3 = 7;
/** Lien de la page « Commandes à passer » (format lienPage : /?page=<id>). */
export const LIEN_PAGE_COMMANDES_A_PASSER = lienPage("planning-commandes");

/**
 * Identifiant stable d'une commande à passer (une ligne de la liste) :
 * phasage, ouvrage et matériau. Un même matériau lié deux fois au même
 * ouvrage fait deux lignes à l'écran : la deuxième reçoit « #2 »…
 */
export function cleCommandeAPasser(l, occurrence = 1) {
  const base = `${l.phasageId}|${l.ouvrageId}|${l.materiau_id}`;
  return occurrence > 1 ? `${base}#${occurrence}` : base;
}

/** Clés de toutes les lignes, dans l'ordre (occurrences numérotées). */
export function clesCommandesAPasser(lignes) {
  const vues = new Map();
  return (lignes || []).map(l => {
    const base = cleCommandeAPasser(l);
    const n = (vues.get(base) || 0) + 1;
    vues.set(base, n);
    return cleCommandeAPasser(l, n);
  });
}

const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** « 2026-11-09 » + 6 → « 2026-11-15 » (calendrier pur, sans heure). */
export function ajouterJours(dateIso, n) {
  const [a, m, j] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

/**
 * Plan du jour.
 * @param {{ lignes: Array<object>, dejaVues: Iterable<string>, dateIso: string }} p
 *   lignes : lignesACommander(modèle) ; dejaVues : cle_objet C3 déjà en base.
 * @returns {{
 *   premierPassage: boolean, debut: string, fin: string,
 *   aNotifier: Array<object>,        // dans la fenêtre, jamais annoncés (triés par date)
 *   enregistrerSansEnvoi: Array<object>, // en retard, jamais annoncés
 *   dejaVues: number, sansDate: number, plusTard: number,
 * }}
 */
export function planC3({ lignes, dejaVues, dateIso }) {
  if (!RE_JOUR.test(String(dateIso || ""))) throw new Error("Jour de Paris attendu au format AAAA-MM-JJ.");
  const vues = new Set(dejaVues || []);
  const premierPassage = !vues.has(CLE_REFERENCE_C3);
  const debut = dateIso;
  const fin = ajouterJours(dateIso, JOURS_FENETRE_C3 - 1);
  const liste = lignes || [];
  const cles = clesCommandesAPasser(liste);
  const aNotifier = [], enregistrerSansEnvoi = [];
  let deja = 0, sansDate = 0, plusTard = 0;
  liste.forEach((l, i) => {
    const cle = cles[i];
    if (vues.has(cle)) { deja++; return; }
    const date = String(l.dateISO || "").slice(0, 10);
    if (!RE_JOUR.test(date)) { sansDate++; return; }
    const ligne = { ...l, cleObjet: cle, dateBesoin: date };
    if (date < debut) enregistrerSansEnvoi.push(ligne);
    else if (date <= fin) aNotifier.push(ligne);
    else plusTard++;
  });
  // Tri stable par date de besoin (la plus proche d'abord).
  aNotifier.sort((a, b) => (a.dateBesoin < b.dateBesoin ? -1 : a.dateBesoin > b.dateBesoin ? 1 : 0));
  return { premierPassage, debut, fin, aNotifier, enregistrerSansEnvoi, dejaVues: deja, sansDate, plusTard };
}

/** « texte long » → « texte lo… » (une ligne de notification reste lisible). */
function court(txt, max) {
  const t = String(txt || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * Contenu de LA notification C3 du jour (une seule, regroupée), ou null si
 * rien n'est à annoncer.
 * Titre « N commandes à passer cette semaine » ; texte = une ligne par article,
 * « jj/mm · ouvrage / matériau · chantier » (libellés raccourcis), tronqué à
 * 1 000 caractères avec « … et N autres ».
 * @param {{ aNotifier: Array<object>, dateIso: string }} p
 */
export function notificationC3({ aNotifier, dateIso }) {
  const liste = Array.isArray(aNotifier) ? aNotifier : [];
  const n = liste.length;
  if (n === 0) return null;
  const titre = `${n} commande${n > 1 ? "s" : ""} à passer cette semaine`;
  const MAX = 1000;
  const jjmm = d => (RE_JOUR.test(String(d || "")) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "--/--");
  const lignesTxt = liste.map(l =>
    `${jjmm(l.dateBesoin || l.dateISO)} · ${court(l.ouvrageLibelle, 50) || "Ouvrage"} / ${court(l.libelle, 45) || "Matériau"} · ${l.chantierNom}`);
  let texte = "";
  for (let i = 0; i < lignesTxt.length; i++) {
    const reste = n - i - 1;
    const suite = reste > 0 ? `\n… et ${reste} autre${reste > 1 ? "s" : ""}` : "";
    const candidat = (texte ? texte + "\n" : "") + lignesTxt[i];
    if ((candidat + suite).length > MAX) {
      const restant = n - i;
      const fin = `… et ${restant} autre${restant > 1 ? "s" : ""}`;
      texte = texte ? `${texte}\n${fin}` : fin;
      break;
    }
    texte = candidat;
  }
  return {
    type: "C3",
    titre,
    texte,
    lien: LIEN_PAGE_COMMANDES_A_PASSER,
    cle_regroupement: `C3-${dateIso}`,
  };
}
