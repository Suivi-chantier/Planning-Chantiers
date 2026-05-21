import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, loadPhases } from "./constants";
import { Icon } from "./ui";
import {
  ShoppingCart, Package, Calendar, Check, AlertTriangle, Building2,
  Clock, ArrowRight, Info, X, Mail, Plus, Trash2, Copy, ChevronLeft,
  Send, Edit3,
} from "lucide-react";

// PHASES dynamiques : chargées en state pour pouvoir invalider le useMemo
// quand la liste personnalisée arrive (sinon les phases custom dont l'ID n'est
// pas dans PHASES_DEFAUT sont ignorées au premier rendu).

// ─── HELPERS DATES ───────────────────────────────────────────────────────────
// Lundi (00:00) de la semaine contenant `d`. ISO : lundi = début de semaine.
function lundiSemaine(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay(); // 0=Dim ... 6=Sam
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmtJourMois(d) {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function fmtDateLongue(d) {
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
function numeroSemaine(d) {
  // ISO week number
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil((((x - yearStart) / 86400000) + 1) / 7);
}

// ─── PAGE PRINCIPALE ─────────────────────────────────────────────────────────
export default function PagePlanningCommandes({ chantiers = [], T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [phases, setPhases]       = useState(PHASES_DEFAUT);
  const [phasages, setPhasages]   = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [carteOpen, setCarteOpen] = useState(null); // carte en cours de commande

  // Chargement des phases personnalisées (Admin → Phases)
  useEffect(() => {
    let cancelled = false;
    loadPhases().then(p => { if (!cancelled) setPhases(p); });
    return () => { cancelled = true; };
  }, []);

  // Couleurs harmonisées avec le reste de l'app
  const bg        = T?.bg        || "#1e2128";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // Chargement des phasages
  const loadPhasages = async () => {
    const { data } = await supabase
      .from("phasages")
      .select("id, chantier_id, chantier_nom, plan_travaux, statut");
    setPhasages(data || []);
  };
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadPhasages();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Chargement des fournisseurs (pour les lignes manuelles + sélection rapide)
  useEffect(() => {
    supabase.from("fournisseurs")
      .select("id, nom, email, mail_type")
      .order("nom")
      .then(({ data }) => setFournisseurs(data || []));
  }, []);

  // Appelé après confirmation de commande pour refléter les changements
  const onCommandePassee = async () => {
    await loadPhasages();
    setCarteOpen(null);
  };

  // ── Calcul des 5 semaines glissantes (lundi de la semaine en cours + 4)
  const semaines = useMemo(() => {
    const lundi0 = lundiSemaine(new Date());
    return Array.from({ length: 5 }, (_, i) => {
      const debut = addDays(lundi0, i * 7);
      const fin   = addDays(debut, 6);
      return {
        index: i,
        debut, fin,
        key: debut.toISOString().slice(0, 10),
        label: i === 0 ? "Cette semaine"
             : i === 1 ? "Semaine prochaine"
             : `S+${i}`,
        num: numeroSemaine(debut),
      };
    });
  }, []);

  // ── Extraction de toutes les "cartes phase" : pour chaque phasage,
  //    pour chaque phase ayant __materiaux_prevus non vide.
  const cartesPhase = useMemo(() => {
    const cartes = [];
    phasages.forEach(p => {
      const plan = p.plan_travaux || {};
      const chantier = chantiers.find(c => c.id === p.chantier_id);
      phases.forEach(ph => {
        const mats = plan[ph.id + "__materiaux_prevus"] || [];
        if (!Array.isArray(mats) || mats.length === 0) return;
        const dateISO   = plan[ph.id + "__date_commande"] || null;
        const coutCmd   = parseFloat(plan[ph.id + "__cout_commandes"]) || 0;
        const totalHt   = mats.reduce((s, m) => s + (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0), 0);
        cartes.push({
          id:           `${p.id}::${ph.id}`,
          phasageId:    p.id,
          chantierId:   p.chantier_id,
          chantierNom:  chantier?.nom || p.chantier_nom || "(sans chantier)",
          chantierCouleur: chantier?.couleur || ph.couleur,
          phaseId:      ph.id,
          phaseLabel:   ph.label,
          phaseEmoji:   ph.emoji,
          phaseCouleur: ph.couleur,
          mats,
          totalHt,
          dateISO,
          dateObj:      dateISO ? new Date(dateISO) : null,
          commande:     coutCmd > 0,
          coutCmd,
        });
      });
    });
    return cartes;
  }, [phasages, chantiers, phases]);

  // ── Répartition par semaine + colonne "sans date"
  const cartesParSemaine = useMemo(() => {
    const buckets = semaines.map(() => []);
    const sansDate   = [];
    const dansLeFutur = []; // > S+4
    const enRetard    = []; // < cette semaine et pas encore commandé
    cartesPhase.forEach(c => {
      if (!c.dateObj) { sansDate.push(c); return; }
      const d = new Date(c.dateObj); d.setHours(0, 0, 0, 0);
      // En retard = date dépassée et pas commandé → afficher dans la 1ère colonne ("cette semaine")
      if (d < semaines[0].debut) {
        if (c.commande) {
          // Commande déjà passée → garder dans semaine "en cours" pour visibilité (vert)
          buckets[0].push(c);
        } else {
          enRetard.push(c);
        }
        return;
      }
      // Trouver le bucket
      let placed = false;
      for (let i = 0; i < semaines.length; i++) {
        if (d >= semaines[i].debut && d <= semaines[i].fin) {
          buckets[i].push(c);
          placed = true;
          break;
        }
      }
      if (!placed) dansLeFutur.push(c);
    });
    // Les "en retard" passent en tête de la 1re colonne
    buckets[0] = [...enRetard, ...buckets[0]];
    return { buckets, sansDate, dansLeFutur };
  }, [cartesPhase, semaines]);

  // ── Couleurs d'urgence par carte
  function urgence(carte) {
    if (carte.commande) return {
      bg: "rgba(34,197,94,0.10)", border: "#22c55e55", accent: "#22c55e", label: "Commandé",
    };
    if (!carte.dateObj) return {
      bg: card, border, accent: textMuted, label: "Sans date",
    };
    const d = new Date(carte.dateObj); d.setHours(0, 0, 0, 0);
    if (d < semaines[0].debut) return {
      bg: "rgba(225,90,90,0.10)", border: "#e15a5a66", accent: "#e15a5a", label: "En retard",
    };
    if (d <= semaines[0].fin) return {
      bg: "rgba(249,115,22,0.10)", border: "#f9731666", accent: "#f97316", label: "Cette semaine",
    };
    if (d <= semaines[1]?.fin) return {
      bg: "rgba(245,158,11,0.10)", border: "#f59e0b55", accent: "#f59e0b", label: "Semaine prochaine",
    };
    return {
      bg: card, border, accent: textMuted, label: "À venir",
    };
  }

  // ── Stats globales (pour le header)
  const stats = useMemo(() => {
    const total      = cartesPhase.length;
    const commandees = cartesPhase.filter(c => c.commande).length;
    const enRetard   = cartesParSemaine.enRetard?.length || cartesPhase.filter(c => {
      if (c.commande || !c.dateObj) return false;
      const d = new Date(c.dateObj); d.setHours(0, 0, 0, 0);
      return d < semaines[0].debut;
    }).length;
    const cetteSemaine = cartesParSemaine.buckets[0].filter(c => !c.commande).length;
    return { total, commandees, enRetard, cetteSemaine };
  }, [cartesPhase, cartesParSemaine, semaines]);

  // ── Empty state global : aucun matériau prévisionnel sur aucun phasage
  const aucunMateriau = !loading && cartesPhase.length === 0;

  return (
    <div className="page-padding ppc-page" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: bg }}>
      <style>{`
        .ppc-page .ppc-grid { display: grid; grid-template-columns: repeat(5, minmax(220px, 1fr)); gap: 12px; }
        .ppc-page .ppc-col-empty { color: ${textMuted}; font-style: italic; font-size: ${FONT.xs.size + 1}px; padding: 14px 8px; text-align: center; }
        @media (max-width: 1024px) {
          .ppc-page .ppc-grid-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 8px; }
          .ppc-page .ppc-grid { min-width: 1080px; }
        }
        @media (max-width: 767px) {
          .ppc-page { padding: 14px 12px !important; }
          .ppc-page h1 { font-size: 18px !important; }
          .ppc-page .ppc-stats { gap: 6px !important; }
          .ppc-page .ppc-stats > div { flex: 1; min-width: 0; padding: 8px 10px !important; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{
          width: 36, height: 36, borderRadius: RADIUS.md, flexShrink: 0,
          background: acc.bg10, color: acc.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon as={ShoppingCart} size={20} strokeWidth={2}/>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ fontSize: FONT.xl.size + 4, fontWeight: 800, color: text, letterSpacing: -0.3, margin: 0 }}>
            Planning des commandes
          </h1>
          <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 3 }}>
            Vue sur 5 semaines glissantes — matériaux à commander, classés par date butoir (vendredi S-1).
          </div>
        </div>
      </div>

      {/* ── STATS ── */}
      {!loading && cartesPhase.length > 0 && (
        <div className="ppc-stats" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          {[
            { label: "Total à prévoir", val: stats.total,        color: text,       icon: Package },
            { label: "En retard",        val: stats.enRetard,     color: "#e15a5a", icon: AlertTriangle },
            { label: "Cette semaine",    val: stats.cetteSemaine, color: "#f97316", icon: Clock },
            { label: "Déjà commandé",    val: stats.commandees,   color: "#22c55e", icon: Check },
          ].map(s => (
            <div key={s.label} style={{
              flex: "1 1 160px",
              background: surface, border: `1px solid ${border}`,
              borderRadius: RADIUS.lg, padding: "11px 14px",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: RADIUS.md, flexShrink: 0,
                background: s.color + "18", color: s.color,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon as={s.icon} size={16}/>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FONT.xl.size, fontWeight: 800, color: s.color, letterSpacing: -.4, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 3, fontWeight: 600, letterSpacing: .3 }}>{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CONTENU ── */}
      {loading ? (
        <div style={{ textAlign: "center", color: textMuted, padding: 80, fontSize: FONT.base.size }}>
          Chargement…
        </div>
      ) : aucunMateriau ? (
        <EmptyState T={T} acc={acc}/>
      ) : (
        <>
          {/* Colonnes 5 semaines */}
          <div className="ppc-grid-wrap">
            <div className="ppc-grid">
              {semaines.map((s, i) => (
                <ColonneSemaine
                  key={s.key}
                  semaine={s}
                  cartes={cartesParSemaine.buckets[i]}
                  urgence={urgence}
                  onPasserCommande={setCarteOpen}
                  T={T} surface={surface} card={card} border={border}
                  text={text} textSub={textSub} textMuted={textMuted}
                />
              ))}
            </div>
          </div>

          {/* Section bas : sans date définie */}
          {cartesParSemaine.sansDate.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
                letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10,
              }}>
                <Icon as={Calendar} size={12}/>
                Commandes sans date définie
                <span style={{ color: textMuted, fontWeight: 600 }}>· {cartesParSemaine.sansDate.length}</span>
              </div>
              <div style={{
                background: surface, border: `1px solid ${border}`,
                borderRadius: RADIUS.lg, padding: 12,
                display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10,
              }}>
                {cartesParSemaine.sansDate.map(c => (
                  <CartePhase key={c.id} carte={c} urgenceInfo={{
                    bg: card, border, accent: textMuted, label: "Sans date",
                  }} onPasserCommande={setCarteOpen} T={T} text={text} textSub={textSub} textMuted={textMuted} compact/>
                ))}
              </div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size + 1, color: textMuted, fontStyle: "italic" }}>
                <Icon as={Info} size={11}/>
                Renseigne la date prévue d'une tâche dans le Phasage pour calculer automatiquement la date butoir.
              </div>
            </div>
          )}

          {/* Section bas : au-delà de S+4 */}
          {cartesParSemaine.dansLeFutur.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontSize: FONT.xs.size, fontWeight: 700, color: textMuted,
                letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10,
              }}>
                <Icon as={Clock} size={12}/>
                Au-delà de 5 semaines
                <span style={{ color: textMuted, fontWeight: 600 }}>· {cartesParSemaine.dansLeFutur.length}</span>
              </div>
              <div style={{
                background: surface, border: `1px solid ${border}`,
                borderRadius: RADIUS.lg, padding: 12,
                display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10,
              }}>
                {cartesParSemaine.dansLeFutur.map(c => (
                  <CartePhase key={c.id} carte={c} urgenceInfo={urgence(c)} onPasserCommande={setCarteOpen} T={T} text={text} textSub={textSub} textMuted={textMuted} compact/>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modale "Passer commande" */}
      {carteOpen && (
        <ModalePasserCommande
          carte={carteOpen}
          fournisseurs={fournisseurs}
          chantiers={chantiers}
          onClose={() => setCarteOpen(null)}
          onSuccess={onCommandePassee}
          T={T}
        />
      )}
    </div>
  );
}

// ─── COLONNE SEMAINE ─────────────────────────────────────────────────────────
function ColonneSemaine({ semaine, cartes, urgence, onPasserCommande, T, surface, card, border, text, textSub, textMuted }) {
  const isCurrent = semaine.index === 0;
  return (
    <div style={{
      background: surface, border: `1px solid ${isCurrent ? "#f97316aa" : border}`,
      borderRadius: RADIUS.lg, overflow: "hidden",
      display: "flex", flexDirection: "column", minHeight: 220,
    }}>
      {/* Header colonne */}
      <div style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${border}`,
        background: isCurrent ? "rgba(249,115,22,0.08)" : card,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: isCurrent ? "#f97316" : textMuted, letterSpacing: 1, textTransform: "uppercase" }}>
            {semaine.label}
          </div>
          <div style={{ fontSize: 10, color: textMuted, fontWeight: 600 }}>S{semaine.num}</div>
        </div>
        <div style={{ fontSize: FONT.xs.size + 1, color: text, fontWeight: 600, marginTop: 2 }}>
          {fmtJourMois(semaine.debut)} – {fmtJourMois(semaine.fin)}
        </div>
      </div>

      {/* Cartes */}
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        {cartes.length === 0 ? (
          <div className="ppc-col-empty">Aucune commande</div>
        ) : (
          cartes.map(c => (
            <CartePhase key={c.id} carte={c} urgenceInfo={urgence(c)} onPasserCommande={onPasserCommande} T={T} text={text} textSub={textSub} textMuted={textMuted}/>
          ))
        )}
      </div>
    </div>
  );
}

// ─── CARTE PHASE ─────────────────────────────────────────────────────────────
function CartePhase({ carte, urgenceInfo, onPasserCommande, T, text, textSub, textMuted, compact = false }) {
  const dateFmt = carte.dateObj
    ? carte.dateObj.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : null;
  const dateFmtLong = carte.dateObj ? fmtDateLongue(carte.dateObj) : null;

  return (
    <div style={{
      background: urgenceInfo.bg,
      border: `1px solid ${urgenceInfo.border}`,
      borderRadius: RADIUS.md,
      padding: "9px 10px",
      borderLeft: `3px solid ${carte.chantierCouleur || urgenceInfo.accent}`,
      display: "flex", flexDirection: "column", gap: 6,
    }}>
      {/* Chantier + phase */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size + 1, color: text, fontWeight: 700, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Icon as={Building2} size={10} color={carte.chantierCouleur}/>
          {carte.chantierNom}
        </div>
        <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: carte.phaseCouleur }}>●</span>
          {carte.phaseEmoji ? `${carte.phaseEmoji} ` : ""}{carte.phaseLabel}
        </div>
      </div>

      {/* Liste matériaux (compactée si > 3) */}
      <div style={{ fontSize: FONT.xs.size + 1, color: textSub, lineHeight: 1.45 }}>
        {carte.mats.slice(0, compact ? 2 : 3).map(m => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              <span style={{ color: text, fontWeight: 600 }}>{m.libelle}</span>
              <span style={{ color: textMuted }}> ({m.quantite}{m.unite ? ` ${m.unite}` : ""})</span>
            </span>
            {m.fournisseur_nom && !compact && (
              <span style={{ color: textMuted, flexShrink: 0, fontSize: 10, fontStyle: "italic", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.fournisseur_nom}
              </span>
            )}
          </div>
        ))}
        {carte.mats.length > (compact ? 2 : 3) && (
          <div style={{ color: textMuted, fontSize: 10, marginTop: 2, fontStyle: "italic" }}>
            + {carte.mats.length - (compact ? 2 : 3)} autre{carte.mats.length - (compact ? 2 : 3) > 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Total + badge + date */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: text, fontFamily: "'DM Mono',monospace" }}>
          {carte.totalHt.toFixed(2)} € HT
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: .5,
          padding: "2px 6px", borderRadius: RADIUS.pill, textTransform: "uppercase",
          background: urgenceInfo.accent + "22", color: urgenceInfo.accent,
          border: `1px solid ${urgenceInfo.accent}55`,
          whiteSpace: "nowrap",
        }}>
          {carte.commande ? "✓ Commandé" : urgenceInfo.label}
        </span>
      </div>

      {dateFmt && (
        <div style={{ fontSize: 10, color: textMuted, display: "flex", alignItems: "center", gap: 4 }} title={dateFmtLong}>
          <Icon as={Calendar} size={10}/>
          Avant le {dateFmt}
        </div>
      )}

      {/* Bouton action — ouvre la modale de passage de commande */}
      {!carte.commande && (
        <button onClick={() => onPasserCommande?.(carte)} style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
          marginTop: 2, padding: "6px 10px", borderRadius: RADIUS.sm,
          background: urgenceInfo.accent + "22", color: urgenceInfo.accent,
          border: `1px solid ${urgenceInfo.accent}66`,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
          cursor: "pointer",
          transition: "background .12s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = urgenceInfo.accent + "38"}
          onMouseLeave={e => e.currentTarget.style.background = urgenceInfo.accent + "22"}>
          Passer commande
          <Icon as={ArrowRight} size={11}/>
        </button>
      )}
    </div>
  );
}

// ─── MODALE PASSER COMMANDE (2 étapes) ───────────────────────────────────────
function ModalePasserCommande({ carte, fournisseurs, chantiers, onClose, onSuccess, T }) {
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const accent    = carte.phaseCouleur || "#FFC200";

  // ── Étape : "recap" (1) ou "preview" (2)
  const [etape, setEtape] = useState("recap");

  // ── Lignes éditables (init depuis les matériaux prévisionnels de la phase)
  // Chaque ligne = { uid, source ("prevu"|"manuel"), checked, libelle, quantite,
  //                 unite, prix_ht, fournisseur_id, fournisseur_nom }
  const [lignes, setLignes] = useState(() => carte.mats.map(m => ({
    uid:             m.id || (Math.random().toString(36).slice(2)),
    source:          "prevu",
    checked:         true,
    libelle:         m.libelle || "",
    quantite:        m.quantite || 1,
    unite:           m.unite || "U",
    prix_ht:         m.prix_ht || 0,
    fournisseur_id:  m.fournisseur_id || null,
    fournisseur_nom: m.fournisseur_nom || "",
    materiau_id:     m.materiau_id || null,
  })));

  // ── Date de besoin : depuis __date_commande, ou éditable si absente
  const [dateBesoin, setDateBesoin] = useState(carte.dateISO || "");

  // ── État d'envoi (étape 2)
  const [sending, setSending] = useState(false);
  // Statut par groupe fournisseur : { [fournisseurKey]: "pending"|"sent"|"failed"|"none" }
  const [statutGroupes, setStatutGroupes] = useState({});
  const [globalErr, setGlobalErr] = useState("");

  // ── Helpers
  const setLigne = (uid, patch) => setLignes(prev => prev.map(l => l.uid === uid ? { ...l, ...patch } : l));
  const removeLigne = (uid) => setLignes(prev => prev.filter(l => l.uid !== uid));
  const ajouterLigneManuelle = () => {
    setLignes(prev => [...prev, {
      uid:             "manuel_" + Math.random().toString(36).slice(2),
      source:          "manuel",
      checked:         true,
      libelle:         "",
      quantite:        1,
      unite:           "U",
      prix_ht:         0,
      fournisseur_id:  null,
      fournisseur_nom: "",
      materiau_id:     null,
    }]);
  };

  const lignesCochees = lignes.filter(l => l.checked && (l.libelle?.trim() || "") && (parseFloat(l.quantite) || 0) > 0);
  const totalGlobal = lignesCochees.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0), 0);

  // ── Regroupement par fournisseur pour l'étape 2
  // Clé = fournisseur_id si présent, sinon "nom::<libellé>" si nom texte, sinon "__sans__"
  const groupes = (() => {
    const buckets = new Map();
    lignesCochees.forEach(l => {
      let key, nom, email, mail_type, id = null;
      if (l.fournisseur_id) {
        const f = fournisseurs.find(x => x.id === l.fournisseur_id);
        key = "id::" + l.fournisseur_id;
        id  = l.fournisseur_id;
        nom = f?.nom || l.fournisseur_nom || "(fournisseur supprimé)";
        email = f?.email || null;
        mail_type = f?.mail_type || null;
      } else if (l.fournisseur_nom?.trim()) {
        // Tente un match par nom dans la table fournisseurs (insensible casse)
        const f = fournisseurs.find(x => (x.nom || "").toLowerCase().trim() === l.fournisseur_nom.toLowerCase().trim());
        if (f) {
          key = "id::" + f.id;
          id  = f.id;
          nom = f.nom;
          email = f.email || null;
          mail_type = f.mail_type || null;
        } else {
          key = "nom::" + l.fournisseur_nom.toLowerCase().trim();
          nom = l.fournisseur_nom.trim();
          email = null;
          mail_type = null;
        }
      } else {
        key = "__sans__";
        nom = "Sans fournisseur";
        email = null;
        mail_type = null;
      }
      if (!buckets.has(key)) buckets.set(key, { key, fournisseur_id: id, nom, email, mail_type, lignes: [] });
      buckets.get(key).lignes.push(l);
    });
    return Array.from(buckets.values()).map(g => ({
      ...g,
      total: g.lignes.reduce((s, l) => s + (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0), 0),
    }));
  })();

  // ── Substitution des variables du mail_type
  const fmtMontant = (n) => (parseFloat(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDateBesoin = (iso) => {
    if (!iso) return "à définir";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const listeArticlesTexte = (lignesGr) => lignesGr.map(l => {
    const qte = parseFloat(l.quantite) || 0;
    const pu  = parseFloat(l.prix_ht) || 0;
    return `- ${qte}${l.unite ? ` ${l.unite}` : ""} × ${l.libelle} — ${fmtMontant(pu * qte)} € HT`;
  }).join("\n");

  const TEMPLATE_DEFAUT =
    "Bonjour,\n\nDans le cadre du chantier {chantier} (phase : {phase}), nous souhaitons passer la commande suivante pour le {date_besoin} :\n\n{liste_articles}\n\nTotal HT estimé : {total_ht} €\n\nCordialement,\nProfero Rénovation";

  const construireCorps = (groupe) => {
    const tpl = (groupe.mail_type && groupe.mail_type.trim()) ? groupe.mail_type : TEMPLATE_DEFAUT;
    return tpl
      .replaceAll("{chantier}",       carte.chantierNom || "")
      .replaceAll("{phase}",          carte.phaseLabel || "")
      .replaceAll("{liste_articles}", listeArticlesTexte(groupe.lignes))
      .replaceAll("{date_besoin}",    fmtDateBesoin(dateBesoin))
      .replaceAll("{total_ht}",       fmtMontant(groupe.total));
  };

  const sujetMail = `Commande matériaux — ${carte.chantierNom} (${carte.phaseLabel})`;

  // Construit le HTML d'envoi à partir du corps texte du fournisseur
  const corpsVersHtml = (corpsTexte) => {
    const escape = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
    const body = escape(corpsTexte).replace(/\n/g, "<br>");
    return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1f2e">
  <div style="background:#080a0d;padding:20px 24px;border-radius:10px 10px 0 0;border-bottom:3px solid #FFC200">
    <div style="color:#FFC200;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;margin-bottom:6px">Profero Rénovation · Commande matériaux</div>
    <div style="color:#fff;font-size:18px;font-weight:800">${escape(carte.chantierNom)}</div>
    <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:2px">${escape(carte.phaseLabel)}</div>
  </div>
  <div style="background:#fff;border:1px solid #e0e4ef;border-top:none;border-radius:0 0 10px 10px;padding:24px;font-size:14px;line-height:1.7">
    ${body}
  </div>
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#999">Envoyé via Profero Planning</div>
</div>`;
  };

  // ── Copier dans le presse-papier (fallback si l'envoi échoue)
  const copier = async (texte) => {
    try {
      await navigator.clipboard.writeText(texte);
    } catch {
      // Fallback ancien navigateur
      const ta = document.createElement("textarea");
      ta.value = texte; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  // ── Confirmation : envoi des mails + écriture phasage + commandes_passees
  const confirmer = async () => {
    setSending(true);
    setGlobalErr("");

    // 1) Envoi mails par groupe fournisseur (parallèle)
    const next = {};
    groupes.forEach(g => { next[g.key] = "pending"; });
    setStatutGroupes(next);

    const resultatsEnvoi = await Promise.all(groupes.map(async (g) => {
      if (!g.fournisseur_id && g.key === "__sans__") {
        return { key: g.key, status: "none" }; // Pas d'envoi pour "Sans fournisseur"
      }
      if (!g.email) {
        return { key: g.key, status: "none" }; // Pas d'email connu
      }
      const corps = construireCorps(g);
      const html  = corpsVersHtml(corps);
      try {
        const res  = await fetch("/api/send-email", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ to: g.email, subject: sujetMail, html }),
        });
        const data = await res.json().catch(() => ({}));
        return { key: g.key, status: res.ok ? "sent" : "failed", error: data?.error || (!res.ok ? `HTTP ${res.status}` : null) };
      } catch (e) {
        return { key: g.key, status: "failed", error: e.message };
      }
    }));

    const statutFinal = {};
    resultatsEnvoi.forEach(r => { statutFinal[r.key] = r.status; });
    setStatutGroupes(statutFinal);

    // 2) Écriture phasage : __cout_commandes (additionner) + __commandes_log (push)
    try {
      // Recharger le plan_travaux actuel pour éviter d'écraser une modif concurrente
      const { data: phRow, error: phErr } = await supabase
        .from("phasages")
        .select("plan_travaux")
        .eq("id", carte.phasageId)
        .maybeSingle();
      if (phErr) throw new Error(phErr.message);

      const plan = { ...(phRow?.plan_travaux || {}) };
      const keyCout = carte.phaseId + "__cout_commandes";
      const keyLog  = carte.phaseId + "__commandes_log";
      const ancien  = parseFloat(plan[keyCout]) || 0;
      plan[keyCout] = +(ancien + totalGlobal).toFixed(2);
      const log = Array.isArray(plan[keyLog]) ? plan[keyLog] : [];
      log.push({
        date:         new Date().toISOString(),
        total_ht:     +totalGlobal.toFixed(2),
        fournisseurs: groupes.map(g => g.nom),
        nb_articles:  lignesCochees.length,
      });
      plan[keyLog] = log;

      const { error: updErr } = await supabase.from("phasages")
        .update({ plan_travaux: plan, updated_at: new Date().toISOString() })
        .eq("id", carte.phasageId);
      if (updErr) throw new Error(updErr.message);

      // 3) Insert commandes_passees : une ligne par groupe fournisseur
      const rows = groupes.map(g => ({
        chantier_id:     carte.chantierId,
        phasage_id:      carte.phasageId,
        phase_id:        carte.phaseId,
        phase_label:     carte.phaseLabel,
        fournisseur_id:  g.fournisseur_id || null,
        fournisseur_nom: g.nom,
        articles:        g.lignes.map(l => ({
          libelle:  l.libelle,
          quantite: parseFloat(l.quantite) || 0,
          unite:    l.unite || "U",
          prix_ht:  parseFloat(l.prix_ht) || 0,
          source:   l.source,
        })),
        total_ht:        +g.total.toFixed(2),
        mail_envoye:     statutFinal[g.key] === "sent",
      }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("commandes_passees").insert(rows);
        if (insErr) console.warn("Insert commandes_passees :", insErr.message);
      }

      // 4) Insert dans commandes_detail (une ligne par article) pour que
      //    l'ancienne page Commandes affiche le suivi unifié. Statut "commande"
      //    puisque le mail vient d'être envoyé. Fallback sans colonnes
      //    optionnelles si migration manquante (cf. handleImportLignes).
      const dateTag = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const lignesDetail = lignesCochees.map(l => {
        // Retrouver le nom du fournisseur effectif (texte) pour cette ligne
        let fournisseurNom = l.fournisseur_nom || "";
        if (l.fournisseur_id) {
          const f = fournisseurs.find(x => x.id === l.fournisseur_id);
          if (f) fournisseurNom = f.nom;
        }
        return {
          article:     l.libelle,
          fournisseur: fournisseurNom || "",
          quantite:    String(l.quantite || ""),
          prix_ht:     parseFloat(l.prix_ht) || null,
          statut:      "commande",
          priorite:    "normal",
          materiau_id: l.materiau_id || null,
          phasage_id:  carte.phasageId,
          phase_id:    carte.phaseId,
          notes:       `Commandé via Planning des commandes le ${dateTag}${l.source === "manuel" ? " (ajout manuel)" : ""}`,
        };
      });
      if (lignesDetail.length > 0) {
        const { error: cdErr } = await supabase.from("commandes_detail").insert(lignesDetail);
        if (cdErr) {
          // Colonne optionnelle manquante : retenter sans les colonnes récentes
          if (cdErr.code === "42703") {
            const fallback = lignesDetail.map(({ materiau_id, phasage_id, phase_id, ...rest }) => rest);
            const { error: cdErr2 } = await supabase.from("commandes_detail").insert(fallback);
            if (cdErr2) console.warn("Insert commandes_detail (fallback) :", cdErr2.message);
          } else {
            console.warn("Insert commandes_detail :", cdErr.message);
          }
        }
      }
    } catch (e) {
      setGlobalErr(`La commande a été partiellement enregistrée : ${e.message}`);
      setSending(false);
      return;
    }

    // 4) Refresh côté parent (rafraîchit les cartes du planning + ferme)
    setSending(false);
    onSuccess?.();
  };

  // ── Styles communs
  const inp = {
    background: "rgba(255,255,255,0.06)", border: `1px solid rgba(255,255,255,0.1)`,
    borderRadius: 8, padding: "6px 9px", color: text,
    fontFamily: "inherit", fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 950, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: T?.modal || surface, borderRadius: RADIUS.xl,
        width: "100%", maxWidth: 880, maxHeight: "92vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: `1px solid ${border}`, boxShadow: "0 28px 70px rgba(0,0,0,0.65)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{ width: 38, height: 38, borderRadius: RADIUS.md, background: accent + "22", color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={ShoppingCart} size={18}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: text, letterSpacing: -0.2 }}>
              Passer commande
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: textMuted, marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Icon as={Building2} size={10} color={carte.chantierCouleur}/>
              <strong style={{ color: text }}>{carte.chantierNom}</strong>
              <span style={{ color: textMuted }}>·</span>
              <span style={{ color: carte.phaseCouleur }}>{carte.phaseEmoji} {carte.phaseLabel}</span>
            </div>
          </div>
          {/* Steps */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {[
              { id: "recap",   label: "1. Récap" },
              { id: "preview", label: "2. Aperçu mails" },
            ].map(s => (
              <div key={s.id} style={{
                fontSize: 11, fontWeight: 700, letterSpacing: .4, textTransform: "uppercase",
                padding: "4px 9px", borderRadius: RADIUS.pill,
                background: etape === s.id ? accent + "22" : "transparent",
                color: etape === s.id ? accent : textMuted,
                border: `1px solid ${etape === s.id ? accent + "55" : border}`,
                whiteSpace: "nowrap",
              }}>{s.label}</div>
            ))}
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: textMuted, cursor: "pointer", padding: 6, display: "flex" }}>
            <Icon as={X} size={18}/>
          </button>
        </div>

        {/* Corps */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {etape === "recap" ? (
            // ─── ÉTAPE 1 : RÉCAP ──────────────────────────────────────────
            <>
              {/* Bandeau date de besoin */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: card, borderRadius: RADIUS.md, border: `1px solid ${border}` }}>
                <Icon as={Calendar} size={13} color={textMuted}/>
                <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 600 }}>Date de besoin</span>
                <input type="date" value={dateBesoin || ""} onChange={e => setDateBesoin(e.target.value)} style={{ ...inp, width: 160, colorScheme: "dark" }}/>
                {!carte.dateISO && (
                  <span style={{ fontSize: FONT.xs.size, color: textMuted, fontStyle: "italic" }}>(à définir, sera incluse dans le mail)</span>
                )}
              </div>

              {/* Tableau lignes */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${border}` }}>
                      {[
                        { l: "",         w: 28,  a: "center" },
                        { l: "Libellé",  w: null, a: "left" },
                        { l: "Qté",      w: 70,  a: "center" },
                        { l: "Unité",    w: 60,  a: "center" },
                        { l: "PU HT",    w: 90,  a: "right" },
                        { l: "Total HT", w: 100, a: "right" },
                        { l: "Fournisseur", w: 180, a: "left" },
                        { l: "",         w: 28,  a: "center" },
                      ].map(h => (
                        <th key={h.l + h.w} style={{ padding: "8px 6px", fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: .8, textAlign: h.a, width: h.w || undefined }}>{h.l}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignes.map(l => {
                      const total = (parseFloat(l.prix_ht) || 0) * (parseFloat(l.quantite) || 0);
                      const isManuel = l.source === "manuel";
                      return (
                        <tr key={l.uid} style={{ borderBottom: `1px solid ${border}`, opacity: l.checked ? 1 : .45 }}>
                          <td style={{ padding: "6px 6px", textAlign: "center" }}>
                            <input type="checkbox" checked={l.checked} onChange={e => setLigne(l.uid, { checked: e.target.checked })} style={{ accentColor: accent, cursor: "pointer" }}/>
                          </td>
                          <td style={{ padding: "6px 6px" }}>
                            <input value={l.libelle} onChange={e => setLigne(l.uid, { libelle: e.target.value })} placeholder="Libellé de l'article" style={{ ...inp, fontWeight: 600 }}/>
                            {isManuel && (
                              <span style={{ display: "inline-block", marginTop: 3, fontSize: 9, fontWeight: 700, letterSpacing: .5, padding: "1px 6px", borderRadius: RADIUS.pill, background: "rgba(91,156,246,0.15)", color: "#5b9cf6", textTransform: "uppercase" }}>Manuel</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 6px" }}>
                            <input type="number" min="0" step="0.01" value={l.quantite} onChange={e => setLigne(l.uid, { quantite: e.target.value })} style={{ ...inp, textAlign: "center", fontWeight: 700 }}/>
                          </td>
                          <td style={{ padding: "6px 6px" }}>
                            <input value={l.unite || ""} onChange={e => setLigne(l.uid, { unite: e.target.value })} placeholder="U" style={{ ...inp, textAlign: "center" }}/>
                          </td>
                          <td style={{ padding: "6px 6px" }}>
                            <input type="number" min="0" step="0.01" value={l.prix_ht} onChange={e => setLigne(l.uid, { prix_ht: e.target.value })} style={{ ...inp, textAlign: "right", color: "#22c55e", fontWeight: 700 }}/>
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "right", fontSize: 13, fontWeight: 800, color: text, fontFamily: "'DM Mono',monospace" }}>
                            {total.toFixed(2)} €
                          </td>
                          <td style={{ padding: "6px 6px" }}>
                            {fournisseurs.length > 0 ? (
                              <select
                                value={l.fournisseur_id || ""}
                                onChange={e => {
                                  const id = e.target.value || null;
                                  const f = id ? fournisseurs.find(x => x.id === id) : null;
                                  setLigne(l.uid, { fournisseur_id: id, fournisseur_nom: f ? f.nom : l.fournisseur_nom });
                                }}
                                style={inp}
                              >
                                <option value="">— {l.fournisseur_nom ? `Texte : « ${l.fournisseur_nom} »` : "Aucun"} —</option>
                                {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
                              </select>
                            ) : (
                              <input value={l.fournisseur_nom || ""} onChange={e => setLigne(l.uid, { fournisseur_nom: e.target.value })} placeholder="Nom du fournisseur" style={inp}/>
                            )}
                          </td>
                          <td style={{ padding: "6px 6px", textAlign: "center" }}>
                            <button onClick={() => removeLigne(l.uid)} title="Supprimer la ligne" style={{ background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 4, display: "inline-flex" }}>
                              <Icon as={Trash2} size={12}/>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Actions sous tableau */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 12, flexWrap: "wrap" }}>
                <button onClick={ajouterLigneManuelle} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "8px 14px", borderRadius: RADIUS.md,
                  background: "transparent", border: `1.5px dashed ${border}`, color: textSub,
                  fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
                }}>
                  <Icon as={Plus} size={12}/>
                  Ajouter un article manuel
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: FONT.xs.size + 1, color: textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .8 }}>Total HT</span>
                  <span style={{ fontSize: FONT.xl.size, fontWeight: 800, color: accent, fontFamily: "'DM Mono',monospace", letterSpacing: -0.3 }}>
                    {totalGlobal.toFixed(2)} €
                  </span>
                  <span style={{ fontSize: 11, color: textMuted }}>· {lignesCochees.length} ligne{lignesCochees.length > 1 ? "s" : ""}</span>
                </div>
              </div>
            </>
          ) : (
            // ─── ÉTAPE 2 : APERÇU DES MAILS ───────────────────────────────
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "10px 12px", background: "rgba(91,156,246,0.10)", border: "1px solid rgba(91,156,246,0.3)", borderRadius: RADIUS.md, color: "#5b9cf6", fontSize: FONT.xs.size + 1, lineHeight: 1.5 }}>
                <Icon as={Info} size={12} style={{ marginTop: 2, flexShrink: 0 }}/>
                <span>
                  {groupes.filter(g => g.email).length} mail{groupes.filter(g => g.email).length > 1 ? "s" : ""} à envoyer ·
                  {" "}{groupes.filter(g => !g.email).length > 0 && `${groupes.filter(g => !g.email).length} groupe${groupes.filter(g => !g.email).length > 1 ? "s" : ""} sans email (à passer manuellement)`}
                </span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {groupes.map(g => {
                  const corps  = construireCorps(g);
                  const statut = statutGroupes[g.key];
                  const isSansFournisseur = g.key === "__sans__";
                  const noEmail = !g.email;
                  return (
                    <div key={g.key} style={{
                      background: card, border: `1px solid ${border}`, borderRadius: RADIUS.lg, overflow: "hidden",
                    }}>
                      {/* En-tête groupe */}
                      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${border}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ width: 30, height: 30, borderRadius: RADIUS.md, background: isSansFournisseur ? "rgba(255,255,255,0.06)" : accent + "22", color: isSansFournisseur ? textMuted : accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Icon as={isSansFournisseur ? AlertTriangle : Mail} size={14}/>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: text }}>{g.nom}</div>
                          <div style={{ fontSize: FONT.xs.size, color: textMuted, marginTop: 1 }}>
                            {g.email ? g.email : (isSansFournisseur ? "Pas d'envoi de mail · à passer en physique" : "Aucun email connu pour ce fournisseur")}
                            <span style={{ marginLeft: 6 }}>· {g.lignes.length} ligne{g.lignes.length > 1 ? "s" : ""} · {fmtMontant(g.total)} € HT</span>
                          </div>
                        </div>
                        {/* Statut envoi */}
                        {statut === "pending" && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: accent, padding: "3px 9px", borderRadius: RADIUS.pill, background: accent + "22", letterSpacing: .5 }}>Envoi…</span>
                        )}
                        {statut === "sent" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#22c55e", padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(34,197,94,0.15)", letterSpacing: .5 }}>
                            <Icon as={Check} size={10}/> Envoyé
                          </span>
                        )}
                        {statut === "failed" && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#e15a5a", padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(225,90,90,0.15)", letterSpacing: .5 }}>
                            <Icon as={AlertTriangle} size={10}/> Échec
                          </span>
                        )}
                        {statut === "none" && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: textMuted, padding: "3px 9px", borderRadius: RADIUS.pill, background: "rgba(255,255,255,0.05)", letterSpacing: .5 }}>Non envoyé</span>
                        )}
                      </div>

                      {/* Aperçu mail */}
                      {!isSansFournisseur && (
                        <div style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: 1 }}>Sujet</div>
                            {(statut === "failed" || noEmail) && (
                              <button onClick={() => copier(`Sujet : ${sujetMail}\n\n${corps}`)} style={{
                                display: "inline-flex", alignItems: "center", gap: 5,
                                padding: "4px 10px", borderRadius: RADIUS.sm, border: `1px solid ${border}`,
                                background: "transparent", color: textSub,
                                fontFamily: "inherit", fontSize: FONT.xs.size + 1, cursor: "pointer", fontWeight: 600,
                              }}>
                                <Icon as={Copy} size={11}/>
                                Copier le mail
                              </button>
                            )}
                          </div>
                          <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: RADIUS.md, padding: "8px 12px", fontSize: 13, color: text, marginBottom: 8, fontWeight: 600 }}>
                            {sujetMail}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: textMuted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Corps</div>
                          <pre style={{
                            background: surface, border: `1px solid ${border}`,
                            borderRadius: RADIUS.md, padding: "10px 14px",
                            fontFamily: "inherit", fontSize: 13, color: textSub,
                            lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
                            margin: 0, maxHeight: 220, overflowY: "auto",
                          }}>{corps}</pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {globalErr && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(225,90,90,0.12)", border: "1px solid rgba(225,90,90,0.4)", borderRadius: RADIUS.md, color: "#e15a5a", fontSize: FONT.xs.size + 1 }}>
                  <Icon as={AlertTriangle} size={11} style={{ marginRight: 6 }}/>
                  {globalErr}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <button onClick={etape === "preview" ? () => setEtape("recap") : onClose} disabled={sending} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "transparent", border: `1px solid ${border}`,
            borderRadius: RADIUS.md, padding: "9px 16px", color: textSub,
            fontFamily: "inherit", fontSize: FONT.sm.size, cursor: sending ? "not-allowed" : "pointer", opacity: sending ? .5 : 1,
          }}>
            <Icon as={etape === "preview" ? ChevronLeft : X} size={13}/>
            {etape === "preview" ? "Retour au récap" : "Annuler"}
          </button>
          {etape === "recap" ? (
            <button onClick={() => setEtape("preview")} disabled={lignesCochees.length === 0} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: lignesCochees.length === 0 ? border : accent,
              color: lignesCochees.length === 0 ? textMuted : "#1a1a1a",
              border: "none", borderRadius: RADIUS.md, padding: "9px 18px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
              cursor: lignesCochees.length === 0 ? "not-allowed" : "pointer",
            }}>
              Aperçu des mails
              <Icon as={ArrowRight} size={13}/>
            </button>
          ) : (
            <button onClick={confirmer} disabled={sending} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: sending ? border : accent, color: sending ? textMuted : "#1a1a1a",
              border: "none", borderRadius: RADIUS.md, padding: "9px 20px",
              fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
              cursor: sending ? "not-allowed" : "pointer",
            }}>
              <Icon as={Send} size={13}/>
              {sending ? "Envoi en cours…" : "Confirmer et envoyer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────
function EmptyState({ T, acc }) {
  const text      = T?.text      || "#f0f0f0";
  const textMuted = T?.textMuted || "#5b6a8a";
  const surface   = T?.surface   || "#262a32";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  return (
    <div style={{
      background: surface, border: `1px dashed ${border}`,
      borderRadius: RADIUS.xl, padding: "60px 30px",
      textAlign: "center", color: textMuted,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: RADIUS.xl,
        background: acc.bg10, color: acc.accent,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 16,
      }}>
        <Icon as={Package} size={28} strokeWidth={1.5}/>
      </div>
      <div style={{ fontSize: FONT.lg.size, color: text, fontWeight: 700, marginBottom: 6 }}>
        Aucun matériau prévisionnel
      </div>
      <div style={{ fontSize: FONT.sm.size + 1, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
        Pour voir des commandes ici, ouvre la page <strong style={{ color: text }}>Phasage</strong>, sélectionne un chantier, puis ajoute des matériaux prévisionnels sous chaque phase.
        Les vendredis S-1 calculés à partir des dates prévues des tâches s'afficheront automatiquement.
      </div>
    </div>
  );
}
