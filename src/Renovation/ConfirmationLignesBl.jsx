import React, { useState } from "react";
import { FONT, RADIUS, SPACING, SEMANTIC } from "../constants";
import { Icon } from "../ui";
import { Loader2, Check, X, AlertTriangle } from "lucide-react";

// Fenêtre commune à « Saisir ce BL depuis la facture » (Rapprochement factures)
// et « Compléter avec le PDF du BL » (fiche d'une commande) : montre les lignes
// lues, le contrôle Σ lignes = montant du BL, et fait choisir le chantier
// (proposé à partir de la référence client) et le lot, appliqués à toutes les
// lignes. Rien n'est écrit ici : onConfirmer reçoit { chantierId, lotId }.
const fmt = (n) => (n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const dateFr = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("fr-FR") : "—");

export default function ConfirmationLignesBl({
  titre, etat, erreur, lecture, controle, montantBl, chantiers = [], propositions, lots = [],
  alertes = [], libelleValider = "Créer la commande", T, acc, onConfirmer, onAnnuler, enregistrement,
}) {
  const [chantierId, setChantierId] = useState(propositions?.propose || "");
  const [lotId, setLotId] = useState("");
  const candidats = (propositions?.candidats || []).map(id => chantiers.find(c => String(c.id) === String(id))).filter(Boolean);
  const inp = { width: "100%", boxSizing: "border-box", padding: "9px 10px", background: T.bg, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size };
  const info = (k, v) => <div><div style={{ fontSize: FONT.xs.size, color: T.textSub, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 600 }}>{v || "—"}</div></div>;

  return (
    <>
      <div onClick={enregistrement ? undefined : onAnnuler} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1100 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 1101, display: "flex", alignItems: "flex-end", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ pointerEvents: "auto", background: T.surface, width: "100%", maxWidth: 620, maxHeight: "92vh", borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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

            {etat === "verif" && lecture && (
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

                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, textTransform: "uppercase", color: T.textSub, margin: "6px 0" }}>Articles ({controle.lignes.length})</div>
                {controle.lignes.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.border}`, fontSize: FONT.sm.size }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: T.text, fontWeight: 600 }}>{l.libelle || "—"}</div>
                      <div style={{ color: T.textSub, fontSize: FONT.xs.size }}>
                        {l.reference && <span style={{ fontFamily: "monospace" }}>{l.reference} · </span>}
                        {l.quantite != null ? `${l.quantite} ${l.unite}` : ""}{l.prix_unitaire != null ? ` × ${fmt(l.prix_unitaire)}` : ""}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: T.text, whiteSpace: "nowrap" }}>{fmt(l.prix_total)}</div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontWeight: 800, fontSize: FONT.base.size, color: controle.conforme ? SEMANTIC.success.color : SEMANTIC.warning.color }}>
                  <span>Total des lignes</span><span>{fmt(controle.sommeHt)}</span>
                </div>
                <div style={{ fontSize: FONT.sm.size, color: controle.conforme ? SEMANTIC.success.color : SEMANTIC.warning.color, marginBottom: SPACING.md }}>
                  {controle.montantInconnu
                    ? "Montant du BL inconnu : le total des lignes ne peut pas être contrôlé."
                    : controle.conforme
                      ? `Égal au montant du BL (${fmt(montantBl)}).`
                      : `Différent du montant du BL (${fmt(montantBl)}, écart ${fmt(controle.ecartHt)}). Le montant du BL est conservé ; vérifie les lignes ensuite.`}
                </div>

                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, textTransform: "uppercase", color: T.textSub, marginBottom: 6 }}>Chantier (toutes les lignes)</div>
                {candidats.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    <span style={{ fontSize: FONT.xs.size, color: T.textSub, width: "100%" }}>Correspondent à « {lecture.reference_client} » :</span>
                    {candidats.map(c => (
                      <button key={c.id} onClick={() => setChantierId(c.id)} style={{ padding: "5px 10px", borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, border: `1px solid ${String(chantierId) === String(c.id) ? acc.accent : T.border}`, background: String(chantierId) === String(c.id) ? acc.bg10 : "transparent", color: String(chantierId) === String(c.id) ? acc.accent : T.text }}>{c.nom}</button>
                    ))}
                  </div>
                )}
                {propositions?.propose && String(chantierId) === String(propositions.propose) && (
                  <div style={{ fontSize: FONT.xs.size, color: T.textSub, marginBottom: 6 }}>Proposé d'après la référence client « {lecture.reference_client} » — modifiable.</div>
                )}
                <select value={chantierId} onChange={e => setChantierId(e.target.value)} style={{ ...inp, marginBottom: 8 }}>
                  <option value="">— Chantier à affecter plus tard —</option>
                  {chantiers.map(c => <option key={c.id} value={c.id}>{c.nom || c.id}</option>)}
                </select>
                <select value={lotId} onChange={e => setLotId(e.target.value)} style={inp}>
                  <option value="">— Lot (facultatif) —</option>
                  {lots.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </>
            )}
          </div>

          <div style={{ padding: "12px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 10 }}>
            <button onClick={onAnnuler} disabled={enregistrement} style={{ flex: 1, padding: 12, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontWeight: 600, cursor: "pointer" }}>Annuler</button>
            <button onClick={() => onConfirmer({ chantierId: chantierId || null, lotId: lotId || null })} disabled={etat !== "verif" || enregistrement || !controle?.lignes.length}
              style={{ flex: 2, padding: 12, borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent || "#111", fontFamily: "inherit", fontWeight: 800, cursor: etat !== "verif" || enregistrement ? "not-allowed" : "pointer", opacity: etat !== "verif" || !controle?.lignes.length ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Icon as={enregistrement ? Loader2 : Check} size={18} className={enregistrement ? "spin" : undefined} />
              {enregistrement ? "Enregistrement…" : libelleValider}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
