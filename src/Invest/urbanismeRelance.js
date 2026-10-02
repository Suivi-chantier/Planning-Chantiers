// src/Invest/urbanismeRelance.js — Relancer un conseiller sur une demande
// d'urbanisme qui l'attend (notification dans l'application et/ou e-mail).
//
// Le « conseiller » d'une demande est le champ `commercial` de la FDU. Les deux
// canaux sont indépendants et chacun renvoie SON issue : un e-mail qui échoue
// ne doit pas cacher que la notification est bien partie, ni l'inverse.
// Ne jette jamais : l'appelant affiche l'issue.

import { envoyerEmailApi } from "../emailApi";
import { creerNotificationInvest } from "./notifications";
import { emailPourResponsable } from "./annuaire.mjs";

const ech = (v) => String(v ?? "").replace(/[&<>"']/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

// Statuts où la demande attend le conseiller (brouillon, pièces à fournir).
export const URBA_STATUTS_ATTENTE_CONSEILLER = ["brouillon", "attente_pieces"];

export function urbaRelanceMessageParDefaut(dossier, retardJours) {
  const ref = dossier?.reference || "sans référence";
  const lieu = [dossier?.adresse, dossier?.commune].filter(Boolean).join(", ");
  const echeance = retardJours === null || retardJours === undefined ? ""
    : retardJours < 0 ? ` La date maximum de dépôt est dépassée de ${Math.abs(retardJours)} jour(s).`
    : ` Il reste ${retardJours} jour(s) avant la date maximum de dépôt.`;
  return `La demande d'urbanisme ${ref}${lieu ? " (" + lieu + ")" : ""} attend votre retour pour avancer.${echeance} Merci de la compléter ou de transmettre les pièces manquantes dès que possible.`;
}

export async function urbaRelancerConseiller({ dossier, message, canaux, annuaire, profil }) {
  const conseiller = String(dossier?.commercial || "").trim();
  const auteur = profil?.nom || profil?.email || "Le pôle urbanisme";
  const ref = dossier?.reference || "sans référence";
  const resultat = {};

  if (!conseiller) {
    const r = { ok:false, message:"Aucun conseiller renseigné sur cette demande." };
    return { notification: canaux.notification ? r : null, email: canaux.email ? r : null };
  }

  if (canaux.notification) {
    const id = await creerNotificationInvest({
      destinataire: conseiller,
      titre: `Relance urbanisme — ${ref}`,
      message,
      entiteType: "urbanisme",
      entiteId: dossier.id,
      priorite: "high",
      source: "urbanisme",
      profil,
    });
    resultat.notification = id
      ? { ok:true, message:`Notification envoyée à ${conseiller}.` }
      : { ok:false, message:`Notification non créée (${conseiller} est peut-être vous-même, ou l'enregistrement a échoué).` };
  }

  if (canaux.email) {
    const to = emailPourResponsable(annuaire, conseiller);
    if (!to) {
      resultat.email = { ok:false, message:`Pas d'adresse e-mail connue pour ${conseiller}.` };
    } else {
      const lien = `${typeof window !== "undefined" ? window.location.origin : ""}/?invest_urbanisme=${dossier.id}`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#1a1f2e">
        <div style="border-bottom:3px solid #1a1f2e;padding-bottom:12px;margin-bottom:4px">
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8b93a3;font-weight:700">Groupe Profero · Urbanisme</div>
          <div style="font-size:20px;font-weight:800;margin-top:5px">Relance — ${ech(ref)}</div>
        </div>
        <div style="height:3px;width:70px;background:#c9a14f;margin-bottom:16px"></div>
        <p style="font-size:14px;white-space:pre-line">${ech(message)}</p>
        <div style="margin:18px 0"><a href="${ech(lien)}" style="background:#1a1f2e;color:#fff;text-decoration:none;padding:11px 22px;font-weight:700;font-size:13px;display:inline-block">Ouvrir la demande →</a></div>
        <p style="margin:16px 0 0;padding-top:12px;border-top:1px solid #dcdfe6;font-size:11px;color:#8b93a3">Relance envoyée par ${ech(auteur)}.</p>
      </div>`;
      try {
        const resp = await envoyerEmailApi({
          to, subject:`[Urbanisme] Relance — ${ref}`, html,
          text:`${message}\n\n${lien}\n\nRelance envoyée par ${auteur}.`,
        }, { source:"urbanisme" });
        const corps = await resp.json().catch(() => ({}));
        resultat.email = (!resp.ok || corps?.error)
          ? { ok:false, message: corps?.error || `Erreur ${resp.status}` }
          : { ok:true, message:`E-mail envoyé à ${conseiller} (${to}).` };
      } catch (e) {
        resultat.email = { ok:false, message: e?.message || "Réseau indisponible" };
      }
    }
  }
  return { notification: resultat.notification || null, email: resultat.email || null };
}
