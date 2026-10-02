// src/Invest/StructurationReponsesClient.jsx — Ce que le client a saisi dans son espace, à vérifier et à intégrer au dossier.
// Le client n'écrit jamais dans le dossier : chaque partie envoyée arrive ici « à vérifier ». Le collaborateur voit les
// écarts avec le dossier, puis l'intègre (le dossier de cette page est modifié et enregistré par la sauvegarde habituelle)
// ou la renvoie au client avec une note. Calculs : src/Portail/portailChamps.mjs.
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING } from "../constants";
import { WA, SU } from "./_shared";
import { SECTIONS, ecarts } from "../Portail/portailChamps.mjs";

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "");

export default function ReponsesClient({ T, clientId, data, profil, onAppliquer }) {
  const [lignes, setLignes] = useState(null);       // null = chargement
  const [absente, setAbsente] = useState(false);    // table pas encore créée (migration non appliquée)
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(null);

  const charger = useCallback(async () => {
    if (!clientId) { setLignes([]); return; }
    const r = await supabase.from("invest_portail_reponses").select("id,section,donnees,statut,soumis_le").eq("client_id", clientId).eq("statut", "soumis").order("soumis_le", { ascending: true });
    if (r.error) { if (r.error.code === "42P01" || /does not exist|schema cache/i.test(r.error.message || "")) setAbsente(true); else setErreur(r.error.message); setLignes([]); return; }
    setLignes(r.data || []);
  }, [clientId]);
  useEffect(() => { charger(); }, [charger]);

  const traiter = async (ligne, statut, note = null) => {
    setOccupe(ligne.id); setErreur("");
    const r = await supabase.from("invest_portail_reponses").update({ statut, traite_par: profil?.nom || profil?.email || null, traite_le: new Date().toISOString(), note_traitement: note }).eq("id", ligne.id).eq("statut", "soumis").select("id");
    setOccupe(null);
    if (r.error || !r.data?.length) { setErreur(r.error?.message || "Traitement refusé : droits insuffisants ou réponse déjà traitée."); return false; }
    await charger();
    return true;
  };
  const integrer = async (ligne) => {
    const diff = ecarts(data, ligne.section, ligne.donnees);
    const retraits = diff.filter((x) => x.retrait).length;
    if (!window.confirm(`Intégrer ${diff.length} modification(s) au dossier ?${retraits ? `\n\n${retraits} élément(s) retiré(s) par le client seront retirés du dossier.` : ""}\n\nLe dossier est enregistré avec ces valeurs.`)) return;
    if (await traiter(ligne, "valide")) onAppliquer(ligne.section, ligne.donnees);
  };
  const renvoyer = async (ligne) => {
    const note = window.prompt("Message pour le client (facultatif) : que doit-il revoir ?", "");
    if (note === null) return;
    await traiter(ligne, "refuse", note.trim() || null);
  };

  if (absente || lignes === null || lignes.length === 0) {
    return erreur ? <div style={{ color: WA, fontSize: FONT.sm.size }}>{erreur}</div> : null;
  }
  return (
    <section style={{ background: T.card, border: `2px solid ${WA}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>Le client a envoyé {lignes.length} partie{lignes.length > 1 ? "s" : ""} à vérifier</h3>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "3px 0 10px", maxWidth: 820 }}>Saisies dans son espace client. Rien n'est modifié dans le dossier tant que vous n'avez pas cliqué sur « Intégrer au dossier ».</div>
      {erreur && <div style={{ color: WA, marginBottom: 8 }}>{erreur}</div>}
      {lignes.map((l) => {
        const diff = ecarts(data, l.section, l.donnees);
        const libelle = SECTIONS.find((s) => s.cle === l.section)?.libelle || l.section;
        return (
          <div key={l.id} style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <b style={{ color: T.text }}>{libelle}</b><span style={{ color: T.textMuted, fontSize: FONT.xs.size + 1 }}>envoyé le {dateFr(l.soumis_le)}</span>
            </div>
            {diff.length === 0
              ? <div style={{ color: T.textSub, fontSize: FONT.sm.size, margin: "6px 0" }}>Aucune différence avec le dossier.</div>
              : <table className="inv-table" style={{ width: "100%", margin: "6px 0" }}><thead><tr><th>Information</th><th>Dossier</th><th>Client</th></tr></thead>
                  <tbody>{diff.map((x) => <tr key={x.cle}><td>{x.libelle}</td><td style={{ color: T.textMuted }}>{x.avant}</td><td style={{ fontWeight: 800, color: x.retrait ? WA : x.nouveau ? SU : T.text }}>{x.apres}</td></tr>)}</tbody></table>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe === l.id} onClick={() => integrer(l)}>Intégrer au dossier</button>
              <button className="inv-btn inv-btn-sm" disabled={occupe === l.id} onClick={() => renvoyer(l)}>Renvoyer au client</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
