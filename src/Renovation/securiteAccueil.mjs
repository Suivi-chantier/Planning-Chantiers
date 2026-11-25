// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — accueil de l'équipe et nouvelles versions
// (tâche 8 du projet docs/projets/fiche-securite-chantier.md ; spécification
// « Écrans §3 Signature (mobile) » et « Signatures, versions et verrouillage »).
//
// Module PUR : aucun accès Supabase, aucune horloge (la date du jour arrive en
// paramètre), aucun effet de bord. Façade front : securiteAccueil.js.
//
//   - QUI DOIT RE-SIGNER : « établie par » et « chef d'équipe » à chaque
//     version ; l'accueil seulement si les points 3 à 12 ont changé entre la
//     version signée et la version en cours. On compare les CONTENUS FIGÉS
//     (securite_fiches_versions.contenu), jamais la fiche courante :
//       · point 3 : les lignes de la synthèse des risques ;
//       · points 4 à 12 : statut, cases cochées, mesures retenues.
//     Ne comptent PAS : les traces de proposition (statut_propose,
//     raison_proposition), l'auteur et l'heure d'une saisie (maj_par,
//     maj_le), les points 1 et 2 (intervenants, données de base), le bâtiment,
//     les justificatifs (preuves rangées au dossier, pas des consignes données
//     à l'équipe). Un contenu illisible ne permet pas de comparer : la
//     signature est alors « à refaire » (impossibilité visible, jamais
//     « valable » par défaut).
//   - ÉTAT D'UNE SIGNATURE D'ACCUEIL (bureau : liste par version ; ouvrier :
//     « votre signature de la v1 reste valable ») ;
//   - ÉTAT DE L'ACCUEIL POUR L'OUVRIER CONNECTÉ : bouton « Signer l'accueil »
//     seulement sur une fiche validée, tant qu'il n'a pas de signature valable
//     pour la version en cours ;
//   - LECTURE POUR L'OUVRIER : risques principaux et consignes des points
//     concernés, tirés du contenu figé de la version validée ;
//   - MISE À JOUR PROPOSÉE (fiche validée ou « à mettre à jour ») : nouveau
//     prestataire au planning, lot ajouté au phasage qui change un statut
//     proposé (mêmes règles que securitePreRemplissage.mjs), justificatif
//     requis expiré. Rien n'est écrit : l'écran propose, la personne décide.
// ─────────────────────────────────────────────────────────────────────────────
import { POINTS_FICHE, DECLENCHEURS_PRE_REMPLISSAGE as D, STATUTS_POINT_COMPLETE, libelleStatutPoint } from "./securite/points.mjs";
import { serialisationCanonique, FORMAT_CONTENU_VERSION, MOTIF_MIN } from "./securiteVersion.mjs";
import { proposerPreRemplissage, normaliser } from "./securitePreRemplissage.mjs";
import { justificatifsRequisManquants } from "./securiteValidation.mjs";

/** Signatures à refaire à chaque nouvelle version, quoi qu'il ait changé. */
export const SIGNATURES_A_CHAQUE_VERSION = Object.freeze(["etablie_par", "chef_equipe"]);

/** Points comparés pour l'accueil (spécification : « points 3 à 12 »). */
export const POINTS_ACCUEIL = Object.freeze(POINTS_FICHE.filter((p) => p.numero >= 3).map((p) => p.numero));

/** Entreprise d'un ouvrier connecté (salarié) : non modifiable sur son téléphone. */
export const ENTREPRISE_OUVRIER = D.entreprisePrincipale;

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const txt = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const CARTES = POINTS_FICHE.filter((p) => p.section === "carte");

const listeNumeros = (ns) => {
  const l = [...ns].sort((a, b) => a - b);
  if (l.length <= 1) return `point ${l[0]}`;
  return `points ${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}`;
};

// ─── Partie « risques et consignes » d'un contenu figé ──────────────────────

/**
 * Partie d'un contenu figé qui compte pour l'accueil (points 3 à 12).
 * @returns {{ ok: true, valeur: { p3, p4…p12 } } | { ok: false, raison }}
 */
export function partieRisques(contenu) {
  if (!estObjet(contenu)) return { ok: false, raison: "contenu figé illisible" };
  if (contenu.format !== FORMAT_CONTENU_VERSION) return { ok: false, raison: `contenu figé de forme inconnue (${txt(contenu.format) || "sans format"})` };
  if (contenu.synthese_risques !== undefined && !Array.isArray(contenu.synthese_risques)) return { ok: false, raison: "synthèse des risques illisible" };
  if (contenu.reponses !== undefined && !estObjet(contenu.reponses)) return { ok: false, raison: "réponses illisibles" };
  const valeur = {
    p3: (contenu.synthese_risques || []).map((l) => (typeof l === "string" ? l.trim() : l)).filter((l) => l !== "" && l !== null),
  };
  const rep = contenu.reponses || {};
  for (const p of CARTES) {
    const r = estObjet(rep[p.cle]) ? rep[p.cle] : {};
    const cases = estObjet(r.cases) ? Object.keys(r.cases).filter((k) => r.cases[k] === true).sort() : [];
    valeur[p.cle] = { statut: typeof r.statut === "string" ? r.statut : "a_completer", cases, mesures: txt(r.mesures) };
  }
  return { ok: true, valeur };
}

/**
 * Les points 3 à 12 sont-ils identiques entre deux contenus figés ?
 * @returns {{ identiques: boolean|null, points: number[], raison: string|null }}
 *   identiques null = comparaison impossible (contenu illisible).
 */
export function comparerRisques(contenuSigne, contenuCourant) {
  const a = partieRisques(contenuSigne);
  const b = partieRisques(contenuCourant);
  if (!a.ok) return { identiques: null, points: [], raison: `version signée : ${a.raison}` };
  if (!b.ok) return { identiques: null, points: [], raison: `version en cours : ${b.raison}` };
  const points = [];
  if (serialisationCanonique(a.valeur.p3) !== serialisationCanonique(b.valeur.p3)) points.push(3);
  for (const p of CARTES) {
    if (serialisationCanonique(a.valeur[p.cle]) !== serialisationCanonique(b.valeur[p.cle])) points.push(p.numero);
  }
  return { identiques: points.length === 0, points, raison: null };
}

/**
 * Qui doit re-signer la version en cours, par rapport à une version signée.
 * @returns {{ etablie_par: true, chef_equipe: true, accueil: boolean, raison: string }}
 */
export function quiDoitResigner({ contenuSigne, contenuCourant }) {
  const c = comparerRisques(contenuSigne, contenuCourant);
  const accueil = c.identiques !== true;
  const raison = c.identiques === null
    ? `Accueil à refaire : comparaison impossible (${c.raison}).`
    : c.identiques
      ? "Accueil inchangé : risques et consignes (points 3 à 12) identiques."
      : `Accueil à refaire : ${listeNumeros(c.points)} modifié${c.points.length > 1 ? "s" : ""}.`;
  return { etablie_par: true, chef_equipe: true, accueil, raison };
}

// ─── État d'une signature d'accueil ─────────────────────────────────────────

/** Versions figées indexées par numéro : { [n]: { empreinte, contenu } }. */
export function indexVersions(versions) {
  const out = {};
  (Array.isArray(versions) ? versions : []).forEach((v) => { if (v && Number.isInteger(v.version)) out[v.version] = v; });
  return out;
}

/**
 * État d'une signature d'accueil par rapport à la version validée en cours.
 * @param {object} sig         ligne securite_signatures (type accueil)
 * @param {object} p
 * @param {object?} p.versionCourante  { version, empreinte, contenu } de la version VALIDÉE en cours (null si aucune)
 * @param {object}  p.versions         indexVersions(...) : versions figées avec leur contenu
 * @returns {{ etat: "valable"|"valable_anterieure"|"a_refaire"|"non_retenue"|"non_verifiable"|"en_attente", valable: boolean, libelle: string }}
 */
export function etatSignatureAccueil(sig, { versionCourante = null, versions = {} } = {}) {
  if (!sig) return { etat: "non_verifiable", valable: false, libelle: "signature illisible" };
  const vSig = versions[sig.version];
  if (!vSig) {
    if (!versionCourante) return { etat: "en_attente", valable: false, libelle: `signée sur la v${sig.version} (version non figée)` };
    return { etat: "non_verifiable", valable: false, libelle: `signée sur la v${sig.version} — version figée introuvable : à refaire` };
  }
  if (sig.empreinte_version !== vSig.empreinte) {
    return { etat: "non_retenue", valable: false, libelle: `signée sur un contenu non retenu de la v${sig.version} — à refaire` };
  }
  if (!versionCourante) {
    return { etat: "en_attente", valable: false, libelle: `signée sur la v${sig.version} (la version suivante n'est pas encore validée)` };
  }
  if (sig.version === versionCourante.version) {
    return { etat: "valable", valable: true, libelle: `signée sur la v${sig.version} (version en cours)` };
  }
  if (sig.version > versionCourante.version) {
    return { etat: "en_attente", valable: false, libelle: `signée sur la v${sig.version}` };
  }
  const c = comparerRisques(vSig.contenu, versionCourante.contenu);
  if (c.identiques === true) {
    return { etat: "valable_anterieure", valable: true, libelle: `signée sur la v${sig.version} — reste valable pour la v${versionCourante.version} (risques et consignes inchangés)` };
  }
  if (c.identiques === null) {
    return { etat: "non_verifiable", valable: false, libelle: `signée sur la v${sig.version} — comparaison impossible (${c.raison}) : à refaire` };
  }
  return { etat: "a_refaire", valable: false, libelle: `signée sur la v${sig.version} — à refaire : ${listeNumeros(c.points)} modifié${c.points.length > 1 ? "s" : ""} depuis` };
}

/**
 * Signatures d'accueil regroupées par version (la plus récente d'abord), avec
 * leur état. Pour la liste du bureau.
 * @returns {Array<{ version, signatures: Array<sig & { etat, valable, libelle }> }>}
 */
export function accueilParVersion(signatures, { versionCourante = null, versions = {} } = {}) {
  const groupes = new Map();
  (Array.isArray(signatures) ? signatures : []).filter((s) => s && s.type === "accueil").forEach((s) => {
    const e = etatSignatureAccueil(s, { versionCourante, versions });
    if (!groupes.has(s.version)) groupes.set(s.version, []);
    groupes.get(s.version).push({ ...s, ...e });
  });
  return [...groupes.entries()].sort((a, b) => b[0] - a[0]).map(([version, liste]) => ({
    version,
    signatures: liste.sort((a, b) => String(a.signe_le || "").localeCompare(String(b.signe_le || ""))),
  }));
}

/** Version validée en cours d'une fiche (null si la fiche n'est pas validée / à mettre à jour). */
export function versionValideeCourante(fiche, versions) {
  if (!fiche || !["validee", "a_mettre_a_jour"].includes(fiche.statut)) return null;
  return versions[fiche.version] || null;
}

// ─── Accueil côté ouvrier connecté ──────────────────────────────────────────

/**
 * Ce que voit l'ouvrier connecté pour un chantier du jour.
 * @param {object} p
 * @param {object?} p.fiche          ligne securite_fiches (null = pas de fiche)
 * @param {string?} p.erreur         lecture en échec
 * @param {Array}   p.versions       versions figées avec contenu (et empreinteVerifiee: bool)
 * @param {Array}   p.mesSignatures  signatures lisibles par l'ouvrier (les siennes)
 * @returns {{ etat, message, peutSigner, version: object|null, signatureValable: object|null, detail: string|null }}
 */
export function etatAccueilOuvrier({ fiche = null, erreur = null, versions = [], mesSignatures = [] } = {}) {
  const res = (etat, message, extra = {}) => ({ etat, message, peutSigner: false, version: null, signatureValable: null, detail: null, ...extra });
  if (erreur) return res("illisible", `Fiche sécurité illisible (${erreur}).`);
  if (!fiche) return res("non_validee", "Fiche sécurité pas encore validée (pas encore créée par le bureau).");
  if (fiche.statut === "verrouillee") return res("verrouillee", "Chantier terminé : fiche sécurité verrouillée.");
  const idx = indexVersions(versions);
  const mes = (Array.isArray(mesSignatures) ? mesSignatures : [])
    .filter((s) => s && s.type === "accueil" && String(s.fiche_id) === String(fiche.id))
    .sort((a, b) => b.version - a.version || String(b.signe_le || "").localeCompare(String(a.signe_le || "")));

  if (fiche.statut === "brouillon") {
    const derniere = mes[0];
    const detail = derniere ? `Votre signature de la v${derniere.version} reste au dossier ; la v${fiche.version} est en préparation au bureau.` : null;
    return res("non_validee", "Fiche sécurité pas encore validée.", { detail });
  }
  if (!["validee", "a_mettre_a_jour"].includes(fiche.statut)) return res("illisible", `Fiche sécurité dans un état inconnu (${fiche.statut}).`);

  const vc = idx[fiche.version];
  if (!vc) return res("illisible", `Fiche sécurité validée, mais la v${fiche.version} figée est introuvable : signature impossible, prévenez le bureau.`);
  if (vc.empreinteVerifiee === false) return res("illisible", `Le contenu de la v${fiche.version} ne correspond pas à son empreinte : signature impossible, prévenez le bureau.`, { version: vc });

  let valable = null;
  let aRefaire = null;
  for (const s of mes) {
    const e = etatSignatureAccueil(s, { versionCourante: vc, versions: idx });
    if (e.valable) { valable = { ...s, ...e }; break; }
    if (!aRefaire) aRefaire = { ...s, ...e };
  }
  if (fiche.statut === "a_mettre_a_jour") {
    return res("a_mettre_a_jour", "Fiche sécurité en cours de mise à jour par le bureau : la signature d'accueil reprendra quand la nouvelle version sera validée.", {
      version: vc, signatureValable: valable,
      detail: valable ? (valable.etat === "valable" ? `Vous avez signé l'accueil de la v${fiche.version}.` : `Votre signature de la v${valable.version} reste valable pour la v${fiche.version}.`) : null,
    });
  }
  if (valable) {
    return res(valable.etat === "valable" ? "signee" : "signee_anterieure_valable",
      valable.etat === "valable"
        ? `Accueil signé sur la v${fiche.version}.`
        : `Votre signature de la v${valable.version} reste valable : les risques et consignes n'ont pas changé dans la v${fiche.version}.`,
      { version: vc, signatureValable: valable });
  }
  return res("a_signer", `Fiche sécurité validée (v${fiche.version}) : signez l'accueil après l'avoir lue.`, {
    version: vc, peutSigner: true,
    detail: aRefaire ? `Votre signature de la v${aRefaire.version} n'est plus valable (${aRefaire.libelle.replace(/^signée sur la v\d+ — /, "")}).` : null,
  });
}

/**
 * Lecture simplifiée d'un contenu figé, pour l'ouvrier : risques principaux,
 * puis consignes (cases cochées et mesures) des points concernés.
 * @returns {{ ok, raison?, risques: string[], points: Array<{numero, titre, consignes: string[], mesures}>, nonConcernes: string[], aCompleter: string[] }}
 */
export function lectureOuvrier(contenu) {
  const pr = partieRisques(contenu);
  if (!pr.ok) return { ok: false, raison: pr.raison, risques: [], points: [], nonConcernes: [], aCompleter: [] };
  const points = [];
  const nonConcernes = [];
  const aCompleter = [];
  for (const p of CARTES) {
    const r = pr.valeur[p.cle];
    if (r.statut === "non_concerne") { nonConcernes.push(p.titre); continue; }
    if (r.statut !== "concerne") { aCompleter.push(p.titre); continue; }
    const consignes = r.cases.map((code) => p.cases.find((c) => c.code === code)?.libelle || code);
    points.push({ numero: p.numero, titre: p.titre, consignes, mesures: r.mesures });
  }
  return { ok: true, risques: pr.valeur.p3.filter((l) => typeof l === "string"), points, nonConcernes, aCompleter };
}

// ─── Mise à jour proposée ───────────────────────────────────────────────────

const entreprisesFiche = (fiche) => (Array.isArray(fiche?.intervenants) ? fiche.intervenants : [])
  .filter((e) => estObjet(e) && e.type === "entreprise" && txt(e.nom)).map((e) => normaliser(e.nom));

const libelleLot = (id, lots) => (lots || []).find((l) => l.id === id)?.label || id;

/**
 * Ce qui justifie de proposer une nouvelle version d'une fiche VALIDÉE (ou
 * « à mettre à jour ») : rien n'est écrit, c'est une proposition.
 * @param {object} p
 * @param {object}  p.fiche        ligne securite_fiches
 * @param {object}  p.sources      { batiment, phasage, planning, planningOperation, ressources, commandes }
 *                                  (mêmes formes que proposerPreRemplissage)
 * @param {Array}   p.lots         lots de l'appli { id, label }
 * @param {Array?}  p.justificatifs justificatifs actifs du chantier (null = illisibles)
 * @param {string}  p.aujourdhui   AAAA-MM-JJ
 * @returns {{ applicable: boolean, raisons: Array<{ code, message }>, impossibles: string[], motif: string }}
 */
export function propositionsMiseAJour({ fiche = null, sources = {}, lots = [], justificatifs = null, aujourdhui = null } = {}) {
  const vide = { applicable: false, raisons: [], impossibles: [], motif: "" };
  if (!fiche || !["validee", "a_mettre_a_jour"].includes(fiche.statut)) return vide;
  const raisons = [];
  const impossibles = [];
  const P = proposerPreRemplissage({ ...sources, lots, fiche }).points;

  // 1. Nouveau prestataire au planning du chantier.
  const pl = sources.planning, rs = sources.ressources;
  if (!pl || pl.erreur || !Array.isArray(pl.cellules)) impossibles.push(`planning illisible${pl?.erreur ? ` (${pl.erreur})` : ""} : nouveaux prestataires non recherchés`);
  else if (!rs || rs.erreur || !Array.isArray(rs.liste)) impossibles.push(`liste des ressources illisible${rs?.erreur ? ` (${rs.erreur})` : ""} : nouveaux prestataires non recherchés`);
  else {
    const saisies = entreprisesFiche(fiche);
    (P.p1?.valeurs.entreprises || [])
      .filter((e) => normaliser(e.nom) !== normaliser(D.entreprisePrincipale) && !saisies.includes(normaliser(e.nom)))
      .forEach((e) => raisons.push({ code: "prestataire", message: `nouveau prestataire « ${e.nom} » au planning (absent du point 1)` }));
  }

  // 2. Lot ajouté au phasage qui change un statut proposé des points 4 à 12.
  const ph = sources.phasage;
  if (!ph || ph.erreur) impossibles.push(`phasage illisible${ph?.erreur ? ` (${ph.erreur})` : ""} : nouveaux lots non recherchés`);
  else if (Array.isArray(ph.ouvrages) && ph.ouvrages.length && P.p2?.applicable) {
    const db = estObjet(fiche.donnees_base) ? fiche.donnees_base : {};
    const lotsFiche = Array.isArray(db.lots) ? db.lots.map(txt) : [];
    const nouveaux = (P.p2.valeurs.lots || []).filter((l) => !lotsFiche.includes(l));
    if (nouveaux.length) {
      const sansNouveaux = { ...ph, ouvrages: ph.ouvrages.filter((o) => !nouveaux.includes(txt(o?.lot_id))) };
      const P0 = proposerPreRemplissage({ ...sources, phasage: sansNouveaux, lots, fiche }).points;
      const rep = estObjet(fiche.reponses) ? fiche.reponses : {};
      const touches = CARTES.filter((p) => {
        const avec = P[p.cle]?.statut_propose, sans = P0[p.cle]?.statut_propose;
        if (!STATUTS_POINT_COMPLETE.includes(avec) || avec === sans) return false;
        return rep[p.cle]?.statut !== avec;
      });
      if (touches.length) {
        raisons.push({
          code: "lot",
          message: `lot${nouveaux.length > 1 ? "s" : ""} ${nouveaux.map((l) => libelleLot(l, lots)).join(", ")} ajouté${nouveaux.length > 1 ? "s" : ""} au phasage : ${touches.map((p) => `point ${p.numero} (${p.titre}) proposé « ${libelleStatutPoint(P[p.cle].statut_propose)} »`).join(", ")}`,
        });
      }
    }
  }

  // 3. Justificatif requis expiré.
  const m = justificatifsRequisManquants({ reponses: fiche.reponses, justificatifs, aujourdhui });
  if (m === null) impossibles.push("justificatifs illisibles : expirations non vérifiées");
  else m.filter((j) => j.raison === "expire").forEach((j) => raisons.push({ code: "justificatif", message: `justificatif requis expiré : ${j.libelle} (point ${j.numero})` }));

  const motif = raisons.length ? `Mise à jour proposée : ${raisons.map((r) => r.message).join(" ; ")}.` : "";
  return { applicable: true, raisons, impossibles, motif };
}

/**
 * Passage d'une fiche validée en « à mettre à jour » : seulement par une
 * action au bureau (jamais en arrière-plan), pour un chantier en cours et
 * quand une mise à jour est proposée.
 * @returns {{ ok: true, patch, journal } | { ok: false, raison }}
 */
export function preparerAMettreAJour({ fiche, chantier, motif, auteur = null }) {
  if (!fiche) return { ok: false, raison: "Fiche absente." };
  if (fiche.statut !== "validee") return { ok: false, raison: "Seule une fiche validée peut passer « à mettre à jour »." };
  if (chantier?.statut !== "en_cours") return { ok: false, raison: "Seulement pour un chantier en cours (sinon, « Mettre à jour » directement)." };
  const m = txt(motif);
  if (m.length < MOTIF_MIN) return { ok: false, raison: `Motif obligatoire (${MOTIF_MIN} caractères au moins).` };
  return {
    ok: true,
    patch: { statut: "a_mettre_a_jour", maj_par: auteur || null },
    journal: {
      chantier_id: String(fiche.chantier_id),
      evenement: "fiche_securite",
      ancien_statut: "validee",
      nouveau_statut: "a_mettre_a_jour",
      motif: m,
      detail: `Fiche sécurité v${fiche.version} marquée « à mettre à jour »`,
      auteur: auteur || null,
    },
  };
}
