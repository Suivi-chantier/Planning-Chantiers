// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — pastilles et bloc « Bâtiment » de la page
// Opération (tâche 2 du projet docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// données arrivent en paramètre. Façade front : securitePastilles.js.
//
//   - pastilleFicheSecurite() : libellé + couleur de la pastille d'un chantier,
//     à partir de la ligne de la vue securite_fiches_etat (ou de son absence) ;
//   - bloc « Bâtiment » (table securite_operations) : libellés des valeurs,
//     « non renseigné » pour une valeur inconnue (jamais « non »), et contrôle
//     de la saisie avant enregistrement.
//
// Invariant « une impossibilité reste visible » : une lecture en erreur ou en
// cours ne donne jamais « à créer ». « À créer » veut dire : lecture réussie,
// et aucune fiche pour ce chantier.
//
// Rouge « justificatifs manquants » / « expiré » : depuis la tâche 4, le
// panneau fournit `justificatifs` calculé par securiteValidation.mjs
// (justificatifsPourPastille, même règle que la fiche). Tant que l'appelant ne
// le fournit pas (ou s'il est illisible), aucune pastille rouge n'est inventée.
// ─────────────────────────────────────────────────────────────────────────────
import { estChantierTermine } from "./chantierActif.mjs";
import { estChantierPerdu } from "./statutsChantier.mjs";

/** Nombre de points de la procédure v2. */
export const NB_POINTS_FICHE = 12;

/** Couleurs de la charte (mêmes teintes que le reste de la page Opération). */
export const COULEURS_PASTILLE = Object.freeze({
  gris:     "#9ca3af",
  orange:   "#f5a623",
  rouge:    "#e15a5a",
  vert:     "#22c55e",
  verrou:   "#5b6a8a",
  inconnu:  "#e15a5a", // affiché en pointillés : on ne sait pas, ce n'est pas un état
});

/**
 * Pastille d'un chantier.
 * @param {object}  p
 * @param {object}  p.chantier        ligne chantier (statut, …)
 * @param {object?} p.fiche           ligne de securite_fiches_etat, null = pas de fiche
 * @param {string}  p.lecture         "ok" | "chargement" | "erreur"
 * @param {object?} p.justificatifs   { manquants: n, expires: n } — tâches 3-4 ;
 *                                    absent = règle pas encore disponible
 * @returns {{ code, libelle, couleur, ton, detail }}
 *   ton : "plein" (état connu) ou "pointille" (inconnu / chargement)
 */
export function pastilleFicheSecurite({ chantier = null, fiche = null, lecture = "ok", justificatifs = null } = {}) {
  if (lecture === "chargement") {
    return { code: "chargement", libelle: "chargement…", couleur: COULEURS_PASTILLE.gris, ton: "pointille", detail: "" };
  }
  if (lecture !== "ok") {
    return { code: "illisible", libelle: "état illisible", couleur: COULEURS_PASTILLE.inconnu, ton: "pointille",
      detail: "L'état des fiches n'a pas pu être lu : on ne sait pas si ce chantier a une fiche." };
  }

  if (!fiche) {
    if (estChantierTermine(chantier)) {
      return { code: "sans_fiche_termine", libelle: "pas de fiche — chantier terminé", couleur: COULEURS_PASTILLE.gris, ton: "plein",
        detail: "Aucune fiche n'est créée pour un chantier déjà terminé." };
    }
    if (estChantierPerdu(chantier)) {
      return { code: "sans_fiche_perdu", libelle: "pas de fiche — affaire perdue", couleur: COULEURS_PASTILLE.gris, ton: "plein", detail: "" };
    }
    return { code: "a_creer", libelle: "à créer", couleur: COULEURS_PASTILLE.gris, ton: "plein", detail: "" };
  }

  const v = Number.isInteger(fiche.version) && fiche.version >= 1 ? fiche.version : null;
  const vTxt = v ? `v${v}` : "version inconnue";
  const n = Number.isFinite(Number(fiche.points_completes)) && fiche.points_completes !== null ? Number(fiche.points_completes) : null;
  const avancement = n === null ? "?" : String(n);

  // Une fiche verrouillée (chantier terminé) ne change plus : rien ne passe devant.
  if (fiche.statut === "verrouillee") {
    return { code: "verrouillee", libelle: `verrouillée ${vTxt}`, couleur: COULEURS_PASTILLE.verrou, ton: "plein",
      detail: "Chantier terminé : la fiche ne peut plus être modifiée." };
  }

  const expires = Number(justificatifs?.expires) || 0;
  const manquants = Number(justificatifs?.manquants) || 0;
  const statutsConnus = ["brouillon", "validee", "a_mettre_a_jour"];
  if (!statutsConnus.includes(fiche.statut)) {
    return { code: "statut_inconnu", libelle: `état inconnu (${fiche.statut ?? "vide"})`, couleur: COULEURS_PASTILLE.inconnu, ton: "pointille", detail: "" };
  }
  if (justificatifs && expires > 0) {
    return { code: "expire", libelle: "expiré", couleur: COULEURS_PASTILLE.rouge, ton: "plein",
      detail: `${expires} justificatif${expires > 1 ? "s" : ""} expiré${expires > 1 ? "s" : ""}.` };
  }
  if (justificatifs && manquants > 0 && fiche.statut !== "validee") {
    return { code: "justificatifs_manquants", libelle: "justificatifs manquants", couleur: COULEURS_PASTILLE.rouge, ton: "plein",
      detail: `${manquants} justificatif${manquants > 1 ? "s" : ""} requis manquant${manquants > 1 ? "s" : ""}.` };
  }
  if (fiche.statut === "validee") {
    return { code: "validee", libelle: `validée ${vTxt}`, couleur: COULEURS_PASTILLE.vert, ton: "plein", detail: "" };
  }
  if (fiche.statut === "a_mettre_a_jour") {
    return { code: "a_mettre_a_jour", libelle: `à mettre à jour — ${avancement}/${NB_POINTS_FICHE}`, couleur: COULEURS_PASTILLE.orange, ton: "plein",
      detail: `La ${vTxt} doit être revue puis validée de nouveau.` };
  }
  return { code: "brouillon", libelle: `brouillon — ${avancement}/${NB_POINTS_FICHE}`, couleur: COULEURS_PASTILLE.orange, ton: "plein", detail: "" };
}

// ─── Bloc « Bâtiment » (securite_operations) ────────────────────────────────

/** Valeurs du check reperage_amiante_statut en base, dans l'ordre d'affichage. */
export const REPERAGE_AMIANTE_STATUTS = Object.freeze([
  Object.freeze({ id: "a_completer",          label: "Non renseigné (à compléter)" }),
  Object.freeze({ id: "non_requis",           label: "Non requis" }),
  Object.freeze({ id: "a_demander",           label: "À demander" }),
  Object.freeze({ id: "demande",              label: "Demandé, pas encore reçu" }),
  Object.freeze({ id: "recu_sans_amiante",    label: "Reçu — sans amiante" }),
  Object.freeze({ id: "recu_amiante_present", label: "Reçu — amiante présent" }),
]);

export const NON_RENSEIGNE = "non renseigné";

/** Oui / non / non renseigné (null ou absent ≠ non). */
export function texteOuiNon(v) {
  if (v === true) return "oui";
  if (v === false) return "non";
  return NON_RENSEIGNE;
}

export function libelleReperageAmiante(id) {
  const s = REPERAGE_AMIANTE_STATUTS.find((x) => x.id === id);
  if (s) return s.label;
  return id ? `valeur inconnue (${id})` : NON_RENSEIGNE;
}

/** Étage : 0 = rez-de-chaussée, négatif = sous-sol, null = non renseigné. */
export function texteEtage(v) {
  if (v === null || v === undefined || v === "") return NON_RENSEIGNE;
  const n = Number(v);
  if (!Number.isInteger(n)) return NON_RENSEIGNE;
  if (n === 0) return "rez-de-chaussée";
  if (n < 0) return `sous-sol ${-n}`;
  return n === 1 ? "1er étage" : `${n}e étage`;
}

/**
 * « Avant 1997 » / « avant 1949 » tels que calculés par la base (colonnes
 * générées). Sans date de permis, la base renvoie null : non renseigné.
 */
export function texteAvantDate(valeurBase, datePermis) {
  if (!datePermis || (valeurBase !== true && valeurBase !== false)) return NON_RENSEIGNE;
  return valeurBase ? "oui" : "non";
}

/** Formulaire vide / pré-rempli à partir de la ligne en base (null = aucune ligne). */
export function formulaireBatiment(ligne) {
  const triEtat = (v) => (v === true ? "oui" : v === false ? "non" : "");
  return {
    date_permis_construire: ligne?.date_permis_construire || "",
    copropriete: triEtat(ligne?.copropriete),
    etage: ligne?.etage === null || ligne?.etage === undefined ? "" : String(ligne.etage),
    ascenseur_utilisable: triEtat(ligne?.ascenseur_utilisable),
    reperage_amiante_statut: ligne?.reperage_amiante_statut || "a_completer",
    notes: ligne?.notes || "",
  };
}

/**
 * Contrôle la saisie et prépare la ligne à enregistrer (upsert par operation_id).
 * Une case laissée vide est enregistrée vide (null), jamais « non ».
 * @returns {{ ok: true, ligne } | { ok: false, erreurs: string[] }}
 */
export function preparerEnregistrementBatiment(operationId, form) {
  const erreurs = [];
  if (!operationId || !String(operationId).trim()) erreurs.push("Opération inconnue.");
  const f = form || {};
  const triEtat = (v, nom) => {
    if (v === "oui") return true;
    if (v === "non") return false;
    if (v === "" || v === null || v === undefined) return null;
    erreurs.push(`${nom} : valeur inattendue.`);
    return null;
  };

  let date = null;
  const d = String(f.date_permis_construire || "").trim();
  if (d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    const ok = m && (() => {
      const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
    })();
    if (!ok) erreurs.push("Date du permis de construire invalide.");
    else if (+m[1] < 1800) erreurs.push("Date du permis de construire : année trop ancienne.");
    else date = d;
  }

  let etage = null;
  const e = String(f.etage ?? "").trim();
  if (e !== "") {
    const n = Number(e);
    if (!Number.isInteger(n) || n < -5 || n > 60) erreurs.push("Étage : nombre entier entre -5 et 60 (0 = rez-de-chaussée).");
    else etage = n;
  }

  const statut = f.reperage_amiante_statut || "a_completer";
  if (!REPERAGE_AMIANTE_STATUTS.some((s) => s.id === statut)) erreurs.push("Statut du repérage amiante inconnu.");

  const ligne = {
    operation_id: String(operationId || ""),
    date_permis_construire: date,
    copropriete: triEtat(f.copropriete, "Copropriété"),
    etage,
    ascenseur_utilisable: triEtat(f.ascenseur_utilisable, "Ascenseur utilisable"),
    reperage_amiante_statut: statut,
    notes: String(f.notes || "").trim() || null,
  };
  return erreurs.length ? { ok: false, erreurs } : { ok: true, ligne };
}
