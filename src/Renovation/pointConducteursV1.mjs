// src/Renovation/pointConducteursV1.mjs — Point du soir des conducteurs (18h30).
//
// Projet docs/projets/notifications-push.md, tâche 4 (types C1 et C2).
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Le
// job serveur (api/_cron/cron-point-conducteurs.js) lit la base et passe tout
// en paramètre.
//
// Entrées : la date (AAAA-MM-JJ, heure de Paris), les ouvriers attendus ce
// jour-là (même règle que le mail de rappel : ouvriersAttendusV1.mjs), les
// comptes rendus reçus ce jour-là (table rapports), les demandes de matériel
// en attente (table besoins, statut « en_attente ») et les noms de chantiers.
//
// Sortie : le contenu de LA notification du soir, en trois variantes, car
// chaque personne peut couper C1 ou C2 séparément (règle 6) tout en ne
// recevant qu'un seul push (règle 5) :
//   - c1       : partie « comptes rendus » seule (type C1) ;
//   - c2       : partie « demandes de matériel » seule (type C2) ;
//   - ensemble : le push unique quand une personne reçoit les deux.
// Chaque partie est écrite dans la boîte de réception sous son propre type ;
// send-push n'envoie qu'UN push par personne (voir _partage/pushGroupeV1.mjs).
//
// Rien à signaler (aucun CR reçu, aucun ouvrier attendu, aucune demande) →
// null : aucun envoi. MAIS des ouvriers attendus sans aucun CR reçu, c'est
// quelque chose à signaler : une absence ne passe jamais pour « tout va bien ».

export const TYPE_CR = "C1";
export const TYPE_MATERIEL = "C2";
export const PAGE_CR = "validation";              // « Validation fin de journée » (comptes rendus du jour)
export const PAGE_MATERIEL = "planning-commandes"; // « Planning commandes » (demandes des ouvriers)

// Limites de send-push (validerContenu) : titre ≤ 120, texte ≤ 1000.
export const TITRE_MAX = 120;
export const TEXTE_MAX = 1000;
const BUDGET_PARTIE = 480; // chaque partie tient seule ET les deux ensemble (< 1000)

const pluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** Clé de regroupement du point du soir : « C1-AAAA-MM-JJ » (date de Paris). */
export function clePointDuSoir(dateIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateIso || ""))) throw new Error("Date de Paris illisible : clé de regroupement impossible.");
  return `${TYPE_CR}-${dateIso}`;
}

/**
 * Coupe proprement une liste pour qu'elle tienne dans `budget` caractères :
 * « a, b, c … et K autres ». Jamais d'élément coupé en deux.
 */
export function listeCoupee(elements, budget, separateur = ", ") {
  const liste = (elements || []).map(String);
  const mention = (k) => ` … et ${pluriel(k, "autre", "autres")}`;
  const morceaux = [];
  let longueur = 0;
  for (let i = 0; i < liste.length; i++) {
    const reste = liste.length - i - 1;
    const ajout = (morceaux.length ? separateur.length : 0) + liste[i].length;
    // On réserve la place de « … et K autres » tant qu'il reste des éléments après celui-ci.
    if (morceaux.length > 0 && longueur + ajout + (reste > 0 ? mention(reste).length : 0) > budget) {
      return morceaux.join(separateur) + mention(liste.length - i);
    }
    morceaux.push(liste[i]);
    longueur += ajout;
  }
  return morceaux.join(separateur);
}

/**
 * Comptes rendus du jour : qui a rendu, qui manque.
 * @param {{ attendus: Iterable<string>, rapports: Array<{ ouvrier: string }> }} p
 */
export function bilanComptesRendus({ attendus, rapports }) {
  const attendusListe = [...new Set([...(attendus || [])].filter(Boolean))];
  const rendus = new Set((rapports || []).map((r) => r?.ouvrier).filter(Boolean));
  const manquants = attendusListe.filter((p) => !rendus.has(p)).sort((a, b) => a.localeCompare(b, "fr"));
  return {
    attendus: attendusListe.length,
    recus: rendus.size,                       // ouvriers ayant rendu au moins un CR ce jour-là
    comptesRendus: (rapports || []).length,   // lignes (un CR par chantier)
    rendus: [...rendus].sort((a, b) => a.localeCompare(b, "fr")),
    manquants,
  };
}

/**
 * Demandes de matériel en attente, regroupées comme l'écran « Planning
 * commandes » : une demande = un envoi de l'ouvrier (panier_id), repli sur
 * la ligne seule pour les anciennes demandes.
 * @param {{ besoins: Array<object>, chantiers?: Array<{ id: string, nom?: string }> }} p
 */
export function demandesEnAttente({ besoins, chantiers = [] }) {
  const noms = new Map((chantiers || []).map((c) => [c.id, c.nom]));
  const paniers = new Map();
  for (const b of besoins || []) {
    if (!b || b.statut && b.statut !== "en_attente") continue;
    const cle = b.panier_id || `solo_${b.id}`;
    if (!paniers.has(cle)) {
      paniers.set(cle, {
        chantier: noms.get(b.chantier_id) || b.chantier_id || "(sans chantier)",
        ouvrier: b.ouvrier_demandeur || "",
        date: b.created_at || "",
        articles: [],
      });
    }
    const q = String(b.quantite ?? "").trim();
    paniers.get(cle).articles.push(`${b.article || "article"}${q ? ` ×${q}` : ""}`);
  }
  return [...paniers.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function texteComptesRendus(cr) {
  if (cr.manquants.length === 0) {
    return cr.attendus > 0
      ? `Comptes rendus : tous les ouvriers attendus ont rendu le leur (${cr.recus}).`
      : `Comptes rendus : ${pluriel(cr.recus, "ouvrier a rendu son CR", "ouvriers ont rendu leur CR")} (aucun ouvrier n'avait de tâche planifiée).`;
  }
  const debut = cr.recus === 0
    ? `Aucun compte rendu reçu sur ${pluriel(cr.attendus, "ouvrier attendu", "ouvriers attendus")}. Manquants : `
    : `Manquants (${cr.manquants.length}) : `;
  return debut + listeCoupee(cr.manquants, BUDGET_PARTIE - debut.length) + ".";
}

function texteDemandes(demandes) {
  const debut = `Demandes de matériel en attente (${demandes.length}) : `;
  const lignes = demandes.map((d) => {
    const articles = d.articles.length > 2
      ? `${d.articles.slice(0, 2).join(", ")}… (${d.articles.length} articles)`
      : d.articles.join(", ");
    return `${d.chantier}${d.ouvrier ? ` (${d.ouvrier})` : ""} : ${articles}`;
  });
  return debut + listeCoupee(lignes, BUDGET_PARTIE - debut.length, " ; ") + ".";
}

function titreCr(cr) {
  const recus = cr.recus === 0 ? "aucun CR reçu" : `${cr.recus} CR reçu${cr.recus > 1 ? "s" : ""}`;
  return `${recus}, ${pluriel(cr.manquants.length, "manquant", "manquants")}`;
}
const titreDemandes = (n) => pluriel(n, "demande de matériel", "demandes de matériel");

const borne = (s, max) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/**
 * Le point du soir.
 * @param {{
 *   dateIso: string,
 *   attendus: Iterable<string>,
 *   rapports: Array<{ ouvrier: string }>,
 *   besoins: Array<object>,
 *   chantiers?: Array<{ id: string, nom?: string }>,
 *   lienPage: (page: string) => string,   // _partage/notificationsPushV1.mjs
 * }} p
 * @returns {null | { cle_regroupement, comptesRendus, demandes, c1, c2, ensemble }}
 *   c1 / c2 : { type, titre, texte, lien } ou null si la partie n'a rien à dire ;
 *   ensemble : { titre, texte, lien } si les deux parties existent, sinon null.
 */
export function pointDuSoir({ dateIso, attendus, rapports, besoins, chantiers = [], lienPage }) {
  if (typeof lienPage !== "function") throw new Error("lienPage manquant.");
  const cle = clePointDuSoir(dateIso);
  const cr = bilanComptesRendus({ attendus, rapports });
  const demandes = demandesEnAttente({ besoins, chantiers });

  // C1 : quelque chose à dire dès qu'un CR est arrivé ou qu'un ouvrier était
  // attendu (des attendus sans aucun CR, c'est justement l'alerte).
  const aDireCr = cr.recus > 0 || cr.attendus > 0;
  const c1 = aDireCr ? {
    type: TYPE_CR,
    titre: borne(`Point du soir : ${titreCr(cr)}`, TITRE_MAX),
    texte: borne(texteComptesRendus(cr), TEXTE_MAX),
    lien: lienPage(PAGE_CR),
  } : null;
  const c2 = demandes.length > 0 ? {
    type: TYPE_MATERIEL,
    titre: borne(`Point du soir : ${titreDemandes(demandes.length)} en attente`, TITRE_MAX),
    texte: borne(texteDemandes(demandes), TEXTE_MAX),
    lien: lienPage(PAGE_MATERIEL),
  } : null;
  if (!c1 && !c2) return null;

  const ensemble = c1 && c2 ? {
    titre: borne(`Point du soir : ${titreCr(cr)}, ${titreDemandes(demandes.length)}`, TITRE_MAX),
    texte: borne(`${c1.texte}\n${c2.texte}`, TEXTE_MAX),
    lien: c1.lien,
  } : null;

  return {
    cle_regroupement: cle,
    comptesRendus: cr,
    demandes,
    c1, c2, ensemble,
  };
}

/**
 * Corps de l'appel à send-push (mode « serveur »). Une seule partie → envoi
 * simple de ce type ; deux parties → envoi groupé (champ `groupe`), un seul
 * push par personne. null → rien à envoyer.
 */
export function demandeSendPush(point, { simulation = false } = {}) {
  if (!point) return null;
  const premier = point.c1 || point.c2;
  const corps = {
    mode: "serveur",
    type: premier.type, titre: premier.titre, texte: premier.texte, lien: premier.lien,
    cle_regroupement: point.cle_regroupement,
    simulation: simulation === true,
  };
  if (point.c1 && point.c2) {
    corps.groupe = {
      type: point.c2.type, titre: point.c2.titre, texte: point.c2.texte, lien: point.c2.lien,
      ensemble: point.ensemble,
    };
  }
  return corps;
}
