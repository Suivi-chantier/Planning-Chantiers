import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";

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
function TodoItem({ todo, onToggle, onDelete, onEdit, T, utilisateurs }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(todo.texte);
  const [draftPrio, setDraftPrio] = useState(todo.priorite || "normale");
  const [draftAssigne, setDraftAssigne] = useState(todo.assigne_email || "");
  const inputRef = useRef();

  const startEdit = () => {
    setDraft(todo.texte);
    setDraftPrio(todo.priorite || "normale");
    setDraftAssigne(todo.assigne_email || "");
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit = () => {
    if (!draft.trim()) { setEditing(false); return; }
    const u = utilisateurs.find(x => x.email === draftAssigne);
    onEdit(todo.id, {
      texte: draft.trim(),
      priorite: draftPrio,
      assigne_email: u ? u.email : null,
      assigne_nom:   u ? u.nom   : null,
    });
    setEditing(false);
  };

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const prio = getPriorite(todo.priorite || "normale");

  if (editing) {
    return (
      <div style={{
        background: T.surface, border: `1px solid ${T.accent}`,
        borderRadius: 10, padding: "10px 14px", marginBottom: 6,
      }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
          style={{
            width: "100%", background: "transparent", border: "none",
            color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none",
            marginBottom: 10,
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          {PRIORITES.map(p => (
            <button key={p.id} onClick={() => setDraftPrio(p.id)} style={{
              padding: "4px 10px", borderRadius: 14, border: `1.5px solid`,
              borderColor: draftPrio === p.id ? p.color : T.border,
              background: draftPrio === p.id ? p.bg : "transparent",
              color: draftPrio === p.id ? p.color : T.textSub,
              fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={draftAssigne} onChange={e => setDraftAssigne(e.target.value)} style={{
            flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 8,
            border: `1px solid ${T.border}`, background: T.card,
            color: draftAssigne ? T.text : T.textMuted,
            fontFamily: "inherit", fontSize: 12, outline: "none",
          }}>
            <option value="">👤 Personne assignée</option>
            {utilisateurs.map(u => (
              <option key={u.id} value={u.email}>{u.nom} ({u.role})</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={cancelEdit} style={{
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: 12, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={saveEdit} style={{
              padding: "5px 14px", borderRadius: 6, border: "none",
              background: T.accent, color: "#111", fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer",
            }}>✓ OK</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 12px", borderRadius: 10, marginBottom: 4,
      background: todo.fait ? "rgba(255,255,255,0.02)" : T.card,
      border: `1px solid ${todo.fait ? "transparent" : T.border}`,
      transition: "all .15s", opacity: todo.fait ? 0.5 : 1,
    }}>
      {/* Checkbox */}
      <button onClick={() => onToggle(todo.id)} style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
        border: `2px solid ${todo.fait ? "#50c878" : prio.color}`,
        background: todo.fait ? "#50c878" : "transparent",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        marginTop: 1,
      }}>
        {todo.fait && <span style={{ fontSize: 11, color: "#111", fontWeight: 900 }}>✓</span>}
      </button>

      {/* Texte + priorité */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, color: T.text,
          textDecoration: todo.fait ? "line-through" : "none",
          wordBreak: "break-word", lineHeight: 1.4,
        }}>
          {todo.texte}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4, alignItems: "center" }}>
          {!todo.fait && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 8px", borderRadius: 10,
              background: prio.bg, color: prio.color,
              fontSize: 10, fontWeight: 700,
            }}>
              {prio.label}
            </div>
          )}
          {todo.assigne_nom && (
            <div title={todo.assigne_email || ""} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "1px 8px", borderRadius: 10,
              background: "rgba(91,138,245,0.12)", color: "#5b8af5",
              fontSize: 10, fontWeight: 700,
            }}>
              👤 {todo.assigne_nom}
            </div>
          )}
          {todo.created_at && (
            <span style={{ fontSize: 10, color: T.textMuted }}>
              {new Date(todo.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {!todo.fait && (
          <button onClick={startEdit} title="Modifier" style={{
            background: "transparent", border: "none", color: T.textMuted,
            fontSize: 13, cursor: "pointer", padding: "2px 5px",
            opacity: 0.5, transition: "opacity .15s",
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = "0.5"}>✏️</button>
        )}
        <button onClick={() => onDelete(todo.id)} title="Supprimer" style={{
          background: "transparent", border: "none", color: "#e05c5c",
          fontSize: 13, cursor: "pointer", padding: "2px 5px",
          opacity: 0.4, transition: "opacity .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = "1"}
        onMouseLeave={e => e.currentTarget.style.opacity = "0.4"}>✕</button>
      </div>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────
function PageNotesEtTodo({ T, profil }) {
  const [todos, setTodos]         = useState([]);
  const [notes, setNotes]         = useState("");
  const [notesSaved, setNotesSaved] = useState("");
  const [newTodo, setNewTodo]     = useState("");
  const [newPrio, setNewPrio]     = useState("normale");
  const [newAssigne, setNewAssigne] = useState(""); // email
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
    };
    const updated = [todo, ...todos];
    setTodos(updated);
    saveTodos(updated);
    setNewTodo("");
    setNewAssigne("");
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
        padding: "16px 28px", borderBottom: `1px solid ${T.headerBorder || T.border}`,
        background: T.surface, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 1 }}>
          📋 NOTES & TO-DO
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {saving && <span style={{ fontSize: 11, color: T.textMuted }}>Sauvegarde…</span>}
          {!saving && <span style={{ fontSize: 11, color: "#50c878" }}>✓ Synchronisé</span>}
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
            padding: "14px 20px 10px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
                ✅ Liste de tâches
              </div>
              <div style={{
                background: nbActifs > 0 ? "rgba(255,194,0,0.15)" : "rgba(80,200,120,0.15)",
                color: nbActifs > 0 ? "#FFC200" : "#50c878",
                borderRadius: 12, padding: "2px 9px", fontSize: 11, fontWeight: 800,
              }}>
                {nbActifs} à faire
              </div>
              {nbFaits > 0 && (
                <button onClick={clearFaits} style={{
                  marginLeft: "auto", background: "transparent",
                  border: `1px solid rgba(224,92,92,0.3)`, borderRadius: 6,
                  color: "#e05c5c", fontFamily: "inherit", fontSize: 11,
                  cursor: "pointer", padding: "3px 10px",
                }}>
                  🗑 Vider les terminées ({nbFaits})
                </button>
              )}
            </div>

            {/* Filtres */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[
                { id: "actif", label: `À faire (${nbActifs})` },
                ...(monEmail ? [{ id: "mes", label: `👤 Mes tâches (${nbMes})`, highlight: nbMes > 0 }] : []),
                { id: "fait",  label: `Terminées (${nbFaits})` },
                { id: "tout",  label: `Tout (${todos.length})` },
              ].map(f => (
                <button key={f.id} onClick={() => setFiltre(f.id)} style={{
                  padding: "5px 12px", borderRadius: 6, fontFamily: "inherit",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  border: `1px solid ${filtre === f.id ? T.accent : (f.highlight ? "#5b8af5" : T.border)}`,
                  background: filtre === f.id ? "rgba(255,194,0,0.1)" : (f.highlight ? "rgba(91,138,245,0.08)" : "transparent"),
                  color: filtre === f.id ? T.accent : (f.highlight ? "#5b8af5" : T.textSub),
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          {/* Saisie nouveau todo */}
          <div style={{
            padding: "12px 20px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
          }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input
                ref={inputRef}
                value={newTodo}
                onChange={e => setNewTodo(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addTodo(); }}
                placeholder="Nouvelle tâche… (Entrée pour valider)"
                style={{
                  flex: 1, padding: "9px 12px", borderRadius: 8,
                  border: `1px solid ${T.border}`, background: T.card,
                  color: T.text, fontFamily: "inherit", fontSize: 14,
                }}
              />
              <button onClick={addTodo} disabled={!newTodo.trim()} style={{
                background: newTodo.trim() ? T.accent : T.textMuted,
                border: "none", borderRadius: 8, padding: "9px 16px",
                color: "#111", fontFamily: "inherit", fontSize: 13,
                fontWeight: 800, cursor: newTodo.trim() ? "pointer" : "not-allowed",
                flexShrink: 0,
              }}>+ Ajouter</button>
            </div>
            {/* Sélecteur priorité + assigné */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6 }}>
                {PRIORITES.map(p => (
                  <button key={p.id} onClick={() => setNewPrio(p.id)} style={{
                    padding: "4px 12px", borderRadius: 14,
                    border: `1.5px solid ${newPrio === p.id ? p.color : T.border}`,
                    background: newPrio === p.id ? p.bg : "transparent",
                    color: newPrio === p.id ? p.color : T.textSub,
                    fontFamily: "inherit", fontSize: 11, fontWeight: 700, cursor: "pointer",
                  }}>{p.label}</button>
                ))}
              </div>
              <select value={newAssigne} onChange={e => setNewAssigne(e.target.value)} style={{
                flex: 1, minWidth: 160, padding: "5px 10px", borderRadius: 8,
                border: `1px solid ${newAssigne ? "#5b8af5" : T.border}`,
                background: T.card, color: newAssigne ? "#5b8af5" : T.textMuted,
                fontFamily: "inherit", fontSize: 12, outline: "none", fontWeight: newAssigne ? 700 : 500,
              }}>
                <option value="">👤 Personne assignée (optionnel)</option>
                {utilisateurs.map(u => (
                  <option key={u.id} value={u.email}>{u.nom} ({u.role})</option>
                ))}
              </select>
            </div>
            {notifStatus && (
              <div style={{
                marginTop: 8, padding: "5px 10px", borderRadius: 6,
                background: notifStatus.startsWith("⚠") ? "rgba(245,166,35,0.12)"
                          : notifStatus.startsWith("✓") ? "rgba(80,200,120,0.12)"
                          : "rgba(91,138,245,0.1)",
                color: notifStatus.startsWith("⚠") ? "#f5a623"
                     : notifStatus.startsWith("✓") ? "#50c878"
                     : "#5b8af5",
                fontSize: 11, fontWeight: 600,
              }}>{notifStatus}</div>
            )}
          </div>

          {/* Liste des todos */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 20px" }}>
            {todosFiltres.length === 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: "100%", gap: 12,
                color: T.textMuted, fontSize: 13,
              }}>
                <div style={{ fontSize: 40 }}>
                  {filtre === "fait" ? "🎉" : "✅"}
                </div>
                {filtre === "actif" && "Aucune tâche en cours — bien joué !"}
                {filtre === "fait" && "Aucune tâche terminée"}
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
                />
              ))
            )}
          </div>
        </div>

        {/* ── COLONNE DROITE : NOTES LIBRES ────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* Sous-header notes */}
          <div style={{
            padding: "14px 20px 10px", borderBottom: `1px solid ${T.border}`,
            background: T.surface, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
              📝 Notes libres
            </div>
            <div style={{ marginLeft: "auto", fontSize: 11 }}>
              {notesSaveStatus === "saving" && (
                <span style={{ color: T.textMuted }}>⏳ Enregistrement…</span>
              )}
              {notesSaveStatus === "saved" && (
                <span style={{ color: "#50c878" }}>✓ Sauvegardé</span>
              )}
              {notesSaveStatus === "" && notesDirty && (
                <span style={{ color: "#f5a623" }}>● Non sauvegardé</span>
              )}
            </div>
            {notesDirty && notesSaveStatus === "" && (
              <button onClick={() => saveNotes(notes)} style={{
                padding: "5px 12px", borderRadius: 6, border: "none",
                background: T.accent, color: "#111",
                fontFamily: "inherit", fontSize: 11, fontWeight: 800, cursor: "pointer",
              }}>Sauvegarder</button>
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
                borderRadius: 12, color: T.text,
                fontFamily: "inherit", fontSize: 14, lineHeight: 1.7,
                resize: "none", outline: "none",
                transition: "border-color .15s",
              }}
              onFocus={e => e.target.style.borderColor = T.accent}
              onBlur={e => {
                e.target.style.borderColor = T.border;
                if (notesDirty) saveNotes(notes);
              }}
            />
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginTop: 8, fontSize: 11, color: T.textMuted,
            }}>
              <span>{notes.length} caractères · {notes.split("\n").filter(l => l.trim()).length} lignes</span>
              <span>Sauvegarde automatique après 1,5 s</span>
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
