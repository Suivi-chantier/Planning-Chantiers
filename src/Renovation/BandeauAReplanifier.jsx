// ─────────────────────────────────────────────────────────────────────────────
// Planning — bandeau « À replanifier ».
//
// Tâches déclarées « Pas commencé » / « Bloqué » dans un compte rendu validé
// des 3 dernières semaines, restées sans suite. La règle vit dans le module
// pur replanificationV1.mjs ; ce bandeau lit les comptes rendus et le
// planning des chantiers concernés, puis affiche. Rien n'est déplacé : « Voir
// dans le planning » ouvre la case où la tâche était prévue, le conducteur
// décide.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { TriangleAlert, ChevronDown, ChevronUp, RotateCw } from "lucide-react";
import { tachesAReplanifier, semainesEntre, avancementsDesPhasages } from "./replanificationV1";

const PROFONDEUR_JOURS = 21;     // signalements des 3 dernières semaines
const HORIZON_JOURS = 56;        // planning lu jusqu'à 8 semaines devant
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plusJours = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoLocal(d); };
const dateCourte = (iso) => { const d = new Date(`${iso}T12:00:00`); return `${JOURS_COURTS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`; };
// Les deux écritures de date_rapport rencontrées en base (« 12/10/2026 » et ISO).
const ecrituresDate = (iso) => { const [a, m, j] = iso.split("-"); return [`${j}/${m}/${a}`, iso]; };

export default function BandeauAReplanifier({ chantiersVisibles = [], T, onVoir, rafraichir = 0, marge = "10px 28px 0" }) {
  const [etat, setEtat] = useState({ statut: "chargement", items: [] });
  const [ouvert, setOuvert] = useState(false);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    let annule = false;
    (async () => {
      const aujourdhui = isoLocal(new Date());
      const depuis = plusJours(aujourdhui, -PROFONDEUR_JOURS);
      const jours = Array.from({ length: PROFONDEUR_JOURS + 1 }, (_, i) => plusJours(depuis, i));
      const { data: rapports, error } = await supabase.from("rapports")
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, taches")
        .in("date_rapport", jours.flatMap(ecrituresDate));
      if (annule) return;
      if (error) { setEtat({ statut: "erreur", items: [] }); return; }
      // Chantiers où un compte rendu validé signale une tâche non faite.
      const ids = [...new Set((rapports || []).filter(r => r.statut === "valide" && (r.taches || [])
        .some(l => l?.tache_id && (l.bloque === true || l.statut === "non_faite"))).map(r => r.chantier_id).filter(Boolean))];
      let cellules = [];
      let avancements = {};
      if (ids.length > 0) {
        const { data: cd, error: e2 } = await supabase.from("planning_cells")
          .select("week_id, jour, chantier_id, taches")
          .in("chantier_id", ids).in("week_id", semainesEntre(depuis, plusJours(aujourdhui, HORIZON_JOURS)));
        if (annule) return;
        // Sans le planning, on ne saurait pas ce qui a déjà été replanifié :
        // on le dit plutôt que d'afficher une liste fausse.
        if (e2) { setEtat({ statut: "erreur", items: [] }); return; }
        cellules = cd || [];
        // Avancement des tâches : une tâche à 100 % n'est plus à replanifier.
        const { data: ph, error: e3 } = await supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", ids);
        if (annule) return;
        if (e3) { setEtat({ statut: "erreur", items: [] }); return; }
        avancements = avancementsDesPhasages(ph || []);
      }
      setEtat({ statut: "ok", items: tachesAReplanifier({ rapports: rapports || [], cellules, aujourdhuiISO: aujourdhui, depuisISO: depuis, avancements }) });
    })();
    return () => { annule = true; };
  }, [rafraichir, essai]);

  if (etat.statut === "chargement" || (etat.statut === "ok" && etat.items.length === 0)) return null;

  const orange = "#b27416";
  const visibles = new Set(chantiersVisibles.map(c => String(c.id)));
  const n = etat.items.length;

  return (
    <div style={{ margin: marge, padding: "10px 14px", borderRadius: RADIUS.lg, background: "rgba(245,166,35,.10)", border: "1px solid rgba(245,166,35,.45)" }}>
      {etat.statut === "erreur" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, color: T.text }}>
          <Icon as={TriangleAlert} size={15} color={orange}/>
          « À replanifier » : les comptes rendus ou le planning n'ont pas pu être lus. Ce n'est pas « rien à replanifier ».
          <button onClick={() => setEssai(x => x + 1)} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: orange, fontWeight: 800, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
            <Icon as={RotateCw} size={13}/> Réessayer
          </button>
        </div>
      ) : (
        <>
          <button onClick={() => setOuvert(o => !o)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 8, border: "none", background: "transparent",
            cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left", color: T.text,
          }}>
            <Icon as={TriangleAlert} size={16} color={orange}/>
            <span style={{ flex: 1, fontSize: FONT.sm.size + 1 }}>
              <strong>À replanifier : {n} tâche{n > 1 ? "s" : ""}</strong>
              <span style={{ color: T.textSub }}> déclarée{n > 1 ? "s" : ""} « Pas commencé » ou « Bloqué » par les ouvriers, sans suite depuis</span>
            </span>
            <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: orange }}>{ouvert ? "Masquer" : "Voir"}</span>
            <Icon as={ouvert ? ChevronUp : ChevronDown} size={15} color={orange}/>
          </button>
          {ouvert && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {etat.items.map(it => {
                const visible = visibles.has(String(it.chantier_id));
                const motifs = it.motifs.map(m => [m.label, m.precision && `« ${m.precision} »`].filter(Boolean).join(" ")).filter(Boolean);
                return (
                  <div key={it.tache_id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
                    padding: "8px 10px", borderRadius: RADIUS.md, background: T.surface, border: `1px solid ${T.border}` }}>
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                        {dateCourte(it.date)} · {it.chantier_nom}{it.ouvriers.length ? ` · ${it.ouvriers.join(", ")}` : ""}
                      </div>
                      <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text }}>{it.tache}</div>
                      <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 1 }}>
                        <strong style={{ color: it.bloque ? "#c0392b" : orange }}>{it.statut_label}</strong>
                        {motifs.length > 0 ? ` — ${motifs.join(" · ")}` : ""}
                      </div>
                    </div>
                    <button onClick={() => visible && onVoir?.(it)} disabled={!visible} title={visible ? "" : "Chantier terminé : il n'apparaît plus au planning"} style={{
                      padding: "6px 12px", borderRadius: RADIUS.md, border: `1.5px solid ${orange}`, background: T.surface,
                      color: orange, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 800,
                      cursor: visible ? "pointer" : "not-allowed", opacity: visible ? 1 : 0.5, whiteSpace: "nowrap",
                    }}>{visible ? "Voir dans le planning" : "Chantier terminé"}</button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
