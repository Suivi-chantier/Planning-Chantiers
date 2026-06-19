// Gardes anti-perte de données — confirmations préventives.
//
// Complément applicatif du filet de récupération en base (cf.
// sql/202606_data_history_filet_securite.sql). Le filet rattrape TOUT a
// posteriori ; ces gardes attrapent les opérations manifestement anormales
// AVANT qu'elles ne s'exécutent, pour éviter le « oups » plutôt que le subir.
//
// Pattern d'origine : la « garde anti-écrasement » inline de PhasageV2
// (relire le distant, confirmer si on s'apprête à supprimer une grosse part
// des données). Centralisé ici pour être réutilisé partout.

// Confirme une opération qui ferait DISPARAÎTRE une part importante des
// données existantes (suppression massive ou écrasement par un état réduit).
//
//   confirmPerteMassive({ label: "ouvrages", avant: 40, apres: 3 })
//
// Renvoie true si on peut continuer (perte non massive, OU l'utilisateur a
// confirmé), false s'il faut annuler. Ne demande rien quand la perte est
// petite ou normale.
//
// Paramètres :
//   label       : nom lisible de ce qu'on manipule (ex "pointages", "articles")
//   avant       : nombre d'éléments AVANT (idéalement relu depuis le distant)
//   apres       : nombre d'éléments APRÈS l'opération
//   seuilRatio  : on alerte si apres < avant * seuilRatio (défaut 0,5 = -50 %)
//   seuilMin    : on n'alerte jamais en dessous de ce nombre (défaut 3)
//   contexte    : ligne d'explication optionnelle ajoutée au message
export function confirmPerteMassive({
  label = "éléments",
  avant = 0,
  apres = 0,
  seuilRatio = 0.5,
  seuilMin = 3,
  contexte = "",
} = {}) {
  const perte = avant - apres;
  // Perte non significative → on laisse passer sans déranger.
  if (avant <= seuilMin) return true;
  if (apres >= avant * seuilRatio) return true;
  if (perte <= 0) return true;

  const msg =
    `⚠️ Opération inhabituelle détectée\n\n` +
    `${label} : ${avant} → ${apres}  (${perte} vont disparaître)\n\n` +
    (contexte ? contexte + `\n\n` : "") +
    `• Si c'est voulu, cliquez OK.\n` +
    `• Si c'est inattendu (un collègue éditait peut-être en même temps,\n` +
    `  ou un import incomplet), cliquez Annuler puis rechargez la page (F5).\n\n` +
    `Rien n'est perdu définitivement : une copie est conservée et restaurable\n` +
    `depuis Admin → Historique. Mais mieux vaut vérifier maintenant.`;

  return window.confirm(msg);
}

// Confirme une suppression massive de lignes (variante pratique quand on
// raisonne en « nombre de lignes que je vais supprimer ») par rapport au
// total existant.
//
//   confirmSuppressionMassive({ label: "articles", nbSupprimes: 120, total: 130 })
export function confirmSuppressionMassive({
  label = "éléments",
  nbSupprimes = 0,
  total = 0,
  seuilAbsolu = 10,
  seuilRatio = 0.5,
  contexte = "",
} = {}) {
  // On alerte si on supprime beaucoup en absolu ET une part notable du total.
  if (nbSupprimes < seuilAbsolu) return true;
  if (total > 0 && nbSupprimes < total * seuilRatio) return true;

  const restant = Math.max(0, total - nbSupprimes);
  const msg =
    `⚠️ Suppression massive détectée\n\n` +
    `${nbSupprimes} ${label} vont être supprimés` +
    (total ? ` (sur ${total}, il en restera ${restant}).` : `.`) +
    `\n\n` +
    (contexte ? contexte + `\n\n` : "") +
    `• Si c'est voulu, cliquez OK.\n` +
    `• Sinon, cliquez Annuler.\n\n` +
    `Une copie est conservée et restaurable depuis Admin → Historique.`;

  return window.confirm(msg);
}
