// src/access.js — Gestion centralisée des accès par rôle.
//
// Source unique de vérité pour :
//   1) la liste des pages disponibles par branche (Réno / Invest)
//   2) la liste des rôles disponibles par branche (modifiable depuis Admin → Accès)
//   3) la matrice rôles × pages (qui peut voir quoi)
//
// Stockage Supabase (table planning_config) :
//   - access_roles_renovation     : { items: [{ id, label, color }] }
//   - access_roles_invest         : { items: [{ id, label, color }] }
//   - access_pages_renovation     : { [roleId]: [pageId, ...] }
//   - access_pages_invest         : { [roleId]: [pageId, ...] }
//
// Si la clé n'existe pas, on retombe sur le défaut hardcodé ci-dessous.

import { supabase } from "./supabase";

// ─── PAGES DISPONIBLES PAR BRANCHE ───────────────────────────────────────────
// id = identifiant technique utilisé dans les routes / composants
// label = libellé affiché dans Admin → Accès

export const PAGES_RENOVATION = [
  { id: "dashboard",          label: "Tableau de bord"             },
  { id: "chantiers",          label: "Chantiers"                   },
  { id: "planning",           label: "Planning semaine"            },
  { id: "planning-mensuel",   label: "Planning mensuel"            },
  { id: "notes-todo",         label: "Notes & To-do"               },
  { id: "commandes",          label: "Commandes"                   },
  { id: "capture-cmd",        label: "Saisie commande (mobile)"    },
  { id: "rapprochement",      label: "Rapprochement factures"      },
  { id: "planning-commandes", label: "Planning commandes (5 sem.)" },
  { id: "equipe",             label: "Équipe"                      },
  { id: "validation",         label: "Validation fin de journée"   },
  { id: "plans",              label: "Plans"                       },
  { id: "phasage",            label: "Phasage"                     },
  { id: "phasage-v2",         label: "Phasage v2 (refonte)"        },
  { id: "bibliotheque",       label: "Biblio. ouvrages"            },
  { id: "biblio-materiaux",   label: "Biblio. matériaux"           },
  { id: "visite",             label: "Visites chantier"            },
  { id: "info-client",        label: "Chiffrage"                   },
  { id: "dashboard-analyse",  label: "Dashboard Analyse"           },
  { id: "etats-financiers",   label: "États financiers"            },
  { id: "guide-ouvrages",     label: "Guide ouvrages"              },
  { id: "admin",              label: "Réglages"                    },
];

export const PAGES_INVEST = [
  { id: "dashboard",        label: "Tableau de bord" },
  { id: "prospection",     label: "Prospection" },
  { id: "crm",             label: "CRM Clients" },
  { id: "biens",           label: "Biens" },
  { id: "simulateur",      label: "Simulateur" },
  { id: "structuration",   label: "Structuration" },
  { id: "finance",         label: "Finance" },
  { id: "suivi_financier", label: "Suivi financier" },
  { id: "admin",           label: "Admin" },
];

// ─── RÔLES PAR DÉFAUT ────────────────────────────────────────────────────────

export const ROLES_DEFAULT_RENOVATION = [
  { id: "admin",      label: "Administrateur",        color: "#FFC200" },
  { id: "conducteur", label: "Conducteur de travaux", color: "#50c878" },
  { id: "commercial", label: "Commercial",            color: "#4db8ff" },
  { id: "comptable",  label: "Comptable",             color: "#c084fc" },
];

export const ROLES_DEFAULT_INVEST = [
  { id: "admin",      label: "Administrateur", color: "#4070E8" },
  { id: "direction",  label: "Direction",      color: "#C9A84C" },
  { id: "commercial", label: "Commercial",     color: "#50c878" },
  { id: "conseiller", label: "Conseiller",     color: "#8B5CF6" },
];

// ─── MATRICE PAR DÉFAUT RÉNOVATION ───────────────────────────────────────────

export const ROLE_PAGES_DEFAULT_RENOVATION = {
  admin: [
    "dashboard",
    "chantiers",
    "planning",
    "planning-mensuel",
    "notes-todo",
    "commandes",
    "capture-cmd",
    "rapprochement",
    "planning-commandes",
    "equipe",
    "validation",
    "plans",
    "phasage",
    "phasage-v2",
    "bibliotheque",
    "biblio-materiaux",
    "visite",
    "info-client",
    "dashboard-analyse",
    "etats-financiers",
    "guide-ouvrages",
    "admin",
  ],

  conducteur: [
    "dashboard",
    "chantiers",
    "planning",
    "planning-mensuel",
    "notes-todo",
    "commandes",
    "capture-cmd",
    "rapprochement",
    "planning-commandes",
    "equipe",
    "validation",
    "plans",
    "phasage",
    "phasage-v2",
    "bibliotheque",
    "biblio-materiaux",
    "visite",
    "info-client",
  ],

  commercial: [
    "dashboard",
    "chantiers",
    "planning",
    "plans",
    "visite",
    "info-client",
  ],

  comptable: [
    "dashboard",
    "chantiers",
    "commandes",
    "rapprochement",
    "biblio-materiaux",
    "phasage",
    "phasage-v2",
    "etats-financiers",
  ],
};

// ─── MATRICE PAR DÉFAUT INVEST ───────────────────────────────────────────────
//
// Important :
// - La clé technique principale doit être "admin"
// - Les alias "Admin" et "Super Admin" sont conservés pour éviter de casser
//   une ancienne configuration ou un profil utilisateur existant.
// - PageInvest utilise souvent profil.role || "admin".
// - Le fallback de sécurité cherche ROLE_PAGES_DEFAULT_INVEST.admin.

const INVEST_ADMIN_PAGES = [
  "dashboard",
  "prospection",
  "crm",
  "biens",
  "simulateur",
  "structuration",
  "finance",
  "suivi_financier",
  "admin",
];

const INVEST_DIRECTION_PAGES = [
  "dashboard",
  "prospection",
  "crm",
  "biens",
  "simulateur",
  "structuration",
  "finance",
  "suivi_financier",
];

const INVEST_COMMERCIAL_PAGES = [
  "dashboard",
  "prospection",
  "crm",
  "biens",
  "simulateur",
  "structuration",
];

const INVEST_CONSEILLER_PAGES = [
  "dashboard",
  "prospection",
  "crm",
  "biens",
  "simulateur",
  "structuration",
];

export const ROLE_PAGES_DEFAULT_INVEST = {
  admin: INVEST_ADMIN_PAGES,

  // Alias conservés pour compatibilité avec les anciens profils / anciennes configs
  Admin: INVEST_ADMIN_PAGES,
  "Super Admin": INVEST_ADMIN_PAGES,

  direction: INVEST_DIRECTION_PAGES,
  Direction: INVEST_DIRECTION_PAGES,

  commercial: INVEST_COMMERCIAL_PAGES,
  Commercial: INVEST_COMMERCIAL_PAGES,

  conseiller: INVEST_CONSEILLER_PAGES,
  Conseiller: INVEST_CONSEILLER_PAGES,
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function normalizeRoleId(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function uniqueArray(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function getDefaults(branch) {
  if (branch === "invest") {
    return {
      pages:     PAGES_INVEST,
      roles:     ROLES_DEFAULT_INVEST,
      rolePages: ROLE_PAGES_DEFAULT_INVEST,
      keyRoles:  "access_roles_invest",
      keyPages:  "access_pages_invest",
    };
  }

  return {
    pages:     PAGES_RENOVATION,
    roles:     ROLES_DEFAULT_RENOVATION,
    rolePages: ROLE_PAGES_DEFAULT_RENOVATION,
    keyRoles:  "access_roles_renovation",
    keyPages:  "access_pages_renovation",
  };
}

function getDefaultPagesForRole(def, roleId) {
  if (!roleId) return [];

  if (Array.isArray(def.rolePages?.[roleId])) {
    return def.rolePages[roleId];
  }

  const normalized = normalizeRoleId(roleId);

  if (Array.isArray(def.rolePages?.[normalized])) {
    return def.rolePages[normalized];
  }

  if (normalized === "super_admin" || normalized === "admin" || normalized === "administrateur") {
    return def.rolePages.admin || [];
  }

  if (normalized === "direction") {
    return def.rolePages.direction || [];
  }

  if (normalized === "commercial") {
    return def.rolePages.commercial || [];
  }

  if (normalized === "conseiller") {
    return def.rolePages.conseiller || [];
  }

  return [];
}

function normalizeSavedRolePages(rolePages, branch) {
  if (!rolePages || typeof rolePages !== "object") return {};

  const next = { ...rolePages };

  if (branch === "invest") {
    // Compatibilité anciennes clés
    if (Array.isArray(next["Admin"]) && !Array.isArray(next.admin)) {
      next.admin = next["Admin"];
    }

    if (Array.isArray(next["Super Admin"]) && !Array.isArray(next.admin)) {
      next.admin = next["Super Admin"];
    }

    if (Array.isArray(next["Direction"]) && !Array.isArray(next.direction)) {
      next.direction = next["Direction"];
    }

    if (Array.isArray(next["Commercial"]) && !Array.isArray(next.commercial)) {
      next.commercial = next["Commercial"];
    }

    if (Array.isArray(next["Conseiller"]) && !Array.isArray(next.conseiller)) {
      next.conseiller = next["Conseiller"];
    }
  }

  return next;
}

// ─── CHARGEMENT ──────────────────────────────────────────────────────────────
//
// Renvoie { roles, rolePages } pour la branche donnée, avec fallback propre.
// Si la config Supabase est absente ou incomplète, on complète avec les défauts.
// Si une nouvelle page est ajoutée, l'admin la récupère automatiquement.

export async function loadAccessConfig(branch = "renovation") {
  const def = getDefaults(branch);

  let roles = def.roles;
  let rolePages = { ...def.rolePages };

  try {
    const { data } = await supabase
      .from("planning_config")
      .select("key,value")
      .in("key", [def.keyRoles, def.keyPages]);

    if (Array.isArray(data)) {
      for (const row of data) {
        if (
          row.key === def.keyRoles &&
          row.value &&
          Array.isArray(row.value.items) &&
          row.value.items.length > 0
        ) {
          roles = row.value.items.map((x) => ({
            id:    x.id    || normalizeRoleId(x.label) || "role",
            label: x.label || x.id || "Rôle",
            color: x.color || "#888888",
          }));
        }

        if (
          row.key === def.keyPages &&
          row.value &&
          typeof row.value === "object" &&
          !Array.isArray(row.value)
        ) {
          rolePages = {
            ...rolePages,
            ...normalizeSavedRolePages(row.value, branch),
          };
        }
      }
    }
  } catch (e) {
    console.warn("loadAccessConfig:", e?.message || e);
  }

  // Garantir une entrée propre pour chaque rôle connu.
  for (const r of roles) {
    if (!Array.isArray(rolePages[r.id])) {
      const fallbackPages = getDefaultPagesForRole(def, r.id);
      rolePages[r.id] = Array.isArray(fallbackPages) ? [...fallbackPages] : [];
    }
  }

  // Sécurité spécifique Invest : garantir les alias admin principaux.
  if (branch === "invest") {
    const adminPages = uniqueArray([
      ...(rolePages.admin || []),
      ...(rolePages.Admin || []),
      ...(rolePages["Super Admin"] || []),
      ...(def.rolePages.admin || []),
    ]);

    rolePages.admin = adminPages;
    rolePages.Admin = adminPages;
    rolePages["Super Admin"] = adminPages;
  }

  // Auto-grant admin pour les nouvelles pages de la branche.
  // Évite qu'une nouvelle page comme "prospection" reste invisible.
  const adminDefault = def.rolePages.admin || [];
  const adminSaved = rolePages.admin || [];
  const adminMissing = adminDefault.filter((p) => !adminSaved.includes(p));

  if (adminMissing.length > 0) {
    rolePages.admin = uniqueArray([...adminSaved, ...adminMissing]);

    if (branch === "invest") {
      rolePages.Admin = rolePages.admin;
      rolePages["Super Admin"] = rolePages.admin;
    }
  }

  return { roles, rolePages };
}

// ─── SAUVEGARDE ──────────────────────────────────────────────────────────────

export async function saveAccessConfig(branch, { roles, rolePages }) {
  const def = getDefaults(branch);

  const cleanRoles = Array.isArray(roles) ? roles : def.roles;
  const cleanRolePages = rolePages && typeof rolePages === "object" ? rolePages : def.rolePages;

  const rolesPayload = { items: cleanRoles };
  const pagesPayload = { ...cleanRolePages };

  const { error: e1 } = await supabase
    .from("planning_config")
    .upsert(
      { key: def.keyRoles, value: rolesPayload },
      { onConflict: "key" }
    );

  const { error: e2 } = await supabase
    .from("planning_config")
    .upsert(
      { key: def.keyPages, value: pagesPayload },
      { onConflict: "key" }
    );

  return { error: e1 || e2 || null };
}

// ─── CHECK D'ACCÈS ───────────────────────────────────────────────────────────
//
// canAccess(rolePages, role, page)
// Retourne true si le rôle a accès à la page.
// Sécurisé contre les rôles non trouvés, anciennes clés Admin / Super Admin,
// ou rolePages incomplet.

export function canAccess(rolePages, role, page) {
  if (!rolePages || !role || !page) return false;

  const direct = rolePages[role];
  if (Array.isArray(direct)) return direct.includes(page);

  const normalized = normalizeRoleId(role);

  const normalizedMatch = rolePages[normalized];
  if (Array.isArray(normalizedMatch)) return normalizedMatch.includes(page);

  if (
    normalized === "admin" ||
    normalized === "super_admin" ||
    normalized === "administrateur"
  ) {
    const adminPages =
      rolePages.admin ||
      rolePages.Admin ||
      rolePages["Super Admin"] ||
      [];

    return Array.isArray(adminPages) ? adminPages.includes(page) : false;
  }

  if (normalized === "direction") {
    const directionPages = rolePages.direction || rolePages.Direction || [];
    return Array.isArray(directionPages) ? directionPages.includes(page) : false;
  }

  if (normalized === "commercial") {
    const commercialPages = rolePages.commercial || rolePages.Commercial || [];
    return Array.isArray(commercialPages) ? commercialPages.includes(page) : false;
  }

  if (normalized === "conseiller") {
    const conseillerPages = rolePages.conseiller || rolePages.Conseiller || [];
    return Array.isArray(conseillerPages) ? conseillerPages.includes(page) : false;
  }

  return false;
}

// ─── LISTE DES PAGES D'UNE BRANCHE ───────────────────────────────────────────

export function pagesForBranch(branch) {
  return branch === "invest" ? PAGES_INVEST : PAGES_RENOVATION;
}
