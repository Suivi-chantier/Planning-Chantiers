// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — pré-remplissage (tâche 6 du projet
// docs/projets/fiche-securite-chantier.md, spécification « Règles de
// pré-remplissage »).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Les données arrivent en paramètre (lues par securiteDonnees.js). Façade
// front : securitePreRemplissage.js.
//
//   - proposerPreRemplissage() : pour chaque point 1 à 12, un statut proposé,
//     sa raison en clair, et les valeurs proposées (entreprises, lots, date de
//     dépose, jours isolés, quantités d'aide, EPI, risques) ;
//   - divergencesPreRemplissage() : ce qui, dans la fiche enregistrée, ne
//     correspond plus à la proposition recalculée ;
//   - appliquerProposition() / estampillerProposition() : passage d'une
//     proposition dans le formulaire, UNIQUEMENT sur clic. Rien n'est jamais
//     retiré (une case cochée, une entreprise, un lot saisis restent).
//
// RÈGLE D'INCONNU : une donnée manquante ou illisible donne « à compléter »
// avec la raison (« date du permis inconnue », « phasage illisible »…),
// jamais « non concerné ». « Non concerné » n'est proposé que quand la donnée
// existe et dit non (phasage lu, avec des ouvrages, sans ouvrage déclencheur).
//
// Lots et codes déclencheurs : securite/points.mjs (DECLENCHEURS_PRE_REMPLISSAGE).
// Aucun code d'ouvrage n'est écrit dans ce fichier.
// ─────────────────────────────────────────────────────────────────────────────
import { DECLENCHEURS_PRE_REMPLISSAGE as D, POINTS_FICHE, STATUTS_POINT_COMPLETE, libelleStatutPoint, pointParNumero } from "./securite/points.mjs";
import { parseCodeOuvrage } from "./codeOuvrage.mjs";

/** Nombre de lignes de risques remplies au plus par « Appliquer » (comme l'écran). */
export const NB_RISQUES_APPLIQUES = 3;

/** EPI toujours proposés au point 10 (codes de cases du point 10). */
export const EPI_DE_BASE = Object.freeze(["chaussures", "gants"]);

/** Jours du planning (planning_cells.jour), dans l'ordre de la semaine. */
export const JOURS_PLANNING = Object.freeze(["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]);

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const txt = (v) => (v === null || v === undefined ? "" : String(v)).trim();
/** Texte sans accents ni majuscules, pour comparer des libellés. */
export const normaliser = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pluriel = (n, s, p) => `${n} ${n > 1 ? p : s}`;

/** « 2026-12-10 » → « 10/12/2026 » (texte inchangé si ce n'est pas une date). */
export function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : txt(iso);
}

function estDateIso(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(d));
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

const iso = (dt) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;

// ─── Semaine + jour du planning → date ───────────────────────────────────────

/** Lundi (objet Date UTC) de la semaine 1 de l'année ISO `annee`. */
function lundiSemaine1(annee) {
  const j4 = new Date(Date.UTC(annee, 0, 4));
  j4.setUTCDate(j4.getUTCDate() - ((j4.getUTCDay() + 6) % 7));
  return j4;
}

/** Nombre de semaines ISO de l'année (52 ou 53). */
export function nbSemainesIso(annee) {
  const l53 = lundiSemaine1(annee);
  l53.setUTCDate(l53.getUTCDate() + 52 * 7 + 3); // jeudi de la 53e semaine
  return l53.getUTCFullYear() === annee ? 53 : 52;
}

/**
 * Date (AAAA-MM-JJ) d'une case du planning : `week_id` « 2026-W50 » + `jour`
 * « Jeudi ». null si la semaine ou le jour sont illisibles (jamais une date
 * inventée) : semaine 54, semaine 53 d'une année qui n'en a que 52, jour
 * inconnu.
 */
export function dateDepuisSemaineJour(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(txt(weekId));
  if (!m) return null;
  const annee = Number(m[1]), semaine = Number(m[2]);
  if (semaine < 1 || semaine > nbSemainesIso(annee)) return null;
  const idx = JOURS_PLANNING.findIndex((j) => normaliser(j) === normaliser(jour));
  if (idx < 0) return null;
  const d = lundiSemaine1(annee);
  d.setUTCDate(d.getUTCDate() + (semaine - 1) * 7 + idx);
  return iso(d);
}

// ─── Ouvrages du phasage ─────────────────────────────────────────────────────

const contientMot = (texteNormalise, mot) => {
  const m = normaliser(mot);
  if (m === "kg") return [...texteNormalise.matchAll(/(\d+(?:[.,]\d+)?)\s?kg\b/g)].some((x) => Number(x[1].replace(",", ".")) >= 20); // « 25KG », « 25 kg »
  return new RegExp(`(^|[^a-z0-9])${echapper(m)}([^a-z0-9]|$)`).test(texteNormalise);
};

/** Le code d'un ouvrage (« D-14 ») correspond-il à une entrée de la liste (« D-014 », « PL ») ? */
export function codeCorrespond(code, entrees) {
  if (!code) return null;
  for (const e of entrees || []) {
    if (/^[A-Z]+$/.test(e)) { if (code.prefixe === e) return e; continue; }
    const c = parseCodeOuvrage(e);
    if (c && c.prefixe === code.prefixe && c.numeroValeur === code.numeroValeur) return e;
  }
  return null;
}

/** Libellé court d'un ouvrage pour une raison : « PL-002 faux-plafond non démontable… ». */
export function libelleCourtOuvrage(o) {
  const lib = txt(o?.libelle).replace(/\s+/g, " ");
  const c = parseCodeOuvrage(lib);
  const reste = c ? c.reste : lib;
  const court = reste.length > 48 ? `${reste.slice(0, 47).trim()}…` : reste;
  return c ? `${c.code} ${court}` : (court || "ouvrage sans libellé");
}

/**
 * Un ouvrage déclenche-t-il la règle ? → { par: "lot"|"code"|"mot", detail } | null
 * Les mots ne valent que pour un ouvrage SANS code (sinon le code fait foi).
 * `exigeDepose` : il faut aussi le mot « dépose » (dépose des sanitaires), et
 * l'ouvrage doit être dans un des lots de la règle ou sans lot.
 */
export function ouvrageDeclenche(o, regle, { exigeDepose = false, parLot = true } = {}) {
  if (!estObjet(o) || !regle) return null;
  if (parLot && !exigeDepose && (regle.lots || []).includes(o.lot_id)) return { par: "lot", detail: o.lot_id };
  const code = parseCodeOuvrage(o.libelle);
  if (code) {
    const e = codeCorrespond(code, regle.codes);
    return e ? { par: "code", detail: code.code } : null;
  }
  const t = normaliser(o.libelle);
  if (!t) return null;
  if (exigeDepose) {
    if (o.lot_id && !(regle.lots || []).includes(o.lot_id)) return null;
    if (!contientMot(t, "depose")) return null;
  }
  const mot = (regle.mots || []).find((m) => contientMot(t, m));
  return mot ? { par: "mot", detail: mot } : null;
}

function ouvragesDeclencheurs(ouvrages, regle, options) {
  const out = [];
  (ouvrages || []).forEach((o) => {
    const d = ouvrageDeclenche(o, regle, options);
    if (d) out.push({ libelle: libelleCourtOuvrage(o), lot_id: o.lot_id || null, ...d, taches: Array.isArray(o.taches) ? o.taches : [] });
  });
  return out;
}

const listeCourte = (items, n = 3) => (items.length <= n ? items.join(" ; ") : `${items.slice(0, n).join(" ; ")} et ${items.length - n} autre${items.length - n > 1 ? "s" : ""}`);

function libelleLot(id, lots) {
  const l = (lots || []).find((x) => x.id === id);
  return l ? l.label : `lot inconnu (${id})`;
}

// ─── Sources : lecture des paramètres ────────────────────────────────────────

/** État d'une source : { ok, valeur, manque } (manque = phrase d'impossibilité). */
function sourcePhasage(phasage) {
  if (!phasage || phasage.erreur) return { ok: false, manque: `phasage illisible${phasage?.erreur ? ` (${phasage.erreur})` : ""}` };
  if (phasage.ouvrages === null || phasage.ouvrages === undefined) return { ok: false, manque: "pas de phasage pour ce chantier" };
  if (!Array.isArray(phasage.ouvrages)) return { ok: false, manque: "phasage de forme inattendue" };
  if (phasage.ouvrages.length === 0) return { ok: false, manque: "phasage sans ouvrage" };
  return { ok: true, valeur: phasage.ouvrages };
}

function sourceListe(src, nom) {
  if (!src || src.erreur) return { ok: false, manque: `${nom} illisible${src?.erreur ? ` (${src.erreur})` : ""}` };
  const v = src.cellules ?? src.liste ?? src.lignes;
  if (!Array.isArray(v)) return { ok: false, manque: `${nom} illisible` };
  return { ok: true, valeur: v };
}

/** Personnes par jour planifié du chantier → Map date → { semaine, jour, noms[] } + illisibles. */
export function joursPlanifies(cellules) {
  const parJour = new Map();
  const illisibles = [];
  (cellules || []).forEach((c) => {
    const noms = [...new Set((Array.isArray(c?.ouvriers) ? c.ouvriers : []).map(txt).filter(Boolean))];
    if (!noms.length) return;
    const date = dateDepuisSemaineJour(c.week_id, c.jour);
    if (!date) { illisibles.push(`${txt(c.week_id) || "?"} ${txt(c.jour) || "?"}`); return; }
    const e = parJour.get(date) || { date, semaine: txt(c.week_id), jour: txt(c.jour), noms: [] };
    e.noms = [...new Set([...e.noms, ...noms])];
    parJour.set(date, e);
  });
  return { jours: [...parJour.values()].sort((a, b) => a.date.localeCompare(b.date)), illisibles };
}

// ─── Proposition ─────────────────────────────────────────────────────────────

const statutRecu = (fiche, cle) => {
  const r = estObjet(fiche?.reponses) ? fiche.reponses[cle] : null;
  return estObjet(r) && STATUTS_POINT_COMPLETE.includes(r.statut) ? r.statut : null;
};

/**
 * Propositions de la fiche, point par point.
 *
 * @param {object} p
 * @param {object} p.batiment  { ligne (securite_operations, null = jamais saisi), erreur }
 * @param {object} p.phasage   { ouvrages (null = pas de phasage), erreur }
 * @param {object} p.planning  { cellules (planning_cells du chantier), erreur }
 * @param {object} [p.planningOperation] { cellules (des AUTRES chantiers de l'opération), erreur, nomsChantiers: {id: nom} }
 * @param {object} p.ressources { liste (planning_resources), erreur }
 * @param {object} p.commandes { lignes (commande_lignes retenues), erreur }
 * @param {Array}  p.lots      lots de l'appli [{ id, label }]
 * @param {object} p.fiche     contenu enregistré { intervenants, donnees_base, reponses } (pour les points qui en dépendent)
 * @returns {{ points: Object<string, object>, liste: object[] }}
 *   chaque point : { numero, cle, titre, statut_propose, raison_proposition, valeurs, applicable }
 */
export function proposerPreRemplissage({
  batiment = null, phasage = null, planning = null, planningOperation = null,
  ressources = null, commandes = null, lots = [], fiche = null,
} = {}) {
  const P = {};
  const ph = sourcePhasage(phasage);
  const ouvrages = ph.ok ? ph.valeur : [];
  const pl = sourceListe(planning, "planning");
  const rs = sourceListe(ressources, "liste des ressources du planning");
  const bat = batiment && !batiment.erreur ? batiment.ligne || null : null;
  const batManque = !batiment ? "données du bâtiment non lues" : batiment.erreur ? `données du bâtiment illisibles (${batiment.erreur})` : !batiment.ligne ? "données du bâtiment jamais saisies sur l'opération" : null;
  const lotsPhasage = ph.ok ? [...new Set(ouvrages.map((o) => txt(o?.lot_id)).filter(Boolean))] : [];
  const ordreLots = (lots || []).map((l) => l.id);
  lotsPhasage.sort((a, b) => {
    const ia = ordreLots.indexOf(a), ib = ordreLots.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const db = estObjet(fiche?.donnees_base) ? fiche.donnees_base : {};
  const lotsFiche = Array.isArray(db.lots) ? db.lots.map(txt).filter(Boolean) : [];

  const fixer = (numero, statut, raison, valeurs = {}, applicable = true) => {
    const pt = pointParNumero(numero);
    // Points 4 à 12 : une proposition « à compléter » n'a rien à appliquer.
    const ok = applicable && !(numero >= 4 && statut === "a_completer");
    P[pt.cle] = { numero, cle: pt.cle, titre: pt.titre, statut_propose: statut, raison_proposition: raison, valeurs, applicable: ok };
  };

  // ── Point 1 : intervenants ──
  {
    const raisons = [];
    const entreprises = [{ nom: D.entreprisePrincipale, activite: "Entreprise principale" }];
    let personnes = [];
    let inconnus = [];
    if (!pl.ok) raisons.push(`${pl.manque} : prestataires non recherchés`);
    else if (!rs.ok) raisons.push(`${rs.manque} : prestataires non reconnus`);
    else {
      const parNom = new Map();
      rs.valeur.forEach((r) => { [r.nom_planning, r.nom].map(txt).filter(Boolean).forEach((n) => { if (!parNom.has(normaliser(n))) parNom.set(normaliser(n), r); }); });
      const noms = [...new Set(pl.valeur.flatMap((c) => (Array.isArray(c?.ouvriers) ? c.ouvriers : []).map(txt).filter(Boolean)))];
      const prestataires = [];
      noms.forEach((n) => {
        const r = parNom.get(normaliser(n));
        if (!r) inconnus.push(n);
        else if (r.kind === "prestataire") prestataires.push(txt(r.nom_planning) || txt(r.nom) || n);
        else personnes.push(n);
      });
      [...new Set(prestataires)].sort().forEach((n) => entreprises.push({ nom: n, activite: "Prestataire présent au planning" }));
      personnes = [...new Set(personnes)].sort();
      inconnus = [...new Set(inconnus)].sort();
      raisons.push(prestataires.length
        ? `${D.entreprisePrincipale} et ${pluriel(prestataires.length, "prestataire présent", "prestataires présents")} au planning (${[...new Set(prestataires)].join(", ")})`
        : `${D.entreprisePrincipale} seule : aucun prestataire au planning du chantier`);
      if (inconnus.length) raisons.push(`${pluriel(inconnus.length, "nom du planning absent", "noms du planning absents")} des ressources (${inconnus.join(", ")}) : à vérifier`);
    }
    raisons.push("responsable à saisir à la main");
    fixer(1, "concerne", `${raisons.join(" ; ")}.`, { entreprises, personnes, inconnus });
  }

  // ── Point 2 : données de base ──
  const depose = ph.ok ? ouvragesDeclencheurs(ouvrages, D.deposeSanitaires, { exigeDepose: true }) : [];
  const datesDepose = depose.flatMap((o) => o.taches.map((t) => txt(t?.date_prevue)).filter(estDateIso)).sort();
  const dateDepose = datesDepose[0] || null;
  {
    const raisons = [];
    if (!ph.ok) raisons.push(`${ph.manque} : lots et date de dépose des sanitaires non proposés`);
    else {
      const sansLot = ouvrages.filter((o) => !txt(o?.lot_id)).length;
      raisons.push(lotsPhasage.length ? `Lots du phasage : ${lotsPhasage.map((id) => libelleLot(id, lots)).join(", ")}` : "aucun lot renseigné sur les ouvrages du phasage");
      if (sansLot) raisons.push(`${pluriel(sansLot, "ouvrage sans lot", "ouvrages sans lot")} non compté${sansLot > 1 ? "s" : ""}`);
      if (dateDepose) raisons.push(`dépose des sanitaires le ${dateFr(dateDepose)} (${listeCourte(depose.map((o) => o.libelle), 2)})`);
      else if (depose.length) raisons.push(`dépose des sanitaires prévue (${listeCourte(depose.map((o) => o.libelle), 2)}) mais aucune tâche datée au phasage : date à compléter`);
      else raisons.push("aucune dépose de WC, lavabo ou douche au phasage");
    }
    fixer(2, "concerne", `${raisons.join(" ; ")}.`, {
      lots: lotsPhasage, date_depose_sanitaires: dateDepose, deposeSansDate: !dateDepose && depose.length > 0,
      ouvragesDepose: depose.map((o) => o.libelle),
    }, ph.ok);
  }

  // ── Point 4 : amiante ──
  const amiantePresent = bat?.reperage_amiante_statut === "recu_amiante_present";
  {
    if (batManque) fixer(4, "a_completer", `Date du permis inconnue : ${batManque}.`, { amiantePresent: false });
    else if (!estDateIso(bat.date_permis_construire)) fixer(4, "a_completer", "Date du permis de construire inconnue : à saisir dans le bloc Bâtiment de l'opération.", { amiantePresent });
    else {
      const avant = bat.date_permis_construire < "1997-07-01";
      const rep = amiantePresent ? " ; repérage reçu : amiante présent" : bat.reperage_amiante_statut === "recu_sans_amiante" ? " ; repérage reçu : sans amiante" : "";
      fixer(4, avant ? "concerne" : "non_concerne",
        `Permis du ${dateFr(bat.date_permis_construire)}, ${avant ? "antérieur" : "postérieur"} au 1er juillet 1997${rep}.`, { amiantePresent });
    }
  }

  // ── Point 5 : chute de hauteur ──
  const hauteur = ph.ok ? ouvragesDeclencheurs(ouvrages, D.chuteHauteur) : [];
  if (!ph.ok) fixer(5, "a_completer", `${ph.manque[0].toUpperCase()}${ph.manque.slice(1)} : ouvrages en hauteur non recherchés.`, { ouvrages: [] });
  else if (hauteur.length) fixer(5, "concerne", `Prévu au phasage : ${listeCourte(hauteur.map((o) => o.libelle + (o.par === "mot" ? ` (mot « ${o.detail} »)` : o.par === "lot" ? ` (lot ${libelleLot(o.detail, lots)})` : "")))}.`, { ouvrages: hauteur.map((o) => o.libelle) });
  else fixer(5, "non_concerne", `Aucun ouvrage de faux plafond, plafond, menuiserie extérieure, trémie ou toiture parmi les ${ouvrages.length} ouvrages du phasage.`, { ouvrages: [] });

  // ── Point 6 : électricité ──
  {
    const lotElec = lotsPhasage.includes(D.lotElectricite);
    const raison = !ph.ok ? `Toujours concerné ; ${ph.manque} : lot électricité non vérifié.`
      : lotElec ? `Toujours concerné ; lot ${libelleLot(D.lotElectricite, lots)} prévu au phasage : habilitation électrique exigée pour au moins un intervenant affecté.`
      : "Toujours concerné (réseaux existants) ; pas de lot électricité au phasage.";
    fixer(6, "concerne", raison, { habilitationExigee: lotElec });
  }

  // ── Point 7 : poussières et silice ──
  const lotsPoussiere = lotsPhasage.filter((l) => D.poussieres.lots.includes(l));
  const ouvPoussiere = ph.ok ? ouvragesDeclencheurs(ouvrages, D.poussieres, { parLot: false }) : [];
  if (!ph.ok) fixer(7, "a_completer", `${ph.manque[0].toUpperCase()}${ph.manque.slice(1)} : lots démolition, maçonnerie et cloisons non vérifiés.`, { lots: [], ouvrages: [] });
  else if (lotsPoussiere.length || ouvPoussiere.length) {
    const parts = [];
    if (lotsPoussiere.length) parts.push(`${lotsPoussiere.length > 1 ? "lots" : "lot"} ${lotsPoussiere.map((l) => libelleLot(l, lots)).join(", ")} au phasage`);
    if (ouvPoussiere.length) parts.push(`carrelage ou ponçage : ${listeCourte(ouvPoussiere.map((o) => o.libelle), 2)}`);
    fixer(7, "concerne", `${parts.join(" ; ")}.`.replace(/^./, (c) => c.toUpperCase()), { lots: lotsPoussiere, ouvrages: ouvPoussiere.map((o) => o.libelle) });
  } else fixer(7, "non_concerne", `Ni démolition, ni maçonnerie, ni cloisons, ni carrelage ou ponçage parmi les ${ouvrages.length} ouvrages du phasage.`, { lots: [], ouvrages: [] });

  // ── Point 8 : manutention ──
  {
    const aides = aidesManutention(commandes);
    if (batManque) fixer(8, "a_completer", `Étage et ascenseur inconnus : ${batManque}.`, { aides });
    else if (bat.etage === null || bat.etage === undefined) fixer(8, "a_completer", "Étage non renseigné dans le bloc Bâtiment de l'opération.", { aides });
    else if (Number(bat.etage) <= 0) fixer(8, "non_concerne", `Logement ${Number(bat.etage) === 0 ? "au rez-de-chaussée" : "en sous-sol"}.`, { aides });
    else if (bat.ascenseur_utilisable === true) fixer(8, "non_concerne", `Étage ${bat.etage} avec ascenseur utilisable.`, { aides });
    else if (bat.ascenseur_utilisable === false) fixer(8, "concerne", `Étage ${bat.etage} sans ascenseur utilisable.`, { aides });
    else fixer(8, "a_completer", `Étage ${bat.etage} ; ascenseur utilisable non renseigné dans le bloc Bâtiment.`, { aides });
  }

  // ── Point 9 : travail isolé ──
  // Un jour avec une seule personne sur ce chantier n'est pas isolé si au
  // moins un autre ouvrier Profero (ressource du planning, pas prestataire)
  // est planifié le même jour sur un autre chantier de la même opération
  // (décision de François du 25/11/2026).
  {
    if (!pl.ok) fixer(9, "a_completer", `${pl.manque[0].toUpperCase()}${pl.manque.slice(1)} : jours isolés non recherchés.`, { jours: [], couverts: [], illisibles: [] });
    else {
      const { jours, illisibles } = joursPlanifies(pl.valeur);
      const autres = new Map(); // date → noms sur les autres chantiers de l'opération
      const op = planningOperation && !planningOperation.erreur && Array.isArray(planningOperation.cellules) ? planningOperation : null;
      if (op) {
        joursPlanifies(op.cellules).jours.forEach((j) => autres.set(j.date, j.noms));
      }
      // Ouvriers Profero : noms reconnus dans les ressources, hors prestataires.
      const profero = new Set();
      if (rs.ok) rs.valeur.forEach((r) => { if (r?.kind !== "prestataire") [r?.nom_planning, r?.nom].map(txt).filter(Boolean).forEach((n) => profero.add(normaliser(n))); });
      const seuls = jours.filter((j) => j.noms.length === 1).map((j) => {
        const autresSurOperation = op ? (autres.get(j.date) || []).filter((n) => n !== j.noms[0]) : null;
        return {
          date: j.date, semaine: j.semaine, jour: j.jour, personne: j.noms[0], autresSurOperation,
          collegues: (autresSurOperation || []).filter((n) => profero.has(normaliser(n))),
        };
      });
      const couverts = seuls.filter((j) => j.collegues.length);
      const isoles = seuls.filter((j) => !j.collegues.length);
      const notes = [];
      if (illisibles.length) notes.push(`${pluriel(illisibles.length, "case du planning illisible", "cases du planning illisibles")} (${listeCourte(illisibles, 2)})`);
      if (seuls.length && !op && planningOperation) notes.push("planning des autres chantiers de l'opération illisible : collègues non recherchés");
      if (seuls.length && op && !rs.ok) notes.push(`${rs.manque} : collègues Profero non reconnus`);
      const suite = notes.length ? ` ; ${notes.join(" ; ")}` : "";
      const surOp = "par un collègue Profero sur un autre chantier de la même opération";
      if (!jours.length) fixer(9, "a_completer", `Aucun jour planifié avec du personnel sur ce chantier${suite}.`, { jours: [], couverts: [], illisibles });
      else if (isoles.length) {
        const dontCouverts = couverts.length ? ` ; ${pluriel(couverts.length, "autre jour seul sur le logement couvert", "autres jours seuls sur le logement couverts")} ${surOp}` : "";
        fixer(9, "concerne", `${pluriel(isoles.length, "jour planifié", "jours planifiés")} avec une seule personne sur ${jours.length} (${listeCourte(isoles.map((j) => `${dateFr(j.date)} ${j.personne}`), 3)})${dontCouverts}${suite}.`, { jours: isoles, couverts, illisibles });
      } else if (couverts.length) {
        fixer(9, "non_concerne", `${pluriel(couverts.length, "jour avec une seule personne sur le logement, couvert", "jours avec une seule personne sur le logement, tous couverts")} ${surOp} (${jours.length} jours planifiés)${suite}.`, { jours: [], couverts, illisibles });
      } else fixer(9, "non_concerne", `Toujours au moins 2 personnes sur les ${jours.length} jours planifiés${suite}.`, { jours: [], couverts: [], illisibles });
    }
  }

  // Statut retenu pour les points dont d'autres dépendent : la réponse de la
  // fiche si elle est choisie, sinon la proposition.
  const effectif = (cle) => {
    const r = statutRecu(fiche, cle);
    return { statut: r || P[cle].statut_propose, source: r ? "fiche" : "proposition" };
  };
  const src = (e) => (e.source === "fiche" ? "d'après la fiche" : "d'après la proposition");

  // ── Point 10 : EPI ──
  {
    const epi = [...EPI_DE_BASE];
    const raisons = ["Toujours concerné : chaussures et gants"];
    const e7 = effectif("p7"), e5 = effectif("p5"), e4 = effectif("p4");
    if (e7.statut === "concerne") { epi.push("masque_ffp3"); raisons.push(`masque FFP3 (poussières, point 7 ${src(e7)})`); }
    const demolition = lotsPhasage.includes(D.lotDemolition) || lotsFiche.includes(D.lotDemolition);
    if (demolition) { epi.push("auditives"); raisons.push(`protections auditives (lot ${libelleLot(D.lotDemolition, lots)})`); }
    if (e5.statut === "concerne") {
      const cases5 = estObjet(fiche?.reponses?.p5?.cases) ? fiche.reponses.p5.cases : {};
      const collectives = ["tremies_protegees", "echafaudage_verifie", "pirl_prevues", "protection_collective"].filter((c) => cases5[c] === true);
      if (!collectives.length) { epi.push("harnais"); raisons.push(`harnais (chute de hauteur ${src(e5)}, aucune protection collective cochée au point 5)`); }
    }
    if (amiantePresent) { epi.push("combinaison"); raisons.push("combinaison jetable (amiante présent au repérage)"); }
    else if (e4.statut === "concerne") raisons.push("combinaison à ajouter si le repérage trouve de l'amiante");
    if (!ph.ok) raisons.push(`${ph.manque} : EPI liés au phasage peut-être incomplets`);
    fixer(10, "concerne", `${raisons.join(" ; ")}.`, { epi });
  }

  // ── Point 11 : sanitaires ──
  {
    const dateFiche = estDateIso(db.date_depose_sanitaires) ? db.date_depose_sanitaires : null;
    const d = dateFiche || dateDepose;
    if (d) fixer(11, "concerne", `Toujours concerné ; dépose des sanitaires le ${dateFr(d)} (${dateFiche ? "date de la fiche, point 2" : "date du phasage"}) : solution de remplacement à prévoir à partir de cette date.`, { date_depose: d, cases: ["solution_apres_depose"] });
    else if (P.p2.valeurs.deposeSansDate) fixer(11, "concerne", "Toujours concerné ; dépose des sanitaires prévue au phasage mais non datée : solution de remplacement à prévoir, date à compléter.", { date_depose: null, cases: ["solution_apres_depose"] });
    else fixer(11, "concerne", `Toujours concerné ; ${ph.ok ? "pas de dépose des sanitaires au phasage" : `${ph.manque} : dépose des sanitaires non vérifiée`}.`, { date_depose: null, cases: [] });
  }

  // ── Point 12 : coordination ──
  {
    const it = Array.isArray(fiche?.intervenants) ? fiche.intervenants : [];
    const deLaFiche = [...new Set(it.filter((e) => estObjet(e) && e.type === "entreprise" && txt(e.nom)).map((e) => normaliser(e.nom)))];
    const noms = deLaFiche.length ? deLaFiche : [...new Set(P.p1.valeurs.entreprises.map((e) => normaliser(e.nom)))];
    const source = (plur) => (deLaFiche.length ? "au point 1 de la fiche" : `proposée${plur ? "s" : ""} au point 1`);
    if (noms.length > 1) fixer(12, "concerne", `${noms.length} entreprises ${source(true)}.`, { nbEntreprises: noms.length });
    else if (noms.length === 1 && (deLaFiche.length || (pl.ok && rs.ok))) fixer(12, "non_concerne", `Une seule entreprise ${source(false)}.`, { nbEntreprises: 1 });
    else fixer(12, "a_completer", `Entreprises inconnues : ${!pl.ok ? pl.manque : !rs.ok ? rs.manque : "aucune entreprise au point 1"}.`, { nbEntreprises: noms.length });
  }

  // ── Point 3 : synthèse des risques (après les points 4 à 12) ──
  {
    const risques = [];
    const e4 = effectif("p4"), e5 = effectif("p5"), e7 = effectif("p7");
    if (amiantePresent) risques.push("Amiante présent — intervention selon le mode opératoire SS4, arrêt immédiat si matériau suspect");
    else if (e4.statut === "concerne") risques.push("Amiante possible (bâtiment d'avant le 1er juillet 1997) — repérage avant travaux, arrêt immédiat si matériau suspect");
    if (e5.statut === "concerne") risques.push("Chute de hauteur — protections collectives et PIRL, pas d'escabeau comme poste de travail");
    risques.push("Électricité — consignation avant intervention, habilitation vérifiée");
    if (e7.statut === "concerne") risques.push("Poussières et silice — aspiration à la source, masque FFP3");
    const inconnus = ["p4", "p5", "p7"].filter((c) => effectif(c).statut === "a_completer").map((c) => P[c].numero);
    fixer(3, "concerne", `Ordre : amiante, chute de hauteur, électricité, poussières ; garder 2 ou 3 lignes${inconnus.length ? ` ; ${inconnus.length > 1 ? "points" : "point"} ${inconnus.join(", ")} à compléter : risque${inconnus.length > 1 ? "s" : ""} non évalué${inconnus.length > 1 ? "s" : ""}` : ""}.`, { risques });
  }

  return { points: P, liste: POINTS_FICHE.map((p) => P[p.cle]) };
}

/**
 * Quantités commandées sur le chantier, en aide au point 8 : plaques, sacs,
 * menuiseries, par unité. null + raison si les commandes sont illisibles.
 */
export function aidesManutention(commandes) {
  if (!commandes || commandes.erreur || !Array.isArray(commandes.lignes)) {
    return { erreur: `commandes illisibles${commandes?.erreur ? ` (${commandes.erreur})` : ""}`, categories: null };
  }
  const cat = { plaques: new Map(), sacs: new Map(), menuiseries: new Map() };
  const sansQuantite = { plaques: 0, sacs: 0, menuiseries: 0 };
  commandes.lignes.forEach((l) => {
    const t = normaliser(`${txt(l?.libelle)} ${txt(l?.unite)}`);
    const k = ["plaques", "sacs", "menuiseries"].find((c) => D.manutention[c].some((m) => contientMot(t, m)));
    if (!k) return;
    const q = Number(l.quantite);
    if (l.quantite === null || l.quantite === undefined || l.quantite === "" || !Number.isFinite(q)) { sansQuantite[k]++; return; }
    const u = txt(l.unite) || "sans unité";
    cat[k].set(u, (cat[k].get(u) || 0) + q);
  });
  const categories = {};
  for (const k of Object.keys(cat)) {
    categories[k] = { parUnite: [...cat[k].entries()].map(([unite, quantite]) => ({ unite, quantite: Math.round(quantite * 100) / 100 })), sansQuantite: sansQuantite[k] };
  }
  return { erreur: null, categories };
}

/** Texte court des aides du point 8 : « plaques 17 U ; sacs 2 U ; menuiseries aucune ». */
export function texteAidesManutention(aides) {
  if (!aides) return "";
  if (aides.erreur) return `Quantités commandées : ${aides.erreur}.`;
  const noms = { plaques: "plaques", sacs: "sacs", menuiseries: "menuiseries" };
  const parts = Object.entries(aides.categories).map(([k, v]) => {
    const q = v.parUnite.map((x) => `${String(x.quantite).replace(".", ",")} ${x.unite}`).join(" + ");
    const sq = v.sansQuantite ? `${q ? " + " : ""}${v.sansQuantite} ligne${v.sansQuantite > 1 ? "s" : ""} sans quantité` : "";
    return `${noms[k]} ${q || sq ? `${q}${sq}` : "aucune commande"}`;
  });
  return `Quantités commandées sur le chantier : ${parts.join(" ; ")}.`;
}

// ─── Divergences ─────────────────────────────────────────────────────────────

/**
 * Ce qui, dans la fiche enregistrée, ne correspond plus à la proposition
 * recalculée. Un point dont la fiche garde le statut d'une proposition déjà
 * vue (statut_propose identique) n'est pas signalé : la personne l'a déjà
 * tranché. Une proposition « à compléter » (donnée manquante) n'est pas une
 * divergence.
 * @returns {Array<{ numero, cle, message }>}
 */
export function divergencesPreRemplissage({ propositions, fiche, lots = [] } = {}) {
  const out = [];
  if (!propositions?.points || !fiche) return out;
  const P = propositions.points;
  const rep = estObjet(fiche.reponses) ? fiche.reponses : {};

  // Point 1 : prestataires du planning absents des entreprises saisies.
  const it = Array.isArray(fiche.intervenants) ? fiche.intervenants : [];
  const saisies = it.filter((e) => estObjet(e) && e.type === "entreprise" && txt(e.nom)).map((e) => normaliser(e.nom));
  if (saisies.length && P.p1) {
    P.p1.valeurs.entreprises.filter((e) => !saisies.includes(normaliser(e.nom))).forEach((e) => {
      out.push({ numero: 1, cle: "p1", message: e.nom === D.entreprisePrincipale ? `${e.nom} n'est pas dans les entreprises du point 1.` : `Le planning compte maintenant le prestataire « ${e.nom} » : absent du point 1 (revoir aussi le point 12).` });
    });
  }

  // Point 2 : lots du phasage absents, date de dépose différente.
  const db = estObjet(fiche.donnees_base) ? fiche.donnees_base : {};
  const lotsFiche = Array.isArray(db.lots) ? db.lots.map(txt) : [];
  if (lotsFiche.length && P.p2?.applicable) {
    const effets = { [D.lotDemolition]: "points 7 et 10", [D.lotElectricite]: "point 6" };
    P.p2.valeurs.lots.filter((l) => !lotsFiche.includes(l)).forEach((l) => {
      out.push({ numero: 2, cle: "p2", message: `Le phasage contient maintenant le lot ${libelleLot(l, lots)} : absent du point 2${effets[l] ? ` (revoir aussi les ${effets[l]})` : ""}.` });
    });
  }
  if (estDateIso(db.date_depose_sanitaires) && P.p2?.valeurs.date_depose_sanitaires && db.date_depose_sanitaires !== P.p2.valeurs.date_depose_sanitaires) {
    out.push({ numero: 2, cle: "p2", message: `Dépose des sanitaires : la fiche dit le ${dateFr(db.date_depose_sanitaires)}, le phasage le ${dateFr(P.p2.valeurs.date_depose_sanitaires)} : revoir les points 2 et 11.` });
  }

  // Points 4 à 12 : statut choisi ≠ statut proposé.
  POINTS_FICHE.filter((p) => p.section === "carte").forEach((p) => {
    const r = rep[p.cle];
    const prop = P[p.cle];
    if (!estObjet(r) || !prop) return;
    if (!STATUTS_POINT_COMPLETE.includes(r.statut) || !STATUTS_POINT_COMPLETE.includes(prop.statut_propose)) return;
    if (r.statut === prop.statut_propose) return;
    if (r.statut_propose === prop.statut_propose) return; // déjà vu et tranché
    out.push({
      numero: p.numero, cle: p.cle,
      message: `${prop.raison_proposition.replace(/\.$/, "")} : la proposition est maintenant « ${libelleStatutPoint(prop.statut_propose)} », la fiche dit « ${libelleStatutPoint(r.statut)} » — revoir le point ${p.numero}.`,
    });
  });
  return out;
}

// ─── Application (sur clic seulement) ────────────────────────────────────────

const casesProposees = (prop) => {
  if (!prop) return [];
  if (prop.numero === 10) return prop.valeurs.epi || [];
  if (prop.numero === 11) return prop.valeurs.cases || [];
  if (prop.numero === 9 && prop.statut_propose === "concerne") return ["jours_identifies"];
  return [];
};

/** Texte des jours isolés ajouté aux mesures du point 9. */
export function texteJoursIsoles(jours) {
  if (!jours?.length) return "";
  return `Jours avec une seule personne : ${jours.map((j) => `${dateFr(j.date)} (${j.personne})`).join(", ")}.`;
}

/**
 * Garde la trace, dans la réponse d'un point 4 à 12, de la proposition au vu
 * de laquelle la personne a choisi (statut_propose, raison_proposition). Ne
 * change ni le statut, ni les cases, ni les mesures.
 */
export function estampillerProposition(form, cle, prop) {
  if (!prop || !estObjet(form?.reponses?.[cle])) return form;
  const r = form.reponses[cle];
  return { ...form, reponses: { ...form.reponses, [cle]: { ...r, statut_propose: prop.statut_propose, raison_proposition: prop.raison_proposition } } };
}

/**
 * Applique une proposition au formulaire de l'écran (formulaireFiche) : nouvel
 * objet, l'ancien est inchangé. N'enlève jamais rien : une entreprise, un lot,
 * une case, une mesure ou une ligne de risque déjà saisis restent. Une
 * proposition « à compléter » ne change pas le statut.
 * @param {object} options { auteur, maintenant (ISO, de l'écran), nouvelId () => string }
 */
export function appliquerProposition(form, prop, { auteur = null, maintenant = null, nouvelId = null } = {}) {
  if (!form || !prop) return form;
  const n = prop.numero;
  if (n === 1) {
    const deja = (form.entreprises || []).map((e) => normaliser(e.nom));
    const ajout = prop.valeurs.entreprises.filter((e) => !deja.includes(normaliser(e.nom)))
      .map((e, i) => ({ id: nouvelId ? nouvelId() : `prop-${i + 1}`, nom: e.nom, activite: e.activite || "", contact: "", telephone: "" }));
    return ajout.length ? { ...form, entreprises: [...(form.entreprises || []), ...ajout] } : form;
  }
  if (n === 2) {
    if (!prop.applicable) return form;
    const lots = [...new Set([...(form.donnees?.lots || []), ...prop.valeurs.lots])];
    const donnees = { ...form.donnees, lots };
    if (prop.valeurs.date_depose_sanitaires) donnees.date_depose_sanitaires = prop.valeurs.date_depose_sanitaires;
    return { ...form, donnees };
  }
  if (n === 3) {
    const s = [...(form.synthese || [])];
    const presents = s.filter((l) => typeof l === "string").map(normaliser);
    const aAjouter = prop.valeurs.risques.filter((r) => !presents.includes(normaliser(r)));
    for (let i = 0; i < NB_RISQUES_APPLIQUES && aAjouter.length; i++) {
      if (s[i] === undefined || (typeof s[i] === "string" && !s[i].trim())) s[i] = aAjouter.shift();
    }
    return { ...form, synthese: s };
  }
  if (!prop.applicable) return form;
  const cle = `p${n}`;
  const avant = estObjet(form.reponses?.[cle]) ? form.reponses[cle] : {};
  const apres = { ...avant };
  if (STATUTS_POINT_COMPLETE.includes(prop.statut_propose)) apres.statut = prop.statut_propose;
  else if (!apres.statut) apres.statut = "a_completer";
  const cases = { ...(estObjet(avant.cases) ? avant.cases : {}) };
  casesProposees(prop).forEach((c) => { cases[c] = true; });
  if (Object.keys(cases).length) apres.cases = cases;
  if (n === 9 && prop.valeurs.jours?.length) {
    const t = texteJoursIsoles(prop.valeurs.jours);
    const m = typeof avant.mesures === "string" ? avant.mesures : "";
    if (!m.includes(t)) apres.mesures = m.trim() ? `${m.trim()}\n${t}` : t;
  }
  apres.statut_propose = prop.statut_propose;
  apres.raison_proposition = prop.raison_proposition;
  if (auteur) apres.maj_par = auteur;
  if (maintenant) apres.maj_le = maintenant;
  return { ...form, reponses: { ...(form.reponses || {}), [cle]: apres } };
}

/**
 * Ce que l'application changerait (pour désactiver le bouton quand il n'y a
 * rien à faire). Compare le formulaire avant / après.
 */
export function propositionDejaAppliquee(form, prop) {
  if (!form || !prop) return true;
  const apres = appliquerProposition(form, prop, {});
  const sansTrace = (f) => {
    if (!f?.reponses) return f;
    const r = {};
    for (const [k, v] of Object.entries(f.reponses)) {
      if (!estObjet(v)) { r[k] = v; continue; }
      const { statut_propose, raison_proposition, maj_par, maj_le, ...reste } = v; // eslint-disable-line no-unused-vars
      r[k] = reste;
    }
    return { ...f, reponses: r };
  };
  const cmp = (f) => JSON.stringify({ e: (f.entreprises || []).map((x) => normaliser(x.nom)), d: f.donnees, s: f.synthese, r: sansTrace(f).reponses?.[prop.cle] ?? null });
  return cmp(form) === cmp(apres);
}
