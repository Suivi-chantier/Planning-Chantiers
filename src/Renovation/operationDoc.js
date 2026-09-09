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
import { docClientHTML, sectionTitre } from "./previsionnelDoc";
import { eur, fmtH } from "../chantierFinance";

const OR = "#FFC200";
const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pctTxt = (p) => (p == null ? "—" : `${p.toFixed(1).replace(".", ",")} %`);
const margeCouleur = (marge, pct) => (marge < 0 ? "#c0392b" : (pct != null && pct < 15) ? "#b97a10" : "#1e8e4e");

// Tuile « chiffre clé » du bandeau de synthèse.
const tuile = ({ label, valeur, sous = "", accent = "#12151c" }) => `
  <div class="op-tuile">
    <div class="op-tuile-label">${esc(label)}</div>
    <div class="op-tuile-val bc" style="color:${accent};">${esc(valeur)}</div>
    ${sous ? `<div class="op-tuile-sous">${esc(sous)}</div>` : ""}
  </div>`;

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// op     : { nom, adresse, couleur }
// agg    : agrégats de PageOperations (vendu, moReel, mat, fg, marge, margePct,
//          moPrev, matPrev, fgPrev, margePrev, margePrevPct, hVendues,
//          hReelles, avancement, nbChantiers, nbAvecPhasage)
// lignes : [{ nom, couleur, statutLabel, statutColor, b }] — b = brut du
//          chantier (null si sans phasage), dans l'ordre du chemin de fer
// dateGen : date de génération affichée (fraîcheur des chiffres)
export function buildOperationDocHTML({ op, agg, lignes = [], logoUrl, dateGen }) {
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
    return `
    <tr>
      <td class="op-log-nom"><span class="op-log-dot" style="background:${esc(l.couleur || "#888")};"></span>${esc(l.nom)}</td>
      <td><span class="op-statut" style="color:${esc(l.statutColor)};border-color:${esc(l.statutColor)};">${esc(l.statutLabel)}</span></td>
      ${!b
        ? `<td colspan="7" class="op-log-vide">Sans phasage — hors chiffres</td>`
        : `<td class="num"><b>${b.avancementChantier}%</b></td>
           <td class="num">${b.prixHTChantier > 0 ? esc(eur(b.prixHTChantier)) : "—"}</td>
           <td class="num">${esc(eur(b.coutMOTotalChantier))}</td>
           <td class="num">${esc(eur(b.coutMatChantier))}</td>
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
      <th>Avanc.</th><th>Vendu HT</th><th>Coût MO</th><th>Matériaux</th><th>Marge</th><th>Marge %</th><th>Heures</th>
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
  .op-log-total td{font-weight:800;color:#12151c;border-top:1.5pt solid #d8dbe2;background:#fafbfd;}`;

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
  </div>`;

  // Badge héros : la marge nette, l'information que ce document vient chercher.
  const badgeHTML = venduOK ? `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Marge nette à date</div>
          <div class="bc" style="font-size:18pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${esc(eur(agg.marge))}</div>
          <div style="font-size:7.5pt;font-weight:700;color:rgba(0,0,0,.55);margin-top:1pt;">${esc(pctTxt(agg.margePct))} du vendu</div>
        </div>
      </td>` : "";

  return docClientHTML({
    titreDoc: `Fiche operation ${op.nom}`,
    eyebrow: "Fiche opération — usage interne",
    titre: op.nom,
    sousTitre: op.adresse || "",
    chips: [
      `${agg.nbChantiers} logement${agg.nbChantiers > 1 ? "s" : ""}`,
      `Avancement ${agg.avancement}%`,
      `Généré le ${dateGen}`,
    ],
    badgeHTML,
    logoUrl,
    corps,
    cssExtra,
  });
}
