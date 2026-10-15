// api/_ia/taches/releve_photos.js — Analyse des photos d'une pièce d'un relevé
// iMapper (page Plans, lot 3 de la spécification « Import d'un relevé iMapper »).
//
// CE QUE CETTE TÂCHE FAIT, ET CE QU'ELLE NE FAIT PAS
// ──────────────────────────────────────────────────
// Elle INTERPRÈTE les photos d'une pièce : pour chaque ouverture candidate
// trouvée dans la géométrie, elle dit si les photos la confirment, la
// requalifient (porte palière et non fenêtre, placard…), l'écartent (meuble,
// miroir) ou ne permettent pas de trancher ; elle signale une ouverture visible
// que la géométrie a manquée, propose des observations et des alertes de
// sécurité. Elle NE MESURE RIEN : aucune dimension n'est acceptée dans sa
// réponse (schema_sortie la refuse), les dimensions viennent toujours du
// relevé. Tout est une proposition à valider (sensible: true) ; l'intégration
// dans le plan est faite côté application (integrerAnalysePhotos,
// src/Renovation/releveImapper.mjs), en clair et testée.
//
// LES PHOTOS NE TRANSITENT PAS PAR L'ENTRÉE. Le front envoie les CHEMINS des
// photos dans le bucket privé "chantier-documents" (réduites à 800 px quand
// c'est possible) ; elles sont téléchargées ici avec la clé service_role.
// L'entrée — journalisée telle quelle dans ia_jobs — ne contient que le
// résumé géométrique de la pièce : nom, longueurs de murs, ouvertures
// candidates. Aucune image, aucune donnée client.

const { createClient } = require("@supabase/supabase-js");

const BUCKET = "chantier-documents";
const MAX_PHOTOS = 12;
const MAX_OCTETS_PHOTO = 4 * 1024 * 1024;
const TYPES_OUVERTURE = ["porte", "porte_fenetre", "fenetre", "baie", "placard"];
const VERDICTS = ["confirme", "requalifie", "faux_positif", "incertain", "nouvelle"];
const GRAVITES = ["haute", "moyenne", "basse"];

// Une dimension dans un texte : nombre suivi d'une unité de longueur ou de
// surface. Interdit dans toute la réponse : l'IA interprète, elle ne mesure pas.
const RE_DIMENSION = /\d+(?:[.,]\d+)?\s*(?:cm|mm|m²|m2|mètres?|metres?|m)(?![a-zà-ÿ])/i;

function chercherDimension(valeur, chemin = "") {
  if (typeof valeur === "string") return RE_DIMENSION.test(valeur) ? chemin || "texte" : null;
  if (Array.isArray(valeur)) {
    for (let i = 0; i < valeur.length; i++) { const t = chercherDimension(valeur[i], `${chemin}[${i}]`); if (t) return t; }
    return null;
  }
  if (valeur && typeof valeur === "object") {
    for (const [k, v] of Object.entries(valeur)) { const t = chercherDimension(v, chemin ? `${chemin}.${k}` : k); if (t) return t; }
  }
  return null;
}

// Chemins acceptés : ceux du relevé de CE plan, dans le stockage privé.
function cheminAutorise(chemin, planId) {
  return typeof chemin === "string" && !chemin.includes("..")
    && new RegExp(`^[^/]+/plans/${planId.replace(/[^0-9a-zA-Z-]/g, "")}/releve/`).test(chemin);
}

async function telechargerPhotos(photos) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Configuration Supabase absente côté serveur");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  return Promise.all(photos.map(async (ph) => {
    const { data, error } = await admin.storage.from(BUCKET).download(ph.chemin);
    if (error || !data) throw new Error(`Photo ${ph.num} introuvable dans le stockage : ${error?.message || ph.chemin}`);
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > MAX_OCTETS_PHOTO) throw new Error(`Photo ${ph.num} trop volumineuse`);
    return { ...ph, base64: buffer.toString("base64") };
  }));
}

const CONSIGNE = `Tu analyses les photos d'UNE pièce, prises pendant un relevé de l'existant
avant travaux de rénovation. Un logiciel a déjà mesuré la pièce et repéré des
OUVERTURES CANDIDATES (trous dans les murs relevés). Ta mission : dire ce que
les photos montrent. Tu ne mesures RIEN.

RÈGLES ABSOLUES
1. Ne donne JAMAIS de dimension, de largeur, de hauteur, de surface ni de
   distance (aucun nombre suivi de cm, m, mm ou m²). Les dimensions viennent du
   relevé, pas de toi.
2. Pour chaque ouverture candidate (champ "ref"), donne un verdict :
   - "confirme"     : les photos montrent bien une ouverture de ce type ;
   - "requalifie"   : c'est une ouverture, mais d'un autre type (ex. une porte
                      palière ou un placard pris pour une fenêtre) — donne "type" ;
   - "faux_positif" : ce n'est pas une ouverture (mobilier, meuble haut, miroir,
                      panneau de douche, renfoncement, objet qui masquait le mur) ;
   - "incertain"    : les photos ne permettent pas de trancher.
   Une ouverture "vers" une autre pièce est vue depuis cette pièce-ci.
3. Une ouverture VISIBLE sur les photos mais absente des candidates :
   verdict "nouvelle", "ref": null, avec "mur" (indice du mur où elle se trouve,
   d'après les photos rattachées aux murs) et "type". Seulement si tu la vois
   clairement.
4. Types possibles : "porte", "porte_fenetre", "fenetre", "baie" (passage sans
   porte), "placard".
5. Signale en ALERTE tout ce qui touche la sécurité ou l'étanchéité : vitre
   cassée, câblage apparent, tableau électrique (à vérifier avant travaux),
   trace d'humidité ou de moisissure, pièce sans ventilation visible (pas de
   fenêtre ni de grille), installation de gaz.
6. Observations : courtes phrases factuelles sur ce qui est visible (sol,
   murs, équipements, état), 6 au plus. Pas de conseil de travaux, pas de prix.
7. Cite les numéros des photos qui appuient chaque verdict ou alerte.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans markdown :
{
  "type_piece": "chambre" | "sejour" | "cuisine" | "salle_de_bain" | "salle_d_eau" | "salle_d_eau_wc" | "wc" | "entree" | "degagement" | "buanderie" | "cellier" | "autre",
  "ouvertures": [
    { "ref": "id de la candidate" ou null, "mur": indice du mur ou null,
      "verdict": "confirme" | "requalifie" | "faux_positif" | "incertain" | "nouvelle",
      "type": type ou null, "photos": [numéros], "confiance": nombre entre 0 et 1 }
  ],
  "equipements": [ { "type": "radiateur, évier, WC, douche…", "mur": indice ou null, "photos": [numéros] } ],
  "revetements": [ { "zone": "sol" | "murs" | "plafond", "description": "…" } ],
  "alertes": [ { "texte": "…", "gravite": "haute" | "moyenne" | "basse", "photos": [numéros] } ],
  "observations": [ "…" ]
}`;

module.exports = {
  id: "releve_photos",
  libelle: "Analyse des photos d'une pièce (relevé iMapper, page Plans)",

  // Bureau seulement (décision du 15/10/2026) : le relevé se valide depuis la
  // page Plans ; la visionneuse ouvrier reste en lecture seule.
  roles: ["admin", "conducteur"],

  modele: "claude-sonnet-5",
  max_tokens: 2500,
  // Par pièce. Le plafond PAR RELEVÉ (2,50 €) est tenu côté application, qui
  // cumule les coûts renvoyés et s'arrête avant de le dépasser.
  cout_max_eur: 0.4,
  sensible: true,

  // Entrée : { plan_id, piece: contexteAnalysePhotos(...) }
  schema_entree(entree) {
    if (!entree || typeof entree !== "object" || Array.isArray(entree)) return "l'entrée doit être un objet";
    const e = [];
    if (typeof entree.plan_id !== "string" || !/^[0-9a-zA-Z-]{8,}$/.test(entree.plan_id)) e.push("plan_id invalide");
    const p = entree.piece;
    if (!p || typeof p !== "object") return [...e, "piece manquante"];
    if (typeof p.piece_id !== "string" || !p.piece_id) e.push("piece.piece_id manquant");
    if (!Array.isArray(p.murs) || !p.murs.length) e.push("piece.murs manquants");
    if (!Array.isArray(p.ouvertures)) e.push("piece.ouvertures doit être une liste");
    if (!Array.isArray(p.photos) || !p.photos.length) e.push("aucune photo à analyser");
    else if (p.photos.length > MAX_PHOTOS) e.push(`au plus ${MAX_PHOTOS} photos par pièce`);
    else if (!e.length && p.photos.some((ph) => !cheminAutorise(ph.chemin, entree.plan_id))) e.push("chemin de photo hors du relevé de ce plan");
    return e.length ? e : true;
  },

  async construire_prompt(entree) {
    const p = entree.piece;
    const photos = await telechargerPhotos(p.photos);
    const contenu = [];
    for (const ph of photos) {
      contenu.push({ type: "text", text: `Photo ${ph.num} — ${ph.mur != null ? `rattachée au mur ${ph.mur}` : "mur non identifié"}` });
      contenu.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: ph.base64 } });
    }
    const resume = {
      piece: p.nom, type_actuel: p.type,
      murs: p.murs.map((m) => ({ indice: m.indice, photos: m.photos })),
      ouvertures_candidates: p.ouvertures.map((o) => ({
        ref: o.ref, code: o.code, type_suppose: o.type, mur: o.mur, vers: o.vers, statut: o.statut,
      })),
    };
    // Les longueurs de murs ne sont PAS données au modèle : il n'a rien à
    // mesurer, et elles l'inciteraient à en citer.
    contenu.push({ type: "text", text: `${CONSIGNE}\n\nDONNÉES DU RELEVÉ :\n${JSON.stringify(resume, null, 1)}` });
    return {
      system: "Tu es l'assistant d'un conducteur de travaux en rénovation. Tu décris ce que montrent des photos ; " +
        "tu ne mesures rien et tu ne complètes jamais ce que les photos ne montrent pas.",
      messages: [{ role: "user", content: contenu }],
    };
  },

  schema_sortie(r, entree) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return ["la sortie doit être un objet JSON"];
    const e = [];
    const dim = chercherDimension(r);
    if (dim) e.push(`aucune dimension n'est permise (trouvée dans ${dim}) : décris sans mesurer`);
    const refs = new Set((entree?.piece?.ouvertures || []).map((o) => o.ref));
    const nbMurs = (entree?.piece?.murs || []).length;
    const nums = new Set((entree?.piece?.photos || []).map((ph) => ph.num));
    const photosOk = (l, ou) => {
      if (l == null) return;
      if (!Array.isArray(l) || l.some((n) => !nums.has(n))) e.push(`${ou} : photos doit lister des numéros de photos fournies`);
    };
    if (!Array.isArray(r.ouvertures)) e.push("ouvertures doit être une liste");
    (r.ouvertures || []).forEach((o, i) => {
      const ou = `ouvertures[${i}]`;
      if (!VERDICTS.includes(o?.verdict)) { e.push(`${ou}.verdict doit valoir ${VERDICTS.join(", ")}`); return; }
      if (o.verdict === "nouvelle") {
        if (o.ref != null) e.push(`${ou} : une ouverture nouvelle a ref null`);
        if (!Number.isInteger(o.mur) || o.mur < 0 || o.mur >= nbMurs) e.push(`${ou}.mur doit être un indice de mur entre 0 et ${nbMurs - 1}`);
        if (!TYPES_OUVERTURE.includes(o.type)) e.push(`${ou}.type requis (${TYPES_OUVERTURE.join(", ")})`);
      } else if (!refs.has(o.ref)) {
        e.push(`${ou}.ref doit être l'une des candidates (${[...refs].join(", ") || "aucune"})`);
      }
      if (o.verdict === "requalifie" && !TYPES_OUVERTURE.includes(o.type)) e.push(`${ou}.type requis pour requalifier`);
      if (o.confiance != null && !(typeof o.confiance === "number" && o.confiance >= 0 && o.confiance <= 1)) e.push(`${ou}.confiance entre 0 et 1`);
      photosOk(o.photos, ou);
    });
    (r.alertes || []).forEach((a, i) => {
      if (typeof a?.texte !== "string" || !a.texte.trim()) e.push(`alertes[${i}].texte requis`);
      if (a?.gravite != null && !GRAVITES.includes(a.gravite)) e.push(`alertes[${i}].gravite : ${GRAVITES.join(", ")}`);
      photosOk(a?.photos, `alertes[${i}]`);
    });
    (r.equipements || []).forEach((q, i) => {
      if (typeof q?.type !== "string") e.push(`equipements[${i}].type requis`);
      if (q?.mur != null && (!Number.isInteger(q.mur) || q.mur < 0 || q.mur >= nbMurs)) e.push(`equipements[${i}].mur hors des murs de la pièce`);
    });
    if (r.observations != null && (!Array.isArray(r.observations) || r.observations.some((t) => typeof t !== "string"))) {
      e.push("observations doit être une liste de phrases");
    }
    return e.length ? e : true;
  },

  calculer_confiance(r) {
    const c = (r?.ouvertures || []).map((o) => o.confiance).filter((x) => typeof x === "number");
    return c.length ? Math.round((c.reduce((a, b) => a + b, 0) / c.length) * 100) / 100 : 0.5;
  },

  // Exposés pour scripts/verif-releve-imapper.mjs.
  _internes: { chercherDimension, cheminAutorise, CONSIGNE },
};
