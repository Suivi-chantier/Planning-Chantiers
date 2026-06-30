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
