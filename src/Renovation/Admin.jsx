import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, LOTS_DEFAUT, GROUPES_TYPES_DEFAUT, EQUIPES_DEFAUT, TAUX_MO_PREV_DEFAUT, matchFournisseur, isLocalLoginEmail, loginEmailFromIdentifiant, identifiantFromLoginEmail, IDENTIFIANT_REGEX, normalizeBranches } from "../constants";
import { Icon } from "../ui";
import { PROFIL_4J, PROFIL_5J, RYTHME_DATE_DEBUT, getISOWeek, libelleRythme } from "../rythmeSemaine";
import { buildPointagesRapport, rangRapportDuJour, repartTrajetCents } from "../pointages";
import {
  Settings, Users, HardHat, Euro, Building2, Palette,
  Plus, Trash2, Pencil, Check, X, ChevronUp, ChevronDown, Search, Mail,
  KeyRound, AlertTriangle, RefreshCw, Moon, Sun, Info, Send, UserPlus,
  LayoutDashboard, Database, Briefcase, Clock, Wrench,
  Download, ClipboardCheck, Activity, ChevronRight, Truck, Lock,
  Boxes, Car, Eye, ListOrdered, Receipt, Home,
} from "lucide-react";
import {
  loadAccessConfig, saveAccessConfig, pagesForBranch,
  ROLES_DEFAULT_RENOVATION, ROLES_DEFAULT_INVEST,
  ROLE_PAGES_DEFAULT_RENOVATION, ROLE_PAGES_DEFAULT_INVEST,
} from "../access";
import EspaceOuvrier from "./EspaceOuvrier";
import PlanningResourcesAdmin from "./PlanningResourcesAdmin";
// Seuils des factures de situation (frise du cycle de vie, phase Travaux).
import { SEUILS_SITUATIONS, normaliserSeuilsSituations } from "./cycleVie";

// ─── APPEL EDGE FUNCTION ──────────────────────────────────────────────────────
const callEdgeFunction = async (fnName, payload) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${fnName}`,
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
// Invitations / reset par email (fonction historique, non versionnée ici).
const callAdminUsers = (payload) => callEdgeFunction("admin-users", payload);
// Comptes sans email : création identifiant+mdp, liaison d'email, mdp direct
// (supabase/functions/admin-users-local/index.ts).
const callAdminUsersLocal = (payload) => callEdgeFunction("admin-users-local", payload);

// ─── ONGLET MAIL ENCOURS ──────────────────────────────────────────────────────
// Choix des utilisateurs qui reçoivent le récap "Encours fournisseurs" envoyé
// automatiquement chaque vendredi soir (cron GitHub Actions → /api/cron-encours-fournisseurs).
// La liste est persistée dans planning_config.encours_mail_destinataires (tableau d'emails).
function OngletMailEncours({ T, acc }) {
  const [users, setUsers]     = useState([]);
  const [selected, setSelected] = useState([]); // emails cochés
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState(null);  // { type:"ok"|"err", txt }

  const ROLE_LABELS = { admin:"Administrateur", conducteur:"Conducteur", commercial:"Commercial", comptable:"Comptable", ouvrier:"Ouvrier" };

  useEffect(() => {
    (async () => {
      const [uRes, cfgRes] = await Promise.all([
        supabase.from("utilisateurs").select("id,nom,email,role,actif").order("nom"),
        supabase.from("planning_config").select("value").eq("key", "encours_mail_destinataires").maybeSingle(),
      ]);
      // Les comptes sans email (identifiant@profero.local) ne peuvent pas recevoir de mail.
      setUsers((uRes.data || []).filter(u => u.email && !isLocalLoginEmail(u.email)));
      const val = cfgRes.data?.value;
      const list = Array.isArray(val) ? val : (Array.isArray(val?.emails) ? val.emails : []);
      setSelected(list.filter(Boolean));
      setLoading(false);
    })();
  }, []);

  const flash = (type, txt) => { setMsg({ type, txt }); setTimeout(() => setMsg(null), 4000); };
  const toggle = (email) =>
    setSelected(s => s.includes(email) ? s.filter(e => e !== email) : [...s, email]);

  const enregistrer = async () => {
    setSaving(true);
    const { error } = await supabase.from("planning_config")
      .upsert({ key: "encours_mail_destinataires", value: selected }, { onConflict: "key" });
    setSaving(false);
    if (error) flash("err", "Erreur : " + error.message);
    else flash("ok", selected.length
      ? `${selected.length} destinataire${selected.length > 1 ? "s" : ""} enregistré${selected.length > 1 ? "s" : ""}.`
      : "Liste vidée — le mail partira aux admin + comptable actifs par défaut.");
  };

  const actifs = users.filter(u => u.actif !== false);
  const inactifs = users.filter(u => u.actif === false);

  const ligneUser = (u) => {
    const on = selected.includes(u.email);
    return (
      <button key={u.id} type="button" onClick={() => toggle(u.email)}
        style={{
          display:"flex",alignItems:"center",gap:12,width:"100%",textAlign:"left",
          padding:"11px 14px",borderRadius:RADIUS.md,cursor:"pointer",
          border:`1px solid ${on ? acc.accent : T.border}`,
          background:on ? acc.bg10 : T.card,
          fontFamily:"inherit",transition:"all .12s",marginBottom:8,
        }}>
        <div style={{
          width:20,height:20,borderRadius:6,flexShrink:0,
          border:`2px solid ${on ? acc.accent : T.border}`,
          background:on ? acc.accent : "transparent",
          display:"flex",alignItems:"center",justifyContent:"center",
        }}>
          {on && <Icon as={Check} size={13} color={acc.onAccent} strokeWidth={3}/>}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {u.nom || u.email}
          </div>
          <div style={{fontSize:FONT.xs.size,color:T.textMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {u.email}
          </div>
        </div>
        <span style={{
          fontSize:FONT.xs.size-1,fontWeight:700,color:T.textSub,
          background:T.bg,border:`1px solid ${T.border}`,borderRadius:999,padding:"3px 9px",flexShrink:0,
        }}>
          {ROLE_LABELS[u.role] || u.role}
        </span>
      </button>
    );
  };

  return (
    <div className="ac">
      {/* En-tête */}
      <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:16}}>
        <div style={{
          width:34,height:34,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}>
          <Icon as={Send} size={17}/>
        </div>
        <div>
          <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Mail « Encours fournisseurs »</div>
          <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,maxWidth:560}}>
            Cochez les utilisateurs qui recevront le récap des encours par mail, envoyé automatiquement
            <strong style={{color:T.textSub}}> chaque vendredi soir</strong>.
          </div>
        </div>
      </div>

      {/* Bandeau info */}
      <div style={{
        display:"flex",gap:10,alignItems:"flex-start",padding:"11px 14px",marginBottom:16,
        background:acc.bg10,border:`1px solid ${acc.accent}44`,borderRadius:RADIUS.md,
      }}>
        <Icon as={Info} size={15} color={acc.accent} style={{marginTop:1,flexShrink:0}}/>
        <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.5}}>
          Si aucun destinataire n'est coché, le mail est envoyé par défaut aux comptes
          <strong> administrateur</strong> et <strong>comptable</strong> actifs.
        </div>
      </div>

      {msg && (
        <div style={{
          padding:"9px 13px",borderRadius:RADIUS.md,marginBottom:14,fontSize:FONT.xs.size+1,fontWeight:600,
          background:msg.type==="ok" ? "#22c55e18" : "#ef444418",
          color:msg.type==="ok" ? "#16a34a" : "#dc2626",
          border:`1px solid ${msg.type==="ok" ? "#22c55e55" : "#ef444455"}`,
        }}>{msg.txt}</div>
      )}

      {loading ? (
        <div style={{color:T.textMuted,fontSize:FONT.sm.size,padding:"20px 0"}}>Chargement…</div>
      ) : (
        <>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,gap:12,flexWrap:"wrap"}}>
            <div style={{fontSize:FONT.xs.size,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:.5}}>
              Destinataires ({selected.length} sélectionné{selected.length>1?"s":""})
            </div>
            <button type="button" onClick={enregistrer} disabled={saving}
              style={{
                display:"inline-flex",alignItems:"center",gap:7,padding:"9px 18px",borderRadius:RADIUS.md,
                border:"none",background:acc.accent,color:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                cursor:saving?"default":"pointer",opacity:saving?.6:1,
              }}>
              <Icon as={Check} size={14} strokeWidth={3}/>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>

          {actifs.map(ligneUser)}

          {inactifs.length > 0 && (
            <>
              <div style={{fontSize:FONT.xs.size,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:.5,margin:"16px 0 8px"}}>
                Comptes inactifs
              </div>
              {inactifs.map(ligneUser)}
            </>
          )}

          {users.length === 0 && (
            <div style={{color:T.textMuted,fontSize:FONT.sm.size,padding:"14px 0"}}>
              Aucun utilisateur avec adresse email.
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  // Mode de création : "email" (invitation classique) ou "identifiant" (compte
  // sans email — identifiant + mot de passe, email liable plus tard).
  const [invMode, setInvMode]         = useState("email");
  const [invEmail, setInvEmail]       = useState("");
  const [invIdentifiant, setInvIdentifiant] = useState("");
  const [invPassword, setInvPassword] = useState("");
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

  // Confirmation reset (comptes avec email) / définition directe (comptes locaux)
  const [resetId, setResetId]   = useState(null);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetIsLocal, setResetIsLocal] = useState(false);
  const [resetNewPwd, setResetNewPwd]   = useState("");

  // Lier un email à un compte créé sans email
  const [linkUser, setLinkUser]       = useState(null); // ligne utilisateurs
  const [linkEmail, setLinkEmail]     = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

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
    setUtilisateurs((data || []).map(u => ({ ...u, branches: normalizeBranches(u.branches) })));
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

  // ── Inviter / créer ───────────────────────────────────────────────────────
  const inviter = async () => {
    const modeLocal = invMode === "identifiant";
    if (!invNom.trim()) { flash("err", "Le nom est obligatoire."); return; }
    if (!modeLocal && !invEmail.trim()) { flash("err", "Email et nom sont obligatoires."); return; }
    const identifiant = invIdentifiant.trim().toLowerCase();
    if (modeLocal) {
      if (!IDENTIFIANT_REGEX.test(identifiant)) {
        flash("err", "Identifiant invalide : 2 à 30 caractères, lettres minuscules, chiffres, . _ - autorisés.");
        return;
      }
      if (invPassword.length < 8) { flash("err", "Le mot de passe doit contenir au moins 8 caractères."); return; }
    }
    if (invBranches.length === 0) { flash("err", "Sélectionnez au moins une branche."); return; }
    // Pour un ouvrier, le prénom-planning est obligatoire (clé de jointure).
    const prenomPlanning = invRole === "ouvrier" ? invPrenomPlanning.trim() : null;
    if (invRole === "ouvrier" && !prenomPlanning) {
      flash("err", "Sélectionnez le prénom-planning de l'ouvrier.");
      return;
    }
    // Email réel, ou synthétique identifiant@profero.local pour un compte sans email.
    const email = modeLocal ? loginEmailFromIdentifiant(identifiant) : invEmail.trim().toLowerCase();
    setInvLoading(true);
    try {
      // 1. Vérifier doublon email / identifiant
      const { data: exist } = await supabase
        .from("utilisateurs").select("id").eq("email", email).single();
      if (exist) {
        flash("err", modeLocal ? `L'identifiant « ${identifiant} » est déjà pris.` : "Cet email est déjà enregistré.");
        setInvLoading(false); return;
      }

      // 1b. Un prénom-planning = une personne : refuser s'il est déjà relié.
      if (prenomPlanning && utilisateurs.some(u => u.prenom_planning === prenomPlanning)) {
        flash("err", `Le prénom-planning « ${prenomPlanning} » est déjà relié à un compte.`);
        setInvLoading(false); return;
      }

      // 2. Créer le compte Auth : invitation par email, ou création directe
      //    avec mot de passe (aucun email envoyé) pour un compte sans adresse.
      if (modeLocal) {
        await callAdminUsersLocal({ action: "create_local", identifiant, password: invPassword });
      } else {
        await callAdminUsers({ action: "invite", email });
      }

      // 3. Créer la ligne profil
      const { error: dbErr } = await supabase.from("utilisateurs").insert({
        email,
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

      flash("ok", modeLocal
        ? `✓ Compte créé pour ${invNom}. Connexion avec l'identifiant « ${identifiant} » et le mot de passe défini. Un email pourra être lié plus tard.`
        : `✓ Invitation envoyée à ${invEmail}. ${invNom} recevra un email pour créer son mot de passe.`);
      setInvEmail(""); setInvIdentifiant(""); setInvPassword(""); setInvNom("");
      setInvRole("conducteur"); setInvBranches(["renovation"]); setInvPrenomPlanning("");
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
  // Compte avec email : envoi du mail de réinitialisation classique.
  // Compte sans email (identifiant) : définition directe du nouveau mot de passe.
  const resetPassword = async () => {
    if (resetIsLocal && resetNewPwd.length < 8) {
      flash("err", "Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setResetLoading(true);
    try {
      if (resetIsLocal) {
        await callAdminUsersLocal({ action: "set_password", email: resetEmail, password: resetNewPwd });
        flash("ok", `✓ Nouveau mot de passe enregistré pour « ${identifiantFromLoginEmail(resetEmail)} ».`);
      } else {
        await callAdminUsers({ action: "reset_password", email: resetEmail });
        flash("ok", `✓ Email de réinitialisation envoyé à ${resetEmail}.`);
      }
      setResetId(null); setResetEmail(""); setResetNewPwd(""); setResetIsLocal(false);
    } catch (e) {
      flash("err", "Erreur : " + e.message);
    }
    setResetLoading(false);
  };

  // ── Lier un email à un compte créé sans adresse ────────────────────────────
  const lierEmail = async () => {
    const newEmail = linkEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { flash("err", "Adresse email invalide."); return; }
    setLinkLoading(true);
    try {
      await callAdminUsersLocal({ action: "set_email", current_email: linkUser.email, new_email: newEmail });
      flash("ok", `✓ Email lié. ${linkUser.nom} se connecte désormais avec ${newEmail} (l'identifiant ne fonctionne plus).`);
      setLinkUser(null); setLinkEmail("");
      charger();
    } catch (e) {
      flash("err", "Erreur : " + e.message);
    }
    setLinkLoading(false);
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

          {/* Mode de création : invitation email ou identifiant + mot de passe */}
          <div style={{ display:"flex", gap:8, marginBottom:16 }}>
            {[
              { value:"email",       label:"Avec email (invitation)" },
              { value:"identifiant", label:"Sans email (identifiant + mdp)" },
            ].map(m => (
              <button key={m.value} onClick={() => setInvMode(m.value)} style={{
                flex:1, padding:"9px 0", borderRadius:8, border:"1.5px solid",
                fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer",
                background: invMode === m.value ? "rgba(255,194,0,0.12)" : "transparent",
                borderColor: invMode === m.value ? "#FFC200" : T.border,
                color: invMode === m.value ? "#FFC200" : T.textSub,
              }}>
                {m.label}
              </button>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Nom complet *</label>
              <input className="ti" value={invNom} onChange={e=>setInvNom(e.target.value)} placeholder="Prénom Nom" style={{ width:"100%" }}/>
            </div>
            {invMode === "email" ? (
              <div>
                <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Email *</label>
                <input className="ti" type="email" value={invEmail} onChange={e=>setInvEmail(e.target.value)} placeholder="prenom.nom@profero.fr" style={{ width:"100%" }}/>
              </div>
            ) : (
              <div>
                <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Identifiant *</label>
                <input className="ti" value={invIdentifiant}
                  onChange={e=>setInvIdentifiant(e.target.value.toLowerCase().replace(/\s+/g, ""))}
                  placeholder="ex : kevin, jp.martin" style={{ width:"100%" }}/>
              </div>
            )}
            {invMode === "identifiant" && (
              <div>
                <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Mot de passe initial *</label>
                <input className="ti" type="text" value={invPassword} onChange={e=>setInvPassword(e.target.value)} placeholder="Minimum 8 caractères" style={{ width:"100%" }}/>
              </div>
            )}
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

          {/* Info invitation / compte local */}
          {invMode === "email" ? (
            <div style={{ display:"flex", alignItems:"flex-start", gap:8, background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.xs.size+1, color:"#4db8ff", marginBottom:16, lineHeight:1.6 }}>
              <Icon as={Mail} size={13} style={{marginTop:2, flexShrink:0}}/>
              <span>Un email d'invitation sera envoyé à <strong>{invEmail || "l'adresse saisie"}</strong>. Le collaborateur cliquera sur le lien pour définir son mot de passe et accéder à l'application.</span>
            </div>
          ) : (
            <div style={{ display:"flex", alignItems:"flex-start", gap:8, background:"rgba(77,184,255,0.08)", border:"1px solid rgba(77,184,255,0.2)", borderRadius:RADIUS.md, padding:"10px 14px", fontSize:FONT.xs.size+1, color:"#4db8ff", marginBottom:16, lineHeight:1.6 }}>
              <Icon as={KeyRound} size={13} style={{marginTop:2, flexShrink:0}}/>
              <span>Aucun email envoyé : le compte est créé immédiatement. Communiquez l'identifiant <strong>{invIdentifiant || "choisi"}</strong> et le mot de passe au collaborateur — il pourra se connecter tout de suite. Une adresse email pourra être liée plus tard depuis cette liste.</span>
            </div>
          )}

          <button className="btn-p" onClick={inviter} disabled={invLoading} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%", padding:"11px" }}>
            <Icon as={invMode === "email" ? Send : UserPlus} size={13}/>
            {invLoading
              ? (invMode === "email" ? "Envoi de l'invitation…" : "Création du compte…")
              : (invMode === "email" ? "Envoyer l'invitation" : "Créer le compte")}
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
                    <div style={{ fontSize:12, color:T.textMuted, marginTop:2, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                      {isLocalLoginEmail(u.email) ? (
                        <>
                          <span>Identifiant : <strong style={{color:T.textSub}}>{identifiantFromLoginEmail(u.email)}</strong></span>
                          <span style={{ fontSize:10, padding:"1px 7px", borderRadius:4, background:"rgba(255,194,0,0.12)", color:"#c99a00", fontWeight:700, letterSpacing:.5, textTransform:"uppercase", border:"1px solid rgba(255,194,0,0.3)" }}>
                            Sans email
                          </span>
                        </>
                      ) : u.email}
                    </div>
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
                    {isLocalLoginEmail(u.email) && (
                      <button
                        onClick={() => { setLinkUser(u); setLinkEmail(""); }}
                        style={{
                          display:"inline-flex", alignItems:"center", gap:4,
                          fontSize:FONT.xs.size+1, padding:"5px 12px", border:"1px solid rgba(255,194,0,0.35)",
                          borderRadius:RADIUS.sm, cursor:"pointer", fontFamily:"inherit", fontWeight:600,
                          background:"rgba(255,194,0,0.08)", color:"#c99a00",
                        }}>
                        <Icon as={Mail} size={11}/>
                        Lier un email
                      </button>
                    )}
                    <button
                      onClick={() => { setResetId(u.id); setResetEmail(u.email); setResetIsLocal(isLocalLoginEmail(u.email)); setResetNewPwd(""); }}
                      style={{
                        display:"inline-flex", alignItems:"center", gap:4,
                        fontSize:FONT.xs.size+1, padding:"5px 12px", border:"1px solid rgba(77,184,255,0.3)",
                        borderRadius:RADIUS.sm, cursor:"pointer", fontFamily:"inherit", fontWeight:600,
                        background:"rgba(77,184,255,0.08)", color:"#4db8ff",
                      }}>
                      <Icon as={KeyRound} size={11}/>
                      {isLocalLoginEmail(u.email) ? "Nouveau MDP" : "Réinit. MDP"}
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
                {resetIsLocal ? "Définir un nouveau mot de passe" : "Réinitialiser le mot de passe ?"}
              </div>
            </div>
            {resetIsLocal ? (
              <>
                <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:14 }}>
                  Ce compte n'a pas d'adresse email : saisissez directement le nouveau mot de passe
                  pour <strong style={{color:"#4db8ff"}}>{identifiantFromLoginEmail(resetEmail)}</strong>, puis communiquez-le lui.
                </div>
                <input className="ti" type="text" value={resetNewPwd} onChange={e=>setResetNewPwd(e.target.value)}
                  placeholder="Minimum 8 caractères" style={{ width:"100%", marginBottom:20 }}
                  onKeyDown={e=>e.key==="Enter"&&resetPassword()}/>
              </>
            ) : (
              <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:20 }}>
                Un email de réinitialisation sera envoyé à <strong style={{color:"#4db8ff"}}>{resetEmail}</strong>.
              </div>
            )}
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => { setResetId(null); setResetEmail(""); setResetNewPwd(""); setResetIsLocal(false); }} disabled={resetLoading}
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
                <Icon as={resetIsLocal ? Check : Send} size={13}/>
                {resetLoading ? (resetIsLocal ? "Enregistrement…" : "Envoi…") : (resetIsLocal ? "Enregistrer" : "Envoyer l'email")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal lier un email ── */}
      {linkUser && (
        <div onClick={()=>!linkLoading&&setLinkUser(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, padding:16, backdropFilter:"blur(4px)" }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal||T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.xl,
            padding:24, width:"100%", maxWidth:440,
            boxShadow:"0 24px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{
                width:40, height:40, borderRadius:RADIUS.md, flexShrink:0,
                background:"rgba(255,194,0,0.16)", color:"#c99a00",
                display:"flex", alignItems:"center", justifyContent:"center",
              }}>
                <Icon as={Mail} size={20}/>
              </div>
              <div style={{ fontSize:FONT.lg.size, fontWeight:800, color:T.text }}>
                Lier un email à {linkUser.nom}
              </div>
            </div>
            <div style={{ fontSize:FONT.sm.size, color:T.textSub, lineHeight:1.6, marginBottom:14 }}>
              L'adresse remplace l'identifiant « <strong style={{color:T.text}}>{identifiantFromLoginEmail(linkUser.email)}</strong> » :
              la connexion se fera ensuite <strong style={{color:T.text}}>avec cet email</strong> (même mot de passe),
              et la réinitialisation du mot de passe par email deviendra possible.
            </div>
            <input className="ti" type="email" value={linkEmail} onChange={e=>setLinkEmail(e.target.value)}
              placeholder="prenom.nom@profero.fr" style={{ width:"100%", marginBottom:20 }}
              onKeyDown={e=>e.key==="Enter"&&lierEmail()}/>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => { setLinkUser(null); setLinkEmail(""); }} disabled={linkLoading}
                style={{ background:"transparent", border:`1px solid ${T.border}`,
                  borderRadius:RADIUS.md, padding:"9px 18px", color:T.textSub,
                  fontFamily:"inherit", fontSize:FONT.sm.size, cursor:"pointer", opacity:linkLoading?.5:1 }}>
                Annuler
              </button>
              <button onClick={lierEmail} disabled={linkLoading} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                background:"#FFC200", color:"#1e2128", border:"none",
                borderRadius:RADIUS.md, padding:"9px 18px",
                fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:800,
                cursor:"pointer", opacity:linkLoading?.6:1,
              }}>
                <Icon as={Check} size={13}/>
                {linkLoading ? "Liaison…" : "Lier l'email"}
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

const MODES_PAIEMENT = [
  { id: "",         label: "Non défini" },
  { id: "comptant", label: "Paiement comptant" },
  { id: "30j",      label: "Paiement à 30 jours (de l'achat)" },
  { id: "echeance", label: "30 jours fin de mois" },
];

function OngletFournisseurs({ T, acc }) {
  const [fournisseurs, setFournisseurs] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [editId, setEditId]             = useState(null);
  const [draft, setDraft]               = useState({ nom: "", email: "", mail_type: MAIL_TYPE_DEFAUT, mode_paiement: "" });
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

  // ── Normalisation rétroactive des fournisseurs sur les saisies existantes ──
  const [normRunning, setNormRunning] = useState(false);
  const normaliser = async () => {
    setNormRunning(true);
    try {
      const [cRes, fRes] = await Promise.all([
        supabase.from("commandes").select("id, fournisseur_nom"),
        supabase.from("factures").select("id, fournisseur_nom"),
      ]);
      const rows = [...(cRes.data || []), ...(fRes.data || [])];
      const noms = [...new Set(rows.map(r => (r.fournisseur_nom || "").trim()).filter(Boolean))];
      if (!noms.length) { flash("ok", "Aucun fournisseur à normaliser."); setNormRunning(false); return; }

      const ref = fournisseurs.map(f => ({ id: f.id, nom: f.nom }));
      const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      const firstTok = s => (norm(s).split(" ").find(w => w.length > 2) || norm(s));

      // Passe 1 : match sur le référentiel existant ; sinon regroupement par marque.
      const mapping = {};      // nom exact -> { id, nom }
      const clusters = {};     // 1er mot -> [noms non reconnus]
      for (const nom of noms) {
        const { fournisseur } = matchFournisseur(nom, ref);
        if (fournisseur) mapping[nom] = { id: fournisseur.id, nom: fournisseur.nom };
        else { const t = firstTok(nom); (clusters[t] = clusters[t] || []).push(nom); }
      }
      const canoniques = Object.values(clusters).map(g => g.slice().sort((a, b) => a.length - b.length)[0]);
      const nomEstTraite = (r) => {
        const n = (r.fournisseur_nom || "").trim();
        return !!mapping[n] || Object.values(clusters).some(g => g.includes(n));
      };
      const nbDocs = rows.filter(nomEstTraite).length;

      const ok = window.confirm(
        `Normalisation des fournisseurs :\n\n` +
        `• ${nbDocs} document(s) seront rattachés au bon fournisseur.\n` +
        `• ${canoniques.length} nouveau(x) fournisseur(s) créé(s) : ${canoniques.join(", ") || "—"}\n\n` +
        `Appliquer ?`
      );
      if (!ok) { setNormRunning(false); return; }

      // Créer un fournisseur par cluster non reconnu (nom le plus court = canonique).
      for (const g of Object.values(clusters)) {
        const canonique = g.slice().sort((a, b) => a.length - b.length)[0];
        const { data: nf } = await supabase.from("fournisseurs").insert({ nom: canonique }).select("id, nom").single();
        if (nf) g.forEach(n => { mapping[n] = { id: nf.id, nom: nf.nom }; });
      }
      // Appliquer : rattachement par nom exact.
      for (const [nom, tgt] of Object.entries(mapping)) {
        await supabase.from("commandes").update({ fournisseur_id: tgt.id, fournisseur_nom: tgt.nom }).eq("fournisseur_nom", nom);
        await supabase.from("factures").update({ fournisseur_id: tgt.id, fournisseur_nom: tgt.nom }).eq("fournisseur_nom", nom);
      }
      flash("ok", `✓ Normalisation terminée : ${nbDocs} document(s) rattaché(s), ${canoniques.length} fournisseur(s) créé(s).`);
      charger();
    } catch (e) {
      flash("err", "Erreur normalisation : " + (e?.message || e));
    }
    setNormRunning(false);
  };

  const resetDraft = () => setDraft({ nom: "", email: "", mail_type: MAIL_TYPE_DEFAUT, mode_paiement: "" });

  const ouvrirForm = (f = null) => {
    if (f) {
      setEditId(f.id);
      setDraft({ nom: f.nom || "", email: f.email || "", mail_type: f.mail_type || MAIL_TYPE_DEFAUT, mode_paiement: f.mode_paiement || "" });
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
      nom:           draft.nom.trim(),
      email:         draft.email?.trim() || null,
      mail_type:     draft.mail_type?.trim() || null,
      mode_paiement: draft.mode_paiement || null,
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
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={normaliser} disabled={normRunning} title="Rattache toutes les commandes/factures déjà saisies au bon fournisseur (et crée les manquants)" style={{
            display:"inline-flex", alignItems:"center", gap:6,
            background:"transparent", color:T.textSub, border:`1px solid ${T.border}`,
            borderRadius:RADIUS.md, padding:"9px 14px",
            fontFamily:"inherit", fontSize:FONT.sm.size, fontWeight:700, cursor: normRunning ? "not-allowed" : "pointer",
          }}>
            <Icon as={Truck} size={13}/>
            {normRunning ? "Normalisation…" : "Normaliser les saisies"}
          </button>
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
            <label style={{ fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textSub, display:"block", marginBottom:6 }}>Mode de facturation</label>
            <select className="ti" value={draft.mode_paiement} onChange={e=>setDraft(p=>({...p,mode_paiement:e.target.value}))} style={{ width:"100%" }}>
              {MODES_PAIEMENT.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <div style={{ fontSize:FONT.xs.size+1, color:T.textMuted, marginTop:6, lineHeight:1.5 }}>
              À la saisie d'une commande de ce fournisseur : « Comptant » cochera « déjà payé » ; « À facturer » laissera la commande en attente de la facture.
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
                  {f.mode_paiement && (
                    <div style={{ fontSize:FONT.xs.size, fontWeight:700, marginTop:4, color: f.mode_paiement === "comptant" ? "#4caf78" : "#5b8af5" }}>
                      {f.mode_paiement === "comptant" ? "💵 " : "🧾 "}
                      {(MODES_PAIEMENT.find(m => m.id === f.mode_paiement) || {}).label || f.mode_paiement}
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

// ─── HEURES ATTENDUES PAR JOUR (cible des comptes rendus ouvriers) ──────────
// La clé planning_config "heures_par_jour" porte les heures par jour de semaine
// + un champ "exceptions" { "AAAA-MM-JJ": heures } pour les fériés/ponts.
const HEURES_DEFAUT = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9, "Vendredi": 9 };

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

// ─── ONGLET POINTAGES (contrôle & réparation du registre) ───────────────────
// Deux réparations, toutes deux issues de bugs corrigés depuis :
//   1) CR validés SANS pointages (collision d'index unique avalée en 23505) →
//      régénération des écritures à partir du déclaratif du rapport.
//   2) Journées dont le trajet ne somme pas juste (0,33 × 3 = 0,99) → recalage
//      chirurgical des pointages de trajet en centimes exacts.
function OngletPointages({ T, acc, tauxHoraires = {}, profil }) {
  const now = new Date();
  const [mois, setMois]       = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [scan, setScan]       = useState(null);
  const [msg, setMsg]         = useState(null);

  const valideur = profil?.nom || profil?.email || "Admin";

  const frToISO = (s) => {
    if (!s) return "";
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return s;
  };
  const fmtH = (n) => { const v = Math.round((parseFloat(n) || 0) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""); };

  // Cible de trajet (heures) du rapport de rang idx parmi n rapports du jour.
  // Heures DÉCLARÉES d'un rapport hors trajet : tâches + heures indirectes saisies.
  const declaredRapport = (r) =>
    (r.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0)
    + (r.heures_indirectes || []).reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);

  const analyser = async () => {
    setLoading(true); setMsg(null); setScan(null);
    const [y, mo] = mois.split("-").map(Number);
    const first = new Date(y, mo - 1, 1), last = new Date(y, mo, 0);
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const days = [];
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) days.push(isoOf(new Date(d)));
    const frDays = days.map(s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return `${m[3]}/${m[2]}/${m[1]}`; });

    const { data: rps, error: e1 } = await supabase.from("rapports")
      .select("id,ouvrier,date_rapport,chantier_id,chantier_nom,taches,heures_indirectes,trajet_matin_min,trajet_soir_min,statut")
      .in("date_rapport", [...days, ...frDays]).eq("statut", "valide");
    const { data: pts, error: e2 } = await supabase.from("pointages")
      .select("id,rapport_id,heures,type_pointage,motif_indirect")
      .gte("date", days[0]).lte("date", days[days.length - 1]);
    if (e1 || e2) { setMsg({ type: "err", text: "Erreur de lecture — réessaie." }); setLoading(false); return; }

    const rapports = rps || [], pointages = pts || [];
    const ptsParRapport = {};
    pointages.forEach(p => { (ptsParRapport[p.rapport_id] ||= []).push(p); });

    // Analyse JOUR PAR JOUR (par ouvrier) : on compare le total DÉCLARÉ (ce que
    // l'ouvrier a rendu : tâches + indirectes + trajet du jour) au total du
    // REGISTRE (somme des pointages). Deux anomalies :
    //   • tâches/indirectes du registre ≠ déclaré  → « à régénérer » (registre
    //     désynchronisé : CR sans pointages, doublons perdus, pointages périmés…)
    //   • seul le trajet ne tombe pas juste (9,99 au lieu de 10) → « trajet à
    //     recaler » (réparation chirurgicale, sans toucher aux tâches).
    const parJour = {};
    rapports.forEach(r => { const k = `${r.ouvrier}__${frToISO(r.date_rapport)}`; (parJour[k] ||= []).push(r); });

    const aRegenerer = [], aRecaler = [];
    Object.entries(parJour).forEach(([k, rs]) => {
      const [ouvrier, dateISO] = k.split("__");
      const trajetMin = (parseInt(rs[0].trajet_matin_min) || 0) + (parseInt(rs[0].trajet_soir_min) || 0);
      const n = rs.length;
      const tri = [...rs].sort((a, b) => String(a.id).localeCompare(String(b.id)));

      const declTachesInd = rs.reduce((s, r) => s + declaredRapport(r), 0);
      const declTrajet = Math.round((trajetMin / 60) * 100) / 100;
      const declDay = declTachesInd + declTrajet;

      let regTrajet = 0, regReste = 0;
      rs.forEach(r => (ptsParRapport[r.id] || []).forEach(p => {
        const h = parseFloat(p.heures) || 0;
        if (p.type_pointage === "indirect" && /^trajet/i.test(p.motif_indirect || "")) regTrajet += h;
        else regReste += h;
      }));
      const regDay = regTrajet + regReste;

      const tachesMatch = Math.abs(declTachesInd - regReste) <= 0.02;
      if (!tachesMatch) {
        aRegenerer.push({ ouvrier, date: dateISO, rapports: tri, declDay, regDay });
      } else if (trajetMin > 0 && Math.abs(regTrajet - declTrajet) > 0.005) {
        aRecaler.push({ ouvrier, date: dateISO, rapports: tri, trajetMin, actuel: regDay, cible: declDay });
      }
    });

    setScan({ aRegenerer, aRecaler, nbRapports: rapports.length });
    setLoading(false);
  };

  // Recalage chirurgical des trajets (ne touche QUE les pointages de trajet).
  const recalerTrajets = async () => {
    if (!scan?.aRecaler?.length) return;
    setBusy(true); setMsg(null);
    let jours = 0, errs = 0;
    for (const j of scan.aRecaler) {
      const n = j.rapports.length;
      // Trajet pondéré par le temps passé sur chaque chantier (cf. validation).
      const centsJour = repartTrajetCents(j.trajetMin, j.rapports.map(declaredRapport));
      for (let idx = 0; idx < n; idx++) {
        const r = j.rapports[idx];
        const cible = (centsJour[idx] || 0) / 100;
        const { error } = await supabase.from("pointages")
          .update({ heures: cible, motif_indirect: n > 1 ? "Trajet (quote-part)" : "Trajet" })
          .eq("rapport_id", r.id).eq("type_pointage", "indirect").ilike("motif_indirect", "trajet%");
        if (error) errs++;
      }
      jours++;
    }
    setBusy(false);
    setMsg(errs
      ? { type: "err", text: `Recalage terminé avec ${errs} erreur(s) sur ${jours} journée(s).` }
      : { type: "ok", text: `Trajets recalés sur ${jours} journée(s).` });
    await analyser();
  };

  // Régénération des journées incohérentes : on reconstruit les pointages de
  // TOUS les rapports du jour depuis la déclaration de l'ouvrier, pour que le
  // registre = le déclaré. Corrige les CR sans pointages ET les pointages périmés.
  const regenererJours = async () => {
    if (!scan?.aRegenerer?.length) return;
    const nbRapports = scan.aRegenerer.reduce((s, j) => s + j.rapports.length, 0);
    if (!window.confirm(
      `Régénérer ${scan.aRegenerer.length} journée(s) (${nbRapports} rapport(s)) ?\n\n`
      + "Les pointages sont reconstruits à partir de la déclaration de l'ouvrier, pour que "
      + "le registre corresponde exactement aux heures déclarées.\n\n"
      + "• Les totaux de paie redeviennent justes.\n"
      + "• Réserve : une correction d'heures faite manuellement pendant la validation "
      + "d'origine n'est pas restaurée, et une tâche auto-détectée peut redevenir « libre » "
      + "(sans incidence sur les heures ; ré-attribuable via la Validation)."
    )) return;
    setBusy(true); setMsg(null);

    // phasage_id par chantier (pour toutes les journées à régénérer).
    const chIds = [...new Set(scan.aRegenerer.flatMap(j => j.rapports.map(r => r.chantier_id)).filter(Boolean))];
    const phMap = {};
    if (chIds.length) {
      const { data: phs } = await supabase.from("phasages").select("id,chantier_id").in("chantier_id", chIds);
      (phs || []).forEach(p => { if (!phMap[p.chantier_id]) phMap[p.chantier_id] = p.id; });
    }

    let okJours = 0, errs = 0;
    for (const j of scan.aRegenerer) {
      const n = j.rapports.length; // rapports déjà triés par id (rang stable)
      // Poids du trajet : heures travaillées de chaque rapport du jour (ordre stable).
      const heuresParRapportDuJour = j.rapports.map(declaredRapport);
      for (let idx = 0; idx < n; idx++) {
        const r = j.rapports[idx];
        const dateISO = frToISO(r.date_rapport);
        const lignes = buildPointagesRapport({
          chantier_id: r.chantier_id,
          ouvrier: r.ouvrier,
          dateISO,
          taux: parseFloat(tauxHoraires?.[r.ouvrier]) || 0,
          phasage_id: phMap[r.chantier_id] || null,
          rapport_id: r.id,
          valide_par: valideur,
          taskLines: (r.taches || []).map(t => ({
            tache_id: t.tache_id || null, phase_id: t.phase_id || null,
            heures: t.heures_reelles, avancement_declare: t.avancement,
          })),
          indirectLines: (r.heures_indirectes || []).map(h => ({ motif: h.motif, heures: h.heures })),
          trajetMinTotal: (parseInt(r.trajet_matin_min) || 0) + (parseInt(r.trajet_soir_min) || 0),
          nbChantiersDuJour: n,
          rangRapport: idx,
          heuresParRapportDuJour,
        });
        // Remplace intégralement les pointages du rapport.
        const { error: delErr } = await supabase.from("pointages").delete().eq("rapport_id", r.id);
        if (delErr) { errs++; continue; }
        if (lignes.length) {
          const { error: insErr } = await supabase.from("pointages").insert(lignes);
          if (insErr) { errs++; continue; }
        }
      }
      okJours++;
    }
    setBusy(false);
    setMsg(errs
      ? { type: "err", text: `${okJours} journée(s) régénérée(s), ${errs} rapport(s) en erreur.` }
      : { type: "ok", text: `${okJours} journée(s) régénérée(s) — registre aligné sur le déclaré.` });
    await analyser();
  };

  const card = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "14px 16px" };
  const rien = scan && scan.aRegenerer.length === 0 && scan.aRecaler.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.text, marginBottom: 4 }}>Contrôle du registre de pointage</div>
        <div style={{ fontSize: 12.5, color: T.textMuted, lineHeight: 1.5 }}>
          Compare, jour par jour, le total du registre au total déclaré par l'ouvrier. Répare les journées
          désynchronisées (registre ≠ déclaré) et celles dont seul le trajet ne tombe pas juste (ex. 9,99 h au
          lieu de 10). Analyse mois par mois.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <input type="month" value={mois} onChange={e => setMois(e.target.value)}
            style={{ background: T.inputBg || T.fieldBg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "8px 12px", color: T.text, fontFamily: "inherit", fontSize: 14 }} />
          <button onClick={analyser} disabled={loading || busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, background: acc.accent, color: acc.onAccent || "#111", border: "none", borderRadius: RADIUS.md, padding: "9px 16px", fontSize: 13.5, fontWeight: 700, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}>
            <Icon as={Activity} size={15} /> {loading ? "Analyse…" : "Analyser le mois"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ ...card, borderColor: msg.type === "err" ? "rgba(224,92,92,0.4)" : "rgba(80,200,120,0.4)", color: msg.type === "err" ? "#e05c5c" : "#3f9c5f", fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          <Icon as={msg.type === "err" ? AlertTriangle : Check} size={16} /> {msg.text}
        </div>
      )}

      {rien && (
        <div style={{ ...card, display: "flex", alignItems: "center", gap: 8, color: "#3f9c5f", fontWeight: 600, fontSize: 13.5 }}>
          <Icon as={Check} size={16} /> Registre sain pour ce mois — {scan.nbRapports} CR validés, aucune anomalie.
        </div>
      )}

      {/* Journées incohérentes (registre ≠ déclaré) → régénération */}
      {scan && scan.aRegenerer.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <Icon as={AlertTriangle} size={17} color="#d98a2b" />
            <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>
              {scan.aRegenerer.length} journée(s) incohérente(s) — registre ≠ déclaré
            </span>
            <button onClick={regenererJours} disabled={busy}
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: "#d98a2b", color: "#fff", border: "none", borderRadius: RADIUS.md, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              <Icon as={RefreshCw} size={14} /> {busy ? "En cours…" : "Régénérer"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: T.textMuted, marginBottom: 10 }}>
            Le registre est reconstruit depuis la déclaration de l'ouvrier (heures de paie exactes).
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {scan.aRegenerer.map((j, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: T.textSub, padding: "5px 0", borderBottom: i < scan.aRegenerer.length - 1 ? `1px solid ${T.sectionDivider || T.border}` : "none" }}>
                <span style={{ fontWeight: 700, color: T.text, minWidth: 90 }}>{j.ouvrier}</span>
                <span>{j.date}</span>
                <span style={{ color: T.textMuted }}>{j.rapports.length} chantier(s)</span>
                <span style={{ marginLeft: "auto", color: T.textMuted }}>
                  registre <b style={{ color: "#d98a2b" }}>{fmtH(j.regDay)} h</b> → déclaré <b style={{ color: "#3f9c5f" }}>{fmtH(j.declDay)} h</b>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Journées à recaler (trajet uniquement) */}
      {scan && scan.aRecaler.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <Icon as={Clock} size={17} color={acc.accent} />
            <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>
              {scan.aRecaler.length} journée(s) à recaler (trajet)
            </span>
            <button onClick={recalerTrajets} disabled={busy}
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, background: acc.accent, color: acc.onAccent || "#111", border: "none", borderRadius: RADIUS.md, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              <Icon as={RefreshCw} size={14} /> {busy ? "En cours…" : "Recaler les trajets"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {scan.aRecaler.map((j, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: T.textSub, padding: "5px 0", borderBottom: i < scan.aRecaler.length - 1 ? `1px solid ${T.sectionDivider || T.border}` : "none" }}>
                <span style={{ fontWeight: 700, color: T.text, minWidth: 90 }}>{j.ouvrier}</span>
                <span>{j.date}</span>
                <span style={{ marginLeft: "auto", color: T.textMuted }}>
                  {fmtH(j.actuel)} h → <b style={{ color: "#3f9c5f" }}>{fmtH(j.cible)} h</b>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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

  // ─── OPÉRATIONS (regroupement de chantiers d'une même maison) ────────────
  const [operations, setOperations]   = useState([]);
  const [editOpIdx, setEditOpIdx]     = useState(null);
  const [opToDelete, setOpToDelete]   = useState(null);
  const [newOpNom, setNewOpNom]       = useState("");

  // ─── NOUVELLES CONFIGS (Bloc 1) ──────────────────────────────────────────
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

  // ─── GROUPES TYPES (étapes d'exécution) ─────────────────────────────────
  const [groupesTypes, setGroupesTypes]       = useState(GROUPES_TYPES_DEFAUT);
  const [editGtColIdx, setEditGtColIdx]       = useState(null);
  const [gtToDelete, setGtToDelete]           = useState(null);
  const [resetGtConfirm, setResetGtConfirm]   = useState(false);

  // ─── ÉQUIPES (référentiel global) ────────────────────────────────────────
  const [equipes, setEquipes]                 = useState(EQUIPES_DEFAUT);
  const [editEqColIdx, setEditEqColIdx]       = useState(null);
  const [eqToDelete, setEqToDelete]           = useState(null);
  const [resetEqConfirm, setResetEqConfirm]   = useState(false);

  // ─── EMAIL TEMPLATES (Bloc 3) ────────────────────────────────────────────
  const [emailTemplates, setEmailTemplates] = useState(EMAIL_TEMPLATES_DEFAUT);

  // ─── HEURES PAR JOUR (cible des CR ouvriers) ─────────────────────────────
  const [heuresParJour, setHeuresParJour] = useState(HEURES_DEFAUT);
  const [excDate, setExcDate]     = useState("");
  const [excHeures, setExcHeures] = useState("0");
  // Factures de situation : seuils d'avancement (%) qui les déclenchent, et
  // rôles destinataires de l'email « facture de situation prête ».
  const [seuilsSituations, setSeuilsSituations] = useState([...SEUILS_SITUATIONS]);
  const [rolesSituations, setRolesSituations] = useState(["admin", "conducteur"]);
  const [nouveauSeuil, setNouveauSeuil] = useState("");
  // % d'acompte par défaut (Point 5) : utilisé par les recettes prévues du
  // diagramme financier quand ni les États financiers ni le chantier n'en ont.
  const [acomptePctDefaut, setAcomptePctDefaut] = useState("");

  // ─── LOAD CONFIGS SUPABASE ───────────────────────────────────────────────
  useEffect(() => {
    const loadConfigs = async () => {
      const { data } = await supabase.from("planning_config").select("key,value").in("key", ["phases_travaux", "lots_travaux", "groupes_types", "equipes", "operations", "email_templates", "heures_par_jour", "situations_seuils", "acompte_pct_defaut"]);
      if (data) {
        data.forEach(r => {
          if (r.key === "phases_travaux" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setPhases(r.value.items);
          }
          if (r.key === "lots_travaux" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setLots(r.value.items);
          }
          if (r.key === "groupes_types" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setGroupesTypes([...r.value.items].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)));
          }
          if (r.key === "equipes" && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
            setEquipes(r.value.items);
          }
          if (r.key === "operations" && r.value && Array.isArray(r.value.items)) {
            setOperations(r.value.items);
          }
          if (r.key === "email_templates" && r.value) {
            setEmailTemplates({ ...EMAIL_TEMPLATES_DEFAUT, ...r.value });
          }
          if (r.key === "heures_par_jour" && r.value) {
            setHeuresParJour({ ...HEURES_DEFAUT, ...r.value });
          }
          if (r.key === "situations_seuils" && r.value) {
            if (Array.isArray(r.value.seuils) && r.value.seuils.length > 0) {
              setSeuilsSituations(normaliserSeuilsSituations(r.value.seuils));
            }
            if (Array.isArray(r.value.roles)) setRolesSituations(r.value.roles);
          }
          if (r.key === "acompte_pct_defaut" && r.value != null && r.value !== "") {
            setAcomptePctDefaut(String(r.value));
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

  // ─── HEURES PAR JOUR CRUD ────────────────────────────────────────────────
  // Depuis le rythme 4j/5j (24/08/2026), le barème hebdomadaire est porté par
  // src/rythmeSemaine.js (affiché en lecture seule dans l'onglet). La config
  // "heures_par_jour" ne sert plus qu'aux EXCEPTIONS par date et aux semaines
  // antérieures à la rentrée.
  const addExceptionJour = () => {
    if (!excDate) return;
    const next = { ...heuresParJour, exceptions: { ...(heuresParJour.exceptions || {}), [excDate]: parseFloat(excHeures) || 0 } };
    setHeuresParJour(next);
    saveConfig("heures_par_jour", next);
    setExcDate(""); setExcHeures("0");
  };
  const updExceptionJour = (d, val) => {
    const next = { ...heuresParJour, exceptions: { ...(heuresParJour.exceptions || {}), [d]: parseFloat(val) || 0 } };
    setHeuresParJour(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("heures_par_jour", next), 600);
  };
  const removeExceptionJour = (d) => {
    const exceptions = { ...(heuresParJour.exceptions || {}) };
    delete exceptions[d];
    const next = { ...heuresParJour, exceptions };
    setHeuresParJour(next);
    saveConfig("heures_par_jour", next);
  };

  // ─── FACTURES DE SITUATION : seuils + rôles destinataires ────────────────
  // Une seule clé planning_config ("situations_seuils") porte les deux :
  // { seuils: [25, 50…], roles: ["admin", …] } — toujours écrite ENTIÈRE.
  const saveSituationsCfg = (seuils, roles) =>
    saveConfig("situations_seuils", { seuils, roles });
  const majSeuilsSituations = (arr) => {
    const clean = normaliserSeuilsSituations(arr);
    setSeuilsSituations(clean);
    saveSituationsCfg(clean, rolesSituations);
  };
  const addSeuilSituation = () => {
    const v = Math.round(parseFloat(nouveauSeuil) || 0);
    if (v < 1 || v > 100) return;
    majSeuilsSituations([...seuilsSituations, v]);
    setNouveauSeuil("");
  };
  const removeSeuilSituation = (s) => {
    if (seuilsSituations.length <= 1) return; // toujours au moins un seuil
    majSeuilsSituations(seuilsSituations.filter(x => x !== s));
  };
  const toggleRoleSituation = (roleId) => {
    const next = rolesSituations.includes(roleId)
      ? rolesSituations.filter(r => r !== roleId)
      : [...rolesSituations, roleId];
    setRolesSituations(next);
    saveSituationsCfg(seuilsSituations, next);
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

  // ─── GROUPES TYPES CRUD ──────────────────────────────────────────────────
  // La liste est maintenue TRIÉE par `ordre` (rang d'exécution). Monter /
  // descendre échange les valeurs d'ordre des deux voisins, pour que le rang
  // reste la seule source de vérité (l'ordre du tableau n'est qu'un reflet).
  const saveGroupesTypes = async (next) => {
    const tri = [...next].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
    setGroupesTypes(tri);
    await saveConfig("groupes_types", { items: tri });
  };
  const addGroupeType = () => {
    const maxOrdre = groupesTypes.reduce((m, g) => Math.max(m, g.ordre ?? 0), 0);
    saveGroupesTypes([...groupesTypes, {
      id: `gt_${Date.now()}`,
      nom: "Nouveau groupe",
      couleur: COULEURS_PALETTE[groupesTypes.length % COULEURS_PALETTE.length],
      ordre: maxOrdre + 10,
      lot_id: "",
      equipe_id: "",
    }]);
  };
  const updGroupeType = (i, patch) => {
    const next = groupesTypes.map((g, idx) => idx === i ? { ...g, ...patch } : g);
    setGroupesTypes(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("groupes_types", { items: next }), 600);
  };
  const removeGroupeType = () => {
    if (gtToDelete === null) return;
    saveGroupesTypes(groupesTypes.filter((_, idx) => idx !== gtToDelete));
    setGtToDelete(null);
  };
  const moveGroupeType = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= groupesTypes.length) return;
    const a = groupesTypes.map(g => ({ ...g }));
    // Ordres dupliqués (données legacy) : on renumérote de 10 en 10 d'abord,
    // sinon l'échange de deux valeurs égales ne bougerait rien.
    if (a[i].ordre === a[j].ordre) a.forEach((g, idx) => { g.ordre = (idx + 1) * 10; });
    [a[i].ordre, a[j].ordre] = [a[j].ordre, a[i].ordre];
    saveGroupesTypes(a);
  };
  const resetGroupesTypes = () => {
    saveGroupesTypes(GROUPES_TYPES_DEFAUT.map(g => ({ ...g })));
    setResetGtConfirm(false);
  };

  // ─── ÉQUIPES CRUD ────────────────────────────────────────────────────────
  const saveEquipes = async (next) => {
    setEquipes(next);
    let items = next;
    try {
      const noms = [...new Set((next || []).flatMap(eq => [
        eq?.responsable,
        ...(eq?.membres || []).map(m => m?.ouvrier),
      ]).filter(Boolean))];
      if (noms.length) {
        const { data, error } = await supabase.from("planning_resources")
          .select("id,nom_planning")
          .in("nom_planning", noms);
        if (error) throw error;
        const byName = new Map((data || []).map(r => [String(r.nom_planning || "").trim().toLocaleLowerCase("fr-FR"), r.id]));
        items = (next || []).map(eq => {
          if (eq?.externe) return { ...eq, responsable_resource_id: null, membres: eq.membres || [] };
          const respKey = String(eq?.responsable || "").trim().toLocaleLowerCase("fr-FR");
          return {
            ...eq,
            responsable_resource_id: byName.get(respKey) || null,
            membres: (eq?.membres || []).map(m => ({
              ...m,
              resource_id: byName.get(String(m?.ouvrier || "").trim().toLocaleLowerCase("fr-FR")) || null,
            })),
          };
        });
        setEquipes(items);
      }
    } catch (e) {
      console.warn("Alignement resource_id équipes impossible, noms conservés :", e?.message || e);
    }
    await saveConfig("equipes", { items });
  };
  const addEquipe = () => {
    saveEquipes([...equipes, {
      id: `eq_${Date.now()}`,
      nom: "Nouvelle équipe",
      responsable: "",
      membres: [],
      externe: false,
      couleur: COULEURS_PALETTE[equipes.length % COULEURS_PALETTE.length],
    }]);
  };
  const updEquipe = (i, patch) => {
    const next = equipes.map((eq, idx) => idx === i ? { ...eq, ...patch } : eq);
    setEquipes(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("equipes", { items: next }), 600);
  };
  const removeEquipe = () => {
    if (eqToDelete === null) return;
    saveEquipes(equipes.filter((_, idx) => idx !== eqToDelete));
    setEqToDelete(null);
  };
  const addMembre = (i, prenom) => {
    if (!prenom) return;
    const eq = equipes[i];
    if ((eq.membres || []).some(m => m.ouvrier === prenom)) return;
    updEquipe(i, { membres: [...(eq.membres || []), { ouvrier: prenom }] });
  };
  const updMembre = (i, j, patch) => {
    const eq = equipes[i];
    const nm = (eq.membres || []).map((m, idx) => {
      if (idx !== j) return m;
      const next = { ...m, ...patch };
      if (!next.date_dispo) delete next.date_dispo;
      return next;
    });
    updEquipe(i, { membres: nm });
  };
  const removeMembre = (i, j) => {
    const eq = equipes[i];
    updEquipe(i, { membres: (eq.membres || []).filter((_, idx) => idx !== j) });
  };
  const resetEquipes = () => {
    saveEquipes(EQUIPES_DEFAUT.map(eq => ({ ...eq, membres: eq.membres.map(m => ({ ...m })) })));
    setResetEqConfirm(false);
  };

  // ─── OPÉRATIONS CRUD ─────────────────────────────────────────────────────
  // Référentiel planning_config/operations ({ items: [{ id, nom, adresse,
  // couleur }] }). Le lien vit sur le chantier (operation_id, optionnel) :
  // une opération se supprime uniquement si aucun chantier n'y est rattaché.
  const saveOperations = async (next) => {
    setOperations(next);
    await saveConfig("operations", { items: next });
  };
  const addOperation = () => {
    if (!newOpNom.trim()) return;
    const id = `op_${Date.now()}`;
    saveOperations([...operations, { id, nom: newOpNom.trim(), adresse: "", couleur: COULEURS_PALETTE[operations.length % COULEURS_PALETTE.length] }]);
    setNewOpNom("");
  };
  const updOperation = (i, patch) => {
    const next = operations.map((o, idx) => idx === i ? { ...o, ...patch } : o);
    setOperations(next);
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => saveConfig("operations", { items: next }), 600);
  };
  const removeOperation = () => {
    if (opToDelete === null) return;
    const op = operations[opToDelete];
    if (op && chantiers.some(c => c.operation_id === op.id)) { setOpToDelete(null); return; }
    saveOperations(operations.filter((_, idx) => idx !== opToDelete));
    setOpToDelete(null);
  };
  // Rattache / détache un chantier (operationId "" = détacher). Passe par
  // updateChantier pour bénéficier du merge par patch et du save existants.
  const setChantierOperation = (chantierId, operationId) => {
    const i = chantiers.findIndex(c => c.id === chantierId);
    if (i < 0) return;
    updateChantier(i, { operation_id: operationId || "" });
  };
  // Ordre des logements DANS une opération = leur ordre dans le référentiel
  // chantiers (celui que suit le chemin de fer). Monter/descendre échange les
  // positions de deux logements frères dans le tableau global — les chantiers
  // intercalés d'autres opérations ne bougent pas.
  const moveChantierDansOperation = (operationId, chantierId, dir) => {
    const freres = chantiers.map((c, i) => ({ c, i })).filter(x => x.c.operation_id === operationId);
    const pos = freres.findIndex(x => x.c.id === chantierId);
    const cible = pos + dir;
    if (pos < 0 || cible < 0 || cible >= freres.length) return;
    const a = [...chantiers];
    [a[freres[pos].i], a[freres[cible].i]] = [a[freres[cible].i], a[freres[pos].i]];
    setChantiers(a);
    saveConfig("chantiers", a);
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

  // Onglets regroupés par grandes sections (barre à 2 niveaux)
  const SECTIONS = [
    { id:"apercu", label:"Vue d'ensemble", icon:LayoutDashboard, tabs:[
      ["vue", "Vue d'ensemble", LayoutDashboard],
    ]},
    { id:"referentiels", label:"Référentiels", icon:Boxes, tabs:[
      ["chantiers",     "Chantiers",     Building2],
      ["operations",    "Opérations",    Home],
      ["lots",          "Lots",          Boxes],
      ["phases",        "Phases",        ClipboardCheck],
      ["groupes_types", "Groupes types", ListOrdered],
      ["equipes",       "Équipes",       Users],
      ["taux",          "Taux horaires", Euro],
      ["heures_jour",   "Heures / jour", Clock],
    ]},
    { id:"personnes", label:"Personnes & accès", icon:HardHat, tabs:[
      ["ressources", "Ressources & absences", Clock],
      ["ouvriers", "Ouvriers", HardHat],
      ...(isAdmin ? [["utilisateurs", "Utilisateurs", Users]] : []),
      ...(isAdmin ? [["acces",        "Accès",        Lock]]  : []),
    ]},
    { id:"logistique", label:"Logistique", icon:Truck, tabs:[
      ["fournisseurs", "Fournisseurs", Truck],
      ["vehicules",    "Véhicules",    Car],
      ["emails",       "Emails",       Mail],
      ["situations",   "Fact. de situation", Receipt],
      ...(isAdmin ? [["mail-encours", "Mail encours", Send]] : []),
    ]},
    { id:"outils", label:"Outils", icon:Wrench, tabs:[
      ...(isAdmin ? [["historique", "Historique", RefreshCw]] : []),
      ...(isAdmin ? [["pointages",  "Pointages",  Activity]]  : []),
      ["maintenance", "Maintenance", Wrench],
    ]},
  ];
  const activeSection = SECTIONS.find(s => s.tabs.some(t => t[0] === adminTab)) || SECTIONS[0];

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

      {/* ── Sections ── */}
      <div className="admin-tabs" style={{display:"flex",gap:6,marginBottom:activeSection.tabs.length>1?10:20,flexWrap:"wrap"}}>
        {SECTIONS.map(s=>{
          const a = activeSection.id===s.id;
          return (
            <button key={s.id} className={`atab ${a?"on":"off"}`} onClick={()=>setAdminTab(s.tabs[0][0])}
              style={{
                display:"inline-flex",alignItems:"center",gap:6,
                padding:"8px 16px",borderRadius:RADIUS.md,
                border:a?"none":`1px solid ${T.border}`,
                background:a?acc.accent:"transparent",color:a?acc.onAccent:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                transition:"all .12s",
              }}>
              <Icon as={s.icon} size={13}/>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Sous-onglets de la section active ── */}
      {activeSection.tabs.length > 1 && (
        <div className="admin-tabs" style={{display:"flex",gap:6,marginBottom:20,borderBottom:`1px solid ${T.border}`,paddingBottom:10,flexWrap:"wrap"}}>
          {activeSection.tabs.map(([k,l,IconComp])=>{
            const a = adminTab===k;
            return (
              <button key={k} className={`atab ${a?"on":"off"}`} onClick={()=>setAdminTab(k)}
                style={{
                  display:"inline-flex",alignItems:"center",gap:6,
                  padding:"6px 13px",borderRadius:RADIUS.pill,
                  border:`1px solid ${a?acc.accent:T.border}`,
                  background:a?acc.bg10:"transparent",color:a?acc.accent:T.textSub,
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                  transition:"all .12s",
                }}>
                <Icon as={IconComp} size={12}/>
                {l}
              </button>
            );
          })}
        </div>
      )}

      {adminTab==="ressources" && (
        <PlanningResourcesAdmin T={T} acc={acc}/>
      )}

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

      {adminTab==="mail-encours" && isAdmin && (
        <OngletMailEncours T={T} acc={acc}/>
      )}

      {adminTab==="historique" && isAdmin && (
        <OngletHistorique T={T} acc={acc} chantiers={chantiers}/>
      )}

      {adminTab==="pointages" && isAdmin && (
        <OngletPointages T={T} acc={acc} tauxHoraires={tauxHoraires} profil={profil}/>
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

      {/* ── GROUPES TYPES ── */}
      {adminTab==="groupes_types" && (
        <div className="ac">
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Groupes types</div>
              <div style={{color:T.textSub,fontSize:FONT.xs.size+1,lineHeight:1.6,maxWidth:560}}>
                Liste standard <strong style={{color:T.text}}>ordonnée</strong> des étapes d'exécution d'un chantier. Elle servira à pré-remplir les groupes de la vue <strong style={{color:T.text}}>Chronologique</strong> d'un chantier. Chaque groupe est rattaché à un lot (devis) et à une <strong style={{color:T.text}}>équipe par défaut</strong> — proposée lors de l'affectation, jamais imposée.
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>setResetGtConfirm(true)} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"7px 12px",borderRadius:RADIUS.md,
                border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
              }}>
                <Icon as={RefreshCw} size={11}/>
                Restaurer par défaut
              </button>
              <button onClick={addGroupeType} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:acc.accent,color:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Plus} size={12}/>
                Ajouter un groupe
              </button>
            </div>
          </div>

          {groupesTypes.map((g, i) => (
            <div key={g.id || i} className="ar" style={{flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",flexDirection:"column",gap:1}}>
                <button className="ib" onClick={()=>moveGroupeType(i,-1)} title="Monter (exécuté plus tôt)"><Icon as={ChevronUp} size={12}/></button>
                <button className="ib" onClick={()=>moveGroupeType(i,1)} title="Descendre (exécuté plus tard)"><Icon as={ChevronDown} size={12}/></button>
              </div>
              <div style={{
                width:26,textAlign:"center",flexShrink:0,fontWeight:800,
                fontSize:FONT.xs.size+1,color:T.textMuted,
              }} title={`Rang d'exécution (ordre ${g.ordre})`}>{i+1}</div>
              <div onClick={()=>setEditGtColIdx(editGtColIdx===i?null:i)}
                style={{
                  width:30,height:30,borderRadius:RADIUS.md,flexShrink:0,
                  background:g.couleur||"#888",border:`2px solid ${T.border}`,cursor:"pointer",
                }} title="Couleur du groupe"/>
              {editGtColIdx===i ? (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,flex:"1 1 200px"}}>
                  {COULEURS_PALETTE.map(col=>(
                    <div key={col} onClick={()=>{updGroupeType(i,{couleur:col});setEditGtColIdx(null);}}
                      className={`cdot ${g.couleur===col?"sel":""}`} style={{background:col,cursor:"pointer"}}/>
                  ))}
                </div>
              ) : (
                <>
                  <input className="ti" value={g.nom||""} onChange={e=>updGroupeType(i,{nom:e.target.value})}
                    placeholder="Nom du groupe" style={{flex:"2 1 180px",minWidth:140,fontWeight:600}}/>
                  <select className="ti" value={g.lot_id||""} onChange={e=>updGroupeType(i,{lot_id:e.target.value})}
                    title="Lot (devis) rattaché à ce groupe"
                    style={{flex:"1 1 150px",minWidth:130,cursor:"pointer"}}>
                    <option value="">— Aucun lot —</option>
                    {lots.map(l=>(<option key={l.id} value={l.id}>{l.label}</option>))}
                  </select>
                  <select className="ti" value={g.equipe_id||""} onChange={e=>updGroupeType(i,{equipe_id:e.target.value,ouvriers_prio:[]})}
                    title="Équipe par défaut : proposée lors de l'affectation, jamais imposée"
                    style={{flex:"1 1 150px",minWidth:130,cursor:"pointer",
                      ...(g.equipe_id&&!equipes.some(eq=>eq.id===g.equipe_id)?{color:"#f5a623",fontWeight:700}:{})}}>
                    <option value="">— Aucune équipe —</option>
                    {g.equipe_id&&!equipes.some(eq=>eq.id===g.equipe_id)&&<option value={g.equipe_id}>(équipe supprimée)</option>}
                    {equipes.map(eq=>(<option key={eq.id} value={eq.id}>{eq.nom}{eq.externe?" (externe)":""}</option>))}
                  </select>
                  <button className="btn-d" onClick={()=>setGtToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                    <Icon as={Trash2} size={11}/>
                    Supprimer
                  </button>
                  {/* Ouvriers prioritaires : qui de l'équipe intervient sur ce
                      groupe (un OU plusieurs). Aucun coché = toute l'équipe. */}
                  {(() => {
                    const eq = equipes.find(x => x.id === g.equipe_id);
                    if (!eq || eq.externe) return null;
                    const membres = [...new Set([eq.responsable, ...(eq.membres||[]).map(m=>m.ouvrier)].filter(Boolean))];
                    if (membres.length === 0) return null;
                    const prios = Array.isArray(g.ouvriers_prio) ? g.ouvriers_prio : [];
                    const toggle = (nom) => updGroupeType(i, {
                      ouvriers_prio: prios.includes(nom) ? prios.filter(p=>p!==nom) : [...prios, nom],
                    });
                    return (
                      <div style={{flexBasis:"100%",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",paddingLeft:76}}>
                        <span style={{fontSize:FONT.xs.size,fontWeight:700,color:T.textMuted}}
                          title="Ouvriers de l'équipe proposés en priorité sur ce groupe — si aucun n'est coché, toute l'équipe est proposée">
                          Prioritaires :
                        </span>
                        {membres.map(nom => {
                          const on = prios.includes(nom);
                          return (
                            <button key={nom} onClick={()=>toggle(nom)}
                              title={on ? `${nom} est prioritaire sur « ${g.nom} » — cliquer pour retirer` : `Proposer ${nom} en priorité sur « ${g.nom} »`}
                              style={{
                                padding:"3px 10px",borderRadius:999,cursor:"pointer",fontFamily:"inherit",
                                fontSize:FONT.xs.size,fontWeight:700,
                                border:`1px solid ${on ? acc.accent : T.border}`,
                                background:on ? acc.bg10 : "transparent",
                                color:on ? acc.accent : T.textSub,
                              }}>
                              {on ? "✓ " : ""}{nom}
                            </button>
                          );
                        })}
                        <span style={{fontSize:FONT.xs.size,color:T.textMuted,fontStyle:"italic"}}>
                          {prios.length===0 ? "aucun → toute l'équipe est proposée" : ""}
                        </span>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ))}

          {gtToDelete !== null && (
            <div onClick={()=>setGtToDelete(null)} style={{
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
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce groupe type&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Le groupe <strong style={{color:T.text}}>« {groupesTypes[gtToDelete]?.nom} »</strong> sera retiré du référentiel.
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les groupes déjà créés sur les chantiers ne sont pas touchés.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setGtToDelete(null)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={removeGroupeType} style={{
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

          {resetGtConfirm && (
            <div onClick={()=>setResetGtConfirm(false)} style={{
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
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Restaurer les groupes types par défaut&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Ta liste actuelle sera remplacée par les 12 étapes standards (Démolition → Finition générale), chacune rattachée à son lot.
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setResetGtConfirm(false)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={resetGroupesTypes} style={{
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

      {/* ── ÉQUIPES ── */}
      {adminTab==="equipes" && (
        <div className="ac">
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
            <div>
              <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Équipes</div>
              <div style={{color:T.textSub,fontSize:FONT.xs.size+1,lineHeight:1.6,maxWidth:560}}>
                Équipes stables de l'entreprise : un <strong style={{color:T.text}}>responsable</strong> et des <strong style={{color:T.text}}>membres</strong> pris dans la liste des ouvriers du planning. Elles serviront à pré-remplir les ouvriers des groupes d'un chantier — toujours proposé, jamais imposé.
              </div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>setResetEqConfirm(true)} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"7px 12px",borderRadius:RADIUS.md,
                border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
              }}>
                <Icon as={RefreshCw} size={11}/>
                Restaurer par défaut
              </button>
              <button onClick={addEquipe} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                padding:"8px 14px",borderRadius:RADIUS.md,border:"none",
                background:acc.accent,color:acc.onAccent,
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
              }}>
                <Icon as={Plus} size={12}/>
                Ajouter une équipe
              </button>
            </div>
          </div>

          {equipes.map((eq, i) => {
            // Sélecteur d'ouvrier : la liste du planning + la valeur courante si
            // elle n'y figure pas (prénom pas encore créé dans l'onglet Ouvriers).
            const horsListe = (val) => val && !ouvriers.includes(val);
            const membresPris = (eq.membres || []).map(m => m.ouvrier);
            // Groupes prioritaires : CALCULÉS depuis equipe_id des groupes types
            // (source de vérité unique) — jamais stockés sur l'équipe.
            const groupesPrioritaires = groupesTypes
              .filter(g => g.equipe_id === eq.id)
              .sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
            return (
            <div key={eq.id || i} style={{
              border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:"14px 16px",
              marginBottom:12,background:T.surface,
            }}>
              {/* En-tête : couleur, nom, externe, supprimer */}
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:eq.externe?4:12}}>
                <div onClick={()=>setEditEqColIdx(editEqColIdx===i?null:i)}
                  style={{
                    width:30,height:30,borderRadius:RADIUS.md,flexShrink:0,
                    background:eq.couleur||"#888",border:`2px solid ${T.border}`,cursor:"pointer",
                  }} title="Couleur de l'équipe"/>
                <input className="ti" value={eq.nom||""} onChange={e=>updEquipe(i,{nom:e.target.value})}
                  placeholder="Nom de l'équipe" style={{flex:"1 1 160px",minWidth:130,fontWeight:700}}/>
                <label style={{display:"inline-flex",alignItems:"center",gap:6,cursor:"pointer",
                  fontSize:FONT.xs.size+1,fontWeight:600,color:eq.externe?"#f5a623":T.textSub,userSelect:"none"}}
                  title="Prestataire externe : pas de membres internes, ne compte pas dans les heures internes">
                  <input type="checkbox" checked={!!eq.externe}
                    onChange={e=>updEquipe(i, e.target.checked ? { externe:true, responsable:"", membres:[] } : { externe:false })}
                    style={{accentColor:"#f5a623",width:15,height:15,cursor:"pointer"}}/>
                  Externe
                </label>
                <button className="btn-d" onClick={()=>setEqToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4,marginLeft:"auto"}}>
                  <Icon as={Trash2} size={11}/>
                  Supprimer
                </button>
              </div>

              {editEqColIdx===i && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
                  {COULEURS_PALETTE.map(col=>(
                    <div key={col} onClick={()=>{updEquipe(i,{couleur:col});setEditEqColIdx(null);}}
                      className={`cdot ${eq.couleur===col?"sel":""}`} style={{background:col,cursor:"pointer"}}/>
                  ))}
                </div>
              )}

              {eq.externe ? (
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.5}}>
                  Prestataire externe — pas de membres internes. Sert de repère sur les groupes (démolition, couverture…) sans compter dans les heures internes.
                </div>
              ) : (
                <>
                  {/* Responsable */}
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:10}}>
                    <span style={{fontSize:FONT.xs.size+1,fontWeight:700,color:T.textSub,minWidth:92}}>Responsable</span>
                    <select className="ti" value={eq.responsable||""} onChange={e=>updEquipe(i,{responsable:e.target.value})}
                      style={{flex:"0 1 220px",minWidth:150,cursor:"pointer",
                        ...(horsListe(eq.responsable)?{color:"#f5a623",fontWeight:700}:{})}}>
                      <option value="">— Aucun —</option>
                      {horsListe(eq.responsable) && <option value={eq.responsable}>{eq.responsable} (hors liste planning)</option>}
                      {ouvriers.filter(Boolean).map(o=>(<option key={o} value={o}>{o}</option>))}
                    </select>
                    {horsListe(eq.responsable) && (
                      <span style={{fontSize:FONT.xs.size,color:"#f5a623",display:"inline-flex",alignItems:"center",gap:4}}>
                        <Icon as={AlertTriangle} size={11}/>
                        à créer dans l'onglet Ouvriers
                      </span>
                    )}
                  </div>

                  {/* Membres */}
                  <div style={{display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:FONT.xs.size+1,fontWeight:700,color:T.textSub,minWidth:92,paddingTop:7}}>Membres</span>
                    <div style={{flex:"1 1 300px",display:"flex",flexDirection:"column",gap:6}}>
                      {(eq.membres||[]).map((m, j) => (
                        <div key={j} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                          <select className="ti" value={m.ouvrier||""} onChange={e=>updMembre(i,j,{ouvrier:e.target.value})}
                            style={{flex:"0 1 200px",minWidth:140,cursor:"pointer",
                              ...(horsListe(m.ouvrier)?{color:"#f5a623",fontWeight:700}:{})}}>
                            {horsListe(m.ouvrier) && <option value={m.ouvrier}>{m.ouvrier} (hors liste planning)</option>}
                            {ouvriers.filter(Boolean).filter(o=>o===m.ouvrier||!membresPris.includes(o)).map(o=>(<option key={o} value={o}>{o}</option>))}
                          </select>
                          <label style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:FONT.xs.size,color:T.textMuted}}
                            title="Date à partir de laquelle ce membre est disponible (laisser vide si déjà disponible)">
                            dispo à partir du
                            <input type="date" className="ti" value={m.date_dispo||""}
                              onChange={e=>updMembre(i,j,{date_dispo:e.target.value})}
                              style={{width:140,...(m.date_dispo?{color:"#f5a623",fontWeight:700}:{})}}/>
                          </label>
                          {m.date_dispo && String(m.date_dispo).slice(0,10) > new Date().toISOString().slice(0,10) && (
                            <span title="Visible dans l'équipe, mais ni proposé au pré-remplissage ni compté dans l'effectif avant cette date"
                              style={{
                                display:"inline-flex",alignItems:"center",gap:4,
                                padding:"2px 8px",borderRadius:999,
                                border:"1px solid #f5a623",color:"#f5a623",
                                fontSize:FONT.xs.size,fontWeight:700,
                              }}>
                              à partir du {new Date(m.date_dispo).toLocaleDateString("fr-FR",{day:"numeric",month:"short",year:"numeric"})}
                            </span>
                          )}
                          <button className="ib" onClick={()=>removeMembre(i,j)} title="Retirer ce membre">
                            <Icon as={X} size={12}/>
                          </button>
                        </div>
                      ))}
                      <select className="ti" value="" onChange={e=>addMembre(i, e.target.value)}
                        style={{flex:"0 1 200px",minWidth:140,maxWidth:200,cursor:"pointer",color:T.textMuted}}>
                        <option value="">+ Ajouter un membre…</option>
                        {ouvriers.filter(Boolean).filter(o=>!membresPris.includes(o)&&o!==eq.responsable).map(o=>(<option key={o} value={o}>{o}</option>))}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* Groupes prioritaires (lecture seule, calculés depuis les groupes types) */}
              <div style={{
                display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap",
                marginTop:12,paddingTop:10,borderTop:`1px dashed ${T.border}`,
              }}>
                <span style={{fontSize:FONT.xs.size+1,fontWeight:700,color:T.textSub,minWidth:92,paddingTop:3}}
                  title="Groupes types dont cette équipe est l'équipe par défaut — se règle dans l'onglet Groupes types">
                  Groupes prioritaires
                </span>
                {groupesPrioritaires.length === 0 ? (
                  <span style={{fontSize:FONT.xs.size+1,color:T.textMuted,paddingTop:3}}>
                    Aucun — se règle dans l'onglet <strong style={{color:T.textSub}}>Groupes types</strong> (menu « équipe par défaut »).
                  </span>
                ) : (
                  <div style={{flex:1,display:"flex",flexWrap:"wrap",gap:6}}>
                    {groupesPrioritaires.map(g => (
                      <span key={g.id} style={{
                        display:"inline-flex",alignItems:"center",gap:6,
                        padding:"4px 10px",borderRadius:999,
                        border:`1px solid ${T.border}`,background:T.bg,
                        fontSize:FONT.xs.size+1,fontWeight:600,color:T.text,
                      }}>
                        <span style={{width:9,height:9,borderRadius:999,background:g.couleur||"#888",flexShrink:0}}/>
                        {g.nom}
                        {(g.ouvriers_prio||[]).length > 0 && (
                          <span style={{color:T.textMuted,fontWeight:600}}> · {g.ouvriers_prio.join(", ")}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            );
          })}

          {eqToDelete !== null && (
            <div onClick={()=>setEqToDelete(null)} style={{
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
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cette équipe&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  L'équipe <strong style={{color:T.text}}>« {equipes[eqToDelete]?.nom} »</strong> sera retirée du référentiel.
                  <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Les ouvriers eux-mêmes ne sont pas touchés, ni les affectations déjà faites sur les chantiers.</span>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setEqToDelete(null)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={removeEquipe} style={{
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

          {resetEqConfirm && (
            <div onClick={()=>setResetEqConfirm(false)} style={{
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
                  <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Restaurer les équipes par défaut&nbsp;?</div>
                </div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
                  Ta liste actuelle sera remplacée par les 4 équipes standards : Plomberie, Élec, Second œuvre et Externe.
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setResetEqConfirm(false)} style={{
                    background:"transparent",border:`1px solid ${T.border}`,
                    borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
                  }}>Annuler</button>
                  <button onClick={resetEquipes} style={{
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

      {/* ── HEURES PAR JOUR : cible des comptes rendus ouvriers ── */}
      {adminTab==="heures_jour" && (
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Heures travaillées par jour</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18,maxWidth:640,lineHeight:1.6}}>
            Depuis le {new Date(RYTHME_DATE_DEBUT + "T12:00:00").toLocaleDateString("fr-FR",{day:"numeric",month:"long",year:"numeric"})},
            l'entreprise alterne une semaine sur deux selon le numéro de semaine du calendrier :
            {" "}<strong style={{color:T.text}}>semaines impaires → 4 jours</strong> (lundi à jeudi),
            {" "}<strong style={{color:T.text}}>semaines paires → 5 jours</strong>. 39 h travaillées dans les deux cas —
            c'est la cible exacte des comptes rendus de fin de journée (tâches + trajets + heures indirectes).
          </div>

          {/* Profils du rythme alterné (source : src/rythmeSemaine.js, lecture seule) */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10,marginBottom:14}}>
            {[
              { titre:"Semaines impaires — 4 jours", profil:PROFIL_4J, note:"vendredi non travaillé" },
              { titre:"Semaines paires — 5 jours",   profil:PROFIL_5J, note:"" },
            ].map(({titre, profil, note}) => {
              const cur = getISOWeek(new Date());
              const active = libelleRythme(cur.year, cur.week) !== "" &&
                ((cur.week % 2 === 1) === (profil === PROFIL_4J));
              return (
                <div key={titre} style={{
                  background:T.surface,border:`1.5px solid ${active ? acc.border : T.border}`,
                  borderRadius:RADIUS.lg,padding:"14px 16px",
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                    <span style={{fontSize:FONT.sm.size,fontWeight:800,color:T.text}}>{titre}</span>
                    {active && (
                      <span style={{fontSize:FONT.xs.size,fontWeight:700,color:acc.accentDark||acc.accent,background:acc.bg10,border:`1px solid ${acc.border}`,borderRadius:RADIUS.pill,padding:"1px 8px"}}>
                        semaine en cours
                      </span>
                    )}
                  </div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {JOURS.map(j => {
                      const h = profil[j] ?? 0;
                      return (
                        <div key={j} style={{
                          flex:"1 1 0", minWidth:44, textAlign:"center", padding:"8px 4px",
                          background:h > 0 ? T.card : "transparent",
                          border:`1px ${h > 0 ? "solid" : "dashed"} ${T.border}`, borderRadius:RADIUS.md,
                          opacity:h > 0 ? 1 : .55,
                        }}>
                          <div style={{fontSize:FONT.xs.size-1,color:T.textMuted,fontWeight:700,letterSpacing:.8,textTransform:"uppercase"}}>{j.slice(0,3)}</div>
                          <div style={{fontSize:FONT.md.size,fontWeight:800,color:h > 0 ? acc.accent : T.textMuted,marginTop:2}}>
                            {h > 0 ? `${h}h` : "repos"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8}}>
                    Total : <strong style={{color:T.text}}>{JOURS.reduce((s,j) => s + (parseFloat(profil[j])||0), 0)}h</strong>
                    {note ? ` · ${note}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"12px 14px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6,marginBottom:22}}>
            <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
            <span>Ce rythme alimente la cible des comptes rendus ouvriers, la capacité du planning semaine et le barème de repli du bilan. Les rapports déjà envoyés ne sont pas recalculés. Pour modifier le rythme, demander une évolution de l'application.</span>
          </div>

          {/* Exceptions par date (fériés, ponts…) */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg,padding:14}}>
            <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:6}}>
              <Icon as={Clock} size={11}/>
              Exceptions par date (fériés, ponts…)
            </div>
            <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:12,lineHeight:1.6}}>
              À la date indiquée, le compte rendu attend ce volume à la place de la valeur hebdomadaire. Mettre <strong style={{color:T.text}}>0 h</strong> pour un jour non travaillé (férié).
            </div>

            {Object.keys(heuresParJour.exceptions || {}).length > 0 && (
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                {Object.entries(heuresParJour.exceptions || {}).sort(([a],[b]) => a.localeCompare(b)).map(([d, h]) => {
                  const passee = d < new Date().toISOString().slice(0,10);
                  return (
                    <div key={d} style={{display:"flex",alignItems:"center",gap:8,opacity:passee?0.5:1}}>
                      <span style={{flex:"0 0 auto",minWidth:150,fontSize:FONT.sm.size,fontWeight:700,color:T.text}}>
                        {new Date(d + "T12:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
                      </span>
                      <input type="number" min="0" step="0.5" value={h ?? 0}
                        onChange={e=>updExceptionJour(d, e.target.value)}
                        style={{
                          width:60,padding:"6px 8px",borderRadius:RADIUS.md,textAlign:"center",
                          border:`1px solid ${T.border}`,background:T.inputBg||T.card,color:acc.accent,
                          fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,outline:"none",
                        }}/>
                      <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>h</span>
                      {(parseFloat(h)||0) === 0 && (
                        <span style={{fontSize:FONT.xs.size,fontWeight:700,color:"#f59e0b",background:"rgba(245,158,11,0.15)",padding:"1px 7px",borderRadius:RADIUS.pill}}>non travaillé</span>
                      )}
                      <button onClick={()=>removeExceptionJour(d)} title="Supprimer" style={{
                        display:"inline-flex",alignItems:"center",justifyContent:"center",marginLeft:"auto",
                        background:"transparent",border:`1px solid rgba(224,92,92,0.3)`,
                        borderRadius:RADIUS.sm,padding:"6px 8px",color:"#e15a5a",cursor:"pointer",
                      }}>
                        <Icon as={Trash2} size={11}/>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <input type="date" value={excDate} onChange={e=>setExcDate(e.target.value)}
                style={{
                  padding:"7px 10px",borderRadius:RADIUS.md,border:`1px dashed ${T.border}`,
                  background:"transparent",color:T.text,
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",
                }}/>
              <input type="number" min="0" step="0.5" value={excHeures} onChange={e=>setExcHeures(e.target.value)}
                style={{
                  width:60,padding:"7px 10px",borderRadius:RADIUS.md,textAlign:"center",
                  border:`1px dashed ${T.border}`,background:"transparent",color:T.text,
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,outline:"none",
                }}/>
              <span style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>h</span>
              <button onClick={addExceptionJour} disabled={!excDate} style={{
                display:"inline-flex",alignItems:"center",gap:5,
                background:excDate ? acc.accent : T.border,
                color:excDate ? acc.onAccent : T.textMuted,
                border:"none",borderRadius:RADIUS.md,padding:"7px 14px",
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:800,cursor:excDate?"pointer":"not-allowed",
              }}>
                <Icon as={Plus} size={11}/>
                Ajouter
              </button>
            </div>
          </div>
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

          {/* % d'acompte par défaut (Point 5) — recettes prévues du diagramme
              financier. Priorité : États financiers du chantier > surcharge
              chantier > CE réglage. Saisie en % (30 = 30 %). */}
          <div style={{fontWeight:700,fontSize:16,marginBottom:4}}>Acompte par défaut</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:12}}>
            % d'acompte à la signature, utilisé par les <strong>recettes prévisionnelles</strong> du diagramme financier quand ni les États financiers ni le chantier n'en précisent un.
          </div>
          <div className="ar" style={{gap:12,marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
            <div style={{flex:1,fontWeight:700,fontSize:15,color:T.text}}>Acompte à la signature (par défaut)</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <input
                type="number" min="0" max="100" step="1"
                value={acomptePctDefaut}
                onChange={e=>{
                  const v=e.target.value;
                  setAcomptePctDefaut(v);
                  saveConfig("acompte_pct_defaut",v===""?"":parseFloat(v)||0);
                }}
                placeholder="30"
                style={{width:80,padding:"7px 10px",borderRadius:8,textAlign:"center",
                  border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                  fontFamily:"inherit",fontSize:15,fontWeight:700,outline:"none"}}
              />
              <span style={{fontSize:13,color:T.textMuted}}>%</span>
            </div>
            {(acomptePctDefaut===""||acomptePctDefaut==null)&&(
              <span style={{fontSize:12,color:T.textMuted,fontStyle:"italic"}}>
                non réglé → pas d'acompte dans le prévisionnel
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

      {/* ── FACTURES DE SITUATION : seuils d'avancement + rôles notifiés ── */}
      {adminTab==="situations"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Factures de situation</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:18,maxWidth:640,lineHeight:1.6}}>
            À chaque seuil d'<strong>avancement du chantier</strong> franchi, une facture de situation passe
            « à émettre » dans la frise du cycle de vie (phase Travaux) et un email de notification part
            automatiquement — une seule fois par seuil et par chantier (les chantiers au statut Terminé sont exclus).
          </div>

          {/* Seuils */}
          <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:T.text}}>Seuils de déclenchement</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:10}}>Défaut : {SEUILS_SITUATIONS.join(" · ")} %.</div>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:24,paddingBottom:20,borderBottom:`1px solid ${T.border}`}}>
            {seuilsSituations.map(s => (
              <span key={s} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                padding:"6px 6px 6px 12px",borderRadius:RADIUS.pill,
                border:`1px solid ${T.border}`,background:T.surface,
                fontSize:14,fontWeight:800,color:T.accent,
              }}>
                {s} %
                <button onClick={()=>removeSeuilSituation(s)}
                  title={seuilsSituations.length<=1?"Au moins un seuil requis":"Retirer ce seuil"}
                  disabled={seuilsSituations.length<=1}
                  style={{
                    width:20,height:20,borderRadius:"50%",border:"none",
                    background:T.card,color:T.textMuted,cursor:seuilsSituations.length<=1?"default":"pointer",
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    fontFamily:"inherit",fontSize:12,fontWeight:800,opacity:seuilsSituations.length<=1?0.4:1,
                  }}>×</button>
              </span>
            ))}
            <input type="number" min="1" max="100" step="5" value={nouveauSeuil}
              onChange={e=>setNouveauSeuil(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")addSeuilSituation();}}
              placeholder="%"
              style={{width:64,padding:"7px 10px",borderRadius:8,textAlign:"center",
                border:`1px solid ${T.border}`,background:T.inputBg,color:T.accent,
                fontFamily:"inherit",fontSize:14,fontWeight:700,outline:"none"}}/>
            <button onClick={addSeuilSituation}
              disabled={!(parseFloat(nouveauSeuil)>=1&&parseFloat(nouveauSeuil)<=100)}
              style={{
                padding:"8px 14px",borderRadius:8,border:`1px solid ${T.border}`,
                background:T.surface,color:T.textSub,fontFamily:"inherit",
                fontSize:13,fontWeight:700,cursor:"pointer",
              }}>+ Ajouter un seuil</button>
          </div>

          {/* Rôles destinataires */}
          <div style={{fontWeight:700,fontSize:15,marginBottom:6,color:T.text}}>Destinataires de la notification</div>
          <div style={{color:T.textSub,fontSize:13,marginBottom:10,maxWidth:640,lineHeight:1.6}}>
            L'email « facture de situation prête » est envoyé aux utilisateurs <strong>actifs</strong> des rôles cochés
            (seuls les comptes avec une vraie adresse email la reçoivent — les comptes locaux sont ignorés).
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
            {ROLES_DEFAULT_RENOVATION.map(r => {
              const coche = rolesSituations.includes(r.id);
              return (
                <label key={r.id} style={{
                  display:"inline-flex",alignItems:"center",gap:8,
                  padding:"9px 14px",borderRadius:RADIUS.lg,cursor:"pointer",
                  border:`1px solid ${coche ? r.color : T.border}`,
                  background:coche ? `${r.color}1a` : T.surface,
                }}>
                  <input type="checkbox" checked={coche} onChange={()=>toggleRoleSituation(r.id)}
                    style={{width:15,height:15,accentColor:r.color,cursor:"pointer"}}/>
                  <span style={{fontSize:14,fontWeight:700,color:coche ? r.color : T.textSub}}>{r.label}</span>
                </label>
              );
            })}
          </div>
          {rolesSituations.length===0&&(
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"rgba(245,158,11,0.12)",border:"1px solid rgba(245,158,11,0.4)",borderRadius:RADIUS.md,fontSize:13,color:"#f59e0b",fontWeight:600}}>
              <Icon as={AlertTriangle} size={14}/>
              Aucun rôle coché : aucune notification ne sera envoyée (les situations restent signalées dans la frise).
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
              {editChIdx!==i&&operations.length>0&&(
                <select className="ti" value={c.operation_id||""}
                  onChange={e=>updateChantier(i,{operation_id:e.target.value})}
                  title="Opération (maison) de rattachement"
                  style={{maxWidth:180,color:c.operation_id?T.text:T.textMuted}}>
                  <option value="">— Sans opération —</option>
                  {operations.map(o=><option key={o.id} value={o.id}>{o.nom}</option>)}
                </select>
              )}
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

      {adminTab==="operations"&&(
        <div className="ac">
          <div style={{fontWeight:800,fontSize:FONT.md.size,marginBottom:4,color:T.text}}>Opérations (maisons / adresses)</div>
          <div style={{color:T.textSub,fontSize:FONT.xs.size+1,marginBottom:18}}>
            Une opération regroupe les chantiers/logements d'une même maison. Le rattachement est optionnel : un chantier sans opération fonctionne exactement comme avant.
          </div>
          {operations.length===0&&(
            <div style={{color:T.textMuted,fontSize:FONT.sm.size,marginBottom:14}}>
              Aucune opération pour l'instant. Crée la première ci-dessous, puis rattache ses chantiers.
            </div>
          )}
          {operations.map((o,i)=>{
            const rattaches=chantiers.filter(c=>c.operation_id===o.id);
            const libres=chantiers.filter(c=>!c.operation_id);
            return (
              <div key={o.id} style={{border:`1px solid ${T.border}`,borderRadius:RADIUS.md,padding:12,marginBottom:10}}>
                <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                  <div className={`cdot ${editOpIdx===i?"sel":""}`}
                    style={{background:o.couleur,border:`2px solid ${T.border}`}}
                    onClick={()=>setEditOpIdx(editOpIdx===i?null:i)} title="Couleur"/>
                  {editOpIdx===i
                    ?<div style={{display:"flex",flexWrap:"wrap",gap:6,flex:1}}>
                        {COULEURS_PALETTE.map(col=>(
                          <div key={col} className={`cdot ${o.couleur===col?"sel":""}`}
                            style={{background:col}} onClick={()=>{updOperation(i,{couleur:col});setEditOpIdx(null);}}/>
                        ))}
                      </div>
                    :<>
                        <input className="ti" value={o.nom} onChange={e=>updOperation(i,{nom:e.target.value})}
                          placeholder="Nom de l'opération…" style={{fontWeight:700,flex:1,minWidth:140}}/>
                        <input className="ti" value={o.adresse||""} onChange={e=>updOperation(i,{adresse:e.target.value})}
                          placeholder="Adresse…" style={{flex:2,minWidth:180}}/>
                      </>
                  }
                  {editOpIdx===i
                    ?<button className="btn-g" style={{fontSize:FONT.xs.size+1,padding:"5px 10px",display:"inline-flex",alignItems:"center",gap:4}} onClick={()=>setEditOpIdx(null)}>
                        <Icon as={X} size={11}/>
                      </button>
                    :rattaches.length===0
                      ?<button className="btn-d" onClick={()=>setOpToDelete(i)} style={{display:"inline-flex",alignItems:"center",gap:4}}>
                          <Icon as={Trash2} size={11}/>
                          Supprimer
                        </button>
                      :<span style={{fontSize:FONT.xs.size+1,color:T.textMuted,whiteSpace:"nowrap"}}
                          title="Détache d'abord tous ses chantiers pour pouvoir la supprimer">
                          {rattaches.length} logement{rattaches.length>1?"s":""}
                        </span>
                  }
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:10}}>
                  {rattaches.map((c,ri)=>(
                    <span key={c.id} style={{display:"inline-flex",alignItems:"center",gap:6,border:`1px solid ${T.border}`,borderRadius:999,padding:"4px 10px",fontSize:FONT.xs.size+1,color:T.text}}>
                      <span style={{color:T.textMuted,fontWeight:700,fontSize:FONT.xs.size}}>{ri+1}.</span>
                      <span style={{width:8,height:8,borderRadius:"50%",background:c.couleur,display:"inline-block"}}/>
                      {c.nom}
                      {rattaches.length>1&&(
                        <span style={{display:"inline-flex",flexDirection:"column",gap:0}}>
                          <button className="ib" onClick={()=>moveChantierDansOperation(o.id,c.id,-1)} disabled={ri===0}
                            title="Monter (ordre des lignes du chemin de fer)" style={{padding:0,height:10,opacity:ri===0?.3:1}}>
                            <Icon as={ChevronUp} size={10}/>
                          </button>
                          <button className="ib" onClick={()=>moveChantierDansOperation(o.id,c.id,1)} disabled={ri===rattaches.length-1}
                            title="Descendre" style={{padding:0,height:10,opacity:ri===rattaches.length-1?.3:1}}>
                            <Icon as={ChevronDown} size={10}/>
                          </button>
                        </span>
                      )}
                      <button className="ib" onClick={()=>setChantierOperation(c.id,"")} title="Détacher de l'opération">
                        <Icon as={X} size={11}/>
                      </button>
                    </span>
                  ))}
                  {rattaches.length===0&&(
                    <span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Aucun chantier rattaché.</span>
                  )}
                  {libres.length>0&&(
                    <select className="ti" value="" onChange={e=>{if(e.target.value)setChantierOperation(e.target.value,o.id);}}
                      title="Rattacher un chantier à cette opération" style={{maxWidth:220}}>
                      <option value="">+ Rattacher un chantier…</option>
                      {libres.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{display:"flex",gap:10,marginTop:18,flexWrap:"wrap",alignItems:"center"}}>
            <input className="ti" value={newOpNom} onChange={e=>setNewOpNom(e.target.value)}
              placeholder="Nom de l'opération (ex : Tourbouton 102)…" style={{flex:1,minWidth:180}}
              onKeyDown={e=>e.key==="Enter"&&addOperation()}/>
            <button className="btn-p" onClick={addOperation} style={{display:"inline-flex",alignItems:"center",gap:5}}>
              <Icon as={Plus} size={12}/>
              Créer l'opération
            </button>
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

      {/* ── Modal suppression opération ── */}
      {opToDelete !== null && (
        <div onClick={()=>setOpToDelete(null)} style={{
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
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer cette opération&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              L'opération <strong style={{color:T.text}}>« {operations[opToDelete]?.nom} »</strong> sera retirée de la liste.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Aucun chantier n'y est rattaché : rien d'autre ne sera modifié.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setOpToDelete(null)} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",
              }}>Annuler</button>
              <button onClick={removeOperation} style={{
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
