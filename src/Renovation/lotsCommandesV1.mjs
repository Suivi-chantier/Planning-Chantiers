// ─────────────────────────────────────────────────────────────────────────────
// Lignes de commande sans lot : proposer le lot (CR-6, partie 6D).
//
// Une ligne rattachée à un chantier DOIT avoir un lot (règle 1B, même test que
// la saisie : lignesChantierSansLot) : sans lot, ses matériaux ne sont déduits
// d'aucune enveloppe et le reste à commander par lot est faux. Les lignes
// anciennes n'en ont pas : ce module propose un lot, AVEC son explication et
// un niveau de confiance, et prépare l'écriture des seules lignes cochées.
//
// Indices, dans cet ordre (le premier qui répond fait la proposition) :
//   1. l'ouvrage rattaché à la ligne (ouvrage_id → lot de l'ouvrage) ;
//   2. le matériau prévu dans un ouvrage du phasage du chantier ;
//   3. le même matériau déjà commandé sur un lot de CE chantier ;
//   4. le même matériau commandé sur un lot d'un autre chantier ;
//   5. les autres lignes du même bon de commande ;
//   6. le même libellé (ou un libellé proche) commandé sur un lot ;
//   7. le fournisseur (sur ce chantier, puis partout) ;
//   8. l'historique du chantier (lot de la grande majorité de ses commandes,
//      ou seul lot du phasage avec des matériaux prévus).
// Niveaux de confiance :
//   élevée  : 1, 2 (un seul lot), 3 (toutes les commandes de ce matériau sur
//             ce chantier sont du même lot) ;
//   moyenne : 3 majoritaire (≥ 75 %), 4 (≥ 2 commandes, ≥ 75 %), 5 (toutes
//             les autres lignes du bon sur un même lot), 6 libellé identique
//             (≥ 2 commandes, ≥ 75 %) ;
//   faible  : tout le reste (vote moins net, libellé proche, fournisseur,
//             historique du chantier) ;
//   aucune  : aucun indice → AUCUN lot proposé (jamais inventé).
// Un niveau baisse d'un cran (élevée → moyenne → faible) quand un autre indice
// au moins « moyen » désigne un autre lot, quand le lot proposé n'a aucun
// ouvrage dans le phasage du chantier, ou quand le chantier n'a pas de phasage.
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// Façade : lotsCommandesV1.js.
// ─────────────────────────────────────────────────────────────────────────────
import { ressemblanceNomsV2, motsNomV2, nomNormaliseV2, NIVEAUX_CONFIANCE, libelleConfiance } from "./horsDevisV2.mjs";
import { dateImputationLigne, totalLignes } from "../chantierFinance.mjs";
import { lignesChantierSansLot } from "./saisieLotNature.mjs";

export { NIVEAUX_CONFIANCE, libelleConfiance };

const str = v => (v == null ? "" : String(v).trim());
const liste = v => (Array.isArray(v) ? v : []);
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pct = x => `${Math.round(x * 100)} %`;
const jj = d => (d ? String(d).slice(0, 10).split("-").reverse().slice(0, 2).join("/") : "");
const RANG = { eleve: 3, moyen: 2, faible: 1, aucune: 0 };
const baisser = c => (c === "eleve" ? "moyen" : c === "moyen" ? "faible" : c);
const pluriel = (n, s, p = `${s}s`) => `${n} ${n > 1 ? p : s}`;

/** Ligne de commande ramenée à une forme commune (table ou page Commandes). */
export function normaliserLigneCommandeV1(l) {
  const c = l?.commande || {};
  return {
    id: str(l?.id), chantier_id: str(l?.chantier_id), lot_id: str(l?.lot_id), ouvrage_id: str(l?.ouvrage_id),
    materiau_id: str(l?.materiau_id), commande_id: str(l?.commande_id),
    libelle: str(l?.libelle ?? l?.article), fournisseur: str(l?.fournisseur ?? l?.fournisseur_nom ?? c.fournisseur_nom),
    montant: r2(totalLignes([{ prix_total: l?.prix_total ?? l?.prix_ht, prix_unitaire: l?.prix_unitaire, quantite: l?.quantite }])),
    date: dateImputationLigne({ date_doc: l?.date_doc ?? c.date_doc, created_at: l?.created_at }),
  };
}

const fournisseurNorm = s => nomNormaliseV2(s);

// Vote : { lotId → nombre } → [{ lotId, n }] trié, total.
function compter(lignes) {
  const m = new Map();
  for (const l of lignes) m.set(l.lot_id, (m.get(l.lot_id) || 0) + 1);
  const votes = [...m.entries()].map(([lotId, n]) => ({ lotId, n })).sort((a, b) => b.n - a.n || a.lotId.localeCompare(b.lotId));
  return { votes, total: lignes.length };
}
const ajouter = (map, k, v) => { if (!k) return; if (!map.has(k)) map.set(k, []); map.get(k).push(v); };

/**
 * Index des lignes DÉJÀ rattachées à un lot connu (base des indices 3 à 8).
 * @param {Array} lignes  toutes les lignes (formes acceptées : voir normaliserLigneCommandeV1)
 * @param {Array} lots    [{ id, label }]
 */
export function indexerLignesAvecLotV1({ lignes = [], lots = [] } = {}) {
  const lotsConnus = new Set(liste(lots).map(l => str(l?.id)).filter(Boolean));
  const avecLot = liste(lignes).map(normaliserLigneCommandeV1).filter(l => l.lot_id && lotsConnus.has(l.lot_id));
  const ix = {
    lotsConnus, avecLot,
    parChantierMateriau: new Map(), parMateriau: new Map(), parCommande: new Map(), parLibelle: new Map(),
    parFournisseurChantier: new Map(), parFournisseur: new Map(), parChantier: new Map(), parMot: new Map(),
  };
  for (const l of avecLot) {
    if (l.materiau_id) { ajouter(ix.parChantierMateriau, `${l.chantier_id}|${l.materiau_id}`, l); ajouter(ix.parMateriau, l.materiau_id, l); }
    if (l.commande_id) ajouter(ix.parCommande, l.commande_id, l);
    const lib = nomNormaliseV2(l.libelle);
    if (lib) {
      if (!ix.parLibelle.has(lib)) { for (const w of motsNomV2(l.libelle)) ajouter(ix.parMot, w.slice(0, 4), lib); }
      ajouter(ix.parLibelle, lib, l);
    }
    const f = fournisseurNorm(l.fournisseur);
    if (f) { ajouter(ix.parFournisseurChantier, `${l.chantier_id}|${f}`, l); ajouter(ix.parFournisseur, f, l); }
    if (l.chantier_id) ajouter(ix.parChantier, l.chantier_id, l);
  }
  return ix;
}

/**
 * Lot proposé pour UNE ligne sans lot.
 * @param {object} ligne
 * @param {object} p
 * @param {object} p.index        indexerLignesAvecLotV1
 * @param {Array|null} p.ouvrages ouvrages du phasage du chantier (null = pas de phasage)
 * @param {Array}  p.lots
 * @returns {{ lotId: string|null, lotLabel: string|null, confiance, source, explication }}
 */
export function proposerLotLigneV1(ligne, { index, ouvrages = null, lots = [] } = {}) {
  const l = normaliserLigneCommandeV1(ligne);
  const ix = index;
  const labelLot = id => liste(lots).find(x => str(x?.id) === id)?.label || id;
  const connu = id => !!id && ix.lotsConnus.has(id);
  const ouvs = liste(ouvrages);
  const indices = [];
  const pousser = (lotId, confiance, source, explication) => { if (connu(lotId)) indices.push({ lotId, confiance, source, explication }); };
  const parVote = (lignesLot, source, regle) => {
    if (lignesLot.length === 0) return;
    const { votes, total } = compter(lignesLot);
    const v = votes[0], part = v.n / total;
    const c = regle(part, total, v.n);
    if (c) pousser(v.lotId, c.confiance, source, c.texte(labelLot(v.lotId), v.n, total, part));
  };

  // 1. Ouvrage rattaché
  if (l.ouvrage_id) {
    const o = ouvs.find(x => str(x?.id) === l.ouvrage_id);
    if (o && str(o.lot_id)) pousser(str(o.lot_id), "eleve", "ouvrage", `rattachée à l'ouvrage « ${str(o.libelle) || "(sans libellé)"} » du lot ${labelLot(str(o.lot_id))}`);
  }
  // 2. Matériau prévu dans le phasage
  if (l.materiau_id) {
    const prevus = ouvs.filter(o => str(o?.lot_id) && liste(o.materiaux_liens).some(ml => str(ml?.materiau_id) === l.materiau_id));
    const lotsPrevus = [...new Set(prevus.map(o => str(o.lot_id)))];
    if (lotsPrevus.length === 1) {
      pousser(lotsPrevus[0], "eleve", "materiau_prevu", prevus.length === 1
        ? `matériau prévu dans l'ouvrage « ${str(prevus[0].libelle) || "(sans libellé)"} » du lot ${labelLot(lotsPrevus[0])}`
        : `matériau prévu dans ${prevus.length} ouvrages du lot ${labelLot(lotsPrevus[0])}`);
    } else if (lotsPrevus.length > 1) {
      const { votes } = compter(prevus.map(o => ({ lot_id: str(o.lot_id) })));
      pousser(votes[0].lotId, "faible", "materiau_prevu", `matériau prévu dans des ouvrages de plusieurs lots (${lotsPrevus.map(labelLot).join(", ")})`);
    }
    // 3. Même matériau, ce chantier
    parVote(ix.parChantierMateriau.get(`${l.chantier_id}|${l.materiau_id}`) || [], "materiau_chantier", (part, total, n) => ({
      confiance: part === 1 ? "eleve" : part >= 0.75 ? "moyen" : "faible",
      texte: lab => `même matériau que ${part === 1 ? pluriel(n, "commande") : `${n} commandes sur ${total}`} de ce chantier, lot ${lab}`,
    }));
    // 4. Même matériau, autres chantiers
    parVote((ix.parMateriau.get(l.materiau_id) || []).filter(x => x.chantier_id !== l.chantier_id), "materiau_ailleurs", (part, total, n) => ({
      confiance: total >= 2 && part >= 0.75 ? "moyen" : "faible",
      texte: lab => `même matériau que ${n === total ? pluriel(n, "commande") : `${n} commandes sur ${total}`} du lot ${lab} (autres chantiers)`,
    }));
  }
  // 5. Même bon de commande
  if (l.commande_id) {
    parVote((ix.parCommande.get(l.commande_id) || []).filter(x => x.id !== l.id && x.chantier_id === l.chantier_id), "meme_bon", (part, total, n) => (part >= 0.75 ? {
      confiance: part === 1 ? "moyen" : "faible",
      texte: lab => `${part === 1 ? (n > 1 ? `les ${n} autres lignes` : "l'autre ligne") : `${n} des ${total} autres lignes`} de ce bon${l.fournisseur ? ` (${l.fournisseur}${l.date ? ` du ${jj(l.date)}` : ""})` : ""} ${n > 1 ? "sont" : "est"} du lot ${lab}`,
    } : null));
  }
  // 6. Libellé identique, puis proche
  const lib = nomNormaliseV2(l.libelle);
  if (lib) {
    parVote(ix.parLibelle.get(lib) || [], "libelle", (part, total, n) => (part >= 0.5 ? {
      confiance: total >= 2 && part >= 0.75 ? "moyen" : "faible",
      texte: lab => `même libellé que ${n === total ? pluriel(n, "commande") : `${n} commandes sur ${total}`} du lot ${lab}`,
    } : null));
    const candidats = new Set();
    for (const w of motsNomV2(l.libelle)) (ix.parMot.get(w.slice(0, 4)) || []).forEach(c => candidats.add(c));
    candidats.delete(lib);
    const proches = [];
    for (const c of candidats) {
      const lignesC = ix.parLibelle.get(c) || [];
      if (lignesC.length && ressemblanceNomsV2(l.libelle, lignesC[0].libelle) >= 0.7) proches.push(...lignesC);
    }
    parVote(proches, "libelle_proche", (part, total, n) => (total >= 2 && part >= 0.75 ? {
      confiance: "faible",
      texte: lab => `libellé proche de ${n === total ? pluriel(n, "commande") : `${n} commandes sur ${total}`} du lot ${lab}`,
    } : null));
  }
  // 7. Fournisseur (ce chantier, puis partout)
  const f = fournisseurNorm(l.fournisseur);
  if (f) {
    parVote(ix.parFournisseurChantier.get(`${l.chantier_id}|${f}`) || [], "fournisseur_chantier", (part, total, n) => (total >= 3 && part >= 0.8 ? {
      confiance: "faible",
      texte: lab => `${l.fournisseur} : ${n} commandes sur ${total} de ce chantier sont du lot ${lab}`,
    } : null));
    parVote(ix.parFournisseur.get(f) || [], "fournisseur", (part, total, n) => (total >= 10 && part >= 0.8 ? {
      confiance: "faible",
      texte: lab => `${l.fournisseur} : ${pct(part)} de ses commandes (${n} sur ${total}) sont du lot ${lab}`,
    } : null));
  }
  // 8. Historique du chantier
  parVote(ix.parChantier.get(l.chantier_id) || [], "historique", (part, total, n) => (total >= 5 && part >= 0.8 ? {
    confiance: "faible",
    texte: lab => `${pct(part)} des commandes de ce chantier (${n} sur ${total}) sont du lot ${lab}`,
  } : null));
  const lotsMat = [...new Set(ouvs.filter(o => str(o?.lot_id) && (parseFloat(o.cout_materiaux) || 0) > 0).map(o => str(o.lot_id)))];
  if (lotsMat.length === 1) pousser(lotsMat[0], "faible", "historique", `seul lot du phasage de ce chantier avec des matériaux prévus : ${labelLot(lotsMat[0])}`);

  if (indices.length === 0) {
    return { lotId: null, lotLabel: null, confiance: "aucune", source: null,
      explication: ouvrages == null ? "aucun indice (chantier sans phasage, aucune commande comparable)" : "aucun indice : ni ouvrage, ni matériau, ni libellé, ni fournisseur, ni historique comparables" };
  }
  const choisi = indices[0];
  let confiance = choisi.confiance;
  const notes = [];
  const contraire = indices.slice(1).find(x => x.lotId !== choisi.lotId && RANG[x.confiance] >= RANG.moyen);
  if (contraire) { confiance = baisser(confiance); notes.push(`mais ${contraire.explication}`); }
  const lotsPhasage = new Set(ouvs.map(o => str(o?.lot_id)).filter(Boolean));
  if (ouvrages == null || ouvs.length === 0) { confiance = baisser(confiance); notes.push("attention : chantier sans phasage"); }
  else if (lotsPhasage.size > 0 && !lotsPhasage.has(choisi.lotId)) { confiance = baisser(confiance); notes.push(`attention : aucun ouvrage du lot ${labelLot(choisi.lotId)} dans le phasage de ce chantier`); }
  const accords = [...new Set(indices.slice(1).filter(x => x.lotId === choisi.lotId && x.source !== choisi.source).map(x => LIBELLES_SOURCE[x.source]))];
  if (accords.length) notes.push(`même lot d'après : ${accords.join(", ")}`);
  const texte = choisi.explication.charAt(0).toUpperCase() + choisi.explication.slice(1);
  return { lotId: choisi.lotId, lotLabel: labelLot(choisi.lotId), confiance, source: choisi.source,
    explication: notes.length ? `${texte} — ${notes.join(" ; ")}` : texte };
}

export const LIBELLES_SOURCE = Object.freeze({
  ouvrage: "l'ouvrage", materiau_prevu: "le matériau prévu", materiau_chantier: "le matériau (ce chantier)",
  materiau_ailleurs: "le matériau (autres chantiers)", meme_bon: "le bon de commande", libelle: "le libellé",
  libelle_proche: "un libellé proche", fournisseur_chantier: "le fournisseur (ce chantier)", fournisseur: "le fournisseur",
  historique: "l'historique du chantier",
});

/**
 * Toutes les lignes rattachées à un chantier sans lot, avec leur proposition.
 * @param {object} p
 * @param {Array}  p.lignes     toutes les lignes de commande (avec et sans lot)
 * @param {object} p.phasages   { [chantierId]: ouvrages } (absent = pas de phasage)
 * @param {Array}  p.lots
 * @returns {{ lignes: Array, resume: { eleve, moyen, faible, aucune, total } }}  chaque niveau : { nb, montant }
 */
export function propositionsLotsSansLotV1({ lignes = [], phasages = {}, lots = [] } = {}) {
  const toutes = liste(lignes);
  const index = indexerLignesAvecLotV1({ lignes: toutes, lots });
  const sansLot = lignesChantierSansLot(toutes).map(i => toutes[i]);
  const out = sansLot.map(brute => {
    const l = normaliserLigneCommandeV1(brute);
    const ouvrages = Object.prototype.hasOwnProperty.call(phasages || {}, l.chantier_id) ? liste(phasages[l.chantier_id]) : null;
    return { ...l, proposition: proposerLotLigneV1(brute, { index, ouvrages, lots }) };
  });
  const resume = { total: { nb: out.length, montant: r2(out.reduce((s, x) => s + x.montant, 0)) } };
  for (const n of NIVEAUX_CONFIANCE) {
    const l = out.filter(x => x.proposition.confiance === n.code);
    resume[n.code] = { nb: l.length, montant: r2(l.reduce((s, x) => s + x.montant, 0)) };
  }
  return { lignes: out, resume };
}

/**
 * Écritures à faire pour la sélection : SEULES les lignes cochées, chacune avec
 * le lot choisi (la proposition, ou le lot modifié à la main — c'est toujours
 * le lot de la sélection qui est écrit). Une ligne sans lot choisi, avec un
 * lot inconnu, ou qui n'est plus « sans lot » est refusée et dite.
 * Recalcul : pour chaque chantier touché, le relevé journalier est à
 * recalculer depuis la plus ancienne date d'imputation des lignes changées
 * (un lot posé change le reste à commander par lot et les matériaux imputés).
 * @param {Array} propositions  propositionsLotsSansLotV1().lignes
 * @param {Array} selection     [{ id, lot_id }]
 */
export function planAffectationLotsV1({ propositions = [], selection = [], lots = [] } = {}) {
  const connus = new Set(liste(lots).map(l => str(l?.id)).filter(Boolean));
  const parId = new Map(liste(propositions).map(p => [str(p.id), p]));
  const updates = [], refusees = [];
  const recalc = new Map();
  const vus = new Set();
  for (const s of liste(selection)) {
    const id = str(s?.id), lot = str(s?.lot_id);
    if (!id || vus.has(id)) continue;
    vus.add(id);
    const p = parId.get(id);
    if (!p) { refusees.push({ id, raison: "ligne qui n'est plus « sans lot » (rechargez la page)" }); continue; }
    if (!lot) { refusees.push({ id, raison: "lot à choisir" }); continue; }
    if (!connus.has(lot)) { refusees.push({ id, raison: "lot inconnu" }); continue; }
    updates.push({ id, lot_id: lot, chantier_id: p.chantier_id, manuel: lot !== p.proposition?.lotId });
    if (p.chantier_id) {
      const d = p.date || null, cur = recalc.get(p.chantier_id);
      if (!recalc.has(p.chantier_id) || (d && (!cur || d < cur))) recalc.set(p.chantier_id, d);
    }
  }
  const parLot = {};
  updates.forEach(u => { parLot[u.lot_id] = (parLot[u.lot_id] || []).concat(u.id); });
  return { updates, refusees, parLot, recalculs: [...recalc.entries()].map(([chantierId, date]) => ({ chantierId, date })) };
}

/** « 12 lignes : 8 Plomberie sanitaire, 4 Électricité — Appliquer » */
export function texteConfirmationLotsV1(plan, lots = []) {
  const n = liste(plan?.updates).length;
  if (n === 0) return "Aucune ligne sélectionnée";
  const labelLot = id => liste(lots).find(x => str(x?.id) === id)?.label || id;
  const parts = Object.entries(plan.parLot || {}).sort((a, b) => b[1].length - a[1].length).map(([lot, ids]) => `${ids.length} ${labelLot(lot)}`);
  return `${n} ligne${n > 1 ? "s" : ""} : ${parts.join(", ")} — Appliquer`;
}
