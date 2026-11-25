// ─────────────────────────────────────────────────────────────────────────────
// Fiche de préparation sécurité — mise en page du PDF (tâche 5 du projet
// docs/projets/fiche-securite-chantier.md).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Façade front : securitePdf.js. Le rendu (html2pdf, comme le PDF du Bilan)
// et le stockage sont faits par securitePdfRendu.js / securiteDonnees.js.
//
// Deux étapes, testables séparément (scripts/verif-securite-pdf.mjs) :
//   1. modelePdfFiche() : données → modèle ordonné (sections, lignes, cases,
//      signatures). Construit à partir du CONTENU FIGÉ de la version
//      (securite_fiches_versions.contenu), jamais de la fiche courante : le
//      PDF reproduit exactement ce qui a été validé et signé ;
//   2. htmlFicheSecuritePdf() : modèle → HTML à la charte Profero (héros bleu
//      nuit arrondi avec logo, accents jaunes, cartes blanches, pied de page
//      « Profero — Rénovation & réhabilitation »), rendu par html2pdf dans un
//      conteneur de 794 px (mêmes contraintes que bilanPdfV3.mjs : tailles en
//      px, aucune ombre, aucun dégradé vers le transparent).
//
// Ordre des sections (spécification, « Export PDF ») : identification et
// intervenants, données de base, synthèse des risques, points 4 à 12,
// historique des versions, signatures.
//
// Une impossibilité reste visible : valeur absente = « non renseigné »,
// signature requise absente = « non signée », image illisible = « image de
// signature illisible », point sans statut = « À compléter ». Un aperçu de
// brouillon porte « BROUILLON — non validé » en haut, dans le héros et au pied.
// ─────────────────────────────────────────────────────────────────────────────
import { POINTS_CARTES, CLES_REPONSES, libelleJustificatif, libelleStatutPoint } from "./securite/points.mjs";
import { FORMATS_CONTENU_LISIBLES, empreinteCourte } from "./securiteVersion.mjs";
import { NON_RENSEIGNE, texteOuiNon, texteEtage, texteAvantDate, libelleReperageAmiante } from "./securitePastilles.mjs";
import { SIGNATURES_REQUISES } from "./securiteValidation.mjs";
import {
  OR, ENCRE, TEXTE_SECONDAIRE, BORDURE, FOND_DOUX, JAUNE_PALE, FOND_HERO, HALO_OR, HALO_BLEU, FILET_TITRE,
  POLICE_TEXTE, POLICE_TITRE, PIED_GAUCHE,
} from "./charteDocProfero.mjs";

/** Ordre des sections du PDF (identifiants des sections du modèle). */
export const SECTIONS_PDF = Object.freeze(["identification", "donnees_base", "synthese", "points", "historique", "signatures"]);

/** Mention d'un aperçu non stocké d'une fiche en brouillon. */
export const MENTION_BROUILLON = "BROUILLON — non validé";

/** Libellés des signatures d'accueil (tâche 8) en plus des signatures requises. */
const LIBELLES_SIGNATURE = Object.freeze({
  ...Object.fromEntries(SIGNATURES_REQUISES.map((s) => [s.type, s.libelle])),
  accueil: "Accueil",
});

const estObjet = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const liste = (v) => (Array.isArray(v) ? v : []);
const texte = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const ouNR = (v) => texte(v) || NON_RENSEIGNE;

// ─── Dates (aucune horloge : seulement la mise en forme de valeurs reçues) ──

/** « 2026-11-25 » → « 25/11/2026 » ; vide → non renseigné ; forme inattendue → telle quelle. */
export function dateFr(iso) {
  const t = texte(iso);
  if (!t) return NON_RENSEIGNE;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
}

/** Horodatage ISO → « 25/11/2026 à 14:05 » (heure de Paris). */
export function dateHeureFr(iso) {
  const t = texte(iso);
  if (!t) return NON_RENSEIGNE;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t;
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} à ${p.hour}:${p.minute}`;
}

// ─── Chemins et noms de fichier ─────────────────────────────────────────────

/**
 * Chemin (nouveau à chaque fois) du PDF d'une version dans securite-preuves :
 * versions/{fiche_id}/v{N}-fiche-securite-{horodatage}-{aléa}.pdf. Le bucket
 * refuse tout remplacement : un nouveau PDF prend toujours un nouveau nom.
 */
export function cheminPdfVersion({ ficheId, version, horodatage, alea }) {
  const f = String(ficheId || "");
  if (!/^[0-9a-f-]{36}$/i.test(f)) throw new Error("Fiche inconnue.");
  if (!Number.isInteger(version) || version < 1) throw new Error("Version inconnue.");
  const h = String(horodatage ?? "").replace(/[^0-9]/g, "");
  if (!h) throw new Error("Horodatage manquant.");
  const a = String(alea || "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  return `versions/${f}/v${version}-fiche-securite-${h}-${a || "x"}.pdf`;
}

/** Nom proposé au téléchargement (sans caractère gênant). */
export function nomFichierPdf({ chantierNom, version, brouillon = false }) {
  const base = texte(chantierNom).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chantier";
  return `Fiche-securite-${base}-v${Number.isInteger(version) ? version : "x"}${brouillon ? "-BROUILLON" : ""}.pdf`;
}

// ─── Modèle ──────────────────────────────────────────────────────────────────

// Justificatifs d'un point : ceux du chantier, puis (contenu v2, tâche 9)
// ceux de l'espace entreprise rattachés automatiquement, avec leur origine.
function justificatifsDuPointModele(contenu, numero) {
  const modele = (j, origine) => ({
    libelle: libelleJustificatif(j.type_code),
    fichier: texte(j.fichier_nom) || null,
    date: texte(j.date_document) ? dateFr(j.date_document) : "date non renseignée",
    expire: texte(j.expire_le) ? dateFr(j.expire_le) : null,
    personne: texte(j.personne) || null,
    entreprise: texte(j.entreprise_nom) || null,
    origine,
  });
  const duPoint = (l) => liste(l).filter((j) => estObjet(j) && Number(j.point) === numero);
  const tri = (a, b) => a.libelle.localeCompare(b.libelle, "fr");
  return [
    ...duPoint(contenu.justificatifs).map((j) => modele(j, "chantier")).sort(tri),
    ...duPoint(contenu.justificatifs_entreprise).map((j) => modele(j, "entreprise")).sort(tri),
  ];
}

const CHAMPS_DONNEES = Object.freeze([
  ["lots", "Lots prévus"], ["date_debut", "Début prévu"], ["date_fin", "Fin prévue"],
  ["date_depose_sanitaires", "Dépose des sanitaires"], ["effectif_max", "Effectif maximum"],
  ["site_occupe", "Logement occupé"], ["acces", "Accès"], ["observations", "Observations"],
]);

function valeurDonnee(cle, v) {
  if (cle === "lots") return liste(v).map(texte).filter(Boolean).join(", ") || NON_RENSEIGNE;
  if (cle.startsWith("date_")) return dateFr(v);
  if (cle === "site_occupe") return texteOuiNon(v);
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return ouNR(v);
}

function lignesBatiment(b) {
  if (!estObjet(b)) return [{ libelle: "Bâtiment", valeur: "données du bâtiment jamais saisies sur l'opération" }];
  const permis = texte(b.date_permis_construire);
  return [
    { libelle: "Permis de construire", valeur: dateFr(permis) },
    { libelle: "Avant le 1er juillet 1997", valeur: texteAvantDate(b.avant_1997, permis) },
    { libelle: "Avant 1949", valeur: texteAvantDate(b.avant_1949, permis) },
    { libelle: "Copropriété", valeur: texteOuiNon(b.copropriete) },
    { libelle: "Étage", valeur: texteEtage(b.etage) },
    { libelle: "Ascenseur utilisable", valeur: texteOuiNon(b.ascenseur_utilisable) },
    { libelle: "Repérage amiante", valeur: libelleReperageAmiante(b.reperage_amiante_statut) },
    ...(texte(b.notes) ? [{ libelle: "Notes", valeur: texte(b.notes) }] : []),
  ];
}

function signaturesModele({ signatures, version, empreinte }) {
  // Seules comptent les signatures de CETTE version portant l'empreinte du
  // contenu figé (une signature sur un contenu antérieur n'est pas reprise).
  const valables = liste(signatures)
    .filter((s) => estObjet(s) && s.version === version && empreinte && s.empreinte_version === empreinte)
    .sort((a, b) => String(a.signe_le || "").localeCompare(String(b.signe_le || "")));
  const versCarte = (s, type) => ({
    type,
    libelle: LIBELLES_SIGNATURE[type] || type,
    manquante: false,
    nom: ouNR(s.signataire_nom),
    entreprise: texte(s.signataire_entreprise) || null,
    le: dateHeureFr(s.signe_le),
    image: typeof s.image === "string" && s.image.startsWith("data:image/") ? s.image : null,
  });
  const out = [];
  for (const req of SIGNATURES_REQUISES) {
    const derniere = valables.filter((s) => s.type === req.type).slice(-1)[0];
    out.push(derniere ? versCarte(derniere, req.type)
      : { type: req.type, libelle: req.libelle, manquante: true, nom: null, entreprise: null, le: null, image: null });
  }
  valables.filter((s) => !SIGNATURES_REQUISES.some((r) => r.type === s.type)).forEach((s) => out.push(versCarte(s, s.type)));
  return out;
}

/**
 * Modèle du PDF.
 * @param {object} p
 * @param {object}   p.contenu     contenu figé (securite_fiches_versions.contenu), ou contenu
 *                                 calculé par contenuVersion() pour un aperçu de brouillon
 * @param {object?}  p.version     ligne de version { version, empreinte, cree_le, cree_par, motif_changement } (null = brouillon)
 * @param {object[]} p.versions    historique (lignes de version, sans contenu)
 * @param {object[]} p.signatures  signatures de la fiche, avec `image` = data URL PNG (null = illisible)
 * @param {boolean}  p.brouillon   aperçu non stocké d'une fiche non validée
 * @param {string?}  p.empreinte   empreinte du contenu (brouillon : celle du contenu actuel)
 * @param {string?}  p.apercuLe    horodatage de l'aperçu (brouillon), fourni par l'appelant
 * @returns {{ ok: true, modele } | { ok: false, erreur }}
 */
export function modelePdfFiche({ contenu, version = null, versions = [], signatures = [], brouillon = false, empreinte = null, apercuLe = null }) {
  if (!estObjet(contenu)) return { ok: false, erreur: "contenu de la version absent" };
  if (!FORMATS_CONTENU_LISIBLES.includes(contenu.format)) return { ok: false, erreur: `format du contenu inconnu (${contenu.format ?? "absent"})` };
  const n = contenu.version;
  if (!Number.isInteger(n) || n < 1) return { ok: false, erreur: "numéro de version illisible dans le contenu" };
  if (!brouillon) {
    if (!estObjet(version)) return { ok: false, erreur: "ligne de version absente" };
    if (version.version !== n) return { ok: false, erreur: `le contenu est celui de la v${n}, pas de la v${version.version}` };
  }
  const emp = brouillon ? empreinte : version.empreinte;

  // En-tête
  const entete = {
    chantier: ouNR(contenu.chantier?.nom),
    operation: ouNR(contenu.operation?.nom),
    adresse: texte(contenu.operation?.adresse) || "adresse non renseignée",
    client: texte(contenu.client) || "aucun client renseigné",
    version: n,
    brouillon: !!brouillon,
    statut: brouillon ? MENTION_BROUILLON : `Version ${n} validée le ${dateHeureFr(version.cree_le)}`,
    validePar: brouillon ? null : texte(version.cree_par) || null,
    apercuLe: brouillon && apercuLe ? dateHeureFr(apercuLe) : null,
    empreinte: emp ? empreinteCourte(emp) : null,
    empreinteComplete: emp || null,
    motif: texte(contenu.motif_changement) || null,
  };

  // 1. Identification et intervenants
  const it = liste(contenu.intervenants);
  const resp = it.find((x) => estObjet(x) && x.type === "responsable") || null;
  const entreprises = it.filter((x) => estObjet(x) && x.type === "entreprise").map((x) => ({
    nom: ouNR(x.nom), activite: texte(x.activite) || null, contact: texte(x.contact) || null, telephone: texte(x.telephone) || null,
  }));
  const identification = {
    id: "identification", numero: 1, titre: "Identification et intervenants",
    lignes: [
      { libelle: "Chantier", valeur: entete.chantier },
      { libelle: "Opération", valeur: entete.operation },
      { libelle: "Adresse", valeur: entete.adresse },
      { libelle: "Client", valeur: entete.client },
      { libelle: "Responsable du chantier", valeur: ouNR(resp?.nom) },
      { libelle: "Téléphone du responsable", valeur: ouNR(resp?.telephone) },
    ],
    entreprises,
    justificatifs: justificatifsDuPointModele(contenu, 1),
  };

  // 2. Données de base (+ bâtiment)
  const db = estObjet(contenu.donnees_base) ? contenu.donnees_base : {};
  const connues = CHAMPS_DONNEES.map(([k]) => k);
  const donnees = {
    id: "donnees_base", numero: 2, titre: "Données de base",
    lignes: [
      ...CHAMPS_DONNEES.map(([k, libelle]) => ({ libelle, valeur: valeurDonnee(k, db[k]) })),
      ...Object.keys(db).filter((k) => !connues.includes(k)).sort()
        .map((k) => ({ libelle: `Autre donnée (${k})`, valeur: valeurDonnee(k, db[k]) })),
    ],
    batiment: lignesBatiment(contenu.batiment),
    justificatifs: justificatifsDuPointModele(contenu, 2),
  };

  // 3. Synthèse des risques
  const risques = liste(contenu.synthese_risques)
    .map((r) => (typeof r === "string" ? r.trim() : r === null || r === undefined ? "" : JSON.stringify(r)))
    .filter(Boolean);
  const synthese = {
    id: "synthese", numero: 3, titre: "Synthèse des risques",
    risques, vide: risques.length === 0,
    justificatifs: justificatifsDuPointModele(contenu, 3),
  };

  // 4 à 12
  const reponses = estObjet(contenu.reponses) ? contenu.reponses : {};
  const cartes = POINTS_CARTES.map((p) => {
    const r = estObjet(reponses[p.cle]) ? reponses[p.cle] : {};
    const statut = typeof r.statut === "string" ? r.statut : "a_completer";
    const coches = estObjet(r.cases) ? r.cases : {};
    const codes = p.cases.map((c) => c.code);
    return {
      numero: p.numero, cle: p.cle, titre: p.titre, objet: p.objet,
      statut, statutLibelle: libelleStatutPoint(statut),
      cases: p.cases.map((c) => ({ code: c.code, libelle: c.libelle, cochee: coches[c.code] === true })),
      casesInconnues: Object.keys(coches).filter((k) => coches[k] === true && !codes.includes(k)).sort(),
      mesures: texte(r.mesures) || null,
      justificatifs: justificatifsDuPointModele(contenu, p.numero),
    };
  });
  const points = {
    id: "points", titre: "Points 4 à 12",
    cartes,
    reponsesInconnues: Object.keys(reponses).filter((k) => !CLES_REPONSES.includes(k)).sort(),
  };

  // Historique : versions jusqu'à celle du PDF (une version postérieure ne
  // doit pas changer le PDF d'une version antérieure).
  const lignesHisto = liste(versions)
    .filter((v) => estObjet(v) && Number.isInteger(v.version) && (brouillon ? v.version < n : v.version <= n))
    .sort((a, b) => a.version - b.version)
    .map((v) => ({
      version: v.version, le: dateHeureFr(v.cree_le), par: texte(v.cree_par) || null,
      motif: texte(v.motif_changement) || (v.version === 1 ? "première version" : "motif non renseigné"),
      empreinte: empreinteCourte(v.empreinte), enCours: false,
    }));
  if (!brouillon && !lignesHisto.some((l) => l.version === n)) {
    lignesHisto.push({ version: n, le: dateHeureFr(version.cree_le), par: texte(version.cree_par) || null,
      motif: texte(version.motif_changement) || (n === 1 ? "première version" : "motif non renseigné"), empreinte: empreinteCourte(version.empreinte), enCours: false });
  }
  if (brouillon) {
    lignesHisto.push({ version: n, le: entete.apercuLe || NON_RENSEIGNE, par: null, motif: entete.motif || (n === 1 ? "première version" : "motif non renseigné"),
      empreinte: emp ? empreinteCourte(emp) : "—", enCours: true });
  }
  const historique = { id: "historique", titre: "Historique des versions", lignes: lignesHisto };

  // Signatures
  const sigs = { id: "signatures", titre: "Signatures", cartes: signaturesModele({ signatures, version: n, empreinte: emp }) };

  return { ok: true, modele: { entete, sections: [identification, donnees, synthese, points, historique, sigs] } };
}

// ─── HTML à la charte ────────────────────────────────────────────────────────

export const echapperHtml = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const e = echapperHtml;

const ROUGE = "#b91c1c";
const STYLE = `
  .fiche-secu { font-family: ${POLICE_TEXTE}; color: ${ENCRE}; font-size: 10.5px; line-height: 1.35; background: #fff; }
  .fiche-secu * { box-sizing: border-box; }
  .fiche-secu .brouillon-bandeau { border: 2px solid ${ROUGE}; color: ${ROUGE}; background: #fee2e2; border-radius: 10px; padding: 6px 12px; margin-bottom: 8px; font-weight: 800; font-size: 13px; letter-spacing: .12em; text-align: center; }
  .fiche-secu .hero { position: relative; overflow: hidden; border-radius: 16px; background: ${FOND_HERO}; padding: 18px 22px; color: #fff; margin-bottom: 10px; }
  .fiche-secu .hero .halo { position: absolute; border-radius: 50%; }
  .fiche-secu .hero .halo-or { right: -60px; top: -75px; width: 235px; height: 235px; background: ${HALO_OR}; }
  .fiche-secu .hero .halo-bleu { left: -45px; bottom: -100px; width: 215px; height: 215px; background: ${HALO_BLEU}; }
  .fiche-secu .hero .logo { position: relative; display: block; height: 30px; margin-bottom: 14px; }
  .fiche-secu .hero .corps { position: relative; display: flex; align-items: flex-end; gap: 18px; }
  .fiche-secu .hero .txt { flex: 1; min-width: 0; }
  .fiche-secu .hero .eb { font-size: 9.5px; letter-spacing: .24em; font-weight: 700; color: ${OR}; text-transform: uppercase; }
  .fiche-secu .hero h1 { font-family: ${POLICE_TITRE}; font-weight: 800; font-size: 28px; line-height: 1.05; margin: 5px 0 4px; text-transform: uppercase; color: #fff; }
  .fiche-secu .hero .sous-titre { color: #aeb6c8; font-size: 11px; }
  .fiche-secu .hero .pills { margin-top: 11px; display: flex; flex-wrap: wrap; gap: 7px; }
  .fiche-secu .hero .pill { border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.07); border-radius: 999px; padding: 4px 11px; font-size: 9.5px; font-weight: 600; color: #e8ebf2; white-space: nowrap; }
  .fiche-secu .hero .pill.rouge { border-color: #fca5a5; background: ${ROUGE}; color: #fff; }
  .fiche-secu .hero-kpi { flex: none; min-width: 120px; background: ${OR}; color: ${ENCRE}; border-radius: 12px; padding: 10px 16px 11px; text-align: center; }
  .fiche-secu .hero-kpi .l { font-size: 8px; letter-spacing: .2em; font-weight: 700; color: #6b5200; text-transform: uppercase; }
  .fiche-secu .hero-kpi .v { font-family: ${POLICE_TITRE}; font-weight: 800; font-size: 27px; line-height: 1.05; margin-top: 2px; white-space: nowrap; }
  .fiche-secu .hero-kpi.rouge { background: #fee2e2; color: ${ROUGE}; }
  .fiche-secu .hero-kpi.rouge .l { color: ${ROUGE}; }

  .fiche-secu .sh { display: flex; align-items: center; gap: 12px; margin: 14px 0 7px; page-break-after: avoid; break-after: avoid; }
  .fiche-secu .sh h2 { margin: 0; font-family: ${POLICE_TITRE}; font-weight: 800; font-size: 15px; letter-spacing: .14em; text-transform: uppercase; white-space: nowrap; color: ${ENCRE}; }
  .fiche-secu .sh .num { display: inline-block; min-width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 6px; background: ${ENCRE}; color: ${OR}; font-weight: 800; font-size: 12px; margin-right: 6px; }
  .fiche-secu .sh .ln { flex: 1; height: 2px; border-radius: 2px; background: ${FILET_TITRE}; }
  .fiche-secu .carte { border: 1px solid ${BORDURE}; border-radius: 14px; padding: 10px 14px; background: #fff; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; }
  .fiche-secu .carte h3 { margin: 0 0 4px; font-family: ${POLICE_TITRE}; font-weight: 800; font-size: 14px; letter-spacing: .04em; text-transform: uppercase; color: ${ENCRE}; display: flex; align-items: center; gap: 8px; }
  .fiche-secu .carte h3 .num { display: inline-block; min-width: 22px; height: 22px; line-height: 22px; text-align: center; border-radius: 6px; background: ${ENCRE}; color: ${OR}; font-size: 12px; }
  .fiche-secu .carte h3 .titre { flex: 1; }
  .fiche-secu .objet { color: ${TEXTE_SECONDAIRE}; font-size: 9.5px; margin-bottom: 6px; }
  .fiche-secu h4 { margin: 8px 0 3px; font-size: 8.5px; letter-spacing: .12em; color: ${TEXTE_SECONDAIRE}; text-transform: uppercase; font-weight: 700; }
  .fiche-secu .statut { display: inline-block; font-family: ${POLICE_TEXTE}; font-size: 9px; font-weight: 700; padding: 2px 9px; border-radius: 999px; letter-spacing: .04em; text-transform: none; }
  .fiche-secu .statut.concerne { background: ${OR}; color: ${ENCRE}; }
  .fiche-secu .statut.non_concerne { background: ${FOND_DOUX}; color: ${TEXTE_SECONDAIRE}; }
  .fiche-secu .statut.a_completer { background: #fee2e2; color: ${ROUGE}; border: 1px solid #fca5a5; }

  .fiche-secu table.kv { width: 100%; border-collapse: collapse; }
  .fiche-secu table.kv td { padding: 3px 4px; border-top: 1px solid ${FOND_DOUX}; vertical-align: top; }
  .fiche-secu table.kv tr:first-child td { border-top: none; }
  .fiche-secu table.kv td.l { width: 38%; color: ${TEXTE_SECONDAIRE}; font-weight: 600; }
  .fiche-secu .gris { color: ${TEXTE_SECONDAIRE}; }
  .fiche-secu .nr { color: ${TEXTE_SECONDAIRE}; font-style: italic; }
  .fiche-secu .deux { display: flex; gap: 8px; }
  .fiche-secu .deux > .carte { flex: 1; min-width: 0; }

  .fiche-secu table.tab { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid ${BORDURE}; border-radius: 10px; overflow: hidden; margin: 3px 0; }
  .fiche-secu table.tab th { text-align: left; background: ${ENCRE}; color: #fff; font-weight: 700; font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; padding: 5px 6px; }
  .fiche-secu table.tab td { padding: 4px 6px; border-top: 1px solid ${FOND_DOUX}; vertical-align: top; }
  .fiche-secu table.tab tbody tr:first-child td { border-top: none; }
  .fiche-secu table.tab tr.en-cours td { background: ${JAUNE_PALE}; font-weight: 700; }

  .fiche-secu ul.cases { list-style: none; margin: 2px 0; padding: 0; }
  .fiche-secu ul.cases li { position: relative; padding: 2px 0 2px 20px; margin: 0; page-break-inside: avoid; break-inside: avoid; }
  .fiche-secu .case { position: absolute; left: 0; top: 3px; width: 12px; height: 12px; border-radius: 3px; border: 1.5px solid ${ENCRE}; background: #fff; }
  .fiche-secu .case.coche { background: ${ENCRE}; }
  .fiche-secu .case.coche:after { content: ""; position: absolute; left: 2.5px; top: 2.5px; width: 4px; height: 4px; border-radius: 1px; background: ${OR}; }
  .fiche-secu li.vide { color: ${TEXTE_SECONDAIRE}; }
  .fiche-secu ul.puces { list-style: none; margin: 2px 0; padding: 0; }
  .fiche-secu ul.puces li { position: relative; padding: 2px 0 2px 15px; page-break-inside: avoid; break-inside: avoid; }
  .fiche-secu ul.puces li:before { content: ""; position: absolute; left: 2px; top: 7px; width: 6px; height: 6px; border-radius: 50%; background: ${OR}; }
  .fiche-secu .mesures { background: ${JAUNE_PALE}; border-left: 3px solid ${OR}; border-radius: 6px; padding: 5px 9px; margin-top: 4px; white-space: pre-wrap; }
  .fiche-secu .avert { border: 1px solid #fca5a5; border-left: 3px solid ${ROUGE}; background: #fee2e2; color: ${ROUGE}; padding: 5px 10px; border-radius: 8px; margin: 5px 0; font-size: 9.5px; font-weight: 600; }

  .fiche-secu .signatures { display: flex; flex-wrap: wrap; gap: 8px; }
  .fiche-secu .signature { flex: 1 1 45%; min-width: 0; border: 1px solid ${BORDURE}; border-radius: 14px; padding: 9px 12px; background: #fff; page-break-inside: avoid; break-inside: avoid; }
  .fiche-secu .signature .t { font-size: 8.5px; letter-spacing: .12em; color: ${TEXTE_SECONDAIRE}; text-transform: uppercase; font-weight: 700; }
  .fiche-secu .signature .nom { font-weight: 700; font-size: 11.5px; margin-top: 2px; }
  .fiche-secu .signature .img { height: 80px; margin-top: 5px; border: 1px dashed ${BORDURE}; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .fiche-secu .signature .img img { max-height: 76px; max-width: 100%; }
  .fiche-secu .signature.manquante { border-color: #fca5a5; }
  .fiche-secu .signature.manquante .etat { color: ${ROUGE}; font-weight: 700; margin-top: 4px; }
  .fiche-secu .engagement { color: ${TEXTE_SECONDAIRE}; font-size: 9px; margin: 2px 0 6px; font-style: italic; }

  .fiche-secu .pied { margin-top: 14px; padding-top: 7px; border-top: 1px solid ${BORDURE}; display: flex; justify-content: space-between; gap: 10px; font-size: 8.5px; color: #9aa2b4; }
  .fiche-secu .pied b { letter-spacing: .16em; font-weight: 700; text-transform: uppercase; }
  .fiche-secu .pied .rouge { color: ${ROUGE}; font-weight: 800; letter-spacing: .1em; }
`;

const valeurHtml = (v) => (v === NON_RENSEIGNE || /^(aucun|adresse non|données du bâtiment jamais|date non)/.test(String(v))
  ? `<span class="nr">${e(v)}</span>` : e(v));
const tableKv = (lignes) => `<table class="kv"><tbody>${lignes.map((l) => `<tr><td class="l">${e(l.libelle)}</td><td>${valeurHtml(l.valeur)}</td></tr>`).join("")}</tbody></table>`;
const titreSection = (t, numero = null, id = "") => `<div class="sh" data-section="${e(id)}"><h2>${numero != null ? `<span class="num">${e(numero)}</span>` : ""}${e(t)}</h2><span class="ln"></span></div>`;

function justificatifsHtml(js) {
  if (!js.length) return `<h4>Justificatifs joints</h4><div class="nr">aucun justificatif joint</div>`;
  return `<h4>Justificatifs joints</h4><ul class="puces">${js.map((j) => `<li class="justificatif"><b>${e(j.libelle)}</b>${j.fichier ? ` — ${e(j.fichier)}` : ""} · du ${valeurHtml(j.date)}${j.origine === "entreprise"
    ? ` · depuis l'espace entreprise, ${j.expire ? `valable jusqu'au ${e(j.expire)}` : "sans date d'expiration"}`
    : (j.expire ? ` · expire le ${e(j.expire)}` : "")}${j.personne ? ` · ${e(j.personne)}` : ""}${j.entreprise ? ` (${e(j.entreprise)})` : ""}</li>`).join("")}</ul>`;
}

function heroHtml(t, logoUrl) {
  const pills = [
    `Opération ${t.operation}`,
    t.adresse,
    t.brouillon ? null : (t.validePar ? `Validée par ${t.validePar}` : null),
    t.empreinte ? `Empreinte ${t.empreinte}…` : null,
  ].filter(Boolean);
  return `<div class="hero">
    <div class="halo halo-or"></div><div class="halo halo-bleu"></div>
    ${logoUrl ? `<img class="logo" src="${e(logoUrl)}" alt="Profero" crossorigin="anonymous">` : ""}
    <div class="corps">
      <div class="txt">
        <div class="eb">Fiche de préparation sécurité chantier</div>
        <h1>${e(t.chantier)}</h1>
        <div class="sous-titre">${e(t.statut)}${t.apercuLe ? ` — aperçu du ${e(t.apercuLe)}` : ""}${t.motif ? ` — motif : ${e(t.motif)}` : ""}</div>
        <div class="pills">${t.brouillon ? `<span class="pill rouge">${e(MENTION_BROUILLON)}</span>` : ""}${pills.map((x) => `<span class="pill">${e(x)}</span>`).join("")}</div>
      </div>
      <div class="hero-kpi${t.brouillon ? " rouge" : ""}"><div class="l">${t.brouillon ? "Non validée" : "Version"}</div><div class="v">v${e(t.version)}</div></div>
    </div>
  </div>`;
}

function identificationHtml(s) {
  const ent = s.entreprises.length
    ? `<table class="tab"><thead><tr><th>Entreprise</th><th>Activité</th><th>Contact</th><th>Téléphone</th></tr></thead><tbody>${s.entreprises.map((x) => `<tr><td><b>${e(x.nom)}</b></td><td>${x.activite ? e(x.activite) : '<span class="nr">—</span>'}</td><td>${x.contact ? e(x.contact) : '<span class="nr">—</span>'}</td><td>${x.telephone ? e(x.telephone) : '<span class="nr">—</span>'}</td></tr>`).join("")}</tbody></table>`
    : `<div class="nr">aucune entreprise renseignée</div>`;
  return `${titreSection(s.titre, s.numero, s.id)}<div class="carte">${tableKv(s.lignes)}<h4>Entreprises présentes</h4>${ent}${justificatifsHtml(s.justificatifs)}</div>`;
}

function donneesHtml(s) {
  return `${titreSection(s.titre, s.numero, s.id)}<div class="deux">
    <div class="carte"><h4 style="margin-top:0">Chantier</h4>${tableKv(s.lignes)}</div>
    <div class="carte"><h4 style="margin-top:0">Bâtiment (saisi sur l'opération)</h4>${tableKv(s.batiment)}</div>
  </div><div class="carte">${justificatifsHtml(s.justificatifs)}</div>`;
}

function syntheseHtml(s) {
  return `${titreSection(s.titre, s.numero, s.id)}<div class="carte">${s.vide ? `<div class="avert">Aucun risque principal renseigné.</div>`
    : `<ul class="puces">${s.risques.map((r) => `<li class="risque">${e(r)}</li>`).join("")}</ul>`}${justificatifsHtml(s.justificatifs)}</div>`;
}

function carteHtml(c) {
  const cases = c.statut === "non_concerne" ? ""
    : `<h4>Points de contrôle</h4><ul class="cases">${c.cases.map((x) => `<li class="${x.cochee ? "" : "vide"}"><span class="case ${x.cochee ? "coche" : "non-coche"}"></span>${e(x.libelle)}</li>`).join("")}${
      c.casesInconnues.map((k) => `<li><span class="case coche"></span>case retirée de la configuration (${e(k)})</li>`).join("")}</ul>`;
  return `<div class="carte point" data-point="${e(c.numero)}">
    <h3><span class="num">${e(c.numero)}</span><span class="titre">${e(c.titre)}</span><span class="statut ${e(c.statut === "concerne" || c.statut === "non_concerne" ? c.statut : "a_completer")}">${e(c.statutLibelle)}</span></h3>
    <div class="objet">${e(c.objet)}</div>
    ${cases}
    ${c.mesures ? `<h4>Mesures retenues</h4><div class="mesures">${e(c.mesures)}</div>` : c.statut === "concerne" ? `<h4>Mesures retenues</h4><div class="nr">aucune mesure rédigée</div>` : ""}
    ${justificatifsHtml(c.justificatifs)}
  </div>`;
}

function pointsHtml(s) {
  return `${titreSection(s.titre, null, s.id)}${s.cartes.map(carteHtml).join("")}${
    s.reponsesInconnues.length ? `<div class="avert">Réponses enregistrées pour des points inconnus de la configuration : ${e(s.reponsesInconnues.join(", "))}.</div>` : ""}`;
}

function historiqueHtml(s) {
  if (!s.lignes.length) return `${titreSection(s.titre, null, s.id)}<div class="carte nr">aucune version</div>`;
  return `${titreSection(s.titre, null, s.id)}<table class="tab"><thead><tr><th>Version</th><th>Validée le</th><th>Par</th><th>Motif</th><th>Empreinte</th></tr></thead><tbody>${
    s.lignes.map((l) => `<tr class="${l.enCours ? "en-cours" : ""}"><td>v${e(l.version)}${l.enCours ? ` — ${e(MENTION_BROUILLON)}` : ""}</td><td>${l.enCours ? `<span class="nr">non validée</span>` : e(l.le)}</td><td>${l.par ? e(l.par) : '<span class="nr">—</span>'}</td><td>${e(l.motif)}</td><td>${e(l.empreinte)}…</td></tr>`).join("")}</tbody></table>`;
}

function signaturesHtml(s, brouillon) {
  return `${titreSection(s.titre, null, s.id)}<div class="engagement">Chaque signataire reconnaît avoir été informé des risques et des consignes de ce chantier.${brouillon ? " Aperçu : seules les signatures portant sur le contenu actuel sont reprises." : " Seules les signatures portant sur le contenu exact de cette version sont reprises."}</div>
  <div class="signatures">${s.cartes.map((c) => c.manquante
    ? `<div class="signature manquante" data-signature="${e(c.type)}"><div class="t">${e(c.libelle)}</div><div class="etat">non signée</div></div>`
    : `<div class="signature" data-signature="${e(c.type)}"><div class="t">${e(c.libelle)}</div><div class="nom">${e(c.nom)}${c.entreprise ? ` — ${e(c.entreprise)}` : ""}</div><div class="gris">le ${e(c.le)}</div>
      <div class="img">${c.image ? `<img class="image-signature" src="${e(c.image)}" alt="Signature de ${e(c.nom)}">` : `<span class="avert">image de signature illisible</span>`}</div></div>`).join("")}</div>`;
}

/**
 * HTML complet (avec styles) prêt pour html2pdf.
 * @param {object} modele résultat de modelePdfFiche().modele
 * @param {{ logoUrl?: string }} options
 */
export function htmlFicheSecuritePdf(modele, { logoUrl = null } = {}) {
  const t = modele.entete;
  const s = Object.fromEntries(modele.sections.map((x) => [x.id, x]));
  const rendus = {
    identification: () => identificationHtml(s.identification),
    donnees_base: () => donneesHtml(s.donnees_base),
    synthese: () => syntheseHtml(s.synthese),
    points: () => pointsHtml(s.points),
    historique: () => historiqueHtml(s.historique),
    signatures: () => signaturesHtml(s.signatures, t.brouillon),
  };
  return `<div class="page fiche-secu"><style>${STYLE}</style>
  ${t.brouillon ? `<div class="brouillon-bandeau">${e(MENTION_BROUILLON)} — aperçu non stocké, à ne pas présenter</div>` : ""}
  ${heroHtml(t, logoUrl)}
  ${SECTIONS_PDF.map((id) => rendus[id]()).join("\n")}
  <div class="pied"><b>${e(PIED_GAUCHE)}</b>${t.brouillon ? `<span class="rouge">${e(MENTION_BROUILLON)}</span>` : `<span>Fiche sécurité — ${e(t.chantier)} — v${e(t.version)}${t.empreinte ? ` — empreinte ${e(t.empreinte)}…` : ""}</span>`}</div>
</div>`;
}
