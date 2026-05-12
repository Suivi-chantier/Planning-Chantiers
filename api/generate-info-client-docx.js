// api/generate-info-client-docx.js — Fiche client (visite commerciale) en .docx
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle, ImageRun,
} = require('docx');

const GOLD = "E6AE00", DARK = "1A1F2E", GREY = "5B6A8A";
const GREEN = "1A6B3A", BLUE = "2563EB";

const STATUTS_LABELS = {
  prospect: "Prospect",
  rdv_planifie: "RDV planifié",
  visite_faite: "Visite faite",
  chiffrage: "Chiffrage",
  devis_envoye: "Devis envoyé",
  signe: "Signé",
  abandonne: "Abandonné",
};

const fmtDate = (d) => {
  if (!d) return "—";
  if (d.includes("/")) return d; // déjà formaté
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const [y, m, j] = parts;
  return `${j}/${m}/${y}`;
};

const sp = (n) => new Paragraph({ children: [], spacing: { before: n, after: 0 } });

async function fetchImage(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return Buffer.from(buf);
  } catch (e) {
    console.warn('fetchImage failed:', url, e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { infos = {}, ouvrages = [], cotes = [], plans = [], photos = [] } = req.body || {};

  // Groupage ouvrages par catégorie
  const parCat = ouvrages.reduce((a, o) => {
    const k = o.category || "Autre";
    if (!a[k]) a[k] = [];
    a[k].push(o);
    return a;
  }, {});

  // Total estimation
  const totalGlobal = ouvrages.reduce((s, o) => {
    const q = parseFloat(o.quantite) || 0;
    const p = parseFloat(o.prix_unitaire) || 0;
    return s + q * p;
  }, 0);

  const children = [];

  // ─── EN-TÊTE ─────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: "PROFERO RÉNOVATION", bold: true, size: 36, font: "Arial", color: DARK })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Fiche client — Visite commerciale", size: 26, font: "Arial", color: GREY })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 320 },
  }));

  // ─── INFOS CLIENT ────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: "INFORMATIONS CLIENT", bold: true, size: 22, font: "Arial", color: GREY })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 120 },
  }));
  const line = (label, value) => children.push(new Paragraph({
    children: [
      new TextRun({ text: `${label} : `, size: 22, font: "Arial", color: GREY }),
      new TextRun({ text: value || "—", bold: true, size: 22, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 60 },
  }));
  line("Nom / Prénom", `${infos.client_nom || ""} ${infos.client_prenom || ""}`.trim());
  line("Adresse du bien", infos.adresse_bien);
  line("Date de visite", fmtDate(infos.date_visite));
  line("Statut", STATUTS_LABELS[infos.statut] || "Prospect");
  if (infos.description_projet) line("Description", infos.description_projet);
  if (Array.isArray(infos.logements) && infos.logements.length > 0) {
    line("Composition", infos.logements.join(", "));
  }
  children.push(sp(200));

  // ─── OBSERVATIONS ────────────────────────────────────────────────────────────
  if (infos.observations) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "OBSERVATIONS", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    infos.observations.split("\n").forEach(l => {
      if (l.trim()) children.push(new Paragraph({
        children: [new TextRun({ text: l, size: 22, font: "Arial", color: DARK })],
        spacing: { before: 0, after: 40 },
      }));
    });
    children.push(sp(200));
  }

  // ─── OUVRAGES PAR CATÉGORIE ──────────────────────────────────────────────────
  if (ouvrages.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "OUVRAGES SÉLECTIONNÉS", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const [cat, items] of Object.entries(parCat)) {
      const totalCat = items.reduce((s, o) => s + ((parseFloat(o.quantite) || 0) * (parseFloat(o.prix_unitaire) || 0)), 0);
      children.push(new Paragraph({
        children: [
          new TextRun({ text: cat.toUpperCase(), bold: true, size: 22, font: "Arial", color: DARK }),
          totalCat > 0 ? new TextRun({ text: `   —  ${totalCat.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, size: 20, font: "Arial", color: GREEN }) : new TextRun({ text: "" }),
        ],
        spacing: { before: 120, after: 60 },
      }));
      for (const o of items) {
        const q = parseFloat(o.quantite) || 0;
        const pu = parseFloat(o.prix_unitaire) || 0;
        const totalLigne = q * pu;
        const parts = [new TextRun({ text: o.item || "", size: 22, font: "Arial", color: DARK })];
        if (q > 0) parts.push(new TextRun({ text: `   ${q} ${o.unite || "U"}`, size: 20, font: "Arial", color: GREY }));
        if (pu > 0) {
          parts.push(new TextRun({ text: `   × ${pu.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, size: 20, font: "Arial", color: GREY }));
        }
        if (totalLigne > 0) {
          parts.push(new TextRun({ text: `   = ${totalLigne.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, bold: true, size: 20, font: "Arial", color: GREEN }));
        }
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: parts,
          spacing: { before: 0, after: 40 },
        }));
      }
    }
    if (totalGlobal > 0) {
      children.push(sp(100));
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "ESTIMATION TOTALE : ", bold: true, size: 24, font: "Arial", color: DARK }),
          new TextRun({ text: `${totalGlobal.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} €`, bold: true, size: 28, font: "Arial", color: GREEN }),
        ],
        border: { top: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
        spacing: { before: 100, after: 240 },
      }));
    }
  }

  // ─── CÔTES ───────────────────────────────────────────────────────────────────
  if (cotes.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "CÔTES MENUISERIES / HUISSERIES", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const c of cotes) {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: c.nom || "(Sans nom)", bold: true, size: 22, font: "Arial", color: DARK }),
          new TextRun({
            text: `   L : ${c.largeur || "—"} cm · H : ${c.hauteur || "—"} cm${c.localisation ? `   ·   ${c.localisation}` : ""}`,
            size: 20, font: "Arial", color: GREY,
          }),
        ],
        spacing: { before: 0, after: 40 },
      }));
    }
    children.push(sp(200));
  }

  // ─── PLAN ────────────────────────────────────────────────────────────────────
  const planAvecImage = plans.find(p => p.data && p.data.startsWith("data:image"));
  if (planAvecImage) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "PLAN DU CHANTIER", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    try {
      const base64 = planAvecImage.data.split(",")[1];
      const imgBuf = Buffer.from(base64, "base64");
      children.push(new Paragraph({
        children: [new ImageRun({ data: imgBuf, transformation: { width: 480, height: 360 } })],
        spacing: { before: 60, after: 200 },
      }));
    } catch (e) { console.warn("Plan image failed:", e.message); }
  }

  // ─── PHOTOS ──────────────────────────────────────────────────────────────────
  if (photos.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "PHOTOS", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const ph of photos.slice(0, 20)) {
      const imgBuf = await fetchImage(ph.url);
      if (imgBuf) {
        try {
          if (ph.label) {
            children.push(new Paragraph({
              children: [new TextRun({ text: ph.label, italics: true, size: 20, font: "Arial", color: GREY })],
              spacing: { before: 80, after: 40 },
            }));
          }
          children.push(new Paragraph({
            children: [new ImageRun({ data: imgBuf, transformation: { width: 300, height: 225 } })],
            spacing: { before: 0, after: 80 },
          }));
        } catch (e) { console.warn("Photo failed:", e.message); }
      }
    }
  }

  // ─── SIGNATURE ───────────────────────────────────────────────────────────────
  children.push(sp(400));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Document généré automatiquement par Profero Rénovation", size: 18, italics: true, font: "Arial", color: GREY })],
    spacing: { before: 0, after: 0 },
  }));

  const doc = new Document({
    numbering: {
      config: [{ reference: "bullets", levels: [{
        level: 0, format: LevelFormat.BULLET, text: "–",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 220 } } },
      }] }],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children,
    }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const safe = `${infos.client_nom || "client"}`.replace(/[^a-zA-Z0-9-_]/g, "_");
    res.setHeader('Content-Disposition', `attachment; filename="Fiche-${safe}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Erreur Packer:', e);
    res.status(500).json({ error: e.message });
  }
};
