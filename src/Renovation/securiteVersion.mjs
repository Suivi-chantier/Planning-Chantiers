// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — version figée et empreinte (tâche 4 du projet
// docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge (l'heure arrive en
// paramètre), aucun effet de bord. Façade front : securiteVersion.js.
// Le hachage sha256 lui-même est fait dans la couche données (Web Crypto) :
// ici, seulement ce qui doit être identique partout et testable.
//
//   - serialisationCanonique() : texte unique pour un même contenu (clés
//     triées, aucun espace) : deux lectures du même contenu donnent toujours la
//     même empreinte, quel que soit l'ordre des clés renvoyé par la base ;
//   - contenuVersion() : le contenu complet figé dans securite_fiches_versions
//     ET haché pour l'empreinte que portent les signatures ;
//   - entrées du journal du chantier (chantiers_statut_journal, événement
//     « fiche_securite ») et motif de mise à jour relu dans ce journal ;
//   - préparation de « Mettre à jour » (version + 1, retour en brouillon) ;
//   - chemins de stockage (décision de la tâche 1 : signatures dans
//     securite-preuves sous signatures/{fiche_id}/, justificatifs non
//     confidentiels dans chantier-documents sous securite/chantiers/{id}/).
//
// FLUX CHOISI (détail au journal du fichier projet) :
//   1. la fiche est complète et enregistrée ;
//   2. on calcule l'empreinte du contenu tel qu'il serait figé (version N) ;
//   3. « établie par » et « chef d'équipe » signent sur cette empreinte ;
//   4. « Valider » relit tout, recalcule l'empreinte, exige les 2 signatures
//      avec CETTE empreinte, crée la ligne securite_fiches_versions (version
//      N, même empreinte), puis passe la fiche en « validée ».
// Toute modification après une signature change l'empreinte : la signature
// reste en base (rien ne s'efface) mais ne compte plus, il faut re-signer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identifiant de la forme du contenu figé (à changer si la forme change).
 * v2 (tâche 9) : ajout de `justificatifs_entreprise` (justificatifs
 * permanents de l'espace entreprise rattachés à la fiche).
 */
export const FORMAT_CONTENU_VERSION = "fiche-securite-v2";

/**
 * Formes de contenu figé lisibles (PDF, accueil de l'équipe). Une version
 * figée avant la tâche 9 garde sa forme v1 (rien n'est réécrit) : elle n'a
 * simplement aucun justificatif de l'espace entreprise.
 */
export const FORMATS_CONTENU_LISIBLES = Object.freeze(["fiche-securite-v1", "fiche-securite-v2"]);

/** Événement écrit dans chantiers_statut_journal. */
export const EVENEMENT_JOURNAL = "fiche_securite";

/** Longueur minimale du motif de « Mettre à jour ». */
export const MOTIF_MIN = 5;

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Sérialisation JSON canonique : clés d'objet triées (ordre des codes
 * Unicode), ordre des tableaux conservé, clés de valeur `undefined` omises,
 * aucun espace. Refuse ce qui n'a pas de forme JSON stable (nombre infini,
 * fonction, date, etc.) : mieux vaut une erreur qu'une empreinte fausse.
 */
export function serialisationCanonique(valeur) {
  if (valeur === null) return "null";
  const t = typeof valeur;
  if (t === "string" || t === "boolean") return JSON.stringify(valeur);
  if (t === "number") {
    if (!Number.isFinite(valeur)) throw new Error("Nombre non représentable dans le contenu figé.");
    return JSON.stringify(valeur);
  }
  if (Array.isArray(valeur)) {
    return `[${valeur.map((v) => (v === undefined ? "null" : serialisationCanonique(v))).join(",")}]`;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(valeur);
    if (proto !== Object.prototype && proto !== null) throw new Error("Objet non sérialisable dans le contenu figé.");
    const cles = Object.keys(valeur).filter((k) => valeur[k] !== undefined).sort();
    return `{${cles.map((k) => `${JSON.stringify(k)}:${serialisationCanonique(valeur[k])}`).join(",")}}`;
  }
  throw new Error(`Valeur de type ${t} non sérialisable dans le contenu figé.`);
}

const nul = (v) => (v === undefined ? null : v);

/** Champs du bâtiment repris dans la version figée. */
export const CHAMPS_BATIMENT_VERSION = Object.freeze([
  "date_permis_construire", "avant_1997", "avant_1949", "copropriete", "etage",
  "ascenseur_utilisable", "reperage_amiante_statut", "notes",
]);

/** Champs d'un justificatif repris dans la version figée. */
export const CHAMPS_JUSTIFICATIF_VERSION = Object.freeze([
  "id", "point", "type_code", "fichier_nom", "fichier_path", "date_document", "expire_le", "personne", "entreprise_nom",
]);

/** Champs d'un justificatif de l'espace entreprise repris dans la version figée (+ point, origine). */
export const CHAMPS_JUSTIFICATIF_ENTREPRISE_VERSION = Object.freeze([
  "id", "type_code", "fichier_nom", "fichier_path", "date_document", "expire_le", "personne", "entreprise_nom",
]);

/**
 * Contenu complet figé d'une version. Ne contient rien qui change sans que la
 * fiche change (pas de updated_at, pas de date de validation : elle est dans
 * la ligne de version, cree_le) — sinon l'empreinte signée ne pourrait jamais
 * être retrouvée à la validation.
 *
 * @param {object} p
 * @param {object} p.fiche          ligne securite_fiches (id, chantier_id, version, 4 colonnes jsonb)
 * @param {object} p.chantier       { id, nom }
 * @param {object} p.operation      { id, nom, adresse }
 * @param {string?} p.clientLibelle libellé du client (null = aucun client renseigné)
 * @param {object?} p.batiment      ligne securite_operations (null = jamais saisie)
 * @param {object[]} p.justificatifs justificatifs ACTIFS du chantier
 * @param {object[]} p.rattachesEntreprise justificatifs permanents rattachés,
 *                   tels que renvoyés par justificatifsEntrepriseRattaches()
 *                   (securiteValidation.mjs) : [{ numero, justificatif }]
 * @param {string?} p.motif         motif de la mise à jour (null pour la v1)
 */
export function contenuVersion({ fiche, chantier, operation, clientLibelle = null, batiment = null, justificatifs = [], rattachesEntreprise = [], motif = null }) {
  if (!fiche || !fiche.id) throw new Error("Fiche absente.");
  if (!Number.isInteger(fiche.version) || fiche.version < 1) throw new Error("Version de fiche inconnue.");
  if (!Array.isArray(justificatifs)) throw new Error("Liste des justificatifs illisible.");
  if (!Array.isArray(rattachesEntreprise)) throw new Error("Justificatifs de l'espace entreprise illisibles.");
  const entreprise = rattachesEntreprise
    .filter((r) => r && r.justificatif && r.justificatif.confidentiel !== true)
    .map((r) => ({
      point: Number(r.numero),
      origine: "entreprise",
      ...Object.fromEntries(CHAMPS_JUSTIFICATIF_ENTREPRISE_VERSION.map((k) => [k, nul(r.justificatif[k])])),
    }))
    .sort((a, b) => a.point - b.point || String(a.id).localeCompare(String(b.id)));
  const bat = batiment ? Object.fromEntries(CHAMPS_BATIMENT_VERSION.map((k) => [k, nul(batiment[k])])) : null;
  const justifs = justificatifs
    .filter((j) => j && !j.archive_le)
    .map((j) => Object.fromEntries(CHAMPS_JUSTIFICATIF_VERSION.map((k) => [k, nul(j[k])])))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    format: FORMAT_CONTENU_VERSION,
    fiche_id: String(fiche.id),
    version: fiche.version,
    motif_changement: motif || null,
    chantier: { id: String(chantier?.id ?? fiche.chantier_id ?? ""), nom: nul(chantier?.nom) },
    operation: { id: nul(operation?.id), nom: nul(operation?.nom), adresse: operation?.adresse || null },
    client: clientLibelle || null,
    batiment: bat,
    intervenants: Array.isArray(fiche.intervenants) ? fiche.intervenants : [],
    donnees_base: estObjet(fiche.donnees_base) ? fiche.donnees_base : {},
    reponses: estObjet(fiche.reponses) ? fiche.reponses : {},
    synthese_risques: Array.isArray(fiche.synthese_risques) ? fiche.synthese_risques : [],
    justificatifs: justifs,
    justificatifs_entreprise: entreprise,
  };
}

/** Empreinte abrégée pour l'affichage (le texte complet reste en base). */
export function empreinteCourte(h) {
  return typeof h === "string" && h.length >= 12 ? h.slice(0, 12) : (h || "—");
}

/** Une empreinte sha256 bien formée (64 caractères hexadécimaux minuscules). */
export function estEmpreinte(h) {
  return typeof h === "string" && /^[0-9a-f]{64}$/.test(h);
}

// ─── Journal du chantier ─────────────────────────────────────────────────────

const PREFIXE_OUVERTURE = "Ouverture de la v";

/** Entrée de journal à la validation d'une version. */
export function entreeJournalValidation({ chantierId, version, auteur = null, empreinte = "" }) {
  return {
    chantier_id: String(chantierId),
    evenement: EVENEMENT_JOURNAL,
    ancien_statut: "brouillon",
    nouveau_statut: "validee",
    motif: null,
    detail: `Fiche sécurité v${version} validée (empreinte ${empreinteCourte(empreinte)}…)`,
    auteur: auteur || null,
  };
}

/** Entrée de journal à l'ouverture d'une nouvelle version (« Mettre à jour »). */
export function entreeJournalMiseAJour({ chantierId, versionAvant, statutAvant = "validee", auteur = null, motif }) {
  return {
    chantier_id: String(chantierId),
    evenement: EVENEMENT_JOURNAL,
    ancien_statut: statutAvant,
    nouveau_statut: "brouillon",
    motif: String(motif || "").trim(),
    detail: `${PREFIXE_OUVERTURE}${versionAvant + 1} de la fiche sécurité (mise à jour de la v${versionAvant})`,
    auteur: auteur || null,
  };
}

/**
 * Motif de la version `version`, relu dans le journal du chantier : dernière
 * entrée « Ouverture de la v{version} ». v1 → null (pas de mise à jour).
 * @returns {{ motif: string|null, trouve: boolean }}
 */
export function motifDepuisJournal(lignes, version) {
  if (version === 1) return { motif: null, trouve: true };
  const candidates = (Array.isArray(lignes) ? lignes : [])
    .filter((l) => l && l.evenement === EVENEMENT_JOURNAL && l.nouveau_statut === "brouillon"
      && typeof l.detail === "string" && l.detail.startsWith(`${PREFIXE_OUVERTURE}${version} `))
    .sort((a, b) => String(b.le || "").localeCompare(String(a.le || "")));
  if (!candidates.length || !String(candidates[0].motif || "").trim()) return { motif: null, trouve: false };
  return { motif: String(candidates[0].motif).trim(), trouve: true };
}

/**
 * « Mettre à jour » : contrôle et changement à écrire sur la fiche.
 * Permis depuis une fiche validée ou « à mettre à jour » ; depuis un brouillon
 * seulement quand la version en cours a déjà été figée (validation
 * interrompue entre la version et la fiche, avec un contenu changé depuis).
 * @returns {{ ok: true, patch, versionAvant } | { ok: false, erreur }}
 */
export function preparerMiseAJour(fiche, motif, { versionDejaFigee = false } = {}) {
  if (!fiche) return { ok: false, erreur: "Fiche absente." };
  if (fiche.statut === "verrouillee") return { ok: false, erreur: "Fiche verrouillée (chantier terminé) : plus aucune modification possible." };
  const permis = ["validee", "a_mettre_a_jour"].includes(fiche.statut) || (fiche.statut === "brouillon" && versionDejaFigee);
  if (!permis) return { ok: false, erreur: "Seule une fiche validée (ou à mettre à jour) peut passer à une nouvelle version." };
  if (!Number.isInteger(fiche.version) || fiche.version < 1) return { ok: false, erreur: "Version de fiche inconnue." };
  const m = String(motif || "").trim();
  if (m.length < MOTIF_MIN) return { ok: false, erreur: `Motif obligatoire (${MOTIF_MIN} caractères au moins).` };
  return {
    ok: true,
    versionAvant: fiche.version,
    patch: { version: fiche.version + 1, statut: "brouillon", validee_le: null, validee_par: null },
  };
}

// ─── Chemins de stockage ─────────────────────────────────────────────────────

/** Bucket des images de signature (rien ne s'y efface ni ne s'y remplace). */
export const BUCKET_PREUVES = "securite-preuves";

/** Dossier des justificatifs de chantier dans chantier-documents. */
export function dossierJustificatifs(chantierId, numeroPoint) {
  const id = String(chantierId || "").trim();
  if (!id || /[/\\]/.test(id)) throw new Error("Chantier inconnu.");
  const n = Number(numeroPoint);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error("Point inconnu.");
  return `securite/chantiers/${id}/p${n}`;
}

/** Chemin (nouveau à chaque fois) d'une image de signature. */
export function cheminSignature({ ficheId, version, type, horodatage, alea }) {
  const f = String(ficheId || "");
  if (!/^[0-9a-f-]{36}$/i.test(f)) throw new Error("Fiche inconnue.");
  if (!["etablie_par", "chef_equipe", "accueil"].includes(type)) throw new Error("Type de signature inconnu.");
  const a = String(alea || "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  return `signatures/${f}/v${version}-${type}-${String(horodatage).replace(/[^0-9]/g, "")}-${a || "x"}.png`;
}
