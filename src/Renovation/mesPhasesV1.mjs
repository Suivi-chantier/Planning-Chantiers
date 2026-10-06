// ─────────────────────────────────────────────────────────────────────────────
// Mes phases (bêta, espace ouvrier) — calculs de l'écran « Phases ».
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// données arrivent en paramètre : le payload de la RPC ouvrier_mes_phases
// (sql/202610_ouvrier_mes_phases.sql). Façade front : mesPhasesV1.js.
//
// ⚠️ AUCUNE PONDÉRATION RÉÉCRITE ICI.
// L'avancement d'un ouvrage vient de avancementOuvrage (pondéré heures
// estimées), celui d'une phase de statsGroupeChrono (pondéré heures vendues),
// les seuils de dérive de SEUIL_RATIO_DERIVE — tous de chantierFinance, comme
// la fiche chantier bureau, la vue chrono du phasage et le tableau des lots.
// Si un pourcentage diffère de ces écrans, c'est un bug de ce module.
//
// RÈGLES DES HEURES VENDUES (aucune répartition inventée) :
//   - tâche   : taches[].heures_vendues ; 0 → pas de jauge ;
//   - ouvrage : si TOUTES ses tâches sont dans la phase, heures_devis (le
//     chiffre de la fiche chantier) ; s'il est réparti sur plusieurs phases,
//     la somme des heures vendues de SES tâches de la phase. Quand ces tâches
//     n'en portent aucune alors que l'ouvrage en a, la phase n'en reçoit pas :
//     on signale les heures de l'ouvrage entier (`venduesOuvrageEntier`).
//   - phase   : somme de ses ouvrages.
//
// ÉTAT D'UNE TÂCHE (pastille) — seuils EXISTANTS uniquement :
//   ratio de dérive = (heures validées ÷ heures vendues) ÷ (avancement ÷ 100),
//   la formule de chantierFinance (lots). ≤ 1 « Dans le temps », ≤ 1,15
//   « À surveiller », au-delà « Dérive » — les couleurs du tableau des lots
//   (chantierFinanceUI.LotsTableau). Le ratio porte sur les heures VALIDÉES :
//   l'avancement du phasage n'est mis à jour qu'à la validation, comparer des
//   heures pas encore validées à un avancement d'avant serait faux.
//   « Dépassé » compte, lui, validées + en attente : dès que le total déclaré
//   dépasse le vendu, c'est un fait.
// ─────────────────────────────────────────────────────────────────────────────
import { avancementOuvrage, statsGroupeChrono, SEUIL_RATIO_DERIVE, fmtH } from "../chantierFinance.mjs";

export const MES_PHASES_VERSION = "v1";
export const PHASE_A_ORGANISER = "_a_organiser";
export const CODE_BETA_MES_PHASES = "mes_phases";

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const arrondi = (n) => Math.round(n * 100) / 100;

// ── Statut d'avancement (tâche, ouvrage, phase) ─────────────────────────────
// « terminee » : toutes les tâches à 100 % (définition du cycle de vie,
// statsGroupeChrono.termine) ; « a_venir » : rien de fait ni d'heure posée ;
// « en_cours » sinon. Une liste vide n'a pas de statut (« vide »), ce n'est
// pas « à venir ».
export const STATUTS = Object.freeze({
  a_venir:  "À venir",
  en_cours: "En cours",
  terminee: "Terminée",
  vide:     "Aucune tâche",
});

export function statutDesTaches(taches) {
  const list = taches || [];
  if (list.length === 0) return "vide";
  if (list.every(t => num(t.avancement) >= 100)) return "terminee";
  const rien = list.every(t => num(t.avancement) <= 0
    && num(t.heures_validees) <= 0 && num(t.heures_en_attente) <= 0);
  return rien ? "a_venir" : "en_cours";
}

// ── Ratio de dérive (formule des lots de chantierFinance) ───────────────────
// null = indéterminé (pas d'heures vendues ou avancement nul) — jamais 0.
export function ratioDerive(heuresValidees, heuresVendues, avancement) {
  const hv = num(heuresVendues), av = num(avancement);
  return (hv > 0 && av > 0) ? (num(heuresValidees) / hv) / (av / 100) : null;
}

// ── État (pastille) ─────────────────────────────────────────────────────────
// Entrée commune tâche / ouvrage / phase :
//   { vendues, validees, attente, avancement, horsDevis, venduesAilleurs }
// `ton` est un nom, pas une couleur : l'écran choisit couleur ET icône (la
// couleur seule ne porte jamais l'information).
export function etatHeures({ vendues, validees, attente, avancement, horsDevis = false, venduesAilleurs = false }) {
  const hv = num(vendues), hval = num(validees), hatt = num(attente), av = num(avancement);
  const conso = hval + hatt;
  if (horsDevis) return { code: "hors_devis", label: "Hors devis", ton: "bleu", jauge: false };
  if (hv <= 0) {
    if (conso <= 0 && av <= 0) return { code: "a_venir", label: "À venir", ton: "gris", jauge: false };
    return venduesAilleurs
      ? { code: "sans_jauge", label: "Heures vendues sur l'ouvrage", ton: "gris", jauge: false }
      : { code: "sans_jauge", label: "Pas d'heures vendues", ton: "gris", jauge: false };
  }
  if (conso > hv + 1e-9) {
    return { code: "depasse", label: `Dépassé +${fmtH(arrondi(conso - hv))} h`, ton: "rouge", jauge: true, depassement: arrondi(conso - hv) };
  }
  if (conso <= 0 && av <= 0) return { code: "a_venir", label: "À venir", ton: "gris", jauge: true };
  const r = ratioDerive(hval, hv, av);
  if (r == null) {
    // Des heures sont posées mais l'avancement est à 0 : la dérive ne peut
    // pas se calculer. On le dit, on n'affiche pas « dans le temps ».
    return { code: "sans_avancement", label: "Avancement pas encore saisi", ton: "gris", jauge: true };
  }
  if (r <= 1) return { code: "dans_le_temps", label: "Dans le temps", ton: "vert", jauge: true, ratio: r };
  if (r <= SEUIL_RATIO_DERIVE) return { code: "a_surveiller", label: "À surveiller", ton: "orange", jauge: true, ratio: r };
  return { code: "derive", label: "Dérive", ton: "rouge", jauge: true, ratio: r };
}

// ── Dates ───────────────────────────────────────────────────────────────────
function bornesDates(taches) {
  const ds = (taches || []).map(t => String(t.date_prevue || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return { dateMin: ds[0] || null, dateMax: ds[ds.length - 1] || null };
}
function personnes(taches) {
  const s = new Set();
  (taches || []).forEach(t => (Array.isArray(t.ouvriers) ? t.ouvriers : []).forEach(o => { if (o) s.add(String(o)); }));
  return [...s];
}

// ── Tâche ───────────────────────────────────────────────────────────────────
export function enrichirTache(t, ouvrage) {
  const vendues = num(t.heures_vendues);
  const validees = num(t.heures_validees);
  const attente = num(t.heures_en_attente);
  const avancement = Math.max(0, Math.min(100, num(t.avancement)));
  const venduesAilleurs = vendues <= 0 && !t.hors_devis && num(ouvrage?.heures_vendues_ouvrage) > 0;
  const etat = etatHeures({ vendues, validees, attente, avancement, horsDevis: !!t.hors_devis, venduesAilleurs });
  return {
    ...t,
    avancement,
    vendues, validees, attente,
    consommees: arrondi(validees + attente),
    miennes: num(t.mes_heures),
    // Pas de « reste » sur une tâche terminée : les heures non consommées
    // d'une tâche finie ne sont pas du travail qui reste.
    reste: vendues > 0 && avancement < 100 ? Math.max(0, arrondi(vendues - validees - attente)) : null,
    statut: statutDesTaches([t]),
    venduesAilleurs,
    etat,
  };
}

// ── Ouvrage, tel qu'il apparaît dans UNE phase ─────────────────────────────
export function agregerOuvrage(o) {
  const taches = (o.taches || []).map(t => enrichirTache(t, o));
  const sommeVenduesTaches = taches.reduce((s, t) => s + t.vendues, 0);
  const heuresDevis = num(o.heures_vendues_ouvrage);
  let vendues, venduesOuvrageEntier = null;
  if (o.ouvrage_complet) {
    // L'ouvrage entier est ici : le chiffre de la fiche chantier.
    vendues = heuresDevis > 0 ? heuresDevis : sommeVenduesTaches;
  } else {
    vendues = sommeVenduesTaches;
    if (sommeVenduesTaches <= 0 && heuresDevis > 0) venduesOuvrageEntier = heuresDevis;
  }
  const validees = taches.reduce((s, t) => s + t.validees, 0);
  const attente = taches.reduce((s, t) => s + t.attente, 0);
  // avancementOuvrage lit avancement + heures_estimees : les tâches DE LA PHASE.
  const avancement = taches.length ? avancementOuvrage({ taches }) : 0;
  const horsDevis = taches.length > 0 && taches.every(t => t.hors_devis);
  return {
    id: o.id, libelle: o.libelle, quantite: o.quantite, unite: o.unite,
    ouvrageComplet: !!o.ouvrage_complet,
    taches,
    vendues: arrondi(vendues), venduesOuvrageEntier,
    validees: arrondi(validees), attente: arrondi(attente),
    consommees: arrondi(validees + attente),
    miennes: arrondi(taches.reduce((s, t) => s + t.miennes, 0)),
    avancement,
    statut: statutDesTaches(taches),
    ...bornesDates(taches),
    personnes: personnes(taches),
    estMien: taches.some(t => t.est_mienne === true),
    etat: etatHeures({ vendues, validees, attente, avancement, horsDevis, venduesAilleurs: venduesOuvrageEntier != null }),
  };
}

// ── Phase ───────────────────────────────────────────────────────────────────
export function agregerPhase(ph) {
  const ouvrages = (ph.ouvrages || []).map(agregerOuvrage);
  const toutes = ouvrages.flatMap(o => o.taches);
  // statsGroupeChrono filtre sur chrono_groupe_id : « À organiser » regroupe
  // des tâches sans groupe valide, on leur donne donc l'id de la phase.
  const stats = statsGroupeChrono(ph.id, [{ taches: toutes.map(t => ({
    chrono_groupe_id: ph.id, avancement: t.avancement, heures_vendues: t.vendues,
  })) }]);
  const vendues = ouvrages.reduce((s, o) => s + o.vendues, 0);
  const validees = ouvrages.reduce((s, o) => s + o.validees, 0);
  const attente = ouvrages.reduce((s, o) => s + o.attente, 0);
  const horsDevis = toutes.length > 0 && toutes.every(t => t.hors_devis);
  return {
    id: ph.id, nom: ph.nom, ordre: ph.ordre, couleur: ph.couleur,
    synthetique: !!ph.synthetique,
    ouvrages,
    nbTaches: toutes.length,
    vendues: arrondi(vendues), validees: arrondi(validees), attente: arrondi(attente),
    consommees: arrondi(validees + attente),
    avancement: stats.avancement,
    statut: statutDesTaches(toutes),
    ...bornesDates(toutes),
    personnes: personnes(toutes),
    estMienne: toutes.some(t => t.est_mienne === true),
    etat: etatHeures({ vendues, validees, attente, avancement: stats.avancement, horsDevis,
      venduesAilleurs: ouvrages.some(o => o.venduesOuvrageEntier != null) }),
  };
}

// ── Point d'entrée ──────────────────────────────────────────────────────────
// Rend { etat, modele, prenom, phases, nbMiennes, nbTout, phaseEnCoursId }.
// etat : "acces_refuse" | "absent" | "ambigu" | "legacy_v1" | "vide" |
//        "sans_groupes" (tout dans « À organiser ») | "ok".
export function construireMesPhases(payload) {
  if (!payload || typeof payload !== "object") {
    return { etat: "absent", modele: null, prenom: null, phases: [], nbMiennes: 0, nbTout: 0, phaseEnCoursId: null };
  }
  if (payload.acces_refuse) {
    return { etat: "acces_refuse", modele: null, prenom: null, phases: [], nbMiennes: 0, nbTout: 0, phaseEnCoursId: null };
  }
  const modele = payload.modele || "absent";
  const brutes = Array.isArray(payload.phases) ? payload.phases : [];
  const phases = brutes.map(agregerPhase);
  // « Ensuite » : la phase réelle suivante dans l'ordre chrono (jamais
  // « À organiser », qui n'est pas une étape du chantier).
  const reelles = phases.filter(p => !p.synthetique);
  phases.forEach(p => {
    const i = reelles.indexOf(p);
    p.suivante = i >= 0 && i < reelles.length - 1 ? { id: reelles[i + 1].id, nom: reelles[i + 1].nom } : null;
  });
  const enCours = reelles.find(p => p.statut === "en_cours")
    || reelles.find(p => p.statut === "a_venir")
    || phases.find(p => p.statut === "en_cours")
    || null;
  let etat = modele === "v2" ? "ok" : modele;
  if (modele === "v2" && reelles.length === 0) etat = "sans_groupes";
  return {
    etat, modele,
    prenom: payload.prenom || null,
    chantierNom: payload.chantier_nom || null,
    phases,
    nbMiennes: phases.filter(p => p.estMienne).length,
    nbTout: phases.length,
    phaseEnCoursId: enCours ? enCours.id : null,
  };
}

export function filtrerPhases(resultat, vue) {
  const phases = resultat?.phases || [];
  return vue === "miennes" ? phases.filter(p => p.estMienne) : phases;
}

// ── Chantier proposé par défaut ─────────────────────────────────────────────
// Date ISO (AAAA-MM-JJ) d'une cellule de planning (week_id ISO + jour).
const JOUR_INDEX = { Lundi: 0, Mardi: 1, Mercredi: 2, Jeudi: 3, Vendredi: 4, Samedi: 5, Dimanche: 6 };
export function dateCellule(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(weekId || ""));
  if (!m || !(jour in JOUR_INDEX)) return null;
  const annee = +m[1], semaine = +m[2];
  const j4 = new Date(Date.UTC(annee, 0, 4));
  const lundiS1 = Date.UTC(annee, 0, 4) - ((j4.getUTCDay() + 6) % 7) * 86400000;
  const d = new Date(lundiS1 + ((semaine - 1) * 7 + JOUR_INDEX[jour]) * 86400000);
  return d.toISOString().slice(0, 10);
}

// Le chantier où l'ouvrier est planifié aujourd'hui, sinon celui de sa
// dernière journée planifiée (passée), sinon null — l'écran prend alors le
// premier chantier en cours de la liste. Un ouvrier est « sur » une cellule
// s'il figure dans les ouvriers de la cellule ou d'une de ses lignes.
export function choisirChantierParDefaut({ cellules, prenom, aujourdhuiISO }) {
  if (!prenom || !aujourdhuiISO) return null;
  const miennes = (cellules || [])
    .filter(c => c && c.chantier_id)
    .filter(c => (Array.isArray(c.ouvriers) && c.ouvriers.includes(prenom))
      || (Array.isArray(c.taches) && c.taches.some(t => Array.isArray(t?.ouvriers) && t.ouvriers.includes(prenom))))
    .map(c => ({ chantier_id: c.chantier_id, date: dateCellule(c.week_id, c.jour) }))
    .filter(c => c.date && c.date <= aujourdhuiISO)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return miennes.length ? miennes[0].chantier_id : null;
}

// Prénom affiché : « Toi » pour l'ouvrier connecté.
export function libellePersonnes(liste, prenom) {
  const l = (liste || []).filter(Boolean);
  const moi = l.filter(n => n === prenom).map(() => "Toi");
  return [...moi, ...l.filter(n => n !== prenom)].join(", ");
}

// ── Recherche (panneau « J'ai fait autre chose » du compte rendu) ───────────
// Garde, dans chaque phase, les ouvrages dont le libellé correspond (avec
// toutes leurs tâches) ou les tâches dont le nom correspond. Accents, casse
// et espaces ignorés. Les totaux d'une phase restent ceux de la phase entière.
const normRecherche = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
export function rechercherDansPhases(phases, texte) {
  const q = normRecherche(texte);
  if (!q) return phases || [];
  return (phases || []).map(p => {
    const ouvrages = (p.ouvrages || []).map(o => {
      if (normRecherche(o.libelle).includes(q)) return o;
      const taches = (o.taches || []).filter(t => normRecherche(t.nom).includes(q));
      return taches.length ? { ...o, taches } : null;
    }).filter(Boolean);
    return ouvrages.length ? { ...p, ouvrages } : null;
  }).filter(Boolean);
}
