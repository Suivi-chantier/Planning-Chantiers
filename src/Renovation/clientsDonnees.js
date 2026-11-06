// ─────────────────────────────────────────────────────────────────────────────
// clientsDonnees — fiches client, collaborateurs (chargés d'affaires) et lien
// chiffrage ↔ chantier (Refonte Opérations, lot 2).
//
// Seul endroit du front qui lit ou écrit public.clients. Toute écriture passe
// par la liste unique des règles (reglesSaisieProgbat.mjs) : une fiche
// incomplète est REFUSÉE, avec la liste de ce qui manque.
//
// Lien chiffrage ↔ chantier : table existante chantier_projets (un chiffrage =
// un logement = au plus un chantier, contrainte de base). C'est aussi ce lien
// que la synchronisation des factures ProGBat utilise en repli.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { controlerFiche, genererCodeClient } from "./reglesSaisieProgbat.js";
import { estCollaborateurProposable } from "./roleChargeAffaires.js";

const COLS_CLIENT = "id, type, nom, prenom, raison_sociale, contact_nom, adresse, adresse_complement, code_postal, ville, pays, email, telephone, code_progbat, progbat_client_id, archive_le, created_at, updated_at";
const CHAMPS_SAISIS = ["type", "nom", "prenom", "raison_sociale", "contact_nom", "adresse", "adresse_complement", "code_postal", "ville", "pays", "email", "telephone"];

export const FICHE_CLIENT_VIDE = Object.freeze({
  type: "", nom: "", prenom: "", raison_sociale: "", contact_nom: "",
  adresse: "", adresse_complement: "", code_postal: "", ville: "", pays: "France",
  email: "", telephone: "",
});

/** Libellé court d'une fiche client (liste déroulante, cartes). */
export function libelleClient(c) {
  if (!c) return "";
  if (c.type === "societe") return [c.raison_sociale, c.contact_nom ? `(${c.contact_nom})` : ""].filter(Boolean).join(" ");
  return [c.nom, c.prenom].filter(Boolean).join(" ");
}

function nettoyer(fiche) {
  const out = {};
  CHAMPS_SAISIS.forEach((k) => { out[k] = fiche?.[k] == null ? "" : String(fiche[k]).trim(); });
  if (out.type === "societe") { out.nom = ""; out.prenom = ""; }
  if (out.type === "particulier") { out.raison_sociale = ""; out.contact_nom = ""; }
  return out;
}

export async function chargerClients() {
  const { data, error } = await supabase.from("clients").select(COLS_CLIENT).is("archive_le", null).order("nom").order("raison_sociale");
  return { clients: data || [], erreur: error?.message || null };
}

/**
 * Crée ou modifie une fiche client. Refus si une règle n'est pas respectée.
 * → { ok, client?, manquants?: [{ libelle, message }], erreur? }
 */
export async function enregistrerClient(fiche, { id = null } = {}) {
  const valeurs = nettoyer(fiche);
  const manquants = controlerFiche("client", valeurs);
  if (manquants.length) return { ok: false, manquants };
  const ligne = { ...valeurs, code_progbat: genererCodeClient(valeurs) };
  let res;
  if (id) {
    res = await supabase.from("clients").update(ligne).eq("id", id).select(COLS_CLIENT).single();
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    res = await supabase.from("clients").insert({ ...ligne, cree_par: user?.email || null }).select(COLS_CLIENT).single();
  }
  if (res.error) return { ok: false, erreur: res.error.message };
  return { ok: true, client: res.data };
}

/**
 * Collaborateurs pouvant être chargés d'affaires : comptes actifs, hors
 * ouvriers. La table des comptes n'est lisible en entier que par un
 * administrateur : pour les autres, la liste ne contient que leur propre
 * compte (`complete: false`) — l'écran le dit au lieu de présenter une liste
 * tronquée comme complète.
 */
export async function chargerCollaborateurs() {
  const { data, error } = await supabase.from("utilisateurs").select("id, nom, email, role, actif").order("nom");
  if (error) return { collaborateurs: [], complete: false, erreur: error.message };
  // Lot 6 : règle unique (roleChargeAffaires.mjs) — actifs hors ouvriers, le
  // rôle « Chargé d'affaires » compris.
  const collaborateurs = (data || []).filter(estCollaborateurProposable);
  return { collaborateurs, complete: (data || []).length > 1, erreur: null };
}

export const nomCollaborateur = (u) => (u ? (u.nom || u.email || "") : "");

/** Liens chiffrage → chantier (tous). Map projet_id → chantier_id. */
export async function chargerLiensChiffrage() {
  const { data, error } = await supabase.from("chantier_projets").select("chantier_id, projet_id");
  const parProjet = new Map();
  (data || []).forEach((l) => parProjet.set(l.projet_id, l.chantier_id));
  return { parProjet, erreur: error?.message || null };
}

/** Rattache un chiffrage à son chantier. Refusé s'il l'est déjà ailleurs. */
export async function lierChiffrageChantier(projetId, chantierId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("chantier_projets").insert({
    chantier_id: chantierId, projet_id: projetId,
    cree_par: user?.id || null, cree_par_email: user?.email || null,
  });
  if (!error) return { ok: true };
  return { ok: false, erreur: error.code === "23505" ? "Ce chiffrage est déjà rattaché à un chantier." : error.message };
}
