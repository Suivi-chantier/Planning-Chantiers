import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────────────────────
// Persistance des états des lieux.
//
// Deux étages, volontairement séparés :
//
//   • Supabase (table invest_etats_des_lieux) — la SAISIE. Synchronisée en
//     continu, donc reprise possible d'un appareil à l'autre. Ne contient
//     jamais d'image : `donnees.items[code].p` reste vide tant que le dossier
//     est un brouillon.
//
//   • IndexedDB (base locale profero_edl) — les PHOTOS du brouillon. Elles
//     pèsent trop lourd pour le localStorage (quota ~5 Mo, on le dépasse en
//     une dizaine de clichés) et on ne veut pas encombrer le Storage avec les
//     photos de brouillons jamais finalisés. Elles survivent au rechargement
//     de la page et à la fermeture de l'onglet, sur l'appareil qui les a
//     prises.
//
// À l'archivage seulement, les photos sont recompressées puis poussées dans
// le bucket privé invest-documents, et `p` reçoit les chemins Storage.
// ─────────────────────────────────────────────────────────────────────────────

export const EDL_TABLE  = "invest_etats_des_lieux";
export const EDL_BUCKET = "invest-documents";

/* ============ IndexedDB : photos des brouillons ============ */

const IDB_NAME  = "profero_edl";
const IDB_STORE = "photos";
const IDB_VER   = 1;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const st = db.createObjectStore(IDB_STORE, { keyPath:"id", autoIncrement:true });
        st.createIndex("edl", "edlId", { unique:false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(IDB_STORE, mode).objectStore(IDB_STORE);
}

// Toutes les fonctions IDB échouent en silence : la saisie doit continuer même
// si le navigateur refuse le stockage (Safari privé, quota plein).
export async function idbAdd(edlId, code, dataUrl) {
  try {
    const db = await openIDB();
    return await new Promise((resolve, reject) => {
      const req = tx(db, "readwrite").add({ edlId, code, dataUrl, ts:Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  } catch { return null; }
}

export async function idbList(edlId) {
  try {
    const db = await openIDB();
    const rows = await new Promise((resolve, reject) => {
      const req = tx(db, "readonly").index("edl").getAll(edlId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
    rows.sort((a, b) => a.ts - b.ts || a.id - b.id);
    const parCode = {};
    for (const r of rows) (parCode[r.code] ||= []).push({ id:r.id, dataUrl:r.dataUrl });
    return parCode;
  } catch { return {}; }
}

export async function idbDelete(id) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const req = tx(db, "readwrite").delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  } catch { /* ignoré */ }
}

export async function idbClear(edlId) {
  try {
    const db = await openIDB();
    await new Promise((resolve, reject) => {
      const t  = db.transaction(IDB_STORE, "readwrite");
      const st = t.objectStore(IDB_STORE);
      const req = st.index("edl").getAllKeys(edlId);
      req.onsuccess = () => (req.result || []).forEach(id => st.delete(id));
      t.oncomplete = () => resolve();
      t.onerror    = () => reject(t.error);
    });
  } catch { /* ignoré */ }
}

/* ============ Images ============ */

// Ré-encode une image (data URL ou blob URL) à `max` px sur le grand côté.
// Saisie : 1400 px / 0,72 pour rester lisible à l'écran.
// Archivage : 1000 px / 0,60 → ~80-120 Ko la photo, ~5 Mo pour 50 clichés.
export function recompresser(src, max = 1000, quality = 0.6, type = "blob") {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width  = Math.round(img.width * sc);
      cv.height = Math.round(img.height * sc);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      if (type === "dataUrl") return resolve(cv.toDataURL("image/jpeg", quality));
      cv.toBlob(b => (b ? resolve(b) : reject(new Error("Encodage impossible"))), "image/jpeg", quality);
    };
    img.onerror = () => reject(new Error("Image illisible"));
    img.src = src;
  });
}

export function fichierVersDataUrl(file) {
  return new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload  = () => resolve(rd.result);
    rd.onerror = () => reject(rd.error);
    rd.readAsDataURL(file);
  });
}

/* ============ Supabase : dossiers ============ */

const EDL_COLONNES_BASE =
  "id,titre,adresse,type,date_edl,statut,nb_elements,nb_renseignes,nb_photos,nb_reserves,auteur,archive_le,created_at,updated_at";

export async function listerEDL() {
  // Le rattachement (bien_id / client_id) vient d'une migration qui peut ne pas
  // être encore appliquée. On le demande, et on retombe sans lui plutôt que de
  // faire échouer toute la liste : la migration doit rester applicable avant ou
  // après le déploiement, sans ordre imposé.
  let { data, error } = await supabase
    .from(EDL_TABLE)
    .select(`${EDL_COLONNES_BASE},bien_id,client_id`)
    .order("updated_at", { ascending:false });

  if (error && (error.code === "42703" || error.code === "PGRST204"
                || /bien_id|client_id/.test(String(error.message || "")))) {
    const repli = await supabase
      .from(EDL_TABLE)
      .select(EDL_COLONNES_BASE)
      .order("updated_at", { ascending:false });
    data = repli.data; error = repli.error;
  }

  if (error) throw error;
  return data || [];
}

// Stock de biens, pour le sélecteur de rattachement du formulaire de création.
// Renvoie [] si la table n'est pas lisible : le sélecteur se masque alors,
// plutôt que d'empêcher la création d'un état des lieux.
export async function listerBiensPourEDL() {
  const { data, error } = await supabase
    .from("invest_biens")
    .select("id,reference_interne,adresse,code_postal,ville")
    .order("created_at", { ascending:false });
  if (error) {
    console.warn("[EDL] stock de biens indisponible:", error.message);
    return [];
  }
  return data || [];
}

// États des lieux d'un bien donné, pour la carte de sa fiche.
// La colonne bien_id peut ne pas exister (migration non appliquée) : on renvoie
// une liste vide plutôt que de faire échouer l'ouverture de la fiche.
export async function listerEDLDuBien(bienId) {
  if (!bienId) return [];
  const { data, error } = await supabase
    .from(EDL_TABLE)
    .select("id,titre,type,date_edl,statut,nb_reserves,nb_photos,archive_le")
    .eq("bien_id", bienId)
    .order("date_edl", { ascending:false });
  if (error) {
    if (error.code !== "42703" && error.code !== "42P01") {
      console.warn("[EDL] états des lieux du bien:", error.message);
    }
    return [];
  }
  return data || [];
}

export async function chargerEDL(id) {
  const { data, error } = await supabase.from(EDL_TABLE).select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function creerEDL(row) {
  const { data, error } = await supabase.from(EDL_TABLE).insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function majEDL(id, patch) {
  const { error } = await supabase.from(EDL_TABLE).update(patch).eq("id", id);
  if (error) throw error;
}

export async function supprimerEDL(id) {
  // Les photos archivées partent avec le dossier : sinon le bucket accumule
  // des fichiers que plus rien ne référence.
  try {
    const { data } = await supabase.storage.from(EDL_BUCKET).list(`edl/${id}`, { limit:1000 });
    const chemins = (data || []).map(f => `edl/${id}/${f.name}`);
    if (chemins.length) await supabase.storage.from(EDL_BUCKET).remove(chemins);
  } catch { /* le dossier part quand même : on ne bloque pas sur le ménage */ }
  const { error } = await supabase.from(EDL_TABLE).delete().eq("id", id);
  if (error) throw error;
  await idbClear(id);
}

/* ============ Archivage ============ */

// Pousse les photos du brouillon dans le Storage et renvoie `donnees` dont
// chaque `items[code].p` contient désormais des CHEMINS et non plus des images.
export async function archiverPhotos(edlId, donnees, photosLocales, onProgress) {
  const total = Object.values(photosLocales).reduce((a, l) => a + l.length, 0);
  let fait = 0;
  const items = { ...(donnees.items || {}) };

  for (const code of Object.keys(photosLocales)) {
    const chemins = [];
    for (const photo of photosLocales[code]) {
      const blob = await recompresser(photo.dataUrl, 1000, 0.6, "blob");
      const nom  = `${code}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const path = `edl/${edlId}/${nom}`;
      const { error } = await supabase.storage.from(EDL_BUCKET)
        .upload(path, blob, { upsert:false, contentType:"image/jpeg" });
      if (error) throw new Error(`Envoi de ${code} : ${error.message}`);
      chemins.push(path);
      onProgress?.(++fait, total);
    }
    items[code] = { ...(items[code] || { s:null, o:"", v:"" }), p:chemins };
  }

  return { ...donnees, items };
}

// Un rapport archivé ne stocke que des chemins : on resigne à chaque ouverture.
// 2 h de validité, largement de quoi consulter et imprimer.
export async function signerPhotos(donnees) {
  const chemins = [];
  for (const d of Object.values(donnees?.items || {})) {
    for (const p of (d?.p || [])) if (typeof p === "string" && !p.startsWith("data:")) chemins.push(p);
  }
  if (!chemins.length) return {};
  const { data, error } = await supabase.storage.from(EDL_BUCKET).createSignedUrls(chemins, 7200);
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => { if (r?.path && r?.signedUrl) map[r.path] = r.signedUrl; });
  return map;
}
