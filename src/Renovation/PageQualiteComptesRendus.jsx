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
// L'avancement retenu à la validation n'est gardé que dans l'historique du
// phasage (plusieurs dizaines de Mo par période) : il n'est pas lu ici, et
// l'écart d'avancement s'affiche « indisponible » tant qu'une lecture côté
// serveur n'est pas en place.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS, getBranchAccent, getCurrentWeek, getWeekId } from "../constants";
import { Icon } from "../ui";
import { ClipboardCheck, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { lundiSemaineISOv1, ajouterJoursV1 } from "./bilanSemaineProchaineV1.mjs";
import { celluleDeDate } from "./replanificationV1";
import {
  faitsComptesRendus, agreger, tendance, decoupesParOuvrierEtMois,
  INDICATEURS_QUALITE, VERSION_V1, VERSION_V2, SEUILS,
} from "./qualiteComptesRendusV1";

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
        .select("id, ouvrier, chantier_id, chantier_nom, date_rapport, statut, taches, remarque, submitted_at, saisie_debut_le, formulaire_version, heures_indirectes")
        .in("date_rapport", dates).order("id"));
      if (annule) return;
      if (rap.erreur) { setEtat({ statut: "erreur" }); return; }
      const rapports = rap.lignes;
      const chantierIds = [...new Set(rapports.map(r => r.chantier_id).filter(Boolean))];
      const [pts, hist, ph] = await Promise.all([
        toutLire(() => supabase.from("pointages").select("id, rapport_id, tache_id, heures, type_pointage")
          .gte("date", debutPrec).lte("date", fin).not("rapport_id", "is", null).order("id")),
        // Anciennes versions des rapports (statut seulement) : un rapport est
        // modifié au plus tôt le jour de sa date, la veille par sécurité.
        toutLire(() => supabase.from("data_history").select("id, row_id, saved_at, statut:row_data->>statut")
          .eq("table_name", "rapports").gte("saved_at", `${ajouterJoursV1(debutPrec, -1)}T00:00:00Z`).order("id")),
        chantierIds.length
          ? supabase.from("phasages").select("chantier_id, ouvrages").in("chantier_id", chantierIds)
          : Promise.resolve({ data: [] }),
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
      });
    })();
    return () => { annule = true; };
  }, [debutPrec, fin]);

  const calcul = useMemo(() => {
    if (etat.statut !== "ok") return null;
    const entree = {
      rapports: etat.rapports, pointages: etat.pointages, historique: etat.historique,
      tachesHorsDevis: etat.tachesHorsDevis, avancementsValides: null,
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
                  <b>Écart d'avancement</b> : l'avancement retenu à la validation n'est gardé que dans l'historique du phasage, trop lourd pour être lu depuis cette page. Il reste « indisponible » ici tant qu'une lecture côté serveur n'est pas en place.
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
