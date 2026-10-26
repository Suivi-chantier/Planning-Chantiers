// ─────────────────────────────────────────────────────────────────────────────
// Commandes › « Lignes sans lot » : poser le lot en masse (CR-6, partie 6D).
//
// Les lignes de commande rattachées à un chantier sans lot (même règle que la
// saisie : lignesChantierSansLot), avec le lot proposé, son explication et
// le niveau de confiance (lotsCommandesV1.mjs). Rien n'est coché au départ ;
// le lot se change ligne par ligne ; « Appliquer la sélection » montre un
// récapitulatif puis écrit le lot des seules lignes cochées, comme la saisie
// d'un lot sur la page (commande_lignes.lot_id). Ensuite, pour chaque
// chantier touché, le relevé journalier est recalculé par le mécanisme
// existant (demanderRecalculReleve) depuis la plus ancienne date d'achat
// changée : le lot change le reste à commander par lot et les matériaux
// imputés (marge à l'avancement).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { lireToutParTranches } from "./lectureParTranches";
import { demanderRecalculReleve } from "./relevesJournaliersApi";
import {
  propositionsLotsSansLotV1, planAffectationLotsV1, texteConfirmationLotsV1, libelleConfiance, NIVEAUX_CONFIANCE,
} from "./lotsCommandesV1";

const fmtEur = e => `${(Math.round((e || 0) * 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtJour = d => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const COULEUR_CONFIANCE = { eleve: "#16a34a", moyen: "#d18a16", faible: "#e05c5c", aucune: "#888888" };

/**
 * @param {object} props
 * @param {Array}    props.lignes     lignes de la page Commandes (toutes, avec et sans lot)
 * @param {Array}    props.chantiers  [{ id, nom }]
 * @param {Array}    props.lots       [{ id, label }]
 * @param {Function} props.onApplique rechargement de la page après écriture
 */
export default function LotsSansLotCommandes({ T, lignes = [], chantiers = [], lots = [], onApplique, onClose }) {
  const [phasages, setPhasages] = useState(null);     // { chantierId: ouvrages } ; null = en chargement
  const [erreurChargement, setErreurChargement] = useState(null);
  const [sel, setSel] = useState({});                 // id → { coche, lot_id }
  const [filtreChantier, setFiltreChantier] = useState("all");
  const [filtreConfiance, setFiltreConfiance] = useState("all");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);

  // Ouvrages du phasage de chaque chantier (un phasage par chantier : le plus
  // récemment modifié, même règle que les relevés).
  useEffect(() => {
    let annule = false;
    (async () => {
      const { data, error } = await lireToutParTranches((a, b) => supabase.from("phasages")
        .select("id, chantier_id, ouvrages, updated_at").order("id", { ascending: true }).range(a, b));
      if (annule) return;
      if (error) { setErreurChargement(error.message || String(error)); setPhasages({}); return; }
      const plus = {};
      (data || []).forEach(p => {
        if (!p.chantier_id) return;
        const c = plus[p.chantier_id];
        if (!c || String(p.updated_at || "") > String(c.updated_at || "")) plus[p.chantier_id] = p;
      });
      const out = {};
      Object.values(plus).forEach(p => { out[p.chantier_id] = Array.isArray(p.ouvrages) ? p.ouvrages : []; });
      setPhasages(out);
    })();
    return () => { annule = true; };
  }, []);

  const { lignes: props, resume } = useMemo(() => (phasages
    ? propositionsLotsSansLotV1({ lignes, phasages, lots })
    : { lignes: [], resume: null }), [lignes, phasages, lots]);
  const nomChantier = id => chantiers.find(c => String(c.id) === String(id))?.nom || id;
  const visibles = props.filter(p => (filtreChantier === "all" || p.chantier_id === filtreChantier)
    && (filtreConfiance === "all" || p.proposition.confiance === filtreConfiance));
  const etat = p => ({ coche: !!sel[p.id]?.coche, lot_id: sel[p.id]?.lot_id ?? (p.proposition.lotId || "") });
  const changer = (id, patch) => setSel(s => ({ ...s, [id]: { ...(s[id] || {}), ...patch } }));
  const cocher = v => setSel(s => { const n = { ...s }; visibles.forEach(p => { n[p.id] = { ...(n[p.id] || {}), coche: v }; }); return n; });
  const nbCoches = props.filter(p => etat(p).coche).length;
  const chantiersAvec = [...new Set(props.map(p => p.chantier_id))].sort((a, b) => String(nomChantier(a)).localeCompare(String(nomChantier(b)), "fr"));

  const appliquer = async () => {
    setMessage(null);
    const selection = props.filter(p => etat(p).coche).map(p => ({ id: p.id, lot_id: etat(p).lot_id }));
    if (selection.length === 0) return;
    const plan = planAffectationLotsV1({ propositions: props, selection, lots });
    const refus = plan.refusees.map(r => {
      const p = props.find(x => x.id === r.id);
      return `• ${p ? `${nomChantier(p.chantier_id)} — « ${p.libelle || "(sans libellé)"} »` : r.id} : ${r.raison}`;
    }).join("\n");
    if (plan.updates.length === 0) { alert(`Aucune ligne cochée n'est applicable :\n${refus}`); return; }
    const manuels = plan.updates.filter(u => u.manuel).length;
    if (!window.confirm(`${texteConfirmationLotsV1(plan, lots)} ?`
      + (manuels ? `\n\n${manuels} ligne${manuels > 1 ? "s" : ""} avec un lot choisi à la main.` : "")
      + "\n\nLe reste à commander par lot et les matériaux imputés (marge à l'avancement) des chantiers concernés seront recalculés."
      + (refus ? `\n\nNon applicables (ignorées) :\n${refus}` : ""))) return;
    setOccupe(true);
    let ecrites = 0;
    const echecs = [];
    const lotsEcrits = new Set();
    for (const [lot_id, ids] of Object.entries(plan.parLot)) {
      // .select : compte les lignes réellement écrites (une écriture refusée
      // par les droits ne renvoie pas d'erreur, seulement zéro ligne).
      const { data, error } = await supabase.from("commande_lignes").update({ lot_id }).in("id", ids).select("id");
      const label = lots.find(l => l.id === lot_id)?.label || lot_id;
      if (error) echecs.push(`${label} : ${error.message}`);
      else {
        const n = (data || []).length;
        ecrites += n;
        if (n > 0) lotsEcrits.add(lot_id);
        if (n < ids.length) echecs.push(`${label} : ${ids.length - n} ligne${ids.length - n > 1 ? "s" : ""} non modifiée${ids.length - n > 1 ? "s" : ""}`);
      }
    }
    // Relevés journaliers : recalcul par le mécanisme existant, pour chaque
    // chantier touché, depuis la plus ancienne date d'achat changée.
    const chantiersEcrits = new Set(plan.updates.filter(u => lotsEcrits.has(u.lot_id)).map(u => u.chantier_id));
    plan.recalculs.filter(r => chantiersEcrits.has(r.chantierId)).forEach(r => demanderRecalculReleve({ chantierId: r.chantierId, date: r.date }));
    setOccupe(false);
    setSel({});
    setMessage(echecs.length
      ? `${ecrites} ligne${ecrites > 1 ? "s" : ""} rattachée${ecrites > 1 ? "s" : ""} ; échec pour : ${echecs.join(" ; ")}`
      : `${ecrites} ligne${ecrites > 1 ? "s" : ""} rattachée${ecrites > 1 ? "s" : ""} à un lot.`);
    if (onApplique) onApplique();
  };

  const bouton = (actif, couleur = "#2563eb") => ({
    padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, fontFamily: "inherit", cursor: occupe ? "wait" : "pointer",
    border: `1px solid ${actif ? couleur : T.border}`, background: actif ? `${couleur}1f` : "transparent", color: actif ? couleur : T.text,
  });
  const champ = { padding: "4px 6px", fontSize: 12, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface || T.card, color: T.text, fontFamily: "inherit" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface || T.card, color: T.text, borderRadius: 12, width: "100%", maxWidth: 1100, maxHeight: "92vh", overflow: "auto", border: `1px solid ${T.border}` }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Lignes de commande sans lot</div>
          <button type="button" onClick={onClose} style={{ ...bouton(false), border: "none" }}>Fermer</button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.5 }}>
            Sans lot, les matériaux d'une ligne ne sont déduits d'aucune enveloppe : le reste à commander par lot est faux, et ils sont imputés tout de suite
            à la marge à l'avancement. Le lot proposé vient, dans l'ordre : de l'ouvrage rattaché, du matériau (prévu dans le phasage ou déjà commandé sur un lot),
            des autres lignes du même bon, du libellé, du fournisseur, puis de l'historique du chantier. Confiance <strong>élevée</strong> : ouvrage ou matériau
            de ce chantier ; <strong>moyenne</strong> : même bon, même libellé ou même matériau ailleurs, avec un avis net ; <strong>faible</strong> : indice plus
            léger (fournisseur, historique, libellé proche) ou contredit ; <strong>aucune</strong> : aucun lot n'est proposé. Rien n'est écrit sans case cochée,
            sans « Appliquer la sélection » et sans confirmation.
          </div>
          {phasages == null ? (
            <div style={{ fontSize: 13, color: T.textSub }}>Chargement des phasages…</div>
          ) : (
            <>
              {erreurChargement && <div style={{ fontSize: 12, color: "#e05c5c" }}>Phasages non lus ({erreurChargement}) : les propositions par ouvrage et par matériau prévu sont indisponibles.</div>}
              {resume && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[{ code: "total", label: "Sans lot" }, ...NIVEAUX_CONFIANCE].map(n => (
                    <div key={n.code} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`, minWidth: 120 }}>
                      <div style={{ fontSize: 11, color: n.code === "total" ? T.textSub : COULEUR_CONFIANCE[n.code] }}>{n.code === "total" ? n.label : `Confiance ${n.label.toLowerCase()}`}</div>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{resume[n.code].nb}</div>
                      <div style={{ fontSize: 11, color: T.textSub }}>{fmtEur(resume[n.code].montant)}</div>
                    </div>
                  ))}
                </div>
              )}
              {props.length === 0 ? (
                <div style={{ fontSize: 13, color: T.textSub }}>Aucune ligne de commande rattachée à un chantier sans lot.</div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", position: "sticky", top: 0, background: T.surface || T.card, padding: "6px 0", zIndex: 1 }}>
                    <select value={filtreChantier} style={champ} onChange={e => setFiltreChantier(e.target.value)}>
                      <option value="all">Tous les chantiers ({props.length})</option>
                      {chantiersAvec.map(id => <option key={id} value={id}>{nomChantier(id)} ({props.filter(p => p.chantier_id === id).length})</option>)}
                    </select>
                    <select value={filtreConfiance} style={champ} onChange={e => setFiltreConfiance(e.target.value)}>
                      <option value="all">Toutes les confiances</option>
                      {NIVEAUX_CONFIANCE.map(n => <option key={n.code} value={n.code}>{n.code === "aucune" ? n.label : `Confiance ${n.label.toLowerCase()}`}</option>)}
                    </select>
                    <button type="button" disabled={occupe} style={bouton(false)} onClick={() => cocher(true)}>Tout cocher</button>
                    <button type="button" disabled={occupe} style={bouton(false)} onClick={() => cocher(false)}>Tout décocher</button>
                    <span style={{ fontSize: 12, color: T.textSub }}>{nbCoches} cochée{nbCoches > 1 ? "s" : ""}</span>
                    <button type="button" disabled={occupe || nbCoches === 0} style={{ ...bouton(nbCoches > 0), marginLeft: "auto", opacity: nbCoches === 0 ? 0.5 : 1 }} onClick={appliquer}>
                      {occupe ? "Écriture…" : "Appliquer la sélection"}
                    </button>
                  </div>
                  {message && <div style={{ fontSize: 12.5, fontWeight: 700, color: message.includes("échec") ? "#e05c5c" : "#16a34a" }}>{message}</div>}
                  {visibles.map(p => {
                    const e = etat(p);
                    const c = COULEUR_CONFIANCE[p.proposition.confiance];
                    const modifie = e.lot_id && e.lot_id !== (p.proposition.lotId || "");
                    return (
                      <div key={p.id} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${e.coche ? "#2563eb" : T.border}` }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 }}>
                          <input type="checkbox" checked={e.coche} disabled={occupe} onChange={ev => changer(p.id, { coche: ev.target.checked })}/>
                          <strong>{p.libelle || "(sans libellé)"}</strong>
                          <span style={{ color: T.textSub }}>{nomChantier(p.chantier_id)} · {p.fournisseur || "fournisseur ?"}{p.date ? ` · ${fmtJour(p.date)}` : ""}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtEur(p.montant)}</span>
                          <select value={e.lot_id} disabled={occupe} style={{ ...champ, borderColor: modifie ? "#2563eb" : T.border }} onChange={ev => changer(p.id, { lot_id: ev.target.value })}>
                            <option value="">Lot…</option>
                            {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                          </select>
                        </div>
                        <div style={{ fontSize: 11.5, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                          <span style={{ padding: "1px 7px", borderRadius: 999, border: `1px solid ${c}`, color: c, fontWeight: 700 }}>
                            {p.proposition.lotId ? `Proposé : ${p.proposition.lotLabel} · confiance ${libelleConfiance(p.proposition.confiance).toLowerCase()}` : "Aucune proposition"}
                          </span>
                          <span style={{ color: T.textSub }}>{p.proposition.explication}</span>
                          {modifie && <span style={{ color: "#2563eb", fontWeight: 700 }}>lot choisi à la main</span>}
                          {e.coche && !e.lot_id && <span style={{ color: "#e05c5c", fontWeight: 700 }}>Non applicable : lot à choisir</span>}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
