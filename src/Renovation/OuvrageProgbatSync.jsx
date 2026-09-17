// src/Renovation/OuvrageProgbatSync.jsx — Bibliothèque → fiche d'un ouvrage
// Envoi d'UN ouvrage Profero vers ProGBat, sans passer par la synchronisation
// globale des Réglages. Même Edge Function, même garde-fous :
//   1. « Vérifier » prépare le plan restreint à cet ouvrage (LECTURE SEULE) ;
//   2. l'aperçu dit exactement ce qui sera fait (créer dans la famille
//      d'ouvrages EXISTANTE choisie, ou seulement lier un code déjà présent
//      dans ProGBat), ou pourquoi c'est impossible ;
//   3. l'écriture n'a lieu qu'après confirmation explicite, avec l'empreinte du
//      plan : si l'ouvrage a changé entre-temps, ProGBat n'est pas touché.
// La CADENCE Profero part avec l'ouvrage : elle devient la quantité, en heures,
// d'un job horaire ProGBat (sinon ProGBat reconstitue un temps depuis le prix).
// Elle peut aussi être posée sur un ouvrage déjà lié dont la composition
// ProGBat est VIDE ; une composition existante n'est jamais remplacée.
import React, { useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { UploadCloud, Check, AlertTriangle, Link2, X } from "lucide-react";

const fmtHeures = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
const fmtEur2 = (n) => n == null ? "—" : `${Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const LIBELLES_STATUT = {
  deja_lie: "déjà lié à ProGBat",
  correspondance_code_a_confirmer: "un ouvrage ProGBat porte déjà ce code",
  ambigu: "plusieurs ouvrages ProGBat portent ce code",
  correspondance_libelle_a_examiner: "un ouvrage ProGBat porte le même libellé",
  nouveau_a_creer: "absent de ProGBat",
};

// Message d'aperçu pour un ouvrage sans action possible.
function raisonsHorsPlan(plan, etat) {
  const exclu = (plan?.exclus || [])[0];
  if (exclu?.raisons?.length) return exclu.raisons;
  // Déjà lié sans action ET sans exclusion : la cause exacte vient du serveur
  // (elle est dans les exclusions). Ne jamais l'inventer ici.
  if (etat?.statut === "deja_lie") return ["Il est lié à ProGBat et il n'y a rien à modifier."];
  if (etat?.blocages?.length) return etat.blocages;
  if (etat?.statut) return [`Statut « ${LIBELLES_STATUT[etat.statut] || etat.statut} » : à traiter depuis Réglages → Maintenance.`];
  return ["Ouvrage introuvable dans l'inventaire : relancer l'analyse depuis Réglages → Maintenance."];
}

// Comparaison de noms tolérante aux accents/casse, pour proposer d'emblée la
// famille ProGBat qui porte le nom de la catégorie Profero de l'ouvrage.
const cleNom = (v) => String(v ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export default function OuvrageProgbatSync({ ouvrage, categorieLabel = "", T, acc, onLie }) {
  const [etape, setEtape] = useState("repos");   // repos | apercu | fait
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [apercu, setApercu] = useState(null);    // { planHash, plan, etats }
  const [resultat, setResultat] = useState(null);
  const [familleId, setFamilleId] = useState(null);   // famille ProGBat choisie
  const [jobId, setJobId] = useState(null);           // main-d'œuvre ProGBat choisie

  const progbatId = ouvrage?.progbat_id ? String(ouvrage.progbat_id) : null;

  const appeler = async (body) => {
    const { data, error } = await supabase.functions.invoke("progbat-library-sync", { body });
    if (error && !data) {
      let corps = null;
      try { corps = error?.context?.json ? await error.context.json() : null; } catch { /* pas de corps lisible */ }
      if (corps) return corps;
      throw new Error(error.message || "Appel de la synchronisation impossible.");
    }
    if (!data) throw new Error("Réponse vide de la synchronisation.");
    return data;
  };

  // `cible` : null = on laisse le serveur décider qu'aucune famille n'est
  // choisie (premier appel), ce qui sert surtout à récupérer la liste.
  const verifier = async (cible = familleId, cibleJob = jobId) => {
    setChargement(true); setErreur(null); setResultat(null);
    try {
      const data = await appeler({ action: "prepare", ouvrageIds: [ouvrage.id], familleId: cible ?? null, jobId: cibleJob ?? null });
      if (!data.ok) throw new Error(data.error || "Préparation impossible.");
      const familles = data.famillesDisponibles || [];
      // Aucune famille choisie : proposer celle qui porte le nom de la
      // catégorie Profero de l'ouvrage, quand elle existe. Rien n'est envoyé
      // pour autant — la confirmation reste à faire.
      const suggeree = cible == null && categorieLabel
        ? familles.find((f) => cleNom(f.label) === cleNom(categorieLabel))
        : null;
      // On relance avec la famille suggérée sans afficher l'aperçu vide
      // intermédiaire : l'utilisateur ne voit qu'un seul état, le bon.
      // Une seule main-d'œuvre horaire dans ProGBat : aucun choix à faire.
      const jobsDispo = data.jobsDisponibles || [];
      const jobEvident = cibleJob == null && jobsDispo.length === 1 ? jobsDispo[0] : null;
      if (suggeree || jobEvident) {
        const f = suggeree ? suggeree.id : cible;
        const j = jobEvident ? jobEvident.id : cibleJob;
        if (suggeree) setFamilleId(f);
        if (jobEvident) setJobId(j);
        return verifier(f ?? null, j ?? null);
      }
      setFamilleId(cible ?? null);
      setJobId(cibleJob ?? null);
      setApercu(data);
      setEtape("apercu");
    } catch (e) { setErreur(e?.message || "Erreur inattendue."); }
    setChargement(false);
  };

  const envoyer = async () => {
    if (!apercu?.planHash) return;
    setChargement(true); setErreur(null);
    try {
      const data = await appeler({
        action: "sync", ouvrageIds: [ouvrage.id], familleId: familleId ?? null, jobId: jobId ?? null,
        expectedPlanHash: apercu.planHash, confirmed: true,
      });
      const ligne = (data.resultats || [])[0] || null;
      if (!ligne) throw new Error(data.error || "Synchronisation interrompue : vérifier ProGBat avant de recommencer.");
      setResultat(ligne);
      setApercu(null);
      setEtape("fait");
      if (ligne.progbatId && onLie) onLie(String(ligne.progbatId));
    } catch (e) {
      // Une écriture POST interrompue n'est jamais présentée comme sans effet.
      setErreur(e?.message || "Connexion interrompue : vérifier dans ProGBat avant de recommencer.");
    }
    setChargement(false);
  };

  const action = (apercu?.plan?.actions || [])[0] || null;
  const etat = (apercu?.etats || [])[0] || null;
  const famille = apercu?.plan?.famille || null;
  const famillesDisponibles = apercu?.famillesDisponibles || [];
  const jobsDisponibles = apercu?.jobsDisponibles || [];
  const job = apercu?.plan?.job || null;
  const exclusion = (apercu?.plan?.exclus || [])[0] || null;

  const bouton = (label, onClick, { principal = false, disabled = false, icone = UploadCloud } = {}) => (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "8px 14px", borderRadius: RADIUS.md,
      border: principal ? "none" : `1px solid ${T.border}`,
      background: principal ? acc.accent : "transparent",
      color: principal ? acc.onAccent : T.textSub,
      fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: principal ? 800 : 600,
      cursor: disabled ? "default" : "pointer", opacity: disabled ? .6 : 1,
    }}>
      <Icon as={icone} size={12}/>
      {label}
    </button>
  );

  const encart = (couleur, contenu) => (
    <div style={{
      marginTop: 8, padding: "8px 10px", borderRadius: RADIUS.md,
      background: `${couleur}14`, border: `1px solid ${couleur}44`,
      color: T.text, fontSize: FONT.xs.size + 1, lineHeight: 1.45,
    }}>{contenu}</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {progbatId && (
          <span title={`Ouvrage lié à la structure ProGBat #${progbatId}${ouvrage.progbat_sync_at ? ` le ${new Date(ouvrage.progbat_sync_at).toLocaleDateString("fr-FR")}` : ""}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: RADIUS.pill,
              fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.28)" }}>
            <Icon as={Link2} size={11}/> Sur ProGBat · #{progbatId}
          </span>
        )}
        {/* Un ouvrage déjà lié peut encore avoir besoin de sa cadence. */}
        {etape === "repos" && bouton(
          chargement ? "Vérification…" : progbatId ? "Vérifier la cadence ProGBat" : "Créer sur ProGBat",
          () => verifier(null, null), { disabled: chargement },
        )}
        {etape !== "repos" && bouton("Fermer", () => { setEtape("repos"); setApercu(null); setResultat(null); setErreur(null); }, { icone: X })}
      </div>

      {erreur && encart("#e15a5a", (
        <span><Icon as={AlertTriangle} size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>{erreur}</span>
      ))}

      {/* Famille de destination : uniquement des familles qui EXISTENT déjà
          dans ProGBat. Rien n'est créé côté familles. */}
      {etape === "apercu" && !erreur && etat?.statut !== "deja_lie" && famillesDisponibles.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
            Famille ProGBat
          </label>
          <select
            value={familleId ?? ""}
            disabled={chargement}
            onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setFamilleId(v); verifier(v); }}
            style={{ padding: "7px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none", maxWidth: 320 }}
          >
            <option value="">— choisir la famille —</option>
            {famillesDisponibles.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
            {famillesDisponibles.length} famille(s) d'ouvrages existantes dans ProGBat
          </span>
        </div>
      )}

      {/* Main-d'œuvre : c'est elle qui porte la cadence Profero dans ProGBat. */}
      {etape === "apercu" && !erreur && jobsDisponibles.length > 1 && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 1 }}>
            Main-d'œuvre ProGBat
          </label>
          <select
            value={jobId ?? ""}
            disabled={chargement}
            onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setJobId(v); verifier(familleId, v); }}
            style={{ padding: "7px 10px", background: T.inputBg, borderRadius: 8, border: `1px solid ${T.border}`, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, outline: "none", maxWidth: 320 }}
          >
            <option value="">— choisir la main-d'œuvre —</option>
            {jobsDisponibles.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select>
          <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>porte la cadence, en heures</span>
        </div>
      )}

      {etape === "apercu" && !erreur && (
        action ? encart("#4db8ff", (
          <>
            <div style={{ fontWeight: 800, marginBottom: 3 }}>
              {action.type === "create"
                ? `Création dans ProGBat, famille « ${famille?.libelle || "?"} »`
                : action.type === "composition"
                  ? `Cadence à poser sur l'ouvrage ProGBat #${action.progbatId}`
                  : `Liaison au ProGBat existant #${action.progbatId}`}
            </div>
            {action.type === "create" ? (
              <>
                <div style={{ color: T.textSub }}>
                  {action.payload?.label} · unité {action.payload?.unitCode} ·
                  achat {fmtEur2(action.payload?.purchaseNetUnitPrice)} · vente {fmtEur2(action.payload?.saleNetUnitPrice)} HT · TVA {action.payload?.taxRate} %
                </div>
                <div style={{ color: T.textSub }}>
                  Cadence envoyée : <strong>{fmtHeures(action.composition?.heures)}</strong> sur « {action.composition?.jobLibelle} ». Le prix de vente reste celui de Profero, ProGBat ne le recalcule pas.
                </div>
              </>
            ) : action.type === "composition" ? (
              <div style={{ color: T.textSub }}>
                Sa composition ProGBat est vide, c'est pourquoi le devis affichait un temps reconstitué depuis le prix.
                Profero va y inscrire <strong>{fmtHeures(action.composition?.heures)}</strong> sur « {action.composition?.jobLibelle} ».
                Ni le prix ni le libellé ne sont touchés.
              </div>
            ) : (
              <div style={{ color: T.textSub }}>
                {action.progbatLabel || "sans libellé"} — rien n'est créé ni modifié dans ProGBat, seul le lien est enregistré dans Profero.
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              {bouton(chargement ? "Envoi…" : (action.type === "create" ? "Confirmer la création" : action.type === "composition" ? "Confirmer la cadence" : "Confirmer la liaison"), envoyer, { principal: true, disabled: chargement })}
            </div>
          </>
        )) : encart(etat?.statut === "deja_lie" && !exclusion ? "#22c55e" : "#f59e0b", (
          <>
            <div style={{ fontWeight: 800, marginBottom: 3 }}>
              {exclusion
                ? (etat?.statut === "deja_lie" ? "Cadence non posée." : "Envoi impossible pour l'instant.")
                : "Rien à faire sur cet ouvrage."}
            </div>
            {raisonsHorsPlan(apercu?.plan, etat).map((r, i) => (
              <div key={i} style={{ color: T.textSub }}>• {r}</div>
            ))}
            {famillesDisponibles.length === 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.sectionDivider}`, color: T.textSub }}>
                Aucune famille d'ouvrages n'a été trouvée dans ProGBat : en créer une dans ProGBat (bibliothèque → familles), puis relancer la vérification.
              </div>
            )}
          </>
        ))
      )}

      {etape === "fait" && resultat && !erreur && encart(
        ["created", "linked", "composed"].includes(resultat.statut) ? "#22c55e" : "#f59e0b",
        <>
          <div style={{ fontWeight: 800 }}>
            <Icon as={["created", "linked", "composed"].includes(resultat.statut) ? Check : AlertTriangle} size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>
            {resultat.statut === "created" ? `Créé dans ProGBat (#${resultat.progbatId}) avec ${fmtHeures(resultat.heures)} de main-d'œuvre.`
              : resultat.statut === "composed" ? `Cadence posée sur ProGBat #${resultat.progbatId} : ${fmtHeures(resultat.heures)}.`
              : resultat.statut === "created_sans_cadence" ? `Créé dans ProGBat (#${resultat.progbatId}), mais SANS sa cadence : relancer pour la poser.`
              : resultat.statut === "linked" ? `Lié à ProGBat (#${resultat.progbatId}).`
              : resultat.statut === "uncertain" ? "Résultat incertain : vérifier dans ProGBat avant de recommencer."
              : resultat.statut === "conflit" ? "Une synchronisation de cet ouvrage est déjà en cours ou incertaine."
              : "Échec de la synchronisation."}
          </div>
          {resultat.error && <div style={{ color: T.textSub }}>{resultat.error}</div>}
        </>
      )}
    </div>
  );
}
