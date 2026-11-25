// ─────────────────────────────────────────────────────────────────────────────
// planV2DonneesRequetes — nouvel éditeur de plans : les REQUÊTES sur la base
// (docs/projets/editeur-plans.md, règle 1). Le front n'importe pas ce fichier
// mais planV2Donnees.js, qui lui fournit le client Supabase de l'application.
//
// CE N'EST PAS un module de calcul pur : il lit et écrit par le client reçu en
// paramètre. L'extension .mjs sert à l'exécuter sous Node, avec un faux
// client, dans scripts/verif-plan-v2-document.mjs (garde contre l'écrasement,
// erreurs qui remontent, aucune écriture dans l'ancienne table).
//
// DEUX TABLES, DEUX RÈGLES
//   • plans_v2 — la table du nouvel éditeur : lecture et écriture.
//   • plans    — la table de l'ancien éditeur : LECTURE SEULE, et seulement
//     pour copier un relevé. Aucun insert, update, upsert, delete, aucun appel
//     de fonction (rpc) : contrôlé par scripts/verif-plan-v2-aucune-ecriture-plans.mjs.
//
// ERREURS. Chaque fonction renvoie { ok: true, … } ou { ok: false, code,
// erreur } ; `erreur` est une phrase affichable. En cas d'échec, la liste ou
// le plan attendu est ABSENT de la réponse : un échec ne peut pas être pris
// pour « aucun plan ».
//
// ÉCRASEMENT. La base date chaque modification (updated_at). Enregistrer un
// plan exige la date de la version qu'on a ouverte : si la base en porte une
// autre, quelqu'un a enregistré entre-temps et rien n'est écrit (« conflit »).
// ─────────────────────────────────────────────────────────────────────────────
import { resumerDocumentPlan } from "./planV2Document.mjs";

// Colonnes de la liste : tout sauf le document (plusieurs centaines de ko).
export const COLONNES_PLAN = "id, chantier_id, nom, logement, resume, origine_plan_id, cree_par, modifie_par, created_at, updated_at";
export const COLONNES_ANCIEN_PLAN = "id, name, chantier_id, updated_at";

const echec = (code, erreur, plus = {}) => ({ ok: false, code, erreur, ...plus });
const texte = (v) => String(v ?? "").trim();

// Attend une requête Supabase. → { ok: true, data } ou échec lisible.
async function executer(requete, quoi) {
  try {
    const { data, error } = await requete;
    if (error) return echec(error.code === "23503" ? "chantier_inconnu" : "base", `${quoi} : ${error.message || "erreur inconnue"}`);
    return { ok: true, data };
  } catch (e) {
    return echec("reseau", `${quoi} : ${e?.message || e}`);
  }
}

// `client` : client Supabase. `auteur` : fonction → adresse de l'utilisateur
// connecté (ou null), notée dans cree_par / modifie_par.
export function creerAccesPlans({ client, auteur = async () => null }) {
  const qui = async () => { try { return (await auteur()) || null; } catch { return null; } };

  // Plans du nouvel éditeur, les plus récents d'abord, SANS leur document.
  // `chantierId` absent : tous les chantiers.
  async function listerPlans({ chantierId = null } = {}) {
    let requete = client.from("plans_v2").select(COLONNES_PLAN).order("updated_at", { ascending: false });
    if (chantierId != null) requete = requete.eq("chantier_id", chantierId);
    const r = await executer(requete, "Lecture des plans impossible");
    return r.ok ? { ok: true, plans: r.data || [] } : r;
  }

  // Un plan complet, document compris (à ouvrir avec ouvrirDocumentPlan).
  async function lirePlan(id) {
    const r = await executer(client.from("plans_v2").select("*").eq("id", id).maybeSingle(), "Lecture du plan impossible");
    if (!r.ok) return r;
    if (!r.data) return echec("introuvable", "Ce plan n'existe pas (ou plus), ou vous n'y avez pas accès.");
    return { ok: true, plan: r.data };
  }

  // Crée un plan. Le chantier est obligatoire (règle 1 : un plan est toujours
  // rattaché à un chantier). L'identifiant de l'ancien plan copié est lu dans
  // le document (source), pas reçu à part : une seule source.
  async function creerPlan({ chantierId, nom, logement = "", document }) {
    if (!texte(chantierId)) return echec("chantier_absent", "Un plan est toujours rattaché à un chantier : choisissez le chantier avant de créer le plan.");
    if (!texte(nom)) return echec("nom_absent", "Donnez un nom au plan avant de le créer.");
    const resume = resumerDocumentPlan(document);
    if (!resume.ok) return resume;                       // jamais de document illisible en base
    const email = await qui();
    const ligne = {
      chantier_id: texte(chantierId), nom: texte(nom), logement: texte(logement),
      data: document, resume: resume.resume,
      origine_plan_id: document.source?.type === "ancien_plan" ? document.source.plan_id : null,
      cree_par: email, modifie_par: email,
    };
    const r = await executer(client.from("plans_v2").insert(ligne).select(COLONNES_PLAN).single(), "Création du plan impossible");
    if (!r.ok) return r.code === "chantier_inconnu" ? echec(r.code, "Ce chantier n'existe pas dans la liste des chantiers : le plan n'a pas été créé.") : r;
    return { ok: true, plan: r.data };
  }

  // Une écriture qui n'a touché aucune ligne : le plan a disparu, ou sa date a changé.
  async function expliquerAucuneLigne(id, quoi) {
    const r = await executer(client.from("plans_v2").select("id, updated_at, modifie_par").eq("id", id).maybeSingle(), quoi);
    if (!r.ok) return r;
    if (!r.data) return echec("introuvable", "Ce plan n'existe plus, ou vous n'y avez plus accès : rien n'a été enregistré.");
    return echec("conflit",
      `Ce plan a été modifié ailleurs depuis que vous l'avez ouvert${r.data.modifie_par ? ` (par ${r.data.modifie_par})` : ""} : votre version n'a pas été enregistrée, pour ne pas écraser la sienne.`,
      { serveur: { updated_at: r.data.updated_at, modifie_par: r.data.modifie_par ?? null } });
  }

  // Enregistre le document ENTIER d'un plan, avec son résumé. `updatedAtConnu` :
  // le updated_at du plan tel qu'on l'a lu (ou reçu du dernier enregistrement).
  // `forcer: true` écrase sans comparer — sur action explicite de l'utilisateur.
  // → { ok, plan } : le plan rendu porte le nouveau updated_at, à garder.
  async function enregistrerPlan({ id, document, updatedAtConnu = null, forcer = false }) {
    const resume = resumerDocumentPlan(document);
    if (!resume.ok) return resume;
    if (!forcer && !updatedAtConnu) {
      return echec("version_ouverte_inconnue", "La date de la version ouverte manque : l'enregistrement est refusé pour ne pas écraser une version plus récente.");
    }
    let requete = client.from("plans_v2").update({ data: document, resume: resume.resume, modifie_par: await qui() }).eq("id", id);
    if (!forcer) requete = requete.eq("updated_at", updatedAtConnu);
    const r = await executer(requete.select(COLONNES_PLAN), "Enregistrement du plan impossible");
    if (!r.ok) return r;
    if ((r.data || []).length !== 1) return expliquerAucuneLigne(id, "Enregistrement du plan impossible");
    return { ok: true, plan: r.data[0] };
  }

  // Change le nom et / ou le logement. La base redate le plan : un éditeur
  // ouvert sur ce plan doit reprendre le updated_at rendu ici.
  async function renommerPlan({ id, nom, logement }) {
    const champs = {};
    if (nom !== undefined) {
      if (!texte(nom)) return echec("nom_absent", "Le nom du plan ne peut pas être vide.");
      champs.nom = texte(nom);
    }
    if (logement !== undefined) champs.logement = texte(logement);
    if (!Object.keys(champs).length) return echec("rien_a_changer", "Aucun changement à enregistrer.");
    const r = await executer(client.from("plans_v2").update({ ...champs, modifie_par: await qui() }).eq("id", id).select(COLONNES_PLAN), "Modification du plan impossible");
    if (!r.ok) return r;
    if ((r.data || []).length !== 1) return echec("introuvable", "Ce plan n'existe plus, ou vous n'y avez plus accès : rien n'a été modifié.");
    return { ok: true, plan: r.data[0] };
  }

  // Supprime un plan du nouvel éditeur. Les photos du relevé ne sont PAS
  // supprimées du stockage : un plan copié les partage avec l'ancien plan.
  async function supprimerPlan(id) {
    const r = await executer(client.from("plans_v2").delete().eq("id", id).select("id"), "Suppression du plan impossible");
    if (!r.ok) return r;
    if ((r.data || []).length !== 1) return echec("introuvable", "Ce plan n'existe plus, ou vous n'y avez plus accès : rien n'a été supprimé.");
    return { ok: true };
  }

  // ── Ancienne table : lecture seule ────────────────────────────────────────
  // Anciens plans qui contiennent un relevé, SANS charger leur contenu : le
  // filtre (présence de data.releve.pieces) est fait par la base.
  async function listerAnciensPlansAvecReleve() {
    const r = await executer(
      client.from("plans").select(COLONNES_ANCIEN_PLAN).not("data->releve->pieces", "is", null).order("updated_at", { ascending: false }),
      "Lecture des anciens plans impossible");
    return r.ok ? { ok: true, plans: r.data || [] } : r;
  }

  // Le relevé d'un ancien plan, et lui seul (ni dessin, ni miniature).
  // → { ok, ancien: { id, name, chantier_id, updated_at }, releve }
  async function lireReleveAncienPlan(id) {
    const r = await executer(
      client.from("plans").select(`${COLONNES_ANCIEN_PLAN}, releve:data->releve`).eq("id", id).maybeSingle(),
      "Lecture de l'ancien plan impossible");
    if (!r.ok) return r;
    if (!r.data) return echec("introuvable", "Cet ancien plan n'existe pas (ou plus), ou vous n'y avez pas accès.");
    const { releve, ...ancien } = r.data;
    if (!releve || !Array.isArray(releve.pieces)) return echec("sans_releve", "Cet ancien plan ne contient pas de relevé : il ne peut pas servir de départ.");
    return { ok: true, ancien, releve };
  }

  return {
    listerPlans, lirePlan, creerPlan, enregistrerPlan, renommerPlan, supprimerPlan,
    listerAnciensPlansAvecReleve, lireReleveAncienPlan,
  };
}
