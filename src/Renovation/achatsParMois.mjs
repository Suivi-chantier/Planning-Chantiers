// achatsParMois — « Achats par mois de commande » (vue de la page Encours
// fournisseurs). Module PUR : aucun accès Supabase, aucune horloge, aucun effet
// de bord. Les données arrivent en paramètre, le mois courant aussi.
//
// Encours range chaque montant au mois où on le PAIE (échéance de la facture).
// Ici on range chaque achat au mois où on l'a COMMANDÉ / ACHETÉ :
//
//  | Élément                                   | Mois retenu                 | Montant retenu                          |
//  |-------------------------------------------|-----------------------------|-----------------------------------------|
//  | BL / ticket / bon de commande non facturé | date_doc (repli created_at) | montant_ht, sinon Σ lignes              |
//  | BL / ticket rapproché d'une facture       | date_doc DU BL              | montant facturé (facture_bl), + écart   |
//  | BL présent sur la facture, jamais saisi   | date_livraison (repli fact.)| montant facturé                         |
//  | Frais de facture (facture_frais/frais_ht) | date de la facture          | montant du frais                        |
//  | Avoir fournisseur                         | date de l'avoir             | en négatif                              |
//  | Facture directe sans BL                   | date de la facture          | montant HT de la facture                |
//
// Exclusions (comme Encours) : source = 'migration' ; bon de commande remplacé
// par son BL (remplace_par_id) — le BL hérite alors de la date du bon.
//
// Répartition par chantier : le montant retenu d'un document est réparti au
// prorata de ses lignes (commande_lignes.prix_total) par chantier, au centime
// près, pour que la somme des chantiers d'un mois soit EXACTEMENT le total du
// mois. Une ligne sans chantier, un document sans ligne, des frais sans
// chantier ou la part non ventilée d'un avoir vont dans « À affecter »
// (chantierId = null).
import { normaliserNumero } from "./rapprochementFactures.mjs";

export const A_AFFECTER = "__a_affecter__"; // valeur du filtre chantier pour « À affecter »

const cts = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
const eurs = (c) => c / 100;
const jour = (d) => (d ? String(d).slice(0, 10) : "");
const normNom = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Clé de numéro pour reconnaître un BL de facture déjà saisi chez nous.
const cleNumero = (n, regles) =>
  normaliserNumero(n, { retirerAgence: true, retirerClient: true, ...(regles || {}) });

// Répartit `total` (centimes) au prorata de `poids` (centimes) — méthode des
// plus forts restes : la somme des parts vaut exactement `total`.
export function repartirCentimes(total, poids) {
  const somme = poids.reduce((s, p) => s + p, 0);
  if (!poids.length || somme === 0) return null;
  const brut = poids.map(p => (total * p) / somme);
  const parts = brut.map(Math.trunc);
  let reste = total - parts.reduce((s, p) => s + p, 0);
  const ordre = brut.map((b, i) => [Math.abs(b - parts[i]), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const pas = Math.sign(reste);
  for (let k = 0; reste !== 0; k = (k + 1) % ordre.length) { parts[ordre[k][1]] += pas; reste -= pas; }
  return parts;
}

// Liste à plat de tous les achats, chacun avec son mois, son montant retenu
// (centimes) et sa répartition par chantier.
export function listerAchats({
  commandes = [], lignes = [], factureBl = [], facturesFrais = [], avoirs = [], factures = [],
  fournisseurs = [], moisCourant = "",
} = {}) {
  const facturesActives = factures.filter(f => f && f.statut !== "archivee");
  const factureById = new Map(facturesActives.map(f => [f.id, f]));
  const fournById = new Map(fournisseurs.map(f => [f.id, f]));
  const fournByNom = new Map(fournisseurs.filter(f => f.nom).map(f => [normNom(f.nom), f]));
  const fournOf = (id, nom) => fournById.get(id) || fournByNom.get(normNom(nom)) || null;

  const lignesParCmd = new Map();
  for (const l of lignes) {
    if (!lignesParCmd.has(l.commande_id)) lignesParCmd.set(l.commande_id, []);
    lignesParCmd.get(l.commande_id).push(l);
  }
  // Lignes de facture (BL) des factures non archivées.
  const blActifs = factureBl.filter(b => factureById.has(b.facture_id));
  const blParCmd = new Map();
  for (const b of blActifs) if (b.commande_id) {
    if (!blParCmd.has(b.commande_id)) blParCmd.set(b.commande_id, []);
    blParCmd.get(b.commande_id).push(b);
  }
  // Date héritée : bon de commande remplacé par son BL -> le BL prend la date du bon.
  const dateHeritee = new Map();
  for (const c of commandes) if (c.remplace_par_id && c.source !== "migration") {
    const d = jour(c.date_doc) || jour(c.created_at);
    const prev = dateHeritee.get(c.remplace_par_id);
    if (d && (!prev || d < prev)) dateHeritee.set(c.remplace_par_id, d);
  }

  const achats = [];
  const cmdRetenues = commandes.filter(c => c.source !== "migration" && !c.remplace_par_id);
  const numerosSaisis = new Set(); // fournisseur|numéro normalisé

  for (const c of cmdRetenues) {
    const ls = lignesParCmd.get(c.id) || [];
    const sommeLignes = ls.reduce((s, l) => s + (cts(l.prix_total) || 0), 0);
    const saisi = cts(c.montant_ht) ?? sommeLignes;
    const fourn = fournOf(c.fournisseur_id, c.fournisseur_nom);
    if (c.doc_numero) numerosSaisis.add(`${c.fournisseur_id || normNom(c.fournisseur_nom)}|${cleNumero(c.doc_numero, fourn?.regles_numero)}`);

    const liens = blParCmd.get(c.id) || [];
    const montantsFactures = liens.map(b => cts(b.montant_ht)).filter(v => v != null);
    let montant = saisi, facture = false, ecart = null, factureId = null;
    if (liens.length) {
      facture = true;
      factureId = liens[0].facture_id;
      if (montantsFactures.length) {
        montant = montantsFactures.reduce((s, v) => s + v, 0);
        ecart = montant - saisi;
        if (ecart === 0) ecart = null;
      }
    } else if (c.facture_id && factureById.has(c.facture_id)) {
      facture = true; factureId = c.facture_id;
    } else if (c.statut_facturation === "facture") {
      facture = true; // ticket / achat comptant : le ticket fait office de facture
    }
    if (montant === 0 && saisi === 0) continue;

    const date = dateHeritee.get(c.id) || jour(c.date_doc) || jour(c.created_at);
    // Répartition par chantier au prorata des lignes.
    const parCh = new Map();
    for (const l of ls) {
      const k = l.chantier_id || null;
      parCh.set(k, (parCh.get(k) || 0) + (cts(l.prix_total) || 0));
    }
    const cles = [...parCh.keys()];
    const parts = repartirCentimes(montant, cles.map(k => parCh.get(k)));
    const parChantier = parts ? cles.map((k, i) => ({ chantierId: k, montant: parts[i] })) : [{ chantierId: null, montant }];

    const fact = factureId ? factureById.get(factureId) : null;
    achats.push({
      id: c.id, kind: "cmd", type: c.doc_type || "bl", numero: c.doc_numero || "",
      date, mois: date.slice(0, 7),
      fournisseurId: c.fournisseur_id || null, fournisseur: c.fournisseur_nom || "Sans fournisseur",
      saisi, montant, facture, ecart, factureNumero: fact?.numero || "",
      absentFacture: false, parChantier,
    });
  }

  // BL présents sur une facture mais jamais saisis chez nous.
  for (const b of blActifs) {
    if (b.commande_id) continue;
    const f = factureById.get(b.facture_id);
    if (f.type_document === "avoir") continue;
    const fourn = fournOf(f.fournisseur_id, f.fournisseur_nom);
    const cle = `${f.fournisseur_id || normNom(f.fournisseur_nom)}|${cleNumero(b.bl_numero, fourn?.regles_numero)}`;
    if (b.bl_numero && numerosSaisis.has(cle)) continue; // déjà compté via notre saisie
    const montant = cts(b.montant_ht);
    if (!montant) continue;
    const date = jour(b.date_livraison) || jour(f.date_facture) || jour(f.created_at);
    achats.push({
      id: `bl:${b.id || b.facture_id + ":" + b.bl_numero}`, kind: "bl_non_saisi", type: "bl", numero: b.bl_numero || "",
      date, mois: date.slice(0, 7),
      fournisseurId: f.fournisseur_id || null, fournisseur: f.fournisseur_nom || "Sans fournisseur",
      saisi: null, montant, facture: true, ecart: null, factureNumero: f.numero || "",
      absentFacture: false, parChantier: [{ chantierId: null, montant }],
    });
  }

  // Factures : frais, avoirs, factures directes.
  const fraisParFacture = new Map();
  for (const x of facturesFrais) {
    if (!fraisParFacture.has(x.facture_id)) fraisParFacture.set(x.facture_id, []);
    fraisParFacture.get(x.facture_id).push(x);
  }
  const imputParAvoir = new Map();
  for (const a of avoirs) {
    if (!imputParAvoir.has(a.facture_id)) imputParAvoir.set(a.facture_id, []);
    imputParAvoir.get(a.facture_id).push(a);
  }
  const facturesAvecCmd = new Set(cmdRetenues.filter(c => c.facture_id).map(c => c.facture_id));
  const facturesAvecBl = new Set(blActifs.map(b => b.facture_id));

  for (const f of facturesActives) {
    const date = jour(f.date_facture) || jour(f.created_at);
    const base = {
      date, mois: date.slice(0, 7),
      fournisseurId: f.fournisseur_id || null, fournisseur: f.fournisseur_nom || "Sans fournisseur",
      saisi: null, facture: true, ecart: null, factureNumero: f.numero || "", absentFacture: false,
    };
    if (f.type_document === "avoir") {
      const montant = -Math.abs(cts(f.montant_ht) || 0);
      if (!montant) continue;
      const parChantier = [];
      let ventile = 0;
      for (const a of imputParAvoir.get(f.id) || []) {
        const m = -Math.abs(cts(a.montant_ht) || 0);
        if (!m) continue;
        parChantier.push({ chantierId: a.chantier_id || null, montant: m });
        ventile += m;
      }
      if (montant - ventile !== 0) parChantier.push({ chantierId: null, montant: montant - ventile });
      achats.push({ ...base, id: `avoir:${f.id}`, kind: "avoir", type: "avoir", numero: f.numero || "", montant, parChantier });
      continue;
    }
    if (!facturesAvecBl.has(f.id) && !facturesAvecCmd.has(f.id)) {
      // Facture directe, sans BL : tout le montant HT au mois de la facture.
      const montant = cts(f.montant_ht) || 0;
      if (!montant) continue;
      achats.push({ ...base, id: `fact:${f.id}`, kind: "facture_directe", type: "facture", numero: f.numero || "", montant,
        parChantier: [{ chantierId: null, montant }] });
      continue;
    }
    const frais = fraisParFacture.get(f.id) || [];
    if (frais.length) {
      frais.forEach((x, i) => {
        const montant = cts(x.montant_ht) || 0;
        if (!montant) return;
        achats.push({ ...base, id: `frais:${x.id || f.id + ":" + i}`, kind: "frais", type: "frais", numero: f.numero || "",
          libelle: x.libelle || "Frais", montant, parChantier: [{ chantierId: x.chantier_id || null, montant }] });
      });
    } else if (cts(f.frais_ht) > 0) {
      const montant = cts(f.frais_ht);
      achats.push({ ...base, id: `frais:${f.id}`, kind: "frais", type: "frais", numero: f.numero || "",
        libelle: "Frais de facture", montant, parChantier: [{ chantierId: null, montant }] });
    }
  }

  // Signal « absent de la facture » : mois clos, fournisseur récapitulatif,
  // facture du mois déjà saisie, et ce BL toujours en attente de facture.
  if (moisCourant) {
    const factureDuMois = new Set();
    for (const f of facturesActives) {
      if (f.type_document === "avoir") continue;
      const m = (jour(f.date_facture) || jour(f.created_at)).slice(0, 7);
      const k = f.fournisseur_id || normNom(f.fournisseur_nom);
      factureDuMois.add(`${k}|${m}`);
      if (/^\d{4}-\d{2}$/.test(f.periode || "")) factureDuMois.add(`${k}|${f.periode}`);
    }
    for (const a of achats) {
      if (a.kind !== "cmd" || a.facture || !a.mois || a.mois >= moisCourant) continue;
      const fourn = fournOf(a.fournisseurId, a.fournisseur);
      if (fourn?.type_facturation !== "recapitulative") continue;
      const k = a.fournisseurId || normNom(a.fournisseur);
      if (factureDuMois.has(`${k}|${a.mois}`) || (fourn?.id && factureDuMois.has(`${fourn.id}|${a.mois}`))) a.absentFacture = true;
    }
  }
  return achats;
}

// Regroupe les achats par mois (du plus récent au plus ancien), avec les
// sous-vues par fournisseur et par chantier. Montants en euros.
// filtres : { fournisseur, chantier (id, ou A_AFFECTER), statut: "tout"|"facture"|"en_attente" }
export function regrouperAchatsParMois(donnees = {}, filtres = {}) {
  const achats = listerAchats(donnees);
  const { fournisseur = "", chantier = "", statut = "tout" } = filtres;
  const moisMap = new Map();
  const vide = () => ({ achete: 0, facture: 0, enAttente: 0, ecart: 0, nbDocs: 0 });
  const ajouter = (t, montant, a, ecart) => {
    t.achete += montant;
    if (a.facture) t.facture += montant; else t.enAttente += montant;
    t.ecart += ecart;
    t.nbDocs += 1;
  };

  for (const a of achats) {
    if (fournisseur && a.fournisseur !== fournisseur) continue;
    if (statut === "facture" && !a.facture) continue;
    if (statut === "en_attente" && a.facture) continue;
    let tranches = a.parChantier;
    if (chantier) {
      const cible = chantier === A_AFFECTER ? null : chantier;
      tranches = tranches.filter(t => t.chantierId === cible);
      if (!tranches.length) continue;
    }
    const montant = tranches.reduce((s, t) => s + t.montant, 0);
    // Écart rapporté à la part retenue (proportionnel si un chantier est filtré).
    const ecart = a.ecart == null ? 0 : (a.montant ? Math.round((a.ecart * montant) / a.montant) : 0);

    const m = a.mois || "____";
    if (!moisMap.has(m)) moisMap.set(m, { mois: m, tot: vide(), fourn: new Map(), ch: new Map() });
    const g = moisMap.get(m);
    ajouter(g.tot, montant, a, ecart);
    if (!g.fourn.has(a.fournisseur)) g.fourn.set(a.fournisseur, { nom: a.fournisseur, ...vide(), docs: [] });
    const pf = g.fourn.get(a.fournisseur);
    ajouter(pf, montant, a, ecart);
    pf.docs.push({ ...a, montantRetenu: montant });
    for (const t of tranches) {
      const k = t.chantierId;
      if (!g.ch.has(k)) g.ch.set(k, { chantierId: k, ...vide() });
      ajouter(g.ch.get(k), t.montant, a, 0);
    }
  }

  const enEuros = (t) => ({ ...t, achete: eurs(t.achete), facture: eurs(t.facture), enAttente: eurs(t.enAttente), ecart: eurs(t.ecart) });
  return [...moisMap.values()]
    .sort((a, b) => b.mois.localeCompare(a.mois))
    .map(g => ({
      mois: g.mois,
      ...enEuros(g.tot),
      parFournisseur: [...g.fourn.values()]
        .sort((a, b) => b.achete - a.achete || a.nom.localeCompare(b.nom))
        .map(pf => ({
          ...enEuros(pf),
          absentFacture: pf.docs.some(d => d.absentFacture),
          docs: pf.docs
            .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.numero).localeCompare(String(b.numero)))
            .map(d => ({
              id: d.id, kind: d.kind, type: d.type, numero: d.numero, libelle: d.libelle || "", date: d.date,
              montant: eurs(d.montantRetenu), saisi: d.saisi == null ? null : eurs(d.saisi),
              facture: d.facture, ecart: d.ecart == null ? null : eurs(d.ecart),
              factureNumero: d.factureNumero, absentFacture: d.absentFacture,
            })),
        })),
      // Chantiers par montant décroissant, « À affecter » toujours en dernier.
      parChantier: [...g.ch.values()]
        .sort((a, b) => (a.chantierId === null) - (b.chantierId === null) || b.achete - a.achete)
        .map(enEuros),
    }));
}

// Ensemble des chantiers rencontrés (pour le filtre), « À affecter » compris.
export function chantiersDesAchats(donnees = {}) {
  const ids = new Set();
  for (const a of listerAchats(donnees)) for (const t of a.parChantier) ids.add(t.chantierId);
  return [...ids];
}
