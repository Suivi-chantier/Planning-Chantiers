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
export async function lireToutParTranches(requete, taille = 1000, parVague = 4) {
  const data = [];
  for (let vague = 0; ; vague++) {
    const pages = await Promise.all(Array.from({ length: parVague }, (_, i) => {
      const from = (vague * parVague + i) * taille;
      return requete(from, from + taille - 1);
    }));
    for (const { data: page, error } of pages) {
      if (error) return { data, error };
      data.push(...(page || []));
      if (!page || page.length < taille) return { data, error: null };
    }
  }
}
