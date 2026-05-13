import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, LOGO_RENO_H, LOGO_RENO_V, getCurrentWeek, getWeekId, getTodayJour } from "./constants";
import BesoinCommandeDrawer from "./BesoinCommandeDrawer";

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
      to:["suivi.chantier@groupe-profero.com"],
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
  const inputRef = React.useRef(null);

  const onFiles = async (files) => {
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
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (i) => onChange((photos || []).filter((_, idx) => idx !== i));

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,flexWrap:"wrap"}}>
        <span style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color}}>
          📷 {label}{(photos?.length||0) > 0 ? ` · ${photos.length}` : ""}
        </span>
        {uploading > 0 && (
          <span style={{fontSize:11,color:"#f5a623",fontWeight:600}}>Upload… {uploading}</span>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{
          background:"rgba(224,92,92,0.10)",border:"1px solid rgba(224,92,92,0.35)",
          borderRadius:8,padding:"8px 10px",marginBottom:8,fontSize:12,color:"#c33",
        }}>
          <div style={{fontWeight:700,marginBottom:4}}>
            ⚠ {errors.length} photo{errors.length>1?"s":""} non envoyée{errors.length>1?"s":""}
          </div>
          {errors.slice(0,3).map((e,i) => (
            <div key={i} style={{fontSize:11,opacity:0.85,marginTop:2}}>
              • {e.name} — {e.msg}
            </div>
          ))}
          {errors.length > 3 && <div style={{fontSize:11,opacity:0.8,marginTop:2}}>+ {errors.length-3} autres</div>}
          <button onClick={()=>{setErrors([]); inputRef.current?.click();}} style={{
            marginTop:6,padding:"5px 10px",borderRadius:6,border:"1px solid #c33",
            background:"transparent",color:"#c33",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
          }}>Réessayer</button>
        </div>
      )}
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {(photos || []).map((url, i) => (
          <div key={i} style={{position:"relative",width:72,height:72,borderRadius:8,overflow:"hidden",
            border:`1.5px solid ${color}33`,background:"#f4f6fa"}}>
            <img src={url} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
              onClick={()=>window.open(url,"_blank")} />
            <button onClick={()=>remove(i)} style={{position:"absolute",top:2,right:2,
              background:"rgba(0,0,0,0.6)",border:"none",color:"#fff",borderRadius:"50%",
              width:20,height:20,cursor:"pointer",fontSize:11,padding:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
          </div>
        ))}
        <label style={{
          width:72,height:72,borderRadius:8,border:`1.5px dashed ${color}66`,cursor:"pointer",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,
          background:`${color}0A`,color,fontSize:11,fontWeight:600,fontFamily:"inherit",
        }}>
          <span style={{fontSize:20,lineHeight:1}}>＋</span>
          <span>Ajouter</span>
          <input ref={inputRef} type="file" accept="image/*" multiple capture="environment"
            onChange={e=>onFiles(e.target.files)} style={{display:"none"}} />
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
  const [remarque, setRemarque]     = useState("");
  const [paniers, setPaniers]       = useState({});      // { chantier_id: { articleId: {article, qty} } }
  const [besoinDrawer, setBesoinDrawer] = useState(null); // chantier_id du drawer ouvert
  const [photosChantier, setPhotosChantier] = useState({}); // { chantier_id: [url, ...] }
  const [submitting, setSubmitting] = useState(false);
  const [planData, setPlanData]     = useState(null);

  const today    = new Date();
  const dateStr  = today.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  const dateKey  = today.toLocaleDateString("fr-FR");
  const {year, week} = getCurrentWeek();
  const weekId   = getWeekId(year, week);
  const todayJour = getTodayJour();
  // Cible d'heures par jour : 10h Lun-Mer, 9h Jeu-Ven (utilisé partout : UI + validation)
  const cibleHeures = (todayJour === "Jeudi" || todayJour === "Vendredi") ? 9 : 10;

  // Load config + planning
  useEffect(() => {
    const load = async () => {
      const { data: cfg } = await supabase.from("planning_config").select("*");
      if (cfg?.length) {
        cfg.forEach(r => {
          if (r.key === "chantiers") setChantiers(r.value);
          if (r.key === "ouvriers")  setOuvriers(r.value);
        });
      }
    };
    load();
  }, []);

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
    localStorage.setItem("mon_prenom", ouvrier.trim());
    loadTaches(ouvrier.trim());
  };

  const setStatut         = (idx, statut) => setTaches(t => t.map((x,i) => i===idx ? {...x, statut} : x));
  const setTacheRemarque  = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, remarque:val} : x));
  const setTachePlanifie  = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, planifie:val} : x));
  const setTacheHeures    = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, heures_reelles:val} : x));
  const setTacheAvancement= (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, avancement:val} : x));
  const setTachePhotos    = (idx, val)    => setTaches(t => t.map((x,i) => i===idx ? {...x, photos:val} : x));
  const addTacheLibre     = ()            => setTaches(t => [...t, {chantier_id:"",chantier_nom:"",chantier_couleur:"#c8d8f0",planifie:"",statut:null,remarque:"",photos:[],libre:true}]);

  const soumettre = async () => {
    const tachesRemplies = taches.filter(t => t.planifie.trim());
    if (tachesRemplies.length === 0) { alert("Aucune tâche à soumettre."); return; }
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
    // Cible exacte : tâches + trajets = 10h Lun-Mer ou 9h Jeu-Ven
    const totalTachesHSubmit  = tachesRemplies.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
    const trajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
    const totalSubmit = totalTachesHSubmit + trajetMin / 60;
    if (Math.abs(totalSubmit - cibleHeures) > 0.01) {
      const ecart = totalSubmit - cibleHeures;
      const fmtH = (n) => n.toFixed(2).replace(/\.?0+$/, "");
      alert(
        `⏱ Total : ${fmtH(totalSubmit)}h / ${cibleHeures}h attendues\n\n` +
        `Le total (tâches + trajets) doit faire exactement ${cibleHeures}h ce ${todayJour}.\n\n` +
        (ecart < 0
          ? `Il manque ${fmtH(-ecart)}h — ajoute du temps de tâche ou de trajet.`
          : `Tu dépasses de ${fmtH(ecart)}h — réduis tes heures de tâche ou de trajet.`)
      );
      return;
    }

    setSubmitting(true);

    // Regrouper par chantier
    const parChantier = {};
    tachesRemplies.forEach(t => {
      const k = t.chantier_id || "divers";
      if (!parChantier[k]) parChantier[k] = { chantier_id:t.chantier_id, chantier_nom:t.chantier_nom||"Divers", taches:[] };
      parChantier[k].taches.push({
        planifie:t.planifie,
        statut:t.statut||"non_faite",
        remarque:t.remarque,
        heures_reelles:parseFloat(t.heures_reelles)||0,
        avancement:parseInt(t.avancement)||0,
        photos: t.photos || [],
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
        remarque,
        photos_chantier: photosCh,
        trajet_matin_min: parseInt(trajetMatin) || 0,
        trajet_soir_min: parseInt(trajetSoir) || 0,
      };
      // Insert avec retry : si une colonne optionnelle manque, on la drop
      // (pattern déjà utilisé pour photos_chantier — ici on étend à trajet_*).
      let payload = { ...rapportFull };
      const optionalCols = ["trajet_matin_min", "trajet_soir_min", "photos_chantier"];
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

    setSubmitting(false);
    setStep("done");
  };

  const progress = taches.filter(t=>t.statut!==null).length;
  const total    = taches.length;

  const S = {
    wrap:  { minHeight:"100vh", background:"#f4f6fa", fontFamily:"'Barlow Condensed','Arial Narrow',sans-serif" },
    header:{ background:"#16181d", padding:"16px 20px 14px", position:"sticky", top:0, zIndex:10, borderBottom:"2px solid #FFC200" },
    card:  { background:"#fff", borderRadius:14, padding:"18px 16px", margin:"12px 16px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" },
    label: { fontSize:11, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:"#8a9ab0", marginBottom:8, display:"block" },
    input: { width:"100%", border:"1.5px solid #e0e4ef", borderRadius:10, padding:"14px 14px", fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box" },
    btn:   (color,bg) => ({ width:"100%", padding:"16px", border:"none", borderRadius:12, fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:bg, color:color, marginTop:8 }),
  };

  // ── STEP: LOGIN ──
  if (step === "login") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:11,letterSpacing:3,textTransform:"uppercase",color:"rgba(255,255,255,0.4)",marginBottom:4}}>Planning Pro</div>
        <img src={LOGO_RENO_H} alt="Profero Rénovation" style={{height:44,objectFit:"contain",objectPosition:"left",marginBottom:6}}/>
        <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Mon compte rendu</div>
        <div style={{fontSize:14,color:"rgba(255,255,255,0.5)",marginTop:4}}>{dateStr}</div>
      </div>
      <div style={{...S.card, marginTop:32}}>
        <span style={S.label}>C'est qui ?</span>
        <div style={{display:"flex",flexWrap:"wrap",gap:10,marginBottom:16}}>
          {ouvriers.map(o => (
            <button key={o} onClick={()=>setOuvrier(o)} style={{
              padding:"10px 18px",borderRadius:10,fontSize:15,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",border:"2px solid",transition:"all .12s",
              background: ouvrier===o ? "#FFC200" : "#f4f6fa",
              borderColor: ouvrier===o ? "#FFC200" : "#e0e4ef",
              color: "#111",
            }}>{o}</button>
          ))}
        </div>
        <div style={{fontSize:13,color:"#8a9ab0",marginBottom:8}}>Ou saisis ton prénom :</div>
        <input style={S.input} value={ouvrier} onChange={e=>setOuvrier(e.target.value)}
          placeholder="Ton prénom…" onKeyDown={e=>e.key==="Enter"&&confirmerPrenom()}/>
        <button onClick={confirmerPrenom} disabled={!ouvrier.trim()} style={{
          ...S.btn("#111","#FFC200"), opacity:ouvrier.trim()?1:0.4, marginTop:16,
          boxShadow:"0 4px 16px rgba(255,194,0,0.25)"
        }}>C'est parti →</button>
      </div>
    </div>
  );

  // ── STEP: DONE ──
  if (step === "done") return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{fontSize:22,fontWeight:800,color:"#fff"}}>Mon compte rendu</div>
      </div>
      <div style={{...S.card, textAlign:"center", padding:"40px 24px", marginTop:32}}>
        <div style={{fontSize:56,marginBottom:16}}>✅</div>
        <div style={{fontSize:22,fontWeight:800,color:"#1a1f2e",marginBottom:8}}>Compte rendu envoyé !</div>
        <div style={{fontSize:15,color:"#8a9ab0",lineHeight:1.6,marginBottom:28}}>
          Merci {ouvrier}. Ton compte rendu du {dateKey} a bien été enregistré.
        </div>
        <button onClick={()=>{setStep("rapport");setTaches([]);loadTaches(ouvrier);}} style={{...S.btn("#fff","#1a1f2e")}}>
          Voir mes tâches
        </button>
      </div>
    </div>
  );

  // ── STEP: RAPPORT ──
  const faites   = taches.filter(t=>t.statut==="faite").length;
  const enCours  = taches.filter(t=>t.statut==="en_cours").length;
  const nonFaite = taches.filter(t=>t.statut==="non_faite").length;

  // Total journée = tâches + trajet matin + trajet soir (trajets en minutes)
  const totalTachesH = taches.reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const totalTrajetMin = (parseInt(trajetMatin) || 0) + (parseInt(trajetSoir) || 0);
  const totalJourneeH = totalTachesH + totalTrajetMin / 60;
  const matchCible = Math.abs(totalJourneeH - cibleHeures) < 0.01;
  const ecartH = totalJourneeH - cibleHeures; // négatif si manque, positif si dépasse

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <img src={LOGO_RENO_V} alt="Profero" style={{height:40,objectFit:"contain",objectPosition:"left",marginBottom:4}}/>
            <div style={{fontSize:13,color:"#FFC200",fontWeight:700,marginBottom:1}}>Bonjour {ouvrier} 👋</div>
            <div style={{fontSize:18,fontWeight:800,color:"#fff"}}>{dateStr}</div>
          </div>
          <button onClick={()=>setStep("login")} style={{background:"rgba(255,194,0,0.1)",border:"1px solid rgba(255,194,0,0.3)",
            borderRadius:8,padding:"6px 12px",color:"#FFC200",fontSize:13,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
            Changer
          </button>
        </div>
        {total>0 && (
          <div style={{marginTop:12}}>
            <div style={{display:"flex",gap:8,marginBottom:6}}>
              {faites>0&&<span style={{background:"rgba(80,200,120,0.2)",color:"#7ee8a2",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>✅ {faites} faite{faites>1?"s":""}</span>}
              {enCours>0&&<span style={{background:"rgba(245,166,35,0.2)",color:"#f5a623",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>🔄 {enCours}</span>}
              {nonFaite>0&&<span style={{background:"rgba(224,92,92,0.2)",color:"#ff8888",borderRadius:6,padding:"3px 10px",fontSize:13,fontWeight:700}}>❌ {nonFaite}</span>}
            </div>
            <div style={{background:"rgba(255,255,255,0.1)",borderRadius:4,height:4}}>
              <div style={{background:"#50c878",height:4,borderRadius:4,width:`${(progress/total)*100}%`,transition:"width .3s"}}/>
            </div>
          </div>
        )}
      </div>

      {/* ── Bandeau règles à respecter ── */}
      <div style={{
        ...S.card,
        background:"#fff8e1",
        borderLeft:"4px solid #FFC200",
        padding:"14px 16px",
      }}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",color:"#b88800",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
          📋 Avant de valider ton compte rendu
        </div>
        <ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:8}}>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:14,color:"#1a1f2e",lineHeight:1.4}}>
            <span style={{flexShrink:0,fontSize:16,lineHeight:1.3}}>⏱</span>
            <span>
              Le total de tes heures (tâches + trajets) doit faire <strong style={{color:"#b88800"}}>{cibleHeures}h</strong>
              {" "}({todayJour === "Jeudi" || todayJour === "Vendredi" ? "le jeudi et le vendredi" : "du lundi au mercredi"}).
            </span>
          </li>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:14,color:"#1a1f2e",lineHeight:1.4}}>
            <span style={{flexShrink:0,fontSize:16,lineHeight:1.3}}>❌</span>
            <span>
              Si une tâche n'a pas été réalisée ou est en cours, <strong>explique pourquoi</strong> dans la remarque.
            </span>
          </li>
          <li style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:14,color:"#1a1f2e",lineHeight:1.4}}>
            <span style={{flexShrink:0,fontSize:16,lineHeight:1.3}}>📷</span>
            <span>
              Merci de prendre <strong>au moins une photo par tâche</strong> pour qu'on puisse suivre l'avancement.
            </span>
          </li>
        </ul>
      </div>

      {/* ── Compteur total journée ── */}
      {(() => {
        const col = matchCible ? "#50c878" : Math.abs(ecartH) > 1 ? "#e05c5c" : "#f5a623";
        const bg  = matchCible ? "rgba(80,200,120,0.10)" : Math.abs(ecartH) > 1 ? "rgba(224,92,92,0.08)" : "rgba(245,166,35,0.10)";
        const bdr = matchCible ? "rgba(80,200,120,0.40)" : Math.abs(ecartH) > 1 ? "rgba(224,92,92,0.40)" : "rgba(245,166,35,0.40)";
        const pct = Math.min(100, (totalJourneeH / cibleHeures) * 100);
        return (
          <div style={{
            ...S.card, background:bg, border:`1.5px solid ${bdr}`, padding:"14px 16px",
            position:"sticky", top:8, zIndex:10,
          }}>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8,marginBottom:8}}>
              <div style={{fontSize:11,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",color:col}}>
                ⏱ Total de ma journée
              </div>
              <div style={{fontSize:24,fontWeight:800,color:col,letterSpacing:-0.5,lineHeight:1}}>
                {totalJourneeH.toFixed(2).replace(/\.?0+$/,"")}h
                <span style={{fontSize:14,color:"#8a9ab0",fontWeight:600,marginLeft:4}}>/ {cibleHeures}h</span>
              </div>
            </div>
            <div style={{height:6,background:"rgba(0,0,0,0.06)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${pct}%`,background:col,borderRadius:3,transition:"width .3s"}}/>
            </div>
            <div style={{fontSize:12,color:col,marginTop:6,fontWeight:600}}>
              {matchCible
                ? "✓ Tu peux soumettre ton compte rendu"
                : ecartH < 0
                  ? `Il manque ${(-ecartH).toFixed(2).replace(/\.?0+$/,"")}h pour atteindre la cible`
                  : `Tu dépasses de ${ecartH.toFixed(2).replace(/\.?0+$/,"")}h — réduis tes heures de tâches ou de trajet`}
            </div>
            <div style={{fontSize:11,color:"#8a9ab0",marginTop:4}}>
              {totalTachesH.toFixed(2).replace(/\.?0+$/,"")}h de tâches
              {totalTrajetMin > 0 && ` + ${totalTrajetMin} min de trajet (${(totalTrajetMin/60).toFixed(2).replace(/\.?0+$/,"")}h)`}
            </div>
          </div>
        );
      })()}

      {/* ── Mon temps de trajet ── */}
      <div style={{...S.card, borderLeft:"4px solid #5b8af5", padding:"14px 16px"}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:1.5,textTransform:"uppercase",color:"#3060c0",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
          🚗 Mon temps de trajet
        </div>
        {[
          { label:"Trajet matin (aller)", value:trajetMatin, setter:setTrajetMatin, color:"#5b8af5" },
          { label:"Trajet soir (retour)", value:trajetSoir,  setter:setTrajetSoir,  color:"#5b8af5" },
        ].map(({label, value, setter, color}, i) => (
          <div key={i} style={{marginBottom: i===0 ? 10 : 0}}>
            <div style={{fontSize:11,fontWeight:700,color:"#1a1f2e",marginBottom:6}}>{label}</div>
            <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
              {[15, 30, 45, 60].map(m => (
                <button key={m} onClick={()=>setter(String(m))} style={{
                  padding:"7px 10px",borderRadius:7,border:"1.5px solid",cursor:"pointer",
                  fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .1s",
                  borderColor: parseInt(value)===m ? color : "#e0e4ef",
                  background:  parseInt(value)===m ? `${color}15` : "#fff",
                  color:       parseInt(value)===m ? color : "#aaa",
                }}>{m} min</button>
              ))}
              <input type="number" min="0" max="600" step="5"
                value={value}
                onChange={e=>setter(e.target.value)}
                placeholder="Autre"
                style={{width:64,padding:"7px 6px",border:"1.5px solid #e0e4ef",
                  borderRadius:7,fontSize:12,fontWeight:700,fontFamily:"inherit",
                  outline:"none",textAlign:"center",color:"#1a1f2e"}}
              />
              <span style={{fontSize:11,color:"#8a9ab0",fontWeight:600}}>min</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tâches */}
      {taches.length===0 && (
        <div style={{...S.card, textAlign:"center", padding:"32px 24px"}}>
          <div style={{fontSize:36,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:"#1a1f2e",marginBottom:6}}>Aucune tâche planifiée</div>
          <div style={{fontSize:14,color:"#8a9ab0",marginBottom:16}}>
            {todayJour ? `Rien n'est planifié pour toi ce ${todayJour}.` : "C'est le week-end ! 🎉"}
          </div>
          <button onClick={addTacheLibre} style={S.btn("#fff","#1a1f2e")}>+ Ajouter une tâche manuellement</button>
        </div>
      )}

      {taches.map((t, idx) => (
        <div key={idx} style={{...S.card, borderLeft:`4px solid ${t.chantier_couleur||"#5b8af5"}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {t.chantier_nom && (
              <div style={{display:"inline-block",background:t.chantier_couleur+"33",color:"#1a1f2e",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700,textTransform:"uppercase",
                letterSpacing:1}}>{t.chantier_nom}</div>
            )}
            {t.pourTout && (
              <div style={{display:"inline-block",background:"rgba(91,138,245,0.12)",color:"#5b8af5",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700}}>👥 Pour tous</div>
            )}
            {t.duree && (
              <div style={{display:"inline-block",background:"rgba(245,166,35,0.12)",color:"#c07800",
                borderRadius:5,padding:"2px 8px",fontSize:11,fontWeight:700}}>⏱ {t.duree}h estimée{t.duree>1?"s":""}</div>
            )}
          </div>
          {t.libre ? (
            <textarea value={t.planifie} onChange={e=>setTachePlanifie(idx,e.target.value)}
              placeholder="Décris la tâche…"
              style={{...S.input,resize:"none",minHeight:60,marginBottom:10,fontSize:15}}/>
          ) : (
            <div style={{fontSize:16,fontWeight:600,color:"#1a1f2e",marginBottom:12,lineHeight:1.4}}>{t.planifie}</div>
          )}

          {/* Boutons statut */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:12}}>
            {[["faite","✅","Faite","#50c878","rgba(80,200,120,0.12)"],
              ["en_cours","🔄","En cours","#f5a623","rgba(245,166,35,0.12)"],
              ["non_faite","❌","Non faite","#e05c5c","rgba(224,92,92,0.12)"]].map(([val,ic,lb,col,bg])=>(
              <button key={val} onClick={()=>setStatut(idx,val)} style={{
                padding:"10px 4px",borderRadius:10,border:"2px solid",cursor:"pointer",
                fontFamily:"inherit",fontSize:13,fontWeight:700,transition:"all .12s",
                borderColor: t.statut===val ? col : "#e0e4ef",
                background:  t.statut===val ? bg  : "#fff",
                color:       t.statut===val ? col : "#aaa",
              }}>{ic}<br/><span style={{fontSize:11}}>{lb}</span></button>
            ))}
          </div>

          {/* Durée + Avancement */}
          <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>

            {/* Durée — OBLIGATOIRE */}
            <div style={{
              flex:"1 1 200px",
              background:(t.statut==="non_faite"||t.heures_reelles&&parseFloat(t.heures_reelles)>=0)&&(t.statut==="non_faite"||parseFloat(t.heures_reelles)>0)?"rgba(80,200,120,0.06)":"rgba(224,92,92,0.06)",
              border:`1.5px solid ${t.statut==="non_faite"||(t.heures_reelles&&parseFloat(t.heures_reelles)>0)?"rgba(80,200,120,0.35)":"rgba(224,92,92,0.3)"}`,
              borderRadius:10,padding:"11px 12px",
            }}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
                color:t.statut==="non_faite"||(t.heures_reelles&&parseFloat(t.heures_reelles)>0)?"#50c878":"#e05c5c",
                marginBottom:8,display:"flex",alignItems:"center",gap:5}}>
                ⏱ Durée réelle
                <span style={{fontSize:9,background:"#e05c5c",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:800}}>OBLIGATOIRE</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                {[0.5,1,1.5,2,3,4].map(h=>(
                  <button key={h} onClick={()=>setTacheHeures(idx,String(h))} style={{
                    padding:"7px 8px",borderRadius:7,border:"1.5px solid",cursor:"pointer",
                    fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .1s",
                    borderColor:parseFloat(t.heures_reelles)===h?"#50c878":"#e0e4ef",
                    background:parseFloat(t.heures_reelles)===h?"rgba(80,200,120,0.15)":"#fff",
                    color:parseFloat(t.heures_reelles)===h?"#50c878":"#aaa",
                  }}>{h}h</button>
                ))}
                <input type="number" min="0.5" max="24" step="0.5"
                  value={t.heures_reelles||""}
                  onChange={e=>setTacheHeures(idx,e.target.value)}
                  placeholder="Autre"
                  style={{width:58,padding:"7px 6px",border:"1.5px solid #e0e4ef",
                    borderRadius:7,fontSize:12,fontWeight:700,fontFamily:"inherit",
                    outline:"none",textAlign:"center",color:"#1a1f2e"}}
                />
              </div>
            </div>

            {/* Avancement % */}
            <div style={{
              flex:"1 1 200px",
              background:(t.avancement===""||t.avancement===undefined||t.avancement===null)?"rgba(224,92,92,0.06)":parseInt(t.avancement)===100?"rgba(80,200,120,0.06)":"rgba(139,92,246,0.06)",
              border:`1.5px solid ${(t.avancement===""||t.avancement===undefined||t.avancement===null)?"rgba(224,92,92,0.3)":parseInt(t.avancement)===100?"rgba(80,200,120,0.35)":"rgba(139,92,246,0.3)"}`,
              borderRadius:10,padding:"11px 12px",
            }}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
                color:(t.avancement===""||t.avancement===undefined||t.avancement===null)?"#e05c5c":parseInt(t.avancement)===100?"#50c878":"#8b5cf6",
                marginBottom:8,display:"flex",alignItems:"center",gap:5}}>
                📊 Avancement
                {(t.avancement===""||t.avancement===undefined||t.avancement===null) && (
                  <span style={{fontSize:9,background:"#e05c5c",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:800}}>OBLIGATOIRE</span>
                )}
              </div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                {[0,25,50,75,100].map(p=>(
                  <button key={p} onClick={()=>setTacheAvancement(idx,String(p))} style={{
                    padding:"6px 8px",borderRadius:7,border:"1.5px solid",cursor:"pointer",
                    fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .1s",
                    borderColor:parseInt(t.avancement)===p?(p===100?"#50c878":"#8b5cf6"):"#e0e4ef",
                    background:parseInt(t.avancement)===p?(p===100?"rgba(80,200,120,0.15)":"rgba(139,92,246,0.15)"):"#fff",
                    color:parseInt(t.avancement)===p?(p===100?"#50c878":"#8b5cf6"):"#aaa",
                  }}>{p===100?"✓ 100%":`${p}%`}</button>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <input type="range" min="0" max="100" step="5"
                  value={t.avancement||0}
                  onChange={e=>setTacheAvancement(idx,e.target.value)}
                  style={{flex:1,accentColor:"#8b5cf6"}}
                />
                <span style={{fontSize:15,fontWeight:800,color:"#8b5cf6",minWidth:36,textAlign:"right"}}>
                  {t.avancement||0}%
                </span>
              </div>
              <div style={{height:4,background:"#e0e4ef",borderRadius:2,marginTop:6,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:2,transition:"width .3s",
                  background:parseInt(t.avancement)===100?"#50c878":"#8b5cf6",
                  width:`${t.avancement||0}%`}}/>
              </div>
            </div>
          </div>

          {/* Remarque tâche */}
          <div style={{marginBottom: t.statut==="en_cours"||t.statut==="non_faite" ? 0 : 0}}>
            {(t.statut==="en_cours"||t.statut==="non_faite") && (
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
                color:t.remarque?.trim()?"#50c878":"#e05c5c",marginBottom:6,display:"flex",alignItems:"center",gap:5}}>
                💬 Explication
                {!t.remarque?.trim() && <span style={{fontSize:9,background:"#e05c5c",color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:800}}>OBLIGATOIRE</span>}
              </div>
            )}
            <textarea value={t.remarque} onChange={e=>setTacheRemarque(idx,e.target.value)}
              placeholder={t.statut==="en_cours"?"Qu'est-ce qui bloque ? Estimation de fin…":t.statut==="non_faite"?"Pourquoi non réalisé ?":"Remarque, précision… (optionnel)"}
              style={{...S.input,resize:"none",minHeight:52,fontSize:14,color:"#4a5568",
                border:(t.statut==="en_cours"||t.statut==="non_faite")&&!t.remarque?.trim()
                  ?"1.5px solid rgba(224,92,92,0.4)":"1.5px solid #e0e4ef"}}/>
          </div>

          {/* Photos de la tâche */}
          <div style={{marginTop:12,paddingTop:12,borderTop:"1px dashed #e0e4ef"}}>
            <PhotosPicker
              photos={t.photos || []}
              onChange={(arr)=>setTachePhotos(idx, arr)}
              pathPrefix={`rapports/${ouvrier}/${dateKey}/tache-${idx}`}
              color={t.chantier_couleur || "#5b8af5"}
              label="Photos de la tâche"
            />
          </div>
        </div>
      ))}

      {/* Ajouter tâche libre */}
      <div style={{padding:"0 16px 8px"}}>
        <button onClick={addTacheLibre} style={{
          width:"100%",padding:"12px",border:"1.5px dashed #c0c8d8",borderRadius:12,
          fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"inherit",
          background:"transparent",color:"#8a9ab0",marginBottom:4
        }}>+ Ajouter une tâche</button>
      </div>

      {/* Photos générales du chantier */}
      {[...new Set(taches.filter(t=>t.chantier_id).map(t=>t.chantier_id))].map(cId => {
        const ct = taches.find(t=>t.chantier_id===cId);
        return (
          <div key={`ph-${cId}`} style={{...S.card, border:`1.5px solid ${(ct?.chantier_couleur||"#5b8af5")}55`, background:`${(ct?.chantier_couleur||"#5b8af5")}0A`}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
              <span style={{...S.label,marginBottom:0,color:"#1a1f2e"}}>📸 Photos du chantier</span>
              {ct?.chantier_nom && (
                <span style={{background:(ct.chantier_couleur||"#5b8af5")+"44",color:"#1a1f2e",
                  borderRadius:4,padding:"0 6px",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>
                  {ct.chantier_nom}
                </span>
              )}
            </div>
            <PhotosPicker
              photos={photosChantier[cId] || []}
              onChange={(arr)=>setPhotosChantier(p=>({...p,[cId]:arr}))}
              pathPrefix={`rapports/${ouvrier}/${dateKey}/chantier-${cId}`}
              color={ct?.chantier_couleur || "#5b8af5"}
              label="Vue globale, avancement…"
            />
            <div style={{fontSize:11,color:"#8a9ab0",marginTop:8,fontStyle:"italic"}}>
              Visibles dans la fiche chantier et dans le bilan d'équipe.
            </div>
          </div>
        );
      })}

      {/* Besoins en commande par chantier */}
      {[...new Set(taches.filter(t=>t.chantier_id).map(t=>t.chantier_id))].map(cId => {
        const ct = taches.find(t=>t.chantier_id===cId);
        const nbArticles = Object.values(paniers[cId]||{}).filter(v=>v.qty>0).length;
        return (
          <div key={cId} style={{...S.card, border:"1.5px solid rgba(176,96,255,0.3)", background:"rgba(176,96,255,0.04)"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{...S.label, marginBottom:0, color:"#9040c0"}}>
                📦 Besoins commande
                {ct?.chantier_nom && (
                  <span style={{marginLeft:6,background:ct.chantier_couleur+"44",color:"#1a1f2e",
                    borderRadius:4,padding:"0 6px",fontSize:10,fontWeight:700,textTransform:"uppercase"}}>
                    {ct.chantier_nom}
                  </span>
                )}
              </span>
              {nbArticles > 0 && (
                <span style={{background:"rgba(176,96,255,0.2)",color:"#9040c0",borderRadius:20,
                  padding:"2px 10px",fontSize:12,fontWeight:700}}>
                  {nbArticles} article{nbArticles>1?"s":""}
                </span>
              )}
            </div>

            {nbArticles > 0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                {Object.values(paniers[cId]||{}).filter(v=>v.qty>0).map(({article,qty})=>(
                  <div key={article.id} style={{background:"rgba(176,96,255,0.12)",borderRadius:8,
                    padding:"4px 10px",fontSize:12,fontWeight:700,color:"#6020a0"}}>
                    {qty}× {article.nom}
                  </div>
                ))}
              </div>
            )}

            <button onClick={()=>setBesoinDrawer(cId)} style={{
              width:"100%",padding:"12px",border:"1.5px dashed rgba(176,96,255,0.4)",
              borderRadius:12,fontSize:14,fontWeight:700,cursor:"pointer",
              fontFamily:"inherit",background:"transparent",color:"#9040c0",
            }}>
              {nbArticles > 0 ? "✏️ Modifier ma sélection" : "🛒 Choisir dans la bibliothèque"}
            </button>

            <div style={{fontSize:11,color:"#9040c0",marginTop:6}}>
              ⚡ Sera transmis automatiquement dans l'onglet Commandes
            </div>
          </div>
        );
      })}

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
        <span style={S.label}>Remarque générale de la journée</span>
        <textarea value={remarque} onChange={e=>setRemarque(e.target.value)}
          placeholder="Informations utiles…"
          style={{...S.input,resize:"none",minHeight:80,fontSize:14}}/>
      </div>

      {/* Bouton soumettre */}
      <div style={{padding:"8px 16px 32px"}}>
        <button onClick={soumettre} disabled={submitting} style={{
          width:"100%",padding:"18px",border:"none",borderRadius:14,fontSize:17,
          fontWeight:800,cursor:"pointer",fontFamily:"inherit",letterSpacing:.5,
          background:submitting?"#c0c8d8":"#FFC200",color:"#111",
          boxShadow:"0 4px 20px rgba(255,194,0,0.3)",
        }}>
          {submitting ? "Envoi en cours…" : "✓ Valider mon compte rendu"}
        </button>
      </div>
    </div>
  );
}

export default PageRapportMobile;
