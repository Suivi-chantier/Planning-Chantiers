// preparationChantierDoc — gabarit PDF « Préparation de chantier » (support
// PAPIER pour l'équipe, imprimé en plusieurs exemplaires).
//
// C'est la version imprimable de l'écran « Préparation du chantier » de
// l'espace ouvrier : la MÊME hiérarchie, les MÊMES règles d'affichage.
//
//   Chantier → phases (ordre réel) → ouvrages → tâches de la phase
//   puis, UNE SEULE FOIS, les matériaux regroupés par ouvrage
//
// ⚠ DOCUMENT COMPACT — c'est une contrainte, pas une préférence.
//   La première version rendait 35 pages sur FOURMOND 001 (mesuré), à
//   imprimer en trois exemplaires. Deux causes, dans cet ordre :
//     1. les matériaux étaient réimprimés à CHAQUE apparition de l'ouvrage.
//        17 ouvrages portent 123 liens matériaux, mais les ouvrages
//        apparaissent 31 fois (12 d'entre eux couvrent plusieurs phases) :
//        299 lignes imprimées pour 123 réelles, soit 176 lignes en double
//        et 9 pages (35 → 26 mesuré).
//     2. les zones de notes : trois lignes après chaque phase, plus une page
//        finale de douze lignes (26 → 23 mesuré).
//   Le reste venait des grandes cartes à bordure, ombre et sous-titres.
//   D'où : matériaux consolidés en fin de document, une seule zone de notes,
//   et un déroulé en listes denses plutôt qu'en cartes.
//   ⚠ Ne jamais réintroduire les matériaux dans le déroulé des phases.
//
// ⚠ AUCUNE DONNÉE FINANCIÈRE NE DOIT APPARAÎTRE ICI.
//   Ni prix, ni coût, ni marge, ni facturation, ni heures vendues, ni QCD.
//   La RPC ouvrier_preparation_chantier n'en renvoie déjà pas ; ce module
//   ajoute un second verrou en ne lisant QUE des champs nommés un par un —
//   jamais `{...ouvrage}`, jamais une boucle sur Object.keys d'un objet reçu.
//   scripts/verif-preparation-chantier-doc.mjs le vérifie sur un payload
//   volontairement pollué de champs financiers.
//
// AUCUN CALCUL, AUCUN ACCÈS RÉSEAU : les données arrivent déjà chargées et
// les décisions d'affichage (phases visibles, état d'une tâche, quantité
// lisible, écran de modèle) viennent toutes du module pur
// preparationChantier.mjs — celui que l'écran ouvrier utilise.
//
// L'enveloppe graphique (héros sombre à halos, logo, Barlow, pied
// « Document confidentiel ») est celle de tous les documents Profero :
// docClientHTML de previsionnelDoc.js, non modifié.
import { docClientHTML, sectionTitre } from "./previsionnelDoc.js";
import {
  compterTaches, etatTache, avancementAffichable, formaterQuantite,
  ecranModele, PHASE_A_ORGANISER,
} from "./preparationChantier.mjs";
// Échappement (HTML et chaîne CSS) et ordre réel des phases : partagés avec le
// dossier d'OPÉRATION (operationDoc.js). Deux implémentations divergentes
// seraient un bug — une faille pour l'échappement, un contresens métier pour
// l'ordre des phases.
import { escDoc, escCssDoc, phasesOrdonnees } from "./preparationDocCommun.mjs";

const OR    = "#FFC200"; // jaune marque Profero
const ENCRE = "#12151c";
const GRIS  = "#8a90a0";
const BLEU  = "#5b8af5";
const ROUGE = "#c0392b";

// Alias locaux : l'implémentation vit dans preparationDocCommun.mjs, partagée
// avec le dossier d'opération.
const esc = escDoc;
const escCss = escCssDoc;

const s  = (n) => (n > 1 ? "s" : "");
const sx = (n) => (n > 1 ? "x" : "");

// Mention OBLIGATOIRE de la portée des matériaux, en tête de LA section
// consolidée. Un ouvrage qui traverse plusieurs phases n'a qu'un seul jeu de
// matériaux : ils ne se commandent qu'une fois. La phrase n'a plus besoin
// d'être répétée trente fois — elle porte désormais toute la section.
export const MENTION_PORTEE_MATERIAUX =
  "Quantités prévues pour l'ensemble de l'ouvrage, tous passages confondus — un ouvrage qui revient dans plusieurs phases ne se commande qu'une fois. Les ouvrages sont repérés par le début de leur descriptif ; le descriptif complet est au déroulé des travaux.";

// Renvoi du déroulé vers la section consolidée.
const RENVOI_MATERIAUX = "Les matériaux sont regroupés par ouvrage en fin de document.";

// Case à cocher au stylo. Purement décorative : rien n'est coché à
// l'impression, même une tâche terminée — l'état est déjà dit par sa pastille,
// et une case pré-cochée empêcherait le pointage papier.
const CASE = '<span class="pc-case"></span>';

// ─── CLÉ D'UN OUVRAGE ────────────────────────────────────────────────────────
// Sert à ne lister ses matériaux QU'UNE FOIS, même s'il traverse cinq phases.
//   • id présent  → c'est l'identifiant stable du phasage, on s'y tient.
//   • id absent   → on ne se contente PAS du libellé : deux ouvrages distincts
//     peuvent porter le même nom. On ajoute le code ET la signature de la
//     liste de matériaux, ce qui garantit qu'aucun matériau ne disparaît :
//     au pire deux groupes identiques restent séparés, jamais fusionnés à tort.
function cleOuvrage(o) {
  const id = (o?.id ?? "").toString().trim();
  if (id) return `id:${id}`;
  const sig = (Array.isArray(o?.materiaux) ? o.materiaux : [])
    .map(m => `${m?.materiau_id ?? ""}|${m?.quantite_totale ?? ""}|${m?.quantite_par_unite ?? ""}`)
    .join(";");
  return `x:${(o?.code_ouvrage ?? "").toString()}|${(o?.libelle ?? "").toString()}|${sig}`;
}

// Repère court d'un ouvrage pour l'INDEX des matériaux. Les descriptifs de
// devis font en moyenne 319 caractères (778 au maximum sur FOURMOND 001) :
// les réimprimer en entier dans l'index coûte une page complète alors que le
// descriptif intégral figure au déroulé, quelques pages plus haut. On coupe
// donc sur un mot, avec une ellipse VISIBLE, et la section l'annonce — rien
// n'est tronqué en silence, et aucune donnée n'est perdue.
const LONGUEUR_REPERE = 110;
function repere(libelle) {
  const txt = (libelle || "(sans nom)").toString().replace(/\s+/g, " ").trim();
  if (txt.length <= LONGUEUR_REPERE) return txt;
  const coupe = txt.slice(0, LONGUEUR_REPERE);
  const espace = coupe.lastIndexOf(" ");
  return `${(espace > 60 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}

// Identité imprimée d'un ouvrage : code, libellé, quantité + unité.
// `court` : index des matériaux uniquement. Au déroulé, le libellé est
// INTÉGRAL — aucun clamp, aucune ellipse, retour à la ligne libre.
function identiteOuvrage(o, { court = false } = {}) {
  const q = formaterQuantite(o?.quantite);
  const unite = (o?.unite || "").toString().trim();
  const qte = q === null ? "" : `${q}${unite ? ` ${unite}` : ""}`;
  const libelle = court ? repere(o?.libelle) : (o?.libelle || "(sans nom)");
  return `
    <div class="pc-ouv-tete">
      <div class="pc-ouv-lib">
        ${o?.code_ouvrage ? `<span class="pc-ouv-code">${esc(o.code_ouvrage)}</span>` : ""}
        ${esc(libelle)}
      </div>
      ${qte ? `<div class="pc-ouv-qte bc">${esc(qte)}</div>` : ""}
    </div>`;
}

// ─── DÉROULÉ : UNE TÂCHE ─────────────────────────────────────────────────────
// Ligne dense : case à cocher, rang, nom complet (retour à la ligne autorisé),
// avancement UNIQUEMENT s'il apporte une information (strictement entre 0 et
// 100 — la règle avancementAffichable, partagée avec l'écran ouvrier).
function ligneTache(t, position) {
  const pct = avancementAffichable(t);
  const e = etatTache(t);
  return `
  <tr class="pc-l">
    <td class="pc-c-case">${CASE}</td>
    <td class="pc-c-rang bc">${String(position).padStart(2, "0")}</td>
    <td class="pc-c-nom">${esc(t?.nom || "(sans nom)")}</td>
    <td class="pc-c-pct">${pct === null ? "" : `${pct} %`}${
      e.cle === "terminee" ? `<span class="pc-fait">faite</span>` : ""}</td>
  </tr>`;
}

// ─── DÉROULÉ : UN OUVRAGE DANS UNE PHASE ─────────────────────────────────────
// Ses tâches de CETTE phase seulement. Plus de matériaux ici : ils sont
// consolidés en fin de document.
function blocOuvrage(o) {
  const taches = Array.isArray(o?.taches) ? o.taches : [];
  return `
  <div class="pc-ouv">
    ${identiteOuvrage(o)}
    ${taches.length === 0
      ? `<div class="pc-vide">Aucune tâche prévue pour cet ouvrage dans cette phase.</div>`
      : `<table class="pc-t">${taches.map((t, i) => ligneTache(t, i + 1)).join("")}</table>`}
  </div>`;
}

// ─── DÉROULÉ : UNE PHASE ─────────────────────────────────────────────────────
// Bandeau minimal : rang, couleur, nom. Les compteurs ne sont PAS répétés ici,
// ils sont déjà dans la synthèse de tête.
function blocPhase(phase, index) {
  const ouvrages = Array.isArray(phase?.ouvrages) ? phase.ouvrages : [];
  const couleur = (phase?.couleur || GRIS).toString();
  const synthetique = phase?.synthetique === true || phase?.id === PHASE_A_ORGANISER;
  return `
  <div class="pc-ph">
    <div class="pc-ph-band" style="border-left-color:${esc(couleur)};">
      <span class="pc-ph-num bc">${String(index).padStart(2, "0")}</span>
      <span class="pc-ph-nom bc">${esc(phase?.nom || "Phase")}</span>
      ${synthetique ? `<span class="pc-ph-flag">Hors planning — à caler avec le conducteur</span>` : ""}
    </div>
    ${ouvrages.map(blocOuvrage).join("")}
  </div>`;
}

// ─── MATÉRIAUX : UNE LIGNE ───────────────────────────────────────────────────
// La quantité par unité d'ouvrage n'est plus affichée systématiquement : elle
// n'apporte rien quand le total est connu. Elle réapparaît uniquement quand le
// total manque — c'est alors la seule information exploitable pour commander.
function ligneMateriau(m) {
  const total = formaterQuantite(m?.quantite_totale);
  const parU  = formaterQuantite(m?.quantite_par_unite);
  const unite = (m?.unite || "").toString().trim();
  const introuvable = m?.introuvable === true;
  const details = [
    m?.reference   ? `Réf. ${m.reference}` : null,
    m?.fournisseur ? String(m.fournisseur) : null,
  ].filter(Boolean).join(" · ");

  // Référence et fournisseur ont leur PROPRE colonne : en sous-ligne sous le
  // nom, chaque matériau occupait deux lignes — 123 lignes doublées, près de
  // deux pages sur FOURMOND 001 (mesuré).
  return `
  <tr class="pc-l${introuvable ? " pc-l-alerte" : ""}">
    <td class="pc-c-case">${CASE}</td>
    <td class="pc-c-mat"><span class="pc-mat-nom">${esc(introuvable ? "Matériau introuvable" : (m?.nom || "(sans nom)"))}</span></td>
    <td class="pc-c-ref">${introuvable
      ? `<span class="pc-mat-alerte">retiré de la bibliothèque — à confirmer</span>`
      : (details ? esc(details) : "")}</td>
    <td class="pc-c-qte">
      ${total === null
        ? `<span class="pc-qte-nd">Quantité à définir</span>${
            parU === null ? "" : `<span class="pc-qte-sous">${esc(`${parU}${unite ? ` ${unite}` : ""}`)} par unité d'ouvrage</span>`}`
        : `<span class="pc-qte bc">${esc(`${total}${unite ? ` ${unite}` : ""}`)}</span>`}
    </td>
    <td class="pc-c-cmd">${m?.commande_le ? `<span class="pc-cmd">Commandé</span>` : ""}</td>
  </tr>`;
}

// ─── MATÉRIAUX : LA SECTION CONSOLIDÉE ───────────────────────────────────────
// Un ouvrage = un bloc, dans l'ordre de sa PREMIÈRE apparition au déroulé.
// Aucune quantité n'est additionnée, aucune ligne n'est fusionnée : ce que la
// RPC renvoie pour l'ouvrage est imprimé tel quel, une seule fois.
function sectionMateriaux(phases) {
  const vus = new Set();
  const blocs = [];
  phases.forEach((ph) => {
    (ph?.ouvrages || []).forEach((o) => {
      const cle = cleOuvrage(o);
      if (vus.has(cle)) return;
      vus.add(cle);
      blocs.push(o);
    });
  });
  const avecMateriaux = blocs.filter(o => (o?.materiaux || []).length > 0);
  const sansMateriaux = blocs.filter(o => (o?.materiaux || []).length === 0);

  if (avecMateriaux.length === 0) {
    return `
    ${sectionTitre("Matériaux prévus")}
    <div class="pc-vide-section">Aucun matériau n'est rattaché aux ouvrages de ce chantier.</div>`;
  }

  const corps = avecMateriaux.map((o) => `
    <div class="pc-mat-bloc">
      ${identiteOuvrage(o, { court: true })}
      <table class="pc-t">${(o.materiaux || []).map(ligneMateriau).join("")}</table>
    </div>`).join("");

  return `
  ${sectionTitre("Matériaux prévus")}
  <div class="pc-portee">${esc(MENTION_PORTEE_MATERIAUX)}</div>
  ${corps}
  ${sansMateriaux.length > 0
    ? `<div class="pc-note">${esc(`${sansMateriaux.length} ouvrage${s(sansMateriaux.length)} sans matériau prévu : ${
        sansMateriaux.map(o => (o.code_ouvrage || repere(o.libelle) || "")).filter(Boolean).join(" · ")}`)}</div>`
    : ""}`;
}

// ─── SYNTHÈSE DE TÊTE ────────────────────────────────────────────────────────
// Les compteurs par phase vivent ICI, une seule fois — les bandeaux du déroulé
// ne les répètent pas.
function synthesePhases(phases) {
  if (phases.length === 0) return "";
  const lignes = phases.map((p, i) => {
    const nbO = (p?.ouvrages || []).length;
    const nbT = compterTaches(p).total;
    const synthetique = p?.synthetique === true || p?.id === PHASE_A_ORGANISER;
    return `
    <tr class="pc-l">
      <td class="pc-c-rang bc">${String(i + 1).padStart(2, "0")}</td>
      <td class="pc-c-dot"><span class="pc-dot" style="background:${esc((p?.couleur || GRIS).toString())};"></span></td>
      <td class="pc-c-nom">${esc(p?.nom || "Phase")}${
        synthetique ? `<span class="pc-tag">hors planning</span>` : ""}</td>
      <td class="pc-c-n">${esc(`${nbO} ouvrage${s(nbO)}`)}</td>
      <td class="pc-c-n">${esc(`${nbT} tâche${s(nbT)}`)}</td>
    </tr>`;
  }).join("");
  return `<table class="pc-t pc-synth">${lignes}</table>`;
}

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// payload      : réponse BRUTE de la RPC ouvrier_preparation_chantier
// chantierNom  : nom affiché (repli sur payload.chantier_nom)
// operationNom : opération de rattachement, "" si le chantier n'en a pas
// adresse      : adresse du chantier (planning_config/chantier_adresses), ""
// dateGen      : date de génération, déjà formatée par l'appelant
export function buildPreparationDocHTML({
  payload = null, chantierNom = "", operationNom = "", adresse = "", logoUrl = "", dateGen = "",
} = {}) {
  const nom     = (chantierNom || payload?.chantier_nom || "Chantier").toString();
  const ecran   = ecranModele(payload);          // null = préparation affichable
  const phases  = ecran ? [] : phasesOrdonnees(payload);
  const compteurs = payload?.compteurs || {};
  const nb = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const nbOuvrages   = ecran ? 0 : nb(compteurs.ouvrages_uniques);
  const nbTaches     = ecran ? 0 : nb(compteurs.taches);
  const nbAOrganiser = ecran ? 0 : nb(compteurs.taches_a_organiser);

  // ── Avertissement quand la préparation n'est pas exploitable ──
  // Les quatre états (absent / vide / legacy_v1 / ambigu) ont chacun leur
  // message : aucun ne tombe dans un cas par défaut silencieux, et le
  // document n'est JAMAIS généré vide sans explication.
  const avertissement = !ecran ? "" : `
  <div class="pc-alerte${ecran.ton === "alerte" ? " pc-alerte-rouge" : ""}">
    <div class="pc-alerte-titre">${esc(ecran.titre)}</div>
    <div class="pc-alerte-texte">${esc(ecran.texte)}</div>
  </div>`;

  const alerteAOrganiser = nbAOrganiser > 0 ? `
  <div class="pc-note pc-note-attention">${esc(
    `${nbAOrganiser} tâche${s(nbAOrganiser)} n'${nbAOrganiser > 1 ? "ont" : "a"} pas encore de phase : regroupée${s(nbAOrganiser)} dans « À organiser », en fin de déroulé.`)}</div>` : "";

  const corps = ecran ? `
  ${sectionTitre("Préparation du chantier")}
  ${avertissement}` : `
  ${sectionTitre("Phases du chantier")}
  ${phases.length === 0
    ? `<div class="pc-vide-section">Aucune phase à afficher : les phases déclarées ne contiennent encore aucun ouvrage.</div>`
    : `${synthesePhases(phases)}${alerteAOrganiser}`}

  ${phases.length === 0 ? "" : `
  ${sectionTitre("Déroulé des travaux")}
  <div class="pc-intro">Phases dans l'ordre réel d'exécution. Une case par tâche, à cocher sur le chantier. ${esc(RENVOI_MATERIAUX)}</div>
  ${phases.map((p, i) => blocPhase(p, i + 1)).join("")}

  ${sectionMateriaux(phases)}`}`;

  const zoneNotes = `
  <div class="pc-notes">
    <div class="pc-notes-titre">Observations et points à vérifier</div>
    ${Array.from({ length: 6 }, () => '<div class="pc-notes-l"></div>').join("")}
  </div>`;

  const cssExtra = `
  /* ── Dossier de préparation (compact) ── */
  /* Pied de page répété (Chrome/Edge ; ignoré ailleurs, dégradation propre).
     Ce bloc @page fusionne avec celui de docClientHTML (bornes + format A4). */
  @page{
    @bottom-left  { content:"${escCss(nom)}"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-center{ content:"Préparation de chantier"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-right { content:"Page " counter(page) " / " counter(pages); font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
  }

  /* ── Héros ramené à l'essentiel ──
     docClientHTML pose le héros en styles INLINE sur le premier enfant de
     .page : on le resserre ici par surcharge locale, sans toucher au module
     partagé (les autres documents Profero gardent leur héros pleine taille).
     Si sa structure changeait, la surcharge cesserait simplement de
     s'appliquer — le document resterait correct, juste plus haut. */
  .page > div:first-child{ padding:10pt 14pt 11pt !important; border-radius:10pt !important; }
  .page > div:first-child img{ height:17pt !important; }
  .page > div:first-child table{ margin-top:9pt !important; }
  .page > div:first-child .bc{ font-size:19pt !important; }
  .chip{ padding:2pt 8pt; font-size:7.5pt; }

  /* Titres de section resserrés (sectionTitre pose 20pt d'écart vertical). */
  .page > div[style*="display:flex"][style*="margin:20pt"]{ margin:12pt 0 6pt !important; }

  .pc-intro{ font-size:8pt; color:${GRIS}; margin:0 0 6pt; }
  .pc-note{ margin-top:5pt; font-size:8pt; font-style:italic; color:#9aa0ab; line-height:1.4; }
  .pc-note-attention{ font-style:normal; font-weight:700; color:#b97a10; }

  .pc-alerte{ margin-top:8pt; padding:9pt 12pt; border-radius:8pt; background:#fff8e0; border:1pt solid #f2e2ad;
    break-inside:avoid; page-break-inside:avoid; }
  .pc-alerte-rouge{ background:#fdeceb; border-color:#f3c9c4; }
  .pc-alerte-titre{ font-size:10pt; font-weight:800; color:#8a6d00; }
  .pc-alerte-rouge .pc-alerte-titre{ color:${ROUGE}; }
  .pc-alerte-texte{ font-size:9pt; color:#57534a; line-height:1.45; margin-top:2pt; }
  .pc-vide-section{ padding:12pt; text-align:center; font-size:9pt; font-style:italic; color:#9aa0ab;
    border:1pt dashed #e9ebf0; border-radius:8pt; }

  /* ── Tables denses : un seul jeu de règles pour la synthèse, les tâches
       et les matériaux. Pas de bordure de bloc, pas d'ombre, pas de rayon :
       c'est ce qui coûtait des pages entières. ── */
  .pc-t{ width:100%; border-collapse:collapse; }
  .pc-t td{ padding:1.7pt 4pt; border-bottom:.75pt solid #eef0f4; font-size:9pt; color:#2a2f3a;
    line-height:1.3; vertical-align:top; }
  /* Unité atomique protégée : une ligne ne se coupe jamais en deux pages. */
  .pc-l{ break-inside:avoid; page-break-inside:avoid; }
  .pc-l-alerte td{ background:#fdf6f5; }
  .pc-synth td{ padding:2.2pt 4pt; }

  .pc-case{ display:inline-block; width:8.5pt; height:8.5pt; border:.75pt solid #aeb4bf; border-radius:1.5pt;
    background:#fff; vertical-align:-1pt; }
  .pc-c-case{ width:15pt; }
  .pc-c-rang{ width:16pt; font-size:8.5pt; font-weight:800; color:#c2c7d0; }
  .pc-c-dot{ width:12pt; }
  .pc-dot{ display:inline-block; width:7pt; height:7pt; border-radius:2pt; vertical-align:-.5pt; }
  .pc-c-nom{ font-weight:600; }
  .pc-c-n{ width:58pt; text-align:right; white-space:nowrap; color:#6b7280; font-size:8.5pt; }
  .pc-c-pct{ width:40pt; text-align:right; white-space:nowrap; font-size:8pt; font-weight:700; color:${GRIS}; }
  .pc-fait{ display:block; font-size:7pt; font-weight:800; letter-spacing:.3pt; text-transform:uppercase; color:#1e8e4e; }
  .pc-tag{ margin-left:6pt; padding:.5pt 6pt; border-radius:99pt; border:.75pt solid #e4c98a; background:#fff8e0;
    color:#b97a10; font-size:6.5pt; font-weight:800; letter-spacing:.3pt; text-transform:uppercase; white-space:nowrap; }

  /* ── Phase ──
     Une PHASE n'est jamais insécable : elle peut faire plusieurs pages.
     Seul son bandeau reste solidaire de ce qui suit. */
  .pc-ph{ margin-top:8pt; }
  .pc-ph-band{ display:flex; align-items:baseline; gap:7pt; padding:3.5pt 9pt; border-left:3pt solid ${GRIS};
    background:#f4f5f8; border-radius:0 5pt 5pt 0;
    break-inside:avoid; page-break-inside:avoid; page-break-after:avoid; break-after:avoid; }
  .pc-ph-num{ font-size:11pt; font-weight:800; color:#b9bec8; flex:0 0 auto; }
  .pc-ph-nom{ font-size:12.5pt; font-weight:800; letter-spacing:.8pt; text-transform:uppercase; color:${ENCRE};
    flex:1; min-width:0; }
  .pc-ph-flag{ flex:0 0 auto; font-size:6.5pt; font-weight:800; letter-spacing:.3pt; text-transform:uppercase;
    color:#b97a10; }

  /* ── Ouvrage ──
     Pas de carte : un filet gauche et un fond très léger sur l'en-tête.
     L'en-tête reste solidaire des premières lignes, l'ouvrage entier peut se
     couper — 35 tâches ne tiennent pas sur une page. */
  .pc-ouv{ margin-top:4pt; padding-left:9pt; border-left:.75pt solid #e4e7ec; }
  .pc-ouv-tete{ display:flex; align-items:baseline; gap:8pt; padding:2pt 0 2.5pt;
    break-inside:avoid; page-break-inside:avoid; page-break-after:avoid; break-after:avoid; }
  /* Libellé INTÉGRAL : pas de clamp, pas d'ellipse, retour à la ligne libre. */
  .pc-ouv-lib{ flex:1; min-width:0; font-size:8.8pt; font-weight:600; color:${ENCRE}; line-height:1.3;
    overflow-wrap:anywhere; }
  .pc-ouv-code{ display:inline-block; margin-right:5pt; padding:.5pt 5pt; border-radius:3pt; background:#eef0f4;
    color:#4a4f5b; font-size:7.5pt; font-weight:800; letter-spacing:.3pt; white-space:nowrap; }
  .pc-ouv-qte{ flex:0 0 auto; font-size:10pt; font-weight:800; color:${BLEU}; white-space:nowrap; }
  .pc-vide{ padding:2.5pt 4pt; font-size:8.5pt; font-style:italic; color:#9aa0ab; }

  /* ── Matériaux consolidés ── */
  .pc-portee{ margin:0 0 7pt; padding:5pt 9pt; border-radius:6pt; background:#fff8e0; border:.75pt solid #f2e2ad;
    font-size:8pt; font-weight:700; color:#8a6d00; line-height:1.35;
    break-inside:avoid; page-break-inside:avoid; page-break-after:avoid; break-after:avoid; }
  .pc-mat-bloc{ margin-top:4pt; padding-left:9pt; border-left:.75pt solid #e4e7ec; }
  .pc-mat-bloc .pc-t td{ font-size:8.5pt; padding:1.7pt 4pt; }
  .pc-mat-nom{ font-weight:700; color:${ENCRE}; }
  .pc-c-ref{ width:132pt; font-size:7.5pt; color:${GRIS}; line-height:1.25; overflow-wrap:anywhere; }
  .pc-mat-alerte{ color:${ROUGE}; font-weight:700; }
  .pc-c-qte{ width:88pt; text-align:right; }
  .pc-qte{ font-size:9.5pt; font-weight:800; color:${ENCRE}; white-space:nowrap; }
  .pc-qte-nd{ font-size:8pt; font-style:italic; color:#b97a10; font-weight:700; }
  .pc-qte-sous{ display:block; font-size:7.5pt; color:${GRIS}; }
  .pc-c-cmd{ width:44pt; text-align:right; }
  .pc-cmd{ display:inline-block; padding:.5pt 6pt; border-radius:99pt; border:.75pt solid #9fd9b4; background:#eefbf3;
    color:#1e8e4e; font-size:6.5pt; font-weight:800; letter-spacing:.3pt; text-transform:uppercase; white-space:nowrap; }

  /* ── Zone de notes : UNE seule, en fin de document, sans saut de page forcé.
       (L'ancienne version en posait une après chaque phase, plus une page
       entière de douze lignes : 3 pages sur FOURMOND 001.) ── */
  .pc-notes{ margin-top:8pt; padding:6pt 10pt 2pt; border:.75pt dashed #d8dbe2; border-radius:8pt;
    break-inside:avoid; page-break-inside:avoid; }
  .pc-notes-titre{ font-size:7pt; font-weight:800; letter-spacing:.9pt; text-transform:uppercase; color:${GRIS};
    margin-bottom:5pt; }
  .pc-notes-l{ border-bottom:.75pt solid #e4e7ec; height:14pt; }`;

  // Badge du héros : ce que ce document EST. Jamais un chiffre de gestion.
  const badgeHTML = `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:12pt;">
        <div style="display:inline-block;background:${OR};border-radius:8pt;padding:6pt 13pt 7pt;text-align:center;">
          <div style="font-size:6pt;font-weight:700;letter-spacing:1.8pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Support</div>
          <div class="bc" style="font-size:13pt;font-weight:800;color:${ENCRE};line-height:1.05;">Équipe chantier</div>
        </div>
      </td>`;

  return docClientHTML({
    titreDoc: `Preparation ${nom}`,
    eyebrow: "Préparation de chantier",
    titre: nom,
    sousTitre: [operationNom, adresse].map(v => (v || "").toString().trim()).filter(Boolean).join(" · "),
    chips: [
      `${phases.length} phase${s(phases.length)}`,
      `${nbOuvrages} ouvrage${s(nbOuvrages)}`,
      `${nbTaches} tâche${s(nbTaches)}`,
      nbAOrganiser > 0 ? `${nbAOrganiser} à organiser` : "",
      dateGen ? `Généré le ${dateGen}` : "",
    ].filter(Boolean),
    badgeHTML,
    logoUrl,
    corps: `${corps}${zoneNotes}`,
    cssExtra,
  });
}
