// ─────────────────────────────────────────────────────────────────────────────
// Choix du cas d'une ligne hors devis (refonte, étape 4) — Validation et
// Phasage :
//   A. la tâche existait : on propose les tâches les plus probables, le
//      conducteur rattache la ligne (aucune tâche créée) ;
//   B. imprévu dans un ouvrage vendu : ouvrage + heures NORMALES (proposées
//      par la bibliothèque quand elle a une étape au nom proche) ;
//   C. non vendu : « à arbitrer » dans « Divers / hors devis ».
// Les règles sont dans horsDevisV2.mjs ; ce composant ne fait qu'afficher.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo } from "react";
import { tachesProbablesV2, heuresNormalesProposeesV2, MOTIFS_HORS_DEVIS, estOuvrageDiversV2 } from "./horsDevisV2";

const fmtH = h => `${String(Math.round(h * 100) / 100).replace(".", ",")} h`;

/**
 * @param {object} props
 * @param {{ cas, ouvrage_id, heures_normales }} props.valeur
 * @param {Function} props.onChange       (patch) → void
 * @param {Function} [props.onRattacher]  (tacheId) → void ; absent = pas de cas A
 * @param {string}   props.nom             ce que l'ouvrier a écrit
 * @param {Array}    props.ouvrages        phasage du chantier (ouvrages complets)
 * @param {Array}    [props.bibliotheque]  [{ id, cadence, unite, sous_taches }]
 * @param {string[]} [props.tachesPrevuesJour]
 * @param {string[]} [props.exclure]
 */
export default function ChoixCasHorsDevis({ valeur = {}, onChange, onRattacher = null, nom, ouvrages = [], bibliotheque = [],
  tachesPrevuesJour = [], exclure = [], T, desactive = false }) {
  const cas = valeur.cas || null;
  const vendus = useMemo(() => (ouvrages || []).filter(o => o?.id && !estOuvrageDiversV2(o)), [ouvrages]);
  const probables = useMemo(() => (onRattacher ? tachesProbablesV2({ nom, ouvrages, tachesPrevuesJour, exclure }) : []),
    [onRattacher, nom, ouvrages, tachesPrevuesJour, exclure]);
  const ouvrageB = vendus.find(o => String(o.id) === String(valeur.ouvrage_id)) || null;
  const proposition = useMemo(() => (ouvrageB ? heuresNormalesProposeesV2({ nom, ouvrage: ouvrageB, bibliotheque }) : null),
    [nom, ouvrageB, bibliotheque]);
  const bleu = "#2563eb";
  const champ = { padding: "5px 8px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit" };
  const bouton = (actif) => ({
    padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: "inherit",
    cursor: desactive ? "default" : "pointer",
    border: `1px solid ${actif ? bleu : T.border}`, background: actif ? "rgba(37,99,235,0.12)" : "transparent", color: actif ? bleu : T.text,
  });
  const choisir = (c) => {
    if (desactive) return;
    if (c === "B") {
      const o = ouvrageB || vendus[0] || null;
      const p = o ? heuresNormalesProposeesV2({ nom, ouvrage: o, bibliotheque }) : null;
      onChange({ cas: "B", ouvrage_id: o?.id || null, heures_normales: valeur.heures_normales || (p ? p.heures : "") });
    } else onChange({ cas: c });
  };
  const motifs = MOTIFS_HORS_DEVIS.filter(m => m.cas !== "A" || onRattacher);

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: T.textSub, textTransform: "uppercase", letterSpacing: .4, marginBottom: 4 }}>
        Quel cas ?
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {motifs.map(m => (
          <button key={m.cas} type="button" onClick={() => choisir(m.cas)} style={bouton(cas === m.cas)} title={m.explication}>
            {m.cas} · {m.cas === "A" ? "Elle existait déjà" : m.cas === "B" ? "Imprévu dans un ouvrage vendu" : "Non vendu (à arbitrer)"}
          </button>
        ))}
      </div>
      {!cas && (
        <div style={{ fontSize: 11, color: "#d18a16", marginTop: 4 }}>
          Aucun cas choisi : la tâche sera créée « motif non renseigné ».
        </div>
      )}

      {cas === "A" && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {probables.length === 0 ? (
            <div style={{ fontSize: 12, color: T.textSub }}>Aucune tâche ressemblante : choisissez-la dans la liste « Tâche du plan ».</div>
          ) : probables.map(p => (
            <div key={p.tache_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text }}>
              <button type="button" disabled={desactive} onClick={() => onRattacher(p.tache_id)} style={bouton(false)}>Rattacher</button>
              <span><strong>{p.nom}</strong> <span style={{ color: T.textSub }}>· {p.ouvrage} · {p.raisons.join(", ")}</span></span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: T.textSub }}>Les heures vont à la tâche existante ; aucune tâche n'est créée.</div>
        </div>
      )}

      {cas === "B" && (
        <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 140px", gap: 6 }}>
          <div>
            <div style={{ fontSize: 11, color: T.textSub }}>Ouvrage vendu</div>
            <select value={valeur.ouvrage_id || ""} disabled={desactive} style={{ ...champ, width: "100%" }}
              onChange={e => {
                const o = vendus.find(x => String(x.id) === e.target.value);
                const p = o ? heuresNormalesProposeesV2({ nom, ouvrage: o, bibliotheque }) : null;
                onChange({ ouvrage_id: e.target.value || null, ...(p && !valeur.heures_normales ? { heures_normales: p.heures } : {}) });
              }}>
              {!valeur.ouvrage_id && <option value="">Choisissez l'ouvrage</option>}
              {vendus.map(o => <option key={o.id} value={o.id}>{String(o.libelle || "(sans libellé)").slice(0, 80)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textSub }}>Heures normales</div>
            <input type="number" min="0" step="0.25" value={valeur.heures_normales ?? ""} disabled={desactive}
              onChange={e => onChange({ heures_normales: e.target.value })} style={{ ...champ, width: "100%", textAlign: "right" }}/>
          </div>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: T.textSub, lineHeight: 1.4 }}>
            {proposition
              ? <>Bibliothèque : <strong>{fmtH(proposition.heures)}</strong> ({proposition.detail}).{" "}
                  {String(valeur.heures_normales) !== String(proposition.heures) && !desactive && (
                    <button type="button" onClick={() => onChange({ heures_normales: proposition.heures })} style={{ ...bouton(false), padding: "1px 6px" }}>Reprendre</button>
                  )}</>
              : "Pas d'étape ressemblante dans la bibliothèque : estimez les heures qu'il faut NORMALEMENT pour ce travail."}
            {" "}C'est le poids de la tâche dans l'avancement ; les heures prévues de l'ouvrage ne changent pas, la dérive reste visible.
            {!(parseFloat(valeur.heures_normales) > 0) && <div style={{ color: "#e05c5c", fontWeight: 700 }}>Heures normales à renseigner.</div>}
          </div>
        </div>
      )}

      {cas === "C" && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: T.textSub, lineHeight: 1.4 }}>
          Rangée dans « Divers / hors devis », <strong>à arbitrer</strong> : elle remonte dans les décisions attendues du Bilan
          (avenant ou geste commercial), avec ses heures et son coût.
        </div>
      )}
    </div>
  );
}
