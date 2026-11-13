// src/Invest/crm/CrmAvancement.jsx — Vue « Avancement » du CRM : une ligne par dossier (projet),
// les 11 étapes du parcours en colonnes. Colonnes d'identification figées à gauche, en-tête fixe.
//
// Lecture seule ici : un clic sur une cellule appelle onCellule (le panneau d'édition est ouvert
// par CrmV2). Calculs : avancementVue.mjs.
import React, { useMemo, useState } from "react";
import { ETAPES_PARCOURS } from "../dossiers/parcours";
import { STATUTS_PROJET, FILTRES_ALERTE, lignesAvancement, filtrerAvancement, attentionRequise } from "./avancementVue";
import { bornesBudget } from "./CrmSynthese";
import { Discret, Vide, dateFr, eur, ROUGE, ORANGE, GRIS, VERT, BLEU } from "./ui";

const VIOLET = "#7c3aed";
const COULEUR = { vert: VERT, bleu: BLEU, violet: VIOLET, rouge: ROUGE, gris: GRIS };
const TRANCHES = [["", "Tous budgets"], ["0-150", "Moins de 150 k€"], ["150-300", "150 à 300 k€"], ["300-500", "300 à 500 k€"], ["500-", "Plus de 500 k€"]];
const L_CLIENT = 210, L_BUDGET = 84, L_STATUT = 128;

/** Pastille d'état : terminée = rond vert coché, en cours = rond bleu plein, bloquée = carré rouge, attente = rond violet à moitié, non commencée = rond gris vide. */
function Marque({ cellule }) {
  const c = COULEUR[cellule.etat.ton];
  const base = { width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box", fontSize: 11, fontWeight: 900, lineHeight: 1 };
  switch (cellule.etat.cle) {
    case "terminee": return <span style={{ ...base, borderRadius: "50%", background: c, color: "#fff" }}>✓</span>;
    case "en_cours": return <span style={{ ...base, borderRadius: "50%", background: c, boxShadow: `0 0 0 3px ${c}33` }} />;
    case "en_attente": return <span style={{ ...base, borderRadius: "50%", border: `2px solid ${c}`, background: `linear-gradient(90deg, ${c} 50%, transparent 50%)` }} />;
    case "bloquee": return <span style={{ ...base, borderRadius: 4, background: c, color: "#fff" }}>!</span>;
    case "non_applicable": return <span style={{ ...base, color: c }}>–</span>;
    case "absente": return <span style={{ ...base, borderRadius: "50%", border: `2px dotted ${c}`, color: c, fontSize: 10 }}>?</span>;
    default: return <span style={{ ...base, borderRadius: "50%", border: `2px solid ${c}66` }} />;
  }
}

const infobulle = (l, c) => [
  `${c.numero}. ${c.libelle} — ${c.etat.libelle}`,
  c.etat.cle === "absente" ? "L'étape n'est pas enregistrée pour ce dossier (dossier historique)." : null,
  c.dateDebut ? `Début : ${dateFr(c.dateDebut)}` : null,
  c.dateFin ? `Validation : ${dateFr(c.dateFin)}` : null,
  c.blocage ? `Blocage : ${c.blocage}` : null,
  c.dernierCommentaire ? `Dernier commentaire : ${c.dernierCommentaire}` : null,
  c.modifiePar ? `Dernière modification : ${c.modifiePar}` : null,
  c.aConfirmer ? "Reprise à confirmer" : null,
].filter(Boolean).join("\n");

export default function CrmAvancement({ T, donnees, aujourdhui, seuil, estMoi, erreur, onClient, onCellule }) {
  const [filtres, setFiltres] = useState({ q: "", conseiller: "", statutProjet: "", etape: "", tranche: "", alerte: "", termines: false });
  const [mesDossiers, setMesDossiers] = useState(false);
  const maj = (k) => (e) => setFiltres((f) => ({ ...f, [k]: e.target.value }));
  const lignes = useMemo(() => lignesAvancement({ ...donnees, aujourdhui, seuilInactivite: seuil }), [donnees, aujourdhui, seuil]);
  const conseillers = useMemo(() => [...new Set(lignes.map((l) => l.conseiller).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const visibles = useMemo(() => {
    const f = filtrerAvancement(lignes, { ...filtres, ...bornesBudget(filtres.tranche), enCoursSeulement: !filtres.termines && !filtres.statutProjet });
    return mesDossiers ? f.filter((l) => estMoi(l.conseiller)) : f;
  }, [lignes, filtres, mesDossiers, estMoi]);
  const fond = T.surface || T.card || "#fff";
  const bord = T.border;
  const reinit = () => { setFiltres({ q: "", conseiller: "", statutProjet: "", etape: "", tranche: "", alerte: "", termines: false }); setMesDossiers(false); };
  const filtresActifs = Object.entries(filtres).some(([, v]) => v) || mesDossiers;

  if (erreur) return <Vide T={T} titre="Avancement indisponible" texte={`Les dossiers ou leurs étapes n'ont pas pu être lus (${erreur}). Réessayez avec « Actualiser ».`} />;
  const cellTh = { position: "sticky", top: 0, zIndex: 3, background: fond, borderBottom: `1px solid ${bord}`, padding: "7px 4px", fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: T.textMuted, textAlign: "center", whiteSpace: "nowrap" };
  const figee = (left, largeur, z = 2) => ({ position: "sticky", left, zIndex: z, background: fond, minWidth: largeur, maxWidth: largeur, width: largeur });

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 200, flex: "1 1 200px", maxWidth: 300 }} placeholder="Rechercher un client ou un dossier…" value={filtres.q} onChange={maj("q")} aria-label="Rechercher" />
        <button className={`inv-btn inv-btn-sm ${mesDossiers ? "inv-btn-gold" : ""}`} onClick={() => setMesDossiers((v) => !v)} aria-pressed={mesDossiers}>Mes dossiers</button>
        <select className="inv-sel" value={filtres.conseiller} onChange={maj("conseiller")} aria-label="Conseiller"><option value="">Tous les conseillers</option>{conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={filtres.statutProjet} onChange={maj("statutProjet")} aria-label="Statut du projet"><option value="">Projets en cours</option>{Object.entries(STATUTS_PROJET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="inv-sel" value={filtres.etape} onChange={maj("etape")} aria-label="Étape actuelle"><option value="">Toutes étapes</option>{ETAPES_PARCOURS.map((e) => <option key={e.cle} value={e.cle}>{e.numero}. {e.libelle}</option>)}</select>
        <select className="inv-sel" value={filtres.tranche} onChange={maj("tranche")} aria-label="Budget">{TRANCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="inv-sel" value={filtres.alerte} onChange={maj("alerte")} aria-label="Alertes"><option value="">Toutes alertes</option>{Object.entries(FILTRES_ALERTE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label style={{ fontSize: 12.5, color: T.textSub, display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={filtres.termines} onChange={(e) => setFiltres((f) => ({ ...f, termines: e.target.checked }))} />Inclure les projets clos</label>
        {filtresActifs && <button className="inv-btn inv-btn-sm" onClick={reinit}>Réinitialiser</button>}
        <Discret T={T} style={{ marginLeft: "auto" }}>{visibles.length} dossier{visibles.length > 1 ? "s" : ""}</Discret>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: T.textSub, marginBottom: 8, alignItems: "center" }}>
        {[["terminee", "Terminée"], ["en_cours", "En cours"], ["en_attente", "En attente"], ["bloquee", "Bloquée"], ["a_venir", "Non commencée"], ["absente", "Non renseignée"]].map(([cle, lib]) => {
          const ton = { terminee: "vert", en_cours: "bleu", en_attente: "violet", bloquee: "rouge", a_venir: "gris", absente: "gris" }[cle];
          return <span key={cle} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><Marque cellule={{ etat: { cle, ton } }} />{lib}</span>;
        })}
        <span>Fond coloré = étape actuelle · 💬 = commentaire · clic = détail et modification</span>
      </div>

      {visibles.length === 0 ? <Vide T={T} titre="Aucun dossier" texte="Aucun dossier ne correspond aux filtres." /> : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 330px)", border: `1px solid ${bord}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12.5, width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cellTh, ...figee(0, L_CLIENT, 4), textAlign: "left", paddingLeft: 12 }}>Client · projet</th>
                <th style={{ ...cellTh, ...figee(L_CLIENT, L_BUDGET, 4), textAlign: "right", paddingRight: 8 }}>Budget</th>
                <th style={{ ...cellTh, ...figee(L_CLIENT + L_BUDGET, L_STATUT, 4), textAlign: "left", paddingLeft: 8, boxShadow: `1px 0 0 ${bord}` }}>Statut</th>
                {ETAPES_PARCOURS.map((e) => <th key={e.cle} style={{ ...cellTh, minWidth: 82 }} title={`${e.numero}. ${e.libelle}`}>{e.numero}<br />{e.libelle.length > 11 ? `${e.libelle.slice(0, 10)}.` : e.libelle}</th>)}
                <th style={{ ...cellTh, textAlign: "left", minWidth: 220, paddingLeft: 12 }}>Prochaine action</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => {
                const motifs = attentionRequise(l.signaux);
                const alerte = motifs.some((m) => m.ton === "rouge") ? ROUGE : motifs.length ? ORANGE : "transparent";
                const ligneBord = `1px solid ${T.rowBorder || bord}`;
                return (
                  <tr key={l.dossierId}>
                    <td style={{ ...figee(0, L_CLIENT), borderBottom: ligneBord, borderLeft: `3px solid ${alerte}`, padding: "6px 8px 6px 9px", cursor: "pointer" }} onClick={() => onClient(l.clientId, l.dossierId)}
                      title={[l.libelle, ...motifs.map((m) => m.libelle)].filter(Boolean).join("\n")}>
                      <div style={{ fontWeight: 900, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.client}</div>
                      <div style={{ fontSize: 11, color: T.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {l.reference}{l.besoin.secteur ? ` · ${l.besoin.secteur}` : ""}{l.conseiller ? ` · ${l.conseiller}` : ""}
                      </div>
                    </td>
                    <td style={{ ...figee(L_CLIENT, L_BUDGET), borderBottom: ligneBord, textAlign: "right", padding: "6px 8px", color: T.text, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {l.besoin.budget ? eur(l.besoin.budget) : <span style={{ color: T.textMuted, fontWeight: 500 }}>—</span>}
                    </td>
                    <td style={{ ...figee(L_CLIENT + L_BUDGET, L_STATUT), borderBottom: ligneBord, padding: "6px 8px", boxShadow: `1px 0 0 ${bord}` }}>
                      <div style={{ fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{l.statutProjet.libelle}</div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>{l.applicables ? `${l.terminees}/${l.applicables} étapes` : "étapes non renseignées"}</div>
                    </td>
                    {l.cellules.map((c) => {
                      const cliquable = !!c.id;
                      const fond2 = c.actuelle ? `${COULEUR[c.etat.ton]}1c` : "transparent";
                      return (
                        <td key={c.etape} title={infobulle(l, c)} onClick={cliquable ? () => onCellule(l, c) : undefined}
                          style={{ borderBottom: ligneBord, textAlign: "center", padding: "5px 2px", cursor: cliquable ? "pointer" : "default", background: fond2,
                            boxShadow: c.actuelle ? `inset 0 0 0 1.5px ${COULEUR[c.etat.ton]}` : undefined }}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Marque cellule={c} />{c.dernierCommentaire && <span style={{ fontSize: 10 }} aria-label="Commentaire">💬</span>}</span>
                            <span style={{ fontSize: 10, color: c.etat.cle === "bloquee" ? ROUGE : T.textMuted, fontWeight: c.etat.cle === "bloquee" ? 800 : 500, whiteSpace: "nowrap" }}>
                              {c.etat.cle === "terminee" && c.dateFin ? dateFr(c.dateFin).slice(0, 5) : c.etat.cle === "en_cours" && c.dateDebut ? dateFr(c.dateDebut).slice(0, 5) : c.etat.cle === "bloquee" ? "bloquée" : " "}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td style={{ borderBottom: ligneBord, padding: "6px 12px", minWidth: 220, maxWidth: 280 }}>
                      {l.action ? <div style={{ color: T.text, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={l.action}>{l.action}</div>
                        : l.enCours ? <span style={{ color: ORANGE, fontWeight: 800 }}>Aucune action prévue</span> : <span style={{ color: T.textMuted }}>—</span>}
                      {l.echeance && <div style={{ fontSize: 11, color: l.echeance < aujourdhui ? ROUGE : T.textMuted, fontWeight: l.echeance < aujourdhui ? 800 : 500 }}>{dateFr(l.echeance)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
