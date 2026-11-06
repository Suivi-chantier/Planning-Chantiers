// src/Renovation/ReglagesNotificationsAdmin.jsx — onglet Réglages ›
// Notifications (administrateurs). Projet notifications-push, règle 7, tâche 3.
//
//  - Le réglage vit dans planning_config, clé « notifications_push », écrit
//    ENTIER par saveConfig comme les autres réglages de cet écran (aucun droit
//    nouveau : même chemin que « echeancier_facturation »). Il est relu par
//    send-push à chaque envoi. Tant que personne n'y touche, la clé reste
//    absente et les valeurs par défaut s'appliquent (interrupteur COUPÉ).
//  - Les rôles proposés sont ceux de ROLES_DEFAULT_RENOVATION sauf « ouvrier »
//    (rolesProposables) ; « ouvrier » est aussi retiré à l'écriture.
//  - Les chiffres de suivi (dernier envoi, destinataires, appareils par rôle)
//    viennent de l'Edge Function notifications-pilotage (admin seulement) :
//    les tables notifications et push_subscriptions sont fermées au navigateur.
//    Une lecture impossible s'affiche comme telle, jamais comme « 0 » ou
//    « jamais envoyé ».
//  - Le mail « facture à émettre » garde son propre réglage (Facturation).

import React, { useCallback, useEffect, useState } from "react";
import { Bell, AlertTriangle, RefreshCw, Moon, Smartphone } from "lucide-react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { RADIUS, FONT } from "../constants";
import { ROLES_DEFAULT_RENOVATION } from "../access";
import {
  CATALOGUE, CLE_REGLAGES, JOURS, normaliserReglages, reglagesAEnregistrer, rolesProposables,
} from "../notificationsPushV1";
import { appelerFonction } from "./ProfilNotifications";

const ROLES = rolesProposables(ROLES_DEFAULT_RENOVATION);
// Lundi d'abord, comme un agenda.
const JOURS_AFFICHES = [...JOURS.slice(1), JOURS[0]];
const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const dateLisible = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? FORMAT_DATE.format(d) : "date inconnue";
};

function Interrupteur({ actif, onChange, label, couleur = "#22c55e" }) {
  return (
    <button type="button" role="switch" aria-checked={actif} aria-label={label} title={label} onClick={onChange} style={{
      width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
      background: actif ? couleur : "rgba(148,163,184,0.35)", transition: "background .15s",
    }}>
      <span style={{
        position: "absolute", top: 3, left: actif ? 23 : 3, width: 18, height: 18, borderRadius: "50%",
        background: "#fff", transition: "left .15s",
      }}/>
    </button>
  );
}

export default function ReglagesNotificationsAdmin({ T, saveConfig }) {
  const [etat, setEtat] = useState("chargement"); // chargement | ok | erreur
  const [erreur, setErreur] = useState(null);
  const [reglages, setReglages] = useState(null);
  const [enBase, setEnBase] = useState(false);
  const [suivi, setSuivi] = useState({ etat: "chargement" });

  const chargerReglages = useCallback(async () => {
    setEtat("chargement"); setErreur(null);
    const { data, error } = await supabase.from("planning_config").select("value").eq("key", CLE_REGLAGES).maybeSingle();
    if (error) { setErreur(error.message); setEtat("erreur"); return; }
    setEnBase(!!data);
    setReglages(normaliserReglages(data?.value ?? null));
    setEtat("ok");
  }, []);

  const chargerSuivi = useCallback(async () => {
    setSuivi({ etat: "chargement" });
    try {
      const rep = await appelerFonction("notifications-pilotage", { method: "GET" });
      if (!rep || typeof rep.par_type !== "object" || typeof rep.appareils_par_role !== "object") throw new Error("Réponse illisible du serveur.");
      setSuivi({ etat: "ok", ...rep });
    } catch (e) {
      setSuivi({ etat: "erreur", erreur: e.message });
    }
  }, []);

  useEffect(() => { chargerReglages(); chargerSuivi(); }, [chargerReglages, chargerSuivi]);

  const enregistrer = (next) => {
    const propre = reglagesAEnregistrer(next);
    setReglages(normaliserReglages(propre));
    setEnBase(true);
    saveConfig(CLE_REGLAGES, propre);
  };

  if (etat === "chargement") return <div className="ac" style={{ color: T.textMuted, fontSize: 13 }}>Lecture des réglages de notification…</div>;
  if (etat === "erreur") {
    return (
      <div className="ac">
        <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: RADIUS.md, fontSize: 13, color: T.text }}>
          <Icon as={AlertTriangle} size={14} color="#ef4444"/> Réglages illisibles : {erreur}
        </div>
        <button type="button" className="btn-g" onClick={chargerReglages} style={{ marginTop: 10 }}>Réessayer</button>
      </div>
    );
  }

  const r = reglages;
  const majType = (code, patch) => enregistrer({ ...r, types: { ...r.types, [code]: { ...r.types[code], ...patch } } });
  const basculerRole = (code, roleId) => {
    const roles = r.types[code].roles;
    majType(code, { roles: roles.includes(roleId) ? roles.filter((x) => x !== roleId) : [...roles, roleId] });
  };
  const basculerGeneral = () => {
    if (!r.actif && !window.confirm("Activer les envois automatiques ?\n\nLes notifications partiront vers les rôles cochés ci-dessous, dès le prochain envoi.")) return;
    enregistrer({ ...r, actif: !r.actif });
  };
  const majSilence = (patch) => enregistrer({ ...r, silence: { ...r.silence, ...patch } });
  const basculerJour = (j) => {
    const jours = r.silence.jours.includes(j) ? r.silence.jours.filter((x) => x !== j) : [...r.silence.jours, j];
    majSilence({ jours });
  };

  const ligneSuivi = (code) => {
    if (suivi.etat === "chargement") return <span style={{ color: T.textMuted }}>Suivi des envois : lecture…</span>;
    if (suivi.etat === "erreur") return <span style={{ color: "#f59e0b" }}>Suivi des envois indisponible</span>;
    const s = suivi.par_type?.[code];
    if (s === undefined) return <span style={{ color: "#f59e0b" }}>Suivi des envois indisponible</span>;
    if (s === null) return <span style={{ color: T.textMuted }}>Jamais envoyée</span>;
    return (
      <span style={{ color: T.textSub }}>
        Dernier envoi : {dateLisible(s.date)} · {s.destinataires} personne{s.destinataires > 1 ? "s" : ""} touchée{s.destinataires > 1 ? "s" : ""}
        {s.push_envoyes ? ` · ${s.push_envoyes} reçue${s.push_envoyes > 1 ? "s" : ""} sur téléphone` : ""}
        {s.reportes ? ` · ${s.reportes} en attente (plage de silence)` : ""}
      </span>
    );
  };

  const titre = (t) => <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: T.text }}>{t}</div>;
  const texte = { color: T.textSub, fontSize: 13, marginBottom: 12, maxWidth: 680, lineHeight: 1.6 };

  return (
    <div className="ac">
      {/* ── Interrupteur général ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <Icon as={Bell} size={18} color={r.actif ? "#22c55e" : T.textMuted}/>
        <div style={{ fontWeight: 800, fontSize: FONT.md.size, color: T.text, flex: 1 }}>Notifications sur téléphone</div>
        <Interrupteur actif={r.actif} onChange={basculerGeneral} label={r.actif ? "Envois automatiques activés : couper" : "Envois automatiques coupés : activer"}/>
      </div>
      <div style={{ ...texte, color: r.actif ? "#22c55e" : "#f59e0b", fontWeight: 600 }}>
        {r.actif
          ? "Envois automatiques activés : chaque type activé part vers les rôles cochés."
          : "Envois automatiques coupés : rien ne part (ni sur le téléphone, ni dans la cloche). La notification de test de « Mon profil » fonctionne quand même."}
      </div>
      <div style={texte}>
        Une notification va à tous les utilisateurs <strong>actifs</strong> des rôles cochés, rattachés à la Rénovation.
        Une personne ne la reçoit jamais deux fois. Les ouvriers ne reçoivent aucune notification. Chacun peut couper un type dans « Mon profil ».
        Le mail « facture à émettre » garde son propre réglage (Logistique › Facturation).
        {!enBase && " Réglages par défaut, pas encore modifiés."}
      </div>
      {r.avertissements?.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 14px", marginBottom: 14, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: RADIUS.md, fontSize: 13, color: "#f59e0b" }}>
          {r.avertissements.map((a) => <span key={a}>{a}</span>)}
        </div>
      )}

      {/* ── Une ligne par type ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}>
        {CATALOGUE.map((t) => {
          const rt = r.types[t.code];
          return (
            <div key={t.code} style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "12px 14px", background: T.surface, opacity: rt.actif ? 1 : 0.7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: T.textMuted, minWidth: 22 }}>{t.code}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: T.text }}>
                  {t.libelle}
                  {t.push === false && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: T.textMuted }}>(cloche seulement, pas de push)</span>}
                </span>
                <Interrupteur actif={rt.actif} onChange={() => majType(t.code, { actif: !rt.actif })} label={`${t.libelle} : ${rt.actif ? "activée, couper" : "coupée, activer"}`}/>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {ROLES.map((ro) => {
                  const coche = rt.roles.includes(ro.id);
                  return (
                    <label key={ro.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: RADIUS.lg, cursor: "pointer",
                      border: `1px solid ${coche ? ro.color : T.border}`, background: coche ? `${ro.color}1a` : T.surface,
                    }}>
                      <input type="checkbox" checked={coche} onChange={() => basculerRole(t.code, ro.id)}
                        style={{ width: 15, height: 15, accentColor: ro.color, cursor: "pointer" }}/>
                      <span style={{ fontSize: 13, fontWeight: 700, color: coche ? ro.color : T.textSub }}>{ro.label}</span>
                    </label>
                  );
                })}
              </div>
              {rt.roles.length === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 8, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: RADIUS.md, fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
                  <Icon as={AlertTriangle} size={14}/>
                  Aucun rôle coché : cette notification ne sera envoyée à personne
                </div>
              )}
              <div style={{ fontSize: 12 }}>{ligneSuivi(t.code)}</div>
            </div>
          );
        })}
      </div>

      {/* ── Plage de silence ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon as={Moon} size={16} color={T.accent}/>
        {titre("Plage de silence")}
      </div>
      <div style={texte}>
        Aucun push pendant cette plage : la notification est rangée tout de suite dans la cloche, et son push part au prochain créneau autorisé (heure de Paris).
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text }}>
          Silence à partir de
          <input type="time" value={r.silence.debut} onChange={(e) => e.target.value && majSilence({ debut: e.target.value })}
            style={{ padding: "6px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit" }}/>
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: T.text }}>
          jusqu'à
          <input type="time" value={r.silence.fin} onChange={(e) => e.target.value && majSilence({ fin: e.target.value })}
            style={{ padding: "6px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontFamily: "inherit" }}/>
        </label>
      </div>
      <div style={{ fontSize: 13, color: T.textSub, marginBottom: 8 }}>Jours entièrement silencieux :</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {JOURS_AFFICHES.map((j) => {
          const coche = r.silence.jours.includes(j);
          return (
            <label key={j} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: RADIUS.lg, cursor: "pointer",
              border: `1px solid ${coche ? T.accent : T.border}`, background: coche ? "rgba(255,194,0,0.08)" : T.surface,
            }}>
              <input type="checkbox" checked={coche} onChange={() => basculerJour(j)} style={{ width: 14, height: 14, cursor: "pointer" }}/>
              <span style={{ fontSize: 13, fontWeight: 600, color: coche ? T.text : T.textSub, textTransform: "capitalize" }}>{j}</span>
            </label>
          );
        })}
      </div>
      {r.silence.jours.length === 7 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 10, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: RADIUS.md, fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
          <Icon as={AlertTriangle} size={14}/> Tous les jours sont silencieux : aucun push ne pourra partir (les notifications restent dans la cloche).
        </div>
      )}
      <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${T.border}` }}/>

      {/* ── Appareils par rôle ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon as={Smartphone} size={16} color={T.accent}/>
        {titre("Notifications activées, par rôle")}
        <button type="button" onClick={chargerSuivi} title="Actualiser le suivi" aria-label="Actualiser le suivi"
          style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: T.textSub, display: "flex", padding: 4 }}>
          <Icon as={RefreshCw} size={15}/>
        </button>
      </div>
      <div style={texte}>Utilisateurs actifs ayant activé les notifications sur au moins un appareil.</div>
      {suivi.etat === "chargement" && <div style={{ fontSize: 13, color: T.textMuted }}>Lecture…</div>}
      {suivi.etat === "erreur" && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", borderRadius: RADIUS.md, fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>
          <Icon as={AlertTriangle} size={14}/> Suivi indisponible : {suivi.erreur}
        </div>
      )}
      {suivi.etat === "ok" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ROLES.map((ro) => {
            const c = suivi.appareils_par_role?.[ro.id];
            return (
              <div key={ro.id} style={{ padding: "9px 14px", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, background: T.surface, fontSize: 13 }}>
                <span style={{ fontWeight: 700, color: ro.color }}>{ro.label}</span>
                <span style={{ color: T.text }}> : {c ? `${c.avec_appareil} sur ${c.utilisateurs}` : "aucun utilisateur actif"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
