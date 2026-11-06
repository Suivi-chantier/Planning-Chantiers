// Préparer le chantier — parcours guidé plein écran, lancé depuis Phasage V2.
// Tranche 1a : étape « Les pièces » (les autres étapes arrivent ensuite).
// Calculs : preparationChantierV1.mjs (module pur) et piecesPhasageV1.mjs.
// AUCUNE écriture Supabase ici : on reçoit les fonctions d'écriture de
// Phasage V2 (saveMeta, updateOuvrages), qui passent par sa file d'attente
// avec révision (verrou optimiste) et son journal d'avancement.
import React, { useState } from "react";
import { ChevronUp, ChevronDown, Pencil, X, Check } from "lucide-react";
import { THEMES, FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { ajouterPiece, renommerPiece, deplacerPiece, supprimerPiece, detacherPiece, piecesDuPhasage } from "./piecesPhasageV1";
import { ETAPES, PIECES_RAPIDES, etapeReprise, majPreparation, piecesRetirees } from "./preparationChantierV1";

// Étapes déjà utilisables dans cette version du parcours.
const ETAPES_DISPONIBLES = ["pieces"];
const rid = () => Math.random().toString(36).slice(2, 10);
const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const TOUCHE = 44; // taille minimale d'un bouton (tablette au chantier)

export default function PreparationChantier({ chantierNom, meta, ouvrages = [], auteur = null, onSaveMeta, onOuvragesChange, onFermer, T: theme }) {
  const T = theme || THEMES.dark;
  const accent = T.accent;
  // Texte sur fond d'accent : foncé sur le jaune (sombre), blanc sur le bleu (clair).
  const surAccent = T.bg === THEMES.light.bg ? "#fff" : "#111318";
  const piecesInitiales = piecesDuPhasage(meta);
  const [etape] = useState(() => etapeReprise(meta, ETAPES_DISPONIBLES));
  const [pieces, setPieces] = useState(piecesInitiales);
  const [modifie, setModifie] = useState(false);
  const [autre, setAutre] = useState(null);           // texte de « + Autre pièce » (null = fermé)
  const [renommage, setRenommage] = useState(null);   // { id, nom } en cours
  const [enregistrement, setEnregistrement] = useState(false);

  const changer = (next) => { setPieces(next); setModifie(true); };
  const ajouter = (nom) => changer(ajouterPiece(pieces, nom, rid()));
  const nbTachesDe = (id) => ouvrages.reduce((s, o) => s + (o.taches || []).filter(t => t.piece_id === id).length, 0);
  const retirer = (p) => {
    const n = nbTachesDe(p.id);
    const msg = n > 0
      ? `Retirer « ${p.nom} » ? ${n} tâche${n > 1 ? "s" : ""} rattachée${n > 1 ? "s" : ""} à cette pièce redeviendr${n > 1 ? "ont" : "a"} « sans pièce » à l'enregistrement.`
      : `Retirer « ${p.nom} » ?`;
    if (window.confirm(msg)) changer(supprimerPiece(pieces, p.id));
  };
  const validerRenommage = () => {
    if (!renommage) return;
    const n = renommage.nom.trim();
    if (n && !pieces.some(p => p.id !== renommage.id && memeNom(p.nom, n))) changer(renommerPiece(pieces, renommage.id, n));
    setRenommage(null);
  };
  const validerAutre = () => {
    if (autre && autre.trim()) ajouter(autre);
    setAutre(null);
  };

  const enregistrerEtQuitter = async () => {
    if (enregistrement) return;
    setEnregistrement(true);
    try {
      // Pièces retirées : leurs tâches redeviennent « sans pièce » (detacherPiece).
      let ouvs = ouvrages;
      let detache = false;
      piecesRetirees(piecesInitiales, pieces).forEach(id => {
        if (ouvs.some(o => (o.taches || []).some(t => t.piece_id === id))) { ouvs = detacherPiece(ouvs, id); detache = true; }
      });
      // Une seule écriture de meta (pièces + préparation) : deux saveMeta
      // successifs se perdraient un patch.
      await onSaveMeta({
        pieces,
        preparation: majPreparation(meta?.preparation, { etape, maj_le: new Date().toISOString(), par: auteur }),
      });
      if (detache) onOuvragesChange(ouvs);
      onFermer();
    } catch (e) {
      console.warn("Préparer le chantier — enregistrement :", e);
      alert("L'enregistrement n'a pas abouti. Réessayez.");
      setEnregistrement(false);
    }
  };
  const fermerSansEnregistrer = () => {
    if (modifie && !window.confirm("Quitter sans enregistrer ? Les pièces ajoutées ou modifiées seront perdues.")) return;
    onFermer();
  };

  const btn = (plein = false) => ({
    minHeight: TOUCHE, padding: "0 18px", borderRadius: RADIUS.md, fontFamily: "inherit",
    fontSize: FONT.sm.size + 1, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${plein ? accent : T.border}`,
    background: plein ? accent : "transparent", color: plein ? surAccent : T.text,
  });
  const btnIcone = { width: TOUCHE, height: TOUCHE, border: "none", background: "transparent", color: T.textSub, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm };
  const champ = { minHeight: TOUCHE, boxSizing: "border-box", padding: "0 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 2 };
  const titreSection = { color: T.textSub, fontSize: FONT.xs.size + 1, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 };

  return (
    <div role="dialog" aria-modal="true" aria-label="Préparer le chantier"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: T.bg, color: T.text, display: "flex", flexDirection: "column", fontFamily: "inherit" }}>
      {/* En-tête */}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: accent, flexShrink: 0 }}/>
          <div style={{ fontSize: FONT.lg.size + 4, fontWeight: 800, letterSpacing: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chantierNom || "Chantier"}</div>
          <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Préparer le chantier</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={fermerSansEnregistrer} style={btn()}>Quitter sans enregistrer</button>
          <button onClick={enregistrerEtQuitter} disabled={enregistrement} style={{ ...btn(true), opacity: enregistrement ? 0.6 : 1 }}>
            {enregistrement ? "Enregistrement…" : "Enregistrer et quitter"}
          </button>
        </div>
      </header>

      {/* Étapes */}
      <nav aria-label="Étapes" style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 20px", borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>
        {ETAPES.map((e, i) => {
          const active = e.id === etape;
          const dispo = ETAPES_DISPONIBLES.includes(e.id);
          return (
            <div key={e.id} aria-current={active ? "step" : undefined} title={dispo ? e.label : `${e.label} : bientôt disponible`}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: RADIUS.pill, minHeight: 28,
                background: active ? (T.tagBg || "rgba(255,194,0,0.14)") : "transparent",
                color: active ? accent : T.textSub, fontWeight: active ? 700 : 500, fontSize: FONT.sm.size, opacity: dispo ? 1 : 0.65 }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                background: active ? accent : "transparent", color: active ? surAccent : T.textSub, border: active ? "none" : `1px solid ${T.textMuted}` }}>{i + 1}</span>
              {e.label}
              {!dispo && <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: RADIUS.pill, border: `1px solid ${T.border}`, color: T.textMuted }}>bientôt</span>}
            </div>
          );
        })}
      </nav>

      {/* Étape « Les pièces » */}
      <main style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ width: "100%", maxWidth: 860, margin: "0 auto", padding: "28px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>Quelles pièces dans ce logement ?</h1>
            <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size + 2, lineHeight: 1.5 }}>
              Touche une pièce pour l'ajouter. L'ordre de la liste sera l'ordre de visite sur le téléphone des ouvriers.
            </p>
          </div>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={titreSection}>Ajout rapide</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {PIECES_RAPIDES.map(nom => {
                const deja = pieces.some(p => memeNom(p.nom, nom));
                return (
                  <button key={nom} onClick={() => !deja && ajouter(nom)} aria-pressed={deja} disabled={deja}
                    title={deja ? "Déjà dans la liste" : `Ajouter « ${nom} »`}
                    style={{ minHeight: TOUCHE, padding: "0 16px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT.sm.size + 2, cursor: deja ? "default" : "pointer",
                      border: `1px solid ${deja ? accent : T.border}`, background: deja ? (T.tagBg || "transparent") : T.card, color: deja ? accent : T.text,
                      display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {deja && <Icon as={Check} size={15}/>}{nom}
                  </button>
                );
              })}
              {autre == null ? (
                <button onClick={() => setAutre("")}
                  style={{ minHeight: TOUCHE, padding: "0 16px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT.sm.size + 2, cursor: "pointer", border: `1px dashed ${T.textMuted}`, background: "transparent", color: T.text }}>
                  + Autre pièce…
                </button>
              ) : (
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  <input autoFocus value={autre} onChange={e => setAutre(e.target.value)} placeholder="Nom de la pièce"
                    onKeyDown={e => { if (e.key === "Enter") validerAutre(); if (e.key === "Escape") setAutre(null); }}
                    aria-label="Nom de la nouvelle pièce" style={{ ...champ, width: 220 }}/>
                  <button onClick={validerAutre} style={btn(true)}>Ajouter</button>
                  <button onClick={() => setAutre(null)} style={btn()}>Annuler</button>
                </span>
              )}
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={titreSection}>Pièces du logement · {pieces.length}</div>
            {pieces.length === 0 && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size + 1, padding: "14px 16px", border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
                Aucune pièce pour l'instant. Touche une pièce ci-dessus pour commencer.
              </div>
            )}
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {pieces.map((p, i) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 8px 6px 14px" }}>
                  <span style={{ width: 24, color: T.textSub, fontSize: FONT.sm.size }}>{i + 1}</span>
                  {renommage?.id === p.id ? (
                    <>
                      <input autoFocus value={renommage.nom} onChange={e => setRenommage({ id: p.id, nom: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter") validerRenommage(); if (e.key === "Escape") setRenommage(null); }}
                        aria-label={`Nouveau nom pour ${p.nom}`} style={{ ...champ, flex: 1, minWidth: 0 }}/>
                      <button onClick={validerRenommage} aria-label="Valider le nom" style={{ ...btnIcone, color: accent }}><Icon as={Check} size={18}/></button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, minWidth: 0, fontSize: FONT.sm.size + 3, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{p.nom}</span>
                      <button onClick={() => setRenommage({ id: p.id, nom: p.nom })} aria-label={`Renommer ${p.nom}`} style={btnIcone}><Icon as={Pencil} size={18}/></button>
                    </>
                  )}
                  <button onClick={() => changer(deplacerPiece(pieces, p.id, -1))} disabled={i === 0} aria-label={`Monter ${p.nom}`} style={{ ...btnIcone, opacity: i === 0 ? 0.3 : 1 }}><Icon as={ChevronUp} size={20}/></button>
                  <button onClick={() => changer(deplacerPiece(pieces, p.id, 1))} disabled={i === pieces.length - 1} aria-label={`Descendre ${p.nom}`} style={{ ...btnIcone, opacity: i === pieces.length - 1 ? 0.3 : 1 }}><Icon as={ChevronDown} size={20}/></button>
                  <button onClick={() => retirer(p)} aria-label={`Retirer ${p.nom}`} style={btnIcone}><Icon as={X} size={18}/></button>
                </li>
              ))}
            </ol>
          </section>

          <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5, padding: "12px 16px", background: T.card, borderRadius: RADIUS.md, border: `1px solid ${T.border}` }}>
            Prochaine étape, « Où se fait chaque ouvrage » (répartir chaque ouvrage du devis par pièce et par mur) : bientôt disponible.
            Pour l'instant, « Enregistrer et quitter » garde la liste des pièces ; on reprendra ici à la prochaine ouverture.
          </p>
        </div>
      </main>
    </div>
  );
}
