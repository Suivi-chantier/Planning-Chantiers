import { estOuvrageV2, maturiteOuvrageV2, normaliserOuvrageV2 } from "./planningModelV1.js";

const str = v => String(v ?? "").trim();

// Audit transversal du référentiel V2.
// Contrairement à maturiteOuvrageV2(), cet audit voit toute la bibliothèque et
// peut donc détecter une collision d'identifiant stable entre deux ouvrages.
export function auditerBibliothequeV2(ouvrages = []) {
  const v2 = (Array.isArray(ouvrages) ? ouvrages : [])
    .filter(estOuvrageV2)
    .map(o => normaliserOuvrageV2(o));

  const refsParId = new Map();
  let sousTaches = 0;
  let sansId = 0;
  let sansGroupe = 0;
  let ratiosManquants = 0;

  const details = v2.map(o => {
    const sts = Array.isArray(o.sous_taches) ? o.sous_taches : [];
    const maturite = maturiteOuvrageV2(o);
    sousTaches += sts.length;

    sts.forEach((st, index) => {
      const id = str(st.id);
      if (!id) sansId++;
      else {
        const refs = refsParId.get(id) || [];
        refs.push({
          ouvrage_id: str(o.id) || null,
          code_ouvrage: str(o.code_ouvrage) || null,
          libelle: str(o.libelle) || null,
          index,
          nom: str(st.nom) || null,
        });
        refsParId.set(id, refs);
      }
      if (!str(st.groupe_type_id)) sansGroupe++;
      if (st.ratio == null || st.ratio === "") ratiosManquants++;
    });

    return {
      id: str(o.id) || null,
      code_ouvrage: str(o.code_ouvrage) || null,
      libelle: str(o.libelle) || null,
      sous_taches: sts.length,
      planifiable: maturite.planifiable,
      erreurs: maturite.erreurs,
      warnings: maturite.warnings,
    };
  });

  const idsDupliques = [...refsParId.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([id, refs]) => ({ id, occurrences: refs.length, refs }));

  return {
    ok: idsDupliques.length === 0 && sansId === 0,
    stats: {
      ouvrages_v2: v2.length,
      ouvrages_avec_taches: details.filter(d => d.sous_taches > 0).length,
      ouvrages_sans_taches: details.filter(d => d.sous_taches === 0).length,
      sous_taches: sousTaches,
      ids_uniques: refsParId.size,
      ids_dupliques: idsDupliques.length,
      sous_taches_sans_id: sansId,
      sous_taches_sans_groupe: sansGroupe,
      ratios_manquants: ratiosManquants,
      ouvrages_planifiables: details.filter(d => d.planifiable).length,
    },
    ids_dupliques: idsDupliques,
    ouvrages: details,
  };
}
