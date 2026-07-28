import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { fetchPointages } from "../pointages";
import {
  computeChantierFinance, avancementChantier as cfAvancementChantier,
  couleurMarge, eur, METHODE_CALCUL, SEUIL_RATIO_DERIVE, fmtH as cfFmtH,
} from "../chantierFinance";
import { KpiCard, KpiDetailModal, cfgFromDonnee, LotsTableau } from "./chantierFinanceUI";
import { getCurrentWeek, getWeekId, getBranchAccent, FONT, RADIUS, LOGO_RENO_H } from "../constants";
import { Icon } from "../ui";
import {
  ChartBar, ArrowRight, Check, Clock, FileDown, MessageSquare, RefreshCw, X,
  ChevronLeft, ChevronRight, ChevronDown, Banknote, HardHat, Receipt, Percent,
  TrendingUp, TrendingDown, Target, AlertTriangle,
} from "lucide-react";

// Un chantier est « en cours » par son ACTIVITÉ, pas par un statut : au moins
// un pointage dans les JOURS_ACTIVITE derniers jours OU avancement strictement
// entre 1 % et 99 %. (Même règle que le cron de snapshot hebdo.)
const JOURS_ACTIVITE = 21;

// ─── PAGE BILAN SEMAINE ───────────────────────────────────────────────────────
// Bilan hebdomadaire multi-chantiers, sorti de la modale d'Équipe (étape 3 du
// plan Bilan semaine) : MIGRATION À L'IDENTIQUE — même contenu, même HTML,
// même PDF, mêmes calculs. La page charge elle-même ses données pour la
// semaine sélectionnée (rapports, planning_cells, pointages, bilans_hebdo,
// chantier_avancement_history).

// ─── HEURES PAR JOUR ─────────────────────────────────────────────────────────
// Barème de REPLI du bilan : utilisé uniquement quand la semaine n'a aucun
// pointage (rapports non validés, ou semaines antérieures au registre). Dès
// qu'il existe des pointages, le bilan lit les heures validées directement.
const HEURES_PAR_JOUR = { "Lundi": 10, "Mardi": 10, "Mercredi": 10, "Jeudi": 9, "Vendredi": 9 };

// Priorité des statuts de tâche pour le bilan : la version "la plus avancée"
// l'emporte si la même tâche est déclarée plusieurs fois dans la semaine.
const STATUT_PRIORITE_BILAN = { "faite": 3, "en_cours": 2, "non_faite": 1 };
const normTexteBilan = (s) => (s || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

// Une même tâche peut être déclarée plusieurs fois (plusieurs ouvriers, ou un
// même ouvrier sur plusieurs jours), parfois avec des statuts différents — par
// ex. "non faite" mardi puis "faite" jeudi. Pour le bilan, on ne garde qu'une
// seule version par texte de tâche : celle au statut le plus avancé
// (faite > en_cours > non_faite). Évite qu'une tâche apparaisse à la fois dans
// "Réalisé" et "Non faites".
const filtrerStatutDominant = (taches) => {
  const meilleur = {};
  taches.forEach(t => {
    const key = normTexteBilan(t.planifie || t.text || "");
    if (!key) return;
    const p = STATUT_PRIORITE_BILAN[t.statut] || 0;
    if (meilleur[key] == null || p > meilleur[key]) meilleur[key] = p;
  });
  return taches.filter(t => {
    const key = normTexteBilan(t.planifie || t.text || "");
    if (!key) return true;
    return (STATUT_PRIORITE_BILAN[t.statut] || 0) === meilleur[key];
  });
};

// Fusionne les doublons restants (même texte de tâche, même statut, mais
// déclarés par plusieurs ouvriers ou sur plusieurs jours). Concatène les
// ouvriers et les remarques en évitant les répétitions.
const fusionnerTachesBilan = (taches) => {
  const groupes = {};
  const sansTexte = [];
  taches.forEach(t => {
    const key = normTexteBilan(t.planifie || t.text || "");
    if (!key) { sansTexte.push(t); return; }
    if (!groupes[key]) groupes[key] = { ...t, _ouvriers: new Set(), _remarques: new Set() };
    if (t.ouvrier) groupes[key]._ouvriers.add(t.ouvrier);
    if (t.remarque && t.remarque.trim()) groupes[key]._remarques.add(t.remarque.trim());
  });
  return [
    ...Object.values(groupes).map(g => ({
      ...g,
      ouvrier:  [...g._ouvriers].join(", "),
      remarque: [...g._remarques].join(" · "),
    })),
    ...sansTexte,
  ];
};

// ─── CONTENU DU BILAN ─────────────────────────────────────────────────────────
function BilanSemaineContent({ rapports, chantiers, weekId, onPrevWeek, onNextWeek, T }) {
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [draftStatus, setDraftStatus]     = useState(null);
  // cells (planning_cells) de la semaine BILAN, chargées ici pour la semaine
  // sélectionnée (le filtre de semaine s'applique à TOUTES les sources).
  const [cells, setCells] = useState({});
  const [cellsLoading, setCellsLoading] = useState(false);
  useEffect(() => {
    if (!weekId) return;
    let cancelled = false;
    setCellsLoading(true);
    supabase.from("planning_cells").select("*").eq("week_id", weekId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("Bilan : load cells", error.message); setCellsLoading(false); return; }
        const m = {};
        (data || []).forEach(r => {
          m[`${r.chantier_id}_${r.jour}`] = {
            planifie: r.planifie || "", reel: r.reel || "",
            ouvriers: r.ouvriers || [], taches: r.taches || [],
          };
        });
        setCells(m);
        setCellsLoading(false);
      });
    return () => { cancelled = true; };
  }, [weekId]);

  // ── Pointages de la semaine (registre des heures validées) ──────────────────
  // Source prioritaire du bilan : les heures validées en fin de journée
  // (Validation → table pointages). null = chargement en cours ; [] = aucun
  // pointage → repli sur l'estimation planning × barème (semaines antérieures
  // au registre, ou rapports pas encore validés).
  const [pointages, setPointages] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || "");
      if (!m) { if (!cancelled) setPointages([]); return; }
      const year = parseInt(m[1], 10), week = parseInt(m[2], 10);
      const jan4 = new Date(year, 0, 4);
      const mon = new Date(jan4);
      mon.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
      const dim = new Date(mon); dim.setDate(mon.getDate() + 6);
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const pts = await fetchPointages({ dateFrom: iso(mon), dateTo: iso(dim) });
      if (!cancelled) setPointages(pts || []);
    })();
    return () => { cancelled = true; };
  }, [weekId]);
  const hasPointages = (pointages || []).length > 0;

  // ── Détection ouvriers sur plusieurs chantiers un même jour ─────────────────
  const conflits = (() => {
    const result = [];
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const parOuvrier = {};
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!parOuvrier[o]) parOuvrier[o] = [];
          parOuvrier[o].push(cid);
        });
      });
      Object.entries(parOuvrier).forEach(([ouvrier, chantierIds]) => {
        if (chantierIds.length < 2) return;
        const heuresJour = HEURES_PAR_JOUR[jour];
        const heuresInit = {};
        chantierIds.forEach(cid => { heuresInit[cid] = parseFloat((heuresJour / chantierIds.length).toFixed(1)); });
        result.push({ jour, ouvrier, chantierIds, heures: heuresInit, heuresJour });
      });
    });
    return result;
  })();

  // L'étape n'est décidée qu'une fois les pointages chargés : s'il y en a, la
  // saisie manuelle des conflits est inutile (les heures validées font foi).
  const [etape, setEtape] = useState(null);
  useEffect(() => {
    if (pointages === null) return;
    setEtape(prev => prev ?? ((pointages.length === 0 && conflits.length > 0) ? "saisie" : "bilan"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointages]);
  const [heuresSaisies, setHeuresSaisies] = useState(() => {
    const init = {};
    conflits.forEach(c => {
      if (!init[c.jour]) init[c.jour] = {};
      init[c.jour][c.ouvrier] = { ...c.heures };
    });
    return init;
  });

  const setH = (jour, ouvrier, chantierId, val) => {
    setHeuresSaisies(prev => ({
      ...prev,
      [jour]: { ...prev[jour], [ouvrier]: { ...prev[jour]?.[ouvrier], [chantierId]: val } }
    }));
  };

  // Lecture d'une valeur saisie avec fallback sur la valeur par défaut du
  // conflit (split moitié-moitié). Évite que les calculs de totaux soient à
  // zéro quand l'utilisateur n'a pas encore édité un input — l'input affiche
  // la valeur par défaut, le total doit la prendre en compte aussi.
  const getSaisi = (jour, ouvrier, cid) => {
    const v = heuresSaisies[jour]?.[ouvrier]?.[cid];
    if (v !== undefined && v !== "" && v !== null) return parseFloat(v) || 0;
    const conflit = conflits.find(c => c.jour === jour && c.ouvrier === ouvrier);
    return parseFloat(conflit?.heures[cid]) || 0;
  };

  // ── Calcul heures réelles par chantier ───────────────────────────────────────
  const calcHeuresParChantier = () => {
    const res = {};
    const JOURS = Object.keys(HEURES_PAR_JOUR);
    JOURS.forEach(jour => {
      const heuresJour = HEURES_PAR_JOUR[jour];
      const conflitsJour = conflits.filter(c => c.jour === jour);
      const ouvrierEnConflit = new Set(conflitsJour.map(c => c.ouvrier));
      Object.entries(cells).forEach(([key, cell]) => {
        const parts = key.split("_");
        if (parts[parts.length-1] !== jour) return;
        const cid = parts.slice(0,-1).join("_");
        (cell.ouvriers||[]).forEach(o => {
          if (!res[cid]) res[cid] = 0;
          if (ouvrierEnConflit.has(o)) {
            res[cid] += getSaisi(jour, o, cid);
          } else {
            res[cid] += heuresJour;
          }
        });
      });
    });
    return res;
  };

  // Heures par chantier : somme des pointages validés si la semaine en a,
  // sinon estimation planning × barème (ancien calcul).
  const heuresPointagesParChantier = {};
  (pointages || []).forEach(p => {
    const cid = p.chantier_id || "__divers__";
    heuresPointagesParChantier[cid] = (heuresPointagesParChantier[cid] || 0) + (parseFloat(p.heures) || 0);
  });
  const heuresParChantier = etape === "bilan"
    ? (hasPointages ? heuresPointagesParChantier : calcHeuresParChantier())
    : {};
  const totalHeures = Object.values(heuresParChantier).reduce((a, b) => a + b, 0);

  // ── Présences par chantier ({jour, ouvriers}) ────────────────────────────────
  // Avec pointages : qui a réellement déclaré des heures sur le chantier ce
  // jour-là. Sans pointages : qui était planifié (cells), comme avant.
  const JOURS_SEMAINE_FULL = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const presencesDuChantier = (cId) => {
    const parJour = {};
    if (hasPointages) {
      pointages.forEach(p => {
        if (p.chantier_id !== cId || !p.ouvrier) return;
        if ((parseFloat(p.heures) || 0) <= 0) return;
        const d = new Date((p.date || "") + "T12:00:00");
        const jour = isNaN(d.getTime()) ? null : JOURS_SEMAINE_FULL[d.getDay()];
        if (!jour) return;
        (parJour[jour] = parJour[jour] || new Set()).add(p.ouvrier);
      });
    } else {
      Object.keys(HEURES_PAR_JOUR).forEach(jour => {
        const cell = cells[`${cId}_${jour}`];
        (cell?.ouvriers || []).forEach(o => (parJour[jour] = parJour[jour] || new Set()).add(o));
      });
    }
    const ordre = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
    return ordre.filter(j => parJour[j]?.size).map(j => ({ jour: j, ouvriers: [...parJour[j]] }));
  };

  // ── Regroupement rapports par chantier ───────────────────────────────────────
  const parChantier = {};
  rapports.forEach(r => {
    const key = r.chantier_id || "__divers__";
    if (!parChantier[key]) parChantier[key] = { rapports: [], nom: r.chantier_nom || "Divers" };
    parChantier[key].rapports.push(r);
  });

  // Comptage des tâches "faites" en cohérence avec le PDF : on déduplique par
  // chantier (statut dominant + fusion des doublons), sinon le KPI gonflerait
  // chaque fois qu'une tâche est déclarée par plusieurs ouvriers ou plusieurs
  // jours.
  const totalFaites = Object.values(parChantier).reduce((acc, grp) => {
    const tachesRaw = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier: r.ouvrier})));
    const taches = filtrerStatutDominant(tachesRaw);
    return acc + fusionnerTachesBilan(taches.filter(t => t.statut === "faite")).length;
  }, 0);

  // ── Progression hebdomadaire par chantier ───────────────────────────────────
  // Pour chaque chantier ayant un rapport cette semaine, on récupère le dernier
  // snapshot d'avancement antérieur à lundi (= "avant cette semaine") et on
  // calcule l'avancement actuel depuis plan_travaux (= "maintenant").
  // Le delta donne la progression gagnée durant la semaine.
  const [progressions, setProgressions] = useState({});
  const chantierIdsKey = JSON.stringify(Object.keys(parChantier));
  useEffect(() => {
    if (etape !== "bilan") return;
    let cancelled = false;
    (async () => {
      // Lundi 00:00 de la semaine DU BILAN (pas de la semaine courante — le
      // filtre de semaine s'applique à toutes les sources). Même convention
      // que le chargement des pointages ci-dessus.
      const m = /^(\d{4})-W(\d{1,2})$/.exec(weekId || "");
      const today = new Date(); today.setHours(0,0,0,0);
      let lundi;
      if (m) {
        const year = parseInt(m[1], 10), week = parseInt(m[2], 10);
        const jan4 = new Date(year, 0, 4);
        lundi = new Date(jan4);
        lundi.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
      } else {
        const dow = today.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        lundi = new Date(today); lundi.setDate(today.getDate() + diff);
      }
      const lundiIso = `${lundi.getFullYear()}-${String(lundi.getMonth() + 1).padStart(2, "0")}-${String(lundi.getDate()).padStart(2, "0")}`;

      const chantierIds = JSON.parse(chantierIdsKey).filter(k => k !== "__divers__");
      if (chantierIds.length === 0) return;

      const [phasagesQ, snapshotsQ] = await Promise.all([
        // plan_travaux contient meta.prix_vendu (montant chantier TTC vendu).
        // Sert au calcul "delta % → delta €" affiché à côté de la progression.
        supabase.from("phasages").select("chantier_id, plan_travaux, ouvrages").in("chantier_id", chantierIds),
        supabase.from("chantier_avancement_history")
          .select("chantier_id, avancement, date_snapshot")
          .in("chantier_id", chantierIds)
          .lt("date_snapshot", lundiIso)
          .order("date_snapshot", { ascending: false }),
      ]);
      if (cancelled) return;

      // Snapshot le plus récent par chantier avant lundi
      const snapshotByCh = {};
      (snapshotsQ.data || []).forEach(s => {
        if (!snapshotByCh[s.chantier_id]) snapshotByCh[s.chantier_id] = s;
      });

      // Avancement actuel + prix vendu par chantier (mêmes formules que
      // phasageToChantier pour rester cohérent).
      const actuelByCh   = {};
      const prixVenduByCh = {};
      (phasagesQ.data || []).forEach(ph => {
        const plan = ph.plan_travaux || {};
        prixVenduByCh[ph.chantier_id] = parseFloat(plan.meta?.prix_vendu) || 0;
        // V2 : avancement du module chantierFinance (formule Phasage V2 — la
        // source de vérité, y compris l'arrondi par ouvrage avant pondération).
        const ouvrages = Array.isArray(ph.ouvrages) ? ph.ouvrages : [];
        if (ouvrages.length > 0) {
          actuelByCh[ph.chantier_id] = cfAvancementChantier(ouvrages);
          return;
        }
        // Repli V1 : plan_travaux
        const allTaches = [];
        for (const k of Object.keys(plan)) {
          if (k === "meta" || k.includes("__")) continue;
          if (Array.isArray(plan[k])) allTaches.push(...plan[k]);
        }
        if (allTaches.length === 0) { actuelByCh[ph.chantier_id] = 0; return; }
        const totalHV = allTaches.reduce((s, t) => s + (parseFloat(t.heures_vendues) || 0), 0);
        const av = totalHV > 0
          ? Math.round(allTaches.reduce((s, t) => s + ((parseFloat(t.avancement) || 0) * (parseFloat(t.heures_vendues) || 0)), 0) / totalHV)
          : Math.round(allTaches.reduce((s, t) => s + (parseFloat(t.avancement) || 0), 0) / allTaches.length);
        actuelByCh[ph.chantier_id] = av;
      });

      const map = {};
      chantierIds.forEach(cid => {
        const avant     = snapshotByCh[cid]?.avancement;
        const maintenant = actuelByCh[cid];
        if (maintenant == null) return;
        const delta = avant != null ? (maintenant - avant) : null;
        const prixVendu = prixVenduByCh[cid] || 0;
        map[cid] = {
          avant:      avant ?? null,
          maintenant,
          delta,
          deltaEuros: (delta != null && prixVendu > 0) ? Math.round(prixVendu * delta / 100) : null,
          prixVendu,
          dateAvant:  snapshotByCh[cid]?.date_snapshot || null,
        };
      });
      setProgressions(map);
    })();
    return () => { cancelled = true; };
  }, [etape, weekId, chantierIdsKey]);

  // ── Finances par chantier (module chantierFinance — mêmes chiffres que
  // Phasage V2, au centime). Lecture À DATE : phasages + tous les pointages +
  // lignes de commande + réglages, indépendamment de la semaine affichée.
  const [finData, setFinData] = useState(null); // { finByCh, actifs:Set }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [phQ, cfgTaux, cfgTauxMO, cfgLots] = await Promise.all([
          supabase.from("phasages").select("*"),
          supabase.from("planning_config").select("value").eq("key", "taux_horaires").maybeSingle(),
          supabase.from("planning_config").select("value").eq("key", "taux_mo_previsionnel").maybeSingle(),
          supabase.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle(),
        ]);
        const phasages = phQ.data || [];
        const tauxHoraires = cfgTaux.data?.value || {};
        const tauxMOPrev = parseFloat(cfgTauxMO.data?.value) || 0;
        const items = cfgLots.data?.value?.items;
        const lotsCfg = Array.isArray(items) && items.length > 0
          ? items.map((l, i) => ({ id: l.id || `lot_${i}`, label: l.label || `Lot ${i + 1}`, couleur: l.couleur || l.color || "#888888" }))
          : [];
        // Pointages + lignes de commande : PAGINÉS (la limite Supabase de
        // 1 000 lignes par requête tronquerait les chantiers volumineux).
        const fetchTout = async (table, select) => {
          const out = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from(table).select(select).range(from, from + 999);
            if (error) { console.warn(`Bilan finances: ${table}`, error.message); break; }
            out.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
          return out;
        };
        const [pts, cls] = await Promise.all([
          fetchTout("pointages", "*"),
          fetchTout("commande_lignes", "id, libelle, reference, quantite, unite, prix_unitaire, prix_total, materiau_id, lot_id, ouvrage_id, chantier_id, commande:commandes(fournisseur_nom)"),
        ]);
        if (cancelled) return;
        const ptsBy = {}, clsBy = {};
        pts.forEach(p => { (ptsBy[p.chantier_id] ||= []).push(p); });
        cls.forEach(l => { (clsBy[l.chantier_id] ||= []).push(l); });

        const seuilActif = (() => {
          const d = new Date(); d.setDate(d.getDate() - JOURS_ACTIVITE);
          return d.toISOString().slice(0, 10);
        })();
        const finByCh = {}, actifs = new Set();
        phasages.forEach(ph => {
          if (!ph.chantier_id) return;
          const fin = computeChantierFinance({
            phasage: ph, pointages: ptsBy[ph.chantier_id] || [],
            commandeLignes: clsBy[ph.chantier_id] || [],
            tauxHoraires, tauxMOPrev, lots: lotsCfg,
          });
          finByCh[ph.chantier_id] = fin;
          const av = fin.brut.avancementChantier;
          const recent = (fin.fraicheur.dernierPointage || "") >= seuilActif;
          if (recent || (av > 0 && av < 100)) actifs.add(ph.chantier_id);
        });
        setFinData({ finByCh, actifs });
      } catch (e) {
        console.warn("Bilan finances:", e?.message || e);
        if (!cancelled) setFinData({ finByCh: {}, actifs: new Set() });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Accordéon + sélection PDF ──
  const [expandedCh, setExpandedCh] = useState({});
  const [selPdf, setSelPdf] = useState({});
  const [includeFinances, setIncludeFinances] = useState(true); // drapeau : bilan sans marges possible
  const [kpiModal, setKpiModal] = useState(null); // { donnee, chantierNom }
  const nbSelectionnes = Object.values(selPdf).filter(Boolean).length;
  const todayRefISO = new Date().toISOString().slice(0, 10);

  // Liste des chantiers du bilan : ceux qui ont des rapports cette semaine ∪
  // les chantiers ACTIFS (un chantier silencieux est une information, pas un
  // vide → badge « aucune activité cette semaine »).
  const chantiersBilan = useMemo(() => {
    const ids = new Set(Object.keys(parChantier));
    (finData ? [...finData.actifs] : []).forEach(id => ids.add(id));
    return [...ids].sort((a, b) => {
      const na = parChantier[a]?.nom || chantiers.find(c => c.id === a)?.nom || a;
      const nb = parChantier[b]?.nom || chantiers.find(c => c.id === b)?.nom || b;
      return String(na).localeCompare(String(nb));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierIdsKey, finData]);

  // Présentation (icône + couleur) des indicateurs pour la modale de
  // ventilation — le contenu vient des Donnee du module.
  const KPI_PRES = {
    venduHT: { icon: Banknote, color: "#f5c400" },
    heuresReelles: { icon: Clock, color: "#5b9cf6" },
    moPrev: { icon: Target, color: "#818cf8" },
    matPrev: { icon: Receipt, color: "#fb923c" },
    moReel: { icon: HardHat, color: "#60a5fa" },
    matReel: { icon: Receipt, color: "#f97316" },
    fg: { icon: Percent, color: "#a78bfa" },
    marge: { icon: TrendingUp, color: "#22c55e" },
  };
  const ouvrirVentilation = (donnee, chantierNom) => setKpiModal({ donnee, chantierNom });

  // Total € généré cette semaine : somme des delta € positifs des progressions.
  // Les chantiers en régression (delta < 0) ne sont pas comptés ici (le total
  // représente la valeur AJOUTÉE durant la semaine, pas un solde).
  const totalGenereEuros = Object.values(progressions).reduce(
    (s, p) => s + (p?.deltaEuros && p.deltaEuros > 0 ? p.deltaEuros : 0), 0
  );

  // ── Compléments de bilan saisis par le conducteur (Supabase bilans_hebdo) ────
  // Deux listes libres, par semaine et par chantier : les blocages/arbitrages
  // et le point "semaine suivante". Stockés dans une ligne par week_id.
  // En base, le champ JSON utilise "semaine_suivante" (snake) ; en state on
  // garde "semaineSuivante" (camel) — on mappe au chargement et à l'upsert.
  const [bilanExtras, setBilanExtras] = useState({ blocages: [], semaineSuivante: [] });

  useEffect(() => {
    if (!weekId) return;
    let cancelled = false;
    supabase.from("bilans_hebdo").select("data").eq("week_id", weekId).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.warn("Bilan extras : load", error.message); return; }
        const d = data?.data || {};
        setBilanExtras({
          blocages:        Array.isArray(d.blocages)         ? d.blocages         : [],
          semaineSuivante: Array.isArray(d.semaine_suivante) ? d.semaine_suivante : [],
        });
      });
    return () => { cancelled = true; };
  }, [weekId]);

  // Upsert débounçé (~800 ms). On persiste depuis updateExtras uniquement, pas
  // au chargement, pour ne pas réécrire la ligne inutilement à l'ouverture.
  const extrasSaveTimer = useRef(null);
  const persistExtras = useCallback((next) => {
    if (!weekId) return;
    if (extrasSaveTimer.current) clearTimeout(extrasSaveTimer.current);
    extrasSaveTimer.current = setTimeout(async () => {
      const { error } = await supabase.from("bilans_hebdo").upsert({
        week_id:    weekId,
        data:       { blocages: next.blocages, semaine_suivante: next.semaineSuivante },
        updated_at: new Date().toISOString(),
      }, { onConflict: "week_id" });
      if (error) console.warn("Bilan extras : save", error.message);
    }, 800);
  }, [weekId]);

  // Mutateur unique utilisé par l'UI de saisie (étapes 3-4) : met à jour le
  // state ET déclenche la sauvegarde débounçée.
  const updateExtras = useCallback((updater) => {
    setBilanExtras(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      persistExtras(next);
      return next;
    });
  }, [persistExtras]);

  // ── Suggestions de blocages : tâches "en cours" depuis 3 semaines ou plus ────
  // On croise l'historique des rapports sur une fenêtre de 5 semaines. Une tâche
  // encore "en cours" cette semaine ET marquée "en cours" sur au moins 3 semaines
  // distinctes est proposée (jamais ajoutée automatiquement) au conducteur.
  const [suggestions, setSuggestions] = useState([]);
  useEffect(() => {
    if (etape !== "bilan" || !weekId) return;
    const chantierIds = JSON.parse(chantierIdsKey).filter(k => k !== "__divers__");
    if (chantierIds.length === 0) { setSuggestions([]); return; }

    // Fenêtre glissante de 5 weekId (semaine du bilan + 4 précédentes).
    const prevWeekId = (wid) => {
      const m = /^(\d{4})-W(\d{2})$/.exec(wid || "");
      if (!m) return null;
      let y = +m[1], w = +m[2] - 1;
      if (w <= 0) { w += 52; y -= 1; }
      return getWeekId(y, w);
    };
    const windowIds = [weekId];
    let cur = weekId;
    for (let i = 0; i < 4; i++) { cur = prevWeekId(cur); if (!cur) break; windowIds.push(cur); }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("rapports")
        .select("semaine, chantier_id, taches")
        .in("semaine", windowIds).in("chantier_id", chantierIds);
      if (cancelled) return;
      if (error) { console.warn("Suggestions blocages : load", error.message); return; }

      // chantier -> semaine -> tâches cumulées
      const byCW = {};
      (data || []).forEach(r => {
        if (!r.chantier_id) return;
        (byCW[r.chantier_id] ||= {});
        (byCW[r.chantier_id][r.semaine] ||= []).push(...(r.taches || []));
      });

      const sugg = [];
      Object.entries(byCW).forEach(([cid, weeks]) => {
        const enCoursWeeks = {}, labelOf = {};
        Object.entries(weeks).forEach(([wk, taches]) => {
          // Statut dominant par semaine : une tâche déclarée "en cours" puis
          // "faite" la même semaine ne compte pas comme restée bloquée.
          filtrerStatutDominant(taches).filter(t => t.statut === "en_cours").forEach(t => {
            const key = normTexteBilan(t.planifie || t.text || "");
            if (!key) return;
            (enCoursWeeks[key] ||= new Set()).add(wk);
            labelOf[key] = t.planifie || t.text || "";
          });
        });
        Object.entries(enCoursWeeks).forEach(([key, wset]) => {
          if (wset.has(weekId) && wset.size >= 3) {
            sugg.push({ chantier_id: cid, chantier_nom: parChantier[cid]?.nom || "", texte: labelOf[key], normKey: key, semaines: wset.size });
          }
        });
      });
      setSuggestions(sugg);
    })();
    return () => { cancelled = true; };
  }, [etape, weekId, chantierIdsKey]);

  // ── Création brouillon Gmail ─────────────────────────────────────────────────
  const [generatingDoc, setGeneratingDoc] = useState(false);
  const [showNotes, setShowNotes]         = useState(false);
  const [notesLibres, setNotesLibres]     = useState("");

  const genererDocx = async () => {
    setGeneratingDoc(true);
    setDraftStatus(null);
    try {
      const hpc = hasPointages ? heuresPointagesParChantier : calcHeuresParChantier();
      const totalH = Object.values(hpc).reduce((a, b) => a + b, 0);

      // ── Dédoublonnage des tâches : si plusieurs ouvriers ont rendu la même
      //    tâche, on fusionne en une seule entrée avec la liste des ouvriers
      //    et les remarques concaténées (uniques).
      const normTexte = (s) => (s||"").toLowerCase().replace(/\s+/g," ").trim();
      const dedupe = (rawList) => {
        const map = {};
        rawList.forEach(t => {
          const key = normTexte(t.texte);
          if (!key) return;
          if (!map[key]) map[key] = { texte: t.texte, remarques: new Set(), ouvriers: new Set() };
          if (t.remarque && t.remarque.trim()) map[key].remarques.add(t.remarque.trim());
          if (t.ouvrier) map[key].ouvriers.add(t.ouvrier);
        });
        return Object.values(map).map(v => ({
          texte: v.texte,
          remarque: [...v.remarques].join(" · "),
          ouvrier: [...v.ouvriers].join(", "),
        }));
      };
      const dedupeRemarques = (rawList) => {
        const map = {};
        rawList.forEach(r => {
          const key = normTexte(r.texte);
          if (!key) return;
          if (!map[key]) map[key] = { texte: r.texte, ouvriers: new Set() };
          if (r.ouvrier) map[key].ouvriers.add(r.ouvrier);
        });
        return Object.values(map).map(v => ({
          texte: v.texte,
          ouvrier: [...v.ouvriers].join(", "),
        }));
      };

      // Construire les données structurées pour le document
      const chantierData = Object.entries(parChantier).map(([cId, grp]) => {
        const hCh = hpc[cId] || 0;
        const tachesRaw = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier: r.ouvrier})));
        // Une tâche déclarée "non faite" puis "faite" plus tard dans la
        // semaine ne doit apparaître que dans "Réalisé". On filtre par statut
        // dominant avant de partitionner.
        const taches = filtrerStatutDominant(tachesRaw);
        const presences = presencesDuChantier(cId).map(({ jour, ouvriers }) => `${jour} : ${ouvriers.join(", ")}`);
        const rawFaites    = taches.filter(t=>t.statut==="faite")    .map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier }));
        const rawEnCours   = taches.filter(t=>t.statut==="en_cours") .map(t=>({ texte: t.planifie||t.text||"", remarque: t.remarque||"", ouvrier: t.ouvrier }));
        const rawRemarques = grp.rapports.filter(r=>r.remarque?.trim()).map(r=>({ ouvrier: r.ouvrier, texte: r.remarque }));
        const prog = progressions[cId] || null;
        // Blocages / points semaine suivante saisis par le conducteur pour CE chantier.
        const blocages        = (bilanExtras.blocages || []).filter(b => b.chantier_id === cId && (b.texte || "").trim())
          .map(b => ({ texte: b.texte, statut: b.statut }));
        const semaineSuivante = (bilanExtras.semaineSuivante || []).filter(s => s.chantier_id === cId && (s.texte || "").trim())
          .map(s => ({ texte: s.texte }));
        return {
          nom: grp.nom,
          heures: hCh,
          presences,
          faites:    dedupe(rawFaites),
          enCours:   dedupe(rawEnCours),
          remarques: dedupeRemarques(rawRemarques),
          blocages,
          semaineSuivante,
          // Progression hebdo : avancement avant/après, delta et delta € (peut
          // être null si pas de snapshot antérieur à cette semaine)
          progression: prog ? {
            avant:      prog.avant,
            maintenant: prog.maintenant,
            delta:      prog.delta,
            deltaEuros: prog.deltaEuros,
            dateAvant:  prog.dateAvant,
          } : null,
        };
      });

      // Décisions attendues, tous chantiers confondus (résumé exécutif du .docx).
      const decisions = (bilanExtras.blocages || [])
        .filter(b => b.statut === "decision" && (b.texte || "").trim())
        .map(b => ({ chantier_nom: b.chantier_nom || "", texte: b.texte }));

      const response = await fetch("/api/generate-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, totalH, chantierData, decisions, notesLibres })
      });

      if (!response.ok) {
        const err = await response.json().catch(()=>({error:"Erreur serveur"}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      // Télécharger le fichier
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Compte-rendu-${weekId}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      setDraftStatus("ok");
    } catch(e) {
      console.error("Erreur génération docx:", e);
      setDraftStatus("error");
    }
    setGeneratingDoc(false);
  };

  // ── HTML stylisé du bilan (utilisé par PDF et envoi mail) ─────────────────
  const buildBilanHTML = () => {
    const esc = (s) => (s || "").toString().replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
    const fmt = (txt) => esc(txt).replace(/\n/g, "<br>");
    const logoUrl = `${window.location.origin}${LOGO_RENO_H}`;

    // ── Palette de marque (sobre, restreinte) ────────────────────────────────
    //   ink   noir profond      jaune Profero    vert avancement
    //   orange alerte sobre     rouge régression gris texte secondaire
    const INK = "#14181c", YELLOW = "#f5c400", GREEN = "#3f9c5f",
          ORANGE = "#d98a2b", RED = "#cf5b5b", GREY = "#8a9099", LINE = "#e6e8ec";

    // Couleur de pastille d'état (partagée entre la synthèse et les blocs) :
    //   vert >= 3 pts · orange 0-3 pts · rouge régression · gris pas de donnée.
    const pastilleDe = (p) => (p && p.delta != null)
      ? (p.delta < 0 ? RED : p.delta < 3 ? ORANGE : GREEN)
      : "#c2c6cc";

    // Chantiers inclus : la SÉLECTION (cases cochées). Un chantier actif sans
    // rapport cette semaine sort quand même (bloc « aucune activité »).
    const idsInclus = chantiersBilan.filter(id => selPdf[id]);

    // Bloc financier d'un chantier — indicateurs du module, jamais recalculés
    // ici. Tableaux protégés contre la coupure entre deux pages (.fin-table).
    const financesHTML = (fin) => {
      if (!includeFinances || !fin) return "";
      const b = fin.brut;
      const margeC = b.margeChantier < 0 ? RED : b.margePctChantier < 15 ? ORANGE : GREEN;
      const cell = (label, val, color = INK) => `
        <td style="padding:7pt 10pt;text-align:center;border-left:1pt solid ${LINE};">
          <div style="font-size:11pt;font-weight:800;color:${color};white-space:nowrap;">${val}</div>
          <div style="font-size:6.5pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${GREY};margin-top:2pt;white-space:nowrap;">${label}</div>
        </td>`;
      const lotsRows = fin.lots.filter(l => !l.vide).map(l => `
        <tr>
          <td style="padding:4pt 8pt;font-size:9pt;color:#2a2f37;border-top:1pt solid #f0f1f3;">${esc(l.label)}</td>
          <td style="padding:4pt 8pt;font-size:9pt;text-align:right;color:#5a616b;border-top:1pt solid #f0f1f3;white-space:nowrap;">${cfFmtH(l.heuresReelles)}h / ${cfFmtH(l.heuresVendues)}h</td>
          <td style="padding:4pt 8pt;font-size:9pt;text-align:right;font-weight:700;color:${INK};border-top:1pt solid #f0f1f3;">${l.avancement}%</td>
          <td style="padding:4pt 8pt;font-size:9pt;text-align:right;font-weight:800;border-top:1pt solid #f0f1f3;color:${l.ratioDerive == null ? GREY : l.ratioDerive > SEUIL_RATIO_DERIVE ? RED : l.ratioDerive > 1 ? ORANGE : GREEN};">
            ${l.ratioDerive == null ? "—" : `×${l.ratioDerive.toFixed(2)}`}
          </td>
        </tr>`).join("");
      return `
        <div class="taches-section">
          ${titreSectionGlobal("Finances", "#6b7280")}
          <table class="fin-table" style="width:100%;border-collapse:collapse;border:1pt solid ${LINE};border-radius:2pt;margin:0 0 7pt;">
            <tr>
              ${cell("Vendu HT", eur(b.prixHTChantier)).replace('border-left:1pt solid ' + LINE + ';', '')}
              ${cell("Coût MO", eur(b.coutMOTotalChantier))}
              ${cell("Matériaux", eur(b.coutMatChantier))}
              ${cell("Frais généraux", eur(b.fgChantier))}
              ${cell("Marge nette", `${b.margeChantier >= 0 ? "+" : ""}${eur(b.margeChantier)}`, margeC)}
              ${cell("Marge %", b.prixHTChantier > 0 ? `${b.margePctChantier.toFixed(1)}%` : "—", margeC)}
            </tr>
          </table>
          ${lotsRows ? `
          <table class="fin-table" style="width:100%;border-collapse:collapse;">
            <tr>
              <th style="padding:3pt 8pt;font-size:6.5pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${GREY};text-align:left;">Lot</th>
              <th style="padding:3pt 8pt;font-size:6.5pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${GREY};text-align:right;">Heures réelles / vendues</th>
              <th style="padding:3pt 8pt;font-size:6.5pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${GREY};text-align:right;">Avancement</th>
              <th style="padding:3pt 8pt;font-size:6.5pt;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${GREY};text-align:right;">Dérive</th>
            </tr>
            ${lotsRows}
          </table>` : ""}
          ${(fin.warnings || []).length > 0 ? `
          <div style="margin-top:5pt;">
            ${fin.warnings.map(w => `<div class="remarque-row" style="font-size:8.5pt;color:${ORANGE};margin:0 0 2pt;line-height:1.4;">⚠ ${esc(w.message)}</div>`).join("")}
          </div>` : ""}
        </div>`;
    };
    const titreSectionGlobal = (label, color) => `<div class="sect-title" style="color:${color};">${label}</div>`;

    const chantierBlocs = idsInclus.map(cId => {
      const grp = parChantier[cId] || { nom: chantiers.find(c => c.id === cId)?.nom || cId, rapports: [] };
      const ch = chantiers.find(c => c.id === cId);
      const couleur = ch?.couleur || "#5b8af5";
      const heures = heuresParChantier[cId] || 0;
      const finCh = finData?.finByCh?.[cId] || null;
      const sansActivite = !parChantier[cId];
      const tachesRaw = grp.rapports.flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier:r.ouvrier})));
      // 1) On ne garde qu'une seule version de chaque tâche, au statut le plus
      //    avancé (faite > en_cours > non_faite) — sinon une tâche "non faite"
      //    mardi puis "faite" jeudi apparaîtrait dans les deux sections.
      // 2) On fusionne ensuite les doublons restants (même texte/même statut
      //    mais déclarés par plusieurs ouvriers ou sur plusieurs jours).
      const taches    = filtrerStatutDominant(tachesRaw);
      const faites    = fusionnerTachesBilan(taches.filter(t => t.statut === "faite"));
      const enCours   = fusionnerTachesBilan(taches.filter(t => t.statut === "en_cours"));
      // Les tâches "non faites" ne sont plus affichées dans le bilan : le
      // document présente uniquement ce qui a avancé cette semaine.
      const remarques = grp.rapports.filter(r => r.remarque?.trim());
      const presences = presencesDuChantier(cId);
      // Blocages et points "semaine suivante" saisis pour CE chantier.
      const blocagesCh = (bilanExtras.blocages || []).filter(b => b.chantier_id === cId && (b.texte || "").trim());
      const suiteCh    = (bilanExtras.semaineSuivante || []).filter(s => s.chantier_id === cId && (s.texte || "").trim());

      const p = progressions[cId];
      const pastille = pastilleDe(p);
      // Progression = élément le plus visible du bloc (affichée en tête à droite).
      let progLigne;
      if (!p || p.maintenant == null) {
        progLigne = `<span style="font-size:9.5pt;color:${GREY};">Avancement non calculé</span>`;
      } else if (p.avant == null) {
        progLigne = `<span style="font-size:9.5pt;color:${GREY};">Avancement </span><strong style="font-size:15pt;color:${INK};">${p.maintenant}%</strong>`;
      } else {
        const c = p.delta > 0 ? GREEN : p.delta < 0 ? RED : ORANGE;
        const sign = p.delta > 0 ? "+" : "";
        const euros = p.deltaEuros != null
          ? `<span style="display:inline-block;margin-left:8pt;padding-left:8pt;border-left:1pt solid ${LINE};color:${c};font-weight:700;font-size:11pt;">${p.deltaEuros > 0 ? "+" : ""}${p.deltaEuros.toLocaleString("fr-FR")} €</span>`
          : "";
        progLigne = `<span style="font-size:9pt;color:${GREY};">${p.avant}% →</span> <strong style="font-size:17pt;color:${INK};letter-spacing:-.01em;">${p.maintenant}%</strong> <span style="color:${c};font-weight:700;font-size:10pt;">${sign}${p.delta} pt${Math.abs(p.delta)>1?"s":""}</span>${euros}`;
      }

      // Liste de tâches. `compact` = version discrète (utilisée pour "Réalisé",
      // qui n'est plus qu'une synthèse détaillée sous le compteur).
      const listeTaches = (items, color, icon, compact = false) => items.length === 0 ? "" : `
        <ul style="margin:0 0 9pt;padding:0;">
          ${items.map(t => `<li style="font-size:${compact ? "9pt" : "10pt"};color:${compact ? "#5a616b" : "#2a2f37"};margin:0 0 ${compact ? "3pt" : "4pt"};padding-left:15pt;position:relative;list-style:none;line-height:1.45;">
            <span style="position:absolute;left:0;top:0;color:${color};font-weight:700;">${icon}</span>${esc(t.planifie||t.text||"")}${t.remarque ? ` <span style="color:${GREY};">— ${esc(t.remarque)}</span>` : ""}${t.ouvrier ? `<span style="color:#b3b8bf;font-size:8pt;"> · ${esc(t.ouvrier)}</span>` : ""}
          </li>`).join("")}
        </ul>`;
      const titreSection = (label, color) => `<div class="sect-title" style="color:${color};">${label}</div>`;
      return `
        <div class="chantier-card" style="border:1pt solid ${LINE};border-left:3pt solid ${couleur};border-radius:3pt;margin:0 0 13pt;overflow:hidden;">
          <table class="card-header" style="width:100%;border-collapse:collapse;background:#fbfbfc;border-bottom:1pt solid ${LINE};">
            <tr>
              <td style="padding:11pt 14pt;vertical-align:middle;">
                <span style="display:inline-block;width:10pt;height:10pt;border-radius:50%;background:${pastille};vertical-align:middle;margin-right:9pt;"></span><span style="font-size:13pt;font-weight:800;color:${INK};vertical-align:middle;letter-spacing:-.01em;">${esc(grp.nom)}</span>
              </td>
              <td style="padding:11pt 14pt;vertical-align:middle;text-align:right;white-space:nowrap;">${progLigne}</td>
            </tr>
          </table>
          <div style="padding:12pt 14pt;">
            ${sansActivite ? `<div style="font-size:9pt;color:${GREY};font-style:italic;margin:0 0 8pt;">Aucune activité cette semaine.</div>` : ""}
            ${financesHTML(finCh)}
            ${faites.length > 0 ? `<div class="taches-section">${titreSection(`✓ ${faites.length} tâche${faites.length>1?"s":""} terminée${faites.length>1?"s":""}`, GREEN)}${listeTaches(faites, GREEN, "✓", true)}</div>` : ""}
            ${enCours.length > 0 ? `<div class="taches-section">${titreSection("En cours", ORANGE)}${listeTaches(enCours, ORANGE, "↻")}</div>` : ""}
            ${blocagesCh.length > 0 ? `
              <div class="taches-section">
                ${titreSection("Blocages / arbitrages", RED)}
                ${blocagesCh.map(b => {
                  const dec = b.statut === "decision";
                  return `<div class="remarque-row" style="background:${dec ? "#fdf6ea" : "#f6f7f9"};border-left:2.5pt solid ${dec ? ORANGE : "#c2c6cc"};padding:6pt 10pt;margin:0 0 5pt;font-size:10pt;color:#2a2f37;border-radius:2pt;line-height:1.45;">${dec ? `<span style="display:inline-block;background:${ORANGE};color:#fff;font-size:6.5pt;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:1.5pt 6pt;border-radius:2pt;margin-right:7pt;vertical-align:middle;">Décision attendue</span>` : ""}${fmt(b.texte)}</div>`;
                }).join("")}
              </div>` : ""}
            ${suiteCh.length > 0 ? `
              <div class="taches-section">
                ${titreSection("Semaine suivante", "#6b7280")}
                ${suiteCh.map(s => `<div class="presence-row" style="font-size:10pt;color:#3a3f47;margin:0 0 4pt;padding-left:15pt;position:relative;line-height:1.45;"><span style="position:absolute;left:0;top:0;color:#9aa0a8;font-weight:700;">→</span>${fmt(s.texte)}</div>`).join("")}
              </div>` : ""}
            ${(presences.length > 0 || heures > 0 || remarques.length > 0) ? `
              <div class="taches-section" style="margin-top:9pt;padding-top:8pt;border-top:1pt solid ${LINE};">
                ${(presences.length > 0 || heures > 0) ? `${titreSection(`Présences${heures > 0 ? ` · ${heures.toFixed(1)} h` : ""}`, "#b3b8bf")}${presences.map(pr => `<div class="presence-row" style="font-size:9pt;color:#7a808a;margin:0 0 2pt;"><strong style="color:#5a616b;">${esc(pr.jour)}</strong> · ${esc(pr.ouvriers.join(", "))}</div>`).join("")}` : ""}
                ${remarques.length > 0 ? `<div style="margin-top:${(presences.length > 0 || heures > 0) ? "6pt" : "0"};">${remarques.map(r => `<div class="remarque-row" style="font-size:9pt;color:#7a808a;margin:0 0 2pt;line-height:1.4;"><strong style="color:#5a616b;">${esc(r.ouvrier)} :</strong> ${fmt(r.remarque)}</div>`).join("")}</div>` : ""}
              </div>` : ""}
          </div>
        </div>`;
    }).join("");

    // Espace insécable français entre les milliers et l'unité € ( )
    const fmtEuros = (n) => `${n.toLocaleString("fr-FR")} €`;

    // ── Encart de synthèse (résumé exécutif, placé sous le bandeau) ──────────
    // Une ligne par chantier (pastille + nom + progression + généré €) puis la
    // liste de TOUTES les décisions attendues, tous chantiers confondus.
    const synthChantiers = idsInclus.map(cId => {
      const grp = parChantier[cId] || { nom: chantiers.find(c => c.id === cId)?.nom || cId };
      const p = progressions[cId];
      const dot = pastilleDe(p);
      let droite;
      if (!p || p.maintenant == null) {
        droite = `<span style="color:${GREY};">n/c</span>`;
      } else if (p.avant == null) {
        droite = `<span style="color:${GREY};">Avancement <strong style="color:${INK};">${p.maintenant}%</strong></span>`;
      } else {
        const c = p.delta > 0 ? GREEN : p.delta < 0 ? RED : ORANGE;
        const sign = p.delta > 0 ? "+" : "";
        const euros = p.deltaEuros != null
          ? ` · <span style="color:${c};font-weight:700;">${p.deltaEuros > 0 ? "+" : ""}${p.deltaEuros.toLocaleString("fr-FR")} €</span>`
          : "";
        droite = `<strong style="color:${INK};">${p.maintenant}%</strong> <span style="color:${c};font-weight:700;">${sign}${p.delta} pt${Math.abs(p.delta)>1?"s":""}</span>${euros}`;
      }
      return `<tr>
        <td class="presence-row" style="padding:5pt 0;vertical-align:middle;border-bottom:1pt solid #f0f1f3;"><span style="display:inline-block;width:9pt;height:9pt;border-radius:50%;background:${dot};vertical-align:middle;margin-right:9pt;"></span><span style="font-size:10pt;font-weight:700;color:${INK};vertical-align:middle;">${esc(grp.nom)}</span></td>
        <td class="presence-row" style="padding:5pt 0;text-align:right;font-size:10pt;white-space:nowrap;vertical-align:middle;border-bottom:1pt solid #f0f1f3;">${droite}</td>
      </tr>`;
    }).join("");

    const decisions = (bilanExtras.blocages || []).filter(b => b.statut === "decision" && (b.texte || "").trim());
    const decisionsHTML = decisions.length > 0
      ? decisions.map(b => `<div class="remarque-row" style="font-size:10pt;color:#2a2f37;margin:0 0 5pt;padding-left:16pt;position:relative;line-height:1.45;"><span style="position:absolute;left:0;top:0;color:${ORANGE};font-weight:800;">!</span><strong style="color:${INK};">${esc(b.chantier_nom || "—")}</strong> — ${fmt(b.texte)}</div>`).join("")
      : `<div style="font-size:9pt;color:#a0a5ad;font-style:italic;">Aucune décision en attente</div>`;

    const syntheseHTML = idsInclus.length === 0 ? "" : `
      <div class="synthese" style="border:1pt solid ${INK};border-radius:3pt;margin:0 0 16pt;overflow:hidden;">
        <div style="background:${INK};color:${YELLOW};font-size:8pt;font-weight:800;letter-spacing:.12em;text-transform:uppercase;padding:6pt 14pt;">Synthèse de la semaine</div>
        <div style="padding:10pt 14pt;">
          <table style="width:100%;border-collapse:collapse;">${synthChantiers}</table>
          <div style="margin-top:11pt;padding-top:9pt;border-top:1pt solid ${LINE};">
            <div class="sect-title" style="color:${RED};margin:0 0 6pt;">Décisions attendues</div>
            ${decisionsHTML}
          </div>
        </div>
      </div>`;

    const kpiCell = (val, label, color) => `
      <td style="padding:15pt 14pt;vertical-align:middle;text-align:center;border-left:1pt solid rgba(255,255,255,.10);">
        <div style="color:${color};font-size:15pt;font-weight:800;line-height:1;white-space:nowrap;">${val}</div>
        <div style="color:rgba(255,255,255,.5);font-size:6.5pt;font-weight:700;letter-spacing:.11em;text-transform:uppercase;margin-top:4pt;white-space:nowrap;">${label}</div>
      </td>`;

    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Bilan ${esc(weekId)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Arial,Helvetica,sans-serif;background:#fff;color:#2a2f37;font-size:10pt;line-height:1.55;padding:0;}
  .page{max-width:720pt;margin:0 auto;padding:0;}
  /* Titre de sous-section : un seul style, partout. La couleur est passée en
     inline par titreSection() ; taille/graisse/espacement viennent d'ici. */
  .sect-title{font-size:7.5pt;font-weight:700;letter-spacing:.11em;text-transform:uppercase;margin:0 0 5pt;}
  /* Coupures de page : on protège UNIQUEMENT les unités atomiques (rangée
     présence, item de liste, rangée remarque, headers). Les .taches-section
     sont autorisées à se scinder entre deux pages — c'est ce qui évite les
     gros trous blancs quand une longue liste "Réalisé" (30+ items) ne tient
     pas sur la fin de page. Chaque <li> reste intact donc on ne coupe
     jamais une ligne de texte en deux. */
  .presence-row, .remarque-row, li, .card-header, .bilan-banner, .sect-title,
  .fin-table, .methode-row {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Évite qu'un titre de section ou un en-tête de carte se retrouve
     orphelin en bas de page sans son contenu : push à la page suivante. */
  .card-header, .sect-title { page-break-after: avoid; }
  /* Footer générique répété sur chaque page (running footer Chrome print). */
  @page {
    @bottom-left   { content: "Profero Rénovation"; font-size: 8pt; color: #a0a5ad; font-family: Arial, sans-serif; }
    @bottom-center { content: "Bilan semaine ${esc(weekId)}"; font-size: 8pt; color: #a0a5ad; font-family: Arial, sans-serif; }
    @bottom-right  { content: "Page " counter(page) " / " counter(pages); font-size: 8pt; color: #a0a5ad; font-family: Arial, sans-serif; }
  }
  @page{margin:16mm 15mm;size:A4;}
  @media print {
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#fff;}
    .no-print{display:none!important;}
  }
</style></head><body><div class="page">
  <table class="bilan-banner" style="width:100%;border-collapse:collapse;background:${INK};margin:0 0 16pt;border-radius:3pt;overflow:hidden;">
    <tr>
      <td style="padding:15pt 18pt;vertical-align:middle;width:78pt;">
        <img src="${logoUrl}" alt="Profero" style="height:30pt;object-fit:contain;display:block;"/>
      </td>
      <td style="padding:15pt 10pt;vertical-align:middle;white-space:nowrap;border-left:1pt solid rgba(255,255,255,.10);">
        <div style="color:${YELLOW};font-size:7pt;font-weight:700;letter-spacing:1.6pt;text-transform:uppercase;">Bilan semaine</div>
        <div style="color:#fff;font-size:17pt;font-weight:800;line-height:1.1;margin-top:3pt;letter-spacing:-.01em;">${esc(weekId)}</div>
      </td>
      ${kpiCell(`${totalHeures.toFixed(1)} h`, hasPointages ? "Heures validées" : "Heures estimées", YELLOW)}
      ${kpiCell(`${totalFaites}`, "Tâches", "#5fbf85")}
      ${totalGenereEuros > 0 ? kpiCell(`+${fmtEuros(totalGenereEuros)}`, "Généré", YELLOW) : ""}
    </tr>
  </table>
  ${syntheseHTML}
  ${chantierBlocs || `<div style="text-align:center;padding:40pt;color:${GREY};">Aucun chantier sélectionné pour cette semaine.</div>`}
  ${includeFinances ? `
  <div style="page-break-before:always;">
    <div style="font-size:13pt;font-weight:800;color:${INK};margin:0 0 4pt;">Annexe — Méthode de calcul</div>
    <div style="font-size:8.5pt;color:${GREY};margin:0 0 12pt;">Chaque indicateur du bilan, sa formule et sa source. Générée automatiquement depuis le module de calcul de l'application (les mêmes formules que la page Phasage).</div>
    ${METHODE_CALCUL.map(m => `
    <div class="methode-row" style="border-left:2.5pt solid ${LINE};padding:5pt 10pt;margin:0 0 7pt;">
      <div style="font-size:9.5pt;font-weight:800;color:${INK};">${esc(m.label)}</div>
      <div style="font-size:9pt;color:#2a2f37;line-height:1.45;margin-top:1pt;">${esc(m.formule)}</div>
      <div style="font-size:7.5pt;color:${GREY};margin-top:1pt;">Source : ${esc(m.source)}</div>
    </div>`).join("")}
  </div>` : ""}
  <div style="text-align:center;margin-top:16pt;padding-top:9pt;border-top:1pt solid ${LINE};font-size:8pt;color:#a0a5ad;">Profero Rénovation · Bilan généré le ${new Date().toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"})}</div>
</div></body></html>`;
  };

  // ── Génère le PDF côté client (Blob) à partir du HTML stylisé ─────────────
  // html2pdf utilise html2canvas + jsPDF en interne : rendu fidèle de la mise
  // en page (couleurs, badges, sections) avec pagination automatique A4.
  const generatePDFBlob = async () => {
    const html = buildBilanHTML();
    // On crée un conteneur off-screen plutôt que d'ouvrir une nouvelle fenêtre
    // (html2pdf rend depuis un DOM existant).
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-99999px";
    container.style.top = "0";
    container.style.width = "794px"; // largeur A4 en px (à 96 dpi)
    container.innerHTML = html;
    document.body.appendChild(container);
    // Attendre le chargement du logo
    const img = container.querySelector("img");
    if (img && !img.complete) {
      await new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
        setTimeout(resolve, 2000); // safety timeout
      });
    }
    const opts = {
      // Marges plus généreuses pour éviter que le dernier bloc d'une page
      // dépasse de quelques pixels et soit visuellement coupé.
      margin:      [14, 12, 16, 12],
      filename:    `Bilan-semaine-${weekId}.pdf`,
      image:       { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff",
                     // windowWidth fige le viewport de rendu : sinon html2canvas
                     // peut prendre une mesure du body parent et tronquer.
                     windowWidth: 794 },
      jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
      // mode "css" + "legacy" : respecte page-break-inside:avoid en CSS et
      // détecte les éléments à cheval sur une coupure. avoid étendu à toutes
      // les sous-sections (présences, listes de tâches, remarques) pour qu'un
      // bloc ne soit jamais coupé en plein milieu.
      // avoid SANS .chantier-card NI .taches-section : une longue liste
      // (ex : Réalisé avec 30+ items) doit pouvoir se scinder pour ne pas
      // laisser de gros trous blancs en bas de page. Chaque <li> reste
      // intact donc aucune ligne de texte n'est coupée en deux.
      pagebreak:   {
        mode: ["css", "legacy"],
        avoid: [".bilan-banner", ".card-header",
                ".presence-row", ".remarque-row", "li"],
      },
    };
    try {
      const html2pdf = (await import("html2pdf.js")).default; // chargé à la demande
      const blob = await html2pdf().set(opts).from(container.querySelector(".page") || container).outputPdf("blob");
      return blob;
    } finally {
      document.body.removeChild(container);
    }
  };

  // ── Export PDF : ouvre une nouvelle fenêtre + déclenche le print natif ────
  // Pourquoi window.print() plutôt que html2pdf pour le téléchargement :
  // le navigateur fait du vrai pagination texte (pas de rastérisation) donc
  // les sauts de page sont propres, les blocs ne sont jamais coupés en plein
  // milieu et la qualité est nettement meilleure. L'utilisateur clique
  // "Enregistrer comme PDF" dans la boîte de dialogue.
  // (Pour l'envoi par mail on garde html2pdf via generatePDFBlob — il faut un
  //  Blob binaire pour l'attachement.)
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const genPDFBilan = () => {
    try {
      const html = buildBilanHTML();
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) { alert("La fenêtre d'impression a été bloquée. Autorise les popups pour ce site."); return; }
      w.document.title = `Bilan-semaine-${weekId}`;
      w.document.write(html);
      w.document.close();
      // Attend le chargement du logo avant d'ouvrir le print, sinon il manque
      // dans la prévisualisation.
      w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 350);
    } catch (e) {
      alert("Erreur génération PDF : " + (e.message || e));
    }
  };

  // ── Envoi par mail avec PDF en pièce jointe ───────────────────────────────
  const [showEmail, setShowEmail]   = useState(false);
  const [emailTo, setEmailTo]       = useState("suivi.chantier@groupe-profero.com, loris.bessonneau@groupe-profero.com");
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus]   = useState(null);

  // Convertit un Blob en base64 (sans le préfixe "data:...;base64,")
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => {
      const result = r.result || "";
      const idx = String(result).indexOf("base64,");
      resolve(idx >= 0 ? String(result).slice(idx + 7) : String(result));
    };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const sendBilanEmail = async () => {
    const destinataires = emailTo.split(",").map(s => s.trim()).filter(Boolean);
    if (destinataires.length === 0) { setEmailStatus({ ok: false, msg: "Renseigne au moins un destinataire." }); return; }
    setEmailSending(true);
    setEmailStatus(null);
    try {
      const blob = await generatePDFBlob();
      const base64 = await blobToBase64(blob);
      const filename = `Bilan-semaine-${weekId}.pdf`;
      // Corps du mail léger qui annonce la pj
      const intro = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1f2e;">
        <h2 style="color:#1a1f2e;margin-bottom:8px;">Bilan de la semaine ${weekId}</h2>
        <p style="color:#555;font-size:14px;line-height:1.5;margin-bottom:14px;">
          Bonjour,<br><br>
          Veuillez trouver ci-joint le bilan détaillé de la semaine au format PDF.
          Le document contient le récap par chantier, les progressions hebdo, et les heures cumulées.
        </p>
        <p style="color:#888;font-size:12px;margin-top:18px;">Profero Rénovation · Envoyé automatiquement depuis Profero Planning</p>
      </div>`;
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: destinataires,
          subject: `Bilan de la semaine ${weekId} — Profero Rénovation`,
          html: intro,
          attachments: [{ filename, content: base64 }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEmailStatus({ ok: true, msg: `Envoyé à ${destinataires.length} destinataire${destinataires.length > 1 ? "s" : ""} avec le PDF en pièce jointe.` });
      setTimeout(() => { setShowEmail(false); setEmailStatus(null); }, 2200);
    } catch (e) {
      setEmailStatus({ ok: false, msg: e.message || "Erreur d'envoi" });
    }
    setEmailSending(false);
  };

  // ── Chargement des pointages : l'étape n'est pas encore décidée ─────────────
  if (etape === null) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:60 }}>
        <style>{`@keyframes bilanspin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ background:T.surface, borderRadius:14, padding:"20px 28px",
          border:`1px solid ${T.border}`, color:T.textSub, fontSize:14, display:"flex", alignItems:"center", gap:10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" style={{animation:"bilanspin 1s linear infinite"}}>
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
          </svg>
          Chargement des heures validées…
        </div>
      </div>
    );
  }

  // ── Écran saisie heures (étape 1) ────────────────────────────────────────────
  if (etape === "saisie") {
    return (
      <div style={{ display:"flex", justifyContent:"center" }}>
        <div style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:580,
          display:"flex", flexDirection:"column", overflow:"hidden",
          border:`1px solid ${T.border}`, minHeight:0 }}>
          <div style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
            padding:"20px 24px", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Étape 1 / 2</div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", marginBottom:6 }}>Répartition des heures</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", lineHeight:1.5 }}>
              Ces ouvriers étaient planifiés sur plusieurs chantiers le même jour. Indique combien d'heures ils ont passé sur chaque chantier.
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px", display:"flex", flexDirection:"column", gap:20, minHeight:0 }}>
            {conflits.map((c, idx) => {
              const total = c.chantierIds.reduce((s, cid) => s + getSaisi(c.jour, c.ouvrier, cid), 0);
              const ecart = parseFloat((c.heuresJour - total).toFixed(2));
              const ok = Math.abs(ecart) < 0.05;
              return (
                <div key={idx} style={{ background:T.surface,
                  border:`1px solid ${ok ? T.border : "rgba(224,92,92,0.4)"}`, borderRadius:12, padding:"16px 18px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <div style={{ background:"rgba(255,194,0,0.15)", border:"1px solid rgba(255,194,0,0.3)",
                      borderRadius:6, padding:"3px 10px", fontSize:12, fontWeight:700, color:T.accent }}>{c.jour}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:"#e8eaf0" }}>👷 {c.ouvrier}</div>
                    <div style={{ fontSize:12, color:T.textMuted }}>({c.heuresJour}h dans la journée)</div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {c.chantierIds.map(cid => {
                      const ch = chantiers.find(x => x.id === cid);
                      const val = heuresSaisies[c.jour]?.[c.ouvrier]?.[cid] ?? c.heures[cid];
                      return (
                        <div key={cid} style={{ display:"flex", alignItems:"center", gap:12 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
                            <div style={{ width:10, height:10, borderRadius:3, background:ch?.couleur||"#5b8af5", flexShrink:0 }}/>
                            <div style={{ fontSize:13, fontWeight:700, color:"#e8eaf0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {ch?.nom || cid}
                            </div>
                          </div>
                          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
                            <input type="number" min={0} max={c.heuresJour} step={0.5} value={val}
                              onChange={e => setH(c.jour, c.ouvrier, cid, parseFloat(e.target.value)||0)}
                              style={{ width:68, background:T.fieldBg||"#1a1d28",
                                border:`1.5px solid ${ok ? T.border : "rgba(224,92,92,0.5)"}`,
                                borderRadius:8, padding:"7px 10px", color:"#e8eaf0",
                                fontFamily:"inherit", fontSize:15, fontWeight:700,
                                textAlign:"center", outline:"none" }}/>
                            <span style={{ fontSize:13, color:T.textMuted }}>h</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:12, paddingTop:10, borderTop:`1px solid ${T.border}`,
                    display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:T.textMuted }}>Total saisi</span>
                    <span style={{ fontSize:14, fontWeight:800,
                      color: ok ? "#50c878" : Math.abs(ecart)<1 ? T.accent : "#e05c5c" }}>
                      {total.toFixed(1)}h / {c.heuresJour}h
                      {ok ? " ✓" : ecart>0 ? ` (${ecart.toFixed(1)}h restantes)` : ` (dépassement de ${Math.abs(ecart).toFixed(1)}h)`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ padding:"16px 24px", borderTop:`1px solid ${T.border}`,
            display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
            <button onClick={() => setEtape("bilan")} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: T.accent, border: "none",
              borderRadius: 10, padding: "10px 22px", color: "#111",
              fontFamily: "inherit", fontSize: 14, fontWeight: 800, cursor: "pointer",
            }}>
              Voir le bilan
              <Icon as={ArrowRight} size={14}/>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Saisie blocages / semaine suivante ───────────────────────────────────────
  // Chantiers présents dans le bilan de la semaine (pour les menus déroulants).
  const chantierOptions = Object.entries(parChantier).map(([cId, grp]) => ({ id: cId, nom: grp.nom }));

  const addBlocage = () => updateExtras(prev => ({
    ...prev,
    blocages: [...prev.blocages, {
      chantier_id:  chantierOptions[0]?.id  || "",
      chantier_nom: chantierOptions[0]?.nom || "",
      texte:  "",
      statut: "info",
    }],
  }));
  const updateBlocage = (idx, patch) => updateExtras(prev => ({
    ...prev,
    blocages: prev.blocages.map((b, i) => i === idx ? { ...b, ...patch } : b),
  }));
  const removeBlocage = (idx) => updateExtras(prev => ({
    ...prev,
    blocages: prev.blocages.filter((_, i) => i !== idx),
  }));

  // Ajoute une suggestion détectée comme blocage pré-rempli (statut "info").
  const ajouterSuggestion = (s) => updateExtras(prev => ({
    ...prev,
    blocages: [...prev.blocages, {
      chantier_id:  s.chantier_id,
      chantier_nom: s.chantier_nom,
      texte:  `${s.texte} — en cours depuis ${s.semaines} semaines`,
      statut: "info",
    }],
  }));
  // Suggestions non encore reprises dans les blocages (dédup par préfixe texte).
  const suggestionsVisibles = suggestions.filter(s =>
    !(bilanExtras.blocages || []).some(b => b.chantier_id === s.chantier_id && normTexteBilan(b.texte).startsWith(s.normKey))
  );

  const addPoint = () => updateExtras(prev => ({
    ...prev,
    semaineSuivante: [...prev.semaineSuivante, {
      chantier_id:  chantierOptions[0]?.id  || "",
      chantier_nom: chantierOptions[0]?.nom || "",
      texte: "",
    }],
  }));
  const updatePoint = (idx, patch) => updateExtras(prev => ({
    ...prev,
    semaineSuivante: prev.semaineSuivante.map((p, i) => i === idx ? { ...p, ...patch } : p),
  }));
  const removePoint = (idx) => updateExtras(prev => ({
    ...prev,
    semaineSuivante: prev.semaineSuivante.filter((_, i) => i !== idx),
  }));

  // ── Bilan (étape 2) ──────────────────────────────────────────────────────────
  return (
    <div className="bilan-wrap" style={{ display:"flex", justifyContent:"center" }}>
      <style>{`
        @media(max-width:767px){
          .bilan-page .bilan-header{flex-direction:column;align-items:stretch!important;padding:14px 16px!important;gap:10px}
          .bilan-page .bilan-header > div:first-child > div:nth-child(2){font-size:18px!important}
          .bilan-page .bilan-header-actions{display:flex!important;gap:8px;flex-wrap:wrap}
          .bilan-page .bilan-header-actions > div{flex:1}
          .bilan-page .bilan-header-actions button{flex:1 1 100%}
        }
      `}</style>
      <div style={{ background:T.modal, borderRadius:18, width:"100%", maxWidth:900,
        overflow:"hidden", display:"flex", flexDirection:"column",
        border:`1px solid ${T.border}`, minHeight:0
      }}>

        {/* Header */}
        <div className="bilan-header" style={{ background:"linear-gradient(135deg,#1a1f2e,#252b3d)",
          padding:"22px 28px", display:"flex", alignItems:"center",
          justifyContent:"space-between", borderBottom:`2px solid ${T.accent}`, flexShrink:0 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:3, textTransform:"uppercase", color:T.accent, marginBottom:4 }}>Bilan de la semaine</div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <button onClick={onPrevWeek} title="Semaine précédente" style={{
                background:"rgba(255,255,255,0.08)", border:"none", borderRadius:8,
                width:30, height:30, cursor:"pointer", color:"#fff",
                display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                <Icon as={ChevronLeft} size={16}/>
              </button>
              <div style={{ fontSize:24, fontWeight:800, color:"#fff" }}>{weekId}</div>
              <button onClick={onNextWeek} title="Semaine suivante" style={{
                background:"rgba(255,255,255,0.08)", border:"none", borderRadius:8,
                width:30, height:30, cursor:"pointer", color:"#fff",
                display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                <Icon as={ChevronRight} size={16}/>
              </button>
            </div>
          </div>
          <div className="bilan-header-actions" style={{ display:"flex", gap:20, alignItems:"center" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:T.accent }}>{totalHeures.toFixed(1)}h</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}
                title={hasPointages ? "Somme des pointages validés en fin de journée" : "Estimation depuis le planning (aucun pointage validé cette semaine)"}>
                {hasPointages ? "Heures validées" : "Heures estimées"}
              </div>
            </div>
            <div style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:800, color:"#50c878" }}>{totalFaites}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Tâches faites</div>
            </div>
            {totalGenereEuros > 0 && (
              <div style={{ textAlign:"center" }} title="Somme des progressions hebdo × prix vendu de chaque chantier">
                <div style={{ fontSize:28, fontWeight:800, color:"#f5c400" }}>+{totalGenereEuros.toLocaleString("fr-FR")} €</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>Généré semaine</div>
              </div>
            )}
            <button onClick={()=>setShowNotes(true)} disabled={generatingDoc}
              style={{ background: draftStatus==="ok" ? "rgba(80,200,120,0.85)" : generatingDoc ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.85)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: generatingDoc ? "wait" : "pointer", fontSize:13, fontWeight:700,
                color:"#fff", display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap",
                opacity: generatingDoc ? 0.7 : 1 }}>
              {generatingDoc ? (
                <>
                  <Icon as={RefreshCw} size={13}/> Génération…
                </>
              ) : draftStatus === "ok" ? (
                <>
                  <Icon as={Check} size={13}/> Téléchargé
                </>
              ) : draftStatus === "error" ? (
                <>
                  <Icon as={X} size={13}/> Erreur
                </>
              ) : (
                <>
                  <Icon as={FileDown} size={14}/> Word
                </>
              )}
            </button>
            <button onClick={genPDFBilan} disabled={generatingPDF || nbSelectionnes === 0}
              title={nbSelectionnes === 0 ? "Coche au moins un chantier dans la liste" : "Télécharger le PDF"}
              className="cr-export-btn"
              style={{ background: (generatingPDF || nbSelectionnes === 0) ? "rgba(255,255,255,0.1)" : "rgba(245,196,0,0.92)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: generatingPDF ? "wait" : nbSelectionnes === 0 ? "not-allowed" : "pointer", fontSize:13, fontWeight:700,
                color: (generatingPDF || nbSelectionnes === 0) ? "#fff" : "#1a1a1a",
                opacity: nbSelectionnes === 0 ? 0.6 : 1,
                display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap" }}>
              {generatingPDF ? <><Icon as={RefreshCw} size={13}/> Génération…</> : <><Icon as={FileDown} size={14}/> PDF{nbSelectionnes > 0 ? ` (${nbSelectionnes})` : ""}</>}
            </button>
            <button onClick={() => { setShowEmail(true); setEmailStatus(null); }}
              disabled={nbSelectionnes === 0}
              title={nbSelectionnes === 0 ? "Coche au moins un chantier dans la liste" : "Envoyer le bilan par mail"}
              style={{ background: nbSelectionnes === 0 ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.92)",
                border:"none", borderRadius:10, padding:"0 16px", height:40,
                cursor: nbSelectionnes === 0 ? "not-allowed" : "pointer", fontSize:13, fontWeight:700, color:"#fff",
                opacity: nbSelectionnes === 0 ? 0.6 : 1,
                display:"flex", alignItems:"center", gap:7, whiteSpace:"nowrap" }}>
              ✉ Mail
            </button>
          </div>
        </div>

        {/* Modale envoi mail */}
        {showEmail && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16 }} onClick={() => setShowEmail(false)}>
            <div style={{ background:"#1e2336", borderRadius:16, width:"100%", maxWidth:520,
              border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              display:"flex", flexDirection:"column", overflow:"hidden" }} onClick={e => e.stopPropagation()}>
              <div style={{ padding:"20px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#e8eaf0", marginBottom:6 }}>✉️ Envoyer le bilan par mail</div>
                <div style={{ fontSize:13, color:"#5b6a8a", lineHeight:1.5 }}>
                  Le bilan stylisé est envoyé directement dans le corps du mail (pas de pièce jointe à ouvrir).
                  Compatible avec tous les clients mail et mobiles.
                </div>
              </div>
              <div style={{ padding:"20px 24px" }}>
                <label style={{ fontSize:11, fontWeight:700, color:"#9aa5c0", textTransform:"uppercase", letterSpacing:1, marginBottom:6, display:"block" }}>Destinataires (séparés par virgule)</label>
                <input value={emailTo} onChange={e => setEmailTo(e.target.value)} disabled={emailSending}
                  placeholder="nom@exemple.com, autre@exemple.com"
                  style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1.5px solid rgba(255,255,255,0.12)",
                    borderRadius:10, padding:"11px 14px", color:"#e8eaf0", fontFamily:"inherit",
                    fontSize:13, outline:"none", boxSizing:"border-box" }}/>
                {emailStatus && (
                  <div style={{ marginTop:12, padding:"10px 14px", borderRadius:8,
                    background: emailStatus.ok ? "rgba(80,200,120,0.15)" : "rgba(225,90,90,0.15)",
                    border: `1px solid ${emailStatus.ok ? "rgba(80,200,120,0.4)" : "rgba(225,90,90,0.4)"}`,
                    color: emailStatus.ok ? "#50c878" : "#e15a5a", fontSize:13, fontWeight:600 }}>
                    {emailStatus.ok ? "✓ " : "⚠ "}{emailStatus.msg}
                  </div>
                )}
              </div>
              <div style={{ padding:"16px 24px", borderTop:"1px solid rgba(255,255,255,0.08)",
                display:"flex", gap:10, justifyContent:"flex-end" }}>
                <button onClick={() => setShowEmail(false)} disabled={emailSending} style={{
                  background:"transparent", border:"1px solid rgba(255,255,255,0.15)",
                  borderRadius:10, padding:"10px 20px", color:"#9aa5c0",
                  fontFamily:"inherit", fontSize:14, cursor:"pointer"
                }}>Annuler</button>
                <button onClick={sendBilanEmail} disabled={emailSending} style={{
                  background: emailSending ? "rgba(255,255,255,0.1)" : "rgba(91,138,245,0.9)",
                  border:"none", borderRadius:10, padding:"10px 24px", color:"#fff",
                  fontFamily:"inherit", fontSize:14, fontWeight:800, cursor: emailSending ? "wait" : "pointer"
                }}>{emailSending ? "Envoi…" : "✉ Envoyer"}</button>
              </div>
            </div>
          </div>
        )}

        {/* Modale notes libres */}
        {showNotes&&(
          <div style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:700,
            display:"flex", alignItems:"center", justifyContent:"center", padding:16
          }} onClick={()=>setShowNotes(false)}>
            <div style={{
              background:"#1e2336", borderRadius:16, width:"100%", maxWidth:560,
              border:"1px solid rgba(255,255,255,0.12)", boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
              display:"flex", flexDirection:"column", overflow:"hidden"
            }} onClick={e=>e.stopPropagation()}>
              {/* Header */}
              <div style={{padding:"20px 24px", borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
                <div style={{fontSize:18, fontWeight:800, color:"#e8eaf0", marginBottom:6}}>
                  📝 Enrichir le compte rendu
                </div>
                <div style={{fontSize:13, color:"#5b6a8a", lineHeight:1.6}}>
                  Ajoute ici toutes les précisions que tu veux inclure dans le document :
                  contexte supplémentaire, corrections, points importants, instructions de mise en forme…
                  Ces notes seront transmises à la génération du .docx.
                </div>
              </div>
              {/* Zone texte */}
              <div style={{padding:"20px 24px"}}>
                <textarea
                  value={notesLibres}
                  onChange={e=>setNotesLibres(e.target.value)}
                  placeholder={`Exemple :
- Le chantier LOU a pris du retard à cause des livraisons
- Mettre en avant la bonne avancée sur ARTHUR
- Le vélux a été posé mais avec difficulté, mentionner que c'est soldé
- Ajouter une mention sur les malfaçons corrigées`}
                  autoFocus
                  style={{
                    width:"100%", minHeight:180, background:"rgba(255,255,255,0.05)",
                    border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10,
                    padding:"14px 16px", color:"#e8eaf0", fontFamily:"inherit",
                    fontSize:14, lineHeight:1.7, resize:"vertical", outline:"none",
                    boxSizing:"border-box"
                  }}
                />
                <div style={{fontSize:11, color:"#5b6a8a", marginTop:8}}>
                  Laisse vide pour générer le document sans notes supplémentaires.
                </div>
              </div>
              {/* Footer */}
              <div style={{
                padding:"16px 24px", borderTop:"1px solid rgba(255,255,255,0.08)",
                display:"flex", gap:10, justifyContent:"flex-end"
              }}>
                <button onClick={()=>setShowNotes(false)} style={{
                  background:"transparent", border:"1px solid rgba(255,255,255,0.15)",
                  borderRadius:10, padding:"10px 20px", color:"#9aa5c0",
                  fontFamily:"inherit", fontSize:14, cursor:"pointer"
                }}>Annuler</button>
                <button onClick={()=>{ setShowNotes(false); genererDocx(); }} style={{
                  background:"rgba(91,138,245,0.9)", border:"none",
                  borderRadius:10, padding:"10px 24px", color:"#fff",
                  fontFamily:"inherit", fontSize:14, fontWeight:800, cursor:"pointer"
                }}>📄 Générer le .docx</button>
              </div>
            </div>
          </div>
        )}

        {/* Corps */}
        <div style={{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:16, minHeight:0 }}>
          {Object.keys(parChantier).length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 0", color:T.textMuted, fontSize:15 }}>
              Aucun compte rendu pour cette semaine.
            </div>
          )}

          {/* ── Blocages & arbitrages (saisie conducteur) ────────────────────── */}
          {chantierOptions.length > 0 && (
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 18px", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom: bilanExtras.blocages.length ? 12 : 10 }}>
                <div style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:15, fontWeight:800, color:T.text }}>⚠ Blocages &amp; arbitrages</span>
                </div>
                <div style={{ fontSize:12, color:T.textMuted }}>Points à remonter à la hiérarchie</div>
              </div>

              {suggestionsVisibles.length > 0 && (
                <div style={{ background:"rgba(245,166,35,0.10)", border:"1px solid rgba(245,166,35,0.35)",
                  borderRadius:10, padding:"11px 13px", marginBottom:12 }}>
                  <div style={{ fontSize:12, fontWeight:800, color:"#e0a020", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                    ⚡ Points d'attention détectés
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                    {suggestionsVisibles.map((s, i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                        <div style={{ flex:"1 1 220px", minWidth:0, fontSize:12.5, color:T.textSub, lineHeight:1.4 }}>
                          <strong style={{ color:T.text }}>{s.chantier_nom}</strong> · {s.texte}
                          <span style={{ color:"#e0a020", fontWeight:700 }}> — en cours depuis {s.semaines} sem.</span>
                        </div>
                        <button onClick={() => ajouterSuggestion(s)}
                          style={{ background:"rgba(245,166,35,0.9)", border:"none", borderRadius:8, padding:"6px 12px",
                            color:"#1a1a1a", fontFamily:"inherit", fontSize:12, fontWeight:700, cursor:"pointer",
                            whiteSpace:"nowrap", flexShrink:0 }}>
                          + Ajouter aux blocages
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {bilanExtras.blocages.map((b, idx) => {
                  const isDecision = b.statut === "decision";
                  return (
                    <div key={idx} style={{ display:"flex", flexDirection:"column", gap:8,
                      background:T.card, border:`1px solid ${isDecision ? "rgba(245,166,35,0.55)" : T.border}`,
                      borderRadius:10, padding:"10px 12px" }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <select value={b.chantier_id} onChange={e => {
                            const opt = chantierOptions.find(o => o.id === e.target.value);
                            updateBlocage(idx, { chantier_id: opt?.id || "", chantier_nom: opt?.nom || "" });
                          }}
                          style={{ background:T.fieldBg||"#1a1d28", border:`1px solid ${T.border}`, borderRadius:8,
                            padding:"7px 10px", color:T.text, fontFamily:"inherit", fontSize:13, fontWeight:700,
                            outline:"none", flex:"1 1 160px", minWidth:0, cursor:"pointer" }}>
                          {chantierOptions.map(o => <option key={o.id} value={o.id} style={{ color:"#000" }}>{o.nom}</option>)}
                        </select>
                        <div style={{ display:"inline-flex", borderRadius:8, overflow:"hidden", border:`1px solid ${T.border}` }}>
                          <button onClick={() => updateBlocage(idx, { statut: "info" })}
                            style={{ border:"none", padding:"7px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                              background: !isDecision ? "rgba(91,138,245,0.9)" : "transparent", color: !isDecision ? "#fff" : T.textMuted }}>
                            Pour info
                          </button>
                          <button onClick={() => updateBlocage(idx, { statut: "decision" })}
                            style={{ border:"none", padding:"7px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                              background: isDecision ? "#f5a623" : "transparent", color: isDecision ? "#1a1a1a" : T.textMuted }}>
                            Décision attendue
                          </button>
                        </div>
                        <button onClick={() => removeBlocage(idx)} title="Supprimer ce blocage"
                          style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:8, width:34, height:34,
                            cursor:"pointer", color:T.textMuted, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <Icon as={Trash2} size={14}/>
                        </button>
                      </div>
                      <textarea value={b.texte} onChange={e => updateBlocage(idx, { texte: e.target.value })}
                        placeholder="Décris le blocage ou l'arbitrage attendu…" rows={2}
                        style={{ width:"100%", background:T.fieldBg||"#1a1d28", border:`1px solid ${T.border}`, borderRadius:8,
                          padding:"8px 10px", color:T.text, fontFamily:"inherit", fontSize:13, lineHeight:1.5,
                          resize:"vertical", outline:"none", boxSizing:"border-box" }}/>
                    </div>
                  );
                })}
              </div>
              <button onClick={addBlocage}
                style={{ marginTop: bilanExtras.blocages.length ? 12 : 0, background:"transparent",
                  border:`1.5px dashed ${T.border}`, borderRadius:10, padding:"9px 14px", color:T.textSub,
                  fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer", width:"100%" }}>
                + Ajouter un blocage
              </button>
            </div>
          )}

          {/* ── Semaine suivante (anticipation conducteur) ────────────────────── */}
          {chantierOptions.length > 0 && (
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:14, padding:"16px 18px", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8, marginBottom: bilanExtras.semaineSuivante.length ? 12 : 10 }}>
                <span style={{ fontSize:15, fontWeight:800, color:T.text }}>→ Semaine suivante</span>
                <div style={{ fontSize:12, color:T.textMuted }}>Appro, effectifs, relances à anticiper</div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {bilanExtras.semaineSuivante.map((p, idx) => (
                  <div key={idx} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap",
                    background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 12px" }}>
                    <select value={p.chantier_id} onChange={e => {
                        const opt = chantierOptions.find(o => o.id === e.target.value);
                        updatePoint(idx, { chantier_id: opt?.id || "", chantier_nom: opt?.nom || "" });
                      }}
                      style={{ background:T.fieldBg||"#1a1d28", border:`1px solid ${T.border}`, borderRadius:8,
                        padding:"7px 10px", color:T.text, fontFamily:"inherit", fontSize:13, fontWeight:700,
                        outline:"none", flex:"0 1 150px", minWidth:0, cursor:"pointer" }}>
                      {chantierOptions.map(o => <option key={o.id} value={o.id} style={{ color:"#000" }}>{o.nom}</option>)}
                    </select>
                    <input value={p.texte} onChange={e => updatePoint(idx, { texte: e.target.value })}
                      placeholder="Ex : commander le carrelage, relancer le client…"
                      style={{ flex:"1 1 200px", minWidth:0, background:T.fieldBg||"#1a1d28", border:`1px solid ${T.border}`,
                        borderRadius:8, padding:"8px 10px", color:T.text, fontFamily:"inherit", fontSize:13, outline:"none" }}/>
                    <button onClick={() => removePoint(idx)} title="Supprimer ce point"
                      style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:8, width:34, height:34,
                        cursor:"pointer", color:T.textMuted, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <Icon as={Trash2} size={14}/>
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={addPoint}
                style={{ marginTop: bilanExtras.semaineSuivante.length ? 12 : 0, background:"transparent",
                  border:`1.5px dashed ${T.border}`, borderRadius:10, padding:"9px 14px", color:T.textSub,
                  fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer", width:"100%" }}>
                + Ajouter un point
              </button>
            </div>
          )}

          {/* ── Barre de sélection PDF + drapeau finances ── */}
          {chantiersBilan.length > 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
              background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"8px 14px" }}>
              <label style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:FONT.xs.size + 2, fontWeight:700, color:T.textSub, cursor:"pointer" }}>
                <input type="checkbox"
                  checked={nbSelectionnes > 0 && nbSelectionnes === chantiersBilan.length}
                  onChange={e => {
                    const v = e.target.checked;
                    setSelPdf(Object.fromEntries(chantiersBilan.map(id => [id, v])));
                  }}
                  style={{ width:15, height:15, accentColor:T.accent, cursor:"pointer" }}/>
                Tout sélectionner pour le PDF
              </label>
              <span style={{ fontSize:FONT.xs.size + 1, color:T.textMuted }}>
                {nbSelectionnes} chantier{nbSelectionnes > 1 ? "s" : ""} coché{nbSelectionnes > 1 ? "s" : ""}
              </span>
              <label style={{ marginLeft:"auto", display:"inline-flex", alignItems:"center", gap:7, fontSize:FONT.xs.size + 2, fontWeight:700, color:T.textSub, cursor:"pointer" }}>
                <input type="checkbox" checked={includeFinances}
                  onChange={e => setIncludeFinances(e.target.checked)}
                  style={{ width:15, height:15, accentColor:T.accent, cursor:"pointer" }}/>
                Inclure les finances (page + PDF)
              </label>
            </div>
          )}

          {chantiersBilan.map(cId => {
            const grp = parChantier[cId] || null;
            const ch = chantiers.find(c => c.id === cId);
            const nom = grp?.nom || ch?.nom || cId;
            const heures = heuresParChantier[cId] || 0;
            const detailJours = grp ? presencesDuChantier(cId) : [];
            const toutesTouches = (grp?.rapports || []).flatMap(r => (r.taches||[]).map(t => ({...t, ouvrier:r.ouvrier})));
            const faites    = toutesTouches.filter(t => t.statut==="faite");
            const enCours   = toutesTouches.filter(t => t.statut==="en_cours");
            const nonFaites = toutesTouches.filter(t => t.statut==="non_faite");
            const remarques = (grp?.rapports || []).filter(r => r.remarque?.trim());
            const fin = finData?.finByCh?.[cId] || null;
            const p = progressions[cId];
            const open = !!expandedCh[cId];
            const sansActivite = !grp;
            const alertes = fin?.warnings || [];
            const margeColor = fin ? couleurMarge(fin.brut.margeChantier, fin.brut.margePctChantier) : T.textMuted;
            const avHeader = p?.maintenant ?? fin?.brut?.avancementChantier ?? null;
            const blocagesCh = (bilanExtras.blocages || []).filter(b => b.chantier_id === cId && (b.texte || "").trim());
            const suiteCh    = (bilanExtras.semaineSuivante || []).filter(s => s.chantier_id === cId && (s.texte || "").trim());
            const badge = (children, styleExtra = {}) => (
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700,
                background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"3px 9px",
                color:T.textSub, whiteSpace:"nowrap", ...styleExtra }}>{children}</span>
            );
            return (
              <div key={cId} id={`bilan-ch-${cId}`} style={{ background:T.surface, border:`1px solid ${T.border}`,
                borderRadius:14, overflow:"hidden", borderLeft:`5px solid ${ch?.couleur||"#5b8af5"}`,
                flexShrink: 0 }}>
                {/* ── En-tête replié : pastille · nom · avancement+delta · vendu · marge · alertes ── */}
                <div onClick={() => setExpandedCh(prev => ({ ...prev, [cId]: !prev[cId] }))}
                  style={{ padding:"12px 16px", display:"flex", alignItems:"center", gap:10,
                    flexWrap:"wrap", cursor:"pointer", background: ch ? ch.couleur+"18" : T.card }}>
                  <input type="checkbox" checked={!!selPdf[cId]}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setSelPdf(prev => ({ ...prev, [cId]: e.target.checked }))}
                    title="Inclure ce chantier dans le PDF"
                    style={{ width:16, height:16, accentColor:T.accent, cursor:"pointer", flexShrink:0 }}/>
                  <div style={{ width:12, height:12, borderRadius:4, background:ch?.couleur||"#5b8af5", flexShrink:0 }}/>
                  <div style={{ fontSize:16, fontWeight:800, color:T.text, minWidth:0, overflow:"hidden", textOverflow:"ellipsis" }}>{nom}</div>
                  {sansActivite && badge("aucune activité cette semaine", { color:T.textMuted, fontStyle:"italic" })}
                  {avHeader != null && badge(<>
                    {avHeader}%
                    {p?.delta != null && (
                      <span style={{ color: p.delta > 0 ? "#22c55e" : p.delta < 0 ? "#e15a5a" : T.textMuted, fontWeight:800 }}>
                        {p.delta > 0 ? "+" : ""}{p.delta} pt{Math.abs(p.delta) > 1 ? "s" : ""}
                      </span>
                    )}
                  </>)}
                  {includeFinances && fin && fin.brut.prixHTChantier > 0 && badge(<>{eur(fin.brut.prixHTChantier)}</>)}
                  {includeFinances && fin && badge(
                    <span style={{ color: margeColor, fontWeight:800 }}>
                      {fin.brut.margeChantier >= 0 ? "+" : ""}{eur(fin.brut.margeChantier)}
                    </span>
                  )}
                  {alertes.length > 0 && badge(<>
                    <Icon as={AlertTriangle} size={11} color="#f5a623"/>
                    <span style={{ color:"#f5a623", fontWeight:800 }}>{alertes.length}</span>
                  </>, { borderColor:"rgba(245,166,35,0.4)" })}
                  <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:10 }}>
                    {heures > 0 && (
                      <span style={{ fontSize:13, fontWeight:800, color:T.accent, whiteSpace:"nowrap" }}>
                        {heures.toFixed(1)}h
                      </span>
                    )}
                    <Icon as={ChevronDown} size={16} color={T.textMuted}
                      style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s ease", flexShrink:0 }}/>
                  </div>
                </div>
                {open && (
                <div style={{ padding:"14px 20px", display:"flex", flexDirection:"column", gap:14, borderTop:`1px solid ${T.border}` }}>
                  {/* 1. Progression de la semaine */}
                  {p && (() => {
                    if (p.avant == null) {
                      return (
                        <div style={{
                          display:"inline-flex", alignItems:"center", gap:6, alignSelf:"flex-start",
                          background: T.card, border:`1px solid ${T.border}`,
                          borderRadius:8, padding:"4px 10px",
                          fontSize:11, color:T.textMuted, fontWeight:600,
                        }}>
                          Avancement : <strong style={{ color:T.text }}>{p.maintenant}%</strong>
                          <span style={{ fontStyle:"italic" }}> · pas encore d'historique (1er snapshot le prochain vendredi)</span>
                        </div>
                      );
                    }
                    const deltaColor = p.delta > 0 ? "#22c55e" : p.delta < 0 ? "#e15a5a" : T.textMuted;
                    const deltaSign  = p.delta > 0 ? "+" : "";
                    return (
                      <div style={{
                        display:"inline-flex", alignItems:"center", gap:6, alignSelf:"flex-start",
                        background: deltaColor + "18", border:`1px solid ${deltaColor}55`,
                        borderRadius:8, padding:"4px 10px",
                        fontSize:11, fontWeight:600, color:T.text, flexWrap:"wrap",
                      }}>
                        <span style={{ color: T.textMuted }}>{p.avant}%</span>
                        <span style={{ color: T.textMuted, fontSize:10 }}>→</span>
                        <strong style={{ color: T.text }}>{p.maintenant}%</strong>
                        <span style={{ color: deltaColor, fontWeight:800 }}>
                          ({deltaSign}{p.delta} pt{Math.abs(p.delta) > 1 ? "s" : ""})
                        </span>
                        {p.deltaEuros != null && (
                          <span style={{ color: deltaColor, fontWeight:800, paddingLeft:4, borderLeft:`1px solid ${deltaColor}33` }}>
                            {p.deltaEuros > 0 ? "+" : ""}{p.deltaEuros.toLocaleString("fr-FR")} €
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* 2. Finances (module chantierFinance — mêmes chiffres que Phasage V2) */}
                  {includeFinances && fin && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                        <Icon as={Banknote} size={11}/>
                        Finances
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:8 }}>
                        {["venduHT", "heuresReelles", "moReel", "matReel", "fg", "marge"].map(cle => {
                          const d = fin[cle];
                          const pres = KPI_PRES[cle] || {};
                          const isMarge = cle === "marge";
                          return (
                            <KpiCard key={cle} T={T} icon={pres.icon} iconColor={isMarge ? margeColor : pres.color}
                              label={d.label} value={d.valeurTexte} sub={d.sousLabel}
                              donnee={d} dateRef={todayRefISO}
                              accent={isMarge ? margeColor : undefined} bold={isMarge}
                              onClick={() => ouvrirVentilation(d, nom)}/>
                          );
                        })}
                      </div>
                      {alertes.length > 0 && (
                        <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:4 }}>
                          {alertes.map((w, i) => (
                            <div key={i} style={{ fontSize:FONT.xs.size + 1, color:"#f5a623", display:"flex", gap:6 }}>
                              <Icon as={AlertTriangle} size={12} style={{ flexShrink:0, marginTop:1 }}/>
                              {w.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Lots (ratio de dérive par lot) */}
                  {includeFinances && fin && fin.lots.some(l => !l.vide) && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:6 }}>
                        Lots
                      </div>
                      <LotsTableau lots={fin.lots} T={T} compact/>
                    </div>
                  )}

                  {/* 4. Tâches faites / en cours (existant) */}
                  {faites.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#22c55e", marginBottom:8 }}>
                        <Icon as={Check} size={11}/>
                        Réalisé
                      </div>
                      {faites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#50c878", flexShrink:0 }}>✓</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {enCours.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#f5a623", marginBottom:8 }}>
                        <Icon as={RefreshCw} size={11}/>
                        En cours
                      </div>
                      {enCours.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:T.accent, flexShrink:0 }}>→</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {nonFaites.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#e15a5a", marginBottom:8 }}>
                        <Icon as={X} size={11}/>
                        Non réalisé
                      </div>
                      {nonFaites.map((t,i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#e05c5c", flexShrink:0 }}>✕</span>
                          <span>{t.planifie||t.text||""}{t.remarque && <span style={{color:T.textSub}}> — {t.remarque}</span>}</span>
                          <span style={{ color:T.textMuted, fontSize:12 }}>({t.ouvrier})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 5. Blocages / semaine suivante de CE chantier (saisis plus haut) */}
                  {blocagesCh.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#e15a5a", marginBottom:8 }}>
                        ⚠ Blocages / arbitrages
                      </div>
                      {blocagesCh.map((b, i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:"#f5a623", flexShrink:0 }}>!</span>
                          <span>{b.statut === "decision" && <strong style={{ color:"#f5a623" }}>Décision attendue — </strong>}{b.texte}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {suiteCh.length > 0 && (
                    <div>
                      <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                        → Semaine suivante
                      </div>
                      {suiteCh.map((s, i) => (
                        <div key={i} style={{ fontSize:13, color:T.text, marginBottom:4, display:"flex", gap:8 }}>
                          <span style={{ color:T.textMuted, flexShrink:0 }}>→</span>
                          <span>{s.texte}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 6. Présences et remarques (discret) */}
                  {(detailJours.length > 0 || remarques.length > 0) && (
                    <div style={{ paddingTop:10, borderTop:`1px solid ${T.border}`, opacity:.85 }}>
                      {detailJours.length > 0 && (
                        <div style={{ marginBottom: remarques.length > 0 ? 10 : 0 }}>
                          <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:T.textMuted, marginBottom:8 }}>
                            <Icon as={Clock} size={11}/>
                            Présences
                          </div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                            {detailJours.map(({jour, ouvriers}) => (
                              <div key={jour} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:8, padding:"7px 12px" }}>
                                <div style={{ fontSize:11, fontWeight:700, color:T.textMuted, marginBottom:4 }}>{jour}</div>
                                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                                  {ouvriers.map(o => (
                                    <span key={o} style={{ background:ch?.couleur+"44"||T.tagBg, color:T.text,
                                      borderRadius:4, padding:"1px 7px", fontSize:11, fontWeight:700 }}>{o}</span>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {remarques.length > 0 && (
                        <div>
                          <div style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11, fontWeight:700, letterSpacing:1.5, textTransform:"uppercase", color:"#a0b8ff", marginBottom:8 }}>
                            <Icon as={MessageSquare} size={11}/>
                            Remarques
                          </div>
                          {remarques.map((r,i) => (
                            <div key={i} style={{ fontSize:13, color:T.textSub, marginBottom:4 }}>
                              <strong style={{color:T.text}}>{r.ouvrier}</strong> : {r.remarque}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            );
          })}

          {/* Modale de ventilation d'un indicateur (3e niveau de lecture) */}
          {kpiModal && (
            <KpiDetailModal
              cfg={cfgFromDonnee(kpiModal.donnee, KPI_PRES[kpiModal.donnee.cle] || { icon: Banknote, color: T.accent })}
              sousTitrePrefixe={kpiModal.chantierNom}
              T={T} onClose={() => setKpiModal(null)}/>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE (wrapper) : sélecteur de semaine + chargement des rapports ─────────
// La modale recevait rapports/cells en props déjà filtrés par Équipe (avec ses
// filtres ouvrier/chantier !). La page charge TOUS les rapports de la semaine
// sélectionnée — le contenu du bilan couvre donc toujours la semaine entière.
export default function PageBilanSemaine({ chantiers = [], T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const initial = (() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); })();
  const [weekSel, setWeekSel] = useState(initial);
  const [rapports, setRapports] = useState(null); // null = chargement

  useEffect(() => {
    let cancelled = false;
    setRapports(null);
    supabase.from("rapports").select("*")
      .eq("semaine", weekSel)
      .order("date_rapport", { ascending: false })
      .order("submitted_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn("BilanSemaine : load rapports", error.message);
        setRapports(data || []);
      });
    return () => { cancelled = true; };
  }, [weekSel]);

  // Semaine précédente / suivante — même convention que le reste de l'app
  // (52 semaines par an, cf. listes de semaines d'Équipe et PhasageV2).
  const shiftWeek = (delta) => {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(weekSel || "");
    if (!m) return;
    let y = parseInt(m[1], 10), w = parseInt(m[2], 10) + delta;
    if (w <= 0) { w += 52; y -= 1; }
    if (w > 52) { w -= 52; y += 1; }
    setWeekSel(getWeekId(y, w));
  };

  return (
    <div className="page-padding bilan-page" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg }}>
      {rapports === null ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
          <style>{`@keyframes bilanspin{to{transform:rotate(360deg)}}`}</style>
          <div style={{ background: T.surface, borderRadius: 14, padding: "20px 28px",
            border: `1px solid ${T.border}`, color: T.textSub, fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: "bilanspin 1s linear infinite" }}>
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70"/>
            </svg>
            Chargement des comptes rendus…
          </div>
        </div>
      ) : (
        <BilanSemaineContent key={weekSel} rapports={rapports} chantiers={chantiers}
          weekId={weekSel} onPrevWeek={() => shiftWeek(-1)} onNextWeek={() => shiftWeek(1)} T={T}/>
      )}
    </div>
  );
}
