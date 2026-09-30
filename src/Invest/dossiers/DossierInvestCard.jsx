// src/Invest/dossiers/DossierInvestCard.jsx — Carte « Dossier Invest » de la
// fiche client (Chantier 1.1, Tranche 2a).
//
// Représentation principale de l'avancement d'un client : ruban des 11 étapes,
// « Maintenant », anomalies, panneau par étape avec les gestes explicites,
// tâches rangées par étape et journal.
//
// Règles tenues ici (et contrôlées par la base) :
//   - rien ne fait avancer une étape sans geste d'un collaborateur ;
//   - une étape reprise reste « à confirmer » tant que « Confirmer la reprise »
//     n'a pas été cliqué, même si son statut ou sa balle est corrigé ;
//   - le statut du client n'est jamais corrigé ici : une incohérence est signalée ;
//   - aucune écriture dans invest_clients.etape / etape_num.
// Les calculs d'affichage sont dans dossierVue.mjs et transitions.mjs (purs).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import { ETAPES_PARCOURS, BALLES, STATUTS_ETAPE } from "./parcours";
import { gestesDisponibles, preparerGeste, BALLES_AVEC_COLLABORATEUR, BALLES_AVEC_TIERS } from "./transitions";
import {
  choisirDossier, listeDossiers, ruban, maintenant, anomalies, tachesParEtape,
  suggestions, journal, entete, libelleBalle, libelleEcheance, incoherenceStatutClient,
} from "./dossierVue";

const COULEURS_STATUT = {
  a_venir: "#94a3b8", en_cours: "#2563eb", en_attente: "#d97706", bloquee: "#dc2626",
  terminee: "#16a34a", non_applicable: "#64748b",
};
const TABLE_ABSENTE = (e) => e && (e.code === "42P01" || e.code === "PGRST205");
const aujourdhuiIso = () => new Date().toISOString().slice(0, 10);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const dateHeureFr = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
};

function Pastille({ couleur, children, titre }) {
  return (
    <span title={titre} style={{ fontSize: 10, fontWeight: 900, color: couleur, background: `${couleur}14`,
      border: `1px solid ${couleur}40`, borderRadius: 999, padding: "2px 7px", whiteSpace: "nowrap" }}>{children}</span>
  );
}

function Encadre({ T, titre, children, style }) {
  return (
    <div style={{ border: `1px solid ${T.border}`, background: T.input, borderRadius: 12, padding: "10px 12px", minWidth: 0, ...style }}>
      {titre && <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 900, textTransform: "uppercase", letterSpacing: .8, marginBottom: 6 }}>{titre}</div>}
      {children}
    </div>
  );
}

export default function DossierInvestCard({ client, T, profil, onDossierChange }) {
  const [etat, setEtat] = useState({ chargement: true, absent: false, erreur: "" });
  const [dossiers, setDossiers] = useState([]);
  const [idChoisi, setIdChoisi] = useState(null);
  const [etapes, setEtapes] = useState([]);
  const [evenements, setEvenements] = useState([]);
  const [controle, setControle] = useState([]);
  const [taches, setTaches] = useState([]);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [panneau, setPanneau] = useState(null); // clé d'étape ouverte dans le panneau latéral
  const [demarrage, setDemarrage] = useState(null); // formulaire « Démarrer une mission »
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState("");
  const aujourdhui = aujourdhuiIso();

  const charger = useCallback(async () => {
    if (!client?.id) return;
    setEtat((e) => ({ ...e, chargement: true, erreur: "" }));
    const [{ data: ds, error: eD }, { data: us }] = await Promise.all([
      supabase.from("invest_dossiers").select("*").eq("client_id", client.id).order("created_at", { ascending: false }),
      supabase.from("utilisateurs").select("id,nom,email,actif"),
    ]);
    setUtilisateurs(us || []);
    if (eD) {
      setEtat({ chargement: false, absent: TABLE_ABSENTE(eD), erreur: TABLE_ABSENTE(eD) ? "" : eD.message });
      setDossiers([]); onDossierChange?.(null);
      return;
    }
    setDossiers(ds || []);
    const d = choisirDossier(ds || [], idChoisi);
    const [rE, rJ, rC, rT] = await Promise.all([
      d ? supabase.from("invest_dossier_etapes").select("*").eq("dossier_id", d.id).is("operation_id", null) : { data: [] },
      d ? supabase.from("invest_dossier_evenements").select("id,survenu_le,type,resume,auteur_libelle,auteur_type,etape_id")
            .eq("dossier_id", d.id).order("survenu_le", { ascending: false }).limit(300) : { data: [] },
      supabase.from("invest_controle_dossiers").select("*").eq("client_id", client.id),
      supabase.from("invest_mission_actions").select("id,action_title,status,due_date,responsable,dossier_id,etape,step_key,step_label")
        .eq("client_id", client.id),
    ]);
    const erreur = [rE.error, rJ.error, rC.error, rT.error].filter(Boolean).map((e) => e.message).join(" · ");
    setEtapes(rE.data || []); setEvenements(rJ.data || []); setControle(rC.data || []); setTaches(rT.data || []);
    setEtat({ chargement: false, absent: false, erreur });
  }, [client?.id, idChoisi]);

  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { setIdChoisi(null); setPanneau(null); setDemarrage(null); setMessage(""); }, [client?.id]);

  const dossier = useMemo(() => choisirDossier(dossiers, idChoisi), [dossiers, idChoisi]);
  const vue = useMemo(() => ({
    entete: entete(dossier, utilisateurs),
    liste: listeDossiers(dossiers, dossier),
    ruban: ruban(etapes, utilisateurs),
    maintenant: maintenant(etapes, utilisateurs, aujourdhui),
    anomalies: anomalies(controle, dossier?.id),
    taches: tachesParEtape(taches, dossier?.id),
    suggestions: suggestions(etapes, taches, dossier?.id),
    journal: journal(evenements),
    incoherence: incoherenceStatutClient(client, dossiers),
  }), [dossier, dossiers, etapes, utilisateurs, controle, taches, evenements, client, aujourdhui]);

  // La fiche (parcours mission, tâche collaborateur) a besoin du dossier EN COURS et de son étape courante.
  // Le dossier en cours reste la cible des nouvelles tâches même quand un ancien dossier est consulté.
  const dossierEnCours = useMemo(() => choisirDossier(dossiers.filter((d) => !listeDossiers([d])[0].clos)), [dossiers]);
  useEffect(() => {
    if (etat.chargement) return;
    const afficheEnCours = !!dossier && dossier.id === dossierEnCours?.id;
    onDossierChange?.(dossier ? {
      dossierId: dossier.id, dossierEnCoursId: dossierEnCours?.id ?? null, reference: dossier.reference,
      etapeCourante: afficheEnCours && !vue.maintenant.aucune ? vue.maintenant.etape : null,
      etapeCouranteLibelle: !vue.maintenant.aucune ? vue.maintenant.libelle : null,
    } : null);
  }, [etat.chargement, dossier?.id, dossierEnCours?.id, vue.maintenant.etape]);

  const monId = utilisateurs.find((u) => String(u.email || "").trim().toLowerCase() === String(profil?.email || "").trim().toLowerCase())?.id || "";

  const demarrerMission = async () => {
    setEnCours(true); setMessage("");
    const { data, error } = await supabase.rpc("invest_ouvrir_dossier", {
      p_client_id: client.id,
      p_options: { libelle: demarrage?.libelle || "", conseiller_id: demarrage?.conseiller_id || null },
    });
    setEnCours(false);
    if (error) { setMessage(`Mission non démarrée : ${error.message}`); return; }
    setDemarrage(null); setIdChoisi(data || null); setMessage("Mission démarrée : dossier et 11 étapes créés.");
    charger();
  };

  // ── Rendu ────────────────────────────────────────────────────────────────
  const hd = (
    <div className="inv-card-hd" style={{ justifyContent: "space-between" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>Dossier Invest</span>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {vue.liste.length > 1 && (
          <select className="inv-sel" value={dossier?.id || ""} onChange={(e) => { setIdChoisi(e.target.value); setPanneau(null); }}
            style={{ fontSize: 12, padding: "4px 6px" }} aria-label="Choisir un dossier">
            {vue.liste.map((d) => <option key={d.id} value={d.id}>{d.libelle} — {d.statut}</option>)}
          </select>
        )}
        {!etat.absent && !dossierEnCours && (
          <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setDemarrage({ libelle: `Dossier Invest ${aujourdhui.slice(0, 4)}`, conseiller_id: monId })}>
            Démarrer une mission
          </button>
        )}
        <button className="inv-btn inv-btn-sm" onClick={charger} disabled={etat.chargement}>Actualiser</button>
      </div>
    </div>
  );

  if (etat.absent) {
    return <div className="inv-card">{hd}<div className="inv-card-bd" style={{ fontSize: 12, color: T.textMuted }}>
      Les Dossiers Invest ne sont pas encore installés sur cette base : l'avancement ne peut pas être affiché.</div></div>;
  }

  return (
    <div className="inv-card" id="dossier-invest">
      {hd}
      <div className="inv-card-bd" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {etat.erreur && <div style={{ padding: "8px 10px", borderRadius: 8, background: "#fff1f2", border: "1px solid #fecdd3", color: "#be123c", fontSize: 12 }}>⚠ Lecture incomplète : {etat.erreur}</div>}
        {message && <div style={{ padding: "8px 10px", borderRadius: 8, background: T.accentBg, border: `1px solid ${T.border}`, color: T.text, fontSize: 12 }}>{message}</div>}

        {demarrage && (
          <Encadre T={T} titre="Démarrer une mission">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
              <input className="inv-inp" value={demarrage.libelle} onChange={(e) => setDemarrage((p) => ({ ...p, libelle: e.target.value }))} placeholder="Libellé du dossier" />
              <select className="inv-sel" value={demarrage.conseiller_id || ""} onChange={(e) => setDemarrage((p) => ({ ...p, conseiller_id: e.target.value }))}>
                <option value="">Conseiller : aucun</option>
                {utilisateurs.filter((u) => u.actif).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6 }}>
              Crée le dossier et ses 11 étapes en une seule fois. « Signature » démarre avec la balle au conseiller ; les autres étapes restent « à venir ».
              {String(client?.statut || "").toLowerCase() === "prospect" && " Le client passera de « Prospect » à « Actif »."}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={demarrerMission} disabled={enCours}>Créer le dossier</button>
              <button className="inv-btn inv-btn-sm" onClick={() => setDemarrage(null)} disabled={enCours}>Annuler</button>
            </div>
          </Encadre>
        )}

        {etat.chargement && !dossier && <div style={{ fontSize: 12, color: T.textMuted }}>Chargement…</div>}
        {!etat.chargement && !dossier && (
          <div style={{ fontSize: 12.5, color: T.textMuted }}>
            Aucun Dossier Invest pour ce client. L'ancienne étape reste visible dans la synthèse, à titre d'historique.
          </div>
        )}

        {vue.incoherence && <div style={{ padding: "8px 10px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 12 }}>⚠ {vue.incoherence}</div>}
        {vue.anomalies.length > 0 && (
          <Encadre T={T} titre="Points à vérifier">
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {vue.anomalies.map((a) => (
                <div key={a.type} style={{ fontSize: 12, color: T.text }}>
                  <b>{a.libelle}</b>{a.nombre > 1 ? ` (${a.nombre})` : ""}
                  {a.details.length > 0 && <span style={{ color: T.textMuted }}> — {a.details.slice(0, 3).join(" · ")}{a.details.length > 3 ? " …" : ""}</span>}
                </div>
              ))}
            </div>
          </Encadre>
        )}

        {dossier && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: T.text }}>
              <b>{vue.entete.reference}</b><span>{vue.entete.libelle}</span>
              <Pastille couleur={vue.entete.clos ? "#64748b" : "#2563eb"}>{vue.entete.statutLibelle}</Pastille>
              <span style={{ color: T.textMuted }}>Conseiller : {vue.entete.conseiller}</span>
              <span style={{ color: vue.entete.lettreAnomalie ? "#d97706" : T.textMuted }}>Lettre de mission : {vue.entete.lettre}</span>
              {vue.entete.clos && vue.entete.motifCloture && <span style={{ color: T.textMuted }}>Motif : {vue.entete.motifCloture}</span>}
            </div>

            <Ruban T={T} ruban={vue.ruban} taches={vue.taches} onOuvrir={setPanneau} />
            <Maintenant T={T} m={vue.maintenant} onOuvrir={setPanneau} />

            {vue.suggestions.length > 0 && !vue.entete.clos && (
              <Encadre T={T} titre="Suggestions (jamais appliquées automatiquement)">
                {vue.suggestions.map((s) => (
                  <div key={s.etape} style={{ fontSize: 12, color: T.text }}>
                    {ETAPES_PARCOURS.find((e) => e.cle === s.etape)?.libelle} : passer en « {STATUTS_ETAPE[s.statut_suggere]} » ? <span style={{ color: T.textMuted }}>{s.raison}</span>
                    {" "}<button className="inv-btn inv-btn-sm" style={{ padding: "1px 6px" }} onClick={() => setPanneau(s.etape)}>Ouvrir l'étape</button>
                  </div>
                ))}
              </Encadre>
            )}

            <Journal T={T} lignes={vue.journal} />
          </>
        )}
      </div>

      {panneau && dossier && (
        <PanneauEtape
          T={T} cle={panneau} dossier={dossier} clos={vue.entete.clos}
          etape={etapes.find((e) => e.etape === panneau)}
          taches={vue.taches[panneau]} utilisateurs={utilisateurs} monId={monId}
          journal={journal(evenements, etapes.find((e) => e.etape === panneau)?.id)}
          aujourdhui={aujourdhui}
          onFermer={() => setPanneau(null)}
          onEnregistre={(txt) => { setMessage(txt); charger(); }}
        />
      )}
    </div>
  );
}

function Ruban({ T, ruban: r, taches, onOuvrir }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(92px,1fr))", gap: 5 }}>
      {r.map((e) => {
        const c = COULEURS_STATUT[e.statut] || "#cbd5e1";
        const ouvertes = taches[e.cle]?.ouvertes.length || 0;
        return (
          <button key={e.cle} onClick={() => e.present && onOuvrir(e.cle)} disabled={!e.present}
            title={`${e.libelle} — ${e.statutLibelle}${e.balle ? ` · balle : ${e.balle}` : ""}`}
            style={{ textAlign: "left", cursor: e.present ? "pointer" : "not-allowed", borderRadius: 10, padding: "6px 7px", minWidth: 0,
              border: `${e.active ? 2 : 1}px solid ${e.active ? c : T.border}`, background: e.active ? `${c}10` : T.input, color: T.text }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 4, fontSize: 9.5, fontWeight: 900, color: T.textMuted }}>
              <span>#{e.numero}</span>
              {e.aConfirmer && <span style={{ color: "#d97706" }} title="Étape issue de la reprise, à confirmer">à confirmer</span>}
            </div>
            <div style={{ fontSize: 11, fontWeight: 900, lineHeight: 1.2, marginTop: 2 }}>{e.libelle}</div>
            <div style={{ fontSize: 10, fontWeight: 800, color: c, marginTop: 3 }}>{e.statutLibelle}</div>
            {ouvertes > 0 && <div style={{ fontSize: 9.5, color: T.textMuted, marginTop: 2 }}>{ouvertes} tâche{ouvertes > 1 ? "s" : ""} ouverte{ouvertes > 1 ? "s" : ""}</div>}
          </button>
        );
      })}
    </div>
  );
}

function Maintenant({ T, m, onOuvrir }) {
  if (m.aucune) {
    return <Encadre T={T} titre="Maintenant"><div style={{ fontSize: 12.5, color: T.textMuted }}>Aucune étape active : personne n'a la balle.</div></Encadre>;
  }
  return (
    <Encadre T={T} titre="Maintenant">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 8, fontSize: 12.5, color: T.text }}>
        <div><div style={{ color: T.textMuted, fontSize: 11 }}>Étape</div>
          <button className="inv-btn inv-btn-sm" onClick={() => onOuvrir(m.etape)} style={{ fontWeight: 900 }}>{m.libelle} · {m.statutLibelle}</button></div>
        <div><div style={{ color: T.textMuted, fontSize: 11 }}>Balle</div><b>{m.balle || "personne"}</b></div>
        <div><div style={{ color: T.textMuted, fontSize: 11 }}>Prochaine action</div>{m.prochaineAction || <span style={{ color: T.textMuted }}>non renseignée</span>}</div>
        <div><div style={{ color: T.textMuted, fontSize: 11 }}>Échéance</div>
          <span style={{ color: m.echeance.depassee ? "#dc2626" : T.text, fontWeight: m.echeance.depassee ? 900 : 400 }}>{m.echeance.texte}{m.echeance.depassee ? " (dépassée)" : ""}</span></div>
      </div>
      {m.blocage && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c" }}>
          Bloquée{m.blocage.depuis ? ` depuis le ${dateFr(m.blocage.depuis)}` : ""} : {m.blocage.motif || "motif non renseigné"}
        </div>
      )}
      {m.actives.length > 1 && (
        <div style={{ marginTop: 8, fontSize: 12, color: T.text }}>
          <span style={{ color: T.textMuted }}>Étapes actives ({m.actives.length}) : </span>
          {m.actives.map((a, i) => (
            <span key={a.etape}>{i > 0 && " · "}
              <a href="#dossier-invest" onClick={(ev) => { ev.preventDefault(); onOuvrir(a.etape); }} style={{ color: T.accent }}>{a.libelle}</a>
              {" "}({STATUTS_ETAPE[a.statut]}{a.balle ? `, ${a.balle}` : ""})</span>
          ))}
        </div>
      )}
    </Encadre>
  );
}

function Journal({ T, lignes, titre = "Journal du dossier", max = 12 }) {
  const [tout, setTout] = useState(false);
  const visibles = tout ? lignes : lignes.slice(0, max);
  return (
    <Encadre T={T} titre={titre}>
      {lignes.length === 0 && <div style={{ fontSize: 12, color: T.textMuted }}>Aucun événement.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {visibles.map((l) => (
          <div key={l.id} style={{ fontSize: 12, color: T.text, display: "flex", gap: 8 }}>
            <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>{dateHeureFr(l.quand)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>{l.resume}</span>
            <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>{l.auteur}</span>
          </div>
        ))}
      </div>
      {lignes.length > max && (
        <button className="inv-btn inv-btn-sm" style={{ marginTop: 6 }} onClick={() => setTout((v) => !v)}>
          {tout ? "Réduire" : `Voir les ${lignes.length} événements`}
        </button>
      )}
    </Encadre>
  );
}

function PanneauEtape({ T, cle, dossier, clos, etape, taches, utilisateurs, monId, journal: lignes, aujourdhui, onFermer, onEnregistre }) {
  const ref = ETAPES_PARCOURS.find((e) => e.cle === cle);
  const [geste, setGeste] = useState(null);
  const [saisie, setSaisie] = useState({});
  const [erreurs, setErreurs] = useState([]);
  const [enCours, setEnCours] = useState(false);
  const [tachesAFermer, setTachesAFermer] = useState(null); // choix explicite au moment de « Terminer »
  useEffect(() => { setGeste(null); setSaisie({}); setErreurs([]); setTachesAFermer(null); }, [cle, etape?.id]);
  if (!etape) return null;

  const gestes = clos ? [] : gestesDisponibles(etape);
  const ouvrirGeste = (g) => {
    setErreurs([]); setGeste(g); setTachesAFermer(g.cle === "terminer" ? "laisser" : null);
    setSaisie({
      balle: etape.balle || "profero",
      balle_utilisateur_id: etape.balle_utilisateur_id || (etape.balle ? "" : monId),
      balle_tiers_libelle: etape.balle_tiers_libelle || "",
      prochaine_action: etape.prochaine_action || "", prochaine_action_id: etape.prochaine_action_id || "",
      echeance: etape.echeance ? String(etape.echeance).slice(0, 10) : "", motif: "",
    });
  };
  const maj = (k, v) => setSaisie((p) => ({ ...p, [k]: v }));

  const valider = async () => {
    const { patch, erreurs: errs } = preparerGeste(etape, geste.cle, saisie, aujourdhui);
    if (errs.length) { setErreurs(errs); return; }
    setEnCours(true);
    const { data, error } = await supabase.from("invest_dossier_etapes").update(patch).eq("id", etape.id).select("id");
    if (error || !data?.length) {
      setEnCours(false);
      setErreurs([error ? error.message : "Modification refusée (droits insuffisants ou étape introuvable)."]);
      return;
    }
    let complement = "";
    if (geste.cle === "terminer" && tachesAFermer === "non_concerne" && taches.ouvertes.length) {
      const ids = taches.ouvertes.map((t) => t.id);
      const { error: eT } = await supabase.from("invest_mission_actions")
        .update({ status: "non_concerne", updated_at: new Date().toISOString() }).in("id", ids);
      complement = eT ? ` Attention : les tâches ouvertes n'ont pas pu être passées « non concerné » (${eT.message}).`
                      : ` ${ids.length} tâche(s) ouverte(s) passée(s) « non concerné ».`;
    }
    setEnCours(false); setGeste(null);
    onEnregistre(`${ref.libelle} : « ${geste.libelle} » enregistré.${complement}`);
  };

  const exige = geste?.exige || [];
  const champBalle = exige.includes("balle");
  const champMotif = exige.includes("motif") || ["demarrer", "reprendre", "mettre_en_attente", "debloquer", "terminer"].includes(geste?.cle);
  const libelleMotif = geste?.cle === "bloquer" ? "Motif du blocage *" : geste?.cle === "non_applicable" ? "Pourquoi l'étape ne s'applique pas *"
    : geste?.cle === "rouvrir" ? "Motif de la réouverture *" : "Commentaire (facultatif)";

  return (
    <div role="dialog" aria-label={`Étape ${ref.libelle}`} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end", background: "rgba(15,23,42,.25)" }} onClick={onFermer}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px,100%)", height: "100%", overflowY: "auto", background: T.surface || "#fff", color: T.text,
        borderLeft: `1px solid ${T.border}`, padding: 16, display: "flex", flexDirection: "column", gap: 10, boxShadow: "-12px 0 32px rgba(15,23,42,.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>#{ref.numero} {ref.libelle}</div>
          <button className="inv-btn inv-btn-sm" onClick={onFermer}>Fermer</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Pastille couleur={COULEURS_STATUT[etape.statut]}>{STATUTS_ETAPE[etape.statut]}</Pastille>
          {etape.reprise_a_confirmer && <Pastille couleur="#d97706" titre="Statut et balle viennent de la reprise des anciennes données">Reprise à confirmer</Pastille>}
          {clos && <Pastille couleur="#64748b">Dossier clos : lecture seule</Pastille>}
        </div>

        <Encadre T={T}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12.5 }}>
            <div><span style={{ color: T.textMuted }}>Balle : </span><b>{libelleBalle(etape, utilisateurs) || "personne"}</b></div>
            <div><span style={{ color: T.textMuted }}>Échéance : </span>{libelleEcheance(etape.echeance, aujourdhui).texte}</div>
            <div style={{ gridColumn: "1 / -1" }}><span style={{ color: T.textMuted }}>Prochaine action : </span>{etape.prochaine_action || "non renseignée"}</div>
            <div><span style={{ color: T.textMuted }}>Début : </span>{dateFr(etape.date_debut) || "non renseigné"}</div>
            <div><span style={{ color: T.textMuted }}>Fin : </span>{dateFr(etape.date_fin) || "—"}</div>
            {etape.statut === "bloquee" && <div style={{ gridColumn: "1 / -1", color: "#b91c1c" }}>Blocage : {etape.blocage_motif}{etape.bloquee_depuis ? ` (depuis le ${dateFr(etape.bloquee_depuis)})` : ""}</div>}
            {etape.commentaire && <div style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap", color: T.textMuted }}>{etape.commentaire}</div>}
          </div>
        </Encadre>

        {gestes.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {gestes.map((g) => (
              <button key={g.cle} className={`inv-btn inv-btn-sm${geste?.cle === g.cle ? " inv-btn-blue" : ""}`} onClick={() => ouvrirGeste(g)} disabled={enCours}>{g.libelle}</button>
            ))}
          </div>
        )}

        {geste && (
          <Encadre T={T} titre={geste.libelle}>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {geste.cle === "confirmer_reprise" && (
                <div style={{ fontSize: 12 }}>Je confirme que le statut « {STATUTS_ETAPE[etape.statut]} »{etape.balle ? ` et la balle « ${libelleBalle(etape, utilisateurs)} »` : ""} de cette étape sont justes. Seul ce geste retire la mention « à confirmer ».</div>
              )}
              {champBalle && (
                <>
                  <select className="inv-sel" value={saisie.balle} onChange={(e) => maj("balle", e.target.value)} aria-label="Qui a la balle">
                    {Object.entries(BALLES).map(([k, v]) => <option key={k} value={k}>Balle : {v}</option>)}
                  </select>
                  {BALLES_AVEC_COLLABORATEUR.includes(saisie.balle) && (
                    <select className="inv-sel" value={saisie.balle_utilisateur_id || ""} onChange={(e) => maj("balle_utilisateur_id", e.target.value)}>
                      <option value="">Collaborateur : non précisé</option>
                      {utilisateurs.filter((u) => u.actif || u.id === saisie.balle_utilisateur_id).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}
                    </select>
                  )}
                  {BALLES_AVEC_TIERS.includes(saisie.balle) && (
                    <input className="inv-inp" value={saisie.balle_tiers_libelle} onChange={(e) => maj("balle_tiers_libelle", e.target.value)} placeholder="Nom (banque, étude, interlocuteur…)" />
                  )}
                </>
              )}
              {geste.cle === "prochaine_action" && (
                <>
                  <input className="inv-inp" value={saisie.prochaine_action} onChange={(e) => maj("prochaine_action", e.target.value)} placeholder="Prochaine action (vide = aucune)" />
                  {taches.ouvertes.length > 0 && (
                    <select className="inv-sel" value={saisie.prochaine_action_id} onChange={(e) => {
                      const t = taches.ouvertes.find((x) => x.id === e.target.value);
                      setSaisie((p) => ({ ...p, prochaine_action_id: e.target.value, prochaine_action: t ? t.action_title : p.prochaine_action }));
                    }}>
                      <option value="">Lier à une tâche de l'étape : aucune</option>
                      {taches.ouvertes.map((t) => <option key={t.id} value={t.id}>{t.action_title}</option>)}
                    </select>
                  )}
                </>
              )}
              {geste.cle === "echeance" && (
                <input className="inv-inp" type="date" value={saisie.echeance} onChange={(e) => maj("echeance", e.target.value)} aria-label="Échéance (vide = aucune)" />
              )}
              {champMotif && (
                <textarea className="inv-textarea" rows={2} value={saisie.motif} onChange={(e) => maj("motif", e.target.value)} placeholder={libelleMotif} aria-label={libelleMotif} />
              )}
              {geste.cle === "terminer" && taches.ouvertes.length > 0 && (
                <div style={{ fontSize: 12, border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{taches.ouvertes.length} tâche(s) encore ouverte(s) dans cette étape :</div>
                  <ul style={{ margin: "0 0 6px 16px", padding: 0 }}>{taches.ouvertes.slice(0, 8).map((t) => <li key={t.id}>{t.action_title}</li>)}</ul>
                  <label style={{ display: "block" }}><input type="radio" checked={tachesAFermer === "laisser"} onChange={() => setTachesAFermer("laisser")} /> Les laisser ouvertes</label>
                  <label style={{ display: "block" }}><input type="radio" checked={tachesAFermer === "non_concerne"} onChange={() => setTachesAFermer("non_concerne")} /> Les passer « non concerné » (aucune suppression)</label>
                </div>
              )}
              {erreurs.length > 0 && <div style={{ fontSize: 12, color: "#be123c" }}>{erreurs.join(" ")}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={valider} disabled={enCours}>Enregistrer</button>
                <button className="inv-btn inv-btn-sm" onClick={() => setGeste(null)} disabled={enCours}>Annuler</button>
              </div>
            </div>
          </Encadre>
        )}

        <Encadre T={T} titre={`Tâches de l'étape (${taches.ouvertes.length} ouverte${taches.ouvertes.length > 1 ? "s" : ""})`}>
          {taches.ouvertes.length + taches.faites.length + taches.autres.length === 0 && <div style={{ fontSize: 12, color: T.textMuted }}>Aucune tâche rangée dans cette étape.</div>}
          {[["ouvertes", "À faire"], ["faites", "Faites"], ["autres", "Autres (non concerné…)"]].map(([k, titre]) => taches[k].length > 0 && (
            <div key={k} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: T.textMuted, fontWeight: 800 }}>{titre}</div>
              {taches[k].map((t) => (
                <div key={t.id} style={{ fontSize: 12, display: "flex", gap: 6, justifyContent: "space-between" }}>
                  <span>{t.action_title}</span>
                  <span style={{ color: T.textMuted, whiteSpace: "nowrap" }}>{t.responsable || "—"}{t.due_date ? ` · ${dateFr(t.due_date)}` : ""}</span>
                </div>
              ))}
            </div>
          ))}
        </Encadre>

        <Journal T={T} lignes={lignes} titre="Journal de l'étape" max={20} />
      </div>
    </div>
  );
}

