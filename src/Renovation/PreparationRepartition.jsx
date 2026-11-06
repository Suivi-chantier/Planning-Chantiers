// Préparer le chantier — étape « Où se fait chaque ouvrage » (tranche 1b).
// Sous-composant de PreparationChantier.jsx. Tous les calculs (découpage,
// reste à placer, aperçu, état, ouvrage suivant) viennent du module pur
// preparationChantierV1.mjs. AUCUNE écriture ici : la validation remonte
// l'ouvrage modifié au parcours (onValider), qui écrit par Phasage V2.
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import {
  ETATS_OUVRAGE, MODES, GRANULARITE_MUR, GRANULARITE_PIECE,
  etatOuvrage, compteurPlaces, resteAPlacer, granulariteParDefaut, tacheCommencee,
  ouvrageDejaDecoupe, repartitionActuelle, mettreLeResteDans, apercuPlacement, ouvrageSuivant,
  placerDansUnePiece, placerToutLeLogement, decouperOuvrage, compterIdsNecessaires,
} from "./preparationChantierV1";
import { nomAffiche } from "./phasageMobileV1";
import { propositionPourOuvrage } from "./preparationCopieV1";

const TOUCHE = 44;
const rid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => (n == null ? "—" : (Math.round(Number(n) * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const libelleOuvrage = (o) => String(o?.libelle || o?.code_ouvrage || "Ouvrage sans nom").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const uniteOuvrage = (o) => String(o?.unite || "").replace(/^m2$/i, "m²");
const quantiteOuvrage = (o) => { const q = parseFloat(o?.quantite); return Number.isFinite(q) && q > 0 ? q : null; };

// Choix proposé à l'ouverture d'un ouvrage. Une proposition reprise d'un
// autre logement (étape « Point de départ ») pré-remplit l'écran : rien
// n'est appliqué tant que le conducteur n'a pas validé l'ouvrage.
function choixInitial(o, pieces, heuresPointees, preparation) {
  const dejaPlace = (preparation?.ouvrages_places || []).map(String).includes(String(o?.id));
  const p = o && !dejaPlace && !ouvrageDejaDecoupe(o) ? propositionPourOuvrage(preparation, o.id, pieces) : null;
  if (p && !(p.mode === "plusieurs" && !quantiteOuvrage(o))) {
    return {
      mode: p.mode, pieceId: p.mode === "piece" ? String(p.pieceId) : "",
      lignes: p.mode === "plusieurs" ? p.lignes.map(l => ({ key: rid(), piece_id: String(l.piece_id), mur: l.mur || "", quantite: l.quantite })) : [],
      granularites: { ...(p.granularites || {}) }, propose: true,
    };
  }
  return { ...modeInitial(o, pieces, heuresPointees), lignes: [], granularites: {}, propose: false };
}

// Mode proposé à l'ouverture d'un ouvrage.
function modeInitial(o, pieces, heuresPointees) {
  if (pieces.length === 0) return { mode: "logement", pieceId: "" };
  const libres = (o?.taches || []).filter(t => !tacheCommencee(t, heuresPointees));
  const ids = [...new Set(libres.map(t => t.piece_id || ""))];
  if (libres.length > 0 && ids.length === 1 && ids[0] && pieces.some(p => p.id === ids[0])) return { mode: "piece", pieceId: ids[0] };
  return { mode: quantiteOuvrage(o) ? "plusieurs" : "piece", pieceId: "" };
}

export default function PreparationRepartition({ ouvrages, pieces, preparation, heuresPointees, onValider, onRetourPieces, T, accent, surAccent }) {
  const opts = { preparation, heuresPointees };
  const premier = () => ouvrageSuivant(ouvrages, null, opts) || ouvrages[0] || null;
  const [courantId, setCourantId] = useState(() => premier()?.id ?? null);
  const courant = ouvrages.find(o => String(o.id) === String(courantId)) || null;
  const [choix, setChoix] = useState(() => choixInitial(courant, pieces, heuresPointees, preparation));
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const { mode, pieceId, lignes, granularites } = choix;
  const maj = (patch) => { setChoix(c => ({ ...c, ...patch })); setErreur(""); };

  const ouvrir = (o) => {
    setCourantId(o?.id ?? null);
    setChoix(choixInitial(o, pieces, heuresPointees, preparation));
    setErreur("");
  };

  const compteur = compteurPlaces(ouvrages, opts);
  const etat = courant ? etatOuvrage(courant, { ...opts, enCoursId: courant.id }) : null;
  const dejaDecoupe = courant ? ouvrageDejaDecoupe(courant) : false;
  const unite = uniteOuvrage(courant);
  const reste = courant ? resteAPlacer(courant, lignes) : null;
  const apercu = useMemo(() => (courant
    ? apercuPlacement(courant, mode, { pieces, pieceId, lignes, granularites, heuresPointees })
    : null), [courant, mode, pieces, pieceId, lignes, granularites, heuresPointees]);

  // ── Lignes « plusieurs pièces / murs » ──
  const ajouterLigne = (piece_id) => maj({ lignes: [...lignes, { key: rid(), piece_id, mur: "", quantite: "" }] });
  const majLigne = (key, patch) => maj({ lignes: lignes.map(l => (l.key === key ? { ...l, ...patch } : l)) });
  const retirerLigne = (key) => maj({ lignes: lignes.filter(l => l.key !== key) });
  const resteDans = (pid) => maj({ lignes: mettreLeResteDans(courant, lignes, pid).map(l => ({ key: l.key || rid(), ...l })) });
  const granulariteDe = (t) => granularites[String(t.id)] || granulariteParDefaut(t);

  const valider = async () => {
    if (!courant || envoi || !apercu?.ok) return;
    let res;
    if (mode === "piece") res = placerDansUnePiece(courant, pieceId, { pieces, heuresPointees });
    else if (mode === "logement") res = placerToutLeLogement(courant, { heuresPointees });
    else {
      const existants = new Set(ouvrages.flatMap(o => (o.taches || []).map(t => String(t.id))));
      const n = compterIdsNecessaires(courant, lignes, { granularites, heuresPointees });
      const ids = [];
      while (ids.length < n) { const id = rid(); if (!existants.has(id) && !ids.includes(id)) ids.push(id); }
      res = decouperOuvrage(courant, lignes, { pieces, granularites, heuresPointees, nouveauxIds: ids });
    }
    if (!res.ok) { setErreur(res.erreur); return; }
    setEnvoi(true);
    try {
      const modifie = res.ouvrage !== courant ? res.ouvrage : null;
      const r = await onValider(courant.id, modifie, mode);
      if (!r?.ok) return;
      const apres = modifie ? ouvrages.map(o => (String(o.id) === String(courant.id) ? modifie : o)) : ouvrages;
      const suivant = ouvrageSuivant(apres, courant.id, { preparation: r.preparation, heuresPointees });
      if (suivant) {
        setCourantId(suivant.id);
        setChoix(choixInitial(suivant, pieces, heuresPointees, r.preparation));
        setErreur("");
      }
    } finally {
      setEnvoi(false);
    }
  };

  // ── Styles ──
  const btn = (plein = false, actif = false) => ({
    minHeight: TOUCHE, padding: "0 18px", borderRadius: RADIUS.md, fontFamily: "inherit",
    fontSize: FONT.sm.size + 1, fontWeight: plein || actif ? 700 : 500, cursor: "pointer",
    border: `1px solid ${plein || actif ? accent : T.border}`,
    background: plein ? accent : actif ? (T.tagBg || "transparent") : "transparent",
    color: plein ? surAccent : actif ? accent : T.text,
  });
  const pastille = (pointille = false) => ({
    minHeight: TOUCHE, padding: "0 14px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT.sm.size + 1,
    border: `1px ${pointille ? "dashed" : "solid"} ${T.textMuted}`, background: "transparent", color: T.text, cursor: "pointer",
  });
  const champ = { minHeight: TOUCHE, boxSizing: "border-box", padding: "0 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 2 };
  const carte = { background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg || RADIUS.md };
  const sousTitre = { margin: 0, fontSize: FONT.sm.size + 3, fontWeight: 700 };
  const badge = (e) => {
    const c = e === "place" ? [T.tagReelBg, T.tagReelColor] : e === "en_cours" ? [T.tagBg, T.tagColor || accent] : [T.card, T.textSub];
    return { fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: RADIUS.pill, whiteSpace: "nowrap", background: c[0], color: c[1], border: `1px solid ${T.border}` };
  };

  const pct = compteur.total > 0 ? Math.round(100 * compteur.places / compteur.total) : 0;
  const libres = (courant?.taches || []).filter(t => !tacheCommencee(t, heuresPointees));
  const commencees = (courant?.taches || []).filter(t => tacheCommencee(t, heuresPointees));

  return (
    <div style={{ width: "100%", maxWidth: 1240, margin: "0 auto", padding: "24px 20px", boxSizing: "border-box", display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>
      {/* ── Liste des ouvrages ── */}
      <aside style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 style={sousTitre}>Ouvrages du devis</h2>
          <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>{compteur.libelle}</span>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={compteur.total} aria-valuenow={compteur.places} aria-label="Ouvrages placés"
          style={{ height: 6, borderRadius: 999, background: T.border, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: accent }}/>
        </div>
        {compteur.dejaCommences > 0 && (
          <div style={{ color: T.textSub, fontSize: FONT.xs.size + 1 }}>
            {compteur.dejaCommences} ouvrage{compteur.dejaCommences > 1 ? "s" : ""} déjà commencé{compteur.dejaCommences > 1 ? "s" : ""} : non compté{compteur.dejaCommences > 1 ? "s" : ""}, il{compteur.dejaCommences > 1 ? "s restent" : " reste"} tel{compteur.dejaCommences > 1 ? "s" : ""} quel{compteur.dejaCommences > 1 ? "s" : ""}.
          </div>
        )}
        {ouvrages.length === 0 && <div style={{ color: T.textSub, fontSize: FONT.sm.size + 1 }}>Aucun ouvrage dans le phasage.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {ouvrages.map(o => {
            const e = etatOuvrage(o, { ...opts, enCoursId: courantId });
            const actif = String(o.id) === String(courantId);
            const q = quantiteOuvrage(o);
            const nb = (o.taches || []).length;
            return (
              <li key={o.id}>
                <button onClick={() => ouvrir(o)} aria-current={actif ? "true" : undefined}
                  style={{ width: "100%", textAlign: "left", fontFamily: "inherit", color: T.text, cursor: "pointer", display: "flex", gap: 12, alignItems: "center",
                    padding: "10px 14px", minHeight: TOUCHE, borderRadius: RADIUS.md, background: actif ? (T.cardHover || T.card) : T.card,
                    border: `1px solid ${actif ? (T.borderHover || accent) : T.border}` }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{libelleOuvrage(o)}</span>
                    <span style={{ fontSize: FONT.xs.size + 1, color: T.textSub }}>
                      {q ? `${fmt(q)} ${uniteOuvrage(o)}` : "Quantité non renseignée"} · {nb} tâche{nb > 1 ? "s" : ""}{ouvrageDejaDecoupe(o) ? " · déjà découpé" : ""}
                      {e !== "place" && e !== "deja_commence" && propositionPourOuvrage(preparation, o.id, pieces) ? " · proposition à vérifier" : ""}
                    </span>
                  </span>
                  <span style={badge(e)}>{ETATS_OUVRAGE[e]}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* ── Ouvrage ouvert ── */}
      <section style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
        {!courant && <div style={{ color: T.textSub, fontSize: FONT.sm.size + 2 }}>Choisis un ouvrage dans la liste.</div>}
        {courant && (<>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>{libelleOuvrage(courant)}</div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>
              Où se fait cet ouvrage ? <span style={{ color: T.textSub, fontWeight: 600 }}>{quantiteOuvrage(courant) ? `${fmt(quantiteOuvrage(courant))} ${unite}` : ""}</span>
            </h1>
          </div>

          {/* Ouvrage déjà découpé : lecture seule (pas de redécoupage part par part). */}
          {dejaDecoupe && (
            <div style={{ ...carte, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={badge("place")}>Placé</span>
                <span style={{ fontSize: FONT.sm.size + 1, fontWeight: 600 }}>Déjà découpé lors d'une préparation précédente</span>
              </div>
              {repartitionActuelle(courant, pieces).map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: FONT.sm.size + 1, padding: "6px 0", borderTop: `1px solid ${T.border}` }}>
                  <span>{l.piece}{l.mur ? `, ${l.mur}` : ""}</span><span style={{ color: T.textSub }}>{fmt(l.quantite)} {unite}</span>
                </div>
              ))}
              <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                Pour éviter de redécouper des parts qui ont déjà leurs heures, ce parcours ne propose pas de le redécouper.
                Pour changer la répartition, modifiez ses tâches dans Phasage V2.
              </p>
            </div>
          )}

          {!dejaDecoupe && etat === "deja_commence" && (
            <div style={{ ...carte, padding: 16, color: T.textSub, fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
              Toutes les tâches de cet ouvrage sont déjà commencées : il reste tel quel (déjà commencé, non découpé).
            </div>
          )}

          {!dejaDecoupe && etat !== "deja_commence" && (<>
            {etat === "place" && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                Cet ouvrage est déjà marqué « Placé ». Valider à nouveau remplace sa répartition par celle ci-dessous.
              </div>
            )}
            {choix.propose && (
              <div style={{ ...carte, padding: "12px 16px", fontSize: FONT.sm.size + 1, lineHeight: 1.5, borderColor: accent }}>
                <strong>Proposition reprise{preparation?.copie?.nom ? ` de ${preparation.copie.nom}` : " d'un autre logement"}</strong>
                {mode === "plusieurs" ? " — m² recalculés en proportion de la quantité de ce logement." : "."}
                {" "}Vérifie les lignes ci-dessous, modifie-les si besoin, puis valide : rien n'est appliqué avant « Valider cet ouvrage ».
              </div>
            )}
            {libres.length === 0 && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>Cet ouvrage n'a pas de tâche : le valider le marque simplement « Placé ».</div>
            )}

            <div role="group" aria-label="Type de répartition" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["piece", "plusieurs", "logement"].map(m => {
                const impossible = (m !== "logement" && pieces.length === 0) || (m === "plusieurs" && !quantiteOuvrage(courant));
                return (
                  <button key={m} onClick={() => !impossible && maj({ mode: m })} disabled={impossible} aria-pressed={mode === m}
                    title={impossible ? (pieces.length === 0 ? "Ajoute d'abord des pièces" : "L'ouvrage n'a pas de quantité au devis") : MODES[m]}
                    style={{ ...btn(false, mode === m), opacity: impossible ? 0.45 : 1, cursor: impossible ? "default" : "pointer" }}>
                    {MODES[m]}
                  </button>
                );
              })}
            </div>
            {pieces.length === 0 && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Aucune pièce : seul « Tout le logement » est possible. <button onClick={onRetourPieces} style={{ ...pastille(true), minHeight: 36, marginLeft: 6 }}>Ajouter des pièces</button></div>
            )}
            {pieces.length > 0 && !quantiteOuvrage(courant) && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size }}>Quantité au devis non renseignée : le découpage par m² n'est pas possible pour cet ouvrage.</div>
            )}

            {mode === "piece" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {pieces.map(p => (
                  <button key={p.id} onClick={() => maj({ pieceId: p.id })} aria-pressed={pieceId === p.id} style={{ ...btn(false, pieceId === p.id), borderRadius: RADIUS.pill }}>{p.nom}</button>
                ))}
              </div>
            )}
            {mode === "logement" && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
                Les tâches restent communes à tout le logement, sans pièce. Rien n'est découpé.
              </div>
            )}

            {mode === "plusieurs" && (<>
              <div style={{ ...carte, overflow: "hidden" }}>
                {lignes.length === 0 && (
                  <div style={{ padding: "14px 16px", color: T.textSub, fontSize: FONT.sm.size + 1 }}>Touche une pièce ci-dessous pour ajouter une ligne.</div>
                )}
                {lignes.map(l => (
                  <div key={l.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: `1px solid ${T.sectionDivider || T.border}` }}>
                    <select value={l.piece_id} onChange={e => majLigne(l.key, { piece_id: e.target.value })} aria-label="Pièce"
                      style={{ ...champ, flex: "1 1 160px", fontWeight: 600 }}>
                      {pieces.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
                    </select>
                    <label style={{ flex: "2 1 220px", display: "flex", alignItems: "center", gap: 8, color: T.textSub, fontSize: FONT.sm.size }}>Mur
                      <input type="text" value={l.mur} onChange={e => majLigne(l.key, { mur: e.target.value })} placeholder="Préciser le mur (facultatif)" style={{ ...champ, flex: 1, minWidth: 0 }}/>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, color: T.textSub, fontSize: FONT.sm.size }}>
                      <input type="text" inputMode="decimal" value={l.quantite} onChange={e => majLigne(l.key, { quantite: e.target.value })} aria-label={`Quantité en ${unite || "unités"}`}
                        style={{ ...champ, width: 84, textAlign: "right", fontWeight: 700 }}/>{unite}
                    </label>
                    <button onClick={() => retirerLigne(l.key)} aria-label="Retirer cette ligne"
                      style={{ width: TOUCHE, height: TOUCHE, border: "none", background: "transparent", color: T.textSub, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon as={X} size={18}/>
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "12px 16px" }}>
                  {pieces.map(p => <button key={p.id} onClick={() => ajouterLigne(p.id)} style={pastille(true)}>+ {p.nom}</button>)}
                  <button onClick={() => lignes.length && ajouterLigne(lignes[lignes.length - 1].piece_id)} disabled={!lignes.length}
                    style={{ ...pastille(true), opacity: lignes.length ? 1 : 0.45 }}>+ Autre mur dans la même pièce</button>
                </div>
              </div>

              {reste && (() => {
                const juste = reste.reste != null && Math.abs(reste.reste) < 0.001;
                const trop = reste.reste != null && reste.reste < -0.001;
                const couleur = juste ? T.tagReelColor : T.cmdColor;
                const ratio = reste.total ? Math.min(100, Math.round(100 * reste.place / reste.total)) : 0;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, background: juste ? T.tagReelBg : T.cmdBg, border: `1px solid ${juste ? T.tagReelColor : T.cmdBorder}`, borderRadius: RADIUS.md, padding: "14px 18px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
                      <span style={{ fontSize: 24, fontWeight: 800, color: couleur }}>
                        {juste ? "Tout est placé" : trop ? `${fmt(-reste.reste)} ${unite} de trop` : `Reste ${fmt(reste.reste)} ${unite} à placer`}
                      </span>
                      <div style={{ flex: "1 1 200px", height: 8, borderRadius: 999, background: T.border, overflow: "hidden" }}>
                        <div style={{ width: `${ratio}%`, height: "100%", background: couleur }}/>
                      </div>
                      <span style={{ color: couleur, fontSize: FONT.sm.size + 1 }}>{fmt(reste.place)} / {fmt(reste.total)} {unite}</span>
                    </div>
                    {reste.reste > 0.001 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>Mettre le reste dans…</span>
                        {pieces.map(p => <button key={p.id} onClick={() => resteDans(p.id)} style={pastille()}>{p.nom}</button>)}
                      </div>
                    )}
                  </div>
                );
              })()}

              {libres.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <h2 style={sousTitre}>Découpage de chaque tâche</h2>
                  {libres.map(t => {
                    const g = granulariteDe(t);
                    return (
                      <div key={t.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
                        <span style={{ flex: "1 1 220px", fontSize: FONT.sm.size + 1 }}>{nomAffiche(t)}</span>
                        <span role="group" aria-label={`Découpage de ${nomAffiche(t)}`} style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => maj({ granularites: { ...granularites, [String(t.id)]: GRANULARITE_MUR } })} aria-pressed={g === GRANULARITE_MUR} style={btn(false, g === GRANULARITE_MUR)}>Par mur</button>
                          <button onClick={() => maj({ granularites: { ...granularites, [String(t.id)]: GRANULARITE_PIECE } })} aria-pressed={g === GRANULARITE_PIECE} style={btn(false, g === GRANULARITE_PIECE)}>Par pièce</button>
                        </span>
                      </div>
                    );
                  })}
                  <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                    « Par pièce » regroupe les murs d'une même pièce en une seule tâche (proposé pour les bandes, passes, enduits, ponçage, impression et peinture).
                  </p>
                </div>
              )}
            </>)}

            {commencees.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {commencees.map(t => (
                  <div key={t.id} style={{ fontSize: FONT.sm.size + 1, color: T.textSub }}>
                    {nomAffiche(t)} — <strong>déjà commencée, non découpée</strong> (reste telle quelle)
                  </div>
                ))}
              </div>
            )}

            {/* Aperçu « Ce que verront les ouvriers » */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 style={sousTitre}>Ce que verront les ouvriers</h2>
              {apercu && !apercu.ok && (
                <div style={{ color: T.textSub, fontSize: FONT.sm.size + 1 }}>{apercu.erreur}</div>
              )}
              {apercu?.ok && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                  {apercu.taches.map((t, i) => (
                    <div key={i} style={{ ...carte, padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, fontSize: FONT.sm.size + 1 }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span>{t.nom}</span>
                        <span style={{ color: T.textSub, fontSize: FONT.xs.size + 1 }}>
                          {t.dejaCommencee ? "déjà commencée, non découpée" : (t.piece ? `${t.piece}${t.mur ? `, ${t.mur}` : ""}` : "Tout le logement")}
                        </span>
                      </span>
                      <span style={{ color: T.textSub, whiteSpace: "nowrap" }}>{t.quantite_part != null ? `${fmt(t.quantite_part)} ${unite}` : ""}</span>
                    </div>
                  ))}
                </div>
              )}
              {mode === "plusieurs" && (
                <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                  Les heures de chaque tâche sont réparties au prorata des {unite || "quantités"}. Le total des heures estimées, des heures vendues et des % de l'ouvrage ne change pas.
                </p>
              )}
            </div>

            {erreur && <div role="alert" style={{ color: "#e15a5a", fontSize: FONT.sm.size + 1, fontWeight: 600 }}>{erreur}</div>}
          </>)}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "flex-end", paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <button onClick={() => { const s = ouvrageSuivant(ouvrages, courant.id, opts); if (s) ouvrir(s); }} style={btn()}>Ouvrage suivant</button>
            {!dejaDecoupe && etat !== "deja_commence" && (
              <button onClick={valider} disabled={!apercu?.ok || envoi} style={{ ...btn(true), opacity: !apercu?.ok || envoi ? 0.5 : 1, cursor: !apercu?.ok || envoi ? "default" : "pointer" }}>
                {envoi ? "Enregistrement…" : "Valider cet ouvrage"}
              </button>
            )}
          </div>
        </>)}
      </section>
    </div>
  );
}
