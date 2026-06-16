// Page « Validation de fin de journée »
//
// Le conducteur valide les comptes rendus soumis par les ouvriers. La validation
// crée les écritures de la table `pointages` (registre de pointage : ouvrier +
// tâche + date + heures + taux figé). Tant qu'un rapport n'est pas validé,
// aucun pointage n'existe pour ses lignes — le coût MO du chantier n'inclut
// donc PAS ces heures (cf. badge "non validé" prévu au P8).
//
// À ce stade (P3) :
//   - Lecture seule des lignes de tâche du rapport (édition au P4+5)
//   - Zone "heures indirectes" optionnelle (conducteur peut ajouter)
//   - Alertes non bloquantes (>10h / ouvrier non planifié / tâche à 100%)
//   - Anti-double comptage : statut="valide" verrouille le rapport

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { Icon } from "./ui";
import {
  CheckCircle2, AlertTriangle, Clock, User as UserIcon, X, ChevronDown, ChevronRight,
  Plus, Trash2,
} from "lucide-react";
import { getBranchAccent, RADIUS, FONT, JOURS } from "./constants";

// ─── Helpers date ────────────────────────────────────────────────────────────

function dateKey(d = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// dateStr "YYYY-MM-DD" → { weekId: "YYYY-Www", jour: "Lundi"... }
// Utile pour retrouver les ouvriers planifiés ce jour-là (table planning_cells).
function weekIdAndJourFromDate(dateStr) {
  if (!dateStr) return { weekId: "", jour: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return { weekId: "", jour: "" };
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const dayNr = (target.getDay() + 6) % 7; // 0 = Monday
  target.setDate(target.getDate() - dayNr + 3); // Thursday
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + (firstThursday.getDay() + 6) % 7) / 7);
  const year = target.getFullYear();
  const JOURS_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
  return { weekId: `${year}-W${String(week).padStart(2, "0")}`, jour: JOURS_FULL[dayNr] };
}

function fmtH(h) {
  const v = parseFloat(h) || 0;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// ─── Composants UI ───────────────────────────────────────────────────────────

function StatutBadge({ statut }) {
  const valide = statut === "valide";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 999,
      background: valide ? "rgba(80,200,120,0.15)" : "rgba(245,166,35,0.15)",
      color: valide ? "#22a060" : "#d18a16",
      fontSize: 11, fontWeight: 600, letterSpacing: .3, textTransform: "uppercase",
    }}>
      <Icon as={valide ? CheckCircle2 : Clock} size={12}/>
      {valide ? "Validé" : "En attente"}
    </span>
  );
}

function StatutTacheLabel({ statut }) {
  const label = statut === "faite" ? "Faite"
              : statut === "en_cours" ? "En cours"
              : statut === "non_faite" ? "Pas faite"
              : "—";
  const color = statut === "faite" ? "#50c878"
              : statut === "en_cours" ? "#4db8ff"
              : statut === "non_faite" ? "#e05c5c"
              : "#888";
  return <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: .3 }}>{label}</span>;
}

function AlerteBox({ icon, text, T }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", borderRadius: RADIUS.md,
      background: "rgba(245,166,35,0.10)",
      border: "1px solid rgba(245,166,35,0.35)",
      color: "#b27416",
      fontSize: 13,
    }}>
      <Icon as={icon || AlertTriangle} size={16}/>
      <span style={{ flex: 1 }}>{text}</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function PageValidation({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation", profil }) {
  const acc = getBranchAccent(branch);
  const [dateFilter, setDateFilter] = useState(dateKey());
  const [rapports, setRapports] = useState([]);
  const [cellsJour, setCellsJour] = useState([]);  // planning_cells du jour (pour alertes "non planifié")
  const [phasages, setPhasages] = useState([]);    // pour vérifier l'avancement actuel des tâches
  const [loading, setLoading] = useState(true);
  const [openedId, setOpenedId] = useState(null);
  const [indirectes, setIndirectes] = useState([]); // lignes d'heures indirectes saisies dans la modale
  const [validating, setValidating] = useState(false);
  const [statutColManquante, setStatutColManquante] = useState(false);

  const valideur = profil?.nom || profil?.email || "Conducteur";

  // ── Chargement ─────────────────────────────────────────────────────────────

  const load = async () => {
    setLoading(true);
    setStatutColManquante(false);
    // Rapports du jour. On essaie d'abord avec statut, repli si la colonne manque.
    let { data: rs, error } = await supabase
      .from("rapports").select("*")
      .eq("date_rapport", dateFilter)
      .order("ouvrier");
    if (error && /statut/.test(error.message || "")) {
      setStatutColManquante(true);
      const r2 = await supabase.from("rapports").select("*")
        .eq("date_rapport", dateFilter).order("ouvrier");
      rs = r2.data || [];
    } else if (error) {
      console.error("Validation.load rapports:", error);
      rs = [];
    }
    setRapports(rs || []);

    // Planning cells du jour : pour détecter ouvrier non planifié
    const { weekId, jour } = weekIdAndJourFromDate(dateFilter);
    if (weekId && jour) {
      const { data: cells } = await supabase
        .from("planning_cells").select("chantier_id,ouvriers,taches")
        .eq("week_id", weekId).eq("jour", jour);
      setCellsJour(cells || []);
    } else {
      setCellsJour([]);
    }

    // Phasages pour vérifier l'avancement actuel des tâches pointées
    const chIds = [...new Set((rs || []).map(r => r.chantier_id).filter(Boolean))];
    if (chIds.length > 0) {
      const { data: phs } = await supabase.from("phasages")
        .select("id,chantier_id,plan_travaux")
        .in("chantier_id", chIds);
      setPhasages(phs || []);
    } else {
      setPhasages([]);
    }

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateFilter]);

  // ── Index utiles ───────────────────────────────────────────────────────────

  const ouvriersPlanifies = useMemo(() => {
    const s = new Set();
    cellsJour.forEach(c => (c.ouvriers || []).forEach(o => s.add(o)));
    return s;
  }, [cellsJour]);

  // Map: chantier_id → { tache_id → avancement_actuel (0-100) }
  const avancementParTache = useMemo(() => {
    const m = {};
    phasages.forEach(ph => {
      const plan = ph.plan_travaux || {};
      const par = {};
      Object.keys(plan).forEach(phaseId => {
        if (phaseId === "meta") return;
        const taches = plan[phaseId];
        if (!Array.isArray(taches)) return;
        taches.forEach(t => {
          if (t.id != null) par[String(t.id)] = parseFloat(t.avancement) || 0;
        });
      });
      m[ph.chantier_id] = par;
    });
    return m;
  }, [phasages]);

  // Map: chantier_id → phasage_id (uuid) — pour brancher les pointages
  const phasageIdParChantier = useMemo(() => {
    const m = {};
    phasages.forEach(ph => { m[ph.chantier_id] = ph.id; });
    return m;
  }, [phasages]);

  // ── Alertes d'un rapport ───────────────────────────────────────────────────

  function alertesRapport(r) {
    const alerts = [];
    const totalH = (r.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0)
                 + ((parseInt(r.trajet_matin_min) || 0) + (parseInt(r.trajet_soir_min) || 0)) / 60;
    if (totalH > 10) {
      alerts.push({ icon: AlertTriangle, text: `Journée à ${fmtH(totalH)}h — au-dessus de 10h.` });
    }
    if (r.ouvrier && ouvriersPlanifies.size > 0 && !ouvriersPlanifies.has(r.ouvrier)) {
      alerts.push({ icon: AlertTriangle, text: `${r.ouvrier} n'était pas planifié ce jour-là.` });
    }
    const avancements = avancementParTache[r.chantier_id] || {};
    (r.taches || []).forEach(t => {
      const av = t.tache_id ? avancements[String(t.tache_id)] : null;
      if (av === 100 && (parseFloat(t.heures_reelles) || 0) > 0) {
        alerts.push({ icon: AlertTriangle, text: `« ${t.planifie} » pointée alors qu'elle est déjà à 100 %.` });
      }
    });
    return alerts;
  }

  // ── Groupement par ouvrier ─────────────────────────────────────────────────

  const rapportsParOuvrier = useMemo(() => {
    const m = {};
    rapports.forEach(r => {
      const key = r.ouvrier || "(sans nom)";
      if (!m[key]) m[key] = [];
      m[key].push(r);
    });
    return Object.entries(m).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rapports]);

  const opened = openedId ? rapports.find(r => r.id === openedId) : null;

  // ── Validation ─────────────────────────────────────────────────────────────

  async function validerRapport(r) {
    if (!r || r.statut === "valide") return;
    setValidating(true);

    const taux = parseFloat(tauxHoraires?.[r.ouvrier]) || 0;
    const phasage_id = phasageIdParChantier[r.chantier_id] || null;

    // Lignes à insérer : tâches (heures > 0) + heures indirectes saisies
    const lignesTaches = (r.taches || [])
      .filter(t => (parseFloat(t.heures_reelles) || 0) > 0)
      .map(t => ({
        chantier_id: r.chantier_id,
        phasage_id,
        phase_id: t.phase_id || null,
        tache_id: t.tache_id || null,
        ouvrier: r.ouvrier,
        date: r.date_rapport,
        heures: parseFloat(t.heures_reelles) || 0,
        taux_horaire: taux,
        rapport_id: r.id,
        avancement_declare: t.avancement != null ? parseInt(t.avancement) : null,
        valide_par: valideur,
        type_pointage: "tache",
      }));

    const lignesIndirectes = indirectes
      .filter(li => (parseFloat(li.heures) || 0) > 0 && (li.motif || "").trim())
      .map(li => ({
        chantier_id: r.chantier_id,
        phasage_id,
        phase_id: null,
        tache_id: null,
        ouvrier: r.ouvrier,
        date: r.date_rapport,
        heures: parseFloat(li.heures),
        taux_horaire: taux,
        rapport_id: r.id,
        avancement_declare: null,
        valide_par: valideur,
        type_pointage: "indirect",
        motif_indirect: li.motif.trim(),
      }));

    const lignes = [...lignesTaches, ...lignesIndirectes];

    if (lignes.length > 0) {
      const { error: insErr } = await supabase.from("pointages").insert(lignes);
      // Code 23505 = unique violation : un autre process a déjà validé ce rapport.
      if (insErr && insErr.code !== "23505") {
        console.error("Insert pointages:", insErr);
        alert("Erreur lors de la création des pointages — la validation est annulée.");
        setValidating(false);
        return;
      }
    }

    // Marque le rapport comme validé. Repli si colonne statut absente.
    let { error: upErr } = await supabase.from("rapports")
      .update({ statut: "valide", valide_par: valideur, valide_le: new Date().toISOString() })
      .eq("id", r.id);
    if (upErr && /statut|valide_par|valide_le/.test(upErr.message || "")) {
      console.warn("Colonne statut/valide_* absente, repli sans marquage de statut.");
      // On laisse le rapport sans statut explicite. Les pointages sont créés,
      // mais l'idempotence repose alors uniquement sur l'index unique côté SQL.
      upErr = null;
    }
    if (upErr) console.error("Update rapport statut:", upErr);

    setValidating(false);
    setOpenedId(null);
    setIndirectes([]);
    await load();
  }

  // ── Rendu ──────────────────────────────────────────────────────────────────

  return (
    <div className="page-padding" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, color: T.text, fontWeight: 700 }}>
          Validation de fin de journée
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 13, color: T.textSub }}>Date :</label>
          <input
            type="date"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            style={{
              padding: "6px 10px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.surface, color: T.text,
              fontSize: 14, fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      <div style={{ fontSize: 13, color: T.textSub, marginBottom: 16 }}>
        {dateLabel(dateFilter)} — {rapports.length} rapport{rapports.length > 1 ? "s" : ""}
      </div>

      {statutColManquante && (
        <div style={{ marginBottom: 12 }}>
          <AlerteBox text="La colonne `rapports.statut` n'a pas encore été ajoutée à Supabase — exécute le SQL du P3 pour activer le verrouillage anti-double-comptage." T={T}/>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: T.textSub }}>Chargement…</div>
      ) : rapports.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: T.textSub, fontSize: 14 }}>
          Aucun rapport pour cette date.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rapportsParOuvrier.map(([ouvrier, rs]) => (
            <div key={ouvrier} style={{
              background: T.surface, borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, padding: 12,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon as={UserIcon} size={16} color={acc.accent}/>
                <span style={{ fontWeight: 700, color: T.text, fontSize: 15 }}>{ouvrier}</span>
                <span style={{ fontSize: 12, color: T.textSub }}>· {rs.length} chantier{rs.length > 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rs.map(r => {
                  const totalH = (r.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
                  const alerts = alertesRapport(r);
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setOpenedId(r.id); setIndirectes([]); }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto auto auto",
                        gap: 12, alignItems: "center",
                        padding: "10px 12px", borderRadius: RADIUS.md,
                        background: T.widgetBg || T.bg, border: `1px solid ${T.border}`,
                        cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: T.text,
                      }}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{r.chantier_nom || r.chantier_id}</span>
                      <span style={{ fontSize: 12, color: T.textSub }}>{fmtH(totalH)}h</span>
                      {alerts.length > 0 && (
                        <span title={alerts.map(a => a.text).join("\n")} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 6px", borderRadius: 999,
                          background: "rgba(245,166,35,0.15)", color: "#b27416",
                          fontSize: 11, fontWeight: 600,
                        }}>
                          <Icon as={AlertTriangle} size={12}/>{alerts.length}
                        </span>
                      )}
                      <StatutBadge statut={r.statut}/>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {opened && (
        <ModaleRapport
          rapport={opened}
          T={T} acc={acc}
          taux={parseFloat(tauxHoraires?.[opened.ouvrier]) || 0}
          alertes={alertesRapport(opened)}
          indirectes={indirectes}
          setIndirectes={setIndirectes}
          avancementParTache={avancementParTache[opened.chantier_id] || {}}
          onClose={() => { setOpenedId(null); setIndirectes([]); }}
          onValider={() => validerRapport(opened)}
          validating={validating}
        />
      )}
    </div>
  );
}

// ─── Modale détail rapport ───────────────────────────────────────────────────

function ModaleRapport({ rapport, T, acc, taux, alertes, indirectes, setIndirectes, avancementParTache, onClose, onValider, validating }) {
  const totalHTaches = (rapport.taches || []).reduce((s, t) => s + (parseFloat(t.heures_reelles) || 0), 0);
  const totalHIndirect = (indirectes || []).reduce((s, t) => s + (parseFloat(t.heures) || 0), 0);
  const totalCout = (totalHTaches + totalHIndirect) * taux;
  const valide = rapport.statut === "valide";

  const ajouterIndirect = () => setIndirectes(prev => [...prev, { motif: "", heures: "" }]);
  const removeIndirect = (idx) => setIndirectes(prev => prev.filter((_, i) => i !== idx));
  const updateIndirect = (idx, patch) => setIndirectes(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x));

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, color: T.text,
        borderRadius: RADIUS.lg || 12,
        width: "100%", maxWidth: 720, maxHeight: "90vh",
        overflowY: "auto",
        border: `1px solid ${T.border}`,
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {rapport.ouvrier} — {rapport.chantier_nom || rapport.chantier_id}
            </div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
              {dateLabel(rapport.date_rapport)} · {fmtH(totalHTaches)}h tâches · taux {taux}€/h
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatutBadge statut={rapport.statut}/>
            <button onClick={onClose} style={{
              background: "transparent", border: "none", cursor: "pointer", padding: 4,
              color: T.textSub, display: "flex", alignItems: "center",
            }}>
              <Icon as={X} size={20}/>
            </button>
          </div>
        </div>

        {/* Alertes */}
        {alertes.length > 0 && (
          <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 6 }}>
            {alertes.map((a, i) => <AlerteBox key={i} icon={a.icon} text={a.text} T={T}/>)}
          </div>
        )}

        {/* Tâches du rapport */}
        <div style={{ padding: "16px 20px" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: T.textSub }}>
            Tâches déclarées
          </h3>
          {(rapport.taches || []).length === 0 ? (
            <div style={{ color: T.textSub, fontSize: 13 }}>Aucune tâche.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(rapport.taches || []).map((t, i) => {
                const av = t.tache_id ? avancementParTache[String(t.tache_id)] : null;
                const libre = !t.tache_id;
                return (
                  <div key={i} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 70px 70px 90px",
                    gap: 10, alignItems: "center",
                    padding: "8px 12px", borderRadius: RADIUS.md,
                    background: T.widgetBg || T.bg, border: `1px solid ${T.border}`,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.planifie || "(sans titre)"}
                      </div>
                      <div style={{ fontSize: 11, color: T.textSub, marginTop: 2 }}>
                        {libre ? "Tâche libre" : `Plan · ${t.phase_id || "?"}`}
                        {av != null && ` · plan à ${av}%`}
                        {t.remarque ? ` · ${t.remarque}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, textAlign: "right" }}>{fmtH(t.heures_reelles)}h</div>
                    <div style={{ textAlign: "right" }}>
                      <StatutTacheLabel statut={t.statut}/>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 12, color: T.textSub }}>
                      Av. {parseInt(t.avancement) || 0}%
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {rapport.remarque && (
            <div style={{ marginTop: 10, padding: "8px 12px", background: T.widgetBg || T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, fontSize: 13, color: T.text }}>
              <strong>Remarque générale :</strong> {rapport.remarque}
            </div>
          )}
        </div>

        {/* Heures indirectes */}
        <div style={{ padding: "0 20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: T.textSub }}>
              Heures indirectes (optionnel)
            </h3>
            {!valide && (
              <button onClick={ajouterIndirect} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
                background: "transparent", color: T.text, cursor: "pointer",
                fontFamily: "inherit", fontSize: 12,
              }}>
                <Icon as={Plus} size={12}/> Ajouter
              </button>
            )}
          </div>
          {indirectes.length === 0 ? (
            <div style={{ fontSize: 12, color: T.textSub, fontStyle: "italic" }}>
              Trajet, intempéries, nettoyage, SAV, … (non imputées à une tâche vendue).
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {indirectes.map((li, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "1fr 90px 32px",
                  gap: 8, alignItems: "center",
                }}>
                  <input
                    type="text"
                    placeholder="Motif (ex: intempéries)"
                    value={li.motif}
                    onChange={e => updateIndirect(i, { motif: e.target.value })}
                    disabled={valide}
                    style={{
                      padding: "6px 10px", borderRadius: RADIUS.md,
                      border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
                      fontSize: 13, fontFamily: "inherit",
                    }}
                  />
                  <input
                    type="number"
                    placeholder="Heures"
                    value={li.heures}
                    onChange={e => updateIndirect(i, { heures: e.target.value })}
                    disabled={valide}
                    step="0.25" min="0"
                    style={{
                      padding: "6px 10px", borderRadius: RADIUS.md,
                      border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
                      fontSize: 13, fontFamily: "inherit", textAlign: "right",
                    }}
                  />
                  <button onClick={() => removeIndirect(i)} disabled={valide} style={{
                    background: "transparent", border: "none", cursor: "pointer",
                    color: "#e05c5c", padding: 4, display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon as={Trash2} size={14}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          position: "sticky", bottom: 0, background: T.surface,
        }}>
          <div style={{ fontSize: 13, color: T.textSub }}>
            Total : <strong style={{ color: T.text }}>{fmtH(totalHTaches + totalHIndirect)}h</strong>
            {" · "}
            Coût MO : <strong style={{ color: T.text }}>{totalCout.toFixed(2)}€</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{
              padding: "8px 16px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: "transparent", color: T.text,
              cursor: "pointer", fontFamily: "inherit", fontSize: 13,
            }}>
              Fermer
            </button>
            {!valide ? (
              <button
                onClick={onValider}
                disabled={validating}
                style={{
                  padding: "8px 16px", borderRadius: RADIUS.md,
                  border: "none", background: acc.accent, color: "#fff",
                  cursor: validating ? "wait" : "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  opacity: validating ? 0.6 : 1,
                }}
              >
                {validating ? "Validation…" : "Valider le rapport"}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: T.textSub, fontStyle: "italic" }}>
                Rapport déjà validé{rapport.valide_par ? ` par ${rapport.valide_par}` : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PageValidation;
