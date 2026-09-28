// Import Google Sheets de la bibliothèque matériaux : rendre les noms uniques.
//
// La table materiaux_bibliotheque impose un nom UNIQUE, et l'import fait un
// « upsert par nom ». Or un catalogue fournisseur (SIDER : 22 510 lignes) coupe
// ses désignations à 30 caractères : 266 noms y sont portés par 544 articles
// DIFFÉRENTS (références et prix distincts). Envoyés tels quels, deux lignes de
// même nom dans un même lot font échouer tout le lot (« ON CONFLICT DO UPDATE
// command cannot affect row a second time »), et même dans deux lots séparés
// la seconde écraserait silencieusement la première.
//
// Règle : un nom porté par une seule ligne ne change pas (les liens existants
// restent intacts). Un nom porté par plusieurs lignes reçoit la référence en
// suffixe — « NOM (réf 143006) » — ce qui est stable d'un import à l'autre.
// Deux lignes strictement identiques (même nom, même référence) n'en font
// qu'une : la dernière est gardée, et c'est signalé.
//
// Module pur : aucune base, aucune horloge. Les lignes arrivent en paramètre.

export const IMPORT_NOMS_UNIQUES_VERSION = "v1";

const cle = s => String(s ?? "").trim();

/**
 * @param {Array<{nom: string, reference?: string, _line?: number}>} lignes
 * @returns {{
 *   lignes: Array,                       // lignes à envoyer, noms uniques
 *   renommes: Array<{ligne, avant, apres}>,
 *   fusionnes: Array<{ligne, nom, gardee}>, // doublons exacts écartés
 *   nomsEnDouble: number,                // nb de noms portés par plusieurs lignes
 * }}
 */
export function rendreNomsUniquesV1(lignes) {
  const parNom = new Map();
  for (const l of lignes) {
    const k = cle(l.nom);
    if (!parNom.has(k)) parNom.set(k, []);
    parNom.get(k).push(l);
  }

  // Doublons exacts (même nom + même référence) : on garde la dernière ligne.
  const fusionnes = [];
  const gardees = new Set();
  for (const groupe of parNom.values()) {
    const parRef = new Map();
    for (const l of groupe) parRef.set(cle(l.reference), l);
    for (const l of groupe) {
      const derniere = parRef.get(cle(l.reference));
      if (derniere === l) gardees.add(l);
      else fusionnes.push({ ligne: l._line, nom: cle(l.nom), gardee: derniere._line });
    }
  }

  const nomsPris = new Set();
  const renommes = [];
  let nomsEnDouble = 0;
  const aRenommer = new Set();
  for (const [nom, groupe] of parNom) {
    const restantes = groupe.filter(l => gardees.has(l));
    if (restantes.length > 1) {
      nomsEnDouble++;
      restantes.forEach(l => aRenommer.add(l));
    } else {
      nomsPris.add(nom);
    }
  }

  const sortie = [];
  for (const l of lignes) {
    if (!gardees.has(l)) continue;
    if (!aRenommer.has(l)) { sortie.push(l); continue; }
    const avant = cle(l.nom);
    const ref = cle(l.reference);
    let apres = ref ? `${avant} (réf ${ref})` : `${avant} (ligne ${l._line})`;
    // Filet : le nom suffixé ne doit pas tomber sur un nom déjà pris.
    if (nomsPris.has(apres)) apres = `${apres} (ligne ${l._line})`;
    nomsPris.add(apres);
    renommes.push({ ligne: l._line, avant, apres });
    sortie.push({ ...l, nom: apres });
  }

  return { lignes: sortie, renommes, fusionnes, nomsEnDouble };
}
