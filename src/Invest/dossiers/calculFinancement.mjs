// src/Invest/dossiers/calculFinancement.mjs — logique PURE de l'onglet Financement d'une mission.
// Aucun accès Supabase ; la date du jour arrive en paramètre. Le plan de financement se déduit du scénario
// retenu (onglet Stratégie) et des banques retenues : rien n'est stocké en double. Une donnée absente rend le
// résultat « non évaluable » (null), jamais zéro. Indicatif : taux nominal, hors vacance et fiscalité.
import { mensualiteCredit, indicateursScenario, normaliserHypotheses } from "./calculStrategie.mjs";

export const STATUTS_BANQUE = Object.freeze({
  a_consulter: "À consulter", dossier_depose: "Dossier déposé", accord_principe: "Accord de principe", offre_recue: "Offre reçue",
  offre_acceptee: "Offre acceptée", refus: "Refus", abandon: "Abandon",
});
export const STATUTS_RETENABLES = Object.freeze(["accord_principe", "offre_recue", "offre_acceptee"]);
export const STATUTS_DOSSIER = Object.freeze({ a_constituer: "À constituer", en_cours: "En cours de constitution", pret: "Prêt à transmettre", transmis: "Transmis aux banques" });
export const MAX_BANQUES = 12;

const nombre = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const euro = (v) => Math.round(v);
const joursEntre = (de, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);

/** Scénario retenu : le choix explicite s'il existe encore, sinon le scénario recommandé, sinon aucun. */
export function scenarioRetenu(scenarios = [], choisiId = null) {
  const choisi = choisiId ? scenarios.find((s) => s.id === choisiId) : null;
  if (choisi) return { scenario: choisi, origine: "choisi" };
  const reco = scenarios.find((s) => s.recommande);
  return reco ? { scenario: reco, origine: "recommande" } : { scenario: null, origine: null };
}

/** Banques dont le financement est retenu pour le plan (retenue cochée ET statut compatible ET montant accordé). */
export const banquesRetenues = (banques = []) => banques.filter((b) => b.retenue && STATUTS_RETENABLES.includes(b.statut) && nombre(b.montant_accorde) !== null);

export function erreursBanque(b = {}) {
  const e = [];
  if (!String(b.banque || "").trim()) e.push("Une banque doit avoir un nom.");
  const bornes = [["montant_demande", "Montant demandé", 0, null], ["montant_accorde", "Montant accordé", 0, null], ["taux_pct", "Taux", 0, 15], ["duree_ans", "Durée", 1, 30],
    ["assurance_mensuelle", "Assurance mensuelle", 0, null], ["frais_dossier", "Frais de dossier", 0, null], ["frais_garantie", "Frais de garantie", 0, null]];
  for (const [cle, libelle, min, max] of bornes) {
    const brut = b[cle]; if (brut == null || brut === "") continue;
    const n = nombre(brut);
    if (n === null) e.push(`${libelle} : valeur non numérique.`);
    else if (n < min || (max !== null && n > max)) e.push(`${libelle} : ${max === null ? `à partir de ${min}` : `entre ${min} et ${max}`}.`);
  }
  if (b.retenue) {
    if (!STATUTS_RETENABLES.includes(b.statut)) e.push("Une banque retenue doit avoir un accord de principe ou une offre.");
    if (nombre(b.montant_accorde) === null) e.push("Une banque retenue doit avoir un montant accordé.");
  }
  if (b.demande_le && b.reponse_le && b.reponse_le < b.demande_le) e.push("La réponse ne peut pas précéder la demande.");
  return e;
}

/** Lignes libres du plan : lignes vides ignorées, montant positif exigé. */
export function nettoyerLignes(lignes = []) {
  return (Array.isArray(lignes) ? lignes : []).map((l) => ({ libelle: String(l?.libelle || "").trim(), montant: nombre(l?.montant) }))
    .filter((l) => l.libelle || l.montant !== null);
}
export function erreursLignes(lignes = [], nom = "Ligne") {
  const e = [];
  nettoyerLignes(lignes).forEach((l, i) => { if (!l.libelle) e.push(`${nom} ${i + 1} : intitulé manquant.`); if (l.montant === null || l.montant < 0) e.push(`${nom} ${i + 1} : montant à renseigner (0 ou plus).`); });
  return e;
}

/**
 * Plan de financement : emplois (prix, travaux, frais, frais bancaires des prêts retenus, lignes libres) contre
 * ressources (apport, prêts retenus, lignes libres). `ecart` = ressources − emplois.
 */
export function planFinancement({ scenario = null, banques = [], autresEmplois = [], autresRessources = [] } = {}) {
  if (!scenario) return { evaluable: false, raison: "Aucun scénario retenu : recommandez un scénario dans l'onglet Stratégie ou choisissez-en un ici." };
  const h = normaliserHypotheses(scenario.hypotheses);
  if (!(h.prix > 0)) return { evaluable: false, raison: "Le scénario retenu n'a pas de prix d'acquisition." };
  const retenues = banquesRetenues(banques);
  const fraisBancaires = retenues.reduce((s, b) => s + (nombre(b.frais_dossier) ?? 0) + (nombre(b.frais_garantie) ?? 0), 0);
  const emplois = [{ cle: "prix", libelle: "Prix d'acquisition", montant: euro(h.prix) }];
  if (h.travaux > 0) emplois.push({ cle: "travaux", libelle: "Travaux", montant: euro(h.travaux) });
  if (h.frais > 0) emplois.push({ cle: "frais", libelle: "Frais d'acquisition (notaire, agence)", montant: euro(h.frais) });
  if (fraisBancaires > 0) emplois.push({ cle: "frais_bancaires", libelle: "Frais bancaires (dossier, garantie)", montant: euro(fraisBancaires) });
  for (const l of nettoyerLignes(autresEmplois).filter((x) => x.montant > 0)) emplois.push({ cle: "libre", libelle: l.libelle, montant: euro(l.montant) });
  const ressources = [];
  if (h.apport > 0) ressources.push({ cle: "apport", libelle: "Apport personnel", montant: euro(h.apport) });
  for (const b of retenues) ressources.push({ cle: "pret", libelle: `Prêt ${b.banque}`, montant: euro(nombre(b.montant_accorde)) });
  for (const l of nettoyerLignes(autresRessources).filter((x) => x.montant > 0)) ressources.push({ cle: "libre", libelle: l.libelle, montant: euro(l.montant) });
  const totalEmplois = emplois.reduce((s, x) => s + x.montant, 0), totalRessources = ressources.reduce((s, x) => s + x.montant, 0);
  const ecart = totalRessources - totalEmplois;
  return { evaluable: true, emplois, ressources, totalEmplois, totalRessources, ecart, etat: Math.abs(ecart) <= 1 ? "equilibre" : ecart < 0 ? "insuffisant" : "excedentaire",
    apportRenseigne: h.apport !== undefined, aucunPretRetenu: retenues.length === 0 };
}

/** Synthèse des prêts retenus : mensualités, taux moyen pondéré, compatibilité avec la capacité du client. */
export function syntheseCredits(banques = [], mensualiteMax = null) {
  const retenues = banquesRetenues(banques);
  if (retenues.length === 0) return { nombre: 0, montantTotal: 0, mensualite: null, assurance: null, mensualiteAvecAssurance: null, tauxMoyenPct: null, incomplets: 0, compatibleCapacite: null };
  const complet = (b) => nombre(b.taux_pct) !== null && nombre(b.duree_ans) !== null;
  const incomplets = retenues.filter((b) => !complet(b)).length;
  const montantTotal = retenues.reduce((s, b) => s + nombre(b.montant_accorde), 0);
  const mensualite = incomplets ? null : retenues.reduce((s, b) => s + mensualiteCredit(nombre(b.montant_accorde), nombre(b.taux_pct), nombre(b.duree_ans)), 0);
  const assurance = retenues.reduce((s, b) => s + (nombre(b.assurance_mensuelle) ?? 0), 0);
  const avecTaux = retenues.filter((b) => nombre(b.taux_pct) !== null), poids = avecTaux.reduce((s, b) => s + nombre(b.montant_accorde), 0);
  const tauxMoyen = avecTaux.length && poids > 0 ? avecTaux.reduce((s, b) => s + nombre(b.taux_pct) * nombre(b.montant_accorde), 0) / poids : null;
  const avecAssurance = mensualite === null ? null : euro(mensualite + assurance);
  return { nombre: retenues.length, montantTotal: euro(montantTotal), mensualite: mensualite === null ? null : euro(mensualite), assurance: euro(assurance), mensualiteAvecAssurance: avecAssurance,
    tauxMoyenPct: tauxMoyen === null ? null : Math.round(tauxMoyen * 100) / 100, incomplets, compatibleCapacite: avecAssurance === null || mensualiteMax === null ? null : avecAssurance <= mensualiteMax };
}

/** Banques par statut (toutes présentes, même à zéro). */
export const pipelineBanques = (banques = []) => Object.fromEntries(Object.keys(STATUTS_BANQUE).map((s) => [s, banques.filter((b) => b.statut === s).length]));

/** Alertes sur les banques : offre expirée ou proche de l'expiration, dossier déposé sans réponse depuis trois semaines. */
export function alertesBanques(banques = [], aujourdhui) {
  const out = [];
  for (const b of banques) {
    if (b.statut === "offre_recue" && b.validite_offre_le) {
      const reste = joursEntre(aujourdhui, String(b.validite_offre_le).slice(0, 10));
      if (reste < 0) out.push({ code: "offre_expiree", banque: b.banque, niveau: "danger", libelle: `${b.banque} : l'offre a expiré depuis ${-reste} j` });
      else if (reste <= 15) out.push({ code: "offre_expire_bientot", banque: b.banque, niveau: "warning", libelle: `${b.banque} : l'offre expire ${reste === 0 ? "aujourd'hui" : `dans ${reste} j`}` });
    }
    if (b.statut === "dossier_depose" && b.demande_le && !b.reponse_le && joursEntre(String(b.demande_le).slice(0, 10), aujourdhui) >= 21)
      out.push({ code: "sans_reponse", banque: b.banque, niveau: "warning", libelle: `${b.banque} : pas de réponse depuis ${joursEntre(String(b.demande_le).slice(0, 10), aujourdhui)} j` });
  }
  return out;
}

/** Complétude du dossier côté client : pièces OBLIGATOIRES reçues ou validées (onglet Documents). */
export function completudeDossierClient(pieces = []) {
  const attendues = pieces.filter((p) => p.genre === "piece_client" && p.obligatoire && p.statut !== "sans_objet");
  if (attendues.length === 0) return { disponible: false, total: 0, recues: 0, manquantes: [] };
  const manquantes = attendues.filter((p) => !["recue", "validee"].includes(p.statut)).map((p) => p.libelle);
  return { disponible: true, total: attendues.length, recues: attendues.length - manquantes.length, manquantes };
}
export { indicateursScenario };
