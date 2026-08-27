// ─── INFÉRENCE DE DÉPENDANCES V1 ────────────────────────────────────────────
// Propositions PURES et EXPLICABLES pour les dépendances internes d'un ouvrage.
// Aucune lecture/écriture Supabase. Rien n'est appliqué automatiquement ici.
//
// Principe fondamental : ordre d'affichage ≠ dépendance dure.
// On ne propose une dépendance `certain` que lorsque l'enchaînement technique
// interne de l'ouvrage est suffisamment évident et stable.

export const CONFIANCE_DEPENDANCE_V1 = Object.freeze({
  CERTAIN: "certain",
  PROBABLE: "probable",
  REVIEW: "review",
});

const str = v => String(v ?? "").trim();

export function codeOuvrageV1(libelle) {
  const m = str(libelle).match(/^([A-Z]{1,3})[\s\-._]?(\d{1,5}(?:\.\d+)?)\b/i);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
}

function suggestion(st, predIds, confiance, regle, raison) {
  return {
    sous_tache_id: str(st?.id) || null,
    nom: str(st?.nom),
    dependance_mode: predIds.length ? "explicit" : "parallel",
    predecesseur_ids: [...new Set(predIds.map(str).filter(Boolean))],
    confiance,
    regle,
    raison,
  };
}

function chaineLineaire(sts, { regle, raison, confiance = CONFIANCE_DEPENDANCE_V1.CERTAIN } = {}) {
  return sts.map((st, idx) => suggestion(
    st,
    idx === 0 ? [] : [sts[idx - 1]?.id],
    confiance,
    regle,
    idx === 0 ? "Début de la chaîne technique interne de l'ouvrage." : raison,
  ));
}

// Les familles ci-dessous sont volontairement limitées aux cas simples déjà
// lisibles directement dans les sous-tâches. Les ouvrages composites (SDB,
// cuisine complète, installation électrique complète...) sont exclus tant que
// leurs branches et dépendances externes ne sont pas validées métier.
const CHAINES_CERTAINES = Object.freeze({
  "D-003": {
    regle: "carottage-before-drain-connection",
    raison: "Le raccordement de l'évacuation ne peut être réalisé qu'après le carottage préparatoire.",
  },
  "E-006": {
    regle: "lighting-feed-before-fitoff",
    raison: "La pose/raccordement du luminaire nécessite l'alimentation préalablement passée.",
  },
  "E-007": {
    regle: "lighting-feed-before-fitoff",
    raison: "La pose/raccordement du luminaire nécessite l'alimentation préalablement passée.",
  },
  "ME-021": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "ME-022": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "ME-023": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "ME-031": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "ME-032": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "ME-033": {
    regle: "external-joinery-install-seal-adjust",
    raison: "La mise en place précède l'étanchéité, puis les réglages et finitions de pose.",
  },
  "MU-001": {
    regle: "lining-frame-insulate-board-finish",
    raison: "Ossature, isolation, plaque puis passes d'enduit forment une chaîne technique interne.",
  },
  "MU-002": {
    regle: "partition-frame-insulate-board-finish",
    raison: "Ossature, isolation, plaque puis passes d'enduit forment une chaîne technique interne.",
  },
  "MU-003": {
    regle: "bonded-board-install-finish",
    raison: "Préparation/encollage, pose des plaques puis bandes et passes d'enduit forment une chaîne technique interne.",
  },
  "MU-005": {
    regle: "hydro-partition-frame-insulate-board-finish",
    raison: "Ossature, isolation, plaque hydro puis passes d'enduit forment une chaîne technique interne.",
  },
  "PL-001": {
    regle: "ceiling-frame-board-finish",
    raison: "L'ossature précède le plaquage, puis les bandes et passes d'enduit.",
  },
  "P-032": {
    regle: "general-drain-install-before-connection",
    raison: "La pose de l'évacuation générale précède son raccordement au réseau existant et le contrôle.",
  },
});

export function proposerDependancesOuvrageV1(ouvrage) {
  const sts = Array.isArray(ouvrage?.sous_taches) ? ouvrage.sous_taches : [];
  const code = str(ouvrage?.code_ouvrage) || codeOuvrageV1(ouvrage?.libelle);
  const idsOk = sts.every(st => str(st?.id));

  if (!sts.length) {
    return {
      code,
      applicable: false,
      confiance: CONFIANCE_DEPENDANCE_V1.REVIEW,
      raison: "Ouvrage sans sous-tâches.",
      suggestions: [],
    };
  }
  if (!idsOk) {
    return {
      code,
      applicable: false,
      confiance: CONFIANCE_DEPENDANCE_V1.REVIEW,
      raison: "Identifiants stables manquants : impossible de produire des prédécesseurs robustes.",
      suggestions: [],
    };
  }

  const pattern = CHAINES_CERTAINES[code];
  if (pattern) {
    return {
      code,
      applicable: true,
      confiance: CONFIANCE_DEPENDANCE_V1.CERTAIN,
      raison: pattern.raison,
      suggestions: chaineLineaire(sts, pattern),
    };
  }

  return {
    code,
    applicable: false,
    confiance: CONFIANCE_DEPENDANCE_V1.REVIEW,
    raison: "Ouvrage composite ou règle technique non encore validée : aucune dépendance dure proposée automatiquement.",
    suggestions: sts.map(st => suggestion(
      st,
      [],
      CONFIANCE_DEPENDANCE_V1.REVIEW,
      "no-safe-rule",
      "Aucune dépendance dure n'est supposée sans règle métier validée.",
    )),
  };
}

// Helper pur destiné aux previews/tests. Il n'écrit jamais en base.
export function appliquerPropositionDependancesV1(ouvrage, proposition) {
  const byId = new Map((proposition?.suggestions || []).map(s => [str(s.sous_tache_id), s]));
  return {
    ...ouvrage,
    sous_taches: (ouvrage?.sous_taches || []).map(st => {
      const s = byId.get(str(st?.id));
      if (!s || s.confiance !== CONFIANCE_DEPENDANCE_V1.CERTAIN) return st;
      return {
        ...st,
        dependance_mode: s.dependance_mode,
        predecesseur_ids: [...s.predecesseur_ids],
      };
    }),
  };
}
