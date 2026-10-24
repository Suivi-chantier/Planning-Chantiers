// src/Renovation/validationJourneeV1.mjs — page de la journée de la Validation
// (refonte CR-5). Module PUR : aucune lecture de base, aucune horloge ; les
// données arrivent en paramètre. Façade front : validationJourneeV1.js.
//
// Ce module ne change AUCUNE règle de la validation (garde-fou des heures,
// verrou d'écriture, pointages, journal d'avancement) : il dit seulement ce
// que l'écran montre — écarts écrits en clair, couleur d'un compte rendu,
// résumé de la journée, tâches déclarées différemment par plusieurs ouvriers,
// arbitrage appliqué à plusieurs comptes rendus, répartition d'une tâche
// regroupée et barre de budget d'une tâche.
import { libelleMotifStatut, libelleMotifDepassement } from "./motifsCompteRendu.mjs";

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const net = (s) => String(s ?? "").trim();
const arr = (v) => (Array.isArray(v) ? v : []);
const r2 = (x) => Math.round(x * 100) / 100;
const fmtH = (h) => {
  const v = r2(num(h));
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
};
const eur = (x) => `${Math.round(num(x)).toLocaleString("fr-FR")} €`;

// « JJ/MM/AAAA » ou ISO → ISO (rapports.date_rapport a connu les deux).
export function dateISO(s) {
  const v = net(s);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}
const normNom = (s) => net(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── Une ligne de compte rendu ───────────────────────────────────────────────
// État affiché en étiquette : terminée, en cours (x %), bloquée, pas faite.
export function etatLigne(t) {
  if (!t) return null;
  if (t.bloque) return { code: "bloque", texte: "bloquée" };
  if (t.statut === "faite") return { code: "termine", texte: "terminée" };
  if (t.statut === "en_cours") {
    const a = t.avancement;
    return { code: "en_cours", texte: a == null || a === "" ? "en cours" : `en cours ${Math.round(num(a))} %` };
  }
  if (t.statut === "non_faite") return { code: "non_faite", texte: "pas faite" };
  return { code: "inconnu", texte: "état non dit" };
}
const nomLigne = (t) => net(t?.proposition?.nom) || net(t?.planifie) || "(sans nom)";
export const heuresLigne = (t) => num(t?.heures_reelles);

// Étiquettes des tâches d'un compte rendu (lisible sans l'ouvrir).
export function etiquettesRapport(rapport) {
  return arr(rapport?.taches)
    .filter(t => heuresLigne(t) > 0 || t.statut === "non_faite" || t.bloque)
    .map(t => ({ nom: nomLigne(t), etat: etatLigne(t), heures: r2(heuresLigne(t)) }));
}

const MOTIFS_CREATION = { introuvable: "pas trouvée dans la liste", imprevu: "travail imprévu", demande_client: "demande du client" };

// ── Écarts d'un compte rendu, écrits en clair ───────────────────────────────
// ctx :
//   avancementParTache  { [tache_id]: avancement actuel du phasage }
//   ouvriersPlanifies   noms planifiés ce jour (tous chantiers) — vide = inconnu
//   heuresAttendues     heures attendues de l'ouvrier ce jour (null = inconnu)
//   heuresJourOuvrier   heures déclarées par l'ouvrier ce jour, tous ses comptes
//                       rendus compris (null = celles de ce compte rendu)
// Chaque écart : { niveau: "orange" | "rouge", code, texte }.
//   rouge  = à arbitrer : bloquée, tâche créée, hors devis / sans tâche
//   orange = à regarder : dépassement, prévue non faite, désaccord avec un
//            collègue, journée hors norme, ouvrier non planifié, tâche déjà
//            à 100 %, total différent de l'attendu
export function ecartsRapport(rapport, ctx = {}) {
  const out = [];
  const avancements = ctx.avancementParTache || {};
  const taches = arr(rapport?.taches);
  taches.forEach(t => {
    const nom = nomLigne(t);
    const h = heuresLigne(t);
    if (t.bloque) {
      const motif = t.motif ? libelleMotifStatut(t.motif) : null;
      out.push({ niveau: "rouge", code: "bloque",
        texte: `« ${nom} » bloquée${motif ? ` : ${motif.toLowerCase()}` : ""}${net(t.remarque) ? ` — « ${net(t.remarque)} »` : ""}` });
    }
    if (t.proposition || t.origine === "nouvelle") {
      const m = MOTIFS_CREATION[t.proposition?.motif_hd];
      out.push({ niveau: "rouge", code: "tache_creee",
        texte: `Tâche créée par l'ouvrier : « ${nom} »${m ? ` (${m})` : ""}` });
    } else if (h > 0 && !t.tache_id) {
      out.push({ niveau: "rouge", code: "hors_devis", texte: `« ${nom} » : ${fmtH(h)} h hors devis, sans tâche du phasage` });
    }
    if (t.motif_depassement) {
      const d = t.depassement;
      const chiffres = d && num(d.heures_vendues) > 0
        ? ` : ${fmtH(num(d.heures_avant) + num(d.heures_jour))} h pour ${fmtH(d.heures_vendues)} h prévues` : "";
      out.push({ niveau: "orange", code: "depassement",
        texte: `Dépassement d'heures sur « ${nom} »${chiffres} — ${libelleMotifDepassement(t.motif_depassement).toLowerCase()}` });
    }
    if (t.statut === "non_faite" && !t.bloque && t.tache_id) {
      const motif = t.motif ? libelleMotifStatut(t.motif) : null;
      out.push({ niveau: "orange", code: "prevue_non_faite",
        texte: `« ${nom} » prévue, pas faite${motif ? ` : ${motif.toLowerCase()}` : ""}` });
    }
    if (t.collegue?.ouvrier && t.collegue.accord === false) {
      out.push({ niveau: "orange", code: "desaccord",
        texte: `« ${nom} » : pas d'accord avec ${t.collegue.ouvrier} sur l'état de la tâche` });
    }
    if (t.tache_id && h > 0 && avancements[String(t.tache_id)] === 100) {
      out.push({ niveau: "orange", code: "deja_terminee", texte: `« ${nom} » pointée alors qu'elle est déjà terminée` });
    }
  });
  const hJour = ctx.heuresJourOuvrier != null ? num(ctx.heuresJourOuvrier) : heuresDeclarees(rapport);
  if (hJour > 10) out.push({ niveau: "orange", code: "journee_longue", texte: `Journée de ${fmtH(hJour)} h, au-dessus de 10 h` });
  const planifies = arr(ctx.ouvriersPlanifies);
  if (rapport?.ouvrier && planifies.length > 0 && !planifies.some(p => normNom(p) === normNom(rapport.ouvrier))) {
    out.push({ niveau: "orange", code: "non_planifie", texte: `${rapport.ouvrier} n'était pas planifié ce jour-là` });
  }
  if (ctx.heuresAttendues != null && Math.abs(hJour - num(ctx.heuresAttendues)) > 0.01) {
    out.push({ niveau: "orange", code: "total",
      texte: `${fmtH(hJour)} h déclarées pour ${fmtH(ctx.heuresAttendues)} h attendues` });
  }
  return out;
}

// Niveau d'un compte rendu : « comme_prevu » (gris), « ecarts » (orange),
// « arbitrer » (rouge), et le libellé du badge.
export function classerRapport(rapport, ctx = {}) {
  const ecarts = ecartsRapport(rapport, ctx);
  const niveau = ecarts.some(e => e.niveau === "rouge") ? "arbitrer" : ecarts.length > 0 ? "ecarts" : "comme_prevu";
  const badge = niveau === "arbitrer" ? "À arbitrer"
    : niveau === "ecarts" ? `${ecarts.length} écart${ecarts.length > 1 ? "s" : ""}` : "Comme prévu";
  return { niveau, badge, ecarts };
}

// Heures d'un compte rendu, hors trajet : tâches + heures indirectes.
export function heuresDeclarees(rapport) {
  return r2(arr(rapport?.taches).reduce((s, t) => s + heuresLigne(t), 0)
    + arr(rapport?.heures_indirectes).reduce((s, x) => s + num(x?.heures), 0));
}
const trajetHeures = (r) => (num(r?.trajet_matin_min) + num(r?.trajet_soir_min)) / 60;

// Heures déclarées d'un ouvrier sur la journée : ses comptes rendus du jour
// + UN trajet (le même trajet est recopié sur chacun de ses comptes rendus).
export function heuresJourOuvrier(rapports, ouvrier) {
  const siens = arr(rapports).filter(r => normNom(r.ouvrier) === normNom(ouvrier));
  if (siens.length === 0) return 0;
  return r2(siens.reduce((s, r) => s + heuresDeclarees(r), 0) + trajetHeures(siens[0]));
}

// « Valider » direct : seulement un compte rendu « comme prévu », sans
// anomalie, dont chaque ligne avec des heures est rattachée à une tâche du
// phasage et ne se suit pas en quantité. Tout le reste passe par « Ouvrir et
// valider » (la validation elle-même, garde-fou compris, est la même).
export function peutValiderDirect(rapport, classement, { suiviEnQuantite = () => false, journeeCloturee = false } = {}) {
  if (!rapport || rapport.statut === "valide" || journeeCloturee) return false;
  if (!classement || classement.niveau !== "comme_prevu") return false;
  const lignes = arr(rapport.taches).filter(t => heuresLigne(t) > 0);
  if (lignes.length === 0) return false;
  return lignes.every(t => t.tache_id && !t.proposition && !t.bascule_depuis && !suiviEnQuantite(t.tache_id));
}

// ── Regroupement ────────────────────────────────────────────────────────────
// mode « chantier » (par défaut) ou « ouvrier ». Groupes triés par nom.
export function grouperRapports(rapports, mode = "chantier") {
  const m = new Map();
  arr(rapports).forEach(r => {
    const cle = mode === "ouvrier" ? net(r.ouvrier) || "(sans nom)" : String(r.chantier_id ?? "");
    const titre = mode === "ouvrier" ? cle : net(r.chantier_nom) || String(r.chantier_id ?? "(sans chantier)");
    if (!m.has(cle)) m.set(cle, { cle, titre, rapports: [] });
    m.get(cle).rapports.push(r);
  });
  return [...m.values()].sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
}

// ── Résumé de la journée ────────────────────────────────────────────────────
//   attendus  : [{ chantier_id, chantier_nom, ouvrier, statut }] — comptes
//               rendus attendus (module des relevés journaliers, étape 1D)
//   heuresAttenduesParOuvrier : { [ouvrier]: heures attendues } (inconnu = absent)
export function resumeJournee({ rapports = [], classements = {}, attendus = [], heuresAttenduesParOuvrier = {} } = {}) {
  const rs = arr(rapports);
  const aValider = rs.filter(r => r.statut !== "valide");
  const valides = rs.filter(r => r.statut === "valide");
  const nonEnvoyes = arr(attendus).filter(a => a.statut === "manquant")
    .map(a => ({ ouvrier: a.ouvrier, chantier_id: a.chantier_id, chantier_nom: a.chantier_nom || null }));
  const ouvriers = [...new Set([...rs.map(r => net(r.ouvrier)), ...arr(attendus).map(a => net(a.ouvrier))].filter(Boolean))];
  const heuresDecl = r2(ouvriers.reduce((s, o) => s + heuresJourOuvrier(rs, o), 0));
  const connus = ouvriers.filter(o => heuresAttenduesParOuvrier[o] != null);
  const heuresAtt = connus.length === ouvriers.length && ouvriers.length > 0
    ? r2(connus.reduce((s, o) => s + num(heuresAttenduesParOuvrier[o]), 0)) : null;
  const total = rs.length + nonEnvoyes.length;
  return {
    aValider: aValider.length,
    dontEcarts: aValider.filter(r => (classements[r.id]?.niveau || "comme_prevu") !== "comme_prevu").length,
    valides: valides.length,
    heuresValidees: r2(valides.reduce((s, r) => s + heuresDeclarees(r), 0)),
    nonEnvoyes,
    heuresDeclarees: heuresDecl,
    heuresAttendues: heuresAtt,          // null = au moins un ouvrier sans attendu connu
    progression: total > 0 ? valides.length / total : null,
  };
}

// Comptes rendus attendus mais non envoyés d'un chantier (encart pointillé).
export function manquantsDuChantier(attendus, chantierId) {
  return arr(attendus).filter(a => String(a.chantier_id) === String(chantierId) && a.statut === "manquant");
}

// Jours précédents avec des comptes rendus encore à valider (rappel d'en-tête).
//   enAttente : [{ date_rapport }] des comptes rendus non validés récents
export function joursEnRetard(enAttente, jourCourant, max = 6) {
  const m = new Map();
  arr(enAttente).forEach(r => {
    const d = dateISO(r.date_rapport);
    if (!d || d >= jourCourant) return;
    m.set(d, (m.get(d) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, max).map(([date, nb]) => ({ date, nb }));
}

// ── Tâche faite à plusieurs, déclarée différemment ──────────────────────────
// Rapports d'un même chantier, un même jour. Une tâche est retenue si au moins
// deux ouvriers l'ont déclarée avec des états différents (état ou avancement)
// et qu'un de leurs comptes rendus reste à valider.
export function tachesDeclareesDifferemment(rapports) {
  const parTache = new Map();
  arr(rapports).forEach(r => arr(r.taches).forEach(t => {
    if (!t.tache_id || (heuresLigne(t) <= 0 && t.statut !== "faite")) return;
    const k = String(t.tache_id);
    if (!parTache.has(k)) parTache.set(k, { tache_id: k, nom: nomLigne(t), declarations: [] });
    const e = etatLigne(t);
    parTache.get(k).declarations.push({
      rapport_id: r.id, ouvrier: r.ouvrier, valide: r.statut === "valide",
      etat: e, avancement: t.statut === "faite" ? 100 : t.avancement == null || t.avancement === "" ? null : Math.round(num(t.avancement)),
    });
  }));
  return [...parTache.values()].filter(x => {
    const ouvriers = new Set(x.declarations.map(d => normNom(d.ouvrier)));
    if (ouvriers.size < 2 || x.declarations.every(d => d.valide)) return false;
    const cles = new Set(x.declarations.map(d => `${d.etat?.code}:${d.avancement ?? ""}`));
    return cles.size > 1;
  }).map(x => ({ ...x, phrase: x.declarations.map(d => `${d.ouvrier} : ${d.etat?.texte || "?"}`).join(" · ") }));
}

// Arbitrage groupé : { [chantier_id]: { [tache_id]: avancement retenu } }.
export function poserArbitrage(arbitrages, chantierId, tacheId, avancement) {
  const v = Math.max(0, Math.min(100, Math.round(num(avancement))));
  const ch = String(chantierId);
  return { ...(arbitrages || {}), [ch]: { ...((arbitrages || {})[ch] || {}), [String(tacheId)]: v } };
}
// Lignes de validation d'un compte rendu avec l'avancement retenu appliqué à
// chaque ligne de la tâche arbitrée (la même valeur pour tous les comptes
// rendus du chantier : « Appliquer aux deux »).
export function appliquerArbitrages(lignes, arbitragesChantier) {
  const a = arbitragesChantier || {};
  return arr(lignes).map(li => (li.tache_id && a[String(li.tache_id)] != null
    ? { ...li, avancement_arbitre: a[String(li.tache_id)], _arbitrageGroupe: true } : li));
}

// ── Répartir une tâche regroupée ────────────────────────────────────────────
// Tout se compte en minutes, par pas de 15 min ; un reste de moins de 15 min
// va sur la première ligne. La somme tombe TOUJOURS juste.
const PAS = 15;
const minutes = (h) => Math.round(num(h) * 60);
const versHeures = (m) => r2(m / 60);

// Plus grand reste sur des pas de 15 min, poids >= 0.
function repartirMinutes(totalMin, poids) {
  const n = poids.length;
  if (n === 0) return [];
  const somme = poids.reduce((s, p) => s + p, 0);
  const w = somme > 0 ? poids : poids.map(() => 1);
  const sw = w.reduce((s, p) => s + p, 0);
  const pas = Math.floor(totalMin / PAS);
  const bruts = w.map(p => (pas * p) / sw);
  const base = bruts.map(Math.floor);
  let reste = pas - base.reduce((s, b) => s + b, 0);
  bruts.map((b, i) => ({ i, f: b - Math.floor(b) })).sort((a, b) => b.f - a.f || a.i - b.i)
    .forEach(({ i }) => { if (reste > 0) { base[i]++; reste--; } });
  const out = base.map(b => b * PAS);
  out[0] += totalMin - pas * PAS;
  return out;
}
export function repartirPartsEgales(totalHeures, n) {
  return repartirMinutes(minutes(totalHeures), Array.from({ length: Math.max(0, n) }, () => 1)).map(versHeures);
}
// Selon les durées prévues de chaque tâche (aucune durée connue → parts égales).
export function repartirSelonDurees(totalHeures, durees) {
  return repartirMinutes(minutes(totalHeures), arr(durees).map(d => Math.max(0, num(d)))).map(versHeures);
}
// Écart entre la répartition et les heures déclarées, en minutes (0 = juste).
export function ecartRepartition(parts, totalHeures) {
  return arr(parts).reduce((s, p) => s + minutes(p?.heures), 0) - minutes(totalHeures);
}
export const repartitionJuste = (parts, totalHeures) =>
  arr(parts).length > 0 && arr(parts).every(p => p?.tache_id && minutes(p.heures) > 0) && ecartRepartition(parts, totalHeures) === 0;
export const ajusterQuartDHeure = (heures, sens) => versHeures(Math.max(0, minutes(heures) + sens * PAS));

const MOTS_VIDES = new Set(["les", "des", "une", "dans", "pour", "avec", "sur", "est", "pas", "que", "qui", "aux", "par", "fait", "fini", "finir", "faire", "commence", "commencé", "journee", "journée", "aujourd", "hui", "ensuite", "puis", "encore", "tout", "toute", "chambre", "piece"]);
const motsDe = (s) => normNom(s).replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(m => m.length >= 3 && !MOTS_VIDES.has(m));
const STANDARD = /nettoy|rangement|range|evacu|dechet|decheter|approvision/;

// Proposition de répartition : tâches prévues ce jour-là, tâches dont le nom
// partage des mots avec le texte (dicté ou tapé), tâche standard de nettoyage
// si le texte en parle. Chaque proposition dit POURQUOI elle est là.
//   tachesPlan : [{ id, nom, nom_devis?, groupe?, heures_prevues? }]
export function proposerRepartition({ texte = "", tachesPlan = [], tachesPrevuesJour = [], heures = 0, exclure = [], max = 6 } = {}) {
  const prevues = new Set(arr(tachesPrevuesJour).map(String));
  const exclues = new Set(arr(exclure).map(String));
  const motsTexte = new Set(motsDe(texte));
  const parle = (re) => re.test(normNom(texte));
  const scores = arr(tachesPlan).filter(t => t?.id != null && !exclues.has(String(t.id))).map(t => {
    const raisons = [];
    let score = 0;
    if (prevues.has(String(t.id))) { score += 2; raisons.push("prévue au planning ce jour-là"); }
    const communs = [...new Set([...motsDe(t.nom), ...motsDe(t.nom_devis)])].filter(m => motsTexte.has(m));
    if (communs.length > 0) { score += 1 + communs.length; raisons.push(`le texte parle de « ${communs.slice(0, 3).join(" », « ")} »`); }
    if (STANDARD.test(normNom(t.nom)) && parle(STANDARD)) { score += 1.5; raisons.push("tâche standard citée dans le texte"); }
    return { t, score, raisons };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.t.nom).localeCompare(String(b.t.nom), "fr"))
    .slice(0, max);
  const parts = repartirSelonDurees(heures, scores.map(x => num(x.t.heures_prevues)));
  return scores.map((x, i) => ({
    tache_id: x.t.id, nom: x.t.nom, groupe: x.t.groupe || null,
    raison: x.raisons.join(" ; "), heures: parts[i] ?? 0, etat: "en_cours", avancement: null,
  }));
}

// Lignes de validation issues d'une répartition. La première reprend la ligne
// d'origine (même rowId) ; les suivantes sont des lignes nouvelles. Plus de
// proposition à créer (la ligne regroupée est remplacée par des tâches du
// phasage) ; photos et texte copiés sur chaque tâche si la case est cochée.
//   parts : [{ tache_id, phase_id?, ouvrage_id?, nom, heures, etat: "en_cours"|"terminee", avancement }]
export function lignesDepuisRepartition(source, parts, { garderPhotosEtTexte = true, genId = (i) => `r${i}` } = {}) {
  return arr(parts).map((p, i) => {
    const terminee = p.etat === "terminee";
    const av = terminee ? 100 : p.avancement == null || p.avancement === "" ? "" : Math.max(0, Math.min(100, Math.round(num(p.avancement))));
    const { proposition, creation, depassement, qte_edit, quantite_declaree, unite_declaree, ...base } = source || {};
    return {
      ...base,
      rowId: i === 0 ? source.rowId : genId(i),
      _origine: i === 0 ? !!source._origine : false,
      _repartie: true,
      tache_id: p.tache_id, phase_id: p.phase_id || null, ouvrage_id: p.ouvrage_id || null,
      planifie: p.nom || base.planifie,
      heures: versHeures(minutes(p.heures)),
      statut: terminee ? "faite" : "en_cours",
      avancement_arbitre: av,
      depassement: null,
      _autoMatched: false,
      photos: garderPhotosEtTexte ? arr(source?.photos) : [],
      remarque: garderPhotosEtTexte ? net(source?.remarque) : "",
      ...(garderPhotosEtTexte && net(source?.texte_dicte) ? { texte_dicte: net(source.texte_dicte) } : {}),
    };
  });
}

// Compteur « 3e tâche regroupée de Steven ce mois-ci » : découpes déjà
// comptées par le suivi qualité (decoupesParOuvrierEtMois, CR-1) + celle-ci.
export function rangTacheRegroupee(decoupes, ouvrier, mois) {
  const deja = num(decoupes?.[ouvrier]?.[mois]?.lignesDecoupees);
  const n = deja + 1;
  return { n, texte: `${n === 1 ? "1re" : `${n}e`} tâche regroupée de ${net(ouvrier) || "cet ouvrier"} ce mois-ci` };
}

// ── Barre de budget d'une tâche ─────────────────────────────────────────────
// heures avant aujourd'hui + heures du jour (tous les ouvriers) face aux
// heures prévues ; dépassement chiffré avec la méthode de l'étape 2 :
// heures en trop × (coût horaire MO + taux de frais généraux du jour).
//   coutHoraire : coût MO moyen d'une heure sur cette tâche (null = inconnu)
export function budgetTache({ heuresAvant = 0, heuresJour = [], heuresPrevues = 0, coutHoraire = null, tauxFG = null } = {}) {
  const avant = r2(num(heuresAvant));
  const parPersonne = arr(heuresJour).map(x => ({ ouvrier: x.ouvrier, heures: r2(num(x.heures)) })).filter(x => x.heures > 0);
  const jour = r2(parPersonne.reduce((s, x) => s + x.heures, 0));
  const total = r2(avant + jour);
  const prevues = r2(num(heuresPrevues));
  const depassement = prevues > 0 ? r2(Math.max(0, total - prevues)) : null;
  const coutConnu = coutHoraire != null && tauxFG != null;
  const coutDepassement = depassement > 0 && coutConnu ? r2(depassement * (num(coutHoraire) + num(tauxFG))) : depassement > 0 ? null : 0;
  return {
    avant, jour, total, prevues, parPersonne, depassement, coutDepassement,
    texte: prevues > 0
      ? `${fmtH(total)} h sur ${fmtH(prevues)} h prévues${depassement > 0 ? ` · dépassement ${fmtH(depassement)} h${coutDepassement != null ? ` ≈ ${eur(coutDepassement)}` : " (coût inconnu)"}` : ""}`
      : `${fmtH(total)} h · pas d'heures prévues sur cette tâche`,
  };
}
// Coût horaire MO moyen des pointages d'une tâche (null s'il n'y en a pas).
export function coutHoraireMoyen(pointages) {
  const h = arr(pointages).reduce((s, p) => s + num(p.heures), 0);
  if (h <= 0) return null;
  return r2(arr(pointages).reduce((s, p) => s + num(p.heures) * num(p.taux_horaire), 0) / h);
}
