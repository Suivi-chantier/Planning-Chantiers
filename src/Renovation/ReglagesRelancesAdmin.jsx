// ─────────────────────────────────────────────────────────────────────────────
// Réglages → Relances (Refonte Opérations, lot 3).
// Interrupteur des relances e-mail automatiques (devis non signé, facture
// d'acompte non réglée) et délai avant la première relance. LIVRÉ ÉTEINT :
// tant que l'interrupteur est éteint, la tâche planifiée n'envoie rien.
// Règles : src/Renovation/relancesCycleVie.mjs ; envoi :
// api/_cron/cron-relances-cycle-vie.js (via /api/cron-dispatcher).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { chargerReglagesRelances, enregistrerReglagesRelances } from "./cycleVieDonnees.js";
import { DELAI_RELANCE_DEFAUT, DELAI_RELANCE_MIN, DELAI_RELANCE_MAX, INTERVALLE_RELANCE_JOURS } from "./relancesCycleVie.js";

export default function ReglagesRelancesAdmin({ T, profil }) {
  const [etat, setEtat] = useState({ charge: false, actif: false, delai: DELAI_RELANCE_DEFAUT, erreur: null, brut: null });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    chargerReglagesRelances().then((r) => setEtat({ charge: true, actif: r.reglages.actif, delai: r.reglages.delaiJours, erreur: r.erreur, brut: r.brut }));
  }, []);
  const enregistrer = async (patch) => {
    const suivant = { ...etat, ...patch };
    setBusy(true);
    const r = await enregistrerReglagesRelances({ actif: suivant.actif, delaiJours: suivant.delai, auteur: profil?.nom || profil?.email || "" });
    setBusy(false);
    if (!r.ok) { setMsg({ ton: "err", texte: `Non enregistré : ${r.erreur}` }); return; }
    setEtat({ ...suivant, actif: r.reglages.actif, delai: r.reglages.delaiJours, brut: { actif: r.reglages.actif, delai_jours: r.reglages.delaiJours } });
    setMsg({ ton: "ok", texte: r.reglages.actif ? "Relances activées : la prochaine tâche planifiée (chaque matin en semaine) enverra les relances dues." : "Relances désactivées : plus aucun e-mail de relance ne part." });
  };
  const carte = { border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: "16px 18px", background: T.card || "transparent", maxWidth: 720 };
  return (
    <div style={carte}>
      <div style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text, marginBottom: 6 }}>Relances automatiques par e-mail</div>
      <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.6, marginBottom: 12 }}>
        Deux relances, envoyées au <strong>chargé d'affaires</strong> du chantier, avec le lien « Ouvrir dans ProGBat » :
        <br/>• <strong>devis non signé</strong> : après le délai ci-dessous suivant l'import du devis envoyé, puis chaque semaine jusqu'à la signature ;
        <br/>• <strong>facture d'acompte non réglée</strong> : après le délai suivant son émission, puis chaque semaine jusqu'à l'encaissement.
        <br/>Aucune relance pour un chantier perdu, ni sans chargé d'affaires (l'étape du chantier l'affiche). Une même relance n'est jamais envoyée deux fois.
      </div>
      {!etat.charge ? (
        <div style={{ color: T.textMuted, fontStyle: "italic" }}>Chargement…</div>
      ) : (
        <>
          {etat.erreur && <div style={{ color: "#e15a5a", fontWeight: 600, marginBottom: 8 }}>Réglage illisible ({etat.erreur}) : les relances sont considérées comme éteintes.</div>}
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: busy ? "default" : "pointer", marginBottom: 12 }}>
            <input type="checkbox" checked={etat.actif} disabled={busy} onChange={(e) => enregistrer({ actif: e.target.checked })}/>
            <span style={{ fontWeight: 800, color: etat.actif ? "#22c55e" : T.textSub }}>
              {etat.actif ? "Relances ACTIVÉES" : "Relances désactivées (aucun e-mail ne part)"}
            </span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>Première relance au bout de</span>
            <input type="number" min={DELAI_RELANCE_MIN} max={DELAI_RELANCE_MAX} value={etat.delai} disabled={busy}
              onChange={(e) => setEtat((s) => ({ ...s, delai: e.target.value }))}
              style={{ width: 70, padding: "5px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit" }}/>
            <span style={{ color: T.textSub, fontSize: FONT.sm.size }}>jours, puis tous les {INTERVALLE_RELANCE_JOURS} jours.</span>
            <button disabled={busy} onClick={() => enregistrer({})} style={{
              padding: "6px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent",
              color: T.text, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
            }}>Enregistrer le délai</button>
          </div>
          {!etat.brut && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 8 }}>Jamais réglé : valeurs par défaut (éteint, {DELAI_RELANCE_DEFAUT} jours).</div>}
          {msg && <div style={{ marginTop: 10, fontWeight: 600, color: msg.ton === "ok" ? "#15803d" : "#e15a5a" }}>{msg.texte}</div>}
        </>
      )}
    </div>
  );
}
