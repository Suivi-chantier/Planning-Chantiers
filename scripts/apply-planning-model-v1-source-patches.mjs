#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

function replaceOnce(text, search, replacement, label) {
  const first = text.indexOf(search);
  if (first < 0) throw new Error(`[${label}] motif introuvable`);
  const second = text.indexOf(search, first + search.length);
  if (second >= 0) throw new Error(`[${label}] motif non unique`);
  return text.slice(0, first) + replacement + text.slice(first + search.length);
}

function replaceSection(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`[${label}] début introuvable`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[${label}] fin introuvable`);
  return text.slice(0, start) + replacement + "\n\n" + text.slice(end);
}

async function patchBibliotheque() {
  const path = new URL("../src/Renovation/Bibliotheque.jsx", import.meta.url);
  let s = await readFile(path, "utf8");

  s = replaceOnce(
    s,
    'import { BIBLIOTHEQUE_INITIALE, FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots } from "../constants";',
    'import { BIBLIOTHEQUE_INITIALE, FONT, RADIUS, getBranchAccent, LOTS_DEFAUT, loadLots, loadGroupesTypes } from "../constants";',
    "biblio import groupes"
  );
  s = replaceOnce(
    s,
    'import { useDirtyGuard } from "../hooks";',
    'import { useDirtyGuard } from "../hooks";\nimport {\n  DEPENDANCE_MODES, dupliquerSousTachesV2, estOuvrageV2, maturiteOuvrageV2,\n  normaliserOuvrageV2, nouvelIdSousTache,\n} from "./planningModelV1";',
    "biblio import planning model"
  );

  const sousTacheSection = `// ─── SOUS-TÂCHE ROW ──────────────────────────────────────────────────────────
// Le ratio (%) détermine la répartition des heures ESTIMÉES de l'ouvrage.
// Pour les Ouvrages_V2, la ligne porte aussi son groupe d'exécution et sa
// dépendance technique. Les ouvrages historiques gardent leur affichage sans
// imposer ces nouvelles métadonnées.
function SousTacheRow({ st, idx, editData, ouvrage, setOuvrages, ouvrages, groupesTypes, T }) {
  const lotId = st.lotId ?? st.phaseId ?? "";
  const lot = LOTS.find(l => l.id === lotId);
  const total = (editData.sous_taches || []).length;
  const isV2 = estOuvrageV2(editData);
  const groupeTypeId = st.groupe_type_id || "";
  const groupeType = (groupesTypes || []).find(g => g.id === groupeTypeId);
  const mode = st.dependance_mode || DEPENDANCE_MODES.SEQUENCE;
  const candidates = (editData.sous_taches || []).slice(0, idx).filter(x => x?.id);

  function update(field, value) {
    const next = [...(editData.sous_taches || [])];
    next[idx] = { ...next[idx], [field]: value };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function updatePatch(patch) {
    const next = [...(editData.sous_taches || [])];
    next[idx] = { ...next[idx], ...patch };
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function remove() {
    const removedId = st.id;
    const next = (editData.sous_taches || [])
      .filter((_, i) => i !== idx)
      .map(x => removedId && Array.isArray(x.predecesseur_ids)
        ? { ...x, predecesseur_ids: x.predecesseur_ids.filter(id => id !== removedId) }
        : x);
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function move(delta) {
    const j = idx + delta;
    if (j < 0 || j >= total) return;
    const next = [...(editData.sous_taches || [])];
    [next[idx], next[j]] = [next[j], next[idx]];
    setOuvrages(ouvrages.map(o => o.id !== ouvrage.id ? o : { ...o, sous_taches: next }));
  }

  function setMode(nextMode) {
    updatePatch({
      dependance_mode: nextMode,
      ...(nextMode === DEPENDANCE_MODES.EXPLICIT ? {} : { predecesseur_ids: [] }),
      ...(nextMode === DEPENDANCE_MODES.PARALLEL ? { delai_min_calendaire: 0 } : {}),
    });
  }

  function togglePred(id) {
    const cur = Array.isArray(st.predecesseur_ids) ? st.predecesseur_ids : [];
    update("predecesseur_ids", cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }

  const arrowStyle = (disabled) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", border: "none", padding: 0, lineHeight: 1,
    color: T.textMuted, cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.2 : 1, height: 13,
  });
  const fieldStyle = {
    padding: "6px 8px", borderRadius: RADIUS.sm, border: \`1px solid \${T.border}\`,
    background: T.inputBg, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1,
    outline: "none",
  };

  return (
    <div className="biblio-row" style={{
      padding: "8px 12px", borderRadius: RADIUS.md,
      background: T.card, border: \`1px solid \${T.border}\`,
    }}>
      <div className="biblio-task-grid" style={{
        display: "grid",
        gridTemplateColumns: "20px minmax(220px,1.4fr) 150px 190px 72px 26px",
        gap: 8, alignItems: "center",
      }}>
        <div className="biblio-reorder" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button onClick={() => move(-1)} disabled={idx === 0} title="Monter" style={arrowStyle(idx === 0)}>
            <Icon as={ChevronUp} size={13}/>
          </button>
          <button onClick={() => move(1)} disabled={idx === total - 1} title="Descendre" style={arrowStyle(idx === total - 1)}>
            <Icon as={ChevronDown} size={13}/>
          </button>
        </div>

        <input
          value={st.nom || ""}
          onChange={e => update("nom", e.target.value)}
          placeholder="ex: Pose des rails, Vis et joints…"
          style={{ ...fieldStyle, padding: "6px 10px", fontSize: FONT.sm.size }}
        />

        <select
          value={lotId}
          onChange={e => update("lotId", e.target.value)}
          style={{ ...fieldStyle, color: lotId ? (lot?.couleur || T.text) : T.textMuted, cursor: "pointer", fontWeight: lotId ? 700 : 400 }}
        >
          <option value="">Lot automatique…</option>
          {LOTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>

        {isV2 ? (
          <select
            value={groupeTypeId}
            onChange={e => update("groupe_type_id", e.target.value || null)}
            title="Moment d'exécution de cette sous-tâche dans le chantier"
            style={{ ...fieldStyle, color: groupeTypeId ? (groupeType?.couleur || T.text) : T.textMuted, cursor: "pointer", fontWeight: groupeTypeId ? 700 : 400 }}
          >
            <option value="">Groupe d'exécution…</option>
            {[...(groupesTypes || [])].sort((a,b) => (a.ordre ?? 0) - (b.ordre ?? 0)).map(g => (
              <option key={g.id} value={g.id}>{g.nom}</option>
            ))}
          </select>
        ) : (
          <div style={{ ...fieldStyle, color: T.textMuted, fontStyle: "italic" }}>— historique —</div>
        )}

        <div style={{ position: "relative" }}>
          <input
            type="number" min="0" max="100" step="1"
            value={st.ratio ?? ""}
            onChange={e => update("ratio", e.target.value === "" ? null : parseFloat(e.target.value))}
            placeholder="—"
            style={{ ...fieldStyle, width: "100%", padding: "6px 20px 6px 8px", fontSize: FONT.sm.size, textAlign: "center", fontWeight: 700 }}
          />
          <span style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", color: T.textMuted, fontSize: FONT.xs.size, pointerEvents: "none" }}>%</span>
        </div>

        <button onClick={remove} title="Supprimer cette sous-tâche" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", color: "#e15a5a", cursor: "pointer", padding: 0, lineHeight: 1,
        }}>
          <Icon as={X} size={14}/>
        </button>
      </div>

      {isV2 && (
        <div style={{
          margin: "8px 0 0 28px", padding: "7px 9px", borderRadius: RADIUS.sm,
          background: T.inputBg, border: \`1px solid \${T.sectionDivider}\`,
          display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap",
        }}>
          <div style={{ minWidth: 190 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Dépendance</div>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ ...fieldStyle, width: "100%", cursor: "pointer" }}>
              <option value={DEPENDANCE_MODES.SEQUENCE}>{idx === 0 ? "Début de séquence" : "Suit la tâche précédente"}</option>
              <option value={DEPENDANCE_MODES.PARALLEL}>Peut être réalisée en parallèle</option>
              <option value={DEPENDANCE_MODES.EXPLICIT}>Dépend de tâches spécifiques</option>
            </select>
          </div>

          {mode === DEPENDANCE_MODES.EXPLICIT && (
            <div style={{ flex: "1 1 260px", minWidth: 220 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Prédécesseurs</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {candidates.length === 0 ? (
                  <span style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>Aucune tâche précédente disponible</span>
                ) : candidates.map(c => {
                  const checked = (st.predecesseur_ids || []).includes(c.id);
                  return (
                    <label key={c.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 7px",
                      borderRadius: RADIUS.sm, border: \`1px solid \${checked ? "#5b8af5" : T.border}\`,
                      background: checked ? "rgba(91,138,245,.12)" : "transparent",
                      color: checked ? "#5b8af5" : T.textSub, fontSize: FONT.xs.size, cursor: "pointer",
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => togglePred(c.id)} style={{ margin: 0 }}/>
                      {c.nom || "(sans nom)"}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {mode !== DEPENDANCE_MODES.PARALLEL && (
            <div style={{ minWidth: 170 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: .7, marginBottom: 4 }}>Attente technique mini.</div>
              <div style={{ display: "flex", gap: 5 }}>
                <input
                  type="number" min="0" step="1" value={st.delai_min_calendaire ?? 0}
                  onChange={e => update("delai_min_calendaire", Math.max(0, parseFloat(e.target.value) || 0))}
                  style={{ ...fieldStyle, width: 75, textAlign: "center" }}
                />
                <select value={st.unite_delai || "heures"} onChange={e => update("unite_delai", e.target.value)} style={{ ...fieldStyle, cursor: "pointer" }}>
                  <option value="heures">heures</option>
                  <option value="jours">jours</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}`;

  s = replaceSection(
    s,
    "// ─── SOUS-TÂCHE ROW ──────────────────────────────────────────────────────────",
    "// ─── MATÉRIAU LIÉ ROW ────────────────────────────────────────────────────────",
    sousTacheSection,
    "biblio sous-tache section"
  );

  s = replaceOnce(
    s,
    "function OuvrageCard({ ouvrage, isEdit, onToggleEdit, onSave, onDelete, onDuplicate, saving, ouvrages, setOuvrages, categories, getCat, changerCategorie, materiaux, T, acc }) {",
    "function OuvrageCard({ ouvrage, isEdit, onToggleEdit, onSave, onDelete, onDuplicate, saving, ouvrages, setOuvrages, categories, getCat, changerCategorie, materiaux, groupesTypes, T, acc }) {",
    "biblio card signature"
  );
  s = replaceOnce(
    s,
    "  const cadence = parseFloat(ouvrage.cadence) || null;",
    "  const cadence = parseFloat(ouvrage.cadence) || null;\n  const isV2 = estOuvrageV2(editData);\n  const maturite = isV2 ? maturiteOuvrageV2(editData) : null;",
    "biblio maturite vars"
  );
  s = replaceOnce(
    s,
    '    const next = [...(editData.sous_taches || []), { nom: "", lotId: "", ratio: null }];',
    '    const next = [...(editData.sous_taches || []), isV2\n      ? { id: nouvelIdSousTache(), nom: "", lotId: "", groupe_type_id: null, ratio: null, dependance_mode: DEPENDANCE_MODES.SEQUENCE, predecesseur_ids: [], delai_min_calendaire: 0, unite_delai: "heures" }\n      : { nom: "", lotId: "", ratio: null }];',
    "biblio add subtask"
  );
  s = replaceOnce(
    s,
    '          }\n          {/* Aperçu des sous-tâches */}',
    '          }\n          {maturite && (\n            <span title={[...(maturite.erreurs || []), ...(maturite.warnings || [])].join(" · ")} style={{\n              display: "inline-flex", alignItems: "center", gap: 4, fontSize: FONT.xs.size, fontWeight: 700,\n              color: maturite.planifiable ? "#22c55e" : "#f5a623",\n              background: maturite.planifiable ? "rgba(34,197,94,.10)" : "rgba(245,166,35,.10)",\n              border: `1px solid ${maturite.planifiable ? "rgba(34,197,94,.28)" : "rgba(245,166,35,.28)"}`,\n              padding: "2px 8px", borderRadius: RADIUS.pill,\n            }}>\n              <Icon as={maturite.planifiable ? Check : AlertTriangle} size={10}/>\n              {maturite.planifiable ? "Prêt planning" : "Planning à compléter"}\n            </span>\n          )}\n          {/* Aperçu des sous-tâches */}',
    "biblio maturity badge"
  );
  s = replaceOnce(
    s,
    "          {/* En-tête colonnes sous-tâches + total ratios */}",
    `          {maturite && isEdit && (
            <div style={{
              display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", marginBottom: 12,
              borderRadius: RADIUS.md,
              background: maturite.planifiable ? "rgba(34,197,94,.08)" : "rgba(245,166,35,.08)",
              border: \`1px solid \${maturite.planifiable ? "rgba(34,197,94,.25)" : "rgba(245,166,35,.25)"}\`,
            }}>
              <Icon as={maturite.planifiable ? Check : AlertTriangle} size={14} color={maturite.planifiable ? "#22c55e" : "#f5a623"} style={{ marginTop: 1, flexShrink: 0 }}/>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: maturite.planifiable ? "#22c55e" : "#f5a623" }}>
                  {maturite.planifiable ? "Ouvrage prêt pour la planification automatique" : "Référentiel planning incomplet"}
                </div>
                {!maturite.planifiable && (
                  <div style={{ fontSize: FONT.xs.size + 1, color: T.textSub, marginTop: 3, lineHeight: 1.5 }}>
                    {(maturite.erreurs || []).join(" · ")}
                  </div>
                )}
                {(maturite.warnings || []).length > 0 && (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 3 }}>
                    {(maturite.warnings || []).join(" · ")}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* En-tête colonnes sous-tâches + total ratios */}`,
    "biblio maturity detail"
  );
  s = replaceOnce(
    s,
    '                  display: "grid", gridTemplateColumns: "20px 1fr 180px 80px 26px",\n                  gap: 8, padding: "0 12px 6px",',
    '                  display: "grid", gridTemplateColumns: "20px minmax(220px,1.4fr) 150px 190px 72px 26px",\n                  gap: 8, padding: "0 12px 6px",',
    "biblio task header grid"
  );
  s = replaceOnce(
    s,
    '{["", "Nom de la sous-tâche", "Lot de travail", "Ratio", ""].map((h, i) => (',
    '{["", "Nom de la sous-tâche", "Lot", "Groupe d’exécution", "Ratio", ""].map((h, i) => (',
    "biblio task header labels"
  );
  s = replaceOnce(
    s,
    '                      textAlign: i === 3 ? "center" : "left",',
    '                      textAlign: i === 4 ? "center" : "left",',
    "biblio header ratio alignment"
  );
  s = replaceOnce(
    s,
    '                key={idx}\n                st={st} idx={idx}\n                editData={editData} ouvrage={ouvrage}\n                setOuvrages={setOuvrages} ouvrages={ouvrages}\n                T={T}',
    '                key={st.id || idx}\n                st={st} idx={idx}\n                editData={editData} ouvrage={ouvrage}\n                setOuvrages={setOuvrages} ouvrages={ouvrages}\n                groupesTypes={groupesTypes}\n                T={T}',
    "biblio task props"
  );

  s = replaceOnce(
    s,
    '  const [materiaux, setMateriaux] = useState([]);',
    '  const [materiaux, setMateriaux] = useState([]);\n  const [groupesTypes, setGroupesTypes] = useState([]);',
    "biblio groups state"
  );
  s = replaceOnce(
    s,
    '    loadMateriaux();\n    // Realtime',
    '    loadMateriaux();\n    loadGroupesTypes().then(setGroupesTypes);\n    // Realtime',
    "biblio groups load"
  );
  s = replaceOnce(
    s,
    '      setOuvrages(data);',
    '      setOuvrages(data.map(o => estOuvrageV2(o) ? normaliserOuvrageV2(o, { assignIds: true }) : o));',
    "biblio normalize load"
  );
  s = replaceOnce(
    s,
    '      sous_taches: JSON.parse(JSON.stringify(ouvrage.sous_taches || [])),',
    '      sous_taches: estOuvrageV2(ouvrage)\n        ? dupliquerSousTachesV2(ouvrage.sous_taches || [])\n        : JSON.parse(JSON.stringify(ouvrage.sous_taches || [])),',
    "biblio duplicate ids"
  );
  s = replaceOnce(
    s,
    '  async function saveOuvrage(ouvrage) {\n    setSaving(ouvrage.id);',
    '  async function saveOuvrage(ouvrage) {\n    setSaving(ouvrage.id);\n    const ouvrageClean = estOuvrageV2(ouvrage) ? normaliserOuvrageV2(ouvrage, { assignIds: true }) : ouvrage;',
    "biblio normalize save"
  );
  s = replaceOnce(
    s,
    '    const liensClean = (ouvrage.materiaux_liens || [])',
    '    const liensClean = (ouvrageClean.materiaux_liens || [])',
    "biblio save materials"
  );
  s = replaceOnce(
    s,
    '      libelle: ouvrage.libelle, unite: ouvrage.unite,\n      cadence: ouvrage.cadence ?? null,\n      sous_taches: ouvrage.sous_taches,',
    '      libelle: ouvrageClean.libelle, unite: ouvrageClean.unite,\n      cadence: ouvrageClean.cadence ?? null,\n      sous_taches: ouvrageClean.sous_taches,',
    "biblio save fields"
  );
  s = replaceOnce(
    s,
    '    } else {\n      flash("ok", "Ouvrage sauvegardé");\n    }',
    '    } else {\n      setOuvrages(prev => prev.map(o => o.id === ouvrage.id ? { ...o, ...ouvrageClean, materiaux_liens: liensClean } : o));\n      flash("ok", "Ouvrage sauvegardé");\n    }',
    "biblio save local state"
  );
  s = replaceOnce(
    s,
    '  const stats = {\n    total: ouvrages.length,\n    categories: Object.keys(catCounts).length,\n    avecCadence: ouvrages.filter(o => parseFloat(o.cadence) > 0).length,\n    sansCadence: ouvrages.filter(o => !o.cadence).length,\n  };',
    '  const v2 = ouvrages.filter(estOuvrageV2);\n  const v2Planifiables = v2.filter(o => maturiteOuvrageV2(o).planifiable).length;\n  const stats = {\n    total: ouvrages.length,\n    categories: Object.keys(catCounts).length,\n    avecCadence: ouvrages.filter(o => parseFloat(o.cadence) > 0).length,\n    sansCadence: ouvrages.filter(o => !o.cadence).length,\n    v2Total: v2.length,\n    v2Planifiables,\n  };',
    "biblio stats v2"
  );
  s = replaceOnce(
    s,
    '              { label: "Sans cadence",   value: stats.sansCadence, icon: Box,        color: stats.sansCadence > 0 ? "#f5a623" : T.textMuted },',
    '              { label: "Sans cadence",   value: stats.sansCadence, icon: Box,        color: stats.sansCadence > 0 ? "#f5a623" : T.textMuted },\n              { label: "V2 prêts planning", value: `${stats.v2Planifiables}/${stats.v2Total}`, icon: Check, color: stats.v2Planifiables === stats.v2Total && stats.v2Total > 0 ? "#22c55e" : "#f5a623" },',
    "biblio stats card"
  );
  s = replaceOnce(
    s,
    '          .biblio-page .biblio-row{grid-template-columns:1fr!important;gap:8px!important;padding:10px 12px!important}\n          .biblio-page .biblio-reorder',
    '          .biblio-page .biblio-row{grid-template-columns:1fr!important;gap:8px!important;padding:10px 12px!important}\n          .biblio-page .biblio-task-grid{grid-template-columns:1fr!important}\n          .biblio-page .biblio-reorder',
    "biblio mobile task grid"
  );
  s = replaceOnce(
    s,
    '                      materiaux={materiaux}\n                      T={T} acc={acc}',
    '                      materiaux={materiaux}\n                      groupesTypes={groupesTypes}\n                      T={T} acc={acc}',
    "biblio card group prop"
  );

  await writeFile(path, s, "utf8");
}

async function patchPhasage() {
  const path = new URL("../src/Renovation/PhasageV2.jsx", import.meta.url);
  let s = await readFile(path, "utf8");

  s = replaceOnce(
    s,
    'import { parseDevisExcel } from "../devisImport";',
    'import { parseDevisExcel } from "../devisImport";\nimport {\n  PLANNING_MODEL_VERSION, codeOuvrageDepuisLibelle, construireTachesDepuisOuvrageV2,\n  estOuvrageV2, normaliserOuvrageV2,\n} from "./planningModelV1";',
    "phasage import planning model"
  );

  const confirmImport = `  const confirmImport = () => {
    if (!importState) return;
    const selected = importState.items.filter(it => it.selectionne);
    if (selected.length === 0) { setImportState(null); return; }
    const importedAt = new Date().toISOString();

    const newOuvrages = selected.map(it => {
      const isV2 = !!it.match && estOuvrageV2(it.match);
      const ref = isV2 ? normaliserOuvrageV2(it.match) : it.match;
      const cadence = parseFloat(ref?.cadence) || null;
      const heuresEstimees = cadence && it.quantite ? parseFloat((cadence * it.quantite).toFixed(2)) : null;
      const sousTaches = ref?.sous_taches || [];
      const sumRatios = sousTaches.reduce((sum, st) => sum + (parseFloat(st.ratio) || 0), 0);
      const heuresDevis = parseFloat(it.heures);
      const resolveChronoGroupId = (groupeTypeId) =>
        chronoGroupes.find(g => String(g.groupe_type_id || "") === String(groupeTypeId || ""))?.id || null;

      let taches;
      if (isV2) {
        // Le constructeur V2 conserve l'identité source, le groupe d'exécution,
        // les dépendances riches et projette les HARD dans `predecesseurs` pour
        // rester compatible avec rang.js. La répartition des heures conserve la
        // règle historique : ratio normalisé par la somme réellement saisie.
        taches = construireTachesDepuisOuvrageV2(ref, {
          makeTaskId: rid,
          resolveChronoGroupId,
          heuresTotales: null,
        }).map(t => {
          const ratio = parseFloat(t.ratio) || 0;
          const part = (sumRatios > 0 && ratio > 0) ? ratio / sumRatios : null;
          return {
            ...t,
            heures_estimees: (heuresEstimees != null && part != null)
              ? parseFloat((heuresEstimees * part).toFixed(2)) : null,
            heures_vendues: (!isNaN(heuresDevis) && part != null)
              ? parseFloat((heuresDevis * part).toFixed(2)) : null,
          };
        });
      } else {
        // Compatibilité stricte des ouvrages historiques : ancien chemin inchangé.
        taches = sousTaches.map(st => {
          const ratio = parseFloat(st.ratio) || 0;
          const part = (sumRatios > 0 && ratio > 0) ? ratio / sumRatios : null;
          return {
            id: rid(),
            nom: st.nom || "",
            ratio,
            heures_estimees: (heuresEstimees != null && part != null)
              ? parseFloat((heuresEstimees * part).toFixed(2)) : null,
            heures_vendues: (!isNaN(heuresDevis) && part != null)
              ? parseFloat((heuresDevis * part).toFixed(2)) : null,
            avancement: 0,
          };
        });
      }

      const liens = (ref?.materiaux_liens || [])
        .filter(ml => ml && ml.materiau_id != null)
        .map(ml => ({
          materiau_id: ml.materiau_id,
          quantite: ml.quantite == null ? null : parseFloat(ml.quantite),
        }));
      const qOuvrage = parseFloat(it.quantite) || 0;
      const coutMatParUnite = liens.reduce((sum, ml) => {
        const m = materiauxBiblio.find(x => x.id === ml.materiau_id);
        return sum + (parseFloat(m?.prix_unitaire) || 0) * (parseFloat(ml.quantite) || 0);
      }, 0);
      const coutMateriaux = liens.length > 0 && qOuvrage > 0
        ? parseFloat((coutMatParUnite * qOuvrage).toFixed(2))
        : null;

      const codeOuvrage = isV2
        ? (ref?.code_ouvrage || codeOuvrageDepuisLibelle(it.libelle) || null)
        : null;
      const biblioRef = isV2 ? {
        id: ref?.id || null,
        code_ouvrage: codeOuvrage,
        planning_model_version: PLANNING_MODEL_VERSION,
        importe_le: importedAt,
        sous_taches: (ref?.sous_taches || []).map(st => ({
          id: st.id || null,
          groupe_type_id: st.groupe_type_id || null,
          dependance_mode: st.dependance_mode || "sequence",
          predecesseur_ids: Array.isArray(st.predecesseur_ids) ? st.predecesseur_ids : [],
          delai_min_calendaire: parseFloat(st.delai_min_calendaire) || 0,
          unite_delai: st.unite_delai || "heures",
        })),
      } : null;

      return {
        id: rid(),
        libelle: it.libelle,
        lot_id: it.lot_id || null,
        heures_devis: it.heures,
        quantite: it.quantite,
        unite: it.unite || "U",
        prix_ht: it.prix_ht,
        heures_estimees: heuresEstimees,
        bibliotheque_id: ref?.id || null,
        materiaux_liens: liens,
        ...(coutMateriaux != null ? { cout_materiaux: coutMateriaux } : {}),
        ...(isV2 ? {
          code_ouvrage: codeOuvrage,
          planning_model_version: PLANNING_MODEL_VERSION,
          bibliotheque_ref: biblioRef,
        } : {}),
        taches,
      };
    });
    updateOuvrages([...ouvrages, ...newOuvrages]);
    setImportState(null);
  };`;

  s = replaceSection(
    s,
    "  const confirmImport = () => {",
    "  // Comptes pour les badges",
    confirmImport,
    "phasage confirm import"
  );

  await writeFile(path, s, "utf8");
}

await patchBibliotheque();
await patchPhasage();
console.log("Planning Model V1 source patches: OK");
