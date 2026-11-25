#!/usr/bin/env node
// Vérifie l'accueil de l'équipe et les nouvelles versions de la fiche
// sécurité (tâche 8 du projet docs/projets/fiche-securite-chantier.md) :
//   - « qui doit re-signer » : établie par + chef d'équipe à chaque version,
//     accueil seulement si les points 3 à 12 ont changé (contenus figés) ;
//   - état d'une signature d'accueil (« signée sur la v1 », reste valable /
//     à refaire) et ce que voit l'ouvrier connecté (bouton ou non) ;
//   - mise à jour proposée : nouveau prestataire au planning, lot ajouté au
//     phasage qui change un statut proposé, justificatif requis expiré ;
//   - passage « à mettre à jour » seulement préparé sur action (chantier en
//     cours, fiche validée, motif) ;
//   - module pur, façade, branchements (espace ouvrier sans nouvelle page).
//
// Exemples issus des tests, données fictives : chantiers, noms, ouvrages et
// dates sont inventés. Aucune base, aucun réseau.
//   node scripts/verif-securite-accueil.mjs
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  partieRisques, comparerRisques, quiDoitResigner, etatSignatureAccueil, accueilParVersion, indexVersions,
  versionValideeCourante, etatAccueilOuvrier, lectureOuvrier, propositionsMiseAJour, preparerAMettreAJour,
  SIGNATURES_A_CHAQUE_VERSION, ENTREPRISE_OUVRIER,
} from "../src/Renovation/securiteAccueil.mjs";
import { contenuVersion } from "../src/Renovation/securiteVersion.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ─── Exemples issus des tests, données fictives ──────────────────────────────
const FICHE_ID = "11111111-2222-3333-4444-555555555555";
const ficheBase = (surcharges = {}) => ({
  id: FICHE_ID, chantier_id: "CH-FICTIF", version: 1, statut: "validee",
  intervenants: [{ type: "responsable", nom: "Responsable fictif", telephone: "0600000000" }, { type: "entreprise", id: "e1", nom: "Profero" }],
  donnees_base: { lots: ["electricite", "plomberie"], debut: "2026-12-01", fin: "2027-01-15", effectif: 2, logement_occupe: "non" },
  synthese_risques: ["Électricité", "Chute de hauteur"],
  reponses: {
    p4: { statut: "non_concerne" },
    p5: { statut: "concerne", cases: { pirl_prevues: true }, mesures: "PIRL fournie" },
    p6: { statut: "concerne", cases: { consignation: true, habilitation_verifiee: true } },
    p7: { statut: "non_concerne", statut_propose: "non_concerne", raison_proposition: "aucun lot poussières" },
    p8: { statut: "non_concerne" }, p9: { statut: "non_concerne" },
    p10: { statut: "concerne", cases: { chaussures: true, gants: true } },
    p11: { statut: "concerne", cases: { sanitaires_disponibles: true } },
    p12: { statut: "non_concerne" },
  },
  ...surcharges,
});
const figer = (fiche, motif = null) => contenuVersion({
  fiche, chantier: { id: "CH-FICTIF", nom: "Chantier fictif" },
  operation: { id: "OP-FICTIVE", nom: "Opération fictive", adresse: "1 rue Fictive" },
  clientLibelle: "Client fictif", batiment: null, justificatifs: [], motif,
});
const v1Contenu = figer(ficheBase());
// v2 : seulement le point 1 (nouvelle entreprise) et le point 2 (dates) changent.
const v2Points12 = figer(ficheBase({
  version: 2,
  intervenants: [...ficheBase().intervenants, { type: "entreprise", id: "e2", nom: "Sous-traitant fictif" }],
  donnees_base: { ...ficheBase().donnees_base, fin: "2027-02-01" },
  // traces sans effet sur les consignes : maj_le, statut_propose
  reponses: { ...ficheBase().reponses, p5: { ...ficheBase().reponses.p5, maj_le: "2026-12-02T10:00:00Z", maj_par: "Bureau fictif" } },
}), "Correction des dates");
// v2 : le point 7 devient concerné.
const v2Point7 = figer(ficheBase({
  version: 2, reponses: { ...ficheBase().reponses, p7: { statut: "concerne", cases: { masques_ffp3: true } } },
}), "Démolition ajoutée");
const sig = (version, empreinte, extra = {}) => ({ id: `s${version}${extra.id || ""}`, fiche_id: FICHE_ID, version, type: "accueil", signataire_nom: "Ouvrier fictif", empreinte_version: empreinte, signe_le: `2026-12-0${version}T08:00:00Z`, auth_user_id: "u-fictif", ...extra });
const V = (version, contenu, empreinte = `e${version}`, extra = {}) => ({ version, contenu, empreinte, empreinteVerifiee: true, ...extra });

// ─── Qui doit re-signer ──────────────────────────────────────────────────────
test("établie par + chef d'équipe re-signent à chaque version", () => {
  assert.deepEqual([...SIGNATURES_A_CHAQUE_VERSION], ["etablie_par", "chef_equipe"]);
  const r = quiDoitResigner({ contenuSigne: v1Contenu, contenuCourant: v2Points12 });
  assert.equal(r.etablie_par, true);
  assert.equal(r.chef_equipe, true);
});

test("accueil inchangé si seuls les points 1 et 2 (et les traces de saisie) changent", () => {
  const c = comparerRisques(v1Contenu, v2Points12);
  assert.equal(c.identiques, true);
  assert.equal(quiDoitResigner({ contenuSigne: v1Contenu, contenuCourant: v2Points12 }).accueil, false);
});

test("accueil à refaire si un point 3 à 12 change (le point modifié est nommé)", () => {
  const c = comparerRisques(v1Contenu, v2Point7);
  assert.equal(c.identiques, false);
  assert.deepEqual(c.points, [7]);
  const r = quiDoitResigner({ contenuSigne: v1Contenu, contenuCourant: v2Point7 });
  assert.equal(r.accueil, true);
  assert.match(r.raison, /point 7/);
  const synth = figer(ficheBase({ version: 2, synthese_risques: ["Électricité", "Poussières"] }), "x");
  assert.deepEqual(comparerRisques(v1Contenu, synth).points, [3]);
  const ordreCases = figer(ficheBase({ version: 2, reponses: { ...ficheBase().reponses, p6: { statut: "concerne", cases: { habilitation_verifiee: true, consignation: true } } } }), "x");
  assert.equal(comparerRisques(v1Contenu, ordreCases).identiques, true, "l'ordre des cases ne compte pas");
});

test("contenu illisible : comparaison impossible, accueil à refaire (jamais « valable » par défaut)", () => {
  assert.equal(partieRisques(null).ok, false);
  assert.equal(partieRisques({ format: "autre" }).ok, false);
  const c = comparerRisques({ format: "autre" }, v2Points12);
  assert.equal(c.identiques, null);
  assert.equal(quiDoitResigner({ contenuSigne: { format: "autre" }, contenuCourant: v2Points12 }).accueil, true);
});

// ─── État d'une signature d'accueil (bureau) ─────────────────────────────────
test("« signée sur la v1 » : reste valable ou à refaire selon les points 3 à 12", () => {
  const versionsOk = indexVersions([V(1, v1Contenu), V(2, v2Points12)]);
  const e1 = etatSignatureAccueil(sig(1, "e1"), { versionCourante: versionsOk[2], versions: versionsOk });
  assert.equal(e1.etat, "valable_anterieure");
  assert.equal(e1.valable, true);
  assert.match(e1.libelle, /signée sur la v1 — reste valable pour la v2/);
  const versionsKo = indexVersions([V(1, v1Contenu), V(2, v2Point7)]);
  const e2 = etatSignatureAccueil(sig(1, "e1"), { versionCourante: versionsKo[2], versions: versionsKo });
  assert.equal(e2.etat, "a_refaire");
  assert.equal(e2.valable, false);
  assert.match(e2.libelle, /signée sur la v1 — à refaire : point 7 modifié/);
  const e3 = etatSignatureAccueil(sig(2, "e2"), { versionCourante: versionsKo[2], versions: versionsKo });
  assert.equal(e3.etat, "valable");
  const e4 = etatSignatureAccueil(sig(2, "autre"), { versionCourante: versionsKo[2], versions: versionsKo });
  assert.equal(e4.etat, "non_retenue");
  const e5 = etatSignatureAccueil(sig(1, "e1"), { versionCourante: versionsKo[2], versions: indexVersions([V(2, v2Point7)]) });
  assert.equal(e5.etat, "non_verifiable");
  assert.equal(e5.valable, false);
});

test("liste du bureau : signatures d'accueil groupées par version, la plus récente d'abord", () => {
  const vs = indexVersions([V(1, v1Contenu), V(2, v2Point7)]);
  const g = accueilParVersion([sig(1, "e1"), sig(2, "e2"), { ...sig(2, "e2", { id: "b" }), auth_user_id: null }, { ...sig(1, "e1"), type: "chef_equipe", id: "c" }],
    { versionCourante: vs[2], versions: vs });
  assert.deepEqual(g.map((x) => x.version), [2, 1]);
  assert.equal(g[0].signatures.length, 2);
  assert.equal(g[1].signatures.length, 1, "seules les signatures d'accueil sont listées");
  assert.equal(versionValideeCourante({ statut: "brouillon", version: 2 }, vs), null);
  assert.equal(versionValideeCourante({ statut: "a_mettre_a_jour", version: 2 }, vs).version, 2);
});

// ─── Ce que voit l'ouvrier connecté ──────────────────────────────────────────
test("fiche absente ou non validée : « pas encore validée », pas de bouton", () => {
  const a = etatAccueilOuvrier({ fiche: null });
  assert.equal(a.peutSigner, false);
  assert.match(a.message, /pas encore validée/);
  const b = etatAccueilOuvrier({ fiche: ficheBase({ statut: "brouillon" }) });
  assert.equal(b.peutSigner, false);
  assert.match(b.message, /pas encore validée/);
  const c = etatAccueilOuvrier({ fiche: null, erreur: "réseau" });
  assert.equal(c.etat, "illisible");
  assert.equal(c.peutSigner, false);
  assert.equal(etatAccueilOuvrier({ fiche: ficheBase({ statut: "verrouillee" }) }).peutSigner, false);
});

test("fiche validée non signée : bouton « Signer l'accueil » ; signée : plus de bouton", () => {
  const f = ficheBase();
  const a = etatAccueilOuvrier({ fiche: f, versions: [V(1, v1Contenu)], mesSignatures: [] });
  assert.equal(a.etat, "a_signer");
  assert.equal(a.peutSigner, true);
  assert.equal(a.version.empreinte, "e1");
  const b = etatAccueilOuvrier({ fiche: f, versions: [V(1, v1Contenu)], mesSignatures: [sig(1, "e1")] });
  assert.equal(b.etat, "signee");
  assert.equal(b.peutSigner, false);
});

test("signature d'une version précédente : l'ouvrier voit si elle reste valable", () => {
  const f2 = ficheBase({ version: 2 });
  const ok = etatAccueilOuvrier({ fiche: f2, versions: [V(1, v1Contenu), V(2, v2Points12)], mesSignatures: [sig(1, "e1")] });
  assert.equal(ok.etat, "signee_anterieure_valable");
  assert.equal(ok.peutSigner, false);
  assert.match(ok.message, /signature de la v1 reste valable/);
  const ko = etatAccueilOuvrier({ fiche: f2, versions: [V(1, v1Contenu), V(2, v2Point7)], mesSignatures: [sig(1, "e1")] });
  assert.equal(ko.etat, "a_signer");
  assert.equal(ko.peutSigner, true);
  assert.match(ko.detail, /v1 n'est plus valable/);
});

test("version figée introuvable, empreinte fausse ou fiche « à mettre à jour » : pas de bouton", () => {
  assert.equal(etatAccueilOuvrier({ fiche: ficheBase(), versions: [] }).peutSigner, false);
  const faux = etatAccueilOuvrier({ fiche: ficheBase(), versions: [V(1, v1Contenu, "e1", { empreinteVerifiee: false })] });
  assert.equal(faux.etat, "illisible");
  assert.equal(faux.peutSigner, false);
  const amaj = etatAccueilOuvrier({ fiche: ficheBase({ statut: "a_mettre_a_jour" }), versions: [V(1, v1Contenu)] });
  assert.equal(amaj.etat, "a_mettre_a_jour");
  assert.equal(amaj.peutSigner, false);
});

test("lecture ouvrier : risques principaux puis consignes des points concernés", () => {
  const l = lectureOuvrier(v1Contenu);
  assert.equal(l.ok, true);
  assert.deepEqual(l.risques, ["Électricité", "Chute de hauteur"]);
  const p6 = l.points.find((p) => p.numero === 6);
  assert.ok(p6.consignes.includes("Habilitation électrique des intervenants vérifiée"));
  assert.ok(l.points.find((p) => p.numero === 5).mesures === "PIRL fournie");
  assert.ok(l.nonConcernes.includes("Amiante"));
  assert.ok(!l.points.some((p) => p.numero === 7));
  assert.equal(ENTREPRISE_OUVRIER, "Profero");
});

// ─── Mise à jour proposée ────────────────────────────────────────────────────
const RESS = { liste: [
  { nom: "Ouvrier fictif", nom_planning: "Ouvrier fictif", kind: "personne" },
  { nom: "Presta fictif", nom_planning: "Presta fictif", kind: "prestataire" },
], erreur: null };
const LOTS = [{ id: "demolition", label: "Démolition" }, { id: "electricite", label: "Électricité" }, { id: "plomberie", label: "Plomberie" }];
const ouv = (lot_id, libelle) => ({ lot_id, libelle, taches: [] });
const sources = (s = {}) => ({
  batiment: { ligne: null, erreur: null },
  phasage: { ouvrages: [ouv("electricite", "E-001 : Installation fictive"), ouv("plomberie", "P-001 : Réseau fictif")], erreur: null },
  planning: { cellules: [{ week_id: "2026-W50", jour: "Lundi", ouvriers: ["Ouvrier fictif"] }], erreur: null },
  planningOperation: { cellules: [], erreur: null },
  ressources: RESS, commandes: { lignes: [], erreur: null },
  ...s,
});
const JUSTIF_OK = [{ id: "j1", point: 6, type_code: "habilitation_electrique", expire_le: "2027-06-30" },
  { id: "j2", point: 10, type_code: "fiche_remise_epi", expire_le: null }];

test("rien de nouveau : aucune mise à jour proposée", () => {
  const r = propositionsMiseAJour({ fiche: ficheBase(), sources: sources(), lots: LOTS, justificatifs: JUSTIF_OK, aujourdhui: "2026-12-10" });
  assert.equal(r.applicable, true);
  assert.deepEqual(r.raisons, []);
  assert.deepEqual(r.impossibles, []);
  assert.equal(r.motif, "");
});

test("nouveau prestataire au planning : mise à jour proposée, motif pré-rempli", () => {
  const r = propositionsMiseAJour({
    fiche: ficheBase(), lots: LOTS, justificatifs: JUSTIF_OK, aujourdhui: "2026-12-10",
    sources: sources({ planning: { cellules: [{ week_id: "2026-W51", jour: "Mardi", ouvriers: ["Presta fictif"] }], erreur: null } }),
  });
  assert.deepEqual(r.raisons.map((x) => x.code), ["prestataire"]);
  assert.match(r.motif, /^Mise à jour proposée : nouveau prestataire « Presta fictif »/);
  // déjà au point 1 : rien
  const f = ficheBase({ intervenants: [...ficheBase().intervenants, { type: "entreprise", id: "e9", nom: "presta FICTIF" }] });
  const r2 = propositionsMiseAJour({ fiche: f, lots: LOTS, justificatifs: JUSTIF_OK, aujourdhui: "2026-12-10",
    sources: sources({ planning: { cellules: [{ week_id: "2026-W51", jour: "Mardi", ouvriers: ["Presta fictif"] }], erreur: null } }) });
  assert.deepEqual(r2.raisons, []);
});

test("lot ajouté au phasage qui change un statut proposé (réutilise le pré-remplissage)", () => {
  const r = propositionsMiseAJour({
    fiche: ficheBase(), lots: LOTS, justificatifs: JUSTIF_OK, aujourdhui: "2026-12-10",
    sources: sources({ phasage: { ouvrages: [ouv("electricite", "E-001 : Installation fictive"), ouv("plomberie", "P-001 : Réseau fictif"), ouv("demolition", "D-099 : Démolition fictive")], erreur: null } }),
  });
  const lot = r.raisons.find((x) => x.code === "lot");
  assert.ok(lot, "le lot Démolition doit être signalé");
  assert.match(lot.message, /Démolition ajouté au phasage : .*point 7/);
  // lot ajouté sans effet sur un statut (plomberie déjà présente, nouveau lot inconnu sans règle) : rien
  const r2 = propositionsMiseAJour({
    fiche: ficheBase(), lots: LOTS, justificatifs: JUSTIF_OK, aujourdhui: "2026-12-10",
    sources: sources({ phasage: { ouvrages: [ouv("electricite", "E-001 : Installation fictive"), ouv("plomberie", "P-001 : Réseau fictif"), ouv("lot_x", "X-001 : Peinture fictive")], erreur: null } }),
  });
  assert.equal(r2.raisons.filter((x) => x.code === "lot").length, 0);
});

test("justificatif requis expiré : mise à jour proposée ; illisible : signalé, jamais « rien »", () => {
  const exp = [{ ...JUSTIF_OK[0], expire_le: "2026-11-30" }, JUSTIF_OK[1]];
  const r = propositionsMiseAJour({ fiche: ficheBase(), sources: sources(), lots: LOTS, justificatifs: exp, aujourdhui: "2026-12-10" });
  assert.deepEqual(r.raisons.map((x) => x.code), ["justificatif"]);
  assert.match(r.raisons[0].message, /point 6/);
  const r2 = propositionsMiseAJour({ fiche: ficheBase(), sources: sources({ planning: { cellules: null, erreur: "réseau" } }), lots: LOTS, justificatifs: null, aujourdhui: "2026-12-10" });
  assert.equal(r2.impossibles.length, 2);
  assert.ok(r2.impossibles.some((m) => /planning illisible/.test(m)));
  assert.ok(r2.impossibles.some((m) => /justificatifs illisibles/.test(m)));
});

test("brouillon ou verrouillée : pas de « mise à jour proposée » (les divergences s'en chargent)", () => {
  assert.equal(propositionsMiseAJour({ fiche: ficheBase({ statut: "brouillon" }), sources: sources(), lots: LOTS, justificatifs: [] }).applicable, false);
  assert.equal(propositionsMiseAJour({ fiche: ficheBase({ statut: "verrouillee" }), sources: sources(), lots: LOTS, justificatifs: [] }).applicable, false);
});

test("« à mettre à jour » : seulement fiche validée, chantier en cours, motif ; jamais écrit par le module", () => {
  const ok = preparerAMettreAJour({ fiche: ficheBase(), chantier: { statut: "en_cours" }, motif: "Mise à jour proposée : test fictif", auteur: "Bureau fictif" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.patch, { statut: "a_mettre_a_jour", maj_par: "Bureau fictif" });
  assert.equal(ok.journal.nouveau_statut, "a_mettre_a_jour");
  assert.equal(ok.journal.evenement, "fiche_securite");
  assert.equal(preparerAMettreAJour({ fiche: ficheBase(), chantier: { statut: "planifie" }, motif: "motif valable" }).ok, false);
  assert.equal(preparerAMettreAJour({ fiche: ficheBase({ statut: "brouillon" }), chantier: { statut: "en_cours" }, motif: "motif valable" }).ok, false);
  assert.equal(preparerAMettreAJour({ fiche: ficheBase(), chantier: { statut: "en_cours" }, motif: "x" }).ok, false);
});

// ─── Module pur, façade, branchements ────────────────────────────────────────
test("module pur, façade, écrans branchés, aucune nouvelle page", () => {
  const src = sansCommentaires(lire("src/Renovation/securiteAccueil.mjs"));
  assert.doesNotMatch(src, /supabase|new Date|Date\.now|fetch\(|localStorage|setTimeout|setInterval/);
  assert.match(lire("src/Renovation/securiteAccueil.js"), /export \* from "\.\/securiteAccueil\.mjs"/);
  const dash = lire("src/Renovation/OuvrierDashboard.jsx");
  assert.match(dash, /<FicheSecuriteOuvrier /);
  const ouvrier = lire("src/Renovation/FicheSecuriteOuvrier.jsx");
  assert.match(ouvrier, /Signer l'accueil/);
  assert.match(ouvrier, /nomFige/);
  assert.match(ouvrier, /sansCompte: false/);
  assert.match(lire("src/Renovation/securiteValidation.mjs"), /Je reconnais avoir été informé des risques et des consignes de ce chantier\./);
  assert.doesNotMatch(lire("src/access.js"), /securite/i, "aucune page sécurité dans src/access.js");
  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  assert.match(donnees, /type: "accueil"/);
  assert.match(donnees, /sansCompte \? \{ auth_user_id: null \}/);
  // « à mettre à jour » : une seule écriture, conditionnée à une fiche encore validée
  assert.match(donnees, /update\(prep\.patch\)\s*\n?\s*\.eq\("id", fiche\.id\)\.eq\("statut", "validee"\)\.eq\("version", fiche\.version\)/);
  assert.equal((donnees.match(/a_mettre_a_jour/g) || []).length, 0, "le statut n'est écrit que via le patch préparé par le module pur");
  const fiche = lire("src/Renovation/FicheSecuriteChantier.jsx");
  assert.match(fiche, /Mise à jour proposée/);
  assert.match(fiche, /window\.confirm\(`Marquer la fiche/);
  assert.ok(existsSync(join(racine, ".github/workflows/verify-securite-accueil.yml")));
});

console.log(`\n${n} vérifications passées (exemples issus des tests, données fictives).`);
