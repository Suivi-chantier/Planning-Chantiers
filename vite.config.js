import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    react(),
    VitePWA({
      // On enregistre le service worker nous-mêmes (src/pwa.js) pour contrôler
      // le MOMENT du rechargement (auto-reload différé jusqu'à un instant sûr).
      // → pas d'injection auto, type "prompt" (pas de skipWaiting automatique).
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'icon.svg'],
      manifest: {
        name: 'Profero · Planning Chantiers',
        short_name: 'Profero Planning',
        description: 'Planning et suivi des chantiers Profero',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#080a0d',
        theme_color: '#080a0d',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Fichiers de build (JS/CSS hashés par Vite) → précache sûr : leur nom
        // change à chaque build, donc aucun risque de version coincée.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Le bundle principal dépasse 2 Mo (limite par défaut). On relève la limite
        // pour qu'il soit précaché (fichier hashé → cache sûr).
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // index.html toujours servi via le réseau d'abord (filet de secours hors-ligne).
        navigateFallback: '/index.html',
        clientsClaim: true,
        skipWaiting: false, // c'est NOUS qui décidons quand activer la MAJ
        runtimeCaching: [
          {
            // Images Supabase Storage : URLs uniques (chemins versionnés) → cache sûr,
            // gros gain en data mobile et en hors-ligne.
            urlPattern: /\/storage\/v1\/(object|render)\/(public|image)\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Tout le reste de Supabase (REST, auth, realtime) → JAMAIS en cache.
            // Les données métier restent toujours en direct.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\//i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Pas de SW en dev (évite les surprises de cache pendant le développement).
        enabled: false,
      },
    }),
  ],
})
