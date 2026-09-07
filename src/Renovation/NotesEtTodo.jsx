import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../supabase";
import { getBranchAccent, FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { useDirtyGuard } from "../hooks";
import { MobileHero, MobileStat, MobileCard, MobileTabs, MobileEmptyState, CARD_SHADOW } from "../mobileUI";
import {
  getAssignes, estAssigne, ECHEANCE_TYPES, echeanceLabel, computeEcheanceDate,
  envoyerEmailAssignation, envoyerEmailsTerminee, envoyerEmailsMaj,
} from "../todoUtils";
import {
  ClipboardList, ListTodo, User, Trash2, Pencil, X, Plus, Check,
  Calendar, AlarmClock, FileText, CircleCheck, ListChecks,
  ChevronDown, ChevronRight, History, Send, RefreshCw,
} from "lucide-react";

// ─── PRIORITÉS ────────────────────────────────────────────────────────────────
const PRIORITES = [
  { id: "haute",   label: "Haute",   color: "#e05c5c", bg: "rgba(224,92,92,0.12)"  },
  { id: "normale", label: "Normale", color: "#5B8AF5", bg: "rgba(91,138,245,0.12)" },
  { id: "basse",   label: "Basse",   color: "#50c878", bg: "rgba(80,200,120,0.12)" },
];

function getPriorite(id) {
  return PRIORITES.find(p => p.id === id) || PRIORITES[1];
}

// ─── SAUVEGARDE SUPABASE (clé/valeur dans planning_config) ───────────────────
const KEY_TODOS = "bloc_todos";

// ─── SÉLECTEUR D'ASSIGNÉS (multi) ─────────────────────────────────────────────
// Chips + select « ajouter une personne » : le select ajoute à la liste puis
// revient sur le placeholder, chaque chip a sa croix pour retirer.
function SelecteurAssignes({ assignes, onChange, utilisateurs, T, acc }) {
  const restants = utilisateurs.filter(u => !assignes.some(a => a.email === u.email));
  const ajouter = (email) => {
    const u = utilisateurs.find(x => x.email === email);
    if (u) onChange([...assignes, { email: u.email, nom: u.nom }]);
  };
  const retirer = (email) => onChange(assignes.filter(a => a.email !== email));

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", flex: 1, minWidth: 180 }}>
      {assignes.map(a => (
        <span key={a.email} title={a.email} style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 6px 3px 9px", borderRadius: RADIUS.pill,
          background: acc.bg10, color: acc.accent,
          fontSize: FONT.xs.size + 1, fontWeight: 700,
        }}>
          <Icon as={User} size={11}/>
          {a.nom}
          <button onClick={() => retirer(a.email)} title="Retirer" style={{
            background: "transparent", border: "none", color: "inherit",
            cursor: "pointer", padding: 1, display: "inline-flex", alignItems: "center",
            opacity: 0.7,
          }}>
            <Icon as={X} size={11}/>
          </button>
        </span>
      ))}
      {restants.length > 0 && (
        <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
          <Icon as={User} size={13}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: assignes.length > 0 ? acc.accent : T.textMuted, pointerEvents: "none" }}/>
          <select value="" onChange={e => ajouter(e.target.value)} style={{
            width: "100%", padding: "7px 10px 7px 28px", borderRadius: 10,
            border: `1px solid ${assignes.length > 0 ? acc.border : T.border}`,
            background: T.card, color: T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", fontWeight: 500,
          }}>
            <option value="">
              {assignes.length > 0 ? "+ Ajouter une personne" : "Personnes assignées (optionnel)"}
            </option>
            {restants.map(u => (
              <option key={u.id} value={u.email}>{u.nom} ({u.role})</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// ─── SÉLECTEUR D'ÉCHÉANCE ─────────────────────────────────────────────────────
// Échéances rapides (aujourd'hui, fin de semaine, fin du mois…) ou date
// précise. La date réelle est calculée à la sauvegarde (todoUtils).
function SelecteurEcheance({ type, date, onType, onDate, T }) {
  const actif = !!type;
  return (
    <>
      <select value={type} onChange={e => onType(e.target.value)} title="Échéance (optionnel)" style={{
        padding: "7px 10px", borderRadius: 10,
        border: `1px solid ${actif ? "#f5a623" : T.border}`, background: T.card,
        color: actif ? "#f5a623" : T.textMuted,
        fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
        fontWeight: actif ? 700 : 500, cursor: "pointer",
      }}>
        <option value="">Pas d'échéance</option>
        {ECHEANCE_TYPES.map(e => (
          <option key={e.id} value={e.id}>{e.label}</option>
        ))}
      </select>
      {type === "date" && (
        <input type="date" value={date} onChange={e => onDate(e.target.value)}
          title="Date limite" style={{
            padding: "6px 10px", borderRadius: 10,
            border: `1px solid ${date ? "#f5a623" : T.border}`, background: T.card,
            color: date ? "#f5a623" : T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
            fontWeight: date ? 700 : 500,
          }}/>
      )}
    </>
  );
}

// ─── COMPOSANT TODO ITEM ──────────────────────────────────────────────────────
function TodoItem({ todo, onToggle, onDelete, onEdit, onToggleSousTache, onAddMaj, T, utilisateurs, chantiers = [], acc }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(todo.texte);
  const [draftPrio, setDraftPrio] = useState(todo.priorite || "normale");
  const [draftAssignes, setDraftAssignes] = useState(getAssignes(todo));
  const [draftEchType, setDraftEchType] = useState("");
  const [draftEchDate, setDraftEchDate] = useState("");
  const [draftNote, setDraftNote] = useState(todo.note || "");
  const [draftChantier, setDraftChantier] = useState(todo.chantier_id || "");
  const [draftSousTaches, setDraftSousTaches] = useState(todo.sous_taches || []);
  const [sousTachesExpanded, setSousTachesExpanded] = useState(true);
  const [noteExpanded, setNoteExpanded] = useState(true);
  const [majExpanded, setMajExpanded] = useState(true);
  const [majSaisie, setMajSaisie] = useState(false);
  const [majDraft, setMajDraft] = useState("");
  const inputRef = useRef();

  // Bloque l'auto-reload pendant l'édition d'une tâche ou la saisie d'une MAJ.
  useDirtyGuard("todo-edit-" + todo.id, editing || !!majDraft.trim());

  const majs = Array.isArray(todo.maj) ? todo.maj : [];
  const envoyerMaj = () => {
    const txt = majDraft.trim();
    if (!txt) return;
    onAddMaj(todo.id, txt);
    setMajDraft("");
    setMajSaisie(false);
    setMajExpanded(true);
  };

  const chantier = todo.chantier_id ? chantiers.find(c => c.id === todo.chantier_id) : null;

  const startEdit = () => {
    setDraft(todo.texte);
    setDraftPrio(todo.priorite || "normale");
    setDraftAssignes(getAssignes(todo));
    // Échéance existante : type mémorisé, sinon une date seule = date précise.
    if (todo.echeance_type && todo.echeance_type !== "date") {
      setDraftEchType(todo.echeance_type);
      setDraftEchDate("");
    } else if (todo.date_limite) {
      setDraftEchType("date");
      setDraftEchDate(todo.date_limite);
    } else {
      setDraftEchType("");
      setDraftEchDate("");
    }
    setDraftNote(todo.note || "");
    setDraftChantier(todo.chantier_id || "");
    setDraftSousTaches(todo.sous_taches || []);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    if (!draft.trim()) { setEditing(false); return; }
    const ch = chantiers.find(c => c.id === draftChantier);

    // Échéance : si le type rapide n'a pas changé, on garde la date d'origine
    // (pas de recalcul silencieux des semaines plus tard).
    let date_limite = null, echeance_type = null;
    if (draftEchType === "date") {
      date_limite = draftEchDate || null;
      echeance_type = date_limite ? "date" : null;
    } else if (draftEchType) {
      if (draftEchType === todo.echeance_type && todo.date_limite) {
        date_limite = todo.date_limite;
      } else {
        date_limite = computeEcheanceDate(draftEchType);
      }
      echeance_type = draftEchType;
    }
    const dateChanged = (date_limite || null) !== (todo.date_limite || null);

    const cleanSousTaches = draftSousTaches.filter(st => st.texte?.trim()).map(st => ({
      id: st.id,
      texte: st.texte.trim(),
      fait: !!st.fait,
    }));
    const premier = draftAssignes[0] || null;
    onEdit(todo.id, {
      texte: draft.trim(),
      priorite: draftPrio,
      assignes: draftAssignes.length > 0 ? draftAssignes : null,
      // Champs historiques (1er assigné) : compat BulleTodo / clients PWA pas rechargés.
      assigne_email: premier ? premier.email : null,
      assigne_nom:   premier ? premier.nom   : null,
      date_limite,
      echeance_type,
      note: draftNote.trim() || null,
      chantier_id:   ch ? ch.id : null,
      chantier_nom:  ch ? ch.nom : null,
      chantier_couleur: ch ? ch.couleur : null,
      sous_taches:   cleanSousTaches.length > 0 ? cleanSousTaches : null,
      // Reset le flag de relance si la date a été modifiée
      // → permet de re-notifier si la nouvelle date est aussi dépassée
      ...(dateChanged ? { relance_envoyee: false, relance_envoyee_date: null } : {}),
    });
    setEditing(false);
  };

  const addSousTache = () => {
    setDraftSousTaches(prev => [...prev, { id: Math.random().toString(36).slice(2), texte: "", fait: false }]);
  };
  const updateSousTacheText = (id, texte) => {
    setDraftSousTaches(prev => prev.map(st => st.id === id ? { ...st, texte } : st));
  };
  const removeSousTache = (id) => {
    setDraftSousTaches(prev => prev.filter(st => st.id !== id));
  };

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const prio = getPriorite(todo.priorite || "normale");
  const assignes = getAssignes(todo);

  if (editing) {
    return (
      <div style={{
        background: T.surface, border: `1px solid ${acc.accent}`,
        borderLeft: `4px solid ${acc.accent}`,
        borderRadius: 14, padding: "14px 16px", marginBottom: 10,
        boxShadow: CARD_SHADOW,
      }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          style={{
            width: "100%", background: "transparent", border: "none",
            color: T.text, fontFamily: "inherit", fontSize: FONT.base.size, fontWeight: 600, outline: "none",
            marginBottom: 10,
          }}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          {PRIORITES.map(p => (
            <button key={p.id} onClick={() => setDraftPrio(p.id)} style={{
              padding: "4px 11px", borderRadius: RADIUS.pill, border: `1.5px solid`,
              borderColor: draftPrio === p.id ? p.color : T.border,
              background: draftPrio === p.id ? p.bg : "transparent",
              color: draftPrio === p.id ? p.color : T.textSub,
              fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer",
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <SelecteurAssignes
            assignes={draftAssignes} onChange={setDraftAssignes}
            utilisateurs={utilisateurs} T={T} acc={acc}
          />
          <SelecteurEcheance
            type={draftEchType} date={draftEchDate}
            onType={setDraftEchType} onDate={setDraftEchDate} T={T}
          />
        </div>

        {/* Note / détails */}
        <div style={{ marginBottom: 8 }}>
          <div style={{
            fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8,
            textTransform: "uppercase", color: T.textMuted, marginBottom: 6,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <Icon as={FileText} size={12}/>
            Note / détails
          </div>
          <textarea
            value={draftNote}
            onChange={e => setDraftNote(e.target.value)}
            placeholder="Détails, contexte, contacts, références…"
            rows={3}
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 10,
              border: `1px solid ${T.border}`, background: T.card,
              color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size,
              lineHeight: 1.6, resize: "vertical", outline: "none",
            }}
          />
        </div>

        {/* Sélecteur de chantier */}
        {chantiers.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
              <span style={{
                position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                width: 10, height: 10, borderRadius: 3,
                background: draftChantier ? (chantiers.find(c => c.id === draftChantier)?.couleur || T.textMuted) : T.textMuted,
                opacity: draftChantier ? 1 : 0.4,
                pointerEvents:"none",
              }}/>
              <select value={draftChantier} onChange={e => setDraftChantier(e.target.value)} style={{
                width:"100%", padding: "7px 10px 7px 28px", borderRadius: 10,
                border: `1px solid ${draftChantier ? acc.border : T.border}`,
                background: T.card, color: draftChantier ? T.text : T.textMuted,
                fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                fontWeight: draftChantier ? 600 : 500,
              }}>
                <option value="">Aucun chantier</option>
                {chantiers.map(c => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Sous-tâches */}
        <div style={{ marginBottom: 10 }}>
          {draftSousTaches.length > 0 && (
            <div style={{
              fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8,
              textTransform: "uppercase", color: T.textMuted, marginBottom: 6,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Icon as={ListChecks} size={12}/>
              Sous-tâches
            </div>
          )}
          {draftSousTaches.map(st => (
            <div key={st.id} style={{ display:"flex", gap:6, alignItems:"center", marginBottom:5 }}>
              <input
                value={st.texte}
                onChange={e => updateSousTacheText(st.id, e.target.value)}
                placeholder="Sous-tâche…"
                style={{
                  flex: 1, padding: "5px 10px", borderRadius: RADIUS.sm + 2,
                  border: `1px solid ${T.border}`, background: T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size,
                  outline: "none",
                }}
              />
              <button onClick={() => removeSousTache(st.id)} title="Retirer" style={{
                padding: 5, borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                background: "transparent", color: "#e15a5a",
                cursor: "pointer", display:"inline-flex", alignItems:"center",
              }}>
                <Icon as={X} size={12}/>
              </button>
            </div>
          ))}
          <button onClick={addSousTache} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 10px", borderRadius: RADIUS.sm + 2,
            border: `1px dashed ${T.border}`, background: "transparent",
            color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
            marginTop: 2,
          }}>
            <Icon as={Plus} size={11}/>
            Ajouter une sous-tâche
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button onClick={cancelEdit} style={{
            padding: "7px 14px", borderRadius: 10, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={saveEdit} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            padding: "7px 14px", borderRadius: 10, border: "none",
            background: acc.accent, color: acc.onAccent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
            boxShadow: `0 5px 14px ${acc.accent}55`,
          }}>
            <Icon as={Check} size={14}/>
            Enregistrer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="todo-row" style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "13px 16px", borderRadius: 14, marginBottom: 10,
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderLeft: `4px solid ${todo.fait ? "#22c55e" : prio.color}`,
      boxShadow: todo.fait ? "none" : CARD_SHADOW,
      transition: "all .15s", opacity: todo.fait ? 0.6 : 1,
    }}>
      {/* Checkbox */}
      <button onClick={() => onToggle(todo.id)} title={todo.fait ? "Marquer comme à faire" : "Marquer comme terminé"}
        style={{
          width: 22, height: 22, borderRadius: 7, flexShrink: 0,
          border: `2px solid ${todo.fait ? "#22c55e" : prio.color}`,
          background: todo.fait ? "#22c55e" : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          marginTop: 2, padding: 0,
        }}>
        {todo.fait && <Icon as={Check} size={13} color="#ffffff" strokeWidth={3}/>}
      </button>

      {/* Texte + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: FONT.base.size, fontWeight: 600, color: T.text,
          textDecoration: todo.fait ? "line-through" : "none",
          wordBreak: "break-word", lineHeight: 1.4,
        }}>
          {todo.texte}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, alignItems: "center" }}>
          {!todo.fait && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "2px 9px", borderRadius: RADIUS.pill,
              background: prio.bg, color: prio.color,
              fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .3,
            }}>{prio.label}</span>
          )}
          {assignes.map(a => (
            <span key={a.email} title={a.email} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 9px", borderRadius: RADIUS.pill,
              background: acc.bg10, color: acc.accent,
              fontSize: FONT.xs.size, fontWeight: 700,
            }}>
              <Icon as={User} size={10}/>
              {a.nom}
            </span>
          ))}
          {chantier && (
            <span title="Chantier" style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 9px", borderRadius: RADIUS.pill,
              background: chantier.couleur + "22",
              border: `1px solid ${chantier.couleur}55`,
              color: T.text, fontSize: FONT.xs.size, fontWeight: 700,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: chantier.couleur }}/>
              {chantier.nom}
            </span>
          )}
          {todo.date_limite && (() => {
            const todayIso = new Date().toISOString().slice(0, 10);
            const enRetard = !todo.fait && todo.date_limite < todayIso;
            const aujourdhui = todo.date_limite === todayIso;
            const couleur = enRetard ? "#e15a5a" : aujourdhui ? "#f5a623" : T.textSub;
            const bg = enRetard ? "rgba(225,90,90,0.12)" : aujourdhui ? "rgba(245,166,35,0.12)" : T.card;
            const dateAffichee = new Date(todo.date_limite + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
            const labelType = todo.echeance_type && todo.echeance_type !== "date" ? echeanceLabel(todo.echeance_type) : "";
            return (
              <span title={enRetard ? "Tâche en retard" : aujourdhui ? "Date limite aujourd'hui" : "Date limite"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 9px", borderRadius: RADIUS.pill,
                  background: bg, color: couleur,
                  fontSize: FONT.xs.size, fontWeight: 700,
                }}>
                <Icon as={enRetard ? AlarmClock : Calendar} size={10}/>
                {labelType ? `${labelType} · ${dateAffichee}` : dateAffichee}
              </span>
            );
          })()}
          {todo.fait && todo.fait_par_nom && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 9px", borderRadius: RADIUS.pill,
              background: "rgba(34,197,94,0.10)", color: "#22c55e",
              fontSize: FONT.xs.size, fontWeight: 700,
            }}>
              <Icon as={Check} size={10}/>
              par {todo.fait_par_nom}
            </span>
          )}
          {todo.created_at && (
            <span style={{ fontSize: FONT.xs.size, color: T.textMuted, marginLeft:"auto" }}>
              ajouté {new Date(todo.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>

        {/* Note / détails de la tâche */}
        {todo.note && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setNoteExpanded(v => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "transparent", border: "none", padding: "2px 0",
              color: T.textSub, fontSize: FONT.xs.size + 1,
              fontWeight: 600, cursor: "pointer",
            }}>
              <Icon as={noteExpanded ? ChevronDown : ChevronRight} size={12}/>
              <Icon as={FileText} size={12}/>
              Note
            </button>
            {noteExpanded && (
              <div style={{
                marginTop: 5, padding: "9px 12px", borderRadius: 10,
                background: T.card, border: `1px solid ${T.border}`,
                color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.6,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {todo.note}
              </div>
            )}
          </div>
        )}

        {/* Sous-tâches : affichage interactif si la tâche en a */}
        {todo.sous_taches?.length > 0 && (() => {
          const total = todo.sous_taches.length;
          const faits = todo.sous_taches.filter(st => st.fait).length;
          return (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setSousTachesExpanded(v => !v)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "transparent", border: "none", padding: "2px 0",
                color: T.textSub, fontSize: FONT.xs.size + 1,
                fontWeight: 600, cursor: "pointer",
              }}>
                <Icon as={sousTachesExpanded ? ChevronDown : ChevronRight} size={12}/>
                <Icon as={ListChecks} size={12}/>
                {faits}/{total} sous-tâche{total > 1 ? "s" : ""}
              </button>
              {sousTachesExpanded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 5, paddingLeft: 18 }}>
                  {todo.sous_taches.map(st => (
                    <label key={st.id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      cursor: "pointer", fontSize: FONT.sm.size,
                      color: st.fait ? T.textMuted : T.text,
                      textDecoration: st.fait ? "line-through" : "none",
                    }}>
                      <button onClick={() => onToggleSousTache(todo.id, st.id)} style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0, padding: 0,
                        border: `1.5px solid ${st.fait ? "#22c55e" : T.border}`,
                        background: st.fait ? "#22c55e" : "transparent",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {st.fait && <Icon as={Check} size={10} color="#fff" strokeWidth={3}/>}
                      </button>
                      <span style={{ wordBreak: "break-word", lineHeight: 1.4 }}>{st.texte}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Mises à jour : journal horodaté (auteur + texte), envoyé par email
            aux personnes concernées à chaque ajout. */}
        {(majs.length > 0 || !todo.fait) && (
          <div style={{ marginTop: 8 }}>
            {majs.length > 0 && (
              <button onClick={() => setMajExpanded(v => !v)} style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "transparent", border: "none", padding: "2px 0",
                color: T.textSub, fontSize: FONT.xs.size + 1,
                fontWeight: 600, cursor: "pointer",
              }}>
                <Icon as={majExpanded ? ChevronDown : ChevronRight} size={12}/>
                <Icon as={History} size={12}/>
                {majs.length} mise{majs.length > 1 ? "s" : ""} à jour
              </button>
            )}
            {majExpanded && majs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5 }}>
                {majs.map(m => (
                  <div key={m.id} style={{
                    padding: "7px 11px", borderRadius: 10,
                    background: "rgba(91,138,245,0.06)", border: `1px solid rgba(91,138,245,0.20)`,
                    fontSize: FONT.sm.size, lineHeight: 1.5, color: T.text,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    <span style={{ fontWeight: 700, color: "#5B8AF5" }}>
                      {m.date ? new Date(m.date).toLocaleDateString("fr-FR") : ""} {m.auteur_nom || ""}
                    </span>
                    <span style={{ color: T.textSub }}> : </span>
                    {m.texte}
                  </div>
                ))}
              </div>
            )}
            {!todo.fait && (
              majSaisie ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input
                    autoFocus
                    value={majDraft}
                    onChange={e => setMajDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") envoyerMaj();
                      if (e.key === "Escape") { setMajDraft(""); setMajSaisie(false); }
                    }}
                    placeholder="Mise à jour… (Entrée pour envoyer aux personnes concernées)"
                    style={{
                      flex: 1, padding: "7px 11px", borderRadius: 10,
                      border: `1px solid #5B8AF5`, background: T.card,
                      color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size,
                      outline: "none",
                    }}
                  />
                  <button onClick={envoyerMaj} disabled={!majDraft.trim()} title="Envoyer la mise à jour" style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "7px 12px", borderRadius: 10, border: "none",
                    background: majDraft.trim() ? "#5B8AF5" : T.card,
                    color: majDraft.trim() ? "#fff" : T.textMuted,
                    fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800,
                    cursor: majDraft.trim() ? "pointer" : "not-allowed",
                    boxShadow: majDraft.trim() ? "0 4px 12px rgba(91,138,245,0.4)" : "none",
                  }}>
                    <Icon as={Send} size={12}/>
                    Envoyer
                  </button>
                  <button onClick={() => { setMajDraft(""); setMajSaisie(false); }} title="Annuler" style={{
                    padding: 6, borderRadius: 10, border: `1px solid ${T.border}`,
                    background: "transparent", color: T.textSub, cursor: "pointer",
                    display: "inline-flex", alignItems: "center",
                  }}>
                    <Icon as={X} size={12}/>
                  </button>
                </div>
              ) : (
                <button onClick={() => setMajSaisie(true)} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  marginTop: majs.length > 0 ? 6 : 0,
                  padding: "4px 10px", borderRadius: 10,
                  border: `1px dashed ${T.border}`, background: "transparent",
                  color: T.textMuted, fontFamily: "inherit",
                  fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
                }}>
                  <Icon as={History} size={11}/>
                  Ajouter une mise à jour
                </button>
              )
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        {!todo.fait && (
          <button onClick={startEdit} title="Modifier" style={{
            background: "transparent", border: "none", color: T.textMuted,
            cursor: "pointer", padding: 5, borderRadius: RADIUS.sm,
            opacity: 0.55, transition: "opacity .15s, background .15s",
            display:"inline-flex", alignItems:"center",
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(16,24,40,0.05)"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "0.55"; e.currentTarget.style.background = "transparent"; }}>
            <Icon as={Pencil} size={13}/>
          </button>
        )}
        <button onClick={() => onDelete(todo.id)} title="Supprimer" style={{
          background: "transparent", border: "none", color: "#e15a5a",
          cursor: "pointer", padding: 5, borderRadius: RADIUS.sm,
          opacity: 0.45, transition: "opacity .15s, background .15s",
          display:"inline-flex", alignItems:"center",
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(225,90,90,0.08)"; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = "0.45"; e.currentTarget.style.background = "transparent"; }}>
          <Icon as={X} size={14}/>
        </button>
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
function PageNotesEtTodo({ T, profil, chantiers = [], branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [todos, setTodos]         = useState([]);
  const [newTodo, setNewTodo]     = useState("");
  const [newPrio, setNewPrio]     = useState("normale");
  const [newAssignes, setNewAssignes] = useState([]); // [{email, nom}]
  const [newEchType, setNewEchType]   = useState(""); // "" | id échéance | "date"
  const [newEchDate, setNewEchDate]   = useState(""); // ISO YYYY-MM-DD si "date"
  const [newNote, setNewNote]         = useState("");
  const [newNoteVisible, setNewNoteVisible] = useState(false);
  const [newChantier, setNewChantier] = useState(""); // chantier_id
  const [filtre, setFiltre]       = useState("actif"); // actif | fait | mes
  const [filtreChantier, setFiltreChantier] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  // Bloque l'auto-reload tant qu'une nouvelle tâche est en cours de saisie.
  useDirtyGuard("todo-new", !!newTodo.trim() || !!newNote.trim());
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [notifStatus, setNotifStatus]   = useState(""); // message éphémère
  const inputRef = useRef();

  const monEmail = profil?.email || null;
  const monNom   = profil?.nom   || profil?.email || "Quelqu'un";

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, users] = await Promise.all([
        supabase.from("planning_config").select("value").eq("key", KEY_TODOS).maybeSingle(),
        supabase.from("utilisateurs").select("id, email, nom, role, actif").eq("actif", true).order("nom"),
      ]);
      if (cfg.data) setTodos(Array.isArray(cfg.data.value) ? cfg.data.value : []);
      if (users.data) setUtilisateurs(users.data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Message éphémère après une notif
  const flashNotif = (msg) => { setNotifStatus(msg); setTimeout(() => setNotifStatus(""), 4000); };

  // ── Sauvegarde todos ────────────────────────────────────────────────────────
  const saveTodos = async (newList) => {
    setSaving(true);
    await supabase.from("planning_config")
      .upsert({ key: KEY_TODOS, value: newList, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSaving(false);
  };

  // Envoie l'email d'assignation à chaque nouvel assigné et résume le résultat.
  const notifierAssignes = async (destinataires, todo) => {
    if (destinataires.length === 0) return;
    const noms = destinataires.map(a => a.nom).join(", ");
    flashNotif(`📧 Envoi de l'email à ${noms}…`);
    let ok = 0, ko = 0;
    for (const a of destinataires) {
      const r = await envoyerEmailAssignation({
        to: a.email, nom: a.nom, texte: todo.texte, priorite: todo.priorite, assigneur: monNom,
        note: todo.note,
      });
      if (r.ok) ok += 1; else ko += 1;
    }
    flashNotif(ko === 0 ? `✓ Email envoyé à ${noms}` : `⚠️ ${ko} email(s) non envoyé(s) sur ${ok + ko}`);
  };

  // ── Ajouter un todo ─────────────────────────────────────────────────────────
  const addTodo = async () => {
    if (!newTodo.trim()) return;
    const ch = chantiers.find(c => c.id === newChantier);
    const date_limite = newEchType === "date" ? (newEchDate || null) : computeEcheanceDate(newEchType);
    const echeance_type = date_limite ? (newEchType || null) : null;
    const premier = newAssignes[0] || null;
    const todo = {
      id: Math.random().toString(36).slice(2),
      texte: newTodo.trim(),
      priorite: newPrio,
      fait: false,
      created_at: new Date().toISOString(),
      created_by_email: monEmail,
      created_by_nom:   monNom,
      assignes: newAssignes.length > 0 ? newAssignes : null,
      // Champs historiques (1er assigné) : compat BulleTodo / clients PWA pas rechargés.
      assigne_email: premier ? premier.email : null,
      assigne_nom:   premier ? premier.nom   : null,
      date_limite,
      echeance_type,
      note: newNote.trim() || null,
      chantier_id:   ch ? ch.id : null,
      chantier_nom:  ch ? ch.nom : null,
      chantier_couleur: ch ? ch.couleur : null,
    };
    const updated = [todo, ...todos];
    setTodos(updated);
    saveTodos(updated);
    setNewTodo("");
    setNewAssignes([]);
    setNewEchType("");
    setNewEchDate("");
    setNewNote("");
    setNewNoteVisible(false);
    setNewChantier("");
    inputRef.current?.focus();

    await notifierAssignes(newAssignes, todo);
  };

  // Cocher / décocher : une tâche cochée par un assigné est terminée pour
  // tous → on trace qui l'a close et on prévient les autres assignés par mail.
  const toggleTodo = async (id) => {
    const cible = todos.find(t => t.id === id);
    if (!cible) return;
    const devientFait = !cible.fait;
    const patch = devientFait
      ? { fait: true, fait_le: new Date().toISOString(), fait_par_email: monEmail, fait_par_nom: monNom }
      : { fait: false, fait_le: null, fait_par_email: null, fait_par_nom: null };
    const updated = todos.map(t => t.id === id ? { ...t, ...patch } : t);
    setTodos(updated);
    saveTodos(updated);

    if (devientFait) {
      const r = await envoyerEmailsTerminee({ todo: cible, acteurEmail: monEmail, acteurNom: monNom });
      if (r.envoyes > 0 || r.echecs > 0) {
        flashNotif(r.ok
          ? `✓ ${r.envoyes} assigné${r.envoyes > 1 ? "s" : ""} prévenu${r.envoyes > 1 ? "s" : ""} par email`
          : `⚠️ ${r.echecs} email(s) de clôture non envoyé(s)`);
      }
    }
  };

  const deleteTodo = (id) => {
    const updated = todos.filter(t => t.id !== id);
    setTodos(updated);
    saveTodos(updated);
  };

  const editTodo = async (id, patch) => {
    const ancien = todos.find(t => t.id === id);
    const updated = todos.map(t => t.id === id ? { ...t, ...patch } : t);
    setTodos(updated);
    saveTodos(updated);
    // Notification aux personnes nouvellement assignées
    const avant = new Set(getAssignes(ancien || {}).map(a => String(a.email).toLowerCase()));
    const nouveaux = (patch.assignes || []).filter(a => !avant.has(String(a.email).toLowerCase()));
    if (nouveaux.length > 0) {
      await notifierAssignes(nouveaux, { ...ancien, ...patch });
    }
  };

  // Ajoute une mise à jour horodatée au journal de la tâche et prévient par
  // email les personnes concernées (assignés + créateur, sauf l'auteur).
  const addMaj = async (id, texte) => {
    const cible = todos.find(t => t.id === id);
    if (!cible || !texte.trim()) return;
    const entree = {
      id: Math.random().toString(36).slice(2),
      date: new Date().toISOString(),
      auteur_email: monEmail,
      auteur_nom: monNom,
      texte: texte.trim(),
    };
    const updated = todos.map(t => t.id === id ? { ...t, maj: [...(Array.isArray(t.maj) ? t.maj : []), entree] } : t);
    setTodos(updated);
    saveTodos(updated);

    const r = await envoyerEmailsMaj({ todo: cible, texteMaj: entree.texte, acteurEmail: monEmail, acteurNom: monNom });
    if (r.envoyes > 0 || r.echecs > 0) {
      flashNotif(r.ok
        ? `✓ Mise à jour envoyée à ${r.envoyes} personne${r.envoyes > 1 ? "s" : ""}`
        : `⚠️ ${r.echecs} email(s) de mise à jour non envoyé(s)`);
    } else {
      flashNotif("✓ Mise à jour enregistrée (personne d'autre à prévenir)");
    }
  };

  const toggleSousTache = (todoId, sousTacheId) => {
    const updated = todos.map(t => {
      if (t.id !== todoId || !t.sous_taches) return t;
      return {
        ...t,
        sous_taches: t.sous_taches.map(st => st.id === sousTacheId ? { ...st, fait: !st.fait } : st),
      };
    });
    setTodos(updated);
    saveTodos(updated);
  };

  const clearFaits = () => {
    const updated = todos.filter(t => !t.fait);
    setTodos(updated);
    saveTodos(updated);
  };

  // ── Filtrage + tri ──────────────────────────────────────────────────────────
  const PRIO_ORDER = { haute: 0, normale: 1, basse: 2 };
  const todosFiltres = todos
    .filter(t => {
      // Filtre statut
      if (filtre === "actif" && t.fait) return false;
      if (filtre === "fait"  && !t.fait) return false;
      if (filtre === "mes"   && (t.fait || !estAssigne(t, monEmail))) return false;
      // Filtre chantier
      if (filtreChantier && t.chantier_id !== filtreChantier) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.fait !== b.fait) return a.fait ? 1 : -1;
      return (PRIO_ORDER[a.priorite] ?? 1) - (PRIO_ORDER[b.priorite] ?? 1);
    });

  const todayIso = new Date().toISOString().slice(0, 10);
  const nbActifs = todos.filter(t => !t.fait).length;
  const nbFaits  = todos.filter(t => t.fait).length;
  const nbMes    = monEmail ? todos.filter(t => !t.fait && estAssigne(t, monEmail)).length : 0;
  const nbRetard = todos.filter(t => !t.fait && t.date_limite && t.date_limite < todayIso).length;

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.textMuted, fontSize: 14 }}>Chargement…</div>
      </div>
    );
  }

  // Indicateur de synchro dans le hero (comme la météo du Tableau de bord)
  const syncRight = (
    <div style={{
      display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
      background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 13, padding: "8px 12px",
    }}>
      <Icon as={saving ? RefreshCw : CircleCheck} size={15} style={{ color: saving ? "#fbbf24" : "#4ade80" }}/>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>
        {saving ? "Sauvegarde…" : "Synchronisé"}
      </span>
    </div>
  );

  return (
    <div className="page-padding ntd-page" style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      <style>{`
        @media (max-width: 767px) {
          .ntd-page{padding:14px 12px!important}
          .ntd-stats{grid-template-columns:repeat(2,1fr)!important}
        }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Hero — kit partagé (mobileUI), même langage que le Tableau de bord */}
        <MobileHero
          accent={acc.accent}
          eyebrow={new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          title="Notes & To-do"
          right={syncRight}
          chips={[
            { icon: ListTodo, value: nbActifs, label: "à faire", color: acc.accent },
            ...(monEmail ? [{ icon: User, value: nbMes, label: "pour moi", color: "#8ab0ff" }] : []),
            ...(nbRetard > 0 ? [{ icon: AlarmClock, value: nbRetard, label: "en retard", color: "#f87171" }] : []),
          ]}
        />

        {/* KPI */}
        <div className="ntd-stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <MobileStat T={T} icon={ListTodo} label="À faire" value={nbActifs} color={acc.accent}
            sub={nbActifs > 0 ? "tâches en cours" : "tout est fait !"}/>
          <MobileStat T={T} icon={User} label="Mes tâches" value={monEmail ? nbMes : "—"} color="#5b8af5"
            sub="assignées à vous"/>
          <MobileStat T={T} icon={AlarmClock} label="En retard" value={nbRetard}
            color={nbRetard > 0 ? "#ef4444" : "#94a3b8"}
            sub={nbRetard > 0 ? "échéance dépassée" : "rien en retard"}/>
          <MobileStat T={T} icon={CircleCheck} label="Terminées" value={nbFaits} color="#22c55e"
            sub="à vider quand vous voulez"/>
        </div>

        {/* Saisie nouvelle tâche */}
        <MobileCard T={T} accent={acc.accent} style={{ padding: "16px 18px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
            fontSize: FONT.md.size, fontWeight: 700, color: T.text,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              background: `linear-gradient(135deg, ${acc.accent}2e, ${acc.accent}14)`, color: acc.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Icon as={Plus} size={16} strokeWidth={2.4}/>
            </div>
            Nouvelle tâche
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              ref={inputRef}
              value={newTodo}
              onChange={e => setNewTodo(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") addTodo(); }}
              placeholder="Décrivez la tâche… (Entrée pour valider)"
              style={{
                flex: 1, padding: "10px 13px", borderRadius: 11,
                border: `1px solid ${T.border}`, background: T.card,
                color: T.text, fontFamily: "inherit", fontSize: FONT.base.size,
                outline: "none", transition: "border-color .12s",
              }}
              onFocus={e => e.target.style.borderColor = acc.accent}
              onBlur={e => e.target.style.borderColor = T.border}
            />
            <button onClick={addTodo} disabled={!newTodo.trim()} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: newTodo.trim() ? `linear-gradient(135deg, ${acc.accent}, ${acc.accent}cc)` : T.card,
              border: newTodo.trim() ? "none" : `1px solid ${T.border}`,
              borderRadius: 11, padding: "10px 18px",
              color: newTodo.trim() ? acc.onAccent : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size + 1,
              fontWeight: 800, cursor: newTodo.trim() ? "pointer" : "not-allowed",
              boxShadow: newTodo.trim() ? `0 5px 14px ${acc.accent}55` : "none",
              flexShrink: 0,
            }}>
              <Icon as={Plus} size={15}/>
              Ajouter
            </button>
          </div>
          {/* Sélecteur priorité + assignés + échéance */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 5 }}>
              {PRIORITES.map(p => (
                <button key={p.id} onClick={() => setNewPrio(p.id)} style={{
                  padding: "4px 11px", borderRadius: RADIUS.pill,
                  border: `1.5px solid ${newPrio === p.id ? p.color : T.border}`,
                  background: newPrio === p.id ? p.bg : "transparent",
                  color: newPrio === p.id ? p.color : T.textSub,
                  fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer",
                }}>{p.label}</button>
              ))}
            </div>
            <SelecteurAssignes
              assignes={newAssignes} onChange={setNewAssignes}
              utilisateurs={utilisateurs} T={T} acc={acc}
            />
            <SelecteurEcheance
              type={newEchType} date={newEchDate}
              onType={setNewEchType} onDate={setNewEchDate} T={T}
            />
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {chantiers.length > 0 && (
              <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
                <span style={{
                  position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                  width: 10, height: 10, borderRadius: 3,
                  background: newChantier ? (chantiers.find(c => c.id === newChantier)?.couleur || T.textMuted) : T.textMuted,
                  opacity: newChantier ? 1 : 0.4, pointerEvents:"none",
                }}/>
                <select value={newChantier} onChange={e => setNewChantier(e.target.value)} style={{
                  width:"100%", padding: "7px 10px 7px 28px", borderRadius: 10,
                  border: `1px solid ${newChantier ? acc.border : T.border}`,
                  background: T.card, color: newChantier ? T.text : T.textMuted,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                  fontWeight: newChantier ? 600 : 500,
                }}>
                  <option value="">Aucun chantier (optionnel)</option>
                  {chantiers.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={() => setNewNoteVisible(v => !v)} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "7px 12px", borderRadius: 10,
              border: `1px ${newNoteVisible || newNote.trim() ? "solid" : "dashed"} ${newNote.trim() ? acc.accent : T.border}`,
              background: newNote.trim() ? acc.bg10 : "transparent",
              color: newNote.trim() ? acc.accent : T.textSub,
              fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
            }}>
              <Icon as={FileText} size={12}/>
              {newNoteVisible ? "Masquer la note" : newNote.trim() ? "Note ajoutée" : "Ajouter une note"}
            </button>
          </div>
          {newNoteVisible && (
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Détails, contexte, contacts, références… (enregistrée avec la tâche)"
              rows={3}
              style={{
                width: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 10,
                border: `1px solid ${T.border}`, background: T.card,
                color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size,
                lineHeight: 1.6, resize: "vertical", outline: "none",
              }}
            />
          )}
          {notifStatus && (
            <div style={{
              marginTop: 10, padding: "7px 12px", borderRadius: 10,
              background: notifStatus.startsWith("⚠") ? "rgba(245,166,35,0.10)"
                        : notifStatus.startsWith("✓") ? "rgba(34,197,94,0.10)"
                        : acc.bg10,
              color:      notifStatus.startsWith("⚠") ? "#f5a623"
                        : notifStatus.startsWith("✓") ? "#22c55e"
                        : acc.accent,
              fontSize: FONT.xs.size + 1, fontWeight: 600,
            }}>{notifStatus}</div>
          )}
        </MobileCard>

        {/* Filtres : onglets segmentés + chantier + vider terminées */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <MobileTabs
            T={T} accent={acc.accent} onAccent={acc.onAccent}
            value={filtre} onChange={setFiltre}
            tabs={[
              { id: "actif", label: "À faire", icon: ListTodo, count: nbActifs },
              ...(monEmail ? [{ id: "mes", label: "Mes tâches", icon: User, count: nbMes }] : []),
              { id: "fait", label: "Terminées", icon: CircleCheck, count: nbFaits },
            ]}
          />
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {chantiers.length > 0 && (
              <div style={{ position: "relative", minWidth: 170 }}>
                {filtreChantier && (
                  <span style={{
                    position:"absolute", left:12, top:"50%", transform:"translateY(-50%)",
                    width: 9, height: 9, borderRadius: 2,
                    background: chantiers.find(c => c.id === filtreChantier)?.couleur || T.textMuted,
                    pointerEvents: "none",
                  }}/>
                )}
                <select value={filtreChantier} onChange={e => setFiltreChantier(e.target.value)} style={{
                  width: "100%",
                  padding: filtreChantier ? "9px 24px 9px 28px" : "9px 14px",
                  borderRadius: 12,
                  border: `1px solid ${filtreChantier ? acc.border : T.border}`,
                  background: T.surface, color: filtreChantier ? T.text : T.textSub,
                  fontFamily: "inherit", fontSize: FONT.xs.size + 2,
                  fontWeight: filtreChantier ? 700 : 600,
                  outline: "none", cursor: "pointer", boxShadow: CARD_SHADOW,
                }}>
                  <option value="">Tous les chantiers</option>
                  {chantiers.map(c => (
                    <option key={c.id} value={c.id}>{c.nom}</option>
                  ))}
                </select>
                {filtreChantier && (
                  <button onClick={() => setFiltreChantier("")} title="Retirer le filtre"
                    style={{
                      position:"absolute", right:5, top:"50%", transform:"translateY(-50%)",
                      background:"transparent", border:"none", color:T.textMuted,
                      cursor:"pointer", padding:2, borderRadius:3,
                      display:"inline-flex", alignItems:"center",
                    }}>
                    <Icon as={X} size={11}/>
                  </button>
                )}
              </div>
            )}
            {nbFaits > 0 && (
              <button onClick={clearFaits} title={`Supprimer définitivement les ${nbFaits} tâches terminées`}
                style={{
                  display:"inline-flex", alignItems:"center", gap:6,
                  background: T.surface,
                  border: `1px solid rgba(225,90,90,0.30)`, borderRadius: 12,
                  color: "#e15a5a", fontFamily: "inherit",
                  fontSize: FONT.xs.size + 2, fontWeight: 700,
                  cursor: "pointer", padding: "9px 14px", boxShadow: CARD_SHADOW,
                }}>
                <Icon as={Trash2} size={13}/>
                Vider terminées ({nbFaits})
              </button>
            )}
          </div>
        </div>

        {/* Liste des tâches */}
        <div>
          {todosFiltres.length === 0 ? (
            <MobileCard T={T}>
              <MobileEmptyState
                T={T}
                icon={filtre === "fait" ? CircleCheck : ClipboardList}
                title={
                  filtre === "actif" ? "Aucune tâche en cours — bien joué !"
                  : filtre === "fait" ? "Aucune tâche terminée"
                  : "Aucune tâche assignée à vous"
                }
                hint={filtre === "actif" ? "Ajoutez une tâche ci-dessus pour démarrer." : null}
              />
            </MobileCard>
          ) : (
            todosFiltres.map(todo => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={toggleTodo}
                onDelete={deleteTodo}
                onEdit={editTodo}
                onToggleSousTache={toggleSousTache}
                onAddMaj={addMaj}
                T={T}
                utilisateurs={utilisateurs}
                chantiers={chantiers}
                acc={acc}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default PageNotesEtTodo;
