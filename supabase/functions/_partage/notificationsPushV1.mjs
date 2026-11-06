// supabase/functions/_partage/notificationsPushV1.mjs
//
// Moteur PUR des notifications (projet docs/projets/notifications-push.md,
// tâche 2). Aucun accès Supabase, aucune horloge, aucun effet de bord : l'Edge
// Function send-push lit les réglages, les utilisateurs, les préférences et
// les appareils, fournit l'heure, puis demande ici qui reçoit quoi et quand.
//
// Partagé tel quel par :
//   - Deno : supabase/functions/send-push et notifications-boite ;
//   - le front : façade src/notificationsPushV1.js (`export * from …`) ;
//   - Node : scripts/verif-notifications-push.mjs.
//
// Ce que ce module décide :
//   1. les RÉGLAGES (planning_config, clé « notifications_push ») ramenés à une
//      forme sûre : interrupteur général coupé par défaut, un réglage par type
//      C1 à D4 (actif + rôles destinataires), plage de silence. Le rôle
//      « ouvrier » est retiré même s'il a été coché à la main en base (règle 1) ;
//   2. les DESTINATAIRES : utilisateurs actifs des rôles cochés, avec un compte
//      de connexion, jamais ouvrier, rattachés à la Rénovation ;
//   3. le MOMENT : maintenant, ou reporté au prochain créneau autorisé (heure de
//      Paris, changement d'heure compris) ;
//   4. le REGROUPEMENT : une notification par utilisateur, par type et par
//      créneau (cle_regroupement) ; un second passage ne crée aucun doublon ;
//   5. un RÉSUMÉ (destinataires par rôle, envoyés, reportés, ignorés) qui sert
//      aussi aux simulations.
//
// Une impossibilité reste visible : chaque cas a son propre push_statut
// (« reporte », « aucun_appareil », « desactive », « serveur_non_configure »…),
// jamais un faux « envoye ».

export const CLE_REGLAGES = "notifications_push";
export const ROLE_EXCLU = "ouvrier";
export const TYPE_TEST = "test";

/**
 * Catalogue décidé par Loris (cahier du projet). `roles` = destinataires par
 * défaut, modifiables dans Réglages › Notifications. `push: false` = boîte de
 * réception seulement (D4).
 */
export const CATALOGUE = Object.freeze([
  { code: "C1", libelle: "Point comptes rendus de 18h30", roles: ["conducteur"], push: true },
  { code: "C2", libelle: "Demandes de matériel des ouvriers", roles: ["conducteur"], push: true },
  { code: "C3", libelle: "Matériaux à commander", roles: ["conducteur"], push: true },
  { code: "C4", libelle: "Chantier passé en alerte critique", roles: ["conducteur"], push: true },
  { code: "C5", libelle: "Chantier passé en alerte « à surveiller »", roles: ["conducteur"], push: true },
  { code: "F1", libelle: "Facture de situation à émettre", roles: ["comptable"], push: true },
  { code: "F2", libelle: "Encours fournisseurs du vendredi", roles: ["comptable"], push: true },
  { code: "D1", libelle: "Marge à terminaison devenue négative", roles: ["admin"], push: true },
  { code: "D2", libelle: "Nouveau chantier signé", roles: ["admin", "conducteur"], push: true },
  { code: "D3", libelle: "Synthèse de la semaine", roles: ["admin"], push: true },
  { code: "D4", libelle: "Écart du contrôle du journal d'avancement", roles: ["admin"], push: false },
].map((t) => Object.freeze({ ...t, roles: Object.freeze([...t.roles]) })));

export const CODES_TYPES = Object.freeze(CATALOGUE.map((t) => t.code));
export const typeDuCatalogue = (code) => CATALOGUE.find((t) => t.code === code) || null;

export const JOURS = Object.freeze(["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"]);
export const SILENCE_DEFAUT = Object.freeze({ debut: "20:00", fin: "07:00", jours: Object.freeze(["samedi", "dimanche"]) });

/** Toutes les valeurs que peut prendre notifications.push_statut. */
export const PUSH_STATUTS = Object.freeze([
  "a_envoyer",             // écrit en boîte, envoi en cours
  "envoye",                // au moins un appareil a accepté
  "echec",                 // aucun appareil n'a accepté (erreur du service push)
  "reporte",               // plage de silence : part à push_prevu_le
  "aucun_creneau",         // plage de silence sans aucun créneau dans les 8 jours (réglage incohérent)
  "aucun_appareil",        // personne n'a activé les notifications sur un appareil
  "desactive",             // préférence personnelle coupée pour ce type
  "boite_seule",           // type sans push (D4)
  "serveur_non_configure", // clés VAPID absentes du serveur
  "annule",                // reporté, mais l'interrupteur ou le type a été coupé entre-temps
]);

// ─── Réglages ───────────────────────────────────────────────────────────────

/** Réglages livrés : interrupteur général COUPÉ, catalogue par défaut. */
export function reglagesParDefaut() {
  const types = {};
  for (const t of CATALOGUE) types[t.code] = { actif: true, roles: [...t.roles] };
  return { actif: false, types, silence: { ...SILENCE_DEFAUT, jours: [...SILENCE_DEFAUT.jours] } };
}

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const nettoyerRole = (r) => String(r ?? "").trim().toLowerCase();

/**
 * Ramène la valeur brute de planning_config à une forme sûre. Absente ou
 * illisible → valeurs par défaut (interrupteur coupé). Ce qui est retiré ou
 * remplacé est listé dans `avertissements` (jamais en silence).
 */
export function normaliserReglages(brut) {
  const def = reglagesParDefaut();
  const avertissements = [];
  const src = brut && typeof brut === "object" && !Array.isArray(brut) ? brut : null;
  if (!src) return { ...def, avertissements, source: "defaut" };

  const actif = src.actif === true;
  const types = {};
  for (const t of CATALOGUE) {
    const b = src.types && typeof src.types === "object" ? src.types[t.code] : undefined;
    if (!b || typeof b !== "object") { types[t.code] = def.types[t.code]; continue; }
    const roles = Array.isArray(b.roles) ? b.roles.map(nettoyerRole).filter(Boolean) : [...t.roles];
    if (roles.includes(ROLE_EXCLU)) avertissements.push(`${t.code} : rôle « ouvrier » retiré (aucune notification aux ouvriers).`);
    types[t.code] = {
      actif: b.actif !== false,
      roles: [...new Set(roles.filter((r) => r !== ROLE_EXCLU))],
    };
  }

  const s = src.silence && typeof src.silence === "object" ? src.silence : {};
  const debut = HEURE.test(String(s.debut ?? "")) ? s.debut : SILENCE_DEFAUT.debut;
  const fin = HEURE.test(String(s.fin ?? "")) ? s.fin : SILENCE_DEFAUT.fin;
  if (s.debut !== undefined && debut !== s.debut) avertissements.push("Début de la plage de silence illisible : 20:00 retenu.");
  if (s.fin !== undefined && fin !== s.fin) avertissements.push("Fin de la plage de silence illisible : 07:00 retenu.");
  const jours = Array.isArray(s.jours)
    ? [...new Set(s.jours.map(nettoyerRole).filter((j) => JOURS.includes(j)))]
    : [...SILENCE_DEFAUT.jours];
  return { actif, types, silence: { debut, fin, jours }, avertissements, source: "base" };
}

// ─── Heure de Paris (sans horloge : l'instant arrive en paramètre) ───────────

const FORMAT_PARIS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});
const MINUTE = 60_000;
const JOUR_MS = 86_400_000;

/** Jour de la semaine (0 = dimanche) d'une date civile, sans objet Date. */
function jourSemaine(annee, mois, jour) {
  const jours = Math.floor(Date.UTC(annee, mois - 1, jour) / JOUR_MS);
  return ((jours % 7) + 7 + 4) % 7; // 01/01/1970 = jeudi
}

/** Instant (millisecondes UTC) → date et heure civiles à Paris. */
export function partiesParis(ms) {
  const p = {};
  for (const x of FORMAT_PARIS.formatToParts(ms)) p[x.type] = x.value;
  const annee = +p.year, mois = +p.month, jour = +p.day;
  const js = jourSemaine(annee, mois, jour);
  return { annee, mois, jour, heure: +p.hour, minute: +p.minute, jourSemaine: js, nomJour: JOURS[js] };
}

/** Décalage de Paris par rapport à UTC à cet instant (ms : +1 h l'hiver, +2 h l'été). */
function decalageParis(ms) {
  const p = partiesParis(ms);
  const arrondi = Math.floor(ms / MINUTE) * MINUTE;
  return Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute) - arrondi;
}

/** Heure civile de Paris → instant UTC (ms). Changement d'heure compris. */
export function parisVersUtcMs(annee, mois, jour, heure, minute) {
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute);
  const d1 = decalageParis(naif - 2 * 3_600_000);
  const essai = naif - d1;
  const d2 = decalageParis(essai);
  return d2 === d1 ? essai : naif - d2;
}

const enMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** L'instant tombe-t-il dans la plage de silence (heure de Paris) ? */
export function estEnSilence(ms, silence = SILENCE_DEFAUT) {
  const p = partiesParis(ms);
  if ((silence.jours || []).includes(p.nomJour)) return true;
  const m = p.heure * 60 + p.minute;
  const d = enMinutes(silence.debut), f = enMinutes(silence.fin);
  if (d === f) return false;
  return d > f ? (m >= d || m < f) : (m >= d && m < f);
}

/**
 * Prochain instant autorisé (ms UTC), l'instant lui-même s'il est autorisé.
 * null si aucun créneau dans les 8 jours (tous les jours bloqués) : c'est une
 * impossibilité, à afficher comme telle.
 */
export function prochainCreneau(ms, silence = SILENCE_DEFAUT) {
  if (!estEnSilence(ms, silence)) return ms;
  const p = partiesParis(ms);
  const reprise = silence.debut === silence.fin ? "00:00" : silence.fin;
  const [h, mi] = reprise.split(":").map(Number);
  for (let i = 0; i <= 8; i++) {
    const jourUtc = Date.UTC(p.annee, p.mois - 1, p.jour + i);
    const cal = partiesCivilesUtc(jourUtc);
    const candidat = parisVersUtcMs(cal.annee, cal.mois, cal.jour, h, mi);
    if (candidat > ms && !estEnSilence(candidat, silence)) return candidat;
  }
  return null;
}

function partiesCivilesUtc(msMinuitUtc) {
  // Décompose un minuit UTC en date civile, sans objet Date (algorithme des jours civils).
  const z = Math.floor(msMinuitUtc / JOUR_MS) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const jour = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mois = mp + (mp < 10 ? 3 : -9);
  const annee = yoe + era * 400 + (mois <= 2 ? 1 : 0);
  return { annee, mois, jour };
}

/** Clé de regroupement par défaut : une notification par type et par jour (Paris). */
export function cleRegroupementParDefaut(type, ms) {
  const p = partiesParis(ms);
  const dd = (n) => String(n).padStart(2, "0");
  return `${type}:${p.annee}-${dd(p.mois)}-${dd(p.jour)}`;
}

// ─── Destinataires ──────────────────────────────────────────────────────────

/** La préférence personnelle est-elle active ? Par défaut, oui (règle 6). */
export function preferenceActive(preferencesUtilisateur, type) {
  const p = preferencesUtilisateur && typeof preferencesUtilisateur === "object" ? preferencesUtilisateur : {};
  return p[type] !== false;
}

/** Préférences envoyées par le navigateur → { C1: bool, … } (types du catalogue seulement). */
export function validerPreferences(corps) {
  const src = corps?.types;
  if (!src || typeof src !== "object" || Array.isArray(src)) return { ok: false, erreur: "Préférences illisibles." };
  const types = {};
  for (const [code, v] of Object.entries(src)) {
    if (!CODES_TYPES.includes(code)) return { ok: false, erreur: `Type de notification inconnu : ${code}.` };
    if (typeof v !== "boolean") return { ok: false, erreur: `Valeur invalide pour ${code}.` };
    types[code] = v;
  }
  return { ok: true, types };
}

const estRenovation = (u) => {
  const b = Array.isArray(u?.branches) ? u.branches : null;
  return !b || b.length === 0 || b.includes("renovation");
};

/**
 * Utilisateurs concernés par un type, d'après les rôles cochés.
 * @param {{ reglages, type: string, utilisateurs: Array<{auth_id?: string|null, email?: string, nom?: string, role: string, actif: boolean, branches?: string[]}> }} p
 */
export function destinataires({ reglages, type, utilisateurs }) {
  const r = reglages?.types?.[type];
  const roles = (r?.roles || []).map(nettoyerRole).filter((x) => x && x !== ROLE_EXCLU);
  const liste = [];
  const ignores = { ouvrier: 0, inactif: 0, sans_compte: 0, hors_renovation: 0 };
  for (const u of utilisateurs || []) {
    const role = nettoyerRole(u.role);
    if (role === ROLE_EXCLU) { if ((r?.roles || []).map(nettoyerRole).includes(ROLE_EXCLU)) ignores.ouvrier++; continue; }
    if (!roles.includes(role)) continue;
    if (u.actif !== true) { ignores.inactif++; continue; }
    if (!estRenovation(u)) { ignores.hors_renovation++; continue; }
    if (!u.auth_id) { ignores.sans_compte++; continue; }
    liste.push({ user_id: u.auth_id, role, nom: u.nom || u.email || "" });
  }
  return { roles, liste, ignores };
}

// ─── Plan d'envoi ───────────────────────────────────────────────────────────

/**
 * Statut push d'une notification au moment où elle est écrite en boîte.
 * Ordre : type sans push > préférence coupée > silence (report) > serveur
 * non configuré > aucun appareil > à envoyer.
 */
export function statutPush({ type, prefActive, nbAppareils, vapidConfiguree, maintenantMs, silence, ignorerSilence = false }) {
  const t = typeDuCatalogue(type);
  if (t && t.push === false) return { push_statut: "boite_seule", push_prevu_le: null };
  if (!prefActive) return { push_statut: "desactive", push_prevu_le: null };
  if (!ignorerSilence && estEnSilence(maintenantMs, silence)) {
    const prochain = prochainCreneau(maintenantMs, silence);
    return prochain === null
      ? { push_statut: "aucun_creneau", push_prevu_le: null }
      : { push_statut: "reporte", push_prevu_le: prochain };
  }
  if (!vapidConfiguree) return { push_statut: "serveur_non_configure", push_prevu_le: null };
  if (!nbAppareils) return { push_statut: "aucun_appareil", push_prevu_le: null };
  return { push_statut: "a_envoyer", push_prevu_le: null };
}

const compter = (lignes, statut) => lignes.filter((l) => l.push_statut === statut).length;

/**
 * Plan d'un envoi serveur (mode « serveur »).
 * @param {{
 *   reglages: object,                       // sortie de normaliserReglages
 *   type: string,
 *   cle?: string,                           // cle_regroupement ; défaut : type + jour Paris
 *   utilisateurs: Array<object>,            // voir destinataires()
 *   preferences: Record<string, object>,    // user_id → { C1: false, … }
 *   appareils: Record<string, number>,      // user_id → nombre d'appareils
 *   dejaNotifies: string[],                 // user_id ayant déjà (type, cle)
 *   maintenantMs: number,
 *   vapidConfiguree: boolean,
 *   simulation?: boolean,                   // calcule même interrupteur coupé, n'écrit rien
 * }} p
 */
export function planifierEnvoi({
  reglages, type, cle, utilisateurs, preferences = {}, appareils = {}, dejaNotifies = [],
  maintenantMs, vapidConfiguree, simulation = false,
}) {
  const t = typeDuCatalogue(type);
  if (!t) return { ok: false, erreur: `Type de notification inconnu : ${type}.` };
  const cleFinale = String(cle || "").trim() || cleRegroupementParDefaut(type, maintenantMs);
  const reglageType = reglages.types[type];

  let bloque_par = null;
  if (!reglages.actif) bloque_par = "interrupteur_coupe";
  else if (!reglageType?.actif) bloque_par = "type_desactive";

  const d = destinataires({ reglages, type, utilisateurs });
  if (!bloque_par && d.roles.length === 0) bloque_par = "aucun_role";

  const deja = new Set(dejaNotifies);
  const calculer = simulation || !bloque_par;
  const lignes = [];
  let doublons = 0;
  if (calculer) {
    for (const u of d.liste) {
      if (deja.has(u.user_id)) { doublons++; continue; }
      const st = statutPush({
        type, prefActive: preferenceActive(preferences[u.user_id], type),
        nbAppareils: appareils[u.user_id] || 0, vapidConfiguree, maintenantMs, silence: reglages.silence,
      });
      lignes.push({ user_id: u.user_id, role: u.role, nom: u.nom, ...st });
    }
  }

  const parRole = {};
  for (const l of lignes) parRole[l.role] = (parRole[l.role] || 0) + 1;
  const resume = {
    type, libelle: t.libelle, cle_regroupement: cleFinale,
    interrupteur_general: reglages.actif === true,
    type_actif: reglageType?.actif === true,
    roles_coches: d.roles,
    bloque_par,
    envoi_reel: !simulation && !bloque_par,
    destinataires: lignes.length,
    destinataires_par_role: parRole,
    a_envoyer: compter(lignes, "a_envoyer"),
    reportes: compter(lignes, "reporte"),
    prochain_creneau: lignes.find((l) => l.push_prevu_le)?.push_prevu_le ?? null,
    boite_seule: compter(lignes, "boite_seule"),
    desactives: compter(lignes, "desactive"),
    aucun_appareil: compter(lignes, "aucun_appareil"),
    serveur_non_configure: compter(lignes, "serveur_non_configure"),
    aucun_creneau: compter(lignes, "aucun_creneau"),
    doublons,
    ignores: d.ignores,
  };
  // Hors simulation, un envoi bloqué n'écrit rien (ni push, ni boîte).
  return { ok: true, cle: cleFinale, lignes: bloque_par && !simulation ? [] : lignes, resume };
}

/**
 * Notification de test demandée à la main depuis le profil : l'appelant
 * seulement, même interrupteur coupé, même en plage de silence.
 */
export function planifierTest({ nbAppareils, vapidConfiguree }) {
  return statutPush({
    type: TYPE_TEST, prefActive: true, nbAppareils, vapidConfiguree,
    maintenantMs: 0, silence: SILENCE_DEFAUT, ignorerSilence: true,
  });
}

/**
 * Rattrapage d'une notification reportée dont l'heure est venue : on revérifie
 * tout, car les réglages ou la préférence ont pu changer pendant la nuit.
 * @returns {{ push_statut: string, push_prevu_le: number|null }}
 */
export function decisionRattrapage({ reglages, type, prefActive, nbAppareils, vapidConfiguree, maintenantMs }) {
  if (type !== TYPE_TEST && (!reglages.actif || !reglages.types[type]?.actif)) {
    return { push_statut: "annule", push_prevu_le: null };
  }
  return statutPush({ type, prefActive, nbAppareils, vapidConfiguree, maintenantMs, silence: reglages.silence });
}

/** Statut final d'une notification après envoi à ses appareils. */
export function statutApresEnvoi(resultats) {
  const liste = Array.isArray(resultats) ? resultats : [];
  if (liste.some((r) => r.ok)) return "envoye";
  if (liste.every((r) => r.suite === "supprimer")) return "aucun_appareil"; // aucun appareil, ou tous périmés (404/410)
  return "echec";
}

// ─── Demandes reçues par send-push ──────────────────────────────────────────

/** Valide le contenu d'un envoi serveur. Le lien reste interne à l'application. */
export function validerContenu(corps) {
  const type = String(corps?.type || "").trim();
  if (!CODES_TYPES.includes(type)) return { ok: false, statut: 400, erreur: "Type de notification inconnu." };
  const titre = String(corps?.titre || "").trim();
  const texte = String(corps?.texte || "").trim();
  const lien = String(corps?.lien || "/").trim() || "/";
  const cle = corps?.cle_regroupement == null ? "" : String(corps.cle_regroupement).trim();
  if (!titre || titre.length > 120) return { ok: false, statut: 400, erreur: "Titre manquant ou trop long (120 caractères au plus)." };
  if (texte.length > 1000) return { ok: false, statut: 400, erreur: "Texte trop long (1000 caractères au plus)." };
  if (!/^\/(?!\/)[^\s]*$/.test(lien) || lien.length > 500) return { ok: false, statut: 400, erreur: "Le lien doit être une adresse interne de l'application (commençant par /)." };
  if (cle.length > 200) return { ok: false, statut: 400, erreur: "Clé de regroupement trop longue." };
  return { ok: true, type, titre, texte, lien, cle_regroupement: cle || null, simulation: corps?.simulation === true };
}

/** Charge utile Web Push d'une notification de la boîte. */
export function chargeUtile({ type, titre, texte, lien }) {
  return { title: titre, body: texte, url: lien || "/", tag: `profero-${type}`, icon: "/pwa-192.png" };
}
