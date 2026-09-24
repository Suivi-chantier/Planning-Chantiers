// Vérification : « Archiver » un ouvrage de bibliothèque.
//
// L'idée tient en une phrase : on supprimait des ouvrages pour DEUX raisons —
// les refaire, et faire le ménage. « Dupliquer » couvre la première.
// « Archiver » couvre la seconde SANS RIEN DÉTRUIRE : la ligne
// bibliotheque_ratios n'est pas touchée, l'id reste valide, les chantiers
// restent reliés, et la jauge d'échantillon continue de compter.
//
// Les blocs ci-dessous vérifient surtout les deux façons de se tromper :
//   – masquer un ouvrage ACTIF (grave : pousse à le recréer, donc recrée les
//     liens morts qu'on vient de colmater) → on affiche tout dans le doute ;
//   – écraser la liste des archivés avec une liste vide issue d'une lecture
//     ratée → l'écriture est refusée plutôt que tentée.
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLE_ARCHIVES_BIBLIOTHEQUE,
  lireArchivesV1,
  estArchiveV1,
  filtrerPourChoixV1,
  seulementArchivesV1,
  ajouterArchiveV1,
  retirerArchiveV1,
  valeurAEcrireV1,
  libelleFiltreArchivesV1,
  messageVoiesAlternativesV1,
  MESSAGE_ARCHIVES_INDISPONIBLES,
  ARCHIVES_BIBLIOTHEQUE_VERSION,
} from "../src/Renovation/archivesBibliothequeV1.mjs";
import { matchBiblio } from "../src/devisImport.js";

const here = dirname(fileURLToPath(import.meta.url));
const lire = async f => readFile(resolve(here, f), "utf8");
const source = await lire("../src/Renovation/archivesBibliothequeV1.mjs");
const facade = await lire("../src/Renovation/archivesBibliothequeV1.js");
const ecranBiblio = await lire("../src/Renovation/Bibliotheque.jsx");
const ecranPhasage = await lire("../src/Renovation/PhasageV2.jsx");
const ecranInfoClient = await lire("../src/Renovation/PageInfoClient.jsx");
const devisImport = await lire("../src/devisImport.js");
const code = source.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

const ouvrage = (id, libelle) => ({ id, libelle: libelle || `Ouvrage ${id}` });
const dispo = ids => ({ disponible: true, ids, raison: null });

// ── 0. Pureté, façade, constantes ───────────────────────────────────────────
{
  assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "le module doit rester pur");
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "le module ne doit rien lire ni écrire en base");
  assert.equal(/new Date\s*\(|Date\.now\s*\(/.test(code), false, "aucune horloge");
  assert.equal(/toLocaleString|Intl\./.test(code), false, "pas d'ICU");
  assert.match(facade, /export \* from "\.\/archivesBibliothequeV1\.mjs";/, "la façade .js doit ré-exporter le .mjs");
  assert.equal(ARCHIVES_BIBLIOTHEQUE_VERSION, "v1");
  assert.equal(CLE_ARCHIVES_BIBLIOTHEQUE, "bibliotheque_archives");
  assert.match(messageVoiesAlternativesV1(), /Dupliquer/);
  assert.match(messageVoiesAlternativesV1(), /Archiver/);
}

// ── 1. Archiver puis désarchiver ────────────────────────────────────────────
{
  // Départ : la clé n'existe pas encore en base. C'est LÉGITIME (personne n'a
  // jamais archivé), contrairement au cas des phasages où zéro ligne est
  // suspect. La liste est donc disponible et vide.
  const vierge = lireArchivesV1(null, null);
  assert.equal(vierge.disponible, true, "clé absente = aucun archivé, pas une panne");
  assert.deepEqual(vierge.ids, []);

  // Archiver A.
  const apresArchivage = ajouterArchiveV1(vierge, "A");
  assert.deepEqual(apresArchivage, ["A"]);
  assert.deepEqual(valeurAEcrireV1(apresArchivage), { items: ["A"] }, "même forme que les catégories personnalisées");

  // Relecture de ce qui a été écrit.
  const relu = lireArchivesV1(null, { value: { items: ["A"] } });
  assert.equal(relu.disponible, true);
  assert.equal(estArchiveV1(relu, "A"), true);
  assert.equal(estArchiveV1(relu, "B"), false);

  // Archiver deux fois de suite ne duplique pas.
  assert.deepEqual(ajouterArchiveV1(relu, "A"), ["A"], "archiver un déjà-archivé ne change rien");

  // Désarchiver A : retour à l'état de départ.
  const apresDesarchivage = retirerArchiveV1(relu, "A");
  assert.deepEqual(apresDesarchivage, []);
  assert.equal(estArchiveV1(lireArchivesV1(null, { value: { items: [] } }), "A"), false);

  // Désarchiver un ouvrage qui n'est pas archivé ne casse rien.
  assert.deepEqual(retirerArchiveV1(dispo(["B"]), "A"), ["B"]);

  // Le module ne mute jamais l'entrée.
  const avant = dispo(["A", "B"]);
  ajouterArchiveV1(avant, "C");
  retirerArchiveV1(avant, "A");
  assert.deepEqual(avant.ids, ["A", "B"], "l'état d'entrée reste intact");

  // Lecture tolérante : ids vides, doublons, valeurs non-texte.
  const sale = lireArchivesV1(null, { value: { items: ["A", "A", "", null, "  B  ", 42] } });
  assert.deepEqual(sale.ids, ["A", "B", "42"], "dédoublonné, nettoyé, sans entrées vides");
}

// ── 2. Un archivé disparaît des listes de CHOIX ─────────────────────────────
{
  const tous = [ouvrage("A"), ouvrage("B"), ouvrage("C")];
  const archives = dispo(["B"]);

  const pourChoix = filtrerPourChoixV1(tous, archives);
  assert.deepEqual(pourChoix.map(o => o.id), ["A", "C"], "l'archivé n'est plus proposé à l'ajout");
  assert.equal(pourChoix.length, 2);
  // L'original n'est pas modifié : on rend une nouvelle liste.
  assert.equal(tous.length, 3, "la liste source reste complète");

  // Le filtre inverse, pour l'affichage « Afficher les archivés ».
  assert.deepEqual(seulementArchivesV1(tous, archives).map(o => o.id), ["B"]);

  // Aucun archivé : la liste passe telle quelle.
  assert.deepEqual(filtrerPourChoixV1(tous, dispo([])).map(o => o.id), ["A", "B", "C"]);

  // Entrées malformées : rien ne casse.
  assert.deepEqual(filtrerPourChoixV1(null, archives), []);
  assert.deepEqual(filtrerPourChoixV1(undefined, archives), []);
  assert.deepEqual(filtrerPourChoixV1([null, ouvrage("B"), undefined], archives).length, 2,
    "un élément vide n'est pas un ouvrage archivé");

  // Libellé du filtre : il DIT combien d'ouvrages sont concernés, pour qu'une
  // liste raccourcie ne passe pas pour une bibliothèque complète.
  assert.equal(libelleFiltreArchivesV1(dispo([])), "Afficher les archivés");
  assert.equal(libelleFiltreArchivesV1(dispo(["A"])), "Afficher les archivés (1)");
  assert.equal(libelleFiltreArchivesV1(dispo(["A", "B"])), "Afficher les archivés (2)");
}

// ── 3. Un archivé reste lisible PAR SON ID ──────────────────────────────────
{
  // C'est la garantie centrale d'« Archiver » face à « Supprimer » : rien ne
  // disparaît. L'ouvrage archivé reste une ligne valide, lue normalement
  // partout où on l'AFFICHE plutôt que de le choisir.
  const archives = dispo(["B"]);

  // estArchiveV1 QUALIFIE, il ne masque pas : c'est à l'appelant de décider,
  // et seuls les points de CHOIX filtrent.
  assert.equal(estArchiveV1(archives, "B"), true, "on sait qu'il est archivé…");
  const lecturesParId = [ouvrage("A"), ouvrage("B")];
  const parId = Object.fromEntries(lecturesParId.map(o => [o.id, o]));
  assert.ok(parId["B"], "…et on peut toujours le lire par son id");
  assert.equal(parId["B"].libelle, "Ouvrage B");

  // Le module n'expose AUCUNE fonction qui retirerait un archivé d'un index
  // par id : la seule exclusion possible passe par filtrerPourChoixV1.
  assert.equal(typeof filtrerPourChoixV1, "function");
  assert.equal(/filtrerPourAffichage|masquerPourLecture/.test(source), false,
    "aucune fonction ne doit masquer un archivé à la lecture par id");

  // Vérification côté écrans : les lectures par id ne sont pas filtrées.
  // PageInfoClient recharge un ouvrage par son id pour actualiser une ligne de
  // devis — ce chemin doit rester intact.
  assert.match(ecranInfoClient, /\.eq\("id", ligne\.bibliotheque_id\)/,
    "la relecture par id d'une ligne de devis doit subsister");
  assert.match(ecranInfoClient, /\.eq\("id", ouvrageId\)/,
    "la relecture par id après passage en bibliothèque doit subsister");
  // Et le filtre n'est appliqué QU'AU catalogue d'ajout.
  const occurrencesFiltre = (ecranInfoClient.match(/filtrerPourChoixV1\(/g) || []).length;
  assert.equal(occurrencesFiltre, 1, "un seul point filtré dans PageInfoClient : le catalogue d'ajout");
  assert.match(ecranInfoClient, /filtrerPourChoixV1\(biblio\?\.ouvrages \|\| \[\], archivesBiblio\)/);
}

// ── 4. Lecture échouée => TOUT visible + bandeau ─────────────────────────────
{
  // La règle est volontairement asymétrique. Montrer un ouvrage archivé est
  // désagréable ; cacher un ouvrage ACTIF pousse à le recréer — et recréer,
  // c'est exactement ce qui a produit 153 liens morts.
  const casIndisponibles = [
    [lireArchivesV1({ message: "RLS" }, null), "erreur de lecture"],
    [lireArchivesV1({ message: "RLS" }, { value: { items: ["A"] } }), "erreur malgré des données"],
    [lireArchivesV1(null, { value: { items: "cassé" } }), "items non-liste"],
    [lireArchivesV1(null, { value: 42 }), "valeur non-objet"],
    [lireArchivesV1(null, "bruit"), "réponse non-objet"],
    [{ disponible: false, ids: [], raison: "x" }, "état indisponible explicite"],
    [null, "aucun état"],
    [undefined, "état absent"],
  ];
  const tous = [ouvrage("A"), ouvrage("B"), ouvrage("C")];
  for (const [archives, libelle] of casIndisponibles) {
    assert.deepEqual(filtrerPourChoixV1(tous, archives).map(o => o.id), ["A", "B", "C"],
      `tout doit rester visible : ${libelle}`);
    assert.equal(estArchiveV1(archives, "A"), false, `rien n'est masqué : ${libelle}`);
    assert.deepEqual(seulementArchivesV1(tous, archives), [], `aucun archivé affirmé : ${libelle}`);
    if (archives) assert.equal(archives.disponible, false, `indisponible attendu : ${libelle}`);
  }
  // Une raison est fournie pour pouvoir l'afficher.
  assert.ok(lireArchivesV1({ message: "RLS" }, null).raison, "une raison doit accompagner l'indisponibilité");
  assert.match(MESSAGE_ARCHIVES_INDISPONIBLES, /indisponible/i);
  // Et l'écran affiche bien ce bandeau.
  assert.match(ecranBiblio, /MESSAGE_ARCHIVES_INDISPONIBLES/, "le bandeau doit être affiché");
  assert.match(ecranBiblio, /archives\.disponible === false && archives\.raison/,
    "le bandeau ne s'affiche que sur une vraie indisponibilité");
}

// ── 5. Jamais d'écrasement par une liste vide ───────────────────────────────
{
  // Le scénario redouté : la relecture échoue, ids vaut [], on écrit [] —
  // et tous les archivages des collègues disparaissent. Le module renvoie
  // null, ce qui interdit l'écriture.
  const indisponible = lireArchivesV1({ message: "RLS" }, null);
  assert.equal(indisponible.ids.length, 0, "une lecture ratée donne bien une liste vide…");
  assert.equal(ajouterArchiveV1(indisponible, "A"), null, "…mais l'archivage est REFUSÉ");
  assert.equal(retirerArchiveV1(indisponible, "A"), null, "…et le désarchivage aussi");

  for (const mauvais of [null, undefined, {}, { disponible: false, ids: ["A"] }, { ids: ["A"] }]) {
    assert.equal(ajouterArchiveV1(mauvais, "A"), null, "aucune écriture sur un état non confirmé");
    assert.equal(retirerArchiveV1(mauvais, "A"), null, "aucune écriture sur un état non confirmé");
  }
  // Un identifiant vide n'écrit rien non plus.
  assert.equal(ajouterArchiveV1(dispo([]), ""), null);
  assert.equal(ajouterArchiveV1(dispo([]), null), null);
  assert.equal(retirerArchiveV1(dispo(["A"]), ""), null);

  // Côté écran : la séquence est bien relire → modifier → réécrire, et
  // l'écriture est sautée quand le module renvoie null.
  const m = ecranBiblio.match(/async function basculerArchive\([\s\S]*?\n  \}/);
  assert.ok(m, "basculerArchive doit exister");
  const corps = m[0];
  const posRelecture = corps.indexOf('.eq("key", CLE_ARCHIVES_BIBLIOTHEQUE)');
  const posEcriture = corps.indexOf(".upsert(");
  assert.ok(posRelecture !== -1 && posEcriture !== -1 && posRelecture < posEcriture,
    "la relecture doit précéder l'écriture");
  assert.match(corps, /if \(ids === null\) \{/, "le refus du module doit court-circuiter l'écriture");
  const posGarde = corps.indexOf("ids === null");
  assert.ok(posGarde < posEcriture, "la garde doit précéder l'upsert");
  assert.equal(/lireArchivesV1\(error, data\)/.test(corps), true, "la relecture passe par le module");
}

// ── 6. Aucune écriture sur bibliotheque_ratios dans le chemin d'archivage ────
{
  // C'est toute la différence avec « Supprimer » : archiver ne touche pas la
  // ligne de l'ouvrage. Si cette garde tombe un jour, c'est que l'archivage
  // s'est mis à modifier la bibliothèque — et alors l'id, les liens des
  // chantiers et l'échantillon ne sont plus garantis.
  const m = ecranBiblio.match(/async function basculerArchive\([\s\S]*?\n  \}/);
  const corps = m[0];
  assert.equal(/bibliotheque_ratios/.test(corps), false,
    "le chemin d'archivage ne doit JAMAIS toucher bibliotheque_ratios");
  assert.match(corps, /from\("planning_config"\)/, "il n'écrit que dans planning_config");
  // La seule écriture autorisée est l'upsert de la clé dédiée.
  const ecritures = corps.match(/\.(insert|update|delete|upsert)\s*\(/g) || [];
  assert.deepEqual(ecritures, [".upsert("], "une seule écriture, et c'est l'upsert planning_config");

  const mLoad = ecranBiblio.match(/async function loadArchives\([\s\S]*?\n  \}/);
  assert.ok(mLoad, "loadArchives doit exister");
  assert.equal(/\.(insert|update|delete|upsert)\s*\(/.test(mLoad[0]), false,
    "la lecture des archives n'écrit rien");
  assert.equal(/bibliotheque_ratios/.test(mLoad[0]), false);

  // Le module pur lui-même ne connaît pas la table.
  assert.equal(/bibliotheque_ratios/.test(code), false,
    "le module d'archives n'a pas à connaître la table des ouvrages");

  // Les gardes de la PR précédente tiennent toujours : loadOuvrages n'écrit rien.
  const mLoadOuvrages = ecranBiblio.match(/async function loadOuvrages\([\s\S]*?\n  \}/);
  assert.equal(/\.(insert|upsert)\s*\(/.test(mLoadOuvrages[0]), false,
    "loadOuvrages ne doit toujours contenir aucune insertion");
}

// ── 7. Les points de CHOIX des autres écrans sont bien filtrés ──────────────
{
  // PhasageV2 : SEUL le sélecteur manuel de la modale est filtré. Le
  // rapprochement automatique de l'import devis reçoit la bibliothèque
  // complète — voir le bloc 8, qui explique pourquoi une liste amputée y
  // produit des liens FAUX plutôt qu'absents.
  assert.match(ecranPhasage, /const bibliothequePourChoix = useMemo\(/,
    "PhasageV2 doit exposer une liste filtrée");
  assert.match(ecranPhasage, /filtrerPourChoixV1\(bibliotheque, archivesBiblio\)/);
  assert.match(ecranPhasage, /bibliotheque=\{bibliothequePourChoix\}/,
    "le sélecteur manuel ne doit pas proposer d'archivé");
  // L'état brut reste disponible : on ne casse pas les autres usages.
  assert.match(ecranPhasage, /const \[bibliotheque, setBibliotheque\] = useState\(\[\]\);/);

  // Le bouton et le badge existent sur la page Bibliothèque.
  assert.match(ecranBiblio, /onArchiver\(ouvrage, !estArchive\)/, "le bouton Archiver/Désarchiver doit exister");
  assert.match(ecranBiblio, /estArchive \? "Désarchiver" : "Archiver"/);
  assert.match(ecranBiblio, /Icon as=\{Archive\} size=\{10\}/, "le badge « Archivé » doit exister");
  // Filtre désactivé par défaut.
  assert.match(ecranBiblio, /const \[afficherArchives, setAfficherArchives\] = useState\(false\);/,
    "le filtre « Afficher les archivés » doit être désactivé par défaut");
  // Les deux voies sont proposées quand la suppression est bloquée.
  assert.match(ecranBiblio, /messageVoiesAlternativesV1\(\)/,
    "le message de blocage doit proposer Dupliquer et Archiver");
}

// ── 8. Le rapprochement AUTOMATIQUE voit toute la bibliothèque ──────────────
{
  // Le défaut corrigé ici : passer la liste FILTRÉE au rapprochement
  // automatique. matchBiblio cherche d'abord un code exact, puis se rabat sur
  // une similarité de libellé (Jaccard, seuil 0,4). Retirer l'ouvrage archivé
  // de la liste ne rend donc pas la ligne « non reconnue » : elle est
  // rattachée à UN AUTRE ouvrage au libellé voisin, silencieusement.
  // Un mauvais lien est pire qu'une absence de lien.
  const archive  = { id: "ARCH", libelle: "P-900 Pose d'un receveur de douche 120x80" };
  const voisin   = { id: "VOIS", libelle: "P-901 Pose d'un receveur de douche 140x90" };
  const complete = [archive, voisin];
  const ligneDevis = "P-900 Pose d'un receveur de douche 120x80";

  // (a) Sur la bibliothèque complète : match EXACT par code, sur le bon ouvrage.
  const surComplete = matchBiblio(ligneDevis, complete);
  assert.equal(surComplete.match.id, "ARCH", "le code exact doit l'emporter");
  assert.equal(surComplete.by, "code");
  assert.equal(surComplete.score, 1);

  // (b) DÉMONSTRATION DU BUG ÉVITÉ : sur la liste filtrée, la ligne n'est pas
  //     « non reconnue » — elle part sur le VOISIN, par similarité.
  const filtree = filtrerPourChoixV1(complete, dispo(["ARCH"]));
  assert.deepEqual(filtree.map(o => o.id), ["VOIS"]);
  const surFiltree = matchBiblio(ligneDevis, filtree);
  assert.equal(surFiltree.match?.id, "VOIS", "c'est bien le piège : un lien FAUX, pas un lien absent");
  assert.equal(surFiltree.by, "libelle");
  assert.notEqual(surFiltree.match?.id, surComplete.match.id,
    "les deux listes donnent des ouvrages DIFFÉRENTS : d'où la correction");

  // (c) La ligne au code identique à un archivé est rattachée À CET OUVRAGE,
  //     et JAMAIS à un autre par similarité.
  const idsArchives = ["ARCH"];
  const matchArchive = !!surComplete.match && idsArchives.some(id => String(id) === String(surComplete.match.id));
  assert.equal(surComplete.match.id, "ARCH");
  assert.equal(matchArchive, true, "l'indicateur doit signaler que l'ouvrage reconnu est archivé");
  // Un ouvrage NON archivé ne porte pas l'indicateur.
  const surVoisin = matchBiblio("P-901 Pose d'un receveur de douche 140x90", complete);
  assert.equal(surVoisin.match.id, "VOIS");
  assert.equal(idsArchives.some(id => String(id) === String(surVoisin.match.id)), false);

  // (d) L'écran passe bien la liste COMPLÈTE au rapprochement automatique,
  //     et les ids archivés seulement pour qualifier.
  assert.match(ecranPhasage, /parseDevisExcel\(\s*\n?\s*file, lots, bibliotheque, archivesBiblio\.disponible \? archivesBiblio\.ids : \[\]/,
    "le rapprochement automatique doit recevoir la bibliothèque complète");
  assert.equal(/parseDevisExcel\(file, lots, bibliothequePourChoix\)/.test(ecranPhasage), false,
    "le rapprochement automatique ne doit JAMAIS recevoir la liste filtrée");

  // (e) Le résultat est signalé dans l'aperçu d'import, pas avalé.
  assert.match(devisImport, /matchArchive,/, "l'item d'import doit porter l'indicateur");
  assert.match(devisImport, /idsArchives = \[\]/, "parseDevisExcel accepte les ids archivés");
  assert.match(ecranPhasage, /it\.matchArchive && \(/, "l'aperçu doit afficher l'avertissement");
  assert.match(ecranPhasage, /Ouvrage archivé — vérifiez avant d'importer/);

  // (f) Les ids archivés ne RESTREIGNENT rien : même liste, même résultat.
  assert.equal(/matchBiblio\([^)]*idsArchives/.test(devisImport), false,
    "la liste des archivés ne doit pas entrer dans la recherche");
}

// ── 9. Le sélecteur MANUEL, lui, reste filtré ───────────────────────────────
{
  // La distinction tient en un mot : désigner un ouvrage à la main est un
  // CHOIX (on ne propose pas un archivé) ; reconnaître une ligne de devis est
  // une LECTURE (on la rattache au bon ouvrage, archivé ou non).
  assert.match(ecranPhasage, /bibliotheque=\{bibliothequePourChoix\}/,
    "le sélecteur manuel de la modale doit rester filtré");
  assert.match(ecranPhasage, /const bibliothequePourChoix = useMemo\(/);
  assert.match(ecranPhasage, /filtrerPourChoixV1\(bibliotheque, archivesBiblio\)/);
  // Et le catalogue d'ajout de PageInfoClient aussi.
  assert.match(ecranInfoClient, /filtrerPourChoixV1\(biblio\?\.ouvrages \|\| \[\], archivesBiblio\)/,
    "le catalogue « Ajouter depuis la bibliothèque » doit rester filtré");
  // Un seul point filtré dans chaque écran : pas de débordement sur une lecture.
  assert.equal((ecranPhasage.match(/filtrerPourChoixV1\(/g) || []).length, 1);
  assert.equal((ecranInfoClient.match(/filtrerPourChoixV1\(/g) || []).length, 1);
}

console.log("OK — archiver un ouvrage de bibliothèque : 10 blocs de vérification");
