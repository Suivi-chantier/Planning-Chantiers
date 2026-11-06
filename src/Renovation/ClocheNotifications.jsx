// src/Renovation/ClocheNotifications.jsx — la cloche de la navigation bureau
// et la liste des notifications reçues (projet notifications-push, tâche 3).
//
//  - useBoiteNotifications : compteur de non lues et liste, lus via l'Edge
//    Function notifications-boite avec le jeton de l'utilisateur (les tables
//    sont fermées au navigateur : pas de Realtime). Rafraîchi à l'ouverture,
//    au retour au premier plan et toutes les minutes environ.
//  - BoutonCloche : l'icône et son compteur. Si la boîte ne répond pas, la
//    cloche porte un « ! » orange, jamais un « 0 » : une erreur ne ressemble
//    jamais à « aucune notification » (invariant CLAUDE.md).
//  - PanneauBoite : la liste (titre, texte, date, lu / non lu), « Tout
//    marquer comme lu ». Toucher une notification la marque comme lue et
//    ouvre son écran (le lien est traduit par lienVersNavigation, sans jamais
//    recharger la page).
//
// Jamais rendu pour le rôle « ouvrier » ni dans l'espace ouvrier (App.jsx).

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X, Check, RefreshCw } from "lucide-react";
import { Icon } from "../ui";
import { appelerFonction } from "./ProfilNotifications";

const FONCTION_BOITE = "notifications-boite";
const PERIODE_MS = 60_000;

/** État de la boîte de l'utilisateur connecté. `actif` = false → rien n'est appelé. */
export function useBoiteNotifications(actif) {
  // etat : "chargement" (rien encore) | "ok" | "erreur"
  const [etat, setEtat] = useState("chargement");
  const [nonLues, setNonLues] = useState(null);
  const [notifications, setNotifications] = useState(null); // null = liste pas encore lue
  const [erreur, setErreur] = useState(null);
  const [listeEnCours, setListeEnCours] = useState(false);
  const ouverteRef = useRef(false);

  const rafraichirCompteur = useCallback(async () => {
    if (!actif) return;
    try {
      const rep = await appelerFonction(`${FONCTION_BOITE}?vue=compteur`, { method: "GET" });
      if (typeof rep?.non_lues !== "number") throw new Error("Réponse illisible du serveur.");
      setNonLues(rep.non_lues); setEtat("ok"); setErreur(null);
    } catch (e) {
      setErreur(e.message); setEtat("erreur");
    }
  }, [actif]);

  const chargerListe = useCallback(async () => {
    if (!actif) return;
    setListeEnCours(true);
    try {
      const rep = await appelerFonction(FONCTION_BOITE, { method: "GET" });
      if (!Array.isArray(rep?.notifications) || typeof rep?.non_lues !== "number") throw new Error("Réponse illisible du serveur.");
      setNotifications(rep.notifications); setNonLues(rep.non_lues); setEtat("ok"); setErreur(null);
    } catch (e) {
      setErreur(e.message); setEtat("erreur");
    } finally {
      setListeEnCours(false);
    }
  }, [actif]);

  const rafraichir = useCallback(() => (ouverteRef.current ? chargerListe() : rafraichirCompteur()), [chargerListe, rafraichirCompteur]);

  useEffect(() => {
    if (!actif) return undefined;
    rafraichirCompteur();
    const minuterie = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") rafraichir();
    }, PERIODE_MS);
    const surVisible = () => { if (document.visibilityState === "visible") rafraichir(); };
    document.addEventListener("visibilitychange", surVisible);
    return () => { clearInterval(minuterie); document.removeEventListener("visibilitychange", surVisible); };
  }, [actif, rafraichir, rafraichirCompteur]);

  const marquerLu = useCallback(async (id) => {
    const rep = await appelerFonction(FONCTION_BOITE, { method: "POST", body: { action: "marquer_lu", id } });
    const maintenant = new Date().toISOString();
    setNotifications((l) => (l ? l.map((n) => (n.id === id && !n.lu_le ? { ...n, lu_le: maintenant } : n)) : l));
    if (typeof rep?.non_lues === "number") setNonLues(rep.non_lues);
  }, []);

  const toutMarquerLu = useCallback(async () => {
    await appelerFonction(FONCTION_BOITE, { method: "POST", body: { action: "tout_marquer_lu" } });
    const maintenant = new Date().toISOString();
    setNotifications((l) => (l ? l.map((n) => (n.lu_le ? n : { ...n, lu_le: maintenant })) : l));
    setNonLues(0);
  }, []);

  const signalerOuverture = useCallback((ouverte) => {
    ouverteRef.current = ouverte;
    if (ouverte) chargerListe();
  }, [chargerListe]);

  return { etat, nonLues, notifications, erreur, listeEnCours, rafraichir, chargerListe, marquerLu, toutMarquerLu, signalerOuverture };
}

/** L'icône cloche et son compteur. `variante` : "barre" (barre latérale) | "haut" (barre du haut, mobile). */
export function BoutonCloche({ boite, onOuvrir, T, variante = "haut", style }) {
  const enErreur = boite.etat === "erreur";
  const n = boite.nonLues;
  const titre = enErreur
    ? "Notifications : boîte de réception injoignable"
    : boite.etat === "chargement" ? "Notifications : lecture en cours"
      : n > 0 ? `Notifications : ${n} non lue${n > 1 ? "s" : ""}` : "Notifications : tout est lu";
  const couleur = variante === "barre" ? "rgba(255,255,255,0.55)" : T.text;
  return (
    <button type="button" onClick={onOuvrir} title={titre} aria-label={titre}
      className={variante === "haut" ? "btn-g topbar-cloche-btn" : undefined}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
        ...(variante === "barre"
          ? { width: 32, height: 32, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", color: couleur, flexShrink: 0 }
          : { padding: "6px 10px" }),
        ...style,
      }}>
      <Icon as={Bell} size={16}/>
      {enErreur ? (
        <span aria-hidden="true" style={pastille("#f59e0b")}>!</span>
      ) : n > 0 ? (
        <span aria-hidden="true" style={pastille("#ef4444")}>{n > 99 ? "99+" : n}</span>
      ) : null}
    </button>
  );
}

function pastille(fond) {
  return {
    position: "absolute", top: -2, right: -4, minWidth: 16, height: 16, padding: "0 4px",
    borderRadius: 8, background: fond, color: "#fff", fontSize: 10, fontWeight: 800,
    lineHeight: "16px", textAlign: "center", boxSizing: "border-box", pointerEvents: "none",
  };
}

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});
function dateLisible(iso) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? FORMAT_DATE.format(d) : "date inconnue";
}

/** Liste des notifications (panneau). */
export function PanneauBoite({ boite, T, onClose, onNaviguer }) {
  const [message, setMessage] = useState(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    boite.signalerOuverture(true);
    const echap = (ev) => { if (ev.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", echap);
    return () => { boite.signalerOuverture(false); document.removeEventListener("keydown", echap); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ouvrir = async (n) => {
    setMessage(null);
    if (!n.lu_le) {
      try { await boite.marquerLu(n.id); } catch (e) { setMessage(`Lecture non enregistrée : ${e.message}`); }
    }
    onNaviguer?.(n.lien || "/");
    onClose?.();
  };

  const toutLire = async () => {
    setMessage(null); setOccupe(true);
    try { await boite.toutMarquerLu(); } catch (e) { setMessage(`Impossible de tout marquer comme lu : ${e.message}`); }
    finally { setOccupe(false); }
  };

  const liste = boite.notifications;
  const enErreur = boite.etat === "erreur";
  const nonLues = (liste || []).filter((n) => !n.lu_le).length;

  return (
    <div role="dialog" aria-modal="true" aria-label="Notifications" onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "max(16px, env(safe-area-inset-top)) 12px 16px", overflowY: "auto",
    }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{
        width: "100%", maxWidth: 520, background: T.modal, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 14, padding: 16,
        display: "flex", flexDirection: "column", gap: 12, marginTop: 24,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon as={Bell} size={18} color={T.accent}/>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>Notifications</div>
          <button type="button" onClick={() => boite.chargerListe()} disabled={boite.listeEnCours} title="Actualiser" aria-label="Actualiser"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, color: T.textSub, display: "flex" }}>
            <Icon as={RefreshCw} size={18}/>
          </button>
          <button type="button" onClick={onClose} title="Fermer" aria-label="Fermer"
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 6, color: T.textSub, display: "flex" }}>
            <Icon as={X} size={20}/>
          </button>
        </div>

        {enErreur && (
          <div role="alert" style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.12)", borderRadius: 10, padding: "10px 12px", fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: "#f59e0b" }}>La boîte de réception ne répond pas.</strong>{" "}
            {liste ? "La liste ci-dessous peut ne pas être à jour." : "Impossible de savoir si vous avez des notifications."}
            {boite.erreur ? ` (${boite.erreur})` : ""}
          </div>
        )}

        {liste === null && !enErreur && (
          <div style={{ fontSize: 13, color: T.textMuted, padding: "8px 0" }}>Lecture des notifications…</div>
        )}

        {liste && liste.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={toutLire} disabled={occupe || nonLues === 0} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 8,
              border: `1px solid ${T.border}`, background: "transparent", color: nonLues ? T.text : T.textMuted,
              fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: occupe || nonLues === 0 ? "default" : "pointer", minHeight: 40,
            }}>
              <Icon as={Check} size={15}/> Tout marquer comme lu
            </button>
          </div>
        )}

        {liste && liste.length === 0 && !enErreur && (
          <div style={{ fontSize: 13, color: T.textSub, border: `1px dashed ${T.border}`, borderRadius: 10, padding: "14px 12px", textAlign: "center" }}>
            Aucune notification reçue pour l'instant.
          </div>
        )}

        {liste && liste.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {liste.map((n, i) => {
              const lue = !!n.lu_le;
              return (
                <button key={n.id} type="button" onClick={() => ouvrir(n)} style={{
                  display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", width: "100%",
                  padding: "10px 12px", border: "none", borderTop: i ? `1px solid ${T.border}` : "none",
                  background: lue ? "transparent" : "rgba(255,194,0,0.07)", color: T.text,
                  fontFamily: "inherit", cursor: "pointer",
                }}>
                  <span aria-hidden="true" style={{
                    width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                    background: lue ? "transparent" : "#FFC200", border: lue ? `1px solid ${T.border}` : "none",
                  }}/>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: lue ? 500 : 700 }}>{n.titre}</span>
                    {n.texte && <span style={{ fontSize: 13, lineHeight: 1.45, color: T.textSub, whiteSpace: "pre-line" }}>{n.texte}</span>}
                    <span style={{ fontSize: 11, color: T.textMuted }}>
                      {dateLisible(n.created_at)} · {lue ? "lue" : "non lue"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {message && (
          <div role="alert" style={{ borderLeft: "3px solid #ef4444", padding: "6px 10px", fontSize: 13, lineHeight: 1.5, background: "rgba(239,68,68,0.10)", borderRadius: 4 }}>{message}</div>
        )}
      </div>
    </div>
  );
}
