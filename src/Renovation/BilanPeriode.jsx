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
import PageBilanSemaine from "./BilanSemaine";

const ACCENT = "#FFC200";
const CHANTIERS_EXCLUS = ["DÉPOT"];
const COLONNES_LEGERES = "chantier_id, chantier_nom, date_releve, avancement, vendu_ht, heures_vendues, heures_reelles, "
  + "production_cumulee, marge_avancement, marge_terminaison, marge_probable, budget_restant, materiaux_en_avance, "
  + "heures_sans_lot, pct_sans_lot, chantier_repris, statut_completude, cr_manquants";
const COLONNES_COMPLETES = `${COLONNES_RELEVES_ALERTES_V2}, materiaux_en_avance, materiaux_imputes, mat_reel, reste_a_commander, cr_manquants`;

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
      const [rel, pts, rap, jou, cmd] = await Promise.all([
        lireToutParTranches((a, b) => supabase.from("chantier_releves_journaliers").select(COLONNES_LEGERES)
          .lte("date_releve", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("pointages").select("chantier_id, date, heures")
          .gte("date", avant).lte("date", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("rapports").select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, semaine")
          .in("semaine", semainesCouvrant(periode.debut, periode.fin)).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("avancement_journal").select("chantier_id, source, avancement_avant, avancement_apres, date_realisation")
          .gte("date_realisation", periode.debut).lte("date_realisation", periode.fin).order("id").range(a, b)),
        lireToutParTranches((a, b) => supabase.from("commande_lignes").select("chantier_id, commandes!inner(date_doc)")
          .gte("commandes.date_doc", periode.debut).lte("commandes.date_doc", periode.fin).order("id").range(a, b)),
      ]);
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
      });
    })();
    return () => { annule = true; };
  }, [periode?.cle]); // eslint-disable-line react-hooks/exhaustive-deps
  return etat;
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
    return { activite, preselection, synthese, alertes, avertissements, bandeau, ligneSansActivite: ligneSansActiviteV3(preselection) };
  }, [donnees, periode, enCours, choixPeriode, reglages.seuilsMarges]);

  const [export_, setExport] = useState({ enCours: false, message: null });
  const donneesExport = () => ({
    periode, bornes: donnees.bornes, bandeau: calcul.bandeau, synthese: calcul.synthese,
    ligneSansActivite: calcul.ligneSansActivite, avertissements: calcul.avertissements,
    alertes: calcul.alertes.releveDisponible ? calcul.alertes.lignes : null,
    genereLe: new Date().toLocaleDateString("fr-FR"),
  });
  const exporter = async () => {
    if (!calcul) return;
    setExport({ enCours: true, message: null });
    try {
      const html = documentBilanV3(donneesExport(), { detaillee: false });
      await telechargerPdf(html, `Bilan-${periode.cle.replace(/[^A-Za-z0-9-]/g, "_")}.pdf`);
      setExport({ enCours: false, message: "PDF téléchargé." });
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

        {/* Sélection et export */}
        <div style={carte}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Chantiers à exporter</div>
            <button style={btn(true)} disabled={export_.enCours} onClick={exporter}>{export_.enCours ? "Génération…" : "Télécharger le PDF"}</button>
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
      </>)}
    </div>
  );
}
