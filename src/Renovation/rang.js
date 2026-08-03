// ─── MÉTHODE DES RANGS — chaînage par défaut (Point 4a) ──────────────────────
// Fonctions PURES, sans import : aucune lecture ni écriture Supabase, aucun
// state. Le graphe de dépendances par défaut est DÉDUIT de l'existant
// (ordre des groupes + chrono_ordre) et n'est JAMAIS stocké : le champ
// tache.predecesseurs n'enregistre que les écarts à ce défaut.
//
// Sémantique du champ predecesseurs (décision du plan Point 4a) :
//   - absent / null / non-tableau → « utiliser le chaînage par défaut » ;
//   - tableau (même vide)        → prédécesseurs EXPLICITES ; [] signifie
//     « vraiment aucun prédécesseur » (tâche parallèle libre).
//
// Entrées : `ouvrages` = phasage.ouvrages (V2), `groupes` =
// plan_travaux.meta.chrono_groupes. Les jalons (meta.chrono_jalons) ne sont
// pas des tâches : ils n'entrent jamais dans le chaînage.

// Tri intra-groupe IDENTIQUE à itemsOfGroup (PhasageV2) : chrono_ordre peut
// avoir des trous, des doublons, des valeurs géantes (jalon de contrôle à
// 1e9 + n) ou manquer — la règle est `?? 1e9` puis départage par nom, pour
// que le chaînage suive exactement ce que l'utilisateur voit dans la Chrono.
const triChrono = (a, b) =>
  ((a.chrono_ordre ?? 1e9) - (b.chrono_ordre ?? 1e9)) ||
  String(a.nom || "").localeCompare(String(b.nom || ""));

// Organise les tâches comme les vues du Phasage : groupes triés par `ordre`,
// tâches triées dans chaque groupe, et les « à classer » à part (sans
// chrono_groupe_id OU pointant un groupe supprimé — toujours tester le Set,
// jamais la seule nullité).
// Retourne { taches, groupesTries, parGroupe: Map(gid → taches[]), horsGroupe }.
export function organiserTaches(ouvrages, groupes) {
  const taches = (Array.isArray(ouvrages) ? ouvrages : [])
    .flatMap(o => (Array.isArray(o?.taches) ? o.taches : []))
    .filter(t => t && t.id != null);
  const groupesTries = (Array.isArray(groupes) ? groupes : [])
    .filter(g => g && g.id != null)
    .slice()
    .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
  const groupeIds = new Set(groupesTries.map(g => g.id));
  const parGroupe = new Map(groupesTries.map(g => [g.id, []]));
  const horsGroupe = [];
  taches.forEach(t => {
    if (t.chrono_groupe_id && groupeIds.has(t.chrono_groupe_id)) {
      parGroupe.get(t.chrono_groupe_id).push(t);
    } else {
      horsGroupe.push(t);
    }
  });
  parGroupe.forEach(list => list.sort(triChrono));
  return { taches, groupesTries, parGroupe, horsGroupe };
}

// ── 1) Chaînage PAR DÉFAUT (gratuit, calculé — rien à saisir) ────────────────
// - dans un groupe : le prédécesseur d'une tâche est celle qui la précède
//   dans chrono_ordre ;
// - la première tâche d'un groupe suit la DERNIÈRE tâche du groupe précédent
//   non vide (un groupe vide est transparent : il ne casse pas la chaîne) ;
// - la toute première tâche du chantier n'a pas de prédécesseur ;
// - les tâches « à classer » ne sont PAS chaînées de force (absentes du
//   résultat — voir predecesseursEffectifs pour leur traitement).
// Retourne Map(tacheId → [predId]) — 0 ou 1 prédécesseur par construction.
export function chainageParDefaut(ouvrages, groupes) {
  const { groupesTries, parGroupe } = organiserTaches(ouvrages, groupes);
  const defauts = new Map();
  let derniereDuPrecedent = null;
  groupesTries.forEach(g => {
    const list = parGroupe.get(g.id) || [];
    list.forEach((t, i) => {
      const pred = i === 0 ? derniereDuPrecedent : list[i - 1];
      defauts.set(String(t.id), pred ? [String(pred.id)] : []);
    });
    if (list.length > 0) derniereDuPrecedent = list[list.length - 1];
  });
  return defauts;
}

// ── 2) Prédécesseurs EFFECTIFS ───────────────────────────────────────────────
// Pour chaque tâche : ses prédécesseurs explicites s'ils sont renseignés
// (tableau, même vide), SINON le chaînage par défaut. Les ids explicites sont
// renvoyés TELS QUELS (un id de tâche supprimée est détecté au calcul des
// rangs, pas ici). `source` dit d'où vient la valeur — la vue s'en sert pour
// distinguer visuellement le déduit du saisi :
//   "explicite"   → champ predecesseurs renseigné sur la tâche ;
//   "defaut"      → chaînage par défaut ;
//   "hors_chaine" → tâche à classer, non chaînée (aucun prédécesseur déduit).
// Retourne Map(tacheId → { ids: string[], source }).
export function predecesseursEffectifs(ouvrages, groupes) {
  const { taches, horsGroupe } = organiserTaches(ouvrages, groupes);
  const defauts = chainageParDefaut(ouvrages, groupes);
  const horsIds = new Set(horsGroupe.map(t => String(t.id)));
  const effectifs = new Map();
  taches.forEach(t => {
    const id = String(t.id);
    if (Array.isArray(t.predecesseurs)) {
      effectifs.set(id, { ids: t.predecesseurs.filter(x => x != null).map(String), source: "explicite" });
    } else if (horsIds.has(id)) {
      effectifs.set(id, { ids: [], source: "hors_chaine" });
    } else {
      effectifs.set(id, { ids: defauts.get(id) || [], source: "defaut" });
    }
  });
  return effectifs;
}
