// api/generate-docx.js — Vercel serverless function (CommonJS)
// Génère un compte rendu .docx enrichi par Claude si des notes libres sont fournies
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle,
} = require('docx');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { weekId, totalH, chantierData, notesLibres } = req.body;
  if (!weekId || !chantierData) return res.status(400).json({ error: 'Missing data' });

  // ── Si notes libres : demander à Claude d'enrichir les données ───────────────
  let dataFinale = chantierData;

  if (notesLibres && notesLibres.trim()) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        const prompt = `Tu es assistant pour une entreprise de rénovation (Profero Rénovation).
On te donne les données brutes du bilan hebdomadaire de la semaine ${weekId}, et des notes libres de l'équipe.
Tu dois enrichir, reformuler ou compléter les données pour le compte rendu selon les instructions des notes.
Réponds UNIQUEMENT avec un JSON valide (pas de markdown, pas d'explication) : un tableau de chantiers avec la même structure que l'entrée.

Structure d'entrée de chaque chantier :
{ nom, heures, presences[], faites[], enCours[], nonFaites[], remarques[] }
Chaque tâche : { texte, remarque, ouvrier }
Chaque remarque : { ouvrier, texte }

Données brutes :
${JSON.stringify(chantierData, null, 2)}

Notes libres de l'équipe :
${notesLibres}

Règles :
- Ne supprime aucune tâche existante sauf si les notes le demandent explicitement
- Tu peux reformuler, enrichir, ajouter du contexte dans les champs "texte"
- Tu peux ajouter des tâches ou remarques si les notes l'indiquent
- Garde les noms des ouvriers tels quels
- Réponds avec le même tableau JSON, même structure, même nombre de chantiers`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (response.ok) {
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text || '';
          const clean = text.replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(clean);
          if (Array.isArray(parsed)) dataFinale = parsed;
        }
      } catch (e) {
        console.warn('Claude enrichissement ignoré:', e.message);
        // On continue avec les données brutes si Claude échoue
      }
    }
  }

  // ── Génération du .docx ───────────────────────────────────────────────────────
  const GOLD = "E6AE00", DARK = "1A1F2E", GREY = "5B6A8A";
  const GREEN = "1A6B3A", ORANGE = "B05A10", RED = "B03030";

  const sp = (n) => new Paragraph({ children: [], spacing: { before: n, after: 0 } });
  const children = [];

  // En-tête
  children.push(new Paragraph({
    children: [new TextRun({ text: "PROFERO RÉNOVATION", bold: true, size: 36, font: "Arial", color: DARK })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Compte rendu hebdomadaire — Semaine ${weekId}`, size: 26, font: "Arial", color: GREY })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 320 },
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Total heures réelles : ", size: 24, font: "Arial", color: GREY }),
      new TextRun({ text: `${Number(totalH).toFixed(1)}h`, bold: true, size: 28, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 400 },
  }));

  // Chantiers
  dataFinale.forEach((ch, idx) => {
    if (idx > 0) children.push(sp(400));

    children.push(new Paragraph({
      children: [
        new TextRun({ text: (ch.nom || "").toUpperCase(), bold: true, size: 32, font: "Arial", color: DARK }),
        ...(ch.heures > 0 ? [new TextRun({ text: `  —  ${Number(ch.heures).toFixed(1)}h cumulées`, size: 24, font: "Arial", color: GREY })] : []),
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 0, after: 200 },
    }));

    const addSection = (titre, couleur, items) => {
      if (!items || items.length === 0) return;
      children.push(new Paragraph({
        children: [new TextRun({ text: titre, bold: true, size: 22, font: "Arial", color: couleur })],
        spacing: { before: 200, after: 80 },
      }));
      items.forEach(t => {
        const isRemarque = t.ouvrier !== undefined && t.texte !== undefined && !('remarque' in t);
        const txt = isRemarque
          ? `${t.ouvrier} : ${t.texte}`
          : `${t.texte || ""}${t.remarque ? ` — ${t.remarque}` : ""}${t.ouvrier ? ` (${t.ouvrier})` : ""}`;
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [new TextRun({ text: txt, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 40, after: 40 },
        }));
      });
    };

    if (ch.presences && ch.presences.length > 0) {
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

    addSection("Travaux réalisés", GREEN,  ch.faites);
    addSection("En cours",         ORANGE, ch.enCours);
    addSection("Non réalisé",      RED,    ch.nonFaites);
    addSection("Remarques",        GREY,   ch.remarques);
  });

  // Signature
  children.push(sp(600));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Cordialement,", size: 22, font: "Arial", color: GREY })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Équipe Profero Rénovation", bold: true, size: 22, font: "Arial", color: DARK })],
  }));

  const doc = new Document({
    numbering: {
      config: [{ reference: "bullets", levels: [{
        level: 0, format: LevelFormat.BULLET, text: "–",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 560, hanging: 280 } } },
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
    res.setHeader('Content-Disposition', `attachment; filename="Compte-rendu-${weekId}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Erreur Packer:', e);
    res.status(500).json({ error: e.message });
  }
};
