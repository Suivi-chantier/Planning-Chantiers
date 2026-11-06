// ─────────────────────────────────────────────────────────────────────────────
// HTML du Bilan exporté (PDF / e-mail) — refonte du Bilan, étape 3.
//
// Deux versions :
//   - DIRECTION (par défaut, 1 à 2 pages) : bandeau, synthèse par chantier avec
//     pastille et légende, mentions, chantiers sans activité, journées
//     incomplètes ; page 2 : alertes, décisions attendues, tendances par lot.
//     Demande de Loris du 06/11/2026 : la version direction s'arrête là (plus
//     de semaine qui vient, prévu / réalisé, fin prévisionnelle ni
//     rectifications, qui restent dans la version détaillée). Seul l'affichage
//     est retiré : les données archivées ne changent pas.
//   - DÉTAILLÉE : la version direction, dont le tableau des chantiers est
//     remplacé par la synthèse « où va chaque chantier » (06/11/2026), + le
//     détail des marges + une fiche par chantier (cascade « du devis au
//     probable » seulement pour les chantiers qui décrochent) + l'annexe
//     « Méthode de calcul », seulement si le conducteur l'a demandée
//     (d.methode, case « Joindre la méthode de calcul », 06/11/2026).
//
// RÈGLE : les commentaires bruts des ouvriers (et toute appréciation d'un
// ouvrier sur un autre) n'apparaissent JAMAIS dans la version direction. La
// fonction de la version direction ne reçoit d'ailleurs aucun champ de
// commentaire. Dans la version détaillée, seuls les commentaires COCHÉS par le
// conducteur sont passés (fiche.commentaires).
//
// Module PUR : il reçoit des données déjà calculées (bilanPeriodeV3, alertes
// des marges, fiches) et renvoie une chaîne HTML.
// ─────────────────────────────────────────────────────────────────────────────
import {
  LEGENDE_PASTILLES_V3, COULEURS_PASTILLES_V3, fmtJourV3, alertesBilanV3, alerteVersionDetailleeSeulementV3,
  resumeJourneesIncompletesV3, resumeNonValidesV3, libelleCourtFiabiliteV3, nbChantiersV3,
} from "./bilanPeriodeV3.mjs";
import { normaliserSeuilsMarges } from "../chantierFinance.mjs";
import { MOTIF_LOT_EN_DERIVE, MOTIF_MARGE_PROBABLE_EN_BAISSE, MOTIF_HEURES_SANS_LOT } from "./pointsAttentionV1.mjs";
import {
  OR, ENCRE, TEXTE_SECONDAIRE, BORDURE, FOND_DOUX, JAUNE_PALE, FOND_HERO, HALO_OR, HALO_BLEU, FILET_TITRE,
  POLICE_TEXTE, POLICE_TITRE, PIED_GAUCHE,
} from "./charteDocProfero.mjs";

const listeSure = v => (Array.isArray(v) ? v : []);
export const echapperHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const e = echapperHtml;

const nbsp = " ";
const fmtEur = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")}${nbsp}€`);
const fmtEurSigne = v => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")}${nbsp}€`);
const fmtH = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")}${nbsp}h`);
const fmtPct = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")}${nbsp}%`);
// Couleurs des montants (information, hors charte) : rouge négatif, vert positif ;
// encre pour zéro, gris secondaire pour un montant inconnu.
const couleurSigne = v => (v == null ? TEXTE_SECONDAIRE : v < -0.5 ? "#c0392b" : v > 0.5 ? "#15803d" : ENCRE);

// Habillage : charte des documents Profero (skill « profero-pdf », demande de
// Loris du 06/11/2026) — héros bleu nuit à halos avec logo, rangée de chiffres
// clés, titres de section en majuscules soulignés d'un filet jaune, tableaux à
// en-tête bleu nuit, ligne de total sur fond jaune pâle, fiches en cartes
// arrondies, pied « Profero — Rénovation & réhabilitation / Document interne ».
// Couleurs et décor lus dans charteDocProfero.mjs (une seule source avec les
// autres documents). Seules couleurs hors charte, porteuses d'information :
// pastilles d'état des chantiers (COULEURS_PASTILLES_V3), montants positifs /
// négatifs (couleurSigne), fiabilité, pastilles « mention » (ambre) et
// avertissements (rouge).
// Le document est rendu par html2pdf (html2canvas) dans un conteneur de 794 px :
// tailles en px, aucune ombre, dégradés en couleurs pleines.
// Les classes .kpi, .fiche h2, tr et li servent à la pagination
// (pagebreak.avoid dans BilanPeriode.jsx) : à garder.
// Barlow n'a pas d'espace fine insécable (U+202F, le séparateur des milliers
// de toLocaleString « fr-FR ») : le navigateur la réduit alors à un filet
// (« 21068 € » au lieu de « 21 068 € »). Une police de repli limitée à ce seul
// caractère invisible (unicode-range) la reprend d'Arial, comme avant la
// charte ; tout le texte visible reste en Barlow.
const ESPACE_FINE = "Espace fine Profero";
const TEXTE_BILAN = `'${ESPACE_FINE}',${POLICE_TEXTE}`;
const TITRE_BILAN = `'${ESPACE_FINE}',${POLICE_TITRE}`;
const STYLE = `
  @font-face { font-family: '${ESPACE_FINE}'; src: local('Arial'), local('ArialMT'), local('Liberation Sans'), local('Helvetica'); unicode-range: U+202F; }
  .bilan-v3 { font-family: ${TEXTE_BILAN}; color: ${ENCRE}; font-size: 10.5px; line-height: 1.35; background: #fff; }
  .bilan-v3 * { box-sizing: border-box; }

  .bilan-v3 .hero { position: relative; overflow: hidden; border-radius: 16px; background: ${FOND_HERO}; padding: 18px 22px 18px; color: #fff; margin-bottom: 10px; }
  .bilan-v3 .hero .halo { position: absolute; border-radius: 50%; }
  .bilan-v3 .hero .halo-or { right: -60px; top: -75px; width: 235px; height: 235px; background: ${HALO_OR}; }
  .bilan-v3 .hero .halo-bleu { left: -45px; bottom: -100px; width: 215px; height: 215px; background: ${HALO_BLEU}; }
  .bilan-v3 .hero .logo { position: relative; display: block; height: 30px; margin-bottom: 14px; }
  .bilan-v3 .hero .corps { position: relative; display: flex; align-items: flex-end; gap: 18px; }
  .bilan-v3 .hero .txt { flex: 1; min-width: 0; }
  .bilan-v3 .hero .eb { font-size: 9.5px; letter-spacing: .24em; font-weight: 700; color: ${OR}; text-transform: uppercase; }
  .bilan-v3 .hero h1 { font-family: ${TITRE_BILAN}; font-weight: 800; font-size: 32px; line-height: 1.02; margin: 5px 0 4px; text-transform: uppercase; color: #fff; }
  .bilan-v3 .hero .sous-titre { color: #aeb6c8; font-size: 11px; }
  .bilan-v3 .hero .pills { margin-top: 11px; display: flex; flex-wrap: wrap; gap: 7px; }
  .bilan-v3 .hero .pill { border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); border-radius: 999px; padding: 4px 11px; font-size: 9.5px; font-weight: 600; color: #e8ebf2; white-space: nowrap; }
  .bilan-v3 .hero-kpi { flex: none; min-width: 150px; background: ${OR}; color: ${ENCRE}; border-radius: 12px; padding: 10px 16px 11px; text-align: center; }
  .bilan-v3 .hero-kpi .l { font-size: 8px; letter-spacing: .2em; font-weight: 700; color: #6b5200; text-transform: uppercase; }
  .bilan-v3 .hero-kpi .v { font-family: ${TITRE_BILAN}; font-weight: 800; font-size: 27px; line-height: 1.05; margin-top: 2px; white-space: nowrap; }

  .bilan-v3 .bandeau { display: flex; gap: 8px; margin: 10px 0 4px; }
  .bilan-v3 .kpi { flex: 1; min-width: 0; border: 1px solid ${BORDURE}; border-radius: 12px; padding: 8px 12px 9px; background: #fff; }
  .bilan-v3 .kpi.large { flex: 1.7; }
  .bilan-v3 .kpi .l { font-size: 8.5px; letter-spacing: .12em; color: ${TEXTE_SECONDAIRE}; font-weight: 700; text-transform: uppercase; }
  .bilan-v3 .kpi .v { font-family: ${TITRE_BILAN}; font-weight: 800; font-size: 22px; line-height: 1.1; margin-top: 2px; }
  .bilan-v3 .kpi .s { font-size: 9.5px; color: ${TEXTE_SECONDAIRE}; margin-top: 1px; }

  .bilan-v3 .sh { display: flex; align-items: center; gap: 12px; margin: 16px 0 7px; }
  .bilan-v3 .sh h2 { margin: 0; font-family: ${TITRE_BILAN}; font-weight: 800; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; color: ${ENCRE}; }
  .bilan-v3 .sh .ln { flex: 1; height: 2px; border-radius: 2px; background: ${FILET_TITRE}; }
  .bilan-v3 h3 { margin: 10px 0 4px; font-size: 9.5px; letter-spacing: .12em; color: ${TEXTE_SECONDAIRE}; text-transform: uppercase; font-weight: 700; }

  .bilan-v3 table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid ${BORDURE}; border-radius: 12px; overflow: hidden; margin: 4px 0 2px; }
  .bilan-v3 thead tr { background: ${ENCRE}; }
  .bilan-v3 th { text-align: left; background: ${ENCRE}; color: #fff; font-weight: 700; font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; padding: 6px 6px; vertical-align: bottom; line-height: 1.2; }
  .bilan-v3 td { padding: 4px 6px; border-top: 1px solid ${FOND_DOUX}; vertical-align: top; }
  .bilan-v3 tbody tr:first-child td { border-top: none; }
  .bilan-v3 tbody tr:nth-child(even) td { background: #fafbfd; }
  .bilan-v3 td.n, .bilan-v3 th.n { text-align: right; }
  .bilan-v3 td.n { white-space: nowrap; }
  .bilan-v3 tr.total td { font-weight: 700; background: ${JAUNE_PALE}; border-top: 1.5px solid ${OR}; }
  .bilan-v3 tbody tr.total:first-child td { border-top: none; border-bottom: 1.5px solid ${OR}; }
  .bilan-v3 tr.sans-lot td { background: #fef3c7; }

  .bilan-v3 .pastille { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; position: relative; top: -1px; }
  .bilan-v3 .mention { display: inline-block; font-size: 8.5px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; margin-left: 4px; }
  .bilan-v3 .note { color: ${TEXTE_SECONDAIRE}; font-size: 9.5px; margin: 5px 0; }
  .bilan-v3 .avert { border: 1px solid ${BORDURE}; border-left: 3px solid #991b1b; background: #fee2e2; color: #991b1b; padding: 6px 12px; border-radius: 9px; margin: 8px 0; font-size: 10px; }
  .bilan-v3 p { margin: 5px 0; }
  .bilan-v3 ul { list-style: none; margin: 3px 0; padding: 0; }
  .bilan-v3 li { position: relative; margin: 1px 0; padding: 2px 0 2px 15px; }
  .bilan-v3 li:before { content: ""; position: absolute; left: 2px; top: 8px; width: 6px; height: 6px; border-radius: 50%; background: ${OR}; }
  .bilan-v3 .saut { page-break-before: always; break-before: page; }
  .bilan-v3 .fiche { page-break-inside: avoid; break-inside: avoid; padding: 6px 0 10px; }
  .bilan-v3 .fiche .tete { page-break-inside: avoid; break-inside: avoid; padding-top: 6px; margin-bottom: 6px; }
  .bilan-v3 .fiche .carte { border: 1px solid ${BORDURE}; border-radius: 14px; padding: 10px 16px 8px; background: #fff; }
  .bilan-v3 .fiche h2 { margin: 0 0 6px; padding-bottom: 6px; border-bottom: 1px solid ${FOND_DOUX}; font-family: ${TITRE_BILAN}; font-weight: 800; font-size: 17px; letter-spacing: .06em; text-transform: uppercase; color: ${ENCRE}; }
  .bilan-v3 .photos img { height: 110px; margin-right: 6px; border-radius: 8px; border: 1px solid ${BORDURE}; }
  .bilan-v3 .gris { color: ${TEXTE_SECONDAIRE}; }
  .bilan-v3 table.synthese-direction td { font-size: 10px; padding: 4px 4px; }
  .bilan-v3 table.synthese-direction th { padding: 6px 4px; }

  .bilan-v3 .pied { margin-top: 14px; padding-top: 7px; border-top: 1px solid ${BORDURE}; display: flex; justify-content: space-between; font-size: 8.5px; color: #9aa2b4; }
  .bilan-v3 .pied b { letter-spacing: .16em; font-weight: 700; text-transform: uppercase; }
`;
// Styles du seul tableau de synthèse détaillé (tâche 5, 06/11/2026) : ajoutés
// à la version détaillée uniquement.
const STYLE_DETAILLEE = `
  .bilan-v3 table.synthese-detaillee { table-layout: fixed; }
  .bilan-v3 table.synthese-detaillee .retour { white-space: normal; }
  .bilan-v3 table.synthese-detaillee th { padding: 6px 4px; letter-spacing: .02em; font-size: 8px; }
  .bilan-v3 .tendance { font-size: 9px; letter-spacing: .5px; white-space: nowrap; }
  .bilan-v3 .petit { font-size: 8.5px; font-weight: normal; line-height: 1.25; }
`;

// Titre de section au style de la charte (le <h2> garde son texte seul).
const section = t => `<div class="sh"><h2>${e(t)}</h2><span class="ln"></span></div>`;

// Pourcentage affiché : « — » si inconnu (vendu nul, production nulle…).
const fmtPctSur = v => {
  if (v == null) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR")}${nbsp}%`;
};
const fmtEurH = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")}${nbsp}€/h`);
const fleche = v => (v == null || Math.abs(v) < 1 ? "=" : v < 0 ? "▼" : "▲");

// Bandeau (choix de Loris du 26/10/2026) : des chiffres avec leurs repères.
// Rangée de chiffres clés de la charte, juste sous le héros ; la case de la
// marge probable, qui porte le plus de repères, est plus large.
function bandeauHtml(b) {
  const kpi = (l, v, c, sous = [], large = false) => `<div class="kpi${large ? " large" : ""}"><div class="l">${e(l)}</div><div class="v" style="color:${c || ENCRE}">${e(v)}</div>${
    sous.filter(Boolean).map(x => `<div class="s">${e(x)}</div>`).join("")}</div>`;
  const evo = b.evolutionMargeProbable;
  return `<div class="bandeau">
    ${kpi("Production de la période", fmtEur(b.production))}
    ${kpi("Marge de la période", fmtEurSigne(b.margePeriode), couleurSigne(b.margePeriode),
      [b.margePeriodePct == null ? "— de la production" : `${fmtPctSur(b.margePeriodePct)} de la production`])}
    ${kpi(b.nbChantiersHorsComparaison > 0 ? `Marge probable (${nbChantiersV3(b.nbChantiersComparables)})` : "Marge probable, tous chantiers",
      fmtEurSigne(b.margeProbableTotale), couleurSigne(b.margeProbableTotale), [
      `${fmtPctSur(b.margeProbableTotalePct)} du vendu · devis ${fmtEurSigne(b.margeDevisTotale)} (${fmtPctSur(b.margeDevisTotalePct)})`,
      // Même ensemble de chantiers que la marge probable totale (bandeauV3).
      `à terminaison ${fmtEurSigne(b.margeTerminaisonTotale)} (${fmtPctSur(b.margeTerminaisonTotalePct)})`,
      evo == null ? "évolution sur la période : —" : `${fleche(evo)} ${fmtEurSigne(evo)} sur la période, tous chantiers`,
      b.nbChantiersHorsComparaison > 0 ? `${b.nbChantiersHorsComparaison} chantier${b.nbChantiersHorsComparaison > 1 ? "s" : ""} hors total (marge devis inconnue ou sans matériaux prévus)` : null], true)}
    ${kpi("Heures validées", fmtH(b.heuresValidees), null, [`${fmtEurH(b.eurParHeure)} produits · devis ${fmtEurH(b.eurParHeureDevis)}`])}
  </div>`;
}

const mentionsHtml = s => listeSure(s.mentions).map(m => `<span class="mention">${e(m.texte)}${m.heuresApresReception > 0 ? ` · ${e(fmtH(m.heuresApresReception))} après réception` : ""}</span>`).join("");
const celluleMarge = (montant, pct) => `<td class="n" style="color:${couleurSigne(montant)}">${e(fmtEurSigne(montant))}<div class="gris">${e(fmtPctSur(pct))}</div></td>`;

// Tableau des chantiers, version direction : « Devis → probable ». La marge à
// terminaison (06/11/2026) se lit juste avant la marge probable ; 9 colonnes :
// police du tableau légèrement réduite (classe synthese-direction).
function syntheseHtml(synthese) {
  const lignes = listeSure(synthese).map(s => {
    const coul = COULEURS_PASTILLES_V3[s.pastille?.couleur] || COULEURS_PASTILLES_V3.gris;
    const tete = `<td><span class="pastille" style="background:${coul}"></span>${e(s.nom)}${mentionsHtml(s)}</td>`;
    if (!s.disponible) return `<tr>${tete}<td colspan="8" class="gris">relevé pas encore disponible</td></tr>`;
    const evo = s.evolutionMargeProbable;
    return `<tr>${tete}
      <td class="n">${e(fmtPct(s.avancement))}</td>
      <td class="n">${e(fmtEur(s.vendu))}</td>
      ${s.margeDevisSansMateriaux
        ? `<td class="n" style="color:${couleurSigne(s.margeDevis)}">${e(fmtEurSigne(s.margeDevis))}<div class="gris">sans matériaux prévus</div></td>`
        : celluleMarge(s.margeDevis, s.margeDevisPct)}
      ${celluleMarge(s.margeTerminaison, s.margeTerminaisonPct)}
      ${celluleMarge(s.margeProbable, s.margeProbablePct)}
      <td class="n" style="color:${couleurSigne(s.ecartDevis)}">${e(fmtEurSigne(s.ecartDevis))}</td>
      <td class="n" style="color:${couleurSigne(evo)}">${evo == null ? "—" : `${fleche(evo)} ${e(fmtEurSigne(evo))}`}</td>
      <td class="n">${e(fmtEurH(s.eurParHeure))}<div class="gris">devis ${e(fmtEurH(s.eurParHeureDevis))}</div></td>
    </tr>`;
  }).join("");
  return `<table class="synthese-direction">
    <thead><tr><th>Chantier</th><th class="n">Avancement</th><th class="n">Vendu HT</th><th class="n">Marge devis</th>
      <th class="n">Marge à terminaison</th><th class="n">Marge probable</th><th class="n">Écart / devis</th><th class="n">Sur la période</th><th class="n">€ produits / h</th></tr></thead>
    <tbody>${lignes}</tbody></table>
    <p class="note">Marge devis : ce que le devis laissait espérer. Marge à terminaison : où le chantier finit si le reste se passe comme le devis. Marge probable : où le chantier va finir si les lots continuent au rythme constaté.
      « Sur la période » : évolution de la marge probable. Pourcentages : part du vendu HT.</p>`;
}

// Version DÉTAILLÉE (projet « Bilan détaillé », 06/11/2026) : le tableau
// répond d'abord à 3 questions — combien on a généré, combien on a gagné en
// marge sur la période, où va chaque chantier. Ligne TOTAL en tête, reprise du
// bandeau (mêmes chiffres, même calcul). Fourchette, fiabilité et tendance
// sont calculées dans syntheseChantiersV3 (ouVaLeChantierV3) : ici, rien que
// de l'affichage.
const NIVEAUX_FIABILITE = { bonne: "bonne", moyenne: "moyenne", faible: "faible" };
const COULEURS_FIABILITE = { bonne: "#15803d", moyenne: "#b45309", faible: "#c0392b" };
function syntheseDetailleeHtml(synthese, bandeau, periode) {
  const b = bandeau || {};
  const semaine = periode?.type === "semaine";
  // Mention « N chantiers, comme le bandeau » seulement quand le total ne
  // porte pas sur tous les chantiers du tableau (sur une 2e ligne, en petit).
  const nbAffiches = listeSure(synthese).length;
  const nbComparables = b.nbChantiersComparables ?? 0;
  const mentionTotal = b.nbChantiersHorsComparaison > 0 && nbComparables !== nbAffiches ? `${nbChantiersV3(nbComparables)}, comme le bandeau` : null;
  const total = `<tr class="total">
      <td>TOTAL</td>
      <td></td>
      <td class="n">${e(fmtEur(b.production))}</td>
      ${celluleMarge(b.margePeriode, b.margePeriodePct)}
      ${celluleMarge(b.margeTerminaisonTotale, b.margeTerminaisonTotalePct)}
      <td class="n" style="color:${couleurSigne(b.margeProbableTotale)}">${e(fmtEurSigne(b.margeProbableTotale))}<div class="gris">${e(fmtPctSur(b.margeProbableTotalePct))}</div>${
        mentionTotal ? `<div class="gris petit retour">${e(mentionTotal)}</div>` : ""}</td>
      <td></td><td></td><td></td>
    </tr>`;
  const lignes = listeSure(synthese).map(s => {
    const coul = COULEURS_PASTILLES_V3[s.pastille?.couleur] || COULEURS_PASTILLES_V3.gris;
    const tete = `<td><span class="pastille" style="background:${coul}"></span>${e(s.nom)}${mentionsHtml(s)}</td>`;
    if (!s.disponible) return `<tr>${tete}<td colspan="8" class="gris">relevé pas encore disponible</td></tr>`;
    const fia = s.fiabilite || {};
    const niveau = NIVEAUX_FIABILITE[fia.niveau];
    const t = s.tendance || {};
    const evo = t.evolution ?? null;
    return `<tr>${tete}
      <td class="n">${e(fmtPct(s.avancement))}</td>
      <td class="n">${e(fmtEur(s.production))}</td>
      ${celluleMarge(s.margePeriode, s.margePeriodePct)}
      ${celluleMarge(s.margeTerminaison, s.margeTerminaisonPct)}
      ${celluleMarge(s.margeProbable, s.margeProbablePct)}
      <td class="n retour">${e(s.fourchette?.texte || "—")}</td>
      <td><span style="color:${niveau ? COULEURS_FIABILITE[fia.niveau] : TEXTE_SECONDAIRE}">${e(niveau || "inconnue")}</span>${s.fiabilite ? `<div class="gris petit">${e(libelleCourtFiabiliteV3(fia, s.avancement))}</div>` : ""}</td>
      <td class="n"><span class="tendance">${e(t.texteAffiche || "—")}</span><div style="color:${couleurSigne(evo)}">${e(fmtEurSigne(evo))}</div></td>
    </tr>`;
  }).join("");
  // Largeurs fixes (190 mm utiles) : le nom du chantier garde sa ligne.
  // 9 colonnes depuis la marge à terminaison (06/11/2026).
  const largeurs = [21, 8, 9, 9, 10, 10, 12, 11, 10];
  return `<table class="synthese-detaillee">
    <colgroup>${largeurs.map(l => `<col style="width:${l}%">`).join("")}</colgroup>
    <thead><tr><th>Chantier</th><th class="n retour">Avancement</th><th class="n retour">${semaine ? "Généré cette semaine" : "Généré sur la période"}</th>
      <th class="n retour">${semaine ? "Marge de la semaine" : "Marge de la période"}</th><th class="n retour">Marge à terminaison</th><th class="n retour">Marge probable</th><th class="n retour">Fourchette</th>
      <th>Fiabilité</th><th class="n retour">Tendance 6 semaines</th></tr></thead>
    <tbody>${total}${lignes}</tbody></table>
    <p class="note">Généré : production de la période. Marge de la ${semaine ? "semaine" : "période"} : en % de la production. Marge à terminaison : où le chantier finit si le reste se passe comme le devis, en % du vendu HT. Marge probable : où le chantier va finir au rythme constaté, en % du vendu HT.
      Fourchette : de la marge probable à la marge si le reste se passe comme le devis. Fiabilité : selon l'avancement et la part des heures restantes dont le rythme est constaté (« 70 % constaté »).
      Tendance : marge probable en fin de chacune des 6 dernières semaines (▲ hausse, ▼ baisse, = stable, · pas de relevé dans la semaine), puis l'évolution sur ces semaines.</p>`;
}

// Version détaillée seulement : les autres marges, chantier par chantier.
function margesDetailHtml(synthese) {
  const signe = v => `<td class="n" style="color:${couleurSigne(v)}">${e(fmtEurSigne(v))}</td>`;
  const lignes = listeSure(synthese).filter(s => s.disponible).map(s => `<tr>
      <td>${e(s.nom)}</td>
      <td class="n">${e(fmtEur(s.production))}</td>
      ${signe(s.margePeriode)}
      ${signe(s.margeAvancement)}
      ${signe(s.margeTerminaison)}
      ${signe(s.margeProbable)}
      <td class="n">${e(fmtEur(s.materiauxEnAvance))}</td>
      ${signe(s.budgetRestant)}
      <td class="n">${e(fmtEurH(s.eurParHeure))}<div class="gris">devis ${e(fmtEurH(s.eurParHeureDevis))}</div></td>
    </tr>`).join("");
  if (!lignes) return "";
  return `${section("Détail des marges")}<table>
    <thead><tr><th>Chantier</th><th class="n">Production</th><th class="n">Marge de la période</th><th class="n">Marge à l'avancement</th>
      <th class="n">Marge à terminaison</th><th class="n">Marge probable</th><th class="n">Matériaux en avance</th><th class="n">Budget restant</th>
      <th class="n">€ produits / h</th></tr></thead>
    <tbody>${lignes}</tbody></table>
    <p class="note">Marge de la période : ce que la marge à l'avancement a gagné ou perdu entre les deux relevés comparés.
      Marge à l'avancement : le constat à date (production − coûts imputés).
      Marge à terminaison : où le chantier finit si le reste se passe comme le devis.
      Marge probable : où le chantier finit si les lots continuent au rythme constaté.</p>`;
}

const legendeHtml = () => `<div class="note"><strong>Pastilles :</strong> ${LEGENDE_PASTILLES_V3.map(l =>
  `<span class="pastille" style="background:${COULEURS_PASTILLES_V3[l.couleur]}"></span>${e(l.critere)}`).join(" · ")}.</div>`;

// Alertes en tableau (choix de Loris du 26/10/2026) : chantier, problème,
// heures, effet sur la marge. Direction : au plus 3 points par chantier,
// triés par montant ; détaillée : tout. La légende des heures sans lot n'est
// écrite qu'une fois.
const MOTIFS_HEURES_SIGNEES = new Set([MOTIF_LOT_EN_DERIVE, MOTIF_MARGE_PROBABLE_EN_BAISSE]);
function alertesHtml(lignesAlertes, { version, seuils }) {
  if (lignesAlertes == null) return `<p class="note">Alertes : relevé pas encore disponible.</p>`;
  const lignes = alertesBilanV3(lignesAlertes, { version, seuils });
  const detaillee = version !== "direction";
  const renvoi = !detaillee && listeSure(lignesAlertes).some(l => listeSure(l.alertes).some(a => alerteVersionDetailleeSeulementV3(a, seuils)));
  const noteRenvoi = renvoi ? `<p class="note">Lots déjà terminés en dérive, heures sans lot et dépassements de matériaux de moins de ${e(fmtEur(normaliserSeuilsMarges(seuils).bilanDirectionEnveloppeMinEuros))} : dans la version détaillée.</p>` : "";
  if (!lignes.length) return `<p class="note">Aucune alerte sur la période.</p>${noteRenvoi}`;
  const heures = it => (it.heures == null ? "—" : MOTIFS_HEURES_SIGNEES.has(it.motif) ? `${it.heures > 0 ? "+" : it.heures < 0 ? "−" : ""}${fmtH(Math.abs(it.heures))}` : fmtH(it.heures));
  const corps = lignes.map(l => l.items.map((it, i) => `<tr>
      ${i === 0 ? `<td rowspan="${l.items.length}"><strong>${e(l.nom)}</strong>${l.nbMasques > 0 ? `<div class="gris">+${l.nbMasques} autre${l.nbMasques > 1 ? "s" : ""} point${l.nbMasques > 1 ? "s" : ""}</div>` : ""}</td>` : ""}
      <td>${e(it.probleme)}</td>
      <td class="n">${e(heures(it))}</td>
      <td class="n" style="color:${couleurSigne(it.impactMarge)}">${e(fmtEurSigne(it.impactMarge))}</td>
    </tr>`).join("")).join("");
  const sansLot = detaillee && lignes.some(l => l.items.some(it => it.motif === MOTIF_HEURES_SANS_LOT));
  return `<table>
    <thead><tr><th>Chantier</th><th>Problème</th><th class="n">Heures</th><th class="n">Effet sur la marge</th></tr></thead>
    <tbody>${corps}</tbody></table>
    ${sansLot ? `<p class="note">Heures sans lot : nettoyage, SAV, approvisionnement… rattachés à aucun lot ; au-delà du seuil, la dérive des lots est masquée.</p>` : ""}
    ${noteRenvoi}`;
}

function listeSectionHtml(items, vide) {
  const l = listeSure(items);
  if (!l.length) return `<p class="note">${e(vide)}</p>`;
  return `<ul>${l.map(t => `<li>${typeof t === "string" ? e(t) : `<strong>${e(t.titre)}</strong>${t.detail ? ` : ${e(t.detail)}` : ""}`}</li>`).join("")}</ul>`;
}

function tendancesHtml(t) {
  if (!t) return "";
  const lignes = listeSure(t.lignes);
  if (!lignes.length) return `<p class="note">Pas assez de données pour les tendances par lot.</p>`;
  return `${t.phrase ? `<p class="note"><strong>${e(t.phrase)}</strong></p>` : ""}<table>
    <thead><tr><th>Type de lot</th><th class="n">Chantiers</th><th class="n">Dérive moyenne</th><th class="n">Écart (h)</th><th class="n">Écart (€)</th></tr></thead>
    <tbody>${lignes.map(l => `<tr><td>${e(l.label)}</td><td class="n">${l.nbChantiers}</td><td class="n">×${e(String(Math.round(l.derive * 100) / 100).replace(".", ","))}</td>
      <td class="n">${e(fmtH(l.ecartHeures))}</td><td class="n">${e(fmtEurSigne(l.ecartEuros))}</td></tr>`).join("")}</tbody></table>`;
}

function semaineQuiVientHtml(s) {
  if (!s) return "";
  if (s.indisponible) return `<p class="note">${e(s.indisponible)}</p>`;
  return listeSectionHtml(s.lignes, "Rien de prévu.");
}

function prevuRealiseHtml(p) {
  if (!p) return "";
  if (!p.disponible) return `<p class="note">${e(p.raison)}</p>`;
  if (!listeSure(p.lignes).length) return `<p class="note">Rien de prévu ni de réalisé sur les chantiers retenus.</p>`;
  return `<p class="note">Heures prévues par le planning au bilan « ${e(p.reference)} », face aux heures validées.</p><table>
    <thead><tr><th>Chantier</th><th class="n">Prévu</th><th class="n">Réalisé</th><th class="n">Écart</th></tr></thead>
    <tbody>${listeSure(p.lignes).map(l => `<tr><td>${e(l.nom)}</td><td class="n">${e(fmtH(l.heuresPrevues))}</td><td class="n">${e(fmtH(l.heuresRealisees))}</td>
      <td class="n">${l.ecart == null ? "—" : e(`${l.ecart > 0 ? "+" : ""}${fmtH(l.ecart)}`)}</td></tr>`).join("")}</tbody></table>`;
}

function finsPrevuesHtml(p) {
  if (!p) return "";
  if (!p.disponible) return `<p class="note">${e(p.raison)}</p>`;
  if (!listeSure(p.lignes).length) return `<p class="note">Aucun chantier retenu.</p>`;
  return `<ul>${listeSure(p.lignes).map(l => `<li><strong>${e(l.nom)}</strong> : ${e(l.texteFin)} · ${e(l.texteGlissement)}</li>`).join("")}</ul>`;
}

function rectificationsHtml(r) {
  const l = listeSure(r);
  if (!l.length) return `<p class="note">Aucune rectification des bilans déjà exportés.</p>`;
  return `<ul>${l.map(x => `<li><strong>${e(x.nom)}</strong> — ${e(x.periode)} : ${e(fmtEurSigne(x.montant))} (${e(x.cause)})</li>`).join("")}</ul>`;
}

// Version détaillée seulement (demande de Loris du 06/11/2026) : la version
// direction s'arrête après les décisions et les tendances.
function sectionsDetailleesSeulementHtml(d) {
  return `
  ${d.semaineQuiVient !== undefined ? `${section("La semaine qui vient")}${semaineQuiVientHtml(d.semaineQuiVient)}` : ""}
  ${d.prevuRealise !== undefined ? `${section("Prévu / réalisé")}${prevuRealiseHtml(d.prevuRealise)}` : ""}
  ${d.finsPrevues !== undefined ? `${section("Fin prévisionnelle")}${finsPrevuesHtml(d.finsPrevues)}` : ""}
  ${d.rectifications !== undefined ? `${section("Rectifications")}${rectificationsHtml(d.rectifications)}` : ""}`;
}

// Titre et dates de la période, pour le héros : « Semaine 44 » et
// « 26/10 → 01/11/2026 » ; « Octobre 2026 » et « 01/10 → 31/10/2026 » ; une
// période libre garde son libellé (« Du … au … ») en titre, sans pastille.
const jjmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const jjmmaaaa = iso => (iso ? `${jjmm(iso)}/${iso.slice(0, 4)}` : "");
function periodeHeroV3(p) {
  const libelle = String(p?.libelle ?? "");
  const m = /^(Semaine \d+) \((.+)\)$/.exec(libelle);
  if (p?.type === "semaine" && m) return { titre: m[1], dates: m[2] };
  if (p?.type === "mois" && p.debut && p.fin) return { titre: libelle, dates: `${jjmm(p.debut)} → ${jjmmaaaa(p.fin)}` };
  return { titre: libelle, dates: null };
}

// Héros de la charte : logo, surtitre jaune, période en titre, dates de
// comparaison en sous-titre, pastilles (période, chantiers, génération) et, à
// droite, le bloc jaune « généré » (production de la période, chiffre du bandeau).
function heroHtml(d, detaillee) {
  const p = d.periode || {};
  const b = d.bornes || {};
  const ph = periodeHeroV3(p);
  const nb = listeSure(d.synthese).length;
  const pills = [ph.dates, nb ? nbChantiersV3(nb) : null, d.genereLe ? `Généré le ${d.genereLe}` : null].filter(Boolean);
  const semaine = p.type === "semaine";
  return `<div class="hero">
    <div class="halo halo-or"></div><div class="halo halo-bleu"></div>
    ${d.logoUrl ? `<img class="logo" src="${e(d.logoUrl)}" alt="Profero" crossorigin="anonymous">` : ""}
    <div class="corps">
      <div class="txt">
        <div class="eb">${detaillee ? "Bilan détaillé" : "Bilan"}</div>
        <h1>${e(ph.titre)}</h1>
        <div class="sous-titre">Comparaison du ${e(fmtJourV3(b.dateDepart))} (dernier jour travaillé avant la période) au ${e(fmtJourV3(b.dateFin))} (dernier jour travaillé de la période)</div>
        ${pills.length ? `<div class="pills">${pills.map(x => `<span class="pill">${e(x)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="hero-kpi"><div class="l">${semaine ? "Généré cette semaine" : "Généré sur la période"}</div><div class="v">${e(fmtEur(d.bandeau?.production))}</div></div>
    </div>
  </div>`;
}

// Corps commun aux deux versions. La direction ne reçoit AUCUN commentaire
// d'ouvrier ; elle résume les journées incomplètes et les chantiers sans
// activité (le détail est dans la version détaillée).
function corpsBilanV3(d, detaillee) {
  const p = d.periode || {};
  const version = detaillee ? "detaillee" : "direction";
  const avert = detaillee
    ? (listeSure(d.avertissements?.textes).length ? `<div class="avert">${listeSure(d.avertissements.textes).map(e).join("<br>")}</div>` : "")
    : `${resumeNonValidesV3(d.avertissements) ? `<div class="avert">${e(resumeNonValidesV3(d.avertissements))}</div>` : ""}${
      resumeJourneesIncompletesV3(d.avertissements) ? `<p class="note">${e(resumeJourneesIncompletesV3(d.avertissements))}</p>` : ""}`;
  const sansActivite = detaillee ? d.ligneSansActivite : (d.resumeSansActivite ?? d.ligneSansActivite);
  return `
  ${heroHtml(d, detaillee)}
  ${avert}
  ${bandeauHtml(d.bandeau || {})}
  ${detaillee ? syntheseDetailleeHtml(d.synthese, d.bandeau, p) : syntheseHtml(d.synthese)}
  ${legendeHtml()}
  ${sansActivite ? `<p class="note">${e(sansActivite)}</p>` : ""}
  ${detaillee ? margesDetailHtml(d.synthese) : ""}
  ${detaillee ? "" : `<div class="saut"></div>`}
  ${section("Alertes")}
  ${alertesHtml(d.alertes, { version, seuils: d.seuilsMarges })}
  ${d.decisions !== undefined ? `${section("Décisions attendues")}${listeSectionHtml(d.decisions, "Aucune décision en attente.")}` : ""}
  ${d.tendances !== undefined ? `${section("Tendances par lot (tous chantiers)")}${tendancesHtml(d.tendances)}` : ""}
  ${detaillee ? sectionsDetailleesSeulementHtml(d) : ""}
  `;
}

/**
 * Version direction : ne reçoit AUCUN commentaire d'ouvrier.
 * @param {object} d
 */
export function htmlBilanDirectionV3(d) {
  return corpsBilanV3(d, false);
}

// « Du devis au probable » (choix de Loris du 26/10/2026) : chaque marge en €
// et en % du vendu, les postes qui les relient (ils s'additionnent exactement).
// Projet « Bilan détaillé », étape 6 : la cascade n'est montrée que pour les
// chantiers qui décrochent ; la décision et le texte de remplacement viennent
// de affichageCascadeV3 (bilanFicheV3.mjs), le constat à date reste affiché.
// Sans décision (ancien appelant), la cascade est montrée comme avant.
function constatHtml(mg) {
  const constat = mg.constat || {}, per = mg.periode || {};
  return `<p class="note">Constat à date : marge à l'avancement ${e(fmtEurSigne(constat.margeAvancement))} · matériaux en avance sur chantier ${e(fmtEur(constat.materiauxEnAvance))}
      — Sur la période : production ${e(fmtEur(per.production))} · marge de la période ${e(fmtEurSigne(per.margePeriode))}</p>`;
}
function cascadeHtml(mg) {
  const aff = mg?.affichage;
  if (aff && aff.afficherCascade === false) return `<p><strong>${e(aff.texte)}</strong></p>${constatHtml(mg)}`;
  const c = mg?.cascade;
  if (!c) return "";
  if (!c.disponible) return `<p class="note"><strong>Du devis au probable :</strong> ${e(c.raison)}.</p>`;
  const total = (libelle, montant, pct) => `<tr class="total"><td>${e(libelle)}</td>
    <td class="n" style="color:${couleurSigne(montant)}">${e(fmtEurSigne(montant))}</td><td class="n gris">${e(fmtPctSur(pct))}</td></tr>`;
  const poste = p => `<tr><td style="padding-left:16px">${e(p.libelle)}</td>
    <td class="n" style="color:${couleurSigne(p.montant)}">${e(fmtEurSigne(p.montant))}</td><td></td></tr>`;
  const haut = c.devisComparable
    ? `${total("Marge devis", c.devis, c.devisPct)}${listeSure(c.versTerminaison).map(poste).join("")}`
    : `<tr><td colspan="3" class="gris">Marge devis non comparable : ${e(c.raisonDevis)}.</td></tr>`;
  return `<table style="width:auto;min-width:62%">
    <thead><tr><th>Du devis au probable</th><th class="n">€</th><th class="n">% du vendu</th></tr></thead>
    <tbody>${haut}
      ${total("= Marge à terminaison (si le reste se passe comme le devis)", c.terminaison, c.terminaisonPct)}
      ${listeSure(c.versProbable).map(poste).join("")}
      ${total("= Marge probable (au rythme constaté)", c.probable, c.probablePct)}
    </tbody></table>
    ${constatHtml(mg)}`;
}

function lotsFicheHtml(f) {
  const lignes = listeSure(f.lots).map(l => l.sansLot
    ? `<tr class="sans-lot"><td>Sans lot</td><td class="n">${e(fmtH(l.heuresReelles))}${l.heuresVendues != null ? ` / ${e(fmtH(l.heuresVendues))}` : ""}</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="gris">heures seulement</td></tr>`
    : `<tr>
    <td>${e(l.label)}</td><td class="n">${e(fmtH(l.heuresReelles))} / ${e(fmtH(l.heuresVendues))}</td>
    <td class="n">${e(fmtPct(l.avancementExact ?? l.avancement))}</td>
    <td class="n" style="color:${couleurSigne(-(l.ecartHeures || 0))}">${l.ecartHeures == null ? "—" : `${e(fmtH(l.ecartHeures))} · ${e(fmtEurSigne(l.ecartEuros))}`}</td>
    <td class="n">${l.termine || l.heuresRestantesPrevues == null ? "—" : `${e(fmtH(l.heuresRestantesPrevues))} → ${e(fmtH(l.heuresRestantesProbables))}`}</td>
    <td>${e(l.provenance || "")}</td></tr>`).join("");
  return `${lignes ? `<table><thead><tr><th>Lot</th><th class="n">Heures réelles / prévues</th><th class="n">Avancement</th><th class="n">Écart</th><th class="n">Restant prévu → probable</th><th>Coefficient</th></tr></thead>
    <tbody>${lignes}</tbody></table>` : ""}
    ${f.aVenir ? `<p class="note">${e(f.aVenir)}</p>` : ""}`;
}

function materiauxFicheHtml(m) {
  if (!m) return "";
  const natures = listeSure(m.parNature);
  const ligneNature = !m.parNatureDisponible ? ""
    : natures.length === 0 ? ""
    : natures.length === 1 && natures[0].nature === "materiaux" ? `<p class="note">Par nature : uniquement des matériaux.</p>`
    : `<p class="note">Par nature : ${natures.map(n => `${e(n.libelle)} ${e(fmtEur(n.montant))}`).join(" · ")}</p>`;
  const lots = listeSure(m.lots);
  const tableau = lots.length || m.sansLot
    ? `<table><thead><tr><th>Lot</th><th class="n">Enveloppe</th><th class="n">Commandé</th><th class="n">Imputé</th><th class="n">En avance</th><th class="n">Reste à commander</th><th class="n">Dépassement</th></tr></thead>
      <tbody>${lots.map(l => `<tr><td>${e(l.label)}${l.achatsTermines ? ` <span class="gris">(achats terminés)</span>` : ""}</td>
        <td class="n">${e(fmtEur(l.enveloppe))}</td><td class="n">${e(fmtEur(l.commandes))}</td><td class="n">${e(fmtEur(l.impute))}</td>
        <td class="n">${e(fmtEur(l.enAvance))}</td><td class="n">${e(fmtEur(l.reste))}</td>
        <td class="n" style="color:${l.depassement ? "#c0392b" : TEXTE_SECONDAIRE}">${l.depassement ? e(fmtEurSigne(l.depassement)) : "—"}</td></tr>`).join("")}
      ${m.sansLot ? `<tr class="sans-lot"><td>Commandes sans lot</td><td class="n">—</td><td class="n">${e(fmtEur(m.sansLot.commandes))}</td><td class="n">${e(fmtEur(m.sansLot.commandes))}</td><td class="n">—</td>
        <td class="n">${m.sansLot.deduction >= 0.5 ? `−${e(fmtEur(m.sansLot.deduction))}` : "—"}</td><td class="n gris">lot à indiquer</td></tr>` : ""}</tbody></table>`
    : m.raisonLots ? `<p class="note">${e(m.raisonLots[0].toUpperCase() + m.raisonLots.slice(1))}.</p>` : "";
  return `<h3>Matériaux</h3>
    <p class="note">Commandés ${e(fmtEur(m.commandes))} · imputés ${e(fmtEur(m.imputes))} · en avance sur chantier ${e(fmtEur(m.enAvance))} · reste à commander ${e(fmtEur(m.resteACommander))}</p>
    ${ligneNature}${tableau}`;
}

function ficheHtml(f) {
  const taches = listeSure(f.tachesParLot);
  // Pagination (html2pdf) : la fiche entière passe à la page suivante quand
  // elle tient sur une page ; sinon, au moins sa tête (carte arrondie : nom,
  // du devis au probable, synthèse, présences) n'est jamais coupée. Chaque
  // carte est posée quelques px sous le haut de son bloc, pour qu'aucun liseré
  // ne reste seul en bas de la page précédente.
  return `<div class="fiche"><div class="tete"><div class="carte">
    <h2>${e(f.nom)}</h2>
    ${cascadeHtml(f.marges)}
    ${f.synthese ? `<p><strong>Synthèse :</strong> ${e(f.synthese)}</p>` : ""}
    ${f.presences ? `<p class="note"><strong>Présences :</strong> ${e(f.presences)}</p>` : ""}
    ${f.horsDevis ? `<p class="note">${e(f.horsDevis)}</p>` : ""}
    </div></div>
    ${lotsFicheHtml(f)}
    ${f.sansLotAlerte ? `<p class="avert">${e(f.sansLotAlerte)}</p>` : ""}
    ${materiauxFicheHtml(f.materiaux)}
    ${taches.length ? `<h3>Tâches</h3><ul>${taches.map(t => `<li><strong>${e(t.lot)}</strong> : ${e(t.resume)}${listeSure(t.taches).length ? `<div class="gris">${listeSure(t.taches).map(x => `${e(x.nom)} (${e(x.etat)})`).join(" · ")}</div>` : ""}</li>`).join("")}</ul>` : ""}
    ${listeSure(f.photos).length ? `<div class="photos">${listeSure(f.photos).map(u => `<img src="${e(u)}" crossorigin="anonymous">`).join("")}</div>` : ""}
    ${listeSure(f.commentaires).length ? `<h3>Commentaires retenus</h3><ul>${listeSure(f.commentaires).map(c => `<li>${e(c.ouvrier)} : « ${e(c.texte)} »</li>`).join("")}</ul>` : ""}
  </div>`;
}

/** Version détaillée : direction + fiches chantier + annexe méthode (si d.methode est fourni). */
export function htmlBilanDetailleV3(d) {
  const fiches = listeSure(d.fiches).map(ficheHtml).join("");
  const methode = listeSure(d.methode);
  return `${corpsBilanV3(d, true)}
  ${d.gestesCommerciaux != null ? `<p class="note"><strong>Gestes commerciaux de la période :</strong> ${e(d.gestesCommerciaux)}</p>` : ""}
  <div class="saut"></div>
  ${fiches}
  ${methode.length ? `<div class="saut"></div>${section("Méthode de calcul")}${methode.map(x => `<p><strong>${e(x.titre)}</strong> — ${e(x.texte)}</p>`).join("")}` : ""}`;
}

// Pied de page de la charte (document à usage interne).
const piedHtml = () => `<div class="pied"><b>${e(PIED_GAUCHE)}</b><span>Document interne</span></div>`;

/**
 * Document complet (avec styles), prêt pour html2pdf ou l'impression.
 * d.logoUrl (facultatif) : URL absolue du logo Profero Rénovation, affiché dans le héros.
 */
export function documentBilanV3(d, { detaillee = false } = {}) {
  return `<div class="page bilan-v3"><style>${STYLE}${detaillee ? STYLE_DETAILLEE : ""}</style>${detaillee ? htmlBilanDetailleV3(d) : htmlBilanDirectionV3(d)}
  ${piedHtml()}</div>`;
}
