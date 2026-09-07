// api/_ia/invest/moteur.js — Pont vers src/Invest/tableauBord.mjs.
//
// Pourquoi passer par le moteur du tableau de bord
// ────────────────────────────────────────────────
// « Quels dossiers sont bloqués ? », « quelles échéances sous 7 jours ? »,
// « quelles sont mes priorités ? » sont déjà répondues, en un seul endroit,
// par consolidateData(). Ce module produit des dossiers typés avec leurs
// alertes codées (no_next_action, late_action, blocked_*, stale_red…), leur
// catégorie (decision / watch / delegated) et leur responsable.
//
// Réécrire ces règles ici garantirait qu'elles divergent de l'écran. Le
// précédent est documenté dans le dépôt : le tableau de bord interrogeait
// autrefois huit noms de tables de prospects, dont sept n'existaient pas, et
// personne ne le voyait. On lit donc le moteur, on ne le réinvente pas.
//
// Extension .mjs : le module est en ESM et api/ est en CommonJS, d'où
// `await import()`. C'est exactement ce que fait déjà
// api/_cron/cron-invest-tableau-bord.js.
//
// ⚠ EXCLUSION DES PROSPECTS
// REQUETES_TABLEAU_BORD contient une requête sur invest_prospects. Elle est
// retirée ici, et consolidateData() reçoit `crmProspects: []`. Deux effets :
// aucune donnée de prospect n'atteint le modèle, et aucun dossier de type
// « prospect » n'apparaît dans les réponses. C'est la traduction en code de
// la règle invest_prospects = NO TOUCH pour la V1.
//
// La requête `routineRows` est également retirée : elle lit
// invest_morning_routine_items, réservée à la page dashboard, et ne sert qu'à
// la colonne « traité aujourd'hui » que la V1 n'expose pas.

const { table } = require("./donnees");

// Clés de REQUETES_TABLEAU_BORD que le Copilote n'exécute pas.
const REQUETES_EXCLUES = new Set(["crmProspects", "routineRows"]);

let _moteur = null;

async function moteur() {
  if (!_moteur) {
    _moteur = await import("../../../src/Invest/tableauBord.mjs");
  }
  return _moteur;
}

// Adaptateur minimal : les requêtes de tableauBord.mjs appellent sb.from(...),
// on leur passe donc un objet qui expose `from` en le faisant passer par la
// liste blanche de donnees.js. Une requête qui viserait une table interdite
// lèverait ici, et non silencieusement plus loin.
const sbFiltre = { from: (nom) => table(nom) };

// Charge et consolide. `profil` sert au moteur à décider ce qui est « à moi »
// et ce qui est « délégué » : il vient du JWT, jamais du modèle.
async function chargerDossiers({ profil, jour = null }) {
  const m = await moteur();
  const avertissements = [];

  const requetes = m.REQUETES_TABLEAU_BORD.filter((r) => !REQUETES_EXCLUES.has(r.cle));
  const jourEffectif = jour || m.todayIso();

  const resultats = await Promise.all(
    requetes.map(async (r) => {
      try {
        const { data, error } = await r.requete(sbFiltre, { jour: jourEffectif });
        if (error) {
          avertissements.push(`${r.label} : ${error.message}`);
          return [r.cle, []];
        }
        const lignes = data || [];
        return [r.cle, r.apres ? r.apres(lignes) : lignes];
      } catch (e) {
        avertissements.push(`${r.label} : ${e.message}`);
        return [r.cle, []];
      }
    })
  );

  const brut = Object.fromEntries(resultats);

  const consolide = m.consolidateData({
    clients: brut.clients || [],
    crmProspects: [],                    // ← exclusion invest_prospects
    biens: brut.biens || [],
    propositions: brut.propositions || [],
    planning: brut.planning || [],
    actions: brut.actions || [],
    profil,
    pilote: (profil && profil.nom) || "",
  });

  return { moteur: m, consolide, avertissements, jour: jourEffectif };
}

// Forme commune de restitution d'un dossier vers le modèle. On ne transmet
// JAMAIS `raw` : il contient la ligne entière de invest_clients ou
// invest_biens, avec ses jsonb (strategie_data, visite_data) qui feraient
// exploser le contexte sans rien apporter.
function exposerDossier(d, m) {
  return {
    type: d.type,                                  // client | bien | team
    id: d.id || null,
    libelle: d.label || "",
    sous_titre: d.subtitle || "",
    etape: (d.meta && d.meta.step) || null,
    statut: (d.meta && d.meta.status) || null,
    urgence: d.level || "",                        // danger | warning | info | success
    categorie: d.category || "",                   // decision | watch | delegated
    prochaine_action: d.next_action || "",
    echeance: d.due_date || null,
    responsable: d.responsable || "",
    alerte_principale: d.primaryAlert || "",
    alertes: (d.alerts || []).map((a) => ({
      code: a.code, libelle: a.label, niveau: a.level, echeance: a.due_date || null,
    })),
    lien: lienDossier(d),
  };
}

// Le Copilote ne fabrique pas d'URL : Profero Invest n'a pas de routeur. Il
// renvoie les paramètres du mécanisme de liens profonds déjà en place dans
// PageInvest.jsx, que le front traduit en appel à naviguer().
function lienDossier(d) {
  if (!d || !d.id) return null;
  if (d.type === "client") return { libelle: "Ouvrir le dossier", params: { client_id: d.id } };
  if (d.type === "bien") return { libelle: "Ouvrir le bien", params: { invest_bien: d.id } };
  return null;
}

module.exports = {
  chargerDossiers,
  exposerDossier,
  lienDossier,
  REQUETES_EXCLUES,
};
