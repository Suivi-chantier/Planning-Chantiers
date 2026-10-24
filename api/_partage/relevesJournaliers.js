// api/_partage/relevesJournaliers.js — calcul et écriture des relevés
// journaliers (refonte du Bilan semaine, étape 1D).
//
// Aucune formule ici : la finance vient de src/chantierFinance.mjs, la
// complétude et l'état à une date de src/Renovation/releveJournalier.mjs.
// Ce fichier charge les données (mêmes chargements que le relevé hebdomadaire,
// via donneesFinanceChantiers) et écrit les lignes (upsert idempotent sur
// chantier_id + date_releve).
//
// Dossier préfixé « _ » : non déployé comme fonction Vercel.

const { fetchAll, chargerDonneesFinance } = require("./donneesFinanceChantiers");

// Date du jour à Paris, AAAA-MM-JJ.
function aujourdhuiParis(maintenant = new Date()) {
  const p = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(maintenant).reduce((acc, x) => { acc[x.type] = x.value; return acc; }, {});
  return `${p.year}-${p.month}-${p.day}`;
}

// Tout ce qu'il faut pour calculer les relevés (d'un chantier, ou de tous).
async function chargerContexte(supabase, { chantierId = null } = {}) {
  const parChantier = (q) => (chantierId ? q.eq("chantier_id", chantierId) : q);
  const trie = (q) => parChantier(q).order("id");
  const [donnees, journal, cellules, rapports, ressources, evenements, cfgHeures, releves] = await Promise.all([
    chargerDonneesFinance(supabase, { chantierId }),
    fetchAll(supabase, "avancement_journal", "id, chantier_id, tache_id, avancement_avant, avancement_apres, date_realisation, created_at", trie),
    fetchAll(supabase, "planning_cells", "id, week_id, jour, chantier_id, ouvriers", trie),
    fetchAll(supabase, "rapports", "id, ouvrier, chantier_id, date_rapport, statut, valide_le", trie),
    fetchAll(supabase, "planning_resources", "id, nom_planning, auth_user_id", (q) => q.order("id")),
    fetchAll(supabase, "planning_resource_events",
      "id, resource_id, type, date_debut, date_fin, toute_journee, heures_indisponibles, motif, actif", (q) => q.eq("actif", true).order("id")),
    supabase.from("planning_config").select("value").eq("key", "heures_par_jour").maybeSingle(),
    fetchAll(supabase, "chantier_releves_journaliers", "id, chantier_id, date_releve", trie),
  ]);
  const grouper = (lignes) => {
    const m = {};
    (lignes || []).forEach(l => { (m[l.chantier_id] ||= []).push(l); });
    return m;
  };
  return {
    donnees,
    journalPar: grouper(journal),
    cellules,
    rapportsPar: grouper(rapports),
    relevesPar: grouper(releves),
    absences: {
      ok: !cfgHeures.error,
      ressources, evenements,
      exceptions: cfgHeures.data?.value?.exceptions || {},
    },
  };
}

// Calcule et écrit les relevés d'un chantier pour une liste de jours.
async function ecrireReleves(supabase, rj, ctx, { chantierId, jours, calculeLe }) {
  const ph = ctx.donnees.phasagesUniques.find(p => String(p.chantier_id) === String(chantierId));
  if (!ph) return { chantierId, ecrits: 0, raison: "pas de phasage" };
  const inputs = ctx.donnees.inputsPour(ph);
  const journal = ctx.journalPar[chantierId] || [];
  const lignes = jours.map(dateISO => rj.ligneReleve({
    inputs, journal, dateISO, chantierNom: ph.chantier_nom || null, calculeLe,
    completude: rj.comptesRendusAttendus({
      chantierId, dateISO, cellules: ctx.cellules, rapports: ctx.rapportsPar[chantierId] || [], absences: ctx.absences,
    }),
  }));
  if (lignes.length === 0) return { chantierId, ecrits: 0 };
  const { error } = await supabase.from("chantier_releves_journaliers")
    .upsert(lignes, { onConflict: "chantier_id,date_releve", ignoreDuplicates: false });
  if (error) throw new Error(`chantier_releves_journaliers : ${error.message}`);
  return { chantierId, ecrits: lignes.length, jours, incomplets: lignes.filter(l => l.statut_completude === "incomplete").map(l => l.date_releve) };
}

// Recalcul après une écriture (validation, correction, avancement) : le jour
// touché et tous les relevés déjà enregistrés après lui, jusqu'à aujourd'hui.
// Sans date : la plus ancienne date de réalisation des lignes du journal
// écrites ces 30 dernières minutes pour ce chantier, sinon aujourd'hui.
async function recalculerApresEcriture(supabase, rj, { chantierId, date = null, maintenant = new Date() }) {
  const ctx = await chargerContexte(supabase, { chantierId });
  const aujourdhui = aujourdhuiParis(maintenant);
  let dateChangee = /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? date : null;
  if (!dateChangee) {
    const depuis = new Date(maintenant.getTime() - 30 * 60000).toISOString();
    const recentes = (ctx.journalPar[chantierId] || []).filter(l => String(l.created_at) >= depuis).map(l => String(l.date_realisation).slice(0, 10));
    dateChangee = recentes.length ? recentes.sort()[0] : aujourdhui;
  }
  if (dateChangee > aujourdhui) dateChangee = aujourdhui;
  const jours = rj.joursARecalculer({ dateChangee, joursExistants: (ctx.relevesPar[chantierId] || []).map(r => r.date_releve), aujourdhui });
  return ecrireReleves(supabase, rj, ctx, { chantierId, jours, calculeLe: maintenant.toISOString() });
}

// Dérives historiques par type de lot (étape 2, marge probable) : calculées
// sur les chantiers TERMINÉS (statut de la liste des chantiers), chantiers
// repris exclus, puis rangées dans planning_config — toutes les pages et tous
// les relevés lisent cette valeur, aucun ne la recalcule.
async function calculerDerivesHistoriques(supabase, ctx, { maintenant = new Date(), ecrire = true } = {}) {
  const finance = await import("../../src/chantierFinance.mjs");
  const d = ctx.donnees;
  const termines = new Set((d.chantiersConfig || []).filter(c => c?.statut === "termine").map(c => String(c.id)));
  const entrees = d.phasagesUniques
    .filter(ph => termines.has(String(ph.chantier_id)))
    .map(ph => {
      const fin = finance.computeChantierFinance(d.inputsPour(ph));
      return { chantierId: ph.chantier_id, chantierNom: ph.chantier_nom || ph.chantier_id, repris: fin.repris != null,
        repriseHeures: fin.brut.repriseHeures, lots: fin.lots };
    });
  const r = finance.derivesHistoriquesParLot(entrees, d.seuilsMarges);
  const valeur = { calcule_le: maintenant.toISOString(), ...r };
  if (ecrire) {
    const { error } = await supabase.from("planning_config")
      .upsert([{ key: finance.CLE_CONFIG_DERIVES_HISTORIQUES, value: valeur }], { onConflict: "key" });
    if (error) throw new Error(`planning_config/${finance.CLE_CONFIG_DERIVES_HISTORIQUES} : ${error.message}`);
  }
  // Les relevés de cette exécution lisent la valeur fraîche.
  d.derivesHistoriques = r.lots;
  const inputsPourAvant = d.inputsPour;
  d.inputsPour = (ph, surcharge) => ({ ...inputsPourAvant(ph, surcharge), derivesHistoriques: r.lots });
  return valeur;
}

// Rattrapage de nuit (idempotent) : chaque chantier qui a eu un mouvement
// aujourd'hui (journal d'avancement, pointages, lignes de commande saisies,
// comptes rendus validés) — relevé du jour, plus la cascade depuis le jour le
// plus ancien touché.
async function rattrapageDeNuit(supabase, rj, { maintenant = new Date() } = {}) {
  const ctx = await chargerContexte(supabase);
  const aujourdhui = aujourdhuiParis(maintenant);
  const resultats = [];
  const historique = await calculerDerivesHistoriques(supabase, ctx, { maintenant });
  for (const ph of ctx.donnees.phasagesUniques) {
    const chantierId = ph.chantier_id;
    if (!chantierId) continue;
    let dmin = rj.dateMinMouvements({
      journal: ctx.journalPar[chantierId] || [],
      pointages: ctx.donnees.ptsByChantier[chantierId] || [],
      commandeLignes: ctx.donnees.clByChantier[chantierId] || [],
      jour: aujourdhui,
    });
    (ctx.rapportsPar[chantierId] || []).forEach(r => {
      if (!r.valide_le || aujourdhuiParis(new Date(r.valide_le)) !== aujourdhui) return;
      const d = rj.dateRapportISO(r.date_rapport);
      if (d && d <= aujourdhui && (!dmin || d < dmin)) dmin = d;
    });
    if (!dmin) continue;
    const jours = rj.joursARecalculer({ dateChangee: dmin, joursExistants: (ctx.relevesPar[chantierId] || []).map(r => r.date_releve), aujourdhui });
    if (!jours.includes(aujourdhui)) jours.push(aujourdhui);
    resultats.push(await ecrireReleves(supabase, rj, ctx, { chantierId, jours, calculeLe: maintenant.toISOString() }));
  }
  return { ok: true, date: aujourdhui, chantiers: resultats.length, relevesEcrits: resultats.reduce((s, r) => s + (r.ecrits || 0), 0), derivesHistoriques: Object.keys(historique.lots || {}).length, resultats };
}

module.exports = { aujourdhuiParis, chargerContexte, ecrireReleves, recalculerApresEcriture, rattrapageDeNuit, calculerDerivesHistoriques };
