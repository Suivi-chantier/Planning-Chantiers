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
export async function lireToutParTranches(requete, taille = 1000) {
  const data = [];
  for (let from = 0; ; from += taille) {
    const { data: page, error } = await requete(from, from + taille - 1);
    if (error) return { data, error };
    data.push(...(page || []));
    if (!page || page.length < taille) return { data, error: null };
  }
}
