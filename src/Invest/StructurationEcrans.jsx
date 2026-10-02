// src/Invest/StructurationEcrans.jsx — « Cadrage & conformité » et « Mise en œuvre & suivi »
// de la page Structuration. Les points viennent de structurationParcours.mjs (module pur) ; ici on n'affiche
// que, et on remonte chaque saisie par `onChange(bloc, patch)` (la sauvegarde reste celle de la page).
import React from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { Plus, Trash2 } from "lucide-react";
import { SU, WA, DA } from "./_shared";
import {
  conformiteVide, miseEnOeuvreVide, INTERVENANTS_TYPES, STATUTS_INTERVENANT, STATUTS_ACTION, STATUTS_LETTRE,
} from "./structurationParcours.mjs";

function Carte({ T, titre, aide, children, action }) {
  return (
    <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>{titre}</h3>{action}
      </div>
      {aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: SPACING.sm, maxWidth: 760 }}>{aide}</div>}
      {children}
    </section>
  );
}
const Ligne = ({ T, libelle, aide, children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
    <div><div style={{ fontSize: FONT.sm.size + 1, fontWeight: 700, color: T.text }}>{libelle}</div>{aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{aide}</div>}</div>
    <div>{children}</div>
  </div>
);
const Case = ({ valeur, onChange, T, oui = "Fait" }) => (
  <button type="button" onClick={() => onChange(!valeur)} className="inv-btn inv-btn-sm"
    style={{ background: valeur ? `${SU}18` : T.input, color: valeur ? SU : T.textSub, border: `1px solid ${valeur ? SU : T.border}` }}>
    {valeur ? `✓ ${oui}` : "À faire"}
  </button>
);

export function CadrageConformite({ data, T, onChange, qualification, onQualification }) {
  const c = { ...conformiteVide(), ...(data.conformite || {}) };
  const set = (patch) => onChange("conformite", { ...c, ...patch });
  const rgpd = qualification?.consentement_rgpd;
  const rgpdOk = !!rgpd && rgpd !== "À obtenir";
  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <Carte T={T} titre="Entrée en relation" aide="Avant toute recommandation, le client doit avoir reçu le document d'entrée en relation (identité du cabinet, statuts réglementaires, rémunération, réclamations) et signé la lettre de mission qui fixe le périmètre et les honoraires.">
        <Ligne T={T} libelle="Document d'entrée en relation remis" aide="À remettre dès le premier contact.">
          <input className="inv-inp" type="date" value={c.der_remis_le} onChange={(e) => set({ der_remis_le: e.target.value })} />
        </Ligne>
        <Ligne T={T} libelle="Lettre de mission" aide="Périmètre, honoraires, obligations de chacun, conflits d'intérêts.">
          <span style={{ display: "inline-flex", gap: 6 }}>
            <select className="inv-sel" value={c.lettre_statut} onChange={(e) => set({ lettre_statut: e.target.value })}>{STATUTS_LETTRE.map((s) => <option key={s}>{s}</option>)}</select>
            <input className="inv-inp" type="date" value={c.lettre_signee_le} onChange={(e) => set({ lettre_signee_le: e.target.value })} title="Date de signature" />
          </span>
        </Ligne>
        <Ligne T={T} libelle="Rémunération expliquée au client" aide="Honoraires, éventuelles commissions : à dire avant, par écrit.">
          <Case T={T} valeur={c.remuneration_expliquee} onChange={(v) => set({ remuneration_expliquee: v })} oui="Expliquée" />
        </Ligne>
      </Carte>
      <Carte T={T} titre="Connaissance du client & lutte contre le blanchiment" aide="Le questionnaire de connaissance du client se remplit dans l'onglet Recueil. Ici : les vérifications obligatoires avant d'engager une opération.">
        <Ligne T={T} libelle="Consentement RGPD" aide="Collecte et traitement des données personnelles.">
          <select className="inv-sel" value={rgpd || "À obtenir"} onChange={(e) => onQualification("consentement_rgpd", e.target.value)}>
            <option>À obtenir</option><option>Obtenu</option>
          </select>
          {rgpdOk ? null : <span style={{ marginLeft: 8, color: WA, fontSize: FONT.xs.size + 1 }}>à obtenir</span>}
        </Ligne>
        <Ligne T={T} libelle="Identité vérifiée" aide="Pièce d'identité contrôlée (et bénéficiaires effectifs si le client agit par une société)."><Case T={T} valeur={c.identite_verifiee} onChange={(v) => set({ identite_verifiee: v })} oui="Vérifiée" /></Ligne>
        <Ligne T={T} libelle="Origine des fonds vérifiée" aide="Apport, épargne, produit de cession : justifiés par des pièces."><Case T={T} valeur={c.origine_fonds_verifiee} onChange={(v) => set({ origine_fonds_verifiee: v })} oui="Vérifiée" /></Ligne>
      </Carte>
      <Carte T={T} titre="Avant de recommander" aide="Le conseil doit être justifié par écrit : une déclaration d'adéquation explique pourquoi la solution préconisée correspond à la situation et aux objectifs du client.">
        <Ligne T={T} libelle="Déclaration d'adéquation remise" aide="À remettre avant la mise en œuvre.">
          <input className="inv-inp" type="date" value={c.adequation_remise_le} onChange={(e) => set({ adequation_remise_le: e.target.value })} />
        </Ligne>
      </Carte>
    </div>
  );
}

export function MiseEnOeuvreSuivi({ data, T, onChange }) {
  const m = { ...miseEnOeuvreVide(), ...(data.mise_en_oeuvre || {}) };
  const set = (patch) => onChange("mise_en_oeuvre", { ...m, ...patch });
  const maj = (cle, i, patch) => set({ [cle]: m[cle].map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const retire = (cle, i) => set({ [cle]: m[cle].filter((_, j) => j !== i) });
  const id = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const faites = m.actions.filter((a) => a.statut === "Fait").length;
  const jour = new Date().toISOString().slice(0, 10);
  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <Carte T={T} titre="Rapport & restitution">
        <Ligne T={T} libelle="Rapport de restitution remis au client"><input className="inv-inp" type="date" value={m.rapport_remis_le} onChange={(e) => set({ rapport_remis_le: e.target.value })} /></Ligne>
      </Carte>
      <Carte T={T} titre="Intervenants à coordonner" aide="La structuration se met en œuvre avec d'autres professionnels : le notaire pour les actes, l'expert-comptable pour la fiscalité et les comptes de la société, la banque pour le financement."
        action={<button className="inv-btn inv-btn-sm" onClick={() => set({ intervenants: [...m.intervenants, { id: id(), role: "Notaire", nom: "", statut: "À contacter", date: "" }] })}><Icon as={Plus} size={12} />Ajouter</button>}>
        {m.intervenants.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun intervenant pour l'instant.</div>}
        {m.intervenants.map((x, i) => (
          <div key={x.id || i} style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr) 140px 140px auto", gap: 8, padding: "6px 0", alignItems: "center" }}>
            <select className="inv-sel" value={x.role} onChange={(e) => maj("intervenants", i, { role: e.target.value })}>{INTERVENANTS_TYPES.map((r) => <option key={r}>{r}</option>)}</select>
            <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Nom et coordonnées" value={x.nom} onChange={(e) => maj("intervenants", i, { nom: e.target.value })} />
            <select className="inv-sel" value={x.statut} onChange={(e) => maj("intervenants", i, { statut: e.target.value })}>{STATUTS_INTERVENANT.map((r) => <option key={r}>{r}</option>)}</select>
            <input className="inv-inp" type="date" value={x.date} onChange={(e) => maj("intervenants", i, { date: e.target.value })} />
            <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retire("intervenants", i)} aria-label="Retirer"><Icon as={Trash2} size={11} /></button>
          </div>
        ))}
      </Carte>
      <Carte T={T} titre={`Actions de mise en œuvre ${m.actions.length ? `· ${faites}/${m.actions.length}` : ""}`}
        aide="Une ligne par acte ou démarche : création de la société, rédaction des statuts, apport des biens, donation des parts, refinancement, immatriculation…"
        action={<button className="inv-btn inv-btn-sm" onClick={() => set({ actions: [...m.actions, { id: id(), titre: "", responsable: "", echeance: "", statut: "À faire" }] })}><Icon as={Plus} size={12} />Ajouter</button>}>
        {m.actions.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucune action planifiée.</div>}
        {m.actions.map((a, i) => {
          const retard = a.statut !== "Fait" && a.echeance && a.echeance < jour;
          return (
            <div key={a.id || i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 150px 120px auto", gap: 8, padding: "6px 0", alignItems: "center" }}>
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Acte ou démarche" value={a.titre} onChange={(e) => maj("actions", i, { titre: e.target.value })} />
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Responsable" value={a.responsable} onChange={(e) => maj("actions", i, { responsable: e.target.value })} />
              <input className="inv-inp" style={{ textAlign: "left" }} placeholder="Dépend de…" value={a.dependance || ""} onChange={(e) => maj("actions", i, { dependance: e.target.value })} />
              <input className="inv-inp" type="date" value={a.echeance} onChange={(e) => maj("actions", i, { echeance: e.target.value })} style={retard ? { borderColor: DA } : undefined} title={retard ? "Échéance dépassée" : ""} />
              <select className="inv-sel" value={a.statut} onChange={(e) => maj("actions", i, { statut: e.target.value })}>{STATUTS_ACTION.map((s) => <option key={s}>{s}</option>)}</select>
              <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => retire("actions", i)} aria-label="Retirer"><Icon as={Trash2} size={11} /></button>
            </div>
          );
        })}
      </Carte>
      <Carte T={T} titre="Suivi dans la durée" aide="Un patrimoine évolue (revenus, famille, fiscalité, marché) : on fixe une revue périodique, au moins annuelle.">
        <Ligne T={T} libelle="Prochaine revue patrimoniale"><input className="inv-inp" type="date" value={m.prochaine_revue_le} onChange={(e) => set({ prochaine_revue_le: e.target.value })} /></Ligne>
      </Carte>
    </div>
  );
}
