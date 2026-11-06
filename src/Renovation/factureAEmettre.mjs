// ─────────────────────────────────────────────────────────────────────────────
// FACTURE À ÉMETTRE — détection « une échéance de l'échéancier atteint son
// déclencheur » (notification F1 du projet docs/projets/notifications-push.md).
//
// Module PUR : aucun accès base, aucune horloge, aucun effet de bord. Les
// données (chantiers, phasages, états du cycle de vie, factures, réglages) et
// la date arrivent en paramètres. Extension .mjs = importable par Node (job
// serveur api/_cron/cron-factures-a-emettre.js, scripts/verif-*) ; le front
// importe la façade src/Renovation/factureAEmettre.js.
//
// D'OÙ VIENT CE CODE. La détection vivait dans PageChantiers.jsx et ne tournait
// qu'à l'ouverture de la fiche chantier. Elle est DÉPLACÉE ici sans être
// réécrite (règle 3 du projet) : même statut de chantier (getStatut), même
// phasage retenu (trouverPhasage), même avancement (calcAvancement), même
// échéancier et même montant de référence, même règle « prête et pas encore
// notifiée ». La fiche et le job serveur appellent les mêmes fonctions.
//
// LE DRAPEAU ANTI-DOUBLON DU MAIL : clé PLATE `facture_mail_<id de l'échéance>`
// dans phasages.plan_travaux.meta (horodatage ISO de l'envoi), posée par la
// fiche après un envoi réussi, par écriture versionnée
// (conducteur_sauvegarder_phasage_v2). Voir cleDrapeauMail().
//
// LE PUSH F1 a son propre anti-doublon : une seule notification par jour
// (clé F1-<date Paris>, index unique de la boîte de réception) et, par
// échéance, la table public.notifications_etat (type F1, cle_objet
// « <phasage>-<échéance> »). Voir contenuPushRegroupeF1() et decisionPushF1().
// ─────────────────────────────────────────────────────────────────────────────

import { lireEcheancierChantier, lireMontantReference, etatFacturation } from "./facturationClient.mjs";
import { etatsCycleVie } from "./cycleVie.mjs";
import { avancementChantier, prixHTOuvrage } from "../chantierFinance.mjs";
import { calcAvancementPondere } from "../avancementPondere.mjs";
import { PHASES_DEFAUT } from "../phasesDefaut.mjs";

// ── Drapeau anti-doublon du mail (inchangé) ─────────────────────────────────
export const PREFIXE_DRAPEAU_MAIL = "facture_mail_";
export const cleDrapeauMail = (ligneId) => `${PREFIXE_DRAPEAU_MAIL}${ligneId}`;

// ── Statut effectif d'un chantier (ex-getStatut de PageChantiers) ───────────
// chantier.statut (source de vérité) ; repli sur phasage.statut pour compat
// avec l'existant ; défaut "en_cours" si phasage présent, "planifie" sinon.
export const statutChantier = (chantier, phasage) =>
  chantier?.statut || phasage?.statut || (phasage ? "en_cours" : "planifie");

// ── Correspondance chantier → phasage (ex-trouverPhasage de PageChantiers) ──
function normalise(str) {
  return (str || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

export function trouverPhasage(phasages, chantier) {
  if (!chantier) return null;
  // 1. Match exact par chantier_id (lien explicite)
  const exact = phasages.find(p => p.chantier_id === chantier.id);
  if (exact) return exact;

  // 2. Match par nom normalisé : on cherche dans les deux sens et par mot.
  const nomCh = normalise(chantier.nom);
  const motsCh = nomCh.split(" ").filter(m => m.length > 2);
  if (motsCh.length === 0) return null;

  return phasages.find(p => {
    const nomPh = normalise(p.chantier_nom || "");
    if (!nomPh) return false;
    // Inclusion directe dans les deux sens
    if (nomPh.includes(nomCh) || nomCh.includes(nomPh)) return true;
    // Au moins un mot significatif en commun
    const motsPh = nomPh.split(" ").filter(m => m.length > 2);
    return motsCh.some(m => motsPh.includes(m));
  }) || null;
}

// ── Avancement d'un phasage (ex-calcAvancement de PageChantiers) ────────────
// V2 : avancement du module (pondéré heures_estimees par ouvrage puis
// prix_ht au chantier — identique à Phasage V2). Repli V1 : plan_travaux,
// phase par phase (phaseIds = Admin → Phases, sinon les phases par défaut).
export function avancementPhasage(phasage, phaseIds = PHASES_DEFAUT.map(p => p.id)) {
  const ouvrages = phasage?.ouvrages || [];
  if (ouvrages.length > 0) return avancementChantier(ouvrages);
  if (!phasage?.plan_travaux) return 0;
  const allTaches = phaseIds.flatMap(id => (phasage.plan_travaux[id] || []));
  return calcAvancementPondere(ouvrages, allTaches);
}

// ── Prix vendu d'un phasage, tel que la fiche le donne à l'échéancier ───────
// Même valeur que calcFinances(...).prixVendu de PageChantiers : V2 = somme des
// prix HT des ouvrages (prixHTChantier de computeChantierFinance) ; V1 =
// phasage.prix_vendu, sinon meta.prix_vendu ; rien du tout → 0. Sert au job
// serveur, qui n'a pas les pointages et commandes qu'exige calcFinances (le
// prix vendu n'en dépend pas).
export function prixVenduPhasage(phasage) {
  const ouvrages = phasage?.ouvrages || [];
  if (ouvrages.length > 0) return ouvrages.reduce((s, o) => s + prixHTOuvrage(o), 0);
  if (!phasage?.plan_travaux) return 0;
  return parseFloat(phasage?.prix_vendu) || parseFloat(phasage?.plan_travaux?.meta?.prix_vendu) || 0;
}

// ── État de la facturation d'un chantier (composition de la fiche) ──────────
// Échéancier retenu pour CE chantier (surcharge du phasage, sinon réglage
// Admin, sinon défaut Profero), montant du marché et état de chaque échéance.
export function etatFacturationChantier({ meta = {}, echeancierDefaut, prixVendu = 0, factures = [], avancement = 0, etatsEtapes = {} } = {}) {
  const echeancierChantier = lireEcheancierChantier(meta, echeancierDefaut);
  const montantRefFact = lireMontantReference(meta, prixVendu);
  const etatFact = etatFacturation({
    echeancier: echeancierChantier.lignes,
    factures,
    montantReference: montantRefFact.montant,
    avancement,
    etatsEtapes,
  });
  return { echeancierChantier, montantRefFact, etatFact };
}

// ── LA DÉTECTION : échéances prêtes, pas encore prévenues par mail ──────────
// Chantier soldé (statut « termine ») : pas de relance. Une échéance est à
// prévenir quand elle est « à émettre » (déclencheur atteint, aucune facture)
// et que son drapeau facture_mail_<id> est absent du meta du phasage.
export function echeancesAPrevenir({ chantier, phasage, etatFact } = {}) {
  if (!phasage?.id || !chantier) return [];
  if (statutChantier(chantier, phasage) === "termine") return []; // chantier soldé : pas de relance
  const meta = phasage?.plan_travaux?.meta || {};
  return (etatFact?.lignes || []).filter(l => l.prete && !meta[cleDrapeauMail(l.id)]);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH F1 (job serveur quotidien)
//
// Le mail reste envoyé par la fiche, comme aujourd'hui (règle 8) ; le job
// n'envoie QUE le push et n'écrit JAMAIS le drapeau du mail (sinon la fiche
// ne l'enverrait plus).
//
// REGROUPEMENT (règle 5) : au plus UNE notification F1 par jour, « N factures
// à émettre », qui liste les échéances nouvelles du jour ; clé de regroupement
// F1-<date Paris> (send-push : une seule ligne par personne et par clé).
//
// EXACTEMENT UNE FOIS PAR ÉCHÉANCE : table public.notifications_etat (type
// F1, cle_objet « <phasage>-<échéance> »). Le job n'inscrit une échéance
// qu'après une écriture réussie en boîte de réception ; une échéance inscrite
// n'est plus jamais reprise. Interrupteur coupé, type désactivé ou rien
// d'écrit : rien n'est inscrit (l'échéance n'est pas « consommée »).
//
// Quelles échéances « prêtes » entrent dans la notification ?
//   - déjà inscrite dans notifications_etat → non ;
//   - drapeau mail absent  → l'échéance vient d'atteindre son déclencheur
//     (le mail partira à la prochaine ouverture de la fiche) : oui ;
//   - drapeau mail posé APRÈS la mise en service du push F1 → la fiche a vu
//     l'échéance en premier : le job la reprend au passage suivant (le
//     navigateur ne peut pas appeler send-push en mode serveur) : oui ;
//   - drapeau mail posé AVANT la mise en service → échéance déjà connue
//     depuis longtemps : non (on notifie un changement d'état, pas un état
//     qui dure — règle 2).
// Une échéance facturée n'est plus « prête » : elle sort d'elle-même.
// ─────────────────────────────────────────────────────────────────────────────

/** Date de mise en service du push F1 (ISO). Drapeaux plus anciens : aucun push. */
export const F1_MISE_EN_SERVICE = "2026-11-06T00:00:00.000Z";

/** Identifiant d'une échéance dans notifications_etat (cle_objet). */
export const cleObjetF1 = (phasageId, ligneId) => `${phasageId}-${ligneId}`;
/** Clé de regroupement de la notification du jour (date de Paris AAAA-MM-JJ). */
export const cleRegroupementF1 = (dateParis) => `F1-${dateParis}`;

/**
 * Faut-il notifier cette échéance prête ?
 * → { pousser, raison }
 */
export function decisionPushF1({ drapeauMail = null, dejaNotifiee = false, miseEnServiceIso = F1_MISE_EN_SERVICE } = {}) {
  if (dejaNotifiee) return { pousser: false, raison: "deja_notifiee_par_push" };
  if (!drapeauMail) return { pousser: true, raison: "nouvelle" };
  const le = String(drapeauMail);
  if (le >= miseEnServiceIso) return { pousser: true, raison: "mail_deja_parti_depuis_la_fiche" };
  return { pousser: false, raison: "deja_notifiee_avant_mise_en_service" };
}

/**
 * Lien du push F1 (format des liens des notifications) : la page Chantiers,
 * et la fiche du chantier quand une seule échéance est concernée.
 */
export const lienPushF1 = (chantierId = null) =>
  chantierId ? `/?page=chantiers&chantier=${encodeURIComponent(chantierId)}` : "/?page=chantiers";

const LIMITE_TEXTE = 1000; // send-push refuse au-delà

/**
 * Contenu de LA notification F1 du jour, qui regroupe toutes les échéances.
 * lignes : éléments du plan à notifier ({ chantierId, chantierNom, ligne, montant }).
 * → { titre, texte, lien, cle_regroupement } ; null si rien à notifier.
 */
export function contenuPushRegroupeF1({ lignes = [], dateParis } = {}) {
  if (!lignes.length) return null;
  const n = lignes.length;
  const ligneTexte = (p) =>
    `${p.chantierNom} · ${p.ligne?.nom || "Échéance"} · ${Math.round(p.montant || 0).toLocaleString("fr-FR")} € HT`;
  // Troncature propre : des lignes entières, puis « … et K autres ».
  const sortie = [];
  let taille = 0;
  for (let i = 0; i < n; i++) {
    const l = ligneTexte(lignes[i]);
    const ajout = (sortie.length ? 1 : 0) + l.length;
    // Garder la place de la mention finale (« … et K autres ») si d'autres lignes suivent.
    if (taille + ajout + (i < n - 1 ? 20 : 0) > LIMITE_TEXTE) {
      const restants = n - i;
      sortie.push(`… et ${restants} autre${restants > 1 ? "s" : ""}`);
      break;
    }
    sortie.push(l);
    taille += ajout;
  }
  const chantiersDistincts = new Set(lignes.map((p) => p.chantierId));
  return {
    titre: n === 1 ? "1 facture à émettre" : `${n} factures à émettre`,
    texte: sortie.join("\n").slice(0, LIMITE_TEXTE),
    lien: n === 1 || chantiersDistincts.size === 1 ? lienPushF1(lignes[0].chantierId) : lienPushF1(),
    cle_regroupement: cleRegroupementF1(dateParis),
  };
}

/**
 * Plan du job serveur, chantier par chantier, avec les MÊMES fonctions que la
 * fiche. Données brutes en paramètres :
 *   chantiers        : lignes de public.chantiers (id, nom, statut…)
 *   phasages         : lignes de public.phasages (id, chantier_id, chantier_nom, ouvrages, plan_travaux…)
 *   lignesCycleVie   : lignes de public.chantier_cycle_vie (chantier_id, etape_id, etat…)
 *   factures         : chantier_factures_client, source « manuel » (comme la fiche)
 *   echeancierDefaut : lignes du réglage Admin (planning_config.echeancier_facturation), ou défaut
 *   phaseIds         : ids des phases (Admin → Phases), ou défaut
 *   dejaNotifiees    : cle_objet déjà inscrites dans notifications_etat (type F1)
 * → [{ chantierId, chantierNom, phasageId, ligne, montant, drapeauMail,
 *      aPrevenirParMail, pousser, raison, cleObjet }] : toutes les échéances PRÊTES.
 */
export function planFacturesAEmettre({
  chantiers = [], phasages = [], lignesCycleVie = [], factures = [],
  echeancierDefaut, phaseIds, dejaNotifiees = [], miseEnServiceIso = F1_MISE_EN_SERVICE,
} = {}) {
  const deja = new Set(dejaNotifiees);
  const lignesParChantier = {};
  for (const l of lignesCycleVie) (lignesParChantier[l.chantier_id] ??= []).push(l);
  const facturesParChantier = {};
  for (const f of factures) (facturesParChantier[f.chantier_id] ??= []).push(f);

  const sortie = [];
  for (const chantier of chantiers) {
    const phasage = trouverPhasage(phasages, chantier);
    if (!phasage?.id) continue;
    const meta = phasage?.plan_travaux?.meta || {};
    const { etats } = etatsCycleVie({ meta, lignes: lignesParChantier[chantier.id] || [] });
    const { etatFact } = etatFacturationChantier({
      meta, echeancierDefaut,
      prixVendu: prixVenduPhasage(phasage),
      factures: facturesParChantier[chantier.id] || [],
      avancement: avancementPhasage(phasage, phaseIds),
      etatsEtapes: etats,
    });
    const termine = statutChantier(chantier, phasage) === "termine";
    const aPrevenir = new Set(echeancesAPrevenir({ chantier, phasage, etatFact }).map(l => l.id));
    for (const ligne of etatFact.lignes) {
      if (!ligne.prete) continue;
      const drapeauMail = meta[cleDrapeauMail(ligne.id)] || null;
      const cleObjet = cleObjetF1(phasage.id, ligne.id);
      const d = termine ? { pousser: false, raison: "chantier_termine" }
        : decisionPushF1({ drapeauMail, dejaNotifiee: deja.has(cleObjet), miseEnServiceIso });
      sortie.push({
        chantierId: chantier.id, chantierNom: chantier.nom || chantier.id, phasageId: phasage.id,
        ligne, montant: ligne.montantAttendu, drapeauMail,
        aPrevenirParMail: aPrevenir.has(ligne.id),
        pousser: d.pousser, raison: d.raison, cleObjet,
      });
    }
  }
  return sortie;
}
