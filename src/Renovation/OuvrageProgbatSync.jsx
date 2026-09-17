// src/Renovation/OuvrageProgbatSync.jsx — Bibliothèque → fiche d'un ouvrage
// Envoi d'UN ouvrage Profero vers ProGBat, sans passer par la synchronisation
// globale des Réglages. Même Edge Function, même garde-fous :
//   1. « Vérifier » prépare le plan restreint à cet ouvrage (LECTURE SEULE) ;
//   2. l'aperçu dit exactement ce qui sera fait (créer sous « Ouvrages V2 » ou
//      seulement lier un code déjà présent dans ProGBat), ou pourquoi c'est
//      impossible ;
//   3. l'écriture n'a lieu qu'après confirmation explicite, avec l'empreinte du
//      plan : si l'ouvrage a changé entre-temps, ProGBat n'est pas touché.
// Aucune structure ProGBat existante n'est modifiée ni supprimée.
import React, { useState } from "react";
import { supabase } from "../supabase";
import { FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { UploadCloud, Check, AlertTriangle, Link2, X } from "lucide-react";

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
  if (etat?.statut === "deja_lie") return [];
  if (etat?.blocages?.length) return etat.blocages;
  if (etat?.statut) return [`Statut « ${LIBELLES_STATUT[etat.statut] || etat.statut} » : à traiter depuis Réglages → Maintenance.`];
  return ["Ouvrage introuvable dans l'inventaire : relancer l'analyse depuis Réglages → Maintenance."];
}

export default function OuvrageProgbatSync({ ouvrage, T, acc, onLie }) {
  const [etape, setEtape] = useState("repos");   // repos | apercu | fait
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [apercu, setApercu] = useState(null);    // { planHash, plan, etats }
  const [resultat, setResultat] = useState(null);

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

  const verifier = async () => {
    setChargement(true); setErreur(null); setResultat(null);
    try {
      const data = await appeler({ action: "prepare", ouvrageIds: [ouvrage.id] });
      if (!data.ok) throw new Error(data.error || "Préparation impossible.");
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
        action: "sync", ouvrageIds: [ouvrage.id],
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
        {progbatId
          ? <span title={`Ouvrage lié à la structure ProGBat #${progbatId}${ouvrage.progbat_sync_at ? ` le ${new Date(ouvrage.progbat_sync_at).toLocaleDateString("fr-FR")}` : ""}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: RADIUS.pill,
                fontSize: FONT.xs.size + 1, fontWeight: 700, color: "#22c55e", background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.28)" }}>
              <Icon as={Link2} size={11}/> Sur ProGBat · #{progbatId}
            </span>
          : etape === "repos" && bouton(chargement ? "Vérification…" : "Créer sur ProGBat", verifier, { disabled: chargement })}
        {etape !== "repos" && bouton("Fermer", () => { setEtape("repos"); setApercu(null); setResultat(null); setErreur(null); }, { icone: X })}
      </div>

      {erreur && encart("#e15a5a", (
        <span><Icon as={AlertTriangle} size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>{erreur}</span>
      ))}

      {etape === "apercu" && !erreur && (
        action ? encart("#4db8ff", (
          <>
            <div style={{ fontWeight: 800, marginBottom: 3 }}>
              {action.type === "create"
                ? `Création dans ProGBat, dossier « ${apercu?.plan?.famille?.libelle || "Ouvrages V2"} »`
                : `Liaison au ProGBat existant #${action.progbatId}`}
            </div>
            {action.type === "create" ? (
              <div style={{ color: T.textSub }}>
                {action.payload?.label} · unité {action.payload?.unitCode} ·
                achat {fmtEur2(action.payload?.purchaseNetUnitPrice)} · vente {fmtEur2(action.payload?.saleNetUnitPrice)} HT · TVA {action.payload?.taxRate} %
              </div>
            ) : (
              <div style={{ color: T.textSub }}>
                {action.progbatLabel || "sans libellé"} — rien n'est créé ni modifié dans ProGBat, seul le lien est enregistré dans Profero.
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              {bouton(chargement ? "Envoi…" : (action.type === "create" ? "Confirmer la création" : "Confirmer la liaison"), envoyer, { principal: true, disabled: chargement })}
            </div>
          </>
        )) : encart(etat?.statut === "deja_lie" ? "#22c55e" : "#f59e0b", (
          <>
            <div style={{ fontWeight: 800, marginBottom: 3 }}>
              {etat?.statut === "deja_lie" ? "Rien à faire : ouvrage déjà lié à ProGBat." : "Envoi impossible pour l'instant."}
            </div>
            {raisonsHorsPlan(apercu?.plan, etat).map((r, i) => (
              <div key={i} style={{ color: T.textSub }}>• {r}</div>
            ))}
          </>
        ))
      )}

      {etape === "fait" && resultat && !erreur && encart(
        ["created", "linked"].includes(resultat.statut) ? "#22c55e" : "#f59e0b",
        <>
          <div style={{ fontWeight: 800 }}>
            <Icon as={["created", "linked"].includes(resultat.statut) ? Check : AlertTriangle} size={11} style={{ verticalAlign: -1, marginRight: 4 }}/>
            {resultat.statut === "created" ? `Créé dans ProGBat (#${resultat.progbatId}).`
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
