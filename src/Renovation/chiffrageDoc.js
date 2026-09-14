// chiffrageDoc — gabarit PDF « Dossier de chiffrage » (page Chiffrage).
//
// Même enveloppe que les autres documents Profero (docClientHTML de
// previsionnelDoc.js : héros sombre à halos, jaune marque, Barlow, pied
// « Document confidentiel ») — toute évolution du décor se fait là-bas.
// Ici : uniquement la MISE EN PAGE du dossier de visite/chiffrage :
//   client & projet (budget, délai, composition) · notes (texte + pages
//   manuscrites) · ouvrages avec estimation · côtes · plans · croquis ·
//   photos & vidéos.
// Aucun accès DB, aucun calcul métier hors des sommes qté × PU.
import { docClientHTML, sectionTitre } from "./previsionnelDoc";

const OR = "#FFC200";
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br/>");
const eur = (n) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const num = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};

// Carte « info » du bloc Client & projet.
const carte = (label, html, { large = false } = {}) => !html ? "" : `
  <div class="ch-carte" style="${large ? "grid-column:1 / -1;" : ""}">
    <div class="ch-carte-label">${esc(label)}</div>
    <div class="ch-carte-val">${html}</div>
  </div>`;

// Planche image (plan, croquis, page manuscrite) : numéro + nom + image.
const planche = (i, nom, image, { pleinePage = true } = {}) => `
  <div class="ch-planche ${pleinePage ? "ch-planche-page" : ""}">
    <div class="ch-planche-head">
      <span class="ch-planche-num bc">${String(i + 1).padStart(2, "0")}</span>
      <span class="ch-planche-nom bc">${esc(nom)}</span>
    </div>
    <div class="ch-planche-img"><img src="${image}" alt="${esc(nom)}"/></div>
  </div>`;

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// infos       : { client_nom, client_prenom, adresse_bien, description_projet,
//                 observations, notes, date_visite, logements, budget_client,
//                 delai_souhaite }
// statut      : { label, color }
// ouvrages    : lignes profero_ouvrages_selectionnes [{ category, item, quantite, unite, prix_unitaire }]
// lotsOrdre   : noms des lots dans l'ordre d'affichage du chiffrage
// cotes       : [{ nom, localisation, largeur, hauteur }]
// notesPages  : [{ nom, image }] pages manuscrites (PNG data-URL)
// plans       : [{ nom, image }]   croquis : [{ nom, image }]
// medias      : [{ type:"image"|"video", url, label, commentaire }]
export function buildChiffrageDocHTML({ infos = {}, statut, ouvrages = [], lotsOrdre = [], cotes = [], notesPages = [], plans = [], croquis = [], medias = [], logoUrl, dateGen }) {
  const nomClient = `${infos.client_nom || ""} ${infos.client_prenom || ""}`.trim() || "Projet sans client";
  const adresse = (infos.adresse_bien || "").replace(/\s*\n\s*/g, ", ");
  const budget = infos.budget_client != null && infos.budget_client !== "" ? Number(infos.budget_client) : null;
  const logements = Array.isArray(infos.logements) ? infos.logements : [];

  // ── Estimation ──
  const totalLigne = (o) => (parseFloat(o.quantite) || 0) * (parseFloat(o.prix_unitaire) || 0);
  const avecPrix = ouvrages.some(o => o.prix_unitaire != null && o.prix_unitaire !== "" && !isNaN(parseFloat(o.prix_unitaire)));
  const total = ouvrages.reduce((s, o) => s + totalLigne(o), 0);
  const parLot = ouvrages.reduce((a, o) => { const k = o.category || "Autre"; (a[k] = a[k] || []).push(o); return a; }, {});
  const lots = [...lotsOrdre.filter(l => parLot[l]), ...Object.keys(parLot).filter(l => !lotsOrdre.includes(l))];

  // ── Héros ──
  const chips = [
    statut?.label || "",
    infos.date_visite ? `Visite le ${fmtDate(infos.date_visite)}` : "",
    logements.length ? `Composition : ${logements.join(" · ")}` : "",
    ouvrages.length ? `${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""}` : "",
    medias.length ? `${medias.length} média${medias.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const badge = budget != null ? `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Budget client</div>
          <div class="bc" style="font-size:18pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${esc(eur(budget))}</div>
          ${infos.delai_souhaite ? `<div style="font-size:7.5pt;font-weight:600;color:rgba(0,0,0,.6);margin-top:3pt;">${esc(infos.delai_souhaite)}</div>` : ""}
        </div>
      </td>` : infos.delai_souhaite ? `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Délai souhaité</div>
          <div class="bc" style="font-size:14pt;font-weight:800;color:#12151c;line-height:1.1;margin-top:2pt;max-width:150pt;white-space:normal;">${esc(infos.delai_souhaite)}</div>
        </div>
      </td>` : "";

  // ── Client & projet ──
  const ecart = budget != null && avecPrix && total > 0 ? total - budget : null;
  const blocClient = `
  ${sectionTitre("Client &amp; projet")}
  <div class="ch-grid">
    ${carte("Client", `<b>${esc(nomClient)}</b>`)}
    ${carte("Adresse du bien", nl2br(infos.adresse_bien))}
    ${carte("Date de visite", esc(fmtDate(infos.date_visite)))}
    ${carte("Statut du dossier", statut ? `<span class="ch-statut" style="color:${esc(statut.color)};border-color:${esc(statut.color)};">${esc(statut.label)}</span>` : "")}
    ${carte("Budget client", budget != null ? `<b>${esc(eur(budget))}</b> <span class="ch-muted">HT</span>` : "")}
    ${carte("Délai souhaité", esc(infos.delai_souhaite))}
    ${carte("Composition du projet", logements.length ? logements.map(l => `<span class="ch-tag">${esc(l)}</span>`).join(" ") : "")}
    ${carte("Description du projet", nl2br(infos.description_projet), { large: true })}
    ${carte("Observations générales", nl2br(infos.observations), { large: true })}
  </div>`;

  // ── Notes ──
  const blocNotes = (!infos.notes && notesPages.length === 0) ? "" : `
  ${sectionTitre("Notes")}
  ${infos.notes ? `<div class="ch-notes">${nl2br(infos.notes)}</div>` : ""}
  ${notesPages.map((p, i) => planche(i, p.nom || `Notes manuscrites — page ${i + 1}`, p.image)).join("")}`;

  // ── Ouvrages ──
  const colsPrix = avecPrix ? `<th class="num">PU HT</th><th class="num">Total HT</th>` : "";
  const rowsOuvrages = lots.map(lot => {
    const items = parLot[lot];
    const sousTotal = items.reduce((s, o) => s + totalLigne(o), 0);
    return `
      <tr class="ch-lot"><td colspan="${avecPrix ? 5 : 3}"><span class="ch-lot-nom bc">${esc(lot)}</span>${avecPrix && sousTotal > 0 ? `<span class="ch-lot-total">${esc(eur(sousTotal))}</span>` : ""}</td></tr>
      ${items.map(o => {
        const q = parseFloat(o.quantite), pu = parseFloat(o.prix_unitaire), t = totalLigne(o);
        return `<tr>
          <td class="ch-item">${esc(o.item)}</td>
          <td class="num">${isNaN(q) ? "—" : esc(num(q))}</td>
          <td>${esc(o.unite || "")}</td>
          ${avecPrix ? `<td class="num">${isNaN(pu) ? "—" : esc(eur(pu))}</td><td class="num"><b>${t > 0 ? esc(eur(t)) : "—"}</b></td>` : ""}
        </tr>`;
      }).join("")}`;
  }).join("");
  const blocOuvrages = ouvrages.length === 0 ? "" : `
  ${sectionTitre(avecPrix ? "Ouvrages &amp; estimation" : "Ouvrages retenus")}
  <table class="ch-table">
    <thead><tr><th style="text-align:left;">Ouvrage</th><th class="num">Qté</th><th style="text-align:left;">Unité</th>${colsPrix}</tr></thead>
    <tbody>${rowsOuvrages}</tbody>
    ${avecPrix ? `<tfoot><tr class="ch-total"><td colspan="${avecPrix ? 4 : 2}">Estimation totale HT</td><td class="num">${esc(eur(total))}</td></tr></tfoot>` : ""}
  </table>
  ${ecart != null ? `<div class="ch-ecart" style="border-color:${ecart > 0 ? "#f2c2b8" : "#bfe3c9"};background:${ecart > 0 ? "#fff3f0" : "#f0faf3"};">
    Budget client <b>${esc(eur(budget))}</b> · estimation <b>${esc(eur(total))}</b> · écart <b style="color:${ecart > 0 ? "#c0392b" : "#1e8e4e"};">${ecart > 0 ? "+" : "−"}${esc(eur(Math.abs(ecart)))}</b>
  </div>` : ""}
  <div class="ch-note-inline">Estimation indicative issue de la visite — ne vaut pas devis.</div>`;

  // ── Côtes ──
  const blocCotes = cotes.length === 0 ? "" : `
  ${sectionTitre("Côtes menuiseries / huisseries")}
  <table class="ch-table">
    <thead><tr><th style="text-align:left;">Élément</th><th style="text-align:left;">Localisation</th><th class="num">Largeur</th><th class="num">Hauteur</th></tr></thead>
    <tbody>${cotes.map(c => `<tr>
      <td class="ch-item">${esc(c.nom || "(sans nom)")}</td>
      <td>${esc(c.localisation || "—")}</td>
      <td class="num">${c.largeur ? `${esc(num(c.largeur))} cm` : "—"}</td>
      <td class="num">${c.hauteur ? `${esc(num(c.hauteur))} cm` : "—"}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  // ── Plans / croquis ──
  const blocPlans = plans.length === 0 ? "" : `${sectionTitre("Plans")}${plans.map((p, i) => planche(i, p.nom || "Plan", p.image)).join("")}`;
  const blocCroquis = croquis.length === 0 ? "" : `${sectionTitre("Croquis à main levée")}${croquis.map((p, i) => planche(i, p.nom || "Croquis", p.image)).join("")}`;

  // ── Photos & vidéos ──
  const blocMedias = medias.length === 0 ? "" : `
  ${sectionTitre("Photos &amp; vidéos")}
  <div class="ch-medias">
    ${medias.map((m, i) => `
    <div class="ch-media">
      ${m.type === "video"
        ? `<div class="ch-video"><span class="ch-play">▶</span><span>Vidéo</span></div>`
        : `<img src="${esc(m.url)}" alt="${esc(m.label || "")}"/>`}
      <div class="ch-media-txt">
        <div class="ch-media-titre">${esc(m.label || `${m.type === "video" ? "Vidéo" : "Photo"} ${i + 1}`)}</div>
        ${m.commentaire ? `<div class="ch-media-com">${nl2br(m.commentaire)}</div>` : ""}
        ${m.type === "video" ? `<div class="ch-media-url">${esc(m.url)}</div>` : ""}
      </div>
    </div>`).join("")}
  </div>`;

  const cssExtra = `
  /* ── Dossier de chiffrage ── */
  .ch-grid{display:grid;grid-template-columns:1fr 1fr;gap:8pt;}
  .ch-carte{border:1pt solid #e9ebf0;border-radius:9pt;padding:8pt 11pt;background:#fff;break-inside:avoid;page-break-inside:avoid;}
  .ch-carte-label{font-size:7pt;font-weight:700;letter-spacing:1.4pt;text-transform:uppercase;color:#8a90a0;margin-bottom:3pt;}
  .ch-carte-val{font-size:10pt;color:#1a1f2e;line-height:1.45;}
  .ch-muted{color:#8a90a0;font-size:8.5pt;}
  .ch-tag{display:inline-block;padding:2pt 8pt;border-radius:99pt;background:#fff8e0;border:1pt solid #f2e2ad;font-size:8.5pt;font-weight:700;color:#8a6d00;margin:1pt 2pt 1pt 0;}
  .ch-statut{display:inline-block;padding:2pt 9pt;border-radius:99pt;border:1.2pt solid;font-size:8.5pt;font-weight:700;}
  .ch-notes{border:1pt solid #e9ebf0;border-left:3pt solid ${OR};border-radius:9pt;padding:10pt 13pt;font-size:10pt;line-height:1.6;color:#252a35;background:#fff;white-space:normal;}

  .ch-table{width:100%;border-collapse:collapse;font-size:9.5pt;}
  .ch-table th{font-size:7.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;color:#8a90a0;padding:0 8pt 5pt;border-bottom:1.5pt solid #e9ebf0;text-align:left;}
  .ch-table td{padding:5pt 8pt;border-bottom:1pt solid #f0f2f5;vertical-align:top;}
  .ch-table .num{text-align:right;white-space:nowrap;}
  .ch-table tr{break-inside:avoid;page-break-inside:avoid;}
  .ch-item{font-weight:600;color:#1a1f2e;}
  .ch-lot td{padding:9pt 8pt 4pt;border-bottom:1pt solid #e5e7eb;background:transparent;}
  .ch-lot-nom{font-size:11pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:#12151c;padding-left:8pt;border-left:3pt solid ${OR};}
  .ch-lot-total{float:right;font-size:9pt;font-weight:700;color:#4a4f5b;}
  .ch-total td{padding:8pt;font-weight:800;font-size:11pt;color:#12151c;border-top:2pt solid #12151c;border-bottom:none;}
  .ch-ecart{margin-top:9pt;padding:7pt 12pt;border:1pt solid;border-radius:8pt;font-size:9pt;color:#4a4f5b;}
  .ch-note-inline{margin-top:6pt;font-size:8pt;font-style:italic;color:#9aa0ab;}

  .ch-planche{break-inside:avoid;page-break-inside:avoid;margin-top:14pt;}
  .ch-planche-page + .ch-planche-page{page-break-before:always;break-before:page;padding-top:4pt;}
  .ch-planche-head{display:flex;align-items:center;gap:10pt;margin-bottom:8pt;}
  .ch-planche-num{width:24pt;height:24pt;border-radius:7pt;background:#12151c;color:${OR};display:flex;align-items:center;justify-content:center;font-size:12pt;font-weight:800;flex:0 0 auto;}
  .ch-planche-nom{font-size:15pt;font-weight:800;letter-spacing:.5pt;color:#12151c;line-height:1.1;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .ch-planche-img{border:1pt solid #e9ebf0;border-radius:12pt;padding:6pt;background:#fff;box-shadow:0 1pt 2pt rgba(16,24,40,.04);}
  .ch-planche-img img{width:100%;max-height:640pt;object-fit:contain;display:block;border-radius:8pt;}

  .ch-medias{display:grid;grid-template-columns:1fr 1fr;gap:10pt;}
  .ch-media{border:1pt solid #e9ebf0;border-radius:11pt;overflow:hidden;background:#fff;break-inside:avoid;page-break-inside:avoid;}
  .ch-media img{width:100%;height:170pt;object-fit:cover;display:block;background:#f3f4f6;}
  .ch-video{height:170pt;display:flex;align-items:center;justify-content:center;gap:8pt;background:linear-gradient(135deg,#161b28,#232c42);color:#fff;font-size:10pt;font-weight:700;letter-spacing:1pt;text-transform:uppercase;}
  .ch-play{width:30pt;height:30pt;border-radius:50%;background:${OR};color:#12151c;display:inline-flex;align-items:center;justify-content:center;font-size:13pt;}
  .ch-media-txt{padding:7pt 10pt 9pt;}
  .ch-media-titre{font-size:10pt;font-weight:700;color:#12151c;}
  .ch-media-com{font-size:8.5pt;color:#57534a;margin-top:2pt;line-height:1.45;}
  .ch-media-url{font-size:6.5pt;color:#9aa0ab;margin-top:3pt;word-break:break-all;}`;

  const corps = `
  ${blocClient}
  ${blocNotes}
  ${blocOuvrages}
  ${blocCotes}
  ${blocPlans}
  ${blocCroquis}
  ${blocMedias}
  <div style="margin-top:14pt;font-size:8pt;color:#9aa0ab;text-align:right;">Dossier généré le ${esc(dateGen || new Date().toLocaleDateString("fr-FR"))}</div>`;

  return docClientHTML({
    titreDoc: `Chiffrage ${nomClient}`,
    eyebrow: "Chiffrage — Dossier de visite",
    titre: nomClient,
    sousTitre: adresse,
    chips,
    badgeHTML: badge,
    logoUrl,
    corps,
    cssExtra,
  });
}
