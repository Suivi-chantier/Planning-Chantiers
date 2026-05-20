import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase";
import { FONT, RADIUS, getBranchAccent, PHASES_DEFAUT, loadPhases } from "./constants";
import { Icon } from "./ui";
import {
  ShoppingCart, Package, Calendar, Check, AlertTriangle, Building2,
  Clock, ArrowRight, Info,
} from "lucide-react";

// PHASES dynamiques (même pattern que les autres pages).
let PHASES = [...PHASES_DEFAUT];
loadPhases().then(p => { PHASES = p; });

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
  const [phasages, setPhasages] = useState([]);
  const [loading, setLoading] = useState(true);

  // Couleurs harmonisées avec le reste de l'app
  const bg        = T?.bg        || "#1e2128";
  const surface   = T?.surface   || "#262a32";
  const card      = T?.card      || "rgba(255,255,255,0.04)";
  const border    = T?.border    || "rgba(255,255,255,0.07)";
  const text      = T?.text      || "#f0f0f0";
  const textSub   = T?.textSub   || "#9aa5c0";
  const textMuted = T?.textMuted || "#5b6a8a";

  // Chargement des phasages
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("phasages")
        .select("id, chantier_id, chantier_nom, plan_travaux, statut");
      if (!cancelled) {
        setPhasages(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
      PHASES.forEach(ph => {
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
  }, [phasages, chantiers]);

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
                  }} T={T} text={text} textSub={textSub} textMuted={textMuted} compact/>
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
                  <CartePhase key={c.id} carte={c} urgenceInfo={urgence(c)} T={T} text={text} textSub={textSub} textMuted={textMuted} compact/>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── COLONNE SEMAINE ─────────────────────────────────────────────────────────
function ColonneSemaine({ semaine, cartes, urgence, T, surface, card, border, text, textSub, textMuted }) {
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
            <CartePhase key={c.id} carte={c} urgenceInfo={urgence(c)} T={T} text={text} textSub={textSub} textMuted={textMuted}/>
          ))
        )}
      </div>
    </div>
  );
}

// ─── CARTE PHASE ─────────────────────────────────────────────────────────────
function CartePhase({ carte, urgenceInfo, T, text, textSub, textMuted, compact = false }) {
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

      {/* Bouton action — désactivé tant que le système de passage de commande n'est pas branché (prompt 5) */}
      {!carte.commande && (
        <button disabled title="Le passage de commande sera disponible prochainement" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
          marginTop: 2, padding: "6px 10px", borderRadius: RADIUS.sm,
          background: urgenceInfo.accent + "18", color: urgenceInfo.accent,
          border: `1px solid ${urgenceInfo.accent}44`,
          fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
          cursor: "not-allowed", opacity: .85,
        }}>
          Passer commande
          <Icon as={ArrowRight} size={11}/>
        </button>
      )}
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
