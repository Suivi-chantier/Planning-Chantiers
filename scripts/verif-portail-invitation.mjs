#!/usr/bin/env node
// Vérifie l'invitation d'un client au portail : logique pure de la fonction
// portail-inviter-client, ordre des contrôles de son code, et bloc « Accès au portail ».
// Exemples issus des tests, données fictives : aucune donnée réelle.
//   node scripts/verif-portail-invitation.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { adresseInvitable, decisionCompte, lienPortail, construireCourriel, estUuid } from "../supabase/functions/portail-inviter-client/invitation.mjs";
import { lireLienInvitation, validerMotDePasse } from "../src/Portail/portailVue.mjs";

const racine = fileURLToPath(new URL("..", import.meta.url));
const lire = (r) => readFileSync(join(racine, r), "utf8");
const FN = lire("supabase/functions/portail-inviter-client/index.ts");
const UI = lire("src/Invest/crm/AccesPortail.jsx");
const FICHE = lire("src/Invest/crm/FicheClientV2.jsx");  // l'invitation s'ouvre depuis « ••• → Gérer l'accès au portail »
const PORTAIL = lire("src/Portail/PortailClient.jsx");
let n = 0, total = 0;
const test = (nom, fn) => { total++; try { fn(); n++; console.log(`  ✔ ${nom}`); } catch (e) { console.log(`  ✘ ${nom}\n      ${e.message.split("\n")[0]}`); process.exitCode = 1; } };
const C1 = "11111111-1111-1111-1111-1111111111a1", C2 = "11111111-1111-1111-1111-1111111111b1";

test("1. adresse : prise sur la fiche, minuscules, refus si vide, invalide ou interne", () => {
  assert.deepEqual(adresseInvitable("  Alice@Exemple.FR "), { ok: true, email: "alice@exemple.fr" });
  for (const mauvais of ["", null, undefined, "   ", "pas-une-adresse", "a@b", "a b@c.fr", "paul@profero.local"]) assert.equal(adresseInvitable(mauvais).ok, false, String(mauvais));
});
test("2. décision : création, renvoi, adoption d'un essai interrompu, refus de tout autre compte", () => {
  assert.equal(decisionCompte({ compte: null, lienExistant: null, clientId: C1 }).action, "creer");
  assert.equal(decisionCompte({ compte: { id: "x", last_sign_in_at: "2026-10-01" }, lienExistant: { client_id: C1 }, clientId: C1 }).action, "renvoyer");
  assert.equal(decisionCompte({ compte: { id: "x" }, lienExistant: { client_id: C2 }, clientId: C1 }).action, "refuser", "lié à un autre client");
  assert.equal(decisionCompte({ compte: { id: "x", last_sign_in_at: null }, lienExistant: null, clientId: C1 }).action, "adopter");
  const collab = decisionCompte({ compte: { id: "x", last_sign_in_at: "2026-09-01T10:00:00Z" }, lienExistant: null, clientId: C1 });
  assert.equal(collab.action, "refuser", "compte déjà utilisé, non lié : jamais repris");
  assert.ok(collab.motif);
});
test("3. lien : vers /espace-client, jeton encodé, type invite ou recovery, le portail sait le relire", () => {
  const l = lienPortail("https://planning-chantiers.vercel.app/", "ab/c+d=", "invite");
  assert.match(l, /^https:\/\/planning-chantiers\.vercel\.app\/espace-client\?token_hash=/);
  const lu = lireLienInvitation(new URL(l).search);
  assert.deepEqual(lu, { tokenHash: "ab/c+d=", type: "invite" });
  assert.equal(lireLienInvitation(new URL(lienPortail("https://x.fr", "t", "recovery")).search).type, "recovery");
  assert.equal(lireLienInvitation("?token_hash=t&type=magiclink"), null, "type inconnu refusé");
  assert.equal(lireLienInvitation("?type=invite"), null);
  assert.equal(lireLienInvitation(""), null);
});
test("4. courriel en français : lien présent, HTML échappé, mention d'ignorer en cas d'erreur", () => {
  const c = construireCourriel({ prenom: "Alice <b>", nom: "X", lien: "https://x.fr/espace-client?token_hash=a&type=invite", renvoi: false });
  assert.match(c.sujet, /espace client Profero Invest/);
  assert.ok(c.texte.includes("https://x.fr/espace-client?token_hash=a&type=invite"));
  assert.ok(!c.html.includes("<b>"), "prénom échappé");
  assert.match(c.html, /&lt;b&gt;/);
  assert.match(c.html, /href="https:\/\/x\.fr\/espace-client\?token_hash=a&amp;type=invite"/);
  assert.match(c.texte, /ignorez ce message/);
  assert.match(construireCourriel({ prenom: "", nom: "Martin", lien: "l", renvoi: true }).texte, /^Bonjour Martin,/);
  assert.match(construireCourriel({ prenom: "", nom: "", lien: "l", renvoi: false }).texte, /^Bonjour,/);
  assert.match(construireCourriel({ lien: "l", renvoi: true }).sujet, /Votre accès/);
});
test("5. fonction : jeton valide, PUIS droit gestionnaire, PUIS seulement le service_role", () => {
  const i = (t) => FN.indexOf(t);
  assert.ok(i("auth.getUser") > 0 && i("auth.getUser") < i('rpc("portail_gestionnaire")'));
  assert.ok(i('rpc("portail_gestionnaire")') < i("createClient(url, cleService"), "service_role créé après le contrôle du droit");
  assert.match(FN, /gestionnaire !== true\) return json\(\{ ok: false, error: "Réservé aux administrateurs et aux commerciaux\." \}, 403\)/);
  assert.ok(!/createClient\(url, cleService[\s\S]*portail_gestionnaire/.test(FN.slice(i("createClient(url, cleService"))), "pas de contrôle du droit après coup");
});
test("6. fonction : adresse prise sur la fiche client (jamais la requête), refus des adresses de collaborateurs", () => {
  assert.match(FN, /\.from\("invest_clients"\)\.select\("id, prenom, nom, email"\)\.eq\("id", clientId\)/);
  assert.ok(!/\.email\b[^;\n]*req\.json|json\(\)\)\?\.email/.test(FN), "aucune adresse lue dans le corps de la requête");
  assert.match(FN, /from\("utilisateurs"\)\.select\("id"\)\.ilike\("email", email\)/);
  assert.match(FN, /elle ne peut pas servir à un compte client/);
});
test("7. fonction : lien client <-> compte écrit AVANT le courriel ; compte orphelin supprimé si l'écriture échoue", () => {
  const i = (t) => FN.indexOf(t);
  assert.ok(i('from("invest_portail_comptes")') > 0);
  assert.ok(i('.insert({ client_id: clientId, auth_user_id: compteId') < i("await fetch(scriptUrl"), "accès enregistré avant l'envoi");
  assert.match(FN, /if \(decision\.action === "creer"\) await admin\.auth\.admin\.deleteUser\(compteId\)/);
});
test("8. fonction : le lien et le jeton ne sont jamais journalisés ni renvoyés", () => {
  assert.ok(!/console\.(log|info|warn|error)/.test(FN), "aucune journalisation");
  const reponses = [...FN.matchAll(/return json\(\{[^}]*\}/g)].map((m) => m[0]).join("\n");
  assert.ok(!/jeton|hashed_token|action_link|lienPortail/.test(reponses), "aucune réponse ne contient le lien");
  assert.match(FN, /return json\(\{ ok: true, renvoi, envoyeA: email \}\)/);
});
test("9. fonction : aucune adresse reprise à la légère (existant non lié refusé sauf essai interrompu)", () => {
  assert.match(FN, /decisionCompte\(\{ compte, lienExistant: lien, clientId \}\)/);
  assert.match(FN, /if \(decision\.action === "refuser"\) return json\(\{ ok: false, error: decision\.motif \}, 409\)/);
  assert.ok(estUuid(C1) && !estUuid("pas-un-uuid") && !estUuid("1; drop table"));
});
test("10. écran : bloc réservé aux rôles admin et commercial ; confirmation avant envoi et avant révocation", () => {
  assert.match(UI, /ROLES_GESTIONNAIRES = \["admin", "commercial"\]/);
  assert.match(UI, /if \(!autorise\) return null;/);
  assert.match(UI, /if \(!window\.confirm\(question\)\) return;/);
  assert.match(UI, /if \(!window\.confirm\(`Révoquer l'accès/);
  assert.match(UI, /invoquerFonction\("portail-inviter-client", \{ clientId: client\.id \}\)/);
});
test("11. écran : la révocation n'écrit que statut / qui / quand, et seulement sur les accès actifs", () => {
  assert.match(UI, /\.update\(\{ statut: "revoque", revoque_le: [^}]*revoque_par: [^}]*\}\)\s*\.eq\("client_id", client\.id\)\.eq\("statut", "actif"\)/);
  assert.ok(!/\.(insert|delete|upsert)\(/.test(UI), "aucune création ni suppression côté écran");
});
test("12. fiche client : le bloc s'ouvre depuis le menu « ••• », réservé aux gestionnaires, avec le client et le profil", () => {
  assert.match(FICHE, /import AccesPortail, \{ ROLES_GESTIONNAIRES \} from "\.\/AccesPortail";/);
  assert.match(FICHE, /<AccesPortail T=\{T\} client=\{client\} profil=\{profil\} \/>/);
  assert.match(FICHE, /gestionnaire && \{ cle: "portail", libelle: "Gérer l'accès au portail"/);
  assert.match(FICHE, /portailOuvert && gestionnaire/);
});
test("13. portail : lien lu une seule fois, retiré de l'adresse avant validation, mot de passe 8 caractères", () => {
  assert.match(PORTAIL, /const \[lienInitial\] = useState\(\(\) => lireLienInvitation\(window\.location\.search\)\)/);
  assert.match(PORTAIL, /lienTraite\.current = true;\s*window\.history\.replaceState\(\{\}, "", window\.location\.pathname\);\s*supabase\.auth\.verifyOtp/);
  assert.equal(validerMotDePasse("1234567", "1234567"), "Le mot de passe doit contenir au moins 8 caractères.");
  assert.equal(validerMotDePasse("12345678", "12345679"), "Les deux mots de passe ne sont pas identiques.");
  assert.equal(validerMotDePasse("12345678", "12345678"), "");
  assert.ok(!/resetPasswordForEmail/.test(PORTAIL), "pas de réinitialisation libre : le conseiller renvoie le lien");
});

console.log(`\n${n}/${total} contrôles conformes`);
