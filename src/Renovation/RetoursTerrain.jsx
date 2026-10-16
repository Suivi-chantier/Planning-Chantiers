// ─────────────────────────────────────────────────────────────────────────────
// Page « Retours du terrain » (bureau) — ce que disent les ouvriers dans leurs
// comptes rendus, par semaine et par chantier : dépassements des heures
// vendues, tâches pas commencées / bloquées, nouvelles tâches proposées.
//
// Lecture seule. Toute la logique (tri, cumuls, devenir d'une nouvelle tâche)
// vit dans le module pur retoursTerrainV1.mjs ; ici on lit les comptes rendus
// de la semaine et les phasages des chantiers concernés, puis on affiche.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, getCurrentWeek, getWeekId } from "../constants";
import { Icon } from "../ui";
import { MessageSquare, ChevronLeft, ChevronRight, AlertTriangle, Clock, PauseCircle, PlusCircle } from "lucide-react";
import { lundiSemaineISOv1, ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";
import { retoursTerrain } from "./retoursTerrainV1";
import { celluleDeDate } from "./replanificationV1";

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_COURTS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const dateCourte = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${JOURS_COURTS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
};
// Les deux écritures de date_rapport rencontrées en base (« 12/10/2026 » et ISO).
const ecrituresDate = (iso) => { const [a, m, j] = iso.split("-"); return [`${j}/${m}/${a}`, iso]; };

const carteStyle = (T) => ({ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "12px 14px" });
const pastille = (couleur, fond) => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: RADIUS.pill,
  fontSize: FONT.xs.size + 1, fontWeight: 700, color: couleur, background: fond, whiteSpace: "nowrap",
});

function Element({ it, T, children }) {
  return (
    <div style={{ ...carteStyle(T), padding: "10px 12px" }}>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
        {dateCourte(it.date)} · {it.chantier_nom} · {it.ouvrier}
        {!it.valide && <span style={{ fontStyle: "italic" }}> · rapport pas encore validé</span>}
      </div>
      <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text, marginTop: 2 }}>{it.tache}</div>
      {it.ouvrage && (
        <div title={it.ouvrage} style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 1,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.ouvrage}</div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 6 }}>{children}</div>
      {it.precision && <div style={{ fontSize: FONT.sm.size, color: T.text, fontStyle: "italic", marginTop: 6 }}>« {it.precision} »</div>}
    </div>
  );
}

function Cumuls({ liste, couleur, fond }) {
  if (liste.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {liste.map(c => <span key={c.cle} style={pastille(couleur, fond)}>{c.label} × {c.nb}</span>)}
    </div>
  );
}

function Section({ id, icone, titre, couleur, nb, vide, T, children }) {
  return (
    <section id={id} style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon as={icone} size={17} color={couleur}/>
        <h2 style={{ margin: 0, fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>{titre}</h2>
        <span style={pastille("#fff", couleur)}>{nb}</span>
      </div>
      {nb === 0 ? <div style={{ ...carteStyle(T), color: T.textSub, fontSize: FONT.sm.size }}>{vide}</div> : children}
    </section>
  );
}

export default function RetoursTerrain({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [weekId, setWeekId] = useState(() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); });
  const [chantierId, setChantierId] = useState("");
  const [etat, setEtat] = useState({ statut: "chargement", rapports: [], phasages: [] });

  const lundi = lundiSemaineISOv1(weekId);
  const dimanche = lundi ? ajouterJoursV1(lundi, 6) : null;
  const changerSemaine = (n) => {
    const c = celluleDeDate(ajouterJoursV1(lundi, 7 * n));
    if (c) setWeekId(c.weekId);
  };

  useEffect(() => {
    if (!lundi) return;
    let annule = false;
    setEtat(e => ({ ...e, statut: "chargement" }));
    (async () => {
      const jours = Array.from({ length: 7 }, (_, i) => ajouterJoursV1(lundi, i));
      const { data: rapports, error } = await supabase.from("rapports")
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, taches, formulaire_version")
        .in("date_rapport", jours.flatMap(ecrituresDate));
      if (annule) return;
      if (error) { setEtat({ statut: "erreur", rapports: [], phasages: [] }); return; }
      const ids = [...new Set((rapports || []).map(r => r.chantier_id).filter(Boolean))];
      let phasages = [];
      if (ids.length > 0) {
        const { data: ph, error: e2 } = await supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", ids);
        if (annule) return;
        // Sans phasage, les retours restent affichés ; seuls l'ouvrage et le
        // devenir des nouvelles tâches manquent (signalé).
        phasages = e2 ? null : (ph || []);
      }
      setEtat({ statut: "ok", rapports: rapports || [], phasages });
    })();
    return () => { annule = true; };
  }, [lundi]);

  const chantiersSemaine = useMemo(() => {
    const m = new Map();
    etat.rapports.forEach(r => { if (r.chantier_id && !m.has(r.chantier_id)) m.set(r.chantier_id, r.chantier_nom || r.chantier_id); });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [etat.rapports]);

  const res = useMemo(() => retoursTerrain({
    rapports: etat.rapports, phasages: etat.phasages || [], debut: lundi, fin: dimanche, chantierId: chantierId || null,
  }), [etat, lundi, dimanche, chantierId]);

  const carte = carteStyle(T);
  const nbRapports = etat.rapports.filter(r => !chantierId || String(r.chantier_id) === String(chantierId)).length;

  const rouge = "#c0392b", orange = "#b27416", violet = "#7c3aed";

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg, padding: "18px 16px 40px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon as={MessageSquare} size={18} color={acc.accent}/>
          <h1 style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, margin: 0 }}>Retours du terrain</h1>
        </div>
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginBottom: 14 }}>
          Ce que les ouvriers disent dans leurs comptes rendus : dépassements des heures prévues, tâches pas commencées ou bloquées, nouvelles tâches proposées.
        </div>

        {/* Semaine + chantier */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button onClick={() => changerSemaine(-1)} aria-label="Semaine précédente" style={{ ...carte, padding: "6px 8px", cursor: "pointer", display: "flex" }}>
            <Icon as={ChevronLeft} size={16}/>
          </button>
          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text, minWidth: 210, textAlign: "center" }}>
            Semaine {weekId.split("-W")[1]} · {lundi ? `${dateCourte(lundi)} → ${dateCourte(dimanche)}` : ""}
          </div>
          <button onClick={() => changerSemaine(1)} aria-label="Semaine suivante" style={{ ...carte, padding: "6px 8px", cursor: "pointer", display: "flex" }}>
            <Icon as={ChevronRight} size={16}/>
          </button>
          <button onClick={() => { const { year, week } = getCurrentWeek(); setWeekId(getWeekId(year, week)); }}
            style={{ ...carte, padding: "6px 10px", cursor: "pointer", fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text }}>
            Cette semaine
          </button>
          <select value={chantierId} onChange={e => setChantierId(e.target.value)}
            style={{ ...carte, padding: "6px 10px", fontSize: FONT.sm.size, color: T.text, marginLeft: "auto", maxWidth: "100%" }}>
            <option value="">Tous les chantiers</option>
            {chantiersSemaine.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
          </select>
        </div>

        {etat.statut === "chargement" && (
          <div style={{ color: T.textMuted, textAlign: "center", padding: 40, fontSize: FONT.sm.size }}>Lecture des comptes rendus…</div>
        )}
        {etat.statut === "erreur" && (
          <div style={{ ...carte, marginTop: 14, borderColor: "rgba(245,166,35,.45)", color: T.textSub, fontSize: FONT.sm.size }}>
            <Icon as={AlertTriangle} size={13} color="#f5a623"/> Les comptes rendus n'ont pas pu être lus. Rien n'est affiché : ce n'est pas « aucun retour ».
          </div>
        )}

        {etat.statut === "ok" && (
          <>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 10 }}>
              {nbRapports} compte{nbRapports > 1 ? "s" : ""} rendu{nbRapports > 1 ? "s" : ""} cette semaine
              {etat.phasages === null && " · phasages illisibles : ouvrages et devenir des nouvelles tâches non affichés"}
            </div>
            {nbRapports === 0 && (
              <div style={{ ...carte, marginTop: 12, color: T.textSub, fontSize: FONT.sm.size }}>
                Aucun compte rendu pour cette semaine{chantierId ? " sur ce chantier" : ""} : il n'y a rien à lire.
              </div>
            )}

            {nbRapports > 0 && (
              <>
                <Section T={T} id="rt-depassements" icone={Clock} titre="Dépassements des heures prévues" couleur={rouge} nb={res.depassements.length}
                  vide="Aucun dépassement signalé cette semaine.">
                  <Cumuls liste={res.depassementsParMotif} couleur={rouge} fond="rgba(192,57,43,.10)"/>
                  {res.depassementsParOuvrage.some(o => o.nb > 1) && (
                    <div style={{ ...carte, marginBottom: 10 }}>
                      <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: .4, marginBottom: 6 }}>
                        Signalés plusieurs fois
                      </div>
                      {res.depassementsParOuvrage.filter(o => o.nb > 1).map(o => (
                        <div key={o.cle} style={{ display: "flex", gap: 8, fontSize: FONT.sm.size, color: T.text, padding: "3px 0" }}>
                          <strong style={{ minWidth: 28 }}>× {o.nb}</strong>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.label}>{o.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {res.depassements.map(it => (
                      <Element key={it.cle} it={it} T={T}>
                        <span style={pastille(rouge, "rgba(192,57,43,.10)")}>{it.motif_label}</span>
                        {it.releve && <span style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>{it.releve}</span>}
                      </Element>
                    ))}
                  </div>
                </Section>

                <Section T={T} id="rt-non-faites" icone={PauseCircle} titre="Pas commencé / Bloqué" couleur={orange} nb={res.nonFaites.length}
                  vide="Aucune tâche pas commencée ou bloquée cette semaine.">
                  <Cumuls liste={res.nonFaitesParMotif} couleur={orange} fond="rgba(178,116,22,.10)"/>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {res.nonFaites.map(it => (
                      <Element key={it.cle} it={it} T={T}>
                        <span style={pastille("#fff", it.bloque ? rouge : orange)}>{it.statut_label}</span>
                        <span style={pastille(orange, "rgba(178,116,22,.10)")}>{it.motif_label}</span>
                      </Element>
                    ))}
                  </div>
                </Section>

                <Section T={T} id="rt-nouvelles" icone={PlusCircle} titre="Nouvelles tâches proposées" couleur={violet} nb={res.nouvelles.length}
                  vide="Aucune nouvelle tâche proposée cette semaine.">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {res.nouvelles.map(it => (
                      <Element key={it.cle} it={it} T={T}>
                        <span style={pastille(violet, "rgba(139,92,246,.12)")}>{it.nature_label}</span>
                        {it.demandeur && <span style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>demandée par {it.demandeur}</span>}
                        <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text }}>
                          {etat.phasages === null && it.devenir !== "en_attente" ? "Devenir inconnu (phasage illisible)" : it.devenir_label}
                        </span>
                      </Element>
                    ))}
                  </div>
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
