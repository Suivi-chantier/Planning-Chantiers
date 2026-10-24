// api/_partage/donneesFinanceChantiers.js — LE chargement des données qui
// alimentent src/chantierFinance.mjs côté serveur.
//
// Extrait tel quel de api/cron-snapshot-hebdo.js (24/09/2026) pour que
// l'assistant IA Rénovation calcule l'état d'un chantier avec EXACTEMENT les
// mêmes données que le relevé hebdomadaire : mêmes tables, mêmes colonnes,
// même choix du phasage en cas de doublon, même lecture du % facturé.
// Deux chargements parallèles finiraient par diverger, et l'assistant
// annoncerait un chiffre que le relevé contredit.
//
// Aucune formule ici : les calculs vivent dans src/chantierFinance.mjs.
// Aucune écriture : l'upsert du relevé reste dans le cron.
//
// `supabase` est passé en paramètre (client service_role du cron, ou
// adaptateur en lecture seule de l'assistant). Le module ne crée aucun client.
//
// Dossier préfixé « _ » : non déployé comme fonction Vercel (plan Hobby,
// 12 fonctions maximum).

// Supabase limite chaque requête à ~1000 lignes : on pagine pour ne jamais
// calculer sur des données tronquées.
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

const normNom = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Charge tout ce dont computeChantierFinance a besoin.
 *
 * @param {object} supabase            client (ou adaptateur) exposant from().select()
 * @param {object} [options]
 * @param {string} [options.chantierId] restreint phasages, pointages et lignes de
 *                                      commande à UN chantier. Les réglages
 *                                      (taux, lots, états financiers, matériaux)
 *                                      sont chargés à l'identique. Sans option :
 *                                      tous les chantiers (usage du cron).
 */
async function chargerDonneesFinance(supabase, { chantierId = null } = {}) {
  const parChantierId = (q) => (chantierId ? q.eq("chantier_id", chantierId) : q);

  const [phasages, pointages, commandeLignes, factureCouts, avoirs, cfgTaux, cfgTauxMO, cfgLots, cfgEtats, materiaux, cfgFG, achats] = await Promise.all([
    fetchAll(supabase, "phasages", "*", parChantierId),
    fetchAll(supabase, "pointages", "*", parChantierId),
    fetchAll(supabase, "commande_lignes",
      // commande.date_doc : date d'imputation des achats (relevés à une date passée).
      "id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, nature, ouvrage_id, chantier_id, created_at, commande:commandes(date_doc)",
      parChantierId),
    fetchAll(supabase, "facture_couts_chantiers", "id,chantier_id,montant_ht,nature,date_imputation", parChantierId),
    fetchAll(supabase, "avoirs_fournisseurs_imputations", "id,chantier_id,montant_ht,date_imputation,factures!inner(statut)", (q) => parChantierId(q).eq("factures.statut", "rapprochee")),
    supabase.from("planning_config").select("value").eq("key", "taux_horaires").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
    supabase.from("planning_config").select("value").eq("key", "etats_financiers").maybeSingle(),
    fetchAll(supabase, "materiaux_bibliotheque", "id, prix_unitaire"),
    supabase.from("planning_config").select("value").eq("key", "fg_taux_horaires").maybeSingle(),
    // Lots « achats terminés » : reste à commander à 0 (étape 1B).
    fetchAll(supabase, "achats_lots_termines", "id, chantier_id, lot_id, termine_le, termine_par", parChantierId),
  ]);
  const achatsParChantier = {};
  achats.forEach(a => { (achatsParChantier[a.chantier_id] ||= []).push(a); });
  const tauxHoraires = cfgTaux.data?.value || {};
  // Barème daté des frais généraux (Admin) ; absent = défaut du module.
  const tauxFG = cfgFG.data?.value ?? null;
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
  // Écritures distinctes : jamais de réécriture des commandes ni de double ajout.
  avoirs.forEach(c => {
    (clByChantier[c.chantier_id] ||= []).push({ id: `avoir-${c.id}`, chantier_id: c.chantier_id,
      libelle: "Avoir fournisseur", prix_total: Number(c.montant_ht), created_at: `${c.date_imputation}T12:00:00Z`,
      // Ajustement de facture, pas une commande : coût réel, hors enveloppe matériaux.
      nature: "autre" });
  });
  factureCouts.forEach(c => {
    if (!c.chantier_id) return;
    (clByChantier[c.chantier_id] ||= []).push({ id: `facture-cout-${c.id}`, chantier_id: c.chantier_id,
      libelle: c.nature === 'frais' ? 'Frais de facture fournisseur' : 'Écart de facture fournisseur',
      prix_total: Number(c.montant_ht), created_at: `${c.date_imputation}T12:00:00Z`, nature: "autre" });
  });

  // UN SEUL phasage par chantier : la table peut contenir des doublons de
  // chantier_id (l'app n'en lit qu'un via .maybeSingle()). Sans ce filtre,
  // l'upsert reçoit deux lignes pour le même (chantier_id, date_snapshot) et
  // Postgres refuse : « ON CONFLICT DO UPDATE cannot affect row a second time ».
  // On garde le plus récemment modifié.
  const parChantier = {};
  phasages.forEach(ph => {
    if (!ph.chantier_id) return;
    const cur = parChantier[ph.chantier_id];
    if (!cur || String(ph.updated_at || "") > String(cur.updated_at || "")) parChantier[ph.chantier_id] = ph;
  });
  const phasagesUniques = Object.values(parChantier);

  // Projections : bibliothèque de matériaux (reste à commander) + % facturé
  // par NOM de chantier (États financiers, période la plus récente).
  const materiauxById = {};
  (materiaux || []).forEach(mt => { materiauxById[String(mt.id)] = mt; });
  const pctFactureParNom = {};
  (() => {
    const av = cfgEtats.data?.value?.avancement;
    const periodId = av?.periods?.[0]?.id;
    if (!periodId || !Array.isArray(av?.rows)) return;
    av.rows.forEach(row => {
      const v = row.values?.[periodId];
      const nomCh = normNom(v?.chantier || row.chantier);
      if (!nomCh) return;
      const raw = parseFloat(String(v?.pctFacture ?? "").replace(",", "."));
      if (!Number.isFinite(raw)) return;
      pctFactureParNom[nomCh] = Math.abs(raw) > 1 ? raw / 100 : raw;
    });
  })();
  const pctFactureDe = (ph) => {
    const n = normNom(ph.chantier_nom);
    return n in pctFactureParNom ? pctFactureParNom[n] : null;
  };

  // Les entrées de computeChantierFinance pour un phasage. `surcharge` permet
  // au backfill de substituer l'état des ouvrages, pointages et lignes à une
  // date passée ; le % facturé reste lu sur le phasage d'origine.
  // `surcharge.aujourdhui` : date du taux de frais généraux des projections
  // (jour du relevé) — absente, le module prend le taux le plus récent.
  const inputsPour = (ph, surcharge = {}) => ({
    phasage: surcharge.phasage || ph,
    pointages: surcharge.pointages || ptsByChantier[ph.chantier_id] || [],
    commandeLignes: surcharge.commandeLignes || clByChantier[ph.chantier_id] || [],
    tauxHoraires, tauxMOPrev, lots,
    pctFacture: pctFactureDe(ph), materiauxById,
    tauxFG, aujourdhui: surcharge.aujourdhui || null,
    achatsTermines: achatsParChantier[ph.chantier_id] || [],
  });

  return {
    phasagesUniques, ptsByChantier, clByChantier,
    tauxHoraires, tauxMOPrev, lots, materiauxById, pctFactureDe, tauxFG,
    inputsPour,
  };
}

module.exports = { fetchAll, chargerDonneesFinance, normNom };
