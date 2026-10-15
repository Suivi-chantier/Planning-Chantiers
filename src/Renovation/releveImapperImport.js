// ─────────────────────────────────────────────────────────────────────────────
// Import d'un relevé iMapper — partie NAVIGATEUR : lecture des fichiers
// déposés (DXF + PDF « pour les devis »), puis envoi des photos et des
// fichiers d'origine dans le stockage PRIVÉ (storageChantier.js, URL signées).
//
// Deux temps : lireSourcesReleve lit les fichiers UNE fois (un PDF groupé
// d'iMapper peut peser 40 Mo) ; construireReleve assemble le relevé, et peut
// être rappelé avec la version du plan choisie par l'utilisateur quand le DXF
// en contient plusieurs.
//
// Tout le calcul est dans releveImapper.mjs (pur, testé) ; ce fichier ne fait
// que lire les octets, interroger pdf.js pour le texte des pages, et envoyer.
// Les photos montrent l'intérieur de logements de clients : jamais le bucket
// public « photos », jamais d'URL enregistrée — seulement des chemins.
// ─────────────────────────────────────────────────────────────────────────────
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  assemblerReleve, decouperPdfImapper, extraireJpegsParPage, extraireJpegsPdf, nomFichierPhoto,
} from "./releveImapper";
import { uploadDocumentChantier, derniereErreurDocument } from "./storageChantier";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ext = (f) => String(f?.name || "").toLowerCase().split(".").pop();

async function motsDePage(doc, n) {
  const contenu = await (await doc.getPage(n)).getTextContent();
  return contenu.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}

// Fichiers déposés → { ok, dxfTexte, pdfs:[{ nom, lecture, images }], originaux,
// ignores } ou { ok:false, erreur }. Rien n'est envoyé à cette étape.
// Un PDF peut contenir une pièce ou toutes : une entrée de `pdfs` par pièce.
export async function lireSourcesReleve(fichiers) {
  const liste = Array.from(fichiers || []);
  const dxfs = liste.filter((f) => ext(f) === "dxf");
  const pdfsF = liste.filter((f) => ext(f) === "pdf");
  const ignores = liste.filter((f) => !["dxf", "pdf"].includes(ext(f))).map((f) => f.name);
  if (dxfs.length !== 1) {
    return { ok: false, erreur: dxfs.length ? "Déposez un seul fichier DXF à la fois." : "Il manque le DXF « pour AutoCAD (plan éditable) » exporté d'iMapper." };
  }
  // DXF R12 d'iMapper : page de code ANSI 1252.
  const dxfTexte = new TextDecoder("windows-1252").decode(await dxfs[0].arrayBuffer());

  const pdfs = [];
  for (const f of pdfsF) {
    const octets = new Uint8Array(await f.arrayBuffer());
    try {
      const doc = await pdfjsLib.getDocument({ data: octets.slice() }).promise;
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) pages.push(await motsDePage(doc, n));
      const pieces = decouperPdfImapper(pages);
      const parPage = extraireJpegsParPage(octets);
      if (!pieces.length) {
        pdfs.push({ nom: f.name, lecture: {}, images: [] });
        continue;
      }
      // Photos : celles de la page de la pièce. Repli (structure illisible) :
      // pour un PDF d'une seule pièce, toutes les photos du fichier.
      const repli = !parPage && pieces.length === 1 ? extraireJpegsPdf(octets) : [];
      pieces.forEach((p) => pdfs.push({
        nom: pieces.length > 1 ? `${f.name} — Pièce #${p.lecture.piece_num ?? p.page + 1}` : f.name,
        lecture: p.lecture,
        images: parPage ? (parPage[p.page] || []) : repli,
      }));
    } catch (e) {
      console.error("lecture PDF iMapper:", f.name, e);
      pdfs.push({ nom: f.name, lecture: {}, images: [] });
    }
  }
  return { ok: true, dxfTexte, pdfs, originaux: [...dxfs, ...pdfsF], ignores };
}

// Sources lues → { ok, releve, photos:[{ cle, nom, blob }], originaux }, ou
// { ok:false, choix:"version", versions } (DXF à plusieurs versions : rappeler
// avec `version`), ou { ok:false, erreur }.
export function construireReleve(sources, { maintenant, version = null } = {}) {
  const pdfs = sources.pdfs.map((p) => ({ nom: p.nom, lecture: p.lecture, nbPhotos: p.images.length }));
  const res = assemblerReleve({ dxfTexte: sources.dxfTexte, pdfs, maintenant, version });
  if (!res.ok) return res;
  if (sources.ignores.length) {
    res.releve.alertes.push({ code: "fichiers_ignores",
      texte: `Fichier(s) ignoré(s) (ni DXF ni PDF) : ${sources.ignores.join(", ")}.` });
  }
  const photos = [];
  res.releve.pieces.forEach((p) => {
    const src = sources.pdfs.find((x) => x.nom === p.pdf?.nom);
    if (!src) return;
    src.images.forEach((im, k) => photos.push({
      cle: `${p.id}#${k + 1}`,
      nom: nomFichierPhoto(p, k + 1),
      blob: new Blob([im.octets], { type: "image/jpeg" }),
    }));
  });
  return { ok: true, releve: res.releve, photos, originaux: sources.originaux };
}

// Envoi dans le stockage privé, 4 fichiers à la fois. Retourne
// { chemins: { cle → chemin }, fichiers: [{ nom, chemin }], echecs: [nom], raison }.
export async function envoyerFichiersReleve({ photos, originaux, prefixe, onProgres }) {
  const taches = [
    ...photos.map((p) => ({ type: "photo", cle: p.cle, nom: p.nom, fichier: new File([p.blob], p.nom, { type: "image/jpeg" }) })),
    ...originaux.map((f) => ({ type: "origine", nom: f.name, fichier: f })),
  ];
  const chemins = {}, fichiers = [], echecs = [];
  let fait = 0, raison = "";
  const suivante = async () => {
    while (taches.length) {
      const t = taches.shift();
      const r = await uploadDocumentChantier(t.fichier, t.type === "photo" ? `${prefixe}/photos` : prefixe);
      if (r?.path) {
        if (t.type === "photo") chemins[t.cle] = r.path;
        else fichiers.push({ nom: t.nom, chemin: r.path });
      } else {
        echecs.push(t.nom);
        raison = derniereErreurDocument() || raison;
      }
      fait++;
      onProgres?.(fait);
    }
  };
  await Promise.all([suivante(), suivante(), suivante(), suivante()]);
  return { chemins, fichiers, echecs, raison };
}

// Dossier de stockage du relevé d'un plan : ‹chantier›/plans/‹plan›/releve.
export function prefixeReleve(plan) {
  const racine = plan?.chantier_id || (plan?.projet_id ? `projet-${plan.projet_id}` : "sans-chantier");
  return `${racine}/plans/${plan?.id}/releve`;
}
