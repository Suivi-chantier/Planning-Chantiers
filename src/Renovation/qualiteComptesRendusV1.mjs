// ─────────────────────────────────────────────────────────────────────────────
// « Qualité des comptes rendus » — indicateurs sur les comptes rendus du soir,
// par ouvrier, par version du formulaire et au total, pour une période.
// Module PUR (façade qualiteComptesRendusV1.js) : aucun accès Supabase, aucune
// horloge ; tout arrive en paramètre, déjà lu. Il sert :
//   - la page bureau « Qualité des comptes rendus » (période + tendance) ;
//   - le diagnostic chiffré du 24/10/2026 (mêmes calculs, vraies données) ;
//   - le compteur « tâches regroupées » de la Validation (prompt CR-5) :
//     lignes découpées à la validation, par ouvrier et par mois.
//
// CE QUE LA BASE GARDE, donc ce qu'on peut mesurer :
//   rapports.taches     la déclaration de l'ouvrier. La validation ne la
//                       réécrit JAMAIS (seule exception : la bascule d'heures
//                       vers un autre chantier, tracée par `bascules` sur la
//                       ligne d'origine et `bascule_depuis` sur la ligne créée).
//   pointages           ce que le conducteur a validé : heures par tâche.
//                       Comparés à la déclaration, ils disent quelles lignes
//                       ont été réaffectées, découpées ou corrigées.
//   avancementsValides  l'avancement retenu à la validation n'est écrit QUE
//                       dans le phasage, donc dans le journal d'avancement
//                       daté (étape 1C) : avancementsValidesDepuisJournal()
//                       le relit, pour les validations faites depuis la mise
//                       en service du journal (24/10/2026).
//                       Absent (null) → l'indicateur est « indisponible »,
//                       jamais « 0 ».
//   historique          anciennes versions des rapports (data_history) :
//                       [{ row_id, saved_at, statut }]. Un passage « validé »
//                       → « en attente » = rapport rouvert (« Corriger »).
//   tachesHorsDevis     ids des tâches marquées hors devis dans les phasages.
//
// RÈGLE COMMUNE : une donnée absente donne un indicateur « indisponible » avec
// sa raison ; une part sans aucune ligne concernée a un taux null (affiché
// « — »), jamais 0 %.
// ─────────────────────────────────────────────────────────────────────────────
import { horsDevisParDefaut } from "./motifsCompteRendu.mjs";
import { etatTachesALaDate } from "../chantierFinance.mjs";

const texte = (v) => String(v ?? "").trim();
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const nombreOuNull = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const arrondi = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

// ── Seuils (documentés sur la page) ─────────────────────────────────────────
export const SEUILS = Object.freeze({
  remarqueCourte: 15,        // caractères : « En cours », « À finir », « . »
  grosseLignePart: 0.8,      // une ligne qui porte ≥ 80 % des heures de la journée…
  grosseLigneJourneeMin: 6,  // … d'une journée d'au moins 6 h
  ecartHeures: 0.01,         // tolérance sur les heures (centième)
  envoiEcartMin: 5,          // deux envois du même jour à plus de 5 min = deux envois
  anomalieTempsMin: -5,      // début de saisie après l'envoi de plus de 5 min : horloge du téléphone fausse
});

export const VERSION_V1 = "v1";
export const VERSION_V2 = "v2";
export const versionRapport = (r) => (r?.formulaire_version === VERSION_V2 ? VERSION_V2 : VERSION_V1);

// « 12/10/2026 » ou « 2026-10-12… » → « 2026-10-12 » ; null si illisible.
export function isoDate(d) {
  const s = texte(d);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Date et heure à Paris d'un horodatage (conversion de fuseau, pas d'horloge).
const FMT_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function heureParis(horodatage) {
  const d = new Date(horodatage);
  if (!horodatage || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(FMT_PARIS.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour), minute: Number(p.minute) };
}

// ── Statistiques ────────────────────────────────────────────────────────────
export function mediane(valeurs) {
  const v = (valeurs || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
// Centile « au rang le plus proche » : la valeur sous laquelle se trouvent au
// moins p % des mesures (80e centile de 10 mesures = la 8e).
export function centile(valeurs, p) {
  const v = (valeurs || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}
export const part = (n, d) => ({ n, d, taux: d > 0 ? n / d : null });

// ── Intitulé qui énumère plusieurs travaux ──────────────────────────────────
// Familles de travaux reconnues par des débuts de mots (sans accents). Un
// intitulé est découpé en morceaux (virgule, « + », « / », « ; », « et »,
// « puis ») ; il énumère plusieurs travaux quand au moins deux morceaux
// apportent chacun un métier différent (« Démolition ménage et pvc »,
// « La plomberie, boucher les trous et le ménage »). Ne comptent pas :
// « Bandes et enduits fermeture placo » (même métier), « Passer alim PER
// appt 6 et 7 » (un seul métier), « Ponçage béton ménage » (aucune
// énumération). Estimation par mots-clés, vérifiée sur les vrais intitulés.
export const FAMILLES_TRAVAUX = Object.freeze({
  demolition: ["demol", "casse", "depose", "arrach", "piquage", "decroutage", "decoll"],
  poncage: ["ponc"],
  peinture: ["peint", "sous couche", "lasure", "vernis"],
  platrerie: ["placo", "plaquo", "ba13", "plaquage", "placage", "cloison", "ossature", "doublage", "faux plafond",
    "enduit", "bandes", "lissage", "ratiss", "rebouch", "isol", "laine"],
  carrelage: ["carrel", "faience", "credence"],
  sol: ["ragreage", "balatum", "ballatum", "sol souple", "parquet", "lino", "tomette"],
  plomberie: ["plomb", "alim", "arrivee d eau", "per ", "pvc", "robinet", "wc", "lavabo", "vasque", "receveur",
    "bac a douche", "bacs a douche", "ballon", "chauffe eau", "nourri", "siphon", "socarex", "evier"],
  electricite: ["elec", "cabl", "prise", "interrupteur", "luminaire", "spot", "gaine", "goulotte", "vmc"],
  menuiserie: ["porte", "plinthe", "menuis", "fenetre", "placard", "meuble", "osb"],
  nettoyage: ["nettoy", "menage", "dechet", "decheterie", "lessiv", "aspir", "rangement", "ranger"],
  maconnerie: ["beton", "mortier", "chape", "parpaing", "macon", "carott", "saignee", "scell", "dalle"],
  joints: ["silicone", "acrylique", "mastic"],
  manutention: ["chargement", "decharg", "appro", "livraison", "recuper", "marchandise"],
  protection: ["protection", "proteg", "bache"],
});
const sansAccents = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function famillesTravaux(t) {
  const s = ` ${sansAccents(t).replace(/[^a-z0-9]+/g, " ")} `;
  return Object.entries(FAMILLES_TRAVAUX)
    .filter(([, racines]) => racines.some(r => s.includes(` ${r}`)))
    .map(([f]) => f);
}
export function decritPlusieursTravaux(t) {
  const morceaux = sansAccents(t).split(/[,;+/\n]|\s(?:et|puis)\s/);
  const vus = new Set();
  let apports = 0;
  morceaux.forEach(m => {
    const nouvelles = famillesTravaux(m).filter(f => !vus.has(f));
    if (nouvelles.length > 0) apports++;
    nouvelles.forEach(f => vus.add(f));
  });
  return apports >= 2;
}

// ── Lignes ──────────────────────────────────────────────────────────────────
// Heures déclarées par l'ouvrier (avant une éventuelle bascule).
const heuresDeclarees = (t) => num(t?.heures_declarees_origine ?? t?.heures_reelles);
const estLigneOuvrier = (t) => !t?.bascule_depuis;     // les lignes créées par une bascule sont du conducteur
// Rapport créé de toutes pièces par une bascule (aucune ligne de l'ouvrier).
const estRapportBascule = (r) => (r?.taches || []).length > 0 && (r.taches || []).every(t => t?.bascule_depuis);
const tid = (t) => (t?.tache_id ? String(t.tache_id) : null);

// Comparaison déclaration ↔ pointages d'un rapport validé.
// Rend null si on ne peut pas comparer (pointages non fournis, rapport non
// validé, ou rapport validé sans aucun pointage alors qu'il déclarait des heures).
//   parTache        { [tache_id]: { reaffectee, heuresModifiees } } pour les tâches déclarées
//   lignesCreees    lignes de tâche en plus à la validation, à heures égales ou
//                   inférieures : le conducteur a réparti des heures sur plus
//                   de tâches que l'ouvrier n'en avait envoyé
//   decoupes        lignes de l'ouvrier ainsi découpées (une ligne de 6 h
//                   répartie sur 5 tâches = 1 ligne découpée, 4 lignes créées) :
//                   au plus une par ligne créée, au plus le nombre de lignes
//                   qui ont perdu des heures (lignes sans tâche comprises)
//   ajoutees        lignes en plus avec des heures en plus (ajout, pas découpage)
//   rattachees      lignes sans tâche du phasage rattachées à une tâche
export function comparerAuxPointages(rapport, pointagesDuRapport) {
  if (!pointagesDuRapport || rapport?.statut !== "valide") return null;
  const declTache = new Map();
  let declLibres = 0, sommeDecl = 0;
  (rapport.taches || []).forEach(t => {
    const h = num(t.heures_reelles);   // après bascule : ce qui restait à valider ici
    if (h <= 0) return;
    sommeDecl += h;
    const k = tid(t);
    if (k) declTache.set(k, (declTache.get(k) || 0) + h); else declLibres++;
  });
  const ptTache = new Map();
  let ptLibres = 0, sommePt = 0, nbPointages = 0;
  (pointagesDuRapport || []).forEach(p => {
    nbPointages++;
    if (p.type_pointage && p.type_pointage !== "tache") return;
    const h = num(p.heures);
    if (h <= 0) return;
    sommePt += h;
    const k = p.tache_id ? String(p.tache_id) : null;
    if (k) ptTache.set(k, (ptTache.get(k) || 0) + h); else ptLibres++;
  });
  if (nbPointages === 0 && sommeDecl > 0) return null;
  const parTache = {};
  declTache.forEach((h, k) => {
    const hp = ptTache.get(k) || 0;
    parTache[k] = { reaffectee: hp <= 0, heuresModifiees: hp > 0 && Math.abs(hp - h) > SEUILS.ecartHeures };
  });
  const extra = (ptTache.size + ptLibres) - (declTache.size + declLibres);
  const aHeuresEgales = sommePt <= sommeDecl + SEUILS.ecartHeures;
  const ontPerdu = declLibres + [...declTache].filter(([k, h]) => (ptTache.get(k) || 0) < h - SEUILS.ecartHeures).length;
  const lignesCreees = extra > 0 && aHeuresEgales ? extra : 0;
  return {
    parTache,
    lignesCreees,
    decoupes: lignesCreees > 0 ? Math.max(1, Math.min(lignesCreees, ontPerdu)) : 0,
    ajoutees: extra > 0 && !aHeuresEgales ? extra : 0,
    rattachees: Math.max(0, declLibres - ptLibres),
  };
}

// Rapport rouvert après validation : un état « valide » suivi d'un état qui
// ne l'est plus, dans la suite (anciennes versions triées, puis version actuelle).
export function nombreReouvertures(rapport, versionsAnciennes) {
  const etats = [...(versionsAnciennes || [])]
    .sort((a, b) => String(a.saved_at).localeCompare(String(b.saved_at)))
    .map(v => v.statut || null);
  etats.push(rapport?.statut || null);
  let n = 0;
  for (let i = 1; i < etats.length; i++) if (etats[i - 1] === "valide" && etats[i] !== "valide") n++;
  return n;
}
const aEteValide = (rapport, versionsAnciennes) =>
  rapport?.statut === "valide" || (versionsAnciennes || []).some(v => v.statut === "valide");

// ── Envois ──────────────────────────────────────────────────────────────────
// Un envoi = un appui sur « Valider mon compte rendu » : tous les rapports
// (un par chantier) d'un ouvrier, pour une date, partis ensemble.
function construireEnvois(rapports) {
  const parJour = new Map();
  rapports.forEach(r => {
    const k = `${r.ouvrier}|${r._date}`;
    if (!parJour.has(k)) parJour.set(k, []);
    parJour.get(k).push(r);
  });
  const envois = [];
  parJour.forEach(liste => {
    const tri = [...liste].sort((a, b) => String(a.submitted_at || "").localeCompare(String(b.submitted_at || "")));
    let courant = null;
    tri.forEach(r => {
      const t = r.submitted_at ? new Date(r.submitted_at).getTime() : null;
      const nouveau = !courant
        || (t != null && courant.fin != null && (t - courant.fin) / 60000 > SEUILS.envoiEcartMin)
        || (r.saisie_debut_le || null) !== courant.saisieDebut;
      if (nouveau) {
        courant = { rapports: [], ouvrier: r.ouvrier, date: r._date, version: VERSION_V1, saisieDebut: r.saisie_debut_le || null, fin: null, finISO: null };
        envois.push(courant);
      }
      courant.rapports.push(r);
      if (versionRapport(r) === VERSION_V2) courant.version = VERSION_V2;
      if (t != null && (courant.fin == null || t > courant.fin)) { courant.fin = t; courant.finISO = r.submitted_at; }
    });
  });
  return envois.map(e => {
    const paris = e.finISO ? heureParis(e.finISO) : null;
    const rattrapage = !!(paris && e.date && paris.date > e.date);
    let minutes = null, anomalie = false;
    if (e.version === VERSION_V2 && e.saisieDebut && e.fin != null) {
      const debut = new Date(e.saisieDebut).getTime();
      if (Number.isFinite(debut)) {
        const m = (e.fin - debut) / 60000;
        if (m < SEUILS.anomalieTempsMin) anomalie = true; else minutes = Math.max(0, m);
      }
    }
    return { ouvrier: e.ouvrier, date: e.date, version: e.version, rapportIds: e.rapports.map(r => r.id), heure: paris, rattrapage, minutes, anomalie };
  });
}

export const TRANCHES_HEURE = Object.freeze([
  { cle: "avant16", label: "avant 16 h", de: 0, a: 16 },
  { cle: "16h", label: "16 h – 17 h", de: 16, a: 17 },
  { cle: "17h", label: "17 h – 18 h", de: 17, a: 18 },
  { cle: "18h", label: "18 h – 19 h", de: 18, a: 19 },
  { cle: "19h", label: "19 h – 21 h", de: 19, a: 21 },
  { cle: "21h", label: "21 h et après", de: 21, a: 24 },
]);
const trancheHeure = (h) => TRANCHES_HEURE.find(t => h >= t.de && h < t.a)?.cle || null;

// ── Faits élémentaires ──────────────────────────────────────────────────────
// Une ligne par ligne d'ouvrier, un fait par envoi, un fait par rapport.
export function faitsComptesRendus({
  rapports = [], pointages = null, historique = null, avancementsValides = null, tachesHorsDevis = null,
  debut = null, fin = null,
}) {
  const dansPeriode = (d) => !!d && (!debut || d >= debut) && (!fin || d <= fin);
  const rs = (rapports || [])
    .map(r => ({ ...r, _date: isoDate(r.date_rapport) }))
    .filter(r => dansPeriode(r._date) && !estRapportBascule(r));

  const ptParRapport = pointages ? new Map() : null;
  if (pointages) pointages.forEach(p => {
    if (!p?.rapport_id) return;
    const k = String(p.rapport_id);
    if (!ptParRapport.has(k)) ptParRapport.set(k, []);
    ptParRapport.get(k).push(p);
  });
  const histParRapport = historique ? new Map() : null;
  if (historique) historique.forEach(h => {
    const k = String(h.row_id);
    if (!histParRapport.has(k)) histParRapport.set(k, []);
    histParRapport.get(k).push(h);
  });
  const horsDevis = tachesHorsDevis ? new Set([...tachesHorsDevis].map(String)) : null;

  // Heures de la journée de chaque ouvrier (tous chantiers, hors trajet).
  const heuresJour = new Map();
  rs.forEach(r => {
    const k = `${r.ouvrier}|${r._date}`;
    const h = (r.taches || []).filter(estLigneOuvrier).reduce((s, t) => s + heuresDeclarees(t), 0)
      + (r.heures_indirectes || []).reduce((s, x) => s + num(x?.heures), 0);
    heuresJour.set(k, (heuresJour.get(k) || 0) + h);
  });

  const faitsRapports = [];
  const lignes = [];
  rs.forEach(r => {
    const version = versionRapport(r);
    const comparaison = ptParRapport ? comparerAuxPointages(r, ptParRapport.get(String(r.id)) || []) : null;
    const versions = histParRapport ? (histParRapport.get(String(r.id)) || []) : null;
    faitsRapports.push({
      id: r.id, ouvrier: r.ouvrier, date: r._date, version, valide: r.statut === "valide",
      remarqueVide: !texte(r.remarque),
      comparable: !!comparaison, decoupes: comparaison?.decoupes || 0, lignesCreees: comparaison?.lignesCreees || 0,
      ajoutees: comparaison?.ajoutees || 0, rattachees: comparaison?.rattachees || 0,
      dejaValide: versions ? aEteValide(r, versions) : null,
      reouvertures: versions ? nombreReouvertures(r, versions) : null,
    });
    const jour = heuresJour.get(`${r.ouvrier}|${r._date}`) || 0;
    (r.taches || []).forEach((t, idx) => {
      if (!estLigneOuvrier(t)) return;
      const h = heuresDeclarees(t);
      const k = tid(t);
      const avDecl = nombreOuNull(t.avancement);
      const avVal = k && avancementsValides ? nombreOuNull(avancementsValides?.[r.id]?.[k]) : null;
      const cmp = k && comparaison ? comparaison.parTache[k] : null;
      const nouvelle = version === VERSION_V2 && t.origine === "nouvelle";
      const terminee = t.statut === "faite" && !t.bloque;
      lignes.push({
        rapportId: r.id, ouvrier: r.ouvrier, date: r._date, chantierId: r.chantier_id, version, idx,
        tacheId: k, heures: h, travaillee: h > 0, valide: r.statut === "valide",
        statut: t.statut || null, terminee, bloque: t.bloque === true,
        // Écart d'avancement : ligne validée, tâche gardée par le conducteur.
        avDeclare: avDecl,
        avValide: r.statut === "valide" && h > 0 && avDecl != null && avVal != null && !(cmp && cmp.reaffectee) ? avVal : null,
        reaffectee: !!(cmp && cmp.reaffectee && num(t.heures_reelles) > 0),
        heuresModifiees: !!(cmp && cmp.heuresModifiees),
        basculee: Array.isArray(t.bascules) && t.bascules.length > 0,
        sansTache: !k,
        // Nouveau formulaire : d'où vient une ligne sans tâche du phasage ?
        // « planning » = case du planning écrite sans lien vers le phasage.
        sansTacheOrigine: version === VERSION_V2 && !k
          ? (t.origine === "libre" || t.origine === "nouvelle" ? t.origine : "planning") : null,
        texteLibre: version === VERSION_V2 ? (!k && t.origine === "libre") : null,
        nouvelle: version === VERSION_V2 ? nouvelle : null,
        horsDevis: horsDevis
          ? (k && horsDevis.has(k))
            || (nouvelle && (horsDevis.has(`nt-${r.id}-${idx}`) || horsDevisParDefaut(t.proposition?.nature) === true))
          : null,
        quantite: t.quantite_jour != null && t.quantite_jour !== "",
        grosseLigne: h > 0 && jour >= SEUILS.grosseLigneJourneeMin && h >= SEUILS.grosseLignePart * jour - SEUILS.ecartHeures,
        // Seul l'intitulé écrit par l'ouvrier compte (celui d'une tâche du
        // phasage est écrit par le bureau ; la remarque, elle, détaille souvent
        // les étapes d'une même tâche).
        plusieursTravaux: !k && decritPlusieursTravaux(t.planifie),
        remarque: texte(t.remarque),
        sansPhoto: terminee && !(Array.isArray(t.photos) && t.photos.length > 0),
      });
    });
  });

  // Tâche faite à plusieurs le même jour : avancements déclarés comparés
  // (lignes en quantité exclues : chacun déclare SA quantité, l'avancement
  // affiché n'inclut pas celle du collègue).
  const groupes = new Map();
  lignes.forEach(l => {
    if (!l.tacheId || !l.travaillee || l.avDeclare == null || l.quantite) return;
    const k = `${l.chantierId}|${l.date}|${l.tacheId}`;
    if (!groupes.has(k)) groupes.set(k, new Map());
    const g = groupes.get(k);
    g.set(l.ouvrier, Math.max(g.get(l.ouvrier) ?? -Infinity, l.avDeclare));
  });
  const groupesPlusieurs = new Map();
  groupes.forEach((g, k) => {
    if (g.size < 2) return;
    const v = [...g.values()];
    groupesPlusieurs.set(k, { ouvriers: [...g.keys()], ecart: Math.max(...v) - Math.min(...v) });
  });
  lignes.forEach(l => {
    const k = l.tacheId ? `${l.chantierId}|${l.date}|${l.tacheId}` : null;
    l.groupePlusieurs = k && groupesPlusieurs.has(k) && l.travaillee && l.avDeclare != null && !l.quantite ? k : null;
  });

  return {
    lignes, rapports: faitsRapports, envois: construireEnvois(rs), groupesPlusieurs,
    disponibles: {
      pointages: !!pointages, historique: !!historique, avancements: !!avancementsValides, horsDevis: !!horsDevis,
    },
  };
}

// ── Agrégation ──────────────────────────────────────────────────────────────
const INDISPO = {
  pointages: "Pointages non lus : impossible de comparer la déclaration à la validation.",
  historique: "Historique des rapports non lu : impossible de savoir s'ils ont été rouverts.",
  avancements: "Journal d'avancement non lu : impossible de connaître l'avancement retenu à la validation.",
  horsDevis: "Phasages non lus : impossible de savoir quelles tâches sont hors devis.",
};
const indisponible = (raison) => ({ indisponible: raison });

// Agrège les faits d'un ouvrier et/ou d'un formulaire (null = tous). Les
// tâches faites à plusieurs retenues sont celles où le filtre a une ligne.
export function agreger(faits, { ouvrier = null, version = null } = {}) {
  const okO = (x) => (!ouvrier || x.ouvrier === ouvrier) && (!version || x.version === version);
  const L = faits.lignes.filter(okO);
  const T = L.filter(l => l.travaillee);
  const E = faits.envois.filter(okO);
  const R = faits.rapports.filter(okO);
  const d = faits.disponibles;

  // Temps de remplissage (nouveau formulaire, hors rattrapage).
  const mesurables = E.filter(e => e.version === VERSION_V2 && !e.rattrapage);
  const minutes = mesurables.map(e => e.minutes).filter(m => m != null);
  const tempsRemplissage = {
    n: minutes.length,
    nonMesures: E.filter(e => e.version === VERSION_V1).length,
    rattrapagesExclus: E.filter(e => e.version === VERSION_V2 && e.rattrapage).length,
    anomalies: mesurables.filter(e => e.anomalie).length,
    medianeMin: arrondi(mediane(minutes)),
    p80Min: arrondi(centile(minutes, 80)),
    plusDeUneHeure: part(minutes.filter(m => m > 60).length, minutes.length),
    moinsDe10Min: part(minutes.filter(m => m < 10).length, minutes.length),
  };

  const horsRattrapage = E.filter(e => !e.rattrapage && e.heure);
  const heureEnvoi = TRANCHES_HEURE.map(t => ({ cle: t.cle, label: t.label, nb: horsRattrapage.filter(e => trancheHeure(e.heure.heure) === t.cle).length }));

  // Écart d'avancement déclaré / validé.
  let ecartAvancement;
  if (!d.avancements) ecartAvancement = indisponible(INDISPO.avancements);
  else {
    const ecarts = T.filter(l => l.avValide != null).map(l => l.avValide - l.avDeclare);
    ecartAvancement = {
      n: ecarts.length,
      moyenneAbs: ecarts.length ? arrondi(ecarts.reduce((s, e) => s + Math.abs(e), 0) / ecarts.length) : null,
      moyenneSignee: ecarts.length ? arrondi(ecarts.reduce((s, e) => s + e, 0) / ecarts.length) : null,
      modifiees: part(ecarts.filter(e => Math.abs(e) >= 1).length, ecarts.length),
      hausses: ecarts.filter(e => e >= 1).length,
      baisses: ecarts.filter(e => e <= -1).length,
      ecartsDe10ouPlus: part(ecarts.filter(e => Math.abs(e) >= 10).length, ecarts.length),
    };
  }

  // Validation : réaffectées, découpées, heures corrigées (rapports comparables).
  const Rc = R.filter(r => r.comparable);
  const idsRc = new Set(Rc.map(r => String(r.id)));
  const Tc = T.filter(l => idsRc.has(String(l.rapportId)));
  const somme = (cle) => Rc.reduce((s, r) => s + r[cle], 0);
  const siPointages = (f) => (d.pointages ? f() : indisponible(INDISPO.pointages));
  const reaffectees = siPointages(() => part(Tc.filter(l => l.reaffectee).length, Tc.length));
  const decoupees = siPointages(() => ({ ...part(somme("decoupes"), Tc.length), lignesCreees: somme("lignesCreees") }));
  const heuresModifiees = siPointages(() => part(Tc.filter(l => l.heuresModifiees).length, Tc.length));
  const rattachees = siPointages(() => part(somme("rattachees"), Tc.filter(l => l.sansTache).length));
  const lignesAjoutees = d.pointages ? somme("ajoutees") : null;

  const v2 = T.filter(l => l.version === VERSION_V2);
  const v2Sans = v2.filter(l => l.sansTache);
  const sansTacheV2 = { planning: 0, libre: 0, nouvelle: 0 };
  v2Sans.forEach(l => { sansTacheV2[l.sansTacheOrigine]++; });
  const sansObjetV1 = T.length - v2.length;
  const remarquesNonTerminees = T.filter(l => !l.terminee);
  const terminees = T.filter(l => l.terminee);

  // Corrections après validation.
  let corriges;
  if (!d.historique) corriges = indisponible(INDISPO.historique);
  else {
    const valides = R.filter(r => r.dejaValide);
    corriges = part(valides.filter(r => r.reouvertures > 0).length, valides.length);
  }

  // Tâches faites à plusieurs : groupes où l'ouvrier (ou le filtre) a une ligne.
  const cles = new Set(L.map(l => l.groupePlusieurs).filter(Boolean));
  const groupes = [...cles].map(k => faits.groupesPlusieurs.get(k));
  const differents = groupes.filter(g => g.ecart >= 1);
  const plusieurs = {
    ...part(differents.length, groupes.length),
    ecartMoyenSiDifferent: differents.length ? arrondi(differents.reduce((s, g) => s + g.ecart, 0) / differents.length) : null,
  };

  return {
    rapports: R.length,
    envois: E.length,
    lignes: L.length,
    lignesTravaillees: T.length,
    tempsRemplissage,
    heureEnvoi,
    rattrapage: part(E.filter(e => e.rattrapage).length, E.length),
    ecartAvancement,
    reaffectees, decoupees, heuresModifiees, rattachees, lignesAjoutees,
    basculees: part(T.filter(l => l.basculee).length, T.length),
    sansTache: part(T.filter(l => l.sansTache).length, T.length),
    sansTacheV2,
    texteLibre: { ...part(v2.filter(l => l.texteLibre).length, v2.length), nonMesurables: sansObjetV1 },
    creees: { ...part(v2.filter(l => l.nouvelle).length, v2.length), nonMesurables: sansObjetV1 },
    horsDevis: d.horsDevis ? part(T.filter(l => l.horsDevis).length, T.length) : indisponible(INDISPO.horsDevis),
    grosseLigne: part(T.filter(l => l.grosseLigne).length, T.length),
    plusieursTravaux: part(T.filter(l => l.plusieursTravaux).length, T.length),
    fourreTout: part(T.filter(l => l.plusieursTravaux || (l.grosseLigne && l.sansTache)).length, T.length),
    remarquesCourtes: part(remarquesNonTerminees.filter(l => l.remarque.length < SEUILS.remarqueCourte).length, remarquesNonTerminees.length),
    remarqueVide: part(T.filter(l => !l.remarque).length, T.length),
    photosManquantes: part(terminees.filter(l => l.sansPhoto).length, terminees.length),
    corriges,
    plusieurs,
  };
}

// Avancement retenu à la validation, relu dans le journal d'avancement daté
// (étape 1C). Une validation écrit dans le journal une ligne portant l'id du
// compte rendu (source « validation_cr » ou « correction ») pour chaque tâche
// dont elle change l'avancement :
//   - ligne trouvée → sa valeur « après » (la plus récemment écrite) ;
//   - aucune ligne → le conducteur n'a pas changé l'avancement : on prend
//     l'état de la tâche en fin de journée du compte rendu (etatTachesALaDate).
// Seuls les comptes rendus validés APRÈS la mise en service du journal (sa
// première ligne « initial ») sont mesurables : avant, le passé reconstitué
// ne dit pas quelle validation a fixé quelle valeur. Les autres restent
// absents (lignes non comparées, jamais 0).
// rapports : { id, chantier_id, statut, date_rapport, valide_le, taches } ;
// journal : { chantier_id, tache_id, rapport_id, source, avancement_avant,
// avancement_apres, date_realisation, created_at }.
export function avancementsValidesDepuisJournal({ rapports = [], journal = [] } = {}) {
  const lignes = journal || [];
  const miseEnService = lignes.filter(l => l?.source === "initial")
    .reduce((m, l) => (!m || String(l.created_at) < m ? String(l.created_at) : m), null);
  if (!miseEnService) return {};
  const parChantier = new Map();
  const parRapport = new Map();
  lignes.forEach(l => {
    const c = String(l?.chantier_id ?? "");
    if (!parChantier.has(c)) parChantier.set(c, []);
    parChantier.get(c).push(l);
    if (l?.rapport_id != null && l?.tache_id != null) {
      const k = `${l.rapport_id}|${l.tache_id}`;
      const prec = parRapport.get(k);
      if (!prec || String(l.created_at) >= String(prec.created_at)) parRapport.set(k, l);
    }
  });
  const etats = new Map();
  const out = {};
  (rapports || []).forEach(r => {
    if (r?.statut !== "valide" || !r.valide_le || String(r.valide_le) < miseEnService) return;
    const d = isoDate(r.date_rapport);
    const c = String(r.chantier_id ?? "");
    if (!d) return;
    const cle = `${c}|${d}`;
    if (!etats.has(cle)) etats.set(cle, etatTachesALaDate(parChantier.get(c) || [], d));
    (r.taches || []).forEach(t => {
      const k = tid(t);
      if (!k) return;
      const ligne = parRapport.get(`${r.id}|${k}`);
      const v = ligne ? nombreOuNull(ligne.avancement_apres) : (etats.get(cle).get(k) ?? null);
      if (v != null) (out[r.id] ??= {})[k] = v;
    });
  });
  return out;
}

// Lignes découpées à la validation, par ouvrier et par mois (« 2026-10 ») :
// { [ouvrier]: { [mois]: { lignesDecoupees, lignesCreees } } }.
// Sert le compteur « tâches regroupées » de la Validation (prompt CR-5).
export function decoupesParOuvrierEtMois(faits) {
  const out = {};
  faits.rapports.forEach(r => {
    if (!r.comparable || !r.decoupes) return;
    const mois = String(r.date).slice(0, 7);
    out[r.ouvrier] ??= {};
    const c = (out[r.ouvrier][mois] ??= { lignesDecoupees: 0, lignesCreees: 0 });
    c.lignesDecoupees += r.decoupes;
    c.lignesCreees += r.lignesCreees;
  });
  return out;
}

// Point d'entrée : indicateurs d'une période, au total, par version et par ouvrier.
export function indicateursComptesRendus(entree) {
  const faits = faitsComptesRendus(entree);
  const ouvriers = [...new Set(faits.lignes.map(l => l.ouvrier).concat(faits.envois.map(e => e.ouvrier)))]
    .filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
  return {
    periode: { debut: entree?.debut || null, fin: entree?.fin || null },
    disponibles: faits.disponibles,
    total: agreger(faits),
    parVersion: { [VERSION_V1]: agreger(faits, { version: VERSION_V1 }), [VERSION_V2]: agreger(faits, { version: VERSION_V2 }) },
    parOuvrier: Object.fromEntries(ouvriers.map(o => [o, agreger(faits, { ouvrier: o })])),
    decoupesParMois: decoupesParOuvrierEtMois(faits),
  };
}

// ── Catalogue : même libellé, même explication partout ──────────────────────
// valeur(g) : le nombre comparé d'une période à l'autre (null = pas de mesure).
// meilleur : « bas » = plus petit est mieux ; null = ni bien ni mal (constat).
const taux = (p) => (p && !p.indisponible && p.taux != null ? arrondi(p.taux * 100) : null);
export const INDICATEURS_QUALITE = Object.freeze([
  { code: "tempsRemplissage", libelle: "Temps de remplissage", unite: "min", meilleur: "bas",
    valeur: g => g.tempsRemplissage.medianeMin,
    explication: "Médiane, en minutes, entre la première saisie de la journée et l'envoi (nouveau formulaire seulement, hors rattrapage). C'est le temps pendant lequel le compte rendu est resté ouvert, pas le temps passé à écrire : un brouillon commencé à midi et envoyé le soir compte plusieurs heures." },
  { code: "rattrapage", libelle: "Envoyés en rattrapage", unite: "%", meilleur: "bas",
    valeur: g => taux(g.rattrapage),
    explication: "Part des envois faits un jour après la date du compte rendu (heure de Paris)." },
  { code: "ecartAvancement", libelle: "Écart d'avancement déclaré / validé", unite: "pts", meilleur: "bas",
    valeur: g => (g.ecartAvancement.indisponible ? null : g.ecartAvancement.moyenneAbs),
    explication: "Écart moyen, en points de %, entre l'avancement déclaré par l'ouvrier et celui retenu à la validation, sur les lignes avec des heures dont la tâche a été gardée. L'avancement retenu est relu dans le journal d'avancement, pour les comptes rendus validés depuis sa mise en service (24/10/2026) ; avant, il n'est pas mesuré ici." },
  { code: "reaffectees", libelle: "Lignes réaffectées", unite: "%", meilleur: "bas",
    valeur: g => taux(g.reaffectees),
    explication: "Ligne déclarée sur une tâche du phasage dont toutes les heures sont parties sur une autre tâche à la validation." },
  { code: "decoupees", libelle: "Lignes découpées", unite: "%", meilleur: "bas",
    valeur: g => taux(g.decoupees),
    explication: "Ligne dont les heures ont été réparties sur plusieurs tâches à la validation (une ligne de 6 h répartie sur 5 tâches compte pour une ligne découpée)." },
  { code: "basculees", libelle: "Lignes basculées vers un autre chantier", unite: "%", meilleur: "bas",
    valeur: g => taux(g.basculees),
    explication: "Ligne dont une partie des heures a été déplacée vers un autre chantier à la validation." },
  { code: "sansTache", libelle: "Lignes sans tâche du phasage", unite: "%", meilleur: "bas",
    valeur: g => taux(g.sansTache),
    explication: "Ligne envoyée sans lien vers une tâche du phasage : le conducteur doit la rattacher. Ce n'est pas toujours l'ouvrier : une case du planning écrite sans tâche arrive aussi sans lien. Le nouveau formulaire permet de distinguer case du planning, texte libre et nouvelle tâche." },
  { code: "texteLibre", libelle: "Lignes en texte libre", unite: "%", meilleur: "bas",
    valeur: g => taux(g.texteLibre),
    explication: "Tâche décrite en texte libre par l'ouvrier. Mesurable seulement sur le nouveau formulaire : l'ancien ne distinguait pas un texte libre d'une case du planning." },
  { code: "creees", libelle: "Tâches proposées par l'ouvrier", unite: "%", meilleur: null,
    valeur: g => taux(g.creees),
    explication: "Nouvelle tâche proposée par l'ouvrier (nouveau formulaire seulement : l'ancien ne le permettait pas)." },
  { code: "horsDevis", libelle: "Lignes hors devis", unite: "%", meilleur: null,
    valeur: g => taux(g.horsDevis),
    explication: "Ligne sur une tâche marquée hors devis au phasage, ou nouvelle tâche proposée comme demande du client / imprévu." },
  { code: "fourreTout", libelle: "Lignes fourre-tout probables", unite: "%", meilleur: "bas",
    valeur: g => taux(g.fourreTout),
    explication: "Ligne écrite par l'ouvrier (sans tâche du phasage) dont l'intitulé énumère des travaux de métiers différents (« démolition, ménage et PVC »), ou qui porte à elle seule au moins 80 % d'une journée d'au moins 6 h. Estimation par mots-clés." },
  { code: "remarquesCourtes", libelle: "Remarques vides ou très courtes", unite: "%", meilleur: "bas",
    valeur: g => taux(g.remarquesCourtes),
    explication: "Sur les lignes non terminées avec des heures (En cours, Bloqué) : remarque vide ou de moins de 15 caractères (« En cours », « À finir », « . »)." },
  { code: "photosManquantes", libelle: "Tâches terminées sans photo", unite: "%", meilleur: "bas",
    valeur: g => taux(g.photosManquantes),
    explication: "Ligne « Terminé » avec des heures et aucune photo." },
  { code: "corriges", libelle: "Comptes rendus rouverts après validation", unite: "%", meilleur: "bas",
    valeur: g => taux(g.corriges),
    explication: "Rapport validé puis rouvert avec « Corriger »." },
  { code: "plusieurs", libelle: "Avancements différents sur une tâche faite à plusieurs", unite: "%", meilleur: "bas",
    valeur: g => taux(g.plusieurs),
    explication: "Tâche déclarée le même jour par au moins deux ouvriers : part des cas où leurs avancements diffèrent (lignes en quantité exclues)." },
]);

// Tendance d'un indicateur entre deux périodes.
//   → { courant, precedent, delta, sens: "mieux" | "moins_bien" | "stable" | null }
export function tendance(code, groupeCourant, groupePrecedent) {
  const ind = INDICATEURS_QUALITE.find(i => i.code === code);
  if (!ind) return null;
  const c = groupeCourant ? ind.valeur(groupeCourant) : null;
  const p = groupePrecedent ? ind.valeur(groupePrecedent) : null;
  if (c == null || p == null) return { courant: c, precedent: p, delta: null, sens: null };
  const delta = arrondi(c - p);
  const seuil = ind.unite === "%" ? 2 : 1;   // en dessous : stable
  let sens = "stable";
  if (Math.abs(delta) >= seuil) sens = !ind.meilleur ? null : (delta < 0) === (ind.meilleur === "bas") ? "mieux" : "moins_bien";
  return { courant: c, precedent: p, delta, sens };
}
