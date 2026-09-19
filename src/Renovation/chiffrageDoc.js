// chiffrageDoc — gabarit PDF « Dossier de chiffrage » (page Chiffrage).
//
// Même enveloppe que les autres documents Profero (docClientHTML de
// previsionnelDoc.js : héros sombre à halos, jaune marque, Barlow, pied
// « Document confidentiel ») — toute évolution du décor se fait là-bas.
// Ici : uniquement la MISE EN PAGE du dossier de visite/chiffrage :
//   client (contact, facturation) · chantier & logement · devis (objet, dates,
//   TVA) · notes (texte + pages manuscrites) · ouvrages LOT → ZONE → OUVRAGES
//   avec PU HT, total HT, TVA, TTC · côtes · plans · croquis · photos & vidéos.
//
// Deux variantes :
//   • CLIENT (défaut) : prix de vente et TVA uniquement. AUCUN coût interne,
//     AUCUNE marge n'apparaît, quoi que contiennent les lignes.
//   • INTERNE (`interne: true`) : ajoute coûts matériaux / main-d'œuvre,
//     marge par ligne et globale, état de préparation du devis. À ne jamais
//     envoyer au client.
// Aucun accès DB ; les calculs viennent de chiffragePricing.mjs.
import { docClientHTML, sectionTitre } from "./previsionnelDoc";
import { grouperParLotZone, totauxDevis, totalLigneHT, lireLogementProjet, verifierPreparationDevis, num, ZONE_DEFAUT } from "./chiffragePricing.mjs";
import { parseCodeOuvrage } from "./codeOuvrage.mjs";

const OR = "#FFC200";
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br/>");
const eur = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const numf = (n) => Number(n || 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
};
const lignesAdresse = (adresse, complement, cp, ville, pays) =>
  [adresse, complement, [cp, ville].filter(Boolean).join(" "), pays].map(s => (s || "").trim()).filter(Boolean);

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
// infos       : ligne profero_projets (client_*, chantier_*, logement_reference,
//               type_logement, devis_*, tva_pct, adresse_bien, budget_client…)
// statut      : { label, color }
// ouvrages    : lignes profero_ouvrages_selectionnes (category = lot, zone,
//               quantite, unite, prix_unitaire = PV HT u., snapshot de coûts)
// lotsOrdre   : noms des lots dans l'ordre d'affichage du chiffrage
// groupes / totaux / logement / preparation : pré-calculés par la page (sinon recalculés ici)
// interne     : true = synthèse interne (coûts + marge)
// cotes       : [{ nom, localisation, largeur, hauteur }]
// notesPages  : [{ nom, image }] pages manuscrites (PNG data-URL)
// plans       : [{ nom, image }]   croquis : [{ nom, image }]
// medias      : [{ type:"image"|"video", url, label, commentaire }]
export function buildChiffrageDocHTML({
  infos = {}, statut, ouvrages = [], lotsOrdre = [], groupes = null, totaux = null, logement = null, preparation = null,
  interne = false, cotes = [], notesPages = [], plans = [], croquis = [], medias = [], logoUrl, dateGen,
}) {
  const nomClient = `${infos.client_nom || ""} ${infos.client_prenom || ""}`.trim() || infos.client_societe || "Projet sans client";
  const lg = logement || lireLogementProjet(infos);
  const tvaProjet = num(infos.tva_pct);
  const budget = num(infos.budget_client);
  const grp = groupes || grouperParLotZone(ouvrages, lotsOrdre);
  const tot = totaux || totauxDevis(ouvrages, { tvaPctDefaut: tvaProjet, budgetClient: budget });
  const prep = interne ? (preparation || verifierPreparationDevis(infos, ouvrages, tot)) : null;
  const avecPrix = tot.venteHT > 0 || ouvrages.some(o => num(o.prix_unitaire) != null);

  const adrChantier = lignesAdresse(infos.chantier_adresse, infos.chantier_adresse_complement, infos.chantier_code_postal, infos.chantier_ville, infos.chantier_pays);
  const adresseChantierTexte = adrChantier.length ? adrChantier.join(", ") : (infos.adresse_bien || "").replace(/\s*\n\s*/g, ", ");
  const adrFacturation = lignesAdresse(infos.client_adresse, infos.client_adresse_complement, infos.client_code_postal, infos.client_ville, infos.client_pays);
  const logementTexte = [lg.reference, lg.type].filter(Boolean).join(" · ");

  // ── Héros ──
  const chips = [
    interne ? "DOCUMENT INTERNE — coûts & marge" : "",
    statut?.label || "",
    logementTexte ? `Logement : ${logementTexte}` : "",
    infos.date_visite ? `Visite le ${fmtDate(infos.date_visite)}` : "",
    tvaProjet != null ? `TVA ${pct(tvaProjet)}` : "",
    ouvrages.length ? `${ouvrages.length} ligne${ouvrages.length > 1 ? "s" : ""}` : "",
    medias.length ? `${medias.length} média${medias.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  const badgeBox = (label, valeur, sous) => `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">${esc(label)}</div>
          <div class="bc" style="font-size:18pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${esc(valeur)}</div>
          ${sous ? `<div style="font-size:7.5pt;font-weight:600;color:rgba(0,0,0,.6);margin-top:3pt;">${esc(sous)}</div>` : ""}
        </div>
      </td>`;
  const badge = tot.venteHT > 0
    ? badgeBox("Total HT", eur(tot.venteHT), tot.ttc != null ? `${eur(tot.ttc)} TTC` : "TVA à définir")
    : budget != null ? badgeBox("Budget client", eur(budget), infos.delai_souhaite || "")
    : infos.delai_souhaite ? badgeBox("Délai souhaité", infos.delai_souhaite, "") : "";

  // ── Client & projet ──
  const contact = [infos.client_email, infos.client_telephone].filter(Boolean).map(esc).join(" · ");
  const blocClient = `
  ${sectionTitre("Client, chantier &amp; devis")}
  <div class="ch-grid">
    ${carte("Client", `<b>${esc(nomClient)}</b>${infos.client_societe && nomClient !== infos.client_societe ? `<br/>${esc(infos.client_societe)}` : ""}${contact ? `<br/><span class="ch-muted">${contact}</span>` : ""}`)}
    ${carte("Adresse de facturation", adrFacturation.length ? adrFacturation.map(esc).join("<br/>") : "")}
    ${carte("Adresse du chantier", adrChantier.length ? adrChantier.map(esc).join("<br/>") : nl2br(infos.adresse_bien))}
    ${carte("Logement", logementTexte ? `<b>${esc(logementTexte)}</b>` : "")}
    ${interne && lg.aVerifier ? carte("Ancienne composition (à vérifier)", `<span style="color:#b45309;">${esc(lg.legacy.join(" · "))} — un projet par logement à créer</span>`) : ""}
    ${carte("Objet du devis", esc(infos.devis_objet))}
    ${carte("Dates du devis", [infos.devis_date ? `Préparé le ${fmtDate(infos.devis_date)}` : "", infos.devis_validite ? `valable jusqu'au ${fmtDate(infos.devis_validite)}` : ""].filter(Boolean).map(esc).join(" · "))}
    ${carte("TVA appliquée", tvaProjet != null ? `<b>${esc(pct(tvaProjet))}</b>` : interne ? `<span style="color:#c0392b;">à choisir</span>` : "")}
    ${carte("N° de commande client", esc(infos.devis_num_commande_client))}
    ${carte("Date de visite", esc(fmtDate(infos.date_visite)))}
    ${carte("Statut du dossier", statut ? `<span class="ch-statut" style="color:${esc(statut.color)};border-color:${esc(statut.color)};">${esc(statut.label)}</span>` : "")}
    ${carte("Budget client", budget != null ? `<b>${esc(eur(budget))}</b> <span class="ch-muted">HT</span>` : "")}
    ${carte("Délai souhaité", esc(infos.delai_souhaite))}
    ${carte("Description du projet", nl2br(infos.description_projet), { large: true })}
    ${carte("Observations générales", nl2br(infos.observations), { large: true })}
    ${carte("Conditions particulières", nl2br(infos.devis_conditions), { large: true })}
  </div>`;

  // ── Notes ──
  const blocNotes = (!infos.notes && notesPages.length === 0) ? "" : `
  ${sectionTitre("Notes")}
  ${infos.notes ? `<div class="ch-notes">${nl2br(infos.notes)}</div>` : ""}
  ${notesPages.map((p, i) => planche(i, p.nom || `Notes manuscrites — page ${i + 1}`, p.image)).join("")}`;

  // ── Ouvrages : LOT → ZONE → OUVRAGES ──
  const nbCols = 3 + (avecPrix ? 2 : 0) + (interne ? 2 : 0);
  const enteteCols = `<th style="text-align:left;">Ouvrage</th><th class="num">Qté</th><th style="text-align:left;">Unité</th>${avecPrix ? `<th class="num">PU HT</th><th class="num">Total HT</th>` : ""}${interne ? `<th class="num">Coût u.</th><th class="num">Marge</th>` : ""}`;
  const rowsOuvrages = grp.map(g => {
    const zonesHtml = g.zones.map(z => {
      const multiZones = g.zones.length > 1 || z.zone !== ZONE_DEFAUT;
      const enteteZone = multiZones ? `<tr class="ch-zone"><td colspan="${nbCols}"><span class="ch-zone-nom">${esc(z.zone)}</span>${avecPrix && g.zones.length > 1 && z.total > 0 ? `<span class="ch-zone-total">${esc(eur(z.total))}</span>` : ""}</td></tr>` : "";
      const lignes = z.lignes.map(o => {
        const q = num(o.quantite), pu = num(o.prix_unitaire), t = totalLigneHT(o);
        const code = o.code_ouvrage || parseCodeOuvrage(o.item)?.code || "";
        const libelle = parseCodeOuvrage(o.item)?.reste || o.item || "";
        const coutU = num(o.cout_total_unitaire);
        const margeLigne = coutU != null && pu != null && pu > 0 ? `${esc(eur((pu - coutU) * (q ?? 0)))}<br/><span class="ch-muted">${esc(pct(o.taux_marge_pct))}</span>` : "—";
        const tvaLigne = num(o.tva_pct);
        return `<tr>
          <td class="ch-item">${code ? `<span class="ch-code">${esc(code)}</span> ` : ""}${esc(libelle)}${tvaLigne != null && tvaProjet != null && tvaLigne !== tvaProjet ? ` <span class="ch-muted">(TVA ${esc(pct(tvaLigne))})</span>` : ""}</td>
          <td class="num">${q == null ? "—" : esc(numf(q))}</td>
          <td>${esc(o.unite || "")}</td>
          ${avecPrix ? `<td class="num">${pu == null ? "—" : esc(eur(pu))}</td><td class="num"><b>${t != null ? esc(eur(t)) : "—"}</b></td>` : ""}
          ${interne ? `<td class="num">${coutU == null ? `<span class="ch-muted">prix saisi</span>` : esc(eur(coutU))}</td><td class="num">${margeLigne}</td>` : ""}
        </tr>`;
      }).join("");
      return enteteZone + lignes;
    }).join("");
    return `
      <tr class="ch-lot"><td colspan="${nbCols}"><span class="ch-lot-nom bc">${esc(g.lot)}</span>${avecPrix && g.total > 0 ? `<span class="ch-lot-total">${esc(eur(g.total))}</span>` : ""}</td></tr>
      ${zonesHtml}`;
  }).join("");
  const tvaLignes = tot.tva == null
    ? `<tr class="ch-soustotal"><td colspan="${nbCols - 1}">TVA</td><td class="num">à définir</td></tr>`
    : Object.entries(tot.tvaDetail || {}).map(([k, v]) => `<tr class="ch-soustotal"><td colspan="${nbCols - 1}">TVA ${esc(pct(k))}</td><td class="num">${esc(eur(v))}</td></tr>`).join("");
  const footOuvrages = !avecPrix ? "" : `
    <tfoot>
      <tr class="ch-soustotal"><td colspan="${nbCols - 1}">Total HT</td><td class="num">${esc(eur(tot.venteHT))}</td></tr>
      ${tvaLignes}
      <tr class="ch-total"><td colspan="${nbCols - 1}">Total TTC</td><td class="num">${tot.ttc == null ? "—" : esc(eur(tot.ttc))}</td></tr>
    </tfoot>`;
  const ecart = tot.ecartBudget;
  const blocOuvrages = ouvrages.length === 0 ? "" : `
  ${sectionTitre(avecPrix ? (interne ? "Ouvrages, prix &amp; coûts" : "Ouvrages &amp; prix") : "Ouvrages retenus")}
  <table class="ch-table">
    <thead><tr>${enteteCols}</tr></thead>
    <tbody>${rowsOuvrages}</tbody>
    ${footOuvrages}
  </table>
  ${tot.nbLignesSansPrix > 0 ? `<div class="ch-note-inline">${tot.nbLignesSansPrix} ligne${tot.nbLignesSansPrix > 1 ? "s" : ""} sans prix (non comptée${tot.nbLignesSansPrix > 1 ? "s" : ""} dans les totaux).</div>` : ""}
  ${ecart != null ? `<div class="ch-ecart" style="border-color:${ecart > 0 ? "#f2c2b8" : "#bfe3c9"};background:${ecart > 0 ? "#fff3f0" : "#f0faf3"};">
    Budget client <b>${esc(eur(budget))}</b> · devis HT <b>${esc(eur(tot.venteHT))}</b> · écart <b style="color:${ecart > 0 ? "#c0392b" : "#1e8e4e"};">${ecart > 0 ? "+" : "−"}${esc(eur(Math.abs(ecart)))}</b>
  </div>` : ""}
  ${interne ? "" : `<div class="ch-note-inline">Estimation issue de la visite — le devis officiel sera émis séparément.</div>`}`;

  // ── Synthèse interne : coûts, marge, préparation ──
  const blocInterne = !interne ? "" : `
  ${sectionTitre("Synthèse interne — coûts &amp; marge")}
  <div class="ch-grid">
    ${carte("Total vente HT", `<b>${esc(eur(tot.venteHT))}</b>`)}
    ${carte("Coût total", `<b>${esc(eur(tot.coutTotal))}</b>${tot.coutsIncomplets ? ` <span class="ch-muted">(partiel : lignes à prix saisi)</span>` : ""}`)}
    ${carte("Coût matériaux", esc(eur(tot.coutMateriaux)))}
    ${carte("Coût main-d'œuvre", esc(eur(tot.coutMainOeuvre)))}
    ${carte("Coûts directs", esc(eur(tot.coutDirect)))}
    ${carte("Marge", tot.marge == null ? `<span class="ch-muted">non fiable (lignes sans coût figé)</span>` : `<b style="color:${tot.marge >= 0 ? "#1e8e4e" : "#c0392b"};">${esc(eur(tot.marge))}</b> · taux réel global <b>${esc(pct(tot.tauxMargeReel))}</b> <span class="ch-muted">(pondéré, pas une moyenne)</span>`)}
    ${carte("TVA / TTC", tot.ttc == null ? `<span style="color:#c0392b;">TVA à choisir</span>` : `${esc(eur(tot.tva))} · <b>${esc(eur(tot.ttc))} TTC</b>`)}
    ${prep ? carte(prep.pret ? "Devis prêt à préparer" : `Devis à compléter (${prep.bloquants.length} bloquant${prep.bloquants.length > 1 ? "s" : ""})`,
      `${prep.bloquants.map(b => `<div style="color:#c0392b;">✕ ${esc(b)}</div>`).join("")}${prep.avertissements.map(a => `<div style="color:#b45309;">△ ${esc(a)}</div>`).join("")}${prep.pret && prep.avertissements.length === 0 ? `<span style="color:#1e8e4e;">Toutes les informations nécessaires sont présentes.</span>` : ""}`, { large: true }) : ""}
  </div>`;

  // ── Côtes ──
  const blocCotes = cotes.length === 0 ? "" : `
  ${sectionTitre("Côtes menuiseries / huisseries")}
  <table class="ch-table">
    <thead><tr><th style="text-align:left;">Élément</th><th style="text-align:left;">Localisation</th><th class="num">Largeur</th><th class="num">Hauteur</th></tr></thead>
    <tbody>${cotes.map(c => `<tr>
      <td class="ch-item">${esc(c.nom || "(sans nom)")}</td>
      <td>${esc(c.localisation || "—")}</td>
      <td class="num">${c.largeur ? `${esc(numf(c.largeur))} cm` : "—"}</td>
      <td class="num">${c.hauteur ? `${esc(numf(c.hauteur))} cm` : "—"}</td>
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
  .ch-code{display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:8pt;font-weight:800;color:#12151c;background:#fff3c2;border:1pt solid #f2e2ad;border-radius:4pt;padding:0 5pt;margin-right:3pt;}
  .ch-lot td{padding:9pt 8pt 4pt;border-bottom:1pt solid #e5e7eb;background:transparent;}
  .ch-lot-nom{font-size:11pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:#12151c;padding-left:8pt;border-left:3pt solid ${OR};}
  .ch-lot-total{float:right;font-size:9pt;font-weight:700;color:#4a4f5b;}
  .ch-zone td{padding:6pt 8pt 3pt 18pt;border-bottom:1pt dashed #e9ebf0;background:#fafbfc;}
  .ch-zone-nom{font-size:8.5pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:#4a4f5b;}
  .ch-zone-total{float:right;font-size:8.5pt;font-weight:700;color:#8a90a0;}
  .ch-soustotal td{padding:6pt 8pt;font-weight:700;font-size:9.5pt;color:#4a4f5b;border-top:1pt solid #e5e7eb;border-bottom:none;}
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
  ${blocInterne}
  ${blocNotes}
  ${blocOuvrages}
  ${blocCotes}
  ${blocPlans}
  ${blocCroquis}
  ${blocMedias}
  <div style="margin-top:14pt;font-size:8pt;color:#9aa0ab;text-align:right;">${interne ? "Synthèse interne — ne pas transmettre au client · " : ""}Dossier généré le ${esc(dateGen || new Date().toLocaleDateString("fr-FR"))}</div>`;

  return docClientHTML({
    titreDoc: `${interne ? "Synthèse interne" : "Chiffrage"} ${nomClient}${logementTexte ? ` — ${logementTexte}` : ""}`,
    eyebrow: interne ? "Chiffrage — Synthèse interne (confidentiel)" : "Chiffrage — Dossier de visite",
    titre: nomClient,
    sousTitre: [adresseChantierTexte, lg.reference].filter(Boolean).join(" · "),
    chips,
    badgeHTML: badge,
    logoUrl,
    corps,
    cssExtra,
  });
}
