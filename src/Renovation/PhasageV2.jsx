import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots, getCurrentWeek, getWeekId, LOGO_RENO_H } from "../constants";
import { Icon } from "../ui";
import {
  ListChecks, Sparkles, Building2, Boxes, Hammer, ClipboardList,
  ChevronDown, Plus, Trash2, FileSpreadsheet, X, Check, AlertTriangle,
  Pencil, Settings, FileDown, GanttChartSquare, LayoutGrid,
  Banknote, HardHat, Receipt, TrendingUp, TrendingDown, Percent, Clock, Target,
} from "lucide-react";
import { parseDevisExcel } from "../devisImport";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte du phasage : vue 3 colonnes (Lots → Ouvrages → Tâches) pour un
// chantier sélectionné en haut de page. Lit/écrit dans les mêmes tables
// Supabase que la v1 (`phasages`, `bibliotheque_ratios`, `planning_config`).
// Les ouvrages portent un nouveau champ `lot_id` qui les rattache à un lot.

const rid = () => Math.random().toString(36).slice(2, 10);

const JOURS_SEM = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

// Convertit un weekId "YYYY-W##" + un jour ("Lundi", etc.) en date ISO
// yyyy-mm-dd. ISO 8601 : la semaine 1 contient le 4 janvier.
function getDateFromWeekAndDay(weekId, jourName) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || "");
  if (!m) return "";
  const year = parseInt(m[1], 10), week = parseInt(m[2], 10);
  const idx = JOURS_SEM.indexOf(jourName);
  if (idx < 0) return "";
  const jan4 = new Date(year, 0, 4);
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  const d = new Date(mon);
  d.setDate(mon.getDate() + idx);
  const y = d.getFullYear(), mo = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function PagePhasageV2({ chantiers = [], ouvriers = [], tauxHoraires = {}, T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);

  // ── État ────────────────────────────────────────────────────────────────
  const [lots, setLots] = useState(LOTS_DEFAUT);
  const [chantierId, setChantierId] = useState(() => {
    try { return localStorage.getItem("phasage_v2_chantier") || ""; } catch { return ""; }
  });
  const [phasage, setPhasage] = useState(null);
  const [loadingPhasage, setLoadingPhasage] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [selectedOuvrageId, setSelectedOuvrageId] = useState(null);
  // Glisser-déposer : ouvrage en cours de déplacement + lot survolé (cible)
  const [draggedOuvrageId, setDraggedOuvrageId] = useState(null);
  const [dragOverLotId, setDragOverLotId] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved"); // saved | pending | saving | error
  const saveTimerRef = useRef(null);
  const newOuvrageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  // Modales d'édition : id de l'ouvrage / de la tâche en cours d'édition
  const [editingOuvrageId, setEditingOuvrageId] = useState(null);
  const [editingTache, setEditingTache] = useState(null); // { ouvrageId, tacheId }
  // Modale suivi direction (marge cible, seuil prime, prime chantier)
  const [showSuiviDirection, setShowSuiviDirection] = useState(false);
  // Mode d'affichage : "list" (3 colonnes Lots/Ouvrages/Tâches) | "gantt" (timeline)
  const [viewMode, setViewMode] = useState("list");
  // Form planification (envoyer une tâche dans planning_cells)
  const initialSemaine = (() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); })();
  const [planifSemaine, setPlanifSemaine] = useState(initialSemaine);
  const [planifJour, setPlanifJour] = useState("Lundi");
  const [planifDuree, setPlanifDuree] = useState("");
  const [planifMsg, setPlanifMsg] = useState(null); // { ok: bool, txt: string }
  const [planifSaving, setPlanifSaving] = useState(false);
  // Reset le form de planification quand on ouvre une nouvelle tâche.
  useEffect(() => {
    if (!editingTache) return;
    const o = ouvrages.find(x => x.id === editingTache.ouvrageId);
    const t = o?.taches?.find(x => x.id === editingTache.tacheId);
    setPlanifSemaine(initialSemaine);
    setPlanifJour("Lundi");
    setPlanifDuree(t?.heures_estimees ? String(t.heures_estimees) : "");
    setPlanifMsg(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTache?.tacheId]);

  // Construit la liste des 12 prochaines semaines pour le select.
  const semainesFutures = (() => {
    const list = [];
    const now = getCurrentWeek();
    for (let i = 0; i < 12; i++) {
      let w = now.week + i, y = now.year;
      while (w > 52) { w -= 52; y += 1; }
      list.push(getWeekId(y, w));
    }
    return list;
  })();

  // Envoie une tâche dans planning_cells (week + chantier + jour). Si la
  // cellule existe déjà, on ajoute la tâche à son tableau au lieu de
  // remplacer. Met aussi à jour date_prevue sur la tâche source.
  const envoyerDansPlanning = async (ouvrageId, tache) => {
    if (!chantierId || !planifSemaine || !planifJour) {
      setPlanifMsg({ ok: false, txt: "Choisis une semaine et un jour." });
      return;
    }
    setPlanifSaving(true);
    setPlanifMsg(null);
    try {
      const { data: ex } = await supabase.from("planning_cells")
        .select("*")
        .eq("week_id", planifSemaine).eq("chantier_id", chantierId).eq("jour", planifJour)
        .maybeSingle();
      const base = ex || { planifie: "", reel: "", ouvriers: [], taches: [] };
      const ouvriersTache = Array.isArray(tache.ouvriers) ? tache.ouvriers : [];
      const duree = parseFloat(planifDuree) || 0;
      const newTask = { id: rid(), text: tache.nom || "", duree, ouvriers: ouvriersTache };
      const nouveauPlanifie = base.planifie ? `${base.planifie}\n${tache.nom || ""}` : (tache.nom || "");
      const upsertPayload = {
        week_id: planifSemaine,
        chantier_id: chantierId,
        jour: planifJour,
        planifie: nouveauPlanifie,
        taches: [...(base.taches || []), newTask],
        reel: base.reel || "",
        ouvriers: [...new Set([...(base.ouvriers || []), ...ouvriersTache])],
      };
      const { error } = await supabase.from("planning_cells").upsert(upsertPayload, { onConflict: "week_id,chantier_id,jour" });
      if (error) throw error;
      // Met à jour la date_prevue sur la tâche d'origine
      const exactDate = getDateFromWeekAndDay(planifSemaine, planifJour);
      updateTache(ouvrageId, tache.id, { date_prevue: exactDate });
      setPlanifMsg({ ok: true, txt: `✓ Envoyé dans ${planifSemaine} · ${planifJour}` });
    } catch (e) {
      console.error("envoyerDansPlanning:", e);
      setPlanifMsg({ ok: false, txt: e.message || "Erreur lors de l'envoi." });
    }
    setPlanifSaving(false);
  };
  // Bibliothèque ouvrages (sert au matching à l'import devis)
  const [bibliotheque, setBibliotheque] = useState([]);
  // Bibliothèque matériaux (sert à valoriser les materiaux_liens d'un ouvrage)
  const [materiauxBiblio, setMateriauxBiblio] = useState([]);
  // État de la modale d'import (null si fermée)
  // { items: [...], unknownLotHeaders: [...], parsing: bool, error: string|null }
  const [importState, setImportState] = useState(null);

  // Charge les lots (config Admin)
  useEffect(() => { loadLots().then(setLots); }, []);
  // Charge la bibliothèque d'ouvrages
  useEffect(() => {
    supabase.from("bibliotheque_ratios").select("*").order("libelle")
      .then(({ data }) => setBibliotheque(data || []));
  }, []);
  // Charge la bibliothèque matériaux (pour le prix unitaire lors du calcul du
  // coût matériaux à l'import devis).
  useEffect(() => {
    supabase.from("materiaux_bibliotheque")
      .select("id,nom,unite,prix_unitaire")
      .then(({ data }) => setMateriauxBiblio(data || []));
  }, []);

  // Mémorise le dernier chantier ouvert
  useEffect(() => {
    if (chantierId) {
      try { localStorage.setItem("phasage_v2_chantier", chantierId); } catch {}
    }
  }, [chantierId]);

  // Charge le phasage du chantier sélectionné. Au passage on normalise les
  // ids : les tâches importées en v1 (ou via devis biblio) n'ont pas
  // toujours de champ `id`. Sans id, tous les updateTache(undefined)
  // matchaient toutes les tâches de l'ouvrage en même temps. On assigne
  // un id manquant ici, et on persiste silencieusement si on a dû en
  // créer (sinon chaque reload réassignerait des ids différents).
  useEffect(() => {
    if (!chantierId) { setPhasage(null); return; }
    let cancelled = false;
    setLoadingPhasage(true);
    supabase.from("phasages").select("*").eq("chantier_id", chantierId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error && error.code !== "PGRST116") console.warn("PhasageV2 load:", error.message);
        let mutated = false;
        if (data && Array.isArray(data.ouvrages)) {
          data.ouvrages = data.ouvrages.map(o => {
            const oid = o.id || (() => { mutated = true; return rid(); })();
            const taches = (o.taches || []).map(t => {
              if (t.id) return t;
              mutated = true;
              return { ...t, id: rid() };
            });
            return { ...o, id: oid, taches };
          });
        }
        setPhasage(data || null);
        setLoadingPhasage(false);
        // Si on a assigné de nouveaux ids, on les persiste pour que le
        // prochain chargement parte sur des ids stables.
        if (mutated && data?.id) {
          supabase.from("phasages").update({
            ouvrages: data.ouvrages,
            updated_at: new Date().toISOString(),
          }).eq("id", data.id).then(({ error: err }) => {
            if (err) console.warn("Persist normalized ids:", err.message);
          });
        }
      });
    return () => { cancelled = true; };
  }, [chantierId]);

  // Reset des sélections quand on change de chantier
  useEffect(() => { setSelectedLotId(null); setSelectedOuvrageId(null); }, [chantierId]);

  const ouvrages = phasage?.ouvrages || [];
  const chantier = chantiers.find(c => c.id === chantierId);

  // ─── PERSISTANCE ────────────────────────────────────────────────────────
  // Crée la ligne phasages si elle n'existe pas encore pour ce chantier.
  const ensurePhasage = async () => {
    if (phasage?.id) return phasage;
    const { data, error } = await supabase.from("phasages").insert({
      chantier_id: chantierId,
      chantier_nom: chantier?.nom || chantierId,
      ouvrages: [],
    }).select().single();
    if (error) { console.error("ensurePhasage:", error.message); return null; }
    setPhasage(data);
    return data;
  };

  // Autosave debounced 800ms : on push tout le tableau ouvrages à chaque
  // modif. Simple et fiable pour la v2 ; le merge collab par id pourra être
  // ajouté plus tard si nécessaire.
  // Garde anti-écrasement : avant d'écrire on relit le distant ; si on
  // s'apprête à supprimer > 50 % des ouvrages alors que le distant en
  // a plus de 2, on demande confirmation. Évite qu'un state local périmé
  // (V2 n'a pas de sub realtime, donc il ne sait pas si V1 a modifié) ne
  // wipe le travail d'un collègue.
  const scheduleSave = (ouvragesNext) => {
    setAutoSaveStatus("pending");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const p = await ensurePhasage();
      if (!p?.id) { setAutoSaveStatus("error"); return; }
      const { data: remote } = await supabase.from("phasages")
        .select("ouvrages").eq("id", p.id).maybeSingle();
      const remoteO = Array.isArray(remote?.ouvrages) ? remote.ouvrages.length : 0;
      const nextO   = Array.isArray(ouvragesNext) ? ouvragesNext.length : 0;
      if (remoteO > 2 && nextO < remoteO * 0.5) {
        const ok = window.confirm(
          `⚠️ Sauvegarde inhabituelle détectée\n\n` +
          `Ouvrages : ${remoteO} (distant) → ${nextO} (local)\n\n` +
          `Si vous êtes en train de supprimer beaucoup d'ouvrages, OK.\n` +
          `Si c'est inattendu (un collègue éditait peut-être en même temps), ` +
          `Annuler puis rechargez la page (F5).`
        );
        if (!ok) {
          setAutoSaveStatus("error");
          // Resynchronise depuis le distant pour stopper le ping-pong
          const { data: full } = await supabase.from("phasages")
            .select("*").eq("id", p.id).maybeSingle();
          if (full) setPhasage(full);
          return;
        }
      }
      const { error } = await supabase.from("phasages").update({
        ouvrages: ouvragesNext,
        updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      setAutoSaveStatus(error ? "error" : "saved");
      if (error) console.warn("PhasageV2 save:", error.message);
    }, 800);
  };

  const updateOuvrages = (next) => {
    setPhasage(p => ({ ...(p || { chantier_id: chantierId }), ouvrages: next }));
    scheduleSave(next);
  };

  // ─── CRUD OUVRAGES ──────────────────────────────────────────────────────
  const createOuvrage = (lotId) => {
    const newO = {
      id: rid(),
      libelle: "",
      lot_id: lotId === "_orphans" ? null : lotId,
      heures_devis: null,
      quantite: null,
      unite: "U",
      prix_ht: null,
      cout_materiaux: null,
      taches: [],
    };
    const next = [...ouvrages, newO];
    updateOuvrages(next);
    setSelectedOuvrageId(newO.id);
    // Ouvre directement la modale d'édition pour le nouveau
    setEditingOuvrageId(newO.id);
  };

  const updateOuvrage = (id, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === id ? { ...o, ...patch } : o));
  };

  // Déplace un ouvrage vers un lot (drag & drop). lotId === null => "Sans lot".
  const moveOuvrageToLot = (ouvrageId, lotId) => {
    const o = ouvrages.find(x => x.id === ouvrageId);
    if (!o || o.lot_id === lotId) return;
    updateOuvrage(ouvrageId, { lot_id: lotId });
  };

  const deleteOuvrage = (id) => {
    const o = ouvrages.find(x => x.id === id);
    if (!o) return;
    if (!window.confirm(`Supprimer l'ouvrage « ${o.libelle || "sans libellé"} » et toutes ses tâches ?`)) return;
    updateOuvrages(ouvrages.filter(x => x.id !== id));
    if (selectedOuvrageId === id) setSelectedOuvrageId(null);
  };

  // ─── CRUD TÂCHES ────────────────────────────────────────────────────────
  const createTache = (ouvrageId) => {
    const newT = { id: rid(), nom: "", heures_estimees: null, heures_reelles: null, avancement: 0, ouvriers: [] };
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: [...(o.taches || []), newT] }
      : o));
    setEditingTache({ ouvrageId, tacheId: newT.id });
  };

  // Toggle un ouvrier dans le tableau ouvriers d'une tâche (multi-select).
  const toggleOuvrier = (ouvrageId, tacheId, nom) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).map(t => {
          if (t.id !== tacheId) return t;
          const list = Array.isArray(t.ouvriers) ? [...t.ouvriers] : [];
          const idx = list.indexOf(nom);
          if (idx >= 0) list.splice(idx, 1); else list.push(nom);
          return { ...t, ouvriers: list };
        }) }
      : o));
  };

  // Initiales pour les badges ouvriers (2 lettres max).
  const initiales = (nom) => {
    if (!nom) return "?";
    const parts = String(nom).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  // Helper : extrait les heures réelles d'une tâche en gérant les anciens
  // formats de la v1 (qui pouvait stocker un tableau au lieu d'un nombre).
  const tacheHeuresReelles = (t) => {
    if (Array.isArray(t.heures_reelles)) {
      return t.heures_reelles.reduce((s, v) => s + (parseFloat(v) || 0), 0);
    }
    return parseFloat(t.heures_reelles) || 0;
  };
  // Couleur de dérive : vert si <= estimées, orange jusqu'à +20%, rouge au-delà.
  const couleurDerive = (reelles, estimees) => {
    if (!estimees || estimees <= 0) return null;
    const ratio = reelles / estimees;
    if (ratio <= 1)   return "#22c55e";
    if (ratio <= 1.2) return "#f5a623";
    return "#e15a5a";
  };

  // ─── COÛTS & MARGE ──────────────────────────────────────────────────────
  // Coût MO d'une tâche : pour chaque ouvrier assigné, on cumule
  // heures_reelles × son taux horaire. Si N ouvriers assignés, le coût total
  // est N × heures × taux_moyen — car on considère que chacun a travaillé
  // ces heures réelles en parallèle (lecture la plus fidèle pour un chantier).
  const coutMOTache = (t) => {
    const hr = tacheHeuresReelles(t);
    if (hr === 0) return 0;
    const ouvs = Array.isArray(t.ouvriers) ? t.ouvriers.filter(Boolean) : [];
    if (ouvs.length === 0) return 0;
    return ouvs.reduce((s, nom) => s + hr * (parseFloat(tauxHoraires?.[nom]) || 0), 0);
  };
  const coutMOOuvrage  = (o) => (o.taches || []).reduce((s, t) => s + coutMOTache(t), 0);
  const coutMOLot      = (lotId) => ouvragesDuLot(lotId).reduce((s, o) => s + coutMOOuvrage(o), 0);
  const coutMOChantier = ouvrages.reduce((s, o) => s + coutMOOuvrage(o), 0);

  // Prix HT (vendu) au niveau ouvrage / lot / chantier.
  const prixHTOuvrage  = (o) => parseFloat(o.prix_ht) || 0;
  const prixHTLot      = (lotId) => ouvragesDuLot(lotId).reduce((s, o) => s + prixHTOuvrage(o), 0);
  const prixHTChantier = ouvrages.reduce((s, o) => s + prixHTOuvrage(o), 0);

  // Coût matériaux par ouvrage (saisie manuelle dans la modale ouvrage).
  const coutMatOuvrage  = (o) => parseFloat(o.cout_materiaux) || 0;
  const coutMatChantier = ouvrages.reduce((s, o) => s + coutMatOuvrage(o), 0);
  // Heures totales : vendues (somme heures_devis des ouvrages) et réelles
  // (somme heures_reelles des tâches, gère le format tableau v1 via helper).
  const heuresVenduesChantier = ouvrages.reduce((s, o) => s + (parseFloat(o.heures_devis) || 0), 0);
  const heuresReellesChantier = ouvrages.reduce((s, o) => s + (o.taches || []).reduce((ss, t) => ss + tacheHeuresReelles(t), 0), 0);
  // Frais généraux = taux horaire × heures vendues (configurable dans Suivi
  // direction). On garde fg_pct en compat mais on privilégie fg_taux_horaire.
  const fgTauxHoraire = (() => {
    const v = parseFloat(phasage?.plan_travaux?.meta?.fg_taux_horaire);
    return Number.isFinite(v) ? v : 0;
  })();
  const fgChantier = fgTauxHoraire * heuresVenduesChantier;
  // Marge brute = Vendu − Coût MO − Coût matériaux − Frais généraux.
  const margeChantier  = prixHTChantier - coutMOChantier - coutMatChantier - fgChantier;
  const margePctChantier = prixHTChantier > 0 ? (margeChantier / prixHTChantier) * 100 : 0;
  const fmtEur = (n) => `${Math.round(n).toLocaleString("fr-FR")} €`;

  // ─── SUIVI DIRECTION (scalaires stockés dans plan_travaux.meta) ─────────
  // Compatibilité v1 : on lit/écrit dans phasage.plan_travaux.meta avec les
  // mêmes clés. La v1 PlanTravaux continue de fonctionner si on bascule.
  const meta = phasage?.plan_travaux?.meta || {};
  const margeCible  = parseFloat(meta.marge_vendue_cible) || 0;
  const seuilPrime  = parseFloat(meta.seuil_prime)        || 0;
  const primeChant  = parseFloat(meta.prime)              || 0;
  // Sauvegarde des meta dans plan_travaux. Le reste de plan_travaux est
  // conservé (les tâches v1 par phase, etc.).
  // CRITIQUE : on relit plan_travaux depuis la DB AVANT d'écrire, pas depuis
  // le state React. Sans sub realtime en V2, le state local peut être
  // périmé si V1 a modifié plan_travaux entretemps — et écrire l'ancien
  // state wiperait tout le travail V1 (incident du 2026-06-03).
  const saveMeta = async (patch) => {
    if (!chantierId) return;
    const p = await ensurePhasage();
    if (!p?.id) return;
    const { data: fresh, error: fetchErr } = await supabase.from("phasages")
      .select("plan_travaux").eq("id", p.id).maybeSingle();
    if (fetchErr) { console.warn("saveMeta fetch:", fetchErr.message); return; }
    const currentPlan = fresh?.plan_travaux || {};
    const newMeta = { ...(currentPlan.meta || {}), ...patch };
    const newPlan = { ...currentPlan, meta: newMeta };
    setPhasage(prev => ({ ...prev, plan_travaux: newPlan }));
    const { error } = await supabase.from("phasages").update({
      plan_travaux: newPlan, updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (error) console.warn("saveMeta:", error.message);
  };

  const updateTache = (ouvrageId, tacheId, patch) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).map(t => t.id === tacheId ? { ...t, ...patch } : t) }
      : o));
  };

  const deleteTache = (ouvrageId, tacheId) => {
    updateOuvrages(ouvrages.map(o => o.id === ouvrageId
      ? { ...o, taches: (o.taches || []).filter(t => t.id !== tacheId) }
      : o));
  };

  // ─── IMPORT DEVIS ───────────────────────────────────────────────────────
  const onFilePicked = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState({ items: [], unknownLotHeaders: [], parsing: true, error: null });
    try {
      const { items, unknownLotHeaders } = await parseDevisExcel(file, lots, bibliotheque);
      setImportState({ items, unknownLotHeaders, parsing: false, error: null });
    } catch (err) {
      console.error("Parsing devis:", err);
      setImportState({ items: [], unknownLotHeaders: [], parsing: false, error: err.message || "Impossible de lire le fichier." });
    }
    // Reset input pour permettre re-import du même fichier après cancel
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateImportItem = (key, patch) => {
    setImportState(s => ({ ...s, items: s.items.map(it => it._key === key ? { ...it, ...patch } : it) }));
  };
  const toggleAllImport = (val) => {
    setImportState(s => ({ ...s, items: s.items.map(it => ({ ...it, selectionne: val })) }));
  };

  const confirmImport = () => {
    if (!importState) return;
    const selected = importState.items.filter(it => it.selectionne);
    if (selected.length === 0) { setImportState(null); return; }
    const newOuvrages = selected.map(it => {
      // Heures estimées = cadence biblio × quantité (si dispo), sinon null.
      const cadence = parseFloat(it.match?.cadence) || null;
      const heuresEstimees = cadence && it.quantite ? parseFloat((cadence * it.quantite).toFixed(2)) : null;
      // Tâches : copies des sous_taches de la biblio. Le ratio de chaque
      // sous-tâche répartit les heures ESTIMÉES de l'ouvrage (pas les heures
      // vendues). Si l'ouvrage n'a pas d'heures estimées calculables (pas de
      // cadence ou pas de quantité), on laisse heures_estimees à null.
      const sousTaches = it.match?.sous_taches || [];
      const sumRatios = sousTaches.reduce((s, st) => s + (parseFloat(st.ratio) || 0), 0);
      const taches = sousTaches.map(st => {
        const ratio = parseFloat(st.ratio) || 0;
        const heuresTache = (heuresEstimees != null && sumRatios > 0 && ratio > 0)
          ? parseFloat(((heuresEstimees * ratio) / sumRatios).toFixed(2))
          : null;
        return {
          id: rid(),
          nom: st.nom || "",
          heures_estimees: heuresTache,
          avancement: 0,
        };
      });
      // Matériaux liés : copies des materiaux_liens de la biblio. Le coût
      // matériaux est auto-calculé = quantité_ouvrage × Σ(qté_par_unité × prix_unitaire).
      // Si l'utilisateur a déjà saisi manuellement un cout_materiaux, on ne l'écrase pas.
      const liens = (it.match?.materiaux_liens || [])
        .filter(ml => ml && ml.materiau_id != null)
        .map(ml => ({
          materiau_id: ml.materiau_id,
          quantite: ml.quantite == null ? null : parseFloat(ml.quantite),
        }));
      const qOuvrage = parseFloat(it.quantite) || 0;
      const coutMatParUnite = liens.reduce((s, ml) => {
        const m = materiauxBiblio.find(x => x.id === ml.materiau_id);
        if (!m || ml.quantite == null) return s;
        return s + (parseFloat(m.prix_unitaire) || 0) * (parseFloat(ml.quantite) || 0);
      }, 0);
      const coutMateriaux = qOuvrage > 0 && coutMatParUnite > 0
        ? parseFloat((qOuvrage * coutMatParUnite).toFixed(2))
        : null;
      return {
        id: rid(),
        libelle: it.libelle,
        lot_id: it.lot_id || null,
        heures_devis: it.heures,
        quantite: it.quantite,
        unite: it.unite || "U",
        prix_ht: it.prix_ht,
        heures_estimees: heuresEstimees,
        bibliotheque_id: it.match?.id || null,
        materiaux_liens: liens,
        ...(coutMateriaux != null ? { cout_materiaux: coutMateriaux } : {}),
        taches,
      };
    });
    updateOuvrages([...ouvrages, ...newOuvrages]);
    setImportState(null);
  };

  // Comptes pour les badges
  const countByLot = lots.reduce((acc, l) => {
    acc[l.id] = ouvrages.filter(o => o.lot_id === l.id).length;
    return acc;
  }, {});
  const orphans = ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id)).length;

  // ─── AVANCEMENT CALCULÉ ─────────────────────────────────────────────────
  // Ouvrage = moyenne des avancements de ses tâches, pondérée par heures_estimees.
  // Si aucune tâche n'a heures_estimees → moyenne simple. Si aucune tâche → 0.
  const avancementOuvrage = (ouvrage) => {
    const taches = ouvrage.taches || [];
    if (taches.length === 0) return 0;
    const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
    if (totalHE > 0) {
      return Math.round(
        taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0) * (parseFloat(t.heures_estimees) || 0), 0) / totalHE
      );
    }
    return Math.round(taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length);
  };
  // Détails de calcul (affichés en tooltip pour debug). Le ratio % d'avancement
  // multiplié par une charge (heures ou euros) donne la quantité ACCOMPLIE
  // dans la même unité. Ex : 10% × 10h = 1h faite, 50% × 8000€ = 4000€ vendus
  // accomplis. On affiche les valeurs avec leurs vraies unités, plus le ratio
  // final en pourcentage.
  const fmt1 = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
  const avancementOuvrageDetail = (ouvrage) => {
    const taches = ouvrage.taches || [];
    if (taches.length === 0) return "Aucune tâche";
    const totalHE = taches.reduce((s, t) => s + (parseFloat(t.heures_estimees) || 0), 0);
    if (totalHE > 0) {
      const lines = taches.map((t, i) => {
        const av = parseFloat(t.avancement) || 0;
        const h  = parseFloat(t.heures_estimees) || 0;
        const faites = (av / 100) * h;
        return `  ${i+1}. "${t.nom || "(sans nom)"}" : ${av}% × ${fmt1(h)}h = ${fmt1(faites)}h`;
      });
      const heuresFaites = taches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) / 100) * (parseFloat(t.heures_estimees) || 0), 0);
      return `Calcul pondéré par heures estimées :\n${lines.join("\n")}\n\nHeures faites = ${fmt1(heuresFaites)}h\nTotal heures = ${fmt1(totalHE)}h\n→ ${fmt1(heuresFaites)} / ${fmt1(totalHE)} = ${(heuresFaites/totalHE*100).toFixed(2)} %`;
    }
    const moy = taches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / taches.length;
    return `Aucune heure estimée — moyenne simple :\n${taches.map((t, i) => `  ${i+1}. "${t.nom || "(sans nom)"}" : ${parseFloat(t.avancement) || 0}%`).join("\n")}\n\n→ Moyenne = ${moy.toFixed(2)} %`;
  };
  const avancementLotDetail = (lotId) => {
    const lotOuvrages = ouvragesDuLot(lotId);
    if (lotOuvrages.length === 0) return "Aucun ouvrage dans ce lot";
    const totalPrix = lotOuvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      const lines = lotOuvrages.map((o, i) => {
        const a = avancementOuvrage(o);
        const p = parseFloat(o.prix_ht) || 0;
        const accompli = (a / 100) * p;
        return `  ${i+1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${a}% × ${p.toLocaleString("fr-FR")} € = ${accompli.toLocaleString("fr-FR")} €`;
      });
      const eurosAccomplis = lotOuvrages.reduce((s, o) => s + (avancementOuvrage(o) / 100) * (parseFloat(o.prix_ht) || 0), 0);
      return `Calcul pondéré par prix HT :\n${lines.join("\n")}\n\n€ accomplis = ${eurosAccomplis.toLocaleString("fr-FR")} €\nTotal prix HT = ${totalPrix.toLocaleString("fr-FR")} €\n→ ${eurosAccomplis.toLocaleString("fr-FR")} / ${totalPrix.toLocaleString("fr-FR")} = ${(eurosAccomplis/totalPrix*100).toFixed(2)} %`;
    }
    const moy = lotOuvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / lotOuvrages.length;
    return `Aucun prix HT renseigné — moyenne simple :\n${lotOuvrages.map((o, i) => `  ${i+1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${avancementOuvrage(o)}%`).join("\n")}\n\n→ Moyenne = ${moy.toFixed(2)} %`;
  };
  const avancementTacheDetail = (t) => {
    const av = parseFloat(t.avancement) || 0;
    const h  = parseFloat(t.heures_estimees);
    if (h != null && !isNaN(h)) {
      const faites = (av / 100) * h;
      return `Avancement saisi : ${av} %\nHeures estimées : ${fmt1(h)}h\nHeures faites : ${av}% × ${fmt1(h)}h = ${fmt1(faites)}h`;
    }
    return `Avancement saisi : ${av} %\n(Pas d'heures estimées)`;
  };
  // Lot = moyenne des avancements de ses ouvrages, pondérée par prix_ht. Si
  // aucun ouvrage n'a prix_ht → moyenne simple. Le pseudo-lot "_orphans"
  // agrège les ouvrages sans lot_id reconnu.
  const ouvragesDuLot = (lotId) => lotId === "_orphans"
    ? ouvrages.filter(o => !o.lot_id || !lots.some(l => l.id === o.lot_id))
    : ouvrages.filter(o => o.lot_id === lotId);
  const avancementLot = (lotId) => {
    const lotOuvrages = ouvragesDuLot(lotId);
    if (lotOuvrages.length === 0) return 0;
    const totalPrix = lotOuvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      return Math.round(
        lotOuvrages.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
      );
    }
    return Math.round(lotOuvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / lotOuvrages.length);
  };
  // Avancement global du chantier : moyenne de TOUS les ouvrages (lots
  // confondus), pondérée par prix_ht. Si aucun ouvrage n'a prix_ht →
  // moyenne simple. Sert pour la barre persistante en bas de page.
  const avancementChantier = (() => {
    if (ouvrages.length === 0) return 0;
    const totalPrix = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      return Math.round(
        ouvrages.reduce((s, o) => s + avancementOuvrage(o) * (parseFloat(o.prix_ht) || 0), 0) / totalPrix
      );
    }
    return Math.round(ouvrages.reduce((s, o) => s + avancementOuvrage(o), 0) / ouvrages.length);
  })();
  // Détail du calcul global (tooltip debug) — mêmes conventions d'unité que
  // les autres tooltips : avancement × prix = euros accomplis.
  const avancementChantierDetail = (() => {
    if (ouvrages.length === 0) return "Aucun ouvrage";
    const totalPrix = ouvrages.reduce((s, o) => s + (parseFloat(o.prix_ht) || 0), 0);
    if (totalPrix > 0) {
      const lines = ouvrages.map((o, i) => {
        const a = avancementOuvrage(o);
        const p = parseFloat(o.prix_ht) || 0;
        const accompli = (a / 100) * p;
        return `  ${i+1}. "${(o.libelle || "(sans libellé)").slice(0, 60)}" : ${a}% × ${p.toLocaleString("fr-FR")} € = ${accompli.toLocaleString("fr-FR")} €`;
      });
      const eurosAccomplis = ouvrages.reduce((s, o) => s + (avancementOuvrage(o) / 100) * (parseFloat(o.prix_ht) || 0), 0);
      return `Calcul pondéré par prix HT :\n${lines.join("\n")}\n\n€ accomplis = ${eurosAccomplis.toLocaleString("fr-FR")} €\nTotal prix HT = ${totalPrix.toLocaleString("fr-FR")} €\n→ ${eurosAccomplis.toLocaleString("fr-FR")} / ${totalPrix.toLocaleString("fr-FR")} = ${(eurosAccomplis/totalPrix*100).toFixed(2)} %`;
    }
    return "Aucun prix HT renseigné — moyenne simple des % des ouvrages";
  })();

  const ouvragesLot = selectedLotId
    ? ouvrages.filter(o => (selectedLotId === "_orphans"
        ? (!o.lot_id || !lots.some(l => l.id === o.lot_id))
        : o.lot_id === selectedLotId))
    : [];
  const selectedOuvrage = ouvrages.find(o => o.id === selectedOuvrageId) || null;
  const taches = selectedOuvrage?.taches || [];

  // ── Styles ──────────────────────────────────────────────────────────────
  const colHeader = {
    padding: "10px 14px",
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    display: "flex", alignItems: "center", gap: 8,
    fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
    color: T.textMuted,
    flexShrink: 0,
  };
  const colBody = { flex: 1, overflowY: "auto", padding: "10px 10px" };
  const emptyColMsg = (label) => (
    <div style={{ padding: 24, textAlign: "center", color: T.textMuted, fontSize: FONT.xs.size + 1, fontStyle: "italic" }}>
      {label}
    </div>
  );
  const addBtn = {
    marginLeft: "auto",
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 9px", borderRadius: RADIUS.sm + 2,
    border: "none", background: acc.accent, color: acc.onAccent,
    fontSize: 10, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase",
    cursor: "pointer", fontFamily: "inherit",
  };
  const iconBtnDanger = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 26, height: 26, borderRadius: RADIUS.sm,
    background: "transparent", border: `1px solid transparent`,
    color: "#e15a5a", cursor: "pointer",
    transition: "all .12s",
  };
  const inp = {
    padding: "6px 10px", borderRadius: RADIUS.md,
    border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
    color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit",
    outline: "none", width: "100%",
  };
  const lbl = {
    display: "block", fontSize: 9, fontWeight: 700, letterSpacing: .6,
    textTransform: "uppercase", color: T.textMuted, marginBottom: 4,
  };

  // ─── EXPORT PDF DU PHASAGE ──────────────────────────────────────────────
  // Pipeline window.print() : le navigateur fait une vraie pagination texte
  // (pas de rastérisation comme html2pdf) → coupures de page propres et
  // qualité d'impression nette. Même approche que le Bilan semaine et le
  // Compte rendu client.
  const buildRapportHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = chantier?.nom || chantierId;

    // ── Bandeau en-tête (table-layout pour rendu prévisible)
    const kpiCell = (val, label, color) => `
      <td style="padding:10pt 12pt;vertical-align:middle;text-align:center;border-left:1pt solid rgba(255,255,255,.12);white-space:nowrap;">
        <div style="color:${color};font-size:13pt;font-weight:800;line-height:1;">${val}</div>
        <div style="color:rgba(255,255,255,.55);font-size:7pt;letter-spacing:.08em;text-transform:uppercase;margin-top:3pt;">${label}</div>
      </td>`;

    // ── Carte ouvrage
    const ouvrageHTML = (o, lotColor) => {
      const taches = o.taches || [];
      const av = avancementOuvrage(o);
      const avColor = av >= 100 ? "#22c55e" : lotColor;
      const ouvragesInfos = [];
      if (o.heures_devis) ouvragesInfos.push(`${o.heures_devis}h`);
      if (o.quantite)     ouvragesInfos.push(`${o.quantite} ${o.unite || ""}`);
      if (o.prix_ht)      ouvragesInfos.push(`${o.prix_ht.toLocaleString("fr-FR")} €`);
      const tachesHTML = taches.length === 0 ? "" : `
        <ul style="margin:4pt 0 0;padding:0 0 0 14pt;list-style:none;">
          ${taches.map(t => {
            const tav = parseInt(t.avancement) || 0;
            const tavColor = tav >= 100 ? "#22c55e" : "#666";
            const hr = tacheHeuresReelles(t);
            const he = parseFloat(t.heures_estimees);
            const heuresStr = (hr > 0 || (he != null && !isNaN(he)))
              ? ` <span style="color:#888;font-size:8.5pt;">(${hr || 0}h/${he != null && !isNaN(he) ? `${he}h` : "—"})</span>`
              : "";
            const ouvriersStr = Array.isArray(t.ouvriers) && t.ouvriers.length > 0
              ? ` <span style="color:#5b8af5;font-size:8.5pt;font-weight:600;">${t.ouvriers.map(esc).join(", ")}</span>`
              : "";
            const dateStr = t.date_prevue ? ` <span style="color:#999;font-size:8pt;">📅 ${new Date(t.date_prevue).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}</span>` : "";
            return `<li style="font-size:9pt;color:#222;padding:2pt 0;break-inside:avoid;page-break-inside:avoid;">
              <span style="color:${tavColor};font-weight:800;display:inline-block;width:32pt;">${tav}%</span>
              <span>${esc(t.nom || "(sans nom)")}</span>${heuresStr}${ouvriersStr}${dateStr}
            </li>`;
          }).join("")}
        </ul>`;
      return `
        <div class="ouvrage" style="border:1pt solid #e0e0e0;border-left:4pt solid ${lotColor};margin:0 0 8pt;padding:8pt 12pt;break-inside:avoid;page-break-inside:avoid;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8pt;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:800;font-size:10pt;color:#1a1f2e;">${esc(o.libelle || "(sans libellé)")}</div>
              ${ouvragesInfos.length > 0 ? `<div style="font-size:8.5pt;color:#666;margin-top:2pt;">${ouvragesInfos.join(" · ")}</div>` : ""}
            </div>
            <div style="text-align:right;white-space:nowrap;">
              <span style="font-size:11pt;font-weight:800;color:${avColor};">${av}%</span>
            </div>
          </div>
          ${tachesHTML}
        </div>`;
    };

    // ── Sections par lot
    const lotsAvecOuvrages = lots
      .map(l => ({ ...l, _ouvrages: ouvragesDuLot(l.id) }))
      .filter(l => l._ouvrages.length > 0);
    const orphansList = ouvragesDuLot("_orphans");

    const lotSection = (lotLabel, lotColor, codePrefix, lotOuvrages, av) => `
      <section style="margin:0 0 14pt;">
        <div class="lot-header" style="background:color-mix(in srgb, ${lotColor} 18%, transparent);border-left:5pt solid ${lotColor};padding:8pt 12pt;margin:0 0 6pt;display:flex;align-items:center;justify-content:space-between;break-inside:avoid;page-break-inside:avoid;page-break-after:avoid;">
          <div style="display:flex;align-items:center;gap:10pt;">
            <span style="font-size:13pt;font-weight:800;color:#1a1f2e;letter-spacing:.3pt;text-transform:uppercase;">${esc(lotLabel)}</span>
            ${codePrefix ? `<span style="font-size:8pt;font-weight:700;letter-spacing:.5pt;color:#444;background:rgba(0,0,0,.06);padding:1pt 6pt;border-radius:3pt;">${esc(codePrefix)}</span>` : ""}
            <span style="font-size:8pt;color:#666;">${lotOuvrages.length} ouvrage${lotOuvrages.length>1?"s":""}</span>
          </div>
          <span style="font-size:12pt;font-weight:800;color:${av >= 100 ? "#22c55e" : lotColor};">${av}%</span>
        </div>
        ${lotOuvrages.map(o => ouvrageHTML(o, lotColor)).join("")}
      </section>`;

    const sectionsHTML = lotsAvecOuvrages.map(l =>
      lotSection(l.label, l.couleur, l.code_prefixe, l._ouvrages, avancementLot(l.id))
    ).join("");
    const orphansHTML = orphansList.length > 0
      ? lotSection("Sans lot", "#888888", "", orphansList, avancementLot("_orphans"))
      : "";

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Phasage ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#1a1f2e;font-size:10pt;line-height:1.4;}
  .page{max-width:780pt;margin:0 auto;}
  .ouvrage, .lot-header, ul, li { break-inside: avoid; page-break-inside: avoid; }
  .lot-header { page-break-after: avoid; }
  @page{margin:14mm 12mm 16mm;size:A4;}
  @page {
    @bottom-left   { content: "Profero Rénovation"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body><div class="page">
  <table style="width:100%;border-collapse:collapse;background:#0a0a0a;margin:0 0 14pt;">
    <tr>
      <td style="padding:12pt 16pt;vertical-align:middle;width:80pt;">
        <img src="${logoUrl}" alt="Profero" style="height:30pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:12pt 8pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:7pt;font-weight:700;letter-spacing:1.4pt;text-transform:uppercase;">Phasage chantier</div>
        <div style="color:#fff;font-size:15pt;font-weight:800;margin-top:2pt;line-height:1.1;">${esc(titre)}</div>
        <div style="color:rgba(255,255,255,.5);font-size:8pt;margin-top:3pt;">Édité le ${dateGen}</div>
      </td>
      ${kpiCell(`${avancementChantier}%`, "Avancement", avancementChantier >= 100 ? "#50c878" : "#f5c400")}
      ${kpiCell(`${heuresReellesChantier.toFixed(0)}h / ${heuresVenduesChantier.toFixed(0)}h`, "Heures", "#5b9cf6")}
      ${kpiCell(`${Math.round(prixHTChantier).toLocaleString("fr-FR")} €`, "Vendu", "#f5c400")}
      ${kpiCell(`${Math.round(coutMOChantier).toLocaleString("fr-FR")} €`, "Coût MO", "#60a5fa")}
      ${kpiCell(`${Math.round(coutMatChantier).toLocaleString("fr-FR")} €`, "Matériaux", "#f97316")}
      ${kpiCell(`${Math.round(fgChantier).toLocaleString("fr-FR")} €`, `FG ${fgTauxHoraire ? fgTauxHoraire+"€/h" : ""}`, "#a78bfa")}
      ${kpiCell(`${margeChantier >= 0 ? "+" : ""}${Math.round(margeChantier).toLocaleString("fr-FR")} €`,
        `Marge ${prixHTChantier > 0 ? margePctChantier.toFixed(0) + "%" : ""}`,
        margeChantier >= 0 ? "#50c878" : "#ff6b6b")}
    </tr>
  </table>
  ${sectionsHTML || `<div style="text-align:center;padding:40pt;color:#999;">Aucun ouvrage dans ce phasage.</div>`}
  ${orphansHTML}
</div></body></html>`;
  };

  const exportRapportPDF = () => {
    try {
      const html = buildRapportHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Phasage-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
  };

  // ─── EXPORT PDF DE LA VUE GANTT ─────────────────────────────────────────
  // Landscape A4 avec table : 1 colonne label + 1fr × N jours. Pour chaque
  // tâche, on colore les cellules de date_prevue jusqu'à +durée jours
  // ouvrés. Le label de la tâche se met dans la 1re cellule colorée.
  const buildGanttHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;
    const dateGen = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
    const titre = chantier?.nom || chantierId;

    // Helpers dates (mêmes règles que GanttV2)
    const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
    const addDays    = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
    const isWeekend  = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
    const parseDate  = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
    const isoDay     = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const todayISO   = isoDay(startOfDay(new Date()));

    // Construit les rows
    const rows = [];
    const orphans = [];
    ouvrages.forEach(o => {
      const lot = lots.find(l => l.id === o.lot_id) || { id: "_x", label: "Sans lot", couleur: "#888" };
      (o.taches || []).forEach(t => {
        const d = parseDate(t.date_prevue);
        if (d) rows.push({ lot, ouvrage: o, tache: t, date: d });
        else   orphans.push({ lot, ouvrage: o, tache: t });
      });
    });

    if (rows.length === 0) {
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Gantt ${esc(titre)}</title></head><body style="font-family:Arial;padding:40pt;text-align:center;color:#666;">Aucune tâche planifiée pour ce chantier.</body></html>`;
    }

    // Plage de dates
    const dates = rows.map(r => r.date);
    let dateMin = new Date(Math.min(...dates.map(d => d.getTime())));
    let dateMax = new Date(Math.max(...dates.map(d => d.getTime())));
    dateMin = addDays(dateMin, -2);
    dateMax = addDays(dateMax, 10);
    const days = [];
    for (let d = startOfDay(dateMin); d <= dateMax; d = addDays(d, 1)) {
      if (!isWeekend(d)) days.push(new Date(d));
    }
    const dayIndex = (d) => {
      const target = isoDay(d);
      return days.findIndex(x => isoDay(x) === target);
    };
    const dureeJours = (t) => {
      const h = parseFloat(t.heures_estimees);
      if (!h || isNaN(h) || h <= 0) return 1;
      return Math.max(1, Math.ceil(h / 7));
    };

    // Mois pour l'en-tête (rowspans en colspan ici)
    const monthsHeader = [];
    let lastMonthKey = "";
    days.forEach((d) => {
      const k = `${d.getFullYear()}-${d.getMonth()}`;
      if (k !== lastMonthKey) {
        monthsHeader.push({ label: d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }), span: 1 });
        lastMonthKey = k;
      } else {
        monthsHeader[monthsHeader.length - 1].span += 1;
      }
    });

    // Tri des rows
    rows.sort((a, b) => {
      if (a.lot.id !== b.lot.id) return a.lot.id.localeCompare(b.lot.id);
      if (a.ouvrage.id !== b.ouvrage.id) return (a.ouvrage.libelle || "").localeCompare(b.ouvrage.libelle || "");
      return a.date.getTime() - b.date.getTime();
    });

    // Build les lignes regroupées par lot
    let html = "";
    let lastLotId = null;
    rows.forEach((r) => {
      if (r.lot.id !== lastLotId) {
        html += `<tr class="lot-row" style="background:color-mix(in srgb, ${r.lot.couleur} 18%, #fff);">
          <td colspan="${days.length + 1}" style="padding:5pt 8pt;font-size:8pt;font-weight:800;letter-spacing:.5pt;text-transform:uppercase;color:#1a1f2e;border-top:1pt solid #ccc;border-bottom:1pt solid #ccc;">
            <span style="display:inline-block;width:9pt;height:9pt;background:${r.lot.couleur};border-radius:2pt;vertical-align:middle;margin-right:6pt;"></span>
            ${esc(r.lot.label)}
          </td>
        </tr>`;
        lastLotId = r.lot.id;
      }
      const startIdx = dayIndex(r.date);
      const spanDays = Math.min(days.length - Math.max(0, startIdx), dureeJours(r.tache));
      const av = Math.max(0, Math.min(100, parseInt(r.tache.avancement) || 0));
      const barColor = av >= 100 ? "#22c55e" : r.lot.couleur;
      const cells = days.map((d, i) => {
        const inBar = startIdx >= 0 && i >= startIdx && i < startIdx + spanDays;
        const isFirst = inBar && i === startIdx;
        const today = isoDay(d) === todayISO;
        const bg = inBar
          ? `color-mix(in srgb, ${barColor} 70%, transparent)`
          : (today ? "#fff4b8" : "transparent");
        return `<td style="border-right:0.5pt solid #eee;padding:0;height:18pt;background:${bg};font-size:7pt;color:#000;overflow:hidden;white-space:nowrap;">
          ${isFirst ? `<div style="padding:0 4pt;font-weight:700;overflow:hidden;text-overflow:ellipsis;">${esc((r.tache.nom || "").slice(0, 40))}${av > 0 ? ` · ${av}%` : ""}</div>` : ""}
        </td>`;
      }).join("");
      html += `<tr style="break-inside:avoid;page-break-inside:avoid;">
        <td style="padding:4pt 8pt;border-right:1pt solid #ccc;border-bottom:0.5pt solid #eee;font-size:8pt;color:#1a1f2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140pt;">
          <div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;">${esc(r.tache.nom || "(sans nom)")}</div>
          <div style="font-size:7pt;color:#888;overflow:hidden;text-overflow:ellipsis;">${esc(r.ouvrage.libelle || "")}</div>
        </td>
        ${cells}
      </tr>`;
    });

    // En-têtes : mois + jours
    const monthHeaders = monthsHeader.map(m =>
      `<th colspan="${m.span}" style="border-right:1pt solid #ccc;border-bottom:0.5pt solid #ccc;padding:3pt 5pt;font-size:7.5pt;font-weight:700;text-transform:capitalize;color:#444;background:#fafafa;">${esc(m.label)}</th>`
    ).join("");
    const dayHeaders = days.map(d => {
      const today = isoDay(d) === todayISO;
      return `<th style="border-right:0.5pt solid #eee;padding:2pt 0;font-size:6.5pt;font-weight:${today ? 800 : 600};color:${today ? "#9a7a00" : "#666"};background:${today ? "#fff4b8" : "#fafafa"};text-align:center;">${d.getDate()}</th>`;
    }).join("");

    const orphansHTML = orphans.length === 0 ? "" : `
      <div style="margin-top:14pt;padding:8pt 12pt;background:#fff8dc;border:1pt dashed #d4a017;border-radius:4pt;break-inside:avoid;">
        <div style="font-size:8pt;font-weight:700;color:#9a7a00;letter-spacing:.4pt;text-transform:uppercase;margin-bottom:6pt;">Tâches non planifiées (${orphans.length})</div>
        <ul style="margin:0;padding:0 0 0 14pt;font-size:8pt;color:#333;">
          ${orphans.map(r => `<li style="margin-bottom:2pt;">${esc(r.tache.nom || "(sans nom)")} <span style="color:#888;">— ${esc(r.ouvrage.libelle || "")}</span></li>`).join("")}
        </ul>
      </div>`;

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Gantt ${esc(titre)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;color:#1a1f2e;font-size:9pt;}
  table{border-collapse:collapse;table-layout:fixed;width:100%;}
  th,td{vertical-align:middle;}
  thead{display:table-header-group;}
  tbody{display:table-row-group;}
  @page{size:A4 landscape;margin:8mm;}
  @page {
    @bottom-left   { content: "Profero Rénovation — Gantt"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-center { content: "${esc(titre)}"; font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #999; font-family: Arial, sans-serif; }
  }
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
</style></head><body>
  <table style="margin-bottom:10pt;width:100%;border-collapse:collapse;background:#0a0a0a;">
    <tr>
      <td style="padding:8pt 12pt;vertical-align:middle;width:60pt;">
        <img src="${logoUrl}" alt="Profero" style="height:24pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:8pt 6pt;vertical-align:middle;white-space:nowrap;">
        <div style="color:#f5c400;font-size:6.5pt;font-weight:700;letter-spacing:1.2pt;text-transform:uppercase;">Gantt chantier</div>
        <div style="color:#fff;font-size:12pt;font-weight:800;line-height:1.1;margin-top:1pt;">${esc(titre)}</div>
      </td>
      <td style="padding:8pt 10pt;vertical-align:middle;text-align:right;color:rgba(255,255,255,.7);font-size:8pt;white-space:nowrap;">
        ${rows.length} tâche${rows.length>1?"s":""} planifiée${rows.length>1?"s":""} · Édité le ${dateGen}
      </td>
    </tr>
  </table>
  <table>
    <colgroup>
      <col style="width:140pt;"/>
      ${days.map(() => `<col/>`).join("")}
    </colgroup>
    <thead>
      <tr>
        <th rowspan="2" style="border-right:1pt solid #ccc;border-bottom:1pt solid #ccc;background:#fafafa;padding:4pt 8pt;font-size:7.5pt;font-weight:800;letter-spacing:.4pt;text-transform:uppercase;color:#444;text-align:left;">Tâche / Ouvrage</th>
        ${monthHeaders}
      </tr>
      <tr>${dayHeaders}</tr>
    </thead>
    <tbody>
      ${html}
    </tbody>
  </table>
  ${orphansHTML}
</body></html>`;
  };

  const exportGanttPDF = () => {
    try {
      const html = buildGanttHTML();
      const w = window.open("", "_blank", "width=1100,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Gantt-${chantier?.nom || chantierId}`;
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF Gantt : " + (e.message || e));
    }
  };

  // ── Statut sauvegarde ──
  const statusColor = autoSaveStatus === "saved"  ? "#22c55e"
                    : autoSaveStatus === "saving" ? acc.accent
                    : autoSaveStatus === "error"  ? "#e15a5a"
                    : "#f5a623";
  const statusLbl = autoSaveStatus === "saved"  ? "Sauvegardé"
                  : autoSaveStatus === "saving" ? "Sauvegarde…"
                  : autoSaveStatus === "error"  ? "Erreur"
                  : "Modif en cours";

  const noChantier = !chantierId;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: T.bg, overflow: "hidden" }}>
      {/* CSS bubbles — couleur de chaque bulle = --bubble-color (var inline). */}
      <style>{`
        .p2-bubble {
          --c: var(--bubble-color, #888);
          /* --av : 0% par défaut. Surchargé inline sur les bulles tâches
             avec le % d'avancement. Le linear-gradient crée une vraie
             barre de progression à l'intérieur de la bulle : la partie
             gauche (jusqu'à --av) est saturée, la droite reste discrète. */
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 45%, transparent) 0,
            color-mix(in srgb, var(--c) 45%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 10%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 10%, transparent) 100%
          );
          border: 1px solid color-mix(in srgb, var(--c) 25%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 11px 14px;
          margin: 8px 4px;
          cursor: pointer;
          color: ${T.text};
          font-size: ${FONT.sm.size}px;
          transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease;
          will-change: transform;
        }
        .p2-bubble:hover {
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 60%, transparent) 0,
            color-mix(in srgb, var(--c) 60%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) 100%
          );
          border-color: color-mix(in srgb, var(--c) 55%, transparent);
          transform: scale(1.02);
          box-shadow: 0 6px 18px color-mix(in srgb, var(--c) 28%, transparent);
        }
        .p2-bubble.active {
          background: linear-gradient(to right,
            color-mix(in srgb, var(--c) 55%, transparent) 0,
            color-mix(in srgb, var(--c) 55%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) var(--av, 0%),
            color-mix(in srgb, var(--c) 22%, transparent) 100%
          );
          border-color: var(--c);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--c) 32%, transparent);
        }
        .p2-bubble-form {
          background: color-mix(in srgb, var(--c) 14%, transparent);
          border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
          border-left: 4px solid var(--c);
          border-radius: 12px;
          padding: 14px 16px;
          margin: 8px 4px;
          box-shadow: 0 4px 16px color-mix(in srgb, var(--c) 18%, transparent);
        }
        .p2-edit-btn:hover {
          background: var(--c) !important;
          border-color: var(--c) !important;
          color: #000 !important;
        }
        /* Bulle tâche : un panneau d'accès rapide se déplie au hover,
           permettant d'éditer heures réelles + ouvriers sans ouvrir la modale.
           Tout est en CSS pour rester fluide (pas de state React qui flicker). */
        .p2-tache-expand {
          max-height: 0;
          opacity: 0;
          overflow: hidden;
          transition: max-height .22s ease, opacity .15s ease, margin-top .22s ease, padding .22s ease;
          margin-top: 0;
          padding-top: 0;
        }
        .p2-bubble:hover .p2-tache-expand {
          max-height: 220px;
          opacity: 1;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
        }
        .p2-mini-chip {
          padding: 3px 9px;
          border-radius: 99px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
          border: 1px solid ${T.border};
          background: rgba(255,255,255,0.04);
          color: ${T.textSub};
          transition: all .12s;
        }
        .p2-mini-chip.sel {
          background: color-mix(in srgb, var(--c) 30%, transparent);
          border-color: var(--c);
          color: ${T.text};
        }
        .p2-mini-chip:hover {
          background: color-mix(in srgb, var(--c) 20%, transparent);
        }
      `}</style>

      {/* ── Header avec sélecteur chantier ── */}
      <div style={{
        padding: "14px 22px", borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: RADIUS.md, flexShrink: 0,
          background: acc.bg10, color: acc.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={ListChecks} size={18} strokeWidth={2}/>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>Phasage</div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: acc.bg10, color: acc.accent, border: `1px solid ${acc.border}`,
            borderRadius: RADIUS.pill, padding: "2px 9px",
            fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
          }}>
            <Icon as={Sparkles} size={10}/>
            V2
          </span>
        </div>

        {/* Badge statut sauvegarde — visible seulement si on a un chantier ouvert */}
        {chantierId && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 9, fontWeight: 700, letterSpacing: .6, textTransform: "uppercase",
            color: statusColor, background: statusColor + "18", border: `1px solid ${statusColor}40`,
            borderRadius: 99, padding: "2px 8px",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor }}/>
            {statusLbl}
          </span>
        )}

        {/* Boutons d'action chantier */}
        {chantierId && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFilePicked} style={{ display: "none" }}/>
            {/* Toggle Liste / Gantt */}
            <div style={{
              marginLeft: "auto",
              display: "inline-flex", borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`, background: T.card, overflow: "hidden",
            }}>
              {[
                { id: "list",  icon: LayoutGrid,         label: "Liste" },
                { id: "gantt", icon: GanttChartSquare,   label: "Gantt" },
              ].map(opt => {
                const active = viewMode === opt.id;
                return (
                  <button key={opt.id} onClick={() => setViewMode(opt.id)}
                    title={opt.label}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "7px 12px", border: "none",
                      background: active ? acc.bg10 : "transparent",
                      color: active ? acc.accent : T.textSub,
                      fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                      cursor: "pointer", transition: "all .12s",
                    }}>
                    <Icon as={opt.icon} size={13}/>
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <button onClick={viewMode === "gantt" ? exportGanttPDF : exportRapportPDF}
              title={viewMode === "gantt" ? "Exporter le Gantt en PDF (paysage)" : "Exporter le phasage en PDF"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
                transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = acc.accent; e.currentTarget.style.borderColor = acc.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border; }}>
              <Icon as={FileDown} size={14}/>
              PDF {viewMode === "gantt" ? "Gantt" : ""}
            </button>
            <button onClick={() => setShowSuiviDirection(true)} title="Suivi direction (marge cible, prime)"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 36, height: 36, borderRadius: RADIUS.md,
                border: `1px solid ${T.border}`, background: T.card, color: T.textSub,
                cursor: "pointer", transition: "all .12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = acc.accent; e.currentTarget.style.borderColor = acc.border; }}
              onMouseLeave={e => { e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border; }}>
              <Icon as={Settings} size={14}/>
            </button>
            <button onClick={() => fileInputRef.current?.click()} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={FileSpreadsheet} size={14}/>
              Importer un devis
            </button>
          </>
        )}

        {/* Sélecteur chantier */}
        <div style={{ position: "relative", marginLeft: chantierId ? 0 : "auto", minWidth: 240 }}>
          <Icon as={Building2} size={13} color={T.textMuted}
            style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
          <select
            value={chantierId}
            onChange={e => setChantierId(e.target.value)}
            style={{
              width: "100%",
              appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
              padding: "9px 32px 9px 32px",
              borderRadius: RADIUS.md,
              border: `1px solid ${T.border}`,
              background: T.fieldBg || T.card,
              color: chantierId ? T.text : T.textMuted,
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 600,
              outline: "none", cursor: "pointer",
            }}>
            <option value="">— Sélectionner un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
          <Icon as={ChevronDown} size={13} color={T.textMuted}
            style={{ position: "absolute", right: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}/>
        </div>
      </div>

      {/* ── Sous-header chantier (KPI + barre d'avancement, persistant) ── */}
      {chantierId && !loadingPhasage && ouvrages.length > 0 && (() => {
        const margeColor = margeChantier < 0 ? "#e15a5a"
                         : margePctChantier < 15 ? "#f5a623"
                         : "#22c55e";
        return (
          <div style={{
            flexShrink: 0,
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
            padding: "10px 22px 12px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}>
              <KpiCard T={T} icon={Banknote} iconColor="#f5c400" label="Vendu HT"
                value={fmtEur(prixHTChantier)}
                sub={`${ouvrages.length} ouvrage${ouvrages.length > 1 ? "s" : ""}`}/>
              <KpiCard T={T} icon={Clock} iconColor="#5b9cf6" label="Heures totales"
                value={`${heuresReellesChantier.toFixed(0)}h / ${heuresVenduesChantier.toFixed(0)}h`}
                sub={heuresVenduesChantier > 0 ? `${Math.round((heuresReellesChantier / heuresVenduesChantier) * 100)}% consommées` : "réelles / vendues"}
                accent={couleurDerive(heuresReellesChantier, heuresVenduesChantier)}/>
              <KpiCard T={T} icon={HardHat} iconColor="#60a5fa" label="Coût MO"
                value={fmtEur(coutMOChantier)}
                sub="Heures réelles × taux"
                accent={coutMOChantier > prixHTChantier && prixHTChantier > 0 ? "#e15a5a" : null}/>
              <KpiCard T={T} icon={Receipt} iconColor="#f97316" label="Matériaux"
                value={fmtEur(coutMatChantier)}
                sub="Saisis par ouvrage"/>
              <KpiCard T={T} icon={Percent} iconColor="#a78bfa" label="Frais généraux"
                value={fmtEur(fgChantier)}
                sub={fgTauxHoraire > 0 ? `${fgTauxHoraire}€/h × ${heuresVenduesChantier.toFixed(0)}h` : "0 — à régler"}/>
              <KpiCard T={T}
                icon={margeChantier >= 0 ? TrendingUp : TrendingDown}
                iconColor={margeColor} label="Marge brute"
                value={`${margeChantier >= 0 ? "+" : ""}${fmtEur(margeChantier)}`}
                sub={prixHTChantier > 0 ? `${margePctChantier.toFixed(1)}% du vendu` : null}
                accent={margeColor} bold={true}/>
              {(margeCible > 0 || primeChant > 0) && (
                <KpiCibleEtPrime T={T}
                  margeCible={margeCible} margePct={margePctChantier}
                  prime={primeChant} seuilPrime={seuilPrime}
                  prixHT={prixHTChantier}/>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textMuted,
                letterSpacing: .6, textTransform: "uppercase", whiteSpace: "nowrap",
              }}>
                Avancement
              </div>
              <div title={avancementChantierDetail}
                style={{
                  flex: 1, position: "relative", height: 18,
                  background: "rgba(255,255,255,0.06)", borderRadius: 9,
                  overflow: "hidden", cursor: "help",
                  border: `1px solid ${T.border}`,
                }}>
                <div style={{
                  width: `${Math.min(100, avancementChantier)}%`, height: "100%",
                  background: avancementChantier >= 100
                    ? "linear-gradient(90deg, #16a34a, #22c55e)"
                    : `linear-gradient(90deg, color-mix(in srgb, ${acc.accent} 80%, transparent), ${acc.accent})`,
                  transition: "width .4s ease",
                  boxShadow: avancementChantier > 0 ? `0 0 8px color-mix(in srgb, ${acc.accent} 50%, transparent)` : "none",
                }}/>
              </div>
              <div style={{
                fontSize: FONT.lg.size, fontWeight: 800,
                color: avancementChantier >= 100 ? "#22c55e" : T.text,
                minWidth: 54, textAlign: "right",
                letterSpacing: -.3,
              }}>
                {avancementChantier}%
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Body 3 colonnes ── */}
      {noChantier ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{
            background: T.card, border: `1px dashed ${T.border}`,
            borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
            maxWidth: 460, color: T.textMuted,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: RADIUS.lg,
              background: acc.bg10, color: acc.accent,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
            }}>
              <Icon as={Building2} size={26} strokeWidth={1.5}/>
            </div>
            <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
              Choisis un chantier
            </div>
            <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6 }}>
              Sélectionne un chantier en haut à droite pour afficher ses lots, ouvrages et tâches.
            </div>
          </div>
        </div>
      ) : loadingPhasage ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
          Chargement du phasage…
        </div>
      ) : viewMode === "gantt" ? (
        <GanttV2
          ouvrages={ouvrages} lots={lots} acc={acc} T={T}
          avancementOuvrage={avancementOuvrage}
          tacheHeuresReelles={tacheHeuresReelles}
          onClickTache={(ouvrageId, tacheId) => setEditingTache({ ouvrageId, tacheId })}
        />
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "260px minmax(0, 1fr) minmax(0, 1.2fr)", minHeight: 0 }}>
          {/* ── Colonne 1 : Lots ── */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}><Icon as={Boxes} size={12}/> Lots</div>
            <div style={colBody}>
              {lots.map(l => {
                const active = selectedLotId === l.id;
                const count = countByLot[l.id] || 0;
                const av = count > 0 ? avancementLot(l.id) : 0;
                const bubbleColor = av >= 100 ? "#22c55e" : l.couleur;
                return (
                  <div key={l.id} className={`p2-bubble ${active ? "active" : ""}`}
                    style={{ "--bubble-color": bubbleColor, "--av": `${av}%`,
                      display: "flex", alignItems: "center", gap: 10,
                      outline: dragOverLotId === l.id ? `2px dashed ${l.couleur}` : "none",
                      outlineOffset: 2 }}
                    onClick={() => { setSelectedLotId(l.id); setSelectedOuvrageId(null); }}
                    onDragOver={draggedOuvrageId ? (e => { e.preventDefault(); if (dragOverLotId !== l.id) setDragOverLotId(l.id); }) : undefined}
                    onDragLeave={() => { if (dragOverLotId === l.id) setDragOverLotId(null); }}
                    onDrop={draggedOuvrageId ? (e => { e.preventDefault(); moveOuvrageToLot(draggedOuvrageId, l.id); setDraggedOuvrageId(null); setDragOverLotId(null); }) : undefined}>
                    <span style={{ flex: 1, fontWeight: 700, color: T.text }}>{l.label}</span>
                    {l.code_prefixe && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: .5,
                        padding: "1px 6px", borderRadius: RADIUS.sm,
                        background: "rgba(255,255,255,0.10)", color: T.text, opacity: .65,
                      }}>{l.code_prefixe}</span>
                    )}
                    {count > 0 && (
                      <>
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: "2px 8px",
                          borderRadius: RADIUS.pill,
                          background: "rgba(0,0,0,0.18)", color: T.text,
                        }}>{count}</span>
                        <span title={avancementLotDetail(l.id)}
                          style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                          {av}%
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
              {orphans > 0 && (() => {
                const av = avancementLot("_orphans");
                const bubbleColor = av >= 100 ? "#22c55e" : T.textMuted;
                return (
                  <div className={`p2-bubble ${selectedLotId === "_orphans" ? "active" : ""}`}
                    style={{ "--bubble-color": bubbleColor, "--av": `${av}%`, marginTop: 14,
                      display: "flex", alignItems: "center", gap: 10, opacity: .85,
                      outline: dragOverLotId === "_orphans" ? "2px dashed #888888" : "none",
                      outlineOffset: 2 }}
                    onClick={() => { setSelectedLotId("_orphans"); setSelectedOuvrageId(null); }}
                    onDragOver={draggedOuvrageId ? (e => { e.preventDefault(); if (dragOverLotId !== "_orphans") setDragOverLotId("_orphans"); }) : undefined}
                    onDragLeave={() => { if (dragOverLotId === "_orphans") setDragOverLotId(null); }}
                    onDrop={draggedOuvrageId ? (e => { e.preventDefault(); moveOuvrageToLot(draggedOuvrageId, null); setDraggedOuvrageId(null); setDragOverLotId(null); }) : undefined}>
                    <span style={{ flex: 1, fontStyle: "italic", color: T.textMuted, fontWeight: 600 }}>Sans lot</span>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 8px",
                      borderRadius: RADIUS.pill, background: "rgba(0,0,0,0.18)", color: T.text,
                    }}>{orphans}</span>
                    <span title={avancementLotDetail("_orphans")}
                      style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                      {av}%
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Colonne 2 : Ouvrages ── */}
          <div style={{ display: "flex", flexDirection: "column", borderRight: `1px solid ${T.border}`, minHeight: 0 }}>
            <div style={colHeader}>
              <Icon as={Hammer} size={12}/> Ouvrages
              {selectedLotId && (
                <>
                  {ouvragesLot.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{ouvragesLot.length}</span>
                  )}
                  <button onClick={() => createOuvrage(selectedLotId)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Ouvrage
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedLotId
                ? emptyColMsg("Sélectionne un lot à gauche")
                : ouvragesLot.length === 0
                  ? emptyColMsg("Aucun ouvrage pour ce lot — clique « + Ouvrage »")
                  : ouvragesLot.map(o => {
                    const active = selectedOuvrageId === o.id;
                    const nbTaches = (o.taches || []).length;
                    const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
                    const av = nbTaches > 0 ? avancementOuvrage(o) : 0;
                    const bubbleColor = av >= 100 ? "#22c55e" : lotColor;
                    return (
                      <div key={o.id} className={`p2-bubble ${active ? "active" : ""}`}
                        draggable
                        title="Glisse cet ouvrage sur un lot à gauche pour le reclasser"
                        style={{ "--bubble-color": bubbleColor, "--av": `${av}%`,
                          display: "flex", alignItems: "center", gap: 10,
                          cursor: "grab",
                          opacity: draggedOuvrageId === o.id ? 0.4 : 1 }}
                        onClick={() => setSelectedOuvrageId(o.id)}
                        onDragStart={e => { setDraggedOuvrageId(o.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", o.id); }}
                        onDragEnd={() => { setDraggedOuvrageId(null); setDragOverLotId(null); }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.libelle || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans libellé)</span>}
                          </div>
                          {(o.heures_devis || o.quantite || o.prix_ht) && (
                            <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>
                              {o.heures_devis ? `${o.heures_devis}h` : ""}
                              {o.quantite ? `${o.heures_devis ? " · " : ""}${o.quantite} ${o.unite || ""}` : ""}
                              {o.prix_ht ? `${(o.heures_devis||o.quantite) ? " · " : ""}${o.prix_ht.toLocaleString("fr-FR")} €` : ""}
                            </div>
                          )}
                        </div>
                        {nbTaches > 0 && (
                          <>
                            <span style={{
                              fontSize: 10, fontWeight: 800, padding: "2px 8px",
                              borderRadius: RADIUS.pill,
                              background: "rgba(0,0,0,0.18)", color: T.text, flexShrink: 0,
                            }}>{nbTaches}</span>
                            <span
                              title={avancementOuvrageDetail(o)}
                              style={{ fontSize: FONT.xs.size, fontWeight: 800, color: av >= 100 ? "#22c55e" : T.text, minWidth: 34, textAlign: "right", cursor: "help" }}>
                              {av}%
                            </span>
                          </>
                        )}
                        <button
                          className="p2-edit-btn"
                          onClick={e => { e.stopPropagation(); setEditingOuvrageId(o.id); }}
                          title="Modifier l'ouvrage"
                          style={{
                            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                            color: T.text, borderRadius: RADIUS.sm,
                            width: 26, height: 26, padding: 0, cursor: "pointer",
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0, transition: "all .12s",
                          }}>
                          <Icon as={Pencil} size={12}/>
                        </button>
                      </div>
                    );
                  })
              }
            </div>
          </div>

          {/* ── Colonne 3 : Tâches ── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={colHeader}>
              <Icon as={ClipboardList} size={12}/> Tâches
              {selectedOuvrage && (
                <>
                  {taches.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.card, color: T.textMuted,
                    }}>{taches.length}</span>
                  )}
                  <button onClick={() => createTache(selectedOuvrage.id)} style={addBtn}>
                    <Icon as={Plus} size={11}/> Tâche
                  </button>
                </>
              )}
            </div>
            <div style={colBody}>
              {!selectedOuvrage
                ? emptyColMsg("Sélectionne un ouvrage")
                : taches.length === 0
                  ? emptyColMsg("Aucune tâche — clique « + Tâche »")
                  : (() => {
                    const tacheColor = lots.find(l => l.id === selectedOuvrage.lot_id)?.couleur || acc.accent;
                    return taches.map(t => {
                      const av = Math.max(0, Math.min(100, parseInt(t.avancement) || 0));
                      const bubbleColor = av >= 100 ? "#22c55e" : tacheColor;
                      return (
                        <div key={t.id} className="p2-bubble"
                          style={{ "--bubble-color": bubbleColor, "--av": `${av}%`, display: "flex", flexDirection: "column", gap: 0 }}
                          onClick={() => setEditingTache({ ouvrageId: selectedOuvrage.id, tacheId: t.id })}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: FONT.sm.size, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.nom || <span style={{ fontStyle: "italic", color: T.textMuted }}>(sans nom)</span>}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                              {(() => {
                                const hr = tacheHeuresReelles(t);
                                const he = parseFloat(t.heures_estimees);
                                if (hr > 0 || (he != null && !isNaN(he))) {
                                  const derive = couleurDerive(hr, he);
                                  return (
                                    <span style={{ fontSize: FONT.xs.size, color: derive || T.textMuted, fontWeight: derive ? 700 : 400, whiteSpace: "nowrap" }}
                                      title={he ? `Réalisé ${hr}h sur ${he}h estimées (${Math.round(hr/he*100)}%)` : `${hr}h réelles`}>
                                      {hr || 0}h / {(he != null && !isNaN(he)) ? `${he}h` : "—"}
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                              {t.date_prevue && (() => {
                                const d = new Date(t.date_prevue);
                                if (isNaN(d.getTime())) return null;
                                const lbl = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
                                return (
                                  <span title={`Planifié le ${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 3,
                                      fontSize: 10, fontWeight: 700,
                                      padding: "1px 7px", borderRadius: RADIUS.sm,
                                      background: "rgba(91,138,245,0.16)", color: "#5b8af5",
                                      border: "1px solid rgba(91,138,245,0.35)",
                                    }}>
                                    📅 {lbl}
                                  </span>
                                );
                              })()}
                              {Array.isArray(t.ouvriers) && t.ouvriers.length > 0 && (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: -4, marginLeft: 4 }}
                                  title={t.ouvriers.join(", ")}>
                                  {t.ouvriers.slice(0, 3).map((n, idx) => (
                                    <span key={n} style={{
                                      width: 18, height: 18, borderRadius: "50%",
                                      background: `color-mix(in srgb, ${tacheColor} 60%, transparent)`,
                                      border: `1.5px solid ${T.surface}`,
                                      color: T.text, fontSize: 9, fontWeight: 800,
                                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                                      marginLeft: idx === 0 ? 0 : -6, position: "relative", zIndex: 3 - idx,
                                    }}>{initiales(n)}</span>
                                  ))}
                                  {t.ouvriers.length > 3 && (
                                    <span style={{
                                      fontSize: 9, fontWeight: 800, color: T.textMuted,
                                      marginLeft: 4,
                                    }}>+{t.ouvriers.length - 3}</span>
                                  )}
                                </div>
                              )}
                              <span title={avancementTacheDetail(t)}
                                style={{ marginLeft: "auto", fontSize: FONT.xs.size, color: av >= 100 ? "#22c55e" : T.textMuted, fontWeight: 800, cursor: "help" }}>
                                {av}%
                              </span>
                            </div>
                          </div>
                          <button
                            className="p2-edit-btn"
                            onClick={e => { e.stopPropagation(); setEditingTache({ ouvrageId: selectedOuvrage.id, tacheId: t.id }); }}
                            title="Modifier la tâche"
                            style={{
                              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                              color: T.text, borderRadius: RADIUS.sm,
                              width: 26, height: 26, padding: 0, cursor: "pointer",
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              flexShrink: 0, transition: "all .12s",
                            }}>
                            <Icon as={Pencil} size={12}/>
                          </button>
                          </div>
                          {/* ── Panneau d'accès rapide (déplié au hover) ── */}
                          <div className="p2-tache-expand" onClick={e => e.stopPropagation()}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, minWidth: 70 }}>
                                Heures réelles
                              </span>
                              <input type="number" step="0.5" min="0" value={tacheHeuresReelles(t) || ""}
                                onClick={e => e.stopPropagation()}
                                onChange={e => updateTache(selectedOuvrage.id, t.id, { heures_reelles: e.target.value === "" ? null : parseFloat(e.target.value) })}
                                placeholder="0"
                                style={{
                                  width: 70, padding: "4px 8px", borderRadius: RADIUS.sm,
                                  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
                                  color: T.text, fontSize: FONT.xs.size + 1, fontFamily: "inherit",
                                  outline: "none", textAlign: "right",
                                }}/>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, marginLeft: 8 }}>
                                Avanc.
                              </span>
                              <input type="number" step="5" min="0" max="100" value={t.avancement ?? ""}
                                onClick={e => e.stopPropagation()}
                                onChange={e => updateTache(selectedOuvrage.id, t.id, { avancement: e.target.value === "" ? 0 : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                                placeholder="0"
                                style={{
                                  width: 60, padding: "4px 8px", borderRadius: RADIUS.sm,
                                  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
                                  color: T.text, fontSize: FONT.xs.size + 1, fontFamily: "inherit",
                                  outline: "none", textAlign: "right",
                                }}/>
                              <span style={{ fontSize: 10, color: T.textMuted }}>%</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase", color: T.textMuted, minWidth: 70 }}>
                                Ouvriers
                              </span>
                              {ouvriers.length === 0 ? (
                                <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>aucun configuré</span>
                              ) : ouvriers.map(nom => {
                                const sel = (t.ouvriers || []).includes(nom);
                                return (
                                  <button key={nom}
                                    className={`p2-mini-chip ${sel ? "sel" : ""}`}
                                    onClick={e => { e.stopPropagation(); toggleOuvrier(selectedOuvrage.id, t.id, nom); }}>
                                    {nom}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()
              }
            </div>
          </div>
        </div>
      )}

      {/* ── Modale suivi direction ── */}
      {showSuiviDirection && (
        <ItemEditModal
          title="Suivi direction"
          color={acc.accent}
          T={T} accent={acc.accent}
          onClose={() => setShowSuiviDirection(false)}
          onDelete={null}
        >
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5, marginBottom: 4 }}>
            Objectifs RH / pilotage de ce chantier. Visible dans le footer et utilisé par Dashboard Analyse.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ModalField label="Marge vendue cible (%)">
              <input type="number" step="1" min="0" max="100" value={meta.marge_vendue_cible ?? ""}
                onChange={e => saveMeta({ marge_vendue_cible: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="30" style={modalInp(T)}/>
            </ModalField>
            <ModalField label="FG — Taux horaire (€/h)">
              <input type="number" step="0.5" min="0" value={meta.fg_taux_horaire ?? ""}
                onChange={e => saveMeta({ fg_taux_horaire: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="5" style={modalInp(T)}/>
            </ModalField>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <ModalField label="Seuil prime (%)">
              <input type="number" step="1" min="0" max="100" value={meta.seuil_prime ?? ""}
                onChange={e => saveMeta({ seuil_prime: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="25" style={modalInp(T)}/>
            </ModalField>
            <ModalField label="Prime chantier (€)">
              <input type="number" step="50" min="0" value={meta.prime ?? ""}
                onChange={e => saveMeta({ prime: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="300" style={modalInp(T)}/>
            </ModalField>
          </div>
          <div style={{
            marginTop: 4, padding: "10px 12px", borderRadius: RADIUS.md,
            background: T.card, border: `1px solid ${T.border}`,
            fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.6,
          }}>
            <div><strong style={{ color: T.text }}>Marge cible</strong> : objectif de marge brute pour considérer le chantier rentable.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Frais généraux</strong> : taux horaire (€/h) multiplié par les heures vendues du chantier. Couvre admin, transport, etc. Déduit de la marge.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Seuil prime</strong> : marge minimale à partir de laquelle l'équipe touche la prime.</div>
            <div style={{ marginTop: 4 }}><strong style={{ color: T.text }}>Prime chantier</strong> : montant attribué à l'équipe si le seuil est dépassé.</div>
          </div>
        </ItemEditModal>
      )}

      {/* ── Modale import devis ── */}
      {importState && (
        <ImportDevisModal
          state={importState}
          lots={lots}
          T={T} accent={acc.accent} accentBorder={acc.border} accentBg10={acc.bg10}
          onUpdateItem={updateImportItem}
          onToggleAll={toggleAllImport}
          onClose={() => setImportState(null)}
          onConfirm={confirmImport}
        />
      )}

      {/* ── Modale édition ouvrage ── */}
      {editingOuvrageId && (() => {
        const o = ouvrages.find(x => x.id === editingOuvrageId);
        if (!o) return null;
        const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
        return (
          <ItemEditModal
            title="Modifier l'ouvrage"
            color={lotColor}
            T={T} accent={acc.accent}
            onClose={() => setEditingOuvrageId(null)}
            onDelete={() => { deleteOuvrage(o.id); setEditingOuvrageId(null); }}
          >
            <ModalField label="Libellé">
              <input autoFocus value={o.libelle || ""}
                onChange={e => updateOuvrage(o.id, { libelle: e.target.value })}
                placeholder="Nom de l'ouvrage" style={{ ...modalInp(T), fontWeight: 600 }}/>
            </ModalField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <ModalField label="Heures vendues">
                <input type="number" step="0.5" min="0" value={o.heures_devis ?? ""}
                  onChange={e => updateOuvrage(o.id, { heures_devis: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
              <ModalField label="Quantité">
                <div style={{ display: "flex", gap: 4 }}>
                  <input type="number" step="0.01" min="0" value={o.quantite ?? ""}
                    onChange={e => updateOuvrage(o.id, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    placeholder="0" style={{ ...modalInp(T), flex: 1 }}/>
                  <input value={o.unite || ""}
                    onChange={e => updateOuvrage(o.id, { unite: e.target.value })}
                    placeholder="U" style={{ ...modalInp(T), width: 56, textAlign: "center" }}/>
                </div>
              </ModalField>
              <ModalField label="Prix HT (€)">
                <input type="number" step="0.01" min="0" value={o.prix_ht ?? ""}
                  onChange={e => updateOuvrage(o.id, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
            </div>
            <ModalField label="Coût matériaux (€)">
              <input type="number" step="0.01" min="0" value={o.cout_materiaux ?? ""}
                onChange={e => updateOuvrage(o.id, { cout_materiaux: e.target.value === "" ? null : parseFloat(e.target.value) })}
                placeholder="0" style={modalInp(T)}/>
            </ModalField>

            {/* ── Matériaux liés (depuis la biblio ouvrage) ─────────────── */}
            {(() => {
              const liens = (o.materiaux_liens || []).filter(ml => ml && ml.materiau_id != null);
              if (liens.length === 0) return null;
              const qOuvrage = parseFloat(o.quantite) || 0;
              const lignes = liens.map(ml => {
                const m = materiauxBiblio.find(x => x.id === ml.materiau_id);
                const qParU = parseFloat(ml.quantite) || 0;
                const prixU = m ? (parseFloat(m.prix_unitaire) || 0) : 0;
                const qTot  = qOuvrage * qParU;
                const cout  = qTot * prixU;
                return { m, ml, qParU, prixU, qTot, cout };
              });
              const totalCout = lignes.reduce((s, l) => s + l.cout, 0);
              return (
                <ModalField label={`Matériaux liés (${liens.length})`}>
                  <div style={{
                    background: T.card, border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md, overflow: "hidden",
                  }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr 70px 90px 80px",
                      gap: 8, padding: "6px 10px",
                      background: T.surface, borderBottom: `1px solid ${T.border}`,
                      fontSize: 10, fontWeight: 700, color: T.textMuted,
                      textTransform: "uppercase", letterSpacing: 0.6,
                    }}>
                      <div>Matériau</div>
                      <div style={{ textAlign: "center" }}>Qté/u</div>
                      <div style={{ textAlign: "center" }}>Qté totale</div>
                      <div style={{ textAlign: "right" }}>Coût</div>
                    </div>
                    {lignes.map((l, i) => (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "1fr 70px 90px 80px",
                        gap: 8, padding: "7px 10px",
                        borderTop: i === 0 ? "none" : `1px solid ${T.sectionDivider}`,
                        fontSize: FONT.xs.size + 1, color: T.text, alignItems: "center",
                      }}>
                        <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {l.m ? l.m.nom : <span style={{ color: T.textMuted, fontStyle: "italic" }}>Matériau introuvable</span>}
                        </div>
                        <div style={{ textAlign: "center", color: T.textSub }}>
                          {l.qParU || "—"}
                        </div>
                        <div style={{ textAlign: "center", color: T.textSub }}>
                          {l.qTot > 0 ? `${l.qTot.toFixed(2)} ${l.m?.unite || ""}` : "—"}
                        </div>
                        <div style={{ textAlign: "right", fontWeight: 700 }}>
                          {l.cout > 0 ? `${l.cout.toFixed(2)} €` : "—"}
                        </div>
                      </div>
                    ))}
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 10px", borderTop: `1px solid ${T.border}`,
                      background: T.surface,
                    }}>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600 }}>
                        Total calculé
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>
                          {totalCout.toFixed(2)} €
                        </div>
                        <button
                          onClick={() => updateOuvrage(o.id, { cout_materiaux: parseFloat(totalCout.toFixed(2)) })}
                          disabled={!(totalCout > 0)}
                          title="Recopier ce total dans le champ Coût matériaux"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "4px 10px", borderRadius: RADIUS.sm, border: "none",
                            background: totalCout > 0 ? acc.accent : T.border,
                            color: acc.onAccent || "#fff",
                            fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                            cursor: totalCout > 0 ? "pointer" : "default",
                            opacity: totalCout > 0 ? 1 : .5,
                          }}>
                          Recalculer
                        </button>
                      </div>
                    </div>
                  </div>
                </ModalField>
              );
            })()}

            <ModalField label="Lot">
              <select value={o.lot_id || ""}
                onChange={e => updateOuvrage(o.id, { lot_id: e.target.value || null })}
                style={{ ...modalInp(T), cursor: "pointer" }}>
                <option value="">— Sans lot —</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </ModalField>
          </ItemEditModal>
        );
      })()}

      {/* ── Modale édition tâche ── */}
      {editingTache && (() => {
        const o = ouvrages.find(x => x.id === editingTache.ouvrageId);
        const t = o?.taches?.find(x => x.id === editingTache.tacheId);
        if (!t) return null;
        const lotColor = lots.find(l => l.id === o.lot_id)?.couleur || acc.accent;
        return (
          <ItemEditModal
            title="Modifier la tâche"
            color={lotColor}
            T={T} accent={acc.accent}
            onClose={() => setEditingTache(null)}
            onDelete={() => { deleteTache(o.id, t.id); setEditingTache(null); }}
          >
            <ModalField label="Description">
              <textarea autoFocus value={t.nom || ""}
                onChange={e => updateTache(o.id, t.id, { nom: e.target.value })}
                placeholder="Description de la tâche" rows={2}
                style={{ ...modalInp(T), fontWeight: 600, resize: "vertical", minHeight: 60 }}/>
            </ModalField>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <ModalField label="Heures estimées">
                <input type="number" step="0.5" min="0" value={t.heures_estimees ?? ""}
                  onChange={e => updateTache(o.id, t.id, { heures_estimees: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
              <ModalField label="Heures réelles">
                <input type="number" step="0.5" min="0" value={tacheHeuresReelles(t) || ""}
                  onChange={e => updateTache(o.id, t.id, { heures_reelles: e.target.value === "" ? null : parseFloat(e.target.value) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
              <ModalField label="Avancement (%)">
                <input type="number" step="5" min="0" max="100" value={t.avancement ?? ""}
                  onChange={e => updateTache(o.id, t.id, { avancement: e.target.value === "" ? 0 : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)) })}
                  placeholder="0" style={modalInp(T)}/>
              </ModalField>
            </div>
            <ModalField label={`Ouvriers assignés${(t.ouvriers||[]).length > 0 ? ` (${t.ouvriers.length})` : ""}`}>
              {ouvriers.length === 0 ? (
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>
                  Aucun ouvrier configuré — ajoute-en dans Réglages → Ouvriers.
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {ouvriers.map(nom => {
                    const selected = (t.ouvriers || []).includes(nom);
                    return (
                      <button key={nom}
                        onClick={() => toggleOuvrier(o.id, t.id, nom)}
                        style={{
                          padding: "5px 12px", borderRadius: RADIUS.pill,
                          border: `1px solid ${selected ? acc.accent : T.border}`,
                          background: selected ? acc.bg10 : "transparent",
                          color: selected ? acc.accent : T.textSub,
                          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                          cursor: "pointer", transition: "all .12s",
                        }}>
                        {nom}
                      </button>
                    );
                  })}
                </div>
              )}
            </ModalField>

            {/* ── Section Planification ── */}
            <div style={{
              marginTop: 6, paddingTop: 14,
              borderTop: `1px dashed ${T.border}`,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
                color: T.textMuted, marginBottom: 10,
              }}>
                Envoyer dans le planning semaine
              </div>
              {t.date_prevue && (
                <div style={{
                  fontSize: FONT.xs.size + 1, color: T.textSub, marginBottom: 10,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Icon as={Check} size={11} color="#22c55e"/>
                  <span>Déjà planifié le <strong style={{ color: T.text }}>{new Date(t.date_prevue).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></span>
                  <button onClick={() => updateTache(o.id, t.id, { date_prevue: "" })}
                    style={{
                      marginLeft: "auto", background: "transparent", border: `1px solid ${T.border}`,
                      color: T.textMuted, borderRadius: RADIUS.sm, padding: "2px 8px",
                      fontFamily: "inherit", fontSize: FONT.xs.size, cursor: "pointer",
                    }}>
                    Effacer la date
                  </button>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr auto", gap: 8, alignItems: "flex-end" }}>
                <ModalField label="Semaine">
                  <select value={planifSemaine} onChange={e => setPlanifSemaine(e.target.value)}
                    style={{ ...modalInp(T), cursor: "pointer" }}>
                    {semainesFutures.map(w => <option key={w} value={w}>{w}</option>)}
                  </select>
                </ModalField>
                <ModalField label="Jour">
                  <select value={planifJour} onChange={e => setPlanifJour(e.target.value)}
                    style={{ ...modalInp(T), cursor: "pointer" }}>
                    {JOURS_SEM.map(j => <option key={j} value={j}>{j}</option>)}
                  </select>
                </ModalField>
                <ModalField label="Durée (h)">
                  <input type="number" step="0.5" min="0" value={planifDuree}
                    onChange={e => setPlanifDuree(e.target.value)}
                    placeholder="0" style={modalInp(T)}/>
                </ModalField>
                <button onClick={() => envoyerDansPlanning(o.id, t)}
                  disabled={planifSaving}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "9px 16px", borderRadius: RADIUS.md, border: "none",
                    background: planifSaving ? T.border : acc.accent,
                    color: planifSaving ? T.textMuted : "#000",
                    fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                    cursor: planifSaving ? "default" : "pointer",
                    whiteSpace: "nowrap",
                  }}>
                  <Icon as={Check} size={13}/>
                  {planifSaving ? "Envoi…" : "Envoyer"}
                </button>
              </div>
              {planifMsg && (
                <div style={{
                  marginTop: 8, padding: "6px 10px", borderRadius: RADIUS.sm,
                  fontSize: FONT.xs.size + 1, fontWeight: 700,
                  background: planifMsg.ok ? "rgba(34,197,94,0.10)" : "rgba(225,90,90,0.10)",
                  border: `1px solid ${planifMsg.ok ? "rgba(34,197,94,0.30)" : "rgba(225,90,90,0.30)"}`,
                  color: planifMsg.ok ? "#22c55e" : "#e15a5a",
                }}>
                  {planifMsg.txt}
                </div>
              )}
            </div>
          </ItemEditModal>
        );
      })()}
    </div>
  );
}

// ─── GANTT V2 ─────────────────────────────────────────────────────────────────
// Timeline simple par jour ouvré (Lun-Ven). Une ligne par tâche, groupées par
// ouvrage puis par lot. Chaque tâche a une barre qui commence à date_prevue
// et s'étend sur ⌈heures_estimees / 7⌉ jours (heuristique 7h/jour).
function GanttV2({ ouvrages, lots, acc, T, avancementOuvrage, tacheHeuresReelles, onClickTache }) {
  const DAY_PX = 28, ROW_H = 30, LABEL_W = 280, HEADER_H = 56;
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const addDays    = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
  const isWeekend  = (d) => { const w = d.getDay(); return w === 0 || w === 6; };
  const parseDate  = (s) => { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : startOfDay(d); };
  const fmtDay     = (d) => d.toLocaleDateString("fr-FR", { day: "numeric" });
  const fmtMonth   = (d) => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const isoDay     = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const todayISO   = isoDay(startOfDay(new Date()));

  // ── Construit la liste plate { lot, ouvrage, tache } pour les tâches qui
  //    ont une date_prevue. Les non-planifiées vont dans un bloc séparé.
  const rows = [];
  const orphans = [];
  ouvrages.forEach(o => {
    const lot = lots.find(l => l.id === o.lot_id) || { id: "_x", label: "Sans lot", couleur: "#888" };
    (o.taches || []).forEach(t => {
      const d = parseDate(t.date_prevue);
      if (d) rows.push({ lot, ouvrage: o, tache: t, date: d });
      else   orphans.push({ lot, ouvrage: o, tache: t });
    });
  });

  // ── Plage de dates : du min des date_prevue à +35 jours après le max.
  //    Si rien de planifié, on affiche aujourd'hui + 30 jours.
  const dates = rows.map(r => r.date);
  let dateMin = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : startOfDay(new Date());
  let dateMax = dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : addDays(new Date(), 30);
  // 3 jours de marge avant, 14 jours après le max (ou heures longues).
  dateMin = addDays(dateMin, -3);
  dateMax = addDays(dateMax, 14);

  // Liste des jours affichés (skip weekends)
  const days = [];
  for (let d = startOfDay(dateMin); d <= dateMax; d = addDays(d, 1)) {
    if (!isWeekend(d)) days.push(new Date(d));
  }
  const dayIndex = (d) => {
    const target = isoDay(d);
    return days.findIndex(x => isoDay(x) === target);
  };
  const totalWidth = days.length * DAY_PX;

  // Groupes pour entêtes de mois
  const monthsHeader = [];
  let lastMonthKey = "";
  days.forEach((d, i) => {
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if (k !== lastMonthKey) {
      monthsHeader.push({ label: fmtMonth(d), startIdx: i, span: 1 });
      lastMonthKey = k;
    } else {
      monthsHeader[monthsHeader.length - 1].span += 1;
    }
  });

  // Tri des rows : par lot.id puis par ouvrage puis par date
  rows.sort((a, b) => {
    if (a.lot.id !== b.lot.id) return a.lot.id.localeCompare(b.lot.id);
    if (a.ouvrage.id !== b.ouvrage.id) return (a.ouvrage.libelle || "").localeCompare(b.ouvrage.libelle || "");
    return a.date.getTime() - b.date.getTime();
  });

  // Longueur en jours (skip weekends) à partir des heures estimées (~ 7h/jour)
  const dureeJours = (t) => {
    const h = parseFloat(t.heures_estimees);
    if (!h || isNaN(h) || h <= 0) return 1;
    return Math.max(1, Math.ceil(h / 7));
  };

  if (rows.length === 0 && orphans.length === 0) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{
          background: T.card, border: `1px dashed ${T.border}`,
          borderRadius: RADIUS.xl, padding: "48px 32px", textAlign: "center",
          maxWidth: 460, color: T.textMuted,
        }}>
          <div style={{ fontSize: FONT.md.size, fontWeight: 700, color: T.text, marginBottom: 6 }}>
            Aucune tâche à afficher
          </div>
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6 }}>
            Ajoute des tâches et planifie-les (modale tâche → "Envoyer dans le planning") pour les voir sur le Gantt.
          </div>
        </div>
      </div>
    );
  }

  // ── Rendu
  return (
    <div style={{ flex: 1, overflow: "auto", background: T.bg, padding: 0 }}>
      <div style={{ position: "relative", width: LABEL_W + totalWidth, minWidth: "100%" }}>
        {/* Header dates (sticky) */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          background: T.surface, borderBottom: `1px solid ${T.border}`,
          height: HEADER_H,
          display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
        }}>
          <div style={{
            borderRight: `1px solid ${T.border}`,
            padding: "10px 14px", display: "flex", alignItems: "center",
            fontSize: FONT.xs.size, fontWeight: 800, color: T.textMuted, letterSpacing: .8, textTransform: "uppercase",
          }}>
            Tâche / Ouvrage
          </div>
          <div style={{ position: "relative", height: HEADER_H }}>
            {/* Ligne mois */}
            <div style={{ display: "flex", height: HEADER_H / 2, borderBottom: `1px solid ${T.border}` }}>
              {monthsHeader.map((m, i) => (
                <div key={i} style={{
                  width: m.span * DAY_PX, padding: "0 8px",
                  display: "flex", alignItems: "center",
                  fontSize: FONT.xs.size, fontWeight: 700, color: T.text,
                  borderRight: `1px solid ${T.border}`,
                }}>
                  {m.label}
                </div>
              ))}
            </div>
            {/* Ligne jours */}
            <div style={{ display: "flex", height: HEADER_H / 2 }}>
              {days.map((d, i) => {
                const today = isoDay(d) === todayISO;
                return (
                  <div key={i} style={{
                    width: DAY_PX, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 9, fontWeight: today ? 800 : 600,
                    color: today ? acc.accent : T.textMuted,
                    background: today ? acc.bg10 : "transparent",
                    borderRight: `1px solid ${T.border}`,
                  }}>
                    {fmtDay(d)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Rangées tâches */}
        {(() => {
          const els = [];
          let lastLotId = null;
          rows.forEach((r, idx) => {
            // Header de lot si on change
            if (r.lot.id !== lastLotId) {
              els.push(
                <div key={`lot-${r.lot.id}`} style={{
                  display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                  background: `color-mix(in srgb, ${r.lot.couleur} 14%, transparent)`,
                  borderTop: `1px solid ${T.border}`,
                  borderBottom: `1px solid ${T.border}`,
                  height: 26, alignItems: "center",
                }}>
                  <div style={{ padding: "0 14px", borderRight: `1px solid ${T.border}`, height: "100%", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: r.lot.couleur }}/>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: T.text, textTransform: "uppercase", letterSpacing: .5 }}>{r.lot.label}</span>
                  </div>
                  <div/>
                </div>
              );
              lastLotId = r.lot.id;
            }
            // Rangée tâche
            const startIdx = dayIndex(r.date);
            const spanDays = Math.min(days.length - Math.max(0, startIdx), dureeJours(r.tache));
            const left = startIdx >= 0 ? startIdx * DAY_PX : 0;
            const widthBar = spanDays * DAY_PX - 4;
            const av = Math.max(0, Math.min(100, parseInt(r.tache.avancement) || 0));
            const barColor = av >= 100 ? "#22c55e" : r.lot.couleur;
            const hr = tacheHeuresReelles(r.tache);
            const tooltip = `${r.tache.nom || "(sans nom)"} — ${r.date.toLocaleDateString("fr-FR")} — ${av}%${r.tache.heures_estimees ? ` — ${hr || 0}h/${r.tache.heures_estimees}h` : ""}`;
            els.push(
              <div key={`row-${r.tache.id}-${idx}`} style={{
                display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                height: ROW_H, borderBottom: `1px solid ${T.border}`,
                background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
              }}>
                <div style={{ padding: "0 14px", borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.tache.nom || "(sans nom)"}
                  </div>
                  <div style={{ fontSize: 9, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.ouvrage.libelle || "(sans libellé)"}
                  </div>
                </div>
                <div style={{ position: "relative", height: ROW_H }}>
                  {/* Grille de fond (jour) */}
                  {days.map((d, i) => {
                    const today = isoDay(d) === todayISO;
                    return (
                      <div key={i} style={{
                        position: "absolute", left: i * DAY_PX, top: 0, width: DAY_PX, height: "100%",
                        borderRight: `1px solid ${T.border}`,
                        background: today ? `color-mix(in srgb, ${acc.accent} 8%, transparent)` : "transparent",
                      }}/>
                    );
                  })}
                  {/* Barre tâche */}
                  {startIdx >= 0 && (
                    <div onClick={() => onClickTache(r.ouvrage.id, r.tache.id)}
                      title={tooltip}
                      style={{
                        position: "absolute", left: left + 2, top: 4, width: Math.max(20, widthBar),
                        height: ROW_H - 8, borderRadius: 5,
                        background: `linear-gradient(to right,
                          color-mix(in srgb, ${barColor} 80%, transparent) 0,
                          color-mix(in srgb, ${barColor} 80%, transparent) ${av}%,
                          color-mix(in srgb, ${barColor} 30%, transparent) ${av}%,
                          color-mix(in srgb, ${barColor} 30%, transparent) 100%)`,
                        border: `1px solid ${barColor}`,
                        color: "#000", fontSize: 10, fontWeight: 800,
                        display: "flex", alignItems: "center", padding: "0 8px",
                        cursor: "pointer", overflow: "hidden",
                        boxShadow: `0 2px 4px color-mix(in srgb, ${barColor} 30%, transparent)`,
                      }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.tache.nom || ""} {av > 0 ? `· ${av}%` : ""}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          });
          return els;
        })()}

        {/* Section tâches non planifiées (pas de date_prevue) */}
        {orphans.length > 0 && (
          <>
            <div style={{
              display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
              background: "rgba(255,255,255,0.03)",
              borderTop: `1px dashed ${T.border}`, borderBottom: `1px solid ${T.border}`,
              height: 26, alignItems: "center",
            }}>
              <div style={{ padding: "0 14px", borderRight: `1px solid ${T.border}`, height: "100%", display: "flex", alignItems: "center" }}>
                <span style={{ fontSize: FONT.xs.size, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: .5, fontStyle: "italic" }}>
                  Non planifiées ({orphans.length})
                </span>
              </div>
              <div/>
            </div>
            {orphans.map((r, idx) => (
              <div key={`orphan-${r.tache.id}-${idx}`} style={{
                display: "grid", gridTemplateColumns: `${LABEL_W}px 1fr`,
                height: ROW_H, borderBottom: `1px solid ${T.border}`,
                opacity: .65,
              }}>
                <div onClick={() => onClickTache(r.ouvrage.id, r.tache.id)}
                  style={{ padding: "0 14px", borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", justifyContent: "center", gap: 1, cursor: "pointer", minWidth: 0 }}>
                  <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.tache.nom || "(sans nom)"}
                  </div>
                  <div style={{ fontSize: 9, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.ouvrage.libelle || "(sans libellé)"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", padding: "0 14px", fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                  Clique pour planifier (modale → Envoyer dans le planning)
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ─── KPI compact (footer phasage v2) ──────────────────────────────────────────
function KpiBlock({ T, label, value, sub, accent }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
        color: T.textMuted,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{
          fontSize: FONT.sm.size + 2, fontWeight: 800, letterSpacing: -.2,
          color: accent || T.text,
        }}>
          {value}
        </span>
        {sub && (
          <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: accent || T.textMuted }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── KPI fusionné : Marge cible + Prime équipe ────────────────────────────────
function KpiCibleEtPrime({ T, margeCible, margePct, prime, seuilPrime, prixHT }) {
  const cibleAtteinte = margeCible > 0 && prixHT > 0 && margePct >= margeCible;
  const primeAcquise  = prime > 0 && seuilPrime > 0 && prixHT > 0 && margePct >= seuilPrime;
  const line = (label, value, sub, ok) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase", color: T.textMuted, minWidth: 38 }}>{label}</span>
        <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: ok ? "#22c55e" : T.text, letterSpacing: -.2 }}>{value}</span>
      </div>
      {sub && (
        <span style={{ fontSize: 9, fontWeight: 700, color: ok ? "#22c55e" : T.textMuted, whiteSpace: "nowrap" }}>
          {sub}
        </span>
      )}
    </div>
  );
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.border}`,
      borderRadius: RADIUS.md, padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted,
      }}>
        <span style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          background: "color-mix(in srgb, #ec4899 18%, transparent)",
          color: "#ec4899",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={Target} size={11} strokeWidth={2.4}/>
        </span>
        Objectifs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {margeCible > 0 && line(
          "Cible",
          `${margeCible}%`,
          prixHT > 0 ? (cibleAtteinte ? "✓ atteinte" : `+${(margeCible - margePct).toFixed(1)}% à faire`) : null,
          cibleAtteinte,
        )}
        {prime > 0 && line(
          "Prime",
          `${Math.round(prime).toLocaleString("fr-FR")} €`,
          seuilPrime > 0 ? (primeAcquise ? "✓ acquise" : `seuil ${seuilPrime}%`) : null,
          primeAcquise,
        )}
      </div>
    </div>
  );
}

// ─── KPI Card (variante visuelle avec icône) ──────────────────────────────────
function KpiCard({ T, icon, iconColor, label, value, sub, accent, bold }) {
  const valColor = accent || T.text;
  return (
    <div style={{
      background: T.card,
      border: `1px solid ${T.border}`,
      borderRadius: RADIUS.md,
      padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 6,
      minWidth: 0,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 9, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase",
        color: T.textMuted,
      }}>
        {icon && (
          <span style={{
            width: 18, height: 18, borderRadius: 5, flexShrink: 0,
            background: `color-mix(in srgb, ${iconColor || T.textMuted} 18%, transparent)`,
            color: iconColor || T.textMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={icon} size={11} strokeWidth={2.4}/>
          </span>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: FONT.md.size + 4, fontWeight: bold ? 900 : 800,
        color: valColor, letterSpacing: -.4, lineHeight: 1.1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, opacity: .85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Composants modale d'édition ───────────────────────────────────────────────
const modalInp = (T) => ({
  width: "100%", padding: "9px 12px", borderRadius: RADIUS.md,
  border: `1px solid ${T.border}`, background: T.fieldBg || T.card,
  color: T.text, fontSize: FONT.sm.size, fontFamily: "inherit", outline: "none",
});
function ModalField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", marginBottom: 5, opacity: .65 }}>{label}</div>
      {children}
    </div>
  );
}
function ItemEditModal({ title, color, T, accent, onClose, onDelete, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 700,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl,
        border: `1px solid ${T.border}`, borderLeft: `5px solid ${color}`,
        width: "100%", maxWidth: 560,
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", maxHeight: "90vh",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0,
            background: `color-mix(in srgb, ${color} 20%, transparent)`,
            color: color, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon as={Pencil} size={14}/>
          </div>
          <div style={{ flex: 1, fontSize: FONT.md.size, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>{title}</div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted, cursor: "pointer",
            padding: 6, borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center",
          }}><Icon as={X} size={18}/></button>
        </div>
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          {children}
        </div>
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: onDelete ? "space-between" : "flex-end", gap: 10 }}>
          {onDelete && (
            <button onClick={onDelete} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: RADIUS.md,
              border: "1px solid rgba(225,90,90,0.3)", background: "transparent", color: "#e15a5a",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
            }}>
              <Icon as={Trash2} size={13}/>
              Supprimer
            </button>
          )}
          <button onClick={onClose} style={{
            padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
            background: accent, color: "#000",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
          }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modale d'import devis ────────────────────────────────────────────────────
function ImportDevisModal({ state, lots, T, accent, accentBorder, accentBg10, onUpdateItem, onToggleAll, onClose, onConfirm }) {
  const { items, unknownLotHeaders, parsing, error } = state;
  // Groupe les items par lot pour l'affichage
  const groups = (() => {
    const map = new Map();
    items.forEach(it => {
      const k = it.lot_id || "_orphans";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    });
    return Array.from(map.entries());
  })();
  const nbSel       = items.filter(i => i.selectionne).length;
  const nbMatchCode = items.filter(i => i.matchBy === "code").length;
  const nbMatchLbl  = items.filter(i => i.matchBy === "libelle").length;

  const lotLabel = (id) => id === "_orphans" ? "Sans lot" : (lots.find(l => l.id === id)?.label || id);
  const lotCouleur = (id) => id === "_orphans" ? T.textMuted : (lots.find(l => l.id === id)?.couleur || T.textMuted);

  const inp = {
    padding: "5px 8px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
    background: T.fieldBg || T.card, color: T.text, fontSize: FONT.xs.size + 1,
    fontFamily: "inherit", outline: "none",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      backdropFilter: "blur(4px)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T.modal || T.surface, borderRadius: RADIUS.xl, border: `1px solid ${T.border}`,
        width: "100%", maxWidth: 980, maxHeight: "92vh",
        display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 34, height: 34, borderRadius: RADIUS.md, background: accentBg10, color: accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon as={FileSpreadsheet} size={17}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text, letterSpacing: -.2 }}>Importer un devis</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              {parsing ? "Analyse en cours…"
                : error ? "Erreur"
                : `${items.length} ouvrage${items.length > 1 ? "s" : ""} détecté${items.length > 1 ? "s" : ""} · ${nbMatchCode} par code · ${nbMatchLbl} par similarité · ${nbSel} sélectionné${nbSel > 1 ? "s" : ""}`}
            </div>
          </div>
          <button onClick={onClose} title="Fermer" style={{
            background: "transparent", border: "none", color: T.textMuted, cursor: "pointer", padding: 6,
            borderRadius: RADIUS.sm, display: "inline-flex", alignItems: "center",
          }}><Icon as={X} size={18}/></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {parsing ? (
            <div style={{ padding: 60, textAlign: "center", color: T.textMuted }}>Lecture du fichier…</div>
          ) : error ? (
            <div style={{ padding: 16, borderRadius: RADIUS.md, background: "rgba(225,90,90,0.10)", border: "1px solid rgba(225,90,90,0.3)", color: "#e15a5a", fontSize: FONT.sm.size }}>
              <Icon as={AlertTriangle} size={14} style={{ verticalAlign: "middle", marginRight: 6 }}/>
              {error}
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size }}>
              Aucun ouvrage détecté dans ce fichier.
              {unknownLotHeaders.length > 0 && (
                <div style={{ marginTop: 12, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                  En-têtes potentiels trouvés : {unknownLotHeaders.slice(0, 5).join(" · ")}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Actions globales */}
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => onToggleAll(true)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout cocher</button>
                <button onClick={() => onToggleAll(false)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.textSub, fontSize: FONT.xs.size + 1, cursor: "pointer", fontFamily: "inherit",
                }}>Tout décocher</button>
                {unknownLotHeaders.length > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                    {unknownLotHeaders.length} en-tête{unknownLotHeaders.length > 1 ? "s" : ""} non reconnu{unknownLotHeaders.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Liste groupée par lot */}
              {groups.map(([lotId, lotItems]) => (
                <div key={lotId} style={{ marginBottom: 16 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 10px", marginBottom: 4,
                    background: T.card, borderRadius: RADIUS.sm,
                  }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: lotCouleur(lotId), flexShrink: 0 }}/>
                    <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text, letterSpacing: .5, textTransform: "uppercase" }}>
                      {lotLabel(lotId)}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "1px 7px",
                      borderRadius: RADIUS.pill, background: T.surface, color: T.textMuted,
                    }}>{lotItems.length}</span>
                  </div>
                  {lotItems.map(it => (
                    <div key={it._key} style={{
                      display: "grid",
                      gridTemplateColumns: "24px minmax(0, 1fr) 70px 70px 80px 110px",
                      gap: 8, alignItems: "center",
                      padding: "8px 10px",
                      borderBottom: `1px solid ${T.border}`,
                      opacity: it.selectionne ? 1 : .45,
                    }}>
                      <input type="checkbox" checked={it.selectionne}
                        onChange={e => onUpdateItem(it._key, { selectionne: e.target.checked })}
                        style={{ cursor: "pointer", accentColor: accent }}/>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: FONT.sm.size, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {it.libelle}
                        </div>
                        <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                          {it.match ? (
                            <>
                              <Icon as={Check} size={10} color={it.matchBy === "code" ? "#22c55e" : "#5b8af5"}/>
                              <span>
                                {it.matchBy === "code"
                                  ? <>Match par <strong>code</strong> ({it.code})</>
                                  : <>Match par similarité ({Math.round(it.score * 100)}%)</>}
                                {" · "}{(it.match.sous_taches || []).length} sous-tâche{(it.match.sous_taches || []).length > 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <span style={{ fontStyle: "italic" }}>
                              {it.code ? `Code ${it.code} inconnu en biblio — créé sans tâches` : "Pas de match biblio — créé sans tâches"}
                            </span>
                          )}
                        </div>
                      </div>
                      <input type="number" step="0.5" value={it.heures ?? ""}
                        onChange={e => onUpdateItem(it._key, { heures: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="h" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.quantite ?? ""}
                        onChange={e => onUpdateItem(it._key, { quantite: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="qté" style={{ ...inp, textAlign: "right" }}/>
                      <input type="number" step="0.01" value={it.prix_ht ?? ""}
                        onChange={e => onUpdateItem(it._key, { prix_ht: e.target.value === "" ? null : parseFloat(e.target.value) })}
                        placeholder="€ HT" style={{ ...inp, textAlign: "right" }}/>
                      <select value={it.lot_id || ""}
                        onChange={e => onUpdateItem(it._key, { lot_id: e.target.value || null })}
                        style={{ ...inp, cursor: "pointer" }}>
                        <option value="">Sans lot</option>
                        {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {!parsing && !error && items.length > 0 && `${nbSel} ouvrage${nbSel > 1 ? "s" : ""} à importer`}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.sm.size, cursor: "pointer",
            }}>Annuler</button>
            <button onClick={onConfirm} disabled={parsing || !!error || nbSel === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
                background: (parsing || !!error || nbSel === 0) ? T.border : accent,
                color: (parsing || !!error || nbSel === 0) ? T.textMuted : "#000",
                fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
                cursor: (parsing || !!error || nbSel === 0) ? "default" : "pointer",
              }}>
              <Icon as={Check} size={13}/>
              Importer {nbSel > 0 ? `(${nbSel})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PagePhasageV2;
