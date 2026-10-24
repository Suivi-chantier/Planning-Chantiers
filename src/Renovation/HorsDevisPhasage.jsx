// ─────────────────────────────────────────────────────────────────────────────
// Phasage : tâches hors devis du chantier (refonte, étape 4).
//
// Pour chaque tâche hors devis existante (cochée hors devis, rangée dans
// « Divers / hors devis » ou déjà classée), le conducteur répond d'abord à
// « Ce travail est-il facturé au client ? », puis l'application le guide :
//   - oui, dans le devis → A (réaffecter les heures à la tâche existante, la
//     tâche hors devis disparaît) ou B (ajoutée à un ouvrage vendu avec ses
//     heures normales) ;
//   - oui, par un avenant → rattachée à l'ouvrage d'avenant chiffré ;
//   - non, offert → geste commercial (un coût sans production) ;
//   - pas encore décidé → « à arbitrer » (décisions attendues du Bilan).
// Un ouvrage à prix nul peut être marqué « non facturé ».
// Les règles sont dans horsDevisV2.mjs ; ici, seulement l'affichage et les
// appels au parent (qui écrit le phasage et, pour A, les pointages).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import {
  syntheseHorsDevisChantierV2, REPONSES_FACTURATION, tachesProbablesV2, heuresNormalesProposeesV2,
  reaffecterCasAV2, integrerCasBV2, rattacherAvenantV2, gesteCommercialV2, aArbitrerV2, marquerNonFactureV2,
  libelleMotifHD, libelleArbitrage, estOuvrageDiversV2, MOTIF_NON_RENSEIGNE,
} from "./horsDevisV2";

const fmtH = h => `${String(Math.round((h || 0) * 100) / 100).replace(".", ",")} h`;
const fmtEur = e => `${Math.round(e || 0).toLocaleString("fr-FR")} €`;
const fmtJour = d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");

const MESSAGES_ERREUR = {
  tache_introuvable: "Cette tâche n'existe plus dans le phasage : rechargez la page.",
  cible_introuvable: "Choisissez la tâche existante qui reçoit les heures.",
  ouvrage_introuvable: "Choisissez l'ouvrage.",
  ouvrage_divers: "Choisissez un ouvrage vendu (pas « Divers / hors devis »).",
  heures_normales: "Indiquez les heures normales de ce travail.",
  avenant_sans_prix: "L'ouvrage d'avenant doit avoir un prix : renseignez-le d'abord dans le phasage.",
  ouvrage_avec_prix: "Seul un ouvrage à prix nul peut être « non facturé ».",
};

/**
 * @param {object} props
 * @param {Array}    props.ouvrages
 * @param {Array}    props.pointages     pointages du chantier
 * @param {Function} props.tauxFGALaDate (date) → taux de frais généraux
 * @param {Array}    props.bibliotheque
 * @param {string}   props.auteur
 * @param {string}   props.aujourdHui    AAAA-MM-JJ
 * @param {number}   [props.semainesRappel]
 * @param {Function} props.onAppliquer   (ouvrages, { pointages?, recalculerDepuis? }) → Promise<boolean>
 */
export default function HorsDevisPhasage({ T, ouvrages = [], pointages = [], tauxFGALaDate, bibliotheque = [], auteur, aujourdHui,
  semainesRappel, onAppliquer, onClose }) {
  const [ouvert, setOuvert] = useState(null);         // tache_id en cours de classement
  const [choix, setChoix] = useState({});             // { reponse, sous: "A"|"B", cible, ouvrage_id, heures_normales }
  const [occupe, setOccupe] = useState(false);
  const synthese = useMemo(() => syntheseHorsDevisChantierV2({ ouvrages, pointages, tauxFG: tauxFGALaDate, aujourdHui, semainesRappel }),
    [ouvrages, pointages, tauxFGALaDate, aujourdHui, semainesRappel]);
  const vendus = useMemo(() => ouvrages.filter(o => o?.id && !estOuvrageDiversV2(o)), [ouvrages]);
  const sansPrix = useMemo(() => vendus.filter(o => !(parseFloat(o.prix_ht) > 0)), [vendus]);
  const ordre = { a_arbitrer: 0 };
  const lignes = [...synthese.taches].sort((a, b) =>
    ((ordre[a.arbitrage] ?? (a.motif === MOTIF_NON_RENSEIGNE ? 1 : 2)) - (ordre[b.arbitrage] ?? (b.motif === MOTIF_NON_RENSEIGNE ? 1 : 2)))
    || b.heures - a.heures);

  const appliquer = async (res, extra = {}) => {
    if (res?.erreur) { alert(MESSAGES_ERREUR[res.erreur] || res.erreur); return; }
    setOccupe(true);
    const ok = await onAppliquer(res.ouvrages, extra);
    setOccupe(false);
    if (ok !== false) { setOuvert(null); setChoix({}); }
  };
  const jours = (tacheId) => pointages.filter(p => String(p.tache_id) === String(tacheId)).map(p => p.date);
  const ctx = { date: aujourdHui, auteur };

  const bouton = (actif, couleur = "#2563eb") => ({
    padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: occupe ? "wait" : "pointer",
    border: `1px solid ${actif ? couleur : T.border}`, background: actif ? `${couleur}1f` : "transparent", color: actif ? couleur : T.text,
  });
  const champ = { padding: "5px 8px", fontSize: 12.5, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface || T.card, color: T.text, fontFamily: "inherit" };
  const carte = (titre, v, sous) => (
    <div style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, minWidth: 130 }}>
      <div style={{ fontSize: 11, color: T.textSub }}>{titre}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{v.nb} · {fmtH(v.heures)}</div>
      <div style={{ fontSize: 11, color: T.textSub }}>{fmtEur(v.cout)}{sous ? ` · ${sous}` : ""}</div>
    </div>
  );

  const editeur = (l) => {
    const c = choix;
    const reponse = REPONSES_FACTURATION.find(r => r.code === c.reponse);
    const probables = tachesProbablesV2({ nom: l.nom, ouvrages, exclure: [l.tache_id] });
    const avenants = vendus.filter(o => parseFloat(o.prix_ht) > 0 && String(o.id) !== String(l.ouvrage_id));
    const ouvB = vendus.find(o => String(o.id) === String(c.ouvrage_id));
    const propB = ouvB ? heuresNormalesProposeesV2({ nom: l.nom, ouvrage: ouvB, bibliotheque }) : null;
    return (
      <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: T.bg || T.card, border: `1px dashed ${T.border}` }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: T.text, marginBottom: 6 }}>Ce travail est-il facturé au client ?</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {REPONSES_FACTURATION.map(r => (
            <button key={r.code} type="button" style={bouton(c.reponse === r.code)} onClick={() => setChoix({ reponse: r.code })}>{r.label}</button>
          ))}
        </div>
        {reponse && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 6 }}>{reponse.aide}</div>}

        {c.reponse === "dans_devis" && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" style={bouton(c.sous === "A")} onClick={() => setChoix({ ...c, sous: "A" })}>A · La tâche existait déjà</button>
              <button type="button" style={bouton(c.sous === "B")} onClick={() => {
                const o = vendus.find(x => String(x.id) === String(l.ouvrage_id)) || vendus[0] || null;
                const p = o ? heuresNormalesProposeesV2({ nom: l.nom, ouvrage: o, bibliotheque }) : null;
                setChoix({ ...c, sous: "B", ouvrage_id: o?.id || null, heures_normales: p ? p.heures : "" });
              }}>B · Imprévu dans un ouvrage vendu</button>
            </div>
            {c.sous === "A" && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                {probables.length === 0 && <div style={{ fontSize: 12, color: T.textSub }}>Aucune tâche ressemblante dans le phasage.</div>}
                {probables.map(p => (
                  <div key={p.tache_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text }}>
                    <button type="button" disabled={occupe} style={bouton(false)} onClick={() => {
                      if (!window.confirm(`Réaffecter les ${fmtH(l.heures)} de « ${l.nom} » à « ${p.nom} » ?\n\nLa tâche hors devis est retirée du phasage ; ses heures (pointages) passent sur la tâche existante.`)) return;
                      const r = reaffecterCasAV2(ouvrages, l.tache_id, p.tache_id);
                      appliquer(r, { pointages: r.pointages, recalculerDepuis: l.premierJour });
                    }}>Réaffecter ici</button>
                    <span><strong>{p.nom}</strong> <span style={{ color: T.textSub }}>· {p.ouvrage} · {p.raisons.join(", ")}</span></span>
                  </div>
                ))}
              </div>
            )}
            {c.sous === "B" && (
              <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 130px auto", gap: 6, alignItems: "end" }}>
                <select value={c.ouvrage_id || ""} style={champ} onChange={e => {
                  const o = vendus.find(x => String(x.id) === e.target.value);
                  const p = o ? heuresNormalesProposeesV2({ nom: l.nom, ouvrage: o, bibliotheque }) : null;
                  setChoix({ ...c, ouvrage_id: e.target.value || null, heures_normales: p ? p.heures : c.heures_normales });
                }}>
                  {!c.ouvrage_id && <option value="">Choisissez l'ouvrage</option>}
                  {vendus.map(o => <option key={o.id} value={o.id}>{String(o.libelle || "(sans libellé)").slice(0, 80)}</option>)}
                </select>
                <input type="number" min="0" step="0.25" placeholder="Heures normales" value={c.heures_normales ?? ""} style={{ ...champ, textAlign: "right" }}
                  onChange={e => setChoix({ ...c, heures_normales: e.target.value })}/>
                <button type="button" disabled={occupe} style={bouton(true)} onClick={() =>
                  appliquer(integrerCasBV2(ouvrages, l.tache_id, c.ouvrage_id, { heuresNormales: c.heures_normales, ...ctx }), { recalculerDepuis: l.premierJour })}>
                  Intégrer
                </button>
                <div style={{ gridColumn: "1 / -1", fontSize: 11, color: T.textSub }}>
                  {propB ? `Bibliothèque : ${fmtH(propB.heures)} (${propB.detail}). ` : "Pas d'étape ressemblante dans la bibliothèque : estimez les heures normales. "}
                  Réalisé : {fmtH(l.heures)}. Les heures prévues de l'ouvrage ne changent pas.
                </div>
              </div>
            )}
          </div>
        )}
        {c.reponse === "avenant" && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {avenants.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textSub }}>Créez d'abord l'ouvrage d'avenant avec son prix dans le phasage, puis revenez ici.</div>
            ) : <>
              <select value={c.ouvrage_id || ""} style={{ ...champ, minWidth: 260 }} onChange={e => setChoix({ ...c, ouvrage_id: e.target.value || null })}>
                <option value="">Ouvrage d'avenant…</option>
                {avenants.map(o => <option key={o.id} value={o.id}>{String(o.libelle || "(sans libellé)").slice(0, 70)} — {fmtEur(o.prix_ht)}</option>)}
              </select>
              <button type="button" disabled={occupe || !c.ouvrage_id} style={bouton(true)} onClick={() => {
                const r = rattacherAvenantV2(ouvrages, l.tache_id, c.ouvrage_id, { ...ctx, joursDeclares: jours(l.tache_id) });
                appliquer(r, { recalculerDepuis: r.recalculerDepuis });
              }}>Rattacher à l'avenant</button>
              <div style={{ width: "100%", fontSize: 11, color: T.textSub }}>
                La production compte aux jours où la tâche a été déclarée{l.dernierJour ? ` (dernier : ${fmtJour(l.dernierJour)})` : ""} ; si ces jours sont dans un bilan déjà exporté, l'écart apparaît dans la ligne « Rectifications » du bilan suivant.
              </div>
            </>}
          </div>
        )}
        {c.reponse === "offert" && (
          <div style={{ marginTop: 8 }}>
            <button type="button" disabled={occupe} style={bouton(true, "#d18a16")} onClick={() => appliquer(gesteCommercialV2(ouvrages, l.tache_id, ctx))}>
              Passer en geste commercial ({fmtH(l.heures)}, {fmtEur(l.cout)})
            </button>
          </div>
        )}
        {c.reponse === "a_decider" && (
          <div style={{ marginTop: 8 }}>
            <button type="button" disabled={occupe} style={bouton(true, "#e05c5c")} onClick={() => appliquer(aArbitrerV2(ouvrages, l.tache_id, ctx))}>
              Marquer « à arbitrer »
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface || T.card, color: T.text, borderRadius: 12, width: "100%", maxWidth: 920, maxHeight: "90vh", overflow: "auto", border: `1px solid ${T.border}` }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Tâches hors devis du chantier</div>
          <button type="button" onClick={onClose} style={{ ...bouton(false), border: "none" }}>Fermer</button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {carte("À arbitrer", synthese.aArbitrer, synthese.rappels ? `${synthese.rappels} en attente depuis plus de ${semainesRappel ?? 3} sem.` : null)}
            {carte("A · non encore réaffectées", synthese.parMotif.introuvable)}
            {carte("B · ajoutées en cours", synthese.parMotif.imprevu)}
            {carte("Gestes commerciaux", synthese.gestesCommerciaux)}
            {carte("Avenants", synthese.avenants)}
            {carte("Non classées", synthese.parMotif.non_renseigne)}
          </div>
          <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
            Coût = heures × (taux horaire chargé de l'ouvrier + frais généraux à la date de l'heure). Une tâche à arbitrer ou offerte reste un coût
            réel, sans production ; rattachée à un avenant, elle produit.
          </div>
          {lignes.length === 0 && <div style={{ fontSize: 13, color: T.textSub }}>Aucune tâche hors devis sur ce chantier.</div>}
          {lignes.map(l => (
            <div key={l.tache_id} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${l.rappel ? "#e05c5c" : T.border}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>{l.nom || "(sans nom)"}</strong>
                <span style={{ fontSize: 11.5, color: T.textSub }}>{l.ouvrage}</span>
                <span style={{ fontSize: 12, marginLeft: "auto" }}>{fmtH(l.heures)} · {fmtEur(l.cout)}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4, fontSize: 11.5 }}>
                <span style={{ padding: "1px 7px", borderRadius: 999, background: T.card, border: `1px solid ${T.border}` }}>
                  {l.arbitrage ? libelleArbitrage(l.arbitrage) : l.ajouteeEnCours ? "Ajoutée en cours de chantier" : libelleMotifHD(l.motif)}
                </span>
                {l.rappel && <span style={{ color: "#e05c5c", fontWeight: 700 }}>à arbitrer depuis le {fmtJour(l.aArbitrerDepuis)}</span>}
                {l.motif === MOTIF_NON_RENSEIGNE && l.proposition && (
                  <span style={{ color: T.textSub }}>Proposé : {l.proposition.cas ? `cas ${l.proposition.cas}` : "rien"} — {l.proposition.raison}</span>
                )}
                {l.arbitrage !== "avenant" && (
                  <button type="button" style={{ ...bouton(ouvert === l.tache_id), marginLeft: "auto" }}
                    onClick={() => { setOuvert(ouvert === l.tache_id ? null : l.tache_id); setChoix({}); }}>
                    {ouvert === l.tache_id ? "Annuler" : "Classer"}
                  </button>
                )}
              </div>
              {ouvert === l.tache_id && editeur(l)}
            </div>
          ))}
          {sansPrix.length > 0 && (
            <div style={{ paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 4 }}>Ouvrages sans prix</div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 6 }}>Un ouvrage « non facturé » ne crée aucune production ; cochez-le pour le signaler comme tel.</div>
              {sansPrix.map(o => (
                <label key={o.id} style={{ display: "flex", gap: 8, fontSize: 12.5, alignItems: "center", marginBottom: 3 }}>
                  <input type="checkbox" checked={o.non_facture === true} disabled={occupe}
                    onChange={e => appliquer(marquerNonFactureV2(ouvrages, o.id, e.target.checked))}/>
                  {String(o.libelle || "(sans libellé)").slice(0, 90)}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
