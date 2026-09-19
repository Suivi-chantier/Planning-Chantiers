// operationDoc — gabarit PDF « Fiche opération » (document INTERNE).
//
// Présente une opération complète au design habituel des documents Profero
// (enveloppe docClientHTML de previsionnelDoc.js : héros sombre à halos,
// jaune marque, Barlow, pied « Document confidentiel ») avec son volet
// financier : chiffres clés, tableau prévisionnel (devis) vs réel à date,
// décomposition du vendu HT et détail par logement.
//
// ⚠ Ce document contient les MARGES : usage interne, pas un document client.
//
// Aucun calcul ici : les scalaires viennent des agrégats de PageOperations
// (somme des `brut` de computeChantierFinance — le même module que la fiche
// Chantier). Ce module ne fait que METTRE EN PAGE.
// Extensions explicites : elles permettent au chargeur de scripts/_chargeur.mjs
// de charger ce module dans Node pour la vérification, sans build. Vite résout
// les deux formes à l'identique.
import { docClientHTML, sectionTitre } from "./previsionnelDoc.js";
import { eur, fmtH } from "../chantierFinance.js";
// Préparation de chantier : échappement, ordre réel des phases et comptages —
// les MÊMES règles que le dossier détaillé d'un chantier
// (preparationChantierDoc.js) et que l'espace ouvrier. Voir
// preparationDocCommun.mjs pour le périmètre volontairement étroit du partage.
import {
  escDoc, escCssDoc, compteursPhase, estPhaseAOrganiser, entier, totauxOperation,
} from "./preparationDocCommun.mjs";

const OR = "#FFC200";
const GRIS_DOC = "#8a90a0";
const esc = escDoc;
const pctTxt = (p) => (p == null ? "—" : `${p.toFixed(1).replace(".", ",")} %`);
const margeCouleur = (marge, pct) => (marge < 0 ? "#c0392b" : (pct != null && pct < 15) ? "#b97a10" : "#1e8e4e");

// Tuile « chiffre clé » du bandeau de synthèse.
const tuile = ({ label, valeur, sous = "", accent = "#12151c" }) => `
  <div class="op-tuile">
    <div class="op-tuile-label">${esc(label)}</div>
    <div class="op-tuile-val bc" style="color:${accent};">${esc(valeur)}</div>
    ${sous ? `<div class="op-tuile-sous">${esc(sous)}</div>` : ""}
  </div>`;

// ─── PRÉPARATION DE L'OPÉRATION ───────────────────────────────────────────────
// Le dossier d'opération donne une VUE D'ENSEMBLE de la préparation, pas le
// dossier de chaque chantier : recopier les tâches et les matériaux de cinq
// logements produirait 60 à 100 pages que personne n'imprime. On s'arrête donc
// au niveau PHASE (rang, nom, couleur, nombre d'ouvrages, nombre de tâches) et
// on renvoie explicitement au dossier détaillé, qui s'édite depuis la fiche du
// chantier. Le détail complet vit dans preparationChantierDoc.js.
const MENTION_DOSSIER_DETAILLE =
  "Le dossier détaillé de ce chantier — tâches et matériaux de chaque ouvrage — s'imprime depuis sa fiche, bouton « Préparation PDF ».";

const s2 = (n) => (n > 1 ? "s" : "");

// Petite tuile de comptage (synthèse globale et en-tête de chantier).
const tuileCompte = (label, valeur, accent = "#12151c") => `
  <div class="op-pc-tuile">
    <div class="op-pc-tuile-label">${esc(label)}</div>
    <div class="op-pc-tuile-val bc" style="color:${accent};">${esc(String(valeur))}</div>
  </div>`;

// Badge d'état de préparation d'un chantier. Un chantier sans phasage V2
// exploitable n'est JAMAIS annoncé comme préparé — c'est la règle qui compte.
function badgePreparation(resume) {
  if (resume?.erreur) return { label: "Chargement en échec", couleur: "#c0392b" };
  if (!resume?.exploitable) return { label: "À préparer", couleur: "#b97a10" };
  if (entier(resume.nbAOrganiser) > 0) return { label: "À compléter", couleur: "#b97a10" };
  return { label: "Préparé", couleur: "#1e8e4e" };
}

// Une ligne de phase : le strict nécessaire pour se repérer. Volontairement
// PAS de tâches, PAS de matériaux, PAS d'ouvrages détaillés.
function lignePhase(phase, rang) {
  const { nbOuvrages, nbTaches } = compteursPhase(phase);
  const aOrganiser = estPhaseAOrganiser(phase);
  const couleur = (phase?.couleur || GRIS_DOC).toString();
  return `
  <tr class="op-ph-row">
    <td class="op-ph-rang bc">${esc(String(rang).padStart(2, "0"))}</td>
    <td class="op-ph-pastille"><span class="op-ph-dot" style="background:${esc(couleur)};"></span></td>
    <td class="op-ph-nom">${esc(phase?.nom || "Phase")}${aOrganiser
      ? `<span class="op-ph-flag">Hors planning</span>` : ""}</td>
    <td class="op-ph-num">${esc(`${nbOuvrages} ouvrage${s2(nbOuvrages)}`)}</td>
    <td class="op-ph-num">${esc(`${nbTaches} tâche${s2(nbTaches)}`)}</td>
  </tr>`;
}

// Fiche synthétique d'UN chantier. `p` vient de PageOperations :
//   { chantier:{nom,couleur}, statutLabel, statutColor, adresse, planning:{debut,fin},
//     equipes:[nom], resume } — resume = resumePreparation() du module commun.
// Aucune donnée n'est inventée : une information absente est simplement omise,
// jamais remplacée par « undefined », « null » ou un séparateur orphelin.
function ficheChantier(p, rang) {
  const r = p?.resume || {};
  const badge = badgePreparation(r);
  const couleur = (p?.chantier?.couleur || GRIS_DOC).toString();
  const nom = p?.chantier?.nom || "Chantier";

  // Méta : chaque morceau n'entre que s'il existe réellement.
  const periode = (() => {
    const d = (p?.planning?.debut || "").trim(), f = (p?.planning?.fin || "").trim();
    if (!d && !f) return "";
    if (d && f) return d === f ? d : `${d} → ${f}`;
    return d || f;
  })();
  const equipes = Array.isArray(p?.equipes) ? p.equipes.filter(Boolean).map(e => String(e).trim()) : [];
  // Les équipes du référentiel s'appellent souvent déjà « Équipe Nord » :
  // préfixer systématiquement donnerait « Équipe Équipe Nord ».
  const libelleEquipes = equipes.length === 0 ? ""
    : equipes.some(e => /^équipes?\b/i.test(e))
      ? equipes.join(", ")
      : `${equipes.length > 1 ? "Équipes" : "Équipe"} ${equipes.join(", ")}`;
  const meta = [
    (p?.adresse || "").trim(),
    periode ? `Travaux ${periode}` : "",
    libelleEquipes,
  ].filter(Boolean).join("  ·  ");

  const statut = (p?.statutLabel || "").trim();

  const entete = `
    <div class="op-ch-head">
      <div class="op-ch-band" style="border-left-color:${esc(couleur)};">
        <span class="op-ch-rang bc">${esc(String(rang).padStart(2, "0"))}</span>
        <span class="op-ch-txt">
          <span class="op-ch-nom bc">${esc(nom)}</span>
          ${meta ? `<span class="op-ch-meta">${esc(meta)}</span>` : ""}
        </span>
        ${statut ? `<span class="op-ch-statut" style="color:${esc(p.statutColor || GRIS_DOC)};border-color:${esc(p.statutColor || GRIS_DOC)};">${esc(statut)}</span>` : ""}
        <span class="op-ch-etat" style="color:${badge.couleur};border-color:${badge.couleur};">${esc(badge.label)}</span>
      </div>`;

  // Préparation inexploitable : un encadré explicite, et on passe au suivant.
  // Une erreur sur un chantier n'empêche jamais d'imprimer les autres.
  if (!r.exploitable) {
    const titre = r.erreur ? "Préparation non chargée" : (r.ecran?.titre || "Préparation indisponible");
    const texte = r.erreur
      ? `La préparation de ce chantier n'a pas pu être lue (${r.erreur}). Les autres chantiers de l'opération sont imprimés normalement.`
      : (r.ecran?.texte || "Les données de ce chantier n'ont pas pu être interprétées.");
    const ton = r.erreur || r.ecran?.ton === "alerte" ? " op-ch-alerte-rouge" : "";
    return `
    <div class="op-ch">
      ${entete}
      </div>
      <div class="op-ch-alerte${ton}">
        <div class="op-ch-alerte-titre">${esc(titre)}</div>
        <div class="op-ch-alerte-texte">${esc(texte)}</div>
      </div>
    </div>`;
  }

  const nbAO = entier(r.nbAOrganiser);
  const compteurs = `
      <div class="op-pc-tuiles op-pc-tuiles-ch">
        ${tuileCompte("Phases", entier(r.nbPhases))}
        ${tuileCompte("Ouvrages", entier(r.nbOuvrages), "#5b8af5")}
        ${tuileCompte("Tâches", entier(r.nbTaches))}
        ${tuileCompte("À organiser", nbAO, nbAO > 0 ? "#b97a10" : GRIS_DOC)}
      </div>
    </div>`;

  const phases = (r.phases || []).map((ph, i) => lignePhase(ph, i + 1)).join("");

  return `
  <div class="op-ch">
    ${entete}
    ${compteurs}
    <table class="op-ph">
      <thead><tr>
        <th></th><th></th>
        <th style="text-align:left;">Phase — ordre réel d'exécution</th>
        <th>Ouvrages</th><th>Tâches</th>
      </tr></thead>
      <tbody>${phases}</tbody>
    </table>
    ${nbAO > 0 ? `<div class="op-ch-note">${esc(`${nbAO} tâche${s2(nbAO)} sans phase : à caler avec le conducteur avant le démarrage.`)}</div>` : ""}
    <div class="op-ch-renvoi">${esc(MENTION_DOSSIER_DETAILLE)}</div>
  </div>`;
}

// Section « Préparation » complète : synthèse globale puis une fiche par
// chantier. Renvoie "" si aucune préparation n'a été demandée — l'ancien
// document (purement financier) reste alors identique.
function sectionPreparation(preparations, totaux) {
  if (!Array.isArray(preparations) || preparations.length === 0) return "";

  // Chantiers qui réclament encore une action, dits en clair plutôt que
  // laissés à déduire d'un tableau.
  const aTraiter = preparations
    .map((p) => {
      const r = p?.resume || {};
      const nom = p?.chantier?.nom || "Chantier";
      if (r.erreur) return `${nom} — préparation non chargée`;
      if (!r.exploitable) return `${nom} — ${(r.ecran?.titre || "préparation indisponible").toLowerCase()}`;
      const nbAO = entier(r.nbAOrganiser);
      if (nbAO > 0) return `${nom} — ${nbAO} tâche${s2(nbAO)} à organiser`;
      return null;
    })
    .filter(Boolean);

  const listeAction = aTraiter.length === 0
    ? `<div class="op-pc-ok">Tous les logements ont une préparation exploitable et aucune tâche en attente de phase.</div>`
    : `<div class="op-pc-action">
        <div class="op-pc-action-titre">${esc(`${aTraiter.length} logement${s2(aTraiter.length)} à reprendre avant démarrage`)}</div>
        <ul class="op-pc-action-liste">${aTraiter.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
      </div>`;

  return `
  ${sectionTitre("Préparation de l'opération")}
  <div class="op-pc-tuiles">
    ${tuileCompte("Logements", totaux.nbChantiers)}
    ${tuileCompte("Préparés", `${totaux.nbPrepares}/${totaux.nbChantiers}`,
      totaux.nbPrepares === totaux.nbChantiers ? "#1e8e4e" : "#b97a10")}
    ${tuileCompte("Phases", totaux.nbPhases)}
    ${tuileCompte("Ouvrages", totaux.nbOuvrages, "#5b8af5")}
    ${tuileCompte("Tâches", totaux.nbTaches)}
    ${tuileCompte("À organiser", totaux.nbAOrganiser, totaux.nbAOrganiser > 0 ? "#b97a10" : GRIS_DOC)}
  </div>
  ${listeAction}

  <div class="op-pc-detail">
    ${sectionTitre("Préparation par logement")}
    <div class="op-pc-intro">Une synthèse par logement : état de sa préparation et ses phases dans l'ordre réel d'exécution. Les tâches et les matériaux restent dans le dossier propre à chaque chantier.</div>
    ${preparations.map((p, i) => ficheChantier(p, i + 1)).join("")}
  </div>`;
}

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// op     : { nom, adresse, couleur }
// agg    : agrégats de PageOperations (vendu, moReel, mat, fg, marge, margePct,
//          moPrev, matPrev, fgPrev, margePrev, margePrevPct, hVendues,
//          hReelles, avancement, nbChantiers, nbAvecPhasage)
// lignes : [{ nom, couleur, statutLabel, statutColor, b }] — b = brut du
//          chantier (null si sans phasage), dans l'ordre du chemin de fer
// dateGen : date de génération affichée (fraîcheur des chiffres)
// preparations : [{ chantier:{nom,couleur}, statutLabel, statutColor, adresse,
//          planning:{debut,fin}, equipes:[nom], resume }] — resume vient de
//          resumePreparation() (preparationDocCommun.mjs), lui-même alimenté
//          par la RPC ouvrier_preparation_chantier. Omis ⟹ le document reste
//          exactement l'ancienne fiche financière.
// totaux : totauxOperation(resumes) — les totaux de préparation, somme exacte
//          des synthèses. Recalculé ici s'il n'est pas fourni.
export function buildOperationDocHTML({
  op, agg, lignes = [], logoUrl, dateGen, preparations = [], totaux = null,
}) {
  const venduOK = agg.vendu > 0;
  const mCol = venduOK ? margeCouleur(agg.marge, agg.margePct) : "#8a90a0";
  const mPrevCol = venduOK ? margeCouleur(agg.margePrev, agg.margePrevPct) : "#8a90a0";

  // ── Chiffres clés ──
  const tuiles = [
    tuile({ label: "Vendu HT", valeur: venduOK ? eur(agg.vendu) : "—" }),
    tuile({ label: "Avancement", valeur: `${agg.avancement}%`, sous: "pondéré par le vendu HT" }),
    tuile({ label: "Marge prévisionnelle", valeur: venduOK ? eur(agg.margePrev) : "—",
      sous: venduOK ? `${pctTxt(agg.margePrevPct)} au devis` : "", accent: mPrevCol }),
    tuile({ label: "Marge nette à date", valeur: venduOK ? eur(agg.marge) : "—",
      sous: venduOK ? `${pctTxt(agg.margePct)} du vendu` : "", accent: mCol }),
  ].join("");

  // ── Prévisionnel (devis) vs réel à date ──
  const lignePR = (label, prev, reel, { sousPrev = "", sousReel = "", bold = false, cPrev = "", cReel = "" } = {}) => `
    <tr class="${bold ? "op-pr-total" : ""}">
      <td class="op-pr-lib">${esc(label)}</td>
      <td class="op-pr-val" style="${cPrev ? `color:${cPrev};` : ""}">${esc(prev)}${sousPrev ? `<span class="op-pr-sous">${esc(sousPrev)}</span>` : ""}</td>
      <td class="op-pr-val" style="${cReel ? `color:${cReel};` : ""}">${esc(reel)}${sousReel ? `<span class="op-pr-sous">${esc(sousReel)}</span>` : ""}</td>
    </tr>`;
  const debPrev = agg.moPrev + agg.matPrev + (agg.fgPrev || 0);
  const debReel = agg.moReel + agg.mat + agg.fg;
  const tablePR = `
  <table class="op-pr">
    <thead><tr>
      <th></th>
      <th>Prévisionnel (au devis)</th>
      <th>Réel à date</th>
    </tr></thead>
    <tbody>
      ${lignePR("Main-d'œuvre", eur(agg.moPrev), eur(agg.moReel),
        { sousPrev: `${fmtH(agg.hVendues)} h vendues`, sousReel: `${fmtH(agg.hReelles)} h pointées` })}
      ${lignePR("Matériaux", eur(agg.matPrev), eur(agg.mat))}
      ${lignePR("Frais généraux", agg.fgPrev > 0 ? eur(agg.fgPrev) : "—", agg.fg > 0 ? eur(agg.fg) : "—")}
      ${lignePR("Total déboursé", eur(debPrev), eur(debReel), { bold: true })}
      ${lignePR("Marge", venduOK ? eur(agg.margePrev) : "—", venduOK ? eur(agg.marge) : "—",
        { bold: true, cPrev: mPrevCol, cReel: mCol,
          sousPrev: venduOK ? pctTxt(agg.margePrevPct) : "", sousReel: venduOK ? pctTxt(agg.margePct) : "" })}
    </tbody>
  </table>
  <div class="op-note-inline">Le réel est un cliché à ${agg.avancement}% d'avancement — il ne se compare au prévisionnel qu'à la fin de l'opération.</div>`;

  // ── Décomposition du vendu HT (barre) ──
  const baseBarre = Math.max(agg.vendu, debReel);
  const segments = baseBarre > 0 ? [
    { label: "Coût MO",    val: agg.moReel, color: "#f5a623" },
    { label: "Matériaux",  val: agg.mat,    color: "#5b8af5" },
    { label: "Frais gén.", val: agg.fg,     color: "#c084fc" },
    ...(agg.marge > 0 ? [{ label: "Marge", val: agg.marge, color: "#22c55e" }] : []),
  ].filter(s => s.val > 0) : [];
  const barre = segments.length === 0 ? "" : `
  <div class="op-barre-wrap">
    <div class="op-barre">
      ${segments.map(s => `<span style="width:${((s.val / baseBarre) * 100).toFixed(2)}%;background:${s.color};"></span>`).join("")}
    </div>
    <div class="op-barre-leg">
      ${segments.map(s => `<span class="op-leg-item"><span class="op-leg-dot" style="background:${s.color};"></span>${esc(s.label)} · <b>${esc(eur(s.val))}</b></span>`).join("")}
      ${agg.marge < 0 ? `<span class="op-leg-item" style="color:#c0392b;font-weight:700;">Coûts supérieurs au vendu : marge ${esc(eur(agg.marge))}</span>` : ""}
    </div>
  </div>`;

  // ── Détail par logement ──
  const sansPhasage = lignes.filter(l => !l.b).length;
  const rowsHTML = lignes.map(l => {
    const b = l.b;
    const mc = b && b.prixHTChantier > 0 ? margeCouleur(b.margeChantier, b.margePctChantier) : "#8a90a0";
    const mcPrev = b && b.prixHTChantier > 0 ? margeCouleur(b.margePrevChantier, b.margePrevPctChantier) : "#8a90a0";
    return `
    <tr>
      <td class="op-log-nom"><span class="op-log-dot" style="background:${esc(l.couleur || "#888")};"></span>${esc(l.nom)}</td>
      <td><span class="op-statut" style="color:${esc(l.statutColor)};border-color:${esc(l.statutColor)};">${esc(l.statutLabel)}</span></td>
      ${!b
        ? `<td colspan="8" class="op-log-vide">Sans phasage — hors chiffres</td>`
        : `<td class="num"><b>${b.avancementChantier}%</b></td>
           <td class="num">${b.prixHTChantier > 0 ? esc(eur(b.prixHTChantier)) : "—"}</td>
           <td class="num">${esc(eur(b.coutMOTotalChantier))}</td>
           <td class="num">${esc(eur(b.coutMatChantier))}</td>
           <td class="num" style="color:${mcPrev};">${b.prixHTChantier > 0 ? esc(eur(b.margePrevChantier)) : "—"}</td>
           <td class="num" style="color:${mc};font-weight:700;">${b.prixHTChantier > 0 ? esc(eur(b.margeChantier)) : "—"}</td>
           <td class="num" style="color:${mc};">${b.prixHTChantier > 0 ? esc(pctTxt(b.margePctChantier)) : "—"}</td>
           <td class="num">${fmtH(b.heuresReellesTotalChantier)}h / ${fmtH(b.heuresVenduesChantier)}h</td>`}
    </tr>`;
  }).join("");
  const tableLogements = `
  <table class="op-log">
    <thead><tr>
      <th style="text-align:left;">Logement</th>
      <th style="text-align:left;">Statut</th>
      <th>Avanc.</th><th>Vendu HT</th><th>Coût MO</th><th>Matériaux</th><th>Marge prév.</th><th>Marge</th><th>Marge %</th><th>Heures</th>
    </tr></thead>
    <tbody>
      ${rowsHTML}
      <tr class="op-log-total">
        <td class="op-log-nom">Total opération</td>
        <td></td>
        <td class="num">${agg.avancement}%</td>
        <td class="num">${venduOK ? esc(eur(agg.vendu)) : "—"}</td>
        <td class="num">${esc(eur(agg.moReel))}</td>
        <td class="num">${esc(eur(agg.mat))}</td>
        <td class="num" style="color:${mPrevCol};">${venduOK ? esc(eur(agg.margePrev)) : "—"}</td>
        <td class="num" style="color:${mCol};">${venduOK ? esc(eur(agg.marge)) : "—"}</td>
        <td class="num" style="color:${mCol};">${venduOK ? esc(pctTxt(agg.margePct)) : "—"}</td>
        <td class="num">${fmtH(agg.hReelles)}h / ${fmtH(agg.hVendues)}h</td>
      </tr>
    </tbody>
  </table>`;

  const cssExtra = `
  /* ── Fiche opération ── */
  .op-tuiles{display:flex;gap:8pt;margin-top:2pt;break-inside:avoid;page-break-inside:avoid;}
  .op-tuile{flex:1;border:1pt solid #e9ebf0;border-radius:10pt;padding:9pt 12pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .op-tuile-label{font-size:7pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:#8a90a0;}
  .op-tuile-val{font-size:16pt;font-weight:800;line-height:1.1;margin-top:3pt;letter-spacing:.2pt;}
  .op-tuile-sous{font-size:7.5pt;color:#8a90a0;margin-top:2pt;}

  .op-pr{width:100%;border-collapse:collapse;break-inside:avoid;page-break-inside:avoid;}
  .op-pr th{font-size:7.5pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:#8a90a0;text-align:right;padding:5pt 10pt;border-bottom:1.5pt solid #e9ebf0;}
  .op-pr th:first-child{text-align:left;}
  .op-pr td{padding:6pt 10pt;border-bottom:1pt solid #eef0f4;font-size:9.5pt;}
  .op-pr-lib{font-weight:600;color:#2a2f3a;}
  .op-pr-val{text-align:right;font-weight:600;color:#2a2f3a;white-space:nowrap;}
  .op-pr-sous{display:block;font-size:7.5pt;font-weight:500;color:#9aa0ab;}
  .op-pr-total td{font-weight:800;color:#12151c;border-top:1.5pt solid #d8dbe2;background:#fafbfd;}
  .op-note-inline{margin-top:5pt;font-size:8pt;font-style:italic;color:#9aa0ab;}

  .op-barre-wrap{margin-top:10pt;break-inside:avoid;page-break-inside:avoid;}
  .op-barre{display:flex;height:11pt;border-radius:6pt;overflow:hidden;background:#eef0f4;}
  .op-barre span{display:block;height:100%;}
  .op-barre-leg{display:flex;flex-wrap:wrap;gap:3pt 14pt;margin-top:5pt;}
  .op-leg-item{display:inline-flex;align-items:center;gap:4pt;font-size:8pt;color:#4a4f5b;}
  .op-leg-item b{color:#12151c;}
  .op-leg-dot{width:7pt;height:7pt;border-radius:2.5pt;display:inline-block;}

  .op-log{width:100%;border-collapse:collapse;}
  .op-log th{font-size:7pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:#8a90a0;text-align:right;padding:4pt 7pt;border-bottom:1.5pt solid #e9ebf0;white-space:nowrap;}
  .op-log td{padding:5pt 7pt;border-bottom:1pt solid #eef0f4;font-size:8.5pt;color:#2a2f3a;}
  .op-log td.num{text-align:right;white-space:nowrap;}
  .op-log tr{break-inside:avoid;page-break-inside:avoid;}
  .op-log-nom{font-weight:700;color:#12151c;white-space:nowrap;}
  .op-log-dot{width:7pt;height:7pt;border-radius:2.5pt;display:inline-block;margin-right:5pt;vertical-align:-.5pt;}
  .op-statut{display:inline-block;padding:1.5pt 8pt;border-radius:99pt;border:1pt solid;font-size:7pt;font-weight:700;letter-spacing:.4pt;text-transform:uppercase;white-space:nowrap;}
  .op-log-vide{font-style:italic;color:#9aa0ab;}
  .op-log-total td{font-weight:800;color:#12151c;border-top:1.5pt solid #d8dbe2;background:#fafbfd;}

  /* ── Préparation de l'opération ── */
  /* Pied de page répété (Chrome/Edge ; ignoré ailleurs, dégradation propre).
     Ce bloc @page fusionne avec celui de docClientHTML (bornes + format A4).
     Il n'est ajouté qu'à CE document — pas aux autres gabarits Profero. */
  @page{
    @bottom-left  { content:"${escCssDoc(op?.nom || "Opération")}"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-center{ content:"Dossier d'opération — usage interne"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-right { content:"Page " counter(page) " / " counter(pages); font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
  }

  .op-pc-tuiles{display:flex;gap:7pt;margin-top:2pt;break-inside:avoid;page-break-inside:avoid;}
  .op-pc-tuile{flex:1;border:1pt solid #e9ebf0;border-radius:9pt;padding:7pt 10pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .op-pc-tuile-label{font-size:6.5pt;font-weight:800;letter-spacing:.9pt;text-transform:uppercase;color:${GRIS_DOC};white-space:nowrap;}
  .op-pc-tuile-val{font-size:15pt;font-weight:800;line-height:1.05;margin-top:2pt;}
  .op-pc-tuiles-ch{margin-top:7pt;}
  .op-pc-tuiles-ch .op-pc-tuile{padding:5pt 9pt;border-radius:7pt;box-shadow:none;background:#fafbfd;}
  .op-pc-tuiles-ch .op-pc-tuile-val{font-size:12.5pt;}

  .op-pc-ok{margin-top:9pt;padding:7pt 12pt;border-radius:8pt;background:#eefbf3;border:1pt solid #9fd9b4;
    font-size:8.5pt;font-weight:700;color:#1e8e4e;break-inside:avoid;page-break-inside:avoid;}
  .op-pc-action{margin-top:9pt;padding:8pt 13pt 6pt;border-radius:9pt;background:#fff8e0;border:1pt solid #f2e2ad;
    break-inside:avoid;page-break-inside:avoid;}
  .op-pc-action-titre{font-size:8pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:#8a6d00;}
  .op-pc-action-liste{margin:4pt 0 0;padding-left:14pt;}
  .op-pc-action-liste li{font-size:9pt;color:#57534a;line-height:1.5;break-inside:avoid;page-break-inside:avoid;}
  /* AUCUNE coupure forcée ici. Un saut de page avant le détail laissait la
     synthèse seule sur une page remplie à 22 % (mesuré sur la fixture à cinq
     logements). Le document s'enchaîne donc naturellement : une fiche de
     logement démarre en milieu de page dès qu'il reste la place de son
     en-tête, et les titres de section ne restent pas orphelins grâce aux
     règles break-after:avoid ci-dessous. */
  .op-pc-detail{padding-top:2pt;}
  .op-pc-intro{font-size:8.5pt;color:${GRIS_DOC};margin:-4pt 0 10pt;}

  /* Une fiche de chantier n'est PAS insécable : avec dix phases elle dépasse
     la page. Seul son en-tête (bandeau + compteurs) reste solidaire de ce qui
     suit, et les lignes de phase ne se coupent jamais. Elle peut donc démarrer
     en milieu de page, sans créer de blanc. */
  .op-ch{margin-top:14pt;}
  .op-ch-head{break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;break-after:avoid;}
  .op-ch-band{display:flex;align-items:center;gap:9pt;padding:7pt 12pt;border-left:4pt solid ${GRIS_DOC};
    background:#f6f7f9;border-radius:0 8pt 8pt 0;}
  .op-ch-rang{font-size:15pt;font-weight:800;color:#c8ccd4;line-height:1;flex:0 0 auto;}
  .op-ch-txt{flex:1;min-width:0;}
  .op-ch-nom{display:block;font-size:13pt;font-weight:800;letter-spacing:.9pt;text-transform:uppercase;color:#12151c;line-height:1.1;}
  .op-ch-meta{display:block;font-size:8pt;color:${GRIS_DOC};margin-top:1.5pt;}
  .op-ch-statut,.op-ch-etat{flex:0 0 auto;display:inline-block;padding:1.5pt 8pt;border-radius:99pt;border:1pt solid;
    font-size:6.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;white-space:nowrap;}

  .op-ph{width:100%;border-collapse:collapse;margin-top:7pt;}
  .op-ph th{font-size:6.5pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:${GRIS_DOC};
    text-align:right;padding:3pt 6pt;border-bottom:1pt solid #e9ebf0;white-space:nowrap;}
  .op-ph td{padding:4pt 6pt;border-bottom:1pt solid #f2f4f7;font-size:9pt;color:#2a2f3a;vertical-align:middle;}
  .op-ph-row{break-inside:avoid;page-break-inside:avoid;}
  .op-ph-rang{width:18pt;font-weight:800;color:#c8ccd4;}
  .op-ph-pastille{width:14pt;}
  .op-ph-dot{width:8pt;height:8pt;border-radius:2.5pt;display:inline-block;}
  .op-ph-nom{font-weight:700;color:#12151c;}
  .op-ph-flag{display:inline-block;margin-left:7pt;padding:1pt 7pt;border-radius:99pt;border:1pt solid #e4c98a;
    background:#fff8e0;color:#b97a10;font-size:6pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;}
  .op-ph-num{width:62pt;text-align:right;white-space:nowrap;color:#4a4f5b;}

  .op-ch-note{margin-top:5pt;font-size:8pt;font-weight:700;color:#b97a10;}
  .op-ch-renvoi{margin-top:5pt;font-size:7.5pt;font-style:italic;color:#9aa0ab;line-height:1.45;}
  .op-ch-alerte{margin-top:7pt;padding:8pt 12pt;border-radius:9pt;background:#fff8e0;border:1pt solid #f2e2ad;
    break-inside:avoid;page-break-inside:avoid;}
  .op-ch-alerte-rouge{background:#fdeceb;border-color:#f3c9c4;}
  .op-ch-alerte-titre{font-size:9.5pt;font-weight:800;color:#8a6d00;}
  .op-ch-alerte-rouge .op-ch-alerte-titre{color:#c0392b;}
  .op-ch-alerte-texte{font-size:9pt;color:#57534a;line-height:1.5;margin-top:2pt;}`;

  // ── Préparation (nouvelle partie du dossier) ──
  // Les totaux affichés dans le héros et dans la synthèse sont les MÊMES
  // objets : impossible qu'ils se contredisent.
  const prep = Array.isArray(preparations) ? preparations : [];
  const tot = totaux || totauxOperation(prep.map(p => p?.resume || {}));
  const blocPreparation = sectionPreparation(prep, tot);

  const corps = `
  ${sectionTitre("Chiffres clés")}
  <div class="op-tuiles">${tuiles}</div>

  ${sectionTitre("Prévisionnel vs réel")}
  ${tablePR}
  ${barre}

  ${sectionTitre("Détail par logement")}
  ${tableLogements}
  ${sansPhasage > 0 ? `<div class="op-note-inline">${sansPhasage} logement${sansPhasage > 1 ? "s" : ""} sans phasage : affiché${sansPhasage > 1 ? "s" : ""} dans le tableau mais hors totaux.</div>` : ""}

  <div style="margin-top:14pt;padding:8pt 12pt;background:#f6f7f9;border-radius:8pt;font-size:8.5pt;font-style:italic;color:#8a90a0;line-height:1.55;">
    Chiffres calculés le ${esc(dateGen)} par le même module que la fiche chantier (pointages, lignes de commande et devis à cette date). Document interne : contient les marges — ne pas diffuser au client.
  </div>

  ${blocPreparation}`;

  // Badge héros : la marge nette, l'information que ce document vient chercher.
  const badgeHTML = venduOK ? `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Marge nette à date</div>
          <div class="bc" style="font-size:18pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${esc(eur(agg.marge))}</div>
          <div style="font-size:7.5pt;font-weight:700;color:rgba(0,0,0,.55);margin-top:1pt;">${esc(pctTxt(agg.margePct))} du vendu</div>
        </div>
      </td>` : "";

  // Chips du héros : les repères de l'opération, puis les indicateurs de
  // préparation. Chacun n'apparaît que si la donnée existe réellement — pas de
  // « undefined logements » ni de compteur inventé quand rien n'a été chargé.
  const chips = [
    `${agg.nbChantiers} logement${agg.nbChantiers > 1 ? "s" : ""}`,
    `Avancement ${agg.avancement}%`,
    ...(prep.length > 0 ? [
      `${tot.nbPrepares}/${tot.nbChantiers} préparé${tot.nbPrepares > 1 ? "s" : ""}`,
      `${tot.nbPhases} phase${s2(tot.nbPhases)}`,
      `${tot.nbOuvrages} ouvrage${s2(tot.nbOuvrages)}`,
      `${tot.nbTaches} tâche${s2(tot.nbTaches)}`,
      tot.nbAOrganiser > 0 ? `${tot.nbAOrganiser} à organiser` : "Aucune tâche à organiser",
    ] : []),
    "Usage interne",
    dateGen ? `Généré le ${dateGen}` : "",
  ].filter(Boolean);

  return docClientHTML({
    titreDoc: `Dossier operation ${op.nom}`,
    eyebrow: "Dossier d'opération",
    titre: op.nom,
    sousTitre: (op.adresse || "").trim(),
    chips,
    badgeHTML,
    logoUrl,
    corps,
    cssExtra,
  });
}
