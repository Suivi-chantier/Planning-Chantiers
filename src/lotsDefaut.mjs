// Lots de travaux par défaut (repli quand Admin → Lots n'a rien enregistré,
// planning_config « lots_travaux ») et leur lecture. Déplacés TELS QUELS
// depuis src/constants.js (LOTS_DEFAUT, corps de loadLots), qui les
// réexporte : même liste et même lecture pour le navigateur et pour le
// serveur (mail récap du vendredi, projet docs/projets/organisation-par-jour.md,
// tâche 15). Extension .mjs = importable par Node, comme phasesDefaut.mjs.
//
// La lecture reçoit le client Supabase en paramètre (navigateur ou serveur) ;
// ce fichier n'en crée aucun. Aucune écriture, aucune horloge.

// Forme : { id, label, couleur, code_prefixe }
// Personnalisables via Admin → onglet Lots (stockage planning_config/lots_travaux).
export const LOTS_DEFAUT = [
  { id: "demolition",    label: "Démolition",             couleur: "#e05c5c", code_prefixe: "D"  },
  { id: "maconnerie",    label: "Maçonnerie",             couleur: "#a8a29e", code_prefixe: "M"  },
  { id: "electricite",   label: "Électricité",            couleur: "#eab308", code_prefixe: "E"  },
  { id: "plomberie",     label: "Plomberie sanitaire",    couleur: "#06b6d4", code_prefixe: "P"  },
  { id: "murs_cloison",  label: "Murs cloison doublages", couleur: "#6366f1", code_prefixe: "MC" },
  { id: "menuiserie",    label: "Menuiserie",             couleur: "#b45309", code_prefixe: "ME" },
  { id: "ouvertures",    label: "Ouvertures",             couleur: "#8b5cf6", code_prefixe: "O"  },
  { id: "finitions_gen", label: "Finitions générales",    couleur: "#a78bfa", code_prefixe: "FG" },
];

/**
 * Lots de travaux enregistrés (planning_config « lots_travaux »), sinon
 * LOTS_DEFAUT. Corps de l'ancien loadLots() de src/constants.js, inchangé ;
 * seul le client Supabase arrive en paramètre.
 * @param {object} client client Supabase (navigateur ou serveur)
 */
export async function lireLotsTravaux(client) {
  try {
    const { data } = await client.from("planning_config").select("value").eq("key", "lots_travaux").maybeSingle();
    const items = data?.value?.items;
    if (Array.isArray(items) && items.length > 0) {
      return items.map((l, i) => ({
        id:           l.id           || `lot_${i}`,
        label:        l.label        || `Lot ${i + 1}`,
        couleur:      l.couleur      || l.color || "#888888",
        code_prefixe: l.code_prefixe || "",
      }));
    }
  } catch (e) { console.warn("loadLots:", e?.message || e); }
  return LOTS_DEFAUT;
}
