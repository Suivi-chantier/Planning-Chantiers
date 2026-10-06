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
//          + correction du CHANTIER du rapport (erreur de saisie de l'ouvrier) :
//          sélecteur dans l'en-tête de la modale, tant que le rapport n'est pas
//          validé (sinon passer par « Corriger » d'abord).
//          + BASCULE d'une ligne (ou d'une partie de ses heures) vers un AUTRE
//          chantier : l'ouvrier a tout déclaré sur un chantier alors qu'il a
//          passé une partie de la journée ailleurs. Les heures rejoignent le
//          rapport du même ouvrier / même jour sur le chantier cible (créé au
//          besoin), à valider ensuite comme les autres.
//   - P5 : avancement arbitré. Champ "validé" pré-rempli avec la valeur
//          déclarée par l'ouvrier. Garde-fou anti-régression si baisse vs plan.
//          Affichage des propositions des autres ouvriers ayant pointé la même
//          tâche le même jour. À la validation, écriture du validé dans le
//          plan_travaux, conservation du déclaré dans pointages.avancement_declare.

import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
// Écriture versionnée : Validation réécrit ouvrages / plan_travaux depuis son
// état React, qui peut être périmé. Le verrou optimiste l'empêche d'écraser
// une modification arrivée entre-temps.
import { sauvegarderPhasage, MESSAGE_ERREUR_ECRITURE } from "./phasageEcriture.mjs";
import { Icon, InputNombre } from "../ui";
import {
  CheckCircle2, AlertTriangle, Clock, User as UserIcon, X,
  Plus, Trash2, Split, PlusCircle, Lock, LockOpen, ArrowRightLeft,
} from "lucide-react";
import { getBranchAccent, RADIUS, PHASES_DEFAUT, loadPhases } from "../constants";
import { buildPointagesRapport, rangRapportDuJour, repartTrajetCents, heuresDeclareesRapport } from "../pointages";
import { getISOWeek, profilSemaine } from "../rythmeSemaine";
// Lignes d'un rapport (module pur, testé par scripts/verif-compte-rendu-v2.mjs)
// et motifs du formulaire bêta « cr_v2 » (liste unique partagée avec l'ouvrier).
import {
  lignesDepuisRapport, taskLinesPourPointages, depassementAffichable, decouperLigne, ligneBasculee,
  enregistrerCreationsProposees, propositionACreer, tacheCreeeEnValidation, ajouterTacheDansOuvrage,
  idTacheProposee, trouverTache, creationParDefaut,
} from "./lignesValidation";
import {
  explicationLigne, libelleMotifDepassement, NATURES_TACHE, horsDevisParDefaut, libelleNature,
} from "./motifsCompteRendu";
import { DIVERS_HORS_DEVIS, estOuvrageDivers } from "./compteRenduV2";

// Rapport envoyé par le formulaire bêta (colonne rapports.formulaire_version).
const estRapportBeta = (r) => r?.formulaire_version === "v2";
function BadgeBeta() {
  return (
    <span title="Rapport envoyé avec le nouveau formulaire de compte rendu (bêta)" style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 999,
      background: "rgba(139,92,246,0.14)", color: "#7c3aed", fontSize: 10.5, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: .3, whiteSpace: "nowrap",
    }}>Formulaire bêta</span>
  );
}

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
  // Accepte l'ISO (input date) comme le FR (rapports.date_rapport stockée "JJ/MM/AAAA").
  const d = new Date(frToISO(dateStr) + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Tronque les libellés injectés dans les <option> : la liste déroulante native
// s'élargit à la taille de l'option la plus longue, et certaines tâches du plan
// portent un descriptif complet de plusieurs centaines de caractères.
function libelleCourt(s, max = 90) {
  const str = String(s || "");
  return str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;
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

// Heures normalement attendues pour une date, d'après la source unique du rythme
// 4j/5j. Les exceptions de date de planning_config sont appliquées au moment
// exact de la validation (requête Supabase dans validerRapport).
function heuresAttenduesPourDate(dateStr) {
  const isoDate = frToISO(dateStr);
  const d = new Date(`${isoDate}T12:00:00`);
  if (isNaN(d.getTime())) return null;
  const { year, week } = getISOWeek(d);
  const jours = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const h = parseFloat(profilSemaine(year, week)?.[jours[d.getDay()]]);
  return Number.isFinite(h) ? h : null;
}

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

function StatutTacheLabel({ statut, bloque = false }) {
  if (bloque) {
    // Formulaire bêta : statut stocké en_cours (heures > 0) ou non_faite (0 h),
    // drapeau « bloque » — on affiche le choix de l'ouvrier.
    return (
      <span title={`Choisi par l'ouvrier : Bloqué (enregistré « ${statut === "en_cours" ? "en cours" : "pas faite"} »)`}
        style={{ fontSize: 11, fontWeight: 700, color: "#c0392b", letterSpacing: .3 }}>
        ⛔ Bloqué ({statut === "en_cours" ? "en cours" : "pas fait"})
      </span>
    );
  }
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

function PageValidation({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation", profil, initialDate = null, onInitialDateConsumed }) {
  const acc = getBranchAccent(branch);
  // initialDate (ISO ou FR) : raccourci depuis « Heures des salariés » pour
  // ouvrir directement le jour d'un CR en attente. Normalisé en ISO.
  const [dateFilter, setDateFilter] = useState(() => frToISO(initialDate) || dateKey());
  const [rapports, setRapports] = useState([]);
  const [cellsJour, setCellsJour] = useState([]);
  const [phasages, setPhasages] = useState([]);
  // Écriture refusée : le phasage a bougé ailleurs. On n'écrase rien et on
  // ne réessaie jamais tout seul — l'utilisateur recharge puis recommence.
  const [conflitPhasage, setConflitPhasage] = useState(false);
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
        .select("id,chantier_id,revision,plan_travaux,ouvrages")
        .in("chantier_id", chIds);
      setPhasages(phs || []);
    } else {
      setPhasages([]);
    }

    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dateFilter]);

  // Si l'app fournit une date cible (navigation depuis « Heures des salariés »),
  // on s'y positionne puis on signale la consommation pour ne pas la ré-appliquer.
  useEffect(() => {
    if (!initialDate) return;
    const iso = frToISO(initialDate);
    if (iso) setDateFilter(iso);
    onInitialDateConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDate]);

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

  // Map: chantier_id → ouvrages du phasage V2 (choix de l'ouvrage d'une
  // nouvelle tâche). « Divers / hors devis » en dernier ; s'il n'existe pas,
  // une entrée sans id le représente (créé avec la tâche).
  const ouvragesPlanParChantier = useMemo(() => {
    const m = {};
    phasages.forEach(ph => {
      const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];
      if (ouvrages.length === 0) return;
      const liste = ouvrages.map(o => ({
        id: o.id, libelle: String(o.libelle || "").trim() || "(sans libellé)",
        code: String(o.code_ouvrage || "").trim() || null, divers: estOuvrageDivers(o.libelle),
      }));
      const divers = liste.filter(o => o.divers);
      m[ph.chantier_id] = [
        ...liste.filter(o => !o.divers),
        ...(divers.length ? divers : [{ id: null, libelle: DIVERS_HORS_DEVIS, code: null, divers: true }]),
      ];
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
  // Fenêtre « + Créer nouvelle tâche » (ligne libre) : création immédiate.
  // V2 : dans l'ouvrage choisi (ouvrage_id), ou « Divers / hors devis » (null,
  // créé si absent), avec nature et « Hors devis ». Pas d'heures vendues.
  // V1 (repli, chantier sans ouvrages) : crée dans plan_travaux[phase_id].
  // Retourne { tache_id, ouvrage_id?, phase_id? }.
  async function creerTacheDansPlan({ chantier_id, phase_id, nom, heures_vendues, ouvriers: ouvriersList,
    ouvrage_id = null, nature = null, hors_devis = null, cree_par = null, rapport_id = null }) {
    const ph = phasages.find(p => p.chantier_id === chantier_id);
    if (!ph) {
      alert(`Aucun phasage existant pour le chantier ${chantier_id}. Crée-le d'abord depuis la page Phasage.`);
      return null;
    }
    const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];

    // ── V2 : tâche dans un ouvrage du chantier
    if (ouvrages.length > 0) {
      const newTache = {
        ...tacheCreeeEnValidation({ id: genId(), nom, nature, hors_devis, ouvrier: cree_par, rapportId: rapport_id }),
        ouvriers: Array.isArray(ouvriersList) ? ouvriersList : [],
      };
      const ajout = ajouterTacheDansOuvrage(ouvrages, ouvrage_id, newTache, genId);
      if (ajout.erreur) {
        alert("L'ouvrage choisi n'existe plus dans le phasage de ce chantier. Recharge la page et choisis-en un autre.");
        return null;
      }
      const next = ajout.ouvrages;
      const res = await sauvegarderPhasage({
        phasageId: ph.id, revision: ph.revision ?? 0, ouvrages: next,
      });
      if (!res.ok) {
        if (res.code === "conflit") { setConflitPhasage(true); return null; }
        console.error("creerTacheDansOuvrage:", res.code);
        alert(MESSAGE_ERREUR_ECRITURE);
        return null;
      }
      setPhasages(prev => prev.map(p => p.id === ph.id ? { ...p, ouvrages: next, revision: res.revision } : p));
      return { tache_id: newTache.id, ouvrage_id: ajout.ouvrage.id, phase_id: null };
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
    const resPlan = await sauvegarderPhasage({
      phasageId: ph.id, revision: ph.revision ?? 0, plan_travaux: plan,
    });
    if (!resPlan.ok) {
      if (resPlan.code === "conflit") { setConflitPhasage(true); return null; }
      console.error("creerTacheDansPlan:", resPlan.code);
      alert(MESSAGE_ERREUR_ECRITURE);
      return null;
    }
    // La révision suit l'écriture : sans elle, l'enregistrement suivant de ce
    // phasage (avancement à la validation) partait d'une révision périmée et
    // tombait en conflit.
    setPhasages(prev => prev.map(p => p.id === ph.id ? { ...p, plan_travaux: plan, revision: resPlan.revision } : p));
    return { tache_id: newTache.id, phase_id };
  }

  // ── Validation (P3 + P4 corrections + P5 avancement arbitré) ──────────────
  // Reçoit l'état corrigé de la modale : `lignes` (liste éditée) + `indirectes`.
  async function validerRapport({ rapport, lignes: lignesSaisies, indirectes }) {
    if (!rapport || rapport.statut === "valide") return;
    let lignes = lignesSaisies;

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

    // ── GARDE-FOU HEURES JOURNÉE ───────────────────────────────────────────
    // Le CR mobile impose déjà la cible du jour. On refait le contrôle ici,
    // après les éventuelles corrections du conducteur, AVANT toute écriture
    // dans pointages. Le contrôle porte sur la journée entière de l'ouvrier :
    // tous ses rapports/chantiers + un seul trajet journalier.
    const rapportsMemeJourGuard = rapports.filter(r =>
      r.ouvrier === rapport.ouvrier && r.date_rapport === rapport.date_rapport
    );
    const heuresEditeesRapportGuard = lignes.reduce((sum, l) => sum + (parseFloat(l.heures) || 0), 0)
      + indirectes.reduce((sum, x) => sum + (parseFloat(x.heures) || 0), 0);
    const heuresHorsTrajetJour = rapportsMemeJourGuard.reduce((sum, r) =>
      sum + (r.id === rapport.id ? heuresEditeesRapportGuard : heuresDeclareesRapport(r)), 0
    );
    const trajetJourH = ((parseInt(rapport.trajet_matin_min) || 0) + (parseInt(rapport.trajet_soir_min) || 0)) / 60;
    const totalJourValide = heuresHorsTrajetJour + trajetJourH;
    const totalJourDeclare = rapportsMemeJourGuard.reduce((sum, r) => sum + heuresDeclareesRapport(r), 0) + trajetJourH;

    let heuresAttendues = heuresAttenduesPourDate(rapport.date_rapport);
    // Même priorité que le formulaire ouvrier : exception de date Admin > rythme 4j/5j.
    try {
      const { data: cfg } = await supabase.from("planning_config")
        .select("value").eq("key", "heures_par_jour").maybeSingle();
      const isoRapport = frToISO(rapport.date_rapport);
      const exc = parseFloat(cfg?.value?.exceptions?.[isoRapport]);
      if (Number.isFinite(exc)) heuresAttendues = exc;
    } catch (e) {
      console.warn("Garde-fou heures — lecture exception planning_config:", e);
    }

    let exceptionHeures = null;
    const ecartHeures = heuresAttendues == null ? 0 : totalJourValide - heuresAttendues;
    if (heuresAttendues != null && Math.abs(ecartHeures) > 0.01) {
      const sens = ecartHeures > 0 ? `+${fmtH(ecartHeures)}h` : `-${fmtH(Math.abs(ecartHeures))}h`;
      const deverrouiller = window.confirm(
        `⚠️ Garde-fou heures — ${rapport.ouvrier}\n\n`
        + `Déclaré par l'ouvrier : ${fmtH(totalJourDeclare)}h\n`
        + `Après validation : ${fmtH(totalJourValide)}h\n`
        + `Attendu : ${fmtH(heuresAttendues)}h\n`
        + `Écart : ${sens}\n\n`
        + `La validation est bloquée.\n\n`
        + `S'agit-il réellement d'une journée exceptionnelle ?`
      );
      if (!deverrouiller) return;

      const motif = window.prompt(
        `Journée exceptionnelle — motif obligatoire\n\n`
        + `Explique pourquoi ${rapport.ouvrier} doit être validé à ${fmtH(totalJourValide)}h au lieu de ${fmtH(heuresAttendues)}h :`
      );
      if (!motif?.trim()) {
        alert("Validation annulée : un motif est obligatoire pour déverrouiller le garde-fou.");
        return;
      }
      exceptionHeures = {
        actif: true,
        motif: motif.trim(),
        heures_attendues: heuresAttendues,
        heures_declarees: Math.round(totalJourDeclare * 100) / 100,
        heures_validees: Math.round(totalJourValide * 100) / 100,
        ecart: Math.round(ecartHeures * 100) / 100,
        par: valideur,
      };
    }

    setValidating(true);

    // Phasage du chantier, tenu à jour au fil des écritures de CETTE
    // validation : chaque enregistrement repart de la dernière révision
    // (sinon le second tombait en conflit avec le premier).
    let phCourant = phasages.find(p => p.chantier_id === rapport.chantier_id) || null;
    const majPhCourant = (patch) => {
      phCourant = { ...phCourant, ...patch };
      const id = phCourant.id;
      setPhasages(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
    };

    // 0) NOUVELLES TÂCHES PROPOSÉES par l'ouvrier : créées AVANT les pointages,
    //    dans l'ouvrage retenu, avec un identifiant dérivé du rapport et de la
    //    ligne (une validation relancée retrouve la tâche, jamais de doublon).
    //    Échec ou conflit : rien n'est écrit, le rapport reste à valider.
    if (lignes.some(propositionACreer)) {
      const res = await enregistrerCreationsProposees({
        phasage: phCourant, lignes, rapport, genId, sauvegarder: sauvegarderPhasage,
      });
      if (!res.ok) {
        if (res.code === "sans_ouvrages") {
          alert("Ce chantier n'a pas de phasage par ouvrages : impossible de créer les nouvelles tâches proposées.\n\n"
            + "Rattache ces lignes à une tâche existante ou laisse-les en tâche libre, puis revalide.");
        } else if (res.code === "erreurs") {
          alert("Le rapport N'A PAS été validé :\n\n"
            + res.erreurs.map(e => `• « ${e.planifie || "(sans nom)"} » : ${e.code === "nom_vide"
              ? "donne un nom à la nouvelle tâche"
              : "l'ouvrage proposé n'existe plus sur ce chantier, choisis-en un autre"}`).join("\n"));
        } else if (res.code === "conflit") {
          setConflitPhasage(true);
          alert("Le phasage de ce chantier a été modifié ailleurs pendant ta validation.\n\n"
            + "Le rapport N'A PAS été validé et aucune tâche n'a été créée. "
            + "Ferme cette fenêtre, clique sur « Recharger la version récente », puis revalide.");
        } else {
          console.error("Création des nouvelles tâches proposées:", res.code);
          alert(`${MESSAGE_ERREUR_ECRITURE}\n\nLe rapport N'A PAS été validé.`);
        }
        setValidating(false);
        return;
      }
      if (res.ecrit) majPhCourant({ ouvrages: res.phasage.ouvrages, revision: res.phasage.revision });
      lignes = res.lignes;
    }

    const taux = parseFloat(tauxHoraires?.[rapport.ouvrier]) || 0;
    const phasage_id = phasageIdParChantier[rapport.chantier_id] || null;
    // pointages.date est de type Postgres date → on convertit le format FR si besoin
    const dateISO = frToISO(rapport.date_rapport);

    // 1) Construit les écritures de pointages du rapport : tâches (heures > 0,
    //    doublons fusionnés), heures indirectes, et trajet réparti en centimes
    //    exacts entre les N chantiers du jour. Logique PARTAGÉE avec l'outil de
    //    ré-génération (Admin → Pointages) via buildPointagesRapport().
    const rapportsMemeJour = rapports.filter(r =>
      r.ouvrier === rapport.ouvrier && r.date_rapport === rapport.date_rapport
    );
    // Trajet pondéré par le temps passé sur chaque chantier : on constitue les
    // heures de chaque rapport du jour dans l'ordre stable (par id). Pour CE
    // rapport, on prend les heures ÉDITÉES (ce qui sera réellement écrit), pas
    // le déclaré brut ; pour les autres, leur déclaré.
    const rapportsMemeJourTri = [...rapportsMemeJour]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const heuresEditeesRapport = lignes.reduce((s, l) => s + (parseFloat(l.heures) || 0), 0)
      + indirectes.reduce((s, x) => s + (parseFloat(x.heures) || 0), 0);
    const heuresParRapportDuJour = rapportsMemeJourTri.map(r =>
      r.id === rapport.id ? heuresEditeesRapport : heuresDeclareesRapport(r)
    );
    const lignesPointages = buildPointagesRapport({
      chantier_id: rapport.chantier_id,
      ouvrier: rapport.ouvrier,
      dateISO,
      taux,
      phasage_id,
      rapport_id: rapport.id,
      valide_par: valideur,
      taskLines: taskLinesPourPointages(lignes),
      indirectLines: indirectes,
      trajetMinTotal: (parseInt(rapport.trajet_matin_min) || 0) + (parseInt(rapport.trajet_soir_min) || 0),
      nbChantiersDuJour: Math.max(1, rapportsMemeJour.length),
      rangRapport: rangRapportDuJour(rapport, rapportsMemeJour),
      heuresParRapportDuJour,
    });

    // ── INTÉGRITÉ : le registre AVANT le marquage « validé » ────────────────
    // On enregistre les pointages en premier. Si l'écriture échoue, on ARRÊTE
    // tout : le rapport n'est PAS marqué validé. Sans ça, une erreur d'insert
    // (ex. collision sur l'index unique) laissait un CR « validé » sans aucune
    // heure au registre — perte silencieuse (bug corrigé).
    //
    // Nettoyage préalable : on supprime d'éventuels pointages déjà liés à ce
    // rapport (re-validation, reprise après échec) pour repartir propre et ne
    // pas déclencher de faux doublon sur l'index unique.
    {
      const { error: delErr } = await supabase.from("pointages").delete().eq("rapport_id", rapport.id);
      if (delErr) {
        console.error("Nettoyage pointages avant validation:", delErr);
        alert("⚠️ Impossible de préparer l'enregistrement des heures (nettoyage).\n\n"
          + "Le rapport N'A PAS été validé. Réessaie ; si l'erreur persiste, préviens un administrateur.");
        setValidating(false);
        return;
      }
    }
    if (lignesPointages.length > 0) {
      const { error: insErr } = await supabase.from("pointages").insert(lignesPointages);
      if (insErr) {
        console.error("Insert pointages:", insErr);
        const doublon = insErr.code === "23505";
        alert(
          "⚠️ Les heures de ce rapport n'ont pas pu être enregistrées.\n\n"
          + "Le rapport N'A PAS été validé — aucune heure n'a été écrite au registre.\n\n"
          + (doublon
              ? "Cause probable : deux lignes pointent vers la même tâche du plan. "
                + "Regroupe-les sur une seule ligne (en additionnant les heures) puis revalide."
              : `Détail technique : ${insErr.message || "erreur inconnue"}`)
          + "\n\nCorrige puis réessaie — il n'y a pas de risque de double comptage."
        );
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
      const ph = phCourant;
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
          const resAv = await sauvegarderPhasage({
            phasageId: ph.id, revision: ph.revision ?? 0, plan_travaux: plan,
          });
          if (!resAv.ok) {
            if (resAv.code === "conflit") setConflitPhasage(true);
            else console.error("Update plan_travaux avancement:", resAv.code);
          } else {
            majPhCourant({ plan_travaux: plan, revision: resAv.revision });
          }
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
      const phV2 = phCourant;
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
          const resO = await sauvegarderPhasage({
            phasageId: phV2.id, revision: phV2.revision ?? 0, ouvrages: ouvragesNext,
          });
          if (!resO.ok) {
            if (resO.code === "conflit") setConflitPhasage(true);
            else console.error("Update ouvrages avancement (double écriture):", resO.code);
          } else {
            majPhCourant({ ouvrages: ouvragesNext, revision: resO.revision });
          }
        }
      }
    }

    // 3) Marque le rapport comme validé + trace l'éventuel déverrouillage
    // exceptionnel du garde-fou. Le déclaratif d'origine reste inchangé.
    const valideLe = new Date().toISOString();
    const exceptionHeuresTrace = exceptionHeures ? { ...exceptionHeures, le: valideLe } : null;
    let { error: upErr } = await supabase.from("rapports")
      .update({
        statut: "valide", valide_par: valideur, valide_le: valideLe,
        exception_heures: exceptionHeuresTrace,
      })
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

  // ── Correction du chantier d'un rapport ────────────────────────────────────
  // L'ouvrier s'est trompé de chantier dans son compte rendu : on réaffecte le
  // rapport (non validé) à un autre chantier. Les tache_id/phase_id des lignes
  // pointaient vers le plan de l'ANCIEN chantier — on les détache pour que
  // l'auto-match se relance sur le plan du nouveau chantier à la réouverture.
  async function changerChantierRapport(rapport, newChantierId) {
    if (!rapport || !newChantierId || String(newChantierId) === String(rapport.chantier_id)) return;
    if (rapport.statut === "valide") {
      alert("Ce rapport est déjà validé — clique d'abord sur « Corriger » pour le rouvrir.");
      return;
    }
    const ch = chantiers.find(c => String(c.id) === String(newChantierId));
    const nomNew = ch?.nom || newChantierId;
    if (!window.confirm(
      `Réaffecter ce rapport au chantier « ${nomNew} » ?\n\n`
      + "Les lignes seront détachées du plan de l'ancien chantier et "
      + "l'auto-détection se relancera sur le plan du nouveau chantier."
    )) return;
    setValidating(true);
    const tachesNext = (rapport.taches || []).map(t => ({ ...t, tache_id: null, phase_id: null, ouvrage_id: null }));
    const { error } = await supabase.from("rapports")
      .update({ chantier_id: newChantierId, chantier_nom: nomNew, taches: tachesNext })
      .eq("id", rapport.id);
    if (error) {
      console.error("Changement de chantier:", error);
      alert(`Erreur lors du changement de chantier : ${error.message || error}`);
      setValidating(false);
      return;
    }
    setValidating(false);
    await load(); // recharge rapports + phasages (dont celui du nouveau chantier)
  }

  // ── Bascule d'une ligne vers un AUTRE chantier ─────────────────────────────
  // Cas : l'ouvrier a déclaré toutes ses heures sur un chantier alors qu'il en
  // a passé une partie ailleurs. Une ligne (ou une partie de ses heures) est
  // déplacée dans le rapport du même ouvrier / même jour pour le chantier cible
  // — créé s'il n'existe pas, complété sinon. Le rapport cible reste « en
  // attente » : c'est en le validant que ses pointages seront écrits sur le bon
  // chantier ; le trajet du jour se re-pondère de lui-même (même trajet porté
  // par chaque rapport du jour, quote-part au temps passé).
  // Trace : la tâche déplacée porte `bascule_depuis` ; la tâche d'origine garde
  // ses heures déclarées (`heures_declarees_origine`) + la liste `bascules`, et
  // reste dans le rapport à 0h si tout a été déplacé (sans avancement pour ne
  // rien écrire au plan du mauvais chantier).
  async function basculerLigneVersChantier({ rapport, ligne, chantierId, heures }) {
    if (!rapport || !ligne || !chantierId) return false;
    if (String(chantierId) === String(rapport.chantier_id)) return false;
    if (rapport.statut === "valide") {
      alert("Ce rapport est déjà validé — clique d'abord sur « Corriger » pour le rouvrir.");
      return false;
    }
    if (journeeCloturee) {
      alert("La journée est clôturée — rouvre-la d'abord pour basculer des heures.");
      return false;
    }
    const h = Math.round((parseFloat(heures) || 0) * 100) / 100;
    if (h <= 0) { alert("Indique un nombre d'heures supérieur à 0."); return false; }
    const ch = chantiers.find(c => String(c.id) === String(chantierId));
    const nomNew = ch?.nom || String(chantierId);
    const cible = rapports.find(r =>
      r.ouvrier === rapport.ouvrier
      && r.date_rapport === rapport.date_rapport
      && String(r.chantier_id) === String(chantierId)
    );
    if (cible?.statut === "valide") {
      alert(`Le rapport de ${rapport.ouvrier} sur « ${nomNew} » est déjà validé — ouvre-le et clique sur « Corriger » avant d'y basculer des heures.`);
      return false;
    }
    const le = new Date().toISOString();
    const tacheDeplacee = ligneBasculee(ligne, { heures: h, rapport, valideur, le });
    // Source : retire les heures de la tâche d'origine (les index des lignes de
    // la modale pointent sur rapport.taches[] — on ne supprime jamais l'entrée).
    const tachesSrc = [...(rapport.taches || [])];
    const idx = ligne.origineIdx;
    if (idx != null && tachesSrc[idx]) {
      const t = tachesSrc[idx];
      const avant = parseFloat(t.heures_reelles) || 0;
      const reste = Math.max(0, Math.round((avant - h) * 100) / 100);
      tachesSrc[idx] = {
        ...t,
        heures_reelles: reste,
        heures_declarees_origine: t.heures_declarees_origine ?? avant,
        avancement: reste > 0 ? t.avancement : null,
        bascules: [...(t.bascules || []), { vers_chantier_id: chantierId, vers_chantier_nom: nomNew, heures: h, par: valideur, le }],
      };
    }

    setValidating(true);
    let err = null;
    if (cible) {
      ({ error: err } = await supabase.from("rapports")
        .update({ taches: [...(cible.taches || []), tacheDeplacee] })
        .eq("id", cible.id));
    } else {
      // Même gabarit que l'envoi mobile (RapportMobile) : le trajet du jour est
      // recopié tel quel, chaque rapport n'en écrit que sa quote-part.
      let payload = {
        ouvrier: rapport.ouvrier,
        chantier_id: chantierId,
        chantier_nom: nomNew,
        date_rapport: rapport.date_rapport,
        semaine: rapport.semaine || null,
        taches: [tacheDeplacee],
        heures_indirectes: [],
        remarque: `Heures basculées depuis « ${rapport.chantier_nom || rapport.chantier_id} » par ${valideur} (validation de fin de journée).`,
        photos_chantier: [],
        trajet_matin_min: parseInt(rapport.trajet_matin_min) || 0,
        trajet_soir_min: parseInt(rapport.trajet_soir_min) || 0,
      };
      const optionalCols = ["trajet_matin_min", "trajet_soir_min", "photos_chantier", "heures_indirectes", "semaine"];
      ({ error: err } = await supabase.from("rapports").insert(payload));
      while (err && err.code === "42703") {
        const dropped = optionalCols.find(c => new RegExp(c).test(err.message || ""));
        if (!dropped) break;
        delete payload[dropped];
        ({ error: err } = await supabase.from("rapports").insert(payload));
      }
    }
    if (err) {
      console.error("Bascule vers un autre chantier:", err);
      alert(`Impossible de basculer ces heures vers « ${nomNew} » : ${err.message || err}\n\nRien n'a été modifié.`);
      setValidating(false);
      return false;
    }
    const { error: srcErr } = await supabase.from("rapports").update({ taches: tachesSrc }).eq("id", rapport.id);
    if (srcErr) {
      console.error("Bascule — mise à jour du rapport d'origine:", srcErr);
      alert(`Les ${fmtH(h)}h ont bien été ajoutées sur « ${nomNew} », mais le rapport d'origine n'a pas pu être mis à jour (${srcErr.message || srcErr}).\n\nRetire ces heures à la main sur la ligne avant de valider.`);
    }
    setValidating(false);
    await load(); // recharge rapports (dont le nouveau) + phasage du chantier cible
    return true;
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
      {/* Conflit d'écriture sur le phasage. Aucun bouton de forçage : on
          recharge la version récente, puis on refait la validation. */}
      {conflitPhasage && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "11px 14px", marginBottom: 14, borderRadius: RADIUS.md || 8,
          background: "#e15a5a18", border: "1px solid #e15a5a55", color: "#e15a5a",
          fontSize: 13, fontWeight: 700,
        }}>
          Ce phasage a été modifié ailleurs. La validation n'a pas été enregistrée
          afin de protéger les données récentes.
          <button onClick={async () => { await load(); setConflitPhasage(false); }} style={{
            marginLeft: "auto", padding: "7px 14px", borderRadius: RADIUS.sm || 6, border: "none",
            background: "#e15a5a", color: "#fff", fontFamily: "inherit",
            fontSize: 12, fontWeight: 800, cursor: "pointer",
          }}>Recharger la version récente</button>
        </div>
      )}
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
                      <span style={{ fontSize: 14, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {r.chantier_nom || r.chantier_id}
                        {estRapportBeta(r) && <BadgeBeta/>}
                      </span>
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
          // La clé inclut le chantier : un changement de chantier remonte la
          // modale à neuf (lignes ré-initialisées depuis les tâches détachées,
          // auto-match relancé sur le plan du nouveau chantier).
          key={`${opened.id}:${opened.chantier_id}`}
          rapport={opened}
          chantiers={chantiers}
          onChangerChantier={(chId) => changerChantierRapport(opened, chId)}
          onBasculerLigne={(args) => basculerLigneVersChantier({ rapport: opened, ...args })}
          T={T} acc={acc}
          taux={parseFloat(tauxHoraires?.[opened.ouvrier]) || 0}
          alertes={alertesRapport(opened)}
          avancementParTache={avancementParTache[opened.chantier_id] || {}}
          autresPropositions={autresPropositionsPourRapport(opened)}
          tachesPlan={tachesPlanParChantier[opened.chantier_id] || []}
          ouvragesPlan={ouvragesPlanParChantier[opened.chantier_id] || []}
          tacheExistante={(id) => {
            const ph = phasages.find(p => p.chantier_id === opened.chantier_id);
            return ph && Array.isArray(ph.ouvrages) ? trouverTache(ph.ouvrages, id) : null;
          }}
          phases={phases}
          ouvriersDispo={ouvriers}
          journeeCloturee={!!journeeCloturee}
          nbChantiersDuJour={rapports.filter(r => r.ouvrier === opened.ouvrier && r.date_rapport === opened.date_rapport).length || 1}
          autresRapportsDuJour={rapports
            .filter(r => r.ouvrier === opened.ouvrier && r.date_rapport === opened.date_rapport && r.id !== opened.id)
            .map(r => ({ id: r.id, heures: heuresDeclareesRapport(r) }))}
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
  ouvragesPlan = [], tacheExistante = () => null,
  chantiers = [], onChangerChantier, onBasculerLigne,
  nbChantiersDuJour = 1,
  autresRapportsDuJour = [],   // [{ id, heures }] des AUTRES rapports du jour (poids trajet)
  onCreerTache, onClose, onValider, onDevalider, validating,
}) {
  // État local éditable : copie indépendante de rapport.taches[] pour ne pas
  // toucher au déclaratif d'origine de l'ouvrier (trace préservée).
  const [lignes, setLignes] = useState([]);
  const [indirectes, setIndirectes] = useState([]);
  const [creerTacheState, setCreerTacheState] = useState(null); // { ligneRowId, nom?, phase_id? }
  const [basculeState, setBasculeState] = useState(null);       // { rowId, chantierId, heures }
  const [basculeBusy, setBasculeBusy] = useState(false);

  // P6 : verrouille toute action si la journée est clôturée (sauf consultation).
  const valide = rapport.statut === "valide";
  const verrouille = valide || journeeCloturee;

  useEffect(() => {
    const init = lignesDepuisRapport(rapport);
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
      // Nouvelle tâche proposée par l'ouvrier : jamais de rattachement
      // automatique (une tâche proche est seulement SUGGÉRÉE dans son bloc).
      if (li.proposition) return li;
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
  // ⚠️ Trajet pondéré par le temps passé : la quote-part de CE rapport dépend de
  // ses heures rapportées aux heures des autres chantiers du jour. Un chantier à
  // 0h ne porte aucun trajet. On reproduit EXACTEMENT le calcul en centimes de
  // buildPointagesRapport (plus grand reste), avec les heures ÉDITÉES ici.
  const heuresCeRapport = totalHTaches + totalHIndirect;
  const rapportsJourTri = [
    ...autresRapportsDuJour.map(a => ({ id: a.id, h: parseFloat(a.heures) || 0 })),
    { id: rapport.id, h: heuresCeRapport },
  ].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const centsJour = repartTrajetCents(trajetMin, rapportsJourTri.map(x => x.h));
  const rangCeRapport = rapportsJourTri.findIndex(x => x.id === rapport.id);
  const totalHTrajet = (centsJour[rangCeRapport] || 0) / 100;
  const totalCout = (totalHTaches + totalHIndirect + totalHTrajet) * taux;

  const updateLigne = (rowId, patch) => setLignes(prev => prev.map(l => l.rowId === rowId ? { ...l, ...patch } : l));
  const splitLigne = (rowId) => setLignes(prev => {
    const i = prev.findIndex(l => l.rowId === rowId);
    if (i < 0) return prev;
    const [modif, nouvelle] = decouperLigne(prev[i], `s${genId()}`);
    return [...prev.slice(0, i), modif, nouvelle, ...prev.slice(i + 1)];
  });
  const removeLigne = (rowId) => setLignes(prev => prev.filter(l => l.rowId !== rowId));

  // Bascule vers un autre chantier : la page écrit en base (rapport cible +
  // rapport d'origine), puis on reflète localement — la ligne disparaît si tout
  // est parti, sinon elle garde le reste. Les autres corrections en cours dans
  // la modale sont conservées.
  const ouvrirBascule = (rowId) => {
    const li = lignes.find(l => l.rowId === rowId);
    if (!li) return;
    setBasculeState({ rowId, chantierId: "", heures: parseFloat(li.heures) || 0 });
  };
  const confirmerBascule = async () => {
    if (!basculeState || basculeBusy) return;
    const li = lignes.find(l => l.rowId === basculeState.rowId);
    if (!li) { setBasculeState(null); return; }
    if (!basculeState.chantierId) { alert("Choisis le chantier de destination."); return; }
    const h = Math.round((parseFloat(basculeState.heures) || 0) * 100) / 100;
    if (h <= 0) { alert("Indique un nombre d'heures supérieur à 0."); return; }
    setBasculeBusy(true);
    const ok = await onBasculerLigne?.({ ligne: li, chantierId: basculeState.chantierId, heures: h });
    setBasculeBusy(false);
    if (!ok) return;
    const reste = Math.round(((parseFloat(li.heures) || 0) - h) * 100) / 100;
    setLignes(prev => reste > 0
      ? prev.map(l => l.rowId === li.rowId ? { ...l, heures: reste } : l)
      : prev.filter(l => l.rowId !== li.rowId));
    setBasculeState(null);
  };

  // Réaffectation : on capture la sélection (tache_id du plan, "__libre__", ou "__creer__")
  // V2 si les options du menu portent un ouvrage_id (chantier avec ouvrages).
  const chantierV2 = (tachesPlan || []).some(t => t.ouvrage_id);
  const onChangeTache = (rowId, value) => {
    if (value === "__creer__") {
      // Pré-remplit le nom avec ce que l'ouvrier avait déclaré (modifiable).
      // V2 : ouvrage « Divers / hors devis » par défaut, nature non renseignée.
      const ligne = lignes.find(l => l.rowId === rowId);
      setCreerTacheState({
        rowId, nom: ligne?.planifie || "", phase_id: chantierV2 ? null : (phases[0]?.id || ""), useOuvrages: chantierV2,
        ouvrage_id: null, nature: null, hors_devis: false,
      });
      return;
    }
    // Nouvelle tâche proposée : revenir à la création (décision préremplie
    // depuis l'ouvrier, ou celle déjà retouchée par le conducteur).
    if (value === "__proposee__") {
      const ligne = lignes.find(l => l.rowId === rowId);
      if (!ligne?.proposition) return;
      const creation = ligne.creation || creationParDefaut({ planifie: ligne.planifie, proposition: ligne.proposition });
      updateLigne(rowId, {
        tache_id: null, phase_id: null, ouvrage_id: null, _autoMatched: false,
        creation, planifie: creation.nom || ligne.planifie,
      });
      return;
    }
    if (value === "__libre__" || !value) {
      // Sur une proposition : « ne pas créer », la ligne reste libre.
      updateLigne(rowId, { tache_id: null, phase_id: null, ouvrage_id: null, _autoMatched: false, creation: null });
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
      // V2 : pas d'heures vendues (le champ n'existe plus) ; ouvrage, nature
      // et « Hors devis » choisis dans la fenêtre.
      heures_vendues: creerTacheState.useOuvrages ? null : creerTacheState.heures_vendues,
      ouvriers: rapport.ouvrier ? [rapport.ouvrier] : [],
      ...(creerTacheState.useOuvrages ? {
        ouvrage_id: creerTacheState.ouvrage_id || null,
        nature: creerTacheState.nature || null,
        hors_devis: creerTacheState.hors_devis === true,
        cree_par: rapport.ouvrier || null,
        rapport_id: rapport.id,
      } : {}),
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

  // Tâche du phasage au nom proche d'une proposition : SUGGÉRÉE (doublon
  // possible), jamais rattachée d'office. La tâche créée par une validation
  // précédente de ce même rapport n'est pas un doublon : on l'écarte.
  const suggestionProposition = (li) => {
    const nom = li.creation?.nom || li.planifie;
    const idPropre = idTacheProposee(rapport.id, li.origineIdx);
    const best = meilleureTachePlan(nom, (tachesPlan || []).filter(t => String(t.id) !== idPropre));
    return best && best.score >= SEUIL_AUTOMATCH ? best.tache : null;
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
            <div style={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {rapport.ouvrier} — {rapport.chantier_nom || rapport.chantier_id}
              {estRapportBeta(rapport) && <BadgeBeta/>}
            </div>
            {/* Correction : l'ouvrier s'est trompé de chantier sur son CR */}
            {!verrouille && chantiers.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: T.textSub, textTransform: "uppercase", letterSpacing: .3, fontWeight: 600 }}>
                  Chantier :
                </span>
                <select
                  value={rapport.chantier_id || ""}
                  onChange={e => { if (e.target.value) onChangerChantier?.(e.target.value); }}
                  title="Réaffecter ce rapport à un autre chantier (erreur de saisie de l'ouvrier)"
                  style={{
                    padding: "3px 6px", borderRadius: RADIUS.md,
                    border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
                    fontSize: 12, fontFamily: "inherit", maxWidth: 320,
                  }}
                >
                  {/* Chantier courant absent de la liste (archivé ?) : option de repli */}
                  {!chantiers.some(c => String(c.id) === String(rapport.chantier_id)) && (
                    <option value={rapport.chantier_id || ""}>
                      {libelleCourt(rapport.chantier_nom || rapport.chantier_id || "(inconnu)", 60)}
                    </option>
                  )}
                  {[...chantiers].sort((a, b) => String(a.nom || a.id).localeCompare(String(b.nom || b.id))).map(c => (
                    <option key={c.id} value={c.id}>{libelleCourt(c.nom || c.id, 60)}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>
              {dateLabel(rapport.date_rapport)} · {fmtH(totalHTaches)}h tâches · taux {taux}€/h
              {trajetMin > 0 && (
                <span> · 🚗 Trajet {fmtH(totalHTrajet)}h
                  {nbChantiersDuJour > 1
                    ? <span style={{ fontStyle: "italic" }}> (quote-part de {fmtH(trajetMin / 60)}h, pondérée au temps passé)</span>
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
                  ouvragesPlan={ouvragesPlan}
                  ouvrier={rapport.ouvrier}
                  dejaCreee={li.proposition ? tacheExistante(idTacheProposee(rapport.id, li.origineIdx)) : null}
                  suggestion={li.proposition ? suggestionProposition(li) : null}
                  phases={phases}
                  avancementActuel={li.tache_id ? avancementParTache[String(li.tache_id)] : null}
                  autres={li.tache_id ? (autresPropositions[String(li.tache_id)] || []) : []}
                  onChange={(patch) => updateLigne(li.rowId, patch)}
                  onChangeTache={(value) => onChangeTache(li.rowId, value)}
                  onSplit={() => splitLigne(li.rowId)}
                  onBasculer={chantiers.length > 0 && onBasculerLigne ? () => ouvrirBascule(li.rowId) : null}
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
          ouvragesPlan={ouvragesPlan}
          T={T} acc={acc}
          onValider={validerCreation}
          onClose={() => setCreerTacheState(null)}
        />
      )}

      {/* Sous-modale bascule d'une ligne vers un autre chantier */}
      {basculeState && (() => {
        const li = lignes.find(l => l.rowId === basculeState.rowId);
        return li ? (
          <BasculerChantierModale
            state={basculeState}
            setState={setBasculeState}
            ligne={li}
            rapport={rapport}
            chantiers={chantiers}
            busy={basculeBusy}
            T={T} acc={acc}
            onValider={confirmerBascule}
            onClose={() => setBasculeState(null)}
          />
        ) : null;
      })()}
    </div>
  );
}

// ─── Ligne éditable (P4 correction + P5 avancement arbitré) ──────────────────

function LigneEditable({
  ligne, T, acc, valide, tachesPlan, phases,
  ouvragesPlan = [], ouvrier = null, dejaCreee = null, suggestion = null,
  avancementActuel, autres, onChange, onChangeTache, onSplit, onRemove, onBasculer,
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
  const aCreer = propositionACreer(ligne);
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
            value={ligne.tache_id || (aCreer ? "__proposee__" : libre ? "__libre__" : "")}
            onChange={e => onChangeTache(e.target.value)}
            disabled={valide}
            style={{
              flex: 1, minWidth: 0,
              padding: "4px 6px", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text,
              fontSize: 12, fontFamily: "inherit",
            }}
          >
            {ligne.proposition && (
              <option value="__proposee__">★ Nouvelle tâche proposée (créée à la validation)</option>
            )}
            <option value="__libre__">{ligne.proposition ? "— Ne pas créer : laisser en tâche libre —" : "— Tâche libre / non rattachée —"}</option>
            {Object.keys(tachesParGroupe).map(groupe => {
              const ph = phasesById[groupe];
              const label = ph ? `${ph.emoji || ""} ${ph.label}` : groupe;
              return (
                <optgroup key={groupe} label={libelleCourt(label)}>
                  {tachesParGroupe[groupe].map(t => (
                    <option key={t.id} value={t.id}>
                      {libelleCourt(t.nom)}{ligne.tache_id === t.id ? " ✓" : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
            <option value="__creer__">+ Créer nouvelle tâche…</option>
          </select>
          <StatutTacheLabel statut={ligne.statut} bloque={ligne.bloque}/>
        </div>
        {/* Sous-info : badge libre, badge auto-match, autres propositions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {libre && !aCreer && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(245,166,35,0.15)", color: "#b27416", textTransform: "uppercase", letterSpacing: .3,
            }}>
              Tâche libre
            </span>
          )}
          {ligne.origine === "phasage" && (
            <span title="Tâche non prévue au planning, choisie par l'ouvrier dans le phasage du chantier (nouveau compte rendu)" style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(139,92,246,0.14)", color: "#7c3aed", textTransform: "uppercase", letterSpacing: .3,
            }}>
              Ajoutée par l'ouvrier
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
          {ligne.bascule_depuis && (
            <span title={`Heures basculées depuis « ${ligne.bascule_depuis.chantier_nom || ligne.bascule_depuis.chantier_id} » par ${ligne.bascule_depuis.par || "?"} — à rattacher au plan de CE chantier`} style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(77,184,255,0.15)", color: "#2a8fd6", textTransform: "uppercase", letterSpacing: .3,
              cursor: "help",
            }}>
              ⇄ Reçue de {libelleCourt(ligne.bascule_depuis.chantier_nom || ligne.bascule_depuis.chantier_id || "?", 28)}
            </span>
          )}
          {Array.isArray(ligne.bascules) && ligne.bascules.length > 0 && (
            <span title={ligne.bascules.map(b => `${fmtH(b.heures)}h → « ${b.vers_chantier_nom || b.vers_chantier_id} » (${b.par || "?"})`).join("\n")} style={{
              fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999,
              background: "rgba(77,184,255,0.15)", color: "#2a8fd6", textTransform: "uppercase", letterSpacing: .3,
              cursor: "help",
            }}>
              ⇄ {fmtH(ligne.bascules.reduce((t, b) => t + (parseFloat(b.heures) || 0), 0))}h basculées ailleurs
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
          {/* Explication : la remarque (ancien formulaire) ou le motif choisi +
              la précision (formulaire bêta). Une ligne avec un motif et sans
              remarque est complète. */}
          {explicationLigne(ligne) && (
            <span style={{ fontSize: 11, color: T.text, fontStyle: "italic" }}>
              💬 {explicationLigne(ligne)}
            </span>
          )}
          {ligne.motif_depassement && (() => {
            const d = depassementAffichable(ligne);
            return (
              <span title={d ? "Relevé au moment de la saisie de l'ouvrier" : "La ligne a été réaffectée, découpée ou ses heures corrigées : le relevé d'origine ne s'applique plus, seul le motif de l'ouvrier est conservé."} style={{
                fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 999,
                background: "rgba(225,90,90,0.12)", color: "#c0392b",
              }}>
                {d ? `${fmtH(d.heures_avant + d.heures_jour)}h sur ${fmtH(d.heures_vendues)}h vendues : ` : "Motif de dépassement : "}
                {libelleMotifDepassement(ligne.motif_depassement)}
              </span>
            );
          })()}
        </div>
        {ligne.proposition && (
          <BlocProposition ligne={ligne} T={T} valide={valide} ouvragesPlan={ouvragesPlan}
            ouvrier={ouvrier} dejaCreee={dejaCreee} suggestion={suggestion}
            onChange={onChange} onChangeTache={onChangeTache}/>
        )}
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
        <InputNombre
          min="0"
          valeur={ligne.heures ?? ""}
          onValeur={n => onChange({ heures: n === null ? "" : n })} vide={""}
          onWheel={e => e.currentTarget.blur()}
          disabled={valide}
          style={{ ...inputStyle(T), textAlign: "right" }}
        />
        {Math.abs((parseFloat(ligne.heures) || 0) - (parseFloat(ligne.heures_origine) || 0)) > 0.001 && (
          <div style={{ fontSize: 10, color: "#e05c5c", marginTop: 2, fontWeight: 700 }}>
            Déclaré {fmtH(ligne.heures_origine)}h → retenu {fmtH(ligne.heures)}h
          </div>
        )}
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
          <InputNombre
            min="0" max="100"
            valeur={ligne.avancement_arbitre ?? ""}
            entier onValeur={n => onChange({ avancement_arbitre: n === null ? "" : Math.max(0, Math.min(100, n)) })} vide={""}
            disabled={valide || (!ligne.tache_id && !aCreer)}
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
        {onBasculer && (
          <button onClick={onBasculer} disabled={valide} title="Basculer tout ou partie de ces heures vers un autre chantier (erreur de chantier de l'ouvrier)" style={{ ...iconBtnStyle(T), color: "#2a8fd6" }}>
            <Icon as={ArrowRightLeft} size={14}/>
          </button>
        )}
        <button onClick={onRemove} disabled={valide} title="Supprimer la ligne" style={{ ...iconBtnStyle(T), color: "#e05c5c" }}>
          <Icon as={Trash2} size={14}/>
        </button>
      </div>
    </div>
  );
}

// ─── Bloc « Nouvelle tâche proposée » (formulaire bêta) ──────────────────────
// L'ouvrier a proposé une tâche absente du phasage, dans un ouvrage, avec une
// nature. Par défaut le conducteur CONFIRME : la tâche est créée à la
// validation du rapport. Il peut changer l'ouvrage, la nature, la case « Hors
// devis » (préremplie par la nature), ou rattacher la ligne à une tâche
// existante (menu au-dessus, ou suggestion d'une tâche au nom proche).
const libelleOuvrageOption = (o) => `${o.code ? `${o.code} · ` : ""}${libelleCourt(o.libelle, 80)}`;

function BlocProposition({ ligne, T, valide, ouvragesPlan, ouvrier, dejaCreee, suggestion, onChange, onChangeTache }) {
  const p = ligne.proposition || {};
  const c = ligne.creation;
  const violet = "#7c3aed";
  const setCreation = (patch) => onChange({ creation: { ...c, ...patch } });
  const ouvrageConnu = !c?.ouvrage_id || ouvragesPlan.some(o => String(o.id) === String(c.ouvrage_id));
  const champ = { ...inputStyle(T), padding: "5px 8px", fontSize: 12.5 };
  const bouton = {
    padding: "4px 10px", borderRadius: RADIUS.md, border: `1px solid ${violet}`, background: "transparent",
    color: violet, cursor: valide ? "default" : "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
  };
  return (
    <div style={{ marginTop: 4, padding: "8px 10px", borderRadius: RADIUS.md, background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.35)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: violet, textTransform: "uppercase", letterSpacing: .4 }}>
        Nouvelle tâche proposée{ouvrier ? ` par ${ouvrier}` : ""}
      </div>
      <div style={{ fontSize: 12, color: T.text, marginTop: 3, lineHeight: 1.45 }}>
        Dans <strong title={p.ouvrage_libelle}>« {libelleCourt(p.ouvrage_libelle || DIVERS_HORS_DEVIS, 90)} »</strong>
        {" · "}{libelleNature(p.nature) || "nature non renseignée"}
        {p.demandeur ? <> · demandée par <strong>{p.demandeur}</strong></> : null}
      </div>

      {ligne.tache_id ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: T.textSub }}>
          Rattachée à une tâche existante : elle ne sera pas créée.
          {!valide && <button onClick={() => onChangeTache("__proposee__")} style={bouton}>Créer la nouvelle tâche à la place</button>}
        </div>
      ) : !c ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6, fontSize: 12, color: T.textSub }}>
          Laissée en tâche libre : elle ne sera pas créée.
          {!valide && <button onClick={() => onChangeTache("__proposee__")} style={bouton}>Revenir à la création</button>}
        </div>
      ) : dejaCreee ? (
        <div style={{ marginTop: 6, fontSize: 12, color: T.text }}>
          ✓ Déjà créée lors d'une validation précédente, dans « {libelleCourt(dejaCreee.ouvrage.libelle, 70)} » :
          la ligne y sera rattachée, rien n'est recréé.
        </div>
      ) : valide ? (
        <div style={{ marginTop: 6, fontSize: 12, color: T.textSub }}>Non créée.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={miniLabel(T)}>Nom de la tâche créée</label>
            <input type="text" value={c.nom || ""} onChange={e => onChange({ creation: { ...c, nom: e.target.value }, planifie: e.target.value })} style={champ}/>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={miniLabel(T)}>Ouvrage</label>
            <select value={c.ouvrage_id || ouvragesPlan.find(o => o.divers)?.id || ""} onChange={e => setCreation({ ouvrage_id: e.target.value || null })} style={champ}>
              {!ouvrageConnu && <option value={c.ouvrage_id}>⚠ Ouvrage proposé introuvable sur ce chantier — choisis-en un</option>}
              {ouvragesPlan.map(o => (
                <option key={o.id || "__divers__"} value={o.id || ""}>{libelleOuvrageOption(o)}{o.id ? "" : " (sera créé)"}</option>
              ))}
            </select>
            {!ouvrageConnu && (
              <div style={{ fontSize: 11, color: "#e05c5c", fontWeight: 700, marginTop: 2 }}>
                L'ouvrage proposé n'existe plus dans ce phasage : la validation sera refusée tant qu'un autre n'est pas choisi.
              </div>
            )}
          </div>
          <div>
            <label style={miniLabel(T)}>Nature</label>
            <select value={c.nature || ""} onChange={e => {
              const nature = e.target.value || null;
              const parDefaut = horsDevisParDefaut(nature);
              setCreation({ nature, hors_devis: parDefaut == null ? c.hors_devis : parDefaut });
            }} style={champ}>
              {!c.nature && <option value="">Non renseignée</option>}
              {NATURES_TACHE.map(n => <option key={n.code} value={n.code}>{n.label}</option>)}
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.text, alignSelf: "end", paddingBottom: 4 }}>
            <input type="checkbox" checked={c.hors_devis === true} onChange={e => setCreation({ hors_devis: e.target.checked })}/>
            Hors devis : ne consomme pas les heures vendues de l'ouvrage
          </label>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: T.textSub }}>
            Sera créée à la validation du rapport (sans heures vendues), au nom de {ouvrier || "l'ouvrier"}.
          </div>
        </div>
      )}

      {!valide && c && !ligne.tache_id && !dejaCreee && suggestion && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: T.text }}>
          <span>Doublon possible : <strong>« {libelleCourt(suggestion.nom, 60)} »</strong> existe déjà{suggestion.groupe ? ` (${libelleCourt(suggestion.groupe, 40)})` : ""}.</span>
          <button onClick={() => onChangeTache(suggestion.id)} style={bouton}>Rattacher à celle-ci</button>
        </div>
      )}
    </div>
  );
}

// ─── Sous-modale création nouvelle tâche du plan ─────────────────────────────

function CreerTacheModale({ state, setState, phases, ouvragesPlan = [], T, acc, onValider, onClose }) {
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
            <>
              <div>
                <label style={miniLabel(T)}>Ouvrage</label>
                <select
                  value={state.ouvrage_id || ouvragesPlan.find(o => o.divers)?.id || ""}
                  onChange={e => setState({ ...state, ouvrage_id: e.target.value || null })}
                  style={inputStyle(T)}
                >
                  {ouvragesPlan.map(o => (
                    <option key={o.id || "__divers__"} value={o.id || ""}>{libelleOuvrageOption(o)}{o.id ? "" : " (sera créé)"}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={miniLabel(T)}>Nature</label>
                <select
                  value={state.nature || ""}
                  onChange={e => {
                    const nature = e.target.value || null;
                    const parDefaut = horsDevisParDefaut(nature);
                    setState({ ...state, nature, hors_devis: parDefaut == null ? state.hors_devis : parDefaut });
                  }}
                  style={inputStyle(T)}
                >
                  <option value="">Non renseignée</option>
                  {NATURES_TACHE.map(n => <option key={n.code} value={n.code}>{n.label} — {n.description}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text }}>
                <input type="checkbox" checked={state.hors_devis === true} onChange={e => setState({ ...state, hors_devis: e.target.checked })}/>
                Hors devis : ne consomme pas les heures vendues de l'ouvrage
              </label>
            </>
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
          {/* V1 seulement : en V2 une tâche créée ici n'a pas d'heures vendues
              (le champ était affiché mais ignoré). */}
          {!state.useOuvrages && (
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
          )}
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

// ─── Sous-modale bascule d'une ligne vers un autre chantier ──────────────────
// L'ouvrier a déclaré ses heures sur le mauvais chantier (en tout ou partie).
// On choisit le chantier de destination et le nombre d'heures à déplacer ; le
// reste (s'il y en a) demeure sur la ligne courante.

function BasculerChantierModale({ state, setState, ligne, rapport, chantiers, busy, T, acc, onValider, onClose }) {
  const heuresLigne = parseFloat(ligne.heures) || 0;
  const h = parseFloat(state.heures) || 0;
  const reste = Math.max(0, Math.round((heuresLigne - h) * 100) / 100);
  const tout = h >= heuresLigne - 0.001;
  const chCible = chantiers.find(c => String(c.id) === String(state.chantierId));
  const liste = [...chantiers]
    .filter(c => String(c.id) !== String(rapport.chantier_id))
    .sort((a, b) => String(a.nom || a.id).localeCompare(String(b.nom || b.id)));
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
            <Icon as={ArrowRightLeft} size={18} color={acc.accent}/>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Basculer vers un autre chantier</span>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", cursor: "pointer", padding: 4,
            color: T.textSub, display: "flex", alignItems: "center",
          }}>
            <Icon as={X} size={18}/>
          </button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: T.textSub }}>
            <strong style={{ color: T.text }}>{rapport.ouvrier}</strong> a déclaré{" "}
            <strong style={{ color: T.text }}>{fmtH(heuresLigne)}h</strong> sur « {libelleCourt(ligne.planifie || "(sans nom)", 60)} »
            pour le chantier <strong style={{ color: T.text }}>{rapport.chantier_nom || rapport.chantier_id}</strong>.
          </div>
          <div>
            <label style={miniLabel(T)}>Chantier de destination</label>
            <select
              autoFocus
              value={state.chantierId || ""}
              onChange={e => setState({ ...state, chantierId: e.target.value })}
              style={inputStyle(T)}
            >
              <option value="">— Choisir un chantier —</option>
              {liste.map(c => (
                <option key={c.id} value={c.id}>{libelleCourt(c.nom || c.id, 70)}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={miniLabel(T)}>Heures à basculer</label>
            <InputNombre
              min="0"
              valeur={state.heures ?? ""}
              onValeur={n => setState({ ...state, heures: n === null ? "" : n })} vide={""}
              onWheel={e => e.currentTarget.blur()}
              style={{ ...inputStyle(T), textAlign: "right" }}
            />
            <div style={{ fontSize: 11, color: T.textSub, marginTop: 4 }}>
              {h <= 0
                ? "Indique le nombre d'heures réellement passées sur l'autre chantier."
                : tout
                  ? `Toute la ligne part vers ${chCible ? `« ${libelleCourt(chCible.nom || chCible.id, 40)} »` : "l'autre chantier"} — elle disparaît d'ici.`
                  : `${fmtH(h)}h partent vers ${chCible ? `« ${libelleCourt(chCible.nom || chCible.id, 40)} »` : "l'autre chantier"} · ${fmtH(reste)}h restent sur ce chantier.`}
            </div>
          </div>
          <div style={{
            fontSize: 12, color: "#2a6fa8", padding: "8px 10px", borderRadius: RADIUS.md,
            background: "rgba(77,184,255,0.10)", border: "1px solid rgba(77,184,255,0.35)",
          }}>
            Les heures rejoignent le rapport de {rapport.ouvrier} du même jour sur le chantier cible
            (créé s'il n'existe pas). Il apparaît « En attente » dans la liste : ouvre-le pour rattacher
            la tâche à son plan et le valider. Le trajet du jour se répartit automatiquement au temps passé.
          </div>
        </div>
        <div style={{
          padding: "12px 20px", borderTop: `1px solid ${T.border}`,
          display: "flex", justifyContent: "flex-end", gap: 8,
        }}>
          <button onClick={onClose} disabled={busy} style={{
            padding: "8px 16px", borderRadius: RADIUS.md,
            border: `1px solid ${T.border}`, background: "transparent", color: T.text,
            cursor: "pointer", fontFamily: "inherit", fontSize: 13,
          }}>
            Annuler
          </button>
          <button onClick={onValider} disabled={busy || !state.chantierId || h <= 0} style={{
            padding: "8px 16px", borderRadius: RADIUS.md,
            border: "none", background: acc.accent, color: "#fff",
            cursor: busy || !state.chantierId || h <= 0 ? "not-allowed" : "pointer",
            opacity: busy || !state.chantierId || h <= 0 ? .6 : 1,
            fontFamily: "inherit", fontSize: 13, fontWeight: 700,
          }}>
            {busy ? "…" : "Basculer"}
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
