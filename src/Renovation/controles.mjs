// ─────────────────────────────────────────────────────────────────────────────
// CONTRÔLES DE GROUPE & RÉSERVES — calculs purs (Point 2 b, Prompt 4).
//
// Fonctions pures sur les lignes des tables controles_groupe et reserves
// (sql/202607_controles_groupe.sql) : aucune dépendance, aucun accès DB,
// aucune horloge — les appelants chargent les lignes et passent todayISO.
// Extension .mjs = testable en Node sans build, comme qcd.mjs / cycleVie.mjs.
//
// C'est CE module qui « expose » les compteurs par groupe et par chantier :
// réserves ouvertes, NOK, taux de conformité (tâches non signalées ÷ tâches
// contrôlées), ancienneté de la plus vieille réserve non levée — les entrées
// du badge d'état de groupe (Prompt 5) et du sommet Qualité (Prompt 6).
// ─────────────────────────────────────────────────────────────────────────────

// Une réserve levée reste en base (historique) : « ouverte » = non levée.
export const reserveOuverte = (r) => !!r && !r.levee_le;

// Ancienneté d'une réserve en JOURS (null si dates illisibles).
export function ancienneteJours(reserve, todayISO) {
  const d = new Date(`${String(reserve?.created_at || "").slice(0, 10)}T00:00:00Z`);
  const t = new Date(`${String(todayISO || "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(t.getTime())) return null;
  return Math.max(0, Math.round((t - d) / 86400000));
}

export function libelleAnciennete(jours) {
  if (jours == null) return "";
  if (jours <= 0) return "ouverte aujourd'hui";
  if (jours === 1) return "ouverte depuis hier";
  return `ouverte depuis ${jours} jours`;
}

// « Non levée depuis N contrôles » : contrôles du CHANTIER réalisés après la
// création de la réserve (hors son contrôle d'origine) — le conducteur est
// repassé N fois en contrôle sans la lever. C'est le signal fort.
export function nbControlesDepuis(reserve, controles) {
  if (!reserve) return 0;
  return (controles || []).filter(c =>
    c && c.id !== reserve.controle_id &&
    String(c.date_controle || "") > String(reserve.created_at || "")
  ).length;
}

// Dernier contrôle d'un groupe (les recontrôles remplacent l'état courant).
export function dernierControleGroupe(groupeId, controles) {
  return (controles || [])
    .filter(c => c && c.groupe_id === groupeId)
    .sort((a, b) => String(b.date_controle || "").localeCompare(String(a.date_controle || "")))[0] || null;
}

// ── Compteurs PAR GROUPE ─────────────────────────────────────────────────────
// reserves/controles : lignes du chantier (le filtre groupe est fait ici).
export function statsReservesGroupe(groupeId, reserves, controles, todayISO) {
  const ouvertes = (reserves || []).filter(r => r && r.groupe_id === groupeId && reserveOuverte(r));
  const nbNok = ouvertes.filter(r => r.statut === "nok").length;
  const anciennetes = ouvertes.map(r => ancienneteJours(r, todayISO)).filter(n => n != null);
  const dernier = dernierControleGroupe(groupeId, controles);
  return {
    controle: dernier,                      // null = groupe jamais contrôlé
    reservesOuvertes: ouvertes.length,
    nbNok,
    tauxConformite: dernier && dernier.nb_taches > 0 ? dernier.nb_conformes / dernier.nb_taches : null,
    plusAncienneJours: anciennetes.length ? Math.max(...anciennetes) : null,
  };
}

// ── Compteurs PAR CHANTIER ───────────────────────────────────────────────────
// Taux de conformité global = Σ conformes ÷ Σ tâches contrôlées, sur le
// DERNIER contrôle de chaque groupe (un recontrôle remplace le précédent).
export function statsReservesChantier(reserves, controles, todayISO) {
  const ouvertes = (reserves || []).filter(reserveOuverte);
  const nbNok = ouvertes.filter(r => r.statut === "nok").length;
  const anciennetes = ouvertes.map(r => ancienneteJours(r, todayISO)).filter(n => n != null);
  const groupesControles = [...new Set((controles || []).map(c => c?.groupe_id).filter(Boolean))];
  let taches = 0, conformes = 0;
  groupesControles.forEach(gid => {
    const d = dernierControleGroupe(gid, controles);
    if (d) { taches += parseInt(d.nb_taches) || 0; conformes += parseInt(d.nb_conformes) || 0; }
  });
  return {
    nbGroupesControles: groupesControles.length,
    reservesOuvertes: ouvertes.length,
    nbNok,
    tauxConformite: taches > 0 ? conformes / taches : null,
    plusAncienneJours: anciennetes.length ? Math.max(...anciennetes) : null,
  };
}
