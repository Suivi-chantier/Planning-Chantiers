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
//   ADMIN_EMAIL           — destinataire des alertes DST (défaut: francois.huet@groupe-profero.com)
//   RESEND_KEY / RESEND_FROM — utilisés par /api/send-email (déjà configurés)
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ ⚠ AJUSTEMENT HEURE D'ÉTÉ / HEURE D'HIVER                                 │
// │                                                                          │
// │ Vercel cron fonctionne en UTC. Le plan Hobby ne permet qu'1 invocation   │
// │ par jour par cron, donc on ne peut pas faire de détection runtime.       │
// │                                                                          │
// │ Schedule actuel (HEURE D'ÉTÉ - CEST, UTC+2) :                            │
// │   "50 15 * * 1-3"   → Lun-Mer 17h50 Paris ✓                              │
// │   "50 14 * * 4-5"   → Jeu-Ven 16h50 Paris ✓                              │
// │                                                                          │
// │ À CHANGER au passage à L'HEURE D'HIVER (dernier dimanche d'octobre) :    │
// │   "50 16 * * 1-3"   → Lun-Mer 17h50 Paris (CET, UTC+1)                   │
// │   "50 15 * * 4-5"   → Jeu-Ven 16h50 Paris                                │
// │                                                                          │
// │ À RECHANGER au passage à L'HEURE D'ÉTÉ (dernier dimanche de mars) :      │
// │   "50 15 * * 1-3"  /  "50 14 * * 4-5"  (valeurs ci-dessus)               │
// │                                                                          │
// │ Le handler détecte automatiquement le décalage et envoie une alerte      │
// │ par email à ADMIN_EMAIL pour rappeler de faire le changement.            │
// └─────────────────────────────────────────────────────────────────────────┘

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

// Heure de Paris attendue pour chaque jour de la semaine.
function heureAttendue(weekday) {
  if (["Lundi", "Mardi", "Mercredi"].includes(weekday)) return 17;
  if (["Jeudi", "Vendredi"].includes(weekday)) return 16;
  return null;
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

// Construit le mail d'alerte DST envoyé à l'admin.
function buildDstAlertHtml({ weekday, hour, minute }, expectedHour, sens) {
  const sensTexte = sens === "ete_vers_hiver"
    ? "Passage à l'heure d'hiver détecté"
    : sens === "hiver_vers_ete"
    ? "Passage à l'heure d'été détecté"
    : "Décalage horaire détecté";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Action requise</div>
      <div style="color:#fff;font-size:20px;font-weight:800">⚠ Cron à ajuster : ${escapeHtml(sensTexte)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <p style="margin:0 0 14px;font-size:14px">
        Le cron de rappel de compte rendu vient de tirer un <strong>${escapeHtml(weekday)}</strong> à
        <strong>${String(hour).padStart(2,"0")}h${String(minute).padStart(2,"0")}</strong> heure de Paris,
        alors qu'il devrait tirer à <strong>${expectedHour}h50</strong>.
      </p>
      <p style="margin:0 0 14px;font-size:14px">
        Il faut éditer <code style="background:#f4f6fa;padding:2px 6px;border-radius:3px;font-size:13px">vercel.json</code>
        avec les nouvelles valeurs UTC, puis push :
      </p>
      <div style="background:#1a1f2e;color:#e8eaf0;padding:14px 16px;border-radius:6px;font-family:monospace;font-size:12px;line-height:1.6;margin:14px 0">
        ${sens === "ete_vers_hiver" ? `
        "schedule": "50 16 * * 1-3"  &larr; Lun-Mer<br>
        "schedule": "50 15 * * 4-5"  &larr; Jeu-Ven
        ` : `
        "schedule": "50 15 * * 1-3"  &larr; Lun-Mer<br>
        "schedule": "50 14 * * 4-5"  &larr; Jeu-Ven
        `}
      </div>
      <p style="margin:14px 0 0;font-size:13px;color:#666">
        En attendant, les ouvriers continuent de recevoir leurs rappels — juste à ${Math.abs(expectedHour - hour) === 1 ? "une heure de décalage" : "horaire incorrect"}.
      </p>
      <p style="margin:14px 0 0;font-size:12px;color:#888">
        ℹ Cette alerte n'est envoyée qu'une fois par jour tant que le décalage persiste.
      </p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;
}

async function envoyerAlerteDstSiNecessaire(supabase, req, t, expectedHour) {
  const adminEmail = process.env.ADMIN_EMAIL || "francois.huet@groupe-profero.com";
  // Idempotence : on n'alerte qu'une fois par jour
  const { data } = await supabase.from("planning_config")
    .select("value").eq("key", "dst_alert_state").maybeSingle();
  if (data?.value?.last_alert_date === t.dateFr) return { skipped: "already_alerted_today" };

  const sens = t.hour < expectedHour ? "ete_vers_hiver" : "hiver_vers_ete";
  const html = buildDstAlertHtml(t, expectedHour, sens);
  const r = await envoyerMail(req, adminEmail, `⚠ Profero Planning : ajustement cron requis (${sens === "ete_vers_hiver" ? "heure d'hiver" : "heure d'été"})`, html);

  await supabase.from("planning_config").upsert(
    { key: "dst_alert_state", value: { last_alert_date: t.dateFr, sens } },
    { onConflict: "key" }
  );
  return { sent: r.ok, sens };
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

  // ── Vérification jour ouvré (Lun-Ven) ──
  const t = parisNow();
  const expectedHour = heureAttendue(t.weekday);
  if (expectedHour === null) {
    return res.status(200).json({ ok: true, skipped: "weekend", time: t });
  }

  // ── Supabase ──
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // ── Détection drift DST : si l'heure Paris ne correspond pas à l'heure
  //    attendue, c'est qu'on a basculé été↔hiver. On alerte l'admin par mail
  //    (1× / jour) mais on continue d'envoyer les rappels aux ouvriers.
  let dstAlert = null;
  if (t.hour !== expectedHour) {
    try { dstAlert = await envoyerAlerteDstSiNecessaire(supabase, req, t, expectedHour); }
    catch (e) { console.error("DST alert error:", e); }
  }

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
      heureParis: `${String(t.hour).padStart(2,"0")}:${String(t.minute).padStart(2,"0")}`,
      heureAttendue: `${expectedHour}:50`,
      dstAlert,
      assignes: assignes.size,
      rendus: rendus.size,
      ...resultats,
    });
  } catch (e) {
    console.error("cron-rappel-rapport error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
