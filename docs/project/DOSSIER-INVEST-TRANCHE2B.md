# Dossier Invest — Tranche 2b : bascule opérationnelle (Chantier 1.1)

État : **développée en local, non poussée** (30/09/2026). Aucune migration.

## Source de vérité

`src/Invest/dossiers/pilotage.mjs` (pur) : dossier non clos → toutes les étapes
actives, étape principale (`etapeCourante`), balle, prochaine action, échéance,
blocage, tâches du dossier, alertes, « action du jour ». Utilisé par :

- le CRM (liste, kanban, planning, frise sur les 11 étapes, statistiques) :
  projection `projeterClient` ;
- le tableau de bord / Morning Routine et le mail du matin : `tableauBord.mjs`
  (`buildClientDossier`, `consolidateData`, bloc « Suivi des Dossiers Invest »).

Règles :

- `invest_clients.etape`, `etape_num`, `prochaine_action`, `date_prochaine_action`
  ne sont plus lus pour piloter un client. Exception : un **Prospect sans
  dossier** garde sa relance historique, faute de dossier pour la porter.
- Prochaine action / échéance d'une étape terminée ou non applicable :
  conservées en base (historique), jamais lues comme une action actuelle.
- Plusieurs étapes actives : l'étape affichée est la principale ; l'action du
  jour vise l'étape où agir (échéance dépassée → blocage → balle Profero avec
  action → principale), avec l'échéance de CETTE étape.
- Dossiers non chargés = « avancement indisponible », jamais « sans dossier ».

## Écritures

Frise CRM (Maj, Valider, J+2, Action), décision de routine : prochaine action
et échéance de l'étape du dossier (journalisées). Tâche créée depuis la
routine : `dossier_id` + `etape` + `step_key`. Plus aucune écriture de
`invest_clients.etape` (CRM, Prospection, Structuration).

## Vérification

`node scripts/verif-invest-pilotage-2b.mjs`, `node scripts/verif-tableau-bord.mjs`,
`node scripts/verif-invest-dossiers-t1.mjs` (workflow verify-invest-dossiers-t1).
