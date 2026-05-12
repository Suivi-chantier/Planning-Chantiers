import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, FONT, RADIUS, getBranchAccent } from "./constants";
import { Icon } from "./ui";
import {
  Settings, Users, HardHat, Euro, Building2, Image as ImageIcon, Palette,
  Plus, Trash2, Pencil, Check, X, ChevronUp, ChevronDown, Search, Mail,
  KeyRound, AlertTriangle, RefreshCw, Moon, Sun, Info, Send, UserPlus,
} from "lucide-react";

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

  // Édition
  const [editId, setEditId]   = useState(null);
  const [editData, setEditData] = useState({});

  // Confirmation reset
  const [resetId, setResetId]   = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  const ROLES = [
    { value:"admin",      label:"Administrateur" },
    { value:"conducteur", label:"Conducteur de travaux" },
    { value:"commercial", label:"Commercial" },
    { value:"comptable",  label:"Comptable" },
  ];
  const BRANCHES = [
    { value:"renovation", label:"Rénovation" },
    { value:"invest",     label:"Invest" },
  ];
  const ROLE_LABELS = { admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" };
  const BRANCHE_LABELS = { renovation:"Rénovation", invest:"Invest" };
  const ROLE_COLORS = { admin:"#FFC200", conducteur:"#50c878", commercial:"#4db8ff", comptable:"#c084fc" };

  const charger = async () => {
    setLoading(true);
    const { data } = await supabase.from("utilisateurs").select("*").order("nom");
    setUtilisateurs(data || []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, []);

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
    setInvLoading(true);
    try {
      // 1. Vérifier doublon
      const { data: exist } = await supabase
        .from("utilisateurs").select("id").eq("email", invEmail.trim().toLowerCase()).single();
      if (exist) { flash("err", "Cet email est déjà enregistré."); setInvLoading(false); return; }

      // 2. Envoyer invitation Supabase Auth via Edge Function
      await callAdminUsers({ action: "invite", email: invEmail.trim().toLowerCase() });

      // 3. Créer la ligne profil
      const { error: dbErr } = await supabase.from("utilisateurs").insert({
        email:    invEmail.trim().toLowerCase(),
        nom:      invNom.trim(),
        role:     invRole,
        branches: invBranches,
        actif:    true,
      });
      if (dbErr) { flash("err", "Profil non créé : " + dbErr.message); setInvLoading(false); return; }

      flash("ok", `✓ Invitation envoyée à ${invEmail}. ${invNom} recevra un email pour créer son mot de passe.`);
      setInvEmail(""); setInvNom(""); setInvRole("conducteur"); setInvBranches(["renovation"]);
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
                    background:`${ROLE_COLORS[u.role]}22`, border:`1.5px solid ${ROLE_COLORS[u.role]}55`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:14, fontWeight:800, color:ROLE_COLORS[u.role],
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
                        background:`${ROLE_COLORS[u.role]}18`, color:ROLE_COLORS[u.role],
                        border:`1px solid ${ROLE_COLORS[u.role]}33`,
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

// ─── PAGE ADMIN ───────────────────────────────────────────────────────────────
function PageAdmin({ouvriers,setOuvriers,ouvrierEmails,setOuvrierEmails,tauxHoraires,setTauxHoraires,chantiers,setChantiers,saveConfig,theme,setTheme,T,profil,branch="renovation"}){
  const acc = getBranchAccent(branch);
  const [adminTab,setAdminTab]=useState("ouvriers");
  const [newOuvrier,setNewOuvrier]=useState("");
  const [editOuvrier,setEditOuvrier]=useState(null);
  const [newNom,setNewNom]=useState("");
  const [newColor,setNewColor]=useState(COULEURS_PALETTE[0]);
  const [editChIdx,setEditChIdx]=useState(null);
  const [ouvrierToDelete,setOuvrierToDelete]=useState(null);
  const [chantierToDelete,setChantierToDelete]=useState(null);

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
    ["ouvriers",     "Ouvriers",       HardHat],
    ["taux",         "Taux horaires",  Euro],
    ["chantiers",    "Chantiers",      Building2],
    ["logos",        "Logos",          ImageIcon],
    ["apparence",    "Apparence",      Palette],
    ...(isAdmin ? [["utilisateurs", "Utilisateurs", Users]] : []),
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

      {adminTab==="taux"&&(
        <div className="ac">
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Taux horaires</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18}}>
            Coût horaire de chaque ouvrier — utilisé pour calculer le coût MO dans le phasage.
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

          {/* Synchronisation phasages : crée les phasages manquants pour les
              chantiers existants. À utiliser une seule fois pour rattraper. */}
          <div style={{
            marginTop: 22, padding: "12px 14px",
            background: "rgba(255,194,0,0.06)",
            border: "1px dashed rgba(255,194,0,0.30)",
            borderRadius: 10,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                Lier les chantiers existants aux phasages
              </div>
              <div style={{ fontSize: 11, color: T.textSub, lineHeight: 1.55 }}>
                Crée un phasage vide pour chaque chantier qui n'en a pas encore.
                À utiliser une fois pour rattraper l'historique — les nouveaux
                chantiers seront liés automatiquement.
              </div>
            </div>
            <button onClick={synchroniserPhasages} disabled={syncing} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
              background: syncing ? T.border : acc.accent, color: syncing ? T.textMuted : acc.onAccent,
              fontFamily: "inherit", fontSize: FONT.xs.size+1, fontWeight: 800,
              cursor: syncing ? "not-allowed" : "pointer",
            }}>
              <Icon as={RefreshCw} size={11} style={syncing?{animation:"spin 1s linear infinite"}:undefined}/>
              {syncing ? "Sync…" : "Synchroniser"}
            </button>
            {syncMsg && (
              <div style={{
                flex: "1 1 100%",
                fontSize: 12,
                color: syncMsg.startsWith("⚠") ? "#e15a5a" : "#22c55e",
                fontWeight: 600,
              }}>
                {syncMsg}
              </div>
            )}
          </div>

          {/* Synchronisation comptes rendus */}
          <div style={{
            marginTop: 12, padding: "12px 14px",
            background: "rgba(91,138,245,0.06)",
            border: "1px dashed rgba(91,138,245,0.30)",
            borderRadius: 10,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
                Lier les comptes rendus existants aux chantiers
              </div>
              <div style={{ fontSize: 11, color: T.textSub, lineHeight: 1.55 }}>
                Pour chaque CR sans chantier, cherche un chantier dont le nom apparait
                dans l'adresse du CR et met à jour le lien.
              </div>
            </div>
            <button onClick={synchroniserCRs} disabled={syncingCR} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              padding: "8px 14px", borderRadius: RADIUS.md, border: "none",
              background: syncingCR ? T.border : "#5B8AF5", color: syncingCR ? T.textMuted : "#fff",
              fontFamily: "inherit", fontSize: FONT.xs.size+1, fontWeight: 800,
              cursor: syncingCR ? "not-allowed" : "pointer",
            }}>
              <Icon as={RefreshCw} size={11} style={syncingCR?{animation:"spin 1s linear infinite"}:undefined}/>
              {syncingCR ? "Sync…" : "Synchroniser CR"}
            </button>
            {syncCRMsg && (
              <div style={{
                flex: "1 1 100%",
                fontSize: 12,
                color: syncCRMsg.startsWith("⚠") ? "#e15a5a" : "#22c55e",
                fontWeight: 600,
              }}>
                {syncCRMsg}
              </div>
            )}
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

      {adminTab==="apparence"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Thème d'affichage</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>Chaque membre choisit son thème, sauvegardé sur son appareil.</div>
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            {[["dark",Moon,"Sombre","#1a1f2e","#e8eaf0"],["light",Sun,"Clair","#f0f2f8","#1a1f2e"]].map(([k,IconC,lb,bg,col])=>(
              <div key={k} onClick={()=>{setTheme(k);localStorage.setItem("theme",k);}}
                style={{flex:"1 1 200px",background:bg,border:`2px solid ${theme===k?acc.accent:T.border}`,
                  borderRadius:RADIUS.xl,padding:"24px 16px",cursor:"pointer",textAlign:"center",transition:"border .15s"}}>
                <div style={{
                  width:48,height:48,borderRadius:RADIUS.lg,margin:"0 auto 10px",
                  background:`${col}1A`,color:col,
                  display:"flex",alignItems:"center",justifyContent:"center",
                }}>
                  <Icon as={IconC} size={22}/>
                </div>
                <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:col}}>{lb}</div>
                {theme===k&&(
                  <div style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:FONT.xs.size,color:acc.accent,marginTop:6,fontWeight:700}}>
                    <Icon as={Check} size={11}/>
                    Actif
                  </div>
                )}
              </div>
            ))}
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

export default PageAdmin;
