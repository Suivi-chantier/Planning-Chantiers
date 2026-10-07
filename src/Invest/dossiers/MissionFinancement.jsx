// src/Invest/dossiers/MissionFinancement.jsx — onglet « Financement » : pipeline, plan, banques consultées.
// Un résumé compact en tête (statut, plan, banques) ; la saisie détaillée reste celle de FinancementMission
// (dossier bancaire, plan de financement du scénario retenu, banques, conditions, garanties, assurance, notes) :
// aucune donnée n'est dupliquée, tout vient de invest_dossier_financements / invest_dossier_banques.
import React, { useState } from "react";
import FinancementMission from "./FinancementMission";
import { syntheseCredits, STATUTS_BANQUE } from "./calculFinancement";
import { nombreOuNull, libelleStatutBanque } from "./offre2Vue";
import { Bloc, Pastille, EtatVide, Donnee, Pipeline, COULEURS, eur, dateFr } from "./MissionUi";

export default function MissionFinancement({ T, fiche, client, profil, m, extra, modifiable, onClientOnglet, setOnglet }) {
  const [ouvert, setOuvert] = useState(false);
  const f = m.finance, banques = extra.banques;
  const mensualiteMax = m.analyse.capacite.calculable ? m.analyse.capacite.mensualiteMax : null;
  const synth = syntheseCredits(banques.map((b) => ({ ...b, retenue: !!b.retenue })), mensualiteMax);
  const retenue = banques.filter((b) => b.retenue);
  const acq = m.acquisition, bien = m.synthR.retenu?.bien;
  const prix = nombreOuNull(acq?.prix_signe) ?? m.offre?.prixPropose ?? bien?.prix ?? null;
  const travaux = nombreOuNull(acq?.budget_travaux) ?? bien?.travaux ?? null;
  const frais = nombreOuNull(acq?.suivi?.frais);
  const apport = m.criteres.objectifs.find((o) => o.cle === "apport")?.valeur ?? null;
  const duree = retenue.length === 1 ? nombreOuNull(retenue[0].duree_ans) : null;
  const taux = synth.tauxMoyenPct ?? null;
  const plan = [
    { cle: "prix", libelle: "Prix", valeur: prix, type: "eur" }, { cle: "travaux", libelle: "Travaux", valeur: travaux, type: "eur" }, { cle: "frais", libelle: "Frais", valeur: frais, type: "eur" },
    { cle: "apport", libelle: "Apport", valeur: apport, type: "eur" }, { cle: "finance", libelle: "Montant financé", valeur: synth.nombre ? synth.montantTotal : null, type: "eur", fort: true },
    { cle: "duree", libelle: "Durée", valeur: duree === null ? null : `${duree} ans` }, { cle: "taux", libelle: "Taux", valeur: taux, type: "pct" },
    { cle: "mensualite", libelle: "Mensualité", valeur: synth.nombre && synth.mensualite !== null ? `${eur(synth.mensualite)} / mois` : null },
  ];
  return (
    <>
      <Bloc T={T} titre="Statut du financement" action={f.acceptee && <Pastille couleur={COULEURS.termine}>✓ Prêt accepté</Pastille>}>
        <Pipeline T={T} etapes={f.etapes} />
        <div style={{ marginTop: 8, fontSize: 13, color: T.text }}>
          {f.demarre ? <>Statut : <b>{f.libelle}</b>{f.nbBanques ? ` · ${f.nbBanques} banque${f.nbBanques > 1 ? "s" : ""} consultée${f.nbBanques > 1 ? "s" : ""}` : ""}</> : <span style={{ color: T.textMuted }}>Dossier de financement non démarré.</span>}
          {f.refus && <span style={{ color: COULEURS.bloque, fontWeight: 800 }}> · Toutes les banques ont refusé ou abandonné.</span>}
        </div>
      </Bloc>

      <Bloc T={T} titre="Plan de financement" action={<button className="inv-btn inv-btn-sm" onClick={() => setOuvert(true)}>Détail du plan</button>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: "8px 14px" }}>{plan.map((p) => <Donnee key={p.cle} T={T} {...p} />)}</div>
        {!m.synthR.retenu && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 6 }}>Aucun bien retenu : prix et travaux se renseignent dès qu'un bien est retenu.</div>}
      </Bloc>

      <Bloc T={T} titre={`Banques consultées · ${banques.length}`} action={modifiable && <button className="inv-btn inv-btn-sm" onClick={() => setOuvert(true)}>＋ Ajouter une banque</button>}>
        {banques.length === 0 ? <EtatVide T={T} titre="Aucune banque consultée" texte="Ajoutez les banques sollicitées et suivez leurs réponses." action={modifiable && <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={() => setOuvert(true)}>Ajouter une banque</button>} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 8 }}>
            {banques.map((b) => (
              <div key={b.id} style={{ border: `${b.retenue ? 2 : 1}px solid ${b.retenue ? COULEURS.termine : T.border}`, borderRadius: 9, padding: "7px 10px", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><b style={{ fontSize: 13, color: T.text }}>{b.banque || "Banque sans nom"}</b>{b.retenue && <Pastille couleur={COULEURS.termine}>Retenue</Pastille>}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: ["refus", "abandon"].includes(b.statut) ? COULEURS.bloque : T.textSub }}>{libelleStatutBanque(b.statut)}</div>
                <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 1 }}>
                  {[b.montant_accorde != null ? eur(b.montant_accorde) : b.montant_demande != null ? `${eur(b.montant_demande)} demandés` : null, b.taux_pct != null ? `${String(b.taux_pct).replace(".", ",")} %` : null,
                    b.demande_le ? `envoyé le ${dateFr(b.demande_le)}` : null].filter(Boolean).join(" · ") || "Aucun chiffre saisi"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Bloc>

      <details open={ouvert} onToggle={(e) => setOuvert(e.currentTarget.open)}>
        <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 800, color: T.textSub }}>Saisie détaillée : dossier bancaire, plan, banques, conditions, garanties, assurance, notes</summary>
        <div style={{ marginTop: 8 }}>
          <FinancementMission T={T} fiche={fiche} client={client} dossier={fiche.dossier} profil={profil} modifiable={modifiable}
            onOnglet={(o) => (o === "documents" ? onClientOnglet?.("documents") : setOnglet("projet"))} />
        </div>
      </details>
    </>
  );
}
