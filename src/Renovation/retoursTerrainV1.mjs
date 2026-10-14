// ─────────────────────────────────────────────────────────────────────────────
// « Retours du terrain » — ce que disent les ouvriers dans leurs comptes
// rendus, rangé pour le bureau. Module PUR (façade retoursTerrainV1.js) :
// aucun accès Supabase, aucune horloge ; les rapports et les phasages arrivent
// en paramètre, déjà lus. Rien n'est recalculé : on relit ce que l'ouvrier a
// écrit (motifs, précisions, relevé de dépassement figé à la saisie).
//
// Trois listes pour une période :
//   depassements   lignes avec un motif de dépassement des heures vendues ;
//   nonFaites      tâches « Pas commencé » / « Bloqué » (nouveau compte rendu)
//                  ou « Non faite » (ancien formulaire), avec motif et précision ;
//   nouvelles      nouvelles tâches proposées, et ce qu'elles sont devenues.
// Plus des cumuls : dépassements par motif et par ouvrage, non faites par motif.
// ─────────────────────────────────────────────────────────────────────────────
import { libelleMotifStatut, libelleMotifDepassement, libelleNature } from "./motifsCompteRendu.mjs";

const texte = (v) => String(v ?? "").trim();
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

// « 12/10/2026 » ou « 2026-10-12… » → « 2026-10-12 » ; null si illisible.
export function isoDepuisDateRapport(d) {
  const s = texte(d);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

// Tâches du phasage par id → { nom, ouvrage, tache } (tous chantiers).
export function indexTachesPhasages(phasages) {
  const m = new Map();
  (phasages || []).forEach(ph => (Array.isArray(ph?.ouvrages) ? ph.ouvrages : []).forEach(o =>
    (Array.isArray(o?.taches) ? o.taches : []).forEach(t => {
      if (t?.id != null) m.set(String(t.id), { nom: texte(t.nom), ouvrage: texte(o.libelle) || null, tache: t });
    })));
  return m;
}

const fmtH = (h) => {
  const v = Math.round(num(h) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : String(v).replace(".", ",")) + " h";
};

// Cumul trié (le plus fréquent d'abord) : [{ cle, label, nb }]
function cumul(items, cle, label) {
  const m = new Map();
  items.forEach(it => {
    const k = cle(it);
    if (!k) return;
    const e = m.get(k) || { cle: k, label: label(it), nb: 0 };
    e.nb += 1;
    m.set(k, e);
  });
  return [...m.values()].sort((a, b) => b.nb - a.nb || a.label.localeCompare(b.label));
}

// Retours d'une période [debut, fin] (dates ISO incluses), éventuellement
// pour un seul chantier.
export function retoursTerrain({ rapports = [], phasages = [], debut, fin, chantierId = null }) {
  const taches = indexTachesPhasages(phasages);
  const depassements = [], nonFaites = [], nouvelles = [];

  (rapports || []).forEach(r => {
    const date = isoDepuisDateRapport(r?.date_rapport);
    if (!date || (debut && date < debut) || (fin && date > fin)) return;
    if (chantierId && String(r.chantier_id) !== String(chantierId)) return;
    const valide = r.statut === "valide";
    const v2 = r.formulaire_version === "v2";
    (Array.isArray(r.taches) ? r.taches : []).forEach((l, idx) => {
      if (!l || typeof l !== "object") return;
      const connue = l.tache_id ? taches.get(String(l.tache_id)) : null;
      const base = {
        cle: `${r.id}-${idx}`, rapport_id: r.id, date, ouvrier: texte(r.ouvrier) || "—",
        chantier_id: r.chantier_id || null, chantier_nom: texte(r.chantier_nom) || texte(r.chantier_id) || "—",
        tache: texte(l.planifie) || connue?.nom || "(sans nom)", ouvrage: connue?.ouvrage || null,
        precision: texte(l.remarque), valide, formulaire: v2 ? "v2" : "v1",
      };

      if (l.motif_depassement) {
        const d = l.depassement && typeof l.depassement === "object" ? l.depassement : null;
        depassements.push({
          ...base, motif: l.motif_depassement, motif_label: libelleMotifDepassement(l.motif_depassement),
          // Relevé figé à la saisie (jamais recalculé ici).
          releve: d ? `${fmtH(num(d.heures_avant) + num(d.heures_jour))} sur ${fmtH(d.heures_vendues)} vendues` : null,
        });
      }

      const bloque = l.bloque === true;
      if (bloque || l.statut === "non_faite") {
        nonFaites.push({
          ...base, bloque,
          statut_label: bloque ? "Bloqué" : v2 ? "Pas commencé" : "Non faite",
          motif: l.motif || null,
          motif_label: l.motif ? libelleMotifStatut(l.motif) : (v2 ? "—" : "Ancien formulaire (pas de motif)"),
        });
      }

      if (l.origine === "nouvelle" && l.proposition) {
        const creee = valide ? taches.get(`nt-${r.id}-${idx}`) : null;
        nouvelles.push({
          ...base, ouvrage: texte(l.proposition.ouvrage_libelle) || "Divers / hors devis",
          nature: l.proposition.nature || null, nature_label: libelleNature(l.proposition.nature) || "—",
          demandeur: texte(l.proposition.demandeur) || null,
          devenir: !valide ? "en_attente" : creee ? "creee" : "rattachee",
          devenir_label: !valide ? "En attente de validation"
            : creee ? `Créée${creee.tache.hors_devis === true ? " (hors devis)" : ""}`
            : "Rattachée à une tâche existante ou laissée libre",
        });
      }
    });
  });

  const parDate = (a, b) => b.date.localeCompare(a.date) || a.chantier_nom.localeCompare(b.chantier_nom);
  depassements.sort(parDate); nonFaites.sort(parDate); nouvelles.sort(parDate);

  return {
    depassements, nonFaites, nouvelles,
    depassementsParMotif: cumul(depassements, x => x.motif, x => x.motif_label),
    depassementsParOuvrage: cumul(depassements, x => `${x.chantier_nom} › ${x.ouvrage || x.tache}`, x => `${x.chantier_nom} › ${x.ouvrage || x.tache}`),
    nonFaitesParMotif: cumul(nonFaites, x => x.motif || (x.formulaire === "v1" ? "_v1" : "_aucun"), x => x.motif_label),
  };
}
