// ─────────────────────────────────────────────────────────────────────────────
// Planning — lignes non liées à une tâche du phasage (CR-6, partie 6C).
//
//   PropositionLiaison : l'encadré discret sous une ligne non liée (case du
//     planning) : la tâche la plus probable (même fonction que le compte rendu
//     de l'ouvrier, liaisonPlanningV1.propositionsLiaison), « Lier » en un
//     clic, « Choisir dans le phasage », « Pas une tâche du chantier ».
//   PanneauLignesALier : la liste des lignes à lier de la semaine affichée,
//     ouverte depuis le compteur « X % des lignes de la semaine liées au
//     phasage ». « Lier » relit la case en base, pose le lien sur CETTE ligne
//     (retrouvée par son identifiant d'allocation) et n'écrit rien d'autre.
//
// Rien n'est lié sans clic. Les calculs vivent dans liaisonPlanningV1.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { JOURS, FONT, RADIUS, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import { Link2, X, RotateCw } from "lucide-react";
import { loadPhasagesPourLiaison, syncDatePrevueTache } from "./phasagePlanning";
import {
  lignesALier, tachesPourLiaisonDepuisPhasage, propositionsPourLigne, lierLigneDansCellule,
  marquerLigneDansCellule,
} from "./liaisonPlanningV1";

const ORANGE = "#b27416";

const chemin = (p) => [p?.lot, p?.ouvrage, p?.piece].filter(Boolean).join(" › ");

const btn = (T, { plein = false } = {}) => ({
  padding: "3px 9px", borderRadius: RADIUS.sm + 1, fontFamily: "inherit", fontSize: 11.5, fontWeight: 800,
  cursor: "pointer", whiteSpace: "nowrap",
  border: `1px solid ${plein ? ORANGE : T.border}`, background: plein ? ORANGE : "transparent",
  color: plein ? "#fff" : T.textSub,
});

// etat : "chargement" | "ok" | "indisponible" (phasage illisible) | "sans_phasage"
export function PropositionLiaison({ proposition, etat = "ok", onLier, onChoisir, onPasUneTache, T }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11.5, lineHeight: 1.4,
      padding: "6px 8px", borderRadius: RADIUS.sm + 2, background: "rgba(245,166,35,.08)", border: "1px dashed rgba(245,166,35,.55)" }}>
      <span style={{ color: ORANGE, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon as={Link2} size={12} color={ORANGE}/> Pas liée au phasage
      </span>
      {etat === "chargement" && <span style={{ color: T.textMuted }}>· recherche de la tâche…</span>}
      {etat === "indisponible" && <span style={{ color: T.textMuted }}>· phasage illisible pour l'instant : aucune proposition (ce n'est pas « aucune tâche »)</span>}
      {etat === "sans_phasage" && <span style={{ color: T.textMuted }}>· aucun phasage lu pour ce chantier</span>}
      {etat === "ok" && !proposition && <span style={{ color: T.textMuted }}>· aucune tâche au nom ressemblant</span>}
      {etat === "ok" && proposition && (
        <span style={{ color: T.textSub, minWidth: 0 }}>
          · la plus probable : <strong style={{ color: T.text }}>{proposition.nom}</strong>
          {chemin(proposition) ? <span style={{ color: T.textMuted }}> ({chemin(proposition)})</span> : null}
        </span>
      )}
      <span style={{ display: "inline-flex", gap: 5, marginLeft: "auto", flexWrap: "wrap" }}>
        {etat === "ok" && proposition && onLier && (
          <button onClick={(e) => { e.stopPropagation(); onLier(proposition); }} style={btn(T, { plein: true })}
            title="Rattacher cette ligne à la tâche proposée (le texte, la durée et l'équipe de la ligne ne changent pas)">Lier</button>
        )}
        {onChoisir && etat !== "sans_phasage" && (
          <button onClick={(e) => { e.stopPropagation(); onChoisir(); }} style={btn(T)}>Choisir dans le phasage</button>
        )}
        {onPasUneTache && (
          <button onClick={(e) => { e.stopPropagation(); onPasUneTache(); }} style={btn(T)}
            title="Absence, livraison, RDV… : la ligne ne sera plus signalée ni comptée dans le pourcentage">Pas une tâche du chantier</button>
        )}
      </span>
    </div>
  );
}

// cells : { "<chantier>_<Jour>": { taches, planifie, … } } de la semaine affichée.
export function cellulesDepuisCarte(cells) {
  return Object.entries(cells || {}).map(([k, c]) => {
    const i = k.lastIndexOf("_");
    return { ...c, chantier_id: k.slice(0, i), jour: k.slice(i + 1) };
  });
}

export function PanneauLignesALier({ cells, setCells, chantiers = [], weekId, dateISO, onChoisir, onFermer, T, marge = "10px 28px 0" }) {
  const cellules = useMemo(() => cellulesDepuisCarte(cells), [cells]);
  const items = useMemo(() => lignesALier(cellules, { jours: JOURS }), [cellules]);
  const ids = useMemo(() => [...new Set(items.map(i => i.chantier_id))].sort().join("|"), [items]);
  const [phasages, setPhasages] = useState({ statut: "chargement", parChantier: {}, lots: [] });
  const [enCours, setEnCours] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let annule = false;
    if (!ids) { setPhasages({ statut: "ok", parChantier: {}, lots: [] }); return undefined; }
    setPhasages(p => ({ ...p, statut: "chargement" }));
    Promise.all([loadPhasagesPourLiaison(ids.split("|")), loadLots()]).then(([parChantier, lots]) => {
      if (annule) return;
      setPhasages(parChantier ? { statut: "ok", parChantier, lots: lots || [] } : { statut: "indisponible", parChantier: {}, lots: [] });
    }).catch(() => { if (!annule) setPhasages({ statut: "indisponible", parChantier: {}, lots: [] }); });
    return () => { annule = true; };
  }, [ids, essai]);

  const candidates = useMemo(() => {
    const out = {};
    Object.entries(phasages.parChantier || {}).forEach(([cid, ph]) => {
      out[cid] = tachesPourLiaisonDepuisPhasage({ ouvrages: ph.ouvrages, pieces: ph.pieces, lots: phasages.lots }, { lotsDefaut: LOTS_DEFAUT });
    });
    return out;
  }, [phasages]);

  const nomChantier = (cid) => chantiers.find(c => String(c.id) === String(cid))?.nom || cid;

  // Relit la case en base, applique le changement à CETTE ligne seulement,
  // et écrit la seule colonne taches (le reste de la case n'est pas touché).
  const ecrireLigne = async (it, transformer) => {
    setErreur(null);
    setEnCours(`${it.chantier_id}_${it.jour}_${it.index}`);
    try {
      const { data, error } = await supabase.from("planning_cells").select("id, taches")
        .eq("week_id", weekId).eq("chantier_id", it.chantier_id).eq("jour", it.jour).maybeSingle();
      if (error || !data) throw new Error(error?.message || "case introuvable");
      const res = transformer(Array.isArray(data.taches) ? data.taches : []);
      if (!res.trouve) throw new Error("la ligne a changé entre-temps : ouvre la case pour la lier");
      const { data: ecrit, error: e2 } = await supabase.from("planning_cells").update({ taches: res.taches }).eq("id", data.id).select("id");
      if (e2) throw new Error(e2.message);
      // Écriture refusée sans erreur (droits) : on le dit, on ne fait pas semblant.
      if (!ecrit || ecrit.length === 0) throw new Error("écriture refusée (droits sur le planning)");
      const cle = `${it.chantier_id}_${it.jour}`;
      setCells(prev => ({ ...prev, [cle]: { ...(prev[cle] || {}), taches: res.taches } }));
      return true;
    } catch (e) {
      setErreur(`« ${it.text} » : ${e.message || e}`);
      return false;
    } finally {
      setEnCours(null);
    }
  };

  const lier = async (it, proposition) => {
    const ok = await ecrireLigne(it, (taches) => lierLigneDansCellule(taches, { allocation_uid: it.allocation_uid, id: it.ligne?.id }, proposition.id));
    // Comme une tâche posée depuis le phasage : la date prévue suit le premier jour planifié.
    const iso = dateISO?.(it.jour);
    if (ok && iso) syncDatePrevueTache(it.chantier_id, proposition.id, { addDates: [iso] }).catch(() => {});
  };

  const pasUneTache = (it) => ecrireLigne(it, (taches) =>
    marquerLigneDansCellule(taches, { allocation_uid: it.allocation_uid, id: it.ligne?.id }, true));

  return (
    <div style={{ margin: marge, padding: "10px 14px", borderRadius: RADIUS.lg, background: T.surface, border: `1px solid ${T.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon as={Link2} size={15} color={ORANGE}/>
        <strong style={{ fontSize: FONT.sm.size + 1, color: T.text, flex: 1 }}>
          Lignes de la semaine à lier au phasage : {items.length}
        </strong>
        <button onClick={onFermer} title="Fermer" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.textMuted, lineHeight: 0 }}>
          <Icon as={X} size={15}/>
        </button>
      </div>
      {phasages.statut === "indisponible" && (
        <div style={{ fontSize: 12, color: ORANGE, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          Les phasages n'ont pas pu être lus : aucune proposition pour l'instant (ce n'est pas « aucune tâche »).
          <button onClick={() => setEssai(x => x + 1)} style={{ ...btn(T), display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon as={RotateCw} size={11}/> Réessayer
          </button>
        </div>
      )}
      {erreur && <div style={{ fontSize: 12, color: "#c0392b", marginBottom: 8 }}>Rien n'a été écrit — {erreur}</div>}
      {items.length === 0 ? (
        <div style={{ fontSize: 12.5, color: T.textMuted }}>Toutes les lignes de la semaine sont liées (ou libres).</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {items.map(it => {
            const cle = `${it.chantier_id}_${it.jour}_${it.index}`;
            const cs = candidates[it.chantier_id];
            const etat = phasages.statut !== "ok" ? phasages.statut
              : !phasages.parChantier[it.chantier_id] || !(cs || []).length ? "sans_phasage" : "ok";
            const proposition = etat === "ok"
              ? propositionsPourLigne({ ligne: it.ligne, candidates: cs, tachesDeLaCase: cells[`${it.chantier_id}_${it.jour}`]?.taches || [] })[0] || null
              : null;
            return (
              <div key={cle} style={{ display: "flex", flexDirection: "column", gap: 4, opacity: enCours === cle ? 0.5 : 1 }}>
                <div style={{ fontSize: 12.5, color: T.text }}>
                  <span style={{ color: T.textMuted }}>{it.jour} · {nomChantier(it.chantier_id)} · </span>
                  <strong>{it.text}</strong>
                </div>
                <PropositionLiaison T={T} etat={etat} proposition={proposition}
                  onLier={enCours ? null : (p) => lier(it, p)}
                  onChoisir={() => onChoisir?.(it)}
                  onPasUneTache={enCours ? null : () => pasUneTache(it)}/>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ fontSize: 11, color: T.textMuted, fontStyle: "italic", marginTop: 8 }}>
        La proposition est celle que voit l'ouvrier dans son compte rendu (même calcul : ressemblance des noms).
        « Lier » rattache la ligne à la tâche sans changer son texte, sa durée ni son équipe. Rien n'est lié sans clic.
      </div>
    </div>
  );
}
