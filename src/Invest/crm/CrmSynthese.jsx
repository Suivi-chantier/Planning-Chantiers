// src/Invest/crm/CrmSynthese.jsx — Vue « Synthèse » du CRM (vue par défaut) : une ligne par client.
//
// Bandeau d'indicateurs cliquables, filtres combinables (conseiller, statut, étape, budget, recherche active,
// alertes), tableau compact. Lecture seule : un clic ouvre la fiche client. Calculs : avancementVue.mjs.
import React, { useMemo, useState } from "react";
import { ETAPES_PARCOURS } from "../dossiers/parcours";
import { KPI_SYNTHESE, ALERTES_SYNTHESE, compteursSynthese, filtrerSynthese, attentionRequise, SEUIL_INACTIVITE_DEFAUT } from "./avancementVue";
import { echeanceCourte } from "./crmV2Vue";
import { Compteur, Discret, Vide, dateFr, eur, ROUGE, ORANGE, GRIS, VERT, BLEU } from "./ui";

const VIOLET = "#7c3aed";
const TON = { rouge: ROUGE, orange: ORANGE, violet: VIOLET, neutre: GRIS, vert: VERT, bleu: BLEU, gris: GRIS };
const COULEUR_KPI = { tous: BLEU, actifs: VERT, recherche: BLEU, attente: VIOLET, termines: GRIS, retard: ROUGE };
const COLONNES = "minmax(150px,1.3fr) 104px 84px 96px 104px 132px 128px 92px minmax(150px,1.5fr) minmax(170px,1.4fr)";
const TRANCHES = [["", "Tous budgets"], ["0-150", "Moins de 150 k€"], ["150-300", "150 à 300 k€"], ["300-500", "300 à 500 k€"], ["500-", "Plus de 500 k€"]];
const SEUILS = [[14, "14 jours"], [SEUIL_INACTIVITE_DEFAUT, `${SEUIL_INACTIVITE_DEFAUT} jours`], [30, "30 jours"], [60, "60 jours"]];
const STATUTS_CLIENT = ["Prospect", "Actif", "En attente", "En pause", "Inactif", "Terminé"];

export const bornesBudget = (tranche) => {
  if (!tranche) return { budgetMin: null, budgetMax: null };
  const [a, b] = tranche.split("-");
  return { budgetMin: a ? Number(a) * 1000 : null, budgetMax: b ? Number(b) * 1000 : null };
};

function Echeance({ T, iso, aujourdhui }) {
  if (!iso) return <span style={{ color: T.textMuted }}>sans date</span>;
  const e = echeanceCourte(iso, aujourdhui);
  return <span style={{ color: e.ton === "neutre" ? T.textSub : TON[e.ton], fontWeight: 800 }}>{e.texte}</span>;
}

export default function CrmSynthese({ T, lignes, erreur, estMoi, aujourdhui, seuil, setSeuil, onClient }) {
  const [filtres, setFiltres] = useState({ q: "", conseiller: "", statutClient: "", etape: "", tranche: "", recherche: "", alerte: "", kpi: "tous" });
  const [mesClients, setMesClients] = useState(false);
  const maj = (k) => (e) => setFiltres((f) => ({ ...f, [k]: e.target.value }));
  const conseillers = useMemo(() => [...new Set(lignes.map((l) => l.conseiller).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [lignes]);
  const statuts = useMemo(() => [...new Set([...STATUTS_CLIENT, ...lignes.map((l) => l.statutClient)])], [lignes]);
  const perimetre = useMemo(() => (mesClients ? lignes.filter((l) => estMoi(l.conseiller)) : lignes), [lignes, mesClients, estMoi]);
  const base = useMemo(() => filtrerSynthese(perimetre, { ...filtres, ...bornesBudget(filtres.tranche), kpi: "tous" }), [perimetre, filtres]);
  const compteurs = useMemo(() => compteursSynthese(base), [base]);
  const visibles = useMemo(() => filtrerSynthese(base, { kpi: filtres.kpi }), [base, filtres.kpi]);
  const filtresActifs = Object.entries(filtres).some(([k, v]) => v && !(k === "kpi" && v === "tous")) || mesClients;
  const reinit = () => { setFiltres({ q: "", conseiller: "", statutClient: "", etape: "", tranche: "", recherche: "", alerte: "", kpi: "tous" }); setMesClients(false); };

  if (erreur) return <Vide T={T} titre="Clients illisibles" texte={erreur} />;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 12 }}>
        {KPI_SYNTHESE.map((k) => (
          <Compteur key={k.cle} T={T} libelle={k.libelle} valeur={compteurs[k.cle]} couleur={COULEUR_KPI[k.cle]} actif={filtres.kpi === k.cle}
            onClick={() => setFiltres((f) => ({ ...f, kpi: f.kpi === k.cle ? "tous" : k.cle }))} />
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 200, flex: "1 1 200px", maxWidth: 300 }} placeholder="Rechercher un client…" value={filtres.q} onChange={maj("q")} aria-label="Rechercher un client" />
        <button className={`inv-btn inv-btn-sm ${mesClients ? "inv-btn-gold" : ""}`} onClick={() => setMesClients((v) => !v)} aria-pressed={mesClients}>Mes clients</button>
        <select className="inv-sel" value={filtres.conseiller} onChange={maj("conseiller")} aria-label="Conseiller"><option value="">Tous les conseillers</option>{conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={filtres.statutClient} onChange={maj("statutClient")} aria-label="Statut du client"><option value="">Tous statuts</option>{statuts.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="inv-sel" value={filtres.etape} onChange={maj("etape")} aria-label="Étape actuelle"><option value="">Toutes étapes</option>{ETAPES_PARCOURS.map((e) => <option key={e.cle} value={e.cle}>{e.numero}. {e.libelle}</option>)}</select>
        <select className="inv-sel" value={filtres.tranche} onChange={maj("tranche")} aria-label="Budget">{TRANCHES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="inv-sel" value={filtres.recherche} onChange={maj("recherche")} aria-label="Recherche active"><option value="">Recherche : toutes</option><option value="active">Recherche active</option><option value="non_active">Pas en recherche</option></select>
        <select className="inv-sel" value={filtres.alerte} onChange={maj("alerte")} aria-label="Alertes"><option value="">Toutes alertes</option>{Object.entries(ALERTES_SYNTHESE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <label style={{ fontSize: 12.5, color: T.textSub, display: "inline-flex", gap: 6, alignItems: "center" }} title="Au-delà, un dossier est signalé « sans activité récente »">
          Inactif après
          <select className="inv-sel" value={seuil} onChange={(e) => setSeuil(Number(e.target.value))} aria-label="Seuil d'inactivité">{SEUILS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        {filtresActifs && <button className="inv-btn inv-btn-sm" onClick={reinit}>Réinitialiser</button>}
        <Discret T={T} style={{ marginLeft: "auto" }}>{visibles.length} client{visibles.length > 1 ? "s" : ""}</Discret>
      </div>

      <div className="crm-ent" style={{ gridTemplateColumns: COLONNES }}>
        <span>Client</span><span>Conseiller</span><span>Budget</span><span>Objectif</span><span>Secteur</span><span>Statut</span><span>Étape actuelle</span><span>Dernier échange</span><span>Dernier commentaire</span><span>Prochaine action</span>
      </div>
      {visibles.length === 0 ? <Vide T={T} titre="Aucun client" texte="Aucun client ne correspond aux filtres." /> : visibles.map((l) => {
        const motifs = attentionRequise(l.signaux);
        const couleur = motifs.some((m) => m.ton === "rouge") ? ROUGE : motifs.length ? ORANGE : "transparent";
        return (
          <div key={l.id} className="crm-lig crm-clic" role="button" tabIndex={0} style={{ gridTemplateColumns: COLONNES, borderLeft: `3px solid ${couleur}` }}
            onClick={() => onClient(l.id)} onKeyDown={(e) => { if (e.key === "Enter") onClient(l.id); }}>
            <div className="crm-cel" title={motifs.map((m) => m.libelle).join(" · ")}>
              <b style={{ color: T.text, fontSize: 13.5 }}>{l.nom}</b>
              <div style={{ fontSize: 11, color: T.textMuted }}>
                {l.nbProjetsEnCours + l.nbProjetsTermines === 0 ? "Aucun projet"
                  : [l.nbProjetsEnCours ? `${l.nbProjetsEnCours} en cours` : null, l.nbProjetsTermines ? `${l.nbProjetsTermines} terminé${l.nbProjetsTermines > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ")}
                {l.signaux.pretNouvelInvestissement && <span style={{ color: VERT, fontWeight: 800 }}> · prêt pour un nouvel investissement</span>}
              </div>
            </div>
            <div className="crm-cel" style={{ color: T.textSub }}>{l.conseiller || <span style={{ color: T.textMuted }}>—</span>}</div>
            <div className="crm-cel" style={{ color: T.text, fontWeight: 700 }}>{l.budget ? eur(l.budget) : <span style={{ color: T.textMuted, fontWeight: 500 }}>—</span>}</div>
            <div className="crm-cel" style={{ color: T.textSub }} title={l.objectif || ""}>{l.objectif || <span style={{ color: T.textMuted }}>—</span>}</div>
            <div className="crm-cel" style={{ color: T.textSub }} title={l.secteur || ""}>{l.secteur || <span style={{ color: T.textMuted }}>—</span>}</div>
            <div className="crm-cel">
              <div style={{ color: T.text, fontWeight: 700, fontSize: 12.5 }}>{l.statutClient}</div>
              <div style={{ fontSize: 11, color: T.textMuted }}>{l.statutRecherche}</div>
            </div>
            <div className="crm-cel" style={{ color: T.textSub }}>
              {l.etapeActuelle ? <><b style={{ color: l.etapeActuelle.statut === "bloquee" ? ROUGE : T.text }}>{l.etapeActuelle.libelle}</b> <span style={{ color: T.textMuted }}>{l.etapeActuelle.numero}/{ETAPES_PARCOURS.length}</span></> : <span style={{ color: T.textMuted }}>—</span>}
              {l.nbProjetsEnCours > 1 && <div style={{ fontSize: 11, color: T.textMuted }}>+ {l.nbProjetsEnCours - 1} autre{l.nbProjetsEnCours > 2 ? "s" : ""} projet{l.nbProjetsEnCours > 2 ? "s" : ""}</div>}
            </div>
            <div className="crm-cel" style={{ color: l.signaux.inactif ? ORANGE : T.textSub, fontWeight: l.signaux.inactif ? 800 : 500 }} title={l.signaux.inactif ? "Sans activité récente" : ""}>
              {l.dernierEchange ? dateFr(l.dernierEchange).slice(0, 5) : <span style={{ color: T.textMuted }}>aucun</span>}
            </div>
            <div className="crm-cel" style={{ color: T.textSub }} title={l.dernierCommentaire ? `${dateFr(l.dernierCommentaire.quand)} · ${l.dernierCommentaire.source}${l.dernierCommentaire.auteur ? ` · ${l.dernierCommentaire.auteur}` : ""} : ${l.dernierCommentaire.texte}` : ""}>
              {l.dernierCommentaire ? <>{l.dernierCommentaire.quand && <span style={{ color: T.textMuted }}>{dateFr(l.dernierCommentaire.quand).slice(0, 5)} · </span>}{l.dernierCommentaire.texte}</> : <span style={{ color: T.textMuted }}>—</span>}
            </div>
            <div className="crm-cel">
              {l.actionIndisponible ? <span style={{ color: ORANGE }}>Avancement indisponible</span>
                : l.prochaineAction ? <><span style={{ color: T.text, fontWeight: 700 }} title={l.prochaineAction}>{l.prochaineAction}</span> · <Echeance T={T} iso={l.echeance} aujourdhui={aujourdhui} /></>
                : l.signaux.sansAction ? <span style={{ color: ORANGE, fontWeight: 800 }}>Aucune action prévue</span> : <span style={{ color: T.textMuted }}>—</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}
