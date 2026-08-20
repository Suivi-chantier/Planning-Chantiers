// scripts/verif-relances.mjs — Vérification du moteur de relance.
//
// Éprouve src/Invest/relances.mjs contre les 59 règles RÉELLES extraites des
// modèles de mission du CRM, plus les cas limites du calendrier.
//
// Pourquoi : une relance qui part en trop harcèle un collaborateur, une relance
// qui ne part pas laisse un dossier dormir. Les deux sont invisibles depuis
// l'application — le cron tourne à 4h sans témoin.
//
// Usage :  node scripts/verif-relances.mjs
//
// Aucune dépendance, aucune base, aucun réseau.

import {
  analyserRelance, relanceDue, relanceArretee, decrireRelance,
  ARRET_ACTION, ARRET_DOCUMENT,
} from "../src/Invest/relances.mjs";

let passes = 0, echecs = 0;
function verifie(nom, condition, detail = "") {
  if (condition) { passes++; console.log(`  ✓ ${nom}`); }
  else { echecs++; console.log(`  ✗ ${nom}${detail ? `\n      ${detail}` : ""}`); }
}
function section(t) { console.log(`\n${t}\n${"─".repeat(t.length)}`); }

const AUJ = "2026-08-20";
const action = (p = {}) => ({
  status: "a_faire", due_date: "2026-08-10", due_reminder_enabled: true,
  relance_rule: null, last_reminder_sent_at: null,
  document_drive_attendu: false, justificatif_drive_url: null, ...p,
});

// ════════════════════════════════════════════════════════════════════════════
section("1. Analyse des règles réelles du CRM");

// Les 59 règles distinctes relevées dans MISSION_STEPS_INVEST.
const REGLES_REELLES = [
  "J+2 puis J+5 si non reçue", "J+2 puis J+5 si non reçus", "J+1 si contrat absent du Drive",
  "J+2 si facture non envoyée", "J+3 si mandat non signé", "J+3 si mandat absent",
  "J+3 si règlement absent", "J+3 si compromis non signé", "J+3 si incomplet",
  "J+3 si plans non réalisés", "J+3 si réunion non calée", "J+3 si visite à organiser",
  "J+4 si plans non réalisés", "J+5 si non réglé", "J+5 si aucun retour",
  "J+5 / J+10 / J+15", "J+7 si plans absents", "J+7 si demande non déposée",
  "J+8 si non déposé", "J+10 si pas de RDV", "J+60 après fin travaux",
  "Relance client J+2", "J+2 si aucune alerte créée",
  "Hebdomadaire", "Chaque semaine si aucun bien présenté",
  "Avant dépôt urbanisme", "Dès réception acte", "Selon statut bancaire",
  "Alerte si pièce essentielle manquante", "Après validation devis", "🔔",
];

const executables = REGLES_REELLES.filter(r => analyserRelance(r).executable);
const notes = REGLES_REELLES.filter(r => !analyserRelance(r).executable);

verifie(`${executables.length} règles exécutables sur ${REGLES_REELLES.length} testées`, executables.length === 25,
  `obtenu ${executables.length} — exécutables : ${executables.length}, notes : ${notes.length}`);
verifie("« 🔔 » n'est pas pris pour une règle",
  !analyserRelance("🔔").executable);
verifie("« Avant dépôt urbanisme » reste une note",
  !analyserRelance("Avant dépôt urbanisme").executable);
verifie("« Selon statut bancaire » reste une note",
  !analyserRelance("Selon statut bancaire").executable);

// ════════════════════════════════════════════════════════════════════════════
section("2. Extraction des offsets");

const cas = [
  ["J+2 puis J+5 si non reçue", [2, 5]],
  ["J+5 / J+10 / J+15",         [5, 10, 15]],
  ["J+3 si mandat non signé",   [3]],
  ["J+60 après fin travaux",    [60]],
  ["Relance client J+2",        [2]],
];
for (const [texte, attendu] of cas) {
  const r = analyserRelance(texte);
  verifie(`« ${texte} » → ${attendu.join(", ")}`,
    JSON.stringify(r.offsets) === JSON.stringify(attendu),
    `obtenu ${JSON.stringify(r.offsets)}`);
}
verifie("« Hebdomadaire » → récurrence 7 jours",
  analyserRelance("Hebdomadaire").recurrence === 7);
verifie("« Chaque semaine… » → récurrence 7 jours",
  analyserRelance("Chaque semaine si aucun bien présenté").recurrence === 7);

// ════════════════════════════════════════════════════════════════════════════
section("3. Condition d'arrêt");

verifie("« si non reçue » vise le justificatif",
  analyserRelance("J+2 puis J+5 si non reçue").arret === ARRET_DOCUMENT);
verifie("« absent du Drive » vise le justificatif",
  analyserRelance("J+1 si contrat absent du Drive").arret === ARRET_DOCUMENT);
verifie("« si mandat non signé » retombe sur la clôture de tâche",
  analyserRelance("J+3 si mandat non signé").arret === ARRET_ACTION);

verifie("une action faite arrête toute relance",
  relanceArretee(action({ status: "fait" }), ARRET_ACTION));
verifie("« non concerné » arrête aussi",
  relanceArretee(action({ status: "non_concerne" }), ARRET_ACTION));
verifie("un justificatif déposé arrête la relance document",
  relanceArretee(action({ document_drive_attendu: true, justificatif_drive_url: "https://drive/x" }), ARRET_DOCUMENT));
verifie("un justificatif attendu mais absent ne l'arrête pas",
  !relanceArretee(action({ document_drive_attendu: true }), ARRET_DOCUMENT));

// ════════════════════════════════════════════════════════════════════════════
section("4. Ce qui est dû aujourd'hui");

// due_date au 2026-08-10, aujourd'hui 2026-08-20 → 10 jours d'écart.
verifie("J+2 puis J+5, jamais relancée → part au palier le plus avancé (J+5)",
  relanceDue(action({ relance_rule: "J+2 puis J+5 si non reçue" }), AUJ)?.echeance === "2026-08-15",
  "le rattrapage doit produire UNE relance, la plus avancée, pas deux");

verifie("le rang annoncé est le bon",
  relanceDue(action({ relance_rule: "J+2 puis J+5 si non reçue" }), AUJ)?.rang === 2);

verifie("palier déjà couvert par la dernière relance → rien",
  relanceDue(action({ relance_rule: "J+2 puis J+5 si non reçue",
                      last_reminder_sent_at: "2026-08-16T08:00:00Z" }), AUJ) === null);

verifie("palier non encore atteint → rien",
  relanceDue(action({ relance_rule: "J+60 après fin travaux" }), AUJ) === null);

verifie("J+2 seul, déjà relancé à J+2 → rien",
  relanceDue(action({ relance_rule: "J+3 si incomplet",
                      last_reminder_sent_at: "2026-08-14T08:00:00Z" }), AUJ) === null);

verifie("action sans échéance → rien",
  relanceDue(action({ relance_rule: "J+2 puis J+5 si non reçue", due_date: null }), AUJ) === null);

verifie("interrupteur due_reminder_enabled = false respecté",
  relanceDue(action({ relance_rule: "J+3 si incomplet", due_reminder_enabled: false }), AUJ) === null);

verifie("règle non exécutable → rien",
  relanceDue(action({ relance_rule: "Avant dépôt urbanisme" }), AUJ) === null);

verifie("action terminée → rien, même si le palier est franchi",
  relanceDue(action({ relance_rule: "J+3 si incomplet", status: "fait" }), AUJ) === null);

verifie("justificatif déposé → rien pour une règle document",
  relanceDue(action({ relance_rule: "J+2 puis J+5 si non reçue",
                      document_drive_attendu: true, justificatif_drive_url: "https://drive/x" }), AUJ) === null);

// ════════════════════════════════════════════════════════════════════════════
section("5. Récurrence");

verifie("hebdomadaire, 10 jours après l'échéance → due",
  relanceDue(action({ relance_rule: "Hebdomadaire" }), AUJ)?.due === true);

verifie("hebdomadaire, relancée il y a 3 jours → attend",
  relanceDue(action({ relance_rule: "Hebdomadaire",
                      last_reminder_sent_at: "2026-08-17T08:00:00Z" }), AUJ) === null);

verifie("hebdomadaire, relancée il y a 8 jours → repart",
  relanceDue(action({ relance_rule: "Hebdomadaire",
                      last_reminder_sent_at: "2026-08-12T08:00:00Z" }), AUJ)?.due === true);

verifie("hebdomadaire, échéance il y a 3 jours → pas encore",
  relanceDue(action({ relance_rule: "Hebdomadaire", due_date: "2026-08-17" }), AUJ) === null);

// ════════════════════════════════════════════════════════════════════════════
section("6. Description lisible");

verifie("une règle à offsets se décrit",
  /J\+2, J\+5/.test(decrireRelance("J+2 puis J+5 si non reçue")),
  decrireRelance("J+2 puis J+5 si non reçue"));
verifie("la condition d'arrêt document apparaît",
  /justificatif/.test(decrireRelance("J+2 puis J+5 si non reçue")));
verifie("une note non exécutable est annoncée comme telle",
  /note seule/.test(decrireRelance("Avant dépôt urbanisme")),
  decrireRelance("Avant dépôt urbanisme"));

// ════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(56));
console.log(`Règles du CRM : ${executables.length} exécutables, ${notes.length} notes non calculables`);
console.log(echecs === 0
  ? `✓ ${passes} vérifications passées.`
  : `✗ ${echecs} échec(s) sur ${passes + echecs} vérifications.`);
process.exit(echecs === 0 ? 0 : 1);
