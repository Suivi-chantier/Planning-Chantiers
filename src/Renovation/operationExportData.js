// ─────────────────────────────────────────────────────────────────────────────
// operationExportData — RÉCUPÉRATION des données d'une opération pour l'export
// Markdown destiné à ChatGPT, et orchestration du téléchargement.
//
// Trois étages, volontairement séparés — seul celui-ci touche au réseau :
//   1. operationExportData.js   (ici)  lit la base et déclenche le fichier
//   2. operationExportModele.mjs (pur) normalise les lignes en modèle d'export
//   3. operationMarkdown.mjs     (pur) rédige le document
// Les deux modules purs sont testables sans base : scripts/verif-operation-*.
//
// RÈGLES :
//  • LECTURE SEULE. Aucun insert / update / delete, aucun upsert de confort.
//  • RLS RESPECTÉE. Toutes les requêtes passent par le client supabase de la
//    session : ce que l'utilisateur ne peut pas lire n'entre pas dans l'export.
//  • PAS DE N+1. Une requête par TABLE pour toute l'opération (`.in` sur la
//    liste des chantiers), jamais une requête par chantier. Les sources déjà
//    chargées par la page (phasages, pointages, finance) sont réutilisées.
//  • AUCUN CALCUL FINANCIER NOUVEAU. Les montants viennent de
//    computeChantierFinance, déjà exécuté par la page (`finParChantier`).
//  • AUCUN `catch` MUET. Chaque source qui échoue est journalisée en console
//    ET remontée dans `erreurs[]`, qui apparaît en tête du document et dans la
//    notification de l'écran.
//  • AUCUNE URL SIGNÉE NI CHEMIN DE STOCKAGE dans le modèle : des documents on
//    ne garde que nom, type, catégorie, date et auteur.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { loadGroupesTypes, loadEquipes } from "../constants";
import { normaliserChantier, assemblerModele, texteOuNull } from "./operationExportModele.mjs";
import { construireMarkdownOperation, nomFichierMarkdownOperation } from "./operationMarkdown.mjs";

const PAGE = 1000;

// Découpe une liste d'identifiants : `.in()` sur des centaines de valeurs finit
// par dépasser la longueur d'URL acceptée. Une opération en compte quelques
// dizaines au pire, mais la garde ne coûte rien.
const parPaquets = (ids, taille = 80) => {
  const out = [];
  for (let i = 0; i < ids.length; i += taille) out.push(ids.slice(i, i + taille));
  return out;
};

// Lecture paginée d'une table filtrée sur une colonne `in`. Toute erreur est
// renvoyée telle quelle à l'appelant, qui l'inscrit dans `erreurs[]`.
async function lireParIds(table, select, ids, { colonne = "chantier_id", ordre = null } = {}) {
  const lignes = [];
  for (const paquet of parPaquets(ids)) {
    let debut = 0;
    for (;;) {
      let q = supabase.from(table).select(select).in(colonne, paquet).range(debut, debut + PAGE - 1);
      if (ordre) q = q.order(ordre.colonne, { ascending: !!ordre.ascendant });
      const { data, error } = await q;
      if (error) return { data: lignes, error };
      lignes.push(...(data || []));
      if (!data || data.length < PAGE) break;
      debut += PAGE;
    }
  }
  return { data: lignes, error: null };
}

// Regroupe des lignes par chantier_id.
const grouper = (lignes, cle = "chantier_id") => {
  const m = {};
  (lignes || []).forEach((l) => { (m[l?.[cle]] ||= []).push(l); });
  return m;
};

// ─── CHARGEMENT ──────────────────────────────────────────────────────────────

/**
 * Charge tout ce que l'export d'une opération réclame, et rend le modèle prêt
 * à rédiger. Ne modifie jamais la base.
 *
 * @param {object} p
 * @param {object} p.op                  opération { id, nom, adresse, couleur }
 * @param {Array}  p.chantiersOp         chantiers rattachés, DANS L'ORDRE du référentiel
 * @param {object} p.phasagesParChantier { [chantierId]: ligne phasages } déjà chargée par la page
 * @param {object} p.pointagesParChantier{ [chantierId]: [pointages] } déjà chargés
 * @param {object} p.finParChantier      { [chantierId]: { finance } } déjà calculé (computeChantierFinance)
 * @param {object} p.agg                 agrégat de l'opération, tel qu'affiché à l'écran
 * @param {object} p.cfg                 réglages déjà chargés (taux_horaires, lots_travaux…)
 * @param {object} p.statutsLabels       { statutId: libellé } de l'écran
 * @param {Date}   p.maintenant          horloge injectée (testabilité)
 * @returns {Promise<{ modele: object, erreurs: string[] }>}
 */
export async function chargerDonneesExportOperation({
  op,
  chantiersOp = [],
  phasagesParChantier = {},
  pointagesParChantier = {},
  finParChantier = {},
  agg = {},
  cfg = {},
  statutsLabels = {},
  maintenant = new Date(),
} = {}) {
  const erreurs = [];
  const noter = (source, error) => {
    if (!error) return null;
    console.error(`Export Markdown opération — ${source} :`, error);
    erreurs.push(`${source} : ${error.message || String(error)}`);
    return null;
  };

  const ids = chantiersOp.map((c) => c?.id).filter(Boolean);
  const vide = { data: [], error: null };
  const parIds = (table, select, options) =>
    (ids.length > 0 ? lireParIds(table, select, ids, options) : Promise.resolve(vide));

  const [
    configRes, groupesTypes, equipes, biblioRatiosRes, materiauxRes,
    rapportsRes, lignesRes, besoinsRes, controlesRes, reservesRes, visitesRes,
    notesChantierRes, notesPlanningRes, plansRes, facturesRes, cellsRes,
    avancementRes, suggestionsRes, liensProjetsRes,
  ] = await Promise.all([
    supabase.from("planning_config").select("key,value").in("key", ["chantier_adresses", "bloc_todos"]),
    loadGroupesTypes().catch((e) => { noter("groupes types", e); return []; }),
    loadEquipes().catch((e) => { noter("équipes", e); return []; }),
    supabase.from("bibliotheque_ratios")
      .select("id, identifiant, libelle, unite, cadence, coefficient_vente_valeur, taux_horaire_vente_valeur, coef_vente"),
    supabase.from("materiaux_bibliotheque").select("id, nom, reference, unite, fournisseur"),
    parIds("rapports",
      "id, chantier_id, ouvrier, date_rapport, taches, remarque, submitted_at, photos_chantier, trajet_matin_min, trajet_soir_min, statut, valide_par, heures_indirectes"),
    parIds("commande_lignes",
      "id, chantier_id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, created_at, commande:commandes(id, doc_numero, numero_en_attente, date_doc, fournisseur_nom, statut_completude, statut_facturation)"),
    parIds("besoins",
      "id, chantier_id, article, quantite, unite, ouvrier_demandeur, statut, notes, priorite, created_at, materiau_id"),
    parIds("controles_groupe",
      "id, chantier_id, groupe_id, groupe_nom, date_controle, auteur, nb_taches, nb_conformes"),
    parIds("reserves",
      "id, chantier_id, groupe_id, tache_id, tache_nom, statut, commentaire, auteur, created_at, levee_le, levee_par"),
    parIds("visites_chantier",
      "id, chantier_id, date, intervenant, meteo, statut, note_generale, lots_audites, audit, checklist"),
    parIds("chantier_notes", "chantier_id, contenu, updated_at"),
    parIds("planning_notes", "chantier_id, contenu, updated_at"),
    parIds("plans", "id, chantier_id, name, created_at, updated_at"),
    parIds("chantier_factures_client",
      "id, chantier_id, numero, ligne_nom, date_facture, montant_ht, statut, date_encaissement, document_nom, source"),
    parIds("planning_cells", "week_id, chantier_id, jour, planifie, reel, ouvriers"),
    parIds("chantier_avancement_history", "chantier_id, avancement, taches_terminees, taches_total, date_snapshot"),
    parIds("suggestions_materiaux_ouvriers",
      "id, chantier_id, materiau_id, designation_libre, unite, quantite_totale, precision_ouvrier, statut, cree_le"),
    parIds("chantier_projets", "chantier_id, projet_id"),
  ]);

  [
    ["réglages (adresses, tâches partagées)", configRes],
    ["bibliothèque des ouvrages", biblioRatiosRes],
    ["bibliothèque des matériaux", materiauxRes],
    ["comptes rendus", rapportsRes],
    ["lignes de commande", lignesRes],
    ["besoins matériaux", besoinsRes],
    ["contrôles de groupe", controlesRes],
    ["réserves", reservesRes],
    ["visites de chantier", visitesRes],
    ["notes de chantier", notesChantierRes],
    ["notes de planning", notesPlanningRes],
    ["plans", plansRes],
    ["factures client", facturesRes],
    ["planning hebdomadaire", cellsRes],
    ["historique d'avancement", avancementRes],
    ["matériaux signalés par les équipes", suggestionsRes],
    ["rattachement des chiffrages", liensProjetsRes],
  ].forEach(([nom, res]) => noter(nom, res?.error));

  // Chiffrages rattachés (client + conditions de vente par ligne). Deux
  // requêtes supplémentaires SEULEMENT si un rattachement existe réellement.
  const liensProjets = (liensProjetsRes?.data || []).filter((l) => l?.projet_id);
  let projets = [];
  let lignesChiffrage = [];
  if (liensProjets.length > 0) {
    const projetIds = [...new Set(liensProjets.map((l) => l.projet_id))];
    const [projetsRes, lignesChiffrageRes] = await Promise.all([
      lireParIds("profero_projets",
        "id, client_nom, client_prenom, client_societe, client_email, client_telephone, client_adresse, client_code_postal, client_ville, devis_objet, logement_reference, mode_coefficient, coefficient_global_valeur, coefficient_global_libelle, mode_taux_horaire, taux_horaire_global_valeur, taux_horaire_global_libelle",
        projetIds, { colonne: "id" }),
      lireParIds("profero_ouvrages_selectionnes",
        "projet_id, code_ouvrage, item, zone, quantite, unite, prix_unitaire, coefficient_source, coefficient_ligne_valeur, coefficient_origine_valeur, coef_vente, taux_horaire_source, taux_horaire_ligne_valeur, taux_horaire_origine_valeur, taux_horaire_vente, ordre",
        projetIds, { colonne: "projet_id" }),
    ]);
    noter("chiffrages rattachés", projetsRes.error);
    noter("lignes de chiffrage", lignesChiffrageRes.error);
    projets = projetsRes.data || [];
    lignesChiffrage = lignesChiffrageRes.data || [];
  }

  const config = Object.fromEntries((configRes?.data || []).map((r) => [r.key, r.value]));
  const adresses = config.chantier_adresses || {};
  const todosTous = Array.isArray(config.bloc_todos?.items)
    ? config.bloc_todos.items
    : (Array.isArray(config.bloc_todos) ? config.bloc_todos : []);

  const lots = cfg.lots_travaux?.items || [];
  const tauxHoraires = cfg.taux_horaires || {};
  const materiauxById = {};
  (materiauxRes?.data || []).forEach((m) => { materiauxById[String(m.id)] = m; });
  const ratiosById = {};
  (biblioRatiosRes?.data || []).forEach((r) => { ratiosById[String(r.id)] = r; });
  const equipeParGroupeType = {};
  (groupesTypes || []).forEach((gt) => {
    const eq = (equipes || []).find((e) => e.id === gt.equipe_id);
    equipeParGroupeType[gt.id] = { groupeTypeNom: gt.nom || null, equipeNom: eq?.nom || null };
  });

  const projetsById = {};
  projets.forEach((p) => { projetsById[String(p.id)] = p; });
  const lignesChiffrageParProjet = grouper(lignesChiffrage, "projet_id");
  const projetParChantier = {};
  liensProjets.forEach((l) => { (projetParChantier[l.chantier_id] ||= []).push(String(l.projet_id)); });

  const parChantier = {
    rapports: grouper(rapportsRes?.data),
    lignes: grouper(lignesRes?.data),
    besoins: grouper(besoinsRes?.data),
    controles: grouper(controlesRes?.data),
    reserves: grouper(reservesRes?.data),
    visites: grouper(visitesRes?.data),
    notesChantier: grouper(notesChantierRes?.data),
    notesPlanning: grouper(notesPlanningRes?.data),
    plans: grouper(plansRes?.data),
    factures: grouper(facturesRes?.data),
    cells: grouper(cellsRes?.data),
    avancement: grouper(avancementRes?.data),
    suggestions: grouper(suggestionsRes?.data),
  };
  const todosParChantier = grouper(todosTous.filter((t) => t && t.chantier_id));

  const aujourdhui = toISO(maintenant);

  const chantiers = chantiersOp.map((c) => normaliserChantier({
    chantier: c,
    phasage: phasagesParChantier[c.id] || null,
    pointages: pointagesParChantier[c.id] || [],
    finance: finParChantier[c.id]?.finance || null,
    adresse: texteOuNull(adresses?.[c.id]?.adresse),
    statutLabel: statutsLabels[c.statut] || statutsLabels.en_cours || c.statut || null,
    lots, tauxHoraires, materiauxById, ratiosById, equipeParGroupeType,
    sources: {
      rapports: parChantier.rapports[c.id] || [],
      lignes: parChantier.lignes[c.id] || [],
      besoins: parChantier.besoins[c.id] || [],
      controles: parChantier.controles[c.id] || [],
      reserves: parChantier.reserves[c.id] || [],
      visites: parChantier.visites[c.id] || [],
      notesChantier: parChantier.notesChantier[c.id] || [],
      notesPlanning: parChantier.notesPlanning[c.id] || [],
      plans: parChantier.plans[c.id] || [],
      factures: parChantier.factures[c.id] || [],
      cells: parChantier.cells[c.id] || [],
      avancement: parChantier.avancement[c.id] || [],
      suggestions: parChantier.suggestions[c.id] || [],
      todos: todosParChantier[c.id] || [],
      projets: (projetParChantier[c.id] || []).map((pid) => ({
        projet: projetsById[pid] || null,
        lignes: lignesChiffrageParProjet[pid] || [],
      })).filter((x) => x.projet),
    },
    aujourdhui,
  }));

  const modele = assemblerModele({ op, chantiers, agg, statutsLabels, erreurs, maintenant });
  return { modele, erreurs };
}

const toISO = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

// ─── SORTIE FICHIER ──────────────────────────────────────────────────────────

// Déclenche le téléchargement du fichier en UTF-8.
// PAS DE BOM, contrairement aux exports CSV de l'application : un BOM placerait
// un caractère invisible AVANT le « --- » d'ouverture, et le frontmatter YAML
// ne serait plus reconnu comme tel. Le type MIME annonce déjà l'encodage, et
// les accents sortent correctement dans tous les éditeurs testés.
export function telechargerMarkdown(nomFichier, contenu) {
  const blob = new Blob([contenu], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomFichier;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Enchaînement complet : chargement → rédaction → téléchargement.
// Renvoie { nomFichier, erreurs, nbChantiers, taille } ; lève si le chargement
// lui-même est impossible (l'appelant affiche alors une erreur franche).
export async function exporterOperationMarkdown(params) {
  const { modele, erreurs } = await chargerDonneesExportOperation(params);
  const contenu = construireMarkdownOperation(modele);
  // Date LOCALE dans le nom du fichier : `toISOString()` renverrait la veille
  // pour un export lancé après 22 h en heure d'été française.
  const nomFichier = nomFichierMarkdownOperation(
    params?.op?.nom,
    toISO(params?.maintenant instanceof Date ? params.maintenant : new Date()),
  );
  telechargerMarkdown(nomFichier, contenu);
  return { nomFichier, erreurs, nbChantiers: modele.chantiers.length, taille: contenu.length };
}
