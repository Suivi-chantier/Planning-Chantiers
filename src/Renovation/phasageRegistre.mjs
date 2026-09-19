// ─────────────────────────────────────────────────────────────────────────────
// phasageRegistre — registre PUR des révisions de phasage, partagé par les
// écrans qui font des écritures ponctuelles (Planning commandes, Validation,
// helpers planning).
//
// AUCUN import : ni React, ni supabase. C'est ce qui permet de tester le
// comportement de concurrence en Node, sans navigateur
// (scripts/verif-phasage-ecriture.mjs). Les appels réseau vivent à côté,
// dans phasageEcriture.mjs.
//
// Chaque fonction renvoie un NOUVEL état : une révision par phasage, plus un
// verrou par phasage qui interdit deux écritures simultanées sur la même
// ligne (double clic) et permet d'ignorer une réponse obsolète.
// ─────────────────────────────────────────────────────────────────────────────

// ── Registre pur ────────────────────────────────────────────────────────────

export function creerRegistre() {
  return { revisions: {}, enVol: {} };
}

// Mémorise la révision reçue AVEC le phasage. Sans elle, on n'écrit rien.
export function noterRevision(reg, phasageId, revision) {
  if (!phasageId) return reg;
  const r = revision === null || revision === undefined ? null : Number(revision);
  return { ...reg, revisions: { ...reg.revisions, [String(phasageId)]: r } };
}

export function noterRevisions(reg, entrees) {
  return (entrees || []).reduce((acc, e) => noterRevision(acc, e?.id, e?.revision), reg);
}

export function revisionDe(reg, phasageId) {
  const v = reg?.revisions?.[String(phasageId)];
  return v === undefined ? null : v;
}

// Démarre une écriture. Refusée si une autre est déjà en vol sur CE phasage
// (double clic) ou si la révision est inconnue. `jeton` sert à repérer les
// réponses obsolètes.
export function debuterEcriture(reg, phasageId) {
  const cle = String(phasageId || "");
  if (!cle || revisionDe(reg, cle) === null) return { reg, ok: false, jeton: null };
  if (reg.enVol[cle]) return { reg, ok: false, jeton: null };
  const jeton = (reg.enVol[cle + "__seq"] || 0) + 1;
  return {
    reg: { ...reg, enVol: { ...reg.enVol, [cle]: jeton, [cle + "__seq"]: jeton } },
    ok: true,
    jeton,
  };
}

const perime = (reg, cle, jeton) => reg.enVol[cle] !== jeton;

// Succès : on adopte la révision renvoyée par la base.
export function terminerEcriture(reg, phasageId, jeton, revision) {
  const cle = String(phasageId || "");
  if (perime(reg, cle, jeton)) return reg;          // réponse dépassée
  const enVol = { ...reg.enVol }; delete enVol[cle];
  return { ...noterRevision({ ...reg, enVol }, cle, revision), enVol };
}

// Échec technique : rien n'a changé en base, on peut réessayer. La révision
// reste celle qu'on avait.
export function echecEcriture(reg, phasageId, jeton) {
  const cle = String(phasageId || "");
  if (perime(reg, cle, jeton)) return reg;
  const enVol = { ...reg.enVol }; delete enVol[cle];
  return { ...reg, enVol };
}

// Conflit : la ligne a bougé. On libère le verrou de double clic mais on
// N'ADOPTE PAS de nouvelle révision — l'écran doit recharger, il ne doit
// surtout pas pouvoir réessayer la même écriture avec la version fraîche.
export function conflitEcriture(reg, phasageId, jeton) {
  const cle = String(phasageId || "");
  if (perime(reg, cle, jeton)) return reg;
  const enVol = { ...reg.enVol }; delete enVol[cle];
  return { ...reg, enVol, revisions: { ...reg.revisions, [cle]: null } };
}

export function ecritureEnCours(reg, phasageId) {
  return !!reg?.enVol?.[String(phasageId || "")];
}

// ── Choix de la ligne à ouvrir quand un chantier en porte plusieurs ────────
// Un chantier ne DEVRAIT avoir qu'un phasage. Il peut en avoir deux : cas
// hérités, et doublons créés par la régression du 17/09 (la normalisation des
// ids à l'ouverture insérait une seconde ligne, restée vide).
//
// maybeSingle() renvoyait alors une erreur : l'éditeur s'ouvrait vide et le
// rechargement échouait. On ouvre donc celle qui porte le travail — jamais la
// coquille vide — et l'appelant signale le doublon. Choix PUR et déterministe,
// aucune ligne n'est modifiée ni supprimée ici.
export function choisirPhasage(lignes) {
  const liste = Array.isArray(lignes) ? lignes.filter(Boolean) : [];
  if (liste.length === 0) return null;
  if (liste.length === 1) return liste[0];
  const poids = (p) => (Array.isArray(p?.ouvrages) ? p.ouvrages.length : 0);
  const rev = (p) => (typeof p?.revision === "number" ? p.revision : -1);
  return liste.reduce((meilleur, candidat) => {
    if (poids(candidat) !== poids(meilleur)) return poids(candidat) > poids(meilleur) ? candidat : meilleur;
    if (rev(candidat) !== rev(meilleur)) return rev(candidat) > rev(meilleur) ? candidat : meilleur;
    return meilleur;   // à égalité stricte, le premier reçu
  });
}
