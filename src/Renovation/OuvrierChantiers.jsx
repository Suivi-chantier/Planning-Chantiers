// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — Onglet « Opérations » : trois niveaux de navigation,
// pilotés par état (aucun routeur d'URL) :
//   1. la liste des OPÉRATIONS (+ section « Chantiers hors opération ») ;
//   2. la vue globale d'une opération et ses chantiers ;
//   3. le DÉTAIL d'un chantier — plans, documents du cycle de vie et heures
//      vendues vs réelles par ouvrage. Ce niveau 3 est l'écran historique de
//      cet onglet : son contenu, ses RPC et ses règles sont inchangés.
//
// L'identifiant technique de l'onglet reste « chantiers » (permission
// ouvrier-chantiers d'access.js) : seul le libellé affiché a changé.
//
// Les tables phasages/pointages sont bureau-only (RLS Phase 0) : toutes les
// données passent par la RPC ouvrier_chantier_detail
// (sql/202608_ouvrier_chantiers.sql), qui ne renvoie JAMAIS de prix ni de
// taux horaire. Les calculs d'heures réutilisent le module chantierFinance
// (mêmes chiffres que la fiche chantier bureau).
//
// Les niveaux 1 et 2 sont volontairement SANS aucun chiffre financier : ils ne
// lisent que planning_config (chantiers / operations / chantier_adresses) et ne
// reprennent rien de PageOperations.jsx, qui est une page bureau à marges.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS } from "../constants";
import { Icon } from "../ui";
import {
  Building2, MapPin, ArrowLeft, ChevronRight, FileText, Image as ImageIcon,
  FolderOpen, Timer, HardHat, Ruler, ImageOff, Layers, ClipboardList,
} from "lucide-react";
import { grouperParOperation } from "./ouvrierOperations";
// Niveau 4 : la préparation du chantier. Écran à part, alimenté uniquement
// par la RPC ouvrier_preparation_chantier — il ne lit aucune table.
import OuvrierPreparationChantier from "./OuvrierPreparationChantier";
import { MobileCard, MobileSection, MobileEmptyState, Pill, SummaryBar } from "../mobileUI";
import { indexPointagesParTache, tacheHeuresReelles } from "../chantierFinance";
import { urlDocumentChantier, derniereErreurDocument } from "./storageChantier";
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
  const [config, setConfig]   = useState(null); // { chantiers, adresses, operations }
  const [erreurConfig, setErreurConfig] = useState(false);
  const [opSel, setOpSel]     = useState(null); // opération ouverte (niveau 2) — null = niveau 1
  const [sel, setSel]         = useState(null); // chantier sélectionné (objet config)
  const [detail, setDetail]   = useState(null); // résultat de la RPC
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur]   = useState(false);
  const [plans, setPlans]     = useState(null); // plans de la page Plans (null = en cours)
  const [planOuvert, setPlanOuvert] = useState(null); // { id, name } → visionneuse
  // Niveau 4 : préparation du chantier. `sel` et `opSel` restent intacts, si
  // bien que fermer la préparation retrouve le détail EXACT d'où l'on vient,
  // et le retour suivant l'opération d'origine. Aucun état de provenance en
  // plus, aucune route : la pile de navigation, c'est ces trois booléens.
  const [prepOuverte, setPrepOuverte] = useState(false);

  useEffect(() => {
    // Une seule requête pour les trois référentiels. On ne passe pas par
    // loadOperations() de constants.js : ce helper invente un id `op_${i}`
    // quand il manque, et un id inventé ne peut correspondre à aucun
    // operation_id de chantier — ici on veut les ids réels, sans repli.
    supabase.from("planning_config").select("key,value").in("key", ["chantiers", "chantier_adresses", "operations"])
      .then(({ data, error }) => {
        if (error) { console.error("planning_config (espace ouvrier):", error); setErreurConfig(true); return; }
        let chantiers = DEFAULT_CHANTIERS, adresses = {}, operations = [];
        (data || []).forEach(r => {
          if (r.key === "chantiers" && Array.isArray(r.value)) chantiers = r.value;
          if (r.key === "chantier_adresses" && r.value) adresses = r.value;
          // planning_config/operations a la forme { items: [...] } (≠ chantiers,
          // qui est un tableau nu). Si la clé n'est pas lisible (RLS) ou absente,
          // operations reste vide : tous les chantiers basculent alors en
          // « hors opération » et restent joignables.
          if (r.key === "operations" && Array.isArray(r.value?.items)) operations = r.value.items;
        });
        setConfig({ chantiers, adresses, operations });
      });
  }, []);

  const openChantier = async (c) => {
    setSel(c); setDetail(null); setErreur(false); setLoading(true); setPlans(null);
    setPrepOuverte(false);
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
    else { if (fenetre) fenetre.close(); alert(`Impossible d'ouvrir le fichier. ${derniereErreurDocument() || "Réessaie plus tard."}`); }
  };

  // ── Rendus partagés ─────────────────────────────────────────────────────────
  // Puces de statuts : uniquement des comptages de statuts EXISTANTS
  // (compterStatuts), aucune notion nouvelle, aucun avancement.
  const pillsStatuts = (statuts) => statuts.map(s => {
    const st = STATUTS[s.statut] || STATUTS.en_cours;
    return <Pill key={s.statut} color={st.color}>{s.n} {st.label.toLowerCase()}</Pill>;
  });

  // Carte chantier — utilisée par la section « hors opération » (niveau 1) ET
  // par la liste des chantiers d'une opération (niveau 2). Ouvre le détail.
  const carteChantier = (c) => {
    const st = STATUTS[c.statut || "en_cours"] || STATUTS.en_cours;
    const geo = config?.adresses?.[c.id] || null;
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

  // Carte opération (niveau 1) — ouvre la vue globale de l'opération.
  const carteOperation = (op) => (
    <MobileCard key={op.id} T={T} accent={op.couleur || accent}
      style={{ padding:"12px 14px", cursor:"pointer" }}>
      <div onClick={() => setOpSel(op)} style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
        <div style={{
          width:38, height:38, borderRadius:12, flexShrink:0,
          background:`linear-gradient(135deg, ${op.couleur || accent}, ${op.couleur || accent}c0)`, color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center", boxShadow:`0 4px 12px ${op.couleur || accent}44`,
        }}><Icon as={Layers} size={19}/></div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:16, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{op.nom}</div>
          {op.adresse && (
            <div style={{ fontSize:12.5, color:T.textSub, marginTop:2, display:"flex", alignItems:"center", gap:4, overflow:"hidden" }}>
              <Icon as={MapPin} size={12} style={{ flexShrink:0 }}/>
              <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{op.adresse}</span>
            </div>
          )}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:7 }}>
            <Pill color={op.couleur || accent}>{op.chantiers.length} chantier{op.chantiers.length > 1 ? "s" : ""}</Pill>
            {pillsStatuts(op.statuts)}
          </div>
        </div>
        <Icon as={ChevronRight} size={18} style={{ color:T.textMuted, flexShrink:0 }}/>
      </div>
    </MobileCard>
  );

  const boutonRetour = (label, onClick) => (
    <button onClick={onClick} style={{
      alignSelf:"flex-start", display:"inline-flex", alignItems:"center", gap:7,
      background:T.surface, border:`1px solid ${T.border}`, borderRadius:12,
      padding:"9px 14px", color:T.textSub, cursor:"pointer",
      fontFamily:"inherit", fontSize:13.5, fontWeight:700,
    }}>
      <Icon as={ArrowLeft} size={15}/> {label}
    </button>
  );

  // ── NIVEAU 1 : liste des OPÉRATIONS ────────────────────────────────────────
  if (!sel && !opSel) {
    if (erreurConfig) {
      return (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={Layers} title="Chargement impossible"
            hint="La liste des opérations n'a pas pu être chargée. Vérifie ta connexion et réessaie."/>
        </MobileCard>
      );
    }
    if (!config) {
      return <div style={{ padding:"40px 24px", textAlign:"center", color:T.textMuted, fontSize:13, letterSpacing:2 }}>CHARGEMENT…</div>;
    }

    const { operations, horsOperation } = grouperParOperation(config.operations, config.chantiers);
    const rien = operations.length === 0 && horsOperation.length === 0;

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {!rien && (
          <div style={{ fontSize:13, fontWeight:700, color:T.textSub, padding:"0 4px" }}>
            {operations.length > 0
              ? `${operations.length} opération${operations.length > 1 ? "s" : ""} · ${config.chantiers.length} chantier${config.chantiers.length > 1 ? "s" : ""}`
              : `${horsOperation.length} chantier${horsOperation.length > 1 ? "s" : ""}`}
          </div>
        )}

        {rien && (
          <MobileCard T={T}>
            <MobileEmptyState T={T} icon={Layers} title="Aucun chantier"
              hint="Aucun chantier n'est défini dans le planning pour le moment."/>
          </MobileCard>
        )}

        {operations.map(carteOperation)}

        {horsOperation.length > 0 && (
          <MobileSection T={T} accent="#94a3b8" icon={Building2} title="Chantiers hors opération"
            summary={horsOperation.length} defaultOpen={operations.length === 0}>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{horsOperation.map(carteChantier)}</div>
          </MobileSection>
        )}
      </div>
    );
  }

  // ── NIVEAU 2 : vue globale d'une OPÉRATION ─────────────────────────────────
  if (!sel && opSel) {
    const couleurOp = opSel.couleur || accent;
    // NavButtons accepte une adresse texte seule (hasGeo) : on réutilise le
    // helper de ouvrierNav tel quel, sans dupliquer la construction d'URL.
    const geoOp = opSel.adresse ? { adresse: opSel.adresse } : null;
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {boutonRetour("Toutes les opérations", () => setOpSel(null))}

        <MobileCard T={T} accent={couleurOp} style={{ padding:"13px 15px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:opSel.adresse ? 6 : 0 }}>
            <Icon as={Layers} size={17} color={couleurOp} strokeWidth={2.3}/>
            <span style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.2, flex:1, minWidth:0 }}>{opSel.nom}</span>
            <Pill color={couleurOp}>{opSel.chantiers.length} chantier{opSel.chantiers.length > 1 ? "s" : ""}</Pill>
          </div>
          {opSel.adresse && (
            <div style={{ display:"flex", alignItems:"flex-start", gap:6, marginBottom:10 }}>
              <Icon as={MapPin} size={13} color={T.textMuted} strokeWidth={2} style={{ marginTop:2, flexShrink:0 }}/>
              <span style={{ fontSize:13, color:T.textSub, lineHeight:1.4, flex:1 }}>{opSel.adresse}</span>
            </div>
          )}
          {opSel.statuts.length > 0 && (
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:geoOp ? 10 : 0 }}>
              {pillsStatuts(opSel.statuts)}
            </div>
          )}
          <NavButtons geo={geoOp}/>
        </MobileCard>

        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>{opSel.chantiers.map(carteChantier)}</div>
      </div>
    );
  }

  // ── NIVEAU 4 : PRÉPARATION DU CHANTIER ─────────────────────────────────────
  // Monté/démonté par ce booléen : chaque ouverture refait donc l'appel RPC.
  // Le retour ne fait que refermer — `sel` n'a jamais été touché, le détail
  // réapparaît tel qu'il était, et son propre retour ramène à l'opération.
  if (sel && prepOuverte) {
    return (
      <OuvrierPreparationChantier
        chantier={sel} T={T} accent={accent}
        onRetour={() => setPrepOuverte(false)}/>
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
      {/* Retour : à l'opération d'origine si on vient d'elle, sinon au niveau 1.
          opSel n'est pas effacé à l'ouverture d'un chantier, il porte donc à lui
          seul la provenance — pas besoin d'un état « origine » supplémentaire. */}
      {boutonRetour(
        opSel ? `Retour à ${opSel.nom}` : "Toutes les opérations",
        () => { setSel(null); setDetail(null); setPlans(null); setPlanOuvert(null); },
      )}

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

      {/* Accès à la préparation — après l'identité du chantier, avant les
          heures, les plans et les documents. Disponible immédiatement : il
          n'attend pas le chargement du détail, la préparation a sa propre
          source (la RPC) et ses propres états. */}
      <MobileCard T={T} accent={accent} style={{ padding:0, overflow:"hidden" }}>
        <button onClick={() => setPrepOuverte(true)} style={{
          width:"100%", textAlign:"left", display:"flex", alignItems:"center", gap:11,
          padding:"13px 14px", border:"none", background:"transparent",
          fontFamily:"inherit", cursor:"pointer",
        }}>
          <div style={{
            width:38, height:38, borderRadius:12, flexShrink:0,
            background:`linear-gradient(135deg, ${accent}, ${accent}c0)`, color:"#1a1f2e",
            display:"flex", alignItems:"center", justifyContent:"center",
            boxShadow:`0 4px 12px ${accent}55`,
          }}><Icon as={ClipboardList} size={19} strokeWidth={2.2}/></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15.5, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>
              Préparation du chantier
            </div>
            <div style={{ fontSize:12.5, color:T.textSub, marginTop:2 }}>
              Voir les phases, les tâches et les matériaux prévus
            </div>
          </div>
          <Icon as={ChevronRight} size={18} style={{ color:T.textMuted, flexShrink:0 }}/>
        </button>
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
