// api/generate-docx.js — Vercel serverless function
// Génère un compte rendu hebdomadaire .docx au format Profero Rénovation
// Place ce fichier dans le dossier /api/ à la racine du repo

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType,
  HeadingLevel, PageNumber, Header, Footer
} from 'docx';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { weekId, totalH, chantierData } = req.body;
  if (!weekId || !chantierData) return res.status(400).json({ error: 'Missing data' });

  // ── Couleurs ──────────────────────────────────────────────────────────────────
  const GOLD    = "E6AE00";
  const DARK    = "1A1F2E";
  const GREY    = "5B6A8A";
  const GREEN   = "207040";
  const ORANGE  = "C07020";
  const RED     = "C04040";
  const WHITE   = "FFFFFF";

  const sp = (n) => new Paragraph({ children: [], spacing: { before: n, after: 0 } });

  const children = [];

  // ── En-tête document ─────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "PROFERO RÉNOVATION", bold: true, size: 36, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 80 },
  }));

  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Compte rendu hebdomadaire — Semaine ${weekId}`, size: 26, font: "Arial", color: GREY }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 320 },
  }));

  // ── Résumé global ─────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `Total heures réelles : `, size: 24, font: "Arial", color: GREY }),
      new TextRun({ text: `${totalH.toFixed(1)}h`, bold: true, size: 28, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 400 },
  }));

  // ── Un bloc par chantier ──────────────────────────────────────────────────────
  chantierData.forEach((ch, idx) => {
    if (idx > 0) children.push(sp(400));

    // Titre chantier
    children.push(new Paragraph({
      children: [
        new TextRun({ text: ch.nom.toUpperCase(), bold: true, size: 32, font: "Arial", color: DARK }),
        ch.heures > 0
          ? new TextRun({ text: `  —  ${ch.heures.toFixed(1)}h cumulées`, size: 24, font: "Arial", color: GREY })
          : new TextRun({ text: "" }),
      ],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 },
      },
      spacing: { before: 0, after: 200 },
    }));

    // Présences
    if (ch.presences.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Présences", bold: true, size: 22, font: "Arial", color: GREY })],
        spacing: { before: 160, after: 80 },
      }));
      ch.presences.forEach(p => {
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: p, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    }

    // Travaux réalisés
    if (ch.faites.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Travaux réalisés", bold: true, size: 22, font: "Arial", color: GREEN })],
        spacing: { before: 200, after: 80 },
      }));
      ch.faites.forEach(t => {
        const txt = t.texte + (t.remarque ? ` — ${t.remarque}` : "") + (t.ouvrier ? ` (${t.ouvrier})` : "");
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: txt, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    }

    // En cours
    if (ch.enCours.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "En cours", bold: true, size: 22, font: "Arial", color: ORANGE })],
        spacing: { before: 200, after: 80 },
      }));
      ch.enCours.forEach(t => {
        const txt = t.texte + (t.remarque ? ` — ${t.remarque}` : "") + (t.ouvrier ? ` (${t.ouvrier})` : "");
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: txt, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    }

    // Non réalisé
    if (ch.nonFaites.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Non réalisé", bold: true, size: 22, font: "Arial", color: RED })],
        spacing: { before: 200, after: 80 },
      }));
      ch.nonFaites.forEach(t => {
        const txt = t.texte + (t.remarque ? ` — ${t.remarque}` : "") + (t.ouvrier ? ` (${t.ouvrier})` : "");
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: txt, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    }

    // Remarques
    if (ch.remarques.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "Remarques", bold: true, size: 22, font: "Arial", color: GREY })],
        spacing: { before: 200, after: 80 },
      }));
      ch.remarques.forEach(r => {
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [
            new TextRun({ text: `${r.ouvrier} : `, bold: true, size: 22, font: "Arial", color: GREY }),
            new TextRun({ text: r.texte, size: 22, font: "Arial", color: DARK, italics: true }),
          ],
          spacing: { before: 40, after: 40 },
        }));
      });
    }
  });

  // ── Signature ─────────────────────────────────────────────────────────────────
  children.push(sp(600));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Cordialement,", size: 22, font: "Arial", color: GREY })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Équipe Profero Rénovation", bold: true, size: 22, font: "Arial", color: DARK })],
  }));

  // ── Document ──────────────────────────────────────────────────────────────────
  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "–",
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 560, hanging: 280 } } },
        }],
      }],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2cm
        },
      },
      children,
    }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Compte-rendu-${weekId}.docx"`);
    res.send(buffer);
  } catch(e) {
    console.error('Erreur génération docx:', e);
    res.status(500).json({ error: e.message });
  }
}
