import { OR, HALO_OR, HALO_BLEU, sectionTitre } from './previsionnelDoc';
export const echapperPlanning = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc = echapperPlanning;
const color = c => /^#[a-f0-9]{6}$/i.test(c || '') ? c : '#64748b';
const blanc = c => {const h=color(c);return parseInt(h.slice(1,3),16)*.299+parseInt(h.slice(3,5),16)*.587+parseInt(h.slice(5),16)*.114<158?'#fff':'#1a1f2e';};
const section = t => sectionTitre(t).replace('margin:20pt 0 12pt','margin:11pt 0 7pt').replace('font-size:13pt','font-size:12pt');
export function buildPlanningHebdoDoc({week,year,dates,chantiers,cells,objectifs=[],remarques='',getDisplayTaches,imprimeLe,baseUrl}) {
  const jours=['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
  const actifs=chantiers.filter(c=>jours.some(j=>{const x=cells[`${c.id}_${j}`];return x?.planifie||x?.taches?.length||x?.ouvriers?.length;}));
  const rows=actifs.map(c=>`<tr><td class="lot" style="border-left-color:${color(c.couleur)}"><span class="bc">${esc(c.nom)}</span></td>${jours.map(j=>{const cell=cells[`${c.id}_${j}`]||{};return `<td>${getDisplayTaches(cell).map(t=>`<div class="t"><span class="puce" style="background:${color(c.couleur)}"></span><span class="tx">${esc(t.text)}</span>${t.duree?`<span class="d">${esc(t.duree)}h</span>`:''}</div>`).join('')}${cell.ouvriers?.length?`<div class="ouv">${cell.ouvriers.map(o=>`<span style="background:${color(c.couleur)};color:${blanc(c.couleur)}">${esc(o)}</span>`).join('')}</div>`:''}</td>`;}).join('')}</tr>`).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><base href="${esc(baseUrl)}"><title>Planning S${week} ${year}</title><link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet"><style>
  @page{size:A4 landscape;margin:8mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Barlow',Arial,Helvetica,sans-serif;color:#1a1f2e;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .bc{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif}
  .hero{position:relative;overflow:hidden;border-radius:12pt;background:linear-gradient(135deg,#161b28 0%,#232c42 55%,#2e2840 100%);padding:11pt 18pt}
  .chip{display:inline-block;padding:2.5pt 9pt;border-radius:99pt;background:rgba(255,255,255,.09);border:1pt solid rgba(255,255,255,.18);color:rgba(255,255,255,.88);font-size:8pt;font-weight:600;white-space:nowrap}
  .objs{display:grid;grid-template-columns:repeat(4,1fr);gap:6pt}
  .obj{border:1pt solid #e9ebf0;border-left:4pt solid;border-radius:9pt;padding:6pt 10pt 7pt;box-shadow:0 1pt 2pt rgba(16,24,40,.04)}
  .oh{display:flex;justify-content:space-between;align-items:center;gap:6pt}
  .oc{font-size:7pt;font-weight:800;letter-spacing:.9pt;text-transform:uppercase;color:#8a90a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .oj{border-radius:99pt;padding:1pt 7pt;font-size:7.5pt;font-weight:700;white-space:nowrap}
  .otit{font-size:12.5pt;font-weight:800;color:#12151c;line-height:1.15;margin-top:2pt}
  .ot{font-size:8.5pt;line-height:1.35;color:#4a4f5b;margin-top:1pt}
  table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed}
  th{background:#161b28;color:#fff;padding:5pt 7pt;text-align:left}
  th:first-child{border-radius:9pt 0 0 0} th:last-child{border-radius:0 9pt 0 0}
  th .j{font-family:'Barlow Condensed',sans-serif;font-size:11.5pt;font-weight:800;letter-spacing:1.2pt;text-transform:uppercase}
  th .dt{font-size:8pt;font-weight:600;color:#FFC200;margin-left:5pt}
  th.cha{width:92px;font-size:7.5pt;font-weight:800;letter-spacing:1pt;text-transform:uppercase;color:rgba(255,255,255,.7)}
  td{border-bottom:1pt solid #e9ebf0;border-right:1pt solid #f0f1f4;padding:4pt 6pt 5pt;vertical-align:top}
  td:last-child{border-right:none}
  td.lot{background:#f6f7f9;border-left:4pt solid;vertical-align:middle;padding:4pt 7pt}
  td.lot .bc{font-size:10.5pt;font-weight:800;letter-spacing:.5pt;text-transform:uppercase;color:#12151c;line-height:1.15;display:block}
  .t{display:flex;align-items:flex-start;gap:4pt;font-size:9pt;line-height:1.28;color:#252a35;font-weight:600;margin-bottom:1.5pt}
  .puce{width:4pt;height:4pt;border-radius:50%;margin-top:4.6pt;flex:0 0 auto}
  .tx{flex:1;min-width:0}
  .d{flex:0 0 auto;font-weight:700;color:#12151c;font-size:8.3pt;white-space:nowrap;padding-left:3pt}
  .ouv{display:flex;flex-wrap:wrap;gap:2.5pt;margin-top:4pt}
  .ouv span{display:inline-block;border-radius:99pt;padding:.5pt 6pt;font-size:7.8pt;font-weight:700;white-space:nowrap}
  tr{page-break-inside:avoid}
  .enc{margin-top:9pt;background:#fff8e0;border:1pt solid #f2e2ad;border-radius:9pt;padding:6pt 12pt 7pt}
  .enc-t{font-size:8pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;color:#8a6d00;margin-bottom:2pt}
  .enc ul{list-style:none;display:flex;flex-wrap:wrap;gap:2pt 28pt}
  .enc li{font-size:9.5pt;color:#57534a;line-height:1.45}
  .enc b{color:#3d3a33}
  .foot{margin-top:8pt;padding-top:6pt;border-top:1pt solid #e9eaee;display:flex;justify-content:space-between;align-items:baseline}
  .foot span{font-size:7.5pt;color:#b3b8c2}

  body{width:281mm}#page{width:281mm;transform-origin:top left}.sheet{overflow:hidden;width:281mm}@media print{body{height:194mm;overflow:hidden}.sheet{height:194mm}} .obj,.enc{break-inside:avoid}
  </style></head><body><div class="sheet"><div id="page">
  <div class="hero"><div style="position:absolute;right:-45pt;top:-60pt;width:170pt;height:170pt;border-radius:50%;background:${HALO_OR}"></div><div style="position:absolute;left:-35pt;bottom:-80pt;width:150pt;height:150pt;border-radius:50%;background:${HALO_BLEU}"></div>
  <table style="position:relative;border-collapse:collapse"><tr><td style="border:none;padding:0;width:120pt;vertical-align:middle"><img src="/logos/profero-reno-h.png" style="height:24pt"></td><td style="border:none;padding:0 0 0 16pt"><div style="font-size:7.5pt;font-weight:700;letter-spacing:2.5pt;color:${OR}">PLANNING HEBDOMADAIRE — RÉNOVATION</div><div><span class="bc" style="font-size:22pt;color:#fff;font-weight:800">Semaine ${week}</span> <span style="font-size:10pt;color:#bdc0c9">${esc(dates[0].toLocaleDateString('fr-FR',{day:'numeric',month:'long'}))} – ${esc(dates[4].toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}))}</span></div></td><td style="border:none;padding:0;text-align:right;width:180pt"><span class="chip">${actifs.length} chantiers actifs</span> <span class="chip">${objectifs.length} objectifs</span><div style="font-size:7.5pt;color:#a2a5b0;margin-top:5pt">Imprimé le ${esc(imprimeLe)}</div></td></tr></table></div>
  ${objectifs.length?section('Objectifs de la semaine')+`<div class="objs">${objectifs.map(o=>`<div class="obj" style="border-left-color:${color(o.couleur)}"><div class="oh"><span class="oc">${esc(o.libelle_groupe)}</span><span class="oj" style="background:${color(o.couleur)};color:${blanc(o.couleur)}">${esc(o.jour)}</span></div><div class="otit bc">${esc(o.titre)}</div><div class="ot">${esc(o.detail)}</div></div>`).join('')}</div>`:''}
  ${section('Planning de la semaine')}<table><thead><tr><th class="cha">Chantier</th>${jours.map((j,i)=>`<th><span class="j">${j}</span><span class="dt">${dates[i].getDate()} ${dates[i].toLocaleDateString('fr-FR',{month:'short'})}</span></th>`).join('')}</tr></thead><tbody>${rows||'<tr><td colspan="6">Rien de planifié cette semaine.</td></tr>'}</tbody></table>
  ${remarques.trim()?`<div class="enc"><div class="enc-t">Remarques</div><ul>${remarques.split('\n').filter(x=>x.trim()).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  <div class="foot"><span style="font-weight:700;letter-spacing:1.2pt;text-transform:uppercase">Profero — Rénovation &amp; réhabilitation</span><span>Document confidentiel</span></div></div></div></body></html>`;
}
export async function imprimerPlanningHebdo(fenetre,html) {
  fenetre.document.write(html);fenetre.document.close();
  await fenetre.document.fonts.ready;
  await Promise.all([...fenetre.document.images].map(i=>i.complete?Promise.resolve():new Promise(r=>{i.onload=r;i.onerror=r;})));
  const page=fenetre.document.getElementById('page'), largeur=281*96/25.4, hauteur=193*96/25.4;
  // Réduire le document entier sans zoom : espaces Barlow préservés.
  let bas=0.01, haut=1, echelle=bas;
  for(let i=0;i<18;i++) {
    const candidat=(bas+haut)/2;
    page.style.width=`${largeur/candidat}px`;
    if(page.scrollHeight*candidat<=hauteur && page.scrollWidth*candidat<=largeur+1) {bas=candidat;echelle=candidat;} else haut=candidat;
  }
  page.style.width=`${largeur/echelle}px`;page.style.transform=`scale(${echelle})`;
  fenetre.focus();fenetre.print();
}
