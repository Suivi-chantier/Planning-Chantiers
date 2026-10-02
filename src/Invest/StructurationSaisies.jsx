// src/Invest/StructurationSaisies.jsx — Saisies structurées du dossier de structuration :
// objectifs mesurables, enfants, profil investisseur immobilier, fiche de chaque bien, charges du foyer, dettes.
// Chaque donnée est saisie ici UNE fois ; les calculs viennent de structurationDonnees.mjs.
import React, { useState } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { SU, WA, DA } from "./_shared";
import {
  analyserBien, analyserFlux, analyserDettes, analyserObjectifs, analyserProfilImmo,
  TYPES_OBJECTIF, FLEXIBILITES, DIMENSIONS_PROFIL_IMMO, CATEGORIES_CHARGES, num,
} from "./structurationDonnees.mjs";

const eur = (v) => (v === null || v === undefined ? "non calculable" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)} €`);
const pct = (v) => (v === null || v === undefined ? "non calculable" : `${(v * 100).toFixed(1).replace(".", ",")} %`);
const nouvelId = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

function Carte({ T, titre, aide, action, children }) {
  return (
    <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>{titre}</h3>{action}
      </div>
      {aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginBottom: SPACING.sm, maxWidth: 820 }}>{aide}</div>}
      {children}
    </section>
  );
}
const Champ = ({ T, label, children }) => (
  <label style={{ display: "block", minWidth: 0 }}>
    <span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{label}</span>
    {children}
  </label>
);
const Saisie = ({ T, label, value, onChange, type = "text", placeholder }) => (
  <Champ T={T} label={label}><input className="inv-inp" type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", textAlign: type === "text" ? "left" : "right" }} /></Champ>
);
const Liste = ({ T, label, value, onChange, options }) => (
  <Champ T={T} label={label}>
    <select className="inv-sel" value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}>
      <option value="">—</option>{options.map((o) => <option key={o}>{o}</option>)}
    </select>
  </Champ>
);
const Puce = ({ T, label, valeur, ton }) => (
  <div style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 10px", background: T.input, minWidth: 0 }}>
    <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 700 }}>{label}</div>
    <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 900, color: ton || T.text }}>{valeur}</div>
  </div>
);
const GRILLE = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 };

/* ── Profil : objectifs mesurables, enfants, profil investisseur ─────────────────────────────── */
export function ObjectifsMesures({ T, objectifs, onChange }) {
  const liste = Array.isArray(objectifs) ? objectifs : [];
  const a = analyserObjectifs(liste);
  const maj = (i, p) => onChange(liste.map((o, j) => (j === i ? { ...o, ...p } : o)));
  return (
    <Carte T={T} titre={`Objectifs chiffrés · ${a.exploitables}/${a.total} exploitables`}
      aide="Chaque objectif : un montant, une échéance, une priorité et une souplesse. « Générer 2 500 € par mois de revenus immobiliers nets avant 40 ans » est exploitable ; « créer du patrimoine » ne l'est pas."
      action={<button className="inv-btn inv-btn-sm" onClick={() => onChange([...liste, { id: nouvelId(), type: "Revenus complémentaires", libelle: "", montant: "", echeance: "", priorite: "", flexibilite: "Souple" }])}><Icon as={Plus} size={12} />Ajouter</button>}>
      {liste.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun objectif chiffré.</div>}
      {liste.map((o, i) => {
        const complet = num(o.montant) !== null && String(o.echeance || "").trim() && String(o.priorite || "").trim();
        return (
          <div key={o.id || i} style={{ ...GRILLE, gridTemplateColumns: "180px minmax(0,1.5fr) 120px 100px 90px 130px auto", alignItems: "end", padding: "8px 0", borderTop: i ? `1px solid ${T.rowBorder || T.border}` : "none" }}>
            <Liste T={T} label="Objectif" value={o.type} onChange={(v) => maj(i, { type: v })} options={TYPES_OBJECTIF} />
            <Saisie T={T} label="En clair" value={o.libelle} onChange={(v) => maj(i, { libelle: v })} placeholder="Ex. 2 500 €/mois de revenus nets" />
            <Saisie T={T} label="Montant (€)" type="number" value={o.montant} onChange={(v) => maj(i, { montant: v })} />
            <Saisie T={T} label="Échéance (année)" type="number" value={o.echeance} onChange={(v) => maj(i, { echeance: v })} placeholder="2036" />
            <Liste T={T} label="Priorité" value={o.priorite} onChange={(v) => maj(i, { priorite: v })} options={["1", "2", "3"]} />
            <Liste T={T} label="Souplesse" value={o.flexibilite} onChange={(v) => maj(i, { flexibilite: v })} options={FLEXIBILITES} />
            <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => onChange(liste.filter((_, j) => j !== i))} aria-label="Retirer" title={complet ? "" : "Objectif incomplet"}><Icon as={Trash2} size={11} /></button>
          </div>
        );
      })}
    </Carte>
  );
}

export function EnfantsFoyer({ T, enfants, onChange }) {
  const liste = Array.isArray(enfants) ? enfants : [];
  const maj = (i, p) => onChange(liste.map((e, j) => (j === i ? { ...e, ...p } : e)));
  return (
    <Carte T={T} titre={`Enfants · ${liste.length}`} aide="Un enfant par ligne : il alimente le foyer fiscal, les objectifs (études) et la transmission."
      action={<button className="inv-btn inv-btn-sm" onClick={() => onChange([...liste, { id: nouvelId(), prenom: "", naissance: "", union: "Commun", a_charge: "Oui", besoins: "" }])}><Icon as={Plus} size={12} />Ajouter</button>}>
      {liste.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun enfant renseigné.</div>}
      {liste.map((e, i) => (
        <div key={e.id || i} style={{ ...GRILLE, gridTemplateColumns: "minmax(0,1fr) 150px 160px 100px minmax(0,1.2fr) auto", alignItems: "end", padding: "6px 0" }}>
          <Saisie T={T} label="Prénom" value={e.prenom} onChange={(v) => maj(i, { prenom: v })} />
          <Saisie T={T} label="Naissance" type="date" value={e.naissance} onChange={(v) => maj(i, { naissance: v })} />
          <Liste T={T} label="Union" value={e.union} onChange={(v) => maj(i, { union: v })} options={["Commun", "Union précédente"]} />
          <Liste T={T} label="À charge" value={e.a_charge} onChange={(v) => maj(i, { a_charge: v })} options={["Oui", "Non"]} />
          <Saisie T={T} label="Études, besoins particuliers" value={e.besoins} onChange={(v) => maj(i, { besoins: v })} />
          <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => onChange(liste.filter((_, j) => j !== i))} aria-label="Retirer"><Icon as={Trash2} size={11} /></button>
        </div>
      ))}
    </Carte>
  );
}

export function ProfilInvestisseurImmo({ T, profilImmo, onChange }) {
  const p = profilImmo || {};
  const a = analyserProfilImmo(p);
  return (
    <Carte T={T} titre={`Profil investisseur immobilier · ${a.renseignees}/${a.total}`}
      aide="Pas seulement une tolérance au risque financier : ce que le client accepte de vivre en tant que propriétaire bailleur. Il oriente le type de bien et la stratégie.">
      <div style={GRILLE}>
        {DIMENSIONS_PROFIL_IMMO.map(([cle, label, options]) => options
          ? <Liste key={cle} T={T} label={label} value={p[cle]} onChange={(v) => onChange({ ...p, [cle]: v })} options={options} />
          : <Saisie key={cle} T={T} label={label} type="number" value={p[cle]} onChange={(v) => onChange({ ...p, [cle]: v })} />)}
      </div>
    </Carte>
  );
}

/* ── Bilan : fiche de chaque bien, charges, dettes ───────────────────────────────────────────── */
export function FichesBiens({ T, lots, onUpdateLot }) {
  const [ouvert, setOuvert] = useState(null);
  const liste = Array.isArray(lots) ? lots : [];
  return (
    <Carte T={T} titre="Fiche économique de chaque bien"
      aide="Complétez ce qui manque pour voir chaque bien tel qu'il est : rendement, cash-flow, effort d'épargne, valeur nette. Tous les chiffres sont AVANT IMPÔT : la fiscalité viendra avec la comparaison des structures. Un chiffre « non calculable » dit ce qui manque, il ne vaut pas zéro.">
      {liste.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucun bien dans l'inventaire ci-dessus.</div>}
      {liste.map((lot, i) => {
        const b = analyserBien(lot);
        const ouvertIci = ouvert === i;
        const cf = b.cashflowMois;
        return (
          <div key={lot.id || i} style={{ borderTop: i ? `1px solid ${T.rowBorder || T.border}` : "none", padding: "8px 0" }}>
            <button type="button" onClick={() => setOuvert(ouvertIci ? null : i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: 0, cursor: "pointer", color: T.text, fontFamily: "inherit", textAlign: "left" }}>
              <Icon as={ouvertIci ? ChevronDown : ChevronRight} size={14} />
              <span style={{ fontWeight: 900 }}>{lot.adresse || `Bien ${i + 1}`}</span>
              <span style={{ color: T.textMuted, fontSize: FONT.sm.size }}>{lot.type}{lot.structure ? ` · ${lot.structure}` : ""}</span>
              <span style={{ marginLeft: "auto", fontWeight: 800, color: cf === null ? T.textMuted : cf >= 0 ? SU : DA }}>{cf === null ? "cash-flow non calculable" : `${eur(cf)} / mois`}</span>
            </button>
            <div style={{ ...GRILLE, marginTop: 8 }}>
              <Puce T={T} label="Rendement brut" valeur={pct(b.rendementBrut)} />
              <Puce T={T} label="Rendement net" valeur={pct(b.rendementNet)} />
              <Puce T={T} label="Rentabilité des fonds propres" valeur={pct(b.rentabiliteFondsPropres)} />
              <Puce T={T} label="Valeur nette du bien" valeur={eur(b.valeurNette)} />
              <Puce T={T} label="Plus-value latente" valeur={eur(b.plusValueLatente)} />
              <Puce T={T} label="Effort d'épargne / mois" valeur={eur(b.effortEpargneMois)} ton={b.effortEpargneMois > 0 ? WA : undefined} />
            </div>
            {b.manquants.length > 0 && <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: WA }}>À renseigner : {b.manquants.join(", ")}.</div>}
            {ouvertIci && (
              <div style={{ ...GRILLE, marginTop: 10 }}>
                <Saisie T={T} label="Prix d'acquisition (€)" type="number" value={lot.valeur_acquisition} onChange={(v) => onUpdateLot(i, "valeur_acquisition", v)} />
                <Saisie T={T} label="Année d'acquisition" type="number" value={lot.annee_acquisition} onChange={(v) => onUpdateLot(i, "annee_acquisition", v)} />
                <Saisie T={T} label="Apport initial (€)" type="number" value={lot.apport_initial} onChange={(v) => onUpdateLot(i, "apport_initial", v)} />
                <Liste T={T} label="Propriété" value={lot.propriete} onChange={(v) => onUpdateLot(i, "propriete", v)} options={["Pleine propriété", "Nue-propriété", "Usufruit", "Indivision"]} />
                <Saisie T={T} label="Quote-part (%)" type="number" value={lot.quote_part} onChange={(v) => onUpdateLot(i, "quote_part", v)} />
                <Liste T={T} label="Exploitation" value={lot.exploitation} onChange={(v) => onUpdateLot(i, "exploitation", v)} options={["Location nue", "LMNP", "LMP", "Courte durée", "Colocation", "Bail commercial", "Vacant"]} />
                <Saisie T={T} label="Taux du prêt (%)" type="number" value={lot.taux_pret} onChange={(v) => onUpdateLot(i, "taux_pret", v)} />
                <Saisie T={T} label="Durée restante (mois)" type="number" value={lot.duree_restante} onChange={(v) => onUpdateLot(i, "duree_restante", v)} />
                <Saisie T={T} label="Taxe foncière (€/an)" type="number" value={lot.taxe_fonciere} onChange={(v) => onUpdateLot(i, "taxe_fonciere", v)} />
                <Saisie T={T} label="Assurance PNO (€/an)" type="number" value={lot.assurance_pno} onChange={(v) => onUpdateLot(i, "assurance_pno", v)} />
                <Saisie T={T} label="Entretien (€/an)" type="number" value={lot.entretien_annuel} onChange={(v) => onUpdateLot(i, "entretien_annuel", v)} />
                <Saisie T={T} label="Gestion locative (% des loyers)" type="number" value={lot.gestion_pct} onChange={(v) => onUpdateLot(i, "gestion_pct", v)} />
                <Saisie T={T} label="Vacance (%)" type="number" value={lot.vacance_pct} onChange={(v) => onUpdateLot(i, "vacance_pct", v)} />
              </div>
            )}
          </div>
        );
      })}
    </Carte>
  );
}

export function ChargesFoyer({ T, collecte, onChange }) {
  const charges = collecte?.charges || {};
  const f = analyserFlux(collecte || {});
  const set = (k, v) => onChange({ ...charges, [k]: v });
  return (
    <Carte T={T} titre="Charges et train de vie"
      aide="Ne détaillez pas 50 lignes : les grandes catégories suffisent. On compare ensuite ce que le foyer devrait pouvoir épargner à ce qu'il épargne réellement. L'écart est souvent la donnée la plus parlante.">
      <div style={GRILLE}>
        {CATEGORIES_CHARGES.map(([k, label]) => <Saisie key={k} T={T} label={`${label} (€/mois)`} type="number" value={charges[k]} onChange={(v) => set(k, v)} />)}
        <Saisie T={T} label="Épargne réellement constatée (€/mois)" type="number" value={charges.epargne_reelle_mois} onChange={(v) => set("epargne_reelle_mois", v)} />
      </div>
      <div style={{ ...GRILLE, marginTop: 12 }}>
        <Puce T={T} label="Revenus récurrents / mois" valeur={eur(f.revenusRecurrentsMois)} />
        <Puce T={T} label="Charges du foyer / mois" valeur={eur(f.chargesFoyerMois)} />
        <Puce T={T} label="Résultat des biens après mensualités / mois" valeur={eur(f.cashflowBiensMois)} ton={f.biensIncomplets ? WA : undefined} />
        <Puce T={T} label="Capacité d'épargne théorique / mois" valeur={eur(f.capaciteEpargneTheorique)} />
        <Puce T={T} label="Écart avec l'épargne réelle" valeur={f.ecart === null ? "non calculable" : `${f.ecart >= 0 ? "+" : ""}${eur(f.ecart)}`} ton={f.ecart !== null && f.ecart < 0 ? DA : undefined} />
      </div>
      {f.biensIncomplets > 0 && <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: WA }}>{f.biensIncomplets} bien(s) sans cash-flow calculable : leur résultat n'est pas compté ci-dessus.</div>}
      <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: T.textMuted }}>Les revenus exceptionnels ({eur(f.revenusExceptionnelsAn)} par an saisis dans le profil) sont exclus de ce calcul.</div>
    </Carte>
  );
}

export function DettesListe({ T, dettes, onChange }) {
  const liste = Array.isArray(dettes) ? dettes : [];
  const t = analyserDettes(liste);
  const maj = (i, p) => onChange(liste.map((d, j) => (j === i ? { ...d, ...p } : d)));
  return (
    <Carte T={T} titre={`Autres dettes · ${eur(t.capitalRestant)} restant dû, ${eur(t.mensualites)} par mois`}
      aide="Les prêts des biens locatifs sont saisis sur chaque bien : ne les ressaisissez pas ici. Ici : résidence principale, consommation, auto, étudiant, professionnel, découvert, dette familiale, caution."
      action={<button className="inv-btn inv-btn-sm" onClick={() => onChange([...liste, { id: nouvelId(), type: "Prêt résidence principale", capital_restant: "", mensualite: "", taux: "", echeance: "", garantie: "" }])}><Icon as={Plus} size={12} />Ajouter</button>}>
      {liste.length === 0 && <div style={{ color: T.textMuted, fontSize: FONT.sm.size }}>Aucune autre dette renseignée.</div>}
      {liste.map((d, i) => (
        <div key={d.id || i} style={{ ...GRILLE, gridTemplateColumns: "190px 130px 120px 90px 130px minmax(0,1fr) auto", alignItems: "end", padding: "6px 0" }}>
          <Liste T={T} label="Type" value={d.type} onChange={(v) => maj(i, { type: v })} options={["Prêt résidence principale", "Prêt étudiant", "Crédit auto", "Crédit consommation", "Prêt professionnel", "Découvert", "Dette familiale", "Caution personnelle", "Autre"]} />
          <Saisie T={T} label="Capital restant (€)" type="number" value={d.capital_restant} onChange={(v) => maj(i, { capital_restant: v })} />
          <Saisie T={T} label="Mensualité (€)" type="number" value={d.mensualite} onChange={(v) => maj(i, { mensualite: v })} />
          <Saisie T={T} label="Taux (%)" type="number" value={d.taux} onChange={(v) => maj(i, { taux: v })} />
          <Saisie T={T} label="Échéance" type="date" value={d.echeance} onChange={(v) => maj(i, { echeance: v })} />
          <Saisie T={T} label="Garantie, actif associé" value={d.garantie} onChange={(v) => maj(i, { garantie: v })} />
          <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => onChange(liste.filter((_, j) => j !== i))} aria-label="Retirer"><Icon as={Trash2} size={11} /></button>
        </div>
      ))}
      {t.incompletes > 0 && <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: WA }}>{t.incompletes} dette(s) sans capital restant ou sans mensualité.</div>}
    </Carte>
  );
}
