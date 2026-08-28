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
// Document CLIENT — même langage visuel que le design system de l'app
// (src/mobileUI.jsx) : héros en dégradé sombre avec halos ambre/bleu, jaune
// marque #FFC200, typographie Barlow / Barlow Condensed (Google Fonts,
// chargées dans la fenêtre d'impression — repli Arial), calendrier en FRISE
// verticale (un jalon par mois), encadrés conditionnels, mention légale.
// Paramétré pour servir un chantier ("Chantier") comme une opération.
export function buildPrevisionnelDocHTML({ titre, cardLabel = "Chantier", logoUrl, previsionnel }) {
  const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nl2br = (s) => esc(s).replace(/\n/g, "<br/>");
  const dateLongue = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const p = normalizePrevisionnel(previsionnel);
  const OR = "#FFC200"; // jaune marque Profero

  // Une ligne d'étape « Nom — Précision (jusqu'à …) » est décomposée pour la
  // hiérarchie visuelle : nom en avant, précision (logement) et débordement
  // de mois en retrait — purement présentation, la donnée reste une chaîne.
  const ligneHTML = (l) => {
    let reste = (l || "").trim(), paren = "";
    const mp = reste.match(/^(.*?)\s*(\(jusqu[’']à[^)]*\))\s*$/);
    if (mp) { reste = mp[1]; paren = mp[2]; }
    const parts = reste.split(" — ");
    const nom = parts[0], suffixe = parts.slice(1).join(" — ");
    return `<span class="step-txt">${esc(nom)}${suffixe ? `<span class="step-suf"> — ${esc(suffixe)}</span>` : ""}${paren ? ` <span class="step-par">${esc(paren)}</span>` : ""}</span>`;
  };

  const blocs = (p.blocs || []).filter(b => b.type === "encadre" ? (b.titre || b.texte) : (b.titre || (b.lignes || []).some(l => (l || "").trim())));
  const blocsHTML = blocs.map((b, i) => {
    const isLast = i === blocs.length - 1;
    const rail = isLast ? "" : `<span class="rail"></span>`;
    if (b.type === "encadre") {
      return `
      <div class="bloc">
        ${rail}<span class="marker marker-losange"></span>
        <div class="encadre">
          ${b.titre ? `<div class="encadre-titre">${esc(b.titre)}</div>` : ""}
          <div class="encadre-texte">${nl2br(b.texte)}</div>
        </div>
      </div>`;
    }
    const lignes = (b.lignes || []).filter(l => (l || "").trim());
    return `
      <div class="bloc">
        ${rail}<span class="marker"></span>
        <div class="bloc-titre bc">${esc(b.titre)}</div>
        ${lignes.length === 0 ? "" : `<ul class="steps">
          ${lignes.map(l => `<li class="step"><span class="puce"></span>${ligneHTML(l)}</li>`).join("")}
        </ul>`}
      </div>`;
  }).join("");

  const livraisonBadge = (p.livraison_mois || p.livraison_annee) ? `
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:14pt;">
        <div style="display:inline-block;background:${OR};border-radius:10pt;padding:9pt 16pt 10pt;text-align:center;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(0,0,0,.55);">Livraison estimée</div>
          <div class="bc" style="font-size:18pt;font-weight:800;color:#12151c;line-height:1.05;margin-top:2pt;">${esc(`${p.livraison_mois} ${p.livraison_annee}`.trim())}</div>
        </div>
      </td>` : "";

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Prévisionnel ${esc(titre)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Barlow',Arial,Helvetica,sans-serif;background:#fff;color:#1a1f2e;font-size:10pt;line-height:1.5;}
  .bc{font-family:'Barlow Condensed','Arial Narrow',Arial,sans-serif;}
  .page{max-width:720pt;margin:0 auto;}

  /* ── Frise verticale : un jalon par bloc ── */
  .timeline{padding:2pt 0 0 4pt;}
  .bloc{position:relative;padding:0 0 15pt 22pt;break-inside:avoid;page-break-inside:avoid;}
  .rail{position:absolute;left:3.5pt;top:6pt;bottom:-4pt;width:2pt;background:#eceef2;border-radius:1pt;}
  .marker{position:absolute;left:0;top:1.5pt;width:9pt;height:9pt;border-radius:50%;background:${OR};box-shadow:0 0 0 3pt rgba(255,194,0,.22);}
  .marker-losange{border-radius:2pt;transform:rotate(45deg);background:#fff;border:2.5pt solid ${OR};box-shadow:none;left:.5pt;width:8pt;height:8pt;}
  .bloc-titre{font-size:13.5pt;font-weight:800;letter-spacing:.8pt;text-transform:uppercase;color:#12151c;line-height:1.1;}
  .steps{list-style:none;margin:6pt 0 0;padding:0;}
  .step{display:flex;align-items:flex-start;gap:8pt;padding:2.5pt 0;}
  .puce{width:4.5pt;height:4.5pt;border-radius:50%;background:${OR};margin-top:5pt;flex:0 0 auto;}
  .step-txt{font-size:10pt;color:#252a35;font-weight:600;}
  .step-suf{color:#7c8291;font-weight:500;}
  .step-par{color:#9aa0ab;font-style:italic;font-weight:400;font-size:9pt;}

  /* ── Encadré conditionnel ── */
  .encadre{background:#fff8e0;border:1pt solid #f2e2ad;border-radius:9pt;padding:9pt 13pt;}
  .encadre-titre{font-size:8pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;color:#8a6d00;margin-bottom:3pt;}
  .encadre-texte{font-size:9.5pt;color:#57534a;line-height:1.55;}

  @page{margin:12mm 13mm 14mm;size:A4;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body><div class="page">

  <!-- ── Héros : dégradé sombre + halos (même langage que l'app) ── -->
  <div style="position:relative;overflow:hidden;border-radius:14pt;background:linear-gradient(135deg,#161b28 0%,#232c42 55%,#2e2840 100%);padding:16pt 20pt 18pt;">
    <div style="position:absolute;right:-45pt;top:-55pt;width:175pt;height:175pt;border-radius:50%;background:radial-gradient(circle,rgba(255,194,0,.30) 0%,rgba(255,194,0,0) 68%);"></div>
    <div style="position:absolute;left:-35pt;bottom:-75pt;width:160pt;height:160pt;border-radius:50%;background:radial-gradient(circle,rgba(91,138,245,.26) 0%,rgba(91,138,245,0) 68%);"></div>
    <table style="width:100%;border-collapse:collapse;position:relative;">
      <tr>
        <td style="vertical-align:top;">
          <img src="${logoUrl}" alt="Profero" style="height:23pt;object-fit:contain;display:block;"/>
        </td>
        <td style="vertical-align:top;text-align:right;white-space:nowrap;">
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;color:rgba(255,255,255,.4);">Édité le</div>
          <div style="font-size:9pt;font-weight:600;color:rgba(255,255,255,.85);margin-top:1pt;">${dateLongue}</div>
        </td>
      </tr>
    </table>
    <table style="width:100%;border-collapse:collapse;position:relative;margin-top:16pt;">
      <tr>
        <td style="vertical-align:bottom;">
          <div style="font-size:8pt;font-weight:700;letter-spacing:2.5pt;text-transform:uppercase;color:${OR};">Planning prévisionnel — ${esc(cardLabel)}</div>
          <div class="bc" style="font-size:24pt;font-weight:800;color:#fff;line-height:1.08;margin-top:3pt;">${esc(titre)}</div>
          ${p.sous_titre ? `<div style="font-size:10pt;color:rgba(255,255,255,.62);margin-top:3pt;">${esc(p.sous_titre)}</div>` : ""}
        </td>
        ${livraisonBadge}
      </tr>
    </table>
  </div>

  <!-- ── Titre de section ── -->
  <div style="display:flex;align-items:center;gap:10pt;margin:20pt 0 14pt;">
    <span class="bc" style="font-size:13pt;font-weight:800;letter-spacing:1.6pt;text-transform:uppercase;color:#12151c;white-space:nowrap;">Calendrier prévisionnel</span>
    <span style="flex:1;height:2.5pt;border-radius:2pt;background:linear-gradient(90deg,${OR},rgba(255,194,0,0));"></span>
  </div>

  <!-- ── Frise ── -->
  <div class="timeline">
    ${blocsHTML || `<div style="text-align:center;padding:30pt;color:#999;">Aucune étape renseignée. Ajoute des mois dans la vue Prévisionnel.</div>`}
  </div>

  ${p.note_bas ? `<div style="margin-top:14pt;padding:8pt 12pt;background:#f6f7f9;border-radius:8pt;font-size:8.5pt;font-style:italic;color:#8a90a0;line-height:1.55;">${nl2br(p.note_bas)}</div>` : ""}

  <!-- ── Pied de page ── -->
  <div style="margin-top:16pt;padding-top:9pt;border-top:1pt solid #e9eaee;display:flex;justify-content:space-between;align-items:baseline;">
    <span style="font-size:7.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;color:#b3b8c2;">Profero — Rénovation &amp; réhabilitation</span>
    <span style="font-size:7.5pt;color:#b3b8c2;">Document confidentiel</span>
  </div>
</div></body></html>`;
}
