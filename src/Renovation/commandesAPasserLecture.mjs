// ─────────────────────────────────────────────────────────────────────────────
// commandesAPasserLecture — LES lectures de la page « Commandes à passer »
// (liste des articles à commander), partagées entre le navigateur et le
// serveur (projet docs/projets/organisation-par-jour.md, tâche 15).
//
// Utilisées par (MÊME CHIFFRE = MÊME SERVICE) :
//   - la page « Commandes à passer », les blocs du jour « Commandes à saisir »
//     et « Matériaux à commander », via commandesAPasserDonnees.js (client du
//     navigateur) ;
//   - le mail récap du vendredi, partie « Matériaux à commander · semaine
//     prochaine » (api/_cron/cron-recap-commandes.js, client service du
//     serveur).
// Requêtes déplacées À L'IDENTIQUE de commandesAPasserDonnees.js (tâche 7) :
// mêmes tables, colonnes, filtres, tris, lecture par tranches. Aucun calcul
// ici : le modèle est dans commandesAPasserV1.mjs, le rangement par semaine
// dans commandesParSemaineV1.mjs.
//
// Ce n'est PAS un module de calcul : il lit la base, avec le client Supabase
// passé en paramètre (il n'en crée aucun et n'importe pas celui du
// navigateur). Extension .mjs pour être chargé tel quel par Node
// (`await import()` depuis api/). Aucune horloge, aucune écriture.
// ─────────────────────────────────────────────────────────────────────────────
import { lireToutParTranches } from "./lectureParTranches.mjs";
import { chargerTousLesMateriauxAvec } from "./chargerMateriauxLecture.mjs";
import { chargerAchatsTerminesAvec, achatsTerminesParChantier } from "./achatsLotsTerminesLecture.mjs";
import { lireLotsTravaux } from "../lotsDefaut.mjs";
import { COLONNES_LECTURE_CHANTIERS, trierLignes, depuisLigneChantier } from "./chantiersTables.mjs";
import { filtrerChantiersActifs } from "./chantierActif.mjs";

/** Colonnes de la bibliothèque lues par la page (valorisation des matériaux liés). */
export const COLONNES_MATERIAUX_COMMANDES = "id, nom, reference, unite, prix_unitaire, fournisseur, fournisseur_id, lien_fournisseur, photo_url";

/** Phasages (ouvrages et matériaux liés). Rend { data, error }. */
export function lirePhasagesCommandesAvec(client) {
  return client
    .from("phasages")
    .select("id, chantier_id, chantier_nom, ouvrages");
}

/**
 * Lignes de commande existantes (+ en-tête commande). Par tranches : plus de
 * 1 000 lignes en base, une lecture d'un coup serait tronquée sans erreur (et
 * le reste à commander avec). Rend { data, error }.
 */
export function lireLignesCommandesAvec(client) {
  return lireToutParTranches((a, b) => client
    .from("commande_lignes")
    .select("id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, nature, ouvrage_id, chantier_id, phasage_id, commande:commandes(id, doc_numero, numero_en_attente, date_doc, fournisseur_nom, statut_completude, statut_facturation, type_evenement)")
    .order("id").range(a, b));
}

/** Bibliothèque matériaux en entier (par tranches, chargerMateriauxLecture.mjs). */
export function lireMateriauxCommandesAvec(client) {
  return chargerTousLesMateriauxAvec(client, COLONNES_MATERIAUX_COMMANDES);
}

const messageErreur = (e) => (e ? (typeof e === "string" ? e : e.message || String(e)) : null);

/**
 * Toutes les entrées de modeleCommandesAPasser (hors chantiers), avec les
 * mêmes lectures que la page.
 * @param {object} client client Supabase (navigateur ou serveur)
 * @returns {Promise<{ erreur: string|null, phasages, lignesCmd, achatsParCh, materiaux, lots }>}
 *   `erreur` : première lecture en échec (la page les ignore ; le bloc et le
 *   mail l'affichent plutôt qu'un chiffre faux).
 */
export async function lireDonneesCommandesAPasser(client) {
  const [ph, lc, ach, mat, lots] = await Promise.all([
    lirePhasagesCommandesAvec(client), lireLignesCommandesAvec(client), chargerAchatsTerminesAvec(client),
    lireMateriauxCommandesAvec(client), lireLotsTravaux(client),
  ]);
  const erreur = [ph, lc, ach, mat].map(r => messageErreur(r.error)).filter(Boolean)[0] || null;
  return {
    erreur,
    phasages: ph.data || [], lignesCmd: lc.data || [],
    achatsParCh: achatsTerminesParChantier(ach.data), materiaux: mat.data || [], lots,
  };
}

/**
 * Chantiers que reçoit la page « Commandes à passer » : ceux de
 * l'application (chargerChantiers de chantiersDonnees.js : même table, mêmes
 * colonnes COLONNES_LECTURE_CHANTIERS, même tri trierLignes, archivés écartés,
 * depuisLigneChantier), filtrés comme App.jsx (chantiersExploitation :
 * filtrerChantiersActifs, terminés inclus).
 * Seule différence assumée : le navigateur se replie sur la copie
 * planning_config si la table ne répond pas ; ici, l'échec est RENDU
 * (`erreur`) pour être affiché (règle « une impossibilité reste visible »).
 * @param {object} client client Supabase (serveur)
 * @returns {Promise<{ chantiers: Array, erreur: string|null }>}
 */
export async function lireChantiersCommandesAvec(client) {
  const { data, error } = await client.from("chantiers").select(COLONNES_LECTURE_CHANTIERS);
  if (error) return { chantiers: [], erreur: `chantiers : ${messageErreur(error)}` };
  const chantiers = trierLignes(data || [])
    .filter((l) => !l.archive_le)
    .map(depuisLigneChantier)
    .filter(Boolean);
  return { chantiers: filtrerChantiersActifs(chantiers, { inclureTermines: true }), erreur: null };
}
