// Conversion PDF -> images PNG, côté navigateur, via pdf.js.
//
// Pourquoi : l'API d'analyse (Anthropic) sait lire des images sans souci mais
// rejette certains PDF « exotiques » (compression/encodage inhabituels) avec
// « The PDF specified was not valid ». En rendant chaque page en PNG on
// normalise l'entrée : tous les BL/tickets passent, quelle que soit l'origine
// du PDF. On garde un fallback (envoi du PDF brut) si le rendu échoue.

import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Largeur cible du rendu. Anthropic ré-échantillonne au-delà de ~1568 px sur le
// plus grand côté : inutile de rendre plus grand (poids réseau pour rien).
const TARGET_MAX_PX = 1560;
// Garde-fou : au-delà, on n'envoie pas 40 pages d'images (coût/poids).
const MAX_PAGES = 15;

// `file` : un File/Blob PDF. Renvoie [{ base64, mediaType: "image/png" }] (une
// entrée par page). Jette une erreur si le PDF est illisible même par pdf.js.
export async function pdfFileToImages(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const nb = Math.min(pdf.numPages, MAX_PAGES);
  const images = [];

  for (let i = 1; i <= nb; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, TARGET_MAX_PX / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    // Fond blanc : les PDF sans fond donnent sinon un canvas transparent
    // qui devient noir une fois aplati en PNG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    images.push({ base64: dataUrl.split(",")[1], mediaType: "image/png" });
    canvas.width = canvas.height = 0; // libère la mémoire
  }

  if (!images.length) throw new Error("PDF vide (aucune page rendue).");
  return images;
}
