import React, { useMemo, useState } from "react";
import {
  X, Play, RefreshCw, ShieldCheck, TriangleAlert, CalendarRange,
  Clock, Users, Route, ArrowRight, CircleAlert, CheckCircle2,
} from "lucide-react";
import { Icon } from "../ui";
import { FONT, RADIUS, SHADOW } from "../constants";
import { capaciteBasePlanningPourDate } from "./planningResourceCapacityV1.js";
import { simulerPlanningGlobalV1 } from "./planningEngineDataV1.js";

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (dateISO, n) => {
  const d = new Date(`${dateISO}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const fmtDate = value => {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"2-digit" });
};
const fmtH = value => `${Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10} h`;

function prochainJourPlanifiable() {
  let d = addDays(iso(new Date()), 1); // aujourd'hui reste hors recalcul par défaut
  for (let i = 0; i < 14; i++) {
    if (capaciteBasePlanningPourDate(d) > 0) return d;
    d = addDays(d, 1);
  }
  return d;
}

function Stat({ label, value, sub, icon, T, color }) {
  return (
    <div style={{ minWidth:150, flex:"1 1 150px", background:T.card, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:7, color:color || T.textMuted, marginBottom:5 }}>
        <Icon as={icon} size={14}/>
        <span style={{ fontSize:10, fontWeight:800, letterSpacing:1, textTransform:"uppercase" }}>{label}</span>
      </div>
      <div style={{ fontSize:21, fontWeight:850, color:T.text, lineHeight:1.1 }}>{value}</div>
      {sub && <div style={{ marginTop:4, fontSize:11, color:T.textMuted, lineHeight:1.35 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, T }) {
  return <div style={{ fontSize:11, fontWeight:850, letterSpacing:1.1, textTransform:"uppercase", color:T.textMuted, margin:"20px 0 9px" }}>{children}</div>;
}

export default function PlanningEngineSimulationPanel({ T, acc, onClose }) {
  const [startDate, setStartDate] = useState(prochainJourPlanifiable);
  const [horizonDays, setHorizonDays] = useState(42);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const nomsChantiers = useMemo(() => new Map((result?.referentiel?.chantiers || []).map(c => [c.id, c.nom || c.id])), [result]);
  const nomsRessources = useMemo(() => new Map((result?.referentiel?.ressources || []).map(r => [r.id, r.nom_planning || r.nom || r.id])), [result]);

  const lancer = async () => {
    setLoading(true); setError("");
    try {
      const out = await simulerPlanningGlobalV1({ startDate, horizonDays:Number(horizonDays) || 42 });
      setResult(out);
    } catch (e) {
      console.error("Simulation planning global V1:", e);
      setError(e?.message || "Impossible de calculer la simulation.");
    } finally { setLoading(false); }
  };

  const a = result?.audit_adaptateur;
  const p = result?.proposition;
  const diff = result?.diff_forecast;
  const warnings = [
    ...(result?.warnings_adaptateur || []).map(x => ({ ...x, origine:"Données" })),
    ...(result?.travaux_exclus || []).map(x => ({ ...x, origine:"Exclusion" })),
    ...(p?.warnings || []).map(x => ({ ...x, origine:"Moteur" })),
    ...(p?.non_planifies || []).map(x => ({ ...x, origine:"Non planifié", explication:x.raison })),
  ];

  const chantiersImpactes = (diff?.par_chantier || []).slice().sort((x, y) =>
    Math.abs(y.decalage_fin_jours || 0) - Math.abs(x.decalage_fin_jours || 0)
  );
  const allocations = (p?.allocations_proposees || []).slice(0, 80);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:180, background:"rgba(8,12,20,.58)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", padding:18 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:"min(1180px, 96vw)", maxHeight:"92vh", overflow:"hidden", background:T.modal, border:`1px solid ${T.border}`, borderRadius:18, boxShadow:SHADOW.lg, display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 18px", borderBottom:`1px solid ${T.border}`, background:T.surface }}>
          <div style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", background:acc.bg10, color:acc.accent }}><Icon as={Route} size={19}/></div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:850, color:T.text }}>Simulation planning global</div>
            <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>Moteur déterministe V1 · proposition uniquement</div>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 9px", borderRadius:RADIUS.pill, fontSize:10, fontWeight:800, color:"#16a34a", background:"rgba(22,163,74,.10)", border:"1px solid rgba(22,163,74,.24)" }}><Icon as={ShieldCheck} size={12}/> Lecture seule</span>
            <button onClick={onClose} style={{ width:34, height:34, borderRadius:RADIUS.md, border:`1px solid ${T.border}`, background:"transparent", color:T.textSub, cursor:"pointer" }}><Icon as={X} size={16}/></button>
          </div>
        </div>

        <div style={{ overflowY:"auto", padding:"16px 18px 24px" }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"end", padding:12, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card }}>
            <label style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:.9, color:T.textMuted }}>Début recalculable</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ height:36, padding:"0 10px", borderRadius:RADIUS.md, border:`1px solid ${T.fieldBorder}`, background:T.inputBg, color:T.text, fontFamily:"inherit" }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:.9, color:T.textMuted }}>Horizon</span>
              <select value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value))} style={{ height:36, padding:"0 30px 0 10px", borderRadius:RADIUS.md, border:`1px solid ${T.fieldBorder}`, background:T.inputBg, color:T.text, fontFamily:"inherit" }}>
                <option value={14}>2 semaines</option><option value={28}>4 semaines</option><option value={42}>6 semaines</option><option value={56}>8 semaines</option><option value={84}>12 semaines</option>
              </select>
            </label>
            <button onClick={lancer} disabled={loading || !startDate} style={{ height:36, padding:"0 15px", border:0, borderRadius:RADIUS.md, background:acc.accent, color:acc.onAccent, fontFamily:"inherit", fontSize:12, fontWeight:850, cursor:loading ? "wait" : "pointer", display:"inline-flex", alignItems:"center", gap:7, opacity:loading ? .7 : 1 }}>
              <Icon as={loading ? RefreshCw : Play} size={14} className={loading ? "spin" : ""}/>{loading ? "Calcul en cours…" : result ? "Recalculer" : "Lancer la simulation"}
            </button>
            <div style={{ flex:"1 1 250px", fontSize:11, lineHeight:1.45, color:T.textMuted }}>
              Le planning actuel n'est jamais modifié. Les créneaux futurs déverrouillés sont recalculables ; les lignes manuelles et allocations verrouillées restent fixes.
            </div>
          </div>

          {error && <div style={{ marginTop:12, padding:"10px 12px", borderRadius:RADIUS.md, background:"rgba(239,68,68,.09)", border:"1px solid rgba(239,68,68,.25)", color:"#ef4444", display:"flex", gap:8, alignItems:"flex-start", fontSize:12 }}><Icon as={CircleAlert} size={16}/><span>{error}</span></div>}

          {!result && !error && <div style={{ padding:"44px 16px", textAlign:"center", color:T.textMuted }}>
            <Icon as={CalendarRange} size={30} style={{ opacity:.55, marginBottom:10 }}/>
            <div style={{ fontSize:14, fontWeight:750, color:T.textSub }}>Aucune simulation lancée</div>
            <div style={{ fontSize:12, marginTop:5 }}>Le premier calcul affichera d'abord la qualité des données utilisées avant la proposition.</div>
          </div>}

          {result && <>
            <SectionTitle T={T}>Synthèse de calcul</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <Stat T={T} icon={Route} label="Travaux moteur" value={a?.travaux_moteur ?? 0} sub={`${a?.travaux_exclus ?? 0} exclus avec raison`} color={acc.accent}/>
              <Stat T={T} icon={Clock} label="MO à planifier" value={fmtH(a?.heures_mo_a_planifier)} sub={`${fmtH(a?.heures_mo_reservees_par_verrous)} déjà réservées par verrous`} color="#5b8af5"/>
              <Stat T={T} icon={CheckCircle2} label="Planifiés" value={p?.resume?.travaux_planifies ?? 0} sub={`${p?.resume?.travaux_non_planifies ?? 0} non planifiés dans l'horizon`} color="#22c55e"/>
              <Stat T={T} icon={Users} label="Allocations proposées" value={p?.resume?.allocations_proposees ?? 0} sub={`${fmtH(p?.resume?.heures_mo_proposees)} proposées`} color="#8b5cf6"/>
            </div>

            <SectionTitle T={T}>Écart avec le forecast courant</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <Stat T={T} icon={ArrowRight} label="Tâches modifiées" value={diff?.resume?.modifiees ?? 0} sub={`${diff?.resume?.inchangees ?? 0} inchangées · ${diff?.resume?.nouvelles ?? 0} nouvelles`} color="#f59e0b"/>
              <Stat T={T} icon={CalendarRange} label="Fins retardées" value={diff?.resume?.fin_retardee ?? 0} sub={`${diff?.resume?.fin_avancee ?? 0} avancées`} color={(diff?.resume?.fin_retardee || 0) ? "#ef4444" : "#22c55e"}/>
              <Stat T={T} icon={Users} label="Équipes modifiées" value={diff?.resume?.ressources_changees ?? 0} sub={`${diff?.resume?.fractionnement_change ?? 0} fractionnements modifiés`} color="#06b6d4"/>
            </div>

            {chantiersImpactes.length > 0 && <>
              <SectionTitle T={T}>Impact par chantier</SectionTitle>
              <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
                {chantiersImpactes.map((c, i) => {
                  const delta = c.decalage_fin_jours;
                  const col = delta > 0 ? "#ef4444" : delta < 0 ? "#22c55e" : T.textMuted;
                  return <div key={c.chantier_id} style={{ display:"grid", gridTemplateColumns:"minmax(150px,1fr) 110px 24px 110px 95px", gap:8, alignItems:"center", padding:"9px 11px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:12 }}>
                    <strong style={{ color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{nomsChantiers.get(c.chantier_id) || c.chantier_id}</strong>
                    <span style={{ color:T.textSub, textAlign:"right" }}>{fmtDate(c.fin_courante)}</span><Icon as={ArrowRight} size={13} color={T.textMuted}/><span style={{ color:T.textSub }}>{fmtDate(c.fin_proposee)}</span>
                    <span style={{ color:col, fontWeight:850, textAlign:"right" }}>{delta == null ? "nouveau" : delta === 0 ? "stable" : `${delta > 0 ? "+" : ""}${delta} j`}</span>
                  </div>;
                })}
              </div>
            </>}

            <SectionTitle T={T}>Proposition — premiers créneaux</SectionTitle>
            <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
              {allocations.length === 0 ? <div style={{ padding:14, color:T.textMuted, fontSize:12 }}>Aucun créneau proposé.</div> : allocations.map((x, i) => (
                <div key={x.allocation_uid} style={{ display:"grid", gridTemplateColumns:"90px minmax(135px,.8fr) minmax(220px,1.5fr) 65px minmax(130px,1fr)", gap:9, alignItems:"center", padding:"8px 10px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:11.5 }}>
                  <strong style={{ color:T.textSub }}>{fmtDate(x.date)}</strong>
                  <span style={{ color:T.text, fontWeight:750, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{nomsChantiers.get(x.chantier_id) || x.chantier_id}</span>
                  <span style={{ color:T.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={x.texte}>{x.texte}</span>
                  <span style={{ color:T.text, fontWeight:750 }}>{x.duree} h</span>
                  <span style={{ color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(x.resource_ids || []).map(id => nomsRessources.get(id) || id).join(" + ") || "—"}</span>
                </div>
              ))}
              {(p?.allocations_proposees?.length || 0) > allocations.length && <div style={{ padding:"8px 10px", borderTop:`1px solid ${T.border}`, fontSize:11, color:T.textMuted }}>+ {(p.allocations_proposees.length - allocations.length)} autres créneaux dans le calcul</div>}
            </div>

            <SectionTitle T={T}>Qualité & points à traiter</SectionTitle>
            {warnings.length === 0 ? <div style={{ padding:"10px 12px", borderRadius:RADIUS.md, background:"rgba(34,197,94,.08)", color:"#22c55e", fontSize:12, display:"flex", gap:7, alignItems:"center" }}><Icon as={CheckCircle2} size={15}/> Aucun avertissement bloquant détecté sur cet horizon.</div> :
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {warnings.slice(0, 30).map((w, i) => <div key={`${w.origine}-${w.travail_id || w.tache_id || i}-${i}`} style={{ padding:"9px 11px", border:`1px solid ${T.border}`, borderRadius:RADIUS.md, display:"flex", gap:8, alignItems:"flex-start", background:T.card }}>
                  <Icon as={TriangleAlert} size={14} color={w.origine === "Non planifié" ? "#ef4444" : "#f59e0b"} style={{ marginTop:1, flex:"0 0 auto" }}/>
                  <div style={{ minWidth:0 }}><div style={{ fontSize:10, fontWeight:850, letterSpacing:.8, textTransform:"uppercase", color:T.textMuted }}>{w.origine}{w.chantier_id ? ` · ${nomsChantiers.get(w.chantier_id) || w.chantier_id}` : ""}</div><div style={{ marginTop:2, fontSize:11.5, lineHeight:1.4, color:T.textSub }}>{w.explication || w.raison || w.type}</div></div>
                </div>)}
                {warnings.length > 30 && <div style={{ fontSize:11, color:T.textMuted, padding:"3px 2px" }}>+ {warnings.length - 30} autres points dans le résultat complet.</div>}
              </div>}

            <div style={{ marginTop:18, padding:"10px 12px", border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, fontSize:11, lineHeight:1.45, color:T.textMuted, display:"flex", gap:8 }}>
              <Icon as={ShieldCheck} size={15} color="#22c55e" style={{ flex:"0 0 auto" }}/>
              <span><strong style={{ color:T.textSub }}>Aucune modification n'a été appliquée.</strong> Ce panneau compare uniquement le forecast actuel à une proposition déterministe. L'étape « aperçu → confirmation → application » sera ajoutée séparément au chantier de replanification.</span>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}
