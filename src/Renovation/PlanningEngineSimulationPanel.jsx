import React, { useMemo, useState } from "react";
import {
  X, Play, RefreshCw, ShieldCheck, TriangleAlert, CalendarRange,
  Clock, Users, Route, ArrowRight, CircleAlert, CheckCircle2,
} from "lucide-react";
import { Icon } from "../ui";
import { FONT, RADIUS, SHADOW } from "../constants";
import { capaciteBasePlanningPourDate } from "./planningResourceCapacityV1.js";
import { simulerPlanningGlobalV1, simulerSensibiliteHorizonsReplanningV1 } from "./planningEngineDataV1.js";

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

function humanMode(mode) {
  if (mode === "full_recalc") return "Recalcul global";
  if (mode === "resource_unavailable") return "Recalcul ciblé · absence";
  if (mode === "task_state_changed") return "Recalcul ciblé · avancement";
  if (mode === "task_completed_early") return "Recalcul ciblé · avance";
  if (mode === "task_overrun") return "Recalcul ciblé · dépassement";
  if (mode === "site_blocked") return "Recalcul ciblé · site";
  return mode ? `Recalcul ciblé · ${mode}` : "Recalcul global";
}

export default function PlanningEngineSimulationPanel({ T, acc, onClose }) {
  const [startDate, setStartDate] = useState(prochainJourPlanifiable);
  const [horizonDays, setHorizonDays] = useState(42);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sensitivityLoading, setSensitivityLoading] = useState(false);
  const [sensitivityError, setSensitivityError] = useState("");
  const [sensitivity, setSensitivity] = useState(null);

  const nomsChantiers = useMemo(() => new Map((result?.referentiel?.chantiers || []).map(c => [c.id, c.nom || c.id])), [result]);
  const nomsRessources = useMemo(() => new Map((result?.referentiel?.ressources || []).map(r => [r.id, r.nom_planning || r.nom || r.id])), [result]);

  const lancer = async () => {
    setLoading(true); setError("");
    try {
      const out = await simulerPlanningGlobalV1({ startDate, horizonDays:Number(horizonDays) || 42 });
      setResult(out);
    } catch (e) {
      console.error("Simulation replanification V1:", e);
      setError(e?.message || "Impossible de calculer la simulation.");
    } finally { setLoading(false); }
  };

  const lancerSensibilite = async () => {
    setSensitivityLoading(true); setSensitivityError("");
    try {
      const out = await simulerSensibiliteHorizonsReplanningV1({
        startDate,
        horizons:[42, 56, 84],
        baseHorizonDays:42,
      });
      setSensitivity(out);
    } catch (e) {
      console.error("Comparaison horizons replanification V1:", e);
      setSensitivityError(e?.message || "Impossible de comparer les horizons.");
    } finally { setSensitivityLoading(false); }
  };

  const a = result?.audit_adaptateur;
  const etat = result?.audit_etat_reel;
  const stabilite = result?.audit_stabilite_forecast;
  const stabiliteDates = result?.audit_stabilite_dates;
  const impact = result?.audit_impact_incremental;
  const p = result?.proposition;
  const diff = result?.diff_forecast;
  const applyPlan = result?.plan_application;
  const apply = applyPlan?.resume;
  const sens = sensitivity?.sensibilite || null;

  const raisonsLisibles = useMemo(() => {
    const labels = new Map();
    for (const c of diff?.changements || []) {
      for (const r of c.raisons || []) if (r?.code && r?.label && !labels.has(r.code)) labels.set(r.code, r.label);
    }
    return (diff?.raisons_resume || []).map(r => ({ ...r, label:labels.get(r.code) || r.code.replaceAll("_", " ") }));
  }, [diff]);

  const warnings = useMemo(() => {
    const bruts = [
      ...(result?.warnings_adaptateur || []).map(x => ({ ...x, origine:"Données" })),
      ...(result?.warnings_etat_reel || []).map(x => ({ ...x, origine:"État réel" })),
      ...(result?.travaux_exclus || []).map(x => ({ ...x, origine:"Exclusion" })),
      ...(result?.proposition?.warnings || []).map(x => ({ ...x, origine:"Moteur" })),
      ...(result?.proposition?.non_planifies || []).map(x => ({ ...x, origine:"Non planifié", explication:x.raison })),
      ...(diff?.changements || []).filter(x => x.changement_a_verifier).map(x => ({
        ...x,
        origine:"À vérifier",
        chantier_id:x.chantier_id,
        explication:`Changement détecté (${(x.details || []).join(", ") || "écart forecast"}) sans cause métier suffisamment démontrable.`,
      })),
    ];
    const groupes = new Map();
    for (const w of bruts) {
      const key = [w.origine, w.chantier_id || "", w.type || "", w.explication || w.raison || ""].join("|");
      const prev = groupes.get(key);
      if (prev) prev.count += 1;
      else groupes.set(key, { ...w, count:1 });
    }
    return [...groupes.values()].sort((a,b) =>
      `${a.origine}|${a.chantier_id || ""}|${a.type || ""}`.localeCompare(`${b.origine}|${b.chantier_id || ""}|${b.type || ""}`)
    );
  }, [result, diff]);

  const chantiersImpactes = (diff?.par_chantier || []).slice().sort((x, y) =>
    Math.abs(y.decalage_fin_jours || 0) - Math.abs(x.decalage_fin_jours || 0)
  );
  const blocsOperationnels = useMemo(() => {
    const groupes = new Map();
    for (const x of result?.proposition?.allocations_proposees || []) {
      const resources = [...(x.resource_ids || [])].sort();
      const key = [x.date || "", x.chantier_id || "", x.groupe_type_id || "", resources.join(",")].join("|");
      const prev = groupes.get(key);
      if (!prev) {
        groupes.set(key, { ...x, allocation_uid:`bloc_${key}`, resource_ids:resources, duree:Number(x.duree || 0), heures_mo:Number(x.heures_mo || 0), taches:[x.texte || "Tâche"], nb_taches:1, preservedCount:x.preserved ? 1 : 0 });
      } else {
        prev.duree += Number(x.duree || 0);
        prev.heures_mo += Number(x.heures_mo || 0);
        prev.nb_taches += 1;
        prev.preservedCount += x.preserved ? 1 : 0;
        prev.taches.push(x.texte || "Tâche");
      }
    }
    return [...groupes.values()].map(b => ({
      ...b,
      duree: Math.round((b.duree + Number.EPSILON) * 100) / 100,
      heures_mo: Math.round((b.heures_mo + Number.EPSILON) * 100) / 100,
      texte: b.nb_taches > 1 ? `${b.nb_taches} tâches · ${b.taches.slice(0,2).join(" + ")}${b.nb_taches > 2 ? "…" : ""}` : b.taches[0],
      detail_taches: b.taches.join(" • "),
    })).sort((a,b) => `${a.date}|${a.chantier_id}|${a.resource_ids.join(",")}|${a.groupe_type_id || ""}`.localeCompare(`${b.date}|${b.chantier_id}|${b.resource_ids.join(",")}|${b.groupe_type_id || ""}`));
  }, [result]);
  const allocations = blocsOperationnels.slice(0, 80);

  return (
    <div style={{ position:"fixed", inset:0, zIndex:180, background:"rgba(8,12,20,.58)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", padding:18 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div style={{ width:"min(1180px, 96vw)", maxHeight:"92vh", overflow:"hidden", background:T.modal, border:`1px solid ${T.border}`, borderRadius:18, boxShadow:SHADOW.lg, display:"flex", flexDirection:"column" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px 18px", borderBottom:`1px solid ${T.border}`, background:T.surface }}>
          <div style={{ width:38, height:38, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", background:acc.bg10, color:acc.accent }}><Icon as={Route} size={19}/></div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:17, fontWeight:850, color:T.text }}>Simulation replanification continue</div>
            <div style={{ fontSize:11, color:T.textMuted, marginTop:2 }}>Phasage = réel · forecast = préférence · proposition uniquement</div>
          </div>
          <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
            {result && <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 9px", borderRadius:RADIUS.pill, fontSize:10, fontWeight:800, color:acc.accent, background:acc.bg10, border:`1px solid ${acc.border}` }}><Icon as={RefreshCw} size={12}/>{humanMode(result.replanning_mode)}</span>}
            <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 9px", borderRadius:RADIUS.pill, fontSize:10, fontWeight:800, color:"#16a34a", background:"rgba(22,163,74,.10)", border:"1px solid rgba(22,163,74,.24)" }}><Icon as={ShieldCheck} size={12}/> Lecture seule</span>
            <button onClick={onClose} style={{ width:34, height:34, borderRadius:RADIUS.md, border:`1px solid ${T.border}`, background:"transparent", color:T.textSub, cursor:"pointer" }}><Icon as={X} size={16}/></button>
          </div>
        </div>

        <div style={{ overflowY:"auto", padding:"16px 18px 24px" }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"end", padding:12, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card }}>
            <label style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:.9, color:T.textMuted }}>Début recalculable</span>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setSensitivity(null); }} style={{ height:36, padding:"0 10px", borderRadius:RADIUS.md, border:`1px solid ${T.fieldBorder}`, background:T.inputBg, color:T.text, fontFamily:"inherit" }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:5 }}>
              <span style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:.9, color:T.textMuted }}>Horizon</span>
              <select value={horizonDays} onChange={e => setHorizonDays(Number(e.target.value))} style={{ height:36, padding:"0 30px 0 10px", borderRadius:RADIUS.md, border:`1px solid ${T.fieldBorder}`, background:T.inputBg, color:T.text, fontFamily:"inherit" }}>
                <option value={14}>2 semaines</option><option value={28}>4 semaines</option><option value={42}>6 semaines</option><option value={56}>8 semaines</option><option value={84}>12 semaines</option>
              </select>
            </label>
            <button onClick={lancer} disabled={loading || sensitivityLoading || !startDate} style={{ height:36, padding:"0 15px", border:0, borderRadius:RADIUS.md, background:acc.accent, color:acc.onAccent, fontFamily:"inherit", fontSize:12, fontWeight:850, cursor:loading ? "wait" : "pointer", display:"inline-flex", alignItems:"center", gap:7, opacity:(loading || sensitivityLoading) ? .7 : 1 }}>
              <Icon as={loading ? RefreshCw : Play} size={14} className={loading ? "spin" : ""}/>{loading ? "Calcul en cours…" : result ? "Recalculer" : "Lancer la simulation"}
            </button>
            <button onClick={lancerSensibilite} disabled={loading || sensitivityLoading || !startDate} style={{ height:36, padding:"0 13px", borderRadius:RADIUS.md, border:`1px solid ${acc.border}`, background:acc.bg10, color:acc.accent, fontFamily:"inherit", fontSize:11.5, fontWeight:850, cursor:sensitivityLoading ? "wait" : "pointer", display:"inline-flex", alignItems:"center", gap:7, opacity:(loading || sensitivityLoading) ? .7 : 1 }}>
              <Icon as={sensitivityLoading ? RefreshCw : CalendarRange} size={14} className={sensitivityLoading ? "spin" : ""}/>{sensitivityLoading ? "Comparaison…" : "Comparer 6 / 8 / 12 semaines"}
            </button>
            <div style={{ flex:"1 1 300px", fontSize:11, lineHeight:1.45, color:T.textMuted }}>
              Le réel vient du phasage. Le forecast courant sert à conserver les dates, équipes et continuités encore compatibles ; les allocations verrouillées restent fixes. Rien n'est appliqué automatiquement.
            </div>
          </div>

          {error && <div style={{ marginTop:12, padding:"10px 12px", borderRadius:RADIUS.md, background:"rgba(239,68,68,.09)", border:"1px solid rgba(239,68,68,.25)", color:"#ef4444", display:"flex", gap:8, alignItems:"flex-start", fontSize:12 }}><Icon as={CircleAlert} size={16}/><span>{error}</span></div>}
          {sensitivityError && <div style={{ marginTop:12, padding:"10px 12px", borderRadius:RADIUS.md, background:"rgba(239,68,68,.09)", border:"1px solid rgba(239,68,68,.25)", color:"#ef4444", display:"flex", gap:8, alignItems:"flex-start", fontSize:12 }}><Icon as={CircleAlert} size={16}/><span>{sensitivityError}</span></div>}

          {!result && !sens && !error && !sensitivityError && <div style={{ padding:"44px 16px", textAlign:"center", color:T.textMuted }}>
            <Icon as={CalendarRange} size={30} style={{ opacity:.55, marginBottom:10 }}/>
            <div style={{ fontSize:14, fontWeight:750, color:T.textSub }}>Aucune simulation lancée</div>
            <div style={{ fontSize:12, marginTop:5 }}>Le calcul audite d'abord le réel, puis cherche une proposition stable et explicable.</div>
          </div>}

          {sens && <>
            <SectionTitle T={T}>Sensibilité à l’horizon — même snapshot réel</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              {(sens.resultats || []).map(r => {
                const comp = (sens.comparaison || []).find(c => c.horizon_days === r.horizon_days) || {};
                const semaines = Math.round(r.horizon_days / 7);
                const blocked = r.non_replanifies?.total || 0;
                return <div key={r.horizon_days} style={{ flex:"1 1 260px", minWidth:230, padding:"12px 14px", border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, background:T.card }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ fontSize:14, fontWeight:850, color:T.text }}>{semaines} semaines</div>
                    <span style={{ marginLeft:"auto", display:"inline-flex", alignItems:"center", gap:5, fontSize:10.5, fontWeight:800, color:r.application_autorisable ? "#22c55e" : "#f59e0b" }}><Icon as={r.application_autorisable ? CheckCircle2 : CircleAlert} size={13}/>{r.application_autorisable ? "autorisable" : "bloquée"}</span>
                  </div>
                  <div style={{ marginTop:9, fontSize:24, fontWeight:900, color:blocked ? "#ef4444" : "#22c55e" }}>{blocked}</div>
                  <div style={{ fontSize:10.5, color:T.textMuted }}>forecast(s) courant(s) sans remplacement</div>
                  <div style={{ marginTop:8, fontSize:11.5, lineHeight:1.45, color:T.textSub }}>
                    <strong>{r.non_replanifies?.horizon_ou_capacite || 0}</strong> horizon/capacité · <strong>{r.non_replanifies?.donnee_ou_dependance || 0}</strong> donnée/dépendance<br/>
                    {fmtH(r.proposition_resume?.heures_mo_non_planifiees)} de MO non planifiée
                  </div>
                  <div style={{ marginTop:8, paddingTop:8, borderTop:`1px solid ${T.border}`, fontSize:11, lineHeight:1.4, color:T.textMuted }}>
                    {r.horizon_days === sens.base_horizon_days ? "Horizon de référence" : <><strong style={{ color:"#22c55e" }}>{comp.resolus_depuis_base || 0}</strong> blocker(s) de 6 sem. résolu(s) · <strong style={{ color:comp.encore_bloques_depuis_base ? "#f59e0b" : "#22c55e" }}>{comp.encore_bloques_depuis_base || 0}</strong> encore bloqué(s){comp.nouveaux_non_replanifies_hors_base ? ` · +${comp.nouveaux_non_replanifies_hors_base} nouveau(x) forecast(s) visible(s)` : ""}</>}
                  </div>
                </div>;
              })}
            </div>
            <div style={{ marginTop:10, padding:"10px 12px", border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.card, fontSize:11.5, lineHeight:1.45, color:T.textSub }}>
              <strong style={{ color:T.text }}>{sens.resume?.resolus_au_plus_long || 0} blocker(s) du forecast 6 semaines sont résolus à 12 semaines</strong> ; {sens.resume?.encore_bloques_au_plus_long || 0} restent bloqués. Les nouveaux forecasts qui deviennent visibles au-delà de 6 semaines sont comptés séparément et ne sont jamais présentés comme une régression du même périmètre.
            </div>
          </>}

          {result && <>
            <SectionTitle T={T}>Synthèse de calcul</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <Stat T={T} icon={Route} label="Travaux moteur" value={a?.travaux_moteur ?? 0} sub={`${a?.travaux_exclus ?? 0} exclus avec raison`} color={acc.accent}/>
              <Stat T={T} icon={Clock} label="MO à planifier" value={fmtH(a?.heures_mo_a_planifier)} sub={`${fmtH(a?.heures_mo_reservees_par_verrous)} déjà réservées par verrous`} color="#5b8af5"/>
              <Stat T={T} icon={CheckCircle2} label="Planifiés" value={p?.resume?.travaux_planifies ?? 0} sub={`${p?.resume?.travaux_non_planifies ?? 0} non planifiés dans l'horizon`} color="#22c55e"/>
              <Stat T={T} icon={Users} label="Allocations proposées" value={p?.resume?.allocations_proposees ?? 0} sub={`${fmtH(p?.resume?.heures_mo_proposees)} proposées`} color="#8b5cf6"/>
            </div>

            <SectionTitle T={T}>Réel & stabilité</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <Stat T={T} icon={Clock} label="Tâches en cours" value={etat?.taches_en_cours ?? 0} sub={`${etat?.taches_en_retard ?? 0} détectées en retard`} color={(etat?.taches_en_retard || 0) ? "#ef4444" : "#22c55e"}/>
              <Stat T={T} icon={Users} label="Équipes stabilisées" value={stabilite?.travaux_avec_preference_forecast_conservee ?? 0} sub={`${stabilite?.travaux_avec_affinite_site ?? 0} affinités d'opération`} color="#06b6d4"/>
              <Stat T={T} icon={CalendarRange} label="Dates conservées" value={stabiliteDates?.dates_forecast_conservees ?? 0} sub={`${stabiliteDates?.dates_forecast_liberees_retard ?? 0} libérées pour retard réel`} color="#5b8af5"/>
              <Stat T={T} icon={ShieldCheck} label="Changements expliqués" value={diff?.resume?.changements_expliques ?? 0} sub={`${diff?.resume?.changements_a_verifier ?? 0} changement(s) à vérifier`} color={(diff?.resume?.changements_a_verifier || 0) ? "#f59e0b" : "#22c55e"}/>
            </div>

            {result.replanning_mode !== "full_recalc" && impact && <div style={{ marginTop:10, padding:"10px 12px", borderRadius:RADIUS.md, background:acc.bg10, border:`1px solid ${acc.border}`, color:T.textSub, fontSize:11.5, lineHeight:1.45 }}>
              <strong style={{ color:T.text }}>{humanMode(result.replanning_mode)}</strong> · {impact.travaux_impactes ?? 0} travail(aux) impacté(s) · {impact.allocations_preservables ?? 0} allocation(s) compatibles préservables · {impact.allocations_liberees ?? 0} libérée(s) pour recalcul.
            </div>}

            <SectionTitle T={T}>Écart avec le forecast courant</SectionTitle>
            <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
              <Stat T={T} icon={ArrowRight} label="Tâches modifiées" value={diff?.resume?.modifiees ?? 0} sub={`${diff?.resume?.inchangees ?? 0} inchangées · ${diff?.resume?.nouvelles ?? 0} sans planification actuelle · ${diff?.resume?.non_replanifiees ?? 0} non replanifiées`} color="#f59e0b"/>
              <Stat T={T} icon={CalendarRange} label="Fins retardées" value={diff?.resume?.fin_retardee ?? 0} sub={`${diff?.resume?.fin_avancee ?? 0} avancées`} color={(diff?.resume?.fin_retardee || 0) ? "#ef4444" : "#22c55e"}/>
              <Stat T={T} icon={Users} label="Équipes modifiées" value={diff?.resume?.ressources_changees ?? 0} sub={`${diff?.resume?.fractionnement_change ?? 0} fractionnements modifiés`} color="#06b6d4"/>
            </div>

            {applyPlan && <>
              <SectionTitle T={T}>Prévisualisation d’application</SectionTitle>
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                <Stat T={T} icon={CalendarRange} label="Cellules touchées" value={apply?.cellules_impactees ?? 0} sub={`${apply?.cellules_mises_a_jour ?? 0} mise(s) à jour · ${apply?.cellules_a_creer ?? 0} création(s)`} color="#8b5cf6"/>
                <Stat T={T} icon={ShieldCheck} label="UID réutilisés" value={apply?.allocations_uid_reutilises ?? 0} sub={`${apply?.allocations_uid_nouveaux ?? 0} nouvelle(s) identité(s) seulement si nécessaire`} color="#22c55e"/>
                <Stat T={T} icon={Users} label="Allocations préservées" value={apply?.allocations_hors_scope_preservees ?? 0} sub="Manuelles, verrouillées ou hors recalcul conservées" color="#06b6d4"/>
                <Stat T={T} icon={ShieldCheck} label="Garde d’écriture" value="Obligatoire" sub="Transaction unique + compare-before-write exact" color="#f59e0b"/>
              </div>
              <div style={{ marginTop:10, padding:"10px 12px", border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.card, fontSize:11.5, lineHeight:1.45, color:T.textSub }}>
                <strong style={{ color:T.text }}>Toujours en lecture seule.</strong> Cet aperçu décrit exactement les cellules qui seraient écrites. La future application devra recharger leur état, comparer chaque <code>expected_before</code> dans une transaction unique et annuler l’ensemble si une seule cellule a changé depuis la simulation.
              </div>
              {(applyPlan.operations || []).length > 0 && <div style={{ marginTop:8, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
                {(applyPlan.operations || []).slice(0, 12).map((op, i) => <div key={op.cell_key} style={{ display:"grid", gridTemplateColumns:"minmax(210px,1fr) 90px minmax(180px,1fr)", gap:9, alignItems:"center", padding:"8px 10px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:11.5 }}>
                  <strong style={{ color:T.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{op.cell_key.replaceAll("::", " · ")}</strong>
                  <span style={{ color:op.type === "insert" ? "#8b5cf6" : "#5b8af5", fontWeight:850 }}>{op.type === "insert" ? "création" : "mise à jour"}</span>
                  <span style={{ color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(op.changed_fields || []).join(" · ") || "aucun champ"}</span>
                </div>)}
                {(applyPlan.operations || []).length > 12 && <div style={{ padding:"8px 10px", borderTop:`1px solid ${T.border}`, fontSize:11, color:T.textMuted }}>+ {(applyPlan.operations || []).length - 12} autres cellules dans le plan d’application complet.</div>}
              </div>}
            </>}

            {raisonsLisibles.length > 0 && <>
              <SectionTitle T={T}>Pourquoi le planning change</SectionTitle>
              <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
                {raisonsLisibles.slice(0, 10).map(r => <div key={r.code} style={{ flex:"1 1 260px", minWidth:0, padding:"9px 11px", border:`1px solid ${T.border}`, borderRadius:RADIUS.md, background:T.card }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7 }}><strong style={{ color:T.text, fontSize:12 }}>{r.count}×</strong><span style={{ color:T.textSub, fontSize:11.5, lineHeight:1.35 }}>{r.label}</span></div>
                </div>)}
              </div>
            </>}

            {chantiersImpactes.length > 0 && <>
              <SectionTitle T={T}>Impact par chantier</SectionTitle>
              <div style={{ border:`1px solid ${T.border}`, borderRadius:RADIUS.lg, overflow:"hidden" }}>
                {chantiersImpactes.map((c, i) => {
                  const delta = c.decalage_fin_jours;
                  const forecastIncomplete = c.forecast_courant_complet === false;
                  const incomplete = c.proposition_complete === false;
                  const col = incomplete ? "#f59e0b" : forecastIncomplete ? "#5b8af5" : delta > 0 ? "#ef4444" : delta < 0 ? "#22c55e" : T.textMuted;
                  return <div key={c.chantier_id} style={{ display:"grid", gridTemplateColumns:"minmax(150px,1fr) 110px 24px 135px 105px", gap:8, alignItems:"center", padding:"9px 11px", borderTop:i ? `1px solid ${T.border}` : "none", fontSize:12 }}>
                    <strong style={{ color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{nomsChantiers.get(c.chantier_id) || c.chantier_id}</strong>
                    <span style={{ color:forecastIncomplete ? "#f59e0b" : T.textSub, textAlign:"right" }}>{forecastIncomplete ? `incomplet (${c.taches_sans_planification_courante})` : fmtDate(c.fin_courante)}</span><Icon as={ArrowRight} size={13} color={T.textMuted}/><span style={{ color:incomplete ? "#f59e0b" : T.textSub }}>{incomplete ? `incomplet (${c.taches_non_planifiees})` : fmtDate(c.fin_proposee)}</span>
                    <span style={{ color:col, fontWeight:850, textAlign:"right" }}>{incomplete ? "à compléter" : forecastIncomplete ? "fin calculée" : delta == null ? "non comparable" : delta === 0 ? "stable" : `${delta > 0 ? "+" : ""}${delta} j`}</span>
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
                  <span style={{ color:T.textSub, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={x.detail_taches || x.texte}>{x.texte}{x.preservedCount > 0 ? " · conservé" : ""}</span>
                  <span style={{ color:T.text, fontWeight:750 }}>{x.duree} h</span>
                  <span style={{ color:T.textMuted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{(x.resource_ids || []).map(id => nomsRessources.get(id) || id).join(" + ") || "—"}</span>
                </div>
              ))}
              {blocsOperationnels.length > allocations.length && <div style={{ padding:"8px 10px", borderTop:`1px solid ${T.border}`, fontSize:11, color:T.textMuted }}>+ {blocsOperationnels.length - allocations.length} autres blocs opérationnels · {p?.allocations_proposees?.length || 0} allocations détaillées au total</div>}
            </div>

            <SectionTitle T={T}>Qualité & points à traiter</SectionTitle>
            {warnings.length === 0 ? <div style={{ padding:"10px 12px", borderRadius:RADIUS.md, background:"rgba(34,197,94,.08)", color:"#22c55e", fontSize:12, display:"flex", gap:7, alignItems:"center" }}><Icon as={CheckCircle2} size={15}/> Aucun avertissement bloquant détecté sur cet horizon.</div> :
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {warnings.slice(0, 30).map((w, i) => <div key={`${w.origine}-${w.travail_id || w.tache_id || i}-${i}`} style={{ padding:"9px 11px", border:`1px solid ${T.border}`, borderRadius:RADIUS.md, display:"flex", gap:8, alignItems:"flex-start", background:T.card }}>
                  <Icon as={TriangleAlert} size={14} color={w.origine === "Non planifié" || w.origine === "À vérifier" ? "#ef4444" : "#f59e0b"} style={{ marginTop:1, flex:"0 0 auto" }}/>
                  <div style={{ minWidth:0 }}><div style={{ fontSize:10, fontWeight:850, letterSpacing:.8, textTransform:"uppercase", color:T.textMuted }}>{w.origine}{w.chantier_id ? ` · ${nomsChantiers.get(w.chantier_id) || w.chantier_id}` : ""}{w.count > 1 ? ` · ×${w.count}` : ""}</div><div style={{ marginTop:2, fontSize:11.5, lineHeight:1.4, color:T.textSub }}>{w.explication || w.raison || w.type}</div></div>
                </div>)}
                {warnings.length > 30 && <div style={{ fontSize:11, color:T.textMuted, padding:"3px 2px" }}>+ {warnings.length - 30} autres points dans le résultat complet.</div>}
              </div>}

            <div style={{ marginTop:18, padding:"10px 12px", border:`1px dashed ${T.border}`, borderRadius:RADIUS.md, fontSize:11, lineHeight:1.45, color:T.textMuted, display:"flex", gap:8 }}>
              <Icon as={ShieldCheck} size={15} color="#22c55e" style={{ flex:"0 0 auto" }}/>
              <span><strong style={{ color:T.textSub }}>Aucune modification n'a été appliquée.</strong> Ce panneau compare le forecast actuel au planning recalculé depuis le réel et prépare seulement un plan d’application transactionnel. L'écriture restera une étape séparée avec confirmation explicite.</span>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}