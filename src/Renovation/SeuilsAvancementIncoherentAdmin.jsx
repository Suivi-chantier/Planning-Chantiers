// src/Renovation/SeuilsAvancementIncoherentAdmin.jsx — Réglages → Taux
// horaires → « Validation des comptes rendus : avancement incohérent » (CR-6).
// Seuils de l'écart orange « avancement incohérent avec les heures », rangés
// dans planning_config (clé CLE_CONFIG_AVANCEMENT_INCOHERENT). Réglage jamais
// enregistré ou champ vidé = valeur par défaut.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import {
  CLE_CONFIG_AVANCEMENT_INCOHERENT, SEUILS_AVANCEMENT_INCOHERENT_DEFAUT, normaliserSeuilsAvancementIncoherent,
} from "./avancementIncoherentV1";

const CHAMPS = [
  { cle: "ratioHeuresMin", label: "Avancement en avance sur les heures : heures consommées ÷ heures « méritées » en dessous de", unite: "(0,5 = moins de la moitié des heures)" },
  { cle: "heuresPrevuesMin", label: "… seulement pour une tâche d'au moins", unite: "h prévues" },
  { cle: "gainSansHeuresPts", label: "Avancement qui gagne au moins", unite: "points sans aucune heure pointée ce jour-là" },
];
const fmt = (v) => String(v).replace(".", ",");

export default function SeuilsAvancementIncoherentAdmin({ T, saveConfig }) {
  const [stocke, setStocke] = useState(null);       // valeur brute en base (null = jamais enregistrée)
  const [lecture, setLecture] = useState("chargement"); // chargement | ok | erreur
  const [brouillon, setBrouillon] = useState({});
  const [message, setMessage] = useState(null);

  const charger = async () => {
    const { data, error } = await supabase.from("planning_config").select("value")
      .eq("key", CLE_CONFIG_AVANCEMENT_INCOHERENT).maybeSingle();
    if (error) console.warn("Seuils de l'avancement incohérent :", error.message);
    setStocke(error ? null : data?.value ?? null);
    setLecture(error ? "erreur" : "ok");
  };
  useEffect(() => { charger(); }, []);

  const valeurs = normaliserSeuilsAvancementIncoherent(stocke);
  const valeurChamp = (cle) => brouillon[cle] ?? fmt(valeurs[cle]);
  const cas3 = brouillon.retourTermineeActif ?? valeurs.retourTermineeActif;
  const modifie = Object.keys(brouillon).length > 0;

  const enregistrer = async () => {
    const suivant = { ...(stocke && typeof stocke === "object" ? stocke : {}) };
    Object.entries(brouillon).forEach(([cle, v]) => {
      if (cle === "retourTermineeActif") { suivant[cle] = !!v; return; }
      const n = parseFloat(String(v).replace(",", "."));
      if (String(v).trim() === "") delete suivant[cle];
      else if (Number.isFinite(n) && n >= 0) suivant[cle] = n;
    });
    await saveConfig?.(CLE_CONFIG_AVANCEMENT_INCOHERENT, suivant);
    await charger();
    setBrouillon({});
    setMessage("Réglages enregistrés : la page Validation fin de journée en tient compte à son prochain chargement.");
  };

  const inp = {
    width: 80, padding: "6px 8px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.inputBg,
    color: T.accent, fontFamily: "inherit", fontSize: 14, fontWeight: 700, textAlign: "center", outline: "none",
  };

  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Validation des comptes rendus : avancement incohérent</div>
      <div style={{ color: T.textSub, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
        À la validation, une tâche reçoit un écart orange (plus de « Valider » direct) quand l'avancement déclaré ne
        colle pas avec les heures : avancement très en avance sur les heures consommées (heures pointées avant ce jour
        + heures de toutes les personnes ce jour-là, comparées aux heures prévues × l'avancement déclaré), avancement
        qui fait un grand bond sans aucune heure ce jour-là, ou tâche terminée déclarée de nouveau « en cours ». Un
        champ vidé reprend la valeur par défaut.
        {lecture === "erreur" && " (Réglages illisibles pour le moment : valeurs par défaut affichées.)"}
      </div>
      {CHAMPS.map(c => (
        <div key={c.cle} className="ar" style={{ gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1, fontSize: 14, color: T.text }}>{c.label}</div>
          <input value={valeurChamp(c.cle)} inputMode="decimal"
            onChange={e => { setMessage(null); setBrouillon(b => ({ ...b, [c.cle]: e.target.value })); }}
            style={inp}/>
          <div style={{ width: 260, fontSize: 12, color: T.textMuted }}>
            {c.unite}
            {valeurs[c.cle] !== SEUILS_AVANCEMENT_INCOHERENT_DEFAUT[c.cle] && (
              <span style={{ display: "block", fontStyle: "italic" }}>défaut : {fmt(SEUILS_AVANCEMENT_INCOHERENT_DEFAUT[c.cle])}</span>
            )}
          </div>
        </div>
      ))}
      <div className="ar" style={{ gap: 10, alignItems: "center" }}>
        <label style={{ flex: 1, fontSize: 14, color: T.text, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={cas3}
            onChange={e => { setMessage(null); setBrouillon(b => ({ ...b, retourTermineeActif: e.target.checked })); }}/>
          Signaler une tâche terminée déclarée de nouveau « en cours »
        </label>
        <div style={{ width: 260, fontSize: 12, color: T.textMuted }}>
          {cas3 ? "activé" : "désactivé"}{!valeurs.retourTermineeActif && <span style={{ display: "block", fontStyle: "italic" }}>défaut : activé</span>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button onClick={enregistrer} disabled={!modifie}
          style={{ padding: "8px 14px", borderRadius: 8, border: "none", fontWeight: 700, cursor: modifie ? "pointer" : "not-allowed",
            background: modifie ? T.accent : T.border, color: "#111" }}>
          Enregistrer
        </button>
        {message && <span style={{ fontSize: 12, color: "#22c55e" }}>{message}</span>}
      </div>
    </div>
  );
}
