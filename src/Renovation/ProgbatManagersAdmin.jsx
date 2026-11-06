// src/Renovation/ProgbatManagersAdmin.jsx — Réglages → Outils → ProGBat (Refonte Opérations, lot 4).
// Correspondance chargé d'affaires (compte Profero) → responsable ProGBat
// (managerId) utilisée à la création d'un chantier ProGBat. La liste des
// utilisateurs ProGBat n'est pas lisible avec les droits actuels de la clé
// (403 sur /company/employees, droit staff.read) : la correspondance se saisit
// ici. Sans correspondance, le chantier ProGBat est créé sans responsable et
// l'écran le dit. Rangée dans planning_config (clé progbat_correspondance_managers).
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { Users, Check, AlertTriangle } from "lucide-react";
import { chargerCollaborateurs, nomCollaborateur } from "./clientsDonnees.js";
import { CLE_MANAGERS, idProgbat } from "./progbatAutomatisation.js";

export default function ProgbatManagersAdmin({ T, acc }) {
  const [collab, setCollab] = useState({ collaborateurs: [], erreur: null });
  const [valeurs, setValeurs] = useState({});
  const [message, setMessage] = useState(null);

  useEffect(() => {
    (async () => {
      const c = await chargerCollaborateurs();
      setCollab(c);
      const { data } = await supabase.from("planning_config").select("value").eq("key", CLE_MANAGERS).maybeSingle();
      const corr = data?.value?.correspondances || {};
      setValeurs(Object.fromEntries(Object.entries(corr).map(([k, v]) => [k, String(v)])));
    })();
  }, []);

  const enregistrer = async () => {
    const invalides = Object.entries(valeurs).filter(([, v]) => String(v).trim() && idProgbat(v) == null);
    if (invalides.length) { setMessage({ ok: false, texte: "Un identifiant ProGBat est un nombre entier (ex. 2)." }); return; }
    const correspondances = Object.fromEntries(Object.entries(valeurs).filter(([, v]) => idProgbat(v) != null).map(([k, v]) => [k, idProgbat(v)]));
    const { error } = await supabase.from("planning_config").upsert({ key: CLE_MANAGERS, value: { correspondances } }, { onConflict: "key" });
    setMessage(error ? { ok: false, texte: "Enregistrement impossible : " + error.message } : { ok: true, texte: `${Object.keys(correspondances).length} correspondance(s) enregistrée(s).` });
  };

  const input = { width: 90, padding: "5px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1 };
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "14px 16px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>
        <Icon as={Users} size={14} /> Chargés d'affaires : responsable dans ProGBat
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 4, lineHeight: 1.55 }}>
        Quand l'application crée un chantier dans ProGBat, elle y met le chargé d'affaires comme responsable si son numéro ProGBat est connu ici.
        Sans numéro, le chantier ProGBat est créé sans responsable (et l'écran le dit). Les numéros de responsable utilisés aujourd'hui dans ProGBat sont 2, 15 et 21
        (lus le 06/11/2026) ; leur nom n'est pas lisible avec les droits actuels de l'application ProGBat (droit « staff.read » absent).
      </div>
      {collab.erreur && <div style={{ color: "#e15a5a", fontSize: FONT.xs.size + 1, marginTop: 6 }}>Collaborateurs illisibles : {collab.erreur}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {collab.collaborateurs.map((u) => (
          <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: FONT.xs.size + 1, color: T.text }}>
            <span style={{ minWidth: 200 }}>{nomCollaborateur(u)} <span style={{ color: T.textMuted }}>({u.role})</span></span>
            <input value={valeurs[u.id] ?? ""} placeholder="n° ProGBat" onChange={(e) => setValeurs((v) => ({ ...v, [u.id]: e.target.value }))} style={input} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={enregistrer} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: acc.onAccent, fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer" }}>Enregistrer</button>
        {message && <span style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: message.ok ? "#22c55e" : "#e15a5a", display: "inline-flex", alignItems: "center", gap: 5 }}><Icon as={message.ok ? Check : AlertTriangle} size={12} />{message.texte}</span>}
      </div>
    </div>
  );
}
