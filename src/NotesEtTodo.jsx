import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { getBranchAccent, FONT, RADIUS, SPACING } from "./constants";
import { Icon } from "./ui";
import {
  ClipboardList, ListTodo, User, Trash2, Pencil, X, Plus, Check,
  Calendar, AlarmClock, FileText, CircleCheck, Circle, HardHat, ListChecks,
  ChevronDown, ChevronRight,
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
const KEY_NOTES = "bloc_notes";

// ─── EMAIL HELPER ────────────────────────────────────────────────────────────
const DEFAULT_TODO_TEMPLATE = {
  subject: "Nouvelle tâche : {texte}",
  body: "Bonjour {prenom},\n\n{assigneur} vous a assigné cette tâche :\n{texte}\n\nPriorité : {priorite}\n\nConnectez-vous à Profero Planning, onglet Notes & To-do, pour cocher la tâche une fois terminée.",
};

const interpolate = (str, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), str || "");

async function envoyerEmailAssignation({ to, nom, texte, priorite, assigneur }) {
  if (!to) return { ok: false, reason: "no_email" };
  const prioLabel = priorite === "haute" ? "🔴 Haute" : priorite === "basse" ? "🟢 Basse" : "🟡 Normale";

  // Charge le template personnalisé depuis Supabase (fallback : default)
  let tpl = DEFAULT_TODO_TEMPLATE;
  try {
    const { data } = await supabase.from("planning_config").select("value").eq("key", "email_templates").maybeSingle();
    if (data?.value?.todo_assign) tpl = { ...DEFAULT_TODO_TEMPLATE, ...data.value.todo_assign };
  } catch (e) { /* fallback déjà en place */ }

  const vars = {
    prenom:    nom || "",
    texte:     texte || "",
    priorite:  prioLabel,
    assigneur: assigneur || "Quelqu'un",
  };
  const subject = interpolate(tpl.subject, vars);
  const bodyTxt = interpolate(tpl.body, vars);
  const bodyHtml = escapeHtml(bodyTxt).replace(/\n/g, "<br/>");

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Nouvelle tâche</div>
      <div style="color:#fff;font-size:20px;font-weight:800">📋 Une tâche vous a été assignée</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <div style="font-size:14px;color:#1a1f2e;line-height:1.7">${bodyHtml}</div>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;

  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, html }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch (e) {
    console.error("Email assignation:", e);
    return { ok: false, reason: e.message };
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

// ─── COMPOSANT TODO ITEM ──────────────────────────────────────────────────────
function TodoItem({ todo, onToggle, onDelete, onEdit, onToggleSousTache, T, utilisateurs, chantiers = [], acc }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(todo.texte);
  const [draftPrio, setDraftPrio] = useState(todo.priorite || "normale");
  const [draftAssigne, setDraftAssigne] = useState(todo.assigne_email || "");
  const [draftDate, setDraftDate] = useState(todo.date_limite || "");
  const [draftChantier, setDraftChantier] = useState(todo.chantier_id || "");
  const [draftSousTaches, setDraftSousTaches] = useState(todo.sous_taches || []);
  const [sousTachesExpanded, setSousTachesExpanded] = useState(true);
  const inputRef = useRef();

  const chantier = todo.chantier_id ? chantiers.find(c => c.id === todo.chantier_id) : null;

  const startEdit = () => {
    setDraft(todo.texte);
    setDraftPrio(todo.priorite || "normale");
    setDraftAssigne(todo.assigne_email || "");
    setDraftDate(todo.date_limite || "");
    setDraftChantier(todo.chantier_id || "");
    setDraftSousTaches(todo.sous_taches || []);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    if (!draft.trim()) { setEditing(false); return; }
    const u = utilisateurs.find(x => x.email === draftAssigne);
    const ch = chantiers.find(c => c.id === draftChantier);
    const dateChanged = (draftDate || null) !== (todo.date_limite || null);
    const cleanSousTaches = draftSousTaches.filter(st => st.texte?.trim()).map(st => ({
      id: st.id,
      texte: st.texte.trim(),
      fait: !!st.fait,
    }));
    onEdit(todo.id, {
      texte: draft.trim(),
      priorite: draftPrio,
      assigne_email: u ? u.email : null,
      assigne_nom:   u ? u.nom   : null,
      date_limite:   draftDate || null,
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

  if (editing) {
    return (
      <div style={{
        background: T.surface, border: `1px solid ${acc.accent}`,
        borderRadius: RADIUS.lg, padding: "12px 14px", marginBottom: 6,
      }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          style={{
            width: "100%", background: "transparent", border: "none",
            color: T.text, fontFamily: "inherit", fontSize: FONT.base.size, outline: "none",
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
          <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
            <Icon as={User} size={13}
              style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color: draftAssigne ? acc.accent : T.textMuted, pointerEvents:"none" }}/>
            <select value={draftAssigne} onChange={e => setDraftAssigne(e.target.value)} style={{
              width:"100%", padding: "6px 10px 6px 28px", borderRadius: RADIUS.md,
              border: `1px solid ${draftAssigne ? acc.border : T.border}`,
              background: T.card, color: draftAssigne ? T.text : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
              fontWeight: draftAssigne ? 600 : 500,
            }}>
              <option value="">Personne assignée</option>
              {utilisateurs.map(u => (
                <option key={u.id} value={u.email}>{u.nom} ({u.role})</option>
              ))}
            </select>
          </div>
          <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
            title="Date limite (optionnel)" style={{
              padding: "6px 10px", borderRadius: RADIUS.md,
              border: `1px solid ${draftDate ? "#f5a623" : T.border}`, background: T.card,
              color: draftDate ? "#f5a623" : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none", fontWeight: draftDate ? 700 : 500,
            }}/>
          {draftDate && (
            <button onClick={() => setDraftDate("")} title="Retirer la date" style={{
              padding: "5px 7px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub,
              fontFamily: "inherit", cursor: "pointer",
              display:"inline-flex", alignItems:"center", justifyContent:"center",
            }}>
              <Icon as={X} size={12}/>
            </button>
          )}
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
                width:"100%", padding: "6px 10px 6px 28px", borderRadius: RADIUS.md,
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
            padding: "6px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.sm.size, fontWeight: 600, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={saveEdit} style={{
            display:"inline-flex", alignItems:"center", gap:6,
            padding: "6px 14px", borderRadius: RADIUS.md, border: "none",
            background: acc.accent, color: acc.onAccent,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
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
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 12px", borderRadius: RADIUS.md, marginBottom: 4,
      background: todo.fait ? "rgba(255,255,255,0.02)" : T.card,
      border: `1px solid ${todo.fait ? "transparent" : T.border}`,
      borderLeft: todo.fait ? `1px solid transparent` : `3px solid ${prio.color}`,
      transition: "all .15s", opacity: todo.fait ? 0.55 : 1,
    }}>
      {/* Checkbox */}
      <button onClick={() => onToggle(todo.id)} title={todo.fait ? "Marquer comme à faire" : "Marquer comme terminé"}
        style={{
          width: 20, height: 20, borderRadius: RADIUS.sm + 2, flexShrink: 0,
          border: `2px solid ${todo.fait ? "#22c55e" : prio.color}`,
          background: todo.fait ? "#22c55e" : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          marginTop: 2, padding: 0,
        }}>
        {todo.fait && <Icon as={Check} size={12} color="#ffffff" strokeWidth={3}/>}
      </button>

      {/* Texte + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: FONT.base.size, color: T.text,
          textDecoration: todo.fait ? "line-through" : "none",
          wordBreak: "break-word", lineHeight: 1.4,
        }}>
          {todo.texte}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5, alignItems: "center" }}>
          {!todo.fait && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "1px 8px", borderRadius: RADIUS.pill,
              background: prio.bg, color: prio.color,
              fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .3,
            }}>{prio.label}</span>
          )}
          {todo.assigne_nom && (
            <span title={todo.assigne_email || ""} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "1px 8px", borderRadius: RADIUS.pill,
              background: acc.bg10, color: acc.accent,
              fontSize: FONT.xs.size, fontWeight: 700,
            }}>
              <Icon as={User} size={10}/>
              {todo.assigne_nom}
            </span>
          )}
          {chantier && (
            <span title="Chantier" style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "1px 8px", borderRadius: RADIUS.pill,
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
            const bg = enRetard ? "rgba(225,90,90,0.12)" : aujourdhui ? "rgba(245,166,35,0.12)" : "rgba(255,255,255,0.04)";
            const dateAffichee = new Date(todo.date_limite + "T00:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
            return (
              <span title={enRetard ? "Tâche en retard" : aujourdhui ? "Date limite aujourd'hui" : "Date limite"}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "1px 8px", borderRadius: RADIUS.pill,
                  background: bg, color: couleur,
                  fontSize: FONT.xs.size, fontWeight: 700,
                }}>
                <Icon as={enRetard ? AlarmClock : Calendar} size={10}/>
                {dateAffichee}
              </span>
            );
          })()}
          {todo.created_at && (
            <span style={{ fontSize: FONT.xs.size, color: T.textMuted, marginLeft:"auto" }}>
              ajouté {new Date(todo.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>

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
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
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
  const [notes, setNotes]         = useState("");
  const [notesSaved, setNotesSaved] = useState("");
  const [newTodo, setNewTodo]     = useState("");
  const [newPrio, setNewPrio]     = useState("normale");
  const [newAssigne, setNewAssigne] = useState(""); // email
  const [newDate, setNewDate]       = useState(""); // date_limite ISO YYYY-MM-DD
  const [newChantier, setNewChantier] = useState(""); // chantier_id
  const [filtre, setFiltre]       = useState("actif"); // actif | fait | mes
  const [filtreChantier, setFiltreChantier] = useState("");
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaveStatus, setNotesSaveStatus] = useState(""); // "" | "saving" | "saved"
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [notifStatus, setNotifStatus]   = useState(""); // message éphémère
  const notesTimer = useRef(null);
  const inputRef = useRef();

  const monEmail = profil?.email || null;
  const monNom   = profil?.nom   || profil?.email || "Quelqu'un";

  // ── Chargement ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, users] = await Promise.all([
        supabase.from("planning_config").select("*").in("key", [KEY_TODOS, KEY_NOTES]),
        supabase.from("utilisateurs").select("id, email, nom, role, actif").eq("actif", true).order("nom"),
      ]);
      if (cfg.data) {
        cfg.data.forEach(r => {
          if (r.key === KEY_TODOS) setTodos(Array.isArray(r.value) ? r.value : []);
          if (r.key === KEY_NOTES) { setNotes(r.value || ""); setNotesSaved(r.value || ""); }
        });
      }
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

  // ── Sauvegarde notes (auto avec délai) ─────────────────────────────────────
  const saveNotes = async (val) => {
    setNotesSaveStatus("saving");
    await supabase.from("planning_config")
      .upsert({ key: KEY_NOTES, value: val, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setNotesSaved(val);
    setNotesDirty(false);
    setNotesSaveStatus("saved");
    setTimeout(() => setNotesSaveStatus(""), 2000);
  };

  const handleNotesChange = (val) => {
    setNotes(val);
    setNotesDirty(val !== notesSaved);
    setNotesSaveStatus("");
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => saveNotes(val), 1500);
  };

  // ── Ajouter un todo ─────────────────────────────────────────────────────────
  const addTodo = async () => {
    if (!newTodo.trim()) return;
    const u = utilisateurs.find(x => x.email === newAssigne);
    const ch = chantiers.find(c => c.id === newChantier);
    const todo = {
      id: Math.random().toString(36).slice(2),
      texte: newTodo.trim(),
      priorite: newPrio,
      fait: false,
      created_at: new Date().toISOString(),
      created_by_email: monEmail,
      created_by_nom:   monNom,
      assigne_email: u ? u.email : null,
      assigne_nom:   u ? u.nom   : null,
      date_limite:   newDate || null,
      chantier_id:   ch ? ch.id : null,
      chantier_nom:  ch ? ch.nom : null,
      chantier_couleur: ch ? ch.couleur : null,
    };
    const updated = [todo, ...todos];
    setTodos(updated);
    saveTodos(updated);
    setNewTodo("");
    setNewAssigne("");
    setNewDate("");
    setNewChantier("");
    inputRef.current?.focus();

    if (u) {
      flashNotif(`📧 Envoi de l'email à ${u.nom}…`);
      const r = await envoyerEmailAssignation({
        to: u.email, nom: u.nom, texte: todo.texte, priorite: todo.priorite, assigneur: monNom,
      });
      flashNotif(r.ok ? `✓ Email envoyé à ${u.nom}` : `⚠️ Email non envoyé : ${r.error || r.reason || "erreur"}`);
    }
  };

  const toggleTodo = (id) => {
    const updated = todos.map(t => t.id === id ? { ...t, fait: !t.fait } : t);
    setTodos(updated);
    saveTodos(updated);
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
    // Notification si nouvel assigné
    const nouveauEmail = patch.assigne_email;
    if (nouveauEmail && nouveauEmail !== ancien?.assigne_email) {
      const final = { ...ancien, ...patch };
      flashNotif(`📧 Envoi de l'email à ${final.assigne_nom}…`);
      const r = await envoyerEmailAssignation({
        to: final.assigne_email, nom: final.assigne_nom, texte: final.texte, priorite: final.priorite, assigneur: monNom,
      });
      flashNotif(r.ok ? `✓ Email envoyé à ${final.assigne_nom}` : `⚠️ Email non envoyé : ${r.error || r.reason || "erreur"}`);
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
      if (filtre === "mes"   && (t.fait || !monEmail || t.assigne_email !== monEmail)) return false;
      // Filtre chantier
      if (filtreChantier && t.chantier_id !== filtreChantier) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.fait !== b.fait) return a.fait ? 1 : -1;
      return (PRIO_ORDER[a.priorite] ?? 1) - (PRIO_ORDER[b.priorite] ?? 1);
    });

  const nbActifs = todos.filter(t => !t.fait).length;
  const nbFaits  = todos.filter(t => t.fait).length;
  const nbMes    = monEmail ? todos.filter(t => !t.fait && t.assigne_email === monEmail).length : 0;

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: T.textMuted, fontSize: 14 }}>Chargement…</div>
      </div>
    );
  }

  return (
    <div className="ntd-page" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <style>{`
        @media(max-width:767px) {
          .ntd-page .ntd-header{padding:10px 14px!important;font-size:14px}
          .ntd-page .ntd-header > div:first-child{font-size:14px!important;letter-spacing:.5px!important}
          .ntd-page .notes-todo-grid{grid-template-columns:1fr!important;overflow-y:auto!important}
          .ntd-page .notes-todo-grid > div{border-right:none!important;border-bottom:1px solid ${T.border};min-height:auto!important;overflow:visible!important}
          .ntd-page .notes-todo-grid textarea{min-height:200px!important}
        }
      `}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="ntd-header" style={{
        padding: "14px 28px", borderBottom: `1px solid ${T.headerBorder || T.border}`,
        background: T.surface, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: RADIUS.md,
            background: acc.bg10, color: acc.accent,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <Icon as={ClipboardList} size={18} strokeWidth={2}/>
          </div>
          <div style={{ fontSize: FONT.xl.size, fontWeight: 800, letterSpacing: -0.3, color: T.text }}>
            Notes & To-do
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", fontSize: FONT.xs.size + 1 }}>
          {saving ? (
            <span style={{ color: T.textMuted }}>Sauvegarde…</span>
          ) : (
            <span style={{ display:"inline-flex", alignItems:"center", gap:5, color: "#22c55e" }}>
              <Icon as={CircleCheck} size={13}/>
              Synchronisé
            </span>
          )}
        </div>
      </div>

      {/* ── Corps : 2 colonnes ─────────────────────────────────────────────── */}
      <div style={{
        flex: 1, display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0, minHeight: 0, overflow: "hidden",
      }} className="notes-todo-grid">

        {/* ── COLONNE GAUCHE : TO-DO ────────────────────────────────────────── */}
        <div style={{
          display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
          borderRight: `1px solid ${T.border}`,
        }}>
          {/* Sous-header todo */}
          <div style={{
            padding: "14px 20px 12px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Icon as={ListTodo} size={16} color={T.textSub}/>
              <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text }}>
                Liste de tâches
              </div>
              <div style={{
                background: nbActifs > 0 ? acc.bg10 : "rgba(34,197,94,0.10)",
                color: nbActifs > 0 ? acc.accent : "#22c55e",
                borderRadius: RADIUS.pill, padding: "2px 10px",
                fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .3,
              }}>
                {nbActifs} à faire
              </div>
              {nbFaits > 0 && (
                <button onClick={clearFaits} title={`Supprimer définitivement les ${nbFaits} tâches terminées`}
                  style={{
                    marginLeft: "auto",
                    display:"inline-flex", alignItems:"center", gap:5,
                    background: "transparent",
                    border: `1px solid rgba(225,90,90,0.30)`, borderRadius: RADIUS.md,
                    color: "#e15a5a", fontFamily: "inherit",
                    fontSize: FONT.xs.size + 1, fontWeight: 600,
                    cursor: "pointer", padding: "5px 10px",
                  }}>
                  <Icon as={Trash2} size={12}/>
                  Vider terminées ({nbFaits})
                </button>
              )}
            </div>

            {/* Filtres */}
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              {[
                { id: "actif", label: `À faire`, count: nbActifs },
                ...(monEmail ? [{ id: "mes", label: `Mes tâches`, count: nbMes, icon: User, highlight: nbMes > 0 }] : []),
                { id: "fait",  label: `Terminées`, count: nbFaits },
              ].map(f => {
                const active = filtre === f.id;
                return (
                  <button key={f.id} onClick={() => setFiltre(f.id)} style={{
                    display:"inline-flex", alignItems:"center", gap:5,
                    padding: "5px 11px", borderRadius: RADIUS.md, fontFamily: "inherit",
                    fontSize: FONT.xs.size + 1, fontWeight: active ? 700 : 600,
                    cursor: "pointer",
                    border: `1px solid ${active ? acc.accent : T.border}`,
                    background: active ? acc.bg10 : "transparent",
                    color: active ? acc.accent : T.textSub,
                  }}>
                    {f.icon && <Icon as={f.icon} size={11}/>}
                    {f.label}
                    <span style={{
                      fontSize: FONT.xs.size, fontWeight: 700,
                      opacity: active ? .8 : .55,
                    }}>({f.count})</span>
                  </button>
                );
              })}
              {chantiers.length > 0 && (
                <div style={{ position: "relative", marginLeft: "auto", minWidth: 140 }}>
                  {filtreChantier && (
                    <span style={{
                      position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                      width: 9, height: 9, borderRadius: 2,
                      background: chantiers.find(c => c.id === filtreChantier)?.couleur || T.textMuted,
                      pointerEvents: "none",
                    }}/>
                  )}
                  <select value={filtreChantier} onChange={e => setFiltreChantier(e.target.value)} style={{
                    width: "100%",
                    padding: filtreChantier ? "4px 22px 4px 26px" : "4px 10px",
                    borderRadius: RADIUS.md,
                    border: `1px solid ${filtreChantier ? acc.border : T.border}`,
                    background: T.card, color: filtreChantier ? T.text : T.textSub,
                    fontFamily: "inherit", fontSize: FONT.xs.size + 1,
                    fontWeight: filtreChantier ? 700 : 600,
                    outline: "none", cursor: "pointer",
                  }}>
                    <option value="">Tous les chantiers</option>
                    {chantiers.map(c => (
                      <option key={c.id} value={c.id}>{c.nom}</option>
                    ))}
                  </select>
                  {filtreChantier && (
                    <button onClick={() => setFiltreChantier("")} title="Retirer le filtre"
                      style={{
                        position:"absolute", right:4, top:"50%", transform:"translateY(-50%)",
                        background:"transparent", border:"none", color:T.textMuted,
                        cursor:"pointer", padding:2, borderRadius:3,
                        display:"inline-flex", alignItems:"center",
                      }}>
                      <Icon as={X} size={11}/>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Saisie nouveau todo */}
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
              <input
                ref={inputRef}
                value={newTodo}
                onChange={e => setNewTodo(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addTodo(); }}
                placeholder="Nouvelle tâche… (Entrée pour valider)"
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.border}`, background: T.card,
                  color: T.text, fontFamily: "inherit", fontSize: FONT.base.size,
                  outline: "none", transition: "border-color .12s",
                }}
                onFocus={e => e.target.style.borderColor = acc.accent}
                onBlur={e => e.target.style.borderColor = T.border}
              />
              <button onClick={addTodo} disabled={!newTodo.trim()} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: newTodo.trim() ? acc.accent : T.card,
                border: newTodo.trim() ? "none" : `1px solid ${T.border}`,
                borderRadius: RADIUS.md, padding: "9px 16px",
                color: newTodo.trim() ? acc.onAccent : T.textMuted,
                fontFamily: "inherit", fontSize: FONT.sm.size + 1,
                fontWeight: 800, cursor: newTodo.trim() ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}>
                <Icon as={Plus} size={15}/>
                Ajouter
              </button>
            </div>
            {/* Sélecteur priorité + assigné + date */}
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
              <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
                <Icon as={User} size={13}
                  style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                    color: newAssigne ? acc.accent : T.textMuted, pointerEvents:"none" }}/>
                <select value={newAssigne} onChange={e => setNewAssigne(e.target.value)} style={{
                  width:"100%", padding: "6px 10px 6px 28px", borderRadius: RADIUS.md,
                  border: `1px solid ${newAssigne ? acc.border : T.border}`,
                  background: T.card, color: newAssigne ? T.text : T.textMuted,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                  fontWeight: newAssigne ? 600 : 500,
                }}>
                  <option value="">Personne assignée (optionnel)</option>
                  {utilisateurs.map(u => (
                    <option key={u.id} value={u.email}>{u.nom} ({u.role})</option>
                  ))}
                </select>
              </div>
              <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                title="Date limite (optionnel)" style={{
                  padding: "6px 10px", borderRadius: RADIUS.md,
                  border: `1px solid ${newDate ? "#f5a623" : T.border}`,
                  background: T.card, color: newDate ? "#f5a623" : T.textMuted,
                  fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none",
                  fontWeight: newDate ? 700 : 500,
                }}/>
              {newDate && (
                <button onClick={() => setNewDate("")} title="Retirer la date" style={{
                  padding: "5px 7px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontFamily: "inherit",
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center",
                }}>
                  <Icon as={X} size={12}/>
                </button>
              )}
            </div>
            {chantiers.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
                  <span style={{
                    position:"absolute", left:10, top:"50%", transform:"translateY(-50%)",
                    width: 10, height: 10, borderRadius: 3,
                    background: newChantier ? (chantiers.find(c => c.id === newChantier)?.couleur || T.textMuted) : T.textMuted,
                    opacity: newChantier ? 1 : 0.4, pointerEvents:"none",
                  }}/>
                  <select value={newChantier} onChange={e => setNewChantier(e.target.value)} style={{
                    width:"100%", padding: "6px 10px 6px 28px", borderRadius: RADIUS.md,
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
              </div>
            )}
            {notifStatus && (
              <div style={{
                marginTop: 8, padding: "6px 12px", borderRadius: RADIUS.md,
                background: notifStatus.startsWith("⚠") ? "rgba(245,166,35,0.10)"
                          : notifStatus.startsWith("✓") ? "rgba(34,197,94,0.10)"
                          : acc.bg10,
                color:      notifStatus.startsWith("⚠") ? "#f5a623"
                          : notifStatus.startsWith("✓") ? "#22c55e"
                          : acc.accent,
                fontSize: FONT.xs.size + 1, fontWeight: 600,
              }}>{notifStatus}</div>
            )}
          </div>

          {/* Liste des todos */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 20px" }}>
            {todosFiltres.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: "100%", gap: 14,
                color: T.textMuted, fontSize: FONT.sm.size,
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: filtre === "fait" ? "rgba(34,197,94,0.10)" : acc.bg10,
                  color: filtre === "fait" ? "#22c55e" : acc.accent,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Icon as={filtre === "fait" ? CircleCheck : ListTodo} size={28} strokeWidth={1.75}/>
                </div>
                {filtre === "actif" && "Aucune tâche en cours — bien joué !"}
                {filtre === "fait" && "Aucune tâche terminée"}
                {filtre === "mes" && "Aucune tâche assignée à vous"}
                {filtre === "tout" && "Aucune tâche pour l'instant"}
              </div>
            ) : (
              todosFiltres.map(todo => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onToggle={toggleTodo}
                  onDelete={deleteTodo}
                  onEdit={editTodo}
                  onToggleSousTache={toggleSousTache}
                  T={T}
                  utilisateurs={utilisateurs}
                  chantiers={chantiers}
                  acc={acc}
                />
              ))
            )}
          </div>
        </div>

        {/* ── COLONNE DROITE : NOTES LIBRES ────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* Sous-header notes */}
          <div style={{
            padding: "14px 20px 12px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <Icon as={FileText} size={16} color={T.textSub}/>
            <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text }}>
              Notes libres
            </div>
            <div style={{ marginLeft: "auto", fontSize: FONT.xs.size + 1, display:"inline-flex", alignItems:"center", gap:6 }}>
              {notesSaveStatus === "saving" && (
                <span style={{ color: T.textMuted }}>Enregistrement…</span>
              )}
              {notesSaveStatus === "saved" && (
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, color: "#22c55e", fontWeight:600 }}>
                  <Icon as={CircleCheck} size={13}/>
                  Sauvegardé
                </span>
              )}
              {notesSaveStatus === "" && notesDirty && (
                <span style={{ display:"inline-flex", alignItems:"center", gap:5, color: "#f5a623", fontWeight:600 }}>
                  <Icon as={Circle} size={9} fill="#f5a623"/>
                  Non sauvegardé
                </span>
              )}
            </div>
            {notesDirty && notesSaveStatus === "" && (
              <button onClick={() => saveNotes(notes)} style={{
                display:"inline-flex", alignItems:"center", gap:5,
                padding: "5px 12px", borderRadius: RADIUS.md, border: "none",
                background: acc.accent, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer",
              }}>
                <Icon as={Check} size={12}/>
                Sauvegarder
              </button>
            )}
          </div>

          {/* Zone de texte */}
          <div style={{ flex: 1, padding: "16px 20px", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <textarea
              value={notes}
              onChange={e => handleNotesChange(e.target.value)}
              placeholder={"Écrivez ici toutes vos notes importantes…\n\nExemples :\n• Chantier Lamartine : livraison placo semaine 22\n• Appeler le client Martin lundi\n• Vérifier devis isolation PHILIBERT\n• Contact fournisseur Leroy Merlin : 06 XX XX XX XX"}
              style={{
                flex: 1, width: "100%", padding: "14px 16px",
                background: T.card, border: `1px solid ${T.border}`,
                borderRadius: RADIUS.lg, color: T.text,
                fontFamily: "inherit", fontSize: FONT.base.size, lineHeight: 1.7,
                resize: "none", outline: "none",
                transition: "border-color .15s",
              }}
              onFocus={e => e.target.style.borderColor = acc.accent}
              onBlur={e => {
                e.target.style.borderColor = T.border;
                if (notesDirty) saveNotes(notes);
              }}
            />
            <div style={{
              display: "flex", justifyContent: "flex-end", alignItems: "center",
              marginTop: 8, fontSize: FONT.xs.size + 1, color: T.textMuted,
            }}>
              <span>Sauvegarde auto après 1,5 s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Responsive : stack en colonne sur mobile */}
      <style>{`
        @media (max-width: 767px) {
          .notes-todo-grid {
            grid-template-columns: 1fr !important;
            overflow: auto !important;
          }
        }
      `}</style>
    </div>
  );
}

export default PageNotesEtTodo;
