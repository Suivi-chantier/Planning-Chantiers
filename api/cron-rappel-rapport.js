// api/cron-rappel-rapport.js — Vercel Cron Job
// Envoie un mail de rappel aux ouvriers qui n'ont pas rendu de compte rendu :
//   - Lundi-Mercredi à 17h50 (heure de Paris)
//   - Jeudi-Vendredi à 16h50 (heure de Paris)
// Ignore les ouvriers sans tâche assignée ce jour-là.
// Idempotent : un même ouvrier ne reçoit qu'un rappel par jour.
//
// Variables d'environnement requises sur Vercel :
//   CRON_SECRET           — chaîne aléatoire, validée via header Authorization
//   VITE_SUPABASE_URL     — URL projet Supabase
//   VITE_SUPABASE_KEY     — clé anon Supabase (lecture/écriture planning_config)
//   RESEND_KEY / RESEND_FROM — utilisés par /api/send-email (déjà configurés)
//
// Planification (vercel.json) :
//   "50 14,15,16 * * 1-5"  — couvre 17h50 CEST (été) et 17h50 CET (hiver)
//                            la fonction décide elle-même via l'heure Paris.

const { createClient } = require("@supabase/supabase-js");

const JOURS_FR = [null, "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", null];

// Extrait l'heure/jour/date courants en TZ Europe/Paris (gère DST).
function parisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  // weekday est "lundi", "mardi"… (minuscule en fr-FR) → on normalise en "Lundi"
  const weekday = parts.weekday.charAt(0).toUpperCase() + parts.weekday.slice(1).toLowerCase();
  const dateFr  = `${parts.day}/${parts.month}/${parts.year}`; // format identique à rapports.date_rapport
  const hour    = parseInt(parts.hour, 10);
  const minute  = parseInt(parts.minute, 10);
  return { weekday, dateFr, hour, minute, year: parseInt(parts.year, 10) };
}

// Calcule l'identifiant de semaine ISO ("2026-W20") pour la date Paris courante.
// On utilise la convention présente dans src/constants.js pour rester cohérent.
function currentWeekIdParis() {
  // Reconstitue une Date "midi heure Paris" pour éviter les bascules de jour
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  const [y, m, d] = fmt.split("-").map(Number);
  const local = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jan1  = new Date(Date.UTC(y, 0, 1, 12, 0, 0));
  const dayOfYear = Math.floor((local - jan1) / 86400000) + 1;
  const w = Math.ceil((dayOfYear + jan1.getUTCDay()) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

// Détermine si on est dans une fenêtre d'envoi (avec ~7 min de tolérance).
function dansFenetreEnvoi({ weekday, hour, minute }) {
  const minutesDepuis = hour * 60 + minute;
  if (["Lundi", "Mardi", "Mercredi"].includes(weekday)) {
    // 17h45 → 17h55
    return minutesDepuis >= 17 * 60 + 45 && minutesDepuis <= 17 * 60 + 55;
  }
  if (["Jeudi", "Vendredi"].includes(weekday)) {
    return minutesDepuis >= 16 * 60 + 45 && minutesDepuis <= 16 * 60 + 55;
  }
  return false;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildMailHtml(prenom, dateFr) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Rappel</div>
      <div style="color:#fff;font-size:20px;font-weight:800">📝 Compte rendu en attente</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <p style="margin:0 0 14px;font-size:15px">Bonjour <strong>${escapeHtml(prenom)}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;color:#333">
        Merci de remplir votre compte rendu du <strong>${escapeHtml(dateFr)}</strong> avant la fin de journée.
      </p>
      <div style="text-align:center;margin:22px 0">
        <a href="https://planning-chantiers.vercel.app/rapport#rapport"
           style="background:#FFC200;color:#1a1f2e;font-weight:800;text-decoration:none;padding:12px 28px;border-radius:8px;display:inline-block;font-size:14px">
          Remplir mon compte rendu →
        </a>
      </div>
      <p style="margin:18px 0 0;font-size:12px;color:#888">
        Si vous l'avez déjà soumis, vous pouvez ignorer ce message.
      </p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;
}

async function envoyerMail(req, to, subject, html) {
  // Construit l'URL absolue de /api/send-email à partir du host de la requête.
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const url   = `${proto}://${host}/api/send-email`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

module.exports = async function handler(req, res) {
  // ── Auth : Vercel envoie Authorization: Bearer ${CRON_SECRET} ──
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.authorization || "";
    if (got !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // ── Fenêtre temporelle Paris ──
  const t = parisNow();
  if (!dansFenetreEnvoi(t)) {
    return res.status(200).json({ ok: true, skipped: "outside_window", time: t });
  }

  // ── Supabase ──
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  try {
    const weekId = currentWeekIdParis();
    const jour   = t.weekday;
    const dateFr = t.dateFr;

    // 1. Config : ouvrier_emails + état des rappels déjà envoyés
    const { data: cfgRows } = await supabase
      .from("planning_config").select("key,value")
      .in("key", ["ouvrier_emails", "rappels_rapport_state"]);
    const cfg = {};
    (cfgRows || []).forEach(r => { cfg[r.key] = r.value; });
    const emails = cfg.ouvrier_emails || {};
    const state  = cfg.rappels_rapport_state || { date: null, prenoms: [] };
    const alreadySentToday = state.date === dateFr ? new Set(state.prenoms || []) : new Set();

    // 2. Ouvriers assignés à au moins une tâche aujourd'hui
    const { data: cells } = await supabase
      .from("planning_cells").select("ouvriers,taches,planifie,jour")
      .eq("week_id", weekId).eq("jour", jour);
    const assignes = new Set();
    (cells || []).forEach(cell => {
      const aUneTache = (cell.taches && cell.taches.length > 0)
        || (cell.planifie && cell.planifie.trim().length > 0);
      if (!aUneTache) return;
      (cell.ouvriers || []).forEach(nom => { if (nom) assignes.add(nom); });
    });

    if (assignes.size === 0) {
      return res.status(200).json({ ok: true, skipped: "no_assignees", weekId, jour, dateFr });
    }

    // 3. Rapports déjà rendus aujourd'hui (filtrés par prénoms assignés)
    const { data: rapports } = await supabase
      .from("rapports").select("ouvrier")
      .eq("date_rapport", dateFr)
      .in("ouvrier", Array.from(assignes));
    const rendus = new Set((rapports || []).map(r => r.ouvrier));

    // 4. Diff → à relancer (avec email + pas déjà notifié)
    const aRelancer = Array.from(assignes).filter(p =>
      !rendus.has(p) && !alreadySentToday.has(p) && emails[p]
    );

    const resultats = { envoyes: [], echecs: [], ignores: [] };
    for (const prenom of aRelancer) {
      const to = emails[prenom];
      const subject = `📝 Rappel : votre compte rendu du ${dateFr}`;
      const html = buildMailHtml(prenom, dateFr);
      try {
        const r = await envoyerMail(req, to, subject, html);
        if (r.ok) resultats.envoyes.push(prenom);
        else      resultats.echecs.push({ prenom, status: r.status, data: r.data });
      } catch (e) {
        resultats.echecs.push({ prenom, error: e.message });
      }
    }

    // 5. Ouvriers assignés sans rapport et sans email → ignorés silencieusement
    Array.from(assignes).forEach(p => {
      if (!rendus.has(p) && !emails[p]) resultats.ignores.push({ prenom: p, raison: "no_email" });
    });

    // 6. Mise à jour de l'état d'idempotence
    if (resultats.envoyes.length > 0) {
      const newState = {
        date: dateFr,
        prenoms: Array.from(new Set([...Array.from(alreadySentToday), ...resultats.envoyes])),
      };
      await supabase.from("planning_config")
        .upsert({ key: "rappels_rapport_state", value: newState }, { onConflict: "key" });
    }

    return res.status(200).json({
      ok: true,
      weekId, jour, dateFr,
      assignes: assignes.size,
      rendus: rendus.size,
      ...resultats,
    });
  } catch (e) {
    console.error("cron-rappel-rapport error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
