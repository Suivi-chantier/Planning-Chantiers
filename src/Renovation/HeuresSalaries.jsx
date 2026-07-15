// Page « Heures des salariés » — vue ouvrier, clôture paie.
//
// Grille salarié × jour, alimentée par le registre `pointages` (donc par les CR
// VALIDÉS). Complète — sans remplacer — la page Équipe (orientée chantier) et la
// Validation (saisie/validation). Objectif : préparer la paie du mois
// (contrôle → clôture → export).
//
// Cf. public/spec-heures-salaries.md.
//   - Partie 1 : la page + la grille lecture seule (jour / semaine / mois).
//   - Partie 2 : en-tête mensuel (indicateur de validation, KPI, garde-fous).
//   - Partie 3 (absences / clôture / export) : NON implémentée — nécessite des
//     décisions avec le comptable (voir la spec). Un encart la signale.
//
// Cette page est en LECTURE SEULE : aucune écriture dans `pointages`. Corriger
// une heure = revalider le CR dans Validation.jsx (un seul endroit modifie les
// heures).

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase";
import { RADIUS } from "../constants";
import { Icon } from "../ui";
import { fetchPointages, sumHeures } from "../pointages";
import {
  Clock, Calendar, ChevronLeft, ChevronRight, Camera, AlertTriangle,
  CheckCircle2, Users, ArrowRight, X, Eye, EyeOff, Info, Lock,
} from "lucide-react";

// ─── Helpers date ──────────────────────────────────────────────────────────
const JOURS_COURT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const JOURS_FULL  = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOIS_LABEL  = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function iso(d) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isWeekend(d) { const j = d.getDay(); return j === 0 || j === 6; }

// Lundi de la semaine contenant `d` (semaine civile lun→dim).
function lundiDe(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const dow = x.getDay();               // 0=dim … 6=sam
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(x, diff);
}

// ISO week id "YYYY-Www" (norme ISO-8601, aligné sur weekIdAndJourFromDate de
// Validation.jsx / getWeekId). Sert à interroger planning_cells.
function weekIdAndJour(d) {
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  const dayNr = (target.getDay() + 6) % 7;                    // 0=lun … 6=dim
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + (firstThursday.getDay() + 6) % 7) / 7);
  return { weekId: `${target.getFullYear()}-W${String(week).padStart(2, "0")}`, jour: JOURS_FULL[dayNr] };
}

// Plage [min, max] (inclusive) en fonction de la vue et de la date de référence.
function plageDe(vue, ref) {
  const r = new Date(ref); r.setHours(0, 0, 0, 0);
  if (vue === "jour") return { min: r, max: r };
  if (vue === "semaine") { const l = lundiDe(r); return { min: l, max: addDays(l, 6) }; }
  // mois
  const min = new Date(r.getFullYear(), r.getMonth(), 1);
  const max = new Date(r.getFullYear(), r.getMonth() + 1, 0);
  return { min, max };
}

// Liste des dates ISO de la plage.
function joursDeLaPlage(min, max) {
  const out = [];
  for (let d = new Date(min); d <= max; d = addDays(d, 1)) out.push(new Date(d));
  return out;
}

// Normalisation d'un nom d'ouvrier pour la jointure pointage↔référentiel.
// La colonne pointages.ouvrier est un texte libre : on joint sur trim + casse
// (cf. « Fragilité connue » de la spec).
const normNom = (s) => (s || "").toString().trim().toLowerCase();

function fmtH(h) {
  const v = Math.round((parseFloat(h) || 0) * 100) / 100;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// Un rapport a-t-il des photos ? (photos générales OU photo attachée à une tâche)
function rapportAPhotos(r) {
  if (!r) return false;
  if (Array.isArray(r.photos_chantier) && r.photos_chantier.length > 0) return true;
  return (r.taches || []).some(t => Array.isArray(t.photos) && t.photos.length > 0);
}

// Seuils heures sup (affichage seulement — cf. spec 2d). Configurables plus tard.
const SEUIL_HS = 35;       // au-delà : sous-total semaine coloré (alerte douce)
const SEUIL_HS_FORT = 48;  // au-delà : alerte forte

// Couleur de repli si un chantier n'a pas de couleur définie.
const COULEUR_DEFAUT = "#5b8af5";

export default function HeuresSalaries({
  chantiers = [], ouvriers = [], tauxHoraires = {}, T,
  onGoToValidation,   // (dateISO?) => void : raccourci vers la Validation
}) {
  const [vue, setVue]       = useState("mois");            // jour | semaine | mois
  const [ref, setRef]       = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [detail, setDetail] = useState(false);             // vue détaillée (éclatement par chantier)

  const [pointages, setPointages] = useState([]);
  const [rapports, setRapports]   = useState([]);          // rapports de la plage (photos + statut)
  const [planCells, setPlanCells] = useState([]);          // planning_cells (prévu / fantôme)
  const [loading, setLoading]     = useState(true);

  const [cellSel, setCellSel] = useState(null);            // { ouvrier, dateISO } → modale détail

  const { min, max } = useMemo(() => plageDe(vue, ref), [vue, ref]);
  const minISO = iso(min), maxISO = iso(max);

  // Index couleur / nom de chantier.
  const chById = useMemo(() => {
    const m = {};
    chantiers.forEach(c => { m[c.id] = c; });
    return m;
  }, [chantiers]);

  // ── Chargement ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // 1. Pointages de la plage (fetch borné par date, puis agrégation mémoire).
      const pts = await fetchPointages({ dateFrom: minISO, dateTo: maxISO });

      // 2. Rapports de la plage : photos + statut (non validés pour l'en-tête).
      //    date_rapport peut être au format ISO (récent) ou FR (ancien) → on
      //    charge sur une fenêtre large puis on filtre en mémoire par date ISO.
      //    Pour rester simple et robuste, on récupère les rapports dont la
      //    date_rapport tombe dans la plage sous l'une ou l'autre forme.
      const datesISO = joursDeLaPlage(min, max).map(iso);
      const datesFR  = datesISO.map(s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; });
      let rps = [];
      {
        const { data, error } = await supabase
          .from("rapports")
          .select("id,ouvrier,date_rapport,chantier_id,statut,photos_chantier,taches,remarque,heures_indirectes")
          .in("date_rapport", [...datesISO, ...datesFR]);
        if (!error) rps = data || [];
      }

      // 3. Planning prévisionnel (planning_cells) pour les semaines de la plage
      //    → état « prévu non validé » (fantôme). Présence d'un ouvrier planifié
      //    un jour sans pointage validé = case à valider.
      const weekIds = [...new Set(joursDeLaPlage(min, max).map(d => weekIdAndJour(d).weekId))];
      let cells = [];
      if (weekIds.length > 0) {
        const { data, error } = await supabase
          .from("planning_cells")
          .select("week_id,jour,chantier_id,ouvriers")
          .in("week_id", weekIds);
        if (!error) cells = data || [];
      }

      if (cancelled) return;
      setPointages(pts);
      setRapports(rps);
      setPlanCells(cells);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [minISO, maxISO]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agrégation : { [normNom]: { [dateISO]: { heures, chantiers:Set, pointages:[] } } } ──
  const parOuvrier = useMemo(() => {
    const m = {};
    pointages.forEach(p => {
      const k = normNom(p.ouvrier);
      const d = p.date;                        // ISO "YYYY-MM-DD"
      if (!k || !d) return;
      (m[k] ||= {});
      (m[k][d] ||= { heures: 0, chantiers: new Set(), pointages: [] });
      m[k][d].heures += parseFloat(p.heures) || 0;
      if (p.chantier_id) m[k][d].chantiers.add(p.chantier_id);
      m[k][d].pointages.push(p);
    });
    return m;
  }, [pointages]);

  // Index rapports par id (ouverture CR source) + détection « prévu » par
  // (normNom, dateISO) à partir du planning.
  const rapportById = useMemo(() => {
    const m = {}; rapports.forEach(r => { m[r.id] = r; }); return m;
  }, [rapports]);

  // Map (normNom → Set(dateISO)) des jours PLANIFIÉS (prévu), pour l'état fantôme.
  const prevuParOuvrier = useMemo(() => {
    const m = {};
    // week_id + jour → date ISO de la plage
    const jourDate = {};
    joursDeLaPlage(min, max).forEach(d => {
      const { weekId, jour } = weekIdAndJour(d);
      jourDate[`${weekId}__${jour}`] = iso(d);
    });
    planCells.forEach(c => {
      const dISO = jourDate[`${c.week_id}__${c.jour}`];
      if (!dISO) return;
      (c.ouvriers || []).forEach(o => {
        const k = normNom(o);
        if (!k) return;
        (m[k] ||= new Set()).add(dISO);
      });
    });
    return m;
  }, [planCells, minISO, maxISO]); // eslint-disable-line react-hooks/exhaustive-deps

  const jours = useMemo(() => joursDeLaPlage(min, max), [minISO, maxISO]); // eslint-disable-line react-hooks/exhaustive-deps

  // Référentiel des salariés : la config Admin (tous, y compris ceux à 0h).
  // On complète avec d'éventuels noms présents dans les pointages mais absents
  // du référentiel (pour ne rien masquer), signalés comme « hors référentiel ».
  const lignesSalaries = useMemo(() => {
    const base = (ouvriers || []).map(nom => ({ nom, hors: false }));
    const connus = new Set(base.map(b => normNom(b.nom)));
    const extra = [];
    Object.keys(parOuvrier).forEach(k => {
      if (!connus.has(k)) {
        // retrouve un libellé lisible depuis un pointage
        const p = pointages.find(pp => normNom(pp.ouvrier) === k);
        extra.push({ nom: p?.ouvrier || k, hors: true });
      }
    });
    return [...base, ...extra];
  }, [ouvriers, parOuvrier, pointages]);

  // ── Totaux ────────────────────────────────────────────────────────────────
  const totalOuvrier = useCallback((nom) => {
    const jrs = parOuvrier[normNom(nom)] || {};
    return jours.reduce((s, d) => s + (jrs[iso(d)]?.heures || 0), 0);
  }, [parOuvrier, jours]);

  const heuresCellule = useCallback((nom, dISO) => {
    return parOuvrier[normNom(nom)]?.[dISO]?.heures || 0;
  }, [parOuvrier]);

  // Sous-totaux par semaine civile (pour la coloration heures sup — vue mois).
  // Renvoie { [nom]: { [lundiISO]: heures } } sur les semaines couvertes.
  const semainesDeLaPlage = useMemo(() => {
    const set = new Map(); // lundiISO → { min, max } bornés à la plage
    jours.forEach(d => {
      const l = lundiDe(d); const key = iso(l);
      if (!set.has(key)) set.set(key, { lundi: l });
    });
    return [...set.values()].map(s => s.lundi).sort((a, b) => a - b);
  }, [jours]);

  const totalSemaine = useCallback((nom, lundi) => {
    const jrs = parOuvrier[normNom(nom)] || {};
    let t = 0;
    for (let i = 0; i < 7; i++) t += jrs[iso(addDays(lundi, i))]?.heures || 0;
    return t;
  }, [parOuvrier]);

  // ── Navigation de période ───────────────────────────────────────────────
  const pasPeriode = (sens) => {
    setRef(prev => {
      const d = new Date(prev);
      if (vue === "jour")    d.setDate(d.getDate() + sens);
      if (vue === "semaine") d.setDate(d.getDate() + 7 * sens);
      if (vue === "mois")    d.setMonth(d.getMonth() + sens);
      return d;
    });
  };
  const aujourdhui = () => { const d = new Date(); d.setHours(0, 0, 0, 0); setRef(d); };

  const labelPeriode = useMemo(() => {
    if (vue === "jour")    return `${JOURS_FULL[(ref.getDay() + 6) % 7]} ${ref.getDate()} ${MOIS_LABEL[ref.getMonth()]} ${ref.getFullYear()}`;
    if (vue === "semaine") return `Semaine du ${min.getDate()} ${MOIS_LABEL[min.getMonth()]} au ${max.getDate()} ${MOIS_LABEL[max.getMonth()]} ${max.getFullYear()}`;
    return `${MOIS_LABEL[ref.getMonth()]} ${ref.getFullYear()}`;
  }, [vue, ref, min, max]);

  // ── Données de l'en-tête mensuel (Partie 2) ──────────────────────────────
  // CR non validés de la plage (statut != 'valide'). Nominatif (ouvrier + date).
  const crNonValides = useMemo(() => {
    return rapports
      .filter(r => r.statut && r.statut !== "valide" && r.statut !== "cloture")
      .map(r => ({ id: r.id, ouvrier: r.ouvrier, date: r.date_rapport }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }, [rapports]);

  const totalMois     = useMemo(() => sumHeures(pointages), [pointages]);
  const effectifActif = useMemo(() => {
    return new Set(pointages.map(p => normNom(p.ouvrier)).filter(Boolean)).size;
  }, [pointages]);

  const moisPropre = crNonValides.length === 0;

  // ── Export (Partie 2c) : CSV simple salarié × jour ────────────────────────
  // Livrable de contrôle (pas le format paie final — cf. décisions Partie 3).
  const exporterCSV = () => {
    if (!moisPropre) {
      const ok = window.confirm(
        `${crNonValides.length} jour(s) de CR ne sont pas validés et compteront pour 0h.\n\n` +
        `Exporter quand même le récapitulatif ?`
      );
      if (!ok) return;
    }
    const sep = ";";
    const head = ["Salarié", ...jours.map(d => iso(d)), "Total mois"];
    const lignes = lignesSalaries.map(({ nom }) => {
      const cells = jours.map(d => fmtH(heuresCellule(nom, iso(d))));
      return [nom, ...cells, fmtH(totalOuvrier(nom))];
    });
    const csv = [head, ...lignes].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(sep)).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `heures-salaries-${vue}-${minISO}_${maxISO}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Styles utilitaires ────────────────────────────────────────────────────
  const warnBg    = "rgba(245,166,35,0.12)";
  const warnBorder = "rgba(245,166,35,0.35)";
  const warnText  = "#d98a2b";
  const okBg      = "rgba(80,200,120,0.12)";
  const okBorder  = "rgba(80,200,120,0.35)";
  const okText    = "#3f9c5f";

  // ── Rendu ───────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px", background: T.bg, minHeight: 0 }}>
      {/* En-tête + sélecteurs */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon as={Clock} size={22} color={T.accent} />
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>Heures des salariés</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>Registre validé · préparation de la paie</div>
          </div>
        </div>

        {/* Switch de granularité */}
        <div style={{ display: "flex", gap: 2, background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: 3, marginLeft: "auto" }}>
          {["jour", "semaine", "mois"].map(v => (
            <button key={v} onClick={() => setVue(v)} style={{
              padding: "7px 16px", border: "none", borderRadius: RADIUS.sm || 6, cursor: "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: vue === v ? 700 : 500,
              background: vue === v ? T.accent : "transparent",
              color: vue === v ? (T.labelText || "#111") : T.textSub, textTransform: "capitalize", transition: "all .12s",
            }}>{v}</button>
          ))}
        </div>

        {/* Navigation de période */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => pasPeriode(-1)} title="Période précédente" style={navBtn(T)}><Icon as={ChevronLeft} size={16} /></button>
          <button onClick={aujourdhui} style={{ ...navBtn(T), width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 600, color: T.textSub }}>Aujourd'hui</button>
          <button onClick={() => pasPeriode(1)} title="Période suivante" style={navBtn(T)}><Icon as={ChevronRight} size={16} /></button>
        </div>
      </div>

      {/* Libellé période + toggle détail */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: T.text }}>
          <Icon as={Calendar} size={15} color={T.textMuted} />{labelPeriode}
        </div>
        <button onClick={() => setDetail(d => !d)} style={{
          marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
          background: detail ? T.accent : T.surface, color: detail ? (T.labelText || "#111") : T.textSub,
          border: `1px solid ${detail ? T.accent : T.border}`, borderRadius: RADIUS.md, cursor: "pointer",
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
        }}>
          <Icon as={detail ? EyeOff : Eye} size={14} />{detail ? "Vue simple" : "Vue détaillée"}
        </button>
      </div>

      {/* ── PARTIE 2 : En-tête mensuel (vue mois uniquement) ── */}
      {vue === "mois" && !loading && (
        <EnteteMensuel
          T={T} crNonValides={crNonValides} moisPropre={moisPropre}
          totalMois={totalMois} effectif={effectifActif}
          onGoToValidation={onGoToValidation} onExport={exporterCSV}
          warnBg={warnBg} warnBorder={warnBorder} warnText={warnText}
          okBg={okBg} okBorder={okBorder} okText={okText}
        />
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: T.textMuted }}>Chargement des pointages…</div>
      ) : (
        <Grille
          T={T} vue={vue} jours={jours} semaines={semainesDeLaPlage}
          lignes={lignesSalaries} parOuvrier={parOuvrier} prevuParOuvrier={prevuParOuvrier}
          rapportById={rapportById} chById={chById} detail={detail}
          heuresCellule={heuresCellule} totalOuvrier={totalOuvrier} totalSemaine={totalSemaine}
          onOpenCell={(nom, dISO) => setCellSel({ ouvrier: nom, dateISO: dISO })}
        />
      )}

      {/* Encart Partie 3 (non implémentée) */}
      <div style={{
        marginTop: 20, padding: "12px 16px", background: T.surface, border: `1px dashed ${T.border}`,
        borderRadius: RADIUS.md, display: "flex", gap: 10, alignItems: "flex-start", color: T.textMuted, fontSize: 12.5, lineHeight: 1.5,
      }}>
        <Icon as={Info} size={15} style={{ marginTop: 1, flexShrink: 0 }} />
        <div>
          <strong style={{ color: T.textSub }}>Absences, clôture & export paie</strong> — à venir. Ces briques
          écrivent en base et dépendent de décisions à prendre avec le comptable (format d'export,
          règle des heures sup, modèle des absences). L'export ci-dessus est un récapitulatif de contrôle (CSV).
        </div>
      </div>

      {/* Modale détail de cellule (CR source) */}
      {cellSel && (
        <CelluleModal
          T={T} sel={cellSel} parOuvrier={parOuvrier} rapportById={rapportById} chById={chById}
          onClose={() => setCellSel(null)}
          onGoToValidation={onGoToValidation}
        />
      )}
    </div>
  );
}

// ─── En-tête mensuel (Partie 2) ──────────────────────────────────────────────
function EnteteMensuel({
  T, crNonValides, moisPropre, totalMois, effectif,
  onGoToValidation, onExport, warnBg, warnBorder, warnText, okBg, okBorder, okText,
}) {
  const [showListe, setShowListe] = useState(false);
  // Nombre de jours distincts restant à valider.
  const joursRestants = new Set(crNonValides.map(c => c.date)).size;

  return (
    <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Bandeau de validation */}
      {moisPropre ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: okBg, border: `1px solid ${okBorder}`, borderRadius: RADIUS.md, color: okText, fontSize: 13.5, fontWeight: 600 }}>
          <Icon as={CheckCircle2} size={17} /> Tous les CR de la période sont validés.
        </div>
      ) : (
        <div style={{ padding: "12px 16px", background: warnBg, border: `1px solid ${warnBorder}`, borderRadius: RADIUS.md }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon as={AlertTriangle} size={17} color={warnText} />
            <span style={{ color: warnText, fontSize: 13.5, fontWeight: 700 }}>
              {joursRestants} jour{joursRestants > 1 ? "s" : ""} · {crNonValides.length} CR restent à valider avant de clôturer.
            </span>
            <button onClick={() => setShowListe(s => !s)} style={{ marginLeft: "auto", background: "transparent", border: `1px solid ${warnBorder}`, color: warnText, borderRadius: RADIUS.md, padding: "4px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              {showListe ? "Masquer" : "Détail"}
            </button>
            {onGoToValidation && (
              <button onClick={() => onGoToValidation(crNonValides[0]?.date)} style={{ display: "flex", alignItems: "center", gap: 5, background: warnText, border: "none", color: "#fff", borderRadius: RADIUS.md, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Voir les CR en attente <Icon as={ArrowRight} size={13} />
              </button>
            )}
          </div>
          {showListe && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${warnBorder}`, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {crNonValides.map(c => (
                <button key={c.id} onClick={() => onGoToValidation && onGoToValidation(c.date)} title="Ouvrir dans la Validation"
                  style={{ display: "flex", alignItems: "center", gap: 6, background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "4px 9px", fontSize: 11.5, color: T.textSub, cursor: onGoToValidation ? "pointer" : "default", fontFamily: "inherit" }}>
                  <strong style={{ color: T.text }}>{c.ouvrier || "—"}</strong>
                  <span style={{ color: T.textMuted }}>· {c.date}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI + actions */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
        <Kpi T={T} label="Heures du mois" value={`${fmtH(totalMois)} h`} icon={Clock} />
        <Kpi T={T} label="Effectif pointé" value={String(effectif)} icon={Users} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={onExport} style={{ display: "flex", alignItems: "center", gap: 7, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: RADIUS.md, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Exporter le mois (CSV)
          </button>
          <button disabled title={moisPropre ? "Clôture — à venir (Partie 3)" : "Validez tous les CR avant de clôturer"} style={{
            display: "flex", alignItems: "center", gap: 7, background: "transparent", border: `1px solid ${T.border}`,
            color: T.textMuted, borderRadius: RADIUS.md, padding: "10px 16px", fontSize: 13, fontWeight: 600, cursor: "not-allowed", fontFamily: "inherit", opacity: 0.7,
          }}>
            <Icon as={Lock} size={14} /> Clôturer
          </button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ T, label, value, icon, color }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "12px 16px", minWidth: 150, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.textMuted }}>
        <Icon as={icon} size={13} /> {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || T.text, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ─── Grille salarié × jour ───────────────────────────────────────────────────
function Grille({
  T, vue, jours, semaines, lignes, parOuvrier, prevuParOuvrier, rapportById, chById,
  detail, heuresCellule, totalOuvrier, totalSemaine, onOpenCell,
}) {
  // Coloration du sous-total semaine (heures sup — affichage seulement).
  const couleurSemaine = (t) => {
    if (t > SEUIL_HS_FORT) return "#cf5b5b";
    if (t > SEUIL_HS) return "#d98a2b";
    return T.textMuted;
  };

  const nomColW = 190;
  const cellW = vue === "mois" ? 46 : vue === "semaine" ? 96 : 220;

  return (
    <div style={{ overflowX: "auto", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, background: T.surface }}>
      <table style={{ borderCollapse: "collapse", width: vue === "jour" ? "auto" : "max-content", minWidth: "100%" }}>
        <thead>
          <tr>
            <th style={{ position: "sticky", left: 0, zIndex: 2, background: T.surface, textAlign: "left", padding: "10px 14px", borderBottom: `1px solid ${T.border}`, borderRight: `1px solid ${T.border}`, minWidth: nomColW, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.textMuted }}>
              Salarié
            </th>
            {jours.map(d => {
              const we = isWeekend(d);
              return (
                <th key={iso(d)} style={{
                  padding: "8px 4px", borderBottom: `1px solid ${T.border}`, minWidth: cellW, textAlign: "center",
                  background: we ? T.card : T.surface,
                  fontSize: 11, fontWeight: 600, color: we ? T.textMuted : T.textSub,
                }}>
                  <div style={{ fontSize: 10, opacity: 0.75 }}>{JOURS_COURT[d.getDay()]}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: we ? T.textMuted : T.text }}>{d.getDate()}</div>
                </th>
              );
            })}
            <th style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.textMuted, background: T.surface }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {lignes.map(({ nom, hors }) => {
            const totalMois = totalOuvrier(nom);
            // Sous-totaux hebdo (vue mois) : affichés sous le nom.
            return (
              <tr key={nom} style={{ borderBottom: `1px solid ${T.border}` }}>
                {/* Colonne nom */}
                <td style={{ position: "sticky", left: 0, zIndex: 1, background: T.surface, padding: "8px 14px", borderRight: `1px solid ${T.border}`, minWidth: nomColW }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{nom}</span>
                    {hors && <span title="Nom présent dans les pointages mais absent du référentiel Admin" style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(245,166,35,0.15)", color: "#d98a2b", fontWeight: 700 }}>hors réf.</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>{fmtH(totalMois)} h ce mois</div>
                  {vue === "mois" && semaines.length > 1 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {semaines.map(lundi => {
                        const t = totalSemaine(nom, lundi);
                        if (t <= 0) return null;
                        return (
                          <span key={iso(lundi)} title={`Semaine du ${iso(lundi)}`} style={{
                            fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                            color: couleurSemaine(t), background: T.card,
                          }}>{fmtH(t)}h</span>
                        );
                      })}
                    </div>
                  )}
                </td>

                {/* Cellules jour */}
                {jours.map(d => {
                  const dISO = iso(d);
                  const cell = parOuvrier[normNom(nom)]?.[dISO];
                  const we = isWeekend(d);
                  const prevu = !cell && prevuParOuvrier[normNom(nom)]?.has(dISO);
                  return (
                    <Cellule
                      key={dISO} T={T} cell={cell} we={we} prevu={prevu} detail={detail}
                      chById={chById} rapportById={rapportById}
                      onClick={cell ? () => onOpenCell(nom, dISO) : undefined}
                      width={vue === "mois" ? 46 : vue === "semaine" ? 96 : 220}
                    />
                  );
                })}

                {/* Total ligne */}
                <td style={{ padding: "8px 12px", borderLeft: `1px solid ${T.border}`, textAlign: "center", background: T.surface }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: totalMois > 0 ? T.text : T.textMuted }}>{fmtH(totalMois)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Une cellule (4 états — cf. spec 1e) ─────────────────────────────────────
function Cellule({ T, cell, we, prevu, detail, chById, rapportById, onClick, width }) {
  // État 4 : vide / week-end
  if (!cell && !prevu) {
    return <td style={{ background: we ? T.card : "transparent", minWidth: width }} />;
  }
  // État 2 : prévu non validé (fantôme)
  if (!cell && prevu) {
    return (
      <td style={{ minWidth: width, textAlign: "center", padding: "6px 4px" }}>
        <div style={{
          display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minWidth: 34, padding: "4px 6px", borderRadius: 6, border: `1px dashed ${T.border}`,
          color: T.textMuted, opacity: 0.8,
        }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>—</span>
          <span style={{ fontSize: 8, letterSpacing: 0.3, textTransform: "uppercase" }}>à valider</span>
        </div>
      </td>
    );
  }
  // État 1 : validé
  const photos = cell.pointages.some(p => rapportAPhotos(rapportById[p.rapport_id]));
  const chIds = [...cell.chantiers];
  return (
    <td onClick={onClick} style={{ minWidth: width, textAlign: "center", padding: "6px 4px", cursor: "pointer" }}>
      <div style={{
        display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3,
        minWidth: 36, padding: "5px 7px", borderRadius: 7,
        background: T.cardFill || "rgba(255,194,0,0.06)", border: `1px solid ${T.border}`,
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = T.accent)}
        onMouseLeave={e => (e.currentTarget.style.borderColor = T.border)}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.accent, lineHeight: 1 }}>{fmtH(cell.heures)}</span>
        {/* Pastilles de chantier */}
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {chIds.slice(0, 4).map(cid => (
            <span key={cid} title={chById[cid]?.nom || cid} style={{ width: 6, height: 6, borderRadius: "50%", background: chById[cid]?.couleur || COULEUR_DEFAUT }} />
          ))}
          {chIds.length > 4 && <span style={{ fontSize: 8, color: T.textMuted }}>+{chIds.length - 4}</span>}
          {photos && <Icon as={Camera} size={9} color={T.textMuted} style={{ marginLeft: 1 }} />}
        </div>
        {/* Vue détaillée : éclatement par chantier */}
        {detail && (
          <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 1, width: "100%" }}>
            {chIds.map(cid => {
              const h = cell.pointages.filter(p => p.chantier_id === cid).reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
              return (
                <div key={cid} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 3, fontSize: 8.5, color: T.textSub }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: 60 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: chById[cid]?.couleur || COULEUR_DEFAUT, flexShrink: 0 }} />
                    {chById[cid]?.nom || "?"}
                  </span>
                  <span style={{ fontWeight: 700 }}>{fmtH(h)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </td>
  );
}

// ─── Modale détail cellule (CR source) ───────────────────────────────────────
function CelluleModal({ T, sel, parOuvrier, rapportById, chById, onClose, onGoToValidation }) {
  const cell = parOuvrier[normNom(sel.ouvrier)]?.[sel.dateISO];
  if (!cell) return null;

  // Rapports source distincts (traçabilité).
  const rapportIds = [...new Set(cell.pointages.map(p => p.rapport_id).filter(Boolean))];
  const [y, m, d] = sel.dateISO.split("-");
  const dateLabel = `${d} ${MOIS_LABEL[parseInt(m, 10) - 1]} ${y}`;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(3px)" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.modal, borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${T.border}`, boxShadow: "0 20px 50px rgba(0,0,0,0.5)" }}>
        {/* En-tête */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>{sel.ouvrier}</div>
            <div style={{ fontSize: 12.5, color: T.textMuted }}>{dateLabel} · {fmtH(cell.heures)} h au total</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: T.textSub, padding: 4 }}><Icon as={X} size={20} /></button>
        </div>

        {/* Corps : pointages du jour, groupés par chantier */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
          {[...cell.chantiers].map(cid => {
            const pts = cell.pointages.filter(p => p.chantier_id === cid);
            const h = pts.reduce((s, p) => s + (parseFloat(p.heures) || 0), 0);
            return (
              <div key={cid} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: chById[cid]?.couleur || COULEUR_DEFAUT }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{chById[cid]?.nom || "Chantier"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 800, color: T.accent }}>{fmtH(h)} h</span>
                </div>
                {pts.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", marginBottom: 3, background: T.card, borderRadius: 6, fontSize: 12 }}>
                    <span style={{ flex: 1, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.type_pointage === "indirect" ? (p.motif_indirect || "Heures indirectes") : "Tâche"}
                    </span>
                    <span style={{ fontWeight: 700, color: T.text }}>{fmtH(p.heures)} h</span>
                  </div>
                ))}
              </div>
            );
          })}
          {/* Pointages sans chantier (indirects globaux) */}
          {cell.pointages.filter(p => !p.chantier_id).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.textSub, marginBottom: 6 }}>Sans chantier</div>
              {cell.pointages.filter(p => !p.chantier_id).map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", marginBottom: 3, background: T.card, borderRadius: 6, fontSize: 12 }}>
                  <span style={{ flex: 1, color: T.textSub }}>{p.motif_indirect || "Heures indirectes"}</span>
                  <span style={{ fontWeight: 700, color: T.text }}>{fmtH(p.heures)} h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pied : renvoi vers la Validation (correction = revalider le CR) */}
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ fontSize: 11.5, color: T.textMuted }}>
            Pour corriger une heure, revalidez le CR ({rapportIds.length} rapport{rapportIds.length > 1 ? "s" : ""} source).
          </span>
          {onGoToValidation && (
            <button onClick={() => { onGoToValidation(sel.dateISO); onClose(); }} style={{ display: "flex", alignItems: "center", gap: 5, background: T.accent, border: "none", color: T.labelText || "#111", borderRadius: RADIUS.md, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
              Ouvrir la Validation <Icon as={ArrowRight} size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Petit bouton de navigation ───────────────────────────────────────────────
function navBtn(T) {
  return {
    width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
    color: T.textSub, cursor: "pointer", flexShrink: 0,
  };
}
