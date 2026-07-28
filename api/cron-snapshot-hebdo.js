// api/cron-snapshot-hebdo.js — Snapshot hebdomadaire FINANCIER des chantiers
//
// Pour chaque chantier ACTIF, calcule la ligne financière complète via
// src/chantierFinance.mjs (LE module de calcul unique — aucune formule ici)
// et upsert une ligne dans chantier_snapshots_hebdo.
//
// Chantier ACTIF = au moins un pointage dans les JOURS_ACTIVITE derniers jours
// OU avancement strictement entre 1 % et 99 % (pas de colonne statut fiable).
//
// Déclenché chaque vendredi 18h10 Paris par GitHub Actions
// (cron-snapshot-hebdo.yml), juste après le snapshot d'avancement existant.
// Idempotent : UNIQUE (chantier_id, date_snapshot) + upsert.
//
// Backfill rétroactif : ?backfill=true[&weeks=12] reconstitue les vendredis
// passés à partir de phasages_history (état des ouvrages à la date) et des
// pointages / lignes de commande datés. Les lignes reconstituées portent
// {code:"reconstitue"} dans warnings.
//
// Variables d'env requises : CRON_SECRET, VITE_SUPABASE_URL,
// VITE_SUPABASE_KEY (ou SUPABASE_SERVICE_ROLE_KEY).

const { createClient } = require("@supabase/supabase-js");

// Nombre de jours sans pointage au-delà duquel un chantier sans avancement
// intermédiaire n'est plus considéré comme actif.
const JOURS_ACTIVITE = 21;

function parisNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// weekId au MÊME format que l'app (getCurrentWeek + getWeekId de constants.js) :
// semaine calée sur le 1er janvier, "YYYY-Wnn".
function weekIdFor(dateISO) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const jan1 = new Date(y, 0, 1);
  const w = Math.ceil(((date - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}

function addDays(dateISO, n) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// Supabase limite chaque requête à ~1000 lignes : on pagine pour ne jamais
// snapshoter sur des données tronquées.
async function fetchAll(supabase, table, select, filters = (q) => q) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filters(
      supabase.from(table).select(select).range(from, from + PAGE - 1)
    );
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Construit la ligne snapshot d'un chantier à partir du résultat du module.
function buildRow(cf, phasage, weekId, dateSnapshot, extraWarnings = []) {
  const fin = cf.computeChantierFinance(phasage.inputs);
  const b = fin.brut;
  return {
    row: {
      chantier_id:   phasage.chantier_id,
      chantier_nom:  phasage.chantier_nom || null,
      phasage_id:    phasage.id,
      week_id:       weekId,
      date_snapshot: dateSnapshot,
      vendu_ht:      r2(b.prixHTChantier),
      mo_prev:       r2(b.moPrevChantier),
      mat_prev:      r2(b.commandesPrevChantier),
      mo_reel:       r2(b.coutMOTotalChantier),
      mat_reel:      r2(b.coutMatChantier),
      fg:            r2(b.fgChantier),
      marge:         r2(b.margeChantier),
      marge_pct:     r2(b.margePctChantier),
      avancement:    b.avancementChantier,
      heures_vendues: r2(b.heuresVenduesChantier),
      heures_reelles: r2(b.heuresReellesTotalChantier),
      lots: fin.lots
        .filter(l => !l.vide)
        .map(l => ({
          id: l.id, label: l.label,
          heuresVendues: r2(l.heuresVendues), heuresReelles: r2(l.heuresReelles),
          avancement: l.avancement, ratioDerive: l.ratioDerive != null ? r2(l.ratioDerive) : null,
        })),
      warnings: [...fin.warnings, ...extraWarnings],
    },
    fin,
  };
}

// Un chantier est actif à une date donnée si un pointage tombe dans les
// JOURS_ACTIVITE jours qui la précèdent, ou si l'avancement est entre 1 et 99.
function estActif(pointages, avancement, dateSnapshot) {
  const seuil = addDays(dateSnapshot, -JOURS_ACTIVITE);
  const recent = pointages.some(p => {
    const d = (p.date || "").slice(0, 10);
    return d && d >= seuil && d <= dateSnapshot;
  });
  return recent || (avancement > 0 && avancement < 100);
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
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supaUrl || !supaKey) {
    return res.status(500).json({ error: "Supabase env vars missing" });
  }
  const supabase = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  // IMPÉRATIF : les formules viennent du module unique. Si cet import échoue,
  // on corrige le module — on ne recopie JAMAIS les formules ici.
  const cf = await import("../src/chantierFinance.mjs");

  const backfill = String(req.query?.backfill || "").toLowerCase() === "true";
  const weeks = Math.max(1, Math.min(52, parseInt(req.query?.weeks) || 12));
  const dateSnapshot = parisNow();

  try {
    // ── Données communes ──
    const [phasages, pointages, commandeLignes, cfgTaux, cfgTauxMO, cfgLots] = await Promise.all([
      fetchAll(supabase, "phasages", "*"),
      fetchAll(supabase, "pointages", "*"),
      fetchAll(supabase, "commande_lignes",
        "id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, created_at"),
      supabase.from("planning_config").select("value").eq("key", "taux_horaires").maybeSingle(),
      supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle(),
      supabase.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
    ]);
    const tauxHoraires = cfgTaux.data?.value || {};
    const tauxMOPrev = parseFloat(cfgTauxMO.data?.value) || 0;
    const itemsLots = cfgLots.data?.value?.items;
    const lots = Array.isArray(itemsLots) && itemsLots.length > 0
      ? itemsLots.map((l, i) => ({
          id: l.id || `lot_${i}`, label: l.label || `Lot ${i + 1}`,
          couleur: l.couleur || l.color || "#888888",
        }))
      : []; // pas de config → le module regroupera tout en "Sans lot"

    const ptsByChantier = {};
    pointages.forEach(p => { (ptsByChantier[p.chantier_id] ||= []).push(p); });
    const clByChantier = {};
    commandeLignes.forEach(l => { (clByChantier[l.chantier_id] ||= []).push(l); });

    const rows = [];
    const skipped = [];

    if (!backfill) {
      // ── Snapshot du jour ──
      const weekId = weekIdFor(dateSnapshot);
      for (const ph of phasages) {
        if (!ph.chantier_id) continue;
        const pts = ptsByChantier[ph.chantier_id] || [];
        const cl = clByChantier[ph.chantier_id] || [];
        const inputs = { phasage: ph, pointages: pts, commandeLignes: cl, tauxHoraires, tauxMOPrev, lots };
        const { row, fin } = buildRow(cf, { ...ph, inputs }, weekId, dateSnapshot);
        if (!estActif(pts, fin.brut.avancementChantier, dateSnapshot)) {
          skipped.push({ chantier_id: ph.chantier_id, raison: "inactif" });
          continue;
        }
        rows.push(row);
      }
    } else {
      // ── Backfill : reconstitution des N derniers vendredis ──
      // Vendredis passés (STRICTEMENT avant aujourd'hui) : on remonte depuis
      // aujourd'hui jusqu'au vendredi précédent, puis de 7 en 7.
      const fridays = [];
      let d = dateSnapshot;
      // parisNow → jour de semaine via Date UTC (les dates ISO pures suffisent)
      const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 5 = vendredi
      do { d = addDays(d, -1); } while (dow(d) !== 5);
      for (let i = 0; i < weeks; i++) { fridays.push(d); d = addDays(d, -7); }

      // Historique des ouvrages : une requête PAR PHASAGE (couvre toute la
      // fenêtre), puis sélection en mémoire de la version ≤ chaque vendredi.
      const oldest = fridays[fridays.length - 1];
      for (const ph of phasages) {
        if (!ph.chantier_id) continue;
        const { data: hist, error: hErr } = await supabase
          .from("phasages_history")
          .select("ouvrages, plan_travaux, saved_at")
          .eq("phasage_id", ph.id)
          .gte("saved_at", `${oldest}T00:00:00Z`)
          .order("saved_at", { ascending: true });
        if (hErr) throw new Error(`phasages_history: ${hErr.message}`);

        const ptsAll = ptsByChantier[ph.chantier_id] || [];
        const clAll = clByChantier[ph.chantier_id] || [];

        for (const friday of fridays) {
          // État des ouvrages au vendredi : dernière version d'historique
          // sauvegardée APRÈS ce vendredi = état d'AVANT la modification
          // suivante ; la première version postérieure au vendredi contient
          // donc l'état du vendredi. À défaut : l'état actuel (le phasage n'a
          // pas bougé depuis).
          const apres = (hist || []).find(h => h.saved_at > `${friday}T23:59:59Z`);
          const phasageAlors = apres
            ? { ...ph, ouvrages: apres.ouvrages, plan_travaux: apres.plan_travaux }
            : ph;
          const ptsAlors = ptsAll.filter(p => (p.date || "").slice(0, 10) <= friday);
          const clAlors = clAll.filter(l => !l.created_at || l.created_at.slice(0, 10) <= friday);
          const inputs = { phasage: phasageAlors, pointages: ptsAlors, commandeLignes: clAlors, tauxHoraires, tauxMOPrev, lots };
          const { row, fin } = buildRow(cf, { ...phasageAlors, inputs }, weekIdFor(friday), friday, [{
            code: "reconstitue", gravite: "info",
            message: `Snapshot reconstitué a posteriori (backfill du ${dateSnapshot}) : ouvrages via phasages_history, taux/réglages actuels.`,
          }]);
          if (!estActif(ptsAlors, fin.brut.avancementChantier, friday)) continue;
          rows.push(row);
        }
      }
    }

    if (rows.length === 0) {
      return res.status(200).json({ ok: true, inserted: 0, date: dateSnapshot, backfill, note: "no chantier to snapshot", skipped });
    }

    // Upsert sur (chantier_id, date_snapshot) — idempotent.
    const { data: inserted, error: insErr } = await supabase
      .from("chantier_snapshots_hebdo")
      .upsert(rows, { onConflict: "chantier_id,date_snapshot", ignoreDuplicates: false })
      .select("id, chantier_id, date_snapshot, marge");
    if (insErr) throw new Error(insErr.message);

    return res.status(200).json({
      ok: true,
      date: dateSnapshot,
      backfill,
      inserted: inserted?.length || 0,
      skipped,
      chantiers: rows.map(r => ({ chantier_id: r.chantier_id, date: r.date_snapshot, marge: r.marge, avancement: r.avancement })),
    });
  } catch (e) {
    console.error("cron-snapshot-hebdo error:", e);
    return res.status(500).json({ error: e.message || "Erreur inconnue" });
  }
};
