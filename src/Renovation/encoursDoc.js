// encoursDoc — gabarit PDF « Encours fournisseurs » (document INTERNE).
//
// Même enveloppe que les autres documents Profero (docClientHTML de
// previsionnelDoc.js : héros sombre à halos, jaune marque, Barlow, pied
// « Document confidentiel »), avec :
//   • les chiffres clés du mois en cours (à payer, payé, total) ;
//   • la synthèse mois par mois (à payer · payé · total) ;
//   • le détail de chaque mois par fournisseur.
//
// Aucun calcul ici : les montants arrivent déjà agrégés par
// PageEncoursFournisseurs (les mêmes que ceux affichés à l'écran). Ce module
// ne fait que METTRE EN PAGE. Seule addition faite ici : la ligne de total
// des tableaux, somme des lignes affichées juste au-dessus.
//
// Extensions explicites : elles permettent au chargeur de scripts/_chargeur.mjs
// de charger ce module dans Node pour la vérification, sans build.
// Couvert par scripts/verif-encours-doc.mjs.
import { docClientHTML, sectionTitre } from "./previsionnelDoc.js";
import { escDoc } from "./preparationDocCommun.mjs";

const esc = escDoc;
const C_A_PAYER = "#b97a10";
const C_PAYE = "#1e8e4e";
const C_TOTAL = "#12151c";
const GRIS = "#8a90a0";

const eur = (n) => `${(Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
// Montant d'une ligne fournisseur : vide (—) quand il n'y a rien dans la colonne.
const eurOuTiret = (n) => (Number(n) > 0 ? eur(n) : "—");
const s = (n) => (n > 1 ? "s" : "");

// Note reprise telle quelle sous la synthèse : elle dit ce que chaque colonne compte.
export const NOTE_ENCOURS =
  "À payer : la facture du fournisseur si elle est reçue, sinon le montant saisi (aperçu avant facture). "
  + "Payé : les achats réglés comptant. Les factures fournisseurs restent comptées « à payer » : "
  + "leur règlement n'est pas encore enregistré dans l'application. Total = à payer + payé.";

const tuile = ({ label, valeur, sous = "", accent = C_TOTAL }) => `
  <div class="en-tuile">
    <div class="en-tuile-label">${esc(label)}</div>
    <div class="en-tuile-val bc" style="color:${accent};">${esc(valeur)}</div>
    ${sous ? `<div class="en-tuile-sous">${esc(sous)}</div>` : ""}
  </div>`;

// Montant de mois : 0 s'affiche « 0,00 € » (c'est un zéro connu), en gris.
const tdMontant = (n, couleur, gras = false) =>
  `<td class="num" style="color:${Number(n) > 0 ? couleur : GRIS};${gras ? "font-weight:800;" : ""}">${esc(eur(n))}</td>`;

// Documents d'un fournisseur (bons, BL, tickets, factures et leurs BL
// rapprochés), sous sa ligne. Libellés et dates déjà formatés par la page.
// Un BL sans montant affiche « — », jamais 0,00 €.
function docsHTML(docs = []) {
  if (!docs.length) return "";
  const items = docs.map(d => `
        <div class="en-doc">
          <span class="en-doc-lib">${esc(d.libelle)}</span>
          ${d.date ? `<span class="en-doc-date">${esc(d.date)}</span>` : ""}
          ${d.payeComptant ? `<span class="en-doc-tag" style="color:${C_PAYE};">payé comptant</span>` : ""}
          <span class="en-doc-val">${esc(eur(d.montant))}</span>
        </div>${(d.bls || []).map(b => `
        <div class="en-doc en-bl">
          <span class="en-doc-lib">BL n° ${esc(b.numero)}</span>
          ${b.ecart ? `<span class="en-doc-tag" style="color:${C_A_PAYER};">écart</span>` : ""}
          <span class="en-doc-val">${esc(b.montant != null && b.montant !== "" ? eur(b.montant) : "—")}</span>
        </div>`).join("")}`).join("");
  return `
      <tr class="en-docs"><td colspan="7"><div class="en-docs-liste">${items}</div></td></tr>`;
}

// mois : [{ label, nbFournisseurs, aPayer, paye, total,
//           fournisseurs: [{ nom, saisi, facture, paye, aPayer, total,
//             docs: [{ libelle, date, montant, payeComptant,
//                      bls: [{ numero, montant, ecart }] }] }] }]
//        triés du plus récent au plus ancien, comme à l'écran.
// moisCourant : { label, aPayer, paye, total }
export function buildEncoursDocHTML({ mois = [], moisCourant, filtreFournisseur = "", logoUrl, dateGen = "" }) {
  const sommes = mois.reduce((t, g) => ({
    aPayer: t.aPayer + (Number(g.aPayer) || 0),
    paye: t.paye + (Number(g.paye) || 0),
    total: t.total + (Number(g.total) || 0),
  }), { aPayer: 0, paye: 0, total: 0 });

  // ── Chiffres clés ──
  const mc = moisCourant || { label: "", aPayer: 0, paye: 0, total: 0 };
  const tuiles = [
    tuile({ label: `À payer · ${mc.label}`, valeur: eur(mc.aPayer), accent: C_A_PAYER }),
    tuile({ label: `Payé comptant · ${mc.label}`, valeur: eur(mc.paye), accent: C_PAYE }),
    tuile({ label: `Total · ${mc.label}`, valeur: eur(mc.total) }),
    tuile({ label: "À payer · tous les mois", valeur: eur(sommes.aPayer), accent: C_A_PAYER,
      sous: `${mois.length} mois listé${s(mois.length)}` }),
  ].join("");

  // ── Synthèse par mois ──
  const lignesSynthese = mois.map(g => `
    <tr>
      <td class="en-lib en-cap">${esc(g.label)}</td>
      <td class="num">${esc(String(g.nbFournisseurs))}</td>
      ${tdMontant(g.aPayer, C_A_PAYER)}
      ${tdMontant(g.paye, C_PAYE)}
      ${tdMontant(g.total, C_TOTAL, true)}
    </tr>`).join("");
  const synthese = `
  <table class="en-tab">
    <thead><tr>
      <th style="text-align:left;">Mois</th><th>Fournisseurs</th><th>À payer</th><th>Payé</th><th>Total</th>
    </tr></thead>
    <tbody>
      ${lignesSynthese}
      <tr class="en-total">
        <td class="en-lib">Total</td>
        <td></td>
        ${tdMontant(sommes.aPayer, C_A_PAYER)}
        ${tdMontant(sommes.paye, C_PAYE)}
        ${tdMontant(sommes.total, C_TOTAL, true)}
      </tr>
    </tbody>
  </table>
  <div class="en-note">${esc(NOTE_ENCOURS)}</div>`;

  // ── Détail de chaque mois ──
  const detail = mois.map(g => {
    const lignes = (g.fournisseurs || []).map(pf => {
      const ecart = (pf.facture > 0 && pf.saisi > 0) ? (pf.facture - pf.saisi) : null;
      const ecartTxt = ecart == null ? "—" : `${ecart > 0 ? "+" : ""}${eur(ecart)}`;
      const ecartCol = ecart == null ? GRIS : (Math.abs(ecart) < 1 ? C_PAYE : C_A_PAYER);
      return `
      <tr${(pf.docs || []).length ? ' class="en-f-docs"' : ""}>
        <td class="en-lib">${esc(pf.nom)}</td>
        <td class="num">${esc(eurOuTiret(pf.saisi))}</td>
        <td class="num">${esc(eurOuTiret(pf.facture))}</td>
        <td class="num" style="color:${ecartCol};">${esc(ecartTxt)}</td>
        <td class="num" style="color:${pf.aPayer > 0 ? C_A_PAYER : GRIS};">${esc(eurOuTiret(pf.aPayer))}</td>
        <td class="num" style="color:${pf.paye > 0 ? C_PAYE : GRIS};">${esc(eurOuTiret(pf.paye))}</td>
        <td class="num" style="font-weight:800;color:${pf.total > 0 ? C_TOTAL : GRIS};">${esc(eurOuTiret(pf.total))}</td>
      </tr>${docsHTML(pf.docs)}`;
    }).join("");
    return `
  <div class="en-mois">
    <div class="en-mois-head">
      <span class="en-mois-nom bc">${esc(g.label)}</span>
      <span class="en-mois-nb">${esc(`${g.nbFournisseurs} fournisseur${s(g.nbFournisseurs)}`)}</span>
      <span class="en-mois-chiffres">
        <span style="color:${C_A_PAYER};">À payer <b>${esc(eur(g.aPayer))}</b></span>
        <span style="color:${C_PAYE};">Payé <b>${esc(eur(g.paye))}</b></span>
        <span style="color:${C_TOTAL};">Total <b>${esc(eur(g.total))}</b></span>
      </span>
    </div>
    <table class="en-tab">
      <thead><tr>
        <th style="text-align:left;">Fournisseur</th><th>Saisi</th><th>Facturé</th><th>Écart</th><th>À payer</th><th>Payé</th><th>Total</th>
      </tr></thead>
      <tbody>
        ${lignes}
        <tr class="en-total">
          <td class="en-lib">Total ${esc(g.label)}</td>
          <td></td><td></td><td></td>
          ${tdMontant(g.aPayer, C_A_PAYER)}
          ${tdMontant(g.paye, C_PAYE)}
          ${tdMontant(g.total, C_TOTAL, true)}
        </tr>
      </tbody>
    </table>
  </div>`;
  }).join("");

  const corps = mois.length === 0
    ? `${sectionTitre("Encours")}<div class="en-note">Aucune dépense enregistrée.</div>`
    : `
  <div class="en-tuiles" style="margin-top:14pt;">${tuiles}</div>
  ${sectionTitre("Synthèse par mois")}
  ${synthese}
  ${sectionTitre("Détail par fournisseur")}
  ${detail}`;

  const cssExtra = `
  /* ── Encours fournisseurs ── */
  .en-tuiles{display:flex;gap:8pt;break-inside:avoid;page-break-inside:avoid;}
  .en-tuile{flex:1;border:1pt solid #e9ebf0;border-radius:10pt;padding:9pt 12pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .en-tuile-label{font-size:7pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:${GRIS};}
  .en-tuile-val{font-size:16pt;font-weight:800;line-height:1.1;margin-top:3pt;letter-spacing:.2pt;}
  .en-tuile-sous{font-size:7.5pt;color:${GRIS};margin-top:2pt;}

  .en-tab{width:100%;border-collapse:collapse;}
  .en-tab th{font-size:7pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:${GRIS};text-align:right;padding:4pt 7pt;border-bottom:1.5pt solid #e9ebf0;white-space:nowrap;}
  .en-tab td{padding:5pt 7pt;border-bottom:1pt solid #eef0f4;font-size:8.5pt;color:#2a2f3a;}
  .en-tab td.num{text-align:right;white-space:nowrap;font-weight:600;}
  .en-tab tr{break-inside:avoid;page-break-inside:avoid;}
  .en-lib{font-weight:700;color:#12151c;}
  .en-cap{text-transform:capitalize;}
  .en-total td{font-weight:800;color:#12151c;border-top:1.5pt solid #d8dbe2;background:#fafbfd;}
  .en-note{font-size:8pt;color:#7c8291;line-height:1.5;margin-top:7pt;}

  .en-f-docs td{border-bottom:none;}
  .en-tab tr.en-docs{break-inside:auto;page-break-inside:auto;}
  .en-tab tr.en-docs td{padding:0 7pt 6pt;}
  .en-docs-liste{margin-left:10pt;padding-left:9pt;border-left:2pt solid #eceef2;}
  .en-doc{display:flex;align-items:baseline;gap:7pt;padding:1.2pt 0;font-size:7.5pt;color:#4a4f5b;break-inside:avoid;page-break-inside:avoid;}
  .en-doc-lib{font-weight:700;}
  .en-doc-date{color:#9aa0ab;}
  .en-doc-tag{font-size:6.5pt;font-weight:800;letter-spacing:.5pt;text-transform:uppercase;}
  .en-doc-val{margin-left:auto;font-weight:600;white-space:nowrap;}
  .en-bl{padding-left:12pt;color:#7c8291;}
  .en-bl .en-doc-lib{font-weight:500;}

  .en-mois{margin-bottom:14pt;}
  .en-mois-head{display:flex;align-items:baseline;gap:10pt;flex-wrap:wrap;padding:0 0 5pt;break-after:avoid;page-break-after:avoid;}
  .en-mois-nom{font-size:12.5pt;font-weight:800;letter-spacing:.6pt;text-transform:uppercase;color:#12151c;}
  .en-mois-nb{font-size:8pt;color:${GRIS};}
  .en-mois-chiffres{margin-left:auto;display:flex;gap:12pt;font-size:8.5pt;white-space:nowrap;}`;

  const chips = [
    filtreFournisseur ? `Fournisseur : ${filtreFournisseur}` : "Tous les fournisseurs",
    `${mois.length} mois`,
    "Usage interne",
    dateGen ? `Généré le ${dateGen}` : "",
  ].filter(Boolean);

  return docClientHTML({
    titreDoc: "Encours fournisseurs",
    eyebrow: "Suivi des dépenses",
    titre: filtreFournisseur ? `Encours ${filtreFournisseur}` : "Encours fournisseurs",
    sousTitre: "Montants regroupés par mois d'échéance de paiement (selon le mode de chaque fournisseur)",
    chips,
    logoUrl,
    corps,
    cssExtra,
  });
}
