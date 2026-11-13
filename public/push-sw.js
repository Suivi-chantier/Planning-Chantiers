/* public/push-sw.js — notifications sur téléphone (push PWA).
 *
 * Chargé dans le service worker généré par Workbox (vite.config.js,
 * workbox.importScripts: ['push-sw.js']). On reste en mode generateSW : ce
 * fichier n'ajoute QUE deux écouteurs, il ne touche ni au précache, ni à la
 * mise à jour différée (pas de skipWaiting), ni aux previews Vercel (où
 * src/pwa.js désinscrit le service worker : aucune notification n'y arrive).
 *
 *  - push              : affiche la notification (titre, texte, icône, lien).
 *  - notificationclick : met au premier plan un onglet de l'application déjà
 *    ouvert, sinon ouvre une fenêtre sur l'adresse fournie.
 *
 * Choix : un onglet déjà ouvert n'est PAS rechargé de force vers l'adresse.
 * Recharger interromprait une saisie en cours, ce que src/pwa.js interdit
 * (même règle que la mise à jour différée). On met l'onglet au premier plan
 * et on lui transmet l'adresse par message (type « profero-notification ») ;
 * l'application s'y rend elle-même, sans rechargement (src/App.jsx,
 * lienVersNavigation de notificationsPushV1.mjs, tâche 3 du projet).
 */

self.addEventListener('push', function (event) {
  var donnees = {};
  try {
    donnees = event.data ? event.data.json() : {};
  } catch (e) {
    donnees = { body: event.data ? event.data.text() : '' };
  }
  var titre = donnees.title || 'Profero';
  var options = {
    body: donnees.body || '',
    icon: donnees.icon || '/pwa-192.png',
    badge: '/pwa-192.png',
    lang: 'fr',
    data: { url: donnees.url || '/' },
  };
  if (donnees.tag) options.tag = donnees.tag;
  event.waitUntil(self.registration.showNotification(titre, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var brute = (event.notification.data && event.notification.data.url) || '/';
  var cible;
  try {
    cible = new URL(brute, self.location.origin);
  } catch (e) {
    cible = new URL('/', self.location.origin);
  }
  // Jamais de redirection hors de l'application.
  if (cible.origin !== self.location.origin) cible = new URL('/', self.location.origin);

  event.waitUntil((async function () {
    var fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < fenetres.length; i++) {
      var c = fenetres[i];
      if (new URL(c.url).origin !== self.location.origin) continue;
      // L'espace client (portail) n'est pas l'application collaborateurs.
      if (new URL(c.url).pathname.indexOf('/espace-client') === 0) continue;
      if ('focus' in c) {
        await c.focus();
        try { c.postMessage({ type: 'profero-notification', url: cible.pathname + cible.search + cible.hash }); } catch (e) { /* onglet fermé entre-temps */ }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(cible.href);
  })());
});
