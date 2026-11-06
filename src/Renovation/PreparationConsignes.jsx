// Préparer le chantier — étape « Consignes & plans » (tranche 2a).
// Sous-composant de PreparationChantier.jsx : une carte par pièce, dans
// l'ordre de meta.pieces (consigne, consignes par mur, photos, dictée), puis
// le contrôle final « Toutes les tâches ont une pièce ».
// Calculs et modifications des pièces : fonctions pures de
// preparationChantierV1.mjs. AUCUNE écriture du phasage ici : les pièces
// modifiées remontent au parcours (onMajPieces), qui les enregistre par
// Phasage V2 (saveMeta). Seul l'envoi d'une photo écrit dans Storage, par la
// même méthode que les comptes rendus et les contrôles (uploadRapportPhoto de
// RapportMobile.jsx : compression 1600 px / JPEG, bucket public « photos »).
import React, { useState } from "react";
import { X, Camera, Check, AlertTriangle, RotateCw } from "lucide-react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { supabase } from "../supabase";
import { uploadRapportPhoto } from "./RapportMobile";
import { BoutonMicro } from "./DicteeCompteRendu";
import {
  consignesDePiece, poserConsigne, poserConsigneMur, retirerConsigneMur, ajouterPhoto, retirerPhoto,
  mursDeLaPiece, nbTachesParPiece, controleFinal,
} from "./preparationChantierV1";

const TOUCHE = 44;
const decoder = (s) => String(s || "").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
// Adresse d'affichage d'une photo : chemin dans le bucket « photos » →
// adresse publique (même lecture que les autres écrans) ; une adresse
// complète est affichée telle quelle.
const urlPhoto = (chemin) => (/^https?:\/\//i.test(chemin) ? chemin : supabase.storage.from("photos").getPublicUrl(chemin)?.data?.publicUrl || "");

export default function PreparationConsignes({ pieces, ouvrages, preparation, chantierId, onMajPieces, T, accent, surAccent }) {
  const [ajoutMur, setAjoutMur] = useState(null);   // { pieceId, texte } : choix du mur en cours
  const [envois, setEnvois] = useState({});         // { pieceId: nb de photos en cours d'envoi }
  const [erreurs, setErreurs] = useState({});       // { pieceId: [messages] }

  const nbTaches = nbTachesParPiece(ouvrages, pieces);
  const controle = controleFinal(ouvrages, pieces, preparation);

  const envoyerPhotos = async (pieceId, fichiers, input) => {
    const arr = Array.from(fichiers || []);
    if (!arr.length || !chantierId) return;
    setErreurs(e => ({ ...e, [pieceId]: [] }));
    setEnvois(n => ({ ...n, [pieceId]: (n[pieceId] || 0) + arr.length }));
    const msgs = [];
    for (const f of arr) {
      const res = await uploadRapportPhoto(f, `preparation/${chantierId}/${pieceId}`);
      if (res?.path) onMajPieces(prev => ajouterPhoto(prev, pieceId, res.path));
      else msgs.push(`${f.name} : ${res?.error || "envoi impossible"}`);
      setEnvois(n => ({ ...n, [pieceId]: Math.max(0, (n[pieceId] || 1) - 1) }));
    }
    if (msgs.length) setErreurs(e => ({ ...e, [pieceId]: msgs }));
    if (input) input.value = "";
  };

  const validerAjoutMur = (pieceId, mur) => {
    const m = String(mur || "").trim();
    // Mur déjà présent : rien ne change (sa consigne n'est pas effacée).
    if (m) onMajPieces(prev => (consignesDePiece(prev.find(x => x.id === pieceId)).consignes_murs.some(c => c.mur.toLowerCase() === m.toLowerCase())
      ? prev : poserConsigneMur(prev, pieceId, m, "")));
    setAjoutMur(null);
  };

  const btn = { minHeight: TOUCHE, padding: "0 14px", borderRadius: RADIUS.md, fontFamily: "inherit", fontSize: FONT.sm.size + 1, cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", color: T.text, display: "inline-flex", alignItems: "center", gap: 8 };
  const btnIcone = { width: TOUCHE, height: TOUCHE, minWidth: TOUCHE, border: "none", background: "transparent", color: T.textSub, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm };
  const zoneTexte = { flex: 1, minWidth: 0, boxSizing: "border-box", resize: "vertical", padding: "10px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 2, lineHeight: 1.4 };
  const champ = { minHeight: TOUCHE, boxSizing: "border-box", padding: "0 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 2 };
  const petitTitre = { color: T.textSub, fontSize: FONT.xs.size + 1, fontWeight: 700 };

  const ligneTache = (t) => (
    <li key={t.id} style={{ fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
      <span style={{ fontWeight: 600 }}>{t.nom}</span>
      <span style={{ color: T.textSub }}> · {decoder(t.ouvrage)}</span>
    </li>
  );

  return (
    <div style={{ width: "100%", maxWidth: 1180, margin: "0 auto", padding: "28px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Ce qu'il faut savoir en arrivant dans chaque pièce</h1>
        <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size + 2, lineHeight: 1.5 }}>
          Facultatif. Une consigne s'affichera en haut de la pièce sur le téléphone des ouvriers. Tu peux aussi dicter.
        </p>
      </div>

      {pieces.length === 0 && (
        <div style={{ color: T.textSub, fontSize: FONT.sm.size + 1, padding: "14px 16px", border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
          Aucune pièce dans ce logement : ajoute d'abord les pièces (étape « Les pièces »).
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {pieces.map(p => {
          const c = consignesDePiece(p);
          const n = nbTaches[p.id] || 0;
          const mursAvecConsigne = new Set(c.consignes_murs.map(x => x.mur.toLowerCase()));
          const mursProposes = mursDeLaPiece(ouvrages, p).filter(m => !mursAvecConsigne.has(m.toLowerCase()));
          const enCours = envois[p.id] || 0;
          return (
            <article key={p.id} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{p.nom}</h2>
                <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>{n} tâche{n > 1 ? "s" : ""}</span>
              </div>

              {/* Consigne de la pièce */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={petitTitre}>Consigne pour la pièce</span>
                <span style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <textarea rows={2} value={c.consigne} placeholder="Ex. : protéger le parquet existant" aria-label={`Consigne pour ${p.nom}`}
                    onChange={e => { const v = e.target.value; onMajPieces(prev => poserConsigne(prev, p.id, v)); }}
                    style={zoneTexte}/>
                  <BoutonMicro T={T} valeur={c.consigne} onChange={v => onMajPieces(prev => poserConsigne(prev, p.id, v))}/>
                </span>
              </div>

              {/* Consignes par mur */}
              {c.consignes_murs.map(cm => (
                <div key={cm.mur} style={{ display: "flex", flexDirection: "column", gap: 6, background: T.tagBg || "transparent", borderRadius: RADIUS.sm, padding: "8px 10px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 700, color: accent, fontSize: FONT.sm.size + 1 }}>{cm.mur}</span>
                    <button onClick={() => onMajPieces(prev => retirerConsigneMur(prev, p.id, cm.mur))} aria-label={`Retirer la consigne du mur ${cm.mur}`} style={btnIcone}><Icon as={X} size={18}/></button>
                  </div>
                  <span style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <textarea rows={2} value={cm.texte} placeholder="Consigne pour ce mur" aria-label={`Consigne pour ${cm.mur}`}
                      onChange={e => { const v = e.target.value; onMajPieces(prev => poserConsigneMur(prev, p.id, cm.mur, v)); }}
                      style={zoneTexte}/>
                    <BoutonMicro T={T} valeur={cm.texte} onChange={v => onMajPieces(prev => poserConsigneMur(prev, p.id, cm.mur, v))}/>
                  </span>
                </div>
              ))}
              {c.consignes_murs.some(cm => !cm.texte.trim()) && (
                <div style={{ color: T.textSub, fontSize: FONT.xs.size + 1 }}>Un mur sans texte n'est pas enregistré.</div>
              )}

              {ajoutMur?.pieceId === p.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, border: `1px dashed ${T.border}`, borderRadius: RADIUS.sm, padding: 10 }}>
                  <span style={petitTitre}>Quel mur ?</span>
                  {mursProposes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {mursProposes.map(m => <button key={m} onClick={() => validerAjoutMur(p.id, m)} style={btn}>{m}</button>)}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input autoFocus value={ajoutMur.texte} onChange={e => setAjoutMur({ pieceId: p.id, texte: e.target.value })}
                      onKeyDown={e => { if (e.key === "Enter") validerAjoutMur(p.id, ajoutMur.texte); if (e.key === "Escape") setAjoutMur(null); }}
                      placeholder={mursProposes.length ? "Ou un autre mur…" : "Nom du mur (ex. : Mur côté rue)"} aria-label="Nom du mur"
                      style={{ ...champ, flex: "1 1 180px", minWidth: 0 }}/>
                    <button onClick={() => validerAjoutMur(p.id, ajoutMur.texte)} disabled={!ajoutMur.texte.trim()}
                      style={{ ...btn, background: accent, color: surAccent, border: `1px solid ${accent}`, fontWeight: 700, opacity: ajoutMur.texte.trim() ? 1 : 0.5 }}>Ajouter</button>
                    <button onClick={() => setAjoutMur(null)} style={btn}>Annuler</button>
                  </div>
                </div>
              ) : null}

              {/* Photos */}
              {(c.photos.length > 0 || enCours > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {c.photos.map(ch => (
                    <div key={ch} style={{ position: "relative", width: 96, height: 96, borderRadius: RADIUS.md, overflow: "hidden", border: `1px solid ${T.border}`, background: T.surface }}>
                      <a href={urlPhoto(ch)} target="_blank" rel="noreferrer" aria-label="Voir la photo en grand">
                        <img src={urlPhoto(ch)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
                      </a>
                      <button onClick={() => { if (window.confirm("Retirer cette photo de la pièce ?")) onMajPieces(prev => retirerPhoto(prev, p.id, ch)); }}
                        aria-label="Retirer la photo"
                        style={{ position: "absolute", top: 0, right: 0, width: TOUCHE, height: TOUCHE, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 4 }}>
                        <span style={{ width: 26, height: 26, borderRadius: 999, background: "rgba(0,0,0,0.65)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon as={X} size={14}/></span>
                      </button>
                    </div>
                  ))}
                  {enCours > 0 && (
                    <div style={{ width: 96, height: 96, borderRadius: RADIUS.md, border: `1px dashed ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: T.textSub, fontSize: FONT.xs.size + 1 }}>
                      <Icon as={RotateCw} size={14}/> Envoi… {enCours}
                    </div>
                  )}
                </div>
              )}
              {(erreurs[p.id] || []).length > 0 && (
                <div role="alert" style={{ color: "#e15a5a", fontSize: FONT.sm.size, lineHeight: 1.4 }}>
                  <Icon as={AlertTriangle} size={14}/> Photo non envoyée : {erreurs[p.id].join(" ; ")}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {chantierId ? (
                  <label style={{ ...btn, position: "relative" }}>
                    <Icon as={Camera} size={16}/> Photo
                    <input type="file" accept="image/*" multiple onChange={e => envoyerPhotos(p.id, e.target.files, e.target)}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }} aria-label={`Ajouter une photo pour ${p.nom}`}/>
                  </label>
                ) : (
                  <span style={{ color: T.textSub, fontSize: FONT.sm.size, alignSelf: "center" }}>Photos indisponibles : chantier inconnu.</span>
                )}
                {ajoutMur?.pieceId !== p.id && (
                  <button onClick={() => setAjoutMur({ pieceId: p.id, texte: "" })} style={{ ...btn, border: `1px dashed ${T.textMuted || T.border}` }}>+ Consigne sur un mur</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Contrôle final */}
      <section aria-label="Contrôle final" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {controle.etat === "aucune_tache" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md, padding: "14px 16px", color: T.textSub, fontSize: FONT.sm.size + 2 }}>
            Aucune tâche dans le phasage : rien à contrôler pour l'instant.
          </div>
        )}
        {controle.etat === "ok" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(80,200,120,0.08)", border: "1px solid rgba(80,200,120,0.35)", borderRadius: RADIUS.md, padding: "14px 16px", fontSize: FONT.sm.size + 2 }}>
            <Icon as={Check} size={20} style={{ color: "#3fb771" }}/> Toutes les tâches ont une pièce ({controle.total}).
          </div>
        )}
        {controle.etat === "logement" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(80,200,120,0.08)", border: "1px solid rgba(80,200,120,0.35)", borderRadius: RADIUS.md, padding: "14px 16px", fontSize: FONT.sm.size + 2 }}>
            <Icon as={Check} size={20} style={{ color: "#3fb771" }}/> Aucune tâche oubliée : chaque tâche a une pièce, sauf celles prévues pour tout le logement (liste ci-dessous).
          </div>
        )}
        {controle.sansPiece.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#e15a5a12", border: "1px solid #e15a5a55", borderRadius: RADIUS.md, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: FONT.sm.size + 2, fontWeight: 700 }}>
              <Icon as={AlertTriangle} size={18} style={{ color: "#e15a5a" }}/>
              {controle.sansPiece.length} tâche{controle.sansPiece.length > 1 ? "s" : ""} sans pièce
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{controle.sansPiece.map(ligneTache)}</ul>
            <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Pour les placer : étape « Où se fait chaque ouvrage », ou Phasage V2.</div>
          </div>
        )}
        {controle.toutLeLogement.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "14px 16px" }}>
            <div style={{ fontSize: FONT.sm.size + 2, fontWeight: 700 }}>
              Tout le logement : {controle.toutLeLogement.length} tâche{controle.toutLeLogement.length > 1 ? "s" : ""} sans pièce précise (choix « Tout le logement »)
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{controle.toutLeLogement.map(ligneTache)}</ul>
          </div>
        )}
      </section>
    </div>
  );
}
