// ─────────────────────────────────────────────────────────────────────────────
// FACTURATION CLIENT — échéancier contractuel, rapprochement des factures
// importées et état de la facturation d'un chantier. AUCUN affichage, AUCUN
// accès base : module pur, consommé par FacturationChantier.jsx (bloc de la
// fiche chantier), par la frise du cycle de vie (étapes de la phase Travaux)
// et par la tâche IA d'extraction (api/_ia/taches/facture_client.js).
//
// LE MODÈLE
// ─────────
// Un chantier se facture par ÉCHÉANCES, chacune un pourcentage du marché :
//   acompte 50 % → démarrage 20 % → situation n° 1 15 % → n° 2 10 % → solde 5 %
// (défaut Profero ; réglable en Admin et ajustable chantier par chantier).
//
// Chaque échéance a deux états successifs, jamais confondus :
//   ÉMISE     — la facture est partie chez le client (import du PDF : montant,
//               numéro et date sont lus par l'IA puis rapprochés ici).
//   ENCAISSÉE — l'argent est arrivé (action explicite, date + montant reçu).
// Émettre n'est pas encaisser : c'est l'encaissement qui valide l'étape
// « Acompte encaissé » du cycle de vie, jamais l'émission.
//
// LE RAPPROCHEMENT est déterministe et explicable — le modèle IA ne fait que
// LIRE la facture (numéro, date, montants, mentions), il ne choisit jamais
// l'échéance : c'est rapprocherFacture() qui décide, sur le montant d'abord,
// les mentions ensuite, et qui dit pourquoi. Une proposition reste toujours
// modifiable à la main avant enregistrement : on ne coche pas une ligne
// d'argent sur la foi d'une lecture automatique.
//
// Extension .mjs = parsable ESM par Node sans build (tests, /api) ; le front
// importe la façade src/Renovation/facturationClient.js.
// ─────────────────────────────────────────────────────────────────────────────

// ── Échéancier par défaut (réglage Admin "echeancier_facturation") ──────────
// declencheur = quand la ligne passe « à émettre » (signalé, jamais bloquant) :
//   { type: "signature" }                 → devis signé (étape devis_signe)
//   { type: "avancement", seuil: 40 }     → avancement des travaux ≥ 40 %
//   { type: "reception" }                 → PV de réception (ou 100 %)
// etape_cycle_vie = étape EXISTANTE du cycle de vie validée par l'ENCAISSEMENT
// de cette ligne (aujourd'hui seul l'acompte en a une). Les autres lignes
// produisent leur propre étape dans la phase Travaux (etapesFacturationTravaux).
export const ECHEANCIER_DEFAUT = [
  { id: "acompte",     nom: "Facture d'acompte",         pct: 50, declencheur: { type: "signature" },          etape_cycle_vie: "acompte_encaisse" },
  { id: "demarrage",   nom: "Facture de démarrage",      pct: 20, declencheur: { type: "avancement", seuil: 1 } },
  { id: "situation_1", nom: "Facture de situation n° 1", pct: 15, declencheur: { type: "avancement", seuil: 40 } },
  { id: "situation_2", nom: "Facture de situation n° 2", pct: 10, declencheur: { type: "avancement", seuil: 70 } },
  { id: "solde",       nom: "Facture de solde",          pct: 5,  declencheur: { type: "reception" } },
];

// Clés réservées dans phasages.plan_travaux.meta (mêmes conventions que le
// cycle de vie : clés PLATES, écriture par read-before-write).
export const FACT_META_ECHEANCIER = "facturation_echeancier";        // surcharge par chantier | null
export const FACT_META_MONTANT_REF = "facturation_montant_reference"; // marché HT retenu | null

export const FACT_STATUTS = ["attente", "a_emettre", "emise", "encaissee"];

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const slug = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

const normaliseTexte = (s) => String(s || "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const jj = (iso) => String(iso || "").slice(0, 10).split("-").reverse().join("/");
const eur = (n) => Math.round(parseFloat(n) || 0).toLocaleString("fr-FR");

// ── Normalisation d'un échéancier ───────────────────────────────────────────
// Tolérante (une saisie Admin à moitié remplie ne doit jamais casser une fiche
// chantier) : pourcentages numériques > 0, ids uniques et stables, ordre
// conservé. La somme n'est PAS forcée à 100 — un contrat peut être facturé
// autrement (avenant, retenue de garantie) ; l'écart est SIGNALÉ par
// controleEcheancier(), jamais corrigé en douce.
export function normaliserEcheancier(lignes) {
  const src = Array.isArray(lignes) && lignes.length ? lignes : ECHEANCIER_DEFAUT;
  const vus = new Set();
  const out = [];
  src.forEach((l, i) => {
    if (!l || typeof l !== "object") return;
    const pct = toNum(l.pct);
    if (pct === null || pct <= 0) return;
    let id = slug(l.id) || slug(l.nom) || `echeance_${i + 1}`;
    while (vus.has(id)) id = `${id}_`;
    vus.add(id);
    const d = l.declencheur && typeof l.declencheur === "object" ? l.declencheur : {};
    const type = ["signature", "avancement", "reception", "manuel"].includes(d.type) ? d.type : "manuel";
    const seuil = type === "avancement"
      ? Math.max(0, Math.min(100, Math.round(toNum(d.seuil) ?? 0)))
      : null;
    out.push({
      id,
      nom: String(l.nom || "Échéance").slice(0, 80),
      pct: Math.round(pct * 100) / 100,
      declencheur: type === "avancement" ? { type, seuil } : { type },
      etape_cycle_vie: typeof l.etape_cycle_vie === "string" && l.etape_cycle_vie ? l.etape_cycle_vie : null,
    });
  });
  return out.length ? out : ECHEANCIER_DEFAUT.map(l => ({ ...l }));
}

// Écarts à signaler sur un échéancier (jamais bloquants).
export function controleEcheancier(echeancier) {
  const lignes = normaliserEcheancier(echeancier);
  const somme = Math.round(lignes.reduce((s, l) => s + l.pct, 0) * 100) / 100;
  const alertes = [];
  if (somme !== 100) {
    alertes.push(somme < 100
      ? `L'échéancier ne couvre que ${somme} % du marché (${Math.round((100 - somme) * 100) / 100} % non facturés).`
      : `L'échéancier dépasse le marché : ${somme} % au total.`);
  }
  return { somme, alertes };
}

// ── Lecture des réglages ────────────────────────────────────────────────────
// Priorité : surcharge du chantier (meta) > réglage Admin > défaut Profero.
export function lireEcheancierChantier(meta, echeancierDefaut = ECHEANCIER_DEFAUT) {
  const surcharge = meta && typeof meta === "object" ? meta[FACT_META_ECHEANCIER] : null;
  const lignes = Array.isArray(surcharge?.lignes) ? surcharge.lignes
    : Array.isArray(surcharge) ? surcharge
    : null;
  return {
    lignes: normaliserEcheancier(lignes && lignes.length ? lignes : echeancierDefaut),
    surcharge: !!(lignes && lignes.length),
    surchargePar: surcharge?.auteur || "",
    surchargeLe: surcharge?.date || "",
  };
}

// Montant de référence du marché : surcharge saisie sur le chantier, sinon le
// prix vendu calculé par le phasage. Sans référence, aucun pourcentage n'a de
// sens : l'appelant doit le dire clairement (montant = 0).
export function lireMontantReference(meta, prixVenduPhasage) {
  const surcharge = toNum(meta && typeof meta === "object" ? meta[FACT_META_MONTANT_REF] : null);
  const auto = toNum(prixVenduPhasage) || 0;
  const saisi = surcharge !== null && surcharge > 0;
  return { montant: saisi ? surcharge : auto, source: saisi ? "saisi" : "phasage", auto };
}

export const montantAttenduLigne = (ligne, montantReference) =>
  Math.round(((toNum(montantReference) || 0) * (toNum(ligne?.pct) || 0)) / 100 * 100) / 100;

// ── Déclencheur : la ligne est-elle « à émettre » ? ─────────────────────────
// Signalement pur — rien n'empêche d'émettre une facture avant son déclencheur.
export function declencheurAtteint(ligne, { avancement = null, etatsEtapes = {} } = {}) {
  const d = ligne?.declencheur || {};
  const av = toNum(avancement);
  switch (d.type) {
    case "signature":
      return { atteint: !!etatsEtapes?.devis_signe?.fait, libelle: "à la signature du devis" };
    case "avancement": {
      const seuil = toNum(d.seuil) ?? 0;
      return {
        atteint: av !== null && av >= seuil,
        libelle: seuil <= 1 ? "au démarrage des travaux" : `à ${seuil} % d'avancement`,
      };
    }
    case "reception":
      return {
        atteint: !!etatsEtapes?.visite_reception?.fait || (av !== null && av >= 100),
        libelle: "à la réception des travaux",
      };
    default:
      return { atteint: false, libelle: "à la main" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RAPPROCHEMENT d'une facture importée avec une ligne de l'échéancier.
//
// extrait = ce que l'IA a LU sur le document :
//   { montant_ht, montant_ttc, numero, date_facture, nature, situation_numero,
//     pourcentage_annonce, libelle }
//   nature ∈ "acompte" | "demarrage" | "situation" | "solde" | "autre"
//
// Décision, dans cet ordre :
//   1. le MONTANT HT rapporté au marché (le seul fait objectif) ;
//   2. les MENTIONS du document (« acompte », « situation n° 2 »…) en appui ;
//   3. à égalité, la ligne la plus petite en pourcentage (ordre contractuel).
// Une ligne déjà facturée est pénalisée mais reste proposable : une facture
// rectificative doit pouvoir se rattacher à son échéance.
// ─────────────────────────────────────────────────────────────────────────────
const TOLERANCE_RELATIVE = 0.05; // 5 % d'écart accepté sur le montant attendu
const TOLERANCE_EUR = 20;        // ou 20 € pour les petits montants
const SEUIL_RETENU = 0.5;        // en dessous : aucune proposition, choix à la main

export function rapprocherFacture(extrait, {
  echeancier = ECHEANCIER_DEFAUT,
  montantReference = 0,
  factures = [],
  factureId = null,
} = {}) {
  const lignes = normaliserEcheancier(echeancier);
  const ref = toNum(montantReference) || 0;
  const montant = toNum(extrait?.montant_ht);
  const texte = normaliseTexte([extrait?.libelle, extrait?.nature, extrait?.numero].join(" "));
  const numSituation = toNum(extrait?.situation_numero);
  const pctAnnonce = toNum(extrait?.pourcentage_annonce);

  // Lignes déjà pourvues (hors la facture en cours de modification).
  const prises = new Set(
    (factures || [])
      .filter(f => f && f.ligne_id && f.statut !== "annulee" && String(f.id) !== String(factureId))
      .map(f => String(f.ligne_id))
  );

  const NATURE_PREFIXE = { acompte: "acompte", demarrage: "demarrage", solde: "solde" };

  const candidats = lignes.map(ligne => {
    const attendu = montantAttenduLigne(ligne, ref);
    let score = 0;
    const raisons = [];

    // 1) Montant — le fait objectif
    if (montant !== null && attendu > 0) {
      const ecart = Math.abs(montant - attendu);
      const tolerance = Math.max(attendu * TOLERANCE_RELATIVE, TOLERANCE_EUR);
      if (ecart <= tolerance) {
        score += 0.6 * (1 - Math.min(1, ecart / tolerance) * 0.35);
        raisons.push(ecart <= 0.5
          ? `montant exact (${ligne.pct} % du marché)`
          : `montant à ${eur(ecart)} € près de ${ligne.pct} % du marché`);
      } else {
        score -= Math.min(0.5, (ecart / Math.max(attendu, 1)) * 0.5);
      }
    }

    // 2) Mentions du document — en appui
    const prefixe = extrait?.nature ? NATURE_PREFIXE[extrait.nature] : null;
    if (prefixe && ligne.id.startsWith(prefixe)) {
      score += 0.3; raisons.push(`document libellé « ${extrait.nature} »`);
    }
    if (extrait?.nature === "situation" && ligne.id.startsWith("situation")) {
      score += 0.15;
      if (numSituation !== null && ligne.id === `situation_${Math.round(numSituation)}`) {
        score += 0.2; raisons.push(`document libellé « situation n° ${Math.round(numSituation)} »`);
      }
    }
    if (texte && normaliseTexte(ligne.nom) && texte.includes(normaliseTexte(ligne.nom))) {
      score += 0.1; raisons.push("libellé identique à l'échéance");
    }
    if (pctAnnonce !== null && Math.abs(pctAnnonce - ligne.pct) < 0.51) {
      score += 0.25; raisons.push(`« ${pctAnnonce} % » mentionné sur le document`);
    }

    const dejaPrise = prises.has(ligne.id);
    if (dejaPrise) score -= 0.5;

    return {
      ligneId: ligne.id, ligne, montantAttendu: attendu, dejaPrise,
      score: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100,
      raison: raisons.join(", "),
    };
  }).sort((a, b) => b.score - a.score || a.ligne.pct - b.ligne.pct);

  const meilleur = candidats[0];
  const retenu = meilleur && meilleur.score >= SEUIL_RETENU ? meilleur : null;
  const pctDuMarche = montant !== null && ref > 0 ? Math.round((montant / ref) * 1000) / 10 : null;

  return {
    ligneId: retenu ? retenu.ligneId : null,
    confiance: retenu ? retenu.score : 0,
    pctDuMarche,
    raison: retenu
      ? `${retenu.ligne.nom} — ${retenu.raison || "meilleure correspondance"}.`
      : ref <= 0
        ? "Aucun montant de marché renseigné : l'échéance doit être choisie à la main."
        : montant === null
          ? "Montant HT illisible sur le document : l'échéance doit être choisie à la main."
          : `Aucune échéance ne correspond à ${eur(montant)} € HT${pctDuMarche !== null ? ` (${pctDuMarche} % du marché)` : ""} : à choisir à la main.`,
    candidats,
  };
}

// Doublon : même numéro de facture déjà importé sur ce chantier.
export function factureDoublon(extrait, factures = []) {
  const cle = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "");
  const num = cle(extrait?.numero);
  if (!num) return null;
  return (factures || []).find(f => cle(f.numero) === num && f.statut !== "annulee") || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAT DE LA FACTURATION D'UN CHANTIER — chaque ligne d'échéancier avec sa
// facture, les totaux, et les factures rattachées à aucune échéance.
// ─────────────────────────────────────────────────────────────────────────────
export function etatFacturation({
  echeancier = ECHEANCIER_DEFAUT,
  factures = [],
  montantReference = 0,
  avancement = null,
  etatsEtapes = {},
} = {}) {
  const lignes = normaliserEcheancier(echeancier);
  const ref = toNum(montantReference) || 0;
  const vivantes = (factures || []).filter(f => f && f.statut !== "annulee");

  const parLigne = {};
  vivantes.forEach(f => {
    const id = f.ligne_id ? String(f.ligne_id) : null;
    if (!id) return;
    (parLigne[id] = parLigne[id] || []).push(f);
  });

  const etatLignes = lignes.map(ligne => {
    const attendu = montantAttenduLigne(ligne, ref);
    const liste = (parLigne[ligne.id] || []).slice().sort((a, b) =>
      String(a.date_facture || a.created_at || "").localeCompare(String(b.date_facture || b.created_at || "")));
    const facture = liste[0] || null;
    const decl = declencheurAtteint(ligne, { avancement, etatsEtapes });
    // Une échéance n'est « encaissée » que si TOUTES ses factures le sont.
    const encaissee = liste.length > 0 && liste.every(f => f.statut === "encaissee");
    const statut = encaissee ? "encaissee" : facture ? "emise" : decl.atteint ? "a_emettre" : "attente";
    const emis = liste.reduce((s, f) => s + (toNum(f.montant_ht) || 0), 0);
    const encaisse = liste.reduce((s, f) =>
      s + (f.statut === "encaissee" ? (toNum(f.montant_encaisse) ?? toNum(f.montant_ht) ?? 0) : 0), 0);
    return {
      ...ligne,
      montantAttendu: attendu,
      factures: liste,
      facture,
      statut,
      prete: statut === "a_emettre",
      declencheurLibelle: decl.libelle,
      montantEmis: Math.round(emis * 100) / 100,
      montantEncaisse: Math.round(encaisse * 100) / 100,
      ecart: facture ? Math.round((emis - attendu) * 100) / 100 : 0,
      raison: statut === "encaissee"
        ? `Encaissée${facture?.date_encaissement ? ` le ${jj(facture.date_encaissement)}` : ""}.`
        : statut === "emise"
          ? `Facture ${facture?.numero ? `n° ${facture.numero} ` : ""}émise${facture?.date_facture ? ` le ${jj(facture.date_facture)}` : ""} — en attente d'encaissement.`
          : statut === "a_emettre"
            ? `À émettre (${decl.libelle}) : ${eur(attendu)} € HT.`
            : `Prévue ${decl.libelle} : ${eur(attendu)} € HT.`,
    };
  });

  const horsEcheancier = vivantes.filter(f => {
    const id = f.ligne_id ? String(f.ligne_id) : null;
    return !id || !lignes.some(l => l.id === id);
  });

  const totalEmis = Math.round(vivantes.reduce((s, f) => s + (toNum(f.montant_ht) || 0), 0) * 100) / 100;
  const totalEncaisse = Math.round(vivantes.reduce((s, f) =>
    s + (f.statut === "encaissee" ? (toNum(f.montant_encaisse) ?? toNum(f.montant_ht) ?? 0) : 0), 0) * 100) / 100;

  return {
    montantReference: ref,
    lignes: etatLignes,
    horsEcheancier,
    controle: controleEcheancier(lignes),
    totaux: {
      attendu: Math.round(etatLignes.reduce((s, l) => s + l.montantAttendu, 0) * 100) / 100,
      emis: totalEmis,
      encaisse: totalEncaisse,
      resteAFacturer: Math.round((ref - totalEmis) * 100) / 100,
      resteAEncaisser: Math.round((totalEmis - totalEncaisse) * 100) / 100,
      pctEmis: ref > 0 ? Math.round((totalEmis / ref) * 1000) / 10 : null,
      pctEncaisse: ref > 0 ? Math.round((totalEncaisse / ref) * 1000) / 10 : null,
      aEmettre: etatLignes.filter(l => l.statut === "a_emettre").length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PONT VERS LE CYCLE DE VIE
//
// 1) Les lignes SANS étape dédiée deviennent des étapes de la phase Travaux
//    (ids facture_<ligneId>, nature "auto" : l'état vient du registre des
//    factures — on ne coche pas ces cases à la main, on importe la facture).
//    Elles remplacent les anciennes « Factures de situation — 25/50/75/100 % »
//    indexées sur le seul avancement.
// 2) Les lignes AVEC etape_cycle_vie (l'acompte) valident une étape existante
//    au moment de l'ENCAISSEMENT : voir etapesAValiderDepuisFacturation().
// ─────────────────────────────────────────────────────────────────────────────
export function etapesFacturationTravaux(etat) {
  return (etat?.lignes || [])
    .filter(l => !l.etape_cycle_vie)
    .map(l => ({
      id: `facture_${l.id}`,
      nom: `${l.nom} — ${l.pct} %`,
      nature: "auto",
      signal: "facture_client",
      phaseId: "cv_travaux",
      ligneId: l.id,
      statut: l.statut,
      prete: l.prete,
      montantAttendu: l.montantAttendu,
      hint: l.raison,
    }));
}

// Carte { [ligneId]: étatLigne } passée au contexte d'évaluation du cycle de
// vie (cycleVie.evaluerEtape, signal "facture_client").
export function facturationParLigne(etat) {
  const out = {};
  (etat?.lignes || []).forEach(l => { out[l.id] = l; });
  return out;
}

// Étapes du cycle de vie à (dé)valider automatiquement d'après la facturation.
// Renvoie [{ etapeId, fait, donnees, raison }] — l'appelant écrit (il est seul
// à savoir écrire dans meta) et n'écrit QUE ce qui diffère de l'existant.
export function etapesAValiderDepuisFacturation(etat, etatsEtapes = {}) {
  const out = [];
  (etat?.lignes || []).forEach(l => {
    if (!l.etape_cycle_vie) return;
    const encaissee = l.statut === "encaissee";
    const actuel = !!etatsEtapes?.[l.etape_cycle_vie]?.fait;
    if (encaissee === actuel) return;
    // On ne dé-valide QUE ce que la facturation a elle-même validé : une coche
    // posée à la main avant la mise en service du bloc reste intouchée.
    const poseeParFacturation = etatsEtapes?.[l.etape_cycle_vie]?.donnees?.facturation_ligne_id === l.id;
    if (!encaissee && !poseeParFacturation) return;
    out.push({
      etapeId: l.etape_cycle_vie,
      fait: encaissee,
      donnees: encaissee
        ? {
            montant: l.montantEncaisse || l.montantEmis || l.montantAttendu,
            ...(l.facture?.date_encaissement ? { date: String(l.facture.date_encaissement).slice(0, 10) } : {}),
            facturation_ligne_id: l.id,
          }
        : { facturation_ligne_id: l.id },
      raison: encaissee
        ? `${l.nom} encaissée (${eur(l.montantEncaisse)} €)`
        : `${l.nom} n'est plus encaissée`,
    });
  });
  return out;
}
