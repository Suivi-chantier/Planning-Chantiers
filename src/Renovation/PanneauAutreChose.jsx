// ─────────────────────────────────────────────────────────────────────────────
// Compte rendu (formulaire bêta « cr_v2 ») — panneau « J'ai fait autre chose ».
//
// Ajouter à la journée une tâche NON prévue au planning, choisie directement
// dans le phasage du chantier. Mêmes données (RPC ouvrier_mes_phases), mêmes
// calculs (mesPhasesV1) et mêmes composants (CartePhase de l'onglet Phases)
// que l'onglet Phases : rien n'est recalculé ici.
//
// Chantiers proposés : ceux du jour d'abord, puis « Autre chantier » — même
// règle que l'ajout manuel existant (n'importe quel chantier de la liste).
// Les droits ne changent pas : la RPC sert déjà tout chantier à un testeur.
//
// Lecture seule : « Ajouter » ne crée qu'une carte dans le compte rendu. Si le
// phasage ne peut pas être lu, le panneau le dit et propose le texte libre.
//
// Tâche absente du phasage : « + Nouvelle tâche dans cet ouvrage » (sous
// chaque ouvrage) ou « Tâche introuvable ? » ouvrent l'écran NouvelleTacheV2,
// qui produit une carte « proposée » (créée à la validation). Sans phasage
// lisible, on retombe sur le texte libre, comme avant.
// `edition` : { idx, chantierId, ligne } — rouvre directement l'écran pour
// modifier une nouvelle tâche déjà dans la journée.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { X, Search, Plus, Check, PenLine, WifiOff } from "lucide-react";
import { CartePhase } from "./OuvrierMesPhases";
import NouvelleTacheV2 from "./NouvelleTacheV2";
import { construireMesPhases, filtrerPhases, rechercherDansPhases } from "./mesPhasesV1";
import { tacheDejaDansJournee, ouvragesProposables, saisieDepuisLigne } from "./compteRenduV2";

const SOMBRE = "#1a1f2e";
const PHASAGE_LISIBLE = ["ok", "sans_groupes"];

export default function PanneauAutreChose({
  taches, chantiersDuJour = [], tousChantiers = [], prenom, aujourdhuiISO, T, accent = "#FFC200",
  onAjouter, onDecrireLibre, onFermer,
  champPhotos = null, onAjouterNouvelle = null, edition = null, onModifierNouvelle = null,
}) {
  // Le kit de l'onglet Phases attend un fond de piste (T.card) gris clair.
  const TP = useMemo(() => ({ ...T, card: "#eef1f7" }), [T]);
  const [chantierId, setChantierId] = useState(edition?.chantierId || chantiersDuJour[0]?.id || "");
  // Écran « Nouvelle tâche » ouvert : { saisieInitiale } (null = liste des phases)
  const [nouvelle, setNouvelle] = useState(null);
  const [charges, setCharges] = useState({});     // { chantier_id: { etat, data } }
  const [essai, setEssai] = useState(0);
  const [vue, setVue] = useState(null);           // null = choisie au chargement
  const [recherche, setRecherche] = useState("");
  const [ouvertes, setOuvertes] = useState(null); // Set des phases ouvertes

  const chantier = useMemo(
    () => chantiersDuJour.find(c => c.id === chantierId) || tousChantiers.find(c => c.id === chantierId) || null,
    [chantierId, chantiersDuJour, tousChantiers]);

  // Phasage du chantier choisi (une lecture par chantier, gardée le temps du panneau).
  useEffect(() => {
    if (!chantierId || charges[chantierId]?.etat === "ok") return;
    let annule = false;
    setCharges(c => ({ ...c, [chantierId]: { etat: "chargement" } }));
    (async () => {
      try {
        const { data, error } = await supabase.rpc("ouvrier_mes_phases", {
          p_chantier_id: chantierId, p_prenom: prenom || null, p_aujourdhui: aujourdhuiISO,
        });
        if (annule) return;
        if (error || !data) setCharges(c => ({ ...c, [chantierId]: { etat: "erreur" } }));
        else setCharges(c => ({ ...c, [chantierId]: { etat: "ok", data } }));
      } catch {
        if (!annule) setCharges(c => ({ ...c, [chantierId]: { etat: "erreur" } }));
      }
    })();
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierId, essai]);

  const charge = chantierId ? charges[chantierId] : null;
  const resultat = useMemo(() => (charge?.etat === "ok" ? construireMesPhases(charge.data) : null), [charge]);
  const vueEff = vue || (resultat && resultat.nbMiennes > 0 ? "miennes" : "tout");
  const ouvertesEff = ouvertes || new Set(resultat?.phaseEnCoursId ? [resultat.phaseEnCoursId] : []);
  const phases = resultat ? rechercherDansPhases(filtrerPhases(resultat, vueEff), recherche) : [];
  const enRecherche = recherche.trim().length > 0;
  const basculer = (id) => setOuvertes(() => {
    const n = new Set(ouvertesEff); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const changerChantier = (id) => { setChantierId(id); setVue(null); setOuvertes(null); setRecherche(""); };

  // ── Nouvelle tâche ────────────────────────────────────────────────────────
  const lisible = !!resultat && PHASAGE_LISIBLE.includes(resultat.etat);
  const ouvrages = useMemo(() => (lisible ? ouvragesProposables(resultat.phases) : []), [lisible, resultat]);
  const nouvellePossible = lisible && !!onAjouterNouvelle;
  const ouvrirNouvelle = (ouvrageId) => setNouvelle({
    saisieInitiale: ouvrageId ? { ouvrage: ouvrages.find(o => o.id === ouvrageId) || null } : null,
  });
  // Modification d'une carte existante : l'écran s'ouvre dès le phasage lu.
  useEffect(() => {
    if (edition && lisible && !nouvelle) setNouvelle({ saisieInitiale: saisieDepuisLigne(edition.ligne, ouvrages) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edition, lisible]);

  const actionOuvrage = nouvellePossible ? (o) => (
    <div style={{ padding: "6px 14px 12px", borderTop: `1px dashed ${T.border}` }}>
      <button onClick={() => ouvrirNouvelle(o.id)} style={{
        width: "100%", minHeight: 48, borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
        border: `1.5px dashed ${T.borderHover || T.border}`, background: T.surface, color: T.text, fontSize: 15, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}><Icon as={Plus} size={16} strokeWidth={2.6}/> Nouvelle tâche dans cet ouvrage</button>
    </div>
  ) : null;

  // Bouton sous chaque tâche : « Ajouter », ou « Déjà dans ta journée ».
  const actionTache = (t) => (
    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
      {tacheDejaDansJournee(taches, t.id) ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 800, color: "#15803d", minHeight: 44 }}>
          <Icon as={Check} size={16} strokeWidth={2.6}/> Déjà dans ta journée
        </span>
      ) : (
        <button onClick={() => onAjouter(t, chantier)} style={{
          minHeight: 48, minWidth: 120, padding: "0 18px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
          border: `2px solid ${SOMBRE}`, background: accent, color: SOMBRE, fontSize: 16, fontWeight: 800,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}><Icon as={Plus} size={17} strokeWidth={2.6}/> Ajouter</button>
      )}
    </div>
  );

  // « Tâche introuvable ? » : l'écran Nouvelle tâche (ouvrage à choisir) quand
  // le phasage est lisible ; sinon le texte libre, comme avant.
  const boutonLibre = (gros = false) => (
    <button onClick={() => (!gros && nouvellePossible ? ouvrirNouvelle(null) : onDecrireLibre(chantier))} style={gros ? {
      width: "100%", minHeight: 56, borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
      border: `2px solid ${SOMBRE}`, background: accent, color: SOMBRE, fontSize: 16, fontWeight: 800,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    } : {
      width: "100%", minHeight: 48, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
      color: T.textSub, fontSize: 14.5, fontWeight: 700, textDecoration: "underline",
    }}>
      {gros && <Icon as={PenLine} size={17}/>}
      {gros ? "Décrire la tâche en texte libre" : nouvellePossible ? "Tâche introuvable ? La proposer" : "Tâche introuvable ? La décrire"}
    </button>
  );

  const message = (titre, texte, icon = WifiOff) => (
    <div style={{ padding: "28px 8px", textAlign: "center" }}>
      <div style={{ width: 52, height: 52, borderRadius: 16, background: TP.card, margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", color: T.textMuted }}>
        <Icon as={icon} size={24}/>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.text }}>{titre}</div>
      <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 6, lineHeight: 1.45 }}>{texte}</div>
      {!edition && <div style={{ marginTop: 16 }}>{boutonLibre(true)}</div>}
      {charge?.etat === "erreur" && (
        <button onClick={() => { setCharges(c => { const n = { ...c }; delete n[chantierId]; return n; }); setEssai(n => n + 1); }} style={{
          marginTop: 8, minHeight: 44, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit",
          color: T.textSub, fontSize: 14, fontWeight: 700, textDecoration: "underline",
        }}>Réessayer</button>
      )}
    </div>
  );

  let corps;
  if (!chantierId) {
    corps = <div style={{ padding: "24px 4px", fontSize: 14.5, color: T.textSub, textAlign: "center" }}>Choisis d'abord le chantier.</div>;
  } else if (!charge || charge.etat === "chargement") {
    corps = <div style={{ padding: "40px 0", textAlign: "center", color: T.textMuted, fontSize: 13, letterSpacing: 2 }}>CHARGEMENT…</div>;
  } else if (charge.etat === "erreur") {
    corps = message("Phasage indisponible", "Pas de connexion, ou le serveur ne répond pas. Tu peux décrire la tâche en texte libre : ton compte rendu partira quand même.");
  } else if (resultat.etat === "acces_refuse") {
    corps = message("Phasage indisponible", "Le phasage n'est pas accessible avec ton compte. Décris la tâche en texte libre.");
  } else if (resultat.etat === "absent" || resultat.etat === "vide") {
    corps = message("Pas de phasage", "Ce chantier n'a pas encore de phasage. Décris la tâche en texte libre.", PenLine);
  } else if (resultat.etat === "ambigu" || resultat.etat === "legacy_v1") {
    corps = message("Phasage à reprendre", "Le phasage de ce chantier doit être repris par le bureau. Décris la tâche en texte libre.", PenLine);
  } else {
    corps = (
      <>
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 14, background: "#e4e8f2", marginBottom: 10 }}>
          {[["miennes", `Mes phases (${resultat.nbMiennes})`], ["tout", `Tout le chantier (${resultat.nbTout})`]].map(([id, label]) => (
            <button key={id} onClick={() => setVue(id)} aria-pressed={vueEff === id} style={{
              flex: 1, minHeight: 44, borderRadius: 11, border: "none", cursor: "pointer", fontFamily: "inherit",
              fontSize: 15, fontWeight: 800, background: vueEff === id ? T.surface : "transparent",
              color: vueEff === id ? T.text : T.textSub,
            }}>{label}</button>
          ))}
        </div>
        {phases.length === 0 ? (
          <div style={{ padding: "20px 4px", fontSize: 14, color: T.textSub, textAlign: "center" }}>
            {enRecherche ? "Aucune tâche ne correspond à ta recherche." : vueEff === "miennes" ? "Aucune phase pour toi ici : regarde « Tout le chantier »." : "Aucune phase."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {phases.map(p => (
              <CartePhase key={p.id} p={p} prenom={resultat.prenom || prenom} T={TP} accent={accent}
                ouverte={enRecherche || ouvertesEff.has(p.id)} enAvant={p.id === resultat.phaseEnCoursId}
                onToggle={() => basculer(p.id)} actionTache={actionTache} actionOuvrage={actionOuvrage}/>
            ))}
          </div>
        )}
      </>
    );
  }

  const autres = tousChantiers.filter(c => !chantiersDuJour.some(d => d.id === c.id) && c.statut !== "termine");

  return (
    <div onClick={onFermer} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,24,40,0.45)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label="Ajouter à ma journée" style={{
        width: "100%", maxHeight: "90vh", background: T.bg, borderRadius: "20px 20px 0 0",
        display: "flex", flexDirection: "column", boxShadow: "0 -10px 30px rgba(16,24,40,0.25)",
        fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
      }}>
        {nouvelle ? (
          <NouvelleTacheV2 key={chantierId} ouvrages={ouvrages} saisieInitiale={nouvelle.saisieInitiale}
            chantierNom={chantier?.nom || ""} enEdition={!!edition} T={T} accent={accent} champPhotos={champPhotos}
            onValider={(saisie) => (edition ? onModifierNouvelle?.(edition.idx, saisie) : onAjouterNouvelle(saisie, chantier))}
            onLibre={() => onDecrireLibre(chantier)}
            onRetour={edition ? onFermer : () => setNouvelle(null)}
            onFermer={onFermer}/>
        ) : (<>
        {/* En-tête : titre, fermer, chantier, recherche */}
        <div style={{ padding: "10px 14px 12px", borderBottom: `1px solid ${T.border}`, background: T.surface, borderRadius: "20px 20px 0 0" }}>
          <div style={{ width: 44, height: 5, borderRadius: 3, background: "#cbd2de", margin: "0 auto 10px" }}/>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Ajouter à ma journée</div>
            <button onClick={onFermer} aria-label="Fermer" style={{
              width: 48, height: 48, borderRadius: 14, border: `1px solid ${T.border}`, background: T.bg, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", color: T.text,
            }}><Icon as={X} size={22}/></button>
          </div>
          {!edition && (chantiersDuJour.length !== 1 || autres.length > 0) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
              {chantiersDuJour.map(c => {
                const sel = c.id === chantierId;
                return (
                  <button key={c.id} onClick={() => changerChantier(c.id)} aria-pressed={sel} style={{
                    minHeight: 44, padding: "0 12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                    fontSize: 14.5, fontWeight: 800, border: `2px solid ${sel ? SOMBRE : T.border}`,
                    background: sel ? SOMBRE : T.surface, color: sel ? "#fff" : T.text,
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.couleur || "#94a3b8" }}/>{c.nom}
                  </button>
                );
              })}
              {autres.length > 0 && (
                <select value={chantiersDuJour.some(c => c.id === chantierId) ? "" : chantierId}
                  onChange={e => e.target.value && changerChantier(e.target.value)} aria-label="Autre chantier" style={{
                    minHeight: 44, padding: "0 10px", borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.surface,
                    fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, color: T.text, maxWidth: "100%",
                  }}>
                  <option value="">Autre chantier…</option>
                  {autres.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              )}
            </div>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, padding: "0 12px", minHeight: 48, borderRadius: 12, border: `1.5px solid ${T.border}`, background: T.bg }}>
            <Icon as={Search} size={17} style={{ color: T.textMuted }}/>
            <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Chercher une tâche ou un ouvrage"
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 16, fontFamily: "inherit", color: T.text, minWidth: 0 }}/>
            {recherche && (
              <button onClick={() => setRecherche("")} aria-label="Effacer" style={{ border: "none", background: "transparent", cursor: "pointer", color: T.textMuted, padding: 6 }}>
                <Icon as={X} size={16}/>
              </button>
            )}
          </label>
        </div>

        <div style={{ overflowY: "auto", padding: "12px 12px 4px", flex: 1 }}>{corps}</div>

        <div style={{ padding: "4px 14px calc(8px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, background: T.surface }}>
          {!edition && boutonLibre(false)}
        </div>
        </>)}
      </div>
    </div>
  );
}
