// api/_cron/_destinataires-invest.js — Qui reçoit quoi, côté Invest.
//
// Deux crons ont besoin de la MÊME réponse à la question « qui reçoit le
// tableau de bord du matin ? » :
//
//   • cron-invest-tableau-bord.js — pour l'envoyer.
//   • cron-invest-echeances.js    — pour NE PAS envoyer une seconde fois, en
//     liste plate, des lignes déjà présentes dans le tableau de bord. Sans
//     cela, un destinataire recevrait deux mails le même matin disant à peu
//     près la même chose — et cesserait de les lire.
//
// Ce module existe pour que la règle n'ait qu'une définition. Il est à part
// parce qu'un `require` croisé entre les deux crons serait circulaire.
//
// Réglage : planning_config.invest_tableau_bord_destinataires
//   { "emails": ["matthieu.fumoleau@groupe-profero.com"] }
// À défaut, repli sur les utilisateurs actifs de la branche Invest dont le
// rôle est « admin » ou « direction » — ce sont eux qui arbitrent.

const CONFIG_KEY = "invest_tableau_bord_destinataires";
const ROLES_PILOTES = ["admin", "direction"];

// Renvoie [{ email, nom, role }]. Le `nom` sert de `profil` au moteur du
// tableau de bord : c'est lui qui décide ce qui est « à moi » et ce qui est
// « délégué ». Un destinataire sans nom verrait tous ses dossiers passer pour
// délégués — donc un mail vide de sa propre charge.
async function destinatairesTableauBord(supabase) {
  const { data: utilisateurs, error } = await supabase
    .from("utilisateurs")
    .select("nom,email,role,branches,actif")
    .eq("actif", true);

  if (error) {
    console.warn("[invest-tableau-bord] utilisateurs indisponibles:", error.message);
    return [];
  }

  const parEmail = new Map();
  for (const u of utilisateurs || []) {
    const email = String(u?.email || "").trim().toLowerCase();
    if (email) parEmail.set(email, { email, nom: u.nom || "", role: u.role || "" });
  }

  const { data: cfg } = await supabase.from("planning_config")
    .select("value").eq("key", CONFIG_KEY).maybeSingle();
  const listeReglee = Array.isArray(cfg?.value?.emails) ? cfg.value.emails : null;

  if (listeReglee && listeReglee.length) {
    // Un e-mail réglé à la main mais absent de la table `utilisateurs` reste
    // servi : il recevra le tableau de bord vu « sans identité », c'est-à-dire
    // tout en délégué. On le signale plutôt que de le taire.
    return listeReglee.map(e => {
      const cle = String(e || "").trim().toLowerCase();
      const connu = parEmail.get(cle);
      if (!connu) console.warn(`[invest-tableau-bord] ${cle} n'est pas dans utilisateurs : dossiers non attribués`);
      return connu || { email: cle, nom: "", role: "" };
    }).filter(d => d.email);
  }

  return (utilisateurs || [])
    .filter(u => Array.isArray(u.branches) ? u.branches.includes("invest") : true)
    .filter(u => ROLES_PILOTES.includes(String(u.role || "").toLowerCase()))
    .map(u => ({ email: String(u.email || "").trim().toLowerCase(), nom: u.nom || "", role: u.role || "" }))
    .filter(d => d.email);
}

module.exports = { destinatairesTableauBord, CONFIG_KEY_TABLEAU_BORD: CONFIG_KEY };
