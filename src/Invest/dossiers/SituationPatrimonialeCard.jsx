// src/Invest/dossiers/SituationPatrimonialeCard.jsx — « Situation patrimoniale »
// de la fiche client (Chantier 1.1, Tranche 2c) : collecte FACTUELLE du foyer.
//
// Cinq sections de cartes : Foyer ; Revenus, charges & épargne ; Crédits &
// engagements ; Patrimoine immobilier ; Structures. Gestes : ajouter,
// modifier, archiver, vérifier, signaler « à corriger ».
// Les données appartiennent au client ; elles ne se modifient que dans un
// Dossier Invest en cours (la base le contrôle aussi). Pas d'analyse ici.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabase";
import {
  SECTIONS, LIENS, CIVILITES, STATUTS_PRO, FAMILLES, CATEGORIES, PERIODICITES, BASES_REVENU, TYPES_ENGAGEMENT, TYPES_TAUX,
  USAGES, TYPOLOGIES, SOURCES_VALORISATION, REGIMES_FISCAUX_BIEN, MODES_DETENTION, STATUTS_ACTIF, TYPES_STRUCTURE,
  REGIMES_STRUCTURE, STATUTS_STRUCTURE, SOURCES, VERIFICATIONS, calculerSituation, personnePrincipaleProposee,
  avertissements, titreLigne, mensualiser,
} from "./situationPatrimoniale";

const eur = (v) => (v == null || v === "" ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Number(v))} €`);
const dateFr = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "");
const COULEUR_VERIF = { non_verifiee: "#64748b", verifiee: "#16a34a", a_corriger: "#dc2626" };
const TABLE_ABSENTE = (e) => e && (e.code === "42P01" || e.code === "PGRST205");

// Champs de formulaire par table (clé, libellé, type, options).
const OPT = (o) => Object.entries(o).map(([v, l]) => ({ v, l }));
const CHAMPS = {
  invest_personnes: [
    { k: "lien", l: "Lien", t: "select", o: OPT(LIENS), requis: true }, { k: "civilite", l: "Civilité", t: "select", o: OPT(CIVILITES) },
    { k: "prenom", l: "Prénom" }, { k: "nom", l: "Nom" }, { k: "nom_naissance", l: "Nom de naissance" },
    { k: "date_naissance", l: "Date de naissance", t: "date" }, { k: "nationalite", l: "Nationalité" },
    { k: "pays_residence_fiscale", l: "Pays de résidence fiscale" }, { k: "email", l: "E-mail" }, { k: "telephone", l: "Téléphone" },
    { k: "adresse", l: "Adresse", large: true }, { k: "statut_professionnel", l: "Statut professionnel", t: "select", o: OPT(STATUTS_PRO) },
    { k: "profession", l: "Profession" }, { k: "employeur", l: "Employeur" }, { k: "date_debut_activite", l: "Début d'activité", t: "date" },
    { k: "co_emprunteur", l: "Co-emprunteur", t: "bool" }, { k: "a_charge", l: "À charge", t: "bool" }, { k: "garde_alternee", l: "Garde alternée", t: "bool" },
    { k: "ordre", l: "Ordre d'affichage", t: "number" },
  ],
  invest_postes_financiers: [
    { k: "famille", l: "Famille", t: "select", o: OPT(FAMILLES), requis: true },
    { k: "categorie", l: "Catégorie", t: "select", o: (f) => OPT(CATEGORIES[f.famille] || {}), requis: true },
    { k: "personne_id", l: "Personne concernée", t: "personne" }, { k: "libelle", l: "Libellé" },
    { k: "montant", l: (f) => (f.famille === "actif_financier" ? "Valeur détenue (€)" : "Montant (€)"), t: "number", requis: true },
    { k: "periodicite", l: "Périodicité", t: "select", o: OPT(PERIODICITES), si: (f) => f.famille !== "actif_financier", requis: true },
    { k: "base_revenu", l: "Base du revenu", t: "select", o: OPT(BASES_REVENU), si: (f) => f.famille === "revenu", requis: true },
    { k: "etablissement", l: "Établissement" }, { k: "date_valeur", l: "Date de valeur", t: "date" }, { k: "commentaire", l: "Commentaire", large: true },
  ],
  invest_engagements: [
    { k: "type", l: "Type", t: "select", o: OPT(TYPES_ENGAGEMENT), requis: true }, { k: "preteur_beneficiaire", l: "Prêteur / bénéficiaire" },
    { k: "libelle", l: "Libellé" }, { k: "mensualite", l: "Mensualité (€/mois, hors assurance)", t: "number" },
    { k: "assurance_mensuelle", l: "Assurance (€/mois)", t: "number" }, { k: "capital_initial", l: "Capital initial (€)", t: "number" },
    { k: "capital_restant_du", l: "Capital restant dû (€)", t: "number" }, { k: "crd_date", l: "CRD à la date du", t: "date" },
    { k: "taux", l: "Taux (%)", t: "number" }, { k: "type_taux", l: "Type de taux", t: "select", o: OPT(TYPES_TAUX) },
    { k: "duree_mois", l: "Durée (mois)", t: "number" }, { k: "date_debut", l: "Début", t: "date" }, { k: "date_fin", l: "Fin", t: "date" },
    { k: "montant_garanti", l: "Montant garanti (€)", t: "number" }, { k: "personne_id", l: "Emprunteur", t: "personne" },
    { k: "co_emprunteurs", l: "Co-emprunteurs", t: "personnes" }, { k: "asset_id", l: "Bien financé", t: "actif" },
    { k: "solde", l: "Soldé", t: "bool" }, { k: "commentaire", l: "Commentaire", large: true },
  ],
  invest_actifs_patrimoniaux: [
    { k: "usage", l: "Usage", t: "select", o: OPT(USAGES), requis: true }, { k: "typologie", l: "Typologie", t: "select", o: OPT(TYPOLOGIES) },
    { k: "libelle", l: "Libellé" }, { k: "adresse", l: "Adresse", large: true },
    { k: "date_acquisition", l: "Date d'acquisition", t: "date" }, { k: "prix_acquisition", l: "Prix d'acquisition (€)", t: "number" },
    { k: "valeur_estimee", l: "Valeur estimée (€)", t: "number" }, { k: "date_valeur", l: "Date de la valeur", t: "date" },
    { k: "source_valorisation", l: "Source de la valeur", t: "select", o: OPT(SOURCES_VALORISATION) },
    { k: "loyer_mensuel", l: "Loyer (€/mois)", t: "number" }, { k: "charges_annuelles", l: "Charges (€/an)", t: "number" },
    { k: "taxe_fonciere_annuelle", l: "Taxe foncière (€/an)", t: "number" }, { k: "regime_fiscal", l: "Régime fiscal", t: "select", o: OPT(REGIMES_FISCAUX_BIEN) },
    { k: "mode_detention", l: "Mode de détention", t: "select", o: OPT(MODES_DETENTION) },
    { k: "structure_id", l: "Structure propriétaire", t: "structure", si: (f) => f.mode_detention === "structure", requis: true },
    { k: "detenteurs", l: "Détenteurs (quote-part %)", t: "detenteurs", large: true },
    { k: "travaux", l: "Travaux", large: true }, { k: "travaux_montant", l: "Montant des travaux (€)", t: "number" },
    { k: "statut", l: "Statut", t: "select", o: OPT(STATUTS_ACTIF), requis: true },
    { k: "date_vente", l: "Date de vente", t: "date", si: (f) => f.statut === "vendu" }, { k: "prix_vente", l: "Prix de vente (€)", t: "number", si: (f) => f.statut === "vendu" },
    { k: "commentaire", l: "Commentaire", large: true },
  ],
  invest_structures: [
    { k: "type", l: "Type", t: "select", o: OPT(TYPES_STRUCTURE), requis: true }, { k: "forme_juridique", l: "Forme juridique" },
    { k: "denomination", l: "Dénomination", requis: true }, { k: "siren", l: "SIREN (9 chiffres)" },
    { k: "regime_fiscal", l: "Régime fiscal", t: "select", o: OPT(REGIMES_STRUCTURE) }, { k: "statut", l: "Statut", t: "select", o: OPT(STATUTS_STRUCTURE), requis: true },
    { k: "date_creation", l: "Date de création", t: "date" }, { k: "capital", l: "Capital (€)", t: "number" }, { k: "activite", l: "Activité" },
    { k: "gerant", l: "Gérant" }, { k: "associes", l: "Associés (% et rôle)", t: "associes", large: true },
    { k: "dernier_resultat", l: "Dernier résultat (€)", t: "number" }, { k: "dernier_exercice", l: "Exercice", t: "number" },
    { k: "commentaire", l: "Commentaire", large: true },
  ],
};
const DEFAUTS = {
  invest_personnes: { lien: "principal", co_emprunteur: false, a_charge: false, garde_alternee: false, ordre: 0 },
  invest_postes_financiers: { famille: "revenu", categorie: "salaire", periodicite: "mensuelle", base_revenu: "net_avant_impot" },
  invest_engagements: { type: "credit_immobilier", co_emprunteurs: [], solde: false },
  invest_actifs_patrimoniaux: { usage: "residence_principale", statut: "detenu", detenteurs: [] },
  invest_structures: { type: "sci", statut: "existante", associes: [] },
};
const valeurDe = (x, f) => (typeof x === "function" ? x(f) : x);

/** Nettoie la saisie avant écriture : seuls les champs du formulaire, types respectés. */
function preparer(table, form) {
  const out = {};
  for (const c of CHAMPS[table]) {
    let v = form[c.k];
    if (c.si && !c.si(form)) v = c.t === "bool" ? false : null;
    if (c.t === "number") v = v === "" || v == null ? null : Number(v);
    else if (c.t === "bool") v = !!v;
    else if (c.t === "personnes") v = Array.isArray(v) ? v : [];
    else if (c.t === "detenteurs" || c.t === "associes") v = (Array.isArray(v) ? v : []).filter((x) => x.personne_id || x.nom);
    else if (typeof v === "string") v = v.trim() || null;
    out[c.k] = v ?? (c.t === "bool" ? false : null);
  }
  if (table === "invest_postes_financiers" && out.famille === "actif_financier") out.periodicite = null;
  return out;
}

// `integre` : affichage dans un onglet de la fiche Dossier (sans cadre ni titre de carte).
export default function SituationPatrimonialeCard({ client, T, dossierEnCoursId = null, dossierReference = null, integre = false }) {
  const [section, setSection] = useState("foyer");
  const [donnees, setDonnees] = useState({});
  const [etat, setEtat] = useState({ chargement: true, erreur: "", absent: false });
  const [voirArchives, setVoirArchives] = useState(false);
  const [edition, setEdition] = useState(null); // { table, id|null, form, avertissement }
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const modifiable = !!dossierEnCoursId;

  const charger = useCallback(async () => {
    if (!client?.id) return;
    setEtat((e) => ({ ...e, chargement: true }));
    const res = await Promise.all(SECTIONS.map((s) => supabase.from(s.table).select("*").eq("client_id", client.id).order("created_at", { ascending: true })));
    const erreur = res.find((r) => r.error)?.error;
    if (erreur) { setEtat({ chargement: false, erreur: TABLE_ABSENTE(erreur) ? "" : erreur.message, absent: TABLE_ABSENTE(erreur) }); return; }
    setDonnees(Object.fromEntries(SECTIONS.map((s, i) => [s.table, res[i].data || []])));
    setEtat({ chargement: false, erreur: "", absent: false });
  }, [client?.id]);
  useEffect(() => { charger(); }, [charger]);
  useEffect(() => { setEdition(null); setMessage(""); }, [client?.id]);

  const lignes = (table) => (donnees[table] || []).filter((r) => voirArchives || !r.archive_le);
  const personnes = (donnees.invest_personnes || []).filter((p) => !p.archive_le);
  const calculs = useMemo(() => calculerSituation({ postes: donnees.invest_postes_financiers, engagements: donnees.invest_engagements,
    actifsImmo: donnees.invest_actifs_patrimoniaux }), [donnees]);
  const nomPersonne = (id) => titreLigne("invest_personnes", personnes.find((p) => p.id === id) || {});

  const ecrire = async (table, requete, succes) => {
    setEnCours(true); setMessage("");
    const { data, error } = await requete;
    setEnCours(false);
    if (error || !data?.length) { setMessage(`Enregistrement refusé : ${error ? error.message : "droits insuffisants"}`); return false; }
    setMessage(succes); await charger(); return true;
  };
  const enregistrer = async () => {
    const { table, id, form } = edition;
    const manquants = CHAMPS[table].filter((c) => c.requis && (!c.si || c.si(form)) && (form[c.k] === "" || form[c.k] == null)).map((c) => valeurDe(c.l, form));
    if (manquants.length) { setMessage(`À compléter : ${manquants.join(", ")}.`); return; }
    const payload = preparer(table, form);
    const ok = id
      ? await ecrire(table, supabase.from(table).update(payload).eq("id", id).select("id"), "Modification enregistrée.")
      : await ecrire(table, supabase.from(table).insert({ ...payload, client_id: client.id, source: "profero" }).select("id"), "Ajout enregistré.");
    if (ok) setEdition(null);
  };
  const archiver = (table, r) => {
    if (!window.confirm(`Archiver « ${titreLigne(table, r)} » ? La ligne reste consultable dans les archives.`)) return;
    ecrire(table, supabase.from(table).update({ archive_le: new Date().toISOString() }).eq("id", r.id).select("id"), "Ligne archivée.");
  };
  const verifier = (table, r, statut) => {
    let commentaire = r.verification_commentaire || null;
    if (statut === "a_corriger") {
      commentaire = window.prompt("Qu'est-ce qui est à corriger ?", r.verification_commentaire || "");
      if (commentaire === null || !commentaire.trim()) return;
    }
    ecrire(table, supabase.from(table).update({ verification_statut: statut, verification_commentaire: commentaire }).eq("id", r.id).select("id"),
      statut === "verifiee" ? "Donnée vérifiée." : "Donnée signalée à corriger.");
  };

  const cadre = { border: `1px solid ${T.border}`, background: T.input, borderRadius: 12, padding: "10px 12px" };
  const sec = SECTIONS.find((s) => s.cle === section);

  if (etat.absent) {
    return <div className="inv-card"><div className="inv-card-hd">Situation patrimoniale</div><div className="inv-card-bd" style={{ fontSize: 12, color: T.textMuted }}>
      La situation patrimoniale n'est pas encore installée sur cette base.</div></div>;
  }

  return (
    <div className={integre ? "" : "inv-card"} id="situation-patrimoniale">
      <div className={integre ? "" : "inv-card-hd"} style={{ display: "flex", justifyContent: integre ? "flex-end" : "space-between", alignItems: "center", gap: 8 }}>
        {!integre && <span>Situation patrimoniale</span>}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: T.textMuted }}><input type="checkbox" checked={voirArchives} onChange={(e) => setVoirArchives(e.target.checked)} /> Archives</label>
          <button className="inv-btn inv-btn-sm" onClick={charger} disabled={etat.chargement}>Actualiser</button>
        </div>
      </div>
      <div className={integre ? "" : "inv-card-bd"} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: integre ? 8 : 0 }}>
        {/* La situation appartient au FOYER, pas au dossier consulté dans l'historique. */}
        <div style={{ fontSize: 11.5, color: T.textMuted }}>
          Situation actuelle du foyer, commune à tous ses dossiers.{" "}
          {modifiable ? <>Modifications rattachées à <b>{dossierReference || "son dossier en cours"}</b> (dossier en cours).</>
            : <b style={{ color: "#b45309" }}>Lecture seule : aucun Dossier Invest en cours pour ce client.</b>}
        </div>
        {etat.erreur && <div style={{ fontSize: 12, color: "#be123c" }}>⚠ Lecture impossible : {etat.erreur}</div>}
        {message && <div style={{ fontSize: 12, padding: "6px 9px", borderRadius: 8, background: T.accentBg, color: T.text }}>{message}</div>}

        <Synthese T={T} c={calculs} />

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {SECTIONS.map((s) => {
            const n = (donnees[s.table] || []).filter((r) => !r.archive_le).length;
            return <button key={s.cle} className={`inv-btn inv-btn-sm${section === s.cle ? " inv-btn-blue" : ""}`} onClick={() => { setSection(s.cle); setEdition(null); }}>{s.libelle} ({n})</button>;
          })}
        </div>

        {section === "foyer" && !etat.chargement && personnes.length === 0 && (
          <div style={{ ...cadre, borderColor: "#fde68a", background: "#fffbeb", fontSize: 12 }}>
            Aucune personne dans ce foyer.{" "}
            {modifiable && <button className="inv-btn inv-btn-sm inv-btn-blue" onClick={() => {
              const p = personnePrincipaleProposee(client);
              setEdition({ table: "invest_personnes", id: null, form: { ...DEFAUTS.invest_personnes, ...p }, avertissement: p.avertissement
                || "Vérifiez et complétez ces informations, reprises de la fiche client, avant d'enregistrer." });
            }}>Créer la personne principale</button>}
          </div>
        )}
        {section === "flux" && (
          <div style={{ fontSize: 11, color: T.textMuted }}>Épargne et placements : <b>valeur détenue</b> à la date indiquée. Le montant que le client souhaite mobiliser comme apport ne se saisit pas ici : il relève des objectifs du dossier.</div>
        )}

        {modifiable && !edition && (
          <div><button className="inv-btn inv-btn-sm" onClick={() => setEdition({ table: sec.table, id: null, form: { ...DEFAUTS[sec.table] } })}>＋ Ajouter</button></div>
        )}
        {edition && edition.table === sec.table && (
          <Formulaire T={T} edition={edition} setEdition={setEdition} personnes={personnes}
            actifs={(donnees.invest_actifs_patrimoniaux || []).filter((a) => !a.archive_le)}
            structures={(donnees.invest_structures || []).filter((a) => !a.archive_le)}
            onEnregistrer={enregistrer} enCours={enCours} />
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 8 }}>
          {etat.chargement && <div style={{ fontSize: 12, color: T.textMuted }}>Chargement…</div>}
          {!etat.chargement && lignes(sec.table).length === 0 && <div style={{ fontSize: 12, color: T.textMuted }}>Rien de saisi dans cette section.</div>}
          {lignes(sec.table).map((r) => (
            <CarteLigne key={r.id} T={T} table={sec.table} r={r} nomPersonne={nomPersonne} modifiable={modifiable && !enCours}
              structures={donnees.invest_structures || []} actifs={donnees.invest_actifs_patrimoniaux || []}
              onModifier={() => setEdition({ table: sec.table, id: r.id, form: { ...r } })}
              onArchiver={() => archiver(sec.table, r)} onVerifier={(s) => verifier(sec.table, r, s)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Synthese({ T, c }) {
  const cases = [
    ["Revenus", `${eur(c.revenusMensuels)} /mois`], ["Charges", `${eur(c.chargesMensuelles)} /mois`],
    ["Mensualités de crédits", `${eur(c.mensualitesCredits)} /mois`], ["Assurance des crédits", `${eur(c.assuranceCredits)} /mois`],
    ["Épargne disponible", eur(c.epargneDisponible)], ["Actifs financiers", eur(c.actifsFinanciers)],
    ["Immobilier (valeur brute)", eur(c.valeurImmobiliereBrute)], ["Dette immobilière restante", eur(c.detteImmobiliereRestante)],
    ["Patrimoine immobilier net", eur(c.patrimoineImmobilierNet)], ["Patrimoine net simplifié (biens à 100 %)", eur(c.patrimoineNetSimplifie)],
  ];
  const i = c.incomplets;
  const trous = [i.actifsSansValeur && `${i.actifsSansValeur} bien(s) sans valeur`, i.creditsSansCrd && `${i.creditsSansCrd} crédit(s) sans capital restant dû`,
    i.creditsSansMensualite && `${i.creditsSansMensualite} crédit(s) sans mensualité`, i.revenusBaseNonPrecisee && `${i.revenusBaseNonPrecisee} revenu(s) de base non précisée`].filter(Boolean);
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: "8px 10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6 }}>
        {cases.map(([l, v]) => <div key={l}><div style={{ fontSize: 10, color: T.textMuted, fontWeight: 800, textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 13, fontWeight: 900, color: T.text }}>{v}</div></div>)}
      </div>
      <div style={{ fontSize: 10.5, color: T.textMuted, marginTop: 6 }}>Flux ramenés au mois ; stocks à leur dernière valeur connue. Biens et dettes sont comptés à 100 %, même détenus en partie (indivision, SCI) : ce n'est PAS la part patrimoniale personnelle exacte, qui relèvera de l'Analyse patrimoniale. Aucune capacité d'emprunt ici.</div>
      {trous.length > 0 && <div style={{ fontSize: 11, color: "#b45309", marginTop: 4 }}>Totaux incomplets : {trous.join(" · ")}.</div>}
    </div>
  );
}

function faits(table, r, nomPersonne, structures, actifs) {
  switch (table) {
    case "invest_personnes": return [LIENS[r.lien], STATUTS_PRO[r.statut_professionnel], r.profession, r.date_naissance && `né·e le ${dateFr(r.date_naissance)}`,
      r.co_emprunteur && "co-emprunteur", r.a_charge && "à charge", r.garde_alternee && "garde alternée"];
    case "invest_postes_financiers":
      if (r.famille === "actif_financier") return [CATEGORIES.actif_financier[r.categorie], `Valeur détenue : ${eur(r.montant)}`, r.date_valeur ? `au ${dateFr(r.date_valeur)}` : "date de valeur à préciser", r.etablissement, r.personne_id && nomPersonne(r.personne_id)];
      return [`${FAMILLES[r.famille]} · ${CATEGORIES[r.famille]?.[r.categorie]}`, `${eur(r.montant)} ${PERIODICITES[r.periodicite] || ""}`,
        r.periodicite === "annuelle" && `soit ${eur(mensualiser(r.montant, r.periodicite))} /mois`, r.famille === "revenu" && BASES_REVENU[r.base_revenu],
        r.date_valeur && `au ${dateFr(r.date_valeur)}`, r.personne_id && nomPersonne(r.personne_id)];
    case "invest_engagements": return [r.mensualite != null && `${eur(r.mensualite)} /mois`, r.assurance_mensuelle != null && `assurance ${eur(r.assurance_mensuelle)} /mois`,
      r.capital_restant_du != null && `CRD ${eur(r.capital_restant_du)}${r.crd_date ? ` au ${dateFr(r.crd_date)}` : ""}`, r.taux != null && `${r.taux} % ${TYPES_TAUX[r.type_taux] || ""}`,
      r.asset_id && `bien : ${titreLigne("invest_actifs_patrimoniaux", actifs.find((a) => a.id === r.asset_id) || {})}`, r.personne_id && nomPersonne(r.personne_id), r.solde && "soldé"];
    case "invest_actifs_patrimoniaux": return [STATUTS_ACTIF[r.statut], `valeur ${eur(r.valeur_estimee)}${r.date_valeur ? ` au ${dateFr(r.date_valeur)}` : ""}`,
      SOURCES_VALORISATION[r.source_valorisation], r.loyer_mensuel != null && `loyer ${eur(r.loyer_mensuel)} /mois`, MODES_DETENTION[r.mode_detention],
      r.structure_id && `via ${titreLigne("invest_structures", structures.find((s) => s.id === r.structure_id) || {})}`, r.adresse];
    case "invest_structures": return [TYPES_STRUCTURE[r.type], r.forme_juridique, REGIMES_STRUCTURE[r.regime_fiscal] && `à l'${REGIMES_STRUCTURE[r.regime_fiscal]}`,
      STATUTS_STRUCTURE[r.statut], r.capital != null && `capital ${eur(r.capital)}`, r.siren && `SIREN ${r.siren}`,
      (r.associes || []).length && (r.associes || []).map((a) => `${a.personne_id ? nomPersonne(a.personne_id) : a.nom} ${a.pourcentage ?? "?"} %`).join(", ")];
    default: return [];
  }
}

function CarteLigne({ T, table, r, nomPersonne, modifiable, structures, actifs, onModifier, onArchiver, onVerifier }) {
  const av = avertissements(table, r);
  const c = COULEUR_VERIF[r.verification_statut] || "#64748b";
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 12, padding: "9px 11px", background: r.archive_le ? "#f1f5f9" : T.input, opacity: r.archive_le ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <b style={{ fontSize: 13, color: T.text }}>{titreLigne(table, r)}</b>
        <span style={{ fontSize: 10, fontWeight: 900, color: c, border: `1px solid ${c}55`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>{VERIFICATIONS[r.verification_statut]}</span>
      </div>
      <div style={{ fontSize: 11.5, color: T.textSub || T.text, marginTop: 4, lineHeight: 1.45 }}>{faits(table, r, nomPersonne, structures, actifs).filter(Boolean).join(" · ")}</div>
      {r.verification_statut === "a_corriger" && r.verification_commentaire && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>À corriger : {r.verification_commentaire}</div>}
      {av.map((a) => <div key={a} style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>⚠ {a}</div>)}
      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>{SOURCES[r.source]}{r.archive_le ? ` · archivée le ${dateFr(r.archive_le)}` : ""}{r.verifie_le ? ` · vérifiée le ${dateFr(r.verifie_le)}` : ""}</div>
      {modifiable && !r.archive_le && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
          <button className="inv-btn inv-btn-sm" onClick={onModifier}>Modifier</button>
          {r.verification_statut !== "verifiee" && <button className="inv-btn inv-btn-sm" onClick={() => onVerifier("verifiee")}>Vérifier</button>}
          <button className="inv-btn inv-btn-sm" onClick={() => onVerifier("a_corriger")}>À corriger</button>
          <button className="inv-btn inv-btn-sm" onClick={onArchiver}>Archiver</button>
        </div>
      )}
    </div>
  );
}

function Formulaire({ T, edition, setEdition, personnes, actifs, structures, onEnregistrer, enCours }) {
  const { table, form } = edition;
  const maj = (k, v) => setEdition((e) => ({ ...e, form: { ...e.form, [k]: v,
    ...(k === "famille" ? { categorie: Object.keys(CATEGORIES[v] || {})[0], periodicite: v === "actif_financier" ? null : (e.form.periodicite || "mensuelle"),
      base_revenu: v === "revenu" ? (e.form.base_revenu || "net_avant_impot") : null } : {}) } }));
  const lignesJson = (k, colonnes) => {
    const rows = Array.isArray(form[k]) ? form[k] : [];
    const set = (i, patch) => maj(k, rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 4 }}>
            <select className="inv-sel" value={x.personne_id || ""} onChange={(e) => set(i, { personne_id: e.target.value || null })}>
              <option value="">{colonnes.nomLibre ? "Hors foyer (nom libre)" : "Personne…"}</option>
              {personnes.map((p) => <option key={p.id} value={p.id}>{titreLigne("invest_personnes", p)}</option>)}
            </select>
            {colonnes.nomLibre && !x.personne_id && <input className="inv-inp" placeholder="Nom" value={x.nom || ""} onChange={(e) => set(i, { nom: e.target.value })} />}
            <input className="inv-inp" type="number" placeholder="%" style={{ width: 70 }} value={x[colonnes.pct] ?? ""} onChange={(e) => set(i, { [colonnes.pct]: e.target.value === "" ? null : Number(e.target.value) })} />
            <input className="inv-inp" placeholder={colonnes.role} value={x[colonnes.roleK] || ""} onChange={(e) => set(i, { [colonnes.roleK]: e.target.value || null })} />
            <button className="inv-btn inv-btn-sm" onClick={() => maj(k, rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="inv-btn inv-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => maj(k, [...rows, {}])}>＋ Ligne</button>
      </div>
    );
  };
  const champ = (c) => {
    const v = form[c.k];
    switch (c.t) {
      case "select": return <select className="inv-sel" value={v ?? ""} onChange={(e) => maj(c.k, e.target.value || null)}><option value="">—</option>{valeurDe(c.o, form).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>;
      case "bool": return <input type="checkbox" checked={!!v} onChange={(e) => maj(c.k, e.target.checked)} />;
      case "number": return <input className="inv-inp" type="number" step="any" value={v ?? ""} onChange={(e) => maj(c.k, e.target.value)} />;
      case "date": return <input className="inv-inp" type="date" value={v ? String(v).slice(0, 10) : ""} onChange={(e) => maj(c.k, e.target.value || null)} />;
      case "personne": return <select className="inv-sel" value={v || ""} onChange={(e) => maj(c.k, e.target.value || null)}><option value="">—</option>{personnes.map((p) => <option key={p.id} value={p.id}>{titreLigne("invest_personnes", p)}</option>)}</select>;
      case "personnes": return <select className="inv-sel" multiple value={v || []} onChange={(e) => maj(c.k, [...e.target.selectedOptions].map((o) => o.value))}>{personnes.map((p) => <option key={p.id} value={p.id}>{titreLigne("invest_personnes", p)}</option>)}</select>;
      case "actif": return <select className="inv-sel" value={v || ""} onChange={(e) => maj(c.k, e.target.value || null)}><option value="">—</option>{actifs.map((a) => <option key={a.id} value={a.id}>{titreLigne("invest_actifs_patrimoniaux", a)}</option>)}</select>;
      case "structure": return <select className="inv-sel" value={v || ""} onChange={(e) => maj(c.k, e.target.value || null)}><option value="">—</option>{structures.map((s) => <option key={s.id} value={s.id}>{s.denomination}</option>)}</select>;
      case "detenteurs": return lignesJson(c.k, { pct: "quote_part", roleK: "droit", role: "Droit (PP, usufruit…)" });
      case "associes": return lignesJson(c.k, { pct: "pourcentage", roleK: "role", role: "Rôle", nomLibre: true });
      default: return <input className="inv-inp" value={v ?? ""} onChange={(e) => maj(c.k, e.target.value)} style={{ textAlign: "left" }} />;
    }
  };
  return (
    <div style={{ border: `2px solid ${T.accent}`, borderRadius: 12, padding: 10 }}>
      {edition.avertissement && <div style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", borderRadius: 8, padding: 6, marginBottom: 8 }}>{edition.avertissement}</div>}
      {edition.id && form.verification_statut === "verifiee" && <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>Cette donnée est vérifiée : la modifier la repassera « non vérifiée ».</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 8 }}>
        {CHAMPS[table].filter((c) => !c.si || c.si(form)).map((c) => (
          <label key={c.k} style={{ fontSize: 11, color: T.textMuted, fontWeight: 800, gridColumn: c.large ? "1 / -1" : undefined, display: "flex", flexDirection: "column", gap: 3 }}>
            {valeurDe(c.l, form)}{c.requis ? " *" : ""}{champ(c)}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="inv-btn inv-btn-blue inv-btn-sm" onClick={onEnregistrer} disabled={enCours}>Enregistrer</button>
        <button className="inv-btn inv-btn-sm" onClick={() => setEdition(null)} disabled={enCours}>Annuler</button>
      </div>
    </div>
  );
}
