// api/cron-snapshot-avancement.js — Snapshot hebdomadaire de l'avancement
//
// Pour chaque phasage actif en base, calcule l'avancement (pondéré par
// heures vendues) et insère une ligne dans chantier_avancement_history.
//
// Déclenché chaque vendredi 18h Paris par GitHub Actions (workflow
// cron-snapshot-avancement.yml). Permet à la page Équipe → Bilan
// semaine d'afficher la progression gagnée durant la semaine en cours
// (comparaison snapshot N-1 vs avancement actuel).
//
// Idempotence : un UNIQUE INDEX en base empêche 2 snapshots pour le
// même chantier le même jour.
//
// Snapshot rétroactif : appel avec ?initial=true permet de créer un
// snapshot zéro pour tous les chantiers actifs qui n'en ont aucun
// (à utiliser une seule fois après le premier déploiement).
//
// Variables d'env requises : CRON_SECRET, VITE_SUPABASE_URL, VITE_SUPABASE_KEY.

const { createClient } = require("@supabase/supabase-js");

function parisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Calcule l'avancement (pondéré par heures vendues) d'un phasage.
// Compatible nouveau modèle (heures au niveau ouvrage) ET legacy
// (heures_vendues par sous-tâche).
function calcAvancementPhasage(phasage) {
  const plan = phasage?.plan_travaux || {};
  // Toutes les sous-tâches du plan (clés ≠ "meta" et ≠ "_*")
  const allTaches = [];
  for (const k of Object.keys(plan)) {
    if (k === "meta" || k.includes("__")) continue;
    if (Array.isArray(plan[k])) allTaches.push(...plan[k]);
  }
  if (allTaches.length === 0) return { avancement: 0, terminees: 0, total: 0 };

  const terminees = allTaches.filter(t => (parseFloat(t.avancement) || 0) >= 100).length;
  const total     = allTaches.length;

  // Pondération par heures vendues si disponible (legacy), sinon moyenne simple
  const totalHV = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
  let avancement;
  if (totalHV > 0) {
    avancement = Math.round(
      allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0)
      / totalHV
    );
  } else {
    avancement = Math.round(
      allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / total
    );
  }
  return { avancement, terminees, total };
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

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const supaKey = process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const dateSnapshot = parisNow();
  // Si ?initial=true on ne snapshot que les chantiers qui n'ont JAMAIS eu de
  // snapshot (sert au seed après premier déploiement).
  const initial = String(req.query?.initial || "").toLowerCase() === "true";

  try {
    const { data: phasages, error: phErr } = await supabase
      .from("phasages")
      .select("id, chantier_id, chantier_nom, plan_travaux");
    if (phErr) throw new Error(phErr.message);

    let chantiersDejaSnapshotes = new Set();
    if (initial) {
      const { data: existing } = await supabase
        .from("chantier_avancement_history")
        .select("chantier_id");
      chantiersDejaSnapshotes = new Set((existing || []).map(r => r.chantier_id));
    }

    const rows = [];
    for (const ph of (phasages || [])) {
      if (!ph.chantier_id) continue;
      if (initial && chantiersDejaSnapshotes.has(ph.chantier_id)) continue;
      const { avancement, terminees, total } = calcAvancementPhasage(ph);
      if (total === 0) continue; // chantier sans plan : skip
      rows.push({
        chantier_id:      ph.chantier_id,
        chantier_nom:     ph.chantier_nom || null,
        phasage_id:       ph.id,
        avancement,
        taches_terminees: terminees,
        taches_total:     total,
        date_snapshot:    dateSnapshot,
      });
    }

    if (rows.length === 0) {
      return res.status(200).json({ ok: true, inserted: 0, date: dateSnapshot, note: "no chantier to snapshot" });
    }

    // Upsert sur (chantier_id, date_snapshot) — idempotent
    const { data: inserted, error: insErr } = await supabase
      .from("chantier_avancement_history")
      .upsert(rows, { onConflict: "chantier_id,date_snapshot", ignoreDuplicates: false })
      .select("id, chantier_id, avancement");
    if (insErr) throw new Error(insErr.message);

    return res.status(200).json({
      ok: true,
      date: dateSnapshot,
      inserted: inserted?.length || 0,
      initial,
      chantiers: rows.map(r => ({ chantier_id: r.chantier_id, avancement: r.avancement })),
    });
  } catch (e) {
    console.error("cron-snapshot-avancement error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
