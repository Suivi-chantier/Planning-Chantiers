// api/generate-cr-client-docx.js — Compte rendu client (visite chantier) en .docx
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle, ImageRun,
} = require('docx');

const GOLD = "E6AE00", DARK = "1A1F2E", GREY = "5B6A8A";
const GREEN = "1A6B3A", BLUE = "2563EB", ORANGE = "B05A10", RED = "B03030";

const STATUT_OBS_LABEL = { ok: "CONFORME", info: "INFO", warn: "ATTENTION", urgent: "URGENT" };
const STATUT_OBS_COLOR = { ok: GREEN, info: BLUE, warn: ORANGE, urgent: RED };

const fmtDate = (d) => {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length !== 3) return d;
  const [y, m, j] = parts;
  return `${j}/${m}/${y}`;
};

const sp = (n) => new Paragraph({ children: [], spacing: { before: n, after: 0 } });

async function fetchImage(url) {
  try {
    // Si c'est déjà un data URI base64
    if (url.startsWith("data:")) {
      const base64 = url.split(",")[1] || "";
      return Buffer.from(base64, "base64");
    }
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return Buffer.from(buf);
  } catch (e) {
    console.warn("fetchImage failed:", url, e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { infos = {}, obs = [], photos = [], societe = {} } = req.body || {};

  const clients = [
    `${infos.client_prenom1 || ""} ${infos.client_nom1 || ""}`.trim(),
    infos.client_prenom2 || infos.client_nom2 ? `${infos.client_prenom2 || ""} ${infos.client_nom2 || ""}`.trim() : null,
  ].filter(Boolean);

  const children = [];

  // ─── EN-TÊTE ─────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: (societe.nom || "PROFERO RÉNOVATION").toUpperCase(), bold: true, size: 36, font: "Arial", color: DARK })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Compte rendu de visite", size: 26, font: "Arial", color: GREY })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 320 },
  }));

  // ─── INFOS PRINCIPALES ───────────────────────────────────────────────────────
  const line = (label, value) => children.push(new Paragraph({
    children: [
      new TextRun({ text: `${label} : `, size: 22, font: "Arial", color: GREY }),
      new TextRun({ text: value || "—", bold: true, size: 22, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 60 },
  }));

  line("Client(s)", clients.join(" & "));
  line("Adresse", infos.adresse);
  const dateHeure = `${fmtDate(infos.date_visite)}${infos.heure_visite ? ` à ${infos.heure_visite}` : ""}`;
  line("Date de visite", dateHeure);
  line("Type de visite", infos.type_visite);
  if (infos.participants) line("Participants", infos.participants);
  if (typeof infos.avancement === "number" && infos.avancement > 0) {
    line("Avancement global", `${infos.avancement} %`);
  }
  children.push(sp(200));

  // ─── RÉSUMÉ ──────────────────────────────────────────────────────────────────
  if (infos.resume && infos.resume.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "RÉSUMÉ & ÉTAT DU CHANTIER", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    infos.resume.split("\n").forEach(l => {
      if (l.trim()) children.push(new Paragraph({
        children: [new TextRun({ text: l, size: 22, font: "Arial", color: DARK })],
        spacing: { before: 0, after: 60 },
      }));
    });
    children.push(sp(120));
  }

  // ─── PROCHAINE ÉTAPE ────────────────────────────────────────────────────────
  if (infos.prochaine_etape && infos.prochaine_etape.trim()) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: "Prochaine étape : ", bold: true, size: 22, font: "Arial", color: GOLD }),
        new TextRun({ text: infos.prochaine_etape, size: 22, font: "Arial", color: DARK }),
      ],
      spacing: { before: 100, after: 200 },
    }));
  }

  // ─── OBSERVATIONS ────────────────────────────────────────────────────────────
  const obsValides = obs.filter(o => o.texte && o.texte.trim());
  if (obsValides.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "OBSERVATIONS & POINTS DE VIGILANCE", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const o of obsValides) {
      const label = STATUT_OBS_LABEL[o.statut] || "NOTE";
      const couleur = STATUT_OBS_COLOR[o.statut] || GREY;
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: `[${label}] `, bold: true, size: 22, font: "Arial", color: couleur }),
          new TextRun({ text: o.texte, size: 22, font: "Arial", color: DARK }),
        ],
        spacing: { before: 0, after: 60 },
      }));
    }
    children.push(sp(200));
  }

  // ─── TRAVAUX À VENIR ─────────────────────────────────────────────────────────
  if (infos.travaux && infos.travaux.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "TRAVAUX À VENIR / DÉCISIONS PRISES", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    infos.travaux.split("\n").forEach(l => {
      if (l.trim()) children.push(new Paragraph({
        children: [new TextRun({ text: l, size: 22, font: "Arial", color: DARK })],
        spacing: { before: 0, after: 60 },
      }));
    });
    children.push(sp(120));
  }

  // ─── REMARQUES ───────────────────────────────────────────────────────────────
  if (infos.remarques && infos.remarques.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "REMARQUES COMPLÉMENTAIRES", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    infos.remarques.split("\n").forEach(l => {
      if (l.trim()) children.push(new Paragraph({
        children: [new TextRun({ text: l, size: 22, font: "Arial", color: DARK })],
        spacing: { before: 0, after: 60 },
      }));
    });
    children.push(sp(120));
  }

  // ─── PHOTOS ──────────────────────────────────────────────────────────────────
  if (photos.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "PHOTOS", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const ph of photos.slice(0, 20)) {
      const imgBuf = await fetchImage(ph.data);
      if (imgBuf) {
        try {
          children.push(new Paragraph({
            children: [new ImageRun({ data: imgBuf, transformation: { width: 300, height: 225 } })],
            spacing: { before: 60, after: 80 },
          }));
        } catch (e) { console.warn("Photo failed:", e.message); }
      }
    }
  }

  // ─── SIGNATURES ──────────────────────────────────────────────────────────────
  children.push(sp(400));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Responsable PROFERO", bold: true, size: 20, font: "Arial", color: DARK }),
      new TextRun({ text: "                                          ", size: 20, font: "Arial" }),
      new TextRun({ text: clients[0] || "Client", bold: true, size: 20, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 60 },
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Signature :", italics: true, size: 18, font: "Arial", color: GREY }),
      new TextRun({ text: "                                                       ", size: 18, font: "Arial" }),
      new TextRun({ text: "Lu et approuvé, signature :", italics: true, size: 18, font: "Arial", color: GREY }),
    ],
    spacing: { before: 0, after: 0 },
  }));

  // ─── PIED DE PAGE ────────────────────────────────────────────────────────────
  children.push(sp(400));
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Document généré automatiquement par ${societe.nom || "Profero Rénovation"} — ${new Date().toLocaleDateString("fr-FR")}`,
      size: 16, italics: true, font: "Arial", color: GREY,
    })],
    alignment: AlignmentType.CENTER,
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
    const safe = (clients[0] || "client").replace(/[^a-zA-Z0-9-_]/g, "_");
    res.setHeader('Content-Disposition', `attachment; filename="CR-${safe}-${infos.date_visite || ""}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Erreur Packer:', e);
    res.status(500).json({ error: e.message });
  }
};
