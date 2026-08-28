// Service worker + auto-reload INTELLIGENT.
//
// Objectif : appliquer automatiquement les nouvelles versions déployées
// SANS jamais interrompre une saisie en cours.
//
// IMPORTANT : les previews Vercel sont volontairement exclues du mode PWA.
// Une branche de test peut être redéployée plusieurs fois en quelques minutes ;
// y conserver un service worker ferait courir le risque de servir un ancien
// bundle. Sur ces hôtes, on désinscrit donc le SW et son précache Workbox.
// La production conserve exactement le fonctionnement PWA ci-dessous.

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

// ── Previews Vercel : jamais pilotées par le service worker ─────────────────
function isVercelPreviewHost() {
  if (typeof window === 'undefined') return false
  const host = String(window.location.hostname || '').toLowerCase()
  if (!host.endsWith('.vercel.app')) return false

  // Alias de branche Vercel : planning-chantiers-git-feature-...vercel.app
  if (host.includes('-git-')) return true

  // URL de déploiement immuable :
  // planning-chantiers-95m81z4ig-suivi-chantiers-projects.vercel.app
  return /^planning-chantiers-[a-z0-9]+-suivi-chantiers-projects\.vercel\.app$/.test(host)
}

async function disablePreviewPWA() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(reg => reg.unregister()))
    }
  } catch (e) {
    console.warn('Nettoyage SW preview Vercel :', e?.message || e)
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(key => /workbox|precache/i.test(key))
          .map(key => caches.delete(key))
      )
    }
  } catch (e) {
    console.warn('Nettoyage cache preview Vercel :', e?.message || e)
  }
}

// ── Garde global de saisie (niveau DOM) ─────────────────────────────────────
// Indépendant des hooks React : tant qu'un champ éditable a le focus ou qu'une
// modification a eu lieu récemment, on considère qu'une saisie est en cours.
// C'est lui qui protège les écrans sans useDraft/useDirtyGuard (Invest…).

const KEY_SAISIE = 'global:saisie'
const GRACE_SAISIE = 5 * 60 * 1000  // relâche après 5 min sans AUCUNE activité
const FORCE_IDLE = 10 * 60 * 1000   // filet : force la MAJ après 10 min d'inactivité totale

let lastActivity = Date.now()       // dernière interaction utilisateur (frappe ou clic)
let saisieTimer = null

function isEditable(el) {
  if (!el || !el.tagName) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !/^(button|submit|reset|image)$/i.test(el.type)
  return !!el.isContentEditable
}

function holdSaisie() {
  markDirty(KEY_SAISIE)
  if (!saisieTimer) saisieTimer = setInterval(releaseSaisieIfIdle, 30 * 1000)
}

function releaseSaisieIfIdle() {
  // On garde le blocage tant qu'un champ est focalisé OU que l'utilisateur
  // reste actif (il est peut-être au milieu d'un formulaire à plusieurs champs).
  if (isEditable(document.activeElement)) return
  if (Date.now() - lastActivity < GRACE_SAISIE) return
  clearInterval(saisieTimer)
  saisieTimer = null
  markClean(KEY_SAISIE)
}

function initGlobalGuard() {
  const activity = () => { lastActivity = Date.now() }
  document.addEventListener('keydown', activity, true)
  document.addEventListener('pointerdown', activity, true)
  // Focus dans un champ, frappe ou modification (select, case à cocher…)
  // → saisie en cours. Capture: attrape aussi les champs rendus en portail.
  const onEdit = (e) => { if (isEditable(e.target)) { activity(); holdSaisie() } }
  document.addEventListener('focusin', onEdit, true)
  document.addEventListener('input', onEdit, true)
  document.addEventListener('change', onEdit, true)
}

// Filet anti-blocage : si une MAJ attend et qu'une clé « dirty » traîne (bug,
// modale laissée ouverte…), on force — mais UNIQUEMENT après une longue
// inactivité totale. Jamais pendant que quelqu'un utilise l'app.
let forceTimer = null
function startForceWatch() {
  if (forceTimer) return
  forceTimer = setInterval(() => {
    if (!pending || !applyUpdate) { clearInterval(forceTimer); forceTimer = null; return }
    if (Date.now() - lastActivity >= FORCE_IDLE) {
      clearInterval(forceTimer)
      forceTimer = null
      pending = false
      applyUpdate()
    }
  }, 60 * 1000)
}

let started = false

/** À appeler une fois au démarrage de l'app. */
export function initPWA() {
  if (started || typeof window === 'undefined') return
  started = true

  // Une preview sert à valider le code courant, jamais à tester l'offline.
  // On retire aussi une éventuelle ancienne inscription provenant d'un build
  // précédent de ce même hostname. Pas de reload forcé : le nettoyage prend
  // effet immédiatement pour les navigations suivantes.
  if (isVercelPreviewHost()) {
    void disablePreviewPWA()
    return
  }

  initGlobalGuard()

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Nouvelle version prête. On l'applique dès qu'aucune saisie n'est en cours.
      pending = true
      applyUpdate = () => updateSW(true) // skipWaiting + reload
      maybeApply()
      startForceWatch()
    },
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return
      // Cas où un nouveau SW est DÉJÀ en attente au chargement (onNeedRefresh
      // parfois raté selon le timing) : on l'applique nous-mêmes.
      if (reg.waiting) {
        pending = true
        applyUpdate = () => updateSW(true)
        maybeApply()
        startForceWatch()
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
