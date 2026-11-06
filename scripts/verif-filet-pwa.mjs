// Vérification du filet anti-écran-blanc (index.html).
// Panne du 2026-11-06 : la récupération automatique (purge du service worker,
// rechargement) a tourné deux fois sans débloquer le poste, laissant un écran
// blanc muet. Au deuxième échec dans la minute, un message visible doit
// apparaître avec un bouton qui purge et recharge.
// Contrôle statique + exécution du script du filet dans un faux DOM minimal.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
let ok = 0;
const ok_ = (c, m) => { assert.ok(c, m); ok++; };

// 1. Le filet reste le premier bloc <script> du <head>.
const head = html.slice(0, html.indexOf("</head>"));
// (le commentaire du filet cite « <script> » : on cherche la vraie balise)
const premierScript = head.search(/<script>\s*\(function/);
ok_(premierScript > 0 && head.indexOf("pwa_recovery_at") > premierScript, "le filet est le premier <script> du <head>");
ok_(premierScript < head.indexOf("<meta name=\"viewport\""), "le filet précède les autres balises");

// 2. Extraction et exécution du script dans un faux environnement.
const debut = premierScript + "<script>".length;
const code = html.slice(debut, html.indexOf("</script>", debut));

function environnement(dernierEchec) {
  const ecouteurs = {};
  const store = dernierEchec ? { pwa_recovery_at: String(dernierEchec) } : {};
  const corps = { enfants: [], appendChild(e) { this.enfants.push(e); } };
  const elements = {};
  const doc = {
    body: corps,
    createElement: () => {
      const e = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
      Object.defineProperty(e, "id", { set(v) { this._id = v; elements[v] = e; }, get() { return this._id; } });
      return e;
    },
    getElementById: (id) => elements[id] || (id === "filet-pwa-bouton" && elements["filet-pwa-message"] ? (elements["filet-pwa-bouton"] = {}) : null),
    addEventListener() {},
  };
  const remplacements = [];
  const win = {
    addEventListener: (t, f) => { (ecouteurs[t] ||= []).push(f); },
    location: { href: "https://exemple.test/", replace: (u) => remplacements.push(u) },
  };
  const fn = new Function("window", "document", "sessionStorage", "navigator", "caches", "console", "URL", "Promise", "Date", code);
  fn(win, doc, { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    { serviceWorker: null }, undefined, { warn() {} }, URL, Promise, Date);
  const echecScript = () => ecouteurs.error[0]({ target: { tagName: "SCRIPT", src: "https://exemple.test/assets/index-absent.js" } });
  return { echecScript, elements, remplacements, store };
}

// Premier échec : purge + rechargement, pas de message.
{
  const env = environnement(0);
  env.echecScript();
  await new Promise(r => setTimeout(r, 20));
  ok_(env.remplacements.length === 1 && /_r=/.test(env.remplacements[0]), "premier échec : rechargement avec paramètre anti-cache");
  ok_(!env.elements["filet-pwa-message"], "premier échec : pas de message");
}
// Deuxième échec dans la minute : message visible, pas de boucle de rechargement.
{
  const env = environnement(Date.now() - 5000);
  env.echecScript();
  await new Promise(r => setTimeout(r, 20));
  ok_(env.remplacements.length === 0, "deuxième échec : pas de nouveau rechargement automatique");
  const msg = env.elements["filet-pwa-message"];
  ok_(!!msg, "deuxième échec : message visible au lieu d'un écran blanc");
  ok_(/Effacer la mémoire et recharger/.test(msg.innerHTML), "le message propose le bouton de réparation");
  ok_(/Vos données ne sont pas touchées/.test(msg.innerHTML), "le message rassure sur les données");
}

console.log(`verif-filet-pwa : ${ok} contrôles OK`);
