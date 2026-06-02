import React, { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "./constants";
import { Icon } from "./ui";
import {
  ListChecks, Sparkles, Building2, Boxes, Hammer, ClipboardList,
  ChevronDown, Plus, Trash2, FileSpreadsheet, X, Check, AlertTriangle,
  Pencil,
} from "lucide-react";
import { parseDevisExcel } from "./devisImport";

// ─── PAGE PHASAGE V2 ──────────────────────────────────────────────────────────
// Refonte du phasage : vue 3 colonnes (Lots → Ouvrages → Tâches) pour un
// chantier sélectionné en haut de page. Lit/écrit dans les mêmes tables
// Supabase que la v1 (`phasages`, `bibliotheque_ratios`, `planning_config`).
// Les ouvrages portent un nouveau champ `lot_id` qui les rattache à un lot.

const rid = () => Math.random().toString(36).slice(2, 10);

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
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved"); // saved | pending | saving | error
  const saveTimerRef = useRef(null);
  const newOuvrageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  // Modales d'édition : id de l'ouvrage / de la tâche en cours d'édition
  const [editingOuvrageId, setEditingOuvrageId] = useState(null);
  const [editingTache, setEditingTache] = useState(null); // { ouvrageId, tacheId }
  // Bibliothèque ouvrages (sert au matching à l'import devis)
  const [bibliotheque, setBibliotheque] = useState([]);
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
  const scheduleSave = (ouvragesNext) => {
    setAutoSaveStatus("pending");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      const p = await ensurePhasage();
      if (!p?.id) { setAutoSaveStatus("error"); return; }
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

  // Marge brute = prix HT − coût MO (matériaux pas encore intégrés).
  const margeChantier  = prixHTChantier - coutMOChantier;
  const margePctChantier = prixHTChantier > 0 ? (margeChantier / prixHTChantier) * 100 : 0;
  const fmtEur = (n) => `${Math.round(n).toLocaleString("fr-FR")} €`;

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
      // Tâches : copies des sous_taches de la biblio (juste le nom pour la v2)
      const taches = (it.match?.sous_taches || []).map(st => ({
        id: rid(),
        nom: st.nom || "",
        heures_estimees: null,
        avancement: 0,
      }));
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

        {/* Bouton import devis */}
        {chantierId && (
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFilePicked} style={{ display: "none" }}/>
            <button onClick={() => fileInputRef.current?.click()} style={{
              marginLeft: "auto",
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
                      display: "flex", alignItems: "center", gap: 10 }}
                    onClick={() => { setSelectedLotId(l.id); setSelectedOuvrageId(null); }}>
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
                      display: "flex", alignItems: "center", gap: 10, opacity: .85 }}
                    onClick={() => { setSelectedLotId("_orphans"); setSelectedOuvrageId(null); }}>
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
                        style={{ "--bubble-color": bubbleColor, "--av": `${av}%`,
                          display: "flex", alignItems: "center", gap: 10 }}
                        onClick={() => setSelectedOuvrageId(o.id)}>
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

      {/* ── Footer chantier (KPI + barre d'avancement persistante) ── */}
      {chantierId && !loadingPhasage && ouvrages.length > 0 && (() => {
        const margeColor = margeChantier < 0 ? "#e15a5a"
                         : margePctChantier < 15 ? "#f5a623"
                         : "#22c55e";
        return (
          <div style={{
            flexShrink: 0,
            borderTop: `1px solid ${T.border}`,
            background: T.surface,
            padding: "10px 22px 12px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {/* Ligne KPI */}
            <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
              <KpiBlock T={T} label="Vendu" value={fmtEur(prixHTChantier)}/>
              <KpiBlock T={T} label="Coût MO" value={fmtEur(coutMOChantier)}
                accent={coutMOChantier > prixHTChantier && prixHTChantier > 0 ? "#e15a5a" : null}/>
              <KpiBlock T={T} label="Marge" value={`${margeChantier >= 0 ? "+" : ""}${fmtEur(margeChantier)}`}
                sub={prixHTChantier > 0 ? `${margePctChantier.toFixed(1)}%` : null}
                accent={margeColor}/>
            </div>
            {/* Ligne avancement */}
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
          </ItemEditModal>
        );
      })()}
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
        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button onClick={onDelete} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: RADIUS.md,
            border: "1px solid rgba(225,90,90,0.3)", background: "transparent", color: "#e15a5a",
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
          }}>
            <Icon as={Trash2} size={13}/>
            Supprimer
          </button>
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
