// Vérification CR-2 : libellés personnalisés du phasage (données fictives).
// Le nom personnalisé est enregistré À CÔTÉ du libellé devis : les documents
// client / l'export gardent le libellé devis, l'application affiche le nom
// personnalisé, et les correspondances de noms reconnaissent les deux.
import assert from "node:assert/strict";
import {
  libelleOuvrage, libelleOuvrageDevis, nomTache, nomTacheDevis, aLibellePerso, aNomPerso,
  textesTache, tacheCorrespond, ouvrageCorrespond, patchLibelleOuvrage, patchNomTache,
} from "../src/Renovation/libellesPhasageV1.mjs";
import { normaliserChantier } from "../src/Renovation/operationExportModele.mjs";
import { tachesProbablesV2 } from "../src/Renovation/horsDevisV2.mjs";

let nbOk = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); nbOk++; };
const ok = (v, m) => { assert.ok(v, m); nbOk++; };

const DEVIS_O = "Isolation laine minérale de 45 cloison hydro, compris pare-vapeur";
const DEVIS_T = "Pose isolant laine minérale 45 mm";
const ouvrage = (patch = {}) => ({
  id: "o1", libelle: DEVIS_O, lot_id: "isolation", prix_ht: 1200, quantite: 10, unite: "m2",
  taches: [{ id: "t1", nom: DEVIS_T, avancement: 20, heures_estimees: 6 }, { id: "t2", nom: "Bandes", avancement: 0, heures_estimees: 3 }],
  ...patch,
});

// 1. Sans nom personnalisé : tout reste comme avant.
{
  const o = ouvrage();
  eq([libelleOuvrage(o), nomTache(o.taches[0])], [DEVIS_O, DEVIS_T], "sans nom personnalisé : libellés devis affichés");
  eq([aLibellePerso(o), aNomPerso(o.taches[0])], [false, false], "sans nom personnalisé : rien de signalé");
}

// 2. Renommer : patch à côté du libellé devis, jamais à sa place.
{
  const o = ouvrage();
  const po = patchLibelleOuvrage(o, "  Isolation cloison SDB ");
  const pt = patchNomTache(o.taches[0], "Isolant SDB");
  eq(po, { libelle_perso: "Isolation cloison SDB" }, "renommer un ouvrage : seul libelle_perso change");
  eq(pt, { nom_perso: "Isolant SDB" }, "renommer une tâche : seul nom_perso change");
  ok(!("libelle" in po) && !("nom" in pt), "le libellé devis n'est jamais dans le patch");
  eq(patchLibelleOuvrage(o, ""), { libelle_perso: null }, "nom vide : retour au libellé devis");
  eq(patchNomTache(o.taches[0], DEVIS_T), { nom_perso: null }, "nom identique au devis : pas de nom personnalisé");
}

// 3. Affichage interne = nom personnalisé ; libellé devis toujours disponible.
const renomme = ouvrage({ libelle_perso: "Isolation cloison SDB" });
renomme.taches[0].nom_perso = "Isolant SDB";
{
  eq([libelleOuvrage(renomme), libelleOuvrageDevis(renomme)], ["Isolation cloison SDB", DEVIS_O], "ouvrage renommé : affiché perso, devis conservé");
  eq([nomTache(renomme.taches[0]), nomTacheDevis(renomme.taches[0])], ["Isolant SDB", DEVIS_T], "tâche renommée : affichée perso, devis conservé");
  eq(nomTache(renomme.taches[1]), "Bandes", "tâche non renommée : libellé devis");
  eq(textesTache(renomme.taches[0]), ["Isolant SDB", DEVIS_T], "recherche : les deux libellés");
  ok(tacheCorrespond(renomme.taches[0], "isolant sdb") && tacheCorrespond(renomme.taches[0], "laine minerale"), "recherche : par nom personnalisé ou libellé devis, sans accents");
  ok(ouvrageCorrespond(renomme, "cloison sdb") && ouvrageCorrespond(renomme, "pare-vapeur"), "recherche d'ouvrage : les deux libellés");
  ok(!tacheCorrespond(renomme.taches[1], "isolant"), "recherche : pas de faux positif");
}

// 4. Export (documents hors application) : le libellé DEVIS, pas le nom personnalisé.
{
  const exp = normaliserChantier({
    chantier: { id: "c1", nom: "Chantier test", statut: "en_cours" },
    phasage: { chantier_id: "c1", ouvrages: [renomme], plan_travaux: {} },
    pointages: [], finance: null, adresse: null, statutLabel: "En cours",
    lots: [], tauxHoraires: {}, materiauxById: {}, ratiosById: {}, equipeParGroupeType: {},
    sources: {}, aujourdhui: "2026-10-24",
  });
  const o = (exp.ouvrages || exp.lots?.flatMap(l => l.ouvrages) || []).find(x => x.id === "o1")
    || JSON.parse(JSON.stringify(exp)).ouvrages?.[0];
  const texte = JSON.stringify(exp);
  ok(texte.includes(DEVIS_O), "export : le libellé devis de l'ouvrage renommé y figure");
  ok(!texte.includes("Isolation cloison SDB"), "export : le nom personnalisé de l'ouvrage n'en sort pas");
  ok(texte.includes(DEVIS_T) && !texte.includes("Isolant SDB"), "export : la tâche garde son libellé devis");
  ok(o === undefined || o.libelle === DEVIS_O, "export : champ libelle = libellé devis");
}

// 5. Tâches hors devis, cas A : la correspondance reconnaît le nom personnalisé.
{
  const props = tachesProbablesV2({ nom: "isolant sdb", ouvrages: [renomme] });
  eq(props[0]?.tache_id, "t1", "cas A : l'ouvrier écrit le nom personnalisé → tâche retrouvée");
  eq(props[0]?.nom, "Isolant SDB", "cas A : la proposition affiche le nom personnalisé");
  const props2 = tachesProbablesV2({ nom: "pose isolant laine minerale", ouvrages: [renomme] });
  eq(props2[0]?.tache_id, "t1", "cas A : l'ouvrier écrit le libellé devis → tâche retrouvée aussi");
}

console.log(`verif-libelles-phasage : ${nbOk} contrôles OK (données fictives)`);
