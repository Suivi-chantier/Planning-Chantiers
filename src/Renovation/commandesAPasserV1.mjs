// ─────────────────────────────────────────────────────────────────────────────
// commandesAPasserV1 — la liste de la page « Commandes à passer ».
//
// Code DÉPLACÉ tel quel de src/Renovation/PagePlanningCommandes.jsx (projet
// docs/projets/notifications-push.md, tâche 10, règle 3 : une logique qui vit
// dans un composant est extraite dans un module pur partagé par l'écran et
// par le serveur). Rien n'est réécrit :
//   - modeleCommandesAPasser = l'ancien `useMemo` « modele » de la page
//     (Chantier → Ouvrage, à commander / marqués commandés / déjà commandés,
//     enveloppes de lot, tri) ;
//   - lignesACommander = l'ancien `useMemo` « lignesGlobalesACommander »
//     (liste plate de TOUS les articles à commander, bouton « Commandes de la
//     semaine ») ;
//   - statsCommandesAPasser = l'ancien `useMemo` « stats » (bandeau).
//
// La règle « à commander » elle-même vit dans commandesOuvrageV1.mjs
// (etatMateriauxOuvrageV1, partagée avec le Bilan) : un matériau lié à un
// ouvrage, connu de la bibliothèque, sans ligne de commande saisie NI marque
// « commandé le ». Il n'y a PAS de date butoir : un article est à commander dès
// qu'il est prévu ; la date de besoin (date prévue la plus proche des tâches de
// l'ouvrage) sert seulement à le ranger par semaine.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// phasages, chantiers, matériaux de la bibliothèque, lots, lignes de commande
// et lots « achats terminés » arrivent en paramètre.
// Utilisé par :
//   - la page « Commandes à passer » (PagePlanningCommandes.jsx, via la façade
//     commandesAPasserV1.js) ;
//   - la notification C3 (api/_cron/cron-push-materiaux.js) ;
//   - scripts/verif-commandes-a-passer.mjs (données fictives).
// ─────────────────────────────────────────────────────────────────────────────

import { libelleOuvrage } from "./libellesPhasageV1.mjs";
import { etatMateriauxOuvrageV1 } from "./commandesOuvrageV1.mjs";
import { resteACommanderEnveloppes } from "../chantierFinance.mjs";
import { lienPage } from "../../supabase/functions/_partage/notificationsPushV1.mjs";

/** Index bibliothèque par id (string-safe) — ancien useMemo « matById ». */
export function indexMateriaux(materiaux) {
  const m = {};
  (materiaux || []).forEach(x => { m[String(x.id)] = x; });
  return m;
}

/** Index des lots par id — ancien useMemo « lotById ». */
export function indexLots(lots) {
  const m = {};
  (lots || []).forEach(l => { m[l.id] = l; });
  return m;
}

/**
 * Modèle Chantier → Ouvrage de la page « Commandes à passer ».
 * @param {{
 *   phasages: Array<{ id, chantier_id, chantier_nom, ouvrages }>,
 *   chantiers: Array<{ id, nom, couleur }>,
 *   matById: object,      // indexMateriaux(bibliothèque)
 *   lotById: object,      // indexLots(lots)
 *   lignesCmd: Array<object>,
 *   lots: Array<object>,
 *   achatsParCh: object,  // { chantier_id: [lignes achats_lots_termines] }
 * }} p
 */
export function modeleCommandesAPasser({ phasages = [], chantiers = [], matById = {}, lotById = {}, lignesCmd = [], lots = [], achatsParCh = {} } = {}) {
    const result = [];
    phasages.forEach(p => {
      const ouvragesRaw = Array.isArray(p.ouvrages) ? p.ouvrages : [];
      if (ouvragesRaw.length === 0) return;
      const chantier = chantiers.find(c => c.id === p.chantier_id);
      const chantierNom = chantier?.nom || p.chantier_nom || "(sans chantier)";
      const chantierCouleur = chantier?.couleur || "#888";

      const ouvrages = [];
      ouvragesRaw.forEach(o => {
        // Matériaux prévus / à commander / marqués commandés et date de besoin :
        // règle partagée (commandesOuvrageV1), valorisée ici via la biblio.
        const etat = etatMateriauxOuvrageV1({ ouvrage: o, chantierId: p.chantier_id, lignesCmd,
          estConnu: id => !!matById[String(id)] });
        const valoriser = ml => {
            const mat = matById[String(ml.materiau_id)];
            return {
              materiau_id:     ml.materiau_id,
              libelle:         mat.nom || "",
              quantite:        ml.quantite != null ? ml.quantite : 1,
              unite:           mat.unite || "U",
              prix_ht:         parseFloat(mat.prix_unitaire) || 0,
              fournisseur_id:  mat.fournisseur_id || null,
              fournisseur_nom: mat.fournisseur || "",
              commande_le:     ml.commande_le || null,
            };
        };
        const prevus = etat.liens.map(valoriser);
        // Lignes déjà commandées rattachées à cet ouvrage (par ouvrage_id, repli matériau)
        const lignesO = etat.lignesOuvrage;
        // À commander = prévus sans ligne de commande saisie NI flag commande_le
        // (posé par « Passer commande » — la saisie réelle se fait à réception).
        const aCommander = etat.aCommander.map(valoriser);
        // Marqués commandés via la page, en attente de la saisie réelle.
        const marques = etat.marques.map(valoriser);
        // Date de besoin = date_prevue la plus proche parmi les tâches de l'ouvrage
        const earliest = etat.dateBesoin;

        if (prevus.length === 0 && lignesO.length === 0) return; // ouvrage sans matériau ni commande : ignoré (son enveloppe compte quand même)

        ouvrages.push({
          id:            o.id,
          libelle:       libelleOuvrage(o) || o.nom || "Ouvrage",
          lotId:         o.lot_id || null,
          lotLabel:      lotById[o.lot_id]?.label || "Sans lot",
          lotCouleur:    lotById[o.lot_id]?.couleur || "#888",
          prevus,
          aCommander,
          marques,
          lignesCmd:     lignesO,
          dateISO:       earliest,
          dateObj:       earliest ? new Date(earliest) : null,
        });
      });

      // Enveloppes matériaux par lot : LE montant à commander du chantier.
      const enveloppes = resteACommanderEnveloppes({
        ouvrages: ouvragesRaw,
        commandeLignes: lignesCmd.filter(l => l.chantier_id === p.chantier_id),
        lots, achatsTermines: achatsParCh[p.chantier_id] || [],
      });
      if (ouvrages.length === 0 && !(enveloppes.enveloppe > 0.5) && !(enveloppes.commandesMateriaux > 0.5)) return;
      // tri ouvrages : par lot puis libellé
      ouvrages.sort((a, b) => (a.lotLabel || "").localeCompare(b.lotLabel || "") || (a.libelle || "").localeCompare(b.libelle || ""));

      // Nombre d'articles : aide (liste des matériaux prévus non commandés).
      const nbACommander = ouvrages.reduce((s, o) => s + o.aCommander.length, 0);
      const totalACommander = enveloppes.reste;

      result.push({
        phasageId:   p.id,
        chantierId:  p.chantier_id,
        chantierNom,
        chantierCouleur,
        ouvrages,
        nbACommander,
        totalACommander,
        enveloppes,
      });
    });
    // tri chantiers : ceux avec des articles à commander d'abord, puis par nom
    result.sort((a, b) => (b.totalACommander - a.totalACommander) || (b.nbACommander - a.nbACommander) || a.chantierNom.localeCompare(b.chantierNom));
    return result;
}

/** Bandeau de la page (chantiers, articles à commander, reste HT). */
export function statsCommandesAPasser(modele) {
    const nbChantiers = modele.length;
    const nbACommander = modele.reduce((s, c) => s + c.nbACommander, 0);
    const totalHt = modele.reduce((s, c) => s + c.totalACommander, 0);
    return { nbChantiers, nbACommander, totalHt };
}

/** Liste plate de TOUS les articles à commander (bouton « Commandes de la semaine »). */
export function lignesACommander(modele) {
    const out = [];
    modele.forEach(c => {
      c.ouvrages.forEach(o => {
        o.aCommander.forEach(m => {
          out.push({
            ...m,
            chantierId:      c.chantierId,
            chantierNom:     c.chantierNom,
            chantierCouleur: c.chantierCouleur,
            phasageId:       c.phasageId,
            lotId:           o.lotId,
            lotLabel:        o.lotLabel,
            ouvrageId:       o.id,
            ouvrageLibelle:  libelleOuvrage(o),
            dateISO:         o.dateISO,
            dateObj:         o.dateObj,
          });
        });
      });
    });
    return out;
}

// ─── Notification C3 (tâche 10) ─────────────────────────────────────────────

/**
 * Identifiant stable d'une commande à passer (une ligne de la liste) :
 * phasage, ouvrage et matériau. Sert de cle_objet dans notifications_etat
 * (type C3) : une commande déjà notifiée n'est plus reprise.
 * Un même matériau lié deux fois au même ouvrage fait deux lignes à l'écran :
 * la deuxième reçoit le suffixe « #2 », la troisième « #3 »…
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

/** Lien de la page « Commandes à passer » (format lienPage : /?page=<id>). */
export const LIEN_PAGE_COMMANDES_A_PASSER = lienPage("planning-commandes");

/**
 * Commandes NOUVELLEMENT à passer : celles de la liste qui n'ont pas encore
 * été notifiées (chaque ligne reçoit sa clé dans `cleObjet`).
 * @param {{ lignes: Array<object>, dejaNotifiees: Iterable<string> }} p
 */
export function commandesNouvellementAPasser({ lignes, dejaNotifiees }) {
  const deja = new Set(dejaNotifiees || []);
  const liste = lignes || [];
  const cles = clesCommandesAPasser(liste);
  const out = [];
  liste.forEach((l, i) => { if (!deja.has(cles[i])) out.push({ ...l, cleObjet: cles[i] }); });
  return out;
}

/** « texte long » → « texte lo… » (une ligne de notification reste lisible). */
function court(txt, max) {
  const t = String(txt || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/**
 * Contenu de LA notification C3 du jour (une seule, regroupée), ou null si
 * aucune commande nouvelle : liste vide = aucun envoi.
 * Texte = la liste « ouvrage / matériau · chantier » (libellés raccourcis à
 * 60 et 50 caractères), tronquée à 1 000 caractères avec « … et N autres ».
 * @param {{ nouvelles: Array<object>, dateIso: string }} p
 */
export function notificationCommandesAPasser({ nouvelles, dateIso }) {
  const liste = Array.isArray(nouvelles) ? nouvelles : [];
  const n = liste.length;
  if (n === 0) return null;
  const titre = `${n} commande${n > 1 ? "s" : ""} à passer`;
  const MAX = 1000;
  const lignesTxt = liste.map(l => `${court(l.ouvrageLibelle, 60) || "Ouvrage"} / ${court(l.libelle, 50) || "Matériau"} · ${l.chantierNom}`);
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
