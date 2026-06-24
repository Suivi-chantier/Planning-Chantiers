// Page « Validation de fin de journée »
//
// Le conducteur valide les comptes rendus soumis par les ouvriers. La validation
// crée les écritures de la table `pointages` (registre de pointage : ouvrier +
// tâche + date + heures + taux figé). Tant qu'un rapport n'est pas validé,
// aucun pointage n'existe pour ses lignes — le coût MO du chantier n'inclut
// donc PAS ces heures (cf. badge "non validé" prévu au P8).
//
// État après P3 + P4 + P5 :
//   - P3 : liste rapports par ouvrier, statut, alertes, zone indirectes,
//          validation crée les pointages.
//   - P4 : édition AVANT validation. Le conducteur peut réaffecter une ligne
//          à une autre tâche du plan, modifier les heures, splitter, créer une
//          nouvelle tâche du plan. Non destructif : rapports.taches[] reste
//          intact — on travaille sur une copie locale `lignes`.
//   - P5 : avancement arbitré. Champ "validé" pré-rempli avec la valeur
//          déclarée par l'ouvrier. Garde-fou anti-régression si baisse vs plan.
//          Affichage des propositions des autres ouvriers ayant pointé la même
//          tâche le même jour. À la validation, écriture du validé dans le
//          plan_travaux, conservation du déclaré dans pointages.avancement_declare.

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import {
  CheckCircle2, AlertTriangle, Clock, User as UserIcon, X,
  Plus, Trash2, Split, PlusCircle, Lock, LockOpen,
} from "lucide-react";
import { getBranchAccent, RADIUS, PHASES_DEFAUT, loadPhases } from "../constants";

// ─── Helpers date ────────────────────────────────────────────────────────────

function dateKey(d = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Les rapports stockent date_rapport au format français "DD/MM/YYYY"
// (cf. RapportMobile.jsx : new Date().toLocaleDateString("fr-FR")).
// L'input <date> nous donne du ISO "YYYY-MM-DD" — on convertit pour le filtre.
function isoToFR(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Inverse : convertit "16/06/2026" → "2026-06-16" (pour les colonnes Postgres
// de type date, comme pointages.date qui n'accepte que l'ISO).
function frToISO(fr) {
  if (!fr) return "";
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fr);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Déjà ISO ?
  if (/^\d{4}-\d{2}-\d{2}$/.test(fr)) return fr;
  return fr;
}

function dateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function weekIdAndJourFromDate(dateStr) {
  if (!dateStr) return { weekId: "", jour: "" };
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return { weekId: "", jour: "" };
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
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

function genId() { return Math.random().toString(36).slice(2); }

// ─── Fuzzy match : nom écrit par l'ouvrier → tâche du plan ──────────────────
// Score sur 1. Le seuil d'auto-affectation est défini plus bas (0.55).

function normalizeNom(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // enlève les accents
    .replace(/[^a-z0-9 ]/g, " ")                       // ponctuation → espace
    .replace(/\s+/g, " ").trim();
}

function scoreSimilariteNom(a, b) {
  const na = normalizeNom(a), nb = normalizeNom(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(" ").filter(w => w.length > 2));
  const wb = new Set(nb.split(" ").filter(w => w.length > 2));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  wa.forEach(w => { if (wb.has(w)) common++; });
  // Dice coefficient : 2 × communs / (size A + size B)
  return (2 * common) / (wa.size + wb.size);
}

function meilleureTachePlan(nomOuvrier, tachesPlan) {
  let best = null;
  for (const t of (tachesPlan || [])) {
    const s = scoreSimilariteNom(nomOuvrier, t.nom);
    if (!best || s > best.score) best = { tache: t, score: s };
  }
  return best;
}

const SEUIL_AUTOMATCH = 0.55;

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

// ─── Page principale ─────────────────────────────────────────────────────────

function PageValidation({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation", profil }) {
  const acc = getBranchAccent(branch);
  const [dateFilter, setDateFilter] = useState(dateKey());
  const [rapports, setRapports] = useState([]);
  const [cellsJour, setCellsJour] = useState([]);
  const [phasages, setPhasages] = useState([]);
  const [phases, setPhases] = useState(PHASES_DEFAUT);
  const [loading, setLoading] = useState(true);
  const [openedId, setOpenedId] = useState(null);
  const [validating, setValidating] = useState(false);
  const [statutColManquante, setStatutColManquante] = useState(false);
  // P6 : clôture de journée — null si pas encore chargé, false si aucune entrée,
  // sinon l'objet { statut, historique, ... } pour la date filtrée.
  const [cloture, setCloture] = useState(null);
  const [reopenMotif, setReopenMotif] = useState(""); // saisie quand on rouvre
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [showHistorique, setShowHistorique] = useState(false);
  const [clotureBusy, setClotureBusy] = useState(false);
  const [clotureTableManquante, setClotureTableManquante] = useState(false);

  const valideur = profil?.nom || profil?.email || "Conducteur";

  useEffect(() => { loadPhases().then(setPhases); }, []);

  const load = async () => {
    setLoading(true);
    setStatutColManquante(false);
    // Les rapports peuvent être stockés au format FR (DD/MM/YYYY, ancien) ou
    // ISO (YYYY-MM-DD, plus récent). On match les deux pour ne rien rater.
    const dateFR = isoToFR(dateFilter);
    let { data: rs, error } = await supabase
      .from("rapports").select("*")
      .in("date_rapport", [dateFilter, dateFR]).order("ouvrier");
    if (error && /statut/.test(error.message || "")) {
      setStatutColManquante(true);
      const r2 = await supabase.from("rapports").select("*")
        .in("date_rapport", [dateFilter, dateFR]).order("ouvrier");
      rs = r2.data || [];
    } else if (error) {
      console.error("Validation.load rapports:", error);
      rs = [];
    }
    setRapports(rs || []);

    const { weekId, jour } = weekIdAndJourFromDate(dateFilter);
    if (weekId && jour) {
      const { data: cells } = await supabase
        .from("planning_cells").select("chantier_id,ouvriers,taches")
        .eq("week_id", weekId).eq("jour", jour);
      setCellsJour(cells || []);
    } else {
      setCellsJour([]);
    }

    // P6 : charge la clôture (globale) pour cette date
    {
      const { data: clot, error: clotErr } = await supabase
        .from("clotures_journee").select("*")
        .eq("date", dateFilter).is("chantier_id", null)
        .maybeSingle();
      if (clotErr?.code === "42P01") {
        setClotureTableManquante(true);
        setCloture(false);
      } else if (clotErr) {
        console.warn("Chargement clôture:", clotErr.message);
        setCloture(false);
      } else {
        setClotureTableManquante(false);
        setCloture(clot || false);
      }
    }

    const chIds = [...new Set((rs || []).map(r => r.chantier_id).filter(Boolean))];
    if (chIds.length > 0) {
      const { data: phs } = await supabase.from("phasages")
        .select("id,chantier_id,plan_travaux,ouvrages")
        .in("chantier_id", chIds);
      setPhasages(phs || []);
    } else {
      setPhasages([]);
    }

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateFilter]);

  const ouvriersPlanifies = useMemo(() => {
    const s = new Set();
    cellsJour.forEach(c => (c.ouvriers || []).forEach(o => s.add(o)));
    return s;
  }, [cellsJour]);

  // Map: chantier_id → { tache_id → avancement_actuel (0-100) }
  const avancementParTache = useMemo(() => {
    const m = {};
    phasages.forEach(ph => {
      const par = {};
      const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];
      if (ouvrages.length > 0) {
        // V2 : tâches d'ouvrages
        ouvrages.forEach(o => (o.taches || []).forEach(t => {
          if (t.id != null) par[String(t.id)] = parseFloat(t.avancement) || 0;
        }));
      } else {
        // Repli V1 : plan_travaux
        const plan = ph.plan_travaux || {};
        Object.keys(plan).forEach(phaseId => {
          if (phaseId === "meta") return;
          const arr = plan[phaseId];
          if (!Array.isArray(arr)) return;
          arr.forEach(t => { if (t.id != null) par[String(t.id)] = parseFloat(t.avancement) || 0; });
        });
      }
      m[ph.chantier_id] = par;
    });
    return m;
  }, [phasages]);

  // Map: chantier_id → liste des tâches du plan (pour le dropdown de réaffectation)
  const tachesPlanParChantier = useMemo(() => {
    const m = {};
    phasages.forEach(ph => {
      const taches = [];
      const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];
      if (ouvrages.length > 0) {
        // V2 : tâches d'ouvrages, groupées par libellé d'ouvrage (`groupe`).
        ouvrages.forEach(o => (o.taches || []).forEach(t =>
          taches.push({ id: t.id, nom: t.nom, ouvrage_id: o.id, phase_id: null, groupe: o.libelle || "(sans libellé)", ouvriers: t.ouvriers })
        ));
      } else {
        // Repli V1 : tâches de plan_travaux, groupées par phase.
        const plan = ph.plan_travaux || {};
        Object.keys(plan).forEach(phaseId => {
          if (phaseId === "meta") return;
          const arr = plan[phaseId];
          if (!Array.isArray(arr)) return;
          arr.forEach(t => taches.push({ id: t.id, nom: t.nom, ouvrage_id: null, phase_id: phaseId, groupe: phaseId, ouvriers: t.ouvriers }));
        });
      }
      m[ph.chantier_id] = taches;
    });
    return m;
  }, [phasages]);

  // Map: chantier_id → uuid du phasage (pour update et lien pointages)
  const phasageIdParChantier = useMemo(() => {
    const m = {};
    phasages.forEach(ph => { m[ph.chantier_id] = ph.id; });
    return m;
  }, [phasages]);

  // Propositions d'avancement des AUTRES ouvriers ayant pointé la même tâche le même jour
  // (P5 — affichage côte à côte). Indexé par tache_id.
  function autresPropositionsPourRapport(r) {
    if (!r) return {};
    const m = {};
    rapports.forEach(rOther => {
      if (rOther.id === r.id) return;
      (rOther.taches || []).forEach(t => {
        if (t.tache_id != null && t.avancement != null) {
          const key = String(t.tache_id);
          if (!m[key]) m[key] = [];
          m[key].push({ ouvrier: rOther.ouvrier, avancement: parseInt(t.avancement) || 0 });
        }
      });
    });
    return m;
  }

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

  // ── P6 : Clôture / Réouverture ────────────────────────────────────────────
  // Une journée est "clôturée" si une ligne existe pour la date avec statut='cloture'.
  // "reouverte" = ligne présente mais explicitement rouverte.
  const journeeCloturee = cloture && cloture.statut === "cloture";

  async function cloturerJournee() {
    if (clotureBusy) return;
    const enAttente = rapports.filter(r => r.statut !== "valide");
    if (enAttente.length > 0) {
      const ok = window.confirm(
        `${enAttente.length} rapport${enAttente.length > 1 ? "s ne sont" : " n'est"} pas encore validé${enAttente.length > 1 ? "s" : ""}.\n\n`
        + `Clôturer la journée du ${dateLabel(dateFilter)} malgré tout ?\n\n`
        + `(Tu pourras toujours rouvrir la journée plus tard, avec motif.)`
      );
      if (!ok) return;
    }
    setClotureBusy(true);
    const now = new Date().toISOString();
    const entry = { action: "cloture", par: valideur, le: now };
    try {
      if (cloture && cloture.id) {
        const newHist = [...(cloture.historique || []), entry];
        const { error } = await supabase.from("clotures_journee")
          .update({ statut: "cloture", historique: newHist, cloture_par: valideur, cloture_le: now, updated_at: now })
          .eq("id", cloture.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("clotures_journee")
          .insert({ date: dateFilter, chantier_id: null, statut: "cloture", historique: [entry], cloture_par: valideur });
        if (error) throw error;
      }
    } catch (e) {
      console.error("Clôture:", e);
      alert(`Erreur clôture : ${e.message || e}`);
    }
    setClotureBusy(false);
    await load();
  }

  async function rouvrirJournee() {
    if (clotureBusy || !cloture?.id) return;
    if (!reopenMotif.trim()) { alert("Indique un motif de réouverture."); return; }
    setClotureBusy(true);
    const now = new Date().toISOString();
    const entry = { action: "reouverture", par: valideur, le: now, motif: reopenMotif.trim() };
    const newHist = [...(cloture.historique || []), entry];
    try {
      const { error } = await supabase.from("clotures_journee")
        .update({ statut: "reouverte", historique: newHist, updated_at: now })
        .eq("id", cloture.id);
      if (error) throw error;
    } catch (e) {
      console.error("Réouverture:", e);
      alert(`Erreur réouverture : ${e.message || e}`);
    }
    setClotureBusy(false);
    setReopenMotif("");
    setShowReopenModal(false);
    await load();
  }

  // ── Création d'une nouvelle tâche ─────────────────────────────────────────
  // V2 : crée la tâche dans l'ouvrage « Divers / hors devis » (créé si absent).
  // V1 (repli, chantier sans ouvrages) : crée dans plan_travaux[phase_id].
  // Retourne { tache_id, ouvrage_id?, phase_id? }.
  async function creerTacheDansPlan({ chantier_id, phase_id, nom, heures_vendues, ouvriers: ouvriersList }) {
    const ph = phasages.find(p => p.chantier_id === chantier_id);
    if (!ph) {
      alert(`Aucun phasage existant pour le chantier ${chantier_id}. Crée-le d'abord depuis la page Phasage.`);
      return null;
    }
    const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];

    // ── V2 : tâche dans l'ouvrage « Divers / hors devis »
    if (ouvrages.length > 0) {
      const newTache = {
        id: genId(), nom: nom.trim(),
        heures_estimees: null, heures_reelles: null, avancement: 0,
        ouvriers: Array.isArray(ouvriersList) ? ouvriersList : [],
        date_prevue: null, _cree_depuis_validation: true,
      };
      let next = ouvrages.map(o => ({ ...o }));
      let divers = next.find(o => (o.libelle || "").trim().toLowerCase() === "divers / hors devis");
      if (divers) {
        divers.taches = [...(divers.taches || []), newTache];
      } else {
        divers = { id: genId(), libelle: "Divers / hors devis", lot_id: null, heures_devis: null,
          quantite: null, unite: "U", prix_ht: null, cout_materiaux: null, taches: [newTache] };
        next = [...next, divers];
      }
      const { error } = await supabase.from("phasages").update({ ouvrages: next }).eq("id", ph.id);
      if (error) {
        console.error("creerTacheDansOuvrage:", error);
        alert("Erreur lors de la création de la tâche.");
        return null;
      }
      setPhasages(prev => prev.map(p => p.id === ph.id ? { ...p, ouvrages: next } : p));
      return { tache_id: newTache.id, ouvrage_id: divers.id, phase_id: null };
    }

    // ── V1 (repli) : plan_travaux
    const plan = { ...(ph.plan_travaux || {}) };
    const existing = Array.isArray(plan[phase_id]) ? [...plan[phase_id]] : [];
    const newTache = {
      id: genId(), nom: nom.trim(),
      heures_vendues: parseFloat(heures_vendues) || 0,
      heures_estimees: 0, heures_reelles: 0, cout_materiel: 0,
      ouvriers: Array.isArray(ouvriersList) ? ouvriersList : [],
      avancement: 0, date_prevue: null, _cree_depuis_validation: true,
    };
    plan[phase_id] = [...existing, newTache];
    const { error } = await supabase.from("phasages").update({ plan_travaux: plan }).eq("id", ph.id);
    if (error) {
      console.error("creerTacheDansPlan:", error);
      alert("Erreur lors de la création de la tâche dans le plan.");
      return null;
    }
    setPhasages(prev => prev.map(p => p.id === ph.id ? { ...p, plan_travaux: plan } : p));
    return { tache_id: newTache.id, phase_id };
  }

  // ── Validation (P3 + P4 corrections + P5 avancement arbitré) ──────────────
  // Reçoit l'état corrigé de la modale : `lignes` (liste éditée) + `indirectes`.
  async function validerRapport({ rapport, lignes, indirectes }) {
    if (!rapport || rapport.statut === "valide") return;

    // Garde-fou anti-régression P5 : repérer toute ligne avec tache_id dont
    // l'avancement arbitré est INFÉRIEUR à l'avancement actuel du plan.
    const avancementsChantier = avancementParTache[rapport.chantier_id] || {};
    const regressions = [];
    lignes.forEach(li => {
      if (!li.tache_id) return;
      const arb = li.avancement_arbitre;
      if (arb == null || arb === "") return;
      const av = parseInt(arb) || 0;
      const ancien = avancementsChantier[String(li.tache_id)];
      if (ancien != null && av < ancien) {
        regressions.push({ planifie: li.planifie, ancien, nouveau: av });
      }
    });
    if (regressions.length > 0) {
      const msg = "Attention, baisse d'avancement détectée :\n\n"
                + regressions.map(r => `• « ${r.planifie} » : ${r.ancien}% → ${r.nouveau}%`).join("\n")
                + "\n\nConfirmer la validation ?";
      if (!window.confirm(msg)) return;
    }

    setValidating(true);
    const taux = parseFloat(tauxHoraires?.[rapport.ouvrier]) || 0;
    const phasage_id = phasageIdParChantier[rapport.chantier_id] || null;
    // pointages.date est de type Postgres date → on convertit le format FR si besoin
    const dateISO = frToISO(rapport.date_rapport);

    // 1) Pointages à insérer : tâches (heures > 0) + heures indirectes
    const lignesTaches = lignes
      .filter(li => (parseFloat(li.heures) || 0) > 0)
      .map(li => ({
        chantier_id: rapport.chantier_id,
        phasage_id,
        phase_id: li.phase_id || null,
        tache_id: li.tache_id || null,
        ouvrier: rapport.ouvrier,
        date: dateISO,
        heures: parseFloat(li.heures) || 0,
        taux_horaire: taux,
        rapport_id: rapport.id,
        // L'ouvrier DÉCLARE l'avancement, le conducteur l'ARBITRE. On stocke
        // toujours le DÉCLARÉ ici, à des fins de traçabilité. La valeur
        // arbitrée vit dans plan_travaux (mise à jour ci-dessous).
        avancement_declare: li.avancement_declare != null ? parseInt(li.avancement_declare) : null,
        valide_par: valideur,
        type_pointage: "tache",
      }));

    const lignesIndirectes = (indirectes || [])
      .filter(li => (parseFloat(li.heures) || 0) > 0 && (li.motif || "").trim())
      .map(li => ({
        chantier_id: rapport.chantier_id,
        phasage_id,
        phase_id: null,
        tache_id: null,
        ouvrier: rapport.ouvrier,
        date: dateISO,
        heures: parseFloat(li.heures),
        taux_horaire: taux,
        rapport_id: rapport.id,
        avancement_declare: null,
        valide_par: valideur,
        type_pointage: "indirect",
        motif_indirect: li.motif.trim(),
      }));

    // Trajet matin + soir → pointage indirect dédié (motif="Trajet"), pour qu'il
    // apparaisse dans le coût MO du chantier et soit affiché à part dans la
    // carte "Trajets" du PlanTravaux.
    //
    // ⚠️ LISSAGE : RapportMobile pose le MÊME temps de trajet sur chaque rapport
    // quand l'ouvrier fait plusieurs chantiers le même jour. Pour ne pas
    // compter le trajet ×N, on divise par le nombre de rapports de cet ouvrier
    // ce jour-là. Chaque chantier reçoit sa quote-part équitable.
    const rapportsMemeJour = rapports.filter(r =>
      r.ouvrier === rapport.ouvrier && r.date_rapport === rapport.date_rapport
    );
    const nbChantiersDuJour = Math.max(1, rapportsMemeJour.length);
    const trajetMinTotal = (parseInt(rapport.trajet_matin_min) || 0) + (parseInt(rapport.trajet_soir_min) || 0);
    const trajetH = (trajetMinTotal / 60) / nbChantiersDuJour;
    const lignesTrajet = trajetH > 0 ? [{
      chantier_id: rapport.chantier_id,
      phasage_id,
      phase_id: null,
      tache_id: null,
      ouvrier: rapport.ouvrier,
      date: dateISO,
      heures: trajetH,
      taux_horaire: taux,
      rapport_id: rapport.id,
      avancement_declare: null,
      valide_par: valideur,
      type_pointage: "indirect",
      motif_indirect: nbChantiersDuJour > 1 ? `Trajet (1/${nbChantiersDuJour})` : "Trajet",
    }] : [];

    const lignesPointages = [...lignesTaches, ...lignesIndirectes, ...lignesTrajet];

    if (lignesPointages.length > 0) {
      const { error: insErr } = await supabase.from("pointages").insert(lignesPointages);
      if (insErr && insErr.code !== "23505") {
        console.error("Insert pointages:", insErr);
        alert("Erreur lors de la création des pointages — la validation est annulée.");
        setValidating(false);
        return;
      }
    }

    // 2) Avancement arbitré → update plan_travaux. On regroupe par tache_id
    //    (si plusieurs lignes pointent la même tâche, on prend la valeur la
    //    plus haute parmi les arbitrés saisis — cohérent avec le garde-fou
    //    anti-régression : on ne baisse jamais sans confirmation explicite).
    const arbitresParTache = {};
    lignes.forEach(li => {
      if (!li.tache_id || !li.phase_id) return;
      const arb = li.avancement_arbitre;
      if (arb == null || arb === "") return;
      const av = parseInt(arb) || 0;
      const key = `${li.phase_id}::${li.tache_id}`;
      if (arbitresParTache[key] == null || av > arbitresParTache[key]) {
        arbitresParTache[key] = av;
      }
    });
    if (Object.keys(arbitresParTache).length > 0) {
      const ph = phasages.find(p => p.chantier_id === rapport.chantier_id);
      if (ph) {
        const plan = { ...(ph.plan_travaux || {}) };
        let touched = false;
        Object.entries(arbitresParTache).forEach(([key, av]) => {
          const [phaseId, tacheId] = key.split("::");
          const arr = Array.isArray(plan[phaseId]) ? [...plan[phaseId]] : [];
          const i = arr.findIndex(t => String(t.id) === String(tacheId));
          if (i >= 0) {
            arr[i] = { ...arr[i], avancement: av };
            plan[phaseId] = arr;
            touched = true;
          }
        });
        if (touched) {
          const { error: upPlanErr } = await supabase.from("phasages").update({ plan_travaux: plan }).eq("id", ph.id);
          if (upPlanErr) console.error("Update plan_travaux avancement:", upPlanErr);
          else setPhasages(prev => prev.map(p => p.id === ph.id ? { ...p, plan_travaux: plan } : p));
        }
      }
    }

    // 2-bis) DOUBLE ÉCRITURE V2 : on reporte l'avancement arbitré sur les tâches
    //   d'ouvrage (phasages.ouvrages[].taches[]). Match par tache_id en priorité
    //   (l'auto-match a rattaché une vraie tâche du plan, même si le nom écrit
    //   par l'ouvrier diffère), puis fallback par nom si aucun tache_id.
    //   Additif : ne touche pas plan_travaux ci-dessus.
    const arbitresParId = {};
    const arbitresParNom = {};
    lignes.forEach(li => {
      const arb = li.avancement_arbitre;
      if (arb == null || arb === "") return;
      const av = parseInt(arb) || 0;
      if (li.tache_id) {
        const k = String(li.tache_id);
        if (arbitresParId[k] == null || av > arbitresParId[k]) arbitresParId[k] = av;
      } else {
        const nom = (li.planifie || "").trim().toLowerCase();
        if (!nom) return;
        if (arbitresParNom[nom] == null || av > arbitresParNom[nom]) arbitresParNom[nom] = av;
      }
    });
    if (Object.keys(arbitresParId).length > 0 || Object.keys(arbitresParNom).length > 0) {
      const phV2 = phasages.find(p => p.chantier_id === rapport.chantier_id);
      if (phV2 && Array.isArray(phV2.ouvrages)) {
        let touchedO = false;
        const ouvragesNext = phV2.ouvrages.map(o => ({
          ...o,
          taches: (o.taches || []).map(t => {
            const tid = String(t.id || "");
            if (tid && arbitresParId[tid] != null) {
              touchedO = true;
              return { ...t, avancement: arbitresParId[tid] };
            }
            const nom = (t.nom || "").trim().toLowerCase();
            if (nom && arbitresParNom[nom] != null) {
              touchedO = true;
              return { ...t, avancement: arbitresParNom[nom] };
            }
            return t;
          }),
        }));
        if (touchedO) {
          const { error: upOErr } = await supabase.from("phasages").update({ ouvrages: ouvragesNext }).eq("id", phV2.id);
          if (upOErr) console.error("Update ouvrages avancement (double écriture):", upOErr);
          else setPhasages(prev => prev.map(p => p.id === phV2.id ? { ...p, ouvrages: ouvragesNext } : p));
        }
      }
    }

    // 3) Marque le rapport comme validé. Repli si colonnes absentes.
    let { error: upErr } = await supabase.from("rapports")
      .update({ statut: "valide", valide_par: valideur, valide_le: new Date().toISOString() })
      .eq("id", rapport.id);
    if (upErr && /statut|valide_par|valide_le/.test(upErr.message || "")) {
      console.warn("Colonne statut/valide_* absente, repli sans marquage de statut.");
      upErr = null;
    }
    if (upErr) console.error("Update rapport statut:", upErr);

    setValidating(false);
    setOpenedId(null);
    await load();
  }

  // ── Correction d'un rapport déjà validé (dé-validation) ───────────────────
  // Permet de rouvrir un rapport validé pour corriger une erreur de saisie.
  // On supprime les pointages issus de ce rapport (ils seront recréés à la
  // re-validation) et on repasse le rapport en "en_attente". La modale reste
  // ouverte et redevient éditable. Note : on revient au déclaratif d'origine
  // de l'ouvrier (les corrections précédentes vivaient dans les pointages) ;
  // le conducteur ressaisit la correction puis revalide.
  async function devaliderRapport(rapport) {
    if (!rapport || rapport.statut !== "valide") return;
    if (journeeCloturee) {
      alert("La journée est clôturée — rouvre-la d'abord (bouton « Rouvrir la journée ») pour corriger un rapport.");
      return;
    }
    if (!window.confirm(
      "Rouvrir ce rapport pour correction ?\n\n"
      + "Les pointages enregistrés pour ce rapport seront supprimés et recréés "
      + "lors de la prochaine validation. Le rapport repart de la déclaration "
      + "d'origine de l'ouvrier."
    )) return;
    setValidating(true);
    // 1) Supprime les pointages issus de ce rapport.
    const { error: delErr } = await supabase.from("pointages").delete().eq("rapport_id", rapport.id);
    if (delErr) {
      console.error("Delete pointages (dévalidation):", delErr);
      alert("Erreur lors de la suppression des pointages — correction annulée.");
      setValidating(false);
      return;
    }
    // 2) Repasse le rapport en attente (repli si colonnes de statut absentes).
    let { error: upErr } = await supabase.from("rapports")
      .update({ statut: "en_attente", valide_par: null, valide_le: null })
      .eq("id", rapport.id);
    if (upErr && /statut|valide_par|valide_le/.test(upErr.message || "")) upErr = null;
    if (upErr) console.error("Update rapport statut (dévalidation):", upErr);
    // 3) Met à jour l'état local : la modale (opened dérivé de rapports)
    //    redevient éditable sans se fermer.
    setRapports(prev => prev.map(r => r.id === rapport.id
      ? { ...r, statut: "en_attente", valide_par: null, valide_le: null }
      : r));
    setValidating(false);
  }

  return (
    <div className="page-padding" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, color: T.text, fontWeight: 700 }}>
          Validation de fin de journée
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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
          {/* P6 : Clôture / Réouverture (caché si la table n'existe pas encore) */}
          {!clotureTableManquante && (
            journeeCloturee ? (
              <button onClick={() => setShowReopenModal(true)} disabled={clotureBusy} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: RADIUS.md,
                border: "1px solid rgba(245,166,35,0.4)",
                background: "rgba(245,166,35,0.10)", color: "#b27416",
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>
                <Icon as={LockOpen} size={14}/> Rouvrir
              </button>
            ) : (
              <button onClick={cloturerJournee} disabled={clotureBusy} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: RADIUS.md,
                border: `1px solid ${acc.border}`,
                background: acc.bg10, color: acc.accent,
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}>
                <Icon as={Lock} size={14}/> Clôturer la journée
              </button>
            )
          )}
        </div>
      </div>

      {/* P6 : Bandeau d'information si journée clôturée */}
      {journeeCloturee && (
        <div style={{
          padding: "10px 14px", borderRadius: RADIUS.md, marginBottom: 12,
          background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.30)",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <Icon as={Lock} size={16} color="#b27416"/>
          <div style={{ flex: 1, minWidth: 0, color: "#b27416", fontSize: 13 }}>
            <strong>Journée clôturée</strong>{cloture?.cloture_par ? ` par ${cloture.cloture_par}` : ""}
            {cloture?.cloture_le ? ` le ${new Date(cloture.cloture_le).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}
            {" · "}validation des rapports verrouillée.
          </div>
          {(cloture?.historique || []).length > 0 && (
            <button onClick={() => setShowHistorique(true)} style={{
              padding: "4px 10px", borderRadius: RADIUS.md,
              border: "1px solid rgba(178,116,22,0.4)", background: "transparent", color: "#b27416",
              fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}>Historique ({cloture.historique.length})</button>
          )}
        </div>
      )}

      {clotureTableManquante && (
        <div style={{ marginBottom: 12 }}>
          <AlerteBox text="La table `clotures_journee` n'a pas encore été créée — exécute le SQL du P6 pour activer la clôture de journée." T={T}/>
        </div>
      )}

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
                      onClick={() => setOpenedId(r.id)}
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
          avancementParTache={avancementParTache[opened.chantier_id] || {}}
          autresPropositions={autresPropositionsPourRapport(opened)}
          tachesPlan={tachesPlanParChantier[opened.chantier_id] || []}
          phases={phases}
          ouvriersDispo={ouvriers}
          journeeCloturee={!!journeeCloturee}
          nbChantiersDuJour={rapports.filter(r => r.ouvrier === opened.ouvrier && r.date_rapport === opened.date_rapport).length || 1}
          onCreerTache={(args) => creerTacheDansPlan({ ...args, chantier_id: opened.chantier_id })}
          onClose={() => setOpenedId(null)}
          onValider={({ lignes, indirectes }) => validerRapport({ rapport: opened, lignes, indirectes })}
          onDevalider={() => devaliderRapport(opened)}
          validating={validating}
        />
      )}

      {/* P6 : Modale de réouverture */}
      {showReopenModal && (
        <div onClick={() => setShowReopenModal(false)} style={{
          position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.surface, color: T.text,
            borderRadius: RADIUS.lg || 12, width: "100%", maxWidth: 480,
            border: `1px solid ${T.border}`,
          }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 8 }}>
              <Icon as={LockOpen} size={16} color="#b27416"/>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Rouvrir la journée du {dateLabel(dateFilter)}</span>
            </div>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5 }}>
                La réouverture sera tracée dans l'historique. Précise un motif (sera visible aux autres conducteurs).
              </div>
              <input
                type="text" autoFocus placeholder="Ex: ouvrier en retard, rapport oublié, correction d'erreur…"
                value={reopenMotif}
                onChange={e => setReopenMotif(e.target.value)}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: RADIUS.md,
                  border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
                  fontSize: 14, fontFamily: "inherit", outline: "none",
                }}
              />
            </div>
            <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setShowReopenModal(false); setReopenMotif(""); }} style={{
                padding: "8px 16px", borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: "transparent", color: T.text,
                cursor: "pointer", fontFamily: "inherit", fontSize: 13,
              }}>Annuler</button>
              <button onClick={rouvrirJournee} disabled={clotureBusy || !reopenMotif.trim()} style={{
                padding: "8px 16px", borderRadius: RADIUS.md,
                border: "none", background: "#b27416", color: "#fff",
                cursor: clotureBusy ? "wait" : "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                opacity: (clotureBusy || !reopenMotif.trim()) ? 0.6 : 1,
              }}>{clotureBusy ? "Réouverture…" : "Rouvrir la journée"}</button>
            </div>
          </div>
        </div>
      )}

      {/* P6 : Modale historique des clôtures/réouvertures */}
      {showHistorique && cloture && (
        <div onClick={() => setShowHistorique(false)} style={{
          position: "fixed", inset: 0, zIndex: 250, background: "rgba(0,0,0,0.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: T.surface, color: T.text,
            borderRadius: RADIUS.lg || 12, width: "100%", maxWidth: 560, maxHeight: "80vh", overflowY: "auto",
            border: `1px solid ${T.border}`,
          }}>
            <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Historique — {dateLabel(dateFilter)}</span>
              <button onClick={() => setShowHistorique(false)} style={{
                background: "transparent", border: "none", cursor: "pointer", padding: 4,
                color: T.textSub, display: "flex", alignItems: "center",
              }}><Icon as={X} size={18}/></button>
            </div>
            <div style={{ padding: 16 }}>
              {(cloture.historique || []).length === 0 ? (
                <div style={{ color: T.textSub, fontSize: 13 }}>Aucun événement.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...cloture.historique].reverse().map((h, i) => (
                    <div key={i} style={{
                      padding: "10px 12px", borderRadius: RADIUS.md,
                      background: T.widgetBg || T.bg, border: `1px solid ${T.border}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Icon as={h.action === "cloture" ? Lock : LockOpen} size={13} color={h.action === "cloture" ? acc.accent : "#b27416"}/>
                        <strong style={{ fontSize: 13, color: T.text }}>
                          {h.action === "cloture" ? "Clôture" : "Réouverture"}
                        </strong>
                        <span style={{ fontSize: 12, color: T.textSub }}>
                          {h.par || "?"} · {h.le ? new Date(h.le).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "?"}
                        </span>
                      </div>
                      {h.motif && (
                        <div style={{ fontSize: 12, color: T.text, marginLeft: 21, fontStyle: "italic" }}>
                          « {h.motif} »
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modale détail rapport (éditable — P4 + P5) ──────────────────────────────

function ModaleRapport({
  rapport, T, acc, taux, alertes, avancementParTache, autresPropositions,
  tachesPlan, phases, ouvriersDispo, journeeCloturee = false,
  nbChantiersDuJour = 1,
  onCreerTache, onClose, onValider, onDevalider, validating,
}) {
  // État local éditable : copie indépendante de rapport.taches[] pour ne pas
  // toucher au déclaratif d'origine de l'ouvrier (trace préservée).
  const [lignes, setLignes] = useState([]);
  const [indirectes, setIndirectes] = useState([]);
  const [creerTacheState, setCreerTacheState] = useState(null); // { ligneRowId, nom?, phase_id? }

  // P6 : verrouille toute action si la journée est clôturée (sauf consultation).
  const valide = rapport.statut === "valide";
  const verrouille = valide || journeeCloturee;

  useEffect(() => {
    const init = (rapport.taches || []).map((t, i) => ({
      rowId: `o${i}`,
      origineIdx: i,
      _origine: true,
      tache_id: t.tache_id || null,
      phase_id: t.phase_id || null,
      planifie: t.planifie || "",
      heures: parseFloat(t.heures_reelles) || 0,
      statut: t.statut || null,
      avancement_declare: t.avancement != null ? parseInt(t.avancement) : null,
      avancement_arbitre: t.avancement != null ? parseInt(t.avancement) : "",  // pré-rempli avec déclaré
      remarque: t.remarque || "",
      photos: t.photos || [],
      _autoMatched: false,
    }));
    setLignes(init);
    // Pré-remplit la zone heures indirectes avec ce que l'ouvrier a déclaré
    // (P7). Le conducteur peut compléter/corriger/supprimer avant validation.
    const initIndirectes = Array.isArray(rapport.heures_indirectes)
      ? rapport.heures_indirectes.map(h => ({
          motif: h.motif || "",
          heures: h.heures != null ? h.heures : "",
        }))
      : [];
    setIndirectes(initIndirectes);
  }, [rapport.id]);

  // Auto-match : pour les lignes sans tache_id, on cherche la meilleure
  // correspondance dans le plan du chantier (fuzzy match). Pré-sélectionne la
  // dropdown — le conducteur a juste à corriger si c'est faux. On marque la
  // ligne comme _autoMatched pour afficher un badge visuel.
  useEffect(() => {
    if (!Array.isArray(tachesPlan) || tachesPlan.length === 0) return;
    setLignes(prev => prev.map(li => {
      if (li.tache_id) return li;            // déjà rattachée (via planning ou réaffectation manuelle)
      if (!li.planifie?.trim()) return li;   // ligne vide
      const best = meilleureTachePlan(li.planifie, tachesPlan);
      if (!best || best.score < SEUIL_AUTOMATCH) return li;
      return {
        ...li,
        tache_id: best.tache.id,
        phase_id: best.tache.phase_id || null,
        ouvrage_id: best.tache.ouvrage_id || null,
        _autoMatched: true,
        _autoMatchScore: best.score,
      };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tachesPlan, rapport.id]);

  const totalHTaches = lignes.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0);
  const totalHIndirect = indirectes.reduce((s, t) => s + (parseFloat(t.heures) || 0), 0);
  const trajetMin = (parseInt(rapport.trajet_matin_min) || 0) + (parseInt(rapport.trajet_soir_min) || 0);
  // ⚠️ Lissage : le trajet est divisé par le nombre de rapports du jour pour
  // cet ouvrier (sinon il serait compté ×N quand l'ouvrier fait N chantiers).
  const totalHTrajet = (trajetMin / 60) / nbChantiersDuJour;
  const totalCout = (totalHTaches + totalHIndirect + totalHTrajet) * taux;

  const updateLigne = (rowId, patch) => setLignes(prev => prev.map(l => l.rowId === rowId ? { ...l, ...patch } : l));
  const splitLigne = (rowId) => setLignes(prev => {
    const i = prev.findIndex(l => l.rowId === rowId);
    if (i < 0) return prev;
    const src = prev[i];
    const moitie = (parseFloat(src.heures) || 0) / 2;
    const nouvelle = { ...src, rowId: `s${genId()}`, _origine: false, heures: moitie };
    const modif = { ...src, heures: moitie };
    return [...prev.slice(0, i), modif, nouvelle, ...prev.slice(i + 1)];
  });
  const removeLigne = (rowId) => setLignes(prev => prev.filter(l => l.rowId !== rowId));

  // Réaffectation : on capture la sélection (tache_id du plan, "__libre__", ou "__creer__")
  // V2 si les options du menu portent un ouvrage_id (chantier avec ouvrages).
  const chantierV2 = (tachesPlan || []).some(t => t.ouvrage_id);
  const onChangeTache = (rowId, value) => {
    if (value === "__creer__") {
      // Pré-remplit le nom avec ce que l'ouvrier avait déclaré (modifiable).
      const ligne = lignes.find(l => l.rowId === rowId);
      setCreerTacheState({ rowId, nom: ligne?.planifie || "", phase_id: chantierV2 ? null : (phases[0]?.id || ""), useOuvrages: chantierV2 });
      return;
    }
    if (value === "__libre__" || !value) {
      updateLigne(rowId, { tache_id: null, phase_id: null, ouvrage_id: null, _autoMatched: false });
      return;
    }
    const t = tachesPlan.find(x => String(x.id) === String(value));
    if (t) updateLigne(rowId, { tache_id: t.id, phase_id: t.phase_id || null, ouvrage_id: t.ouvrage_id || null, planifie: t.nom, _autoMatched: false });
  };

  const validerCreation = async () => {
    if (!creerTacheState?.nom?.trim()) { alert("Renseigne le nom de la tâche."); return; }
    if (!creerTacheState.useOuvrages && !creerTacheState.phase_id) {
      alert("Renseigne au moins le nom et la phase.");
      return;
    }
    const res = await onCreerTache({
      phase_id: creerTacheState.phase_id || null,
      nom: creerTacheState.nom,
      heures_vendues: creerTacheState.heures_vendues,
      ouvriers: rapport.ouvrier ? [rapport.ouvrier] : [],
    });
    if (res?.tache_id) {
      updateLigne(creerTacheState.rowId, {
        tache_id: res.tache_id,
        phase_id: res.phase_id || null,
        ouvrage_id: res.ouvrage_id || null,
        planifie: creerTacheState.nom.trim(),
      });
      setCreerTacheState(null);
    }
  };

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
        width: "100%", maxWidth: 920, maxHeight: "92vh",
        overflowY: "auto",
        border: `1px solid ${T.border}`,
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          position: "sticky", top: 0, background: T.surface, zIndex: 2,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {rapport.ouvrier} — {rapport.chantier_nom || rapport.chantier_id}
            </div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
              {dateLabel(rapport.date_rapport)} · {fmtH(totalHTaches)}h tâches · taux {taux}€/h
              {trajetMin > 0 && (
                <span> · 🚗 Trajet {fmtH(totalHTrajet)}h
                  {nbChantiersDuJour > 1
                    ? <span style={{ fontStyle: "italic" }}> (quote-part {fmtH(trajetMin / 60)}h ÷ {nbChantiersDuJour} chantiers)</span>
                    : <span> ({parseInt(rapport.trajet_matin_min) || 0}min matin / {parseInt(rapport.trajet_soir_min) || 0}min soir)</span>
                  }
                </span>
              )}
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

        {/* Tâches éditables */}
        <div style={{ padding: "16px 20px" }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: T.textSub }}>
            Tâches du rapport — correction & avancement
          </h3>
          {lignes.length === 0 ? (
            <div style={{ color: T.textSub, fontSize: 13 }}>Aucune tâche.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lignes.map(li => (
                <LigneEditable
                  key={li.rowId}
                  ligne={li}
                  T={T} acc={acc}
                  valide={verrouille}
                  tachesPlan={tachesPlan}
                  phases={phases}
                  avancementActuel={li.tache_id ? avancementParTache[String(li.tache_id)] : null}
                  autres={li.tache_id ? (autresPropositions[String(li.tache_id)] || []) : []}
                  onChange={(patch) => updateLigne(li.rowId, patch)}
                  onChangeTache={(value) => onChangeTache(li.rowId, value)}
                  onSplit={() => splitLigne(li.rowId)}
                  onRemove={() => removeLigne(li.rowId)}
                />
              ))}
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
            {!verrouille && (
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
                    type="text" placeholder="Motif (ex: intempéries)"
                    value={li.motif}
                    onChange={e => updateIndirect(i, { motif: e.target.value })}
                    disabled={verrouille}
                    style={inputStyle(T)}
                  />
                  <input
                    type="number" placeholder="Heures"
                    value={li.heures}
                    onChange={e => updateIndirect(i, { heures: e.target.value })}
                    disabled={verrouille}
                    step="0.25" min="0"
                    style={{ ...inputStyle(T), textAlign: "right" }}
                  />
                  <button onClick={() => removeIndirect(i)} disabled={verrouille} style={{
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

        {/* Photos générales du chantier */}
        {Array.isArray(rapport.photos_chantier) && rapport.photos_chantier.length > 0 && (
          <div style={{ padding: "0 20px 16px" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: T.textSub }}>
              Photos générales ({rapport.photos_chantier.length})
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {rapport.photos_chantier.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{
                  width: 72, height: 72, borderRadius: 8, overflow: "hidden",
                  border: `1px solid ${T.border}`, background: T.bg, flexShrink: 0,
                }}>
                  <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          position: "sticky", bottom: 0, background: T.surface,
        }}>
          <div style={{ fontSize: 13, color: T.textSub }}>
            Total : <strong style={{ color: T.text }}>{fmtH(totalHTaches + totalHIndirect + totalHTrajet)}h</strong>
            {totalHTrajet > 0 && <span style={{ color: T.textSub }}> (dont {fmtH(totalHTrajet)}h trajet)</span>}
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
            {valide ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: T.textSub, fontStyle: "italic" }}>
                  Validé{rapport.valide_par ? ` par ${rapport.valide_par}` : ""}
                </span>
                <button
                  onClick={onDevalider}
                  disabled={validating || journeeCloturee}
                  title={journeeCloturee ? "Journée clôturée — rouvre-la d'abord" : "Rouvrir ce rapport pour corriger une erreur"}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 16px", borderRadius: RADIUS.md,
                    border: `1px solid ${T.border}`, background: "transparent", color: T.text,
                    cursor: (validating || journeeCloturee) ? "not-allowed" : "pointer",
                    fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                    opacity: (validating || journeeCloturee) ? 0.5 : 1,
                  }}
                >
                  <Icon as={LockOpen} size={13}/> {validating ? "…" : "Corriger"}
                </button>
              </div>
            ) : journeeCloturee ? (
              <span style={{ fontSize: 12, color: "#b27416", fontStyle: "italic", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon as={Lock} size={12}/> Journée clôturée — rouvre pour valider
              </span>
            ) : (
              <button
                onClick={() => onValider({ lignes, indirectes })}
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
            )}
          </div>
        </div>
      </div>

      {/* Sous-modale création nouvelle tâche du plan */}
      {creerTacheState && (
        <CreerTacheModale
          state={creerTacheState}
          setState={setCreerTacheState}
          phases={phases}
          T={T} acc={acc}
          onValider={validerCreation}
          onClose={() => setCreerTacheState(null)}
        />
      )}
    </div>
  );
}

// ─── Ligne éditable (P4 correction + P5 avancement arbitré) ──────────────────

function LigneEditable({
  ligne, T, acc, valide, tachesPlan, phases,
  avancementActuel, autres, onChange, onChangeTache, onSplit, onRemove,
}) {
  const phasesById = useMemo(() => Object.fromEntries((phases || []).map(p => [p.id, p])), [phases]);
  // Groupe les tâches par `groupe` : libellé d'ouvrage (V2) ou id de phase (V1).
  const tachesParGroupe = useMemo(() => {
    const m = {};
    (tachesPlan || []).forEach(t => {
      const g = t.groupe || t.phase_id || "Autres";
      if (!m[g]) m[g] = [];
      m[g].push(t);
    });
    return m;
  }, [tachesPlan]);

  const libre = !ligne.tache_id;
  const baisse = (() => {
    if (avancementActuel == null) return false;
    const arb = parseInt(ligne.avancement_arbitre);
    if (Number.isNaN(arb)) return false;
    return arb < avancementActuel;
  })();

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 80px 110px 60px",
      gap: 8, alignItems: "start",
      padding: "10px 12px", borderRadius: RADIUS.md,
      background: T.widgetBg || T.bg, border: `1px solid ${T.border}`,
    }}>
      {/* Colonne gauche : tâche + sélecteur */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ligne.planifie || "(sans titre)"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <select
            value={ligne.tache_id || (libre ? "__libre__" : "")}
            onChange={e => onChangeTache(e.target.value)}
            disabled={valide}
            style={{
              flex: 1, minWidth: 0,
              padding: "4px 6px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
              fontSize: 12, fontFamily: "inherit",
            }}
          >
            <option value="__libre__">— Tâche libre / non rattachée —</option>
            {Object.keys(tachesParGroupe).map(groupe => {
              const ph = phasesById[groupe];
              const label = ph ? `${ph.emoji || ""} ${ph.label}` : groupe;
              return (
                <optgroup key={groupe} label={label}>
                  {tachesParGroupe[groupe].map(t => (
                    <option key={t.id} value={t.id}>
                      {t.nom}{ligne.tache_id === t.id ? " ✓" : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            <option value="__creer__">+ Créer nouvelle tâche…</option>
          </select>
          <StatutTacheLabel statut={ligne.statut}/>
        </div>
        {/* Sous-info : badge libre, badge auto-match, autres propositions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {libre && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(245,166,35,0.15)", color: "#b27416", textTransform: "uppercase", letterSpacing: .3,
            }}>
              Tâche libre
            </span>
          )}
          {ligne._autoMatched && (
            <span title={`Auto-détecté (similarité ${Math.round((ligne._autoMatchScore || 0) * 100)}%) — vérifie et corrige si besoin`} style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(80,200,120,0.15)", color: "#22a060", textTransform: "uppercase", letterSpacing: .3,
              cursor: "help",
            }}>
              ✨ Auto-détecté
            </span>
          )}
          {autres.length > 0 && (
            <span style={{ fontSize: 11, color: T.textSub }}>
              Aussi pointée par : {autres.map((a, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  <strong>{a.ouvrier}</strong> {a.avancement}%
                </span>
              ))}
            </span>
          )}
          {ligne.remarque && (
            <span style={{ fontSize: 11, color: T.text, fontStyle: "italic" }}>
              💬 {ligne.remarque}
            </span>
          )}
        </div>
        {/* Photos déclarées par l'ouvrier pour cette tâche (clic = ouvre en plein) */}
        {Array.isArray(ligne.photos) && ligne.photos.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
            {ligne.photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{
                width: 48, height: 48, borderRadius: 6, overflow: "hidden",
                border: `1px solid ${T.border}`, background: T.bg, flexShrink: 0,
              }}>
                <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Heures */}
      <div>
        <label style={miniLabel(T)}>Heures</label>
        <input
          type="number" step="0.25" min="0"
          value={ligne.heures ?? ""}
          onChange={e => onChange({ heures: e.target.value === "" ? "" : parseFloat(e.target.value) })}
          disabled={valide}
          style={{ ...inputStyle(T), textAlign: "right" }}
        />
      </div>

      {/* Avancement déclaré + arbitré */}
      <div>
        <label style={miniLabel(T)}>
          Av. arbitré
          {ligne.avancement_declare != null && (
            <span style={{ marginLeft: 4, fontWeight: 400, color: T.textSub }}>
              (déclaré {ligne.avancement_declare}%)
            </span>
          )}
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number" min="0" max="100" step="1"
            value={ligne.avancement_arbitre ?? ""}
            onChange={e => onChange({ avancement_arbitre: e.target.value === "" ? "" : parseInt(e.target.value) })}
            disabled={valide || !ligne.tache_id}
            style={{
              ...inputStyle(T), textAlign: "right",
              borderColor: baisse ? "#e05c5c" : T.border,
            }}
          />
          <span style={{ fontSize: 11, color: T.textSub }}>%</span>
        </div>
        {avancementActuel != null && (
          <div style={{ fontSize: 10, color: baisse ? "#e05c5c" : T.textSub, marginTop: 2 }}>
            Plan : {avancementActuel}%{baisse ? " · baisse !" : ""}
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        <button onClick={onSplit} disabled={valide} title="Splitter en 2 lignes" style={iconBtnStyle(T)}>
          <Icon as={Split} size={14}/>
        </button>
        <button onClick={onRemove} disabled={valide} title="Supprimer la ligne" style={{ ...iconBtnStyle(T), color: "#e05c5c" }}>
          <Icon as={Trash2} size={14}/>
        </button>
      </div>
    </div>
  );
}

// ─── Sous-modale création nouvelle tâche du plan ─────────────────────────────

function CreerTacheModale({ state, setState, phases, T, acc, onValider, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 300,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, color: T.text,
        borderRadius: RADIUS.lg || 12,
        width: "100%", maxWidth: 480,
        border: `1px solid ${T.border}`,
      }}>
        <div style={{
          padding: "14px 20px", borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon as={PlusCircle} size={18} color={acc.accent}/>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Créer une tâche du plan</span>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer", padding: 4,
            color: T.textSub, display: "flex", alignItems: "center",
          }}>
            <Icon as={X} size={18}/>
          </button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={miniLabel(T)}>Nom de la tâche</label>
            <input
              type="text" autoFocus
              value={state.nom || ""}
              onChange={e => setState({ ...state, nom: e.target.value })}
              placeholder="Ex: Pose carrelage salle de bain"
              style={inputStyle(T)}
            />
          </div>
          {state.useOuvrages ? (
            <div style={{ fontSize: 12, color: T.textSub }}>
              La tâche sera ajoutée à l'ouvrage <strong>« Divers / hors devis »</strong> du chantier.
            </div>
          ) : (
            <div>
              <label style={miniLabel(T)}>Phase</label>
              <select
                value={state.phase_id || ""}
                onChange={e => setState({ ...state, phase_id: e.target.value })}
                style={inputStyle(T)}
              >
                {phases.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji ? `${p.emoji} ` : ""}{p.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label style={miniLabel(T)}>Heures vendues (optionnel)</label>
            <input
              type="number" step="0.5" min="0"
              value={state.heures_vendues || ""}
              onChange={e => setState({ ...state, heures_vendues: e.target.value })}
              placeholder="0"
              style={{ ...inputStyle(T), textAlign: "right" }}
            />
          </div>
        </div>
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${T.border}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: RADIUS.md,
            border: `1px solid ${T.border}`, background: "transparent", color: T.text,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13,
          }}>
            Annuler
          </button>
          <button onClick={onValider} style={{
            padding: "8px 16px", borderRadius: RADIUS.md,
            border: "none", background: acc.accent, color: "#fff",
            cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
          }}>
            Créer et rattacher
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles inline réutilisables ─────────────────────────────────────────────

const inputStyle = (T) => ({
  width: "100%", padding: "6px 8px", borderRadius: RADIUS.md,
  border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
  fontSize: 13, fontFamily: "inherit",
});

const miniLabel = (T) => ({
  display: "block", fontSize: 10, color: T.textSub,
  textTransform: "uppercase", letterSpacing: .3, marginBottom: 2, fontWeight: 600,
});

const iconBtnStyle = (T) => ({
  background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
  width: 26, height: 26, cursor: "pointer", color: T.textSub,
  display: "flex", alignItems: "center", justifyContent: "center",
});

export default PageValidation;
