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
import { LEGENDE_PASTILLES_V3, COULEURS_PASTILLES_V3, fmtJourV3 } from "./bilanPeriodeV3.mjs";

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

function bandeauHtml(b) {
  const kpi = (l, v, c = "#111827") => `<div class="kpi"><div class="l">${e(l)}</div><div class="v" style="color:${c}">${e(v)}</div></div>`;
  return `<div class="bandeau">
    ${kpi("Production de la période", fmtEur(b.production))}
    ${kpi("Marge de la période", fmtEurSigne(b.margePeriode), couleurSigne(b.margePeriode))}
    ${kpi("Évolution de la marge probable", fmtEurSigne(b.evolutionMargeProbable), couleurSigne(b.evolutionMargeProbable))}
    ${kpi("Heures validées", fmtH(b.heuresValidees))}
    ${kpi("Comptes rendus non validés", String(b.nbComptesRendusNonValides || 0), b.nbComptesRendusNonValides ? "#c0392b" : "#111827")}
  </div>`;
}

function syntheseHtml(synthese) {
  const lignes = listeSure(synthese).map(s => {
    const mentions = listeSure(s.mentions).map(m => `<span class="mention">${e(m.texte)}${m.heuresApresReception > 0 ? ` · ${e(fmtH(m.heuresApresReception))} après réception` : ""}</span>`).join("");
    const coul = COULEURS_PASTILLES_V3[s.pastille?.couleur] || COULEURS_PASTILLES_V3.gris;
    if (!s.disponible) {
      return `<tr><td><span class="pastille" style="background:${coul}"></span>${e(s.nom)}${mentions}</td><td colspan="7" class="gris">relevé pas encore disponible</td></tr>`;
    }
    return `<tr>
      <td><span class="pastille" style="background:${coul}"></span>${e(s.nom)}${mentions}</td>
      <td class="n">${e(fmtPct(s.avancement))}</td>
      <td class="n">${e(fmtEur(s.production))}</td>
      <td class="n" style="color:${couleurSigne(s.margePeriode)}">${e(fmtEurSigne(s.margePeriode))}</td>
      <td class="n" style="color:${couleurSigne(s.margeAvancement)}">${e(fmtEurSigne(s.margeAvancement))}</td>
      <td class="n" style="color:${couleurSigne(s.margeTerminaison)}">${e(fmtEurSigne(s.margeTerminaison))}</td>
      <td class="n" style="color:${couleurSigne(s.margeProbable)}">${e(fmtEurSigne(s.margeProbable))}${s.evolutionMargeProbable != null && Math.abs(s.evolutionMargeProbable) >= 1 ? `<div class="gris">${e(fmtEurSigne(s.evolutionMargeProbable))}</div>` : ""}</td>
      <td class="n">${s.eurParHeure == null ? "—" : `${e(fmtEur(s.eurParHeure))}/h`}</td>
    </tr>`;
  }).join("");
  return `<table>
    <thead><tr><th>Chantier</th><th class="n">Avancement</th><th class="n">Production</th><th class="n">Marge période</th>
      <th class="n">Marge à l'avancement</th><th class="n">Marge à terminaison</th><th class="n">Marge probable</th><th class="n">€ produits / h</th></tr></thead>
    <tbody>${lignes}</tbody></table>`;
}

const legendeHtml = () => `<div class="note"><strong>Pastilles :</strong> ${LEGENDE_PASTILLES_V3.map(l =>
  `<span class="pastille" style="background:${COULEURS_PASTILLES_V3[l.couleur]}"></span>${e(l.critere)}`).join(" · ")}.</div>`;

function alertesHtml(alertes) {
  if (alertes == null) return `<p class="note">Alertes : relevé pas encore disponible.</p>`;
  const lignes = listeSure(alertes);
  if (!lignes.length) return `<p class="note">Aucune alerte sur la période.</p>`;
  return `<ul>${lignes.map(l => `<li><strong>${e(l.nom)}</strong> : ${listeSure(l.alertes).map(a => e(a.texte)).join(" ; ")}</li>`).join("")}</ul>`;
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

function rectificationsHtml(r) {
  const l = listeSure(r);
  if (!l.length) return `<p class="note">Aucune rectification des bilans déjà exportés.</p>`;
  return `<ul>${l.map(x => `<li><strong>${e(x.nom)}</strong> — ${e(x.periode)} : ${e(fmtEurSigne(x.montant))} (${e(x.cause)})</li>`).join("")}</ul>`;
}

/**
 * Version direction : ne reçoit AUCUN commentaire d'ouvrier.
 * @param {object} d
 */
export function htmlBilanDirectionV3(d) {
  const p = d.periode || {};
  const b = d.bornes || {};
  const incompletes = listeSure(d.avertissements?.textes);
  return `
  <h1>Bilan — ${e(p.libelle)}</h1>
  <div class="sous-titre">Comparaison du ${e(fmtJourV3(b.dateDepart))} (dernier jour travaillé avant la période) au ${e(fmtJourV3(b.dateFin))} (dernier jour travaillé de la période)${d.genereLe ? ` · généré le ${e(d.genereLe)}` : ""}</div>
  ${incompletes.length ? `<div class="avert">${incompletes.map(e).join("<br>")}</div>` : ""}
  ${bandeauHtml(d.bandeau || {})}
  ${syntheseHtml(d.synthese)}
  ${legendeHtml()}
  ${d.ligneSansActivite ? `<p class="note">${e(d.ligneSansActivite)}</p>` : ""}
  <div class="saut"></div>
  <h2>Alertes</h2>
  ${alertesHtml(d.alertes)}
  ${d.decisions !== undefined ? `<h2>Décisions attendues</h2>${listeSectionHtml(d.decisions, "Aucune décision en attente.")}` : ""}
  ${d.tendances !== undefined ? `<h2>Tendances par lot (tous chantiers)</h2>${tendancesHtml(d.tendances)}` : ""}
  ${d.semaineQuiVient !== undefined ? `<h2>La semaine qui vient</h2>${semaineQuiVientHtml(d.semaineQuiVient)}` : ""}
  ${d.rectifications !== undefined ? `<h2>Rectifications</h2>${rectificationsHtml(d.rectifications)}` : ""}
  `;
}

function ficheHtml(f) {
  const lots = listeSure(f.lots).map(l => `<tr${l.sansLot ? ' style="background:#fff7ed"' : ""}>
    <td>${e(l.label)}</td><td class="n">${e(fmtH(l.heuresReelles))} / ${e(fmtH(l.heuresVendues))}</td>
    <td class="n">${e(fmtPct(l.avancementExact ?? l.avancement))}</td>
    <td class="n" style="color:${couleurSigne(-(l.ecartHeures || 0))}">${l.ecartHeures == null ? "—" : `${e(fmtH(l.ecartHeures))} · ${e(fmtEurSigne(l.ecartEuros))}`}</td>
    <td class="n">${l.heuresRestantesPrevues == null ? "—" : `${e(fmtH(l.heuresRestantesPrevues))} → ${e(fmtH(l.heuresRestantesProbables))}`}</td>
    <td>${e(l.provenance || "")}</td></tr>`).join("");
  const m = f.materiaux || null;
  const taches = listeSure(f.tachesParLot);
  return `<div class="fiche">
    <h2>${e(f.nom)}</h2>
    ${f.synthese ? `<p><strong>Synthèse :</strong> ${e(f.synthese)}</p>` : ""}
    ${f.presences ? `<p class="note"><strong>Présences :</strong> ${e(f.presences)}</p>` : ""}
    <table><thead><tr><th>Lot</th><th class="n">Heures réelles / prévues</th><th class="n">Avancement</th><th class="n">Écart</th><th class="n">Restant prévu → probable</th><th>Coefficient</th></tr></thead>
    <tbody>${lots}</tbody></table>
    ${f.sansLotAlerte ? `<p class="avert">${e(f.sansLotAlerte)}</p>` : ""}
    ${m ? `<h3>Matériaux</h3><p class="note">Commandés ${e(fmtEur(m.commandes))} · imputés ${e(fmtEur(m.imputes))} · en avance sur chantier ${e(fmtEur(m.enAvance))} · reste à commander ${e(fmtEur(m.resteACommander))}${listeSure(m.parNature).length ? ` — ${listeSure(m.parNature).map(n => `${e(n.libelle)} ${e(fmtEur(n.montant))}`).join(" · ")}` : ""}</p>` : ""}
    ${taches.length ? `<h3>Tâches</h3><ul>${taches.map(t => `<li><strong>${e(t.lot)}</strong> : ${e(t.resume)}${listeSure(t.taches).length ? `<div class="gris">${listeSure(t.taches).map(x => `${e(x.nom)} (${e(x.etat)})`).join(" · ")}</div>` : ""}</li>`).join("")}</ul>` : ""}
    ${listeSure(f.photos).length ? `<div class="photos">${listeSure(f.photos).map(u => `<img src="${e(u)}" crossorigin="anonymous">`).join("")}</div>` : ""}
    ${listeSure(f.commentaires).length ? `<h3>Commentaires retenus</h3><ul>${listeSure(f.commentaires).map(c => `<li>${e(c.ouvrier)} : « ${e(c.texte)} »</li>`).join("")}</ul>` : ""}
  </div>`;
}

/** Version détaillée : direction + fiches chantier + annexe méthode. */
export function htmlBilanDetailleV3(d) {
  const fiches = listeSure(d.fiches).map(ficheHtml).join("");
  const methode = listeSure(d.methode);
  return `${htmlBilanDirectionV3(d)}
  ${d.gestesCommerciaux != null ? `<p class="note"><strong>Gestes commerciaux de la période :</strong> ${e(d.gestesCommerciaux)}</p>` : ""}
  <div class="saut"></div>
  ${fiches}
  ${methode.length ? `<div class="saut"></div><h2>Méthode de calcul</h2>${methode.map(x => `<p><strong>${e(x.titre)}</strong> — ${e(x.texte)}</p>`).join("")}` : ""}`;
}

/** Document complet (avec styles), prêt pour html2pdf ou l'impression. */
export function documentBilanV3(d, { detaillee = false } = {}) {
  return `<div class="page bilan-v3"><style>${STYLE}</style>${detaillee ? htmlBilanDetailleV3(d) : htmlBilanDirectionV3(d)}</div>`;
}
