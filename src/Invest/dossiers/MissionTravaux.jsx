// src/Invest/dossiers/MissionTravaux.jsx — onglet « Travaux » : consulter l'avancement, sans recréer la gestion de chantier.
// Budget et dates viennent de l'acquisition (invest_dossier_acquisitions) ; le mode (pas de travaux · externes · Profero
// Rénovation), le responsable et les notes vivent dans invest_dossiers.suivi_offre2 (colonne optionnelle). Aucune liaison
// avec les chantiers de Profero Rénovation n'existe encore : le nom du chantier est saisi, rien n'est lu ni écrit côté Rénovation.
import React, { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import { erreursAcquisition } from "./calculAcquisition";
import { MODES_TRAVAUX, majSuivi, nombreOuNull } from "./offre2Vue";
import { Bloc, Pastille, EtatVide, Donnee, COULEURS, eur, dateFr } from "./MissionUi";

export async function enregistrerSuivi(dossier, section, valeurs) {
  const suivante = majSuivi(dossier.suivi_offre2, section, valeurs);
  const r = await supabase.from("invest_dossiers").update({ suivi_offre2: suivante }).eq("id", dossier.id).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Enregistrement refusé : droits insuffisants sur cette mission.");
}

const Champ = ({ T, libelle, children }) => (<label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10.5, color: T.textMuted, fontWeight: 700, minWidth: 0 }}>{libelle}{children}</label>);

export default function MissionTravaux({ T, fiche, m, modifiable, recharger, onMessage, naviguer }) {
  const t = m.travaux, a = m.acquisition, d = fiche.dossier;
  const [f, setF] = useState({ budget: "", debut: "", fin: "", responsable: "", livraison: "", chantier: "", notes: "" });
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    setF({ budget: a?.budget_travaux ?? "", debut: a?.travaux_debut_le || "", fin: a?.travaux_fin_le || "", responsable: t.responsable, livraison: t.livraisonPrevue || "", chantier: t.chantier, notes: t.notes });
  }, [a?.id, a?.updated_at, d.updated_at]);
  const maj = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const agir = async (fn, ok) => { setOccupe(true); setErreur(""); try { await fn(); onMessage?.(ok); recharger(); } catch (e) { setErreur(e.message); } setOccupe(false); };

  const choisirMode = (mode) => agir(() => enregistrerSuivi(d, "travaux", { mode }), `Travaux : ${MODES_TRAVAUX[mode].toLowerCase()}.`);
  const sansTravauxParBudget = () => agir(async () => {
    const r = await supabase.from("invest_dossier_acquisitions").update({ budget_travaux: 0, updated_at: new Date().toISOString() }).eq("id", a.id).select("id");
    if (r.error) throw new Error(r.error.message);
    if (!r.data?.length) throw new Error("Enregistrement refusé : droits insuffisants.");
  }, "Travaux : aucun (budget 0 €).");
  const enregistrer = () => agir(async () => {
    if (a) {
      const patch = { budget_travaux: f.budget === "" ? null : nombreOuNull(f.budget), travaux_debut_le: f.debut || null, travaux_fin_le: f.fin || null };
      const verif = erreursAcquisition({ ...a, ...patch, budget_travaux: patch.budget_travaux ?? "" });
      if (verif.length) throw new Error(verif.join(" "));
      const r = await supabase.from("invest_dossier_acquisitions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", a.id).select("id");
      if (r.error) throw new Error(r.error.message);
      if (!r.data?.length) throw new Error("Enregistrement refusé : droits insuffisants.");
    }
    if (m.suiviDisponible) await enregistrerSuivi(d, "travaux", { responsable: f.responsable.trim(), livraison_prevue: f.livraison || null, chantier: f.chantier.trim(), notes: f.notes.trim() });
  }, "Travaux enregistrés.");

  const etat = { na: ["Travaux non nécessaires", COULEURS.na], termine: ["Travaux terminés", COULEURS.termine], cours: ["Travaux en cours", COULEURS.cours], avenir: ["Travaux à venir", COULEURS.avenir], inconnu: ["À définir", "#d97706"] }[t.etat];
  const dis = !modifiable;
  return (
    <>
      <Bloc T={T} titre="Nature des travaux" action={<Pastille couleur={etat[1]}>{etat[0]}</Pastille>}>
        {m.suiviDisponible ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(MODES_TRAVAUX).map(([k, l]) => (
              <button key={k} className="inv-btn inv-btn-sm" disabled={dis || occupe} onClick={() => choisirMode(k)} aria-pressed={t.mode === k}
                style={t.mode === k ? { background: T.accentBg, color: T.text, border: `1.5px solid ${T.accent}`, fontWeight: 900 } : undefined}>{l}</button>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: T.textSub }}>
            Le mode de travaux (Profero Rénovation, externes) sera enregistrable après l'évolution de la base prévue. {a && t.mode !== "aucun" && modifiable && <button className="inv-btn inv-btn-sm" disabled={occupe} onClick={sansTravauxParBudget}>Marquer « pas de travaux » (budget 0 €)</button>}
          </div>
        )}
        {t.mode === "aucun" && <div style={{ fontSize: 13, color: T.text, marginTop: 8 }}>Travaux non nécessaires pour cette opération.</div>}
        {!t.mode && <div style={{ marginTop: 8 }}><EtatVide T={T} titre="Travaux à définir" texte="Indiquez s'il y a des travaux et qui les réalise." /></div>}
      </Bloc>

      {t.mode !== "aucun" && (
        <Bloc T={T} titre={t.mode === "profero" ? "Chantier Profero Rénovation" : "Suivi des travaux"}>
          {!a && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>L'acquisition n'est pas encore ouverte : le budget et les dates se saisissent une fois l'offre acceptée.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
            {a && <Champ T={T} libelle="Budget travaux (€)"><input className="inv-inp" inputMode="decimal" disabled={dis} value={f.budget} onChange={maj("budget")} placeholder="Non renseigné" /></Champ>}
            {a && <Champ T={T} libelle="Date de démarrage"><input className="inv-inp" type="date" disabled={dis} value={f.debut} onChange={maj("debut")} /></Champ>}
            {a && <Champ T={T} libelle="Fin réelle"><input className="inv-inp" type="date" disabled={dis} value={f.fin} onChange={maj("fin")} /></Champ>}
            {m.suiviDisponible && <Champ T={T} libelle="Livraison prévue"><input className="inv-inp" type="date" disabled={dis} value={f.livraison} onChange={maj("livraison")} /></Champ>}
            {m.suiviDisponible && <Champ T={T} libelle="Responsable"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.responsable} onChange={maj("responsable")} /></Champ>}
            {m.suiviDisponible && t.mode === "profero" && <Champ T={T} libelle="Chantier (nom)"><input className="inv-inp" style={{ textAlign: "left" }} disabled={dis} value={f.chantier} onChange={maj("chantier")} /></Champ>}
          </div>
          {m.suiviDisponible && <div style={{ marginTop: 8 }}><Champ T={T} libelle="Notes"><textarea className="inv-textarea" rows={2} disabled={dis} value={f.notes} onChange={maj("notes")} /></Champ></div>}
          {t.mode === "profero" && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 8 }}>Statut, avancement et budget du chantier : la consultation depuis Profero Rénovation reste à connecter. Invest ne recrée pas la gestion de chantier.</div>}
          {(a?.travaux_debut_le || a?.travaux_fin_le || a?.budget_travaux != null) && (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: T.textSub }}>
              <Donnee T={T} libelle="Budget" valeur={t.budget} type="eur" /><Donnee T={T} libelle="Démarrage" valeur={dateFr(t.debut)} /><Donnee T={T} libelle="Fin" valeur={dateFr(t.fin)} />
            </div>
          )}
          {erreur && <div style={{ fontSize: 12, color: "#be123c", marginTop: 6 }}>{erreur}</div>}
          {modifiable && (a || m.suiviDisponible) && <div style={{ marginTop: 8 }}><button className="inv-btn inv-btn-blue inv-btn-sm" disabled={occupe} onClick={enregistrer}>Enregistrer</button></div>}
        </Bloc>
      )}
      {t.mode === "aucun" && erreur && <div style={{ fontSize: 12, color: "#be123c" }}>{erreur}</div>}
      <div style={{ fontSize: 12, color: T.textMuted }}>Les travaux se terminent avant la <button className="inv-btn inv-btn-sm" onClick={() => naviguer("transmission")}>Transmission</button> du dossier.</div>
    </>
  );
}
