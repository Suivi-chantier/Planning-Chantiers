// Vérification : protéger l'historique de la bibliothèque.
//
// Deux protections, une seule idée : NE PAS DÉTRUIRE SUR UNE NON-RÉPONSE.
//   A. on ne supprime pas un ouvrage de bibliothèque utilisé par des chantiers ;
//   B. on ne réinsère plus la bibliothèque initiale quand la lecture revient vide.
//
// Ce qui a rendu ces deux protections nécessaires (mesuré en base le
// 24/09/2026) : 63 des 167 ouvrages de bibliothèque référencés par des
// phasages n'existent plus, laissant 153 ouvrages de chantier sur 20 chantiers
// avec un lien mort — aucun récupérable par bibliotheque_ref, code_ouvrage ni
// libellé. Le fil commun des deux bugs est qu'une lecture vide était traitée
// comme une information sûre.
//
// Toutes les données de ce fichier sont des FIXTURES INVENTÉES.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  usageOuvrageBibliothequeV1,
  usageIndetermineV1,
  suppressionAutoriseeV1,
  lectureExploitableV1,
  messageUsageBloquantV1,
  USAGE_BIBLIOTHEQUE_VERSION,
} from "../src/Renovation/usageBibliothequeV1.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(resolve(here, "../src/Renovation/usageBibliothequeV1.mjs"), "utf8");
const facade = await readFile(resolve(here, "../src/Renovation/usageBibliothequeV1.js"), "utf8");
const ecran = await readFile(resolve(here, "../src/Renovation/Bibliotheque.jsx"), "utf8");
const code = source.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

// ── Fixtures (toutes inventées) ─────────────────────────────────────────────
const ouvrage = bibliothequeId => ({ id: `o-${Math.random()}`, bibliotheque_id: bibliothequeId });
const phasage = (chantierId, nom, bibIds) => ({
  chantier_id: chantierId,
  chantier_nom: nom,
  ouvrages: bibIds.map(ouvrage),
});

// ── 0. Pureté, façade, constantes ───────────────────────────────────────────
{
  assert.equal(/(?:\bimport\b|\bfrom\b)[^\n]*supabase/i.test(source), false, "le module doit rester pur");
  assert.equal(/\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(|\.rpc\s*\(|\.from\s*\(/.test(code), false, "le module ne doit rien lire ni écrire en base");
  assert.equal(/new Date\s*\(|Date\.now\s*\(/.test(code), false, "aucune horloge");
  assert.equal(/toLocaleString|Intl\./.test(code), false, "pas d'ICU : libellés déterministes");
  assert.match(facade, /export \* from "\.\/usageBibliothequeV1\.mjs";/, "la façade .js doit ré-exporter le .mjs");
  assert.equal(USAGE_BIBLIOTHEQUE_VERSION, "v1");
}

// ── 1. Un ouvrage UTILISÉ ne peut pas être supprimé ─────────────────────────
{
  const phasages = [
    phasage("C1", "Villa des Lilas", ["BIB-A", "BIB-B"]),
    phasage("C2", "Résidence Ouest", ["BIB-A"]),
  ];
  const usage = usageOuvrageBibliothequeV1(phasages, "BIB-A");
  assert.equal(usage.determine, true);
  assert.equal(usage.nOuvrages, 2);
  assert.equal(usage.nChantiers, 2);
  assert.equal(suppressionAutoriseeV1(usage), false, "un ouvrage utilisé ne doit jamais être supprimable");

  // Le message dit ce qui serait perdu ET quoi faire à la place — sans quoi
  // l'utilisateur recrée l'ouvrage, ce qui reproduit exactement le problème.
  const msg = messageUsageBloquantV1(usage);
  assert.equal(msg, "Cet ouvrage est utilisé par 2 ouvrages sur 2 chantiers. "
    + "Le supprimer effacerait son historique réel, qui sert à juger sa cadence. "
    + "Pour une variante, utilisez « Dupliquer ». "
    + "Pour le corriger, modifiez-le plutôt que de le recréer.");
  assert.match(msg, /Dupliquer/);
  assert.match(msg, /modifiez-le plutôt que de le recréer/);

  // Accord du singulier : un seul ouvrage, un seul chantier.
  const seul = usageOuvrageBibliothequeV1([phasage("C1", "Villa des Lilas", ["BIB-Z"])], "BIB-Z");
  assert.match(messageUsageBloquantV1(seul), /^Cet ouvrage est utilisé par 1 ouvrage sur 1 chantier\./);
  assert.equal(suppressionAutoriseeV1(seul), false);
}

// ── 2. Un ouvrage NON UTILISÉ reste supprimable ─────────────────────────────
{
  const phasages = [
    phasage("C1", "Villa des Lilas", ["BIB-A"]),
    phasage("C2", "Résidence Ouest", ["BIB-B"]),
  ];
  const usage = usageOuvrageBibliothequeV1(phasages, "BIB-INUTILISE");
  assert.equal(usage.determine, true);
  assert.equal(usage.nOuvrages, 0);
  assert.equal(usage.nChantiers, 0);
  assert.deepEqual([...usage.chantiers], []);
  assert.equal(suppressionAutoriseeV1(usage), true, "sans usage, le comportement d'origine est conservé");
  // Aucun message de blocage à afficher dans ce cas.
  assert.equal(messageUsageBloquantV1(usage), "Cet ouvrage est utilisé par 0 ouvrage sur 0 chantier. "
    + "Le supprimer effacerait son historique réel, qui sert à juger sa cadence. "
    + "Pour une variante, utilisez « Dupliquer ». "
    + "Pour le corriger, modifiez-le plutôt que de le recréer.",
    "le message existe mais l'écran ne l'affiche que si nOuvrages > 0");
}

// ── 3. Comptage correct sur plusieurs chantiers ─────────────────────────────
{
  // 5 ouvrages répartis sur 3 chantiers, dont un chantier qui l'utilise 3 fois.
  const phasages = [
    phasage("C1", "Villa des Lilas", ["BIB-A", "BIB-A", "BIB-A", "BIB-B"]),
    phasage("C2", "Résidence Ouest", ["BIB-A"]),
    phasage("C3", "Le Hameau", ["BIB-A", "BIB-C"]),
    phasage("C4", "Sans rapport", ["BIB-D"]),
  ];
  const usage = usageOuvrageBibliothequeV1(phasages, "BIB-A");
  assert.equal(usage.nOuvrages, 5, "on compte les OUVRAGES, pas les chantiers");
  assert.equal(usage.nChantiers, 3, "un chantier qui l'utilise 3 fois ne compte qu'une fois");
  assert.deepEqual([...usage.chantiers], ["Villa des Lilas", "Résidence Ouest", "Le Hameau"]);
  assert.equal(usage.chantiers.includes("Sans rapport"), false);

  // Un chantier sans nom reste identifiable : on ne le perd pas de la liste.
  const sansNom = usageOuvrageBibliothequeV1(
    [{ chantier_id: "C9", ouvrages: [ouvrage("BIB-A")] }], "BIB-A");
  assert.equal(sansNom.nChantiers, 1);
  assert.deepEqual([...sansNom.chantiers], ["C9"]);
  const sansRien = usageOuvrageBibliothequeV1(
    [{ ouvrages: [ouvrage("BIB-A")] }], "BIB-A");
  assert.deepEqual([...sansRien.chantiers], ["chantier sans nom"]);

  // Déterminisme strict.
  assert.deepEqual(usageOuvrageBibliothequeV1(phasages, "BIB-A"), usageOuvrageBibliothequeV1(phasages, "BIB-A"));
}

// ── 4. Un comptage qui ÉCHOUE bloque la suppression ─────────────────────────
{
  // Toute entrée dont on ne peut rien affirmer produit « indéterminé », et
  // « indéterminé » n'autorise JAMAIS la suppression. C'est le cœur de la
  // protection : se tromper en bloquant coûte un clic, se tromper en
  // supprimant coûte un historique.
  const cas = [
    [usageOuvrageBibliothequeV1(null, "BIB-A"), "phasages null"],
    [usageOuvrageBibliothequeV1(undefined, "BIB-A"), "phasages absents"],
    [usageOuvrageBibliothequeV1("bruit", "BIB-A"), "phasages non-liste"],
    [usageOuvrageBibliothequeV1([phasage("C1", "V", ["BIB-A"]), null], "BIB-A"), "entrée illisible"],
    [usageOuvrageBibliothequeV1([{ chantier_id: "C1", ouvrages: "cassé" }], "BIB-A"), "ouvrages non-liste"],
    [usageOuvrageBibliothequeV1([], ""), "identifiant vide"],
    [usageOuvrageBibliothequeV1([], null), "identifiant null"],
    [usageIndetermineV1("lecture impossible"), "état indéterminé explicite"],
    [null, "aucun usage calculé"],
    [undefined, "usage absent"],
  ];
  for (const [usage, libelle] of cas) {
    assert.equal(suppressionAutoriseeV1(usage), false, `suppression interdite : ${libelle}`);
    if (usage) {
      assert.equal(usage.determine, false, `usage indéterminé attendu : ${libelle}`);
      assert.equal(usage.nOuvrages, null, "un usage indéterminé ne vaut pas 0");
      assert.notEqual(usage.nOuvrages, 0, `null ≠ 0 : ${libelle}`);
    }
  }
  // Un usage indéterminé ne produit aucun message de comptage : il n'y a rien
  // à compter.
  assert.equal(messageUsageBloquantV1(usageIndetermineV1("x")), null);

  // Un élément vide DANS la liste d'ouvrages n'invalide pas tout : il ne
  // référence simplement rien.
  const avecTrou = usageOuvrageBibliothequeV1(
    [{ chantier_id: "C1", chantier_nom: "V", ouvrages: [null, ouvrage("BIB-A"), undefined] }], "BIB-A");
  assert.equal(avecTrou.determine, true);
  assert.equal(avecTrou.nOuvrages, 1);
}

// ── 5. Une lecture VIDE n'autorise aucune insertion ─────────────────────────
{
  // Le piège exact : Supabase renvoie [] SANS erreur quand RLS bloque. Zéro
  // ligne ne peut donc pas valoir « la base est vide ».
  assert.equal(lectureExploitableV1(null, []).exploitable, false, "zéro ligne n'est pas une réponse fiable");
  assert.match(lectureExploitableV1(null, []).raison, /aucun chantier reçu/);
  assert.equal(lectureExploitableV1({ message: "RLS" }, []).exploitable, false);
  assert.equal(lectureExploitableV1({ message: "RLS" }, [{ chantier_id: "C1", ouvrages: [] }]).exploitable, false,
    "une erreur invalide la lecture même si des lignes reviennent");
  assert.equal(lectureExploitableV1(null, null).exploitable, false);
  assert.equal(lectureExploitableV1(null, undefined).exploitable, false);
  assert.equal(lectureExploitableV1(null, "bruit").exploitable, false);
  // Seule une lecture sans erreur ET non vide est exploitable.
  assert.equal(lectureExploitableV1(null, [{ chantier_id: "C1", ouvrages: [] }]).exploitable, true);

  // Et dans l'écran : le chemin de lecture de la bibliothèque ne doit plus
  // amorcer la table. On vérifie le corps EXACT de loadOuvrages.
  const m = ecran.match(/async function loadOuvrages\([\s\S]*?\n  \}/);
  assert.ok(m, "loadOuvrages doit exister dans Bibliotheque.jsx");
  const corpsLoad = m[0];
  assert.equal(/BIBLIOTHEQUE_INITIALE/.test(corpsLoad), false, "loadOuvrages ne doit plus référencer la bibliothèque initiale");
  assert.match(corpsLoad, /setLectureEchouee\(true\)/, "une lecture vide doit être signalée à l'écran");
  assert.match(corpsLoad, /0 ouvrage reçu/, "le message d'erreur exact doit être affiché");
  assert.match(corpsLoad, /Rien n'a été modifié/, "le message doit dire que rien n'a été modifié");
  // L'état vide de la liste ne doit pas se confondre avec un échec de lecture.
  assert.match(ecran, /lectureEchouee\s*\n?\s*\?/, "l'écran doit distinguer échec de lecture et liste filtrée vide");
  assert.match(ecran, /La bibliothèque n'a pas pu être lue/);
}

// ── 6. Garde statique : aucun insert ne doit réapparaître dans loadOuvrages ─
{
  const m = ecran.match(/async function loadOuvrages\([\s\S]*?\n  \}/);
  const corpsLoad = m[0];
  // Cette garde est la raison d'être du bloc : si quelqu'un réintroduit un
  // amorçage automatique dans ce chemin, la CI tombe ici.
  assert.equal(/\.insert\s*\(/.test(corpsLoad), false, "loadOuvrages ne doit contenir AUCUN insert");
  assert.equal(/\.upsert\s*\(/.test(corpsLoad), false, "loadOuvrages ne doit contenir aucun upsert");
  assert.equal(/\.update\s*\(/.test(corpsLoad), false, "loadOuvrages ne doit contenir aucun update");
  assert.equal(/\.delete\s*\(/.test(corpsLoad), false, "loadOuvrages ne doit contenir aucun delete");
  // Le seul appel Supabase autorisé dans ce chemin est un select.
  const appels = corpsLoad.match(/\.\w+\s*\(/g) || [];
  assert.ok(appels.some(a => a.startsWith(".select")), "loadOuvrages doit lire la table");

  // La suppression reste gardée côté écran : le delete n'est atteignable que
  // derrière suppressionAutoriseeV1, et le comptage précède la modale.
  const mDel = ecran.match(/async function confirmSupprimerOuvrage\([\s\S]*?\n  \}/);
  assert.ok(mDel, "confirmSupprimerOuvrage doit exister");
  assert.match(mDel[0], /if \(!suppressionAutoriseeV1\(usageToDelete\)\) return;/,
    "la suppression doit être refusée tant que l'usage n'est pas déterminé et nul");
  const posGarde = mDel[0].indexOf("suppressionAutoriseeV1");
  const posDelete = mDel[0].indexOf(".delete(");
  assert.ok(posGarde !== -1 && posDelete !== -1 && posGarde < posDelete,
    "la garde doit précéder le delete, pas le suivre");
  // Le comptage passe bien par le module pur, et par une lecture contrôlée.
  assert.match(ecran, /usageOuvrageBibliothequeV1\(data, ouvrage\.id\)/);
  assert.match(ecran, /lectureExploitableV1\(error, data\)/);
  // Le bouton « Supprimer » n'est rendu que si la suppression est autorisée.
  assert.match(ecran, /\{autorisee && \(\s*\n\s*<button onClick=\{confirmSupprimerOuvrage\}/,
    "le bouton Supprimer ne doit exister que quand la suppression est autorisée");
}

console.log("OK — protection de l'historique de la bibliothèque : 7 blocs de vérification");
