// src/Invest/crm/CrmV2.jsx — CRM V2 (Chantier V2-01, refonte UX du 01/10/2026).
//
// Outil de PILOTAGE du portefeuille, pas une fiche : trois vues compactes.
//   À traiter           les missions qui demandent une action, une ligne chacune
//   Clients             la base clients en tableau dense
//   Actions & planning  qui fait quoi, quand (en retard, aujourd'hui, 7 j, 30 j, sans échéance)
// Un clic ouvre la page Client (FicheClientV2) ou la mission (Fiche Dossier).
//
// Une information = un emplacement : l'alerte dit POURQUOI, l'échéance dit QUAND, la balle dit
// QUI. Couleurs : rouge = retard ou blocage, orange = à faire bientôt, violet = attente client.
// Calculs : crmV2Vue.mjs (qui lit pilotage.mjs). Aucune écriture ici.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { readNavTarget } from "../_shared";
import FicheClientV2 from "./FicheClientV2";
import { VUES_CRM, FILTRES_A_TRAITER, missionsAPiloter, compteursATraiter, filtrerMissions, portefeuille, planningActions, nomClient, alertesMission, echeanceCourte, filtrerPortefeuille } from "./crmV2Vue";
import { ATraiterCartes, ClientsCartes } from "./CrmCartes";
import { FilAriane, Onglets, Discret, Vide, dateFr, aujourdhuiIso, ROUGE, ORANGE, GRIS } from "./ui";

const VIOLET = "#7c3aed";
const TON = { rouge: ROUGE, orange: ORANGE, violet: VIOLET, neutre: GRIS };
const COULEUR_COMPTEUR = { enRetard: ROUGE, bloquees: ROUGE, aujourdhui: ORANGE, attenteClient: VIOLET };
const CSS = `
  .crm-v2{padding:14px 20px 40px;max-width:1760px;margin:0 auto}
  .crm-lig{display:grid;gap:12px;align-items:center;padding:7px 12px;border-bottom:1px solid var(--crm-bord);font-size:13px;min-width:0}
  .crm-lig:hover{background:var(--crm-survol)}
  .crm-ent{display:grid;gap:12px;padding:0 12px 6px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--crm-doux)}
  .crm-cel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crm-clic{cursor:pointer}
  @media (max-width:1100px){.crm-ent{display:none}.crm-lig{grid-template-columns:1fr !important;gap:2px;padding:10px 12px}.crm-cel{white-space:normal}.crm-v2{padding:12px 12px 40px}}
`;
const Alerte = ({ ton, children, titre }) => (
  <span title={titre} style={{ fontSize: 11.5, fontWeight: 800, color: TON[ton], background: `${TON[ton]}14`, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" }}>{children}</span>
);

export default function CrmV2({ profil, T, initialFilter, onAncienneVue, onOpenStructuration, renderNouveauClient }) {
  const [donnees, setDonnees] = useState(null);
  const [erreurs, setErreurs] = useState({});
  const [chargement, setChargement] = useState(true);
  const [vue, setVue] = useState("a_traiter");
  const [ecran, setEcran] = useState({ type: "crm" });
  const [nouveauClient, setNouveauClient] = useState(false);
  const aujourdhui = aujourdhuiIso();

  const charger = useCallback(async () => {
    setChargement(true);
    const [rc, rd, re, rt, ru, rn, rp] = await Promise.all([
      supabase.from("invest_clients").select("id,nom,prenom,email,telephone,statut,conseiller,created_at,sujet_structuration").order("nom"),
      supabase.from("invest_dossiers").select("id,client_id,reference,libelle,statut,type_mission,conseiller_id,date_ouverture,date_cloture,motif_cloture,created_at"),
      supabase.from("invest_dossier_etapes").select("id,dossier_id,operation_id,etape,statut,balle,balle_utilisateur_id,balle_tiers_libelle,prochaine_action,echeance,blocage_motif,bloquee_depuis,reprise_a_confirmer,updated_at").is("operation_id", null).limit(10000),
      supabase.from("invest_mission_actions").select("id,client_id,dossier_id,etape,action_title,status,due_date,responsable").limit(10000),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
      supabase.from("invest_notes").select("client_id,type,date,created_at").limit(10000),
      supabase.from("invest_portail_comptes").select("client_id,statut,invite_le").order("invite_le", { ascending: true }),
    ]);
    setErreurs({ clients: rc.error?.message, pilotage: (rd.error || re.error)?.message, actions: rt.error?.message, notes: rn.error?.message });
    setDonnees({ clients: rc.data || [], dossiers: rd.data || [], etapes: re.data || [], taches: rt.data || [], utilisateurs: ru.data || [], notes: rn.data || [],
      pilotageLisible: !rd.error && !re.error && !rt.error,
      // client_id -> "actif" | "revoque" ; null si la table n'est pas lisible (droits) : on n'affiche alors aucun état.
      comptesPortail: rp.error ? null : new Map((rp.data || []).map((x) => [x.client_id, x.statut])) });
    setChargement(false);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // Cibles de navigation (Dashboard, notifications ; PageInvest traduit aussi le lien direct ?crm_client=).
  useEffect(() => {
    const cible = readNavTarget(initialFilter);
    if ((cible.action === "open" || cible.action === "actions") && cible.id) setEcran({ type: "client", clientId: cible.id, onglet: initialFilter?.onglet });
    else if (cible.action === "filter" && cible.key === "statut") { setVue("clients"); setEcran({ type: "crm" }); }
  }, [initialFilter]);

  const missions = useMemo(() => donnees && donnees.pilotageLisible
    ? missionsAPiloter({ ...donnees, aujourdhui }) : null, [donnees, aujourdhui]);

  const retourCrm = () => { setEcran({ type: "crm" }); charger(); };
  const ouvrirClient = (clientId, onglet) => setEcran({ type: "client", clientId, onglet });
  // La mission s'ouvre dans l'onglet Missions de la fiche client (plus de page séparée).
  const ouvrirMission = (clientId, dossierId) => setEcran({ type: "client", clientId, missionInitiale: dossierId });

  const cadre = (contenu) => (
    <div className="crm-v2" style={{ "--crm-bord": T.rowBorder || T.border, "--crm-survol": T.cardHover || "rgba(127,127,127,.06)", "--crm-doux": T.textMuted }}>
      <style>{CSS}</style>
      {contenu}
    </div>
  );

  if (ecran.type === "client") {
    return cadre(<FicheClientV2 key={ecran.clientId + (ecran.missionInitiale || "")} clientId={ecran.clientId} ongletInitial={ecran.onglet} missionInitiale={ecran.missionInitiale || null} profil={profil} T={T}
      onRetour={retourCrm} />);
  }
  return cadre(
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: T.text, letterSpacing: -0.3 }}>CRM</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="inv-btn inv-btn-sm" onClick={charger} disabled={chargement}>{chargement ? "Chargement…" : "Actualiser"}</button>
          <button className="inv-btn inv-btn-sm" onClick={onAncienneVue} title="L'ancienne interface reste disponible pendant la transition">Ancienne vue CRM</button>
          {renderNouveauClient && <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={() => setNouveauClient(true)}>＋ Nouveau client</button>}
        </div>
      </header>
      <Onglets T={T} compact onglets={VUES_CRM} actif={vue} onChange={setVue} />

      {!donnees ? <Discret T={T}>Chargement du portefeuille…</Discret> : (
        <>
          {vue === "a_traiter" && <ATraiterCartes T={T} missions={missions} erreur={erreurs.pilotage || erreurs.actions} aujourdhui={aujourdhui} onMission={ouvrirMission} onClient={ouvrirClient} />}
          {vue === "clients" && <ClientsCartes T={T} donnees={donnees} missions={missions} comptesPortail={donnees.comptesPortail} erreur={erreurs.clients} aujourdhui={aujourdhui} profil={profil} onClient={ouvrirClient} onInvitationFermee={charger} />}
          {vue === "planning" && <Planning T={T} donnees={donnees} erreur={erreurs.actions} aujourdhui={aujourdhui} onMission={ouvrirMission} onClient={ouvrirClient} />}
        </>
      )}
      {nouveauClient && renderNouveauClient({ onFerme: () => setNouveauClient(false), onCree: () => { setNouveauClient(false); charger(); } })}
    </>
  );
}

// ── Actions & planning ───────────────────────────────────────────────────────
const COL_PLANNING = "76px minmax(0,1.1fr) minmax(0,.7fr) minmax(0,.8fr) minmax(0,2fr) minmax(0,.9fr) 78px";

function Planning({ T, donnees, erreur, aujourdhui, onMission, onClient }) {
  const [filtres, setFiltres] = useState({ conseiller: "", dossierId: "", clientId: "" });
  const [voirSans, setVoirSans] = useState(false);
  const p = useMemo(() => planningActions({ ...donnees, aujourdhui, filtres }), [donnees, aujourdhui, filtres]);
  if (erreur) return <Vide T={T} titre="Actions illisibles" texte={`Le planning ne peut pas être affiché (${erreur}).`} />;
  const ouvertes = donnees.dossiers.filter((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)).sort((a, b) => String(a.reference).localeCompare(String(b.reference)));
  const clientsAvecActions = donnees.clients.filter((c) => donnees.taches.some((t) => t.client_id === c.id)).sort((a, b) => nomClient(a).localeCompare(nomClient(b), "fr"));
  const maj = (k) => (e) => setFiltres((f) => ({ ...f, [k]: e.target.value }));
  const groupes = [["enRetard", "En retard", ROUGE, p.enRetard], ["aujourdhui", "Aujourd'hui", ORANGE, p.aujourdhui], ["semaine", "7 prochains jours", T.textSub, p.semaine], ["mois", "30 prochains jours", T.textSub, p.mois]];
  const ligne = (a, rouge) => (
    <div key={a.id} className="crm-lig crm-clic" role="button" tabIndex={0} style={{ gridTemplateColumns: COL_PLANNING }}
      onClick={() => (a.dossierId ? onMission(a.clientId, a.dossierId) : onClient(a.clientId))} onKeyDown={(e) => { if (e.key === "Enter") (a.dossierId ? onMission(a.clientId, a.dossierId) : onClient(a.clientId)); }}>
      <div className="crm-cel" style={{ fontWeight: 800, color: rouge ? ROUGE : T.textSub }}>{a.echeance ? dateFr(a.echeance).slice(0, 5) : "—"}</div>
      <div className="crm-cel" style={{ fontWeight: 800, color: T.text }}>{a.client}</div>
      <div className="crm-cel" style={{ color: T.textMuted }}>{a.mission}</div>
      <div className="crm-cel" style={{ color: T.textSub }}>{a.etape}</div>
      <div className="crm-cel" style={{ fontWeight: 700, color: T.text }} title={a.titre}>{a.titre}</div>
      <div className="crm-cel" style={{ color: T.textSub }}>{a.responsable || "—"}</div>
      <div className="crm-cel" style={{ color: a.statut === "Bloquée" ? ROUGE : T.textMuted, fontWeight: a.statut === "Bloquée" ? 800 : 500 }}>{a.statut}</div>
    </div>
  );
  const titreGroupe = (titre, couleur, n) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "14px 12px 6px", borderBottom: `1px solid ${T.border}` }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: couleur }}>{titre}</span>
      <span style={{ fontSize: 12, fontWeight: 800, color: T.textMuted }}>{n}</span>
    </div>
  );
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "2px 0 4px" }}>
        <select className="inv-sel" value={filtres.conseiller} onChange={maj("conseiller")} aria-label="Collaborateur"><option value="">Tous les collaborateurs</option>{p.options.conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={filtres.dossierId} onChange={maj("dossierId")} aria-label="Mission"><option value="">Toutes les missions</option>{ouvertes.map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}<option value="sans">Hors mission</option></select>
        <select className="inv-sel" value={filtres.clientId} onChange={maj("clientId")} aria-label="Client"><option value="">Tous les clients</option>{clientsAvecActions.map((c) => <option key={c.id} value={c.id}>{nomClient(c)}</option>)}</select>
      </div>
      <div className="crm-ent" style={{ gridTemplateColumns: COL_PLANNING, marginTop: 10 }}>
        <span>Date</span><span>Client</span><span>Mission</span><span>Étape</span><span>Action</span><span>Responsable</span><span>Statut</span>
      </div>
      {groupes.map(([cle, titre, couleur, items]) => (
        <section key={cle}>
          {titreGroupe(titre, couleur, items.length)}
          {items.length === 0 ? <Discret T={T} style={{ padding: "8px 12px" }}>Aucune action.</Discret> : items.map((a) => ligne(a, cle === "enRetard"))}
        </section>
      ))}
      <section>
        {titreGroupe("Sans échéance", T.textSub, p.sansEcheance)}
        {p.sansEcheance === 0 ? <Discret T={T} style={{ padding: "8px 12px" }}>Aucune action.</Discret>
          : voirSans ? p.sansEcheanceListe.map((a) => ligne(a, false))
          : <div style={{ padding: "8px 12px" }}><button className="inv-btn inv-btn-sm" onClick={() => setVoirSans(true)}>Afficher les {p.sansEcheance} actions sans échéance</button></div>}
      </section>
      {p.auDela > 0 && <Discret T={T} style={{ marginTop: 14, padding: "0 12px" }}>{p.auDela} autre{p.auDela > 1 ? "s" : ""} action{p.auDela > 1 ? "s" : ""} au-delà de 30 jours.</Discret>}
    </>
  );
}
