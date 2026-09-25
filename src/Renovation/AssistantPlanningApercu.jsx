// ─── ASSISTANT PLANNING — APERÇU DU RECALCUL (écran 2 de la maquette) ───────
// Affichage seul : toutes les données viennent de construireApercuRecalculV1
// (assistantPlanningApercuV1.mjs), qui range deux résultats du moteur. Aucune
// règle ici. Couleurs : thème T + accent de branche + jetons de constants.js.

import React from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeft, ArrowRight, ShieldAlert, TriangleAlert,
  CalendarRange, CircleAlert, Info,
} from "lucide-react";
import { Icon } from "../ui";
import { FONT, RADIUS, SEMANTIC } from "../constants";
import { libelleDateV1 } from "./assistantPlanningConsigneV1.js";

const court = iso => libelleDateV1(iso, { court: true });
const jourSeul = iso => court(iso).split(" ")[0];

// Libellés selon ce qui est comparé : deux calculs du moteur autour d'une
// consigne, ou le planning actuel face à la proposition du moteur.
export const LIBELLES_COMPARAISON = {
  consigne: { titre: "Aperçu du recalcul", avant: "Avant", apres: "Après", vide: "Aucune tâche proposée par le moteur cette semaine, avant comme après." },
  planning_actuel: { titre: "Planning proposé", avant: "Planning actuel", apres: "Proposition du moteur", vide: "Rien de posé ni de proposé cette semaine pour ce chantier." },
};
const libelles = apercu => LIBELLES_COMPARAISON[apercu?.comparaison] || LIBELLES_COMPARAISON.consigne;

function Legende({ T, acc }) {
  const pastille = style => <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: RADIUS.sm, boxSizing: "border-box", flexShrink: 0, ...style }}/>;
  const items = [
    [pastille({ border: `2px solid ${acc.accent}`, background: acc.bg10 }), "Tâche déplacée"],
    [pastille({ border: `2px dashed ${T.textMuted}` }), "Ancienne place"],
    [pastille({ background: `repeating-linear-gradient(135deg, ${T.textMuted} 0 3px, transparent 3px 7px)`, border: `1px solid ${T.border}` }), "Absence"],
    [pastille({ background: T.card, border: `1px solid ${T.border}`, opacity: 0.6 }), "Inchangé"],
    [pastille({ background: T.surface, border: `1px solid ${T.border}` }), "Autre chantier (clic : lequel)"],
    [pastille({ border: `1px dashed ${T.border}` }), "Libre"],
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", fontSize: FONT.sm.size, color: T.textSub }}>
      {items.map(([p, l]) => <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{p}{l}</span>)}
    </div>
  );
}

function Tuile({ it, T, acc, mode }) {
  // mode : "change" | "fantome" | "inchange"
  const base = {
    borderRadius: RADIUS.md, padding: "6px 8px", fontSize: FONT.sm.size, lineHeight: 1.3,
    boxSizing: "border-box", minWidth: 0, overflowWrap: "anywhere",
  };
  const style = mode === "change"
    ? { ...base, background: acc.bg10, border: `2px solid ${acc.accent}`, color: T.text }
    : mode === "fantome"
      ? { ...base, border: `2px dashed ${T.textMuted}`, color: T.textSub, textDecoration: "line-through" }
      : { ...base, background: T.card, border: `1px solid ${T.border}`, color: T.text, opacity: 0.6 };
  return (
    <div style={style} title={it.exception || undefined}>
      <div style={{ fontWeight: 700 }}>{it.chantier}</div>
      <div style={{ color: mode === "inchange" ? T.textSub : T.text }}>{it.texte}{it.duree ? ` · ${it.duree} h` : ""}</div>
      {mode === "change" && it.libelle_deplacement && (
        <div style={{ marginTop: 3, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: FONT.xs.size, color: T.text }}>
          {it.deplace_depuis && <Icon as={ArrowLeft} size={12}/>}
          {it.libelle_deplacement.replace(/^← /, "")}
        </div>
      )}
      {it.exception && mode !== "fantome" && (
        <div style={{ marginTop: 3, display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 800, fontSize: FONT.xs.size, color: SEMANTIC.warning.color }}>
          <Icon as={ShieldAlert} size={12}/> Exception hors équipe
        </div>
      )}
      {mode === "fantome" && <div style={{ fontSize: FONT.xs.size, textDecoration: "none" }}>ancienne place</div>}
      {mode === "fantome" && it.destination && (
        <div style={{ marginTop: 2, fontSize: FONT.xs.size, fontWeight: 800, color: T.text, textDecoration: "none", display: "inline-block" }}>{it.destination.libelle}</div>
      )}
    </div>
  );
}

// Case sans tâche du périmètre : la personne est ailleurs, ou vraiment libre.
// Le nom des autres chantiers s'affiche au survol ou au clic.
function CaseVide({ cv, T, compact = false }) {
  const [ouvert, setOuvert] = React.useState(false);
  if (!cv) return null;
  const ailleurs = !!cv.detail;
  const style = {
    borderRadius: RADIUS.md, padding: compact ? "3px 6px" : "6px 8px", fontSize: compact ? FONT.xs.size : FONT.sm.size, lineHeight: 1.3,
    boxSizing: "border-box", minWidth: 0, overflowWrap: "anywhere", textAlign: "left", fontFamily: "inherit",
    color: T.textSub, background: ailleurs ? T.surface : "transparent",
    border: ailleurs ? `1px solid ${T.border}` : `1px dashed ${T.border}`,
  };
  if (!ailleurs) return <div style={style}>{cv.libelle}</div>;
  return (
    <button type="button" title={cv.detail} aria-expanded={ouvert} onClick={() => setOuvert(o => !o)} style={{ ...style, cursor: "pointer" }}>
      <span style={{ fontWeight: 700 }}>{cv.libelle}</span>
      {ouvert && <span style={{ display: "block", marginTop: 3, color: T.text }}>{cv.detail}</span>}
    </button>
  );
}

export function GrilleRecalcul({ apercu, vue, setVue, semaines = [], setLundi, T, acc, isMobile }) {
  const L = libelles(apercu);
  const idx = semaines.indexOf(apercu.lundi);
  const bouton = (actif) => ({
    minHeight: 36, padding: "0 16px", border: "none", borderRadius: RADIUS.md, cursor: "pointer",
    background: actif ? acc.accent : "transparent", color: actif ? acc.onAccent : T.textSub,
    fontFamily: "inherit", fontSize: FONT.base.size, fontWeight: 700,
  });
  const nav = (disabled) => ({
    width: 36, height: 36, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent",
    color: disabled ? T.textMuted : T.text, cursor: disabled ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
  });
  const colonnes = `minmax(${isMobile ? 76 : 96}px, 120px) repeat(5, minmax(${isMobile ? 118 : 0}px, 1fr))`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, color: T.text, letterSpacing: 0.3 }}>{L.titre}</h2>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <button type="button" aria-label="Semaine précédente" disabled={idx <= 0} onClick={() => setLundi(semaines[idx - 1])} style={nav(idx <= 0)}><Icon as={ChevronLeft} size={16}/></button>
          <span style={{ fontSize: FONT.base.size, color: T.textSub, whiteSpace: "nowrap" }}>
            {apercu.jours.length ? `${court(apercu.jours[0].date)} → ${court(apercu.jours[4].date)}` : "—"}
          </span>
          <button type="button" aria-label="Semaine suivante" disabled={idx < 0 || idx >= semaines.length - 1} onClick={() => setLundi(semaines[idx + 1])} style={nav(idx < 0 || idx >= semaines.length - 1)}><Icon as={ChevronRight} size={16}/></button>
        </div>
        <div role="group" aria-label="Affichage" style={{ marginLeft: "auto", display: "flex", background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 3 }}>
          <button type="button" aria-pressed={vue === "avant"} onClick={() => setVue("avant")} style={bouton(vue === "avant")}>{L.avant}</button>
          <button type="button" aria-pressed={vue === "apres"} onClick={() => setVue("apres")} style={bouton(vue === "apres")}>{L.apres}</button>
        </div>
      </div>

      <Legende T={T} acc={acc}/>

      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <div role="table" aria-label="Planning de la semaine" style={{ display: "grid", gridTemplateColumns: colonnes, gap: 6, minWidth: isMobile ? 700 : 0 }}>
          <div role="columnheader"/>
          {apercu.jours.map(j => (
            <div role="columnheader" key={j.date} style={{ fontWeight: 800, fontSize: FONT.sm.size, color: j.non_travaille ? T.textMuted : T.textSub, padding: "4px 6px", textTransform: "uppercase", letterSpacing: 0.6 }}>
              {court(j.date)}{j.non_travaille ? " · 0 h" : ""}
            </div>
          ))}
          {apercu.lignes.length === 0 && (
            <div style={{ gridColumn: "1 / -1", padding: 16, color: T.textSub, fontSize: FONT.base.size }}>
              {L.vide}
            </div>
          )}
          {apercu.lignes.map(l => (
            <React.Fragment key={l.resource_id}>
              <div role="rowheader" style={{ padding: "10px 4px", fontWeight: 700, fontSize: FONT.base.size, color: l.cellules.some(c => c.change || c.absent) ? T.text : T.textSub }}>{l.nom}</div>
              {l.cellules.map((c, i) => {
                const jour = apercu.jours[i];
                const items = vue === "apres" ? c.apres : c.avant;
                const fond = c.absent
                  ? { background: `repeating-linear-gradient(135deg, ${T.border} 0 6px, transparent 6px 12px)`, border: `1px solid ${T.border}` }
                  : { background: jour?.non_travaille ? "transparent" : T.widgetBg, border: `1px solid ${jour?.non_travaille ? "transparent" : T.border}` };
                return (
                  <div role="cell" key={c.date} style={{ ...fond, borderRadius: RADIUS.lg, padding: 5, minHeight: 58, display: "flex", flexDirection: "column", gap: 5, boxSizing: "border-box", minWidth: 0 }}>
                    {c.absent && <div style={{ fontWeight: 800, fontSize: FONT.sm.size, letterSpacing: 1, color: T.text }}>ABSENT</div>}
                    {c.absence_partielle_h ? <div style={{ fontSize: FONT.xs.size, color: T.textSub }}>−{c.absence_partielle_h} h indisponible</div> : null}
                    {/* Le travail du jour d'abord, puis ce qui reste de la journée ; les
                        anciennes places barrées ensuite, pour ne jamais cacher le travail réel. */}
                    {items.map((it, k) => <Tuile key={k} it={it} T={T} acc={acc} mode={it.change ? "change" : "inchange"}/>)}
                    <CaseVide T={T} cv={(vue === "apres" ? c.occupation_apres : c.occupation_avant)?.case_vide}/>
                    <CaseVide T={T} compact cv={(vue === "apres" ? c.occupation_apres : c.occupation_avant)?.en_plus}/>
                    <CaseVide T={T} compact cv={(vue === "apres" ? c.occupation_apres : c.occupation_avant)?.reste_libre}/>
                    {vue === "apres" && c.fantomes.map((it, k) => <Tuile key={`f${k}`} it={it} T={T} acc={acc} mode="fantome"/>)}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {apercu.hors_semaine > 0 && (
        <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>
          {apercu.hors_semaine} tâche(s) déplacée(s) hors de cette semaine : utilisez les flèches pour les voir.
        </div>
      )}
    </div>
  );
}

export function BandeauFins({ apercu, T }) {
  const actuel = apercu.comparaison === "planning_actuel";
  const sansTravail = apercu.chantiers_sans_travail || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: T.textSub }}>
        <Icon as={CalendarRange} size={14}/> {actuel ? "Fin prévisionnelle — planning actuel → proposition du moteur" : "Fin prévisionnelle"}
      </div>
      {apercu.fins.length === 0 && sansTravail.length === 0 && (
        <div style={{ fontSize: FONT.base.size, color: T.text }}>{actuel ? "Aucun chantier à planifier sur ce périmètre." : "Aucune fin prévisionnelle ne bouge."}</div>
      )}
      {apercu.fins.map(f => (
        <div key={f.chantier_id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: FONT.base.size }}>
          <span style={{ fontWeight: 700, color: T.text }}>{f.chantier}</span>
          <span style={{ color: T.textSub }}>{f.avant.titre}</span>
          <Icon as={ArrowRight} size={16} color={SEMANTIC.warning.color}/>
          <span style={{ fontWeight: 700, color: T.text }}>
            {f.apres.titre}{f.decalage_jours ? ` (${f.decalage_jours > 0 ? "+" : ""}${f.decalage_jours} jour${Math.abs(f.decalage_jours) > 1 ? "s" : ""})` : ""}
          </span>
          {f.apres.detail && <span style={{ width: "100%", fontSize: FONT.sm.size, color: T.textSub }}>{f.apres.detail}</span>}
        </div>
      ))}
      {sansTravail.map(c => (
        <div key={c.chantier_id} style={{ fontSize: FONT.base.size, color: T.text }}>
          <b>{c.chantier}</b> <span style={{ color: T.textSub }}>— rien à planifier sur l'horizon calculé (aucun travail restant trouvé).</span>
        </div>
      ))}
      {actuel && apercu.fins.length > 0 && (
        <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>Le planning actuel ne dit pas si tout le reste est posé : seule la proposition donne une fin.</div>
      )}
      {!actuel && apercu.chantiers_fin_inchangee > 0 && (
        <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>
          {apercu.fins.length ? "Les autres chantiers ne bougent pas." : `${apercu.chantiers_fin_inchangee} chantier(s) calculé(s), fins inchangées.`}
        </div>
      )}
    </div>
  );
}

const heures = h => `${String(Math.round((Number(h) || 0) * 100) / 100).replace(".", ",")} h`;
const jjmm = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

function parRacine(taches) {
  const m = new Map();
  taches.forEach(t => {
    const k = t.racine?.travail_id || t.travail_id;
    if (!m.has(k)) m.set(k, { racine: t.racine, taches: [] });
    m.get(k).taches.push(t);
  });
  return [...m.values()];
}

function ListeTaches({ taches, T, max = 5 }) {
  const [tout, setTout] = React.useState(false);
  const vues = tout ? taches : taches.slice(0, max);
  return (
    <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
      {vues.map(t => (
        <li key={t.travail_id} title={`Raison du moteur : ${t.raison}`} style={{ color: T.text }}>
          {t.texte} <span style={{ color: T.textSub }}>({heures(t.heures_mo_restantes)}{t.date_prevue_apres_periode ? ` · date prévue le ${jjmm(t.date_prevue)}` : ""})</span>
        </li>
      ))}
      {taches.length > max && (
        <li style={{ listStyle: "none", marginLeft: -18 }}>
          <button type="button" onClick={() => setTout(v => !v)} style={{ border: "none", background: "transparent", padding: "4px 0", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, textDecoration: "underline" }}>
            {tout ? "Réduire" : `Voir les ${taches.length - max} autres`}
          </button>
        </li>
      )}
    </ul>
  );
}

function GroupeChantier({ g, famille, T }) {
  const bloquee = famille === "bloquee";
  const cadre = bloquee
    ? { background: SEMANTIC.danger.bg, border: `1px solid ${SEMANTIC.danger.border}` }
    : { background: T.surface, border: `1px solid ${T.border}` };
  return (
    <div style={{ ...cadre, borderRadius: RADIUS.lg, padding: 10, fontSize: FONT.sm.size, color: T.text, lineHeight: 1.45, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontWeight: 800 }}>{g.chantier} <span style={{ fontWeight: 400, color: T.textSub }}>— {g.taches.length} {g.taches.length > 1 ? "tâches" : "tâche"}, {heures(g.heures)}</span></div>
      {parRacine(g.taches).map(({ racine, taches }) => {
        const seule = taches.length === 1 && racine?.elle_meme;
        return (
          <div key={racine?.travail_id || taches[0].travail_id} style={{ display: "flex", gap: 8 }}>
            {bloquee && <Icon as={CircleAlert} size={16} color={SEMANTIC.danger.color} style={{ flexShrink: 0, marginTop: 1 }}/>}
            <div style={{ minWidth: 0 }}>
              {seule ? (
                <span><b>{taches[0].texte}</b> ({heures(taches[0].heures_mo_restantes)}) — {racine.raison}</span>
              ) : (
                <>
                  <span>{bloquee ? "bloquée par" : "attend"} : <b>{racine?.texte}</b> — {racine?.chantier} — {racine?.raison}</span>
                  <ListeTaches taches={taches} T={T}/>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function NonPlanifiees({ tri, T }) {
  if (!tri) return null;
  const { bloquees, apres_periode: apres, synthese } = tri;
  const titre = { fontSize: FONT.xs.size, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: T.textSub };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={titre}>Non planifiées</div>
      <div style={{ fontSize: FONT.base.size, fontWeight: 700, color: T.text }}>{synthese.texte}</div>
      {bloquees.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ ...titre, color: SEMANTIC.danger.color }}>Bloquées ({synthese.bloquees})</div>
          {bloquees.map(g => <GroupeChantier key={g.chantier_id || g.chantier} g={g} famille="bloquee" T={T}/>)}
        </div>
      )}
      {apres.length > 0 && (
        <details style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <summary style={{ ...titre, cursor: "pointer", padding: "4px 0" }}>Après la période calculée ({synthese.apres_periode})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {apres.map(g => <GroupeChantier key={g.chantier_id || g.chantier} g={g} famille="apres_periode" T={T}/>)}
          </div>
        </details>
      )}
    </div>
  );
}

function Chiffre({ valeur, libelle, couleur, T }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1, color: couleur || T.text }}>{valeur}</div>
      <div style={{ fontSize: FONT.sm.size, color: T.textSub }}>{libelle}</div>
    </div>
  );
}

export function ResumeRecalcul({ apercu, T, acc }) {
  const actuel = apercu.comparaison === "planning_actuel";
  const heure = apercu.calcule_le ? new Date(apercu.calcule_le) : null;
  const heureTxt = heure && !Number.isNaN(heure.getTime())
    ? `${String(heure.getHours()).padStart(2, "0")} h ${String(heure.getMinutes()).padStart(2, "0")}` : null;
  const ligne = { display: "flex", gap: 10, alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${T.sectionDivider}`, fontSize: FONT.base.size, color: T.text };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <Chiffre T={T} valeur={apercu.resume.deplacees} libelle="tâches déplacées" couleur={apercu.resume.deplacees ? T.text : T.textSub}/>
        <Chiffre T={T} valeur={apercu.resume.bloquees} libelle={apercu.resume.apres_periode ? `bloquées · ${apercu.resume.apres_periode} après la période` : "bloquées"} couleur={apercu.resume.bloquees ? SEMANTIC.danger.color : T.textSub}/>
        <Chiffre T={T} valeur={apercu.resume.conflits} libelle={apercu.resume.conflits > 1 ? "conflits" : "conflit"} couleur={apercu.resume.conflits ? SEMANTIC.warning.color : T.textSub}/>
      </div>

      {apercu.deplacees.length > 0 && (
        <div>
          {apercu.deplacees.map(d => (
            <div key={d.travail_id} style={ligne}>
              <span style={{ flexGrow: 1, minWidth: 0 }}><b>{d.chantier}</b> · {d.texte}</span>
              <span style={{ color: T.textSub, whiteSpace: "nowrap" }}>
                {d.avant.debut !== d.apres.debut ? `${jourSeul(d.avant.debut)} ${court(d.avant.debut).split(" ")[1]} → ${jourSeul(d.apres.debut)} ${court(d.apres.debut).split(" ")[1]}` : "équipe ou durée modifiée"}
              </span>
            </div>
          ))}
        </div>
      )}
      {apercu.nouvelles.length > 0 && (
        <div style={{ fontSize: FONT.base.size, color: T.text }}>
          <b>Nouvellement placées :</b> {apercu.nouvelles.map(n => `${n.chantier} · ${n.texte} (${court(n.debut)})`).join(" ; ")}
        </div>
      )}

      {apercu.non_planifiees.length > 0 && <NonPlanifiees tri={apercu.non_planifiees_tri} T={T}/>}

      {apercu.conflits.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {apercu.conflits.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: 10, borderRadius: RADIUS.lg, background: SEMANTIC.warning.bg, border: `1px solid ${SEMANTIC.warning.border}`, fontSize: FONT.sm.size, color: T.text, lineHeight: 1.45 }}>
              <Icon as={TriangleAlert} size={16} color={SEMANTIC.warning.color} style={{ flexShrink: 0, marginTop: 1 }}/>
              <span>{c.explication}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: FONT.sm.size, lineHeight: 1.5, color: T.textSub }}>
        {apercu.resume.deplacees === 0 && apercu.resume.non_planifiees === 0 && apercu.nouvelles.length === 0
          ? (actuel ? "La proposition est identique au planning actuel sur l'horizon calculé. " : "Le moteur ne déplace aucune tâche pour cette consigne sur l'horizon calculé. ")
          : ""}
        Chiffres issus du moteur de planning{heureTxt ? `, calculés à ${heureTxt}` : ""}
        {apercu.horizon?.start_date ? `, du ${court(apercu.horizon.start_date)} au ${court(apercu.horizon.end_date)}` : ""}.
        {" "}{apercu.non_planifiees_total > apercu.non_planifiees.length
          ? `${apercu.non_planifiees_total - apercu.non_planifiees.length} autre(s) tâche(s) restaient déjà non planifiées avant la consigne.`
          : ""}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: 12, borderRadius: RADIUS.lg, border: `1px dashed ${acc.border}`, color: T.text, fontSize: FONT.base.size, lineHeight: 1.45 }}>
        <Icon as={Info} size={16} style={{ flexShrink: 0, marginTop: 2 }}/>
        <span><b>Application au planning : étape 3.</b> {actuel
          ? "Rien n'est enregistré : ni consigne, ni planning."
          : "Rien n'est modifié dans le planning. La consigne reste enregistrée : annulez-la ci-dessous si elle ne convient pas."}</span>
      </div>
    </div>
  );
}
