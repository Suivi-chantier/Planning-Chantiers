// src/Invest/dossiers/FicheDossier.jsx — Fiche Dossier Invest V1 (Chantier 1.2).
//
// Espace de travail principal du consultant sur une mission : en-tête et
// pilotage, parcours des 11 étapes, navigation par onglets (Vue d'ensemble,
// Projet, Situation patrimoniale, puis les modules à venir).
//
// Tout le calcul vient de ficheDossierVue.mjs, qui ne fait qu'assembler les
// moteurs existants (pilotage 2b, dossierVue 2a, situation 2c, questionnaire
// 2d). Les onglets Projet et Situation patrimoniale embarquent les cartes 2d et
// 2c telles quelles ; le panneau d'étape est celui de la Tranche 2a.
// Chantier 9 : parcours par phases et jalons de l'offre (Offre 2 / Offre 3),
// carte « Mission & honoraires » ; gestes préparés par offres.mjs.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { ETAPES_PARCOURS, STATUTS_LETTRE_MISSION } from "./parcours";
import { patchOffre, patchRestitution, patchCadrage, patchForfait, patchLettre, offreDe, STATUTS_CADRAGE } from "./offres";
import { tachesParEtape, journal as journalVue, champsNouvelleTache } from "./dossierVue";
import { construireFiche, ONGLETS_FICHE } from "./ficheDossierVue";
import { PanneauEtape, DemarrerMission } from "./DossierInvestCard";
import SituationPatrimonialeCard from "./SituationPatrimonialeCard";
import ProjetSituationCard from "./ProjetSituationCard";
import DocumentsMission from "./DocumentsMission";

const TABLES_2C = ["invest_personnes", "invest_postes_financiers", "invest_engagements", "invest_actifs_patrimoniaux", "invest_structures"];
const COULEUR_ETAPE = { a_venir: "#94a3b8", en_cours: "#2563eb", en_attente: "#d97706", bloquee: "#dc2626", terminee: "#16a34a", non_applicable: "#cbd5e1" };
const COULEUR_JALON = { a_venir: "#94a3b8", a_faire: "#d97706", en_cours: "#2563eb", bloque: "#dc2626", termine: "#16a34a", sans_objet: "#cbd5e1", absent: "#cbd5e1" };
const COULEUR_NIVEAU = { danger: "#dc2626", warning: "#d97706", info: "#2563eb" };
const eur = (v) => (v == null || v === "" ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "—");
const dateHeure = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };
const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);

function Carte({ T, titre, action, children, style }) {
  return (
    <section style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: T.shadowSm, minWidth: 0, ...style }}>
      {(titre || action) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted }}>{titre}</div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
const Badge = ({ couleur, children, titre }) => (
  <span title={titre} style={{ fontSize: 10.5, fontWeight: 800, color: couleur, background: `${couleur}12`, border: `1px solid ${couleur}35`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{children}</span>
);
const Donnee = ({ T, libelle, valeur, fort }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 10.5, color: T.textMuted, fontWeight: 700 }}>{libelle}</div>
    <div style={{ fontSize: fort ? 15 : 13, fontWeight: fort ? 900 : 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis" }}>{valeur ?? "—"}</div>
  </div>
);

// `dossierIdInitial` : mission à afficher à l'ouverture (CRM V2 → « Ouvrir la mission »).
export default function FicheDossier({ client, T, profil, onDossierChange, version = 0, dossierIdInitial = null }) {
  const [donnees, setDonnees] = useState(null);
  const [etat, setEtat] = useState({ chargement: true, erreur: "" });
  const [idChoisi, setIdChoisi] = useState(dossierIdInitial);
  const [onglet, setOnglet] = useState("ensemble");
  const [panneau, setPanneau] = useState(null);
  const [geste, setGeste] = useState(null); // offre | restitution | cadrage | forfait | lettre
  const [demarrage, setDemarrage] = useState(false);
  const [message, setMessage] = useState("");
  const [rev, setRev] = useState(0);
  const aujourdhui = aujourdhuiIso();

  const charger = useCallback(async () => {
    if (!client?.id) return;
    setEtat((e) => ({ ...e, chargement: true }));
    const [rd, ru, rt, rp, ...r2c] = await Promise.all([
      supabase.from("invest_dossiers").select("*").eq("client_id", client.id).order("created_at", { ascending: false }),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
      supabase.from("invest_mission_actions").select("id,action_title,status,due_date,responsable,dossier_id,etape,step_key,visible_client").eq("client_id", client.id),
      supabase.from("invest_propositions").select("id,statut,date_proposition,created_at,bien:invest_biens(adresse,ville,statut)").eq("client_id", client.id).order("created_at", { ascending: false }),
      ...TABLES_2C.map((t) => supabase.from(t).select("*").eq("client_id", client.id)),
    ]);
    if (rd.error) { setEtat({ chargement: false, erreur: rd.error.message }); return; }
    const dossiers = rd.data || [];
    const choisi = idChoisi && dossiers.find((d) => d.id === idChoisi) ? idChoisi : null;
    const courant = choisi ? dossiers.find((d) => d.id === choisi) : (dossiers.find((d) => ["ouvert", "actif", "suspendu"].includes(d.statut)) || dossiers[0]);
    const [re, rv] = courant ? await Promise.all([
      supabase.from("invest_dossier_etapes").select("*").eq("dossier_id", courant.id).is("operation_id", null),
      supabase.from("invest_dossier_evenements").select("id,ordre,survenu_le,type,resume,auteur_libelle,auteur_type,etape_id,dossier_id")
        .eq("dossier_id", courant.id).order("survenu_le", { ascending: false }).order("ordre", { ascending: false }).limit(200),
    ]) : [{ data: [] }, { data: [] }];
    const erreurs = [rt.error, re.error, rv.error, ...r2c.map((r) => r.error)].filter(Boolean).map((e) => e.message);
    setDonnees({ dossiers, utilisateurs: ru.data || [], taches: rt.data || [], propositions: rp.data || [], etapes: re.data || [], evenements: rv.data || [],
      collecte: Object.fromEntries(TABLES_2C.map((t, i) => [t, r2c[i].data || []])) });
    setEtat({ chargement: false, erreur: erreurs.join(" · ") });
  }, [client?.id, idChoisi, version, rev]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { setIdChoisi(dossierIdInitial); setOnglet("ensemble"); setPanneau(null); setGeste(null); setMessage(""); }, [client?.id, dossierIdInitial]);

  const fiche = useMemo(() => donnees ? construireFiche({ client, idChoisi, aujourdhui, ...donnees }) : null, [donnees, client, idChoisi, aujourdhui]);
  const monId = (donnees?.utilisateurs || []).find((u) => String(u.email || "").trim().toLowerCase() === String(profil?.email || "").trim().toLowerCase())?.id || "";

  // Même contrat que la carte 2a : la fiche client (Parcours Mission, tâche collaborateur) s'en sert.
  useEffect(() => {
    if (!fiche) return;
    const d = fiche.dossier, enCours = fiche.dossierEnCours;
    onDossierChange?.(d ? { dossierId: d.id, dossierEnCoursId: enCours?.id ?? null, reference: d.reference, referenceEnCours: enCours?.reference ?? null,
      etapeCourante: d.id === enCours?.id ? fiche.pilotage?.principale?.cle ?? null : null, etapeCouranteLibelle: fiche.pilotage?.principale?.libelle ?? null } : null);
  }, [fiche?.dossier?.id, fiche?.dossierEnCours?.id, fiche?.pilotage?.principale?.cle]);

  const rafraichir = () => setRev((x) => x + 1);

  if (etat.chargement && !fiche) return <Carte T={T}><div style={{ fontSize: 13, color: T.textMuted }}>Chargement du dossier…</div></Carte>;
  if (etat.erreur && !fiche) return <Carte T={T}><div style={{ fontSize: 13, color: "#be123c" }}>Dossier illisible : {etat.erreur}</div></Carte>;
  if (!fiche) return null;

  if (fiche.vide) {
    return (
      <Carte T={T} titre="Dossier Invest">
        <div style={{ fontSize: 14, color: T.text, fontWeight: 700 }}>{fiche.client.nom} n'a pas encore de Dossier Invest.</div>
        <div style={{ fontSize: 12.5, color: T.textMuted, margin: "4px 0 10px" }}>Démarrer une mission crée le dossier et son parcours en 11 étapes.</div>
        {demarrage
          ? <DemarrerMission T={T} client={client} utilisateurs={donnees.utilisateurs} monId={monId} onAnnuler={() => setDemarrage(false)} onCree={(id) => { setDemarrage(false); setIdChoisi(id); rafraichir(); }} />
          : <button className="inv-btn inv-btn-blue" onClick={() => setDemarrage(true)}>Démarrer une mission</button>}
      </Carte>
    );
  }

  const { entete: e, pilotage: p, aFaire } = fiche;
  const etapePanneau = panneau ? donnees.etapes.find((x) => x.etape === panneau) : null;
  const tachesEtape = tachesParEtape(donnees.taches, fiche.dossier.id);

  return (
    <div id="fiche-dossier" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── En-tête ── */}
      <section style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 18, padding: "14px 18px", boxShadow: T.shadowMd }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.accent }}>Dossier Invest · {e.reference}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginTop: 1 }}>{fiche.client.nom}</div>
            <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 3 }}>
              {e.offre.court ? `${e.offre.court} — ${e.offre.libelle}` : e.offre.libelle} · {e.libelle} · Conseiller : {e.conseiller} · Ouvert le {dateFr(e.dateOuverture)} · Lettre de mission : {e.lettre}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <Badge couleur={e.clos ? "#64748b" : "#2563eb"}>{e.statutLibelle}</Badge>
            {fiche.dossiers.length > 1 && (
              <select className="inv-sel" value={fiche.dossier.id} onChange={(ev) => { setIdChoisi(ev.target.value); setPanneau(null); }} style={{ fontSize: 12, padding: "4px 6px" }} aria-label="Dossier affiché">
                {fiche.dossiers.map((d) => <option key={d.id} value={d.id}>{d.libelle} — {d.statut}</option>)}
              </select>
            )}
            {!fiche.dossierEnCours && !demarrage && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setDemarrage(true)}>Démarrer une mission</button>}
            <button className="inv-btn inv-btn-sm" onClick={rafraichir} disabled={etat.chargement}>Actualiser</button>
          </div>
        </div>
        {demarrage && <div style={{ marginTop: 10 }}><DemarrerMission T={T} client={client} utilisateurs={donnees.utilisateurs} monId={monId} onAnnuler={() => setDemarrage(false)} onCree={(id) => { setDemarrage(false); setIdChoisi(id); rafraichir(); }} /></div>}
        {e.clos && <div style={{ marginTop: 10, fontSize: 12.5, color: T.textMuted }}>Dossier clos{e.motifCloture ? ` : ${e.motifCloture}` : ""}. Consultation seule.</div>}
        {p && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.border}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.8fr) minmax(0,1fr) minmax(0,1fr)", gap: 14, alignItems: "start" }} className="fiche-dossier-bandeau">
              <Donnee T={T} libelle="Étape principale" valeur={p.principale ? `${p.principale.libelle} · ${p.principale.statut}` : "Aucune étape active"} fort />
              <Donnee T={T} libelle="Prochaine action" valeur={aFaire?.action} fort />
              <Donnee T={T} libelle="Échéance" valeur={aFaire?.echeance ? `${dateFr(aFaire.echeance)}${aFaire.retardJours ? ` · ${aFaire.retardJours} j de retard` : ""}` : "Non fixée"} fort />
              <Donnee T={T} libelle="Balle" valeur={aFaire?.balle || aFaire?.responsable || "Personne"} fort />
            </div>
            {(fiche.alertes.length > 0 || p.blocages.length > 0) && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {p.blocages.map((b) => <Badge key={b.etape} couleur={COULEUR_NIVEAU.danger} titre="Étape bloquée">Bloquée : {b.etape}{b.motif ? ` — ${b.motif}` : ""}</Badge>)}
                {fiche.alertes.map((al) => (
                  <button key={al.code} onClick={() => setOnglet(al.onglet)} title="Voir dans la fiche"
                    style={{ cursor: "pointer", border: `1px solid ${COULEUR_NIVEAU[al.niveau]}40`, background: `${COULEUR_NIVEAU[al.niveau]}12`, color: COULEUR_NIVEAU[al.niveau], borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 800 }}>{al.libelle}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {fiche.offre
          ? <ParcoursOffre T={T} offre={fiche.offre} parcours={fiche.parcours} modifiable={fiche.modifiable} onOuvrir={setPanneau} onGeste={setGeste} />
          : <Parcours T={T} parcours={fiche.parcours} onOuvrir={setPanneau} />}
      </section>

      {/* ── Navigation ── */}
      <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 4 }} aria-label="Sections du dossier">
        {ONGLETS_FICHE.map((o) => (
          <button key={o.cle} onClick={() => setOnglet(o.cle)} style={{ border: 0, cursor: "pointer", borderRadius: 10, padding: "7px 12px", fontSize: 12.5, fontWeight: 800,
            background: onglet === o.cle ? T.accent : "transparent", color: onglet === o.cle ? (T.onAccent || "#fff") : T.textSub }}>
            {o.libelle}{o.enPreparation ? " ·" : ""}
          </button>
        ))}
      </nav>
      {message && <div style={{ fontSize: 12.5, padding: "8px 12px", borderRadius: 10, background: T.accentBg, color: T.text }}>{message}</div>}
      {etat.erreur && <div style={{ fontSize: 12, color: "#be123c" }}>Lecture incomplète : {etat.erreur}</div>}

      {geste && <GesteMission T={T} geste={geste} fiche={fiche} aujourdhui={aujourdhui} onFermer={() => setGeste(null)}
        onEnregistre={(txt) => { setGeste(null); setMessage(txt); rafraichir(); }} />}
      {onglet === "ensemble" && <VueEnsemble T={T} fiche={fiche} onGeste={setGeste} onOnglet={setOnglet} onOuvrirEtape={setPanneau} utilisateurs={donnees.utilisateurs} profil={profil} client={client} onTacheCreee={(txt) => { setMessage(txt); rafraichir(); }} />}
      {onglet === "projet" && <Carte T={T}><ProjetSituationCard T={T} dossierId={fiche.dossier.id} dossierEnCoursId={fiche.dossierEnCours?.id ?? null} integre /></Carte>}
      {onglet === "situation" && <Carte T={T}><SituationPatrimonialeCard client={client} T={T} dossierEnCoursId={fiche.dossierEnCours?.id ?? null} dossierReference={fiche.dossierEnCours?.reference ?? null} integre /></Carte>}
      {onglet === "documents" && <DocumentsMission T={T} client={client} dossier={fiche.dossier} profil={profil} modifiable={fiche.modifiable} onRestitution={() => setGeste("restitution")} />}
      {onglet === "opportunites" && <Opportunites T={T} fiche={fiche} propositions={donnees.propositions} onOuvrirEtape={setPanneau} />}
      {ONGLETS_FICHE.find((o) => o.cle === onglet)?.enPreparation && <EnPreparation T={T} onglet={ONGLETS_FICHE.find((o) => o.cle === onglet)} fiche={fiche} onOuvrirEtape={setPanneau} />}

      {panneau && etapePanneau && (
        <PanneauEtape T={T} cle={panneau} dossier={fiche.dossier} clos={e.clos} etape={etapePanneau} taches={tachesEtape[panneau]}
          utilisateurs={donnees.utilisateurs} monId={monId} journal={journalVue(donnees.evenements, etapePanneau.id)} aujourdhui={aujourdhui}
          onFermer={() => setPanneau(null)} onEnregistre={(txt) => { setMessage(txt); rafraichir(); }} />
      )}
    </div>
  );
}

function Parcours({ T, parcours, onOuvrir }) {
  return (
    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(84px,1fr))", gap: 6 }} aria-label="Parcours du dossier">
      {parcours.map((e) => {
        const c = COULEUR_ETAPE[e.statut] || "#cbd5e1";
        return (
          <button key={e.cle} onClick={() => e.present && onOuvrir(e.cle)} disabled={!e.present} title={`${e.libelle} — ${e.statutLibelle}${e.balle ? ` · balle ${e.balle}` : ""}`}
            style={{ textAlign: "left", cursor: e.present ? "pointer" : "default", borderRadius: 12, padding: "7px 8px", border: `${e.active ? 2 : 1}px solid ${e.active ? c : T.border}`,
              background: e.active ? `${c}10` : "transparent", color: T.text, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 800 }}>{e.numero}</span>
              {e.aConfirmer && <span style={{ fontSize: 9, color: "#d97706", fontWeight: 900 }} title="Issue de la reprise, à confirmer">à confirmer</span>}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 900, marginTop: 3, lineHeight: 1.15 }}>{e.libelle}</div>
            <div style={{ fontSize: 10, color: e.active ? c : T.textMuted, fontWeight: 700, marginTop: 2 }}>{e.statutLibelle}</div>
          </button>
        );
      })}
    </div>
  );
}

function VueEnsemble({ T, fiche, onGeste, onOnglet, onOuvrirEtape, utilisateurs, profil, client, onTacheCreee }) {
  // Portail client : montrer / masquer le dossier. Rien n'est visible tant que ce n'est pas fait.
  const basculerPortail = async (voulu) => {
    if (voulu && !window.confirm("Montrer ce dossier au client ?\n\nIl verra le titre, le statut et la progression des étapes. Les tâches et événements restent masqués tant que vous ne les cochez pas. Jamais les honoraires ni les notes internes.")) return;
    const { data, error } = await supabase.from("invest_dossiers").update({ portail_visible: voulu }).eq("id", fiche.dossier.id).select("id");
    if (error) { onTacheCreee?.(`Portail client : ${error.message}`); return; }
    if (!data?.length) { onTacheCreee?.("Portail client : modification refusée (droits insuffisants)."); return; }
    onTacheCreee?.(voulu ? "Dossier visible par le client." : "Dossier masqué au client.");
  };
  const pj = fiche.projet, s = fiche.situation;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr)", gap: 14 }} className="fiche-dossier-grille">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Taches T={T} fiche={fiche} utilisateurs={utilisateurs} profil={profil} client={client} onTacheCreee={onTacheCreee} />
        <Carte T={T} titre="Activité récente">
          {fiche.activite.length === 0 ? <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucun événement.</div> : (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {fiche.activite.map((ev) => (
                <li key={ev.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 10, fontSize: 12.5 }}>
                  <span style={{ color: T.textMuted, fontSize: 11.5 }}>{dateHeure(ev.quand)}</span>
                  <span style={{ color: T.text }}>{ev.resume}<span style={{ color: T.textMuted }}> · {ev.auteur}</span></span>
                </li>
              ))}
            </ol>
          )}
        </Carte>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <MissionHonoraires T={T} fiche={fiche} onGeste={onGeste} onPortail={basculerPortail} />
        <Carte T={T} titre="Projet" action={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("projet")}>Ouvrir</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
            <Donnee T={T} libelle="Objectif" valeur={pj.objectif || "Non renseigné"} />
            <Donnee T={T} libelle="Horizon" valeur={pj.horizon || "Non renseigné"} />
            <Donnee T={T} libelle="Budget" valeur={eur(pj.budget)} fort />
            <Donnee T={T} libelle="Apport souhaité" valeur={eur(pj.apport)} fort />
            <div style={{ gridColumn: "1 / -1" }}><Donnee T={T} libelle="Zones recherchées" valeur={pj.zones || "Non renseignées"} /></div>
          </div>
          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>Questionnaire {pj.statutLibelle?.toLowerCase()} · {pj.pourcentage} % des questions affichées renseignées{pj.aCorriger ? ` · ${pj.aCorriger} à corriger` : ""}</div>
        </Carte>
        <Carte T={T} titre="Situation patrimoniale" action={<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("situation")}>Ouvrir</button>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
            <Donnee T={T} libelle="Revenus" valeur={`${eur(s.revenusMensuels)} /mois`} />
            <Donnee T={T} libelle="Charges" valeur={`${eur(s.chargesMensuelles)} /mois`} />
            <Donnee T={T} libelle="Mensualités de crédits" valeur={`${eur(s.mensualitesCredits)} /mois`} />
            <Donnee T={T} libelle="Épargne disponible" valeur={eur(s.epargneDisponible)} />
            <Donnee T={T} libelle="Actifs financiers" valeur={eur(s.actifsFinanciers)} />
            <Donnee T={T} libelle="Patrimoine immobilier brut" valeur={eur(s.valeurImmobiliereBrute)} />
            <Donnee T={T} libelle="Dette immobilière" valeur={eur(s.detteImmobiliereRestante)} />
            <Donnee T={T} libelle="Patrimoine net simplifié (biens à 100 %)" valeur={eur(s.patrimoineNetSimplifie)} fort />
          </div>
          {Object.values(s.incomplets).some(Boolean) && <div style={{ fontSize: 11.5, color: "#b45309", marginTop: 8 }}>Totaux incomplets : certaines valeurs manquent (voir l'onglet).</div>}
          {Object.values(s.lignes).every((n) => n === 0) && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>Aucune donnée patrimoniale saisie.</div>}
        </Carte>
      </div>
      <style>{`@media (max-width: 1100px){ .fiche-dossier-grille{ grid-template-columns: 1fr !important; } .fiche-dossier-bandeau{ grid-template-columns: 1fr 1fr !important; } }`}</style>
    </div>
  );
}

function Taches({ T, fiche, utilisateurs, profil, client, onTacheCreee }) {
  const t = fiche.taches;
  const [vue, setVue] = useState(t.enRetard.length ? "enRetard" : "aFaire");
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState("");
  const [toutVoir, setToutVoir] = useState(false);
  const lignes = t[vue] || [];
  const peutMontrer = fiche.modifiable && fiche.dossier.id === fiche.dossierEnCours?.id;
  // Portail client : le client ne voit que les tâches cochées ici, et seulement si le dossier est lui-même montré.
  const basculerClient = async (x) => {
    setErreur("");
    const { data, error } = await supabase.from("invest_mission_actions").update({ visible_client: !x.visibleClient }).eq("id", x.id).select("id");
    if (error) { setErreur(error.message); return; }
    if (!data?.length) { setErreur("Modification refusée : droits insuffisants sur cette tâche."); return; }
    onTacheCreee?.(x.visibleClient ? "Tâche masquée au client." : "Tâche visible par le client.");
  };
  const etapeDefaut = fiche.pilotage?.principale?.cle || "signature";
  const creer = async () => {
    setErreur("");
    if (!String(form.titre || "").trim()) { setErreur("Indiquez l'action."); return; }
    const u = utilisateurs.find((x) => x.id === form.responsable_id);
    let champs;
    try { champs = champsNouvelleTache(fiche.dossierEnCours?.id, form.etape); } catch (e) { setErreur(e.message); return; }
    const { error } = await supabase.from("invest_mission_actions").insert({
      client_id: client.id, ...champs, sort_order: 999, action_title: form.titre.trim(),
      responsable: u?.nom || null, responsable_email: u?.email || null, status: "a_faire", due_date: form.echeance || null,
      created_by: profil?.nom || profil?.email || null, metadata: { source: "fiche_dossier" },
    });
    if (error) { setErreur(error.message); return; }
    setForm(null); onTacheCreee?.("Action ajoutée au dossier.");
  };
  return (
    <Carte T={T} titre="Tâches du dossier" action={fiche.modifiable && fiche.dossier.id === fiche.dossierEnCours?.id && !form &&
      <button className="inv-btn inv-btn-sm" onClick={() => setForm({ titre: "", etape: etapeDefaut, responsable_id: "", echeance: "" })}>＋ Action</button>}>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[["enRetard", "En retard", "#dc2626"], ["aFaire", "À faire", "#2563eb"], ["terminees", "Terminées", "#16a34a"]].map(([k, l, c]) => (
          <button key={k} onClick={() => setVue(k)} style={{ cursor: "pointer", border: `1px solid ${vue === k ? c : T.border}`, background: vue === k ? `${c}10` : "transparent", color: vue === k ? c : T.textSub,
            borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 800 }}>{l} · {t[k].length}</button>
        ))}
      </div>
      {form && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6, marginBottom: 10, padding: 8, border: `1px dashed ${T.border}`, borderRadius: 10 }}>
          <input className="inv-inp" style={{ gridColumn: "1 / -1", textAlign: "left" }} placeholder="Action à réaliser" value={form.titre} onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))} />
          <select className="inv-sel" value={form.etape} onChange={(e) => setForm((f) => ({ ...f, etape: e.target.value }))} aria-label="Étape">{ETAPES_PARCOURS.map((x) => <option key={x.cle} value={x.cle}>{x.numero}. {x.libelle}</option>)}</select>
          <select className="inv-sel" value={form.responsable_id} onChange={(e) => setForm((f) => ({ ...f, responsable_id: e.target.value }))} aria-label="Responsable"><option value="">Responsable…</option>{utilisateurs.filter((u) => u.actif).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}</select>
          <input className="inv-inp" type="date" value={form.echeance} onChange={(e) => setForm((f) => ({ ...f, echeance: e.target.value }))} aria-label="Échéance" />
          <div style={{ display: "flex", gap: 6 }}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={creer}>Ajouter</button><button className="inv-btn inv-btn-sm" onClick={() => setForm(null)}>Annuler</button></div>
          {erreur && <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#be123c" }}>{erreur}</div>}
        </div>
      )}
      {lignes.length === 0 ? <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucune tâche.</div> : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {(toutVoir ? lignes : lignes.slice(0, 8)).map((x) => (
            <div key={x.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${T.rowBorder || T.border}`, fontSize: 12.5 }}>
              <div style={{ minWidth: 0 }}><div style={{ color: T.text, fontWeight: 700 }}>{x.titre}</div><div style={{ color: T.textMuted, fontSize: 11.5 }}>{x.etape} · {x.responsable || "sans responsable"}</div></div>
              <div style={{ color: vue === "enRetard" ? "#dc2626" : T.textMuted, fontSize: 11.5, whiteSpace: "nowrap" }}>{x.echeance ? dateFr(x.echeance) : "—"}</div>
              {peutMontrer
                ? <button className="inv-btn inv-btn-sm" onClick={() => basculerClient(x)} aria-pressed={x.visibleClient}
                    title={x.visibleClient ? "Le client voit cette tâche (titre, étape, statut, échéance). Cliquer pour la masquer." : "Non visible par le client. Cliquer pour la lui montrer."}
                    style={{ fontSize: 11, padding: "3px 8px", whiteSpace: "nowrap", ...(x.visibleClient ? { background: "#dcfce7", border: "1px solid #86efac", color: "#166534" } : { color: T.textMuted }) }}>
                    {x.visibleClient ? "👁 Visible client" : "Masquée"}</button>
                : (x.visibleClient ? <Badge couleur="#16a34a" titre="Le client voit cette tâche">Visible client</Badge> : <span />)}
            </div>
          ))}
          {lignes.length > 8 && <button className="inv-btn inv-btn-sm" style={{ marginTop: 6, alignSelf: "flex-start" }} onClick={() => setToutVoir((v) => !v)}>{toutVoir ? "Réduire la liste" : `Afficher les ${lignes.length - 8} autre(s)`}</button>}
        </div>
      )}
    </Carte>
  );
}

function EtapesLiees({ T, fiche, cles, onOuvrirEtape }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {cles.map((cle) => { const e = fiche.parcours.find((x) => x.cle === cle); if (!e) return null; const c = COULEUR_ETAPE[e.statut] || "#94a3b8";
        return <button key={cle} className="inv-btn inv-btn-sm" onClick={() => e.present && onOuvrirEtape(cle)}>{e.numero}. {e.libelle} · <span style={{ color: c }}>{e.statutLibelle}</span></button>; })}
    </div>
  );
}

function EnPreparation({ T, onglet, fiche, onOuvrirEtape }) {
  return (
    <Carte T={T} titre={onglet.libelle}>
      <div style={{ fontSize: 15, fontWeight: 900, color: T.text }}>Module en préparation</div>
      <div style={{ fontSize: 12.5, color: T.textMuted, margin: "4px 0 10px" }}>Ce module arrivera dans une prochaine version. En attendant, le pilotage de l'étape reste disponible :</div>
      <EtapesLiees T={T} fiche={fiche} cles={onglet.etapes || []} onOuvrirEtape={onOuvrirEtape} />
    </Carte>
  );
}

function Opportunites({ T, fiche, propositions = [], onOuvrirEtape }) {
  return (
    <Carte T={T} titre="Opportunités">
      <EtapesLiees T={T} fiche={fiche} cles={["recherche", "opportunites"]} onOuvrirEtape={onOuvrirEtape} />
      <div style={{ marginTop: 12 }}>
        {propositions.length === 0 ? <div style={{ fontSize: 12.5, color: T.textMuted }}>Aucun bien proposé à ce client.</div> : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {propositions.map((pr) => (
              <div key={pr.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "7px 0", borderTop: `1px solid ${T.rowBorder || T.border}`, fontSize: 12.5 }}>
                <div style={{ color: T.text, fontWeight: 700 }}>{[pr.bien?.adresse, pr.bien?.ville].filter(Boolean).join(", ") || "Bien sans adresse"}</div>
                <div style={{ color: T.textMuted, fontSize: 11.5 }}>{pr.statut || "—"} · {dateFr(pr.date_proposition || pr.created_at)}</div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>Les propositions se gèrent pour l'instant dans l'ancienne vue CRM (section « Biens proposés »).</div>
      </div>
    </Carte>
  );
}

// ── Chantier 9 : parcours de l'offre, honoraires, gestes sur la mission ─────

function ParcoursOffre({ T, offre, parcours, modifiable, onOuvrir, onGeste }) {
  const parCle = Object.fromEntries(parcours.map((e) => [e.cle, e]));
  const plusieurs = offre.phases.length > 1;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }} aria-label={`Parcours ${offre.offre.court}`}>
      {offre.phases.map((ph, i) => (
        <div key={ph.cle} style={{ opacity: ph.nonCommencee ? 0.75 : 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.textMuted, marginBottom: 4 }}>
            {plusieurs ? `Phase ${i + 1} · ${ph.libelle}` : `Parcours ${offre.offre.court}`} <span style={{ fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>— {ph.etatLibelle}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6 }}>
            {ph.jalons.map((j) => {
              const c = COULEUR_JALON[j.etat] || "#94a3b8";
              const actif = ["en_cours", "bloque", "a_faire"].includes(j.etat);
              return (
                <div key={j.cle} style={{ borderRadius: 10, padding: "5px 8px", border: `${actif ? 2 : 1}px solid ${actif ? c : T.border}`, background: actif ? `${c}10` : "transparent", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: c, flexShrink: 0, alignSelf: "center" }} />
                    <span style={{ fontSize: 12, fontWeight: 900, color: T.text, lineHeight: 1.15 }}>{j.libelle}</span>
                    <span style={{ fontSize: 10, color: actif ? c : T.textMuted, fontWeight: 700 }}>{j.detail || j.etatLibelle}</span>
                  </div>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                    {j.etapes.map((cle) => { const e = parCle[cle]; if (!e) return null; const ce = COULEUR_ETAPE[e.statut] || "#cbd5e1";
                      return (
                        <button key={cle} onClick={() => e.present && onOuvrir(cle)} disabled={!e.present} title={`${e.libelle} — ${e.statutLibelle}${e.balle ? ` · balle ${e.balle}` : ""}`}
                          style={{ cursor: e.present ? "pointer" : "default", border: `1px solid ${e.active ? ce : T.border}`, background: "transparent", borderRadius: 999, padding: "1px 6px", fontSize: 9.5, fontWeight: 800, color: e.active ? ce : T.textSub }}>
                          {e.numero}. {e.libelle}{e.aConfirmer ? " ·?" : ""}
                        </button>
                      ); })}
                    {j.special && modifiable && (j.special === "restitution" || j.etat !== "a_venir") && (
                      <button onClick={() => onGeste(j.special)} style={{ cursor: "pointer", border: `1px solid ${T.border}`, background: "transparent", borderRadius: 999, padding: "1px 7px", fontSize: 9.5, fontWeight: 800, color: T.accent }}>
                        {j.etat === "termine" || j.etat === "sans_objet" ? "Modifier" : "Enregistrer"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function MissionHonoraires({ T, fiche, onGeste, onPortail }) {
  const o = fiche.entete.offre, h = fiche.honoraires, f = h.forfait, cible = fiche.offreCible;
  const m = fiche.modifiable;
  const eurHT = (v) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(Number(v))} € HT`;
  const lien = (cle, txt) => m && <button className="inv-btn inv-btn-sm" onClick={() => onGeste(cle)}>{txt}</button>;
  return (
    <Carte T={T} titre="Mission & honoraires">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <Donnee T={T} libelle="Offre" valeur={o.court ? `${o.court} — ${o.libelle}` : o.libelle} />
          {cible && lien("offre", cible === "audit_patrimonial" ? "Passer en Offre 3" : "Revenir en Offre 2")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <Donnee T={T} libelle="Forfait de mission" valeur={f.renseigne ? eurHT(f.montant) : "Non renseigné"} fort={f.renseigne} />
            <div style={{ fontSize: 11.5, color: f.etat === "du" ? T.textSub : "#b45309", marginTop: 2 }}>{f.exigibilite}</div>
          </div>
          {lien("forfait", f.renseigne ? "Modifier" : "Renseigner")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <Donnee T={T} libelle="Lettre de mission" valeur={fiche.entete.lettre} />
          {lien("lettre", "Modifier")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <Donnee T={T} libelle="Portail client" valeur={fiche.dossier.portail_visible === true ? "Dossier visible par le client" : "Non visible par le client"} />
            
          </div>
          {m && <button className="inv-btn inv-btn-sm" onClick={() => onPortail(fiche.dossier.portail_visible !== true)}>{fiche.dossier.portail_visible === true ? "Masquer" : "Montrer au client"}</button>}
        </div>
        <div>
          <Donnee T={T} libelle="Honoraires d'accompagnement" valeur={h.accompagnement.regle} />
          <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>{h.accompagnement.calcul}</div>
        </div>
      </div>
    </Carte>
  );
}

const TITRES_GESTE = { offre: "Changer d'offre", restitution: "Rapport & restitution", cadrage: "Cadrage du projet", forfait: "Forfait de mission", lettre: "Lettre de mission" };

function GesteMission({ T, geste, fiche, aujourdhui, onFermer, onEnregistre }) {
  const d = fiche.dossier;
  const [v, setV] = useState(() => ({
    restitution: d.restitution_le ? String(d.restitution_le).slice(0, 10) : aujourdhui,
    cadrageStatut: d.cadrage_statut || "fait", cadrage: d.cadrage_le ? String(d.cadrage_le).slice(0, 10) : aujourdhui,
    forfait: d.honoraires_prevus_ht == null ? "" : String(d.honoraires_prevus_ht).replace(".", ","),
    lettre: d.lettre_mission_statut === "inconnu" ? "a_emettre" : d.lettre_mission_statut,
    signee: d.lettre_mission_signee_le ? String(d.lettre_mission_signee_le).slice(0, 10) : aujourdhui,
  }));
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const maj = (k) => (ev) => setV((x) => ({ ...x, [k]: ev.target.value }));
  const cible = fiche.offreCible;

  const envoyer = async (fabriquer, texte) => {
    setErreur("");
    let patch;
    try { patch = fabriquer(); } catch (e) { setErreur(e.message); return; }
    setEnvoi(true);
    const { data, error } = await supabase.from("invest_dossiers").update(patch).eq("id", d.id).select("id");
    setEnvoi(false);
    if (error) { setErreur(error.message); return; }
    if (!data?.length) { setErreur("Modification refusée : droits insuffisants sur cette mission."); return; }
    onEnregistre(texte);
  };

  let corps;
  if (geste === "offre") {
    const vers = offreDe(cible);
    corps = (
      <>
        <div style={{ fontSize: 12.5, color: T.text }}>
          {cible === "audit_patrimonial"
            ? "La mission passe en Offre 3 : une phase Patrimoine (Collecte → Analyse → Stratégie → Rapport & restitution) précède la phase Investissement. Les étapes déjà faites ne sont pas modifiées : si la collecte, l'analyse ou la stratégie doivent être reprises, rouvrez-les depuis le parcours."
            : "La mission revient en Offre 2 (correction d'erreur). Possible uniquement si aucune restitution ni cadrage n'est enregistré."}
        </div>
        <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={envoi || !cible} onClick={() => envoyer(() => patchOffre(d, cible), `Mission passée en ${vers.court}.`)}>Passer en {vers.court}</button>
      </>
    );
  } else if (geste === "restitution") {
    corps = (
      <>
        <label style={{ fontSize: 12, color: T.textSub }}>Rapport remis et restitué le <input className="inv-inp" type="date" max={aujourdhui} value={v.restitution} onChange={maj("restitution")} /></label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchRestitution(d, v.restitution, aujourdhui), "Rapport & restitution enregistrés.")}>Enregistrer</button>
          {d.restitution_le && <button className="inv-btn inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchRestitution(d, null, aujourdhui), "Date de restitution retirée.")}>Retirer la date</button>}
        </div>
      </>
    );
  } else if (geste === "cadrage") {
    corps = (
      <>
        <select className="inv-sel" value={v.cadrageStatut} onChange={maj("cadrageStatut")} aria-label="Cadrage">
          {Object.entries(STATUTS_CADRAGE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {v.cadrageStatut === "fait" && <label style={{ fontSize: 12, color: T.textSub }}>Fait le <input className="inv-inp" type="date" max={aujourdhui} value={v.cadrage} onChange={maj("cadrage")} /></label>}
        <div style={{ display: "flex", gap: 6 }}>
          <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchCadrage(d, v.cadrageStatut, v.cadrage, aujourdhui), "Cadrage enregistré.")}>Enregistrer</button>
          {d.cadrage_statut && <button className="inv-btn inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchCadrage(d, null, null, aujourdhui), "Cadrage remis à faire.")}>Remettre à faire</button>}
        </div>
      </>
    );
  } else if (geste === "forfait") {
    corps = (
      <>
        <label style={{ fontSize: 12, color: T.textSub }}>Montant HT (€) <input className="inv-inp" inputMode="decimal" placeholder="Non renseigné" value={v.forfait} onChange={maj("forfait")} /></label>
        <div style={{ fontSize: 11.5, color: T.textMuted }}>Laisser vide si le montant n'est pas connu : il s'affichera « non renseigné », jamais 0 €.</div>
        <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchForfait(d, v.forfait), "Forfait de mission enregistré.")}>Enregistrer</button>
      </>
    );
  } else if (geste === "lettre") {
    corps = (
      <>
        <select className="inv-sel" value={v.lettre} onChange={maj("lettre")} aria-label="Statut de la lettre">
          {Object.entries(STATUTS_LETTRE_MISSION).filter(([k]) => k !== "inconnu").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {v.lettre === "signee" && <label style={{ fontSize: 12, color: T.textSub }}>Signée le <input className="inv-inp" type="date" max={aujourdhui} value={v.signee} onChange={maj("signee")} /></label>}
        <button className="inv-btn inv-btn-blue inv-btn-sm" disabled={envoi} onClick={() => envoyer(() => patchLettre(d, v.lettre, v.signee, aujourdhui), "Lettre de mission enregistrée.")}>Enregistrer</button>
      </>
    );
  }
  return (
    <Carte T={T} titre={TITRES_GESTE[geste]} action={<button className="inv-btn inv-btn-sm" onClick={onFermer}>Fermer</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        {corps}
        {erreur && <div style={{ fontSize: 12, color: "#be123c" }}>{erreur}</div>}
      </div>
    </Carte>
  );
}
