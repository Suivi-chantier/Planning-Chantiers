// Vérification de l'étape 1A (refonte du Bilan semaine) : taux de frais
// généraux UNIQUE et DATÉ pour toute l'entreprise.
//
// Exemple issu des tests, données fictives : chantier, ouvriers, taux et
// heures sont inventés pour le calcul.
//
//   - une heure coûte le taux en vigueur à SA date (date du pointage) ;
//   - reprise d'antériorité et heures non datées : le taux le plus ancien ;
//   - projections (heures restantes, frais prévisionnels) : le taux du jour ;
//   - barème absent : 17,44 €/h depuis le 01/01/2026 ;
//   - l'ancien champ par phasage (plan_travaux.meta.fg_taux_horaire) n'est
//     plus lu, ni dans le module, ni dans l'interface ;
//   - tous les appelants du module transmettent le barème.
//
//   node scripts/verif-fg-taux-date.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeChantierFinance, margeReelleSemaine, METHODE_CALCUL,
  normaliserBaremeFG, tauxFGALaDate, ajouterTauxFG, fgDePointages,
  TAUX_FG_DEFAUT, CLE_CONFIG_TAUX_FG,
} from "../src/chantierFinance.mjs";

const ici = dirname(fileURLToPath(import.meta.url));
const racine = resolve(ici, "..");
let nb = 0;
const ok = (c, msg) => { assert.ok(c, msg); nb++; };
const proche = (a, b, msg) => { assert.ok(Math.abs(a - b) < 0.005, `${msg} : ${a} ≠ ${b}`); nb++; };

// ── Barème fictif : 15 €/h depuis le 01/01/2026, 20 €/h à partir du 07/10/2026 ──
const BAREME = [{ depuis: "2026-10-07", taux: 20 }, { depuis: "2026-01-01", taux: 15 }];

// ── 1. Lecture du barème ─────────────────────────────────────────────────────
{
  const b = normaliserBaremeFG(BAREME);
  ok(b[0].depuis === "2026-01-01" && b[1].depuis === "2026-10-07", "barème trié du plus ancien au plus récent");
  ok(normaliserBaremeFG(null).length === 1 && normaliserBaremeFG(null)[0].taux === 17.44, "barème absent → 17,44 €/h");
  ok(normaliserBaremeFG([])[0].depuis === "2026-01-01", "barème vide → défaut depuis le 01/01/2026");
  ok(TAUX_FG_DEFAUT[0].taux === 17.44 && CLE_CONFIG_TAUX_FG === "fg_taux_horaires", "défaut et clé de réglage");
  ok(normaliserBaremeFG([{ depuis: "pas une date", taux: 9 }, { depuis: "2026-03-01", taux: -1 }, { depuis: "2026-02-01", taux: "12,5" }])
    .map(e => e.taux).join() === "12.5", "entrées invalides ignorées, virgule décimale acceptée");
  ok(tauxFGALaDate(b, "2026-10-06") === 15, "veille du changement : ancien taux");
  ok(tauxFGALaDate(b, "2026-10-07") === 20, "jour du changement : nouveau taux");
  ok(tauxFGALaDate(b, "2025-06-01") === 15, "avant le barème : taux le plus ancien");
  ok(tauxFGALaDate(b, null) === 15, "sans date : taux le plus ancien");
}

// ── 2. Ajout d'un taux depuis l'Admin : les anciens sont conservés ──────────
{
  const r = ajouterTauxFG(BAREME, { depuis: "2027-01-01", taux: "22,5" });
  ok(r.bareme.length === 3 && r.bareme.map(e => e.taux).join() === "15,20,22.5", "nouveau taux ajouté, anciens gardés");
  const r2 = ajouterTauxFG(BAREME, { depuis: "2026-10-07", taux: 21 });
  ok(r2.bareme.length === 2 && tauxFGALaDate(r2.bareme, "2026-10-08") === 21, "même date d'effet : taux remplacé");
  ok(ajouterTauxFG(BAREME, { depuis: "", taux: 10 }).erreur, "date d'effet obligatoire");
  ok(ajouterTauxFG(BAREME, { depuis: "2026-12-01", taux: "abc" }).erreur, "taux obligatoire");
  ok(ajouterTauxFG(null, { depuis: "2026-12-01", taux: 18 }).bareme.length === 2, "premier ajout : le défaut 17,44 € reste en tête");
}

// ── 3. Changement de taux au MILIEU d'une période ───────────────────────────
const phasage = {
  ouvrages: [
    { id: "o1", prix_ht: 20000, heures_devis: 100,
      taches: [
        { id: "t1", avancement: 50, heures_estimees: 60 },
        // Tâche sans pointage, heures saisies à l'ancienne (non datées).
        { id: "t2", avancement: 100, heures_estimees: 10, heures_reelles: 4, ouvriers: ["Ouvrier A"] },
      ] },
  ],
  // Ancien réglage par phasage : doit être IGNORÉ.
  plan_travaux: { meta: { fg_taux_horaire: 99, reprise_heures: 10, reprise_taux: 30 } },
};
const pt = (date, heures, extra = {}) => ({ date, heures, taux_horaire: 30, ouvrier: "Ouvrier A", tache_id: "t1", type_pointage: "tache", ...extra });
const pointages = [
  pt("2026-10-05", 8),                                              // avant le changement : 15 €/h
  pt("2026-10-06", 6),                                              // avant : 15 €/h
  pt("2026-10-07", 7),                                              // jour du changement : 20 €/h
  pt("2026-10-08", 2, { tache_id: null, type_pointage: "indirect", motif_indirect: "Trajet" }), // trajet : 20 €/h
  pt("2026-10-09", 3, { tache_id: null }),                          // heures libres : 20 €/h
];
{
  const fin = computeChantierFinance({ phasage, pointages, tauxFG: BAREME, aujourdhui: "2026-10-24" });
  const b = fin.brut;
  // 14 h × 15 + 12 h × 20 + 4 h anciennes × 15 + 10 h de reprise × 15
  const attendu = 14 * 15 + 12 * 20 + 4 * 15 + 10 * 15;
  proche(b.fgChantier, attendu, "frais généraux : chaque heure au taux de sa date");
  proche(b.heuresReellesTotalChantier, 40, "mêmes heures que le total des heures réelles");
  ok(b.fgTauxHoraire === 20, "taux affiché = taux du jour");
  proche(b.margeChantier, b.prixHTChantier - b.coutMOTotalChantier - b.coutMatChantier - attendu, "la marge nette déduit ces frais");
  // Projections : heures restantes au taux du jour.
  proche(b.fgProjete, attendu + b.heuresRestantes * 20, "frais projetés = engagés + restant × taux du jour");
  proche(b.fgPrevChantier, 100 * 20, "frais prévisionnels = heures prévues × taux du jour");
  ok(!fin.warnings.some(w => w.code === "fg_non_regle"), "plus d'avertissement « frais généraux non réglés »");
  ok(fin.fg.renseigne === true, "frais généraux toujours renseignés");
  ok(/taux en vigueur à la date de chaque heure/.test(fin.fg.sousLabel), `libellé à taux multiples : ${fin.fg.sousLabel}`);
  ok(fin.fg.ventilation.some(v => v.main === "Reprise d'antériorité" && /taux le plus ancien/.test(v.sub)), "reprise : ligne à part au taux le plus ancien");
  const sommeVentil = fin.fg.ventilation.reduce((s, v) => s + parseFloat(String(v.right).replace(/[^\d,-]/g, "").replace(",", ".")), 0);
  proche(sommeVentil, Math.round(14 * 15 + 7 * 20 + 4 * 15) + Math.round(5 * 20) + 150, "la ventilation additionne au total");

  // Le même chantier « aujourd'hui » avant le changement : projections à 15 €/h.
  const avant = computeChantierFinance({ phasage, pointages, tauxFG: BAREME, aujourdhui: "2026-10-01" });
  ok(avant.brut.fgTauxHoraire === 15, "taux du jour lu à la date transmise");
  proche(avant.brut.fgChantier, attendu, "les heures passées ne dépendent pas du jour du calcul");
  // Un taux FUTUR ne s'applique à rien de passé.
  const futur = computeChantierFinance({ phasage, pointages, tauxFG: [...BAREME, { depuis: "2027-01-01", taux: 50 }], aujourdhui: "2026-10-24" });
  proche(futur.brut.fgChantier, attendu, "un taux à venir ne touche pas les heures passées");
  ok(futur.brut.fgTauxHoraire === 20, "ni les projections tant qu'il n'est pas en vigueur");

  // Barème absent → 17,44 €/h sur toutes les heures ; meta.fg_taux_horaire ignoré.
  const defaut = computeChantierFinance({ phasage, pointages });
  proche(defaut.brut.fgChantier, 40 * 17.44, "barème absent : 17,44 €/h");
}

// ── 4. Marge de la semaine : la période à cheval sur le changement ──────────
{
  const r = margeReelleSemaine({
    phasage, pointages, tauxFG: BAREME, prixVendu: 20000,
    avancementDebut: 40, avancementFin: 45, du: "2026-10-05", au: "2026-10-09",
  });
  // Période (05/10 exclu ; 09/10 inclus) : 6 h à 15 €/h + 12 h à 20 €/h.
  proche(r.heures, 18, "heures de la période");
  proche(r.fg, 6 * 15 + 12 * 20, "frais généraux de la semaine au taux de chaque jour");
  const fgDirect = fgDePointages(pointages.filter(p => p.date > "2026-10-05" && p.date <= "2026-10-09"), normaliserBaremeFG(BAREME));
  proche(r.fg, fgDirect, "même brique que la marge nette");
  ok(/taux en vigueur à la date de chaque heure/.test(r.semaine.ventilation.find(v => v.main === "Frais généraux").sub), "libellé de la ligne frais généraux");
  // Depuis le début : même total que la marge nette arrêtée au 09/10.
  const fin = computeChantierFinance({ phasage, pointages: pointages.filter(p => p.date <= "2026-10-09"), tauxFG: BAREME });
  proche(r.cumul.fg, fin.brut.fgChantier, "frais généraux depuis le début = ceux de la marge nette");
}

// ── 5. Méthode de calcul (annexe PDF / aide) ────────────────────────────────
{
  const fg = METHODE_CALCUL.find(m => m.cle === "fg");
  ok(/date de cette heure/.test(fg.formule) && /17,44/.test(fg.formule), "formule des frais généraux mise à jour");
  ok(!METHODE_CALCUL.some(m => /fg_taux_horaire/.test(m.source || "")), "plus de référence au champ par phasage");
  const mat = METHODE_CALCUL.find(m => m.cle === "margeATerminaison");
  ok(/en vigueur aujourd'hui/.test(mat.formule), "marge à terminaison : taux du jour pour le restant");
}

// ── 6. Gardes sur le code ───────────────────────────────────────────────────
const fichiers = (dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return n === "node_modules" ? [] : fichiers(p);
  return /\.(m?js|jsx)$/.test(n) ? [p] : [];
});
const sources = [...fichiers(join(racine, "src")), ...fichiers(join(racine, "api"))];
const lus = sources.map(f => ({ f: f.slice(racine.length + 1).replace(/\\/g, "/"), s: readFileSync(f, "utf8") }));
{
  // Le champ par phasage n'est plus LU nulle part (seuls des commentaires le citent).
  const lecteurs = lus.filter(({ s }) => s.split(/\r?\n/).some(l => /fg_taux_horaire\b/.test(l) && !/^\s*(\/\/|\*)/.test(l)));
  ok(lecteurs.length === 0, `champ par phasage encore lu : ${lecteurs.map(x => x.f).join(", ")}`);
  // (Le journal des MAJ annonce sa disparition : il est le seul à le citer.)
  ok(!lus.some(({ f, s }) => f !== "src/Renovation/journalMaj.js" && /Définis un taux horaire de frais généraux/.test(s)), "l'avertissement « Définis un taux horaire » a disparu");
  // Tous les appels du module transmettent le barème.
  const appels = [];
  lus.forEach(({ f, s }) => {
    if (f === "src/chantierFinance.mjs") return;
    const re = /computeChantierFinance\(/g;
    let m;
    while ((m = re.exec(s))) {
      const bloc = s.slice(m.index, m.index + 600);
      // Serveur : les entrées viennent de inputsPour (chargeur partagé, barème inclus).
      const passe = /tauxFG/.test(bloc) || /inputsPour\(/.test(bloc) || /^computeChantierFinance\(phasage\.inputs\)/.test(bloc);
      appels.push({ f, passe });
    }
  });
  ok(appels.length >= 8, `inventaire des appelants (${appels.length})`);
  const oublis = appels.filter(a => !a.passe);
  ok(oublis.length === 0, `appel sans barème : ${oublis.map(a => a.f).join(", ")}`);
  const chargeur = lus.find(x => x.f === "api/_partage/donneesFinanceChantiers.js").s;
  ok(/fg_taux_horaires/.test(chargeur) && /tauxFG/.test(chargeur), "chargeur serveur (relevé, assistant) : barème lu en base");
  const cron = lus.find(x => x.f === "api/cron-snapshot-hebdo.js").s;
  const appelsInputs = cron.match(/inputsPour\([^)]*\)/g) || [];
  ok(appelsInputs.length === 2 && appelsInputs.every(a => /aujourdhui/.test(a)), "relevé hebdo : taux du jour = jour du relevé (y compris reconstitution)");
  const bilan = lus.find(x => x.f === "src/Renovation/BilanSemaine.jsx").s;
  ok(/tauxFG/.test(bilan.slice(bilan.indexOf("entreesByCh[ph.chantier_id] = {"), bilan.indexOf("entreesByCh[ph.chantier_id] = {") + 300)), "Bilan : la marge de la semaine reçoit le barème");
  // Admin : réglage présent ; Phasage : plus de saisie.
  const admin = lus.find(x => x.f === "src/Renovation/Admin.jsx").s;
  ok(/<TauxFraisGenerauxAdmin/.test(admin), "réglage des frais généraux dans Admin");
  const phasageV2 = lus.find(x => x.f === "src/Renovation/PhasageV2.jsx").s;
  ok(!/majChampMeta\("fg_taux_horaire"/.test(phasageV2), "plus de champ « FG — Taux horaire » dans le phasage");
  // Module pur : aucune horloge.
  const mod = lus.find(x => x.f === "src/chantierFinance.mjs").s;
  ok(!/new Date\s*\(|Date\.now\s*\(/.test(mod), "module sans horloge (la date du jour arrive en paramètre)");
}

console.log(`verif-fg-taux-date : ${nb} contrôles OK (données fictives)`);
