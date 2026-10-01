// src/Invest/crm/FicheClientV2.jsx — Page Client V2 (Chantier V2-01).
//
// Niveau 2 du modèle CRM → Client → Mission → Opération : la relation durable.
// Onglets : Vue d'ensemble · Missions · Patrimoine · Opérations · Documents · Historique.
//
// Patrimoine = emplacement de référence de la situation patrimoniale 2c : la
// carte existante est intégrée telle quelle (aucune logique dupliquée).
// Documents = consultation du fonds existant, sans nouveau moteur.
// Opérations = emplacement réservé, l'objet Opération n'existe pas encore.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { CLIENT_DOCUMENT_CHECKLIST, clientStrategy, DocumentsSection } from "../_shared";
import { DemarrerMission } from "../dossiers/DossierInvestCard";
import SituationPatrimonialeCard from "../dossiers/SituationPatrimonialeCard";
import { ONGLETS_CLIENT, ongletsClient, construireClient } from "./crmV2Vue";
import AccesPortail from "./AccesPortail";
import SujetStructuration from "./SujetStructuration";
import StructurationPatrimoniale from "../Structuration";
import { FilAriane, Onglets, Section, Carte, Pastille, Discret, Chiffre, Vide, dateFr, dateCourte, eur, aujourdhuiIso, ROUGE, ORANGE, BLEU, VERT, GRIS } from "./ui";

const TABLES_2C = ["invest_personnes", "invest_postes_financiers", "invest_engagements", "invest_actifs_patrimoniaux", "invest_structures"];
const TYPES_NOTE = [["commentaire", "Note"], ["appel", "Appel"], ["rendez-vous", "Rendez-vous"], ["relance", "Relance"], ["document", "Document"], ["autre", "Autre"]];
const ETAT_DOCUMENT = { recu: ["Reçu", VERT], na: ["Non applicable", GRIS] };

export default function FicheClientV2({ clientId, ongletInitial, profil, T, onRetour, onOuvrirMission }) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState(ongletInitial || "ensemble");
  const [rev, setRev] = useState(0);
  const aujourdhui = aujourdhuiIso();

  const charger = useCallback(async () => {
    const [rc, rd, ru, rt, rn, rv, ...r2c] = await Promise.all([
      supabase.from("invest_clients").select("*").eq("id", clientId).single(),
      supabase.from("invest_dossiers").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
      supabase.from("invest_mission_actions").select("id,client_id,dossier_id,etape,action_title,status,due_date,responsable").eq("client_id", clientId),
      supabase.from("invest_notes").select("*").eq("client_id", clientId).order("date", { ascending: false }),
      supabase.from("invest_dossier_evenements").select("id,ordre,survenu_le,type,resume,auteur_libelle,dossier_id").eq("client_id", clientId)
        .order("survenu_le", { ascending: false }).order("ordre", { ascending: false }).limit(300),
      ...TABLES_2C.map((t) => supabase.from(t).select("*").eq("client_id", clientId)),
    ]);
    if (rc.error) { setErreur(rc.error.message); return; }
    const dossiers = rd.data || [];
    const re = dossiers.length
      ? await supabase.from("invest_dossier_etapes").select("*").in("dossier_id", dossiers.map((d) => d.id)).is("operation_id", null)
      : { data: [] };
    const manques = [rd.error, rt.error, rn.error, rv.error, re.error, ...r2c.map((r) => r.error)].filter(Boolean).map((e) => e.message);
    setDonnees({ client: rc.data, dossiers, utilisateurs: ru.data || [], taches: rt.data || [], notes: rn.data || [], evenements: rv.data || [], etapes: re.data || [],
      collecte: Object.fromEntries(TABLES_2C.map((t, i) => [t, r2c[i].data || []])), lectureIncomplete: manques.join(" · "), dossiersIllisibles: !!(rd.error || re.error) });
  }, [clientId, rev]);
  useEffect(() => { charger(); }, [charger]);
  const rafraichir = () => setRev((x) => x + 1);

  const vue = useMemo(() => donnees ? construireClient({ ...donnees, aujourdhui }) : null, [donnees, aujourdhui]);

  if (erreur) return (<><FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: "Client" }]} /><Vide T={T} titre="Client illisible" texte={erreur} /></>);
  if (!vue) return (<><FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: "Client" }]} /><Discret T={T}>Chargement du client…</Discret></>);

  const e = vue.entete;
  const client = donnees.client;
  const dossierEnCours = donnees.dossiers.find((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)) || null;
  return (
    <>
      <FilAriane T={T} elements={[{ libelle: "CRM", onClick: onRetour }, { libelle: e.nom }]} />
      {/* En-tête compact : qui est le client, qui le suit, comment le joindre. */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Client</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 900, color: T.text, letterSpacing: -0.4 }}>{e.nom}</h1>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 5, fontSize: 13, color: T.textSub }}>
            <Pastille couleur={BLEU}>{e.statutRelation}</Pastille>
            <span>Conseiller : <b style={{ color: T.text }}>{e.conseiller || "non défini"}</b></span>
            {e.telephone && <a href={`tel:${e.telephone}`} style={{ color: T.textSub }}>{e.telephone}</a>}
            {e.email && <a href={`mailto:${e.email}`} style={{ color: T.textSub }}>{e.email}</a>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SujetStructuration T={T} client={client} onChange={() => { if (client.sujet_structuration === true && onglet === "structuration") setOnglet("ensemble"); rafraichir(); }} />
          <button className="inv-btn inv-btn-sm" onClick={() => setOnglet("historique")}>Ajouter une note</button>
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setOnglet("missions")}>＋ Nouvelle mission</button>
        </div>
      </header>
      <Onglets T={T} compact onglets={ongletsClient(client)} actif={onglet} onChange={setOnglet}
        compteurs={{ missions: donnees.dossiersIllisibles ? null : vue.missionsEnCours.length + vue.missionsTerminees.length }} />
      {donnees.lectureIncomplete && <Discret T={T} style={{ color: ROUGE, marginBottom: 14 }}>Lecture incomplète : {donnees.lectureIncomplete}</Discret>}

      {onglet === "ensemble" && <VueEnsemble T={T} vue={vue} illisible={donnees.dossiersIllisibles} onOnglet={setOnglet} onOuvrirMission={onOuvrirMission} client={client} profil={profil} />}
      {onglet === "structuration" && client.sujet_structuration === true && (
        <StructurationPatrimoniale key={client.id} profil={profil} T={T} clientIdFixe={client.id} />
      )}
      {onglet === "structuration" && client.sujet_structuration !== true && (
        <Vide T={T} titre="Pas de sujet de structuration pour ce client" texte="Cochez « Sujet de structuration » pour faire apparaître l'onglet et ouvrir le dossier de structuration."
          action={<SujetStructuration T={T} client={client} onChange={rafraichir} />} />
      )}
      {onglet === "missions" && <Missions T={T} vue={vue} donnees={donnees} profil={profil} illisible={donnees.dossiersIllisibles} onOuvrirMission={onOuvrirMission} onCree={(id) => { rafraichir(); onOuvrirMission(id); }} />}
      {onglet === "patrimoine" && (
        <Section T={T} titre="Patrimoine du foyer">
          <Discret T={T} style={{ marginBottom: 14, maxWidth: 760 }}>
            Emplacement de référence de la situation patrimoniale : elle appartient au client et sert à toutes ses missions.
            {dossierEnCours ? ` Les modifications sont rattachées à la mission ${dossierEnCours.reference}.` : " Sans mission en cours, elle est consultable mais non modifiable."}
          </Discret>
          <Carte T={T}><SituationPatrimonialeCard client={client} T={T} dossierEnCoursId={dossierEnCours?.id ?? null} dossierReference={dossierEnCours?.reference ?? null} integre /></Carte>
        </Section>
      )}
      {onglet === "operations" && (
        <Section T={T} titre="Opérations">
          <Vide T={T} titre="Les opérations arrivent dans une prochaine version"
            texte="Une opération correspondra à une acquisition précise (bien, offre, financement, détention, notaire, travaux et location), créée lorsqu'une opportunité est acceptée. Rien n'est encore enregistré à ce niveau." />
        </Section>
      )}
      {onglet === "documents" && <Documents T={T} client={client} />}
      {onglet === "historique" && <Historique T={T} vue={vue} client={client} profil={profil} onAjoute={rafraichir} />}
    </>
  );
}

/** Mission en cours, en carte compacte : offre, référence, jalon, action, échéance, balle. */
function CarteMission({ T, m, onOuvrir }) {
  return (
    <Carte T={T} accent={m.priorite <= 1 ? ROUGE : m.priorite <= 4 ? ORANGE : BLEU} style={{ padding: "11px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 0, fontSize: 12.5, color: T.textMuted }}>
          <b style={{ fontSize: 14.5, color: T.text }}>{m.reference}</b>
          <span style={{ color: T.accent, fontWeight: 800 }}> · {m.offre.court || m.offre.libelle}</span>
          {" "}· {m.statutLibelle} · Jalon : <b style={{ color: T.textSub }}>{m.jalon}</b>
        </div>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOuvrir(m.dossierId)}>Ouvrir la mission</button>
      </div>
      <div style={{ marginTop: 6, fontSize: 13.5, fontWeight: 800, color: T.text }}>{m.action}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
        <Pastille couleur={m.retardJours ? ROUGE : m.echeance ? GRIS : ORANGE}>{m.echeance ? `Échéance ${dateFr(m.echeance)}${m.retardJours ? ` · ${m.retardJours} j de retard` : ""}` : "Sans échéance"}</Pastille>
        {m.balle && <Pastille couleur={m.balleType === "profero" ? BLEU : ORANGE}>Balle : {m.balle}</Pastille>}
        {m.blocages.map((b) => <Pastille key={b.etape} couleur={ROUGE}>Bloquée : {b.etape}</Pastille>)}
      </div>
    </Carte>
  );
}

const GRILLE_2 = { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20, alignItems: "start" };

function VueEnsemble({ T, vue, illisible, onOnglet, onOuvrirMission, client, profil }) {
  const p = vue.patrimoine;
  return (
    <>
      <div className="crm-v2-grille" style={GRILLE_2}>
        <Section T={T} compact titre={`Missions en cours · ${illisible ? "—" : vue.missionsEnCours.length}`}>
          {illisible ? <Vide T={T} compact titre="Missions illisibles" texte="avancement indisponible" />
            : vue.missionsEnCours.length === 0
              ? <Vide T={T} compact titre="Aucune mission en cours" texte={vue.missionsTerminees.length ? `${vue.missionsTerminees.length} terminée(s)` : null}
                  action={<button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => onOnglet("missions")}>＋ Nouvelle mission</button>} />
              : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{vue.missionsEnCours.map((m) => <CarteMission key={m.dossierId} T={T} m={m} onOuvrir={onOuvrirMission} />)}</div>}
        </Section>
        <Section T={T} compact titre="À faire">
          {vue.aFaire.length === 0 ? <Vide T={T} compact titre={illisible ? "Indisponible" : "Aucune action en cours"} /> : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {vue.aFaire.map((a) => (
                <div key={a.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "6px 0", borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{a.titre}</div>
                    <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 1 }}>{a.mission}{a.etape ? ` · ${a.etape}` : ""} · {a.responsable || "responsable non défini"}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: a.enRetard ? ROUGE : T.textSub, whiteSpace: "nowrap" }}>{a.echeance ? dateFr(a.echeance) : "Sans échéance"}</div>
                </div>
              ))}
              {vue.aFaireTotal > vue.aFaire.length && <Discret T={T} style={{ marginTop: 6 }}>+ {vue.aFaireTotal - vue.aFaire.length} autre(s) dans les missions.</Discret>}
            </div>
          )}
        </Section>
      </div>
      <div className="crm-v2-grille" style={GRILLE_2}>
        <Section T={T} compact titre="Synthèse patrimoniale" action={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("patrimoine")}>Ouvrir le patrimoine</button>}>
          {p.vide ? <Vide T={T} compact titre="Aucune donnée patrimoniale saisie" /> : (
            <Carte T={T} style={{ padding: "11px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                <Chiffre T={T} libelle="Revenus mensuels" valeur={eur(p.revenusMensuels)} />
                <Chiffre T={T} libelle="Épargne disponible" valeur={eur(p.epargneDisponible)} />
                <Chiffre T={T} libelle="Patrimoine net simplifié (biens à 100 %)" valeur={eur(p.patrimoineNetSimplifie)} fort />
              </div>
              <Discret T={T} style={{ marginTop: 8 }}>
                {p.verifiees} élément{p.verifiees > 1 ? "s" : ""} vérifié{p.verifiees > 1 ? "s" : ""} sur {p.total}
                {p.aCorriger ? <span style={{ color: ORANGE }}> · {p.aCorriger} à corriger</span> : null}
                {p.incomplet ? <span style={{ color: ORANGE }}> · totaux incomplets</span> : null}
              </Discret>
            </Carte>
          )}
        </Section>
        <Section T={T} compact titre="Opérations">
          <Vide T={T} compact titre="Bientôt disponible" texte="les acquisitions du client apparaîtront ici" />
        </Section>
      </div>
      <AccesPortail T={T} client={client} profil={profil} />
      <Section T={T} compact titre="Activité récente" action={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("historique")}>Voir tout l'historique</button>}>
        {vue.activite.length === 0 ? <Vide T={T} compact titre="Aucune activité enregistrée" /> : <ListeHistorique T={T} items={vue.activite} />}
      </Section>
    </>
  );
}

/** Ligne compacte d'une mission : référence, offre, statut, conseiller, dates, motif de clôture, Consulter. */
function LigneMission({ T, m, onConsulter }) {
  const details = [m.statutLibelle, m.conseiller ? `Conseiller : ${m.conseiller}` : null, m.ouverture ? `ouverte le ${dateFr(m.ouverture)}` : null,
    m.cloture ? `close le ${dateFr(m.cloture)}` : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, padding: "8px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{m.reference} <span style={{ fontWeight: 700, color: T.accent, fontSize: 12.5 }}>· {m.offre.court ? `${m.offre.court} — ${m.offre.libelle}` : m.offre.libelle}</span></div>
        <div style={{ fontSize: 12, color: T.textMuted, marginTop: 1 }}>{details}{m.jalon ? ` · Jalon : ${m.jalon}` : ""}</div>
        {m.motif && <div style={{ fontSize: 12, color: T.textSub, marginTop: 1 }}>Motif de clôture : {m.motif}</div>}
      </div>
      <button className="inv-btn inv-btn-sm" onClick={() => onConsulter(m.dossierId)}>Consulter</button>
    </div>
  );
}

function Missions({ T, vue, donnees, profil, illisible, onOuvrirMission, onCree }) {
  const [demarrage, setDemarrage] = useState(false);
  const [refus, setRefus] = useState("");
  const monId = donnees.utilisateurs.find((u) => String(u.email || "").trim().toLowerCase() === String(profil?.email || "").trim().toLowerCase())?.id || "";
  const nouvelle = () => { if (vue.nouvelleMission.possible) { setRefus(""); setDemarrage(true); } else setRefus(vue.nouvelleMission.raison); };
  if (illisible) return <Vide T={T} compact titre="Missions illisibles" texte="les missions du client n'ont pas pu être lues" />;
  return (
    <>
      <Section T={T} compact titre={`En cours · ${vue.missionsEnCours.length}`} action={!demarrage && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={nouvelle}>＋ Nouvelle mission</button>}>
        {refus && <div role="status" style={{ fontSize: 13, color: T.text, background: `${ORANGE}12`, borderRadius: 10, padding: "9px 12px", marginBottom: 10 }}>{refus}</div>}
        {demarrage && <Carte T={T} style={{ marginBottom: 10 }}><DemarrerMission T={T} client={donnees.client} utilisateurs={donnees.utilisateurs} monId={monId} onAnnuler={() => setDemarrage(false)} onCree={(id) => { setDemarrage(false); onCree(id); }} /></Carte>}
        {vue.missionsEnCours.length === 0 ? <Vide T={T} compact titre="Aucune mission en cours" />
          : vue.missionsEnCours.map((m) => <LigneMission key={m.dossierId} T={T} m={m} onConsulter={onOuvrirMission} />)}
      </Section>
      <Section T={T} compact titre={`Terminées · ${vue.missionsTerminees.length}`}>
        {vue.missionsTerminees.length === 0 ? <Vide T={T} compact titre="Aucune mission terminée" />
          : vue.missionsTerminees.map((m) => <LigneMission key={m.dossierId} T={T} m={m} onConsulter={onOuvrirMission} />)}
      </Section>
    </>
  );
}

function Documents({ T, client }) {
  const liste = clientStrategy(client).documents_checklist || {};
  return (
    <>
      <Section T={T} titre="Pièces suivies">
        <Discret T={T} style={{ marginBottom: 12 }}>Consultation de la liste existante. Le nouveau suivi des documents par mission arrivera dans une prochaine version.</Discret>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CLIENT_DOCUMENT_CHECKLIST.map(([cle, libelle]) => {
            const [etat, couleur] = ETAT_DOCUMENT[liste[cle] === true ? "recu" : liste[cle]] || ["À demander", ORANGE];
            return (
              <div key={cle} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.rowBorder || T.border}`, fontSize: 13.5, color: T.text }}>
                <span>{libelle}</span><Pastille couleur={couleur}>{etat}</Pastille>
              </div>
            );
          })}
        </div>
      </Section>
      <Section T={T} titre="Fichiers du client">
        <DocumentsSection folder={`clients/${client.id}`} T={T} lectureSeule />
      </Section>
    </>
  );
}

function ListeHistorique({ T, items }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
      {items.map((h) => (
        <li key={h.id} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 14, padding: "6px 0", borderBottom: `1px solid ${T.rowBorder || T.border}` }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>{dateCourte(h.quand) || "Date inconnue"}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: h.genre === "note" ? VERT : BLEU }}>{h.type}{h.mission ? ` · ${h.mission}` : ""}</div>
            <div style={{ fontSize: 13, color: T.text, marginTop: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{h.texte || "—"}{h.auteur && <span style={{ fontSize: 11.5, color: T.textMuted }}> · {h.auteur}</span>}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Historique({ T, vue, client, profil, onAjoute }) {
  const [filtre, setFiltre] = useState("tous");
  const [limite, setLimite] = useState(30);
  const [note, setNote] = useState({ type: "commentaire", contenu: "" });
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const items = vue.historique.filter((h) => filtre === "tous" || h.genre === filtre);
  const ajouter = async () => {
    if (!note.contenu.trim()) return;
    setEnvoi(true); setErreur("");
    const { error } = await supabase.from("invest_notes").insert({ client_id: client.id, auteur: profil?.nom || "", type: note.type, contenu: note.contenu.trim() });
    setEnvoi(false);
    if (error) { setErreur(error.message); return; }
    setNote({ type: "commentaire", contenu: "" }); onAjoute();
  };
  return (
    <>
      <Section T={T} compact titre="Ajouter une note">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <select className="inv-sel" value={note.type} onChange={(e) => setNote((n) => ({ ...n, type: e.target.value }))} aria-label="Type de note">{TYPES_NOTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <textarea className="inv-inp" rows={2} style={{ textAlign: "left", flex: "1 1 320px", minHeight: 44 }} placeholder="Compte rendu d'appel, échange, remarque…" value={note.contenu} onChange={(e) => setNote((n) => ({ ...n, contenu: e.target.value }))} />
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={ajouter} disabled={envoi || !note.contenu.trim()}>{envoi ? "Enregistrement…" : "Enregistrer"}</button>
        </div>
        {erreur && <Discret T={T} style={{ color: ROUGE, marginTop: 6 }}>{erreur}</Discret>}
      </Section>
      <Section T={T} compact titre={`Historique · ${items.length}`} action={
        <div style={{ display: "flex", gap: 4 }}>
          {[["tous", "Tout"], ["note", "Notes & appels"], ["mission", "Missions"]].map(([k, l]) => (
            <button key={k} onClick={() => setFiltre(k)} className="inv-btn inv-btn-sm" style={filtre === k ? { background: T.accentBg, color: T.accent } : undefined}>{l}</button>
          ))}
        </div>}>
        {items.length === 0 ? <Discret T={T}>Aucun élément.</Discret> : <ListeHistorique T={T} items={items.slice(0, limite)} />}
        {items.length > limite && <button className="inv-btn inv-btn-sm" style={{ marginTop: 12 }} onClick={() => setLimite((l) => l + 30)}>Afficher plus ({items.length - limite} restants)</button>}
      </Section>
    </>
  );
}
