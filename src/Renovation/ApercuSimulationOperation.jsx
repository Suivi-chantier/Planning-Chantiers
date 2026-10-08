// ─── APERÇU DE LA SIMULATION D'UNE OPÉRATION (lecture seule) ────────────────
// Deux vues du planning simulé, AVANT toute écriture :
// - « Semaine par semaine » : la grille du Planning (logements × lun→ven) ;
// - « Tâches par logement » : chaque tâche dans l'ordre, groupée par lot, avec
//   une barre du premier au dernier jour posé — pour contrôler l'enchaînement.
// Les données viennent de planningOperationV1 (tachesParChantierV1,
// semainesSimulationV1) : aucun calcul ici.

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, ListTree } from "lucide-react";
import { Icon } from "../ui";
import { RADIUS } from "../constants";
import { semainesSimulationV1, tachesParChantierV1 } from "./planningOperationV1.js";

const PALETTE = ["#5b8af5", "#f59e0b", "#22c55e", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#a855f7", "#64748b", "#eab308"];
const fmtJour = iso => {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
};
const fmtCourt = iso => {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};
const fmtH = v => `${(Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100).toLocaleString("fr-FR")} h`;
// « D-013 :Dépose et évacuation radiateur, compris… » → « D-013 Dépose et évacuation radiateur… »
const ouvrageCourt = (libelle, max = 46) => {
  const s = String(libelle || "").replace(/\s*:\s*/, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
// Jours ouvrés (lun→ven) entre deux dates ISO incluses.
function joursOuvres(debut, fin) {
  const out = [];
  if (!debut || !fin) return out;
  const d = new Date(`${debut}T12:00:00Z`);
  const f = new Date(`${fin}T12:00:00Z`);
  for (let i = 0; d <= f && i < 800; i++) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export default function ApercuSimulationOperation({ T, acc, sim, groupesTypes = [], nomsRessources, chantiers = [] }) {
  const [vue, setVue] = useState("semaines");
  const [iSemaine, setISemaine] = useState(0);
  const [chantierId, setChantierId] = useState(chantiers[0]?.chantier_id || null);

  const semaines = useMemo(() => semainesSimulationV1(sim), [sim]);
  const taches = useMemo(() => tachesParChantierV1(sim, groupesTypes), [sim, groupesTypes]);
  const couleurLot = useMemo(() => {
    const ids = [...groupesTypes].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)).map(g => g.id);
    const m = new Map(ids.map((id, i) => [id, PALETTE[i % PALETTE.length]]));
    return id => m.get(id) || "#94a3b8";
  }, [groupesTypes]);
  const noms = ids => (ids || []).map(id => nomsRessources.get(id) || id).join(", ");

  const semaine = semaines[Math.min(iSemaine, Math.max(0, semaines.length - 1))] || null;
  const liste = taches[chantierId] || [];
  const parLot = useMemo(() => {
    const out = [];
    for (const t of liste) {
      const der = out[out.length - 1];
      if (der && der.lot === t.lot) der.taches.push(t);
      else out.push({ lot: t.lot, groupe_type_id: t.groupe_type_id, taches: [t] });
    }
    return out;
  }, [liste]);
  const datesCh = liste.filter(t => t.debut).flatMap(t => [t.debut, t.fin]).sort();
  const jours = useMemo(() => joursOuvres(datesCh[0], datesCh[datesCh.length - 1]), [datesCh[0], datesCh[datesCh.length - 1]]);
  const indexJour = useMemo(() => new Map(jours.map((d, i) => [d, i])), [jours]);
  const COL = 16;

  const onglet = (id, label, ic) => {
    const actif = vue === id;
    return (
      <button key={id} onClick={() => setVue(id)} style={{
        display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 14px", borderRadius: RADIUS.pill,
        border: `1px solid ${actif ? acc.accent : T.border}`, background: actif ? acc.bg10 : "transparent",
        color: actif ? acc.accent : T.textSub, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      }}><Icon as={ic} size={13}/>{label}</button>
    );
  };
  const navBtn = actif => ({
    width: 32, height: 32, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface,
    color: actif ? T.text : T.textMuted, cursor: actif ? "pointer" : "default", display: "inline-flex", alignItems: "center", justifyContent: "center",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {onglet("semaines", "Semaine par semaine", CalendarDays)}
        {onglet("taches", "Tâches par logement", ListTree)}
      </div>

      {vue === "semaines" && (
        semaine ? (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: `1px solid ${T.border}` }}>
              <button onClick={() => setISemaine(i => Math.max(0, i - 1))} disabled={iSemaine <= 0} style={navBtn(iSemaine > 0)} title="Semaine précédente"><Icon as={ChevronLeft} size={16}/></button>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>
                Semaine du {fmtCourt(semaine.jours[0].date)} au {fmtCourt(semaine.jours[4].date)}
                <span style={{ fontWeight: 600, color: T.textMuted }}> · {iSemaine + 1} / {semaines.length}</span>
              </div>
              <button onClick={() => setISemaine(i => Math.min(semaines.length - 1, i + 1))} disabled={iSemaine >= semaines.length - 1} style={navBtn(iSemaine < semaines.length - 1)} title="Semaine suivante"><Icon as={ChevronRight} size={16}/></button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, tableLayout: "fixed" }}>
                <thead><tr>
                  <th style={{ width: 150, padding: "7px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: .7, color: T.textMuted, textAlign: "left" }}>Logement</th>
                  {semaine.jours.map(j => (
                    <th key={j.jour} style={{ padding: "7px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: .7, color: T.textMuted, textAlign: "left", borderLeft: `1px solid ${T.border}` }}>{fmtJour(j.date)}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {chantiers.map(c => (
                    <tr key={c.chantier_id}>
                      <td style={{ padding: "8px 10px", fontSize: 11.5, fontWeight: 800, color: T.text, borderTop: `1px solid ${T.border}`, verticalAlign: "top" }}>{c.nom}</td>
                      {semaine.jours.map(j => {
                        const lignes = semaine.cellules[c.chantier_id]?.[j.jour] || [];
                        const total = lignes.reduce((s, l) => s + l.duree, 0);
                        const equipe = [...new Set(lignes.flatMap(l => l.resource_ids))];
                        return (
                          <td key={j.jour} style={{ padding: "6px 7px", borderTop: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, verticalAlign: "top", background: lignes.length ? "transparent" : T.card }}>
                            {lignes.length > 0 && (
                              <>
                                <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, marginBottom: 4 }}>{noms(equipe)}</div>
                                {lignes.map((l, k) => (
                                  <div key={k} title={`${l.nom}${l.ouvrage ? `\n${l.ouvrage}` : ""}\n${fmtH(l.duree)} · ${noms(l.resource_ids)}`}
                                    style={{ borderLeft: `3px solid ${couleurLot(l.groupe_type_id)}`, padding: "2px 0 2px 6px", marginBottom: 3, fontSize: 11, lineHeight: 1.3, color: T.textSub }}>
                                    <span style={{ color: T.text }}>{l.nom}</span> <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>· {fmtH(l.duree)}</span>
                                  </div>
                                ))}
                                {lignes.length > 1 && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{fmtH(total)} au total</div>}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.textMuted }}>
              Survolez une tâche pour voir son ouvrage et ses ouvriers. La couleur à gauche indique le lot.
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: T.textMuted }}>Aucune journée posée.</div>
      )}

      {vue === "taches" && (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {chantiers.map(c => {
              const actif = c.chantier_id === chantierId;
              return (
                <button key={c.chantier_id} onClick={() => setChantierId(c.chantier_id)} style={{
                  padding: "5px 12px", borderRadius: RADIUS.pill, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${actif ? acc.accent : T.border}`, background: actif ? acc.bg10 : T.surface, color: actif ? acc.accent : T.textSub,
                }}>{c.nom}</button>
              );
            })}
          </div>
          {liste.length === 0 ? <div style={{ fontSize: 12, color: T.textMuted }}>Aucune tâche pour ce logement.</div> : (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 420 + jours.length * COL }}>
                <thead><tr>
                  <th style={{ position: "sticky", left: 0, background: T.surface, zIndex: 1, minWidth: 300, padding: "7px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: .7, color: T.textMuted, textAlign: "left" }}>Tâche</th>
                  <th style={{ minWidth: 110, padding: "7px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: .7, color: T.textMuted, textAlign: "left" }}>Dates</th>
                  {jours.map((d, i) => {
                    const lundi = new Date(`${d}T12:00:00`).getDay() === 1;
                    return <th key={d} title={fmtJour(d)} style={{ width: COL, minWidth: COL, padding: "7px 0", fontSize: 9, color: T.textMuted, borderLeft: lundi ? `1px solid ${T.border}` : "none", textAlign: "left", whiteSpace: "nowrap", overflow: "visible" }}>
                      {lundi || i === 0 ? fmtCourt(d) : ""}
                    </th>;
                  })}
                </tr></thead>
                <tbody>
                  {parLot.map((g, gi) => (
                    <React.Fragment key={`${g.lot}-${gi}`}>
                      <tr>
                        <td colSpan={2 + jours.length} style={{ padding: "8px 10px 4px", borderTop: `1px solid ${T.border}`, fontSize: 11, fontWeight: 800, color: couleurLot(g.groupe_type_id), textTransform: "uppercase", letterSpacing: .6, position: "sticky", left: 0 }}>
                          {g.lot}
                        </td>
                      </tr>
                      {g.taches.map((t, ti) => (
                        <tr key={`${t.tache_id}-${ti}`}>
                          <td style={{ position: "sticky", left: 0, background: T.surface, zIndex: 1, padding: "3px 10px", fontSize: 11.5, color: T.text, maxWidth: 300 }} title={t.ouvrage || ""}>
                            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.nom}</div>
                            {t.ouvrage && <div style={{ fontSize: 10, color: T.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ouvrageCourt(t.ouvrage)}</div>}
                          </td>
                          <td style={{ padding: "3px 8px", fontSize: 10.5, color: t.placee ? T.textSub : "#d14343", whiteSpace: "nowrap" }} title={t.placee ? `${fmtH(t.heures_placees)} · ${noms(t.resource_ids)}` : t.raison}>
                            {t.placee ? (t.debut === t.fin ? fmtCourt(t.debut) : `${fmtCourt(t.debut)} → ${fmtCourt(t.fin)}`) : "non placée"}
                            <div style={{ color: T.textMuted }}>{t.placee ? `${fmtH(t.heures_placees)} · ${noms(t.resource_ids)}` : ""}</div>
                          </td>
                          {jours.map(d => {
                            const i = indexJour.get(d);
                            const pose = t.dates.includes(d);
                            const entre = !pose && t.debut && i > indexJour.get(t.debut) && i < indexJour.get(t.fin);
                            const lundi = new Date(`${d}T12:00:00`).getDay() === 1;
                            return <td key={d} style={{ padding: 0, borderLeft: lundi ? `1px solid ${T.border}` : "none" }}>
                              {pose && <div style={{ height: 12, margin: "0 1px", borderRadius: 3, background: couleurLot(t.groupe_type_id), opacity: .85 }}/>}
                              {entre && <div style={{ height: 2, background: couleurLot(t.groupe_type_id), opacity: .5 }}/>}
                            </td>;
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted, lineHeight: 1.5 }}>
            Un pavé = un jour où la tâche est posée ; un trait fin = jours sans cette tâche entre son premier et son dernier jour. Survolez le nom pour voir l'ouvrage complet.
          </div>
        </div>
      )}
    </div>
  );
}
