// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatStatutDevis.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─────────────────────────────────────────────────────────────────────────────
// progbatStatutDevis — statut d'un devis ProGBat (Refonte Opérations, lot 4).
// Module PUR, sans import : copié seul dans l'Edge Function
// progbat-devis-statut-cron (tâche planifiée, LECTURE ProGBat uniquement) et
// réexporté par progbatAutomatisation.mjs.
// Valeurs documentées par ProGBat (QuoteResponse.status) :
// 0 étude (aussi les brouillons), 1 accepté, 2 refusé, 6 en attente.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v == null ? "" : String(v).trim());
const idProgbat = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const STATUTS_DEVIS = Object.freeze({
  0: Object.freeze({ code: "etude", libelle: "À l'étude / brouillon" }),
  1: Object.freeze({ code: "accepte", libelle: "Accepté" }),
  2: Object.freeze({ code: "refuse", libelle: "Refusé" }),
  6: Object.freeze({ code: "attente", libelle: "En attente" }),
});

/** Valeur enregistrée quand ProGBat répond 404 : le devis n'existe plus (supprimé dans ProGBat). */
export const STATUT_INTROUVABLE = -1;

export function interpreterStatutDevis(status) {
  const n = Number.isInteger(status) ? status : (typeof status === "string" && /^-?\d+$/.test(status) ? Number(status) : null);
  if (n == null) return { code: "inconnu", libelle: "Statut inconnu", valeur: null };
  if (n === STATUT_INTROUVABLE) return { code: "introuvable", libelle: "Introuvable dans ProGBat (devis supprimé ?)", valeur: n };
  return STATUTS_DEVIS[n] ? { ...STATUTS_DEVIS[n], valeur: n } : { code: "inconnu", libelle: `Statut ProGBat non documenté (${n})`, valeur: n };
}

// ─── Tâche planifiée : statut des devis (lecture seule côté ProGBat) ─────────
/**
 * depot.devisASuivre() → [{ id, progbat_devis_id, progbat_devis_statut }]
 * depot.majProjet(id, patch)
 * progbat.lireDevis(quoteId) → { ok, data: { status, statusDate } }
 * Aucune écriture vers ProGBat : seule la base Profero est mise à jour.
 */
export async function synchroniserStatutsDevis({ depot, progbat, maintenant = null, max = 150 } = {}) {
  if (!(maintenant instanceof Date)) throw new Error("Date du serveur non fournie.");
  const projets = ((await depot.devisASuivre()) || []).filter((p) => idProgbat(p?.progbat_devis_id) != null).slice(0, max);
  const rapport = { lus: 0, changes: 0, erreurs: 0, acceptes: 0, refuses: 0, introuvables: 0, details: [] };
  for (const p of projets) {
    const qid = idProgbat(p.progbat_devis_id);
    const lu = await progbat.lireDevis(qid);
    if (!lu?.ok && lu?.status === 404) {
      // ProGBat dit que le devis n'existe plus : c'est un résultat, on l'enregistre (l'écran le dira).
      rapport.introuvables++;
      if ((p.progbat_devis_statut ?? null) !== STATUT_INTROUVABLE) rapport.changes++;
      await depot.majProjet(p.id, { progbat_devis_statut: STATUT_INTROUVABLE, progbat_devis_statut_le: null, progbat_devis_statut_lu_le: maintenant.toISOString() });
      continue;
    }
    if (!lu?.ok) {
      rapport.erreurs++;
      rapport.details.push({ quoteId: qid, erreur: lu?.status ?? 0 });
      if (lu?.status === 401 || lu?.status === 403) break;          // jeton ou droit : inutile d'insister
      continue;
    }
    rapport.lus++;
    const s = interpreterStatutDevis(lu.data?.status);
    if (s.code === "accepte") rapport.acceptes++;
    if (s.code === "refuse") rapport.refuses++;
    const change = (p.progbat_devis_statut ?? null) !== s.valeur;
    if (change) rapport.changes++;
    await depot.majProjet(p.id, {
      progbat_devis_statut: s.valeur,
      progbat_devis_statut_le: str(lu.data?.statusDate) || null,
      progbat_devis_statut_lu_le: maintenant.toISOString(),
    });
  }
  return rapport;
}
