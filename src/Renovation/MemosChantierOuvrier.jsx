// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — « Mémo chantier » dans le détail d'un chantier (onglet
// Opérations). Mêmes données et mêmes écrans que l'onglet Notes : la section
// liste les mémos épinglés du chantier ; ouvrir ou ajouter un mémo bascule
// sur DetailNote / EditeurNote (OuvrierNotes.jsx), comme la préparation du
// chantier bascule sur son propre écran. Aucune seconde implémentation.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useEffect } from "react";
import { Icon } from "../ui";
import { Pin, Plus, CheckSquare, Camera, MessageCircle } from "lucide-react";
import { MobileSection } from "../mobileUI";
import { memosDuChantier, titreAffiche, progressionChecklist, estNonLue, brouillonVide } from "./notesOuvriers.js";
import { DetailNote, EditeurNote, useChantiersOuvrier } from "./OuvrierNotes";

export function SectionMemosChantier({ T, accent, chantier, notes, onOuvrir, onNouveau, preview = false }) {
  const memos = useMemo(() => memosDuChantier(notes.notes || [], chantier.id), [notes.notes, chantier.id]);
  if (notes.erreur === "absente") return null;   // fonctionnalité pas encore activée : l'onglet Notes le dit
  const nonLus = memos.filter(n => estNonLue(n, notes.lectures, notes.uid)).length;
  return (
    <MobileSection T={T} accent={accent} icon={Pin} title="Mémo chantier" defaultOpen={memos.length > 0}
      summary={notes.notes === null ? (notes.erreur ? "?" : "…") : nonLus ? `${memos.length} · ${nonLus} nouveau${nonLus > 1 ? "x" : ""}` : String(memos.length)}
      summaryTone={nonLus ? accent : undefined}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {notes.erreur === "reseau" && (
          <div style={{ fontSize: 13, color: T.textMuted }}>Mémos non chargés : vérifie ta connexion.</div>
        )}
        {notes.notes && memos.length === 0 && (
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.45 }}>
            Aucun mémo pour ce chantier. Digicode, clés, coupure d'eau, voisin à prévenir… un mémo est visible par tous les ouvriers et le bureau.
          </div>
        )}
        {memos.map(n => {
          const prog = progressionChecklist(n.checklist);
          const nonLu = estNonLue(n, notes.lectures, notes.uid);
          return (
            <button key={n.id} onClick={() => onOuvrir(n.id)} style={{
              textAlign: "left", border: `1px solid ${T.border}`, borderRadius: 12, background: T.surface,
              padding: "10px 12px", fontFamily: "inherit", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {nonLu && <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }}/>}
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 800, color: T.text }}>{titreAffiche(n)}</span>
              </span>
              {String(n.contenu || "").trim() && String(n.titre || "").trim() && (
                <span style={{ fontSize: 13, color: T.textSub, lineHeight: 1.4, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.contenu}</span>
              )}
              <span style={{ display: "flex", gap: 10, fontSize: 12, color: T.textMuted }}>
                <span>{n.auteur}</span>
                {prog.total > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={CheckSquare} size={11}/> {prog.faits}/{prog.total}</span>}
                {n.photos?.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={Camera} size={11}/> {n.photos.length}</span>}
                {n.nb_reponses > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon as={MessageCircle} size={11}/> {n.nb_reponses}</span>}
              </span>
            </button>
          );
        })}
        {!preview && !notes.erreur && (
          <button onClick={onNouveau} style={{
            padding: "10px", border: `1.5px dashed ${T.border}`, borderRadius: 12, background: T.surface,
            color: T.textSub, fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}><Icon as={Plus} size={14} strokeWidth={2.3}/> Ajouter un mémo</button>
        )}
      </div>
    </MobileSection>
  );
}

// Écran plein : détail d'un mémo ou édition (nouveau mémo pré-rempli).
export function EcranMemoChantier({ T, accent, prenom, chantier, notes, vue, setVue, onRetour, preview = false }) {
  const chantiers = useChantiersOuvrier();
  const nomChantier = (id) => chantiers.find(c => c.id === id)?.nom || (id === chantier.id ? chantier.nom : id) || "—";
  const note = vue.id ? (notes.notes || []).find(n => n.id === vue.id) : null;
  const retour = `Retour à ${chantier.nom}`;
  const introuvable = vue.mode === "detail" && !note;
  // Mémo disparu entre-temps (supprimé par son auteur) : retour au chantier.
  useEffect(() => { if (introuvable) onRetour(); }, [introuvable]); // eslint-disable-line react-hooks/exhaustive-deps

  if (vue.mode === "edition") {
    return (
      <EditeurNote T={T} accent={accent} prenom={prenom} note={note}
        initial={note ? null : brouillonVide({ chantierId: chantier.id, memo: true })}
        chantiers={chantiers} destinataires={notes.destinataires} equipes={notes.equipes} preview={preview}
        onAnnuler={() => (note ? setVue({ mode: "detail", id: note.id }) : onRetour())}
        onEnregistree={(n) => { notes.remplacer(n); notes.marquerLueLocal(n.id); setVue({ mode: "detail", id: n.id }); }}/>
    );
  }
  if (!note) return null;
  return (
    <DetailNote T={T} accent={accent} note={note} uid={notes.uid} nomChantier={nomChantier} retourLabel={retour} preview={preview}
      onRetour={() => { notes.marquerLueLocal(note.id); onRetour(); }}
      onModifier={() => setVue({ mode: "edition", id: note.id })}
      onSupprimee={(id) => { notes.retirer(id); onRetour(); }}
      onMaj={notes.remplacer}/>
  );
}
