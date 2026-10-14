// ─────────────────────────────────────────────────────────────────────────────
// NOTES DES OUVRIERS — accès aux données (Supabase). Les règles (partage,
// classement, validation) sont dans notesOuvriers.mjs ; la sécurité est en
// base (RLS, migration 20261014120000_notes_ouvriers.sql).
//
// Chaque lecture renvoie { data, erreur } ; erreur = "absente" quand la
// migration n'est pas encore appliquée, pour que l'écran le DISE au lieu
// d'afficher une liste vide comme si personne n'avait rien écrit.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { cheminPhoto } from "./notesOuvriers.js";

export const BUCKET_NOTES = "notes-ouvriers";
const COLONNES = "*, notes_ouvriers_reponses(count)";

function classerErreur(error) {
  if (!error) return null;
  const msg = `${error.code || ""} ${error.message || ""}`;
  if (/42P01|PGRST205|PGRST200|does not exist|schema cache/i.test(msg)) return "absente";
  return "reseau";
}

const avecNbReponses = (n) => ({
  ...n,
  nb_reponses: Array.isArray(n.notes_ouvriers_reponses) ? (n.notes_ouvriers_reponses[0]?.count || 0) : 0,
});

export async function monUid() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// Toutes les notes que la base laisse voir à l'appelant (ouvrier ou bureau),
// avec mes lectures { note_id: lu_le }.
export async function chargerNotes({ chantierId = null } = {}) {
  let q = supabase.from("notes_ouvriers").select(COLONNES).order("derniere_activite", { ascending: false }).limit(500);
  if (chantierId) q = q.eq("chantier_id", chantierId);
  const [{ data, error }, lect] = await Promise.all([
    q,
    supabase.from("notes_ouvriers_lectures").select("note_id, lu_le"),
  ]);
  if (error) { console.error("notes_ouvriers:", error); return { data: null, lectures: {}, erreur: classerErreur(error) }; }
  const lectures = {};
  (lect.data || []).forEach(l => { lectures[l.note_id] = l.lu_le; });
  return { data: (data || []).map(avecNbReponses), lectures, erreur: null };
}

export async function enregistrerNote(id, ligne) {
  const req = id
    ? supabase.from("notes_ouvriers").update(ligne).eq("id", id).select(COLONNES).single()
    : supabase.from("notes_ouvriers").insert(ligne).select(COLONNES).single();
  const { data, error } = await req;
  if (error) { console.error("enregistrer note:", error); return { data: null, erreur: error.message || "Erreur" }; }
  return { data: avecNbReponses(data), erreur: null };
}

export async function supprimerNote(note) {
  const { error } = await supabase.from("notes_ouvriers").delete().eq("id", note.id);
  if (error) { console.error("supprimer note:", error); return { erreur: error.message || "Erreur" }; }
  if (Array.isArray(note.photos) && note.photos.length) {
    // Photos orphelines : sans conséquence si l'effacement échoue (bucket privé,
    // plus aucune note ne les cite donc plus personne d'autre ne les lit).
    await supabase.storage.from(BUCKET_NOTES).remove(note.photos).catch(() => {});
  }
  return { erreur: null };
}

export async function changerStatutBureau(noteId, statut) {
  const { data, error } = await supabase.from("notes_ouvriers")
    .update({ statut_bureau: statut }).eq("id", noteId).select(COLONNES).single();
  if (error) { console.error("statut note:", error); return { data: null, erreur: error.message || "Erreur" }; }
  return { data: avecNbReponses(data), erreur: null };
}

export async function chargerReponses(noteId) {
  const { data, error } = await supabase.from("notes_ouvriers_reponses")
    .select("id, note_id, auteur, auteur_uid, cote, contenu, created_at")
    .eq("note_id", noteId).order("created_at", { ascending: true });
  if (error) { console.error("réponses note:", error); return { data: null, erreur: classerErreur(error) }; }
  return { data: data || [], erreur: null };
}

export async function envoyerReponse(noteId, contenu) {
  // auteur, côté et date sont imposés par le trigger : on n'envoie que le texte.
  const uid = await monUid();
  const { data, error } = await supabase.from("notes_ouvriers_reponses")
    .insert({ note_id: noteId, contenu, auteur: "-", cote: "ouvrier", auteur_uid: uid })
    .select("id, note_id, auteur, auteur_uid, cote, contenu, created_at").single();
  if (error) { console.error("réponse note:", error); return { data: null, erreur: error.message || "Erreur" }; }
  return { data, erreur: null };
}

export async function marquerLue(noteId) {
  const uid = await monUid();
  if (!uid) return;
  await supabase.from("notes_ouvriers_lectures")
    .upsert({ note_id: noteId, lecteur_uid: uid, lu_le: new Date().toISOString() }, { onConflict: "note_id,lecteur_uid" });
}

export async function chargerDestinataires() {
  const { data, error } = await supabase.rpc("notes_destinataires");
  if (error) { console.error("notes_destinataires:", error); return { data: [], erreur: classerErreur(error) }; }
  return { data: (data || []).map(r => (typeof r === "string" ? r : r?.notes_destinataires)).filter(Boolean), erreur: null };
}

// ── Photos ──────────────────────────────────────────────────────────────────
// Recompressée à 1600 px / JPEG 0,75 : lisible pour un détail de chantier,
// ~200-400 Ko la photo.
function recompresser(file, max = 1600, qualite = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc);
      cv.height = Math.round(img.height * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      cv.toBlob(b => (b ? resolve(b) : reject(new Error("Encodage impossible"))), "image/jpeg", qualite);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible")); };
    img.src = url;
  });
}

export async function envoyerPhoto(file) {
  const uid = await monUid();
  if (!uid) return { chemin: null, erreur: "Session expirée : reconnecte-toi." };
  let blob = file;
  try { blob = await recompresser(file); } catch { /* format non décodable ici : envoi tel quel */ }
  const type = blob.type || file.type || "image/jpeg";
  const chemin = cheminPhoto(uid, crypto.randomUUID(), type);
  const { error } = await supabase.storage.from(BUCKET_NOTES).upload(chemin, blob, { contentType: type, upsert: false });
  if (error) { console.error("photo note:", error); return { chemin: null, erreur: error.message || "Envoi impossible" }; }
  return { chemin, erreur: null };
}

export async function retirerPhotoNonEnregistree(chemin) {
  await supabase.storage.from(BUCKET_NOTES).remove([chemin]).catch(() => {});
}

// Liens temporaires (1 h) — le bucket est privé.
export async function liensPhotos(chemins) {
  const l = (chemins || []).filter(Boolean);
  if (!l.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET_NOTES).createSignedUrls(l, 3600);
  if (error) { console.error("liens photos note:", error); return {}; }
  const out = {};
  (data || []).forEach(d => { if (d.signedUrl && d.path) out[d.path] = d.signedUrl; });
  return out;
}
