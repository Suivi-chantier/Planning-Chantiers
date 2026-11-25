// ─────────────────────────────────────────────────────────────────────────────
// securiteCycleVieDonnees — écritures de la fiche sécurité liées au cycle de
// vie du chantier (tâche 7 du projet docs/projets/fiche-securite-chantier.md).
//
//   - lecture de l'état d'une fiche (statut, version, validation, forçage) ;
//   - étape « Fiche sécurité validée » (fiche_securite) enregistrée dans
//     chantier_cycle_vie, par le même service que les autres étapes
//     (ecrireEtapeCycleVie) ;
//   - forçage du démarrage par un admin (fiche + journal du chantier) ;
//   - verrouillage de la fiche quand le chantier passe « terminé ».
//
// Les règles (quoi écrire, dans quel ordre) viennent du module pur
// securiteCycleVie.mjs ; ici on ne fait qu'écrire, dans l'ordre prévu, et on
// s'arrête à la première erreur en la renvoyant telle quelle. Aucune
// suppression. Chaque fonction renvoie { ok, …, erreur }.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { journaliserStatut } from "./chantiersDonnees.js";
import { ecrireEtapeCycleVie } from "./cycleVieDonnees.js";
import {
  ETAPE_FICHE_SECURITE, etatEtapePourEcriture, preparerForcage, preparerVerrouillage,
} from "./securiteCycleVie.js";

export const COLS_FICHE_STATUT = "id, chantier_id, version, statut, validee_le, validee_par, forcage_motif, forcage_par, forcage_le, updated_at";
const msg = (e) => e?.message || String(e);

/** État de la fiche d'un chantier → { ligne (null = pas de fiche), lecture: "ok" | "erreur", erreur }. */
export async function chargerFicheStatut(chantierId) {
  if (!chantierId) return { ligne: null, lecture: "erreur", erreur: "chantier inconnu" };
  try {
    const { data, error } = await supabase.from("securite_fiches").select(COLS_FICHE_STATUT)
      .eq("chantier_id", String(chantierId)).maybeSingle();
    if (error) return { ligne: null, lecture: "erreur", erreur: error.message };
    return { ligne: data || null, lecture: "ok", erreur: null };
  } catch (e) {
    return { ligne: null, lecture: "erreur", erreur: msg(e) };
  }
}

/**
 * Enregistre l'état de l'étape fiche_securite du cycle de vie, d'après la
 * fiche RELUE en base (jamais l'état affiché). Les autres informations de
 * l'étape (pièces jointes) sont conservées.
 * → { ok, etat?, erreur? } — fiche illisible : rien n'est écrit.
 */
export async function synchroniserEtapeFicheSecurite({ chantierId, auteur = "" }) {
  const f = await chargerFicheStatut(chantierId);
  if (f.lecture !== "ok") return { ok: false, erreur: `fiche illisible (${f.erreur}) : étape non mise à jour` };
  const aEcrire = etatEtapePourEcriture({ fiche: f.ligne, lecture: "ok", auteur, le: new Date().toISOString() });
  if (!aEcrire) return { ok: false, erreur: "état de fiche inattendu : étape non mise à jour" };
  const r = await ecrireEtapeCycleVie({
    chantierId, etapeId: ETAPE_FICHE_SECURITE, auteur,
    updater: (courant) => ({ ...courant, ...aEcrire }),
  });
  if (!r.ok) console.error("synchroniserEtapeFicheSecurite :", r.erreur);
  return r;
}

/**
 * Forçage du démarrage (admin, motif obligatoire). Relit la fiche, puis :
 *   1. fiche : créée en brouillon avec le forçage, ou forçage ajouté (sauf
 *      fiche verrouillée : le motif ne va qu'au journal) ;
 *   2. journal du chantier (événement fiche_securite).
 * Le statut « en cours » est enregistré ENSUITE par l'écran, seulement si
 * ok. → { ok, dejaValidee?, erreur }
 */
export async function forcerDemarrage({ chantier, ancienStatut, estAdmin, motif, auteur }) {
  try {
    const f = await chargerFicheStatut(chantier?.id);
    if (f.lecture !== "ok") return { ok: false, erreur: `fiche sécurité illisible (${f.erreur}) : rien n'a été modifié` };
    if (f.ligne?.statut === "validee") return { ok: true, dejaValidee: true, erreur: null };
    const prep = preparerForcage({ chantier, ancienStatut, fiche: f.ligne, lecture: "ok", estAdmin, motif, auteur, le: new Date().toISOString() });
    if (!prep.ok) return { ok: false, erreur: prep.erreurs.join(" ") };

    if (prep.ficheInsert) {
      const { error } = await supabase.from("securite_fiches").insert(prep.ficheInsert).select("id").single();
      if (error) return { ok: false, erreur: `fiche non créée (${error.message}) : rien n'a été modifié` };
    } else if (prep.fichePatch) {
      const c = prep.conditionFiche;
      const { data, error } = await supabase.from("securite_fiches").update(prep.fichePatch)
        .eq("id", c.id).eq("statut", c.statut).eq("version", c.version).select("id");
      if (error) return { ok: false, erreur: `forçage non noté sur la fiche (${error.message}) : rien n'a été modifié` };
      if (!data || data.length !== 1) return { ok: false, erreur: "la fiche a changé entre-temps : rechargez puis recommencez (rien n'a été modifié)" };
    }

    const j = await journaliserStatut(prep.journal);
    if (!j.ok) return { ok: false, erreur: `forçage noté sur la fiche, mais l'historique du chantier n'a pas pu être écrit (${j.erreur}) : le statut n'a PAS été changé, recommencez` };
    await synchroniserEtapeFicheSecurite({ chantierId: chantier.id, auteur });
    return { ok: true, erreur: null };
  } catch (e) {
    return { ok: false, erreur: msg(e) };
  }
}

/**
 * Verrouillage de la fiche d'un chantier qui vient de passer « terminé ».
 * À appeler APRÈS l'enregistrement du statut. Relit la fiche, la passe en
 * « verrouillée » (seulement si son état n'a pas changé), puis écrit le
 * journal. → { ok, rien?, ficheVersion?, erreur, avertissement }
 *   rien : pas de fiche (chantier sans fiche) ou déjà verrouillée.
 */
export async function verrouillerFicheSecurite({ chantier, auteur }) {
  try {
    const f = await chargerFicheStatut(chantier?.id);
    if (f.lecture !== "ok") return { ok: false, erreur: `fiche sécurité illisible (${f.erreur}) : elle n'est PAS verrouillée` };
    if (!f.ligne || f.ligne.statut === "verrouillee") return { ok: true, rien: true, erreur: null, avertissement: null };
    const prep = preparerVerrouillage({ chantier, fiche: f.ligne, auteur });
    if (!prep.ok) return { ok: false, erreur: prep.erreurs.join(" ") };
    const c = prep.conditionFiche;
    const { data, error } = await supabase.from("securite_fiches").update(prep.fichePatch)
      .eq("id", c.id).eq("statut", c.statut).eq("version", c.version).select("id");
    if (error) return { ok: false, erreur: `fiche sécurité NON verrouillée (${error.message})` };
    if (!data || data.length !== 1) return { ok: false, erreur: "fiche sécurité NON verrouillée : elle a changé entre-temps, rouvrez le chantier pour recommencer" };
    const j = await journaliserStatut(prep.journal);
    await synchroniserEtapeFicheSecurite({ chantierId: chantier.id, auteur });
    return { ok: true, ficheVersion: f.ligne.version, erreur: null,
      avertissement: j.ok ? null : `Fiche verrouillée, mais l'historique du chantier n'a pas été complété (${j.erreur}).` };
  } catch (e) {
    return { ok: false, erreur: msg(e) };
  }
}
