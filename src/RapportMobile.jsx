import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { supabase } from "./supabase";
import { JOURS, JOURS_JS, COULEURS_PALETTE, STATUTS, THEMES, emptyCell, emptyCommande, parseTachesFromPlanifie, DEFAULT_OUVRIERS, DEFAULT_CHANTIERS, LOGO_HORIZ, LOGO_SQ, getCurrentWeek, getWeekId, getTodayJour } from "./constants";
import BesoinCommandeDrawer from "./BesoinCommandeDrawer";

// ─── HELPER EMAIL ─────────────────────────────────────────────────────────────
async function sendRapportEmail(rapport, chantierNom) {
  const RESEND_KEY = import.meta.env.VITE_RESEND_KEY;
  if (!RESEND_KEY) { console.warn("VITE_RESEND_KEY non configuré"); return; }
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
  await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{"Authorization":`Bearer ${RESEND_KEY}`,"Content-Type":"application/json"},
    body: JSON.stringify({
      from:"Planning Pro <onboarding@resend.dev>",
      to:["suivi.chantier@groupe-profero.com"],
      subject:`CR ${rapport.ouvrier} — ${chantierNom} — ${rapport.date_rapport}`,
      html,
    })
  });
}


// ─── PAGE RAPPORT MOBILE ──────────────────────────────────────────────────────
function PageRapportMobile() {
  const [step, setStep]             = useState("login"); // login | rapport | done
  const [ouvrier, setOuvrier]       = useState(() => localStorage.getItem("mon_prenom") || "");
  const [chantiers, setChantiers]   = useState([]);
  const [ouvriers, setOuvriers]     = useState(DEFAULT_OUVRIERS);
  const [taches, setTaches]         = useState([]);
  const [remarque, setRemarque]     = useState("");
  const [paniers, setPaniers]       = useState({});      // { chantier_id: { articleId: {article, qty} } }
  const [besoinDrawer, setBesoinDrawer] = useState(null); // chantier_id du drawer ouvert
  const [submitting, setSubmitting] = useState(false);
  const [planData, setPlanData]     = useState(null);

  const today    = new Date();
  const dateStr  = today.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"});
  const dateKey  = today.toLocaleDateString("fr-FR");
  const {year, week} = getCurrentWeek();
  const weekId   = getWeekId(year, week);
  const todayJour = getTodayJour();

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
  const addTacheLibre     = ()            => setTaches(t => [...t, {chantier_id:"",chantier_nom:"",chantier_couleur:"#c8d8f0",planifie:"",statut:null,remarque:"",libre:true}]);

  const soumettre = async () => {
    const tachesRemplies = taches.filter(t => t.planifie.trim());
    if (tachesRemplies.length === 0) { alert("Aucune tâche à soumettre."); return; }
    const sansDuree = tachesRemplies.filter(t => !t.heures_reelles || parseFloat(t.heures_reelles) <= 0);
    if (sansDuree.length > 0) {
      alert(`⏱ Durée manquante sur ${sansDuree.length} tâche${sansDuree.length>1?"s":""}\n${sansDuree.map(t=>"• "+t.planifie.slice(0,50)).join("\n")}\n\nCe champ est obligatoire.`);
      return;
    }

    setSubmitting(true);

    // Regrouper par chantier
    const parChantier = {};
    tachesRemplies.forEach(t => {
      const k = t.chantier_id || "divers";
      if (!parChantier[k]) parChantier[k] = { chantier_id:t.chantier_id, chantier_nom:t.chantier_nom||"Divers", taches:[] };
      parChantier[k].taches.push({ planifie:t.planifie, statut:t.statut||"non_faite", remarque:t.remarque, heures_reelles:parseFloat(t.heures_reelles)||0, avancement:parseInt(t.avancement)||0 });
    });

    for (const k of Object.keys(parChantier)) {
      const grp = parChantier[k];
      const rapport = {
        ouvrier: ouvrier.trim(),
        chantier_id: grp.chantier_id,
        chantier_nom: grp.chantier_nom,
        date_rapport: dateKey,
        semaine: weekId,
        taches: grp.taches,
        remarque,
      };
      await supabase.from("rapports").insert(rapport);
      try { await sendRapportEmail(rapport, grp.chantier_nom); } catch(e) { console.error("Email:",e); }

      // Besoins commande depuis la bibliothèque
      const besoinArticles = Object.values(paniers[grp.chantier_id]||{}).filter(v=>v.qty>0);
      for (const {article, qty} of besoinArticles) {
        await supabase.from("commandes_detail").insert({
          chantier_id: grp.chantier_id,
          article: article.nom,
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
    header:{ background:"#080a0d", padding:"16px 20px 14px", position:"sticky", top:0, zIndex:10, borderBottom:"2px solid #FFC200" },
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
        <img src={LOGO_HORIZ} alt="Profero" style={{height:28,objectFit:"contain",objectPosition:"left",marginBottom:6}}/>
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

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <img src={LOGO_SQ} alt="Profero" style={{height:24,objectFit:"contain",objectPosition:"left",marginBottom:4}}/>
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
              background:!t.heures_reelles||parseFloat(t.heures_reelles)<=0?"rgba(224,92,92,0.06)":"rgba(80,200,120,0.06)",
              border:`1.5px solid ${!t.heures_reelles||parseFloat(t.heures_reelles)<=0?"rgba(224,92,92,0.3)":"rgba(80,200,120,0.35)"}`,
              borderRadius:10,padding:"11px 12px",
            }}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
                color:!t.heures_reelles||parseFloat(t.heures_reelles)<=0?"#e05c5c":"#50c878",
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
              background:parseInt(t.avancement)>0?"rgba(139,92,246,0.06)":"rgba(0,0,0,0.02)",
              border:`1.5px solid ${parseInt(t.avancement)>0?"rgba(139,92,246,0.3)":"#e0e4ef"}`,
              borderRadius:10,padding:"11px 12px",
            }}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
                color:parseInt(t.avancement)>0?"#8b5cf6":"#8a9ab0",marginBottom:8}}>
                📊 Avancement
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
          <textarea value={t.remarque} onChange={e=>setTacheRemarque(idx,e.target.value)}
            placeholder="Remarque, précision… (optionnel)"
            style={{...S.input,resize:"none",minHeight:52,fontSize:14,color:"#4a5568"}}/>
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
