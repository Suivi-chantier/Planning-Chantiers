// ─── BULLE « MES TÂCHES » — barre todo persistante (Rénovation) ─────────────
//
// Bulle flottante déplaçable + tiroir latéral, montée à la racine de MainApp
// pour rester visible sur toutes les pages de la branche Rénovation, sur le
// modèle de la bulle « Analyses » du Dashboard Analyse. Réservée aux
// collaborateurs du bureau : ni l'Espace ouvrier ni Invest ne la montent.
//
// Contrairement à celle-ci, le contenu n'est pas une checklist statique : ce
// sont les vraies tâches de la page « Notes & To-do » (planning_config /
// bloc_todos), filtrées sur l'email du profil connecté. Chaque utilisateur ne
// voit donc QUE les tâches qui lui sont assignées.
//
// Écritures : la liste todos est un unique tableau JSON partagé. Pour ne pas
// écraser les modifications d'un collègue en cochant une case, chaque patch
// relit la valeur en base avant de la réécrire (read-modify-write).

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../supabase";
import { getBranchAccent, RADIUS } from "../constants";
import { Icon } from "../ui";
import {
  ListTodo, X, Calendar, HardHat, ChevronDown, ChevronRight,
  CircleCheck, Circle, RefreshCw, User,
} from "lucide-react";

const KEY_TODOS = "bloc_todos";

const PRIORITES = {
  haute:   { label: "Haute",   color: "#e05c5c", bg: "rgba(224,92,92,0.12)"  },
  normale: { label: "Normale", color: "#5B8AF5", bg: "rgba(91,138,245,0.12)" },
  basse:   { label: "Basse",   color: "#50c878", bg: "rgba(80,200,120,0.12)" },
};
const getPrio = id => PRIORITES[id] || PRIORITES.normale;
const PRIO_ORDER = { haute: 0, normale: 1, basse: 2 };

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// « en retard » = date limite strictement antérieure à aujourd'hui.
const estEnRetard = t => !t.fait && !!t.date_limite && t.date_limite < todayISO();
const estPourAujourdhui = t => !t.fait && t.date_limite === todayISO();

// Un thème clair (espace ouvrier) rend l'accent jaune illisible en texte sur
// fond blanc : on l'assombrit alors pour le texte, pas pour les aplats.
const luminance = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const assombrir = (hex, facteur = 0.6) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = v => Math.round(v * facteur).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

const fmtDate = iso => {
  if (!iso) return "";
  const [y, m, j] = iso.split("-");
  if (!y || !m || !j) return iso;
  return new Date(Number(y), Number(m) - 1, Number(j))
    .toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
};

// ─── UNE TÂCHE DANS LE TIROIR ────────────────────────────────────────────────
function LigneTache({ todo, T, acc, accentTexte, onToggle, onToggleSousTache }) {
  const [ouvert, setOuvert] = useState(false);
  const prio = getPrio(todo.priorite);
  const retard = estEnRetard(todo);
  const aujourdhui = estPourAujourdhui(todo);
  const sousTaches = Array.isArray(todo.sous_taches) ? todo.sous_taches : [];
  const stFaites = sousTaches.filter(st => st.fait).length;

  const couleurDate = retard ? "#e05c5c" : aujourdhui ? "#ff9a4d" : T.textMuted;

  return (
    <div style={{
      border: `1px solid ${retard ? "rgba(224,92,92,0.35)" : T.border}`,
      borderLeft: `3px solid ${todo.fait ? "rgba(52,209,136,0.5)" : prio.color}`,
      borderRadius: RADIUS.lg,
      background: todo.fait ? "rgba(52,209,136,0.06)" : retard ? "rgba(224,92,92,0.05)" : "rgba(255,255,255,0.025)",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
        <button
          onClick={() => onToggle(todo)}
          title={todo.fait ? "Rouvrir la tâche" : "Marquer comme terminée"}
          style={{
            background: "transparent", border: "none", cursor: "pointer", padding: 0,
            color: todo.fait ? "#34d188" : T.textMuted, display: "flex", flexShrink: 0, marginTop: 1,
          }}>
          <Icon as={todo.fait ? CircleCheck : Circle} size={19} strokeWidth={2}/>
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, lineHeight: 1.4, fontWeight: 600,
            color: todo.fait ? T.textMuted : T.text,
            textDecoration: todo.fait ? "line-through" : "none",
            wordBreak: "break-word",
          }}>{todo.texte}</div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
              color: prio.color, background: prio.bg, padding: "2px 7px", borderRadius: RADIUS.pill,
            }}>{prio.label}</span>

            {todo.date_limite && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 700, color: couleurDate,
              }}>
                <Icon as={Calendar} size={11}/>
                {fmtDate(todo.date_limite)}{retard ? " · en retard" : aujourdhui ? " · aujourd'hui" : ""}
              </span>
            )}

            {todo.chantier_nom && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 700, color: todo.chantier_couleur || T.textSub,
              }}>
                <Icon as={HardHat} size={11}/>{todo.chantier_nom}
              </span>
            )}

            {todo.created_by_nom && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                fontSize: 10, fontWeight: 600, color: T.textMuted,
              }}>
                <Icon as={User} size={11}/>{todo.created_by_nom}
              </span>
            )}
          </div>

          {sousTaches.length > 0 && (
            <button onClick={() => setOuvert(o => !o)} style={{
              marginTop: 8, background: "transparent", border: "none", padding: 0, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4,
              color: accentTexte, fontFamily: "inherit", fontSize: 10, fontWeight: 800,
            }}>
              <Icon as={ouvert ? ChevronDown : ChevronRight} size={12}/>
              {stFaites}/{sousTaches.length} sous-tâche{sousTaches.length > 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>

      {ouvert && sousTaches.length > 0 && (
        <div style={{
          padding: "0 12px 10px 40px", display: "flex", flexDirection: "column", gap: 5,
        }}>
          {sousTaches.map(st => (
            <button key={st.id} onClick={() => onToggleSousTache(todo, st.id)} style={{
              display: "flex", alignItems: "flex-start", gap: 8, textAlign: "left",
              background: "transparent", border: "none", padding: "2px 0", cursor: "pointer",
              fontFamily: "inherit",
            }}>
              <Icon as={st.fait ? CircleCheck : Circle} size={14} strokeWidth={2}
                style={{ color: st.fait ? "#34d188" : T.textMuted, flexShrink: 0, marginTop: 1 }}/>
              <span style={{
                fontSize: 12, lineHeight: 1.35,
                color: st.fait ? T.textMuted : T.textSub,
                textDecoration: st.fait ? "line-through" : "none",
              }}>{st.texte}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── BULLE + TIROIR ──────────────────────────────────────────────────────────
// Position par défaut : au-dessus de la bulle « Analyses » du Dashboard
// Analyse (bas 24) pour ne pas la recouvrir, et au-dessus de la barre de
// navigation basse sur téléphone (~70 px).
const BAS_DEFAUT = 96;
const DROITE_DEFAUT = 24;

export default function BulleTodo({
  T,
  profil,
  branch = "renovation",
  // Optionnel : bouton « Ouvrir Notes & To-do » dans le pied du tiroir.
  onOuvrirPageTodo = null,
}) {
  const acc = getBranchAccent(branch);
  const themeClair = luminance(T?.bg) > 0.6;
  const accentTexte = themeClair ? assombrir(acc.accent, 0.62) : acc.accent;
  const monEmail = profil?.email || null;

  const [open, setOpen]       = useState(false);
  const [todos, setTodos]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet]   = useState("actif"); // actif | retard | fait
  const todosRef = useRef([]);
  useEffect(() => { todosRef.current = todos; }, [todos]);

  // ── Chargement + temps réel ───────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!monEmail) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from("planning_config").select("value").eq("key", KEY_TODOS).maybeSingle();
      setTodos(Array.isArray(data?.value) ? data.value : []);
    } catch (e) {
      console.error("BulleTodo:", e);
    }
    setLoading(false);
  }, [monEmail]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!monEmail) return;
    const ch = supabase.channel("bulle-todo-" + branch)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "planning_config", filter: `key=eq.${KEY_TODOS}` },
          () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [branch, monEmail, load]);

  // Le tiroir s'ouvre sur des données fraîches même si le temps réel a raté un
  // événement (onglet en veille, réseau coupé…).
  useEffect(() => { if (open) load(); }, [open, load]);

  // ── Écriture : relit la liste avant de la réécrire ────────────────────────
  const patchTodos = async (mapper) => {
    const optimiste = todosRef.current.map(mapper);
    setTodos(optimiste);
    try {
      const { data } = await supabase
        .from("planning_config").select("value").eq("key", KEY_TODOS).maybeSingle();
      const base = Array.isArray(data?.value) ? data.value : todosRef.current;
      const updated = base.map(mapper);
      await supabase.from("planning_config").upsert(
        { key: KEY_TODOS, value: updated, updated_at: new Date().toISOString() },
        { onConflict: "key" });
      setTodos(updated);
    } catch (e) {
      console.error("BulleTodo (sauvegarde) :", e);
      load(); // on remet l'affichage en phase avec la base
    }
  };

  const toggleTodo = (todo) => patchTodos(t => t.id === todo.id ? { ...t, fait: !t.fait } : t);

  const toggleSousTache = (todo, sousTacheId) => patchTodos(t => {
    if (t.id !== todo.id || !Array.isArray(t.sous_taches)) return t;
    return { ...t, sous_taches: t.sous_taches.map(st => st.id === sousTacheId ? { ...st, fait: !st.fait } : st) };
  });

  // ── Mes tâches ────────────────────────────────────────────────────────────
  const mesTaches = useMemo(() => {
    if (!monEmail) return [];
    const cible = monEmail.toLowerCase();
    return todos.filter(t => (t.assigne_email || "").toLowerCase() === cible);
  }, [todos, monEmail]);

  const actives  = mesTaches.filter(t => !t.fait);
  const enRetard = actives.filter(estEnRetard);
  const faites   = mesTaches.filter(t => t.fait);

  const tri = (a, b) => {
    const ra = estEnRetard(a) ? 0 : 1, rb = estEnRetard(b) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const pa = PRIO_ORDER[a.priorite] ?? 1, pb = PRIO_ORDER[b.priorite] ?? 1;
    if (pa !== pb) return pa - pb;
    const da = a.date_limite || "9999-12-31", db = b.date_limite || "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (b.created_at || "").localeCompare(a.created_at || "");
  };

  const liste = (onglet === "fait" ? faites : onglet === "retard" ? enRetard : actives).slice().sort(tri);

  // ── Bulle déplaçable — position persistée en localStorage ─────────────────
  const positionKey = `profero-bulle-todo-pos-${branch}`;
  const [pos, setPos] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(positionKey) || "null");
      if (stored && typeof stored.right === "number" && typeof stored.bottom === "number") return stored;
    } catch (_e) {}
    return { right: DROITE_DEFAUT, bottom: BAS_DEFAUT };
  });
  const dragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, startPos: null });

  const onPointerDown = (e) => {
    dragState.current = {
      dragging: true, moved: false,
      startX: e.clientX, startY: e.clientY, startPos: { ...pos },
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragState.current.dragging) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (!dragState.current.moved && Math.hypot(dx, dy) > 4) dragState.current.moved = true;
    if (!dragState.current.moved) return;
    const right  = Math.max(8, Math.min(window.innerWidth  - 80, dragState.current.startPos.right  - dx));
    const bottom = Math.max(8, Math.min(window.innerHeight - 60, dragState.current.startPos.bottom - dy));
    setPos({ right, bottom });
  };
  const onPointerUp = (e) => {
    const wasMoved = dragState.current.moved;
    dragState.current.dragging = false;
    if (wasMoved) {
      try { window.localStorage.setItem(positionKey, JSON.stringify(pos)); } catch (_e) {}
    } else {
      setOpen(true); // simple clic → ouverture
    }
    dragState.current.moved = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // Pas d'email de profil → aucune tâche assignable, on ne rend rien.
  if (!monEmail) return null;

  const nbActives = actives.length;
  const nbRetard  = enRetard.length;

  const ongletBtn = (id, label, n, couleur) => (
    <button key={id} onClick={() => setOnglet(id)} style={{
      padding: "5px 11px", borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: "inherit",
      fontSize: 11, fontWeight: 800,
      border: `1.5px solid ${onglet === id ? (couleur || acc.accent) : T.border}`,
      background: onglet === id ? (couleur ? couleur + "22" : acc.bg10) : "transparent",
      color: onglet === id ? (couleur || accentTexte) : T.textSub,
    }}>{label} {n}</button>
  );

  return (
    <>
      <style>{`@keyframes bt-slide-in{from{transform:translateX(28px);opacity:.4}to{transform:none;opacity:1}}`}</style>

      {/* Bulle flottante */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Ouvrir mes tâches (bulle déplaçable)"
        title="Glisse pour déplacer · Clique pour ouvrir mes tâches"
        style={{
          position: "fixed", bottom: pos.bottom, right: pos.right, zIndex: 900,
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "12px 18px", borderRadius: 999,
          background: acc.accent, color: acc.onAccent,
          border: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 800,
          boxShadow: `0 14px 32px rgba(0,0,0,0.35), 0 0 0 2px ${acc.bg20}`,
          cursor: "grab", userSelect: "none", touchAction: "none",
        }}
      >
        <Icon as={ListTodo} size={17} strokeWidth={2.3} style={{ pointerEvents: "none" }}/>
        <span style={{ pointerEvents: "none" }}>Mes tâches</span>
        <span style={{
          fontSize: 11, fontWeight: 800, pointerEvents: "none",
          background: nbRetard > 0 ? "#e05c5c" : "rgba(0,0,0,0.12)",
          color: nbRetard > 0 ? "#fff" : acc.onAccent,
          padding: "2px 8px", borderRadius: 999,
        }}>{nbActives}</span>
      </button>

      {/* Tiroir latéral droit */}
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
          zIndex: 950, display: "flex", justifyContent: "flex-end",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: "100%", maxWidth: 440, height: "100%",
            background: T.surface, borderLeft: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column",
            boxShadow: "-20px 0 60px rgba(0,0,0,0.45)",
            animation: "bt-slide-in .22s ease-out",
          }}>
            {/* En-tête */}
            <div style={{
              padding: "16px 18px", borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: RADIUS.xl,
                background: acc.bg20, color: accentTexte,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={ListTodo} size={19} strokeWidth={2.2}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>Mes tâches</div>
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                  {nbActives} à faire{nbRetard > 0 ? ` · ${nbRetard} en retard` : ""} · {profil?.nom || monEmail}
                </div>
              </div>
              <button onClick={load} title="Rafraîchir" style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: T.textMuted, padding: 6, display: "flex",
              }}><Icon as={RefreshCw} size={15}/></button>
              <button onClick={() => setOpen(false)} title="Fermer" style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: T.textMuted, padding: 6, display: "flex",
              }}><Icon as={X} size={18}/></button>
            </div>

            {/* Filtres */}
            <div style={{
              padding: "10px 18px", borderBottom: `1px solid ${T.border}`,
              display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0,
            }}>
              {ongletBtn("actif",  "À faire",   nbActives)}
              {ongletBtn("retard", "En retard", nbRetard, "#e05c5c")}
              {ongletBtn("fait",   "Terminées", faites.length, "#34d188")}
            </div>

            {/* Liste */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
              {loading ? (
                <div style={{ color: T.textMuted, fontSize: 13, textAlign: "center", padding: "30px 0" }}>Chargement…</div>
              ) : liste.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 10px", color: T.textMuted }}>
                  <div style={{ fontSize: 30, marginBottom: 10 }}>{onglet === "fait" ? "🗂️" : "🎉"}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.textSub }}>
                    {onglet === "fait"   ? "Aucune tâche terminée"
                     : onglet === "retard" ? "Aucune tâche en retard"
                     : "Aucune tâche assignée"}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
                    Seules les tâches qui vous sont attribuées dans « Notes &amp; To-do » apparaissent ici.
                  </div>
                </div>
              ) : liste.map(t => (
                <LigneTache key={t.id} todo={t} T={T} acc={acc} accentTexte={accentTexte}
                  onToggle={toggleTodo} onToggleSousTache={toggleSousTache}/>
              ))}
            </div>

            {onOuvrirPageTodo && (
              <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                <button onClick={() => { setOpen(false); onOuvrirPageTodo(); }} style={{
                  width: "100%", padding: "10px", borderRadius: RADIUS.lg, cursor: "pointer",
                  border: `1px solid ${acc.border}`, background: acc.bg10, color: accentTexte,
                  fontFamily: "inherit", fontSize: 12, fontWeight: 800,
                }}>Ouvrir Notes &amp; To-do</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
