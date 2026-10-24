// Détail d'un compte rendu de la Validation (refonte CR-5) : en-tête avec
// retour à la journée, position « Compte rendu 2 sur 5 » et « Valider et
// passer au suivant », en-tête de carte par tâche (chemin lot › ouvrage,
// barre de budget, avancement avant → déclaré par chaque ouvrier → retenu),
// colonne latérale (journée de l'ouvrier, autres comptes rendus du chantier,
// photos de fin de journée, corrections).
//
// Présentation seulement : les écritures restent celles de Validation.jsx.
import React from "react";
import { ArrowLeft } from "lucide-react";
import { Icon } from "../ui";
import { RADIUS } from "../constants";
import { couleurNiveau } from "./ValidationJournee";
import { heuresDeclarees, etatLigne } from "./validationJourneeV1";

const ROUGE = "#e05c5c";
const VERT = "#22c55e";
const fmtH = (h) => {
  const v = Math.round((parseFloat(h) || 0) * 100) / 100;
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "")).replace(".", ",");
};
const heureEnvoi = (r) => {
  const d = r?.created_at ? new Date(r.created_at) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;
};

export function EnteteDetail({
  rapport, classement, titreDate, position, suivant, T, acc, verrouille, validating,
  onRetour, onValider, onValiderEtSuivant, actionValide = null,
}) {
  const c = couleurNiveau(classement?.niveau, T);
  const envoi = heureEnvoi(rapport);
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 3, background: T.bg, borderBottom: `1px solid ${T.border}`,
      padding: "12px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
    }}>
      <div style={{ flex: 1, minWidth: 260 }}>
        <button onClick={onRetour} style={{
          display: "inline-flex", alignItems: "center", gap: 6, border: "none", background: "transparent",
          color: acc.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0,
        }}><Icon as={ArrowLeft} size={14}/> Retour à la journée</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: T.text }}>{rapport.ouvrier} · {rapport.chantier_nom || rapport.chantier_id}</span>
          {classement && (
            <span style={{ padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 800, background: `${c}22`, color: c, border: `1px solid ${c}55` }}>
              {classement.badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: T.textSub, textTransform: "capitalize" }}>
          {titreDate}{envoi ? <span style={{ textTransform: "none" }}> · envoyé à {envoi}</span> : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {position && (
          <span style={{ fontSize: 12.5, color: T.textSub }}>Compte rendu {position.index} sur {position.total}</span>
        )}
        {actionValide || (!verrouille && (
          <>
            <button onClick={onValider} disabled={validating} style={{
              padding: "8px 14px", borderRadius: RADIUS.md, border: `1px solid ${acc.accent}`, background: "transparent",
              color: acc.accent, fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: validating ? "wait" : "pointer",
            }}>Valider</button>
            {suivant && (
              <button onClick={onValiderEtSuivant} disabled={validating} style={{
                padding: "8px 16px", borderRadius: RADIUS.md, border: "none", background: acc.accent, color: "#111",
                fontFamily: "inherit", fontSize: 13, fontWeight: 800, cursor: validating ? "wait" : "pointer", opacity: validating ? .6 : 1,
              }}>{validating ? "Validation…" : `Valider et passer au suivant · ${suivant.ouvrier}`}</button>
            )}
          </>
        ))}
      </div>
    </div>
  );
}

// Barre de budget : heures avant aujourd'hui, heures du jour (par personne),
// trait des heures prévues, dépassement en rouge avec son coût estimé.
export function BarreBudget({ budget, T, acc }) {
  if (!budget) return null;
  const echelle = Math.max(budget.total, budget.prevues || 0, 0.01);
  const pct = (h) => `${Math.min(100, (h / echelle) * 100)}%`;
  const dansBudget = budget.prevues > 0 ? Math.min(budget.total, budget.prevues) : budget.total;
  const avantDans = Math.min(budget.avant, dansBudget);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ position: "relative", height: 10, borderRadius: 999, background: T.border, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(avantDans), background: "#4db8ff" }}/>
        <div style={{ position: "absolute", left: pct(avantDans), top: 0, bottom: 0, width: pct(Math.max(0, dansBudget - avantDans)), background: acc.accent }}/>
        {budget.depassement > 0 && (
          <div style={{ position: "absolute", left: pct(budget.prevues), top: 0, bottom: 0, width: pct(budget.depassement), background: ROUGE }}/>
        )}
        {budget.prevues > 0 && (
          <div title={`${fmtH(budget.prevues)} h prévues`} style={{ position: "absolute", left: pct(budget.prevues), top: -2, bottom: -2, width: 2, background: T.text }}/>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: budget.depassement > 0 ? ROUGE : T.textSub }}>
        {fmtH(budget.avant)} h avant aujourd'hui
        {budget.parPersonne.length > 0 && ` · aujourd'hui ${budget.parPersonne.map(p => `${p.ouvrier} ${fmtH(p.heures)} h`).join(", ")}`}
        {" · "}{budget.texte}
      </div>
    </div>
  );
}

// En-tête d'une carte de tâche : chemin, libellé devis, budget, avancement.
export function EnteteCarteTache({ chemin, libelleDevis, budget, avant, declarations = [], retenu, T, acc }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 2px 6px" }}>
      {chemin && <div style={{ fontSize: 11.5, color: T.textSub }}>{chemin}</div>}
      {libelleDevis && <div style={{ fontSize: 11, color: T.textMuted || T.textSub }}>Devis : {libelleDevis}</div>}
      <BarreBudget budget={budget} T={T} acc={acc}/>
      {(avant != null || declarations.length > 0) && (
        <div style={{ fontSize: 12, color: T.text }}>
          Avancement : <span style={{ color: T.textSub }}>avant {avant != null ? `${avant} %` : "inconnu"}</span>
          {declarations.length > 0 && <> → {declarations.map((d, i) => (
            <span key={i}>{i > 0 && " · "}{d.ouvrier} {d.texte}</span>
          ))}</>}
          {retenu !== "" && retenu != null && <> → <strong style={{ color: acc.accent }}>retenu {retenu} %</strong></>}
        </div>
      )}
    </div>
  );
}

const titreCol = (T) => ({ margin: "0 0 6px", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: .5, color: T.textSub });
const boite = (T) => ({ background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: 12 });

export function ColonneLaterale({
  rapport, rapportsOuvrierJour = [], rapportsChantierJour = [], heuresAttendues = null,
  classements = {}, T, acc, onOuvrir, correction = null,
}) {
  const trajetMin = (parseInt(rapport.trajet_matin_min) || 0) + (parseInt(rapport.trajet_soir_min) || 0);
  const totalJour = rapportsOuvrierJour.reduce((s, r) => s + heuresDeclarees(r), 0) + trajetMin / 60;
  const ecart = heuresAttendues == null ? null : Math.round((totalJour - heuresAttendues) * 100) / 100;
  const indirectes = rapportsOuvrierJour.flatMap(r => (Array.isArray(r.heures_indirectes) ? r.heures_indirectes : []));
  const photosFin = Array.isArray(rapport.photos_fin_journee) ? rapport.photos_fin_journee : [];
  return (
    <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={boite(T)}>
        <h4 style={titreCol(T)}>Journée de {rapport.ouvrier}</h4>
        {rapportsOuvrierJour.map(r => (
          <div key={r.id} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{r.chantier_nom || r.chantier_id}{r.id === rapport.id ? " (ce compte rendu)" : ""}</span>
              <span>{fmtH(heuresDeclarees(r))} h</span>
            </div>
            {(r.taches || []).filter(t => (parseFloat(t.heures_reelles) || 0) > 0).map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: T.textSub, display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.planifie || t.proposition?.nom || "(sans nom)"} · {etatLigne(t)?.texte}</span>
                <span>{fmtH(t.heures_reelles)} h</span>
              </div>
            ))}
          </div>
        ))}
        {trajetMin > 0 && <div style={{ fontSize: 12, color: T.textSub }}>Trajets : {fmtH(trajetMin / 60)} h ({parseInt(rapport.trajet_matin_min) || 0} min matin, {parseInt(rapport.trajet_soir_min) || 0} min soir)</div>}
        {indirectes.length > 0 && <div style={{ fontSize: 12, color: T.textSub }}>Heures indirectes : {indirectes.map(x => `${x.motif || "?"} ${fmtH(x.heures)} h`).join(", ")}</div>}
        <div style={{ marginTop: 6, fontSize: 13, fontWeight: 800, color: ecart && Math.abs(ecart) > 0.01 ? ROUGE : T.text }}>
          Total {fmtH(totalJour)} h{heuresAttendues == null ? " · attendu inconnu" : ` pour ${fmtH(heuresAttendues)} h attendues`}
        </div>
      </div>

      {rapportsChantierJour.length > 0 && (
        <div style={boite(T)}>
          <h4 style={titreCol(T)}>Autres comptes rendus du chantier</h4>
          {rapportsChantierJour.map(r => {
            const cl = classements[r.id];
            return (
              <button key={r.id} onClick={() => onOuvrir(r.id)} style={{
                width: "100%", display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", border: "none",
                background: "transparent", color: T.text, fontFamily: "inherit", fontSize: 12.5, cursor: "pointer", textAlign: "left",
              }}>
                <span>{r.ouvrier} · {fmtH(heuresDeclarees(r))} h</span>
                <span style={{ color: r.statut === "valide" ? VERT : couleurNiveau(cl?.niveau, T), fontWeight: 700 }}>
                  {r.statut === "valide" ? "Validé" : cl?.badge || "À valider"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {photosFin.length > 0 && (
        <div style={boite(T)}>
          <h4 style={titreCol(T)}>Photos de fin de journée</h4>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {photosFin.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ width: 84, height: 84, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
                <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
              </a>
            ))}
          </div>
        </div>
      )}

      {correction && (
        <div style={boite(T)}>
          <h4 style={titreCol(T)}>Corrections</h4>
          {correction}
        </div>
      )}
    </aside>
  );
}
