// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité d'un chantier — logique de l'écran de la fiche
// (tâche 3 du projet docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge (l'heure arrive en
// paramètre), aucun effet de bord. Façade front : securiteFiche.js.
//
//   - compterPointsCompletes() : LE « n/12 », même définition que la vue
//     securite_fiches_etat (invariant « même chiffre = même calcul ») ;
//   - validerStructureFiche() : contrôle de la forme des colonnes jsonb lues
//     en base ; une forme inattendue rend la fiche non modifiable (sinon un
//     enregistrement écraserait des données qu'on ne sait pas lire) ;
//   - formulaireFiche() / contenuAEnregistrer() : passage ligne en base ⇄
//     formulaire, normalisation des réponses (rien d'inconnu n'est perdu) ;
//   - modifierPoint() : changement d'un point 4 à 12, daté et signé.
//
// Définitions des points : securite/points.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import {
  POINTS_FICHE, CLES_REPONSES, STATUTS_POINT, STATUTS_POINT_COMPLETE, pointParCle,
} from "./securite/points.mjs";
import { pastilleFicheSecurite, NB_POINTS_FICHE } from "./securitePastilles.mjs";

export { NB_POINTS_FICHE };

/** Statut de fiche qui permet la modification. Tout autre statut = lecture seule. */
export const STATUT_FICHE_MODIFIABLE = "brouillon";

/** Nombre de lignes de la synthèse des risques (point 3) : « 2 ou 3 lignes ». */
export const NB_LIGNES_SYNTHESE = 3;

/** Champs du point 2 saisis dans la fiche (le bâtiment vient de securite_operations). */
export const CHAMPS_DONNEES_BASE = Object.freeze([
  "lots", "date_debut", "date_fin", "date_depose_sanitaires", "effectif_max", "site_occupe", "acces", "observations",
]);

/** Champs d'une entreprise du point 1. */
export const CHAMPS_ENTREPRISE = Object.freeze(["nom", "activite", "contact", "telephone"]);

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const texte = (v) => (v === null || v === undefined ? "" : String(v));
const nettoye = (v) => texte(v).trim();

// ─── Le « n/12 » ─────────────────────────────────────────────────────────────

/**
 * Nombre de points complétés, calculé EXACTEMENT comme la vue
 * securite_fiches_etat.points_completes :
 *   (nombre d'entrées de `reponses` dont statut ∈ {concerne, non_concerne})
 *   + 1 si donnees_base ≠ {}  + 1 si intervenants ≠ []  + 1 si synthese_risques ≠ [].
 * Toute clé de `reponses` compte (la vue ne filtre pas p4…p12) ; c'est pourquoi
 * contenuAEnregistrer() n'écrit que p4…p12 et des colonnes vidées de leurs
 * champs vides (une case vide ne doit pas faire « compléter » le point 2).
 *
 * @param {object} f { donnees_base, intervenants, reponses, synthese_risques }
 * @returns {number|null} null = incalculable (colonne absente, ou `reponses`
 *   n'est pas un objet : la vue elle-même échouerait). Jamais 0 par défaut.
 */
export function compterPointsCompletes(f) {
  if (!f) return null;
  const { donnees_base: db, intervenants: it, reponses: rep, synthese_risques: sy } = f;
  if (db === undefined || it === undefined || rep === undefined || sy === undefined) return null;
  if (db === null || it === null || rep === null || sy === null) return null;
  if (!estObjet(rep)) return null; // jsonb_each() refuse un non-objet
  let n = 0;
  for (const v of Object.values(rep)) {
    if (estObjet(v) && typeof v.statut === "string" && STATUTS_POINT_COMPLETE.includes(v.statut)) n++;
  }
  const estObjetVide = (x) => estObjet(x) && Object.keys(x).length === 0;
  const estTableauVide = (x) => Array.isArray(x) && x.length === 0;
  if (!estObjetVide(db)) n++;
  if (!estTableauVide(it)) n++;
  if (!estTableauVide(sy)) n++;
  return n;
}

/**
 * État point par point (1 à 12), pour le bandeau. Même règle que le total :
 * 1 = intervenants non vide, 2 = données de base non vides, 3 = synthèse non
 * vide, 4…12 = statut concerné ou non concerné.
 */
export function etatDesPoints(f) {
  const rep = estObjet(f?.reponses) ? f.reponses : {};
  return POINTS_FICHE.map((p) => {
    let complete;
    if (p.section === "intervenants") complete = Array.isArray(f?.intervenants) && f.intervenants.length > 0;
    else if (p.section === "donnees_base") complete = estObjet(f?.donnees_base) && Object.keys(f.donnees_base).length > 0;
    else if (p.section === "synthese") complete = Array.isArray(f?.synthese_risques) && f.synthese_risques.length > 0;
    else complete = estObjet(rep[p.cle]) && STATUTS_POINT_COMPLETE.includes(rep[p.cle].statut);
    return { numero: p.numero, cle: p.cle, titre: p.titre, complete };
  });
}

// ─── Structure des colonnes jsonb ────────────────────────────────────────────

/**
 * Contrôle la forme d'une ligne securite_fiches.
 * @returns {{ bloquantes: string[], avertissements: string[] }}
 *   bloquantes : la fiche ne peut pas être modifiée sans risque de perte ;
 *   avertissements : affichés, la fiche reste modifiable (rien n'est perdu).
 */
export function validerStructureFiche(ligne) {
  const bloquantes = [];
  const avertissements = [];
  if (!ligne) return { bloquantes: ["Fiche absente."], avertissements };

  if (!estObjet(ligne.donnees_base)) bloquantes.push("Données de base (point 2) : forme inattendue.");
  if (!Array.isArray(ligne.intervenants)) bloquantes.push("Intervenants (point 1) : forme inattendue.");
  if (!Array.isArray(ligne.synthese_risques)) bloquantes.push("Synthèse des risques (point 3) : forme inattendue.");
  if (!estObjet(ligne.reponses)) {
    bloquantes.push("Réponses des points 4 à 12 : forme inattendue.");
  } else {
    const statutsConnus = STATUTS_POINT.map((s) => s.id);
    for (const [cle, v] of Object.entries(ligne.reponses)) {
      const p = CLES_REPONSES.includes(cle) ? pointParCle(cle) : null;
      if (!p) { avertissements.push(`Réponse « ${cle} » inattendue : conservée telle quelle, non affichée.`); continue; }
      if (!estObjet(v)) { bloquantes.push(`Point ${p.numero} : réponse de forme inattendue.`); continue; }
      if (v.statut !== undefined && !statutsConnus.includes(v.statut)) bloquantes.push(`Point ${p.numero} : statut inconnu (${texte(v.statut)}).`);
      if (v.cases !== undefined && !estObjet(v.cases)) bloquantes.push(`Point ${p.numero} : cases de forme inattendue.`);
      if (v.mesures !== undefined && v.mesures !== null && typeof v.mesures !== "string") bloquantes.push(`Point ${p.numero} : mesures de forme inattendue.`);
      if (estObjet(v.cases)) {
        const connues = p.cases.map((x) => x.code);
        const inconnues = Object.keys(v.cases).filter((k) => !connues.includes(k));
        if (inconnues.length) avertissements.push(`Point ${p.numero} : case${inconnues.length > 1 ? "s" : ""} qui n'existe${inconnues.length > 1 ? "nt" : ""} plus (${inconnues.join(", ")}) : réponse conservée, non affichée.`);
      }
    }
  }
  if (Array.isArray(ligne.intervenants)) {
    ligne.intervenants.forEach((e, i) => {
      if (!estObjet(e)) bloquantes.push(`Intervenant n° ${i + 1} : forme inattendue.`);
      else if (e.type === "entreprise" && !nettoye(e.nom)) avertissements.push(`Une entreprise du point 1 n'a pas de nom.`);
      else if (e.type !== "entreprise" && e.type !== "responsable") avertissements.push(`Intervenant n° ${i + 1} de type inconnu : conservé, non affiché.`);
    });
  }
  if (Array.isArray(ligne.synthese_risques) && ligne.synthese_risques.length > NB_LIGNES_SYNTHESE) {
    avertissements.push(`Synthèse des risques : ${ligne.synthese_risques.length} lignes enregistrées (${NB_LIGNES_SYNTHESE} attendues au plus).`);
  }
  if (estObjet(ligne.donnees_base) && ligne.donnees_base.lots !== undefined && !Array.isArray(ligne.donnees_base.lots)) {
    bloquantes.push("Données de base : liste des lots de forme inattendue.");
  }
  return { bloquantes, avertissements };
}

/** La fiche peut-elle être modifiée à l'écran ? (statut brouillon et forme connue) */
export function modeFiche(ligne) {
  if (!ligne) return { modifiable: false, raison: "Fiche absente." };
  const { bloquantes } = validerStructureFiche(ligne);
  if (bloquantes.length) {
    return { modifiable: false, raison: "Le contenu enregistré a une forme inattendue : la fiche est affichée en lecture seule pour ne rien écraser." };
  }
  if (ligne.statut !== STATUT_FICHE_MODIFIABLE) {
    const raisons = {
      validee: "Fiche validée : lecture seule.",
      a_mettre_a_jour: "Fiche à mettre à jour : lecture seule tant qu'une nouvelle version n'est pas ouverte.",
      verrouillee: "Chantier terminé : fiche verrouillée, plus aucune modification possible.",
    };
    return { modifiable: false, raison: raisons[ligne.statut] || `Statut de fiche inconnu (${texte(ligne.statut) || "vide"}) : lecture seule.` };
  }
  return { modifiable: true, raison: "" };
}

/**
 * Bouton « Créer la fiche » : seulement quand la pastille dit « à créer »
 * (lecture réussie, aucune fiche, chantier ni terminé ni perdu).
 */
export function peutCreerFiche({ chantier = null, fiche = null, lecture = "ok" } = {}) {
  return pastilleFicheSecurite({ chantier, fiche, lecture }).code === "a_creer";
}

// ─── Formulaire ⇄ base ───────────────────────────────────────────────────────

/**
 * Formulaire de l'écran à partir de la ligne en base. Les éléments inconnus
 * (type d'intervenant, clé de réponse, champ du point 2) sont mis de côté et
 * réécrits tels quels : rien n'est perdu à l'enregistrement.
 * @param {object} ligne securite_fiches
 * @param {() => string} [nouvelId] fabrique d'identifiants pour les lignes
 *   d'entreprise sans id (fourni par l'écran ; le module n'invente rien).
 */
export function formulaireFiche(ligne, nouvelId = null) {
  const it = Array.isArray(ligne?.intervenants) ? ligne.intervenants : [];
  const resp = it.find((e) => estObjet(e) && e.type === "responsable") || null;
  const entreprises = [];
  const intervenantsAutres = [];
  it.forEach((e, i) => {
    if (estObjet(e) && e.type === "entreprise") {
      entreprises.push({
        id: texte(e.id) || (nouvelId ? nouvelId() : `e${i + 1}`),
        ...Object.fromEntries(CHAMPS_ENTREPRISE.map((k) => [k, texte(e[k])])),
      });
    } else if (e !== resp) {
      intervenantsAutres.push(e);
    }
  });

  const db = estObjet(ligne?.donnees_base) ? ligne.donnees_base : {};
  const donneesAutres = {};
  for (const [k, v] of Object.entries(db)) if (!CHAMPS_DONNEES_BASE.includes(k)) donneesAutres[k] = v;

  const syn = Array.isArray(ligne?.synthese_risques) ? ligne.synthese_risques : [];
  return {
    responsable: { nom: texte(resp?.nom), telephone: texte(resp?.telephone) },
    entreprises,
    intervenantsAutres,
    donnees: {
      lots: Array.isArray(db.lots) ? db.lots.map(texte).filter(Boolean) : [],
      date_debut: texte(db.date_debut),
      date_fin: texte(db.date_fin),
      date_depose_sanitaires: texte(db.date_depose_sanitaires),
      effectif_max: db.effectif_max === undefined || db.effectif_max === null ? "" : texte(db.effectif_max),
      site_occupe: db.site_occupe === true ? "oui" : db.site_occupe === false ? "non" : "",
      acces: texte(db.acces),
      observations: texte(db.observations),
    },
    donneesAutres,
    reponses: estObjet(ligne?.reponses) ? ligne.reponses : {},
    synthese: [...syn],
  };
}

function dateValide(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

/** Réponse d'un point normalisée ; null = rien à enregistrer pour ce point. */
export function normaliserReponse(v) {
  if (!estObjet(v)) return null;
  const out = {};
  const statut = typeof v.statut === "string" ? v.statut : "a_completer";
  const cases = {};
  if (estObjet(v.cases)) for (const [k, b] of Object.entries(v.cases)) if (b === true) cases[k] = true;
  const mesures = nettoye(v.mesures);
  const aPropo = v.statut_propose !== undefined && v.statut_propose !== null;
  if (statut === "a_completer" && !Object.keys(cases).length && !mesures && !aPropo) return null;
  out.statut = statut;
  if (aPropo) out.statut_propose = v.statut_propose;
  if (v.raison_proposition !== undefined && v.raison_proposition !== null) out.raison_proposition = v.raison_proposition;
  if (Object.keys(cases).length) out.cases = cases;
  if (mesures) out.mesures = mesures;
  if (v.maj_par !== undefined && v.maj_par !== null) out.maj_par = v.maj_par;
  if (v.maj_le !== undefined && v.maj_le !== null) out.maj_le = v.maj_le;
  return out;
}

/**
 * Contenu à écrire dans securite_fiches à partir du formulaire.
 * Les champs vides ne sont pas écrits : une fiche vide reste {} / [] en base,
 * et le « n/12 » de la vue ne compte que ce qui est réellement rempli.
 * @returns {{ ok: true, contenu, avertissements } | { ok: false, erreurs, avertissements }}
 */
export function contenuAEnregistrer(form) {
  const erreurs = [];
  const avertissements = [];
  const f = form || {};

  // Point 1
  const intervenants = [];
  const rn = nettoye(f.responsable?.nom), rt = nettoye(f.responsable?.telephone);
  if (rn || rt) intervenants.push({ type: "responsable", nom: rn, ...(rt ? { telephone: rt } : {}) });
  (Array.isArray(f.entreprises) ? f.entreprises : []).forEach((e) => {
    const vals = Object.fromEntries(CHAMPS_ENTREPRISE.map((k) => [k, nettoye(e?.[k])]));
    if (!CHAMPS_ENTREPRISE.some((k) => vals[k])) return; // ligne vide : non écrite
    const ligne = { type: "entreprise", ...(e?.id ? { id: String(e.id) } : {}) };
    CHAMPS_ENTREPRISE.forEach((k) => { if (vals[k]) ligne[k] = vals[k]; });
    intervenants.push(ligne);
    if (!vals.nom) avertissements.push("Une entreprise du point 1 n'a pas de nom.");
  });
  (Array.isArray(f.intervenantsAutres) ? f.intervenantsAutres : []).forEach((e) => intervenants.push(e));

  // Point 2
  const d = f.donnees || {};
  const donnees_base = { ...(f.donneesAutres || {}) };
  const lots = [...new Set((Array.isArray(d.lots) ? d.lots : []).map(nettoye).filter(Boolean))];
  if (lots.length) donnees_base.lots = lots;
  const libellesDates = { date_debut: "Date de début", date_fin: "Date de fin", date_depose_sanitaires: "Date de dépose des sanitaires" };
  for (const k of Object.keys(libellesDates)) {
    const v = nettoye(d[k]);
    if (!v) continue;
    if (!dateValide(v)) erreurs.push(`${libellesDates[k]} invalide.`);
    else donnees_base[k] = v;
  }
  if (donnees_base.date_debut && donnees_base.date_fin && donnees_base.date_fin < donnees_base.date_debut) {
    avertissements.push("La date de fin est avant la date de début.");
  }
  const eff = nettoye(d.effectif_max);
  if (eff) {
    const n = Number(eff);
    if (!Number.isInteger(n) || n < 1 || n > 500) erreurs.push("Effectif maximum : nombre entier de personnes (1 à 500).");
    else donnees_base.effectif_max = n;
  }
  if (d.site_occupe === "oui") donnees_base.site_occupe = true;
  else if (d.site_occupe === "non") donnees_base.site_occupe = false;
  else if (d.site_occupe && d.site_occupe !== "") erreurs.push("Site occupé : valeur inattendue.");
  for (const k of ["acces", "observations"]) { const v = nettoye(d[k]); if (v) donnees_base[k] = v; }

  // Points 4 à 12 (+ clés inconnues conservées telles quelles)
  const reponses = {};
  const rep = estObjet(f.reponses) ? f.reponses : {};
  for (const [cle, v] of Object.entries(rep)) {
    if (!CLES_REPONSES.includes(cle)) { reponses[cle] = v; continue; }
    const r = normaliserReponse(v);
    if (r) reponses[cle] = r;
  }

  // Point 3
  const synthese_risques = [];
  (Array.isArray(f.synthese) ? f.synthese : []).forEach((l) => {
    if (typeof l === "string") { const t = l.trim(); if (t) synthese_risques.push(t); }
    else if (l !== null && l !== undefined) synthese_risques.push(l); // forme future : conservée
  });

  if (erreurs.length) return { ok: false, erreurs, avertissements };
  return { ok: true, contenu: { intervenants, donnees_base, reponses, synthese_risques }, avertissements };
}

/**
 * Modifie un point 4 à 12 dans le formulaire (nouvel objet, l'ancien est
 * inchangé). `maintenant` (ISO) et `auteur` viennent de l'écran.
 * @param {object} changement { statut?, case?: { code, coche }, mesures? }
 */
export function modifierPoint(form, cle, changement, { auteur = null, maintenant = null } = {}) {
  if (!CLES_REPONSES.includes(cle)) throw new Error(`Point inconnu : ${cle}`);
  const avant = estObjet(form?.reponses?.[cle]) ? form.reponses[cle] : {};
  const apres = { ...avant };
  if (changement?.statut !== undefined) {
    if (!STATUTS_POINT.some((s) => s.id === changement.statut)) throw new Error(`Statut inconnu : ${changement.statut}`);
    apres.statut = changement.statut;
  }
  if (changement?.case) {
    const cases = estObjet(avant.cases) ? { ...avant.cases } : {};
    if (changement.case.coche) cases[changement.case.code] = true; else delete cases[changement.case.code];
    apres.cases = cases;
  }
  if (changement?.mesures !== undefined) apres.mesures = texte(changement.mesures);
  if (auteur) apres.maj_par = auteur;
  if (maintenant) apres.maj_le = maintenant;
  return { ...form, reponses: { ...(form?.reponses || {}), [cle]: apres } };
}

// ─── Indicateur d'enregistrement ─────────────────────────────────────────────

/** Libellé de l'indicateur : jamais « enregistré » tant qu'une écriture n'a pas réussi. */
export function libelleEnregistrement(etat) {
  switch (etat) {
    case "enregistre":    return { texte: "enregistré", ton: "ok" };
    case "en_attente":    return { texte: "modifications en attente…", ton: "attente" };
    case "enregistrement": return { texte: "enregistrement…", ton: "attente" };
    case "erreur":        return { texte: "erreur, non enregistré", ton: "erreur" };
    case "lecture_seule": return { texte: "lecture seule", ton: "neutre" };
    default:              return { texte: "", ton: "neutre" };
  }
}
