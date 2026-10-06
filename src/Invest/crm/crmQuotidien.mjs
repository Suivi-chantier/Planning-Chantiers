// src/Invest/crm/crmQuotidien.mjs — Le CRM pour le suivi quotidien : « mes » missions d'abord, trois groupes, rien de superflu.
// Module pur (aucune base, aucune horloge). Les missions viennent de crmV2Vue.mjs (missionsAPiloter).

/** Une mission est « à moi » si j'en suis le conseiller ou le responsable de sa prochaine action. */
export const missionEstAMoi = (m, estMoi) => Boolean(estMoi(m?.conseiller) || estMoi(m?.responsable));

/**
 * Trois groupes lisibles d'un coup d'œil, plus « en attente du client » (replié) :
 *   urgent      retard ou blocage
 *   aujourdhui  échéance du jour
 *   a_faire     la balle est chez nous, ou aucune prochaine action n'est prévue
 *   attente     nous attendons le client
 * Une mission est dans UN seul groupe : le premier qui s'applique. Les autres (échéance lointaine…) n'y sont pas.
 */
export const GROUPES_QUOTIDIENS = Object.freeze([
  { cle: "urgent", titre: "Urgent", aide: "En retard ou bloqué", test: (m) => m.signaux.enRetard || m.signaux.bloquee },
  { cle: "aujourdhui", titre: "Aujourd'hui", aide: "Échéance du jour", test: (m) => m.signaux.aujourdhui },
  { cle: "a_faire", titre: "À faire", aide: "La balle est chez nous, ou rien n'est prévu", test: (m) => m.signaux.aFaireProfero || m.signaux.sansAction },
  { cle: "attente", titre: "En attente du client", aide: "Nous attendons un retour", test: (m) => m.signaux.attenteClient },
]);

export function repartirQuotidien(missions = []) {
  const groupes = GROUPES_QUOTIDIENS.map((g) => ({ cle: g.cle, titre: g.titre, aide: g.aide, missions: [] }));
  for (const m of missions) {
    const i = GROUPES_QUOTIDIENS.findIndex((g) => g.test(m));
    if (i >= 0) groupes[i].missions.push(m);
  }
  return groupes;
}

/** Clients du périmètre « moi » : ceux dont je suis le conseiller, ou qui ont une mission à moi. */
export function clientsDuPerimetre(lignes = [], idsMissionsMoi = new Set(), estMoi = () => false) {
  return lignes.filter((l) => estMoi(l.conseiller) || arr(l.missions).some((m) => idsMissionsMoi.has(m.dossierId)));
}
const arr = (a) => (Array.isArray(a) ? a : []);

/** Périmètre effectif : « moi » seulement s'il contient quelque chose (sinon on afficherait une liste vide à tort). */
export function perimetreEffectif(choix, nbMoi) {
  if (choix === "moi" || choix === "equipe") return choix;
  return nbMoi > 0 ? "moi" : "equipe";
}
