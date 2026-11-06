// ─────────────────────────────────────────────────────────────────────────────
// relancesCycleVie — QUI relancer, QUAND, et pourquoi pas (Refonte Opérations,
// lot 3). Deux relances par e-mail au chargé d'affaires du chantier :
//   - « devis »   : devis envoyé et pas encore signé ;
//   - « acompte » : facture d'acompte émise et pas encore réglée.
// Première relance au bout du délai réglé (7 jours par défaut, Réglages), puis
// une par semaine jusqu'à la signature / l'encaissement.
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun envoi. La date du
// jour, les réglages, le journal des relances déjà envoyées et l'adresse du
// chargé d'affaires arrivent en paramètre. Utilisé :
//   - par la tâche planifiée api/_cron/cron-relances-cycle-vie.js (envoi) ;
//   - par la fiche chantier (étapes « Relance devis » / « Relance acompte ») ;
//   - par la simulation du compte rendu (aucun envoi).
// Façade front : relancesCycleVie.js.
//
// INTERRUPTEUR : réglage planning_config « relances_cycle_vie » = { actif,
// delai_jours }. Absent, illisible ou actif ≠ true → ÉTEINT. Éteint, rien ne
// part (statut « desactivee »), mais l'écran dit toujours ce qui serait dû.
//
// ANTI-DOUBLON : une relance = (chantier, type, date de référence, période).
// La période 0 est la première relance (référence + délai), la 1 une semaine
// plus tard, etc. Une période déjà envoyée n'est jamais renvoyée ; une période
// manquée (tâche non passée) n'est pas rattrapée : on envoie la période en cours.
// ─────────────────────────────────────────────────────────────────────────────

import { etatsCycleVie, etatAcompteChantier } from "./cycleVie.mjs";
import { chargeAffairesEffectif, estChantierPerdu } from "./statutsChantier.mjs";
import { estChantierArchive } from "./chantierActif.mjs";

export const CLE_REGLAGES_RELANCES = "relances_cycle_vie";
export const DELAI_RELANCE_DEFAUT = 7;
export const INTERVALLE_RELANCE_JOURS = 7;
export const DELAI_RELANCE_MIN = 1;
export const DELAI_RELANCE_MAX = 60;
export const TYPES_RELANCE = Object.freeze(["devis", "acompte"]);

export const LIBELLES_RELANCE = Object.freeze({
  devis: Object.freeze({ objet: "devis non signé", etape: "Relance devis", reference: "envoi du devis", fin: "signature" }),
  acompte: Object.freeze({ objet: "facture d'acompte non réglée", etape: "Relance acompte", reference: "émission de la facture d'acompte", fin: "encaissement" }),
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const jour = (v) => {
  const s = String(v ?? "").slice(0, 10);
  return ISO.test(s) ? s : null;
};
const jj = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

/** Nombre de jours entre deux dates AAAA-MM-JJ (b − a), en UTC. */
export function joursEntre(a, b) {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.round((db - da) / 86400000);
}

export function ajouterJours(iso, n) {
  const d = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d)) return null;
  return new Date(d + n * 86400000).toISOString().slice(0, 10);
}

/** Réglages tolérants : tout ce qui n'est pas explicitement actif est éteint. */
export function lireReglagesRelances(valeur) {
  const v = valeur && typeof valeur === "object" && !Array.isArray(valeur) ? valeur : {};
  const d = Number.parseInt(v.delai_jours, 10);
  return {
    actif: v.actif === true,
    delaiJours: Number.isFinite(d) ? Math.min(DELAI_RELANCE_MAX, Math.max(DELAI_RELANCE_MIN, d)) : DELAI_RELANCE_DEFAUT,
  };
}

/** Lignes du journal envoyées pour ce chantier / type / référence. */
function envoyees(journal, { chantierId, type, reference }) {
  return (Array.isArray(journal) ? journal : []).filter((r) => r
    && String(r.chantier_id) === String(chantierId)
    && r.type === type
    && (reference == null || r.reference === reference)
    && r.statut === "envoyee");
}

/**
 * Décision pour UNE relance d'UN chantier.
 *   type           : "devis" | "acompte"
 *   chantierId
 *   reference      : date d'envoi du devis / d'émission de la facture (AAAA-MM-JJ) ou null
 *   termine        : devis signé / acompte encaissé
 *   perdu          : chantier marqué perdu (estChantierPerdu)
 *   chargeAffaires : { id, nom, email } — email `undefined` = non vérifié
 *                    (l'écran ne lit pas les adresses) ; null/"" = introuvable
 *   journal        : lignes de relances_cycle_vie (tous chantiers acceptés)
 *   reglages       : lireReglagesRelances(…)
 *   todayISO       : date du jour AAAA-MM-JJ (Paris)
 * → { statut, raison, periode, prochaineLe, nbEnvoyees, derniereLe, destinataire }
 *   statut : "terminee" | "perdu" | "sans_objet" | "impossible" | "en_attente"
 *          | "deja_envoyee" | "desactivee" | "a_envoyer"
 */
export function decisionRelance({
  type, chantierId, reference = null, termine = false, perdu = false,
  chargeAffaires = null, journal = [], reglages = lireReglagesRelances(null), todayISO,
} = {}) {
  const lib = LIBELLES_RELANCE[type] || LIBELLES_RELANCE.devis;
  const ref = jour(reference);
  const toutes = envoyees(journal, { chantierId, type, reference: null })
    .sort((a, b) => String(a.envoye_le || "").localeCompare(String(b.envoye_le || "")));
  const nbEnvoyees = toutes.length;
  const derniereLe = nbEnvoyees ? jour(toutes[nbEnvoyees - 1].envoye_le) : null;
  const base = { nbEnvoyees, derniereLe, periode: null, prochaineLe: null, destinataire: null };
  const sortie = (statut, raison, extra = {}) => ({ ...base, statut, raison, ...extra });

  if (termine) return sortie("terminee", `Relances arrêtées : ${lib.fin} constaté${type === "acompte" ? "" : "e"}.`);
  if (perdu) return sortie("perdu", "Aucune relance : chantier marqué perdu.");
  if (!ref) {
    return sortie("sans_objet", type === "devis"
      ? "Pas de relance tant que le devis n'est pas envoyé (étape « Devis envoyé »)."
      : "Pas de relance tant que la facture d'acompte n'est pas émise.");
  }
  if (!chargeAffaires || !chargeAffaires.id) {
    return sortie("impossible", "relance impossible : aucun chargé d'affaires");
  }
  if (chargeAffaires.email !== undefined && !String(chargeAffaires.email || "").trim()) {
    return sortie("impossible", `relance impossible : adresse e-mail du chargé d'affaires${chargeAffaires.nom ? ` (${chargeAffaires.nom})` : ""} introuvable ou compte inactif`);
  }
  if (!ISO.test(String(todayISO || ""))) return sortie("impossible", "Date du jour inconnue : décision impossible.");

  const delai = reglages?.delaiJours ?? DELAI_RELANCE_DEFAUT;
  const premiere = ajouterJours(ref, delai);
  const ecart = joursEntre(premiere, todayISO);
  if (ecart === null) return sortie("impossible", "Date de référence illisible.");
  if (ecart < 0) {
    return sortie("en_attente", `Première relance prévue le ${jj(premiere)} (${lib.reference} le ${jj(ref)} + ${delai} jours).`, { prochaineLe: premiere });
  }
  const periode = Math.floor(ecart / INTERVALLE_RELANCE_JOURS);
  const prochaineLe = ajouterJours(premiere, (periode + 1) * INTERVALLE_RELANCE_JOURS);
  const destinataire = chargeAffaires.email ? String(chargeAffaires.email).trim() : null;
  const deja = envoyees(journal, { chantierId, type, reference: ref }).some((r) => Number(r.periode) === periode);
  if (deja) {
    return sortie("deja_envoyee", `Relance de la semaine déjà envoyée ; prochaine le ${jj(prochaineLe)}.`, { periode, prochaineLe, destinataire });
  }
  if (!reglages?.actif) {
    return sortie("desactivee", `Relance due (${lib.objet} depuis le ${jj(ref)}), mais les relances automatiques sont désactivées dans les Réglages.`, { periode, prochaineLe, destinataire });
  }
  return sortie("a_envoyer", `Relance à envoyer : ${lib.objet} depuis le ${jj(ref)}.`, { periode, prochaineLe, destinataire });
}

/**
 * Références des deux relances d'un chantier, À PARTIR DES MÊMES DONNÉES que
 * la fiche chantier (une seule règle, écran et tâche planifiée) :
 *   etats   : états du nouveau cycle (cycleVie.etatsCycleVie(…).etats)
 *   acompte : cycleVie.etatAcompteChantier(…)
 * Devis   : référence = date d'import du devis envoyé (étape validée) ;
 *           terminé = « Devis signé » validé.
 * Acompte : référence = date d'émission de la facture d'acompte ;
 *           terminé = facture réglée, ou « Acompte encaissé » validé à la main.
 */
export function referencesRelances({ etats = {}, acompte = null } = {}) {
  const envoi = etats?.devis_envoye;
  return {
    devis: {
      reference: envoi?.fait ? jour(envoi.date) : null,
      termine: etats?.devis_signe?.fait === true,
    },
    acompte: {
      reference: acompte?.facture ? acompte.emiseLe || null : null,
      termine: !!(acompte?.encaisse || etats?.acompte_encaisse?.fait === true),
      billId: acompte?.billId ?? null,
      numero: acompte?.numero ?? null,
    },
  };
}

/** Adresse d'envoi d'un compte : actif, e-mail réel (pas un identifiant local). */
export function emailCompte(utilisateur) {
  if (!utilisateur || utilisateur.actif === false) return null;
  const e = String(utilisateur.email || "").trim();
  if (!e || !e.includes("@") || e.toLowerCase().endsWith("@profero.local")) return null;
  return e;
}

/**
 * Dossiers de relance de TOUS les chantiers, à partir des tables lues par la
 * tâche planifiée (mêmes règles que la fiche chantier) :
 *   chantiers, operations     : lignes des tables (non archivées retenues)
 *   lignesCycleVie            : chantier_cycle_vie
 *   phasages                  : { chantier_id, plan_travaux, updated_at } —
 *                               le plus récent par chantier (ancien cycle repris)
 *   factures, reglements      : chantier_factures_client / _reglements
 *   quoteParChantier          : { chantierId: quoteId ProGBat } (chiffrage rattaché)
 *   utilisateurs              : { id, email, actif }
 * → [{ chantierId, chantierNom, operationNom, perdu, chargeAffaires,
 *      devis: { reference, termine, quoteId }, acompte: { reference, termine, billId, numero } }]
 */
export function construireDossiersRelances({
  chantiers = [], operations = [], lignesCycleVie = [], phasages = [],
  factures = [], reglements = [], quoteParChantier = {}, utilisateurs = [],
} = {}) {
  const opParId = new Map((operations || []).map((o) => [o.id, o]));
  const userParId = new Map((utilisateurs || []).map((u) => [String(u.id), u]));
  const phasageParChantier = new Map();
  (phasages || []).forEach((ph) => {
    if (!ph?.chantier_id) return;
    const cur = phasageParChantier.get(ph.chantier_id);
    if (!cur || String(ph.updated_at || "") > String(cur.updated_at || "")) phasageParChantier.set(ph.chantier_id, ph);
  });
  const grouper = (liste, cle) => {
    const m = new Map();
    (liste || []).forEach((x) => { const k = x?.[cle]; if (k == null) return; if (!m.has(String(k))) m.set(String(k), []); m.get(String(k)).push(x); });
    return m;
  };
  const lignesPar = grouper(lignesCycleVie, "chantier_id");
  const facturesPar = grouper(factures, "chantier_id");

  return (chantiers || []).filter((c) => c && c.id && !estChantierArchive(c)).map((c) => {
    const op = opParId.get(c.operation_id) || null;
    const meta = phasageParChantier.get(c.id)?.plan_travaux?.meta || null;
    const { etats } = etatsCycleVie({ meta, lignes: lignesPar.get(String(c.id)) || [] });
    const fc = facturesPar.get(String(c.id)) || [];
    const ids = new Set(fc.map((f) => String(f.id)));
    const acompte = etatAcompteChantier({ factures: fc, reglements: (reglements || []).filter((r) => ids.has(String(r.facture_id))) });
    const refs = referencesRelances({ etats, acompte });
    const ca = chargeAffairesEffectif(c, op);
    return {
      chantierId: c.id, chantierNom: c.nom || c.id, operationNom: op?.nom || null,
      perdu: estChantierPerdu(c),
      chargeAffaires: ca.id ? { id: ca.id, nom: ca.nom, email: emailCompte(userParId.get(String(ca.id))) } : null,
      devis: { ...refs.devis, quoteId: quoteParChantier?.[c.id] ?? acompte.quoteId ?? null },
      acompte: refs.acompte,
    };
  });
}

/**
 * Plan d'envoi de la tâche planifiée (et de la simulation).
 *   dossiers : [{ chantierId, chantierNom, operationNom, perdu, chargeAffaires,
 *                 devis: { reference, termine, quoteId },
 *                 acompte: { reference, termine, billId, numero } }]
 * → { aEnvoyer: [{ chantierId, type, reference, periode, destinataire, dossier }],
 *     parStatut: { statut: nombre }, decisions: [...] }
 * Réglages éteints → aEnvoyer est TOUJOURS vide.
 */
export function planifierRelances({ dossiers = [], journal = [], reglages, todayISO } = {}) {
  const r = reglages || lireReglagesRelances(null);
  const decisions = [];
  const parStatut = {};
  const aEnvoyer = [];
  (Array.isArray(dossiers) ? dossiers : []).forEach((d) => {
    TYPES_RELANCE.forEach((type) => {
      const source = d?.[type] || {};
      const dec = decisionRelance({
        type, chantierId: d.chantierId, reference: source.reference, termine: !!source.termine,
        perdu: !!d.perdu, chargeAffaires: d.chargeAffaires, journal, reglages: r, todayISO,
      });
      decisions.push({ chantierId: d.chantierId, type, ...dec });
      parStatut[dec.statut] = (parStatut[dec.statut] || 0) + 1;
      if (dec.statut === "a_envoyer" && r.actif) {
        aEnvoyer.push({ chantierId: d.chantierId, type, reference: jour(source.reference), periode: dec.periode, destinataire: dec.destinataire, dossier: d });
      }
    });
  });
  return { aEnvoyer, parStatut, decisions };
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/**
 * Contenu de l'e-mail d'une relance. `lien` = résultat de lienProgbat(…)
 * (module progbatLiens) : { url, libelle, titre, raison }.
 * → { subject, html }
 */
export function contenuEmailRelance({ type, dossier, periode, lien, delaiJours = DELAI_RELANCE_DEFAUT, todayISO }) {
  const lib = LIBELLES_RELANCE[type] || LIBELLES_RELANCE.devis;
  const ref = jour(dossier?.[type]?.reference);
  const jours = ref && todayISO ? joursEntre(ref, todayISO) : null;
  const nom = dossier?.chantierNom || "Chantier";
  const op = dossier?.operationNom ? `${dossier.operationNom} › ` : "";
  const subject = `Relance ${lib.objet} — ${op}${nom}`;
  const titre = type === "devis" ? "Devis envoyé, toujours pas signé" : "Facture d'acompte émise, toujours pas réglée";
  const detail = type === "devis"
    ? `Le devis du chantier <strong>${esc(op)}${esc(nom)}</strong> a été envoyé le <strong>${esc(jj(ref))}</strong>${jours != null ? ` (il y a ${jours} jours)` : ""} et n'est pas encore signé.`
    : `La facture d'acompte${dossier?.acompte?.numero ? ` <strong>${esc(dossier.acompte.numero)}</strong>` : ""} du chantier <strong>${esc(op)}${esc(nom)}</strong> a été émise le <strong>${esc(jj(ref))}</strong>${jours != null ? ` (il y a ${jours} jours)` : ""} et n'est pas encore réglée.`;
  const bouton = lien?.url
    ? `<p style="margin:18px 0"><a href="${esc(lien.url)}" style="background:#FFC200;color:#080a0d;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">${esc(lien.libelle || "Ouvrir dans ProGBat")}</a></p>
       <p style="margin:0;color:#888;font-size:12px">${esc(lien.raison ? `${lien.raison} ` : "")}Le lien n'ouvre la bonne fiche que si l'entreprise « PROFERO RENOVATION » est active dans ProGBat.</p>`
    : `<p style="margin:12px 0;color:#b45309">Lien ProGBat indisponible : ${esc(lien?.raison || "identifiant ProGBat inconnu")}</p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
  <div style="background:#080a0d;padding:22px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
    <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero · Relance ${esc(periode != null ? `n° ${periode + 1}` : "")}</div>
    <div style="color:#fff;font-size:19px;font-weight:800">${esc(titre)}</div>
  </div>
  <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:22px;font-size:14px;line-height:1.7">
    <p style="margin:0 0 10px">${detail}</p>
    <p style="margin:0;color:#666">Vous recevez ce rappel en tant que chargé d'affaires du chantier : première relance ${esc(delaiJours)} jours après l'${esc(lib.reference)}, puis une par semaine jusqu'à la ${esc(lib.fin)}.</p>
    ${bouton}
  </div>
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">E-mail automatique · Relances réglables dans Réglages → Relances</div>
</div>`;
  return { subject, html };
}
