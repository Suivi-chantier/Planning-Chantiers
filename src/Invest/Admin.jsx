import React, { useState, useEffect, useRef, useCallback, useImperativeHandle, useMemo } from "react";
import { supabase } from "../supabase";
import { LOGO_INVEST_H, LOGO_INVEST_V, FONT, RADIUS, SPACING, SEMANTIC, getBranchAccent } from "../constants";
import { Icon } from "../ui";
import { loadAccessConfig, canAccess as canAccessInvest, ROLE_PAGES_DEFAULT_INVEST, PAGES_INVEST } from "../access";
import { OngletAcces } from "../Renovation/Admin";
import {
  LayoutDashboard, Users, Building2, BarChart3, Settings, Plus, Trash2,
  Pencil, ChevronRight, ChevronLeft, Search, RefreshCw, Save, Download,
  X, Check, Phone, Calendar, MessageSquare, FileText, Mail, Home,
  TrendingUp, Wallet, Euro, MapPin, ExternalLink, Filter, ArrowLeft,
  Lock, AlertTriangle, ChevronDown, ChevronUp, Eye, Image as ImageIcon,
  Upload, Copy, Sparkles, Sun, Moon, LogOut, LayoutGrid, Send, Phone as PhoneIcon,
  Handshake, Bell, Briefcase, Hammer,
} from "lucide-react";

import {
  INVEST_ACC, LOT_TYPES, NIVEAUX, MAX_LOTS, GESTION_PRICES, DEFAULT_LOTS, BUDGET_SECTIONS, COMP_FISCA, pmt, fmt, fmtPct, fmtMois, actLots, initBudgetState, openFicheClientInvestisseurPDF, THEMES_INV, SU, WA, DA, IN, getCSS, CSS, NumInput, ETAPES_CLIENT, TYPES_PLANNING_INVEST, isoDate, getWeekRange, isActionLateOrThisWeek, normTxt, compareValues, SortableHeader, KPICard, DASH_STAGE_COLORS, fmtDashboardEur, fmtDashboardPct, safeDate, daysBetween, isFilledDash, getClientName, getBienLabel, getBienScore, isBienFicheComplete, hasSimulateurBien, isGeolocBien, CLIENT_STRATEGIES_INVEST, CLIENT_TRAVAUX_ACCEPTES, CLIENT_URGENCE_INVEST, CLIENT_FISCALITES_INVEST, OFFRE_STATUTS_INVEST, CLIENT_DOCUMENT_CHECKLIST, BIEN_DOCUMENT_CHECKLIST, emptyClientStrategy, clientStrategy, checklistPct, getNumberLoose, bienTotalCost, bienLotsCount, computeAutoBienScore, computeClientBienMatch, DashboardPanel, DashboardAlertList, FILE_ICONS, DOCUMENT_CATEGORIES_BIEN, GOOGLE_DRIVE_API_KEY, GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_APP_ID, GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_LINKS_TABLE, getGoogleDriveConfig, GOOGLE_DRIVE_SCRIPT_PROMISES, loadExternalScriptOnce, GOOGLE_DRIVE_FOLDER_MIME, GOOGLE_DRIVE_SHORTCUT_MIME, isGoogleDriveFolderMime, isGoogleDriveShortcutMime, getDriveEffectiveId, getDriveEffectiveMimeType, isGoogleDriveFolderItem, isGoogleDriveShortcutItem, getDriveUrlForDoc, normalizeDriveDoc, getFileIcon, fmtSize, GoogleDriveLinksSection, DocumentsSection, MISSION_COLLABORATEURS, HONORAIRE_BASE_CONTRAT_HT, HONORAIRE_CONSEIL_MOYEN_HT, STATUTS_PROP, CompletionBar
} from "./_shared";

function AdminInvest({ profil, T, theme, setTheme }) {
  const [onglet, setOnglet] = useState("utilisateurs");
  const isAdmin = profil?.role === "admin";

  if (!isAdmin) return (
    <div style={{ padding:"40px 28px", textAlign:"center" }}>
      <div style={{ fontSize:36, marginBottom:14 }}>🔒</div>
      <div style={{ fontSize:18, fontWeight:700, color:T.text, marginBottom:8 }}>Accès restreint</div>
      <div style={{ fontSize:14, color:T.textSub }}>Seuls les administrateurs peuvent accéder à cette section.</div>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", maxWidth:900, margin:"0 auto" }}>
      <div style={{ fontSize:26, fontWeight:800, color:T.text, letterSpacing:.5, marginBottom:4 }}>Réglages</div>
      <div style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Administration de l'application Profero Invest.</div>

      {/* Onglets */}
      <div style={{ display:"flex", gap:4, marginBottom:24, borderBottom:`1px solid ${T.border}`, paddingBottom:8, flexWrap:"wrap" }}>
        {[["utilisateurs","👥 Utilisateurs"],["acces","🔒 Accès"],["apparence","🎨 Apparence"]].map(([k,l])=>(
          <button key={k}
            onClick={() => setOnglet(k)}
            style={{
              padding:"8px 18px", border:"none", borderRadius:6, cursor:"pointer",
              fontFamily:"'Barlow Condensed',sans-serif", fontSize:14, fontWeight:700,
              letterSpacing:.5, textTransform:"uppercase",
              background: onglet===k ? T.accent : "transparent",
              color: onglet===k ? "white" : T.textSub,
              transition:"all .15s",
            }}>
            {l}
          </button>
        ))}
      </div>

      {/* Onglet Utilisateurs — réutilise le même composant que Rénovation */}
      {onglet === "utilisateurs" && <OngletUtilisateursInvest T={T} />}

      {/* Onglet Accès — composant partagé avec les Réglages Rénovation */}
      {onglet === "acces" && (
        <OngletAcces T={T} acc={{ accent: T.accent, onAccent: "#fff", bg10: T.accentBg }}/>
      )}

      {/* Onglet Apparence */}
      {onglet === "apparence" && (
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px" }}>
          <div style={{ fontWeight:700, fontSize:16, marginBottom:4, color:T.text }}>Thème d'affichage</div>
          <div style={{ color:T.textSub, fontSize:13, marginBottom:18 }}>Sauvegardé sur cet appareil, indépendant de Rénovation.</div>
          <div style={{ display:"flex", gap:14 }}>
            {[["dark","🌙","Sombre"],["light","☀️","Clair"]].map(([k,ic,lb])=>(
              <div key={k} onClick={() => { setTheme(k); localStorage.setItem("invest_theme",k); }}
                style={{
                  flex:1, background: k==="dark"?"#1a1d24":"#f0f4f8",
                  border:`3px solid ${theme===k ? T.accent : T.border}`,
                  borderRadius:12, padding:"22px 16px", cursor:"pointer", textAlign:"center", transition:"border .15s",
                }}>
                <div style={{ fontSize:30, marginBottom:8 }}>{ic}</div>
                <div style={{ fontSize:14, fontWeight:700, color: k==="dark"?"#e8eaf0":"#1a2d4a" }}>{lb}</div>
                {theme===k && <div style={{ fontSize:11, color:T.accent, marginTop:6 }}>✓ Actif</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Copie de OngletUtilisateurs adaptée au thème Invest
function OngletUtilisateursInvest({ T }) {
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [erreur, setErreur]             = useState("");
  const [succes, setSucces]             = useState("");
  const [showForm, setShowForm]         = useState(false);
  const [invEmail, setInvEmail]         = useState("");
  const [invNom, setInvNom]             = useState("");
  const [invRole, setInvRole]           = useState("conducteur");
  const [invBranches, setInvBranches]   = useState(["invest"]);
  const [invLoading, setInvLoading]     = useState(false);
  const [editId, setEditId]             = useState(null);
  const [editData, setEditData]         = useState({});
  const [resetId, setResetId]           = useState(null);
  const [resetEmail, setResetEmail]     = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  // Liste de rôles chargée dynamiquement (union Réno + Invest).
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

  const flash = (type, msg) => {
    if (type==="ok") { setSucces(msg); setErreur(""); setTimeout(()=>setSucces(""),4000); }
    else             { setErreur(msg); setSucces(""); setTimeout(()=>setErreur(""),5000); }
  };
  const toggleBranche = (branches, val) =>
    branches.includes(val) ? branches.filter(b=>b!==val) : [...branches, val];

  const callAdminUsers = async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${session?.access_token}`,
          "apikey": import.meta.env.VITE_SUPABASE_KEY,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur serveur");
    return data;
  };

  const inviter = async () => {
    if (!invEmail.trim() || !invNom.trim()) { flash("err","Email et nom obligatoires."); return; }
    if (!invBranches.length) { flash("err","Sélectionnez au moins une branche."); return; }
    setInvLoading(true);
    try {
      const { data: exist } = await supabase.from("utilisateurs").select("id").eq("email",invEmail.trim().toLowerCase()).single();
      if (exist) { flash("err","Cet email est déjà enregistré."); setInvLoading(false); return; }
      await callAdminUsers({ action:"invite", email:invEmail.trim().toLowerCase() });
      const { error: dbErr } = await supabase.from("utilisateurs").insert({
        email:invEmail.trim().toLowerCase(), nom:invNom.trim(),
        role:invRole, branches:invBranches, actif:true,
      });
      if (dbErr) { flash("err","Profil non créé : "+dbErr.message); setInvLoading(false); return; }
      flash("ok",`✓ Invitation envoyée à ${invEmail}.`);
      setInvEmail(""); setInvNom(""); setInvRole("conducteur"); setInvBranches(["invest"]);
      setShowForm(false); charger();
    } catch(e) { flash("err","Erreur : "+e.message); }
    setInvLoading(false);
  };

  const sauvegarder = async (id) => {
    if (!editData.nom?.trim()) { flash("err","Nom obligatoire."); return; }
    const { error } = await supabase.from("utilisateurs")
      .update({ nom:editData.nom.trim(), role:editData.role, branches:editData.branches }).eq("id",id);
    if (error) { flash("err","Erreur : "+error.message); return; }
    flash("ok","✓ Modifications enregistrées."); setEditId(null); charger();
  };

  const toggleActif = async (u) => {
    const { error } = await supabase.from("utilisateurs").update({ actif:!u.actif }).eq("id",u.id);
    if (error) { flash("err","Erreur : "+error.message); return; }
    flash("ok", u.actif ? `✓ ${u.nom} désactivé(e).` : `✓ ${u.nom} réactivé(e).`);
    charger();
  };

  const resetPassword = async () => {
    setResetLoading(true);
    try {
      await callAdminUsers({ action:"reset_password", email:resetEmail });
      flash("ok",`✓ Email de réinitialisation envoyé à ${resetEmail}.`);
      setResetId(null); setResetEmail("");
    } catch(e) { flash("err","Erreur : "+e.message); }
    setResetLoading(false);
  };

  // Styles adaptés au thème Invest
  const cardStyle = { background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"20px 18px" };
  const labelStyle = { fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 };
  const inputStyle = { width:"100%", background:T.input, border:`1.5px solid ${T.border}`, borderRadius:6, padding:"8px 12px", color:T.text, fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, outline:"none" };
  const rowStyle   = { padding:"14px 0", borderBottom:`1px solid ${T.border}` };

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:16, color:T.text, marginBottom:3 }}>Collaborateurs</div>
          <div style={{ color:T.textSub, fontSize:13 }}>Gérez les accès, rôles et branches.</div>
        </div>
        <button className="inv-btn inv-btn-gold" onClick={() => { setShowForm(!showForm); setErreur(""); }}>
          {showForm ? "✕ Annuler" : "+ Inviter"}
        </button>
      </div>

      {/* Messages */}
      {succes && <div style={{ background:"rgba(80,200,120,0.12)", border:"1px solid rgba(80,200,120,0.3)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#50c878", marginBottom:14, lineHeight:1.6 }}>{succes}</div>}
      {erreur && <div style={{ background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#e05c5c", marginBottom:14 }}>{erreur}</div>}

      {/* Formulaire invitation */}
      {showForm && (
        <div style={{ ...cardStyle, marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:14, color:T.text, marginBottom:16 }}>Nouveau collaborateur</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Nom complet *</label><input style={inputStyle} value={invNom} onChange={e=>setInvNom(e.target.value)} placeholder="Prénom Nom"/></div>
            <div><label style={labelStyle}>Email *</label><input style={{...inputStyle,textAlign:"left"}} type="email" value={invEmail} onChange={e=>setInvEmail(e.target.value)} placeholder="email@profero.fr"/></div>
            <div>
              <label style={labelStyle}>Rôle</label>
              <select style={inputStyle} value={invRole} onChange={e=>setInvRole(e.target.value)}>
                {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Branches</label>
              <div style={{ display:"flex", gap:8 }}>
                {BRANCHES.map(b=>(
                  <button key={b.value} onClick={()=>setInvBranches(toggleBranche(invBranches,b.value))}
                    style={{ flex:1, padding:"8px 0", borderRadius:8, border:"1.5px solid", fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer",
                      background: invBranches.includes(b.value) ? "rgba(77,184,255,0.12)" : "transparent",
                      borderColor: invBranches.includes(b.value) ? T.accent : T.border,
                      color: invBranches.includes(b.value) ? T.accent : T.textSub,
                    }}>{b.label}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#4db8ff", marginBottom:14, lineHeight:1.6 }}>
            📧 Un lien d'invitation sera envoyé à <strong>{invEmail||"l'adresse saisie"}</strong>.
          </div>
          <button className="inv-btn inv-btn-gold" style={{ width:"100%", padding:"11px", justifyContent:"center" }} onClick={inviter} disabled={invLoading}>
            {invLoading ? "Envoi…" : "Envoyer l'invitation →"}
          </button>
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign:"center", padding:"40px 0", color:T.textSub }}>Chargement…</div>
      ) : (
        <div style={cardStyle}>
          {utilisateurs.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:13, fontStyle:"italic" }}>Aucun collaborateur.</div>
          ) : utilisateurs.map(u => (
            <div key={u.id} style={rowStyle}>
              {editId === u.id ? (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                    <div><label style={labelStyle}>Nom</label><input style={inputStyle} value={editData.nom} onChange={e=>setEditData({...editData,nom:e.target.value})}/></div>
                    <div>
                      <label style={labelStyle}>Rôle</label>
                      <select style={inputStyle} value={editData.role} onChange={e=>setEditData({...editData,role:e.target.value})}>
                        {ROLES.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>Branches</label>
                    <div style={{ display:"flex", gap:8 }}>
                      {BRANCHES.map(b=>(
                        <button key={b.value} onClick={()=>setEditData({...editData,branches:toggleBranche(editData.branches||[],b.value)})}
                          style={{ padding:"7px 18px", borderRadius:8, border:"1.5px solid", fontFamily:"'Barlow Condensed',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer",
                            background:(editData.branches||[]).includes(b.value)?"rgba(77,184,255,0.12)":"transparent",
                            borderColor:(editData.branches||[]).includes(b.value)?T.accent:T.border,
                            color:(editData.branches||[]).includes(b.value)?T.accent:T.textSub,
                          }}>{b.label}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:8 }}>
                    <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={()=>sauvegarder(u.id)}>✓ Enregistrer</button>
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>setEditId(null)}>Annuler</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  {/* Avatar */}
                  <div style={{ width:38, height:38, borderRadius:10, flexShrink:0, background:`${(ROLE_COLORS[u.role] || "#888888")}22`, border:`1.5px solid ${(ROLE_COLORS[u.role] || "#888888")}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:(ROLE_COLORS[u.role] || "#888888") }}>
                    {u.nom?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                  </div>
                  {/* Infos */}
                  <div style={{ flex:1, minWidth:160 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:15, color: u.actif ? T.text : T.textMuted }}>{u.nom}</span>
                      {!u.actif && <span style={{ fontSize:10, padding:"2px 7px", borderRadius:4, background:"rgba(224,92,92,0.12)", color:"#e05c5c", fontWeight:700 }}>Désactivé</span>}
                    </div>
                    <div style={{ fontSize:12, color:T.textMuted, marginTop:2 }}>{u.email}</div>
                    <div style={{ display:"flex", gap:6, marginTop:5, flexWrap:"wrap" }}>
                      <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:700, background:`${(ROLE_COLORS[u.role] || "#888888")}18`, color:(ROLE_COLORS[u.role] || "#888888"), border:`1px solid ${(ROLE_COLORS[u.role] || "#888888")}33` }}>
                        {ROLE_LABELS[u.role]||u.role}
                      </span>
                      {(u.branches||["renovation"]).map(b=>(
                        <span key={b} style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:600, background:"rgba(77,184,255,0.08)", color:T.accent, border:`1px solid rgba(77,184,255,0.2)` }}>
                          {BRANCHE_LABELS[b]||b}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Actions */}
                  <div style={{ display:"flex", gap:6, flexShrink:0, flexWrap:"wrap" }}>
                    <button className="inv-btn inv-btn-out inv-btn-sm" onClick={()=>{ setEditId(u.id); setEditData({nom:u.nom,role:u.role,branches:u.branches||["invest"]}); }}>✏️ Modifier</button>
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={()=>{ setResetId(u.id); setResetEmail(u.email); }}><Icon as={RefreshCw} size={12} strokeWidth={2.2}/> Réinit.</button>
                    <button className="inv-btn inv-btn-sm" style={{ background: u.actif?"rgba(224,92,92,0.08)":"rgba(80,200,120,0.08)", color: u.actif?"#e05c5c":"#50c878", border:`1px solid ${u.actif?"rgba(224,92,92,0.3)":"rgba(80,200,120,0.3)"}` }} onClick={()=>toggleActif(u)}>
                      {u.actif?"Désactiver":"Réactiver"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal reset MDP */}
      {resetId && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500 }}>
          <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"28px 30px", maxWidth:380, width:"90%", textAlign:"center" }}>
            <div style={{
              width:52, height:52, borderRadius:"50%", margin:`0 auto ${SPACING.md-2}px`,
              background:THEMES_INV.dark.accentBg, border:`2px solid ${THEMES_INV.dark.accentBorder}`,
              display:"flex", alignItems:"center", justifyContent:"center", color:THEMES_INV.dark.accent,
            }}><Icon as={RefreshCw} size={24} strokeWidth={2}/></div>
            <div style={{ fontSize:16, fontWeight:800, color:T.text, marginBottom:8 }}>Réinitialiser le mot de passe ?</div>
            <div style={{ fontSize:13, color:T.textSub, marginBottom:6, lineHeight:1.6 }}>Un email sera envoyé à</div>
            <div style={{ fontSize:14, fontWeight:700, color:T.accent, marginBottom:22 }}>{resetEmail}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button className="inv-btn inv-btn-out" onClick={()=>{ setResetId(null); setResetEmail(""); }}>Annuler</button>
              <button className="inv-btn inv-btn-gold" onClick={resetPassword} disabled={resetLoading}>{resetLoading?"Envoi…":"Envoyer →"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminInvest;
export { AdminInvest, OngletUtilisateursInvest };