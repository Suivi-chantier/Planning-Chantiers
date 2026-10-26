// ─────────────────────────────────────────────────────────────────────────────
// Phasage › « Hors devis » › Classement en masse (CR-6, partie 6D).
//
// Toutes les tâches hors devis encore à classer du chantier, avec le cas
// proposé (A / B / C / standard), l'explication, le niveau de confiance et,
// pour A, la tâche proposée (lot › ouvrage). Rien n'est coché au départ ; le
// choix se modifie ligne par ligne ; « Appliquer la sélection » montre un
// récapitulatif puis applique, tâche par tâche, EXACTEMENT les opérations du
// classement unitaire (planClassementMasseV2 enchaîne reaffecterCasAV2,
// integrerCasBV2, aArbitrerV2) par le même onAppliquer que « Classer ».
// Chantier repris : « Tout laisser en l'état » d'un clic (marque datée avec
// auteur dans chaque tâche, réversible).
// Règles : horsDevisV2.mjs. Ici : affichage et appels au parent.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from "react";
import {
  propositionsClassementMasseV2, planClassementMasseV2, refusLigneMasseV2, texteConfirmationMasseV2,
  laisserToutEnEtatV2, reprendreClassementV2, cheminOuvrageV2, estOuvrageDiversV2, libelleConfiance, CHOIX_MASSE_V2,
} from "./horsDevisV2";

const fmtH = h => `${String(Math.round((h || 0) * 100) / 100).replace(".", ",")} h`;
const fmtEur = e => `${Math.round(e || 0).toLocaleString("fr-FR")} €`;
const fmtJour = d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const COULEUR_CONFIANCE = { eleve: "#16a34a", moyen: "#d18a16", faible: "#e05c5c", aucune: "#888888" };
const majuscule = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * @param {object} props
 * @param {Array}    props.ouvrages
 * @param {Array}    props.pointages
 * @param {Function} props.tauxFGALaDate
 * @param {Array}    props.lots
 * @param {Array}    props.bibliotheque
 * @param {string}   props.auteur
 * @param {string}   props.aujourdHui
 * @param {object|null} props.repris       chantierRepris(phasage)
 * @param {Function} props.onAppliquer     même fonction que le classement unitaire
 * @param {Function} [props.onRecalculer]  (date) → demande de recalcul du relevé (mécanisme existant)
 */
export default function ClassementMasseHorsDevis({ T, ouvrages = [], pointages = [], tauxFGALaDate, lots = [], bibliotheque = [],
  auteur, aujourdHui, repris = null, onAppliquer, onRecalculer }) {
  const [sel, setSel] = useState({});          // tache_id → { coche, choix, cible_id, ouvrage_id, heures_normales }
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);

  const { lignes, synthese } = useMemo(() => propositionsClassementMasseV2({
    ouvrages, pointages, tauxFG: tauxFGALaDate, aujourdHui, lots, bibliotheque,
  }), [ouvrages, pointages, tauxFGALaDate, aujourdHui, lots, bibliotheque]);
  const vendus = useMemo(() => ouvrages.filter(o => o?.id && !estOuvrageDiversV2(o)), [ouvrages]);
  const laissees = synthese.taches.filter(t => t.laissee);

  const etat = (l) => {
    const s = sel[l.tache_id] || {};
    return {
      coche: !!s.coche,
      choix: s.choix ?? l.choix,
      cible_id: s.cible_id ?? l.cible?.tache_id ?? null,
      ouvrage_id: s.ouvrage_id ?? l.ouvrageB?.id ?? null,
      heures_normales: s.heures_normales ?? (l.heuresNormales ? l.heuresNormales.heures : ""),
    };
  };
  const changer = (id, patch) => setSel(p => ({ ...p, [id]: { ...(p[id] || {}), ...patch } }));
  const toutCocher = (v) => setSel(p => {
    const n = { ...p };
    lignes.forEach(l => { n[l.tache_id] = { ...(n[l.tache_id] || {}), coche: v }; });
    return n;
  });
  const nbCoches = lignes.filter(l => etat(l).coche).length;

  const appliquerSelection = async () => {
    setMessage(null);
    const selection = lignes.filter(l => etat(l).coche).map(l => ({ tache_id: l.tache_id, premierJour: l.premierJour, ...etat(l) }));
    if (selection.length === 0) return;
    const plan = planClassementMasseV2({ ouvrages, selection, date: aujourdHui, auteur });
    const nomDe = id => lignes.find(l => String(l.tache_id) === String(id))?.nom || id;
    const refus = plan.refusees.map(r => `• « ${nomDe(r.tache_id)} » : ${r.raison}`).join("\n");
    if (plan.etapes.length === 0) { alert(`Aucune tâche cochée n'est applicable :\n${refus}`); return; }
    const texte = `${texteConfirmationMasseV2(plan.compte)} ?`
      + (plan.compte.A ? "\n\nCas A : les heures (pointages) passent sur la tâche existante, la tâche hors devis est retirée du phasage." : "")
      + (plan.compte.B ? "\nCas B : la tâche rejoint l'ouvrage vendu avec ses heures normales ; les heures prévues de l'ouvrage ne changent pas." : "")
      + (plan.compte.C ? "\nCas C : la tâche reste hors devis, « à arbitrer » (décisions attendues du Bilan)." : "")
      + (plan.compte.laisser ? "\nLaissée en l'état : rien ne change, elle n'est plus proposée au classement." : "")
      + (refus ? `\n\nNon applicables (ignorées) :\n${refus}` : "");
    if (!window.confirm(texte)) return;
    setOccupe(true);
    let faites = 0;
    const datesRecalcul = [];
    for (const e of plan.etapes) {
      const ok = await onAppliquer(e.ouvrages, e.pointages ? { pointages: e.pointages } : {});
      if (ok === false) break;
      faites += 1;
      if (e.recalculerDepuis) datesRecalcul.push(e.recalculerDepuis);
    }
    if (datesRecalcul.length && onRecalculer) onRecalculer(datesRecalcul.sort()[0]);
    setOccupe(false);
    setSel({});
    setMessage(faites === plan.etapes.length
      ? `${faites} tâche${faites > 1 ? "s" : ""} classée${faites > 1 ? "s" : ""}.${plan.refusees.length ? ` ${plan.refusees.length} non applicable${plan.refusees.length > 1 ? "s" : ""}, laissée${plan.refusees.length > 1 ? "s" : ""} telle${plan.refusees.length > 1 ? "s" : ""} quelle${plan.refusees.length > 1 ? "s" : ""}.` : ""}`
      : `Arrêt après ${faites} tâche${faites > 1 ? "s" : ""} sur ${plan.etapes.length} : une écriture a échoué, les suivantes n'ont pas été appliquées.`);
  };

  const toutLaisser = async () => {
    const r = laisserToutEnEtatV2(ouvrages, { repris, date: aujourdHui, auteur });
    if (r.erreur || !r.nb) return;
    if (!window.confirm(`Laisser en l'état les ${r.nb} tâches hors devis encore à classer de ce chantier repris ?\n\n`
      + "Leurs heures, leur coût et la production ne changent pas ; elles ne sont plus proposées au classement ni comptées « non classées ». "
      + "La décision est datée et signée, et réversible (« Reprendre le classement »).")) return;
    setOccupe(true);
    const ok = await onAppliquer(r.ouvrages, {});
    setOccupe(false);
    if (ok !== false) { setSel({}); setMessage(`${r.nb} tâche${r.nb > 1 ? "s" : ""} laissée${r.nb > 1 ? "s" : ""} en l'état.`); }
  };
  const reprendre = async () => {
    if (!window.confirm(`Remettre les ${laissees.length} tâche${laissees.length > 1 ? "s" : ""} laissée${laissees.length > 1 ? "s" : ""} en l'état dans la liste à classer ?`)) return;
    setOccupe(true);
    const ok = await onAppliquer(reprendreClassementV2(ouvrages, laissees.map(t => t.tache_id)).ouvrages, {});
    setOccupe(false);
    if (ok !== false) setMessage("Classement repris : ces tâches sont de nouveau proposées.");
  };

  const bouton = (actif, couleur = "#2563eb") => ({
    padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: occupe ? "wait" : "pointer",
    border: `1px solid ${actif ? couleur : T.border}`, background: actif ? `${couleur}1f` : "transparent", color: actif ? couleur : T.text,
  });
  const champ = { padding: "4px 6px", fontSize: 12, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface || T.card, color: T.text, fontFamily: "inherit", maxWidth: "100%" };
  const libCas = l => (l.cas ? `cas ${l.cas}` : "tâche standard");
  const dernierLaisse = laissees.map(t => t.laissee).sort((a, b) => String(b.le || "").localeCompare(String(a.le || "")))[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
        Chaque tâche encore à classer avec le cas proposé et pourquoi. Rien n'est appliqué sans case cochée et sans « Appliquer la sélection » ;
        un récapitulatif est demandé avant d'écrire. Les opérations sont exactement celles de « Classer » (une par une).
        Confiance : <strong>élevée</strong> = nom identique ou cas déjà déclaré ; <strong>moyenne</strong> = tâche proposée qui reprend tous les mots,
        tâche standard, ou déjà dans un ouvrage vendu ; <strong>faible</strong> = à vérifier (un mot manque, deux tâches ressemblent autant, ou C « à examiner » faute de tâche ressemblante).
      </div>

      {repris && (
        <div style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5 }}>
            <strong>Chantier repris</strong>{repris.le ? ` (coché le ${fmtJour(repris.le)})` : ""} : vous pouvez laisser toutes ses tâches hors devis anciennes telles quelles.
          </span>
          {lignes.length > 0 && (
            <button type="button" disabled={occupe} style={{ ...bouton(true, "#6b7280"), marginLeft: "auto" }} onClick={toutLaisser}>
              Tout laisser en l'état ({lignes.length})
            </button>
          )}
        </div>
      )}
      {laissees.length > 0 && (
        <div style={{ fontSize: 12, color: T.textSub, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {laissees.length} tâche{laissees.length > 1 ? "s" : ""} laissée{laissees.length > 1 ? "s" : ""} en l'état
          ({fmtH(synthese.laissees.heures)}, {fmtEur(synthese.laissees.cout)}){dernierLaisse?.le ? ` — dernière décision le ${fmtJour(dernierLaisse.le)}` : ""}{dernierLaisse?.par ? ` par ${dernierLaisse.par}` : ""}.
          <button type="button" disabled={occupe} style={bouton(false)} onClick={reprendre}>Reprendre le classement</button>
        </div>
      )}

      {lignes.length === 0 ? (
        <div style={{ fontSize: 13, color: T.textSub }}>Aucune tâche hors devis à classer sur ce chantier.</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 0, background: T.surface || T.card, padding: "6px 0", zIndex: 1 }}>
            <button type="button" disabled={occupe} style={bouton(false)} onClick={() => toutCocher(true)}>Tout cocher</button>
            <button type="button" disabled={occupe} style={bouton(false)} onClick={() => toutCocher(false)}>Tout décocher</button>
            <span style={{ fontSize: 12, color: T.textSub }}>{nbCoches} / {lignes.length} cochée{nbCoches > 1 ? "s" : ""}</span>
            <button type="button" disabled={occupe || nbCoches === 0} style={{ ...bouton(nbCoches > 0), marginLeft: "auto", opacity: nbCoches === 0 ? 0.5 : 1 }}
              onClick={appliquerSelection}>
              {occupe ? "Application…" : "Appliquer la sélection"}
            </button>
          </div>
          {message && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>{message}</div>}
          {lignes.map(l => {
            const e = etat(l);
            const refus = refusLigneMasseV2(ouvrages, l.tache_id, e);
            const c = COULEUR_CONFIANCE[l.confiance];
            return (
              <div key={l.tache_id} style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${e.coche ? "#2563eb" : T.border}` }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <input type="checkbox" checked={e.coche} disabled={occupe} onChange={ev => changer(l.tache_id, { coche: ev.target.checked })}/>
                  <strong style={{ fontSize: 13 }}>{l.nom || "(sans nom)"}</strong>
                  <span style={{ fontSize: 11.5, color: T.textSub }}>{l.chemin}</span>
                  <span style={{ fontSize: 12, marginLeft: "auto" }}>{fmtH(l.heures)} · {fmtEur(l.cout)}</span>
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                  <span style={{ padding: "1px 7px", borderRadius: 999, border: `1px solid ${c}`, color: c, fontWeight: 700 }}>
                    Proposé : {libCas(l)} · confiance {libelleConfiance(l.confiance).toLowerCase()}
                  </span>
                  <span style={{ color: T.textSub }}>{majuscule(l.explication)}</span>
                </div>
                <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={e.choix} disabled={occupe} style={champ} onChange={ev => changer(l.tache_id, { choix: ev.target.value })}>
                    {CHOIX_MASSE_V2.map(ch => <option key={ch.code} value={ch.code}>{ch.label}</option>)}
                  </select>
                  {e.choix === "A" && (
                    <select value={e.cible_id || ""} disabled={occupe} style={{ ...champ, minWidth: 260 }} onChange={ev => changer(l.tache_id, { cible_id: ev.target.value || null })}>
                      {!e.cible_id && <option value="">Tâche existante…</option>}
                      {l.candidats.map(cd => <option key={cd.tache_id} value={cd.tache_id}>{cd.nom} — {cd.chemin}</option>)}
                    </select>
                  )}
                  {e.choix === "B" && (
                    <>
                      <select value={e.ouvrage_id || ""} disabled={occupe} style={{ ...champ, minWidth: 240 }} onChange={ev => changer(l.tache_id, { ouvrage_id: ev.target.value || null })}>
                        {!e.ouvrage_id && <option value="">Ouvrage vendu…</option>}
                        {vendus.map(o => <option key={o.id} value={o.id}>{cheminOuvrageV2(o, lots)}</option>)}
                      </select>
                      <input type="number" min="0" step="0.25" placeholder="Heures normales" value={e.heures_normales ?? ""} disabled={occupe}
                        style={{ ...champ, width: 120, textAlign: "right" }} onChange={ev => changer(l.tache_id, { heures_normales: ev.target.value })}/>
                      {l.heuresNormales && <span style={{ fontSize: 11, color: T.textSub }}>Bibliothèque : {l.heuresNormales.detail}</span>}
                    </>
                  )}
                </div>
                {refus && <div style={{ fontSize: 11.5, color: "#e05c5c", fontWeight: 700, marginTop: 4 }}>Non applicable : {refus}</div>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
