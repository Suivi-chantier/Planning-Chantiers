#!/usr/bin/env node
// Vérifie la validation de la fiche de préparation sécurité (tâche 4 du projet
// docs/projets/fiche-securite-chantier.md) :
//   - règles strictes de validation (securiteValidation.mjs), différentes du
//     « n/12 » d'avancement ;
//   - cas amiante : permis antérieur au 1/7/1997 sans repérage reçu = refus ;
//   - justificatifs requis, signatures liées à l'empreinte du contenu ;
//   - sérialisation canonique stable et empreinte sha256 (securiteVersion.mjs) ;
//   - « Mettre à jour », journal du chantier, chemins de stockage ;
//   - branchement de l'écran et de la couche données (lecture statique).
//
// Exemples issus des tests, données fictives : fiches, noms, dates et
// documents sont inventés pour le calcul. Aucune base, aucun réseau.
//   node scripts/verif-securite-validation.mjs
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { POINTS_FICHE, LIBELLES_JUSTIFICATIFS } from "../src/Renovation/securite/points.mjs";
import { compterPointsCompletes } from "../src/Renovation/securiteFiche.mjs";
import { pastilleFicheSecurite } from "../src/Renovation/securitePastilles.mjs";
import {
  etatValidation, manquantsDuPoint, blocageAmiante, justificatifsRequisManquants, justificatifsPourPastille,
  etatSignature, libelleSignature, preparerJustificatif, typesJustificatifPoint, estExpire, TEXTE_ENGAGEMENT,
  SIGNATURES_REQUISES,
} from "../src/Renovation/securiteValidation.mjs";
import {
  serialisationCanonique, contenuVersion, motifDepuisJournal, entreeJournalValidation, entreeJournalMiseAJour,
  preparerMiseAJour, dossierJustificatifs, cheminSignature, estEmpreinte, BUCKET_PREUVES, EVENEMENT_JOURNAL,
} from "../src/Renovation/securiteVersion.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (f) => readFileSync(join(racine, f), "utf8");
const sansCommentaires = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const sha = (t) => createHash("sha256").update(t, "utf8").digest("hex");

let n = 0;
async function test(nom, fn) { await fn(); n++; console.log("ok -", nom); }

// ─── Exemples issus des tests, données fictives ──────────────────────────────
const AUJ = "2026-11-25";
const FICHE_ID = "11111111-2222-3333-4444-555555555555";
const repCarte = (statut = "non_concerne", extra = {}) => ({ statut, ...extra });
const ficheComplete = () => ({
  id: FICHE_ID, chantier_id: "c-test", version: 1, statut: "brouillon",
  updated_at: "2026-11-25T10:00:00.000000+00:00",
  intervenants: [
    { type: "responsable", nom: "Responsable Fictif", telephone: "0600000000" },
    { type: "entreprise", id: "e1", nom: "Entreprise Fictive", activite: "plâtrerie" },
  ],
  donnees_base: { lots: ["platrerie"], date_debut: "2026-12-01", date_fin: "2027-01-15", effectif_max: 3, site_occupe: false },
  synthese_risques: ["Chute de hauteur — PIRL", "Poussières — FFP3"],
  reponses: {
    p4: repCarte(), p5: repCarte(), p6: repCarte("concerne", { cases: { consignation: true } }),
    p7: repCarte(), p8: repCarte(), p9: repCarte(),
    p10: repCarte("concerne", { mesures: "Chaussures et gants fournis" }), p11: repCarte("concerne", { cases: { sanitaires_disponibles: true } }), p12: repCarte(),
  },
});
const batimentRecent = { date_permis_construire: "2005-03-01", avant_1997: false, avant_1949: false, copropriete: true, etage: 2, ascenseur_utilisable: true, reperage_amiante_statut: "non_requis", notes: null };
const justif = (point, type_code, extra = {}) => ({ id: `j-${point}-${type_code}-${extra.suffixe || "1"}`, portee: "chantier", chantier_id: "c-test", point, type_code, fichier_path: `securite/chantiers/c-test/p${point}/x.pdf`, fichier_nom: "x.pdf", date_document: "2026-11-01", expire_le: null, archive_le: null, ...extra });
const justifsComplets = () => [justif(6, "habilitation_electrique", { expire_le: "2027-06-30" }), justif(10, "fiche_remise_epi")];
const ctx = (extra = {}) => ({ adresse: "1 rue Fictive", batiment: batimentRecent, batimentErreur: null, clientErreur: null, motifTrouve: true, ...extra });
const sig = (type, empreinte, version = 1, extra = {}) => ({ id: `s-${type}-${version}-${empreinte.slice(0, 4)}`, fiche_id: FICHE_ID, version, type, signataire_nom: "Signataire Fictif", empreinte_version: empreinte, signe_le: "2026-11-25T11:00:00Z", ...extra });
const H = "a".repeat(64), H2 = "b".repeat(64);
const deuxSignatures = (h = H) => [sig("etablie_par", h), sig("chef_equipe", h)];

await test("1. fiche complète, signée sur l'empreinte du contenu : validable", () => {
  const e = etatValidation({ fiche: ficheComplete(), contexte: ctx(), justificatifs: justifsComplets(), signatures: deuxSignatures(), empreinte: H, aujourdhui: AUJ });
  assert.deepEqual(e.pointsIncomplets, []);
  assert.deepEqual(e.justificatifsManquants, []);
  assert.deepEqual(e.bloquants, []);
  assert.equal(e.contenuComplet, true);
  assert.equal(e.peutSigner, true);
  assert.equal(e.peutValider, true);
  assert.equal(e.resume, "12/12 renseignés, prête à valider");
});

await test("2. « n/12 » (indicateur) ≠ règle stricte : 12/12 renseignés mais non validable, écrit à l'écran", () => {
  const f = ficheComplete();
  f.intervenants = [{ type: "responsable", nom: "Responsable Fictif" }];   // pas de téléphone, pas d'entreprise
  f.synthese_risques = ["Un seul risque"];
  assert.equal(compterPointsCompletes(f), 12, "la vue compterait 12/12");
  const e = etatValidation({ fiche: f, contexte: ctx(), justificatifs: justifsComplets(), signatures: deuxSignatures(), empreinte: H, aujourdhui: AUJ });
  assert.equal(e.peutValider, false);
  assert.deepEqual(e.pointsIncomplets.map((p) => p.numero), [1, 3]);
  assert.equal(e.nbManquants, 3);
  assert.equal(e.resume, "12/12 renseignés, 3 éléments manquants pour valider");
  assert.equal(e.peutSigner, false, "on ne signe pas une fiche incomplète");
});

await test("3. règle stricte point par point (1, 2, 3, cartes)", () => {
  const p = (num) => POINTS_FICHE.find((x) => x.numero === num);
  const f = ficheComplete();
  assert.deepEqual(manquantsDuPoint(p(1), f, { adresse: "" }), ["adresse du chantier (à saisir sur l'opération)"]);
  f.intervenants.push({ type: "entreprise", id: "e2", nom: " " });
  assert.ok(manquantsDuPoint(p(1), f, { adresse: "x" }).includes("nom d'une entreprise saisie"));
  const d = ficheComplete();
  d.donnees_base = { lots: [], date_debut: "2026-12-10", date_fin: "2026-12-01", effectif_max: 0 };
  assert.deepEqual(manquantsDuPoint(p(2), d), ["lots prévus", "date de fin postérieure au début", "effectif maximum", "logement occupé : oui ou non"]);
  const c = ficheComplete();
  c.reponses.p5 = { statut: "concerne" };
  c.reponses.p7 = { statut: "a_completer" };
  delete c.reponses.p8;
  c.reponses.p9 = { statut: "bizarre" };
  assert.deepEqual(manquantsDuPoint(p(5), c), ["au moins une case cochée ou une mesure retenue"]);
  assert.deepEqual(manquantsDuPoint(p(7), c), ["« Concerné » ou « Non concerné » à choisir"]);
  assert.deepEqual(manquantsDuPoint(p(8), c), ["« Concerné » ou « Non concerné » à choisir"]);
  assert.deepEqual(manquantsDuPoint(p(9), c), ["statut inconnu (bizarre)"]);
  assert.deepEqual(manquantsDuPoint(p(4), c), [], "non concerné suffit");
});

await test("4. amiante : permis avant le 1/7/1997 sans repérage reçu = validation refusée (critère d'acceptation)", () => {
  const ancien = { ...batimentRecent, date_permis_construire: "1975-05-01", avant_1997: true, avant_1949: false };
  for (const statut of ["a_completer", "non_requis", "a_demander", "demande"]) {
    const b = { ...ancien, reperage_amiante_statut: statut };
    assert.match(blocageAmiante({ batiment: b }), /permis antérieur au 1er juillet 1997/, statut);
    const f = ficheComplete();
    f.reponses.p4 = { statut: "concerne", cases: { reperage_consulte: true } };
    const e = etatValidation({ fiche: f, contexte: ctx({ batiment: b }), justificatifs: [...justifsComplets(), justif(4, "reperage_amiante")], signatures: deuxSignatures(), empreinte: H, aujourdhui: AUJ });
    assert.equal(e.peutValider, false, statut);
    assert.equal(e.peutSigner, false, statut);
  }
  for (const statut of ["recu_sans_amiante", "recu_amiante_present"]) assert.equal(blocageAmiante({ batiment: { ...ancien, reperage_amiante_statut: statut } }), null, statut);
  assert.equal(blocageAmiante({ batiment: batimentRecent }), null, "permis 2005");
  // Date inconnue : on ne sait pas → bloquant (impossibilité visible), sauf repérage reçu.
  assert.match(blocageAmiante({ batiment: null }), /date du permis de construire non renseignée/);
  assert.match(blocageAmiante({ batiment: { ...batimentRecent, date_permis_construire: null, avant_1997: null } }), /non renseignée/);
  assert.equal(blocageAmiante({ batiment: { date_permis_construire: null, avant_1997: null, reperage_amiante_statut: "recu_sans_amiante" } }), null);
  assert.match(blocageAmiante({ batiment: null, erreur: "réseau" }), /illisibles/);
});

await test("5. justificatifs requis : absent, expiré, archivé, mauvais point, point non concerné", () => {
  const f = ficheComplete();
  const req = (j) => justificatifsRequisManquants({ reponses: f.reponses, justificatifs: j, aujourdhui: AUJ });
  assert.deepEqual(req(justifsComplets()), []);
  assert.deepEqual(req([justif(10, "fiche_remise_epi")]).map((m) => [m.numero, m.type_code, m.raison]), [[6, "habilitation_electrique", "absent"]]);
  assert.deepEqual(req([justif(6, "habilitation_electrique", { expire_le: "2026-11-24" }), justif(10, "fiche_remise_epi")]).map((m) => m.raison), ["expire"]);
  assert.equal(req([justif(6, "habilitation_electrique", { expire_le: AUJ }), justif(10, "fiche_remise_epi")]).length, 0, "valable le jour même");
  assert.equal(req([justif(6, "habilitation_electrique", { archive_le: "2026-11-20T00:00:00Z" }), justif(10, "fiche_remise_epi")]).length, 1, "archivé = retiré");
  assert.equal(req([justif(7, "habilitation_electrique"), justif(10, "fiche_remise_epi")]).length, 1, "joint au mauvais point");
  assert.equal(req(null), null, "illisible ≠ aucun manquant");
  // p4 non concerné : le repérage n'est pas exigé ; concerné : il l'est.
  assert.ok(!req(justifsComplets()).some((m) => m.numero === 4));
  f.reponses.p4 = { statut: "concerne", cases: { reperage_consulte: true } };
  assert.deepEqual(req(justifsComplets()).map((m) => m.type_code), ["reperage_amiante"]);
  assert.equal(estExpire({ expire_le: "2026-11-24" }, AUJ), true);
  assert.equal(estExpire({ expire_le: null }, AUJ), false);
  const e = etatValidation({ fiche: ficheComplete(), contexte: ctx(), justificatifs: [justif(10, "fiche_remise_epi")], signatures: deuxSignatures(), empreinte: H, aujourdhui: AUJ });
  assert.equal(e.peutValider, false);
  const illisible = etatValidation({ fiche: ficheComplete(), contexte: ctx(), justificatifs: null, signatures: deuxSignatures(), empreinte: H, aujourdhui: AUJ });
  assert.ok(illisible.bloquants.some((m) => /Justificatifs illisibles/.test(m)));
});

await test("6. signatures : version ET empreinte du contenu ; « signée sur la v1 »", () => {
  const f = ficheComplete();
  assert.equal(etatSignature({ signatures: deuxSignatures(), type: "etablie_par", fiche: f, empreinte: H }).etat, "signee");
  assert.equal(etatSignature({ signatures: deuxSignatures(H2), type: "etablie_par", fiche: f, empreinte: H }).etat, "contenu_modifie");
  assert.equal(etatSignature({ signatures: [], type: "chef_equipe", fiche: f, empreinte: H }).etat, "a_signer");
  const v2 = { ...f, version: 2 };
  assert.equal(etatSignature({ signatures: deuxSignatures(), type: "etablie_par", fiche: v2, empreinte: H }).etat, "a_signer", "signature de la v1 ne vaut pas pour la v2");
  // Contenu modifié après signature → re-signer ; la nouvelle signature compte.
  const e1 = etatValidation({ fiche: f, contexte: ctx(), justificatifs: justifsComplets(), signatures: deuxSignatures(H2), empreinte: H, aujourdhui: AUJ });
  assert.equal(e1.peutValider, false);
  assert.ok(e1.signaturesManquantes.every((m) => /à refaire/.test(m)));
  const e2 = etatValidation({ fiche: f, contexte: ctx(), justificatifs: justifsComplets(), signatures: [...deuxSignatures(H2), ...deuxSignatures(H).map((s) => ({ ...s, id: `${s.id}-bis`, signe_le: "2026-11-25T12:00:00Z" }))], empreinte: H, aujourdhui: AUJ });
  assert.equal(e2.peutValider, true);
  const une = etatValidation({ fiche: f, contexte: ctx(), justificatifs: justifsComplets(), signatures: [sig("etablie_par", H)], empreinte: H, aujourdhui: AUJ });
  assert.deepEqual(une.signaturesManquantes, ["Signature « Chef d'équipe »"]);
  const sansEmpreinte = etatValidation({ fiche: f, contexte: ctx(), justificatifs: justifsComplets(), signatures: deuxSignatures(), empreinte: null, aujourdhui: AUJ });
  assert.equal(sansEmpreinte.peutValider, false, "empreinte non calculée = non vérifiable");
  assert.equal(libelleSignature(sig("etablie_par", H, 1), { fiche: v2 }), "signée sur la v1");
  assert.equal(libelleSignature(sig("etablie_par", H, 2), { fiche: v2, empreintesVersions: { 2: H } }), "signée sur la v2 (version validée)");
  assert.match(libelleSignature(sig("etablie_par", H2, 2), { fiche: v2, empreinteCourante: H }), /contenu antérieur de la v2/);
  assert.deepEqual(SIGNATURES_REQUISES.map((s) => s.type), ["etablie_par", "chef_equipe"]);
  assert.equal(TEXTE_ENGAGEMENT, "Je reconnais avoir été informé des risques et des consignes de ce chantier.");
});

await test("7. sérialisation canonique : stable quel que soit l'ordre des clés", () => {
  assert.equal(serialisationCanonique({ b: 1, a: [2, { d: null, c: "é" }], z: undefined }), '{"a":[2,{"c":"é","d":null}],"b":1}');
  assert.equal(serialisationCanonique({ x: { b: true, a: "1" } }), serialisationCanonique({ x: { a: "1", b: true } }));
  assert.notEqual(serialisationCanonique([1, 2]), serialisationCanonique([2, 1]), "l'ordre d'une liste compte");
  for (const mauvais of [NaN, Infinity, new Date(0), () => 1]) assert.throws(() => serialisationCanonique({ v: mauvais }));
  assert.equal(serialisationCanonique("guillemet \" et \\ et \n"), JSON.stringify("guillemet \" et \\ et \n"));
});

await test("8. contenu figé et empreinte sha256 déterministes", async () => {
  const base = { fiche: ficheComplete(), chantier: { id: "c-test", nom: "CHANTIER FICTIF" }, operation: { id: "op-test", nom: "OPÉRATION FICTIVE", adresse: "1 rue Fictive" }, clientLibelle: "Client Fictif", batiment: { ...batimentRecent, updated_at: "x", maj_par: "y" }, justificatifs: justifsComplets(), motif: null };
  const c1 = contenuVersion(base);
  // Même contenu, clés dans un autre ordre, updated_at différent, justificatifs dans l'autre sens, un justificatif archivé en plus.
  const f2 = ficheComplete();
  const melange = (o) => Object.fromEntries(Object.entries(o).reverse());
  const c2 = contenuVersion({ ...base, fiche: { ...melange(f2), donnees_base: melange(f2.donnees_base), updated_at: "2027-01-01" }, batiment: melange(batimentRecent), justificatifs: [...justifsComplets().reverse(), justif(5, "photo", { archive_le: "2026-11-20" })] });
  const t1 = serialisationCanonique(c1), t2 = serialisationCanonique(c2);
  assert.equal(t1, t2);
  assert.ok(!/updated_at|maj_par|archive_le/.test(t1), "rien de volatil dans le contenu figé");
  assert.equal(c1.version, 1);
  assert.equal(c1.format, "fiche-securite-v2");
  assert.equal(c1.justificatifs.length, 2);
  // Web Crypto (navigateur) et sha256 de Node donnent la même empreinte, accents compris.
  const wc = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(t1))).toString("hex");
  assert.equal(wc, sha(t1));
  assert.ok(estEmpreinte(wc));
  // Toute modification change l'empreinte : une case, le motif, un justificatif, le bâtiment.
  const f3 = ficheComplete(); f3.reponses.p6.cases.dict_faite = true;
  for (const autre of [{ fiche: f3 }, { motif: "Nouveau sous-traitant" }, { justificatifs: [...justifsComplets(), justif(5, "photo")] }, { batiment: { ...batimentRecent, etage: 3 } }, { clientLibelle: "Autre client" }]) {
    assert.notEqual(sha(serialisationCanonique(contenuVersion({ ...base, ...autre }))), sha(t1), Object.keys(autre)[0]);
  }
  assert.notEqual(sha(serialisationCanonique(contenuVersion({ ...base, fiche: { ...ficheComplete(), version: 2 } }))), sha(t1), "version");
  assert.throws(() => contenuVersion({ ...base, justificatifs: null }), /illisible/);
});

await test("9. « Mettre à jour » : motif obligatoire, version + 1, retour en brouillon ; journal et motif relu", () => {
  const validee = { ...ficheComplete(), statut: "validee", validee_le: "2026-11-25T12:00:00Z" };
  assert.equal(preparerMiseAJour(validee, "").ok, false);
  assert.equal(preparerMiseAJour(validee, "abc").ok, false);
  const m = preparerMiseAJour(validee, "Nouveau sous-traitant électricité");
  assert.deepEqual(m.patch, { version: 2, statut: "brouillon", validee_le: null, validee_par: null });
  assert.equal(preparerMiseAJour({ ...validee, statut: "a_mettre_a_jour" }, "Motif valable").ok, true);
  assert.equal(preparerMiseAJour({ ...validee, statut: "brouillon" }, "Motif valable").ok, false);
  assert.equal(preparerMiseAJour({ ...validee, statut: "brouillon" }, "Motif valable", { versionDejaFigee: true }).ok, true);
  assert.equal(preparerMiseAJour({ ...validee, statut: "verrouillee" }, "Motif valable").ok, false);
  const j = entreeJournalMiseAJour({ chantierId: "c-test", versionAvant: 1, auteur: "Auteur Fictif", motif: "  Nouveau sous-traitant  " });
  assert.equal(j.evenement, "fiche_securite");
  assert.equal(j.motif, "Nouveau sous-traitant");
  assert.deepEqual([j.ancien_statut, j.nouveau_statut], ["validee", "brouillon"]);
  const lignes = [{ ...j, le: "2026-11-25T13:00:00Z" }, { ...entreeJournalValidation({ chantierId: "c-test", version: 1, empreinte: H }), le: "2026-11-25T12:00:00Z" }];
  assert.deepEqual(motifDepuisJournal(lignes, 2), { motif: "Nouveau sous-traitant", trouve: true });
  assert.deepEqual(motifDepuisJournal(lignes, 3), { motif: null, trouve: false }, "motif de la v3 absent = introuvable, pas « sans motif »");
  assert.deepEqual(motifDepuisJournal([], 1), { motif: null, trouve: true });
  const plusRecent = { ...j, motif: "Deuxième essai", le: "2026-11-25T14:00:00Z" };
  assert.equal(motifDepuisJournal([...lignes, plusRecent], 2).motif, "Deuxième essai");
  const v = entreeJournalValidation({ chantierId: "c-test", version: 2, auteur: "A", empreinte: H });
  assert.deepEqual([v.evenement, v.ancien_statut, v.nouveau_statut], ["fiche_securite", "brouillon", "validee"]);
  assert.match(v.detail, /v2 validée \(empreinte aaaaaaaaaaaa…\)/);
  const e = etatValidation({ fiche: { ...ficheComplete(), version: 2 }, contexte: ctx({ motifTrouve: false }), justificatifs: justifsComplets(), signatures: [], empreinte: H, aujourdhui: AUJ });
  assert.ok(e.bloquants.some((x) => /Motif de la mise à jour de la v2 introuvable/.test(x)));
});

await test("10. ajout d'un justificatif : contrôles ; aptitude médicale jamais au niveau chantier", () => {
  const p4 = POINTS_FICHE[3];
  assert.ok(!typesJustificatifPoint(p4).includes("aptitude_medicale"));
  assert.ok(typesJustificatifPoint(p4).includes("reperage_amiante"));
  for (const p of POINTS_FICHE) {
    const t = typesJustificatifPoint(p);
    assert.ok(t.includes("photo") && t.includes("autre"), `point ${p.numero}`);
    t.forEach((x) => assert.ok(x in LIBELLES_JUSTIFICATIFS, x));
  }
  const ok = preparerJustificatif({ chantierId: "c-test", point: p4, form: { type_code: "reperage_amiante", date_document: "2026-10-01", expire_le: "" }, aFichier: true });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ligne, { portee: "chantier", chantier_id: "c-test", operation_id: null, point: 4, type_code: "reperage_amiante", date_document: "2026-10-01", expire_le: null, personne: null, entreprise_nom: null, confidentiel: false });
  const ko = (form, aFichier = true) => preparerJustificatif({ chantierId: "c-test", point: p4, form, aFichier });
  assert.match(ko({ type_code: "aptitude_medicale" }).erreurs.join(), /espace entreprise/);
  assert.match(ko({ type_code: "kbis" }).erreurs.join(), /non prévu/);
  assert.match(ko({ type_code: "photo" }, false).erreurs.join(), /fichier/);
  assert.match(ko({ type_code: "photo", date_document: "2026-02-30" }).erreurs.join(), /invalide/);
  assert.match(ko({ type_code: "photo", date_document: "2026-10-01", expire_le: "2026-09-01" }).erreurs.join(), /avant la date du document/);
});

await test("11. chemins de stockage : décision de la tâche 1", () => {
  assert.equal(dossierJustificatifs("c-test", 6), "securite/chantiers/c-test/p6");
  assert.throws(() => dossierJustificatifs("../x", 6));
  assert.throws(() => dossierJustificatifs("c-test", 13));
  const ch = cheminSignature({ ficheId: FICHE_ID, version: 2, type: "chef_equipe", horodatage: 1764064800000, alea: "ab12cd34" });
  assert.equal(ch, `signatures/${FICHE_ID}/v2-chef_equipe-1764064800000-ab12cd34.png`);
  assert.throws(() => cheminSignature({ ficheId: "pas-un-uuid", version: 1, type: "etablie_par", horodatage: 1, alea: "a" }));
  assert.equal(BUCKET_PREUVES, "securite-preuves");
  assert.equal(EVENEMENT_JOURNAL, "fiche_securite");
});

await test("12. pastille rouge : même règle que la fiche, jamais de rouge inventé", () => {
  const f = ficheComplete();
  const pj = justificatifsPourPastille({ reponses: f.reponses, justificatifs: [justif(10, "fiche_remise_epi")], aujourdhui: AUJ });
  assert.deepEqual(pj, { manquants: 1, expires: 0 });
  const ligneVue = { fiche_id: FICHE_ID, chantier_id: "c-test", version: 1, statut: "brouillon", points_completes: 12 };
  const chantier = { id: "c-test", statut: "planifie" };
  assert.equal(pastilleFicheSecurite({ chantier, fiche: ligneVue, justificatifs: pj }).code, "justificatifs_manquants");
  const exp = justificatifsPourPastille({ reponses: f.reponses, justificatifs: [justif(6, "habilitation_electrique", { expire_le: "2026-01-01" }), justif(10, "fiche_remise_epi")], aujourdhui: AUJ });
  assert.deepEqual(exp, { manquants: 1, expires: 1 });
  assert.equal(pastilleFicheSecurite({ chantier, fiche: { ...ligneVue, statut: "validee" }, justificatifs: exp }).code, "expire");
  assert.equal(pastilleFicheSecurite({ chantier, fiche: { ...ligneVue, statut: "validee" }, justificatifs: pj }).code, "validee");
  assert.equal(justificatifsPourPastille({ reponses: f.reponses, justificatifs: null, aujourdhui: AUJ }), null);
  assert.equal(pastilleFicheSecurite({ chantier, fiche: ligneVue, justificatifs: null }).code, "brouillon");
});

await test("13. modules purs, façades, branchement de l'écran et de la couche données", () => {
  for (const f of ["src/Renovation/securiteValidation.mjs", "src/Renovation/securiteVersion.mjs"]) {
    const src = sansCommentaires(lire(f));
    assert.ok(!/supabase|new Date\(\)|Date\.now|Math\.random|fetch\(|localStorage|window\.|crypto\./.test(src), `${f} : module pur`);
  }
  assert.match(lire("src/Renovation/securiteValidation.js"), /export \* from "\.\/securiteValidation\.mjs";/);
  assert.match(lire("src/Renovation/securiteVersion.js"), /export \* from "\.\/securiteVersion\.mjs";/);

  const donnees = sansCommentaires(lire("src/Renovation/securiteDonnees.js"));
  assert.ok(!/\.delete\(/.test(donnees), "aucune suppression en base");
  assert.match(donnees, /\.update\(\{ archive_le: new Date\(\)\.toISOString\(\) \}\)/, "retrait = archivage");
  assert.match(donnees, /from\("securite_fiches_versions"\)\.insert\(\{[\s\S]*?contenu: a\.contenu[\s\S]*?empreinte: a\.empreinte/, "version figée avec l'empreinte recalculée");
  assert.match(donnees, /empreinte_version: a\.empreinte/, "signature sur l'empreinte relue en base");
  assert.match(donnees, /a\.empreinte !== empreinteAttendue/, "signature refusée si le contenu a changé");
  assert.match(donnees, /\.eq\("statut", "brouillon"\)\.eq\("version", a\.fiche\.version\)\.eq\("updated_at", a\.fiche\.updated_at\)/, "validation seulement sur le contenu relu");
  assert.match(donnees, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(donnees, /serialisationCanonique\(contenu\)/);
  assert.match(donnees, /journaliserStatut\(entreeJournalValidation/);
  assert.match(donnees, /journaliserStatut\(entreeJournalMiseAJour/);
  assert.match(donnees, /justificatifsPourPastille\(/, "pastille : même règle que la fiche");
  // Tâche 5 : pdf_path n'est écrit que par enregistrerPdfVersion, et seulement s'il est vide.
  assert.equal((donnees.match(/pdf_path\s*:/g) || []).length, 1, "pdf_path écrit à un seul endroit");
  assert.match(donnees, /\.update\(\{ pdf_path: chemin \}\)\.eq\("id", ligne\.id\)\.is\("pdf_path", null\)/, "pdf_path renseigné une seule fois");

  const stockage = sansCommentaires(lire("src/Renovation/storageChantier.js"));
  assert.match(stockage, /BUCKET_PREUVES_SECURITE = "securite-preuves"/);
  const depot = stockage.slice(stockage.indexOf("deposerPreuveSecurite"));
  assert.match(depot, /upsert: false/, "jamais de remplacement d'une preuve");

  const ecran = sansCommentaires(lire("src/Renovation/FicheSecuriteChantier.jsx"));
  assert.match(ecran, /etatValidation\(\{/);
  assert.match(ecran, /disabled=\{!etat\.peutValider/, "bouton Valider actif seulement si validable");
  assert.match(ecran, /\{etat\.resume\}/, "« n/12 renseignés, k éléments manquants » affiché");
  assert.match(ecran, /<SignatureFicheSecurite /);
  assert.ok(!/storage\.from/.test(ecran), "stockage seulement via la couche données");
  const sign = sansCommentaires(lire("src/Renovation/SignatureFicheSecurite.jsx"));
  assert.match(sign, /\{TEXTE_ENGAGEMENT\}/);
  assert.match(sign, /toBlob\(ok, "image\/png"\)/);

  const panneau = lire("src/Renovation/FicheSecuriteOperation.jsx");
  assert.match(panneau, /justificatifs: justifs\.parChantier\[c\.id\] \|\| null/);
  assert.ok(!/securite/i.test(lire("src/access.js")), "aucune page « sécurité » dans access.js");
});

await test("14. cohérence avec la migration (colonnes, immuabilité, policy ouvrier sur l'empreinte)", () => {
  const dir = join(racine, "supabase/migrations");
  const f = readdirSync(dir).find((x) => /_securite_fiches_chantier\.sql$/.test(x));
  const sql = readFileSync(join(dir, f), "utf8");
  for (const col of ["empreinte_version", "image_path", "signataire_entreprise", "auth_user_id"]) assert.ok(sql.includes(col), col);
  assert.match(sql, /unique \(fiche_id, version\)/, "une seule version figée par numéro");
  assert.match(sql, /v\.empreinte = securite_signatures\.empreinte_version/, "la signature d'accueil (tâche 8) exige l'empreinte de la version figée");
  assert.match(sql, /auth_user_id is null or auth_user_id = \(select auth\.uid\(\)\)/, "signature au bureau : compte vide ou soi-même");
  assert.match(sql, /check \(statut <> 'validee' or validee_le is not null\)/);
});

console.log(`\n${n} vérifications « Fiche sécurité : validation, signatures, versions » réussies (exemples issus des tests, données fictives).`);
