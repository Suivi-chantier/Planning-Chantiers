import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const TYPES_VISITE = ["Visite de chantier","Réunion de suivi","Réception travaux","Constat contradictoire","Autre"];
const STATUTS_OBS  = ["ok","info","warn","urgent"];
const STATUT_LABEL = { ok:"Conforme", info:"Info", warn:"Attention", urgent:"Urgent" };
const STATUT_COLOR = { ok:"#2e7d32", info:"#1565c0", warn:"#e65100", urgent:"#c62828" };

export default function PageCompteRendu({ T }) {
  // ── État liste CRs ──
  const [crs, setCrs]           = useState([]);
  const [crId, setCrId]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  // ── Données CR courant ──
  const INFOS_VIDE = { client_prenom1:"", client_nom1:"", client_prenom2:"", client_nom2:"", adresse:"", date_visite: new Date().toISOString().split("T")[0], heure_visite: `${String(new Date().getHours()).padStart(2,"0")}:${String(new Date().getMinutes()).padStart(2,"0")}`, type_visite:"Visite de chantier", participants:"", resume:"", avancement:0, prochaine_etape:"", travaux:"", remarques:"" };
  const [infos, setInfos]       = useState(INFOS_VIDE);
  const [obs, setObs]           = useState([]);
  const [photos, setPhotos]     = useState([]);
  const [deuxiemeClient, setDeuxiemeClient] = useState(false);

  // ── UI ──
  const [section, setSection]   = useState("ia");
  const [iaTexte, setIaTexte]   = useState("");
  const [iaLoading, setIaLoading] = useState(false);
  const [iaStatus, setIaStatus] = useState(null); // {ok, msg}
  const photoInputRef           = useRef(null);
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
  useEffect(() => { chargerCRs(); }, []);

  // ── DATA ──
  async function chargerCRs() {
    setLoading(true);
    const { data } = await supabase.from("cr_comptes_rendus").select("*").order("created_at", { ascending:false });
    if (data) { setCrs(data); if (data.length > 0) chargerCR(data[0].id); else setLoading(false); }
    else setLoading(false);
  }

  async function chargerCR(id) {
    setLoading(true); setCrId(id);
    const [{ data:cr }, { data:o }, { data:ph }] = await Promise.all([
      supabase.from("cr_comptes_rendus").select("*").eq("id",id).single(),
      supabase.from("cr_observations").select("*").eq("cr_id",id).order("ordre"),
      supabase.from("cr_photos").select("*").eq("cr_id",id),
    ]);
    if (cr) {
      setInfos({ client_prenom1:cr.client_prenom1||"", client_nom1:cr.client_nom1||"", client_prenom2:cr.client_prenom2||"", client_nom2:cr.client_nom2||"", adresse:cr.adresse||"", date_visite:cr.date_visite||"", heure_visite:cr.heure_visite||"", type_visite:cr.type_visite||"Visite de chantier", participants:cr.participants||"", resume:cr.resume||"", avancement:cr.avancement||0, prochaine_etape:cr.prochaine_etape||"", travaux:cr.travaux||"", remarques:cr.remarques||"" });
      setDeuxiemeClient(!!(cr.client_prenom2 || cr.client_nom2));
    }
    setObs(o && o.length > 0 ? o : [{ id:"new_1", statut:"warn", texte:"", ordre:0 }]);
    setPhotos(ph || []);
    setLoading(false);
  }

  function debounce(fn, d=800) { if(saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current=setTimeout(fn,d); }

  async function saveInfos(v) {
    if (!crId) return; setSaving(true);
    await supabase.from("cr_comptes_rendus").update({...v, updated_at:new Date().toISOString()}).eq("id",crId);
    setSaving(false); setCrs(prev=>prev.map(c=>c.id===crId?{...c,...v}:c));
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

  // ── Photos ──
  async function ajoutPhotos(e) {
    Array.from(e.target.files).forEach(f => {
      const r = new FileReader();
      r.onload = async (ev) => {
        const data64 = ev.target.result;
        const { data } = await supabase.from("cr_photos").insert({ cr_id:crId, data:data64, nom:f.name }).select().single();
        setPhotos(p=>[...p, data || { id:`new_${Date.now()}`, data:data64, nom:f.name }]);
      };
      r.readAsDataURL(f);
    });
  }

  async function delPhoto(id) {
    if (!id.toString().startsWith("new_")) await supabase.from("cr_photos").delete().eq("id",id);
    setPhotos(p=>p.filter(ph=>ph.id!==id));
  }

  // ── Nouveau CR ──
  async function nouveauCR() {
    const nom = window.prompt("Nom du compte rendu :", `CR ${crs.length+1}`);
    if (!nom) return;
    const { data } = await supabase.from("cr_comptes_rendus").insert({ ...INFOS_VIDE, date_visite: new Date().toISOString().split("T")[0] }).select().single();
    if (data) {
      await supabase.from("cr_observations").insert({ cr_id:data.id, statut:"warn", texte:"", ordre:0 });
      setCrs(p=>[data,...p]); chargerCR(data.id);
    }
  }

  async function suppCR() {
    if (!crId || !window.confirm("Supprimer ce compte rendu ?")) return;
    await supabase.from("cr_comptes_rendus").delete().eq("id",crId);
    const r = crs.filter(c=>c.id!==crId); setCrs(r);
    if (r.length > 0) chargerCR(r[0].id);
    else { setCrId(null); setInfos(INFOS_VIDE); setObs([]); setPhotos([]); }
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
  function genPDF() {
    const clients = [infos.client_prenom1+" "+infos.client_nom1, deuxiemeClient ? infos.client_prenom2+" "+infos.client_nom2 : null].filter(Boolean);
    const dateStr = infos.date_visite ? new Date(infos.date_visite).toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}) : new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    const statusColors = { ok:"#2e7d32", info:"#1565c0", warn:"#b45309", urgent:"#c62828" };
    const statusLabels = { ok:"CONFORME", info:"INFO", warn:"ATTENTION", urgent:"URGENT" };

    const obsHtml = obs.filter(o=>o.texte).map(o=>`
      <div style="display:flex;gap:8pt;align-items:flex-start;margin-bottom:6pt;">
        <div style="background:${statusColors[o.statut]||"#888"};color:#fff;font-size:6.5pt;font-weight:700;padding:2pt 5pt;border-radius:3pt;flex-shrink:0;margin-top:1pt;letter-spacing:.05em;">${statusLabels[o.statut]||"NOTE"}</div>
        <div style="font-size:9pt;color:#333;line-height:1.5;">${o.texte.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
      </div>`).join("");

    const photosHtml = photos.length > 0 ? `
      <div style="margin-bottom:10pt;">
        <div style="display:flex;align-items:center;gap:6pt;margin-bottom:5pt;">
          <div style="width:3pt;height:11pt;background:#f5c400;border-radius:2pt;"></div>
          <span style="font-size:7.5pt;font-weight:700;color:#888;letter-spacing:.08em;">PHOTOS</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8pt;">
          ${photos.map(p=>`<img src="${p.data}" style="width:120pt;height:90pt;object-fit:cover;border-radius:5pt;border:1pt solid #ddd;" />`).join("")}
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

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
    <style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;background:#fff;color:#111;font-size:9pt;}
      @page{margin:14mm 16mm;size:A4;}
      @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
    </style></head><body>
    <!-- HEADER -->
    <div style="background:#0a0a0a;padding:14pt 18pt;display:flex;justify-content:space-between;align-items:center;margin-bottom:16pt;border-radius:5pt;">
      <div style="display:flex;align-items:center;gap:10pt;">
        <img src="data:image/jpeg;base64,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" style="height:40pt;width:40pt;object-fit:contain;border-radius:6pt;background:#fff;padding:3pt;" />
        <div>
          <div style="color:#f5c400;font-size:14pt;font-weight:700;letter-spacing:-.01em;">PROFERO</div>
          <div style="color:rgba(255,255,255,.45);font-size:8pt;margin-top:2pt;">Compte Rendu de Visite</div>
        </div>
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

    ${section("RÉSUMÉ & ÉTAT DU CHANTIER", infos.resume?.replace(/</g,"&lt;").replace(/>/g,"&gt;"))}
    ${infos.prochaine_etape ? `<div style="background:#fff9e6;border-left:3pt solid #f5c400;padding:8pt 12pt;border-radius:4pt;margin-bottom:10pt;font-size:9pt;color:#333;"><strong style="color:#9a7a00;">Prochaine étape :</strong> ${infos.prochaine_etape.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>` : ""}

    ${obs.some(o=>o.texte) ? `
    <div style="margin-bottom:10pt;">
      <div style="display:flex;align-items:center;gap:6pt;margin-bottom:5pt;">
        <div style="width:3pt;height:11pt;background:#f5c400;border-radius:2pt;"></div>
        <span style="font-size:7.5pt;font-weight:700;color:#888;letter-spacing:.08em;">OBSERVATIONS & POINTS DE VIGILANCE</span>
      </div>
      <div style="height:0.5pt;background:#eee;margin-bottom:8pt;"></div>
      ${obsHtml}
    </div>` : ""}

    ${section("TRAVAUX À VENIR / DÉCISIONS PRISES", infos.travaux?.replace(/</g,"&lt;").replace(/>/g,"&gt;"))}
    ${section("REMARQUES COMPLÉMENTAIRES", infos.remarques?.replace(/</g,"&lt;").replace(/>/g,"&gt;"))}
    ${photosHtml}

    <!-- SIGNATURE -->
    <div style="margin-top:16pt;padding-top:10pt;border-top:0.5pt solid #ccc;display:flex;justify-content:space-between;">
      <div>
        <p style="font-size:8pt;color:#888;margin-bottom:22pt;">Document établi par :</p>
        <div style="width:100pt;border-top:0.5pt solid #bbb;margin-bottom:5pt;"></div>
        <p style="font-size:9pt;font-weight:700;">Responsable PROFERO</p>
      </div>
      <div style="text-align:right;">
        <p style="font-size:8pt;color:#888;margin-bottom:22pt;">Lu et approuvé :</p>
        <div style="width:100pt;border-top:0.5pt solid #bbb;margin-bottom:5pt;margin-left:auto;"></div>
        <p style="font-size:9pt;font-weight:700;">${(clients[0]||"Client")}</p>
        <p style="font-size:7.5pt;color:#888;">Signature</p>
      </div>
    </div>

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

  // ── RENDU ──
  if (loading) return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:bg,color:accent,fontSize:16,fontWeight:700}}>Chargement…</div>;

  const NAV_ITEMS = [
    { id:"ia",      label:"Import IA",      icon:"✦" },
    { id:"client",  label:"Client",         icon:"👤" },
    { id:"visite",  label:"Visite",         icon:"📅" },
    { id:"avanc",   label:"Avancement",     icon:"📈" },
    { id:"obs",     label:"Observations",   icon:"⚠️" },
    { id:"travaux", label:"Travaux",        icon:"🔧" },
    { id:"photos",  label:"Photos",         icon:"📷" },
    { id:"rem",     label:"Remarques",      icon:"📝" },
  ];

  return (
    <div style={{ display:"flex", height:"100%", background:bg, overflow:"hidden" }}>

      {/* ── LISTE CRs ── */}
      <div style={{ width:220, flexShrink:0, display:"flex", flexDirection:"column", background:surface, borderRight:`1px solid ${border}` }}>
        <div style={{ padding:"14px 16px", borderBottom:`1px solid ${border}`, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:12, fontWeight:800, color:accent, textTransform:"uppercase", letterSpacing:1 }}>
                Comptes rendus {saving && <span style={{fontSize:10,opacity:.6}}>💾</span>}
              </div>
              <div style={{ fontSize:11, color:textSub, marginTop:1 }}>{crs.length} CR{crs.length>1?"s":""}</div>
            </div>
            <div style={{ display:"flex", gap:5 }}>
              <button style={{...btn,padding:"5px 10px",fontSize:13}} onClick={nouveauCR} title="Nouveau">＋</button>
              <button style={{...btnD,padding:"5px 8px"}} onClick={suppCR} title="Supprimer">🗑</button>
            </div>
          </div>
        </div>
        <div style={{ flex:1, overflowY:"auto", padding:8 }}>
          {crs.length===0 && <div style={{color:textSub,fontSize:12,textAlign:"center",marginTop:24,lineHeight:1.8}}>Aucun compte rendu<br/><button style={{...btn,marginTop:8,fontSize:11}} onClick={nouveauCR}>Créer</button></div>}
          {crs.map(c => {
            const act = c.id===crId;
            const nomClient = c.client_nom1 ? `${c.client_prenom1||""} ${c.client_nom1}`.trim() : "Sans client";
            return (
              <div key={c.id} onClick={()=>chargerCR(c.id)} style={{ padding:"10px 12px", borderRadius:8, marginBottom:6, cursor:"pointer", background:act?accent:card, border:`1px solid ${act?accent:border}`, borderLeft:`3px solid ${accent}`, transition:"all .12s" }}>
                <div style={{ fontSize:13, fontWeight:700, color:act?"#000":text }}>{nomClient}</div>
                <div style={{ fontSize:11, marginTop:2, color:act?"rgba(0,0,0,0.55)":textSub }}>
                  {c.type_visite || "Visite"} {c.date_visite ? `· ${new Date(c.date_visite).toLocaleDateString("fr-FR")}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONTENU ── */}
      {!crId ? (
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:textSub}}>
          <div style={{fontSize:52,opacity:.2}}>📋</div>
          <div style={{fontSize:15,fontWeight:700}}>Sélectionne ou crée un compte rendu</div>
          <button style={btn} onClick={nouveauCR}>➕ Nouveau CR</button>
        </div>
      ) : (
        <div style={{ flex:1, display:"flex", overflow:"hidden", minWidth:0 }}>

          {/* ── NAV INTERNE ── */}
          <div style={{ width:160, flexShrink:0, background:surface, borderRight:`1px solid ${border}`, padding:"12px 8px", overflowY:"auto" }}>
            <div style={{ fontSize:10, fontWeight:700, color:textSub, textTransform:"uppercase", letterSpacing:.8, padding:"0 6px", marginBottom:8 }}>Sections</div>
            {NAV_ITEMS.map(n => (
              <button key={n.id} style={sec(n.id)} onClick={()=>setSection(n.id)}>
                <span style={{fontSize:14}}>{n.icon}</span>
                <span style={{fontSize:12}}>{n.label}</span>
              </button>
            ))}
            <div style={{ borderTop:`1px solid ${border}`, marginTop:10, paddingTop:10 }}>
              <button style={{...btn, width:"100%", justifyContent:"center", fontSize:12, display:"flex", alignItems:"center", gap:6}} onClick={genPDF}>
                ↓ PDF
              </button>
            </div>
          </div>

          {/* ── FORMULAIRE ── */}
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", background:bg }}>

            {/* ─ IA ─ */}
            {section==="ia" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>✦ Import IA</div>
                <div style={{ background:"#0d0f12", border:`1px solid ${border}`, borderRadius:10, padding:"18px 20px", marginBottom:14 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
                    <div style={{ width:34, height:34, background:accent, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>✦</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:text }}>Reformulation IA — Claude</div>
                      <div style={{ fontSize:11, color:textSub, marginTop:2 }}>Colle tes notes brutes — l'IA remplit tous les champs automatiquement</div>
                    </div>
                  </div>
                  <textarea value={iaTexte} onChange={e=>setIaTexte(e.target.value)} placeholder="Notes de visite, dictée retranscrite, bullet points..." style={{ ...ta, background:"#1a1d24", minHeight:100 }} />
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
                    <button style={{ ...btn, opacity: iaLoading ? .6 : 1 }} onClick={processIA} disabled={iaLoading}>
                      {iaLoading ? "Analyse en cours…" : "Reformuler avec l'IA"}
                    </button>
                    {iaLoading && <div style={{ width:14, height:14, border:"2px solid rgba(255,195,0,.2)", borderTopColor:accent, borderRadius:"50%", animation:"spin .7s linear infinite" }} />}
                    {iaStatus && <span style={{ fontSize:12, color:iaStatus.ok?"#4caf50":"#e05c5c", fontWeight:600 }}>{iaStatus.msg}</span>}
                  </div>
                </div>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <div style={{ background:`rgba(255,195,0,0.06)`, border:`1px solid rgba(255,195,0,0.15)`, borderRadius:8, padding:"12px 16px", fontSize:12, color:textSub, lineHeight:1.7 }}>
                  💡 L'IA détecte automatiquement : noms des clients, adresse, type de visite, résumé, observations avec niveaux d'alerte, travaux à venir et remarques.
                </div>
              </div>
            )}

            {/* ─ CLIENT ─ */}
            {section==="client" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>👤 Informations client</div>
                <div style={cardS}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:10 }}>
                    <div><label style={lbl}>Prénom</label><input style={inp} value={infos.client_prenom1} onChange={e=>updInfo("client_prenom1",e.target.value)} placeholder="Jean" /></div>
                    <div><label style={lbl}>Nom</label><input style={inp} value={infos.client_nom1} onChange={e=>updInfo("client_nom1",e.target.value)} placeholder="Dupont" /></div>
                  </div>
                  <div><label style={lbl}>Adresse du chantier</label><input style={inp} value={infos.adresse} onChange={e=>updInfo("adresse",e.target.value)} placeholder="14 Bd du Roi René, 49000 Angers" /></div>

                  {!deuxiemeClient ? (
                    <button onClick={()=>setDeuxiemeClient(true)} style={{ background:"none", border:"none", color:accent, fontFamily:"inherit", fontSize:12, fontWeight:600, cursor:"pointer", marginTop:12, padding:0 }}>+ Ajouter un second client</button>
                  ) : (
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>
                      <div><label style={lbl}>Prénom (2)</label><input style={inp} value={infos.client_prenom2} onChange={e=>updInfo("client_prenom2",e.target.value)} placeholder="Marie" /></div>
                      <div><label style={lbl}>Nom (2)</label><input style={inp} value={infos.client_nom2} onChange={e=>updInfo("client_nom2",e.target.value)} placeholder="Martin" /></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─ VISITE ─ */}
            {section==="visite" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>📅 Détails de la visite</div>
                <div style={cardS}>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:12 }}>
                    <div><label style={lbl}>Date</label><input type="date" style={inp} value={infos.date_visite} onChange={e=>updInfo("date_visite",e.target.value)} /></div>
                    <div><label style={lbl}>Heure</label><input type="time" style={inp} value={infos.heure_visite} onChange={e=>updInfo("heure_visite",e.target.value)} /></div>
                    <div>
                      <label style={lbl}>Type</label>
                      <select style={inp} value={infos.type_visite} onChange={e=>updInfo("type_visite",e.target.value)}>
                        {TYPES_VISITE.map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div><label style={lbl}>Participants</label><input style={inp} value={infos.participants} onChange={e=>updInfo("participants",e.target.value)} placeholder="Loris BESSONNEAU (PROFERO), client..." /></div>
                </div>
              </div>
            )}

            {/* ─ AVANCEMENT ─ */}
            {section==="avanc" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>📈 Avancement général</div>
                <div style={cardS}>
                  <div style={{ marginBottom:14 }}>
                    <label style={lbl}>Résumé</label>
                    <textarea style={{...ta,minHeight:90}} value={infos.resume} onChange={e=>updInfo("resume",e.target.value)} placeholder="État du chantier, travaux réalisés..." />
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                    <div>
                      <label style={lbl}>Avancement (%)</label>
                      <input type="number" style={inp} value={infos.avancement} min={0} max={100} onChange={e=>updInfo("avancement",parseInt(e.target.value)||0)} placeholder="65" />
                      <div style={{ marginTop:8, height:6, background:border, borderRadius:3, overflow:"hidden" }}>
                        <div style={{ height:"100%", background:accent, borderRadius:3, width:`${Math.min(100,infos.avancement||0)}%`, transition:"width .3s" }} />
                      </div>
                      <div style={{ marginTop:4, fontSize:11, color:textSub, textAlign:"right" }}>{infos.avancement||0}%</div>
                    </div>
                    <div>
                      <label style={lbl}>Prochaine étape</label>
                      <input style={inp} value={infos.prochaine_etape} onChange={e=>updInfo("prochaine_etape",e.target.value)} placeholder="Pose carrelage S47" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─ OBSERVATIONS ─ */}
            {section==="obs" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>⚠️ Observations & points de vigilance</div>
                <div style={cardS}>
                  {obs.map(o => (
                    <div key={o.id} style={{ display:"flex", gap:8, alignItems:"flex-start", marginBottom:8 }}>
                      <select value={o.statut} onChange={e=>updObs(o.id,"statut",e.target.value)} style={{ ...inp, width:120, flexShrink:0, fontSize:12, padding:"8px 10px", color: STATUT_COLOR[o.statut]||text, fontWeight:700 }}>
                        {STATUTS_OBS.map(s=><option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
                      </select>
                      <textarea value={o.texte} onChange={e=>updObs(o.id,"texte",e.target.value)} placeholder="Décris l'observation..." style={{ ...ta, minHeight:52, flex:1 }} />
                      <button style={{ ...btnD, padding:"8px 10px", alignSelf:"flex-start" }} onClick={()=>delObs(o.id)}>×</button>
                    </div>
                  ))}
                  <button onClick={ajoutObs} style={{ width:"100%", padding:"10px", border:`1.5px dashed ${border}`, borderRadius:7, background:"none", color:textSub, fontFamily:"inherit", fontSize:12, fontWeight:500, cursor:"pointer", marginTop:4, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=accent;e.currentTarget.style.color=accent;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=border;e.currentTarget.style.color=textSub;}}>
                    + Ajouter une observation
                  </button>
                </div>
              </div>
            )}

            {/* ─ TRAVAUX ─ */}
            {section==="travaux" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>🔧 Travaux à venir / Décisions prises</div>
                <div style={cardS}>
                  <textarea style={{...ta,minHeight:120}} value={infos.travaux} onChange={e=>updInfo("travaux",e.target.value)} placeholder="Décisions prises, travaux planifiés, délais..." />
                </div>
              </div>
            )}

            {/* ─ PHOTOS ─ */}
            {section==="photos" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>📷 Photos jointes</div>
                <div style={cardS}>
                  <input ref={photoInputRef} type="file" multiple accept="image/*" onChange={ajoutPhotos} style={{display:"none"}} />
                  <div onClick={()=>photoInputRef.current.click()} style={{ border:`1.5px dashed ${border}`, borderRadius:8, padding:"20px", textAlign:"center", cursor:"pointer", color:textSub, fontSize:12, marginBottom:12 }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=accent;e.currentTarget.style.color=accent;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=border;e.currentTarget.style.color=textSub;}}>
                    <div style={{fontSize:24,marginBottom:6}}>📷</div>
                    Ajouter des photos
                    <p style={{fontSize:10,color:textSub,marginTop:3}}>Galerie ou appareil photo</p>
                  </div>
                  {photos.length > 0 && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                      {photos.map(p => (
                        <div key={p.id} style={{ position:"relative" }}>
                          <img src={p.data} alt={p.nom} style={{ width:90, height:90, objectFit:"cover", borderRadius:8, border:`1px solid ${border}`, display:"block" }} />
                          <button onClick={()=>delPhoto(p.id)} style={{ position:"absolute", top:-6, right:-6, width:20, height:20, background:"#e05c5c", color:"#fff", border:"none", borderRadius:"50%", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─ REMARQUES ─ */}
            {section==="rem" && (
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:accent, marginBottom:16 }}>📝 Remarques complémentaires</div>
                <div style={cardS}>
                  <textarea style={{...ta,minHeight:100}} value={infos.remarques} onChange={e=>updInfo("remarques",e.target.value)} placeholder="Points à surveiller, messages au client..." />
                </div>
                <button style={{ ...btn, display:"flex", alignItems:"center", gap:8, fontSize:13, padding:"11px 20px" }} onClick={genPDF}>
                  ↓ Générer & imprimer le PDF
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
