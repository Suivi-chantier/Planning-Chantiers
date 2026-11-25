// ─────────────────────────────────────────────────────────────────────────────
// Fiche sécurité dans l'espace ouvrier (tâche 8 du projet
// docs/projets/fiche-securite-chantier.md, spécification « Écrans §3 »).
//
// Affichée dans l'Accueil de l'ouvrier, sous chaque chantier du jour (aucune
// nouvelle page, aucun changement de src/access.js) :
//   - la fiche en lecture, tirée du CONTENU FIGÉ de la version validée en
//     cours (ce que l'ouvrier signe) : risques principaux, consignes des
//     points concernés ;
//   - « Signer l'accueil » tant qu'il n'a pas de signature valable pour la
//     version en cours (règle : securiteAccueil.mjs). Nom pré-rempli et non
//     modifiable (compte connecté), entreprise Profero ;
//   - fiche non validée : « Fiche sécurité pas encore validée », pas de bouton ;
//   - aperçu d'un compte bureau (Admin → aperçu de l'espace) : lecture seule,
//     la signature est désactivée (elle serait prise au nom du compte bureau).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "../ui";
import { ShieldCheck, ChevronDown, ChevronUp, PenLine } from "lucide-react";
import { chargerAccueilChantier, signerAccueil } from "./securiteDonnees.js";
import { etatAccueilOuvrier, lectureOuvrier, ENTREPRISE_OUVRIER } from "./securiteAccueil.js";
import SignatureFicheSecurite from "./SignatureFicheSecurite.jsx";

const VERT = "#15803d", ORANGE = "#b97a10", ROUGE = "#e15a5a", GRIS = "#5a6478";
const COULEURS = {
  signee: VERT, signee_anterieure_valable: VERT, a_signer: ORANGE, non_validee: ORANGE,
  a_mettre_a_jour: ORANGE, verrouillee: GRIS, illisible: ROUGE,
};

function Lecture({ T, lecture }) {
  if (!lecture.ok) return <div style={{ fontSize: 13, color: ROUGE, fontWeight: 600 }}>Contenu de la fiche illisible ({lecture.raison}).</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Risques principaux</div>
        {lecture.risques.length ? (
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: T.text, lineHeight: 1.45 }}>{lecture.risques.map((l, i) => <li key={i}>{l}</li>)}</ol>
        ) : <div style={{ fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>Aucun risque saisi.</div>}
      </div>
      {lecture.points.map((p) => (
        <div key={p.numero} style={{ background: T.bg, borderRadius: 10, padding: "9px 11px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{p.numero}. {p.titre}</div>
          {p.consignes.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13, color: T.text, lineHeight: 1.4 }}>{p.consignes.map((c, i) => <li key={i}>{c}</li>)}</ul>
          )}
          {p.mesures && <div style={{ fontSize: 13, color: T.textSub, marginTop: 4, whiteSpace: "pre-wrap" }}>{p.mesures}</div>}
          {!p.consignes.length && !p.mesures && <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginTop: 2 }}>Concerné, sans consigne détaillée.</div>}
        </div>
      ))}
      {lecture.nonConcernes.length > 0 && (
        <div style={{ fontSize: 12.5, color: T.textMuted }}>Non concernés : {lecture.nonConcernes.join(", ")}.</div>
      )}
    </div>
  );
}

export default function FicheSecuriteOuvrier({ chantierId, chantierNom, nomComplet = "", T, accent = "#FFC200", preview = false }) {
  const [donnees, setDonnees] = useState({ charge: false, fiche: null, versions: [], signatures: [], erreur: null });
  const [ouvert, setOuvert] = useState(false);
  const [signature, setSignature] = useState(false);
  const [message, setMessage] = useState(null);

  const charger = useCallback(() => {
    let actif = true;
    chargerAccueilChantier(chantierId).then((r) => { if (actif) setDonnees({ charge: true, ...r }); });
    return () => { actif = false; };
  }, [chantierId]);
  useEffect(charger, [charger]);

  if (!donnees.charge) return <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", margin: "4px 0 10px" }}>Fiche sécurité : chargement…</div>;

  const etat = etatAccueilOuvrier({ fiche: donnees.fiche, erreur: donnees.erreur, versions: donnees.versions, mesSignatures: donnees.signatures });
  const couleur = COULEURS[etat.etat] || GRIS;
  const lecture = etat.version ? lectureOuvrier(etat.version.contenu) : null;
  const deplie = ouvert || (etat.etat === "a_signer" && !signature);
  const acc = { accent: "#1a1f2e", border: accent, bg10: accent };

  const signer = async (v) => {
    const r = await signerAccueil({
      ficheId: donnees.fiche.id, chantierId, version: etat.version.version, empreinte: etat.version.empreinte,
      nom: nomComplet, entreprise: ENTREPRISE_OUVRIER, png: v.png, sansCompte: false, statutsPermis: ["validee"],
    });
    if (r.erreur) return `Signature non enregistrée : ${r.erreur}.`;
    setSignature(false);
    setMessage("Merci : accueil signé.");
    charger();
    return null;
  };

  return (
    <div style={{ border: `1px solid ${couleur}55`, background: `${couleur}10`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <Icon as={ShieldCheck} size={17} color={couleur} strokeWidth={2.2} style={{ marginTop: 1, flexShrink: 0 }}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>Fiche sécurité</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: couleur, marginTop: 1 }}>{etat.message}</div>
          {etat.detail && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 2 }}>{etat.detail}</div>}
          {message && <div style={{ fontSize: 12.5, color: VERT, fontWeight: 700, marginTop: 2 }}>{message}</div>}
        </div>
        {lecture && (
          <button onClick={() => setOuvert(!deplie)} aria-label={deplie ? "Replier la fiche" : "Lire la fiche"}
            style={{ border: "none", background: "transparent", color: T.textSub, cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>
            {deplie ? "Replier" : "Lire"} <Icon as={deplie ? ChevronUp : ChevronDown} size={15}/>
          </button>
        )}
      </div>

      {lecture && deplie && <div style={{ marginTop: 10 }}><Lecture T={T} lecture={lecture}/></div>}

      {etat.peutSigner && (
        preview ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: T.textMuted, fontStyle: "italic" }}>Aperçu : la signature d'accueil est désactivée (elle serait prise au nom de votre compte bureau).</div>
        ) : !String(nomComplet || "").trim() ? (
          <div style={{ marginTop: 10, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>Votre nom est introuvable dans votre profil : signature impossible, prévenez le bureau.</div>
        ) : (
          <button onClick={() => { setMessage(null); setSignature(true); }} style={{
            marginTop: 10, width: "100%", padding: "13px", border: "none", borderRadius: 12,
            background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, color: "#1a1f2e",
            fontFamily: "inherit", fontSize: 15, fontWeight: 800, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <Icon as={PenLine} size={17} strokeWidth={2.3}/> Signer l'accueil
          </button>
        )
      )}

      {signature && etat.version && (
        <SignatureFicheSecurite T={T} acc={acc} libelle={`Accueil — ${chantierNom || "chantier"}`}
          version={etat.version.version} empreinte={etat.version.empreinte}
          synthese={lecture?.risques || []}
          consignes={lecture?.ok && lecture.points.length ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Consignes</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: T.text }}>
                {lecture.points.map((p) => <li key={p.numero}><b>{p.titre}</b>{p.consignes.length ? ` : ${p.consignes.join(" ; ")}` : ""}{p.mesures ? ` — ${p.mesures}` : ""}</li>)}
              </ul>
            </div>
          ) : null}
          nomConnecte={nomComplet} nomFige entrepriseParDefaut={ENTREPRISE_OUVRIER}
          note={`Signature d'accueil sur la v${etat.version.version} de la fiche. Elle reste valable tant que les risques et consignes ne changent pas.`}
          onSigner={signer} onAnnuler={() => setSignature(false)}/>
      )}
    </div>
  );
}
