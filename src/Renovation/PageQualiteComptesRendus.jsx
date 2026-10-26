// ─────────────────────────────────────────────────────────────────────────────
// Page « Qualité des comptes rendus » (bureau) — indicateurs par ouvrier sur
// une période (2, 4 ou 8 semaines), avec la tendance par rapport à la période
// précédente de même durée.
//
// Lecture seule. Tous les calculs vivent dans le module pur
// qualiteComptesRendusV1.mjs (le même qui a produit le diagnostic chiffré) ;
// ici on lit les comptes rendus, leurs pointages, l'historique des rapports et
// les tâches hors devis des phasages, puis on affiche. Une source illisible
// rend ses indicateurs « indisponibles », jamais nuls.
//
// L'avancement retenu à la validation est relu dans le journal d'avancement
// daté (étape 1C), pour les comptes rendus validés depuis sa mise en service.
//
// CR-6E : trois indicateurs de plus, calculés par les MÊMES fonctions que
// les écrans qui les montrent ailleurs :
//   - états déclarés identiques au prévu (champ `prevu` des lignes prévues,
//     parcours unique du 26/10/2026) ;
//   - écarts « avancement incohérent » : ecartsAvancementIncoherentRapport de
//     la Validation, mêmes données (pointages avant le jour, journal
//     d'avancement, phasages) et mêmes seuils (Admin) ;
//   - lignes du planning liées au phasage : tauxLiaisonPlanning du Planning.
// Lectures bornées aux chantiers des comptes rendus lus (pointages : tâches
// seulement, jusqu'à la fin de la période) et aux semaines de la période.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, getCurrentWeek, getWeekId } from "../constants";
import { Icon } from "../ui";
import { ClipboardCheck, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { lundiSemaineISOv1, ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";
import { celluleDeDate, semainesEntre } from "./replanificationV1";
import {
  faitsComptesRendus, agreger, tendance, decoupesParOuvrierEtMois, avancementsValidesDepuisJournal,
  ecartsAvancementIncoherentPeriode, INDICATEURS_QUALITE, VERSION_V1, VERSION_V2, SEUILS,
} from "./qualiteComptesRendusV1";
import { CLE_CONFIG_AVANCEMENT_INCOHERENT } from "./avancementIncoherentV1";

const PAGE = 1000;
const DUREES = [2, 4, 8];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const MOIS_LONGS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const dateCourte = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS[d.getMonth()]}`;
};
const libelleMois = (m) => { const [a, n] = m.split("-"); return `${MOIS_LONGS[Number(n) - 1]} ${a}`; };
// Les deux écritures de date_rapport rencontrées en base (« 12/10/2026 » et ISO).
const ecrituresDate = (iso) => { const [a, m, j] = iso.split("-"); return [`${j}/${m}/${a}`, iso]; };
const joursEntre = (debut, fin) => {
  const out = [];
  for (let d = debut; d <= fin; d = ajouterJoursV1(d, 1)) out.push(d);
  return out;
};
const virgule = (n) => String(n).replace(".", ",");
const semaineCourte = (w) => String(w || "").replace(/^\d{4}-W0?/, "S");
const ETATS_DECLARES = [
  { cle: "termine", label: "terminée" },
  { cle: "en_cours", label: "en cours" },
  { cle: "pas_commence", label: "pas commencée" },
  { cle: "bloque", label: "bloquée" },
];
const resumePrevu = (detail, prevu) => ETATS_DECLARES.map(e => `${detail[prevu][e.cle]} ${e.label}`).join(", ");

// L'API renvoie au plus 1 000 lignes par requête, sans le dire : on lit par paquets.
async function toutLire(construire) {
  const lignes = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await construire().range(debut, debut + PAGE - 1);
    if (error) return { erreur: error };
    lignes.push(...(data || []));
    if (!data || data.length < PAGE) return { lignes };
  }
}

const VERSIONS = [
  { cle: "", label: "Tous les formulaires" },
  { cle: VERSION_V1, label: "Ancien formulaire" },
  { cle: VERSION_V2, label: "Nouveau formulaire" },
];

// Texte d'une case : valeur principale + précision (n / d) + infobulle.
function contenuCase(code, g) {
  const v = g?.[code];
  if (!v) return { valeur: "—" };
  if (v.indisponible) return { valeur: "indisponible", titre: v.indisponible, muet: true };
  if (code === "tempsRemplissage") {
    if (v.n === 0) return v.nonMesures > 0
      ? { valeur: "ancien formulaire", titre: "L'ancien formulaire ne note pas l'heure de début de saisie.", muet: true }
      : { valeur: "—", titre: "Aucun envoi mesurable sur la période." };
    return { valeur: `${virgule(Math.round(v.medianeMin))} min`, detail: `80 % sous ${virgule(Math.round(v.p80Min))} min`,
      titre: `${v.n} envoi(s) mesuré(s)${v.rattrapagesExclus ? `, ${v.rattrapagesExclus} rattrapage(s) exclu(s)` : ""}${v.nonMesures ? `, ${v.nonMesures} envoi(s) de l'ancien formulaire non mesurable(s)` : ""}.` };
  }
  // CR-6E — états déclarés identiques au prévu (indicateur du planning).
  if (code === "prevuIdentique") {
    if (v.taux == null) return { valeur: "—", titre: "Pas encore mesurable : aucune tâche prévue avec un prévu connu sur la période. Mesuré depuis le parcours unique du 26/10/2026." };
    const rep = v.memeRepere.d > 0 ? ` — en cours / en cours : même repère ${v.memeRepere.n}/${v.memeRepere.d}` : "";
    return { valeur: `${Math.round(v.taux * 100)} %`, detail: `${v.n}/${v.d}`,
      titre: `Terminée prévue → ${resumePrevu(v.detail, "termine")}. En cours prévue → ${resumePrevu(v.detail, "en_cours")}${rep}.` };
  }
  if (code === "avancementIncoherent") {
    if (v.rapportsControles === 0) {
      return { valeur: "—", titre: v.rapportsNonControles > 0
        ? `Aucun compte rendu contrôlable : ${v.rapportsNonControles} sur un chantier sans phasage.`
        : "Aucun compte rendu sur la période." };
    }
    return { valeur: String(v.n), detail: `cas 1 : ${v.parCas[1]} · 2 : ${v.parCas[2]} · 3 : ${v.parCas[3]}`,
      titre: `${v.n} tâche(s) sur ${v.rapportsAvecEcart} compte(s) rendu(s), ${v.rapportsControles} contrôlé(s)${v.rapportsNonControles ? ` ; ${v.rapportsNonControles} non contrôlable(s) (chantier sans phasage)` : ""}.` };
  }
  if (code === "liaisonPlanning") {
    const pour = v.ouvrier ? `Lignes du planning où ${v.ouvrier} est prévu(e) : c'est le planning qu'il ou elle a reçu, pas son travail. ` : "";
    if (v.pourcent == null) return { valeur: "—", titre: `${pour}${v.libelle} sur la période.` };
    return { valeur: `${v.pourcent} %`, detail: `${v.liees}/${v.comptees}`, titre: `${pour}${v.detail}.` };
  }
  if (code === "ecartAvancement") {
    if (v.n === 0) return { valeur: "—", titre: "Aucune ligne comparable sur la période." };
    return { valeur: `${virgule(v.moyenneAbs)} pts`, detail: `${v.modifiees.n}/${v.modifiees.d} modifiées` };
  }
  if (v.taux == null) {
    if (v.nonMesurables > 0) return { valeur: "ancien formulaire", titre: "Non mesurable sur l'ancien formulaire.", muet: true };
    return { valeur: "—", titre: "Aucune ligne concernée sur la période." };
  }
  const extra = code === "plusieurs" && v.ecartMoyenSiDifferent != null ? ` — écart moyen ${virgule(v.ecartMoyenSiDifferent)} pts quand ils diffèrent` : "";
  const creees = code === "decoupees" && v.lignesCreees ? ` — ${v.lignesCreees} ligne(s) créée(s) par découpage` : "";
  return { valeur: `${Math.round(v.taux * 100)} %`, detail: `${v.n}/${v.d}`, titre: `${v.n} sur ${v.d}${extra}${creees}` };
}

function Fleche({ t, unite, T }) {
  if (!t || t.delta == null) return null;
  const couleur = t.sens === "mieux" ? "#2e7d32" : t.sens === "moins_bien" ? "#c0392b" : T.textMuted;
  const signe = t.delta > 0 ? "↑" : t.delta < 0 ? "↓" : "=";
  const ecart = `${t.delta > 0 ? "+" : ""}${virgule(t.delta)}${unite === "%" ? " pt" : ` ${unite}`}`;
  return (
    <span title={`Période précédente : ${virgule(Math.round(t.precedent * 10) / 10)}${unite === "%" ? " %" : ` ${unite}`}`}
      style={{ fontSize: FONT.xs.size, fontWeight: 700, color: couleur, whiteSpace: "nowrap" }}>
      {signe} {ecart}
    </span>
  );
}

export default function PageQualiteComptesRendus({ T, branch = "renovation" }) {
  const acc = getBranchAccent(branch);
  const [semaines, setSemaines] = useState(4);
  const [weekId, setWeekId] = useState(() => { const { year, week } = getCurrentWeek(); return getWeekId(year, week); });
  const [version, setVersion] = useState("");
  const [etat, setEtat] = useState({ statut: "chargement" });

  // Période affichée : les `semaines` semaines qui se terminent avec `weekId` ;
  // période précédente : les `semaines` semaines juste avant.
  const lundiRef = lundiSemaineISOv1(weekId);
  const fin = lundiRef ? ajouterJoursV1(lundiRef, 6) : null;
  const debut = lundiRef ? ajouterJoursV1(lundiRef, -7 * (semaines - 1)) : null;
  const finPrec = debut ? ajouterJoursV1(debut, -1) : null;
  const debutPrec = debut ? ajouterJoursV1(debut, -7 * semaines) : null;
  const decaler = (n) => {
    const c = celluleDeDate(ajouterJoursV1(lundiRef, 7 * semaines * n));
    if (c) setWeekId(c.weekId);
  };

  useEffect(() => {
    if (!debutPrec || !fin) return;
    let annule = false;
    setEtat({ statut: "chargement" });
    (async () => {
      const dates = joursEntre(debutPrec, fin).flatMap(ecrituresDate);
      const rap = await toutLire(() => supabase.from("rapports")
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, valide_le, taches, remarque, submitted_at, saisie_debut_le, formulaire_version, heures_indirectes")
        .in("date_rapport", dates).order("id"));
      if (annule) return;
      if (rap.erreur) { setEtat({ statut: "erreur" }); return; }
      const rapports = rap.lignes;
      const chantierIds = [...new Set(rapports.map(r => r.chantier_id).filter(Boolean))];
      const [pts, hist, ph, jr, ptsTaches, cel, cfg] = await Promise.all([
        toutLire(() => supabase.from("pointages").select("id, rapport_id, tache_id, heures, type_pointage")
          .gte("date", debutPrec).lte("date", fin).not("rapport_id", "is", null).order("id")),
        // Anciennes versions des rapports (statut seulement) : un rapport est
        // modifié au plus tôt le jour de sa date, la veille par sécurité.
        toutLire(() => supabase.from("data_history").select("id, row_id, saved_at, statut:row_data->>statut")
          .eq("table_name", "rapports").gte("saved_at", `${ajouterJoursV1(debutPrec, -1)}T00:00:00Z`).order("id")),
        chantierIds.length
          ? supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", chantierIds)
          : Promise.resolve({ data: [] }),
        // Journal d'avancement daté (étape 1C) : avancement retenu à la validation.
        chantierIds.length
          ? toutLire(() => supabase.from("avancement_journal")
            .select("id, chantier_id, tache_id, rapport_id, source, avancement_avant, avancement_apres, date_realisation, created_at")
            .in("chantier_id", chantierIds).order("id"))
          : Promise.resolve({ lignes: [] }),
        // CR-6E : heures pointées sur les tâches avant chaque jour (« avancement
        // incohérent »), sur les chantiers lus, jusqu'à la fin de la période.
        chantierIds.length
          ? toutLire(() => supabase.from("pointages")
            .select("id, chantier_id, tache_id, heures, type_pointage, quantite_validee, date")
            .in("chantier_id", chantierIds).not("tache_id", "is", null).lte("date", fin).order("id"))
          : Promise.resolve({ lignes: [] }),
        // CR-6E : cases du planning des semaines lues (lignes liées au phasage).
        toutLire(() => supabase.from("planning_cells").select("id, week_id, jour, chantier_id, ouvriers, taches, planifie")
          .in("week_id", semainesEntre(debutPrec, fin)).order("id")),
        // CR-6E : seuils de l'« avancement incohérent » réglés dans Admin
        // (jamais enregistrés ou illisibles : valeurs par défaut, comme la Validation).
        supabase.from("planning_config").select("value").eq("key", CLE_CONFIG_AVANCEMENT_INCOHERENT).maybeSingle(),
      ]);
      if (annule) return;
      const tachesHorsDevis = ph.error ? null : (ph.data || []).flatMap(p =>
        (Array.isArray(p.ouvrages) ? p.ouvrages : []).flatMap(o =>
          (Array.isArray(o?.taches) ? o.taches : []).filter(t => t?.hors_devis === true).map(t => String(t.id))));
      setEtat({
        statut: "ok", rapports,
        pointages: pts.erreur ? null : pts.lignes,
        historique: hist.erreur ? null : hist.lignes,
        tachesHorsDevis,
        avancementsValides: jr.erreur ? null : avancementsValidesDepuisJournal({ rapports, journal: jr.lignes }),
        avancementIncoherent: ecartsAvancementIncoherentPeriode({
          rapports,
          phasages: ph.error ? null : (ph.data || []),
          pointages: ptsTaches.erreur ? null : ptsTaches.lignes,
          journal: jr.erreur ? null : jr.lignes,
          seuils: cfg.error ? null : cfg.data?.value,
        }),
        cellulesPlanning: cel.erreur ? null : cel.lignes,
      });
    })();
    return () => { annule = true; };
  }, [debutPrec, fin]);

  const calcul = useMemo(() => {
    if (etat.statut !== "ok") return null;
    const entree = {
      rapports: etat.rapports, pointages: etat.pointages, historique: etat.historique,
      tachesHorsDevis: etat.tachesHorsDevis, avancementsValides: etat.avancementsValides,
      avancementIncoherent: etat.avancementIncoherent, cellulesPlanning: etat.cellulesPlanning,
    };
    const courant = faitsComptesRendus({ ...entree, debut, fin });
    const precedent = faitsComptesRendus({ ...entree, debut: debutPrec, fin: finPrec });
    const ouvriers = [...new Set(courant.lignes.map(l => l.ouvrier).concat(courant.envois.map(e => e.ouvrier)))]
      .filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
    const v = version || null;
    const colonnes = [{ cle: "", label: "Total", ouvrier: null }, ...ouvriers.map(o => ({ cle: o, label: o, ouvrier: o }))]
      .map(c => ({ ...c, g: agreger(courant, { ouvrier: c.ouvrier, version: v }), p: agreger(precedent, { ouvrier: c.ouvrier, version: v }) }));
    return { colonnes, decoupes: decoupesParOuvrierEtMois(courant) };
  }, [etat, debut, fin, debutPrec, finPrec, version]);

  const carte = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "12px 14px" };
  const bouton = (actif) => ({
    ...carte, padding: "6px 10px", cursor: "pointer", fontSize: FONT.xs.size + 1, fontWeight: 700,
    color: actif ? "#fff" : T.text, background: actif ? acc.accent : T.surface, borderColor: actif ? acc.accent : T.border,
  });
  const th = { padding: "8px 10px", fontSize: FONT.xs.size + 1, fontWeight: 800, color: T.textSub, textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${T.border}` };
  const td = { padding: "8px 10px", textAlign: "right", verticalAlign: "top", borderBottom: `1px solid ${T.border}` };
  const total = calcul?.colonnes?.[0]?.g;

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.bg, padding: "18px 16px 40px" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon as={ClipboardCheck} size={18} color={acc.accent}/>
          <h1 style={{ fontSize: FONT.lg.size + 2, fontWeight: 800, color: T.text, margin: 0 }}>Qualité des comptes rendus</h1>
        </div>
        <div style={{ fontSize: FONT.sm.size, color: T.textSub, marginBottom: 14 }}>
          Ce que les comptes rendus du soir apportent au bureau, ouvrier par ouvrier : temps de remplissage, corrections faites à la validation, précision des lignes, photos. La flèche compare à la période précédente de même durée.
        </div>

        {/* Période, durée, formulaire */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
          <button onClick={() => decaler(-1)} aria-label="Période précédente" style={{ ...carte, padding: "6px 8px", cursor: "pointer", display: "flex" }}>
            <Icon as={ChevronLeft} size={16}/>
          </button>
          <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text, minWidth: 220, textAlign: "center" }}>
            {debut && fin ? `${dateCourte(debut)} → ${dateCourte(fin)}` : ""}
            <div style={{ fontSize: FONT.xs.size, fontWeight: 600, color: T.textMuted }}>
              comparé au {debutPrec ? `${dateCourte(debutPrec)} → ${dateCourte(finPrec)}` : ""}
            </div>
          </div>
          <button onClick={() => decaler(1)} aria-label="Période suivante" style={{ ...carte, padding: "6px 8px", cursor: "pointer", display: "flex" }}>
            <Icon as={ChevronRight} size={16}/>
          </button>
          <button onClick={() => { const { year, week } = getCurrentWeek(); setWeekId(getWeekId(year, week)); }} style={bouton(false)}>
            Jusqu'à cette semaine
          </button>
          <span style={{ width: 8 }}/>
          {DUREES.map(n => <button key={n} onClick={() => setSemaines(n)} style={bouton(semaines === n)}>{n} semaines</button>)}
          <span style={{ width: 8 }}/>
          {VERSIONS.map(v => <button key={v.cle} onClick={() => setVersion(v.cle)} style={bouton(version === v.cle)}>{v.label}</button>)}
        </div>

        {etat.statut === "chargement" && <div style={{ ...carte, color: T.textSub }}>Chargement des comptes rendus…</div>}
        {etat.statut === "erreur" && <div style={{ ...carte, color: "#c0392b" }}>Lecture des comptes rendus impossible. Réessaie dans un instant.</div>}

        {calcul && (
          <>
            {calcul.colonnes.length === 1 && total.envois === 0 ? (
              <div style={{ ...carte, color: T.textSub }}>Aucun compte rendu sur cette période{version ? " pour ce formulaire" : ""}.</div>
            ) : (
              <div style={{ ...carte, padding: 0, overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: FONT.sm.size, color: T.text }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: T.surface, minWidth: 230 }}>Indicateur</th>
                      {calcul.colonnes.map(c => <th key={c.cle} style={{ ...th, color: c.ouvrier ? T.textSub : T.text }}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: T.surface, color: T.textSub }}>
                        Envois · lignes avec des heures
                      </td>
                      {calcul.colonnes.map(c => (
                        <td key={c.cle} style={{ ...td, color: T.textSub, whiteSpace: "nowrap" }}>{c.g.envois} · {c.g.lignesTravaillees}</td>
                      ))}
                    </tr>
                    {INDICATEURS_QUALITE.map(ind => (
                      <tr key={ind.code}>
                        <td title={ind.explication} style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: T.surface, fontWeight: 700 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {ind.libelle}<Icon as={Info} size={12} color={T.textMuted}/>
                          </span>
                        </td>
                        {calcul.colonnes.map(c => {
                          const k = contenuCase(ind.code, c.g);
                          return (
                            <td key={c.cle} title={k.titre} style={td}>
                              <div style={{ fontWeight: 800, color: k.muet ? T.textMuted : T.text, fontStyle: k.muet ? "italic" : "normal", whiteSpace: "nowrap" }}>{k.valeur}</div>
                              {k.detail && <div style={{ fontSize: FONT.xs.size, color: T.textMuted, whiteSpace: "nowrap" }}>{k.detail}</div>}
                              <Fleche t={tendance(ind.code, c.g, c.p)} unite={ind.unite} T={T}/>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Heure d'envoi (total ou formulaire choisi) */}
            {total.envois > 0 && (
              <section style={{ marginTop: 22 }}>
                <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>Heure d'envoi</h2>
                <div style={{ ...carte }}>
                  {(() => {
                    const max = Math.max(1, ...total.heureEnvoi.map(t => t.nb));
                    const somme = total.heureEnvoi.reduce((s, t) => s + t.nb, 0);
                    return total.heureEnvoi.map(t => (
                      <div key={t.cle} style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0", fontSize: FONT.sm.size }}>
                        <span style={{ width: 110, color: T.textSub }}>{t.label}</span>
                        <span style={{ height: 10, width: `${(t.nb / max) * 60}%`, minWidth: t.nb ? 4 : 0, background: acc.accent, borderRadius: 5 }}/>
                        <span style={{ fontWeight: 700 }}>{t.nb}{somme ? ` (${Math.round((t.nb / somme) * 100)} %)` : ""}</span>
                      </div>
                    ));
                  })()}
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 8 }}>
                    Heure de Paris, envois du jour même. Envoyés le lendemain ou plus tard (rattrapage) : {total.rattrapage.n} sur {total.rattrapage.d}.
                  </div>
                </div>
              </section>
            )}

            {/* CR-6E — détail des trois indicateurs du suivi qualité */}
            <section style={{ marginTop: 22 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>États déclarés face au prévu</h2>
              <div style={{ ...carte, fontSize: FONT.sm.size, lineHeight: 1.5 }}>
                {total.prevuIdentique.d === 0 ? (
                  <span style={{ color: T.textSub }}>
                    Pas encore mesurable sur cette période : aucune tâche prévue avec un prévu connu. Mesuré depuis le parcours unique du compte rendu (26 octobre 2026) ; les comptes rendus plus anciens ne gardaient pas le prévu affiché à l'ouvrier.
                  </span>
                ) : (
                  <>
                    <div style={{ color: T.textSub, marginBottom: 6 }}>
                      C'est le planning qui est mesuré : un écart veut dire que le planning annonçait autre chose que ce qui s'est passé, pas que l'ouvrier s'est trompé.
                    </div>
                    {[{ cle: "termine", label: "Prévue « terminée ce soir »" }, { cle: "en_cours", label: "Prévue « en cours »" }].map(p => {
                      const ligne = total.prevuIdentique.detail[p.cle];
                      const n = ETATS_DECLARES.reduce((s, e) => s + ligne[e.cle], 0);
                      return (
                        <div key={p.cle} style={{ margin: "3px 0" }}>
                          <b>{p.label}</b> ({n}) → déclarée {ETATS_DECLARES.map(e => `${e.label} ${ligne[e.cle]}`).join(" · ")}
                        </div>
                      );
                    })}
                    <div style={{ color: T.textSub, marginTop: 4 }}>
                      En cours prévue et déclarée en cours : même repère (commencé, à moitié, presque fini) {total.prevuIdentique.memeRepere.d > 0
                        ? `${total.prevuIdentique.memeRepere.n} fois sur ${total.prevuIdentique.memeRepere.d}` : "— (aucun cas)"}.
                    </div>
                  </>
                )}
              </div>
            </section>

            <section style={{ marginTop: 22 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>Écarts « avancement incohérent » de la période</h2>
              <div style={{ ...carte, fontSize: FONT.sm.size }}>
                {total.avancementIncoherent.indisponible ? (
                  <span style={{ color: T.textMuted, fontStyle: "italic" }}>Indisponible : {total.avancementIncoherent.indisponible}</span>
                ) : total.avancementIncoherent.rapportsControles === 0 ? (
                  <span style={{ color: T.textSub }}>Aucun compte rendu contrôlable sur la période.</span>
                ) : total.avancementIncoherent.n === 0 ? (
                  <span style={{ color: T.textSub }}>Aucun écart sur les {total.avancementIncoherent.rapportsControles} comptes rendus contrôlés.</span>
                ) : (
                  <details open={total.avancementIncoherent.n <= 15}>
                    <summary style={{ cursor: "pointer", fontWeight: 700, color: T.text }}>
                      {total.avancementIncoherent.n} écart(s) sur {total.avancementIncoherent.rapportsAvecEcart} compte(s) rendu(s) — cas 1 : {total.avancementIncoherent.parCas[1]}, cas 2 : {total.avancementIncoherent.parCas[2]}, cas 3 : {total.avancementIncoherent.parCas[3]}
                    </summary>
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table style={{ borderCollapse: "collapse", width: "100%", color: T.text }}>
                        <thead>
                          <tr>{["Date", "Ouvrier", "Chantier", "Cas", "Écart"].map(h => <th key={h} style={{ ...th, textAlign: "left" }}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                          {total.avancementIncoherent.liste.map((e, i) => (
                            <tr key={`${e.rapportId}-${e.tacheId}-${i}`}>
                              <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>{dateCourte(e.date)}</td>
                              <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>{e.ouvrier}</td>
                              <td style={{ ...td, textAlign: "left" }}>{e.chantierNom || "—"}</td>
                              <td style={{ ...td, textAlign: "left", whiteSpace: "nowrap" }}>{e.cas.join(" + ")}</td>
                              <td style={{ ...td, textAlign: "left" }}>{e.texte}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 8 }}>
                  Cas 1 : avancement déclaré nettement en avance sur les heures. Cas 2 : avancement qui gagne beaucoup sans heure pointée ce jour-là. Cas 3 : tâche terminée qui revient en cours. Même contrôle et mêmes seuils que la validation de fin de journée ; pour les jours passés, les heures prévues sont celles du phasage d'aujourd'hui.
                </div>
              </div>
            </section>

            <section style={{ marginTop: 22 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>Planning lié au phasage, semaine par semaine</h2>
              <div style={{ ...carte, fontSize: FONT.sm.size }}>
                {total.liaisonPlanning.indisponible ? (
                  <span style={{ color: T.textMuted, fontStyle: "italic" }}>Indisponible : {total.liaisonPlanning.indisponible}</span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
                    {total.liaisonPlanning.parSemaine.map(s => (
                      <span key={s.weekId} title={s.detail || s.libelle}>
                        <b>{semaineCourte(s.weekId)}</b> : {s.pourcent == null ? s.libelle : `${s.pourcent} % (${s.liees}/${s.comptees})`}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 8 }}>
                  Même compteur que le planning. Par ouvrier : les lignes où il ou elle est prévu(e) (équipe de la ligne) — c'est la qualité du planning reçu, pas celle de l'ouvrier.
                </div>
              </div>
            </section>

            {/* Compteur des lignes découpées (sert aussi à la Validation) */}
            <section style={{ marginTop: 22 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>Lignes découpées à la validation, par mois</h2>
              <div style={{ ...carte, fontSize: FONT.sm.size }}>
                {etat.pointages == null ? (
                  <span style={{ color: T.textMuted, fontStyle: "italic" }}>Indisponible : pointages non lus.</span>
                ) : Object.keys(calcul.decoupes).length === 0 ? (
                  <span style={{ color: T.textSub }}>Aucune ligne découpée sur la période : chaque ligne envoyée correspondait à une seule tâche.</span>
                ) : Object.entries(calcul.decoupes).sort(([a], [b]) => a.localeCompare(b, "fr")).map(([o, parMois]) => (
                  <div key={o} style={{ margin: "3px 0" }}>
                    <b>{o}</b> : {Object.entries(parMois).sort(([a], [b]) => a.localeCompare(b)).map(([m, c]) =>
                      `${libelleMois(m)} — ${c.lignesDecoupees} ligne(s) découpée(s) en ${c.lignesDecoupees + c.lignesCreees} tâches`).join(" · ")}
                  </div>
                ))}
              </div>
            </section>

            {/* Lecture */}
            <section style={{ marginTop: 22 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: FONT.md.size + 1, fontWeight: 800, color: T.text }}>Comment lire ces chiffres</h2>
              <div style={{ ...carte, fontSize: FONT.sm.size, color: T.text, lineHeight: 1.5 }}>
                <p style={{ marginTop: 0 }}>
                  Les parts de lignes portent sur les lignes <b>avec des heures</b>. « — » : aucune ligne concernée sur la période (ce n'est pas 0 %). « ancien formulaire » : l'ancien formulaire ne permet pas cette mesure. « indisponible » : la donnée n'a pas pu être lue.
                </p>
                <p>
                  <b>Écart d'avancement</b> : l'avancement retenu à la validation est relu dans le journal d'avancement. Il n'est mesuré que pour les comptes rendus validés depuis la mise en service du journal (24 octobre 2026) : avant, l'application ne gardait pas quelle validation avait fixé quel avancement. Une ligne non mesurable n'est pas comparée (elle ne compte pas pour 0) ; « — » = aucune ligne comparable sur la période.
                </p>
                <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
                  {INDICATEURS_QUALITE.map(ind => <li key={ind.code} style={{ margin: "3px 0" }}><b>{ind.libelle}</b> — {ind.explication}</li>)}
                  <li style={{ margin: "3px 0" }}>
                    Seuils : remarque « très courte » sous {SEUILS.remarqueCourte} caractères ; ligne « qui porte la journée » à partir de {Math.round(SEUILS.grosseLignePart * 100)} % d'une journée d'au moins {SEUILS.grosseLigneJourneeMin} h. Flèche verte = mieux, rouge = moins bien ; elle reste grise sous 2 points d'écart pour une part (1 minute ou 1 point d'avancement), ou quand l'indicateur n'est ni bon ni mauvais en soi.
                  </li>
                </ul>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
