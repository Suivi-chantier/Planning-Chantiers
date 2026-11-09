// ─────────────────────────────────────────────────────────────────────────────
// progbatNomPrenom — découpage du nom ProGBat d'un PARTICULIER en nom + prénom
// (demande de Loris du 07/11 : un client ProGBat choisi doit arriver complet,
// sans bandeau « prénom manquant »).
//
// ProGBat n'a pas de champ « prénom » pour un tiers : le nom d'un particulier
// est un seul texte (legalName), souvent « NOM Prénom ». Règle, sans rien
// deviner :
//   • les mots du nom sont classés : MAJUSCULES (« DUPONT », « D'ARTAGNAN »,
//     « LE-GALL ») ou Capitalisés (« Jean », « Jean-Pierre », « Élodie ») ;
//   • découpage SEULEMENT si le nom est fait d'un bloc en majuscules ET d'un
//     bloc capitalisé, l'un après l'autre (« DUPONT Jean » ou « Jean DUPONT ») :
//     bloc en majuscules = nom, l'autre = prénom ;
//   • tout autre cas est AMBIGU et le nom reste entier, prénom vide : tout en
//     majuscules (« DUPONT JEAN » : qui est le prénom ?), tout capitalisé,
//     couple (« et », « & »), civilité (« Mr », « Mme »…), mot en minuscules
//     (« de »), chiffres, un seul mot, blocs entremêlés.
//
// Module PUR : aucun import, aucun réseau, aucune horloge. Façade front :
// progbatNomPrenom.js. Copié dans les Edge Functions progbat-operations et
// progbat-devis-statut-cron (scripts/sync-progbat-edge-lib.mjs).
// ─────────────────────────────────────────────────────────────────────────────

const str = (v) => (v == null ? "" : String(v).trim());

/** Mots qui rendent le découpage ambigu (civilités, couples). Comparés sans point ni casse. */
const MOTS_AMBIGUS = new Set(["mr", "mme", "m", "mlle", "melle", "monsieur", "madame", "mademoiselle", "et", "&", "ou", "dr", "me", "mrs", "ms", "sci", "sarl", "sas", "eurl", "sa", "ass", "cpt", "indivision", "succession", "consorts", "famille", "epoux"]);

const lettres = (m) => m.replace(/[^\p{L}]/gu, "");

/** "maj" | "cap" | null (mot qui empêche le découpage). */
export function classerMot(mot) {
  const m = str(mot);
  if (!m) return null;
  const sansPoint = m.replace(/\./g, "").toLowerCase();
  if (MOTS_AMBIGUS.has(sansPoint)) return null;
  if (!/^[\p{L}][\p{L}'’\-]*$/u.test(m)) return null;               // chiffres, ponctuation
  const l = lettres(m);
  if (l.length < 2) return null;                                    // initiale seule
  if (l === l.toUpperCase() && l !== l.toLowerCase()) return "maj";
  // Capitalisé : chaque partie (séparée par - ou ') commence par une majuscule suivie de minuscules.
  const parties = m.split(/[-'’]/).filter(Boolean);
  if (parties.every((p) => /^\p{Lu}\p{Ll}+$/u.test(p))) return "cap";
  return null;
}

/**
 * Découpe « NOM Prénom » / « Prénom NOM ».
 * → { nom, prenom, decoupe: true } ou { nom: <texte entier>, prenom: "", decoupe: false, raison }
 */
export function decouperNomPrenom(texte) {
  const brut = str(texte).replace(/\s+/g, " ");
  const entier = (raison) => ({ nom: brut, prenom: "", decoupe: false, raison });
  if (!brut) return entier("vide");
  const mots = brut.split(" ");
  if (mots.length < 2) return entier("un seul mot");
  const classes = mots.map(classerMot);
  if (classes.some((c) => c == null)) return entier("civilité, couple ou mot non reconnu");
  // Nombre de changements de classe : exactement un (deux blocs).
  let changements = 0;
  for (let i = 1; i < classes.length; i++) if (classes[i] !== classes[i - 1]) changements++;
  if (changements === 0) return entier(classes[0] === "maj" ? "tout en majuscules" : "aucun mot en majuscules");
  if (changements > 1) return entier("blocs entremêlés");
  const maj = mots.filter((_, i) => classes[i] === "maj").join(" ");
  const cap = mots.filter((_, i) => classes[i] === "cap").join(" ");
  return { nom: maj, prenom: cap, decoupe: true };
}
