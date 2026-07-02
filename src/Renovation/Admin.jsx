import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, LOTS_DEFAUT, TAUX_MO_PREV_DEFAUT } from "../constants";
import { Icon } from "../ui";
import {
  Settings, Users, HardHat, Euro, Building2, Image as ImageIcon, Palette,
  Plus, Trash2, Pencil, Check, X, ChevronUp, ChevronDown, Search, Mail,
  KeyRound, AlertTriangle, RefreshCw, Moon, Sun, Info, Send, UserPlus,
  LayoutDashboard, Database, Briefcase, MessageSquare, Clock, Wrench,
  Download, ClipboardCheck, FileText, Activity, ChevronRight, Truck, Lock,
  Boxes, Car, Eye,
} from "lucide-react";
import {
  loadAccessConfig, saveAccessConfig, pagesForBranch,
  ROLES_DEFAULT_RENOVATION, ROLES_DEFAULT_INVEST,
  ROLE_PAGES_DEFAULT_RENOVATION, ROLE_PAGES_DEFAULT_INVEST,
} from "../access";
import EspaceOuvrier from "./EspaceOuvrier";

// ─── APPEL EDGE FUNCTION ──────────────────────────────────────────────────────
const callAdminUsers = async (payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session?.access_token}`,
        "apikey": import.meta.env.VITE_SUPABASE_KEY,
      },
      body: JSON.stringify(payload),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
};

// ─── ONGLET UTILISATEURS ──────────────────────────────────────────────────────
function OngletUtilisateurs({ T, acc }) {
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [erreur, setErreur]             = useState("");
  const [succes, setSucces]             = useState("");

  // Recherche/filtre
  const [searchUser, setSearchUser] = useState("");
  const [filterRole, setFilterRole] = useState("all");

  // Formulaire invitation
  const [showForm, setShowForm]       = useState(false);
  const [invEmail, setInvEmail]       = useState("");
  const [invNom, setInvNom]           = useState("");
  const [invRole, setInvRole]         = useState("conducteur");
  const [invBranches, setInvBranches] = useState(["renovation"]);
  const [invLoading, setInvLoading]   = useState(false);
  // Prénom-planning : clé de jointure compte ↔ planning, requise pour le rôle ouvrier.
  const [invPrenomPlanning, setInvPrenomPlanning] = useState("");
  // Liste des prénoms (config Admin "ouvriers") pour le sélecteur ouvrier.
  const [ouvriersConfig, setOuvriersConfig] = useState(DEFAULT_OUVRIERS);
  // Bascule : afficher un bandeau "connectez-vous" sur le formulaire public.
  const [espaceActif, setEspaceActif] = useState(false);
  const [bascLoading, setBascLoading] = useState(false);
  // Aperçu "vue collaborateur"
  const [previewSel, setPreviewSel]       = useState("");
  const [previewOuvrier, setPreviewOuvrier] = useState(null);

  // Édition
  const [editId, setEditId]   = useState(null);
  const [editData, setEditData] = useState({});

  // Confirmation reset
  const [resetId, setResetId]   = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Liste de rôles chargée dynamiquement depuis access.js (union Réno + Invest).
  // Si un rôle existe dans les 2 branches, on garde la déclaration Réno (libellé + couleur).
  const [ROLES, setROLES] = useState([
    { value:"admin",      label:"Administrateur" },
    { value:"conducteur", label:"Conducteur de travaux" },
    { value:"commercial", label:"Commercial" },
    { value:"comptable",  label:"Comptable" },
  ]);
  const [ROLE_LABELS, setRoleLabels] = useState({ admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" });
  const [ROLE_COLORS, setRoleColors] = useState({ admin:"#FFC200", conducteur:"#50c878", commercial:"#4db8ff", comptable:"#c084fc" });
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadAccessConfig("renovation"), loadAccessConfig("invest")]).then(([reno, inv]) => {
      if (cancelled) return;
      const seen = new Map();
      // Réno en premier pour qu'elle gagne en cas de doublon
      for (const r of reno.roles) if (!seen.has(r.id)) seen.set(r.id, r);
      for (const r of inv.roles)  if (!seen.has(r.id)) seen.set(r.id, r);
      const arr = Array.from(seen.values());
      setROLES(arr.map(r => ({ value: r.id, label: r.label })));
      setRoleLabels(Object.fromEntries(arr.map(r => [r.id, r.label])));
      setRoleColors(Object.fromEntries(arr.map(r => [r.id, r.color])));
    });
    return () => { cancelled = true; };
  }, []);
  const BRANCHES = [
    { value:"renovation", label:"Rénovation" },
    { value:"invest",     label:"Invest" },
  ];
  const BRANCHE_LABELS = { renovation:"Rénovation", invest:"Invest" };

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("utilisateurs").select("*").order("nom");
    setUtilisateurs(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  // Charge la liste des prénoms-planning depuis la config (onglet Ouvriers).
  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "ouvriers").single()
      .then(({ data }) => { if (Array.isArray(data?.value) && data.value.length) setOuvriersConfig(data.value); });
    supabase.from("planning_config").select("value").eq("key", "espace_ouvrier_actif").maybeSingle()
      .then(({ data }) => setEspaceActif(data?.value === true));
  }, []);

  // Active/désactive le bandeau d'invitation sur le formulaire public.
  const toggleEspace = async () => {
    const next = !espaceActif;
    setBascLoading(true);
    const { error } = await supabase.from("planning_config")
      .upsert({ key: "espace_ouvrier_actif", value: next }, { onConflict: "key" });
    setBascLoading(false);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    setEspaceActif(next);
    flash("ok", next
      ? "Bandeau d'invitation activé sur le formulaire public."
      : "Bandeau d'invitation désactivé.");
  };

  const flash = (type, msg) => {
    if (type === "ok") { setSucces(msg); setErreur(""); setTimeout(() => setSucces(""), 4000); }
    else               { setErreur(msg); setSucces(""); setTimeout(() => setErreur(""), 5000); }
  };

  const toggleBranche = (branches, val) =>
    branches.includes(val) ? branches.filter(b => b !== val) : [...branches, val];

  // ── Inviter ────────────────────────────────────────────────────────────────
  const inviter = async () => {
    if (!invEmail.trim() || !invNom.trim()) { flash("err", "Email et nom sont obligatoires."); return; }
    if (invBranches.length === 0) { flash("err", "Sélectionnez au moins une branche."); return; }
    // Pour un ouvrier, le prénom-planning est obligatoire (clé de jointure).
    const prenomPlanning = invRole === "ouvrier" ? invPrenomPlanning.trim() : null;
    if (invRole === "ouvrier" && !prenomPlanning) {
      flash("err", "Sélectionnez le prénom-planning de l'ouvrier.");
      return;
    }
    setInvLoading(true);
    try {
      // 1. Vérifier doublon email
      const { data: exist } = await supabase
        .from("utilisateurs").select("id").eq("email", invEmail.trim().toLowerCase()).single();
      if (exist) { flash("err", "Cet email est déjà enregistré."); setInvLoading(false); return; }

      // 1b. Un prénom-planning = une personne : refuser s'il est déjà relié.
      if (prenomPlanning && utilisateurs.some(u => u.prenom_planning === prenomPlanning)) {
        flash("err", `Le prénom-planning « ${prenomPlanning} » est déjà relié à un compte.`);
        setInvLoading(false); return;
      }

      // 2. Envoyer invitation Supabase Auth via Edge Function
      await callAdminUsers({ action: "invite", email: invEmail.trim().toLowerCase() });

      // 3. Créer la ligne profil
      const { error: dbErr } = await supabase.from("utilisateurs").insert({
        email:    invEmail.trim().toLowerCase(),
        nom:      invNom.trim(),
        role:     invRole,
        branches: invBranches,
        actif:    true,
        ...(prenomPlanning ? { prenom_planning: prenomPlanning } : {}),
      });
      if (dbErr) {
        // 23505 = violation d'unicité (index prenom_planning) → message clair.
        const msg = dbErr.code === "23505" && /prenom_planning/.test(dbErr.message || "")
          ? `Le prénom-planning « ${prenomPlanning} » est déjà relié à un compte.`
          : "Profil non créé : " + dbErr.message;
        flash("err", msg); setInvLoading(false); return;
      }

      flash("ok", `✓ Invitation envoyée à ${invEmail}. ${invNom} recevra un email pour créer son mot de passe.`);
      setInvEmail(""); setInvNom(""); setInvRole("conducteur"); setInvBranches(["renovation"]); setInvPrenomPlanning("");
      setShowForm(false);
      charger();
    } catch (e) {
      flash("err", "Erreur : " + e.message);
    }
    setInvLoading(false);
  };

  // ── Modifier ───────────────────────────────────────────────────────────────
  const sauvegarder = async (id) => {
    if (!editData.nom?.trim()) { flash("err", "Le nom est obligatoire."); return; }
    if (!editData.branches || editData.branches.length === 0) { flash("err", "Au moins une branche obligatoire."); return; }
    const { error } = await supabase.from("utilisateurs")
      .update({ nom: editData.nom.trim(), role: editData.role, branches: editData.branches })
      .eq("id", id);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    flash("ok", "✓ Modifications enregistrées.");
    setEditId(null);
    charger();
  };

  // ── Activer / désactiver ───────────────────────────────────────────────────
  const toggleActif = async (u) => {
    const { error } = await supabase.from("utilisateurs")
      .update({ actif: !u.actif }).eq("id", u.id);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    flash("ok", u.actif ? `✓ ${u.nom} désactivé(e).` : `✓ ${u.nom} réactivé(e).`);
    charger();
  };

  // ── Réinitialiser mot de passe ─────────────────────────────────────────────
  const resetPassword = async () => {
    setResetLoading(true);
    try {
      await callAdminUsers({ action: "reset_password", email: resetEmail });
      flash("ok", `✓ Email de réinitialisation envoyé à ${resetEmail}.`);
      setResetId(null); setResetEmail("");
    } catch (e) {
      flash("err", "Erreur : " + e.message);
    }
    setResetLoading(false);
  };

  // Filtrage
  const utilisateursFiltres = utilisateurs.filter(u => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (searchUser.trim()) {
      const q = searchUser.toLowerCase();
      if (!(`${u.nom||""} ${u.email||""}`).toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const statsRoles = ROLES.reduce((acc, r) => { acc[r.value] = utilisateurs.filter(u=>u.role===r.value).length; return acc; }, {});

  return (
    <div className="ac">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:FONT.md.size, marginBottom:4, color:T.text }}>Collaborateurs</div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1 }}>
            Invitez et gérez les accès, rôles et branches de chaque collaborateur.
          </div>
        </div>
        <button onClick={() => { setShowForm(!showForm); setErreur(""); }} style={{
          display:"inline-flex", alignItems:"center", gap:6,
          background:showForm?"transparent":acc.accent, color:showForm?T.textSub:acc.onAccent,
          border:showForm?`1px solid ${T.border}`:"none",
          borderRadius:RADIUS.md, padding:"9px 16px",
          fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor:"pointer",
        }}>
          <Icon as={showForm?X:UserPlus} size={13}/>
          {showForm ? "Annuler" : "Inviter un collaborateur"}
        </button>
      </div>

      {/* ── Bascule espace ouvrier ── */}
      <div style={{
        background:T.card, border:`1px solid ${espaceActif ? "rgba(80,200,120,0.4)" : T.border}`,
        borderRadius:12, padding:"14px 16px", margin:"14px 0",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:14, flexWrap:"wrap",
      }}>
        <div style={{ flex:"1 1 260px", minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:FONT.sm.size+1, color:T.text, marginBottom:3 }}>
            Bascule vers l'espace ouvrier
          </div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, lineHeight:1.5 }}>
            Activé, le formulaire public de compte rendu affiche un bandeau invitant les ouvriers à se connecter à leur espace.
            Le lien public reste fonctionnel — active-le seulement quand les comptes sont prêts.
          </div>
        </div>
        <button onClick={toggleEspace} disabled={bascLoading} title={espaceActif ? "Désactiver" : "Activer"} style={{
          flexShrink:0, width:54, height:30, borderRadius:999, border:"none", cursor: bascLoading ? "wait" : "pointer",
          background: espaceActif ? "#50c878" : T.border, position:"relative", transition:"background .2s", padding:0,
        }}>
          <span style={{
            position:"absolute", top:3, left: espaceActif ? 27 : 3, width:24, height:24, borderRadius:"50%",
            background:"#fff", boxShadow:"0 1px 3px rgba(0,0,0,0.3)", transition:"left .2s",
          }}/>
        </button>
      </div>

      {/* ── Aperçu de la vue collaborateur (lecture seule) ── */}
      <div style={{
        background:T.card, border:`1px solid ${T.border}`,
        borderRadius:12, padding:"14px 16px", margin:"14px 0",
        display:"flex", alignItems:"center", justifyContent:"space-between", gap:14, flexWrap:"wrap",
      }}>
        <div style={{ flex:"1 1 240px", minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:FONT.sm.size+1, color:T.text, marginBottom:3, display:"flex", alignItems:"center", gap:7 }}>
            <Icon as={Eye} size={15}/> Voir la vue d'un collaborateur
          </div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, lineHeight:1.5 }}>
            Prévisualise l'espace ouvrier tel qu'il le voit (planning, tableau de bord…). Lecture seule.
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
          <select value={previewSel} onChange={e=>setPreviewSel(e.target.value)} style={{
            background:T.fieldBg||T.card, border:`1px solid ${T.fieldBorder||T.border}`,
            borderRadius:RADIUS.md, padding:"8px 10px", color:T.text, fontFamily:"inherit", fontSize:FONT.sm.size, outline:"none", cursor:"pointer",
          }}>
            <option value="">— Choisir un ouvrier —</option>
            {(ouvriersConfig || []).filter(Boolean).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={()=>previewSel && setPreviewOuvrier(previewSel)} disabled={!previewSel} style={{
            background: previewSel ? acc.accent : T.border, color: previewSel ? acc.onAccent : T.textMuted,
            border:"none", borderRadius:RADIUS.md, padding:"8px 14px",
            fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor: previewSel ? "pointer" : "not-allowed",
            display:"inline-flex", alignItems:"center", gap:6, flexShrink:0,
          }}>
            <Icon as={Eye} size={14}/> Aperçu
          </button>
        </div>
      </div>

      {/* Overlay plein écran de l'aperçu */}
      {previewOuvrier && (
        <div style={{ position:"fixed", inset:0, zIndex:1400, overflowY:"auto", background:"#f4f6fa" }}>
          <EspaceOuvrier profil={{ prenom_planning: previewOuvrier }} preview onLogout={()=>setPreviewOuvrier(null)} />
        </div>
      )}

      {/* Recherche + filtre */}
      {utilisateurs.length > 0 && (
        <div style={{
          display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
          marginTop:14, background:T.surface, border:`1px solid ${T.border}`,
          borderRadius:RADIUS.lg, padding:"8px 10px",
        }}>
          <div style={{position:"relative", flex:"1 1 200px", maxWidth:320}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
            <input value={searchUser} onChange={e=>setSearchUser(e.target.value)} placeholder="Rechercher un nom ou un email…"
              style={{
                width:"100%", background:T.fieldBg||T.card, border:`1px solid ${T.fieldBorder||T.border}`,
                borderRadius:RADIUS.md, padding:"7px 10px 7px 28px", color:T.text,
                fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none",
              }}/>
          </div>
          <select value={filterRole} onChange={e=>setFilterRole(e.target.value)} style={{
            background:T.fieldBg||T.card, border:`1px solid ${T.fieldBorder||T.border}`,
            borderRadius:RADIUS.md, padding:"7px 10px", color:T.text,
            fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none", cursor:"pointer",
          }}>
            <option value="all">Tous les rôles ({utilisateurs.length})</option>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label} ({statsRoles[r.value]||0})</option>)}
          </select>
          <div style={{marginLeft:"auto", fontSize:FONT.xs.size+1, color:T.textMuted, fontWeight:600}}>
            {utilisateursFiltres.length} / {utilisateurs.length}
          </div>
        </div>
      )}

      {/* Messages */}
      {succes && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#22c55e", margin:"12px 0", lineHeight:1.6,
        }}>
          <Icon as={Check} size={13}/>
          <span>{succes.replace(/^✓ /, "")}</span>
        </div>
      )}
      {erreur && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#e15a5a", margin:"12px 0",
        }}>
          <Icon as={AlertTriangle} size={13}/>
          {erreur}
        </div>
      )}

      {/* ── Formulaire invitation ── */}
      {showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px", margin:"16px 0" }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16, color:T.text }}>
            Nouveau collaborateur
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Nom complet *</label>
              <input className="ti" value={invNom} onChange={e=>setInvNom(e.target.value)} placeholder="Prénom Nom" style={{ width:"100%" }}/>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Email *</label>
              <input className="ti" type="email" value={invEmail} onChange={e=>setInvEmail(e.target.value)} placeholder="prenom.nom@profero.fr" style={{ width:"100%" }}/>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Rôle</label>
              <select className="ti" value={invRole} onChange={e=>setInvRole(e.target.value)} style={{ width:"100%" }}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Accès branches</label>
              <div style={{ display:"flex", gap:8 }}>
                {BRANCHES.map(b => (
                  <button key={b.value}
                    onClick={() => setInvBranches(toggleBranche(invBranches, b.value))}
                    style={{
                      flex:1, padding:"8px 0", borderRadius:8, border:"1.5px solid",
                      fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer",
                      background: invBranches.includes(b.value) ? "rgba(255,194,0,0.12)" : "transparent",
                      borderColor: invBranches.includes(b.value) ? "#FFC200" : T.border,
                      color: invBranches.includes(b.value) ? "#FFC200" : T.textSub,
                    }}>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Prénom-planning : requis pour relier un compte ouvrier au planning */}
          {invRole === "ouvrier" && (
            <div style={{ marginBottom:12 }}>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Prénom-planning *</label>
              <select className="ti" value={invPrenomPlanning} onChange={e=>setInvPrenomPlanning(e.target.value)} style={{ width:"100%" }}>
                <option value="">— Sélectionner —</option>
                {ouvriersConfig.map(o => {
                  const pris = utilisateurs.some(u => u.prenom_planning === o);
                  return <option key={o} value={o} disabled={pris}>{o}{pris ? " (déjà relié)" : ""}</option>;
                })}
              </select>
              <div style={{ fontSize:FONT.xs.size, color:T.textSub, marginTop:6, lineHeight:1.5 }}>
                Relie ce compte à son prénom exact dans le planning et les comptes rendus — indispensable pour que l'ouvrier voie ses chantiers.
              </div>
            </div>
          )}

          {/* Info invitation */}
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.xs.size+1, color:"#4db8ff", marginBottom:16, lineHeight:1.6 }}>
            <Icon as={Mail} size={13} style={{marginTop:2, flexShrink:0}}/>
            <span>Un email d'invitation sera envoyé à <strong>{invEmail || "l'adresse saisie"}</strong>. Le collaborateur cliquera sur le lien pour définir son mot de passe et accéder à l'application.</span>
          </div>

          <button className="btn-p" onClick={inviter} disabled={invLoading} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", padding:"11px" }}>
            <Icon as={Send} size={13}/>
            {invLoading ? "Envoi de l'invitation…" : "Envoyer l'invitation"}
          </button>
        </div>
      )}

      {/* ── Liste ── */}
      {loading ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, padding:"20px 0", textAlign:"center" }}>Chargement…</div>
      ) : utilisateurs.length === 0 ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, fontStyle:"italic", padding:"20px 0" }}>Aucun collaborateur enregistré.</div>
      ) : utilisateursFiltres.length === 0 ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, fontStyle:"italic", padding:"20px 0" }}>Aucun collaborateur ne correspond à ces filtres.</div>
      ) : (
        <div style={{ marginTop:16 }}>
          {utilisateursFiltres.map(u => (
            <div key={u.id} className="ar" style={{ flexDirection:"column", alignItems:"stretch", gap:0, padding:"14px 0" }}>
              {editId === u.id ? (
                /* Mode édition */
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div>
                      <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:5 }}>Nom</label>
                      <input className="ti" value={editData.nom} onChange={e=>setEditData({...editData,nom:e.target.value})} style={{width:"100%"}}/>
                    </div>
                    <div>
                      <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:5 }}>Rôle</label>
                      <select className="ti" value={editData.role} onChange={e=>setEditData({...editData,role:e.target.value})} style={{width:"100%"}}>
                        {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:5 }}>Branches</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {BRANCHES.map(b => (
                        <button key={b.value}
                          onClick={() => setEditData({...editData, branches: toggleBranche(editData.branches||[], b.value)})}
                          style={{
                            padding:"7px 18px", borderRadius:8, border:"1.5px solid",
                            fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer",
                            background: (editData.branches||[]).includes(b.value) ? "rgba(255,194,0,0.12)" : "transparent",
                            borderColor: (editData.branches||[]).includes(b.value) ? "#FFC200" : T.border,
                            color: (editData.branches||[]).includes(b.value) ? "#FFC200" : T.textSub,
                          }}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button className="btn-p" style={{ fontSize:FONT.sm.size, padding:"7px 16px", display:"inline-flex", alignItems:"center", gap:5 }} onClick={() => sauvegarder(u.id)}>
                      <Icon as={Check} size={12}/>
                      Enregistrer
                    </button>
                    <button className="btn-g" style={{ fontSize:FONT.sm.size, padding:"7px 16px" }} onClick={() => setEditId(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                /* Mode lecture */
                <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  {/* Avatar */}
                  <div style={{
                    width:38, height:38, borderRadius:10, flexShrink:0,
                    background:`${(ROLE_COLORS[u.role] || "#888888")}22`, border:`1.5px solid ${(ROLE_COLORS[u.role] || "#888888")}55`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:14, fontWeight:800, color:(ROLE_COLORS[u.role] || "#888888"),
                  }}>
                    {u.nom?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                  </div>

                  {/* Infos */}
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, fontSize:15, color: u.actif ? T.text : T.textMuted }}>
                        {u.nom}
                      </span>
                      {!u.actif && (
                        <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4, background:"rgba(224,92,92,0.12)", color:"#e05c5c", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>
                          Désactivé
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>{u.email}</div>
                    <div style={{ display:"flex", gap:6, marginTop:5, flexWrap:"wrap" }}>
                      <span style={{
                        fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:700, letterSpacing:.5,
                        background:`${(ROLE_COLORS[u.role] || "#888888")}18`, color:(ROLE_COLORS[u.role] || "#888888"),
                        border:`1px solid ${(ROLE_COLORS[u.role] || "#888888")}33`,
                      }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                      {(u.branches||["renovation"]).map(b => (
                        <span key={b} style={{
                          fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:600,
                          background:"rgba(255,255,255,0.05)", color:T.textSub,
                          border:`1px solid ${T.border}`,
                        }}>
                          {BRANCHE_LABELS[b] || b}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                    <button className="btn-g" style={{ fontSize:FONT.xs.size+1, padding:"5px 12px", display:"inline-flex", alignItems:"center", gap:4 }}
                      onClick={() => { setEditId(u.id); setEditData({ nom:u.nom, role:u.role, branches:u.branches||["renovation"] }); }}>
                      <Icon as={Pencil} size={11}/>
                      Modifier
                    </button>
                    <button
                      onClick={() => { setResetId(u.id); setResetEmail(u.email); }}
                      style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        fontSize:FONT.xs.size+1, padding:"5px 12px", border:"1px solid rgba(77,184,255,0.3)",
                        borderRadius:RADIUS.sm, cursor:"pointer", fontFamily:"inherit", fontWeight:600,
                        background:"rgba(77,184,255,0.08)", color:"#4db8ff",
                      }}>
                      <Icon as={KeyRound} size={11}/>
                      Réinit. MDP
                    </button>
                    <button
                      onClick={() => toggleActif(u)}
                      style={{
                        fontSize:12, padding:"5px 12px", border:"1px solid", borderRadius:6,
                        cursor:"pointer", fontFamily:"inherit", fontWeight:600,
                        background: u.actif ? "rgba(224,92,92,0.08)" : "rgba(80,200,120,0.08)",
                        borderColor: u.actif ? "rgba(224,92,92,0.3)" : "rgba(80,200,120,0.3)",
                        color: u.actif ? "#e05c5c" : "#50c878",
                      }}>
                      {u.actif ? "Désactiver" : "Réactiver"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Modal confirmation reset MDP ── */}
      {resetId && (
        <div onClick={()=>!resetLoading&&setResetId(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:16, backdropFilter:"blur(4px)" }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl,
            padding:24, width:"100%", maxWidth:420,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{
                width:40, height:40, borderRadius:RADIUS.md, flexShrink:0,
                background:"rgba(77,184,255,0.16)", color:"#4db8ff",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon as={KeyRound} size={20}/>
              </div>
              <div style={{ fontSize:FONT.lg.size, fontWeight:800, color:T.text }}>
                Réinitialiser le mot de passe&nbsp;?
              </div>
            </div>
            <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:20 }}>
              Un email de réinitialisation sera envoyé à <strong style={{color:"#4db8ff"}}>{resetEmail}</strong>.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => { setResetId(null); setResetEmail(""); }} disabled={resetLoading}
                style={{ background:"transparent", border:`1px solid ${T.border}`,
                  borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
                  fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer", opacity:resetLoading?.5:1 }}>
                Annuler
              </button>
              <button onClick={resetPassword} disabled={resetLoading} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#4db8ff", color:"#fff", border:"none",
                borderRadius:RADIUS.md, padding:"9px 18px",
                fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800,
                cursor:"pointer", opacity:resetLoading?.6:1,
              }}>
                <Icon as={Send} size={13}/>
                {resetLoading ? "Envoi…" : "Envoyer l'email"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"flex", alignItems:"flex-start", gap:8, marginTop:16, padding:"12px 14px", background:T.card, borderRadius:RADIUS.md, fontSize:FONT.xs.size+1, color:T.textMuted, lineHeight:1.6 }}>
        <Icon as={Info} size={13} style={{marginTop:2, flexShrink:0}}/>
        <span>Les collaborateurs désactivés ne peuvent plus se connecter mais leurs données sont conservées. Pour supprimer définitivement un compte Auth, rendez-vous dans <strong style={{color:T.textSub}}>Supabase → Authentication → Users</strong>.</span>
      </div>
    </div>
  );
}

// ─── ONGLET FOURNISSEURS ──────────────────────────────────────────────────────
const MAIL_TYPE_DEFAUT =
  "Bonjour,\n\nDans le cadre du chantier {chantier} (phase : {phase}), nous souhaitons passer la commande suivante pour le {date_besoin} :\n\n{liste_articles}\n\nTotal HT estimé : {total_ht} €\n\nCordialement,\nProfero Rénovation";

const FOURNISSEUR_VARIABLES = ["{chantier}", "{phase}", "{liste_articles}", "{date_besoin}", "{total_ht}"];

function OngletFournisseurs({ T, acc }) {
  const [fournisseurs, setFournisseurs] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [editId, setEditId]             = useState(null);
  const [draft, setDraft]               = useState({ nom: "", email: "", mail_type: MAIL_TYPE_DEFAUT });
  const [showForm, setShowForm]         = useState(false);
  const [toDelete, setToDelete]         = useState(null);
  const [succes, setSucces]             = useState("");
  const [erreur, setErreur]             = useState("");
  const [saving, setSaving]             = useState(false);
  const [search, setSearch]             = useState("");

  const flash = (type, msg) => {
    if (type === "ok") { setSucces(msg); setErreur(""); setTimeout(() => setSucces(""), 3500); }
    else               { setErreur(msg); setSucces(""); setTimeout(() => setErreur(""), 5000); }
  };

  const charger = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("fournisseurs").select("*").order("nom");
    if (error) flash("err", "Chargement impossible : " + error.message);
    setFournisseurs(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const resetDraft = () => setDraft({ nom: "", email: "", mail_type: MAIL_TYPE_DEFAUT });

  const ouvrirForm = (f = null) => {
    if (f) {
      setEditId(f.id);
      setDraft({ nom: f.nom || "", email: f.email || "", mail_type: f.mail_type || MAIL_TYPE_DEFAUT });
    } else {
      setEditId(null);
      resetDraft();
    }
    setShowForm(true);
  };

  const fermerForm = () => {
    setShowForm(false);
    setEditId(null);
    resetDraft();
  };

  const enregistrer = async () => {
    if (!draft.nom.trim()) { flash("err", "Le nom du fournisseur est obligatoire."); return; }
    setSaving(true);
    const payload = {
      nom:       draft.nom.trim(),
      email:     draft.email?.trim() || null,
      mail_type: draft.mail_type?.trim() || null,
    };
    let err;
    if (editId) {
      ({ error: err } = await supabase.from("fournisseurs").update(payload).eq("id", editId));
    } else {
      ({ error: err } = await supabase.from("fournisseurs").insert(payload));
    }
    setSaving(false);
    if (err) { flash("err", "Erreur : " + err.message); return; }
    flash("ok", editId ? `✓ ${payload.nom} mis à jour.` : `✓ ${payload.nom} créé.`);
    fermerForm();
    charger();
  };

  const supprimer = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("fournisseurs").delete().eq("id", toDelete.id);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    flash("ok", `✓ ${toDelete.nom} supprimé.`);
    setToDelete(null);
    charger();
  };

  const insererVariable = (v) => {
    setDraft(p => ({ ...p, mail_type: (p.mail_type || "") + v }));
  };

  const filtres = fournisseurs.filter(f => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (f.nom || "").toLowerCase().includes(q) || (f.email || "").toLowerCase().includes(q);
  });

  return (
    <div className="ac">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:FONT.md.size, marginBottom:4, color:T.text }}>Fournisseurs</div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, lineHeight:1.6, maxWidth:560 }}>
            Annuaire des fournisseurs et modèles d'email de commande associés. Les articles de la bibliothèque matériaux peuvent être rattachés à un fournisseur.
          </div>
        </div>
        <button onClick={() => showForm ? fermerForm() : ouvrirForm()} style={{
          display:"inline-flex", alignItems:"center", gap:6,
          background: showForm ? "transparent" : acc.accent, color: showForm ? T.textSub : acc.onAccent,
          border: showForm ? `1px solid ${T.border}` : "none",
          borderRadius:RADIUS.md, padding:"9px 16px",
          fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor:"pointer",
        }}>
          <Icon as={showForm ? X : Plus} size={13}/>
          {showForm ? "Annuler" : "Nouveau fournisseur"}
        </button>
      </div>

      {/* Recherche */}
      {fournisseurs.length > 0 && !showForm && (
        <div style={{
          display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
          marginTop:14, background:T.surface, border:`1px solid ${T.border}`,
          borderRadius:RADIUS.lg, padding:"8px 10px",
        }}>
          <div style={{position:"relative", flex:"1 1 200px", maxWidth:320}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un fournisseur…"
              style={{
                width:"100%", background:T.fieldBg||T.card, border:`1px solid ${T.fieldBorder||T.border}`,
                borderRadius:RADIUS.md, padding:"7px 10px 7px 28px", color:T.text,
                fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none",
              }}/>
          </div>
          <div style={{marginLeft:"auto", fontSize:FONT.xs.size+1, color:T.textMuted, fontWeight:600}}>
            {filtres.length} / {fournisseurs.length}
          </div>
        </div>
      )}

      {/* Messages */}
      {succes && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#22c55e", margin:"12px 0", lineHeight:1.6,
        }}>
          <Icon as={Check} size={13}/>
          <span>{succes.replace(/^✓ /, "")}</span>
        </div>
      )}
      {erreur && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#e15a5a", margin:"12px 0",
        }}>
          <Icon as={AlertTriangle} size={13}/>
          {erreur}
        </div>
      )}

      {/* Formulaire création / édition */}
      {showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px", margin:"16px 0" }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16, color:T.text }}>
            {editId ? "Modifier le fournisseur" : "Nouveau fournisseur"}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Nom *</label>
              <input className="ti" value={draft.nom} onChange={e=>setDraft(p=>({...p,nom:e.target.value}))}
                placeholder="Ex : Point P, Leroy Merlin…" style={{ width:"100%" }}/>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Email</label>
              <input className="ti" type="email" value={draft.email} onChange={e=>setDraft(p=>({...p,email:e.target.value}))}
                placeholder="commandes@fournisseur.fr" style={{ width:"100%" }}/>
            </div>
          </div>

          <div style={{ marginBottom:12 }}>
            <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Modèle de mail de commande</label>
            <textarea className="ti" value={draft.mail_type} onChange={e=>setDraft(p=>({...p,mail_type:e.target.value}))}
              rows={10} placeholder="Corps du mail envoyé au fournisseur…"
              style={{ width:"100%", resize:"vertical", fontFamily:"inherit", lineHeight:1.5 }}/>
          </div>

          <div style={{ display:"flex", alignItems:"flex-start", gap:8, padding:"10px 12px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.md, marginBottom:16 }}>
            <Icon as={Info} size={12} color={T.textMuted} style={{marginTop:2, flexShrink:0}}/>
            <div style={{ flex:1, fontSize:FONT.xs.size+1, color:T.textMuted, lineHeight:1.6 }}>
              Variables disponibles (cliquer pour insérer)&nbsp;:&nbsp;
              {FOURNISSEUR_VARIABLES.map(v => (
                <button key={v} type="button" onClick={()=>insererVariable(v)} style={{
                  display:"inline-block", padding:"1px 8px", borderRadius:RADIUS.sm, marginRight:4, marginBottom:4,
                  background:acc.bg10, color:acc.accent, fontFamily:"monospace", fontSize:FONT.xs.size, fontWeight:700,
                  border:`1px solid ${acc.accent}33`, cursor:"pointer",
                }}>{v}</button>
              ))}
            </div>
          </div>

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button onClick={fermerForm} disabled={saving} style={{
              background:"transparent", border:`1px solid ${T.border}`,
              borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
              fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer", opacity:saving?.5:1,
            }}>Annuler</button>
            <button onClick={enregistrer} disabled={saving || !draft.nom.trim()} style={{
              display:"inline-flex", alignItems:"center", gap:6,
              background: draft.nom.trim() ? acc.accent : T.border,
              color: draft.nom.trim() ? acc.onAccent : T.textMuted,
              border:"none", borderRadius:RADIUS.md, padding:"9px 18px",
              fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800,
              cursor: draft.nom.trim() && !saving ? "pointer" : "not-allowed",
              opacity:saving?.6:1,
            }}>
              <Icon as={Check} size={13}/>
              {saving ? "Enregistrement…" : (editId ? "Modifier" : "Créer")}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, padding:"20px 0", textAlign:"center" }}>Chargement…</div>
      ) : fournisseurs.length === 0 ? (
        <div style={{
          background:T.card, border:`1px dashed ${T.border}`,
          borderRadius:RADIUS.xl, padding:"40px 24px", textAlign:"center", color:T.textSub, marginTop:16,
        }}>
          <div style={{
            width:48,height:48,borderRadius:RADIUS.lg,
            background:acc.bg10,color:acc.accent,
            display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12,
          }}>
            <Icon as={Truck} size={24} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun fournisseur</div>
          <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6,marginBottom:16}}>
            Créez un fournisseur pour pouvoir le rattacher aux articles de la bibliothèque matériaux.
          </div>
        </div>
      ) : filtres.length === 0 ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, fontStyle:"italic", padding:"20px 0" }}>Aucun fournisseur ne correspond à cette recherche.</div>
      ) : (
        <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:10 }}>
          {filtres.map(f => {
            const apercu = (f.mail_type || "").split("\n").filter(l => l.trim()).slice(0, 2).join(" · ");
            return (
              <div key={f.id} style={{
                background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:RADIUS.lg, padding:"14px 16px",
                display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap",
              }}>
                <div style={{
                  width:38, height:38, borderRadius:RADIUS.md, flexShrink:0,
                  background:acc.bg10, color:acc.accent,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  <Icon as={Truck} size={17}/>
                </div>
                <div style={{ flex:1, minWidth:200 }}>
                  <div style={{ fontWeight:700, fontSize:FONT.sm.size+1, color:T.text }}>{f.nom}</div>
                  {f.email && (
                    <div style={{ fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:2, display:"inline-flex", alignItems:"center", gap:4 }}>
                      <Icon as={Mail} size={10}/>
                      {f.email}
                    </div>
                  )}
                  {apercu && (
                    <div style={{ fontSize:FONT.xs.size+1, color:T.textSub, marginTop:6, lineHeight:1.5, fontStyle:"italic", maxWidth:640, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }}>
                      « {apercu} »
                    </div>
                  )}
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                  <button className="btn-g" style={{ fontSize:FONT.xs.size+1, padding:"5px 12px", display:"inline-flex", alignItems:"center", gap:4 }}
                    onClick={()=>ouvrirForm(f)}>
                    <Icon as={Pencil} size={11}/>
                    Modifier
                  </button>
                  <button className="btn-d" style={{ display:"inline-flex", alignItems:"center", gap:4 }}
                    onClick={()=>setToDelete(f)}>
                    <Icon as={Trash2} size={11}/>
                    Supprimer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modale suppression */}
      {toDelete && (
        <div onClick={()=>setToDelete(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface, borderRadius:RADIUS.xl, padding:24,
            width:"100%", maxWidth:440, border:`1px solid ${T.border}`,
          }}>
            <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:14}}>
              <div style={{width:40, height:40, borderRadius:RADIUS.md, flexShrink:0, background:"rgba(224,92,92,0.12)", color:"#e15a5a", display:"flex", alignItems:"center", justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size, fontWeight:800, color:T.text}}>Supprimer ce fournisseur&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:20}}>
              Le fournisseur <strong style={{color:T.text}}>« {toDelete.nom} »</strong> sera supprimé.
              <br/><span style={{color:T.textMuted, fontSize:FONT.xs.size+1}}>Les articles rattachés restent accessibles et conservent leur ancien texte fournisseur.</span>
            </div>
            <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
              <button onClick={()=>setToDelete(null)} style={{
                background:"transparent", border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
                fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer",
              }}>Annuler</button>
              <button onClick={supprimer} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#e15a5a", color:"#fff", border:"none",
                borderRadius:RADIUS.md, padding:"9px 18px",
                fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ONGLET VÉHICULES ─────────────────────────────────────────────────────────
// Parc de véhicules de la société (nom + plaque). Affecté par cellule dans le
// Planning semaine (cf. CellModal). Table Supabase : vehicules (sql/vehicules.sql).
function OngletVehicules({ T, acc }) {
  const [vehicules, setVehicules] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editId, setEditId]       = useState(null);
  const [draft, setDraft]         = useState({ nom: "", immatriculation: "" });
  const [showForm, setShowForm]   = useState(false);
  const [toDelete, setToDelete]   = useState(null);
  const [succes, setSucces]       = useState("");
  const [erreur, setErreur]       = useState("");
  const [saving, setSaving]       = useState(false);
  const [search, setSearch]       = useState("");

  const flash = (type, msg) => {
    if (type === "ok") { setSucces(msg); setErreur(""); setTimeout(() => setSucces(""), 3500); }
    else               { setErreur(msg); setSucces(""); setTimeout(() => setErreur(""), 5000); }
  };

  const charger = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("vehicules").select("*").order("nom");
    if (error) flash("err", "Chargement impossible : " + error.message);
    setVehicules(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

  const resetDraft = () => setDraft({ nom: "", immatriculation: "" });

  const ouvrirForm = (v = null) => {
    if (v) {
      setEditId(v.id);
      setDraft({ nom: v.nom || "", immatriculation: v.immatriculation || "" });
    } else {
      setEditId(null);
      resetDraft();
    }
    setShowForm(true);
  };

  const fermerForm = () => {
    setShowForm(false);
    setEditId(null);
    resetDraft();
  };

  const enregistrer = async () => {
    if (!draft.nom.trim()) { flash("err", "Le nom du véhicule est obligatoire."); return; }
    setSaving(true);
    const payload = {
      nom:             draft.nom.trim(),
      immatriculation: draft.immatriculation?.trim() || null,
    };
    let err;
    if (editId) {
      ({ error: err } = await supabase.from("vehicules").update(payload).eq("id", editId));
    } else {
      ({ error: err } = await supabase.from("vehicules").insert(payload));
    }
    setSaving(false);
    if (err) { flash("err", "Erreur : " + err.message); return; }
    flash("ok", editId ? `✓ ${payload.nom} mis à jour.` : `✓ ${payload.nom} créé.`);
    fermerForm();
    charger();
  };

  const supprimer = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("vehicules").delete().eq("id", toDelete.id);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    flash("ok", `✓ ${toDelete.nom} supprimé.`);
    setToDelete(null);
    charger();
  };

  const filtres = vehicules.filter(v => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (v.nom || "").toLowerCase().includes(q) || (v.immatriculation || "").toLowerCase().includes(q);
  });

  return (
    <div className="ac">
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:4, flexWrap:"wrap", gap:10 }}>
        <div>
          <div style={{ fontWeight:800, fontSize:FONT.md.size, marginBottom:4, color:T.text }}>Véhicules</div>
          <div style={{ color:T.textSub, fontSize:FONT.xs.size+1, lineHeight:1.6, maxWidth:560 }}>
            Parc de véhicules de la société. Une fois enregistrés, ils peuvent être affectés à un chantier pour un jour donné dans le Planning semaine.
          </div>
        </div>
        <button onClick={() => showForm ? fermerForm() : ouvrirForm()} style={{
          display:"inline-flex", alignItems:"center", gap:6,
          background: showForm ? "transparent" : acc.accent, color: showForm ? T.textSub : acc.onAccent,
          border: showForm ? `1px solid ${T.border}` : "none",
          borderRadius:RADIUS.md, padding:"9px 16px",
          fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor:"pointer",
        }}>
          <Icon as={showForm ? X : Plus} size={13}/>
          {showForm ? "Annuler" : "Nouveau véhicule"}
        </button>
      </div>

      {/* Recherche */}
      {vehicules.length > 0 && !showForm && (
        <div style={{
          display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
          marginTop:14, background:T.surface, border:`1px solid ${T.border}`,
          borderRadius:RADIUS.lg, padding:"8px 10px",
        }}>
          <div style={{position:"relative", flex:"1 1 200px", maxWidth:320}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", pointerEvents:"none"}}/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un véhicule ou une plaque…"
              style={{
                width:"100%", background:T.fieldBg||T.card, border:`1px solid ${T.fieldBorder||T.border}`,
                borderRadius:RADIUS.md, padding:"7px 10px 7px 28px", color:T.text,
                fontFamily:"inherit", fontSize:FONT.xs.size+1, outline:"none",
              }}/>
          </div>
          <div style={{marginLeft:"auto", fontSize:FONT.xs.size+1, color:T.textMuted, fontWeight:600}}>
            {filtres.length} / {vehicules.length}
          </div>
        </div>
      )}

      {/* Messages */}
      {succes && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(34,197,94,0.12)", border:"1px solid rgba(34,197,94,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#22c55e", margin:"12px 0", lineHeight:1.6,
        }}>
          <Icon as={Check} size={13}/>
          <span>{succes.replace(/^✓ /, "")}</span>
        </div>
      )}
      {erreur && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)",
          borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.sm.size,
          color:"#e15a5a", margin:"12px 0",
        }}>
          <Icon as={AlertTriangle} size={13}/>
          {erreur}
        </div>
      )}

      {/* Formulaire création / édition */}
      {showForm && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px", margin:"16px 0" }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:16, color:T.text }}>
            {editId ? "Modifier le véhicule" : "Nouveau véhicule"}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Nom *</label>
              <input className="ti" value={draft.nom} onChange={e=>setDraft(p=>({...p,nom:e.target.value}))}
                placeholder="Ex : Master blanc, Kangoo…" style={{ width:"100%" }}/>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Immatriculation</label>
              <input className="ti" value={draft.immatriculation}
                onChange={e=>setDraft(p=>({...p,immatriculation:e.target.value.toUpperCase()}))}
                placeholder="AB-123-CD" style={{ width:"100%", textTransform:"uppercase" }}/>
            </div>
          </div>

          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <button onClick={fermerForm} disabled={saving} style={{
              background:"transparent", border:`1px solid ${T.border}`,
              borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
              fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer", opacity:saving?.5:1,
            }}>Annuler</button>
            <button onClick={enregistrer} disabled={saving || !draft.nom.trim()} style={{
              display:"inline-flex", alignItems:"center", gap:6,
              background: draft.nom.trim() ? acc.accent : T.border,
              color: draft.nom.trim() ? acc.onAccent : T.textMuted,
              border:"none", borderRadius:RADIUS.md, padding:"9px 18px",
              fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800,
              cursor: draft.nom.trim() && !saving ? "pointer" : "not-allowed",
              opacity:saving?.6:1,
            }}>
              <Icon as={Check} size={13}/>
              {saving ? "Enregistrement…" : (editId ? "Modifier" : "Créer")}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, padding:"20px 0", textAlign:"center" }}>Chargement…</div>
      ) : vehicules.length === 0 ? (
        <div style={{
          background:T.card, border:`1px dashed ${T.border}`,
          borderRadius:RADIUS.xl, padding:"40px 24px", textAlign:"center", color:T.textSub, marginTop:16,
        }}>
          <div style={{
            width:48,height:48,borderRadius:RADIUS.lg,
            background:acc.bg10,color:acc.accent,
            display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12,
          }}>
            <Icon as={Car} size={24} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun véhicule</div>
          <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6,marginBottom:16}}>
            Ajoutez les véhicules de la société pour pouvoir les affecter aux chantiers dans le Planning semaine.
          </div>
        </div>
      ) : filtres.length === 0 ? (
        <div style={{ color:T.textSub, fontSize:FONT.sm.size, fontStyle:"italic", padding:"20px 0" }}>Aucun véhicule ne correspond à cette recherche.</div>
      ) : (
        <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:10 }}>
          {filtres.map(v => (
            <div key={v.id} style={{
              background:T.surface, border:`1px solid ${T.border}`,
              borderRadius:RADIUS.lg, padding:"14px 16px",
              display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
            }}>
              <div style={{
                width:38, height:38, borderRadius:RADIUS.md, flexShrink:0,
                background:acc.bg10, color:acc.accent,
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon as={Car} size={17}/>
              </div>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontWeight:700, fontSize:FONT.sm.size+1, color:T.text }}>{v.nom}</div>
                {v.immatriculation && (
                  <div style={{
                    display:"inline-flex", alignItems:"center", marginTop:4,
                    fontFamily:"monospace", fontWeight:800, fontSize:FONT.xs.size+1, letterSpacing:1,
                    background:T.fieldBg||T.card, border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.sm, padding:"2px 8px", color:T.textSub,
                  }}>
                    {v.immatriculation}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                <button className="btn-g" style={{ fontSize:FONT.xs.size+1, padding:"5px 12px", display:"inline-flex", alignItems:"center", gap:4 }}
                  onClick={()=>ouvrirForm(v)}>
                  <Icon as={Pencil} size={11}/>
                  Modifier
                </button>
                <button className="btn-d" style={{ display:"inline-flex", alignItems:"center", gap:4 }}
                  onClick={()=>setToDelete(v)}>
                  <Icon as={Trash2} size={11}/>
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modale suppression */}
      {toDelete && (
        <div onClick={()=>setToDelete(null)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16, backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface, borderRadius:RADIUS.xl, padding:24,
            width:"100%", maxWidth:440, border:`1px solid ${T.border}`,
          }}>
            <div style={{display:"flex", alignItems:"center", gap:12, marginBottom:14}}>
              <div style={{width:40, height:40, borderRadius:RADIUS.md, flexShrink:0, background:"rgba(224,92,92,0.12)", color:"#e15a5a", display:"flex", alignItems:"center", justifyContent:"center"}}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size, fontWeight:800, color:T.text}}>Supprimer ce véhicule&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:20}}>
              Le véhicule <strong style={{color:T.text}}>« {toDelete.nom} »</strong> sera supprimé.
              <br/><span style={{color:T.textMuted, fontSize:FONT.xs.size+1}}>Les affectations déjà enregistrées dans le planning restent affichées (snapshot).</span>
            </div>
            <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
              <button onClick={()=>setToDelete(null)} style={{
                background:"transparent", border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
                fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer",
              }}>Annuler</button>
              <button onClick={supprimer} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#e15a5a", color:"#fff", border:"none",
                borderRadius:RADIUS.md, padding:"9px 18px",
                fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800, cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE ADMIN ───────────────────────────────────────────────────────────────
// ─── TEMPLATES D'EMAILS PAR DÉFAUT ───────────────────────────────────────────
const EMAIL_TEMPLATES_DEFAUT = {
  todo_assign: {
    nom: "Assignation d'une tâche To-Do",
    subject: "Nouvelle tâche : {texte}",
    body: "Bonjour {prenom},\n\n{assigneur} vous a assigné cette tâche :\n{texte}\n\nPriorité : {priorite}\n\nConnectez-vous à Profero Planning, onglet Notes & To-do, pour cocher la tâche une fois terminée.",
    variables: ["{prenom}", "{texte}", "{priorite}", "{assigneur}"],
  },
};

// ─── DÉFAUTS POUR LA SOCIÉTÉ ET LE PLANNING ──────────────────────────────────
const SOCIETE_DEFAUT = {
  nom: "Profero Rénovation",
  adresse: "",
  siret: "",
  telephone: "",
  email: "",
  site_web: "",
};
const HEURES_DEFAUT = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9, "Vendredi": 9 };
const PHRASES_DEFAUT = {
  cr_observation: [
    "Travaux conformes au plan, RAS.",
    "Bonne avancée, équipe motivée.",
    "Retard sur la phase en cours, à rattraper.",
  ],
  visite_observation: [
    "Chantier propre, EPI respectés.",
    "Quelques points à reprendre, voir réserves.",
    "Très bon état d'avancement.",
  ],
  vigilance: [
    "Vérifier l'évacuation des gravats avant la fin de semaine.",
    "Surveiller l'humidité dans la pièce concernée.",
    "Pensez à protéger les sols pendant les travaux.",
  ],
};

// ─── ONGLET HISTORIQUE & RESTAURATION ──────────────────────────────────────
// Filet de récupération : consulte la table data_history (alimentée par le
// trigger SQL sur pointages / commandes / factures / besoins / rapports) et
// permet de restaurer une donnée modifiée ou supprimée en 1 clic.
// cf. sql/202606_data_history_filet_securite.sql
const HIST_TABLE_LABELS = {
  pointages:       "Heures réelles (pointage)",
  commande_lignes: "Ligne de commande (coût matériau)",
  commandes:       "Commande / BL / ticket",
  factures:        "Facture fournisseur",
  facture_bl:      "Rapprochement facture ↔ BL",
  besoins:         "Demande de matériel",
  rapports:        "Compte-rendu de journée",
};

function histResume(table, r) {
  if (!r || typeof r !== "object") return "";
  const n = (v) => (v === null || v === undefined || v === "" ? "" : v);
  try {
    switch (table) {
      case "pointages":
        return `${n(r.ouvrier) || "?"} — ${n(r.heures) || 0} h${r.taux_horaire ? ` × ${r.taux_horaire} €/h` : ""}${r.date ? ` · ${r.date}` : ""}${r.type_pointage === "indirect" ? " · indirect" : ""}`;
      case "commande_lignes":
        return `${n(r.libelle) || "(sans libellé)"} — ${n(r.quantite)} ${n(r.unite)}${r.prix_total != null ? ` · ${r.prix_total} €` : (r.prix_unitaire != null ? ` · ${r.prix_unitaire} €/u` : "")}`;
      case "commandes":
        return `${n(r.doc_type)} ${n(r.doc_numero)} — ${n(r.fournisseur_nom) || "?"}${r.montant_ht != null ? ` · ${r.montant_ht} €` : ""}`;
      case "factures":
        return `N° ${n(r.numero) || "?"} — ${n(r.fournisseur_nom) || "?"}${r.montant_ht != null ? ` · ${r.montant_ht} €` : ""}`;
      case "facture_bl":
        return `BL ${n(r.bl_numero) || "?"}${r.montant_ht != null ? ` · ${r.montant_ht} €` : ""} · ${n(r.statut)}`;
      case "besoins":
        return `${n(r.article) || "?"} — ${n(r.quantite)} ${n(r.unite)}${r.ouvrier_demandeur ? ` · ${r.ouvrier_demandeur}` : ""}`;
      case "rapports":
        return `${n(r.ouvrier) || n(r.auteur) || "?"}${r.date_rapport ? ` · ${r.date_rapport}` : (r.date ? ` · ${r.date}` : "")}`;
      default: {
        const keys = Object.keys(r).filter(k => !["id", "created_at", "updated_at"].includes(k)).slice(0, 4);
        return keys.map(k => `${k}: ${n(r[k])}`).join(" · ");
      }
    }
  } catch { return ""; }
}

function OngletHistorique({ T, acc, chantiers }) {
  const [chantierId, setChantierId]   = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [opFilter, setOpFilter]       = useState("");
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(false);
  const [msg, setMsg]                 = useState(null);
  const [restoringId, setRestoringId] = useState(null);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 7000); };

  const load = async () => {
    setLoading(true);
    let q = supabase.from("data_history").select("*").order("saved_at", { ascending: false }).limit(300);
    if (chantierId)  q = q.eq("chantier_id", chantierId);
    if (tableFilter) q = q.eq("table_name", tableFilter);
    if (opFilter)    q = q.eq("op", opFilter);
    const { data, error } = await q;
    if (error) flash("err", "Erreur de chargement : " + error.message);
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [chantierId, tableFilter, opFilter]);

  const restaurer = async (entry) => {
    const label = HIST_TABLE_LABELS[entry.table_name] || entry.table_name;
    const when = new Date(entry.saved_at).toLocaleString("fr-FR");
    const ok = window.confirm(
      `Restaurer cette donnée ?\n\n` +
      `${label}\n${histResume(entry.table_name, entry.row_data)}\n\n` +
      `${entry.op === "DELETE"
        ? "Cette ligne avait été supprimée — elle va être recréée à l'identique."
        : "La version actuelle sera remplacée par celle d'avant la modification."}\n` +
      `(état sauvegardé le ${when})\n\n` +
      `La restauration est elle-même historisée, donc annulable.`
    );
    if (!ok) return;
    setRestoringId(entry.id);
    const { error } = await supabase.from(entry.table_name).upsert(entry.row_data, { onConflict: "id" });
    setRestoringId(null);
    if (error) { flash("err", "Échec : " + error.message + (error.message.includes("foreign key") ? " (l'élément parent a peut-être aussi été supprimé)" : "")); return; }
    flash("ok", "✓ Donnée restaurée.");
    load();
  };

  const inp = {
    padding: "7px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
    background: T.bg, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1,
  };

  return (
    <div className="ac">
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: FONT.md.size, marginBottom: 4, color: T.text }}>Historique & restauration</div>
        <div style={{ color: T.textSub, fontSize: FONT.xs.size + 1, lineHeight: 1.6, maxWidth: 640 }}>
          Toute modification ou suppression des données sensibles (heures réelles, coûts matériaux,
          commandes, factures, comptes-rendus) est conservée ici. Restaurez une version en un clic
          si une donnée a disparu de façon inattendue.
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={chantierId} onChange={e => setChantierId(e.target.value)} style={inp}>
          <option value="">Tous les chantiers</option>
          {(chantiers || []).map(c => (
            <option key={c.id} value={c.id}>{c.nom || c.id}</option>
          ))}
        </select>
        <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} style={inp}>
          <option value="">Tout type de donnée</option>
          {Object.entries(HIST_TABLE_LABELS).map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
        <select value={opFilter} onChange={e => setOpFilter(e.target.value)} style={inp}>
          <option value="">Modifs + suppressions</option>
          <option value="DELETE">Suppressions seules</option>
          <option value="UPDATE">Modifications seules</option>
        </select>
        <button onClick={load} style={{ ...inp, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: acc.accent, borderColor: acc.accent }}>
          <Icon as={RefreshCw} size={12} /> Rafraîchir
        </button>
      </div>

      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: RADIUS.md, marginBottom: 12, fontSize: FONT.xs.size + 1, fontWeight: 600,
          background: msg.type === "ok" ? "#1b3a2a" : "#3a1b1b", color: msg.type === "ok" ? "#7ee0a8" : "#ffadad",
        }}>{msg.text}</div>
      )}

      {loading ? (
        <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, padding: "16px 0" }}>Chargement…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, padding: "16px 0", display: "flex", alignItems: "center", gap: 8 }}>
          <Icon as={Info} size={14} /> Aucun mouvement enregistré pour ce filtre.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(entry => {
            const isDel = entry.op === "DELETE";
            const label = HIST_TABLE_LABELS[entry.table_name] || entry.table_name;
            return (
              <div key={entry.id} style={{
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                padding: "10px 12px", borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.bgSoft || T.bg,
              }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6,
                  fontSize: FONT.xs.size, fontWeight: 800, flexShrink: 0,
                  background: isDel ? "#3a1b1b" : "#3a3119", color: isDel ? "#ffadad" : "#ffd479",
                }}>
                  <Icon as={isDel ? Trash2 : Pencil} size={11} />
                  {isDel ? "Supprimé" : "Modifié"}
                </span>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text }}>{label}</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginTop: 2 }}>{histResume(entry.table_name, entry.row_data)}</div>
                </div>
                <div style={{ fontSize: FONT.xs.size, color: T.textMuted, textAlign: "right", flexShrink: 0 }}>
                  <div>{new Date(entry.saved_at).toLocaleString("fr-FR")}</div>
                  {entry.changed_by && <div>par {entry.changed_by}</div>}
                </div>
                <button
                  onClick={() => restaurer(entry)}
                  disabled={restoringId === entry.id}
                  style={{
                    ...inp, cursor: "pointer", flexShrink: 0, fontWeight: 700,
                    color: acc.onAccent, background: acc.accent, border: "none",
                    opacity: restoringId === entry.id ? 0.5 : 1,
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                  <Icon as={RefreshCw} size={12} />
                  {restoringId === entry.id ? "…" : "Restaurer"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: FONT.xs.size, color: T.textMuted, lineHeight: 1.6 }}>
        <Icon as={Info} size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
        L'historique des <b>phasages</b> (plan de travaux, ouvrages) dispose de son propre filet et se restaure depuis la base.
        Conservation des mouvements : 365 jours.
      </div>
    </div>
  );
}

function PageAdmin({ouvriers,setOuvriers,ouvrierEmails,setOuvrierEmails,tauxHoraires,setTauxHoraires,tauxMOPrev=0,setTauxMOPrev,chantiers,setChantiers,saveConfig,theme,setTheme,T,profil,branch="renovation"}){
  const acc = getBranchAccent(branch);
  const [adminTab,setAdminTab]=useState("vue");
  const [newOuvrier,setNewOuvrier]=useState("");
  const [editOuvrier,setEditOuvrier]=useState(null);
  const [newNom,setNewNom]=useState("");
  const [newColor,setNewColor]=useState(COULEURS_PALETTE[0]);
  const [editChIdx,setEditChIdx]=useState(null);
  const [ouvrierToDelete,setOuvrierToDelete]=useState(null);
  const [chantierToDelete,setChantierToDelete]=useState(null);

  // ─── NOUVELLES CONFIGS (Bloc 1) ──────────────────────────────────────────
  const [societe, setSociete]           = useState(SOCIETE_DEFAUT);
  const [heuresParJour, setHeuresParJour] = useState(HEURES_DEFAUT);
  const [phrases, setPhrases]           = useState(PHRASES_DEFAUT);
  const [stats, setStats]               = useState({ chantiersActifs: 0, projetsEnCours: 0, visitesEnCours: 0, ouvriersActifs: 0, derniersRapports: [], dernieresVisites: [] });
  const [backuping, setBackuping]       = useState(false);

  // ─── PHASES DE TRAVAUX (Bloc 2) ──────────────────────────────────────────
  const [phases, setPhases]             = useState(PHASES_DEFAUT);
  const [editPhaseIdx, setEditPhaseIdx] = useState(null);
  const [editPhaseColIdx, setEditPhaseColIdx] = useState(null);
  const [phaseToDelete, setPhaseToDelete] = useState(null);
  const [resetPhasesConfirm, setResetPhasesConfirm] = useState(false);

  // ─── LOTS (Phasage v2) ──────────────────────────────────────────────────
  const [lots, setLots]                 = useState(LOTS_DEFAUT);
  const [editLotColIdx, setEditLotColIdx] = useState(null);
  const [lotToDelete, setLotToDelete]   = useState(null);
  const [resetLotsConfirm, setResetLotsConfirm] = useState(false);

  // ─── EMAIL TEMPLATES (Bloc 3) ────────────────────────────────────────────
  const [emailTemplates, setEmailTemplates] = useState(EMAIL_TEMPLATES_DEFAUT);

  // ─── PHASAGE TEMPLATES (Bloc 3) ──────────────────────────────────────────
  const [phasageTemplates, setPhasageTemplates] = useState([]);
  const [editTplIdx, setEditTplIdx]         = useState(null);
  const [tplToDelete, setTplToDelete]       = useState(null);

  // ─── LOAD CONFIGS SUPABASE ───────────────────────────────────────────────
  useEffect(() => {
    const loadConfigs = async () => {
      const { data } = await supabase.from("planning_config").select("key,value").in("key", ["societe", "heures_par_jour", "phrases_bank", "phases_travaux", "lots_travaux", "email_templates", "phasage_templates"]);
      if (data) {
        data.forEach(r => {
          if (r.key === "societe" && r.value)         setSociete({ ...SOCIETE_DEFAUT, ...r.value });
          if (r.key === "heures_par_jour" && r.value) setHeuresParJour({ ...HEURES_DEFAUT, ...r.value });
          if (r.key === "phrases_bank" && r.value)    setPhrases({ ...PHRASES_DEFAUT, ...r.value });
          if (r.key === "phases_travaux" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setPhases(r.value.items);
          }
          if (r.key === "lots_travaux" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setLots(r.value.items);
          }
          if (r.key === "email_templates" && r.value) {
            setEmailTemplates({ ...EMAIL_TEMPLATES_DEFAUT, ...r.value });
          }
          if (r.key === "phasage_templates" && r.value && Array.isArray(r.value.items)) {
            setPhasageTemplates(r.value.items);
          }
        });
      }
    };
    loadConfigs();
  }, []);

  // ─── STATS POUR VUE D'ENSEMBLE ───────────────────────────────────────────
  useEffect(() => {
    if (adminTab !== "vue") return;
    const loadStats = async () => {
      try {
        const [{ data: projets }, { data: visites }, { data: rapports }] = await Promise.all([
          supabase.from("profero_projets").select("id, statut, client_nom, client_prenom, date_visite").order("created_at", { ascending: false }).limit(20),
          supabase.from("visites_chantier").select("id, chantier_id, chantier_nom, date, statut, audit").order("date", { ascending: false }).limit(10),
          supabase.from("rapports").select("id, ouvrier, chantier_nom, date_rapport, submitted_at").order("submitted_at", { ascending: false }).limit(5),
        ]);
        setStats({
          chantiersActifs: chantiers.length,
          ouvriersActifs: ouvriers.length,
          projetsEnCours: (projets || []).filter(p => !["abandonne","signe"].includes(p.statut || "prospect")).length,
          visitesEnCours: (visites || []).filter(v => (v.statut || "en_cours") === "en_cours").length,
          derniersRapports: rapports || [],
          dernieresVisites: visites?.slice(0, 5) || [],
        });
      } catch (e) { console.warn("stats load:", e.message); }
    };
    loadStats();
  }, [adminTab, chantiers.length, ouvriers.length]);

  // ─── SAUVEGARDE CONFIGS ──────────────────────────────────────────────────
  const saveDebounce = React.useRef(null);
  const updSociete = (field, val) => {
    const next = { ...societe, [field]: val };
    setSociete(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("societe", next), 600);
  };
  const updHeureJour = (jour, val) => {
    const next = { ...heuresParJour, [jour]: parseFloat(val) || 0 };
    setHeuresParJour(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("heures_par_jour", next), 600);
  };
  const updPhrases = (cat, list) => {
    const next = { ...phrases, [cat]: list };
    setPhrases(next);
    saveConfig("phrases_bank", next);
  };

  // ─── EMAIL TEMPLATES CRUD ────────────────────────────────────────────────
  const updEmailTemplate = (key, field, val) => {
    const next = { ...emailTemplates, [key]: { ...emailTemplates[key], [field]: val } };
    setEmailTemplates(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("email_templates", next), 600);
  };
  const resetEmailTemplate = (key) => {
    const next = { ...emailTemplates, [key]: EMAIL_TEMPLATES_DEFAUT[key] };
    setEmailTemplates(next);
    saveConfig("email_templates", next);
  };

  // ─── PHASAGE TEMPLATES CRUD ──────────────────────────────────────────────
  const savePhasageTemplates = async (next) => {
    setPhasageTemplates(next);
    await saveConfig("phasage_templates", { items: next });
  };
  const addPhasageTpl = () => {
    const nouveau = {
      id:  `tpl_${Date.now()}`,
      nom: "Nouveau modèle",
      description: "",
      ouvrages: [],
    };
    savePhasageTemplates([...phasageTemplates, nouveau]);
    setEditTplIdx(phasageTemplates.length);
  };
  const updPhasageTpl = (i, patch) => {
    const next = phasageTemplates.map((t, idx) => idx === i ? { ...t, ...patch } : t);
    setPhasageTemplates(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("phasage_templates", { items: next }), 600);
  };
  const removePhasageTpl = () => {
    if (tplToDelete === null) return;
    const next = phasageTemplates.filter((_, idx) => idx !== tplToDelete);
    savePhasageTemplates(next);
    setTplToDelete(null);
    if (editTplIdx === tplToDelete) setEditTplIdx(null);
  };
  const addTplOuvrage = (i) => {
    const tpl = phasageTemplates[i];
    const nouveau = { id: `ouv_${Date.now()}`, libelle: "", unite: "U", heures: 0 };
    updPhasageTpl(i, { ouvrages: [...(tpl.ouvrages || []), nouveau] });
  };
  const updTplOuvrage = (i, j, patch) => {
    const tpl = phasageTemplates[i];
    const nv = (tpl.ouvrages || []).map((o, idx) => idx === j ? { ...o, ...patch } : o);
    updPhasageTpl(i, { ouvrages: nv });
  };
  const removeTplOuvrage = (i, j) => {
    const tpl = phasageTemplates[i];
    const nv = (tpl.ouvrages || []).filter((_, idx) => idx !== j);
    updPhasageTpl(i, { ouvrages: nv });
  };

  // ─── PHASES TRAVAUX CRUD ─────────────────────────────────────────────────
  const savePhases = async (next) => {
    setPhases(next);
    await saveConfig("phases_travaux", { items: next });
  };
  const addPhase = () => {
    const id = `phase_${Date.now()}`;
    savePhases([...phases, { id, label: "Nouvelle phase", emoji: "", couleur: COULEURS_PALETTE[phases.length % COULEURS_PALETTE.length] }]);
  };
  const updPhase = (i, patch) => {
    const next = phases.map((p, idx) => idx === i ? { ...p, ...patch } : p);
    setPhases(next);
    // Debounce save
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("phases_travaux", { items: next }), 600);
  };
  const removePhase = () => {
    if (phaseToDelete === null) return;
    const next = phases.filter((_, idx) => idx !== phaseToDelete);
    savePhases(next);
    setPhaseToDelete(null);
  };
  const movePhase = (i, d) => {
    const a = [...phases], j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    savePhases(a);
  };
  const resetPhases = () => {
    savePhases([...PHASES_DEFAUT]);
    setResetPhasesConfirm(false);
  };

  // ─── LOTS (Phasage v2) CRUD ──────────────────────────────────────────────
  const saveLots = async (next) => {
    setLots(next);
    await saveConfig("lots_travaux", { items: next });
  };
  const addLot = () => {
    const id = `lot_${Date.now()}`;
    saveLots([...lots, { id, label: "Nouveau lot", couleur: COULEURS_PALETTE[lots.length % COULEURS_PALETTE.length] }]);
  };
  const updLot = (i, patch) => {
    const next = lots.map((l, idx) => idx === i ? { ...l, ...patch } : l);
    setLots(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("lots_travaux", { items: next }), 600);
  };
  const removeLot = () => {
    if (lotToDelete === null) return;
    const next = lots.filter((_, idx) => idx !== lotToDelete);
    saveLots(next);
    setLotToDelete(null);
  };
  const moveLot = (i, d) => {
    const a = [...lots], j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    saveLots(a);
  };
  const resetLots = () => {
    saveLots([...LOTS_DEFAUT]);
    setResetLotsConfirm(false);
  };

  // ─── BACKUP JSON ─────────────────────────────────────────────────────────
  const doBackup = async () => {
    setBackuping(true);
    try {
      const tables = ["planning_config","planning_cells","planning_mensuel","phasages","visites_chantier","profero_projets","profero_ouvrages_selectionnes","profero_cotes","profero_plans","profero_categories_ouvrages","rapports","cr_comptes_rendus","materiaux_bibliotheque","bibliotheque_ratios","commandes_detail","commandes_passees","besoins","commandes","commande_lignes","factures","facture_bl","plans","utilisateurs"];
      const out = { version: 1, exported_at: new Date().toISOString(), tables: {} };
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select("*");
        if (error) { console.warn(`backup ${t}:`, error.message); continue; }
        out.tables[t] = data || [];
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-profero-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur backup : " + e.message);
    }
    setBackuping(false);
  };

  // ─── LOGOS (stockés dans Supabase planning_config) ───────────────────────
  const [logoNavbar,  setLogoNavbar]  = useState(null);
  const [logoPortail, setLogoPortail] = useState(null);
  const [logoReno,    setLogoReno]    = useState(null);
  const [logoInvest,  setLogoInvest]  = useState(null);
  const [logosLoading, setLogosLoading] = useState(true);
  const [logosSaving,  setLogosSaving]  = useState({});

  // Charger les logos depuis Supabase au montage
  useEffect(() => {
    const loadLogos = async () => {
      setLogosLoading(true);
      try {
        const { data } = await supabase
          .from("planning_config")
          .select("key,value")
          .in("key", ["logo_navbar","logo_portail","logo_reno","logo_invest"]);
        if (data) {
          data.forEach(r => {
            if (r.key === "logo_navbar")  setLogoNavbar(r.value  || null);
            if (r.key === "logo_portail") setLogoPortail(r.value || null);
            if (r.key === "logo_reno")    setLogoReno(r.value    || null);
            if (r.key === "logo_invest")  setLogoInvest(r.value  || null);
          });
        }
      } catch(e) { console.error("Chargement logos:", e); }
      setLogosLoading(false);
    };
    loadLogos();
  }, []);

  const handleLogoUpload = (key, setFn, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const data = ev.target.result;
      setLogosSaving(s => ({...s, [key]: true}));
      setFn(data);
      await saveConfig(key, data);
      setLogosSaving(s => ({...s, [key]: false}));
    };
    reader.readAsDataURL(file);
  };

  const handleLogoDelete = async (key, setFn) => {
    setLogosSaving(s => ({...s, [key]: true}));
    setFn(null);
    await saveConfig(key, null);
    setLogosSaving(s => ({...s, [key]: false}));
  };

  const addOuvrier=()=>{if(!newOuvrier.trim())return;const u=[...ouvriers,newOuvrier.trim()];setOuvriers(u);saveConfig("ouvriers",u);setNewOuvrier("");};
  const confirmRemoveOuvrier=()=>{
    if (ouvrierToDelete===null) return;
    const u=ouvriers.filter((_,idx)=>idx!==ouvrierToDelete);
    setOuvriers(u); saveConfig("ouvriers",u);
    setOuvrierToDelete(null);
  };
  const renameOuvrier=(i,v,email)=>{
    const oldNom=ouvriers[i];
    const u=ouvriers.map((o,idx)=>idx===i?v:o);
    setOuvriers(u);saveConfig("ouvriers",u);
    const ne={...ouvrierEmails};delete ne[oldNom];
    if(email?.trim())ne[v]=email.trim();
    setOuvrierEmails(ne);saveConfig("ouvrier_emails",ne);
    setEditOuvrier(null);
  };
  const moveOuvrier=(i,d)=>{const a=[...ouvriers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setOuvriers(a);saveConfig("ouvriers",a);};
  const addChantier = async () => {
    if (!newNom.trim()) return;
    const id  = newNom.trim().toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    const nc  = { id, nom: newNom.trim().toUpperCase(), couleur: newColor };
    const u   = [...chantiers, nc];
    setChantiers(u);
    saveConfig("chantiers", u);
    setNewNom("");
    // Création auto du phasage lié — assure la boucle logique chantier ↔ phasage
    // dès la création. L'utilisateur peut ensuite remplir les ouvrages/tâches.
    // On reste sur les colonnes minimales pour éviter les erreurs si le schéma
    // diffère d'une instance à l'autre.
    try {
      await supabase.from("phasages").insert({
        chantier_id: id,
        chantier_nom: nc.nom,
        ouvrages: [],
      });
    } catch (e) {
      console.warn("Création phasage auto échouée :", e?.message || e);
    }
  };

  const confirmRemoveChantier = () => {
    if (chantierToDelete===null) return;
    const u = chantiers.filter((_, idx) => idx !== chantierToDelete);
    setChantiers(u);
    saveConfig("chantiers", u);
    setChantierToDelete(null);
  };

  const updateChantier = async (i, ch) => {
    const ancien = chantiers[i];
    const u = chantiers.map((c, idx) => idx === i ? { ...c, ...ch } : c);
    setChantiers(u);
    saveConfig("chantiers", u);
    // Synchronise le nom du phasage si le chantier a été renommé.
    if (ch.nom && ancien?.id && ch.nom !== ancien.nom) {
      try {
        await supabase.from("phasages")
          .update({ chantier_nom: ch.nom })
          .eq("chantier_id", ancien.id);
      } catch (e) {
        console.warn("Sync nom phasage échouée :", e?.message || e);
      }
    }
  };

  // Synchronisation manuelle : aligne chaque chantier sur un phasage existant
  //   (par nom si chantier_id ne correspond pas), ou en crée un sinon.
  //   Permet de réparer les liens cassés ET de rattraper les chantiers sans phasage.
  const [syncing, setSyncing]       = useState(false);
  const [syncMsg, setSyncMsg]       = useState("");

  // Normalisation pour comparer des noms : minuscule, sans accents, sans
  // ponctuation, espaces simples.
  const normalise = (str) => (str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

  // Synchronisation des comptes rendus : pour chaque CR sans chantier_id,
  // cherche un chantier dont le nom apparait dans l'adresse du CR.
  const [syncingCR, setSyncingCR] = useState(false);
  const [syncCRMsg, setSyncCRMsg] = useState("");
  const synchroniserCRs = async () => {
    setSyncingCR(true); setSyncCRMsg("");
    try {
      const { data: tousCRs, error: errLoad } = await supabase
        .from("cr_comptes_rendus")
        .select("id, chantier_id, adresse");
      if (errLoad) {
        setSyncCRMsg(`⚠ Erreur chargement : ${errLoad.message}`);
        setSyncingCR(false);
        return;
      }
      const crs = tousCRs || [];

      const aLier = [];
      const sansMatch = [];
      let dejaLies = 0;

      for (const cr of crs) {
        if (cr.chantier_id) { dejaLies++; continue; }
        // Cherche un chantier dont le nom (normalisé) apparait dans l'adresse
        const adr = normalise(cr.adresse || "");
        if (!adr) { sansMatch.push(cr); continue; }
        const matchCh = chantiers.find(c => {
          const nom = normalise(c.nom);
          if (!nom) return false;
          if (adr.includes(nom)) return true;
          // Mot par mot (mots > 2 chars)
          const mots = nom.split(" ").filter(m => m.length > 2);
          return mots.some(m => adr.includes(m));
        });
        if (matchCh) aLier.push({ crId: cr.id, chantier: matchCh });
        else         sansMatch.push(cr);
      }

      for (const item of aLier) {
        const { error } = await supabase.from("cr_comptes_rendus")
          .update({ chantier_id: item.chantier.id })
          .eq("id", item.crId);
        if (error) console.warn("Sync CR :", error.message);
      }

      const parties = [];
      if (dejaLies > 0)        parties.push(`${dejaLies} déjà lié${dejaLies > 1 ? "s" : ""}`);
      if (aLier.length > 0)    parties.push(`${aLier.length} CR rattaché${aLier.length > 1 ? "s" : ""}`);
      if (sansMatch.length > 0) parties.push(`${sansMatch.length} sans correspondance trouvée`);
      setSyncCRMsg(`✓ ${parties.join(" · ") || "Aucun compte rendu à traiter"}`);
    } catch (e) {
      setSyncCRMsg(`⚠ Erreur : ${e.message}`);
    }
    setSyncingCR(false);
    setTimeout(() => setSyncCRMsg(""), 12000);
  };

  const synchroniserPhasages = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const { data: tous } = await supabase
        .from("phasages")
        .select("id, chantier_id, chantier_nom");
      const phasages = tous || [];

      const aLier = []; // phasages existants à relier (update chantier_id)
      const aCreer = []; // chantiers sans phasage du tout
      const dejaOk = []; // chantiers déjà correctement liés

      // Garde une trace des ids de phasages déjà appariés pour éviter de
      // mapper plusieurs chantiers sur le même phasage.
      const phasagesPris = new Set();

      for (const c of chantiers) {
        // a) Match exact par chantier_id → rien à faire
        const exact = phasages.find(p => p.chantier_id === c.id);
        if (exact) { dejaOk.push(c.nom); phasagesPris.add(exact.id); continue; }

        // b) Match par nom (normalisé). On ignore les phasages déjà appariés.
        const nomC = normalise(c.nom);
        const motsC = nomC.split(" ").filter(m => m.length > 2);
        const matchByName = phasages.find(p => {
          if (phasagesPris.has(p.id)) return false;
          const nomP = normalise(p.chantier_nom || "");
          if (!nomP || !nomC) return false;
          if (nomP === nomC || nomP.includes(nomC) || nomC.includes(nomP)) return true;
          // Au moins un mot significatif en commun
          const motsP = nomP.split(" ").filter(m => m.length > 2);
          return motsC.some(m => motsP.includes(m));
        });

        if (matchByName) {
          aLier.push({ phasageId: matchByName.id, ancienNom: matchByName.chantier_nom, chantier: c });
          phasagesPris.add(matchByName.id);
        } else {
          aCreer.push(c);
        }
      }

      // Exécute les updates
      for (const item of aLier) {
        const { error } = await supabase.from("phasages")
          .update({ chantier_id: item.chantier.id, chantier_nom: item.chantier.nom })
          .eq("id", item.phasageId);
        if (error) console.warn("Sync update :", item.chantier.nom, error.message);
      }

      // Exécute les inserts
      if (aCreer.length > 0) {
        const rows = aCreer.map(c => ({
          chantier_id: c.id, chantier_nom: c.nom, ouvrages: [],
        }));
        const { error } = await supabase.from("phasages").insert(rows);
        if (error) {
          setSyncMsg(`⚠ Erreur création : ${error.message}`);
          setSyncing(false);
          return;
        }
      }

      // Construit le message récap
      const parties = [];
      if (dejaOk.length > 0) parties.push(`${dejaOk.length} déjà OK`);
      if (aLier.length > 0)  parties.push(`${aLier.length} phasage${aLier.length > 1 ? "s" : ""} relié${aLier.length > 1 ? "s" : ""} par nom (${aLier.map(l => l.chantier.nom).join(", ")})`);
      if (aCreer.length > 0) parties.push(`${aCreer.length} nouveau${aCreer.length > 1 ? "x" : ""} phasage${aCreer.length > 1 ? "s" : ""} créé${aCreer.length > 1 ? "s" : ""} (${aCreer.map(c => c.nom).join(", ")})`);
      setSyncMsg(`✓ ${parties.join(" · ") || "Rien à faire"}`);
    } catch (e) {
      setSyncMsg(`⚠ Erreur : ${e.message}`);
    }
    setSyncing(false);
    setTimeout(() => setSyncMsg(""), 12000);
  };
  const moveChantier=(i,d)=>{const a=[...chantiers],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];setChantiers(a);saveConfig("chantiers",a);};

  const isAdmin = profil?.role === "admin";

  const tabs = [
    ["vue",          "Vue d'ensemble",  LayoutDashboard],
    ["ouvriers",     "Ouvriers",        HardHat],
    ["taux",         "Taux horaires",   Euro],
    ["chantiers",    "Chantiers",       Building2],
    ["phases",       "Phases",          ClipboardCheck],
    ["lots",         "Lots",            Boxes],
    ["templates",    "Templates phasage", FileText],
    ["societe",      "Société",         Briefcase],
    ["planning",     "Planning",        Clock],
    ["logos",        "Logos",           ImageIcon],
    ["phrases",      "Phrases types",   MessageSquare],
    ["emails",       "Emails",          Mail],
    ["fournisseurs", "Fournisseurs",    Truck],
    ["vehicules",    "Véhicules",       Car],
    ...(isAdmin ? [["utilisateurs", "Utilisateurs", Users]] : []),
    ...(isAdmin ? [["acces",        "Accès",        Lock]]  : []),
    ...(isAdmin ? [["historique",   "Historique",   RefreshCw]] : []),
    ["maintenance",  "Maintenance",     Wrench],
  ];

  return(
    <div className="admin-page" style={{flex:1,overflowY:"auto",padding:"24px 28px",background:T.bg}}>
      <style>{`
        @media(max-width:767px){
          .admin-page .admin-tabs{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;padding-bottom:6px!important}
          .admin-page .admin-tabs::-webkit-scrollbar{display:none}
          .admin-page .admin-tabs .atab{flex:0 0 auto}
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
        <div style={{
          width:36,height:36,borderRadius:RADIUS.md,
          background:acc.bg10,color:acc.accent,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>
          <Icon as={Settings} size={20} strokeWidth={2}/>
        </div>
        <div>
          <div style={{fontSize:FONT.xl.size+4,fontWeight:800,color:T.text,letterSpacing:-0.3,marginBottom:2}}>Réglages</div>
          <div style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>
            Modifications appliquées immédiatement pour toute l'équipe
          </div>
        </div>
      </div>

      {/* ── Onglets ── */}
      <div className="admin-tabs" style={{display:"flex",gap:6,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:10,flexWrap:"wrap"}}>
        {tabs.map(([k,l,IconComp])=>{
          const a = adminTab===k;
          return (
            <button key={k} className={`atab ${a?"on":"off"}`} onClick={()=>setAdminTab(k)}
              style={{
                display:"inline-flex",alignItems:"center",gap:6,
                padding:"7px 14px",borderRadius:RADIUS.md,
                border:a?"none":`1px solid ${T.border}`,
                background:a?acc.accent:"transparent",color:a?acc.onAccent:T.textSub,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                transition:"all .12s",
              }}>
              <Icon as={IconComp} size={12}/>
              {l}
            </button>
          );
        })}
      </div>

      {adminTab==="utilisateurs" && isAdmin && (
        <OngletUtilisateurs T={T} acc={acc}/>
      )}

      {adminTab==="acces" && isAdmin && (
        <OngletAcces T={T} acc={acc}/>
      )}

      {adminTab==="fournisseurs" && (
        <OngletFournisseurs T={T} acc={acc}/>
      )}

      {adminTab==="vehicules" && (
        <OngletVehicules T={T} acc={acc}/>
      )}

      {adminTab==="historique" && isAdmin && (
        <OngletHistorique T={T} acc={acc} chantiers={chantiers}/>
      )}

      {/* ── PHASES DE TRAVAUX ── */}
      {adminTab==="phases" && (
        <div className="ac">
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Phases de travaux</div>
              <div style={{color:T.textSub,fontSize:FONT.xs.size+1,lineHeight:1.6,maxWidth:560}}>
                Phases utilisées dans le Phasage, la Bibliothèque d'ouvrages, les Visites de chantier et la page Chantiers.
                Les modifications s'appliquent aux nouvelles entrées et au prochain affichage.
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>setResetPhasesConfirm(true)} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"7px 12px",borderRadius:RADIUS.md,
                border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
              }}>
                <Icon as={RefreshCw} size={11}/>
                Restaurer par défaut
              </button>
              <button onClick={addPhase} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:acc.accent,color:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Plus} size={12}/>
                Ajouter une phase
              </button>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:"rgba(245,166,35,0.08)",border:"1px solid rgba(245,166,35,0.30)",borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:"#f5a623",lineHeight:1.5,marginBottom:14}}>
            <Icon as={AlertTriangle} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>Si tu supprimes une phase utilisée dans un phasage existant, les tâches resteront accessibles mais ne seront plus regroupées. Préfère renommer plutôt que supprimer.</span>
          </div>

          {phases.map((ph, i) => (
            <div key={ph.id || i} className="ar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>movePhase(i,-1)} title="Monter"><Icon as={ChevronUp} size={12}/></button>
                <button className="ib" onClick={()=>movePhase(i,1)} title="Descendre"><Icon as={ChevronDown} size={12}/></button>
              </div>

              {/* Pastille couleur */}
              <div onClick={()=>setEditPhaseColIdx(editPhaseColIdx===i?null:i)}
                style={{
                  width:30,height:30,borderRadius:RADIUS.md,flexShrink:0,
                  background:ph.couleur||"#888",border:`2px solid ${T.border}`,cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,
                }} title="Couleur de la phase">
                {ph.emoji}
              </div>

              {editPhaseColIdx===i ? (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,flex:"1 1 200px"}}>
                  {COULEURS_PALETTE.map(col=>(
                    <div key={col} onClick={()=>{updPhase(i,{couleur:col});setEditPhaseColIdx(null);}}
                      className={`cdot ${ph.couleur===col?"sel":""}`} style={{background:col,cursor:"pointer"}}/>
                  ))}
                </div>
              ) : (
                <>
                  <input className="ti" value={ph.label||""} onChange={e=>updPhase(i,{label:e.target.value})}
                    placeholder="Libellé de la phase" style={{flex:"2 1 200px",minWidth:140,fontWeight:600}}/>
                  <input className="ti" value={ph.emoji||""} onChange={e=>updPhase(i,{emoji:e.target.value.slice(0,2)})}
                    placeholder="Emoji" style={{width:60,textAlign:"center",fontSize:FONT.md.size}}/>
                  <button className="btn-d" onClick={()=>setPhaseToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Trash2} size={11}/>
                    Supprimer
                  </button>
                </>
              )}
            </div>
          ))}

          {/* Modale confirmation suppression phase */}
          {phaseToDelete !== null && (
            <div onClick={()=>setPhaseToDelete(null)} style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
            }}>
              <div onClick={e=>e.stopPropagation()} style={{
                background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
                width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon as={AlertTriangle} size={20}/>
                  </div>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cette phase&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  La phase <strong style={{color:T.text}}>« {phases[phaseToDelete]?.label} »</strong> sera retirée de la liste.
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les phasages, visites et ouvrages bibliothèque qui l'utilisaient restent en base mais ne seront plus regroupés sous cette phase.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setPhaseToDelete(null)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={removePhase} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"#e15a5a",color:"#fff",border:"none",
                    borderRadius:RADIUS.md,padding:"9px 18px",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                    <Icon as={Trash2} size={13}/>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modale confirmation restauration défaut */}
          {resetPhasesConfirm && (
            <div onClick={()=>setResetPhasesConfirm(false)} style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
            }}>
              <div onClick={e=>e.stopPropagation()} style={{
                background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
                width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(245,166,35,0.16)",color:"#f5a623",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon as={RefreshCw} size={20}/>
                  </div>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Restaurer les 11 phases par défaut&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Ta liste actuelle sera remplacée par les 11 phases standards (Démolition → Finitions générales).
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les phasages existants utilisant des phases personnalisées resteront orphelins.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setResetPhasesConfirm(false)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={resetPhases} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:acc.accent,color:acc.onAccent,border:"none",
                    borderRadius:RADIUS.md,padding:"9px 18px",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                    <Icon as={Check} size={13}/>
                    Restaurer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LOTS (Phasage v2) ── */}
      {adminTab==="lots" && (
        <div className="ac">
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Lots de travaux</div>
              <div style={{color:T.textSub,fontSize:FONT.xs.size+1,lineHeight:1.6,maxWidth:560}}>
                Catégorisation par corps de métier utilisée dans la page <strong style={{color:T.text}}>Phasage v2</strong> (vue 3 colonnes Lots → Ouvrages → Tâches). Chaque ouvrage peut être rattaché à un lot.
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>setResetLotsConfirm(true)} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"7px 12px",borderRadius:RADIUS.md,
                border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
              }}>
                <Icon as={RefreshCw} size={11}/>
                Restaurer par défaut
              </button>
              <button onClick={addLot} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:acc.accent,color:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Plus} size={12}/>
                Ajouter un lot
              </button>
            </div>
          </div>

          {lots.map((l, i) => (
            <div key={l.id || i} className="ar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveLot(i,-1)} title="Monter"><Icon as={ChevronUp} size={12}/></button>
                <button className="ib" onClick={()=>moveLot(i,1)} title="Descendre"><Icon as={ChevronDown} size={12}/></button>
              </div>
              <div onClick={()=>setEditLotColIdx(editLotColIdx===i?null:i)}
                style={{
                  width:30,height:30,borderRadius:RADIUS.md,flexShrink:0,
                  background:l.couleur||"#888",border:`2px solid ${T.border}`,cursor:"pointer",
                }} title="Couleur du lot"/>
              {editLotColIdx===i ? (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,flex:"1 1 200px"}}>
                  {COULEURS_PALETTE.map(col=>(
                    <div key={col} onClick={()=>{updLot(i,{couleur:col});setEditLotColIdx(null);}}
                      className={`cdot ${l.couleur===col?"sel":""}`} style={{background:col,cursor:"pointer"}}/>
                  ))}
                </div>
              ) : (
                <>
                  <input className="ti" value={l.label||""} onChange={e=>updLot(i,{label:e.target.value})}
                    placeholder="Libellé du lot" style={{flex:"2 1 200px",minWidth:140,fontWeight:600}}/>
                  <input className="ti" value={l.code_prefixe||""}
                    onChange={e=>updLot(i,{code_prefixe:e.target.value.toUpperCase().slice(0,3)})}
                    placeholder="E" title="Préfixe de code (ex : E pour Électricité). Sert à l'import devis : 'E-001 ...' sera auto-attribué à ce lot."
                    style={{width:60,textAlign:"center",fontWeight:700,letterSpacing:1}}/>
                  <button className="btn-d" onClick={()=>setLotToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Trash2} size={11}/>
                    Supprimer
                  </button>
                </>
              )}
            </div>
          ))}

          {lotToDelete !== null && (
            <div onClick={()=>setLotToDelete(null)} style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
            }}>
              <div onClick={e=>e.stopPropagation()} style={{
                background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
                width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon as={AlertTriangle} size={20}/>
                  </div>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce lot&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Le lot <strong style={{color:T.text}}>« {lots[lotToDelete]?.label} »</strong> sera retiré de la liste.
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les ouvrages déjà rattachés à ce lot restent en base mais ne seront plus regroupés sous ce lot dans Phasage v2.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setLotToDelete(null)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={removeLot} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"#e15a5a",color:"#fff",border:"none",
                    borderRadius:RADIUS.md,padding:"9px 18px",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                    <Icon as={Trash2} size={13}/>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          )}

          {resetLotsConfirm && (
            <div onClick={()=>setResetLotsConfirm(false)} style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
            }}>
              <div onClick={e=>e.stopPropagation()} style={{
                background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
                width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(245,166,35,0.16)",color:"#f5a623",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon as={RefreshCw} size={20}/>
                  </div>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Restaurer les lots par défaut&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Ta liste actuelle sera remplacée par les 5 lots standards (Électricité, Maçonnerie, Murs cloison doublages, Ouvertures, Plomberie sanitaire).
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setResetLotsConfirm(false)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={resetLots} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:acc.accent,color:acc.onAccent,border:"none",
                    borderRadius:RADIUS.md,padding:"9px 18px",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                    <Icon as={Check} size={13}/>
                    Restaurer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EMAILS ── */}
      {adminTab==="emails" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Modèles d'emails</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18,lineHeight:1.6,maxWidth:640}}>
            Personnalise le sujet et le message des emails automatiques envoyés par l'application.
            Les <strong style={{color:T.text}}>variables entre accolades</strong> sont remplacées automatiquement à l'envoi.
          </div>

          {Object.entries(emailTemplates).map(([key, tpl]) => (
            <div key={key} style={{
              background:T.surface, border:`1px solid ${T.border}`,
              borderRadius:RADIUS.lg, padding:18, marginBottom:14,
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                <div style={{display:"inline-flex",alignItems:"center",gap:8}}>
                  <Icon as={Mail} size={14} color={acc.accent}/>
                  <span style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text}}>{tpl.nom}</span>
                </div>
                <button onClick={()=>resetEmailTemplate(key)} style={{
                  display:"inline-flex",alignItems:"center",gap:5,
                  padding:"5px 10px",borderRadius:RADIUS.sm,
                  border:`1px solid ${T.border}`,background:"transparent",color:T.textMuted,
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,cursor:"pointer",
                }}>
                  <Icon as={RefreshCw} size={10}/>
                  Restaurer par défaut
                </button>
              </div>

              <div style={{marginBottom:12}}>
                <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Sujet</label>
                <input className="ti" value={tpl.subject||""} onChange={e=>updEmailTemplate(key,"subject",e.target.value)}
                  placeholder="Ex : Nouvelle tâche pour {prenom}" style={{width:"100%"}}/>
              </div>

              <div style={{marginBottom:12}}>
                <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Message</label>
                <textarea className="ti" value={tpl.body||""} onChange={e=>updEmailTemplate(key,"body",e.target.value)}
                  rows={6} placeholder="Le corps de l'email…" style={{width:"100%",resize:"vertical",fontFamily:"inherit",lineHeight:1.5}}/>
              </div>

              {tpl.variables && tpl.variables.length > 0 && (
                <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:T.card,borderRadius:RADIUS.md}}>
                  <Icon as={Info} size={12} color={T.textMuted} style={{marginTop:2,flexShrink:0}}/>
                  <div style={{flex:1,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
                    Variables disponibles :{" "}
                    {tpl.variables.map((v,i) => (
                      <span key={v} style={{
                        display:"inline-block",
                        padding:"1px 8px",borderRadius:RADIUS.sm,marginRight:4,marginBottom:4,
                        background:acc.bg10,color:acc.accent,fontFamily:"monospace",fontSize:FONT.xs.size,fontWeight:700,
                      }}>{v}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}

          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"12px 14px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
            <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>
              Les modifications s'appliquent aux <strong style={{color:T.text}}>prochains envois</strong>. La mise en forme HTML (en-tête de l'app, couleurs, etc.) est gérée automatiquement autour de ton message.
            </span>
          </div>
        </div>
      )}

      {/* ── TEMPLATES PHASAGE ── */}
      {adminTab==="templates" && (
        <div className="ac">
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Templates de phasage</div>
              <div style={{color:T.textSub,fontSize:FONT.xs.size+1,lineHeight:1.6,maxWidth:560}}>
                Modèles pré-remplis (« T2 standard », « Salle de bain »…) à dupliquer rapidement pour créer un nouveau phasage.
              </div>
            </div>
            <button onClick={addPhasageTpl} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
              background:acc.accent,color:acc.onAccent,
              fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
            }}>
              <Icon as={Plus} size={12}/>
              Nouveau template
            </button>
          </div>

          {phasageTemplates.length === 0 ? (
            <div style={{
              background:T.card, border:`1px dashed ${T.border}`,
              borderRadius:RADIUS.xl, padding:"40px 24px", textAlign:"center", color:T.textSub,
            }}>
              <div style={{
                width:48,height:48,borderRadius:RADIUS.lg,
                background:acc.bg10,color:acc.accent,
                display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12,
              }}>
                <Icon as={FileText} size={24} strokeWidth={1.5}/>
              </div>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucun template</div>
              <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6,marginBottom:16}}>
                Crée un modèle de phasage pré-rempli pour gagner du temps sur les chantiers similaires.
              </div>
              <button onClick={addPhasageTpl} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"9px 16px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
              }}>
                <Icon as={Plus} size={13}/>
                Créer mon premier template
              </button>
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {phasageTemplates.map((tpl, i) => {
                const isOpen = editTplIdx === i;
                const totalH = (tpl.ouvrages||[]).reduce((s,o)=>s+(parseFloat(o.heures)||0),0);
                return (
                  <div key={tpl.id || i} style={{
                    background:T.surface, border:`1px solid ${isOpen ? acc.accent : T.border}`,
                    borderRadius:RADIUS.lg, overflow:"hidden", transition:"border .15s",
                  }}>
                    {/* En-tête */}
                    <div onClick={()=>setEditTplIdx(isOpen ? null : i)} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"12px 14px",cursor:"pointer",
                      borderBottom:isOpen?`1px solid ${T.sectionDivider||T.border}`:"none",
                    }}>
                      <div style={{
                        width:32,height:32,borderRadius:RADIUS.md,flexShrink:0,
                        background:acc.bg10,color:acc.accent,
                        display:"flex",alignItems:"center",justifyContent:"center",
                      }}>
                        <Icon as={FileText} size={15}/>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text}}>{tpl.nom || "Sans nom"}</div>
                        <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:1}}>
                          {(tpl.ouvrages||[]).length} ouvrage{(tpl.ouvrages||[]).length>1?"s":""}
                          {totalH > 0 && ` · ${totalH.toFixed(1)}h totales`}
                        </div>
                      </div>
                      <button onClick={(e)=>{e.stopPropagation();setTplToDelete(i);}} className="btn-d" style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        <Icon as={Trash2} size={11}/>
                      </button>
                      <Icon as={isOpen ? ChevronUp : ChevronDown} size={14} color={T.textMuted}/>
                    </div>

                    {/* Édition */}
                    {isOpen && (
                      <div style={{padding:"12px 14px"}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:10,marginBottom:12}}>
                          <div>
                            <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Nom du template</label>
                            <input className="ti" value={tpl.nom||""} onChange={e=>updPhasageTpl(i,{nom:e.target.value})}
                              placeholder="Ex : T2 standard" style={{width:"100%"}}/>
                          </div>
                          <div>
                            <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Description (optionnel)</label>
                            <input className="ti" value={tpl.description||""} onChange={e=>updPhasageTpl(i,{description:e.target.value})}
                              placeholder="Ex : Rénovation complète T2 50m²" style={{width:"100%"}}/>
                          </div>
                        </div>

                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                          <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted}}>
                            <Icon as={Hammer} size={11}/>
                            Ouvrages du template
                          </div>
                          <button onClick={()=>addTplOuvrage(i)} style={{
                            display:"inline-flex",alignItems:"center",gap:5,
                            padding:"6px 12px",borderRadius:RADIUS.sm,
                            background:T.card,border:`1px solid ${T.border}`,color:T.textSub,
                            fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
                          }}>
                            <Icon as={Plus} size={11}/>
                            Ajouter
                          </button>
                        </div>

                        {(tpl.ouvrages||[]).length === 0 ? (
                          <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,fontStyle:"italic",padding:"12px 0"}}>
                            Aucun ouvrage. Clique sur Ajouter pour en saisir.
                          </div>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:6}}>
                            {(tpl.ouvrages||[]).map((o, j) => (
                              <div key={o.id || j} style={{display:"flex",gap:6,alignItems:"center"}}>
                                <input className="ti" value={o.libelle||""} onChange={e=>updTplOuvrage(i,j,{libelle:e.target.value})}
                                  placeholder="Libellé (ex : Pose plaques BA13)" style={{flex:"3 1 200px",minWidth:160}}/>
                                <input className="ti" type="number" min="0" step="0.5" value={o.heures||""} onChange={e=>updTplOuvrage(i,j,{heures:parseFloat(e.target.value)||0})}
                                  placeholder="0" style={{width:80,textAlign:"center",fontWeight:700,color:acc.accent}}/>
                                <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>h</span>
                                <select value={o.unite||"U"} onChange={e=>updTplOuvrage(i,j,{unite:e.target.value})}
                                  style={{
                                    padding:"7px 9px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,
                                    background:T.fieldBg||T.card,color:T.text,
                                    fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",cursor:"pointer",
                                  }}>
                                  <option value="U">U</option>
                                  <option value="m">m</option>
                                  <option value="m²">m²</option>
                                  <option value="ml">ml</option>
                                </select>
                                <button onClick={()=>removeTplOuvrage(i,j)} title="Supprimer" style={{
                                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                                  background:"transparent",border:`1px solid rgba(224,92,92,0.3)`,
                                  borderRadius:RADIUS.sm,padding:"6px 8px",color:"#e15a5a",cursor:"pointer",
                                }}>
                                  <Icon as={Trash2} size={11}/>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Modale suppression template */}
          {tplToDelete !== null && (
            <div onClick={()=>setTplToDelete(null)} style={{
              position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
              display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
            }}>
              <div onClick={e=>e.stopPropagation()} style={{
                background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
                width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
              }}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,background:"rgba(224,92,92,0.12)",color:"#e15a5a",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <Icon as={AlertTriangle} size={20}/>
                  </div>
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce template&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Le template <strong style={{color:T.text}}>« {phasageTemplates[tplToDelete]?.nom} »</strong> sera supprimé.
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les phasages déjà créés à partir de ce template ne sont pas affectés.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setTplToDelete(null)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={removePhasageTpl} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background:"#e15a5a",color:"#fff",border:"none",
                    borderRadius:RADIUS.md,padding:"9px 18px",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                    <Icon as={Trash2} size={13}/>
                    Supprimer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── VUE D'ENSEMBLE ── */}
      {adminTab==="vue" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Vue d'ensemble</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>État global de l'application.</div>

          {/* KPI grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10,marginBottom:18}}>
            {[
              { label:"Chantiers actifs",  val:stats.chantiersActifs, icon:Building2,    color:acc.accent },
              { label:"Équipe",            val:stats.ouvriersActifs,  icon:HardHat,      color:"#5b9cf6" },
              { label:"Projets commerciaux",val:stats.projetsEnCours, icon:Briefcase,    color:"#a78bfa" },
              { label:"Visites en cours",  val:stats.visitesEnCours,  icon:ClipboardCheck,color:"#22c55e" },
            ].map(s => (
              <div key={s.label} style={{
                background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:RADIUS.lg,padding:"12px 14px",
                display:"flex",alignItems:"center",gap:10,
              }}>
                <div style={{
                  width:32,height:32,borderRadius:RADIUS.md,flexShrink:0,
                  background:s.color+"18",color:s.color,
                  display:"flex",alignItems:"center",justifyContent:"center",
                }}>
                  <Icon as={s.icon} size={16} strokeWidth={2}/>
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:FONT.xl.size,fontWeight:800,color:T.text,letterSpacing:-.5,lineHeight:1}}>{s.val}</div>
                  <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3,fontWeight:600,letterSpacing:.3}}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Activité récente */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
            {/* Derniers rapports */}
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14}}>
              <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
                <Icon as={Activity} size={11}/>
                Derniers rapports équipe
              </div>
              {stats.derniersRapports.length === 0 ? (
                <div style={{color:T.textMuted,fontSize:FONT.sm.size,fontStyle:"italic"}}>Aucun rapport récent.</div>
              ) : (
                stats.derniersRapports.map(r => (
                  <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.sectionDivider||T.border}`}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text}}>{r.ouvrier}</div>
                      <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>{r.chantier_nom} · {r.date_rapport}</div>
                    </div>
                    <Icon as={ChevronRight} size={13} color={T.textMuted}/>
                  </div>
                ))
              )}
            </div>

            {/* Dernières visites */}
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14}}>
              <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
                <Icon as={ClipboardCheck} size={11}/>
                Dernières visites de chantier
              </div>
              {stats.dernieresVisites.length === 0 ? (
                <div style={{color:T.textMuted,fontSize:FONT.sm.size,fontStyle:"italic"}}>Aucune visite récente.</div>
              ) : (
                stats.dernieresVisites.map(v => {
                  const toutes = Object.values(v.audit || {}).flat();
                  const nb_nok = toutes.filter(t => t.statut === "nok").length;
                  const nb_res = toutes.filter(t => t.statut === "reserve").length;
                  return (
                    <div key={v.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.sectionDivider||T.border}`}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text}}>{v.chantier_nom}</div>
                        <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>{v.date} · {toutes.length} pts</div>
                      </div>
                      {nb_nok > 0 && <span style={{fontSize:FONT.xs.size,fontWeight:700,color:"#e15a5a",background:"rgba(239,68,68,0.15)",padding:"1px 7px",borderRadius:RADIUS.pill}}>{nb_nok} NOK</span>}
                      {nb_res > 0 && <span style={{fontSize:FONT.xs.size,fontWeight:700,color:"#f59e0b",background:"rgba(245,158,11,0.15)",padding:"1px 7px",borderRadius:RADIUS.pill}}>{nb_res} rés</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SOCIÉTÉ ── */}
      {adminTab==="societe" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Coordonnées société</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>
            Utilisées automatiquement dans les en-têtes des exports PDF/Word (visites, comptes rendus, fiches client).
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Nom de la société *</label>
              <input className="ti" value={societe.nom||""} onChange={e=>updSociete("nom",e.target.value)} placeholder="Profero Rénovation" style={{width:"100%"}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>SIRET</label>
              <input className="ti" value={societe.siret||""} onChange={e=>updSociete("siret",e.target.value)} placeholder="123 456 789 00012" style={{width:"100%"}}/>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Adresse complète</label>
              <textarea className="ti" value={societe.adresse||""} onChange={e=>updSociete("adresse",e.target.value)} placeholder="Rue, Code Postal, Ville" rows={2} style={{width:"100%",resize:"vertical"}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Téléphone</label>
              <input className="ti" value={societe.telephone||""} onChange={e=>updSociete("telephone",e.target.value)} placeholder="01 23 45 67 89" style={{width:"100%"}}/>
            </div>
            <div>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Email</label>
              <input className="ti" type="email" value={societe.email||""} onChange={e=>updSociete("email",e.target.value)} placeholder="contact@profero.fr" style={{width:"100%"}}/>
            </div>
            <div style={{gridColumn:"1 / -1"}}>
              <label style={{display:"block",fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>Site web</label>
              <input className="ti" value={societe.site_web||""} onChange={e=>updSociete("site_web",e.target.value)} placeholder="https://www.groupe-profero.com" style={{width:"100%"}}/>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:16,padding:"12px 14px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
            <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>Modifications enregistrées automatiquement. Les en-têtes des prochains exports utiliseront ces informations.</span>
          </div>
        </div>
      )}

      {/* ── PLANNING : heures par jour ── */}
      {adminTab==="planning" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Heures travaillées par jour</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>
            Volume horaire de référence par jour de la semaine. Utilisé pour calculer la répartition des heures dans le bilan équipe.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:14}}>
            {JOURS.map(j => (
              <div key={j} style={{
                background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:RADIUS.lg,padding:"12px 14px",
              }}>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{j}</div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <input type="number" min="0" step="0.5"
                    value={heuresParJour[j] || 0}
                    onChange={e=>updHeureJour(j,e.target.value)}
                    style={{
                      width:60,padding:"7px 10px",borderRadius:RADIUS.md,textAlign:"center",
                      border:`1px solid ${T.border}`,background:T.inputBg||T.card,color:acc.accent,
                      fontFamily:"inherit",fontSize:FONT.md.size,fontWeight:800,outline:"none",
                    }}/>
                  <span style={{fontSize:FONT.sm.size,color:T.textMuted}}>h</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"12px 14px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
            <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>Total semaine : <strong style={{color:T.text}}>{JOURS.reduce((s,j) => s + (parseFloat(heuresParJour[j])||0), 0).toFixed(1)}h</strong>. Les modifications sont prises en compte dans les bilans futurs ; les bilans déjà saisis ne sont pas recalculés.</span>
          </div>
        </div>
      )}

      {/* ── PHRASES TYPES ── */}
      {adminTab==="phrases" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Banque de phrases</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>
            Observations et notes réutilisables. Affichées en suggestions dans les CR équipe, visites de chantier et points de vigilance.
          </div>
          {[
            { key:"cr_observation",      label:"Observations CR équipe" },
            { key:"visite_observation",  label:"Observations visite chantier" },
            { key:"vigilance",           label:"Points de vigilance" },
          ].map(cat => (
            <PhrasesEditor key={cat.key} catKey={cat.key} label={cat.label}
              items={phrases[cat.key] || []} onChange={(items)=>updPhrases(cat.key, items)}
              T={T} acc={acc}/>
          ))}
        </div>
      )}

      {/* ── MAINTENANCE ── */}
      {adminTab==="maintenance" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Maintenance</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>
            Synchronisations ponctuelles, sauvegarde des données et préférences d'affichage.
          </div>

          {/* Apparence */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14,marginBottom:14}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
              <Icon as={Palette} size={11}/>
              Affichage local
            </div>
            <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:12}}>Chaque utilisateur choisit son thème, sauvegardé localement.</div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[["dark",Moon,"Sombre"],["light",Sun,"Clair"]].map(([k,IconC,lb])=>{
                const a = theme === k;
                return (
                  <button key={k} onClick={()=>{setTheme(k);localStorage.setItem("theme",k);}}
                    style={{
                      display:"inline-flex",alignItems:"center",gap:6,
                      padding:"8px 14px",borderRadius:RADIUS.md,
                      border:`1.5px solid ${a?acc.accent:T.border}`,
                      background:a?acc.bg10:"transparent",
                      color:a?acc.accent:T.textSub,
                      fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,cursor:"pointer",
                    }}>
                    <Icon as={IconC} size={13}/>
                    {lb}
                    {a && <Icon as={Check} size={11}/>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Backup JSON */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14,marginBottom:14}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>
              <Icon as={Database} size={11}/>
              Sauvegarde des données
            </div>
            <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:12,lineHeight:1.6}}>
              Télécharge un fichier JSON contenant toutes les données de l'application (chantiers, phasages, visites, projets info client, rapports, commandes, etc.). À garder en archive régulière.
            </div>
            <button onClick={doBackup} disabled={backuping} style={{
              display:"inline-flex",alignItems:"center",gap:6,
              background:acc.accent,color:acc.onAccent,border:"none",
              borderRadius:RADIUS.md,padding:"9px 18px",cursor:backuping?"not-allowed":"pointer",
              fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,opacity:backuping?.6:1,
            }}>
              <Icon as={Download} size={13}/>
              {backuping ? "Sauvegarde en cours…" : "Télécharger la sauvegarde"}
            </button>
          </div>

          {/* Synchronisations */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:10}}>
              <Icon as={RefreshCw} size={11}/>
              Synchronisations
            </div>
            <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:14,lineHeight:1.6}}>
              Utilitaires de rattrapage des liens entre tables. À utiliser en cas de désynchronisation, généralement une fois.
            </div>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:10,padding:"10px 12px",background:T.card,borderRadius:RADIUS.md}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text,marginBottom:2}}>Phasages ↔ Chantiers</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.55}}>
                  Crée un phasage vide pour chaque chantier qui n'en a pas. Aligne les liens cassés.
                </div>
              </div>
              <button onClick={synchroniserPhasages} disabled={syncing} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:syncing?T.border:acc.accent,color:syncing?T.textMuted:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:800,cursor:syncing?"not-allowed":"pointer",
              }}>
                <Icon as={RefreshCw} size={11} style={syncing?{animation:"spin 1s linear infinite"}:undefined}/>
                {syncing?"Sync…":"Synchroniser"}
              </button>
              {syncMsg && (
                <div style={{flex:"1 1 100%",fontSize:FONT.xs.size+1,color:syncMsg.startsWith("⚠")?"#e15a5a":"#22c55e",fontWeight:600}}>{syncMsg}</div>
              )}
            </div>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",padding:"10px 12px",background:T.card,borderRadius:RADIUS.md}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text,marginBottom:2}}>Comptes rendus client ↔ Chantiers</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.55}}>
                  Pour chaque CR client sans chantier_id, cherche un chantier dont le nom apparaît dans l'adresse.
                </div>
              </div>
              <button onClick={synchroniserCRs} disabled={syncingCR} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:syncingCR?T.border:"#5B8AF5",color:syncingCR?T.textMuted:"#fff",
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:800,cursor:syncingCR?"not-allowed":"pointer",
              }}>
                <Icon as={RefreshCw} size={11} style={syncingCR?{animation:"spin 1s linear infinite"}:undefined}/>
                {syncingCR?"Sync…":"Synchroniser"}
              </button>
              {syncCRMsg && (
                <div style={{flex:"1 1 100%",fontSize:FONT.xs.size+1,color:syncCRMsg.startsWith("⚠")?"#e15a5a":"#22c55e",fontWeight:600}}>{syncCRMsg}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {adminTab==="taux"&&(
        <div className="ac">
          {/* Taux MO prévisionnel global — base du coût MO PRÉVU (heures vendues ×
              ce taux) dans le phasage v2 et la page Chantiers. Distinct des taux
              par ouvrier ci-dessous, qui servent au coût MO RÉEL (pointages). */}
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Taux MO prévisionnel</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:12}}>
            Taux horaire moyen utilisé pour estimer le <strong>coût MO prévisionnel</strong> (heures vendues × ce taux) dans le phasage et les fiches chantier. Défaut : {TAUX_MO_PREV_DEFAUT} €/h.
          </div>
          <div className="ar" style={{gap:12,marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
            <div style={{flex:1,fontWeight:700,fontSize:15,color:T.text}}>Taux horaire moyen (prévisionnel)</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input
                type="number" min="0" step="0.5"
                value={tauxMOPrev||""}
                onChange={e=>{
                  const v=parseFloat(e.target.value)||0;
                  setTauxMOPrev&&setTauxMOPrev(v);
                  saveConfig("taux_mo_previsionnel",v);
                }}
                placeholder={String(TAUX_MO_PREV_DEFAUT)}
                style={{width:80,padding:"7px 10px",borderRadius:8,textAlign:"center",
                  border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                  fontFamily:"inherit",fontSize:15,fontWeight:700,outline:"none"}}
              />
              <span style={{fontSize:13,color:T.textMuted}}>€/h</span>
            </div>
            {!(tauxMOPrev>0)&&(
              <span style={{fontSize:12,color:T.textMuted,fontStyle:"italic"}}>
                non réglé → {TAUX_MO_PREV_DEFAUT} €/h
              </span>
            )}
          </div>

          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Taux horaires par ouvrier</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>
            Coût horaire de chaque ouvrier — utilisé pour calculer le coût MO <strong>réel</strong> (pointages) dans le phasage.
          </div>
          {ouvriers.map((o,i)=>(
            <div key={i} className="ar" style={{gap:12}}>
              <div style={{flex:1,fontWeight:700,fontSize:15,color:T.text}}>{o}</div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input
                  type="number" min="0" step="0.5"
                  value={tauxHoraires?.[o]||""}
                  onChange={e=>{
                    const t={...tauxHoraires,[o]:parseFloat(e.target.value)||0};
                    setTauxHoraires(t);
                    saveConfig("taux_horaires",t);
                  }}
                  placeholder="0"
                  style={{width:80,padding:"7px 10px",borderRadius:8,textAlign:"center",
                    border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                    fontFamily:"inherit",fontSize:15,fontWeight:700,outline:"none"}}
                />
                <span style={{fontSize:13,color:T.textMuted}}>€/h</span>
              </div>
              {tauxHoraires?.[o]>0&&(
                <span style={{fontSize:12,color:T.textMuted}}>
                  = {(tauxHoraires[o]*8).toFixed(0)}€/jour
                </span>
              )}
            </div>
          ))}
          {ouvriers.length===0&&(
            <div style={{color:T.textMuted,fontStyle:"italic",fontSize:13}}>
              Ajoutez d'abord des ouvriers dans l'onglet Ouvriers.
            </div>
          )}
        </div>
      )}

      {adminTab==="ouvriers"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Liste des ouvriers</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>Nom + email — l'email permet d'inviter automatiquement sur Google Agenda.</div>
          {ouvriers.map((o,i)=>(
            <div key={i} className="ar" style={{flexWrap:"wrap",gap:6}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveOuvrier(i,-1)} title="Monter">
                  <Icon as={ChevronUp} size={12}/>
                </button>
                <button className="ib" onClick={()=>moveOuvrier(i,1)} title="Descendre">
                  <Icon as={ChevronDown} size={12}/>
                </button>
              </div>
              {editOuvrier?.index===i
                ?<>
                  <input className="ti" value={editOuvrier.value} placeholder="Prénom"
                    style={{flex:"1 1 80px",minWidth:70}}
                    onChange={e=>setEditOuvrier({...editOuvrier,value:e.target.value})}
                    onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value,editOuvrier.email);if(e.key==="Escape")setEditOuvrier(null);}}
                    autoFocus/>
                  <input className="ti" value={editOuvrier.email||""} placeholder="email@exemple.com"
                    style={{flex:"2 1 160px",minWidth:140}}
                    onChange={e=>setEditOuvrier({...editOuvrier,email:e.target.value})}
                    onKeyDown={e=>{if(e.key==="Enter")renameOuvrier(i,editOuvrier.value,editOuvrier.email);if(e.key==="Escape")setEditOuvrier(null);}}/>
                  <button className="btn-p" style={{fontSize:FONT.xs.size+1,padding:"6px 10px",display:"inline-flex",alignItems:"center",gap:4}} onClick={()=>renameOuvrier(i,editOuvrier.value,editOuvrier.email)}>
                    <Icon as={Check} size={11}/>
                  </button>
                  <button className="btn-g" style={{fontSize:FONT.xs.size+1,padding:"6px 10px",display:"inline-flex",alignItems:"center",gap:4}} onClick={()=>setEditOuvrier(null)}>
                    <Icon as={X} size={11}/>
                  </button>
                </>
                :<>
                  <div style={{flex:1,minWidth:120}}>
                    <div style={{fontWeight:700,fontSize:FONT.sm.size+1,color:T.text}}>{o}</div>
                    {ouvrierEmails?.[o]
                      ?<div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1,display:"inline-flex",alignItems:"center",gap:4}}>
                        <Icon as={Mail} size={10}/>
                        {ouvrierEmails[o]}
                      </div>
                      :<div style={{fontSize:FONT.xs.size,color:"#e15a5a",fontStyle:"italic",marginTop:1}}>Pas d'email — cliquer sur l'icône Modifier pour ajouter</div>}
                  </div>
                  <button className="ib" onClick={()=>setEditOuvrier({index:i,value:o,email:ouvrierEmails?.[o]||""})} title="Modifier">
                    <Icon as={Pencil} size={12}/>
                  </button>
                  <button className="btn-d" onClick={()=>setOuvrierToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Trash2} size={11}/>
                    Supprimer
                  </button>
                </>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:16,flexWrap:"wrap"}}>
            <input className="ti" value={newOuvrier} onChange={e=>setNewOuvrier(e.target.value)}
              placeholder="Prénom ou initiales…" style={{flex:1,minWidth:120}}
              onKeyDown={e=>e.key==="Enter"&&addOuvrier()}/>
            <button className="btn-p" onClick={addOuvrier} style={{display:"inline-flex",alignItems:"center",gap:5}}>
              <Icon as={Plus} size={12}/>
              Ajouter
            </button>
          </div>
        </div>
      )}

      {adminTab==="chantiers"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Chantiers par défaut</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>Clique sur le rond coloré pour changer la couleur.</div>
          {chantiers.map((c,i)=>(
            <div key={c.id} className="ar" style={{flexWrap:"wrap"}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveChantier(i,-1)} title="Monter">
                  <Icon as={ChevronUp} size={12}/>
                </button>
                <button className="ib" onClick={()=>moveChantier(i,1)} title="Descendre">
                  <Icon as={ChevronDown} size={12}/>
                </button>
              </div>
              <div className={`cdot ${editChIdx===i?"sel":""}`}
                style={{background:c.couleur,border:`2px solid ${T.border}`}}
                onClick={()=>setEditChIdx(editChIdx===i?null:i)} title="Couleur"/>
              {editChIdx===i
                ?<div style={{display:"flex",flexWrap:"wrap",gap:6,flex:1}}>
                    {COULEURS_PALETTE.map(col=>(
                      <div key={col} className={`cdot ${c.couleur===col?"sel":""}`}
                        style={{background:col}} onClick={()=>{updateChantier(i,{couleur:col});setEditChIdx(null);}}/>
                    ))}
                  </div>
                :<input className="ti" value={c.nom} onChange={e=>updateChantier(i,{nom:e.target.value.toUpperCase()})} style={{fontWeight:700}}/>
              }
              {editChIdx!==i
                ?<button className="btn-d" onClick={()=>setChantierToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                  <Icon as={Trash2} size={11}/>
                  Supprimer
                </button>
                :<button className="btn-g" style={{fontSize:FONT.xs.size+1,padding:"5px 10px",display:"inline-flex",alignItems:"center",gap:4}} onClick={()=>setEditChIdx(null)}>
                  <Icon as={X} size={11}/>
                </button>
              }
            </div>
          ))}
          <div style={{display:"flex",gap:10,marginTop:18,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {COULEURS_PALETTE.map(c=>(
                <div key={c} className={`cdot ${newColor===c?"sel":""}`} style={{background:c}} onClick={()=>setNewColor(c)}/>
              ))}
            </div>
            <input className="ti" value={newNom} onChange={e=>setNewNom(e.target.value)}
              placeholder="Nom du chantier…" style={{flex:1,minWidth:140}} onKeyDown={e=>e.key==="Enter"&&addChantier()}/>
            <button className="btn-p" onClick={addChantier} style={{display:"inline-flex",alignItems:"center",gap:5}}>
              <Icon as={Plus} size={12}/>
              Ajouter
            </button>
          </div>

        </div>
      )}

      {adminTab==="logos"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Logos de l'application</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:22}}>
            Importez vos logos PNG pour personnaliser le portail. Les logos sont partagés avec toute l'équipe.
          </div>

          {logosLoading
            ? <div style={{display:"flex",alignItems:"center",gap:8,color:T.textMuted,fontSize:FONT.sm.size,padding:"20px 0"}}>
                <svg width="14" height="14" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}>
                  <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                </svg>
                Chargement des logos…
              </div>
            : [
              { key:"logo_navbar",  state:logoNavbar,  setFn:setLogoNavbar,  label:"Logo navbar (en-tête, coin gauche)",   desc:"Affiché en haut à gauche dans la barre de navigation.",      w:160, h:40  },
              { key:"logo_portail", state:logoPortail, setFn:setLogoPortail, label:"Logo principal (centre du portail)",   desc:"Grande zone rectangulaire au centre de la page d'accueil.", w:320, h:80  },
              { key:"logo_reno",    state:logoReno,    setFn:setLogoReno,    label:"Icône carte Rénovation",               desc:"Icône carrée dans la carte Rénovation.",                    w:52,  h:52  },
              { key:"logo_invest",  state:logoInvest,  setFn:setLogoInvest,  label:"Icône carte Invest",                   desc:"Icône carrée dans la carte Invest.",                        w:52,  h:52  },
            ].map(({key,state,setFn,label,desc,w,h})=>(
              <div key={key} style={{display:"flex",alignItems:"flex-start",gap:18,padding:"18px 0",borderBottom:`1px solid ${T.border}`}}>

                {/* Aperçu */}
                <div style={{
                  width:w>80?120:60, height:h>60?60:52, flexShrink:0,
                  borderRadius:10, border:`1.5px dashed ${state?"rgba(255,194,0,0.4)":T.border}`,
                  background:T.card, display:"flex", alignItems:"center", justifyContent:"center",
                  overflow:"hidden",
                }}>
                  {state
                    ? <img src={state} alt={label} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}}/>
                    : <Icon as={ImageIcon} size={22} color={T.textMuted} strokeWidth={1.5}/>
                  }
                </div>

                {/* Infos + actions */}
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,fontSize:14,color:T.text,marginBottom:3}}>{label}</div>
                  <div style={{fontSize:12,color:T.textSub,marginBottom:12}}>{desc}</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    <label style={{
                      display:"inline-flex",alignItems:"center",gap:6,
                      background: logosSaving[key] ? T.border : T.accent,
                      color:"#111",border:"none",borderRadius:6,
                      padding:"7px 14px",fontSize:12,fontWeight:700,
                      cursor: logosSaving[key] ? "not-allowed" : "pointer",
                      opacity: logosSaving[key] ? .6 : 1,
                    }}>
                      <input
                        type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        style={{display:"none"}}
                        disabled={!!logosSaving[key]}
                        onChange={e=>handleLogoUpload(key,setFn,e)}
                      />
                      {logosSaving[key]
                        ? <><svg width="11" height="11" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/></svg> Sauvegarde…</>
                        : state
                          ? <><Icon as={RefreshCw} size={11}/> Remplacer PNG</>
                          : <><Icon as={Plus} size={11}/> Importer PNG</>}
                    </label>
                    {state && !logosSaving[key] && (
                      <button className="btn-d" onClick={()=>handleLogoDelete(key,setFn)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        <Icon as={Trash2} size={11}/>
                        Supprimer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          }

          <div style={{display:"flex",alignItems:"flex-start",gap:8,marginTop:16,padding:"12px 14px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
            <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>Les logos sont sauvegardés dans Supabase et partagés avec toute l'équipe. Formats acceptés : PNG, JPG, WEBP, SVG.</span>
          </div>
        </div>
      )}

      {/* ── Modal suppression ouvrier ── */}
      {ouvrierToDelete !== null && (
        <div onClick={()=>setOuvrierToDelete(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,
                background:"rgba(224,92,92,0.12)",color:"#e15a5a",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cet ouvrier&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              L'ouvrier <strong style={{color:T.text}}>« {ouvriers[ouvrierToDelete]} »</strong> sera retiré de la liste.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Le planning et l'historique existants ne seront pas modifiés.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setOuvrierToDelete(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={confirmRemoveOuvrier} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal suppression chantier ── */}
      {chantierToDelete !== null && (
        <div onClick={()=>setChantierToDelete(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:440,border:`1px solid ${T.border}`,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,
                background:"rgba(224,92,92,0.12)",color:"#e15a5a",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce chantier&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le chantier <strong style={{color:T.text}}>« {chantiers[chantierToDelete]?.nom} »</strong> sera retiré de la liste.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Le phasage, le planning et les rapports déjà saisis ne seront pas supprimés mais ne seront plus liés à un chantier actif.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setChantierToDelete(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={confirmRemoveChantier} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Trash2} size={13}/>
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── EDITOR DE PHRASES (utilisé dans l'onglet Phrases) ───────────────────────
function PhrasesEditor({ catKey, label, items, onChange, T, acc }) {
  const [draftItems, setDraftItems] = useState(items);
  const [newItem, setNewItem] = useState("");

  useEffect(() => { setDraftItems(items); }, [items]);

  const add = () => {
    if (!newItem.trim()) return;
    const next = [...draftItems, newItem.trim()];
    setDraftItems(next);
    onChange(next);
    setNewItem("");
  };
  const remove = (i) => {
    const next = draftItems.filter((_, idx) => idx !== i);
    setDraftItems(next);
    onChange(next);
  };
  const update = (i, val) => {
    const next = draftItems.map((x, idx) => idx === i ? val : x);
    setDraftItems(next);
  };
  const commit = () => onChange(draftItems);

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 14, marginBottom: 14 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: T.textMuted, marginBottom: 10 }}>
        <Icon as={FileText} size={11}/>
        {label}
        {draftItems.length > 0 && <span style={{ color: acc.accent }}>· {draftItems.length}</span>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {draftItems.map((it, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input value={it} onChange={e => update(i, e.target.value)} onBlur={commit}
              placeholder="Phrase…"
              style={{
                flex: 1, padding: "7px 10px", borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.card, color: T.text,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none",
              }}/>
            <button onClick={() => remove(i)} title="Supprimer" style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: `1px solid rgba(224,92,92,0.3)`,
              borderRadius: RADIUS.md, padding: "6px 8px", color: "#e15a5a", cursor: "pointer",
            }}>
              <Icon as={Trash2} size={11}/>
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Ajouter une phrase…"
          onKeyDown={e => e.key === "Enter" && add()}
          style={{
            flex: 1, padding: "7px 10px", borderRadius: RADIUS.md,
            border: `1px dashed ${T.border}`, background: "transparent", color: T.text,
            fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none",
          }}/>
        <button onClick={add} disabled={!newItem.trim()} style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: newItem.trim() ? acc.accent : T.border,
          color: newItem.trim() ? acc.onAccent : T.textMuted,
          border: "none", borderRadius: RADIUS.md, padding: "7px 14px",
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: newItem.trim() ? "pointer" : "not-allowed",
        }}>
          <Icon as={Plus} size={11}/>
          Ajouter
        </button>
      </div>
    </div>
  );
}

// ─── ONGLET ACCÈS ─────────────────────────────────────────────────────────────
// Édition de la matrice rôles × pages pour Réno et Invest, et CRUD des rôles
// (label, couleur, ajout, suppression). Persistance dans planning_config via
// access.saveAccessConfig. Changements propagés en temps réel grâce au channel
// postgres_changes branché dans App.jsx et PageInvest.jsx.
// Exporté pour être réutilisé dans les Réglages de Profero Invest.
export function OngletAcces({ T, acc }) {
  const [branche, setBranche]   = useState("renovation");
  const [roles, setRoles]       = useState([]);
  const [rolePages, setRolePages] = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [savedAt, setSavedAt]   = useState(null);
  const [newRoleOpen, setNewRoleOpen] = useState(false);
  const [newRoleLabel, setNewRoleLabel] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#888888");
  const [editRoleId, setEditRoleId] = useState(null);
  const [editRoleLabel, setEditRoleLabel] = useState("");
  const [editRoleColor, setEditRoleColor] = useState("");
  const [roleToDelete, setRoleToDelete] = useState(null);

  const pages = pagesForBranch(branche);

  // Recharge à chaque changement de branche
  useEffect(() => {
    setLoading(true);
    loadAccessConfig(branche).then(({ roles: r, rolePages: rp }) => {
      setRoles(r);
      setRolePages(rp);
      setLoading(false);
    });
  }, [branche]);

  // Sauvegarde debouncée (1.2s après dernière modif)
  const saveTimer = React.useRef(null);
  const planifierSauvegarde = (nextRoles, nextRolePages) => {
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await saveAccessConfig(branche, { roles: nextRoles, rolePages: nextRolePages });
      setSaving(false);
      if (!error) setSavedAt(new Date());
      else console.error("saveAccessConfig:", error);
    }, 1200);
  };

  // Toggle d'une page pour un rôle
  const toggle = (roleId, pageId) => {
    setRolePages(prev => {
      const cur = Array.isArray(prev[roleId]) ? prev[roleId] : [];
      const next = cur.includes(pageId) ? cur.filter(p => p !== pageId) : [...cur, pageId];
      const nextAll = { ...prev, [roleId]: next };
      planifierSauvegarde(roles, nextAll);
      return nextAll;
    });
  };

  // Cocher / décocher toutes les pages pour un rôle (header de ligne)
  const toggleAll = (roleId) => {
    setRolePages(prev => {
      const cur = Array.isArray(prev[roleId]) ? prev[roleId] : [];
      const allIds = pages.map(p => p.id);
      const allOn = allIds.every(id => cur.includes(id));
      const nextAll = { ...prev, [roleId]: allOn ? [] : allIds };
      planifierSauvegarde(roles, nextAll);
      return nextAll;
    });
  };

  // Cocher / décocher tous les rôles pour une page (header de colonne)
  const togglePageColumn = (pageId) => {
    setRolePages(prev => {
      const allOn = roles.every(r => Array.isArray(prev[r.id]) && prev[r.id].includes(pageId));
      const next = { ...prev };
      for (const r of roles) {
        const cur = Array.isArray(next[r.id]) ? next[r.id] : [];
        next[r.id] = allOn ? cur.filter(p => p !== pageId) : [...new Set([...cur, pageId])];
      }
      planifierSauvegarde(roles, next);
      return next;
    });
  };

  const ajouterRole = () => {
    const label = newRoleLabel.trim();
    if (!label) return;
    const id = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!id || roles.some(r => r.id === id)) {
      alert("Un rôle avec ce nom existe déjà.");
      return;
    }
    const nextRoles = [...roles, { id, label, color: newRoleColor }];
    const nextRolePages = { ...rolePages, [id]: [] };
    setRoles(nextRoles);
    setRolePages(nextRolePages);
    planifierSauvegarde(nextRoles, nextRolePages);
    setNewRoleOpen(false);
    setNewRoleLabel("");
    setNewRoleColor("#888888");
  };

  const sauverEditRole = () => {
    if (!editRoleId) return;
    const label = editRoleLabel.trim() || editRoleId;
    const nextRoles = roles.map(r => r.id === editRoleId ? { ...r, label, color: editRoleColor || r.color } : r);
    setRoles(nextRoles);
    planifierSauvegarde(nextRoles, rolePages);
    setEditRoleId(null);
  };

  const supprimerRole = (roleId) => {
    const nextRoles = roles.filter(r => r.id !== roleId);
    const nextRolePages = { ...rolePages };
    delete nextRolePages[roleId];
    setRoles(nextRoles);
    setRolePages(nextRolePages);
    planifierSauvegarde(nextRoles, nextRolePages);
    setRoleToDelete(null);
  };

  const resetDefaults = () => {
    if (!confirm("Restaurer les rôles et accès par défaut pour cette branche ? Les personnalisations seront perdues.")) return;
    const defR = branche === "invest" ? ROLES_DEFAULT_INVEST : ROLES_DEFAULT_RENOVATION;
    const defRP = branche === "invest" ? ROLE_PAGES_DEFAULT_INVEST : ROLE_PAGES_DEFAULT_RENOVATION;
    setRoles(defR);
    setRolePages(defRP);
    planifierSauvegarde(defR, defRP);
  };

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: T.textMuted }}>Chargement…</div>;
  }

  return (
    <div>
      {/* Sélecteur branche + état sauvegarde */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", borderRadius: RADIUS.md, overflow: "hidden", border: `1px solid ${T.border}` }}>
          {[
            { id: "renovation", label: "Profero Rénovation" },
            { id: "invest",     label: "Profero Invest"     },
          ].map(b => {
            const a = branche === b.id;
            return (
              <button key={b.id} onClick={() => setBranche(b.id)} style={{
                padding: "8px 16px", border: "none", cursor: "pointer",
                background: a ? acc.accent : "transparent",
                color: a ? acc.onAccent : T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700,
              }}>{b.label}</button>
            );
          })}
        </div>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>
          {saving ? "Enregistrement…" : savedAt ? `Enregistré à ${savedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Modifications sauvegardées automatiquement"}
        </span>
        <button onClick={resetDefaults} style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "7px 12px", borderRadius: RADIUS.md,
          background: "transparent", border: `1px solid ${T.border}`, color: T.textSub,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 600, cursor: "pointer",
        }}>
          <Icon as={RefreshCw} size={11}/>
          Restaurer défauts
        </button>
      </div>

      {/* Liste des rôles + ajout */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 1.2, textTransform: "uppercase" }}>
            Rôles définis pour cette branche
          </div>
          <button onClick={() => setNewRoleOpen(true)} style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "7px 12px", borderRadius: RADIUS.md,
            background: acc.accent, color: acc.onAccent, border: "none",
            fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer",
          }}>
            <Icon as={Plus} size={11}/>
            Nouveau rôle
          </button>
        </div>
        {roles.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: T.textMuted, fontStyle: "italic", border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
            Aucun rôle défini. Ajoutez-en un pour configurer les accès.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {roles.map(r => (
              <div key={r.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: RADIUS.pill,
                background: r.color + "22", border: `1.5px solid ${r.color}55`,
                color: r.color, fontWeight: 700, fontSize: FONT.xs.size + 1,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.color }}/>
                {r.label}
                <button onClick={() => { setEditRoleId(r.id); setEditRoleLabel(r.label); setEditRoleColor(r.color); }}
                  title="Modifier" style={{ background: "transparent", border: "none", cursor: "pointer", color: r.color, padding: 2, display: "flex" }}>
                  <Icon as={Pencil} size={10}/>
                </button>
                <button onClick={() => setRoleToDelete(r)} title="Supprimer"
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "#e15a5a", padding: 2, display: "flex" }}>
                  <Icon as={Trash2} size={10}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Matrice rôles × pages */}
      {roles.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.card }}>
                <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, position: "sticky", left: 0, background: T.card, zIndex: 1, minWidth: 200 }}>
                  Pages \ Rôles
                </th>
                {roles.map(r => (
                  <th key={r.id} style={{ padding: "10px 8px", textAlign: "center", minWidth: 110 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "3px 9px", borderRadius: RADIUS.pill,
                        background: r.color + "22", color: r.color,
                        fontSize: 10, fontWeight: 800, letterSpacing: .4,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.color }}/>
                        {r.label}
                      </span>
                      <button onClick={() => toggleAll(r.id)} title="Tout cocher/décocher pour ce rôle"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 9, padding: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>
                        Tout
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pages.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: i < pages.length - 1 ? `1px solid ${T.border}` : "none", background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                  <td style={{ padding: "8px 14px", fontSize: 13, color: T.text, fontWeight: 600, position: "sticky", left: 0, background: i % 2 ? T.surface : T.surface, zIndex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flex: 1 }}>{p.label}</span>
                      <button onClick={() => togglePageColumn(p.id)} title="Tout cocher/décocher pour cette page"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: T.textMuted, fontSize: 9, padding: 2, fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>
                        Tout
                      </button>
                    </div>
                  </td>
                  {roles.map(r => {
                    const allowed = Array.isArray(rolePages[r.id]) && rolePages[r.id].includes(p.id);
                    return (
                      <td key={r.id} style={{ padding: "8px 6px", textAlign: "center" }}>
                        <button onClick={() => toggle(r.id, p.id)} title={allowed ? "Autorisé — clic pour retirer" : "Bloqué — clic pour autoriser"}
                          style={{
                            width: 28, height: 28, borderRadius: 8,
                            background: allowed ? r.color + "33" : "transparent",
                            border: `1.5px solid ${allowed ? r.color : T.border}`,
                            color: allowed ? r.color : T.textMuted,
                            cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
                            transition: "background .12s",
                          }}>
                          <Icon as={allowed ? Check : X} size={14} strokeWidth={2.5}/>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modale : nouveau rôle */}
      {newRoleOpen && (
        <div onClick={() => setNewRoleOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 940, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 420,
            border: `1px solid ${T.border}`, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, marginBottom: 14 }}>Nouveau rôle</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Libellé</label>
              <input value={newRoleLabel} onChange={e => setNewRoleLabel(e.target.value)} placeholder="Ex: Chef de chantier"
                autoFocus style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, padding: "9px 11px", color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none",
                }}/>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Couleur</label>
              <input type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)}
                style={{ width: 60, height: 36, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}/>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setNewRoleOpen(false)} style={{
                padding: "8px 16px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={ajouterRole} disabled={!newRoleLabel.trim()} style={{
                padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
                background: newRoleLabel.trim() ? acc.accent : T.border,
                color: newRoleLabel.trim() ? acc.onAccent : T.textMuted,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: newRoleLabel.trim() ? "pointer" : "not-allowed",
              }}>Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : édition rôle */}
      {editRoleId && (
        <div onClick={() => setEditRoleId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 940, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 420,
            border: `1px solid ${T.border}`, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, marginBottom: 4 }}>Modifier le rôle</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: 14, fontFamily: "'DM Mono',monospace" }}>id : {editRoleId}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Libellé</label>
              <input value={editRoleLabel} onChange={e => setEditRoleLabel(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8, padding: "9px 11px", color: T.text, fontFamily: "inherit", fontSize: 14, outline: "none",
                }}/>
            </div>
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Couleur</label>
              <input type="color" value={editRoleColor} onChange={e => setEditRoleColor(e.target.value)}
                style={{ width: 60, height: 36, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}/>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditRoleId(null)} style={{
                padding: "8px 16px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={sauverEditRole} style={{
                padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
                background: acc.accent, color: acc.onAccent,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation suppression rôle */}
      {roleToDelete && (
        <div onClick={() => setRoleToDelete(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 940, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.modal || T.surface, borderRadius: RADIUS.xl, width: "100%", maxWidth: 440,
            border: `1px solid ${T.border}`, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Icon as={AlertTriangle} size={22} color="#e15a5a"/>
              <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Supprimer le rôle ?</div>
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.5, marginBottom: 18 }}>
              Le rôle <strong style={{ color: T.text }}>{roleToDelete.label}</strong> sera retiré de la matrice. Les utilisateurs qui ont ce rôle perdront tous leurs accès jusqu'à ce qu'un nouveau rôle leur soit attribué.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRoleToDelete(null)} style={{
                padding: "8px 16px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
                background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
              }}>Annuler</button>
              <button onClick={() => supprimerRole(roleToDelete.id)} style={{
                padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
                background: "#e15a5a", color: "#fff",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
              }}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PageAdmin;
