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
// « commandé le », sur un ouvrage pas encore terminé (toutes tâches à 100 %).
// Il n'y a PAS de date butoir : un article est à commander dès
// qu'il est prévu ; la date de besoin (date prévue la plus proche des tâches de
// l'ouvrage) sert seulement à le ranger par semaine.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// phasages, chantiers, matériaux de la bibliothèque, lots, lignes de commande
// et lots « achats terminés » arrivent en paramètre.
// Utilisé par :
//   - la page « Commandes à passer » (PagePlanningCommandes.jsx, via la façade
//     commandesAPasserV1.js) ;
//   - la notification C3 (api/_cron/cron-push-materiaux.js, choix des articles
//     à notifier dans commandesAPasserPushV1.mjs) ;
//   - scripts/verif-commandes-a-passer.mjs (données fictives).
// ─────────────────────────────────────────────────────────────────────────────

import { libelleOuvrage } from "./libellesPhasageV1.mjs";
import { etatMateriauxOuvrageV1 } from "./commandesOuvrageV1.mjs";
import { resteACommanderEnveloppes } from "../chantierFinance.mjs";

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
        // Ouvrage terminé dans le phasage : matériaux non commandés plus
        // nécessaires (son enveloppe sort du reste : resteACommanderEnveloppes).
        const plusNecessaires = etat.plusNecessaires.map(valoriser);
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
          plusNecessaires,
          termine:       etat.termine,
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
