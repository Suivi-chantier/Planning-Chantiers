// ─────────────────────────────────────────────────────────────────────────────
// Import d'un relevé iMapper — partie NAVIGATEUR : lecture des fichiers
// déposés (DXF + PDF « pour les devis »), puis envoi des photos et des
// fichiers d'origine dans le stockage PRIVÉ (storageChantier.js, URL signées).
//
// Tout le calcul est dans releveImapper.mjs (pur, testé) ; ce fichier ne fait
// que lire les octets, interroger pdf.js pour le texte des pages, et envoyer.
// Les photos montrent l'intérieur de logements de clients : jamais le bucket
// public « photos », jamais d'URL enregistrée — seulement des chemins.
// ─────────────────────────────────────────────────────────────────────────────
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { assemblerReleve, extraireJpegsPdf, lirePdfImapper, nomFichierPhoto } from "./releveImapper";
import { uploadDocumentChantier, derniereErreurDocument } from "./storageChantier";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const ext = (f) => String(f?.name || "").toLowerCase().split(".").pop();

async function motsDePage(doc, n) {
  if (n > doc.numPages) return [];
  const contenu = await (await doc.getPage(n)).getTextContent();
  return contenu.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
}

// Fichiers déposés → { ok, releve, photos:[{ cle, nom, blob }], originaux } ou
// { ok:false, erreur }. Aucune donnée n'est envoyée à cette étape.
export async function lireFichiersReleve(fichiers, { maintenant } = {}) {
  const liste = Array.from(fichiers || []);
  const dxfs = liste.filter((f) => ext(f) === "dxf");
  const pdfsF = liste.filter((f) => ext(f) === "pdf");
  const autres = liste.filter((f) => !["dxf", "pdf"].includes(ext(f)));
  if (dxfs.length !== 1) {
    return { ok: false, erreur: dxfs.length ? "Déposez un seul fichier DXF à la fois." : "Il manque le DXF « pour AutoCAD (plan éditable) » exporté d'iMapper." };
  }
  // DXF R12 d'iMapper : page de code ANSI 1252.
  const dxfTexte = new TextDecoder("windows-1252").decode(await dxfs[0].arrayBuffer());

  const pdfs = [], images = [];
  for (const f of pdfsF) {
    const octets = new Uint8Array(await f.arrayBuffer());
    try {
      const doc = await pdfjsLib.getDocument({ data: octets.slice() }).promise;
      const lecture = lirePdfImapper(await motsDePage(doc, 1), await motsDePage(doc, 2));
      const jpegs = extraireJpegsPdf(octets);
      pdfs.push({ nom: f.name, lecture, nbPhotos: jpegs.length });
      images.push(jpegs);
    } catch (e) {
      console.error("lecture PDF iMapper:", f.name, e);
      pdfs.push({ nom: f.name, lecture: {}, nbPhotos: 0 });
      images.push([]);
    }
  }

  const res = assemblerReleve({ dxfTexte, pdfs, maintenant });
  if (!res.ok) return res;
  if (autres.length) {
    res.releve.alertes.push({ code: "fichiers_ignores",
      texte: `Fichier(s) ignoré(s) (ni DXF ni PDF) : ${autres.map((f) => f.name).join(", ")}.` });
  }
  const photos = [];
  res.releve.pieces.forEach((p) => {
    const i = pdfs.findIndex((x) => x.nom === p.pdf?.nom);
    if (i < 0) return;
    images[i].forEach((im, k) => photos.push({
      cle: `${p.id}#${k + 1}`,
      nom: nomFichierPhoto(p, k + 1),
      blob: new Blob([im.octets], { type: "image/jpeg" }),
    }));
  });
  return { ok: true, releve: res.releve, photos, originaux: [...dxfs, ...pdfsF] };
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
