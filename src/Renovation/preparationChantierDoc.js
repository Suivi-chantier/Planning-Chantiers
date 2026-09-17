// preparationChantierDoc — gabarit PDF « Dossier de préparation » (support
// PAPIER pour l'équipe chantier).
//
// C'est la version imprimable de l'écran « Préparation du chantier » de
// l'espace ouvrier : la MÊME hiérarchie, les MÊMES règles d'affichage.
//
//   Chantier → phases (ordre réel) → ouvrages → tâches de la phase
//                                             → matériaux de l'ouvrage
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
// les décisions d'affichage (phases visibles, état d'une tâche, état d'un
// ouvrage, quantité lisible, écran de modèle) viennent toutes du module pur
// preparationChantier.mjs — celui que l'écran ouvrier utilise. Une règle
// d'affichage qui divergerait ici serait un bug : le papier doit dire
// exactement ce que le téléphone dit.
//
// L'enveloppe graphique (héros sombre à halos, logo, Barlow, pied
// « Document confidentiel ») est celle de tous les documents Profero :
// docClientHTML de previsionnelDoc.js, non modifié.
// Extensions explicites : elles permettent au chargeur de scripts/_chargeur.mjs
// de charger ce module dans Node pour la vérification, sans build.
import { docClientHTML, sectionTitre } from "./previsionnelDoc.js";
import {
  compterTaches, etatOuvrage, etatTache,
  avancementAffichable, formaterQuantite, ecranModele, PHASE_A_ORGANISER,
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

// Mention OBLIGATOIRE de la portée des matériaux. Un ouvrage réparti sur
// plusieurs phases voit ses matériaux RÉPÉTÉS à chaque phase (la RPC le dit
// avec materiaux_portee = "ouvrage_complet"). Sans cette phrase, une équipe
// qui additionne les colonnes commande deux ou trois fois la même chose.
// Elle est répétée à CHAQUE bloc de matériaux, jamais une seule fois en tête.
export const MENTION_PORTEE_MATERIAUX =
  "Matériaux prévus pour l'ensemble de l'ouvrage — ne pas additionner avec les autres phases.";

// Au-delà de ce nombre de lignes (tâches + matériaux), une carte d'ouvrage
// n'est plus tenue de rester d'un seul tenant : l'obliger à ne pas se couper
// pousserait une carte de 40 lignes à la page suivante et laisserait une
// demi-page blanche. En dessous, la carte reste insécable — c'est le confort
// de lecture sur chantier. Au-dessus, seules les LIGNES sont protégées.
const LIGNES_CARTE_COMPACTE = 10;

// Case à cocher au stylo, sur le chantier. Purement décorative : rien n'est
// coché à l'impression, même une tâche terminée — l'état est déjà dit par sa
// pastille, et une case pré-cochée empêcherait le pointage papier.
const CASE = '<span class="pc-case"></span>';

// ─── BLOCS ────────────────────────────────────────────────────────────────────

const tuile = (label, valeur, accent) => `
  <div class="pc-tuile">
    <div class="pc-tuile-label">${esc(label)}</div>
    <div class="pc-tuile-val bc" style="color:${accent};">${esc(valeur)}</div>
  </div>`;

// Lignes vierges à remplir au stylo après impression.
const zoneNotes = (titre, lignes, classe) => `
  <div class="${classe}">
    <div class="pc-notes-titre">${esc(titre)}</div>
    ${Array.from({ length: lignes }, () => '<div class="pc-notes-ligne"></div>').join("")}
  </div>`;

// Une tâche de la phase courante. Le document reste utile quand tout est à
// 0 % : la case, le rang et le nom suffisent à travailler.
function ligneTache(t, position) {
  const e   = etatTache(t);
  const pct = avancementAffichable(t); // null hors de ]0 ; 100[
  return `
  <tr class="pc-ligne">
    <td class="pc-col-case">${CASE}</td>
    <td class="pc-col-rang bc">${String(position).padStart(2, "0")}</td>
    <td class="pc-col-nom">${esc(t?.nom || "(sans nom)")}</td>
    <td class="pc-col-pct">${pct === null ? "" : `${pct} %`}</td>
    <td class="pc-col-etat"><span class="pc-pastille" style="color:${e.couleur};border-color:${e.couleur};">${esc(e.label)}</span></td>
  </tr>`;
}

// Un matériau de l'ouvrage COMPLET (cf. MENTION_PORTEE_MATERIAUX).
function ligneMateriau(m) {
  const total = formaterQuantite(m?.quantite_totale);   // null = inconnue
  const parU  = formaterQuantite(m?.quantite_par_unite);
  const unite = (m?.unite || "").toString().trim();
  const introuvable = m?.introuvable === true;

  const details = [
    m?.reference   ? `Réf. ${m.reference}` : null,
    m?.fournisseur ? String(m.fournisseur) : null,
  ].filter(Boolean).join(" · ");

  return `
  <tr class="pc-ligne${introuvable ? " pc-ligne-alerte" : ""}">
    <td class="pc-col-case">${CASE}</td>
    <td class="pc-col-mat">
      <div class="pc-mat-nom"${introuvable ? ` style="color:${ROUGE};font-style:italic;"` : ""}>${esc(introuvable ? "Matériau introuvable" : (m?.nom || "(sans nom)"))}</div>
      ${introuvable
        ? `<div class="pc-mat-alerte">Retiré de la bibliothèque — à confirmer avec le conducteur avant de l'utiliser.</div>`
        : (details ? `<div class="pc-mat-sous">${esc(details)}</div>` : "")}
    </td>
    <td class="pc-col-qte">
      ${total === null
        ? `<span class="pc-qte-inconnue">Quantité totale à définir</span>`
        : `<span class="pc-qte">${esc(`${total}${unite ? ` ${unite}` : ""}`)}</span>`}
      ${parU === null ? "" : `<span class="pc-qte-sous">soit ${esc(`${parU}${unite ? ` ${unite}` : ""}`)} par unité d'ouvrage</span>`}
    </td>
    <td class="pc-col-cmd">${m?.commande_le ? `<span class="pc-badge-cmd">Commandé</span>` : ""}</td>
  </tr>`;
}

// Une carte d'ouvrage, TELLE QU'ELLE APPARAÎT DANS CETTE PHASE : ses tâches
// de cette phase seulement, mais ses matériaux en entier.
function carteOuvrage(o) {
  const taches    = Array.isArray(o?.taches)    ? o.taches    : [];
  const materiaux = Array.isArray(o?.materiaux) ? o.materiaux : [];
  const e = etatOuvrage(o);
  const q = formaterQuantite(o?.quantite);
  const unite = (o?.unite || "").toString().trim();

  const meta = [
    q === null ? null : `${q}${unite ? ` ${unite}` : ""}`,
    `${taches.length} tâche${s(taches.length)} dans cette phase`,
    `${materiaux.length} matériau${sx(materiaux.length)}`,
  ].filter(Boolean).join(" · ");

  const blocTaches = `
    <div class="pc-sous-titre">Tâches de cette phase</div>
    ${taches.length === 0
      ? `<div class="pc-vide">Aucune tâche définie pour cet ouvrage dans cette phase.</div>`
      : `<table class="pc-table">${taches.map((t, i) => ligneTache(t, i + 1)).join("")}</table>`}`;

  const blocMateriaux = `
    <div class="pc-sous-titre">Matériaux</div>
    <div class="pc-portee">${esc(MENTION_PORTEE_MATERIAUX)}</div>
    ${materiaux.length === 0
      ? `<div class="pc-vide">Aucun matériau prévu pour cet ouvrage.</div>`
      : `<table class="pc-table">${materiaux.map(ligneMateriau).join("")}</table>`}`;

  const compacte = (taches.length + materiaux.length) <= LIGNES_CARTE_COMPACTE;

  return `
  <div class="pc-ouvrage${compacte ? " pc-ouvrage-compacte" : ""}">
    <div class="pc-ouvrage-head">
      ${o?.code_ouvrage ? `<div class="pc-code">${esc(o.code_ouvrage)}</div>` : ""}
      <div class="pc-ouvrage-titre">
        <span class="pc-libelle">${esc(o?.libelle || "(sans nom)")}</span>
        <span class="pc-pastille" style="color:${e.couleur};border-color:${e.couleur};">${esc(e.label)}</span>
      </div>
      <div class="pc-ouvrage-meta">${esc(meta)}</div>
    </div>
    ${blocTaches}
    ${blocMateriaux}
  </div>`;
}

function blocPhase(phase, index) {
  const ouvrages = Array.isArray(phase?.ouvrages) ? phase.ouvrages : [];
  const { total } = compterTaches(phase);
  const couleur = (phase?.couleur || GRIS).toString();
  const synthetique = phase?.synthetique === true || phase?.id === PHASE_A_ORGANISER;

  return `
  <div class="pc-phase">
    <div class="pc-phase-band" style="border-left-color:${esc(couleur)};">
      <div class="pc-phase-num bc">${String(index).padStart(2, "0")}</div>
      <div class="pc-phase-txt">
        <div class="pc-phase-nom bc">${esc(phase?.nom || "Phase")}</div>
        <div class="pc-phase-meta">${esc(`${ouvrages.length} ouvrage${s(ouvrages.length)} · ${total} tâche${s(total)}`)}</div>
      </div>
      ${synthetique ? `<div class="pc-phase-flag">Hors planning</div>` : ""}
    </div>
    ${synthetique ? `<div class="pc-phase-note">Ces tâches ne sont rattachées à aucune phase du planning : à caler avec le conducteur avant de les engager.</div>` : ""}
    ${ouvrages.map(carteOuvrage).join("")}
    ${zoneNotes("Notes / points à vérifier sur chantier", 3, "pc-notes")}
  </div>`;
}

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// payload      : réponse BRUTE de la RPC ouvrier_preparation_chantier
// chantierNom  : nom affiché (repli sur payload.chantier_nom)
// operationNom : opération de rattachement, "" si le chantier n'en a pas
// adresse      : adresse du chantier (planning_config/chantier_adresses), ""
// dateGen      : date + heure de génération, déjà formatées par l'appelant
export function buildPreparationDocHTML({
  payload = null, chantierNom = "", operationNom = "", adresse = "", logoUrl = "", dateGen = "",
} = {}) {
  const nom     = (chantierNom || payload?.chantier_nom || "Chantier").toString();
  const ecran   = ecranModele(payload);          // null = préparation affichable
  const phases  = ecran ? [] : phasesOrdonnees(payload);
  const compteurs = payload?.compteurs || {};
  const nb = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const nbOuvrages   = nb(compteurs.ouvrages_uniques);
  const nbTaches     = nb(compteurs.taches);
  const nbAOrganiser = nb(compteurs.taches_a_organiser);

  // ── Résumé ──
  const resume = `
  <div class="pc-tuiles">
    ${tuile("Phases", String(phases.length), ENCRE)}
    ${tuile("Ouvrages", String(nbOuvrages), BLEU)}
    ${tuile("Tâches", String(nbTaches), ENCRE)}
    ${tuile("À organiser", String(nbAOrganiser), nbAOrganiser > 0 ? "#b97a10" : GRIS)}
  </div>
  ${nbAOrganiser > 0 ? `<div class="pc-note-inline">${esc(`${nbAOrganiser} tâche${s(nbAOrganiser)} n'${nbAOrganiser > 1 ? "ont" : "a"} pas encore de phase : regroupée${s(nbAOrganiser)} en fin de document.`)}</div>` : ""}`;

  // ── Avertissement quand la préparation n'est pas exploitable ──
  // Les quatre états (absent / vide / legacy_v1 / ambigu) ont chacun leur
  // message : aucun ne tombe dans un cas par défaut silencieux, et le
  // document n'est JAMAIS généré vide sans explication.
  const avertissement = !ecran ? "" : `
  <div class="pc-alerte${ecran.ton === "alerte" ? " pc-alerte-rouge" : ""}">
    <div class="pc-alerte-titre">${esc(ecran.titre)}</div>
    <div class="pc-alerte-texte">${esc(ecran.texte)}</div>
  </div>`;

  // ── Phases ──
  const corpsPhases = ecran
    ? ""
    : (phases.length === 0
      ? `<div class="pc-vide-section">Aucune phase à afficher : les phases déclarées ne contiennent encore aucun ouvrage.</div>`
      : phases.map((p, i) => blocPhase(p, i + 1)).join(""));

  const corps = `
  ${sectionTitre("Résumé de la préparation")}
  ${resume}
  ${avertissement}

  ${ecran ? "" : `${sectionTitre("Déroulé des phases")}
  <div class="pc-intro">Les phases sont présentées dans leur ordre réel d'exécution. Pour chaque ouvrage : les tâches de cette phase, puis les matériaux prévus pour l'ouvrage entier.</div>
  ${corpsPhases}`}

  <div class="pc-final">
    ${zoneNotes("Observations générales de préparation", 12, "pc-notes pc-notes-large")}
  </div>`;

  const cssExtra = `
  /* ── Dossier de préparation ── */
  /* Pied de page répété (Chrome/Edge ; ignoré ailleurs, dégradation propre).
     Ce bloc @page fusionne avec celui de docClientHTML (bornes + format A4). */
  @page{
    @bottom-left  { content:"${escCss(nom)}"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-center{ content:"Dossier de préparation"; font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
    @bottom-right { content:"Page " counter(page) " / " counter(pages); font-size:7.5pt; color:#b3b8c2; font-family:'Barlow',Arial,sans-serif; }
  }

  .pc-tuiles{display:flex;gap:8pt;margin-top:2pt;break-inside:avoid;page-break-inside:avoid;}
  .pc-tuile{flex:1;border:1pt solid #e9ebf0;border-radius:10pt;padding:9pt 12pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .pc-tuile-label{font-size:7pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:${GRIS};}
  .pc-tuile-val{font-size:20pt;font-weight:800;line-height:1.05;margin-top:2pt;letter-spacing:.2pt;}
  .pc-note-inline{margin-top:6pt;font-size:8pt;font-style:italic;color:#9aa0ab;}
  .pc-intro{font-size:8.5pt;color:${GRIS};margin:-4pt 0 12pt;}

  .pc-alerte{margin-top:12pt;padding:10pt 13pt;border-radius:9pt;background:#fff8e0;border:1pt solid #f2e2ad;break-inside:avoid;page-break-inside:avoid;}
  .pc-alerte-rouge{background:#fdeceb;border-color:#f3c9c4;}
  .pc-alerte-titre{font-size:10pt;font-weight:800;color:#8a6d00;}
  .pc-alerte-rouge .pc-alerte-titre{color:${ROUGE};}
  .pc-alerte-texte{font-size:9.5pt;color:#57534a;line-height:1.5;margin-top:2pt;}
  .pc-vide-section{padding:18pt;text-align:center;font-size:9.5pt;font-style:italic;color:#9aa0ab;border:1pt dashed #e9ebf0;border-radius:10pt;}

  /* Une PHASE n'est jamais insécable : elle peut faire dix pages.
     Seul son bandeau reste solidaire de ce qui suit. */
  .pc-phase{margin-top:16pt;}
  .pc-phase-band{display:flex;align-items:center;gap:10pt;padding:7pt 12pt;border-left:4pt solid ${GRIS};
    background:#f6f7f9;border-radius:0 8pt 8pt 0;break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;break-after:avoid;}
  .pc-phase-num{font-size:16pt;font-weight:800;color:#c8ccd4;line-height:1;flex:0 0 auto;}
  .pc-phase-txt{flex:1;min-width:0;}
  .pc-phase-nom{font-size:14pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:${ENCRE};line-height:1.1;}
  .pc-phase-meta{font-size:8pt;color:${GRIS};margin-top:1pt;}
  .pc-phase-flag{flex:0 0 auto;font-size:7pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:#b97a10;
    border:1pt solid #e4c98a;border-radius:99pt;padding:2pt 9pt;background:#fff8e0;}
  .pc-phase-note{font-size:8.5pt;font-style:italic;color:#8a6d00;margin:6pt 0 0;padding-left:12pt;}

  /* Carte d'ouvrage : insécable UNIQUEMENT si elle est courte (classe posée à
     la génération). Longue, elle se coupe — sinon une carte de 40 lignes
     laisserait une demi-page blanche derrière elle. */
  .pc-ouvrage{margin-top:11pt;border:1pt solid #e9ebf0;border-radius:10pt;padding:9pt 11pt 8pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .pc-ouvrage-compacte{break-inside:avoid;page-break-inside:avoid;}
  .pc-ouvrage-head{break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;break-after:avoid;}
  .pc-code{font-size:7.5pt;font-weight:800;letter-spacing:.6pt;color:${GRIS};margin-bottom:2pt;}
  .pc-ouvrage-titre{display:flex;align-items:flex-start;gap:9pt;}
  /* Libellé INTÉGRAL : pas de clamp, pas d'ellipse. Les descriptifs d'ouvrage
     font couramment dix lignes ; sur papier on les lit en entier. */
  .pc-libelle{flex:1;min-width:0;font-size:11pt;font-weight:700;color:${ENCRE};line-height:1.3;}
  .pc-ouvrage-meta{font-size:8pt;color:${GRIS};margin-top:3pt;}

  .pc-sous-titre{margin-top:8pt;padding-bottom:2pt;border-bottom:1pt solid #eef0f4;
    font-size:7pt;font-weight:800;letter-spacing:.9pt;text-transform:uppercase;color:${GRIS};
    page-break-after:avoid;break-after:avoid;}
  .pc-portee{margin-top:4pt;padding:4pt 8pt;border-radius:6pt;background:#fff8e0;border:1pt solid #f2e2ad;
    font-size:7.5pt;font-weight:700;color:#8a6d00;line-height:1.35;
    break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;break-after:avoid;}
  .pc-vide{padding:6pt 2pt;font-size:8.5pt;font-style:italic;color:#9aa0ab;}

  .pc-table{width:100%;border-collapse:collapse;margin-top:2pt;}
  /* Unité atomique protégée : une ligne ne se coupe jamais en deux pages. */
  .pc-ligne{break-inside:avoid;page-break-inside:avoid;}
  .pc-table td{padding:4.5pt 5pt;border-bottom:1pt solid #f2f4f7;vertical-align:top;font-size:9pt;color:#2a2f3a;}
  .pc-ligne-alerte td{background:#fdf6f5;}

  .pc-case{display:inline-block;width:9pt;height:9pt;border:1pt solid #b9bec8;border-radius:2pt;background:#fff;vertical-align:-1pt;}
  .pc-col-case{width:16pt;}
  .pc-col-rang{width:18pt;font-size:9pt;font-weight:800;color:#c8ccd4;}
  .pc-col-nom{font-weight:600;}
  .pc-col-pct{width:32pt;text-align:right;font-size:8.5pt;font-weight:700;color:${GRIS};white-space:nowrap;}
  .pc-col-etat{width:52pt;text-align:right;}
  .pc-pastille{display:inline-block;padding:1pt 7pt;border-radius:99pt;border:1pt solid;
    font-size:6.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;white-space:nowrap;}
  .pc-ouvrage-titre .pc-pastille{flex:0 0 auto;margin-top:2pt;}

  .pc-col-mat{}
  .pc-mat-nom{font-weight:700;color:${ENCRE};line-height:1.3;}
  .pc-mat-sous{font-size:8pt;color:${GRIS};margin-top:1pt;}
  .pc-mat-alerte{font-size:8pt;color:${ROUGE};margin-top:1pt;}
  .pc-col-qte{width:130pt;text-align:right;}
  .pc-qte{font-size:10pt;font-weight:800;color:${ENCRE};white-space:nowrap;}
  .pc-qte-inconnue{font-size:8.5pt;font-style:italic;color:#9aa0ab;}
  .pc-qte-sous{display:block;font-size:7.5pt;color:${GRIS};margin-top:1pt;}
  .pc-col-cmd{width:48pt;text-align:right;}
  .pc-badge-cmd{display:inline-block;padding:1pt 7pt;border-radius:99pt;border:1pt solid #9fd9b4;background:#eefbf3;
    color:#1e8e4e;font-size:6.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;white-space:nowrap;}

  /* Zones à remplir au stylo après impression. */
  .pc-notes{margin-top:11pt;padding:8pt 11pt 4pt;border:1pt dashed #d8dbe2;border-radius:9pt;break-inside:avoid;page-break-inside:avoid;}
  .pc-notes-titre{font-size:7pt;font-weight:800;letter-spacing:.9pt;text-transform:uppercase;color:${GRIS};margin-bottom:6pt;}
  .pc-notes-ligne{border-bottom:1pt solid #e4e7ec;height:15pt;}
  .pc-notes-large .pc-notes-ligne{height:19pt;}
  /* Seule coupure forcée du document : la page de debrief. Elle sert à
     écrire, elle mérite sa page. */
  .pc-final{page-break-before:always;break-before:page;padding-top:4pt;}`;

  // Badge du héros : ce que ce document EST. Jamais un chiffre de gestion.
  const badgeHTML = `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:10pt 16pt 11pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Support</div>
          <div class="bc" style="font-size:16pt;font-weight:800;color:${ENCRE};line-height:1.05;margin-top:2pt;">Équipe chantier</div>
          <div style="font-size:7.5pt;font-weight:700;color:rgba(0,0,0,.55);margin-top:1pt;">À imprimer et annoter</div>
        </div>
      </td>`;

  return docClientHTML({
    titreDoc: `Preparation ${nom}`,
    eyebrow: "Dossier de préparation",
    titre: nom,
    sousTitre: [operationNom, adresse].map(v => (v || "").toString().trim()).filter(Boolean).join(" · "),
    chips: [
      `${phases.length} phase${s(phases.length)}`,
      `${nbOuvrages} ouvrage${s(nbOuvrages)}`,
      `${nbTaches} tâche${s(nbTaches)}`,
      nbAOrganiser > 0 ? `${nbAOrganiser} à organiser` : "Aucune tâche à organiser",
      dateGen ? `Généré le ${dateGen}` : "",
    ].filter(Boolean),
    badgeHTML,
    logoUrl,
    corps,
    cssExtra,
  });
}
