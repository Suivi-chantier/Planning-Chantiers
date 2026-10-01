# Dossier Invest — Tranche 2d : Projet & situation (Chantier 1.1)

État : **développée en local, non poussée, migration non appliquée** (30/09/2026).

Séparation : Situation patrimoniale (2c) = faits durables du foyer ;
**Projet & situation (2d) = contexte, situation et objectifs du dossier** ;
Analyse et Stratégie = futures tranches (calculs, conclusions, recommandations).

## Modèle

`invest_dossiers` : `questionnaire_version`, `questionnaire_data` (une entrée par
question : valeur, source client/profero/reprise, saisie et modification,
vérification, vérifié par, vérifié le), `questionnaire_statut`
(brouillon / soumis / a_verifier / valide), dates de soumission et validation,
collaborateur ayant validé. Catalogue, sections et conditions :
`src/Invest/dossiers/questionnaireDossier.mjs` (version 1).

Règles en base : dossier clos = lecture seule ; métadonnées toujours posées par
la base ; modifier une réponse vérifiée la repasse non vérifiée ; vérification
et validation réservées aux collaborateurs ; validation impossible avec une
réponse « à corriger » ; correction après validation → « à vérifier » ; aucune
réponse supprimée (une réponse masquée est conservée). Journal :
`questionnaire_modifie` (par section, lisible), `questionnaire_soumis`,
`questionnaire_valide`. Gestes : fonctions `invest_questionnaire_enregistrer`,
`_verifier`, `_statut` (droits de l'appelant, RLS).

Suites 2c incluses : perte de vérification dite dans le résumé
`collecte_modification` ; désarchivage réservé à un collaborateur.

Aucune reprise : `invest_clients.strategie_data` et
`invest_structuration_patrimoniale` intacts ; aucun défaut historique repris.

## Application

`npx supabase db query --linked -f supabase/migrations/20260930235000_invest_questionnaire_2d.sql`
puis `npx supabase migration repair --status applied 20260930235000 --linked`,
**avant** la fusion du front. Jamais `db push`.
