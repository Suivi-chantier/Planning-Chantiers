// Page de la journée de la Validation (refonte CR-5) : en-tête avec flèches
// et rappel des jours en retard, résumé, regroupement par chantier ou par
// ouvrier, filtre « écarts seulement », légende des couleurs, une ligne par
// compte rendu lisible sans l'ouvrir, encart des tâches déclarées
// différemment par plusieurs ouvriers (avancement retenu appliqué à tous),
// encart des comptes rendus attendus mais non envoyés.
//
// Présentation seulement : la validation elle-même (garde-fou des heures,
// pointages, journal d'avancement) reste celle de Validation.jsx.
import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Icon, InputNombre } from "../ui";
import { RADIUS } from "../constants";
import {
  grouperRapports, etiquettesRapport, heuresDeclarees, manquantsDuChantier, tachesDeclareesDifferemment,
} from "./validationJourneeV1";

const ORANGE = "#f5a623";
const ROUGE = "#e05c5c";
const VERT = "#22c55e";

const fmtH = (h) => {
  const v = Math.round((parseFloat(h) || 0) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
};
const jourCourt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
const decalerJour = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export function couleurNiveau(niveau, T) {
  return niveau === "arbitrer" ? ROUGE : niveau === "ecarts" ? ORANGE : T.textSub;
}

function Badge({ classement, T }) {
  const c = couleurNiveau(classement?.niveau, T);
  return (
    <span style={{
      padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: .3,
      background: `${c}22`, color: c, border: `1px solid ${c}55`, whiteSpace: "nowrap",
    }}>{classement?.badge || "Comme prévu"}</span>
  );
}

const ETIQ = { termine: VERT, en_cours: "#4db8ff", bloque: ROUGE, non_faite: ORANGE, inconnu: "#888" };

function Etiquette({ e, T }) {
  const c = ETIQ[e.etat?.code] || "#888";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 6,
      background: T.widgetBg || T.bg, border: `1px solid ${T.border}`, fontSize: 12, color: T.text, maxWidth: 320,
    }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.nom}</span>
      <span style={{ color: c, fontWeight: 700, whiteSpace: "nowrap" }}>· {e.etat?.texte}</span>
    </span>
  );
}

function Vignettes({ rapport, T }) {
  const urls = [...new Set([
    ...(Array.isArray(rapport.photos_fin_journee) ? rapport.photos_fin_journee : []),
    ...(Array.isArray(rapport.photos_chantier) ? rapport.photos_chantier : []),
    ...(rapport.taches || []).flatMap(t => (Array.isArray(t.photos) ? t.photos : [])),
  ].filter(Boolean))];
  if (urls.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {urls.slice(0, 4).map((u, i) => (
        <a key={i} href={u} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{
          width: 40, height: 40, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.border}`, flexShrink: 0,
        }}>
          <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
        </a>
      ))}
      {urls.length > 4 && <span style={{ fontSize: 11, color: T.textSub }}>+{urls.length - 4}</span>}
    </div>
  );
}

// Une ligne par compte rendu, lisible sans l'ouvrir.
function LigneRapport({ r, classement, T, acc, mode, direct, validating, onOuvrir, onValiderDirect }) {
  const c = couleurNiveau(classement?.niveau, T);
  const etiquettes = etiquettesRapport(r);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "start",
      padding: "11px 13px", borderRadius: RADIUS.md, background: T.widgetBg || T.bg,
      border: `1px solid ${T.border}`, borderLeft: `4px solid ${c}`,
    }}>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, color: T.text }}>{mode === "ouvrier" ? (r.chantier_nom || r.chantier_id)
            : mode === "chantier" ? r.ouvrier : `${r.ouvrier} · ${r.chantier_nom || r.chantier_id}`}</strong>
          <Badge classement={classement} T={T}/>
          <span style={{ fontSize: 12, color: T.textSub }}>{fmtH(heuresDeclarees(r))} h</span>
          {r.statut === "valide" && <span style={{ fontSize: 11, color: VERT, fontWeight: 700 }}>Validé{r.valide_par ? ` par ${r.valide_par}` : ""}</span>}
        </div>
        {etiquettes.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {etiquettes.map((e, i) => <Etiquette key={i} e={e} T={T}/>)}
          </div>
        )}
        {(classement?.ecarts || []).length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
            {classement.ecarts.map((e, i) => (
              <li key={i} style={{ fontSize: 12.5, color: e.niveau === "rouge" ? ROUGE : ORANGE }}>
                <span style={{ color: T.text }}>{e.texte}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        <Vignettes rapport={r} T={T}/>
        <div style={{ display: "flex", gap: 6 }}>
          {direct && (
            <button onClick={() => onValiderDirect(r)} disabled={validating} style={{
              padding: "6px 14px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: "#111",
              fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: validating ? "wait" : "pointer", opacity: validating ? .6 : 1,
            }}>Valider</button>
          )}
          <button onClick={() => onOuvrir(r.id)} style={{
            padding: "6px 12px", borderRadius: RADIUS.md, border: `1px solid ${direct || r.statut === "valide" ? T.border : acc.accent}`,
            background: "transparent", color: direct || r.statut === "valide" ? T.text : acc.accent,
            fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          }}>{r.statut === "valide" ? "Ouvrir" : direct ? "Ouvrir" : "Ouvrir et valider"}</button>
        </div>
      </div>
    </div>
  );
}

// Tâche faite à plusieurs, déclarée différemment : montrée une seule fois.
function EncartPlusieurs({ t, retenu, T, acc, verrouille, onAppliquer }) {
  const valeurInit = retenu ?? Math.max(...t.declarations.map(d => d.avancement ?? 0));
  const [v, setV] = useState(valeurInit);
  return (
    <div style={{
      padding: "10px 12px", borderRadius: RADIUS.md, border: `1px solid ${ORANGE}66`, background: `${ORANGE}12`,
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>« {t.nom} » déclarée différemment</div>
        <div style={{ fontSize: 12.5, color: T.textSub }}>{t.phrase}</div>
      </div>
      <label style={{ fontSize: 12, color: T.textSub }}>Avancement retenu</label>
      <InputNombre min="0" max="100" entier valeur={v} vide={""} onValeur={n => setV(n === null ? "" : n)} disabled={verrouille}
        style={{ width: 64, padding: "5px 8px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.inputBg || T.surface, color: T.text, textAlign: "right" }}/>
      <span style={{ fontSize: 12, color: T.textSub }}>%</span>
      <button disabled={verrouille || v === ""} onClick={() => onAppliquer(t.tache_id, v)} style={{
        padding: "6px 12px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: "#111",
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, cursor: "pointer", opacity: verrouille || v === "" ? .5 : 1,
      }}>{t.declarations.length > 2 ? `Appliquer aux ${t.declarations.length}` : "Appliquer aux deux"}</button>
      {retenu != null && <span style={{ fontSize: 12, color: VERT, fontWeight: 700 }}>Retenu : {retenu} %</span>}
    </div>
  );
}

function EncartManquant({ manquants, T }) {
  if (manquants.length === 0) return null;
  return (
    <div style={{
      padding: "10px 12px", borderRadius: RADIUS.md, border: `2px dashed ${ROUGE}88`, color: T.text, fontSize: 13,
    }}>
      <strong style={{ color: ROUGE }}>Compte rendu attendu, non envoyé :</strong>{" "}
      {manquants.map(m => m.ouvrier).join(", ")}.{" "}
      <span style={{ color: T.textSub }}>La journée de ce chantier reste « incomplète » dans le bilan tant qu'il manque.</span>
    </div>
  );
}

function Chiffre({ titre, valeur, sous, couleur, T }) {
  return (
    <div style={{ padding: "10px 14px", borderRadius: RADIUS.md, background: T.surface, border: `1px solid ${T.border}`, minWidth: 150 }}>
      <div style={{ fontSize: 11, color: T.textSub, textTransform: "uppercase", letterSpacing: .4, fontWeight: 700 }}>{titre}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: couleur || T.text }}>{valeur}</div>
      {sous && <div style={{ fontSize: 12, color: T.textSub }}>{sous}</div>}
    </div>
  );
}

export default function ValidationJournee({
  T, acc, dateFilter, setDateFilter, titreDate, actionsEntete = null,
  rapports = [], classements = {}, attendus = [], resume, joursRetard = [],
  avancementParChantier = {}, arbitrages = {}, onAppliquerArbitrage,
  peutDirect = () => false, onValiderDirect, onOuvrir, validating = false, journeeCloturee = false,
}) {
  const [mode, setMode] = useState("chantier");
  const [ecartsSeulement, setEcartsSeulement] = useState(false);
  const [voirValides, setVoirValides] = useState(false);

  const enAttente = rapports.filter(r => r.statut !== "valide");
  const visibles = enAttente.filter(r => !ecartsSeulement || (classements[r.id]?.niveau || "comme_prevu") !== "comme_prevu");
  const valides = rapports.filter(r => r.statut === "valide");
  // Chantiers à afficher : ceux des comptes rendus à valider, plus ceux qui
  // ont un compte rendu attendu manquant (même sans aucun compte rendu reçu).
  const groupes = useMemo(() => {
    const gs = grouperRapports(visibles, mode);
    if (mode !== "chantier") return gs;
    const vus = new Set(gs.map(g => g.cle));
    attendus.filter(a => a.statut === "manquant" && !vus.has(String(a.chantier_id))).forEach(a => {
      vus.add(String(a.chantier_id));
      gs.push({ cle: String(a.chantier_id), titre: a.chantier_nom || String(a.chantier_id), rapports: [] });
    });
    return gs.sort((a, b) => a.titre.localeCompare(b.titre, "fr"));
  }, [visibles, mode, attendus]);

  const pct = resume?.progression == null ? null : Math.round(resume.progression * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* En-tête : date, flèches, rappel des jours en retard */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setDateFilter(decalerJour(dateFilter, -1))} title="Jour précédent" style={btnRond(T)}><Icon as={ChevronLeft} size={18}/></button>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.text, textTransform: "capitalize" }}>{titreDate}</div>
        <button onClick={() => setDateFilter(decalerJour(dateFilter, 1))} title="Jour suivant" style={btnRond(T)}><Icon as={ChevronRight} size={18}/></button>
        <input type="date" value={dateFilter} onChange={e => e.target.value && setDateFilter(e.target.value)} style={{
          padding: "6px 10px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 13, fontFamily: "inherit",
        }}/>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>{actionsEntete}</div>
      </div>
      {joursRetard.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, color: T.textSub }}>
          Encore à valider :
          {joursRetard.map(j => (
            <button key={j.date} onClick={() => setDateFilter(j.date)} style={{
              padding: "3px 10px", borderRadius: 999, border: `1px solid ${ORANGE}66`, background: `${ORANGE}14`, color: T.text,
              fontFamily: "inherit", fontSize: 12, cursor: "pointer", textTransform: "capitalize",
            }}>{jourCourt(j.date)} · {j.nb} compte{j.nb > 1 ? "s" : ""} rendu{j.nb > 1 ? "s" : ""}</button>
          ))}
        </div>
      )}

      {/* Résumé de la journée */}
      {resume && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Chiffre T={T} titre="À valider" valeur={resume.aValider}
            sous={resume.dontEcarts > 0 ? `dont ${resume.dontEcarts} avec écarts` : "aucun écart"} couleur={resume.dontEcarts > 0 ? ORANGE : T.text}/>
          <Chiffre T={T} titre="Validés" valeur={resume.valides} sous={`${fmtH(resume.heuresValidees)} h enregistrées`} couleur={VERT}/>
          <Chiffre T={T} titre="Non envoyés" valeur={resume.nonEnvoyes.length} couleur={resume.nonEnvoyes.length > 0 ? ROUGE : T.text}
            sous={resume.nonEnvoyes.length > 0 ? resume.nonEnvoyes.map(n => `${n.ouvrier} (${n.chantier_nom || n.chantier_id})`).join(", ") : "tous reçus"}/>
          <Chiffre T={T} titre="Heures déclarées" valeur={`${fmtH(resume.heuresDeclarees)} h`}
            sous={resume.heuresAttendues == null ? "attendu : inconnu pour au moins un ouvrier" : `sur ${fmtH(resume.heuresAttendues)} h attendues`}/>
        </div>
      )}
      {pct != null && (
        <div>
          <div style={{ height: 8, borderRadius: 999, background: T.border, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: acc.accent }}/>
          </div>
          <div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}>Journée validée à {pct} % (comptes rendus reçus ou attendus)</div>
        </div>
      )}

      {/* Regroupement, filtre, légende */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: RADIUS.md, overflow: "hidden" }}>
          {[["chantier", "Par chantier"], ["ouvrier", "Par ouvrier"]].map(([m, l]) => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "6px 12px", border: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: mode === m ? acc.accent : "transparent", color: mode === m ? "#111" : T.text,
            }}>{l}</button>
          ))}
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: T.text, cursor: "pointer" }}>
          <input type="checkbox" checked={ecartsSeulement} onChange={e => setEcartsSeulement(e.target.checked)}/> Écarts seulement
        </label>
        <div style={{ marginLeft: "auto", display: "flex", gap: 12, fontSize: 12, color: T.textSub, flexWrap: "wrap" }}>
          <span><Pastille c={T.textSub}/> comme prévu</span>
          <span><Pastille c={ORANGE}/> écarts à regarder</span>
          <span><Pastille c={ROUGE}/> à arbitrer (bloqué, hors devis, tâche créée, compte rendu manquant)</span>
        </div>
      </div>

      {/* Groupes */}
      {groupes.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: T.textSub, fontSize: 14, border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
          {rapports.length === 0 && attendus.length === 0 ? "Aucun compte rendu pour cette date."
            : ecartsSeulement && enAttente.length > 0 ? "Aucun compte rendu avec écart à valider."
            : "Tous les comptes rendus reçus sont validés."}
        </div>
      )}
      {groupes.map(g => {
        const manquants = mode === "chantier" ? manquantsDuChantier(attendus, g.cle) : [];
        const tousDuChantier = mode === "chantier" ? rapports.filter(r => String(r.chantier_id) === g.cle) : [];
        const plusieurs = mode === "chantier" ? tachesDeclareesDifferemment(tousDuChantier) : [];
        const heures = g.rapports.reduce((s, r) => s + heuresDeclarees(r), 0);
        const av = mode === "chantier" ? avancementParChantier[g.cle] : null;
        return (
          <section key={g.cle} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg || 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0, fontSize: 16, color: T.text }}>{g.titre}</h3>
              <span style={{ fontSize: 12.5, color: T.textSub }}>
                {g.rapports.length} compte{g.rapports.length > 1 ? "s" : ""} rendu{g.rapports.length > 1 ? "s" : ""} à valider · {fmtH(heures)} h
                {av != null ? ` · avancement ${av} %` : ""}
              </span>
            </div>
            {plusieurs.map(t => (
              <EncartPlusieurs key={t.tache_id} t={t} T={T} acc={acc} verrouille={journeeCloturee}
                retenu={arbitrages[g.cle]?.[t.tache_id] ?? null}
                onAppliquer={(tacheId, v) => onAppliquerArbitrage(g.cle, tacheId, v)}/>
            ))}
            <EncartManquant manquants={manquants} T={T}/>
            {g.rapports.map(r => (
              <LigneRapport key={r.id} r={r} classement={classements[r.id]} T={T} acc={acc} mode={mode}
                direct={peutDirect(r)} validating={validating} onOuvrir={onOuvrir} onValiderDirect={onValiderDirect}/>
            ))}
          </section>
        );
      })}

      {/* Comptes rendus déjà validés, repliés en bas */}
      {valides.length > 0 && (
        <div>
          <button onClick={() => setVoirValides(v => !v)} style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: RADIUS.md,
            border: `1px solid ${T.border}`, background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
          }}>
            <Icon as={CheckCircle2} size={14} color={VERT}/> {valides.length} compte{valides.length > 1 ? "s" : ""} rendu{valides.length > 1 ? "s" : ""} validé{valides.length > 1 ? "s" : ""}
            <Icon as={voirValides ? ChevronUp : ChevronDown} size={14}/> {voirValides ? "Masquer" : "Afficher"}
          </button>
          {voirValides && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {valides.map(r => (
                <LigneRapport key={r.id} r={r} classement={classements[r.id]} T={T} acc={acc} mode="ouvrier_et_chantier"
                  direct={false} validating={validating} onOuvrir={onOuvrir} onValiderDirect={onValiderDirect}/>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pastille({ c }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 999, background: c, marginRight: 4, verticalAlign: "middle" }}/>;
}
const btnRond = (T) => ({
  width: 32, height: 32, borderRadius: 999, border: `1px solid ${T.border}`, background: T.surface, color: T.text,
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
});
