// api/cron-recap-commandes.js — Mail récap "à commander ce vendredi"
//
// Destiné aux admin + conducteurs : reçoivent chaque vendredi matin un récap
// avec (1) les matériaux prévisionnels à commander aujourd'hui (date butoir =
// vendredi S-1 calculée depuis Phasage), et (2) les demandes ouvriers en
// attente (commandes_detail.statut = "besoin_ouvrier").
//
// Variables d'environnement requises (déjà configurées) :
//   CRON_SECRET, VITE_SUPABASE_URL, VITE_SUPABASE_KEY, RESEND_KEY / RESEND_FROM
//
// Idempotence : 1 mail max par jour (clé planning_config.recap_commandes_state).

const { createClient } = require("@supabase/supabase-js");

function parisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const weekday = parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1).toLowerCase();
  return {
    weekday,
    dateFr:  `${parts.day}/${parts.month}/${parts.year}`,
    dateIso: `${parts.year}-${parts.month}-${parts.day}`,
    hour:    parseInt(parts.hour, 10),
    minute:  parseInt(parts.minute, 10),
  };
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

function fmtMontant(n) {
  return (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function envoyerMail(req, to, subject, html) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"]  || req.headers.host;
  const url   = `${proto}://${host}/api/send-email`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

// Construit le HTML du mail récap.
function buildRecapHtml({ dateFr, commandesPrevues, demandesOuvriers, baseUrl }) {
  const totalLignesCmd = commandesPrevues.reduce((s, p) => s + p.materiaux.length, 0);
  const totalGlobal    = commandesPrevues.reduce((s, p) => s + p.totalHt, 0);
  const nbDemandes     = demandesOuvriers.length;

  const sectionCommandes = commandesPrevues.length === 0 ? `
    <div style="padding:14px 18px;background:#f6f8fc;border-radius:8px;color:#5b6a8a;font-size:13px;font-style:italic;text-align:center">
      Aucun matériau prévisionnel à commander aujourd'hui.
    </div>
  ` : commandesPrevues.map(p => `
    <div style="border:1px solid #e0e4ef;border-left:4px solid ${escapeHtml(p.chantierCouleur || "#FFC200")};border-radius:8px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:14px;font-weight:700;color:#1a1f2e">${escapeHtml(p.chantierNom)}</div>
      <div style="font-size:12px;color:#5b6a8a;margin-top:2px">
        ${escapeHtml(p.phaseEmoji ? p.phaseEmoji + " " : "")}${escapeHtml(p.phaseLabel)}
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px">
        ${p.materiaux.map(m => `
          <tr style="border-bottom:1px solid #f0f3f8">
            <td style="padding:5px 4px;color:#1a1f2e">${escapeHtml(m.libelle)}</td>
            <td style="padding:5px 4px;color:#5b6a8a;text-align:center;width:80px">${escapeHtml(String(m.quantite))}${m.unite ? " " + escapeHtml(m.unite) : ""}</td>
            <td style="padding:5px 4px;color:#5b6a8a;text-align:left;width:140px">${escapeHtml(m.fournisseur_nom || "—")}</td>
            <td style="padding:5px 4px;color:#1a1f2e;text-align:right;font-weight:700;width:90px;font-family:monospace">${fmtMontant(m.total)} €</td>
          </tr>
        `).join("")}
      </table>
      <div style="text-align:right;margin-top:8px;font-size:13px;color:#1a1f2e">
        <span style="color:#5b6a8a">Total phase :</span>
        <strong style="color:#FFC200;font-family:monospace;font-size:14px">${fmtMontant(p.totalHt)} € HT</strong>
      </div>
    </div>
  `).join("");

  const sectionDemandes = demandesOuvriers.length === 0 ? `
    <div style="padding:14px 18px;background:#f6f8fc;border-radius:8px;color:#5b6a8a;font-size:13px;font-style:italic;text-align:center">
      Aucune demande ouvrier en attente.
    </div>
  ` : `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f6f8fc">
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase">Article</th>
          <th style="padding:8px 10px;text-align:center;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:80px">Qté</th>
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:120px">Demandé par</th>
          <th style="padding:8px 10px;text-align:left;color:#5b6a8a;font-size:10px;letter-spacing:1px;text-transform:uppercase;width:120px">Chantier</th>
        </tr>
      </thead>
      <tbody>
        ${demandesOuvriers.map(d => `
          <tr style="border-bottom:1px solid #f0f3f8">
            <td style="padding:7px 10px;color:#1a1f2e">
              <div style="font-weight:600">${escapeHtml(d.article || "(sans libellé)")}</div>
              ${d.notes ? `<div style="font-size:11px;color:#5b6a8a;margin-top:2px">${escapeHtml(d.notes)}</div>` : ""}
            </td>
            <td style="padding:7px 10px;color:#5b6a8a;text-align:center">${escapeHtml(d.quantite || "—")}</td>
            <td style="padding:7px 10px;color:#5b6a8a">${escapeHtml(d.ouvrier_demandeur || "—")}</td>
            <td style="padding:7px 10px;color:#5b6a8a">${escapeHtml(d.chantier_nom || "—")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  return `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Récap commandes</div>
      <div style="color:#fff;font-size:20px;font-weight:800">🛒 À commander aujourd'hui — ${escapeHtml(dateFr)}</div>
      <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">
        ${commandesPrevues.length} phase${commandesPrevues.length > 1 ? "s" : ""} · ${totalLignesCmd} article${totalLignesCmd > 1 ? "s" : ""} prévisionnel${totalLignesCmd > 1 ? "s" : ""}
        ${totalGlobal > 0 ? ` · <strong style="color:#FFC200">${fmtMontant(totalGlobal)} € HT</strong>` : ""}
        ${nbDemandes > 0 ? ` · ${nbDemandes} demande${nbDemandes > 1 ? "s" : ""} ouvrier${nbDemandes > 1 ? "s" : ""}` : ""}
      </div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">

      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#5b6a8a;margin-bottom:10px">
        📦 Commandes prévisionnelles (date butoir aujourd'hui)
      </div>
      ${sectionCommandes}

      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#5b6a8a;margin:24px 0 10px">
        👷 Demandes des ouvriers en attente
      </div>
      ${sectionDemandes}

      <div style="text-align:center;margin:24px 0 0">
        <a href="${escapeHtml(baseUrl)}#planning-commandes"
           style="background:#FFC200;color:#1a1f2e;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-size:14px">
          Ouvrir le Planning des commandes →
        </a>
      </div>

      <p style="margin:18px 0 0;font-size:11px;color:#999;text-align:center">
        Vous recevez ce récap car vous êtes administrateur ou conducteur de travaux sur Profero Planning.
      </p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;
}

// ─── LOGIQUE MÉTIER (réutilisable par le dispatcher) ─────────────────────────
async function runRecapCommandes(req, supabase, t) {
  // 1) Idempotence : skip si déjà envoyé aujourd'hui
  const { data: stateRow } = await supabase.from("planning_config")
    .select("value").eq("key", "recap_commandes_state").maybeSingle();
  if (stateRow?.value?.date === t.dateFr) {
    return { skipped: "already_sent_today", date: t.dateFr };
  }

  // 2) Charger phasages + config (chantiers, phases) + demandes + utilisateurs
  const [phasagesQ, cfgQ, demandesQ, usersQ] = await Promise.all([
    supabase.from("phasages").select("id, chantier_id, chantier_nom, plan_travaux"),
    supabase.from("planning_config").select("key,value").in("key", ["chantiers", "phases_travaux"]),
    supabase.from("commandes_detail")
      .select("id, article, quantite, ouvrier_demandeur, notes, statut, phasage_id, phase_id")
      .in("statut", ["besoin_ouvrier", "besoin ouvrier", "besoin_ouvriers"]),
    supabase.from("utilisateurs")
      .select("id, email, nom, role, actif")
      .eq("actif", true)
      .in("role", ["admin", "conducteur"]),
  ]);

  const phasages = phasagesQ.data || [];
  const cfg = {}; (cfgQ.data || []).forEach(r => { cfg[r.key] = r.value; });
  const chantiers   = Array.isArray(cfg.chantiers) ? cfg.chantiers : [];
  const phasesArr   = (cfg.phases_travaux && Array.isArray(cfg.phases_travaux.items))
                        ? cfg.phases_travaux.items : [];
  const phasesById  = phasesArr.reduce((acc, ph) => { acc[ph.id] = ph; return acc; }, {});
  const chantById   = chantiers.reduce((acc, c) => { acc[c.id] = c; return acc; }, {});
  const demandes    = demandesQ.data || [];
  const dests       = (usersQ.data || []).map(u => u.email).filter(Boolean);

  // 3) Extraire les "phases à commander aujourd'hui"
  const commandesPrevues = [];
  for (const p of phasages) {
    const plan = p.plan_travaux || {};
    for (const key of Object.keys(plan)) {
      if (!key.endsWith("__materiaux_prevus")) continue;
      const mats = plan[key];
      if (!Array.isArray(mats) || mats.length === 0) continue;
      const phaseId  = key.slice(0, -"__materiaux_prevus".length);
      const dateCmd  = plan[phaseId + "__date_commande"]; // YYYY-MM-DD attendu
      if (!dateCmd || dateCmd !== t.dateIso) continue;
      // Pas encore commandé ? On affiche quand même si __cout_commandes > 0
      // pour traçabilité, mais on note le statut.
      const dejaCommande = (parseFloat(plan[phaseId + "__cout_commandes"]) || 0) > 0;
      if (dejaCommande) continue; // Skip : déjà passé

      const phaseInfo = phasesById[phaseId] || { label: phaseId, emoji: "", couleur: "#888" };
      const chantInfo = chantById[p.chantier_id] || null;
      const materiauxFmt = mats.map(m => ({
        libelle:        m.libelle || "",
        quantite:       m.quantite || 0,
        unite:          m.unite || "",
        prix_ht:        parseFloat(m.prix_ht) || 0,
        fournisseur_nom: m.fournisseur_nom || "",
        total:          (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0),
      }));
      const totalHt = materiauxFmt.reduce((s, m) => s + m.total, 0);

      commandesPrevues.push({
        phasageId:       p.id,
        chantierId:      p.chantier_id,
        chantierNom:     chantInfo?.nom || p.chantier_nom || "(sans chantier)",
        chantierCouleur: chantInfo?.couleur || phaseInfo.couleur,
        phaseId,
        phaseLabel:      phaseInfo.label || phaseId,
        phaseEmoji:      phaseInfo.emoji || "",
        materiaux:       materiauxFmt,
        totalHt,
      });
    }
  }

  // 4) Enrichir les demandes ouvriers avec chantier_nom (depuis phasage)
  const phasageById = phasages.reduce((acc, p) => { acc[p.id] = p; return acc; }, {});
  const demandesEnrichies = demandes.map(d => {
    let chantier_nom = "—";
    if (d.phasage_id && phasageById[d.phasage_id]) {
      const p = phasageById[d.phasage_id];
      chantier_nom = (chantById[p.chantier_id]?.nom) || p.chantier_nom || "—";
    }
    return { ...d, chantier_nom };
  });

  // 5) Si rien à signaler ET aucune demande → ne rien envoyer (évite spam)
  if (commandesPrevues.length === 0 && demandesEnrichies.length === 0) {
    await supabase.from("planning_config").upsert(
      { key: "recap_commandes_state", value: { date: t.dateFr, sent_to: [], items: 0, skipped: "empty" } },
      { onConflict: "key" }
    );
    return { skipped: "no_content", date: t.dateFr };
  }

  // 6) Aucun destinataire ? On note mais on ne tente pas l'envoi
  if (dests.length === 0) {
    return { skipped: "no_recipients", date: t.dateFr, commandesPrevues: commandesPrevues.length, demandes: demandesEnrichies.length };
  }

  // 7) Envoi (un seul mail à plusieurs destinataires)
  const baseUrl = process.env.APP_BASE_URL || "https://planning-chantiers.vercel.app";
  const html = buildRecapHtml({
    dateFr:           t.dateFr,
    commandesPrevues,
    demandesOuvriers: demandesEnrichies,
    baseUrl,
  });
  const subject = `🛒 Profero Planning · Récap commandes du ${t.dateFr}`;
  const r = await envoyerMail(req, dests, subject, html);

  // 8) Marquer envoyé (idempotence) si OK
  if (r.ok) {
    await supabase.from("planning_config").upsert(
      { key: "recap_commandes_state", value: { date: t.dateFr, sent_to: dests, items: commandesPrevues.length + demandesEnrichies.length } },
      { onConflict: "key" }
    );
  }

  return {
    date: t.dateFr,
    sent: r.ok,
    status: r.status,
    error: r.ok ? null : (r.data?.error || `HTTP ${r.status}`),
    destinataires: dests.length,
    commandes_prevues: commandesPrevues.length,
    demandes_ouvriers: demandesEnrichies.length,
  };
}

module.exports = async function handler(req, res) {
  // Auth
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.authorization || "";
    if (got !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const t = parisNow();

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  try {
    const summary = await runRecapCommandes(req, supabase, t);
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    console.error("cron-recap-commandes error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};

module.exports.runRecapCommandes = runRecapCommandes;
module.exports.parisNow = parisNow;
