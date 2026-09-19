// ─────────────────────────────────────────────────────────────────────────────
// RÉSOLUTION « facture ProGBat → chantier Profero ».
//
// Une facture ProGBat porte DEUX identifiants de rattachement : `yardId` (le
// chantier ProGBat) et `quoteId` (le devis). Ce module fait le chemin jusqu'au
// chantier, et rien d'autre.
//
// CHEMIN PRINCIPAL — le chantier ProGBat, stable :
//
//   yardId
//     → chantier_progbat_yards.progbat_yard_id
//     → chantier_id                              (rattachement posé à la main)
//
// CHEMIN DE REPLI — le devis, seulement quand la facture n'a pas de yardId :
//
//   quoteId
//     → progbat_quote_exports.progbat_quote_id   (quel logement a ce devis)
//     → project_id
//     → chantier_projets.chantier_id             (rattachement posé à la main)
//
// Le devis est un repli et pas une source principale parce qu'il BOUGE : un
// avenant crée un nouveau devis sur le même chantier, et une facture réelle
// porte quoteId = 0 avec un yardId parfaitement valide. Le yard, lui, ne change
// pas. Les deux chemins ne sont jamais mis en concurrence : quand le yard est
// rattaché, c'est lui qui décide, et un désaccord entre les deux chemins est
// une ANOMALIE à trancher à la main, pas un arbitrage à faire ici.
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

// Les issues possibles, toutes explicites : l'appelant doit pouvoir distinguer
// « je ne sais pas encore » de « ce n'est rattaché à rien ».
export const RESOLUTION = {
  RESOLU: "resolu",                         // chantier trouvé
  QUOTE_ABSENT: "quote_absent",             // la facture ne porte pas de quoteId (absent, 0, illisible)
  DEVIS_INCONNU: "devis_inconnu",           // quoteId inconnu de progbat_quote_exports
  PROJET_NON_RATTACHE: "projet_non_rattache", // logement connu, mais rattaché à aucun chantier
  YARD_NON_RATTACHE: "yard_non_rattache",   // la facture porte un yardId, mais ce chantier ProGBat n'est rattaché à rien
  CONFLIT: "conflit",                       // yard et devis désignent DEUX chantiers différents
};

// D'où vient le chantier quand la facture est résolue. L'appelant doit pouvoir
// le montrer : un rattachement obtenu par repli n'a pas la même solidité qu'un
// rattachement par chantier ProGBat.
export const SOURCE = {
  YARD: "yard",                     // chemin principal
  QUOTE_FALLBACK: "quote_fallback", // repli, la facture n'avait pas de yardId exploitable
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


// ── Résolution d'une facture entière (yard d'abord, devis en repli) ─────────
// facture  : { yardId, quoteId } — la facture ProGBat telle qu'elle arrive.
// yards    : lignes de chantier_progbat_yards → { progbat_yard_id, chantier_id }
// exports  : lignes de progbat_devis_exportables() / progbat_quote_exports
// liaisons : lignes de chantier_projets → { projet_id, chantier_id }
//
// C'est LA fonction à appeler. resoudreChantierDepuisQuote reste exportée pour
// le chemin de repli seul, mais elle ignore le yardId : l'utiliser directement
// sur une facture reviendrait à rattacher par le devis, ce qui est exactement
// ce qu'on veut éviter.
//
// Les cinq cas, dans l'ordre où ils sont traités :
//   A. yardId valide ET rattaché                  → résolu, source "yard"
//   B. yardId valide mais NON rattaché            → yard_non_rattache
//   C. yardId absent / 0 / négatif / décimal      → repli devis, source "quote_fallback"
//   D. yard rattaché, devis rattaché, chantiers ≠ → conflit, aucun choix fait
//   E. les deux donnent le même chantier          → résolu par yard (cas A)
//
// Le cas B ne se rabat PAS sur le devis, et c'est le point le plus important
// de cette fonction. Un yardId présent veut dire que ProGBat sait sur quel
// chantier est cette facture ; si Profero ne le sait pas, la réponse est
// « rattachez ce chantier ProGBat », pas « prenons le chantier du devis ».
// Le chantier éventuellement trouvé par le devis est renvoyé comme SUGGESTION,
// pour aider à rattacher — jamais comme résolution.
export function resoudreChantierDepuisFacture(facture, { yards = [], exports = [], liaisons = [] } = {}) {
  const yard = idProgbat(facture?.yardId);
  // Le chemin de repli est toujours calculé : il sert de résolution (cas C),
  // de suggestion (cas B) ou de contradiction à détecter (cas D).
  const parQuote = resoudreChantierDepuisQuote(facture?.quoteId, { exports, liaisons });
  const base = {
    resolu: false, source: null, chantier_id: null,
    yard_id: yard, quote_id: parQuote.quote_id, projet_id: parQuote.projet_id,
    chantier_id_yard: null, chantier_id_quote: parQuote.resolu ? parQuote.chantier_id : null,
    suggestion_chantier_id: null,
  };

  // ── C. Pas de yardId exploitable : repli par le devis ────────────────────
  if (yard === null) {
    return {
      ...base,
      statut: parQuote.statut,
      resolu: parQuote.resolu,
      source: parQuote.resolu ? SOURCE.QUOTE_FALLBACK : null,
      chantier_id: parQuote.chantier_id,
      raison: parQuote.resolu
        ? `Facture sans chantier ProGBat : rattachée par le devis n° ${parQuote.quote_id} (repli).`
        : parQuote.raison,
    };
  }

  const rattachement = (Array.isArray(yards) ? yards : []).find(
    (y) => y && idProgbat(y.progbat_yard_id) === yard && cleProjet(y.chantier_id),
  );

  // ── B. Yard connu de la facture, inconnu de Profero ──────────────────────
  if (!rattachement) {
    return {
      ...base,
      statut: RESOLUTION.YARD_NON_RATTACHE,
      suggestion_chantier_id: parQuote.resolu ? parQuote.chantier_id : null,
      raison: `Le chantier ProGBat n° ${yard} n'est rattaché à aucun chantier Profero : rattachez-le pour que ses factures se résolvent.`,
    };
  }

  const chantierYard = String(rattachement.chantier_id);

  // ── D. Les deux chemins se contredisent ─────────────────────────────────
  if (parQuote.resolu && parQuote.chantier_id !== chantierYard) {
    return {
      ...base,
      statut: RESOLUTION.CONFLIT,
      chantier_id_yard: chantierYard,
      raison: `Contradiction : le chantier ProGBat n° ${yard} est rattaché à « ${chantierYard} », mais le devis n° ${parQuote.quote_id} mène à « ${parQuote.chantier_id} ». À trancher à la main.`,
    };
  }

  // ── A et E. Le yard décide ───────────────────────────────────────────────
  return {
    ...base,
    statut: RESOLUTION.RESOLU,
    resolu: true,
    source: SOURCE.YARD,
    chantier_id: chantierYard,
    chantier_id_yard: chantierYard,
    raison: `Chantier ProGBat n° ${yard} rattaché au chantier.`,
  };
}

// Résolution d'un lot de factures, avec le comptage par issue — pour un écran
// de suivi ou un journal de synchronisation. Ne fait qu'appeler la fonction
// ci-dessus : aucune règle supplémentaire.
export function resoudreLot(factures, contexte = {}) {
  const resultats = (Array.isArray(factures) ? factures : []).map((f) => ({
    bill_id: f?.id ?? null,
    ...resoudreChantierDepuisFacture(f, contexte),
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
