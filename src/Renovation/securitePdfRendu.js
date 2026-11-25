// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — rendu du PDF dans le navigateur (tâche 5 du
// projet docs/projets/fiche-securite-chantier.md).
//
// Même technique que le PDF du Bilan (BilanPeriode.jsx) : le HTML à la charte
// (module pur securitePdf.mjs) est rendu par html2pdf, chargé à la demande,
// dans un conteneur de 794 px.
//
//   - genererPdfVersion() : PDF d'une version VALIDÉE, construit à partir de
//     son contenu figé, puis stocké et rattaché (securiteDonnees.js). Appelé
//     juste après la validation, et par le bouton « Générer le PDF » d'une
//     version qui n'en a pas ;
//   - apercuPdfBrouillon() : aperçu d'une fiche non validée, marqué
//     « BROUILLON — non validé », téléchargé sans être stocké ;
//   - telechargerPdfVersion() : lien signé vers le fichier stocké.
// ─────────────────────────────────────────────────────────────────────────────
import { LOGO_RENO_H } from "../constants";
import { modelePdfFiche, htmlFicheSecuritePdf, nomFichierPdf } from "./securitePdf.js";
import { chargerDonneesPdfVersion, lireImageSignature, enregistrerPdfVersion, urlPdfVersion } from "./securiteDonnees.js";

const logoUrl = () => `${window.location.origin}${LOGO_RENO_H}`;

function blobVersDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("lecture de l'image impossible"));
    r.readAsDataURL(blob);
  });
}

/** HTML → Blob PDF (A4, html2pdf). */
export async function rendrePdfBlob(html) {
  const conteneur = document.createElement("div");
  Object.assign(conteneur.style, { position: "absolute", left: "-99999px", top: "0", width: "794px", background: "#fff" });
  conteneur.innerHTML = html;
  document.body.appendChild(conteneur);
  try {
    try {
      await Promise.all(["400 11px Barlow", "600 11px Barlow", "700 11px Barlow", "800 20px 'Barlow Condensed'"].map((f) => document.fonts.load(f)));
    } catch { /* repli Arial */ }
    // Les images (logo, signatures) doivent être chargées avant la capture.
    await Promise.all([...conteneur.querySelectorAll("img")].map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())));
    const html2pdf = (await import("html2pdf.js")).default;
    const opts = {
      margin: [12, 10, 14, 10], image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 794 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: [".carte", ".signature", "tr", "li", ".sh"] },
    };
    return await html2pdf().set(opts).from(conteneur.querySelector(".page") || conteneur).outputPdf("blob");
  } finally {
    document.body.removeChild(conteneur);
  }
}

function telechargerBlob(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nom; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Ajoute à chaque signature retenue son image (data URL). `strict` : une image
 * illisible fait échouer (PDF stocké) ; sinon l'image est marquée illisible
 * dans le document (aperçu).
 */
async function avecImages(signatures, { version, empreinte, strict }) {
  const retenues = (signatures || []).filter((s) => s && s.version === version && empreinte && s.empreinte_version === empreinte);
  const out = [];
  for (const s of retenues) {
    const r = await lireImageSignature(s.image_path);
    if (!r.blob) {
      if (strict) throw new Error(`image de la signature de ${s.signataire_nom || "?"} illisible (${r.erreur})`);
      out.push({ ...s, image: null });
      continue;
    }
    out.push({ ...s, image: await blobVersDataUrl(r.blob) });
  }
  return out;
}

/**
 * PDF d'une version validée : contenu figé + signatures de cette version,
 * stocké dans securite-preuves et rattaché à la version (pdf_path).
 * → { path, erreur, avertissement }
 */
export async function genererPdfVersion({ ficheId, version }) {
  try {
    const d = await chargerDonneesPdfVersion(ficheId, version);
    if (d.erreur) return { path: null, erreur: d.erreur };
    if (d.version.pdf_path) return { path: d.version.pdf_path, erreur: null, avertissement: null };
    const signatures = await avecImages(d.signatures, { version, empreinte: d.version.empreinte, strict: true });
    const m = modelePdfFiche({ contenu: d.version.contenu, version: d.version, versions: d.versions, signatures });
    if (!m.ok) return { path: null, erreur: m.erreur };
    const blob = await rendrePdfBlob(htmlFicheSecuritePdf(m.modele, { logoUrl: logoUrl() }));
    return await enregistrerPdfVersion({ ligne: d.version, blob });
  } catch (e) {
    return { path: null, erreur: e?.message || String(e) };
  }
}

/**
 * Aperçu d'une fiche en brouillon (non stocké), marqué « BROUILLON — non
 * validé ». `contenu` : calculé par contenuVersion() à partir de la fiche
 * enregistrée ; `empreinte` : celle de ce contenu (signatures retenues).
 * → { erreur }
 */
export async function apercuPdfBrouillon({ contenu, empreinte, signatures, versions, chantierNom, apercuLe }) {
  try {
    const sigs = await avecImages(signatures, { version: contenu?.version, empreinte, strict: false });
    const m = modelePdfFiche({ contenu, versions, signatures: sigs, brouillon: true, empreinte, apercuLe });
    if (!m.ok) return { erreur: m.erreur };
    const blob = await rendrePdfBlob(htmlFicheSecuritePdf(m.modele, { logoUrl: logoUrl() }));
    telechargerBlob(blob, nomFichierPdf({ chantierNom, version: contenu.version, brouillon: true }));
    return { erreur: null };
  } catch (e) {
    return { erreur: e?.message || String(e) };
  }
}

/** Ouvre le lien signé du PDF stocké d'une version. → { erreur } */
export async function telechargerPdfVersion({ path, chantierNom, version }) {
  const fenetre = window.open("", "_blank");
  const r = await urlPdfVersion(path, nomFichierPdf({ chantierNom, version }));
  if (r.url) {
    if (fenetre) fenetre.location.href = r.url; else window.location.assign(r.url);
    return { erreur: null };
  }
  fenetre?.close();
  return { erreur: r.erreur };
}
