// api/_cron/cron-relances-cycle-vie.js — Relances e-mail du cycle de vie du
// chantier (Refonte Opérations, lot 3) :
//   - devis envoyé non signé ;
//   - facture d'acompte émise non réglée.
// E-mail au chargé d'affaires du chantier, première relance après le délai
// réglé (7 jours par défaut), puis chaque semaine.
//
// INTERRUPTEUR : planning_config « relances_cycle_vie ». Absent ou éteint →
// la tâche s'arrête AVANT toute lecture et n'envoie RIEN (livré éteint).
//
// Une seule logique : qui relancer et quand vient de
// src/Renovation/relancesCycleVie.mjs, le même module que la fiche chantier.
// Anti-doublon : la ligne de relances_cycle_vie (chantier, type, référence,
// période) est RÉSERVÉE avant l'envoi (contrainte d'unicité) ; un échec
// d'envoi la marque « echec » et pourra être retenté le lendemain.
//
// Appelé par api/cron-dispatcher.js (?job=relances_cycle_vie), créneau GitHub
// .github/workflows/cron-dispatcher.yml. N'ajoute aucune fonction Vercel.

const PLAFOND_PAR_PASSAGE = 30; // garde-fou : au-delà, le reste part au passage suivant

let _modules = null;
async function modules() {
  if (!_modules) {
    const [relances, liens] = await Promise.all([
      import("../../src/Renovation/relancesCycleVie.mjs"),
      import("../../src/Renovation/progbatLiens.mjs"),
    ]);
    _modules = { relances, liens };
  }
  return _modules;
}

async function lireTout(supabase, table, colonnes) {
  const lignes = [];
  for (let debut = 0; ; debut += 1000) {
    const { data, error } = await supabase.from(table).select(colonnes).range(debut, debut + 999);
    if (error) throw new Error(`${table} : ${error.message}`);
    lignes.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return lignes;
}

/**
 * deps : { envoyerMail(req, to, subject, html) → { ok, status, data } }
 * t    : parisNow() du dispatcher ({ dateIso })
 */
async function runRelancesCycleVie(req, supabase, t, envoyerMail) {
  const { relances: R, liens: L } = await modules();

  // 1. Interrupteur — lu en premier, rien d'autre n'est lu s'il est éteint.
  const { data: cfg, error: errCfg } = await supabase.from("planning_config")
    .select("value").eq("key", R.CLE_REGLAGES_RELANCES).maybeSingle();
  if (errCfg) throw new Error(`réglage des relances illisible : ${errCfg.message}`);
  const reglages = R.lireReglagesRelances(cfg?.value);
  if (!reglages.actif) {
    return { ok: true, actif: false, envoyees: 0, raison: "Relances désactivées dans les Réglages : aucun e-mail envoyé." };
  }

  // 2. Données (clé service : lecture complète).
  const [chantiers, operations, lignesCycleVie, phasages, factures, liensProjets, utilisateurs, journal] = await Promise.all([
    lireTout(supabase, "chantiers", "id, operation_id, nom, statut, archive_le, charge_affaires_id, charge_affaires_nom"),
    lireTout(supabase, "operations", "id, nom, charge_affaires_id, charge_affaires_nom"),
    lireTout(supabase, "chantier_cycle_vie", "chantier_id, etape_id, etat"),
    lireTout(supabase, "phasages", "id, chantier_id, plan_travaux, updated_at"),
    lireTout(supabase, "chantier_factures_client", "id, chantier_id, ligne_id, numero, statut, source, date_facture, date_encaissement, montant_ttc, created_at, progbat_bill_id, progbat_bill_code, progbat_quote_id, progbat_type, progbat_situation_number, progbat_document_date"),
    lireTout(supabase, "chantier_projets", "chantier_id, projet_id"),
    lireTout(supabase, "utilisateurs", "id, email, actif"),
    lireTout(supabase, "relances_cycle_vie", "chantier_id, type, reference, periode, statut, envoye_le"),
  ]);
  const reglements = await lireTout(supabase, "chantier_factures_reglements", "id, facture_id, montant, annule");
  const projetIds = [...new Set(liensProjets.map((l) => l.projet_id).filter(Boolean))];
  const quoteParChantier = {};
  if (projetIds.length) {
    const { data: projets, error } = await supabase.from("profero_projets").select("id, progbat_devis_id").in("id", projetIds);
    if (error) throw new Error(`profero_projets : ${error.message}`);
    const parId = new Map((projets || []).map((p) => [p.id, p.progbat_devis_id]));
    liensProjets.forEach((l) => { if (parId.get(l.projet_id)) quoteParChantier[l.chantier_id] = parId.get(l.projet_id); });
  }

  const dossiers = R.construireDossiersRelances({
    chantiers, operations, lignesCycleVie, phasages, factures, reglements, quoteParChantier, utilisateurs,
  });
  const plan = R.planifierRelances({ dossiers, journal, reglages, todayISO: t.dateIso });

  // 3. Envoi : réservation → e-mail → statut.
  const resultat = { ok: true, actif: true, delai_jours: reglages.delaiJours, dues: plan.aEnvoyer.length, envoyees: 0, echecs: 0, deja_reservees: 0, reportees: 0, par_statut: plan.parStatut };
  for (const r of plan.aEnvoyer) {
    if (resultat.envoyees + resultat.echecs >= PLAFOND_PAR_PASSAGE) { resultat.reportees++; continue; }
    const cle = { chantier_id: r.chantierId, type: r.type, reference: r.reference, periode: r.periode };
    let reservee = false;
    const ins = await supabase.from("relances_cycle_vie")
      .insert({ ...cle, destinataire: r.destinataire, statut: "en_cours" }).select("id").maybeSingle();
    if (!ins.error) reservee = true;
    else if (ins.error.code === "23505") {
      // Déjà réservée : on ne reprend que si l'envoi précédent a échoué.
      const rep = await supabase.from("relances_cycle_vie")
        .update({ statut: "en_cours", destinataire: r.destinataire, envoye_le: new Date().toISOString() })
        .match({ ...cle, statut: "echec" }).select("id");
      reservee = !rep.error && (rep.data || []).length > 0;
    } else throw new Error(`relances_cycle_vie : ${ins.error.message}`);
    if (!reservee) { resultat.deja_reservees++; continue; }

    const d = r.dossier;
    const lien = r.type === "devis"
      ? L.lienProgbat("devis", d.devis.quoteId)
      : L.lienProgbat("facture", d.acompte.billId, { nom: d.acompte.numero || "" });
    const { subject, html } = R.contenuEmailRelance({ type: r.type, dossier: d, periode: r.periode, lien, delaiJours: reglages.delaiJours, todayISO: t.dateIso });
    let envoi;
    try { envoi = await envoyerMail(req, r.destinataire, subject, html); }
    catch (e) { envoi = { ok: false, status: "exception", data: { error: e.message } }; }
    await supabase.from("relances_cycle_vie")
      .update({ statut: envoi.ok ? "envoyee" : "echec", detail: envoi.ok ? null : String(envoi.data?.error || envoi.status || "échec").slice(0, 300) })
      .match(cle);
    if (envoi.ok) resultat.envoyees++; else resultat.echecs++;
  }
  return resultat;
}

module.exports = { runRelancesCycleVie, PLAFOND_PAR_PASSAGE };
