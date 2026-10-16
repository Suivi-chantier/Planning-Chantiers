// ─────────────────────────────────────────────────────────────────────────────
// operationKpiDetail — détail d'un KPI de la fiche Opération (clic sur une
// carte), le pendant des modales kpiDetail du Phasage à l'échelle de toute
// l'opération.
//
// Module PUR : aucun réseau, aucun React, aucune horloge. Couvert par
// scripts/verif-operation-kpi-detail.mjs.
//
// RÈGLE : AUCUN CALCUL FINANCIER NOUVEAU.
//  • « Par logement » : la Donnee de chaque chantier telle que la produit
//    computeChantierFinance — même valeur, mêmes lignes que la modale du
//    Phasage de ce chantier.
//  • « Toute l'opération » : REPORT des lignes chiffrées de ces mêmes
//    ventilations (somme par ouvrier, par lot) ou des totaux d'agregerOperation.
//  • Le total affiché est celui d'agregerOperation : le chiffre de la carte.
//    Si les lignes regroupées n'y arrivent pas exactement (seuils d'affichage
//    du Phasage, reprise d'antériorité sans ligne propre), l'écart a sa ligne
//    — il n'est jamais absorbé en silence.
// ─────────────────────────────────────────────────────────────────────────────
import { eur, fmtH, SEUIL_RATIO_DERIVE } from "../chantierFinance.mjs";

const signe = (n) => `${n >= 0 ? "+" : ""}${eur(n)}`;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
// En dessous d'un euro, un écart est un arrondi : pas de ligne.
const SEUIL_ECART_EUR = 1;

// Lignes d'un logement → regroupement par ouvrier sur toute l'opération.
function consoliderMO(parLogement, finances, total) {
  const ouvriers = {};
  const autres = {
    sans_nominatif: { main: "Heures sans pointage nominatif", sub: "coût estimé via ouvriers assignés", valeur: 0, heures: null, n: 0 },
    trajets:        { main: "Trajets", sub: "pointages indirects", valeur: 0, heures: 0, n: 0 },
    indirect:       { main: "Heures indirectes", sub: "intempéries, SAV, nettoyage…", valeur: 0, heures: 0, n: 0 },
    libres:         { main: "Heures libres", sub: "hors tâche du plan", valeur: 0, heures: 0, n: 0 },
  };
  parLogement.forEach((l) => l.lignes.forEach((r) => {
    if (typeof r.valeur !== "number") return;
    if (r.cle === "ouvrier") {
      const o = (ouvriers[r.main] ||= { nom: r.main, heures: 0, valeur: 0, taux: new Set(), logements: new Set() });
      o.heures += r.heures || 0;
      o.valeur += r.valeur;
      if (r.taux != null) o.taux.add(r.taux);
      o.logements.add(l.id);
    } else if (autres[r.cle]) {
      const a = autres[r.cle];
      a.valeur += r.valeur;
      if (a.heures != null) a.heures += r.heures || 0;
      a.n++;
    }
  }));

  const lignes = Object.values(ouvriers)
    .sort((a, b) => b.valeur - a.valeur)
    .map((o) => {
      const taux = [...o.taux].sort((a, b) => a - b);
      const tauxTxt = taux.length === 1 ? ` × ${eur(taux[0])}/h`
        : taux.length > 1 ? ` · taux de ${eur(taux[0])} à ${eur(taux[taux.length - 1])}/h` : "";
      return {
        main: o.nom,
        sub: `${fmtH(o.heures)}h${tauxTxt} · ${pluriel(o.logements.size, "logement")}`,
        right: eur(o.valeur), valeur: o.valeur,
      };
    });
  Object.values(autres).forEach((a) => {
    if (a.n === 0) return;
    lignes.push({
      main: a.main,
      sub: a.heures != null ? `${fmtH(a.heures)}h · ${a.sub}` : a.sub,
      right: eur(a.valeur), valeur: a.valeur,
    });
  });
  // La reprise d'antériorité est dans le total du chantier sans ligne propre
  // dans le Phasage (comportement historique) : ici elle est nommée.
  const reprise = finances.reduce((s, f) => s + (f.brut?.repriseCout || 0), 0);
  if (reprise > 0) {
    const h = finances.reduce((s, f) => s + (f.brut?.repriseHeures || 0), 0);
    lignes.push({ main: "Reprise d'antériorité", sub: `${fmtH(h)}h saisies avant le registre`, right: eur(reprise), valeur: reprise });
  }
  ajouterEcart(lignes, total, "lignes de moins de 1 € par logement, non détaillées dans le Phasage");
  return { titre: "Par ouvrier — toute l'opération", lignes };
}

function consoliderVendu(parLogement, total, lots) {
  const parLot = {};
  parLogement.forEach((l) => l.lignes.forEach((r) => {
    if (typeof r.valeur !== "number") return;
    const k = r.lotId || "__sans_lot";
    const e = (parLot[k] ||= { lotId: r.lotId || null, label: r.sub || null, valeur: 0, n: 0, logements: new Set() });
    e.valeur += r.valeur;
    e.n++;
    e.logements.add(l.id);
  }));
  const lignes = Object.values(parLot)
    .sort((a, b) => b.valeur - a.valeur)
    .map((e) => ({
      main: e.label || (e.lotId ? ((lots || []).find((x) => x.id === e.lotId)?.label || e.lotId) : "Sans lot"),
      sub: `${pluriel(e.n, "ouvrage")} · ${pluriel(e.logements.size, "logement")}`,
      right: eur(e.valeur), valeur: e.valeur,
    }));
  ajouterEcart(lignes, total, "ouvrages à prix nul ou négatif");
  return { titre: "Par lot — toute l'opération", lignes };
}

// ── Dérive des heures vendues ────────────────────────────────────────────────
// Ratio (heures réelles ÷ vendues) ÷ (avancement ÷ 100) : même formule que la
// dérive d'un lot. Couleurs = celles du tableau des lots (LotsTableau).
export const texteRatio = (r) => (r == null ? "—" : `×${r.toFixed(2)}`);
export function couleurRatioDerive(r) {
  if (r == null) return null;
  return r > SEUIL_RATIO_DERIVE ? "#e15a5a" : r > 1 ? "#f5a623" : "#22c55e";
}
const raisonNonCalculable = (hv, av) => (hv <= 0
  ? "non calculable : aucune heure prévue"
  : av <= 0 ? "non calculable : avancement à 0 %" : null);

// Carte « Dérive heures vendues » de la fiche Opération : valeur et sous-titre,
// à partir d'agregerOperation (agg.derive, agg.hComparables, agg.hVendues).
export function carteDeriveOperation(agg) {
  if (!agg) return null;
  const raison = agg.derive == null ? raisonNonCalculable(agg.hVendues, agg.avancement) : null;
  return {
    valeur: agg.derive,
    valeurTexte: texteRatio(agg.derive),
    sousLabel: raison || `${fmtH(agg.hComparables)}h réelles / ${fmtH(agg.hVendues)}h prévues · ${agg.avancement}% avancé`,
    couleur: couleurRatioDerive(agg.derive),
  };
}

// Ligne d'une phase (d'un logement, ou regroupée sur l'opération).
function lignePhase(ph, nbLogements = null) {
  const parties = [
    `${fmtH(ph.heuresReelles)}h / ${fmtH(ph.heuresVendues)}h prévues`,
    `${ph.avancement}% avancé`,
  ];
  if (ph.heuresHorsDevis > 0) parties.push(`+ ${fmtH(ph.heuresHorsDevis)}h hors devis`);
  if (nbLogements != null) parties.push(pluriel(nbLogements, "logement"));
  const raison = ph.ratioDerive == null ? raisonNonCalculable(ph.heuresVendues, ph.avancement) : null;
  return {
    main: ph.nom,
    sub: parties.join(" · ") + (raison ? ` · ${raison}` : ""),
    right: texteRatio(ph.ratioDerive),
    rightColor: couleurRatioDerive(ph.ratioDerive),
  };
}

// Clé de regroupement d'une phase entre logements : le type de phase du
// référentiel (groupes_types) ; à défaut, le nom (casse et espaces ignorés).
const clePhase = (ph) => (ph.sansPhase ? "_sans_phase"
  : ph.groupeTypeId ? `gt:${ph.groupeTypeId}`
    : `nom:${String(ph.nom || "").trim().toLowerCase().replace(/\s+/g, " ")}`);

function consoliderPhases(parLogement, finances, agg) {
  const groupes = {};
  finances.forEach((f, iLog) => (f.phases || []).forEach((ph) => {
    if (!ph.nbTaches) return;
    const k = clePhase(ph);
    const g = (groupes[k] ||= { sansPhase: ph.sansPhase, noms: {}, rangs: [], logements: new Set(),
      heuresVendues: 0, heuresReelles: 0, heuresHorsDevis: 0, avPond: 0, avSimple: 0, n: 0 });
    g.noms[ph.nom] = (g.noms[ph.nom] || 0) + 1;
    g.rangs.push(ph.rang);
    g.logements.add(parLogement[iLog].id);
    g.heuresVendues += ph.heuresVendues;
    g.heuresReelles += ph.heuresReelles;
    g.heuresHorsDevis += ph.heuresHorsDevis;
    g.avPond += ph.avancement * ph.heuresVendues;
    g.avSimple += ph.avancement;
    g.n++;
  }));
  const moyenne = (l) => l.reduce((s, x) => s + x, 0) / (l.length || 1);
  const phases = Object.values(groupes).map((g) => {
    // Nom le plus fréquent parmi les logements (à égalité : le premier vu).
    const nom = Object.entries(g.noms).sort((a, b) => b[1] - a[1])[0][0];
    // Avancement : pondéré par les heures vendues, comme dans une phase.
    const avancement = Math.round(g.heuresVendues > 0 ? g.avPond / g.heuresVendues : g.avSimple / g.n);
    return {
      nom, sansPhase: g.sansPhase, rangMoyen: moyenne(g.rangs), nbLogements: g.logements.size,
      heuresVendues: g.heuresVendues, heuresReelles: g.heuresReelles, heuresHorsDevis: g.heuresHorsDevis,
      avancement,
      ratioDerive: (g.heuresVendues > 0 && avancement > 0) ? (g.heuresReelles / g.heuresVendues) / (avancement / 100) : null,
    };
  }).sort((a, b) => (a.sansPhase - b.sansPhase) || (a.rangMoyen - b.rangMoyen));

  const lignes = phases.map((ph) => lignePhase(ph, ph.nbLogements));

  // Rapprochement avec la carte : heures hors phase et écart de vendu.
  const horsPhase = finances.reduce((s, f) => s
    + (f.brut?.extras?.heuresIndirect || 0) + (f.brut?.extras?.heuresLibre || 0) + (f.brut?.repriseHeures || 0), 0);
  if (horsPhase > 0.05) {
    lignes.push({ main: "Trajets, indirect, heures libres, reprise", sub: `${fmtH(horsPhase)}h réelles · non rattachées à une phase, comptées dans la dérive de l'opération`, right: "—" });
  }
  const hvTaches = phases.reduce((s, ph) => s + ph.heuresVendues, 0);
  const ecartVendu = (agg.hVendues || 0) - hvTaches;
  if (Math.abs(ecartVendu) > 0.05) {
    lignes.push({
      main: "Écart de vendu ouvrages / tâches",
      sub: `${fmtH(agg.hVendues)}h prévues sur les ouvrages, ${fmtH(hvTaches)}h réparties sur les tâches`,
      right: `${ecartVendu > 0 ? "+" : "−"} ${fmtH(Math.abs(ecartVendu))}h`, rightColor: "#f5a623",
    });
  }
  return { titre: "Par phase — tous logements confondus", lignes };
}

function ajouterEcart(lignes, total, explication) {
  const somme = lignes.reduce((s, r) => s + (r.valeur || 0), 0);
  const ecart = (total || 0) - somme;
  if (Math.abs(ecart) >= SEUIL_ECART_EUR && lignes.length > 0) {
    lignes.push({ main: "Non ventilé", sub: explication, right: eur(ecart), valeur: ecart, rightColor: "#f5a623" });
  }
}

// Définition des KPI de la fiche Opération. `donnee` = la clé de la Donnee
// dans computeChantierFinance, `total` = le champ d'agregerOperation affiché
// sur la carte.
export const KPI_OPERATION = {
  derive: {
    total: "derive", titre: "Dérive des heures prévues", totalLabel: "Dérive de l'opération",
    sousTitre: `(heures réelles ÷ prévues) ÷ avancement · au-delà de ×${SEUIL_RATIO_DERIVE.toFixed(2)} ça dérive`,
    totalTexte: (agg) => texteRatio(agg.derive),
    totalCouleur: (agg) => couleurRatioDerive(agg.derive),
    // Pas de Donnee pour cet indicateur : la ligne d'un logement vient de
    // brut.deriveChantier et de ses phases (computeChantierFinance).
    logement: (finance) => {
      const b = finance.brut || {};
      const d = b.deriveChantier ?? null;
      const raison = d == null ? raisonNonCalculable(b.heuresVenduesChantier || 0, b.avancementChantier || 0) : null;
      return {
        valeur: d,
        valeurTexte: texteRatio(d),
        valeurCouleur: couleurRatioDerive(d),
        sousLabel: raison || `${fmtH(b.heuresComparablesChantier)}h / ${fmtH(b.heuresVenduesChantier)}h prévues · ${b.avancementChantier}% avancé`,
        lignes: (finance.phases || []).filter((ph) => ph.nbTaches > 0).map((ph) => lignePhase(ph)),
        vide: "Aucune tâche dans le phasage.",
      };
    },
    consolider: ({ parLogement, finances, agg }) => consoliderPhases(parLogement, finances, agg),
  },
  vendu: {
    donnee: "venduHT", total: "vendu",
    titre: "Prix de vente HT", totalLabel: "Total vendu HT",
    consolider: ({ parLogement, agg, lots }) => consoliderVendu(parLogement, agg.vendu, lots),
  },
  mo: {
    donnee: "moReel", total: "moReel",
    titre: "Coût main d'œuvre réel", totalLabel: "Total coût MO",
    consolider: ({ parLogement, finances, agg }) => consoliderMO(parLogement, finances, agg.moReel),
  },
  mat: {
    donnee: "matReel", total: "mat",
    titre: "Matériaux (commandes)", totalLabel: "Total matériaux",
    consolider: null,
  },
  fg: {
    donnee: "fg", total: "fg",
    titre: "Frais généraux", totalLabel: "Total frais généraux",
    consolider: null,
  },
  marge: {
    donnee: "marge", total: "marge", texteSigne: true,
    titre: "Marge nette", totalLabel: "Marge nette",
    consolider: ({ agg }) => ({
      titre: "Toute l'opération",
      lignes: [
        { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(agg.vendu)}`, rightColor: "#22c55e" },
        { main: "Coût main d'œuvre", sub: "tâches + trajets + indirect", right: `− ${eur(agg.moReel)}`, rightColor: "#e15a5a" },
        { main: "Matériaux", sub: "commandes des logements", right: `− ${eur(agg.mat)}`, rightColor: "#e15a5a" },
        { main: "Frais généraux", sub: "taux horaire × heures réelles", right: `− ${eur(agg.fg)}`, rightColor: "#e15a5a" },
      ],
    }),
  },
  marge_prev: {
    donnee: "margePrev", total: "margePrev", texteSigne: true,
    titre: "Marge prévisionnelle", totalLabel: "Marge prévisionnelle",
    consolider: ({ agg }) => ({
      titre: "Toute l'opération",
      lignes: [
        { main: "Vendu HT", sub: "prix de vente des ouvrages", right: `+ ${eur(agg.vendu)}`, rightColor: "#22c55e" },
        { main: "Déboursé prévisionnel", sub: `MO prév. ${eur(agg.moPrev)} + matériaux prév. ${eur(agg.matPrev)}`, right: `− ${eur(agg.moPrev + agg.matPrev)}`, rightColor: "#e15a5a" },
        { main: "Frais généraux prévisionnels", sub: "taux horaire × heures prévues", right: `− ${eur(agg.fgPrev)}`, rightColor: "#e15a5a" },
      ],
    }),
  },
};

// Détail d'un KPI pour une opération.
//   kpi            : clé de KPI_OPERATION
//   chantiersOp    : logements de l'opération, dans l'ordre de la fiche
//   finParChantier : { [chantierId]: { finance } } (computeChantierFinance)
//   agg            : agregerOperation(chantiersOp, finParChantier)
//   lots           : référentiel des lots (libellé de repli)
// Rend null pour une clé inconnue.
export function detailKpiOperation(kpi, { chantiersOp = [], finParChantier = {}, agg, lots = [] } = {}) {
  const def = KPI_OPERATION[kpi];
  if (!def || !agg) return null;

  const parLogement = [];
  const sansPhasage = [];
  const finances = [];
  chantiersOp.forEach((c) => {
    const finance = finParChantier?.[c.id]?.finance;
    if (!finance) { sansPhasage.push(c.nom); return; }
    let ligne;
    if (def.logement) {
      ligne = def.logement(finance);
    } else {
      const d = finance[def.donnee];
      if (!d) { sansPhasage.push(c.nom); return; }
      ligne = {
        valeur: d.valeur, valeurTexte: d.valeurTexte, sousLabel: d.sousLabel || null,
        lignes: d.ventilation || [], vide: d.vide || null,
      };
    }
    finances.push(finance);
    parLogement.push({ id: c.id, nom: c.nom, couleur: c.couleur || null, valeurCouleur: null, ...ligne });
  });

  // La dérive peut être non calculable : null reste null (jamais 0).
  const total = def.total === "derive" ? agg.derive : (agg[def.total] || 0);
  const consolide = def.consolider && parLogement.length > 0
    ? def.consolider({ parLogement, finances, agg, lots })
    : null;

  const sousTitre = `${pluriel(parLogement.length, "logement")} chiffré${parLogement.length > 1 ? "s" : ""}`
    + (sansPhasage.length > 0 ? ` · ${sansPhasage.length} sans phasage, hors chiffres` : "");

  return {
    cle: kpi,
    titre: def.titre,
    sousTitre: def.sousTitre ? `${sousTitre} · ${def.sousTitre}` : sousTitre,
    totalLabel: def.totalLabel,
    total,
    totalTexte: def.totalTexte ? def.totalTexte(agg) : def.texteSigne ? signe(total) : eur(total),
    totalCouleur: def.totalCouleur ? def.totalCouleur(agg) : null,
    // Seul cas sans aucune ligne : chaque logement chiffré a au moins sa ligne.
    vide: parLogement.length === 0 ? "Aucun logement de l'opération n'a de phasage chiffré." : null,
    consolide: consolide && consolide.lignes.length > 0 ? consolide : null,
    parLogement,
    sansPhasage,
  };
}
