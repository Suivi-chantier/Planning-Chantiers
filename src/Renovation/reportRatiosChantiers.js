// src/Renovation/reportRatiosChantiers.js — lecture / écriture du report d'un
// ouvrage de la bibliothèque sur les chantiers (le calcul, pur, vit dans
// reportRatiosBibliotheque.mjs).
//
// Écriture par conducteur_sauvegarder_phasages_lot : toutes les révisions sont
// vérifiées avant la première écriture. Si un chantier a bougé entre la
// lecture et l'écriture (un conducteur qui enregistre au même moment), rien
// n'est écrit : on relit et on recommence. Jamais de chantier corrigé à moitié
// dans un même lot.
import { supabase } from "../supabase";
import { reporterSurPhasage, reporterBibliothequeSurPhasage, ajouterCorrectionRatios } from "./reportRatiosBibliotheque.js";

const TAILLE_LOT = 100;   // plafond de la RPC
const TENTATIVES = 3;

const dateParis = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Renvoie { ok, erreur?, chantiers: [{ chantier_id, chantier_nom, ouvragesConcernes,
// tachesRealignees, nonReconnues, avancementAvant, avancementApres, modifie }] }.
export async function reporterOuvrageSurChantiers(ouvrageBiblio) {
  const id = ouvrageBiblio?.id == null ? null : String(ouvrageBiblio.id);
  if (!id) return { ok: false, erreur: "ouvrage sans identifiant", chantiers: [] };

  let chantiers = [];
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const { data: phasages, error } = await supabase
      .from("phasages")
      .select("id, chantier_id, chantier_nom, revision, ouvrages, plan_travaux")
      // Filtre passé en TEXTE JSON : avec un tableau JS, postgrest-js écrit
      // `cs.{…}` (tableau Postgres) et la base refuse « invalid input syntax
      // for type json » — vu en ligne le 16/10/2026.
      .contains("ouvrages", JSON.stringify([{ bibliotheque_id: id }]));
    if (error) return { ok: false, erreur: error.message, chantiers };

    const maintenant = new Date();
    const lot = [];
    chantiers = [];
    (phasages || []).forEach(ph => {
      const r = reporterSurPhasage(ph.ouvrages, ouvrageBiblio);
      if (r.ouvragesConcernes === 0) return;
      chantiers.push({
        chantier_id: ph.chantier_id,
        chantier_nom: ph.chantier_nom || "(chantier sans nom)",
        ouvragesConcernes: r.ouvragesConcernes,
        tachesRealignees: r.tachesRealignees,
        nonReconnues: r.nonReconnues,
        avancementAvant: r.avancementAvant,
        avancementApres: r.avancementApres,
        modifie: r.modifie,
      });
      if (!r.modifie) return;
      const entree = r.avancementAvant !== r.avancementApres ? {
        le: maintenant.toISOString(),
        date: dateParis(maintenant),
        bibliotheque_id: id,
        libelle: ouvrageBiblio.libelle || "",
        avant: r.avancementAvant,
        apres: r.avancementApres,
      } : null;
      lot.push({
        phasage_id: ph.id,
        revision_attendue: ph.revision,
        ouvrages: r.ouvrages,
        ...(entree ? { plan_travaux: ajouterCorrectionRatios(ph.plan_travaux, entree) } : {}),
      });
    });

    if (lot.length === 0) return { ok: true, chantiers };

    let conflit = false;
    for (let i = 0; i < lot.length; i += TAILLE_LOT) {
      const { data, error: e } = await supabase.rpc("conducteur_sauvegarder_phasages_lot", {
        p_lot: lot.slice(i, i + TAILLE_LOT),
      });
      if (e) return { ok: false, erreur: e.message, chantiers };
      if (!data) return { ok: false, erreur: "ce compte n'est pas autorisé à modifier les chantiers", chantiers };
      if (data.ok !== true) {
        if (data.code === "conflit") { conflit = true; break; }
        return { ok: false, erreur: data.code || "refus du serveur", chantiers };
      }
    }
    if (!conflit) return { ok: true, chantiers };
  }
  return {
    ok: false,
    erreur: "un chantier était modifié au même moment, plusieurs fois de suite — réessayer dans un instant",
    chantiers,
  };
}

// Toute la bibliothèque sur tous les chantiers, en une action : même résultat
// que d'enregistrer un à un chaque ouvrage utilisé. Sert à basculer d'un coup
// les chantiers sur les heures prévues (16/10/2026) et à rattraper un report
// manqué. `ouvragesBiblio` : les ouvrages de la bibliothèque déjà chargés.
export async function appliquerBibliothequeATousLesChantiers(ouvragesBiblio) {
  const biblioParId = new Map((ouvragesBiblio || [])
    .filter(b => b?.id != null)
    .map(b => [String(b.id), { id: b.id, libelle: b.libelle, cadence: b.cadence, sous_taches: b.sous_taches }]));
  let chantiers = [];
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const { data: phasages, error } = await supabase
      .from("phasages")
      .select("id, chantier_id, chantier_nom, revision, ouvrages, plan_travaux");
    if (error) return { ok: false, erreur: error.message, chantiers };

    const maintenant = new Date();
    const lot = [];
    chantiers = [];
    (phasages || []).forEach(ph => {
      const r = reporterBibliothequeSurPhasage(ph.ouvrages, biblioParId);
      if (r.ouvragesConcernes === 0) return;
      chantiers.push({
        chantier_id: ph.chantier_id,
        chantier_nom: ph.chantier_nom || "(chantier sans nom)",
        ouvragesConcernes: r.ouvragesConcernes,
        tachesRealignees: r.tachesRealignees,
        nonReconnues: r.nonReconnues,
        avancementAvant: r.avancementAvant,
        avancementApres: r.avancementApres,
        modifie: r.modifie,
      });
      if (!r.modifie) return;
      const entree = r.avancementAvant !== r.avancementApres ? {
        le: maintenant.toISOString(),
        date: dateParis(maintenant),
        bibliotheque_id: null,
        libelle: "Bibliothèque appliquée à tous les chantiers",
        avant: r.avancementAvant,
        apres: r.avancementApres,
      } : null;
      lot.push({
        phasage_id: ph.id,
        revision_attendue: ph.revision,
        ouvrages: r.ouvrages,
        ...(entree ? { plan_travaux: ajouterCorrectionRatios(ph.plan_travaux, entree) } : {}),
      });
    });

    if (lot.length === 0) return { ok: true, chantiers };
    let conflit = false;
    for (let i = 0; i < lot.length; i += TAILLE_LOT) {
      const { data, error: e } = await supabase.rpc("conducteur_sauvegarder_phasages_lot", {
        p_lot: lot.slice(i, i + TAILLE_LOT),
      });
      if (e) return { ok: false, erreur: e.message, chantiers };
      if (!data) return { ok: false, erreur: "ce compte n'est pas autorisé à modifier les chantiers", chantiers };
      if (data.ok !== true) {
        if (data.code === "conflit") { conflit = true; break; }
        return { ok: false, erreur: data.code || "refus du serveur", chantiers };
      }
    }
    if (!conflit) return { ok: true, chantiers };
  }
  return {
    ok: false,
    erreur: "un chantier était modifié au même moment, plusieurs fois de suite — réessayer dans un instant",
    chantiers,
  };
}
