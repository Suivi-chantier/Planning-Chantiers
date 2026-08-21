// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — Onglet « Chantiers » : liste de tous les chantiers, puis
// détail par chantier avec les plans (documents du cycle de vie) et les
// heures vendues vs réelles par ouvrage.
//
// Les tables phasages/pointages sont bureau-only (RLS Phase 0) : toutes les
// données passent par la RPC ouvrier_chantier_detail
// (sql/202608_ouvrier_chantiers.sql), qui ne renvoie JAMAIS de prix ni de
// taux horaire. Les calculs d'heures réutilisent le module chantierFinance
// (mêmes chiffres que la fiche chantier bureau).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import {
  Building2, MapPin, ArrowLeft, ChevronRight, FileText, Image as ImageIcon,
  FolderOpen, Timer, HardHat, CheckCircle2, Ruler, ImageOff,
} from "lucide-react";
import { MobileCard, MobileSection, MobileEmptyState, Pill, SummaryBar } from "../mobileUI";
import { indexPointagesParTache, tacheHeuresReelles } from "../chantierFinance";
import { urlDocumentChantier } from "./storageChantier";
import { getEtape } from "./cycleVie";
import { NavButtons } from "./ouvrierNav";
import PlanViewerOuvrier from "./PlanViewerOuvrier";

// Mêmes libellés/couleurs de statut que PageChantiers (bureau).
const STATUTS = {
  en_cours: { label: "En cours", color: "#e0a800" },
  termine:  { label: "Terminé",  color: "#22c55e" },
  planifie: { label: "Planifié", color: "#3b82f6" },
  en_pause: { label: "En pause", color: "#f97316" },
};

const fmtH = (n) => +(parseFloat(n) || 0).toFixed(1);
const fmtDate = (iso) => {
  const s = String(iso || "").slice(0, 10);
  return s ? s.split("-").reverse().join("/") : "";
};

// Couleur de dérive : même code métier que la fiche chantier (vert ≤ 100 %,
// orange ≤ 120 %, rouge au-delà).
const couleurDerive = (vendues, reelles) => {
  const pct = vendues > 0 ? (reelles / vendues) * 100 : (reelles > 0 ? 999 : 0);
  return pct > 120 ? "#ef4444" : pct > 100 ? "#f59e0b" : "#22c55e";
};

export default function OuvrierChantiers({ T, accent = "#FFC200" }) {
  const [config, setConfig]   = useState(null); // { chantiers, adresses }
  const [sel, setSel]         = useState(null); // chantier sélectionné (objet config)
  const [detail, setDetail]   = useState(null); // résultat de la RPC
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur]   = useState(false);
  const [plans, setPlans]     = useState(null); // plans de la page Plans (null = en cours)
  const [planOuvert, setPlanOuvert] = useState(null); // { id, name } → visionneuse

  useEffect(() => {
    supabase.from("planning_config").select("key,value").in("key", ["chantiers", "chantier_adresses"])
      .then(({ data }) => {
        let chantiers = DEFAULT_CHANTIERS, adresses = {};
        (data || []).forEach(r => {
          if (r.key === "chantiers" && Array.isArray(r.value)) chantiers = r.value;
          if (r.key === "chantier_adresses" && r.value) adresses = r.value;
        });
        setConfig({ chantiers, adresses });
      });
  }, []);

  const openChantier = async (c) => {
    setSel(c); setDetail(null); setErreur(false); setLoading(true); setPlans(null);
    // Plans de la page Plans (dessins) — chargés en parallèle du détail.
    supabase.rpc("ouvrier_plans_chantier", { p_chantier_id: c.id }).then(({ data, error }) => {
      if (error) { console.error("ouvrier_plans_chantier:", error); setPlans([]); return; }
      setPlans(Array.isArray(data) ? data : []);
    });
    const { data, error } = await supabase.rpc("ouvrier_chantier_detail", {
      p_chantier_id: c.id, p_chantier_nom: c.nom,
    });
    setLoading(false);
    if (error || !data) { console.error("ouvrier_chantier_detail:", error); setErreur(true); return; }
    setDetail(data);
  };

  const ouvrirDoc = async (pj) => {
    if (!pj?.path && pj?.url) { window.open(pj.url, "_blank"); return; }
    const fenetre = window.open("", "_blank"); // ouvrir AVANT l'await (anti-popup)
    const url = await urlDocumentChantier(pj.path);
    if (url) { if (fenetre) fenetre.location = url; else window.open(url, "_blank"); }
    else { if (fenetre) fenetre.close(); alert("Impossible d'ouvrir le fichier — réessaie plus tard."); }
  };

  // ── Vue LISTE ───────────────────────────────────────────────────────────────
  if (!sel) {
    if (!config) {
      return <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>;
    }
    const actifs   = config.chantiers.filter(c => (c.statut || "en_cours") !== "termine");
    const termines = config.chantiers.filter(c => (c.statut || "en_cours") === "termine");

    const ligne = (c) => {
      const st = STATUTS[c.statut || "en_cours"] || STATUTS.en_cours;
      const geo = config.adresses[c.id] || null;
      return (
        <MobileCard key={c.id} T={T} accent={c.couleur || accent}
          style={{ padding:"12px 14px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
          <div onClick={() => openChantier(c)} style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0 }}>
            <div style={{
              width:36, height:36, borderRadius:11, flexShrink:0,
              background:`linear-gradient(135deg, ${c.couleur || accent}, ${c.couleur || accent}c0)`, color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 4px 12px ${c.couleur || accent}44`,
            }}><Icon as={Building2} size={18}/></div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:800, fontSize:15.5, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{c.nom}</div>
              {geo?.adresse && (
                <div style={{ fontSize:12.5, color:T.textSub, marginTop:2, display:"flex", alignItems:"center", gap:4, overflow:"hidden" }}>
                  <Icon as={MapPin} size={12} style={{ flexShrink:0 }}/>
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{geo.adresse}</span>
                </div>
              )}
            </div>
            <Pill color={st.color}>{st.label}</Pill>
            <Icon as={ChevronRight} size={17} style={{ color:T.textMuted, flexShrink:0 }}/>
          </div>
        </MobileCard>
      );
    };

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ fontSize:13, fontWeight:700, color:T.textSub, padding:"0 4px" }}>
          {actifs.length} chantier{actifs.length > 1 ? "s" : ""} en activité
        </div>
        {actifs.length === 0 && (
          <MobileCard T={T}>
            <MobileEmptyState T={T} icon={Building2} title="Aucun chantier"
              hint="Aucun chantier n'est défini dans le planning pour le moment."/>
          </MobileCard>
        )}
        {actifs.map(ligne)}
        {termines.length > 0 && (
          <MobileSection T={T} accent="#22c55e" icon={CheckCircle2} title="Chantiers terminés" summary={termines.length}>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{termines.map(ligne)}</div>
          </MobileSection>
        )}
      </div>
    );
  }

  // ── Vue DÉTAIL ──────────────────────────────────────────────────────────────
  const couleur = sel.couleur || accent;
  const st = STATUTS[sel.statut || "en_cours"] || STATUTS.en_cours;
  const geo = config?.adresses?.[sel.id] || null;

  // Heures vendues vs réelles par ouvrage — même logique que la fiche chantier
  // bureau (heuresParOuvrage de PageChantiers), sur les données épurées de la RPC.
  const ppt = detail ? indexPointagesParTache(detail.pointages || []) : {};
  const rows = (() => {
    if (!detail) return [];
    const ouvrages = Array.isArray(detail.ouvrages) ? detail.ouvrages : [];
    if (ouvrages.length > 0) {
      // V2 : les tâches vivent dans ouvrages[].taches.
      return ouvrages.map(o => ({
        id: o.id,
        label: o.libelle || "(sans nom)",
        vendues: parseFloat(o.heures_devis) || 0,
        reelles: (o.taches || []).reduce((s, t) => s + tacheHeuresReelles(t, ppt), 0),
      })).filter(o => o.vendues > 0 || o.reelles > 0);
    }
    // Repli V1 : tâches par phase, groupées par ouvrage_id.
    const parOuvrage = new Map();
    const orphan = { vendues: 0, reelles: 0 };
    (detail.taches_v1 || []).forEach(t => {
      const hR = tacheHeuresReelles(t, ppt);
      const hV = parseFloat(t.heures_vendues) || 0;
      if (t.ouvrage_id) {
        const e = parOuvrage.get(t.ouvrage_id) || { vendues: 0, reelles: 0 };
        e.vendues += hV; e.reelles += hR;
        parOuvrage.set(t.ouvrage_id, e);
      } else { orphan.vendues += hV; orphan.reelles += hR; }
    });
    const out = [...parOuvrage.entries()]
      .map(([id, e]) => ({ id, label: id, ...e }))
      .filter(o => o.vendues > 0 || o.reelles > 0);
    if (orphan.vendues > 0 || orphan.reelles > 0) {
      out.push({ id: "_orphan", label: "Sans ouvrage rattaché", ...orphan });
    }
    return out;
  })();
  const heuresLibres = detail ? (parseFloat(detail.heures_libres) || 0) : 0;
  const tot = rows.reduce((s, o) => ({ vendues: s.vendues + o.vendues, reelles: s.reelles + o.reelles }), { vendues: 0, reelles: 0 });
  const totReelles = tot.reelles + heuresLibres;
  const nbDocs = (detail?.documents || []).reduce((s, d) => s + (Array.isArray(d.pieces) ? d.pieces.length : 0), 0);
  const sansPhasage = detail && !detail.phasage_id;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Retour à la liste */}
      <button onClick={() => { setSel(null); setDetail(null); setPlans(null); setPlanOuvert(null); }} style={{
        alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:7,
        background:T.surface, border:`1px solid ${T.border}`, borderRadius:12,
        padding:"9px 14px", color:T.textSub, cursor:"pointer",
        fontFamily:"inherit", fontSize:13.5, fontWeight:700,
      }}>
        <Icon as={ArrowLeft} size={15}/> Tous les chantiers
      </button>

      {/* En-tête chantier */}
      <MobileCard T={T} accent={couleur} style={{ padding:"13px 15px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:geo?.adresse ? 6 : 0 }}>
          <Icon as={Building2} size={16} color={couleur} strokeWidth={2.3}/>
          <span style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.2, flex:1, minWidth:0 }}>{sel.nom}</span>
          <Pill color={st.color}>{st.label}</Pill>
        </div>
        {geo?.adresse && (
          <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
            <Icon as={MapPin} size={13} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
            <span style={{ fontSize:13, color:T.textSub, lineHeight:1.4, flex:1 }}>{geo.adresse}</span>
          </div>
        )}
        <NavButtons geo={geo}/>
      </MobileCard>

      {loading && (
        <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
      )}
      {erreur && (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={Building2} title="Chargement impossible"
            hint="Les données du chantier n'ont pas pu être chargées. Vérifie ta connexion et réessaie."/>
        </MobileCard>
      )}

      {detail && !loading && (
        <>
          {/* Totaux du chantier */}
          <SummaryBar T={T} items={[
            { label:"Heures vendues", value:`${fmtH(tot.vendues)} h`, color:"#5b8af5", icon:Timer },
            { label:"Heures réelles", value:`${fmtH(totReelles)} h`, color:couleurDerive(tot.vendues, totReelles), icon:HardHat },
          ]}/>

          {/* Plans dessinés dans la page Plans (table plans, visionneuse vectorielle) */}
          <MobileSection T={T} accent={couleur} icon={Ruler} title="Plans"
            summary={plans === null ? "…" : (plans.length || "aucun")} defaultOpen>
            {plans === null ? (
              <div style={{ fontSize:13, color:T.textMuted, letterSpacing:1 }}>CHARGEMENT…</div>
            ) : plans.length === 0 ? (
              <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic" }}>
                Aucun plan dessiné pour ce chantier.
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                {plans.map(p => (
                  <div key={p.id} onClick={() => setPlanOuvert(p)} style={{
                    background:T.card, border:`1px solid ${T.border}`, borderRadius:11,
                    padding:8, cursor:"pointer",
                  }}>
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name || "Plan"} style={{
                        width:"100%", height:110, objectFit:"contain",
                        background:"#12151f", borderRadius:8, display:"block",
                      }}/>
                    ) : (
                      <div style={{
                        height:110, borderRadius:8, background:"#12151f",
                        display:"flex", alignItems:"center", justifyContent:"center", color:"#5b6a8a",
                      }}>
                        <Icon as={ImageOff} size={22}/>
                      </div>
                    )}
                    <div style={{ fontSize:13, fontWeight:700, color:T.text, marginTop:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {p.name || "Plan sans nom"}
                    </div>
                    {p.updated_at && (
                      <div style={{ fontSize:11, color:T.textMuted, marginTop:1 }}>{fmtDate(p.updated_at)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </MobileSection>

          {/* Documents du cycle de vie (pièces jointes non financières) */}
          <MobileSection T={T} accent={couleur} icon={FolderOpen} title="Documents"
            summary={nbDocs || "aucun"} defaultOpen={nbDocs > 0}>
            {nbDocs === 0 ? (
              <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic" }}>
                Aucun document déposé pour ce chantier.
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {(detail.documents || []).map(grp => (
                  <div key={grp.etape_id}>
                    <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, marginBottom:6 }}>
                      {getEtape(grp.etape_id)?.nom || grp.etape_id}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {(grp.pieces || []).map((pj, i) => {
                        const estImage = String(pj.type || "").startsWith("image/");
                        return (
                          <div key={pj.path || i} onClick={() => ouvrirDoc(pj)} style={{
                            display:"flex", alignItems:"center", gap:10, cursor:"pointer",
                            background:T.card, border:`1px solid ${T.border}`, borderRadius:11, padding:"9px 11px",
                          }}>
                            <Icon as={estImage ? ImageIcon : FileText} size={17} color={couleur} strokeWidth={2} style={{ flexShrink:0 }}/>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13.5, fontWeight:700, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                {pj.nom || "Document"}
                              </div>
                              {pj.date && <div style={{ fontSize:11.5, color:T.textMuted, marginTop:1 }}>{fmtDate(pj.date)}</div>}
                            </div>
                            <Icon as={ChevronRight} size={15} style={{ color:T.textMuted, flexShrink:0 }}/>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </MobileSection>

          {/* Heures par ouvrage */}
          <MobileSection T={T} accent={couleur} icon={Timer} title="Heures par ouvrage"
            summary={rows.length ? `${fmtH(totReelles)} / ${fmtH(tot.vendues)} h` : "aucun"} defaultOpen>
            {sansPhasage || rows.length === 0 ? (
              <div style={{ fontSize:13, color:T.textMuted, fontStyle:"italic" }}>
                {sansPhasage ? "Pas encore de chiffrage pour ce chantier." : "Aucune heure vendue ni pointée sur ce chantier."}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                {rows.map(o => {
                  const col = couleurDerive(o.vendues, o.reelles);
                  const pct = o.vendues > 0 ? Math.min(100, (o.reelles / o.vendues) * 100) : (o.reelles > 0 ? 100 : 0);
                  return (
                    <div key={o.id}>
                      <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:5 }}>
                        <span style={{ fontSize:13.5, fontWeight:700, color:T.text, flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                          {o.label}
                        </span>
                        <span style={{ fontSize:13, fontWeight:800, color:col, whiteSpace:"nowrap" }}>{fmtH(o.reelles)} h</span>
                        <span style={{ fontSize:12, color:T.textMuted, whiteSpace:"nowrap" }}>/ {fmtH(o.vendues)} h vendues</span>
                      </div>
                      <div style={{ height:6, borderRadius:3, background:T.card, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.max(o.reelles > 0 ? 3 : 0, pct)}%`, background:`linear-gradient(90deg, ${col}, ${col}cc)`, borderRadius:3 }}/>
                      </div>
                    </div>
                  );
                })}
                {heuresLibres > 0 && (
                  <div style={{ display:"flex", alignItems:"baseline", gap:8, paddingTop:2, borderTop:`1px dashed ${T.border}` }}>
                    <span style={{ fontSize:13, fontWeight:600, color:T.textSub, flex:1, fontStyle:"italic" }}>Hors ouvrages (tâches libres)</span>
                    <span style={{ fontSize:13, fontWeight:800, color:T.textSub, whiteSpace:"nowrap" }}>{fmtH(heuresLibres)} h</span>
                  </div>
                )}
              </div>
            )}
          </MobileSection>
        </>
      )}

      {/* Visionneuse plein écran (rendu vectoriel lecture seule) */}
      {planOuvert && (
        <PlanViewerOuvrier planId={planOuvert.id} name={planOuvert.name} onClose={() => setPlanOuvert(null)}/>
      )}
    </div>
  );
}
