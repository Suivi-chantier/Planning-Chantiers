// Préparer le chantier — étape « Point de départ » (tranche 3).
// Sous-composant de PreparationChantier.jsx. Propose les logements de la même
// opération dont la préparation est faite, plus « Partir de zéro ».
// Lecture des phasages source : preparationSourcesLoader (lecture seule).
// Calculs : preparationCopieV1.mjs (module pur). AUCUNE écriture ici : la
// copie remonte au parcours (onCopier), qui écrit par Phasage V2 (saveMeta).
import React, { useEffect, useMemo, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { chargerLogementsSources } from "./preparationSourcesLoader";
import { OPTIONS_DEFAUT, basculerOption, logementsSources, resumeSource } from "./preparationCopieV1";

const TOUCHE = 34; // hauteur des boutons, alignée sur le reste de l'appli
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

const OPTIONS = [
  { cle: "pieces", label: "Les pièces", aide: "Noms et ordre de visite" },
  { cle: "repartition", label: "La répartition", aide: "Proposée ouvrage par ouvrage à l'étape 3, reprise en proportion si les quantités diffèrent" },
  { cle: "consignes", label: "Les consignes", aide: "Par pièce et par mur" },
  { cle: "photos", label: "Les plans et photos", aide: "Décoché par défaut : un plan est propre à chaque logement" },
];

export default function PreparationDepart({ logementsOperation = [], ouvrages = [], aDejaDesPieces = false, enregistrement = false, onCopier, onPartirDeZero, T, accent, surAccent }) {
  const [etat, setEtat] = useState({ chargement: true, erreur: "", sources: [], critere: "terminee" });
  const [choisi, setChoisi] = useState(null);       // chantier_id du logement source
  const [options, setOptions] = useState(OPTIONS_DEFAUT);

  const ids = logementsOperation.map(l => l.id).join("|");
  useEffect(() => {
    let annule = false;
    if (!logementsOperation.length) { setEtat({ chargement: false, erreur: "", sources: [], critere: "terminee" }); return undefined; }
    setEtat(e => ({ ...e, chargement: true, erreur: "" }));
    chargerLogementsSources(logementsOperation).then(r => {
      if (annule) return;
      if (!r.ok) { setEtat({ chargement: false, erreur: r.erreur || "Lecture impossible", sources: [], critere: "terminee" }); return; }
      const { critere, logements } = logementsSources(r.sources);
      setEtat({ chargement: false, erreur: "", sources: logements, critere });
      setChoisi(logements[0]?.chantier_id ?? null);
    }).catch(err => { if (!annule) setEtat({ chargement: false, erreur: String(err?.message || err), sources: [], critere: "terminee" }); });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  const resumes = useMemo(() => Object.fromEntries(etat.sources.map(s => [s.chantier_id, resumeSource(s, ouvrages)])), [etat.sources, ouvrages]);
  const source = etat.sources.find(s => s.chantier_id === choisi) || null;

  const carte = (actif, pointille = false) => ({
    textAlign: "left", fontFamily: "inherit", color: T.text, cursor: "pointer", minHeight: TOUCHE,
    background: actif ? (T.tagBg || "transparent") : T.card,
    border: `${actif ? 2 : 1}px ${pointille ? "dashed" : "solid"} ${actif ? accent : T.border}`,
    borderRadius: RADIUS.lg || RADIUS.md, padding: 20, display: "flex", flexDirection: "column", gap: 10,
  });
  const btn = (plein = false) => ({
    minHeight: TOUCHE, padding: "0 16px", borderRadius: RADIUS.md, fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${plein ? accent : T.border}`, background: plein ? accent : "transparent", color: plein ? surAccent : T.text,
  });

  return (
    <div style={{ width: "100%", maxWidth: 1080, margin: "0 auto", padding: "20px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, letterSpacing: -0.2 }}>Ce logement ressemble à un autre ?</h1>
        <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size + 1, lineHeight: 1.5, maxWidth: 720 }}>
          Si un logement de la même opération est déjà préparé, on reprend ses pièces, sa répartition et ses consignes. Il ne restera qu'à vérifier.
        </p>
      </div>

      {etat.chargement && <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Recherche des logements de la même opération…</div>}
      {!etat.chargement && etat.erreur && (
        <div role="alert" style={{ color: "#e15a5a", fontSize: FONT.sm.size }}>Les autres logements n'ont pas pu être lus ({etat.erreur}). Vous pouvez partir de zéro.</div>
      )}
      {!etat.chargement && !etat.erreur && logementsOperation.length === 0 && (
        <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Ce logement n'est rattaché à aucune opération avec d'autres logements : rien à copier.</div>
      )}
      {!etat.chargement && !etat.erreur && logementsOperation.length > 0 && etat.sources.length === 0 && (
        <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Aucun autre logement de l'opération n'est encore préparé : rien à copier pour l'instant.</div>
      )}
      {!etat.chargement && etat.critere === "partielle" && etat.sources.length > 0 && (
        <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Aucune préparation n'est encore notée « terminée » : sont proposés les logements qui ont déjà des pièces et au moins un ouvrage placé.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {etat.sources.map((s, i) => {
          const r = resumes[s.chantier_id];
          const actif = choisi === s.chantier_id;
          return (
            <button key={s.chantier_id} onClick={() => setChoisi(s.chantier_id)} aria-pressed={actif} style={carte(actif)}>
              <span style={{ alignSelf: "flex-start", fontSize: FONT.xs.size, fontWeight: 700, padding: "2px 10px", borderRadius: RADIUS.pill, background: i === 0 ? accent : T.card, color: i === 0 ? surAccent : T.textSub, border: `1px solid ${T.border}` }}>
                {etat.critere === "terminee" ? "Préparation terminée" : "Préparation en cours"} · même opération
              </span>
              <span style={{ fontSize: FONT.lg.size, fontWeight: 800 }}>Copier {s.nom}</span>
              <span style={{ color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                {pluriel(r.pieces, "pièce")} · {pluriel(r.repartis, "ouvrage")} réparti{r.repartis > 1 ? "s" : ""} · {pluriel(r.consignes, "consigne")}{r.photos ? ` · ${pluriel(r.photos, "photo")}` : ""}
              </span>
              <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>Ouvrages identiques au devis : {r.identiques} sur {r.totalCible}</span>
            </button>
          );
        })}
        <button onClick={() => setChoisi(null)} aria-pressed={choisi == null} style={carte(choisi == null, true)}>
          <span style={{ fontSize: FONT.lg.size, fontWeight: 800 }}>Partir de zéro</span>
          <span style={{ color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>On crée les pièces et on répartit les ouvrages un par un.</span>
        </button>
      </div>

      {source && (
        <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg || RADIUS.md, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={{ margin: 0, fontSize: FONT.base.size, fontWeight: 700 }}>Ce qui sera copié depuis {source.nom}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {OPTIONS.map(o => (
              <label key={o.cle} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, minHeight: TOUCHE, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, cursor: "pointer" }}>
                <input type="checkbox" checked={!!options[o.cle]} onChange={e => setOptions(basculerOption(options, o.cle, e.target.checked))}
                  style={{ width: 22, height: 22, margin: 0, accentColor: accent }}/>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontWeight: 700 }}>{o.label}</span>
                  <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>{o.aide}</span>
                </span>
              </label>
            ))}
          </div>
          <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
            Rien n'est figé : tout reste modifiable aux étapes suivantes. La répartition n'est appliquée à aucun ouvrage tant que vous ne l'avez pas validée à l'étape 3.
            Les ouvrages sans équivalent dans ce logement restent « À placer ». L'avancement, les heures et les ouvriers ne sont jamais copiés.
            {aDejaDesPieces ? " Les pièces de même nom déjà créées dans ce logement sont gardées (leurs consignes aussi)." : ""}
          </p>
        </section>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "flex-end" }}>
        {source ? (
          <button onClick={() => onCopier(source, options)} disabled={enregistrement || !options.pieces}
            title={!options.pieces ? "Coche au moins les pièces" : undefined}
            style={{ ...btn(true), opacity: enregistrement || !options.pieces ? 0.5 : 1 }}>
            {enregistrement ? "Copie en cours…" : "Copier et continuer"}
          </button>
        ) : (
          <button onClick={onPartirDeZero} style={btn(true)}>Continuer : les pièces</button>
        )}
      </div>
    </div>
  );
}
