import React, { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock, Plus, RefreshCw, Trash2, UserRound, Users, X } from "lucide-react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { calculerCapaciteRessourcePourDate } from "./planningResourceCapacityV1";

const todayISO = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const fmtDate = value => {
  if (!value) return "—";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("fr-FR", { day:"2-digit", month:"2-digit", year:"numeric" });
};

const TYPE_LABELS = {
  absence: "Absence",
  indisponibilite: "Indisponibilité",
  capacite_override: "Capacité exceptionnelle",
};

const emptyDraft = date => ({
  resource_id: "",
  type: "absence",
  date_debut: date,
  date_fin: date,
  toute_journee: true,
  heures_indisponibles: "",
  capacite_heures: "",
  motif: "",
});

export default function PlanningResourcesAdmin({ T, acc }) {
  const [resources, setResources] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(todayISO()));
  const [message, setMessage] = useState(null);

  const flash = (type, text) => {
    setMessage({ type, text });
    window.setTimeout(() => setMessage(null), 4500);
  };

  const charger = async () => {
    setLoading(true);
    const [rRes, eRes] = await Promise.all([
      supabase.from("planning_resources").select("*").order("actif", { ascending:false }).order("nom_planning"),
      supabase.from("planning_resource_events").select("*").eq("actif", true).order("date_debut", { ascending:true }),
    ]);
    if (rRes.error) flash("err", "Ressources : " + rRes.error.message);
    if (eRes.error) flash("err", "Indisponibilités : " + eRes.error.message);
    setResources(rRes.data || []);
    setEvents(eRes.data || []);
    setLoading(false);
  };

  useEffect(() => { charger(); }, []);

  const resourcesById = useMemo(() => new Map(resources.map(r => [r.id, r])), [resources]);
  const activePeople = useMemo(() => resources.filter(r => r.kind === "personne" && r.actif !== false), [resources]);
  const inactivePeople = useMemo(() => resources.filter(r => r.kind === "personne" && r.actif === false), [resources]);
  const external = useMemo(() => resources.filter(r => r.kind === "prestataire"), [resources]);

  const eventsForDate = resourceId => events.filter(e => {
    if (e.resource_id !== resourceId || e.actif === false) return false;
    const start = String(e.date_debut || "").slice(0, 10);
    const end = String(e.date_fin || e.date_debut || "").slice(0, 10);
    return !!start && selectedDate >= start && selectedDate <= end;
  });

  const capacity = resource => calculerCapaciteRessourcePourDate({
    resource,
    dateISO: selectedDate,
    evenements: eventsForDate(resource.id),
    heuresDejaAllouees: 0,
  });

  const openForm = resourceId => {
    setDraft({ ...emptyDraft(selectedDate), resource_id: resourceId || activePeople[0]?.id || "" });
    setShowForm(true);
  };

  const saveEvent = async () => {
    if (!draft.resource_id) { flash("err", "Choisis une ressource."); return; }
    if (!draft.date_debut) { flash("err", "La date de début est obligatoire."); return; }
    const dateFin = draft.date_fin || draft.date_debut;
    if (dateFin < draft.date_debut) { flash("err", "La date de fin ne peut pas précéder la date de début."); return; }

    const payload = {
      resource_id: draft.resource_id,
      type: draft.type,
      date_debut: draft.date_debut,
      date_fin: dateFin,
      toute_journee: draft.type === "capacite_override" ? false : !!draft.toute_journee,
      heures_indisponibles: draft.type !== "capacite_override" && !draft.toute_journee
        ? Number(draft.heures_indisponibles || 0)
        : null,
      capacite_heures: draft.type === "capacite_override" ? Number(draft.capacite_heures || 0) : null,
      motif: draft.motif.trim() || null,
      source: "manuel",
      actif: true,
    };

    if (payload.type !== "capacite_override" && !payload.toute_journee && !(payload.heures_indisponibles > 0)) {
      flash("err", "Indique le nombre d'heures indisponibles.");
      return;
    }
    if (payload.type === "capacite_override" && payload.capacite_heures < 0) {
      flash("err", "La capacité ne peut pas être négative.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("planning_resource_events").insert(payload);
    setSaving(false);
    if (error) { flash("err", "Erreur : " + error.message); return; }
    flash("ok", "Indisponibilité enregistrée.");
    setShowForm(false);
    await charger();
  };

  const deleteEvent = async id => {
    const { error } = await supabase.from("planning_resource_events").delete().eq("id", id);
    if (error) { flash("err", "Suppression impossible : " + error.message); return; }
    flash("ok", "Événement supprimé.");
    await charger();
  };

  const card = resource => {
    const c = capacity(resource);
    const dayEvents = eventsForDate(resource.id);
    const linked = !!resource.auth_user_id;
    return (
      <div key={resource.id} style={{
        background:T.surface, border:`1px solid ${T.border}`, borderRadius:RADIUS.lg,
        padding:"14px 16px", display:"flex", gap:12, alignItems:"center", flexWrap:"wrap",
      }}>
        <div style={{
          width:38,height:38,borderRadius:RADIUS.md,background:acc.bg10,color:acc.accent,
          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        }}><Icon as={UserRound} size={17}/></div>
        <div style={{flex:"1 1 190px",minWidth:160}}>
          <div style={{display:"flex",gap:7,alignItems:"center",flexWrap:"wrap"}}>
            <strong style={{fontSize:FONT.sm.size+1,color:T.text}}>{resource.nom_planning || resource.nom}</strong>
            {!resource.actif && <span style={{fontSize:10,fontWeight:800,color:T.textMuted}}>INACTIF</span>}
            {linked && <span title="Compte applicatif relié" style={{fontSize:10,fontWeight:800,color:"#22c55e"}}>COMPTE LIÉ</span>}
          </div>
          <div style={{fontSize:FONT.xs.size,color:T.textMuted,marginTop:3}}>
            {dayEvents.length ? dayEvents.map(e => TYPE_LABELS[e.type] || e.type).join(" · ") : "Aucune exception ce jour"}
          </div>
        </div>
        <div style={{minWidth:145,textAlign:"right"}}>
          <div style={{fontSize:FONT.lg.size,fontWeight:900,color:c.indisponible?"#ef4444":acc.accent}}>
            {c.capacite_disponible} h
          </div>
          <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>capacité disponible</div>
        </div>
        <button type="button" onClick={()=>openForm(resource.id)} style={{
          display:"inline-flex",alignItems:"center",gap:5,padding:"7px 10px",borderRadius:RADIUS.md,
          border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,cursor:"pointer",
          fontFamily:"inherit",fontSize:FONT.xs.size+1,fontWeight:700,
        }}><Icon as={Plus} size={12}/> Absence</button>
      </div>
    );
  };

  const sortedEvents = useMemo(() => [...events].sort((a,b) => {
    const aPast = String(a.date_fin || a.date_debut) < selectedDate ? 1 : 0;
    const bPast = String(b.date_fin || b.date_debut) < selectedDate ? 1 : 0;
    if (aPast !== bPast) return aPast - bPast;
    return String(a.date_debut).localeCompare(String(b.date_debut));
  }), [events, selectedDate]);

  return (
    <div className="ac">
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:16}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,fontWeight:800,fontSize:FONT.md.size,color:T.text}}>
            <Icon as={CalendarDays} size={17} color={acc.accent}/>
            Ressources & indisponibilités
          </div>
          <div style={{fontSize:FONT.xs.size+1,color:T.textSub,lineHeight:1.6,maxWidth:700,marginTop:5}}>
            Le rythme d'entreprise fournit la capacité normale. Cette page enregistre seulement les exceptions : congés, rendez-vous, indisponibilités partielles ou capacité exceptionnelle.
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button type="button" onClick={charger} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 12px",border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,borderRadius:RADIUS.md,fontFamily:"inherit",fontWeight:700,cursor:"pointer"}}>
            <Icon as={RefreshCw} size={12}/> Actualiser
          </button>
          <button type="button" onClick={()=>openForm()} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",border:"none",background:acc.accent,color:acc.onAccent,borderRadius:RADIUS.md,fontFamily:"inherit",fontWeight:800,cursor:"pointer"}}>
            <Icon as={Plus} size={13}/> Ajouter une indisponibilité
          </button>
        </div>
      </div>

      {message && <div style={{marginBottom:14,padding:"9px 12px",borderRadius:RADIUS.md,border:`1px solid ${message.type==="ok"?"#22c55e55":"#ef444455"}`,background:message.type==="ok"?"#22c55e12":"#ef444412",color:message.type==="ok"?"#16a34a":"#dc2626",fontSize:FONT.xs.size+1,fontWeight:700}}>{message.text}</div>}

      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:14,padding:"10px 12px",background:T.card,border:`1px solid ${T.border}`,borderRadius:RADIUS.lg}}>
        <Icon as={Clock} size={14} color={acc.accent}/>
        <label style={{fontSize:FONT.xs.size+1,fontWeight:700,color:T.textSub}}>Capacité affichée pour le</label>
        <input className="ti" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} style={{width:150}}/>
        <div style={{fontSize:FONT.xs.size,color:T.textMuted}}>Les heures déjà planifiées seront déduites automatiquement lors du raccordement au planning.</div>
      </div>

      {loading ? <div style={{padding:24,color:T.textMuted}}>Chargement…</div> : (
        <>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>{activePeople.map(card)}</div>
          {external.length > 0 && <div style={{marginTop:16,padding:"10px 12px",border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,color:T.textMuted,fontSize:FONT.xs.size+1}}>
            <strong style={{color:T.textSub}}>Prestataires :</strong> {external.map(r=>r.nom_planning||r.nom).join(", ")}. Leur capacité n'est jamais déduite du rythme salarié ; elle doit être positionnée explicitement.
          </div>}
          {inactivePeople.length > 0 && <details style={{marginTop:16}}><summary style={{cursor:"pointer",fontSize:FONT.xs.size+1,fontWeight:700,color:T.textMuted}}>Ressources inactives ({inactivePeople.length})</summary><div style={{display:"flex",flexDirection:"column",gap:8,marginTop:8}}>{inactivePeople.map(card)}</div></details>}
        </>
      )}

      <div style={{marginTop:24,marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
        <Icon as={Users} size={15} color={acc.accent}/>
        <strong style={{fontSize:FONT.sm.size+1,color:T.text}}>Indisponibilités enregistrées</strong>
      </div>
      {sortedEvents.length === 0 ? (
        <div style={{padding:"14px 16px",border:`1px dashed ${T.border}`,borderRadius:RADIUS.md,color:T.textMuted,fontSize:FONT.xs.size+1}}>Aucune indisponibilité enregistrée.</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:7}}>
          {sortedEvents.map(e => {
            const resource = resourcesById.get(e.resource_id);
            return <div key={e.id} style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",border:`1px solid ${T.border}`,borderRadius:RADIUS.md,background:T.surface}}>
              <div style={{minWidth:135,fontWeight:800,fontSize:FONT.xs.size+1,color:T.text}}>{resource?.nom_planning || "Ressource inconnue"}</div>
              <div style={{fontSize:FONT.xs.size+1,color:T.textSub}}>{TYPE_LABELS[e.type] || e.type}</div>
              <div style={{fontSize:FONT.xs.size+1,color:T.textMuted}}>{fmtDate(e.date_debut)}{e.date_fin && e.date_fin !== e.date_debut ? ` → ${fmtDate(e.date_fin)}` : ""}</div>
              <div style={{fontSize:FONT.xs.size+1,color:T.textSub,flex:1,minWidth:140}}>
                {e.type === "capacite_override" ? `${e.capacite_heures ?? 0} h disponibles` : e.toute_journee ? "Journée entière" : `${e.heures_indisponibles ?? 0} h indisponibles`}
                {e.motif ? ` · ${e.motif}` : ""}
              </div>
              <button type="button" onClick={()=>deleteEvent(e.id)} title="Supprimer" style={{border:"none",background:"transparent",color:"#ef4444",cursor:"pointer",padding:5}}><Icon as={Trash2} size={13}/></button>
            </div>;
          })}
        </div>
      )}

      {showForm && <div onClick={()=>setShowForm(false)} style={{position:"fixed",inset:0,zIndex:1200,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,backdropFilter:"blur(4px)"}}>
        <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:560,background:T.modal||T.surface,border:`1px solid ${T.border}`,borderRadius:RADIUS.xl,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",marginBottom:16}}>
            <strong style={{fontSize:FONT.lg.size,color:T.text}}>Nouvelle indisponibilité</strong>
            <button onClick={()=>setShowForm(false)} style={{border:"none",background:"transparent",color:T.textMuted,cursor:"pointer"}}><Icon as={X} size={17}/></button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <label style={{gridColumn:"1 / -1",fontSize:FONT.xs.size+1,color:T.textSub}}>Ressource
              <select className="ti" value={draft.resource_id} onChange={e=>setDraft(d=>({...d,resource_id:e.target.value}))} style={{width:"100%",marginTop:5}}>
                <option value="">Choisir…</option>{activePeople.map(r=><option key={r.id} value={r.id}>{r.nom_planning||r.nom}</option>)}
              </select>
            </label>
            <label style={{gridColumn:"1 / -1",fontSize:FONT.xs.size+1,color:T.textSub}}>Type
              <select className="ti" value={draft.type} onChange={e=>setDraft(d=>({...d,type:e.target.value}))} style={{width:"100%",marginTop:5}}>
                <option value="absence">Absence</option><option value="indisponibilite">Indisponibilité</option><option value="capacite_override">Capacité exceptionnelle</option>
              </select>
            </label>
            <label style={{fontSize:FONT.xs.size+1,color:T.textSub}}>Début<input className="ti" type="date" value={draft.date_debut} onChange={e=>setDraft(d=>({...d,date_debut:e.target.value,date_fin:d.date_fin||e.target.value}))} style={{width:"100%",marginTop:5}}/></label>
            <label style={{fontSize:FONT.xs.size+1,color:T.textSub}}>Fin<input className="ti" type="date" value={draft.date_fin} onChange={e=>setDraft(d=>({...d,date_fin:e.target.value}))} style={{width:"100%",marginTop:5}}/></label>
            {draft.type !== "capacite_override" && <label style={{gridColumn:"1 / -1",display:"flex",alignItems:"center",gap:8,fontSize:FONT.xs.size+1,color:T.textSub}}><input type="checkbox" checked={draft.toute_journee} onChange={e=>setDraft(d=>({...d,toute_journee:e.target.checked}))}/> Journée entière</label>}
            {draft.type !== "capacite_override" && !draft.toute_journee && <label style={{gridColumn:"1 / -1",fontSize:FONT.xs.size+1,color:T.textSub}}>Heures indisponibles<input className="ti" type="number" min="0" step="0.5" value={draft.heures_indisponibles} onChange={e=>setDraft(d=>({...d,heures_indisponibles:e.target.value}))} style={{width:"100%",marginTop:5}}/></label>}
            {draft.type === "capacite_override" && <label style={{gridColumn:"1 / -1",fontSize:FONT.xs.size+1,color:T.textSub}}>Capacité planifiable ce jour<input className="ti" type="number" min="0" step="0.5" value={draft.capacite_heures} onChange={e=>setDraft(d=>({...d,capacite_heures:e.target.value}))} style={{width:"100%",marginTop:5}}/></label>}
            <label style={{gridColumn:"1 / -1",fontSize:FONT.xs.size+1,color:T.textSub}}>Motif / note<input className="ti" value={draft.motif} onChange={e=>setDraft(d=>({...d,motif:e.target.value}))} placeholder="Congé, rendez-vous, formation…" style={{width:"100%",marginTop:5}}/></label>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}}>
            <button onClick={()=>setShowForm(false)} style={{padding:"8px 14px",borderRadius:RADIUS.md,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,fontFamily:"inherit",cursor:"pointer"}}>Annuler</button>
            <button onClick={saveEvent} disabled={saving} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:RADIUS.md,border:"none",background:acc.accent,color:acc.onAccent,fontFamily:"inherit",fontWeight:800,cursor:saving?"default":"pointer",opacity:saving ? 0.6 : 1}}><Icon as={Check} size={13}/>{saving?"Enregistrement…":"Enregistrer"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
