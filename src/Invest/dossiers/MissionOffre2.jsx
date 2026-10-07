// src/Invest/dossiers/MissionOffre2.jsx — l'intérieur d'une mission Offre 2 (accompagnement à l'investissement).
//
// Sept onglets : Vue d'ensemble · Projet · Recherche & biens · Offre & acquisition · Financement · Travaux · Transmission.
// La situation patrimoniale et les documents appartiennent au CLIENT : la mission n'en affiche que la complétude et renvoie
// vers les onglets de la fiche client. Aucune donnée n'est dupliquée : les biens viennent du Stock, l'offre de la fiche du
// bien, l'acquisition de invest_dossier_acquisitions, le financement de invest_dossier_financements / banques.
// Le parcours à 11 étapes est inchangé : la frise est un mapping d'affichage (offre2Vue.mjs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { clientStrategy } from "../_shared";
import { champsNouvelleTache } from "./dossierVue";
import { ETAPES_PARCOURS } from "./parcours";
import { NAV_OFFRE2, ongletMissionValide, construireModeleMission } from "./offre2Vue";
import { FriseMission, Bloc, Pastille, Donnee, COULEURS, dateFr, aujourdhuiIso } from "./MissionUi";
import MissionEnsemble from "./MissionEnsemble";
import MissionProjet from "./MissionProjet";
import MissionBiens from "./MissionBiens";
import MissionOffreAcquisition from "./MissionOffreAcquisition";
import MissionFinancement from "./MissionFinancement";
import MissionTravaux from "./MissionTravaux";
import MissionTransmission from "./MissionTransmission";

function NouvelleAction({ T, fiche, client, profil, utilisateurs, etapeDefaut, onAnnule, onCree }) {
  const [f, setF] = useState({ titre: "", etape: etapeDefaut || "signature", responsable_id: "", echeance: "" });
  const [erreur, setErreur] = useState("");
  const creer = async () => {
    setErreur("");
    if (!f.titre.trim()) { setErreur("Indiquez l'action."); return; }
    let champs;
    try { champs = champsNouvelleTache(fiche.dossierEnCours?.id, f.etape); } catch (e) { setErreur(e.message); return; }
    const u = utilisateurs.find((x) => x.id === f.responsable_id);
    const { error } = await supabase.from("invest_mission_actions").insert({
      client_id: client.id, ...champs, sort_order: 999, action_title: f.titre.trim(), responsable: u?.nom || null, responsable_email: u?.email || null,
      status: "a_faire", due_date: f.echeance || null, created_by: profil?.nom || profil?.email || null, metadata: { source: "mission_offre2" },
    });
    if (error) { setErreur(error.message); return; }
    onCree("Action ajoutée à la mission.");
  };
  return (
    <Bloc T={T} titre="Nouvelle action">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6 }}>
        <input className="inv-inp" style={{ gridColumn: "1 / -1", textAlign: "left" }} placeholder="Action à réaliser" value={f.titre} onChange={(e) => setF((x) => ({ ...x, titre: e.target.value }))} />
        <select className="inv-sel" value={f.etape} onChange={(e) => setF((x) => ({ ...x, etape: e.target.value }))} aria-label="Étape">{ETAPES_PARCOURS.map((x) => <option key={x.cle} value={x.cle}>{x.libelle}</option>)}</select>
        <select className="inv-sel" value={f.responsable_id} onChange={(e) => setF((x) => ({ ...x, responsable_id: e.target.value }))} aria-label="Responsable"><option value="">Responsable…</option>{utilisateurs.filter((u) => u.actif).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}</select>
        <input className="inv-inp" type="date" value={f.echeance} onChange={(e) => setF((x) => ({ ...x, echeance: e.target.value }))} aria-label="Échéance" />
        <div style={{ display: "flex", gap: 6 }}><button className="inv-btn inv-btn-blue inv-btn-sm" onClick={creer}>Ajouter</button><button className="inv-btn inv-btn-sm" onClick={onAnnule}>Annuler</button></div>
      </div>
      {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
    </Bloc>
  );
}

export default function MissionOffre2({ T, client, profil, fiche, donnees, onRafraichir, onMessage, onOuvrirEtape, onGeste, onClientOnglet, onOpenBien, parcoursDetail, honorairesCard, ongletInitial = "ensemble" }) {
  const [onglet, setOnglet] = useState(ongletMissionValide(ongletInitial));
  const [menu, setMenu] = useState(false);
  const [details, setDetails] = useState(null);       // null | "parcours" | "honoraires"
  const [nouvelle, setNouvelle] = useState(false);
  const [extra, setExtra] = useState(null);
  const [lecture, setLecture] = useState("");
  const [rev, setRev] = useState(0);
  const aujourdhui = aujourdhuiIso();
  const d = fiche.dossier;
  const modifiable = fiche.modifiable;

  const charger = useCallback(async () => {
    const [rp, ra, rf, rb, rs, rsc, rh, rn] = await Promise.all([
      supabase.from("invest_propositions").select("*, bien:invest_biens(*)").eq("client_id", client.id).order("created_at", { ascending: false }),
      supabase.from("invest_dossier_acquisitions").select("*").eq("dossier_id", d.id).order("created_at", { ascending: true }),
      supabase.from("invest_dossier_financements").select("*").eq("dossier_id", d.id).maybeSingle(),
      supabase.from("invest_dossier_banques").select("*").eq("dossier_id", d.id).order("created_at", { ascending: true }),
      supabase.from("invest_dossier_strategies").select("message_cle,recommandation,statut").eq("dossier_id", d.id).maybeSingle(),
      supabase.from("invest_dossier_scenarios").select("id,ordre,libelle,recommande").eq("dossier_id", d.id).order("ordre", { ascending: true }),
      supabase.from("invest_dossier_analyses").select("hypotheses").eq("dossier_id", d.id).maybeSingle(),
      supabase.from("invest_notes").select("id,type,contenu,auteur,date,created_at").eq("client_id", client.id).order("date", { ascending: false }).limit(20),
    ]);
    setLecture([rp, ra, rf, rb, rs, rsc, rh, rn].map((r) => r.error).filter(Boolean).map((e) => e.message).join(" · "));
    setExtra({ propositions: rp.data || [], acquisitions: ra.data || [], financement: rf.data || null, banques: rb.data || [], strategie: rs.data || null, scenarios: rsc.data || [],
      hypotheses: rh.data?.hypotheses || {}, notes: rn.data || [] });
  }, [client.id, d.id, rev]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { setOnglet(ongletMissionValide(ongletInitial)); setNouvelle(false); setDetails(null); }, [d.id]);
  const recharger = () => { setRev((x) => x + 1); onRafraichir?.(); };

  const m = useMemo(() => (extra ? construireModeleMission({ extra, donnees, fiche, strategieClient: clientStrategy(client), aujourdhui }) : null), [extra, donnees, fiche, client, aujourdhui]);

  if (!m) return <Bloc T={T}><div style={{ fontSize: 13, color: T.textMuted }}>Chargement de la mission…</div></Bloc>;
  const e = fiche.entete, p = fiche.pilotage, af = fiche.aFaire;
  const sansAction = !!af?.sansAction && (af?.balleType === "profero" || !af?.balleType);
  const ouvrirDefinir = () => (m.etapeDefinir ? onOuvrirEtape(m.etapeDefinir) : onMessage?.("Aucune étape à renseigner : le parcours est vide."));
  const naviguer = (cible) => {
    if (cible === "definir") ouvrirDefinir();
    else if (cible === "etape") ouvrirDefinir();
    else if (String(cible).startsWith("client:")) onClientOnglet?.(String(cible).slice(7));
    else setOnglet(ongletMissionValide(cible));
  };
  const ctx = { fiche, donnees, client, profil, m, extra, modifiable, recharger, onMessage, naviguer, onOuvrirEtape, ouvrirDefinir, onClientOnglet, onOpenBien, setOnglet };
  const balle = af?.balle || af?.responsable || null;

  return (
    <div id="mission-offre2" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ── Bandeau ── */}
      <section style={{ background: T.surface || T.card, border: `1px solid ${T.border}`, borderTop: `3px solid ${T.accent}`, borderRadius: 12, padding: "11px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.textSub }}>{e.reference} · {e.offre.court ? `${e.offre.court} — ${e.offre.libelle}` : e.offre.libelle}</div>
            <div style={{ fontSize: 19, fontWeight: 900, color: T.text, marginTop: 1 }}>{fiche.client.nom}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 3, fontSize: 12.5, color: T.textSub }}>
              <Pastille couleur={e.clos ? "#64748b" : COULEURS.cours}>{e.statutLibelle}</Pastille>
              <span>Conseiller : <b style={{ color: T.text }}>{e.conseiller || "non défini"}</b></span>
              {fiche.dossiers.length > 1 && <span style={{ color: T.textMuted }}>{e.libelle}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
            {modifiable && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setNouvelle((v) => !v)}>＋ Action</button>}
            <button className="inv-btn inv-btn-sm" onClick={recharger}>Actualiser</button>
            <button className="inv-btn inv-btn-sm" aria-haspopup="menu" aria-expanded={menu} aria-label="Autres actions" onClick={() => setMenu((v) => !v)}>•••</button>
            {menu && (
              <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, minWidth: 230, background: T.surface || T.card, border: `1px solid ${T.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: 4 }}>
                {[
                  { cle: "parcours", libelle: "Parcours détaillé (11 étapes)", f: () => setDetails((v) => (v === "parcours" ? null : "parcours")) },
                  { cle: "honoraires", libelle: "Mission, honoraires et portail", f: () => setDetails((v) => (v === "honoraires" ? null : "honoraires")) },
                  modifiable && { cle: "forfait", libelle: "Forfait de mission", f: () => onGeste("forfait") },
                  modifiable && { cle: "lettre", libelle: "Lettre de mission", f: () => onGeste("lettre") },
                  modifiable && fiche.offreCible === "audit_patrimonial" && { cle: "offre3", libelle: "Passer en Offre 3", f: () => onGeste("offre") },
                  { cle: "client", libelle: "Ouvrir la fiche client", f: () => onClientOnglet?.("ensemble") },
                ].filter(Boolean).map((a) => (
                  <button key={a.cle} role="menuitem" onClick={() => { setMenu(false); a.f(); }}
                    style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "none", padding: "7px 10px", borderRadius: 7, fontSize: 12.5, fontWeight: 700, color: T.text, cursor: "pointer" }}>{a.libelle}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        {e.clos && <div style={{ marginTop: 8, fontSize: 12.5, color: T.textMuted }}>Mission terminée{e.motifCloture ? ` : ${e.motifCloture}` : ""}. Consultation seule.</div>}
        {!e.clos && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "8px 18px", marginTop: 10, paddingTop: 9, borderTop: `1px solid ${T.rowBorder || T.border}` }}>
            <Donnee T={T} libelle="ÉTAPE ACTUELLE" valeur={m.frise.libelleCourant || (p?.principale?.libelle ?? null)} fort />
            <Donnee T={T} libelle="PROCHAINE ACTION" valeur={af && !af.sansAction ? af.action : null} fort />
            <Donnee T={T} libelle="ÉCHÉANCE" valeur={af?.echeance ? `${dateFr(af.echeance)}${af.retardJours ? ` · ${af.retardJours} j de retard` : ""}` : null} fort />
            <Donnee T={T} libelle="BALLE" valeur={balle} fort />
          </div>
        )}
        {!e.clos && sansAction && (
          <div role="alert" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8, padding: "6px 10px", borderRadius: 8, background: "#d9770614", border: "1px solid #d9770640", fontSize: 12.5, fontWeight: 800, color: "#b45309" }}>
            <span>⚠ Aucune prochaine action définie alors que Profero a la balle.</span>
            {modifiable && <button className="inv-btn inv-btn-sm" onClick={ouvrirDefinir}>Définir la prochaine action</button>}
          </div>
        )}
        {(p?.blocages || []).length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {p.blocages.map((b) => <Pastille key={b.etape} couleur={COULEURS.bloque}>Bloqué : {b.etape}{b.motif ? ` — ${b.motif}` : ""}</Pastille>)}
          </div>
        )}
        <div style={{ marginTop: 10 }}><FriseMission T={T} frise={m.frise} onOuvrir={(o) => setOnglet(ongletMissionValide(o))} /></div>
      </section>

      {nouvelle && modifiable && <NouvelleAction T={T} fiche={fiche} client={client} profil={profil} utilisateurs={donnees.utilisateurs} etapeDefaut={m.etapeDefinir}
        onAnnule={() => setNouvelle(false)} onCree={(txt) => { setNouvelle(false); onMessage?.(txt); recharger(); }} />}
      {details === "parcours" && <Bloc T={T} titre="Parcours détaillé (étapes historiques)" action={<button className="inv-btn inv-btn-sm" onClick={() => setDetails(null)}>Fermer</button>}>{parcoursDetail}</Bloc>}
      {details === "honoraires" && <div>{honorairesCard}</div>}
      {lecture && <div style={{ fontSize: 12, color: "#be123c" }}>Lecture incomplète : {lecture}</div>}

      {/* ── Navigation ── */}
      <nav role="tablist" aria-label="Sections de la mission" style={{ display: "flex", gap: 18, borderBottom: `1px solid ${T.border}`, overflowX: "auto" }}>
        {NAV_OFFRE2.map((o) => {
          const on = onglet === o.cle;
          return (
            <button key={o.cle} role="tab" aria-selected={on} onClick={() => setOnglet(o.cle)}
              style={{ border: 0, background: "none", cursor: "pointer", padding: "8px 0", marginBottom: -1, whiteSpace: "nowrap", fontSize: 13, fontWeight: on ? 900 : 700,
                color: on ? T.text : T.textSub, borderBottom: `2px solid ${on ? T.text : "transparent"}` }}>{o.libelle}</button>
          );
        })}
      </nav>

      {onglet === "ensemble" && <MissionEnsemble T={T} {...ctx} />}
      {onglet === "projet" && <MissionProjet T={T} {...ctx} />}
      {onglet === "biens" && <MissionBiens T={T} {...ctx} />}
      {onglet === "offre" && <MissionOffreAcquisition T={T} {...ctx} />}
      {onglet === "financement" && <MissionFinancement T={T} {...ctx} />}
      {onglet === "travaux" && <MissionTravaux T={T} {...ctx} />}
      {onglet === "transmission" && <MissionTransmission T={T} {...ctx} />}
    </div>
  );
}
