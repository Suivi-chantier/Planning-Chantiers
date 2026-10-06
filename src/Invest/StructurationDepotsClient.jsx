// src/Invest/StructurationDepotsClient.jsx — Pièces déposées par le client dans son espace, à vérifier.
// Le fichier n'est jamais intégré sans vérification : le collaborateur l'ouvre (lien de 2 minutes), puis l'accepte
// (la pièce passe à « Reçu » dans le dossier) ou la refuse avec un motif que le client verra.
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, SPACING } from "../constants";
import { WA } from "./_shared";

const dateFr = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "");
const taille = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round((o || 0) / 1024))} Ko`);

export default function DepotsClient({ T, clientId, profil, onAccepter }) {
  const [lignes, setLignes] = useState(null);
  const [absente, setAbsente] = useState(false);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(null);

  const charger = useCallback(async () => {
    if (!clientId) { setLignes([]); return; }
    const r = await supabase.from("invest_portail_depots").select("id,piece_cle,libelle,nom_fichier,taille,chemin,depose_le").eq("client_id", clientId).eq("statut", "a_verifier").order("depose_le", { ascending: true });
    if (r.error) { if (r.error.code === "42P01" || /does not exist|schema cache/i.test(r.error.message || "")) setAbsente(true); else setErreur(r.error.message); setLignes([]); return; }
    setLignes(r.data || []);
  }, [clientId]);
  useEffect(() => { charger(); }, [charger]);

  const ouvrir = async (l) => {
    const fenetre = window.open("", "_blank");
    const { data, error } = await supabase.storage.from("invest-documents").createSignedUrl(l.chemin, 120);
    if (error || !data?.signedUrl) { fenetre?.close(); setErreur("Fichier indisponible."); return; }
    if (fenetre) { fenetre.opener = null; fenetre.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
  };
  const traiter = async (l, statut, motif = null) => {
    setOccupe(l.id); setErreur("");
    const r = await supabase.from("invest_portail_depots").update({ statut, traite_par: profil?.nom || profil?.email || null, traite_le: new Date().toISOString(), motif }).eq("id", l.id).eq("statut", "a_verifier").select("id");
    setOccupe(null);
    if (r.error || !r.data?.length) { setErreur(r.error?.message || "Traitement refusé : droits insuffisants ou dépôt déjà traité."); return false; }
    await charger(); return true;
  };
  const accepter = async (l) => { if (await traiter(l, "accepte") && l.piece_cle) onAccepter(l.piece_cle); };
  const refuser = async (l) => {
    const motif = window.prompt("Pourquoi refuser cette pièce ? Le client verra ce message.", "");
    if (motif === null) return;
    await traiter(l, "refuse", motif.trim() || "Pièce à renvoyer.");
  };

  if (absente || lignes === null || lignes.length === 0) return erreur ? <div style={{ color: WA, fontSize: FONT.sm.size }}>{erreur}</div> : null;
  return (
    <section style={{ background: T.card, border: `2px solid ${WA}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>Le client a déposé {lignes.length} pièce{lignes.length > 1 ? "s" : ""} à vérifier</h3>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "3px 0 10px" }}>Ouvrez chaque fichier, puis acceptez-le (la pièce passe à « Reçu » dans le dossier) ou refusez-le avec un motif.</div>
      {erreur && <div style={{ color: WA, marginBottom: 8 }}>{erreur}</div>}
      {lignes.map((l) => (
        <div key={l.id} style={{ borderTop: `1px solid ${T.rowBorder || T.border}`, padding: "9px 0", display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <b style={{ color: T.text }}>{l.libelle}</b>
            <div style={{ color: T.textMuted, fontSize: FONT.xs.size + 1, overflowWrap: "anywhere" }}>{l.nom_fichier} · {taille(l.taille)} · déposé le {dateFr(l.depose_le)}{l.piece_cle ? "" : " · document libre (aucune pièce du dossier concernée)"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="inv-btn inv-btn-sm" onClick={() => ouvrir(l)}>Ouvrir</button>
            <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe === l.id} onClick={() => accepter(l)}>Accepter</button>
            <button className="inv-btn inv-btn-sm" disabled={occupe === l.id} onClick={() => refuser(l)}>Refuser</button>
          </div>
        </div>
      ))}
    </section>
  );
}
