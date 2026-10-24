// ─────────────────────────────────────────────────────────────────────────────
// Alertes des marges (étape 2 de la refonte, 24/10/2026) — calculées sur les
// RELEVÉS JOURNALIERS (chantier_releves_journaliers), entre un relevé de
// comparaison (début de période) et le relevé de fin de période.
//
// Elles remplacent la règle « perte de marge », qui comparait la « marge
// nette » (vendu − coûts engagés) de deux relevés : elle se déclenchait dès
// qu'un chantier dépensait plus de 500 € dans la semaine, même quand il
// gagnait de l'argent. Les alertes deviennent (seuils réglables dans Admin,
// planning_config.seuils_marges) :
//   - marge probable en baisse de plus de 500 € — avec le ou les lots
//     responsables, en heures et en euros ;
//   - un lot qui dérive au-delà de ×1,3 avec au moins 25 % d'avancement ;
//   - plus de 10 % d'heures « sans lot » sur le chantier ;
//   - une production par heure aberrante sur la période (€ produits ÷ heures
//     de la période > 2 × vendu ÷ heures vendues) ;
//   - un dépassement d'enveloppe matériaux d'un lot ;
//   - « consommation sans avancement » (conservée), avec la production exacte.
// Un chantier repris ne déclenche aucune alerte.
//
// MÊME CHIFFRE = MÊME SERVICE : tout est LU dans les colonnes des relevés
// (écrites par releveJournalier.mjs depuis chantierFinance) ; rien n'est
// recalculé ici. Une donnée absente (null) rend la règle muette, jamais 0.
//
// La sortie a la forme de pointsAttentionV1 (lignes, drapeaux de relevé) : le
// suivi sur plusieurs semaines, l'écran, le PDF, l'e-mail et la page Alertes
// la consomment sans changement. Une ligne par chantier, avec la liste de ses
// alertes ; plus de phrase d'explication qui répète la ligne principale.
//
// Module PUR : aucune dépendance Supabase, aucune horloge, aucun effet de bord.
// ─────────────────────────────────────────────────────────────────────────────
import { normaliserSeuilsMarges } from "../chantierFinance.mjs";
import {
  formaterEurosV1, formaterHeuresV1, releveExploitableV1,
  MOTIF_CONSOMMATION_SANS_AVANCEMENT, MOTIF_MARGE_PROBABLE_EN_BAISSE, MOTIF_LOT_EN_DERIVE,
  MOTIF_HEURES_SANS_LOT, MOTIF_PRODUCTION_HEURE_ABERRANTE, MOTIF_DEPASSEMENT_ENVELOPPE,
} from "./pointsAttentionV1.mjs";

export const ALERTES_MARGES_VERSION = "v2";
export const SOURCE_RELEVES_JOURNALIERS = "releves_journaliers";

const str = v => (v == null ? "" : String(v).trim());
const listeSure = v => (Array.isArray(v) ? v : []);
const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const num = v => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtCoef = c => `×${(Math.round(c * 100) / 100).toString().replace(".", ",")}`;
const fmtPct = p => `${(Math.round(p * 10) / 10).toString().replace(".", ",")} %`;
const signeH = h => `${h >= 0 ? "+" : "−"}${formaterHeuresV1(Math.abs(h))}`;
const signeE = e => `${e >= 0 ? "+" : "−"}${formaterEurosV1(Math.abs(e))}`;

// Un relevé par chantier : le plus récent (date_releve) si plusieurs.
function indexer(lignes) {
  const m = new Map();
  for (const l of listeSure(lignes)) {
    if (!l || typeof l !== "object") continue;
    const id = str(l.chantier_id);
    if (!id) continue;
    const p = m.get(id);
    if (!p || str(l.date_releve) >= str(p.date_releve)) m.set(id, l);
  }
  return m;
}

// Lots responsables d'une baisse de marge probable : ceux dont l'effet sur la
// marge probable (ecartProbableEuros) s'est aggravé entre les deux relevés.
function lotsResponsables(courant, precedent) {
  const avant = new Map(listeSure(precedent?.lots).map(l => [l.id, l]));
  return listeSure(courant?.lots)
    .map(l => {
      const a = avant.get(l.id);
      const e1 = num(l.ecartProbableEuros), e0 = num(a?.ecartProbableEuros) ?? 0;
      const h1 = num(l.heuresRestantesProbables), h0 = num(a?.heuresRestantesProbables);
      const p1 = num(l.heuresRestantesPrevues), p0 = num(a?.heuresRestantesPrevues);
      if (e1 == null) return null;
      const deltaEuros = e1 - e0;
      // Heures probables en plus par rapport aux heures prévues, avant → après.
      const surplusApres = (h1 ?? 0) - (p1 ?? 0);
      const surplusAvant = (h0 ?? 0) - (p0 ?? 0);
      return { id: l.id, label: l.label || l.id, deltaEuros, deltaHeures: surplusApres - surplusAvant,
        ecartHeures: num(l.ecartHeures), ecartEuros: num(l.ecartEuros) };
    })
    .filter(x => x && x.deltaEuros > 1)
    .sort((a, b) => b.deltaEuros - a.deltaEuros);
}

/**
 * Alertes d'une période.
 * @param {object} args
 * @param {Array} args.snapshotsCourants   relevés journaliers de FIN de période (un par chantier)
 * @param {Array} args.snapshotsPrecedents relevés journaliers de COMPARAISON (début de période)
 * @param {object} [args.seuils]           planning_config.seuils_marges (défauts sinon)
 */
// `source` : origine des relevés (messages d'état) — journaliers par défaut.
export function alertesMargesV2({ snapshotsCourants, snapshotsPrecedents, seuils, source = SOURCE_RELEVES_JOURNALIERS } = {}) {
  const s = normaliserSeuilsMarges(seuils);
  const courants = indexer(snapshotsCourants);
  const precedents = indexer(snapshotsPrecedents);
  const lignes = [];
  const reprisIgnores = [];

  for (const [chantierId, c] of courants) {
    const nom = str(c.chantier_nom) || chantierId;
    if (c.chantier_repris === true) { reprisIgnores.push(nom); continue; }
    const p = precedents.get(chantierId) || null;
    const alertes = [];
    const ajouter = (motif, texte, euros = null) => alertes.push({ motif, texte, euros: euros == null ? null : round2(euros) });

    // ── 1. Marge probable en baisse (comparaison) ──
    const mp1 = num(c.marge_probable), mp0 = num(p?.marge_probable);
    let baisseProbable = null;
    if (mp1 != null && mp0 != null && mp0 - mp1 > s.alerteBaisseMargeProbableEuros) {
      baisseProbable = mp0 - mp1;
      const resp = lotsResponsables(c, p).slice(0, 3);
      const detail = resp.length
        ? resp.map(l => `lot ${l.label} : ${signeH(l.deltaHeures)} restantes probables, −${formaterEurosV1(l.deltaEuros)}`
            + (l.ecartHeures != null && l.ecartEuros != null ? ` (dérive ${signeH(l.ecartHeures)}, ${signeE(l.ecartEuros)})` : "")).join(" ; ")
        : "aucun lot n'a dérivé davantage : la baisse vient des coûts réels (main-d'œuvre, matériaux, frais généraux) ou du reste à commander";
      ajouter(MOTIF_MARGE_PROBABLE_EN_BAISSE,
        `marge probable en baisse de ${formaterEurosV1(baisseProbable)} (${formaterEurosV1(mp0)} → ${formaterEurosV1(mp1)}) — ${detail}`, baisseProbable);
    }

    // Activité sur la période : les alertes d'ÉTAT (lot en dérive, heures sans
    // lot, dépassement d'enveloppe) ne remontent que pour un chantier qui a
    // bougé (heures pointées ou production) — un chantier terminé ou à
    // l'arrêt ne revient pas chaque semaine avec les mêmes constats.
    const hA1 = num(c.heures_reelles), hA0 = num(p?.heures_reelles);
    const pA1 = num(c.production_cumulee), pA0 = num(p?.production_cumulee);
    const actif = !p
      || (hA1 != null && hA0 != null && hA1 - hA0 > 0.05)
      || (pA1 != null && pA0 != null && Math.abs(pA1 - pA0) > 1);

    // ── 2. Lots qui dérivent (état de fin de période) ──
    // (Le pseudo-lot « Sans lot » relève de l'alerte « heures sans lot ».)
    if (actif) for (const l of listeSure(c.lots)) {
      if (l.id === "_orphans") continue;
      const r = num(l.ratioDeriveExact), av = num(l.avancementExact);
      if (r == null || av == null) continue;
      if (r > s.alerteDeriveLotRatio && av >= s.alerteDeriveLotAvancementPct) {
        const h = num(l.ecartHeures), e = num(l.ecartEuros);
        ajouter(MOTIF_LOT_EN_DERIVE,
          `lot ${l.label || l.id} en dérive ${fmtCoef(r)} à ${fmtPct(av)} d'avancement${h != null && e != null ? ` : ${signeH(h)}, ${signeE(e)}` : ""}`, e);
      }
    }

    // ── 3. Heures sans lot ──
    const pctSansLot = num(c.pct_sans_lot);
    if (actif && pctSansLot != null && pctSansLot > s.alerteSansLotPct) {
      ajouter(MOTIF_HEURES_SANS_LOT,
        `${fmtPct(pctSansLot)} des heures sans lot${num(c.heures_sans_lot) != null ? ` (${formaterHeuresV1(num(c.heures_sans_lot))})` : ""} : nettoyage, SAV, approvisionnement… rattachés à aucun lot, la dérive des lots est masquée`);
    }

    // ── 4. Dépassement d'enveloppe matériaux ──
    if (actif) for (const w of listeSure(c.warnings)) {
      if (w?.code !== "depassement_enveloppe") continue;
      if (!((num(w.euros) ?? 0) >= s.alerteDepassementEnveloppeMinEuros)) continue;
      ajouter(MOTIF_DEPASSEMENT_ENVELOPPE,
        `lot ${w.label || w.lotId} : matériaux au-delà de l'enveloppe de ${formaterEurosV1(num(w.euros) ?? 0)}${num(w.pct) != null ? ` (+${Math.round(num(w.pct))} %)` : ""}`, num(w.euros));
    }

    // ── Comparaisons de période (production, heures, marge à l'avancement) ──
    const prod1 = num(c.production_cumulee), prod0 = num(p?.production_cumulee);
    const h1 = num(c.heures_reelles), h0 = num(p?.heures_reelles);
    const ma1 = num(c.marge_avancement), ma0 = num(p?.marge_avancement);
    const vendu = num(c.vendu_ht), hv = num(c.heures_vendues);
    const production = prod1 != null && prod0 != null ? prod1 - prod0 : null;
    const heures = h1 != null && h0 != null ? h1 - h0 : null;

    // ── 5. Production par heure aberrante ──
    if (production != null && heures != null && production > 0 && vendu > 0 && hv > 0) {
      const ref = vendu / hv;
      const parHeure = production / Math.max(heures, 1);
      if (parHeure > s.alerteProductionHeureFacteur * ref) {
        ajouter(MOTIF_PRODUCTION_HEURE_ABERRANTE,
          `production de ${formaterEurosV1(production)} pour ${formaterHeuresV1(Math.max(heures, 0))} pointées (${formaterEurosV1(parHeure)} par heure, contre ${formaterEurosV1(ref)} au devis) : avancement à vérifier`);
      }
    }

    // ── 6. Consommation sans avancement (production exacte) ──
    let margePerdueConso = null;
    if (production != null && heures != null && ma1 != null && ma0 != null && vendu > 0) {
      const stable = production <= vendu * s.consoAvancementStablePts / 100;
      if (stable && heures >= s.consoHeuresAjouteesMin && ma0 - ma1 >= s.consoMargePerdueMinEuros) {
        margePerdueConso = ma0 - ma1;
        ajouter(MOTIF_CONSOMMATION_SANS_AVANCEMENT,
          `${formaterHeuresV1(heures)} consommées pour ${formaterEurosV1(Math.max(production, 0))} produits : la marge à l'avancement recule de ${formaterEurosV1(margePerdueConso)}`, margePerdueConso);
      }
    }

    if (alertes.length === 0) continue;
    const av1 = num(c.avancement), av0 = num(p?.avancement);
    lignes.push({
      chantier_id: chantierId,
      nom,
      motifs: [...new Set(alertes.map(a => a.motif))],
      alertes,
      // Montant en jeu (tri, cumul du suivi) : baisse de marge probable, sinon
      // marge à l'avancement perdue, sinon 0 (alertes d'état sans montant perdu).
      margePerdue: round2(baisseProbable ?? margePerdueConso ?? 0),
      avancement: av1, avancementAvant: av0,
      avancementDelta: av1 != null && av0 != null ? round2(av1 - av0) : null,
      heuresAjoutees: heures == null ? null : round2(heures),
      production: production == null ? null : round2(production),
      explication: null,
    });
  }

  lignes.sort((a, b) => b.margePerdue - a.margePerdue || b.alertes.length - a.alertes.length || a.chantier_id.localeCompare(b.chantier_id));
  return {
    version: ALERTES_MARGES_VERSION,
    source,
    seuils: s,
    releveDisponible: releveExploitableV1(snapshotsCourants),
    relevePrecedentDisponible: releveExploitableV1(snapshotsPrecedents),
    comparaisonPossible: releveExploitableV1(snapshotsCourants) && releveExploitableV1(snapshotsPrecedents),
    lignes,
    reprisIgnores,
  };
}
