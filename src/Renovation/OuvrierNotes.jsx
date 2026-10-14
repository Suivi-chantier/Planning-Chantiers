// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — Onglet « Notes » : carnet de notes de l'ouvrier.
//
//   • Mes notes  : ce que j'ai écrit (privé par défaut) ;
//   • Reçues     : ce qu'un collègue a partagé avec moi ;
//   • Mémos      : les mémos chantier (digicode, clés, coupure d'eau…),
//                  visibles par tous les ouvriers et le bureau.
//
// Une note : type (note / à signaler / astuce), titre, texte, liste à cocher,
// photos (bucket PRIVÉ notes-ouvriers), chantier facultatif, partage (collègues,
// bureau, mémo). Les notes partagées ont un fil de réponses.
//
// Les composants EditeurNote et DetailNote servent aussi au mémo chantier de
// l'onglet Opérations (MemosChantierOuvrier) : une seule implémentation.
// Qui voit quoi est décidé par la base (RLS) ; l'écran ne fait que l'expliquer.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS, loadEquipes } from "../constants";
import { Icon } from "../ui";
import {
  StickyNote, Lock, Users, Building2, Pin, AlertTriangle, Lightbulb, Camera, CheckSquare, Square,
  Send, Pencil, Trash2, ArrowLeft, Plus, X, MessageCircle, Inbox, Eye, Loader,
} from "lucide-react";
import { MobileCard, MobileEmptyState, MobileTabs, Pill } from "../mobileUI";
import {
  TYPES_NOTE, ORDRE_TYPES, typeNote, estPrivee, libellePartage, libelleSuivi, titreAffiche,
  progressionChecklist, ajouterElement, basculerElement, retirerElement, brouillonVide, brouillonDepuisNote,
  problemesNote, ligneDepuisBrouillon, estNonLue, classerNotesOuvrier, normaliserPrenom, LIMITES,
} from "./notesOuvriers.js";
import {
  chargerNotes, enregistrerNote, supprimerNote, chargerReponses, envoyerReponse, marquerLue,
  chargerDestinataires, envoyerPhoto, retirerPhotoNonEnregistree, liensPhotos, monUid,
} from "./notesOuvriersStore.js";

const NAV_H = 66; // hauteur de la bottom-nav de l'espace ouvrier
const ICONES_TYPE = { note: StickyNote, signaler: AlertTriangle, astuce: Lightbulb };

const dateCourte = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
    + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};
const dateJour = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
};

// Chantiers (planning_config, lisible par les ouvriers) — chargés une fois.
export function useChantiersOuvrier() {
  const [chantiers, setChantiers] = useState(DEFAULT_CHANTIERS);
  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantiers").maybeSingle()
      .then(({ data }) => { if (Array.isArray(data?.value) && data.value.length) setChantiers(data.value); });
  }, []);
  return chantiers;
}

function MessageMigration({ T }) {
  return (
    <MobileCard T={T}>
      <MobileEmptyState T={T} icon={StickyNote} title="Notes pas encore activées"
        hint="La mise à jour de la base qui active les notes n'est pas encore appliquée. Préviens le bureau."/>
    </MobileCard>
  );
}

// ── Icône de partage ────────────────────────────────────────────────────────
function IconePartage({ note, size = 12 }) {
  const ic = note.memo_chantier ? Pin : estPrivee(note) ? Lock : note.partage_bureau ? Building2 : Users;
  return <Icon as={ic} size={size} strokeWidth={2.2}/>;
}

// ── Carte (liste) ───────────────────────────────────────────────────────────
export function CarteNote({ note, T, accent, nomChantier, nonLue = false, onClick, montrerAuteur = false }) {
  const ty = typeNote(note.type);
  const prog = progressionChecklist(note.checklist);
  const nbPhotos = Array.isArray(note.photos) ? note.photos.length : 0;
  return (
    <MobileCard T={T} accent={ty.couleur} style={{ padding: 0, overflow: "hidden" }}>
      <button onClick={onClick} style={{
        width: "100%", textAlign: "left", border: "none", background: "transparent", cursor: "pointer",
        fontFamily: "inherit", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {nonLue && <span title="Nouveau" style={{ width: 9, height: 9, borderRadius: "50%", background: accent, flexShrink: 0, boxShadow: `0 0 0 3px ${accent}33` }}/>}
          <span style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {titreAffiche(note)}
          </span>
          {note.type !== "note" && <Pill color={ty.couleur}><Icon as={ICONES_TYPE[note.type]} size={11} strokeWidth={2.4}/> {ty.label}</Pill>}
        </div>
        {String(note.contenu || "").trim() && String(note.titre || "").trim() && (
          <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {note.contenu}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: T.textMuted }}>
          {montrerAuteur && <span style={{ fontWeight: 700, color: T.textSub }}>{note.auteur}</span>}
          {note.chantier_id && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Building2} size={11}/> {nomChantier(note.chantier_id)}</span>}
          {prog.total > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={CheckSquare} size={11}/> {prog.faits}/{prog.total}</span>}
          {nbPhotos > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Camera} size={11}/> {nbPhotos}</span>}
          {note.nb_reponses > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={MessageCircle} size={11}/> {note.nb_reponses}</span>}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><IconePartage note={note} size={11}/> {libellePartage(note, { pourAuteur: false }).split(" : ")[0]}</span>
          <span style={{ marginLeft: "auto" }}>{dateCourte(note.derniere_activite)}</span>
        </div>
      </button>
    </MobileCard>
  );
}

// ── Photos (liens temporaires) ──────────────────────────────────────────────
function GrillePhotos({ chemins, liens, T, onRetirer = null }) {
  if (!chemins?.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
      {chemins.map(c => (
        <div key={c} style={{ position: "relative", aspectRatio: "1/1", borderRadius: 12, overflow: "hidden", background: T.card, border: `1px solid ${T.border}` }}>
          {liens[c]
            ? <img src={liens[c]} alt="" onClick={() => window.open(liens[c], "_blank")} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "pointer" }}/>
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted }}><Icon as={Camera} size={20}/></div>}
          {onRetirer && (
            <button onClick={() => onRetirer(c)} aria-label="Retirer la photo" style={{
              position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: "50%", border: "none",
              background: "rgba(16,24,40,0.7)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}><Icon as={X} size={14} strokeWidth={2.6}/></button>
          )}
        </div>
      ))}
    </div>
  );
}

const styleLabel = (T) => ({ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.textMuted, display: "block", marginBottom: 6 });
const styleInput = (T) => ({
  width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "11px 12px",
  fontSize: 16, fontFamily: "inherit", outline: "none", boxSizing: "border-box", color: T.text, background: T.surface,
});

function Interrupteur({ actif, onChange, titre, aide, icone, T, accent, desactive = false }) {
  return (
    <button onClick={() => !desactive && onChange(!actif)} disabled={desactive} style={{
      width: "100%", display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", textAlign: "left",
      borderRadius: 12, border: `1.5px solid ${actif ? accent : T.border}`, background: actif ? `${accent}14` : T.surface,
      fontFamily: "inherit", cursor: desactive ? "not-allowed" : "pointer", opacity: desactive ? 0.55 : 1,
    }}>
      <Icon as={icone} size={17} strokeWidth={2.2} style={{ color: actif ? T.text : T.textMuted, flexShrink: 0 }}/>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14.5, fontWeight: 800, color: T.text }}>{titre}</span>
        {aide && <span style={{ display: "block", fontSize: 12, color: T.textSub, marginTop: 2, lineHeight: 1.35 }}>{aide}</span>}
      </span>
      <span style={{
        width: 42, height: 24, borderRadius: 999, flexShrink: 0, position: "relative", transition: "background .15s",
        background: actif ? accent : T.border,
      }}>
        <span style={{ position: "absolute", top: 3, left: actif ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" }}/>
      </span>
    </button>
  );
}

// ── Éditeur ─────────────────────────────────────────────────────────────────
export function EditeurNote({
  T, accent, prenom, note = null, initial = null, chantiers, destinataires, equipes = [],
  onAnnuler, onEnregistree, preview = false,
}) {
  const [b, setB] = useState(() => note ? brouillonDepuisNote(note) : (initial || brouillonVide()));
  const [nouvelElement, setNouvelElement] = useState("");
  const [liens, setLiens] = useState({});
  const [envoiPhoto, setEnvoiPhoto] = useState(0);
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const ajoutees = useRef([]);           // photos envoyées pendant cette édition
  const originales = useRef(note?.photos || []);
  const fichier = useRef(null);
  const set = (patch) => setB(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    liensPhotos(originales.current).then(l => setLiens(prev => ({ ...l, ...prev })));
  }, []);

  // Équipes dont je fais partie → collègues ayant un compte.
  const mesEquipes = useMemo(() => {
    const moi = normaliserPrenom(prenom);
    const avecCompte = new Set(destinataires.map(normaliserPrenom));
    return equipes
      .filter(e => !e.externe)
      .filter(e => [...(e.responsables || []), ...(e.membres || []).map(m => m.ouvrier)].some(p => normaliserPrenom(p) === moi))
      .map(e => ({
        ...e,
        comptes: destinataires.filter(d =>
          [...(e.responsables || []), ...(e.membres || []).map(m => m.ouvrier)].some(p => normaliserPrenom(p) === normaliserPrenom(d))
          && avecCompte.has(normaliserPrenom(d))),
      }))
      .filter(e => e.comptes.length > 0);
  }, [equipes, destinataires, prenom]);

  const basculerCollegue = (p) => {
    const cle = normaliserPrenom(p);
    const deja = b.partage_ouvriers.some(x => normaliserPrenom(x) === cle);
    set({ partage_ouvriers: deja ? b.partage_ouvriers.filter(x => normaliserPrenom(x) !== cle) : [...b.partage_ouvriers, p] });
  };
  const ajouterEquipe = (e) => {
    const cles = new Set(b.partage_ouvriers.map(normaliserPrenom));
    set({ partage_ouvriers: [...b.partage_ouvriers, ...e.comptes.filter(p => !cles.has(normaliserPrenom(p)))] });
  };

  const ajouterPhotos = async (fichiers) => {
    const liste = [...(fichiers || [])].slice(0, Math.max(0, LIMITES.photos - b.photos.length));
    if (!liste.length) return;
    setErreur(null);
    for (const f of liste) {
      setEnvoiPhoto(n => n + 1);
      const { chemin, erreur: e } = await envoyerPhoto(f);
      setEnvoiPhoto(n => n - 1);
      if (e) { setErreur(`Photo non envoyée : ${e}`); continue; }
      ajoutees.current.push(chemin);
      setLiens(prev => ({ ...prev, [chemin]: URL.createObjectURL(f) }));
      setB(prev => ({ ...prev, photos: [...prev.photos, chemin] }));
    }
  };
  const retirerPhoto = (c) => {
    set({ photos: b.photos.filter(x => x !== c) });
    if (ajoutees.current.includes(c)) {
      ajoutees.current = ajoutees.current.filter(x => x !== c);
      retirerPhotoNonEnregistree(c);
    }
  };

  const annuler = () => {
    ajoutees.current.forEach(retirerPhotoNonEnregistree);
    onAnnuler();
  };

  const problemes = problemesNote(b);
  const enregistrer = async () => {
    if (preview || problemes.length || enregistrement || envoiPhoto > 0) return;
    setEnregistrement(true); setErreur(null);
    const { data, erreur: e } = await enregistrerNote(note?.id || null, ligneDepuisBrouillon(b, prenom));
    setEnregistrement(false);
    if (e) { setErreur(`Enregistrement impossible : ${e}`); return; }
    // Photos retirées d'une note existante : effacées une fois la note à jour.
    const retirees = originales.current.filter(c => !b.photos.includes(c));
    retirees.forEach(retirerPhotoNonEnregistree);
    ajoutees.current = [];
    onEnregistree(data);
  };

  const L = styleLabel(T), I = styleInput(T);
  const chantiersActifs = chantiers.filter(c => !c.archive || c.id === b.chantier_id);
  const apercu = ligneDepuisBrouillon(b, prenom);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 80 }}>
      <button onClick={annuler} style={{
        alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
        borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
        fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer",
      }}><Icon as={ArrowLeft} size={15}/> Annuler</button>

      <MobileCard T={T} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <span style={L}>Type</span>
          <div style={{ display: "flex", gap: 6 }}>
            {ORDRE_TYPES.map(id => {
              const ty = TYPES_NOTE[id], sel = b.type === id;
              return (
                <button key={id} onClick={() => set({ type: id, ...(id === "signaler" && b.type !== "signaler" && !note ? { partage_bureau: true } : {}) })} style={{
                  flex: 1, padding: "9px 4px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                  fontSize: 13.5, fontWeight: 800, border: `1.5px solid ${sel ? ty.couleur : T.border}`,
                  background: sel ? `${ty.couleur}18` : T.surface, color: sel ? ty.couleur : T.textMuted,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}><Icon as={ICONES_TYPE[id]} size={14} strokeWidth={2.3}/> {ty.label}</button>
              );
            })}
          </div>
          {b.type === "signaler" && (
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 6, lineHeight: 1.4 }}>
              Problème, malfaçon, danger : envoyée au bureau, elle remonte en tête de sa liste.
            </div>
          )}
        </div>
        <div>
          <label style={L}>Titre</label>
          <input style={I} value={b.titre} maxLength={LIMITES.titre} onChange={e => set({ titre: e.target.value })} placeholder="Ex. : Digicode, fuite salle de bain…"/>
        </div>
        <div>
          <label style={L}>Texte</label>
          <textarea style={{ ...I, minHeight: 110, resize: "vertical", lineHeight: 1.45 }} value={b.contenu}
            onChange={e => set({ contenu: e.target.value })} placeholder="Écris ta note… (le micro du clavier permet de dicter)"/>
        </div>
      </MobileCard>

      {/* Liste à cocher */}
      <MobileCard T={T} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ ...L, marginBottom: 0 }}>Liste à cocher</span>
        {b.checklist.map(e => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={() => set({ checklist: basculerElement(b.checklist, e.id) })} style={{ border: "none", background: "transparent", padding: 2, cursor: "pointer", color: e.fait ? "#22a35a" : T.textMuted }}>
              <Icon as={e.fait ? CheckSquare : Square} size={20} strokeWidth={2.1}/>
            </button>
            <span style={{ flex: 1, fontSize: 15, color: e.fait ? T.textMuted : T.text, textDecoration: e.fait ? "line-through" : "none" }}>{e.texte}</span>
            <button onClick={() => set({ checklist: retirerElement(b.checklist, e.id) })} aria-label="Retirer" style={{ border: "none", background: "transparent", color: T.textMuted, cursor: "pointer", padding: 4 }}>
              <Icon as={X} size={15}/>
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...I, flex: 1 }} value={nouvelElement} onChange={e => setNouvelElement(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); set({ checklist: ajouterElement(b.checklist, nouvelElement, crypto.randomUUID()) }); setNouvelElement(""); } }}
            placeholder="Ex. : prendre le perforateur"/>
          <button onClick={() => { set({ checklist: ajouterElement(b.checklist, nouvelElement, crypto.randomUUID()) }); setNouvelElement(""); }}
            disabled={!nouvelElement.trim()} aria-label="Ajouter" style={{
              width: 46, borderRadius: 12, border: "none", background: nouvelElement.trim() ? accent : T.border,
              color: "#1a1f2e", cursor: nouvelElement.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center",
            }}><Icon as={Plus} size={18} strokeWidth={2.5}/></button>
        </div>
      </MobileCard>

      {/* Photos */}
      <MobileCard T={T} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ ...L, marginBottom: 0 }}>Photos ({b.photos.length}/{LIMITES.photos})</span>
        <GrillePhotos chemins={b.photos} liens={liens} T={T} onRetirer={retirerPhoto}/>
        <input ref={fichier} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={e => { ajouterPhotos(e.target.files); e.target.value = ""; }}/>
        <button onClick={() => fichier.current?.click()} disabled={preview || b.photos.length >= LIMITES.photos || envoiPhoto > 0} style={{
          padding: "11px", border: `1.5px dashed ${T.border}`, borderRadius: 12, background: T.surface,
          color: T.textSub, fontFamily: "inherit", fontSize: 14, fontWeight: 700,
          cursor: (preview || b.photos.length >= LIMITES.photos) ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          <Icon as={envoiPhoto > 0 ? Loader : Camera} size={15}/> {envoiPhoto > 0 ? "Envoi de la photo…" : "Prendre / ajouter une photo"}
        </button>
      </MobileCard>

      {/* Chantier + partage */}
      <MobileCard T={T} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={L}>Chantier (facultatif)</label>
          <select style={I} value={b.chantier_id} onChange={e => set({ chantier_id: e.target.value, ...(e.target.value ? {} : { memo_chantier: false }) })}>
            <option value="">— Aucun —</option>
            {chantiersActifs.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <Interrupteur T={T} accent={accent} icone={Pin} actif={b.memo_chantier} desactive={!b.chantier_id}
          onChange={v => set({ memo_chantier: v })} titre="Épingler comme mémo du chantier"
          aide={b.chantier_id ? "Digicode, clés, coupure d'eau… visible par tous les ouvriers et le bureau." : "Choisis d'abord un chantier."}/>
        {!b.memo_chantier && (
          <>
            <Interrupteur T={T} accent={accent} icone={Building2} actif={b.partage_bureau}
              onChange={v => set({ partage_bureau: v })} titre="Envoyer au bureau"
              aide="Le bureau la voit, peut répondre et la marquer comme traitée."/>
            <div>
              <span style={L}>Partager avec des collègues</span>
              {mesEquipes.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {mesEquipes.map(e => (
                    <button key={e.id} onClick={() => ajouterEquipe(e)} style={{
                      padding: "6px 12px", borderRadius: 999, border: `1.5px dashed ${e.couleur || T.border}`, background: T.surface,
                      color: T.textSub, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", gap: 5,
                    }}><Icon as={Users} size={13}/> Toute l'équipe {e.nom}</button>
                  ))}
                </div>
              )}
              {destinataires.length === 0 ? (
                <div style={{ fontSize: 13, color: T.textMuted }}>Aucun collègue avec un compte pour l'instant.</div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {destinataires.map(p => {
                    const sel = b.partage_ouvriers.some(x => normaliserPrenom(x) === normaliserPrenom(p));
                    return (
                      <button key={p} onClick={() => basculerCollegue(p)} style={{
                        padding: "7px 13px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 700,
                        border: `1.5px solid ${sel ? "transparent" : T.border}`,
                        background: sel ? `linear-gradient(135deg, ${accent}, ${accent}cc)` : T.surface,
                        color: sel ? "#1a1f2e" : T.textSub,
                      }}>{p}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", borderRadius: 10,
          background: T.card, fontSize: 13, fontWeight: 700, color: T.textSub,
        }}>
          <IconePartage note={apercu} size={14}/> {libellePartage(apercu)}
        </div>
      </MobileCard>

      {(problemes.length > 0 || erreur) && (
        <div style={{ fontSize: 13, color: erreur ? "#c0392b" : T.textMuted, lineHeight: 1.45, padding: "0 4px" }}>
          {erreur || problemes[0]}
        </div>
      )}

      <div style={{ position: "fixed", left: 0, right: 0, bottom: NAV_H, zIndex: 49, padding: "10px 12px 12px",
        background: `linear-gradient(to top, ${T.bg} 62%, ${T.bg}cc 82%, transparent)` }}>
        {(() => {
          const bloque = preview || problemes.length > 0 || enregistrement || envoiPhoto > 0;
          return (
            <button onClick={enregistrer} disabled={bloque} style={{
              width: "100%", padding: "15px", border: "none", borderRadius: 15,
              background: bloque ? T.border : `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: "#1a1f2e",
              fontFamily: "inherit", fontSize: 16, fontWeight: 800, cursor: bloque ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: bloque ? "none" : `0 8px 20px ${accent}66`,
            }}>
              <Icon as={estPrivee(apercu) ? Lock : Send} size={17} strokeWidth={2.3}/>
              {preview ? "Aperçu : enregistrement désactivé" : enregistrement ? "Enregistrement…"
                : estPrivee(apercu) ? "Enregistrer la note" : note ? "Enregistrer et partager" : "Enregistrer et envoyer"}
            </button>
          );
        })()}
      </div>
    </div>
  );
}

// ── Détail ──────────────────────────────────────────────────────────────────
export function DetailNote({ T, accent, note, uid, nomChantier, onRetour, onModifier, onSupprimee, onMaj, retourLabel = "Retour", preview = false }) {
  const mienne = note.auteur_uid === uid;
  const ty = typeNote(note.type);
  const [liens, setLiens] = useState({});
  const [reponses, setReponses] = useState(null);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);
  const privee = estPrivee(note);

  useEffect(() => {
    liensPhotos(note.photos).then(setLiens);
    if (!preview) marquerLue(note.id);
    if (!privee) chargerReponses(note.id).then(({ data }) => setReponses(data || []));
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cocher = async (id) => {
    if (!mienne || preview) return;
    const checklist = basculerElement(note.checklist, id);
    onMaj({ ...note, checklist });                       // affichage immédiat
    const { data, erreur: e } = await enregistrerNote(note.id, { checklist });
    if (e) { setErreur("La case n'a pas pu être enregistrée."); onMaj(note); return; }
    onMaj(data);
  };

  const supprimer = async () => {
    if (preview || !window.confirm("Supprimer cette note ? Elle disparaîtra aussi pour ceux avec qui elle est partagée.")) return;
    const { erreur: e } = await supprimerNote(note);
    if (e) { setErreur(`Suppression impossible : ${e}`); return; }
    onSupprimee(note.id);
  };

  const repondre = async () => {
    const t = texte.trim();
    if (!t || envoi || preview) return;
    setEnvoi(true); setErreur(null);
    const { data, erreur: e } = await envoyerReponse(note.id, t);
    setEnvoi(false);
    if (e) { setErreur(`Réponse non envoyée : ${e}`); return; }
    setReponses(r => [...(r || []), data]); setTexte("");
    onMaj({ ...note, nb_reponses: (note.nb_reponses || 0) + 1, derniere_activite: data.created_at, derniere_activite_par: uid });
    marquerLue(note.id);
  };

  const suivi = libelleSuivi(note, dateJour);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <button onClick={onRetour} style={{
        alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
        borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, color: T.textSub,
        fontFamily: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer",
      }}><Icon as={ArrowLeft} size={15}/> {retourLabel}</button>

      <MobileCard T={T} accent={ty.couleur} style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 19, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>{titreAffiche(note)}</div>
          {note.type !== "note" && <Pill color={ty.couleur}><Icon as={ICONES_TYPE[note.type]} size={11} strokeWidth={2.4}/> {ty.label}</Pill>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: T.textMuted }}>
          <span style={{ fontWeight: 700, color: T.textSub }}>{mienne ? "Toi" : note.auteur}</span>
          {note.chantier_id && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Building2} size={12}/> {nomChantier(note.chantier_id)}</span>}
          <span>{dateCourte(note.created_at)}</span>
        </div>
        {String(note.contenu || "").trim() && (
          <div style={{ fontSize: 15, color: T.text, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.contenu}</div>
        )}
        {Array.isArray(note.checklist) && note.checklist.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {note.checklist.map(e => (
              <button key={e.id} onClick={() => cocher(e.id)} disabled={!mienne || preview} style={{
                display: "flex", alignItems: "center", gap: 9, border: "none", background: "transparent", padding: "3px 0",
                fontFamily: "inherit", textAlign: "left", cursor: mienne && !preview ? "pointer" : "default",
              }}>
                <Icon as={e.fait ? CheckSquare : Square} size={20} strokeWidth={2.1} style={{ color: e.fait ? "#22a35a" : T.textMuted, flexShrink: 0 }}/>
                <span style={{ fontSize: 15, color: e.fait ? T.textMuted : T.text, textDecoration: e.fait ? "line-through" : "none" }}>{e.texte}</span>
              </button>
            ))}
          </div>
        )}
        <GrillePhotos chemins={note.photos} liens={liens} T={T}/>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", borderRadius: 10, background: T.card, fontSize: 12.5, fontWeight: 700, color: T.textSub }}>
          <IconePartage note={note} size={13}/> {mienne ? libellePartage(note) : libellePartage(note, { pourAuteur: false })}
        </div>
        {suivi && <div style={{ fontSize: 12.5, color: T.textMuted, display: "flex", alignItems: "center", gap: 6 }}><Icon as={Eye} size={13}/> Bureau : {suivi}</div>}
        {mienne && !preview && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onModifier} style={{
              flex: 1, padding: "10px", borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.surface,
              color: T.text, fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}><Icon as={Pencil} size={14}/> Modifier / partager</button>
            <button onClick={supprimer} aria-label="Supprimer" style={{
              padding: "10px 14px", borderRadius: 12, border: "1.5px solid #e05c5c55", background: "#e05c5c12",
              color: "#e05c5c", fontFamily: "inherit", cursor: "pointer", display: "inline-flex", alignItems: "center",
            }}><Icon as={Trash2} size={15}/></button>
          </div>
        )}
      </MobileCard>

      {!privee && (
        <MobileCard T={T} style={{ padding: "13px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ ...styleLabel(T), marginBottom: 0 }}>Réponses</span>
          {reponses === null ? (
            <div style={{ fontSize: 13, color: T.textMuted }}>Chargement…</div>
          ) : reponses.length === 0 ? (
            <div style={{ fontSize: 13, color: T.textMuted }}>Aucune réponse pour l'instant.</div>
          ) : reponses.map(r => {
            const moi = r.auteur_uid === uid;
            return (
              <div key={r.id} style={{
                alignSelf: moi ? "flex-end" : "flex-start", maxWidth: "88%", padding: "8px 11px", borderRadius: 13,
                background: moi ? `${accent}26` : r.cote === "bureau" ? "#5b8af51a" : T.card,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textSub, marginBottom: 2 }}>
                  {moi ? "Toi" : r.auteur}{r.cote === "bureau" && !moi ? " · bureau" : ""} · {dateCourte(r.created_at)}
                </div>
                <div style={{ fontSize: 14.5, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4 }}>{r.contenu}</div>
              </div>
            );
          })}
          {!preview && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea value={texte} onChange={e => setTexte(e.target.value)} maxLength={LIMITES.reponse} rows={2}
                placeholder="Répondre…" style={{ ...styleInput(T), flex: 1, resize: "vertical", lineHeight: 1.4 }}/>
              <button onClick={repondre} disabled={!texte.trim() || envoi} aria-label="Envoyer" style={{
                width: 48, height: 48, borderRadius: 12, border: "none", flexShrink: 0,
                background: texte.trim() && !envoi ? accent : T.border, color: "#1a1f2e",
                cursor: texte.trim() && !envoi ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center",
              }}><Icon as={envoi ? Loader : Send} size={18} strokeWidth={2.3}/></button>
            </div>
          )}
        </MobileCard>
      )}
      {erreur && <div style={{ fontSize: 13, color: "#c0392b", padding: "0 4px" }}>{erreur}</div>}
    </div>
  );
}

// ── Données partagées par l'onglet Notes et le mémo chantier ────────────────
export function useNotesOuvrier({ preview = false } = {}) {
  const [etat, setEtat] = useState({ notes: null, lectures: {}, erreur: null });
  const [uid, setUid] = useState(null);
  const [destinataires, setDestinataires] = useState([]);
  const [equipes, setEquipes] = useState([]);

  const recharger = useCallback(async () => {
    const r = await chargerNotes();
    setEtat({ notes: r.data, lectures: r.lectures, erreur: r.erreur });
  }, []);

  useEffect(() => {
    monUid().then(setUid);
    recharger();
    if (!preview) {
      chargerDestinataires().then(({ data }) => setDestinataires(data));
      loadEquipes().then(setEquipes).catch(() => setEquipes([]));
    }
  }, [recharger, preview]);

  const remplacer = useCallback((n) => setEtat(e => ({
    ...e, notes: (e.notes || []).some(x => x.id === n.id) ? e.notes.map(x => x.id === n.id ? n : x) : [n, ...(e.notes || [])],
  })), []);
  const retirer = useCallback((id) => setEtat(e => ({ ...e, notes: (e.notes || []).filter(x => x.id !== id) })), []);
  const marquerLueLocal = useCallback((id) => setEtat(e => ({ ...e, lectures: { ...e.lectures, [id]: new Date().toISOString() } })), []);

  return { ...etat, uid, destinataires, equipes, recharger, remplacer, retirer, marquerLueLocal };
}

// ── Onglet ──────────────────────────────────────────────────────────────────
export default function OuvrierNotes({ prenom, T, accent = "#FFC200", preview = false, onNonLues = null }) {
  const chantiers = useChantiersOuvrier();
  const d = useNotesOuvrier({ preview });
  const [onglet, setOnglet] = useState("miennes");
  const [vue, setVue] = useState({ mode: "liste" }); // liste | detail {id} | edition {id?, initial?}

  const nomChantier = (id) => chantiers.find(c => c.id === id)?.nom || id || "—";
  const classe = useMemo(() => classerNotesOuvrier(d.notes || [], d.uid), [d.notes, d.uid]);
  const nonLue = (n) => estNonLue(n, d.lectures, d.uid);
  const nbNonLues = (d.notes || []).filter(nonLue).length;
  useEffect(() => { onNonLues?.(nbNonLues); }, [nbNonLues, onNonLues]);

  if (preview) {
    return (
      <MobileCard T={T}>
        <MobileEmptyState T={T} icon={Lock} title="Notes privées"
          hint={`Les notes de ${prenom || "l'ouvrier"} lui appartiennent : le bureau ne voit que celles qu'il partage, dans la page « Notes des ouvriers ».`}/>
      </MobileCard>
    );
  }
  if (d.erreur === "absente") return <MessageMigration T={T}/>;

  const noteSel = vue.mode !== "liste" && vue.id ? (d.notes || []).find(n => n.id === vue.id) : null;

  if (vue.mode === "edition") {
    return (
      <EditeurNote T={T} accent={accent} prenom={prenom} note={noteSel} initial={vue.initial}
        chantiers={chantiers} destinataires={d.destinataires} equipes={d.equipes}
        onAnnuler={() => setVue(noteSel ? { mode: "detail", id: noteSel.id } : { mode: "liste" })}
        onEnregistree={(n) => { d.remplacer(n); d.marquerLueLocal(n.id); setVue({ mode: "detail", id: n.id }); }}/>
    );
  }
  if (vue.mode === "detail" && noteSel) {
    return (
      <DetailNote T={T} accent={accent} note={noteSel} uid={d.uid} nomChantier={nomChantier}
        retourLabel="Mes notes"
        onRetour={() => { d.marquerLueLocal(noteSel.id); setVue({ mode: "liste" }); }}
        onModifier={() => setVue({ mode: "edition", id: noteSel.id })}
        onSupprimee={(id) => { d.retirer(id); setVue({ mode: "liste" }); }}
        onMaj={d.remplacer}/>
    );
  }

  const liste = classe[onglet] || [];
  const vide = {
    miennes: { icon: StickyNote, titre: "Aucune note pour l'instant", aide: "Note un détail de chantier, une mesure, un pense-bête. Elle reste privée tant que tu ne la partages pas." },
    recues:  { icon: Inbox,      titre: "Rien de reçu", aide: "Les notes que tes collègues partagent avec toi arrivent ici." },
    memos:   { icon: Pin,        titre: "Aucun mémo chantier", aide: "Un mémo chantier (digicode, clés, coupure d'eau…) est visible par tous les ouvriers et le bureau." },
  }[onglet];
  const nbNonLuesOnglet = (l) => l.filter(nonLue).length || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <MobileTabs T={T} accent={accent} onAccent="#1a1f2e" value={onglet} onChange={setOnglet} tabs={[
        { id: "miennes", label: "Mes notes", icon: StickyNote, count: nbNonLuesOnglet(classe.miennes) },
        { id: "recues",  label: "Reçues",    icon: Inbox,      count: nbNonLuesOnglet(classe.recues) },
        { id: "memos",   label: "Mémos chantier", icon: Pin,   count: nbNonLuesOnglet(classe.memos) },
      ]}/>

      {d.notes === null && !d.erreur && (
        <div style={{ padding: "30px", textAlign: "center", color: T.textMuted, fontSize: 13, letterSpacing: 2 }}>CHARGEMENT…</div>
      )}
      {d.erreur === "reseau" && (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={AlertTriangle} title="Notes non chargées" hint="Vérifie ta connexion, puis réessaie."/>
          <button onClick={d.recharger} style={{ margin: "0 auto 16px", display: "block", padding: "9px 18px", borderRadius: 12, border: "none", background: accent, color: "#1a1f2e", fontFamily: "inherit", fontWeight: 800, cursor: "pointer" }}>Réessayer</button>
        </MobileCard>
      )}
      {Array.isArray(d.notes) && (liste.length === 0 ? (
        <MobileCard T={T}><MobileEmptyState T={T} icon={vide.icon} title={vide.titre} hint={vide.aide}/></MobileCard>
      ) : liste.map(n => (
        <CarteNote key={n.id} note={n} T={T} accent={accent} nomChantier={nomChantier} nonLue={nonLue(n)}
          montrerAuteur={n.auteur_uid !== d.uid} onClick={() => setVue({ mode: "detail", id: n.id })}/>
      )))}

      <div style={{ height: 72 }}/>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: NAV_H, zIndex: 49, padding: "10px 12px 12px",
        background: `linear-gradient(to top, ${T.bg} 62%, ${T.bg}cc 82%, transparent)` }}>
        <button onClick={() => setVue({ mode: "edition", initial: brouillonVide() })} disabled={!!d.erreur} style={{
          width: "100%", padding: "15px", border: "none", borderRadius: 15,
          background: d.erreur ? T.border : `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: "#1a1f2e",
          fontFamily: "inherit", fontSize: 16, fontWeight: 800, cursor: d.erreur ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: d.erreur ? "none" : `0 8px 20px ${accent}66`,
        }}>
          <Icon as={Plus} size={18} strokeWidth={2.5}/> Nouvelle note
        </button>
      </div>
    </div>
  );
}
