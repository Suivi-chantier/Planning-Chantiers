# Comptes sans email (identifiant + mot de passe)

*Livré le 27/07/2026.*

## Ce que ça fait

- **Admin → Collaborateurs → Inviter un collaborateur** propose désormais deux modes :
  - **Avec email (invitation)** : flux historique inchangé (email d'invitation Supabase).
  - **Sans email (identifiant + mdp)** : l'admin choisit un identifiant (ex. `kevin`) et un
    mot de passe initial. Le compte est créé immédiatement, aucun email n'est envoyé.
    L'admin communique identifiant + mot de passe au collaborateur.
- **Connexion** : le champ de la page de connexion accepte un email **ou** un identifiant.
  Une saisie sans `@` est convertie en email synthétique `identifiant@profero.local`
  (Supabase Auth exige un email — ce domaine n'est pas routable, aucun mail ne peut y partir).
- **Lier un email plus tard** : dans la liste des collaborateurs, les comptes sans email
  portent un badge « Sans email » et un bouton **Lier un email**. Une fois l'email lié :
  - la connexion se fait avec l'email (même mot de passe) — l'identifiant ne fonctionne plus ;
  - la réinitialisation du mot de passe par email devient possible.
- **Mot de passe oublié (compte sans email)** : le bouton « Nouveau MDP » permet à l'admin
  de définir directement un nouveau mot de passe (pas d'email de reset possible).
- Les envois de mails automatiques (encours fournisseurs, récap commandes, onglet Mail encours)
  excluent les adresses `@profero.local`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `supabase/functions/admin-users-local/index.ts` | Edge Function : `create_local`, `set_email`, `set_password` (réservée aux admins actifs) |
| `src/constants.js` | Domaine `profero.local`, helpers identifiant ↔ email synthétique |
| `src/Renovation/Admin.jsx` | Formulaire double mode, badge/actions comptes sans email, modals |
| `src/App.jsx` | Connexion par email ou identifiant |
| `api/cron-encours-fournisseurs.js`, `api/cron-recap-commandes.js` | Exclusion des adresses synthétiques |

## ⚠️ À faire une fois : déployer l'Edge Function

La fonction `admin-users-local` doit être déployée sur Supabase (la fonction `admin-users`
existante n'est pas touchée). Deux options :

**Option A — Dashboard** : Supabase → Edge Functions → *Deploy a new function* (éditeur) →
nom exact `admin-users-local` → coller le contenu de
`supabase/functions/admin-users-local/index.ts` → Deploy. Laisser « Verify JWT » activé.

**Option B — CLI** :
```
npx supabase login
npx supabase functions deploy admin-users-local --project-ref <ref-du-projet>
```

Aucun secret à configurer : la fonction utilise `SUPABASE_URL` et
`SUPABASE_SERVICE_ROLE_KEY`, injectés automatiquement.

Tant qu'elle n'est pas déployée, la création « Sans email », « Lier un email » et
« Nouveau MDP » renverront une erreur ; tout le reste de l'app fonctionne normalement.

## Notes techniques

- Le lien compte Auth ↔ profil `utilisateurs` reste l'email : l'action `set_email` met à
  jour **les deux** (avec retour arrière côté Auth si la mise à jour du profil échoue).
- `set_email` refuse le domaine réservé `profero.local` et les adresses déjà utilisées
  (Auth et `utilisateurs`).
- Identifiants : 2–30 caractères, minuscules/chiffres, `. _ -` autorisés à l'intérieur.
- Le rappel Google Agenda des ouvriers utilise `planning_config.ouvrier_emails`
  (prénom → email), indépendant de l'auth : rien ne change de ce côté.
