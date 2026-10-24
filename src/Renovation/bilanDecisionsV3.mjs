// ─────────────────────────────────────────────────────────────────────────────
// Bilan, page 2 (refonte, étape 3.6) : décisions attendues, tendances par lot,
// semaine qui vient.
//
//   - Rappel des blocages des bilans précédents : limité aux 4 DERNIÈRES
//     semaines avant la période (il pouvait remonter à 11 semaines).
//   - Décisions PROPOSÉES au conducteur, qu'il valide ou écarte avant l'export :
//     tâches « en cours » depuis 3 semaines ou plus, comptes rendus qui
//     mentionnent une attente (carottage, client, livraison…), et
//     l'emplacement des tâches hors devis à arbitrer (alimenté à l'étape 4).
//   - Tendances par type de lot, tous chantiers : chantiers en cours ayant au
//     moins 25 % d'avancement dans le lot, et chantiers terminés ; chantiers
//     repris exclus. Dérive moyenne pondérée par les heures (Σ heures réelles ÷
//     Σ heures attendues), comme les dérives historiques de la marge probable.
//   - La semaine qui vient : équipe prévue par chantier (proposition du moteur
//     de planning), heures et tâches.
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────
import { dateRapportIsoV3, ajouterJoursV3, semaineIsoV3, lundiSemaineV3, fmtJourV3 } from "./bilanPeriodeV3.mjs";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const norm = s => str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export const SEMAINES_RAPPEL_BLOCAGES = 4;

/**
 * Blocages saisis dans les bilans des 4 semaines précédant la période.
 * @param {Array} bilansHebdo  lignes de bilans_hebdo ({ week_id, data: { blocages: [{ chantier_id, texte }] } })
 */
export function rappelBlocagesV3({ bilansHebdo, periode, noms = {}, semaines = SEMAINES_RAPPEL_BLOCAGES }) {
  const lundiPeriode = lundiSemaineV3(semaineIsoV3(periode.debut));
  const plusAncienne = semaineIsoV3(ajouterJoursV3(lundiPeriode, -7 * semaines));
  const semainePeriode = semaineIsoV3(periode.debut);
  const out = [];
  for (const b of listeSure(bilansHebdo)) {
    const w = str(b.week_id);
    if (!/^\d{4}-W\d{2}$/.test(w) || w < plusAncienne || w >= semainePeriode) continue;
    for (const x of listeSure(b.data?.blocages)) {
      if (!str(x?.texte)) continue;
      out.push({ semaine: w, chantierId: str(x.chantier_id), nom: noms[str(x.chantier_id)] || str(x.chantier_id) || "Général", texte: str(x.texte) });
    }
  }
  return out.sort((a, b) => b.semaine.localeCompare(a.semaine) || a.nom.localeCompare(b.nom, "fr"));
}

const MOTS_ATTENTE = /(en attente|attend(s|ons|ent)?\b|attendre|carottage|livraison|pas livre|manque|client)/;

/**
 * Décisions proposées : tâches en cours depuis ≥ 3 semaines, comptes rendus
 * mentionnant une attente. Chaque proposition a un identifiant stable pour
 * que le conducteur la valide ou l'écarte.
 * @param {Array} rapports  comptes rendus des 5 semaines finissant à la période
 */
export function suggestionsDecisionsV3({ rapports, periode, noms = {} }) {
  const semaineFin = semaineIsoV3(periode.fin);
  const parChantier = new Map();
  const attentes = [];
  for (const r of listeSure(rapports)) {
    const cid = str(r.chantier_id);
    if (!cid) continue;
    const d = dateRapportIsoV3(r.date_rapport);
    const sem = str(r.semaine) || (d ? semaineIsoV3(d) : "");
    if (!parChantier.has(cid)) parChantier.set(cid, new Map());
    const taches = parChantier.get(cid);
    for (const t of listeSure(r.taches)) {
      const libelle = str(t.planifie) || str(t.text);
      if (!libelle || str(t.statut) !== "en_cours") continue;
      const cle = norm(libelle);
      if (!taches.has(cle)) taches.set(cle, { libelle, semaines: new Set() });
      taches.get(cle).semaines.add(sem);
    }
    if (d >= periode.debut && d <= periode.fin) {
      const textes = [str(r.remarque), ...listeSure(r.taches).map(t => str(t.remarque))].filter(Boolean);
      for (const tx of textes) {
        if (MOTS_ATTENTE.test(norm(tx))) {
          attentes.push({ id: `attente:${cid}:${norm(tx).slice(0, 60)}`, type: "attente", chantierId: cid, nom: noms[cid] || cid,
            titre: `${noms[cid] || cid} : attente signalée`, detail: `« ${tx.slice(0, 160)} » (${str(r.ouvrier)}, ${fmtJourV3(d)})` });
        }
      }
    }
  }
  const bloquees = [];
  parChantier.forEach((taches, cid) => taches.forEach((t, cle) => {
    if (t.semaines.has(semaineFin) && t.semaines.size >= 3) {
      bloquees.push({ id: `encours:${cid}:${cle.slice(0, 60)}`, type: "tache_en_cours", chantierId: cid, nom: noms[cid] || cid,
        titre: `${noms[cid] || cid} : « ${t.libelle} » en cours depuis ${t.semaines.size} semaines`, detail: "à débloquer ou à replanifier" });
    }
  }));
  const vus = new Set();
  return [...bloquees, ...attentes].filter(s => (vus.has(s.id) ? false : vus.add(s.id)))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr") || a.type.localeCompare(b.type));
}

/**
 * Tendances par type de lot (tous chantiers).
 * @param {Array}  releves     un relevé par chantier (le plus récent à la date de fin), avec `lots`
 * @param {object} statuts     { [chantierId]: "termine" | ... }
 * @param {string[]} [exclus]  noms de chantiers exclus (reprise d'antériorité)
 */
export function tendancesParLotV3({ releves, statuts = {}, exclus = [], seuilAvancementPct = 25 }) {
  const parLot = new Map();
  const exclusSet = new Set(listeSure(exclus).map(str));
  const reprisExclus = [];
  for (const r of listeSure(releves)) {
    const cid = str(r.chantier_id);
    if (r.chantier_repris === true) { reprisExclus.push(str(r.chantier_nom) || cid); continue; }
    if (exclusSet.has(str(r.chantier_nom)) || exclusSet.has(cid)) continue;
    const termine = statuts[cid] === "termine";
    for (const l of listeSure(r.lots)) {
      if (!l || l.id === "_orphans") continue;
      const av = num(l.avancementExact ?? l.avancement);
      const hr = num(l.heuresReelles), ha = num(l.heuresAttendues);
      if (hr == null || ha == null || !(ha > 0)) continue;
      if (!termine && !(av >= seuilAvancementPct)) continue;
      if (!parLot.has(l.id)) parLot.set(l.id, { id: l.id, label: str(l.label) || l.id, hr: 0, ha: 0, ecartHeures: 0, ecartEuros: 0, chantiers: new Set() });
      const x = parLot.get(l.id);
      x.hr += hr; x.ha += ha; x.ecartHeures += num(l.ecartHeures) || 0; x.ecartEuros += num(l.ecartEuros) || 0;
      x.chantiers.add(cid);
    }
  }
  const lignes = [...parLot.values()].map(x => ({
    id: x.id, label: x.label, nbChantiers: x.chantiers.size,
    derive: round2(x.hr / x.ha), ecartHeures: round2(x.ecartHeures), ecartEuros: round2(x.ecartEuros),
  })).sort((a, b) => b.ecartEuros - a.ecartEuros || a.label.localeCompare(b.label, "fr"));
  const pire = lignes.find(l => l.ecartEuros > 0) || null;
  return {
    lignes, reprisExclus,
    phrase: pire ? `Le lot qui dérive le plus : ${pire.label} (×${String(pire.derive).replace(".", ",")}, ${Math.round(pire.ecartHeures)} h et ${Math.round(pire.ecartEuros).toLocaleString("fr-FR")} € d'écart sur ${pire.nbChantiers} chantier${pire.nbChantiers > 1 ? "s" : ""})` : null,
  };
}

/**
 * La semaine qui vient, à partir du découpage du moteur de planning
 * (bilanSemaineProchaineV1) : une ligne par chantier.
 */
export function semaineQuiVientV3({ decoupe, nomChantier = id => id, nomRessource = id => id, erreur = null }) {
  if (erreur) return { indisponible: `La semaine qui vient n'a pas pu être calculée : ${erreur}` };
  if (!decoupe) return { indisponible: "La semaine qui vient : calcul en cours." };
  const lignes = listeSure(decoupe.par_chantier).map(c => ({
    titre: nomChantier(c.chantier_id),
    detail: [
      listeSure(c.resource_ids).map(nomRessource).join(", ") || "équipe non affectée",
      `${listeSure(c.jours).length} jour${listeSure(c.jours).length > 1 ? "s" : ""}`,
      `${Math.round(num(c.heures_mo) || 0)} h`,
      listeSure(c.taches).length ? `${listeSure(c.taches).length} tâche${listeSure(c.taches).length > 1 ? "s" : ""} prévue${listeSure(c.taches).length > 1 ? "s" : ""}` : null,
    ].filter(Boolean).join(" · "),
  }));
  const au = listeSure(decoupe.chantiers_au_dela_horizon).map(c => nomChantier(c.chantier_id || c));
  if (au.length) lignes.push({ titre: "Au-delà de l'horizon du planning", detail: au.join(", ") });
  return { lignes, fenetre: decoupe.fenetre || null };
}
