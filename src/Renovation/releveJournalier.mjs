// src/Renovation/releveJournalier.mjs — relevé journalier d'un chantier
// (refonte du Bilan semaine, étape 1D). Module PUR : aucune lecture de base,
// aucune horloge ; les données et la date arrivent en paramètre. Utilisé par
// api/_partage/relevesJournaliers.js (calcul + écriture côté serveur).
//
// Un relevé = l'état du chantier EN FIN DE JOURNÉE D :
//   - finance : computeChantierFinance sur les données arrêtées à D (pointages
//     datés ≤ D, lignes de commande imputées ≤ D, avancement des tâches à D
//     d'après le journal daté, taux de frais généraux du jour D) ;
//   - complétude : les comptes rendus attendus ce jour-là (ouvriers planifiés
//     sur le chantier, hors absences) sont-ils validés ?
import { computeChantierFinance, etatTachesALaDate, dateImputationLigne } from "../chantierFinance.mjs";
import { getISOWeek, heuresJourEntreprise } from "../rythmeSemaine.mjs";
import { cibleJourneeOuvrier, ressourceDeLOuvrier } from "./cibleJourneeOuvrier.mjs";

const JOURS_SEMAINE = [null, "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", null]; // getUTCDay → libellé du planning

// Semaine ISO et jour du planning (planning_cells.week_id / jour) d'une date.
export function semaineEtJour(dateISO) {
  const [y, m, d] = String(dateISO).slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const { year, week } = getISOWeek(new Date(y, m - 1, d, 12));
  return { weekId: `${year}-W${String(week).padStart(2, "0")}`, jour: JOURS_SEMAINE[dt.getUTCDay()] };
}

// « JJ/MM/AAAA » ou ISO → ISO (rapports.date_rapport a connu les deux formats).
export function dateRapportISO(s) {
  const v = String(s || "").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}
const normNom = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Comptes rendus attendus d'un chantier un jour donné.
//   cellules  : lignes planning_cells (week_id, jour, chantier_id, ouvriers[])
//   rapports  : lignes rapports (ouvrier, chantier_id, date_rapport, statut)
//   absences  : { ok, ressources, evenements, exceptions } (même forme que
//               absencesOuvriers.chargerAbsencesOuvriers)
// Un ouvrier planifié n'est PAS attendu si sa cible du jour est nulle (jour
// non travaillé, absence couvrant la journée). Statut d'un attendu :
// valide | non_valide (compte rendu présent, pas encore validé) | manquant.
export function comptesRendusAttendus({ chantierId, dateISO, cellules = [], rapports = [], absences = null } = {}) {
  const { weekId, jour } = semaineEtJour(dateISO);
  const planifies = [];
  (cellules || []).forEach(c => {
    if (String(c.chantier_id) !== String(chantierId) || c.week_id !== weekId || c.jour !== jour) return;
    (Array.isArray(c.ouvriers) ? c.ouvriers : []).forEach(o => {
      const nom = String(o || "").trim();
      if (nom && !planifies.some(p => normNom(p) === normNom(nom))) planifies.push(nom);
    });
  });
  const heuresJour = heuresJourEntreprise(dateISO, absences?.exceptions || null);
  const attendus = [];
  const exclus = [];
  planifies.forEach(nom => {
    const res = ressourceDeLOuvrier(absences?.ressources, { prenom: nom });
    const c = cibleJourneeOuvrier({ heuresJour, evenements: absences?.evenements, resourceId: res?.id || null, dateISO });
    if (!(c.cible > 0)) { exclus.push({ ouvrier: nom, raison: c.explication || "pas d'heures attendues ce jour-là" }); return; }
    const sesRapports = (rapports || []).filter(r =>
      String(r.chantier_id) === String(chantierId) && dateRapportISO(r.date_rapport) === dateISO && normNom(r.ouvrier) === normNom(nom));
    const statut = sesRapports.some(r => r.statut === "valide") ? "valide" : sesRapports.length > 0 ? "non_valide" : "manquant";
    attendus.push({ ouvrier: nom, statut, ...(res ? {} : { absences_non_verifiees: true }) });
  });
  const manquants = attendus.filter(a => a.statut !== "valide");
  return {
    weekId, jour, attendus, manquants, exclus,
    // Rien d'attendu (personne de planifié) : complet, mais nb_attendus = 0 le
    // dit — un jour vide ne se confond pas avec un jour vérifié.
    statut: manquants.length === 0 ? "complete" : "incomplete",
    absencesLisibles: absences ? absences.ok !== false : false,
  };
}

// Phasage tel qu'il était en fin de journée D : avancement de chaque tâche
// remplacé par sa valeur à D d'après le journal. Tâche inconnue à D (avant le
// début du journal) : avancement actuel gardé et `inconnu` = true — le relevé
// n'affichera alors ni avancement ni projection.
export function phasageALaDate(phasage, journal, dateISO) {
  const etat = etatTachesALaDate(journal || [], dateISO);
  let inconnu = false;
  const ouvrages = (phasage?.ouvrages || []).map(o => ({
    ...o,
    taches: (o.taches || []).map(t => {
      const k = String(t.id);
      if (!etat.has(k)) return t;
      const v = etat.get(k);
      if (v == null) { inconnu = true; return t; }
      return { ...t, avancement: v };
    }),
  }));
  return { phasage: { ...phasage, ouvrages }, inconnu };
}

// Entrées de computeChantierFinance arrêtées à la fin du jour D.
export function entreesALaDate(inputs, journal, dateISO) {
  const { phasage, inconnu } = phasageALaDate(inputs.phasage, journal, dateISO);
  return {
    inconnu,
    entrees: {
      ...inputs,
      phasage,
      pointages: (inputs.pointages || []).filter(p => !p.date || String(p.date).slice(0, 10) <= dateISO),
      commandeLignes: (inputs.commandeLignes || []).filter(l => { const d = dateImputationLigne(l); return d == null || d <= dateISO; }),
      aujourdhui: dateISO,
    },
  };
}

const r2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// La ligne du relevé (mêmes colonnes que chantier_snapshots_hebdo + complétude).
export function ligneReleve({ inputs, journal = [], dateISO, chantierNom = null, completude, calculeLe }) {
  const { entrees, inconnu } = entreesALaDate(inputs, journal, dateISO);
  const fin = computeChantierFinance(entrees);
  const b = fin.brut;
  const warnings = [...fin.warnings];
  if (inconnu) {
    warnings.push({ code: "avancement_inconnu", gravite: "info",
      message: "Avancement de ce jour inconnu (antérieur au journal d'avancement) : avancement et projections non renseignés." });
  }
  if (completude && completude.absencesLisibles === false) {
    warnings.push({ code: "absences_non_verifiees", gravite: "info", message: "Absences illisibles : les comptes rendus attendus comptent tous les ouvriers planifiés." });
  }
  return {
    chantier_id: entrees.phasage.chantier_id,
    chantier_nom: chantierNom || entrees.phasage.chantier_nom || null,
    phasage_id: entrees.phasage.id || null,
    week_id: completude?.weekId || semaineEtJour(dateISO).weekId,
    date_releve: dateISO,
    vendu_ht: r2(b.prixHTChantier),
    mo_prev: r2(b.moPrevChantier),
    mat_prev: r2(b.commandesPrevChantier),
    mo_reel: r2(b.coutMOTotalChantier),
    mat_reel: r2(b.coutMatChantier),
    fg: r2(b.fgChantier),
    marge: r2(b.margeChantier),
    marge_pct: r2(b.margePctChantier),
    avancement: inconnu ? null : b.avancementChantier,
    heures_vendues: r2(b.heuresVenduesChantier),
    heures_reelles: r2(b.heuresReellesTotalChantier),
    marge_terminaison: inconnu ? null : r2(b.margeATerminaison),
    reste_a_faire_h: inconnu ? null : r2(b.heuresRestantes),
    reste_a_faire_eur: inconnu ? null : r2(b.resteAFaireEuros),
    situation_a_facturer: inconnu || b.situationAFacturer == null ? null : r2(b.situationAFacturer),
    reste_a_commander: b.resteACommander != null ? r2(b.resteACommander) : null,
    lots: fin.lots.filter(l => !l.vide).map(l => ({
      id: l.id, label: l.label,
      heuresVendues: r2(l.heuresVendues), heuresReelles: r2(l.heuresReelles),
      avancement: inconnu ? null : l.avancement, ratioDerive: inconnu || l.ratioDerive == null ? null : r2(l.ratioDerive),
      ...(l.heuresHorsDevis > 0 ? { heuresHorsDevis: r2(l.heuresHorsDevis) } : {}),
    })),
    warnings,
    statut_completude: completude?.statut || "incomplete",
    cr_attendus: completude?.attendus || [],
    cr_manquants: completude?.manquants || [],
    calcule_le: calculeLe || null,
  };
}

// Jours à recalculer quand le jour D d'un chantier change : D lui-même, puis
// chaque relevé déjà enregistré APRÈS D (ils intègrent les cumuls de D),
// jusqu'à aujourd'hui inclus. Triés, sans doublon.
export function joursARecalculer({ dateChangee, joursExistants = [], aujourdhui }) {
  const D = String(dateChangee).slice(0, 10);
  const set = new Set([D]);
  (joursExistants || []).forEach(j => { const x = String(j).slice(0, 10); if (x > D && x <= aujourdhui) set.add(x); });
  return [...set].filter(x => x <= aujourdhui).sort();
}

// Date la plus ancienne touchée par les mouvements d'un chantier dans une
// journée (lignes du journal écrites ce jour, pointages saisis ce jour,
// lignes de commande saisies ce jour) — base du rattrapage de nuit. null si
// aucun mouvement.
export function dateMinMouvements({ journal = [], pointages = [], commandeLignes = [], jour }) {
  const dates = [];
  (journal || []).forEach(l => { if (String(l.created_at || "").slice(0, 10) === jour) dates.push(String(l.date_realisation).slice(0, 10)); });
  (pointages || []).forEach(p => { if (String(p.created_at || "").slice(0, 10) === jour && p.date) dates.push(String(p.date).slice(0, 10)); });
  (commandeLignes || []).forEach(l => { if (String(l.created_at || "").slice(0, 10) === jour) { const d = dateImputationLigne(l); if (d) dates.push(d); } });
  const valides = dates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= jour);
  return valides.length ? valides.sort()[0] : null;
}
