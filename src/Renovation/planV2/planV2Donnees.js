// ─────────────────────────────────────────────────────────────────────────────
// planV2Donnees — nouvel éditeur de plans : lecture et écriture des plans.
// SEUL endroit du front qui touche la table plans_v2, et seul endroit du
// nouvel éditeur qui lit l'ancienne table des plans (lecture seule, pour
// copier un relevé — règle 1 de docs/projets/editeur-plans.md).
//
// Les requêtes elles-mêmes sont dans planV2DonneesRequetes.mjs (testées sous
// Node avec un faux client) ; ce fichier leur donne le client Supabase de
// l'application et l'adresse de l'utilisateur connecté.
//
// Chaque fonction renvoie { ok: true, … } ou { ok: false, code, erreur } :
//   listerPlans({ chantierId })                    → { plans }   (sans document)
//   lirePlan(id)                                   → { plan }    (avec `data`)
//   creerPlan({ chantierId, nom, logement, document })            → { plan }
//   enregistrerPlan({ id, document, updatedAtConnu, forcer })     → { plan }
//   renommerPlan({ id, nom, logement })            → { plan }
//   supprimerPlan(id)
//   listerAnciensPlansAvecReleve()                 → { plans }   (ancienne table)
//   lireReleveAncienPlan(id)                       → { ancien, releve }
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../../supabase";
import { creerAccesPlans } from "./planV2DonneesRequetes.mjs";

// Adresse de l'utilisateur connecté, lue dans la session locale (pas d'appel
// réseau : la sauvegarde automatique enregistre souvent).
async function auteur() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.email || null;
}

export const {
  listerPlans, lirePlan, creerPlan, enregistrerPlan, renommerPlan, supprimerPlan,
  listerAnciensPlansAvecReleve, lireReleveAncienPlan,
} = creerAccesPlans({ client: supabase, auteur });
