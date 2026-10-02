// src/Invest/crm/CrmCartes.jsx — « À traiter » et « Clients » en cartes (refonte du 02/10/2026).
//
// À traiter : les missions sont rangées par RAISON (en retard, bloquées, aujourd'hui, à faire par
// Profero, en attente du client), chaque carte dit en clair quoi faire, chez qui est la balle et
// pour quand. Clients : une carte par client, avec l'accès au portail visible et un bouton Inviter.
// Les calculs viennent de crmV2Vue.mjs ; aucune écriture ici (l'invitation passe par AccesPortail).
import React, { useMemo, useState } from "react";
import { filtrerPortefeuille, portefeuille, alertesMission, echeanceCourte } from "./crmV2Vue";
import { Pastille, Discret, Vide, Carte, dateFr, ROUGE, ORANGE, GRIS, VERT, BLEU } from "./ui";
import AccesPortail, { ROLES_GESTIONNAIRES } from "./AccesPortail";

const VIOLET = "#7c3aed";
const TON = { rouge: ROUGE, orange: ORANGE, violet: VIOLET, neutre: GRIS };

// Une mission apparaît dans UN seul groupe : la première raison qui s'applique.
const GROUPES = [
  { cle: "retard", titre: "En retard", couleur: ROUGE, aide: "Une échéance ou une tâche est dépassée.", test: (m) => m.signaux.enRetard },
  { cle: "bloquee", titre: "Bloquées", couleur: ROUGE, aide: "Une étape est bloquée : il faut lever le blocage.", test: (m) => m.signaux.bloquee },
  { cle: "aujourdhui", titre: "À faire aujourd'hui", couleur: ORANGE, aide: "Une échéance tombe aujourd'hui.", test: (m) => m.signaux.aujourdhui },
  { cle: "profero", titre: "À faire par Profero", couleur: BLEU, aide: "La balle est chez nous, rien n'est en retard.", test: (m) => m.signaux.aFaireProfero },
  { cle: "sansAction", titre: "Sans prochaine action", couleur: ORANGE, aide: "Aucune action n'est prévue : à planifier.", test: (m) => m.signaux.sansAction },
  { cle: "client", titre: "En attente du client", couleur: VIOLET, aide: "Nous attendons un retour du client : pensez à le relancer.", test: (m) => m.signaux.attenteClient },
];

export function repartirParRaison(missions = []) {
  const groupes = GROUPES.map((g) => ({ ...g, missions: [] }));
  const reste = [];
  for (const m of missions) {
    const g = groupes.find((x) => x.test(m));
    if (g) g.missions.push(m); else reste.push(m);
  }
  return { groupes, reste };
}

function CarteMission({ T, m, aujourdhui, couleur, onMission, onClient }) {
  const ech = echeanceCourte(m.echeance, aujourdhui);
  const principale = alertesMission(m, aujourdhui)[0];
  return (
    <Carte T={T} accent={couleur} onClick={() => onMission(m.clientId, m.dossierId)} style={{ padding: "12px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: T.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.client}</div>
        {principale && <Pastille couleur={TON[principale.ton]} titre={principale.detail}>{principale.libelle}</Pastille>}
      </div>
      <Discret T={T}>{m.reference} · {m.offre.court || m.offre.libelle} · {m.etape || m.jalon}</Discret>
      <div style={{ marginTop: 10, fontSize: 13.5, fontWeight: 700, color: T.text }}>
        {m.action ? m.action : <span style={{ color: ORANGE }}>Aucune action prévue</span>}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6, fontSize: 12.5, color: T.textSub }}>
        <span>Pour le <strong style={{ color: ech.ton === "neutre" ? T.textSub : TON[ech.ton] }}>{m.echeance ? ech.texte : "—"}</strong></span>
        <span>Chez <strong style={{ color: m.balleType === "client" ? VIOLET : T.textSub }}>{m.balle || m.responsable || "—"}</strong></span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="inv-btn inv-btn-gold inv-btn-sm" onClick={(e) => { e.stopPropagation(); onMission(m.clientId, m.dossierId); }}>Ouvrir la mission</button>
        <button className="inv-btn inv-btn-sm" onClick={(e) => { e.stopPropagation(); onClient(m.clientId); }}>Fiche client</button>
      </div>
    </Carte>
  );
}

const GRILLE = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(310px,1fr))", gap: 12 };

export function ATraiterCartes({ T, missions, erreur, aujourdhui, onMission, onClient }) {
  const [voirClient, setVoirClient] = useState(false);
  const { groupes } = useMemo(() => repartirParRaison(missions || []), [missions]);
  if (!missions) return <Vide T={T} titre="Avancement des missions indisponible" texte={`Les missions n'ont pas pu être lues, la liste à traiter ne peut donc pas être établie${erreur ? ` (${erreur})` : ""}. Réessayez avec « Actualiser ».`} />;
  if (missions.length === 0) return <Vide T={T} titre="Aucune mission en cours" texte="Les missions démarrées depuis une fiche client apparaîtront ici." />;
  const urgents = groupes.filter((g) => g.cle !== "client");
  const nUrgent = urgents.reduce((s, g) => s + g.missions.length, 0);
  const attente = groupes.find((g) => g.cle === "client");
  return (
    <>
      <div style={{ fontSize: 14, color: T.textSub, margin: "2px 0 14px" }}>
        {nUrgent === 0
          ? <strong style={{ color: VERT }}>Rien d'urgent : toutes les missions suivent leur cours.</strong>
          : <><strong style={{ color: T.text }}>{nUrgent} mission{nUrgent > 1 ? "s" : ""}</strong> demandent votre attention, de la plus pressante à la moins pressante.</>}
      </div>
      {urgents.filter((g) => g.missions.length).map((g) => (
        <section key={g.cle} style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: g.couleur }}>{g.titre} <span style={{ color: T.textMuted }}>{g.missions.length}</span></h3>
            <Discret T={T}>{g.aide}</Discret>
          </div>
          <div style={GRILLE}>{g.missions.map((m) => <CarteMission key={m.dossierId} T={T} m={m} aujourdhui={aujourdhui} couleur={g.couleur} onMission={onMission} onClient={onClient} />)}</div>
        </section>
      ))}
      {attente.missions.length > 0 && (
        <section>
          <button className="inv-btn inv-btn-sm" onClick={() => setVoirClient((v) => !v)}>
            {voirClient ? "Masquer" : "Afficher"} les {attente.missions.length} mission{attente.missions.length > 1 ? "s" : ""} en attente du client
          </button>
          {voirClient && <div style={{ ...GRILLE, marginTop: 12 }}>{attente.missions.map((m) => <CarteMission key={m.dossierId} T={T} m={m} aujourdhui={aujourdhui} couleur={VIOLET} onMission={onMission} onClient={onClient} />)}</div>}
        </section>
      )}
    </>
  );
}

// ── Clients ──────────────────────────────────────────────────────────────────
function badgePortail(acces) {
  if (acces === undefined) return null; // non lisible (droits) ou inconnu : on n'affiche rien plutôt qu'un faux « pas d'accès »
  if (acces === "actif") return <Pastille couleur={VERT}>Portail ouvert</Pastille>;
  if (acces === "revoque") return <Pastille couleur={ORANGE}>Accès révoqué</Pastille>;
  return <Pastille couleur={GRIS}>Pas invité</Pastille>;
}

function ModalInvitation({ T, client, profil, onFermer }) {
  return (
    <div onClick={onFermer} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, width: "100%", maxWidth: 560 }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: T.text, marginBottom: 4 }}>Inviter {client.nom} à son espace client</div>
        <Discret T={T} style={{ marginBottom: 14 }}>Le client reçoit un e-mail pour choisir son mot de passe, puis voit seulement ce que vous avez choisi de lui montrer (tâches marquées « visible client », documents partagés).</Discret>
        <AccesPortail T={T} client={{ id: client.id, email: client.email }} profil={profil} />
        <div style={{ textAlign: "right", marginTop: 6 }}><button className="inv-btn inv-btn-sm" onClick={onFermer}>Fermer</button></div>
      </div>
    </div>
  );
}

export function ClientsCartes({ T, donnees, missions, comptesPortail, erreur, aujourdhui, profil, onClient, onInvitationFermee }) {
  const [f, setF] = useState({ q: "", conseiller: "", statut: "", mission: "", offre: "", structuration: "" });
  const [mode, setMode] = useState("cartes");
  const [aInviter, setAInviter] = useState(null);
  const lignes = useMemo(() => portefeuille({ clients: donnees.clients, dossiers: donnees.dossiers, missions, notes: donnees.notes }), [donnees, missions]);
  const conseillers = [...new Set(lignes.map((l) => l.conseiller).filter(Boolean))].sort();
  const statuts = [...new Set(lignes.map((l) => l.statutRelation))].sort();
  const visibles = filtrerPortefeuille(lignes, f);
  const gestionnaire = ROLES_GESTIONNAIRES.includes(profil?.role);
  if (erreur) return <Vide T={T} titre="Clients illisibles" texte={erreur} />;
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const accesDe = (id) => (comptesPortail ? (comptesPortail.get(id) || "aucun") : undefined);
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "2px 0 14px", alignItems: "center" }}>
        <input className="inv-inp" style={{ textAlign: "left", minWidth: 220, flex: "1 1 220px", maxWidth: 340 }} placeholder="Rechercher un client, un e-mail, un téléphone…" value={f.q} onChange={maj("q")} aria-label="Rechercher" />
        <select className="inv-sel" value={f.conseiller} onChange={maj("conseiller")} aria-label="Conseiller"><option value="">Tous les conseillers</option>{conseillers.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="inv-sel" value={f.statut} onChange={maj("statut")} aria-label="Statut"><option value="">Tous les statuts</option>{statuts.map((x) => <option key={x}>{x}</option>)}</select>
        <select className="inv-sel" value={f.mission} onChange={maj("mission")} aria-label="Mission"><option value="">Avec ou sans mission</option><option value="avec">Avec mission active</option><option value="sans">Sans mission active</option></select>
        <select className="inv-sel" value={f.structuration} onChange={maj("structuration")} aria-label="Structuration"><option value="">Recherche et structuration</option><option value="oui">Avec sujet de structuration</option><option value="non">Recherche seule</option></select>
        <Discret T={T} style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {visibles.length} client{visibles.length > 1 ? "s" : ""}
          <button className={`inv-btn inv-btn-sm ${mode === "cartes" ? "inv-btn-gold" : ""}`} onClick={() => setMode("cartes")}>Cartes</button>
          <button className={`inv-btn inv-btn-sm ${mode === "liste" ? "inv-btn-gold" : ""}`} onClick={() => setMode("liste")}>Liste</button>
        </Discret>
      </div>
      {missions === null && <Discret T={T} style={{ marginBottom: 10, color: ORANGE }}>Avancement des missions indisponible : missions, étape et prochaine action ne peuvent pas être affichées.</Discret>}
      {visibles.length === 0 ? <Vide T={T} titre="Aucun client" texte="Aucun client ne correspond à ces critères." /> : mode === "cartes" ? (
        <div style={GRILLE}>
          {visibles.map((l) => {
            const ech = echeanceCourte(l.echeance, aujourdhui);
            const m0 = l.missions[0];
            return (
              <Carte key={l.id} T={T} accent={l.urgent ? ROUGE : undefined} onClick={() => onClient(l.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 900, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.nom}</div>
                    <Discret T={T}>{l.statutRelation}{l.conseiller ? ` · ${l.conseiller}` : ""}</Discret>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {l.structuration && <Pastille couleur={VIOLET} titre="Sujet de structuration">Structuration</Pastille>}
                    {badgePortail(accesDe(l.id))}
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 13, color: T.textSub }}>
                  {m0 ? <><strong style={{ color: T.text }}>{m0.reference}</strong> · {m0.offre}{l.missions.length > 1 ? ` +${l.missions.length - 1}` : ""}{(m0.etape || m0.jalon) ? ` · ${m0.etape || m0.jalon}` : ""}</>
                    : <span style={{ color: T.textMuted }}>{missions === null ? "—" : "Aucune mission en cours"}</span>}
                </div>
                {l.prochaineAction && (
                  <div style={{ marginTop: 4, fontSize: 13, color: T.text, fontWeight: 600 }}>
                    → {l.prochaineAction}{l.echeance && <span style={{ color: ech.ton === "neutre" ? T.textSub : TON[ech.ton], fontWeight: 700 }}> · {ech.texte}</span>}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <Discret T={T}>{l.dernierContact ? `Dernier contact : ${dateFr(l.dernierContact)}` : "Aucun contact noté"}</Discret>
                  {gestionnaire && accesDe(l.id) !== "actif" && (
                    <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={(e) => { e.stopPropagation(); setAInviter(l); }}>Inviter au portail</button>
                  )}
                </div>
              </Carte>
            );
          })}
        </div>
      ) : (
        <div>
          {visibles.map((l) => {
            const m0 = l.missions[0];
            return (
              <div key={l.id} className="crm-lig crm-clic" role="button" tabIndex={0} onClick={() => onClient(l.id)} onKeyDown={(e) => { if (e.key === "Enter") onClient(l.id); }}
                style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.6fr) auto" }}>
                <div className="crm-cel" style={{ fontWeight: 900, color: T.text, fontSize: 14 }}>{l.nom}</div>
                <div className="crm-cel" style={{ color: T.textSub }}>{l.conseiller || "—"} · {l.statutRelation}</div>
                <div className="crm-cel" style={{ color: T.textSub }}>{m0 ? `${m0.reference} · ${m0.offre} · ${l.prochaineAction || "—"}` : "Aucune mission"}</div>
                <div>{badgePortail(accesDe(l.id))}</div>
              </div>
            );
          })}
        </div>
      )}
      {aInviter && <ModalInvitation T={T} client={aInviter} profil={profil} onFermer={() => { setAInviter(null); onInvitationFermee?.(); }} />}
    </>
  );
}
