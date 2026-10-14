// ─────────────────────────────────────────────────────────────────────────────
// NOTES DES OUVRIERS — module PUR (aucun accès Supabase, aucune horloge, aucun
// effet de bord). Les données arrivent en paramètre ; l'horloge aussi, quand
// elle sert (identifiants d'éléments de liste fournis par l'appelant).
//
// Règles partagées par l'espace ouvrier (onglet Notes, mémo chantier de
// l'onglet Opérations) et par le bureau (page « Notes des ouvriers », fiche
// chantier). La sécurité réelle est en base (RLS de notes_ouvriers, migration
// 20261014120000) : ce module ne décide JAMAIS qui a le droit de voir une
// note, il l'explique et il classe ce que la base a déjà renvoyé.
// ─────────────────────────────────────────────────────────────────────────────

export const TYPES_NOTE = {
  note:     { id: "note",     label: "Note",       couleur: "#5b8af5" },
  signaler: { id: "signaler", label: "À signaler", couleur: "#e05c5c" },
  astuce:   { id: "astuce",   label: "Astuce",     couleur: "#22a35a" },
};
export const ORDRE_TYPES = ["note", "signaler", "astuce"];

export const STATUTS_BUREAU = {
  nouveau: { id: "nouveau", label: "Nouveau", couleur: "#f59e0b" },
  lu:      { id: "lu",      label: "Lu",      couleur: "#5b8af5" },
  traite:  { id: "traite",  label: "Traité",  couleur: "#22a35a" },
};

export const LIMITES = { titre: 200, contenu: 20000, checklist: 100, photos: 10, reponse: 5000 };

export const typeNote = (t) => TYPES_NOTE[t] || TYPES_NOTE.note;

// Même normalisation que public.norm_prenom (casse, accents, espaces).
export function normaliserPrenom(p) {
  return String(p ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().replace(/\s+/g, " ").toLowerCase();
}

// Prénoms dédoublonnés, sans soi-même, triés — miroir du trigger de garde.
export function normaliserDestinataires(liste, moi = "") {
  const cleMoi = normaliserPrenom(moi);
  const vus = new Map();
  for (const brut of Array.isArray(liste) ? liste : []) {
    const p = String(brut ?? "").trim();
    const cle = normaliserPrenom(p);
    if (!cle || cle === cleMoi || vus.has(cle)) continue;
    vus.set(cle, p);
  }
  return [...vus.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

export const estPrivee = (n) => !n?.memo_chantier && !n?.partage_bureau
  && !(Array.isArray(n?.partage_ouvriers) && n.partage_ouvriers.length > 0);

// « Paul », « Paul et Marc », « Paul, Marc et Hugo ».
export function listeFr(noms) {
  const l = (noms || []).filter(Boolean);
  if (l.length <= 1) return l.join("");
  return `${l.slice(0, -1).join(", ")} et ${l[l.length - 1]}`;
}

// Qui voit la note, en une phrase — l'écran l'affiche tel quel.
// pourAuteur : formulation à la 2e personne (« toi seul »).
export function libellePartage(n, { pourAuteur = true } = {}) {
  if (n?.memo_chantier) return "Mémo chantier : visible par tous les ouvriers et le bureau";
  const collegues = Array.isArray(n?.partage_ouvriers) ? n.partage_ouvriers : [];
  const cibles = [...collegues, ...(n?.partage_bureau ? ["le bureau"] : [])];
  if (cibles.length === 0) return pourAuteur ? "Privée : visible par toi seul" : "Privée";
  return `Partagée avec ${listeFr(cibles)}`;
}

// ── Liste à cocher ──────────────────────────────────────────────────────────
export function nettoyerChecklist(liste) {
  return (Array.isArray(liste) ? liste : [])
    .map(e => ({ id: String(e?.id || ""), texte: String(e?.texte ?? "").trim(), fait: e?.fait === true }))
    .filter(e => e.id && e.texte);
}
export function ajouterElement(liste, texte, id) {
  const t = String(texte ?? "").trim();
  if (!t || !id) return Array.isArray(liste) ? liste : [];
  return [...(Array.isArray(liste) ? liste : []), { id: String(id), texte: t, fait: false }];
}
export const basculerElement = (liste, id) =>
  (Array.isArray(liste) ? liste : []).map(e => e.id === id ? { ...e, fait: !e.fait } : e);
export const retirerElement = (liste, id) =>
  (Array.isArray(liste) ? liste : []).filter(e => e.id !== id);
export function progressionChecklist(liste) {
  const l = nettoyerChecklist(liste);
  return { faits: l.filter(e => e.fait).length, total: l.length };
}

// ── Brouillon ⇄ ligne ───────────────────────────────────────────────────────
export function brouillonVide({ chantierId = "", memo = false } = {}) {
  return {
    type: "note", titre: "", contenu: "", checklist: [], photos: [],
    chantier_id: chantierId || "", memo_chantier: !!(memo && chantierId),
    partage_bureau: false, partage_ouvriers: [],
  };
}
export function brouillonDepuisNote(n) {
  return {
    type: TYPES_NOTE[n?.type] ? n.type : "note",
    titre: n?.titre || "", contenu: n?.contenu || "",
    checklist: nettoyerChecklist(n?.checklist),
    photos: Array.isArray(n?.photos) ? n.photos.filter(p => typeof p === "string" && p) : [],
    chantier_id: n?.chantier_id || "", memo_chantier: !!n?.memo_chantier,
    partage_bureau: !!n?.partage_bureau,
    partage_ouvriers: Array.isArray(n?.partage_ouvriers) ? [...n.partage_ouvriers] : [],
  };
}

// Problèmes bloquants, dans l'ordre d'affichage. Liste vide = enregistrable.
export function problemesNote(b) {
  const out = [];
  const checklist = nettoyerChecklist(b?.checklist);
  const photos = Array.isArray(b?.photos) ? b.photos : [];
  if (!String(b?.titre ?? "").trim() && !String(b?.contenu ?? "").trim() && checklist.length === 0 && photos.length === 0) {
    out.push("La note est vide : écris un titre, un texte, une liste ou ajoute une photo.");
  }
  if (b?.memo_chantier && !b?.chantier_id) out.push("Choisis le chantier du mémo.");
  if (String(b?.titre ?? "").trim().length > LIMITES.titre) out.push(`Le titre dépasse ${LIMITES.titre} caractères.`);
  if (String(b?.contenu ?? "").length > LIMITES.contenu) out.push("Le texte est trop long.");
  if (checklist.length > LIMITES.checklist) out.push(`La liste dépasse ${LIMITES.checklist} éléments.`);
  if (photos.length > LIMITES.photos) out.push(`${LIMITES.photos} photos au maximum par note.`);
  return out;
}

// Colonnes écrites en base. auteur, statut et dates : posés par le trigger.
export function ligneDepuisBrouillon(b, moi = "") {
  const chantier = String(b?.chantier_id ?? "").trim() || null;
  return {
    type: TYPES_NOTE[b?.type] ? b.type : "note",
    titre: String(b?.titre ?? "").trim(),
    contenu: String(b?.contenu ?? "").replace(/\s+$/, ""),
    checklist: nettoyerChecklist(b?.checklist),
    photos: (Array.isArray(b?.photos) ? b.photos : []).filter(p => typeof p === "string" && p),
    chantier_id: chantier,
    memo_chantier: !!(b?.memo_chantier && chantier),
    partage_bureau: !!b?.partage_bureau,
    partage_ouvriers: normaliserDestinataires(b?.partage_ouvriers, moi),
  };
}

// Titre affiché : le titre, sinon la première ligne du texte, sinon la liste.
export function titreAffiche(n) {
  const t = String(n?.titre ?? "").trim();
  if (t) return t;
  const ligne = String(n?.contenu ?? "").split("\n").map(s => s.trim()).find(Boolean);
  if (ligne) return ligne.length > 80 ? `${ligne.slice(0, 79)}…` : ligne;
  const l = nettoyerChecklist(n?.checklist);
  if (l.length) return `Liste (${l.length} élément${l.length > 1 ? "s" : ""})`;
  if (Array.isArray(n?.photos) && n.photos.length) return "Photo";
  return "Note sans titre";
}

// ── Lu / non lu (côté ouvrier) ──────────────────────────────────────────────
// Non lue : la dernière activité (création, modification, réponse) vient de
// quelqu'un d'autre et date d'après ma dernière lecture.
export function estNonLue(n, lectures, monUid) {
  if (!n || !monUid) return false;
  if (n.derniere_activite_par && n.derniere_activite_par === monUid) return false;
  if (!n.derniere_activite_par && n.auteur_uid === monUid) return false;
  const lu = lectures?.[n.id];
  if (!lu) return true;
  return new Date(lu).getTime() < new Date(n.derniere_activite).getTime();
}

// Range ce que la base a renvoyé dans les trois onglets de l'ouvrier.
//   miennes : mes notes (y compris mes mémos, aussi listés dans « memos ») ;
//   recues  : partagées avec moi par un collègue (hors mémos) ;
//   memos   : tous les mémos chantier.
export function classerNotesOuvrier(notes, monUid) {
  const tri = (a, b) => String(b.derniere_activite || "").localeCompare(String(a.derniere_activite || ""));
  const l = (Array.isArray(notes) ? notes : []).slice().sort(tri);
  return {
    miennes: l.filter(n => n.auteur_uid === monUid),
    recues:  l.filter(n => n.auteur_uid !== monUid && !n.memo_chantier),
    memos:   l.filter(n => n.memo_chantier),
  };
}

export function memosDuChantier(notes, chantierId) {
  if (!chantierId) return [];
  return (Array.isArray(notes) ? notes : [])
    .filter(n => n.memo_chantier && n.chantier_id === chantierId)
    .sort((a, b) => String(b.derniere_activite || "").localeCompare(String(a.derniere_activite || "")));
}

// ── Bureau ──────────────────────────────────────────────────────────────────
export const FILTRES_BUREAU = [
  { id: "a_traiter", label: "À traiter" },
  { id: "traite",    label: "Traitées" },
  { id: "toutes",    label: "Toutes" },
];

// À traiter = nouveau ou lu (pas encore traité).
export const estATraiter = (n) => n?.statut_bureau !== "traite";

export function filtrerNotesBureau(notes, { filtre = "a_traiter", type = "", chantierId = "", auteur = "" } = {}) {
  return (Array.isArray(notes) ? notes : []).filter(n =>
    (filtre === "toutes" || (filtre === "traite" ? n.statut_bureau === "traite" : estATraiter(n)))
    && (!type || n.type === type)
    && (!chantierId || n.chantier_id === chantierId)
    && (!auteur || normaliserPrenom(n.auteur) === normaliserPrenom(auteur)));
}

// Ordre bureau : « à signaler » non traitées d'abord, puis nouvelles, puis le
// reste, chaque groupe par activité la plus récente.
export function trierNotesBureau(notes) {
  const rang = (n) => (n.type === "signaler" && estATraiter(n) ? 0 : n.statut_bureau === "nouveau" ? 1 : 2);
  return (Array.isArray(notes) ? notes : []).slice().sort((a, b) =>
    rang(a) - rang(b) || String(b.derniere_activite || "").localeCompare(String(a.derniere_activite || "")));
}

export function compteursBureau(notes) {
  const l = Array.isArray(notes) ? notes : [];
  return {
    nouvelles: l.filter(n => n.statut_bureau === "nouveau").length,
    signalees: l.filter(n => n.type === "signaler" && estATraiter(n)).length,
    aTraiter:  l.filter(estATraiter).length,
    traitees:  l.filter(n => n.statut_bureau === "traite").length,
  };
}

// Phrase de suivi affichée à l'auteur et au bureau.
export function libelleSuivi(n, fmtDate = (d) => d) {
  if (!n?.partage_bureau && !n?.memo_chantier) return "";
  const st = STATUTS_BUREAU[n.statut_bureau];
  if (!st || n.statut_bureau === "nouveau") return "Pas encore lue par le bureau";
  const qui = n.statut_par ? ` par ${n.statut_par}` : "";
  const quand = n.statut_le ? ` le ${fmtDate(n.statut_le)}` : "";
  return `${st.label}${qui}${quand}`;
}

// Chemin d'une photo dans le bucket privé : <uid>/<identifiant>.<ext>.
export function cheminPhoto(uid, identifiant, typeMime = "image/jpeg") {
  const ext = typeMime === "image/png" ? "png" : typeMime === "image/webp" ? "webp" : "jpg";
  return `${uid}/${identifiant}.${ext}`;
}
