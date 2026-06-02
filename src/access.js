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
// (id, label affiché dans la matrice d'accès)
export const PAGES_RENOVATION = [
  { id: "dashboard",          label: "Tableau de bord"           },
  { id: "chantiers",          label: "Chantiers"                 },
  { id: "planning",           label: "Planning semaine"          },
  { id: "planning-mensuel",   label: "Planning mensuel"          },
  { id: "notes-todo",         label: "Notes & To-do"             },
  { id: "commandes",          label: "Commandes"                 },
  { id: "planning-commandes", label: "Planning commandes (5 sem.)" },
  { id: "equipe",             label: "Équipe"                    },
  { id: "plans",              label: "Plans"                     },
  { id: "phasage",            label: "Phasage"                   },
  { id: "phasage-v2",         label: "Phasage v2 (refonte)"      },
  { id: "bibliotheque",       label: "Biblio. ouvrages"          },
  { id: "biblio-materiaux",   label: "Biblio. matériaux"         },
  { id: "visite",             label: "Visites chantier"          },
  { id: "info-client",        label: "Infos Client"              },
  { id: "dashboard-analyse",  label: "Dashboard Analyse"         },
  { id: "admin",              label: "Réglages"                  },
];

export const PAGES_INVEST = [
  { id: "dashboard",  label: "Tableau de bord" },
  { id: "crm",        label: "CRM Clients"     },
  { id: "biens",      label: "Stock de biens"  },
  { id: "simulateur", label: "Simulateur"      },
  { id: "admin",      label: "Réglages"        },
];

// ─── RÔLES PAR DÉFAUT ────────────────────────────────────────────────────────
export const ROLES_DEFAULT_RENOVATION = [
  { id: "admin",      label: "Administrateur",        color: "#FFC200" },
  { id: "conducteur", label: "Conducteur de travaux", color: "#50c878" },
  { id: "commercial", label: "Commercial",            color: "#4db8ff" },
  { id: "comptable",  label: "Comptable",             color: "#c084fc" },
];

export const ROLES_DEFAULT_INVEST = [
  { id: "admin", label: "Administrateur", color: "#4070E8" },
];

// ─── MATRICE PAR DÉFAUT (rôle → pages autorisées) ───────────────────────────
export const ROLE_PAGES_DEFAULT_RENOVATION = {
  admin: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes","planning-commandes",
    "equipe","plans","phasage","phasage-v2","bibliotheque","biblio-materiaux",
    "visite","info-client","dashboard-analyse","admin",
  ],
  conducteur: [
    "dashboard","chantiers","planning","planning-mensuel","notes-todo","commandes","planning-commandes",
    "equipe","plans","phasage","phasage-v2","bibliotheque","biblio-materiaux",
    "visite","info-client",
  ],
  commercial: [
    "dashboard","chantiers","planning","plans","visite","info-client",
  ],
  comptable: [
    "dashboard","chantiers","commandes","biblio-materiaux","phasage","phasage-v2",
  ],
};

export const ROLE_PAGES_DEFAULT_INVEST = {
  admin: PAGES_INVEST.map(p => p.id),
};

// ─── HELPERS BRANCHE ─────────────────────────────────────────────────────────
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

// ─── CHARGEMENT ──────────────────────────────────────────────────────────────
// Renvoie { roles, rolePages } pour la branche donnée, en faisant le fallback
// sur les valeurs par défaut si la config n'est pas en base ou incomplète.
export async function loadAccessConfig(branch = "renovation") {
  const def = getDefaults(branch);
  let roles     = def.roles;
  let rolePages = def.rolePages;
  try {
    const { data } = await supabase.from("planning_config")
      .select("key,value")
      .in("key", [def.keyRoles, def.keyPages]);
    if (Array.isArray(data)) {
      for (const r of data) {
        if (r.key === def.keyRoles && r.value && Array.isArray(r.value.items) && r.value.items.length > 0) {
          roles = r.value.items.map(x => ({
            id:    x.id    || x.label?.toLowerCase().replace(/\s+/g, "_") || "role",
            label: x.label || x.id || "Rôle",
            color: x.color || "#888888",
          }));
        }
        if (r.key === def.keyPages && r.value && typeof r.value === "object") {
          rolePages = { ...r.value };
        }
      }
    }
  } catch (e) {
    console.warn("loadAccessConfig:", e?.message || e);
  }
  // Garantir que chaque rôle a une entrée dans rolePages (au moins []).
  for (const r of roles) {
    if (!Array.isArray(rolePages[r.id])) rolePages[r.id] = [];
  }
  return { roles, rolePages };
}

// ─── SAUVEGARDE ──────────────────────────────────────────────────────────────
export async function saveAccessConfig(branch, { roles, rolePages }) {
  const def = getDefaults(branch);
  const rolesPayload = { items: roles };
  const pagesPayload = { ...rolePages };
  // Upsert sur les 2 clés
  const { error: e1 } = await supabase.from("planning_config")
    .upsert({ key: def.keyRoles, value: rolesPayload }, { onConflict: "key" });
  const { error: e2 } = await supabase.from("planning_config")
    .upsert({ key: def.keyPages, value: pagesPayload }, { onConflict: "key" });
  return { error: e1 || e2 || null };
}

// ─── CHECK D'ACCÈS ───────────────────────────────────────────────────────────
// canAccess(rolePages, role, page) : retourne true si le rôle a la page.
// Si rolePages n'a pas d'entrée pour le rôle, renvoie false (pas d'accès).
export function canAccess(rolePages, role, page) {
  if (!rolePages || !role) return false;
  const allowed = rolePages[role];
  if (!Array.isArray(allowed)) return false;
  return allowed.includes(page);
}

// ─── LISTE DES PAGES D'UNE BRANCHE (pour la matrice) ─────────────────────────
export function pagesForBranch(branch) {
  return branch === "invest" ? PAGES_INVEST : PAGES_RENOVATION;
}
