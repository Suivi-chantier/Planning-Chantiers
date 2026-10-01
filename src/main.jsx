import React from 'react'
import ReactDOM from 'react-dom/client'
import { initPWA } from './pwa.js'

// /espace-client = espace des clients Profero Invest (lecture seule, sa propre page).
// Tout le reste = application collaborateurs, inchangée. Les deux sont chargées à la
// demande : un client ne télécharge pas le code du bureau, et inversement. Le service
// worker du bureau n'est pas enregistré depuis le portail (voir navigateFallbackDenylist
// dans vite.config.js).
const estPortailClient = /^\/espace-client(\/|$)/.test(window.location.pathname)

if (!estPortailClient) initPWA()

const Racine = React.lazy(() =>
  estPortailClient ? import('./Portail/PortailClient.jsx') : import('./App.jsx')
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <React.Suspense fallback={null}><Racine /></React.Suspense>
  </React.StrictMode>
)
