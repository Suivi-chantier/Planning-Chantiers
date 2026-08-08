// api/ai.js — route unique de TOUS les appels IA (Chantier 0, Brique 1).
// Réf. : public/chantier-0-socle-technique-ia.md § 3.
//
// Aucun composant React n'appelle jamais directement l'API Anthropic :
// tout transite ici, et la clé ANTHROPIC_API_KEY n'existe QUE dans les
// variables d'environnement Vercel côté serveur.
//
// Pipeline (§ 3.2) : authentifier → autoriser → [quota : étape 4] →
// charger la tâche → construire le prompt → appeler le modèle →
// valider la sortie (1 relance) → journaliser dans ia_jobs → répondre.
//
// Contrat (§ 3.3) :
//   POST /api/ai  { tache, entree, contexte? }  + Authorization: Bearer <jwt>
//   → 200 { ok:true, job_id, resultat, confiance?, meta:{ modele, duree_ms, cout_eur } }
//   → 4xx/5xx { ok:false, job_id, erreur:{ code, message } }
//
// Variables d'env requises (Vercel, serveur uniquement — jamais VITE_) :
//   ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

const { createClient } = require("@supabase/supabase-js");
const Anthropic = require("@anthropic-ai/sdk");
const REGISTRE = require("./_ia/registre");

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Tarifs approximatifs en €/million de tokens (USD officiels × ~0,92).
// À tenir à jour quand un nouveau modèle est utilisé par une tâche ;
// modèle absent → cout_eur null dans ia_jobs (jamais bloquant).
const TARIFS_EUR_PAR_MTOK = {
  "claude-opus-5":    { entree: 4.6,  sortie: 23.0 },
  "claude-sonnet-5":  { entree: 2.76, sortie: 13.8 },
  "claude-haiku-4-5": { entree: 0.92, sortie: 4.6 },
};

// Quotas & coupe-circuit (§ 3.5) — paramétrables dans planning_config sous la
// clé "ia_config" (jsonb) ; toute valeur absente retombe sur ces défauts.
// { "active": false } = coupe-circuit : coupe toutes les fonctions IA en
// moins d'une minute, sans redéploiement.
const IA_CONFIG_DEFAUT = {
  active: true,
  plafond_appels_user_jour: 200, // nb d'appels par utilisateur, 24 h glissantes
  plafond_eur_user_jour: 5,      // coût cumulé par utilisateur, 24 h glissantes
  plafond_eur_global_mois: 200,  // coût cumulé entreprise, mois calendaire
  alerte_pct: 80,                // seuil d'alerte du plafond global
};

async function chargerConfigIA(admin) {
  const { data, error } = await admin
    .from("planning_config").select("value").eq("key", "ia_config").maybeSingle();
  if (error) throw new Error(`planning_config/ia_config : ${error.message}`);
  return { ...IA_CONFIG_DEFAUT, ...((data && data.value) || {}) };
}

// Compte les appels et somme les coûts dans ia_jobs depuis une date, pour un
// utilisateur (email) ou globalement (email null). Paginé : PostgREST limite
// chaque requête à ~1000 lignes, une somme sur données tronquées serait fausse.
async function statsJobs(admin, depuisISO, email) {
  let count = 0, cout = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = admin.from("ia_jobs").select("cout_eur")
      .gte("cree_le", depuisISO).range(from, from + PAGE - 1);
    if (email) q = q.eq("utilisateur_email", email);
    const { data, error } = await q;
    if (error) throw new Error(`ia_jobs stats : ${error.message}`);
    count += data.length;
    for (const r of data) cout += Number(r.cout_eur) || 0;
    if (data.length < PAGE) break;
  }
  return { count, cout };
}

function calculerCout(modele, tokensEntree, tokensSortie) {
  const t = TARIFS_EUR_PAR_MTOK[modele];
  if (!t || !Number.isFinite(tokensEntree) || !Number.isFinite(tokensSortie)) return null;
  const eur = (tokensEntree * t.entree + tokensSortie * t.sortie) / 1e6;
  return Math.round(eur * 1e5) / 1e5; // aligné sur numeric(10,5) de ia_jobs
}

// Normalise le retour d'un schema_entree / schema_sortie :
// true/undefined → ok ; string → [string] ; array → array d'erreurs.
function valider(schema, data) {
  if (typeof schema !== "function") return { ok: true, erreurs: [] };
  const r = schema(data);
  if (r === true || r === undefined || r === null) return { ok: true, erreurs: [] };
  if (r === false) return { ok: false, erreurs: ["donnée invalide"] };
  const erreurs = Array.isArray(r) ? r : [String(r)];
  return { ok: erreurs.length === 0, erreurs };
}

function texteDe(reponse) {
  return (reponse.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function parserSortie(tache, texte) {
  if (typeof tache.parser_sortie === "function") return tache.parser_sortie(texte);
  try {
    return JSON.parse(texte);
  } catch {
    return { texte };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, job_id: null, erreur: { code: "erreur_interne", message: "Méthode non autorisée" } });
  }

  if (!SUPABASE_URL || !SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ ok: false, job_id: null, erreur: { code: "erreur_interne", message: "Variables d'environnement manquantes côté serveur" } });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const debut = Date.now();

  // Contexte du job, enrichi au fil du pipeline puis journalisé dans ia_jobs
  // — y compris en échec (§ 4.1 : un appel en échec est loggé au même titre
  // qu'un succès).
  const job = {
    utilisateur_id: null,
    utilisateur_email: null,
    role: null,
    branche: null,
    tache: null,
    chantier_id: null,
    entite_type: null,
    entite_id: null,
    entree: null,
    sortie_brute: null,
    statut: "echec",
    erreur_code: null,
    erreur_message: null,
    modele: null,
    tokens_entree: null,
    tokens_sortie: null,
    cout_eur: null,
    duree_ms: null,
  };

  async function journaliser() {
    job.duree_ms = Date.now() - debut;
    try {
      const { data, error } = await admin.from("ia_jobs").insert(job).select("id").single();
      if (error) { console.error("ia_jobs insert:", error.message); return null; }
      return data?.id || null;
    } catch (e) {
      console.error("ia_jobs insert:", e.message);
      return null;
    }
  }

  async function echouer(status, code, message) {
    job.erreur_code = code;
    job.erreur_message = message;
    const jobId = await journaliser();
    return res.status(status).json({ ok: false, job_id: jobId, erreur: { code, message } });
  }

  try {
    const { tache: tacheId, entree, contexte } = req.body || {};
    job.tache = typeof tacheId === "string" ? tacheId : "(absente)";
    job.entree = entree ?? null;
    if (contexte && typeof contexte === "object") {
      job.chantier_id = contexte.chantier_id || null;
      job.branche = contexte.branche || null;
      job.entite_type = contexte.entite_type || null;
      job.entite_id = contexte.entite_id || null;
    }

    // 1) Authentifier — JWT Supabase transmis par le client
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return echouer(401, "non_authentifie", "Jeton d'authentification manquant");

    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !authData?.user?.email) {
      return echouer(401, "non_authentifie", "Jeton invalide ou expiré");
    }
    job.utilisateur_id = authData.user.id;
    job.utilisateur_email = authData.user.email;

    const { data: profil, error: profilErr } = await admin
      .from("utilisateurs")
      .select("id, email, nom, role, actif")
      .eq("email", authData.user.email)
      .single();
    if (profilErr || !profil) return echouer(401, "non_authentifie", "Profil utilisateur introuvable");
    if (profil.actif === false) return echouer(403, "non_autorise", "Compte désactivé");
    job.role = profil.role;

    // 2) Charger la tâche depuis le registre
    const tache = REGISTRE[tacheId];
    if (!tache) return echouer(404, "tache_inconnue", `Tâche inconnue : ${tacheId}`);
    job.modele = tache.modele || null;

    // 3) Autoriser — le rôle doit être déclaré par la tâche
    if (Array.isArray(tache.roles) && !tache.roles.includes(profil.role)) {
      return echouer(403, "non_autorise", `Le rôle "${profil.role}" n'est pas autorisé pour cette tâche`);
    }

    // 4) Coupe-circuit + quotas (§ 3.5). Les refus sont journalisés dans
    //    ia_jobs comme n'importe quel échec. En cas de panne du contrôle
    //    lui-même, on BLOQUE (fail-closed) : les quotas sont la protection
    //    contre l'emballement des coûts, pas une option.
    const cfg = await chargerConfigIA(admin);
    if (cfg.active === false) {
      return echouer(503, "modele_indisponible", "Fonctions IA désactivées par l'administrateur (coupe-circuit)");
    }
    {
      const depuis24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const debutMois = new Date();
      debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
      const [statsUser, statsGlobal] = await Promise.all([
        statsJobs(admin, depuis24h, profil.email),
        statsJobs(admin, debutMois.toISOString(), null),
      ]);
      if (cfg.plafond_appels_user_jour && statsUser.count >= cfg.plafond_appels_user_jour) {
        return echouer(429, "quota_depasse", `Plafond de ${cfg.plafond_appels_user_jour} appels IA par 24 h atteint`);
      }
      if (cfg.plafond_eur_user_jour && statsUser.cout >= cfg.plafond_eur_user_jour) {
        return echouer(429, "quota_depasse", `Plafond de ${cfg.plafond_eur_user_jour} € d'IA par 24 h atteint`);
      }
      if (cfg.plafond_eur_global_mois && statsGlobal.cout >= cfg.plafond_eur_global_mois) {
        return echouer(429, "quota_depasse", `Plafond mensuel global de ${cfg.plafond_eur_global_mois} € atteint pour l'entreprise`);
      }
      const seuilAlerte = cfg.plafond_eur_global_mois * ((cfg.alerte_pct || 80) / 100);
      if (cfg.plafond_eur_global_mois && statsGlobal.cout >= seuilAlerte) {
        // L'écran admin (étape 6) affichera la barre de progression ; en
        // attendant, la trace serveur suffit à ne pas être aveugle.
        console.warn(`[ia] alerte coût : ${Math.round(statsGlobal.cout * 100) / 100} € consommés ce mois-ci (seuil ${cfg.alerte_pct || 80}% de ${cfg.plafond_eur_global_mois} €)`);
      }
    }

    // 5) Valider l'entrée
    const vEntree = valider(tache.schema_entree, entree);
    if (!vEntree.ok) {
      return echouer(400, "entree_invalide", `Entrée invalide : ${vEntree.erreurs.join(" ; ")}`);
    }

    // 6) Construire le prompt puis appeler le modèle
    const prompt = tache.construire_prompt(entree, contexte || {});
    const anthropic = new Anthropic();
    const params = {
      model: tache.modele,
      max_tokens: tache.max_tokens || 8192,
      messages: prompt.messages,
    };
    if (prompt.system) params.system = prompt.system;

    let reponse;
    try {
      reponse = await anthropic.messages.create(params);
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError ||
          e instanceof Anthropic.InternalServerError) {
        return echouer(503, "modele_indisponible", `Modèle indisponible : ${e.message}`);
      }
      return echouer(500, "erreur_interne", `Erreur d'appel au modèle : ${e.message}`);
    }

    job.tokens_entree = reponse.usage?.input_tokens ?? null;
    job.tokens_sortie = reponse.usage?.output_tokens ?? null;
    job.cout_eur = calculerCout(tache.modele, job.tokens_entree, job.tokens_sortie);

    if (reponse.stop_reason === "refusal") {
      return echouer(502, "sortie_invalide", "Le modèle a refusé de traiter cette demande");
    }
    if (reponse.stop_reason === "max_tokens") {
      return echouer(502, "sortie_invalide", "Réponse tronquée (max_tokens atteint) — augmenter max_tokens de la tâche");
    }

    // 7) Valider la sortie ; en cas d'échec, UNE relance corrective, puis erreur
    let texte = texteDe(reponse);
    let resultat = parserSortie(tache, texte);
    job.sortie_brute = resultat;
    let vSortie = valider(tache.schema_sortie, resultat);

    if (!vSortie.ok) {
      let relance;
      try {
        relance = await anthropic.messages.create({
          ...params,
          messages: [
            ...prompt.messages,
            { role: "assistant", content: texte || "(réponse vide)" },
            {
              role: "user",
              content:
                "Ta réponse ne respecte pas le format attendu. Erreurs : " +
                vSortie.erreurs.join(" ; ") +
                ". Renvoie UNIQUEMENT la réponse corrigée, sans commentaire.",
            },
          ],
        });
      } catch (e) {
        return echouer(503, "modele_indisponible", `Modèle indisponible (relance) : ${e.message}`);
      }
      job.tokens_entree = (job.tokens_entree || 0) + (relance.usage?.input_tokens || 0);
      job.tokens_sortie = (job.tokens_sortie || 0) + (relance.usage?.output_tokens || 0);
      job.cout_eur = calculerCout(tache.modele, job.tokens_entree, job.tokens_sortie);

      texte = texteDe(relance);
      resultat = parserSortie(tache, texte);
      job.sortie_brute = resultat;
      vSortie = valider(tache.schema_sortie, resultat);
      if (!vSortie.ok) {
        return echouer(502, "sortie_invalide", `Sortie invalide après relance : ${vSortie.erreurs.join(" ; ")}`);
      }
    }

    // Garde-fou de coût par appel (§ 3.5) — contrôlé a posteriori : on ne
    // livre pas un résultat qui a dépassé le plafond déclaré par la tâche.
    if (tache.cout_max_eur && job.cout_eur && job.cout_eur > tache.cout_max_eur) {
      return echouer(500, "erreur_interne", `Coût de l'appel (${job.cout_eur} €) au-delà du plafond de la tâche (${tache.cout_max_eur} €)`);
    }

    // 8) Journaliser le succès — tâche sensible → validation humaine requise
    job.statut = tache.sensible ? "en_attente_validation" : "succes";
    const jobId = await journaliser();

    // 9) Répondre — payload normalisé
    const confiance =
      typeof tache.calculer_confiance === "function" ? tache.calculer_confiance(resultat) : undefined;
    const corps = {
      ok: true,
      job_id: jobId,
      resultat,
      meta: { modele: tache.modele, duree_ms: job.duree_ms, cout_eur: job.cout_eur },
    };
    if (confiance !== undefined) corps.confiance = confiance;
    return res.status(200).json(corps);
  } catch (e) {
    console.error("api/ai:", e);
    return echouer(500, "erreur_interne", e.message || "Erreur inconnue");
  }
};
