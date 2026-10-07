// src/Invest/crm/FicheClientV2.jsx — Fiche client : le poste de pilotage quotidien du conseiller.
//
// Un client = une fiche qui centralise toutes ses missions (Offre 2 : accompagnement à l'investissement, un projet par
// mission ; Offre 3 : structuration patrimoniale). Cinq onglets : Vue d'ensemble · Missions · Patrimoine · Documents · Activité.
// Ce fichier charge les données et orchestre ; l'affichage est dans Fiche*.jsx, la logique dans ficheOffres.mjs (pure).
//
// Les données existantes ne sont jamais réécrites silencieusement : la checklist de pièces reste dans
// invest_clients.strategie_data, les préconisations dans le dossier de structuration, les tâches dans invest_mission_actions.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { clientStrategy } from "../_shared";
import FicheDossier from "../dossiers/FicheDossier";
import StructurationPatrimoniale from "../Structuration";
import { ONGLETS_CLIENT, ongletValide, construireClient } from "./crmV2Vue";
import { construireMissions, completudePatrimoine, syntheseDocuments, actionsAFaire, etatDossier, filtrerActivite, piecesEtude } from "./ficheOffres";
import AccesPortail, { ROLES_GESTIONNAIRES } from "./AccesPortail";
import FicheEntete from "./FicheEntete";
import FicheEnsemble from "./FicheEnsemble";
import FicheMissions from "./FicheMissions";
import FichePatrimoine from "./FichePatrimoine";
import FicheDocuments from "./FicheDocuments";
import FicheActivite from "./FicheActivite";
import { FilAriane, Onglets, Carte, Discret, Vide, aujourdhuiIso, ROUGE } from "./ui";

const TABLES_2C = ["invest_personnes", "invest_postes_financiers", "invest_engagements", "invest_actifs_patrimoniaux", "invest_structures"];
const ETUDE = "etude";

export default function FicheClientV2({ clientId, ongletInitial, missionInitiale = null, profil, T, onRetour, renderModifierClient }) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState(missionInitiale ? "missions" : ongletValide(ongletInitial));
  // Mission (id de dossier) ou étude patrimoniale ("etude") ouverte DANS l'onglet Missions.
  const [missionOuverte, setMissionOuverte] = useState(missionInitiale || (ongletInitial === "structuration" ? ETUDE : null));
  const [rev, setRev] = useState(0);
  const [modifie, setModifie] = useState(false);
  const [portailOuvert, setPortailOuvert] = useState(false);
  const [journal, setJournal] = useState(false);          // « ••• → Journal système » : événements techniques visibles
  const [signalNote, setSignalNote] = useState(0);
  const [signalNouvelle, setSignalNouvelle] = useState(0);
  const [depotsClient, setDepotsClient] = useState(0);    // pièces déposées par le client, à vérifier
  const [reponsesClient, setReponsesClient] = useState(0); // parties envoyées par le client depuis son espace, à vérifier
  const [portail, setPortail] = useState(null);           // "actif" | "non_active" | null (illisible ou non autorisé)
  const aujourdhui = aujourdhuiIso();
  const gestionnaire = ROLES_GESTIONNAIRES.includes(profil?.role);

  const onOuvrirMission = (dossierId) => { setMissionOuverte(dossierId); setOnglet("missions"); };
  const onOuvrirEtude = () => { setMissionOuverte(ETUDE); setOnglet("missions"); };
  const onNouvelleMission = () => { setMissionOuverte(null); setSignalNouvelle((n) => n + 1); setOnglet("missions"); };

  const charger = useCallback(async () => {
    const [rc, rd, ru, rt, rn, rv, rs, ra, ...r2c] = await Promise.all([
      supabase.from("invest_clients").select("*").eq("id", clientId).single(),
      supabase.from("invest_dossiers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
      supabase.from("invest_mission_actions").select("id,client_id,dossier_id,etape,action_title,status,due_date,responsable").eq("client_id", clientId),
      supabase.from("invest_notes").select("*").eq("client_id", clientId).order("date", { ascending: false }),
      supabase.from("invest_dossier_evenements").select("id,ordre,survenu_le,type,resume,auteur_libelle,dossier_id").eq("client_id", clientId)
        .order("survenu_le", { ascending: false }).order("ordre", { ascending: false }).limit(300),
      supabase.from("invest_structuration_patrimoniale").select("id,client_id,donnees,updated_at").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(1),
      supabase.from("invest_dossier_acquisitions").select("*").eq("client_id", clientId),
      ...TABLES_2C.map((t) => supabase.from(t).select("*").eq("client_id", clientId)),
    ]);
    if (rc.error) { setErreur(rc.error.message); return; }
    // Table absente (migration non appliquée) ou illisible : on n'affiche rien, ce n'est pas une erreur de la fiche.
    supabase.from("invest_portail_reponses").select("id").eq("client_id", clientId).eq("statut", "soumis").then((r) => setReponsesClient(r.error ? 0 : (r.data || []).length));
    supabase.from("invest_portail_depots").select("id").eq("client_id", clientId).eq("statut", "a_verifier").then((r) => setDepotsClient(r.error ? 0 : (r.data || []).length));
    if (gestionnaire) {
      supabase.from("invest_portail_comptes").select("statut").eq("client_id", clientId).then((r) => setPortail(r.error ? null : (r.data || []).some((l) => l.statut === "actif") ? "actif" : "non_active"));
    }
    const dossiers = rd.data || [];
    const re = dossiers.length
      ? await supabase.from("invest_dossier_etapes").select("*").in("dossier_id", dossiers.map((d) => d.id)).is("operation_id", null)
      : { data: [] };
    const manques = [rd.error, rt.error, rn.error, rv.error, rs.error, ra.error, re.error, ...r2c.map((r) => r.error)].filter(Boolean).map((e) => e.message);
    setDonnees({ client: rc.data, dossiers, utilisateurs: ru.data || [], taches: rt.data || [], notes: rn.data || [], evenements: rv.data || [], etapes: re.data || [],
      structuration: rs.data?.[0] || null, acquisitions: ra.data || [],
      collecte: Object.fromEntries(TABLES_2C.map((t, i) => [t, r2c[i].data || []])), lectureIncomplete: manques.join(" · "), dossiersIllisibles: !!(rd.error || re.error) });
  }, [clientId, rev, gestionnaire]);
  useEffect(() => { charger(); }, [charger]);
  const rafraichir = () => setRev((x) => x + 1);

  const vue = useMemo(() => donnees ? construireClient({ ...donnees, aujourdhui }) : null, [donnees, aujourdhui]);
  const modele = useMemo(() => {
    if (!donnees || !vue) return null;
    const strat = clientStrategy(donnees.client);
    const missions = construireMissions({ vue, dossiers: donnees.dossiers, etapes: donnees.etapes, acquisitions: donnees.acquisitions, structuration: donnees.structuration, client: donnees.client, aujourdhui });
    const docs = syntheseDocuments(strat.documents_checklist || {}, strat.documents_demandes || {});
    const completude = completudePatrimoine(donnees.collecte, donnees.structuration?.donnees);
    const ouverts = new Set(donnees.dossiers.filter((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)).map((d) => d.id));
    const actions = actionsAFaire({ missions: missions.enCours, taches: donnees.taches.filter((t) => !t.dossier_id || ouverts.has(t.dossier_id)), dossiers: donnees.dossiers,
      documents: docs, patrimoine: completude, donnees: donnees.structuration?.donnees, aVerifier: { depots: depotsClient, reponses: reponsesClient }, aujourdhui });
    const etat = etatDossier({ patrimoine: completude, documents: docs, portail, missions: missions.enCours, client: donnees.client, depotsAVerifier: depotsClient, reponsesAVerifier: reponsesClient });
    return { missions, docs, completude, actions, etat, activite: filtrerActivite(vue.historique, { filtre: "tout", technique: false }), piecesEtude: piecesEtude(donnees.structuration?.donnees) };
  }, [donnees, vue, depotsClient, reponsesClient, portail, aujourdhui]);

  if (erreur) return (<><FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: "Client" }]} /><Vide T={T} titre="Client illisible" texte={erreur} /></>);
  if (!vue || !modele) return (<><FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: "Client" }]} /><Discret T={T}>Chargement du client…</Discret></>);

  const e = vue.entete;
  const client = donnees.client;
  const entete = { ...e, nom: [String(client.nom || "").toUpperCase(), client.prenom].filter(Boolean).join(" ") || e.nom };
  const dossierEnCours = donnees.dossiers.find((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)) || null;
  const illisible = donnees.dossiersIllisibles;
  const etude = donnees.structuration ? modele.piecesEtude : null;

  const menu = [
    renderModifierClient && { cle: "modifier", libelle: "Modifier le client", onClick: () => setModifie(true) },
    gestionnaire && { cle: "portail", libelle: "Gérer l'accès au portail", onClick: () => setPortailOuvert(true) },
    { cle: "journal", libelle: "Journal système", onClick: () => { setJournal(true); setOnglet("activite"); } },
    { cle: "archiver", libelle: "Archiver le client", indisponible: "Pas encore disponible : demande une évolution de la base" },
  ].filter(Boolean);

  return (
    <>
      <FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: entete.nom }]} />
      <FicheEntete T={T} entete={entete} onNouvelleMission={onNouvelleMission} onNote={() => { setOnglet("activite"); setSignalNote((n) => n + 1); }} actionsMenu={menu} />
      {modifie && renderModifierClient && renderModifierClient({ client, onFerme: () => setModifie(false), onSauve: () => { setModifie(false); rafraichir(); } })}
      {portailOuvert && gestionnaire && (
        <Carte T={T} style={{ marginBottom: 14 }}>
          <AccesPortail T={T} client={client} profil={profil} />
          <button className="inv-btn inv-btn-sm" onClick={() => setPortailOuvert(false)}>Fermer</button>
        </Carte>
      )}
      <Onglets T={T} compact onglets={ONGLETS_CLIENT} actif={onglet} onChange={(o) => { setOnglet(o); if (o !== "missions") setMissionOuverte(null); }}
        compteurs={{ missions: illisible ? null : modele.missions.enCours.length + modele.missions.terminees.length }} />
      {donnees.lectureIncomplete && <Discret T={T} style={{ color: ROUGE, marginBottom: 14 }}>Lecture incomplète : {donnees.lectureIncomplete}</Discret>}

      {onglet === "ensemble" && <FicheEnsemble T={T} vue={vue} activite={modele.activite} cartes={modele.missions.enCours} actions={modele.actions} etat={modele.etat} illisible={illisible}
        onOnglet={setOnglet} onOuvrirMission={onOuvrirMission} onOuvrirEtude={onOuvrirEtude} onChange={rafraichir} />}

      {onglet === "missions" && (missionOuverte
        ? <>
            <button className="inv-btn inv-btn-sm" style={{ marginBottom: 12 }} onClick={() => { setMissionOuverte(null); rafraichir(); }}>← Toutes les missions de {e.nom}</button>
            {missionOuverte === ETUDE
              ? <StructurationPatrimoniale key={client.id} profil={profil} T={T} clientIdFixe={client.id} />
              : <FicheDossier client={client} T={T} profil={profil} dossierIdInitial={missionOuverte} />}
          </>
        : <FicheMissions key={signalNouvelle} T={T} vue={vue} donnees={donnees} cartes={modele.missions.enCours} structuration={donnees.structuration} profil={profil} illisible={illisible}
            ouvrirNouvelle={signalNouvelle > 0} onOuvrirMission={onOuvrirMission} onOuvrirEtude={onOuvrirEtude} onCree={(id) => { rafraichir(); onOuvrirMission(id); }} onChange={rafraichir} />)}

      {onglet === "patrimoine" && <FichePatrimoine T={T} client={client} vue={vue} completude={modele.completude} dossierEnCours={dossierEnCours} onNouvelleMission={onNouvelleMission} />}
      {onglet === "documents" && <FicheDocuments T={T} client={client} profil={profil} depotsClient={depotsClient} etude={etude} onChange={rafraichir} onOuvrirEtude={onOuvrirEtude} />}
      {onglet === "activite" && <FicheActivite T={T} vue={vue} client={client} profil={profil} onAjoute={rafraichir} journal={journal} onJournal={setJournal} signalNote={signalNote} />}
    </>
  );
}
