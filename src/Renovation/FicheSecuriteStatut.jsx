// ─────────────────────────────────────────────────────────────────────────────
// Fiche sécurité sur la fiche chantier (tâche 7 du projet
// docs/projets/fiche-securite-chantier.md) :
//   - BandeauFicheSecurite : état de la fiche, alerte « chantier déjà en
//     cours sans fiche validée », boutons « Ouvrir / Créer la fiche »,
//     verrouillage à refaire, dernier message d'un changement de statut et
//     historique du chantier (journal des statuts, forçages compris) ;
//   - ModaleDemarrageBloque : passage « En cours » refusé, avec le lien vers
//     la fiche, et pour un administrateur « Forcer le démarrage » (motif
//     obligatoire).
// Aucune règle ici : elles viennent de securiteCycleVie.mjs (module pur).
// Aucune écriture ici : la fiche chantier (PageChantiers) fournit les actions.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from "react";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { ShieldCheck, ShieldAlert, X, History, Lock } from "lucide-react";
import { etatFicheSecurite, alerteChantierEnCours, verrouillageEnAttente, validerMotifForcage, MOTIF_FORCAGE_MIN } from "./securiteCycleVie.js";
import { chargerJournalStatut } from "./chantiersDonnees.js";
import { STATUTS_AFFICHAGE } from "./statutsChantier.js";

const ROUGE = "#e15a5a";
const ORANGE = "#f5a623";
const VERT = "#22c55e";

const LIBELLES_EVENEMENT = {
  fiche_securite: "Fiche sécurité",
  marque_perdu: "Marqué perdu",
  perte_annulee: "Perte annulée",
  bascule_signature: "Devis signé",
  statut_complete: "Statut complété",
};
const libelleStatut = (s) => STATUTS_AFFICHAGE[s]?.label || {
  brouillon: "brouillon", validee: "validée", a_mettre_a_jour: "à mettre à jour", verrouillee: "verrouillée",
}[s] || s || "—";

function couleurEtat(code) {
  if (code === "validee") return VERT;
  if (code === "verrouillee") return "#5b6a8a";
  if (code === "illisible" || code === "inconnu") return ROUGE;
  if (code === "chargement") return "#9ca3af";
  return ORANGE;
}

export function BandeauFicheSecurite({
  T, acc, chantier, fiche, lecture, message, peutCreer, operationChargee,
  onOuvrir, onCreer, onVerrouiller, onRecharger, rechargeHistorique = 0,
}) {
  const etat = etatFicheSecurite({ fiche, lecture });
  const alerte = alerteChantierEnCours({ chantier, fiche, lecture });
  const aVerrouiller = verrouillageEnAttente({ chantier, fiche, lecture });
  const [histo, setHisto] = useState({ ouvert: false, charge: false, lignes: [], erreur: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!histo.ouvert) return undefined;
    let actif = true;
    chargerJournalStatut(chantier.id).then((r) => actif && setHisto((h) => ({ ...h, charge: true, lignes: r.lignes, erreur: r.erreur })));
    return () => { actif = false; };
  }, [histo.ouvert, chantier.id, rechargeHistorique]);

  const couleur = couleurEtat(etat.code);
  const bouton = (actif = true) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: RADIUS.md,
    border: `1px solid ${actif ? acc.border : T.border}`, background: actif ? acc.bg10 : "transparent",
    color: actif ? acc.accent : T.textMuted, fontWeight: 700, fontSize: FONT.xs.size + 1,
    cursor: actif ? "pointer" : "default", fontFamily: "inherit",
  });
  const lancer = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };

  return (
    <div style={{ background: T.surface, border: `1px solid ${alerte ? ROUGE : T.border}`, borderRadius: 12, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Icon as={alerte ? ShieldAlert : ShieldCheck} size={16} color={alerte ? ROUGE : couleur}/>
        <span style={{ fontWeight: 800, fontSize: FONT.sm.size, color: T.text }}>Fiche sécurité</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, padding: "2px 10px", borderRadius: RADIUS.pill, color: couleur,
          border: `1px ${etat.code === "illisible" || etat.code === "chargement" ? "dashed" : "solid"} ${couleur}` }}>{etat.libelle}</span>
        {etat.forcee && <span style={{ fontSize: 11.5, fontWeight: 800, color: ROUGE }}>démarrage forcé</span>}
        <span style={{ flex: 1 }}/>
        {fiche && (
          <button onClick={onOuvrir} disabled={!operationChargee} style={bouton(operationChargee)}
            title={operationChargee ? "Ouvrir la fiche sécurité de ce chantier" : "Opération du chantier non chargée"}>Ouvrir la fiche</button>
        )}
        {!fiche && peutCreer && (
          <button onClick={() => lancer(onCreer)} disabled={busy || !operationChargee} style={bouton(!busy && operationChargee)}>
            {busy ? "Création…" : "Créer la fiche"}
          </button>
        )}
        {aVerrouiller && onVerrouiller && (
          <button onClick={() => lancer(onVerrouiller)} disabled={busy} style={bouton(!busy)}
            title="Chantier terminé : la fiche doit être verrouillée (plus aucune modification possible, même par un administrateur)">
            <Icon as={Lock} size={12}/> {busy ? "Verrouillage…" : "Verrouiller la fiche"}
          </button>
        )}
        <button onClick={() => setHisto((h) => ({ ...h, ouvert: !h.ouvert, charge: false }))} style={bouton(true)}>
          <Icon as={History} size={12}/> Historique
        </button>
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 6 }}>
        {etat.raison}
        {lecture === "erreur" && onRecharger && (
          <> <button onClick={onRecharger} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Réessayer</button></>
        )}
      </div>
      {alerte && <div style={{ fontSize: FONT.sm.size, color: ROUGE, fontWeight: 700, marginTop: 6 }}>{alerte}</div>}
      {aVerrouiller && (
        <div style={{ fontSize: FONT.sm.size, color: ROUGE, fontWeight: 700, marginTop: 6 }}>
          Chantier terminé, mais la fiche sécurité n'est pas verrouillée.
        </div>
      )}
      {message && (
        <div style={{ fontSize: FONT.sm.size, fontWeight: 700, marginTop: 6,
          color: message.ton === "erreur" ? ROUGE : message.ton === "attention" ? ORANGE : VERT }}>{message.texte}</div>
      )}
      {histo.ouvert && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
          {!histo.charge ? (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>Chargement de l'historique…</div>
          ) : histo.erreur ? (
            <div style={{ fontSize: FONT.xs.size + 1, color: ROUGE }}>Historique illisible ({histo.erreur}).</div>
          ) : histo.lignes.length === 0 ? (
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>Aucune entrée dans l'historique de ce chantier.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {histo.lignes.map((l) => (
                <div key={l.id} style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.4 }}>
                  <b style={{ color: T.text }}>{l.le ? new Date(l.le).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "?"}</b>
                  {" · "}{LIBELLES_EVENEMENT[l.evenement] || l.evenement}
                  {(l.ancien_statut || l.nouveau_statut) && ` (${libelleStatut(l.ancien_statut)} → ${libelleStatut(l.nouveau_statut)})`}
                  {l.detail && ` — ${l.detail}`}
                  {l.motif && ` — motif : ${l.motif}`}
                  {l.auteur && ` — ${l.auteur}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ModaleDemarrageBloque({ T, acc, chantier, decision, estAdmin, operationChargee, onOuvrirFiche, onForcer, onClose }) {
  const [motif, setMotif] = useState("");
  const [erreur, setErreur] = useState(null);
  const [busy, setBusy] = useState(false);
  const forcer = async () => {
    const v = validerMotifForcage(motif);
    if (!v.ok) { setErreur(v.erreur); return; }
    setBusy(true);
    const e = await onForcer(v.motif);
    setBusy(false);
    if (e) setErreur(e);
  };
  const inp = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${T.border}`,
    background: T.inputBg || T.surface, color: T.text, fontFamily: "inherit", fontSize: 13.5, minHeight: 70, resize: "vertical" };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 900,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Démarrage du chantier bloqué"
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, width: "min(520px, 100%)", padding: 18,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Icon as={ShieldAlert} size={18} color={ROUGE}/>
          <div style={{ fontWeight: 800, fontSize: 15, color: T.text, flex: 1 }}>Passage « En cours » bloqué : {chantier?.nom}</div>
          <button onClick={onClose} title="Fermer" style={{ background: "transparent", border: "none", color: T.textMuted, cursor: "pointer" }}><Icon as={X} size={18}/></button>
        </div>
        <div style={{ fontSize: FONT.sm.size, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>{decision.raison}</div>
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, lineHeight: 1.5, marginBottom: 12 }}>
          Remplissez, faites signer et validez la fiche sécurité, puis repassez le chantier « En cours ».
        </div>
        <button onClick={onOuvrirFiche} disabled={!operationChargee}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: RADIUS.md,
            border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, fontSize: 13,
            cursor: operationChargee ? "pointer" : "default", fontFamily: "inherit", opacity: operationChargee ? 1 : .5 }}>
          <Icon as={ShieldCheck} size={14}/> {decision.creerFiche ? "Créer la fiche sécurité" : "Ouvrir la fiche sécurité"}
        </button>
        {!operationChargee && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 4 }}>Opération du chantier non chargée : passez par la page Opérations.</div>}

        {decision.forcagePossible && estAdmin && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: ROUGE, marginBottom: 4 }}>Forcer le démarrage (administrateur)</div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, lineHeight: 1.5, marginBottom: 8 }}>
              Le chantier passera « En cours » sans fiche validée. Votre nom, la date et le motif sont inscrits dans l'historique du chantier
              {decision.forcageSurFiche ? (decision.creerFiche ? " et sur la fiche, créée en brouillon" : " et sur la fiche") : " (la fiche verrouillée ne peut plus le recevoir)"}.
              La fiche restera à valider.
            </div>
            <textarea value={motif} onChange={(e) => { setMotif(e.target.value); setErreur(null); }} style={inp}
              placeholder={`Motif obligatoire (${MOTIF_FORCAGE_MIN} caractères au moins)`}/>
            {erreur && <div style={{ fontSize: FONT.sm.size, color: ROUGE, fontWeight: 700, marginTop: 6 }}>{erreur}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.textSub, borderRadius: RADIUS.md, padding: "8px 14px", fontFamily: "inherit", cursor: "pointer" }}>Annuler</button>
              <button onClick={forcer} disabled={busy} style={{ background: ROUGE, border: "none", color: "#fff", borderRadius: RADIUS.md, padding: "8px 14px", fontWeight: 800, fontFamily: "inherit", cursor: busy ? "default" : "pointer", opacity: busy ? .6 : 1 }}>
                {busy ? "Enregistrement…" : "Forcer le démarrage"}
              </button>
            </div>
          </div>
        )}
        {!estAdmin && (
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 12 }}>
            Seul un administrateur peut forcer le démarrage, avec un motif.
          </div>
        )}
      </div>
    </div>
  );
}
