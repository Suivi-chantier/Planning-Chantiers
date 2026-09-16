// Anti-écho des écritures de configuration partagée (planning_config).
//
// PROBLÈME RÉSOLU — le « rollback » pendant la saisie.
// Plusieurs écrans écrivent une clé de planning_config à CHAQUE frappe
// (nom de chantier, taux horaires, %…), et App.jsx est abonné en temps réel à
// cette même table : chaque écriture nous revient en écho quelques centaines de
// millisecondes plus tard, et ré-applique la valeur telle qu'elle était AU
// MOMENT DE L'ENVOI. Si l'utilisateur a continué à taper entre-temps, l'écho
// écrase les caractères suivants : le champ « revient en arrière ».
//
// Le registre ci-dessous note quand on a écrit une clé nous-mêmes. Les
// abonnements temps réel ignorent les événements qui tombent dans cette
// fenêtre : notre état local est déjà la vérité (c'est nous qui venons de
// l'écrire), inutile de le réécrire avec une version plus ancienne.
//
// Conséquence assumée : si un collègue modifie la MÊME clé dans les 3 secondes
// qui suivent notre propre écriture, on ne voit pas sa version tout de suite
// (elle arrive au prochain chargement de la page). C'est déjà la règle du
// dernier qui écrit : ces clés sont éditées depuis l'Administration, à une
// seule main dans les faits.

const dernieresEcritures = new Map(); // clé planning_config -> horodatage ms

// Fenêtre d'ignorance après NOTRE dernière écriture. Assez large pour couvrir
// l'aller-retour réseau de l'écho, assez courte pour ne pas masquer longtemps
// les modifications d'un collègue.
const FENETRE_ECHO_MS = 3000;

/** À appeler juste avant ET juste après une écriture locale de cette clé. */
export function marquerEcritureConfig(cle) {
  if (!cle) return;
  dernieresEcritures.set(String(cle), Date.now());
}

/** true si un événement temps réel sur cette clé est l'écho de notre écriture. */
export function estEchoConfigLocal(cle) {
  if (!cle) return false;
  const t = dernieresEcritures.get(String(cle));
  if (t == null) return false;
  if (Date.now() - t < FENETRE_ECHO_MS) return true;
  dernieresEcritures.delete(String(cle));
  return false;
}
