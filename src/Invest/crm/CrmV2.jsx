// src/Invest/crm/CrmV2.jsx — CRM V2 (Chantier V2-01).
//
// Niveau 1 du modèle CRM → Client → Mission → Opération : pilotage du
// portefeuille uniquement. Trois vues : À traiter (par défaut), Clients,
// Actions & planning. Un clic ouvre une vraie page Client (FicheClientV2) ou
// la mission (Fiche Dossier V1, en attendant les espaces Mission par offre).
//
// Calculs : crmV2Vue.mjs (qui lit pilotage.mjs). Aucune écriture ici.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { readNavTarget } from "../_shared";
import FicheDossier from "../dossiers/FicheDossier";
import FicheClientV2 from "./FicheClientV2";
import { VUES_CRM, FILTRES_A_TRAITER, missionsAPiloter, compteursATraiter, filtrerMissions, portefeuille, planningActions, nomClient } from "./crmV2Vue";
import { FilAriane, Onglets, Section, Carte, Pastille, Compteur, Discret, Vide, dateFr, aujourdhuiIso, ROUGE, ORANGE, BLEU, VERT, GRIS } from "./ui";

const COULEUR_PRIORITE = [ROUGE, ROUGE, ORANGE, BLEU, ORANGE, GRIS, GRIS];
const COULEUR_COMPTEUR = { enRetard: ROUGE, bloquees: ROUGE, aujourdhui: ORANGE, attenteClient: BLEU };

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
    <div style={{ padding: "18px 28px 40px", maxWidth: 1320, margin: "0 auto" }} className="crm-v2">
      <style>{`@media (max-width: 900px){ .crm-v2{ padding: 18px 16px 50px !important; } .crm-v2-grille{ grid-template-columns: 1fr !important; } .crm-v2-ligne{ grid-template-columns: 1fr !important; } .crm-v2-entete-liste{ display:none !important; } }`}</style>
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
      <FilAriane T={T} elements={[{ libelle: "CRM" }]} />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: T.text, letterSpacing: -0.4 }}>CRM</h1>
          <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 4 }}>Ce que l'équipe doit traiter, les clients suivis et le planning des actions.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="inv-btn inv-btn-sm" onClick={charger} disabled={chargement}>{chargement ? "Chargement…" : "Actualiser"}</button>
          <button className="inv-btn inv-btn-sm" onClick={onAncienneVue} title="L'ancienne interface reste disponible pendant la transition">Ancienne vue CRM</button>
          {renderNouveauClient && <button className="inv-btn inv-btn-gold" onClick={() => setNouveauClient(true)}>＋ Nouveau client</button>}
        </div>
      </header>
      <Onglets T={T} onglets={VUES_CRM} actif={vue} onChange={setVue} />

      {!donnees ? <Discret T={T}>Chargement du portefeuille…</Discret> : (
        <>
          {vue === "a_traiter" && <ATraiter T={T} missions={missions} compteurs={cpt} erreur={erreurs.pilotage || erreurs.actions} onMission={ouvrirMission} onClient={ouvrirClient} />}
          {vue === "clients" && <Clients T={T} donnees={donnees} missions={missions} erreur={erreurs.clients} onClient={ouvrirClient} />}
          {vue === "planning" && <Planning T={T} donnees={donnees} erreur={erreurs.actions} aujourdhui={aujourdhui} onMission={ouvrirMission} onClient={ouvrirClient} />}
        </>
      )}
      {nouveauClient && renderNouveauClient({ onFerme: () => setNouveauClient(false), onCree: () => { setNouveauClient(false); charger(); } })}
    </>
  );
}

// ── À traiter ────────────────────────────────────────────────────────────────
function ATraiter({ T, missions, compteurs, erreur, onMission, onClient }) {
  const [filtre, setFiltre] = useState(null);
  const [voirReste, setVoirReste] = useState(false);
  if (!missions) return <Vide T={T} titre="Avancement des missions indisponible" texte={`Les missions n'ont pas pu être lues, la liste à traiter ne peut donc pas être établie${erreur ? ` (${erreur})` : ""}. Réessayez avec « Actualiser ».`} />;
  const liste = filtre ? filtrerMissions(missions, filtre) : missions.filter((m) => m.urgent);
  const reste = filtre ? [] : missions.filter((m) => !m.urgent);
  return (
    <>
      <div className="crm-v2-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12, marginBottom: 26 }}>
        {Object.entries(FILTRES_A_TRAITER).map(([cle, libelle]) => (
          <Compteur key={cle} T={T} libelle={libelle} valeur={compteurs[cle]} couleur={COULEUR_COMPTEUR[cle]} actif={filtre === cle} onClick={() => setFiltre(filtre === cle ? null : cle)} />
        ))}
      </div>
      <Section T={T} titre={filtre ? `${FILTRES_A_TRAITER[filtre]} · ${liste.length}` : `Missions à traiter · ${liste.length}`}
        action={filtre && <button className="inv-btn inv-btn-sm" onClick={() => setFiltre(null)}>Tout afficher</button>}>
        {missions.length === 0 ? <Vide T={T} titre="Aucune mission en cours" texte="Les missions démarrées depuis une fiche client apparaîtront ici." />
          : liste.length === 0 ? <Vide T={T} titre="Rien d'urgent" texte={filtre ? "Aucune mission dans cette catégorie." : "Aucune mission en retard, bloquée, à faire aujourd'hui ou sans prochaine action."} />
          : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{liste.map((m) => <LigneMission key={m.dossierId} T={T} m={m} onMission={onMission} onClient={onClient} />)}</div>}
      </Section>
      {reste.length > 0 && (
        <Section T={T} titre={`Missions qui suivent leur cours · ${reste.length}`} action={<button className="inv-btn inv-btn-sm" onClick={() => setVoirReste((v) => !v)}>{voirReste ? "Masquer" : "Afficher"}</button>}>
          {voirReste ? <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{reste.map((m) => <LigneMission key={m.dossierId} T={T} m={m} onMission={onMission} onClient={onClient} />)}</div>
            : <Discret T={T}>En attente du client ou d'un tiers, sans échéance proche.</Discret>}
        </Section>
      )}
    </>
  );
}

function LigneMission({ T, m, onMission, onClient }) {
  const couleur = COULEUR_PRIORITE[m.priorite];
  return (
    <Carte T={T} accent={couleur}>
      <div className="crm-v2-ligne" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.6fr) auto", gap: 18, alignItems: "center" }}>
        <div style={{ minWidth: 0 }}>
          <button onClick={() => onClient(m.clientId)} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", fontSize: 15.5, fontWeight: 900, color: T.text, textAlign: "left" }}>{m.client}</button>
          <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 3 }}>{m.reference} · {m.offre.court ? `${m.offre.court} — ${m.offre.libelle}` : m.offre.libelle}</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>Conseiller : {m.conseiller || "non défini"}</div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text }}>{m.action}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
            {m.retardJours > 0 && <Pastille couleur={ROUGE}>{m.retardJours} j de retard</Pastille>}
            {m.blocages.map((b) => <Pastille key={b.etape} couleur={ROUGE}>Bloquée : {b.etape}{b.motif ? ` — ${b.motif}` : ""}</Pastille>)}
            <Pastille couleur={m.echeance ? (m.retardJours ? ROUGE : GRIS) : ORANGE}>{m.echeance ? `Échéance ${dateFr(m.echeance)}` : "Sans échéance"}</Pastille>
            {m.balle && <Pastille couleur={m.balleType === "profero" ? BLEU : m.balleType === "client" ? VERT : ORANGE}>Balle : {m.balle}</Pastille>}
            {m.etape && <Pastille couleur={GRIS}>{m.jalon}</Pastille>}
          </div>
        </div>
        <button className="inv-btn inv-btn-blue" onClick={() => onMission(m.clientId, m.dossierId)}>Ouvrir</button>
      </div>
    </Carte>
  );
}

// ── Clients ──────────────────────────────────────────────────────────────────
function Clients({ T, donnees, missions, erreur, onClient }) {
  const [recherche, setRecherche] = useState("");
  const [conseiller, setConseiller] = useState("");
  const [statut, setStatut] = useState("");
  const lignes = useMemo(() => portefeuille({ clients: donnees.clients, dossiers: donnees.dossiers, missions, notes: donnees.notes }), [donnees, missions]);
  const conseillers = [...new Set(lignes.map((l) => l.conseiller).filter(Boolean))].sort();
  const statuts = [...new Set(lignes.map((l) => l.statutRelation))].sort();
  const q = recherche.trim().toLowerCase();
  const visibles = lignes.filter((l) => (!q || l.recherche.toLowerCase().includes(q)) && (!conseiller || l.conseiller === conseiller) && (!statut || l.statutRelation === statut));
  if (erreur) return <Vide T={T} titre="Clients illisibles" texte={erreur} />;
  const colonnes = "minmax(0,1.3fr) minmax(0,.8fr) minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1.4fr) minmax(0,.6fr)";
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 240, flex: "1 1 240px", maxWidth: 380 }} placeholder="Rechercher un client, un e-mail, un téléphone…" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        <select className="inv-sel" value={conseiller} onChange={(e) => setConseiller(e.target.value)} aria-label="Conseiller"><option value="">Tous les conseillers</option>{conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={statut} onChange={(e) => setStatut(e.target.value)} aria-label="Statut de la relation"><option value="">Tous les statuts</option>{statuts.map((s) => <option key={s}>{s}</option>)}</select>
        <Discret T={T} style={{ alignSelf: "center" }}>{visibles.length} client{visibles.length > 1 ? "s" : ""}</Discret>
      </div>
      {missions === null && <Discret T={T} style={{ marginBottom: 12, color: ORANGE }}>Avancement des missions indisponible : les colonnes Missions et Prochaine action ne peuvent pas être affichées.</Discret>}
      <div className="crm-v2-entete-liste" style={{ display: "grid", gridTemplateColumns: colonnes, gap: 14, padding: "0 18px 8px", fontSize: 11.5, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>
        <span>Client</span><span>Conseiller</span><span>Coordonnées</span><span>Missions en cours</span><span>Prochaine action</span><span>Dernier contact</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {visibles.map((l) => (
          <Carte key={l.id} T={T} onClick={() => onClient(l.id)} style={{ padding: "12px 18px" }}>
            <div className="crm-v2-ligne" style={{ display: "grid", gridTemplateColumns: colonnes, gap: 14, alignItems: "center", fontSize: 13 }}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 900, color: T.text, fontSize: 14 }}>{l.nom}</div><div style={{ fontSize: 12, color: T.textMuted }}>{l.statutRelation}</div></div>
              <div style={{ color: T.textSub }}>{l.conseiller || "—"}</div>
              <div style={{ minWidth: 0, color: T.textSub, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>{l.telephone || "—"}<br />{l.email || ""}</div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {l.missions.length ? l.missions.map((m) => <Pastille key={m.dossierId} couleur={BLEU} titre={m.jalon}>{m.reference} · {m.offre}</Pastille>)
                  : <span style={{ color: T.textMuted, fontSize: 12.5 }}>{missions === null ? "—" : `Aucune${l.missionsTerminees ? ` (${l.missionsTerminees} terminée${l.missionsTerminees > 1 ? "s" : ""})` : ""}`}</span>}
              </div>
              <div style={{ minWidth: 0, color: l.urgent ? ROUGE : T.text, fontSize: 12.5 }}>{l.prochaineAction || <span style={{ color: T.textMuted }}>—</span>}{l.echeance && <span style={{ color: T.textMuted }}> · {dateFr(l.echeance)}</span>}</div>
              <div style={{ color: T.textSub, fontSize: 12.5 }}>{l.dernierContact ? dateFr(l.dernierContact) : <span style={{ color: T.textMuted }}>Non noté</span>}</div>
            </div>
          </Carte>
        ))}
        {visibles.length === 0 && <Vide T={T} titre="Aucun client" texte="Aucun client ne correspond à ces critères." />}
      </div>
    </>
  );
}

// ── Actions & planning ───────────────────────────────────────────────────────
function Planning({ T, donnees, erreur, aujourdhui, onMission, onClient }) {
  const [filtres, setFiltres] = useState({ conseiller: "", dossierId: "", clientId: "" });
  const p = useMemo(() => planningActions({ ...donnees, aujourdhui, filtres }), [donnees, aujourdhui, filtres]);
  if (erreur) return <Vide T={T} titre="Actions illisibles" texte={`Le planning ne peut pas être affiché (${erreur}).`} />;
  const ouvertes = donnees.dossiers.filter((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)).sort((a, b) => String(a.reference).localeCompare(String(b.reference)));
  const clientsAvecActions = donnees.clients.filter((c) => donnees.taches.some((t) => t.client_id === c.id)).sort((a, b) => nomClient(a).localeCompare(nomClient(b), "fr"));
  const maj = (k) => (e) => setFiltres((f) => ({ ...f, [k]: e.target.value }));
  const colonnes = [["enRetard", "En retard", ROUGE], ["aujourdhui", "Aujourd'hui", ORANGE], ["semaine", "7 jours", BLEU], ["mois", "30 jours", GRIS]];
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <select className="inv-sel" value={filtres.conseiller} onChange={maj("conseiller")} aria-label="Conseiller"><option value="">Tous les conseillers</option>{p.options.conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={filtres.dossierId} onChange={maj("dossierId")} aria-label="Mission"><option value="">Toutes les missions</option>{ouvertes.map((d) => <option key={d.id} value={d.id}>{d.reference}</option>)}<option value="sans">Hors mission</option></select>
        <select className="inv-sel" value={filtres.clientId} onChange={maj("clientId")} aria-label="Client"><option value="">Tous les clients</option>{clientsAvecActions.map((c) => <option key={c.id} value={c.id}>{nomClient(c)}</option>)}</select>
      </div>
      <div className="crm-v2-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 16, alignItems: "start" }}>
        {colonnes.map(([cle, titre, couleur]) => (
          <div key={cle} style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: couleur }} />
              <span style={{ fontSize: 14, fontWeight: 900, color: T.text }}>{titre}</span>
              <span style={{ fontSize: 13, color: T.textMuted, fontWeight: 700 }}>{p[cle].length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {p[cle].length === 0 && <Discret T={T} style={{ padding: "10px 2px" }}>Aucune action.</Discret>}
              {p[cle].map((a) => (
                <Carte key={a.id} T={T} onClick={() => (a.dossierId ? onMission(a.clientId, a.dossierId) : onClient(a.clientId))} style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{a.titre}</div>
                  <div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>{a.client} · {a.mission}</div>
                  <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>{a.etape} · {a.responsable || "sans responsable"}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: cle === "enRetard" ? ROUGE : T.textSub, marginTop: 6 }}>{dateFr(a.echeance)}</div>
                </Carte>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Discret T={T} style={{ marginTop: 22 }}>
        Hors de ces colonnes : {p.sansEcheance} action{p.sansEcheance > 1 ? "s" : ""} sans échéance et {p.auDela} au-delà de 30 jours.
      </Discret>
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
