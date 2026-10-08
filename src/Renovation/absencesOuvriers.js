// Lecture des absences des ouvriers pour les écrans du bureau (Validation,
// Bilan de semaine, Heures des salariés). Le calcul lui-même est dans le
// module pur cibleJourneeOuvrier.mjs — ce fichier ne fait que charger les
// données et les assembler, pour que les trois écrans donnent le même chiffre.
import { supabase } from "../supabase";
import { heuresJourEntreprise } from "../rythmeSemaine";
import { cibleJourneeOuvrier, attenduOuvrierPeriode, ressourceDeLOuvrier } from "./cibleJourneeOuvrier";

// { ok, ressources, evenements, exceptions } — ok=false si une lecture échoue
// (les écrans l'affichent au lieu de faire comme s'il n'y avait pas d'absence).
export async function chargerAbsencesOuvriers() {
  const [rRes, eRes, cRes] = await Promise.all([
    supabase.from("planning_resources").select("id,nom_planning,auth_user_id"),
    supabase.from("planning_resource_events")
      .select("id,resource_id,type,date_debut,date_fin,toute_journee,heures_indisponibles,motif,actif")
      .eq("actif", true),
    supabase.from("planning_config").select("value").eq("key", "heures_par_jour").maybeSingle(),
  ]);
  const erreur = rRes.error || eRes.error || cRes.error;
  if (erreur) console.warn("Absences des ouvriers :", erreur);
  return {
    ok: !erreur,
    ressources: rRes.data || [],
    evenements: eRes.data || [],
    exceptions: cRes.data?.value?.exceptions || {},
  };
}

// Cible d'un ouvrier (par prénom) à une date. ficheTrouvee=false : aucune
// fiche ressource pour ce prénom → absences non vérifiées.
export function cibleOuvrierPourDate(donnees, prenom, dateISO) {
  const res = ressourceDeLOuvrier(donnees?.ressources, { prenom });
  const c = cibleJourneeOuvrier({
    heuresJour: heuresJourEntreprise(dateISO, donnees?.exceptions),
    evenements: donnees?.evenements, resourceId: res?.id || null, dateISO,
  });
  return { ...c, ficheTrouvee: !!res };
}

// Heures attendues d'un ouvrier sur une liste de dates ISO.
export function attenduOuvrierPourDates(donnees, prenom, datesISO) {
  const res = ressourceDeLOuvrier(donnees?.ressources, { prenom });
  const p = attenduOuvrierPeriode({
    jours: (datesISO || []).map(dateISO => ({ dateISO, heuresJour: heuresJourEntreprise(dateISO, donnees?.exceptions) })),
    evenements: donnees?.evenements, resourceId: res?.id || null,
  });
  return { ...p, ficheTrouvee: !!res };
}
