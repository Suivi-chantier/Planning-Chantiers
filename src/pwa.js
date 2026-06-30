// Service worker + auto-reload INTELLIGENT.
//
// Objectif : appliquer automatiquement les nouvelles versions déployées
// SANS jamais interrompre une saisie en cours.
//
// Principe :
//  - Un registre global des formulaires « en cours de saisie » (dirty).
//  - Quand une nouvelle version est détectée, on la retient.
//  - On recharge seulement quand PLUS RIEN n'est en cours (dirty vide).
//    → si l'ouvrier tape, on attend qu'il ait fini/enregistré.
//  - Filet complémentaire : le hook useDraft (src/hooks.js) sauvegarde les
//    saisies en localStorage, donc même un reload imprévu ne perd rien.

import { registerSW } from 'virtual:pwa-register'

const dirty = new Set()
let pending = false           // une nouvelle version attend d'être appliquée
let applyUpdate = null        // () => active le nouveau SW et recharge la page

/** Signale qu'une saisie est en cours pour cette clé (bloque le reload auto). */
export function markDirty(key) {
  dirty.add(key)
}

/** Signale que la saisie de cette clé est terminée/enregistrée. */
export function markClean(key) {
  dirty.delete(key)
  maybeApply()
}

/** Y a-t-il au moins une saisie en cours ? */
export function isBusy() {
  return dirty.size > 0
}

function maybeApply() {
  if (pending && dirty.size === 0 && applyUpdate) {
    pending = false
    applyUpdate()
  }
}

let started = false

/** À appeler une fois au démarrage de l'app. */
export function initPWA() {
  if (started || typeof window === 'undefined') return
  started = true

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Nouvelle version prête. On l'applique dès qu'aucune saisie n'est en cours.
      pending = true
      applyUpdate = () => updateSW(true) // skipWaiting + reload
      maybeApply()
    },
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return
      // Vérifie l'arrivée de nouveaux déploiements toutes les 30 min…
      setInterval(() => { reg.update().catch(() => {}) }, 30 * 60 * 1000)
      // …et chaque fois que l'onglet/app redevient actif.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {})
      })
    },
  })
}
