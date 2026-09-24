// ─────────────────────────────────────────────────────────────────────────────
// Résumé e-mail du Bilan Semaine (Chantier 07).
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord,
// aucune écriture, AUCUN ENVOI. Il produit { objet, corps } en texte brut, que
// l'écran met dans le presse-papier. Le front importe la façade
// src/Renovation/bilanSemaineEmailV1.js.
//
// ⚠️ CE MODULE NE CALCULE RIEN — c'est sa raison d'être.
// Il reçoit les objets DÉJÀ AFFICHÉS à l'écran et se contente de les mettre en
// phrases. Aucune arithmétique, aucun Math, aucun reduce : les chiffres du mail
// sont, caractère pour caractère, ceux du PDF et de l'écran, produits par les
// mêmes formateurs (formaterEurosV1 / formaterHeuresV1) et les mêmes libellés
// (libellePointAttentionV1 / libelleSuiviV1). Un chiffre lu dans le mail est le
// même chiffre, expliqué de la même façon, que partout ailleurs.
//
// ⚠️ LA RUBRIQUE « POINTS D'ATTENTION » EST TOUJOURS PRÉSENTE, même vide.
// Un mail où la rubrique manque laisserait croire qu'elle n'a pas été regardée.
// Quand rien n'est détecté, le corps le DIT.
// ─────────────────────────────────────────────────────────────────────────────
import {
  libellePointAttentionV1,
  etatPointsAttentionV1,
  ETAT_RELEVE_ABSENT,
  formaterEurosV1,
  formaterHeuresV1,
} from "./pointsAttentionV1.mjs";
import { libelleSuiviV1 } from "./suiviPointsAttentionV1.mjs";

export const BILAN_SEMAINE_EMAIL_VERSION = "v1";

const listeSure = v => (Array.isArray(v) ? v : []);
const str = v => (v == null ? "" : String(v).trim());
const estRenseigne = v => v != null && v !== "";

// Assemble des morceaux de texte en sautant les vides : une rubrique absente ne
// laisse pas de ligne blanche orpheline.
const lignes = (...morceaux) => morceaux.filter(m => str(m)).join("\n");
const blocs = (...morceaux) => morceaux.filter(m => str(m)).join("\n\n");

const nomDe = (o, repli = "Chantier") => str(o?.nom) || str(o?.chantier_nom) || str(o?.chantier_id) || repli;

/**
 * Résumé e-mail du bilan, en texte brut.
 *
 * @param {object} args
 * @param {object} args.periode                  { weekId, debut?, fin? } — déjà formatés à l'écran
 * @param {object} args.indicateursPortefeuille  { heures?, tachesFaites?, genereEuros?, margeGenereeEuros?, chantiers? }
 * @param {object} args.pointsAttention          sortie de pointsAttentionV1 (ou { lignes: [...] })
 * @param {object} [args.suivi]                  sortie de suiviPointsAttentionV1
 * @param {Array}  [args.blocages]               blocages saisis : [{ chantier_nom, texte }]
 * @param {object} [args.semaineQuiVient]        null si le calcul n'a pas été lancé ; sinon
 *                                               { debut, fin, chantiers: [{ nom, jours[], heures_mo, personnes[] }],
 *                                                 auDelaHorizon: [{ nom, libelle }] }
 * @returns {{ objet: string, corps: string, version: string }}
 */
export function bilanSemaineEmailV1({
  periode, indicateursPortefeuille, pointsAttention, suivi, blocages, semaineQuiVient,
} = {}) {
  const semaine = str(periode?.weekId) || "semaine non précisée";
  const actifs = listeSure(suivi?.actifs).length ? listeSure(suivi.actifs) : listeSure(pointsAttention?.lignes);
  const resolus = listeSure(suivi?.resolus);
  const nbPoints = actifs.length;

  // Les trois états viennent du même service que l'écran et le PDF. On lit le
  // drapeau, on ne le déduit pas de la longueur de la liste : un relevé absent
  // annoncé comme « 0 point d'attention » serait un mensonge par omission
  // envoyé à la hiérarchie.
  const etat = etatPointsAttentionV1(suivi && typeof suivi === "object" && "releveDisponible" in suivi
    ? { ...suivi, lignes: actifs }
    : { ...(pointsAttention && typeof pointsAttention === "object" ? pointsAttention : {}), lignes: actifs });
  const releveAbsent = etat.statut === ETAT_RELEVE_ABSENT;

  // ── Objet : la semaine, et ce qu'on sait vraiment. ────────────────────
  const objet = releveAbsent
    ? `Bilan semaine ${semaine} — relevé hebdomadaire pas encore disponible`
    : nbPoints
      ? `Bilan semaine ${semaine} — ${nbPoints} point${nbPoints > 1 ? "s" : ""} d'attention`
      : `Bilan semaine ${semaine} — aucun point d'attention`;

  // ── En-tête ───────────────────────────────────────────────────────────────
  const periodeTexte = estRenseigne(periode?.debut) && estRenseigne(periode?.fin)
    ? `Bilan de la semaine ${semaine} (du ${str(periode.debut)} au ${str(periode.fin)}).`
    : `Bilan de la semaine ${semaine}.`;

  // ── Indicateurs : uniquement ceux qui ont été affichés. ───────────────────
  const ind = indicateursPortefeuille && typeof indicateursPortefeuille === "object" ? indicateursPortefeuille : {};
  const itemsIndicateurs = [
    estRenseigne(ind.heures) ? `- Heures : ${formaterHeuresV1(ind.heures)}` : "",
    estRenseigne(ind.tachesFaites) ? `- Tâches terminées : ${str(ind.tachesFaites)}` : "",
    estRenseigne(ind.genereEuros) ? `- Valeur générée : ${formaterEurosV1(ind.genereEuros)}` : "",
    estRenseigne(ind.margeGenereeEuros) ? `- Dont marge : ${formaterEurosV1(ind.margeGenereeEuros)}` : "",
    estRenseigne(ind.chantiers) ? `- Chantiers au bilan : ${str(ind.chantiers)}` : "",
  ].filter(Boolean);
  // Aucun indicateur transmis : pas de titre orphelin.
  const blocIndicateurs = itemsIndicateurs.length
    ? lignes("INDICATEURS DE LA SEMAINE", ...itemsIndicateurs)
    : "";

  // ── Points d'attention : rubrique JAMAIS omise. ───────────────────────────
  const listePoints = actifs.map((l, i) => {
    const etiquette = libelleSuiviV1(l);
    return `${i + 1}. ${libellePointAttentionV1(l)}${etiquette ? ` (${etiquette})` : ""}`;
  });
  const ligneResolus = resolus.length
    ? `Résolu depuis la semaine dernière : ${resolus.map(l => nomDe(l)).join(", ")}.`
    : "";
  const blocPoints = releveAbsent
    ? lignes("POINTS D'ATTENTION", etat.message)
    : nbPoints
      ? lignes(
          `POINTS D'ATTENTION (${nbPoints})`,
          "Chantiers qui consomment des heures sans avancer :",
          ...listePoints,
          ligneResolus,
        )
      : lignes(
          "POINTS D'ATTENTION (0)",
          `${etat.message} Aucun chantier ne consomme des heures sans avancer.`,
          ligneResolus,
        );

  // ── Blocages saisis par le conducteur. ────────────────────────────────────
  const listeBlocages = listeSure(blocages)
    .filter(b => b && typeof b === "object" && str(b.texte))
    .map(b => `- ${nomDe(b)} : ${str(b.texte)}`);
  const blocBlocages = listeBlocages.length
    ? lignes(`BLOCAGES SIGNALÉS (${listeBlocages.length})`, ...listeBlocages)
    : "";

  // ── La semaine qui vient : seulement si le calcul a été lancé. ────────────
  const blocSemaine = construireBlocSemaineQuiVient(semaineQuiVient);

  const corps = blocs(
    periodeTexte,
    blocIndicateurs,
    blocPoints,
    blocBlocages,
    blocSemaine,
    "Le PDF détaillé du bilan est joint séparément.",
  );

  return { version: BILAN_SEMAINE_EMAIL_VERSION, objet, corps };
}

// Rubrique « semaine qui vient » : absente tant que le calcul n'a pas été
// lancé — on ne remplit pas un mail avec une prévision qu'on n'a pas faite.
function construireBlocSemaineQuiVient(semaineQuiVient) {
  if (!semaineQuiVient || typeof semaineQuiVient !== "object") return "";
  const chantiers = listeSure(semaineQuiVient.chantiers);
  const auDela = listeSure(semaineQuiVient.auDelaHorizon);
  if (!chantiers.length && !auDela.length) {
    return lignes(
      "LA SEMAINE QUI VIENT",
      "Proposition du moteur de planification, rien n'est appliqué.",
      "Aucune intervention proposée sur cette période.",
    );
  }
  const periode = estRenseigne(semaineQuiVient.debut) && estRenseigne(semaineQuiVient.fin)
    ? `Du ${str(semaineQuiVient.debut)} au ${str(semaineQuiVient.fin)}.`
    : "";
  const listeChantiers = chantiers.map(c => {
    const jours = listeSure(c.jours).map(str).filter(Boolean).join(", ");
    const personnes = listeSure(c.personnes).map(str).filter(Boolean).join(", ");
    return lignes(
      `- ${nomDe(c)} : ${formaterHeuresV1(c.heures_mo)}${jours ? ` — ${jours}` : ""}`,
      personnes ? `  avec ${personnes}` : "",
    );
  });
  const listeAuDela = auDela.length
    ? lignes(
        "Chantiers dont le travail dépasse l'horizon étudié :",
        ...auDela.map(c => `- ${nomDe(c)} : ${str(c.libelle) || "au-delà de l'horizon"}`),
      )
    : "";
  return lignes(
    "LA SEMAINE QUI VIENT",
    "Proposition du moteur de planification, rien n'est appliqué.",
    periode,
    ...listeChantiers,
    listeAuDela,
  );
}
