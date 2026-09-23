// Rapprochement LECTURE SEULE pour l'onglet « Avancement chantier » des États
// financiers.
//
// La grille de cet onglet reste 100 % manuelle : le comptable saisit lui-même
// l'avancement réel et le % facturé. Ce module ne fait qu'une chose : préparer,
// à côté de cette saisie, ce que l'application sait déjà du chantier une fois
// que la ligne a été reliée à un chantier (champ `rows[].chantier_id`).
//
// Deux sources, déjà remplies par ailleurs, jamais écrites ici :
//   1. chantier_snapshots_hebdo    → avancement constaté sur le terrain ;
//   2. chantier_factures_client    → situations de travaux venues de ProGBat.
//
// Aucun rapprochement par ressemblance de nom : une ligne sans `chantier_id`
// n'a pas de données liées, point. On n'invente ni n'extrapole jamais une
// valeur manquante — l'écran affiche un tiret.

/** Ce qu'affiche l'écran quand la donnée n'existe pas. */
export const SANS_DONNEE = "—";

/** Nombre exploitable, ou null. Les colonnes numeric de Supabase arrivent en texte. */
function nombreOuNull(valeur) {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : null;
}

/** Texte non vide, ou null. */
function texteOuNull(valeur) {
  if (valeur === null || valeur === undefined) return null;
  const t = String(valeur).trim();
  return t === "" ? null : t;
}

/**
 * Garde, pour chaque chantier, le seul enregistrement le plus récent.
 *
 * `rang` renvoie le critère de fraîcheur d'un enregistrement (un tableau
 * comparé élément par élément) ; à égalité parfaite, le premier rencontré
 * gagne — ce qui respecte l'ordre demandé au serveur.
 */
function dernierParChantier(enregistrements, rang) {
  const index = new Map();

  for (const enr of Array.isArray(enregistrements) ? enregistrements : []) {
    const chantierId = texteOuNull(enr?.chantier_id);
    if (!chantierId) continue;

    const precedent = index.get(chantierId);
    if (!precedent || comparerRangs(rang(enr), rang(precedent.source)) > 0) {
      index.set(chantierId, { source: enr });
    }
  }

  return index;
}

/** > 0 si `a` est plus récent que `b`. Les valeurs absentes passent en dernier. */
function comparerRangs(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const va = a[i] ?? "";
    const vb = b[i] ?? "";
    if (va === vb) continue;
    return va > vb ? 1 : -1;
  }
  return 0;
}

/**
 * Dernier snapshot hebdomadaire par chantier.
 *
 * `avancement` est stocké de 0 à 100 dans chantier_snapshots_hebdo : on le
 * rend tel quel, en pourcentage, sans le convertir.
 */
export function indexerSnapshots(lignes) {
  const derniers = dernierParChantier(lignes, (l) => [l?.date_snapshot ?? "", l?.week_id ?? ""]);
  const index = new Map();

  for (const [chantierId, { source }] of derniers) {
    const pct = nombreOuNull(source?.avancement);
    if (pct === null) continue; // pas d'avancement lisible → rien à montrer

    index.set(chantierId, {
      pct,
      date: texteOuNull(source?.date_snapshot),
      weekId: texteOuNull(source?.week_id),
      venduHt: nombreOuNull(source?.vendu_ht),
    });
  }

  return index;
}

/**
 * Dernière situation de travaux ProGBat par chantier.
 *
 * `progbat_achievement` est un CUMUL FACTURÉ EN EUROS, pas un pourcentage.
 * Le pourcentage est déduit du montant du marché, et reste null si ce montant
 * est absent ou nul — on ne divise jamais dans le vide.
 */
export function indexerSituations(lignes) {
  const derniers = dernierParChantier(lignes, (l) => [
    l?.date_facture ?? "",
    nombreOuNull(l?.progbat_situation_number) ?? -1,
  ]);
  const index = new Map();

  for (const [chantierId, { source }] of derniers) {
    const cumulEuros = nombreOuNull(source?.progbat_achievement);
    if (cumulEuros === null) continue;

    const marcheEuros = nombreOuNull(source?.progbat_deal_net_total);
    const pct = marcheEuros !== null && marcheEuros !== 0
      ? (cumulEuros / marcheEuros) * 100
      : null;

    index.set(chantierId, {
      cumulEuros,
      marcheEuros,
      pct,
      numeroSituation: nombreOuNull(source?.progbat_situation_number),
      date: texteOuNull(source?.date_facture),
    });
  }

  return index;
}

/**
 * Ce qu'on affiche en face d'une ligne de la grille.
 * Une ligne non reliée, ou un chantier sans donnée, renvoie { terrain: null,
 * facture: null } : l'écran montrera deux tirets.
 */
export function donneesLieesLigne(chantierId, indexSnapshots, indexSituations) {
  const id = texteOuNull(chantierId);
  if (!id) return { terrain: null, facture: null };

  return {
    terrain: indexSnapshots?.get(id) ?? null,
    facture: indexSituations?.get(id) ?? null,
  };
}

/** Infobulle de la colonne « Terrain » : d'où vient le chiffre. */
export function infobulleTerrain(terrain) {
  if (!terrain) return "Aucun relevé de terrain pour ce chantier";
  const morceaux = ["Dernier relevé du terrain"];
  if (terrain.date) morceaux.push(`au ${formaterDateFr(terrain.date)}`);
  if (terrain.weekId) morceaux.push(`(semaine ${terrain.weekId})`);
  return morceaux.join(" ");
}

/** Infobulle de la colonne « Facturé ProGBat » : numéro de situation et date. */
export function infobulleFacture(facture) {
  if (!facture) return "Aucune situation de travaux ProGBat pour ce chantier";
  const morceaux = [];
  if (facture.numeroSituation !== null) morceaux.push(`Situation n° ${facture.numeroSituation}`);
  else morceaux.push("Dernière situation ProGBat");
  if (facture.date) morceaux.push(`du ${formaterDateFr(facture.date)}`);
  if (facture.pct === null) morceaux.push("— montant du marché absent, pourcentage non calculable");
  return morceaux.join(" ");
}

/** "2026-09-18" → "18/09/2026". Rend la chaîne telle quelle si le format surprend. */
export function formaterDateFr(iso) {
  const t = texteOuNull(iso);
  if (!t) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}
