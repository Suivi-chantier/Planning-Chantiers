// Export PDF du diagramme financier (Point 5, Prompt 6).
//
// Même patron que les exports existants (CheminDeFer.exportPDF & co) :
// window.open + document.write + window.print() — vraie impression navigateur,
// pas de rastérisation. Particularité : un graphe recharts vit dans le DOM
// React (SVG + légende HTML avec styles inline) — on sérialise le conteneur
// tel quel et on l'injecte dans la fenêtre d'impression.
//
// Les couleurs des courbes sont inline (une par flux) ; en revanche les textes
// (axes, légende) portent les couleurs du THÈME de l'appli — illisibles sur
// papier blanc en thème sombre — d'où les overrides d'impression ci-dessous.
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function exporterDiagrammePDF({ titre, sousTitre = "", conteneur, lignesInfos = [] }) {
  if (!conteneur || !conteneur.querySelector("svg")) {
    alert("Le graphique n'est pas encore affiché : impossible d'exporter.");
    return;
  }
  const graphHTML = conteneur.innerHTML; // SVG recharts + légende (styles inline)
  const infos = lignesInfos.filter(Boolean).map((l) => `<div class="info">${esc(l)}</div>`).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(titre)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  body { font-family: Arial, Helvetica, sans-serif; color: #1c2430; margin: 0; padding: 4px 2px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .sous { font-size: 12px; color: #5a6472; margin: 0 0 10px; }
  .graph { width: 100%; }
  .graph svg { max-width: 100%; height: auto; }
  /* Textes du graphe : neutraliser les couleurs du thème de l'appli
     (thème sombre = textes clairs, invisibles sur papier). */
  .graph svg text { fill: #3a4454 !important; }
  .recharts-legend-wrapper, .recharts-legend-wrapper * { color: #1c2430 !important; opacity: 1 !important; position: static !important; }
  .recharts-legend-wrapper { width: auto !important; }
  .recharts-tooltip-wrapper { display: none !important; }
  .infos { display: flex; flex-wrap: wrap; gap: 6px 28px; margin-top: 12px; }
  .info { font-size: 12.5px; }
  .note { font-size: 10.5px; color: #5a6472; margin-top: 10px; }
</style></head><body>
  <h1>${esc(titre)}</h1>
  <div class="sous">${esc(sousTitre)}</div>
  <div class="graph">${graphHTML}</div>
  <div class="infos">${infos}</div>
  <div class="note">Trait plein = réel · pointillés = référence figée · courbes cumulées € HT par fin de mois — édité le ${new Date().toLocaleDateString("fr-FR")}.</div>
</body></html>`;
  const w = window.open("", "_blank", "width=1100,height=700");
  if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
  w.document.title = titre;
  w.document.write(html);
  w.document.close();
  w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
}
