// supabase/functions/portail-depot-document/regles.mjs — règles PURES du dépôt de pièces par le client
// (aucun réseau, aucune base, aucune horloge). Testées dans Node par scripts/verif-portail-depots.mjs ;
// importées par index.ts. Le client ne choisit JAMAIS le chemin du fichier : il est fabriqué ici.

export const TAILLE_MAX = 10 * 1024 * 1024;          // 10 Mo
export const DEPOTS_EN_COURS_MAX = 25;               // pièces en attente de vérification, par client
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estUuid = (v) => UUID.test(String(v || ""));

const TYPES = { pdf: ["application/pdf"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"] };

export const extension = (nom) => {
  const m = String(nom || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
};

/** Nom de fichier sans danger pour un chemin de stockage : lettres, chiffres, point, tiret, souligné. */
export function nomSur(nom) {
  const ext = extension(nom);
  const base = String(nom || "").replace(/\.[a-z0-9]{1,5}$/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "").slice(0, 60);
  return `${base || "document"}.${ext}`;
}

/** Les premiers octets du fichier doivent correspondre au type annoncé (le nom ne prouve rien). */
export function signatureValide(octets, ext) {
  const b = Array.from(octets || []);
  const debute = (sig) => sig.every((v, i) => b[i] === v);
  if (ext === "pdf") return debute([0x25, 0x50, 0x44, 0x46, 0x2d]);                       // %PDF-
  if (ext === "png") return debute([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === "jpg" || ext === "jpeg") return debute([0xff, 0xd8, 0xff]);
  return false;
}

/**
 * Valide une demande de dépôt. `piecesDemandees` vient de la base (jamais du client) ;
 * `pieceCle` null = « autre document » (libellé libre).
 */
export function validerDemande({ nomFichier, taille, mime, pieceCle, libelle, piecesDemandees = [], depotsEnCours = 0 }) {
  const ext = extension(nomFichier);
  if (!String(nomFichier || "").trim()) return { ok: false, motif: "Nom de fichier manquant." };
  if (!TYPES[ext]) return { ok: false, motif: "Format non accepté : PDF, JPG ou PNG uniquement." };
  if (!TYPES[ext].includes(String(mime || "").toLowerCase())) return { ok: false, motif: "Le type du fichier ne correspond pas à son extension." };
  const t = Number(taille);
  if (!Number.isInteger(t) || t <= 0) return { ok: false, motif: "Fichier vide." };
  if (t > TAILLE_MAX) return { ok: false, motif: "Fichier trop volumineux (10 Mo au maximum)." };
  if (depotsEnCours >= DEPOTS_EN_COURS_MAX) return { ok: false, motif: "Trop de pièces en attente de vérification. Votre conseiller doit d'abord les traiter." };
  let piece = null;
  if (pieceCle !== null && pieceCle !== undefined && pieceCle !== "") {
    piece = piecesDemandees.find((p) => p.id === pieceCle);
    if (!piece) return { ok: false, motif: "Cette pièce ne vous est pas demandée." };
  }
  const libelleFinal = piece ? String(piece.label).slice(0, 120) : String(libelle || "").trim().slice(0, 120);
  if (!libelleFinal) return { ok: false, motif: "Précisez de quel document il s'agit." };
  return { ok: true, ext, nomSur: nomSur(nomFichier), pieceCle: piece ? piece.id : null, libelle: libelleFinal, taille: t };
}

export const cheminDepot = (clientId, depotId, nom) => `clients/${clientId}/depots-client/${depotId}-${nom}`;
