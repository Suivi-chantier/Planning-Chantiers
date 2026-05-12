import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { getBranchAccent, FONT, RADIUS, SPACING } from "./constants";
import { Icon } from "./ui";
import {
  ClipboardList, ListTodo, User, Trash2, Pencil, X, Plus, Check,
  Calendar, AlarmClock, FileText, CircleCheck, Circle,
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
async function envoyerEmailAssignation({ to, nom, texte, priorite, assigneur }) {
  if (!to) return { ok: false, reason: "no_email" };
  const prioLabel = priorite === "haute" ? "🔴 Haute" : priorite === "basse" ? "🟢 Basse" : "🟡 Normale";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
    <div style="background:#080a0d;padding:24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
      <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Planning · Nouvelle tâche</div>
      <div style="color:#fff;font-size:20px;font-weight:800">📋 Une tâche vous a été assignée</div>
    </div>
    <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px">
      <p style="margin:0 0 14px;font-size:15px">Bonjour <strong>${escapeHtml(nom)}</strong>,</p>
      <p style="margin:0 0 14px;font-size:14px;color:#555">${escapeHtml(assigneur || "Quelqu'un")} vous a assigné cette tâche :</p>
      <div style="background:#f4f6fa;border-left:4px solid #FFC200;border-radius:6px;padding:14px 16px;margin:14px 0">
        <div style="font-size:15px;color:#1a1f2e;line-height:1.5">${escapeHtml(texte)}</div>
        <div style="margin-top:10px;font-size:12px;color:#666">Priorité : ${prioLabel}</div>
      </div>
      <p style="margin:18px 0 0;font-size:13px;color:#666">
        Connecte-toi à <a href="https://planning-chantiers.vercel.app" style="color:#FFC200;font-weight:700;text-decoration:none">Profero Planning</a> → onglet <strong>Notes &amp; To-do</strong> pour cocher la tâche une fois terminée.
      </p>
    </div>
    <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Email automatique · Ne pas répondre</div>
  </div>`;

  try {
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        subject: `📋 Nouvelle tâche : ${texte.slice(0, 70)}${texte.length > 70 ? "…" : ""}`,
        html,
      }),
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
function TodoItem({ todo, onToggle, onDelete, onEdit, T, utilisateurs, acc }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(todo.texte);
  const [draftPrio, setDraftPrio] = useState(todo.priorite || "normale");
  const [draftAssigne, setDraftAssigne] = useState(todo.assigne_email || "");
  const [draftDate, setDraftDate] = useState(todo.date_limite || "");
  const inputRef = useRef();

  const startEdit = () => {
    setDraft(todo.texte);
    setDraftPrio(todo.priorite || "normale");
    setDraftAssigne(todo.assigne_email || "");
    setDraftDate(todo.date_limite || "");
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    if (!draft.trim()) { setEditing(false); return; }
    const u = utilisateurs.find(x => x.email === draftAssigne);
    const dateChanged = (draftDate || null) !== (todo.date_limite || null);
    onEdit(todo.id, {
      texte: draft.trim(),
      priorite: draftPrio,
      assigne_email: u ? u.email : null,
      assigne_nom:   u ? u.nom   : null,
      date_limite:   draftDate || null,
      // Reset le flag de relance si la date a été modifiée
      // → permet de re-notifier si la nouvelle date est aussi dépassée
      ...(dateChanged ? { relance_envoyee: false, relance_envoyee_date: null } : {}),
    });
    setEditing(false);
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
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
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
function PageNotesEtTodo({ T, profil, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [todos, setTodos]         = useState([]);
  const [notes, setNotes]         = useState("");
  const [notesSaved, setNotesSaved] = useState("");
  const [newTodo, setNewTodo]     = useState("");
  const [newPrio, setNewPrio]     = useState("normale");
  const [newAssigne, setNewAssigne] = useState(""); // email
  const [newDate, setNewDate]       = useState(""); // date_limite ISO YYYY-MM-DD
  const [filtre, setFiltre]       = useState("actif"); // actif | fait | mes | tout
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
    };
    const updated = [todo, ...todos];
    setTodos(updated);
    saveTodos(updated);
    setNewTodo("");
    setNewAssigne("");
    setNewDate("");
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

  const clearFaits = () => {
    const updated = todos.filter(t => !t.fait);
    setTodos(updated);
    saveTodos(updated);
  };

  // ── Filtrage + tri ──────────────────────────────────────────────────────────
  const PRIO_ORDER = { haute: 0, normale: 1, basse: 2 };
  const todosFiltres = todos
    .filter(t => {
      if (filtre === "actif") return !t.fait;
      if (filtre === "fait")  return t.fait;
      if (filtre === "mes")   return !t.fait && monEmail && t.assigne_email === monEmail;
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
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {[
                { id: "actif", label: `À faire`, count: nbActifs },
                ...(monEmail ? [{ id: "mes", label: `Mes tâches`, count: nbMes, icon: User, highlight: nbMes > 0 }] : []),
                { id: "fait",  label: `Terminées`, count: nbFaits },
                { id: "tout",  label: `Tout`, count: todos.length },
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
                  T={T}
                  utilisateurs={utilisateurs}
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
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 8, fontSize: FONT.xs.size + 1, color: T.textMuted,
            }}>
              <span>{notes.length} caractères · {notes.split("\n").filter(l => l.trim()).length} lignes</span>
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
