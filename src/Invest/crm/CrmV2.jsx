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
import FicheDossier from "../dossiers/FicheDossier";
import FicheClientV2 from "./FicheClientV2";
import { VUES_CRM, FILTRES_A_TRAITER, missionsAPiloter, compteursATraiter, filtrerMissions, portefeuille, planningActions, nomClient, alertesMission, echeanceCourte, filtrerPortefeuille } from "./crmV2Vue";
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
    const [rc, rd, re, rt, ru, rn] = await Promise.all([
      supabase.from("invest_clients").select("id,nom,prenom,email,telephone,statut,conseiller,created_at").order("nom"),
      supabase.from("invest_dossiers").select("id,client_id,reference,libelle,statut,type_mission,conseiller_id,date_ouverture,date_cloture,motif_cloture,created_at"),
      supabase.from("invest_dossier_etapes").select("id,dossier_id,operation_id,etape,statut,balle,balle_utilisateur_id,balle_tiers_libelle,prochaine_action,echeance,blocage_motif,bloquee_depuis,reprise_a_confirmer,updated_at").is("operation_id", null).limit(10000),
      supabase.from("invest_mission_actions").select("id,client_id,dossier_id,etape,action_title,status,due_date,responsable").limit(10000),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
      supabase.from("invest_notes").select("client_id,type,date,created_at").limit(10000),
    ]);
    setErreurs({ clients: rc.error?.message, pilotage: (rd.error || re.error)?.message, actions: rt.error?.message, notes: rn.error?.message });
    setDonnees({ clients: rc.data || [], dossiers: rd.data || [], etapes: re.data || [], taches: rt.data || [], utilisateurs: ru.data || [], notes: rn.data || [],
      pilotageLisible: !rd.error && !re.error && !rt.error });
    setChargement(false);
  }, []);
  useEffect(() => { charger(); }, [charger]);

  // Cibles de navigation (Dashboard, notifications ; PageInvest traduit aussi le lien direct ?crm_client=).
  useEffect(() => {
    const cible = readNavTarget(initialFilter);
    if ((cible.action === "open" || cible.action === "actions") && cible.id) setEcran({ type: "client", clientId: cible.id });
    else if (cible.action === "filter" && cible.key === "statut") { setVue("clients"); setEcran({ type: "crm" }); }
  }, [initialFilter]);

  const missions = useMemo(() => donnees && donnees.pilotageLisible
    ? missionsAPiloter({ ...donnees, aujourdhui }) : null, [donnees, aujourdhui]);

  const retourCrm = () => { setEcran({ type: "crm" }); charger(); };
  const ouvrirClient = (clientId, onglet) => setEcran({ type: "client", clientId, onglet });
  const ouvrirMission = (clientId, dossierId) => setEcran({ type: "mission", clientId, dossierId });

  const cadre = (contenu) => (
    <div className="crm-v2" style={{ "--crm-bord": T.rowBorder || T.border, "--crm-survol": T.cardHover || "rgba(127,127,127,.06)", "--crm-doux": T.textMuted }}>
      <style>{CSS}</style>
      {contenu}
    </div>
  );

  if (ecran.type === "client") {
    return cadre(<FicheClientV2 key={ecran.clientId} clientId={ecran.clientId} ongletInitial={ecran.onglet} profil={profil} T={T}
      onRetour={retourCrm} onOuvrirMission={(dossierId) => ouvrirMission(ecran.clientId, dossierId)} onOpenStructuration={onOpenStructuration} />);
  }
  if (ecran.type === "mission") {
    return cadre(<PageMission clientId={ecran.clientId} dossierId={ecran.dossierId} profil={profil} T={T}
      onCrm={retourCrm} onClient={() => ouvrirClient(ecran.clientId, "ensemble")} />);
  }

  const cpt = missions ? compteursATraiter(missions) : null;
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
          {vue === "a_traiter" && <ATraiter T={T} missions={missions} compteurs={cpt} erreur={erreurs.pilotage || erreurs.actions} aujourdhui={aujourdhui} onMission={ouvrirMission} onClient={ouvrirClient} onVoirClients={() => setVue("clients")} />}
          {vue === "clients" && <Clients T={T} donnees={donnees} missions={missions} erreur={erreurs.clients} aujourdhui={aujourdhui} onClient={ouvrirClient} />}
          {vue === "planning" && <Planning T={T} donnees={donnees} erreur={erreurs.actions} aujourdhui={aujourdhui} onMission={ouvrirMission} onClient={ouvrirClient} />}
        </>
      )}
      {nouveauClient && renderNouveauClient({ onFerme: () => setNouveauClient(false), onCree: () => { setNouveauClient(false); charger(); } })}
    </>
  );
}

// ── À traiter ────────────────────────────────────────────────────────────────
const COL_TRAITER = "minmax(0,1.25fr) minmax(0,.9fr) minmax(0,1.7fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)";

function ATraiter({ T, missions, compteurs, erreur, aujourdhui, onMission, onClient, onVoirClients }) {
  const [filtre, setFiltre] = useState(null);
  if (!missions) return <Vide T={T} titre="Avancement des missions indisponible" texte={`Les missions n'ont pas pu être lues, la liste à traiter ne peut donc pas être établie${erreur ? ` (${erreur})` : ""}. Réessayez avec « Actualiser ».`} />;
  const liste = filtre ? filtrerMissions(missions, filtre) : missions.filter((m) => m.urgent);
  const suivent = filtre ? 0 : missions.length - liste.length;
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "2px 0 10px" }}>
        {Object.entries(FILTRES_A_TRAITER).map(([cle, libelle]) => {
          const on = filtre === cle, n = compteurs[cle], c = COULEUR_COMPTEUR[cle];
          return (
            <button key={cle} aria-pressed={on} onClick={() => setFiltre(on ? null : cle)}
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 7, padding: "5px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                border: `1.5px solid ${on ? c : (T.border)}`, background: on ? `${c}12` : "transparent", color: T.textSub }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: n ? c : T.textMuted }}>{n}</span>{libelle}
            </button>
          );
        })}
        <Discret T={T} style={{ marginLeft: "auto" }}>{liste.length} mission{liste.length > 1 ? "s" : ""}{filtre ? ` · ${FILTRES_A_TRAITER[filtre].toLowerCase()}` : " à traiter"}
          {filtre && <button className="inv-btn inv-btn-sm" style={{ marginLeft: 8 }} onClick={() => setFiltre(null)}>Tout afficher</button>}</Discret>
      </div>
      {missions.length === 0 ? <Vide T={T} titre="Aucune mission en cours" texte="Les missions démarrées depuis une fiche client apparaîtront ici." />
        : liste.length === 0 ? <Vide T={T} titre="Rien d'urgent" texte={filtre ? "Aucune mission dans cette catégorie." : "Aucune mission en retard, bloquée, à faire aujourd'hui ou sans prochaine action."} />
        : (
          <>
            <div className="crm-ent" style={{ gridTemplateColumns: COL_TRAITER }}>
              <span>Client · mission</span><span>Étape</span><span>Prochaine action</span><span>Échéance</span><span>Balle</span><span>Alerte</span>
            </div>
            <div>{liste.map((m) => <LigneMission key={m.dossierId} T={T} m={m} aujourdhui={aujourdhui} onMission={onMission} onClient={onClient} />)}</div>
          </>
        )}
      {suivent > 0 && <Discret T={T} style={{ marginTop: 12 }}>{suivent} autre{suivent > 1 ? "s" : ""} mission{suivent > 1 ? "s" : ""} suivent leur cours (attente d'un tiers, échéance lointaine). <button onClick={onVoirClients} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", color: T.accent, fontWeight: 800, fontSize: 12.5 }}>Voir les clients</button></Discret>}
    </>
  );
}

function LigneMission({ T, m, aujourdhui, onMission, onClient }) {
  const alertes = alertesMission(m, aujourdhui);
  const principale = alertes[0], autres = alertes.slice(1);
  const ech = echeanceCourte(m.echeance, aujourdhui);
  const couleur = principale ? TON[principale.ton] : "transparent";
  return (
    <div className="crm-lig crm-clic" role="button" tabIndex={0} onClick={() => onMission(m.clientId, m.dossierId)} onKeyDown={(e) => { if (e.key === "Enter") onMission(m.clientId, m.dossierId); }}
      style={{ gridTemplateColumns: COL_TRAITER, borderLeft: `3px solid ${couleur}` }}>
      <div className="crm-cel">
        <button onClick={(e) => { e.stopPropagation(); onClient(m.clientId); }} title="Ouvrir la fiche client" style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 14, fontWeight: 900, color: T.text }}>{m.client}</button>
        <span style={{ color: T.textMuted, fontSize: 12 }}> · {m.reference} · {m.offre.court || m.offre.libelle}</span>
      </div>
      <div className="crm-cel" style={{ color: T.textSub }} title={m.etapesActives.join(", ")}>{m.etape || m.jalon}</div>
      <div className="crm-cel" style={{ fontWeight: 700, color: T.text }} title={m.action}>{m.action}</div>
      <div className="crm-cel" style={{ fontWeight: 700, color: ech.ton === "neutre" ? T.textSub : TON[ech.ton] }}>{ech.texte}</div>
      <div className="crm-cel" style={{ color: m.balleType === "client" ? VIOLET : T.textSub, fontWeight: m.balleType === "client" ? 700 : 500 }} title={m.responsable ? `Responsable : ${m.responsable}` : ""}>
        {m.balle || m.responsable || "—"}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
        {principale && <Alerte ton={principale.ton} titre={principale.detail}>{principale.libelle}</Alerte>}
        {autres.length > 0 && <span title={autres.map((a) => a.libelle + (a.detail ? ` (${a.detail})` : "")).join(" · ")} style={{ fontSize: 11.5, fontWeight: 800, color: T.textMuted }}>+{autres.length}</span>}
      </div>
    </div>
  );
}

// ── Clients ──────────────────────────────────────────────────────────────────
const COL_CLIENTS = "minmax(0,1.3fr) minmax(0,.8fr) minmax(0,.7fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,1.6fr) minmax(0,.9fr) minmax(0,.7fr)";

function Clients({ T, donnees, missions, erreur, aujourdhui, onClient }) {
  const [f, setF] = useState({ q: "", conseiller: "", statut: "", mission: "", offre: "" });
  const lignes = useMemo(() => portefeuille({ clients: donnees.clients, dossiers: donnees.dossiers, missions, notes: donnees.notes }), [donnees, missions]);
  const conseillers = [...new Set(lignes.map((l) => l.conseiller).filter(Boolean))].sort();
  const statuts = [...new Set(lignes.map((l) => l.statutRelation))].sort();
  const offres = [...new Set(lignes.flatMap((l) => l.missions.map((m) => m.offre)))].sort();
  const visibles = filtrerPortefeuille(lignes, f);
  if (erreur) return <Vide T={T} titre="Clients illisibles" texte={erreur} />;
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "2px 0 10px", alignItems: "center" }}>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 220, flex: "1 1 220px", maxWidth: 340 }} placeholder="Rechercher un client, un e-mail, un téléphone…" value={f.q} onChange={maj("q")} aria-label="Rechercher" />
        <select className="inv-sel" value={f.conseiller} onChange={maj("conseiller")} aria-label="Conseiller"><option value="">Tous les conseillers</option>{conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={f.statut} onChange={maj("statut")} aria-label="Statut de la relation"><option value="">Tous les statuts</option>{statuts.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="inv-sel" value={f.mission} onChange={maj("mission")} aria-label="Mission active"><option value="">Avec ou sans mission</option><option value="avec">Avec mission active</option><option value="sans">Sans mission active</option></select>
        {offres.length > 1 && <select className="inv-sel" value={f.offre} onChange={maj("offre")} aria-label="Offre"><option value="">Toutes les offres</option>{offres.map((o) => <option key={o}>{o}</option>)}</select>}
        <Discret T={T} style={{ marginLeft: "auto" }}>{visibles.length} client{visibles.length > 1 ? "s" : ""}</Discret>
      </div>
      {missions === null && <Discret T={T} style={{ marginBottom: 10, color: ORANGE }}>Avancement des missions indisponible : missions, étape et prochaine action ne peuvent pas être affichées.</Discret>}
      <div className="crm-ent" style={{ gridTemplateColumns: COL_CLIENTS }}>
        <span>Client</span><span>Conseiller</span><span>Statut</span><span>Mission active</span><span>Étape</span><span>Prochaine action</span><span>Échéance</span><span>Dernier contact</span>
      </div>
      <div>
        {visibles.map((l) => {
          const ech = echeanceCourte(l.echeance, aujourdhui);
          const m0 = l.missions[0];
          return (
            <div key={l.id} className="crm-lig crm-clic" role="button" tabIndex={0} onClick={() => onClient(l.id)} onKeyDown={(e) => { if (e.key === "Enter") onClient(l.id); }} style={{ gridTemplateColumns: COL_CLIENTS }}>
              <div className="crm-cel" style={{ fontWeight: 900, color: T.text, fontSize: 14 }}>{l.nom}</div>
              <div className="crm-cel" style={{ color: T.textSub }}>{l.conseiller || "—"}</div>
              <div className="crm-cel" style={{ color: T.textSub }}>{l.statutRelation}</div>
              <div className="crm-cel" style={{ color: T.textSub }} title={l.missions.map((m) => `${m.reference} · ${m.offre}`).join("\n")}>
                {m0 ? `${m0.reference} · ${m0.offre}${l.missions.length > 1 ? ` +${l.missions.length - 1}` : ""}` : <span style={{ color: T.textMuted }}>{missions === null ? "—" : `Aucune${l.missionsTerminees ? ` (${l.missionsTerminees} terminée${l.missionsTerminees > 1 ? "s" : ""})` : ""}`}</span>}
              </div>
              <div className="crm-cel" style={{ color: T.textSub }} title={m0?.jalon || ""}>{m0?.etape || m0?.jalon || ""}</div>
              <div className="crm-cel" style={{ color: T.text }} title={l.prochaineAction || ""}>{l.prochaineAction || <span style={{ color: T.textMuted }}>—</span>}</div>
              <div className="crm-cel" style={{ color: ech.ton === "neutre" ? T.textSub : TON[ech.ton], fontWeight: ech.ton === "neutre" ? 500 : 700 }}>{l.echeance ? ech.texte : "—"}</div>
              <div className="crm-cel" style={{ color: T.textSub }}>{l.dernierContact ? dateFr(l.dernierContact) : <span style={{ color: T.textMuted }}>Non noté</span>}</div>
            </div>
          );
        })}
        {visibles.length === 0 && <Vide T={T} titre="Aucun client" texte="Aucun client ne correspond à ces critères." />}
      </div>
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

// ── Mission (Fiche Dossier V1, en attendant les espaces Mission par offre) ───
function PageMission({ clientId, dossierId, profil, T, onCrm, onClient }) {
  const [client, setClient] = useState(null);
  const [erreur, setErreur] = useState("");
  const [reference, setReference] = useState(null);
  useEffect(() => {
    supabase.from("invest_clients").select("*").eq("id", clientId).single().then(({ data, error }) => { if (error) setErreur(error.message); else setClient(data); });
  }, [clientId]);
  return (
    <>
      <FilAriane T={T} elements={[{ libelle: "CRM", onClick: onCrm }, { libelle: client ? nomClient(client) : "Client", onClick: onClient }, { libelle: `Mission ${reference || ""}`.trim() }]} />
      {erreur ? <Vide T={T} titre="Client illisible" texte={erreur} />
        : !client ? <Discret T={T}>Chargement de la mission…</Discret>
        : <FicheDossier client={client} T={T} profil={profil} dossierIdInitial={dossierId} onDossierChange={(d) => setReference(d?.reference ?? null)} />}
    </>
  );
}
