// src/Renovation/ControleJournalAvancement.jsx — compteur visible du contrôle
// nocturne du journal d'avancement daté (refonte du Bilan, étape 1C).
// Lit la dernière ligne de avancement_journal_controles. 0 écart = tous les
// changements d'avancement sont passés par le journal ; sinon, un chemin
// d'écriture lui a échappé (les écarts ont été rattrapés par une ligne
// « reconciliation », mais la cause est à corriger).
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";

export default function ControleJournalAvancement({ T }) {
  const [etat, setEtat] = useState({ charge: false, dernier: null, erreur: null });
  useEffect(() => {
    let actif = true;
    supabase.from("avancement_journal_controles")
      .select("execute_le, nb_taches, nb_ecarts, ecarts")
      .order("execute_le", { ascending: false }).limit(1)
      .then(({ data, error }) => {
        if (!actif) return;
        setEtat({ charge: true, dernier: (data || [])[0] || null, erreur: error ? error.message : null });
      });
    return () => { actif = false; };
  }, []);

  const d = etat.dernier;
  const couleur = !etat.charge ? T.textMuted : etat.erreur ? "#f5a623" : !d ? T.textMuted : d.nb_ecarts === 0 ? "#22c55e" : "#e15a5a";
  const texte = !etat.charge ? "Lecture…"
    : etat.erreur ? `Contrôle illisible (${etat.erreur})`
    : !d ? "Aucun contrôle encore passé (premier passage cette nuit)."
    : d.nb_ecarts === 0
      ? `0 écart sur ${d.nb_taches} tâches au contrôle du ${new Date(d.execute_le).toLocaleString("fr-FR")}.`
      : `${d.nb_ecarts} écart${d.nb_ecarts > 1 ? "s" : ""} sur ${d.nb_taches} tâches au contrôle du ${new Date(d.execute_le).toLocaleString("fr-FR")} : un changement d'avancement a été écrit sans passer par le journal (rattrapé, mais la cause est à corriger).`;
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `3px solid ${couleur}`,
      borderRadius: RADIUS.lg, padding: "12px 14px", marginBottom: 18 }}>
      <div style={{ fontWeight: 700, fontSize: FONT.sm.size + 1, color: T.text, marginBottom: 4 }}>
        Journal d'avancement — contrôle nocturne
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: couleur, fontWeight: 600 }}>{texte}</div>
    </div>
  );
}
