// ─────────────────────────────────────────────────────────────────────────────
// materiauxACommanderV1 — matériaux prévisionnels à commander un jour donné
// (date butoir atteinte).
//
// Calcul SORTI tel quel de api/_cron/cron-recap-commandes.js (projet
// docs/projets/notifications-push.md, tâche 5, règle 3 : on réutilise la
// logique du récap commandes, on ne la réécrit pas). La règle n'a pas changé :
//   - on parcourt, pour chaque phasage, les clés `<phase>__materiaux_prevus`
//     de plan_travaux qui contiennent au moins un matériau ;
//   - la phase est retenue si `<phase>__date_commande` vaut EXACTEMENT la date
//     demandée (AAAA-MM-JJ) ;
//   - elle est écartée si `<phase>__cout_commandes` > 0 (déjà commandée).
//
// Module PUR : aucun accès Supabase, aucune horloge, aucun effet de bord. Les
// phasages, les chantiers (planning_config « chantiers »), les phases
// (planning_config « phases_travaux ».items) et la date du jour arrivent en
// paramètre. Utilisé par :
//   - le mail récap du vendredi (api/_cron/cron-recap-commandes.js) ;
//   - scripts/verif-materiaux-a-commander.mjs (données fictives).
// Depuis la tâche 10, la notification C3 ne l'utilise plus : elle suit la page
// « Commandes à passer » (commandesAPasserV1.mjs). Le récap du vendredi garde
// ce calcul (règle 8). notificationMateriauxACommander n'est plus appelée par
// le job ; elle reste ici, vérifiée, pour ne rien retirer au module.
// Façade front : materiauxACommanderV1.js.
// ─────────────────────────────────────────────────────────────────────────────

export const SUFFIXE_MATERIAUX_PREVUS = "__materiaux_prevus";

/**
 * Phases dont les matériaux prévisionnels sont à commander à la date donnée.
 * @param {{
 *   phasages: Array<{ id, chantier_id, chantier_nom, plan_travaux }>,
 *   chantiers: Array<{ id, nom, couleur }>,
 *   phases: Array<{ id, label, emoji, couleur }>,
 *   dateIso: string,   // AAAA-MM-JJ, jour de Paris
 * }} p
 * @returns {Array<{ phasageId, chantierId, chantierNom, chantierCouleur, phaseId,
 *   phaseLabel, phaseEmoji, materiaux: Array<object>, totalHt: number }>}
 */
export function materiauxACommander({ phasages, chantiers, phases, dateIso }) {
  const phasesArr  = Array.isArray(phases) ? phases : [];
  const phasesById = phasesArr.reduce((acc, ph) => { acc[ph.id] = ph; return acc; }, {});
  const chantById  = (Array.isArray(chantiers) ? chantiers : []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

  const commandesPrevues = [];
  for (const p of phasages || []) {
    const plan = p.plan_travaux || {};
    for (const key of Object.keys(plan)) {
      if (!key.endsWith(SUFFIXE_MATERIAUX_PREVUS)) continue;
      const mats = plan[key];
      if (!Array.isArray(mats) || mats.length === 0) continue;
      const phaseId  = key.slice(0, -SUFFIXE_MATERIAUX_PREVUS.length);
      const dateCmd  = plan[phaseId + "__date_commande"]; // YYYY-MM-DD attendu
      if (!dateCmd || dateCmd !== dateIso) continue;
      // Pas encore commandé ? On affiche quand même si __cout_commandes > 0
      // pour traçabilité, mais on note le statut.
      const dejaCommande = (parseFloat(plan[phaseId + "__cout_commandes"]) || 0) > 0;
      if (dejaCommande) continue; // Skip : déjà passé

      const phaseInfo = phasesById[phaseId] || { label: phaseId, emoji: "", couleur: "#888" };
      const chantInfo = chantById[p.chantier_id] || null;
      const materiauxFmt = mats.map(m => ({
        libelle:        m.libelle || "",
        quantite:       m.quantite || 0,
        unite:          m.unite || "",
        prix_ht:        parseFloat(m.prix_ht) || 0,
        fournisseur_nom: m.fournisseur_nom || "",
        total:          (parseFloat(m.prix_ht) || 0) * (parseFloat(m.quantite) || 0),
      }));
      const totalHt = materiauxFmt.reduce((s, m) => s + m.total, 0);

      commandesPrevues.push({
        phasageId:       p.id,
        chantierId:      p.chantier_id,
        chantierNom:     chantInfo?.nom || p.chantier_nom || "(sans chantier)",
        chantierCouleur: chantInfo?.couleur || phaseInfo.couleur,
        phaseId,
        phaseLabel:      phaseInfo.label || phaseId,
        phaseEmoji:      phaseInfo.emoji || "",
        materiaux:       materiauxFmt,
        totalHt,
      });
    }
  }
  return commandesPrevues;
}

/** Lien interne de l'écran « Commandes à passer » (même cible que le mail récap). */
export const LIEN_COMMANDES_A_PASSER = "/#planning-commandes";

/**
 * Contenu de la notification C3 (une seule par jour, regroupée), ou null si
 * rien n'est à commander : liste vide = aucun envoi.
 * @param {{ commandesPrevues: Array<object>, dateIso: string }} p
 */
export function notificationMateriauxACommander({ commandesPrevues, dateIso }) {
  const liste = Array.isArray(commandesPrevues) ? commandesPrevues : [];
  const nbMateriaux = liste.reduce((s, p) => s + (p.materiaux?.length || 0), 0);
  if (nbMateriaux === 0) return null;

  const titre = `${nbMateriaux} matériau${nbMateriaux > 1 ? "x" : ""} à commander aujourd'hui`;
  const noms = [];
  for (const p of liste) if (!noms.includes(p.chantierNom)) noms.push(p.chantierNom);
  const MAX = 3;
  const chantiersTxt = noms.slice(0, MAX).join(", ")
    + (noms.length > MAX ? ` et ${noms.length - MAX} autre${noms.length - MAX > 1 ? "s" : ""}` : "");
  const totalHt = liste.reduce((s, p) => s + (Number(p.totalHt) || 0), 0);
  const texte = `${noms.length > 1 ? "Chantiers" : "Chantier"} : ${chantiersTxt}. `
    + `Total prévu : ${formaterEuros(totalHt)} HT. Date butoir atteinte.`;

  return {
    type: "C3",
    titre,
    texte: texte.length > 1000 ? texte.slice(0, 997) + "…" : texte,
    lien: LIEN_COMMANDES_A_PASSER,
    cle_regroupement: `C3-${dateIso}`,
  };
}

/** 1234.5 → « 1 234,50 € » (sans dépendre des données de langue de l'environnement). */
function formaterEuros(n) {
  const [ent, dec] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split(".");
  return `${ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec} €`;
}
