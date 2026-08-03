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
//   résultat — voir predecesseursEffectifs pour leur traitement) ;
// - DÉCLARÉ > DÉDUIT : une tâche précédente qui déclare EXPLICITEMENT la
//   tâche courante comme prédécesseur est transparente pour le chaînage —
//   sinon le lien déduit « t suit sa précédente » fabriquerait un faux cycle
//   défaut ↔ explicite dès qu'on inverse deux tâches par saisie (le cas
//   « ordre contradictoire », signalé par calculerRangs, resterait
//   incalculable au lieu d'être simplement signalé).
// Retourne Map(tacheId → [predId]) — 0 ou 1 prédécesseur par construction.
export function chainageParDefaut(ouvrages, groupes) {
  const { groupesTries, parGroupe } = organiserTaches(ouvrages, groupes);
  // La séquence manuelle aplatie : les groupes vides disparaissent d'eux-mêmes,
  // et le lien inter-groupes (première ← dernière du précédent) devient un
  // simple « précédente dans la séquence ».
  const sequence = groupesTries.flatMap(g => parGroupe.get(g.id) || []);
  const defauts = new Map();
  sequence.forEach((t, k) => {
    const tId = String(t.id);
    let j = k - 1;
    while (j >= 0 && Array.isArray(sequence[j].predecesseurs)
           && sequence[j].predecesseurs.map(String).includes(tId)) j--;
    defauts.set(tId, j >= 0 ? [String(sequence[j].id)] : []);
  });
  return defauts;
}

// ── 1 bis) Position MANUELLE globale ─────────────────────────────────────────
// L'index de chaque tâche dans l'ordre manuel (groupes triés par ordre, puis
// chrono_ordre dans le groupe) — la séquence que montre la vue Chronologique.
// Les tâches hors groupe n'ont pas de position manuelle (absentes de la Map).
// Sert à détecter les ordres contradictoires et à départager les rangs égaux.
export function positionsManuelles(ouvrages, groupes) {
  const { groupesTries, parGroupe } = organiserTaches(ouvrages, groupes);
  const pos = new Map();
  let i = 0;
  groupesTries.forEach(g => (parGroupe.get(g.id) || []).forEach(t => pos.set(String(t.id), i++)));
  return pos;
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

// ── 3) CALCUL DES RANGS + détection des incohérences ─────────────────────────
// Méthode des rangs (tri topologique par niveaux) :
//   rang 1 = tâches sans prédécesseur effectif ;
//   rang N = tâches dont TOUS les prédécesseurs sont de rang < N.
// Les tâches de MÊME rang peuvent se faire EN PARALLÈLE — c'est l'information
// centrale de la vue : `parRang` la donne directement (parRang[0] = rang 1).
// Les tâches « à classer » participent (aucun prédécesseur → rang 1) : la vue
// les distingue par `sources`.
//
// Incohérences renvoyées comme DONNÉES, jamais d'exception :
//   - introuvables : id de prédécesseur explicite qui ne correspond plus à
//     une tâche (supprimée) → ignoré pour le calcul, mais signalé ;
//   - cycles : dépendances circulaires (A avant B avant A) — détectées après
//     un Kahn borné (jamais de boucle infinie), membres exacts par
//     composantes fortement connexes ; une auto-référence est un cycle ;
//   - bloquees : tâches hors cycle mais EN AVAL d'un cycle (non rangeables) ;
//   - ordresContradictoires : une tâche placée AVANT son prédécesseur
//     EXPLICITE dans l'ordre manuel (le chaînage par défaut, déduit de cet
//     ordre, ne peut pas le contredire).
//
// Retour : { rangs: Map(id → rang 1..N), parRang: [[ids]…], maxRang,
//            sources: Map(id → source), incoherences }.
export function calculerRangs(ouvrages, groupes) {
  const { taches } = organiserTaches(ouvrages, groupes);
  const effectifs = predecesseursEffectifs(ouvrages, groupes);
  const posManuel = positionsManuelles(ouvrages, groupes);
  const existants = new Set(taches.map(t => String(t.id)));

  // Prédécesseurs valides (ids existants seulement) + introuvables signalés.
  const preds = new Map();
  const introuvables = [];
  effectifs.forEach(({ ids }, id) => {
    const valides = [];
    ids.forEach(p => {
      if (existants.has(p)) valides.push(p);
      else introuvables.push({ tacheId: id, predId: p });
    });
    preds.set(id, valides);
  });

  // Kahn par niveaux, borné par le nombre de tâches : si un niveau n'absorbe
  // plus rien, le reste est bloqué (cycle ou aval de cycle) — on s'arrête.
  const rangs = new Map();
  const parRang = [];
  let restantes = new Set(preds.keys());
  for (let n = 1; n <= taches.length && restantes.size > 0; n++) {
    const niveau = [...restantes].filter(id => preds.get(id).every(p => rangs.has(p)));
    if (niveau.length === 0) break;
    niveau.sort((a, b) => (posManuel.get(a) ?? Infinity) - (posManuel.get(b) ?? Infinity));
    niveau.forEach(id => { rangs.set(id, n); restantes.delete(id); });
    parRang.push(niveau);
  }

  // Membres exacts des cycles parmi les non-rangées : composantes fortement
  // connexes (Tarjan) du sous-graphe restant. SCC de taille > 1, ou tâche qui
  // se référence elle-même. Le reste des non-rangées est « bloqué » (en aval).
  const cycles = [];
  if (restantes.size > 0) {
    const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
    let idx = 0;
    const strong = (v) => {
      index.set(v, idx); low.set(v, idx); idx++;
      stack.push(v); onStack.add(v);
      (preds.get(v) || []).forEach(w => {
        if (!restantes.has(w)) return;
        if (!index.has(w)) { strong(w); low.set(v, Math.min(low.get(v), low.get(w))); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      });
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1 || (preds.get(v) || []).includes(v)) cycles.push(comp.reverse());
      }
    };
    restantes.forEach(v => { if (!index.has(v)) strong(v); });
  }
  const dansCycle = new Set(cycles.flat());
  const bloquees = [...restantes].filter(id => !dansCycle.has(id));

  // Ordres contradictoires : uniquement sur les prédécesseurs EXPLICITES, et
  // seulement quand les deux tâches ont une position manuelle.
  const ordresContradictoires = [];
  effectifs.forEach(({ ids, source }, id) => {
    if (source !== "explicite") return;
    const pi = posManuel.get(id);
    if (pi === undefined) return;
    ids.forEach(p => {
      const pp = posManuel.get(p);
      if (pp !== undefined && pp > pi) ordresContradictoires.push({ tacheId: id, predId: p });
    });
  });

  const sources = new Map();
  effectifs.forEach(({ source }, id) => sources.set(id, source));

  return {
    rangs, parRang, maxRang: parRang.length, sources,
    incoherences: { cycles, bloquees, ordresContradictoires, introuvables },
  };
}

// ── 4) Ordre PROPOSÉ ─────────────────────────────────────────────────────────
// Les tâches triées par rang croissant, puis par ordre manuel à rang égal
// (puis par nom, pour un résultat déterministe). Ne modifie RIEN : c'est une
// proposition — l'écriture éventuelle (via applyChrono) est l'affaire du
// Prompt 5, avec aperçu et confirmation.
// Retourne { ordonnees: [{ tache, rang }], nonRangees: [tache] } — les
// non-rangées (cycle ou aval de cycle) sont à traiter via les incohérences.
export function ordrePropose(ouvrages, groupes) {
  const { taches } = organiserTaches(ouvrages, groupes);
  const { rangs } = calculerRangs(ouvrages, groupes);
  const posManuel = positionsManuelles(ouvrages, groupes);
  const parId = new Map(taches.map(t => [String(t.id), t]));
  const ordonnees = [...rangs.keys()]
    .sort((a, b) =>
      (rangs.get(a) - rangs.get(b)) ||
      ((posManuel.get(a) ?? Infinity) - (posManuel.get(b) ?? Infinity)) ||
      String(parId.get(a)?.nom || "").localeCompare(String(parId.get(b)?.nom || "")))
    .map(id => ({ tache: parId.get(id), rang: rangs.get(id) }));
  const nonRangees = taches.filter(t => !rangs.has(String(t.id)));
  return { ordonnees, nonRangees };
}
