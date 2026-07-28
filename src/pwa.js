// Service worker + auto-reload INTELLIGENT.
//
// Objectif : appliquer automatiquement les nouvelles versions déployées
// SANS jamais interrompre une saisie en cours.
//
// Principe :
//  - Un registre global des formulaires « en cours de saisie » (dirty).
//    Deux sources alimentent ce registre :
//      a) les hooks useDraft/useDirtyGuard posés formulaire par formulaire
//         (écrans Renovation) ;
//      b) un GARDE GLOBAL au niveau du DOM (ci-dessous) : champ éditable
//         focalisé ou frappe récente → saisie en cours. Il couvre les pans
//         de l'app non instrumentés (Profero Invest notamment).
//  - Quand une nouvelle version est détectée, on la retient.
//  - On recharge seulement quand PLUS RIEN n'est en cours (dirty vide).
//    → si l'utilisateur tape, on attend qu'il ait fini/enregistré.
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
// inactivité totale. Jamais pendant que quelqu'un utilise l'app (l'ancien
// délai fixe de 3 min rechargeait en pleine frappe sur les écrans sans
// brouillon localStorage, comme Profero Invest).
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
