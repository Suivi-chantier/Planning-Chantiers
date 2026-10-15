// ─────────────────────────────────────────────────────────────────────────────
// Dossier PDF d'un relevé iMapper (lot 4) — modèle : le PDF prototype « plan de
// l'existant » du 15/10/2026.
//   page 1 (A3 paysage) : plan d'ensemble à l'échelle (1:50 si le logement
//     tient sur la feuille, sinon l'échelle normalisée suivante), tableau des
//     métrés par pièce, liste des ouvertures, légende ;
//   une page A4 par pièce : vue de la pièce (surlignée), métrés, photos du
//     relevé, observations VALIDÉES, points encore à vérifier ;
//   dernière page : les points à valider.
// Le contenu vient de syntheseDossier (releveImapper.mjs, pur et testé) ; le
// dessin, de planRendu.dessinerScene (le même que l'écran et la visionneuse),
// rejoué dans l'enregistreur SVG de planPdf.js : un plan vectoriel, net à
// toutes les échelles. Ici, on ne calcule aucun chiffre.
// ─────────────────────────────────────────────────────────────────────────────
import { contexteSVG, choisirEchelle } from "./planPdf";
import { cadreDessin, calerVueEchelle, dessinerScene } from "./planRendu";
import { syntheseDossier, texteMetre, HSP_DEFAUT, HAUTEURS_DEFAUT } from "./releveImapper";

const PX_MM = 4;                           // px logiques par mm papier (comme planPdf)
const ECHELLES_PIECE = [20, 25, 50, 75, 100, 125, 150, 200];
const OR = "#f5a623";
const ORANGE = "#d9480f";
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fr = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");
const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

// Dessin de la scène dans une zone de zoneW × zoneH mm, à l'échelle 1:den
// (ou ajustée si den est null), centrée sur `cadre`.
function svgScene(data, cadre, zoneW, zoneH, den, opts = {}) {
  const W = Math.round(zoneW * PX_MM), H = Math.round(zoneH * PX_MM);
  const scale = den ? (1000 / den) * PX_MM : Math.min(W / (cadre.w * 1.08), H / (cadre.h * 1.08));
  const vp = calerVueEchelle(cadre, W, H, scale);
  const ctx = contexteSVG();
  if (vp) dessinerScene(ctx, data, W, H, vp, { calques: { points: false }, ...opts });
  return `<svg viewBox="0 0 ${W} ${H}" width="${zoneW}mm" height="${zoneH}mm" preserveAspectRatio="xMidYMid meet"
    shape-rendering="geometricPrecision" style="display:block;"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>${ctx.corpsSVG()}</svg>`;
}
const reglet = (den) => (den ? `<div class="reglet"><span style="width:${(1000 / den).toFixed(1)}mm"></span>1 m</div>` : "");

// Cadre d'une pièce : son emprise, élargie de 0,6 m (on voit le début des voisines).
function cadrePiece(piece) {
  const xs = piece.polygone.map((q) => q[0]), ys = piece.polygone.map((q) => q[1]);
  const m = 0.6;
  const minX = Math.min(...xs) - m, maxX = Math.max(...xs) + m, minY = Math.min(...ys) - m, maxY = Math.max(...ys) + m;
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function pied(s, n, total) {
  return `<div class="pied"><div>Relevé iMapper${s.importe_le ? ` importé le ${dateFr(s.importe_le)}` : ""} · document généré le ${dateFr(new Date().toISOString())} — à valider par le conducteur de travaux.<br/>
    Hauteur sous plafond ${fr(HSP_DEFAUT)} m par défaut, non mesurée, sauf mention. Cotes intérieures en cm, largeurs d'ouverture à ± 5 cm.</div><div>${n} / ${total}</div></div>`;
}
function entete(titre, sous, droite) {
  return `<div class="entete"><div><div class="titre bc">${titre}</div><div class="sous">${sous}</div></div>
    <div class="droite"><div class="marque bc">PROFERO</div><div class="sous">${droite}</div></div></div>`;
}

export function construireDossierReleveHTML({ data, nom = "Relevé", chantier = "", urlsPhotos = {} }) {
  const releve = data?.releve;
  const s = syntheseDossier(releve);
  if (!s) return "<p>Ce plan n'a pas de relevé iMapper.</p>";
  const m = s.metres;
  const total = 1 + s.pieces.length + 1;
  const titre = `${esc(nom)}${chantier ? ` — ${esc(chantier)}` : ""}`;
  const droite = `Relevé de l'existant${s.importe_le ? ` · ${dateFr(s.importe_le)}` : ""}`;

  // ── Page 1 : plan d'ensemble ────────────────────────────────────────────
  const zoneW = 250, zoneH = 228;
  const cadre = cadreDessin(data);
  let den = cadre ? choisirEchelle(cadre, data.planRotation, zoneW, zoneH - 8) : null;
  if (den && den < 50) den = 50;   // le prototype : 1:50 au plus près
  const plan = cadre ? svgScene(data, cadre, zoneW, zoneH - 8, den) : "";
  const val = (l, k) => (l[k] == null ? `<em class="att">en attente</em>` : esc(texteMetre(l[k], l.approx?.[k], l.raison)));
  const lignes = m.pieces.map((l) => `<tr><td>${esc(l.nom)}</td><td>${fr(l.sol)}</td><td>${fr(l.perimetre)}</td>
    <td>${val(l, "plinthes")}</td><td>${val(l, "murs_bruts")}</td><td>${val(l, "murs_nets")}</td></tr>`).join("");
  const ouv = s.ouvertures.map((o) => `<tr class="${o.a_verifier ? "av" : ""}"><td class="code">${esc(o.code)}</td>
    <td>${o.a_placer ? "à placer" : `≈ ${o.largeur_cm} cm`}</td><td>${esc(o.entre)}</td>
    <td>${esc(o.type_label)}${o.note ? ` — ${esc(o.note)}` : ""}</td></tr>`).join("");
  const page1 = `<section class="page a3">
    ${entete(`${titre} — Plan de l'existant`, `${s.nb_pieces} pièces · ${fr(s.surface)} m² habitables · ${den ? `échelle 1:${den} sur A3` : "hors échelle normalisée"}`, droite)}
    <div class="corps">
      <div class="plan">${plan}${reglet(den)}</div>
      <div class="colonne">
        <h2>Métrés par pièce</h2>
        <table class="metres"><thead><tr><th>Pièce</th><th>Sol (m²)</th><th>Périm. (m)</th><th>Plinthes (m)</th><th>Murs bruts (m²)</th><th>Murs nets (m²)</th></tr></thead>
          <tbody>${lignes}<tr class="tot"><td>Total</td><td>${fr(m.total.sol)}</td><td>${fr(m.total.perimetre)}</td>
          <td>${val(m.total, "plinthes")}</td><td>${val(m.total, "murs_bruts")}</td><td>${val(m.total, "murs_nets")}</td></tr></tbody></table>
        <p class="note">Hypothèses de hauteur : sous plafond ${fr(HSP_DEFAUT)} m par défaut · portes ${fr(HAUTEURS_DEFAUT.porte)} m · fenêtres ${fr(HAUTEURS_DEFAUT.fenetre)} m · baies ${fr(HAUTEURS_DEFAUT.baie)} m, sauf hauteur saisie.
          Plinthes = périmètre − largeurs des portes et baies. « ≈ » : valeur qui dépend d'une hypothèse ou d'une ouverture à vérifier.</p>
        <h2>Ouvertures</h2>
        ${s.ouvertures.length ? `<table class="ouv"><tbody>${ouv}</tbody></table>` : `<p class="note">${releve.ouvertures === null ? "Portes et fenêtres pas encore relevées." : "Aucune ouverture."}</p>`}
        <div class="leg"><span class="carre"></span> détectée, confirmée sur photo ou validée
          <span class="carre orange"></span> à vérifier sur place (pointillés)</div>
        <p class="note">Largeurs = trous mesurés dans le relevé, à ± 5 cm. Hauteurs d'allège et de linteau inconnues sauf saisie.</p>
      </div>
    </div>
    ${pied(s, 1, total)}
  </section>`;

  // ── Une page par pièce ──────────────────────────────────────────────────
  const pagesPieces = s.pieces.map((p, i) => {
    const piece = releve.pieces.find((x) => x.id === p.id);
    const l = p.metres;
    const c = cadrePiece(piece);
    const zw = 186, zh = 92;
    const dp = ECHELLES_PIECE.find((d) => (c.w * 1000) / d <= zw && (c.h * 1000) / d <= zh - 6) || null;
    const vue = svgScene(data, c, zw, zh - 6, dp, { releve: { pieceSurlignee: p.id } });
    const metr = (k, lab, u) => `${lab} ${l[k] == null ? "en attente des ouvertures" : `${esc(texteMetre(l[k], l.approx?.[k], l.raison))} ${u}`}`;
    const photos = p.photos.slice(0, 10).map((ph) => {
      const url = urlsPhotos[ph.chemin];
      return `<figure>${url ? `<img src="${esc(url)}" alt=""/>` : `<div class="vide">photo indisponible</div>`}<span class="num">${ph.num}</span></figure>`;
    }).join("");
    return `<section class="page a4">
      ${entete(`${esc(nom)} — ${esc(p.nom)}`, `${metr("sol", "Sol", "m²")} · ${metr("perimetre", "périmètre", "m")} · ${metr("plinthes", "plinthes", "m")} · ${metr("murs_nets", "murs", "m² nets")}`, droite)}
      <div class="vue">${vue}${reglet(dp)}</div>
      <div class="infos">Hauteur sous plafond ${fr(p.hsp)} m ${p.hsp_mesuree ? "(saisie)" : "(par défaut, non mesurée)"}${p.ouvertures.length ? ` · ouvertures : ${esc(p.ouvertures.join(", "))}` : ""}</div>
      <h3>Photos du relevé iMapper (numérotation iMapper)</h3>
      ${p.photos.length ? `<div class="photos">${photos}</div>` : `<p class="note">Aucune photo rattachée à cette pièce.</p>`}
      <h3>Observations validées</h3>
      ${p.observations.length ? `<ul>${p.observations.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : `<p class="note">Aucune observation validée pour cette pièce.</p>`}
      ${p.alertes.length ? `<h3 class="orange">À vérifier sur place</h3><ul class="orange">${p.alertes.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
      ${pied(s, i + 2, total)}
    </section>`;
  }).join("");

  // ── Points à valider ────────────────────────────────────────────────────
  const pagePoints = `<section class="page a4">
    ${entete(`${esc(nom)} — Points à valider`, "Ce que l'outil n'a pas pu établir seul", droite)}
    ${s.points.length ? `<ol class="points">${s.points.map((p) => `<li>${esc(p.texte)}</li>`).join("")}</ol>` : `<p class="note">Plus aucun point à valider sur ce relevé.</p>`}
    ${pied(s, total, total)}
  </section>`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>${titre} — Relevé de l'existant</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#6b7280;}
  body{font-family:'Barlow',Arial,Helvetica,sans-serif;color:#1f2937;font-size:8.5pt;}
  .bc{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;}
  .page{background:#fff;margin:6mm auto;padding:12mm;position:relative;box-shadow:0 2mm 6mm rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;}
  .a3{width:420mm;height:297mm;page:a3;}
  .a4{width:210mm;height:297mm;page:a4;}
  @page a3{size:A3 landscape;margin:0;}
  @page a4{size:A4 portrait;margin:0;}
  .entete{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:5mm;}
  .titre{font-size:17pt;font-weight:800;color:#12151c;}
  .sous{font-size:8.5pt;color:#5a6172;margin-top:1mm;}
  .droite{text-align:right;}
  .marque{font-size:15pt;font-weight:800;letter-spacing:.5pt;color:#12151c;}
  .corps{flex:1;display:flex;gap:10mm;min-height:0;}
  .plan{flex:0 0 250mm;}
  .colonne{flex:1;min-width:0;}
  h2{font-size:11pt;font-weight:700;margin:2mm 0 3mm;}
  h3{font-size:10pt;font-weight:700;margin:4mm 0 2mm;}
  h3.orange,ul.orange{color:${ORANGE};}
  table{width:100%;border-collapse:collapse;}
  .metres th{font-size:7pt;color:#5a6172;text-align:right;font-weight:700;padding:1.2mm 1mm;border-bottom:0.3mm solid #9aa0ab;}
  .metres th:first-child,.metres td:first-child{text-align:left;}
  .metres td{text-align:right;padding:1.6mm 1mm;border-bottom:0.15mm solid #e5e7eb;}
  .metres .tot td{font-weight:700;border-top:0.3mm solid #9aa0ab;}
  .att{color:${ORANGE};}
  .ouv td{padding:1.1mm 1mm;font-size:8pt;vertical-align:top;}
  .ouv td.code{font-weight:700;width:10mm;}
  .ouv tr.av td{color:${ORANGE};}
  .leg{margin:3mm 0;font-size:7.5pt;display:flex;align-items:center;gap:2mm;flex-wrap:wrap;}
  .carre{display:inline-block;width:3mm;height:3mm;background:#1f2937;}
  .carre.orange{background:${ORANGE};margin-left:4mm;}
  .note{font-size:7pt;color:#7a8190;margin:2mm 0;line-height:1.4;}
  .reglet{display:flex;align-items:center;gap:1.5mm;font-size:7pt;margin-top:1mm;}
  .reglet span{display:inline-block;height:0.6mm;background:#1f2937;}
  .vue{border:0.2mm solid #e5e7eb;}
  .infos{font-size:8pt;color:#5a6172;margin-top:2mm;}
  .photos{display:grid;grid-template-columns:repeat(5,1fr);gap:2.5mm;}
  figure{position:relative;aspect-ratio:3/4;background:#f3f4f6;overflow:hidden;border-radius:1mm;}
  figure img{width:100%;height:100%;object-fit:cover;display:block;}
  figure .vide{font-size:7pt;color:#9aa0ab;padding:2mm;}
  figure .num{position:absolute;top:1mm;left:1mm;background:#1f2937;color:#fff;border-radius:3mm;font-size:7pt;font-weight:700;padding:0.3mm 1.6mm;}
  ul,ol{padding-left:5mm;line-height:1.5;}
  ol.points li{margin-bottom:3mm;font-size:10pt;}
  ol.points li::marker{color:${ORANGE};font-weight:700;}
  .pied{margin-top:auto;padding-top:3mm;display:flex;justify-content:space-between;align-items:flex-end;font-size:6.5pt;color:#9aa0ab;gap:6mm;}
  .btn-imprimer{position:fixed;right:10mm;bottom:6mm;z-index:9;border:0;border-radius:8px;padding:9px 16px;background:#12151c;color:${OR};
    font-family:'Barlow',Arial,sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);}
  @media print{
    html,body{background:#fff;}
    .page{margin:0;box-shadow:none;break-after:page;}
    .btn-imprimer{display:none;}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  }
</style></head><body>
${page1}${pagesPieces}${pagePoints}
<button class="btn-imprimer" onclick="window.print()">Imprimer</button>
</body></html>`;
}

// La fenêtre est ouverte par l'appelant DANS le geste du clic (sinon le
// navigateur la bloque), puis remplie ici une fois les liens des photos obtenus.
export function remplirFenetreDossier(w, html, titre) {
  if (!w || w.closed) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  if (titre) w.document.title = titre;
  // Impression quand photos et polices sont chargées.
  const go = () => setTimeout(() => { w.focus(); w.print(); }, 300);
  w.onload = () => { (w.document.fonts?.ready || Promise.resolve()).then(go, go); };
}
