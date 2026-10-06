// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — Onglet « Phases » (BÊTA, lecture seule).
//
// Visible uniquement des bêta-testeurs de la fonctionnalité « mes_phases »
// (planning_config/fonctionnalites_beta, cochée dans Admin → Collaborateurs).
// Le phasage d'un chantier, organisé par phase (groupes chrono) → ouvrage →
// tâche, avec heures vendues, heures validées, heures en attente de
// validation et avancement.
//
// Données : UNIQUEMENT la RPC ouvrier_mes_phases (sql/202610_ouvrier_mes_phases.sql),
// qui ne renvoie aucun prix, coût, taux ni montant. Tous les totaux, les
// avancements et les pastilles viennent du module pur mesPhasesV1 (qui
// s'appuie sur chantierFinance) — cet écran ne calcule rien lui-même.
// Aucune écriture : ni phasage, ni rapport, ni pointage.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { DEFAULT_CHANTIERS } from "../constants";
import { getISOWeek } from "../rythmeSemaine";
import { Icon } from "../ui";
import {
  Check, Clock, AlertTriangle, AlertOctagon, CalendarClock, Minus, HelpCircle, Plus,
  ArrowRight, ChevronDown, RefreshCw, Layers, FlaskConical,
} from "lucide-react";
import { MobileHero, MobileCard, MobileEmptyState, CARD_SHADOW } from "../mobileUI";
import { fmtH } from "../chantierFinance";
import {
  construireMesPhases, filtrerPhases, choisirChantierParDefaut, libellePersonnes, STATUTS,
} from "./mesPhasesV1";

// Pastilles : couleur ET icône ET texte — la couleur seule ne porte jamais
// l'information (lecture au soleil, daltonisme).
const TONS = {
  vert:   { fg: "#15803d", bg: "#dcfce7", barre: "#16a34a" },
  orange: { fg: "#b45309", bg: "#fef3c7", barre: "#f59e0b" },
  rouge:  { fg: "#b91c1c", bg: "#fee2e2", barre: "#dc2626" },
  gris:   { fg: "#475569", bg: "#e2e8f0", barre: "#94a3b8" },
  bleu:   { fg: "#1d4ed8", bg: "#dbeafe", barre: "#2563eb" },
};
const ICONES_ETAT = {
  dans_le_temps: Check, a_surveiller: Clock, derive: AlertTriangle, depasse: AlertOctagon,
  a_venir: CalendarClock, sans_jauge: Minus, sans_avancement: HelpCircle, hors_devis: Plus,
};
const STATUT_PILL = {
  en_cours: { fg: "#1a1f2e", bg: "#FFC200" },
  a_venir:  { fg: "#475569", bg: "#e2e8f0" },
  terminee: { fg: "#15803d", bg: "#dcfce7" },
  vide:     { fg: "#475569", bg: "#f1f5f9" },
};
const SOMBRE = "#1a1f2e";

const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const jourCourt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
function plageDates(min, max) {
  if (!min) return "Pas de date prévue";
  if (!max || max === min) return `Le ${jourCourt(min)}`;
  return `Du ${jourCourt(min)} au ${jourCourt(max)}`;
}
const h = (n) => `${fmtH(n)} h`;

// ── Petits composants ────────────────────────────────────────────────────────
function Pastille({ etat }) {
  const ton = TONS[etat.ton] || TONS.gris;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
      fontSize: 12.5, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap",
      padding: "6px 10px", borderRadius: 999, color: ton.fg, background: ton.bg,
    }}>
      <Icon as={ICONES_ETAT[etat.code] || Minus} size={13} strokeWidth={2.6}/>
      {etat.label}
    </span>
  );
}

function PillStatut({ statut }) {
  const s = STATUT_PILL[statut] || STATUT_PILL.vide;
  return (
    <span style={{
      fontSize: 12.5, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap", flexShrink: 0,
      padding: "6px 10px", borderRadius: 999, color: s.fg, background: s.bg,
    }}>{STATUTS[statut] || statut}</span>
  );
}

// Deux barres : foncée = travail fait (avancement) ; couleur = heures
// utilisées sur les heures vendues (validées en plein, en attente plus clair).
// Sans heures vendues sur l'élément (hors devis, vendu sur l'ouvrage), seule
// la barre du travail fait reste : aucune jauge d'heures inventée.
function DoubleBarre({ avancement, validees, attente, vendues, etat, T }) {
  const ton = TONS[etat.ton] || TONS.gris;
  const pctVal = vendues > 0 ? Math.min(100, (validees / vendues) * 100) : 0;
  const pctAtt = vendues > 0 ? Math.min(100 - pctVal, (attente / vendues) * 100) : 0;
  const piste = { height: 7, borderRadius: 4, background: T.card, overflow: "hidden", display: "flex" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
      <div style={piste} aria-label={`Travail fait : ${avancement} %`}>
        <div style={{ width: `${Math.max(0, Math.min(100, avancement))}%`, background: SOMBRE, borderRadius: 4 }}/>
      </div>
      {etat.jauge !== false && vendues > 0 && (
        <div style={piste} aria-label={`Heures utilisées : ${h(validees + attente)} sur ${h(vendues)} vendues`}>
          <div style={{ width: `${pctVal}%`, background: ton.barre }}/>
          <div style={{ width: `${pctAtt}%`, background: ton.barre, opacity: 0.45 }}/>
        </div>
      )}
    </div>
  );
}

function LigneAttente({ validees, attente, miennes, T }) {
  const morceaux = [];
  if (attente > 0) morceaux.push(`${h(validees)} validées + ${h(attente)} en attente de validation`);
  if (miennes > 0) morceaux.push(`dont toi ${h(miennes)}`);
  if (!morceaux.length) return null;
  return <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6, lineHeight: 1.4 }}>{morceaux.join(" · ")}</div>;
}

// « X h / Y h vendues » — ou « X h passées » quand rien n'est vendu ici.
function HeuresVendues({ consommees, vendues, T, taille = 14 }) {
  return (
    <span style={{ fontSize: taille, color: T.textSub }}>
      <strong style={{ color: T.text, fontWeight: 800, fontSize: taille + 1 }}>{h(consommees)}</strong>
      {vendues > 0 ? ` / ${h(vendues)} vendues` : " passées"}
    </span>
  );
}

// ── Ligne de tâche ──────────────────────────────────────────────────────────
function LigneTache({ t, prenom, T }) {
  const qui = libellePersonnes(t.ouvriers, prenom);
  const sous = [qui || "Personne n'est affecté", STATUTS[t.statut]];
  if (t.date_prevue) sous.push(`prévue ${jourCourt(t.date_prevue)}`);
  const droite = [`${Math.round(t.avancement)} %`];
  if (t.reste != null && t.reste > 0) droite.push(`reste ${h(t.reste)}`);
  return (
    <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, lineHeight: 1.25 }}>{t.nom}</div>
          <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>{sous.join(" · ")}</div>
        </div>
        <Pastille etat={t.etat}/>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        <HeuresVendues consommees={t.consommees} vendues={t.vendues} T={T}/>
        <span style={{ fontSize: 13, color: T.textSub, whiteSpace: "nowrap" }}>{droite.join(" · ")}</span>
      </div>
      <DoubleBarre avancement={t.avancement} validees={t.validees} attente={t.attente} vendues={t.vendues} etat={t.etat} T={T}/>
      {t.venduesAilleurs && (
        <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6 }}>Heures vendues comptées sur l'ouvrage, pas sur la tâche.</div>
      )}
      {t.heures_validees_source === "ancien_suivi" && (
        <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6 }}>Heures de l'ancien suivi (avant le registre de pointage).</div>
      )}
      <LigneAttente validees={t.validees} attente={t.attente} miennes={t.miennes} T={T}/>
    </div>
  );
}

// ── Bandeau d'ouvrage ───────────────────────────────────────────────────────
function BandeauOuvrage({ o, T }) {
  const qte = o.quantite != null && o.unite ? ` · ${fmtH(o.quantite)} ${o.unite}` : "";
  return (
    <div style={{ background: T.card, padding: "10px 14px", borderTop: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
          color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{o.libelle}{qte}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.textSub, whiteSpace: "nowrap" }}>
          {o.vendues > 0 ? `${fmtH(o.consommees)} / ${h(o.vendues)}` : h(o.consommees)} · {o.avancement} %
        </span>
      </div>
      {o.venduesOuvrageEntier != null && (
        <div style={{ fontSize: 12, color: T.textSub, marginTop: 3 }}>
          Ouvrage vendu {h(o.venduesOuvrageEntier)} en tout, sur plusieurs phases — pas de répartition par phase.
        </div>
      )}
      {o.attente > 0 && (
        <div style={{ fontSize: 12, color: T.textSub, marginTop: 3 }}>{h(o.validees)} validées + {h(o.attente)} en attente</div>
      )}
    </div>
  );
}

// ── Carte de phase ──────────────────────────────────────────────────────────
function CartePhase({ p, ouverte, enAvant, onToggle, prenom, T, accent }) {
  const qui = libellePersonnes(p.personnes, prenom);
  return (
    <div style={{
      background: T.surface, borderRadius: 16, overflow: "hidden", boxShadow: CARD_SHADOW,
      border: enAvant ? `2px solid ${accent}` : `1px solid ${T.border}`,
    }}>
      <button onClick={onToggle} aria-expanded={ouverte} style={{
        width: "100%", minHeight: 44, textAlign: "left", border: "none", background: "transparent",
        padding: "14px 14px 12px", fontFamily: "inherit", cursor: "pointer", color: T.text,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: p.couleur || "#94a3b8", marginTop: 7, flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1.2 }}>{p.nom}</div>
            <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 3 }}>
              {plageDates(p.dateMin, p.dateMax)}{qui ? ` · ${qui}` : ""}
            </div>
          </div>
          <PillStatut statut={p.statut}/>
          <Icon as={ChevronDown} size={20} style={{ color: T.textMuted, flexShrink: 0, marginTop: 2, transform: ouverte ? "rotate(180deg)" : "none", transition: "transform .2s" }}/>
        </div>
        {p.nbTaches > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 10 }}>
              <HeuresVendues consommees={p.consommees} vendues={p.vendues} T={T} taille={14}/>
              <span style={{ fontSize: 14, color: T.textSub, whiteSpace: "nowrap" }}>{p.avancement} % fait</span>
            </div>
            <DoubleBarre avancement={p.avancement} validees={p.validees} attente={p.attente} vendues={p.vendues} etat={p.etat} T={T}/>
            {/* La couleur de la barre ne parle jamais seule : un écart se dit aussi en texte. */}
            {["a_surveiller", "derive", "depasse"].includes(p.etat.code) && (
              <div style={{ marginTop: 8 }}><Pastille etat={p.etat}/></div>
            )}
            {p.attente > 0 && (
              <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 6 }}>{h(p.validees)} validées + {h(p.attente)} en attente de validation</div>
            )}
          </>
        )}
        {ouverte && p.suivante && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: T.textSub, marginTop: 10 }}>
            <Icon as={ArrowRight} size={14}/> Ensuite : {p.suivante.nom}
          </div>
        )}
      </button>
      {ouverte && (
        p.nbTaches === 0 ? (
          <div style={{ padding: "12px 14px 14px", borderTop: `1px solid ${T.border}`, fontSize: 13.5, color: T.textSub, fontStyle: "italic" }}>
            Aucune tâche n'est encore prévue dans cette phase.
          </div>
        ) : (
          <div>
            {p.ouvrages.map(o => (
              <div key={`${p.id}-${o.id}`}>
                <BandeauOuvrage o={o} T={T}/>
                {o.taches.length === 0 ? (
                  <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.textSub, fontStyle: "italic" }}>
                    Aucune tâche dans cet ouvrage.
                  </div>
                ) : o.taches.map(t => <LigneTache key={t.id} t={t} prenom={prenom} T={T}/>)}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── Écran ───────────────────────────────────────────────────────────────────
export default function OuvrierMesPhases({ prenom, T, accent = "#FFC200", hero }) {
  const [chantiers, setChantiers] = useState(null);       // référentiel planning_config
  const [recents, setRecents]     = useState([]);         // ids planifiés récemment pour moi
  const [chantierId, setChantierId] = useState("");
  const [payload, setPayload]     = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur]       = useState(false);
  const [essai, setEssai]         = useState(0);           // « Réessayer »
  const [vue, setVue]             = useState("miennes");
  const [ouvertes, setOuvertes]   = useState(() => new Set());

  // 1) Référentiel + chantier par défaut (planifié aujourd'hui, sinon le
  //    dernier jour planifié des 6 dernières semaines, sinon le premier en cours).
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const aujourdhui = new Date();
        const semaines = [];
        for (let k = 0; k < 6; k++) {
          const d = new Date(aujourdhui); d.setDate(d.getDate() - 7 * k);
          const { year, week } = getISOWeek(d);
          semaines.push(`${year}-W${String(week).padStart(2, "0")}`);
        }
        const [{ data: cfg, error: e1 }, { data: cells }] = await Promise.all([
          supabase.from("planning_config").select("key,value").eq("key", "chantiers"),
          // Ouvrier : la RLS ne renvoie que ses cellules. Aperçu bureau : tout,
          // le module filtre sur le prénom.
          supabase.from("planning_cells").select("week_id,jour,chantier_id,ouvriers,taches").in("week_id", semaines),
        ]);
        if (annule) return;
        if (e1) { setErreur(true); setChantiers([]); return; }
        const liste = Array.isArray(cfg?.[0]?.value) ? cfg[0].value : DEFAULT_CHANTIERS;
        const aujourdhuiISO = isoLocal(aujourdhui);
        const defaut = choisirChantierParDefaut({ cellules: cells || [], prenom, aujourdhuiISO });
        const mesIds = [...new Set((cells || [])
          .filter(c => (c.ouvriers || []).includes(prenom) || (c.taches || []).some(t => (t?.ouvriers || []).includes(prenom)))
          .map(c => c.chantier_id))];
        setRecents(mesIds);
        setChantiers(liste);
        const repli = liste.find(c => (c.statut || "en_cours") === "en_cours") || liste.find(c => c.statut !== "termine") || liste[0];
        setChantierId((defaut && liste.some(c => c.id === defaut) ? defaut : repli?.id) || "");
      } catch (e) {
        console.error("Mes phases — chargement des chantiers :", e);
        if (!annule) { setErreur(true); setChantiers([]); }
      }
    })();
    return () => { annule = true; };
  }, [prenom]);

  // 2) Phasage du chantier sélectionné.
  useEffect(() => {
    if (!chantierId) return;
    let annule = false;
    setChargement(true); setErreur(false); setPayload(null);
    supabase.rpc("ouvrier_mes_phases", {
      p_chantier_id: chantierId, p_prenom: prenom || null, p_aujourdhui: isoLocal(new Date()),
    }).then(({ data, error }) => {
      if (annule) return;
      setChargement(false);
      if (error || !data) { console.error("ouvrier_mes_phases :", error); setErreur(true); return; }
      setPayload(data);
      const r = construireMesPhases(data);
      setVue(r.nbMiennes > 0 ? "miennes" : "tout");
      setOuvertes(new Set(r.phaseEnCoursId ? [r.phaseEnCoursId] : []));
    });
    return () => { annule = true; };
  }, [chantierId, prenom, essai]);

  const resultat = useMemo(() => construireMesPhases(payload), [payload]);
  const visibles = filtrerPhases(resultat, vue);
  const basculer = (id) => setOuvertes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Sélecteur dans le bandeau sombre (maquette « Mes phases »).
  const groupes = useMemo(() => {
    const l = chantiers || [];
    const recentsL = l.filter(c => recents.includes(c.id));
    const autres = l.filter(c => !recents.includes(c.id) && c.statut !== "termine");
    const termines = l.filter(c => !recents.includes(c.id) && c.statut === "termine");
    return [
      { label: "Mes chantiers récents", items: recentsL },
      { label: "Autres chantiers", items: autres },
      { label: "Terminés", items: termines },
    ].filter(g => g.items.length);
  }, [chantiers, recents]);
  const couleurSel = (chantiers || []).find(c => c.id === chantierId)?.couleur || accent;

  const selecteur = (
    <div style={{ position: "relative", marginTop: 14 }}>
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", width: 9, height: 9, borderRadius: "50%", background: couleurSel, pointerEvents: "none" }}/>
      <select value={chantierId} onChange={e => setChantierId(e.target.value)} disabled={!chantiers || chantiers.length === 0}
        aria-label="Chantier" style={{
          width: "100%", minHeight: 48, appearance: "none", WebkitAppearance: "none",
          background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 13,
          color: "#fff", fontFamily: "inherit", fontSize: 16, fontWeight: 800, padding: "0 40px 0 32px", cursor: "pointer",
        }}>
        {!chantiers && <option value="">Chargement…</option>}
        {groupes.map(g => (
          <optgroup key={g.label} label={g.label} style={{ color: SOMBRE }}>
            {g.items.map(c => <option key={c.id} value={c.id} style={{ color: SOMBRE }}>{c.nom}</option>)}
          </optgroup>
        ))}
      </select>
      <Icon as={ChevronDown} size={18} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#fff", pointerEvents: "none" }}/>
    </div>
  );

  const carteMessage = (icon, titre, texte, action) => (
    <MobileCard T={T}>
      <MobileEmptyState T={T} icon={icon} title={titre} hint={texte}/>
      {action && <div style={{ display: "flex", justifyContent: "center", paddingBottom: 18 }}>{action}</div>}
    </MobileCard>
  );
  const boutonReessayer = (
    <button onClick={() => setEssai(n => n + 1)} style={{
      minHeight: 44, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 18px",
      borderRadius: 12, border: `1px solid ${T.border}`, background: T.surface, color: T.text,
      fontFamily: "inherit", fontSize: 14.5, fontWeight: 800, cursor: "pointer",
    }}><Icon as={RefreshCw} size={15}/> Réessayer</button>
  );

  let corps;
  if (erreur) {
    corps = carteMessage(Layers, "Chargement impossible", "Les phases n'ont pas pu être chargées. Vérifie ta connexion et réessaie.", boutonReessayer);
  } else if (!chantiers || chargement || (chantierId && !payload)) {
    corps = chantiers && chantiers.length === 0
      ? carteMessage(Layers, "Aucun chantier", "Aucun chantier n'est défini dans le planning pour le moment.")
      : <div style={{ padding: "40px 24px", textAlign: "center", color: T.textMuted, fontSize: 13, letterSpacing: 2 }}>CHARGEMENT…</div>;
  } else if (resultat.etat === "acces_refuse") {
    corps = carteMessage(FlaskConical, "Vue en test", "Cette vue est en cours d'essai et n'est pas encore ouverte pour toi.");
  } else if (resultat.etat === "absent") {
    corps = carteMessage(Layers, "Pas encore de phasage", "Le bureau n'a pas encore préparé le phasage de ce chantier.");
  } else if (resultat.etat === "ambigu") {
    corps = carteMessage(Layers, "Phasage à rattacher", "Plusieurs phasages portent le nom de ce chantier : le bureau doit indiquer lequel est le bon. Rien n'est affiché pour éviter de montrer le mauvais.");
  } else if (resultat.etat === "legacy_v1") {
    corps = carteMessage(Layers, "Phasage à reprendre", "Le phasage de ce chantier est dans l'ancien format. Il doit être repris par le bureau avant de pouvoir s'afficher ici.");
  } else if (resultat.etat === "vide") {
    corps = carteMessage(Layers, "Phasage vide", "Le phasage de ce chantier ne contient encore aucun ouvrage.");
  } else {
    corps = (
      <>
        {/* Bascule Mes phases / Tout le chantier */}
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 14, background: "#e4e8f2" }}>
          {[["miennes", `Mes phases (${resultat.nbMiennes})`], ["tout", `Tout le chantier (${resultat.nbTout})`]].map(([id, label]) => (
            <button key={id} onClick={() => setVue(id)} aria-pressed={vue === id} style={{
              flex: 1, minHeight: 44, borderRadius: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 15, fontWeight: 800,
              background: vue === id ? T.surface : "transparent",
              color: vue === id ? T.text : T.textSub,
              boxShadow: vue === id ? CARD_SHADOW : "none",
            }}>{label}</button>
          ))}
        </div>

        {/* Légende */}
        <MobileCard T={T} style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.textSub }}>
            <span style={{ width: 22, height: 6, borderRadius: 3, background: SOMBRE, flexShrink: 0 }}/> Travail fait
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.textSub, marginTop: 5 }}>
            <span style={{ width: 22, height: 6, borderRadius: 3, background: TONS.vert.barre, flexShrink: 0 }}/> Heures utilisées (sur les heures vendues)
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: T.textSub, marginTop: 5 }}>
            <span style={{ width: 22, height: 6, borderRadius: 3, background: TONS.vert.barre, opacity: 0.45, flexShrink: 0 }}/> Heures en attente de validation
          </div>
          <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 7, lineHeight: 1.45 }}>
            Si la barre des heures passe devant celle du travail fait, on consomme le temps plus vite qu'on n'avance.
          </div>
        </MobileCard>

        {resultat.etat === "sans_groupes" && (
          <MobileCard T={T} accent="#94a3b8" style={{ padding: "11px 14px", fontSize: 13.5, color: T.textSub, lineHeight: 1.45 }}>
            Les tâches de ce chantier ne sont pas encore rangées en phases par le bureau : tout est regroupé dans « À organiser ».
          </MobileCard>
        )}

        {visibles.length === 0 ? (
          carteMessage(Layers,
            vue === "miennes" ? "Aucune phase pour toi ici" : "Aucune phase",
            vue === "miennes" ? "Tu n'es affecté à aucune tâche de ce chantier pour le moment." : "Aucune phase n'est définie pour ce chantier.",
            vue === "miennes" && resultat.nbTout > 0 ? (
              <button onClick={() => setVue("tout")} style={{
                minHeight: 44, padding: "0 18px", borderRadius: 12, border: "none", cursor: "pointer",
                background: accent, color: SOMBRE, fontFamily: "inherit", fontSize: 14.5, fontWeight: 800,
              }}>Voir tout le chantier</button>
            ) : null)
        ) : visibles.map(p => (
          <CartePhase key={p.id} p={p} prenom={resultat.prenom || prenom} T={T} accent={accent}
            ouverte={ouvertes.has(p.id)} enAvant={p.id === resultat.phaseEnCoursId}
            onToggle={() => basculer(p.id)}/>
        ))}
      </>
    );
  }

  return (
    <>
      <MobileHero accent={accent} logo={hero?.logo} eyebrow={hero?.eyebrow} title="Mes phases" right={hero?.right}>
        {selecteur}
      </MobileHero>
      {corps}
    </>
  );
}
