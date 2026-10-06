// Calcul de référence de scripts/verif-hors-devis.mjs : fait passer un
// instantané de chantiers par TOUS les calculs qui comparent heures réelles et
// heures vendues (finances du chantier, lots, avancement, phases, indice de
// délai, export d'opération, cadences, onglet Phases).
//
// La référence (scripts/fixtures/hors-devis-reference.json) a été produite par
// CE calcul avec le code de main au 06/10/2026 (commit d54712a), AVANT l'ajout
// des tâches hors devis : la vérification exige que le code actuel redonne
// exactement les mêmes chiffres sur les tâches existantes.
import * as CF from "../src/chantierFinance.mjs";
import { qcdDepuisFinance } from "../src/Renovation/qcd.mjs";
import { ouvragesComparablesV1 } from "../src/Renovation/echantillonCadencesV1.mjs";
import { normaliserChantier } from "../src/Renovation/operationExportModele.mjs";
import { construireMesPhases } from "../src/Renovation/mesPhasesV1.mjs";

// Retire les textes de méthode (« formule ») : ils documentent le calcul et
// peuvent être reformulés ; seuls les CHIFFRES et les libellés affichés comptent.
export function sansFormules(v) {
  if (Array.isArray(v)) return v.map(sansFormules);
  if (v && typeof v === "object") {
    const out = {};
    Object.keys(v).forEach(k => { if (k !== "formule") out[k] = sansFormules(v[k]); });
    return out;
  }
  return v;
}

// Payload « ouvrier_mes_phases » reconstruit depuis le phasage (mêmes règles
// que la RPC pour les champs utilisés par mesPhasesV1).
function payloadPhases(ph, ppt) {
  const groupes = Array.isArray(ph.plan_travaux?.meta?.chrono_groupes) ? ph.plan_travaux.meta.chrono_groupes : [];
  const ids = new Set(groupes.map(g => g.id));
  const phases = [...groupes.map(g => ({ id: g.id, nom: g.nom, ordre: g.ordre, couleur: g.couleur, synthetique: false })),
    { id: "_a_organiser", nom: "À organiser", ordre: 999999, couleur: "#94a3b8", synthetique: true }];
  const grp = (t) => (ids.has(t.chrono_groupe_id) ? t.chrono_groupe_id : "_a_organiser");
  phases.forEach(p => {
    p.ouvrages = (ph.ouvrages || []).filter(o => (o.taches || []).some(t => grp(t) === p.id)).map(o => {
      const hd = parseFloat(o.heures_devis) || 0;
      return {
        id: o.id, libelle: o.libelle, quantite: o.quantite, unite: o.unite,
        heures_vendues_ouvrage: hd,
        ouvrage_complet: (o.taches || []).every(t => grp(t) === p.id),
        taches: (o.taches || []).filter(t => grp(t) === p.id).map(t => {
          const hv = parseFloat(t.heures_vendues) || 0;
          return {
            id: t.id, nom: t.nom, avancement: Math.max(0, Math.min(100, parseFloat(t.avancement) || 0)),
            heures_estimees: t.heures_estimees ?? null, heures_vendues: hv,
            heures_validees: CF.tacheHeuresReelles(t, ppt), heures_en_attente: 0, mes_heures: 0,
            ouvriers: t.ouvriers || [], est_mienne: false, date_prevue: t.date_prevue || null,
            hors_devis: hv === 0 && (hd === 0 || /divers.*hors devis/i.test(o.libelle || "")),
            ...(t.hors_devis === true ? { hors_devis_marque: true, hors_devis: true } : {}),
          };
        }),
      };
    });
  });
  return { modele: "v2", prenom: null, phases: phases.filter(p => !p.synthetique || p.ouvrages.length > 0) };
}

export function calculerTout(fx) {
  const chantiers = fx.phasages.map(ph => {
    const pts = fx.pointages.filter(p => p.chantier_id === ph.chantier_id);
    const cl = fx.commandeLignes.filter(l => l.chantier_id === ph.chantier_id);
    const ppt = CF.indexPointagesParTache(pts);
    const fin = CF.computeChantierFinance({
      phasage: ph, pointages: pts, commandeLignes: cl, tauxHoraires: {}, tauxMOPrev: fx.tauxMOPrev,
      lots: fx.lots, pctFacture: 0.3, materiauxById: {},
    });
    const ouvrages = (ph.ouvrages || []).map(o => ({
      id: o.id,
      avancement: CF.avancementOuvrage(o),
      avancementDetail: CF.avancementOuvrageDetail(o),
      heuresReelles: CF.heuresReellesOuvrage(o, ppt),
      heuresVendues: CF.heuresVenduesOuvrage(o),
      coutMO: CF.coutMOOuvrage(o, ppt, {}),
    }));
    const groupes = (ph.plan_travaux?.meta?.chrono_groupes || []).map(g => ({ id: g.id, ...CF.statsGroupeChrono(g.id, ph.ouvrages) }));
    const export_ = normaliserChantier({
      chantier: { id: ph.chantier_id, nom: ph.chantier_nom, statut: "en_cours" },
      phasage: ph, pointages: pts, finance: fin, adresse: null, statutLabel: "En cours",
      lots: fx.lots, tauxHoraires: {}, materiauxById: {}, ratiosById: {}, equipeParGroupeType: {},
      sources: {}, aujourdhui: "2026-10-06",
    });
    return {
      chantier_id: ph.chantier_id,
      finance: sansFormules(fin),
      qcd: qcdDepuisFinance(fin.brut),
      ouvrages, groupes,
      export: sansFormules(export_),
      phases: construireMesPhases(payloadPhases(ph, ppt)),
    };
  });
  return { chantiers, cadences: ouvragesComparablesV1(fx.phasages, fx.pointages) };
}
