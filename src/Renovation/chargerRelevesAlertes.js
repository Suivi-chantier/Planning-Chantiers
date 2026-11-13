// Lecture des relevés journaliers utilisés par les points d'attention
// (Bilan semaine, page Alertes).
//
// Pourquoi ce fichier (06/11/2026) : la lecture précédente téléchargeait TOUS
// les relevés de la période (≈ 2 500 lignes, ≈ 8 Mo à cause des colonnes
// `lots` et `warnings`), alors que la préparation des semaines n'en garde que
// le dernier par chantier et par semaine (≈ 300 lignes). La page mettait
// plusieurs secondes à afficher ses points d'attention.
//
// Méthode, sans changer un seul chiffre :
//   1. index léger de la période (id, chantier_id, date_releve) ;
//   2. sélection des relevés retenus par la MÊME fonction que la préparation
//      (idsRelevesRetenusV2 → preparerSemainesRelevesJournaliersV2) ;
//   3. colonnes complètes de ces seuls relevés, par paquets lus en parallèle.
// L'appelant passe ensuite les lignes à preparerSemainesRelevesJournaliersV2
// comme avant : le relevé retenu pour chaque chantier et chaque semaine est
// le même, puisque les lignes écartées ne sont jamais retenues.
//
// Rend { data, error } comme Supabase. Une erreur n'est jamais masquée par une
// liste partielle : en cas d'échec, data est vide et error porte le message.
import { supabase } from "../supabase";
import { lireToutParTranches } from "./lectureParTranches";
import { COLONNES_RELEVES_ALERTES_V2, idsRelevesRetenusV2 } from "./pointsAttentionDonneesV1.js";

const TABLE = "chantier_releves_journaliers";
// Taille d'un paquet d'identifiants : 100 uuid tiennent largement dans l'URL.
const PAQUET_IDS = 100;

export async function chargerRelevesRetenusV2({ debut, fin, weekIds, colonnes = COLONNES_RELEVES_ALERTES_V2 }) {
  const index = await lireToutParTranches((a, b) => supabase
    .from(TABLE)
    .select("id, chantier_id, date_releve")
    .gte("date_releve", debut).lte("date_releve", fin)
    .order("date_releve", { ascending: true }).order("chantier_id", { ascending: true })
    .range(a, b));
  if (index.error) return { data: [], error: index.error };

  const ids = idsRelevesRetenusV2({ lignes: index.data, weekIds });
  const paquets = [];
  for (let i = 0; i < ids.length; i += PAQUET_IDS) paquets.push(ids.slice(i, i + PAQUET_IDS));
  const reponses = await Promise.all(paquets.map(p => supabase.from(TABLE).select(colonnes).in("id", p)));
  const echec = reponses.find(r => r.error);
  if (echec) return { data: [], error: echec.error };

  const data = reponses.flatMap(r => r.data || []);
  // Même ordre que l'ancienne lecture (date puis chantier).
  data.sort((x, y) => String(x.date_releve).localeCompare(String(y.date_releve))
    || String(x.chantier_id).localeCompare(String(y.chantier_id)));
  return { data, error: null };
}
