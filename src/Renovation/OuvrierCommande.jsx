import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import { ShoppingCart, Camera, X, Send, AlertTriangle, Clock, CheckCircle2, Ban, Building2, RotateCw } from "lucide-react";
import { MobileCard, MobileEmptyState, Pill } from "../mobileUI";
import { uploadRapportPhoto } from "./RapportMobile";

const STATUTS = {
  en_attente: { label: "En attente", color: "#f59e0b", icon: Clock },
  traite:     { label: "Traité",     color: "#22c55e", icon: CheckCircle2 },
  annule:     { label: "Annulé",     color: "#8a9ab0", icon: Ban },
};

export default function OuvrierCommande({ prenom, T, accent = "#FFC200" }) {
  const [chantiers, setChantiers] = useState(DEFAULT_CHANTIERS);
  const [besoins, setBesoins]     = useState([]);
  const [loading, setLoading]     = useState(true);

  // Formulaire
  const [article, setArticle]     = useState("");
  const [quantite, setQuantite]   = useState("");
  const [chantierId, setChantierId] = useState("");
  const [urgent, setUrgent]       = useState(false);
  const [notes, setNotes]         = useState("");
  const [photo, setPhoto]         = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const chargerBesoins = async () => {
    // La RLS ne renvoie que les besoins de l'ouvrier connecté.
    const { data } = await supabase.from("besoins")
      .select("id, chantier_id, article, quantite, statut, priorite, photo_url, notes, created_at")
      .order("created_at", { ascending: false });
    setBesoins(data || []);
    setLoading(false);
  };

  useEffect(() => {
    supabase.from("planning_config").select("value").eq("key", "chantiers").maybeSingle()
      .then(({ data }) => { if (Array.isArray(data?.value) && data.value.length) setChantiers(data.value); });
    chargerBesoins();
  }, []);

  const nomChantier = (id) => chantiers.find(c => c.id === id)?.nom || id || "—";
  const couleurChantier = (id) => chantiers.find(c => c.id === id)?.couleur || "#5b8af5";

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const res = await uploadRapportPhoto(file, `besoins/${prenom}`);
    setUploading(false);
    if (res.url) setPhoto(res.url);
    else alert("Échec de l'envoi de la photo : " + (res.error || ""));
    e.target.value = "";
  };

  const soumettre = async () => {
    if (!article.trim()) { alert("Indique au moins l'article ou la description."); return; }
    setSubmitting(true);
    const { error } = await supabase.from("besoins").insert({
      chantier_id: chantierId || null,
      article: article.trim(),
      quantite: quantite.trim() || null,
      ouvrier_demandeur: prenom,
      origine: "ouvrier",
      statut: "en_attente",
      priorite: urgent ? "urgent" : "normal",
      photo_url: photo || null,
      notes: notes.trim() || null,
    });
    setSubmitting(false);
    if (error) { alert("Erreur à l'envoi : " + error.message); return; }
    // Reset + recharge la liste
    setArticle(""); setQuantite(""); setChantierId(""); setUrgent(false); setNotes(""); setPhoto("");
    chargerBesoins();
  };

  const input = {
    width:"100%", border:`1.5px solid ${T.border}`, borderRadius:12, padding:"12px 12px",
    fontSize:16, fontFamily:"inherit", outline:"none", boxSizing:"border-box",
    color:T.text, background:T.surface,
  };
  const label = { fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, marginBottom:6, display:"block" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* ── Formulaire ── */}
      <MobileCard T={T} accent={accent} style={{ padding:"16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <Icon as={ShoppingCart} size={17} color={accent} strokeWidth={2.3}/>
          <span style={{ fontSize:16, fontWeight:800, color:T.text }}>Nouvelle demande</span>
        </div>

        <div style={{ marginBottom:12 }}>
          <label style={label}>Article / description *</label>
          <input style={input} value={article} onChange={e=>setArticle(e.target.value)} placeholder="Ex : sacs de MAP, vis 5x70…"/>
        </div>

        <div style={{ display:"flex", gap:10, marginBottom:12 }}>
          <div style={{ flex:"0 0 120px" }}>
            <label style={label}>Quantité</label>
            <input style={input} value={quantite} onChange={e=>setQuantite(e.target.value)} placeholder="2 sacs"/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <label style={label}>Chantier</label>
            <select style={input} value={chantierId} onChange={e=>setChantierId(e.target.value)}>
              <option value="">— Aucun —</option>
              {chantiers.filter(c=>!c.archive).map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
        </div>

        {/* Urgence */}
        <div style={{ marginBottom:12 }}>
          <label style={label}>Priorité</label>
          <div style={{ display:"flex", gap:8 }}>
            {[{v:false,l:"Normal",c:"#c0a060"},{v:true,l:"Urgent",c:"#e05c5c"}].map(o => (
              <button key={o.l} onClick={()=>setUrgent(o.v)} style={{
                flex:1, padding:"10px 0", borderRadius:12, border:"1.5px solid", cursor:"pointer", fontFamily:"inherit",
                fontSize:14, fontWeight:700,
                borderColor: urgent===o.v ? o.c : T.border,
                background: urgent===o.v ? `${o.c}18` : T.surface,
                color: urgent===o.v ? o.c : T.textMuted,
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
              }}>
                {o.v && <Icon as={AlertTriangle} size={13} strokeWidth={2.3}/>}
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom:12 }}>
          <label style={label}>Précisions (optionnel)</label>
          <textarea style={{...input, resize:"none", minHeight:56}} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Référence, marque, où le déposer…"/>
        </div>

        {/* Photo */}
        <div style={{ marginBottom:16 }}>
          <label style={label}>Photo (optionnel)</label>
          {photo ? (
            <div style={{ position:"relative", width:80, height:80 }}>
              <img src={photo} alt="" style={{ width:"100%", height:"100%", objectFit:"cover", borderRadius:12, border:`1px solid ${T.border}` }}/>
              <button onClick={()=>setPhoto("")} style={{ position:"absolute", top:-6, right:-6, width:24, height:24, borderRadius:"50%",
                background:"#1a1f2e", color:"#fff", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <Icon as={X} size={13} strokeWidth={2.5}/>
              </button>
            </div>
          ) : (
            <label style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"10px 14px", borderRadius:12,
              border:`1.5px dashed ${T.border}`, background:T.surface, color:T.textSub, fontWeight:700, fontSize:14, cursor:"pointer" }}>
              <Icon as={uploading ? RotateCw : Camera} size={15} strokeWidth={2.2} style={uploading ? {animation:"spin 1s linear infinite"} : {}}/>
              {uploading ? "Envoi…" : "Ajouter une photo"}
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display:"none" }} disabled={uploading}/>
            </label>
          )}
        </div>

        <button onClick={soumettre} disabled={submitting || uploading || !article.trim()} style={{
          width:"100%", padding:"15px", border:"none", borderRadius:14,
          background: (submitting || !article.trim()) ? T.border : `linear-gradient(135deg, ${accent}, ${accent}cc)`,
          color:"#1a1f2e", fontFamily:"inherit", fontSize:16, fontWeight:800,
          cursor: (submitting || !article.trim()) ? "not-allowed" : "pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          boxShadow: (submitting || !article.trim()) ? "none" : `0 6px 18px ${accent}55`,
        }}>
          <Icon as={submitting ? RotateCw : Send} size={16} strokeWidth={2.3} style={submitting ? {animation:"spin 1s linear infinite"} : {}}/>
          {submitting ? "Envoi…" : "Envoyer ma demande"}
        </button>
      </MobileCard>

      {/* ── Mes demandes ── */}
      <div style={{ fontSize:13, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, padding:"4px 4px 0" }}>
        Mes demandes
      </div>

      {loading ? (
        <div style={{ padding:"30px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
      ) : besoins.length === 0 ? (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={ShoppingCart} title="Aucune demande pour l'instant"
            hint="Tes demandes de matériel apparaîtront ici avec leur statut." />
        </MobileCard>
      ) : (
        besoins.map(b => {
          const st = STATUTS[b.statut] || STATUTS.en_attente;
          const urg = b.priorite === "urgent";
          const d = b.created_at ? new Date(b.created_at).toLocaleDateString("fr-FR", { day:"2-digit", month:"short" }) : "";
          return (
            <MobileCard key={b.id} T={T} accent={urg ? "#e05c5c" : couleurChantier(b.chantier_id)} style={{ padding:"13px 15px" }}>
              <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                {b.photo_url && (
                  <img src={b.photo_url} alt="" onClick={()=>window.open(b.photo_url,"_blank")}
                    style={{ width:52, height:52, objectFit:"cover", borderRadius:10, border:`1px solid ${T.border}`, flexShrink:0, cursor:"pointer" }}/>
                )}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:3 }}>
                    <span style={{ fontSize:15, fontWeight:800, color:T.text }}>{b.article}</span>
                    {b.quantite && <span style={{ fontSize:13, color:T.textSub, fontWeight:600 }}>· {b.quantite}</span>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12.5, color:T.textMuted }}>
                    {b.chantier_id && (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                        <Icon as={Building2} size={11}/> {nomChantier(b.chantier_id)}
                      </span>
                    )}
                    {d && <span>{d}</span>}
                  </div>
                  {b.notes && <div style={{ fontSize:12.5, color:T.textSub, marginTop:4, lineHeight:1.4 }}>{b.notes}</div>}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                <Pill color={st.color}><Icon as={st.icon} size={12} strokeWidth={2.3}/> {st.label}</Pill>
                {urg && <Pill color="#e05c5c"><Icon as={AlertTriangle} size={12} strokeWidth={2.3}/> Urgent</Pill>}
              </div>
            </MobileCard>
          );
        })
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
