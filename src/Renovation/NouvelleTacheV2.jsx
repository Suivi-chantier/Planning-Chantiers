// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu (formulaire bêta « cr_v2 ») — écran « Nouvelle tâche ».
//
// L'ouvrier a fait un travail qui n'existe pas dans le phasage. Il le PROPOSE
// dans un ouvrage du chantier, dit ce qu'il a fait et pourquoi (4 natures) ;
// pour une demande du client, une photo est obligatoire. « Ajouter à ma
// journée » crée une carte normale (temps, statut, avancement) : la tâche
// n'existe pas encore, elle sera créée par le conducteur à la validation.
//
// Toutes les règles (liste des ouvrages, recherche, ce qui manque, ligne
// produite) vivent dans compteRenduV2.mjs ; cet écran ne fait qu'afficher.
// Rien ne bloque l'envoi du compte rendu : « Plutôt décrire en texte libre »
// reste toujours possible (pas de réseau pour la photo, ouvrage introuvable…).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { Icon } from "../ui";
import { X, Search, ChevronLeft, Check, PenLine, WifiOff, Camera } from "lucide-react";
import { NATURES_TACHE } from "./motifsCompteRendu";
import {
  rechercherOuvrages, problemesNouvelleTache, LIBELLES_NOUVELLE_TACHE, NATURE_PHOTO_OBLIGATOIRE,
} from "./compteRenduV2";

const SOMBRE = "#1a1f2e";
const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" };

function MetaOuvrage({ o, T }) {
  const meta = [o.code, o.phases?.length ? o.phases.join(", ") : null].filter(Boolean).join(" · ");
  if (o.divers) {
    return <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>Ce qui ne rentre dans aucun ouvrage{o.id ? "" : " (sera créé)"}</div>;
  }
  return meta ? <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>{meta}</div> : null;
}

function Titre({ children, T, aide = null }) {
  return (
    <div style={{ fontSize: 16, fontWeight: 800, color: T.text, margin: "18px 0 8px" }}>
      {children}{aide && <span style={{ fontWeight: 600, color: T.textSub, fontSize: 14 }}> {aide}</span>}
    </div>
  );
}

export default function NouvelleTacheV2({
  ouvrages = [], saisieInitiale = null, chantierNom = "", enEdition = false,
  T, accent = "#FFC200", champPhotos, onValider, onLibre, onRetour, onFermer,
}) {
  const [saisie, setSaisie] = useState(() => ({
    nom: "", ouvrage: null, nature: null, demandeur: "", photos: [], ...(saisieInitiale || {}),
  }));
  const [choixOuvrage, setChoixOuvrage] = useState(!saisieInitiale?.ouvrage);
  const [recherche, setRecherche] = useState("");
  const maj = (patch) => setSaisie(s => ({ ...s, ...patch }));
  const problemes = problemesNouvelleTache(saisie);
  const horsLigne = typeof navigator !== "undefined" && navigator.onLine === false;
  const liste = rechercherOuvrages(ouvrages, recherche);

  return (
    <>
      {/* En-tête */}
      <div style={{ padding: "10px 14px 12px", borderBottom: `1px solid ${T.border}`, background: T.surface, borderRadius: "20px 20px 0 0" }}>
        <div style={{ width: 44, height: 5, borderRadius: 3, background: "#cbd2de", margin: "0 auto 10px" }}/>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={onRetour} aria-label="Retour" style={{
            width: 48, height: 48, borderRadius: 14, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: T.text, flexShrink: 0,
          }}><Icon as={ChevronLeft} size={24}/></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>{enEdition ? "Modifier la tâche" : "Nouvelle tâche"}</div>
            {chantierNom && <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chantierNom}</div>}
          </div>
          <button onClick={onFermer} aria-label="Fermer" style={{
            width: 48, height: 48, borderRadius: 14, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", color: T.text, flexShrink: 0,
          }}><Icon as={X} size={22}/></button>
        </div>
      </div>

      <div style={{ overflowY: "auto", padding: "4px 14px 12px", flex: 1 }}>
        {horsLigne && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, padding: 12, borderRadius: 14, background: T.warningBg, color: SOMBRE, fontSize: 14, lineHeight: 1.4 }}>
            <Icon as={WifiOff} size={18} style={{ flexShrink: 0, marginTop: 1 }}/>
            <span>Pas de connexion : les photos ne partiront pas. Tu peux décrire la tâche en texte libre, ton compte rendu partira quand même.</span>
          </div>
        )}

        {/* 1. Dans l'ouvrage */}
        <Titre T={T}>Dans l'ouvrage</Titre>
        {saisie.ouvrage && !choixOuvrage ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, border: `2px solid ${SOMBRE}`, background: T.surface }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div title={saisie.ouvrage.libelle} style={{ fontSize: 15.5, fontWeight: 800, color: T.text, lineHeight: 1.3, ...clamp2 }}>{saisie.ouvrage.libelle}</div>
              <MetaOuvrage o={saisie.ouvrage} T={T}/>
            </div>
            <button onClick={() => setChoixOuvrage(true)} style={{
              minHeight: 44, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.bg,
              cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 800, color: T.text, flexShrink: 0,
            }}>Changer</button>
          </div>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", minHeight: 48, borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.surface }}>
              <Icon as={Search} size={17} style={{ color: T.textMuted }}/>
              <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Chercher un ouvrage, un code, une phase"
                style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: T.text, minWidth: 0 }}/>
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxHeight: "38vh", overflowY: "auto" }}>
              {liste.length === 0 && (
                <div style={{ padding: "12px 4px", fontSize: 14, color: T.textSub }}>Aucun ouvrage ne correspond à ta recherche.</div>
              )}
              {liste.map(o => {
                const sel = saisie.ouvrage && (saisie.ouvrage.id || null) === (o.id || null);
                return (
                  <button key={o.id || "__divers__"} onClick={() => { maj({ ouvrage: o }); setChoixOuvrage(false); setRecherche(""); }} aria-pressed={!!sel} style={{
                    textAlign: "left", padding: "10px 12px", minHeight: 52, flexShrink: 0, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                    border: `${sel ? 2 : 1.5}px solid ${sel ? SOMBRE : T.border}`, background: o.divers ? T.bg : T.surface, color: T.text,
                  }}>
                    <div title={o.libelle} style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, ...clamp2 }}>{o.libelle}</div>
                    <MetaOuvrage o={o} T={T}/>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 2. Ce que tu as fait */}
        <Titre T={T}>Ce que tu as fait</Titre>
        <textarea value={saisie.nom} onChange={e => maj({ nom: e.target.value })} placeholder="Ex. : reprise de l'enduit derrière le radiateur"
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 60, resize: "none", fontSize: 16, fontFamily: "inherit",
            border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", background: T.surface, color: T.text,
          }}/>

        {/* 3. Pourquoi */}
        <Titre T={T}>Pourquoi cette tâche ?</Titre>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {NATURES_TACHE.map(n => {
            const sel = saisie.nature === n.code;
            return (
              <button key={n.code} onClick={() => maj({ nature: n.code })} aria-pressed={sel} style={{
                minHeight: 56, padding: "8px 14px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                border: `2px solid ${sel ? SOMBRE : T.border}`, background: sel ? SOMBRE : T.surface, color: sel ? "#fff" : T.text,
                display: "flex", alignItems: "center", gap: 10, fontSize: 16, fontWeight: 800,
              }}>
                <span style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0, border: `2px solid ${sel ? "#fff" : T.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{sel && <Icon as={Check} size={14} strokeWidth={3}/>}</span>
                {n.description}
              </button>
            );
          })}
        </div>

        {/* 4. Demande du client : photo obligatoire, demandeur facultatif */}
        {saisie.nature === NATURE_PHOTO_OBLIGATOIRE && (
          <>
            <Titre T={T} aide={problemes.includes("photo") ? "(obligatoire)" : null}>
              <Icon as={Camera} size={16} style={{ verticalAlign: -2, marginRight: 6 }}/>Photo de la demande
            </Titre>
            <div style={{ padding: 10, borderRadius: 14, border: `1.5px solid ${problemes.includes("photo") ? T.dangerBd : T.border}`, background: T.surface }}>
              {champPhotos ? champPhotos(saisie.photos, (photos) => maj({ photos })) : null}
            </div>
            <Titre T={T} aide="(facultatif)">Qui l'a demandé ?</Titre>
            <input value={saisie.demandeur} onChange={e => maj({ demandeur: e.target.value })} placeholder="Ex. : Mme Martin, la propriétaire"
              style={{
                width: "100%", boxSizing: "border-box", minHeight: 48, fontSize: 16, fontFamily: "inherit",
                border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "0 12px", background: T.surface, color: T.text,
              }}/>
          </>
        )}

        <div style={{ fontSize: 13, color: T.textSub, marginTop: 16, lineHeight: 1.45 }}>
          La tâche sera créée dans le phasage par ton conducteur, quand il validera ton compte rendu.
        </div>
      </div>

      {/* Pied : ce qui manque, ajout, repli texte libre */}
      <div style={{ padding: "8px 14px calc(8px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, background: T.surface }}>
        {problemes.length > 0 && (
          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.textSub, marginBottom: 6, textAlign: "center" }}>
            Pour ajouter : {problemes.map(p => LIBELLES_NOUVELLE_TACHE[p]).join(", ")}
          </div>
        )}
        <button disabled={problemes.length > 0} onClick={() => onValider(saisie)} style={{
          width: "100%", minHeight: 56, borderRadius: 14, fontFamily: "inherit", fontSize: 17, fontWeight: 800,
          border: `2px solid ${SOMBRE}`, background: problemes.length > 0 ? T.bg : accent, color: SOMBRE,
          cursor: problemes.length > 0 ? "not-allowed" : "pointer", opacity: problemes.length > 0 ? 0.55 : 1,
        }}>{enEdition ? "Enregistrer" : "Ajouter à ma journée"}</button>
        {!enEdition && (
          <button onClick={onLibre} style={{
            width: "100%", minHeight: 44, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
            color: T.textSub, fontSize: 14.5, fontWeight: 700, textDecoration: "underline",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}><Icon as={PenLine} size={15}/> Plutôt décrire en texte libre</button>
        )}
      </div>
    </>
  );
}
