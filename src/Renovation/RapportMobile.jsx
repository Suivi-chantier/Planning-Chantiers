import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "../supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, LOGO_RENO_H, LOGO_RENO_V, getCurrentWeek, getWeekId, getTodayJour, FONT, RADIUS, SPACING, SEMANTIC, PROFERO_YELLOW } from "../constants";
import { Icon } from "../ui";
import {
  Check, X, Clock, Camera, Plus, Minus, RotateCw, ShoppingCart, Car,
  ClipboardList, AlertTriangle, MessageSquare, Zap, Users, BarChart3,
  Send, Pencil, ChevronRight, Sparkles, FileText, Coffee, Smile,
  Hourglass, Calendar, RefreshCw, LogOut, ImagePlus, ListPlus, Trash2,
} from "lucide-react";
import BesoinCommandeDrawer from "./BesoinCommandeDrawer";

// ─── THÈME LIGHT CHANTIER ─────────────────────────────────────────────────────
// Palette claire (lisibilité extérieure pour les ouvriers en plein soleil)
// alignée sur le design system Profero (jaune accent, FONT/RADIUS partagés).
const T = {
  bg:        "#f4f6fa",
  surface:   "#ffffff",
  card:      "#ffffff",
  cardAlt:   "#fafbfd",
  border:    "#e0e4ef",
  borderHover:"#c0c8d8",
  text:      "#1a1f2e",
  textSub:   "#5a6478",
  textMuted: "#8a9ab0",
  accent:    PROFERO_YELLOW,
  accentText:"#1a1f2e",
  // sémantique (du design system SEMANTIC)
  success:   SEMANTIC.success.color,
  successBg: SEMANTIC.success.bg,
  successBd: SEMANTIC.success.border,
  warning:   SEMANTIC.warning.color,
  warningBg: SEMANTIC.warning.bg,
  warningBd: SEMANTIC.warning.border,
  danger:    SEMANTIC.danger.color,
  dangerBg:  SEMANTIC.danger.bg,
  dangerBd:  SEMANTIC.danger.border,
  info:      SEMANTIC.info.color,
  infoBg:    SEMANTIC.info.bg,
  infoBd:    SEMANTIC.info.border,
};

// ─── HELPER EMAIL ─────────────────────────────────────────────────────────────
// Passe par /api/send-email (Vercel serverless) au lieu d'appeler Resend
// directement : permet d'utiliser le from vérifié (@groupe-profero.com via
// RESEND_FROM env var) au lieu de onboarding@resend.dev qui finit en spam.
async function sendRapportEmail(rapport, chantierNom) {
  const tachesHtml = rapport.taches.map(t => {
    const icon = t.statut==="faite"?"✅":t.statut==="en_cours"?"🔄":"❌";
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${icon} <strong>${t.planifie}</strong></td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:#5b8af5;font-weight:700">${t.heures_reelles||0}h</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;color:#8b5cf6;font-weight:700">${t.avancement||0}%</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#666">${t.remarque||"—"}</td>
    </tr>`;
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#1a1f2e;padding:20px;border-radius:8px 8px 0 0">
      <h2 style="color:#fff;margin:0">Compte rendu — ${rapport.ouvrier}</h2>
      <p style="color:#9aa5c0;margin:6px 0 0">${rapport.chantier_nom} · ${rapport.date_rapport}</p>
    </div>
    <div style="background:#f9f9f9;padding:20px;border-radius:0 0 8px 8px">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Tâche</th>
          <th style="text-align:center;padding:8px;border-bottom:2px solid #ddd">Durée</th>
          <th style="text-align:center;padding:8px;border-bottom:2px solid #ddd">Avancement</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Remarque</th>
        </tr></thead>
        <tbody>${tachesHtml}</tbody>
      </table>
      ${rapport.remarque?`<div style="margin-top:16px;padding:12px;background:#fff;border-radius:6px;border-left:4px solid #5b8af5">
        <strong>Remarque générale :</strong><br>${rapport.remarque}
      </div>`:""}
    </div>
  </div>`;
  const res = await fetch("/api/send-email", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      to:["suivi.chantier@groupe-profero.com", "loris.bessonneau@groupe-profero.com"],
      subject:`CR ${rapport.ouvrier} — ${chantierNom} — ${rapport.date_rapport}`,
      html,
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}


// ─── HELPER UPLOAD PHOTO ──────────────────────────────────────────────────────
// Renvoie { url } en cas de succès, { error } en cas d'échec (au lieu de
// retourner null silencieusement) — pour que l'UI puisse afficher l'erreur.
async function uploadRapportPhoto(file, pathPrefix) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    const path = `${pathPrefix}/${safe}`;
    const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
    if (error) { console.error("upload photo:", error); return { error: error.message || "Erreur upload" }; }
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    if (!data?.publicUrl) return { error: "URL publique introuvable" };
    return { url: data.publicUrl };
  } catch (e) {
    console.error("upload photo (catch):", e);
    return { error: e.message || "Erreur réseau" };
  }
}

// ─── COMPOSANT PHOTOS PICKER ──────────────────────────────────────────────────
function PhotosPicker({ photos, onChange, pathPrefix, color="#5b8af5", label="Photos" }) {
  const [uploading, setUploading] = useState(0);
  const [errors, setErrors] = useState([]); // [{ name, msg }]
  const cameraRef = React.useRef(null); // capture="environment" → ouvre l'appareil photo
  const galleryRef = React.useRef(null); // pas de capture → galerie / fichiers

  const onFiles = async (files, sourceRef) => {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    setErrors([]);
    setUploading(arr.length);
    const urls = [];
    const newErrors = [];
    for (const f of arr) {
      const res = await uploadRapportPhoto(f, pathPrefix);
      if (res.url) urls.push(res.url);
      else newErrors.push({ name: f.name, msg: res.error });
      setUploading(n => n - 1);
    }
    if (urls.length > 0) onChange([...(photos || []), ...urls]);
    if (newErrors.length > 0) setErrors(newErrors);
    if (sourceRef?.current) sourceRef.current.value = "";
  };

  const remove = (i) => onChange((photos || []).filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color}}>
          <Icon as={Camera} size={12} strokeWidth={2.2}/>
          {label}{(photos?.length||0) > 0 ? ` · ${photos.length}` : ""}
        </span>
        {uploading > 0 && (
          <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:FONT.sm.size,color:T.warning,fontWeight:600}}>
            <Icon as={RotateCw} size={11} strokeWidth={2.2} style={{animation:"spin 1s linear infinite"}}/>
            Upload… {uploading}
          </span>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{
          background:T.dangerBg,border:`1px solid ${T.dangerBd}`,
          borderRadius:RADIUS.lg,padding:"8px 10px",marginBottom:8,fontSize:FONT.sm.size,color:T.danger,
        }}>
          <div style={{fontWeight:700,marginBottom:4,display:"flex",alignItems:"center",gap:5}}>
            <Icon as={AlertTriangle} size={12} strokeWidth={2.2}/>
            {errors.length} photo{errors.length>1?"s":""} non envoyée{errors.length>1?"s":""}
          </div>
          {errors.slice(0,3).map((e,i) => (
            <div key={i} style={{fontSize:FONT.xs.size+1,opacity:0.85,marginTop:2}}>
              • {e.name} — {e.msg}
            </div>
          ))}
          {errors.length > 3 && <div style={{fontSize:FONT.xs.size+1,opacity:0.8,marginTop:2}}>+ {errors.length-3} autres</div>}
          <button onClick={()=>{setErrors([]); galleryRef.current?.click();}} style={{
            marginTop:6,padding:"5px 10px",borderRadius:RADIUS.md,border:`1px solid ${T.danger}`,
            background:"transparent",color:T.danger,fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
            display:"inline-flex",alignItems:"center",gap:5,
          }}>
            <Icon as={RotateCw} size={11} strokeWidth={2.2}/>
            Réessayer
          </button>
        </div>
      )}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {(photos || []).map((url, i) => (
          <div key={i} style={{position:"relative",width:72,height:72,borderRadius:RADIUS.lg,overflow:"hidden",
            border:`1.5px solid ${color}33`,background:T.bg}}>
            <img src={url} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
              onClick={()=>window.open(url,"_blank")} />
            <button onClick={()=>remove(i)} style={{position:"absolute",top:2,right:2,
              background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",borderRadius:"50%",
              width:22,height:22,cursor:"pointer",padding:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>
              <Icon as={X} size={12} strokeWidth={2.5}/>
            </button>
          </div>
        ))}
        {/* Bouton appareil photo */}
        <label style={{
          width:72,height:72,borderRadius:RADIUS.lg,border:`1.5px dashed ${color}66`,cursor:"pointer",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,
          background:`${color}0A`,color,fontSize:FONT.xs.size,fontWeight:600,fontFamily:"inherit",
          textAlign:"center",lineHeight:1.1,padding:"4px",
        }}>
          <Icon as={Camera} size={22} strokeWidth={2.2}/>
          <span>Photo</span>
          <input ref={cameraRef} type="file" accept="image/*" multiple capture="environment"
            onChange={e=>onFiles(e.target.files, cameraRef)} style={{display:"none"}} />
        </label>
        {/* Bouton importer depuis le téléphone */}
        <label style={{
          width:72,height:72,borderRadius:RADIUS.lg,border:`1.5px dashed ${color}66`,cursor:"pointer",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,
          background:`${color}0A`,color,fontSize:FONT.xs.size,fontWeight:600,fontFamily:"inherit",
          textAlign:"center",lineHeight:1.1,padding:"4px",
        }}>
          <Icon as={ImagePlus} size={22} strokeWidth={2.2}/>
          <span>Importer</span>
          <input ref={galleryRef} type="file" accept="image/*" multiple
            onChange={e=>onFiles(e.target.files, galleryRef)} style={{display:"none"}} />
        </label>
      </div>
    </div>
  );
}

// ─── PAGE RAPPORT MOBILE ──────────────────────────────────────────────────────
function PageRapportMobile() {
  const [step, setStep]             = useState("login"); // login | rapport | done
  const [ouvrier, setOuvrier]       = useState(() => localStorage.getItem("mon_prenom") || "");
  const [chantiers, setChantiers]   = useState([]);
  const [ouvriers, setOuvriers]     = useState(DEFAULT_OUVRIERS);
  const [taches, setTaches]         = useState([]);
  const [trajetMatin, setTrajetMatin] = useState(""); // minutes (string pour input)
  const [trajetSoir, setTrajetSoir]   = useState(""); // minutes (string pour input)
  // Heures indirectes (P7) : non productives, rattachées à un chantier mais à
  // aucune tâche vendue. Format : [{ motif, heures, chantier_id }]. Le conducteur
  // les retrouve pré-remplies dans l'écran de validation et peut compléter.
  const [heuresIndirectes, setHeuresIndirectes] = useState([]);
  const [remarque, setRemarque]     = useState("");
  const [paniers, setPaniers]       = useState({});      // { chantier_id: { articleId: {article, qty} } }
  const [besoinDrawer, setBesoinDrawer] = useState(null); // chantier_id du drawer ouvert
  const [photosChantier, setPhotosChantier] = useState({}); // { chantier_id: [url, ...] }
  const [submitting, setSubmitting] = useState(false);
  const [planData, setPlanData]     = useState(null);
  // Brouillon : persistance locale pour que les saisies survivent à un refresh
  // et que l'ouvrier puisse compléter le formulaire tout au long de la journée.
  // Clé = ouvrier + date → un brouillon distinct par personne et par jour.
  const [brouillonRepris, setBrouillonRepris] = useState(false);
  const [lastSaved, setLastSaved]   = useState(null);
  // Heures attendues par jour — config Admin (clé planning_config "heures_par_jour").
  // Le défaut local sert de fallback tant que la config n'est pas chargée.
  const HEURES_PAR_JOUR_DEFAUT = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9, "Vendredi": 9 };
  const [heuresParJour, setHeuresParJour] = useState(HEURES_PAR_JOUR_DEFAUT);

  const today    = new Date();
  const dateStr  = today.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  const dateKey  = today.toLocaleDateString("fr-FR");
  const {year, week} = getCurrentWeek();
  const weekId   = getWeekId(year, week);
  const todayJour = getTodayJour();
  // Cible d'heures du jour, lue depuis la config Admin (onglet "Planning").
  const cibleHeures = parseFloat(heuresParJour?.[todayJour]) || HEURES_PAR_JOUR_DEFAUT[todayJour] || 10;

  // Load config + planning
  useEffect(() => {
    const load = async () => {
      const { data: cfg } = await supabase.from("planning_config").select("*");
      if (cfg?.length) {
        cfg.forEach(r => {
          if (r.key === "chantiers") setChantiers(r.value);
          if (r.key === "ouvriers")  setOuvriers(r.value);
          if (r.key === "heures_par_jour" && r.value) setHeuresParJour({ ...HEURES_PAR_JOUR_DEFAUT, ...r.value });
        });
      }
    };
    load();
  }, []);

  // ── Brouillon : helpers + autosave ──────────────────────────────────────────
  const brouillonKey = (nom, date) => `cr_brouillon::${nom}::${date}`;

  const effacerBrouillon = () => {
    const nom = ouvrier.trim();
    if (!nom) return;
    try { localStorage.removeItem(brouillonKey(nom, dateKey)); } catch {}
  };

  // Autosave dès qu'on est en étape rapport et qu'on a un ouvrier.
  useEffect(() => {
    if (step !== "rapport") return;
    const nom = ouvrier.trim();
    if (!nom) return;
    try {
      const payload = {
        taches, trajetMatin, trajetSoir, heuresIndirectes, remarque,
        paniers, photosChantier, planData,
        ts: Date.now(),
      };
      localStorage.setItem(brouillonKey(nom, dateKey), JSON.stringify(payload));
      setLastSaved(new Date());
    } catch (e) {
      // QuotaExceeded ou JSON.stringify circular → on log mais on ne bloque pas
      console.warn("Sauvegarde brouillon:", e);
    }
  }, [step, ouvrier, dateKey, taches, trajetMatin, trajetSoir, heuresIndirectes, remarque, paniers, photosChantier, planData]);

  const repartirDeZero = () => {
    effacerBrouillon();
    setBrouillonRepris(false);
    setTrajetMatin("");
    setTrajetSoir("");
    setHeuresIndirectes([]);
    setRemarque("");
    setPaniers({});
    setPhotosChantier({});
    setLastSaved(null);
    loadTaches(ouvrier.trim());
  };

  // Quand ouvrier confirmé, charge ses tâches du jour
  const loadTaches = async (nom) => {
    if (!todayJour) { setStep("rapport"); return; }
    const { data: cells } = await supabase
      .from("planning_cells").select("*").eq("week_id", weekId);

    const { data: cfg } = await supabase.from("planning_config").select("*");
    let chantiersData = DEFAULT_CHANTIERS;
    if (cfg?.length) { const c=cfg.find(r=>r.key==="chantiers"); if(c) chantiersData=c.value; }

    const tachesInit = [];
    (cells||[]).forEach(cell => {
      if (cell.jour !== todayJour) return;
      if (!(cell.ouvriers||[]).includes(nom)) return;
      const ch = chantiersData.find(c => c.id === cell.chantier_id);

      if (cell.taches && cell.taches.length > 0) {
        cell.taches.forEach(t => {
          if (!t.text?.trim()) return;
          const pourTout = !t.ouvriers || t.ouvriers.length === 0;
          const pourMoi  = (t.ouvriers||[]).includes(nom);
          if (pourTout || pourMoi) {
            tachesInit.push({
              chantier_id: cell.chantier_id,
              chantier_nom: ch?.nom || cell.chantier_id,
              chantier_couleur: ch?.couleur || "#c8d8f0",
              planifie: t.text,
              tache_id: t.tache_id || null,
              phase_id: t.phase_id || null,
              statut: null, remarque: "",
              pourTout,
            });
          }
        });
      } else if (cell.planifie?.trim()) {
        cell.planifie.split("\n").filter(l=>l.trim()).forEach(ligne => {
          tachesInit.push({
            chantier_id: cell.chantier_id,
            chantier_nom: ch?.nom || cell.chantier_id,
            chantier_couleur: ch?.couleur || "#c8d8f0",
            planifie: ligne.trim(),
            statut: null, remarque: "", pourTout: true,
          });
        });
      }
    });

    setPlanData({ chantiersData });
    setTaches(tachesInit);
    setStep("rapport");
  };

  const confirmerPrenom = () => {
    if (!ouvrier.trim()) return;
    const nom = ouvrier.trim();
    localStorage.setItem("mon_prenom", nom);
    // Tente de restaurer un brouillon du jour pour cet ouvrier.
    // Si présent : on saute le rechargement du planning et on reprend tel quel.
    try {
      const raw = localStorage.getItem(brouillonKey(nom, dateKey));
      if (raw) {
        const b = JSON.parse(raw);
        setTaches(Array.isArray(b.taches) ? b.taches : []);
        setTrajetMatin(b.trajetMatin || "");
        setTrajetSoir(b.trajetSoir || "");
        setHeuresIndirectes(Array.isArray(b.heuresIndirectes) ? b.heuresIndirectes : []);
        setRemarque(b.remarque || "");
        setPaniers(b.paniers || {});
        setPhotosChantier(b.photosChantier || {});
        if (b.planData) setPlanData(b.planData);
        setBrouillonRepris(true);
        setStep("rapport");
        return;
      }
    } catch (e) {
      console.warn("Brouillon corrompu, on recharge depuis le planning:", e);
    }
    // Pas de brouillon : on reset les états locaux pour éviter qu'un changement
    // d'ouvrier (bouton "Changer") n'hérite des trajets/paniers/etc. du précédent.
    setBrouillonRepris(false);
    setTrajetMatin("");
    setTrajetSoir("");
    setHeuresIndirectes([]);
    setRemarque("");
    setPaniers({});
    setPhotosChantier({});
    setLastSaved(null);
    loadTaches(nom);
  };

  // Statut → auto-remplit avancement (100/0) et heures (0 pour non_faite).
  // Si on quitte faite/non_faite vers en_cours, on vide pour forcer une vraie
  // saisie (l'ancien 0/100 hérité de l'auto-fill serait faux).
  const setStatut = (idx, statut) => setTaches(t => t.map((x, i) => {
    if (i !== idx) return x;
    let avancement = x.avancement;
    let heures_reelles = x.heures_reelles;
    if (statut === "faite") {
      avancement = "100";
    } else if (statut === "non_faite") {
      avancement = "0";
      heures_reelles = ""; // non faite = 0h comptées dans le total
    } else if (statut === "en_cours") {
      if (x.statut === "faite" || x.statut === "non_faite") avancement = "";
    }
    // Si on quitte non_faite, on reset les heures pour forcer la saisie.
    if (x.statut === "non_faite" && statut !== "non_faite") heures_reelles = "";
    return { ...x, statut, avancement, heures_reelles };
  }));
  const setTacheRemarque  = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, remarque:val} : x));
  const setTachePlanifie  = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, planifie:val} : x));
  const setTacheHeures    = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, heures_reelles:val} : x));
  const setTacheAvancement= (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, avancement:val} : x));
  const setTachePhotos    = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, photos:val} : x));
  const setTacheChantier  = (idx, chId)   => setTaches(t => t.map((x,i) => {
    if (i !== idx) return x;
    const ch = chantiers.find(c => c.id === chId);
    return {
      ...x,
      chantier_id: chId,
      chantier_nom: ch?.nom || "",
      chantier_couleur: ch?.couleur || "#c8d8f0",
    };
  }));
  const addTacheLibre     = ()            => setTaches(t => [...t, {chantier_id:"",chantier_nom:"",chantier_couleur:"#c8d8f0",planifie:"",statut:null,remarque:"",photos:[],libre:true}]);
  // Suppression d'une tâche libre (ajoutée par l'ouvrier). On ne propose pas
  // la suppression des tâches issues du planning : si elles n'ont pas été faites,
  // l'ouvrier doit explicitement mettre "Non faite" pour qu'on en garde la trace.
  const supprimerTache = (idx) => setTaches(t => t.filter((_, i) => i !== idx));

  const soumettre = async () => {
    const tachesRemplies = taches.filter(t => t.planifie.trim());
    if (tachesRemplies.length === 0) { alert("Aucune tâche à soumettre."); return; }
    // Chantier obligatoire pour les tâches ajoutées manuellement
    const sansChantier = tachesRemplies.filter(t => !t.chantier_id);
    if (sansChantier.length > 0) {
      alert(`🏗 Chantier manquant sur ${sansChantier.length} tâche${sansChantier.length>1?"s":""}\n${sansChantier.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nMerci de sélectionner le chantier concerné pour chaque tâche ajoutée manuellement.`);
      return;
    }
    // Durée obligatoire sauf si tâche non_faite
    const sansDuree = tachesRemplies.filter(t =>
      t.statut !== "non_faite" && (!t.heures_reelles || parseFloat(t.heures_reelles) <= 0)
    );
    if (sansDuree.length > 0) {
      alert(`⏱ Durée manquante sur ${sansDuree.length} tâche${sansDuree.length>1?"s":""}\n${sansDuree.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nCe champ est obligatoire.`);
      return;
    }
    // Statut obligatoire
    const sansStatut = tachesRemplies.filter(t => !t.statut);
    if (sansStatut.length > 0) {
      alert(`📊 Statut manquant sur ${sansStatut.length} tâche${sansStatut.length>1?"s":""}\n${sansStatut.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nMerci d'indiquer si la tâche est faite, en cours ou non faite.`);
      return;
    }
    // Remarque obligatoire si en_cours ou non_faite
    const sansRemarque = tachesRemplies.filter(t =>
      (t.statut === "en_cours" || t.statut === "non_faite") && !t.remarque?.trim()
    );
    if (sansRemarque.length > 0) {
      alert(`💬 Remarque manquante sur ${sansRemarque.length} tâche${sansRemarque.length>1?"s":""}\n${sansRemarque.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nUne explication est obligatoire pour les tâches en cours ou non réalisées.`);
      return;
    }
    // Avancement obligatoire
    const sansAvancement = tachesRemplies.filter(t => t.avancement === undefined || t.avancement === null || t.avancement === "");
    if (sansAvancement.length > 0) {
      alert(`📊 Avancement manquant sur ${sansAvancement.length} tâche${sansAvancement.length>1?"s":""}\n${sansAvancement.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nMerci d'indiquer le pourcentage d'avancement (0% si non réalisé).`);
      return;
    }
    // Heures indirectes : motif + chantier + heures > 0 obligatoires
    const indirectesRemplies = (heuresIndirectes || []).filter(h =>
      (h.motif || "").trim() && (parseFloat(h.heures) || 0) > 0
    );
    const indirectesInvalides = (heuresIndirectes || []).filter(h =>
      ((h.motif || "").trim() || (parseFloat(h.heures) || 0) > 0)
      && (!(h.motif || "").trim() || !((parseFloat(h.heures) || 0) > 0) || !h.chantier_id)
    );
    if (indirectesInvalides.length > 0) {
      alert(`Heures indirectes incomplètes\n\nChaque ligne d'heure indirecte doit avoir un motif, un chantier et un nombre d'heures > 0.`);
      return;
    }
    // Cible exacte : tâches + trajets + heures indirectes = 10h Lun-Mer ou 9h Jeu-Ven
    const totalTachesHSubmit  = tachesRemplies.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
    const totalIndirectesH    = indirectesRemplies.reduce((s, h) => s + (parseFloat(h.heures) || 0), 0);
    const trajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
    const totalSubmit = totalTachesHSubmit + trajetMin / 60 + totalIndirectesH;
    if (Math.abs(totalSubmit - cibleHeures) > 0.01) {
      const ecart = totalSubmit - cibleHeures;
      const fmtH = (n) => n.toFixed(2).replace(/\.?0+$/, "");
      alert(
        `⏱ Total : ${fmtH(totalSubmit)}h / ${cibleHeures}h attendues\n\n` +
        `Le total (tâches + trajets + heures indirectes) doit faire exactement ${cibleHeures}h ce ${todayJour}.\n\n` +
        (ecart < 0
          ? `Il manque ${fmtH(-ecart)}h — ajoute du temps de tâche, de trajet ou indirect.`
          : `Tu dépasses de ${fmtH(ecart)}h — réduis tes heures.`)
      );
      return;
    }

    setSubmitting(true);

    // Regrouper par chantier (tâches + heures indirectes côte à côte sur le même rapport)
    const parChantier = {};
    tachesRemplies.forEach(t => {
      const k = t.chantier_id || "divers";
      if (!parChantier[k]) parChantier[k] = { chantier_id:t.chantier_id, chantier_nom:t.chantier_nom||"Divers", taches:[], heures_indirectes:[] };
      parChantier[k].taches.push({
        planifie:t.planifie,
        tache_id: t.tache_id || null,
        phase_id: t.phase_id || null,
        statut:t.statut||"non_faite",
        remarque:t.remarque,
        heures_reelles:parseFloat(t.heures_reelles)||0,
        avancement:parseInt(t.avancement)||0,
        photos: t.photos || [],
      });
    });
    indirectesRemplies.forEach(h => {
      const k = h.chantier_id || "divers";
      if (!parChantier[k]) {
        const ch = planData?.chantiersData?.find(c => c.id === h.chantier_id);
        parChantier[k] = { chantier_id: h.chantier_id, chantier_nom: ch?.nom || h.chantier_id || "Divers", taches: [], heures_indirectes: [] };
      }
      parChantier[k].heures_indirectes.push({
        motif: (h.motif || "").trim(),
        heures: parseFloat(h.heures) || 0,
      });
    });

    for (const k of Object.keys(parChantier)) {
      const grp = parChantier[k];
      const photosCh = photosChantier[grp.chantier_id] || [];
      const rapportFull = {
        ouvrier: ouvrier.trim(),
        chantier_id: grp.chantier_id,
        chantier_nom: grp.chantier_nom,
        date_rapport: dateKey,
        semaine: weekId,
        taches: grp.taches,
        heures_indirectes: grp.heures_indirectes || [],
        remarque,
        photos_chantier: photosCh,
        trajet_matin_min: parseInt(trajetMatin) || 0,
        trajet_soir_min: parseInt(trajetSoir) || 0,
      };
      // Insert avec retry : si une colonne optionnelle manque, on la drop
      // (pattern déjà utilisé pour photos_chantier — ici on étend à trajet_* et heures_indirectes).
      let payload = { ...rapportFull };
      const optionalCols = ["trajet_matin_min", "trajet_soir_min", "photos_chantier", "heures_indirectes"];
      let { error: insErr } = await supabase.from("rapports").insert(payload);
      while (insErr && insErr.code === "42703") {
        const dropped = optionalCols.find(c => new RegExp(c).test(insErr.message || ""));
        if (!dropped) break; // colonne manquante non gérée
        console.warn(`Colonne ${dropped} manquante dans rapports — fallback sans elle.`);
        delete payload[dropped];
        ({ error: insErr } = await supabase.from("rapports").insert(payload));
      }
      if (insErr) console.error("Insert rapport échec final:", insErr);
      const rapport = rapportFull;
      try { await sendRapportEmail(rapport, grp.chantier_nom); } catch(e) { console.error("Email:",e); }

      // Besoins commande depuis la bibliothèque
      const besoinArticles = Object.values(paniers[grp.chantier_id]||{}).filter(v=>v.qty>0);
      for (const {article, qty} of besoinArticles) {
        await supabase.from("commandes_detail").insert({
          chantier_id: grp.chantier_id,
          article: article.nom,
          materiau_id: article.id,
          fournisseur: article.fournisseur || "",
          quantite: String(qty),
          statut: "besoin_ouvrier",
          notes: `Demande de ${ouvrier.trim()} — ${dateKey}`,
        });
      }
    } // ← fermeture du for

    // CR envoyé → on efface le brouillon (sinon l'ouvrier le retrouverait demain).
    effacerBrouillon();
    setBrouillonRepris(false);
    setLastSaved(null);
    setSubmitting(false);
    setStep("done");
  };

  const progress = taches.filter(t=>t.statut!==null).length;
  const total    = taches.length;

  const S = {
    wrap:  { minHeight:"100vh", background:T.bg, fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif", color:T.text },
    header:{ background:"#16181d", padding:"16px 20px 14px", borderBottom:`2px solid ${T.accent}` },
    card:  { background:T.card, borderRadius:RADIUS.xl, padding:"18px 16px", margin:"12px 16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", border:`1px solid ${T.border}` },
    label: { fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.8, textTransform:"uppercase", color:T.textMuted, marginBottom:8, display:"block" },
    input: { width:"100%", border:`1.5px solid ${T.border}`, borderRadius:RADIUS.lg, padding:"14px 14px", fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box", color:T.text, background:T.surface },
    btn:   (color,bg) => ({ width:"100%", padding:"16px", border:"none", borderRadius:RADIUS.xl, fontSize:FONT.md.size+1, fontWeight:800, cursor:"pointer", fontFamily:"inherit", background:bg, color:color, marginTop:8, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }),
    sectionTitle: (color = T.textMuted) => ({ fontSize:FONT.xs.size, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", color, marginBottom:10, display:"flex", alignItems:"center", gap:6 }),
  };

  // ── STEP: LOGIN ──
  if (step === "login") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:FONT.xs.size,letterSpacing:2.5,textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:4}}>Planning Pro</div>
        <img src={LOGO_RENO_H} alt="Profero Rénovation" style={{height:44,objectFit:"contain",objectPosition:"left",marginBottom:6}}/>
        <div style={{fontSize:FONT.h2.size-2,fontWeight:800,color:"#fff",letterSpacing:-0.3}}>Mon compte rendu</div>
        <div style={{fontSize:FONT.base.size,color:"rgba(255,255,255,0.5)",marginTop:4}}>{dateStr}</div>
      </div>
      <div style={{...S.card, marginTop:32}}>
        <span style={S.label}>C'est qui ?</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
          {ouvriers.map(o => (
            <button key={o} onClick={()=>setOuvrier(o)} style={{
              padding:"10px 18px",borderRadius:RADIUS.lg,fontSize:FONT.md.size,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",border:"2px solid",transition:"all .12s",
              background: ouvrier===o ? T.accent : T.bg,
              borderColor: ouvrier===o ? T.accent : T.border,
              color: T.text,
            }}>{o}</button>
          ))}
        </div>
        <div style={{fontSize:FONT.sm.size+1,color:T.textMuted,marginBottom:8}}>Ou saisis ton prénom :</div>
        <input style={S.input} value={ouvrier} onChange={e=>setOuvrier(e.target.value)}
          placeholder="Ton prénom…" onKeyDown={e=>e.key==="Enter"&&confirmerPrenom()}/>
        <button onClick={confirmerPrenom} disabled={!ouvrier.trim()} style={{
          ...S.btn(T.accentText, T.accent), opacity:ouvrier.trim()?1:0.4, marginTop:16,
          boxShadow:`0 4px 16px ${T.accent}40`,
        }}>
          C'est parti
          <Icon as={ChevronRight} size={18} strokeWidth={2.5}/>
        </button>
      </div>
    </div>
  );

  // ── STEP: DONE ──
  if (step === "done") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:FONT.h2.size-2,fontWeight:800,color:"#fff",letterSpacing:-0.3}}>Mon compte rendu</div>
      </div>
      <div style={{...S.card, textAlign:"center", padding:"40px 24px", marginTop:32}}>
        <div style={{
          width:80,height:80,borderRadius:"50%",margin:"0 auto 16px",
          background:T.successBg, border:`2px solid ${T.successBd}`,
          display:"flex",alignItems:"center",justifyContent:"center",
          color:T.success,
        }}>
          <Icon as={Check} size={42} strokeWidth={2.5}/>
        </div>
        <div style={{fontSize:FONT.h2.size-2,fontWeight:800,color:T.text,marginBottom:8,letterSpacing:-0.3}}>Compte rendu envoyé !</div>
        <div style={{fontSize:FONT.md.size,color:T.textMuted,lineHeight:1.6,marginBottom:28}}>
          Merci {ouvrier}. Ton compte rendu du {dateKey} a bien été enregistré.
        </div>
        <button onClick={()=>{setStep("rapport");setTaches([]);loadTaches(ouvrier);}} style={{...S.btn("#fff", T.text)}}>
          <Icon as={RefreshCw} size={16} strokeWidth={2.2}/>
          Voir mes tâches
        </button>
      </div>
    </div>
  );

  // ── STEP: RAPPORT ──
  const faites   = taches.filter(t=>t.statut==="faite").length;
  const enCours  = taches.filter(t=>t.statut==="en_cours").length;
  const nonFaite = taches.filter(t=>t.statut==="non_faite").length;

  // Total journée = tâches + trajet matin + trajet soir (trajets en minutes).
  // On ne compte que les tâches avec texte renseigné — alignement strict avec
  // la validation de soumettre() (sinon : heures saisies sur une tâche libre
  // sans description gonflent l'affichage mais sont ignorées au submit).
  const totalTachesH = taches
    .filter(t => t.planifie?.trim())
    .reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const totalTrajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
  const totalJourneeH = totalTachesH + totalTrajetMin / 60;
  const matchCible = Math.abs(totalJourneeH - cibleHeures) < 0.01;
  const ecartH = totalJourneeH - cibleHeures; // négatif si manque, positif si dépasse

  // Helper format heures sans drift flottant
  const fmtH = (n) => (+n.toFixed(2)).toString();

  // Regroupement par chantier — quand l'ouvrier a 2+ chantiers dans la journée,
  // on rend une section par chantier (tâches + photos + besoins regroupés)
  // au lieu d'éclater photos/besoins en bas du formulaire. Si 1 seul chantier,
  // pas d'en-tête de section (visuel inchangé). Tâches libres sans chantier
  // sélectionné → groupe "Autres tâches" en bas. L'ordre des groupes suit
  // l'ordre d'apparition des tâches dans `taches`.
  const chantierGroups = (() => {
    const map = new Map();
    taches.forEach((t, idx) => {
      const key = t.chantier_id || "_libres";
      if (!map.has(key)) {
        map.set(key, {
          key,
          cId: t.chantier_id || null,
          chantier_nom: t.chantier_id ? (t.chantier_nom || "Chantier") : "Autres tâches",
          chantier_couleur: t.chantier_couleur || T.info,
          isLibres: !t.chantier_id,
          items: [],
        });
      }
      map.get(key).items.push({ t, idx });
    });
    return [...map.values()];
  })();
  const hasMultipleGroups = chantierGroups.length > 1;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <img src={LOGO_RENO_V} alt="Profero" style={{height:40,objectFit:"contain",objectPosition:"left",marginBottom:4}}/>
            <div style={{fontSize:FONT.sm.size+1,color:T.accent,fontWeight:700,marginBottom:1}}>Bonjour {ouvrier}</div>
            <div style={{fontSize:FONT.lg.size+1,fontWeight:800,color:"#fff",letterSpacing:-0.2}}>{dateStr}</div>
          </div>
          <button onClick={()=>setStep("login")} style={{
            display:"inline-flex",alignItems:"center",gap:5,
            background:`${T.accent}1A`,border:`1px solid ${T.accent}4D`,
            borderRadius:RADIUS.md,padding:"6px 12px",color:T.accent,
            fontSize:FONT.sm.size+1,cursor:"pointer",fontFamily:"inherit",fontWeight:600,
          }}>
            <Icon as={LogOut} size={12}/>
            Changer
          </button>
        </div>
        {total>0 && (
          <div style={{marginTop:12}}>
            <div style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap"}}>
              {faites>0 && (
                <span style={{display:"inline-flex",alignItems:"center",gap:4,
                  background:"rgba(80,200,120,0.20)",color:"#7ee8a2",
                  borderRadius:RADIUS.md,padding:"3px 9px",fontSize:FONT.sm.size+1,fontWeight:700}}>
                  <Icon as={Check} size={12} strokeWidth={2.5}/> {faites} faite{faites>1?"s":""}
                </span>
              )}
              {enCours>0 && (
                <span style={{display:"inline-flex",alignItems:"center",gap:4,
                  background:"rgba(245,166,35,0.20)",color:"#f5a623",
                  borderRadius:RADIUS.md,padding:"3px 9px",fontSize:FONT.sm.size+1,fontWeight:700}}>
                  <Icon as={RotateCw} size={12} strokeWidth={2.5}/> {enCours}
                </span>
              )}
              {nonFaite>0 && (
                <span style={{display:"inline-flex",alignItems:"center",gap:4,
                  background:"rgba(224,92,92,0.20)",color:"#ff8888",
                  borderRadius:RADIUS.md,padding:"3px 9px",fontSize:FONT.sm.size+1,fontWeight:700}}>
                  <Icon as={X} size={12} strokeWidth={2.5}/> {nonFaite}
                </span>
              )}
            </div>
            <div style={{background:"rgba(255,255,255,0.1)",borderRadius:4,height:4}}>
              <div style={{background:T.success,height:4,borderRadius:4,width:`${(progress/total)*100}%`,transition:"width .3s"}}/>
            </div>
          </div>
        )}
      </div>

      {/* ── Bandeau brouillon repris ── */}
      {brouillonRepris && (
        <div style={{
          ...S.card,
          background:T.infoBg,
          borderLeft:`4px solid ${T.info}`,
          padding:"12px 16px",
        }}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:8,flex:"1 1 200px"}}>
              <Icon as={Sparkles} size={16} color={T.info} strokeWidth={2.2} style={{flexShrink:0,marginTop:2}}/>
              <div>
                <div style={{fontSize:FONT.base.size,fontWeight:700,color:T.text,marginBottom:2}}>Brouillon repris</div>
                <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.4}}>
                  On a récupéré ce que tu avais commencé à saisir aujourd'hui. Continue là où tu en étais.
                </div>
              </div>
            </div>
            <button onClick={repartirDeZero} style={{
              padding:"8px 12px",borderRadius:RADIUS.md,border:`1.5px solid ${T.info}`,
              background:"transparent",color:T.info,fontSize:FONT.sm.size,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",
              display:"inline-flex",alignItems:"center",gap:5,whiteSpace:"nowrap",
            }}>
              <Icon as={RotateCw} size={11} strokeWidth={2.5}/>
              Repartir de zéro
            </button>
          </div>
        </div>
      )}

      {/* ── Bandeau règles à respecter ── */}
      <div style={{
        ...S.card,
        background:"#fff8e1",
        borderLeft:`4px solid ${T.accent}`,
        padding:"14px 16px",
      }}>
        <div style={{...S.sectionTitle("#b88800")}}>
          <Icon as={ClipboardList} size={13} strokeWidth={2.2}/>
          Avant de valider ton compte rendu
        </div>
        <ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:10}}>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:FONT.base.size,color:T.text,lineHeight:1.45}}>
            <Icon as={Clock} size={16} color="#b88800" strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>
            <span>
              Le total de tes heures (tâches + trajets) doit faire <strong style={{color:"#b88800"}}>{cibleHeures}h</strong>
              {" "}({todayJour === "Jeudi" || todayJour === "Vendredi" ? "le jeudi et le vendredi" : "du lundi au mercredi"}).
            </span>
          </li>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:FONT.base.size,color:T.text,lineHeight:1.45}}>
            <Icon as={MessageSquare} size={16} color="#b88800" strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>
            <span>
              Si une tâche n'a pas été réalisée ou est en cours, <strong>explique pourquoi</strong> dans la remarque.
            </span>
          </li>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:FONT.base.size,color:T.text,lineHeight:1.45}}>
            <Icon as={Camera} size={16} color="#b88800" strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>
            <span>
              Merci de prendre <strong>au moins une photo par tâche</strong> pour qu'on puisse suivre l'avancement.
            </span>
          </li>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:FONT.base.size,color:T.text,lineHeight:1.45}}>
            <Icon as={ListPlus} size={16} color="#b88800" strokeWidth={2} style={{flexShrink:0,marginTop:1}}/>
            <span>
              Si tu as fait une tâche qui <strong>n'apparaît pas dans la liste</strong>, ajoute-la avec le bouton « Ajouter une tâche » en bas.
            </span>
          </li>
        </ul>
      </div>

      {/* ── Compteur total journée ── */}
      {(() => {
        const col = matchCible ? T.success : Math.abs(ecartH) > 1 ? T.danger : T.warning;
        const bg  = matchCible ? T.successBg : Math.abs(ecartH) > 1 ? T.dangerBg : T.warningBg;
        const bdr = matchCible ? T.successBd : Math.abs(ecartH) > 1 ? T.dangerBd : T.warningBd;
        const pct = Math.min(100, (totalJourneeH / cibleHeures) * 100);
        return (
          <div style={{
            ...S.card,
            // Sticky → besoin d'un fond opaque, sinon la teinte sémantique à 12%
            // laisse passer le contenu en dessous quand on scrolle. On superpose
            // donc la teinte sur du blanc + on renforce le shadow pour détacher.
            background:`linear-gradient(${bg}, ${bg}), ${T.surface}`,
            border:`1.5px solid ${bdr}`, padding:"14px 16px",
            position:"sticky", top:8, zIndex:10,
            boxShadow:"0 4px 16px rgba(0,0,0,0.10)",
          }}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:8}}>
              <div style={{...S.sectionTitle(col), marginBottom:0}}>
                <Icon as={Clock} size={13} strokeWidth={2.2}/>
                Total de ma journée
              </div>
              <div style={{fontSize:FONT.h2.size,fontWeight:800,color:col,letterSpacing:-0.5,lineHeight:1}}>
                {fmtH(totalJourneeH)}h
                <span style={{fontSize:FONT.base.size,color:T.textMuted,fontWeight:600,marginLeft:4}}>/ {cibleHeures}h</span>
              </div>
            </div>
            <div style={{height:6,background:"rgba(0,0,0,0.06)",borderRadius:RADIUS.sm,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:col,borderRadius:RADIUS.sm,transition:"width .3s"}}/>
            </div>
            <div style={{fontSize:FONT.sm.size+1,color:col,marginTop:6,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
              {matchCible
                ? <><Icon as={Check} size={13} strokeWidth={2.5}/> Tu peux soumettre ton compte rendu</>
                : ecartH < 0
                  ? `Il manque ${fmtH(-ecartH)}h pour atteindre la cible`
                  : `Tu dépasses de ${fmtH(ecartH)}h — réduis tes heures de tâches ou de trajet`}
            </div>
            <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:4}}>
              {fmtH(totalTachesH)}h de tâches
              {totalTrajetMin > 0 && ` + ${totalTrajetMin} min de trajet (${fmtH(totalTrajetMin/60)}h)`}
            </div>
            {lastSaved && (
              <div style={{
                fontSize:FONT.xs.size,color:T.textMuted,marginTop:6,
                display:"flex",alignItems:"center",gap:4,fontStyle:"italic",
              }}>
                <Icon as={Check} size={10} color={T.success} strokeWidth={2.5}/>
                Sauvegardé à {lastSaved.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"})} — tu peux fermer la page sans perdre tes saisies
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Heures indirectes (P7) ── */}
      {(() => {
        // Liste des chantiers proposés pour le rattachement : prioritairement ceux
        // déjà présents dans les tâches du jour (sans doublons), sinon tous les
        // chantiers actifs.
        const chantiersDuJour = Array.from(new Set(taches.map(t => t.chantier_id).filter(Boolean)));
        const tousChantiers = (planData?.chantiersData || []).filter(c => !c.archive);
        const chantiersProposes = chantiersDuJour.length > 0
          ? tousChantiers.filter(c => chantiersDuJour.includes(c.id))
          : tousChantiers;
        const presets = ["Intempéries", "Nettoyage", "SAV", "Trajet supp.", "Préparation chantier"];
        const addIndirect = () => setHeuresIndirectes(prev => [...prev, { motif: "", chantier_id: chantiersProposes[0]?.id || "", heures: "" }]);
        const removeIndirect = (i) => setHeuresIndirectes(prev => prev.filter((_, idx) => idx !== i));
        const updateIndirect = (i, patch) => setHeuresIndirectes(prev => prev.map((x, idx) => idx === i ? { ...x, ...patch } : x));
        return (
          <div style={{...S.card, borderLeft:`4px solid #b27416`, padding:"14px 16px"}}>
            <div style={{...S.sectionTitle("#b27416")}}>
              <Icon as={AlertTriangle} size={13} strokeWidth={2.2}/>
              Heures indirectes (intempéries, SAV, nettoyage…)
            </div>
            {heuresIndirectes.length === 0 ? (
              <div style={{fontSize:FONT.xs.size+1, color:T.textMuted, marginBottom:8, lineHeight:1.4}}>
                Optionnel. Pour les heures qui ne tombent sur aucune tâche vendue.
              </div>
            ) : (
              <div style={{display:"flex", flexDirection:"column", gap:8, marginBottom:8}}>
                {heuresIndirectes.map((h, i) => (
                  <div key={i} style={{
                    background: T.surface, border:`1px solid ${T.border}`,
                    borderRadius: RADIUS.md, padding:"10px 12px",
                    display:"flex", flexDirection:"column", gap:8,
                  }}>
                    <div style={{display:"flex", flexWrap:"wrap", gap:4}}>
                      {presets.map(p => (
                        <button key={p} onClick={() => updateIndirect(i, { motif: p })} style={{
                          padding:"4px 8px", borderRadius:RADIUS.md, cursor:"pointer",
                          fontFamily:"inherit", fontSize:FONT.xs.size+1, fontWeight:600,
                          border: "1.5px solid",
                          borderColor: h.motif === p ? "#b27416" : T.border,
                          background: h.motif === p ? "rgba(178,116,22,0.10)" : T.bg,
                          color: h.motif === p ? "#b27416" : T.textMuted,
                        }}>{p}</button>
                      ))}
                    </div>
                    <input
                      type="text" placeholder="Motif (ou choisis ci-dessus)"
                      value={h.motif}
                      onChange={e => updateIndirect(i, { motif: e.target.value })}
                      style={{
                        width:"100%", padding:"8px 10px", borderRadius:RADIUS.md,
                        border:`1.5px solid ${T.border}`, background:T.bg, color:T.text,
                        fontSize:FONT.base.size, fontFamily:"inherit", outline:"none",
                      }}
                    />
                    <div style={{display:"grid", gridTemplateColumns:"1fr 90px 28px", gap:6, alignItems:"center"}}>
                      <select
                        value={h.chantier_id || ""}
                        onChange={e => updateIndirect(i, { chantier_id: e.target.value })}
                        style={{
                          padding:"8px 10px", borderRadius:RADIUS.md,
                          border:`1.5px solid ${T.border}`, background:T.bg, color:T.text,
                          fontSize:FONT.base.size, fontFamily:"inherit", outline:"none",
                        }}
                      >
                        <option value="">— Choisir chantier —</option>
                        {chantiersProposes.map(c => (
                          <option key={c.id} value={c.id}>{c.nom || c.id}</option>
                        ))}
                      </select>
                      <div style={{display:"flex", alignItems:"center", gap:4}}>
                        <input
                          type="number" min="0" max="12" step="0.25"
                          value={h.heures}
                          onChange={e => updateIndirect(i, { heures: e.target.value })}
                          placeholder="h"
                          style={{
                            width:60, padding:"8px 6px", borderRadius:RADIUS.md,
                            border:`1.5px solid ${T.border}`, background:T.bg, color:T.text,
                            fontSize:16, fontWeight:700, fontFamily:"inherit", outline:"none",
                            textAlign:"center",
                          }}
                        />
                        <span style={{fontSize:FONT.xs.size+1, color:T.textMuted, fontWeight:600}}>h</span>
                      </div>
                      <button onClick={() => removeIndirect(i)} style={{
                        background:"transparent", border:"none", cursor:"pointer",
                        color:T.danger, padding:4, display:"flex", alignItems:"center", justifyContent:"center",
                      }}>
                        <Icon as={X} size={14} strokeWidth={2.5}/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={addIndirect} style={{
              ...S.btn("#fff", T.text),
              fontSize: FONT.sm.size,
              padding: "8px 12px",
            }}>
              <Icon as={Plus} size={14} strokeWidth={2.2}/>
              Ajouter une heure indirecte
            </button>
          </div>
        );
      })()}

      {/* ── Mon temps de trajet ── */}
      <div style={{...S.card, borderLeft:`4px solid ${T.info}`, padding:"14px 16px"}}>
        <div style={{...S.sectionTitle(T.info)}}>
          <Icon as={Car} size={13} strokeWidth={2.2}/>
          Mon temps de trajet
        </div>
        {[
          { label:"Trajet matin (aller)", value:trajetMatin, setter:setTrajetMatin },
          { label:"Trajet soir (retour)", value:trajetSoir,  setter:setTrajetSoir  },
        ].map(({label, value, setter}, i) => (
          <div key={i} style={{marginBottom: i===0 ? 10 : 0}}>
            <div style={{fontSize:FONT.xs.size,fontWeight:700,color:T.text,marginBottom:6,letterSpacing:0.3}}>{label}</div>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
              {[15, 30, 45, 60].map(m => (
                <button key={m} onClick={()=>setter(String(m))} style={{
                  padding:"7px 10px",borderRadius:RADIUS.md,border:"1.5px solid",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,transition:"all .1s",
                  borderColor: parseInt(value)===m ? T.info : T.border,
                  background:  parseInt(value)===m ? `${T.info}15` : T.surface,
                  color:       parseInt(value)===m ? T.info : T.textMuted,
                }}>{m} min</button>
              ))}
              <input type="number" min="0" max="600" step="5"
                value={value}
                onChange={e=>setter(e.target.value)}
                placeholder="Autre"
                style={{width:64,padding:"7px 6px",border:`1.5px solid ${T.border}`,
                  borderRadius:RADIUS.md,fontSize:16,fontWeight:700,fontFamily:"inherit",
                  outline:"none",textAlign:"center",color:T.text,background:T.surface}}
              />
              <span style={{fontSize:FONT.xs.size+1,color:T.textMuted,fontWeight:600}}>min</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tâches */}
      {taches.length===0 && (
        <div style={{...S.card, textAlign:"center", padding:"32px 24px"}}>
          <div style={{
            width:64,height:64,borderRadius:"50%",margin:"0 auto 12px",
            background:T.bg, border:`1px solid ${T.border}`,
            display:"flex",alignItems:"center",justifyContent:"center",color:T.textMuted,
          }}>
            <Icon as={todayJour ? ClipboardList : Coffee} size={32} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.md.size+1,fontWeight:700,color:T.text,marginBottom:6}}>Aucune tâche planifiée</div>
          <div style={{fontSize:FONT.base.size,color:T.textMuted,marginBottom:16,lineHeight:1.5}}>
            {todayJour ? `Rien n'est planifié pour toi ce ${todayJour}.` : "Bon week-end !"}
          </div>
          <button onClick={addTacheLibre} style={S.btn("#fff", T.text)}>
            <Icon as={Plus} size={16} strokeWidth={2.2}/>
            Ajouter une tâche manuellement
          </button>
        </div>
      )}

      {chantierGroups.map(group => (
        <React.Fragment key={group.key}>
          {(hasMultipleGroups || group.isLibres) && (
            <div style={{
              margin:"16px 16px 0",
              padding:"12px 14px",
              background: group.isLibres ? T.bg : `${group.chantier_couleur}1F`,
              borderRadius: RADIUS.lg,
              borderLeft: `4px solid ${group.isLibres ? T.borderHover : group.chantier_couleur}`,
              display:"flex", alignItems:"center", gap:10,
            }}>
              {!group.isLibres && (
                <span style={{
                  width:14, height:14, borderRadius:"50%",
                  background: group.chantier_couleur,
                  boxShadow: `0 0 0 3px ${group.chantier_couleur}33`,
                  flexShrink: 0,
                }}/>
              )}
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:T.textMuted}}>
                  {group.isLibres ? "Tâches ajoutées" : "Chantier"}
                </div>
                <div style={{fontSize:FONT.md.size+1,fontWeight:800,color:T.text,letterSpacing:-0.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {group.chantier_nom}
                </div>
              </div>
            </div>
          )}

      {group.items.map(({ t, idx }) => {
        const dureeOk    = t.statut==="non_faite" || (t.heures_reelles && parseFloat(t.heures_reelles)>0);
        const avRenseigne = !(t.avancement===""||t.avancement===undefined||t.avancement===null);
        const av100 = parseInt(t.avancement)===100;
        const expliRequise = t.statut==="en_cours"||t.statut==="non_faite";
        const explOk = !!t.remarque?.trim();
        return (
        <div key={idx} style={{...S.card, borderLeft:`4px solid ${t.chantier_couleur||T.info}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {t.chantier_nom && (
              <div style={{display:"inline-block",background:t.chantier_couleur+"33",color:T.text,
                borderRadius:RADIUS.sm,padding:"2px 8px",fontSize:FONT.xs.size,fontWeight:700,textTransform:"uppercase",
                letterSpacing:1}}>{t.chantier_nom}</div>
            )}
            {t.pourTout && (
              <span style={{display:"inline-flex",alignItems:"center",gap:4,
                background:T.infoBg,color:T.info,
                borderRadius:RADIUS.sm,padding:"2px 8px",fontSize:FONT.xs.size,fontWeight:700}}>
                <Icon as={Users} size={11} strokeWidth={2.2}/> Pour tous
              </span>
            )}
            {t.duree && (
              <span style={{display:"inline-flex",alignItems:"center",gap:4,
                background:T.warningBg,color:"#c07800",
                borderRadius:RADIUS.sm,padding:"2px 8px",fontSize:FONT.xs.size,fontWeight:700}}>
                <Icon as={Hourglass} size={11} strokeWidth={2.2}/> {t.duree}h estimée{t.duree>1?"s":""}
              </span>
            )}
            {t.libre && (
              <button onClick={()=>supprimerTache(idx)} style={{
                marginLeft:"auto",
                display:"inline-flex",alignItems:"center",gap:4,
                background:T.dangerBg,border:`1px solid ${T.dangerBd}`,
                borderRadius:RADIUS.sm,padding:"4px 9px",
                color:T.danger,fontSize:FONT.xs.size,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit",
              }}>
                <Icon as={Trash2} size={11} strokeWidth={2.2}/>
                Supprimer
              </button>
            )}
          </div>
          {t.libre && (
            <div style={{
              marginBottom:10,padding:"10px 12px",
              background: t.chantier_id ? `${t.chantier_couleur}14` : T.dangerBg,
              border:`1.5px solid ${t.chantier_id ? `${t.chantier_couleur}55` : T.dangerBd}`,
              borderRadius:RADIUS.lg,
            }}>
              <div style={{...S.sectionTitle(t.chantier_id ? T.text : T.danger), marginBottom:8, fontSize:FONT.xs.size}}>
                <Icon as={ClipboardList} size={12} strokeWidth={2.2}/>
                Chantier concerné
                {!t.chantier_id && (
                  <span style={{fontSize:9,background:T.danger,color:"#fff",borderRadius:RADIUS.sm,padding:"1px 5px",fontWeight:800,letterSpacing:0}}>OBLIGATOIRE</span>
                )}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {chantiers.map(c => {
                  const sel = t.chantier_id === c.id;
                  return (
                    <button key={c.id} onClick={()=>setTacheChantier(idx, c.id)} style={{
                      padding:"7px 12px",borderRadius:RADIUS.md,border:"1.5px solid",cursor:"pointer",
                      fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,transition:"all .1s",
                      borderColor: sel ? c.couleur : T.border,
                      background:  sel ? `${c.couleur}33` : T.surface,
                      color:       T.text,
                      display:"inline-flex",alignItems:"center",gap:5,
                    }}>
                      <span style={{width:10,height:10,borderRadius:"50%",background:c.couleur,
                        border:`1.5px solid ${sel ? c.couleur : T.border}`}}/>
                      {c.nom}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {t.libre ? (
            <textarea value={t.planifie} onChange={e=>setTachePlanifie(idx,e.target.value)}
              placeholder="Décris la tâche…"
              style={{...S.input,resize:"none",minHeight:60,marginBottom:10,fontSize:16}}/>
          ) : (
            <div style={{fontSize:FONT.md.size+1,fontWeight:600,color:T.text,marginBottom:12,lineHeight:1.4}}>{t.planifie}</div>
          )}

          {/* Boutons statut */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {[
              ["faite",     Check,   "Faite",     T.success, T.successBg, T.successBd],
              ["en_cours",  RotateCw,"En cours",  T.warning, T.warningBg, T.warningBd],
              ["non_faite", X,       "Non faite", T.danger,  T.dangerBg,  T.dangerBd ],
            ].map(([val,IconComp,lb,col,bg,bdr])=>{
              const active = t.statut===val;
              return (
                <button key={val} onClick={()=>setStatut(idx,val)} style={{
                  padding:"10px 4px",borderRadius:RADIUS.lg,border:"2px solid",cursor:"pointer",
                  fontFamily:"inherit",fontSize:FONT.sm.size+1,fontWeight:700,transition:"all .12s",
                  borderColor: active ? bdr : T.border,
                  background:  active ? bg  : T.surface,
                  color:       active ? col : T.textMuted,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                }}>
                  <Icon as={IconComp} size={20} strokeWidth={2.2}/>
                  <span style={{fontSize:FONT.xs.size}}>{lb}</span>
                </button>
              );
            })}
          </div>

          {/* Durée + Avancement — masqués pour non_faite (heures auto à 0, av auto à 0) */}
          {t.statut !== "non_faite" && (
          <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>

            {/* Durée — OBLIGATOIRE */}
            <div style={{
              flex:"1 1 200px",
              background: dureeOk ? T.successBg : T.dangerBg,
              border:    `1.5px solid ${dureeOk ? T.successBd : T.dangerBd}`,
              borderRadius:RADIUS.lg, padding:"11px 12px",
            }}>
              <div style={{...S.sectionTitle(dureeOk ? T.success : T.danger), marginBottom:8, fontSize:FONT.xs.size}}>
                <Icon as={Clock} size={12} strokeWidth={2.2}/>
                Durée réelle
                <span style={{fontSize:9,background:T.danger,color:"#fff",borderRadius:RADIUS.sm,padding:"1px 5px",fontWeight:800,letterSpacing:0}}>OBLIGATOIRE</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                {[0.5,1,1.5,2,3,4].map(h=>{
                  const sel = parseFloat(t.heures_reelles)===h;
                  return (
                    <button key={h} onClick={()=>setTacheHeures(idx,String(h))} style={{
                      padding:"7px 8px",borderRadius:RADIUS.md,border:"1.5px solid",cursor:"pointer",
                      fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,transition:"all .1s",
                      borderColor: sel ? T.successBd : T.border,
                      background:  sel ? T.successBg : T.surface,
                      color:       sel ? T.success : T.textMuted,
                    }}>{h}h</button>
                  );
                })}
                <input type="number" min="0.5" max="24" step="0.5"
                  value={t.heures_reelles||""}
                  onChange={e=>setTacheHeures(idx,e.target.value)}
                  placeholder="Autre"
                  style={{width:58,padding:"7px 6px",border:`1.5px solid ${T.border}`,
                    borderRadius:RADIUS.md,fontSize:16,fontWeight:700,fontFamily:"inherit",
                    outline:"none",textAlign:"center",color:T.text,background:T.surface}}
                />
              </div>
            </div>

            {/* Avancement % — affiché uniquement pour "en cours".
                Pour faite → 100% auto, pour non_faite → 0% auto (cf. setStatut). */}
            {t.statut === "en_cours" && (
            <div style={{
              flex:"1 1 200px",
              background: !avRenseigne ? T.dangerBg : av100 ? T.successBg : "rgba(139,92,246,0.06)",
              border:    `1.5px solid ${!avRenseigne ? T.dangerBd : av100 ? T.successBd : "rgba(139,92,246,0.30)"}`,
              borderRadius:RADIUS.lg, padding:"11px 12px",
            }}>
              <div style={{...S.sectionTitle(!avRenseigne ? T.danger : av100 ? T.success : "#8b5cf6"), marginBottom:8, fontSize:FONT.xs.size}}>
                <Icon as={BarChart3} size={12} strokeWidth={2.2}/>
                Avancement
                {!avRenseigne && (
                  <span style={{fontSize:9,background:T.danger,color:"#fff",borderRadius:RADIUS.sm,padding:"1px 5px",fontWeight:800,letterSpacing:0}}>OBLIGATOIRE</span>
                )}
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                {[0,25,50,75,100].map(p=>{
                  const sel = parseInt(t.avancement)===p;
                  const colSel = p===100 ? T.success : "#8b5cf6";
                  const bgSel  = p===100 ? T.successBg : "rgba(139,92,246,0.15)";
                  const bdrSel = p===100 ? T.successBd : "rgba(139,92,246,0.35)";
                  return (
                    <button key={p} onClick={()=>setTacheAvancement(idx,String(p))} style={{
                      padding:"6px 8px",borderRadius:RADIUS.md,border:"1.5px solid",cursor:"pointer",
                      fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,transition:"all .1s",
                      borderColor: sel ? bdrSel : T.border,
                      background:  sel ? bgSel  : T.surface,
                      color:       sel ? colSel : T.textMuted,
                      display:"inline-flex",alignItems:"center",gap:3,
                    }}>
                      {p===100 && <Icon as={Check} size={11} strokeWidth={2.5}/>}
                      {p}%
                    </button>
                  );
                })}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input type="range" min="0" max="100" step="5"
                  value={t.avancement||0}
                  onChange={e=>setTacheAvancement(idx,e.target.value)}
                  style={{flex:1,accentColor:av100 ? T.success : "#8b5cf6"}}
                />
                <span style={{fontSize:FONT.md.size,fontWeight:800,color:av100 ? T.success : "#8b5cf6",minWidth:36,textAlign:"right"}}>
                  {t.avancement||0}%
                </span>
              </div>
              <div style={{height:4,background:T.border,borderRadius:RADIUS.sm,marginTop:6,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:RADIUS.sm,transition:"width .3s",
                  background: av100 ? T.success : "#8b5cf6",
                  width:`${t.avancement||0}%`}}/>
              </div>
            </div>
            )}
          </div>
          )}

          {/* Remarque tâche */}
          <div>
            {expliRequise && (
              <div style={{...S.sectionTitle(explOk ? T.success : T.danger), marginBottom:6, fontSize:FONT.xs.size}}>
                <Icon as={MessageSquare} size={12} strokeWidth={2.2}/>
                Explication
                {!explOk && <span style={{fontSize:9,background:T.danger,color:"#fff",borderRadius:RADIUS.sm,padding:"1px 5px",fontWeight:800,letterSpacing:0}}>OBLIGATOIRE</span>}
              </div>
            )}
            <textarea value={t.remarque} onChange={e=>setTacheRemarque(idx,e.target.value)}
              placeholder={t.statut==="en_cours"?"Qu'est-ce qui bloque ? Estimation de fin…":t.statut==="non_faite"?"Pourquoi non réalisé ?":"Remarque, précision… (optionnel)"}
              style={{...S.input,resize:"none",minHeight:52,fontSize:16,color:T.textSub,
                border: expliRequise && !explOk ? `1.5px solid ${T.dangerBd}` : `1.5px solid ${T.border}`}}/>
          </div>

          {/* Photos de la tâche */}
          <div style={{marginTop:12,paddingTop:12,borderTop:`1px dashed ${T.border}`}}>
            <PhotosPicker
              photos={t.photos || []}
              onChange={(arr)=>setTachePhotos(idx, arr)}
              pathPrefix={`rapports/${ouvrier}/${dateKey}/tache-${idx}`}
              color={t.chantier_couleur || T.info}
              label="Photos de la tâche"
            />
          </div>
        </div>
        );
      })}

      {/* Photos + besoins du chantier — affichés dans la section du chantier
          (pas pour le groupe "Autres tâches" qui n'a pas encore de chantier). */}
      {group.cId && (
        <>
          <div style={{...S.card, border:`1.5px solid ${group.chantier_couleur}55`, background:`${group.chantier_couleur}0A`}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              <span style={{...S.sectionTitle(T.text), marginBottom:0}}>
                <Icon as={Camera} size={13} strokeWidth={2.2}/>
                Photos du chantier
              </span>
            </div>
            <PhotosPicker
              photos={photosChantier[group.cId] || []}
              onChange={(arr)=>setPhotosChantier(p=>({...p,[group.cId]:arr}))}
              pathPrefix={`rapports/${ouvrier}/${dateKey}/chantier-${group.cId}`}
              color={group.chantier_couleur}
              label="Vue globale, avancement…"
            />
            <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:8,fontStyle:"italic"}}>
              Visibles dans la fiche chantier et dans le bilan d'équipe.
            </div>
          </div>

          {(() => {
            const nbArticles = Object.values(paniers[group.cId]||{}).filter(v=>v.qty>0).length;
            const VIOLET = "#9040c0";
            return (
              <div style={{...S.card, border:"1.5px solid rgba(176,96,255,0.3)", background:"rgba(176,96,255,0.04)"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
                  <span style={{...S.sectionTitle(VIOLET), marginBottom:0}}>
                    <Icon as={ShoppingCart} size={13} strokeWidth={2.2}/>
                    Besoins commande
                  </span>
                  {nbArticles > 0 && (
                    <span style={{background:"rgba(176,96,255,0.2)",color:VIOLET,borderRadius:RADIUS.pill,
                      padding:"2px 10px",fontSize:FONT.sm.size,fontWeight:700}}>
                      {nbArticles} article{nbArticles>1?"s":""}
                    </span>
                  )}
                </div>

                {nbArticles > 0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                    {Object.values(paniers[group.cId]||{}).filter(v=>v.qty>0).map(({article,qty})=>(
                      <div key={article.id} style={{background:"rgba(176,96,255,0.12)",borderRadius:RADIUS.lg,
                        padding:"4px 10px",fontSize:FONT.sm.size,fontWeight:700,color:"#6020a0"}}>
                        {qty}× {article.nom}
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={()=>setBesoinDrawer(group.cId)} style={{
                  width:"100%",padding:"12px",border:"1.5px dashed rgba(176,96,255,0.4)",
                  borderRadius:RADIUS.xl,fontSize:FONT.base.size,fontWeight:700,cursor:"pointer",
                  fontFamily:"inherit",background:"transparent",color:VIOLET,
                  display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                }}>
                  <Icon as={nbArticles > 0 ? Pencil : ShoppingCart} size={14} strokeWidth={2.2}/>
                  {nbArticles > 0 ? "Modifier ma sélection" : "Choisir dans la bibliothèque"}
                </button>

                <div style={{fontSize:FONT.xs.size+1,color:VIOLET,marginTop:6,display:"flex",alignItems:"center",gap:5}}>
                  <Icon as={Zap} size={11} strokeWidth={2.2}/>
                  Sera transmis automatiquement dans l'onglet Commandes
                </div>
              </div>
            );
          })()}
        </>
      )}
        </React.Fragment>
      ))}

      {/* Ajouter tâche libre — bouton global en bas de tous les groupes */}
      <div style={{padding:"0 16px 8px"}}>
        <button onClick={addTacheLibre} style={{
          width:"100%",padding:"12px",border:`1.5px dashed ${T.borderHover}`,borderRadius:RADIUS.xl,
          fontSize:FONT.base.size,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
          background:"transparent",color:T.textMuted,marginBottom:4,
          display:"flex",alignItems:"center",justifyContent:"center",gap:6,
        }}>
          <Icon as={Plus} size={14} strokeWidth={2.2}/>
          Ajouter une tâche
        </button>
      </div>

      {/* Drawer bibliothèque */}
      {besoinDrawer && (() => {
        const ct = taches.find(t=>t.chantier_id===besoinDrawer);
        return (
          <BesoinCommandeDrawer
            chantierNom={ct?.chantier_nom}
            chantierCouleur={ct?.chantier_couleur}
            panier={paniers[besoinDrawer]||{}}
            onPanierChange={updater => setPaniers(prev => ({
              ...prev,
              [besoinDrawer]: typeof updater==="function" ? updater(prev[besoinDrawer]||{}) : updater,
            }))}
            onClose={()=>setBesoinDrawer(null)}
          />
        );
      })()}

      {/* Remarque générale */}
      <div style={{...S.card}}>
        <span style={{...S.sectionTitle()}}>
          <Icon as={MessageSquare} size={13} strokeWidth={2.2}/>
          Remarque générale de la journée
        </span>
        <textarea value={remarque} onChange={e=>setRemarque(e.target.value)}
          placeholder="Informations utiles…"
          style={{...S.input,resize:"none",minHeight:80,fontSize:16}}/>
      </div>

      {/* Bouton soumettre */}
      <div style={{padding:"8px 16px 32px"}}>
        <button onClick={soumettre} disabled={submitting} style={{
          width:"100%",padding:"18px",border:"none",borderRadius:RADIUS.xl+2,fontSize:FONT.lg.size,
          fontWeight:800,cursor:submitting?"not-allowed":"pointer",fontFamily:"inherit",letterSpacing:.4,
          background: submitting ? T.borderHover : T.accent, color: T.accentText,
          boxShadow:`0 4px 20px ${T.accent}4D`,
          display:"flex",alignItems:"center",justifyContent:"center",gap:8,
          opacity: submitting ? 0.7 : 1,
        }}>
          <Icon as={submitting ? RotateCw : Check} size={18} strokeWidth={2.5}
            style={submitting ? {animation:"spin 1s linear infinite"} : {}}/>
          {submitting ? "Envoi en cours…" : "Valider mon compte rendu"}
        </button>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default PageRapportMobile;
