// src/Renovation/ProgbatClientChantier.jsx — Refonte Opérations, lot 4.
// Avant le devis : 1. le client ProGBat (recherche d'abord, choix explicite,
// création seulement si aucun ne correspond) ; 2. le chantier ProGBat.
// Toute la logique est côté serveur (Edge Function progbat-operations,
// module pur progbatAutomatisation.mjs). Ici : affichage, aperçu, confirmation.
// Le navigateur n'envoie jamais de corps ProGBat : seulement l'action, le
// chiffrage, la confirmation et l'empreinte de l'aperçu confirmé.
import React, { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { UserCircle, MapPin, Search, Check, AlertTriangle, ExternalLink, RefreshCw, Send, X } from "lucide-react";
import { lienProgbat } from "./progbatLiens.js";

export async function appelerProgbatOperations(body) {
  const { data, error } = await supabase.functions.invoke("progbat-operations", { body });
  if (data && !error) return data;
  let corps = null;
  try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps */ }
  if (corps && typeof corps === "object") return corps;
  return { ok: false, code: "transport", error: error?.message || "Appel de la fonction progbat-operations impossible (fonction non déployée ?)." };
}

const btnStyle = (T, acc, plein = false, off = false) => ({
  display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: RADIUS.md,
  border: plein ? "none" : `1px solid ${T.border}`, background: off ? T.border : plein ? acc.accent : "transparent",
  color: off ? T.textMuted : plein ? acc.onAccent : T.textSub, fontFamily: "inherit", fontSize: FONT.xs.size + 1,
  fontWeight: 700, cursor: off ? "not-allowed" : "pointer",
});

function Ecriture({ e, T, onLever, occupe }) {
  if (!e || e.statut === "created") return null;
  const couleur = e.statut === "uncertain" ? "#f5a623" : e.statut === "failed" ? "#e15a5a" : T.textMuted;
  return (
    <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: couleur, fontWeight: 600, lineHeight: 1.5 }}>
      {e.statut === "creating" && "Création en cours…"}
      {e.statut !== "creating" && (e.message || (e.statut === "uncertain" ? "Tentative précédente incertaine." : "Tentative précédente refusée."))}
      {e.statut === "uncertain" && onLever && (
        <div style={{ marginTop: 4 }}>
          <button onClick={onLever} disabled={occupe} style={{ ...btnStyle(T, {}, false, occupe), color: couleur }}>
            J'ai vérifié dans ProGBat : rien n'a été créé
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Props : projetId ; onEtat(etapes) appelé à chaque nouvel état ;
 * onChange() quand un identifiant ProGBat a été enregistré (recharger le chiffrage).
 */
export default function ProgbatClientChantier({ T, acc, projetId, onEtat, onChange }) {
  const [etat, setEtat] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [recherche, setRecherche] = useState(null);     // réponse chercher_clients
  const [apercu, setApercu] = useState(null);           // { cible, rep }
  const [message, setMessage] = useState(null);         // { ok, texte }

  const appliquer = (rep) => {
    if (rep?.etapes) { setEtat(rep); onEtat?.(rep.etapes); }
  };
  const charger = async () => {
    setErreur(null);
    const rep = await appelerProgbatOperations({ action: "etat", projectId: projetId });
    if (rep?.etapes) appliquer(rep); else { setErreur(rep?.error || "État ProGBat illisible."); onEtat?.(null); }
    if (rep?.report_projets) onChange?.();
  };
  useEffect(() => { if (projetId) charger(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projetId]);

  const lancer = async (body, { apres } = {}) => {
    setOccupe(true); setMessage(null);
    try {
      const rep = await appelerProgbatOperations({ projectId: projetId, ...body });
      appliquer(rep);
      setMessage({ ok: !!rep?.ok, texte: rep?.message || rep?.error || (rep?.ok ? "Fait." : "Échec."), aFaire: rep?.a_faire_par_loris || null });
      if (rep?.ok) apres?.(rep);
      if (rep?.ok && (rep.thirdId || rep.businessId || rep.yardId)) onChange?.();
      return rep;
    } finally { setOccupe(false); }
  };

  const chercher = async () => {
    setOccupe(true); setMessage(null); setApercu(null);
    const rep = await appelerProgbatOperations({ action: "chercher_clients", projectId: projetId });
    setOccupe(false);
    appliquer(rep);
    if (rep?.ok) setRecherche(rep); else setMessage({ ok: false, texte: rep?.error || "Recherche impossible." });
  };
  const choisir = async (m) => {
    if (!window.confirm(`Relier la fiche client à « ${m.nom || m.code} » (client ProGBat n° ${m.id}) ?\nRien n'est créé ni modifié dans ProGBat.`)) return;
    await lancer({ action: "lier_client", thirdId: m.id, confirmed: true }, { apres: () => setRecherche(null) });
  };
  const preparer = async (cible) => {
    setOccupe(true); setMessage(null);
    const rep = await appelerProgbatOperations({ action: cible === "client" ? "preparer_client" : "preparer_chantier", projectId: projetId });
    setOccupe(false);
    appliquer(rep);
    if (rep?.ok) setApercu({ cible, rep }); else setMessage({ ok: false, texte: rep?.error || "Aperçu impossible." });
  };
  const confirmer = async () => {
    if (!apercu) return;
    const { cible, rep } = apercu;
    const body = cible === "client"
      ? { action: "creer_client", confirmed: true, expectedHash: rep.hash, correspondancesEcartees: (recherche?.correspondances || []).map((m) => m.id) }
      : { action: "creer_chantier", confirmed: true, expectedHash: rep.hash };
    const r = await lancer(body);
    setApercu(null);
    if (r?.code === "correspondances_non_examinees") setRecherche((x) => ({ ...(x || {}), correspondances: r.correspondances || [] }));
  };

  const e = etat?.etapes;
  const carte = (titre, icone, contenu) => (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: FONT.xs.size, fontWeight: 700, letterSpacing: .8, textTransform: "uppercase", color: T.textMuted, marginBottom: 6 }}>
        <Icon as={icone} size={11} />{titre}
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.text, lineHeight: 1.55 }}>{contenu}</div>
    </div>
  );
  const fait = (texte) => <div style={{ color: "#22c55e", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><Icon as={Check} size={12} />{texte}</div>;
  const lien = (l) => l?.url ? <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.titre} style={{ ...btnStyle(T, acc), textDecoration: "none", marginTop: 6 }}><Icon as={ExternalLink} size={11} />{l.repli ? l.libelle : "Ouvrir dans ProGBat"}</a> : null;

  if (erreur) return <div style={{ marginBottom: 12, fontSize: FONT.xs.size + 1, color: "#e15a5a", fontWeight: 600 }}>Client et chantier ProGBat : {erreur}</div>;
  if (!e) return <div style={{ marginBottom: 12, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Client et chantier ProGBat : lecture…</div>;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text, marginBottom: 8 }}>Avant le devis : client et chantier dans ProGBat</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
        {carte("1. Client ProGBat", UserCircle, (
          <>
            {e.client.fait ? fait(`Client ProGBat n° ${e.client.thirdId}`) : e.client.prerequis ? <div style={{ color: "#f5a623", fontWeight: 600 }}>{e.client.prerequis}</div> : (
              <>
                <div style={{ color: T.textMuted }}>Identifiant généré : <b>{etat.generes?.code_client || "—"}</b>. On cherche d'abord parmi les clients ProGBat existants ; rien n'est rattaché ni créé sans votre choix.</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <button onClick={chercher} disabled={occupe} style={btnStyle(T, acc, !recherche, occupe)}><Icon as={Search} size={11} />Chercher dans ProGBat</button>
                </div>
                {recherche && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontWeight: 700 }}>{recherche.correspondances?.length ? `${recherche.correspondances.length} client(s) ProGBat peut-être identique(s) (sur ${recherche.nb_lus ?? "?"} lus) :` : `Aucun client ProGBat ne correspond (${recherche.nb_lus ?? "?"} lus).`}</div>
                    {(recherche.correspondances || []).map((m) => (
                      <div key={m.id} style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 8px", marginTop: 6 }}>
                        <div style={{ fontWeight: 700 }}>{m.nom || m.code} <span style={{ color: T.textMuted, fontWeight: 500 }}>· n° {m.id} · {m.type_libelle}</span></div>
                        <div style={{ color: T.textMuted }}>{[m.code, [m.adresse, m.code_postal, m.ville].filter(Boolean).join(" "), m.email, m.telephone].filter(Boolean).join(" · ")}</div>
                        <div style={{ color: "#4db8ff" }}>{m.raisons.join(" · ")}</div>
                        <button onClick={() => choisir(m)} disabled={occupe} style={{ ...btnStyle(T, acc, false, occupe), marginTop: 4 }}><Icon as={Check} size={11} />Choisir ce client</button>
                      </div>
                    ))}
                    <button onClick={() => preparer("client")} disabled={occupe} style={{ ...btnStyle(T, acc, false, occupe), marginTop: 8 }}>
                      {recherche.correspondances?.length ? "Aucun ne correspond : créer un nouveau client dans ProGBat" : "Créer le client dans ProGBat"}
                    </button>
                  </div>
                )}
              </>
            )}
            <Ecriture e={e.client.ecriture} T={T} occupe={occupe} onLever={() => window.confirm("Vous confirmez avoir vérifié dans ProGBat qu'AUCUN client n'a été créé par la tentative précédente ?") && lancer({ action: "verifier_ecriture", cible: "client", confirmed: true })} />
          </>
        ))}
        {carte("2. Chantier ProGBat", MapPin, (
          <>
            {e.chantier.fait ? (
              <>
                {fait(`Chantier ProGBat n° ${e.chantier.businessId}${e.chantier.code ? ` (${e.chantier.code})` : ""}`)}
                {e.chantier.alerte && <div style={{ color: "#f5a623", fontWeight: 600, marginTop: 4 }}>{e.chantier.alerte}</div>}
                {e.chantier.yardId == null && <button onClick={() => lancer({ action: "relire_chantier" })} disabled={occupe} style={{ ...btnStyle(T, acc, false, occupe), marginTop: 6 }}><Icon as={RefreshCw} size={11} />Relire le chantier ProGBat</button>}
                {lien(lienProgbat("chantier", e.chantier.businessId))}
              </>
            ) : e.chantier.prerequis ? <div style={{ color: T.textMuted }}>{e.chantier.prerequis}</div> : (
              <>
                <div style={{ color: T.textMuted }}>Nom : <b>{etat.generes?.nom_chantier || "—"}</b> · code : <b>{etat.generes?.code_chantier || "—"}</b>.</div>
                {e.chantier.sans_responsable && <div style={{ color: "#f5a623", fontWeight: 600, marginTop: 4 }}>Chargé d'affaires sans correspondance ProGBat : le chantier sera créé sans responsable (Réglages → Outils → ProGBat : chargés d'affaires).</div>}
                <button onClick={() => preparer("chantier")} disabled={occupe} style={{ ...btnStyle(T, acc, true, occupe), marginTop: 6 }}>Créer le chantier dans ProGBat</button>
              </>
            )}
            <Ecriture e={e.chantier.ecriture} T={T} occupe={occupe} onLever={() => window.confirm("Vous confirmez avoir vérifié dans ProGBat qu'AUCUN chantier n'a été créé par la tentative précédente ?") && lancer({ action: "verifier_ecriture", cible: "chantier", confirmed: true })} />
          </>
        ))}
      </div>

      {message && (
        <div style={{ marginTop: 8, fontSize: FONT.xs.size + 1, fontWeight: 700, color: message.ok ? "#22c55e" : "#e15a5a", display: "flex", alignItems: "flex-start", gap: 6 }}>
          <Icon as={message.ok ? Check : AlertTriangle} size={12} />
          <span>{message.texte}{message.aFaire ? ` — À faire par Loris : ${message.aFaire}.` : ""}</span>
        </div>
      )}

      {apercu && (
        <div style={{ marginTop: 10, border: `2px solid ${acc.accent}`, borderRadius: RADIUS.lg, padding: "10px 12px", background: T.card }}>
          <div style={{ fontWeight: 800, color: T.text, fontSize: FONT.sm.size }}>
            {apercu.cible === "client" ? "Créer ce client dans ProGBat ?" : "Créer ce chantier dans ProGBat ?"}
          </div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "4px 0 6px" }}>
            Écriture dans la comptabilité ProGBat ({apercu.rep.endpoint}, droit {apercu.rep.droit}). Une seule création possible : un nouvel essai est bloqué tant que celle-ci n'est pas terminée ou vérifiée.
          </div>
          {apercu.rep.info && <div style={{ fontSize: FONT.xs.size + 1, color: "#f5a623", fontWeight: 600, marginBottom: 6 }}>{apercu.rep.info}</div>}
          <pre style={{ margin: 0, fontSize: 11, background: T.bg || "transparent", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: 8, whiteSpace: "pre-wrap", color: T.text, maxHeight: 220, overflow: "auto" }}>{JSON.stringify(apercu.rep.corps, null, 2)}</pre>
          {apercu.rep.erreurs?.length > 0 && <div style={{ color: "#e15a5a", fontWeight: 700, fontSize: FONT.xs.size + 1, marginTop: 6 }}>Impossible : {apercu.rep.erreurs.join(" ; ")}</div>}
          {apercu.rep.blocage && <div style={{ color: "#e15a5a", fontWeight: 700, fontSize: FONT.xs.size + 1, marginTop: 6 }}>{apercu.rep.blocage.message}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => setApercu(null)} disabled={occupe} style={btnStyle(T, acc)}><Icon as={X} size={11} />Annuler</button>
            <button onClick={confirmer} disabled={occupe || apercu.rep.erreurs?.length > 0 || !!apercu.rep.blocage} style={btnStyle(T, acc, true, occupe || apercu.rep.erreurs?.length > 0 || !!apercu.rep.blocage)}>
              <Icon as={occupe ? RefreshCw : Send} size={11} />{occupe ? "Création en cours…" : "Confirmer la création dans ProGBat"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
