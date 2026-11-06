// src/Renovation/ProfilNotifications.jsx — « Mon profil » et le bloc
// « Notifications sur ce téléphone » (projet notifications-push, tâche 1).
//
// L'espace bureau n'avait pas d'écran profil : « Mon profil » est un panneau
// qui s'ouvre depuis le nom de l'utilisateur (barre latérale) ou depuis le
// bouton téléphone de la barre du haut (mobile). Ce n'est PAS une page : il
// n'est pas enregistré dans src/access.js et ne change aucun droit d'accès.
//
// Règles du projet appliquées ici :
//  - rôles bureau seulement : rien pour « ouvrier » (et ce composant n'est
//    jamais rendu dans l'espace ouvrier) ;
//  - aucune demande d'autorisation au chargement : seulement au clic sur
//    « Activer les notifications » ;
//  - état réel et distinct (activées / refusées / non prises en charge /
//    iPhone à installer / aperçu Vercel / serveur non configuré…), calculé par
//    le module pur src/notificationsPush.mjs. Un état inconnu ne ressemble
//    jamais à « activées ».
//
// Le navigateur ne touche jamais la table push_subscriptions : tout passe par
// les Edge Functions push-abonnement et send-push.

import React, { useCallback, useEffect, useState } from "react";
import { Smartphone, X, BellRing, Send, BellOff, RefreshCw } from "lucide-react";
import { supabase } from "../supabase";
import { isVercelPreviewHost } from "../pwa";
import { Icon } from "../ui";
import { ROLES_DEFAULT_RENOVATION } from "../access";
import {
  roleConcerne, phraseRole, etatNotifications, estAppareilIOS, estAndroid,
  choisirClePublique, base64UrlVersOctets,
} from "../notificationsPush";

const FONCTION_ABONNEMENT = "push-abonnement";
const FONCTION_ENVOI = "send-push";

// ── Appels aux Edge Functions (session obligatoire, statut HTTP conservé) ────
async function appelerFonction(nom, { method = "POST", body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const e = new Error("Session expirée : reconnectez-vous.");
    e.statut = 401;
    throw e;
  }
  const { data, error } = await supabase.functions.invoke(nom, body === undefined ? { method } : { method, body });
  if (error) {
    let corps = null;
    try { corps = error?.context?.json ? await error.context.clone().json() : null; } catch { /* pas de JSON */ }
    const e = new Error((typeof corps?.error === "string" && corps.error) || error.message || "Erreur du serveur de notifications.");
    e.statut = error?.context?.status ?? null;
    e.code = corps?.code ?? null;
    throw e;
  }
  return data;
}

function capacites() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const win = typeof window !== "undefined" ? window : {};
  const standalone = !!(win.matchMedia && win.matchMedia("(display-mode: standalone)").matches) || nav.standalone === true;
  return {
    apercuVercel: isVercelPreviewHost(),
    supporteServiceWorker: "serviceWorker" in nav,
    supportePush: "PushManager" in win,
    supporteNotification: "Notification" in win,
    ios: estAppareilIOS({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints }),
    android: estAndroid({ userAgent: nav.userAgent }),
    standalone,
    permission: "Notification" in win ? win.Notification.permission : null,
  };
}

async function enregistrementSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return (await navigator.serviceWorker.getRegistration()) || null; } catch { return null; }
}

async function serviceWorkerPret(ms = 10000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Le service worker de l'application n'est pas prêt. Rechargez la page puis réessayez.")), ms)),
  ]);
}

function memeCle(bufferAbonnement, octetsCle) {
  if (!bufferAbonnement) return false;
  const a = new Uint8Array(bufferAbonnement);
  if (a.length !== octetsCle.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== octetsCle[i]) return false;
  return true;
}

const TONS = {
  ok:        { couleur: "#22c55e", fond: "rgba(34,197,94,0.10)",  bord: "rgba(34,197,94,0.35)" },
  attention: { couleur: "#f59e0b", fond: "rgba(245,158,11,0.10)", bord: "rgba(245,158,11,0.35)" },
  erreur:    { couleur: "#ef4444", fond: "rgba(239,68,68,0.10)",  bord: "rgba(239,68,68,0.35)" },
  neutre:    { couleur: "#94a3b8", fond: "rgba(148,163,184,0.10)", bord: "rgba(148,163,184,0.30)" },
  attente:   { couleur: "#94a3b8", fond: "transparent",            bord: "rgba(148,163,184,0.30)" },
};

function bouton(T, couleur, desactive) {
  return {
    display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center",
    padding: "10px 14px", borderRadius: 8, fontSize: 14, fontWeight: 600,
    fontFamily: "inherit", cursor: desactive ? "default" : "pointer",
    border: `1px solid ${couleur}`, background: desactive ? "transparent" : `${couleur}1a`,
    color: desactive ? T.textMuted : couleur, opacity: desactive ? 0.6 : 1, minHeight: 44,
  };
}

/** Bloc « Notifications sur ce téléphone ». Rien pour un rôle non concerné. */
export function BlocNotificationsTelephone({ role, T }) {
  const [serveur, setServeur] = useState("inconnu");
  const [cleServeur, setCleServeur] = useState(null);
  const [swActif, setSwActif] = useState(null);
  const [abonnementLocal, setAbonnementLocal] = useState(null);
  const [appareilEnregistre, setAppareilEnregistre] = useState(null);
  const [cap, setCap] = useState(capacites);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton, texte }

  const concerne = roleConcerne(role);

  const actualiser = useCallback(async () => {
    const c = capacites();
    setCap(c);
    if (!concerne || c.apercuVercel || !c.supporteServiceWorker || !c.supportePush || !c.supporteNotification) return;
    if (c.ios && !c.standalone) return;

    const reg = await enregistrementSW();
    setSwActif(!!reg);
    let sub = null;
    if (reg) {
      try { sub = await reg.pushManager.getSubscription(); } catch { sub = null; }
    }
    setAbonnementLocal(!!sub);

    try {
      const chemin = sub ? `${FONCTION_ABONNEMENT}?endpoint=${encodeURIComponent(sub.endpoint)}` : FONCTION_ABONNEMENT;
      const rep = await appelerFonction(chemin, { method: "GET" });
      setServeur(rep?.configure ? "configure" : "non_configure");
      setCleServeur(rep?.cle_publique || null);
      setAppareilEnregistre(sub ? rep?.appareil_enregistre === true : null);
    } catch (e) {
      setServeur(e.statut === 503 || e.code === "serveur_non_configure" ? "non_configure" : "injoignable");
      setAppareilEnregistre(null);
    }
  }, [concerne]);

  useEffect(() => {
    actualiser();
    // Retour depuis les réglages du téléphone : on relit l'état réel.
    const surVisible = () => { if (document.visibilityState === "visible") actualiser(); };
    document.addEventListener("visibilitychange", surVisible);
    return () => document.removeEventListener("visibilitychange", surVisible);
  }, [actualiser]);

  if (!concerne) return null;

  const e = etatNotifications({
    role, ...cap, serviceWorkerActif: swActif, serveur, abonnementLocal, appareilEnregistre,
  });
  const ton = TONS[e.ton] || TONS.neutre;

  const activer = async () => {
    setMessage(null);
    setOccupe(true);
    try {
      // La demande d'autorisation part directement du clic (exigé par iPhone).
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage({ ton: "erreur", texte: "L'autorisation n'a pas été donnée : aucune notification ne pourra arriver sur cet appareil." });
        return;
      }
      const choix = choisirClePublique({ cleEnv: import.meta.env.VITE_VAPID_PUBLIC_KEY, cleServeur });
      if (!choix.cle) {
        setMessage({ ton: "attention", texte: "Les notifications ne sont pas encore configurées sur le serveur." });
        return;
      }
      const octets = base64UrlVersOctets(choix.cle);
      const reg = await serviceWorkerPret();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !memeCle(sub.options?.applicationServerKey, octets)) {
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets });
      const rep = await appelerFonction(FONCTION_ABONNEMENT, { method: "POST", body: { subscription: sub.toJSON() } });
      setMessage({ ton: "ok", texte: `Notifications activées sur cet appareil (${rep?.appareil || "appareil"}).` });
    } catch (err) {
      setMessage({ ton: "erreur", texte: err.statut === 503
        ? "Les notifications ne sont pas encore configurées sur le serveur."
        : `Activation impossible : ${err.message}` });
    } finally {
      setOccupe(false);
      actualiser();
    }
  };

  const tester = async () => {
    setMessage(null);
    setOccupe(true);
    try {
      const rep = await appelerFonction(FONCTION_ENVOI, { method: "POST", body: { mode: "test" } });
      if (rep?.envoyes > 0) {
        const autres = rep.supprimes ? ` ${rep.supprimes} appareil(s) qui n'existai(en)t plus ont été retirés.` : "";
        const echecs = rep.echecs ? ` ${rep.echecs} envoi(s) en échec.` : "";
        setMessage({ ton: "ok", texte: `Notification de test envoyée à ${rep.envoyes} appareil(s). Elle doit arriver dans quelques secondes.${autres}${echecs}` });
      } else {
        setMessage({ ton: "erreur", texte: "Aucun appareil n'a accepté la notification de test. Désactivez puis réactivez les notifications sur cet appareil." });
      }
    } catch (err) {
      setMessage({ ton: "erreur", texte: err.statut === 503
        ? "Les notifications ne sont pas encore configurées sur le serveur."
        : `Envoi du test impossible : ${err.message}` });
    } finally {
      setOccupe(false);
      actualiser();
    }
  };

  const desactiver = async () => {
    setMessage(null);
    setOccupe(true);
    try {
      const reg = await enregistrementSW();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await appelerFonction(FONCTION_ABONNEMENT, { method: "DELETE", body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setMessage({ ton: "neutre", texte: "Notifications désactivées sur cet appareil. Vos autres appareils ne changent pas." });
    } catch (err) {
      setMessage({ ton: "erreur", texte: `Désactivation impossible : ${err.message}` });
    } finally {
      setOccupe(false);
      actualiser();
    }
  };

  const tonMessage = message ? (TONS[message.ton] || TONS.neutre) : null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon as={Smartphone} size={18} color={T.accent}/>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.text }}>Notifications sur ce téléphone</h3>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: T.textSub }}>
        {phraseRole(role)} Les envois automatiques arriveront prochainement ; pour l'instant, vous pouvez activer les notifications et recevoir une notification de test.
      </p>

      <div role="status" style={{
        border: `1px ${e.ton === "attente" ? "dashed" : "solid"} ${ton.bord}`, background: ton.fond,
        borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: ton.couleur }}>{e.titre}</span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: T.text }}>{e.detail}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {e.actions.activer && (
          <button type="button" onClick={activer} disabled={occupe} style={bouton(T, "#22c55e", occupe)}>
            <Icon as={BellRing} size={16}/> Activer les notifications
          </button>
        )}
        {e.actions.tester && (
          <button type="button" onClick={tester} disabled={occupe} style={bouton(T, T.accent, occupe)}>
            <Icon as={Send} size={16}/> Envoyer une notification de test
          </button>
        )}
        {e.actions.desactiver && (
          <button type="button" onClick={desactiver} disabled={occupe} style={bouton(T, "#ef4444", occupe)}>
            <Icon as={BellOff} size={16}/> Désactiver sur cet appareil
          </button>
        )}
        {(e.code === "serveur_injoignable" || e.code === "refusees" || e.code === "sans_service_worker") && (
          <button type="button" onClick={actualiser} disabled={occupe} style={bouton(T, T.textSub, occupe)}>
            <Icon as={RefreshCw} size={16}/> Vérifier à nouveau
          </button>
        )}
      </div>

      {message && (
        <div role="alert" style={{
          borderLeft: `3px solid ${tonMessage.couleur}`, padding: "6px 10px",
          fontSize: 13, lineHeight: 1.5, color: T.text, background: tonMessage.fond, borderRadius: 4,
        }}>{message.texte}</div>
      )}
    </section>
  );
}

/** Panneau « Mon profil » (bureau). Ne s'affiche jamais pour un ouvrier. */
export default function PanneauProfil({ profil, role, T, onClose }) {
  useEffect(() => {
    const echap = (ev) => { if (ev.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", echap);
    return () => document.removeEventListener("keydown", echap);
  }, [onClose]);

  if (!roleConcerne(role)) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Mon profil" onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "max(16px, env(safe-area-inset-top)) 12px 16px", overflowY: "auto",
    }}>
      <div onClick={(ev) => ev.stopPropagation()} style={{
        width: "100%", maxWidth: 520, background: T.modal, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: 14, padding: 18,
        display: "flex", flexDirection: "column", gap: 16, marginTop: 24,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: T.textMuted, fontWeight: 700 }}>Mon profil</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{profil?.nom || profil?.email}</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{ROLES_DEFAULT_RENOVATION.find((r) => r.id === role)?.label || role}{profil?.email ? ` · ${profil.email}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} title="Fermer" aria-label="Fermer" style={{
            background: "transparent", border: "none", cursor: "pointer", padding: 6, color: T.textSub, display: "flex",
          }}>
            <Icon as={X} size={20}/>
          </button>
        </div>
        <div style={{ height: 1, background: T.border }}/>
        <BlocNotificationsTelephone role={role} T={T}/>
      </div>
    </div>
  );
}
