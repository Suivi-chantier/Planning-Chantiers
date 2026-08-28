// Modèle pur du chantier 03 « Planning de référence & allocations ».
// Aucun accès Supabase ici : ce module décrit l'identité d'une allocation,
// la création d'un snapshot de référence et le diff référence ↔ courant.

const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];

const n = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const txt = v => String(v ?? "").trim();

export function datePlanningDepuisWeekJour(weekId, jour) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(txt(weekId));
  const idx = JOURS.indexOf(jour);
  if (!m || idx < 0) return "";
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1) + (week - 1) * 7);
  const d = new Date(monday);
  d.setDate(monday.getDate() + idx);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function creerAllocationUid(generer = null) {
  if (typeof generer === "function") return String(generer());
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // Fallback seulement pour environnements anciens ; les migrations DB utilisent gen_random_uuid().
  return `alloc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function nomsRessourcesAllocation(ligne = {}, cellule = {}) {
  const propres = Array.isArray(ligne.ouvriers) ? ligne.ouvriers.filter(Boolean) : [];
  if (propres.length) return [...new Set(propres.map(String))];
  return [...new Set((Array.isArray(cellule.ouvriers) ? cellule.ouvriers : []).filter(Boolean).map(String))];
}

export function idsRessourcesAllocation(noms = [], resourceIndex = new Map()) {
  return noms.map(nom => {
    const key = String(nom).trim().toLocaleLowerCase("fr-FR");
    const r = resourceIndex instanceof Map ? resourceIndex.get(key) : resourceIndex?.[key];
    return r?.id || r?.resource_id || null;
  }).filter(Boolean);
}

export function normaliserLigneAllocationV1({ cellule = {}, ligne = {}, resourceIndex = new Map(), genererUid = null } = {}) {
  const ouvriers_noms = nomsRessourcesAllocation(ligne, cellule);
  const allocation_uid = txt(ligne.allocation_uid) || creerAllocationUid(genererUid);
  const duree = n(ligne.duree, 0);
  const date = txt(cellule.date) || datePlanningDepuisWeekJour(cellule.week_id, cellule.jour);
  const tache_id = txt(ligne.tache_id) || null;
  return {
    allocation_uid,
    legacy_id: txt(ligne.id) || null,
    tache_id,
    chantier_id: txt(cellule.chantier_id) || null,
    week_id: txt(cellule.week_id) || null,
    jour: txt(cellule.jour) || null,
    date: date || null,
    duree,
    ouvriers_noms,
    resource_ids: idsRessourcesAllocation(ouvriers_noms, resourceIndex),
    texte: txt(ligne.text),
    source: tache_id ? "phasage" : "manuel",
  };
}

export function enrichirCelluleAllocationUids(cellule = {}, { genererUid = null } = {}) {
  const lignes = Array.isArray(cellule.taches) ? cellule.taches : [];
  let changed = false;
  const seen = new Set();
  const taches = lignes.map(ligne => {
    let uid = txt(ligne?.allocation_uid);
    if (!uid || seen.has(uid)) {
      uid = creerAllocationUid(genererUid);
      changed = true;
    }
    seen.add(uid);
    return uid === ligne?.allocation_uid ? ligne : { ...ligne, allocation_uid: uid };
  });
  return { changed, cellule: changed ? { ...cellule, taches } : cellule };
}

export function allocationsDepuisCellules(cellules = [], { resourceIndex = new Map(), genererUid = null } = {}) {
  const out = [];
  const seen = new Set();
  for (const cellule of Array.isArray(cellules) ? cellules : []) {
    for (const ligne of Array.isArray(cellule?.taches) ? cellule.taches : []) {
      const a = normaliserLigneAllocationV1({ cellule, ligne, resourceIndex, genererUid });
      // Un snapshot exige une identité d'allocation globale unique.
      if (seen.has(a.allocation_uid)) throw new Error(`allocation_uid dupliqué: ${a.allocation_uid}`);
      seen.add(a.allocation_uid);
      out.push(a);
    }
  }
  return out.sort((a, b) => `${a.date || ""}|${a.chantier_id || ""}|${a.allocation_uid}`.localeCompare(`${b.date || ""}|${b.chantier_id || ""}|${b.allocation_uid}`));
}

export function creerSnapshotPlanningReferenceV1({ chantier_id, allocations = [], created_at = null, source = "manual_freeze", note = null } = {}) {
  const ch = txt(chantier_id);
  if (!ch) throw new Error("chantier_id obligatoire");
  const propres = allocations.filter(a => txt(a.chantier_id) === ch).map(a => ({ ...a }));
  const uids = new Set();
  for (const a of propres) {
    if (!txt(a.allocation_uid)) throw new Error("allocation_uid obligatoire dans un snapshot");
    if (uids.has(a.allocation_uid)) throw new Error(`allocation_uid dupliqué dans snapshot: ${a.allocation_uid}`);
    uids.add(a.allocation_uid);
  }
  return {
    schema_version: 1,
    chantier_id: ch,
    created_at: created_at || new Date().toISOString(),
    source,
    note: note || null,
    allocation_count: propres.length,
    allocations: propres,
  };
}

const eqArray = (a = [], b = []) => {
  const aa = [...new Set(a || [])].map(String).sort();
  const bb = [...new Set(b || [])].map(String).sort();
  return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
};

export function diffPlanningReferenceV1(reference = [], courant = []) {
  const ref = new Map(reference.map(a => [a.allocation_uid, a]));
  const cur = new Map(courant.map(a => [a.allocation_uid, a]));
  const changements = [];

  for (const [uid, r] of ref) {
    const c = cur.get(uid);
    if (!c) {
      changements.push({ allocation_uid: uid, type: "removed", before: r, after: null });
      continue;
    }
    const details = [];
    if ((r.date || "") !== (c.date || "")) details.push("date");
    if (n(r.duree) !== n(c.duree)) details.push("duree");
    if (!eqArray(r.resource_ids, c.resource_ids) || (!r.resource_ids?.length && !c.resource_ids?.length && !eqArray(r.ouvriers_noms, c.ouvriers_noms))) details.push("ressources");
    if (txt(r.tache_id) !== txt(c.tache_id)) details.push("tache");
    if (details.length) changements.push({ allocation_uid: uid, type: "changed", details, before: r, after: c });
  }
  for (const [uid, c] of cur) {
    if (!ref.has(uid)) changements.push({ allocation_uid: uid, type: "added", before: null, after: c });
  }

  const resume = {
    added: changements.filter(x => x.type === "added").length,
    removed: changements.filter(x => x.type === "removed").length,
    moved: changements.filter(x => x.type === "changed" && x.details.includes("date")).length,
    resized: changements.filter(x => x.type === "changed" && x.details.includes("duree")).length,
    restaffed: changements.filter(x => x.type === "changed" && x.details.includes("ressources")).length,
    changed: changements.filter(x => x.type === "changed").length,
    total: changements.length,
  };
  return { changements, resume };
}

export function coucheTemporelleAllocation(dateISO, cutoffISO) {
  const d = txt(dateISO).slice(0, 10);
  const c = txt(cutoffISO).slice(0, 10);
  if (!d || !c) return "unknown";
  if (d < c) return "past";
  if (d === c) return "today";
  return "future";
}

export function estAllocationRecalculableV1(allocation, { cutoffISO, locked = false } = {}) {
  if (locked) return false;
  return coucheTemporelleAllocation(allocation?.date, cutoffISO) === "future";
}

export function grouperAllocationsParTache(allocations = []) {
  const map = new Map();
  for (const a of allocations) {
    const key = txt(a.tache_id) || `manual:${a.allocation_uid}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  }
  return map;
}
