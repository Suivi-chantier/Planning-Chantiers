// supabase/functions/_partage/pushGroupeV1.mjs
//
// Envoi GROUPÉ de deux types du catalogue en UN SEUL push par personne
// (projet docs/projets/notifications-push.md, tâche 4 : point du soir des
// conducteurs, C1 + C2). Module PUR : aucun accès Supabase, aucune horloge.
//
// Pourquoi : le catalogue sépare C1 (comptes rendus) et C2 (demandes de
// matériel) — chacun a ses rôles cochés, son interrupteur et la préférence de
// chaque personne (règle 6) — mais le cahier les regroupe dans le point de
// 18h30, et la règle 5 veut une seule notification par créneau.
//
// Fonctionnement, dans send-push (mode « serveur » avec un champ `groupe`) :
//   1. chaque type est planifié SÉPARÉMENT par le moteur existant
//      (planifierEnvoi : rôles, interrupteur du type, préférence, silence) ;
//   2. chaque type est écrit dans la boîte de réception sous SON type, avec
//      SON texte (une personne qui a coupé C2 voit sa ligne C2 « desactive »,
//      comme pour tout type coupé) ;
//   3. au moment du push, les lignes « a_envoyer » d'une même personne sont
//      réunies : deux lignes → UN push au contenu `ensemble` ; une seule →
//      le push de cette ligne, avec son propre texte. Personne ne reçoit donc
//      le contenu d'un type qu'il a coupé, ni deux push pour le point du soir.
//
// Utilisé par supabase/functions/send-push ; testé par
// scripts/verif-point-conducteurs.mjs.

import { validerContenu } from "./notificationsPushV1.mjs";

/**
 * Lit le champ `groupe` d'une demande send-push.
 * @param {object} corps   la demande reçue
 * @param {{ type: string, cle_regroupement: string|null }} principal  sortie de validerContenu
 * @returns {{ ok: true, groupe: null } | { ok: true, groupe: { type, titre, texte, lien, ensemble } } | { ok: false, statut: number, erreur: string }}
 */
export function validerGroupe(corps, principal) {
  const g = corps?.groupe;
  if (g == null) return { ok: true, groupe: null };
  if (typeof g !== "object" || Array.isArray(g)) return { ok: false, statut: 400, erreur: "Groupe illisible." };
  const second = validerContenu({ ...g, cle_regroupement: principal?.cle_regroupement });
  if (!second.ok) return { ok: false, statut: second.statut, erreur: `Groupe : ${second.erreur}` };
  if (second.type === principal?.type) return { ok: false, statut: 400, erreur: "Groupe : le second type doit différer du premier." };
  if (!principal?.cle_regroupement) return { ok: false, statut: 400, erreur: "Groupe : une clé de regroupement est obligatoire." };
  const ens = validerContenu({ ...(g.ensemble || {}), type: principal.type });
  if (!ens.ok) return { ok: false, statut: ens.statut, erreur: `Contenu commun : ${ens.erreur}` };
  return {
    ok: true,
    groupe: {
      type: second.type, titre: second.titre, texte: second.texte, lien: second.lien,
      ensemble: { titre: ens.titre, texte: ens.texte, lien: ens.lien },
    },
  };
}

/**
 * Push à envoyer, une entrée par personne.
 * @param {{
 *   lignes: Array<{ id: string, user_id: string, type: string, titre: string, texte: string, lien: string, push_statut: string }>,
 *   typePrincipal: string,
 *   ensemble: { titre: string, texte: string, lien: string } | null,
 * }} p   lignes = notifications réellement créées en boîte (les deux types)
 * @returns {Array<{ user_id: string, ids: string[], notif: { type, titre, texte, lien } }>}
 */
export function envoisParPersonne({ lignes, typePrincipal, ensemble }) {
  const parPersonne = new Map();
  for (const l of lignes || []) {
    if (l?.push_statut !== "a_envoyer") continue;
    if (!parPersonne.has(l.user_id)) parPersonne.set(l.user_id, []);
    parPersonne.get(l.user_id).push(l);
  }
  const envois = [];
  for (const [user_id, ls] of parPersonne) {
    if (ls.length >= 2 && ensemble) {
      envois.push({
        user_id, ids: ls.map((l) => l.id),
        notif: { type: typePrincipal, titre: ensemble.titre, texte: ensemble.texte, lien: ensemble.lien },
      });
    } else {
      for (const l of ls) {
        envois.push({ user_id, ids: [l.id], notif: { type: l.type, titre: l.titre, texte: l.texte, lien: l.lien } });
      }
    }
  }
  return envois;
}

/**
 * Simulation : ce que chaque personne recevrait (aucune écriture).
 * @param {{ lignesPrincipal: Array<{user_id, nom, role, push_statut}>, lignesGroupe: Array<object>, typePrincipal: string, typeGroupe: string }} p
 */
export function simulationParPersonne({ lignesPrincipal, lignesGroupe, typePrincipal, typeGroupe }) {
  const personnes = new Map();
  const ajouter = (l, type) => {
    if (!personnes.has(l.user_id)) personnes.set(l.user_id, { nom: l.nom, role: l.role, boite: [], push: [] });
    const p = personnes.get(l.user_id);
    p.boite.push(`${type}:${l.push_statut}`);
    if (l.push_statut === "a_envoyer") p.push.push(type);
  };
  for (const l of lignesPrincipal || []) ajouter(l, typePrincipal);
  for (const l of lignesGroupe || []) ajouter(l, typeGroupe);
  return [...personnes.values()].map((p) => ({
    nom: p.nom, role: p.role, boite: p.boite,
    push: p.push.length === 0 ? "aucun" : p.push.length === 2 ? "un seul push (les deux parties)" : `un seul push (${p.push[0]})`,
  }));
}
