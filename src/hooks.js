// Hooks de protection des saisies face aux rechargements (MAJ PWA, refresh,
// navigateur tué par Android, crash…).
//
//  - useDraft     : état de formulaire persisté en localStorage + restauré au montage.
//                   À utiliser pour les formulaires qui ne s'autosauvegardent PAS
//                   déjà dans Supabase.
//  - useDirtyGuard: bloque l'auto-reload tant qu'un état est « modifié non enregistré »,
//                   sans persistance locale (pour les écrans qui sauvegardent déjà
//                   dans Supabase mais ont des modifs transitoires).

import { useEffect, useRef, useState } from 'react'
import { markDirty, markClean } from './pwa.js'

const PREFIX = 'draft:'

/**
 * Comme useState, mais :
 *  - restaure la valeur depuis localStorage au montage si un brouillon existe ;
 *  - sauvegarde la valeur (débouncée) à chaque modification ;
 *  - marque le formulaire « en cours » pour différer l'auto-reload pendant la saisie.
 *
 * Retour : [value, setValue, clear]
 *  - clear() : à appeler après un envoi RÉUSSI → efface le brouillon et débloque le reload.
 *
 * @param {string} key      clé unique et stable du formulaire (ex: "commande-nouvelle")
 * @param {*} initial       valeur initiale (ou fonction () => valeur)
 */
export function useDraft(key, initial) {
  const storageKey = PREFIX + key

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw != null) return JSON.parse(raw)
    } catch { /* brouillon illisible : on ignore */ }
    return typeof initial === 'function' ? initial() : initial
  })

  const mounted = useRef(false)
  const timer = useRef(null)

  useEffect(() => {
    // On ignore le premier passage (montage) : une valeur restaurée ou initiale
    // n'est pas une « saisie en cours ». Seules les modifs réelles comptent.
    if (!mounted.current) { mounted.current = true; return }

    markDirty(storageKey)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch { /* quota plein */ }
    }, 500)

    return () => clearTimeout(timer.current)
  }, [value, storageKey])

  // En quittant le formulaire sans avoir vidé le brouillon : on débloque le reload
  // mais on CONSERVE le brouillon en localStorage (restauré au prochain retour).
  useEffect(() => () => markClean(storageKey), [storageKey])

  const clear = () => {
    clearTimeout(timer.current)
    markClean(storageKey)
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
  }

  return [value, setValue, clear]
}

/**
 * Bloque l'auto-reload tant que `isDirty` est vrai. Sans persistance locale.
 * @param {string} key    clé unique de l'écran
 * @param {boolean} isDirty  y a-t-il des modifications non enregistrées ?
 */
export function useDirtyGuard(key, isDirty) {
  const k = 'guard:' + key
  useEffect(() => {
    if (isDirty) markDirty(k); else markClean(k)
    return () => markClean(k)
  }, [k, isDirty])
}

// ── Brouillons à clé DYNAMIQUE (loadDraft / saveDraft / clearDraft) ─────────
// useDraft exige une clé fixée au montage. Dans les gros écrans Invest, un même
// composant enchaîne les entités (prospect A → prospect B, client X → client Y) :
// la clé du brouillon change en cours de vie. Ces helpers manipulent les mêmes
// entrées localStorage (préfixe draft:) mais laissent le composant décider
// QUAND charger / sauver / vider.
//
// Le blocage de l'auto-reload pendant la frappe est assuré par le garde global
// DOM de src/pwa.js : ces helpers ne touchent pas au registre dirty.
//
// Motifs d'usage :
//  - formulaire de CRÉATION : sauver quand il est non vide, vider sinon
//      useEffect(() => { estVide ? clearDraft(k) : saveDraft(k, form) }, [form])
//  - formulaire d'ÉDITION : sauver quand il diffère de la version hydratée
//    (snapshot JSON gardé en ref), vider quand il est revenu à l'identique.

const draftTimers = new Map()

/** Lit un brouillon (null si absent ou illisible). */
export function loadDraft(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw != null ? JSON.parse(raw) : null
  } catch { return null }
}

/** Sauvegarde (débouncée 500 ms) un brouillon. */
export function saveDraft(key, value) {
  const k = PREFIX + key
  clearTimeout(draftTimers.get(k))
  draftTimers.set(k, setTimeout(() => {
    draftTimers.delete(k)
    try { localStorage.setItem(k, JSON.stringify(value)) } catch { /* quota plein */ }
  }, 500))
}

/** Efface un brouillon (à appeler après un envoi RÉUSSI, ou quand la saisie est vide). */
export function clearDraft(key) {
  const k = PREFIX + key
  clearTimeout(draftTimers.get(k))
  draftTimers.delete(k)
  try { localStorage.removeItem(k) } catch { /* ignore */ }
}
