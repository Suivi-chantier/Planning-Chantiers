// src/Portail/MesPieces.jsx — « Pièces à nous transmettre » : le client dépose les documents demandés par Profero.
// Aucun accès direct au stockage ni aux tables : tout passe par la fonction portail-depot-document (qui choisit le chemin,
// contrôle la taille et le type) et par la vue portail_depots. Le fichier déposé arrive « à vérifier » chez le conseiller.
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";

const C = { doux: "#667085", bord: "rgba(15,23,42,.12)", vert: "#16a34a", bleu: "#2563eb", ambre: "#b45309", rouge: "#b91c1c" };
const TAILLE_MAX = 10 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const STATUT = { a_verifier: ["Reçu, en cours de vérification", C.bleu], accepte: ["Accepté", C.vert], refuse: ["À renvoyer", C.rouge] };
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const taille = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

export default function MesPieces() {
  const [etat, setEtat] = useState("chargement");     // chargement | pret | erreur
  const [demandees, setDemandees] = useState([]);
  const [depots, setDepots] = useState([]);
  const [occupe, setOccupe] = useState("");           // identifiant de la pièce en cours de dépôt
  const [message, setMessage] = useState({});         // pièce -> { ok, texte }
  const [autreLibelle, setAutreLibelle] = useState("");

  const charger = useCallback(async () => {
    const [p, d] = await Promise.all([
      supabase.rpc("portail_pieces_demandees"),
      supabase.from("portail_depots").select("id,piece_cle,libelle,nom_fichier,taille,statut,depose_le,motif").order("depose_le", { ascending: false }),
    ]);
    if (p.error || d.error) { setEtat("erreur"); return; }
    setDemandees(Array.isArray(p.data) ? p.data : []); setDepots(d.data || []); setEtat("pret");
  }, []);
  useEffect(() => { charger(); }, [charger]);

  const deposer = async (fichier, pieceCle, libelle) => {
    const cle = pieceCle || "autre";
    setOccupe(cle); setMessage((m) => ({ ...m, [cle]: null }));
    const echec = (texte) => { setOccupe(""); setMessage((m) => ({ ...m, [cle]: { ok: false, texte } })); };
    if (!fichier) return echec("Aucun fichier choisi.");
    if (fichier.size > TAILLE_MAX) return echec("Fichier trop volumineux (10 Mo au maximum).");
    const prep = await supabase.functions.invoke("portail-depot-document", { body: { action: "preparer", nomFichier: fichier.name, taille: fichier.size, mime: fichier.type, pieceCle, libelle } });
    if (prep.error || !prep.data?.ok) return echec(prep.data?.error || "Dépôt impossible pour le moment. Réessayez ou contactez votre conseiller.");
    const { depotId, chemin, token } = prep.data;
    const envoi = await supabase.storage.from("invest-documents").uploadToSignedUrl(chemin, token, fichier, { contentType: fichier.type });
    if (envoi.error) return echec("Le fichier n'a pas pu être envoyé. Réessayez.");
    const conf = await supabase.functions.invoke("portail-depot-document", { body: { action: "confirmer", depotId } });
    if (conf.error || !conf.data?.ok) return echec(conf.data?.error || "Le fichier n'a pas pu être vérifié. Réessayez.");
    setOccupe(""); setMessage((m) => ({ ...m, [cle]: { ok: true, texte: "Merci, votre document est bien reçu. Votre conseiller le vérifie." } }));
    if (!pieceCle) setAutreLibelle("");
    await charger();
  };

  if (etat === "chargement") return <div style={{ color: C.doux }}>Chargement…</div>;
  if (etat === "erreur") return <div role="alert" style={{ color: C.rouge }}>Impossible d'afficher vos pièces pour le moment. Réessayez plus tard ou contactez votre conseiller.</div>;
  const deposeesPourPiece = (id) => depots.filter((x) => x.piece_cle === id);
  const Bouton = ({ cle, pieceCle, libelle, desactive, texte }) => (
    <label className="pc-btn pc-btn-or" style={{ display: "inline-flex", alignItems: "center", opacity: occupe === cle || desactive ? .6 : 1, cursor: desactive ? "default" : "pointer" }}>
      {occupe === cle ? "Envoi en cours…" : texte}
      <input type="file" accept={ACCEPT} style={{ display: "none" }} disabled={!!occupe || desactive} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; deposer(f, pieceCle, libelle); }} />
    </label>
  );
  const Retour = ({ cle }) => message[cle] ? <div role={message[cle].ok ? "status" : "alert"} style={{ color: message[cle].ok ? C.vert : C.rouge, fontSize: 14, marginTop: 6 }}>{message[cle].texte}</div> : null;
  return (
    <div>
      <p style={{ margin: "0 0 12px", color: C.doux, fontSize: 14 }}>Déposez ici les documents que votre conseiller vous demande (PDF, JPG ou PNG, 10 Mo au plus). Ils ne sont visibles que de votre conseiller.</p>
      {demandees.length === 0 && <div style={{ color: C.doux, fontSize: 14, marginBottom: 12 }}>Votre conseiller ne vous a pas demandé de pièce pour le moment.</div>}
      {demandees.map((p) => (
        <div className="pc-ligne" key={p.id} style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{p.label}</div>
            {deposeesPourPiece(p.id).map((x) => (
              <div key={x.id} style={{ fontSize: 13, color: (STATUT[x.statut] || [])[1] || C.doux, marginTop: 3 }}>
                {x.nom_fichier} — {(STATUT[x.statut] || [x.statut])[0]}{x.depose_le ? `, le ${dateFr(x.depose_le)}` : ""}{x.taille ? ` (${taille(x.taille)})` : ""}
                {x.statut === "refuse" && x.motif ? ` : ${x.motif}` : ""}
              </div>))}
            <Retour cle={p.id} />
          </div>
          <Bouton cle={p.id} pieceCle={p.id} libelle={p.label} texte={deposeesPourPiece(p.id).length ? "Déposer une autre version" : "Déposer"} />
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.bord}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Un autre document ?</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input className="pc-input" style={{ maxWidth: 320 }} placeholder="De quel document s'agit-il ?" value={autreLibelle} onChange={(e) => setAutreLibelle(e.target.value)} aria-label="Nature du document" />
          <Bouton cle="autre" pieceCle={null} libelle={autreLibelle} desactive={!autreLibelle.trim()} texte="Choisir le fichier" />
        </div>
        <Retour cle="autre" />
        {depots.filter((x) => !x.piece_cle).map((x) => <div key={x.id} style={{ fontSize: 13, color: (STATUT[x.statut] || [])[1] || C.doux, marginTop: 6 }}>{x.libelle} — {x.nom_fichier} — {(STATUT[x.statut] || [x.statut])[0]}{x.statut === "refuse" && x.motif ? ` : ${x.motif}` : ""}</div>)}
      </div>
    </div>
  );
}
