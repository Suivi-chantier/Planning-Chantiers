// ─── DOCUMENT « PLANNING PRÉVISIONNEL » CLIENT ────────────────────────────────
// Module PARTAGÉ entre le Phasage (vue Prévisionnel d'UN chantier) et le
// Chemin de fer (prévisionnel GLOBAL d'une opération, tous logements).
// Deux responsabilités, aucune écriture DB :
//   1. blocsAutoDepuisGroupes : dérive les blocs « mois » du calendrier client
//      depuis les groupes chrono déjà planifiés (date_prevue des tâches) —
//      plus besoin de remplir la vue à la main.
//   2. buildPrevisionnelDocHTML : le gabarit PDF PROFERO (en-tête noir, carte
//      identité + pastille livraison, sections par mois, encadrés, mention
//      légale) — un seul gabarit pour le chantier ET l'opération.
//
// Structure d'un prévisionnel (stockée dans plan_travaux.meta.previsionnel
// côté Phasage, éphémère côté Chemin de fer) :
//   • sous_titre       : ligne sous le nom (ex : "Rénovation — appts 1 à 5")
//   • livraison_mois   : mois de livraison estimée (ex : "Oct.")
//   • livraison_annee  : année de livraison (ex : "2026")
//   • note_bas         : mention légale de bas de page
//   • blocs            : séquence ordonnée, chaque bloc étant soit
//        { id, type:"mois", titre, lignes:[…] }  → un mois avec ses puces
//        { id, type:"encadre", titre, texte }    → un encadré (conditionnel)

const rid = () => Math.random().toString(36).slice(2, 10);
const isISO = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);

export const NOTE_BAS_DEFAUT = "Dates communiquées à titre prévisionnel, susceptibles d'évoluer selon l'avancement du chantier et les interventions des tiers.";

export function defaultPrevisionnel() {
  return { sous_titre: "", livraison_mois: "", livraison_annee: "", note_bas: NOTE_BAS_DEFAUT, blocs: [] };
}

export function normalizePrevisionnel(p) {
  const d = defaultPrevisionnel();
  if (!p || typeof p !== "object") return d;
  return {
    sous_titre: p.sous_titre || "",
    livraison_mois: p.livraison_mois || "",
    livraison_annee: p.livraison_annee || "",
    note_bas: p.note_bas != null ? p.note_bas : NOTE_BAS_DEFAUT,
    blocs: Array.isArray(p.blocs) ? p.blocs.map(b => b.type === "encadre"
      ? { id: b.id || rid(), type: "encadre", titre: b.titre || "", texte: b.texte || "" }
      : { id: b.id || rid(), type: "mois", titre: b.titre || "", lignes: Array.isArray(b.lignes) ? b.lignes : [] }
    ) : [],
  };
}

// ─── GÉNÉRATION AUTOMATIQUE DEPUIS LES GROUPES PLANIFIÉS ─────────────────────
const MOIS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_COURT = ["Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin", "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// "2026-09" → "Septembre 2026"
const titreMois = (key) => `${cap(MOIS_LONG[parseInt(key.slice(5, 7), 10) - 1])} ${key.slice(0, 4)}`;

// Position dans le mois, lisible client : "début octobre" / "mi-octobre" /
// "fin octobre" (+ année si elle diffère de celle du début du groupe).
const partieMoisLabel = (finISO, debutISO) => {
  const jour = parseInt(finISO.slice(8, 10), 10);
  const mois = MOIS_LONG[parseInt(finISO.slice(5, 7), 10) - 1];
  const partie = jour <= 10 ? `début ${mois}` : jour <= 20 ? `mi-${mois}` : `fin ${mois}`;
  const anneeFin = finISO.slice(0, 4);
  return anneeFin !== debutISO.slice(0, 4) ? `${partie} ${anneeFin}` : partie;
};

// Dérive les blocs du calendrier client depuis une liste de groupes :
//   items : [{ nom, debut, fin, ordre, suffixe? }]
//     debut/fin : bornes ISO des date_prevue du groupe ("" si non planifié)
//     suffixe   : précision affichée après le nom (ex : le logement, pour un
//                 prévisionnel d'opération) — omis pour un chantier seul.
// Chaque groupe apparaît dans le mois de son DÉBUT ; s'il déborde sur un
// autre mois, la ligne le précise ("jusqu'à fin octobre"). Les groupes sans
// aucune date finissent dans un encadré « restant à planifier » (jamais
// ignorés silencieusement).
// Retour : { blocs, livraison_mois, livraison_annee, nbDates, nonPlanifies }.
export function blocsAutoDepuisGroupes(items) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const libelle = (i) => `${i.nom || "Groupe"}${i.suffixe ? ` — ${i.suffixe}` : ""}`;

  const dates = list.filter(i => isISO(i.debut)).slice()
    .sort((a, b) => a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : (a.ordre ?? 0) - (b.ordre ?? 0));

  const parMois = new Map(); // "YYYY-MM" → lignes[]
  dates.forEach(i => {
    const key = i.debut.slice(0, 7);
    let ligne = libelle(i);
    if (isISO(i.fin) && i.fin.slice(0, 7) !== key) ligne += ` (jusqu'à ${partieMoisLabel(i.fin, i.debut)})`;
    if (!parMois.has(key)) parMois.set(key, []);
    parMois.get(key).push(ligne);
  });

  const blocs = [...parMois.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, lignes]) => ({ id: rid(), type: "mois", titre: titreMois(key), lignes }));

  const nonPlanifies = list.filter(i => !isISO(i.debut));
  if (nonPlanifies.length > 0) {
    blocs.push({
      id: rid(), type: "encadre", titre: "Étapes restant à planifier",
      texte: `${nonPlanifies.map(libelle).join(", ")}. Les dates de ces étapes seront précisées ultérieurement.`,
    });
  }

  // Livraison estimée : mois de la dernière date connue (fin, sinon début).
  let derniere = "";
  dates.forEach(i => {
    const f = isISO(i.fin) ? i.fin : i.debut;
    if (f > derniere) derniere = f;
  });

  return {
    blocs,
    livraison_mois: derniere ? MOIS_COURT[parseInt(derniere.slice(5, 7), 10) - 1] : "",
    livraison_annee: derniere ? derniere.slice(0, 4) : "",
    nbDates: dates.length,
    nonPlanifies: nonPlanifies.length,
  };
}

// ─── GABARIT PDF « PLANNING PRÉVISIONNEL » ────────────────────────────────────
// Reproduit le document PROFERO : en-tête noir, carte identité + pastille
// livraison, sections par mois, encadrés conditionnels, mention légale et
// pied de page. Paramétré pour servir un chantier ("Chantier de X") comme une
// opération ("Opération X").
export function buildPrevisionnelDocHTML({ titre, cardLabel = "Chantier", headerLigne, logoUrl, previsionnel }) {
  const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, "<br/>");
  const dateLongue = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const dateCourte = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const p = normalizePrevisionnel(previsionnel);
  const OR = "#f5c400"; // jaune Profero

  const blocsHTML = (p.blocs || []).map(b => {
    if (b.type === "encadre") {
      if (!b.titre && !b.texte) return "";
      return `
      <div style="margin:14pt 0;padding:11pt 14pt;background:#fdf6df;border-left:4pt solid ${OR};border-radius:0 5pt 5pt 0;break-inside:avoid;page-break-inside:avoid;">
        ${b.titre ? `<span style="font-weight:800;color:#8a6d00;">${esc(b.titre)} :</span> ` : ""}<span style="color:#4a4a4a;">${nl2br(b.texte)}</span>
      </div>`;
    }
    const lignes = (b.lignes || []).filter(l => (l || "").trim());
    if (!b.titre && lignes.length === 0) return "";
    return `
      <div style="margin:0 0 6pt;break-inside:avoid;page-break-inside:avoid;">
        <div style="font-size:11pt;font-weight:800;color:#1a1f2e;margin:14pt 0 6pt;">${esc(b.titre)}</div>
        ${lignes.length === 0 ? "" : `<ul style="margin:0;padding:0;list-style:none;">
          ${lignes.map(l => `<li style="display:flex;align-items:flex-start;gap:8pt;font-size:9.5pt;color:#333;padding:3pt 0;">
            <span style="width:5pt;height:5pt;border-radius:50%;background:${OR};margin-top:4.5pt;flex:0 0 auto;"></span>
            <span>${nl2br(l)}</span>
          </li>`).join("")}
        </ul>`}
      </div>`;
  }).join("");

  const livraisonBox = (p.livraison_mois || p.livraison_annee) ? `
    <td style="width:150pt;vertical-align:middle;padding-left:14pt;">
      <div style="background:#0a0a0a;border-radius:8pt;padding:14pt 10pt;text-align:center;">
        <div style="color:rgba(255,255,255,.55);font-size:8pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;">Livraison</div>
        <div style="color:${OR};font-size:22pt;font-weight:800;line-height:1.05;margin-top:6pt;">${esc(p.livraison_mois)}</div>
        <div style="color:${OR};font-size:22pt;font-weight:800;line-height:1.05;">${esc(p.livraison_annee)}</div>
      </div>
    </td>` : "";

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Prévisionnel ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1f2e;font-size:10pt;line-height:1.45;}
  .page{max-width:720pt;margin:0 auto;}
  ul,li,section{break-inside:avoid;page-break-inside:avoid;}
  @page{margin:14mm 12mm 14mm;size:A4;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body><div class="page">
  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;border-radius:10pt;overflow:hidden;margin:0 0 16pt;">
    <tr>
      <td style="padding:14pt 16pt;vertical-align:middle;width:150pt;">
        <img src="${logoUrl}" alt="Profero" style="height:34pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:14pt 8pt;vertical-align:middle;text-align:center;">
        <div style="color:#cfcfcf;font-size:15pt;font-weight:800;">Planning Prévisionnel</div>
      </td>
      <td style="padding:14pt 16pt;vertical-align:middle;text-align:right;white-space:nowrap;">
        <div style="color:#fff;font-size:11pt;font-weight:800;">${esc(headerLigne || titre)}</div>
        <div style="color:rgba(255,255,255,.55);font-size:8.5pt;margin-top:2pt;text-transform:capitalize;">${dateLongue}</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin:0 0 18pt;">
    <tr>
      <td style="vertical-align:middle;">
        <div style="background:#f3f4f6;border-radius:8pt;padding:14pt 18pt;">
          <div style="color:#8a8f98;font-size:8pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;">${esc(cardLabel)}</div>
          <div style="color:#1a1f2e;font-size:15pt;font-weight:800;margin-top:4pt;">${esc(titre)}</div>
          ${p.sous_titre ? `<div style="color:#555;font-size:10pt;margin-top:3pt;">${esc(p.sous_titre)}</div>` : ""}
        </div>
      </td>
      ${livraisonBox}
    </tr>
  </table>

  <div style="display:flex;align-items:center;gap:8pt;border-bottom:1pt solid #e5e7eb;padding-bottom:6pt;margin:0 0 12pt;">
    <span style="width:4pt;height:14pt;background:${OR};border-radius:2pt;display:inline-block;"></span>
    <span style="font-size:10pt;font-weight:800;letter-spacing:1.5pt;text-transform:uppercase;color:#3a3f4a;">Calendrier prévisionnel</span>
  </div>

  ${blocsHTML || `<div style="text-align:center;padding:30pt;color:#999;">Aucune étape renseignée. Ajoute des mois dans la vue Prévisionnel.</div>`}

  ${p.note_bas ? `<div style="margin-top:16pt;font-size:8.5pt;font-style:italic;color:#9a9a9a;">${nl2br(p.note_bas)}</div>` : ""}

  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;border-radius:8pt;overflow:hidden;margin-top:16pt;">
    <tr>
      <td style="padding:8pt 14pt;color:rgba(255,255,255,.7);font-size:8pt;">PROFERO — Document confidentiel</td>
      <td style="padding:8pt 14pt;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;">${dateCourte}</td>
    </tr>
  </table>
</div></body></html>`;
}
