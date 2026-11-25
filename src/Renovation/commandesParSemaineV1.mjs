// ─────────────────────────────────────────────────────────────────────────────
// commandesParSemaineV1 — rangement par semaine des articles à commander :
// fenêtre « Commandes de la semaine » de la page « Commandes à passer »
// (onglets « Cette semaine », « Semaine prochaine », S+2…S+4, « Plus tard »,
// « Sans date ») et bloc du jour « Matériaux à commander » (projet
// docs/projets/organisation-par-jour.md, tâche 12).
//
// Code DÉPLACÉ tel quel de src/Renovation/PagePlanningCommandes.jsx
// (composant ModaleVendredi : useMemo « semaines », « seaux », « onglets », et
// les aides de dates lundiSemaine / addDays / numeroSemaine). Rien n'est
// réécrit. Seule différence : la date du jour arrive en paramètre
// (`aujourdhui`, un objet Date) au lieu de `new Date()` dans le composant.
//   - la page passe toujours `new Date()` (horloge de l'appareil) ;
//   - le bloc passe dateLocaleV1(contexte.dateIso) = minuit local du jour de
//     l'organisation (date simulée comprise). Sans date simulée, c'est le même
//     jour local que `new Date()` ; lundiSemaine remet l'heure à 00:00, donc
//     les semaines (et les seaux) sont strictement les mêmes.
//
// Les articles viennent de lignesACommander(modeleCommandesAPasser(...))
// (commandesAPasserV1.mjs) ; la date de besoin d'un article est celle de son
// ouvrage (date prévue la plus proche de ses tâches, commandesOuvrageV1.mjs).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord.
// Façade front : commandesParSemaineV1.js.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Aides de dates (déplacées de PagePlanningCommandes.jsx) ─────────────────
// Lundi (00:00) de la semaine contenant `d`. ISO : lundi = début de semaine.
export function lundiSemaine(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Dim ... 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function numeroSemaine(d) {
  // ISO week number
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}

const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** « 2026-11-27 » → Date à minuit LOCAL de ce jour ; illisible → null. */
export function dateLocaleV1(dateIso) {
  const s = String(dateIso || "");
  if (!RE_JOUR.test(s)) return null;
  const [a, m, j] = s.split("-").map(Number);
  const d = new Date(a, m - 1, j);
  if (d.getFullYear() !== a || d.getMonth() !== m - 1 || d.getDate() !== j) return null;
  return d;
}

/** Date locale → « AAAA-MM-JJ » (jour local, sans conversion UTC). */
export function isoLocalV1(d) {
  const deux = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Nombre de semaines glissantes de la fenêtre (cette semaine + 4). */
export const NB_SEMAINES_COMMANDES = 5;
/** Clé de l'onglet « Semaine prochaine ». */
export const CLE_SEMAINE_PROCHAINE = "S1";

/**
 * 5 semaines glissantes à partir de la semaine de `aujourdhui`
 * (ancien useMemo « semaines » de ModaleVendredi, `new Date()` → paramètre).
 * @param {Date} aujourdhui
 */
export function semainesCommandesV1(aujourdhui) {
  const lundi0 = lundiSemaine(aujourdhui);
  return Array.from({ length: NB_SEMAINES_COMMANDES }, (_, i) => {
    const debut = addDays(lundi0, i * 7);
    const fin   = addDays(debut, 6);
    return {
      index: i, debut, fin,
      key: "S" + i,
      label: i === 0 ? "Cette semaine" : i === 1 ? "Semaine prochaine" : `S+${i}`,
      num: numeroSemaine(debut),
    };
  });
}

/**
 * Range chaque ligne dans un seau de semaine. En retard → cette semaine
 * (ancien useMemo « seaux » de ModaleVendredi, inchangé).
 * @param {Array<object>} lignes   lignesACommander(modèle)
 * @param {Array<object>} semaines semainesCommandesV1(...)
 */
export function seauxCommandesV1(lignes, semaines) {
    const out = {};
    semaines.forEach(s => { out[s.key] = []; });
    out["plus"] = [];     // au-delà de S+4
    out["sansdate"] = []; // pas de date de besoin
    lignes.forEach(l => {
      if (!l.dateObj) { out["sansdate"].push(l); return; }
      const d = new Date(l.dateObj); d.setHours(0, 0, 0, 0);
      if (d < semaines[0].debut) { out[semaines[0].key].push(l); return; } // en retard → cette semaine
      let placed = false;
      for (const s of semaines) {
        if (d >= s.debut && d <= s.fin) { out[s.key].push(l); placed = true; break; }
      }
      if (!placed) out["plus"].push(l);
    });
    return out;
}

/** Onglets visibles = ceux qui ont des lignes (ancien useMemo « onglets »). */
export function ongletsCommandesV1(seaux, semaines) {
    const arr = [];
    semaines.forEach(s => { if (seaux[s.key].length) arr.push({ key: s.key, label: s.label, num: s.num, deb: s.debut, fin: s.fin }); });
    if (seaux["plus"].length) arr.push({ key: "plus", label: "Plus tard", num: null });
    if (seaux["sansdate"].length) arr.push({ key: "sansdate", label: "Sans date", num: null });
    return arr;
}

/**
 * Articles de l'onglet « Semaine prochaine » pour la date donnée.
 * @param {{ lignes: Array<object>, aujourdhui: Date }} p
 * @returns {{ semaine: object, lignes: Array<object> }}
 */
export function semaineProchaineCommandesV1({ lignes, aujourdhui }) {
  const semaines = semainesCommandesV1(aujourdhui);
  const seaux = seauxCommandesV1(lignes || [], semaines);
  return { semaine: semaines[1], lignes: seaux[CLE_SEMAINE_PROCHAINE] };
}

// ─── Présentation du bloc du jour (tâche 12) ─────────────────────────────────

/** Nombre d'articles détaillés dans le bloc avant « et N autres ». */
export const ARTICLES_MAX_BLOC_MATERIAUX = 6;

const s = n => (n > 1 ? "s" : "");
const jjmm = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
/** « 2026-11-30 » → « 30/11/2026 ». */
export const dateBesoinFR = iso => (RE_JOUR.test(String(iso || "").slice(0, 10))
  ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
/** Quantité + unité, comme la fenêtre « Commandes de la semaine ». */
export const quantiteArticle = l => [l.quantite, l.unite].filter(v => v != null && v !== "").join(" ");

/**
 * État du bloc « Matériaux à commander » (règle 10 : chargement, erreur,
 * aucun article — jamais un 0 à la place d'une donnée illisible).
 * @param {object} p
 * @param {string} p.dateIso         date du jour (contexte.dateIso)
 * @param {boolean} [p.chargement]
 * @param {string|null} [p.erreur]   première lecture en échec
 * @param {Array<object>|null} [p.lignes]  lignesACommander(modèle)
 * @param {number} [p.max]
 */
export function etatBlocMateriauxACommanderV1({ dateIso, chargement = false, erreur = null, lignes = null, max = ARTICLES_MAX_BLOC_MATERIAUX } = {}) {
  const aujourdhui = dateLocaleV1(dateIso);
  const base = { libelleSemaine: null, numSemaine: null, total: null, chantiers: [], articles: [], autres: 0 };
  if (!aujourdhui) return { ...base, etat: "erreur", metrique: "erreur", message: "Date du jour illisible : la semaine suivante ne peut pas être déterminée." };
  const semaine = semainesCommandesV1(aujourdhui)[1];
  const n = semaine.num;
  const libelleSemaine = `Semaine prochaine · S${n} · du ${jjmm(semaine.debut)} au ${jjmm(semaine.fin)}`;
  const avecSemaine = { ...base, libelleSemaine, numSemaine: n };
  if (erreur) return { ...avecSemaine, etat: "erreur", metrique: "erreur", message: `Les articles à commander n'ont pas pu être lus : ${erreur}` };
  if (chargement || !Array.isArray(lignes)) return { ...avecSemaine, etat: "chargement", metrique: "chargement…", message: "Articles à commander : chargement en cours." };

  const { lignes: sem } = semaineProchaineCommandesV1({ lignes, aujourdhui });
  if (sem.length === 0) {
    return { ...avecSemaine, etat: "aucun", metrique: "aucun article",
      message: `Aucun matériau à commander pour la semaine ${n} : aucun article non commandé n'a de date de besoin du ${jjmm(semaine.debut)} au ${jjmm(semaine.fin)}.` };
  }
  // Par chantier : nombre d'articles, date de besoin la plus proche.
  const parCh = new Map();
  sem.forEach(l => {
    const cle = l.chantierId ?? l.chantierNom;
    if (!parCh.has(cle)) parCh.set(cle, { id: l.chantierId, nom: l.chantierNom, couleur: l.chantierCouleur, nb: 0, dateBesoin: null });
    const c = parCh.get(cle);
    c.nb += 1;
    if (l.dateISO && (!c.dateBesoin || l.dateISO < c.dateBesoin)) c.dateBesoin = l.dateISO;
  });
  const chantiers = [...parCh.values()]
    .sort((a, b) => String(a.dateBesoin).localeCompare(String(b.dateBesoin)) || b.nb - a.nb || String(a.nom).localeCompare(String(b.nom), "fr"));
  // Les plus urgents : date de besoin la plus proche d'abord.
  const tries = sem.map((l, i) => ({ l, i }))
    .sort((a, b) => String(a.l.dateISO).localeCompare(String(b.l.dateISO))
      || String(a.l.chantierNom).localeCompare(String(b.l.chantierNom), "fr") || a.i - b.i)
    .map(x => x.l);
  const articles = tries.slice(0, max).map(l => ({
    libelle: l.libelle || "(sans libellé)", quantite: quantiteArticle(l), ouvrage: l.ouvrageLibelle || "",
    chantier: l.chantierNom, dateBesoin: l.dateISO,
  }));
  const nbC = chantiers.length;
  return {
    ...avecSemaine, etat: "liste", message: null,
    metrique: `${sem.length} article${s(sem.length)}`,
    total: `${sem.length} article${s(sem.length)} à commander · ${nbC} chantier${s(nbC)}`,
    chantiers, articles, autres: Math.max(0, sem.length - max),
  };
}

// ─── Partie du mail récap du vendredi (tâche 15) ─────────────────────────────
// Décision de Loris (24/11/2026, « corrige aussi le mail ») : la partie
// « Commandes prévisionnelles » du mail récap du vendredi
// (api/_cron/cron-recap-commandes.js) liste les MÊMES articles que l'onglet
// « Semaine prochaine » de la page et que le bloc du jour : elle est
// construite sur etatBlocMateriauxACommanderV1 (même total, même « par
// chantier », même tri des articles, mêmes messages vides / erreur), seul le
// nombre d'articles détaillés change.

/**
 * Nombre d'articles détaillés dans le mail avant « et N autres sur la page
 * Commandes à passer ». Assez haut pour qu'une semaine ordinaire soit listée
 * en entier (67 articles pour la semaine 49 au 24/11/2026) : le vendredi, le
 * mail sert à préparer les commandes. Plafonné pour qu'une semaine
 * exceptionnelle ne produise pas un mail tronqué par la messagerie (Gmail
 * coupe au-delà d'environ 100 Ko).
 */
export const ARTICLES_MAX_MAIL_MATERIAUX = 100;

/**
 * Contenu de la partie « Matériaux à commander · semaine prochaine » du mail
 * récap du vendredi. Jamais « aucun » quand la lecture a échoué (règle
 * « une impossibilité reste visible »).
 * @param {object} p
 * @param {string} p.dateIso          date du jour à Paris (« 2026-11-27 »), passée explicitement
 * @param {string|null} [p.erreur]    première lecture en échec
 * @param {Array<object>|null} [p.lignes]  lignesACommander(modèle) ; null = non lues
 * @param {number} [p.max]
 * @returns {{ etat: "liste"|"aucun"|"erreur", titre: string, numSemaine: number|null,
 *   message: string|null, total: string|null, nbArticles: number|null,
 *   chantiers: Array<object>, articles: Array<object>, autres: number, texteAutres: string|null }}
 */
export function partieMailMateriauxACommanderV1({ dateIso, erreur = null, lignes = null, max = ARTICLES_MAX_MAIL_MATERIAUX } = {}) {
  const aujourdhui = dateLocaleV1(dateIso);
  const semaine = aujourdhui ? semainesCommandesV1(aujourdhui)[1] : null;
  const titre = semaine
    ? `Matériaux à commander · semaine prochaine (S${semaine.num}, du ${jjmm(semaine.debut)} au ${jjmm(semaine.fin)})`
    : "Matériaux à commander · semaine prochaine";
  // Lignes absentes sans erreur : pour un mail, ce n'est pas « en cours » mais
  // une lecture qui n'a rien rendu — jamais « aucun ».
  const erreurMail = erreur || (Array.isArray(lignes) ? null : "aucune donnée reçue");
  const e = etatBlocMateriauxACommanderV1({ dateIso, erreur: erreurMail, lignes: Array.isArray(lignes) ? lignes : [], max });
  const nbArticles = e.etat === "liste" ? e.chantiers.reduce((n, c) => n + c.nb, 0) : (e.etat === "aucun" ? 0 : null);
  return {
    etat: e.etat, titre, numSemaine: e.numSemaine, message: e.message, total: e.total, nbArticles,
    chantiers: e.chantiers, articles: e.articles, autres: e.autres,
    texteAutres: e.autres > 0
      ? `et ${e.autres} autre${s(e.autres)} sur la page Commandes à passer (bouton « Commandes de la semaine », onglet « Semaine prochaine »)`
      : null,
  };
}
