// api/cron-encours-fournisseurs.js — Mail hebdo "Encours fournisseurs"
//
// Envoyé le vendredi (après-midi, via le dispatcher) à certains utilisateurs :
// récap des montants à payer par fournisseur et par mois d'échéance, avec le
// comparatif saisi vs facturé. Reproduit la logique de la page
// src/Renovation/PageEncoursFournisseurs.jsx côté serveur.
//
// Destinataires : planning_config.encours_mail_destinataires (liste d'emails)
// si renseignée ; sinon repli sur les utilisateurs actifs admin + comptable.
//
// Idempotence : 1 envoi max par jour (planning_config.encours_mail_state).

const { createClient } = require("@supabase/supabase-js");

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function eur(n) {
  return (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function moisLabel(ym) {
  if (!ym || ym.length < 7) return "Sans date";
  const [y, m] = ym.split("-");
  return `${MOIS_FR[parseInt(m, 10) - 1] || m} ${y}`;
}
const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Date d'échéance (AAAA-MM-JJ) selon le mode du fournisseur.
function echeanceISO(docISO, mode) {
  if (!docISO) return docISO || "";
  const d = new Date(docISO + "T00:00:00");
  if (isNaN(d.getTime())) return docISO;
  if (mode === "30j") { d.setDate(d.getDate() + 30); }
  else if (mode === "echeance") {
    // 30j fin de mois : fin du mois de la facture, PUIS + 30 jours
    // (facture du 01/07 -> 31/07 -> + 30 j = 30/08, payable en août).
    const fdm = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    fdm.setDate(fdm.getDate() + 30);
    return fdm.toISOString().slice(0, 10);
  } else { return docISO; }
  return d.toISOString().slice(0, 10);
}

async function envoyerMail(req, to, subject, html) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `${proto}://${host}/api/send-email`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// ─── LOGIQUE MÉTIER (réutilisable par le dispatcher) ─────────────────────────
async function runEncoursFournisseurs(req, supabase, t) {
  // 1) Idempotence : 1 envoi max par jour
  const { data: stateRow } = await supabase.from("planning_config")
    .select("value").eq("key", "encours_mail_state").maybeSingle();
  if (stateRow?.value?.date === t.dateFr) {
    return { skipped: "already_sent_today", date: t.dateFr };
  }

  // 2) Données : fournisseurs (mode), commandes non rattachées (hors migration),
  //    factures non archivées.
  const [fournQ, cmdQ, factQ] = await Promise.all([
    supabase.from("fournisseurs").select("id, nom, mode_paiement"),
    supabase.from("commandes")
      .select("fournisseur_id, fournisseur_nom, montant_ht, date_doc, created_at, statut_facturation, source, lignes:commande_lignes(prix_total)")
      .is("facture_id", null).limit(5000),
    supabase.from("factures")
      .select("fournisseur_id, fournisseur_nom, montant_ht, date_facture, created_at, statut")
      .neq("statut", "archivee").limit(2000),
  ]);

  const modeById = {}, modeByNom = {};
  (fournQ.data || []).forEach(f => { modeById[f.id] = f.mode_paiement || ""; if (f.nom) modeByNom[normNom(f.nom)] = f.mode_paiement || ""; });
  const modeOf = (id, nom) => modeById[id] || modeByNom[normNom(nom)] || "";

  // mois -> fournisseur -> { saisi, facture, paye }
  const moisMap = new Map();
  const add = (mois, fournisseur, champ, montant) => {
    const m = mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, new Map());
    const pfMap = moisMap.get(m);
    if (!pfMap.has(fournisseur)) pfMap.set(fournisseur, { nom: fournisseur, saisi: 0, facture: 0, paye: 0 });
    pfMap.get(fournisseur)[champ] += montant;
  };

  (cmdQ.data || []).forEach(c => {
    if (c.source === "migration") return;
    const montant = c.montant_ht != null ? Number(c.montant_ht)
      : (c.lignes || []).reduce((s, l) => s + (Number(l.prix_total) || 0), 0);
    if (!montant) return;
    const docISO = c.date_doc || (c.created_at || "").slice(0, 10);
    const paye = c.statut_facturation === "facture";
    const dueISO = paye ? docISO : echeanceISO(docISO, modeOf(c.fournisseur_id, c.fournisseur_nom));
    add((dueISO || "").slice(0, 7), c.fournisseur_nom || "Sans fournisseur", paye ? "paye" : "saisi", montant);
  });
  (factQ.data || []).forEach(f => {
    const montant = Number(f.montant_ht) || 0;
    if (!montant) return;
    const docISO = f.date_facture || (f.created_at || "").slice(0, 10);
    const dueISO = echeanceISO(docISO, modeOf(f.fournisseur_id, f.fournisseur_nom));
    add((dueISO || "").slice(0, 7), f.fournisseur_nom || "Sans fournisseur", "facture", montant);
  });

  const aPayerOf = (pf) => (pf.facture > 0 ? pf.facture : pf.saisi);
  const mois = [...moisMap.entries()]
    .map(([m, pfMap]) => {
      const fourns = [...pfMap.values()].sort((a, b) => aPayerOf(b) - aPayerOf(a));
      const aPayer = fourns.reduce((s, pf) => s + aPayerOf(pf), 0);
      return { mois: m, fourns, aPayer };
    })
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .slice(0, 6); // 6 mois les plus récents
  const totalAPayer = mois.reduce((s, g) => s + g.aPayer, 0);

  if (mois.length === 0) {
    await supabase.from("planning_config").upsert({ key: "encours_mail_state", value: { date: t.dateFr, skipped: "empty" } }, { onConflict: "key" });
    return { skipped: "no_content", date: t.dateFr };
  }

  // 3) Destinataires
  const { data: destCfg } = await supabase.from("planning_config").select("value").eq("key", "encours_mail_destinataires").maybeSingle();
  let dests = Array.isArray(destCfg?.value) ? destCfg.value
    : (Array.isArray(destCfg?.value?.emails) ? destCfg.value.emails : []);
  dests = dests.filter(Boolean);
  if (dests.length === 0) {
    const { data: users } = await supabase.from("utilisateurs").select("email, role, actif").eq("actif", true).in("role", ["admin", "comptable"]);
    dests = (users || []).map(u => u.email).filter(Boolean);
  }
  if (dests.length === 0) return { skipped: "no_recipients", date: t.dateFr };

  // 4) HTML
  const baseUrl = process.env.APP_BASE_URL || "https://planning-chantiers.vercel.app";
  const sections = mois.map(g => {
    const rows = g.fourns.map(pf => {
      const aP = aPayerOf(pf);
      const ecart = (pf.facture > 0 && pf.saisi > 0) ? (pf.facture - pf.saisi) : null;
      const ecartTxt = ecart != null ? `${ecart > 0 ? "+" : ""}${eur(ecart)} €` : "—";
      const ecartColor = ecart == null ? "#999" : (Math.abs(ecart) < 1 ? "#22c55e" : "#f5a623");
      return `<tr>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8">${escapeHtml(pf.nom)}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace">${pf.saisi > 0 ? eur(pf.saisi) + " €" : ""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace">${pf.facture > 0 ? eur(pf.facture) + " €" : ""}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace;color:${ecartColor}">${ecartTxt}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #f0f3f8;text-align:right;font-family:monospace;font-weight:700;color:#e6ae00">${aP > 0 ? eur(aP) + " €" : (pf.paye > 0 ? "payé" : "")}</td>
      </tr>`;
    }).join("");
    return `<div style="margin-top:18px">
      <div style="font-size:13px;font-weight:800;color:#1a1f2e;text-transform:capitalize;border-bottom:2px solid #1a1f2e;padding-bottom:4px;margin-bottom:6px">
        ${moisLabel(g.mois)} — <span style="color:#e6ae00">${eur(g.aPayer)} € à payer</span>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f6f8fc">
          <th style="padding:6px 8px;text-align:left;color:#5b6a8a;font-size:10px;text-transform:uppercase;letter-spacing:.5px">Fournisseur</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Saisi</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Facturé</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">Écart</th>
          <th style="padding:6px 8px;text-align:right;color:#5b6a8a;font-size:10px;text-transform:uppercase">À payer</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("");

  const html = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Encours fournisseurs</div>
      <div style="color:#fff;font-size:20px;font-weight:800">💰 Encours fournisseurs — ${escapeHtml(t.dateFr)}</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">Total à payer (6 derniers mois) : <strong style="color:#FFC200">${eur(totalAPayer)} € HT</strong></div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px">
      ${sections}
      <div style="text-align:center;margin:22px 0 0">
        <a href="${escapeHtml(baseUrl)}#encours-fournisseurs" style="background:#FFC200;color:#1a1f2e;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-size:14px">Ouvrir l'encours fournisseurs →</a>
      </div>
      <p style="margin:18px 0 0;font-size:11px;color:#999;text-align:center">Montants regroupés par mois d'échéance de paiement. « Saisi » = vos commandes ; « Facturé » = factures reçues ; « Écart » = facturé − saisi.</p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;

  const subject = `💰 Profero Planning · Encours fournisseurs du ${t.dateFr}`;
  const r = await envoyerMail(req, dests, subject, html);

  if (r.ok) {
    await supabase.from("planning_config").upsert(
      { key: "encours_mail_state", value: { date: t.dateFr, sent_to: dests, total_a_payer: totalAPayer } },
      { onConflict: "key" }
    );
  }
  return {
    date: t.dateFr, sent: r.ok, status: r.status,
    error: r.ok ? null : (r.data?.error || `HTTP ${r.status}`),
    destinataires: dests.length, mois: mois.length, total_a_payer: totalAPayer,
  };
}

// Handler direct (test manuel : /api/cron-encours-fournisseurs)
module.exports = async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.authorization || "";
    if (got !== `Bearer ${expected}`) return res.status(401).json({ error: "Unauthorized" });
  }
  const { parisNow } = require("./cron-recap-commandes.js");
  const t = parisNow();
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) return res.status(500).json({ error: "Supabase env vars missing" });
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  try {
    const summary = await runEncoursFournisseurs(req, supabase, t);
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("cron-encours-fournisseurs error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};

module.exports.runEncoursFournisseurs = runEncoursFournisseurs;
