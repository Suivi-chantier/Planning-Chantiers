// ─────────────────────────────────────────────────────────────────────────────
// Panneaux du relevé iMapper dans l'éditeur de plans (page Plans) :
//   • PanneauMetresReleve : « Métrés par pièce » + onglet « Points à valider » ;
//   • PanneauPieceReleve : nom, type, hauteur sous plafond, métrés, ouvertures,
//     photos (URL signées, mur visé surligné), observations et alertes ;
//   • PanneauOuvertureReleve : type, statut, largeur, hauteur, allège,
//     charnière, côté d'ouverture, suppression.
// Tous les chiffres viennent de releveImapper.mjs (calculerMetres…) ; ces
// panneaux n'en calculent aucun. Chaque modification passe par `modifier(fn)`
// fourni par l'éditeur, qui l'inscrit dans l'historique (annuler / rétablir).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import {
  calculerMetres, texteMetre, pointsAValider, HSP_DEFAUT, TYPES_PIECE, TYPES_OUVERTURE,
  STATUTS_OUVERTURE, largeurOuverture, prochainCode, placerOuverture,
  PLAFOND_IA_RELEVE_EUR, ESTIMATION_IA_PIECE_EUR, piecesAnalysables, budgetIARestant,
} from "./releveImapper";

const fr = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");
const cadre = {
  position: "absolute", top: 10, right: 10, zIndex: 5, width: 560, maxWidth: "calc(100% - 20px)",
  maxHeight: "calc(100% - 20px)", overflowY: "auto", background: "#1e2336", borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 30px rgba(0,0,0,0.45)", padding: 16, color: "#e8eaf0",
};
const bouton = (couleur = "#5b8af5") => ({
  background: `${couleur}22`, border: `1px solid ${couleur}66`, color: "#e8eaf0", borderRadius: 7,
  padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});
const etiquette = { fontSize: 11, color: "#9aa5c0", marginBottom: 3 };
const champ = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6,
  padding: "5px 8px", color: "#e8eaf0", fontFamily: "inherit", fontSize: 13,
};
const COULEUR_STATUT = { detecte: "#9aa5c0", confirme_photo: "#50c878", a_verifier: "#f5a623", valide: "#50c878" };

function Entete({ titre, onClose }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 800 }}>{titre}</div>
      <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#5b6a8a", fontSize: 18, cursor: "pointer" }}>✕</button>
    </div>
  );
}

// Saisie validée à la sortie du champ ou sur Entrée (une seule entrée
// d'historique par modification, pas une par touche).
function ChampValide({ valeur, onValider, placeholder, largeur = 90, suffixe }) {
  const [texte, setTexte] = useState(valeur ?? "");
  useEffect(() => { setTexte(valeur ?? ""); }, [valeur]);
  const valider = () => { if (String(texte) !== String(valeur ?? "")) onValider(texte); };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input value={texte} placeholder={placeholder} onChange={(e) => setTexte(e.target.value)}
        onBlur={valider} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ ...champ, width: largeur }} />
      {suffixe && <span style={{ fontSize: 12, color: "#9aa5c0" }}>{suffixe}</span>}
    </span>
  );
}
const nombre = (t) => { const n = parseFloat(String(t).replace(",", ".")); return Number.isFinite(n) ? n : null; };

// Vignette d'une photo du relevé (URL signée demandée à l'ouverture).
function Vignette({ photo, urls, demanderUrls, onClick, onSurvol, taille = 92 }) {
  useEffect(() => { if (photo?.chemin) demanderUrls([photo.chemin]); }, [photo?.chemin]);
  const url = photo?.chemin ? urls[photo.chemin] : null;
  return (
    <div onClick={onClick} onMouseEnter={onSurvol}
      style={{ width: taille, height: taille * 4 / 3, borderRadius: 6, overflow: "hidden", position: "relative",
        background: "#12151f", cursor: url ? "zoom-in" : "default", flexShrink: 0, border: "1px solid rgba(255,255,255,0.1)" }}>
      {url
        ? <img src={url} alt={`Photo ${photo.num}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <div style={{ fontSize: 10, color: "#7a86a6", padding: 6, textAlign: "center" }}>
            {photo?.chemin ? "Chargement…" : "photo non envoyée"}
          </div>}
      <span style={{ position: "absolute", top: 3, left: 3, background: "#1f2937", color: "#fff", borderRadius: 9,
        fontSize: 10, fontWeight: 800, padding: "1px 6px" }}>{photo?.num}</span>
    </div>
  );
}

export function PhotoAgrandie({ photo, url, legende, onClose }) {
  if (!photo) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 2100,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16 }}>
      {url ? <img src={url} alt="" style={{ maxWidth: "92vw", maxHeight: "84vh", borderRadius: 8 }} />
        : <div style={{ color: "#e8eaf0" }}>Chargement…</div>}
      <div style={{ color: "#e8eaf0", fontSize: 13 }}>{legende}</div>
    </div>
  );
}

// ── Analyse des photos par l'IA : bouton + état ────────────────────────────
// etat : { fait, total, cout, fini, echecs, arrete } pendant / après l'analyse.
function BlocAnalyseIA({ releve, onAnalyser, etat }) {
  const n = piecesAnalysables(releve).length;
  const deja = Number(releve.ia_cout_total) || 0;
  const reste = budgetIARestant(releve);
  const enCours = etat && !etat.fini;
  return (
    <div style={{ padding: 10, borderRadius: 10, background: "rgba(176,96,255,0.08)", border: "1px solid rgba(176,96,255,0.3)", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button disabled={enCours || !n || reste < ESTIMATION_IA_PIECE_EUR} onClick={() => onAnalyser(null)}
          style={{ ...bouton("#b060ff"), opacity: enCours || !n || reste < ESTIMATION_IA_PIECE_EUR ? 0.5 : 1 }}>
          📷 Analyser les photos (IA)
        </button>
        <span style={{ fontSize: 11, color: "#9aa5c0" }}>
          {n} pièce{n > 1 ? "s" : ""} avec photos · ≈ {fr(n * ESTIMATION_IA_PIECE_EUR)} € · plafond {fr(PLAFOND_IA_RELEVE_EUR)} € par relevé, {fr(deja)} € déjà consommés
        </span>
      </div>
      {etat && (
        <div style={{ fontSize: 12, marginTop: 6, color: etat.fini ? (etat.echecs || etat.arrete ? "#f5a623" : "#8fe0ad") : "#c8a0ff" }}>
          {etat.fini ? "Analyse terminée" : "Analyse en cours"} : {etat.fait}/{etat.total} pièce{etat.total > 1 ? "s" : ""} · {fr(etat.cout || 0)} €
          {etat.echecs ? ` · ${etat.echecs} échec${etat.echecs > 1 ? "s" : ""} (voir la pièce)` : ""}
          {etat.arrete ? ` · arrêtée : ${etat.arrete}` : ""}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#7a86a6", marginTop: 4 }}>
        L'IA confirme, requalifie ou écarte les ouvertures et propose des observations ; elle ne mesure rien. Tout reste à valider.
        Un Ctrl+Z annule toute l'analyse.
      </div>
    </div>
  );
}

// ── Métrés + points à valider ──────────────────────────────────────────────
export function PanneauMetresReleve({ releve, onglet = "metres", setOnglet, onClose, onPoint, urls, demanderUrls, onAnalyser, etatIA }) {
  const m = calculerMetres(releve);
  const pav = pointsAValider(releve);
  const cell = { padding: "5px 6px", textAlign: "right", whiteSpace: "nowrap" };
  const val = (l, k) => (l[k] == null
    ? <span style={{ color: "#f5a623", fontStyle: "italic" }}>en attente</span>
    : texteMetre(l[k], l.approx?.[k], l.raison));
  const nbPhotos = releve.pieces.reduce((t, p) => t + (p.photos || []).length, 0);
  const nbEnvoyees = releve.pieces.reduce((t, p) => t + (p.photos || []).filter((ph) => ph.chemin).length, 0);
  const H = m.hauteurs;
  const ong = (id, label) => (
    <button onClick={() => setOnglet(id)} style={{ ...bouton(onglet === id ? "#5b8af5" : "#7a86a6"),
      background: onglet === id ? "rgba(91,138,245,0.3)" : "transparent" }}>{label}</button>
  );
  // Photo du mur visé par une ouverture à vérifier (la première rattachée).
  const photoDe = (p) => {
    if (p.cible?.type !== "ouverture") return null;
    const o = (releve.ouvertures || []).find((x) => x.id === p.cible.id);
    const piece = o && releve.pieces.find((x) => x.id === o.piece);
    return piece && (piece.photos || []).find((ph) => ph.mur === o.mur && ph.chemin);
  };
  return (
    <div style={cadre}>
      <Entete titre={onglet === "points" ? "Points à valider" : "Métrés par pièce"} onClose={onClose} />
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {ong("metres", "Métrés")}
        {ong("points", `Points à valider (${pav.length})`)}
      </div>
      {onAnalyser && <BlocAnalyseIA releve={releve} onAnalyser={onAnalyser} etat={etatIA} />}
      {onglet === "metres" && (<>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ color: "#9aa5c0", borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
              <th style={{ ...cell, textAlign: "left" }}>Pièce</th>
              <th style={cell}>Sol (m²)</th><th style={cell}>Périm. (m)</th><th style={cell}>Plinthes (m)</th>
              <th style={cell}>Murs bruts (m²)</th><th style={cell}>Murs nets (m²)</th>
            </tr>
          </thead>
          <tbody>
            {m.pieces.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}
                onClick={() => onPoint?.({ cible: { type: "piece", id: l.id } }, "corriger")}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>{l.nom}</td>
                <td style={cell}>{fr(l.sol)}</td><td style={cell}>{fr(l.perimetre)}</td>
                <td style={cell}>{val(l, "plinthes")}</td><td style={cell}>{val(l, "murs_bruts")}</td>
                <td style={cell}>{val(l, "murs_nets")}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800, borderTop: "1px solid rgba(255,255,255,0.2)" }}>
              <td style={{ ...cell, textAlign: "left" }}>Total</td>
              <td style={cell}>{fr(m.total.sol)}</td><td style={cell}>{fr(m.total.perimetre)}</td>
              <td style={cell}>{val(m.total, "plinthes")}</td><td style={cell}>{val(m.total, "murs_bruts")}</td>
              <td style={cell}>{val(m.total, "murs_nets")}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: "#7a86a6", marginTop: 8, lineHeight: 1.5 }}>
          Hypothèses : hauteur sous plafond {fr(HSP_DEFAUT)} m tant qu'elle n'est pas mesurée (« ≈ ») · portes {fr(H.porte)} m ·
          portes-fenêtres {fr(H.porte_fenetre)} m · fenêtres {fr(H.fenetre)} m · baies {fr(H.baie)} m, sauf hauteur saisie.
          Plinthes = périmètre − largeurs des portes, portes-fenêtres et baies. Les ouvertures « à vérifier » sont déduites
          (valeurs précédées de « ≈ ») ; les placards ne sont pas déduits.
          {!m.ouverturesConnues && <> <strong style={{ color: "#f5a623" }}>Plinthes et murs nets : en attente des ouvertures</strong>.</>}
        </div>
        <div style={{ fontSize: 11, color: "#7a86a6", marginTop: 6 }}>
          Photos : {nbEnvoyees}/{nbPhotos} rangées dans le stockage privé du chantier. Cliquer une pièce pour l'ouvrir.
        </div>
      </>)}
      {onglet === "points" && (
        pav.length === 0
          ? <div style={{ fontSize: 13, color: "#8fe0ad" }}>Plus rien à valider sur ce relevé.</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pav.map((p) => {
                const ph = photoDe(p);
                const detecter = p.code === "ouvertures_non_relevees";
                return (
                  <div key={p.cle} style={{ display: "flex", gap: 10, padding: 10, borderRadius: 10,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    {ph && <Vignette photo={ph} urls={urls} demanderUrls={demanderUrls} taille={54} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#c8d0e0", lineHeight: 1.45, marginBottom: 6 }}>{p.texte}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {detecter
                          ? <button style={bouton("#50c878")} onClick={() => onPoint(p, "detecter")}>Détecter les portes et fenêtres</button>
                          : p.code === "ouverture_a_placer"
                          ? <>
                              <button style={bouton()} onClick={() => onPoint(p, "corriger")}>Placer</button>
                              <button style={bouton("#e05c5c")} onClick={() => onPoint(p, "supprimer")}>Supprimer</button>
                            </>
                          : <>
                              <button style={bouton("#50c878")} onClick={() => onPoint(p, "confirmer")}>Confirmer</button>
                              {p.cible && <button style={bouton()} onClick={() => onPoint(p, "corriger")}>Corriger</button>}
                              {p.code !== "hsp_defaut" && <button style={bouton("#e05c5c")} onClick={() => onPoint(p, "supprimer")}>Supprimer</button>}
                            </>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
      )}
    </div>
  );
}

// ── Pièce sélectionnée ─────────────────────────────────────────────────────
export function PanneauPieceReleve({ releve, pieceId, modifier, onClose, onSelection, setMurSurligne, urls, demanderUrls, onAnalyser, analyseEnCours }) {
  const p = releve.pieces.find((x) => x.id === pieceId);
  const [agrandie, setAgrandie] = useState(null);
  if (!p) return null;
  const l = calculerMetres(releve).pieces.find((x) => x.id === p.id);
  const majPiece = (patch) => modifier((r) => ({ ...r, pieces: r.pieces.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) }));
  const ouvs = (releve.ouvertures || []).filter((o) => !o.masque && (o.piece === p.id || (o.pieces_liees || []).includes(p.id)));
  const alertes = (releve.alertes || []).filter((a) => !a.vue && (a.piece === p.id || (a.pieces || []).includes(p.id)));
  const photos = p.photos || [];
  const ligne = (label, k) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: "#9aa5c0" }}>{label}</span>
      <span>{l[k] == null ? <em style={{ color: "#f5a623" }}>en attente des ouvertures</em> : texteMetre(l[k], l.approx?.[k], l.raison)}</span>
    </div>
  );
  return (
    <div style={cadre}>
      <Entete titre={`Pièce — ${p.nom}`} onClose={onClose} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={etiquette}>Nom</div>
          <ChampValide valeur={p.nom} largeur={170} onValider={(t) => t.trim() && majPiece({ nom: t.trim() })} />
        </div>
        <div>
          <div style={etiquette}>Type</div>
          <select value={p.type} onChange={(e) => majPiece({ type: e.target.value })} style={{ ...champ, width: 150 }}>
            {TYPES_PIECE.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <div style={etiquette}>Hauteur sous plafond</div>
          <ChampValide valeur={fr(p.hsp ?? HSP_DEFAUT)} largeur={70} suffixe="m"
            onValider={(t) => { const n = nombre(t); if (n > 1 && n < 10) majPiece({ hsp: n, hsp_statut: "mesuree" }); }} />
          <div style={{ fontSize: 11, marginTop: 3, color: p.hsp_statut === "mesuree" ? "#8fe0ad" : "#f5a623" }}>
            {p.hsp_statut === "mesuree" ? "saisie" : "valeur par défaut, non mesurée"}
            {p.hsp_statut === "mesuree" && (
              <button onClick={() => majPiece({ hsp: HSP_DEFAUT, hsp_statut: "defaut" })}
                style={{ marginLeft: 6, background: "none", border: "none", color: "#7a86a6", textDecoration: "underline", cursor: "pointer", fontSize: 11 }}>
                revenir au défaut
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Métrés</div>
      {ligne("Sol (m²)", "sol")}{ligne("Périmètre (m)", "perimetre")}{ligne("Plinthes (m)", "plinthes")}
      {ligne("Murs bruts (m²)", "murs_bruts")}{ligne("Murs nets (m²)", "murs_nets")}{ligne("Plafond (m²)", "plafond")}

      <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Ouvertures ({ouvs.length})</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {ouvs.length === 0 && <span style={{ fontSize: 12, color: "#7a86a6" }}>Aucune. Outil « Ouverture sur mur » pour en poser une.</span>}
        {ouvs.map((o) => (
          <button key={o.id} onClick={() => onSelection({ type: "ouverture", id: o.id })}
            style={{ ...bouton(COULEUR_STATUT[o.statut]), borderStyle: o.statut === "a_verifier" ? "dashed" : "solid" }}>
            {o.code} · {o.t0 == null ? "à placer" : `${Math.round((o.t1 - o.t0) * 100)} cm`}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Photos ({photos.length})</div>
      {photos.length === 0
        ? <div style={{ fontSize: 12, color: "#7a86a6" }}>Aucune photo rattachée à cette pièce.</div>
        : <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} onMouseLeave={() => setMurSurligne(null)}>
            {photos.map((ph) => (
              <Vignette key={ph.num} photo={ph} urls={urls} demanderUrls={demanderUrls} taille={78}
                onSurvol={() => setMurSurligne(ph.mur != null ? { piece: p.id, mur: ph.mur } : null)}
                onClick={() => { setAgrandie(ph); setMurSurligne(ph.mur != null ? { piece: p.id, mur: ph.mur } : null); }} />
            ))}
          </div>}
      <div style={{ fontSize: 11, color: "#7a86a6", marginTop: 4 }}>Survoler une photo surligne le mur qu'elle montre.</div>

      {(() => {
        const ecartees = (releve.ouvertures || []).filter((o) => o.masque && (o.piece === p.id || (o.pieces_liees || []).includes(p.id)));
        if (!ecartees.length) return null;
        return (<>
          <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Écartées par l'IA ({ecartees.length})</div>
          {ecartees.map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0" }}>
              <span style={{ flex: 1, color: "#9aa5c0" }}>
                {o.code} · {Math.round((o.t1 - o.t0) * 100)} cm — pas une ouverture d'après les photos{o.ia?.photos?.length ? ` (photo ${o.ia.photos.join(", ")})` : ""}
              </span>
              <button style={bouton()} onClick={() => modifier((r) => ({ ...r, ouvertures: r.ouvertures.map((x) => (x.id === o.id ? { ...x, masque: false, statut: "a_verifier", raison: "rétablie après avoir été écartée par l'IA" } : x)) }))}>
                Rétablir
              </button>
            </div>
          ))}
        </>);
      })()}

      <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Analyse des photos (IA)</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        {onAnalyser && photos.some((ph) => ph.chemin) && (
          <button style={{ ...bouton("#b060ff"), opacity: analyseEnCours ? 0.5 : 1 }} disabled={analyseEnCours} onClick={() => onAnalyser([p.id])}>
            📷 {p.analyse_ia ? "Relancer l'analyse" : "Analyser les photos de cette pièce"}
          </button>
        )}
        <span style={{ color: p.analyse_ia?.statut === "erreur" ? "#ff8a8a" : "#9aa5c0" }}>
          {!p.analyse_ia ? "Pas encore analysée."
            : p.analyse_ia.statut === "erreur" ? `Échec : ${p.analyse_ia.message}`
            : `Analysée${p.analyse_ia.date ? ` le ${new Date(p.analyse_ia.date).toLocaleDateString("fr-FR")}` : ""}${p.analyse_ia.cout_eur != null ? ` · ${fr(p.analyse_ia.cout_eur, 3)} €` : ""}${p.analyse_ia.ignorees ? ` · ${p.analyse_ia.ignorees} réponse(s) ignorée(s)` : ""}`}
        </span>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Observations</div>
      {(p.observations || []).length === 0
        ? <div style={{ fontSize: 12, color: "#7a86a6" }}>Aucune pour l'instant : l'analyse des photos en propose.</div>
        : (p.observations || []).map((ob, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "4px 0" }}>
              <span style={{ flex: 1, color: ob.statut === "valide" ? "#e8eaf0" : "#c8d0e0" }}>
                {ob.source === "ia" && ob.statut !== "valide" && <span style={{ color: "#c8a0ff", fontSize: 10, fontWeight: 800, marginRight: 4 }}>IA</span>}
                {ob.texte}
              </span>
              {ob.statut !== "valide" && <button style={bouton("#50c878")} onClick={() => majPiece({ observations: p.observations.map((x, j) => (j === i ? { ...x, statut: "valide" } : x)) })}>Valider</button>}
              <button style={bouton("#e05c5c")} onClick={() => majPiece({ observations: p.observations.filter((_, j) => j !== i) })}>Supprimer</button>
            </div>
          ))}
      {alertes.length > 0 && (<>
        <div style={{ fontSize: 13, fontWeight: 800, margin: "12px 0 6px" }}>Alertes</div>
        {alertes.map((a, i) => <div key={i} style={{ fontSize: 12, color: "#f5a623", padding: "2px 0" }}>{a.texte}</div>)}
      </>)}
      <PhotoAgrandie photo={agrandie} url={agrandie?.chemin ? urls[agrandie.chemin] : null}
        legende={`${p.nom} — photo ${agrandie?.num}${agrandie?.mur != null ? " (mur surligné sur le plan)" : " (mur non identifié)"}`}
        onClose={() => setAgrandie(null)} />
    </div>
  );
}

// ── Ouverture sélectionnée ─────────────────────────────────────────────────
export function PanneauOuvertureReleve({ releve, ouvertureId, modifier, onClose, onSelection }) {
  const o = (releve.ouvertures || []).find((x) => x.id === ouvertureId);
  if (!o) return null;
  const maj = (fn) => modifier((r) => ({ ...r, ouvertures: r.ouvertures.map((x) => (x.id === o.id ? fn(x, r) : x)) }));
  const nomPiece = (id) => releve.pieces.find((p) => p.id === id)?.nom || "?";
  const type = TYPES_OUVERTURE.find((t) => t.id === o.type);
  const largeurCm = o.t0 == null ? null : Math.round((o.t1 - o.t0) * 100);
  const cm = (v) => (v == null ? "" : String(Math.round(v * 100)));
  const avecSens = ["porte", "porte_fenetre", "placard"].includes(o.type);
  return (
    <div style={cadre}>
      <Entete titre={`Ouverture ${o.code}`} onClose={onClose} />
      <div style={{ fontSize: 12, color: "#9aa5c0", marginBottom: 10 }}>
        {(o.pieces_liees || [o.piece]).map((id) => (
          <button key={id} onClick={() => onSelection({ type: "piece", id })}
            style={{ background: "none", border: "none", color: "#a0b8ff", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, marginRight: 8 }}>
            {nomPiece(id)}
          </button>
        ))}
        · glisser l'ouverture sur le plan pour la déplacer le long du mur
      </div>
      {o.t0 == null && (
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.4)", marginBottom: 12, fontSize: 12 }}>
          Vue sur les photos, mais sa position et sa largeur sont inconnues : elle n'est ni dessinée ni déduite des métrés.
          <div style={{ marginTop: 6 }}>
            <button style={bouton("#f5a623")} onClick={() => maj((x, r) => placerOuverture(r, x))}>Placer au centre du mur</button>
            <span style={{ marginLeft: 8, color: "#9aa5c0" }}>puis la glisser et corriger sa largeur</span>
          </div>
        </div>
      )}
      {o.ia && (
        <div style={{ fontSize: 12, color: "#c8a0ff", marginBottom: 8 }}>
          IA : {{ confirme: "confirmée", requalifie: `requalifiée en ${(TYPES_OUVERTURE.find((t) => t.id === o.ia.type) || {}).label?.toLowerCase() || o.ia.type}`, faux_positif: "pas une ouverture", incertain: "incertaine", nouvelle: "vue sur les photos, absente du relevé" }[o.ia.verdict] || o.ia.verdict}
          {o.ia.photos?.length ? ` · photo${o.ia.photos.length > 1 ? "s" : ""} ${o.ia.photos.join(", ")}` : ""}
          {o.ia.confiance != null ? ` · confiance ${fr(o.ia.confiance)}` : ""}
          {(o.statut === "valide" || o.origine === "manuel") && " (non appliqué : décision du bureau conservée)"}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: COULEUR_STATUT[o.statut] }}>{STATUTS_OUVERTURE[o.statut] || o.statut}</span>
        {o.raison && <span style={{ fontSize: 12, color: "#9aa5c0" }}>— {o.raison}</span>}
        {o.statut !== "valide" && (
          <button style={bouton("#50c878")} onClick={() => maj((x) => ({ ...x, statut: "valide", raison: null }))}>Marquer validée</button>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={etiquette}>Type</div>
          <select value={o.type} style={{ ...champ, width: 200 }}
            onChange={(e) => {
              const t = e.target.value;
              maj((x, r) => ({ ...x, type: t, code: prochainCode(r.ouvertures.filter((y) => y.id !== x.id), t) }));
            }}>
            {TYPES_OUVERTURE.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <div style={etiquette}>Largeur</div>
          <ChampValide valeur={largeurCm == null ? "" : String(largeurCm)} largeur={60} suffixe="cm" placeholder="à placer"
            onValider={(t) => { const n = nombre(t); if (n >= 10 && n <= 1000 && o.t0 != null) maj((x, r) => largeurOuverture(r, x, n / 100)); }} />
        </div>
        <div>
          <div style={etiquette}>Hauteur</div>
          <ChampValide valeur={cm(o.hauteur)} largeur={60} suffixe="cm" placeholder="défaut"
            onValider={(t) => { const n = nombre(t); maj((x) => ({ ...x, hauteur: n > 0 ? n / 100 : null })); }} />
        </div>
        <div>
          <div style={etiquette}>Allège</div>
          <ChampValide valeur={cm(o.allege)} largeur={60} suffixe="cm" placeholder="—"
            onValider={(t) => { const n = nombre(t); maj((x) => ({ ...x, allege: n >= 0 && t.trim() !== "" ? n / 100 : null })); }} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#7a86a6", marginBottom: 12 }}>
        Largeur mesurée dans le relevé (« ≈ », à ± 5 cm). Sans hauteur saisie, les métrés prennent la hauteur par défaut
        du type ({type?.label?.toLowerCase()}).
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {avecSens && <button style={bouton()} onClick={() => maj((x) => ({ ...x, sens: { ...(x.sens || {}), charniere: x.sens?.charniere === "t1" ? "t0" : "t1" } }))}>
          Inverser la charnière
        </button>}
        {avecSens && <button style={bouton()} onClick={() => maj((x) => ({ ...x, sens: { ...(x.sens || {}), cote: x.sens?.cote === "exterieur" ? "interieur" : "exterieur" } }))}>
          Ouvrir de l'autre côté
        </button>}
        <button style={bouton("#e05c5c")} onClick={() => {
          modifier((r) => ({ ...r, ouvertures: r.ouvertures.filter((x) => x.id !== o.id) }));
          onClose();
        }}>Supprimer</button>
      </div>
    </div>
  );
}
