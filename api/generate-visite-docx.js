// api/generate-visite-docx.js — Génère un compte rendu .docx d'une visite de chantier (modèle V2 : Lot → Ouvrage → Tâche)
const {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, LevelFormat, BorderStyle, ImageRun,
} = require('docx');

const GOLD = "E6AE00", DARK = "1A1F2E", GREY = "5B6A8A";
const GREEN = "1A6B3A", ORANGE = "B05A10", SLATE = "64748B";

const STATUTS = {
  en_cours: "En cours",
  cloturee: "Clôturée",
  annulee:  "Annulée",
};

// Statuts d'une tâche auditée (V2)
const statutLabel = (s) =>
  s === "valide"       ? "VALIDÉ" :
  s === "reserve"      ? "RÉSERVE" :
  s === "non_commence" ? "PAS COMMENCÉ" : "—";
const statutColor = (s) =>
  s === "valide"       ? GREEN :
  s === "reserve"      ? ORANGE :
  s === "non_commence" ? SLATE : GREY;

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
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return Buffer.from(buf);
  } catch (e) {
    console.warn('fetchImage failed:', url, e.message);
    return null;
  }
}

// Regroupe les tâches d'un lot par ouvrage (conserve l'ordre d'apparition)
function groupByOuvrage(taches = []) {
  const groups = [];
  const idx = {};
  taches.forEach(t => {
    const key = t.ouvrage_id || "_";
    if (idx[key] === undefined) {
      idx[key] = groups.length;
      groups.push({ ouvrage_libelle: t.ouvrage_libelle || "Ouvrage", taches: [] });
    }
    groups[idx[key]].taches.push(t);
  });
  return groups;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { visite, chantier, lots, reserves_heritees, derniere_visite_date } = req.body;
  if (!visite || !Array.isArray(lots)) return res.status(400).json({ error: 'Missing data' });

  const audit = visite.audit || {};
  const checklist = Array.isArray(visite.checklist) ? visite.checklist : [];
  const allTaches = [];
  lots.forEach(l => {
    (audit[l.id] || []).forEach(t => allTaches.push({ ...t, _lot: l }));
  });
  // Bilan global inclut les items de checklist
  const allEvaluables = [...allTaches, ...checklist];
  const nb_ok  = allEvaluables.filter(t => t.statut === "valide").length;
  const nb_res = allEvaluables.filter(t => t.statut === "reserve").length;
  const nb_af  = allEvaluables.filter(t => t.statut === "non_commence").length;
  const nb_nd  = allEvaluables.filter(t => !t.statut).length;
  const total  = allEvaluables.length;

  const children = [];

  // ─── EN-TÊTE ─────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({ text: "PROFERO RÉNOVATION", bold: true, size: 36, font: "Arial", color: DARK })],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Compte rendu de visite de chantier", size: 26, font: "Arial", color: GREY })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
    spacing: { before: 0, after: 320 },
  }));

  // ─── MÉTA-INFO ───────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Chantier : ", size: 24, font: "Arial", color: GREY }),
      new TextRun({ text: chantier?.nom || visite.chantier_id || "—", bold: true, size: 24, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Date de visite : ", size: 24, font: "Arial", color: GREY }),
      new TextRun({ text: fmtDate(visite.date), bold: true, size: 24, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 80 },
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: "Statut : ", size: 24, font: "Arial", color: GREY }),
      new TextRun({ text: STATUTS[visite.statut] || visite.statut || "—", bold: true, size: 24, font: "Arial", color: DARK }),
    ],
    spacing: { before: 0, after: 320 },
  }));

  // ─── KPI ─────────────────────────────────────────────────────────────────────
  if (total > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "BILAN GLOBAL", bold: true, size: 22, font: "Arial", color: GREY })],
      spacing: { before: 0, after: 80 },
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${nb_ok} validées`, bold: true, size: 22, font: "Arial", color: GREEN }),
        new TextRun({ text: "   ·   ", size: 22, font: "Arial", color: GREY }),
        new TextRun({ text: `${nb_res} réserves`, bold: true, size: 22, font: "Arial", color: ORANGE }),
        new TextRun({ text: "   ·   ", size: 22, font: "Arial", color: GREY }),
        new TextRun({ text: `${nb_af} pas commencées`, bold: true, size: 22, font: "Arial", color: SLATE }),
        new TextRun({ text: "   ·   ", size: 22, font: "Arial", color: GREY }),
        new TextRun({ text: `${nb_nd} non évaluées`, size: 22, font: "Arial", color: GREY }),
      ],
      spacing: { before: 0, after: 80 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `Sur ${total} point${total > 1 ? "s" : ""} dans la portée d'audit.`, size: 20, italics: true, font: "Arial", color: GREY })],
      spacing: { before: 0, after: 320 },
    }));
  }

  // ─── NOTE GÉNÉRALE ───────────────────────────────────────────────────────────
  if (visite.note_generale && visite.note_generale.trim()) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "NOTE GÉNÉRALE", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 0, after: 120 },
    }));
    visite.note_generale.split("\n").forEach(line => {
      if (line.trim()) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 22, font: "Arial", color: DARK })],
          spacing: { before: 0, after: 40 },
        }));
      }
    });
    children.push(sp(200));
  }

  // ─── RÉSERVES HÉRITÉES ───────────────────────────────────────────────────────
  if (Array.isArray(reserves_heritees) && reserves_heritees.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `SUIVI DES RÉSERVES — VISITE DU ${fmtDate(derniere_visite_date)}`, bold: true, size: 22, font: "Arial", color: ORANGE })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ORANGE, space: 4 } },
      spacing: { before: 0, after: 120 },
    }));
    reserves_heritees.forEach(r => {
      const isLevee = r.statut_courant === "valide";
      const statutTxt = isLevee ? "✓ LEVÉE" : r.statut_courant === "reserve" ? "⚠ TOUJOURS PRÉSENTE" : "à évaluer";
      const couleur = isLevee ? GREEN : r.statut_courant === "reserve" ? "B03030" : GREY;
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: `${r.nom_origine} `, bold: true, size: 22, font: "Arial", color: DARK }),
          new TextRun({ text: `(${r.lot_label}) — `, size: 22, font: "Arial", color: GREY }),
          new TextRun({ text: statutTxt, bold: true, size: 22, font: "Arial", color: couleur }),
        ],
        spacing: { before: 0, after: 40 },
      }));
      if (r.commentaire_origine) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   "${r.commentaire_origine}"`, italics: true, size: 20, font: "Arial", color: GREY })],
          spacing: { before: 0, after: 40 },
        }));
      }
    });
    children.push(sp(200));
  }

  // ─── POINTS DE VIGILANCE (checklist) ─────────────────────────────────────────
  if (checklist.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "POINTS DE VIGILANCE", bold: true, size: 24, font: "Arial", color: DARK })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 200, after: 120 },
    }));
    for (const item of checklist) {
      children.push(new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: `[${statutLabel(item.statut)}] `, bold: true, size: 22, font: "Arial", color: statutColor(item.statut) }),
          new TextRun({ text: item.label || "", size: 22, font: "Arial", color: DARK }),
        ],
        spacing: { before: 0, after: 40 },
      }));
      if (item.commentaire) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `   "${item.commentaire}"`, italics: true, size: 20, font: "Arial", color: GREY })],
          spacing: { before: 0, after: 40 },
        }));
      }
      if (Array.isArray(item.photos) && item.photos.length > 0) {
        for (const url of item.photos.slice(0, 4)) {
          const imgBuf = await fetchImage(url);
          if (imgBuf) {
            try {
              children.push(new Paragraph({
                children: [new ImageRun({ data: imgBuf, transformation: { width: 220, height: 165 } })],
                spacing: { before: 60, after: 60 },
              }));
            } catch (e) { console.warn('ImageRun failed:', e.message); }
          }
        }
      }
    }
  }

  // ─── DÉTAIL PAR LOT → OUVRAGE → TÂCHE ────────────────────────────────────────
  for (const l of lots) {
    const taches = audit[l.id] || [];
    if (taches.length === 0) continue;

    const lot_ok  = taches.filter(t => t.statut === "valide").length;
    const lot_res = taches.filter(t => t.statut === "reserve").length;
    const lot_af  = taches.filter(t => t.statut === "non_commence").length;

    children.push(new Paragraph({
      children: [
        new TextRun({ text: (l.label || "").toUpperCase(), bold: true, size: 24, font: "Arial", color: DARK }),
        new TextRun({ text: `   —  ${lot_ok} validées · ${lot_res} rés · ${lot_af} à faire`, size: 20, font: "Arial", color: GREY }),
      ],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 200, after: 120 },
    }));

    for (const g of groupByOuvrage(taches)) {
      children.push(new Paragraph({
        children: [new TextRun({ text: g.ouvrage_libelle.toUpperCase(), bold: true, size: 20, font: "Arial", color: GREY })],
        spacing: { before: 80, after: 60 },
      }));

      for (const t of g.taches) {
        children.push(new Paragraph({
          numbering: { reference: "bullets", level: 0 },
          children: [
            new TextRun({ text: `[${statutLabel(t.statut)}] `, bold: true, size: 22, font: "Arial", color: statutColor(t.statut) }),
            new TextRun({ text: t.nom || "", size: 22, font: "Arial", color: DARK }),
          ],
          spacing: { before: 0, after: 40 },
        }));

        if (t.commentaire) {
          children.push(new Paragraph({
            children: [new TextRun({ text: `   "${t.commentaire}"`, italics: true, size: 20, font: "Arial", color: GREY })],
            spacing: { before: 0, after: 40 },
          }));
        }

        if (Array.isArray(t.photos) && t.photos.length > 0) {
          for (const url of t.photos.slice(0, 4)) { // max 4 photos par tâche pour limiter la taille
            const imgBuf = await fetchImage(url);
            if (imgBuf) {
              try {
                children.push(new Paragraph({
                  children: [new ImageRun({ data: imgBuf, transformation: { width: 220, height: 165 } })],
                  spacing: { before: 60, after: 60 },
                }));
              } catch (e) {
                console.warn('ImageRun failed:', e.message);
              }
            }
          }
        }
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
    const safeName = (chantier?.nom || "visite").replace(/[^a-zA-Z0-9-_]/g, "_");
    res.setHeader('Content-Disposition', `attachment; filename="Visite-${safeName}-${visite.date}.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Erreur Packer:', e);
    res.status(500).json({ error: e.message });
  }
};
