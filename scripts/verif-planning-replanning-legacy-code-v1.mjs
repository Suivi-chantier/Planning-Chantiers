import assert from "node:assert/strict";
import {
  codeOuvrageReplanningV1,
  preparerSimulationReplanningV1,
} from "../src/Renovation/planningReplanningAdapterV1.js";

const resources = [
  { id:"ST", nom:"Steven", nom_planning:"Steven", kind:"personne", actif:true, capacite_facteur:1 },
  { id:"M", nom:"Mohamed", nom_planning:"Mohamed", kind:"personne", actif:true, capacite_facteur:1 },
];
const groupesTypes = [{ id:"gt_reseau_elec", nom:"Passage réseau élec", ordre:70, equipe_id:"EQ-E", ouvriers_prio:["Steven","Mohamed"] }];
const equipes = [{ id:"EQ-E", nom:"Réseaux Électrique", responsable:"Steven", membres:[{ouvrier:"Mohamed"}], externe:false }];

// 1. Le champ structuré gagne toujours : le fallback libellé n'écrase jamais une donnée présente.
assert.equal(codeOuvrageReplanningV1({ code_ouvrage:"E-006", libelle:"EG-001 : autre" }), "E-006");

// 2. Un code legacy n'est récupéré qu'au tout début du libellé et dans un format strict.
assert.equal(codeOuvrageReplanningV1({ libelle:"EG-001 :Fourniture et mise en place d'une goulotte" }), "EG-001");
assert.equal(codeOuvrageReplanningV1({ libelle:"  EG-002 : Fourniture gaine anti-UV" }), "EG-002");
assert.equal(codeOuvrageReplanningV1({ libelle:"Fourniture EG-001 goulotte" }), null);
assert.equal(codeOuvrageReplanningV1({ libelle:"CHANTIER-ABC goulotte" }), null);

// 3. Reproduction Chalonnes : sans code_ouvrage/lot/groupe, le préfixe EG-001 du
// libellé permet à la règle électrique EXISTANTE de classer « goulotte » en
// réseau élec avec confiance certaine. Aucune donnée source n'est mutée.
{
  const ph = {
    id:"PH-CHAL", chantier_id:"C1", updated_at:"2026-08-29T12:00:00Z",
    ouvrages:[{
      id:"O1",
      code_ouvrage:null,
      lot_id:null,
      libelle:"EG-001 :Fourniture et mise en place d'une goulotte de distribution",
      taches:[{
        id:"T1", nom:"Mise en place de la goulotte", heures_vendues:6, heures_estimees:6,
        avancement:0, chrono_groupe_id:null, chrono_ordre:0, ouvriers:[],
      }],
    }],
    plan_travaux:{ meta:{ chrono_groupes:[] } },
  };
  const before = structuredClone(ph);
  const out = preparerSimulationReplanningV1({
    phasages:[ph], chantiers:[{ id:"C1", nom:"CHALONNES ENEDIS", statut:"en_cours" }],
    cellules:[], ressources:resources, evenementsRessources:[], contraintes:[],
    groupesTypes, equipes, startDate:"2026-08-31", horizonDays:42,
  });
  const t = out.engineInput.travaux.find(x => x.tache_id === "T1");
  assert.ok(t);
  assert.equal(t.groupe_type_id, "gt_reseau_elec");
  assert.equal(t.provenance.groupe_type, "inference_certaine");
  assert.deepEqual(t.candidate_resource_ids.sort(), ["M","ST"]);
  assert.equal(out.audit.codes_ouvrages_legacy_recuperes_depuis_libelle, 1);
  assert.deepEqual(ph, before, "le phasage source ne doit jamais être muté");
}

// 4. Même contrat pour EG-002 « gaine anti-UV ».
{
  const ph = {
    id:"PH-CHAL2", chantier_id:"C2",
    ouvrages:[{
      id:"O2", libelle:"EG-002 :Fourniture et passage gaine anti-UV pour protection de câbles D=63.",
      taches:[{ id:"T2", nom:"Passage gaine anti-UV", heures_vendues:2, heures_estimees:2, avancement:0, chrono_groupe_id:null, chrono_ordre:0, ouvriers:[] }],
    }],
    plan_travaux:{ meta:{ chrono_groupes:[] } },
  };
  const out = preparerSimulationReplanningV1({
    phasages:[ph], chantiers:[{ id:"C2", statut:"en_cours" }], cellules:[],
    ressources:resources, evenementsRessources:[], contraintes:[], groupesTypes, equipes,
    startDate:"2026-08-31", horizonDays:42,
  });
  assert.equal(out.engineInput.travaux[0]?.groupe_type_id, "gt_reseau_elec");
  assert.equal(out.travaux_exclus.some(x => x.tache_id === "T2"), false);
}

console.log("OK — planning replanning legacy ouvrage code V1: 4 scénarios");