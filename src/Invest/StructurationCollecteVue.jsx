// src/Invest/StructurationCollecteVue.jsx — Navigation du dossier, collecte essentielle guidée et porte du diagnostic.
// Les règles viennent de structurationCollecte.mjs et structurationParcours.mjs ; ici on affiche et on saisit,
// dans les mêmes emplacements du dossier que la saisie détaillée (rien n'est dupliqué, rien n'est perdu).
import React, { useState } from "react";
import { FONT, RADIUS, SPACING } from "../constants";
import { Icon } from "../ui";
import { Plus, Trash2, ChevronLeft, ChevronRight, ArrowRight, Check } from "lucide-react";
import { SU, WA } from "./_shared";
import { calculerParcours } from "./structurationParcours.mjs";
import { avancementCollecte, documentsPertinents, estPertinent, ETAPES_COLLECTE, MODULES, modulesActifs } from "./structurationCollecte.mjs";
import { ObjectifsMesures, EnfantsFoyer, ProfilInvestisseurImmo, FichesBiens, ChargesFoyer, DettesListe } from "./StructurationSaisies";

const OUVERT = "#64748b";

/* ── Navigation : cinq sections, un seul indicateur d'avancement chacune ──────────────────────── */
export function NavigationDossier({ data, T, tab, onOnglet }) {
  const parcours = calculerParcours(data);
  const col = avancementCollecte(data);
  const pertinents = documentsPertinents(data);
  const docs = (Array.isArray(data?.collecte?.documents) ? data.collecte.documents : []).filter((d) => d.required && estPertinent(pertinents, d) && d.statut !== "Non applicable");
  const docsRecus = docs.filter((d) => d.statut === "Reçu" || d.statut === "Validé").length;
  const et = (cle) => parcours.etapes.find((e) => e.cle === cle);
  const somme = (...cles) => cles.map(et).reduce((a, e) => ({ faits: a.faits + e.faits, total: a.total + e.total, points: [...a.points, ...e.points] }), { faits: 0, total: 0, points: [] });
  const diag = somme("diagnostic", "strategies");
  const plan = somme("preconisation", "mise_en_oeuvre", "suivi");
  const sections = [
    { id: "cadrage", libelle: "Cadrage", faits: et("cadrage").faits, total: et("cadrage").total, suivant: et("cadrage").points.find((p) => !p.ok)?.libelle },
    { id: "collecte", libelle: "Collecte", faits: col.faites, total: col.total, suivant: col.manquantes[0]?.libelle },
    { id: "documents", libelle: "Pièces", faits: docsRecus, total: docs.length, suivant: docs.length > docsRecus ? `${docs.length - docsRecus} pièce(s) à recevoir` : null },
    { id: "analyse", libelle: "Diagnostic et stratégie", faits: diag.faits, total: diag.total, suivant: diag.points.find((p) => !p.ok)?.libelle },
    { id: "mise_en_oeuvre", libelle: "Plan d'action et rapports", faits: plan.faits, total: plan.total, suivant: plan.points.find((p) => !p.ok)?.libelle },
  ];
  const actif = ["audit", "profil", "patrimoine"].includes(tab) ? "collecte" : tab;
  const prochaine = sections.find((s) => s.total > 0 && s.faits < s.total);
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: "10px 12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8 }} role="tablist">
        {sections.map((s, i) => {
          const fait = s.total > 0 && s.faits === s.total;
          const couleur = fait ? SU : s.faits > 0 ? WA : OUVERT;
          const on = actif === s.id;
          return (
            <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => onOnglet(s.id)}
              style={{ textAlign: "left", cursor: "pointer", fontFamily: "inherit", padding: "9px 12px", borderRadius: RADIUS.md, border: `1px solid ${on ? couleur : T.border}`, borderTop: `3px solid ${couleur}`, background: on ? `${couleur}14` : "transparent" }}>
              <div style={{ fontSize: FONT.xs.size + 1, color: couleur, fontWeight: 900, display: "flex", gap: 6, alignItems: "center" }}>
                {fait ? <Icon as={Check} size={12} /> : <span>{i + 1}</span>}<span style={{ color: T.textMuted, fontWeight: 700 }}>{s.total ? `${s.faits}/${s.total}` : "—"}</span>
              </div>
              <div style={{ fontSize: FONT.sm.size + 1, fontWeight: 800, color: T.text }}>{s.libelle}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 8, fontSize: FONT.sm.size, color: T.textSub, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {prochaine ? (
          <>
            <span><b style={{ color: T.text }}>Prochaine étape :</b> {prochaine.libelle}{prochaine.suivant ? ` — ${prochaine.suivant}` : ""}</span>
            {actif !== prochaine.id && <button className="inv-btn inv-btn-sm" onClick={() => onOnglet(prochaine.id)}>Y aller <Icon as={ArrowRight} size={11} /></button>}
          </>
        ) : <b style={{ color: SU }}>Dossier à jour : pensez à la prochaine revue.</b>}
      </div>
    </div>
  );
}

/* ── Porte du diagnostic : plus de zéros trompeurs sur un dossier vide ───────────────────────────── */
export function PorteDiagnostic({ data, T, onOnglet, enfant }) {
  const col = avancementCollecte(data);
  if (col.diagnosticPossible) {
    return (
      <>
        {!col.pretPourDiagnostic && (
          <div style={{ padding: "8px 12px", borderLeft: `3px solid ${WA}`, background: T.input, borderRadius: RADIUS.md, fontSize: FONT.sm.size, color: T.textSub }}>
            <b>Diagnostic provisoire</b> : {col.manquantes.length} question(s) de la collecte restent sans réponse ({col.manquantes.map((q) => q.libelle.toLowerCase()).join(", ")}).
            <button className="inv-btn inv-btn-sm" style={{ marginLeft: 8 }} onClick={() => onOnglet("collecte")}>Compléter</button>
          </div>
        )}
        {enfant}
      </>
    );
  }
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.lg }}>
      <h3 style={{ margin: 0, fontSize: FONT.lg.size, fontWeight: 900, color: T.text }}>Le diagnostic se calcule dès que l'essentiel est saisi</h3>
      <p style={{ color: T.textSub, margin: "6px 0 10px", maxWidth: 760 }}>Tant qu'il manque des données, le diagnostic afficherait des zéros qui ressemblent à des résultats. Il reste {col.manquantesDiagnostic.length} réponse(s) à donner :</p>
      <ul style={{ margin: "0 0 12px", paddingLeft: 18, color: T.text }}>{col.manquantesDiagnostic.map((q) => <li key={q.cle}>{q.libelle}</li>)}</ul>
      <button className="inv-btn inv-btn-blue" onClick={() => onOnglet("collecte")}>Aller à la collecte <Icon as={ArrowRight} size={12} /></button>
    </div>
  );
}

/* ── Collecte essentielle guidée ─────────────────────────────────────────────────────────────── */
const Champ = ({ T, label, children, large }) => (
  <label style={{ display: "block", minWidth: 0, gridColumn: large ? "1 / -1" : undefined }}>
    <span style={{ display: "block", fontSize: FONT.xs.size, color: T.textMuted, fontWeight: 800, marginBottom: 3 }}>{label}</span>{children}
  </label>
);
const Texte = ({ T, label, value, onChange, type = "text", large, placeholder }) => (
  <Champ T={T} label={label} large={large}><input className="inv-inp" type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ width: "100%", textAlign: type === "text" ? "left" : "right" }} /></Champ>
);
const Choix = ({ T, label, value, onChange, options }) => (
  <Champ T={T} label={label}><select className="inv-sel" value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }}><option value="">—</option>{options.map((o) => <option key={o}>{o}</option>)}</select></Champ>
);
const Case = ({ T, checked, onChange, children }) => (
  <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: FONT.sm.size, color: T.text, cursor: "pointer" }}>
    <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{children}
  </label>
);
const GRILLE = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 };
const Carte = ({ T, titre, aide, children }) => (
  <section style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: SPACING.md }}>
    {titre && <h3 style={{ margin: 0, fontSize: FONT.base.size + 1, fontWeight: 900, color: T.text }}>{titre}</h3>}
    {aide && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, margin: "3px 0 10px", maxWidth: 820 }}>{aide}</div>}{children}
  </section>
);

const CHAMPS_MODULES = {
  dirigeant: { section: "dirigeant", champs: [["societes", "Sociétés détenues"], ["part_capital", "Part du capital (%)"], ["remuneration_an", "Rémunération (€/an)"], ["comptes_courants", "Comptes courants d'associé (€)"], ["cautions", "Cautions personnelles"]] },
  expatrie: { section: "statut_fiscal", champs: [["resident_fiscal_depuis", "Résident fiscal français depuis"], ["date_installation_france", "Installation ou retour en France"], ["date_depart_prevue", "Départ prévu"], ["statut_pays_precedents", "Statut dans les pays précédents"]] },
  structure_existante: { section: "structures", champs: [["sci_existante", "Structure existante (nom)"], ["sci_regime", "Régime fiscal"], ["sci_associes", "Associés"], ["sci_biens", "Biens détenus"], ["sci_resultat", "Résultat annuel (€)"]] },
  meuble: { section: "profil", champs: [["regime_locatif", "Régime actuel (micro-BIC, réel, LMP…)"]] },
  recompose: { section: "situation_familiale_detail", champs: [["testament_donation", "Donation entre époux, testament"], ["assurance_vie_clause_beneficiaire", "Clause bénéficiaire d'assurance-vie"]] },
  ifi: { section: "profil", champs: [["ifi", "Situation IFI"]] },
};

export function CollecteEssentielle({ data, T, updateSection, updateLot, addLot, removeLot, onBloc, onOnglet }) {
  const [etape, setEtape] = useState("foyer");
  const [detailsBiens, setDetailsBiens] = useState(false);
  const [autresCriteres, setAutresCriteres] = useState(false);
  const col = avancementCollecte(data);
  const c = data.collecte || {};
  const p = c.profil || {}, pat = c.patrimoine || {}, fin = c.patrimoine_financier || {};
  const lots = Array.isArray(pat.lots) ? pat.lots : [];
  const actifs = modulesActifs(data);
  const couple = /mari|pacs/i.test(String(p.situation_familiale || ""));
  const index = ETAPES_COLLECTE.findIndex((e) => e.cle === etape);

  const ligneEtape = (e) => {
    const x = col.parEtape.find((y) => y.cle === e.cle);
    const fait = x.faites === x.total;
    return (
      <button key={e.cle} type="button" onClick={() => setEtape(e.cle)} style={{ flex: "1 0 130px", textAlign: "left", cursor: "pointer", fontFamily: "inherit", padding: "8px 10px", borderRadius: RADIUS.md,
        border: `1px solid ${etape === e.cle ? T.accent : T.border}`, background: etape === e.cle ? T.accentBg : "transparent" }}>
        <div style={{ fontSize: FONT.xs.size, fontWeight: 900, color: fait ? SU : T.textMuted }}>{fait ? "✓ " : ""}{x.faites}/{x.total}</div>
        <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>{e.libelle}</div>
      </button>
    );
  };

  const contenu = {
    foyer: (
      <div style={{ display: "grid", gap: SPACING.md }}>
        <Carte T={T} titre="Qui est le client ?" aide="Nom, e-mail et téléphone viennent de la fiche client : inutile de les ressaisir.">
          <div style={GRILLE}>
            <Choix T={T} label="Situation familiale" value={p.situation_familiale} onChange={(v) => updateSection("profil", "situation_familiale", v)} options={["Célibataire", "Marié(e)", "Pacsé(e)", "Divorcé(e)", "Concubinage", "Veuf/veuve"]} />
            {couple && <Choix T={T} label="Régime matrimonial" value={p.regime_matrimonial} onChange={(v) => updateSection("profil", "regime_matrimonial", v)} options={["Communauté réduite aux acquêts", "Séparation de biens", "Participation aux acquêts", "Communauté universelle", "Non applicable"]} />}
            <Choix T={T} label="Activité" value={p.statut_pro} onChange={(v) => updateSection("profil", "statut_pro", v)} options={["Salarié CDI", "Salarié CDD", "Sportif professionnel", "TNS / Indépendant", "Chef d'entreprise", "Profession libérale", "Contrat étranger", "Autre"]} />
            <Texte T={T} label="Profession" value={p.profession} onChange={(v) => updateSection("profil", "profession", v)} />
            <Choix T={T} label="Tranche d'imposition (TMI)" value={p.tmi} onChange={(v) => updateSection("profil", "tmi", v)} options={["0 %", "11 %", "30 %", "41 %", "45 %", "À vérifier"]} />
          </div>
        </Carte>
        <EnfantsFoyer T={T} enfants={c.enfants_liste} onChange={(v) => onBloc("enfants_liste", v, true)} />
        <Carte T={T} titre="Situations particulières" aide="Cochez seulement ce qui concerne ce client : cela ouvre les questions et les pièces correspondantes, et rien d'autre.">
          <div style={{ display: "grid", gap: 10 }}>
            {MODULES.map((m) => {
              const on = actifs.includes(m.cle);
              const def = CHAMPS_MODULES[m.cle];
              return (
                <div key={m.cle} style={{ border: `1px solid ${on ? T.accentBorder : T.border}`, borderRadius: RADIUS.md, padding: "8px 12px", background: on ? T.accentBg : "transparent" }}>
                  <Case T={T} checked={on} onChange={(v) => updateSection("modules", m.cle, v)}><b>{m.libelle}</b><span style={{ color: T.textMuted }}> — {m.aide}</span></Case>
                  {on && <div style={{ ...GRILLE, marginTop: 8 }}>{def.champs.map(([k, l]) => <Texte key={k} T={T} label={l} value={c[def.section]?.[k]} onChange={(v) => updateSection(def.section, k, v)} />)}</div>}
                </div>
              );
            })}
          </div>
        </Carte>
      </div>
    ),
    flux: (
      <div style={{ display: "grid", gap: SPACING.md }}>
        <Carte T={T} titre="Revenus du foyer" aide="Revenus récurrents seulement. Les revenus exceptionnels (prime, cession) sont à part : ils ne servent pas à calculer la capacité d'investissement.">
          <div style={GRILLE}>
            <Texte T={T} type="number" label="Revenus nets du client (€/mois)" value={p.revenus_nets_mois} onChange={(v) => updateSection("profil", "revenus_nets_mois", v)} />
            <Texte T={T} type="number" label="Revenus nets du conjoint (€/mois)" value={p.revenus_conjoint_mois} onChange={(v) => updateSection("profil", "revenus_conjoint_mois", v)} />
            <Texte T={T} type="number" label="Dividendes (€/an)" value={p.dividendes_an} onChange={(v) => updateSection("profil", "dividendes_an", v)} />
            <Texte T={T} type="number" label="Autres revenus récurrents (€/an)" value={p.autres_revenus_an} onChange={(v) => updateSection("profil", "autres_revenus_an", v)} />
            <Texte T={T} type="number" label="Revenus exceptionnels (€/an)" value={p.revenus_exceptionnels_an} onChange={(v) => updateSection("profil", "revenus_exceptionnels_an", v)} />
          </div>
        </Carte>
        <ChargesFoyer T={T} collecte={c} onChange={(v) => onBloc("charges", v, true)} />
      </div>
    ),
    patrimoine: (
      <div style={{ display: "grid", gap: SPACING.md }}>
        <Carte T={T} titre="Résidence principale">
          <div style={GRILLE}>
            <Choix T={T} label="Situation" value={pat.residence_principale_statut} onChange={(v) => updateSection("patrimoine", "residence_principale_statut", v)} options={["Propriétaire — crédit en cours", "Propriétaire — crédit soldé", "Locataire", "Hébergé(e)"]} />
            {/Propriétaire/.test(pat.residence_principale_statut || "") && <Texte T={T} type="number" label="Valeur estimée (€)" value={pat.rp_valeur} onChange={(v) => updateSection("patrimoine", "rp_valeur", v)} />}
            {/crédit en cours/.test(pat.residence_principale_statut || "") && <Texte T={T} type="number" label="Capital restant dû (€)" value={pat.rp_crd} onChange={(v) => updateSection("patrimoine", "rp_crd", v)} />}
          </div>
        </Carte>
        <Carte T={T} titre={`Biens locatifs · ${lots.length}`} aide="Quatre chiffres par bien suffisent pour démarrer : valeur, loyer, mensualité du prêt, capital restant dû. Le reste est facultatif."
          >
          <div style={{ marginBottom: 8 }}><Case T={T} checked={pat.aucun_bien === true} onChange={(v) => updateSection("patrimoine", "aucun_bien", v)}>Le client ne possède aucun bien locatif</Case></div>
          {pat.aucun_bien !== true && (
            <>
              {lots.map((l, i) => (
                <div key={l.id || i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) 130px repeat(4,minmax(0,1fr)) auto", gap: 8, alignItems: "end", padding: "6px 0", borderTop: i ? `1px solid ${T.rowBorder || T.border}` : "none" }}>
                  <Texte T={T} label="Adresse ou nom du bien" value={l.adresse} onChange={(v) => updateLot(i, "adresse", v)} />
                  <Choix T={T} label="Détention" value={l.structure} onChange={(v) => updateLot(i, "structure", v)} options={["PP direct", "SCI IR", "SCI IS", "SARL famille", "Holding SAS", "Démembrement", "Autre"]} />
                  <Texte T={T} type="number" label="Valeur (€)" value={l.valeur} onChange={(v) => updateLot(i, "valeur", v)} />
                  <Texte T={T} type="number" label="Loyer (€/mois)" value={l.loyer_mois} onChange={(v) => updateLot(i, "loyer_mois", v)} />
                  <Texte T={T} type="number" label="Mensualité (€)" value={l.mensualite} onChange={(v) => updateLot(i, "mensualite", v)} />
                  <Texte T={T} type="number" label="Capital restant dû (€)" value={l.crd} onChange={(v) => updateLot(i, "crd", v)} />
                  <button className="inv-btn inv-btn-sm inv-btn-danger" onClick={() => removeLot(i)} aria-label="Retirer le bien"><Icon as={Trash2} size={11} /></button>
                </div>
              ))}
              <button className="inv-btn inv-btn-sm" style={{ marginTop: 8 }} onClick={addLot}><Icon as={Plus} size={12} />Ajouter un bien</button>
            </>
          )}
        </Carte>
        {pat.aucun_bien !== true && lots.length > 0 && (
          <div>
            <button className="inv-btn inv-btn-sm" onClick={() => setDetailsBiens((d) => !d)}>{detailsBiens ? "Masquer" : "Afficher"} les détails de chaque bien (facultatif : prix d'achat, charges, taxe foncière, vacance…)</button>
            {detailsBiens && <div style={{ marginTop: 8 }}><FichesBiens T={T} lots={lots} onUpdateLot={updateLot} /></div>}
          </div>
        )}
        <Carte T={T} titre="Liquidités et placements" aide="Montants approximatifs : on affinera avec les relevés.">
          <div style={GRILLE}>
            <Texte T={T} type="number" label="Liquidités : comptes et livrets (€)" value={fin.liquidites} onChange={(v) => updateSection("patrimoine_financier", "liquidites", v)} />
            <Texte T={T} type="number" label="Assurance-vie (€)" value={fin.assurance_vie} onChange={(v) => updateSection("patrimoine_financier", "assurance_vie", v)} />
            <Texte T={T} type="number" label="PEA, compte-titres (€)" value={fin.pea_cto} onChange={(v) => updateSection("patrimoine_financier", "pea_cto", v)} />
            <Texte T={T} type="number" label="PER, retraite (€)" value={fin.per} onChange={(v) => updateSection("patrimoine_financier", "per", v)} />
            <Texte T={T} type="number" label="Épargne salariale (€)" value={fin.epargne_salariale} onChange={(v) => updateSection("patrimoine_financier", "epargne_salariale", v)} />
            <Texte T={T} type="number" label="Autres placements (€)" value={fin.autres} onChange={(v) => updateSection("patrimoine_financier", "autres", v)} />
          </div>
        </Carte>
      </div>
    ),
    dettes: (
      <div style={{ display: "grid", gap: SPACING.md }}>
        <Carte T={T} titre="Autres dettes" aide="Les prêts des biens locatifs et celui de la résidence principale sont déjà saisis à l'étape précédente.">
          <Case T={T} checked={pat.aucune_autre_dette === true} onChange={(v) => updateSection("patrimoine", "aucune_autre_dette", v)}>Le client n'a aucune autre dette (consommation, auto, étudiant, professionnelle…)</Case>
        </Carte>
        {pat.aucune_autre_dette !== true && <DettesListe T={T} dettes={c.dettes} onChange={(v) => onBloc("dettes", v, true)} />}
      </div>
    ),
    objectifs: (
      <div style={{ display: "grid", gap: SPACING.md }}>
        <ObjectifsMesures T={T} objectifs={c.objectifs_mesures} onChange={(v) => onBloc("objectifs_mesures", v, true)} />
        <Carte T={T} titre="Profil investisseur : quatre critères clés" aide="Ce que le client accepte de vivre en tant que propriétaire bailleur.">
          <div style={GRILLE}>
            <Choix T={T} label="Tolérance à l'endettement" value={c.profil_immo?.tolerance_endettement} onChange={(v) => onBloc("profil_immo", { ...(c.profil_immo || {}), tolerance_endettement: v }, true)} options={["Faible", "Moyenne", "Élevée"]} />
            <Texte T={T} type="number" label="Cash-flow négatif acceptable (€/mois)" value={c.profil_immo?.cashflow_negatif_max} onChange={(v) => onBloc("profil_immo", { ...(c.profil_immo || {}), cashflow_negatif_max: v }, true)} />
            <Choix T={T} label="Appétence pour les travaux" value={c.profil_immo?.appetence_travaux} onChange={(v) => onBloc("profil_immo", { ...(c.profil_immo || {}), appetence_travaux: v }, true)} options={["Aucune", "Limitée", "Forte"]} />
            <Choix T={T} label="Gestion locative" value={c.profil_immo?.appetence_gestion} onChange={(v) => onBloc("profil_immo", { ...(c.profil_immo || {}), appetence_gestion: v }, true)} options={["Délègue tout", "Partage", "Gère lui-même"]} />
          </div>
          <button className="inv-btn inv-btn-sm" style={{ marginTop: 10 }} onClick={() => setAutresCriteres((a) => !a)}>{autresCriteres ? "Masquer" : "Afficher"} les autres critères (facultatif)</button>
          {autresCriteres && <div style={{ marginTop: 10 }}><ProfilInvestisseurImmo T={T} profilImmo={c.profil_immo} onChange={(v) => onBloc("profil_immo", v, true)} /></div>}
        </Carte>
      </div>
    ),
  }[etape];

  return (
    <div style={{ display: "grid", gap: SPACING.md }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900, color: T.text, fontSize: FONT.base.size + 1 }}>Collecte essentielle · {col.faites}/{col.total}</div>
          <div style={{ fontSize: FONT.sm.size, color: col.pretPourDiagnostic ? SU : T.textSub }}>
            {col.pretPourDiagnostic ? "L'essentiel est saisi : le diagnostic est complet."
              : col.diagnosticPossible ? "Le diagnostic est calculable (provisoire)."
              : `Il manque ${col.manquantesDiagnostic.length} réponse(s) pour calculer le diagnostic.`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>{ETAPES_COLLECTE.map(ligneEtape)}</div>
      </div>
      {contenu}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <button className="inv-btn" disabled={index === 0} onClick={() => setEtape(ETAPES_COLLECTE[index - 1].cle)}><Icon as={ChevronLeft} size={13} />Précédent</button>
        {index < ETAPES_COLLECTE.length - 1
          ? <button className="inv-btn inv-btn-blue" onClick={() => setEtape(ETAPES_COLLECTE[index + 1].cle)}>Suivant<Icon as={ChevronRight} size={13} /></button>
          : <button className="inv-btn inv-btn-blue" onClick={() => onOnglet("analyse")}>Voir le diagnostic<Icon as={ArrowRight} size={13} /></button>}
      </div>
      <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
        Besoin de plus de détail ? La saisie détaillée reste disponible, dans les mêmes données :
        {" "}<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("audit")}>Entretien guidé</button>
        {" "}<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("profil")}>Profil détaillé</button>
        {" "}<button className="inv-btn inv-btn-sm" onClick={() => onOnglet("patrimoine")}>Bilan détaillé</button>
      </div>
    </div>
  );
}
