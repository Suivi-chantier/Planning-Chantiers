import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { JOURS, getCurrentWeek, getWeekId, getTodayJour, DEFAULT_CHANTIERS, loadEquipes } from "../constants";
import { getISOWeek, mondayOfWeek } from "../rythmeSemaine";
import { normaliserNomRessource } from "./planningResourceModelV1";
import { Icon } from "../ui";
import { MapPin, CalendarX, Building2, CalendarDays, Users, ChevronLeft, ChevronRight, Undo2 } from "lucide-react";
import { MobileCard, MobileEmptyState, MobileTabs } from "../mobileUI";
import { NavButtons } from "./ouvrierNav";

const MOIS = ["janv.","févr.","mars","avr.","mai","juin","juil.","août","sept.","oct.","nov.","déc."];
const ABBR = { Lundi:"Lun", Mardi:"Mar", Mercredi:"Mer", Jeudi:"Jeu", Vendredi:"Ven" };

// Semaine à afficher : la semaine en cours, sauf vendredi/samedi/dimanche
// où on bascule sur la semaine suivante (le vendredi on prépare la suite).
function semaineCible() {
  const jsDay = new Date().getDay(); // 0=dim, 5=ven, 6=sam
  const showNext = jsDay === 0 || jsDay === 5 || jsDay === 6;
  const cur = getCurrentWeek();
  let year = cur.year, week = cur.week;
  if (showNext) { if (week >= 52) { year += 1; week = 1; } else week += 1; }
  return { year, week, showNext };
}

// estResponsable / equipesResponsable : qualité de chef DÉRIVÉE côté SQL
// (RPC mon_profil_espace, voir EspaceOuvrier). Pour un ouvrier non-chef,
// le rendu est strictement celui d'avant : pas de sélecteur, vue « Moi ».
export default function OuvrierPlanning({ prenom, T, accent = "#FFC200", estResponsable = false, equipesResponsable = [] }) {
  // Semaine affichée : par défaut la cible (courante, ou suivante dès vendredi),
  // navigable librement avec les flèches ‹ › (retour rapide via le bouton dédié).
  const cible = semaineCible();
  const [sem, setSem] = useState({ year: cible.year, week: cible.week });
  const { year, week } = sem;
  const weekId    = getWeekId(year, week);
  const todayJour = getTodayJour();
  const cur       = getCurrentWeek();

  const [loading, setLoading]   = useState(true);
  const [rawCells, setRawCells] = useState([]);
  const [config, setConfig]     = useState({ chantiers: DEFAULT_CHANTIERS, adresses: {} });
  // Jour sélectionné : aujourd'hui si semaine en cours, sinon lundi (semaine suivante).
  const [jour, setJour] = useState(cible.showNext ? "Lundi" : (todayJour || "Lundi"));

  // Vue chef d'équipe : Moi (défaut) / Mon équipe / Tout. Le référentiel
  // complet des équipes (couleurs, membres) n'est chargé que pour un chef —
  // uniquement pour l'AFFICHAGE (puces, pastilles) : le droit de voir les
  // cellules vient de la RLS (policy cells_responsable_sel).
  const [vue, setVue]           = useState("moi");
  const [equipes, setEquipes]   = useState([]);
  const [filtreEq, setFiltreEq] = useState(null); // id d'équipe, null = toutes
  const vueActive = estResponsable ? vue : "moi";

  useEffect(() => {
    if (!estResponsable) return;
    let cancelled = false;
    loadEquipes().then(eqs => { if (!cancelled) setEquipes(eqs); });
    return () => { cancelled = true; };
  }, [estResponsable]);

  // Navigation de semaine (ISO : gère les années à 52/53 semaines via les dates).
  const allerSemaine = (y, w) => {
    setSem({ year: y, week: w });
    setJour(getWeekId(y, w) === getWeekId(cur.year, cur.week) ? (todayJour || "Lundi") : "Lundi");
  };
  const shiftSemaine = (delta) => {
    const mon = mondayOfWeek(year, week);
    mon.setDate(mon.getDate() + delta * 7);
    const s = getISOWeek(mon);
    allerSemaine(s.year, s.week);
  };
  // Écart en semaines avec la semaine en cours (pour le libellé).
  const offset = Math.round((mondayOfWeek(year, week) - mondayOfWeek(cur.year, cur.week)) / (7 * 864e5));
  const libSem = offset === 0 ? "Cette semaine"
    : offset === 1  ? "Semaine prochaine"
    : offset === -1 ? "Semaine dernière"
    : `Semaine ${week} · ${year}`;
  const horsCible = weekId !== getWeekId(cible.year, cible.week);

  // Lundi + décalage (même calcul ISO que le Planning conducteur).
  const dateDuJour = (dayIndex) => {
    const jan4 = new Date(year, 0, 4);
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - (((jan4.getDay() || 7) - 1)) + (week - 1) * 7);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayIndex);
    return d;
  };
  const fmtJour = (d) => `${d.getDate()} ${MOIS[d.getMonth()]}`;

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

  // La RLS décide de ce qui revient : ses cellules pour un ouvrier, toutes
  // pour un chef (cells_responsable_sel). Le filtrage par vue se fait ensuite
  // en mémoire, sans nouvelle requête.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.from("planning_cells").select("*").eq("week_id", weekId).then(({ data }) => {
      if (cancelled) return;
      setRawCells(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekId]);

  // ── Correspondances équipes (chef uniquement) ──────────────────────────────
  // prénom normalisé → équipe (première équipe qui le porte, responsable inclus).
  const equipeParPrenom = useMemo(() => {
    const map = new Map();
    equipes.forEach(eq => {
      [eq.responsable, ...(eq.membres || []).map(m => m.ouvrier)].forEach(n => {
        const cle = normaliserNomRessource(n);
        if (cle && !map.has(cle)) map.set(cle, eq);
      });
    });
    return map;
  }, [equipes]);

  // Prénoms (normalisés) des équipes dont je suis responsable, moi inclus.
  const membresMesEquipes = useMemo(() => {
    const ids = new Set((equipesResponsable || []).map(e => e.id));
    const s = new Set();
    equipes.filter(eq => ids.has(eq.id)).forEach(eq => {
      [eq.responsable, ...(eq.membres || []).map(m => m.ouvrier)].forEach(n => {
        const cle = normaliserNomRessource(n);
        if (cle) s.add(cle);
      });
    });
    return s;
  }, [equipes, equipesResponsable]);

  // Équipes proposées en puces de filtre (vue « Tout ») : celles qui ont au
  // moins une personne (les équipes externes sans membres n'apparaissent pas).
  const equipesFiltrables = useMemo(
    () => equipes.filter(eq =>
      normaliserNomRessource(eq.responsable) || (eq.membres || []).some(m => normaliserNomRessource(m.ouvrier))),
    [equipes]
  );

  // ── Cellules du jour, par vue ──────────────────────────────────────────────
  const cellsByDay = useMemo(() => {
    const byDay = {};
    rawCells.forEach(cell => {
      // Personnes présentes sur ce chantier ce jour-là (cellule + tâches).
      const presents = new Set(cell.ouvriers || []);
      (Array.isArray(cell.taches) ? cell.taches : []).forEach(t => (t.ouvriers || []).forEach(o => presents.add(o)));
      const personnes = [...presents].filter(Boolean);

      if (vueActive === "moi") {
        // Réplique exacte du filtre RLS cells_ouvrier_sel (colonne ouvriers) :
        // indispensable pour un chef, dont la requête renvoie TOUTES les cellules.
        if (!(cell.ouvriers || []).includes(prenom)) return;
      } else if (vueActive === "equipe") {
        if (!personnes.some(n => membresMesEquipes.has(normaliserNomRessource(n)))) return;
      } else if (filtreEq) {
        if (!personnes.some(n => equipeParPrenom.get(normaliserNomRessource(n))?.id === filtreEq)) return;
      }

      const ch = config.chantiers.find(c => c.id === cell.chantier_id);
      const base = {
        chantier_id: cell.chantier_id,
        nom: ch?.nom || cell.chantier_id,
        couleur: ch?.couleur || "#5b8af5",
        geo: config.adresses[cell.chantier_id] || null,
      };

      if (vueActive === "moi") {
        const taches = [];
        if (Array.isArray(cell.taches) && cell.taches.length) {
          cell.taches.forEach(t => {
            if (!t.text?.trim()) return;
            const pourTout = !t.ouvriers || t.ouvriers.length === 0;
            const pourMoi  = (t.ouvriers || []).includes(prenom);
            if (pourTout || pourMoi) taches.push(t.text.trim());
          });
        } else if (cell.planifie?.trim()) {
          cell.planifie.split("\n").filter(l => l.trim()).forEach(l => taches.push(l.trim()));
        }
        (byDay[cell.jour] ||= []).push({ ...base, taches, collegues: personnes.filter(n => n !== prenom) });
      } else {
        // Vues chef : TOUTES les tâches de la cellule, avec leurs assignés
        // (sans assignés = toute l'équipe présente sur le chantier).
        const taches = [];
        if (Array.isArray(cell.taches) && cell.taches.length) {
          cell.taches.forEach(t => {
            if (!t.text?.trim()) return;
            taches.push({ text: t.text.trim(), ouvriers: (t.ouvriers || []).filter(Boolean) });
          });
        } else if (cell.planifie?.trim()) {
          cell.planifie.split("\n").filter(l => l.trim()).forEach(l => taches.push({ text: l.trim(), ouvriers: [] }));
        }
        (byDay[cell.jour] ||= []).push({ ...base, personnes, taches });
      }
    });
    return byDay;
  }, [rawCells, vueActive, filtreEq, config, prenom, membresMesEquipes, equipeParPrenom]);

  const dayCells = cellsByDay[jour] || [];
  const jourIdx  = JOURS.indexOf(jour);
  const tabs = JOURS.map(j => {
    const n = (cellsByDay[j] || []).length;
    return { id: j, label: ABBR[j], count: n > 0 ? n : null };
  });

  const emptyHint = vueActive === "moi" ? "Aucun chantier ne t'est affecté ce jour-là."
    : vueActive === "equipe" ? "Personne de ton équipe n'est planifié ce jour-là."
    : "Aucun chantier planifié ce jour-là.";

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Bandeau semaine avec navigation ‹ › */}
      <MobileCard T={T} accent={accent} style={{ padding:"9px 10px", display:"flex", alignItems:"center", gap:8 }}>
        <button onClick={() => shiftSemaine(-1)} aria-label="Semaine précédente" style={{
          width:36, height:36, borderRadius:11, flexShrink:0, cursor:"pointer",
          background:T.card, border:`1px solid ${T.border}`, color:T.textSub,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Icon as={ChevronLeft} size={18} strokeWidth={2.4}/>
        </button>
        <div style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", gap:10, justifyContent:"center" }}>
          <div style={{
            width:36, height:36, borderRadius:11, flexShrink:0,
            background:`linear-gradient(135deg, ${accent}, ${accent}c0)`, color:"#1a1f2e",
            display:"flex", alignItems:"center", justifyContent:"center",
          }}>
            <Icon as={CalendarDays} size={18} strokeWidth={2.3}/>
          </div>
          <div style={{ minWidth:0, textAlign:"left" }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase", color:T.textMuted, whiteSpace:"nowrap" }}>
              {libSem}
            </div>
            <div style={{ fontSize:15, fontWeight:800, color:T.text, whiteSpace:"nowrap" }}>
              {fmtJour(dateDuJour(0))} – {fmtJour(dateDuJour(4))} <span style={{ color:T.textMuted, fontWeight:700, fontSize:12.5 }}>· S{week}</span>
            </div>
          </div>
        </div>
        <button onClick={() => shiftSemaine(1)} aria-label="Semaine suivante" style={{
          width:36, height:36, borderRadius:11, flexShrink:0, cursor:"pointer",
          background:T.card, border:`1px solid ${T.border}`, color:T.textSub,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <Icon as={ChevronRight} size={18} strokeWidth={2.4}/>
        </button>
      </MobileCard>

      {/* Retour rapide quand on s'est éloigné de la semaine par défaut */}
      {horsCible && (
        <button onClick={() => allerSemaine(cible.year, cible.week)} style={{
          alignSelf:"center", display:"inline-flex", alignItems:"center", gap:6,
          background:"transparent", border:"none", cursor:"pointer",
          color:T.textSub, fontFamily:"inherit", fontSize:13, fontWeight:700, padding:"0 4px",
        }}>
          <Icon as={Undo2} size={14}/> Revenir à aujourd'hui
        </button>
      )}

      {/* Sélecteur de vue — chefs d'équipe uniquement */}
      {estResponsable && (
        <MobileTabs T={T} accent={accent} onAccent="#1a1f2e" value={vue}
          onChange={(v) => { setVue(v); setFiltreEq(null); }}
          tabs={[
            { id: "moi",    label: "Moi" },
            { id: "equipe", label: "Mon équipe" },
            { id: "tout",   label: "Tout" },
          ]}/>
      )}

      {/* Puces de filtre par équipe — vue « Tout » */}
      {vueActive === "tout" && equipesFiltrables.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, padding:"0 2px" }}>
          <button onClick={() => setFiltreEq(null)} style={{
            borderRadius:999, padding:"4px 12px", fontSize:12.5, fontWeight:700, cursor:"pointer",
            fontFamily:"inherit",
            background: filtreEq === null ? T.text : T.surface,
            color:      filtreEq === null ? T.surface : T.textSub,
            border:     `1px solid ${filtreEq === null ? T.text : T.border}`,
          }}>Toutes</button>
          {equipesFiltrables.map(eq => {
            const actif = filtreEq === eq.id;
            return (
              <button key={eq.id} onClick={() => setFiltreEq(actif ? null : eq.id)} style={{
                display:"inline-flex", alignItems:"center", gap:6,
                borderRadius:999, padding:"4px 12px", fontSize:12.5, fontWeight:700, cursor:"pointer",
                fontFamily:"inherit",
                background: actif ? eq.couleur + "2e" : T.surface,
                color:      actif ? T.text : T.textSub,
                border:     `1px solid ${actif ? eq.couleur : T.border}`,
              }}>
                <span style={{ width:8, height:8, borderRadius:"50%", background:eq.couleur, flexShrink:0 }}/>
                {eq.nom}
              </button>
            );
          })}
        </div>
      )}

      {/* Sélecteur de jour */}
      <MobileTabs tabs={tabs} value={jour} onChange={setJour} accent={accent} onAccent="#1a1f2e" T={T}/>

      {/* Contenu du jour sélectionné */}
      {loading ? (
        <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>
      ) : dayCells.length === 0 ? (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={CalendarX}
            title={`Rien de prévu le ${jour.toLowerCase()}`}
            hint={emptyHint} />
        </MobileCard>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ fontSize:13, fontWeight:700, color:T.textSub, padding:"0 4px" }}>
            {jour} {fmtJour(dateDuJour(jourIdx))} · {dayCells.length} chantier{dayCells.length > 1 ? "s" : ""}
          </div>
          {vueActive === "moi" ? (
            dayCells.map((c, i) => (
              <MobileCard key={`${c.chantier_id}_${i}`} T={T} accent={c.couleur} style={{ padding:"13px 15px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:c.geo?.adresse ? 6 : 10 }}>
                  <Icon as={Building2} size={15} color={c.couleur} strokeWidth={2.3}/>
                  <span style={{ fontSize:16, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>{c.nom}</span>
                </div>
                {c.geo?.adresse && (
                  <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
                    <Icon as={MapPin} size={13} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                    <span style={{ fontSize:13, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                  </div>
                )}
                {/* Collègues sur ce chantier */}
                <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:10 }}>
                  <Icon as={Users} size={14} color={T.textMuted} strokeWidth={2.2}/>
                  {c.collegues.length > 0 ? (
                    c.collegues.map(n => (
                      <span key={n} style={{
                        background:c.couleur+"22", color:T.text, border:`1px solid ${c.couleur}55`,
                        borderRadius:999, padding:"2px 10px", fontSize:12.5, fontWeight:700,
                      }}>{n}</span>
                    ))
                  ) : (
                    <span style={{ fontSize:12.5, color:T.textMuted, fontStyle:"italic" }}>Seul sur ce chantier</span>
                  )}
                </div>
                <div style={{ marginBottom: c.taches.length ? 12 : 0 }}><NavButtons geo={c.geo}/></div>
                {c.taches.length > 0 && (
                  <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
                    {c.taches.map((t, j) => (
                      <li key={j} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:13.5, color:T.text, lineHeight:1.4 }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:c.couleur, marginTop:6, flexShrink:0 }}/>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </MobileCard>
            ))
          ) : (
            // Vues « Mon équipe » / « Tout » : par chantier, QUI est présent —
            // chaque prénom en pastille aux couleurs de son équipe (gris sans équipe).
            dayCells.map((c, i) => (
              <MobileCard key={`${c.chantier_id}_${i}`} T={T} accent={c.couleur} style={{ padding:"13px 15px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:c.geo?.adresse ? 6 : 10 }}>
                  <Icon as={Building2} size={15} color={c.couleur} strokeWidth={2.3}/>
                  <span style={{ fontSize:16, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>{c.nom}</span>
                </div>
                {c.geo?.adresse && (
                  <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
                    <Icon as={MapPin} size={13} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
                    <span style={{ fontSize:13, color:T.textSub, lineHeight:1.4, flex:1 }}>{c.geo.adresse}</span>
                  </div>
                )}
                <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom: c.taches.length ? 12 : 0 }}>
                  <Icon as={Users} size={14} color={T.textMuted} strokeWidth={2.2}/>
                  {c.personnes.length > 0 ? (
                    c.personnes.map(n => {
                      const eq = equipeParPrenom.get(normaliserNomRessource(n)) || null;
                      return (
                        <span key={n} style={{
                          background: eq ? eq.couleur + "22" : T.card,
                          color: T.text,
                          border: `1px solid ${eq ? eq.couleur + "55" : T.border}`,
                          borderRadius:999, padding:"2px 10px", fontSize:12.5, fontWeight:700,
                        }}>{n}</span>
                      );
                    })
                  ) : (
                    <span style={{ fontSize:12.5, color:T.textMuted, fontStyle:"italic" }}>Personne d'affecté</span>
                  )}
                </div>
                {/* Tâches du jour sur ce chantier, avec qui doit les faire */}
                {c.taches.length > 0 && (
                  <ul style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
                    {c.taches.map((t, j) => (
                      <li key={j} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:13.5, color:T.text, lineHeight:1.4 }}>
                        <span style={{ width:6, height:6, borderRadius:"50%", background:c.couleur, marginTop:6, flexShrink:0 }}/>
                        <span style={{ flex:1 }}>
                          {t.text}
                          {t.ouvriers.length > 0 ? (
                            <span style={{ color:T.textSub, fontWeight:700 }}> — {t.ouvriers.join(", ")}</span>
                          ) : (
                            <span style={{ color:T.textMuted, fontStyle:"italic" }}> — tous</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </MobileCard>
            ))
          )}
        </div>
      )}
    </div>
  );
}
