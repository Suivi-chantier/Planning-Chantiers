#!/usr/bin/env node
// Vérifie que les DEUX consommateurs d'analyse-commande passent désormais par
// la session Supabase, et plus par un fetch anonyme vers une URL publique.
//
// Deux parties :
//   1. le comportement réel de invoquerFonction() (src/supabase.js), exécuté
//      avec un client Supabase doublé — session absente, erreur HTTP, succès ;
//   2. l'analyse statique des deux écrans : plus de fetch direct, plus d'URL en
//      dur, aucun en-tête d'autorisation fabriqué à la main.
//
// Aucun réseau, aucune base, aucun déploiement.
//   node scripts/verif-analyse-commande-session.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lire = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const cas = [];
const test = (nom, fn) => cas.push([nom, fn]);

const COMMANDES = lire("src/Renovation/Commandes.jsx");
const CAPTURE = lire("src/Renovation/CaptureCommandeMobile.jsx");
const CLIENT = lire("src/supabase.js");
const sansCommentaires = (src) => src.split("\n")
  .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
  .join("\n");
const COMMANDES_CODE = sansCommentaires(COMMANDES);
const CAPTURE_CODE = sansCommentaires(CAPTURE);

// ═══════════════════════════════════════════════════════════════════════════
// 1. COMPORTEMENT DE invoquerFonction — exécuté pour de vrai
// ═══════════════════════════════════════════════════════════════════════════
// src/supabase.js crée le client au chargement du module à partir de
// import.meta.env : on ne peut pas l'importer sous Node. On réimplémente donc
// l'appelant MINIMAL ici, à partir du code source réel du helper, et on vérifie
// que ce code contient bien les garde-fous testés.

/** Reproduit invoquerFonction() sur un client doublé. */
function faireInvoquer(client) {
  return async function invoquerFonction(nom, body) {
    const { data: { session } } = await client.auth.getSession();
    if (!session) throw new Error("Session expirée : reconnectez-vous pour relancer l'opération.");
    const { data, error } = await client.functions.invoke(nom, { body });
    if (error) {
      let corps = null;
      try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
      const message = corps?.error?.message
        || (typeof corps?.error === "string" ? corps.error : null)
        || error.message;
      throw new Error(message || "Erreur Edge Function");
    }
    if (data === null || data === undefined) throw new Error("Réponse vide de la fonction.");
    return data;
  };
}

const faireClient = ({ session = { access_token: "jeton" }, reponse = null } = {}) => {
  const appels = [];
  return {
    appels,
    auth: { getSession: async () => ({ data: { session } }) },
    functions: {
      invoke: async (nom, options) => {
        appels.push({ nom, options });
        return reponse ?? { data: { content: [] }, error: null };
      },
    },
  };
};

test("1. sans session : aucune invocation, message de reconnexion", async () => {
  const client = faireClient({ session: null });
  const invoquer = faireInvoquer(client);
  await assert.rejects(
    () => invoquer("analyse-commande", { images: [] }),
    (e) => {
      assert.match(e.message, /session expirée/i);
      assert.match(e.message, /reconnect/i);
      return true;
    },
  );
  assert.equal(client.appels.length, 0, "aucun appel réseau n'est tenté");
  // Et aucun repli anonyme : le helper ne rappelle pas invoke sans session.
  assert.ok(!/anon|apikey|Authorization/i.test(CLIENT.split("invoquerFonction")[1] || ""),
    "aucun repli anonyme ni en-tête fabriqué dans le helper");
});

test("2. session présente : invocation par NOM, corps transmis tel quel", async () => {
  const client = faireClient();
  const invoquer = faireInvoquer(client);
  const images = [{ base64: "AAAA", mediaType: "image/png" }];
  await invoquer("analyse-commande", { images });
  assert.equal(client.appels.length, 1);
  assert.equal(client.appels[0].nom, "analyse-commande", "appel par nom, pas par URL");
  assert.deepEqual(client.appels[0].options, { body: { images } }, "le corps est inchangé");
});

test("3. erreur Edge : le message du serveur prime sur le générique", async () => {
  // a. corps { error: { message } } — forme Anthropic.
  const a = faireInvoquer(faireClient({
    reponse: { data: null, error: { message: "générique", context: { json: async () => ({ error: { message: "Document illisible par l'IA." } }) } } },
  }));
  await assert.rejects(() => a("analyse-commande", {}), /Document illisible par l'IA\./);

  // b. corps { error: "texte" } — forme de la fonction elle-même.
  const b = faireInvoquer(faireClient({
    reponse: { data: null, error: { message: "générique", context: { json: async () => ({ error: "ANTHROPIC_KEY manquante" }) } } },
  }));
  await assert.rejects(() => b("analyse-commande", {}), /ANTHROPIC_KEY manquante/);

  // c. aucun corps exploitable : on retombe sur le message de l'erreur.
  const c = faireInvoquer(faireClient({
    reponse: { data: null, error: { message: "Edge Function returned a non-2xx status code" } },
  }));
  await assert.rejects(() => c("analyse-commande", {}), /non-2xx/);

  // d. corps illisible : jamais d'exception non rattrapée.
  const d = faireInvoquer(faireClient({
    reponse: { data: null, error: { message: "boum", context: { json: async () => { throw new Error("html"); } } } },
  }));
  await assert.rejects(() => d("analyse-commande", {}), /boum/);
});

test("4. réponse vide traitée comme une erreur, réponse réussie rendue telle quelle", async () => {
  const vide = faireInvoquer(faireClient({ reponse: { data: null, error: null } }));
  await assert.rejects(() => vide("analyse-commande", {}), /Réponse vide/);

  const charge = { content: [{ type: "text", text: '{"lignes":[]}' }] };
  const ok = faireInvoquer(faireClient({ reponse: { data: charge, error: null } }));
  assert.deepEqual(await ok("analyse-commande", {}), charge, "la réponse est rendue intacte");
});

test("5. le helper du dépôt contient bien ces garde-fous", () => {
  const h = CLIENT.slice(CLIENT.indexOf("export async function invoquerFonction"));
  assert.match(h, /auth\.getSession\(\)/);
  assert.match(h, /if \(!session\) throw new Error/);
  assert.match(h, /functions\.invoke\(nom, \{ body \}\)/);
  assert.match(h, /error\?\.context\?\.json/);
  assert.match(h, /corps\?\.error\?\.message/);
  // La vérification de session PRÉCÈDE l'invocation.
  assert.ok(h.indexOf("if (!session)") < h.indexOf("functions.invoke("),
    "la session est vérifiée avant tout appel");
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. LES DEUX ÉCRANS
// ═══════════════════════════════════════════════════════════════════════════
test("6. Commandes.jsx passe par functions.invoke, plus par fetch", () => {
  assert.match(COMMANDES_CODE, /invoquerFonction\("analyse-commande", \{ images \}\)/);
  assert.match(COMMANDES, /import \{ supabase, invoquerFonction \} from "\.\.\/supabase";/);
  assert.ok(!COMMANDES_CODE.includes("functions/v1/analyse-commande"), "aucune URL en dur");
  assert.ok(!/fetch\([^)]*analyse-commande/.test(COMMANDES_CODE), "aucun fetch direct");
});

test("7. CaptureCommandeMobile.jsx idem", () => {
  assert.match(CAPTURE_CODE, /invoquerFonction\("analyse-commande", \{ images \}\)/);
  assert.match(CAPTURE, /import \{ supabase, photoTransform, invoquerFonction \} from "\.\.\/supabase";/);
  assert.ok(!CAPTURE_CODE.includes("functions/v1/analyse-commande"), "aucune URL en dur");
  assert.ok(!CAPTURE_CODE.includes("EDGE_ANALYSE_COMMANDE"), "la constante d'URL a disparu");
  assert.ok(!/fetch\([^)]*analyse-commande/.test(CAPTURE_CODE), "aucun fetch direct");
});

test("8. aucune URL de cette fonction ni clé en dur, nulle part dans src/", () => {
  for (const [nom, src] of [["Commandes.jsx", COMMANDES_CODE], ["CaptureCommandeMobile.jsx", CAPTURE_CODE], ["supabase.js", sansCommentaires(CLIENT)]]) {
    assert.ok(!/functions\/v1\//.test(src), `${nom} : aucune URL de fonction en dur`);
    assert.ok(!/eyJ[A-Za-z0-9._-]{20,}/.test(src), `${nom} : aucun JWT`);
    assert.ok(!/sb_[A-Za-z0-9._-]{20,}/.test(src), `${nom} : aucune clé`);
    assert.ok(!/SERVICE_ROLE/i.test(src), `${nom} : aucun service_role`);
    assert.ok(!/"Authorization"\s*:|'Authorization'\s*:|Authorization:\s*`Bearer/.test(src),
      `${nom} : aucun en-tête d'autorisation fabriqué à la main`);
  }
});

test("9. le traitement de la réponse est inchangé des deux côtés", () => {
  // Même normalisation Anthropic, mêmes messages d'erreur métier.
  for (const [nom, src] of [["Commandes.jsx", COMMANDES_CODE], ["CaptureCommandeMobile.jsx", CAPTURE_CODE]]) {
    assert.ok(src.includes("data.content ? data : (data.data || data)"), `${nom} : normalisation conservée`);
    assert.ok(src.includes("Document illisible par l'IA."), `${nom} : message d'erreur conservé`);
    assert.ok(src.includes('replace(/```json|```/g, "")'), `${nom} : nettoyage du JSON conservé`);
  }
  // Commandes garde ses contrôles métier.
  assert.ok(COMMANDES_CODE.includes("Aucune ligne de produit détectée"));
  assert.ok(COMMANDES_CODE.includes("Format de réponse inattendu"));
  // Capture garde le sien.
  assert.ok(CAPTURE_CODE.includes("L'IA n'a rien renvoyé"));
  // Les états de chargement de Commandes sont intacts.
  assert.ok(COMMANDES_CODE.includes('setStep("analysing")'));
  assert.ok(COMMANDES_CODE.includes('setErreur("")'));
});

test("10. rien de serveur n'a bougé", () => {
  // Ce lot ne touche NI la fonction, NI config.toml, NI verify_jwt.
  const fn = lire("supabase/functions/analyse-commande/index.ts");
  assert.ok(!fn.includes("auth.getUser"), "la fonction distante n'est pas encore durcie — voulu");
  const cfg = lire("supabase/config.toml");
  assert.match(cfg, /\[functions\.analyse-commande\]\s*\nverify_jwt = true/,
    "config.toml reste tel quel : l'alignement est un lot séparé");
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
console.log(`\nverif-analyse-commande-session : ${cas.length - echecs}/${cas.length} contrôles passés`);
process.exit(echecs ? 1 : 0);
