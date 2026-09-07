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

    // 3bis) Autorisation propre à la tâche, quand le rôle seul ne suffit pas.
    //
    // Le champ `utilisateurs.role` est UNIQUE et partagé par les deux branches :
    // « commercial » existe côté Rénovation et côté Invest, avec des droits
    // différents. Une tâche qui ne concerne qu'une branche doit donc pouvoir
    // vérifier autre chose que le rôle. Elle renvoie true, ou une chaîne
    // expliquant le refus.
    if (typeof tache.autoriser === "function") {
      let verdict;
      try {
        verdict = await tache.autoriser(profil);
      } catch (e) {
        return echouer(500, "erreur_interne", `Contrôle d'autorisation de la tâche : ${e.message}`);
      }
      if (verdict !== true) {
        return echouer(403, "non_autorise", typeof verdict === "string" ? verdict : "Accès refusé pour cette tâche");
      }
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

    // 6bis) Outils, si la tâche en déclare.
    //
    // La liste est calculée à chaque appel depuis le profil du JWT : une tâche
    // peut n'exposer qu'un sous-ensemble d'outils selon les droits de
    // l'appelant. Un outil non exposé n'existe pas pour le modèle — il ne peut
    // donc être ni appelé, ni halluciné.
    //
    // Les schémas sont déclarés dans un format neutre ({ nom, description,
    // schema }) et traduits ici, au dernier moment, au dialecte du
    // fournisseur. C'est ce qui permettra de changer de fournisseur sans
    // toucher aux outils.
    let outils = [];
    if (typeof tache.construire_outils === "function") {
      try {
        outils = (await tache.construire_outils(profil)) || [];
      } catch (e) {
        return echouer(500, "erreur_interne", `Construction des outils : ${e.message}`);
      }
    }
    const parNomOutil = new Map(outils.map((o) => [o.nom, o]));
    if (outils.length) {
      params.tools = outils.map((o) => ({
        name: o.nom,
        description: o.description,
        input_schema: o.schema || { type: "object", properties: {} },
      }));
    }

    // Garde-fous de la boucle. Sans plafond d'itérations, un modèle qui
    // s'entête appellerait le même outil indéfiniment ; sans plafond de
    // résultats, dix appels successifs rempliraient le contexte et la facture.
    const MAX_TOURS = 5;
    const MAX_APPELS_OUTILS = 8;
    const MAX_OCTETS_RESULTATS = 120000;

    const traceOutils = [];   // {nom, params} — journalisé, sans les résultats
    const blocsOutils = [];   // les sorties d'outils, jointes à la réponse
    let appelsOutils = 0;
    let octetsResultats = 0;

    // Les usages se cumulent sur TOUS les tours : le coût d'un appel avec
    // outils est la somme des allers-retours, pas celui du dernier.
    function cumulerUsage(r) {
      job.tokens_entree = (job.tokens_entree || 0) + (r.usage?.input_tokens || 0);
      job.tokens_sortie = (job.tokens_sortie || 0) + (r.usage?.output_tokens || 0);
      job.cout_eur = calculerCout(tache.modele, job.tokens_entree, job.tokens_sortie);
    }

    async function appeler(p) {
      try {
        return await anthropic.messages.create(p);
      } catch (e) {
        if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError ||
            e instanceof Anthropic.InternalServerError) {
          throw { _code: 503, _erreur: "modele_indisponible", _message: `Modèle indisponible : ${e.message}` };
        }
        throw { _code: 500, _erreur: "erreur_interne", _message: `Erreur d'appel au modèle : ${e.message}` };
      }
    }

    let reponse;
    try {
      reponse = await appeler(params);
    } catch (e) {
      if (e && e._erreur) return echouer(e._code, e._erreur, e._message);
      return echouer(500, "erreur_interne", e?.message || "Erreur inconnue");
    }
    cumulerUsage(reponse);

    // Boucle de tool use. Le modèle demande un ou plusieurs outils, on les
    // exécute côté serveur, on lui renvoie les résultats, il recommence ou
    // conclut. Une tâche sans outils ne franchit jamais ce `while`.
    let tours = 0;
    while (reponse.stop_reason === "tool_use" && outils.length) {
      if (++tours > MAX_TOURS) {
        return echouer(502, "sortie_invalide",
          `Le modèle n'a pas conclu après ${MAX_TOURS} tours d'outils`);
      }

      const demandes = (reponse.content || []).filter((b) => b.type === "tool_use");
      const resultats = [];

      for (const d of demandes) {
        if (++appelsOutils > MAX_APPELS_OUTILS) {
          return echouer(502, "sortie_invalide",
            `Plafond de ${MAX_APPELS_OUTILS} appels d'outils atteint pour une seule question`);
        }

        const outil = parNomOutil.get(d.name);
        let contenu;
        if (!outil) {
          // Outil inconnu ou non autorisé pour ce rôle : on le dit au modèle
          // plutôt que d'échouer, il peut se rabattre sur autre chose.
          contenu = JSON.stringify({ erreur: `Outil indisponible : ${d.name}` });
        } else {
          traceOutils.push({ nom: d.name, params: d.input || {} });
          try {
            const sortie = await outil.executer(d.input || {});
            const brut = JSON.stringify(sortie ?? null);
            octetsResultats += brut.length;
            if (octetsResultats > MAX_OCTETS_RESULTATS) {
              return echouer(502, "sortie_invalide",
                "Volume de résultats d'outils trop important pour une seule question");
            }
            blocsOutils.push({ outil: d.name, resultat: sortie });
            contenu = brut;
          } catch (e) {
            // Une erreur d'outil est une donnée pour le modèle, pas une panne
            // de la route : il doit pouvoir répondre « je n'ai pas trouvé ».
            console.warn(`[ai] outil ${d.name} :`, e.message);
            contenu = JSON.stringify({ erreur: String(e.message || e).slice(0, 300) });
          }
        }

        resultats.push({ type: "tool_result", tool_use_id: d.id, content: contenu });
      }

      params.messages = [
        ...params.messages,
        { role: "assistant", content: reponse.content },
        { role: "user", content: resultats },
      ];

      try {
        reponse = await appeler(params);
      } catch (e) {
        if (e && e._erreur) return echouer(e._code, e._erreur, e._message);
        return echouer(500, "erreur_interne", e?.message || "Erreur inconnue");
      }
      cumulerUsage(reponse);
    }

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
        // On repart de `params.messages` et non de `prompt.messages` : après
        // une boucle d'outils, le premier contient l'échange complet, y
        // compris les résultats. Repartir du prompt initial ferait répondre
        // le modèle sans les données qu'il vient de lire.
        //
        // Les outils sont retirés de la relance : on veut une réponse au bon
        // format, pas un nouvel appel d'outil qui ne serait plus bouclé.
        const paramsRelance = { ...params };
        delete paramsRelance.tools;
        relance = await anthropic.messages.create({
          ...paramsRelance,
          messages: [
            ...params.messages,
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
    //
    // On journalise QUELS outils ont été appelés avec quels paramètres, mais
    // JAMAIS les lignes qu'ils ont retournées. Le socle prévient déjà (§ 4.3) :
    // « ne jamais stocker en clair dans entree des coordonnées client
    // complètes si la tâche ne l'exige pas ». Une question du Copilote et la
    // trace de ses outils suffisent à auditer ; les données, non.
    if (traceOutils.length) job.entree = { ...(job.entree || {}), _outils: traceOutils };
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
    // Les sorties d'outils sont jointes TELLES QUELLES, collectées côté
    // serveur. Le modèle ne les réémet pas : c'est le seul mécanisme
    // anti-hallucination qui ne dépende pas de sa bonne volonté — l'interface
    // ne peut afficher que ce qui vient d'un outil.
    if (blocsOutils.length) {
      corps.blocs = blocsOutils;
      corps.outils_utilises = traceOutils.map((t) => t.nom);
    }
    if (confiance !== undefined) corps.confiance = confiance;
    return res.status(200).json(corps);
  } catch (e) {
    console.error("api/ai:", e);
    return echouer(500, "erreur_interne", e.message || "Erreur inconnue");
  }
};
