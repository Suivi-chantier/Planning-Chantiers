import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { Bell, Check, X, ExternalLink } from "lucide-react";
import { THEMES_INV, SU, WA, DA } from "./_shared";
import { NAV } from "./_shared";
import { estUtilisateurCourant } from "./annuaire.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// CENTRE DE NOTIFICATIONS
//
// La table invest_action_notifications recevait une ligne à chaque action
// déléguée depuis le tableau de bord. Elle n'était lue qu'à un seul endroit :
// une phrase en bas de la vue Équipe, « N notification(s) collaborateur non
// lue(s) ». Et rien, nulle part, ne renseignait jamais `read_at` ni ne passait
// `status` à « read ». Le compteur ne pouvait donc que croître : il mesurait un
// total historique, pas un reste à traiter.
//
// Ce qui manquait n'était pas la table — elle a toutes les colonnes utiles —
// mais le DESTINATAIRE. Personne n'avait d'endroit où voir ce qui lui était
// adressé.
//
// La cloche complète la veille quotidienne plutôt qu'elle ne la double :
// l'e-mail va chercher ceux qui ne sont pas dans l'application, la cloche sert
// ceux qui y sont déjà.
//
// Appariement du destinataire : `recipient` contient un nom saisi à la main
// (« Camille »), pas un identifiant. On réutilise estUtilisateurCourant, la
// même règle que le tableau de bord et la veille — trois copies auraient
// divergé.
// ─────────────────────────────────────────────────────────────────────────────

const TABLE = "invest_action_notifications";
const PLAFOND = 200;   // au-delà, c'est un historique, pas une liste d'attente

// Une notification est « à traiter » tant qu'elle n'a pas été ouverte.
// Les deux colonnes sont testées : `status` existait avant `read_at`, et
// d'anciennes lignes peuvent ne porter que l'une des deux.
function estNonLue(n) {
  return !n?.read_at && n?.status !== "read";
}

// Crée une notification destinée à quelqu'un d'autre.
//
// Point d'entrée unique : le tableau de bord en insérait une à la main dans sa
// propre fonction, et le CRM n'en créait aucune — il envoyait un e-mail et
// s'arrêtait là. Une action assignée depuis le CRM n'apparaissait donc nulle
// part dans l'application pour son destinataire.
//
// Ne bloque JAMAIS l'appelant : une notification qui échoue ne doit pas
// empêcher l'action qu'elle accompagne. L'échec part en console.
export async function creerNotificationInvest({
  destinataire, titre, message,
  entiteType = null, entiteId = null, actionId = null,
  priorite = "normal", source = "invest", profil = null,
}) {
  if (!destinataire) return null;
  // On ne se notifie pas soi-même : même règle que le tableau de bord, et
  // même fonction, pour qu'elles ne puissent pas diverger.
  if (estUtilisateurCourant(destinataire, profil)) return null;

  try {
    const { data, error } = await supabase.from(TABLE).insert({
      action_id: actionId || null,
      recipient: destinataire,
      title: titre || "Nouvelle action assignée",
      message: message || "",
      linked_entity_type: entiteType,
      linked_entity_id: entiteId ? String(entiteId) : null,
      priority: priorite,
      status: "unread",
      source_module: source,
      created_by: profil?.email || profil?.nom || null,
    }).select("id").single();
    if (error) throw error;
    return data?.id || null;
  } catch (e) {
    console.warn("[Invest] notification non créée (non bloquant)", e?.message || e);
    return null;
  }
}

export function useNotificationsInvest(profil) {
  const [liste, setListe] = useState([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async () => {
    const { data, error } = await supabase
      .from(TABLE).select("*")
      .order("created_at", { ascending: false })
      .limit(PLAFOND);

    if (error) {
      // 42P01 : table absente de cet environnement — la cloche se masque.
      if (error.code !== "42P01") console.warn("[Invest] notifications:", error.message);
      setListe([]); setChargement(false); return;
    }
    // Filtrage côté client : `recipient` est un nom, pas un identifiant, et
    // l'appariement tolère prénom, nom complet ou partie locale de l'e-mail.
    // Une clause SQL ne saurait pas exprimer ça.
    setListe((data || []).filter(n => estUtilisateurCourant(n.recipient, profil)));
    setChargement(false);
  }, [profil]);

  useEffect(() => { charger(); }, [charger]);

  // Temps réel : c'est le seul endroit d'Invest où l'attente est immédiate —
  // on vient d'assigner une action à quelqu'un, il doit le voir sans recharger.
  useEffect(() => {
    const canal = supabase.channel("invest-notifications")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, () => charger())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [charger]);

  const nonLues = useMemo(() => liste.filter(estNonLue), [liste]);

  const marquerLue = useCallback(async (id) => {
    const maintenant = new Date().toISOString();
    // Optimiste : la pastille doit retomber au clic, pas au retour du réseau.
    setListe(prev => prev.map(n => n.id === id ? { ...n, read_at: maintenant, status: "read" } : n));
    const { error } = await supabase.from(TABLE)
      .update({ read_at: maintenant, status: "read" }).eq("id", id);
    if (error) { console.warn("[Invest] marquage lu:", error.message); charger(); }
  }, [charger]);

  const marquerToutesLues = useCallback(async () => {
    const ids = nonLues.map(n => n.id);
    if (!ids.length) return;
    const maintenant = new Date().toISOString();
    setListe(prev => prev.map(n => ids.includes(n.id) ? { ...n, read_at: maintenant, status: "read" } : n));
    const { error } = await supabase.from(TABLE)
      .update({ read_at: maintenant, status: "read" }).in("id", ids);
    if (error) { console.warn("[Invest] marquage lu groupé:", error.message); charger(); }
  }, [nonLues, charger]);

  return { liste, nonLues, chargement, marquerLue, marquerToutesLues, recharger: charger };
}

// Cible de navigation d'une notification, exprimée dans le contrat NAV.
// `linked_entity_type` vaut « prospect », « client », « bien » ou « team »,
// posé par createNotification (Dashboard.jsx).
function cibleDe(n) {
  const id = n?.linked_entity_id;
  if (!id) return null;
  switch (n.linked_entity_type) {
    case "client":   return NAV.ficheClient(id);
    case "bien":     return NAV.ficheBien(id);
    case "prospect": return NAV.ficheProspect(id);
    case "team":     return NAV.actionsClient(id, n.action_id);
    default:         return null;
  }
}

function ageLisible(iso) {
  if (!iso) return "";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  return jours === 1 ? "hier" : `il y a ${jours} j`;
}

export function ClocheNotifications({ profil, theme = "dark", onNaviguer, collapsed = false }) {
  const T = THEMES_INV[theme] || THEMES_INV.dark;
  const { liste, nonLues, marquerLue, marquerToutesLues } = useNotificationsInvest(profil);
  const [ouvert, setOuvert] = useState(false);
  const conteneur = useRef(null);

  // Fermeture au clic extérieur et à Échap : un panneau qui reste ouvert
  // derrière le contenu gêne plus qu'il ne sert.
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e) => { if (conteneur.current && !conteneur.current.contains(e.target)) setOuvert(false); };
    const echap = (e) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const ouvrir = (n) => {
    if (estNonLue(n)) marquerLue(n.id);
    const cible = cibleDe(n);
    if (cible && onNaviguer) { onNaviguer(cible.tab, cible); setOuvert(false); }
  };

  const compte = nonLues.length;

  return (
    <div ref={conteneur} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOuvert(o => !o)}
        title={compte ? `${compte} notification${compte > 1 ? "s" : ""} non lue${compte > 1 ? "s" : ""}` : "Notifications"}
        aria-label={compte ? `${compte} notifications non lues` : "Notifications"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: 8, position: "relative",
          background: ouvert ? T.accentBg : "transparent", border: "none", cursor: "pointer",
          color: compte ? T.accent : T.textSub, transition: "background .15s",
        }}
        onMouseEnter={e => { if (!ouvert) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        onMouseLeave={e => { if (!ouvert) e.currentTarget.style.background = "transparent"; }}
      >
        <Icon as={Bell} size={16} />
        {compte > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2, minWidth: 15, height: 15,
            padding: "0 3px", borderRadius: 999, background: DA, color: "#fff",
            fontSize: 9.5, fontWeight: 800, lineHeight: "15px", textAlign: "center",
            fontFamily: "'DM Mono', monospace",
          }}>{compte > 99 ? "99+" : compte}</span>
        )}
      </button>

      {ouvert && (
        <div style={{
          position: "absolute", bottom: collapsed ? 40 : "auto", top: collapsed ? "auto" : 40,
          left: 0, width: 320, maxHeight: 420, overflowY: "auto", zIndex: 200,
          background: T.card, border: `1px solid ${T.border}`, borderRadius: 10,
          boxShadow: "0 12px 32px rgba(0,0,0,.28)",
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
            padding: "11px 13px", borderBottom: `1px solid ${T.border}`,
            position: "sticky", top: 0, background: T.card,
          }}>
            <strong style={{ fontSize: 13, color: T.text }}>
              Notifications{compte ? ` · ${compte}` : ""}
            </strong>
            <div style={{ display: "flex", gap: 6 }}>
              {compte > 0 && (
                <button onClick={marquerToutesLues} title="Tout marquer comme lu"
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: T.accent, fontSize: 11, fontWeight: 700, padding: "2px 4px" }}>
                  <Icon as={Check} size={12} /> Tout lu
                </button>
              )}
              <button onClick={() => setOuvert(false)} aria-label="Fermer"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px 4px" }}>
                <Icon as={X} size={13} />
              </button>
            </div>
          </div>

          {liste.length === 0 ? (
            <div style={{ padding: "26px 16px", textAlign: "center", color: T.textMuted, fontSize: 12.5 }}>
              Rien qui vous soit adressé.
            </div>
          ) : liste.slice(0, 40).map(n => {
            const neuve = estNonLue(n);
            const cible = cibleDe(n);
            return (
              <button key={n.id} onClick={() => ouvrir(n)}
                style={{
                  display: "block", width: "100%", textAlign: "left", cursor: cible ? "pointer" : "default",
                  padding: "10px 13px", border: "none", borderBottom: `1px solid ${T.border}`,
                  background: neuve ? T.accentBg : "transparent", fontFamily: "inherit",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontSize: 12.5, fontWeight: neuve ? 800 : 600, color: T.text, lineHeight: 1.3 }}>
                    {n.title || "Action assignée"}
                  </span>
                  {n.priority === "high" && (
                    <span style={{ fontSize: 9.5, fontWeight: 800, color: DA, letterSpacing: .5, flexShrink: 0 }}>URGENT</span>
                  )}
                </div>
                {n.message && (
                  <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 3, lineHeight: 1.4 }}>{n.message}</div>
                )}
                <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{ageLisible(n.created_at)}</span>
                  {cible && <span style={{ color: T.accent, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <Icon as={ExternalLink} size={9} /> ouvrir
                  </span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
