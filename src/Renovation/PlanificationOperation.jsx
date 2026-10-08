// ─── ONGLET « PLANIFIER » DE LA FICHE OPÉRATION ─────────────────────────────
// Simule puis place dans le planning TOUS les chantiers d'une opération à
// partir d'une date de démarrage. Calculs : planningOperationV1 (pur).
// Lecture / écriture : planningOperationDataV1.
//
// Rien n'est écrit tant que l'utilisateur n'a pas confirmé « Placer ». Les
// autres chantiers ne sont jamais modifiés : ce qui y est posé compte comme du
// temps déjà pris.

import React, { useEffect, useMemo, useState } from "react";
import {
  Play, RefreshCw, CalendarCheck, CalendarRange, Clock, Users, TriangleAlert,
  CircleAlert, CheckCircle2, ChevronDown, ChevronRight, Trash2, ShieldCheck, ListOrdered,
} from "lucide-react";
import { Icon } from "../ui";
import { FONT, RADIUS } from "../constants";
import { KpiCard } from "./chantierFinanceUI";
import ApercuSimulationOperation from "./ApercuSimulationOperation";
import {
  ORDRE_LOTS_DEFAUT_V1,
  construirePlanEcritureOperationV1,
  lignesPoseesParOperationV1,
  lotsParChantierV1,
  ordreLotsLisibleV1,
  premierJourOuvreV1,
  resumerSimulationOperationV1,
} from "./planningOperationV1.js";
import {
  lireCellulesOperationV1,
  placerOperationV1,
  retirerPlacementOperationV1,
  simulerOperationDepuisBaseV1,
} from "./planningOperationDataV1.js";

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const demain = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoLocal(d); };
const fmtDate = v => {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
};
const fmtDateCourt = v => {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
};
const fmtH = v => `${(Math.round((Number(v || 0) + Number.EPSILON) * 10) / 10).toLocaleString("fr-FR")} h`;

const LIBELLES_ECARTEES = {
  equipe_groupe_externe: "Équipe externe : à dater avec le sous-traitant",
  intervention_externe: "Intervention externe : à dater avec le sous-traitant",
  groupe_sans_pool_ressources: "Lot sans équipe Profero configurée",
  contexte_affectation_insuffisant: "Tâche sans lot ni ouvrier : le moteur ne sait pas à qui la confier",
  tache_sans_identifiant: "Tâche sans identifiant dans le phasage",
};

function Section({ titre, children, T, droite }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: T.textMuted }}>{titre}</div>
        {droite && <div style={{ marginLeft: "auto" }}>{droite}</div>}
      </div>
      {children}
    </div>
  );
}

function Bandeau({ ton, icon, children }) {
  const c = ton === "ok" ? ["rgba(34,197,94,.10)", "rgba(34,197,94,.35)", "#15803d"]
    : ton === "alerte" ? ["rgba(245,166,35,.10)", "rgba(245,166,35,.40)", "#b97a10"]
    : ton === "erreur" ? ["rgba(225,90,90,.10)", "rgba(225,90,90,.38)", "#d14343"]
    : ["rgba(91,138,245,.08)", "rgba(91,138,245,.30)", "#3b6fd8"];
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 13px", borderRadius: 10, background: c[0], border: `1px solid ${c[1]}`, color: c[2], fontSize: 12.5, lineHeight: 1.5 }}>
      {icon && <Icon as={icon} size={16} style={{ flexShrink: 0, marginTop: 1 }}/>}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export default function PlanificationOperation({ T, acc, op, chantiersOp = [] }) {
  const idsOperation = useMemo(() => chantiersOp.map(c => c.id), [chantiersOp]);
  const [startDate, setStartDate] = useState(() => premierJourOuvreV1(demain()));
  const [calcul, setCalcul] = useState(false);
  const [erreur, setErreur] = useState("");
  const [simulation, setSimulation] = useState(null);
  const [ouverts, setOuverts] = useState({});
  const [voirOrdre, setVoirOrdre] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [ecriture, setEcriture] = useState(false);
  const [retour, setRetour] = useState(null); // { ton, texte }
  const [existant, setExistant] = useState(null); // lignes déjà posées par le placement auto
  const [confirmerRetrait, setConfirmerRetrait] = useState(false);

  const lireExistant = async () => {
    try {
      const cellules = await lireCellulesOperationV1(idsOperation);
      setExistant(lignesPoseesParOperationV1(cellules, idsOperation));
    } catch (e) {
      console.warn("Placement existant :", e?.message || e);
      setExistant(null);
    }
  };
  useEffect(() => { if (idsOperation.length) lireExistant(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idsOperation.join("|")]);

  const simuler = async () => {
    setCalcul(true); setErreur(""); setRetour(null); setConfirmer(false);
    try {
      const out = await simulerOperationDepuisBaseV1({ operationId: op.id, startDate });
      setSimulation(out);
      setOuverts({});
    } catch (e) {
      console.error("Simulation opération :", e);
      setErreur(e?.message || "Impossible de calculer la simulation.");
      setSimulation(null);
    } finally { setCalcul(false); }
  };

  const sim = simulation?.sim || null;
  const resume = useMemo(() => sim ? resumerSimulationOperationV1(sim) : null, [sim]);
  const lots = useMemo(() => sim ? lotsParChantierV1(sim, simulation.snapshot.groupesTypes) : {}, [sim, simulation]);
  const nomsRessources = useMemo(() => new Map((simulation?.snapshot?.ressources || []).map(r => [r.id, r.nom_planning || r.nom || r.id])), [simulation]);
  const nomsChantiers = useMemo(() => new Map(chantiersOp.map(c => [c.id, c.nom || c.id])), [chantiersOp]);
  const plan = useMemo(() => sim ? construirePlanEcritureOperationV1({ sim, cellulesOperationToutes: simulation.cellulesOperation, aujourdhui: isoLocal(new Date()) }) : null, [sim, simulation]);
  const ordreLisible = useMemo(() => ordreLotsLisibleV1(ORDRE_LOTS_DEFAUT_V1, simulation?.snapshot?.groupesTypes || []), [simulation]);
  const ecarteesParType = useMemo(() => {
    const m = new Map();
    for (const e of resume?.ecartees || []) {
      const k = e.type || "autre";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()];
  }, [resume]);

  const placer = async () => {
    setEcriture(true); setRetour(null);
    try {
      const out = await placerOperationV1({ simulation, placeLe: isoLocal(new Date()) });
      if (!out.ok) {
        const texte = out.raison === "planning_modifie"
          ? "Le planning de l'opération a été modifié depuis la simulation. Rien n'a été écrit : relancez la simulation."
          : out.raison === "autres_chantiers_modifies"
            ? "Le planning d'autres chantiers a changé depuis la simulation (les ouvriers ne sont plus disponibles aux mêmes jours). Rien n'a été écrit : relancez la simulation."
            : `Rien n'a été écrit : ${(out.detail || []).map(b => b.explication).join(" ")}`;
        setRetour({ ton: "erreur", texte });
      } else {
        const dates = out.dates?.ok
          ? `Dates prévues mises à jour sur ${out.dates.changements} tâche(s).`
          : "Attention : les dates prévues des tâches n'ont pas pu être mises à jour (phasage modifié en même temps). Le planning, lui, est bien écrit.";
        setRetour({ ton: out.dates?.ok ? "ok" : "alerte", texte: `${out.lignes} lignes posées sur ${out.journees} journées de planning. ${dates} Ouvrez le Planning à la semaine du ${fmtDateCourt(resume?.debut)} pour les voir.` });
        setSimulation(null);
      }
    } catch (e) {
      console.error("Placement opération :", e);
      setRetour({ ton: "erreur", texte: `${e?.message || "L'écriture a échoué."} Les lignes déjà écrites peuvent être retirées avec « Retirer ce placement ».` });
    } finally {
      setEcriture(false); setConfirmer(false);
      lireExistant();
    }
  };

  const retirer = async () => {
    setEcriture(true); setRetour(null);
    try {
      const out = await retirerPlacementOperationV1({ idsOperation });
      setRetour({ ton: "ok", texte: `${out.lignes} ligne(s) retirée(s) sur ${out.journees} journée(s). Le reste du planning n'a pas été touché.` });
      setSimulation(null);
    } catch (e) {
      setRetour({ ton: "erreur", texte: e?.message || "Le retrait a échoué." });
    } finally {
      setEcriture(false); setConfirmerRetrait(false);
      lireExistant();
    }
  };

  const btn = (primaire, actif = true) => ({
    display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 15px",
    borderRadius: RADIUS.md, fontFamily: "inherit", fontSize: 12.5, fontWeight: 800,
    cursor: actif ? "pointer" : "default", opacity: actif ? 1 : .6,
    border: primaire ? "none" : `1px solid ${acc.border}`,
    background: primaire ? acc.accent : acc.bg10,
    color: primaire ? (acc.onAccent || "#fff") : acc.accent,
  });
  const td = { padding: "8px 10px", fontSize: 12, color: T.textSub, borderTop: `1px solid ${T.border}`, verticalAlign: "top" };
  const th = { padding: "8px 10px", fontSize: 10, fontWeight: 800, letterSpacing: .7, textTransform: "uppercase", color: T.textMuted, textAlign: "left", whiteSpace: "nowrap" };

  const travailPlace = resume?.travail_moteur_place;
  const nbEcartees = resume?.ecartees?.length || 0;
  const nbNonPlaces = resume?.non_places?.length || 0;

  return (
    <div>
      <style>{`.pop-plan-table{width:100%;border-collapse:collapse} @media(max-width:768px){.pop-plan-masque{display:none}}`}</style>

      {/* ── Paramètres ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", padding: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: .9, color: T.textMuted }}>Démarrage des travaux</span>
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setSimulation(null); }}
            style={{ height: 36, padding: "0 10px", borderRadius: RADIUS.md, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit" }}/>
        </label>
        <button onClick={simuler} disabled={calcul || ecriture || !startDate} style={btn(true, !calcul && !ecriture && !!startDate)}>
          <Icon as={calcul ? RefreshCw : Play} size={14} className={calcul ? "spin" : ""}/>{calcul ? "Calcul en cours…" : simulation ? "Recalculer" : "Simuler"}
        </button>
        <div style={{ flex: "1 1 320px", fontSize: 11.5, lineHeight: 1.5, color: T.textMuted }}>
          Le moteur place toutes les tâches des {chantiersOp.length} logements à partir de cette date, avec les équipes de chaque lot et les absences connues.
          Ce qui est déjà posé sur les <strong>autres chantiers</strong> est respecté et n'est jamais déplacé. Rien n'est écrit avant votre confirmation.
        </div>
      </div>

      {existant && existant.lignes > 0 && (
        <div style={{ marginTop: 12 }}>
          <Bandeau ton="info" icon={CalendarCheck}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 260px" }}>
                Un placement automatique est déjà dans le planning : <strong>{existant.lignes} lignes</strong> du {fmtDateCourt(existant.premier_jour)} au {fmtDateCourt(existant.dernier_jour)}.
              </span>
              {!confirmerRetrait ? (
                <button onClick={() => setConfirmerRetrait(true)} disabled={ecriture} style={{ ...btn(false, !ecriture), height: 30 }}>
                  <Icon as={Trash2} size={13}/> Retirer ce placement
                </button>
              ) : (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12 }}>Retirer ces {existant.lignes} lignes (même celles déplacées à la main depuis) ?</span>
                  <button onClick={retirer} disabled={ecriture} style={{ ...btn(true, !ecriture), height: 30, background: "#d14343" }}>{ecriture ? "Retrait…" : "Oui, retirer"}</button>
                  <button onClick={() => setConfirmerRetrait(false)} disabled={ecriture} style={{ ...btn(false), height: 30 }}>Annuler</button>
                </span>
              )}
            </div>
          </Bandeau>
        </div>
      )}

      {erreur && <div style={{ marginTop: 12 }}><Bandeau ton="erreur" icon={CircleAlert}>{erreur}</Bandeau></div>}
      {retour && <div style={{ marginTop: 12 }}><Bandeau ton={retour.ton} icon={retour.ton === "ok" ? CheckCircle2 : CircleAlert}>{retour.texte}</Bandeau></div>}

      {!simulation && !calcul && !erreur && (
        <div style={{ padding: "40px 16px", textAlign: "center", color: T.textMuted }}>
          <Icon as={CalendarRange} size={30} style={{ opacity: .5, marginBottom: 10 }}/>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.textSub }}>Choisissez la date de démarrage puis lancez la simulation</div>
          <div style={{ fontSize: 12, marginTop: 5 }}>Vous verrez les dates de chaque logement et de chaque lot avant de décider de placer.</div>
        </div>
      )}

      {resume && (
        <>
          {/* ── Synthèse ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 16 }}>
            <KpiCard T={T} icon={CalendarRange} iconColor="#5b8af5" label="Premier jour" value={fmtDateCourt(resume.debut)}
              sub={`demandé : ${fmtDateCourt(resume.start_date)}`}/>
            <KpiCard T={T} icon={CalendarCheck} iconColor={travailPlace ? "#22c55e" : "#f5a623"}
              label={travailPlace ? "Dernier jour Profero" : "Au-delà de l'horizon"}
              value={travailPlace ? fmtDateCourt(resume.dernier_jour_place) : `pas avant le ${fmtDateCourt(resume.dernier_jour_place)}`}
              sub={resume.complet ? "toute l'opération est placée" : nbEcartees ? `${nbEcartees} tâche(s) hors moteur, fin complète inconnue` : `${nbNonPlaces} tâche(s) non placée(s)`}/>
            <KpiCard T={T} icon={Clock} iconColor="#f5a623" label="Heures placées" value={fmtH(resume.heures_placees)}
              sub={`sur ${fmtH(resume.heures_a_placer)} à placer`}/>
            <KpiCard T={T} icon={Users} iconColor="#8b5cf6" label="Jours de chantier" value={String(resume.jours_places)}
              sub={`${resume.heures_par_ouvrier.length} ouvrier(s) mobilisé(s)`}/>
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {nbEcartees > 0 && (
              <Bandeau ton="alerte" icon={TriangleAlert}>
                <strong>{nbEcartees} tâche(s) ne sont pas placées par le moteur</strong> (détail plus bas) : elles ne bloquent pas les autres et sont supposées faites
                {" "}<strong>avant le {fmtDateCourt(resume.start_date)}</strong> ou à côté. Si la démolition doit précéder les travaux, choisissez une date de démarrage après elle.
              </Bandeau>
            )}
            {nbNonPlaces > 0 && (
              <Bandeau ton="erreur" icon={CircleAlert}>
                <strong>{nbNonPlaces} tâche(s) n'ont pas trouvé de place</strong> sur 52 semaines : voir la liste plus bas avec la raison de chacune.
              </Bandeau>
            )}
            {resume.occupation && (
              <Bandeau ton="info" icon={ShieldCheck}>
                Respecté : {resume.occupation.lignes_comptees} ligne(s) déjà posées sur d'autres chantiers à partir du {fmtDateCourt(resume.start_date)} ({fmtH(resume.occupation.heures_reservees)} d'ouvriers déjà pris).
                {resume.occupation.lignes_sans_ouvrier_reconnu > 0 && ` ${resume.occupation.lignes_sans_ouvrier_reconnu} ligne(s) sans ouvrier reconnu ne réservent personne.`}
              </Bandeau>
            )}
          </div>

          {/* ── Voir la simulation avant de placer ── */}
          <Section T={T} titre="Voir la simulation">
            <ApercuSimulationOperation T={T} acc={acc} sim={sim} groupesTypes={simulation.snapshot.groupesTypes}
              nomsRessources={nomsRessources} chantiers={resume.chantiers.map(c => ({ chantier_id: c.chantier_id, nom: c.nom }))}/>
          </Section>

          {/* ── Par logement ── */}
          <Section T={T} titre="Par logement — cliquer pour voir les lots">
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
              <table className="pop-plan-table">
                <thead><tr>
                  <th style={th}>Logement</th><th style={th}>Début</th><th style={th}>Fin</th>
                  <th style={{ ...th, textAlign: "right" }}>Heures</th><th className="pop-plan-masque" style={th}>Hors moteur</th>
                </tr></thead>
                <tbody>
                  {resume.chantiers.map(c => {
                    const ouvert = !!ouverts[c.chantier_id];
                    const finTxt = c.sans_phasage ? "pas de phasage"
                      : c.complet ? fmtDateCourt(c.fin)
                      : c.travail_moteur_place ? `${fmtDateCourt(c.dernier_jour_place)} (Profero)`
                      : `pas avant le ${fmtDateCourt(c.dernier_jour_place)}`;
                    return (
                      <React.Fragment key={c.chantier_id}>
                        <tr onClick={() => setOuverts(p => ({ ...p, [c.chantier_id]: !ouvert }))} style={{ cursor: "pointer" }}>
                          <td style={{ ...td, color: T.text, fontWeight: 700 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon as={ouvert ? ChevronDown : ChevronRight} size={14}/>{c.nom}</span>
                          </td>
                          <td style={td}>{fmtDateCourt(c.debut)}</td>
                          <td style={{ ...td, color: c.complet || c.travail_moteur_place ? T.textSub : "#b97a10", fontWeight: 700 }}>{finTxt}</td>
                          <td style={{ ...td, textAlign: "right" }}>{fmtH(c.heures_placees)}<span style={{ color: T.textMuted }}> / {fmtH(c.heures_a_placer)}</span></td>
                          <td className="pop-plan-masque" style={td}>{c.taches_ecartees ? `${c.taches_ecartees} tâche(s)` : "—"}{c.taches_non_placees ? ` · ${c.taches_non_placees} non placée(s)` : ""}</td>
                        </tr>
                        {ouvert && (
                          <tr><td colSpan={5} style={{ ...td, background: T.card, padding: "6px 10px 10px 32px" }}>
                            {(lots[c.chantier_id] || []).length === 0 ? <span style={{ color: T.textMuted }}>Aucun lot posé.</span> : (
                              <table className="pop-plan-table">
                                <thead><tr><th style={th}>Lot</th><th style={th}>Du</th><th style={th}>Au</th><th style={{ ...th, textAlign: "right" }}>Heures</th><th className="pop-plan-masque" style={th}>Ouvriers</th></tr></thead>
                                <tbody>{lots[c.chantier_id].map(l => (
                                  <tr key={l.groupe_type_id || "sans"}>
                                    <td style={{ ...td, color: T.text }}>{l.nom}</td>
                                    <td style={td}>{fmtDateCourt(l.debut)}</td>
                                    <td style={td}>{fmtDateCourt(l.fin)}</td>
                                    <td style={{ ...td, textAlign: "right" }}>{fmtH(l.heures)}</td>
                                    <td className="pop-plan-masque" style={td}>{l.resource_ids.map(id => nomsRessources.get(id) || id).join(", ")}</td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            )}
                          </td></tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Ouvriers ── */}
          <Section T={T} titre="Heures par ouvrier sur l'opération">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {resume.heures_par_ouvrier.map(o => (
                <span key={o.resource_id} style={{ padding: "6px 11px", borderRadius: RADIUS.pill, border: `1px solid ${T.border}`, background: T.surface, fontSize: 12, color: T.textSub }}>
                  <strong style={{ color: T.text }}>{nomsRessources.get(o.resource_id) || o.resource_id}</strong> · {fmtH(o.heures)}
                </span>
              ))}
            </div>
          </Section>

          {/* ── Ordre des lots ── */}
          <Section T={T} titre="Ordre des lots appliqué" droite={
            <button onClick={() => setVoirOrdre(v => !v)} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              {voirOrdre ? "Masquer" : "Afficher"}
            </button>}>
            <div style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.5 }}>
              Dans chaque logement, un lot ne démarre qu'une fois terminés les lots qui doivent le précéder. Les lots d'une même étape avancent en parallèle.
            </div>
            {voirOrdre && (
              <div style={{ marginTop: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "8px 12px" }}>
                {ordreLisible.map(o => (
                  <div key={o.groupe_type_id} style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: `1px solid ${T.border}`, fontSize: 12, color: T.textSub, flexWrap: "wrap" }}>
                    <Icon as={ListOrdered} size={13} style={{ marginTop: 2, color: T.textMuted }}/>
                    <strong style={{ color: T.text }}>{o.lot}</strong><span>après</span><span>{o.apres.join(", ")}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Tâches non placées / hors moteur ── */}
          {nbNonPlaces > 0 && (
            <Section T={T} titre={`Tâches non placées (${nbNonPlaces})`}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {resume.non_places.map((n, i) => (
                  <div key={`${n.chantier_id}-${n.tache_id}-${i}`} style={{ padding: "8px 12px", borderTop: i ? `1px solid ${T.border}` : "none", fontSize: 12, color: T.textSub }}>
                    <strong style={{ color: T.text }}>{n.nom}</strong> · {nomsChantiers.get(n.chantier_id) || n.chantier_id} · {fmtH(n.heures)}
                    <div style={{ color: T.textMuted, marginTop: 2 }}>{n.raison}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {nbEcartees > 0 && (
            <Section T={T} titre={`Tâches hors moteur (${nbEcartees})`}>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
                {ecarteesParType.map(([type, liste], i) => (
                  <details key={type} style={{ borderTop: i ? `1px solid ${T.border}` : "none", padding: "8px 12px" }}>
                    <summary style={{ cursor: "pointer", fontSize: 12.5, color: T.text, fontWeight: 700 }}>
                      {LIBELLES_ECARTEES[type] || liste[0]?.explication || type} — {liste.length} tâche(s)
                    </summary>
                    <div style={{ marginTop: 6 }}>
                      {liste.map((e, j) => (
                        <div key={`${e.chantier_id}-${e.tache_id}-${j}`} style={{ fontSize: 12, color: T.textSub, padding: "2px 0" }}>
                          {e.nom} <span style={{ color: T.textMuted }}>· {nomsChantiers.get(e.chantier_id) || e.chantier_id}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {/* ── Placer ── */}
          <Section T={T} titre="Placer dans le planning">
            {plan && !plan.ok ? (
              <Bandeau ton="erreur" icon={CircleAlert}>
                Placement impossible en l'état : {plan.blocages.map(b => b.explication).join(" ")}
              </Bandeau>
            ) : plan && plan.operations.length === 0 ? (
              <Bandeau ton="ok" icon={CheckCircle2}>
                Le planning contient déjà exactement ce placement : il n'y a rien à écrire.
              </Bandeau>
            ) : plan && (
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.55 }}>
                  <strong style={{ color: T.text }}>{plan.resume.lignes_posees} lignes</strong> seront posées sur <strong style={{ color: T.text }}>{plan.resume.journees_ecrites} journées</strong> de planning
                  {" "}({plan.resume.journees_creees} nouvelles, {plan.resume.journees_modifiees} complétées), uniquement sur les logements de {op.nom}.
                  {plan.resume.lignes_remplacees > 0 && <> <strong style={{ color: "#b97a10" }}>{plan.resume.lignes_remplacees} ligne(s) déjà posées sur l'opération à partir du {fmtDateCourt(resume.start_date)} seront remplacées.</strong></>}
                  {plan.resume.lignes_conservees > 0 && <> {plan.resume.lignes_conservees} ligne(s) verrouillée(s) ou saisie(s) à la main sont conservées.</>}
                  {" "}La date prévue de chaque tâche sera mise à son premier jour posé. Vous pourrez tout retirer en un clic.
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {!confirmer ? (
                    <button onClick={() => setConfirmer(true)} disabled={ecriture} style={btn(true, !ecriture)}>
                      <Icon as={CalendarCheck} size={14}/> Placer dans le planning
                    </button>
                  ) : (
                    <>
                      <span style={{ fontSize: 12.5, color: T.text, fontWeight: 700 }}>Confirmer l'écriture de {plan.resume.journees_ecrites} journées ?</span>
                      <button onClick={placer} disabled={ecriture} style={btn(true, !ecriture)}>
                        <Icon as={ecriture ? RefreshCw : CheckCircle2} size={14} className={ecriture ? "spin" : ""}/>{ecriture ? "Écriture…" : "Oui, placer"}
                      </button>
                      <button onClick={() => setConfirmer(false)} disabled={ecriture} style={btn(false, !ecriture)}>Annuler</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
