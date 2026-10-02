// src/Invest/structurationFeuilleRoute.mjs — Feuille de route d'une étude de structuration (lot 5).
//
// Module pur. La feuille de route n'est PAS une saisie de plus : elle se DÉDUIT de ce qui est déjà au dossier, pour
// que rien ne soit ressaisi.
//   • les opérations du scénario retenu ;
//   • les objectifs chiffrés (ils servent de jalons) ;
//   • les actions de mise en œuvre, les intervenants à contacter et la prochaine revue ;
//   • la réserve de sécurité à constituer, si le diagnostic la juge faible.
// Chaque ligne : année, nature, action, responsable, échéance, statut, dépendance.

import { num, analyserObjectifs } from "./structurationDonnees.mjs";
import { situation, HYPOTHESES_PAR_DEFAUT } from "./structurationDiagnostic.mjs";
import { operationComplete } from "./structurationProjection.mjs";

const arr = (a) => (Array.isArray(a) ? a : []);
const annee = (iso) => { const m = String(iso ?? "").match(/^(\d{4})/); return m ? Number(m[1]) : null; };
const ORDRE_TYPES = { reserve: 0, action: 1, operation: 2, objectif: 3, revue: 4 };

export const LIBELLES_TYPES = Object.freeze({ reserve: "Réserve", action: "Action", operation: "Acquisition", objectif: "Objectif", revue: "Revue" });

/** Scénario retenu : celui désigné dans le dossier, sinon aucun (on ne choisit pas à la place du conseiller). */
export function scenarioRetenu(data) {
  const liste = arr(data?.scenarios_chiffres);
  return liste.find((s) => s.id === data?.scenario_retenu_id) || null;
}

export function construireFeuilleRoute(data, { anneeDepart, hypotheses = {} } = {}) {
  const h = { ...HYPOTHESES_PAR_DEFAUT, ...hypotheses };
  const c = data?.collecte || {};
  const moe = data?.mise_en_oeuvre || {};
  const items = [];
  const alertes = [];
  const manquants = [];
  const retenu = scenarioRetenu(data);
  const ops = arr(retenu?.operations).filter(operationComplete).sort((a, b) => num(a.annee) - num(b.annee));
  if (!retenu) manquants.push("scénario retenu (à désigner dans la comparaison des trajectoires)");

  // Réserve de sécurité : seulement si le diagnostic peut la calculer et la juge sous la cible.
  const s = situation(data);
  const depenses = s.chargesFoyerMois + s.mensualitesTotal;
  let besoinReserve = null;
  if (depenses > 0) {
    const cible = h.moisReserve * depenses;
    if (s.liquidites < cible) besoinReserve = Math.ceil((cible - s.liquidites) / 1000) * 1000;
  }
  if (besoinReserve) {
    items.push({ annee: anneeDepart, type: "reserve", titre: `Constituer ${besoinReserve.toLocaleString("fr-FR")} € de réserve de sécurité`,
      detail: `Cible : ${h.moisReserve} mois de dépenses (${Math.round(depenses).toLocaleString("fr-FR")} € par mois).`, responsable: "Client", echeance: null, statut: "À faire", dependance: "", source: "diagnostic" });
  }

  ops.forEach((o, i) => {
    const a = num(o.annee);
    if (a < anneeDepart) alertes.push(`L'opération « ${o.libelle || i + 1} » est datée ${a}, avant ${anneeDepart}.`);
    const loyer = num(o.loyer_mois), prix = num(o.prix);
    const rendement = loyer !== null && prix ? ((loyer * 12) / prix) : null;
    const precedente = i > 0 ? (ops[i - 1].libelle || `l'opération ${i}`) : null;
    items.push({ annee: a, type: "action", titre: `Point bancaire avant ${o.libelle || `l'opération ${i + 1}`}`, detail: "Mettre à jour la capacité d'emprunt et obtenir l'accord de principe.",
      responsable: "Profero", echeance: null, statut: "À faire", dependance: precedente ? `Après ${precedente}` : (besoinReserve ? "Réserve de sécurité constituée" : ""), source: "scenario" });
    items.push({ annee: a, type: "operation", titre: `Acquisition — ${o.libelle || `opération ${i + 1}`}`,
      detail: `Prix ${Math.round(prix).toLocaleString("fr-FR")} €, apport ${Math.round(num(o.apport) ?? 0).toLocaleString("fr-FR")} €${rendement !== null ? `, rendement brut visé ${(rendement * 100).toFixed(1).replace(".", ",")} %` : ""}.`,
      responsable: "Client et Profero", echeance: null, statut: "Planifiée", dependance: "Point bancaire validé", source: "scenario" });
  });
  const parAn = new Map(); ops.forEach((o) => parAn.set(num(o.annee), (parAn.get(num(o.annee)) || 0) + 1));
  for (const [a, n] of parAn) if (n > 1) alertes.push(`${n} opérations en ${a} : vérifier que la capacité bancaire et la trésorerie le permettent.`);

  analyserObjectifs(c.objectifs_mesures).parPriorite.forEach((o) => {
    const a = num(o.echeance);
    if (a === null) return;
    items.push({ annee: a, type: "objectif", titre: o.libelle || o.type || "Objectif", detail: `${num(o.montant) !== null ? `${Math.round(num(o.montant)).toLocaleString("fr-FR")} € · ` : ""}priorité ${o.priorite || "—"}${o.flexibilite ? ` · ${String(o.flexibilite).toLowerCase()}` : ""}.`,
      responsable: "", echeance: null, statut: "Jalon", dependance: "", source: "objectifs" });
  });

  arr(moe.actions).filter((x) => String(x.titre || "").trim()).forEach((x) => {
    items.push({ annee: annee(x.echeance) ?? anneeDepart, type: "action", titre: x.titre, detail: "", responsable: x.responsable || "", echeance: x.echeance || null,
      statut: x.statut || "À faire", dependance: x.dependance || "", source: "mise_en_oeuvre" });
  });
  arr(moe.intervenants).filter((x) => x.statut === "À contacter" || !x.statut).forEach((x) => {
    items.push({ annee: anneeDepart, type: "action", titre: `Contacter ${String(x.role || "l'intervenant").toLowerCase()}${x.nom ? ` (${x.nom})` : ""}`, detail: "", responsable: "Profero",
      echeance: x.date || null, statut: "À faire", dependance: "", source: "mise_en_oeuvre" });
  });
  if (String(moe.prochaine_revue_le || "").trim()) {
    items.push({ annee: annee(moe.prochaine_revue_le) ?? anneeDepart, type: "revue", titre: "Revue patrimoniale", detail: "Mettre à jour la situation, les objectifs et la trajectoire.",
      responsable: "Profero", echeance: moe.prochaine_revue_le, statut: "Planifiée", dependance: "", source: "mise_en_oeuvre" });
  }

  items.sort((a, b) => a.annee - b.annee || ORDRE_TYPES[a.type] - ORDRE_TYPES[b.type] || String(a.echeance || "9999").localeCompare(String(b.echeance || "9999")));
  const parAnnee = [];
  for (const it of items) {
    let g = parAnnee.find((x) => x.annee === it.annee);
    if (!g) { g = { annee: it.annee, items: [] }; parAnnee.push(g); }
    g.items.push(it);
  }
  return { scenario: retenu, items, parAnnee, alertes, manquants, besoinReserve };
}
