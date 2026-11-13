// Vérifie le lot 2 de la Refonte Opérations : statuts « À l'étude » et
// « Perdu », bascule à la signature, statut d'opération calculé, liste UNIQUE
// des règles de saisie (formulaires + contrôle d'avant-envoi), migration
// additive. Aucun réseau, aucune base : données fictives construites ici, plus
// lecture des sources du dépôt.
//   node scripts/verif-refonte-lot2.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { estChantierActif, STATUTS_HORS_EXPLOITATION } from "../src/Renovation/chantierActif.mjs";
import {
  STATUTS_AFFICHAGE, STATUTS_CHOIX_MANUEL, ETAPE_SIGNATURE, decisionBasculeSignature, statutOperation,
  validerMotifPerte, preparerPerte, preparerAnnulationPerte, peutMarquerPerdu, estChantierPerdu,
  clientEffectif, chargeAffairesEffectif, MOTIFS_PERTE,
} from "../src/Renovation/statutsChantier.mjs";
import {
  REGLES_SAISIE, controlerFiche, estObligatoire, estObligatoireProjet, manquantsAvantDevis, clientDepuisProjet,
  projetDepuisClient, ecartsClientProjet, genererCodeClient, genererCodeChantierProgbat, genererNomChantierProgbat, normaliserCode,
} from "../src/Renovation/reglesSaisieProgbat.mjs";
import { construireEnTeteDevis } from "../src/Renovation/progbatQuotePayload.mjs";
import { CYCLE_VIE_ETAPES } from "../src/Renovation/cycleVie.mjs";
import { calculerEcritures, depuisLigneChantier, versChampsChantier } from "../src/Renovation/chantiersTables.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (rel) => readFileSync(join(racine, rel), "utf8");
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

let n = 0;
function test(nom, fn) { fn(); n++; console.log("ok -", nom); }

// ─── 1. Modules purs ────────────────────────────────────────────────────────
test("1. modules purs (ni Supabase, ni horloge) et façades .js", () => {
  for (const f of ["src/Renovation/statutsChantier.mjs", "src/Renovation/reglesSaisieProgbat.mjs"]) {
    const s = sansCommentaires(lire(f));
    assert.ok(!/supabase/i.test(s), `${f} : aucun accès Supabase`);
    assert.ok(!/Date\.now\s*\(|new Date\(\s*\)/.test(s), `${f} : aucune horloge`);
    assert.ok(!/\.from\s*\(\s*["']|\.rpc\s*\(/.test(s), `${f} : aucun accès base`);
    const facade = f.replace(/\.mjs$/, ".js");
    assert.match(lire(facade), new RegExp(`export \\* from "\\./${f.split("/").pop().replace(".", "\\.")}"`), facade);
  }
  assert.ok(!/^import /m.test(lire("src/Renovation/reglesSaisieProgbat.mjs")), "règles : aucun import (copiées telles quelles dans l'Edge Function)");
});

// ─── 2. Statuts ─────────────────────────────────────────────────────────────
test("2. À l'étude et Perdu : invisibles partout sauf les listes complètes", () => {
  assert.deepEqual([...STATUTS_HORS_EXPLOITATION], ["a_l_etude", "perdu"]);
  for (const statut of ["a_l_etude", "perdu"]) {
    assert.equal(estChantierActif({ id: "x", statut }), false);
    assert.equal(estChantierActif({ id: "x", statut }, { inclureTermines: true }), false);
    assert.ok(STATUTS_AFFICHAGE[statut]?.label && STATUTS_AFFICHAGE[statut]?.color, `${statut} : libellé et couleur`);
  }
  assert.ok(!STATUTS_CHOIX_MANUEL.includes("perdu"), "« Perdu » seulement par le bouton (motif obligatoire)");
  assert.ok(STATUTS_CHOIX_MANUEL.includes("a_l_etude"));
});

test("3. bascule À l'étude → Planifié à la signature, chantier par chantier", () => {
  assert.ok(CYCLE_VIE_ETAPES.some((e) => e.id === ETAPE_SIGNATURE), `l'étape ${ETAPE_SIGNATURE} existe dans le cycle de vie`);
  const signe = { [ETAPE_SIGNATURE]: { fait: true, date: "2026-11-06T10:00:00Z" } };
  assert.deepEqual(decisionBasculeSignature({ id: "a", statut: "a_l_etude" }, signe).nouveauStatut, "planifie");
  assert.equal(decisionBasculeSignature({ id: "a", statut: "a_l_etude" }, {}).basculer, false, "non signé : rien");
  assert.equal(decisionBasculeSignature({ id: "a", statut: "a_l_etude" }, { [ETAPE_SIGNATURE]: { fait: false } }).basculer, false, "dé-validé : rien");
  assert.equal(decisionBasculeSignature({ id: "a", statut: "en_cours" }, signe).basculer, false, "déjà en exploitation : rien");
  assert.equal(decisionBasculeSignature({ id: "a", statut: "perdu" }, signe).basculer, false, "perdu : rien");
  assert.equal(decisionBasculeSignature({ id: "a" }, signe).basculer, false, "sans statut (chantiers existants) : rien");
  assert.equal(decisionBasculeSignature({ id: "a", statut: "a_l_etude" }, { autre: { fait: true } }, { etapeSignature: "autre" }).basculer, true, "lot 3 : étape paramétrable");
});

test("4. Marquer perdu : seulement À l'étude, motif obligatoire, réversible avec trace", () => {
  assert.equal(validerMotifPerte({}).ok, false);
  assert.equal(validerMotifPerte({ motif: "inconnu" }).ok, false);
  assert.equal(validerMotifPerte({ motif: "prix" }).ok, true);
  assert.equal(validerMotifPerte({ motif: "autre" }).ok, false, "« Autre » sans texte refusé");
  assert.equal(validerMotifPerte({ motif: "autre", detail: "x" }).ok, true);
  assert.ok(MOTIFS_PERTE.length >= 3);
  assert.equal(peutMarquerPerdu({ id: "a", statut: "en_cours" }).ok, false);
  assert.equal(peutMarquerPerdu({ id: "a", statut: "a_l_etude", archive_le: "x" }).ok, false);
  const p = preparerPerte({ id: "a", statut: "a_l_etude" }, { motif: "prix", detail: "", auteur: "Loris", le: "2026-11-06T10:00:00Z" });
  assert.equal(p.ok, true);
  assert.deepEqual(p.champs, { statut: "perdu", perdu_le: "2026-11-06T10:00:00Z", perdu_par: "Loris", perdu_motif: "prix", perdu_motif_detail: null });
  assert.equal(p.journal.evenement, "marque_perdu");
  assert.equal(preparerPerte({ id: "a", statut: "a_l_etude" }, { motif: "prix", auteur: "L" }).ok, false, "date absente : refus (aucune horloge dans le module)");
  const perdu = { id: "a", statut: "perdu", ...p.champs };
  assert.equal(estChantierPerdu(perdu), true);
  assert.equal(preparerAnnulationPerte(perdu, { raison: "", auteur: "L" }).ok, false, "raison obligatoire");
  const a = preparerAnnulationPerte(perdu, { raison: "Le client revient", auteur: "L" });
  assert.equal(a.champs.statut, "a_l_etude");
  assert.equal(a.champs.perdu_motif, null);
  assert.equal(a.journal.evenement, "perte_annulee");
  assert.equal(a.journal.motif, "prix", "le motif d'origine reste dans le journal");
});

test("5. statut d'opération calculé : tableau du cahier des charges + cas mixtes", () => {
  const ops = (...statuts) => statuts.map((statut, i) => ({ id: `c${i}`, statut }));
  assert.equal(statutOperation(ops("a_l_etude", "a_l_etude")).statut, "a_l_etude", "tous à l'étude");
  assert.equal(statutOperation(ops("a_l_etude", "en_cours")).statut, "en_cours", "au moins un actif");
  assert.equal(statutOperation(ops(null, "termine")).statut, "en_cours", "sans statut = planifié = actif");
  assert.equal(statutOperation(ops("en_pause")).statut, "en_cours");
  assert.equal(statutOperation(ops("perdu", "perdu")).statut, "perdue", "tous perdus");
  assert.equal(statutOperation(ops("termine", "termine")).statut, "terminee", "tous terminés");
  // Cas mixtes (décisions du lot 2, compte rendu)
  assert.equal(statutOperation(ops("a_l_etude", "perdu")).statut, "a_l_etude", "à l'étude + perdus");
  assert.equal(statutOperation(ops("termine", "perdu")).statut, "terminee", "terminés + perdus");
  assert.equal(statutOperation(ops("a_l_etude", "termine")).statut, "a_l_etude", "à l'étude + terminés : une affaire reste à signer");
  assert.equal(statutOperation([]).statut, "vide", "aucun chantier : jamais « terminée »");
  assert.equal(statutOperation([{ id: "a", statut: "termine" }, { id: "b", statut: "en_cours", archive_le: "x" }]).statut, "terminee", "archivé ignoré");
});

test("6. client et chargé d'affaires : défaut = opération, modifiable par chantier", () => {
  const op = { id: "o", client_id: "C1", charge_affaires_id: "U1", charge_affaires_nom: "Alice" };
  assert.deepEqual(clientEffectif({ id: "a" }, op), { valeur: "C1", source: "operation" });
  assert.deepEqual(clientEffectif({ id: "a", client_id: "C2" }, op), { valeur: "C2", source: "chantier" });
  assert.deepEqual(chargeAffairesEffectif({ id: "a" }, op), { id: "U1", nom: "Alice", source: "operation" });
  assert.deepEqual(chargeAffairesEffectif({ id: "a", charge_affaires_id: "U2", charge_affaires_nom: "Bob" }, op), { id: "U2", nom: "Bob", source: "chantier" });
  assert.deepEqual(chargeAffairesEffectif({ id: "a" }, {}), { id: null, nom: null, source: null });
});

// ─── 3. Règles de saisie : UNE liste ────────────────────────────────────────
// Données fictives (exemple issu des tests).
const projetComplet = () => ({
  client_nom: "Dupont", client_prenom: "Marie", client_societe: "", client_email: "marie@exemple.test", client_telephone: "0600000000",
  client_adresse: "1 rue A", client_code_postal: "49000", client_ville: "Angers", client_pays: "France",
  chantier_adresse: "2 rue B", chantier_code_postal: "49100", chantier_ville: "Angers", chantier_pays: "France",
  logement_reference: "T2 - R+2", type_logement: "T2", devis_objet: "Rénovation", devis_validite: "2026-12-31", tva_pct: 10,
});
const TAXES = [{ id: 705, rate: 10 }];

test("7. la liste couvre le tableau du cahier des charges", () => {
  const ids = REGLES_SAISIE.map((r) => r.id);
  for (const id of ["client_type", "client_nom", "client_prenom", "client_raison_sociale", "client_contact", "client_adresse", "client_code_postal",
    "client_ville", "client_pays", "client_email", "client_telephone", "chantier_adresse", "chantier_code_postal", "chantier_ville",
    "chantier_reference", "chantier_charge_affaires", "chantier_rattache", "devis_objet", "devis_validite", "devis_tva"]) {
    assert.ok(ids.includes(id), `règle ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "identifiants uniques");
  assert.equal(estObligatoire("client", "prenom", { type: "particulier" }), true);
  assert.equal(estObligatoire("client", "prenom", { type: "societe" }), false);
  assert.equal(estObligatoire("client", "raison_sociale", { type: "societe" }), true);
  assert.equal(estObligatoireProjet("chantier_code_postal", {}), true, "code postal du chantier : bloquant (lot 2)");
  assert.equal(estObligatoireProjet("client_email", {}), true);
  assert.equal(estObligatoireProjet("devis_num_commande_client", {}), false);
});

test("8. le contrôle d'avant-envoi produit EXACTEMENT les codes des règles « serveur »", () => {
  const vide = { client_societe: "" };
  const r = construireEnTeteDevis(vide, { taxes: TAXES, aujourdHui: new Date("2026-11-06T00:00:00Z") });
  const codes = new Set(r.erreurs.map((e) => e.code));
  const attendus = controlerFiche("client", clientDepuisProjet(vide), { serveurSeulement: true })
    .concat(controlerFiche("chantier", { reference_logement: "" }, { serveurSeulement: true }))
    .concat(controlerFiche("devis", {}, { serveurSeulement: true }))
    .map((m) => m.code);
  for (const c of attendus) assert.ok(codes.has(c), `avant-envoi : ${c}`);
  for (const c of ["chantier_code_postal_absent", "chantier_ville_absente", "client_email_absent", "client_telephone_absent"]) {
    assert.ok(codes.has(c), `${c} désormais bloquant`);
  }
  const societe = construireEnTeteDevis({ ...projetComplet(), client_societe: "SCI X", client_nom: "", client_prenom: "" }, { taxes: TAXES });
  assert.ok(societe.erreurs.some((e) => e.code === "client_contact_absent"), "société : nom du contact obligatoire");
  const ok = construireEnTeteDevis(projetComplet(), { taxes: TAXES, aujourdHui: new Date("2026-11-06T00:00:00Z") });
  assert.deepEqual(ok.erreurs, [], JSON.stringify(ok.erreurs));
  // Formulaire : même résultat pour les règles communes, plus chantier rattaché et chargé d'affaires.
  const form = manquantsAvantDevis({ projet: projetComplet(), rattachement: null });
  assert.deepEqual(form.map((m) => m.code).sort(), ["chantier_non_rattache", "charge_affaires_absent"].sort());
  assert.deepEqual(manquantsAvantDevis({ projet: projetComplet(), rattachement: { chantier_id: "c", charge_affaires_id: "u" } }), []);
  const formVide = new Set(manquantsAvantDevis({ projet: vide }).map((m) => m.code));
  for (const c of codes) if (!["tva_sans_correspondance"].includes(c)) assert.ok(formVide.has(c), `formulaire : ${c}`);
});

test("9. formulaires et avant-envoi importent la même liste (aucune liste recopiée)", () => {
  const payload = lire("src/Renovation/progbatQuotePayload.mjs");
  assert.match(payload, /from "\.\/reglesSaisieProgbat\.mjs"/);
  assert.match(payload, /controlerFiche\("client"/);
  assert.match(payload, /controlerFiche\("chantier"/);
  assert.ok(!/Code postal du chantier non renseigné|Ville du chantier non renseignée/.test(payload), "plus d'avertissement simple : bloquant");
  const usages = {
    "src/Renovation/PageInfoClient.jsx": /manquantsAvantDevis\(/,
    "src/Renovation/ComposantsCommerciaux.jsx": /controlerFiche\("client"/,
    "src/Renovation/clientsDonnees.js": /controlerFiche\("client"/,
    "src/Renovation/ParcoursChiffrage.jsx": /controlerFiche\("chantier"/,
    "src/Renovation/ProgbatApercuDevis.jsx": /manquants\.length === 0/,
  };
  for (const [f, re] of Object.entries(usages)) assert.match(lire(f), re, f);
  assert.match(lire("src/Renovation/PageInfoClient.jsx"), /estObligatoireProjet\(f, infos\)/, "astérisques du formulaire de chiffrage");
  const edge = lire("supabase/functions/progbat-quote/lib/reglesSaisieProgbat.mjs");
  assert.ok(edge.endsWith(lire("src/Renovation/reglesSaisieProgbat.mjs")), "copie Edge Function identique à la source");
});

test("10. identifiants ProGBat générés (« NOM VILLE »)", () => {
  // Exemple issu des tests, données fictives.
  assert.equal(genererCodeClient({ type: "particulier", nom: "Corral", ville: "Saint-Barthélemy-d'Anjou" }), "CORRAL ST BARTHELEMY D ANJOU");
  assert.equal(genererCodeClient({ type: "societe", raison_sociale: "SCI Les Érables", ville: "Angers" }), "SCI LES ERABLES ANGERS");
  assert.equal(genererCodeClient({ type: "particulier", nom: "Corral", ville: "" }), "", "incomplet : rien d'inventé");
  assert.equal(genererCodeChantierProgbat({ codeClient: "CORRAL ANGERS", reference: "T2 - R+2" }), "CORRAL ANGERS T2 R+2");
  assert.equal(genererNomChantierProgbat({ clientAffichage: "Dupont Marie", reference: "T2" }), "Dupont Marie — T2");
  assert.equal(normaliserCode("  sainte-gemmes "), "STE GEMMES");
  const r = construireEnTeteDevis(projetComplet(), { taxes: TAXES });
  assert.equal(r.champs.businessLabel, "Dupont Marie — T2 - R+2", "nom du chantier ProGBat inchangé (même fonction)");
  assert.equal(r.generes.code_client, "DUPONT ANGERS");
});

test("11. copie client → chiffrage : aller-retour sans perte", () => {
  const client = { type: "societe", raison_sociale: "SCI X", contact_nom: "Jean Martin", adresse: "1 rue", adresse_complement: "", code_postal: "49000", ville: "Angers", pays: "France", email: "a@b.test", telephone: "06" };
  const p = projetDepuisClient(client);
  assert.equal(p.client_societe, "SCI X");
  assert.equal(p.client_nom, "Jean Martin");
  assert.deepEqual(ecartsClientProjet(p, client), []);
  assert.deepEqual(ecartsClientProjet({ ...p, client_ville: "Paris" }, client), ["client_ville"]);
  assert.equal(clientDepuisProjet(p).raison_sociale, "SCI X");
});

// ─── 4. Écriture des colonnes du lot 2 ──────────────────────────────────────
test("12. colonnes facultatives : écrites si présentes, jamais effacées si absentes", () => {
  const ligne = { id: "a", operation_id: "o", nom: "A", couleur: "#111111", statut: "a_l_etude", ordre: 0, donnees: {}, client_id: "C1", perdu_motif: null };
  const connues = new Map([["a", ligne]]);
  const objet = depuisLigneChantier(ligne);
  assert.equal(objet.client_id, "C1");
  assert.deepEqual(calculerEcritures(connues, [objet]), { inserts: [], updates: [] });
  const sansColonnes = { id: "a", operation_id: "o", nom: "A", couleur: "#111111", statut: "a_l_etude" };
  assert.deepEqual(calculerEcritures(connues, [sansColonnes]), { inserts: [], updates: [] }, "objet partiel : client conservé");
  assert.deepEqual(calculerEcritures(connues, [{ ...objet, client_id: null }]).updates, [{ id: "a", patch: { client_id: null } }]);
  assert.deepEqual(calculerEcritures(connues, [{ ...objet, statut: "perdu", perdu_motif: "prix" }]).updates, [{ id: "a", patch: { statut: "perdu", perdu_motif: "prix" } }]);
  assert.equal("client_id" in versChampsChantier(objet).donnees, false, "colonne, pas donnees");
});

// ─── 5. Migration et câblage ────────────────────────────────────────────────
test("13. migration du lot 2 : purement additive, policy restrictive, aucun droit élevé", () => {
  const nom = readdirSync(join(racine, "supabase/migrations")).find((f) => /_refonte_operations_lot2\.sql$/.test(f));
  assert.ok(nom, "migration versionnée");
  const sql = lire(`supabase/migrations/${nom}`).replace(/--[^\n]*/g, "").toLowerCase();
  assert.ok(!/\bdelete\s+from\b|\bdrop\s+(table|column|policy|function)\b|\btruncate\b|\bupdate\s+public\./.test(sql), "aucune suppression ni réécriture");
  assert.ok(!/security\s+definer/.test(sql), "aucune fonction SECURITY DEFINER");
  assert.ok(!/create\s+or\s+replace\s+function|alter\s+policy/.test(sql), "aucune fonction ni policy existante modifiée");
  for (const t of ["clients", "chantiers_statut_journal"]) {
    assert.match(sql, new RegExp(`create policy profero_collaborateurs_seulement on public\\.${t}\\s+as restrictive`), `${t} : policy restrictive`);
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), `${t} : RLS`);
  }
  assert.ok(!/grant[^;]*\bdelete\b/.test(sql), "aucun droit DELETE");
  assert.match(sql, /grant select, insert on public\.chantiers_statut_journal to authenticated/, "journal : ajout seulement");
  const retour = lire("sql/202611_refonte_operations_lot2_rollback.sql").replace(/--[^\n]*/g, "").toLowerCase();
  assert.ok(!/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b/.test(retour), "retour arrière sans suppression");
});

test("14. App : Opérations et Chiffrage peuvent écrire les chantiers (ligne par ligne)", () => {
  const app = lire("src/App.jsx");
  assert.match(app, /<PageOperations chantiers=\{chantiers\} setChantiers=\{setChantiers\} saveConfig=\{saveConfig\}/);
  assert.match(app, /<PageInfoClient [^>]*setChantiers=\{setChantiers\} saveConfig=\{saveConfig\}/);
  const ops = lire("src/Renovation/PageOperations.jsx");
  assert.match(ops, /estChantierActif\(c, \{ inclureTermines: true \}\)/, "chiffres d'opération : chantiers en exploitation seulement");
  assert.match(lire("src/Renovation/PageChantiers.jsx"), /decisionBasculeSignature\(selectedChantier, cvEtats\)/, "bascule branchée sur la fiche chantier");
});

console.log(`\n${n} vérifications « Refonte Opérations, lot 2 » réussies.`);
