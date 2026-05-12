import React, { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { getTodayJour, getBranchAccent, FONT, RADIUS, SPACING } from "./constants";
import { Icon } from "./ui";
import {
  HardHat, TriangleAlert, Link2, Calendar, Mail, StickyNote, HardDrive,
  MessageCircle, Folder, Plus, Check, X, ExternalLink, Pencil, Settings,
} from "lucide-react";

// ─── WIDGET CONTAINER ─────────────────────────────────────────────────────────
function DashWidget({ title, icon: IconComp, children, action, T, accent = "#FFC200" }) {
  return (
    <div style={{
      background: T.widgetBg,
      border: `1px solid ${T.border}`,
      borderRadius: RADIUS.xl,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 20px 12px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid ${T.sectionDivider}`,
        gap: SPACING.md,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {IconComp && (
            <div style={{
              width: 28, height: 28, borderRadius: RADIUS.md,
              background: accent + "1a",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: accent, flexShrink: 0,
            }}>
              <Icon as={IconComp} size={16} strokeWidth={2} />
            </div>
          )}
          <div style={{
            fontSize: FONT.xs.size,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: T.textSub,
          }}>{title}</div>
        </div>
        {action}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

// ─── LIEN EXTERNE ─────────────────────────────────────────────────────────────
function DashExternalBtn({ href, icon: IconComp, label, color = "#5b8af5", T }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px",
      borderRadius: RADIUS.md,
      border: `1px solid ${T.border}`,
      background: T.card,
      color: T.text,
      textDecoration: "none",
      fontSize: FONT.base.size,
      fontWeight: 600,
      transition: "border-color .15s, background .15s",
      marginBottom: 8,
    }}
    onMouseEnter={e => { e.currentTarget.style.background = T.cardHover; e.currentTarget.style.borderColor = color + "66"; }}
    onMouseLeave={e => { e.currentTarget.style.background = T.card; e.currentTarget.style.borderColor = T.border; }}>
      <div style={{
        width: 28, height: 28, borderRadius: RADIUS.md,
        background: color + "1f", color: color,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <Icon as={IconComp} size={16} strokeWidth={2} />
      </div>
      <span style={{ flex: 1 }}>{label}</span>
      <Icon as={ExternalLink} size={14} color={T.textMuted} />
    </a>
  );
}

// ─── PAGE DASHBOARD ───────────────────────────────────────────────────────────
function PageDashboard({ chantiers, cells, commandes, notesData, weekId, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const todayJour = getTodayJour();
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Bonjour" : "Bon après-midi";

  // Chantiers actifs aujourd'hui
  const chantiersAujourdHui = todayJour ? chantiers.map(c => {
    const cell = cells[`${c.id}_${todayJour}`] || { planifie:"", reel:"", ouvriers:[] };
    return { ...c, cell };
  }).filter(c => c.cell.ouvriers?.length > 0 || c.cell.planifie) : [];

  // Commandes urgentes (à commander)
  const [cmdDetails, setCmdDetails] = useState([]);
  useEffect(() => {
    supabase.from("commandes_detail").select("*").eq("statut", "a_commander")
      .then(({ data }) => setCmdDetails(data || []));
  }, []);

  // Config liens Google (stockée localement)
  const [calEmbed, setCalEmbed] = useState(() => localStorage.getItem("gcal_embed") || "");
  const [driveLinks, setDriveLinks] = useState(() => {
    try { return JSON.parse(localStorage.getItem("drive_links") || "[]"); } catch { return []; }
  });
  const [editLinks, setEditLinks] = useState(false);
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");

  const saveCalEmbed = (v) => { setCalEmbed(v); localStorage.setItem("gcal_embed", v); };
  const addDriveLink = () => {
    if (!newLinkName.trim() || !newLinkUrl.trim()) return;
    const updated = [...driveLinks, { name: newLinkName.trim(), url: newLinkUrl.trim() }];
    setDriveLinks(updated);
    localStorage.setItem("drive_links", JSON.stringify(updated));
    setNewLinkName(""); setNewLinkUrl("");
  };
  const removeDriveLink = (i) => {
    const updated = driveLinks.filter((_, idx) => idx !== i);
    setDriveLinks(updated);
    localStorage.setItem("drive_links", JSON.stringify(updated));
  };

  return (
    <div className="page-padding dashboard-page" style={{ flex:1, overflowY:"auto", padding:"28px 32px" }}>
      <style>{`
        @media (max-width:767px) {
          .dashboard-page .dash-title{font-size:26px!important;letter-spacing:.3px!important}
          .dashboard-page .dash-subtitle{font-size:13px!important}
          .dashboard-page .dash-greeting-block{margin-bottom:16px!important}
          .dashboard-page iframe{height:380px!important}
          .dashboard-page .dash-chantier-item{padding:12px!important;gap:10px!important}
          .dashboard-page .dash-chantier-name{font-size:15px!important}
          .dashboard-page .dash-chantier-plan{font-size:13px!important}
          .dashboard-page .dashboard-row-1,.dashboard-page .dashboard-row-2{grid-template-columns:1fr!important}
        }
      `}</style>

      {/* En-tête */}
      <div className="dash-greeting-block" style={{ marginBottom: 32 }}>
        <div className="dash-subtitle" style={{
          fontSize: FONT.sm.size,
          color: T.textMuted,
          marginBottom: 4,
          letterSpacing: .3,
          textTransform: "capitalize",
        }}>
          {now.toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}
        </div>
        <div className="dash-title" style={{
          fontSize: FONT.h1.size + 4,
          fontWeight: 800,
          letterSpacing: -0.4,
          lineHeight: 1.1,
          color: T.text,
        }}>{greeting}</div>
      </div>

      {/* Rangée 1 : Chantiers (2/3) + Commandes urgentes (1/3) */}
      <div className="dashboard-row-1" style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:20, marginBottom:20 }}>

        <DashWidget T={T} accent={acc.accent} title="Chantiers aujourd'hui" icon={HardHat}>
          {!todayJour ? (
            <div style={{ color:T.textSub, fontSize:FONT.base.size, padding:"4px 0" }}>
              C'est le week-end — aucune activité prévue.
            </div>
          ) : chantiersAujourdHui.length === 0 ? (
            <div style={{ color:T.textSub, fontSize:FONT.base.size, padding:"4px 0", lineHeight:1.6 }}>
              Aucun ouvrier planifié pour {todayJour}.<br/>
              <span style={{ color:T.textMuted }}>Ouvre le planning pour remplir la journée.</span>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {chantiersAujourdHui.map(c => (
                <div key={c.id} className="dash-chantier-item" style={{
                  display:"flex", alignItems:"flex-start", gap:14,
                  padding:"14px 16px",
                  borderRadius: RADIUS.lg,
                  background: c.couleur + "1c",
                  border: `1px solid ${c.couleur}44`,
                }}>
                  <div style={{
                    width:4, alignSelf:"stretch",
                    borderRadius:2, background:c.couleur,
                    marginTop:2, marginBottom:2, flexShrink:0,
                  }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="dash-chantier-name" style={{
                      fontWeight: 700, fontSize: FONT.md.size,
                      color: T.text, marginBottom: 6,
                    }}>{c.nom}</div>
                    {c.cell.planifie && (
                      <div className="dash-chantier-plan" style={{
                        fontSize: FONT.sm.size + 1, color: T.textSub,
                        lineHeight: 1.55, marginBottom: 10, whiteSpace: "pre-wrap",
                      }}>{c.cell.planifie}</div>
                    )}
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                      {c.cell.ouvriers.map(o => (
                        <span key={o} style={{
                          background: c.couleur, color: "#1a1f2e",
                          borderRadius: RADIUS.sm + 2,
                          padding: "2px 9px",
                          fontSize: FONT.xs.size + 1, fontWeight: 700,
                          letterSpacing: .2,
                        }}>{o}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashWidget>

        <DashWidget T={T} accent="#e15a5a" title="Commandes urgentes" icon={TriangleAlert}>
          {cmdDetails.length === 0 ? (
            <div style={{ display:"flex", alignItems:"center", gap:8, color:T.textSub, fontSize:FONT.base.size }}>
              <Icon as={Check} size={16} color="#4caf78"/>
              <span>Aucune commande en attente</span>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
              {cmdDetails.slice(0, 7).map(c => {
                const ch = chantiers.find(x => x.id === c.chantier_id);
                return (
                  <div key={c.id} style={{
                    fontSize: FONT.sm.size + 1,
                    display: "flex", alignItems: "center", gap: 9,
                    padding: "9px 12px",
                    borderRadius: RADIUS.md,
                    background: "rgba(225,90,90,0.08)",
                    border: "1px solid rgba(225,90,90,0.20)",
                  }}>
                    {ch && <span style={{ width:8, height:8, borderRadius:2, background:ch.couleur, display:"block", flexShrink:0 }}/>}
                    <span style={{ flex:1, color:T.text, fontWeight:600 }}>{c.article}</span>
                    {ch && <span style={{ fontSize:FONT.xs.size, color:T.textMuted }}>{ch.nom}</span>}
                  </div>
                );
              })}
              {cmdDetails.length > 7 && (
                <div style={{ fontSize:FONT.xs.size + 1, color:T.textMuted, paddingTop:4 }}>
                  +{cmdDetails.length - 7} autres
                </div>
              )}
            </div>
          )}
        </DashWidget>
      </div>

      {/* Rangée 2 : Accès rapides (1/3) + Agenda large (2/3) */}
      <div className="dashboard-row-2" style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:20, marginBottom:24 }}>

        <DashWidget T={T} accent={acc.accent} title="Accès rapides" icon={Link2}
          action={
            <button onClick={() => setEditLinks(!editLinks)} style={{
              display:"inline-flex", alignItems:"center", gap:5,
              background: editLinks ? acc.bg10 : "transparent",
              border: `1px solid ${editLinks ? acc.border : T.border}`,
              borderRadius: RADIUS.md,
              padding: "4px 10px",
              color: editLinks ? acc.accent : T.textSub,
              fontSize: FONT.xs.size + 1,
              fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              <Icon as={editLinks ? Check : Pencil} size={12}/>
              {editLinks ? "Terminer" : "Modifier"}
            </button>
          }>
          <DashExternalBtn T={T} href="https://mail.google.com"     icon={Mail}           label="Gmail"          color="#ea4335"/>
          <DashExternalBtn T={T} href="https://calendar.google.com" icon={Calendar}       label="Google Agenda"  color="#4285f4"/>
          <DashExternalBtn T={T} href="https://keep.google.com"     icon={StickyNote}     label="Google Keep"    color="#fbbc04"/>
          <DashExternalBtn T={T} href="https://drive.google.com"    icon={HardDrive}      label="Google Drive"   color="#34a853"/>
          <DashExternalBtn T={T} href="https://web.whatsapp.com"    icon={MessageCircle}  label="WhatsApp Web"   color="#25d366"/>

          {driveLinks.length > 0 && <>
            <div style={{
              fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.5,
              textTransform: "uppercase",
              color: T.textMuted,
              margin: "14px 0 8px",
            }}>Dossiers Drive</div>
            {driveLinks.map((l, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ flex:1 }}>
                  <DashExternalBtn T={T} href={l.url} icon={Folder} label={l.name} color="#34a853"/>
                </div>
                {editLinks && (
                  <button onClick={() => removeDriveLink(i)} title="Supprimer" style={{
                    background:"transparent", border:"none", color:"#e15a5a",
                    cursor:"pointer", flexShrink:0, padding:6,
                    display:"flex", alignItems:"center",
                  }}>
                    <Icon as={Trash2} size={14}/>
                  </button>
                )}
              </div>
            ))}
          </>}

          {editLinks && (
            <div style={{
              marginTop: 14, display: "flex", flexDirection: "column", gap: 8,
              paddingTop: 14, borderTop: `1px solid ${T.sectionDivider}`,
            }}>
              <div style={{
                fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1.5,
                textTransform: "uppercase", color: T.textMuted,
              }}>Ajouter un dossier</div>
              <input value={newLinkName} onChange={e => setNewLinkName(e.target.value)} placeholder="Nom"
                style={{
                  background: T.inputBg, border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md, padding: "9px 12px",
                  color: T.text, fontSize: FONT.base.size,
                  fontFamily: "inherit", outline: "none",
                }}/>
              <input value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="URL Drive"
                style={{
                  background: T.inputBg, border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md, padding: "9px 12px",
                  color: T.text, fontSize: FONT.base.size,
                  fontFamily: "inherit", outline: "none",
                }}/>
              <button onClick={addDriveLink} style={{
                display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6,
                background: acc.accent, color: acc.onAccent, border: "none",
                borderRadius: RADIUS.md, padding: "10px",
                fontFamily: "inherit", fontSize: FONT.base.size, fontWeight: 700, cursor: "pointer",
              }}>
                <Icon as={Plus} size={15}/>
                Ajouter
              </button>
            </div>
          )}
        </DashWidget>

        {/* AGENDA — large, hauteur généreuse */}
        <DashWidget T={T} accent="#4285f4" title="Mon agenda" icon={Calendar}
          action={
            <button onClick={() => { const url = prompt("Colle l'URL d'intégration Google Calendar :", calEmbed); if (url !== null) saveCalEmbed(url.trim()); }}
              style={{
                display:"inline-flex", alignItems:"center", gap:5,
                background:"transparent",
                border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md,
                padding: "4px 10px",
                color: T.textSub,
                fontSize: FONT.xs.size + 1, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}>
              <Icon as={Pencil} size={12}/>
              {calEmbed ? "Modifier" : "Configurer"}
            </button>
          }>
          {calEmbed ? (
            <iframe src={calEmbed} style={{ width:"100%", height:480, border:"none", borderRadius:RADIUS.lg, display:"block" }} title="Google Agenda"/>
          ) : (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "50px 20px", textAlign: "center", minHeight: 300,
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: RADIUS.xl,
                background: "rgba(66,133,244,0.12)",
                color: "#4285f4",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 18,
              }}>
                <Icon as={Calendar} size={28} strokeWidth={2}/>
              </div>
              <div style={{ fontSize: FONT.lg.size, color: T.text, fontWeight: 700, marginBottom: 8 }}>
                Intègre ton agenda Google
              </div>
              <div style={{
                fontSize: FONT.base.size, color: T.textSub,
                lineHeight: 1.65, marginBottom: 22, maxWidth: 420,
                display:"inline-flex", flexDirection:"column", gap:4,
              }}>
                <span>Va sur <strong>calendar.google.com</strong></span>
                <span style={{display:"inline-flex",alignItems:"center",gap:5,justifyContent:"center"}}>
                  <Icon as={Settings} size={13}/> Paramètres → clique sur ton calendrier à gauche
                </span>
                <span>Section <strong>"Intégrer le calendrier"</strong> → copie l'<strong>Adresse intégrable</strong></span>
              </div>
              <button onClick={() => { const url = prompt("Adresse intégrable Google Calendar :"); if (url) saveCalEmbed(url.trim()); }}
                style={{
                  display:"inline-flex", alignItems:"center", gap:8,
                  background: acc.accent, color: acc.onAccent,
                  border: "none", borderRadius: RADIUS.lg,
                  padding: "12px 24px",
                  fontFamily: "inherit", fontSize: FONT.base.size,
                  fontWeight: 700, cursor: "pointer",
                }}>
                Coller l'URL et activer
              </button>
            </div>
          )}
        </DashWidget>
      </div>
    </div>
  );
}

export default PageDashboard;
