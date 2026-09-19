// COPIE GÉNÉRÉE — ne pas éditer ici. Source : src/Renovation/progbatLibrarySync.mjs (node scripts/sync-progbat-edge-lib.mjs)
// ─── SYNCHRONISATION BIBLIOTHÈQUE PROGBAT — PLAN PUR ────────────────────────
// Construit un plan conservateur à partir de l'inventaire :
//   • un code métier unique déjà présent est seulement LIÉ dans Profero ;
//   • un ouvrage réellement absent et complet est CRÉÉ dans une famille
//     d'ouvrages EXISTANTE, désignée explicitement par l'utilisateur ;
//   • aucune structure existante n'est modifiée ou supprimée ;
//   • aucun matériau/composant n'est créé dans cette première version.

import { arrondirMontant, num } from "./chiffragePricing.mjs";
import { normaliserLibelle } from "./progbatInventaire.mjs";

// Aucune famille de destination par défaut : elle est choisie sur l'écran,
// parmi les familles d'ouvrages qui existent déjà dans ProGBat. Créer les
// ouvrages dans une famille « fourre-tout » imposait un reclassement ensuite.


const str = (v) => String(v ?? "").trim();
const arrondir4 = (v) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

export function cleUnite(v) {
  return str(v).toLowerCase().replace(/\s+/g, "").replace(/²/g, "2");
}

/** Familles ProGBat utilisables comme famille d'OUVRAGES, triées par nom. */
export function listerFamillesOuvrages(familles = []) {
  return (familles || [])
    .filter((f) => f?.id != null && f.structureFamily !== false && str(f.label))
    .map((f) => ({ id: Number(f.id), label: str(f.label) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

/**
 * Famille de destination désignée par son identifiant ProGBat (le cas normal :
 * l'utilisateur l'a choisie dans la liste des familles existantes). Le nom
 * n'est jamais réinventé ici : il est relu depuis ProGBat.
 */
export function resoudreFamilleParId(familles = [], familleId) {
  const vise = num(familleId);
  const disponibles = listerFamillesOuvrages(familles);
  const base = { ok: false, id: null, libelle: "", candidats: [], homonymes: [], disponibles, erreur: null };
  if (!Number.isInteger(vise) || vise <= 0) {
    return { ...base, erreur: "Choisir la famille ProGBat qui recevra l'ouvrage" };
  }
  const trouvee = (familles || []).find((f) => f?.id != null && Number(f.id) === vise);
  if (!trouvee) return { ...base, erreur: `Famille ProGBat n° ${vise} introuvable : la liste a peut-être changé, relancer la vérification` };
  if (trouvee.structureFamily === false) {
    return { ...base, libelle: str(trouvee.label), erreur: `La famille ProGBat « ${str(trouvee.label)} » n'est pas une famille d'ouvrages` };
  }
  const resume = { id: vise, label: str(trouvee.label), structureFamily: true };
  return { ...base, ok: true, id: vise, libelle: resume.label, candidats: [resume], homonymes: [resume] };
}

/**
 * Famille ProGBat qui accueillera les ouvrages créés. Les trois causes d'échec
 * sont distinguées, parce qu'elles ne se corrigent pas de la même façon :
 *   • aucune famille de ce nom              → la créer dans ProGBat ;
 *   • une famille de ce nom, mais qui n'est pas une famille d'OUVRAGES
 *     (structureFamily = false)             → cocher « ouvrages » dessus ;
 *   • plusieurs familles de ce nom          → en supprimer/renommer une.
 * `disponibles` liste les familles d'ouvrages réellement utilisables, pour que
 * l'écran puisse montrer ce qui existe au lieu d'un simple « introuvable ».
 */
export function trouverFamilleCible(familles = [], libelle) {
  const cible = normaliserLibelle(libelle);
  const liste = (familles || []).filter((f) => f?.id != null);
  const resume = (f) => ({ id: Number(f.id), label: str(f.label), structureFamily: f?.structureFamily !== false });
  // Homonymes : même nom, quel que soit le type de famille.
  const homonymes = liste.filter((f) => normaliserLibelle(f.label) === cible);
  const candidats = homonymes.filter((f) => f.structureFamily !== false);
  const ok = candidats.length === 1;
  let erreur = null;
  if (candidats.length > 1) erreur = `Plusieurs familles d'ouvrages ProGBat portent le nom « ${libelle} »`;
  else if (!candidats.length && homonymes.length) {
    erreur = `La famille ProGBat « ${libelle} » existe mais n'est pas une famille d'ouvrages : cocher « ouvrages » dessus dans ProGBat`;
  } else if (!candidats.length) {
    erreur = `Famille d'ouvrages ProGBat « ${libelle} » introuvable : la créer dans ProGBat (bibliothèque → familles), au nom exact « ${libelle} »`;
  }
  return {
    ok,
    id: ok ? Number(candidats[0].id) : null,
    libelle,
    candidats: candidats.map(resume),
    homonymes: homonymes.map(resume),
    disponibles: listerFamillesOuvrages(liste),
    erreur,
  };
}

export function trouverTva(taxes = [], tvaDefaut) {
  const attendu = num(tvaDefaut);
  if (attendu == null) return null;
  return (taxes || []).find((t) => {
    const r = num(t?.rate);
    return r != null && (Math.abs(r - attendu) < 0.001 || Math.abs(r * 100 - attendu) < 0.001);
  }) || null;
}

// ─── MAIN-D'ŒUVRE : LA CADENCE PROFERO PART AVEC L'OUVRAGE ──────────────────
// ProGBat ne stocke aucun temps sur l'ouvrage lui-même : le temps est la
// QUANTITÉ, en heures, d'un composant qui référence un « job » horaire
// (type 2, unité H) — exactement la règle que l'import des cadences applique
// en lecture (progbatCadences.mjs). L'écriture se fait par un appel séparé :
//   PUT /company/library/structures/{id}/composition
//       { components: [{ componentId, quantity }], updatePrice: false }
// `updatePrice` reste FAUX : le prix de vente vient de Profero et ne doit
// jamais être recalculé depuis la composition.
export const TYPE_JOB_MAIN_OEUVRE = 2;
export const UNITE_HEURE = "H";

/** Jobs ProGBat utilisables comme main-d'œuvre horaire, triés par libellé. */
export function listerJobsHoraires(jobs = []) {
  return (jobs || [])
    .filter((j) => Number.isInteger(Number(j?.id)) && Number(j.id) > 0
      && Number(j?.type) === TYPE_JOB_MAIN_OEUVRE
      && cleUnite(j?.unitCode) === cleUnite(UNITE_HEURE)
      && j?.active !== false && str(j?.label))
    .map((j) => ({ id: Number(j.id), label: str(j.label), code: str(j.code) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true }));
}

/** Job de main-d'œuvre désigné par son identifiant ProGBat. */
export function resoudreJobHoraire(jobs = [], jobId) {
  const vise = num(jobId);
  const disponibles = listerJobsHoraires(jobs);
  const base = { ok: false, id: null, libelle: "", disponibles, erreur: null };
  if (!Number.isInteger(vise) || vise <= 0) return { ...base, erreur: "Choisir la main-d'œuvre ProGBat qui portera la cadence" };
  const trouve = disponibles.find((j) => j.id === vise);
  if (!trouve) {
    const brut = (jobs || []).find((j) => Number(j?.id) === vise);
    if (!brut) return { ...base, erreur: `Main-d'œuvre ProGBat n° ${vise} introuvable : relancer la vérification` };
    return { ...base, libelle: str(brut.label), erreur: `« ${str(brut.label) || vise} » n'est pas une main-d'œuvre horaire (type ${TYPE_JOB_MAIN_OEUVRE}, unité ${UNITE_HEURE})` };
  }
  return { ...base, ok: true, id: trouve.id, libelle: trouve.label };
}

/**
 * Corps du PUT de composition pour porter la cadence Profero.
 * @param cadence heures par unité d'ouvrage (bibliotheque_ratios.cadence)
 */
/** Composants de main-d'œuvre HORAIRE d'une composition lue (type 2, unité H). */
export function composantsMainOeuvre(composants = []) {
  return (composants || []).filter((c) =>
    Number(c?.componentType) === TYPE_JOB_MAIN_OEUVRE && cleUnite(c?.unitCode) === cleUnite(UNITE_HEURE)
  );
}

/**
 * Corps du PUT de composition pour porter la cadence Profero.
 *
 * Le PUT REMPLACE la composition : on la reconstruit donc à l'identique et on
 * ne change QUE la quantité de la main-d'œuvre horaire. Rien n'est retiré.
 *   • aucune main-d'œuvre horaire présente → on en ajoute une (job à choisir) ;
 *   • une seule                            → sa quantité devient la cadence ;
 *   • plusieurs                            → refus : on ne devine pas laquelle.
 * ProGBat crée lui-même une composition générique (« Fournitures » +
 * « Main d'oeuvre ») quand on lui donne un prix sans composition : c'est elle
 * qui produisait des heures inventées, et c'est bien elle qu'il faut corriger.
 *
 * @param cadence   heures par unité d'ouvrage (bibliotheque_ratios.cadence)
 * @param existants composants lus, [] pour une structure qu'on vient de créer
 */
export function construireCompositionCadence({ cadence, job, existants = [] } = {}) {
  const erreurs = [];
  const heures = num(cadence);
  if (heures == null || !(heures > 0)) erreurs.push("Cadence Profero absente ou nulle : aucun temps à envoyer");

  const anciens = Array.isArray(existants) ? existants : [];
  const mo = composantsMainOeuvre(anciens);
  if (mo.length > 1) {
    erreurs.push(`L'ouvrage ProGBat porte ${mo.length} main-d'œuvre horaires : Profero ne choisit pas laquelle corriger`);
  }
  // Le job n'est demandé QUE s'il faut en ajouter une : quand ProGBat en a
  // déjà une, c'est la sienne qu'on met à jour, sans rien choisir.
  const ajout = mo.length === 0;
  if (ajout && !job?.ok) erreurs.push(str(job?.erreur) || "Main-d'œuvre ProGBat non choisie");
  if (erreurs.length) return { ok: false, erreurs, payload: null };

  const quantite = arrondir4(heures);
  const cibleId = ajout ? job.id : Number(mo[0].componentId);
  const components = anciens.map((c) => ({
    componentId: Number(c?.componentId),
    quantity: Number(c?.componentId) === cibleId ? quantite : num(c?.quantity),
  })).filter((c) => Number.isInteger(c.componentId) && c.componentId > 0 && c.quantity != null);
  if (ajout) components.push({ componentId: cibleId, quantity: quantite });

  const avant = ajout ? null : num(mo[0].quantity);
  return {
    ok: true,
    erreurs: [],
    jobId: cibleId,
    jobLibelle: ajout ? job.libelle : str(mo[0].label) || `composant #${cibleId}`,
    heures: quantite,
    heuresAvant: avant,
    ajout,
    conserves: components.length - (ajout ? 1 : 0),
    // Déjà à la bonne valeur : rien à écrire, mais rien d'anormal non plus.
    inchange: avant != null && Math.abs(avant - quantite) < 1e-6,
    // updatePrice explicitement faux : Profero garde la main sur le prix.
    payload: { components, updatePrice: false },
  };
}

/**
 * Une composition ProGBat est-elle vide ? On n'écrase JAMAIS une composition
 * existante : un ouvrage qui en a déjà une est écarté, pas modifié.
 * @param composition tableau renvoyé par GET /company/structures/{id}/composition
 */
export function compositionVide(composition) {
  return Array.isArray(composition) && composition.length === 0;
}

/**
 * Pourquoi la composition d'un ouvrage déjà lié ne peut pas être utilisée — ou
 * null si elle peut l'être. Une lecture RATÉE n'est jamais présentée comme une
 * composition « non vide » : c'est un fait distinct.
 * Une composition NON VIDE n'est plus un refus : elle est conservée telle
 * quelle, seule la quantité de main-d'œuvre horaire est corrigée.
 * @param lecture { ok: true, items: [] } | { ok: false, status, message } | null
 */
export function blocageComposition(lecture) {
  if (lecture == null) return "Composition ProGBat non lue : relancer la vérification depuis la fiche de l'ouvrage";
  if (lecture.ok !== true) {
    const detail = [str(lecture.message), lecture.status ? `HTTP ${lecture.status}` : ""].filter(Boolean).join(" · ");
    return `Composition ProGBat illisible${detail ? ` (${detail})` : ""} : la cadence n'est pas posée tant qu'on ignore ce qu'elle contient`;
  }
  if (!Array.isArray(lecture.items)) return "Réponse de composition ProGBat inattendue : cadence non posée par précaution";
  return null;
}

export function construirePayloadStructure(rapprochement, { familleId, unites = [], taxe, familleErreur = null } = {}) {
  const erreurs = [];
  const code = str(rapprochement?.profero?.code);
  const libelleCourt = str(rapprochement?.profero?.libelle_court);
  const cout = num(rapprochement?.prix?.cout_total_ht);
  const vente = num(rapprochement?.prix?.prix_vente_ht);
  const famille = num(familleId);
  const unite = (unites || []).find((u) => cleUnite(u?.code) === cleUnite(rapprochement?.profero?.unite));
  const taux = num(taxe?.rate);

  if (!code) erreurs.push("Code Profero absent");
  if (!libelleCourt) erreurs.push("Libellé absent");
  // La cause exacte vient de trouverFamilleCible : elle dit quoi corriger dans ProGBat.
  if (!Number.isInteger(famille) || famille <= 0) erreurs.push(str(familleErreur) || "Famille ProGBat de destination non choisie");
  if (!unite?.code) erreurs.push(`Unité « ${str(rapprochement?.profero?.unite)} » inconnue dans ProGBat`);
  if (cout == null || cout < 0) erreurs.push("Coût total HT invalide");
  if (vente == null || vente < 0) erreurs.push("Prix de vente HT invalide");
  if (taux == null) erreurs.push("TVA par défaut introuvable dans ProGBat");

  if (erreurs.length) return { ok: false, erreurs, payload: null };
  const achat = arrondirMontant(cout);
  const prixVente = arrondirMontant(vente);
  const edge = achat > 0 ? arrondir4((prixVente / achat - 1) * 100) : 0;
  return {
    ok: true,
    erreurs: [],
    payload: {
      code,
      label: `${code} : ${libelleCourt}`,
      unitCode: str(unite.code),
      families: [famille],
      purchaseNetUnitPrice: achat,
      edge,
      saleNetUnitPrice: prixVente,
      taxRate: taux > 0 && taux < 1 ? taux * 100 : taux,
      active: true,
      fixedPrice: true,
      technicalCom: `${code} : ${libelleCourt}`,
    },
  };
}

/**
 * @param familleId    identifiant ProGBat de la famille de destination, choisi
 *                     par l'utilisateur parmi les familles existantes. C'est
 *                     la voie normale.
 * @param familleLabel repli par NOM (aucun écran ne l'utilise aujourd'hui) ;
 *                     ignoré dès qu'un familleId est fourni.
 * Sans l'un ni l'autre, les LIAISONS restent possibles — elles ne créent rien —
 * et seules les CRÉATIONS sont écartées, faute de destination.
 */
export function construirePlanSynchronisation({ inventaire, familles = [], unites = [], taxes = [], tvaDefaut = null, familleId = null, familleLabel = null, jobs = [], jobId = null, compositions = null } = {}) {
  const famille = familleId != null || !str(familleLabel)
    ? resoudreFamilleParId(familles, familleId)
    : trouverFamilleCible(familles, familleLabel);
  const job = resoudreJobHoraire(jobs, jobId);
  const taxe = trouverTva(taxes, tvaDefaut);
  // `compositions` : composition ProGBat actuelle des ouvrages DÉJÀ liés, lue
  // par l'appelant (Map id Profero → tableau de composants, ou null si non lue).
  // Elle sert uniquement à savoir si l'on peut poser la cadence sans rien écraser.
  // Valeur : { ok: true, items } | { ok: false, status, message } ; absente = non lue.
  // undefined = composition non lue pour cet ouvrage (ou pas lue du tout).
  const compositionDe = (id) => (compositions instanceof Map ? compositions.get(str(id)) : undefined);
  const actions = [];
  const exclus = [];

  for (const r of inventaire?.rapprochements || []) {
    const ouvrageId = r?.profero?.id;
    if (!ouvrageId) continue;
    if (r.statut === "correspondance_code_a_confirmer" && r.correspondance?.id != null) {
      actions.push({
        type: "link",
        ouvrageId,
        code: r.profero.code,
        libelle: r.profero.libelle_court,
        progbatId: Number(r.correspondance.id),
        progbatLabel: r.correspondance.label || "",
      });
      continue;
    }
    if (r.statut === "nouveau_a_creer" && r.synchronisable) {
      const p = construirePayloadStructure(r, { familleId: famille.id, unites, taxe, familleErreur: famille.erreur });
      // La cadence part AVEC l'ouvrage : sans main-d'œuvre utilisable, la
      // création est refusée plutôt que de laisser ProGBat inventer un temps.
      const c = construireCompositionCadence({ cadence: r.prix?.heures_main_oeuvre, job });
      if (p.ok && c.ok) {
        actions.push({
          type: "create", ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court,
          payload: p.payload, composition: c,
        });
      } else {
        exclus.push({ ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, raisons: [...p.erreurs, ...c.erreurs] });
      }
      continue;
    }
    // Ouvrage déjà lié : on peut encore lui poser sa cadence, mais UNIQUEMENT
    // si sa composition ProGBat est vide. Une composition existante n'est
    // jamais remplacée (le PUT ProGBat écraserait matériaux et main-d'œuvre).
    if (r.statut === "deja_lie") {
      const lecture = compositionDe(ouvrageId);
      // Hors périmètre restreint, la composition n'est pas lue du tout : on ne
      // dit rien de cet ouvrage plutôt que d'inventer une raison.
      if (lecture === undefined) continue;
      const progbatId = num(r.profero?.progbat_id ?? r.correspondance?.id);
      const raisons = [];
      const blocage = blocageComposition(lecture);
      if (blocage) raisons.push(blocage);
      if (!Number.isInteger(progbatId) || progbatId <= 0) raisons.push("Identifiant ProGBat de l'ouvrage illisible");
      const c = construireCompositionCadence({
        cadence: r.prix?.heures_main_oeuvre, job,
        existants: blocage ? [] : lecture.items,
      });
      if (!c.ok) raisons.push(...c.erreurs);
      if (raisons.length) {
        exclus.push({ ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, raisons });
      } else if (c.inchange) {
        // Même valeur des deux côtés : aucune écriture, et ce n'est pas un refus.
        exclus.push({
          ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court,
          raisons: [`Sa main-d'œuvre ProGBat porte déjà ${c.heures} h : rien à corriger`],
        });
      } else {
        actions.push({
          type: "composition", ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court,
          progbatId, composition: c,
        });
      }
      continue;
    }
    exclus.push({ ouvrageId, code: r.profero.code, libelle: r.profero.libelle_court, raisons: r.blocages?.length ? r.blocages : [`Statut « ${r.statut} » à traiter manuellement`] });
  }

  actions.sort((a, b) => String(a.code || "").localeCompare(String(b.code || ""), "fr", { numeric: true }));
  return {
    famille,
    job,
    taxe: taxe ? { id: taxe.id ?? null, rate: num(taxe.rate), label: str(taxe.label) } : null,
    actions,
    exclus,
    compteurs: {
      a_lier: actions.filter((a) => a.type === "link").length,
      a_creer: actions.filter((a) => a.type === "create").length,
      a_composer: actions.filter((a) => a.type === "composition").length,
      exclus: exclus.length,
      total: actions.length,
    },
    garanties: {
      // Aucun composant existant n'est retiré et ProGBat ne recalcule pas le prix.
      modifie_existants_progbat: false, supprime_progbat: false, cree_elements: false,
      // Les composants existants sont tous réécrits à l'identique : seule la
      // quantité de la main-d'œuvre horaire change.
      retire_composants: false, recalcule_prix_progbat: false,
    },
  };
}

/**
 * Restreint un plan global à quelques ouvrages Profero (envoi d'un ouvrage
 * depuis sa fiche de bibliothèque, sans toucher au reste). Les règles ne
 * changent pas : le plan complet est construit normalement, puis filtré.
 * Un identifiant demandé qui n'apparaît ni en action ni en exclusion est
 * rendu dans `hors_plan` (déjà lié, ou inconnu de l'inventaire).
 * @returns le plan inchangé si aucun périmètre n'est demandé.
 */
export function restreindrePlan(plan, ouvrageIds) {
  const demandes = (ouvrageIds || []).map((x) => str(x)).filter(Boolean);
  if (!plan || !demandes.length) return plan;
  const voulu = new Set(demandes);
  const actions = (plan.actions || []).filter((a) => voulu.has(str(a.ouvrageId)));
  const exclus = (plan.exclus || []).filter((e) => voulu.has(str(e.ouvrageId)));
  const vus = new Set([...actions, ...exclus].map((x) => str(x.ouvrageId)));
  return {
    ...plan,
    actions,
    exclus,
    perimetre: { ouvrageIds: [...voulu].sort() },
    hors_plan: demandes.filter((id) => !vus.has(id)),
    compteurs: {
      a_lier: actions.filter((a) => a.type === "link").length,
      a_creer: actions.filter((a) => a.type === "create").length,
      a_composer: actions.filter((a) => a.type === "composition").length,
      exclus: exclus.length,
      total: actions.length,
    },
  };
}

/**
 * État de synchronisation d'un ouvrage Profero tel que l'inventaire le voit.
 * Sert à expliquer sur la fiche pourquoi un ouvrage n'a aucune action à faire
 * (déjà lié) ou ne peut pas être créé (blocages).
 */
export function etatOuvragePourSync(inventaire, ouvrageId) {
  const cible = str(ouvrageId);
  const r = (inventaire?.rapprochements || []).find((x) => str(x?.profero?.id) === cible);
  if (!r) return null;
  return {
    ouvrageId: cible,
    code: r.profero?.code ?? null,
    libelle: r.profero?.libelle_court ?? null,
    statut: r.statut,
    synchronisable: r.synchronisable === true,
    blocages: r.blocages || [],
    notes: r.notes || [],
    progbatId: r.profero?.progbat_id ?? r.correspondance?.id ?? null,
    progbatLabel: str(r.correspondance?.label) || null,
    candidats: (r.candidats || []).map((c) => ({ id: c?.id ?? null, label: str(c?.label) })),
  };
}

export function donneesPourHash(plan) {
  return {
    famille: plan?.famille?.id ?? null,
    // Le périmètre entre dans l'empreinte : un aperçu préparé pour un seul
    // ouvrage ne peut pas servir à confirmer une synchronisation globale.
    perimetre: plan?.perimetre?.ouvrageIds ?? null,
    actions: (plan?.actions || []).map((a) => a.type === "link"
      ? { type: a.type, ouvrageId: a.ouvrageId, progbatId: a.progbatId }
      : a.type === "composition"
        ? { type: a.type, ouvrageId: a.ouvrageId, progbatId: a.progbatId, composition: a.composition?.payload }
        // La composition entre dans l'empreinte : confirmer une création, c'est
        // aussi confirmer le temps qui l'accompagne.
        : { type: a.type, ouvrageId: a.ouvrageId, payload: a.payload, composition: a.composition?.payload }),
  };
}
