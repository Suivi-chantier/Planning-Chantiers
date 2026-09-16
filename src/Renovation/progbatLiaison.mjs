// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION « facture ProGBat → chantier Profero ».
//
// Une facture ProGBat porte un `quoteId`. Ce module fait le chemin jusqu'au
// chantier, et rien d'autre :
//
//   quoteId
//     → progbat_quote_exports.progbat_quote_id   (quel logement a ce devis)
//     → project_id
//     → chantier_projets.chantier_id             (rattachement posé à la main)
//
// MODULE PUR : aucun accès réseau, aucune requête, aucune horloge. L'appelant
// charge les deux listes et les passe ; ici on ne fait que croiser des
// IDENTIFIANTS. C'est délibéré et c'est la garantie principale : le module n'a
// accès ni au nom du client, ni à l'adresse, ni au montant, il ne peut donc pas
// « deviner » un chantier. Une facture qui ne se résout pas doit rester non
// résolue et être traitée à la main — jamais rattachée au chantier le plus
// probable.
//
// Extension .mjs = parsable ESM par Node sans build (tests, /api, Edge
// Functions via import) ; le front importe la façade progbatLiaison.js.
// ─────────────────────────────────────────────────────────────────────────────

// Les quatre issues possibles, toutes explicites : l'appelant doit pouvoir
// distinguer « je ne sais pas encore » de « ce n'est rattaché à rien ».
export const RESOLUTION = {
  RESOLU: "resolu",                         // chantier trouvé
  QUOTE_ABSENT: "quote_absent",             // la facture ne porte pas de quoteId (absent, 0, illisible)
  DEVIS_INCONNU: "devis_inconnu",           // quoteId inconnu de progbat_quote_exports
  PROJET_NON_RATTACHE: "projet_non_rattache", // logement connu, mais rattaché à aucun chantier
};

// Identifiant ProGBat exploitable : un entier strictement positif. 0, null,
// "" et "abc" sont tous « absent » — ProGBat numérote à partir de 1, un 0 est
// un champ vide, pas un devis.
const idProgbat = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
};

const cleProjet = (v) => (v === null || v === undefined || v === "" ? null : String(v));

// ── Résolution d'un quoteId ─────────────────────────────────────────────────
// exports  : lignes de progbat_devis_exportables() / progbat_quote_exports
//            → { projet_id | project_id, progbat_quote_id, progbat_quote_code?, statut? }
// liaisons : lignes de chantier_projets → { projet_id, chantier_id }
//
// Renvoie toujours la même forme, avec une `raison` affichable telle quelle.
export function resoudreChantierDepuisQuote(quoteId, { exports = [], liaisons = [] } = {}) {
  const quote = idProgbat(quoteId);
  if (quote === null) {
    return {
      statut: RESOLUTION.QUOTE_ABSENT,
      resolu: false, chantier_id: null, projet_id: null, quote_id: null,
      raison: "La facture ne référence aucun devis ProGBat (quoteId absent ou nul) : rattachement à faire à la main.",
    };
  }

  const exp = (Array.isArray(exports) ? exports : []).find(
    (e) => e && idProgbat(e.progbat_quote_id) === quote,
  );
  if (!exp) {
    return {
      statut: RESOLUTION.DEVIS_INCONNU,
      resolu: false, chantier_id: null, projet_id: null, quote_id: quote,
      raison: `Le devis ProGBat n° ${quote} n'a pas été exporté depuis Profero : aucun logement ne lui correspond.`,
    };
  }

  // progbat_quote_exports nomme la colonne `project_id` ; la fonction de
  // lecture progbat_devis_exportables() la renomme `projet_id`. On accepte les
  // deux plutôt que d'imposer un remappage à chaque appelant.
  const projetId = cleProjet(exp.projet_id ?? exp.project_id);
  if (!projetId) {
    return {
      statut: RESOLUTION.DEVIS_INCONNU,
      resolu: false, chantier_id: null, projet_id: null, quote_id: quote,
      raison: `Le devis ProGBat n° ${quote} est connu mais n'indique aucun logement.`,
    };
  }

  const lien = (Array.isArray(liaisons) ? liaisons : []).find(
    (l) => l && cleProjet(l.projet_id) === projetId && cleProjet(l.chantier_id),
  );
  if (!lien) {
    return {
      statut: RESOLUTION.PROJET_NON_RATTACHE,
      resolu: false, chantier_id: null, projet_id: projetId, quote_id: quote,
      raison: `Le devis ProGBat n° ${quote} correspond à un logement qui n'est rattaché à aucun chantier : rattachez-le dans « Logements / devis ProGBat » sur la fiche du chantier.`,
    };
  }

  return {
    statut: RESOLUTION.RESOLU,
    resolu: true,
    chantier_id: String(lien.chantier_id),
    projet_id: projetId,
    quote_id: quote,
    raison: `Devis ProGBat n° ${quote} → logement rattaché au chantier.`,
  };
}

// Résolution d'un lot de factures, avec le comptage par issue — pour un écran
// de suivi ou un journal de synchronisation. Ne fait qu'appeler la fonction
// ci-dessus : aucune règle supplémentaire.
export function resoudreLot(factures, contexte = {}) {
  const resultats = (Array.isArray(factures) ? factures : []).map((f) => ({
    bill_id: f?.id ?? null,
    ...resoudreChantierDepuisQuote(f?.quoteId, contexte),
  }));
  const parStatut = {};
  for (const r of resultats) parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;
  return {
    resultats,
    resolus: resultats.filter((r) => r.resolu).length,
    non_resolus: resultats.filter((r) => !r.resolu).length,
    par_statut: parStatut,
  };
}
