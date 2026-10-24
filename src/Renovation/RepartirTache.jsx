// Fenêtre « Répartir sur les tâches du phasage » (refonte CR-5) : une tâche
// regroupée (« fourre-tout ») déclarée par l'ouvrier est répartie sur
// plusieurs tâches du phasage. Proposition expliquée (texte dicté, planning
// du jour, tâches standard), une ligne par tâche, ±15 min, parts égales ou
// selon les durées prévues, barre colorée, validation seulement quand le
// total tombe exactement sur les heures déclarées. Compteur des tâches
// regroupées de l'ouvrier ce mois-ci (suivi qualité, CR-1).
//
// Rien n'est écrit ici : la répartition remplace la ligne dans la fenêtre de
// validation, et c'est la validation (inchangée) qui enregistre les heures.
import React, { useMemo, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { Icon, InputNombre } from "../ui";
import { RADIUS } from "../constants";
import {
  proposerRepartition, repartirPartsEgales, repartirSelonDurees, ecartRepartition, repartitionJuste, ajusterQuartDHeure,
} from "./validationJourneeV1";

const COULEURS = ["#FFC200", "#4db8ff", "#22c55e", "#a78bfa", "#f97316", "#06b6d4", "#e879f9", "#84cc16"];
const MOTIFS = { introuvable: "pas trouvée dans la liste", imprevu: "travail imprévu", demande_client: "demande du client" };
const fmtH = (h) => {
  const v = Math.round((parseFloat(h) || 0) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
};
const fmtMin = (m) => `${m < 0 ? "−" : "+"}${fmtH(Math.abs(m) / 60)} h`;

export default function RepartirTache({
  ligne, texteDicte = "", tachesPlan = [], tachesPrevuesJour = [], dureesPrevues = {}, compteur = null,
  T, acc, onValider, onClose,
}) {
  const total = parseFloat(ligne.heures) || 0;
  const intitule = ligne.proposition?.nom || ligne.planifie || "(sans nom)";
  const texte = [texteDicte, ligne.remarque].filter(Boolean).join(" — ");
  const plan = useMemo(() => tachesPlan.map(t => ({ ...t, heures_prevues: dureesPrevues[String(t.id)] ?? 0 })), [tachesPlan, dureesPrevues]);
  const [parts, setParts] = useState(() => {
    const p = proposerRepartition({ texte: `${intitule} ${texte}`, tachesPlan: plan, tachesPrevuesJour, heures: total });
    return p.length > 0 ? p : [{ tache_id: null, heures: total, etat: "en_cours", avancement: null, raison: null }];
  });
  const [garder, setGarder] = useState(true);
  const [recherche, setRecherche] = useState("");

  const ecart = ecartRepartition(parts, total);
  const juste = repartitionJuste(parts, total);
  const maj = (i, patch) => setParts(prev => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const groupes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const m = new Map();
    plan.filter(t => !q || `${t.nom} ${t.nom_devis || ""} ${t.groupe || ""}`.toLowerCase().includes(q)).forEach(t => {
      const g = t.groupe || "Autres";
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(t);
    });
    return [...m.entries()];
  }, [plan, recherche]);
  const nomDe = (id) => plan.find(t => String(t.id) === String(id))?.nom || "";
  const repartirEgal = () => {
    const h = repartirPartsEgales(total, parts.length);
    setParts(prev => prev.map((p, i) => ({ ...p, heures: h[i] })));
  };
  const repartirDurees = () => {
    const h = repartirSelonDurees(total, parts.map(p => dureesPrevues[String(p.tache_id)] ?? 0));
    setParts(prev => prev.map((p, i) => ({ ...p, heures: h[i] })));
  };
  const valider = () => {
    if (!juste) return;
    onValider(parts.map(p => {
      const t = plan.find(x => String(x.id) === String(p.tache_id));
      return { ...p, nom: t?.nom || p.nom, phase_id: t?.phase_id || null, ouvrage_id: t?.ouvrage_id || null };
    }), garder);
  };

  const champ = { padding: "5px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text, fontSize: 12.5, fontFamily: "inherit" };
  const btn = { padding: "5px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 12.5, cursor: "pointer" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 980, maxHeight: "92vh", overflowY: "auto", background: T.surface, color: T.text,
        border: `1px solid ${T.border}`, borderRadius: RADIUS.lg || 12,
      }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>Répartir sur les tâches du phasage</span>
          {compteur && <span style={{ fontSize: 12.5, fontWeight: 700, color: "#f5a623" }}>{compteur}</span>}
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: T.textSub, cursor: "pointer" }}><Icon as={X} size={18}/></button>
        </div>

        {/* Ce que l'ouvrier a déclaré */}
        <div style={{ padding: "12px 20px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>« {intitule} » · {fmtH(total)} h déclarées</div>
            {ligne.proposition?.motif_hd && <div style={{ fontSize: 12.5, color: T.textSub }}>Motif : {MOTIFS[ligne.proposition.motif_hd] || ligne.proposition.motif_hd}</div>}
            {texteDicte && <div style={{ fontSize: 12.5, color: T.text, fontStyle: "italic" }}>Texte dicté : « {texteDicte} »</div>}
            {ligne.remarque && <div style={{ fontSize: 12.5, color: T.text }}>Remarque : {ligne.remarque}</div>}
          </div>
          {Array.isArray(ligne.photos) && ligne.photos.length > 0 && (
            <div style={{ display: "flex", gap: 4 }}>
              {ligne.photos.slice(0, 4).map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ width: 56, height: 56, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.border}` }}>
                  <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Barre colorée de la répartition */}
        <div style={{ padding: "12px 20px 4px" }}>
          <div style={{ display: "flex", height: 14, borderRadius: 999, overflow: "hidden", background: T.border }}>
            {parts.map((p, i) => (
              <div key={i} title={`${nomDe(p.tache_id) || "(à choisir)"} : ${fmtH(p.heures)} h`}
                style={{ width: `${total > 0 ? Math.min(100, ((parseFloat(p.heures) || 0) / total) * 100) : 0}%`, background: COULEURS[i % COULEURS.length] }}/>
            ))}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 4, color: ecart === 0 ? "#22c55e" : "#e05c5c", fontWeight: 700 }}>
            {ecart === 0 ? `Le total tombe juste : ${fmtH(total)} h` : `Total ${fmtH(total + ecart / 60)} h pour ${fmtH(total)} h déclarées (${fmtMin(ecart)})`}
          </div>
        </div>

        {/* Lignes */}
        <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <input placeholder="Rechercher une tâche du phasage…" value={recherche} onChange={e => setRecherche(e.target.value)} style={{ ...champ, maxWidth: 360 }}/>
          {parts.map((p, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "10px minmax(0,1fr) 170px 190px 30px", gap: 8, alignItems: "center",
              padding: "8px 10px", borderRadius: RADIUS.md, background: T.widgetBg || T.bg, border: `1px solid ${T.border}` }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: COULEURS[i % COULEURS.length] }}/>
              <div style={{ minWidth: 0 }}>
                <select value={p.tache_id ?? ""} onChange={e => maj(i, { tache_id: e.target.value || null, raison: null })} style={{ ...champ, width: "100%" }}>
                  <option value="">— Choisir la tâche —</option>
                  {p.tache_id && !groupes.some(([, ts]) => ts.some(t => String(t.id) === String(p.tache_id))) && (
                    <option value={p.tache_id}>{nomDe(p.tache_id)}</option>
                  )}
                  {groupes.map(([g, ts]) => (
                    <optgroup key={g} label={g}>
                      {ts.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                    </optgroup>
                  ))}
                </select>
                {p.raison && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2 }}>Proposée : {p.raison}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button onClick={() => maj(i, { heures: ajusterQuartDHeure(p.heures, -1) })} style={btn}>−15</button>
                <InputNombre min="0" valeur={p.heures} vide={0} onValeur={n => maj(i, { heures: n ?? 0 })} style={{ ...champ, width: 56, textAlign: "right" }}/>
                <button onClick={() => maj(i, { heures: ajusterQuartDHeure(p.heures, 1) })} style={btn}>+15</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <select value={p.etat} onChange={e => maj(i, { etat: e.target.value })} style={champ}>
                  <option value="en_cours">En cours</option>
                  <option value="terminee">Terminée</option>
                </select>
                {p.etat === "en_cours" && (
                  <>
                    <InputNombre min="0" max="100" entier valeur={p.avancement ?? ""} vide={""}
                      onValeur={n => maj(i, { avancement: n === null ? null : Math.max(0, Math.min(100, n)) })} style={{ ...champ, width: 52, textAlign: "right" }}/>
                    <span style={{ fontSize: 12, color: T.textSub }}>%</span>
                  </>
                )}
              </div>
              <button onClick={() => setParts(prev => prev.filter((_, j) => j !== i))} disabled={parts.length <= 1}
                style={{ border: "none", background: "transparent", color: "#e05c5c", cursor: "pointer", opacity: parts.length <= 1 ? .4 : 1 }}>
                <Icon as={Trash2} size={14}/>
              </button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setParts(prev => [...prev, { tache_id: null, heures: 0, etat: "en_cours", avancement: null, raison: null }])} style={btn}>
              <Icon as={Plus} size={12}/> Ajouter une ligne
            </button>
            <button onClick={repartirEgal} style={btn}>Parts égales</button>
            <button onClick={repartirDurees} style={btn}>Selon les durées prévues</button>
          </div>
        </div>

        <div style={{ padding: "12px 20px", borderTop: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", flex: 1 }}>
            <input type="checkbox" checked={garder} onChange={e => setGarder(e.target.checked)}/>
            Garder les photos et le texte dicté sur chaque tâche
          </label>
          <button onClick={onClose} style={{ ...btn, padding: "8px 14px" }}>Annuler</button>
          <button onClick={valider} disabled={!juste} title={juste ? "" : "Le total doit être exactement égal aux heures déclarées, et chaque ligne doit avoir une tâche et des heures"}
            style={{ padding: "8px 16px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: "#111", fontFamily: "inherit",
              fontSize: 13, fontWeight: 800, cursor: juste ? "pointer" : "not-allowed", opacity: juste ? 1 : .45 }}>
            Valider la répartition
          </button>
        </div>
      </div>
    </div>
  );
}
