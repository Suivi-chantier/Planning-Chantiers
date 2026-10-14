// ─────────────────────────────────────────────────────────────────────────────
// BUREAU — « Notes des ouvriers » : ce que les ouvriers partagent au bureau,
// et les mémos chantier (digicode, clés…).
//
// Un SEUL composant sert les deux entrées :
//   • la page centrale (toutes les notes partagées) ;
//   • la fiche chantier (« Notes du terrain »), avec chantierId imposé.
//
// Le bureau ne voit JAMAIS une note privée : la base ne la renvoie pas (RLS,
// migration 20261014073919_notes_ouvriers.sql). Il ne peut pas modifier une
// note ; il la suit (nouveau → lu → traité) et y répond.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Icon } from "../ui";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import {
  StickyNote, RefreshCw, Loader, Building2, Pin, AlertTriangle, Lightbulb, CheckSquare, Square,
  Camera, MessageCircle, Send, CheckCircle2, RotateCcw, Users, ChevronDown, Lock,
} from "lucide-react";
import {
  TYPES_NOTE, STATUTS_BUREAU, FILTRES_BUREAU, typeNote, titreAffiche, libellePartage, libelleSuivi,
  progressionChecklist, filtrerNotesBureau, trierNotesBureau, compteursBureau, normaliserPrenom, LIMITES,
} from "./notesOuvriers.js";
import {
  chargerNotes, changerStatutBureau, chargerReponses, envoyerReponse, liensPhotos,
} from "./notesOuvriersStore.js";

const ICONES_TYPE = { note: StickyNote, signaler: AlertTriangle, astuce: Lightbulb };
const dateHeure = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR") + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};
const dateJour = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
};

function Badge({ couleur, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: RADIUS.pill,
      fontSize: FONT.xs.size, fontWeight: 800, color: couleur, background: `${couleur}1a`, border: `1px solid ${couleur}40`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function DetailBureau({ note, T, acc, onMaj }) {
  const [liens, setLiens] = useState({});
  const [reponses, setReponses] = useState(null);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    liensPhotos(note.photos).then(setLiens);
    chargerReponses(note.id).then(({ data, erreur: e }) => { setReponses(data || []); if (e) setErreur("Réponses non chargées."); });
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const repondre = async () => {
    const t = texte.trim();
    if (!t || envoi) return;
    setEnvoi(true); setErreur(null);
    const { data, erreur: e } = await envoyerReponse(note.id, t);
    setEnvoi(false);
    if (e) { setErreur(`Réponse non envoyée : ${e}`); return; }
    setReponses(r => [...(r || []), data]); setTexte("");
    onMaj({ ...note, nb_reponses: (note.nb_reponses || 0) + 1, derniere_activite: data.created_at });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
      {String(note.contenu || "").trim() && (
        <div style={{ fontSize: FONT.base.size, color: T.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.contenu}</div>
      )}
      {Array.isArray(note.checklist) && note.checklist.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {note.checklist.map(e => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.base.size, color: e.fait ? T.textMuted : T.text, textDecoration: e.fait ? "line-through" : "none" }}>
              <Icon as={e.fait ? CheckSquare : Square} size={16} style={{ color: e.fait ? "#22a35a" : T.textMuted, flexShrink: 0 }}/> {e.texte}
            </div>
          ))}
        </div>
      )}
      {Array.isArray(note.photos) && note.photos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {note.photos.map(c => liens[c] ? (
            <img key={c} src={liens[c]} alt="" onClick={() => window.open(liens[c], "_blank")}
              style={{ width: 110, height: 110, objectFit: "cover", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, cursor: "pointer" }}/>
          ) : (
            <div key={c} style={{ width: 110, height: 110, borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted }}>
              <Icon as={Camera} size={18}/>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, display: "flex", gap: 6, alignItems: "center" }}>
        <Icon as={note.memo_chantier ? Pin : Users} size={12}/> {libellePartage(note, { pourAuteur: false })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.textMuted }}>Réponses</div>
        {reponses === null ? (
          <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>Chargement…</div>
        ) : reponses.length === 0 ? (
          <div style={{ fontSize: FONT.sm.size, color: T.textMuted }}>Aucune réponse pour l'instant.</div>
        ) : reponses.map(r => (
          <div key={r.id} style={{
            alignSelf: r.cote === "bureau" ? "flex-end" : "flex-start", maxWidth: "80%", padding: "7px 11px", borderRadius: RADIUS.xl,
            background: r.cote === "bureau" ? `${acc.accent}22` : T.card || `${T.border}55`,
          }}>
            <div style={{ fontSize: FONT.xs.size, fontWeight: 800, color: T.textSub }}>{r.auteur}{r.cote === "bureau" ? " · bureau" : ""} · {dateHeure(r.created_at)}</div>
            <div style={{ fontSize: FONT.base.size, color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.contenu}</div>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea value={texte} onChange={e => setTexte(e.target.value)} maxLength={LIMITES.reponse} rows={2}
            placeholder={`Répondre à ${note.auteur}…`} style={{
              flex: 1, resize: "vertical", padding: "8px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: T.surface, color: T.text, fontFamily: "inherit", fontSize: FONT.base.size, outline: "none",
            }}/>
          <button onClick={repondre} disabled={!texte.trim() || envoi} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: RADIUS.md, border: "none",
            background: texte.trim() && !envoi ? acc.accent : T.border, color: acc.onAccent, fontFamily: "inherit",
            fontSize: FONT.sm.size, fontWeight: 800, cursor: texte.trim() && !envoi ? "pointer" : "not-allowed",
          }}><Icon as={envoi ? Loader : Send} size={13}/> Répondre</button>
        </div>
        {erreur && <div style={{ fontSize: FONT.sm.size, color: "#c0392b" }}>{erreur}</div>}
      </div>
    </div>
  );
}

export default function PageNotesOuvriers({ T, branch = "renovation", chantiers = [], chantierId = null, onOuvrirChantier = null }) {
  const acc = getBranchAccent(branch);
  const integre = !!chantierId;
  const [notes, setNotes] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [filtre, setFiltre] = useState(integre ? "toutes" : "a_traiter");
  const [type, setType] = useState("");
  const [chantierFiltre, setChantierFiltre] = useState("");
  const [auteur, setAuteur] = useState("");
  const [ouverte, setOuverte] = useState(null);
  const [actionEnCours, setActionEnCours] = useState(null);
  const [message, setMessage] = useState(null);

  const charger = useCallback(async () => {
    setChargement(true);
    const r = await chargerNotes({ chantierId });
    setChargement(false);
    setErreur(r.erreur);
    if (r.data) setNotes(r.data);
  }, [chantierId]);
  useEffect(() => { charger(); }, [charger]);

  const nomChantier = (id) => chantiers.find(c => c.id === id)?.nom || id || "—";
  const maj = (n) => setNotes(l => (l || []).map(x => x.id === n.id ? n : x));

  const statut = async (note, s) => {
    setActionEnCours(note.id + s);
    const { data, erreur: e } = await changerStatutBureau(note.id, s);
    setActionEnCours(null);
    if (e) { setMessage({ ok: false, texte: `Action impossible : ${e}` }); return; }
    maj(data);
  };

  const ouvrir = (note) => {
    const id = ouverte === note.id ? null : note.id;
    setOuverte(id);
    // Ouvrir une note nouvelle la marque « lue » (par ce compte, à cette heure).
    if (id && note.statut_bureau === "nouveau") statut(note, "lu");
  };

  const auteurs = useMemo(() => {
    const m = new Map();
    (notes || []).forEach(n => { const k = normaliserPrenom(n.auteur); if (k && !m.has(k)) m.set(k, n.auteur); });
    return [...m.values()].sort((a, b) => a.localeCompare(b, "fr"));
  }, [notes]);
  const chantiersAvecNotes = useMemo(() => [...new Set((notes || []).map(n => n.chantier_id).filter(Boolean))], [notes]);
  const visibles = useMemo(() => trierNotesBureau(filtrerNotesBureau(notes || [], { filtre, type, chantierId: chantierFiltre, auteur })),
    [notes, filtre, type, chantierFiltre, auteur]);
  const cpt = compteursBureau(notes || []);

  const select = {
    padding: "6px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface,
    color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600,
  };
  const boutonAction = (couleur) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: RADIUS.md,
    border: `1px solid ${couleur}55`, background: `${couleur}12`, color: couleur, fontFamily: "inherit",
    fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer",
  });

  return (
    <div style={{ padding: integre ? 0 : 20, display: "flex", flexDirection: "column", gap: 12, maxWidth: 980 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Icon as={StickyNote} size={integre ? 15 : 19} color={acc.accent}/>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: integre ? FONT.md.size : FONT.lg.size, fontWeight: 800, color: T.text }}>
            {integre ? "Notes du terrain" : "Notes des ouvriers"}
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {integre
              ? "Mémos et notes partagés au bureau pour ce chantier"
              : "Ce que les ouvriers partagent au bureau, et les mémos chantier. Les notes privées ne sont jamais visibles ici."}
          </div>
        </div>
        <button onClick={charger} disabled={chargement} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: RADIUS.md,
          border: `1px solid ${T.border}`, background: T.surface, color: T.textSub, fontFamily: "inherit",
          fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: chargement ? "default" : "pointer", opacity: chargement ? 0.5 : 1,
        }}><Icon as={chargement ? Loader : RefreshCw} size={13}/>{chargement ? "…" : "Actualiser"}</button>
      </div>

      {erreur === "absente" && (
        <div style={{ padding: 16, borderRadius: RADIUS.lg, background: T.surface, border: "1px solid #f59e0b55", fontSize: FONT.sm.size, color: T.text }}>
          <b>Fonction pas encore activée.</b> La mise à jour de la base « notes des ouvriers » n'est pas appliquée : aucune note ne peut encore être lue ni écrite.
        </div>
      )}
      {erreur === "reseau" && (
        <div style={{ padding: 16, borderRadius: RADIUS.lg, background: T.surface, border: "1px solid #c0392b44", fontSize: FONT.sm.size, color: T.text }}>
          Les notes n'ont pas pu être chargées. Vérifiez la connexion puis « Actualiser ».
        </div>
      )}

      {Array.isArray(notes) && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {FILTRES_BUREAU.map(f => {
              const actif = filtre === f.id;
              const n = f.id === "a_traiter" ? cpt.aTraiter : f.id === "traite" ? cpt.traitees : notes.length;
              return (
                <button key={f.id} onClick={() => setFiltre(f.id)} style={{
                  padding: "6px 14px", borderRadius: RADIUS.pill, border: `1px solid ${actif ? acc.accent : T.border}`,
                  background: actif ? `${acc.accent}1a` : "transparent", color: actif ? T.text : T.textSub,
                  fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: actif ? 800 : 600, cursor: "pointer",
                }}>{f.label} · {n}</button>
              );
            })}
            {cpt.signalees > 0 && <Badge couleur={TYPES_NOTE.signaler.couleur}><Icon as={AlertTriangle} size={11}/> {cpt.signalees} à signaler non traitée{cpt.signalees > 1 ? "s" : ""}</Badge>}
            {cpt.nouvelles > 0 && <Badge couleur={STATUTS_BUREAU.nouveau.couleur}>{cpt.nouvelles} nouvelle{cpt.nouvelles > 1 ? "s" : ""}</Badge>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select style={select} value={type} onChange={e => setType(e.target.value)}>
              <option value="">Tous les types</option>
              {Object.values(TYPES_NOTE).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            {!integre && (
              <select style={select} value={chantierFiltre} onChange={e => setChantierFiltre(e.target.value)}>
                <option value="">Tous les chantiers</option>
                {chantiersAvecNotes.map(id => <option key={id} value={id}>{nomChantier(id)}</option>)}
              </select>
            )}
            <select style={select} value={auteur} onChange={e => setAuteur(e.target.value)}>
              <option value="">Tous les ouvriers</option>
              {auteurs.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {message && <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: message.ok ? "#1e8e4e" : "#c0392b" }}>{message.texte}</div>}

          {visibles.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center", borderRadius: RADIUS.lg, background: T.surface, border: `1px solid ${T.border}`, fontSize: FONT.sm.size, color: T.textSub }}>
              {notes.length === 0
                ? (integre ? "Aucune note partagée ni mémo pour ce chantier." : "Aucune note partagée au bureau pour l'instant.")
                : filtre === "a_traiter" ? "Rien à traiter avec ces filtres." : "Aucune note avec ces filtres."}
            </div>
          ) : visibles.map(n => {
            const ty = typeNote(n.type);
            const st = STATUTS_BUREAU[n.statut_bureau];
            const prog = progressionChecklist(n.checklist);
            const estOuverte = ouverte === n.id;
            return (
              <div key={n.id} style={{
                background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${ty.couleur}`,
                borderRadius: RADIUS.lg, padding: "11px 14px", display: "flex", flexDirection: "column", gap: 7,
              }}>
                <div onClick={() => ouvrir(n)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      {n.statut_bureau === "nouveau" && <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUTS_BUREAU.nouveau.couleur }}/>}
                      <span style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text }}>{titreAffiche(n)}</span>
                      {n.type !== "note" && <Badge couleur={ty.couleur}><Icon as={ICONES_TYPE[n.type]} size={11}/> {ty.label}</Badge>}
                      {n.memo_chantier && <Badge couleur="#8a6d00"><Icon as={Pin} size={11}/> Mémo chantier</Badge>}
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                      <span style={{ fontWeight: 700, color: T.textSub }}>{n.auteur}</span>
                      {n.chantier_id && !integre && (
                        onOuvrirChantier
                          ? <button onClick={(e) => { e.stopPropagation(); onOuvrirChantier(n.chantier_id); }} style={{ border: "none", background: "none", padding: 0, color: acc.accentDark || T.textSub, fontFamily: "inherit", fontSize: "inherit", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Building2} size={11}/> {nomChantier(n.chantier_id)}</button>
                          : <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Building2} size={11}/> {nomChantier(n.chantier_id)}</span>
                      )}
                      {prog.total > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={CheckSquare} size={11}/> {prog.faits}/{prog.total}</span>}
                      {n.photos?.length > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={Camera} size={11}/> {n.photos.length}</span>}
                      {n.nb_reponses > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Icon as={MessageCircle} size={11}/> {n.nb_reponses}</span>}
                      <span>{dateHeure(n.derniere_activite)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {st && <Badge couleur={st.couleur}>{n.statut_bureau === "nouveau" ? st.label : libelleSuivi(n, dateJour)}</Badge>}
                    <Icon as={ChevronDown} size={16} style={{ color: T.textMuted, transform: estOuverte ? "rotate(180deg)" : "none", transition: "transform .2s" }}/>
                  </div>
                </div>
                {estOuverte && (
                  <>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {n.statut_bureau !== "traite" ? (
                        <button onClick={() => statut(n, "traite")} disabled={!!actionEnCours} style={boutonAction("#22a35a")}>
                          <Icon as={actionEnCours === n.id + "traite" ? Loader : CheckCircle2} size={13}/> Marquer traitée
                        </button>
                      ) : (
                        <button onClick={() => statut(n, "lu")} disabled={!!actionEnCours} style={boutonAction("#5b8af5")}>
                          <Icon as={actionEnCours === n.id + "lu" ? Loader : RotateCcw} size={13}/> Rouvrir
                        </button>
                      )}
                    </div>
                    <DetailBureau note={n} T={T} acc={acc} onMaj={maj}/>
                  </>
                )}
              </div>
            );
          })}
          {!integre && (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon as={Lock} size={12}/> Une note privée d'un ouvrier n'apparaît jamais ici, même pour un administrateur.
            </div>
          )}
        </>
      )}
    </div>
  );
}
