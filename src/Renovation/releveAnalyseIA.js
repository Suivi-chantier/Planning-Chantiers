// ─────────────────────────────────────────────────────────────────────────────
// Analyse des photos d'un relevé iMapper par l'IA — partie NAVIGATEUR.
//
//   preparerPhotosIA : chaque photo est réduite à 800 px de grand côté (comme
//     le prévoit la spécification) et rangée dans le stockage PRIVÉ du
//     chantier, une seule fois ; c'est cette version légère que le serveur
//     envoie au modèle (≈ 4 fois moins cher qu'une photo pleine taille).
//   analyserPiece : appel de la tâche "releve_photos" via /api/ai (qui
//     authentifie, plafonne, quota et journalise dans ia_jobs).
//
// L'intégration du résultat dans le plan est faite par integrerAnalysePhotos
// (releveImapper.mjs, pur et testé) ; ici, on ne fait qu'envoyer et recevoir.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";
import { urlDocumentChantier, uploadDocumentChantier } from "./storageChantier";

// Dossier de stockage du relevé d'un plan : ‹chantier›/plans/‹plan›/releve.
export function prefixeReleve(plan) {
  const racine = plan?.chantier_id || (plan?.projet_id ? `projet-${plan.projet_id}` : "sans-chantier");
  return `${racine}/plans/${plan?.id}/releve`;
}

async function reduire(blob, max = 800) {
  const img = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  if (img.close) img.close();
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error("réduction impossible"))), "image/jpeg", 0.85));
}

// Photos de la pièce sans version réduite → { "‹idPièce›#‹n°›": chemin }.
// Une photo qui échoue garde sa version pleine taille (le serveur l'envoie
// telle quelle) : l'analyse n'est pas bloquée pour autant.
export async function preparerPhotosIA(piece, prefixe) {
  const res = {};
  const aFaire = (piece?.photos || []).filter((ph) => ph.chemin && !ph.chemin_ia);
  const travail = async () => {
    while (aFaire.length) {
      const ph = aFaire.shift();
      try {
        const url = await urlDocumentChantier(ph.chemin, 600);
        if (!url) continue;
        const petit = await reduire(await (await fetch(url)).blob());
        const nom = `${piece.scan || piece.id}_${String(ph.num).padStart(2, "0")}_800.jpg`;
        const r = await uploadDocumentChantier(new File([petit], nom, { type: "image/jpeg" }), `${prefixe}/photos_ia`);
        if (r?.path) res[`${piece.id}#${ph.num}`] = r.path;
      } catch (e) {
        console.warn("réduction de photo pour l'IA :", e);
      }
    }
  };
  await Promise.all([travail(), travail(), travail()]);
  return res;
}

// Appel de la tâche IA. Renvoie { resultat, job_id, cout_eur, confiance } ou
// lève une Error portant `code` (quota_depasse, credit_ia_epuise…).
export async function analyserPiece(entree, contexte) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw Object.assign(new Error("Session expirée : reconnectez-vous."), { code: "non_authentifie" });
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ tache: "releve_photos", entree, contexte }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw Object.assign(new Error(data?.erreur?.message || `Analyse impossible (HTTP ${res.status}).`), { code: data?.erreur?.code || "erreur_interne" });
  }
  return { resultat: data.resultat || {}, job_id: data.job_id || null, cout_eur: data.meta?.cout_eur ?? null, confiance: data.confiance ?? null };
}
