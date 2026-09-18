// ─────────────────────────────────────────────────────────────────────────────
// operationExportModele — NORMALISATION des données brutes d'une opération en
// « modèle d'export », la structure que operationMarkdown.mjs sait rédiger.
//
// Module PUR : aucun réseau, aucun React, aucune horloge (la date d'export est
// injectée). C'est operationExportData.js qui lit la base et lui passe les
// lignes telles quelles. Couvert par scripts/verif-operation-export-modele.mjs.
//
// RÈGLES :
//  • AUCUN CALCUL FINANCIER NOUVEAU. Les montants viennent tels quels de
//    computeChantierFinance (`finance.brut`, `finance.lots`, `finance.warnings`).
//    Les seules agrégations faites ici sont des REPORTS (somme d'heures déjà
//    pointées, avancement de phase repris de la convention statsGroupeChrono).
//  • L'ORDRE ENREGISTRÉ EST CONSERVÉ : phases par `ordre`, tâches par
//    `chrono_ordre`, chantiers dans l'ordre reçu du référentiel.
//  • AUCUN CHEMIN DE STOCKAGE NI URL ne quitte ce module : des pièces jointes
//    on ne retient que nom, type, date et auteur.
//  • Une valeur absente vaut `null`, jamais "" ni NaN : c'est le générateur
//    Markdown qui décide comment écrire « Non renseigné ».
// ─────────────────────────────────────────────────────────────────────────────
import {
  indexPointagesParTache, tacheHeuresReelles, avancementOuvrage,
  heuresReellesOuvrage, coutMOOuvrage, heuresParMois, totalLignes,
} from "../chantierFinance.mjs";
import { etatTache } from "./preparationChantier.mjs";
import { CYCLE_VIE_PHASES, CYCLE_VIE_ETAPES, lireEtatsEtapes, lirePhaseDeclaree } from "./cycleVie.mjs";

export const nombreOuNull = (v) => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
// Un objet ou un tableau ne devient JAMAIS du texte : `String({})` vaut
// « [object Object] », et une donnée du phasage change parfois de forme (le cas
// réel : `ouvrage.bibliotheque_ref`, une chaîne à l'origine, devenue un objet
// après l'import ProGBat). Un champ structuré doit être lu champ par champ,
// jamais converti à l'aveugle.
export const texteOuNull = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return null;
  const s = typeof v === "string" ? v.trim() : String(v);
  return s === "" ? null : s;
};
export const listeOuNull = (v) => {
  const l = Array.isArray(v) ? v.filter((x) => texteOuNull(x)) : [];
  return l.length > 0 ? l : null;
};

// Statut d'une ligne de commande, dérivé de l'en-tête — MÊME règle que la page
// Commandes (rowStatut), recopiée ici pour ne pas importer un composant React.
const STATUT_CMD = { a_completer: "À compléter", complete: "Complète", facture: "Facturé" };
export const statutCommande = (c) => (c?.statut_facturation === "facture"
  ? STATUT_CMD.facture
  : c?.statut_completude === "complete" ? STATUT_CMD.complete : STATUT_CMD.a_completer);

export const documentCommande = (c) => {
  if (!c) return null;
  if (c.numero_en_attente) return "numéro en attente";
  return texteOuNull(c.doc_numero);
};

// Libellés des statuts, repris MOT POUR MOT des écrans où ils s'affichent
// (FacturationChantier, Validation, Commandes) : un export ne doit pas
// introduire un vocabulaire que personne n'emploie dans l'application, ni
// livrer un identifiant technique quand un libellé existe. Un code inconnu est
// rendu tel quel plutôt que masqué.
const traduire = (table) => (valeur) => {
  const cle = texteOuNull(valeur);
  return cle === null ? null : (table[cle] || cle);
};
export const libelleStatutFacture = traduire({
  attente: "Prévue", a_emettre: "À émettre", emise: "Émise", encaissee: "Encaissée",
});
export const libelleStatutRapport = traduire({
  en_attente: "En attente de validation", valide: "Validé",
});
export const libelleStatutBesoin = traduire({
  en_attente: "En attente", traite: "Traité", annule: "Annulé",
});
export const libellePriorite = traduire({ urgent: "Urgent", normal: "Normal", normale: "Normal" });
export const libelleStatutVisite = traduire({ en_cours: "En cours", terminee: "Terminée" });
export const libelleStatutSuggestion = traduire({
  en_attente: "En attente", acceptee: "Acceptée", refusee: "Refusée", traitee: "Traitée",
});

// ─── NORMALISATION D'UN CHANTIER ─────────────────────────────────────────────

export function normaliserChantier({
  chantier, phasage, pointages, finance, adresse, statutLabel,
  lots, tauxHoraires, materiauxById, ratiosById, equipeParGroupeType,
  sources, aujourdhui,
}) {
  const ouvragesBruts = Array.isArray(phasage?.ouvrages) ? phasage.ouvrages : [];
  const meta = phasage?.plan_travaux?.meta || {};
  const ppt = indexPointagesParTache(pointages);
  const lotLabel = (id) => (lots || []).find((l) => l.id === id)?.label || null;

  // Groupes chronologiques : l'ordre enregistré, jamais réordonné.
  const groupes = (Array.isArray(meta.chrono_groupes) ? meta.chrono_groupes : [])
    .map((g, i) => ({ ...g, _rang: i }))
    .sort((a, b) => (nombreOuNull(a.ordre) ?? 1e9) - (nombreOuNull(b.ordre) ?? 1e9) || a._rang - b._rang);
  const groupeById = {};
  groupes.forEach((g) => { groupeById[g.id] = g; });

  // Index des tâches (pour résoudre les dépendances par nom plutôt que par id).
  const nomTacheById = {};
  ouvragesBruts.forEach((o) => (o?.taches || []).forEach((t) => {
    if (t?.id) nomTacheById[String(t.id)] = texteOuNull(t.nom) || String(t.id);
  }));
  const resoudreDeps = (t) => {
    const brut = [
      ...(Array.isArray(t?.predecesseurs) ? t.predecesseurs : []),
      ...(Array.isArray(t?.dependances) ? t.dependances.map((d) => (typeof d === "string" ? d : d?.tache_id || d?.id)) : []),
    ].filter(Boolean).map(String);
    const noms = [...new Set(brut)].map((id) => nomTacheById[id] || id);
    return noms.length > 0 ? noms : null;
  };

  // ── Ouvrages et sous-tâches ──
  const ouvrages = ouvragesBruts.map((o, iOuvrage) => {
    const ratio = o?.bibliotheque_id ? ratiosById[String(o.bibliotheque_id)] : null;
    // `bibliotheque_ref` a deux formes en base : une chaîne (ancien modèle) ou
    // un objet d'import ProGBat { id, code_ouvrage, sous_taches… }. Les deux
    // sont lues explicitement — il porte parfois le SEUL code de l'ouvrage.
    const refBiblio = o?.bibliotheque_ref;
    const refObjet = refBiblio && typeof refBiblio === "object" && !Array.isArray(refBiblio) ? refBiblio : null;
    const code = texteOuNull(o?.code_ouvrage) || texteOuNull(refObjet?.code_ouvrage);
    // Référence courte de l'ouvrage, reprise dans les tableaux de tâches : les
    // intitulés font couramment 400 signes (ils recopient le texte du devis) et
    // rendraient toute autre colonne illisible. Le numéro est celui de la ligne
    // du tableau des ouvrages.
    const reference = `#${iOuvrage + 1}${code ? ` ${code}` : ""}`;
    const taches = (o?.taches || []).map((t) => {
      const g = t?.chrono_groupe_id ? groupeById[t.chrono_groupe_id] : null;
      return {
        id: texteOuNull(t?.id),
        nom: texteOuNull(t?.nom) || "(sans nom)",
        ouvrageLibelle: texteOuNull(o?.libelle) || "(sans libellé)",
        ouvrageRef: reference,
        ordre: nombreOuNull(t?.chrono_ordre),
        phaseId: texteOuNull(t?.chrono_groupe_id),
        phaseNom: g ? (texteOuNull(g.nom) || "(sans nom)") : "À organiser",
        ratio: nombreOuNull(t?.ratio),
        heuresEstimees: nombreOuNull(t?.heures_estimees),
        heuresVendues: nombreOuNull(t?.heures_vendues),
        heuresReelles: tacheHeuresReelles(t, ppt),
        avancement: nombreOuNull(t?.avancement),
        etat: etatTache(t).label,
        datePrevue: texteOuNull(t?.date_prevue),
        ouvriers: listeOuNull(t?.ouvriers),
        dependances: resoudreDeps(t),
        externe: !!t?.externe,
      };
    });
    return {
      id: texteOuNull(o?.id),
      code,
      reference,
      libelle: texteOuNull(o?.libelle) || "(sans libellé)",
      libelleDevis: texteOuNull(o?.libelle_devis),
      lotId: texteOuNull(o?.lot_id),
      lotLabel: lotLabel(o?.lot_id),
      quantite: nombreOuNull(o?.quantite),
      unite: texteOuNull(o?.unite),
      prixHT: nombreOuNull(o?.prix_ht),
      coutMateriaux: nombreOuNull(o?.cout_materiaux),
      heuresDevis: nombreOuNull(o?.heures_devis),
      heuresEstimees: nombreOuNull(o?.heures_estimees),
      heuresReelles: heuresReellesOuvrage(o, ppt),
      coutMOReel: coutMOOuvrage(o, ppt, tauxHoraires),
      avancement: avancementOuvrage(o),
      bibliothequeRef: texteOuNull(refBiblio) || texteOuNull(ratio?.identifiant),
      bibliothequeLibelle: texteOuNull(ratio?.libelle),
      // Personnalisations portées par la fiche ouvrage de la bibliothèque :
      // cadence (avec son unité) et conditions de vente référencées.
      cadence: nombreOuNull(ratio?.cadence),
      cadenceUnite: texteOuNull(ratio?.unite) || texteOuNull(o?.unite),
      coefficientVente: nombreOuNull(ratio?.coefficient_vente_valeur) ?? nombreOuNull(ratio?.coef_vente),
      tauxHoraireVente: nombreOuNull(ratio?.taux_horaire_vente_valeur),
      taches,
    };
  });

  const toutesTaches = ouvrages.flatMap((o) => o.taches);
  const nbTachesDatees = toutesTaches.filter((t) => t.datePrevue).length;

  // ── Phases (ordre enregistré) ──
  const phases = groupes.map((g) => {
    const taches = toutesTaches
      .filter((t) => t.phaseId === g.id)
      .sort((a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9));
    const dates = taches.map((t) => t.datePrevue).filter(Boolean).sort();
    const heuresEst = taches.reduce((s, t) => s + (t.heuresEstimees || 0), 0);
    const heuresVen = taches.reduce((s, t) => s + (t.heuresVendues || 0), 0);
    // Avancement pondéré par heures vendues — MÊME convention que la vue chrono
    // de l'application (statsGroupeChrono) ; recopiée ici sur les tâches déjà
    // normalisées, sans nouvelle règle.
    let wsum = 0, wtot = 0, ssum = 0;
    taches.forEach((t) => {
      const av = Math.max(0, Math.min(100, Math.round(t.avancement ?? 0)));
      ssum += av;
      if ((t.heuresVendues || 0) > 0) { wsum += av * t.heuresVendues; wtot += t.heuresVendues; }
    });
    const dernier = (sources.controles || [])
      .filter((x) => x.groupe_id === g.id)
      .sort((a, b) => String(b.date_controle || "").localeCompare(String(a.date_controle || "")))[0] || null;
    const gt = g.groupe_type_id ? equipeParGroupeType[g.groupe_type_id] : null;
    return {
      id: g.id,
      nom: texteOuNull(g.nom) || "(sans nom)",
      ordre: nombreOuNull(g.ordre),
      groupeTypeNom: gt?.groupeTypeNom || null,
      equipeNom: gt?.equipeNom || null,
      nbTaches: taches.length,
      nbTachesDatees: dates.length,
      heuresEstimees: heuresEst,
      heuresVendues: heuresVen,
      avancement: wtot > 0 ? Math.round(wsum / wtot) : (taches.length ? Math.round(ssum / taches.length) : 0),
      termine: taches.length > 0 && taches.every((t) => (t.avancement ?? 0) >= 100),
      debut: dates[0] || null,
      fin: dates[dates.length - 1] || null,
      ouvriers: listeOuNull([...new Set(taches.flatMap((t) => t.ouvriers || []))]),
      controle: dernier ? {
        date: dernier.date_controle, auteur: texteOuNull(dernier.auteur),
        nbTaches: nombreOuNull(dernier.nb_taches), nbConformes: nombreOuNull(dernier.nb_conformes),
      } : null,
      taches,
    };
  });
  const tachesHorsPhase = toutesTaches.filter((t) => !t.phaseId || !groupeById[t.phaseId]);

  const bornes = (() => {
    const dates = toutesTaches.map((t) => t.datePrevue).filter(Boolean).sort();
    return { debut: dates[0] || null, fin: dates[dates.length - 1] || null };
  })();

  // ── Matériaux prévisionnels (liens d'ouvrage résolus + quantités commandées) ──
  const lignes = sources.lignes || [];
  const materiaux = ouvragesBruts.flatMap((o, iOuvrage) => (Array.isArray(o?.materiaux_liens) ? o.materiaux_liens : [])
    .filter((ml) => ml && texteOuNull(ml.materiau_id))
    .map((ml) => {
      const fiche = materiauxById[String(ml.materiau_id)] || null;
      const qParUnite = nombreOuNull(ml.quantite);
      const qOuvrage = nombreOuNull(o?.quantite);
      const lignesLiees = lignes.filter((l) => (
        (l.ouvrage_id && o?.id && String(l.ouvrage_id) === String(o.id) && String(l.materiau_id || "") === String(ml.materiau_id))
        || (!l.ouvrage_id && l.materiau_id && String(l.materiau_id) === String(ml.materiau_id))
      ));
      const qCommandee = lignesLiees.length > 0
        ? lignesLiees.reduce((s, l) => s + (nombreOuNull(l.quantite) || 0), 0)
        : null;
      return {
        ouvrageLibelle: texteOuNull(o?.libelle) || "(sans libellé)",
        ouvrageRef: ouvrages[iOuvrage]?.reference || `#${iOuvrage + 1}`,
        nom: fiche ? texteOuNull(fiche.nom) : "Matériau introuvable en bibliothèque",
        reference: fiche ? texteOuNull(fiche.reference) : null,
        fournisseur: fiche ? texteOuNull(fiche.fournisseur) : null,
        unite: fiche ? texteOuNull(fiche.unite) : null,
        quantiteParUnite: qParUnite,
        quantiteTotale: (qOuvrage != null && qParUnite != null) ? qOuvrage * qParUnite : null,
        quantiteCommandee: qCommandee,
        commandeLe: texteOuNull(ml.commande_le),
        statut: ml.commande_le ? "Marqué commandé" : (qCommandee != null ? "Commandé (ligne trouvée)" : "À commander"),
      };
    }));

  // ── Comptes rendus, du plus récent au plus ancien ──
  const rapports = [...(sources.rapports || [])]
    .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")))
    .map((r) => {
      const taches = Array.isArray(r.taches) ? r.taches : [];
      const hIndirectes = Array.isArray(r.heures_indirectes)
        ? r.heures_indirectes.reduce((s, h) => s + (nombreOuNull(h?.heures) || 0), 0) : 0;
      return {
        date: texteOuNull(r.date_rapport),
        ouvrier: texteOuNull(r.ouvrier),
        statut: libelleStatutRapport(r.statut),
        validePar: texteOuNull(r.valide_par),
        heures: taches.reduce((s, t) => s + (nombreOuNull(t?.heures_reelles) || 0), 0) + hIndirectes,
        trajetMin: (nombreOuNull(r.trajet_matin_min) || 0) + (nombreOuNull(r.trajet_soir_min) || 0) || null,
        nbPhotos: (Array.isArray(r.photos_chantier) ? r.photos_chantier.length : 0)
          + taches.reduce((s, t) => s + (Array.isArray(t?.photos) ? t.photos.length : 0), 0),
        remarque: texteOuNull(r.remarque),
        taches: taches.map((t) => ({
          libelle: texteOuNull(t?.planifie) || texteOuNull(t?.nom),
          statut: texteOuNull(t?.statut),
          avancement: nombreOuNull(t?.avancement),
          heures: nombreOuNull(t?.heures_reelles),
          remarque: texteOuNull(t?.remarque),
        })),
      };
    });

  // ── Visites : on ne garde que les points réellement renseignés ──
  const visites = [...(sources.visites || [])]
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .map((v) => {
      const audit = v.audit && typeof v.audit === "object" && !Array.isArray(v.audit) ? v.audit : {};
      const observations = [
        ...Object.entries(audit).flatMap(([lotId, list]) => (Array.isArray(list) ? list : [])
          .filter((t) => texteOuNull(t?.statut) || texteOuNull(t?.commentaire))
          .map((t) => ({
            ouvrage: texteOuNull(t?.ouvrage_libelle) || lotId,
            nom: texteOuNull(t?.nom),
            statut: texteOuNull(t?.statut),
            commentaire: texteOuNull(t?.commentaire),
          }))),
        ...(Array.isArray(v.checklist) ? v.checklist : [])
          .filter((i) => texteOuNull(i?.statut) || texteOuNull(i?.commentaire))
          .map((i) => ({
            ouvrage: "Checklist", nom: texteOuNull(i?.label),
            statut: texteOuNull(i?.statut), commentaire: texteOuNull(i?.commentaire),
          })),
      ];
      return {
        date: texteOuNull(v.date),
        intervenant: texteOuNull(v.intervenant),
        meteo: texteOuNull(v.meteo),
        statut: libelleStatutVisite(v.statut),
        note: texteOuNull(v.note_generale),
        nbLots: Array.isArray(v.lots_audites) ? v.lots_audites.length : null,
        observations,
      };
    });

  // ── Commandes du chantier ──
  const commandes = [...lignes]
    .sort((a, b) => String(b.commande?.date_doc || b.created_at || "").localeCompare(String(a.commande?.date_doc || a.created_at || "")))
    .map((l) => ({
      date: texteOuNull(l.commande?.date_doc) || texteOuNull(l.created_at),
      fournisseur: texteOuNull(l.commande?.fournisseur_nom),
      document: documentCommande(l.commande),
      libelle: texteOuNull(l.libelle),
      reference: texteOuNull(l.reference),
      quantite: nombreOuNull(l.quantite),
      unite: texteOuNull(l.unite),
      prixUnitaire: nombreOuNull(l.prix_unitaire),
      prixTotal: nombreOuNull(l.prix_total) ?? ((nombreOuNull(l.prix_unitaire) || 0) * (nombreOuNull(l.quantite) || 0)),
      ouvrageRef: ouvrages.find((o) => o.id && String(o.id) === String(l.ouvrage_id))?.reference || null,
      lotLabel: lotLabel(l.lot_id),
      statut: statutCommande(l.commande),
    }));

  const besoins = [...(sources.besoins || [])]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((b) => ({
      article: texteOuNull(b.article) || (b.materiau_id ? texteOuNull(materiauxById[String(b.materiau_id)]?.nom) : null),
      quantite: nombreOuNull(b.quantite),
      unite: texteOuNull(b.unite),
      demandeur: texteOuNull(b.ouvrier_demandeur),
      priorite: libellePriorite(b.priorite),
      statut: libelleStatutBesoin(b.statut),
      date: texteOuNull(b.created_at),
      notes: texteOuNull(b.notes),
    }));

  // ── Contrôles, réserves ──
  const nomGroupe = (id) => (groupeById[id] ? (texteOuNull(groupeById[id].nom) || "(sans nom)") : null);
  const controles = [...(sources.controles || [])]
    .sort((a, b) => String(b.date_controle || "").localeCompare(String(a.date_controle || "")))
    .map((x) => ({
      groupeNom: texteOuNull(x.groupe_nom) || nomGroupe(x.groupe_id),
      date: texteOuNull(x.date_controle),
      auteur: texteOuNull(x.auteur),
      nbTaches: nombreOuNull(x.nb_taches),
      nbConformes: nombreOuNull(x.nb_conformes),
    }));
  const reserves = [...(sources.reserves || [])]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((r) => ({
      groupeNom: nomGroupe(r.groupe_id),
      tacheNom: texteOuNull(r.tache_nom) || (r.tache_id ? nomTacheById[String(r.tache_id)] : null),
      statut: r.levee_le ? "Levée" : (texteOuNull(r.statut) || "Ouverte"),
      commentaire: texteOuNull(r.commentaire),
      auteur: texteOuNull(r.auteur),
      date: texteOuNull(r.created_at),
      leveeLe: texteOuNull(r.levee_le),
      leveePar: texteOuNull(r.levee_par),
      ouverte: !r.levee_le,
    }));

  // ── Cycle de vie ──
  const etats = lireEtatsEtapes(meta);
  const phaseDeclaree = lirePhaseDeclaree(meta);
  const etapesCV = CYCLE_VIE_ETAPES.map((e) => {
    const etat = etats[e.id] || {};
    const donnees = etat.donnees && typeof etat.donnees === "object" && !Array.isArray(etat.donnees)
      ? Object.entries(etat.donnees).filter(([, v]) => texteOuNull(v)).map(([k, v]) => `${k} : ${v}`)
      : [];
    return {
      id: e.id,
      nom: e.nom,
      phaseNom: CYCLE_VIE_PHASES.find((p) => p.id === e.phaseId)?.nom || null,
      hint: e.hint || null,
      fait: !!etat.fait,
      date: texteOuNull(etat.date),
      auteur: texteOuNull(etat.auteur),
      donnees: donnees.length > 0 ? donnees : null,
      piecesJointes: Array.isArray(etat.pieces_jointes) ? etat.pieces_jointes : [],
    };
  });
  const prochaine = etapesCV.find((e) => !e.fait) || null;

  // ── Documents : métadonnées uniquement, jamais de chemin ni d'URL signée ──
  const documents = [
    ...etapesCV.flatMap((e) => e.piecesJointes.map((pj) => ({
      nom: texteOuNull(pj?.nom),
      categorie: `Cycle de vie — ${e.nom}`,
      type: texteOuNull(pj?.type),
      date: texteOuNull(pj?.date),
      auteur: texteOuNull(pj?.auteur),
    }))),
    ...(sources.plans || []).map((p) => ({
      nom: texteOuNull(p.name), categorie: "Plan (module Plans)",
      type: "plan", date: texteOuNull(p.updated_at) || texteOuNull(p.created_at), auteur: null,
    })),
    ...(sources.factures || []).filter((f) => texteOuNull(f.document_nom)).map((f) => ({
      nom: texteOuNull(f.document_nom), categorie: "Facture client",
      type: "facture", date: texteOuNull(f.date_facture), auteur: texteOuNull(f.source),
    })),
  ].filter((d) => d.nom);

  // ── Notes ──
  const notes = [
    ...(sources.notesChantier || []).filter((n) => texteOuNull(n.contenu))
      .map((n) => ({ source: "Note de chantier", contenu: n.contenu, date: texteOuNull(n.updated_at) })),
    ...(sources.notesPlanning || []).filter((n) => texteOuNull(n.contenu))
      .map((n) => ({ source: "Note de planning", contenu: n.contenu, date: texteOuNull(n.updated_at) })),
  ];

  // ── Tâches partagées (to-do) ──
  const todos = (sources.todos || []).map((t) => ({
    texte: texteOuNull(t.texte),
    assignes: listeOuNull((Array.isArray(t.assignes) ? t.assignes : [])
      .map((a) => texteOuNull(a?.nom) || texteOuNull(a?.email))) || listeOuNull([t.assigne_nom || t.assigne_email]),
    echeance: texteOuNull(t.date_limite),
    priorite: libellePriorite(t.priorite),
    statut: t.fait ? "Terminée" : "À faire",
    note: texteOuNull(t.note),
    fait: !!t.fait,
  })).filter((t) => t.texte);

  // ── Planning hebdomadaire ──
  const ORDRE_JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
  const planningCells = [...(sources.cells || [])]
    .filter((x) => texteOuNull(x.planifie) || texteOuNull(x.reel) || (x.ouvriers || []).length > 0)
    .sort((a, b) => String(a.week_id || "").localeCompare(String(b.week_id || ""))
      || ORDRE_JOURS.indexOf(a.jour) - ORDRE_JOURS.indexOf(b.jour))
    .map((x) => ({
      semaine: texteOuNull(x.week_id),
      jour: texteOuNull(x.jour),
      planifie: texteOuNull(x.planifie),
      reel: texteOuNull(x.reel),
      ouvriers: listeOuNull(x.ouvriers),
    }));

  // ── Heures par ouvrier / par mois (agrégations existantes du module finance) ──
  const parOuvrier = {};
  (pointages || []).forEach((p) => {
    const nom = texteOuNull(p.ouvrier) || "—";
    const h = nombreOuNull(p.heures) || 0;
    const taux = nombreOuNull(p.taux_horaire) || 0;
    const o = (parOuvrier[nom] ||= { nom, heures: 0, cout: 0, taux });
    o.heures += h; o.cout += h * taux; o.taux = taux || o.taux;
  });
  const ouvriersHeures = Object.values(parOuvrier).sort((a, b) => b.heures - a.heures);
  const moisHeures = heuresParMois(pointages).map((m) => ({
    label: m.label, heures: m.heures, cout: m.cout,
    ouvriers: m.ouvriers.map((o) => `${o.nom} ${Math.round(o.heures)} h`),
  }));

  // ── Échéances : tâches datées non terminées ──
  const echeances = toutesTaches
    .filter((t) => t.datePrevue && (t.avancement ?? 0) < 100)
    .sort((a, b) => String(a.datePrevue).localeCompare(String(b.datePrevue)))
    .map((t) => ({ ...t, enRetard: aujourdhui ? String(t.datePrevue).slice(0, 10) < aujourdhui : false }));

  // ── Chiffrage rattaché (client + conditions de vente par ligne) ──
  const chiffrage = (sources.projets || []).length > 0
    ? construireChiffrage(sources.projets)
    : null;

  // ── Prévisionnel client ──
  const prev = meta.previsionnel && typeof meta.previsionnel === "object" ? meta.previsionnel : null;
  const previsionnel = prev ? {
    blocs: (Array.isArray(prev.blocs) ? prev.blocs : []).map((b) => ({
      titre: texteOuNull(b?.titre), lignes: (Array.isArray(b?.lignes) ? b.lignes : []).filter(Boolean),
    })),
    note: texteOuNull(prev.note_bas),
    livraison: [texteOuNull(prev.livraison_mois), texteOuNull(prev.livraison_annee)].filter(Boolean).join(" ") || null,
  } : null;

  const equipesChantier = listeOuNull([...new Set(phases.map((p) => p.equipeNom).filter(Boolean))]);

  return {
    id: chantier.id,
    nom: texteOuNull(chantier.nom) || chantier.id,
    couleur: texteOuNull(chantier.couleur),
    statutId: texteOuNull(chantier.statut) || "en_cours",
    statutLabel,
    adresse,
    equipes: equipesChantier,
    finance: finance?.brut || null,
    alertes: (finance?.warnings || []).map((w) => ({ gravite: w.gravite || "info", message: w.message })),
    lots: finance?.lots?.filter((l) => !l.vide) || [],
    phasage: phasage ? {
      id: phasage.id,
      updatedAt: phasage.updated_at,
      montantDevis: nombreOuNull(meta.prix_vendu),
      fgTauxHoraire: nombreOuNull(meta.fg_taux_horaire),
      margeCible: nombreOuNull(meta.marge_vendue_cible),
      repriseHeures: nombreOuNull(meta.reprise_heures),
      repriseTaux: nombreOuNull(meta.reprise_taux),
    } : null,
    ouvrages,
    nbTaches: toutesTaches.length,
    nbTachesDatees,
    phases,
    tachesHorsPhase,
    jalons: (Array.isArray(meta.chrono_jalons) ? meta.chrono_jalons : []).map((j) => ({
      nom: texteOuNull(j?.nom), type: texteOuNull(j?.type),
      groupeNom: nomGroupe(j?.groupe_id), date: texteOuNull(j?.date),
    })),
    planning: bornes,
    planningCells,
    previsionnel,
    materiaux,
    suggestionsMateriaux: (sources.suggestions || []).map((s) => ({
      designation: texteOuNull(s.designation_libre)
        || texteOuNull(materiauxById[String(s.materiau_id)]?.nom),
      quantite: nombreOuNull(s.quantite_totale),
      unite: texteOuNull(s.unite),
      precision: texteOuNull(s.precision_ouvrier),
      statut: libelleStatutSuggestion(s.statut),
      date: texteOuNull(s.cree_le),
    })).filter((s) => s.designation),
    rapports,
    visites,
    commandes,
    totalCommandes: totalLignes(lignes),
    besoins,
    controles,
    reserves,
    cycleVie: {
      phaseLabel: phaseDeclaree
        ? `${CYCLE_VIE_PHASES.find((p) => p.id === phaseDeclaree.phaseId)?.nom || phaseDeclaree.phaseId} (déclarée${phaseDeclaree.auteur ? ` par ${phaseDeclaree.auteur}` : ""})`
        : null,
      etapes: etapesCV.map(({ piecesJointes, ...e }) => ({ ...e, nbPiecesJointes: piecesJointes.length })),
      prochaine: prochaine ? { nom: prochaine.nom, phaseNom: prochaine.phaseNom, hint: prochaine.hint } : null,
    },
    documents,
    notes,
    todos,
    echeances,
    ouvriersHeures,
    heuresParMois: moisHeures,
    avancementHistorique: [...(sources.avancement || [])]
      .sort((a, b) => String(b.date_snapshot || "").localeCompare(String(a.date_snapshot || "")))
      .map((h) => ({
        date: texteOuNull(h.date_snapshot), avancement: nombreOuNull(h.avancement),
        tachesTerminees: nombreOuNull(h.taches_terminees), tachesTotal: nombreOuNull(h.taches_total),
      })),
    facturesClient: [...(sources.factures || [])]
      .sort((a, b) => String(b.date_facture || "").localeCompare(String(a.date_facture || "")))
      .map((f) => ({
        numero: texteOuNull(f.numero), date: texteOuNull(f.date_facture),
        libelle: texteOuNull(f.ligne_nom), montantHT: nombreOuNull(f.montant_ht),
        statut: libelleStatutFacture(f.statut), dateEncaissement: texteOuNull(f.date_encaissement),
      })),
    totalFacture: (sources.factures || []).reduce((s, f) => s + (nombreOuNull(f.montant_ht) || 0), 0),
    chiffrage,
    client: construireClient(sources.projets),
  };
}

// Conditions de vente du chiffrage rattaché. Un chantier peut porter plusieurs
// projets (plusieurs devis) : on les concatène en gardant leur référence.
function construireChiffrage(projets) {
  const lignes = projets.flatMap(({ projet, lignes: l }) => [...l]
    .sort((a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9))
    .map((x) => ({
      code: texteOuNull(x.code_ouvrage),
      libelle: texteOuNull(x.item),
      zone: texteOuNull(x.zone),
      quantite: nombreOuNull(x.quantite),
      unite: texteOuNull(x.unite),
      prixUnitaire: nombreOuNull(x.prix_unitaire),
      coefficient: nombreOuNull(x.coefficient_ligne_valeur)
        ?? nombreOuNull(x.coefficient_origine_valeur) ?? nombreOuNull(x.coef_vente),
      coefficientSource: texteOuNull(x.coefficient_source) || "hérité",
      tauxHoraire: nombreOuNull(x.taux_horaire_ligne_valeur)
        ?? nombreOuNull(x.taux_horaire_origine_valeur) ?? nombreOuNull(x.taux_horaire_vente),
      tauxHoraireSource: texteOuNull(x.taux_horaire_source) || "hérité",
      projet: texteOuNull(projet?.devis_objet) || texteOuNull(projet?.logement_reference),
    })));
  const p = projets[0]?.projet || {};
  return {
    reference: [texteOuNull(p.devis_objet), texteOuNull(p.logement_reference)].filter(Boolean).join(" — ") || null,
    modeCoefficient: texteOuNull(p.mode_coefficient),
    coefficientGlobal: [nombreOuNull(p.coefficient_global_valeur), texteOuNull(p.coefficient_global_libelle)]
      .filter((x) => x !== null).join(" — ") || null,
    modeTauxHoraire: texteOuNull(p.mode_taux_horaire),
    tauxHoraireGlobal: [nombreOuNull(p.taux_horaire_global_valeur), texteOuNull(p.taux_horaire_global_libelle)]
      .filter((x) => x !== null).join(" — ") || null,
    lignes,
  };
}

function construireClient(projets) {
  const p = (projets || [])[0]?.projet;
  if (!p) return null;
  const nom = [texteOuNull(p.client_prenom), texteOuNull(p.client_nom)].filter(Boolean).join(" ");
  return {
    nom: nom || null,
    societe: texteOuNull(p.client_societe),
    email: texteOuNull(p.client_email),
    telephone: texteOuNull(p.client_telephone),
    adresse: [texteOuNull(p.client_adresse), texteOuNull(p.client_code_postal), texteOuNull(p.client_ville)]
      .filter(Boolean).join(" ") || null,
  };
}

// ─── ASSEMBLAGE DU MODÈLE D'OPÉRATION ────────────────────────────────────────

export function assemblerModele({ op, chantiers, agg, statutsLabels, erreurs, maintenant }) {
  const statuts = {};
  chantiers.forEach((c) => { statuts[c.statutId] = (statuts[c.statutId] || 0) + 1; });

  const dates = chantiers.flatMap((c) => [c.planning?.debut, c.planning?.fin]).filter(Boolean).sort();

  // Heures par ouvrier, toutes chantiers confondus.
  const parOuvrier = {};
  chantiers.forEach((c) => (c.ouvriersHeures || []).forEach((o) => {
    const e = (parOuvrier[o.nom] ||= { nom: o.nom, heures: 0, cout: 0, chantiers: [] });
    e.heures += o.heures; e.cout += o.cout;
    if (!e.chantiers.includes(c.nom)) e.chantiers.push(c.nom);
  }));

  // Équipes réellement impliquées.
  const parEquipe = {};
  chantiers.forEach((c) => (c.equipes || []).forEach((nom) => {
    const e = (parEquipe[nom] ||= { nom, responsables: null, membres: null, externe: false, chantiers: [] });
    if (!e.chantiers.includes(c.nom)) e.chantiers.push(c.nom);
  }));

  return {
    genere: {
      le: maintenant instanceof Date ? maintenant.toISOString() : String(maintenant),
      leFr: maintenant instanceof Date
        ? `${maintenant.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })} à ${maintenant.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
        : String(maintenant),
      erreurs,
    },
    operation: {
      id: op?.id || null,
      nom: op?.nom || null,
      reference: op?.id || null,
      adresse: texteOuNull(op?.adresse),
      couleur: texteOuNull(op?.couleur),
      statuts,
    },
    statutsLabels,
    agg,
    bornes: { debut: dates[0] || null, fin: dates[dates.length - 1] || null },
    contacts: chantiers.filter((c) => c.client).map((c) => ({ chantierNom: c.nom, ...c.client })),
    intervenants: Object.values(parEquipe),
    affectations: Object.values(parOuvrier).sort((a, b) => b.heures - a.heures),
    consignes: chantiers.flatMap((c) => (c.notes || [])
      .map((n) => ({ chantierNom: c.nom, source: n.source, contenu: n.contenu }))),
    commandes: chantiers.flatMap((c) => (c.commandes || []).map((l) => ({ ...l, chantierNom: c.nom }))),
    totalCommandes: chantiers.reduce((s, c) => s + (c.totalCommandes || 0), 0),
    besoins: chantiers.flatMap((c) => (c.besoins || []).map((b) => ({ ...b, chantierNom: c.nom }))),
    alertes: chantiers.flatMap((c) => (c.alertes || []).map((a) => ({ ...a, chantierNom: c.nom }))),
    reservesOuvertes: chantiers.flatMap((c) => (c.reserves || []).filter((r) => r.ouverte)
      .map((r) => ({ ...r, chantierNom: c.nom }))),
    actions: chantiers.flatMap((c) => (c.todos || []).filter((t) => !t.fait)
      .map((t) => ({ ...t, chantierNom: c.nom }))),
    documents: chantiers.flatMap((c) => (c.documents || []).map((d) => ({ ...d, chantierNom: c.nom }))),
    observationsOperation: null,
    chantiers,
  };
}

