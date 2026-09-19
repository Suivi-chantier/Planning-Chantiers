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

const eur = (n) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (n) => `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
const lignesAdresse = (adresse, complement, cp, ville, pays) =>
  [adresse, complement, [cp, ville].filter(Boolean).join(" "), pays].map(s => (s || "").trim()).filter(Boolean);

// DOCUMENT CLIENT : prix de vente HT, TVA et TTC uniquement. Les coûts internes
// et la marge (cout_*_unitaire, taux_marge_pct) présents sur les lignes ne sont
// JAMAIS écrits dans ce document.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { infos = {}, ouvrages = [], cotes = [], plans = [], photos: medias = [], groupes: groupesIn = null, totaux: totauxIn = null, logement: logementIn = null, lotsOrdre = [] } = req.body || {};
  // Les vidéos ne s'intègrent pas dans un .docx : on ne garde que les images.
  const photos = (Array.isArray(medias) ? medias : []).filter(p => p && p.type !== "video");

  // Regroupement LOT → ZONE → OUVRAGES et totaux : calculés par le module pur
  // partagé avec le front (src/Renovation/chiffragePricing.mjs), sauf si la
  // page les a déjà transmis.
  const pricing = await import("../src/Renovation/chiffragePricing.mjs");
  const tvaProjet = pricing.num(infos.tva_pct);
  const groupes = Array.isArray(groupesIn) ? groupesIn : pricing.grouperParLotZone(ouvrages, lotsOrdre);
  const totaux = totauxIn || pricing.totauxDevis(ouvrages, { tvaPctDefaut: tvaProjet, budgetClient: pricing.num(infos.budget_client) });
  const logement = logementIn || pricing.lireLogementProjet(infos);
  const totalGlobal = totaux.venteHT || 0;

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
  line("Nom / Prénom", `${infos.client_nom || ""} ${infos.client_prenom || ""}`.trim() || infos.client_societe || "");
  if (infos.client_societe) line("Société", infos.client_societe);
  if (infos.client_email || infos.client_telephone) line("Contact", [infos.client_email, infos.client_telephone].filter(Boolean).join(" · "));
  const adrFact = lignesAdresse(infos.client_adresse, infos.client_adresse_complement, infos.client_code_postal, infos.client_ville, infos.client_pays);
  if (adrFact.length) line("Adresse de facturation", adrFact.join(", "));
  const adrChantier = lignesAdresse(infos.chantier_adresse, infos.chantier_adresse_complement, infos.chantier_code_postal, infos.chantier_ville, infos.chantier_pays);
  line("Adresse du chantier", adrChantier.length ? adrChantier.join(", ") : (infos.adresse_bien || "").replace(/\s*\n\s*/g, ", "));
  const logementTexte = [logement?.reference, logement?.type].filter(Boolean).join(" · ");
  if (logementTexte) line("Logement", logementTexte);
  line("Date de visite", fmtDate(infos.date_visite));
  line("Statut", STATUTS_LABELS[infos.statut] || "Prospect");
  if (infos.devis_objet) line("Objet du devis", infos.devis_objet);
  if (infos.devis_date || infos.devis_validite) line("Devis", [infos.devis_date ? `préparé le ${fmtDate(infos.devis_date)}` : "", infos.devis_validite ? `valable jusqu'au ${fmtDate(infos.devis_validite)}` : ""].filter(Boolean).join(", "));
  if (tvaProjet != null) line("TVA appliquée", pct(tvaProjet));
  if (infos.devis_num_commande_client) line("N° de commande client", infos.devis_num_commande_client);
  if (infos.description_projet) line("Description", infos.description_projet);
  if (infos.budget_client != null && infos.budget_client !== "" && !isNaN(parseFloat(infos.budget_client))) {
    line("Budget client (HT)", `${parseFloat(infos.budget_client).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`);
  }
  if (infos.delai_souhaite) line("Délai souhaité", infos.delai_souhaite);
  if (infos.devis_conditions) line("Conditions particulières", infos.devis_conditions);
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

  // ─── OUVRAGES : LOT → ZONE → OUVRAGES ────────────────────────────────────────
  if (ouvrages.length > 0) {
    children.push(new Paragraph({
      children: [new TextRun({ text: "OUVRAGES — PRIX HT", bold: true, size: 22, font: "Arial", color: GREY })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } },
      spacing: { before: 100, after: 120 },
    }));
    for (const g of groupes) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: (g.lot || "Autre").toUpperCase(), bold: true, size: 22, font: "Arial", color: DARK }),
          g.total > 0 ? new TextRun({ text: `   —  ${eur(g.total)}`, size: 20, font: "Arial", color: GREEN }) : new TextRun({ text: "" }),
        ],
        spacing: { before: 120, after: 60 },
      }));
      for (const z of g.zones || []) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: (z.zone || "Logement entier").toUpperCase(), bold: true, size: 19, font: "Arial", color: GREY }),
            (g.zones.length > 1 && z.total > 0) ? new TextRun({ text: `   ${eur(z.total)}`, size: 18, font: "Arial", color: GREY }) : new TextRun({ text: "" }),
          ],
          indent: { left: 200 },
          spacing: { before: 60, after: 30 },
        }));
        for (const o of z.lignes || []) {
          const q = parseFloat(o.quantite) || 0;
          const pu = o.prix_unitaire == null || o.prix_unitaire === "" ? null : parseFloat(o.prix_unitaire);
          const totalLigne = pu == null ? null : Math.round(q * pu * 100) / 100;
          const parts = [];
          if (o.code_ouvrage) parts.push(new TextRun({ text: `${o.code_ouvrage}  `, bold: true, size: 20, font: "Arial", color: GREY }));
          parts.push(new TextRun({ text: o.item || "", size: 22, font: "Arial", color: DARK }));
          if (q > 0) parts.push(new TextRun({ text: `   ${q} ${o.unite || "U"}`, size: 20, font: "Arial", color: GREY }));
          if (pu != null) parts.push(new TextRun({ text: `   × ${eur(pu)}`, size: 20, font: "Arial", color: GREY }));
          if (totalLigne != null && totalLigne > 0) parts.push(new TextRun({ text: `   = ${eur(totalLigne)}`, bold: true, size: 20, font: "Arial", color: GREEN }));
          const tvaLigne = o.tva_pct == null || o.tva_pct === "" ? null : parseFloat(o.tva_pct);
          if (tvaLigne != null && tvaProjet != null && tvaLigne !== tvaProjet) parts.push(new TextRun({ text: `   (TVA ${pct(tvaLigne)})`, size: 18, font: "Arial", color: GREY }));
          children.push(new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            children: parts,
            indent: { left: 560, hanging: 220 },
            spacing: { before: 0, after: 40 },
          }));
        }
      }
    }
    if (totalGlobal > 0) {
      children.push(sp(100));
      children.push(new Paragraph({
        children: [
          new TextRun({ text: "TOTAL HT : ", bold: true, size: 24, font: "Arial", color: DARK }),
          new TextRun({ text: eur(totalGlobal), bold: true, size: 28, font: "Arial", color: GREEN }),
        ],
        border: { top: { style: BorderStyle.SINGLE, size: 12, color: GOLD, space: 4 } },
        spacing: { before: 100, after: 60 },
      }));
      if (totaux.tva == null) {
        children.push(new Paragraph({ children: [new TextRun({ text: "TVA : à définir — total TTC non calculé", italics: true, size: 20, font: "Arial", color: GREY })], spacing: { before: 0, after: 240 } }));
      } else {
        for (const [k, v] of Object.entries(totaux.tvaDetail || {})) {
          children.push(new Paragraph({ children: [new TextRun({ text: `TVA ${pct(k)} : `, size: 22, font: "Arial", color: GREY }), new TextRun({ text: eur(v), bold: true, size: 22, font: "Arial", color: DARK })], spacing: { before: 0, after: 40 } }));
        }
        children.push(new Paragraph({
          children: [
            new TextRun({ text: "TOTAL TTC : ", bold: true, size: 24, font: "Arial", color: DARK }),
            new TextRun({ text: eur(totaux.ttc), bold: true, size: 28, font: "Arial", color: DARK }),
          ],
          spacing: { before: 60, after: 240 },
        }));
      }
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
