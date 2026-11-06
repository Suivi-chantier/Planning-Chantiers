// ─────────────────────────────────────────────────────────────────────────────
// statutsChantier — statuts commerciaux du chantier et statut CALCULÉ de
// l'opération (Refonte Opérations, lot 2 : docs/projets/refonte-operations.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// dates et auteurs arrivent en paramètre. Façade front : statutsChantier.js.
//
// Contenu :
//   - STATUTS_AFFICHAGE : libellé + couleurs de CHAQUE statut, une seule fois
//     (pages Chantiers et Opérations, export d'opération).
//   - decisionBasculeSignature() : quand l'étape de signature est validée, un
//     chantier « À l'étude » passe en « Planifié ». ETAPE_SIGNATURE dit quelle
//     étape du cycle de vie porte la signature : aujourd'hui "devis_signe"
//     (cycleVie.mjs). Le lot 3 (nouveau cycle) n'a qu'à changer cette constante
//     si l'identifiant de l'étape change.
//   - « Marquer perdu » / « Annuler perdu » : validation du motif, champs à
//     écrire, entrée de journal. Un chantier perdu ne doit recevoir AUCUNE
//     relance (lot 3) : estChantierPerdu() est la seule question à poser.
//   - statutOperation() : statut de l'opération, déduit de ses chantiers,
//     jamais stocké.
// ─────────────────────────────────────────────────────────────────────────────
import {
  STATUT_A_L_ETUDE, STATUT_PERDU, STATUTS_CHANTIER,
  statutDuChantier, estChantierArchive, estChantierTermine,
} from "./chantierActif.mjs";

export { STATUT_A_L_ETUDE, STATUT_PERDU };

/** Libellés et couleurs : la seule table d'affichage des statuts. */
export const STATUTS_AFFICHAGE = Object.freeze({
  a_l_etude: Object.freeze({ label: "À l'étude", color: "#a78bfa", bg: "rgba(167,139,250,0.15)" }),
  planifie:  Object.freeze({ label: "Planifié",  color: "#3b82f6", bg: "rgba(59,130,246,0.15)" }),
  en_cours:  Object.freeze({ label: "En cours",  color: "#FFC300", bg: "rgba(255,195,0,0.15)" }),
  en_pause:  Object.freeze({ label: "En pause",  color: "#f97316", bg: "rgba(249,115,22,0.15)" }),
  termine:   Object.freeze({ label: "Terminé",   color: "#22c55e", bg: "rgba(34,197,94,0.15)" }),
  perdu:     Object.freeze({ label: "Perdu",     color: "#94a3b8", bg: "rgba(148,163,184,0.18)" }),
});

/**
 * Statuts proposés dans le menu « changer le statut » : tous sauf « Perdu »,
 * qui ne s'obtient QUE par le bouton « Marquer perdu » (motif obligatoire).
 */
export const STATUTS_CHOIX_MANUEL = Object.freeze(STATUTS_CHANTIER.filter((s) => s !== STATUT_PERDU));

/** Statut affichable d'un chantier : null/vide → « planifie » (règle historique). */
export function statutAffiche(chantier) {
  return statutDuChantier(chantier) || "planifie";
}

export function estChantierAEtude(chantier) {
  return statutDuChantier(chantier) === STATUT_A_L_ETUDE;
}

/** LA question des relances (lot 3) : un chantier perdu n'en reçoit aucune. */
export function estChantierPerdu(chantier) {
  return statutDuChantier(chantier) === STATUT_PERDU;
}

// ─── Bascule automatique à la signature ─────────────────────────────────────
/** Étape du cycle de vie qui porte la signature du devis (cycleVie.mjs). */
export const ETAPE_SIGNATURE = "devis_signe";

/**
 * Faut-il basculer ce chantier en « Planifié » ?
 *   chantier     : { statut }
 *   etatsEtapes  : meta.cycle_vie_etapes (id d'étape → { fait, date, … })
 * Bascule seulement si le chantier est « À l'étude » ET l'étape de signature
 * est validée. Jamais dans l'autre sens : dé-valider la signature ne remet pas
 * le chantier à l'étude (décision prudente : un chantier planifié a peut-être
 * déjà des équipes ; on corrige alors le statut à la main).
 * → { basculer: bool, nouveauStatut?: "planifie", raison }
 */
export function decisionBasculeSignature(chantier, etatsEtapes, { etapeSignature = ETAPE_SIGNATURE } = {}) {
  if (!chantier || typeof chantier !== "object") return { basculer: false, raison: "Chantier inconnu" };
  if (!estChantierAEtude(chantier)) return { basculer: false, raison: "Le chantier n'est pas « À l'étude »" };
  const etat = etatsEtapes && typeof etatsEtapes === "object" ? etatsEtapes[etapeSignature] : null;
  if (!etat || etat.fait !== true) return { basculer: false, raison: "Étape « Devis signé » non validée" };
  return { basculer: true, nouveauStatut: "planifie", raison: "Devis signé : le chantier passe en Planifié" };
}

// ─── Marquer perdu / annuler ────────────────────────────────────────────────
export const MOTIFS_PERTE = Object.freeze([
  Object.freeze({ id: "prix", label: "Prix trop élevé" }),
  Object.freeze({ id: "concurrent", label: "Choix d'un concurrent" }),
  Object.freeze({ id: "projet_abandonne", label: "Projet abandonné par le client" }),
  Object.freeze({ id: "delai", label: "Délai ne convenant pas" }),
  Object.freeze({ id: "financement", label: "Financement refusé" }),
  Object.freeze({ id: "sans_reponse", label: "Client sans réponse" }),
  Object.freeze({ id: "autre", label: "Autre (préciser)" }),
]);

export const libelleMotifPerte = (id) => MOTIFS_PERTE.find((m) => m.id === id)?.label || (id ? String(id) : "");

const txt = (v) => (v == null ? "" : String(v).trim());

/** Peut-on marquer ce chantier perdu ? (seulement « À l'étude », non archivé) */
export function peutMarquerPerdu(chantier) {
  if (!chantier || estChantierArchive(chantier)) return { ok: false, raison: "Chantier archivé ou inconnu" };
  if (!estChantierAEtude(chantier)) return { ok: false, raison: "Seul un chantier « À l'étude » peut être marqué perdu" };
  return { ok: true };
}

/**
 * Motif obligatoire : un choix de la liste ; texte libre obligatoire pour
 * « Autre », facultatif sinon. → { ok, erreurs: [message] }
 */
export function validerMotifPerte({ motif, detail } = {}) {
  const erreurs = [];
  if (!MOTIFS_PERTE.some((m) => m.id === motif)) erreurs.push("Choisir le motif de la perte");
  if (motif === "autre" && !txt(detail)) erreurs.push("Préciser le motif (texte libre)");
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Champs du chantier à écrire pour le marquer perdu + entrée de journal.
 * `le` (ISO) et `auteur` arrivent de l'appelant (aucune horloge ici).
 */
export function preparerPerte(chantier, { motif, detail, auteur, le }) {
  const p = peutMarquerPerdu(chantier);
  if (!p.ok) return { ok: false, erreurs: [p.raison] };
  const v = validerMotifPerte({ motif, detail });
  if (!v.ok) return { ok: false, erreurs: v.erreurs };
  if (!txt(le)) return { ok: false, erreurs: ["Date de la perte inconnue"] };
  return {
    ok: true,
    champs: {
      statut: STATUT_PERDU,
      perdu_le: le, perdu_par: txt(auteur) || null,
      perdu_motif: motif, perdu_motif_detail: txt(detail) || null,
    },
    journal: {
      chantier_id: chantier.id, evenement: "marque_perdu",
      ancien_statut: statutDuChantier(chantier), nouveau_statut: STATUT_PERDU,
      motif, detail: txt(detail) || null, auteur: txt(auteur) || null,
    },
  };
}

/**
 * Annuler « perdu » : le chantier revient « À l'étude » (seul statut d'où l'on
 * peut être perdu). Les champs de perte sont vidés sur le chantier ; la trace
 * (motif d'origine + raison de l'annulation) reste dans le journal.
 */
export function preparerAnnulationPerte(chantier, { raison, auteur }) {
  if (!chantier || !estChantierPerdu(chantier)) return { ok: false, erreurs: ["Ce chantier n'est pas marqué perdu"] };
  if (!txt(raison)) return { ok: false, erreurs: ["Indiquer pourquoi la perte est annulée"] };
  return {
    ok: true,
    champs: { statut: STATUT_A_L_ETUDE, perdu_le: null, perdu_par: null, perdu_motif: null, perdu_motif_detail: null },
    journal: {
      chantier_id: chantier.id, evenement: "perte_annulee",
      ancien_statut: STATUT_PERDU, nouveau_statut: STATUT_A_L_ETUDE,
      motif: chantier.perdu_motif || null,
      detail: `Annulation : ${txt(raison)}${chantier.perdu_motif_detail ? ` (motif d'origine : ${chantier.perdu_motif_detail})` : ""}`,
      auteur: txt(auteur) || null,
    },
  };
}

// ─── Statut de l'opération (calculé, jamais stocké) ─────────────────────────
export const STATUTS_OPERATION = Object.freeze({
  a_l_etude: Object.freeze({ label: "À l'étude", color: STATUTS_AFFICHAGE.a_l_etude.color, bg: STATUTS_AFFICHAGE.a_l_etude.bg }),
  en_cours:  Object.freeze({ label: "En cours",  color: STATUTS_AFFICHAGE.en_cours.color,  bg: STATUTS_AFFICHAGE.en_cours.bg }),
  terminee:  Object.freeze({ label: "Terminée",  color: STATUTS_AFFICHAGE.termine.color,   bg: STATUTS_AFFICHAGE.termine.bg }),
  perdue:    Object.freeze({ label: "Perdue",    color: STATUTS_AFFICHAGE.perdu.color,     bg: STATUTS_AFFICHAGE.perdu.bg }),
  vide:      Object.freeze({ label: "Sans chantier", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" }),
});

/**
 * Statut d'une opération à partir de SES chantiers (non archivés).
 * Tableau du cahier des charges, puis cas mixtes (décisions prudentes, voir
 * le journal du compte rendu) :
 *   1. au moins un chantier actif (planifié, en cours, en pause, ou sans
 *      statut)                                 → en_cours
 *   2. sinon, au moins un « À l'étude »        → a_l_etude
 *      (à l'étude + perdus : une affaire reste à signer)
 *   3. sinon, au moins un « Terminé »          → terminee
 *      (terminés + perdus : ce qui a été signé est fini ; les perdus ne
 *       relancent rien)
 *   4. sinon, tous perdus                       → perdue
 *   5. aucun chantier                           → vide (« Sans chantier ») :
 *      jamais présenté comme « Terminée » ni « À l'étude ».
 * → { statut, label, color, bg, raison, compte: { a_l_etude, actif, termine, perdu } }
 */
export function statutOperation(chantiersOperation) {
  const compte = { a_l_etude: 0, actif: 0, termine: 0, perdu: 0 };
  (Array.isArray(chantiersOperation) ? chantiersOperation : []).forEach((c) => {
    if (!c || typeof c !== "object" || estChantierArchive(c)) return;
    const s = statutDuChantier(c);
    if (s === STATUT_A_L_ETUDE) compte.a_l_etude++;
    else if (s === STATUT_PERDU) compte.perdu++;
    else if (estChantierTermine(c)) compte.termine++;
    else compte.actif++;
  });
  const total = compte.a_l_etude + compte.actif + compte.termine + compte.perdu;
  let statut; let raison;
  if (total === 0) { statut = "vide"; raison = "Aucun chantier dans cette opération"; }
  else if (compte.actif > 0) { statut = "en_cours"; raison = `${compte.actif} chantier${compte.actif > 1 ? "s" : ""} en exploitation`; }
  else if (compte.a_l_etude > 0) { statut = "a_l_etude"; raison = `${compte.a_l_etude} chantier${compte.a_l_etude > 1 ? "s" : ""} à l'étude${compte.perdu ? `, ${compte.perdu} perdu${compte.perdu > 1 ? "s" : ""}` : ""}`; }
  else if (compte.termine > 0) { statut = "terminee"; raison = `${compte.termine} chantier${compte.termine > 1 ? "s" : ""} terminé${compte.termine > 1 ? "s" : ""}${compte.perdu ? `, ${compte.perdu} perdu${compte.perdu > 1 ? "s" : ""}` : ""}`; }
  else { statut = "perdue"; raison = "Tous les chantiers sont perdus"; }
  return { statut, ...STATUTS_OPERATION[statut], raison, compte };
}

// ─── Client et chargé d'affaires effectifs (défaut = opération) ─────────────
/**
 * Valeur effective d'un champ « hérité de l'opération » : celle du chantier
 * si elle est renseignée, sinon celle de l'opération.
 * → { valeur, source: "chantier" | "operation" | null }
 */
export function valeurHeritee(chantier, operation, champ) {
  const vc = chantier ? chantier[champ] : null;
  if (vc != null && txt(vc) !== "") return { valeur: vc, source: "chantier" };
  const vo = operation ? operation[champ] : null;
  if (vo != null && txt(vo) !== "") return { valeur: vo, source: "operation" };
  return { valeur: null, source: null };
}

export function clientEffectif(chantier, operation) {
  return valeurHeritee(chantier, operation, "client_id");
}

/** { id, nom, source } — nom = nom affiché enregistré avec le choix. */
export function chargeAffairesEffectif(chantier, operation) {
  const r = valeurHeritee(chantier, operation, "charge_affaires_id");
  if (!r.valeur) return { id: null, nom: null, source: null };
  const porteur = r.source === "chantier" ? chantier : operation;
  return { id: r.valeur, nom: porteur?.charge_affaires_nom || null, source: r.source };
}
