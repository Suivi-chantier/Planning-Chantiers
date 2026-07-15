# Spec — Trajets & heures indirectes : correction V2 + vue consolidée

Trois corrections à faire dans la même passe :

- **Partie 1** — Réintégrer trajets + indirect dans le coût MO / la marge de `PhasageV2.jsx` (PRIORITAIRE : fiabilise la marge).
- **Partie 2** — Ajouter les cartes « Trajets » et « Heures indirectes » dans `PhasageV2.jsx` (consultation par chantier).
- **Partie 3** — Ajouter un onglet consolidé « Trajets » dans `DashboardAnalyse.jsx` (pilotage tous chantiers / tous ouvriers).

## Contexte commun

Le compte rendu ouvrier (`RapportMobile.jsx`) collecte un temps de trajet ; la validation
(`Validation.jsx`) crée pour ce trajet un pointage `type_pointage = "indirect"` avec
`motif_indirect = "Trajet"` (ou `"Trajet (1/N)"` après lissage multi-chantiers). Les autres
heures indirectes (Intempéries, Nettoyage, SAV, Préparation…) sont stockées de la même
façon (`type_pointage = "indirect"`, `motif_indirect` libre).

**Ne pas modifier :** `RapportMobile.jsx`, `Validation.jsx`, le schéma `pointages`, ni le
lissage `Trajet (1/N)`. Le pipeline de données est correct — seuls l'affichage et
l'agrégation sont en cause. La donnée trajet n'apparaît qu'**après validation** d'un CR.

Définition partagée dans tout le document :
- **pointage trajet** = `type_pointage === "indirect"` ET `/trajet/i.test(motif_indirect)`
- **pointage indirect (hors trajet)** = `type_pointage === "indirect"` ET NON trajet
- **coût figé** d'un pointage = `heures × taux_horaire` (le taux est figé sur la ligne, ne
  jamais recalculer via jointure).

---

# PARTIE 1 — Coût MO / marge V2 (PRIORITAIRE)

## Fichier : `src/Renovation/PhasageV2.jsx`

Le state `pointages` (tout le registre du chantier) est déjà chargé via
`fetchPointages({ chantier_id: chantierId })`, et `sumLibreEtIndirect` est déjà exporté par
`src/pointages.js`.

**Problème :** `coutMOChantier` (per-ouvrage) et `heuresReellesChantier` (per-tâche) ne
comptent QUE les pointages rattachés à une tâche d'ouvrage. Les pointages indirects (trajet
compris) et libres (`tache_id null`) ne sont jamais additionnés → la marge V2 est
**surestimée** et ne coïncide pas avec `DashboardAnalyse` ni `PageChantiers`.

### 1a. Import
Ajouter `sumLibreEtIndirect` à l'import existant depuis `../pointages` (qui contient déjà
`fetchPointages`, `indexPointagesParTache`).

### 1b. Extras
```js
// Heures + coût des pointages hors tâches d'ouvrage : "libres" (tache_id null,
// type "tache") et "indirects" (trajet, intempéries…). coutIndirect INCLUT le trajet.
const extras = useMemo(() => sumLibreEtIndirect(pointages), [pointages]);
```

### 1c. Totaux chantier (laisser coutMOChantier / heuresReellesChantier inchangés)
```js
// Aligné sur DashboardAnalyse (coutMOChantierV2 + coutLibre + coutIndirect).
const coutMOTotalChantier =
  coutMOChantier + extras.coutLibre + extras.coutIndirect;
const heuresReellesTotalChantier =
  heuresReellesChantier + extras.heuresLibre + extras.heuresIndirect;
```
> Pas de double comptage : `coutMOChantier` ne somme que les pointages à `tache_id` d'un
> ouvrage ; `extras` ne somme que les `type "indirect"` ou `tache_id null`. Ensembles disjoints.

### 1d. Marge + KPI
- Marge : `const margeChantier = prixHTChantier - coutMOTotalChantier - coutMatChantier - fgChantier;`
- Carte KPI **« Coût MO »** : `value={fmtEur(coutMOTotalChantier)}`,
  `accent={coutMOTotalChantier > prixHTChantier && prixHTChantier > 0 ? "#e15a5a" : null}`,
  `sub="Tâches + trajets + indirect"`.
- Carte KPI **« Heures totales »** : utiliser `heuresReellesTotalChantier` pour la valeur ET
  le calcul du `% consommées`.

---

# PARTIE 2 — Cartes « Trajets » et « Heures indirectes » en V2

## Fichier : `src/Renovation/PhasageV2.jsx`

Cartes purement informatives (« dont X en trajet »). Elles **n'ajoutent rien** au total : le
trajet et l'indirect sont déjà comptés dans `coutMOTotalChantier`.

### 2a. Stats d'affichage
```js
const trajetStats = useMemo(() => {
  let heures = 0, cout = 0;
  pointages.forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (!/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    heures += h; cout += h * (parseFloat(p.taux_horaire) || 0);
  });
  return { heures, cout };
}, [pointages]);

const indirectStats = useMemo(() => {   // indirect HORS trajet
  let heures = 0, cout = 0;
  pointages.forEach(p => {
    if (p.type_pointage !== "indirect") return;
    if (/trajet/i.test(p.motif_indirect || "")) return;
    const h = parseFloat(p.heures) || 0;
    heures += h; cout += h * (parseFloat(p.taux_horaire) || 0);
  });
  return { heures, cout };
}, [pointages]);
```

### 2b. Import icône : ajouter `Car` à l'import `lucide-react`.

### 2c. Cartes (après « Coût MO », avant « Matériaux »), via le composant `KpiCard`
```jsx
<KpiCard T={T} icon={Car} iconColor="#f59e0b" label="Trajets"
  value={trajetStats.heures > 0
    ? `${trajetStats.heures.toFixed(1)}h · ${fmtEur(trajetStats.cout)}`
    : "—"}
  sub="Inclus dans le coût MO"/>

<KpiCard T={T} icon={Clock} iconColor="#f59e0b" label="Heures indirectes"
  value={indirectStats.heures > 0
    ? `${indirectStats.heures.toFixed(1)}h · ${fmtEur(indirectStats.cout)}`
    : "—"}
  sub="Intempéries, SAV, nettoyage…"/>
```
> `onClick`/détail modale optionnels — non bloquants pour cette passe.

---

# PARTIE 3 — Onglet consolidé « Trajets » (pilotage)

## Fichier : `src/Renovation/DashboardAnalyse.jsx`

**Objectif :** un onglet qui répond aux questions de pilotage que la vue chantier-par-chantier
ne permet pas : combien le trajet coûte au total, quel chantier / quel ouvrier en génère le
plus, et quelle part du prix vendu il absorbe.

Éléments déjà disponibles dans le composant :
- state `pointagesByChantier` = map `{ chantier_id: [pointages] }` (tous chantiers).
- `chantiers` = tableau mappé (via `phasageToChantier`) passé à `<ChantiersTab chantiers={chantiers} …/>`.
- state `activeTab` (défaut `'chantiers'`) + le tableau de tabs rendu en boutons (`t.label`).
- helpers `fmt` (euros) et `fmtPct` ; `recharts` déjà importé (`BarChart`, `Bar`, `XAxis`,
  `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`).
- `T` (thème) et `acc` (accent) disponibles.

> ⚠️ Champ « prix vendu » du chantier mappé : `phasageToChantier` lit `prix_vendu` depuis
> `plan_travaux.meta`. Confirmer le nom exact du champ exposé dans l'objet chantier mappé
> (probablement `vendu` ou `prixVendu`) et l'utiliser ci-dessous. Je le note `venduHT`.

### 3a. Enregistrer l'onglet
Dans le tableau de tabs, ajouter une entrée `{ key: 'trajets', label: 'Trajets' }` (après
`'chantiers'` idéalement). Dans le bloc de rendu conditionnel des onglets, ajouter :
```jsx
{activeTab === 'trajets' && (
  <TrajetsTab pointagesByChantier={pointagesByChantier} chantiers={chantiers} T={T} acc={acc}/>
)}
```

### 3b. Composant `TrajetsTab`
À placer avec les autres composants d'onglet (`ChantiersTab`, `PipelineTab`…). Réutiliser les
styles de cartes / tables existants du dashboard pour la cohérence visuelle.

```jsx
function TrajetsTab({ pointagesByChantier, chantiers, T, acc }) {
  const [periode, setPeriode] = useState('mois'); // 'mois' | '90j' | 'tout'

  const allPts = useMemo(
    () => Object.values(pointagesByChantier || {}).flat(),
    [pointagesByChantier]
  );

  // Filtre période sur pointage.date (YYYY-MM-DD)
  const pts = useMemo(() => {
    if (periode === 'tout') return allPts;
    const now = new Date();
    const min = new Date(now);
    if (periode === 'mois') min.setDate(1);
    if (periode === '90j') min.setDate(now.getDate() - 90);
    const minISO = min.toISOString().slice(0, 10);
    return allPts.filter(p => (p.date || '') >= minISO);
  }, [allPts, periode]);

  const h = p => parseFloat(p.heures) || 0;
  const c = p => h(p) * (parseFloat(p.taux_horaire) || 0);
  const isTrajet = p => p.type_pointage === 'indirect' && /trajet/i.test(p.motif_indirect || '');
  const isIndirect = p => p.type_pointage === 'indirect' && !/trajet/i.test(p.motif_indirect || '');

  // ── KPI globaux ──
  const heuresTotales = pts.reduce((s, p) => s + h(p), 0);
  const trajetH   = pts.filter(isTrajet).reduce((s, p) => s + h(p), 0);
  const trajetCout = pts.filter(isTrajet).reduce((s, p) => s + c(p), 0);
  const indirectCout = pts.filter(isIndirect).reduce((s, p) => s + c(p), 0);
  const tauxTrajet = heuresTotales > 0 ? (trajetH / heuresTotales) * 100 : 0;

  // ── Par chantier (trajet uniquement), trié par coût décroissant ──
  const parChantier = useMemo(() => {
    const m = {};
    pts.filter(isTrajet).forEach(p => {
      const k = p.chantier_id || 'divers';
      if (!m[k]) m[k] = { id: k, heures: 0, cout: 0 };
      m[k].heures += h(p); m[k].cout += c(p);
    });
    return Object.values(m).map(row => {
      const ch = (chantiers || []).find(x => x.id === row.id);
      const venduHT = ch?.venduHT || 0; // ⚠️ confirmer le nom du champ
      return {
        ...row,
        nom: ch?.nom || row.id,
        pctVendu: venduHT > 0 ? (row.cout / venduHT) * 100 : null,
      };
    }).sort((a, b) => b.cout - a.cout);
  }, [pts, chantiers]);

  // ── Par ouvrier : taux de trajet perso = heures trajet / heures totales ──
  const parOuvrier = useMemo(() => {
    const m = {};
    pts.forEach(p => {
      const k = p.ouvrier || '?';
      if (!m[k]) m[k] = { ouvrier: k, heuresTotales: 0, trajetH: 0, trajetCout: 0 };
      m[k].heuresTotales += h(p);
      if (isTrajet(p)) { m[k].trajetH += h(p); m[k].trajetCout += c(p); }
    });
    return Object.values(m)
      .map(r => ({ ...r, taux: r.heuresTotales > 0 ? (r.trajetH / r.heuresTotales) * 100 : 0 }))
      .sort((a, b) => b.trajetCout - a.trajetCout);
  }, [pts]);

  // Rendu : 4 cartes KPI (Coût trajet, Heures trajet, Taux de trajet %, Coût indirect),
  // un sélecteur de période, un BarChart "coût trajet par chantier" (top 8),
  // puis deux tables : "Par chantier" et "Par ouvrier".
  // Utiliser fmt(...) pour les euros et fmtPct(...) pour les %.
  // ... (mise en page à réaliser en réutilisant les cartes/tables du dashboard)
}
```

### 3c. Contenu visuel attendu de `TrajetsTab`
1. **Sélecteur de période** : Mois en cours / 90 jours / Tout (pills, comme les tabs).
2. **4 cartes KPI** : `Coût trajet` = `fmt(trajetCout)` · `Heures trajet` = `trajetH.toFixed(1)h`
   · `Taux de trajet` = `fmtPct(tauxTrajet)` (indicateur de fuite de productivité)
   · `Coût indirect (hors trajet)` = `fmt(indirectCout)`.
3. **BarChart** (recharts) : coût trajet par chantier, top 8 (`parChantier.slice(0, 8)`),
   axe X = nom, axe Y = coût.
4. **Table « Par chantier »** : Chantier · Heures trajet · Coût trajet · % du prix vendu HT
   (`pctVendu` via `fmtPct`, ou `—` si prix vendu absent). Triée par coût décroissant.
5. **Table « Par ouvrier »** : Ouvrier · Heures trajet · Heures totales · Taux de trajet (%) ·
   Coût trajet. Triée par coût trajet décroissant.

---

# Critères d'acceptation (globaux)

1. **Marge V2 corrigée** : la marge nette de `PhasageV2` diminue de `coutIndirect + coutLibre`
   et **coïncide** avec `DashboardAnalyse` et `PageChantiers` pour le même chantier (aux
   arrondis près).
2. **Heures totales V2** incluent trajet + indirect (numérateur et `% consommées`).
3. **Cartes V2** : « Trajets » et « Heures indirectes » affichent `Xh · Y €`, ou `—` si vide.
4. **Pas de double comptage** : `coutMOTotalChantier = coutMOChantier + extras.coutLibre +
   extras.coutIndirect`, et `extras.coutIndirect = trajetStats.cout + indirectStats.cout`.
5. **Onglet Trajets** : accessible depuis `DashboardAnalyse`, affiche les 4 KPI, le graphe et
   les deux tables ; le filtre de période recalcule tout ; `Taux de trajet` cohérent
   (`trajetH / heuresTotales`).
6. **Chantiers legacy** sans pointage : extras = 0, comportement inchangé.

# Note hors périmètre (à signaler, ne pas traiter ici)
Incohérence de méthode : `PageChantiers.calcFinances` somme TOUS les pointages du chantier
quand il y en a, alors que `DashboardAnalyse` fait par-tâche + extras. Cette spec aligne
PhasageV2 sur la méthode `DashboardAnalyse`. Harmoniser `PageChantiers` mériterait un ticket
dédié.
