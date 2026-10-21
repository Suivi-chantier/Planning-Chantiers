// src/Renovation/ProgbatFamilleMultiAdmin.jsx — Réglages → Outils → Maintenance
// Famille ProGBat qui reçoit les ouvrages « MULTI-… » créés à l'export d'un
// devis contenant des multi-ouvrages. Choisie UNE fois, parmi les familles
// d'ouvrages qui existent déjà dans ProGBat (aucune famille n'est créée).
// La liste vient de l'Edge Function progbat-quote (action familles_multi,
// lecture seule) ; le choix est rangé dans planning_config et revérifié par le
// serveur à chaque export.
import React, { useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Layers, RefreshCw, Check, AlertTriangle } from "lucide-react";

const CLE = "progbat_famille_multi_ouvrages";   // = CLE_FAMILLE_MULTI (progbatQuoteServeur.mjs)

export default function ProgbatFamilleMultiAdmin({ T, acc }) {
  const [etat, setEtat] = useState(null);       // réponse familles_multi
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [choix, setChoix] = useState("");
  const [message, setMessage] = useState(null);

  const charger = async () => {
    setChargement(true); setErreur(null); setMessage(null);
    const { data, error } = await supabase.functions.invoke("progbat-quote", { body: { action: "familles_multi" } });
    let rep = data;
    if (error) { try { rep = await error.context?.json?.(); } catch { rep = null; } }
    if (!rep?.ok) { setErreur(rep?.error || error?.message || "Lecture des familles ProGBat impossible."); setEtat(null); }
    else { setEtat(rep); setChoix(rep.choix?.id ? String(rep.choix.id) : ""); }
    setChargement(false);
  };

  const enregistrer = async () => {
    const f = (etat?.familles || []).find(x => String(x.id) === choix);
    if (!f) return;
    const { error } = await supabase.from("planning_config").upsert({ key: CLE, value: { id: f.id, label: f.label } }, { onConflict: "key" });
    if (error) { setMessage({ ok: false, texte: "Enregistrement impossible : " + error.message }); return; }
    setMessage({ ok: true, texte: `Les ouvrages MULTI seront créés dans la famille « ${f.label} ».` });
    setEtat(e => ({ ...e, choix: { id: f.id, label: f.label, existe: true } }));
  };

  const btn = { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer" };
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 16px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>
        <Icon as={Layers} size={14} /> Multi-ouvrages : famille ProGBat
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 4, lineHeight: 1.55 }}>
        Quand un devis contient un multi-ouvrage (ex. « salle de bain type »), Profero crée dans ProGBat un ouvrage « MULTI-… » qui contient les ouvrages regroupés.
        Choisir ici la famille ProGBat qui les reçoit. Sans famille choisie, l'export d'un devis avec un nouveau multi-ouvrage est bloqué.
      </div>
      {etat?.choix && (
        <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, fontWeight: 700, color: etat.choix.existe ? "#22c55e" : "#e15a5a", display: "flex", alignItems: "center", gap: 6 }}>
          <Icon as={etat.choix.existe ? Check : AlertTriangle} size={12} />
          {etat.choix.existe ? `Famille actuelle : ${etat.choix.label}` : `La famille choisie (« ${etat.choix.label} ») n'existe plus dans ProGBat : en choisir une autre.`}
        </div>
      )}
      {!etat && !erreur && <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Famille actuelle : cliquer sur « Lire les familles ProGBat » pour l'afficher.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={charger} disabled={chargement} style={btn}>
          <Icon as={RefreshCw} size={12} style={chargement ? { animation: "spin 1s linear infinite" } : undefined} />{chargement ? "Lecture…" : "Lire les familles ProGBat"}
        </button>
        {etat && (
          <>
            <select value={choix} onChange={e => setChoix(e.target.value)} style={{ padding: "7px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, minWidth: 220 }}>
              <option value="">— Choisir une famille d'ouvrages —</option>
              {(etat.familles || []).map(f => <option key={f.id} value={String(f.id)}>{f.label}</option>)}
            </select>
            <button onClick={enregistrer} disabled={!choix || String(etat.choix?.id ?? "") === choix} style={{ ...btn, background: choix && String(etat.choix?.id ?? "") !== choix ? acc.accent : "transparent", color: choix && String(etat.choix?.id ?? "") !== choix ? acc.onAccent : T.textMuted, border: "none" }}>
              <Icon as={Check} size={12} /> Enregistrer
            </button>
          </>
        )}
      </div>
      {erreur && <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 700 }}>{erreur}</div>}
      {message && <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, color: message.ok ? "#22c55e" : "#e15a5a", fontWeight: 700 }}>{message.texte}</div>}
    </div>
  );
}
