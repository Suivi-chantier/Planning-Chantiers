import { GROUPE_DEPENDENCIES_V1 } from "./planningRulesV1.js";

const str = v => String(v ?? "").trim();
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const progression = t => {
  const n = num(t?.avancement);
  return n == null ? 0 : Math.max(0, Math.min(100, n));
};

const estTerminee = t => progression(t) >= 100;

function dateMs(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function delaiMs(dep) {
  const n = num(dep?.delai_min_calendaire) || 0;
  const unite = str(dep?.unite_delai || "heures").toLowerCase();
  if (unite.startsWith("jour")) return n * 24 * 60 * 60 * 1000;
  if (unite.startsWith("min")) return n * 60 * 1000;
  return n * 60 * 60 * 1000;
}

function dependancesExplicites(task) {
  const riches = Array.isArray(task?.dependances) ? task.dependances : [];
  const byPred = new Map();
  riches.forEach(dep => {
    const id = str(dep?.predecesseur_id);
    if (id) byPred.set(id, { ...dep, predecesseur_id: id, source: dep.origine || "tache" });
  });
  (Array.isArray(task?.predecesseurs) ? task.predecesseurs : []).forEach(id0 => {
    const id = str(id0);
    if (id && !byPred.has(id)) {
      byPred.set(id, {
        predecesseur_id: id,
        contrainte: "hard",
        relation: "finish_to_start",
        delai_min_calendaire: 0,
        unite_delai: "heures",
        source: "predecesseurs",
      });
    }
  });
  return [...byPred.values()];
}

// `resolveScope(pred, succ, rule)` doit retourner :
// - true  : la règle concerne bien ces deux travaux ;
// - false : ils sont indépendants ;
// - null/undefined : contexte insuffisant (ex. aucune notion de pièce/zone).
//
// Sécurité V1 : une règle `supports_concernes` inconnue NE BLOQUE PAS le
// chantier entier. Elle remonte un warning explicable jusqu'à ce qu'un contexte
// ou une dépendance d'ouvrage précise le lien.
export function evaluerEligibiliteTacheV1(task, {
  taches = [],
  maintenant = new Date(),
  resolveScope = () => null,
  getCompletionDate = t => t?.date_fin_reelle || t?.completed_at || null,
  globalRules = GROUPE_DEPENDENCIES_V1,
} = {}) {
  const all = Array.isArray(taches) ? taches : [];
  const byId = new Map(all.map(t => [str(t?.id), t]).filter(([id]) => id));
  const blockers = [];
  const warnings = [];
  const preferences = [];
  let earliestMs = null;
  const nowMs = dateMs(maintenant) ?? Date.now();

  const applyDependency = (pred, dep, sourceLabel) => {
    if (!pred) {
      blockers.push({
        type: "predecesseur_introuvable",
        predecesseur_id: str(dep?.predecesseur_id) || null,
        source: sourceLabel,
        explication: "La tâche référence un prédécesseur introuvable.",
      });
      return;
    }

    if (!estTerminee(pred)) {
      blockers.push({
        type: "predecesseur_non_termine",
        predecesseur_id: str(pred.id),
        predecesseur_nom: str(pred.nom) || null,
        avancement: progression(pred),
        source: sourceLabel,
        explication: `${str(pred.nom) || "Le prédécesseur"} doit être terminé avant cette tâche.`,
      });
      return;
    }

    const wait = delaiMs(dep);
    if (wait <= 0) return;
    const completedMs = dateMs(getCompletionDate(pred));
    if (completedMs == null) {
      warnings.push({
        type: "date_fin_predecesseur_inconnue",
        predecesseur_id: str(pred.id),
        source: sourceLabel,
        explication: "Un délai technique existe mais la date de fin du prédécesseur est inconnue.",
      });
      return;
    }
    const ready = completedMs + wait;
    earliestMs = earliestMs == null ? ready : Math.max(earliestMs, ready);
    if (nowMs < ready) {
      blockers.push({
        type: "delai_technique",
        predecesseur_id: str(pred.id),
        predecesseur_nom: str(pred.nom) || null,
        source: sourceLabel,
        date_eligible: new Date(ready).toISOString(),
        explication: `Le délai technique après ${str(pred.nom) || "le prédécesseur"} n'est pas encore écoulé.`,
      });
    }
  };

  dependancesExplicites(task).forEach(dep => {
    if ((dep.contrainte || "hard") !== "hard") return;
    applyDependency(byId.get(str(dep.predecesseur_id)), dep, dep.source || "ouvrage_v2");
  });

  const succGroup = str(task?.groupe_type_id);
  (Array.isArray(globalRules) ? globalRules : []).filter(r => str(r.successeur_groupe_type_id) === succGroup).forEach(rule => {
    const candidates = all.filter(t => str(t?.groupe_type_id) === str(rule.predecesseur_groupe_type_id));
    if (rule.contrainte === "soft") {
      const incompletes = candidates.filter(t => !estTerminee(t));
      if (incompletes.length) {
        preferences.push({
          type: "ordre_prefere_groupe",
          rule_id: rule.id,
          predecesseur_groupe_type_id: rule.predecesseur_groupe_type_id,
          taches_incompletes: incompletes.map(t => ({ id: str(t.id), nom: str(t.nom), avancement: progression(t) })),
          explication: rule.explication,
        });
      }
      return;
    }

    if (rule.scope === "supports_concernes") {
      let inconnus = 0;
      candidates.forEach(pred => {
        const relation = resolveScope(pred, task, rule);
        if (relation === true) applyDependency(pred, rule, `regle_globale:${rule.id}`);
        else if (relation !== false) inconnus++;
      });
      if (inconnus > 0) {
        warnings.push({
          type: "scope_technique_inconnu",
          rule_id: rule.id,
          candidats_non_resolus: inconnus,
          explication: `${rule.explication} Le périmètre concerné n'est pas assez précis pour appliquer cette règle comme blocage global.`,
        });
      }
      return;
    }

    candidates.forEach(pred => applyDependency(pred, rule, `regle_globale:${rule.id}`));
  });

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    preferences,
    earliest_start: earliestMs == null ? null : new Date(earliestMs).toISOString(),
    explication: blockers.length
      ? `Tâche non éligible : ${blockers.length} blocage(s) actif(s).`
      : "Tâche éligible au regard des dépendances connues.",
  };
}
