# 🔵 Profero Invest — Nouveautés à tester

**Date** : 13 mai 2026
**Déploiement** : déjà en ligne sur la prod

---

## ✨ Nouvelles fonctionnalités

### 1) Liaison Client ↔ Bien (les deux sens)

**Pourquoi** : on peut maintenant tracer quel bien a été proposé à quel client, et vice-versa.

**À tester** :
- 🏢 **Stock de biens** → ouvrir un bien → carte « Clients associés » → bouton **« ＋ Proposer »** → choisir un client + statut + commentaire + lien dossier
- 👥 **CRM Clients** → ouvrir un client → carte « Biens proposés » → bouton **« ＋ Proposer »** → choisir un bien (filtré pour éviter les doublons) + statut + commentaire + lien dossier
- Les propositions s'affichent **dans les deux fiches** (symétrie)

### 2) Liaison Client ↔ Simulation (3 angles)

**⚠️ Pré-requis SQL** (à exécuter avant test si pas encore fait) :

```sql
ALTER TABLE invest_projets
  ADD COLUMN client_id UUID REFERENCES invest_clients(id) ON DELETE SET NULL;
```

**À tester** :
- 📊 **Simulateur** → topbar : sélecteur **« Client »** entre le nom du projet et les boutons d'action (devient bleu quand un client est lié)
- 📋 **Liste des projets** (page Simulateur) : chaque card affiche **« 👤 Prénom Nom »** si un client est lié, et un filtre **« 👥 Tous les clients »** permet de filtrer la liste
- 👥 **Fiche d'un client** → nouvelle carte **« 📊 Simulations »** qui liste toutes les simulations liées à ce client + bouton **« ＋ Nouvelle simulation »** qui ouvre le Simulateur **pré-rempli** avec le client
- Le bouton **« ← Projets »** dans le Simulateur **revient au CRM** si on est venu de là (sinon à la liste des projets)

### 3) Adresse + Carte Google Maps dans le Simulateur

**À tester** :
- **Simulateur** → carte « Description du Projet » → nouveau champ **« Adresse du bien »** en haut
- Une fois l'adresse renseignée, une nouvelle carte **« 🗺️ Localisation »** apparaît avec :
  - Une carte Google Maps interactive centrée sur l'adresse
  - L'adresse en clair
  - Un lien **« Ouvrir dans Maps »** qui ouvre l'adresse dans un nouvel onglet

### 4) « Lier à un bien » — Auto-remplissage depuis le Stock

**À tester** :
- **Simulateur** → champ Adresse → bouton **« 🏢 Lier »** (à droite du champ)
- Une modale liste tous les biens du Stock — choisir un bien → **auto-remplit** :
  - Adresse complète (adresse + code postal + ville)
  - Prix affiché + Prix négocié (depuis `prix_vente`)
  - Budget travaux (depuis `prix_travaux`)
- Lien actif visible sous le champ adresse avec bouton **« × »** pour délier
- L'association `bien_id` est sauvegardée → reste au reload

### 5) Fiche PDF technique enrichie

**À tester** :
- **Simulateur** → bouton **« 📄 Fiche PDF »** dans la topbar (à droite)
- Le PDF inclut désormais :
  - 📍 **Adresse** sous le titre du projet
  - 📷 **Photo principale** en grand format
  - 🗺️ **Carte Google Maps** centrée sur l'adresse

> ⚠️ À l'impression, la carte peut apparaître blanche sur Firefox (limitation navigateur). **Chrome / Edge fonctionnent correctement**.

### 6) Fiche de Présentation Client (NOUVEAU)

**À tester** :
- **Simulateur** → nouveau bouton **« ✨ Fiche client »** dans la topbar (à droite de Fiche PDF)
- Génère une vue **commerciale** prête à envoyer au client final :
  - Hero image plein cadre avec le nom du projet + adresse
  - 3 KPIs vendeurs : **Rendement net** (vert), **Cash-flow mensuel** (vert/orange), **Loyers mensuels** (or)
  - Carte Google Maps
  - Sections **Présentation / Travaux / Atouts** (les textes du projet)
  - Tableau **Composition du bien** avec total des loyers annuels + surface
  - Galerie photos (les 3 autres photos)
  - Personnalisée avec **« Présenté à : Prénom Nom »** si un client est lié
- **Cache les infos sensibles** (prix négocié, budget travaux détaillé, marges, scénarios)
- Bouton **« 🖨️ Télécharger en PDF »** intégré

---

## 🎨 Refonte design

L'ensemble de la branche **Profero Invest** a été modernisé et aligné sur le design system Profero (cohérence avec Profero Rénovation) :

- 🎨 **Accent bleu officiel #4070e8** (au lieu du cyan #4db8ff)
- 🎨 **Surfaces dark mode** harmonisées avec Profero Rénovation (`#1e2128` / `#262a32` / `#16181d`)
- 🎨 **Light mode fonctionnel** (toggle Sun/Moon dans la sidebar + dans la topbar du Simulateur)
- 🔧 **Icônes lucide** partout (plus d'emojis dans les card headers, boutons, KPIs)
- 🔧 **Sidebar alignée** sur Profero Rénovation : indicateur de sync « En ligne », profil utilisateur, boutons portail/theme/logout en icône-only
- 🔧 **Cards aérées** : avatars circulaires colorés sur CRM/Stock biens/Liste projets, modales modernisées avec icônes dans des cercles

---

## 🐛 Bugs corrigés

| Bug | Impact | Statut |
|---|---|---|
| Fond Simulateur restait sombre en light mode | Le fond ne changeait pas quand on togglait le thème depuis le Simulateur | ✅ Fixé |
| **Provisions toujours à 1500€** au reload | Les champs numériques (provisions, prix, taxes, apport, taux, durée…) n'étaient PAS auto-sauvegardés. Si on fermait le projet sans toucher à autre chose, les modifs étaient perdues | ✅ Fixé (tous les NumInput maintenant) |
| Couleurs trop sombres (style "noir vintage") | Incohérence avec Profero Rénovation | ✅ Fixé |
| Toggle dark/light manquant dans le Simulateur | Plus aucun moyen de changer de thème une fois dans le simulateur plein écran | ✅ Fixé (bouton Sun/Moon ajouté dans la topbar) |

---

## ✅ Checklist de test

À cocher en testant :

- [ ] **Aller dans Profero Invest** depuis le portail
- [ ] **Toggle dark/light** depuis la sidebar → tout doit basculer (sidebar reste sombre par design)
- [ ] **CRM Clients** → créer un client de test
- [ ] Dans le client → **« ＋ Proposer un bien »** → vérifier que la proposition s'affiche
- [ ] **Stock de biens** → créer un bien de test
- [ ] Dans le bien → **« ＋ Proposer à un client »** → vérifier que la proposition s'affiche aussi côté client
- [ ] **Simulateur** → créer un nouveau projet → sélecteur Client en haut → choisir un client
- [ ] Saisir une **adresse** dans Description → la carte Maps doit apparaître
- [ ] Cliquer **« Lier »** → choisir un bien du stock → adresse + prix doivent se remplir
- [ ] Modifier les **provisions** (ex: 2500€) → attendre 30s → fermer le projet → rouvrir → la valeur doit avoir été sauvegardée
- [ ] Toggle **dark/light** dans la topbar du Simulateur (bouton Sun/Moon) → le fond doit changer
- [ ] Cliquer **« 📄 Fiche PDF »** → vérifier l'adresse + photo + carte
- [ ] Cliquer **« ✨ Fiche client »** → vérifier la vue commerciale + bouton télécharger PDF
- [ ] Revenir à **CRM** → fiche du client → carte **« 📊 Simulations »** → la simulation créée doit apparaître
- [ ] Cliquer **« ＋ Nouvelle simulation »** depuis la fiche client → le Simulateur s'ouvre avec le client pré-rempli
- [ ] **Liste des projets** (page Simulateur) → vérifier que le nom du client s'affiche sur les cards + filtre « Tous les clients » en haut

---

## 📝 Retours attendus

Merci de remonter :

1. **Bugs** : ce qui ne marche pas, étapes pour reproduire, capture d'écran si possible
2. **Incohérences visuelles** : si quelque chose semble cassé, mal aligné, mauvais contraste
3. **UX / Améliorations** : ce qui pourrait être plus pratique, plus rapide, mieux placé
4. **Features manquantes** : ce qui aurait du sens à ajouter

---

## 🛠️ Détails techniques (pour info)

13 commits livrés sur la branche `main` pour cette session :

| Commit | Contenu |
|---|---|
| `750d98d` | BLOC A : modale « Proposer un bien » sur FicheClient (la symétrie côté FicheBien existait déjà) |
| `e2ea52e` | BLOC B : liens client ↔ simulation (sélecteur + cards + filtre + section FicheClient) |
| `b244b41` | Refonte 1/4 : Foundation (palette + CSS aligné design system) |
| `bb55e17` | Refonte 2/4 : Sidebar + topbars (lucide icons) |
| `47144e2` | Refonte 3/4 : Tableau de bord + CRM + Stock biens + Liste projets |
| `4ef4f73` | Refonte 4/4 : Simulateur + fiches + modales (emojis → lucide) |
| `6ea47ed` | Fixes après retour utilisateur (couleurs, theme toggle Simulateur) |
| `7c00084` | Cards rendues visibles (`T.card = T.surface`) |
| `6dd9c68` | Fix fond Simulateur qui restait sombre en light mode |
| `f2ce93c` | Fix bug provisions / NumInput non auto-sauvés |
| `02c7275` | Adresse + Map + Lier à un bien (étapes 1+2) |
| `8535d37` | Étape 3 : Fiche PDF enrichie (adresse + map + photo) |
| `320f53a` | Étape 4 : Fiche de Présentation Client |
