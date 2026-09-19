#!/usr/bin/env node
// Vérifie le durcissement de l'Edge Function analyse-commande.
//
// Deux niveaux :
//   1. les règles pures (supabase/functions/analyse-commande/validation.mjs),
//      exécutées pour de vrai ;
//   2. la CHAÎNE DE DÉCISION du handler, rejouée ici à l'identique avec des
//      doublures mémoire — authentification, profil et Anthropic — pour prouver
//      qu'AUCUNE voie de refus n'atteint Anthropic, et que le corps n'est lu
//      qu'après autorisation. Doublée d'une analyse statique de index.ts, qui
//      vérifie que le vrai fichier suit bien cet ordre.
//
// Aucun appel réseau, aucun appel réel à Anthropic, aucun déploiement.
//   node scripts/verif-analyse-commande.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const V = await import(new URL("../supabase/functions/analyse-commande/validation.mjs", import.meta.url).href);
const {
  LIMITES, ROLES_AUTORISES, TYPES_AUTORISES,
  estBase64Valide, extraireJeton, tailleDecodee, validerCorps, verifierProfil, verifierTailleAnnoncee,
} = V;

const INDEX = lire("supabase/functions/analyse-commande/index.ts");
const INDEX_CODE = INDEX.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
const CONFIG = lire("supabase/config.toml");

// ═══════════════════════════════════════════════════════════════════════════
// LE HANDLER REJOUÉ — mêmes règles, mêmes étapes, doublures aux extrémités
// ═══════════════════════════════════════════════════════════════════════════
const b64 = (n) => "A".repeat(Math.ceil(n / 3) * 4);          // ~n octets décodés
const imagePng = (octets = 1024) => ({ base64: b64(octets), mediaType: "image/png" });

/**
 * Reproduit fidèlement l'ordre du handler. Chaque doublure COMPTE ses appels :
 * c'est ainsi qu'on prouve que rien n'est lu ni transmis trop tôt.
 */
async function handler({
  methode = "POST", authorization = "Bearer a.b.c", contentLength = null,
  utilisateur = { email: "Chef@Profero.com" }, profil = { role: "admin", actif: true },
  corps = { images: [imagePng()] }, corpsIllisible = false, cleAnthropic = "clé",
  reponseAnthropic = { content: [{ type: "text", text: "{}" }] },
} = {}) {
  const trace = { getUser: 0, profil: 0, corpsLu: 0, anthropic: 0 };

  if (methode === "OPTIONS") return { status: 200, trace, cors: true };
  if (methode !== "POST") return { status: 405, code: "METHODE_NON_AUTORISEE", trace };

  const jeton = extraireJeton(authorization);
  if (!jeton.ok) return { ...jeton, trace };

  trace.getUser++;
  if (!utilisateur?.email) return { status: 401, code: "JETON_INVALIDE", trace };

  trace.profil++;
  const autorisation = verifierProfil(profil);
  if (!autorisation.ok) return { ...autorisation, trace };

  const annonce = verifierTailleAnnoncee(contentLength);
  if (!annonce.ok) return { ...annonce, trace };

  trace.corpsLu++;
  if (corpsIllisible) return { status: 400, code: "JSON_INVALIDE", trace };

  const valide = validerCorps(corps);
  if (!valide.ok) return { ...valide, trace };

  if (!cleAnthropic) return { status: 500, code: "CONFIG_SERVEUR", trace };

  trace.anthropic++;
  return { status: 200, data: reponseAnthropic, images: valide.images, trace, role: autorisation.role };
}

const sansAnthropic = (r, quoi) => {
  assert.equal(r.trace.anthropic, 0, `${quoi} : Anthropic ne doit PAS être appelé`);
  return r;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1 → 12. LA PORTE
// ═══════════════════════════════════════════════════════════════════════════
test("1. OPTIONS accepté, sans aucun appel Anthropic", async () => {
  const r = await handler({ methode: "OPTIONS" });
  assert.equal(r.status, 200);
  assert.equal(r.cors, true);
  sansAnthropic(r, "OPTIONS");
  assert.equal(r.trace.getUser, 0, "pas même de validation de jeton sur un préflight");
});

test("2. GET refusé en 405", async () => {
  for (const m of ["GET", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const r = await handler({ methode: m });
    assert.equal(r.status, 405, m);
    assert.equal(r.code, "METHODE_NON_AUTORISEE");
    sansAnthropic(r, m);
    assert.equal(r.trace.getUser, 0, `${m} : aucune validation de jeton`);
    assert.equal(r.trace.corpsLu, 0, `${m} : le corps n'est pas lu`);
  }
});

test("3. POST sans Authorization refusé en 401", async () => {
  for (const h of [null, "", "   "]) {
    const r = await handler({ authorization: h });
    assert.equal(r.status, 401);
    assert.equal(r.code, "AUTH_ABSENTE");
    sansAnthropic(r, "sans Authorization");
    assert.equal(r.trace.getUser, 0);
    assert.equal(r.trace.corpsLu, 0);
  }
});

test("4. Authorization mal formée refusée en 401", async () => {
  for (const h of ["abc", "Basic xyz", "Bearer", "Bearer ", "Bearer a.b", "Bearer a.b.c.d", "Token a.b.c"]) {
    const r = await handler({ authorization: h });
    assert.equal(r.status, 401, h);
    assert.equal(r.code, "AUTH_MAL_FORMEE", h);
    sansAnthropic(r, h);
    assert.equal(r.trace.corpsLu, 0);
  }
  // La forme valide passe la porte 3 (elle ne prouve rien sur la validité).
  assert.equal(extraireJeton("Bearer a.b.c").ok, true);
  assert.equal(extraireJeton("bearer a.b.c").ok, true, "la casse du schéma est tolérée");
});

test("5. JWT invalide refusé en 401", async () => {
  const r = await handler({ utilisateur: null });
  assert.equal(r.status, 401);
  assert.equal(r.code, "JETON_INVALIDE");
  assert.equal(r.trace.getUser, 1, "le jeton a bien été soumis à Supabase");
  assert.equal(r.trace.profil, 0, "aucune lecture de profil");
  assert.equal(r.trace.corpsLu, 0, "le corps n'est pas lu");
  sansAnthropic(r, "JWT invalide");
});

test("6. utilisateur sans profil refusé en 403", async () => {
  const r = await handler({ profil: null });
  assert.equal(r.status, 403);
  assert.equal(r.code, "PROFIL_ABSENT");
  assert.equal(r.trace.corpsLu, 0);
  sansAnthropic(r, "profil absent");
});

test("7. profil inactif refusé en 403", async () => {
  const r = await handler({ profil: { role: "admin", actif: false } });
  assert.equal(r.status, 403);
  assert.equal(r.code, "PROFIL_INACTIF");
  sansAnthropic(r, "profil inactif");
  // `actif` nullable : absent ou null ne désactive pas (règle des autres fonctions).
  assert.equal(verifierProfil({ role: "admin", actif: null }).ok, true);
  assert.equal(verifierProfil({ role: "admin" }).ok, true);
});

test("8. ouvrier refusé en 403", async () => {
  const r = await handler({ profil: { role: "ouvrier", actif: true } });
  assert.equal(r.status, 403);
  assert.equal(r.code, "ROLE_NON_AUTORISE");
  assert.equal(r.trace.corpsLu, 0, "un ouvrier ne fait même pas lire son document");
  sansAnthropic(r, "ouvrier");
});

test("9. rôles inconnus ou non autorisés refusés en 403", async () => {
  for (const role of ["commercial", "agent_edl", "inconnu", "", null, undefined, 42, "ADMIN_", "super-admin"]) {
    const r = await handler({ profil: { role, actif: true } });
    assert.equal(r.status, 403, `rôle ${JSON.stringify(role)}`);
    assert.equal(r.code, "ROLE_NON_AUTORISE");
    sansAnthropic(r, `rôle ${JSON.stringify(role)}`);
  }
  // Le rôle ne vient JAMAIS du corps : un corps qui prétend être admin ne change rien.
  const usurpation = await handler({
    profil: { role: "ouvrier", actif: true },
    corps: { role: "admin", images: [imagePng()] },
  });
  assert.equal(usurpation.status, 403);
  assert.equal(usurpation.code, "ROLE_NON_AUTORISE");
});

for (const role of ["admin", "conducteur", "comptable"]) {
  test(`${10 + ROLES_AUTORISES.indexOf(role)}. ${role} autorisé`, async () => {
    const r = await handler({ profil: { role, actif: true } });
    assert.equal(r.status, 200);
    assert.equal(r.role, role);
    assert.equal(r.trace.anthropic, 1, "exactement un appel Anthropic");
  });
  test(`${role} : la casse et les espaces du rôle sont tolérés`, async () => {
    const r = await handler({ profil: { role: ` ${role.toUpperCase()} `, actif: true } });
    assert.equal(r.status, 200, "un rôle mal saisi en base ne doit pas bloquer un ayant droit");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 13 → 19. LE CORPS
// ═══════════════════════════════════════════════════════════════════════════
test("13. le corps n'est lu QU'APRÈS autorisation", async () => {
  // Toutes les voies de refus d'autorisation, sans exception.
  const refus = [
    { methode: "GET" }, { authorization: null }, { authorization: "Bearer xx" },
    { utilisateur: null }, { profil: null }, { profil: { role: "admin", actif: false } },
    { profil: { role: "ouvrier", actif: true } },
  ];
  for (const r of refus) {
    const x = await handler({ ...r, corps: { images: [imagePng()] } });
    assert.equal(x.trace.corpsLu, 0, `${JSON.stringify(r)} : le corps ne doit pas être lu`);
    sansAnthropic(x, JSON.stringify(r));
  }
  // Et sur un appel autorisé, il l'est.
  const ok = await handler({});
  assert.equal(ok.trace.corpsLu, 1);
  // Dans le vrai fichier, req.json() vient APRÈS verifierProfil.
  assert.ok(INDEX_CODE.indexOf("verifierProfil(profil)") < INDEX_CODE.indexOf("await req.json()"),
    "req.json() doit suivre la vérification du profil");
});

test("14. corps absent, vide ou invalide refusé en 400", async () => {
  assert.equal((await handler({ corpsIllisible: true })).status, 400);
  // null et undefined se testent sur la règle elle-même : passés au lanceur,
  // `undefined` réactiverait sa valeur par défaut.
  for (const corps of [null, undefined]) {
    const v = validerCorps(corps);
    assert.equal(v.ok, false, JSON.stringify(corps));
    assert.equal(v.status, 400);
    assert.equal(v.code, "CORPS_INVALIDE");
  }
  for (const corps of ["texte", 42, [], {}, { images: [] }, { images: "x" }]) {
    const r = await handler({ corps });
    assert.equal(r.status, 400, JSON.stringify(corps));
    assert.ok(["CORPS_INVALIDE", "AUCUN_DOCUMENT"].includes(r.code), `${JSON.stringify(corps)} → ${r.code}`);
    sansAnthropic(r, JSON.stringify(corps));
  }
  // La forme historique { imageBase64, mediaType } reste acceptée.
  const historique = await handler({ corps: { imageBase64: b64(2048), mediaType: "image/jpeg" } });
  assert.equal(historique.status, 200);
  assert.equal(historique.images.length, 1);
});

test("15. trop de documents refusé en 413", async () => {
  assert.equal(LIMITES.elements, 40);
  const ok = await handler({ corps: { images: Array.from({ length: LIMITES.elements }, () => imagePng(1024)) } });
  assert.equal(ok.status, 200, "la limite exacte passe");
  const trop = await handler({ corps: { images: Array.from({ length: LIMITES.elements + 1 }, () => imagePng(1024)) } });
  assert.equal(trop.status, 413);
  assert.equal(trop.code, "TROP_DE_DOCUMENTS");
  sansAnthropic(trop, "trop de documents");
  // Un PDF de 15 pages — le plafond de pdfToImages.js — doit toujours passer.
  // 1,5 Mo par page est déjà un haut de fourchette pour un rendu PNG à
  // TARGET_MAX_PX = 1560 px (une page de texte scannée pèse plutôt 0,2 à 1 Mo).
  const pdf15 = await handler({ corps: { images: Array.from({ length: 15 }, () => imagePng(1.5 * 1024 * 1024)) } });
  assert.equal(pdf15.status, 200, "15 pages à 1,5 Mo : l'usage réel ne doit pas casser");
  // Au-delà du total, c'est Anthropic qui refuserait de toute façon (32 Mo par
  // requête) : on refuse avant de payer le transfert, pas plus tôt.
  const pdf15Enorme = await handler({ corps: { images: Array.from({ length: 15 }, () => imagePng(2.2 * 1024 * 1024)) } });
  assert.equal(pdf15Enorme.status, 413);
  assert.equal(pdf15Enorme.code, "TOTAL_TROP_VOLUMINEUX");
});

test("16. élément individuel trop volumineux refusé en 413", async () => {
  const r = await handler({ corps: { images: [imagePng(LIMITES.octetsParElement + 4096)] } });
  assert.equal(r.status, 413);
  assert.equal(r.code, "ELEMENT_TROP_VOLUMINEUX");
  sansAnthropic(r, "élément trop gros");
  // Juste en dessous : accepté.
  assert.equal((await handler({ corps: { images: [imagePng(LIMITES.octetsParElement - 8192)] } })).status, 200);
});

test("17. total décodé trop volumineux refusé en 413", async () => {
  const gros = 8 * 1024 * 1024;
  const n = Math.ceil(LIMITES.octetsTotal / gros) + 1;
  const r = await handler({ corps: { images: Array.from({ length: n }, () => imagePng(gros)) } });
  assert.equal(r.status, 413);
  assert.equal(r.code, "TOTAL_TROP_VOLUMINEUX");
  sansAnthropic(r, "total trop gros");
  // Refus précoce sur Content-Length, avant même de lire le corps.
  const annonce = await handler({ contentLength: String(LIMITES.octetsCorps + 1) });
  assert.equal(annonce.status, 413);
  assert.equal(annonce.code, "CORPS_TROP_VOLUMINEUX");
  assert.equal(annonce.trace.corpsLu, 0, "le corps n'est pas lu quand la taille annoncée est excessive");
  // Mais Content-Length n'est qu'un indice : un mensonge ne fait pas passer.
  const menteur = await handler({
    contentLength: "10",
    corps: { images: Array.from({ length: 5 }, () => imagePng(9 * 1024 * 1024)) },
  });
  assert.equal(menteur.status, 413, "la taille réelle est recontrôlée après décodage");
  assert.equal(menteur.code, "TOTAL_TROP_VOLUMINEUX");
});

test("18. type MIME non autorisé refusé en 400", async () => {
  assert.deepEqual([...TYPES_AUTORISES].sort(),
    ["application/pdf", "image/gif", "image/jpeg", "image/png", "image/webp"]);
  for (const t of ["text/html", "application/json", "image/svg+xml", "application/octet-stream", "", null, undefined, "image/PNG ", "video/mp4"]) {
    const r = await handler({ corps: { images: [{ base64: b64(1024), mediaType: t }] } });
    if (t === "image/PNG ") { assert.equal(r.status, 200, "la casse et les espaces sont normalisés"); continue; }
    assert.equal(r.status, 400, JSON.stringify(t));
    assert.equal(r.code, "TYPE_NON_AUTORISE");
    sansAnthropic(r, JSON.stringify(t));
  }
  // Les cinq types réellement produits par le frontend passent.
  for (const t of TYPES_AUTORISES) {
    assert.equal((await handler({ corps: { images: [{ base64: b64(1024), mediaType: t }] } })).status, 200, t);
  }
});

test("19. base64 vide ou invalide refusée en 400", async () => {
  for (const s of ["", "   ", "abc", "AAA", "A".repeat(7), "!!!!", "AA=A", "AAAA===", null, undefined, 42, {}, "AAAA AAAA"]) {
    const r = await handler({ corps: { images: [{ base64: s, mediaType: "image/png" }] } });
    assert.equal(r.status, 400, JSON.stringify(s));
    assert.equal(r.code, "BASE64_INVALIDE", JSON.stringify(s));
    sansAnthropic(r, JSON.stringify(s));
  }
  assert.equal(estBase64Valide("AAAAAAAA"), true);
  assert.equal(estBase64Valide("AAAAAAA="), true);
  assert.equal(estBase64Valide("AAAAAA=="), true);
  // La taille décodée est calculée sans décoder.
  assert.equal(tailleDecodee("AAAAAAAA"), 6);
  assert.equal(tailleDecodee("AAAAAAA="), 5);
  assert.equal(tailleDecodee("AAAAAA=="), 4);
});

// ═══════════════════════════════════════════════════════════════════════════
// 20 → 24. ANTHROPIC
// ═══════════════════════════════════════════════════════════════════════════
test("20. AUCUNE voie de refus n'appelle Anthropic", async () => {
  const refus = [
    { methode: "GET" }, { methode: "DELETE" },
    { authorization: null }, { authorization: "Bearer nawak" },
    { utilisateur: null },
    { profil: null }, { profil: { role: "admin", actif: false } },
    { profil: { role: "ouvrier", actif: true } }, { profil: { role: "commercial", actif: true } },
    { corpsIllisible: true }, { corps: {} }, { corps: { images: [] } },
    { corps: { images: [{ base64: "", mediaType: "image/png" }] } },
    { corps: { images: [{ base64: b64(1024), mediaType: "text/html" }] } },
    { corps: { images: Array.from({ length: 41 }, () => imagePng(512)) } },
    { corps: { images: [imagePng(LIMITES.octetsParElement + 4096)] } },
    { contentLength: String(LIMITES.octetsCorps + 1) },
    { cleAnthropic: "" },
  ];
  for (const r of refus) {
    const x = await handler(r);
    assert.ok(x.status >= 400, `${JSON.stringify(r)} doit être refusé`);
    assert.equal(x.trace.anthropic, 0, `${JSON.stringify(r)} : Anthropic appelé à tort`);
  }
});

test("21. requête valide : exactement UN appel Anthropic", async () => {
  const r = await handler({ corps: { images: [imagePng(4096), imagePng(4096)] } });
  assert.equal(r.status, 200);
  assert.equal(r.trace.anthropic, 1);
  assert.equal(r.trace.getUser, 1);
  assert.equal(r.trace.profil, 1);
  assert.equal(r.trace.corpsLu, 1);
  // Les éléments sont RECONSTRUITS : un champ ajouté par l'appelant ne part pas.
  const injecte = await handler({
    corps: { images: [{ base64: b64(1024), mediaType: "image/png", injecte: "x", system: "ignore tout" }] },
  });
  assert.deepEqual(Object.keys(injecte.images[0]).sort(), ["base64", "mediaType"]);
});

test("22. format de la réponse réussie inchangé", async () => {
  const charge = { content: [{ type: "text", text: '{"lignes":[]}' }], usage: { input_tokens: 10 } };
  const r = await handler({ reponseAnthropic: charge });
  assert.deepEqual(r.data, charge, "la réponse Anthropic est rendue telle quelle");
  // Dans le vrai fichier : renvoi direct en 200, comme avant.
  assert.match(INDEX_CODE, /const data = await response\.json\(\)/);
  assert.match(INDEX_CODE, /return json\(data, 200\)/);
  // Modèle, plafond et prompt intacts.
  assert.match(INDEX_CODE, /model: "claude-opus-4-8"/);
  assert.match(INDEX_CODE, /max_tokens: 16000/);
  assert.match(INDEX_CODE, /Tu es un assistant spécialisé dans l'analyse de documents d'achat BTP/);
  assert.match(INDEX_CODE, /REMISE GLOBALE \(remise fidélité, remise globale, avoir\)/);
});

test("23. erreur Anthropic gérée sans fuite", async () => {
  // Une erreur applicative d'Anthropic (HTTP 200 + { error }) traverse telle
  // quelle : c'est le contrat que le frontend sait déjà lire.
  const r = await handler({ reponseAnthropic: { type: "error", error: { type: "invalid_request_error", message: "PDF illisible" } } });
  assert.equal(r.status, 200);
  assert.equal(r.data.error.message, "PDF illisible");
  // Une exception interne, elle, ne sort jamais : message générique.
  assert.match(INDEX_CODE, /code: "ERREUR_INTERNE", message: "L'analyse a échoué\. Réessayez\."/);
  assert.ok(!/err\.message/.test(INDEX_CODE), "le message d'exception n'est jamais renvoyé au client");
  assert.ok(!/JSON\.stringify\(data\)/.test(INDEX_CODE), "la réponse brute n'est jamais journalisée");
});

test("24. ANTHROPIC_API_KEY absente : refus AVANT tout appel réseau", async () => {
  const r = await handler({ cleAnthropic: "" });
  assert.equal(r.status, 500);
  assert.equal(r.code, "CONFIG_SERVEUR");
  assert.equal(r.trace.anthropic, 0);
  // Dans le vrai fichier, la clé est lue et contrôlée avant le fetch.
  assert.ok(INDEX_CODE.indexOf('if (!ANTHROPIC_KEY)') < INDEX_CODE.indexOf("fetch(\"https://api.anthropic.com"),
    "le contrôle de la clé précède l'appel");
  // Et le client n'apprend ni le nom du secret ni sa nature.
  assert.ok(!/message: "[^"]*ANTHROPIC/.test(INDEX_CODE), "le nom du secret ne sort pas dans un message");
});

// ═══════════════════════════════════════════════════════════════════════════
// LE VRAI FICHIER : ordre, journalisation, absence de fuite
// ═══════════════════════════════════════════════════════════════════════════
test("index.ts : l'ordre imposé est bien celui du code", () => {
  const ordre = [
    'req.method === "OPTIONS"',
    'req.method !== "POST"',
    'extraireJeton(req.headers.get("Authorization"))',
    "client.auth.getUser()",
    'from("utilisateurs")',
    "verifierProfil(profil)",
    "verifierTailleAnnoncee(",
    "await req.json()",
    "validerCorps(corps)",
    'fetch("https://api.anthropic.com',
  ];
  let precedent = -1;
  for (const marqueur of ordre) {
    const i = INDEX_CODE.indexOf(marqueur);
    assert.ok(i > precedent, `« ${marqueur} » doit venir après l'étape précédente`);
    precedent = i;
  }
});

test("index.ts : identité bornée au jeton, aucun client privilégié", () => {
  assert.match(INDEX_CODE, /SUPABASE_ANON_KEY/);
  assert.match(INDEX_CODE, /global: \{ headers: \{ Authorization: `Bearer \$\{jeton\.jwt\}` \} \}/);
  assert.ok(!INDEX_CODE.includes("SERVICE_ROLE"), "aucun client privilégié dans cette fonction");
  // L'autorisation ne vient ni des métadonnées, ni du corps.
  assert.ok(!INDEX_CODE.includes("user_metadata"), "user_metadata n'est jamais consulté");
  assert.ok(!INDEX_CODE.includes("app_metadata"));
  assert.ok(!/corps\.role|body\.role/.test(INDEX_CODE), "aucun rôle lu dans le corps");
  // Le profil est relu en base, sur les vraies colonnes.
  assert.match(INDEX_CODE, /\.select\("role,actif"\)/);
  assert.match(INDEX_CODE, /\.eq\("email", user\.email\.toLowerCase\(\)\)/);
});

test("index.ts : journalisation sans secret ni donnée personnelle", () => {
  const journaux = INDEX_CODE.split("\n").filter((l) => /console\.(log|warn|error)/.test(l));
  assert.ok(journaux.length >= 3, "la fonction journalise assez pour être diagnostiquée");
  for (const l of journaux) {
    for (const interdit of ["jwt", "jeton.jwt", "Authorization", "ANTHROPIC_KEY", "user.email", "base64", "data)", "profil)"]) {
      assert.ok(!l.includes(interdit), `journal interdit (${interdit}) : ${l.trim()}`);
    }
  }
  // Ce qui EST journalisé : rôle, nombre de pages, statut, durée.
  assert.match(INDEX_CODE, /rôle=\$\{autorisation\.role\}/);
  assert.match(INDEX_CODE, /pages=\$\{valide\.images\.length\}/);
  assert.match(INDEX_CODE, /\$\{Date\.now\(\) - t0\} ms/);
});

test("config.toml : verify_jwt reste à true pour cette fonction", () => {
  assert.match(CONFIG, /\[functions\.analyse-commande\]\s*\nverify_jwt = true/);
  // La passerelle reste le premier verrou : ce lot ne la désactive pas.
  assert.equal((CONFIG.match(/verify_jwt = false/g) || []).length, 1,
    "une seule fonction sans JWT dans tout le fichier (le cron ProGBat)");
});

// ═══════════════════════════════════════════════════════════════════════════
let echecs = 0;
for (const [nom, fn] of cas) {
  try {
    await fn();
    console.log(`  ok   ${nom}`);
  } catch (e) {
    echecs++;
    console.error(`  ÉCHEC ${nom}\n        ${String(e?.message || e).split("\n").join("\n        ")}`);
  }
}
console.log(`\nverif-analyse-commande : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
