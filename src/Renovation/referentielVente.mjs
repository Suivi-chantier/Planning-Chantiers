// ─── RÉFÉRENTIELS DE VENTE — RÈGLES PURES PARTAGÉES ──────────────────────────
// Les taux horaires de vente (taux_horaires_vente, € HT/h) et les coefficients
// de vente (coefficients_vente, × matériaux) suivent exactement les mêmes règles
// de gestion : liste avec un seul défaut actif, désactivation sans suppression,
// écriture réservée aux administrateurs. Ce module PUR (aucun accès Supabase)
// fabrique, pour chaque référentiel, le jeu de fonctions utilisé par Réglages,
// la fiche ouvrage et le Chiffrage. Les modules tauxHorairesVente.mjs et
// coefficientsVente.mjs n'en sont que des instances nommées.
//
// Les garanties fortes vivent en base (triggers, index unique, RLS) : ce module
// ne fait que les anticiper côté interface et ne remplace jamais le serveur.

import { num } from "./chiffragePricing.mjs";

const str = (v) => String(v ?? "").trim();

/**
 * @param {object} cfg
 *   nom            : "taux horaire" (singulier, pour les messages)
 *   nomPluriel     : "taux horaires"
 *   genre          : "m" | "f" (accords : « désactivé » / « désactivée »)
 *   champValeur    : colonne portant la valeur ("taux_ht" | "valeur")
 *   formaterValeur : (n) => "80,00 € HT/h" | "1,50"
 *   uniteCourte    : "€/h" | "×"
 *   validerValeur  : (v) => { valide, valeur, erreur }
 *   messageValeurInvalide : phrase pour la contrainte CHECK
 *   migration      : nom du fichier de migration à signaler si la table manque
 *   reglages       : "Réglages → Taux horaires → « Taux horaires de main-d'œuvre »"
 */
export function creerReferentielVente(cfg) {
  const { nom, nomPluriel, champValeur, formaterValeur, validerValeur, messageValeurInvalide, migration, reglages } = cfg;
  const desactive = cfg.genre === "f" ? "désactivée" : "désactivé";
  const un = cfg.genre === "f" ? "une" : "un";
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function libelle(item, { mentionInactif = true } = {}) {
    if (!item) return "—";
    const base = `${str(item.libelle) || "Sans libellé"} — ${formaterValeur(item[champValeur])}`;
    return mentionInactif && item.actif === false ? `${base} (${desactive})` : base;
  }

  function indexer(liste = []) {
    const map = new Map();
    (liste || []).forEach(t => { if (t && t.id != null) map.set(String(t.id), t); });
    return map;
  }

  function comparer(a, b) {
    if ((a?.est_defaut === true) !== (b?.est_defaut === true)) return a?.est_defaut ? -1 : 1;
    if ((a?.actif !== false) !== (b?.actif !== false)) return a?.actif !== false ? -1 : 1;
    return str(a?.libelle).localeCompare(str(b?.libelle), "fr");
  }

  /** Éléments actifs, triés : défaut d'abord, puis libellé. */
  function actifs(liste = []) {
    return (liste || []).filter(t => t && t.actif !== false).sort(comparer);
  }

  /** L'élément actif par défaut, ou null (état anormal signalé par l'interface). */
  function parDefaut(liste = []) {
    return (liste || []).find(t => t && t.est_defaut === true && t.actif !== false) ?? null;
  }

  /**
   * Options de la liste déroulante d'une fiche ouvrage : actifs + l'élément courant
   * de l'ouvrage s'il est désactivé (marqué), jamais les autres inactifs.
   */
  function optionsSelect(liste = [], idCourant = null) {
    const options = actifs(liste).map(t => ({ id: String(t.id), libelle: t.libelle, valeur: num(t[champValeur]), actif: true, est_defaut: t.est_defaut === true, texte: libelle(t), desactive: false }));
    const courant = idCourant != null ? indexer(liste).get(String(idCourant)) : null;
    if (courant && courant.actif === false) {
      options.push({ id: String(courant.id), libelle: courant.libelle, valeur: num(courant[champValeur]), actif: false, est_defaut: false, texte: libelle(courant), desactive: true });
    }
    return options;
  }

  /** Identifiant à présélectionner : celui de l'ouvrage (même désactivé), sinon le défaut actif. */
  function selectionne(liste = [], idCourant = null) {
    if (idCourant != null && indexer(liste).has(String(idCourant))) return String(idCourant);
    const d = parDefaut(liste);
    return d ? String(d.id) : null;
  }

  /** Le choix d'un ouvrage est-il enregistrable ? Existant et actif, sauf conservation de l'existant. */
  function validerChoixOuvrage(liste = [], idChoisi, idActuel = null) {
    if (idChoisi == null || str(idChoisi) === "") return { valide: false, erreur: `${cap(nom)} de vente obligatoire : sélectionner ${un} ${nom} dans la liste` };
    const t = indexer(liste).get(String(idChoisi));
    if (!t) return { valide: false, erreur: `${cap(nom)} inconnu${cfg.genre === "f" ? "e" : ""} : recharger la page puis choisir dans la liste` };
    if (t.actif === false && String(idChoisi) !== String(idActuel ?? "")) return { valide: false, erreur: `${cap(nom)} « ${t.libelle} » ${desactive} : choisir ${un} ${nom} actif${cfg.genre === "f" ? "ve" : ""}` };
    return { valide: true, erreur: null, item: t };
  }

  /** Contrôle d'un formulaire (ajout ou modification). */
  function validerSaisie(saisie = {}, liste = [], idEnCours = null) {
    const erreurs = [];
    const lib = str(saisie.libelle);
    if (!lib) erreurs.push("Le libellé est obligatoire");
    const v = validerValeur(saisie[champValeur]);
    if (!v.valide) erreurs.push(v.erreur);
    const doublon = (liste || []).find(x => x && String(x.id) !== String(idEnCours ?? "") && str(x.libelle).toLowerCase() === lib.toLowerCase());
    if (lib && doublon) erreurs.push(`${cap(un)} ${nom} « ${doublon.libelle} » existe déjà`);
    return { valide: erreurs.length === 0, erreurs, valeur: erreurs.length === 0 ? { libelle: lib, [champValeur]: v.valeur } : null };
  }

  function peutDesactiver(item, liste = []) {
    if (!item) return { ok: false, raison: `${cap(nom)} inconnu` };
    if (item.actif === false) return { ok: false, raison: `Ce ${nom} est déjà ${desactive}` };
    if (item.est_defaut) return { ok: false, raison: `Le ${nom} par défaut ne peut pas être ${desactive} : définir d'abord ${un} autre ${nom} actif par défaut` };
    const autres = (liste || []).filter(t => t && t.actif !== false && String(t.id) !== String(item.id));
    if (autres.length === 0) return { ok: false, raison: `Il doit rester au moins ${un} ${nom} actif` };
    return { ok: true, raison: null };
  }

  function peutReactiver(item) {
    if (!item) return { ok: false, raison: `${cap(nom)} inconnu` };
    if (item.actif !== false) return { ok: false, raison: `Ce ${nom} est déjà actif` };
    return { ok: true, raison: null };
  }

  function peutDefinirDefaut(item) {
    if (!item) return { ok: false, raison: `${cap(nom)} inconnu` };
    if (item.actif === false) return { ok: false, raison: `${cap(un)} ${nom} ${desactive} ne peut pas être le ${nom} par défaut : le réactiver d'abord` };
    if (item.est_defaut) return { ok: false, raison: `Ce ${nom} est déjà le ${nom} par défaut` };
    return { ok: true, raison: null };
  }

  /** Avertissement AVANT d'enregistrer une modification de valeur ; null si la valeur ne change pas. */
  function avertissementModification(ancien, nouvelleValeur, { nbOuvrages = null } = {}) {
    const a = num(ancien?.[champValeur]), n = num(nouvelleValeur);
    if (a == null || n == null || Math.abs(a - n) < 0.00005) return null;
    const tete = nbOuvrages != null
      ? `Ce ${nom} est utilisé par ${nbOuvrages} ouvrage${nbOuvrages > 1 ? "s" : ""}.\n\n`
      : "";
    return `${tete}Sa modification (${formaterValeur(a)} → ${formaterValeur(n)}) recalculera ${nbOuvrages != null ? "leur" : "le"} prix de vente ${nbOuvrages == null ? "des ouvrages qui l'utilisent " : ""}pour les futurs chiffrages. Les lignes et devis déjà figés ne seront pas modifiés.`;
  }

  /** Invariants de la liste (bandeau si la base est dans un état anormal). */
  function diagnostiquer(liste = []) {
    const a = actifs(liste);
    const defauts = (liste || []).filter(t => t && t.est_defaut === true);
    const problemes = [];
    if ((liste || []).length === 0) problemes.push(`Aucun ${nom} : la migration ${migration} n'a pas été appliquée`);
    else {
      if (a.length === 0) problemes.push(`Aucun ${nom} actif : aucun prix ne peut être calculé`);
      if (defauts.length === 0) problemes.push(`Aucun ${nom} par défaut : les nouveaux ouvrages n'auront pas de ${nom} présélectionné`);
      if (defauts.length > 1) problemes.push(`Plusieurs ${nomPluriel} par défaut : état incohérent`);
      if (defauts.some(t => t.actif === false)) problemes.push(`Le ${nom} par défaut est ${desactive} : état incohérent`);
    }
    return { ok: problemes.length === 0, problemes, nbActifs: a.length, defaut: parDefaut(liste), reglages };
  }

  /** Erreur PostgREST/Postgres → message clair ; jamais silencieux. */
  function messageErreur(error, { action = "L'enregistrement" } = {}) {
    if (!error) return null;
    const code = str(error.code);
    const brut = str(error.message) || str(error.details) || "erreur inconnue";
    if (code === "42501" || /row-level security|permission denied/i.test(brut)) {
      return `${action} a été refusé : la modification des ${nomPluriel} est réservée aux administrateurs.`;
    }
    if (code === "23505") {
      if (/defaut/i.test(brut)) return `${action} a échoué : il existe déjà ${un} ${nom} par défaut.`;
      if (/libelle/i.test(brut)) return `${action} a échoué : ${un} ${nom} porte déjà ce libellé.`;
      return `${action} a échoué : doublon (${brut}).`;
    }
    if (code === "23514") {
      if (new RegExp(champValeur, "i").test(brut)) return `${action} a échoué : ${messageValeurInvalide}`;
      if (/libelle/i.test(brut)) return `${action} a échoué : le libellé ne peut pas être vide.`;
      if (/defaut_actif/i.test(brut)) return `${action} a échoué : ${un} ${nom} ${desactive} ne peut pas être le ${nom} par défaut.`;
      return `${action} a échoué : contrainte non respectée (${brut}).`;
    }
    if (code === "23503") return `${action} a échoué : ce ${nom} n'existe pas (ou plus). Recharger la page.`;
    if (code === "P0001") return `${action} a échoué : ${brut}`;
    if (/PGRST|Failed to fetch|NetworkError/i.test(brut)) return `${action} a échoué : connexion à Supabase impossible (${brut}). Rien n'a été enregistré.`;
    return `${action} a échoué : ${brut}`;
  }

  return Object.freeze({
    cfg, libelle, indexer, comparer, actifs, parDefaut, optionsSelect, selectionne, validerChoixOuvrage,
    validerSaisie, peutDesactiver, peutReactiver, peutDefinirDefaut, avertissementModification, diagnostiquer, messageErreur,
  });
}
