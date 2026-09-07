// api/_ia/invest/outils.js — Les cinq outils en lecture seule de la V1.
//
// Contrat d'un outil :
//   nom          identifiant stable, exposé au modèle
//   page         page Invest dont dépend l'accès (portee.peut)
//   description  ce que le modèle lit pour décider s'il l'appelle
//   schema       JSON Schema des paramètres, neutre vis-à-vis du fournisseur
//   executer(params, ctx) → objet structuré
//
// LECTURE SEULE PAR CONSTRUCTION. Il n'y a aucun code d'écriture dans ce
// fichier : pas un insert, pas un update, pas un delete. Ce que la V2
// ajoutera, ce sont des fichiers ; ce que la V1 livre ne peut pas être
// retourné par une option de configuration.
//
// Aucun outil n'accepte de nom de table, de colonne, de tri libre ni de
// fragment SQL. Le modèle ne fournit que des valeurs, validées par le schéma.
//
// invest_prospects n'apparaît nulle part, et la couche donnees.js lèverait si
// un outil tentait de la lire.

const { table, borner } = require("./donnees");
const { chargerDossiers, exposerDossier, lienDossier } = require("./moteur");

// ─────────────────────────────────────────────────────────────────────────────
// Trois vues sur le moteur du tableau de bord
//
// Elles ne recalculent rien : elles lisent les alertes et les catégories déjà
// produites par consolidateData(), ce qui garantit qu'une réponse du Copilote
// et l'écran du tableau de bord ne se contrediront jamais.
//
// Page requise : « dashboard » OU « crm ». Le choix mérite un mot. Ces outils
// lisent invest_clients, invest_biens, invest_mission_actions, invest_planning
// et invest_propositions — exactement ce que les policies accordent à qui a
// « crm » ou « biens ». Les adosser au seul « dashboard » les refuserait à un
// commercial, alors qu'il peut déjà lire ces mêmes données dans son CRM : ce
// serait une gêne sans gain de sécurité. Le gain de sécurité, lui, est ailleurs
// et il est réel : un agent_edl, qui n'a ni « dashboard » ni « crm », n'y a pas
// accès du tout.
// ─────────────────────────────────────────────────────────────────────────────

const dossiers_bloques = {
  nom: "dossiers_bloques",
  pages: ["dashboard", "crm"],
  description:
    "Liste les dossiers clients ou biens qui demandent une intervention : blocage saisi par " +
    "l'équipe, absence de prochaine action, absence de responsable, ou dossier sans avancée " +
    "depuis plus de dix jours. Utiliser pour « quels dossiers sont bloqués ? », « qu'est-ce " +
    "qui coince ? », « quels dossiers attendent le financement ? ».",
  schema: {
    type: "object",
    properties: {
      motif: {
        type: "string",
        enum: ["tous", "bloque", "sans_action", "sans_responsable", "sans_avancee", "financement"],
        description: "Filtre sur la nature du blocage. « tous » par défaut.",
      },
      limite: { type: "integer", description: "Nombre maximum de dossiers (défaut 20, max 50)." },
    },
  },
  async executer(params, ctx) {
    const motif = params.motif || "tous";
    const limite = borner(params.limite, 20, 50);
    const { consolide, moteur: m, avertissements } = await chargerDossiers({ profil: ctx.profil });

    const CODES = {
      bloque: (a) => a.code.startsWith("blocked") || /bloqu|compliqu/i.test(a.label),
      sans_action: (a) => a.code === "no_next_action",
      sans_responsable: (a) => a.code === "no_owner",
      sans_avancee: (a) => a.code === "stale_red" || a.code === "stale_orange",
    };

    let retenus = (consolide.allDossiers || []).filter((d) => {
      const alertes = d.alerts || [];
      if (motif === "tous") {
        return alertes.some(
          (a) => CODES.bloque(a) || CODES.sans_action(a) || CODES.sans_responsable(a) || CODES.sans_avancee(a)
        );
      }
      if (motif === "financement") {
        // Étapes 9 et 10 de l'échelle client : dossier bancaire et obtention
        // du financement. Le libellé porte le numéro en préfixe.
        const etape = String((d.meta && d.meta.step) || "");
        return /^\s*(9|10)\b/.test(etape);
      }
      const test = CODES[motif];
      return test ? alertes.some(test) : false;
    });

    retenus = m.sortDossiers(retenus).slice(0, limite);

    return {
      type: "liste_dossiers",
      titre:
        retenus.length === 0
          ? "Aucun dossier bloqué"
          : `${retenus.length} dossier${retenus.length > 1 ? "s" : ""} à traiter`,
      motif,
      total: retenus.length,
      dossiers: retenus.map((d) => exposerDossier(d, m)),
      avertissements,
    };
  },
};

const echeances_a_venir = {
  nom: "echeances_a_venir",
  pages: ["dashboard", "crm"],
  description:
    "Liste les échéances des dossiers Invest sur une fenêtre de jours, retards inclus par " +
    "défaut. Utiliser pour « quelles échéances cette semaine ? », « qui a une échéance notaire " +
    "dans 15 jours ? », « qu'est-ce qui tombe bientôt ? ».",
  schema: {
    type: "object",
    properties: {
      jours: { type: "integer", description: "Fenêtre en jours à partir d'aujourd'hui (défaut 7, max 90)." },
      motif: {
        type: "string",
        description:
          "Filtre facultatif sur le libellé de l'étape ou de l'alerte : « notaire », " +
          "« financement », « compromis », « urbanisme »…",
      },
      inclure_retards: { type: "boolean", description: "Inclure les échéances déjà dépassées (défaut vrai)." },
      limite: { type: "integer", description: "Nombre maximum de lignes (défaut 25, max 60)." },
    },
  },
  async executer(params, ctx) {
    const jours = Math.min(Math.max(Number(params.jours) || 7, 1), 90);
    const limite = borner(params.limite, 25, 60);
    const inclureRetards = params.inclure_retards !== false;
    const motif = String(params.motif || "").trim().toLowerCase();

    const { consolide, moteur: m, avertissements, jour } = await chargerDossiers({ profil: ctx.profil });
    const aujourdhui = new Date(`${jour}T12:00:00Z`);
    const limiteHaute = new Date(aujourdhui.getTime() + jours * 86400000);

    const lignes = [];
    for (const d of consolide.allDossiers || []) {
      for (const a of d.alerts || []) {
        if (!a.due_date) continue;
        const date = new Date(`${String(a.due_date).slice(0, 10)}T12:00:00Z`);
        if (Number.isNaN(date.getTime())) continue;
        const enRetard = date < aujourdhui;
        if (enRetard && !inclureRetards) continue;
        if (!enRetard && date > limiteHaute) continue;
        if (motif && !`${a.label} ${d.meta && d.meta.step ? d.meta.step : ""} ${d.next_action}`.toLowerCase().includes(motif)) {
          continue;
        }
        lignes.push({
          date: String(a.due_date).slice(0, 10),
          jours_restants: Math.round((date - aujourdhui) / 86400000),
          en_retard: enRetard,
          type: d.type,
          dossier: d.label,
          etape: (d.meta && d.meta.step) || null,
          echeance: a.label,
          urgence: a.level,
          responsable: d.responsable || "",
          lien: lienDossier(d),
        });
      }
    }

    lignes.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    const retenues = lignes.slice(0, limite);

    return {
      type: "liste_echeances",
      titre:
        retenues.length === 0
          ? `Aucune échéance sur ${jours} jour${jours > 1 ? "s" : ""}`
          : `${retenues.length} échéance${retenues.length > 1 ? "s" : ""} sur ${jours} jour${jours > 1 ? "s" : ""}`,
      fenetre: { du: jour, jours, motif: motif || null, retards_inclus: inclureRetards },
      total: lignes.length,
      tronque: lignes.length > retenues.length,
      echeances: retenues,
      avertissements,
    };
  },
};

const priorites_du_jour = {
  nom: "priorites_du_jour",
  pages: ["dashboard", "crm"],
  description:
    "Renvoie les dossiers qui demandent un arbitrage aujourd'hui — la colonne « à décider " +
    "maintenant » du tableau de bord — vus depuis le compte de l'utilisateur qui pose la " +
    "question. Utiliser pour « quelles sont mes priorités ? », « par quoi je commence ? ».",
  schema: {
    type: "object",
    properties: {
      perimetre: {
        type: "string",
        enum: ["moi", "equipe"],
        description:
          "« moi » (défaut) ne garde que ce qui n'est pas délégué à un tiers. « equipe » élargit " +
          "à tout ce qui est suivi, y compris ce qui est confié à quelqu'un d'autre.",
      },
      limite: { type: "integer", description: "Nombre maximum de priorités (défaut 15, max 40)." },
    },
  },
  async executer(params, ctx) {
    const perimetre = params.perimetre === "equipe" ? "equipe" : "moi";
    const limite = borner(params.limite, 15, 40);
    const { consolide, moteur: m, avertissements } = await chargerDossiers({ profil: ctx.profil });

    // « Mes » priorités ne peut jamais désigner quelqu'un d'autre : le profil
    // vient du JWT, et le modèle n'a aucun moyen de le remplacer.
    const colonnes = m.repartirEnColonnes({ dossiers: consolide.allDossiers || [], filtre: "all" });
    const base = perimetre === "equipe"
      ? [...colonnes.decision, ...colonnes.delegated]
      : colonnes.decision;

    const retenus = base.slice(0, limite);

    return {
      type: "liste_priorites",
      titre:
        retenus.length === 0
          ? "Rien à arbitrer aujourd'hui"
          : `${retenus.length} priorité${retenus.length > 1 ? "s" : ""} aujourd'hui`,
      perimetre,
      vu_par: ctx.profil.nom || ctx.profil.email || "",
      stats: {
        a_decider: colonnes.decision.length,
        a_surveiller: colonnes.watch.length,
        delegue: colonnes.delegated.length,
        bloques: (consolide.stats && consolide.stats.blocked) || 0,
        echeances_7j: (consolide.stats && consolide.stats.echeances7) || 0,
      },
      priorites: retenus.map((d) => exposerDossier(d, m)),
      avertissements,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Deux outils CRM, en lecture directe
// ─────────────────────────────────────────────────────────────────────────────

// Colonnes remontées pour une liste de clients. Jamais select("*") :
// invest_clients porte strategie_data, un jsonb volumineux qui n'a rien à
// faire dans une liste de résultats.
const COLONNES_CLIENT_LISTE =
  "id,nom,prenom,email,telephone,statut,etape,conseiller,responsable,prochaine_action,date_prochaine_action,created_at";

const recherche_clients = {
  nom: "recherche_clients",
  pages: ["crm"],
  description:
    "Retrouve des dossiers clients Invest par nom, prénom, e-mail ou téléphone, ou les filtre " +
    "par étape et responsable. Utiliser pour retrouver un client avant d'en demander le résumé. " +
    "Ne concerne QUE les clients : les prospects sont hors périmètre.",
  schema: {
    type: "object",
    properties: {
      recherche: { type: "string", description: "Nom, prénom, e-mail ou téléphone, même partiel." },
      etape: { type: "string", description: "Étape du dossier, même partielle : « notaire », « financement »…" },
      statut: { type: "string", description: "Statut du dossier." },
      responsable: { type: "string", description: "Nom du conseiller ou du responsable." },
      sans_prochaine_action: { type: "boolean", description: "Ne garder que les dossiers sans prochaine action définie." },
      limite: { type: "integer", description: "Nombre maximum de résultats (défaut 10, max 10)." },
    },
  },
  async executer(params) {
    // Plafond dur à 10, comme demandé pour la V1.
    const limite = borner(params.limite, 10, 10);
    let q = table("invest_clients").select(COLONNES_CLIENT_LISTE);

    const recherche = String(params.recherche || "").trim();
    if (recherche) {
      // Les valeurs sont paramétrées par le client Supabase ; on échappe les
      // virgules et parenthèses, qui sont la syntaxe du filtre `or` PostgREST.
      const v = recherche.replace(/[,()]/g, " ");
      q = q.or(
        [`nom.ilike.%${v}%`, `prenom.ilike.%${v}%`, `email.ilike.%${v}%`, `telephone.ilike.%${v}%`].join(",")
      );
    }
    if (params.etape) q = q.ilike("etape", `%${String(params.etape).replace(/[,()]/g, " ")}%`);
    if (params.statut) q = q.eq("statut", String(params.statut));
    if (params.responsable) {
      const v = String(params.responsable).replace(/[,()]/g, " ");
      q = q.or([`conseiller.ilike.%${v}%`, `responsable.ilike.%${v}%`].join(","));
    }

    const { data, error } = await q.order("date_prochaine_action", { ascending: true, nullsFirst: false }).limit(limite + 1);
    if (error) throw new Error(`recherche_clients : ${error.message}`);

    let lignes = data || [];
    if (params.sans_prochaine_action) {
      lignes = lignes.filter((c) => !c.prochaine_action && !c.date_prochaine_action);
    }
    const tronque = lignes.length > limite;
    lignes = lignes.slice(0, limite);

    return {
      type: "liste_clients",
      titre:
        lignes.length === 0
          ? "Aucun client trouvé"
          : `${lignes.length} client${lignes.length > 1 ? "s" : ""}${tronque ? " (liste tronquée)" : ""}`,
      total: lignes.length,
      tronque,
      clients: lignes.map((c) => ({
        id: c.id,
        nom: `${c.prenom || ""} ${c.nom || ""}`.trim() || c.nom || "Client",
        email: c.email || null,
        telephone: c.telephone || null,
        etape: c.etape || null,
        statut: c.statut || null,
        responsable: c.conseiller || c.responsable || null,
        prochaine_action: c.prochaine_action || null,
        echeance: c.date_prochaine_action || null,
        lien: { libelle: "Ouvrir le dossier", params: { client_id: c.id } },
      })),
    };
  },
};

const resume_client = {
  nom: "resume_client",
  pages: ["crm"],
  description:
    "Fiche consolidée d'un dossier client : étape en cours, progression des actions de mission, " +
    "prochaines actions, points bloquants, biens proposés et dernières notes. C'est l'outil de " +
    "« où en est le dossier de X ? » et de « résume-moi ce dossier ». Demande un client_id — " +
    "utiliser recherche_clients d'abord si l'on n'a qu'un nom.",
  schema: {
    type: "object",
    properties: {
      client_id: { type: "string", description: "Identifiant du client (uuid)." },
      inclure_notes: { type: "boolean", description: "Joindre les 5 dernières notes (défaut vrai)." },
      inclure_biens: { type: "boolean", description: "Joindre les biens proposés (défaut vrai)." },
    },
    required: ["client_id"],
  },
  async executer(params) {
    const id = String(params.client_id || "").trim();
    if (!id) throw new Error("resume_client : client_id est requis");
    const avecNotes = params.inclure_notes !== false;
    const avecBiens = params.inclure_biens !== false;

    const { data: client, error: e1 } = await table("invest_clients")
      .select(`${COLONNES_CLIENT_LISTE},budget,date_signature,notes_rapides,updated_at`)
      .eq("id", id)
      .maybeSingle();
    if (e1) throw new Error(`resume_client : ${e1.message}`);
    if (!client) return { type: "absence", titre: "Client introuvable", client_id: id };

    // Actions de mission : bornées à 40, colonnes explicites. On ne remonte ni
    // le corps des notifications, ni les identifiants Calendar, ni les pièces
    // jointes — rien de tout cela n'éclaire « où en est le dossier ».
    const { data: actions } = await table("invest_mission_actions")
      .select("id,step_index,step_key,step_label,action_title,status,due_date,completed_at,responsable,commentaire")
      .eq("client_id", id)
      .order("step_index", { ascending: true })
      .limit(40);

    const lignes = actions || [];
    const faites = lignes.filter((a) => /fait|termin|non_concern/i.test(String(a.status || ""))).length;
    const bloquees = lignes.filter((a) => /bloqu|compliqu/i.test(String(a.status || "")));
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const enRetard = lignes.filter(
      (a) => a.due_date && String(a.due_date).slice(0, 10) < aujourdhui && !/fait|termin|non_concern/i.test(String(a.status || ""))
    );
    const ouvertes = lignes.filter((a) => !/fait|termin|non_concern/i.test(String(a.status || "")));

    const resultat = {
      type: "resume_client",
      titre: `Dossier ${`${client.prenom || ""} ${client.nom || ""}`.trim() || "client"}`,
      client: {
        id: client.id,
        nom: `${client.prenom || ""} ${client.nom || ""}`.trim() || client.nom || "Client",
        email: client.email || null,
        telephone: client.telephone || null,
        etape: client.etape || null,
        statut: client.statut || null,
        responsable: client.conseiller || client.responsable || null,
        budget: client.budget ?? null,
        date_signature: client.date_signature || null,
      },
      progression: { faites, total: lignes.length },
      prochaine_action: {
        libelle: client.prochaine_action || (ouvertes[0] && ouvertes[0].action_title) || null,
        echeance: client.date_prochaine_action || (ouvertes[0] && ouvertes[0].due_date) || null,
        responsable: client.conseiller || client.responsable || null,
      },
      points_bloquants: bloquees.map((a) => ({
        etape: a.step_label || a.step_key,
        action: a.action_title,
        statut: a.status,
        echeance: a.due_date || null,
        responsable: a.responsable || null,
      })),
      actions_en_retard: enRetard.slice(0, 10).map((a) => ({
        etape: a.step_label || a.step_key,
        action: a.action_title,
        echeance: a.due_date,
        responsable: a.responsable || null,
      })),
      lien: { libelle: "Ouvrir le dossier", params: { client_id: client.id } },
    };

    if (avecBiens) {
      const { data: props } = await table("invest_propositions")
        .select("id,statut,commentaire,date_proposition,bien:invest_biens(id,adresse,ville,statut,prix_vente,rendement_brut)")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(10);
      resultat.biens_proposes = (props || []).map((p) => ({
        statut_proposition: p.statut || null,
        date: p.date_proposition || null,
        bien: p.bien
          ? {
              id: p.bien.id,
              adresse: [p.bien.adresse, p.bien.ville].filter(Boolean).join(", ") || null,
              statut: p.bien.statut || null,
              prix: p.bien.prix_vente ?? null,
              rendement_brut: p.bien.rendement_brut ?? null,
              lien: { libelle: "Ouvrir le bien", params: { invest_bien: p.bien.id } },
            }
          : null,
      }));
    }

    if (avecNotes) {
      const { data: notes } = await table("invest_notes")
        .select("id,type,contenu,auteur,date,created_at")
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .limit(5);
      // Notes tronquées : une note peut faire plusieurs milliers de caractères,
      // et le modèle n'a pas besoin de tout pour situer un dossier.
      resultat.notes_recentes = (notes || []).map((n) => ({
        type: n.type || null,
        auteur: n.auteur || null,
        date: n.date || n.created_at || null,
        extrait: String(n.contenu || "").slice(0, 400),
      }));
    }

    return resultat;
  },
};

const TOUS = [dossiers_bloques, echeances_a_venir, priorites_du_jour, recherche_clients, resume_client];

// Outils réellement exposés au modèle pour cet appel : ceux dont au moins une
// page requise est accordée au rôle. Un outil non exposé n'existe pas pour le
// modèle — c'est le premier des deux filtres de sécurité.
function outilsAutorises(portee) {
  if (!portee.membreInvest) return [];
  return TOUS.filter((o) => o.pages.some((p) => portee.peut(p)));
}

function parNom(nom, portee) {
  return outilsAutorises(portee).find((o) => o.nom === nom) || null;
}

module.exports = { TOUS, outilsAutorises, parNom };
