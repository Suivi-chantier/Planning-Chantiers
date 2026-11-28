import React, { useState, useMemo } from "react";
import { FONT, RADIUS, SPACING, SEMANTIC, guessLotId } from "../constants";
import { Icon } from "../ui";
import { Loader2, Check, X, AlertTriangle, Split, Trash2, Plus } from "lucide-react";
import { NATURES_COUT, lignesChantierSansLot, messageLotObligatoire, natureSaisie } from "./saisieLotNature.js";
import { preparerLignesBl, diviserLigne } from "./saisieBlFacture.js";

// Fenêtre commune à « Saisir ce BL depuis la facture » (Rapprochement factures)
// et « Compléter avec le PDF du BL » (fiche d'une commande). Mêmes possibilités
// que la saisie classique : lignes modifiables, chantier commun OU réparti
// ligne par ligne, division d'une ligne sur deux chantiers, lot (obligatoire
// dès qu'un chantier est choisi) et nature par ligne. Le total est recontrôlé
// en direct contre le montant du BL. Rien n'est écrit ici : onConfirmer reçoit
// les lignes finales, chantier résolu.
const fmt = (n) => (n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const dateFr = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR") : "—");
const txt = (v) => (v == null ? "" : String(v));

export default function ConfirmationLignesBl({
  titre, etat, erreur, lecture, controle, montantBl, toleranceHt = 0.05, chantiers = [], propositions, lots = [],
  alertes = [], libelleValider = "Créer la commande", T, acc, onConfirmer, onAnnuler, enregistrement,
}) {
  const [chantierCommun, setChantierCommun] = useState(propositions?.propose || "");
  const [repartir, setRepartir] = useState(false);
  const [erreurLot, setErreurLot] = useState("");
  const [lignes, setLignes] = useState(() => (controle?.lignes || []).map(l => {
    const g = guessLotId(l.libelle || "");
    return {
      ...l, quantite: txt(l.quantite), prix_unitaire: txt(l.prix_unitaire), prix_total: txt(l.prix_total),
      chantier_id: "", lot_id: g && lots.some(x => x.id === g) ? g : "", nature: "materiaux",
    };
  }));
  const setLigne = (i, patch) => setLignes(prev => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const diviser = (i) => { setLignes(prev => { const n = [...prev]; n.splice(i, 1, ...diviserLigne(prev[i])); return n; }); setRepartir(true); };
  const supprimer = (i) => setLignes(prev => prev.filter((_, j) => j !== i));
  const ajouter = () => setLignes(prev => [...prev, { reference: "", libelle: "", quantite: "", unite: "U", prix_unitaire: "", prix_total: "", chantier_id: "", lot_id: "", nature: "materiaux" }]);

  const chantierDe = (l) => (repartir ? l.chantier_id : chantierCommun) || null;
  const verif = useMemo(() => preparerLignesBl(lignes, montantBl, toleranceHt), [lignes, montantBl, toleranceHt]);
  const candidats = (propositions?.candidats || []).map(id => chantiers.find(c => String(c.id) === String(id))).filter(Boolean);

  const valider = () => {
    const sansLot = lignesChantierSansLot(lignes, chantierDe);
    if (sansLot.length) { setErreurLot(messageLotObligatoire(sansLot.length)); return; }
    setErreurLot("");
    const num = (v) => preparerLignesBl([{ libelle: "x", quantite: v, prix_total: 0 }], null).lignes[0]?.quantite ?? null;
    const prix = (v) => preparerLignesBl([{ libelle: "x", prix_total: v }], null).lignes[0]?.prix_total ?? null;
    onConfirmer(lignes
      .filter(l => l.libelle || l.reference || l.prix_total !== "")
      .map(l => ({
        reference: l.reference || null, libelle: l.libelle || "Article", unite: l.unite || "U",
        quantite: num(l.quantite), prix_unitaire: prix(l.prix_unitaire), prix_total: prix(l.prix_total),
        chantier_id: chantierDe(l), lot_id: l.lot_id || null, nature: natureSaisie(l.nature),
      })));
  };

  const inp = { width: "100%", boxSizing: "border-box", padding: "9px 10px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, outline: "none" };
  const carte = { background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: 10, marginBottom: 8 };
  const btnIcone = (couleurs) => ({ background: couleurs.bg, border: `1px solid ${couleurs.border}`, borderRadius: RADIUS.md, width: 40, flexShrink: 0, color: couleurs.color, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" });
  const info = (k, v) => <div><div style={{ fontSize: FONT.xs.size, color: T.textSub, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 600 }}>{v || "—"}</div></div>;
  const pret = etat === "verif" && !!lecture;

  return (
    <>
      <div onClick={enregistrement ? undefined : onAnnuler} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1101, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto", background: T.surface, width: "100%", maxWidth: 720, maxHeight: "94vh", borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>{titre}</div>
            <button onClick={onAnnuler} disabled={enregistrement} aria-label="Fermer" style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: T.text, cursor: "pointer" }}>
              <Icon as={X} size={18} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
            {etat === "lecture" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: T.textSub, fontSize: FONT.sm.size }}>
                <Icon as={Loader2} size={18} className="spin" /> Lecture du détail du BL…
              </div>
            )}
            {erreur && (
              <div style={{ background: SEMANTIC.danger.bg, border: `1px solid ${SEMANTIC.danger.border}`, color: SEMANTIC.danger.color, borderRadius: RADIUS.md, padding: "10px 12px", fontSize: FONT.sm.size, marginBottom: SPACING.md }}>{erreur}</div>
            )}

            {pret && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: SPACING.md }}>
                  {info("BL n°", lecture.bl_numero)}
                  {info("Date du BL", dateFr(lecture.date_bl))}
                  {info("N° commande fournisseur", lecture.commande_numero)}
                  {info("Référence client", lecture.reference_client)}
                </div>

                {alertes.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, background: SEMANTIC.warning.bg, border: `1px solid ${SEMANTIC.warning.border}`, color: SEMANTIC.warning.color, borderRadius: RADIUS.md, padding: "10px 12px", fontSize: FONT.sm.size, marginBottom: SPACING.sm }}>
                    <Icon as={AlertTriangle} size={16} style={{ flexShrink: 0 }} /> <span>{a}</span>
                  </div>
                ))}

                {/* Ventilation chantier — comme la saisie classique */}
                <div style={{ ...carte, padding: 12, marginBottom: SPACING.md }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: repartir ? 0 : 10 }}>
                    <input type="checkbox" checked={repartir} onChange={e => setRepartir(e.target.checked)} style={{ width: 18, height: 18, accentColor: acc.accent }} />
                    <span style={{ fontSize: FONT.base.size, fontWeight: 600, color: T.text }}>Répartir sur plusieurs chantiers</span>
                  </label>
                  {!repartir && (
                    <>
                      {candidats.length > 1 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          <span style={{ fontSize: FONT.xs.size, color: T.textSub, width: "100%" }}>Correspondent à « {lecture.reference_client} » :</span>
                          {candidats.map(c => {
                            const actif = String(chantierCommun) === String(c.id);
                            return <button key={c.id} onClick={() => setChantierCommun(c.id)} style={{ padding: "5px 10px", borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, border: `1px solid ${actif ? acc.accent : T.border}`, background: actif ? acc.bg10 : "transparent", color: actif ? acc.accent : T.text }}>{c.nom}</button>;
                          })}
                        </div>
                      )}
                      {propositions?.propose && String(chantierCommun) === String(propositions.propose) && (
                        <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginBottom: 6 }}>Proposé d'après la référence client « {lecture.reference_client} » — modifiable.</div>
                      )}
                      <select value={chantierCommun} onChange={e => setChantierCommun(e.target.value)} style={inp}>
                        <option value="">— Chantier (toutes les lignes) —</option>
                        {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom || c.id}</option>)}
                      </select>
                    </>
                  )}
                </div>

                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, textTransform: "uppercase", color: T.textSub, margin: "6px 0" }}>Articles ({lignes.length})</div>
                {lignes.map((l, i) => {
                  const avecChantier = !!chantierDe(l);
                  return (
                    <div key={i} style={carte}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                        <input value={l.libelle} onChange={e => setLigne(i, { libelle: e.target.value })} placeholder="Désignation" style={{ ...inp, flex: 1 }} />
                        <button onClick={() => diviser(i)} title="Diviser pour répartir sur 2 chantiers" style={btnIcone({ bg: acc.bg10, border: acc.border, color: acc.accent })}><Icon as={Split} size={16} /></button>
                        <button onClick={() => supprimer(i)} title="Supprimer la ligne" style={btnIcone({ bg: SEMANTIC.danger.bg, border: SEMANTIC.danger.border, color: SEMANTIC.danger.color })}><Icon as={Trash2} size={16} /></button>
                      </div>
                      {l.reference && <div style={{ fontSize: FONT.xs.size, color: T.textSub, fontFamily: "monospace", marginBottom: 6 }}>{l.reference}</div>}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <input inputMode="decimal" value={l.quantite} onChange={e => setLigne(i, { quantite: e.target.value })} placeholder={`Qté (${l.unite || "U"})`} style={inp} />
                        <input inputMode="decimal" value={l.prix_unitaire} onChange={e => setLigne(i, { prix_unitaire: e.target.value })} placeholder="PU €" style={inp} />
                        <input inputMode="decimal" value={l.prix_total} onChange={e => setLigne(i, { prix_total: e.target.value })} placeholder="Total €" style={inp} />
                      </div>
                      {repartir && (
                        <select value={l.chantier_id} onChange={e => setLigne(i, { chantier_id: e.target.value })} style={{ ...inp, marginBottom: 8 }}>
                          <option value="">— Chantier de cette ligne —</option>
                          {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom || c.id}</option>)}
                        </select>
                      )}
                      {lots.length > 0 && (
                        <select value={l.lot_id} onChange={e => setLigne(i, { lot_id: e.target.value })}
                          style={{ ...inp, marginBottom: 8, borderColor: avecChantier && !l.lot_id ? SEMANTIC.danger.color : T.border }}>
                          <option value="">{avecChantier ? "— Lot (obligatoire) —" : "— Lot —"}</option>
                          {lots.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                        </select>
                      )}
                      <select value={natureSaisie(l.nature)} onChange={e => setLigne(i, { nature: e.target.value })} style={inp}>
                        {NATURES_COUT.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                      </select>
                    </div>
                  );
                })}
                <button onClick={ajouter} style={{ width: "100%", padding: 10, borderRadius: RADIUS.md, cursor: "pointer", border: `1px dashed ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Icon as={Plus} size={16} /> Ajouter une ligne
                </button>

                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0 4px", fontWeight: 800, fontSize: FONT.base.size, color: verif.conforme ? SEMANTIC.success.color : SEMANTIC.warning.color }}>
                  <span>Total des lignes</span><span>{fmt(verif.sommeHt)}</span>
                </div>
                <div style={{ fontSize: FONT.sm.size, color: verif.conforme ? SEMANTIC.success.color : SEMANTIC.warning.color }}>
                  {verif.montantInconnu
                    ? "Montant du BL inconnu : le total des lignes ne peut pas être contrôlé."
                    : verif.conforme
                      ? `Égal au montant du BL (${fmt(montantBl)}).`
                      : `Différent du montant du BL (${fmt(montantBl)}, écart ${fmt(verif.ecartHt)}). Le montant du BL est conservé ; corrige les lignes si besoin.`}
                </div>
              </>
            )}
          </div>

          {erreurLot && <div style={{ padding: "10px 18px 0", fontSize: FONT.sm.size, color: SEMANTIC.danger.color, fontWeight: 600 }}>{erreurLot}</div>}
          <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
            <button onClick={onAnnuler} disabled={enregistrement} style={{ flex: 1, padding: 12, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontWeight: 600, cursor: "pointer" }}>Annuler</button>
            <button onClick={valider} disabled={!pret || enregistrement || !lignes.length}
              style={{ flex: 2, padding: 12, borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent || "#111", fontFamily: "inherit", fontWeight: 800, cursor: !pret || enregistrement ? "not-allowed" : "pointer", opacity: !pret || !lignes.length ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon as={enregistrement ? Loader2 : Check} size={18} className={enregistrement ? "spin" : undefined} />
              {enregistrement ? "Enregistrement…" : libelleValider}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
