import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, LOGO_RENO_H } from "./constants";
import { Icon } from "./ui";
import {
  FileText, Plus, Trash2, Search, Calendar, MapPin, User, Users, Sparkles,
  ClipboardCheck, AlertTriangle, Wrench, Camera, MessageSquare, Menu,
  Check, X, Building2, ChevronRight, Download, Send, Clock as ClockIcon,
  TrendingUp, Info, Lightbulb,
} from "lucide-react";

const TYPES_VISITE = ["Visite de chantier","Réunion de suivi","Réception travaux","Constat contradictoire","Autre"];
const STATUTS_OBS  = ["ok","info","warn","urgent"];
const STATUT_LABEL = { ok:"Conforme", info:"Info", warn:"Attention", urgent:"Urgent" };
const STATUT_COLOR = { ok:"#22c55e", info:"#5b9cf6", warn:"#f5a623", urgent:"#e15a5a" };

// ─── STATUTS DE COMPTE RENDU (flux opérationnel) ─────────────────────────────
const STATUTS_CR = [
  { id: "brouillon", label: "Brouillon", color: "#94a3b8" },
  { id: "valide",    label: "Validé",    color: "#5b9cf6" },
  { id: "envoye",    label: "Envoyé",    color: "#22c55e" },
  { id: "archive",   label: "Archivé",   color: "#a78bfa" },
];
const statutMeta = (id) => STATUTS_CR.find(s => s.id === id) || STATUTS_CR[0];

// ─── UPLOAD PHOTO (bucket "photos") ──────────────────────────────────────────
async function uploadCrPhoto(file, crId) {
  try {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const path = `cr-client/${crId}/${safe}`;
    const { error } = await supabase.storage.from("photos").upload(path, file, { upsert: false });
    if (error) {
      console.error("upload cr photo:", error);
      return { error: error.message || "Erreur upload Supabase Storage" };
    }
    const { data } = supabase.storage.from("photos").getPublicUrl(path);
    if (!data?.publicUrl) return { error: "URL publique introuvable" };
    return { url: data.publicUrl };
  } catch (e) {
    console.error("upload cr photo (catch):", e);
    return { error: e.message || "Erreur réseau" };
  }
}

export default function PageCompteRendu({ T, chantiers = [], branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  // ── État liste CRs ──
  const [crs, setCrs]           = useState([]);
  const [crId, setCrId]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // ── Données CR courant ──
  const INFOS_VIDE = { client_prenom1:"", client_nom1:"", client_prenom2:"", client_nom2:"", adresse:"", chantier_id:"", date_visite: new Date().toISOString().split("T")[0], heure_visite: `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`, type_visite:"Visite de chantier", participants:"", resume:"", avancement:0, prochaine_etape:"", travaux:"", remarques:"", statut:"brouillon", validateur:"" };
  const [infos, setInfos]       = useState(INFOS_VIDE);
  const [obs, setObs]           = useState([]);
  const [photos, setPhotos]     = useState([]);
  const [deuxiemeClient, setDeuxiemeClient] = useState(false);
  const [phrases, setPhrases]   = useState({ cr_observation: [], visite_observation: [], vigilance: [] });

  // ── UI ──
  const [section, setSection]   = useState("synthese");
  const [iaTexte, setIaTexte]   = useState("");
  const [iaLoading, setIaLoading] = useState(false);
  const [iaStatus, setIaStatus] = useState(null); // {ok, msg}
  const [mobileShowList, setMobileShowList] = useState(false);
  const [searchCrs, setSearchCrs] = useState("");
  const [filterStatut, setFilterStatut] = useState("all");
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [showEmail, setShowEmail] = useState(false);
  const [emailDest, setEmailDest] = useState("");
  const [emailCc, setEmailCc]     = useState("");
  const [emailSujet, setEmailSujet] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sending, setSending]     = useState(false);
  const [emailStatus, setEmailStatus] = useState(null);
  const [societe, setSociete]     = useState({});
  const [visitesChantier, setVisitesChantier] = useState([]);
  const [importingVisite, setImportingVisite] = useState(false);
  const photoInputRef           = useRef(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(0);
  const saveTimer               = useRef(null);

  // ── Thème ──
  const bg      = T.bg      || "#0d0f12";
  const surface = T.surface || "#13161b";
  const card    = T.card    || "#1a1d24";
  const border  = T.border  || "#2a2d35";
  const text    = T.text    || "#f0f0f0";
  const textSub = T.textSub || "#888";
  const accent  = T.accent  || "#FFC300";

  // Styles
  const inp  = { width:"100%", padding:"9px 12px", background:card, border:`1px solid ${border}`, borderRadius:7, color:text, fontSize:13, fontFamily:"inherit" };
  const ta   = { ...inp, resize:"vertical", minHeight:72, lineHeight:1.5 };
  const btn  = { background:accent, color:"#000", border:"none", borderRadius:7, padding:"8px 16px", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer" };
  const btnS = { background:"transparent", color:textSub, border:`1px solid ${border}`, borderRadius:7, padding:"8px 14px", fontFamily:"inherit", fontSize:12, cursor:"pointer" };
  const btnD = { background:"transparent", color:"#e05c5c", border:"1px solid rgba(224,92,92,0.3)", borderRadius:7, padding:"5px 10px", fontFamily:"inherit", fontSize:11, cursor:"pointer" };
  const lbl  = { display:"block", fontSize:11, fontWeight:700, color:textSub, marginBottom:5, textTransform:"uppercase", letterSpacing:.5 };
  const sec  = (id) => ({ padding:"9px 14px", borderRadius:7, cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600, background: section===id ? accent : "transparent", color: section===id ? "#000" : textSub, border:"none", textAlign:"left", width:"100%", display:"flex", alignItems:"center", gap:8, transition:"all .12s" });
  const cardS = { background:card, border:`1px solid ${border}`, borderRadius:10, padding:"18px 20px", marginBottom:14 };
  const cardTitle = { fontSize:11, fontWeight:700, color:textSub, textTransform:"uppercase", letterSpacing:.8, marginBottom:14, paddingBottom:10, borderBottom:`1px solid ${border}`, display:"flex", alignItems:"center", gap:8 };

  // ── Init ──
  useEffect(() => { chargerCRs(); chargerPhrases(); chargerSociete(); }, []);

  // ── Charge les visites du chantier sélectionné (pour pré-remplissage)
  useEffect(() => {
    const ch = infos.chantier_id;
    if (!ch) { setVisitesChantier([]); return; }
    supabase.from("visites_chantier").select("id, date, chantier_nom, statut, audit, note_generale")
      .eq("chantier_id", ch).order("date", { ascending: false }).limit(20)
      .then(({ data }) => setVisitesChantier(data || []));
  }, [infos.chantier_id]);

  async function chargerSociete() {
    const { data } = await supabase.from("planning_config").select("value").eq("key", "societe").maybeSingle();
    if (data?.value) setSociete(data.value);
  }

  // ── DATA ──
  async function chargerCRs() {
    setLoading(true);
    const { data } = await supabase.from("cr_comptes_rendus").select("*").order("created_at", { ascending:false });
    if (data) { setCrs(data); if (data.length > 0) chargerCR(data[0].id); else setLoading(false); }
    else setLoading(false);
  }

  async function chargerPhrases() {
    const { data } = await supabase.from("planning_config").select("value").eq("key", "phrases_bank").maybeSingle();
    if (data?.value) setPhrases({ cr_observation: [], visite_observation: [], vigilance: [], ...data.value });
  }

  async function chargerCR(id) {
    setLoading(true); setCrId(id);
    const [{ data:cr }, { data:o }, { data:ph }] = await Promise.all([
      supabase.from("cr_comptes_rendus").select("*").eq("id",id).single(),
      supabase.from("cr_observations").select("*").eq("cr_id",id).order("ordre"),
      supabase.from("cr_photos").select("*").eq("cr_id",id),
    ]);
    if (cr) {
      setInfos({
        client_prenom1:cr.client_prenom1||"", client_nom1:cr.client_nom1||"",
        client_prenom2:cr.client_prenom2||"", client_nom2:cr.client_nom2||"",
        adresse:cr.adresse||"", chantier_id:cr.chantier_id||"",
        date_visite:cr.date_visite||"", heure_visite:cr.heure_visite||"",
        type_visite:cr.type_visite||"Visite de chantier",
        participants:cr.participants||"",
        resume:cr.resume||"", avancement:cr.avancement||0,
        prochaine_etape:cr.prochaine_etape||"",
        travaux:cr.travaux||"", remarques:cr.remarques||"",
        statut:cr.statut||"brouillon",
        validateur: cr.validateur || "",
      });
      setDeuxiemeClient(!!(cr.client_prenom2 || cr.client_nom2));
    }
    setObs(o && o.length > 0 ? o : [{ id:"new_1", statut:"warn", texte:"", ordre:0 }]);
    setPhotos(ph || []);
    setLoading(false);
  }

  function debounce(fn, d=800) { if(saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current=setTimeout(fn,d); }

  async function saveInfos(v) {
    if (!crId) return; setSaving(true);
    const payload = {
      client_prenom1:   v.client_prenom1   ?? "",
      client_nom1:      v.client_nom1      ?? "",
      client_prenom2:   v.client_prenom2   ?? "",
      client_nom2:      v.client_nom2      ?? "",
      adresse:          v.adresse          ?? "",
      chantier_id:      v.chantier_id      || null,
      date_visite:      v.date_visite      ?? "",
      heure_visite:     v.heure_visite     ?? "",
      type_visite:      v.type_visite      ?? "",
      participants:     v.participants     ?? "",
      resume:           v.resume           ?? "",
      avancement:       v.avancement       ?? 0,
      prochaine_etape:  v.prochaine_etape  ?? "",
      travaux:          v.travaux          ?? "",
      remarques:        v.remarques        ?? "",
      statut:           v.statut           ?? "brouillon",
      validateur:       v.validateur       ?? "",
    };
    let { error } = await supabase.from("cr_comptes_rendus").update(payload).eq("id", crId);
    // Fallback : si la colonne validateur n'existe pas (42703), retente sans
    if (error?.code === "42703" && error.message?.includes("validateur")) {
      const { validateur: _, ...payloadSansValidateur } = payload;
      const retry = await supabase.from("cr_comptes_rendus").update(payloadSansValidateur).eq("id", crId);
      error = retry.error;
    }
    if (error) {
      console.error("saveInfos CR error:", error);
      const hint = (error.message||"").toLowerCase().includes("schema") || (error.message||"").includes("column")
        ? "Cache schéma : exécute « NOTIFY pgrst, 'reload schema'; » dans Supabase SQL Editor."
        : "";
      setSaveError({ msg: error.message || "Erreur de sauvegarde", hint });
      setTimeout(() => setSaveError(null), 8000);
    } else {
      setSaveError(null);
      setCrs(prev=>prev.map(c=>c.id===crId?{...c,...v}:c));
    }
    setSaving(false);
  }
  function updInfo(f,v) { const u={...infos,[f]:v}; setInfos(u); debounce(()=>saveInfos(u)); }

  // ── Observations ──
  async function ajoutObs() {
    if (!crId) return;
    const ordre = obs.length;
    const { data } = await supabase.from("cr_observations").insert({ cr_id:crId, statut:"warn", texte:"", ordre }).select().single();
    if (data) setObs(p=>[...p,data]);
    else setObs(p=>[...p,{ id:`new_${Date.now()}`, statut:"warn", texte:"", ordre }]);
  }

  async function updObs(id, field, value) {
    setObs(p=>p.map(o=>o.id===id?{...o,[field]:value}:o));
    if (!id.toString().startsWith("new_")) {
      debounce(()=>supabase.from("cr_observations").update({[field]:value}).eq("id",id));
    } else {
      // Persister si c'était "new"
      const ob = obs.find(o=>o.id===id);
      if (ob) {
        const updated = {...ob,[field]:value};
        const{data}=await supabase.from("cr_observations").insert({cr_id:crId,statut:updated.statut,texte:updated.texte,ordre:updated.ordre}).select().single();
        if(data) setObs(p=>p.map(o=>o.id===id?data:o));
      }
    }
  }

  async function delObs(id) {
    if (!id.toString().startsWith("new_")) await supabase.from("cr_observations").delete().eq("id",id);
    setObs(p=>p.filter(o=>o.id!==id));
  }

  // ── Photos (upload vers Supabase Storage, plus léger que base64 en DB) ─────
  async function ajoutPhotos(e) {
    if (!crId) {
      alert("Crée ou ouvre d'abord un compte rendu avant d'ajouter des photos.");
      return;
    }
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingPhotos(files.length);
    const errors = [];
    for (const f of files) {
      const res = await uploadCrPhoto(f, crId);
      setUploadingPhotos(n => n - 1);
      if (res.error) {
        errors.push(`${f.name} : ${res.error}`);
        continue;
      }
      const url = res.url;
      const { data, error: insErr } = await supabase.from("cr_photos").insert({
        cr_id: crId, data: url, nom: f.name,
      }).select().single();
      if (insErr) {
        errors.push(`${f.name} (DB) : ${insErr.message}`);
        // On garde quand même la photo en local pour ne pas la perdre
        setPhotos(p => [...p, { id: `new_${Date.now()}_${Math.random()}`, data: url, nom: f.name }]);
        continue;
      }
      setPhotos(p => [...p, data || { id: `new_${Date.now()}`, data: url, nom: f.name }]);
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
    if (errors.length > 0) {
      alert(`⚠ ${errors.length} photo(s) en erreur :\n\n${errors.join("\n")}\n\nVérifie les permissions du bucket Supabase « photos » ou la table « cr_photos ».`);
    }
  }

  async function delPhoto(id) {
    if (!id.toString().startsWith("new_")) await supabase.from("cr_photos").delete().eq("id",id);
    setPhotos(p=>p.filter(ph=>ph.id!==id));
  }

  // ── Nouveau CR ──
  async function nouveauCR() {
    const { data } = await supabase.from("cr_comptes_rendus").insert({
      client_prenom1: "", client_nom1: "", client_prenom2: "", client_nom2: "",
      adresse: "", chantier_id: null,
      date_visite: new Date().toISOString().split("T")[0],
      heure_visite: `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`,
      type_visite: "Visite de chantier", participants: "", resume: "",
      avancement: 0, prochaine_etape: "", travaux: "", remarques: "",
      statut: "brouillon",
    }).select().single();
    if (data) {
      await supabase.from("cr_observations").insert({ cr_id:data.id, statut:"warn", texte:"", ordre:0 });
      setCrs(p=>[data,...p]); chargerCR(data.id);
    }
  }

  async function confirmSuppCR() {
    if (!toDelete) return;
    setDeleting(true);
    await supabase.from("cr_comptes_rendus").delete().eq("id", toDelete.id);
    const r = crs.filter(c=>c.id !== toDelete.id); setCrs(r);
    if (toDelete.id === crId) {
      if (r.length > 0) chargerCR(r[0].id);
      else { setCrId(null); setInfos(INFOS_VIDE); setObs([]); setPhotos([]); }
    }
    setDeleting(false);
    setToDelete(null);
  }

  // ── IA ──
  async function processIA() {
    if (!iaTexte.trim()) return;
    setIaLoading(true); setIaStatus(null);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:1200,
          messages:[{ role:"user", content:`Analyse ce texte de chantier. Réponds UNIQUEMENT avec un JSON valide sans markdown ni backtick. Format: {"clientPrenom1":"","clientNom1":"","clientPrenom2":"","clientNom2":"","adresse":"","participants":"","typeVisite":"Visite de chantier","resume":"","avancement":"","prochaineEtape":"","observations":[{"statut":"warn","texte":""}],"travaux":"","remarques":""} statut=ok|info|warn|urgent Texte: ${iaTexte}` }]
        })
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const txt = d.content.map(i=>i.text||"").join("").trim();
      const jm = txt.match(/\{[\s\S]*\}/);
      if (!jm) throw new Error("Réponse invalide");
      const p = JSON.parse(jm[0]);
      const newInfos = { ...infos,
        client_prenom1: p.clientPrenom1 || infos.client_prenom1,
        client_nom1:    p.clientNom1    || infos.client_nom1,
        client_prenom2: p.clientPrenom2 || infos.client_prenom2,
        client_nom2:    p.clientNom2    || infos.client_nom2,
        adresse:        p.adresse       || infos.adresse,
        participants:   p.participants  || infos.participants,
        type_visite:    p.typeVisite    || infos.type_visite,
        resume:         p.resume        || infos.resume,
        avancement:     parseInt(p.avancement) || infos.avancement,
        prochaine_etape:p.prochaineEtape|| infos.prochaine_etape,
        travaux:        p.travaux       || infos.travaux,
        remarques:      p.remarques     || infos.remarques,
      };
      setInfos(newInfos); saveInfos(newInfos);
      if (p.clientPrenom2 || p.clientNom2) setDeuxiemeClient(true);
      if (p.observations && p.observations.length > 0) {
        const valides = p.observations.filter(o=>o.texte && o.texte.trim());
        if (valides.length > 0) {
          await supabase.from("cr_observations").delete().eq("cr_id",crId);
          const inserts = valides.map((o,i)=>({ cr_id:crId, statut:o.statut||"warn", texte:o.texte, ordre:i }));
          const { data:newObs } = await supabase.from("cr_observations").insert(inserts).select();
          if (newObs) setObs(newObs);
        }
      }
      setIaTexte(""); setIaStatus({ ok:true, msg:"Champs remplis ✓" });
      setTimeout(()=>setIaStatus(null), 3000);
    } catch(e) {
      setIaStatus({ ok:false, msg:"Erreur IA : " + e.message });
    }
    setIaLoading(false);
  }

  // ── Export PDF ──
  async function genPDF() {
    const clients = [infos.client_prenom1+" "+infos.client_nom1, deuxiemeClient ? infos.client_prenom2+" "+infos.client_nom2 : null].filter(Boolean);
    const dateStr = infos.date_visite ? new Date(infos.date_visite).toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}) : new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    const statusColors = { ok:"#2e7d32", info:"#1565c0", warn:"#b45309", urgent:"#c62828" };
    const statusLabels = { ok:"CONFORME", info:"INFO", warn:"ATTENTION", urgent:"URGENT" };

    // Helper : escape HTML + préserve les sauts de ligne (sinon le texte
    // multi-lignes du résumé/travaux/remarques apparaît collé sur une seule
    // ligne dans le PDF).
    const fmt = (txt) => (txt || "").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br/>");

    const obsHtml = obs.filter(o=>o.texte).map(o=>`
      <div style="display:flex;gap:8pt;align-items:flex-start;margin-bottom:6pt;">
        <div style="background:${statusColors[o.statut]||"#888"};color:#fff;font-size:6.5pt;font-weight:700;padding:2pt 5pt;border-radius:3pt;flex-shrink:0;margin-top:1pt;letter-spacing:.05em;">${statusLabels[o.statut]||"NOTE"}</div>
        <div style="font-size:9pt;color:#333;line-height:1.5;">${fmt(o.texte)}</div>
      </div>`).join("");

    // Préchargement des photos en base64 — sinon le navigateur du popup PDF
    // n'a pas le temps de fetch les URLs Supabase Storage avant le print()
    // et les photos apparaissent vides dans le PDF.
    const photosBase64 = await Promise.all(
      photos.map(p => fetch(p.data)
        .then(r => r.ok ? r.blob() : null)
        .then(b => b ? new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(b); }) : null)
        .catch(() => null)
      )
    );

    const photosHtml = photos.length > 0 ? `
      <div style="margin-bottom:10pt;">
        <div style="display:flex;align-items:center;gap:6pt;margin-bottom:5pt;">
          <div style="width:3pt;height:11pt;background:#f5c400;border-radius:2pt;"></div>
          <span style="font-size:7.5pt;font-weight:700;color:#888;letter-spacing:.08em;">PHOTOS</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8pt;">
          ${photos.map((p, i) => {
            const src = photosBase64[i] || p.data;
            return `<img src="${src}" style="width:120pt;height:90pt;object-fit:cover;border-radius:5pt;border:1pt solid #ddd;" />`;
          }).join("")}
        </div>
      </div>` : "";

    const section = (titre, contenu) => !contenu ? "" : `
      <div style="margin-bottom:10pt;">
        <div style="display:flex;align-items:center;gap:6pt;margin-bottom:5pt;">
          <div style="width:3pt;height:11pt;background:#f5c400;border-radius:2pt;flex-shrink:0;"></div>
          <span style="font-size:7.5pt;font-weight:700;color:#888;letter-spacing:.08em;">${titre}</span>
        </div>
        <div style="height:0.5pt;background:#eee;margin-bottom:8pt;"></div>
        <div style="font-size:9pt;color:#333;line-height:1.6;">${contenu}</div>
      </div>`;

    // URL absolue du logo Profero (résolue depuis l'origine de l'app pour
     // que le navigateur du nouvel onglet puisse charger l'image)
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;background:#fff;color:#111;font-size:9pt;}
      @page{margin:14mm 16mm;size:A4;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head><body>
    <!-- HEADER -->
    <div style="background:#0a0a0a;padding:16pt 20pt;display:flex;justify-content:space-between;align-items:center;margin-bottom:16pt;border-radius:5pt;">
      <div style="display:flex;align-items:center;gap:14pt;">
        <img src="${logoUrl}" alt="Profero Rénovation" style="height:42pt;object-fit:contain;object-position:left;" />
        <div style="color:rgba(255,255,255,.45);font-size:9pt;font-weight:600;letter-spacing:.04em;">Compte Rendu de Visite</div>
      </div>
      <div style="text-align:right;">
        <div style="color:#fff;font-size:9pt;font-weight:600;">${clients.join(" & ") || "—"}</div>
        <div style="color:rgba(255,255,255,.5);font-size:8pt;margin-top:2pt;">${infos.type_visite} · ${dateStr}</div>
        ${infos.heure_visite ? `<div style="color:rgba(255,255,255,.4);font-size:7.5pt;">${infos.heure_visite}</div>` : ""}
      </div>
    </div>

    <!-- INFOS -->
    <div style="display:flex;gap:10pt;margin-bottom:12pt;">
      <div style="flex:1;background:#f9f9f9;border-radius:5pt;padding:10pt 12pt;">
        <div style="font-size:7pt;font-weight:700;color:#aaa;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6pt;">Client(s)</div>
        ${clients.map(c=>`<div style="font-size:10pt;font-weight:600;color:#111;">${c}</div>`).join("")}
        ${infos.adresse ? `<div style="font-size:8.5pt;color:#555;margin-top:4pt;">${infos.adresse}</div>` : ""}
      </div>
      <div style="flex:1;background:#f9f9f9;border-radius:5pt;padding:10pt 12pt;">
        <div style="font-size:7pt;font-weight:700;color:#aaa;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6pt;">Visite</div>
        <div style="font-size:9pt;color:#333;margin-bottom:3pt;">${infos.type_visite}</div>
        ${infos.participants ? `<div style="font-size:8.5pt;color:#555;">${infos.participants}</div>` : ""}
      </div>
      ${infos.avancement ? `
      <div style="width:90pt;background:#0a0a0a;border-radius:5pt;padding:10pt 12pt;text-align:center;">
        <div style="font-size:7pt;font-weight:700;color:rgba(255,255,255,.4);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6pt;">Avancement</div>
        <div style="font-size:22pt;font-weight:700;color:#f5c400;">${infos.avancement}%</div>
      </div>` : ""}
    </div>

    ${section("RÉSUMÉ & ÉTAT DU CHANTIER", fmt(infos.resume))}
    ${infos.prochaine_etape ? `<div style="background:#fff9e6;border-left:3pt solid #f5c400;padding:8pt 12pt;border-radius:4pt;margin-bottom:10pt;font-size:9pt;color:#333;"><strong style="color:#9a7a00;">Prochaine étape :</strong> ${fmt(infos.prochaine_etape)}</div>` : ""}

    ${obs.some(o=>o.texte) ? `
    <div style="margin-bottom:10pt;">
      <div style="display:flex;align-items:center;gap:6pt;margin-bottom:5pt;">
        <div style="width:3pt;height:11pt;background:#f5c400;border-radius:2pt;"></div>
        <span style="font-size:7.5pt;font-weight:700;color:#888;letter-spacing:.08em;">OBSERVATIONS & POINTS DE VIGILANCE</span>
      </div>
      <div style="height:0.5pt;background:#eee;margin-bottom:8pt;"></div>
      ${obsHtml}
    </div>` : ""}

    ${section("TRAVAUX À VENIR / DÉCISIONS PRISES", fmt(infos.travaux))}
    ${section("REMARQUES COMPLÉMENTAIRES", fmt(infos.remarques))}
    ${photosHtml}

    <!-- FOOTER fixe -->
    <div style="position:fixed;bottom:0;left:0;right:0;background:#0a0a0a;padding:5pt 14pt;display:flex;justify-content:space-between;">
      <span style="color:#555;font-size:7pt;">PROFERO — Document confidentiel</span>
      <span style="color:#555;font-size:7pt;">${new Date().toLocaleDateString("fr-FR")}</span>
    </div>
    </body></html>`;

    const w = window.open("","_blank","width=900,height=700");
    w.document.write(html); w.document.close();
    w.onload = () => setTimeout(()=>{ w.focus(); w.print(); }, 300);
  }

  // ── Progression de la semaine de la visite ──────────────────────────────
  // Avancement avant cette semaine (dernier snapshot antérieur au lundi de la
  // semaine de la visite) vs avancement renseigné dans le CR.
  async function calculerProgression() {
    if (!infos.chantier_id || !infos.date_visite) return null;
    const d = new Date(infos.date_visite);
    if (isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const lundi = new Date(d); lundi.setDate(d.getDate() + diff);
    const lundiIso = lundi.toISOString().slice(0, 10);
    const { data } = await supabase
      .from("chantier_avancement_history")
      .select("avancement, date_snapshot")
      .eq("chantier_id", infos.chantier_id)
      .lt("date_snapshot", lundiIso)
      .order("date_snapshot", { ascending: false })
      .limit(1);
    const avant      = data?.[0]?.avancement ?? null;
    const maintenant = parseInt(infos.avancement) || 0;
    if (maintenant === 0 && avant == null) return null;
    return {
      avant,
      maintenant,
      delta:     avant != null ? maintenant - avant : null,
      dateAvant: data?.[0]?.date_snapshot || null,
    };
  }

  // ── EXPORT WORD ──────────────────────────────────────────────────────────
  async function handleExportWord() {
    if (!crId || exporting) return;
    setExporting(true);
    try {
      const progression = await calculerProgression();
      const res = await fetch("/api/generate-cr-client-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ infos, obs: obs.filter(o => o.texte), photos, societe, progression }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erreur serveur" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = (infos.client_nom1 || "client").replace(/[^a-zA-Z0-9-_]/g, "_");
      a.download = `CR-${safe}-${infos.date_visite || ""}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Erreur lors de la génération du document : " + e.message);
    }
    setExporting(false);
  }

  // ── PRÉ-REMPLISSAGE DEPUIS UNE VISITE ────────────────────────────────────
  async function importerDepuisVisite(visiteId) {
    if (!visiteId || !crId) return;
    setImportingVisite(true);
    try {
      const visite = visitesChantier.find(v => v.id === visiteId);
      if (!visite) throw new Error("Visite introuvable");

      // Construit le résumé + observations à partir de la visite
      const audit = visite.audit || {};
      const toutes = Object.values(audit).flat();
      const ok = toutes.filter(t => t.statut === "ok").length;
      const res = toutes.filter(t => t.statut === "reserve").length;
      const nok = toutes.filter(t => t.statut === "nok").length;

      const resume = `Visite de chantier du ${visite.date} — ${toutes.length} points évalués (${ok} conformes, ${res} réserves, ${nok} non conformes).${visite.note_generale ? "\n\n" + visite.note_generale : ""}`;

      // Convertit les Rés/NOK de la visite en observations CR
      const obsFromVisite = toutes
        .filter(t => t.statut === "reserve" || t.statut === "nok")
        .map((t, i) => ({
          statut: t.statut === "nok" ? "urgent" : "warn",
          texte: `${t.nom}${t.commentaire ? " — " + t.commentaire : ""}`,
          ordre: i,
        }));

      // Met à jour les infos
      const newInfos = {
        ...infos,
        date_visite: visite.date || infos.date_visite,
        resume: infos.resume ? infos.resume + "\n\n" + resume : resume,
      };
      setInfos(newInfos);
      await saveInfos(newInfos);

      // Insère les observations (sans écraser celles existantes)
      if (obsFromVisite.length > 0) {
        const baseOrdre = obs.length;
        const inserts = obsFromVisite.map((o, i) => ({
          cr_id: crId,
          statut: o.statut,
          texte: o.texte,
          ordre: baseOrdre + i,
        }));
        const { data: newObs } = await supabase.from("cr_observations").insert(inserts).select();
        if (newObs) setObs(prev => [...prev.filter(o => o.texte), ...newObs]);
      }
    } catch (e) {
      alert("Erreur pré-remplissage : " + e.message);
    }
    setImportingVisite(false);
  }

  // ── ENVOI EMAIL AU CLIENT ────────────────────────────────────────────────
  function ouvrirModalEmail() {
    setEmailDest("");
    setEmailCc("");
    const clientNom = `${infos.client_prenom1 || ""} ${infos.client_nom1 || ""}`.trim() || "Client";
    const dateF = infos.date_visite ? new Date(infos.date_visite).toLocaleDateString("fr-FR") : "";
    setEmailSujet(`Compte rendu de visite du ${dateF}${infos.adresse ? " — " + infos.adresse.split(",")[0] : ""}`);
    setEmailBody(`Bonjour ${clientNom},\n\nVeuillez trouver ci-joint le compte rendu de notre visite du ${dateF}.\n\nN'hésitez pas à revenir vers nous pour toute question.\n\nCordialement,\n${societe.nom || "Profero Rénovation"}`);
    setEmailStatus(null);
    setShowEmail(true);
  }

  async function handleSendEmail() {
    if (!emailDest.trim() || !emailSujet.trim()) {
      setEmailStatus({ ok: false, msg: "Destinataire et sujet obligatoires." });
      return;
    }
    setSending(true); setEmailStatus(null);
    try {
      // 1) Générer le docx
      const progression = await calculerProgression();
      const docxRes = await fetch("/api/generate-cr-client-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ infos, obs: obs.filter(o => o.texte), photos, societe, progression }),
      });
      if (!docxRes.ok) throw new Error("Génération docx échouée");
      const blob = await docxRes.blob();
      // Convertit en base64
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result.split(",")[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const safe = (infos.client_nom1 || "client").replace(/[^a-zA-Z0-9-_]/g, "_");
      const filename = `CR-${safe}-${infos.date_visite || ""}.docx`;

      // 2) Envoyer via /api/send-email avec pièce jointe
      const to = emailDest.split(",").map(s => s.trim()).filter(Boolean);
      const cc = emailCc ? emailCc.split(",").map(s => s.trim()).filter(Boolean) : null;
      const bodyHtml = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1f2e;line-height:1.6">${
        emailBody.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>")
      }</div>`;

      const mailRes = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to, cc, subject: emailSujet, html: bodyHtml,
          attachments: [{ filename, content: base64 }],
        }),
      });
      const mailData = await mailRes.json().catch(() => ({}));
      if (!mailRes.ok) throw new Error(mailData.error || `Erreur envoi (HTTP ${mailRes.status})`);

      // 3) Marquer le CR comme envoyé
      const newInfos = { ...infos, statut: "envoye" };
      setInfos(newInfos);
      await saveInfos(newInfos);

      setEmailStatus({ ok: true, msg: "Email envoyé avec succès ✓" });
      setTimeout(() => setShowEmail(false), 1500);
    } catch (e) {
      setEmailStatus({ ok: false, msg: "Erreur : " + e.message });
    }
    setSending(false);
  }

  // ── RENDU ──
  if (loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,color:T.textMuted,fontSize:FONT.sm.size}}>Chargement…</div>;

  // Onglets unifiés (au lieu de 3 panneaux)
  const TABS = [
    { id:"synthese",  label:"Synthèse",     icon:FileText },
    { id:"obs",       label:"Observations", icon:AlertTriangle },
    { id:"travaux",   label:"Travaux",      icon:Wrench },
    { id:"remarques", label:"Remarques",    icon:MessageSquare },
    { id:"photos",    label:"Photos",       icon:Camera },
    { id:"ia",        label:"Import IA",    icon:Sparkles },
  ];

  // Filtrage CRs
  const crsFiltres = crs.filter(c => {
    if (filterStatut !== "all" && (c.statut || "brouillon") !== filterStatut) return false;
    if (searchCrs.trim()) {
      const q = searchCrs.toLowerCase();
      const txt = `${c.client_nom1||""} ${c.client_prenom1||""} ${c.adresse||""} ${c.type_visite||""}`.toLowerCase();
      if (!txt.includes(q)) return false;
    }
    return true;
  });
  const statsParStatut = STATUTS_CR.reduce((a,s) => { a[s.id] = crs.filter(c => (c.statut||"brouillon") === s.id).length; return a; }, {});
  const crActif = crs.find(c => c.id === crId);

  return (
    <div className="cr-page" style={{ display:"flex", height:"100%", background:T.bg, overflow:"hidden", position:"relative" }}>
      <style>{`
        .cr-mobile-bar{display:none}
        @media(max-width:767px){
          /* Sans flex-direction:column, la mobile-bar est positionnée à gauche
             en flex-row et écrase le contenu principal à 0px. */
          .cr-page{flex-direction:column!important}

          .cr-page .cr-list-panel{position:absolute;left:0;top:0;bottom:0;width:88%;max-width:320px;z-index:60;transform:translateX(-100%);transition:transform .25s;box-shadow:4px 0 24px rgba(0,0,0,0.4)}
          .cr-page .cr-list-panel.open{transform:translateX(0)}
          .cr-page .cr-drawer-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.5);z-index:55;opacity:0;pointer-events:none;transition:opacity .2s}
          .cr-page .cr-drawer-backdrop.open{opacity:1;pointer-events:auto}
          .cr-page .cr-mobile-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;background:${T.surface};border-bottom:1px solid ${T.border};flex-shrink:0;width:100%}
          .cr-page .cr-form-grid{grid-template-columns:1fr!important;gap:10px!important}

          /* Header CR : padding réduit, statut + actions sur leur ligne pleine largeur */
          .cr-page .cr-header{padding:10px 12px!important}
          .cr-page .cr-header-row{flex-wrap:wrap!important;gap:8px!important;margin-bottom:8px!important}
          .cr-page .cr-header-actions{flex:1 1 100%;display:flex;flex-wrap:wrap;gap:6px;order:10;align-items:center}
          .cr-page .cr-header-actions select{flex:1 1 140px;min-width:0}
          .cr-page .cr-header-actions .cr-export-btn{flex:1 1 110px;justify-content:center}
          .cr-page .cr-header-actions .cr-send-btn{flex:1 1 110px;justify-content:center}
          .cr-page .cr-projet-name{font-size:15px!important}

          /* Onglets : scroll horizontal au lieu de wrap */
          .cr-page .cr-tabs{flex-wrap:nowrap!important;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -12px;padding:0 12px;scrollbar-width:none}
          .cr-page .cr-tabs::-webkit-scrollbar{display:none}
          .cr-page .cr-tabs button{flex-shrink:0;padding:7px 11px!important;white-space:nowrap}

          /* Body des onglets : padding réduit */
          .cr-page .cr-body{padding:14px 12px!important}

          /* Ligne d'observation : passe en colonne (select + textarea + bouton trop tassés) */
          .cr-page .obs-row{flex-wrap:wrap!important}
          .cr-page .obs-row > select{flex:1 1 calc(100% - 50px)!important;width:auto!important}
          .cr-page .obs-row > textarea{flex:1 1 100%!important}
          .cr-page .obs-row > button{flex:0 0 auto;align-self:flex-start}
        }
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* ── BARRE MOBILE ── */}
      <div className="cr-mobile-bar">
        <button onClick={()=>setMobileShowList(true)} style={{
          display:"inline-flex",alignItems:"center",gap:6,
          background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.md,
          padding:"7px 12px",color:T.text,fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
        }}>
          <Icon as={Menu} size={13}/>
          Comptes rendus
        </button>
        <div style={{flex:1,minWidth:0,fontSize:FONT.sm.size,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {crActif ? (crActif.client_nom1 ? `${crActif.client_prenom1||""} ${crActif.client_nom1}`.trim() : "Sans client") : "Aucun CR"}
        </div>
      </div>

      <div className={`cr-drawer-backdrop ${mobileShowList?"open":""}`} onClick={()=>setMobileShowList(false)}/>

      {/* ── SIDEBAR LISTE ── */}
      <div className={`cr-list-panel ${mobileShowList?"open":""}`} style={{
        width:300, flexShrink:0, display:"flex", flexDirection:"column",
        background:T.surface, borderRight:`1px solid ${T.border}`,
      }}>
        {/* Header */}
        <div style={{padding:"14px",borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{
              width:32,height:32,borderRadius:RADIUS.md,flexShrink:0,
              background:acc.bg10,color:acc.accent,
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>
              <Icon as={FileText} size={18} strokeWidth={2}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:FONT.sm.size+1,fontWeight:800,color:T.text,letterSpacing:-.2}}>Comptes rendus</div>
              <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>
                {crs.length} CR{crs.length>1?"s":""}{saving && " · sauvegarde…"}
              </div>
            </div>
            <button onClick={nouveauCR} title="Nouveau" style={{
              display:"inline-flex",alignItems:"center",justifyContent:"center",
              background:acc.accent,color:acc.onAccent,border:"none",
              borderRadius:RADIUS.md,width:30,height:30,cursor:"pointer",
            }}>
              <Icon as={Plus} size={14}/>
            </button>
          </div>

          {/* Recherche */}
          <div style={{position:"relative",marginBottom:8}}>
            <Icon as={Search} size={12} color={T.textMuted}
              style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}/>
            <input value={searchCrs} onChange={e=>setSearchCrs(e.target.value)} placeholder="Rechercher…"
              style={{
                width:"100%",background:T.fieldBg||T.card,
                border:`1px solid ${T.fieldBorder||T.border}`,borderRadius:RADIUS.md,
                padding:"7px 10px 7px 28px",color:T.text,
                fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",
              }}/>
          </div>

          {/* Filtre statut */}
          <select value={filterStatut} onChange={e=>setFilterStatut(e.target.value)} style={{
            width:"100%",background:T.fieldBg||T.card,border:`1px solid ${T.fieldBorder||T.border}`,
            borderRadius:RADIUS.md,padding:"7px 10px",color:T.text,
            fontFamily:"inherit",fontSize:FONT.xs.size+1,outline:"none",cursor:"pointer",
          }}>
            <option value="all">Tous les statuts</option>
            {STATUTS_CR.map(s => (
              <option key={s.id} value={s.id}>{s.label} ({statsParStatut[s.id]||0})</option>
            ))}
          </select>
        </div>

        {/* Liste */}
        <div style={{flex:1,overflowY:"auto",padding:8}}>
          {crs.length===0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",marginTop:20,lineHeight:1.8}}>
              Aucun compte rendu<br/>
              <button onClick={nouveauCR} style={{
                display:"inline-flex",alignItems:"center",gap:5,marginTop:10,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"7px 14px",cursor:"pointer",
                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
              }}>
                <Icon as={Plus} size={12}/>
                Créer
              </button>
            </div>
          )}
          {crsFiltres.length===0 && crs.length>0 && (
            <div style={{color:T.textMuted,fontSize:FONT.xs.size+1,textAlign:"center",padding:"16px 12px",fontStyle:"italic"}}>
              Aucun CR ne correspond à ces filtres.
            </div>
          )}
          {crsFiltres.map(c => {
            const act = c.id===crId;
            const st = statutMeta(c.statut);
            const nomClient = c.client_nom1 ? `${c.client_prenom1||""} ${c.client_nom1}`.trim() : "Sans client";
            return (
              <div key={c.id} onClick={()=>{chargerCR(c.id);setMobileShowList(false);}} style={{
                padding:"10px 12px",borderRadius:RADIUS.md,marginBottom:6,cursor:"pointer",
                background:act?acc.bg10:T.card,
                border:`1px solid ${act?acc.accent:T.border}`,
                borderLeft:`3px solid ${st.color}`,
                transition:"all .12s",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <span style={{fontSize:FONT.sm.size,fontWeight:700,color:act?acc.accent:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {nomClient}
                  </span>
                  <span style={{
                    fontSize:FONT.xs.size-1,fontWeight:700,padding:"1px 6px",borderRadius:RADIUS.sm,
                    background:st.color+"22",color:st.color,whiteSpace:"nowrap",flexShrink:0,
                  }}>{st.label}</span>
                </div>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:2,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:3}}>
                    <Icon as={Calendar} size={9}/>
                    {c.date_visite ? new Date(c.date_visite).toLocaleDateString("fr-FR") : "—"}
                  </span>
                  <span>·</span>
                  <span>{c.type_visite || "Visite"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENU PRINCIPAL ── */}
      {!crId ? (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:T.textSub,padding:24}}>
          <div style={{
            width:64,height:64,borderRadius:RADIUS.lg,
            background:acc.bg10,color:acc.accent,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>
            <Icon as={FileText} size={32} strokeWidth={1.5}/>
          </div>
          <div style={{fontSize:FONT.md.size,fontWeight:700,color:T.text}}>Sélectionne ou crée un compte rendu</div>
          <button onClick={nouveauCR} style={{
            display:"inline-flex",alignItems:"center",gap:6,
            background:acc.accent,color:acc.onAccent,border:"none",
            borderRadius:RADIUS.md,padding:"10px 20px",cursor:"pointer",
            fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
          }}>
            <Icon as={Plus} size={14}/>
            Nouveau compte rendu
          </button>
        </div>
      ) : (
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0}}>
          {/* En-tête CR */}
          <div className="cr-header" style={{padding:"14px 22px",borderBottom:`1px solid ${T.border}`,background:T.bg,flexShrink:0}}>
            <div className="cr-header-row" style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
              <div style={{
                width:36,height:36,borderRadius:RADIUS.md,flexShrink:0,
                background:acc.bg10,color:acc.accent,
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={FileText} size={20} strokeWidth={2}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div className="cr-projet-name" style={{fontSize:FONT.lg.size+2,fontWeight:800,color:T.text,letterSpacing:-.3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {infos.client_nom1 ? `${infos.client_nom1} ${infos.client_prenom1||""}` : "Nouveau compte rendu"}
                </div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:2,display:"flex",flexWrap:"wrap",gap:10}}>
                  {infos.adresse && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={MapPin} size={11}/>{infos.adresse}
                    </span>
                  )}
                  {infos.date_visite && (
                    <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                      <Icon as={Calendar} size={11}/>{new Date(infos.date_visite).toLocaleDateString("fr-FR")}
                    </span>
                  )}
                  <span>· {infos.type_visite}</span>
                </div>
              </div>
              {/* Statut + actions : passent sur leur propre ligne en mobile */}
              <div className="cr-header-actions">
                <select value={infos.statut || "brouillon"} onChange={e=>updInfo("statut",e.target.value)}
                  style={{
                    padding:"7px 12px",borderRadius:RADIUS.md,border:`1px solid ${statutMeta(infos.statut).color}55`,
                    background:statutMeta(infos.statut).color+"18",color:statutMeta(infos.statut).color,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,outline:"none",cursor:"pointer",
                  }}>
                  {STATUTS_CR.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button onClick={handleExportWord} disabled={exporting} title="Exporter en Word (.docx)"
                  className="cr-export-btn"
                  style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    padding:"7px 14px",borderRadius:RADIUS.md,border:"none",
                    background:acc.accent,color:acc.onAccent,
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:exporting?"not-allowed":"pointer",
                    opacity:exporting?.6:1,
                  }}>
                  <Icon as={Download} size={13}/>
                  {exporting ? "Export…" : "Word"}
                </button>
                <button onClick={ouvrirModalEmail} title="Envoyer au client par email"
                  className="cr-send-btn"
                  style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    padding:"7px 14px",borderRadius:RADIUS.md,
                    border:`1px solid ${T.border}`,background:T.surface,color:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:700,cursor:"pointer",
                  }}>
                  <Icon as={Send} size={13}/>
                  Envoyer
                </button>
                <button onClick={genPDF} title="Exporter en PDF (via aperçu d'impression du navigateur)"
                  className="cr-export-btn"
                  style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    padding:"7px 14px",borderRadius:RADIUS.md,
                    border:`1px solid ${acc.accent}55`,background:`${acc.accent}15`,color:acc.accent,
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,cursor:"pointer",
                  }}>
                  <Icon as={Download} size={13}/>
                  PDF
                </button>
                <button onClick={()=>setToDelete(crActif)} title="Supprimer" style={{
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",border:`1px solid rgba(224,92,92,0.3)`,
                  borderRadius:RADIUS.md,padding:"7px 10px",color:"#e15a5a",cursor:"pointer",
                }}>
                  <Icon as={Trash2} size={13}/>
                </button>
              </div>
            </div>

            {/* Onglets unifiés (scroll horizontal sur mobile) */}
            <div className="cr-tabs" style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {TABS.map(t => {
                const a = section===t.id;
                return (
                  <button key={t.id} onClick={()=>setSection(t.id)} style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    padding:"7px 14px",borderRadius:RADIUS.md,
                    border:a?"none":`1px solid ${T.border}`,
                    background:a?acc.accent:T.card,color:a?acc.onAccent:T.textSub,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",
                    transition:"all .12s",
                  }}>
                    <Icon as={t.icon} size={12}/>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Corps onglet */}
          <div className="cr-body" style={{flex:1,overflowY:"auto",padding:"18px 22px",background:T.bg}}>

            {/* Bandeau erreur de sauvegarde */}
            {saveError && (
              <div style={{
                display:"flex",alignItems:"flex-start",gap:8,
                padding:"10px 14px",marginBottom:14,
                background:"rgba(224,92,92,0.10)",border:"1px solid rgba(224,92,92,0.30)",
                borderRadius:RADIUS.md,
              }}>
                <Icon as={AlertTriangle} size={14} color="#e15a5a" style={{marginTop:2,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:FONT.sm.size,fontWeight:700,color:"#e15a5a",marginBottom:2}}>Sauvegarde échouée</div>
                  <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.5}}>
                    {saveError.msg}
                    {saveError.hint && <><br/><strong style={{color:T.text}}>Astuce :</strong> {saveError.hint}</>}
                  </div>
                </div>
                <button onClick={()=>setSaveError(null)} style={{
                  background:"transparent",border:"none",cursor:"pointer",color:T.textMuted,padding:4,
                  display:"inline-flex",alignItems:"center",justifyContent:"center",
                }}>
                  <Icon as={X} size={12}/>
                </button>
              </div>
            )}

            {/* ── SYNTHÈSE (Client + Visite + Avancement + Résumé) ── */}
            {section==="synthese" && (
              <div style={{maxWidth:880}}>
                {/* Client */}
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:10, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={User} size={11}/>
                  Client
                </div>
                <div className="cr-form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                  <div><label style={lbl}>Prénom</label><input style={inp} value={infos.client_prenom1} onChange={e=>updInfo("client_prenom1",e.target.value)} placeholder="Jean" /></div>
                  <div><label style={lbl}>Nom</label><input style={inp} value={infos.client_nom1} onChange={e=>updInfo("client_nom1",e.target.value)} placeholder="Dupont" /></div>
                </div>
                {!deuxiemeClient ? (
                  <button onClick={()=>setDeuxiemeClient(true)} style={{
                    display:"inline-flex",alignItems:"center",gap:5,
                    background:"transparent",border:"none",color:acc.accent,
                    fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,cursor:"pointer",padding:0,marginBottom:14,
                  }}>
                    <Icon as={Plus} size={11}/>
                    Ajouter un second client
                  </button>
                ) : (
                  <div className="cr-form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    <div><label style={lbl}>Prénom (2)</label><input style={inp} value={infos.client_prenom2} onChange={e=>updInfo("client_prenom2",e.target.value)} placeholder="Marie" /></div>
                    <div><label style={lbl}>Nom (2)</label><input style={inp} value={infos.client_nom2} onChange={e=>updInfo("client_nom2",e.target.value)} placeholder="Martin" /></div>
                  </div>
                )}

                {/* Chantier (sélecteur) + adresse */}
                <div className="cr-form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                  <div>
                    <label style={lbl}>Chantier lié</label>
                    <select style={inp} value={infos.chantier_id||""} onChange={e=>{
                      const ch = chantiers.find(c=>c.id===e.target.value);
                      const u = {...infos, chantier_id:e.target.value};
                      // Si on choisit un chantier, on peut auto-remplir l'adresse si vide
                      if (ch && !infos.adresse) u.adresse = ch.adresse || "";
                      setInfos(u); debounce(()=>saveInfos(u));
                    }}>
                      <option value="">— Aucun —</option>
                      {chantiers.map(c=><option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Adresse</label>
                    <input style={inp} value={infos.adresse} onChange={e=>updInfo("adresse",e.target.value)} placeholder="14 Bd du Roi René, 49000 Angers" />
                  </div>
                </div>

                {/* Visite */}
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:10, marginTop:14, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Calendar} size={11}/>
                  Visite
                </div>
                <div className="cr-form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
                  <div><label style={lbl}>Date</label><input type="date" style={inp} value={infos.date_visite} onChange={e=>updInfo("date_visite",e.target.value)} /></div>
                  <div><label style={lbl}>Heure</label><input type="time" style={inp} value={infos.heure_visite} onChange={e=>updInfo("heure_visite",e.target.value)} /></div>
                  <div>
                    <label style={lbl}>Type</label>
                    <select style={inp} value={infos.type_visite} onChange={e=>updInfo("type_visite",e.target.value)}>
                      {TYPES_VISITE.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={lbl}>Participants</label>
                  <input style={inp} value={infos.participants} onChange={e=>updInfo("participants",e.target.value)} placeholder="Loris BESSONNEAU (PROFERO), client…" />
                </div>
                <div style={{marginBottom:14}}>
                  <label style={lbl}>Validateur <span style={{ color: T.textMuted, fontWeight: 400, fontSize: 11 }}>(personne qui valide ce CR · affichée dans Dashboard Analyse)</span></label>
                  <input style={inp} value={infos.validateur || ""} onChange={e=>updInfo("validateur",e.target.value)} placeholder="François Huet" />
                </div>

                {/* Résumé + Avancement */}
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:10, marginTop:14, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={TrendingUp} size={11}/>
                  Résumé & avancement
                </div>
                <div style={{marginBottom:12}}>
                  <label style={lbl}>Résumé de la visite</label>
                  <textarea style={{...ta,minHeight:90}} value={infos.resume} onChange={e=>updInfo("resume",e.target.value)} placeholder="État du chantier, travaux réalisés…" />
                  {phrases.cr_observation.length > 0 && (
                    <PhrasesSuggestions phrases={phrases.cr_observation} onPick={(p)=>updInfo("resume", (infos.resume ? infos.resume+" " : "")+p)} T={T} acc={acc}/>
                  )}
                </div>
                <div className="cr-form-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <label style={lbl}>Avancement (%)</label>
                    <input type="number" style={inp} value={infos.avancement} min={0} max={100} onChange={e=>updInfo("avancement",parseInt(e.target.value)||0)} placeholder="65" />
                    <div style={{marginTop:8,height:6,background:T.border,borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",background:acc.accent,borderRadius:3,width:`${Math.min(100,infos.avancement||0)}%`,transition:"width .3s"}}/>
                    </div>
                    <div style={{marginTop:4,fontSize:FONT.xs.size,color:T.textMuted,textAlign:"right"}}>{infos.avancement||0}%</div>
                  </div>
                  <div>
                    <label style={lbl}>Prochaine étape</label>
                    <input style={inp} value={infos.prochaine_etape} onChange={e=>updInfo("prochaine_etape",e.target.value)} placeholder="Pose carrelage S47" />
                  </div>
                </div>
              </div>
            )}

            {/* ── OBSERVATIONS ── */}
            {section==="obs" && (
              <div style={{maxWidth:880}}>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={AlertTriangle} size={11}/>
                  Observations & points de vigilance
                </div>
                {obs.map(o => (
                  <div key={o.id} className="obs-row" style={{display:"flex",gap:8,alignItems:"flex-start",marginBottom:8}}>
                    <select value={o.statut} onChange={e=>updObs(o.id,"statut",e.target.value)} style={{
                      ...inp, width:120, flexShrink:0, fontSize:FONT.xs.size+1, padding:"8px 10px",
                      color:STATUT_COLOR[o.statut]||T.text, fontWeight:700,
                    }}>
                      {STATUTS_OBS.map(s=><option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
                    </select>
                    <textarea value={o.texte} onChange={e=>updObs(o.id,"texte",e.target.value)} placeholder="Décris l'observation…" style={{...ta,minHeight:52,flex:1}}/>
                    <button onClick={()=>delObs(o.id)} title="Supprimer" style={{...btnD,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:"8px 10px",alignSelf:"flex-start"}}>
                      <Icon as={X} size={12}/>
                    </button>
                  </div>
                ))}
                <button onClick={ajoutObs} style={{
                  display:"flex",alignItems:"center",justifyContent:"center",gap:5,
                  width:"100%",padding:10,
                  border:`1.5px dashed ${T.border}`,borderRadius:RADIUS.md,
                  background:"none",color:T.textMuted,
                  fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:600,cursor:"pointer",
                }}>
                  <Icon as={Plus} size={12}/>
                  Ajouter une observation
                </button>
                {phrases.vigilance.length > 0 && (
                  <div style={{marginTop:14,padding:"12px 14px",background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.md}}>
                    <div style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size,fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",color:T.textMuted,marginBottom:8}}>
                      <Icon as={Lightbulb} size={11}/>
                      Suggestions
                    </div>
                    <PhrasesSuggestions phrases={phrases.vigilance} onPick={async(p)=>{
                      // Si la dernière observation est vide, on remplit. Sinon on en crée une nouvelle.
                      const last = obs[obs.length-1];
                      if (last && !last.texte) {
                        await updObs(last.id, "texte", p);
                      } else {
                        await ajoutObs();
                        // L'ajout est async — pour simplifier, on demande à l'utilisateur de re-cliquer
                      }
                    }} T={T} acc={acc}/>
                  </div>
                )}
              </div>
            )}

            {/* ── TRAVAUX ── */}
            {section==="travaux" && (
              <div style={{maxWidth:880}}>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Wrench} size={11}/>
                  Travaux à venir / Décisions prises
                </div>
                <textarea style={{...ta,minHeight:160}} value={infos.travaux} onChange={e=>updInfo("travaux",e.target.value)} placeholder="Décisions prises, travaux planifiés, délais…" />
              </div>
            )}

            {/* ── REMARQUES ── */}
            {section==="remarques" && (
              <div style={{maxWidth:880}}>
                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={MessageSquare} size={11}/>
                  Remarques complémentaires
                </div>
                <textarea style={{...ta,minHeight:140}} value={infos.remarques} onChange={e=>updInfo("remarques",e.target.value)} placeholder="Points à surveiller, messages au client…" />
                {phrases.visite_observation.length > 0 && (
                  <PhrasesSuggestions phrases={phrases.visite_observation} onPick={(p)=>updInfo("remarques", (infos.remarques ? infos.remarques+"\n" : "")+p)} T={T} acc={acc}/>
                )}
              </div>
            )}

            {/* ── PHOTOS ── */}
            {section==="photos" && (
              <div style={{maxWidth:880}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:8}}>
                  <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, display:"inline-flex", alignItems:"center", gap:6 }}>
                    <Icon as={Camera} size={11}/>
                    Photos
                    {photos.length>0 && <span style={{color:acc.accent}}>· {photos.length}</span>}
                    {uploadingPhotos > 0 && (
                      <span style={{display:"inline-flex",alignItems:"center",gap:4,color:"#f5a623",marginLeft:8,fontSize:11}}>
                        <svg width="11" height="11" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}>
                          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
                        </svg>
                        Upload {uploadingPhotos}…
                      </span>
                    )}
                  </div>
                  <label style={{
                    display:"inline-flex",alignItems:"center",gap:6,
                    background: uploadingPhotos > 0 ? T.border : acc.accent,
                    color: uploadingPhotos > 0 ? T.textMuted : acc.onAccent, border:"none",
                    borderRadius:RADIUS.md,padding:"9px 16px",cursor: uploadingPhotos > 0 ? "wait" : "pointer",
                    fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                    opacity: uploadingPhotos > 0 ? 0.6 : 1,
                  }}>
                    <Icon as={Camera} size={13}/>
                    {uploadingPhotos > 0 ? "Upload en cours…" : "Ajouter des photos"}
                    <input ref={photoInputRef} type="file" accept="image/*" multiple onChange={ajoutPhotos} style={{display:"none"}} disabled={uploadingPhotos > 0}/>
                  </label>
                </div>
                {photos.length === 0 ? (
                  <div style={{
                    background:T.card, border:`1px dashed ${T.border}`, borderRadius:RADIUS.xl,
                    padding:"40px 24px", textAlign:"center", color:T.textSub,
                  }}>
                    <div style={{
                      width:48,height:48,borderRadius:RADIUS.lg,
                      background:acc.bg10,color:acc.accent,
                      display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:12,
                    }}>
                      <Icon as={Camera} size={24} strokeWidth={1.5}/>
                    </div>
                    <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text,marginBottom:4}}>Aucune photo</div>
                    <div style={{fontSize:FONT.xs.size+1,lineHeight:1.6}}>Capture l'état du chantier — l'appareil photo s'ouvrira directement sur mobile.</div>
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
                    {photos.map(p => (
                      <div key={p.id} style={{
                        position:"relative",aspectRatio:"4/3",borderRadius:RADIUS.lg,overflow:"hidden",
                        background:T.card,border:`1px solid ${T.border}`,
                      }}>
                        <img src={p.data} alt={p.nom} loading="lazy"
                          style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                        <button onClick={()=>delPhoto(p.id)} title="Supprimer" style={{
                          position:"absolute",top:6,right:6,
                          display:"inline-flex",alignItems:"center",justifyContent:"center",
                          width:26,height:26,background:"rgba(0,0,0,0.65)",color:"#fff",border:"none",
                          borderRadius:"50%",cursor:"pointer",padding:0,
                        }}>
                          <Icon as={Trash2} size={11}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── IMPORT IA ── */}
            {section==="ia" && (
              <div style={{maxWidth:880}}>
                {/* Pré-remplissage depuis une visite chantier */}
                {visitesChantier.length > 0 && (
                  <>
                    <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                      <Icon as={ClipboardCheck} size={11}/>
                      Pré-remplir depuis une visite chantier
                    </div>
                    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:18,marginBottom:18}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                        <div style={{width:32,height:32,borderRadius:RADIUS.md,background:"rgba(91,156,246,0.16)",color:"#5b9cf6",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <Icon as={ClipboardCheck} size={16}/>
                        </div>
                        <div>
                          <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text}}>Récupérer une visite interne</div>
                          <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1}}>
                            Reprend la date, le résumé et les réserves comme observations.
                          </div>
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {visitesChantier.map(v => {
                          const audit = v.audit || {};
                          const toutes = Object.values(audit).flat();
                          const res = toutes.filter(t => t.statut === "reserve").length;
                          const nok = toutes.filter(t => t.statut === "nok").length;
                          return (
                            <div key={v.id} style={{
                              display:"flex",alignItems:"center",gap:10,
                              padding:"10px 12px",background:T.card,
                              border:`1px solid ${T.border}`,borderRadius:RADIUS.md,
                            }}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:FONT.sm.size,fontWeight:700,color:T.text}}>
                                  Visite du {v.date ? new Date(v.date).toLocaleDateString("fr-FR") : "—"}
                                </div>
                                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:2}}>
                                  <span>{toutes.length} points</span>
                                  {res>0 && <span style={{color:"#f5a623",fontWeight:700}}>· {res} réserves</span>}
                                  {nok>0 && <span style={{color:"#e15a5a",fontWeight:700}}>· {nok} NOK</span>}
                                </div>
                              </div>
                              <button onClick={()=>importerDepuisVisite(v.id)} disabled={importingVisite} style={{
                                display:"inline-flex",alignItems:"center",gap:5,
                                background:"rgba(91,156,246,0.12)",color:"#5b9cf6",
                                border:`1px solid rgba(91,156,246,0.3)`,
                                borderRadius:RADIUS.md,padding:"7px 12px",cursor:importingVisite?"not-allowed":"pointer",
                                fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,opacity:importingVisite?.6:1,
                              }}>
                                <Icon as={ChevronRight} size={11}/>
                                Pré-remplir
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                <div style={{ fontSize:FONT.xs.size, fontWeight:700, letterSpacing:1.2, textTransform:"uppercase", color:T.textMuted, marginBottom:12, display:"inline-flex", alignItems:"center", gap:6 }}>
                  <Icon as={Sparkles} size={11}/>
                  Import IA — Claude
                </div>
                <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:18,marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                    <div style={{
                      width:32,height:32,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,
                      display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                      <Icon as={Sparkles} size={16}/>
                    </div>
                    <div>
                      <div style={{fontSize:FONT.sm.size+1,fontWeight:700,color:T.text}}>Reformulation automatique</div>
                      <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1}}>Colle tes notes brutes — l'IA remplit tous les champs automatiquement.</div>
                    </div>
                  </div>
                  <textarea value={iaTexte} onChange={e=>setIaTexte(e.target.value)} placeholder="Notes de visite, dictée retranscrite, bullet points…" style={{...ta,minHeight:120}}/>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12}}>
                    <button onClick={processIA} disabled={iaLoading} style={{
                      display:"inline-flex",alignItems:"center",gap:6,
                      background:acc.accent,color:acc.onAccent,border:"none",
                      borderRadius:RADIUS.md,padding:"9px 18px",cursor:iaLoading?"not-allowed":"pointer",
                      fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,opacity:iaLoading?.6:1,
                    }}>
                      {iaLoading
                        ? <><svg width="13" height="13" viewBox="0 0 24 24" style={{animation:"spin 1s linear infinite"}}><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/></svg> Analyse…</>
                        : <><Icon as={Sparkles} size={13}/> Reformuler avec l'IA</>}
                    </button>
                    {iaStatus && (
                      <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:FONT.xs.size+1,color:iaStatus.ok?"#22c55e":"#e15a5a",fontWeight:600}}>
                        <Icon as={iaStatus.ok?Check:AlertTriangle} size={11}/>
                        {iaStatus.msg.replace(/✓ /, "")}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"12px 14px",background:acc.bg10,border:`1px solid ${acc.accent}33`,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.7}}>
                  <Icon as={Info} size={13} color={acc.accent} style={{marginTop:2,flexShrink:0}}/>
                  <span>L'IA détecte automatiquement : noms des clients, adresse, type de visite, résumé, observations avec niveaux d'alerte, travaux à venir et remarques.</span>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── MODAL ENVOI EMAIL ── */}
      {showEmail && (
        <div onClick={()=>!sending&&setShowEmail(false)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:0,
            width:"100%",maxWidth:560,maxHeight:"90vh",
            border:`1px solid ${T.border}`,overflow:"hidden",
            display:"flex",flexDirection:"column",
          }}>
            <div style={{padding:"18px 22px",borderBottom:`1px solid ${T.sectionDivider||T.border}`,display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:36,height:36,borderRadius:RADIUS.md,flexShrink:0,background:acc.bg10,color:acc.accent,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <Icon as={Send} size={18}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Envoyer le compte rendu</div>
                <div style={{fontSize:FONT.xs.size+1,color:T.textMuted,marginTop:1}}>Document Word généré et joint automatiquement</div>
              </div>
              <button onClick={()=>!sending&&setShowEmail(false)} disabled={sending} title="Fermer" style={{
                display:"inline-flex",alignItems:"center",justifyContent:"center",
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,width:32,height:32,cursor:sending?"not-allowed":"pointer",color:T.textSub,
              }}>
                <Icon as={X} size={14}/>
              </button>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"16px 22px",display:"flex",flexDirection:"column",gap:12}}>
              <div>
                <label style={lbl}>Destinataire(s) *</label>
                <input style={inp} value={emailDest} onChange={e=>setEmailDest(e.target.value)}
                  placeholder="client@example.com, autre@example.com"/>
                <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:4,fontStyle:"italic"}}>
                  Séparer plusieurs adresses par des virgules.
                </div>
              </div>
              <div>
                <label style={lbl}>Copie (CC)</label>
                <input style={inp} value={emailCc} onChange={e=>setEmailCc(e.target.value)}
                  placeholder="francois.huet@groupe-profero.com"/>
              </div>
              <div>
                <label style={lbl}>Sujet *</label>
                <input style={inp} value={emailSujet} onChange={e=>setEmailSujet(e.target.value)}/>
              </div>
              <div>
                <label style={lbl}>Message</label>
                <textarea style={{...ta,minHeight:140}} value={emailBody} onChange={e=>setEmailBody(e.target.value)}/>
              </div>
              <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"10px 12px",background:T.card,borderRadius:RADIUS.md,fontSize:FONT.xs.size+1,color:T.textMuted,lineHeight:1.6}}>
                <Icon as={Info} size={13} style={{marginTop:2,flexShrink:0}}/>
                <span>Une fois envoyé, le statut du CR passera automatiquement à <strong style={{color:"#22c55e"}}>Envoyé</strong>.</span>
              </div>
              {emailStatus && (
                <div style={{
                  display:"flex",alignItems:"center",gap:8,
                  padding:"10px 12px",borderRadius:RADIUS.md,
                  background: emailStatus.ok ? "rgba(34,197,94,0.12)" : "rgba(224,92,92,0.12)",
                  border: `1px solid ${emailStatus.ok ? "rgba(34,197,94,0.3)" : "rgba(224,92,92,0.3)"}`,
                  color: emailStatus.ok ? "#22c55e" : "#e15a5a",
                  fontSize:FONT.xs.size+1, fontWeight:600,
                }}>
                  <Icon as={emailStatus.ok ? Check : AlertTriangle} size={13}/>
                  {emailStatus.msg}
                </div>
              )}
            </div>
            <div style={{padding:"14px 22px",borderTop:`1px solid ${T.sectionDivider||T.border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowEmail(false)} disabled={sending} style={{
                padding:"9px 18px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,
                background:"transparent",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",opacity:sending?.5:1,
              }}>Annuler</button>
              <button onClick={handleSendEmail} disabled={sending} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:acc.accent,color:acc.onAccent,border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                cursor:sending?"not-allowed":"pointer",opacity:sending?.6:1,
              }}>
                <Icon as={Send} size={13}/>
                {sending ? "Envoi…" : "Envoyer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL SUPPRESSION ── */}
      {toDelete && (
        <div onClick={()=>!deleting&&setToDelete(null)} style={{
          position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)",
        }}>
          <div onClick={e=>e.stopPropagation()} style={{
            background:T.modal,borderRadius:RADIUS.xl,padding:24,
            width:"100%",maxWidth:420,border:`1px solid ${T.border}`,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
              <div style={{
                width:40,height:40,borderRadius:RADIUS.md,flexShrink:0,
                background:"rgba(224,92,92,0.12)",color:"#e15a5a",
                display:"flex",alignItems:"center",justifyContent:"center",
              }}>
                <Icon as={AlertTriangle} size={20}/>
              </div>
              <div style={{fontSize:FONT.lg.size,fontWeight:800,color:T.text}}>Supprimer ce compte rendu&nbsp;?</div>
            </div>
            <div style={{fontSize:FONT.sm.size,color:T.textSub,lineHeight:1.6,marginBottom:20}}>
              Le CR pour <strong style={{color:T.text}}>« {toDelete.client_nom1 || "Sans client"} »</strong> sera supprimé avec ses observations et ses photos.
              <br/><span style={{color:T.textMuted,fontSize:FONT.xs.size+1}}>Cette action est irréversible.</span>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setToDelete(null)} disabled={deleting} style={{
                background:"transparent",border:`1px solid ${T.border}`,
                borderRadius:RADIUS.md,padding:"9px 18px",color:T.textSub,
                fontFamily:"inherit",fontSize:FONT.sm.size,cursor:"pointer",opacity:deleting?.5:1,
              }}>Annuler</button>
              <button onClick={confirmSuppCR} disabled={deleting} style={{
                display:"inline-flex",alignItems:"center",gap:6,
                background:"#e15a5a",color:"#fff",border:"none",
                borderRadius:RADIUS.md,padding:"9px 18px",
                fontFamily:"inherit",fontSize:FONT.sm.size,fontWeight:800,
                cursor:"pointer",opacity:deleting?.6:1,
              }}>
                <Icon as={Trash2} size={13}/>
                {deleting?"Suppression…":"Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── COMPOSANT : SUGGESTIONS DE PHRASES ──────────────────────────────────────
function PhrasesSuggestions({ phrases, onPick, T, acc }) {
  if (!phrases || phrases.length === 0) return null;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>
      {phrases.map((p, i) => (
        <button key={i} onClick={()=>onPick(p)} title="Insérer dans le texte" style={{
          display:"inline-flex",alignItems:"center",gap:4,
          padding:"4px 9px",borderRadius:RADIUS.sm,
          border:`1px solid ${acc.accent}44`,background:acc.bg10,color:acc.accent,
          fontFamily:"inherit",fontSize:11,fontWeight:600,cursor:"pointer",
          maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
        }}>
          <Icon as={Plus} size={9}/>
          {p}
        </button>
      ))}
    </div>
  );
}
