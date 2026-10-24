#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Vérification — « Qualité des comptes rendus » (module qualiteComptesRendusV1).
// DONNÉES FICTIVES DE TEST : ouvriers « Alice », « Bruno », « Chloé »,
// chantiers « chA » / « chB », tâches « t1 »… — rien ne vient de la base.
//
//   node scripts/verif-qualite-comptes-rendus.mjs
// ─────────────────────────────────────────────────────────────────────────────
import assert from "node:assert/strict";
import {
  isoDate, heureParis, mediane, centile, part, famillesTravaux, decritPlusieursTravaux,
  comparerAuxPointages, nombreReouvertures, faitsComptesRendus, agreger, indicateursComptesRendus,
  decoupesParOuvrierEtMois, tendance, INDICATEURS_QUALITE,
} from "../src/Renovation/qualiteComptesRendusV1.mjs";

let nbOk = 0;
const ok = (c, m) => { assert.ok(c, m); nbOk++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const nd = (p) => [p.n, p.d];

// ── Outils ──────────────────────────────────────────────────────────────────
eq([isoDate("12/10/2026"), isoDate("2026-10-12T18:00"), isoDate("5/1/2026"), isoDate("hier"), isoDate(null)],
  ["2026-10-12", "2026-10-12", "2026-01-05", null, null], "date de rapport : écriture française ou ISO");
eq(heureParis("2026-10-12T16:13:00Z"), { date: "2026-10-12", heure: 18, minute: 13 }, "heure de Paris en heure d'été (+2 h)");
eq(heureParis("2026-11-02T16:30:00Z"), { date: "2026-11-02", heure: 17, minute: 30 }, "heure de Paris en heure d'hiver (+1 h)");
eq(heureParis("2026-10-12T22:30:00Z").date, "2026-10-13", "après minuit à Paris : jour suivant");
eq(heureParis(null), null, "horodatage absent");
eq([mediane([3, 1, 2]), mediane([1, 2, 3, 4]), mediane([])], [2, 2.5, null], "médiane");
eq([centile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80), centile([13, 360], 80), centile([], 80)], [8, 360, null], "80e centile au rang le plus proche");
eq(part(0, 0), { n: 0, d: 0, taux: null }, "aucune ligne concernée : taux null, jamais 0 %");

// ── Intitulé qui énumère plusieurs travaux ──────────────────────────────────
for (const t of ["Démolition ménage et pvc", "La plomberie, boucher les trous et le ménage", "Bac à douche / Ménage / Nourrisse", "Nettoyer / Scotcher / Bâcher escalier"]) {
  ok(decritPlusieursTravaux(t), `plusieurs travaux : « ${t} »`);
}
for (const t of ["Bandes et enduits fermeture placo", "Passer alim PER appt 6 et 7", "Ponçage béton ménage", "Plaquage isolation cloison escalier", "Évacuation des déchets", "", null]) {
  ok(!decritPlusieursTravaux(t), `un seul travail : « ${t} »`);
}
eq(famillesTravaux("Pose du receveur et des plinthes"), ["plomberie", "menuiserie"], "familles reconnues sans accents");

// ── Comparaison déclaration ↔ pointages ─────────────────────────────────────
const V = (taches) => ({ statut: "valide", taches });
const P = (tache_id, heures, type_pointage = "tache") => ({ tache_id, heures, type_pointage });
eq(comparerAuxPointages(V([{ tache_id: "a", heures_reelles: 2 }]), [P("a", 2), P("b", 1)]),
  { parTache: { a: { reaffectee: false, heuresModifiees: false } }, lignesCreees: 0, decoupes: 0, ajoutees: 1, rattachees: 0 },
  "ligne ajoutée avec des heures en plus : pas un découpage");
eq(comparerAuxPointages(V([{ tache_id: null, heures_reelles: 6.75 }]), [P("a", 1.35), P("b", 1.35), P("c", 1.35), P("d", 1.35), P("e", 1.35), P(null, 0.87, "indirect")]),
  { parTache: {}, lignesCreees: 4, decoupes: 1, ajoutees: 0, rattachees: 1 },
  "une ligne de 6,75 h répartie sur 5 tâches = 1 ligne découpée, 4 lignes créées (le trajet ne compte pas)");
eq(comparerAuxPointages({ statut: "en_attente", taches: [] }, []), null, "rapport non validé : pas de comparaison");
eq(comparerAuxPointages(V([{ tache_id: "a", heures_reelles: 2 }]), null), null, "pointages non lus : pas de comparaison");
eq(comparerAuxPointages(V([{ tache_id: "a", heures_reelles: 2 }]), []), null, "validé sans aucun pointage : pas de comparaison (anomalie, pas « rien de modifié »)");

// ── Réouvertures ────────────────────────────────────────────────────────────
eq(nombreReouvertures({ statut: "valide" }, [
  { saved_at: "2026-10-13T08:05:00Z", statut: "en_attente" },
  { saved_at: "2026-10-12T19:00:00Z", statut: "en_attente" },
  { saved_at: "2026-10-13T08:00:00Z", statut: "valide" },
]), 1, "validé → rouvert → revalidé = 1 réouverture (versions triées par date)");
eq(nombreReouvertures({ statut: "valide" }, [{ saved_at: "x", statut: "en_attente" }]), 0, "validé une fois : 0");

// ── Jeu de comptes rendus fictif (semaine du 12 au 18/10/2026) ──────────────
const L = (o) => ({ remarque: "", photos: [], ...o });
const RAPPORTS = [
  { id: "r1", ouvrier: "Alice", chantier_id: "chA", date_rapport: "12/10/2026", statut: "valide", formulaire_version: "v2",
    saisie_debut_le: "2026-10-12T16:00:00Z", submitted_at: "2026-10-12T16:12:00Z", remarque: "", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 4, avancement: 50, remarque: "En cours" }),
      L({ planifie: "Peinture", tache_id: "t2", statut: "faite", heures_reelles: 2, avancement: 100 }),
      L({ planifie: "Démolition ménage et pvc", tache_id: null, origine: "libre", statut: "en_cours", heures_reelles: 2, avancement: 30 }),
    ] },
  { id: "r2", ouvrier: "Alice", chantier_id: "chB", date_rapport: "12/10/2026", statut: "valide", formulaire_version: "v2",
    saisie_debut_le: "2026-10-12T16:00:00Z", submitted_at: "2026-10-12T16:13:00Z", remarque: "RAS", taches: [
      L({ planifie: "Niche", tache_id: null, origine: "nouvelle", proposition: { ouvrage_id: null, ouvrage_libelle: "Divers", nature: "demande_client" },
        statut: "faite", heures_reelles: 1, avancement: 100, photos: ["p.jpg"], remarque: "Niche demandée par la cliente" }),
      L({ planifie: "Seuil", tache_id: null, statut: "en_cours", heures_reelles: 1, avancement: 20, remarque: "Reste les plinthes du couloir" }),
    ] },
  { id: "r3", ouvrier: "Alice", chantier_id: "chA", date_rapport: "2026-10-13", statut: "valide", formulaire_version: "v2",
    saisie_debut_le: "2026-10-13T10:00:00Z", submitted_at: "2026-10-13T16:00:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "faite", heures_reelles: 9, avancement: 100, photos: ["a.jpg"] }),
    ] },
  { id: "r4", ouvrier: "Bruno", chantier_id: "chA", date_rapport: "13/10/2026", statut: "valide", formulaire_version: null,
    submitted_at: "2026-10-13T14:30:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 1, avancement: 75 }),
      L({ planifie: "Tout le reste du chantier", tache_id: null, statut: "en_cours", heures_reelles: 7, avancement: 0, remarque: "." }),
    ] },
  { id: "r5", ouvrier: "Bruno", chantier_id: "chA", date_rapport: "14/10/2026", statut: "valide",
    submitted_at: "2026-10-15T06:00:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "faite", heures_reelles: 2, heures_declarees_origine: 3, avancement: 100,
        bascules: [{ vers_chantier_id: "chB", heures: 1 }] }),
    ] },
  // Rapport créé par une bascule (conducteur) : jamais compté pour l'ouvrier.
  { id: "r6", ouvrier: "Bruno", chantier_id: "chB", date_rapport: "14/10/2026", statut: "valide",
    submitted_at: "2026-10-15T08:00:00Z", taches: [
      L({ planifie: "Plaques", tache_id: null, statut: "faite", heures_reelles: 1, bascule_depuis: { rapport_id: "r5" } }),
    ] },
  { id: "r7", ouvrier: "Chloé", chantier_id: "chA", date_rapport: "13/10/2026", statut: "valide", formulaire_version: "v2",
    saisie_debut_le: "2026-10-13T17:00:00Z", submitted_at: "2026-10-13T16:50:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 2, avancement: 50, quantite_jour: 3, unite: "m²", remarque: "Reste 10 m²" }),
    ] },
  // Hors période.
  { id: "r8", ouvrier: "Chloé", chantier_id: "chA", date_rapport: "20/10/2026", statut: "valide", formulaire_version: "v2",
    submitted_at: "2026-10-20T16:00:00Z", taches: [L({ planifie: "Plaques", tache_id: "t1", statut: "faite", heures_reelles: 8, avancement: 100 })] },
  // Validé sans aucun pointage : non comparable.
  { id: "r9", ouvrier: "Bruno", chantier_id: "chA", date_rapport: "15/10/2026", statut: "valide",
    submitted_at: "2026-10-15T15:00:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 2, avancement: 80, remarque: "Pose des plaques côté fenêtre" }),
    ] },
  { id: "r10", ouvrier: "Chloé", chantier_id: "chA", date_rapport: "12/10/2026", statut: "valide", formulaire_version: "v2",
    saisie_debut_le: "2026-10-12T15:00:00Z", submitted_at: "2026-10-12T15:20:00Z", taches: [
      L({ planifie: "Plaques", tache_id: "t1", statut: "en_cours", heures_reelles: 3, avancement: 50, remarque: "Reste les angles et les chutes" }),
    ] },
];
const pt = (rapport_id, tache_id, heures, type_pointage = "tache") => ({ rapport_id, tache_id, heures, type_pointage });
const POINTAGES = [
  // r1 : t1 gardée, t2 réaffectée sur t3, ligne libre de 2 h répartie sur t4 + t5.
  pt("r1", "t1", 4), pt("r1", "t3", 2), pt("r1", "t4", 1), pt("r1", "t5", 1), pt("r1", null, 0.5, "indirect"),
  // r2 : la nouvelle tâche créée (nt-r2-0), la case du planning reste sans tâche.
  pt("r2", "nt-r2-0", 1), pt("r2", null, 1),
  // r3 : 9 h sur t1 réparties sur t1 + t7.
  pt("r3", "t1", 4.5), pt("r3", "t7", 4.5),
  pt("r4", "t1", 1), pt("r4", null, 7),
  pt("r5", "t1", 2),
  pt("r6", null, 1),
  pt("r7", "t1", 2),
  pt("r10", "t1", 3),
];
const HISTORIQUE = [
  { row_id: "r1", saved_at: "2026-10-12T19:00:00Z", statut: "en_attente" },
  { row_id: "r1", saved_at: "2026-10-13T08:00:00Z", statut: "valide" },
  { row_id: "r1", saved_at: "2026-10-13T08:05:00Z", statut: "en_attente" },
  { row_id: "r3", saved_at: "2026-10-13T19:00:00Z", statut: "en_attente" },
];
const AVANCEMENTS = { r1: { t1: 75, t2: 100 }, r3: { t1: 100 }, r4: { t1: 100 }, r5: { t1: 100 }, r7: { t1: 50 }, r9: { t1: 80 }, r10: { t1: 50 } };
const ENTREE = {
  rapports: RAPPORTS, pointages: POINTAGES, historique: HISTORIQUE, avancementsValides: AVANCEMENTS,
  tachesHorsDevis: ["t2"], debut: "2026-10-12", fin: "2026-10-18",
};
const res = indicateursComptesRendus(ENTREE);
const T = res.total;

// Volumes : r6 (créé par bascule) et r8 (hors période) écartés.
eq([T.rapports, T.envois, T.lignesTravaillees], [8, 7, 12], "8 rapports, 7 envois, 12 lignes avec des heures");
eq(Object.keys(res.parOuvrier), ["Alice", "Bruno", "Chloé"], "ouvriers de la période, triés");

// Temps de remplissage (nouveau formulaire, hors rattrapage) : r1+r2 = un seul
// envoi de 13 min ; r3 = 360 min (brouillon ouvert le matin) ; r10 = 20 min ;
// r7 : début de saisie après l'envoi → anomalie, non mesuré.
eq({ ...T.tempsRemplissage, plusDeUneHeure: nd(T.tempsRemplissage.plusDeUneHeure), moinsDe10Min: nd(T.tempsRemplissage.moinsDe10Min) },
  { n: 3, nonMesures: 3, rattrapagesExclus: 0, anomalies: 1, medianeMin: 20, p80Min: 360, plusDeUneHeure: [1, 3], moinsDe10Min: [0, 3] },
  "temps de remplissage : médiane, 80e centile, ancien formulaire non mesuré, anomalie écartée");
eq(res.parVersion.v1.tempsRemplissage.medianeMin, null, "ancien formulaire : pas de temps de remplissage (jamais 0)");

// Heure d'envoi (Paris) et rattrapage : r5 du 14/10 envoyé le 15/10.
eq(T.heureEnvoi.map(t => t.nb), [0, 1, 2, 3, 0, 0], "heure d'envoi : 16 h 30 / 17 h 00 + 17 h 20 / 18 h 00, 18 h 13, 18 h 50");
eq(nd(T.rattrapage), [1, 7], "1 envoi sur 7 en rattrapage");
eq([nd(res.parVersion.v1.rattrapage), nd(res.parVersion.v2.rattrapage)], [[1, 3], [0, 4]], "rattrapage par formulaire");

// Écart d'avancement : 50→75, 75→100, quatre lignes identiques ; t2 réaffectée exclue.
eq(T.ecartAvancement, {
  n: 7, moyenneAbs: 7.1, moyenneSignee: 7.1, modifiees: { n: 2, d: 7, taux: 2 / 7 }, hausses: 2, baisses: 0,
  ecartsDe10ouPlus: { n: 2, d: 7, taux: 2 / 7 },
}, "écart d'avancement déclaré / validé");

// Corrections à la validation (rapports comparables : r9 sans pointage écarté).
eq(nd(T.reaffectees), [1, 11], "1 ligne réaffectée (t2 → t3)");
eq([nd(T.decoupees), T.decoupees.lignesCreees], [[2, 11], 2], "2 lignes découpées (r1 libre, r3), 2 lignes créées");
eq(nd(T.heuresModifiees), [1, 11], "heures modifiées sur t1 (r3 : 9 h → 4,5 h)");
eq(nd(T.rattachees), [2, 4], "lignes sans tâche rattachées à la validation");
eq(T.lignesAjoutees, 0, "aucune ligne ajoutée avec des heures en plus");
eq(nd(T.basculees), [1, 12], "1 ligne basculée vers un autre chantier");

// Lignes sans tâche, texte libre, nouvelles tâches, hors devis.
eq(nd(T.sansTache), [4, 12], "4 lignes sans tâche du phasage");
eq(T.sansTacheV2, { planning: 1, libre: 1, nouvelle: 1 }, "nouveau formulaire : case du planning / texte libre / nouvelle tâche");
eq([nd(T.texteLibre), T.texteLibre.nonMesurables], [[1, 8], 4], "texte libre : mesuré sur le nouveau formulaire seulement");
eq(res.parVersion.v1.texteLibre.taux, null, "ancien formulaire : texte libre non mesurable (taux null)");
eq(nd(T.creees), [1, 8], "1 tâche proposée par l'ouvrier");
eq(nd(T.horsDevis), [2, 12], "hors devis : t2 marquée + nouvelle tâche « demande du client »");

// Fourre-tout : intitulé à plusieurs travaux (r1) ; ligne sans tâche qui porte
// 7 h sur 8 (r4). La ligne de 9 h sur t1 (r3) porte la journée mais suit une
// tâche du phasage : comptée « grosse ligne », pas fourre-tout.
eq([nd(T.plusieursTravaux), nd(T.grosseLigne), nd(T.fourreTout)], [[1, 12], [2, 12], [2, 12]], "lignes fourre-tout probables");

// Remarques (lignes non terminées) et photos (lignes terminées).
eq(nd(T.remarquesCourtes), [5, 8], "remarques vides ou < 15 caractères : « En cours », vide ×2, « . », « Reste 10 m² »");
eq(nd(T.remarqueVide), [5, 12], "remarques vides sur toutes les lignes avec des heures");
eq(nd(T.photosManquantes), [2, 4], "2 tâches terminées sans photo sur 4");

// Rouverts après validation (historique), tâches faites à plusieurs.
eq(nd(T.corriges), [1, 8], "1 rapport rouvert après validation");
eq(T.plusieurs, { n: 1, d: 2, taux: 0.5, ecartMoyenSiDifferent: 25 },
  "t1 le 12/10 (50 / 50) : identiques ; le 13/10 (100 / 75) : différents ; ligne en quantité exclue");
eq([nd(res.parOuvrier.Alice.plusieurs), nd(res.parOuvrier.Bruno.plusieurs), nd(res.parOuvrier["Chloé"].plusieurs)],
  [[1, 2], [1, 1], [0, 1]], "tâches faites à plusieurs, par ouvrier");

// Par ouvrier : chacun ses lignes.
eq([res.parOuvrier.Alice.lignesTravaillees, res.parOuvrier.Bruno.lignesTravaillees, res.parOuvrier["Chloé"].lignesTravaillees], [6, 4, 2], "lignes par ouvrier");
eq(nd(res.parOuvrier.Bruno.fourreTout), [1, 4], "Bruno : la ligne « Tout le reste du chantier »");

// Compteur « tâches regroupées » (Validation, CR-5).
eq(res.decoupesParMois, { Alice: { "2026-10": { lignesDecoupees: 2, lignesCreees: 2 } } }, "lignes découpées par ouvrier et par mois");
eq(decoupesParOuvrierEtMois(faitsComptesRendus({ ...ENTREE, debut: "2026-10-13", fin: "2026-10-13" })),
  { Alice: { "2026-10": { lignesDecoupees: 1, lignesCreees: 1 } } }, "compteur limité à la période");

// Données absentes : « indisponible », jamais 0.
const seul = indicateursComptesRendus({ rapports: RAPPORTS, debut: "2026-10-12", fin: "2026-10-18" }).total;
for (const k of ["reaffectees", "decoupees", "heuresModifiees", "rattachees", "corriges", "horsDevis", "ecartAvancement"]) {
  ok(typeof seul[k].indisponible === "string" && seul[k].indisponible.length > 0, `${k} : indisponible sans sa source`);
}
eq(seul.lignesAjoutees, null, "lignes ajoutées : null sans pointages");
eq(indicateursComptesRendus({ rapports: [], pointages: [], historique: [], avancementsValides: {}, tachesHorsDevis: [] }).total.ecartAvancement.moyenneAbs, null,
  "aucune ligne : écart null");

// Filtre par formulaire.
const faits = faitsComptesRendus(ENTREE);
eq([agreger(faits, { version: "v1" }).envois, agreger(faits, { version: "v2" }).envois], [3, 4], "envois par formulaire");
eq(agreger(faits, { ouvrier: "Alice", version: "v1" }).lignesTravaillees, 0, "Alice n'a pas d'envoi sur l'ancien formulaire");

// Tendance.
const g = (o) => ({ rattrapage: part(0, 0), tempsRemplissage: { medianeMin: null }, ecartAvancement: { indisponible: "x" }, creees: part(0, 0), ...o });
eq(tendance("rattrapage", g({ rattrapage: part(2, 10) }), g({ rattrapage: part(1, 10) })), { courant: 20, precedent: 10, delta: 10, sens: "moins_bien" }, "plus de rattrapages : moins bien");
eq(tendance("tempsRemplissage", g({ tempsRemplissage: { medianeMin: 20 } }), g({ tempsRemplissage: { medianeMin: 30 } })).sens, "mieux", "remplissage plus court : mieux");
eq(tendance("rattrapage", g({ rattrapage: part(1, 100) }), g({ rattrapage: part(2, 100) })).sens, "stable", "1 point d'écart : stable");
eq(tendance("creees", g({ creees: part(5, 10) }), g({ creees: part(1, 10) })).sens, null, "tâches proposées : ni bien ni mal");
eq(tendance("ecartAvancement", g({}), g({})).delta, null, "indisponible : pas de tendance");
eq(tendance("inconnu", g({}), g({})), null, "indicateur inconnu");
ok(INDICATEURS_QUALITE.every(i => i.libelle && i.explication && typeof i.valeur === "function"), "chaque indicateur a un libellé, une explication et une valeur");
ok(INDICATEURS_QUALITE.every(i => i.valeur(T) === null || Number.isFinite(i.valeur(T))), "chaque indicateur se lit sur le jeu de test");

console.log(`verif-qualite-comptes-rendus : ${nbOk} contrôles OK (données fictives)`);
