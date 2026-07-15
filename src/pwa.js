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
      // Filet anti-blocage : si une saisie (ou une clé « dirty » restée ouverte à
      // cause d'un bug) empêche l'application trop longtemps, on force au bout de
      // 3 min. Les brouillons sont sauvegardés en localStorage (useDraft) : aucune
      // perte même si le reload tombe pendant une frappe.
      setTimeout(() => { if (pending && applyUpdate) { pending = false; applyUpdate() } }, 3 * 60 * 1000)
    },
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return
      // Cas où un nouveau SW est DÉJÀ en attente au chargement (onNeedRefresh
      // parfois raté selon le timing) : on l'applique nous-mêmes.
      if (reg.waiting) {
        pending = true
        applyUpdate = () => updateSW(true)
        maybeApply()
      }
      const check = () => reg.update().catch(() => {})
      check() // vérifie tout de suite au démarrage
      // Puis toutes les 15 min…
      setInterval(check, 15 * 60 * 1000)
      // …et chaque fois que l'onglet/app reprend le focus ou redevient visible.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('focus', check)
    },
  })
}
