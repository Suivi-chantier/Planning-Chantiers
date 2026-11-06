// ─────────────────────────────────────────────────────────────────────────────
// Consignes et photos d'une pièce, préparées par le conducteur de travaux
// (« Préparer le chantier »). Affichage commun au téléphone des ouvriers :
// compte rendu (vue « Par pièce ») et onglet « Phases » (vue « Par pièce »).
//
// Lecture seule. La pièce arrive déjà lue (pieceLue de phasageMobileV1) :
// { consigne, consignes_murs: [{ mur, texte }], photos: [chemins] }.
// Rien ne s'affiche quand la pièce n'a ni consigne ni photo.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { X, AlertTriangle } from "lucide-react";
import { aDesConsignes } from "./phasageMobileV1";

const SOMBRE = "#1a1f2e";

// Photo d'une pièce : chemin dans le bucket public « photos » → adresse.
export const urlPhotoPiece = (chemin) => (/^https?:\/\//i.test(chemin) ? chemin : supabase.storage.from("photos").getPublicUrl(chemin)?.data?.publicUrl || "");

export default function ConsignesPiece({ piece, T, accent }) {
  const [photoAgrandie, setPhotoAgrandie] = useState(null);
  if (!aDesConsignes(piece)) return null;
  const jaune = accent || T.accent || "#FFC200";
  const consignes = [
    ...(piece.consigne ? [{ cle: "_piece", titre: "Consigne de la pièce", texte: piece.consigne }] : []),
    ...(piece.consignes_murs || []).map((c, i) => ({ cle: `mur-${i}`, titre: c.mur, texte: c.texte })),
  ];
  const photos = piece.photos || [];
  return (
    <>
      <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        {consignes.map(c => (
          <div key={c.cle} style={{ display: "flex", gap: 10, padding: "12px 14px", borderRadius: 14, background: "#fff7db", border: `1.5px solid ${jaune}`, color: SOMBRE }}>
            <Icon as={AlertTriangle} size={20} style={{ color: "#b45309", flexShrink: 0, marginTop: 1 }}/>
            <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, fontSize: 15, lineHeight: 1.4 }}>
              <span style={{ fontWeight: 800 }}>{c.titre}</span>
              <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.texte}</span>
            </span>
          </div>
        ))}
        {photos.length > 0 && (
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {photos.map(ch => (
              <button key={ch} onClick={() => setPhotoAgrandie(ch)} aria-label="Voir la photo en grand" style={{
                flexShrink: 0, width: 88, height: 66, padding: 0, borderRadius: 10, overflow: "hidden", cursor: "pointer",
                border: `1.5px solid ${T.border}`, background: T.surface,
              }}>
                <img src={urlPhotoPiece(ch)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
              </button>
            ))}
          </div>
        )}
      </div>

      {photoAgrandie && (
        <div role="dialog" aria-label="Photo de la pièce" onClick={() => setPhotoAgrandie(null)} style={{
          position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
        }}>
          <button onClick={() => setPhotoAgrandie(null)} aria-label="Fermer la photo" style={{
            position: "absolute", top: 12, right: 12, width: 48, height: 48, borderRadius: 24, border: "none", cursor: "pointer",
            background: "rgba(255,255,255,0.15)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon as={X} size={26}/></button>
          <img src={urlPhotoPiece(photoAgrandie)} alt="Photo de la pièce" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}/>
        </div>
      )}
    </>
  );
}
