// src/Renovation/lectureParTranches.js — lecture COMPLÈTE d'une table.
// Supabase s'arrête à 1 000 lignes par requête SANS le signaler : une page qui
// lit les pointages (2 445 au 24/10/2026) ou les lignes de commande (1 692)
// d'un seul coup calcule sur des données tronquées. On lit par tranches de
// 1 000 jusqu'à la dernière.
//
// `requete(from, to)` construit la requête d'une tranche, par exemple :
//   (a, b) => supabase.from("pointages").select("*").order("id").range(a, b)
// Le tri (.order) est indispensable : sans lui, deux tranches peuvent se
// recouvrir ou sauter des lignes.
// Rend { data, error } comme Supabase ; en cas d'erreur, `data` contient ce
// qui a déjà été lu et `error` le message (l'appelant décide).
//
// Les tranches sont lues par VAGUES de `parVague` requêtes en parallèle
// (06/11/2026) : une table de 8 000 lignes se lit en 2 allers-retours au lieu
// de 9. Les tranches sont assemblées dans l'ordre ; la lecture s'arrête à la
// première tranche incomplète ou en erreur, comme avant.
//
// Coupure réseau (11/11/2026) : « TypeError: Failed to fetch » signifie que le
// navigateur n'a reçu aucune réponse complète (téléchargement interrompu), alors
// que le serveur a bien répondu. Une tranche dans ce cas est relancée jusqu'à
// 2 fois avant d'être déclarée en erreur. Les autres erreurs (droits, colonne
// absente…) ne sont pas relancées : elles se reproduiraient à l'identique.
const ERREUR_RESEAU = /Failed to fetch|NetworkError|Load failed|network/i;

export async function lireTrancheAvecRelance(requete, from, to, relances = 2) {
  for (let essai = 0; ; essai++) {
    let res;
    try {
      res = await requete(from, to);
    } catch (e) {
      res = { data: null, error: { message: String(e?.message || e) } };
    }
    if (!res?.error || essai >= relances || !ERREUR_RESEAU.test(String(res.error.message || ""))) return res;
    await new Promise((r) => setTimeout(r, 500 * (essai + 1)));
  }
}

export async function lireToutParTranches(requete, taille = 1000, parVague = 4) {
  const data = [];
  for (let vague = 0; ; vague++) {
    const pages = await Promise.all(Array.from({ length: parVague }, (_, i) => {
      const from = (vague * parVague + i) * taille;
      return lireTrancheAvecRelance(requete, from, from + taille - 1);
    }));
    for (const { data: page, error } of pages) {
      if (error) return { data, error };
      data.push(...(page || []));
      if (!page || page.length < taille) return { data, error: null };
    }
  }
}
