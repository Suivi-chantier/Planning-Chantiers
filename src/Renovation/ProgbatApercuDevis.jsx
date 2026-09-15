// src/Renovation/ProgbatApercuDevis.jsx — Chiffrage → « Aperçu ProGBat »
// Aperçu du devis ProGBat d'un logement, ALIMENTÉ PAR LE SERVEUR (Edge Function
// `progbat-quote`, action `prepare`), puis création d'un brouillon (action
// `create`) après confirmation explicite.
//
// Le navigateur n'envoie jamais de payload : seulement { action, projectId,
// expectedPayloadHash, confirmed }. Le serveur recharge le projet, reconstruit
// le payload, relit les taux ProGBat, refait les contrôles et compare le hash.
// Le JSON affiché ici est une reconstitution LOCALE (même générateur partagé)
// dont le hash est comparé à celui du serveur : toute divergence bloque la
// création. Jamais de secret, de jeton ni d'en-tête d'authentification.
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { X, AlertTriangle, Check, Layers, Home, UserCircle, MapPin, FileText, Receipt, RefreshCw, Code2, Copy, Send, ShieldAlert, Lock } from "lucide-react";
import { construirePayloadDevisProGBat, hacherPayload, formaterPct, ENDPOINT_CREATION_DEVIS, ENDPOINT_TAUX_TVA } from "./progbatQuotePayload.mjs";

const fmtEur = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtQte = (q) => q == null ? "—" : Number(q).toLocaleString("fr-FR", { maximumFractionDigits: 4 });
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime()) && /T/.test(String(iso))) return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const [a, m, j] = String(iso).slice(0, 10).split("-");
  return a && m && j ? `${j}/${m}/${a}` : String(iso);
};

// Appel de l'Edge Function : la session Supabase est transmise par le client ;
// un statut HTTP ≠ 2xx arrive dans error.context (Response) dont on lit le corps JSON.
async function appelerProgbatQuote(body) {
  const { data, error } = await supabase.functions.invoke("progbat-quote", { body });
  if (data && !error) return data;
  let corps = null;
  try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
  if (corps && typeof corps === "object") return corps;
  return { ok: false, code: "transport", error: error?.message || "Appel de la fonction progbat-quote impossible." };
}

export default function ProgbatApercuDevis({ T, acc, projetId, projet, lignes, lotsOrdre, onClose, onDevisCree }) {
  const [prep, setPrep] = useState(null);             // réponse serveur `prepare`
  const [chargement, setChargement] = useState(true);
  const [erreurServeur, setErreurServeur] = useState(null);
  const [hashLocal, setHashLocal] = useState(null);
  const [jsonOuvert, setJsonOuvert] = useState(false);
  const [copie, setCopie] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [creation, setCreation] = useState(false);    // appel `create` en cours
  const [resultat, setResultat] = useState(null);     // réponse serveur `create`

  const preparer = async () => {
    setChargement(true); setErreurServeur(null);
    try {
      const rep = await appelerProgbatQuote({ action: "prepare", projectId: projetId, logementReference: projet?.logement_reference || undefined });
      if (rep?.ok) setPrep(rep);
      else { setPrep(null); setErreurServeur(rep?.error || "Réponse inattendue du serveur."); }
    } catch (e) {
      setPrep(null); setErreurServeur(e?.message || "Erreur inattendue.");
    }
    setChargement(false);
  };
  useEffect(() => { if (projetId) preparer(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projetId]);

  // Reconstitution locale (même générateur, mêmes taux) : JSON technique + contrôle de parité
  const local = useMemo(
    () => prep ? construirePayloadDevisProGBat({ projet, lignes, lotsOrdre, taxes: prep.taux }) : null,
    [prep, projet, lignes, lotsOrdre],
  );
  const jsonPayload = useMemo(() => local ? JSON.stringify(local.payload, null, 2) : "", [local]);
  useEffect(() => {
    let actif = true;
    if (!local) { setHashLocal(null); return; }
    hacherPayload(local.payload).then(h => { if (actif) setHashLocal(h); }).catch(() => { if (actif) setHashLocal(null); });
    return () => { actif = false; };
  }, [local]);
  const pariteOk = !!prep && !!hashLocal && hashLocal === prep.payloadHash;
  const pariteConnue = !!prep && hashLocal != null;

  const copierJson = async () => {
    try { await navigator.clipboard.writeText(jsonPayload); setCopie(true); setTimeout(() => setCopie(false), 1800); } catch { /* presse-papiers indisponible */ }
  };

  const creer = async () => {
    if (creation || !prep?.peut_creer || !pariteOk) return;     // garde contre le double déclenchement
    setCreation(true);
    try {
      const rep = await appelerProgbatQuote({ action: "create", projectId: projetId, logementReference: prep.logement_reference || projet?.logement_reference || undefined, expectedPayloadHash: prep.payloadHash, confirmed: true });
      setResultat(rep || { ok: false, code: "transport", error: "Réponse vide." });
      if (rep?.statut === "created" && typeof onDevisCree === "function") onDevisCree(rep);
    } catch (e) {
      setResultat({ ok: false, statut: "uncertain", code: "transport_interrompu", verification_manuelle: true, error: `Connexion interrompue pendant la création (${e?.message || "erreur"}). Impossible de savoir si le brouillon a été créé : vérifier manuellement dans ProGBat.` });
    }
    setCreation(false);
    setConfirmation(false);
    // Rafraîchit le statut serveur (devis existant, hash envoyé) sans recréer quoi que ce soit
    preparer();
  };

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
      <div style={{ fontSize: FONT.md.size, fontWeight: 800, color, marginTop: 2, letterSpacing: -.2 }}>{valeur}</div>
    </div>
  );
  const vide = <span style={{ color: "#e15a5a", fontWeight: 700 }}>manquant</span>;
  const bandeau = (couleur, icone, texte) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 12px", borderRadius: RADIUS.md, background: `${couleur}18`, border: `1px solid ${couleur}66`, color: T.text, fontSize: FONT.xs.size + 1, fontWeight: 700, lineHeight: 1.5 }}>
      <Icon as={icone} size={13} style={{ color: couleur, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>{texte}</div>
    </div>
  );

  const entete = prep?.entete;
  const totaux = prep?.totaux;
  const compteurs = prep?.compteurs;
  const erreurs = prep?.erreurs || [];
  const avertissements = prep?.avertissements || [];
  const apercu = prep?.apercu || [];
  const devisExistant = prep?.devis_existant || null;
  const exportPrec = prep?.export_precedent || null;
  const incertain = exportPrec?.statut === "uncertain" || resultat?.statut === "uncertain";
  const peutCreer = !!prep?.peut_creer && pariteOk && !resultat?.ok && !incertain && !devisExistant;

  return (
    <div onClick={(e) => e.target === e.currentTarget && !creation && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(4px)" }}>
      <div style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, maxWidth: 840, width: "100%", maxHeight: "92vh", border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* En-tête */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${bordure}`, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: RADIUS.md, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon as={FileText} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Devis ProGBat{entete?.logement?.reference ? ` — ${entete.logement.reference}` : ""}</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 1 }}>{ENDPOINT_CREATION_DEVIS} · un devis = un logement · LOT → ZONE → OUVRAGES · aperçu reconstruit par le serveur</div>
          </div>
          <button onClick={onClose} disabled={creation} title="Fermer" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, width: 30, height: 30, cursor: creation ? "not-allowed" : "pointer", color: T.textSub }}>
            <Icon as={X} size={13} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Résultat d'une création dans cette session */}
          {resultat?.ok === true && resultat.statut === "created" && bandeau("#22c55e", Check, <>
            <div style={{ fontSize: FONT.sm.size }}>Devis brouillon ProGBat créé</div>
            <div style={{ fontWeight: 500, marginTop: 3 }}>Identifiant ProGBat : <strong>{resultat.progbat_quote_id}</strong>{resultat.progbat_quote_code ? <> · code <strong>{resultat.progbat_quote_code}</strong></> : null}</div>
            <div style={{ fontWeight: 500 }}>Créé le {fmtDate(resultat.finished_at)}{resultat.created_by_email ? ` par ${resultat.created_by_email}` : ""}. Le devis n'est ni finalisé ni envoyé au client.</div>
            {resultat.verification && <div style={{ fontWeight: 500, color: resultat.verification.id_confirme ? "#22c55e" : "#f5a623" }}>{resultat.verification.id_confirme ? "Présence confirmée par relecture ProGBat." : "Relecture de confirmation non concluante : le devis est créé, vérifier son affichage dans ProGBat."}</div>}
          </>)}
          {resultat && resultat.statut === "uncertain" && bandeau("#e15a5a", ShieldAlert, <>
            <div style={{ fontSize: FONT.sm.size }}>ÉTAT INCERTAIN — vérification manuelle requise</div>
            <div style={{ fontWeight: 500, marginTop: 3 }}>{resultat.error}</div>
            {resultat.progbat_quote_id != null && <div style={{ marginTop: 3 }}>Identifiant ProGBat connu : <strong>{resultat.progbat_quote_id}</strong></div>}
            <div style={{ fontWeight: 500, marginTop: 3 }}>Aucune nouvelle tentative n'est autorisée pour ce logement tant que la situation n'est pas contrôlée dans ProGBat.</div>
          </>)}
          {resultat && resultat.statut === "failed" && bandeau("#f5a623", AlertTriangle, <>ProGBat a refusé la création{resultat.progbat_status ? ` (HTTP ${resultat.progbat_status})` : ""} : {resultat.error} Aucun devis n'a été créé ; une nouvelle tentative est possible après correction.</>)}
          {resultat && !resultat.statut && resultat.ok === false && bandeau("#f5a623", AlertTriangle, <>{resultat.error || "La création a été refusée."}{resultat.code === "hash_different" ? " L'aperçu a été rechargé : vérifiez-le puis confirmez de nouveau." : ""}</>)}

          {/* Statut connu côté serveur */}
          {!resultat && devisExistant && bandeau("#22c55e", Check, <>
            <div style={{ fontSize: FONT.sm.size }}>Devis brouillon ProGBat créé</div>
            <div style={{ fontWeight: 500, marginTop: 3 }}>Identifiant ProGBat <strong>{devisExistant.progbat_quote_id}</strong>{devisExistant.progbat_quote_code ? <> · code <strong>{devisExistant.progbat_quote_code}</strong></> : null}{devisExistant.cree_le ? ` · le ${fmtDate(devisExistant.cree_le)}` : ""}{exportPrec?.created_by_email ? ` par ${exportPrec.created_by_email}` : ""}. Aucune nouvelle création possible pour ce logement.</div>
            {prep?.chiffrage_modifie_depuis && <div style={{ color: "#f5a623", marginTop: 4 }}>Le devis Profero a été modifié depuis la création du brouillon ProGBat. La mise à jour via l'API fera l'objet d'une phase séparée.</div>}
          </>)}
          {!resultat && exportPrec?.statut === "uncertain" && bandeau("#e15a5a", ShieldAlert, <>
            <div style={{ fontSize: FONT.sm.size }}>ÉTAT INCERTAIN — vérification manuelle requise</div>
            <div style={{ fontWeight: 500, marginTop: 3 }}>Une tentative précédente ({fmtDate(exportPrec.started_at)}{exportPrec.created_by_email ? `, ${exportPrec.created_by_email}` : ""}) n'a pas pu être confirmée{exportPrec.message ? ` : ${exportPrec.message}` : ""}.{exportPrec.progbat_quote_id != null ? ` Identifiant ProGBat connu : ${exportPrec.progbat_quote_id}.` : ""} Contrôler ProGBat manuellement ; aucune nouvelle création n'est autorisée.</div>
          </>)}
          {!resultat && exportPrec?.statut === "creating" && bandeau("#f5a623", RefreshCw, <>Une création est en cours pour ce logement ({fmtDate(exportPrec.started_at)}). Patienter puis recharger l'aperçu.</>)}
          {!resultat && exportPrec?.statut === "failed" && !devisExistant && bandeau("#f5a623", AlertTriangle, <>Dernière tentative échouée ({fmtDate(exportPrec.finished_at || exportPrec.started_at)}{exportPrec.http_status ? `, HTTP ${exportPrec.http_status}` : ""}){exportPrec.message ? ` : ${exportPrec.message}` : ""}. Une nouvelle tentative est possible.</>)}

          {/* Bandeau périmètre */}
          {!devisExistant && !incertain && bandeau("#4db8ff", AlertTriangle, "Aperçu uniquement — rien n'est envoyé à ProGBat. Seule la confirmation explicite du bouton « Créer le brouillon dans ProGBat » déclenche une création.")}

          {erreurServeur && bandeau("#e15a5a", X, <>{erreurServeur}</>)}

          {/* Statut de validité */}
          {prep && (
            <div style={{ padding: "10px 14px", borderRadius: RADIUS.lg, background: prep.valide ? "rgba(34,197,94,0.08)" : "rgba(225,90,90,0.07)", border: `1px solid ${prep.valide ? "rgba(34,197,94,0.35)" : "rgba(225,90,90,0.35)"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, fontWeight: 800, color: prep.valide ? "#22c55e" : "#e15a5a", flexWrap: "wrap" }}>
                <Icon as={prep.valide ? Check : X} size={14} />
                {prep.valide ? "Payload valide (contrôles serveur)" : `Payload invalide : ${erreurs.length} point${erreurs.length > 1 ? "s" : ""} bloquant${erreurs.length > 1 ? "s" : ""}`}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: !pariteConnue ? T.textMuted : pariteOk ? "#22c55e" : "#e15a5a" }} title="Le hash de la reconstitution locale est comparé à celui calculé par le serveur">
                  {!pariteConnue ? "parité local/serveur : calcul…" : pariteOk ? "✓ aperçu local identique au serveur" : "⚠ aperçu local différent du serveur — recharger"}
                </span>
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
              {prep.motif_blocage && !devisExistant && <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>{prep.motif_blocage.message}</div>}
              <div style={{ marginTop: 6, fontSize: FONT.xs.size, color: T.textMuted, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>hash serveur {prep.payloadHash?.slice(0, 16)}…</div>
            </div>
          )}

          {chargement && !prep && <div style={{ color: T.textMuted, fontSize: FONT.sm.size, display: "flex", alignItems: "center", gap: 8 }}><Icon as={RefreshCw} size={13} style={{ animation: "spin 1s linear infinite" }} />Reconstruction du devis par le serveur…</div>}

          {prep && (<>
            {/* Logement / client / chantier / devis */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
              {carte("Logement", Home, <>
                <div><strong>{entete.logement?.reference || vide}</strong>{entete.logement?.type ? ` · ${entete.logement.type}` : ""}</div>
                {entete.yardLabel && <div style={{ color: T.textSub }}>yardLabel : {entete.yardLabel}</div>}
              </>)}
              {carte("Client", UserCircle, <>
                <div><strong>{entete.client?.affichage || vide}</strong> <span style={{ color: T.textMuted }}>· {entete.client?.type}</span></div>
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
              </>)}
            </div>

            {/* Taux de TVA ProGBat */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted }}>
                  <Icon as={Receipt} size={11} />Taux de TVA ProGBat <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>({ENDPOINT_TAUX_TVA}, lus par le serveur)</span>
                </div>
                <span style={{ flex: 1 }} />
                <button onClick={preparer} disabled={chargement || creation} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: chargement ? "not-allowed" : "pointer" }}>
                  <Icon as={RefreshCw} size={10} style={chargement ? { animation: "spin 1s linear infinite" } : undefined} />{chargement ? "Reconstruction…" : "Recharger l'aperçu"}
                </button>
              </div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", fontSize: FONT.xs.size + 1 }}>
                {(prep.taux || []).map(t => (
                  <span key={t.id} style={{ padding: "2px 8px", borderRadius: 999, border: `1px solid ${T.border}`, background: t.saleDefault ? acc.bg10 : "transparent", color: T.text, fontWeight: 700 }}>
                    {formaterPct(t.rate)} <span style={{ color: T.textMuted, fontWeight: 500 }}>→ id {t.id}{t.saleDefault ? " · défaut vente" : ""}</span>
                  </span>
                ))}
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

            {/* Section technique repliée : reconstitution locale */}
            <div style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden" }}>
              <button onClick={() => setJsonOuvert(o => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: T.card, border: "none", cursor: "pointer", color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, textAlign: "left" }}>
                <Icon as={Code2} size={12} />Payload JSON ({ENDPOINT_CREATION_DEVIS}) — reconstitution locale, technique
                <span style={{ flex: 1 }} />
                <span style={{ color: T.textMuted, fontWeight: 500 }}>{jsonOuvert ? "replier" : "déplier"}</span>
              </button>
              {jsonOuvert && (
                <div style={{ padding: "10px 12px", background: T.surface }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: FONT.xs.size, color: T.textMuted, flexWrap: "wrap" }}>
                    Body métier seul : aucun secret, aucun jeton, aucun en-tête. Aucun elementId, coût ni marge. Ce qui part réellement est reconstruit par le serveur{pariteOk ? " (hash identique)" : ""}.
                    <span style={{ flex: 1 }} />
                    <button onClick={copierJson} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size, fontWeight: 700, cursor: "pointer" }}>
                      <Icon as={copie ? Check : Copy} size={10} />{copie ? "Copié" : "Copier"}
                    </button>
                  </div>
                  <pre style={{ margin: 0, maxHeight: 360, overflow: "auto", fontSize: 11, lineHeight: 1.45, fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: T.text, whiteSpace: "pre" }}>{jsonPayload}</pre>
                </div>
              )}
            </div>
          </>)}
        </div>

        {/* Pied : création */}
        <div style={{ padding: "12px 22px", borderTop: `1px solid ${bordure}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted, flex: 1, minWidth: 200 }}>
            {devisExistant || resultat?.ok
              ? "Brouillon déjà créé : la mise à jour d'un brouillon existant n'est pas encore disponible."
              : incertain ? "Création verrouillée : contrôler ProGBat manuellement."
              : peutCreer ? "La création ouvre une confirmation. Le devis restera un brouillon."
              : prep && !prep.valide ? "Corriger les points bloquants pour activer la création."
              : prep && !pariteOk && pariteConnue ? "Aperçu local différent du serveur : recharger l'aperçu."
              : ""}
          </span>
          <button onClick={onClose} disabled={creation} style={{ background: "transparent", color: T.textSub, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "9px 18px", cursor: creation ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700 }}>Fermer</button>
          <button onClick={() => peutCreer && !creation && setConfirmation(true)} disabled={!peutCreer || creation || chargement} title={peutCreer ? "Créer un devis brouillon dans ProGBat (confirmation demandée)" : "Création indisponible : corriger les points bloquants ou devis déjà créé"} style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: peutCreer && !creation ? acc.accent : T.border, color: peutCreer && !creation ? acc.onAccent : T.textMuted,
            border: "none", borderRadius: RADIUS.md, padding: "9px 20px", cursor: peutCreer && !creation ? "pointer" : "not-allowed", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
          }}>
            <Icon as={devisExistant || resultat?.ok ? Lock : Send} size={12} />{devisExistant || resultat?.ok ? "Devis brouillon créé" : creation ? "Création en cours…" : "Créer le brouillon dans ProGBat"}
          </button>
        </div>

        {/* Confirmation */}
        {confirmation && (
          <div onClick={(e) => e.target === e.currentTarget && !creation && setConfirmation(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div style={{ background: T.modal || T.surface, borderRadius: RADIUS.xl, padding: 22, width: "100%", maxWidth: 480, border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: RADIUS.md, flexShrink: 0, background: acc.bg10, color: acc.accent, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon as={Send} size={18} /></div>
                <div>
                  <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Créer le brouillon dans ProGBat ?</div>
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Confirmation explicite requise.</div>
                </div>
              </div>
              <div style={{ fontSize: FONT.sm.size, color: T.text, fontWeight: 700, lineHeight: 1.6, marginBottom: 12 }}>Cette action créera un devis brouillon dans ProGBat. Il ne sera ni finalisé ni envoyé.</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT.sm.size, marginBottom: 16 }}>
                <tbody>
                  {[
                    ["Logement", [entete?.logement?.reference, entete?.logement?.type].filter(Boolean).join(" · ") || "—"],
                    ["Client", entete?.client?.affichage || "—"],
                    ["Objet", entete?.objet || "—"],
                    ["Lots", compteurs?.lots],
                    ["Zones", compteurs?.zones],
                    ["Ouvrages", compteurs?.lignes],
                    ["Total HT", fmtEur(totaux?.ht)],
                    ["TVA", fmtEur(totaux?.tva)],
                    ["Total TTC", fmtEur(totaux?.ttc)],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ padding: "5px 8px", color: T.textMuted, borderBottom: `1px solid ${bordure}`, width: "40%" }}>{k}</td>
                      <td style={{ padding: "5px 8px", fontWeight: 700, color: T.text, borderBottom: `1px solid ${bordure}`, textAlign: "right" }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => !creation && setConfirmation(false)} disabled={creation} style={{ background: "transparent", color: T.textSub, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "9px 18px", cursor: creation ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 700 }}>Annuler</button>
                <button onClick={creer} disabled={creation} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: creation ? T.border : acc.accent, color: creation ? T.textMuted : acc.onAccent, border: "none", borderRadius: RADIUS.md, padding: "9px 20px", cursor: creation ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800 }}>
                  <Icon as={creation ? RefreshCw : Send} size={12} style={creation ? { animation: "spin 1s linear infinite" } : undefined} />{creation ? "Création en cours…" : "Créer le brouillon dans ProGBat"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
