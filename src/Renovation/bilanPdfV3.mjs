// ─────────────────────────────────────────────────────────────────────────────
// HTML du Bilan exporté (PDF / e-mail) — refonte du Bilan, étape 3.
//
// Deux versions :
//   - DIRECTION (par défaut, 1 à 2 pages) : bandeau, synthèse par chantier avec
//     pastille et légende, mentions, chantiers sans activité, journées
//     incomplètes ; page 2 : alertes, décisions attendues, tendances par lot,
//     semaine qui vient, rectifications.
//   - DÉTAILLÉE : la version direction + une fiche par chantier + l'annexe
//     « Méthode de calcul ».
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
  resumeJourneesIncompletesV3, resumeNonValidesV3,
} from "./bilanPeriodeV3.mjs";
import { normaliserSeuilsMarges } from "../chantierFinance.mjs";
import { MOTIF_LOT_EN_DERIVE, MOTIF_MARGE_PROBABLE_EN_BAISSE, MOTIF_HEURES_SANS_LOT } from "./pointsAttentionV1.mjs";

const listeSure = v => (Array.isArray(v) ? v : []);
export const echapperHtml = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const e = echapperHtml;

const nbsp = " ";
const fmtEur = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")}${nbsp}€`);
const fmtEurSigne = v => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")}${nbsp}€`);
const fmtH = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")}${nbsp}h`);
const fmtPct = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")}${nbsp}%`);
const couleurSigne = v => (v == null ? "#6b7280" : v < -0.5 ? "#c0392b" : v > 0.5 ? "#15803d" : "#111827");

const STYLE = `
  .bilan-v3 { font-family: Arial, Helvetica, sans-serif; color: #111827; font-size: 10.5px; line-height: 1.35; }
  .bilan-v3 h1 { font-size: 18px; margin: 0 0 2px; }
  .bilan-v3 h2 { font-size: 13px; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #FFC200; }
  .bilan-v3 h3 { font-size: 11.5px; margin: 10px 0 4px; }
  .bilan-v3 .sous-titre { color: #4b5563; font-size: 10px; margin-bottom: 8px; }
  .bilan-v3 .bandeau { display: flex; gap: 6px; margin: 8px 0; }
  .bilan-v3 .kpi { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; background: #f9fafb; }
  .bilan-v3 .kpi .l { color: #6b7280; font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
  .bilan-v3 .kpi .v { font-size: 14px; font-weight: bold; margin-top: 2px; }
  .bilan-v3 .kpi .s { font-size: 9px; color: #4b5563; margin-top: 2px; }
  .bilan-v3 table { width: 100%; border-collapse: collapse; margin: 4px 0; }
  .bilan-v3 th { text-align: left; font-size: 9px; color: #374151; background: #f3f4f6; padding: 4px 5px; border-bottom: 1px solid #d1d5db; }
  .bilan-v3 td { padding: 4px 5px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  .bilan-v3 td.n, .bilan-v3 th.n { text-align: right; white-space: nowrap; }
  .bilan-v3 .pastille { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .bilan-v3 .mention { display: inline-block; font-size: 8.5px; padding: 1px 5px; border-radius: 8px; background: #fef3c7; color: #92400e; margin-left: 4px; }
  .bilan-v3 .note { color: #4b5563; font-size: 9.5px; margin: 4px 0; }
  .bilan-v3 .avert { border: 1px solid #fca5a5; background: #fef2f2; color: #991b1b; padding: 5px 8px; border-radius: 6px; margin: 6px 0; font-size: 9.5px; }
  .bilan-v3 ul { margin: 2px 0 2px 16px; padding: 0; }
  .bilan-v3 li { margin: 1px 0; }
  .bilan-v3 .saut { page-break-before: always; break-before: page; }
  .bilan-v3 .fiche { page-break-inside: avoid; break-inside: avoid; }
  .bilan-v3 .photos img { height: 110px; margin-right: 6px; border-radius: 4px; }
  .bilan-v3 .gris { color: #6b7280; }
`;

// Pourcentage affiché : « — » si inconnu (vendu nul, production nulle…).
const fmtPctSur = v => {
  if (v == null) return "—";
  const r = Math.round(v);
  return `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("fr-FR")}${nbsp}%`;
};
const fmtEurH = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")}${nbsp}€/h`);
const fleche = v => (v == null || Math.abs(v) < 1 ? "=" : v < 0 ? "▼" : "▲");

// Bandeau (choix de Loris du 26/10/2026) : des chiffres avec leurs repères.
function bandeauHtml(b) {
  const kpi = (l, v, c, sous = []) => `<div class="kpi"><div class="l">${e(l)}</div><div class="v" style="color:${c || "#111827"}">${e(v)}</div>${
    sous.filter(Boolean).map(x => `<div class="s">${e(x)}</div>`).join("")}</div>`;
  const evo = b.evolutionMargeProbable;
  return `<div class="bandeau">
    ${kpi("Production de la période", fmtEur(b.production))}
    ${kpi("Marge de la période", fmtEurSigne(b.margePeriode), couleurSigne(b.margePeriode),
      [b.margePeriodePct == null ? "— de la production" : `${fmtPctSur(b.margePeriodePct)} de la production`])}
    ${kpi(b.nbChantiersHorsComparaison > 0 ? `Marge probable (${b.nbChantiersComparables} chantiers)` : "Marge probable, tous chantiers",
      fmtEurSigne(b.margeProbableTotale), couleurSigne(b.margeProbableTotale), [
      `${fmtPctSur(b.margeProbableTotalePct)} du vendu · devis ${fmtEurSigne(b.margeDevisTotale)} (${fmtPctSur(b.margeDevisTotalePct)})`,
      evo == null ? "évolution sur la période : —" : `${fleche(evo)} ${fmtEurSigne(evo)} sur la période, tous chantiers`,
      b.nbChantiersHorsComparaison > 0 ? `${b.nbChantiersHorsComparaison} chantier${b.nbChantiersHorsComparaison > 1 ? "s" : ""} hors total (marge devis inconnue ou sans matériaux prévus)` : null])}
    ${kpi("Heures validées", fmtH(b.heuresValidees), null, [`${fmtEurH(b.eurParHeure)} produits · devis ${fmtEurH(b.eurParHeureDevis)}`])}
  </div>`;
}

const mentionsHtml = s => listeSure(s.mentions).map(m => `<span class="mention">${e(m.texte)}${m.heuresApresReception > 0 ? ` · ${e(fmtH(m.heuresApresReception))} après réception` : ""}</span>`).join("");
const celluleMarge = (montant, pct) => `<td class="n" style="color:${couleurSigne(montant)}">${e(fmtEurSigne(montant))}<div class="gris">${e(fmtPctSur(pct))}</div></td>`;

// Tableau des chantiers, version direction : « Devis → probable ».
function syntheseHtml(synthese) {
  const lignes = listeSure(synthese).map(s => {
    const coul = COULEURS_PASTILLES_V3[s.pastille?.couleur] || COULEURS_PASTILLES_V3.gris;
    const tete = `<td><span class="pastille" style="background:${coul}"></span>${e(s.nom)}${mentionsHtml(s)}</td>`;
    if (!s.disponible) return `<tr>${tete}<td colspan="7" class="gris">relevé pas encore disponible</td></tr>`;
    const evo = s.evolutionMargeProbable;
    return `<tr>${tete}
      <td class="n">${e(fmtPct(s.avancement))}</td>
      <td class="n">${e(fmtEur(s.vendu))}</td>
      ${s.margeDevisSansMateriaux
        ? `<td class="n" style="color:${couleurSigne(s.margeDevis)}">${e(fmtEurSigne(s.margeDevis))}<div class="gris">sans matériaux prévus</div></td>`
        : celluleMarge(s.margeDevis, s.margeDevisPct)}
      ${celluleMarge(s.margeProbable, s.margeProbablePct)}
      <td class="n" style="color:${couleurSigne(s.ecartDevis)}">${e(fmtEurSigne(s.ecartDevis))}</td>
      <td class="n" style="color:${couleurSigne(evo)}">${evo == null ? "—" : `${fleche(evo)} ${e(fmtEurSigne(evo))}`}</td>
      <td class="n">${e(fmtEurH(s.eurParHeure))}<div class="gris">devis ${e(fmtEurH(s.eurParHeureDevis))}</div></td>
    </tr>`;
  }).join("");
  return `<table>
    <thead><tr><th>Chantier</th><th class="n">Avancement</th><th class="n">Vendu HT</th><th class="n">Marge devis</th>
      <th class="n">Marge probable</th><th class="n">Écart / devis</th><th class="n">Sur la période</th><th class="n">€ produits / h</th></tr></thead>
    <tbody>${lignes}</tbody></table>
    <p class="note">Marge devis : ce que le devis laissait espérer. Marge probable : où le chantier va finir si les lots continuent au rythme constaté.
      « Sur la période » : évolution de la marge probable. Pourcentages : part du vendu HT.</p>`;
}

// Version détaillée seulement : les autres marges, chantier par chantier.
function margesDetailHtml(synthese) {
  const lignes = listeSure(synthese).filter(s => s.disponible).map(s => `<tr>
      <td>${e(s.nom)}</td>
      <td class="n">${e(fmtEur(s.production))}</td>
      <td class="n" style="color:${couleurSigne(s.margePeriode)}">${e(fmtEurSigne(s.margePeriode))}</td>
      <td class="n" style="color:${couleurSigne(s.margeAvancement)}">${e(fmtEurSigne(s.margeAvancement))}</td>
      <td class="n" style="color:${couleurSigne(s.margeTerminaison)}">${e(fmtEurSigne(s.margeTerminaison))}</td>
      <td class="n">${e(fmtEur(s.materiauxEnAvance))}</td>
    </tr>`).join("");
  if (!lignes) return "";
  return `<h2>Détail des marges</h2><table>
    <thead><tr><th>Chantier</th><th class="n">Production</th><th class="n">Marge de la période</th><th class="n">Marge à l'avancement</th>
      <th class="n">Marge à terminaison</th><th class="n">Matériaux en avance</th></tr></thead>
    <tbody>${lignes}</tbody></table>
    <p class="note">Marge à l'avancement : le constat à date (production − coûts imputés). Marge à terminaison : où le chantier finit si le reste se passe comme le devis.</p>`;
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

// Corps commun aux deux versions. La direction ne reçoit AUCUN commentaire
// d'ouvrier ; elle résume les journées incomplètes et les chantiers sans
// activité (le détail est dans la version détaillée).
function corpsBilanV3(d, detaillee) {
  const p = d.periode || {};
  const b = d.bornes || {};
  const version = detaillee ? "detaillee" : "direction";
  const avert = detaillee
    ? (listeSure(d.avertissements?.textes).length ? `<div class="avert">${listeSure(d.avertissements.textes).map(e).join("<br>")}</div>` : "")
    : `${resumeNonValidesV3(d.avertissements) ? `<div class="avert">${e(resumeNonValidesV3(d.avertissements))}</div>` : ""}${
      resumeJourneesIncompletesV3(d.avertissements) ? `<p class="note">${e(resumeJourneesIncompletesV3(d.avertissements))}</p>` : ""}`;
  const sansActivite = detaillee ? d.ligneSansActivite : (d.resumeSansActivite ?? d.ligneSansActivite);
  return `
  <h1>Bilan — ${e(p.libelle)}</h1>
  <div class="sous-titre">Comparaison du ${e(fmtJourV3(b.dateDepart))} (dernier jour travaillé avant la période) au ${e(fmtJourV3(b.dateFin))} (dernier jour travaillé de la période)${d.genereLe ? ` · généré le ${e(d.genereLe)}` : ""}</div>
  ${avert}
  ${bandeauHtml(d.bandeau || {})}
  ${syntheseHtml(d.synthese)}
  ${legendeHtml()}
  ${sansActivite ? `<p class="note">${e(sansActivite)}</p>` : ""}
  ${detaillee ? margesDetailHtml(d.synthese) : ""}
  <div class="saut"></div>
  <h2>Alertes</h2>
  ${alertesHtml(d.alertes, { version, seuils: d.seuilsMarges })}
  ${d.decisions !== undefined ? `<h2>Décisions attendues</h2>${listeSectionHtml(d.decisions, "Aucune décision en attente.")}` : ""}
  ${d.tendances !== undefined ? `<h2>Tendances par lot (tous chantiers)</h2>${tendancesHtml(d.tendances)}` : ""}
  ${d.semaineQuiVient !== undefined ? `<h2>La semaine qui vient</h2>${semaineQuiVientHtml(d.semaineQuiVient)}` : ""}
  ${d.prevuRealise !== undefined ? `<h2>Prévu / réalisé</h2>${prevuRealiseHtml(d.prevuRealise)}` : ""}
  ${d.finsPrevues !== undefined ? `<h2>Fin prévisionnelle</h2>${finsPrevuesHtml(d.finsPrevues)}` : ""}
  ${d.rectifications !== undefined ? `<h2>Rectifications</h2>${rectificationsHtml(d.rectifications)}` : ""}
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
function cascadeHtml(mg) {
  const c = mg?.cascade;
  if (!c) return "";
  if (!c.disponible) return `<p class="note"><strong>Du devis au probable :</strong> ${e(c.raison)}.</p>`;
  const total = (libelle, montant, pct) => `<tr style="font-weight:bold;background:#f9fafb"><td>${e(libelle)}</td>
    <td class="n" style="color:${couleurSigne(montant)}">${e(fmtEurSigne(montant))}</td><td class="n gris">${e(fmtPctSur(pct))}</td></tr>`;
  const poste = p => `<tr><td style="padding-left:16px">${e(p.libelle)}</td>
    <td class="n" style="color:${couleurSigne(p.montant)}">${e(fmtEurSigne(p.montant))}</td><td></td></tr>`;
  const haut = c.devisComparable
    ? `${total("Marge devis", c.devis, c.devisPct)}${listeSure(c.versTerminaison).map(poste).join("")}`
    : `<tr><td colspan="3" class="gris">Marge devis non comparable : ${e(c.raisonDevis)}.</td></tr>`;
  const constat = mg.constat || {}, per = mg.periode || {};
  return `<table style="width:auto;min-width:62%">
    <thead><tr><th>Du devis au probable</th><th class="n">€</th><th class="n">% du vendu</th></tr></thead>
    <tbody>${haut}
      ${total("= Marge à terminaison (si le reste se passe comme le devis)", c.terminaison, c.terminaisonPct)}
      ${listeSure(c.versProbable).map(poste).join("")}
      ${total("= Marge probable (au rythme constaté)", c.probable, c.probablePct)}
    </tbody></table>
    <p class="note">Constat à date : marge à l'avancement ${e(fmtEurSigne(constat.margeAvancement))} · matériaux en avance sur chantier ${e(fmtEur(constat.materiauxEnAvance))}
      — Sur la période : production ${e(fmtEur(per.production))} · marge de la période ${e(fmtEurSigne(per.margePeriode))}</p>`;
}

function lotsFicheHtml(f) {
  const lignes = listeSure(f.lots).map(l => l.sansLot
    ? `<tr style="background:#fff7ed"><td>Sans lot</td><td class="n">${e(fmtH(l.heuresReelles))}${l.heuresVendues != null ? ` / ${e(fmtH(l.heuresVendues))}` : ""}</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="gris">heures seulement</td></tr>`
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
        <td class="n" style="color:${l.depassement ? "#c0392b" : "#6b7280"}">${l.depassement ? e(fmtEurSigne(l.depassement)) : "—"}</td></tr>`).join("")}
      ${m.sansLot ? `<tr style="background:#fff7ed"><td>Commandes sans lot</td><td class="n">—</td><td class="n">${e(fmtEur(m.sansLot.commandes))}</td><td class="n">${e(fmtEur(m.sansLot.commandes))}</td><td class="n">—</td>
        <td class="n">${m.sansLot.deduction >= 0.5 ? `−${e(fmtEur(m.sansLot.deduction))}` : "—"}</td><td class="n gris">lot à indiquer</td></tr>` : ""}</tbody></table>`
    : m.raisonLots ? `<p class="note">${e(m.raisonLots[0].toUpperCase() + m.raisonLots.slice(1))}.</p>` : "";
  return `<h3>Matériaux</h3>
    <p class="note">Commandés ${e(fmtEur(m.commandes))} · imputés ${e(fmtEur(m.imputes))} · en avance sur chantier ${e(fmtEur(m.enAvance))} · reste à commander ${e(fmtEur(m.resteACommander))}</p>
    ${ligneNature}${tableau}`;
}

function ficheHtml(f) {
  const taches = listeSure(f.tachesParLot);
  return `<div class="fiche">
    <h2>${e(f.nom)}</h2>
    ${cascadeHtml(f.marges)}
    ${f.synthese ? `<p><strong>Synthèse :</strong> ${e(f.synthese)}</p>` : ""}
    ${f.presences ? `<p class="note"><strong>Présences :</strong> ${e(f.presences)}</p>` : ""}
    ${f.horsDevis ? `<p class="note">${e(f.horsDevis)}</p>` : ""}
    ${lotsFicheHtml(f)}
    ${f.sansLotAlerte ? `<p class="avert">${e(f.sansLotAlerte)}</p>` : ""}
    ${materiauxFicheHtml(f.materiaux)}
    ${taches.length ? `<h3>Tâches</h3><ul>${taches.map(t => `<li><strong>${e(t.lot)}</strong> : ${e(t.resume)}${listeSure(t.taches).length ? `<div class="gris">${listeSure(t.taches).map(x => `${e(x.nom)} (${e(x.etat)})`).join(" · ")}</div>` : ""}</li>`).join("")}</ul>` : ""}
    ${listeSure(f.photos).length ? `<div class="photos">${listeSure(f.photos).map(u => `<img src="${e(u)}" crossorigin="anonymous">`).join("")}</div>` : ""}
    ${listeSure(f.commentaires).length ? `<h3>Commentaires retenus</h3><ul>${listeSure(f.commentaires).map(c => `<li>${e(c.ouvrier)} : « ${e(c.texte)} »</li>`).join("")}</ul>` : ""}
  </div>`;
}

/** Version détaillée : direction + fiches chantier + annexe méthode. */
export function htmlBilanDetailleV3(d) {
  const fiches = listeSure(d.fiches).map(ficheHtml).join("");
  const methode = listeSure(d.methode);
  return `${corpsBilanV3(d, true)}
  ${d.gestesCommerciaux != null ? `<p class="note"><strong>Gestes commerciaux de la période :</strong> ${e(d.gestesCommerciaux)}</p>` : ""}
  <div class="saut"></div>
  ${fiches}
  ${methode.length ? `<div class="saut"></div><h2>Méthode de calcul</h2>${methode.map(x => `<p><strong>${e(x.titre)}</strong> — ${e(x.texte)}</p>`).join("")}` : ""}`;
}

/** Document complet (avec styles), prêt pour html2pdf ou l'impression. */
export function documentBilanV3(d, { detaillee = false } = {}) {
  return `<div class="page bilan-v3"><style>${STYLE}</style>${detaillee ? htmlBilanDetailleV3(d) : htmlBilanDirectionV3(d)}</div>`;
}
