// src/Renovation/ProgbatApercuDevis.jsx — Chiffrage → « Aperçu ProGBat »
// Fenêtre d'APERÇU du futur payload de création d'un devis ProGBat
// (POST /v2/company/quotes). Aucun envoi : le seul appel réseau est la lecture
// des taux de TVA via l'Edge Function `progbat-tax-rates` (GET /company/taxes
// côté serveur ; la session Supabase est transmise par supabase.functions.invoke,
// aucun jeton ni en-tête n'est manipulé ici). Le JSON affiché est le payload
// métier seul : jamais de secret, de jeton ni d'en-tête d'authentification.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { X, AlertTriangle, Check, Layers, Home, UserCircle, MapPin, FileText, Receipt, RefreshCw, Code2, Copy } from "lucide-react";
import { construirePayloadDevisProGBat, formaterPct, ENDPOINT_CREATION_DEVIS, ENDPOINT_TAUX_TVA } from "./progbatQuotePayload.mjs";

const fmtEur = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtQte = (q) => q == null ? "—" : Number(q).toLocaleString("fr-FR", { maximumFractionDigits: 4 });
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return a && m && j ? `${j}/${m}/${a}` : String(iso);
};

export default function ProgbatApercuDevis({ T, acc, projet, lignes, lotsOrdre, onClose }) {
  const [taxes, setTaxes] = useState(null);           // null = non chargés
  const [chargement, setChargement] = useState(true);
  const [erreurTaxes, setErreurTaxes] = useState(null);
  const [jsonOuvert, setJsonOuvert] = useState(false);
  const [copie, setCopie] = useState(false);

  const chargerTaxes = async () => {
    setChargement(true); setErreurTaxes(null);
    try {
      const { data, error } = await supabase.functions.invoke("progbat-tax-rates");
      if (error && !data) {
        let body = null;
        try { body = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
        setErreurTaxes(body?.error || error.message || "Lecture des taux de TVA ProGBat impossible.");
        setTaxes(null);
      } else if (data?.ok && Array.isArray(data.taux)) {
        setTaxes(data.taux);
      } else {
        setErreurTaxes(data?.error || "Réponse inattendue de la fonction progbat-tax-rates.");
        setTaxes(null);
      }
    } catch (e) {
      setErreurTaxes(e?.message || "Erreur inattendue.");
      setTaxes(null);
    }
    setChargement(false);
  };
  useEffect(() => { chargerTaxes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const resultat = useMemo(
    () => construirePayloadDevisProGBat({ projet, lignes, lotsOrdre, taxes }),
    [projet, lignes, lotsOrdre, taxes],
  );
  const jsonPayload = useMemo(() => JSON.stringify(resultat.payload, null, 2), [resultat.payload]);

  const copierJson = async () => {
    try { await navigator.clipboard.writeText(jsonPayload); setCopie(true); setTimeout(() => setCopie(false), 1800); } catch { /* presse-papiers indisponible */ }
  };

  const { entete, totaux, compteurs, erreurs, avertissements, apercu, valide } = resultat;
  const bordure = T.sectionDivider || T.border;
  const carte = (titre, icone, contenu) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted, marginBottom: 6 }}>
        <Icon as={icone} size={11} />{titre}
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.text, lineHeight: 1.55 }}>{contenu}</div>
    </div>
  );
  const kpi = (label, valeur, color = T.text) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "8px 12px", flex: "1 1 120px", minWidth: 110 }}>
      <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: .6 }}>{label}</div>
      <div style={{ fontSize: FONT.md?.size || FONT.sm.size + 2, fontWeight: 800, color, marginTop: 2, letterSpacing: -.2 }}>{valeur}</div>
    </div>
  );
  const vide = <span style={{ color: "#e15a5a", fontWeight: 700 }}>manquant</span>;

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }}>
      <div style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, maxWidth: 820, width: "100%", maxHeight: "90vh", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* En-tête */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${bordure}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={FileText} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Aperçu ProGBat{entete.logement.reference ? ` — ${entete.logement.reference}` : ""}</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>{ENDPOINT_CREATION_DEVIS} · un devis = un logement · LOT → ZONE → OUVRAGES</div>
          </div>
          <button onClick={onClose} title="Fermer" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, width: 30, height: 30, cursor: "pointer", color: T.textSub }}>
            <Icon as={X} size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Bandeau lecture seule */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: RADIUS.md, background: "rgba(77,184,255,0.10)", border: "1px solid rgba(77,184,255,0.35)", color: T.text, fontSize: FONT.xs.size + 1, fontWeight: 700 }}>
            <Icon as={AlertTriangle} size={13} style={{ color: "#4db8ff", flexShrink: 0 }} />
            Aperçu uniquement — rien n’est envoyé à ProGBat.
          </div>

          {/* Statut */}
          <div style={{ padding: "10px 14px", borderRadius: RADIUS.lg, background: valide ? "rgba(34,197,94,0.08)" : "rgba(225,90,90,0.07)", border: `1px solid ${valide ? "rgba(34,197,94,0.35)" : "rgba(225,90,90,0.35)"}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, fontWeight: 800, color: valide ? "#22c55e" : "#e15a5a" }}>
              <Icon as={valide ? Check : X} size={14} />
              {chargement ? "Lecture des taux de TVA ProGBat…" : valide ? "Payload valide : prêt pour un futur envoi (non disponible dans cette phase)" : `Payload invalide : ${erreurs.length} point${erreurs.length > 1 ? "s" : ""} bloquant${erreurs.length > 1 ? "s" : ""}`}
            </div>
            {erreurs.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                {erreurs.map((e, i) => <div key={i} style={{ fontSize: FONT.xs.size + 1, color: "#e15a5a", display: "flex", gap: 6, alignItems: "flex-start" }}><Icon as={X} size={11} style={{ marginTop: 2, flexShrink: 0 }} />{e.message}</div>)}
              </div>
            )}
            {avertissements.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
                {avertissements.map((a, i) => <div key={i} style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", display: "flex", gap: 6, alignItems: "flex-start" }}><Icon as={AlertTriangle} size={11} style={{ marginTop: 2, flexShrink: 0 }} />{a}</div>)}
              </div>
            )}
          </div>

          {/* Logement / client / chantier / devis */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
            {carte("Logement", Home, <>
              <div><strong>{entete.logement.reference || vide}</strong>{entete.logement.type ? ` · ${entete.logement.type}` : ""}</div>
              {entete.yardLabel && <div style={{ color: T.textSub }}>yardLabel : {entete.yardLabel}</div>}
            </>)}
            {carte("Client", UserCircle, <>
              <div><strong>{entete.client.affichage || vide}</strong> <span style={{ color: T.textMuted }}>· {entete.client.type}</span></div>
              {entete.thirdId != null
                ? <div style={{ color: T.textSub }}>Client ProGBat existant · thirdId {entete.thirdId}</div>
                : <div style={{ color: T.textSub }}>Facturation : {entete.adresse_client || vide}</div>}
            </>)}
            {carte("Chantier", MapPin, <>
              <div>{entete.adresse_chantier || vide}</div>
              {entete.businessLabel && <div style={{ color: T.textSub }}>businessLabel : {entete.businessLabel}</div>}
            </>)}
            {carte("Devis", Receipt, <>
              <div>Objet : <strong>{entete.objet || vide}</strong></div>
              <div>Validité : {entete.validite ? fmtDate(entete.validite) : vide}</div>
              <div>TVA par défaut : {entete.tva_pct != null ? formaterPct(entete.tva_pct) : vide}{entete.taxRateId != null ? <span style={{ color: T.textMuted }}> · taxRateId {entete.taxRateId}</span> : null}</div>
              {resultat.payload.clientOrderNumber && <div>N° commande client : {resultat.payload.clientOrderNumber}</div>}
            </>)}
          </div>

          {/* Taux de TVA ProGBat */}
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted }}>
                <Icon as={Receipt} size={11} />Taux de TVA ProGBat <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>({ENDPOINT_TAUX_TVA}, lecture seule)</span>
              </div>
              <span style={{ flex: 1 }} />
              <button onClick={chargerTaxes} disabled={chargement} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: chargement ? "not-allowed" : "pointer" }}>
                <Icon as={RefreshCw} size={10} style={chargement ? { animation: "spin 1s linear infinite" } : undefined} />{chargement ? "Lecture…" : "Recharger"}
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: T.text }}>
              {erreurTaxes
                ? <span style={{ color: "#e15a5a", fontWeight: 700 }}>{erreurTaxes}</span>
                : chargement
                  ? <span style={{ color: T.textMuted }}>Lecture en cours…</span>
                  : (taxes || []).length === 0
                    ? <span style={{ color: "#e15a5a", fontWeight: 700 }}>Aucun taux renvoyé par ProGBat.</span>
                    : <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {taxes.map(t => (
                          <span key={t.id} style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${T.border}`, background: t.saleDefault ? acc.bg10 : "transparent", color: T.text, fontWeight: 700 }}>
                            {formaterPct(t.rate)} <span style={{ color: T.textMuted, fontWeight: 500 }}>→ id {t.id}{t.saleDefault ? " · défaut vente" : ""}</span>
                          </span>
                        ))}
                      </div>}
            </div>
          </div>

          {/* Compteurs & totaux */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {kpi("Lots", compteurs.lots)}
            {kpi("Zones", compteurs.zones)}
            {kpi("Ouvrages", compteurs.lignes, compteurs.lignes_sans_snapshot ? "#e15a5a" : T.text)}
            {kpi("Total HT", fmtEur(totaux.ht), totaux.ht > 0 ? "#22c55e" : T.textMuted)}
            {kpi("TVA", fmtEur(totaux.tva))}
            {kpi("Total TTC", fmtEur(totaux.ttc))}
          </div>
          <div style={{ fontSize: FONT.xs.size, color: Math.abs(totaux.ecart_ht) >= 0.005 ? "#e15a5a" : T.textMuted }}>
            Total HT Profero : {fmtEur(totaux.ht_profero)} · écart payload/Profero : {fmtEur(totaux.ecart_ht)}
            {Object.keys(totaux.tva_detail || {}).length > 0 && <> · TVA par taux : {Object.entries(totaux.tva_detail).map(([k, v]) => `${formaterPct(k)} → ${fmtEur(v)}`).join(" · ")}</>}
          </div>

          {/* Aperçu hiérarchique */}
          <div>
            <div style={{ fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: T.textMuted, marginBottom: 8 }}>Contenu du devis</div>
            {apercu.length === 0 ? <div style={{ color: T.textMuted, fontStyle: "italic", fontSize: FONT.sm.size }}>Aucun ouvrage dans le devis</div> : apercu.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: g.lot_manquant ? "rgba(225,90,90,0.12)" : acc.bg10, color: g.lot_manquant ? "#e15a5a" : acc.accent, padding: "4px 10px", borderRadius: RADIUS.sm, fontWeight: 700, fontSize: FONT.xs.size + 1, border: `1px solid ${g.lot_manquant ? "#e15a5a55" : acc.accent + "33"}`, textTransform: "uppercase" }}>
                    <Icon as={Layers} size={11} />LOT {g.lot}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textSub }}>{fmtEur(g.total_ht)}</span>
                </div>
                {g.zones.map((z, zi) => (
                  <div key={zi} style={{ marginLeft: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 800, color: z.zone_manquante ? "#e15a5a" : T.textSub, textTransform: "uppercase", letterSpacing: .5, padding: "2px 0 4px", display: "flex", gap: 6, alignItems: "center" }}>
                      ZONE {z.zone}{z.zone_manquante && <Icon as={AlertTriangle} size={11} />}<span style={{ flex: 1 }} /><span style={{ fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>{fmtEur(z.total_ht)}</span>
                    </div>
                    {z.lignes.map((l, li) => (
                      <div key={l.ligne_id ?? li} style={{ display: "flex", gap: 8, padding: "5px 12px", fontSize: FONT.sm.size, color: T.text, borderLeft: `2px solid ${l.erreurs.length ? "#e15a5a" : T.border}`, marginBottom: 4, alignItems: "baseline" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {l.code ? <strong style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", marginRight: 6 }}>{l.code}</strong> : <span style={{ color: "#e15a5a", fontWeight: 700, marginRight: 6 }}>sans code</span>}
                          {l.libelle || <span style={{ color: "#e15a5a" }}>sans libellé</span>}
                          {!l.snapshot && <span style={{ marginLeft: 6, color: "#e15a5a", fontSize: FONT.xs.size, fontWeight: 700 }}>· sans snapshot</span>}
                        </span>
                        <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>{fmtQte(l.quantite)} {l.unite || "?"} × {fmtEur(l.prix_unitaire_ht)}</span>
                        <span style={{ color: T.textMuted, whiteSpace: "nowrap", fontSize: FONT.xs.size }}>{l.tva_pct != null ? formaterPct(l.tva_pct) : "TVA ?"}{l.taxRateId != null ? ` · id ${l.taxRateId}` : ""}</span>
                        <span style={{ fontWeight: 800, color: l.total_ht != null ? "#22c55e" : "#e15a5a", whiteSpace: "nowrap", minWidth: 80, textAlign: "right" }}>{l.total_ht != null ? fmtEur(l.total_ht) : "invalide"}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Section technique repliée */}
          <div style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden" }}>
            <button onClick={() => setJsonOuvert(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: T.card, border: "none", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, textAlign: "left" }}>
              <Icon as={Code2} size={12} />Payload JSON ({ENDPOINT_CREATION_DEVIS}) — technique
              <span style={{ flex: 1 }} />
              <span style={{ color: T.textMuted, fontWeight: 500 }}>{jsonOuvert ? "replier" : "déplier"}</span>
            </button>
            {jsonOuvert && (
              <div style={{ padding: "10px 12px", background: T.surface }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: FONT.xs.size, color: T.textMuted }}>
                  Body métier seul : aucun secret, aucun jeton, aucun en-tête d’authentification. Aucun elementId, aucun coût ni marge.
                  <span style={{ flex: 1 }} />
                  <button onClick={copierJson} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
                    <Icon as={copie ? Check : Copy} size={10} />{copie ? "Copié" : "Copier"}
                  </button>
                </div>
                <pre style={{ margin: 0, maxHeight: 360, overflow: "auto", fontSize: 11, lineHeight: 1.45, fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: T.text, whiteSpace: "pre" }}>{jsonPayload}</pre>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 22px", borderTop: `1px solid ${bordure}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>Aucun bouton d’envoi dans cette phase : la création réelle du devis attend validation.</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: acc.accent, color: acc.onAccent, border: "none", borderRadius: RADIUS.md, padding: "9px 22px", cursor: "pointer", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800 }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
