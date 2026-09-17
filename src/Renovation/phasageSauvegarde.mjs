// ─────────────────────────────────────────────────────────────────────────────
// phasageSauvegarde — file d'attente de l'auto-save de PhasageV2, en
// verrouillage optimiste.
//
// Fonctions PURES et IMMUABLES : chacune renvoie un NOUVEL état, sans réseau,
// sans React. Elles répondent à une seule question — que faire de la prochaine
// écriture ? — et permettent de tester le comportement de concurrence sans
// navigateur (scripts/verif-phasage-sauvegarde.mjs).
//
// L'ÉTAT :
//   revision : dernière révision CONFIRMÉE par la base. null tant que le
//              phasage n'est pas chargé — on n'écrit jamais sans elle.
//   attente  : champs modifiés en attente d'envoi ({ ouvrages, plan_travaux }),
//              fusionnés au fil des frappes. null = rien à écrire.
//   enVol    : { seq, lot } de la requête en cours. Une seule à la fois :
//              deux écritures simultanées du même éditeur se doubleraient.
//   conflit  : true dès qu'une sauvegarde a été refusée. L'auto-save est
//              alors SUSPENDU — plus aucune écriture n'est tentée, et rien
//              n'est réécrit automatiquement par-dessus la version récente.
//   seq      : compteur de requêtes, pour ignorer une réponse périmée.
// ─────────────────────────────────────────────────────────────────────────────

export function etatInitial(revision = null) {
  return { revision, attente: null, enVol: null, conflit: false, seq: 0 };
}

// La révision arrive avec le phasage chargé.
export function avecRevision(etat, revision) {
  return { ...etat, revision: revision === null || revision === undefined ? null : Number(revision) };
}

// Empile des champs à écrire. Refusé tant qu'un conflit n'est pas résolu :
// c'est ce qui garantit qu'on ne réécrit rien par-dessus la version récente.
export function planifier(etat, champs) {
  if (etat.conflit) return etat;
  if (!champs || typeof champs !== "object") return etat;
  return { ...etat, attente: { ...(etat.attente || {}), ...champs } };
}

// Prépare l'envoi suivant. Renvoie { etat, lot, seq } — lot null quand il n'y
// a rien à envoyer, qu'une requête est déjà en vol, qu'un conflit est en
// cours, ou que la révision n'est pas encore connue.
export function demarrer(etat) {
  if (etat.conflit || etat.enVol || !etat.attente || etat.revision === null) {
    return { etat, lot: null, seq: null };
  }
  const seq = etat.seq + 1;
  const lot = etat.attente;
  return { etat: { ...etat, seq, attente: null, enVol: { seq, lot } }, lot, seq };
}

const obsolete = (etat, seq) => !etat.enVol || etat.enVol.seq !== seq;

// Écriture acceptée : on adopte la révision renvoyée par la base.
export function succes(etat, seq, revision) {
  if (obsolete(etat, seq)) return etat;   // réponse d'une requête dépassée
  return { ...etat, enVol: null, revision: Number(revision) };
}

// Écriture refusée : le phasage a changé ailleurs. Le lot est ABANDONNÉ —
// jamais réappliqué automatiquement — et l'auto-save se met en pause.
// La révision réelle est mémorisée pour information.
export function conflit(etat, seq, revision) {
  if (obsolete(etat, seq)) return etat;
  return {
    ...etat,
    enVol: null,
    conflit: true,
    revision: revision === null || revision === undefined ? etat.revision : Number(revision),
  };
}

// Échec technique (réseau, serveur) : ce n'est PAS un conflit. Le lot
// retourne en attente pour être retenté — mais les changements survenus
// depuis priment, ils sont plus récents.
export function echec(etat, seq) {
  if (obsolete(etat, seq)) return etat;
  const lot = etat.enVol.lot;
  return { ...etat, enVol: null, attente: { ...lot, ...(etat.attente || {}) } };
}

// Après rechargement volontaire de la version récente : l'état local est
// remplacé, il n'y a donc plus rien en attente et l'auto-save repart.
export function apresRechargement(etat, revision) {
  return { ...etatInitial(Number(revision)), seq: etat.seq };
}

// Y a-t-il du travail non enregistré ? Sert à l'avertissement de sortie.
export function aDesChangementsNonEnregistres(etat) {
  return !!(etat.attente || etat.enVol || etat.conflit);
}

// L'auto-save est-il suspendu ? Sert à l'indication persistante à l'écran.
export function estSuspendu(etat) {
  return etat.conflit === true;
}
