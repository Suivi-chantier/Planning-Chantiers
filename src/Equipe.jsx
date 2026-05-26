import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import html2pdf from "html2pdf.js";
import { supabase, photoTransform } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, BIBLIOTHEQUE_INITIALE, getCurrentWeek, getWeekId, getBranchAccent, FONT, RADIUS, LOGO_RENO_H } from "./constants";
import { Icon } from "./ui";
import {
  Users, ChartBar, Link2, Copy, HardHat, Building2, Calendar, Clock,
  Check, X, RefreshCw, MessageSquare, Pencil, Camera, FileDown, Trash2,
  ArrowRight, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RotateCcw, ExternalLink,
} from "lucide-react";

// ─── PAGE ÉQUIPE ──────────────────────────────────────────────────────────────
// ─── HEURES PAR JOUR ─────────────────────────────────────────────────────────
const HEURES_PAR_JOUR = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9 };

// ─── MODAL BILAN SEMAINE ──────────────────────────────────────────────────────
function BilanSemaine({ rapports, chantiers, cells, weekId, onClose, T }) {
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftStatus, setDraftStatus]     = useState(null);

  // ── Détection ouvriers sur plusieurs chantiers un même jour ─────────────────
  const conflits = (() => {
    const result = [];
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const parOuvrier = {};
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!parOuvrier[o]) parOuvrier[o] = [];
          parOuvrier[o].push(cid);
        });
      });
      Object.entries(parOuvrier).forEach(([ouvrier, chantierIds]) => {
        if (chantierIds.length < 2) return;
        const heuresJour = HEURES_PAR_JOUR[jour];
        const heuresInit = {};
        chantierIds.forEach(cid => { heuresInit[cid] = parseFloat((heuresJour / chantierIds.length).toFixed(1)); });
        result.push({ jour, ouvrier, chantierIds, heures: heuresInit, heuresJour });
      });
    });
    return result;
  })();

  const [etape, setEtape] = useState(conflits.length > 0 ? "saisie" : "bilan");
  const [heuresSaisies, setHeuresSaisies] = useState(() => {
    const init = {};
    conflits.forEach(c => {
      if (!init[c.jour]) init[c.jour] = {};
      init[c.jour][c.ouvrier] = { ...c.heures };
    });
    return init;
  });

  const setH = (jour, ouvrier, chantierId, val) => {
    setHeuresSaisies(prev => ({
      ...prev,
      [jour]: { ...prev[jour], [ouvrier]: { ...prev[jour]?.[ouvrier], [chantierId]: val } }
    }));
  };

  // ── Calcul heures réelles par chantier ───────────────────────────────────────
  const calcHeuresParChantier = () => {
    const res = {};
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const heuresJour = HEURES_PAR_JOUR[jour];
      const conflitsJour = conflits.filter(c => c.jour === jour);
      const ouvrierEnConflit = new Set(conflitsJour.map(c => c.ouvrier));
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!res[cid]) res[cid] = 0;
          if (ouvrierEnConflit.has(o)) {
            res[cid] += parseFloat(heuresSaisies[jour]?.[o]?.[cid] || 0);
          } else {
            res[cid] += heuresJour;
          }
        });
      });
    });
    return res;
  };

  const heuresParChantier = etape === "bilan" ? calcHeuresParChantier() : {};
  const totalHeures = Object.values(heuresParChantier).reduce((a, b) => a + b, 0);
  const totalFaites = rapports.reduce((a, r) => a + (r.taches||[]).filter(t => t.statut==="faite").length, 0);

  // ── Regroupement rapports par chantier ───────────────────────────────────────
  const parChantier = {};
  rapports.forEach(r => {
    const key = r.chantier_id || "__divers__";
    if (!parChantier[key]) parChantier[key] = { rapports: [], nom: r.chantier_nom || "Divers" };
    parChantier[key].rapports.push(r);
  });

  // ── Progression hebdomadaire par chantier ───────────────────────────────────
  // Pour chaque chantier ayant un rapport cette semaine, on récupère le dernier
  // snapshot d'avancement antérieur à lundi (= "avant cette semaine") et on
  // calcule l'avancement actuel depuis plan_travaux (= "maintenant").
  // Le delta donne la progression gagnée durant la semaine.
  const [progressions, setProgressions] = useState({});
  const chantierIdsKey = JSON.stringify(Object.keys(parChantier));
  useEffect(() => {
    if (etape !== "bilan") return;
    let cancelled = false;
    (async () => {
      // Lundi 00:00 de la semaine en cours
      const today = new Date(); today.setHours(0,0,0,0);
      const dow = today.getDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const lundi = new Date(today); lundi.setDate(today.getDate() + diff);
      const lundiIso = lundi.toISOString().slice(0,10);

      const chantierIds = JSON.parse(chantierIdsKey).filter(k => k !== "__divers__");
      if (chantierIds.length === 0) return;

      const [phasagesQ, snapshotsQ] = await Promise.all([
        // plan_travaux contient meta.prix_vendu (montant chantier TTC vendu).
        // Sert au calcul "delta % → delta €" affiché à côté de la progression.
        supabase.from("phasages").select("chantier_id, plan_travaux").in("chantier_id", chantierIds),
        supabase.from("chantier_avancement_history")
          .select("chantier_id, avancement, date_snapshot")
          .in("chantier_id", chantierIds)
          .lt("date_snapshot", lundiIso)
          .order("date_snapshot", { ascending: false }),
      ]);
      if (cancelled) return;

      // Snapshot le plus récent par chantier avant lundi
      const snapshotByCh = {};
      (snapshotsQ.data || []).forEach(s => {
        if (!snapshotByCh[s.chantier_id]) snapshotByCh[s.chantier_id] = s;
      });

      // Avancement actuel + prix vendu par chantier (mêmes formules que
      // phasageToChantier pour rester cohérent).
      const actuelByCh   = {};
      const prixVenduByCh = {};
      (phasagesQ.data || []).forEach(ph => {
        const plan = ph.plan_travaux || {};
        prixVenduByCh[ph.chantier_id] = parseFloat(plan.meta?.prix_vendu) || 0;
        const allTaches = [];
        for (const k of Object.keys(plan)) {
          if (k === "meta" || k.includes("__")) continue;
          if (Array.isArray(plan[k])) allTaches.push(...plan[k]);
        }
        if (allTaches.length === 0) { actuelByCh[ph.chantier_id] = 0; return; }
        const totalHV = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
        const av = totalHV > 0
          ? Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHV)
          : Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / allTaches.length);
        actuelByCh[ph.chantier_id] = av;
      });

      const map = {};
      chantierIds.forEach(cid => {
        const avant     = snapshotByCh[cid]?.avancement;
        const maintenant = actuelByCh[cid];
        if (maintenant == null) return;
        const delta = avant != null ? (maintenant - avant) : null;
        const prixVendu = prixVenduByCh[cid] || 0;
        map[cid] = {
          avant:      avant ?? null,
          maintenant,
          delta,
          deltaEuros: (delta != null && prixVendu > 0) ? Math.round(prixVendu * delta / 100) : null,
          prixVendu,
          dateAvant:  snapshotByCh[cid]?.date_snapshot || null,
        };
      });
      setProgressions(map);
    })();
    return () => { cancelled = true; };
  }, [etape, chantierIdsKey]);

  // Total € généré cette semaine : somme des delta € positifs des progressions.
  // Les chantiers en régression (delta < 0) ne sont pas comptés ici (le total
  // représente la valeur AJOUTÉE durant la semaine, pas un solde).
  const totalGenereEuros = Object.values(progressions).reduce(
    (s, p) => s + (p?.deltaEuros && p.deltaEuros > 0 ? p.deltaEuros : 0), 0
  );

  // ── Création brouillon Gmail ─────────────────────────────────────────────────
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [showNotes, setShowNotes]         = useState(false);
  const [notesLibres, setNotesLibres]     = useState("");

  const genererDocx = async () => {
    setGeneratingDoc(true);
    setDraftStatus(null);
    try {
      const hpc = calcHeuresParChantier();
      const totalH = Object.values(hpc).reduce((a, b) => a + b, 0);

      // ── Dédoublonnage des tâches : si plusieurs ouvriers ont rendu la même
      //    tâche, on fusionne en une seule entrée avec la liste des ouvriers
      //    et les remarques concaténées (uniques).
      const normTexte = (s) => (s||"").toLowerCase().replace(/\s+/g," ").trim();
      const dedupe = (rawList) => {
        const map = {};
        rawList.forEach(t => {
          const key = normTexte(t.texte);
          if (!key) return;
          if (!map[key]) map[key] = { texte: t.texte, remarques: new Set(), ouvriers: new Set() };
          if (t.remarque && t.remarque.trim()) map[key].remarques.add(t.remarque.trim());
          if (t.ouvrier) map[key].ouvriers.add(t.ouvrier);
        });
        return Object.values(map).map(v => ({
          texte: v.texte,
          remarque: [...v.remarques].join(" · "),
          ouvrier: [...v.ouvriers].join(", "),
        }));
      };
      const dedupeRemarques = (rawList) => {
        const map = {};
        rawList.forEach(r => {
          const key = normTexte(r.texte);
          if (!key) return;
          if (!map[key]) map[key] = { texte: r.texte, ouvriers: new Set() };
          if (r.ouvrier) map[key].ouvriers.add(r.ouvrier);
        });
        return Object.values(map).map(v => ({
          texte: v.texte,
          ouvrier: [...v.ouvriers].join(", "),
        }));
      };

      // Construire les données structurées pour le document
      const chantierData = Object.entries(parChantier).map(([cId, grp]) => {
        const hCh = hpc[cId] || 0;
        const taches = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier: r.ouvrier})));
        const presences = [];
        Object.keys(HEURES_PAR_JOUR).forEach(jour => {
          const cell = cells[`${cId}_${jour}`];
          if (cell && (cell.ouvriers||[]).length)
            presences.push(`${jour} : ${cell.ouvriers.join(", ")}`);
        });
        const rawFaites    = taches.filter(t=>t.statut==="faite")    .map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier }));
        const rawEnCours   = taches.filter(t=>t.statut==="en_cours") .map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier }));
        const rawNonFaites = taches.filter(t=>t.statut==="non_faite").map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier }));
        const rawRemarques = grp.rapports.filter(r=>r.remarque?.trim()).map(r=>({ ouvrier: r.ouvrier, texte: r.remarque }));
        const prog = progressions[cId] || null;
        return {
          nom: grp.nom,
          heures: hCh,
          presences,
          faites:    dedupe(rawFaites),
          enCours:   dedupe(rawEnCours),
          nonFaites: dedupe(rawNonFaites),
          remarques: dedupeRemarques(rawRemarques),
          // Progression hebdo : avancement avant/après et delta (peut être null
          // si pas de snapshot antérieur à cette semaine)
          progression: prog ? {
            avant:      prog.avant,
            maintenant: prog.maintenant,
            delta:      prog.delta,
            dateAvant:  prog.dateAvant,
          } : null,
        };
      });

      const response = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, totalH, chantierData, notesLibres })
      });

      if (!response.ok) {
        const err = await response.json().catch(()=>({error:"Erreur serveur"}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      // Télécharger le fichier
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Compte-rendu-${weekId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setDraftStatus("ok");
    } catch(e) {
      console.error("Erreur génération docx:", e);
      setDraftStatus("error");
    }
    setGeneratingDoc(false);
  };

  // ── HTML stylisé du bilan (utilisé par PDF et envoi mail) ─────────────────
  const buildBilanHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const fmt = (txt) => esc(txt).replace(/\n/g, "<br>");
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;

    const chantierBlocs = Object.entries(parChantier).map(([cId, grp]) => {
      const ch = chantiers.find(c => c.id === cId);
      const couleur = ch?.couleur || "#5b8af5";
      const heures = heuresParChantier[cId] || 0;
      const taches = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier:r.ouvrier})));
      const faites    = taches.filter(t => t.statut === "faite");
      const enCours   = taches.filter(t => t.statut === "en_cours");
      const nonFaites = taches.filter(t => t.statut === "non_faite");
      const remarques = grp.rapports.filter(r => r.remarque?.trim());
      const presences = [];
      Object.keys(HEURES_PAR_JOUR).forEach(jour => {
        const cell = cells[`${cId}_${jour}`];
        if (cell && (cell.ouvriers||[]).length) presences.push({ jour, ouvriers: cell.ouvriers });
      });
      const p = progressions[cId];
      let progBadge = "";
      if (p) {
        if (p.avant == null) {
          progBadge = `<span style="font-size:11pt;font-weight:600;color:#5b6a8a;background:#f0f3f8;border-radius:6pt;padding:3pt 9pt;">Avancement : <strong style="color:#1a1f2e;">${p.maintenant}%</strong></span>`;
        } else {
          const c = p.delta > 0 ? "#22c55e" : p.delta < 0 ? "#e15a5a" : "#5b6a8a";
          const sign = p.delta > 0 ? "+" : "";
          const euros = p.deltaEuros != null
            ? ` <span style="color:${c};font-weight:800;padding-left:6pt;border-left:1pt solid ${c}33;margin-left:4pt;">${p.deltaEuros > 0 ? "+" : ""}${p.deltaEuros.toLocaleString("fr-FR")} €</span>`
            : "";
          progBadge = `<span style="font-size:11pt;font-weight:600;color:#1a1f2e;background:${c}15;border:1pt solid ${c}55;border-radius:6pt;padding:3pt 9pt;"><span style="color:#5b6a8a;">${p.avant}% → </span><strong>${p.maintenant}%</strong> <span style="color:${c};font-weight:800;">(${sign}${p.delta} pt${Math.abs(p.delta)>1?"s":""})</span>${euros}</span>`;
        }
      }
      const listeTaches = (items, color, icon) => items.length === 0 ? "" : `
        <ul style="margin:6pt 0 10pt;padding:0;list-style:none;">
          ${items.map(t => `<li style="font-size:10pt;color:#333;margin-bottom:4pt;padding-left:16pt;position:relative;">
            <span style="position:absolute;left:0;color:${color};font-weight:700;">${icon}</span>
            ${esc(t.planifie||t.text||"")}${t.remarque ? ` <span style="color:#777;">— ${esc(t.remarque)}</span>` : ""}
            <span style="color:#999;font-size:9pt;"> (${esc(t.ouvrier||"")})</span>
          </li>`).join("")}
        </ul>`;
      return `
        <div class="chantier-card" style="background:#fff;border-radius:8pt;border:1pt solid #e6e6e6;border-left:5pt solid ${couleur};margin-bottom:14pt;overflow:hidden;page-break-inside:avoid;">
          <div style="background:${couleur}18;padding:12pt 16pt;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10pt;">
            <div style="display:flex;align-items:center;gap:10pt;flex-wrap:wrap;">
              <div style="width:12pt;height:12pt;background:${couleur};border-radius:3pt;"></div>
              <div style="font-size:15pt;font-weight:800;color:#1a1f2e;">${esc(grp.nom)}</div>
              ${progBadge}
            </div>
            ${heures > 0 ? `<div style="background:#fff8c8;border:1pt solid #f5c40044;border-radius:6pt;padding:4pt 12pt;font-weight:800;color:#9a7a00;font-size:13pt;">${heures.toFixed(1)}h</div>` : ""}
          </div>
          <div style="padding:12pt 16pt;">
            ${presences.length > 0 ? `
              <div style="font-size:9pt;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6pt;">Présences</div>
              <div style="margin-bottom:10pt;font-size:10pt;color:#333;">
                ${presences.map(p => `<div style="margin-bottom:3pt;"><strong>${esc(p.jour)} :</strong> ${esc(p.ouvriers.join(", "))}</div>`).join("")}
              </div>` : ""}
            ${faites.length > 0 ? `<div style="font-size:9pt;font-weight:700;color:#22c55e;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4pt;">✓ Réalisé</div>${listeTaches(faites, "#22c55e", "✓")}` : ""}
            ${enCours.length > 0 ? `<div style="font-size:9pt;font-weight:700;color:#f5a623;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4pt;">↻ En cours</div>${listeTaches(enCours, "#f5a623", "↻")}` : ""}
            ${nonFaites.length > 0 ? `<div style="font-size:9pt;font-weight:700;color:#e15a5a;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4pt;">✗ Non faites</div>${listeTaches(nonFaites, "#e15a5a", "✗")}` : ""}
            ${remarques.length > 0 ? `
              <div style="font-size:9pt;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;margin-top:8pt;margin-bottom:4pt;">Remarques</div>
              ${remarques.map(r => `<div style="font-size:10pt;color:#333;margin-bottom:4pt;background:#f9f9f9;padding:6pt 10pt;border-radius:4pt;border-left:2pt solid #5b8af5;"><strong>${esc(r.ouvrier)} :</strong> ${fmt(r.remarque)}</div>`).join("")}` : ""}
          </div>
        </div>`;
    }).join("");

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bilan ${esc(weekId)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#f7f7f7;color:#1a1f2e;font-size:11pt;line-height:1.5;padding:0;}
  .page{max-width:780pt;margin:0 auto;padding:20pt;background:#f7f7f7;}
  @page{margin:14mm 16mm;size:A4;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff;}.page{padding:0;}}
</style></head><body><div class="page">
  <div style="background:#0a0a0a;padding:18pt 24pt;display:flex;justify-content:space-between;align-items:center;border-radius:8pt;margin-bottom:18pt;">
    <div style="display:flex;align-items:center;gap:14pt;">
      <img src="${logoUrl}" alt="Profero" style="height:42pt;object-fit:contain;" />
      <div>
        <div style="color:#f5c400;font-size:9pt;font-weight:700;letter-spacing:2pt;text-transform:uppercase;">Bilan de la semaine</div>
        <div style="color:#fff;font-size:22pt;font-weight:800;margin-top:2pt;">${esc(weekId)}</div>
      </div>
    </div>
    <div style="display:flex;gap:18pt;text-align:center;">
      <div>
        <div style="font-size:22pt;font-weight:800;color:#f5c400;">${totalHeures.toFixed(1)}h</div>
        <div style="font-size:9pt;color:rgba(255,255,255,.5);letter-spacing:.06em;text-transform:uppercase;">Heures réelles</div>
      </div>
      <div>
        <div style="font-size:22pt;font-weight:800;color:#50c878;">${totalFaites}</div>
        <div style="font-size:9pt;color:rgba(255,255,255,.5);letter-spacing:.06em;text-transform:uppercase;">Tâches faites</div>
      </div>
      ${totalGenereEuros > 0 ? `
      <div>
        <div style="font-size:22pt;font-weight:800;color:#f5c400;">+${totalGenereEuros.toLocaleString("fr-FR")} €</div>
        <div style="font-size:9pt;color:rgba(255,255,255,.5);letter-spacing:.06em;text-transform:uppercase;">Généré semaine</div>
      </div>` : ""}
    </div>
  </div>
  ${chantierBlocs || `<div style="text-align:center;padding:40pt;color:#999;">Aucun compte rendu pour cette semaine.</div>`}
  <div style="text-align:center;margin-top:20pt;font-size:9pt;color:#999;">Profero Rénovation · Bilan généré le ${new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</div>
</div></body></html>`;
  };

  // ── Génère le PDF côté client (Blob) à partir du HTML stylisé ─────────────
  // html2pdf utilise html2canvas + jsPDF en interne : rendu fidèle de la mise
  // en page (couleurs, badges, sections) avec pagination automatique A4.
  const generatePDFBlob = async () => {
    const html = buildBilanHTML();
    // On crée un conteneur off-screen plutôt que d'ouvrir une nouvelle fenêtre
    // (html2pdf rend depuis un DOM existant).
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.width = "794px"; // largeur A4 en px (à 96 dpi)
    container.innerHTML = html;
    document.body.appendChild(container);
    // Attendre le chargement du logo
    const img = container.querySelector("img");
    if (img && !img.complete) {
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 2000); // safety timeout
      });
    }
    const opts = {
      margin:      [10, 10, 10, 10],
      filename:    `Bilan-semaine-${weekId}.pdf`,
      image:       { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      // mode "css" : respecte page-break-inside:avoid sur les cartes chantier
      // (évite les coupures laides au milieu d'un chantier) mais laisse
      // plusieurs chantiers tenir sur une même page si la place le permet.
      // Avant : "avoid-all" forçait 1 chantier par page → trop de pages quasi vides.
      pagebreak:   { mode: ["css", "legacy"], avoid: ".chantier-card" },
    };
    try {
      const blob = await html2pdf().set(opts).from(container.querySelector(".page") || container).outputPdf("blob");
      return blob;
    } finally {
      document.body.removeChild(container);
    }
  };

  // ── Export PDF : génère + télécharge directement ──────────────────────────
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const genPDFBilan = async () => {
    setGeneratingPDF(true);
    try {
      const blob = await generatePDFBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bilan-semaine-${weekId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
    setGeneratingPDF(false);
  };

  // ── Envoi par mail avec PDF en pièce jointe ───────────────────────────────
  const [showEmail, setShowEmail]   = useState(false);
  const [emailTo, setEmailTo]       = useState("suivi.chantier@groupe-profero.com, loris.bessonneau@groupe-profero.com");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus]   = useState(null);

  // Convertit un Blob en base64 (sans le préfixe "data:...;base64,")
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result || "";
      const idx = String(result).indexOf("base64,");
      resolve(idx >= 0 ? String(result).slice(idx + 7) : String(result));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const sendBilanEmail = async () => {
    const destinataires = emailTo.split(",").map(s => s.trim()).filter(Boolean);
    if (destinataires.length === 0) { setEmailStatus({ ok: false, msg: "Renseigne au moins un destinataire." }); return; }
    setEmailSending(true);
    setEmailStatus(null);
    try {
      const blob = await generatePDFBlob();
      const base64 = await blobToBase64(blob);
      const filename = `Bilan-semaine-${weekId}.pdf`;
      // Corps du mail léger qui annonce la pj
      const intro = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1f2e;">
        <h2 style="color:#1a1f2e;margin-bottom:8px;">Bilan de la semaine ${weekId}</h2>
        <p style="color:#555;font-size:14px;line-height:1.5;margin-bottom:14px;">
          Bonjour,<br><br>
          Veuillez trouver ci-joint le bilan détaillé de la semaine au format PDF.
          Le document contient le récap par chantier, les progressions hebdo, et les heures cumulées.
        </p>
        <p style="color:#888;font-size:12px;margin-top:18px;">Profero Rénovation · Envoyé automatiquement depuis Profero Planning</p>
      </div>`;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: destinataires,
          subject: `Bilan de la semaine ${weekId} — Profero Rénovation`,
          html: intro,
          attachments: [{ filename, content: base64 }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmailStatus({ ok: true, msg: `Envoyé à ${destinataires.length} destinataire${destinataires.length > 1 ? "s" : ""} avec le PDF en pièce jointe.` });
      setTimeout(() => { setShowEmail(false); setEmailStatus(null); }, 2200);
    } catch (e) {
      setEmailStatus({ ok: false, msg: e.message || "Erreur d'envoi" });
    }
    setEmailSending(false);
  };

  // ── Écran saisie heures (étape 1) ────────────────────────────────────────────
  if (etape === "saisie") {
    return (
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.80)", zIndex:600,
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:16, backdropFilter:"blur(4px)" }} onClick={onClose}>
        <div style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:580,
          maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column",
          border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
          minHeight:0 }} onClick={e => e.stopPropagation()}>
          <div style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
            padding:"20px 24px", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Étape 1 / 2</div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:6 }}>Répartition des heures</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", lineHeight:1.5 }}>
              Ces ouvriers étaient planifiés sur plusieurs chantiers le même jour. Indique combien d'heures ils ont passé sur chaque chantier.
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:20, minHeight:0 }}>
            {conflits.map((c, idx) => {
              const total = c.chantierIds.reduce((s, cid) => s + parseFloat(heuresSaisies[c.jour]?.[c.ouvrier]?.[cid] || 0), 0);
              const ecart = parseFloat((c.heuresJour - total).toFixed(2));
              const ok = Math.abs(ecart) < 0.05;
              return (
                <div key={idx} style={{ background:T.surface,
                  border:`1px solid ${ok ? T.border : "rgba(224,92,92,0.4)"}`, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ background:"rgba(255,194,0,0.15)", border:"1px solid rgba(255,194,0,0.3)",
                      borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700, color:T.accent }}>{c.jour}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:"#e8eaf0" }}>👷 {c.ouvrier}</div>
                    <div style={{ fontSize:12, color:T.textMuted }}>({c.heuresJour}h dans la journée)</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {c.chantierIds.map(cid => {
                      const ch = chantiers.find(x => x.id === cid);
                      const val = heuresSaisies[c.jour]?.[c.ouvrier]?.[cid] ?? c.heures[cid];
                      return (
                        <div key={cid} style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
                            <div style={{ width:10, height:10, borderRadius:3, background:ch?.couleur||"#5b8af5", flexShrink:0 }}/>
                            <div style={{ fontSize:13, fontWeight:700, color:"#e8eaf0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {ch?.nom || cid}
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                            <input type="number" min={0} max={c.heuresJour} step={0.5} value={val}
                              onChange={e => setH(c.jour, c.ouvrier, cid, parseFloat(e.target.value)||0)}
                              style={{ width:68, background:T.fieldBg||"#1a1d28",
                                border:`1.5px solid ${ok ? T.border : "rgba(224,92,92,0.5)"}`,
                                borderRadius:8, padding:"7px 10px", color:"#e8eaf0",
                                fontFamily:"inherit", fontSize:15, fontWeight:700,
                                textAlign:"center", outline:"none" }}/>
                            <span style={{ fontSize:13, color:T.textMuted }}>h</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${T.border}`,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:T.textMuted }}>Total saisi</span>
                    <span style={{ fontSize:14, fontWeight:800,
                      color: ok ? "#50c878" : Math.abs(ecart)<1 ? T.accent : "#e05c5c" }}>
                      {total.toFixed(1)}h / {c.heuresJour}h
                      {ok ? " ✓" : ecart>0 ? ` (${ecart.toFixed(1)}h restantes)` : ` (dépassement de ${Math.abs(ecart).toFixed(1)}h)`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding:"16px 24px", borderTop:`1px solid ${T.border}`,
            display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
            <button onClick={onClose} style={{ background:"transparent", border:`1px solid ${T.border}`,
              borderRadius:10, padding:"10px 20px", color:T.textSub,
              fontFamily:"inherit", fontSize:14, cursor:"pointer" }}>Annuler</button>
            <button onClick={() => setEtape("bilan")} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: T.accent, border: "none",
              borderRadius: 10, padding: "10px 22px", color: "#111",
              fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer",
            }}>
              Voir le bilan
              <Icon as={ArrowRight} size={14}/>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Bilan (étape 2) ──────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop bilan-modal" style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:600,
      display:"flex", alignItems:"center", justifyContent:"center",
      padding:16, backdropFilter:"blur(4px)" }} onClick={onClose}>
      <style>{`
        @media(max-width:767px){
          .bilan-modal .bilan-header{flex-direction:column;align-items:stretch!important;padding:14px 16px!important;gap:10px}
          .bilan-modal .bilan-header > div:first-child > div:nth-child(2){font-size:18px!important}
          .bilan-modal .bilan-header-actions{display:flex!important;gap:8px;flex-wrap:wrap}
          .bilan-modal .bilan-header-actions > div{flex:1}
          .bilan-modal .bilan-header-actions button{flex:1 1 100%}
        }
      `}</style>
      <div className="modal-box" style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:740,
        maxHeight:"88vh", overflow:"hidden", display:"flex", flexDirection:"column",
        border:`1px solid ${T.border}`, boxShadow:"0 24px 60px rgba(0,0,0,0.5)", minHeight:0
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bilan-header" style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
          padding:"22px 28px", display:"flex", alignItems:"center",
          justifyContent:"space-between", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Bilan de la semaine</div>
            <div style={{ fontSize:24, fontWeight:800, color:"#fff" }}>{weekId}</div>
          </div>
          <div className="bilan-header-actions" style={{ display:"flex", gap:20, alignItems:"center" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:T.accent }}>{totalHeures.toFixed(1)}h</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Heures réelles</div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:"#50c878" }}>{totalFaites}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Tâches faites</div>
            </div>
            {totalGenereEuros > 0 && (
              <div style={{ textAlign:"center" }} title="Somme des progressions hebdo × prix vendu de chaque chantier">
                <div style={{ fontSize:28, fontWeight:800, color:"#f5c400" }}>+{totalGenereEuros.toLocaleString("fr-FR")} €</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Généré semaine</div>
              </div>
            )}
            <button onClick={()=>setShowNotes(true)} disabled={generatingDoc}
              style={{ background: draftStatus==="ok" ? "rgba(80,200,120,0.85)" : generatingDoc ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.85)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: generatingDoc ? "wait" : "pointer", fontSize:13, fontWeight:700,
                color:"#fff", display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap",
                opacity: generatingDoc ? 0.7 : 1 }}>
              {generatingDoc ? (
                <>
                  <Icon as={RefreshCw} size={13}/> Génération…
                </>
              ) : draftStatus === "ok" ? (
                <>
                  <Icon as={Check} size={13}/> Téléchargé
                </>
              ) : draftStatus === "error" ? (
                <>
                  <Icon as={X} size={13}/> Erreur
                </>
              ) : (
                <>
                  <Icon as={FileDown} size={14}/> Word
                </>
              )}
            </button>
            <button onClick={genPDFBilan} disabled={generatingPDF} title="Télécharger le PDF" className="cr-export-btn"
              style={{ background: generatingPDF ? "rgba(255,255,255,0.1)" : "rgba(245,196,0,0.92)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: generatingPDF ? "wait" : "pointer", fontSize:13, fontWeight:700,
                color: generatingPDF ? "#fff" : "#1a1a1a",
                display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap" }}>
              {generatingPDF ? <><Icon as={RefreshCw} size={13}/> Génération…</> : <><Icon as={FileDown} size={14}/> PDF</>}
            </button>
            <button onClick={() => { setShowEmail(true); setEmailStatus(null); }} title="Envoyer le bilan par mail"
              style={{ background:"rgba(91,138,245,0.92)", border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor:"pointer", fontSize:13, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap" }}>
              ✉ Mail
            </button>
            <button onClick={onClose} style={{
              background: "rgba(255,255,255,0.08)", border: "none",
              borderRadius: 10, width: 40, height: 40, cursor: "pointer",
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon as={X} size={18}/>
            </button>
          </div>
        </div>

        {/* Modale envoi mail */}
        {showEmail && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setShowEmail(false)}>
            <div style={{ background:"#1e2336", borderRadius:16, width:"100%", maxWidth:520,
              border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              display:"flex", flexDirection:"column", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
              <div style={{ padding:"20px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#e8eaf0", marginBottom:6 }}>✉️ Envoyer le bilan par mail</div>
                <div style={{ fontSize:13, color:"#5b6a8a", lineHeight:1.5 }}>
                  Le bilan stylisé est envoyé directement dans le corps du mail (pas de pièce jointe à ouvrir).
                  Compatible avec tous les clients mail et mobiles.
                </div>
              </div>
              <div style={{ padding:"20px 24px" }}>
                <label style={{ fontSize:11, fontWeight:700, color:"#9aa5c0", textTransform:"uppercase", letterSpacing:1, marginBottom:6, display:"block" }}>Destinataires (séparés par virgule)</label>
                <input value={emailTo} onChange={e => setEmailTo(e.target.value)} disabled={emailSending}
                  placeholder="nom@exemple.com, autre@exemple.com"
                  style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1.5px solid rgba(255,255,255,0.12)",
                    borderRadius:10, padding:"11px 14px", color:"#e8eaf0", fontFamily:"inherit",
                    fontSize:13, outline:"none", boxSizing:"border-box" }}/>
                {emailStatus && (
                  <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8,
                    background: emailStatus.ok ? "rgba(80,200,120,0.15)" : "rgba(225,90,90,0.15)",
                    border: `1px solid ${emailStatus.ok ? "rgba(80,200,120,0.4)" : "rgba(225,90,90,0.4)"}`,
                    color: emailStatus.ok ? "#50c878" : "#e15a5a", fontSize:13, fontWeight:600 }}>
                    {emailStatus.ok ? "✓ " : "⚠ "}{emailStatus.msg}
                  </div>
                )}
              </div>
              <div style={{ padding:"16px 24px", borderTop:"1px solid rgba(255,255,255,0.08)",
                display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button onClick={() => setShowEmail(false)} disabled={emailSending} style={{
                  background:"transparent", border:"1px solid rgba(255,255,255,0.15)",
                  borderRadius:10, padding:"10px 20px", color:"#9aa5c0",
                  fontFamily:"inherit", fontSize:14, cursor:"pointer"
                }}>Annuler</button>
                <button onClick={sendBilanEmail} disabled={emailSending} style={{
                  background: emailSending ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.9)",
                  border:"none", borderRadius:10, padding:"10px 24px", color:"#fff",
                  fontFamily:"inherit", fontSize:14, fontWeight:800, cursor: emailSending ? "wait" : "pointer"
                }}>{emailSending ? "Envoi…" : "✉ Envoyer"}</button>
              </div>
            </div>
          </div>
        )}

        {/* Modale notes libres */}
        {showNotes&&(
          <div style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16
          }} onClick={()=>setShowNotes(false)}>
            <div style={{
              background:"#1e2336", borderRadius:16, width:"100%", maxWidth:560,
              border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              display:"flex", flexDirection:"column", overflow:"hidden"
            }} onClick={e=>e.stopPropagation()}>
              {/* Header */}
              <div style={{padding:"20px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:18, fontWeight:800, color:"#e8eaf0", marginBottom:6}}>
                  📝 Enrichir le compte rendu
                </div>
                <div style={{fontSize:13, color:"#5b6a8a", lineHeight:1.6}}>
                  Ajoute ici toutes les précisions que tu veux inclure dans le document :
                  contexte supplémentaire, corrections, points importants, instructions de mise en forme…
                  Ces notes seront transmises à la génération du .docx.
                </div>
              </div>
              {/* Zone texte */}
              <div style={{padding:"20px 24px"}}>
                <textarea
                  value={notesLibres}
                  onChange={e=>setNotesLibres(e.target.value)}
                  placeholder={`Exemple :
- Le chantier LOU a pris du retard à cause des livraisons
- Mettre en avant la bonne avancée sur ARTHUR
- Le vélux a été posé mais avec difficulté, mentionner que c'est soldé
- Ajouter une mention sur les malfaçons corrigées`}
                  autoFocus
                  style={{
                    width:"100%", minHeight:180, background:"rgba(255,255,255,0.05)",
                    border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10,
                    padding:"14px 16px", color:"#e8eaf0", fontFamily:"inherit",
                    fontSize:14, lineHeight:1.7, resize:"vertical", outline:"none",
                    boxSizing:"border-box"
                  }}
                />
                <div style={{fontSize:11, color:"#5b6a8a", marginTop:8}}>
                  Laisse vide pour générer le document sans notes supplémentaires.
                </div>
              </div>
              {/* Footer */}
              <div style={{
                padding:"16px 24px", borderTop:"1px solid rgba(255,255,255,0.08)",
                display:"flex", gap:10, justifyContent:"flex-end"
              }}>
                <button onClick={()=>setShowNotes(false)} style={{
                  background:"transparent", border:"1px solid rgba(255,255,255,0.15)",
                  borderRadius:10, padding:"10px 20px", color:"#9aa5c0",
                  fontFamily:"inherit", fontSize:14, cursor:"pointer"
                }}>Annuler</button>
                <button onClick={()=>{ setShowNotes(false); genererDocx(); }} style={{
                  background:"rgba(91,138,245,0.9)", border:"none",
                  borderRadius:10, padding:"10px 24px", color:"#fff",
                  fontFamily:"inherit", fontSize:14, fontWeight:800, cursor:"pointer"
                }}>📄 Générer le .docx</button>
              </div>
            </div>
          </div>
        )}

        {/* Corps */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:16, minHeight:0 }}>
          {Object.keys(parChantier).length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted, fontSize:15 }}>
              Aucun compte rendu pour cette semaine.
            </div>
          )}
          {Object.entries(parChantier).map(([cId, grp]) => {
            const ch = chantiers.find(c => c.id === cId);
            const heures = heuresParChantier[cId] || 0;
            const detailJours = [];
            Object.entries(HEURES_PAR_JOUR).forEach(([jour]) => {
              const cell = cells[`${cId}_${jour}`];
              if (!cell || !(cell.ouvriers||[]).length) return;
              detailJours.push({ jour, ouvriers: cell.ouvriers });
            });
            const toutesTouches = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier:r.ouvrier})));
            const faites    = toutesTouches.filter(t => t.statut==="faite");
            const enCours   = toutesTouches.filter(t => t.statut==="en_cours");
            const nonFaites = toutesTouches.filter(t => t.statut==="non_faite");
            const remarques = grp.rapports.filter(r => r.remarque?.trim());
            return (
              <div key={cId} style={{ background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:14, overflow:"hidden", borderLeft:`5px solid ${ch?.couleur||"#5b8af5"}`,
                flexShrink: 0 }}>
                <div style={{ padding:"16px 20px", display:"flex", alignItems:"center",
                  justifyContent:"space-between", flexWrap:"wrap", gap:12,
                  background: ch ? ch.couleur+"18" : T.card }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                    {ch && <div style={{ width:14, height:14, borderRadius:4, background:ch.couleur, flexShrink:0 }}/>}
                    <div style={{ fontSize:18, fontWeight:800, color:T.text }}>{grp.nom}</div>
                    {progressions[cId] && (() => {
                      const p = progressions[cId];
                      // Si pas de snapshot avant → on n'a pas de point de comparaison
                      if (p.avant == null) {
                        return (
                          <div title="Pas encore d'historique : 1er snapshot pris le prochain vendredi" style={{
                            display:"inline-flex", alignItems:"center", gap:6,
                            background: T.card, border:`1px solid ${T.border}`,
                            borderRadius:8, padding:"4px 10px",
                            fontSize:11, color:T.textMuted, fontWeight:600,
                          }}>
                            Avancement : <strong style={{ color:T.text }}>{p.maintenant}%</strong>
                          </div>
                        );
                      }
                      const deltaColor = p.delta > 0 ? "#22c55e" : p.delta < 0 ? "#e15a5a" : T.textMuted;
                      const deltaSign  = p.delta > 0 ? "+" : "";
                      const fmtEur = (n) => `${n > 0 ? "+" : ""}${Math.abs(n).toLocaleString("fr-FR")} €`.replace("+-", "-");
                      return (
                        <div title={`Snapshot du ${p.dateAvant} → maintenant`} style={{
                          display:"inline-flex", alignItems:"center", gap:6,
                          background: deltaColor + "18", border:`1px solid ${deltaColor}55`,
                          borderRadius:8, padding:"4px 10px",
                          fontSize:11, fontWeight:600, color:T.text, flexWrap:"wrap",
                        }}>
                          <span style={{ color: T.textMuted }}>{p.avant}%</span>
                          <span style={{ color: T.textMuted, fontSize:10 }}>→</span>
                          <strong style={{ color: T.text }}>{p.maintenant}%</strong>
                          <span style={{ color: deltaColor, fontWeight:800 }}>
                            ({deltaSign}{p.delta} pt{Math.abs(p.delta) > 1 ? "s" : ""})
                          </span>
                          {p.deltaEuros != null && (
                            <span style={{ color: deltaColor, fontWeight:800, paddingLeft:4, borderLeft:`1px solid ${deltaColor}33` }}>
                              {p.deltaEuros > 0 ? "+" : ""}{p.deltaEuros.toLocaleString("fr-FR")} €
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  {heures > 0 && (
                    <div style={{ background:T.accent+"22", border:`1.5px solid ${T.accent}55`,
                      borderRadius:10, padding:"8px 16px", textAlign:"center" }}>
                      <div style={{ fontSize:22, fontWeight:800, color:T.accent, lineHeight:1 }}>{heures.toFixed(1)}h</div>
                      <div style={{ fontSize:10, color:T.textMuted, textTransform:"uppercase", letterSpacing:1, marginTop:2 }}>réelles</div>
                    </div>
                  )}
                </div>
                <div style={{ padding:"14px 20px", display:"flex", flexDirection:"column", gap:14 }}>
                  {detailJours.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                        <Icon as={Clock} size={11}/>
                        Présences
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                        {detailJours.map(({jour, ouvriers}) => (
                          <div key={jour} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 12px" }}>
                            <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, marginBottom:4 }}>{jour}</div>
                            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                              {ouvriers.map(o => (
                                <span key={o} style={{ background:ch?.couleur+"44"||T.tagBg, color:T.text,
                                  borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700 }}>{o}</span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {faites.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#22c55e", marginBottom:8 }}>
                        <Icon as={Check} size={11}/>
                        Réalisé
                      </div>
                      {faites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#50c878", flexShrink:0 }}>✓</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {enCours.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#f5a623", marginBottom:8 }}>
                        <Icon as={RefreshCw} size={11}/>
                        En cours
                      </div>
                      {enCours.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:T.accent, flexShrink:0 }}>→</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {nonFaites.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#e15a5a", marginBottom:8 }}>
                        <Icon as={X} size={11}/>
                        Non réalisé
                      </div>
                      {nonFaites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#e05c5c", flexShrink:0 }}>✕</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {remarques.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#a0b8ff", marginBottom:8 }}>
                        <Icon as={MessageSquare} size={11}/>
                        Remarques
                      </div>
                      {remarques.map((r,i) => (
                        <div key={i} style={{ fontSize:13, color:T.textSub, marginBottom:4 }}>
                          <strong style={{color:T.text}}>{r.ouvrier}</strong> : {r.remarque}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PageEquipe({chantiers, ouvriers, weekId, cells, T, branch = "renovation"}) {
  const acc = getBranchAccent(branch);
  const [rapports, setRapports]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [filterOuvrier, setFilterOuvrier] = useState("all");
  const [filterChantier, setFilterChantier] = useState("all");
  const [filterSemaine, setFilterSemaine]   = useState(weekId);
  const [groupBy, setGroupBy]         = useState("ouvrier"); // "ouvrier" | "chantier"
  const [viewMode, setViewMode]       = useState("liste");   // "liste" | "calendrier"
  const [showBilan, setShowBilan]     = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [lightbox, setLightbox]       = useState(null); // { urls:[], idx:0 }

  // Format avec fragment #rapport : plus robuste face aux parseurs d'URL
  // de certaines apps mobiles (Calendar, messageries) qui peuvent tronquer
  // le pathname mais préservent toujours le fragment.
  const appUrl = window.location.origin + "/rapport#rapport";
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("rapports").select("*").order("date_rapport",{ascending:false}).order("submitted_at",{ascending:false});
    if (filterOuvrier !== "all") q = q.eq("ouvrier", filterOuvrier);
    if (filterChantier !== "all") q = q.eq("chantier_id", filterChantier);
    if (filterSemaine) q = q.eq("semaine", filterSemaine);
    const { data } = await q;
    setRapports(data||[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterOuvrier, filterChantier, filterSemaine]);

  useEffect(() => {
    const ch = supabase.channel("rapports-live")
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"rapports"},()=>load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [filterOuvrier, filterChantier, filterSemaine]);

  const copyLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  };

  const semaines = [];
  const now = getCurrentWeek();
  for (let i=0; i<8; i++) {
    let w = now.week - i; let y = now.year;
    if (w <= 0) { w += 52; y--; }
    semaines.push(getWeekId(y,w));
  }

  // ── Groupement des rapports ──────────────────────────────────────────────
  const grouped = (() => {
    const map = {};
    rapports.forEach(r => {
      const key   = groupBy === "ouvrier" ? (r.ouvrier||"?") : (r.chantier_id||"__divers__");
      const label = groupBy === "ouvrier" ? (r.ouvrier||"?") : (r.chantier_nom || chantiers.find(c=>c.id===r.chantier_id)?.nom || "Divers");
      if (!map[key]) map[key] = { key, label, rapports: [] };
      map[key].rapports.push(r);
    });
    return Object.values(map).sort((a,b) => a.label.localeCompare(b.label));
  })();

  const toggleGroup = (key) => setExpandedGroups(p => ({...p, [key]: !p[key]}));

  // Stats globales
  const allTaches = rapports.flatMap(r => r.taches||[]);
  const stats = {
    total:   rapports.length,
    faites:  allTaches.filter(t=>t.statut==="faite").length,
    enCours: allTaches.filter(t=>t.statut==="en_cours").length,
    nonFaites: allTaches.filter(t=>t.statut==="non_faite").length,
    heures:  allTaches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0),
  };

  // ── Récap heures par ouvrier sur les rapports filtrés ──
  const heuresParOuvrier = {};
  rapports.forEach(r => {
    const total = (r.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
    if (total > 0) heuresParOuvrier[r.ouvrier] = (heuresParOuvrier[r.ouvrier] || 0) + total;
  });

  // ── Rapports manquants du jour : ouvriers planifiés aujourd'hui qui n'ont
  //    pas (encore) rendu de rapport. Basé sur les cells du planning de la
  //    semaine en cours.
  const todayJour = (() => {
    const d = new Date().getDay();
    return JOURS_JS[d] || null; // null si week-end
  })();
  const todayDateFr = new Date().toLocaleDateString("fr-FR"); // format DD/MM/YYYY (rapports.date_rapport)
  const ouvriersPlanifsToday = [];
  if (todayJour) {
    chantiers.forEach(c => {
      const cell = cells[`${c.id}_${todayJour}`];
      const aUneTache = cell && ((cell.taches && cell.taches.length > 0) || (cell.planifie && cell.planifie.trim()));
      if (!aUneTache) return;
      (cell.ouvriers || []).forEach(o => {
        if (o && !ouvriersPlanifsToday.includes(o)) ouvriersPlanifsToday.push(o);
      });
    });
  }
  const ouvriersRendusToday = new Set(
    rapports.filter(r => r.date_rapport === todayDateFr).map(r => r.ouvrier)
  );
  const manquantsAujourdhui = ouvriersPlanifsToday.filter(o => !ouvriersRendusToday.has(o));

  return (
    <div className="page-padding eq-page" style={{flex:1,overflowY:"auto",padding:"24px 28px",background:T.bg}}>
      <style>{`
        @media(max-width:767px){
          .eq-page .eq-header{flex-direction:column;align-items:stretch!important}
          .eq-page .eq-header > div:first-child > div:first-child{font-size:20px!important}
          .eq-page .eq-link-box{flex-wrap:wrap}
          .eq-page .eq-link-box code{font-size:10px!important;word-break:break-all;flex:1 1 100%}
          .eq-page .eq-filters{padding:10px 12px!important;gap:6px!important}
          .eq-page .eq-filters select,.eq-page .eq-filters > div{width:100%!important;flex:1 1 100%!important}
        }
      `}</style>

      {showBilan&&(
        <BilanSemaine rapports={rapports} chantiers={chantiers} cells={cells}
          weekId={filterSemaine||weekId} onClose={()=>setShowBilan(false)} T={T}/>
      )}

      {/* Lightbox photos */}
      {lightbox && (
        <div onClick={()=>setLightbox(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:1200,
          display:"flex",alignItems:"center",justifyContent:"center",padding:20,flexDirection:"column",gap:14
        }}>
          <img src={photoTransform(lightbox.urls[lightbox.idx],{width:1920,height:1920,resize:"contain",quality:80})} alt="" style={{
            maxWidth:"100%",maxHeight:"calc(100vh - 120px)",objectFit:"contain",borderRadius:8
          }} onClick={e=>e.stopPropagation()}/>
          <div style={{display:"flex",gap:12,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
            {lightbox.urls.length > 1 && (
              <>
                <button onClick={()=>setLightbox(l=>({...l, idx:(l.idx-1+l.urls.length)%l.urls.length}))}
                  style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:8,padding:"8px 14px",cursor:"pointer",
                    fontFamily:"inherit",fontSize:18}}>‹</button>
                <span style={{color:"#fff",fontSize:13,fontWeight:600}}>{lightbox.idx+1} / {lightbox.urls.length}</span>
                <button onClick={()=>setLightbox(l=>({...l, idx:(l.idx+1)%l.urls.length}))}
                  style={{background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",
                    color:"#fff",borderRadius:8,padding:"8px 14px",cursor:"pointer",
                    fontFamily:"inherit",fontSize:18}}>›</button>
              </>
            )}
            <a href={lightbox.urls[lightbox.idx]} target="_blank" rel="noopener noreferrer"
              style={{background:T.accent,color:"#111",borderRadius:8,padding:"8px 14px",
                fontFamily:"inherit",fontSize:13,fontWeight:700,textDecoration:"none"}}>
              ↗ Ouvrir
            </a>
            <button onClick={()=>setLightbox(null)} style={{background:"rgba(255,255,255,0.1)",
              border:"1px solid rgba(255,255,255,0.2)",color:"#fff",borderRadius:8,
              padding:"8px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="eq-header" style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Users} size={20} strokeWidth={2}/>
          </div>
          <div>
            <div style={{fontSize: FONT.xl.size + 4, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 2}}>Équipe</div>
            <div style={{fontSize: FONT.xs.size + 1, color: T.textMuted}}>Comptes rendus journaliers de l'équipe</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button onClick={()=>setShowBilan(true)} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            background: acc.accent, color: acc.onAccent, border: "none",
            borderRadius: RADIUS.md, padding: "9px 16px",
            fontFamily:"inherit", fontSize: FONT.sm.size, fontWeight:800,
            cursor:"pointer",
          }}>
            <Icon as={ChartBar} size={14}/>
            Bilan semaine
          </button>
          <div className="eq-link-box" style={{
            background: T.card, border: `1px solid ${T.border}`,
            borderRadius: RADIUS.md, padding: "6px 8px 6px 12px",
            display:"flex", alignItems:"center", gap: 8,
          }}>
            <Icon as={Link2} size={13} color={acc.accent}/>
            <code style={{fontSize: FONT.xs.size + 1, color: T.text}}>{appUrl}</code>
            <button onClick={copyLink} title="Copier le lien" style={{
              display:"inline-flex", alignItems:"center", gap:5,
              background: copied ? "rgba(34,197,94,0.12)" : "transparent",
              color: copied ? "#22c55e" : T.textSub,
              border: `1px solid ${copied ? "rgba(34,197,94,0.30)" : T.border}`,
              borderRadius: RADIUS.sm + 2, padding: "5px 10px",
              fontFamily:"inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
              cursor:"pointer", transition: "all .12s",
            }}>
              <Icon as={copied ? Check : Copy} size={11}/>
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Rapports manquants du jour ── */}
      {todayJour && manquantsAujourdhui.length > 0 && (
        <div style={{
          background: "rgba(245,166,35,0.08)",
          border: "1px solid rgba(245,166,35,0.30)",
          borderRadius: RADIUS.lg, padding: "12px 16px",
          marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: RADIUS.md,
            background: "rgba(245,166,35,0.18)", color: "#f5a623",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={Clock} size={16}/>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text, marginBottom: 2 }}>
              {manquantsAujourdhui.length} rapport{manquantsAujourdhui.length > 1 ? "s" : ""} en attente pour {todayJour.toLowerCase()}
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
              {manquantsAujourdhui.length}/{ouvriersPlanifsToday.length} planifié{ouvriersPlanifsToday.length > 1 ? "s" : ""} aujourd'hui n'{manquantsAujourdhui.length > 1 ? "ont" : "a"} pas encore rendu
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {manquantsAujourdhui.map(o => (
              <span key={o} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: "rgba(245,166,35,0.15)", color: "#f5a623",
                border: "1px solid rgba(245,166,35,0.35)",
                borderRadius: RADIUS.pill, padding: "3px 9px",
                fontSize: FONT.xs.size + 1, fontWeight: 700,
              }}>
                <Icon as={HardHat} size={10}/> {o}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Filtres + tri ── */}
      <div className="eq-filters" style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: RADIUS.lg,
        padding: "12px 14px", marginBottom: 16,
        display:"flex", gap: 8, flexWrap:"wrap", alignItems:"center",
      }}>

        {/* Tri / groupement */}
        <div style={{
          display: "flex", padding: 3, gap: 2,
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg, flexShrink: 0,
        }}>
          {[
            { id: "ouvrier",  label: "Par ouvrier",  icon: HardHat },
            { id: "chantier", label: "Par chantier", icon: Building2 },
          ].map(v => {
            const active = groupBy === v.id;
            return (
              <button key={v.id} onClick={() => setGroupBy(v.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", border: "none",
                borderRadius: RADIUS.md,
                fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: active ? 800 : 600,
                cursor: "pointer",
                background: active ? acc.accent : "transparent",
                color: active ? acc.onAccent : T.textSub,
                transition: "background .12s, color .12s",
              }}>
                <Icon as={v.icon} size={12}/>
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Sélecteurs filtres avec icônes inline */}
        {[
          { icon: Calendar, value: filterSemaine, onChange: setFilterSemaine, options: [{ value: "", label: "Toutes les semaines" }, ...semaines.map(s => ({ value: s, label: s }))], isAll: filterSemaine === "" },
          { icon: HardHat, value: filterOuvrier, onChange: setFilterOuvrier, options: [{ value: "all", label: "Tous les ouvriers" }, ...ouvriers.map(o => ({ value: o, label: o }))], isAll: filterOuvrier === "all" },
          { icon: Building2, value: filterChantier, onChange: setFilterChantier, options: [{ value: "all", label: "Tous les chantiers" }, ...chantiers.map(c => ({ value: c.id, label: c.nom }))], isAll: filterChantier === "all" },
        ].map((sel, i) => (
          <div key={i} style={{ position: "relative" }}>
            <Icon as={sel.icon} size={13} style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: sel.isAll ? T.textMuted : acc.accent, pointerEvents: "none",
            }}/>
            <select value={sel.value} onChange={e => sel.onChange(e.target.value)}
              style={{
                background: T.inputBg, color: sel.isAll ? T.textSub : T.text,
                border: `1px solid ${sel.isAll ? T.border : acc.border}`,
                borderRadius: RADIUS.md,
                padding: "6px 10px 6px 30px",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: sel.isAll ? 500 : 600,
                outline: "none", cursor: "pointer",
              }}>
              {sel.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}

        {(filterOuvrier !== "all" || filterChantier !== "all" || filterSemaine) && (
          <button onClick={() => { setFilterOuvrier("all"); setFilterChantier("all"); setFilterSemaine(""); }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "transparent", border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md, padding: "6px 10px",
              color: T.textMuted, fontFamily: "inherit",
              fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
            }}>
            <Icon as={RotateCcw} size={11}/>
            Réinitialiser
          </button>
        )}

        {/* Switch de vue : Liste / Calendrier — à droite */}
        <div style={{
          marginLeft: "auto",
          display: "flex", padding: 3, gap: 2,
          background: T.card, border: `1px solid ${T.border}`,
          borderRadius: RADIUS.lg, flexShrink: 0,
        }}>
          {[
            { id: "liste",      label: "Liste",      icon: FileDown },
            { id: "calendrier", label: "Calendrier", icon: Calendar },
          ].map(v => {
            const active = viewMode === v.id;
            return (
              <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 12px", border: "none",
                borderRadius: RADIUS.md,
                fontFamily: "inherit",
                fontSize: FONT.xs.size + 1, fontWeight: active ? 800 : 600,
                cursor: "pointer",
                background: active ? acc.accent : "transparent",
                color: active ? acc.onAccent : T.textSub,
                transition: "background .12s, color .12s",
              }}>
                <Icon as={v.icon} size={12}/>
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Stats ── */}
      {rapports.length > 0 && (
        <div className="eq-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Comptes rendus", val: stats.total,    color: acc.accent, icon: FileDown },
            { label: "Heures réelles", val: stats.heures > 0 ? stats.heures.toFixed(1) + "h" : "—", color: "#5b9cf6", icon: Clock },
            { label: "Tâches faites",  val: stats.faites,   color: "#22c55e",  icon: Check },
            { label: "En cours",       val: stats.enCours,  color: "#f5a623",  icon: RefreshCw },
            { label: "Non faites",     val: stats.nonFaites, color: "#e15a5a", icon: X },
          ].map(s => (
            <div key={s.label} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: RADIUS.lg, padding: "12px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: RADIUS.md,
                background: s.color + "18", color: s.color,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <Icon as={s.icon} size={18} strokeWidth={2}/>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1.1, letterSpacing: -0.3 }}>{s.val}</div>
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase" }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contenu ── */}
      {loading && <div style={{ color: T.textMuted, padding: 40, textAlign: "center", fontSize: FONT.sm.size }}>Chargement…</div>}

      {!loading && rapports.length === 0 && (
        <div style={{
          background: T.surface, border: `1px dashed ${T.border}`,
          borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: acc.bg10, color: acc.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            marginBottom: 12,
          }}>
            <Icon as={FileDown} size={28} strokeWidth={1.5}/>
          </div>
          <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>Aucun compte rendu</div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>Partage le lien ci-dessus à ton équipe.</div>
        </div>
      )}

      {/* ── Vue calendrier hebdo ── */}
      {viewMode === "calendrier" && !loading && (
        <VueCalendrierEquipe
          rapports={rapports}
          ouvriers={ouvriers}
          chantiers={chantiers}
          cells={cells}
          weekId={filterSemaine || weekId}
          T={T} acc={acc}
        />
      )}

      {/* ── Groupes ── */}
      {viewMode === "liste" && (
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {grouped.map(grp => {
          const isOpen = expandedGroups[grp.key] !== false; // ouvert par défaut
          const ch = groupBy==="chantier" ? chantiers.find(c=>c.id===grp.key) : null;
          const grpTaches = grp.rapports.flatMap(r=>r.taches||[]);
          const grpFaites   = grpTaches.filter(t=>t.statut==="faite").length;
          const grpEnCours  = grpTaches.filter(t=>t.statut==="en_cours").length;
          const grpNonFaites= grpTaches.filter(t=>t.statut==="non_faite").length;
          const grpHeures   = grpTaches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0);
          const accentColor = ch?.couleur || T.accent;

          return (
            <div key={grp.key} style={{background:T.surface,border:`1px solid ${T.border}`,
              borderRadius:14,overflow:"hidden"}}>

              {/* En-tête groupe */}
              <div onClick={() => toggleGroup(grp.key)} style={{
                padding: "12px 16px", cursor: "pointer",
                background: ch ? ch.couleur + "14" : T.card,
                borderBottom: isOpen ? `1px solid ${T.sectionDivider}` : "none",
                display: "flex", alignItems: "center", gap: 12,
                borderLeft: `4px solid ${accentColor}`,
              }}>
                {/* Icône / avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
                  background: accentColor + "22", border: `1.5px solid ${accentColor}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: accentColor,
                }}>
                  {groupBy === "ouvrier"
                    ? <span style={{ fontSize: 16, fontWeight: 800 }}>{grp.label[0].toUpperCase()}</span>
                    : <Icon as={Building2} size={18} strokeWidth={2}/>}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, letterSpacing: -.2 }}>{grp.label}</div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
                    {grp.rapports.length} compte{grp.rapports.length > 1 ? "s" : ""} rendu{grp.rapports.length > 1 ? "s" : ""}
                    {grpHeures > 0 && <> · <span style={{ color: "#5b9cf6", fontWeight: 700 }}>{grpHeures.toFixed(1)}h</span></>}
                  </div>
                </div>

                {/* Mini stats */}
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {grpFaites > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#22c55e",
                      background: "rgba(34,197,94,0.12)", borderRadius: RADIUS.pill, padding: "2px 9px",
                    }}><Icon as={Check} size={10}/> {grpFaites}</span>
                  )}
                  {grpEnCours > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#f5a623",
                      background: "rgba(245,166,35,0.12)", borderRadius: RADIUS.pill, padding: "2px 9px",
                    }}><Icon as={RefreshCw} size={10}/> {grpEnCours}</span>
                  )}
                  {grpNonFaites > 0 && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#e15a5a",
                      background: "rgba(225,90,90,0.12)", borderRadius: RADIUS.pill, padding: "2px 9px",
                    }}><Icon as={X} size={10}/> {grpNonFaites}</span>
                  )}
                  <Icon as={isOpen ? ChevronUp : ChevronDown} size={14} color={T.textMuted} style={{ marginLeft: 4 }}/>
                </div>
              </div>

              {/* Rapports du groupe */}
              {isOpen&&(
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {grp.rapports.map((r,ri) => {
                    const rCh = chantiers.find(c=>c.id===r.chantier_id);
                    const taches = r.taches||[];
                    const faites    = taches.filter(t=>t.statut==="faite");
                    const enCours   = taches.filter(t=>t.statut==="en_cours");
                    const nonFaites = taches.filter(t=>t.statut==="non_faite");
                    const heuresTotal = taches.reduce((s,t)=>s+(parseFloat(t.heures_reelles)||0),0);

                    return (
                      <div key={r.id} style={{
                        borderTop: ri>0 ? `1px solid ${T.sectionDivider}` : "none",
                        padding:"16px 20px",
                      }}>
                        {/* Ligne meta */}
                        <div style={{display:"flex",alignItems:"center",gap:8,
                          marginBottom:12,flexWrap:"wrap"}}>
                          {/* Date */}
                          <div style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textMuted,
                            background: T.card, borderRadius: RADIUS.sm + 2,
                            padding: "3px 9px", border: `1px solid ${T.border}`,
                          }}>
                            <Icon as={Calendar} size={11}/>
                            {r.date_rapport}
                          </div>
                          {/* Ouvrier (si vue chantier) */}
                          {groupBy === "chantier" && (
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: FONT.xs.size + 1, fontWeight: 700, color: acc.accent,
                              background: acc.bg10, borderRadius: RADIUS.sm + 2, padding: "3px 9px",
                            }}>
                              <Icon as={HardHat} size={11}/>
                              {r.ouvrier}
                            </div>
                          )}
                          {/* Chantier (si vue ouvrier) */}
                          {groupBy === "ouvrier" && rCh && (
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#1a1f2e",
                              background: rCh.couleur, borderRadius: RADIUS.sm + 2, padding: "3px 9px",
                            }}>
                              <span style={{ width: 7, height: 7, borderRadius: 2, background: "#1a1f2e22" }}/>
                              {rCh.nom}
                            </div>
                          )}
                          {/* Heures totales */}
                          {heuresTotal > 0 && (
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: FONT.xs.size + 1, fontWeight: 800, color: "#5b9cf6",
                              background: "rgba(91,156,246,0.12)", borderRadius: RADIUS.sm + 2,
                              padding: "3px 9px", border: "1px solid rgba(91,156,246,0.25)",
                            }}>
                              <Icon as={Clock} size={11}/>
                              {heuresTotal.toFixed(1)}h
                            </div>
                          )}
                          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                            {faites.length > 0 && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: FONT.xs.size + 1, color: "#22c55e", fontWeight: 700 }}>
                                <Icon as={Check} size={11}/> {faites.length}
                              </span>
                            )}
                            {enCours.length > 0 && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: FONT.xs.size + 1, color: "#f5a623", fontWeight: 700 }}>
                                <Icon as={RefreshCw} size={11}/> {enCours.length}
                              </span>
                            )}
                            {nonFaites.length > 0 && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>
                                <Icon as={X} size={11}/> {nonFaites.length}
                              </span>
                            )}
                            <button onClick={async () => {
                              if (!confirm(`Supprimer le CR de ${r.ouvrier} du ${r.date_rapport} ?`)) return;
                              await supabase.from("rapports").delete().eq("id", r.id);
                              setRapports(p => p.filter(x => x.id !== r.id));
                            }} title="Supprimer ce rapport" style={{
                              background: "transparent", border: "none", color: "#e15a5a",
                              cursor: "pointer", padding: 4, borderRadius: RADIUS.sm,
                              opacity: .55, marginLeft: 4,
                              display: "inline-flex", alignItems: "center",
                              transition: "opacity .15s, background .15s",
                            }}
                              onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(225,90,90,0.08)"; }}
                              onMouseLeave={e => { e.currentTarget.style.opacity = ".55"; e.currentTarget.style.background = "transparent"; }}>
                              <Icon as={Trash2} size={13}/>
                            </button>
                          </div>
                        </div>

                        {/* Tâches */}
                        {taches.length>0&&(
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {[["faite", Check, "#22c55e", "rgba(34,197,94,0.08)", "rgba(34,197,94,0.20)", faites],
                              ["en_cours", RefreshCw, "#f5a623", "rgba(245,166,35,0.08)", "rgba(245,166,35,0.20)", enCours],
                              ["non_faite", X, "#e15a5a", "rgba(225,90,90,0.08)", "rgba(225,90,90,0.20)", nonFaites],
                            ].filter(([,,,,, arr]) => arr.length > 0).map(([statut, IconComp, color, bg, border, arr]) => (
                              <div key={statut} style={{
                                background: bg, border: `1px solid ${border}`,
                                borderRadius: RADIUS.lg, padding: "10px 14px",
                              }}>
                                <div style={{
                                  display: "inline-flex", alignItems: "center", gap: 5,
                                  fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
                                  textTransform: "uppercase", color, marginBottom: 8,
                                }}>
                                  <Icon as={IconComp} size={11}/>
                                  {statut === "faite" ? "Réalisé" : statut === "en_cours" ? "En cours" : "Non réalisé"}
                                </div>
                                {arr.map((t,ti)=>(
                                  <div key={ti} style={{display:"flex",alignItems:"flex-start",
                                    gap:10,padding:"6px 0",flexWrap:"wrap",
                                    borderTop:ti>0?`1px solid ${border}`:""  }}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{fontSize:14,fontWeight:600,color:"#1a1f2e",lineHeight:1.4}}>
                                        {t.planifie||t.text||""}
                                      </div>
                                      {t.remarque&&(
                                        <div style={{fontSize:13,color:"#555",marginTop:3,
                                          fontStyle:"italic",paddingLeft:8,
                                          borderLeft:`2px solid ${color}66`}}>
                                          {t.remarque}
                                        </div>
                                      )}
                                    </div>
                                    {t.heures_reelles>0&&(
                                      <div style={{fontSize:12,fontWeight:800,color,flexShrink:0,
                                        background:"rgba(255,255,255,0.6)",borderRadius:5,
                                        padding:"2px 7px",border:`1px solid ${border}`}}>
                                        {t.heures_reelles}h
                                      </div>
                                    )}
                                    {(t.photos||[]).length>0 && (
                                      <div style={{flexBasis:"100%",display:"flex",flexWrap:"wrap",gap:5,marginTop:4}}>
                                        {t.photos.map((url,pi)=>(
                                          <img key={pi} src={photoTransform(url,{width:128,height:128})} alt="" loading="lazy"
                                            onClick={()=>setLightbox({urls:t.photos,idx:pi})}
                                            style={{width:54,height:54,objectFit:"cover",borderRadius:6,
                                              border:`1px solid ${border}`,cursor:"pointer",display:"block"}}/>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Remarque générale */}
                        {r.remarque?.trim()&&(
                          <div style={{marginTop:10,padding:"10px 14px",
                            background:"rgba(91,138,245,0.08)",borderRadius:10,
                            border:"1px solid rgba(91,138,245,0.2)",
                            borderLeft:`3px solid #5b8af5`}}>
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
                              textTransform: "uppercase", color: "#5b8af5", marginBottom: 5,
                            }}>
                              <Icon as={MessageSquare} size={11}/>
                              Remarque générale
                            </div>
                            <div style={{fontSize: FONT.base.size, color: T.text, lineHeight: 1.55}}>{r.remarque}</div>
                          </div>
                        )}

                        {/* Photos générales du chantier */}
                        {(r.photos_chantier || []).length > 0 && (
                          <div style={{
                            marginTop: 10, padding: "10px 14px",
                            background: T.card, borderRadius: RADIUS.lg, border: `1px solid ${T.border}`,
                          }}>
                            <div style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2,
                              textTransform: "uppercase", color: T.textMuted, marginBottom: 8,
                            }}>
                              <Icon as={Camera} size={11}/>
                              Photos du chantier · {r.photos_chantier.length}
                            </div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                              {r.photos_chantier.map((url,pi)=>(
                                <img key={pi} src={photoTransform(url,{width:192,height:192})} alt="" loading="lazy"
                                  onClick={()=>setLightbox({urls:r.photos_chantier,idx:pi})}
                                  style={{width:72,height:72,objectFit:"cover",borderRadius:8,
                                    border:`1px solid ${T.border}`,cursor:"pointer",display:"block"}}/>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      {/* ── Récap heures par ouvrier ── */}
      {Object.keys(heuresParOuvrier).length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${T.headerBorder || T.border}` }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
            letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10,
          }}>
            <Icon as={Clock} size={12}/>
            Heures par ouvrier · période filtrée
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ouvriers.filter(o => heuresParOuvrier[o]).map(o => {
              const h = heuresParOuvrier[o];
              // Seuil indicatif : 35-40h = OK (vert), <35 = peu (gris), >40 = surcharge (rouge)
              const col = h > 40 ? "#e15a5a" : h >= 35 ? "#22c55e" : T.textSub;
              const bg  = h > 40 ? "rgba(225,90,90,0.10)"
                        : h >= 35 ? "rgba(34,197,94,0.10)"
                        : T.card;
              return (
                <div key={o} style={{
                  display: "inline-flex", alignItems: "baseline", gap: 6,
                  padding: "6px 12px", background: bg,
                  border: `1px solid ${col === T.textSub ? T.border : col + "44"}`,
                  borderRadius: RADIUS.md,
                }}>
                  <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.textSub, letterSpacing: .3 }}>{o}</span>
                  <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: col }}>{h.toFixed(1)}h</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── VUE CALENDRIER : grille jours × ouvriers ────────────────────────────────
function VueCalendrierEquipe({ rapports, ouvriers, chantiers, cells, weekId, T, acc }) {
  // Extrait l'année/semaine depuis weekId (format "2026-W20")
  const m = (weekId || "").match(/^(\d{4})-W(\d{1,2})$/);
  const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
  const week = m ? parseInt(m[2], 10) : 1;

  // Date du lundi de la semaine
  const jan4 = new Date(year, 0, 4);
  const mon  = new Date(jan4);
  mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);

  const dateOfJour = (idx) => {
    const d = new Date(mon); d.setDate(mon.getDate() + idx);
    return d;
  };
  const dateFrOfJour = (idx) => dateOfJour(idx).toLocaleDateString("fr-FR");

  // Liste des ouvriers : ceux planifiés cette semaine OU ayant un rapport
  const ouvriersAvecActivite = new Set();
  JOURS.forEach(j => {
    chantiers.forEach(c => {
      const cell = cells[`${c.id}_${j}`];
      (cell?.ouvriers || []).forEach(o => o && ouvriersAvecActivite.add(o));
    });
  });
  rapports.forEach(r => { if (r.ouvrier) ouvriersAvecActivite.add(r.ouvrier); });
  const ouvriersAffiches = ouvriers.filter(o => ouvriersAvecActivite.has(o));

  // Map rapports par ouvrier × date
  const map = {}; // map[ouvrier][dateFr] = rapport
  rapports.forEach(r => {
    if (!map[r.ouvrier]) map[r.ouvrier] = {};
    map[r.ouvrier][r.date_rapport] = r;
  });

  // Est-ce que cet ouvrier était planifié ce jour ?
  const planifie = (ouvrier, jour) => {
    return chantiers.some(c => {
      const cell = cells[`${c.id}_${jour}`];
      return (cell?.ouvriers || []).includes(ouvrier);
    });
  };

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: RADIUS.xl, overflow: "hidden", overflowX: "auto",
    }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr style={{ background: T.card, borderBottom: `1px solid ${T.border}` }}>
            <th style={{
              padding: "10px 14px", textAlign: "left",
              fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
              letterSpacing: 1, textTransform: "uppercase",
            }}>Ouvrier</th>
            {JOURS.map((j, idx) => {
              const d = dateOfJour(idx);
              return (
                <th key={j} style={{
                  padding: "8px 6px", textAlign: "center",
                  fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
                  letterSpacing: 1, textTransform: "uppercase",
                }}>
                  <div>{j.slice(0, 3)}</div>
                  <div style={{ fontSize: FONT.xs.size - 1, opacity: .65, fontWeight: 500 }}>
                    {d.getDate()}/{String(d.getMonth() + 1).padStart(2, "0")}
                  </div>
                </th>
              );
            })}
            <th style={{
              padding: "10px 8px", textAlign: "center",
              fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted,
              letterSpacing: 1, textTransform: "uppercase",
            }}>Heures</th>
          </tr>
        </thead>
        <tbody>
          {ouvriersAffiches.length === 0 ? (
            <tr>
              <td colSpan={JOURS.length + 2} style={{ padding: 40, textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
                Aucun ouvrier avec activité cette semaine
              </td>
            </tr>
          ) : ouvriersAffiches.map(o => {
            const totalH = (map[o] ? Object.values(map[o]) : []).reduce((s, r) => {
              return s + (r.taches || []).reduce((ss, t) => ss + (parseFloat(t.heures_reelles) || 0), 0);
            }, 0);
            return (
              <tr key={o} style={{ borderTop: `1px solid ${T.sectionDivider || T.border}` }}>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text,
                  }}>
                    <Icon as={HardHat} size={13} color={acc.accent}/>
                    {o}
                  </span>
                </td>
                {JOURS.map((j, idx) => {
                  const dateFr = dateFrOfJour(idx);
                  const rapport = map[o]?.[dateFr];
                  const wasPlanned = planifie(o, j);
                  let bg = "transparent", color = T.textMuted, content = null, title = "";
                  if (rapport) {
                    bg = "rgba(34,197,94,0.12)";
                    color = "#22c55e";
                    content = <Icon as={Check} size={14}/>;
                    const h = (rapport.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
                    title = `Rapport rendu${h > 0 ? ` · ${h.toFixed(1)}h` : ""}`;
                  } else if (wasPlanned) {
                    bg = "rgba(225,90,90,0.10)";
                    color = "#e15a5a";
                    content = <Icon as={X} size={14}/>;
                    title = "Planifié, pas de rapport rendu";
                  } else {
                    content = <span style={{ opacity: .35 }}>—</span>;
                    title = "Pas planifié";
                  }
                  return (
                    <td key={j} title={title} style={{
                      padding: "10px 6px", textAlign: "center",
                      background: bg, color,
                    }}>
                      {content}
                    </td>
                  );
                })}
                <td style={{ padding: "10px 8px", textAlign: "center" }}>
                  <span style={{ fontSize: FONT.sm.size, fontWeight: 700, color: totalH > 0 ? "#5b9cf6" : T.textMuted }}>
                    {totalH > 0 ? `${totalH.toFixed(1)}h` : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── DONNÉES BIBLIOTHÈQUE ─────────────────────────────────────────────────────

export default PageEquipe;
