// src/Renovation/BilanPeriode.jsx — page Équipe → Bilan (refonte, étape 3).
//
// Le Bilan d'une PÉRIODE (semaine par défaut, mois, ou dates libres), calculé
// sur les relevés journaliers : du dernier jour travaillé avant la période au
// dernier jour travaillé de la période. Toute la logique est dans des modules
// purs (bilanPeriodeV3.mjs, bilanPdfV3.mjs) ; cette page charge les données,
// garde les choix du conducteur et lance l'export.
//
// L'ancien Bilan semaine (détail des comptes rendus, brouillon d'e-mail) reste
// accessible dans l'onglet « Détail des comptes rendus ».
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { lireToutParTranches } from "./lectureParTranches";
import { getCurrentWeek, getWeekId } from "../constants";
import { useReglagesMarges } from "./reglagesMarges";
import { alertesMargesV2 } from "./alertesMargesV2.js";
import { COLONNES_RELEVES_ALERTES_V2 } from "./pointsAttentionDonneesV1.js";
import {
  periodeSemaineV3, periodeMoisV3, periodeLibreV3, bornesComparaisonV3, ajouterJoursV3, semaineIsoV3,
  indexerRelevesV3, releveAuPlusTardV3, syntheseChantiersV3, bandeauV3, activiteChantiersV3,
  preselectionChantiersV3, ligneSansActiviteV3, avertissementsExportV3, LEGENDE_PASTILLES_V3,
  COULEURS_PASTILLES_V3, fmtJourV3,
} from "./bilanPeriodeV3.js";
import { documentBilanV3 } from "./bilanPdfV3.js";
import { ficheChantierV3, matiereComptesRendusV3, methodeBilanV3, tachesParLotV3 } from "./bilanFicheV3.js";
import PageBilanSemaine from "./BilanSemaine";
import { rappelBlocagesV3, suggestionsDecisionsV3, tendancesParLotV3, semaineQuiVientV3, commandesSemaineQuiVientV3 } from "./bilanDecisionsV3.js";
import { chargerTousLesMateriaux } from "./chargerMateriaux";
import { finPrevisionnelleParChantierV1 } from "./planningFinPrevisionnelleV1.mjs";
import { simulerPlanningGlobalV1 } from "./planningEngineDataV1.js";
import { bilanClotureV3 } from "./bilanClotureV3.js";
import { ligneArchiveV3, rectificationsV3, prevuRealiseV3, derniersExportsParPeriodeV3, finsPrevuesV3 } from "./bilanArchiveV3.js";
import { bilanSemaineProchaineV1, fenetreSemaineProchaineV1 } from "./bilanSemaineProchaineV1.mjs";

const ACCENT = "#FFC200";
const CHANTIERS_EXCLUS = ["DÉPOT"];
const COLONNES_LEGERES = "chantier_id, chantier_nom, date_releve, avancement, vendu_ht, heures_vendues, heures_reelles, "
  + "production_cumulee, marge_avancement, marge_terminaison, marge_probable, budget_restant, materiaux_en_avance, "
  + "heures_sans_lot, pct_sans_lot, chantier_repris, statut_completude, cr_manquants";
const COLONNES_COMPLETES = `${COLONNES_RELEVES_ALERTES_V2}, materiaux_en_avance, materiaux_imputes, mat_reel, mat_prev, mo_reel, fg, reste_a_commander, couts_par_nature, cr_manquants`;

const fmtEur = v => (v == null ? "—" : `${Math.round(v).toLocaleString("fr-FR")} €`);
const fmtEurSigne = v => (v == null ? "—" : `${v > 0.5 ? "+" : v < -0.5 ? "−" : ""}${Math.round(Math.abs(v)).toLocaleString("fr-FR")} €`);
const fmtH = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} h`);
const fmtPct = v => (v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString("fr-FR")} %`);
const couleurSigne = (v, T) => (v == null ? T.textMuted : v < -0.5 ? "#e15a5a" : v > 0.5 ? "#22c55e" : T.text);
const moisCourant = () => new Date().toISOString().slice(0, 7);

function decalerSemaine(weekId, delta) {
  const p = periodeSemaineV3(weekId);
  return p ? semaineIsoV3(ajouterJoursV3(p.debut, 7 * delta)) : weekId;
}
function decalerMois(mois, delta) {
  const [a, m] = mois.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function semainesCouvrant(debut, fin) {
  const out = new Set();
  for (let d = debut; d <= fin; d = ajouterJoursV3(d, 1)) out.add(semaineIsoV3(d));
  return [...out];
}

// ── Chargement des données d'une période ────────────────────────────────────
function useDonneesPeriode(periode) {
  const [etat, setEtat] = useState({ charge: false });
  useEffect(() => {
    if (!periode) return undefined;
    let annule = false;
    setEtat({ charge: false });
    (async () => {
      const avant = ajouterJoursV3(periode.debut, -21);
      const semainesDecisions = semainesCouvrant(ajouterJoursV3(periode.fin, -34), periode.fin);
      const [rel, pts, rap, jou, cmd, bh, rapDec] = await Promise.all([
        lireToutParTranches((a, b) => supabase.from("chantier_releves_journaliers").select(COLONNES_LEGERES)
          .lte("date_releve", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("pointages").select("chantier_id, date, heures, ouvrier")
          .gte("date", avant).lte("date", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("rapports").select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, semaine")
          .in("semaine", semainesCouvrant(periode.debut, periode.fin)).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("avancement_journal").select("chantier_id, tache_id, ouvrage_id, source, avancement_avant, avancement_apres, date_realisation, created_at")
          .gte("date_realisation", periode.debut).lte("date_realisation", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("commande_lignes").select("chantier_id, commandes!inner(date_doc)")
          .gte("commandes.date_doc", periode.debut).lte("commandes.date_doc", periode.fin).order("id").range(a, b)),
        supabase.from("bilans_hebdo").select("week_id, data").gte("week_id", semaineIsoV3(ajouterJoursV3(periode.debut, -35))).lt("week_id", semaineIsoV3(periode.debut)),
        lireToutParTranches((a, b) => supabase.from("rapports").select("id, ouvrier, chantier_id, date_rapport, semaine, taches, remarque")
          .in("semaine", semainesDecisions).order("id").range(a, b)),
      ]);
      // Bilans déjà exportés (8 semaines) et saisies faites après leur export.
      const arch = await supabase.from("bilans_exports")
        .select("periode_cle, periode_libelle, periode_debut, periode_fin, date_depart, date_fin, chiffres, exporte_le")
        .gte("periode_fin", ajouterJoursV3(periode.debut, -60)).lt("periode_fin", periode.debut);
      const archives = arch.error ? [] : (arch.data || []);
      let tardifs = { pointages: [], journal: [], commandes: [] };
      if (archives.length) {
        const dmin = archives.map(a => a.date_depart).sort()[0], dmax = archives.map(a => a.date_fin).sort().pop();
        const emin = archives.map(a => a.exporte_le).sort()[0];
        const [tp, tj, tc] = await Promise.all([
          lireToutParTranches((a, b) => supabase.from("pointages").select("chantier_id, date, created_at")
            .gt("date", dmin).lte("date", dmax).gt("created_at", emin).order("id").range(a, b)),
          lireToutParTranches((a, b) => supabase.from("avancement_journal").select("chantier_id, date_realisation, created_at, source")
            .gt("date_realisation", dmin).lte("date_realisation", dmax).gt("created_at", emin).order("id").range(a, b)),
          lireToutParTranches((a, b) => supabase.from("commande_lignes").select("chantier_id, created_at, commandes!inner(date_doc)")
            .gt("commandes.date_doc", dmin).lte("commandes.date_doc", dmax).gt("created_at", emin).order("id").range(a, b)),
        ]);
        tardifs = { pointages: tp.data || [], journal: tj.data || [],
          commandes: (tc.data || []).map(l => ({ chantier_id: l.chantier_id, created_at: l.created_at, date: l.commandes?.date_doc })) };
      }
      const erreur = [rel, pts, rap, jou, cmd].map(r => r.error?.message).filter(Boolean)[0] || null;
      if (erreur) console.warn("Bilan période :", erreur);
      if (annule) return;
      const joursTravailles = (pts.data || []).filter(p => Number(p.heures) > 0).map(p => p.date);
      const bornes = bornesComparaisonV3(periode, joursTravailles);
      // Relevés complets (lots, avertissements) des deux jours comparés.
      const idx = indexerRelevesV3(rel.data || []);
      const besoins = new Map();
      idx.forEach((liste, id) => {
        for (const d of [bornes.dateFin, bornes.dateDepart]) {
          const r = releveAuPlusTardV3(liste, d);
          if (!r) continue;
          const date = String(r.date_releve).slice(0, 10);
          if (!besoins.has(date)) besoins.set(date, new Set());
          besoins.get(date).add(id);
        }
      });
      const complets = (await Promise.all([...besoins.entries()].map(([date, ids]) =>
        supabase.from("chantier_releves_journaliers").select(COLONNES_COMPLETES)
          .eq("date_releve", date).in("chantier_id", [...ids]).then(r => r.data || [])))).flat();
      if (annule) return;
      const cle = r => `${r.chantier_id}|${String(r.date_releve).slice(0, 10)}`;
      const parCle = new Map(complets.map(r => [cle(r), r]));
      const releves = (rel.data || []).map(r => parCle.get(cle(r)) || r);
      setEtat({
        charge: true, erreur, bornes, releves,
        pointages: pts.data || [], rapports: rap.data || [], journal: jou.data || [],
        commandes: (cmd.data || []).map(l => ({ chantier_id: l.chantier_id, date: l.commandes?.date_doc })),
        bilansHebdo: bh.data || [], rapportsDecisions: rapDec.data || [],
        archives, archiveErreur: arch.error ? "L'archive des bilans exportés n'est pas disponible : rectifications et prévu / réalisé non calculés." : null, tardifs,
      });
    })();
    return () => { annule = true; };
  }, [periode?.cle]); // eslint-disable-line react-hooks/exhaustive-deps
  return etat;
}

// ── Données de la version détaillée (chargées seulement si elle est demandée)
function useDonneesDetaillees(periode, actif, ids) {
  const [etat, setEtat] = useState({ charge: false });
  const cleIds = ids.join(",");
  useEffect(() => {
    if (!actif || !periode || !ids.length) { setEtat({ charge: false }); return undefined; }
    let annule = false;
    setEtat({ charge: false });
    (async () => {
      const [ph, rap] = await Promise.all([
        supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", ids),
        lireToutParTranches((a, b) => supabase.from("rapports").select("id, ouvrier, chantier_id, date_rapport, statut, taches, remarque, photos_chantier")
          .in("semaine", semainesCouvrant(periode.debut, periode.fin)).in("chantier_id", ids).order("id").range(a, b)),
      ]);
      if (annule) return;
      if (ph.error || rap.error) console.warn("Bilan détaillé :", ph.error?.message || rap.error?.message);
      const ouvragesPar = {};
      (ph.data || []).forEach(r => { ouvragesPar[r.chantier_id] = [...(ouvragesPar[r.chantier_id] || []), ...(r.ouvrages || [])]; });
      setEtat({ charge: true, erreur: !!(ph.error || rap.error), ouvragesPar, rapports: rap.data || [] });
    })();
    return () => { annule = true; };
  }, [actif, periode?.cle, cleIds]); // eslint-disable-line react-hooks/exhaustive-deps
  return etat;
}

async function proposerSynthese({ nom, periode, synthese, taches, commentaires }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expirée");
  const entree = {
    chantier: String(nom).slice(0, 120), periode: String(periode.libelle).slice(0, 120),
    faits: { avancement_debut: synthese.avancementDepart, avancement_fin: synthese.avancement, production_eur: synthese.production,
      heures: synthese.heuresPeriode, taches: taches.map(t => `${t.lot} : ${t.resume}`) },
    comptes_rendus: commentaires.slice(0, 80).map(c => ({ texte: String(c.texte).slice(0, 600) })),
  };
  const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ tache: "bilan_synthese", entree, contexte: { branche: "renovation", entite_type: "bilan_periode", entite_id: `${periode.cle}:${synthese.chantierId}` } }) });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.erreur?.message || "Proposition indisponible");
  return data.resultat.phrase;
}

// ── La semaine qui vient : moteur de planning lancé par défaut ──────────────
function useSemaineQuiVient(periode) {
  const [etat, setEtat] = useState({ decoupe: null, referentiel: null, erreur: null, fins: null });
  useEffect(() => {
    if (!periode) return undefined;
    let annule = false;
    setEtat({ decoupe: null, referentiel: null, erreur: null, fins: null });
    const fenetre = fenetreSemaineProchaineV1(semaineIsoV3(periode.fin));
    simulerPlanningGlobalV1({ startDate: fenetre.debut, horizonDays: 42 })
      .then(out => { if (!annule) setEtat({ decoupe: bilanSemaineProchaineV1({ resultatMoteur: out, fenetre }), referentiel: out?.referentiel || null, erreur: null,
        // Fin prévisionnelle par chantier (même module que la semaine qui vient).
        fins: new Map(finPrevisionnelleParChantierV1(out).chantiers.map(c => [c.chantier_id, c])) }); })
      .catch(e => { if (!annule) setEtat({ decoupe: null, referentiel: null, erreur: e?.message || "erreur du moteur de planning", fins: null }); });
    return () => { annule = true; };
  }, [periode?.cle]); // eslint-disable-line react-hooks/exhaustive-deps
  return etat;
}

// ── Commandes de la semaine qui vient : mêmes données que « Commandes à
// passer » (phasages, lignes de commande, matériaux de la bibliothèque).
function useCommandesSemaineQuiVient(fenetre) {
  const [etat, setEtat] = useState({ commandes: null, erreur: null });
  useEffect(() => {
    if (!fenetre?.fin) return undefined;
    let annule = false;
    setEtat({ commandes: null, erreur: null });
    (async () => {
      const [ph, lignes, mats] = await Promise.all([
        supabase.from("phasages").select("chantier_id, ouvrages"),
        lireToutParTranches((a, b) => supabase.from("commande_lignes").select("chantier_id, ouvrage_id, materiau_id").order("id").range(a, b)),
        chargerTousLesMateriaux("id"),
      ]);
      if (annule) return;
      const e0 = [ph.error, lignes.error, mats.error].find(Boolean);
      const erreur = e0 ? (typeof e0 === "string" ? e0 : e0.message || "lecture impossible") : null;
      if (erreur) { setEtat({ commandes: null, erreur }); return; }
      const connus = new Set((mats.data || []).map(m => String(m.id)));
      setEtat({ commandes: commandesSemaineQuiVientV3({ phasages: ph.data || [], lignesCmd: lignes.data || [], fenetre,
        estConnu: id => connus.has(String(id)) }), erreur: null });
    })();
    return () => { annule = true; };
  }, [fenetre?.debut, fenetre?.fin]); // eslint-disable-line react-hooks/exhaustive-deps
  return etat;
}

// ── Bilan de clôture d'un chantier (chargé à la demande) ────────────────────
function PanneauCloture({ chantierId, releveFin, T }) {
  const [etat, setEtat] = useState({ charge: false });
  useEffect(() => {
    let annule = false;
    (async () => {
      const [ph, pts] = await Promise.all([
        supabase.from("phasages").select("ouvrages").eq("chantier_id", chantierId),
        lireToutParTranches((a, b) => supabase.from("pointages").select("tache_id, heures").eq("chantier_id", chantierId).order("id").range(a, b)),
      ]);
      if (annule) return;
      const ouvrages = (ph.data || []).flatMap(r => r.ouvrages || []);
      setEtat({ charge: true, erreur: ph.error || pts.error, bilan: bilanClotureV3({ releveFin, ouvrages, pointages: pts.data || [] }) });
    })();
    return () => { annule = true; };
  }, [chantierId, releveFin]);
  if (!etat.charge) return <div style={{ color: T.textMuted, fontSize: 13 }}>Chargement du bilan de clôture…</div>;
  if (etat.erreur) return <div style={{ color: "#e15a5a", fontSize: 13 }}>Le phasage ou les pointages n'ont pas pu être chargés.</div>;
  const b = etat.bilan;
  if (!b.applicable) return <div style={{ color: T.textMuted, fontSize: 13 }}>{b.raison}</div>;
  const cell = { padding: "3px 6px", borderTop: `1px solid ${T.border}` };
  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ marginBottom: 6 }}>
        Vendu {fmtEur(b.totaux.vendu)} · main-d'œuvre {fmtEur(b.totaux.mainOeuvre)} · matériaux {fmtEur(b.totaux.materiaux)} (prévu {fmtEur(b.totaux.materiauxPrevus)})
        · frais généraux {fmtEur(b.totaux.fraisGeneraux)} · <strong>marge finale {fmtEurSigne(b.totaux.margeFinale)}{b.totaux.margeFinalePct != null ? ` (${fmtPct(b.totaux.margeFinalePct)})` : ""}</strong>
        · heures {fmtH(b.totaux.heuresReelles)} réelles / {fmtH(b.totaux.heuresPrevues)} prévues
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ color: T.textMuted, fontSize: 11, textAlign: "right" }}><th style={{ textAlign: "left" }}>Lot / ouvrage</th><th>Prévu</th><th>Réel</th><th>Écart</th><th>Cadence prévue → constatée</th></tr></thead>
        <tbody>
          {b.lots.map(l => (
            <React.Fragment key={l.id}>
              <tr style={{ textAlign: "right", fontWeight: 700 }}>
                <td style={{ ...cell, textAlign: "left" }}>{l.label}</td><td style={cell}>{fmtH(l.heuresPrevues)}</td><td style={cell}>{fmtH(l.heuresReelles)}</td>
                <td style={cell}>{l.ecartHeures == null ? "—" : `${fmtH(l.ecartHeures)} · ${fmtEurSigne(l.ecartEuros)}`}</td><td style={cell}/>
              </tr>
              {b.ouvrages.filter(o => o.lot === l.label).map(o => (
                <tr key={o.id} style={{ textAlign: "right", color: T.textSub }}>
                  <td style={{ ...cell, textAlign: "left", paddingLeft: 18 }}>{o.libelle}</td><td style={cell}>{fmtH(o.heuresPrevues)}</td><td style={cell}>{fmtH(o.heuresReelles)}</td>
                  <td style={cell}>{o.ecartHeures == null ? "—" : fmtH(o.ecartHeures)}</td>
                  <td style={cell}>{o.cadencePrevue == null ? "—" : `${o.cadencePrevue} → ${o.cadenceConstatee ?? "—"} h/${o.unite || "u"}`}</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontWeight: 700 }}>Proposition de mise à jour des cadences de la bibliothèque</div>
      {b.propositions.length === 0 ? <div style={{ color: T.textMuted }}>Aucune cadence ne s'écarte de plus de 15 % de la bibliothèque.</div>
        : b.propositions.map(x => (
          <div key={x.bibliothequeId + x.libelle}>{x.libelle} : {x.cadencePrevue} → <strong>{x.cadenceProposee} h/{x.unite || "u"}</strong> ({x.ecartPct > 0 ? "+" : ""}{fmtPct(x.ecartPct)})</div>
        ))}
      <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Rien n'est modifié automatiquement : les cadences se corrigent dans la Bibliothèque, puis « Appliquer à tous les chantiers ».</div>
    </div>
  );
}

// ── Génération du PDF (html2pdf, chargé à la demande) ───────────────────────
async function telechargerPdf(html, nomFichier) {
  const conteneur = document.createElement("div");
  Object.assign(conteneur.style, { position: "absolute", left: "-99999px", top: "0", width: "794px", background: "#fff" });
  conteneur.innerHTML = html;
  document.body.appendChild(conteneur);
  try {
    const html2pdf = (await import("html2pdf.js")).default;
    const opts = {
      margin: [12, 10, 14, 10], filename: nomFichier, image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", windowWidth: 794 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], avoid: ["tr", "li", ".kpi", ".fiche h2"] },
    };
    const worker = html2pdf().set(opts).from(conteneur.querySelector(".page") || conteneur);
    const blob = await worker.outputPdf("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = nomFichier; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return blob;
  } finally {
    document.body.removeChild(conteneur);
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PageBilanPeriode({ chantiers = [], T, branch = "renovation" }) {
  const [onglet, setOnglet] = useState("bilan");
  const [typePeriode, setTypePeriode] = useState("semaine");
  const [semaine, setSemaine] = useState(() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); });
  const [mois, setMois] = useState(moisCourant);
  const [libre, setLibre] = useState({ debut: "", fin: "" });
  const periode = useMemo(() => (
    typePeriode === "semaine" ? periodeSemaineV3(semaine)
      : typePeriode === "mois" ? periodeMoisV3(mois)
        : periodeLibreV3(libre.debut, libre.fin)
  ), [typePeriode, semaine, mois, libre.debut, libre.fin]);

  const reglages = useReglagesMarges();
  const donnees = useDonneesPeriode(periode);
  const semProchaine = useSemaineQuiVient(periode);
  const cmdProchaine = useCommandesSemaineQuiVient(semProchaine.decoupe?.fenetre || null);
  const [clotureOuverte, setClotureOuverte] = useState(null);
  const [decisionsChoix, setDecisionsChoix] = useState({ cle: null, valeurs: {} });
  const decisionsPeriode = decisionsChoix.cle === periode?.cle ? decisionsChoix.valeurs : {};
  const choisirDecision = (id, valeur) => setDecisionsChoix(c => ({ cle: periode.cle, valeurs: { ...(c.cle === periode.cle ? c.valeurs : {}), [id]: valeur } }));

  // Choix manuels de la case « exporter », conservés tant qu'on reste sur la
  // même période ; oubliés quand on en change (la présélection se refait).
  const [choix, setChoix] = useState({ cle: null, valeurs: {} });
  const choixPeriode = useMemo(() => (choix.cle === periode?.cle ? choix.valeurs : {}), [choix, periode?.cle]);
  const basculer = (id, valeur) => setChoix(c => ({ cle: periode.cle, valeurs: { ...(c.cle === periode.cle ? c.valeurs : {}), [id]: valeur } }));

  const enCours = useMemo(() => (chantiers || [])
    .filter(c => c && c.id && !CHANTIERS_EXCLUS.includes(c.nom) && c.statut !== "termine")
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr")), [chantiers]);

  const calcul = useMemo(() => {
    if (!donnees.charge || !periode) return null;
    const { bornes, releves, pointages, rapports, journal, commandes } = donnees;
    const activite = activiteChantiersV3({ periode, pointages, rapports, journal, commandes });
    const preselection = preselectionChantiersV3({ chantiers: enCours, activite, choix: choixPeriode });
    const retenus = preselection.filter(p => p.coche).map(p => ({ id: p.chantierId, nom: p.nom }));
    const idx = indexerRelevesV3(releves);
    const pick = d => retenus.map(c => releveAuPlusTardV3(idx.get(c.id), d)).filter(Boolean);
    const alertes = alertesMargesV2({ snapshotsCourants: pick(bornes.dateFin), snapshotsPrecedents: pick(bornes.dateDepart), seuils: reglages.seuilsMarges });
    const alertesParChantier = Object.fromEntries(alertes.lignes.map(l => [l.chantier_id, l.alertes.map(a => ({ ...a, motif: a.motif }))]));
    const synthese = syntheseChantiersV3({ releves: idx, chantiers: retenus, bornes, periode, alertesParChantier,
      seuilBaisse: reglages.seuilsMarges?.alerteBaisseMargeProbableEuros ?? 500 });
    const noms = Object.fromEntries(enCours.map(c => [c.id, c.nom]));
    const avertissements = avertissementsExportV3({ periode, chantierIds: retenus.map(c => c.id), rapports, relevesLignes: releves, noms });
    const bandeau = bandeauV3({ synthese, nbComptesRendusNonValides: avertissements.nbNonValides });
    const tousNoms = Object.fromEntries((chantiers || []).map(c => [c.id, c.nom]));
    const rappel = rappelBlocagesV3({ bilansHebdo: donnees.bilansHebdo, periode, noms: tousNoms });
    const suggestions = suggestionsDecisionsV3({ rapports: donnees.rapportsDecisions.filter(r => retenus.some(c => c.id === r.chantier_id)), periode, noms: tousNoms });
    const statuts = Object.fromEntries((chantiers || []).map(c => [c.id, c.statut]));
    const relevesFinTous = [...idx.values()].map(l => releveAuPlusTardV3(l, bornes.dateFin)).filter(Boolean)
      .filter(r => !CHANTIERS_EXCLUS.includes(r.chantier_nom));
    const tendances = tendancesParLotV3({ releves: relevesFinTous, statuts, exclus: reglages.derivesDetail?.exclusReprise || [] });
    const rectifications = rectificationsV3({ archives: donnees.archives, releves: idx, periode, ...donnees.tardifs })
      .filter(r => retenus.some(c => c.id === r.chantierId));
    const prevuRealise = prevuRealiseV3({ archives: donnees.archives, periode, synthese });
    return { activite, preselection, synthese, alertes, avertissements, bandeau, ligneSansActivite: ligneSansActiviteV3(preselection),
      rappel, suggestions, tendances, rectifications, prevuRealise };
  }, [donnees, periode, enCours, choixPeriode, reglages.seuilsMarges, reglages.derivesDetail, chantiers]);
  const semaineQuiVient = useMemo(() => {
    const ref = semProchaine.referentiel;
    const nomChantier = id => (chantiers || []).find(c => c.id === id)?.nom || (ref?.chantiers || []).find(c => c.id === id)?.nom || id;
    const nomRessource = id => { const r = (ref?.ressources || []).find(x => x.id === id); return r?.nom_planning || r?.nom || id; };
    return semaineQuiVientV3({ decoupe: semProchaine.decoupe, erreur: semProchaine.erreur, nomChantier, nomRessource,
      commandes: cmdProchaine.commandes, erreurCommandes: cmdProchaine.erreur });
  }, [semProchaine, cmdProchaine, chantiers]);
  const finsPrevues = useMemo(() => (calcul
    ? (semProchaine.erreur ? { disponible: false, raison: `fin prévisionnelle indisponible : ${semProchaine.erreur}`, lignes: [] }
      : finsPrevuesV3({ archives: donnees.archives, periode, synthese: calcul.synthese, fins: semProchaine.fins }))
    : null), [calcul, semProchaine, donnees, periode]);
  const decisionsRetenues = calcul ? [
    ...calcul.rappel.map(b => ({ titre: `${b.nom} (rappel ${b.semaine.replace(/^\d{4}-W/, "S")})`, detail: b.texte })),
    ...calcul.suggestions.filter(x => decisionsPeriode[x.id] === true).map(x => ({ titre: x.titre, detail: x.detail })),
  ] : [];

  // ── Version détaillée : préparation par le conducteur (par période) ──
  const [detaillee, setDetaillee] = useState(false);
  const [prep, setPrep] = useState({ cle: null, syntheses: {}, photos: {}, commentaires: {}, ia: {} });
  const prepPeriode = prep.cle === periode?.cle ? prep : { cle: periode?.cle, syntheses: {}, photos: {}, commentaires: {}, ia: {} };
  const majPrep = (champ, id, valeur) => setPrep(pr => {
    const base = pr.cle === periode.cle ? pr : { cle: periode.cle, syntheses: {}, photos: {}, commentaires: {}, ia: {} };
    return { ...base, [champ]: { ...base[champ], [id]: valeur } };
  });
  const idsRetenus = useMemo(() => (calcul ? calcul.synthese.map(s => s.chantierId) : []), [calcul]);
  const det = useDonneesDetaillees(periode, detaillee, idsRetenus);
  const preparation = useMemo(() => {
    if (!detaillee || !det.charge || !calcul) return null;
    const out = {};
    for (const s of calcul.synthese) {
      const matiere = matiereComptesRendusV3({ rapports: det.rapports, chantierId: s.chantierId, debut: periode.debut, fin: periode.fin });
      const lotsLabels = Object.fromEntries((s.lots || []).map(l => [l.id, l.label]));
      const taches = tachesParLotV3({ ouvrages: det.ouvragesPar[s.chantierId] || [],
        journal: donnees.journal.filter(j => j.chantier_id === s.chantierId), dateDepart: donnees.bornes.dateDepart, dateFin: donnees.bornes.dateFin, lotsLabels });
      out[s.chantierId] = { ...matiere, taches };
    }
    return out;
  }, [detaillee, det, calcul, periode, donnees]);
  const proposer = async (s) => {
    majPrep("ia", s.chantierId, { enCours: true });
    try {
      const phrase = await proposerSynthese({ nom: s.nom, periode, synthese: s, taches: preparation[s.chantierId].taches, commentaires: preparation[s.chantierId].commentaires });
      majPrep("syntheses", s.chantierId, phrase);
      majPrep("ia", s.chantierId, { enCours: false, message: "Proposition de l'IA : relisez-la et corrigez-la si besoin, c'est votre texte qui part dans le PDF." });
    } catch (e) {
      majPrep("ia", s.chantierId, { enCours: false, message: `Proposition indisponible (${e.message}). Vous pouvez écrire la synthèse vous-même.` });
    }
  };

  const [export_, setExport] = useState({ enCours: false, message: null });
  const donneesExport = () => ({
    periode, bornes: donnees.bornes, bandeau: calcul.bandeau, synthese: calcul.synthese,
    ligneSansActivite: calcul.ligneSansActivite, avertissements: calcul.avertissements,
    alertes: calcul.alertes.releveDisponible ? calcul.alertes.lignes : null,
    decisions: decisionsRetenues,
    tendances: calcul.tendances,
    semaineQuiVient,
    rectifications: calcul.rectifications,
    prevuRealise: calcul.prevuRealise,
    finsPrevues: finsPrevues || undefined,
    genereLe: new Date().toLocaleDateString("fr-FR"),
    ...(detaillee && preparation ? {
      fiches: calcul.synthese.map(s => {
        const idx = indexerRelevesV3(donnees.releves);
        const coches = prepPeriode.commentaires[s.chantierId] || [];
        return ficheChantierV3({ synthese: s, releveFin: releveAuPlusTardV3(idx.get(s.chantierId), donnees.bornes.dateFin),
          ouvrages: det.ouvragesPar[s.chantierId] || [], journal: donnees.journal.filter(j => j.chantier_id === s.chantierId),
          pointages: donnees.pointages, periode, bornes: donnees.bornes,
          photosChoisies: prepPeriode.photos[s.chantierId] || [],
          commentairesCoches: preparation[s.chantierId].commentaires.filter(c => coches.includes(c.id)),
          syntheseRelue: prepPeriode.syntheses[s.chantierId] || "",
          seuilSansLotPct: reglages.seuilsMarges?.alerteSansLotPct ?? 10 });
      }),
      methode: methodeBilanV3(),
    } : {}),
  });
  const exporter = async () => {
    if (!calcul) return;
    setExport({ enCours: true, message: null });
    try {
      if (detaillee && !preparation) { setExport({ enCours: false, message: "Les données de la version détaillée sont encore en chargement." }); return; }
      const html = documentBilanV3(donneesExport(), { detaillee });
      await telechargerPdf(html, `Bilan-${detaillee ? "detaille-" : ""}${periode.cle.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`);
      // Archive : le bilan exporté est figé (chiffres + document).
      const { data: u } = await supabase.auth.getUser();
      const prevu = Object.fromEntries((semProchaine.decoupe?.par_chantier || []).map(c => [c.chantier_id, c.heures_mo]));
      const { error: errArch } = await supabase.from("bilans_exports").insert(ligneArchiveV3({ periode, bornes: donnees.bornes,
        synthese: calcul.synthese, version: detaillee ? "detaillee" : "direction", documentHtml: html, exportePar: u?.user?.email || null,
        prevuSemaineSuivante: prevu, finsPrevues: semProchaine.fins }));
      if (errArch) console.warn("Archive du bilan :", errArch.message);
      setExport({ enCours: false, message: errArch
        ? "PDF téléchargé, mais le bilan n'a pas pu être archivé : il ne servira pas de référence aux rectifications."
        : "PDF téléchargé et bilan archivé (figé)." });
    } catch (e) {
      console.error("Export du bilan :", e);
      setExport({ enCours: false, message: "Le PDF n'a pas pu être généré. Réessayez." });
    }
  };

  const carte = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 16, marginBottom: 14 };
  const btn = (actif) => ({ padding: "6px 12px", borderRadius: 8, border: `1px solid ${actif ? ACCENT : T.border}`,
    background: actif ? ACCENT : "transparent", color: actif ? "#111" : T.text, fontWeight: 600, fontSize: 13, cursor: "pointer" });

  if (onglet === "detail") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ padding: "12px 28px 0", background: T.bg, display: "flex", gap: 8 }}>
          <button style={btn(false)} onClick={() => setOnglet("bilan")}>Bilan de la période</button>
          <button style={btn(true)}>Détail des comptes rendus</button>
        </div>
        <PageBilanSemaine chantiers={chantiers} T={T} branch={branch}/>
      </div>
    );
  }

  return (
    <div className="page-padding" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", background: T.bg, color: T.text }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button style={btn(true)}>Bilan de la période</button>
        <button style={btn(false)} onClick={() => setOnglet("detail")}>Détail des comptes rendus</button>
      </div>

      {/* Période */}
      <div style={{ ...carte, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        {[["semaine", "Semaine"], ["mois", "Mois"], ["libre", "Dates libres"]].map(([k, l]) => (
          <button key={k} style={btn(typePeriode === k)} onClick={() => setTypePeriode(k)}>{l}</button>
        ))}
        <div style={{ width: 1, height: 24, background: T.border }}/>
        {typePeriode === "semaine" && (<>
          <button style={btn(false)} onClick={() => setSemaine(w => decalerSemaine(w, -1))}>‹</button>
          <strong>{periode?.libelle}</strong>
          <button style={btn(false)} onClick={() => setSemaine(w => decalerSemaine(w, 1))}>›</button>
        </>)}
        {typePeriode === "mois" && (<>
          <button style={btn(false)} onClick={() => setMois(m => decalerMois(m, -1))}>‹</button>
          <strong>{periode?.libelle}</strong>
          <button style={btn(false)} onClick={() => setMois(m => decalerMois(m, 1))}>›</button>
        </>)}
        {typePeriode === "libre" && (<>
          <label>Du <input type="date" value={libre.debut} onChange={e => setLibre(l => ({ ...l, debut: e.target.value }))}/></label>
          <label>au <input type="date" value={libre.fin} onChange={e => setLibre(l => ({ ...l, fin: e.target.value }))}/></label>
        </>)}
      </div>

      {!periode && <div style={carte}>Choisissez une date de début et une date de fin.</div>}
      {periode && !donnees.charge && <div style={carte}>Chargement des relevés de la période…</div>}
      {periode && donnees.charge && donnees.erreur && (
        <div style={{ ...carte, borderColor: "#e15a5a" }}>Une partie des données n'a pas pu être chargée : les chiffres peuvent être incomplets. Rechargez la page.</div>
      )}

      {calcul && (<>
        <div style={{ fontSize: 12, color: T.textSub, marginBottom: 10 }}>
          Comparaison du <strong>{fmtJourV3(donnees.bornes.dateDepart)}</strong> (dernier jour travaillé avant la période)
          au <strong>{fmtJourV3(donnees.bornes.dateFin)}</strong> (dernier jour travaillé de la période)
          {donnees.bornes.sansJourTravaille ? " — aucun jour travaillé sur la période" : ""}.
        </div>

        {calcul.avertissements.textes.length > 0 && (
          <div style={{ ...carte, borderColor: "#e15a5a", background: "rgba(225,90,90,0.08)" }}>
            {calcul.avertissements.textes.map((t, i) => <div key={i} style={{ color: "#e15a5a", fontSize: 13 }}>{t}</div>)}
          </div>
        )}

        {/* Bandeau */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            ["Production de la période", fmtEur(calcul.bandeau.production), T.text],
            ["Marge de la période", fmtEurSigne(calcul.bandeau.margePeriode), couleurSigne(calcul.bandeau.margePeriode, T)],
            ["Évolution de la marge probable", fmtEurSigne(calcul.bandeau.evolutionMargeProbable), couleurSigne(calcul.bandeau.evolutionMargeProbable, T)],
            ["Heures validées", fmtH(calcul.bandeau.heuresValidees), T.text],
            ["Comptes rendus non validés", String(calcul.bandeau.nbComptesRendusNonValides), calcul.bandeau.nbComptesRendusNonValides ? "#e15a5a" : T.text],
          ].map(([l, v, c]) => (
            <div key={l} style={{ ...carte, marginBottom: 0, padding: 12 }}>
              <div style={{ fontSize: 11, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Synthèse par chantier */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Synthèse par chantier</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: T.textMuted, fontSize: 11, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: 6 }}>Chantier</th><th>Avancement</th><th>Production</th><th>Marge période</th>
                <th>Marge à l'avancement</th><th>Marge à terminaison</th><th>Marge probable</th><th>€ produits / h</th>
              </tr></thead>
              <tbody>
                {calcul.synthese.map(s => (
                  <tr key={s.chantierId} style={{ borderTop: `1px solid ${T.border}`, textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: 6 }}>
                      <span title={s.pastille.raison} style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, marginRight: 6, background: COULEURS_PASTILLES_V3[s.pastille.couleur] }}/>
                      {s.nom}
                      {s.mentions.map(m => (
                        <span key={m.code} style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(255,194,0,0.15)", color: ACCENT }}>
                          {m.texte}{m.heuresApresReception > 0 ? ` · ${fmtH(m.heuresApresReception)} après réception` : ""}
                        </span>
                      ))}
                    </td>
                    {s.disponible ? (<>
                      <td>{fmtPct(s.avancement)}</td>
                      <td>{fmtEur(s.production)}</td>
                      <td style={{ color: couleurSigne(s.margePeriode, T) }}>{fmtEurSigne(s.margePeriode)}</td>
                      <td style={{ color: couleurSigne(s.margeAvancement, T) }}>{fmtEurSigne(s.margeAvancement)}</td>
                      <td style={{ color: couleurSigne(s.margeTerminaison, T) }}>{fmtEurSigne(s.margeTerminaison)}</td>
                      <td style={{ color: couleurSigne(s.margeProbable, T) }}>{fmtEurSigne(s.margeProbable)}
                        {s.evolutionMargeProbable != null && Math.abs(s.evolutionMargeProbable) >= 1 && <div style={{ fontSize: 10, color: T.textMuted }}>{fmtEurSigne(s.evolutionMargeProbable)} sur la période</div>}
                      </td>
                      <td>{s.eurParHeure == null ? "—" : `${fmtEur(s.eurParHeure)}/h`}</td>
                    </>) : <td colSpan={7} style={{ color: T.textMuted, textAlign: "left" }}>relevé pas encore disponible</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>
            {LEGENDE_PASTILLES_V3.map(l => (
              <span key={l.couleur} style={{ marginRight: 12 }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 4, background: COULEURS_PASTILLES_V3[l.couleur] }}/>{l.critere}
              </span>
            ))}
          </div>
        </div>

        {/* Alertes */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Alertes</div>
          {!calcul.alertes.releveDisponible ? <div style={{ color: T.textMuted }}>Relevé pas encore disponible.</div>
            : calcul.alertes.lignes.length === 0 ? <div style={{ color: T.textMuted }}>Aucune alerte sur la période.</div>
              : calcul.alertes.lignes.map(l => (
                <div key={l.chantier_id} style={{ padding: "6px 0", borderTop: `1px solid ${T.border}`, fontSize: 13 }}>
                  <strong>{l.nom}</strong>
                  <ul style={{ margin: "2px 0 0 18px", padding: 0 }}>{l.alertes.map((a, i) => <li key={i}>{a.texte}</li>)}</ul>
                </div>
              ))}
        </div>

        {/* Décisions attendues */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Décisions attendues</div>
          {calcul.rappel.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>Rappel des blocages des 4 dernières semaines</div>
              {calcul.rappel.map((b, i) => <div key={i} style={{ fontSize: 13 }}><strong>{b.nom}</strong> ({b.semaine}) : {b.texte}</div>)}
            </div>
          )}
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 2 }}>Propositions — retenez celles qui doivent figurer dans le bilan</div>
          {calcul.suggestions.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>Aucune proposition sur la période.</div>
            : calcul.suggestions.map(x => (
              <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderTop: `1px solid ${T.border}`, fontSize: 13 }}>
                <div style={{ flex: 1 }}><strong>{x.titre}</strong><div style={{ fontSize: 12, color: T.textSub }}>{x.detail}</div></div>
                <button style={btn(decisionsPeriode[x.id] === true)} onClick={() => choisirDecision(x.id, true)}>Retenir</button>
                <button style={btn(decisionsPeriode[x.id] === false)} onClick={() => choisirDecision(x.id, false)}>Écarter</button>
              </div>
            ))}
          <div style={{ fontSize: 12, color: T.textMuted, marginTop: 6 }}>Tâches hors devis à arbitrer : arrivent avec l'étape 4 du projet.</div>
        </div>

        {/* Tendances par lot */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Tendances par lot (tous chantiers)</div>
          {calcul.tendances.phrase && <div style={{ fontSize: 13, marginBottom: 6 }}>{calcul.tendances.phrase}</div>}
          {calcul.tendances.lignes.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>Pas assez de données.</div> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ color: T.textMuted, fontSize: 11, textAlign: "right" }}><th style={{ textAlign: "left" }}>Type de lot</th><th>Chantiers</th><th>Dérive moyenne</th><th>Écart (h)</th><th>Écart (€)</th></tr></thead>
              <tbody>{calcul.tendances.lignes.map(l => (
                <tr key={l.id} style={{ borderTop: `1px solid ${T.border}`, textAlign: "right" }}>
                  <td style={{ textAlign: "left", padding: 4 }}>{l.label}</td><td>{l.nbChantiers}</td><td>×{String(l.derive).replace(".", ",")}</td>
                  <td>{fmtH(l.ecartHeures)}</td><td style={{ color: couleurSigne(-l.ecartEuros, T) }}>{fmtEurSigne(l.ecartEuros)}</td>
                </tr>))}</tbody>
            </table>
          )}
          {calcul.tendances.reprisExclus.length > 0 && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Chantiers repris exclus : {calcul.tendances.reprisExclus.join(", ")}</div>}
        </div>

        {/* La semaine qui vient */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>La semaine qui vient{semaineQuiVient.fenetre ? ` (du ${fmtJourV3(semaineQuiVient.fenetre.debut)} au ${fmtJourV3(semaineQuiVient.fenetre.fin)})` : ""}</div>
          {semaineQuiVient.indisponible ? <div style={{ fontSize: 13, color: T.textMuted }}>{semaineQuiVient.indisponible}</div>
            : semaineQuiVient.lignes.map((l, i) => <div key={i} style={{ fontSize: 13, padding: "2px 0" }}><strong>{l.titre}</strong> : {l.detail}</div>)}
        </div>

        {/* Rectifications et prévu / réalisé */}
        <div style={carte}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Rectifications des bilans déjà exportés</div>
          {donnees.archiveErreur ? <div style={{ fontSize: 13, color: "#e15a5a" }}>{donnees.archiveErreur}</div>
            : calcul.rectifications.length === 0 ? <div style={{ fontSize: 13, color: T.textMuted }}>Aucune rectification.</div>
              : calcul.rectifications.map((r, i) => (
                <div key={i} style={{ fontSize: 13, padding: "2px 0" }}><strong>{r.nom}</strong> — {r.periode} : {fmtEurSigne(r.montant)} ({r.cause})</div>
              ))}
          <div style={{ fontWeight: 700, margin: "10px 0 6px" }}>Prévu / réalisé</div>
          {!calcul.prevuRealise.disponible ? <div style={{ fontSize: 13, color: T.textMuted }}>{calcul.prevuRealise.raison}</div>
            : calcul.prevuRealise.lignes.map(l => (
              <div key={l.chantierId} style={{ fontSize: 13 }}><strong>{l.nom}</strong> : prévu {fmtH(l.heuresPrevues)} · réalisé {fmtH(l.heuresRealisees)}</div>
            ))}
          <div style={{ fontWeight: 700, margin: "10px 0 6px" }}>Fin prévisionnelle</div>
          {!finsPrevues || !finsPrevues.disponible ? <div style={{ fontSize: 13, color: T.textMuted }}>{finsPrevues?.raison || "fin prévisionnelle : calcul en cours"}</div>
            : finsPrevues.lignes.map(l => (
              <div key={l.chantierId} style={{ fontSize: 13 }}><strong>{l.nom}</strong> : {l.texteFin} · {l.texteGlissement}</div>
            ))}
        </div>

        {/* Bilans de clôture */}
        {(() => {
          const idxC = indexerRelevesV3(donnees.releves);
          const finis = calcul.synthese.filter(x => x.avancement >= 100);
          if (!finis.length) return null;
          return (
            <div style={carte}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Bilans de clôture</div>
              {finis.map(x => (
                <div key={x.chantierId} style={{ borderTop: `1px solid ${T.border}`, padding: "6px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{x.nom}</strong>
                    {x.repris ? <span style={{ fontSize: 12, color: T.textMuted }}>chantier repris : pas de bilan de clôture</span>
                      : <button style={btn(clotureOuverte === x.chantierId)} onClick={() => setClotureOuverte(o => (o === x.chantierId ? null : x.chantierId))}>
                        {clotureOuverte === x.chantierId ? "Masquer" : "Voir le bilan de clôture"}</button>}
                  </div>
                  {clotureOuverte === x.chantierId && <PanneauCloture chantierId={x.chantierId} releveFin={releveAuPlusTardV3(idxC.get(x.chantierId), donnees.bornes.dateFin)} T={T}/>}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Sélection et export */}
        <div style={carte}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Chantiers à exporter</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={detaillee} onChange={e => setDetaillee(e.target.checked)}/> Version détaillée
              </label>
              <button style={btn(true)} disabled={export_.enCours} onClick={exporter}>{export_.enCours ? "Génération…" : "Télécharger le PDF"}</button>
            </div>
          </div>
          {export_.message && <div style={{ fontSize: 12, color: T.textSub, marginBottom: 6 }}>{export_.message}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 4 }}>
            {calcul.preselection.map(p => (
              <label key={p.chantierId} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: p.actif ? T.text : T.textMuted }}>
                <input type="checkbox" checked={p.coche} onChange={e => basculer(p.chantierId, e.target.checked)}/>
                {p.nom}{p.mention ? <em style={{ fontSize: 11 }}> — {p.mention}</em> : null}
              </label>
            ))}
          </div>
        </div>

        {detaillee && (
          <div style={carte}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Préparer la version détaillée</div>
            <div style={{ fontSize: 12, color: T.textSub, marginBottom: 10 }}>
              Pour chaque chantier : la synthèse (proposée par l'IA, à relire — c'est votre texte qui part), une ou deux photos, et les commentaires d'ouvriers à reprendre.
              Rien n'est coché par défaut ; aucun commentaire n'apparaît jamais dans la version direction.
            </div>
            {!det.charge ? <div style={{ color: T.textMuted }}>Chargement des comptes rendus et des phasages…</div>
              : calcul.synthese.map(s => {
                const pr = preparation?.[s.chantierId] || { photos: [], commentaires: [], taches: [] };
                const photosChoisies = prepPeriode.photos[s.chantierId] || [];
                const coches = prepPeriode.commentaires[s.chantierId] || [];
                const ia = prepPeriode.ia[s.chantierId] || {};
                return (
                  <div key={s.chantierId} style={{ borderTop: `1px solid ${T.border}`, padding: "10px 0" }}>
                    <div style={{ fontWeight: 700 }}>{s.nom}</div>
                    <div style={{ fontSize: 12, color: T.textSub, margin: "4px 0" }}>{pr.taches.map(t => `${t.lot} : ${t.resume}`).join(" · ") || "Aucune tâche modifiée sur la période."}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <textarea value={prepPeriode.syntheses[s.chantierId] || ""} onChange={e => majPrep("syntheses", s.chantierId, e.target.value)}
                        placeholder="Synthèse de la période (une phrase)" rows={2}
                        style={{ flex: 1, background: T.bg, color: T.text, border: `1px solid ${T.border}`, borderRadius: 8, padding: 8, fontSize: 13 }}/>
                      <button style={btn(false)} disabled={ia.enCours} onClick={() => proposer(s)}>{ia.enCours ? "…" : "Proposer avec l'IA"}</button>
                    </div>
                    {ia.message && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{ia.message}</div>}
                    {pr.photos.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                        {pr.photos.slice(0, 24).map(ph => {
                          const choisie = photosChoisies.includes(ph.url);
                          return (
                            <img key={ph.url} src={ph.url} alt="" title={`${ph.ouvrier} · ${fmtJourV3(ph.date)}`}
                              onClick={() => majPrep("photos", s.chantierId, choisie ? photosChoisies.filter(u => u !== ph.url) : [...photosChoisies, ph.url].slice(-2))}
                              style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: choisie ? `3px solid ${ACCENT}` : `1px solid ${T.border}` }}/>
                          );
                        })}
                      </div>
                    )}
                    {pr.commentaires.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {pr.commentaires.map(c => (
                          <label key={c.id} style={{ display: "flex", gap: 6, fontSize: 12, color: T.textSub }}>
                            <input type="checkbox" checked={coches.includes(c.id)}
                              onChange={e => majPrep("commentaires", s.chantierId, e.target.checked ? [...coches, c.id] : coches.filter(x => x !== c.id))}/>
                            <span><strong>{c.ouvrier}</strong> ({fmtJourV3(c.date)}) : {c.texte}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </>)}
    </div>
  );
}
