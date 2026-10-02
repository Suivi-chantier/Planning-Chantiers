// src/Invest/dossiers/DocumentsMission.jsx — onglet Documents de la fiche Mission.
//
// Deux parties : les PIÈCES attendues du client (statut, fichier) et les DOCUMENTS produits par Profero
// (lettre de mission, rapport de restitution…), partageables avec le client. Les calculs viennent de
// piecesMission.mjs ; les données de invest_dossier_pieces (liste préparée par la base).
// Rien n'est jamais déposé, partagé ou supprimé sans geste explicite ; le client n'a aucun droit ici.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import {
  CATEGORIES_PIECES, CATEGORIES_DOCUMENTS, statutsDe, libelleStatut, avancementPieces, piecesParCategorie, documentsProfero,
  patchStatutPiece, statutApresDepot, statutApresRetraitFichier, cheminFichier, etatRestitution,
} from "./piecesMission";

const BUCKET = "invest-documents";
const MAX_OCTETS = 50 * 1024 * 1024;
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const VERT = "#16a34a", ORANGE = "#d97706", ROUGE = "#dc2626";

function Carte({ T, titre, droite, children }) {
  return (
    <section style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: T.shadowSm, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted }}>{titre}</div>{droite}
      </div>{children}
    </section>
  );
}

export default function DocumentsMission({ T, client, dossier, profil, modifiable, onRestitution }) {
  const [etat, setEtat] = useState(null);       // null = chargement ; { erreur } ou { lignes, partages }
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [ajout, setAjout] = useState(null);     // { genre, categorie, libelle }
  const fichierRef = useRef(null);
  const cibleRef = useRef(null);
  const auteur = profil?.nom || profil?.email || null;

  const charger = useCallback(async () => {
    const [rp, rs] = await Promise.all([
      supabase.from("invest_dossier_pieces").select("*").eq("dossier_id", dossier.id).order("created_at", { ascending: true }),
      supabase.from("invest_documents_partages").select("id,chemin,statut").eq("client_id", client.id),
    ]);
    if (rp.error) { setEtat({ erreur: rp.error.message }); return; }
    setEtat({ lignes: rp.data || [], partages: Object.fromEntries((rs.data || []).map((x) => [x.chemin, { id: x.id, statut: x.statut }])), partagesIllisibles: !!rs.error });
  }, [dossier.id, client.id]);
  useEffect(() => { charger(); }, [charger]);

  const agir = async (fn) => {
    setOccupe(true); setErreur(""); setMessage("");
    try { await fn(); } catch (e) { setErreur(e.message || String(e)); }
    setOccupe(false);
    await charger();
  };
  const ecrire = async (id, patch) => {
    const r = await supabase.from("invest_dossier_pieces").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (r.error) throw new Error(r.error.message);
    if (!r.data?.length) throw new Error("Modification refusée : droits insuffisants.");
  };
  const retirerPartage = async (chemin) => {
    const p = etat?.partages?.[chemin];
    if (p?.statut === "partage") await supabase.from("invest_documents_partages").update({ statut: "retire", retire_le: new Date().toISOString() }).eq("id", p.id);
  };

  const preparer = () => agir(async () => {
    const r = await supabase.rpc("invest_dossier_pieces_preparer", { p_dossier_id: dossier.id });
    if (r.error) throw new Error(r.error.message);
    setMessage(r.data > 0 ? `${r.data} élément${r.data > 1 ? "s" : ""} ajouté${r.data > 1 ? "s" : ""} à la liste.` : "La liste standard est déjà complète.");
  });
  const changerStatut = (p, statut) => agir(() => ecrire(p.id, patchStatutPiece(p, statut, aujourdhui(), auteur)));

  const choisirFichier = (p) => { cibleRef.current = p; fichierRef.current?.click(); };
  const deposer = (ev) => {
    const f = ev.target.files?.[0]; const p = cibleRef.current; ev.target.value = "";
    if (!f || !p) return;
    if (f.size > MAX_OCTETS) { setErreur(`${f.name} dépasse 50 Mo.`); return; }
    agir(async () => {
      const chemin = cheminFichier(client.id, dossier.id, p.genre, f.name, Date.now());
      const up = await supabase.storage.from(BUCKET).upload(chemin, f, { upsert: false });
      if (up.error) throw new Error(`Dépôt impossible : ${up.error.message}`);
      const nouveau = statutApresDepot(p);
      try { await ecrire(p.id, { chemin, nom_fichier: f.name, ...(nouveau !== p.statut ? patchStatutPiece(p, nouveau, aujourdhui(), auteur) : {}) }); }
      catch (e) { await supabase.storage.from(BUCKET).remove([chemin]); throw e; }   // pas de fichier orphelin
      if (p.chemin) { await retirerPartage(p.chemin); await supabase.storage.from(BUCKET).remove([p.chemin]); }
      setMessage(`« ${p.libelle} » : fichier déposé.`);
    });
  };
  const telecharger = async (p) => {
    const r = await supabase.storage.from(BUCKET).createSignedUrl(p.chemin, 300);
    if (r.error || !r.data?.signedUrl) { setErreur("Impossible de générer le lien."); return; }
    window.open(r.data.signedUrl, "_blank");
  };
  const retirerFichier = (p) => {
    if (!window.confirm(`Retirer le fichier de « ${p.libelle} » ?`)) return;
    agir(async () => {
      await retirerPartage(p.chemin);
      await supabase.storage.from(BUCKET).remove([p.chemin]);
      await ecrire(p.id, { chemin: null, nom_fichier: null, statut: statutApresRetraitFichier(p) });
    });
  };
  const supprimerLigne = (p) => {
    if (!window.confirm(`Supprimer « ${p.libelle} » de la liste${p.chemin ? " et son fichier" : ""} ?`)) return;
    agir(async () => {
      if (p.chemin) { await retirerPartage(p.chemin); await supabase.storage.from(BUCKET).remove([p.chemin]); }
      const r = await supabase.from("invest_dossier_pieces").delete().eq("id", p.id).select("id");
      if (r.error) throw new Error(r.error.message);
      if (!r.data?.length) throw new Error("Suppression refusée : droits insuffisants.");
    });
  };
  const basculerPartage = (p) => {
    const existant = etat.partages[p.chemin]; const actif = existant?.statut === "partage";
    if (!actif && !window.confirm(`Partager « ${p.libelle} » avec le client ?\n\nIl pourra le télécharger depuis son espace client (si cette mission lui est montrée). Vous pourrez le retirer à tout moment.`)) return;
    agir(async () => {
      let r;
      if (existant) r = await supabase.from("invest_documents_partages").update(actif ? { statut: "retire", retire_le: new Date().toISOString() } : { statut: "partage", retire_le: null, partage_le: new Date().toISOString(), dossier_id: dossier.id }).eq("id", existant.id).select("id");
      else r = await supabase.from("invest_documents_partages").insert({ client_id: client.id, dossier_id: dossier.id, chemin: p.chemin, libelle: p.libelle, partage_par: profil?.email || null }).select("id");
      if (r.error) throw new Error(`Partage : ${r.error.message}`);
      if (!r.data?.length) throw new Error("Partage refusé : droits insuffisants.");
    });
  };
  const ajouter = () => agir(async () => {
    const a = ajout; if (!a || !a.libelle.trim()) throw new Error("Indiquez un intitulé.");
    const r = await supabase.from("invest_dossier_pieces").insert({ dossier_id: dossier.id, client_id: client.id, genre: a.genre, categorie: a.categorie, libelle: a.libelle.trim(),
      statut: a.genre === "document_profero" ? "a_produire" : "a_demander", created_by: auteur }).select("id");
    if (r.error) throw new Error(/duplicate|unique/i.test(r.error.message) ? "Cet intitulé existe déjà dans la liste." : r.error.message);
    setAjout(null);
  });

  const bord = T.rowBorder || T.border;
  const fichier = (p) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
      {p.chemin ? (
        <>
          <button type="button" onClick={() => telecharger(p)} title="Télécharger / ouvrir" style={{ border: 0, background: "none", cursor: "pointer", color: T.accent, fontWeight: 800, fontSize: 12.5, padding: 0, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⬇ {p.nom_fichier || "Fichier"}</button>
          {modifiable && <button type="button" className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => choisirFichier(p)}>Remplacer</button>}
          {modifiable && <button type="button" className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => retirerFichier(p)} title="Retirer le fichier">✕</button>}
        </>
      ) : modifiable ? <button type="button" className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => choisirFichier(p)}>Déposer</button> : <span style={{ color: T.textMuted, fontSize: 12.5 }}>—</span>}
    </div>
  );
  const selectStatut = (p) => (
    <select className="inv-sel" value={p.statut} disabled={!modifiable || occupe} onChange={(e) => changerStatut(p, e.target.value)} aria-label={`Statut de ${p.libelle}`} style={{ fontSize: 12, padding: "3px 6px", minWidth: 0 }}>
      {Object.entries(statutsDe(p.genre)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      {!statutsDe(p.genre)[p.statut] && <option value={p.statut}>{libelleStatut(p.genre, p.statut)}</option>}
    </select>
  );
  const formAjout = (genre) => ajout?.genre === genre && (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "10px 0 2px", padding: 8, border: `1px dashed ${T.border}`, borderRadius: 10 }}>
      <select className="inv-sel" value={ajout.categorie} onChange={(e) => setAjout((a) => ({ ...a, categorie: e.target.value, libelle: genre === "document_profero" && (!a.libelle || CATEGORIES_DOCUMENTS.some(([, l]) => l === a.libelle)) ? (CATEGORIES_DOCUMENTS.find(([k]) => k === e.target.value)?.[1] ?? "") : a.libelle }))} aria-label="Catégorie">
        {(genre === "document_profero" ? CATEGORIES_DOCUMENTS : CATEGORIES_PIECES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="inv-inp" style={{ textAlign: "left", flex: "1 1 240px" }} placeholder={genre === "document_profero" ? "Intitulé du document" : "Intitulé de la pièce"} value={ajout.libelle} onChange={(e) => setAjout((a) => ({ ...a, libelle: e.target.value }))} aria-label="Intitulé" />
      <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={ajouter}>Ajouter</button>
      <button className="inv-btn inv-btn-sm" onClick={() => setAjout(null)}>Annuler</button>
    </div>
  );

  if (!etat) return <Carte T={T} titre="Documents"><div style={{ fontSize: 13, color: T.textMuted }}>Chargement des documents…</div></Carte>;
  if (etat.erreur) return <Carte T={T} titre="Documents"><div style={{ fontSize: 13, color: ROUGE }}>Documents illisibles : {etat.erreur}</div></Carte>;

  const { lignes, partages } = etat;
  const av = avancementPieces(lignes), docs = documentsProfero(lignes), groupes = piecesParCategorie(lignes);
  const rest = etatRestitution(dossier, lignes);
  const grille = "minmax(0,2fr) 128px minmax(0,2fr) 84px";

  if (lignes.length === 0) {
    return (
      <Carte T={T} titre="Documents de la mission">
        <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Aucune pièce suivie pour cette mission</div>
        <div style={{ fontSize: 12.5, color: T.textMuted, margin: "4px 0 12px" }}>La liste standard prépare les pièces à demander au client{dossier.type_mission === "audit_patrimonial" ? ", le rapport de restitution" : ""} et la lettre de mission. Vous pourrez ensuite l'adapter.</div>
        {modifiable ? <button className="inv-btn inv-btn-blue" disabled={occupe} onClick={preparer}>Préparer la liste standard</button> : <div style={{ fontSize: 12.5, color: T.textMuted }}>Mission close : consultation seule.</div>}
        {erreur && <div style={{ fontSize: 12.5, color: ROUGE, marginTop: 8 }}>{erreur}</div>}
      </Carte>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <input ref={fichierRef} type="file" style={{ display: "none" }} onChange={deposer} />
      {message && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: T.accentBg, color: T.text }}>{message}</div>}
      {erreur && <div style={{ fontSize: 12.5, color: ROUGE }}>{erreur}</div>}
      {etat.partagesIllisibles && <div style={{ fontSize: 12, color: ORANGE }}>État du partage client illisible : les boutons « Partager » peuvent être inexacts.</div>}

      <Carte T={T} titre="Pièces du client" droite={
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: T.textSub }}>
          <span><b style={{ color: T.text }}>{av.recues}</b> / {av.total} reçues{av.manquantesObligatoires > 0 && <span style={{ color: ORANGE, fontWeight: 800 }}> · {av.manquantesObligatoires} obligatoire{av.manquantesObligatoires > 1 ? "s" : ""} manquante{av.manquantesObligatoires > 1 ? "s" : ""}</span>}</span>
          {av.pourcentage !== null && <span style={{ width: 90, height: 6, borderRadius: 99, background: T.border, overflow: "hidden" }} aria-label={`${av.pourcentage} % reçues`}><span style={{ display: "block", width: `${av.pourcentage}%`, height: "100%", background: VERT }} /></span>}
          {modifiable && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => setAjout({ genre: "piece_client", categorie: "autre", libelle: "" })}>＋ Ajouter une pièce</button>}
          {modifiable && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={preparer} title="Ajoute ce qui manque à la liste standard, sans rien écraser">Compléter la liste standard</button>}
        </div>}>
        {formAjout("piece_client")}
        {groupes.map((g) => (
          <div key={g.cle} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: T.textSub, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>{g.libelle}</div>
            {g.pieces.map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: grille, gap: 10, alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${bord}`, fontSize: 13 }}>
                <div style={{ minWidth: 0, color: T.text, fontWeight: 600 }}>{p.libelle}{p.obligatoire && <span title="Pièce obligatoire" style={{ color: ORANGE, fontWeight: 900 }}> *</span>}</div>
                {selectStatut(p)}
                {fichier(p)}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, fontSize: 11.5, color: T.textMuted }}>
                  <span title={p.valide_le ? `Validée le ${dateFr(p.valide_le)}${p.valide_par ? ` par ${p.valide_par}` : ""}` : ""}>{p.recu_le ? dateFr(p.recu_le).slice(0, 5) : ""}</span>
                  {modifiable && <button type="button" onClick={() => supprimerLigne(p)} disabled={occupe} title="Supprimer cette ligne" style={{ border: 0, background: "none", cursor: "pointer", color: T.textMuted, fontSize: 13 }}>🗑</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Carte>

      <Carte T={T} titre="Documents Profero" droite={modifiable && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => setAjout({ genre: "document_profero", categorie: "autre", libelle: "" })}>＋ Ajouter un document</button>}>
        {formAjout("document_profero")}
        {docs.length === 0 && <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucun document Profero dans la liste.</div>}
        {docs.map((p) => {
          const partage = partages[p.chemin]?.statut === "partage";
          const estRapport = p.categorie === "rapport_restitution";
          return (
            <div key={p.id} style={{ borderBottom: `1px solid ${bord}`, padding: "6px 0" }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) 128px minmax(0,2fr) 150px", gap: 10, alignItems: "center", fontSize: 13 }}>
                <div style={{ minWidth: 0, color: T.text, fontWeight: 600 }}>{p.libelle}{p.obligatoire && <span title="Document obligatoire" style={{ color: ORANGE, fontWeight: 900 }}> *</span>}</div>
                {selectStatut(p)}
                {fichier(p)}
                <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                  {modifiable && p.chemin && <button type="button" className="inv-btn inv-btn-sm" disabled={occupe} onClick={() => basculerPartage(p)} aria-pressed={partage}
                    title={partage ? "Partagé avec le client. Cliquer pour le retirer." : "Non partagé. Cliquer pour le partager avec le client."}
                    style={partage ? { background: "#dcfce7", border: "1px solid #86efac", color: "#166534" } : undefined}>{partage ? "👁 Partagé client" : "Partager"}</button>}
                  {!modifiable && partage && <span style={{ fontSize: 11.5, color: VERT, fontWeight: 800 }}>Partagé client</span>}
                  {modifiable && <button type="button" onClick={() => supprimerLigne(p)} disabled={occupe} title="Supprimer cette ligne" style={{ border: 0, background: "none", cursor: "pointer", color: T.textMuted, fontSize: 13 }}>🗑</button>}
                </div>
              </div>
              {estRapport && (
                <div style={{ marginTop: 4, fontSize: 12, color: T.textSub, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {rest.dateEnregistree ? <span>Restitution enregistrée le <b style={{ color: T.text }}>{dateFr(rest.dateEnregistree)}</b>.</span>
                    : rest.depose ? <span style={{ color: ORANGE, fontWeight: 700 }}>Rapport déposé : la date de restitution n'est pas encore enregistrée.</span>
                    : <span>La date de restitution s'enregistre dans le parcours (jalon « Rapport & restitution »).</span>}
                  {rest.proposerDate && modifiable && onRestitution && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={onRestitution}>Enregistrer la date de restitution</button>}
                </div>
              )}
            </div>
          );
        })}
      </Carte>
    </div>
  );
}
