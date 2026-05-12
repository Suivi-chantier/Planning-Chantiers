import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { THEMES, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, getWeekId, getCurrentWeek, LOGO_GROUPE_H, LOGO_RENO_H, LOGO_INVEST_H, getBranchAccent } from "./constants";
import { LayoutGrid, Sun, Moon, LogOut } from "lucide-react";
import { Icon } from "./ui";

import { Sidebar, BottomNav } from "./Navigation";
import PageDashboard          from "./Dashboard";
import PagePlanning           from "./Planning";
import PagePlanningMensuel    from "./PlanningMensuel";
import PageNotesEtTodo        from "./NotesEtTodo";
import PageCommandes          from "./Commandes";
import PageEquipe             from "./Equipe";
import PagePlans              from "./Plans";
import PagePhasage            from "./Phasage";
import PageBibliotheque       from "./Bibliotheque";
import PageBibliothequeMateriaux from "./PageBibliothequeMateriaux";
import PageAdmin              from "./Admin";
import PageRapportMobile      from "./RapportMobile";
import PageInvest             from "./PageInvest";
import PageVisiteChantier     from "./VisiteChantier";
import PageInfoClient         from "./PageInfoClient";
import PageCompteRendu        from "./PageCompteRendu";
import PageChantiers          from "./PageChantiers";

// ─── PERMISSIONS PAR RÔLE ────────────────────────────────────────────────────
const ROLE_PAGES = {
  admin: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes",
    "equipe","plans","phasage","bibliotheque","biblio-materiaux",
    "visite","info-client","compte-rendu","admin"
  ],
  conducteur: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes",
    "equipe","plans","phasage","bibliotheque","biblio-materiaux",
    "visite","info-client","compte-rendu"
  ],
  commercial: [
    "dashboard","chantiers","planning","plans","visite","info-client","compte-rendu"
  ],
  comptable: [
    "dashboard","chantiers","commandes","biblio-materiaux","phasage"
  ],
};

function canAccess(role, page) {
  return (ROLE_PAGES[role] || []).includes(page);
}

// ─── GESTIONNAIRE D'ERREUR GLOBAL ────────────────────────────────────────────
if (typeof window !== "undefined") {
  window.onerror = function(msg, src, line, col, err) {
    document.body.innerHTML = `<div style="background:#1a0000;color:#ff8888;padding:30px;font-family:monospace;min-height:100vh">
      <h2 style="color:#ff4444">🔴 Erreur JS</h2>
      <p><b>Message:</b> ${msg}</p><p><b>Fichier:</b> ${src}</p>
      <p><b>Ligne:</b> ${line}:${col}</p>
      <pre style="margin-top:16px;font-size:12px;opacity:.8">${err?.stack||""}</pre>
    </div>`;
    return false;
  };
  window.onunhandledrejection = function(ev) {
    document.body.innerHTML = `<div style="background:#1a0000;color:#ff8888;padding:30px;font-family:monospace;min-height:100vh">
      <h2 style="color:#ff4444">🔴 Promise rejetée</h2>
      <pre>${ev.reason?.stack || ev.reason}</pre>
    </div>`;
  };
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div style={{background:"#1a0000",color:"#ff8888",padding:30,fontFamily:"monospace",minHeight:"100vh"}}>
        <h2 style={{color:"#ff4444",marginBottom:16}}>🔴 Erreur — {this.state.error?.message}</h2>
        <pre style={{whiteSpace:"pre-wrap",fontSize:12,lineHeight:1.6,opacity:.8}}>{this.state.error?.stack}</pre>
      </div>
    );
    return this.props.children;
  }
}

// ─── CSS COMMUN ───────────────────────────────────────────────────────────────
const CSS_BASE = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Barlow Condensed','Arial Narrow',sans-serif; }
  .login-input {
    width: 100%; background: #1a1d24; border: 1.5px solid #2a2d3a;
    border-radius: 10px; padding: 14px 16px; font-size: 16px;
    font-family: inherit; color: #fff; outline: none; transition: border-color .15s;
  }
  .login-input:focus { border-color: #FFC200; }
  .login-btn {
    width: 100%; padding: 15px; border: none; border-radius: 10px;
    background: #FFC200; color: #111; font-family: inherit;
    font-size: 16px; font-weight: 800; cursor: pointer; letter-spacing: .5px;
    transition: opacity .15s;
  }
  .login-btn:disabled { opacity: .5; cursor: not-allowed; }
  .login-btn:hover:not(:disabled) { opacity: .9; }
  .portal-card {
    background: #111318; border: 1px solid #2a2d3a; border-radius: 20px;
    padding: 36px 32px; cursor: pointer; transition: all .2s; position: relative; overflow: hidden;
    display: flex; flex-direction: column; gap: 16px;
  }
  .portal-card:hover:not(.disabled) {
    border-color: rgba(255,194,0,0.5);
    transform: translateY(-4px);
    box-shadow: 0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,194,0,0.2);
  }
  .portal-card.disabled { cursor: not-allowed; opacity: .55; }
  .portal-card-invest:hover:not(.disabled) {
    border-color: rgba(100,180,255,0.4) !important;
    box-shadow: 0 20px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(100,180,255,0.15) !important;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
`;

// ─── PAGE CRÉATION MOT DE PASSE (invitation) ──────────────────────────────────
function PageCreerMotDePasse({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [erreur, setErreur]     = useState("");
  const [succes, setSucces]     = useState(false);

  const handleSubmit = async () => {
    if (password.length < 8) { setErreur("Le mot de passe doit contenir au moins 8 caractères."); return; }
    if (password !== confirm) { setErreur("Les mots de passe ne correspondent pas."); return; }
    setLoading(true); setErreur("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setErreur("Erreur : " + error.message); setLoading(false); return; }
    setSucces(true);
    setTimeout(() => onDone(), 1500);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#1e2128", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif", padding:"20px" }}>
      <style>{CSS_BASE}</style>
      <div style={{ width:"100%", maxWidth:420 }}>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <img src={LOGO_GROUPE_H} alt="Groupe Profero" style={{ height:64, objectFit:"contain" }}/>
          <div style={{ marginTop:12, fontSize:13, letterSpacing:3, textTransform:"uppercase", color:"rgba(255,194,0,0.5)" }}>
            Bienvenue chez Profero
          </div>
        </div>
        <div style={{ background:"#111318", border:"1px solid #2a2d3a", borderRadius:16, padding:"32px 28px", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#fff", marginBottom:6 }}>Créer votre mot de passe</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", marginBottom:28, lineHeight:1.6 }}>
            Bienvenue ! Définissez votre mot de passe pour accéder à votre espace collaborateur.
          </div>
          {succes ? (
            <div style={{ background:"rgba(80,200,120,0.12)", border:"1px solid rgba(80,200,120,0.3)", borderRadius:8, padding:"14px", fontSize:15, color:"#50c878", textAlign:"center" }}>
              ✓ Mot de passe créé ! Redirection…
            </div>
          ) : (
            <>
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"rgba(255,255,255,0.4)", display:"block", marginBottom:8 }}>Nouveau mot de passe</label>
                <input className="login-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Minimum 8 caractères" onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
              </div>
              <div style={{ marginBottom:24 }}>
                <label style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"rgba(255,255,255,0.4)", display:"block", marginBottom:8 }}>Confirmer le mot de passe</label>
                <input className="login-input" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Répétez le mot de passe" onKeyDown={e=>e.key==="Enter"&&handleSubmit()}/>
              </div>
              {erreur && (
                <div style={{ background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)", borderRadius:8, padding:"10px 14px", fontSize:14, color:"#e05c5c", marginBottom:20 }}>
                  {erreur}
                </div>
              )}
              <button className="login-btn" onClick={handleSubmit} disabled={loading}>
                {loading ? "Enregistrement…" : "Définir mon mot de passe →"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE DE CONNEXION ────────────────────────────────────────────────────────
function PageLogin({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [erreur, setErreur]     = useState("");

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { setErreur("Veuillez remplir tous les champs."); return; }
    setLoading(true); setErreur("");
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setErreur("Email ou mot de passe incorrect."); setLoading(false); return; }
      const { data: profil, error: profilErr } = await supabase
        .from("utilisateurs").select("*").eq("email", data.user.email).single();
      if (profilErr || !profil) {
        setErreur("Compte non trouvé. Contactez l'administrateur.");
        await supabase.auth.signOut(); setLoading(false); return;
      }
      if (!profil.actif) {
        setErreur("Votre compte a été désactivé. Contactez l'administrateur.");
        await supabase.auth.signOut(); setLoading(false); return;
      }
      onLogin(data.user, profil);
    } catch { setErreur("Une erreur est survenue. Réessayez."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#1e2128", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif", padding:"20px" }}>
      <style>{CSS_BASE}</style>
      <div style={{ width:"100%", maxWidth:420 }}>
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <img src={LOGO_GROUPE_H} alt="Groupe Profero" style={{ height:64, objectFit:"contain" }}/>
          <div style={{ marginTop:12, fontSize:13, letterSpacing:3, textTransform:"uppercase", color:"rgba(255,194,0,0.5)" }}>
            Espace collaborateurs
          </div>
        </div>
        <div style={{ background:"#111318", border:"1px solid #2a2d3a", borderRadius:16, padding:"32px 28px", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}>
          <div style={{ fontSize:22, fontWeight:800, color:"#fff", marginBottom:6 }}>Connexion</div>
          <div style={{ fontSize:14, color:"rgba(255,255,255,0.35)", marginBottom:28 }}>Accès réservé aux collaborateurs Profero</div>
          <div style={{ marginBottom:16 }}>
            <label style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"rgba(255,255,255,0.4)", display:"block", marginBottom:8 }}>Email</label>
            <input className="login-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="votre@email.com" onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </div>
          <div style={{ marginBottom:24 }}>
            <label style={{ fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"rgba(255,255,255,0.4)", display:"block", marginBottom:8 }}>Mot de passe</label>
            <input className="login-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
          </div>
          {erreur && (
            <div style={{ background:"rgba(224,92,92,0.12)", border:"1px solid rgba(224,92,92,0.3)", borderRadius:8, padding:"10px 14px", fontSize:14, color:"#e05c5c", marginBottom:20 }}>
              {erreur}
            </div>
          )}
          <button className="login-btn" onClick={handleLogin} disabled={loading}>
            {loading ? "Connexion…" : "Se connecter →"}
          </button>
        </div>
        <div style={{ textAlign:"center", marginTop:20, fontSize:12, color:"rgba(255,255,255,0.2)" }}>
          Problème de connexion ? Contactez l'administrateur.
        </div>
      </div>
    </div>
  );
}

// ─── PORTAIL GROUPE ───────────────────────────────────────────────────────────
function PagePortail({ user, profil, onSelectBranche, onLogout }) {
  const branches    = profil?.branches || ["renovation"];
  const hasReno     = branches.includes("renovation");
  const hasInvest   = branches.includes("invest");
  const ROLE_LABELS = { admin:"Administrateur", conducteur:"Conducteur de travaux", commercial:"Commercial", comptable:"Comptable" };

  return (
    <div style={{ minHeight:"100vh", background:"#1e2128", display:"flex", flexDirection:"column", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif" }}>
      <style>{CSS_BASE}</style>
      <div style={{ padding:"20px 32px", display:"flex", alignItems:"center", justifyContent:"space-between", borderBottom:"1px solid #1a1d24" }}>
        <img src={LOGO_GROUPE_H} alt="Groupe Profero" style={{ height:48, objectFit:"contain" }}/>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:14, fontWeight:700, color:"#fff" }}>{profil?.nom || user?.email}</div>
            <div style={{ fontSize:10, letterSpacing:1.5, textTransform:"uppercase", color:"rgba(255,194,0,0.6)" }}>
              {ROLE_LABELS[profil?.role] || profil?.role}
            </div>
          </div>
          <button onClick={onLogout} style={{ display:"inline-flex",alignItems:"center",gap:6, background:"rgba(224,92,92,0.1)", border:"1px solid rgba(224,92,92,0.25)", borderRadius:8, padding:"8px 14px", color:"#e05c5c", fontSize:13, cursor:"pointer", fontFamily:"inherit", fontWeight:600 }}>
            <Icon as={LogOut} size={14}/>
            Déconnexion
          </button>
        </div>
      </div>
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"40px 20px" }}>
        <div style={{ textAlign:"center", marginBottom:56 }}>
          <img src={LOGO_GROUPE_H} alt="Groupe Profero" style={{ height:72, objectFit:"contain", marginBottom:18 }}/>
          <div style={{ fontSize:32, fontWeight:800, color:"#fff", letterSpacing:.5 }}>Choisissez votre espace</div>
          <div style={{ fontSize:15, color:"rgba(255,255,255,0.3)", marginTop:8 }}>
            Bonjour {profil?.nom?.split(" ")[0] || "vous"} — sélectionnez la branche à laquelle accéder
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:24, width:"100%", maxWidth:720 }}>
          <div className={`portal-card${!hasReno?" disabled":""}`} onClick={()=>hasReno&&onSelectBranche("renovation")}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"linear-gradient(90deg,#FFC200,#ff9500)", borderRadius:"20px 20px 0 0" }}/>
            <div style={{ display:"flex", alignItems:"center", minHeight:56 }}>
              <img src={LOGO_RENO_H} alt="Profero Rénovation" style={{ height:56, objectFit:"contain", objectPosition:"left" }}/>
            </div>
            <div style={{ fontSize:14, color:"rgba(255,255,255,0.4)", lineHeight:1.6 }}>
              Planning chantiers, commandes, équipes, phasage, comptes rendus et suivi de travaux.
            </div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {["Planning","Commandes","Équipe","Phasage","Comptes rendus"].map(tag=>(
                <span key={tag} style={{ fontSize:11, padding:"3px 10px", borderRadius:20, background:"rgba(255,194,0,0.08)", border:"1px solid rgba(255,194,0,0.15)", color:"rgba(255,194,0,0.7)", letterSpacing:.5 }}>{tag}</span>
              ))}
            </div>
            {hasReno
              ? <div style={{ display:"flex", alignItems:"center", gap:8, color:"#FFC200", fontWeight:700, fontSize:14 }}>Accéder <span style={{fontSize:18}}>→</span></div>
              : <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)" }}>Accès non autorisé</div>
            }
          </div>
          <div className={`portal-card portal-card-invest${!hasInvest?" disabled":""}`} onClick={()=>hasInvest&&onSelectBranche("invest")}>
            <div style={{ position:"absolute", top:0, left:0, right:0, height:3, background:"linear-gradient(90deg,#4db8ff,#0077cc)", borderRadius:"20px 20px 0 0" }}/>
            <div style={{ display:"flex", alignItems:"center", minHeight:56 }}>
              <img src={LOGO_INVEST_H} alt="Profero Invest" style={{ height:56, objectFit:"contain", objectPosition:"left" }}/>
            </div>
            <div style={{ fontSize:14, color:"rgba(255,255,255,0.4)", lineHeight:1.6 }}>
              Gestion des investissements immobiliers, suivi de portefeuille et reporting financier.
            </div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:8, padding:"8px 14px", alignSelf:"flex-start" }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#4db8ff", display:"inline-block", animation:"pulse 2s infinite" }}/>
              <span style={{ fontSize:12, color:"rgba(77,184,255,0.8)", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>En cours de développement</span>
            </div>
            {!hasInvest && <div style={{ fontSize:12, color:"rgba(255,255,255,0.25)" }}>Accès non autorisé</div>}
          </div>
        </div>
        <div style={{ marginTop:48, fontSize:12, color:"rgba(255,255,255,0.15)", letterSpacing:1 }}>GROUPE PROFERO · ESPACE INTERNE</div>
      </div>
    </div>
  );
}

// ─── MAIN APP (Rénovation) ────────────────────────────────────────────────────
function MainApp({ user, profil, onLogout, onRetourPortail }) {
  const{year:iY,week:iW}=getCurrentWeek();
  const[year,setYear]=useState(iY);
  const[week,setWeek]=useState(iW);
  const[page,setPage]=useState("dashboard");
  const[theme,setTheme]=useState(()=>localStorage.getItem("theme")||"dark");
  const[view,setView]=useState("planifie");
  const[ouvriers,setOuvriers]=useState(DEFAULT_OUVRIERS);
  const[ouvrierEmails,setOuvrierEmails]=useState({});
  const[tauxHoraires,setTauxHoraires]=useState({});
  const[chantiers,setChantiers]=useState(DEFAULT_CHANTIERS);
  const[cells,setCells]=useState({});
  const[commandes,setCommandes]=useState({});
  const[notesData,setNotesData]=useState({});
  const[syncing,setSyncing]=useState(false);
  const[connected,setConnected]=useState(false);
  const[lastSync,setLastSync]=useState(null);

  const T=THEMES[theme];
  const weekId=getWeekId(year,week);
  const role=profil?.role||"commercial";
  const peutChangerBranche=(profil?.branches||["renovation"]).length>1;

  useEffect(()=>{ if(!canAccess(role,page)) setPage("dashboard"); },[role,page]);

  const loadData=useCallback(async()=>{
    setSyncing(true);
    try{
      const{data:cfg,error:cfgErr}=await supabase.from("planning_config").select("*");
      if(cfgErr)console.error("planning_config:",cfgErr.message);
      else if(cfg?.length)cfg.forEach(r=>{
        if(r.key==="ouvriers")setOuvriers(r.value);
        if(r.key==="taux_horaires")setTauxHoraires(r.value||{});
        if(r.key==="chantiers")setChantiers(r.value);
        if(r.key==="ouvrier_emails")setOuvrierEmails(r.value||{});
      });
      const{data:cd}=await supabase.from("planning_cells").select("*").eq("week_id",weekId);
      if(cd){const m={};cd.forEach(r=>{m[`${r.chantier_id}_${r.jour}`]={planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[],taches:r.taches||[]};});setCells(m);}
      const{data:comd}=await supabase.from("planning_commandes").select("*").eq("week_id",weekId);
      if(comd){const m={};comd.forEach(r=>{m[r.chantier_id]=r.contenu||"";});setCommandes(m);}
      const{data:nd}=await supabase.from("planning_notes").select("*");
      if(nd){const m={};nd.forEach(r=>{m[r.chantier_id]=r.contenu||"";});setNotesData(m);}
      setConnected(true);setLastSync(new Date());
    }catch(e){console.error(e);}
    setSyncing(false);
  },[weekId]);

  useEffect(()=>{loadData();},[loadData]);

  useEffect(()=>{
    const ch=supabase.channel(`planning-${weekId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"planning_cells",filter:`week_id=eq.${weekId}`},p=>{
        const r=p.new||p.old;if(!r)return;
        const key=`${r.chantier_id}_${r.jour}`;
        if(p.eventType==="DELETE")setCells(prev=>{const n={...prev};delete n[key];return n;});
        else setCells(prev=>({...prev,[key]:{planifie:r.planifie||"",reel:r.reel||"",ouvriers:r.ouvriers||[],taches:r.taches||[]}}));
        setLastSync(new Date());
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"planning_config"},p=>{
        const r=p.new;if(!r)return;
        if(r.key==="ouvriers")setOuvriers(r.value);
        if(r.key==="chantiers")setChantiers(r.value);
        if(r.key==="taux_horaires")setTauxHoraires(r.value||{});
        if(r.key==="ouvrier_emails")setOuvrierEmails(r.value||{});
        setLastSync(new Date());
      })
      .subscribe();
    return()=>supabase.removeChannel(ch);
  },[weekId]);

  const saveConfig=async(key,value)=>{
    const{error}=await supabase.from("planning_config")
      .upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"});
    if(error){
      console.error("saveConfig:",error.message);
      setTimeout(()=>supabase.from("planning_config").upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"}),1000);
    }
  };

  const ROLE_LABELS={admin:"Administrateur",conducteur:"Conducteur de travaux",commercial:"Commercial",comptable:"Comptable"};

  const css=`
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Barlow Condensed','Arial Narrow',sans-serif;background:${T.bg};color:${T.text};min-height:100vh}
    ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:${T.bg}}::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:3px}
    textarea,input,select{outline:none;font-family:inherit}
    .cell{background:${T.card};border:1px solid ${T.border};border-radius:8px;padding:8px 10px;min-height:70px;cursor:pointer;transition:all .15s}
    .cell:hover{background:${T.cardHover};border-color:${T.borderHover};transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.15)}
    .cell:hover .cell-add-hint{opacity:.4!important}
    .cell.filled{background:${T.cardFill}}
    .tab{padding:8px 18px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;letter-spacing:.5px;text-transform:uppercase;transition:all .15s}
    .tab.on{background:${T.accent};color:#111;font-weight:800}
    .tab.off{background:${T.card};color:${T.textSub};border:1px solid ${T.border}}
    .tab.off:hover{background:${T.cardHover};color:${T.text}}
    .btn-p{background:${T.accent};color:#111;border:none;border-radius:6px;padding:9px 18px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer}
    .btn-g{background:transparent;color:${T.textSub};border:1px solid ${T.border};border-radius:6px;padding:8px 16px;font-family:inherit;font-size:13px;cursor:pointer}
    .btn-g:hover{background:${T.cardHover};color:${T.text}}
    .btn-d{background:transparent;color:#e05c5c;border:1px solid rgba(224,92,92,0.3);border-radius:6px;padding:5px 10px;font-family:inherit;font-size:12px;cursor:pointer}
    .navbtn{background:${T.card};border:1px solid ${T.border};color:${T.text};border-radius:6px;padding:6px 14px;font-family:inherit;font-size:18px;cursor:pointer}
    .navbtn:hover{background:${T.cardHover}}
    .dot-pulse{width:8px;height:8px;border-radius:50%;background:#50c878;display:inline-block;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .ac{background:${T.surface};border:1px solid ${T.border};border-radius:12px;padding:22px;margin-bottom:14px}
    .ar{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ${T.border}}
    .ar:last-child{border-bottom:none}
    .ti{background:${T.card};border:1px solid ${T.border};border-radius:6px;padding:8px 12px;color:${T.text};font-family:inherit;font-size:14px;flex:1}
    .ti:focus{border-color:${T.accent}}
    .atab{padding:8px 16px;border:none;border-radius:6px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.5px;text-transform:uppercase}
    .atab.on{background:${T.accent};color:#fff}
    .atab.off{background:transparent;color:${T.textSub}}
    .atab.off:hover{color:${T.text}}
    .cdot{width:22px;height:22px;border-radius:50%;cursor:pointer;transition:transform .1s;flex-shrink:0}
    .cdot:hover{transform:scale(1.2)}
    .cdot.sel{outline:3px solid ${T.accent};outline-offset:2px}
    .ib{background:transparent;border:none;cursor:pointer;font-size:14px;padding:2px 3px;opacity:.6;color:${T.text}}
    .ib:hover{opacity:1}
    .bottom-nav-mobile{display:none!important}
    .mobile-only{display:none!important}

    @media (max-width: 767px) {
      /* ============== STRUCTURE GLOBALE ============== */
      .app-sidebar{display:none!important}
      .bottom-nav-mobile{display:flex!important;position:fixed;bottom:0;left:0;right:0;z-index:200;
        background:#16181d;border-top:2px solid #FFC200;align-items:stretch;
        padding-bottom:env(safe-area-inset-bottom)}
      .desktop-only{display:none!important}
      .mobile-only{display:flex!important}
      .page-content-area{padding-bottom:70px!important}
      .page-padding{padding:14px 12px!important}

      /* ============== TOPBAR ============== */
      .app-topbar{display:flex!important;padding:8px 12px!important;gap:8px!important}
      .topbar-logo-mobile{display:block!important}
      .topbar-text-desktop{display:none!important}
      .topbar-sync{padding:3px 8px!important;font-size:11px!important;gap:4px!important}
      .topbar-sync-time{display:none!important}
      .topbar-user-info{display:none!important}
      .topbar-portail-btn{padding:5px 8px!important;font-size:11px!important}
      .topbar-portail-btn-text{display:none!important}
      .topbar-theme-btn{padding:4px 8px!important;font-size:15px!important}
      .topbar-logout-btn{padding:5px 8px!important;font-size:11px!important}
      .topbar-logout-btn-text{display:none!important}

      /* ============== HEADERS DE PAGES ============== */
      .page-header{padding:12px 14px!important;flex-wrap:wrap!important;gap:8px!important}
      .planning-header{padding:10px 12px!important;flex-wrap:wrap;gap:8px!important}
      .planning-title{font-size:14px!important;letter-spacing:.5px!important}
      .navbtn-today{display:none!important}
      .btn-print{display:none!important}

      /* ============== DASHBOARD ============== */
      .dashboard-row-1,.dashboard-row-2{grid-template-columns:1fr!important;gap:12px!important}

      /* ============== MODALES (bottom sheet) ============== */
      .cell-modal-backdrop,.modal-backdrop{align-items:flex-end!important;padding:0!important}
      .cell-modal-box,.modal-box{border-radius:20px 20px 0 0!important;max-height:94vh!important;max-width:100%!important;width:100%!important}
      .cell-modal-body,.modal-body-grid{grid-template-columns:1fr!important}

      /* ============== TABS ============== */
      .tab{padding:7px 12px!important;font-size:12px!important;letter-spacing:.3px!important}
      .atab{padding:6px 10px!important;font-size:11px!important}
      .tabs-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap!important;white-space:nowrap}
      .tabs-scroll::-webkit-scrollbar{display:none}

      /* ============== TABLEAUX ============== */
      .table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
      table{font-size:12px!important}
      .hide-on-mobile{display:none!important}

      /* ============== GRILLES → COLONNE UNIQUE ============== */
      .responsive-grid,.responsive-grid-2,.responsive-grid-3,.responsive-grid-4{grid-template-columns:1fr!important;gap:10px!important}
      .responsive-row{flex-direction:column!important;align-items:stretch!important;gap:8px!important}

      /* ============== FORMULAIRES TACTILES ============== */
      .ti,input[type="text"],input[type="email"],input[type="password"],input[type="number"],input[type="date"],input[type="tel"],input[type="url"],select,textarea{
        font-size:16px!important;
        min-height:42px;
        padding:10px 12px!important;
      }
      textarea{min-height:80px!important}
      .btn-p,.btn-g,.btn-d{min-height:40px;padding:10px 16px!important;font-size:14px!important}
      .navbtn{min-height:38px;min-width:38px;padding:6px 12px!important;font-size:18px!important}

      /* ============== CARTES ============== */
      .ac{padding:14px!important;margin-bottom:10px!important;border-radius:10px!important}

      /* ============== ÉLÉMENTS À MASQUER PAR DÉFAUT ============== */
      .desktop-toolbar{display:none!important}

      /* ============== IFRAMES ============== */
      iframe{max-width:100%!important}
    }

    @media (max-width: 380px) {
      .tab{padding:6px 8px!important;font-size:11px!important}
      .planning-title{font-size:12px!important}
    }
  `;

  return(
    <div style={{display:"flex",height:"100vh",overflow:"hidden"}}>
      <style>{css}</style>
      <div className="app-sidebar"><Sidebar
        page={page} setPage={setPage} T={T} role={role} branch="renovation"
        profil={profil} theme={theme} setTheme={setTheme}
        onLogout={onLogout}
        peutChangerBranche={peutChangerBranche} onRetourPortail={onRetourPortail}
        syncing={syncing} connected={connected} lastSync={lastSync}
      /></div>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,overflow:"hidden"}}>
        <div className="app-topbar" style={{background:T.surface,borderBottom:`2px solid #FFC200`,padding:"8px 28px",alignItems:"center",gap:12,flexShrink:0,display:"none"}}>
          <img src={LOGO_RENO_H} alt="Profero Rénovation" className="topbar-logo-mobile" style={{height:36,objectFit:"contain",display:"none"}}/>
          <div className="topbar-text-desktop" style={{fontSize:11,fontWeight:700,letterSpacing:2,color:"rgba(255,194,0,0.5)",textTransform:"uppercase"}}>
            Profero · Rénovation
          </div>
          <div className="topbar-sync" style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:T.card,borderRadius:8,fontSize:12,color:T.textSub,whiteSpace:"nowrap"}}>
            {syncing
              ?<><span style={{width:8,height:8,borderRadius:"50%",background:"#f5a623",display:"inline-block"}}/> Sync…</>
              :connected
                ?<><span className="dot-pulse"/>{" "}En ligne <span className="topbar-sync-time">{lastSync?`· ${lastSync.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})}`:""}</span></>
                :<><span style={{width:8,height:8,borderRadius:"50%",background:"#e05c5c",display:"inline-block"}}/> Hors ligne</>
            }
          </div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
            <div className="topbar-user-info" style={{textAlign:"right",display:"flex",flexDirection:"column",gap:1}}>
              <span style={{fontSize:13,fontWeight:700,color:T.text}}>{profil?.nom||user?.email}</span>
              <span style={{fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:"rgba(255,194,0,0.6)"}}>{ROLE_LABELS[role]||role}</span>
            </div>
            {peutChangerBranche&&(
              <button onClick={onRetourPortail} title="Retour au portail" className="topbar-portail-btn" style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"rgba(255,194,0,0.08)",border:"1px solid rgba(255,194,0,0.2)",
                borderRadius:6,padding:"6px 12px",color:"rgba(255,194,0,0.85)",fontSize:12,
                cursor:"pointer",fontFamily:"inherit",fontWeight:600,letterSpacing:.3,
              }}>
                <Icon as={LayoutGrid} size={14}/>
                <span className="topbar-portail-btn-text">Portail</span>
              </button>
            )}
            <button className="btn-g topbar-theme-btn" title={theme==="dark"?"Passer en thème clair":"Passer en thème sombre"} onClick={()=>{setTheme(t=>t==="dark"?"light":"dark");localStorage.setItem("theme",theme==="dark"?"light":"dark");}} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"6px 10px"}}>
              <Icon as={theme==="dark"?Sun:Moon} size={16}/>
            </button>
            <button onClick={onLogout} title="Se déconnecter" className="topbar-logout-btn" style={{display:"inline-flex",alignItems:"center",gap:6,background:"rgba(224,92,92,0.1)",border:"1px solid rgba(224,92,92,0.25)",borderRadius:6,padding:"6px 12px",color:"#e05c5c",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
              <Icon as={LogOut} size={14}/>
              <span className="topbar-logout-btn-text">Déconnexion</span>
            </button>
          </div>
        </div>
        <div className="page-content-area" style={{flex:1,display:"flex",minHeight:0,overflow:"hidden"}}>
          {page==="chantiers"         && canAccess(role,"chantiers")         && <PageChantiers chantiers={chantiers} tauxHoraires={tauxHoraires} T={T}/>}
          {page==="dashboard"        && canAccess(role,"dashboard")        && <PageDashboard chantiers={chantiers} cells={cells} commandes={commandes} notesData={notesData} weekId={weekId} T={T} profil={profil}/>}
          {page==="planning"         && canAccess(role,"planning")         && <PagePlanning chantiers={chantiers} ouvriers={ouvriers} ouvrierEmails={ouvrierEmails} cells={cells} setCells={setCells} commandes={commandes} setCommandes={setCommandes} notesData={notesData} setNotesData={setNotesData} weekId={weekId} view={view} setView={setView} year={year} week={week} setYear={setYear} setWeek={setWeek} T={T}/>}
          {page==="planning-mensuel" && canAccess(role,"planning-mensuel") && <PagePlanningMensuel T={T} chantiers={chantiers}/>}
          {page==="notes-todo"       && canAccess(role,"notes-todo")       && <PageNotesEtTodo T={T} profil={profil} chantiers={chantiers}/>}
          {page==="commandes"        && canAccess(role,"commandes")        && <PageCommandes chantiers={chantiers} T={T}/>}
          {page==="equipe"           && canAccess(role,"equipe")           && <PageEquipe chantiers={chantiers} ouvriers={ouvriers} weekId={weekId} cells={cells} T={T}/>}
          {page==="plans"            && canAccess(role,"plans")            && <PagePlans T={T} chantiers={chantiers} branch={branch}/>}
          {page==="phasage"          && canAccess(role,"phasage")          && <PagePhasage chantiers={chantiers} ouvriers={ouvriers} tauxHoraires={tauxHoraires} T={T} branch={branch}/>}
          {page==="bibliotheque"     && canAccess(role,"bibliotheque")     && <PageBibliotheque T={T}/>}
          {page==="biblio-materiaux" && canAccess(role,"biblio-materiaux") && <PageBibliothequeMateriaux T={T}/>}
          {page==="visite"           && canAccess(role,"visite")           && <PageVisiteChantier chantiers={chantiers} ouvriers={ouvriers} T={T}/>}
          {page==="info-client"      && canAccess(role,"info-client")      && <PageInfoClient T={T}/>}
          {page==="compte-rendu"     && canAccess(role,"compte-rendu")     && <PageCompteRendu T={T} chantiers={chantiers}/>}
          {page==="admin"            && canAccess(role,"admin")            && <PageAdmin ouvriers={ouvriers} setOuvriers={setOuvriers} ouvrierEmails={ouvrierEmails} setOuvrierEmails={setOuvrierEmails} tauxHoraires={tauxHoraires} setTauxHoraires={setTauxHoraires} chantiers={chantiers} setChantiers={setChantiers} saveConfig={saveConfig} theme={theme} setTheme={setTheme} T={T} profil={profil}/>}
        </div>
      </div>
      <BottomNav page={page} setPage={setPage} T={T} role={role}/>
    </div>
  );
}

// ─── ROUTEUR RACINE ───────────────────────────────────────────────────────────
export default function App() {
  // authState : "loading" | "login" | "creer-mdp" | "portail" | "renovation" | "invest"
  const [authState, setAuthState] = useState("loading");
  const [user, setUser]           = useState(null);
  const [profil, setProfil]       = useState(null);

  useEffect(() => {
    // Écoute uniquement les nouvelles connexions via lien invitation
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        const hash = window.location.hash;
        const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
        const urlType = params.get("type");

        if (urlType === "invite") {
          window.history.replaceState(null, "", window.location.pathname);
          setUser(session.user);
          setAuthState("creer-mdp");
        }
        // Les connexions normales sont gérées par checkSession / handleLogin
      }
    });

    // Vérifie la session existante au chargement
    const checkSession = async () => {
      // Si on arrive avec un hash d'invitation, on attend onAuthStateChange
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      if (params.get("type") === "invite") return;

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: p } = await supabase
          .from("utilisateurs").select("*").eq("email", session.user.email).single();
        if (p && p.actif) {
          setUser(session.user); setProfil(p);
          const branches = p.branches || ["renovation"];
          setAuthState(branches.length === 1 ? branches[0] : "portail");
        } else {
          await supabase.auth.signOut(); setAuthState("login");
        }
      } else {
        setAuthState("login");
      }
    };

    checkSession();
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (u, p) => {
    setUser(u); setProfil(p);
    const branches = p.branches || ["renovation"];
    setAuthState(branches.length === 1 ? branches[0] : "portail");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null); setProfil(null); setAuthState("login");
  };

  // Après avoir créé son mot de passe, charge le profil et redirige
  const handleMotDePasseCree = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: p } = await supabase
        .from("utilisateurs").select("*").eq("email", session.user.email).single();
      if (p && p.actif) {
        setUser(session.user); setProfil(p);
        const branches = p.branches || ["renovation"];
        setAuthState(branches.length === 1 ? branches[0] : "portail");
      } else {
        setAuthState("login");
      }
    } else {
      setAuthState("login");
    }
  };

  const handleSelectBranche = (b) => setAuthState(b);
  const handleRetourPortail  = () => setAuthState("portail");

  // Page rapport mobile : tolère plusieurs formats d'URL pour survivre aux
  // parseurs d'URL parfois capricieux (apps mobiles, Google Calendar, etc.)
  // qui peuvent tronquer le pathname.
  if (
    window.location.pathname.toLowerCase().startsWith("/rapport") ||
    window.location.hash.toLowerCase().startsWith("#rapport") ||
    window.location.hash.toLowerCase().startsWith("#/rapport") ||
    window.location.search.toLowerCase().includes("rapport")
  ) return <PageRapportMobile />;

  if (authState === "loading") return (
    <div style={{ minHeight:"100vh", background:"#1e2128", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;700;800&display=swap');`}</style>
      <div style={{ textAlign:"center" }}>
        <img src={LOGO_GROUPE_H} alt="Groupe Profero" style={{ height:56, objectFit:"contain", marginBottom:20 }}/>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", letterSpacing:2 }}>CHARGEMENT…</div>
      </div>
    </div>
  );

  if (authState === "creer-mdp") return <PageCreerMotDePasse onDone={handleMotDePasseCree} />;
  if (authState === "login")     return <PageLogin onLogin={handleLogin}/>;
  if (authState === "portail")   return <PagePortail user={user} profil={profil} onSelectBranche={handleSelectBranche} onLogout={handleLogout}/>;

  if (authState === "renovation") return (
    <ErrorBoundary>
      <MainApp user={user} profil={profil} onLogout={handleLogout} onRetourPortail={handleRetourPortail}/>
    </ErrorBoundary>
  );

  if (authState === "invest") return (
    <PageInvest profil={profil} onRetourPortail={handleRetourPortail} onLogout={handleLogout} />
  );

  return null;
}
