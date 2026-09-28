// compteRenduClientDoc — gabarit PDF « Compte rendu de chantier » envoyé au
// client (modale « Compte rendu client » de la page Équipe).
//
// Même enveloppe que les autres documents Profero (docClientHTML de
// previsionnelDoc.js : héros sombre à halos, jaune marque, Barlow, pied
// « Document confidentiel ») — toute évolution du décor se fait là-bas.
// Ici : uniquement la MISE EN PAGE du compte rendu :
//   héros (chantier, adresse, date, client) + pastille Avancement ·
//   résumé · travaux réalisés · prochaine étape · remarques · photos.
//
// Module PUR : aucun réseau, aucune base, aucune horloge. Les photos arrivent
// déjà prêtes (data-URL préchargée par la page, sinon l'URL d'origine).
// Couvert par scripts/verif-compte-rendu-client-doc.mjs.
import { docClientHTML, sectionTitre } from "./previsionnelDoc.js";

const OR = "#FFC200";
const esc = (s) => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br/>");
const rempli = (s) => (s ?? "").toString().trim() !== "";

// "2026-09-28" → "lundi 28 septembre 2026". Date lue en heure locale (pas
// d'UTC : un « 2026-09-28 » ne doit jamais s'imprimer « 27 septembre »).
// Une valeur illisible est rendue telle quelle, jamais remplacée par aujourd'hui.
export function dateCompteRendu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return (iso || "").toString();
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Avancement saisi → entier 0..100, ou null s'il n'est pas renseigné.
// null ⟹ aucune pastille : un avancement inconnu ne s'imprime pas « 0 % ».
export function avancementCompteRendu(v) {
  if (v == null || (typeof v === "string" && v.trim() === "")) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ─── GABARIT ──────────────────────────────────────────────────────────────────
// chantierNom    : nom du chantier (titre du héros)
// clientNom      : nom du client ("" si non saisi)
// adresse        : adresse du chantier ("" si non saisie)
// dateISO        : date du compte rendu, "YYYY-MM-DD"
// avancement     : pourcentage saisi (chaîne ou nombre, "" si non renseigné)
// resume / prochaineEtape / remarques : textes libres (retours à la ligne gardés)
// taches         : [texte] — travaux retenus, dans l'ordre d'affichage
// photos         : [src]   — data-URL ou URL, dans l'ordre d'affichage
// logoUrl        : logo Profero Rénovation (URL absolue)
export function buildCompteRenduClientDocHTML({
  chantierNom = "", clientNom = "", adresse = "", dateISO = "", avancement = "",
  resume = "", prochaineEtape = "", remarques = "", taches = [], photos = [], logoUrl = "",
}) {
  const titre = rempli(chantierNom) ? chantierNom.trim() : "Chantier";
  const travaux = (Array.isArray(taches) ? taches : []).map(t => (t ?? "").toString().trim()).filter(Boolean);
  const images = (Array.isArray(photos) ? photos : []).filter(rempli);
  const av = avancementCompteRendu(avancement);
  const dateTxt = dateCompteRendu(dateISO);

  // ── Héros ──
  const chips = [
    dateTxt ? `Compte rendu du ${dateTxt}` : "",
    rempli(clientNom) ? `Client : ${clientNom.trim()}` : "",
    travaux.length ? `${travaux.length} tâche${travaux.length > 1 ? "s" : ""} réalisée${travaux.length > 1 ? "s" : ""}` : "",
    images.length ? `${images.length} photo${images.length > 1 ? "s" : ""}` : "",
  ].filter(Boolean);

  const badge = av == null ? "" : `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;min-width:92pt;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Avancement</div>
          <div class="bc" style="font-size:22pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${av} %</div>
          <div class="cr-jauge"><span style="width:${av}%;"></span></div>
        </div>
      </td>`;

  // ── Sections ──
  const blocResume = !rempli(resume) ? "" : `
  ${sectionTitre("Résumé de la semaine")}
  <div class="cr-texte">${nl2br(resume.trim())}</div>`;

  const blocTravaux = travaux.length === 0 ? "" : `
  ${sectionTitre("Travaux réalisés")}
  <ul class="steps cr-travaux">
    ${travaux.map(t => `<li class="step"><span class="puce"></span><span class="step-txt">${nl2br(t)}</span></li>`).join("")}
  </ul>`;

  const blocEtape = !rempli(prochaineEtape) ? "" : `
  ${sectionTitre("Prochaine étape")}
  <div class="encadre">
    <div class="encadre-titre">À venir sur le chantier</div>
    <div class="encadre-texte">${nl2br(prochaineEtape.trim())}</div>
  </div>`;

  const blocRemarques = !rempli(remarques) ? "" : `
  ${sectionTitre("Remarques")}
  <div class="cr-texte">${nl2br(remarques.trim())}</div>`;

  // Le titre et la PREMIÈRE rangée forment un bloc insécable : sans cela, le
  // titre reste seul en bas de page et les photos partent sur la suivante.
  const vignette = (src, i) => `<div class="cr-photo"><img src="${esc(src)}" alt="Photo ${i + 1}"/></div>`;
  const PAR_RANGEE = 3;
  const blocPhotos = images.length === 0 ? "" : `
  <div class="cr-photos-tete">
    ${sectionTitre("Photos du chantier")}
    <div class="cr-photos">${images.slice(0, PAR_RANGEE).map(vignette).join("")}</div>
  </div>
  ${images.length > PAR_RANGEE ? `<div class="cr-photos cr-photos-suite">${images.slice(PAR_RANGEE).map((src, i) => vignette(src, i + PAR_RANGEE)).join("")}</div>` : ""}`;

  const vide = !blocResume && !blocTravaux && !blocEtape && !blocRemarques && !blocPhotos;

  const cssExtra = `
  /* ── Compte rendu client ── */
  .cr-texte{border:1pt solid #e9ebf0;border-left:3pt solid ${OR};border-radius:9pt;padding:10pt 13pt;font-size:10pt;line-height:1.6;color:#252a35;background:#fff;}
  .cr-travaux{margin:0;}
  .cr-travaux .step{break-inside:avoid;page-break-inside:avoid;}
  .cr-jauge{margin-top:5pt;height:4pt;border-radius:99pt;background:rgba(0,0,0,.14);overflow:hidden;}
  .cr-jauge span{display:block;height:100%;border-radius:99pt;background:#12151c;}
  .cr-photos-tete{break-inside:avoid;page-break-inside:avoid;}
  .cr-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8pt;}
  .cr-photos-suite{margin-top:8pt;}
  .cr-photo{border:1pt solid #e9ebf0;border-radius:10pt;padding:4pt;background:#fff;break-inside:avoid;page-break-inside:avoid;}
  .cr-photo img{width:100%;height:120pt;object-fit:cover;display:block;border-radius:7pt;background:#f3f4f6;}`;

  const corps = vide
    ? `<div style="text-align:center;padding:30pt;color:#9aa0ab;">Aucun contenu renseigné pour ce compte rendu.</div>`
    : `${blocResume}${blocTravaux}${blocEtape}${blocRemarques}${blocPhotos}`;

  return docClientHTML({
    titreDoc: `Compte rendu ${titre}${dateISO ? ` ${dateISO}` : ""}`,
    eyebrow: "Compte rendu de chantier",
    titre,
    sousTitre: rempli(adresse) ? adresse.trim() : "",
    chips,
    badgeHTML: badge,
    logoUrl,
    corps,
    cssExtra,
  });
}
