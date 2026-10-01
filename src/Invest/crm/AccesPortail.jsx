// src/Invest/crm/AccesPortail.jsx — « Accès au portail client » (fiche Client V2).
//
// Réservé aux administrateurs et aux commerciaux (même règle que la base et la fonction
// portail-inviter-client : l'écran ne fait que masquer ce qui serait refusé). Invite le
// client à son espace /espace-client, renvoie le lien, ou révoque l'accès. Rien n'est
// envoyé sans confirmation.
import React, { useCallback, useEffect, useState } from "react";
import { supabase, invoquerFonction } from "../../supabase";
import { Section, Discret, Pastille, dateFr, VERT, ORANGE, GRIS, ROUGE } from "./ui";

export const ROLES_GESTIONNAIRES = ["admin", "commercial"];

export default function AccesPortail({ T, client, profil }) {
  const [acces, setAcces] = useState(null); // null = chargement ; { erreur } ou { lignes }
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState("");
  const [erreur, setErreur] = useState("");
  const autorise = ROLES_GESTIONNAIRES.includes(profil?.role);

  const charger = useCallback(async () => {
    const r = await supabase.from("invest_portail_comptes").select("id,statut,invite_le,revoque_le").eq("client_id", client.id).order("invite_le", { ascending: false });
    setAcces(r.error ? { erreur: r.error.message } : { lignes: r.data || [] });
  }, [client.id]);
  useEffect(() => { if (autorise) charger(); }, [autorise, charger]);

  if (!autorise) return null;
  const email = String(client.email || "").trim();
  const actif = acces?.lignes?.find((l) => l.statut === "actif") || null;
  const revoque = !actif ? acces?.lignes?.find((l) => l.statut === "revoque") || null : null;

  const inviter = async () => {
    const renvoi = !!actif;
    const question = renvoi
      ? `Renvoyer un lien d'accès à ${email} ?\n\nLe client recevra un nouvel e-mail pour choisir son mot de passe.`
      : `Inviter ${email} à son espace client Profero Invest ?\n\nLe client recevra un e-mail avec un lien pour choisir son mot de passe. Il ne verra que ce que vous avez choisi de lui montrer (dossier, tâches, documents).`;
    if (!window.confirm(question)) return;
    setOccupe(true); setErreur(""); setMessage("");
    try {
      const r = await invoquerFonction("portail-inviter-client", { clientId: client.id });
      setMessage(r.renvoi ? `Nouveau lien envoyé à ${r.envoyeA}.` : `Invitation envoyée à ${r.envoyeA}.`);
    } catch (e) { setErreur(e.message); }
    setOccupe(false);
    charger();
  };

  const revoquer = async () => {
    if (!window.confirm(`Révoquer l'accès au portail de ce client ?\n\nIl sera déconnecté tout de suite et ne pourra plus se connecter. Vous pourrez l'inviter de nouveau plus tard.`)) return;
    setOccupe(true); setErreur(""); setMessage("");
    const r = await supabase.from("invest_portail_comptes")
      .update({ statut: "revoque", revoque_le: new Date().toISOString(), revoque_par: profil?.email || null })
      .eq("client_id", client.id).eq("statut", "actif").select("id");
    if (r.error) setErreur(r.error.message);
    else if (!r.data?.length) setErreur("Révocation refusée : droits insuffisants.");
    else setMessage("Accès révoqué.");
    setOccupe(false);
    charger();
  };

  return (
    <Section T={T} compact titre="Accès au portail client">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          {acces === null && <Discret T={T}>Chargement…</Discret>}
          {acces?.erreur && <Discret T={T} style={{ color: ROUGE }}>Statut illisible : {acces.erreur}</Discret>}
          {acces?.lignes && (actif
            ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Pastille couleur={VERT}>Accès ouvert</Pastille><Discret T={T}>Invité le {dateFr(actif.invite_le)} · {email}</Discret></div>
            : revoque
              ? <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Pastille couleur={ORANGE}>Accès révoqué</Pastille><Discret T={T}>Révoqué le {dateFr(revoque.revoque_le)}</Discret></div>
              : <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><Pastille couleur={GRIS}>Pas d'accès</Pastille><Discret T={T}>{email || "Aucune adresse e-mail sur la fiche : renseignez-la pour inviter le client."}</Discret></div>)}
        </div>
        {acces?.lignes && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe || !email} onClick={inviter}>{actif ? "Renvoyer le lien" : revoque ? "Inviter de nouveau" : "Inviter au portail"}</button>
            {actif && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={revoquer}>Révoquer l'accès</button>}
          </div>
        )}
      </div>
      {message && <Discret T={T} style={{ marginTop: 8, color: VERT }}>{message}</Discret>}
      {erreur && <Discret T={T} style={{ marginTop: 8, color: ROUGE }}>{erreur}</Discret>}
    </Section>
  );
}
