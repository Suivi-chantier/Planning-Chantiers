// ─────────────────────────────────────────────────────────────────────────────
// Écran de la fiche de préparation sécurité d'un chantier (tâche 3 du projet
// docs/projets/fiche-securite-chantier.md). Bureau, ordinateur et tablette.
// Ouvert depuis le panneau « Fiche sécurité » de la page Opération.
//
// Ordre du PDF v2 : bandeau d'identification, point 1 (intervenants), point 2
// (données de base + bâtiment en lecture), cartes 4 à 12, synthèse (point 3).
// Tâche 4 : justificatifs joints par point (ajout photo / fichier, retrait =
// archivage), signatures « établie par » et « chef d'équipe », validation avec
// la liste de ce qui manque, version figée + empreinte, « Mettre à jour ».
// Règles : securiteValidation.mjs ; contenu figé : securiteVersion.mjs.
// Tâche 6 : pré-remplissage. Chaque carte affiche le statut proposé et sa
// raison (securitePreRemplissage.mjs), recalculés à l'ouverture ; « Appliquer
// la proposition » ne fait rien sans clic et n'enlève jamais une saisie. Les
// divergences avec la fiche enregistrée sont signalées (à revoir en
// brouillon, pour information sur une fiche validée).
//
// Enregistrement automatique avec anti-rebond. L'indicateur ne dit
// « enregistré » qu'après une écriture réussie ; une écriture refusée ou en
// conflit (fiche modifiée ailleurs, plus en brouillon) reste affichée
// « erreur, non enregistré ». Une fiche qui n'est pas en brouillon, ou dont le
// contenu a une forme inattendue, s'affiche en lecture seule.
//
// Tâche 9 : un justificatif permanent valide de l'espace entreprise
// (habilitation, formation, DUERP…) est rattaché automatiquement aux points
// concernés qui l'attendent, affiché « depuis l'espace entreprise, valable
// jusqu'au … », compté par la règle de validation et figé dans la version.
//
// Toute la logique (n/12, normalisation, structure) : securiteFiche.mjs.
// Définition des points : securite/points.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FONT, RADIUS, LOTS_DEFAUT, loadLots } from "../constants";
import { Icon } from "../ui";
import { ArrowLeft, ShieldCheck, Plus, Trash2, Building2, Paperclip, Camera, PenLine, CheckCircle2, History, FileDown, Download } from "lucide-react";
import {
  POINTS_CARTES, STATUTS_POINT, pointParNumero, libelleJustificatif, libelleStatutPoint,
} from "./securite/points.js";
import {
  NB_POINTS_FICHE, NB_LIGNES_SYNTHESE, compterPointsCompletes, etatDesPoints, validerStructureFiche, modeFiche,
  formulaireFiche, contenuAEnregistrer, modifierPoint, libelleEnregistrement,
} from "./securiteFiche.js";
import {
  NON_RENSEIGNE, texteOuiNon, texteEtage, texteAvantDate, libelleReperageAmiante,
} from "./securitePastilles.js";
import {
  chargerFiche, chargerBatiment, enregistrerFiche,
  chargerJustificatifs, ajouterJustificatif, archiverJustificatif, urlJustificatif, urlImageSignature,
  chargerSignatures, chargerVersions, chargerMotifVersion, empreinteContenu,
  signerFiche, validerFicheSecurite, mettreAJourFiche, dateDuJourLocale, chargerDonneesPreRemplissage,
  chargerVersionsAvecContenu, signerAccueil, marquerAMettreAJour, chargerJustificatifsEntrepriseFiche,
  preparerDossierControle,
} from "./securiteDonnees.js";
import { affectationPersonne, nomsPlanning, texteRattache } from "./securiteEntreprise.js";
import {
  accueilParVersion, indexVersions, versionValideeCourante, quiDoitResigner, propositionsMiseAJour, preparerAMettreAJour,
  lectureOuvrier,
} from "./securiteAccueil.js";
import { synchroniserEtapeFicheSecurite } from "./securiteCycleVieDonnees.js";
import {
  SIGNATURES_REQUISES, etatValidation, justificatifsDuPoint, justificatifsRequisManquants, typesJustificatifPoint,
  preparerJustificatif, estExpire, libelleSignature, justificatifsEntrepriseRattaches,
} from "./securiteValidation.js";
import { contenuVersion, empreinteCourte, MOTIF_MIN } from "./securiteVersion.js";
import { derniereVersionPourDossier } from "./securiteDossierControle.js";
import { ACCEPT_DOCS } from "./storageChantier.js";
import SignatureFicheSecurite from "./SignatureFicheSecurite.jsx";
import { genererPdfVersion, apercuPdfBrouillon, telechargerPdfVersion } from "./securitePdfRendu.js";
import {
  proposerPreRemplissage, divergencesPreRemplissage, appliquerProposition, estampillerProposition,
  propositionDejaAppliquee, texteAidesManutention, dateFr as dateFrIso,
} from "./securitePreRemplissage.js";
import { chargerClients, libelleClient } from "./clientsDonnees.js";
import { clientEffectifId } from "./progbatAutomatisation.js";

const ANTI_REBOND_MS = 900;
const ROUGE = "#e15a5a", ORANGE = "#b97a10", VERT = "#15803d";

const nouvelId = () => {
  try { return crypto.randomUUID(); } catch { return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
};

const LIBELLES_STATUT_FICHE = { brouillon: "brouillon", validee: "validée", a_mettre_a_jour: "à mettre à jour", verrouillee: "verrouillée" };

function Carte({ T, numero, titre, objet, children, droite = null }) {
  return (
    <section style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.xl, background: T.surface, padding: "14px 16px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        {numero != null && (
          <span style={{ width: 28, height: 28, borderRadius: RADIUS.md, background: "#1a1f2e", color: "#ffc200", fontWeight: 800,
            fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{numero}</span>
        )}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 800, fontSize: FONT.md.size, color: T.text }}>{titre}</div>
          {objet && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>{objet}</div>}
        </div>
        {droite}
      </div>
      {children}
    </section>
  );
}

const LIBELLES_RAISON = { absent: "à joindre", expire: "expiré" };
const dateFr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("fr-FR") : "");
const dateHeureFr = (d) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");

/**
 * Justificatifs d'un point : attendus (requis / selon le cas), joints (ouverture
 * par URL signée, retrait = archivage), formulaire d'ajout (photo ou fichier).
 * `ctx` : { liste (null = illisible), charge, erreur, modifiable, aujourdhui,
 *           onAjouter(point, form, fichier) → erreur|null, onArchiver(j), onOuvrir(j) }
 */
function Justificatifs({ T, acc, point, ctx, styles, concerne }) {
  const [ajout, setAjout] = useState(null); // formulaire ouvert
  const [envoi, setEnvoi] = useState({ enCours: false, erreurs: [] });
  const fichierRef = useRef(null);
  const photoRef = useRef(null);
  const [fichier, setFichier] = useState(null);
  if (!point) return null;
  const joints = ctx.charge && Array.isArray(ctx.liste) ? justificatifsDuPoint(ctx.liste, point.numero) : [];
  const entOk = ctx.entreprise.charge && Array.isArray(ctx.entreprise.liste);
  const manquants = ctx.charge && Array.isArray(ctx.liste) && entOk && concerne
    ? (justificatifsRequisManquants({ reponses: ctx.reponses, justificatifs: ctx.liste, justificatifsEntreprise: ctx.entreprise.liste, aujourdhui: ctx.aujourdhui }) || []).filter((m) => m.numero === point.numero)
    : [];
  // Tâche 9 : justificatifs permanents rattachés à ce point (point concerné).
  const rattaches = entOk && concerne
    ? (justificatifsEntrepriseRattaches({ reponses: ctx.reponses, justificatifsEntreprise: ctx.entreprise.liste, aujourdhui: ctx.aujourdhui }) || []).filter((r) => r.numero === point.numero)
    : [];
  const types = typesJustificatifPoint(point);
  const ouvrirAjout = () => { setAjout({ type_code: types[0] || "autre", date_document: ctx.aujourdhui || "", expire_le: "", personne: "", entreprise_nom: "" }); setFichier(null); setEnvoi({ enCours: false, erreurs: [] }); };
  const envoyer = async () => {
    const prep = preparerJustificatif({ chantierId: ctx.chantierId, point, form: ajout, aFichier: !!fichier });
    if (!prep.ok) { setEnvoi({ enCours: false, erreurs: prep.erreurs }); return; }
    setEnvoi({ enCours: true, erreurs: [] });
    const erreur = await ctx.onAjouter(prep.ligne, fichier);
    if (erreur) { setEnvoi({ enCours: false, erreurs: [`Ajout impossible : ${erreur}. Rien n'a été enregistré.`] }); return; }
    setAjout(null); setFichier(null); setEnvoi({ enCours: false, erreurs: [] });
  };
  const petitBouton = (actif = true) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", minHeight: 36, borderRadius: RADIUS.md,
    border: `1px solid ${actif ? acc.border : T.border}`, background: actif ? acc.bg10 : "transparent", color: actif ? acc.accent : T.textMuted,
    fontWeight: 700, fontSize: 12.5, cursor: actif ? "pointer" : "default", fontFamily: "inherit" });

  return (
    <div style={{ marginTop: 12, borderTop: `1px dashed ${T.border}`, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
        <Icon as={Paperclip} size={12}/> Justificatifs
      </div>
      {point.justificatifs.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {point.justificatifs.filter((j) => j.type_code !== "aptitude_medicale").map((j) => {
            const m = manquants.find((x) => x.type_code === j.type_code);
            return (
              <span key={j.type_code} style={{ fontSize: 12, padding: "4px 10px", borderRadius: RADIUS.pill, border: `1px solid ${m ? ROUGE : T.border}`, color: T.textSub }}>
                {libelleJustificatif(j.type_code)}
                <b style={{ marginLeft: 6, fontWeight: 700, color: m ? ROUGE : j.requis ? ORANGE : T.textMuted }}>
                  {m ? `requis — ${LIBELLES_RAISON[m.raison]}` : j.requis ? "requis si concerné" : "selon le cas"}
                </b>
              </span>
            );
          })}
        </div>
      )}
      {concerne && !ctx.entreprise.charge ? (
        <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 4 }}>Espace entreprise : chargement…</div>
      ) : concerne && ctx.entreprise.erreur ? (
        <div style={{ fontSize: 12, color: ROUGE, fontWeight: 600, marginBottom: 4 }}>Espace entreprise illisible ({ctx.entreprise.erreur}) : on ne sait pas si une habilitation ou une formation permanente couvre ce point.</div>
      ) : rattaches.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
          {rattaches.map(({ justificatif: j }) => (
            <div key={`ent-${j.id}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: T.text, padding: "4px 0" }}>
              <button onClick={() => ctx.onOuvrir(j)} title="Ouvrir le document" style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textAlign: "left" }}>
                {libelleJustificatif(j.type_code)}{j.fichier_nom ? ` — ${j.fichier_nom}` : ""}
              </button>
              <span style={{ color: VERT, fontWeight: 700 }}>
                {texteRattache(j, { affectation: j.type_code === "habilitation_electrique" ? affectationPersonne(j.personne, ctx.entreprise.noms) : "sans_objet", dateFr })}
              </span>
            </div>
          ))}
        </div>
      )}
      {!ctx.charge ? (
        <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>Chargement des justificatifs…</div>
      ) : ctx.erreur ? (
        <div style={{ fontSize: 12, color: ROUGE, fontWeight: 600 }}>Justificatifs illisibles ({ctx.erreur}) : on ne sait pas lesquels sont joints.</div>
      ) : joints.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>{rattaches.length ? "Aucun document joint sur ce chantier (couvert par l'espace entreprise ci-dessus)." : "Aucun document joint à ce point."}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {joints.map((j) => {
            const expire = estExpire(j, ctx.aujourdhui);
            return (
              <div key={j.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: T.text, padding: "4px 0" }}>
                <button onClick={() => ctx.onOuvrir(j)} title="Ouvrir le document" style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", textAlign: "left" }}>
                  {libelleJustificatif(j.type_code)}{j.fichier_nom ? ` — ${j.fichier_nom}` : ""}
                </button>
                <span style={{ color: T.textMuted }}>
                  {[j.date_document ? `du ${dateFr(j.date_document)}` : "date non renseignée", j.personne, j.entreprise_nom].filter(Boolean).join(" · ")}
                </span>
                {j.expire_le && (
                  <span style={{ fontWeight: 700, color: expire ? ROUGE : T.textSub }}>{expire ? `expiré le ${dateFr(j.expire_le)}` : `valable jusqu'au ${dateFr(j.expire_le)}`}</span>
                )}
                {ctx.modifiable && (
                  <button onClick={() => ctx.onArchiver(j)} title="Retirer (le document est archivé, pas supprimé)" style={{ marginLeft: "auto", border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, borderRadius: 8, padding: "4px 9px", minHeight: 32, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                    Retirer
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ctx.modifiable && ctx.charge && !ctx.erreur && !ajout && (
        <button onClick={ouvrirAjout} style={{ ...petitBouton(), marginTop: 8 }}><Icon as={Plus} size={14}/> Ajouter un justificatif</button>
      )}
      {ajout && (
        <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, background: T.card || "transparent" }}>
          <div className="fsc-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            <div className="fsc-large" style={{ gridColumn: "span 2" }}>
              <label style={styles.label}>Type de document</label>
              <select value={ajout.type_code} disabled={envoi.enCours} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, type_code: v })); }} style={styles.input}>
                {types.map((t) => <option key={t} value={t}>{libelleJustificatif(t)}</option>)}
              </select>
            </div>
            <div><label style={styles.label}>Date du document</label><input type="date" value={ajout.date_document} disabled={envoi.enCours} style={styles.input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, date_document: v })); }}/></div>
            <div><label style={styles.label}>Expire le (facultatif)</label><input type="date" value={ajout.expire_le} disabled={envoi.enCours} style={styles.input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, expire_le: v })); }}/></div>
            <div className="fsc-large" style={{ gridColumn: "span 2" }}><label style={styles.label}>Personne concernée (facultatif)</label><input value={ajout.personne} disabled={envoi.enCours} style={styles.input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, personne: v })); }}/></div>
            <div className="fsc-large" style={{ gridColumn: "span 2" }}><label style={styles.label}>Entreprise (facultatif)</label><input value={ajout.entreprise_nom} disabled={envoi.enCours} style={styles.input} onChange={(e) => { const v = e.target.value; setAjout((a) => ({ ...a, entreprise_nom: v })); }}/></div>
          </div>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => setFichier(e.target.files?.[0] || null)}/>
          <input ref={fichierRef} type="file" accept={ACCEPT_DOCS} style={{ display: "none" }} onChange={(e) => setFichier(e.target.files?.[0] || null)}/>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={() => photoRef.current?.click()} disabled={envoi.enCours} style={petitBouton(!envoi.enCours)}><Icon as={Camera} size={14}/> Prendre une photo</button>
            <button onClick={() => fichierRef.current?.click()} disabled={envoi.enCours} style={petitBouton(!envoi.enCours)}><Icon as={Paperclip} size={14}/> Choisir un fichier</button>
            <span style={{ fontSize: 12, color: fichier ? T.text : T.textMuted, fontStyle: fichier ? "normal" : "italic" }}>{fichier ? fichier.name : "aucun fichier choisi"}</span>
          </div>
          {envoi.erreurs.length > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>{envoi.erreurs.map((m, i) => <div key={i}>{m}</div>)}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button onClick={() => setAjout(null)} disabled={envoi.enCours} style={{ ...petitBouton(false), cursor: "pointer" }}>Annuler</button>
            <button onClick={envoyer} disabled={envoi.enCours} style={petitBouton(!envoi.enCours)}>{envoi.enCours ? "Envoi…" : "Joindre le document"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Proposition automatique d'un point (tâche 6) : statut proposé et raison,
 * divergence éventuelle avec la fiche enregistrée, bouton « Appliquer ».
 * `etat` : { charge, erreur } du chargement des sources.
 */
function Proposition({ T, acc, prop, etat, divergences = [], modifiable, dejaAppliquee, onAppliquer, avecStatut = true, children = null }) {
  if (!etat.charge) return <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>Proposition automatique : chargement…</div>;
  if (!prop) return <div style={{ fontSize: 12, color: ROUGE, fontWeight: 600, marginBottom: 8 }}>Proposition automatique impossible{etat.erreur ? ` (${etat.erreur})` : ""}.</div>;
  const couleur = prop.statut_propose === "concerne" ? acc.accent : prop.statut_propose === "non_concerne" ? T.textSub : ORANGE;
  return (
    <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: RADIUS.lg, border: `1px dashed ${T.border}`, fontSize: 12.5, color: T.textSub }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <span style={{ fontWeight: 700, color: T.textMuted }}>Proposé{avecStatut ? " : " : ""}</span>
          {avecStatut && <b style={{ color: couleur }}>{libelleStatutPoint(prop.statut_propose)}</b>}
          {" — "}{prop.raison_proposition}
        </div>
        {modifiable && prop.applicable !== false && (
          <button onClick={onAppliquer} disabled={dejaAppliquee}
            title={dejaAppliquee ? "La fiche contient déjà tout ce qui est proposé" : "Recopie la proposition dans la fiche (rien de ce qui est déjà saisi n'est retiré)"}
            style={{ padding: "6px 11px", minHeight: 34, borderRadius: RADIUS.md, border: `1px solid ${dejaAppliquee ? T.border : acc.border}`,
              background: dejaAppliquee ? "transparent" : acc.bg10, color: dejaAppliquee ? T.textMuted : acc.accent, fontWeight: 700, fontSize: 12,
              cursor: dejaAppliquee ? "default" : "pointer", fontFamily: "inherit", flexShrink: 0 }}>
            {dejaAppliquee ? "Proposition appliquée" : "Appliquer la proposition"}
          </button>
        )}
      </div>
      {children}
      {divergences.map((d, i) => (
        <div key={i} style={{ marginTop: 6, fontWeight: 700, color: ORANGE }}>⚠ {d.message}</div>
      ))}
    </div>
  );
}

function ChoixStatut({ T, acc, valeur, modifiable, onChange }) {
  const v = valeur || "a_completer";
  return (
    <div role="radiogroup" aria-label="Statut du point" style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, overflow: "hidden", flexShrink: 0 }}>
      {STATUTS_POINT.map((s) => {
        const actif = v === s.id;
        const couleur = s.id === "concerne" ? acc.accent : s.id === "non_concerne" ? T.textSub : ORANGE;
        return (
          <button key={s.id} role="radio" aria-checked={actif} disabled={!modifiable} onClick={() => onChange(s.id)}
            style={{
              padding: "9px 12px", minHeight: 40, border: "none", borderRight: `1px solid ${T.border}`, fontFamily: "inherit",
              fontSize: 12.5, fontWeight: actif ? 800 : 600, cursor: modifiable ? "pointer" : "default",
              background: actif ? `color-mix(in srgb, ${couleur} 16%, transparent)` : "transparent",
              color: actif ? couleur : T.textMuted,
            }}>{s.label}</button>
        );
      })}
    </div>
  );
}

function CartePoint({ T, acc, point, reponse, modifiable, onChange, styles, ctxJustifs, proposition = null }) {
  const r = reponse && typeof reponse === "object" && !Array.isArray(reponse) ? reponse : {};
  const cases = r.cases && typeof r.cases === "object" ? r.cases : {};
  const statutInconnu = r.statut !== undefined && !STATUTS_POINT.some((s) => s.id === r.statut);
  return (
    <Carte T={T} numero={point.numero} titre={point.titre} objet={point.objet}
      droite={statutInconnu
        ? <span style={{ fontSize: 12, fontWeight: 700, color: ROUGE }}>{libelleStatutPoint(r.statut)}</span>
        : <ChoixStatut T={T} acc={acc} valeur={r.statut} modifiable={modifiable} onChange={(s) => onChange({ statut: s })}/>}>
      {proposition}
      <div className="fsc-cases" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "2px 14px", opacity: r.statut === "non_concerne" ? 0.6 : 1 }}>
        {point.cases.map((c) => (
          <label key={c.code} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 4px", minHeight: 36, cursor: modifiable ? "pointer" : "default", fontSize: 13, color: T.text }}>
            <input type="checkbox" checked={cases[c.code] === true} disabled={!modifiable}
              onChange={(e) => onChange({ case: { code: c.code, coche: e.target.checked } })}
              style={{ width: 18, height: 18, marginTop: 1, flexShrink: 0, accentColor: acc.accent }}/>
            <span>{c.libelle}</span>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={styles.label}>Mesures retenues</label>
        <textarea value={typeof r.mesures === "string" ? r.mesures : ""} disabled={!modifiable} rows={2}
          onChange={(e) => onChange({ mesures: e.target.value })} style={{ ...styles.input, resize: "vertical" }}
          placeholder={modifiable ? "Mesures prévues sur ce chantier…" : ""}/>
      </div>
      <Justificatifs T={T} acc={acc} point={point} ctx={ctxJustifs} styles={styles} concerne={r.statut === "concerne"}/>
    </Carte>
  );
}

export default function FicheSecuriteChantier({ T, acc, op, chantier, profil = null, onClose, miseAJourDemandee = false }) {
  const auteur = profil?.nom || profil?.email || null;
  const [lecture, setLecture] = useState({ charge: false, ligne: null, erreur: null });
  const [form, setForm] = useState(null);
  const [enreg, setEnreg] = useState({ etat: "enregistre", messages: [], conflit: null });
  const [batiment, setBatiment] = useState({ charge: false, ligne: null, erreur: null });
  const [clients, setClients] = useState({ charge: false, liste: [], erreur: null });
  const [lots, setLots] = useState(LOTS_DEFAUT);
  // Tâche 4
  const [ligneEnregistree, setLigneEnregistree] = useState(null); // dernière ligne lue ou écrite (base de l'empreinte)
  const [justifs, setJustifs] = useState({ charge: false, liste: null, erreur: null });
  const [justifsEnt, setJustifsEnt] = useState({ charge: false, liste: null, erreur: null }); // tâche 9
  const [sigs, setSigs] = useState({ charge: false, liste: null, erreur: null });
  const [versions, setVersions] = useState({ charge: false, liste: null, erreur: null });
  const [motif, setMotif] = useState({ charge: false, motif: null, trouve: false, erreur: null });
  const [empreinte, setEmpreinte] = useState({ valeur: null, erreur: null });
  const [signatureOuverte, setSignatureOuverte] = useState(null); // type de signature
  const [validation, setValidation] = useState({ enCours: false, erreur: null, manquants: null, avertissement: null, versionDejaFigee: false });
  const [miseAJour, setMiseAJour] = useState(null); // { motif, enCours, erreur, versionDejaFigee }
  const [messageDoc, setMessageDoc] = useState(null);
  // Tâche 5 : PDF des versions (génération en cours, erreurs par version, aperçu)
  const [pdfEtat, setPdfEtat] = useState({ enCours: null, erreurs: {}, message: null, apercu: false });
  const [dossier, setDossier] = useState({ enCours: false, erreur: null, resultat: null }); // tâche 9b
  // Tâche 6 : sources du pré-remplissage (phasage, planning, ressources, commandes)
  const [sourcesPre, setSourcesPre] = useState({ charge: false, donnees: null, erreur: null });
  // Tâche 8 : versions avec leur contenu (accueil de l'équipe), signature d'un
  // sous-traitant au bureau, passage « à mettre à jour » sur clic.
  const [versionsContenu, setVersionsContenu] = useState({ charge: false, liste: null, erreur: null });
  const [accueilOuvert, setAccueilOuvert] = useState(false);
  const [marquage, setMarquage] = useState({ enCours: false, erreur: null, avertissement: null });
  const formMajRef = useRef(null);
  const miseAJourDemandeeRef = useRef(miseAJourDemandee);
  const aujourdhui = dateDuJourLocale();

  const formRef = useRef(null);
  const baseRef = useRef(null);       // dernière ligne lue ou écrite (updated_at de référence)
  const timerRef = useRef(null);
  const enCoursRef = useRef(null);    // promesse de l'écriture en cours
  const aRefaireRef = useRef(false);
  const bloqueRef = useRef(false);    // conflit : plus d'écriture automatique
  const echecRef = useRef(false);     // dernière écriture refusée ou impossible

  const charger = useCallback(() => {
    let actif = true;
    setLecture({ charge: false, ligne: null, erreur: null });
    chargerFiche(chantier.id).then((r) => {
      if (!actif) return;
      setLecture({ charge: true, ligne: r.ligne, erreur: r.erreur || (r.ligne ? null : "aucune fiche pour ce chantier") });
      baseRef.current = r.ligne;
      setLigneEnregistree(r.ligne);
      bloqueRef.current = false;
      echecRef.current = false;
      const f = r.ligne ? formulaireFiche(r.ligne, nouvelId) : null;
      formRef.current = f;
      setForm(f);
      setEnreg({ etat: "enregistre", messages: [], conflit: null });
    });
    return () => { actif = false; };
  }, [chantier.id]);
  useEffect(charger, [charger]);

  useEffect(() => {
    let actif = true;
    chargerBatiment(op.id).then((r) => actif && setBatiment({ charge: true, ligne: r.ligne, erreur: r.erreur }));
    chargerClients().then((r) => actif && setClients({ charge: true, liste: r.clients || [], erreur: r.erreur }))
      .catch((e) => actif && setClients({ charge: true, liste: [], erreur: e?.message || String(e) }));
    loadLots().then((l) => actif && Array.isArray(l) && l.length && setLots(l)).catch(() => {});
    return () => { actif = false; };
  }, [op.id]);

  // Tâche 6 : sources des propositions, relues à chaque ouverture de la fiche.
  useEffect(() => {
    let actif = true;
    setSourcesPre({ charge: false, donnees: null, erreur: null });
    chargerDonneesPreRemplissage({ chantier, op })
      .then((d) => actif && setSourcesPre({ charge: true, donnees: d, erreur: null }))
      .catch((e) => actif && setSourcesPre({ charge: true, donnees: null, erreur: e?.message || String(e) }));
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantier.id, op.id]);

  // ── Tâche 4 : justificatifs, signatures, versions, motif de la version ──
  const ficheId = lecture.ligne?.id || null;
  const ficheVersion = lecture.ligne?.version ?? null;
  const rechargerJustifs = useCallback(() => {
    setJustifs((j) => ({ ...j, charge: false }));
    setJustifsEnt((j) => ({ ...j, charge: false }));
    return Promise.all([
      chargerJustificatifs(chantier.id).then((r) => setJustifs({ charge: true, liste: r.liste, erreur: r.erreur })),
      chargerJustificatifsEntrepriseFiche().then((r) => setJustifsEnt({ charge: true, liste: r.liste, erreur: r.erreur })),
    ]);
  }, [chantier.id]);
  const rechargerSignatures = useCallback(() => {
    if (!ficheId) return Promise.resolve();
    return Promise.all([chargerSignatures(ficheId), chargerVersions(ficheId), chargerVersionsAvecContenu(ficheId)]).then(([s1, v1, vc]) => {
      setSigs({ charge: true, liste: s1.liste, erreur: s1.erreur });
      setVersions({ charge: true, liste: v1.liste, erreur: v1.erreur });
      setVersionsContenu({ charge: true, liste: vc.liste, erreur: vc.erreur });
    });
  }, [ficheId]);
  useEffect(() => { rechargerJustifs(); }, [rechargerJustifs]);
  useEffect(() => { rechargerSignatures(); }, [rechargerSignatures, ficheVersion]);
  useEffect(() => {
    if (!ficheId || !ficheVersion) return undefined;
    let actif = true;
    setMotif({ charge: false, motif: null, trouve: false, erreur: null });
    chargerMotifVersion(chantier.id, ficheVersion).then((r) => actif && setMotif({ charge: true, ...r }));
    return () => { actif = false; };
  }, [chantier.id, ficheId, ficheVersion]);

  const mode = useMemo(() => modeFiche(lecture.ligne), [lecture.ligne]);
  const structure = useMemo(() => validerStructureFiche(lecture.ligne), [lecture.ligne]);
  const modifiable = lecture.charge && !lecture.erreur && mode.modifiable && !enreg.conflit;

  // ── Enregistrement automatique ──
  const sauver = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (bloqueRef.current || !baseRef.current) return;
    if (enCoursRef.current) { aRefaireRef.current = true; return enCoursRef.current; }
    const prep = contenuAEnregistrer(formRef.current);
    if (!prep.ok) { echecRef.current = true; setEnreg({ etat: "erreur", messages: prep.erreurs, conflit: null }); return; }
    setEnreg({ etat: "enregistrement", messages: [], conflit: null });
    const p = (async () => {
      const r = await enregistrerFiche(baseRef.current.id, prep.contenu, { updatedAt: baseRef.current.updated_at, auteur });
      enCoursRef.current = null;
      if (r.erreur) {
        echecRef.current = true;
        if (r.conflit) bloqueRef.current = true;
        setEnreg({ etat: "erreur", messages: [`Enregistrement impossible : ${r.erreur}.`], conflit: r.conflit });
        return;
      }
      baseRef.current = r.ligne;
      setLigneEnregistree(r.ligne);
      echecRef.current = false;
      if (aRefaireRef.current) { aRefaireRef.current = false; await sauver(); return; }
      if (!timerRef.current) setEnreg({ etat: "enregistre", messages: prep.avertissements, conflit: null });
    })();
    enCoursRef.current = p;
    return p;
  }, [auteur]);

  const modifier = (maj) => {
    if (!modifiable) return;
    const suivant = maj(formRef.current);
    formRef.current = suivant;
    setForm(suivant);
    setEnreg((e) => ({ ...e, etat: "en_attente" }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; sauver(); }, ANTI_REBOND_MS);
  };

  useEffect(() => {
    const avant = (e) => {
      if (timerRef.current || enCoursRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", avant);
    return () => { window.removeEventListener("beforeunload", avant); if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const fermer = async () => {
    if (timerRef.current || enCoursRef.current) await sauver();
    if (enCoursRef.current) await enCoursRef.current;
    if (echecRef.current && formRef.current && mode.modifiable) {
      if (!window.confirm("Des modifications ne sont pas enregistrées. Fermer quand même ?")) return;
    }
    onClose?.();
  };

  // ── Valeurs affichées ──
  const prep = form ? contenuAEnregistrer(form) : null;
  const contenuCompte = prep?.ok ? prep.contenu : lecture.ligne;
  const nbPoints = compterPointsCompletes(contenuCompte);
  const etatPoints = etatDesPoints(contenuCompte);

  // ── Tâche 6 : propositions (sur le contenu affiché) et divergences (avec la
  // fiche ENREGISTRÉE). Bâtiment pas encore lu = pas de proposition.
  const propositions = sourcesPre.charge && sourcesPre.donnees && batiment.charge
    ? proposerPreRemplissage({ ...sourcesPre.donnees, batiment: { ligne: batiment.ligne, erreur: batiment.erreur }, lots, fiche: contenuCompte })
    : null;
  const etatPre = { charge: sourcesPre.charge && batiment.charge, erreur: sourcesPre.erreur };
  const propositionsEnregistrees = sourcesPre.charge && sourcesPre.donnees && batiment.charge && ligneEnregistree
    ? proposerPreRemplissage({ ...sourcesPre.donnees, batiment: { ligne: batiment.ligne, erreur: batiment.erreur }, lots, fiche: ligneEnregistree })
    : null;
  const divergences = propositionsEnregistrees ? divergencesPreRemplissage({ propositions: propositionsEnregistrees, fiche: ligneEnregistree, lots }) : [];
  const divergencesDe = (numero) => divergences.filter((d) => d.numero === numero);
  const appliquer = (prop) => modifier((f) => appliquerProposition(f, prop, { auteur, maintenant: new Date().toISOString(), nouvelId }));
  const propositionDe = (numero, extra = null) => {
    const prop = propositions?.points[`p${numero}`] || null;
    return (
      <Proposition T={T} acc={acc} prop={prop} etat={etatPre} divergences={divergencesDe(numero)} modifiable={modifiable}
        avecStatut={numero > 3} dejaAppliquee={!form || !prop || propositionDejaAppliquee(form, prop)} onAppliquer={() => prop && appliquer(prop)}>
        {extra}
      </Proposition>
    );
  };
  // Détail affiché sous la proposition : quantités (8), jours isolés (9), EPI (10).
  const extraProposition = (numero) => {
    const v = propositions?.points[`p${numero}`]?.valeurs;
    if (!v) return null;
    if (numero === 8 && v.aides) return <div style={{ marginTop: 4 }}>{texteAidesManutention(v.aides)}</div>;
    if (numero === 9 && v.jours?.length) {
      return (
        <div style={{ marginTop: 4 }}>
          {v.jours.slice(0, 12).map((j) => `${dateFrIso(j.date)} ${j.personne}${j.autresSurOperation?.length ? ` (sur l'opération : ${j.autresSurOperation.join(", ")}, pas un collègue Profero reconnu)` : ""}`).join(" · ")}
          {v.jours.length > 12 ? ` · et ${v.jours.length - 12} autres jours` : ""}
        </div>
      );
    }
    if (numero === 9 && v.couverts?.length) {
      return (
        <div style={{ marginTop: 4 }}>
          Jours seuls sur le logement mais couverts sur l'opération : {v.couverts.slice(0, 6).map((j) => `${dateFrIso(j.date)} ${j.personne} (avec ${j.collegues.join(", ")})`).join(" · ")}
          {v.couverts.length > 6 ? ` · et ${v.couverts.length - 6} autres jours` : ""}
        </div>
      );
    }
    if (numero === 10 && v.epi?.length) {
      const pt = POINTS_CARTES.find((x) => x.numero === 10);
      return <div style={{ marginTop: 4 }}>EPI proposés : {v.epi.map((c) => pt.cases.find((x) => x.code === c)?.libelle || c).join(", ")}</div>;
    }
    return null;
  };
  const indic = libelleEnregistrement(mode.modifiable && !lecture.erreur ? enreg.etat : "lecture_seule");
  const couleurIndic = indic.ton === "ok" ? VERT : indic.ton === "erreur" ? ROUGE : indic.ton === "attente" ? ORANGE : T.textMuted;

  const idClient = clientEffectifId(chantier, op);
  const client = idClient ? clients.liste.find((c) => c.id === idClient) : null;
  const texteClient = !clients.charge ? "chargement…"
    : clients.erreur ? `client illisible (${clients.erreur})`
    : !idClient ? "aucun client renseigné — à saisir sur la page de l'opération"
    : client ? libelleClient(client) : "client introuvable";

  // ── Tâche 4 : contenu à figer, empreinte, état de validation ──
  // Le client figé dans la version : son libellé, ou null s'il n'y en a pas ;
  // illisible / introuvable = impossibilité (pas de signature ni de validation).
  const clientLibelle = client ? libelleClient(client) : null;
  const clientErreur = !clients.charge ? "chargement en cours" : clients.erreur ? clients.erreur : (idClient && !client ? "client introuvable" : null);
  const contexteFige = { chantier, op, clientLibelle, clientErreur };

  // Tâche 9 : justificatifs permanents rattachés à la fiche ENREGISTRÉE (ce
  // qui sera figé). Même fonction que lireContenuAFiger (securiteDonnees.js).
  const rattachesEnregistres = () => justificatifsEntrepriseRattaches({ reponses: ligneEnregistree?.reponses, justificatifsEntreprise: justifsEnt.liste, aujourdhui }) || [];

  useEffect(() => {
    let actif = true;
    setEmpreinte({ valeur: null, erreur: null });
    if (!ligneEnregistree || !batiment.charge || batiment.erreur || !justifs.charge || justifs.erreur || !justifsEnt.charge || justifsEnt.erreur || !motif.charge || motif.erreur) return undefined;
    let contenu;
    try {
      contenu = contenuVersion({ fiche: ligneEnregistree, chantier, operation: op, clientLibelle, batiment: batiment.ligne, justificatifs: justifs.liste, rattachesEntreprise: rattachesEnregistres(), motif: motif.motif });
    } catch (e) {
      setEmpreinte({ valeur: null, erreur: e?.message || String(e) });
      return undefined;
    }
    empreinteContenu(contenu)
      .then((h) => actif && setEmpreinte({ valeur: h, erreur: null }))
      .catch((e) => actif && setEmpreinte({ valeur: null, erreur: e?.message || String(e) }));
    return () => { actif = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ligneEnregistree, batiment, justifs, justifsEnt, motif, clientLibelle, op.id, op.nom, op.adresse, chantier.id, chantier.nom, aujourdhui]);

  const etat = etatValidation({
    fiche: ligneEnregistree,
    contexte: {
      adresse: op.adresse || null,
      batiment: batiment.ligne,
      batimentErreur: !batiment.charge ? "chargement en cours" : batiment.erreur,
      clientErreur,
      motifTrouve: !motif.charge ? undefined : motif.erreur ? false : motif.trouve,
    },
    justificatifs: justifs.charge ? justifs.liste : null,
    justificatifsEntreprise: justifsEnt.charge ? justifsEnt.liste : null,
    signatures: sigs.charge ? sigs.liste : null,
    empreinte: empreinte.valeur,
    aujourdhui,
  });
  const enregistrementAJour = enreg.etat === "enregistre" && !timerRef.current && !enCoursRef.current;
  const statutFiche = lecture.ligne?.statut;
  const empreintesVersions = Object.fromEntries((versions.liste || []).map((v) => [v.version, v.empreinte]));

  const ctxJustifs = {
    charge: justifs.charge, liste: justifs.liste, erreur: justifs.erreur, modifiable, aujourdhui,
    chantierId: chantier.id, reponses: form?.reponses,
    entreprise: {
      charge: justifsEnt.charge, liste: justifsEnt.liste, erreur: justifsEnt.erreur,
      // Noms du planning du chantier : mention « au planning de ce chantier » (habilitation).
      noms: sourcesPre.charge && sourcesPre.donnees?.planning && !sourcesPre.donnees.planning.erreur ? nomsPlanning(sourcesPre.donnees.planning.cellules) : null,
    },
    onAjouter: async (ligne, fichier) => {
      const r = await ajouterJustificatif({ ligne, fichier, auteur });
      if (r.erreur) return r.erreur;
      await rechargerJustifs();
      return null;
    },
    onArchiver: async (j) => {
      if (!window.confirm(`Retirer « ${libelleJustificatif(j.type_code)}${j.fichier_nom ? ` — ${j.fichier_nom}` : ""} » de la fiche ?\nLe document n'est pas supprimé : il est archivé et reste consultable dans l'historique.`)) return;
      const r = await archiverJustificatif(j.id);
      setMessageDoc(r.erreur ? `Retrait impossible : ${r.erreur}.` : null);
      await rechargerJustifs();
    },
    onOuvrir: async (j) => {
      const fenetre = window.open("", "_blank");
      const r = await urlJustificatif(j.fichier_path);
      if (r.url) { if (fenetre) fenetre.location.href = r.url; else window.location.assign(r.url); setMessageDoc(null); }
      else { fenetre?.close(); setMessageDoc(`Ouverture impossible : ${r.erreur}.`); }
    },
  };

  const ouvrirImageSignature = async (sig) => {
    const fenetre = window.open("", "_blank");
    const r = await urlImageSignature(sig.image_path);
    if (r.url) { if (fenetre) fenetre.location.href = r.url; else window.location.assign(r.url); setMessageDoc(null); }
    else { fenetre?.close(); setMessageDoc(`Ouverture impossible : ${r.erreur}.`); }
  };

  const signer = async (type, v) => {
    const r = await signerFiche({ ...contexteFige, type, nom: v.nom, entreprise: v.entreprise, pourMoi: v.pourMoi, png: v.png, empreinteAttendue: empreinte.valeur, aujourdhui });
    if (r.erreur) return `Signature non enregistrée : ${r.erreur}.`;
    setSignatureOuverte(null);
    await rechargerSignatures();
    return null;
  };

  const valider = async () => {
    if (!window.confirm(`Valider la fiche (v${lecture.ligne.version}) ?\nElle sera figée et passera en lecture seule. Pour la modifier ensuite, il faudra « Mettre à jour » avec un motif (nouvelle version, nouvelles signatures).`)) return;
    setValidation({ enCours: true, erreur: null, manquants: null, avertissement: null, versionDejaFigee: false });
    const r = await validerFicheSecurite({ ...contexteFige, auteur, aujourdhui });
    if (r.erreur) {
      setValidation({ enCours: false, erreur: `Validation impossible : ${r.erreur}.`, manquants: r.manquants || null, avertissement: null, versionDejaFigee: !!r.versionDejaFigee });
      await rechargerSignatures();
      return;
    }
    setValidation({ enCours: false, erreur: null, manquants: null, avertissement: r.avertissement || null, versionDejaFigee: false });
    // Tâche 7 : étape « Fiche sécurité validée » du cycle de vie (relue en base).
    synchroniserEtapeFicheSecurite({ chantierId: chantier.id, auteur });
    const numero = lecture.ligne.version;
    await rechargerSignatures();
    charger();
    // Tâche 5 : PDF généré et stocké automatiquement. S'il échoue, la
    // validation reste acquise : la version s'affiche « PDF non généré ».
    await genererPdf(numero);
  };

  const genererPdf = async (numero) => {
    if (!ficheId) return;
    setPdfEtat((p) => ({ ...p, enCours: numero, message: null, erreurs: { ...p.erreurs, [numero]: null } }));
    const r = await genererPdfVersion({ ficheId, version: numero });
    setPdfEtat((p) => ({ ...p, enCours: null, message: r.avertissement || null, erreurs: { ...p.erreurs, [numero]: r.erreur || null } }));
    await rechargerSignatures();
  };

  const telechargerPdf = async (v) => {
    const r = await telechargerPdfVersion({ path: v.pdf_path, chantierNom: chantier.nom, version: v.version });
    setMessageDoc(r.erreur ? `Téléchargement impossible : ${r.erreur}.` : null);
  };

  // Aperçu d'un brouillon : même contenu que celui qui serait figé (et haché).
  const apercuPossible = !!ligneEnregistree && batiment.charge && !batiment.erreur && justifs.charge && !justifs.erreur && justifsEnt.charge && !justifsEnt.erreur && motif.charge && !motif.erreur && sigs.charge && !sigs.erreur;
  const apercu = async () => {
    setPdfEtat((p) => ({ ...p, apercu: true, message: null }));
    let r;
    try {
      const contenu = contenuVersion({ fiche: ligneEnregistree, chantier, operation: op, clientLibelle, batiment: batiment.ligne, justificatifs: justifs.liste, rattachesEntreprise: rattachesEnregistres(), motif: motif.motif });
      r = await apercuPdfBrouillon({ contenu, empreinte: empreinte.valeur, signatures: sigs.liste, versions: versions.liste || [], chantierNom: chantier.nom, apercuLe: new Date().toISOString() });
    } catch (e) {
      r = { erreur: e?.message || String(e) };
    }
    setPdfEtat((p) => ({ ...p, apercu: false, message: r.erreur ? `Aperçu impossible : ${r.erreur}.` : null }));
  };

  // État du PDF d'une version : lien de téléchargement, génération en cours,
  // ou « PDF non généré » avec le bouton pour le générer (impossibilité visible).
  const pdfVersion = (v) => {
    const lien = { border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 };
    if (v.pdf_path) return <button onClick={() => telechargerPdf(v)} style={lien}><Icon as={FileDown} size={13}/> Télécharger le PDF</button>;
    if (pdfEtat.enCours === v.version) return <span style={{ color: ORANGE, fontWeight: 700 }}>Génération du PDF…</span>;
    return (
      <span style={{ color: ROUGE, fontWeight: 700 }}>
        PDF non généré{pdfEtat.erreurs[v.version] ? ` (${pdfEtat.erreurs[v.version]})` : ""} ·{" "}
        <button onClick={() => genererPdf(v.version)} disabled={pdfEtat.enCours != null} style={lien}>Générer le PDF</button>
      </span>
    );
  };

  const lancerMiseAJour = async () => {
    setMiseAJour((m) => ({ ...m, enCours: true, erreur: null }));
    const r = await mettreAJourFiche({ fiche: lecture.ligne, motif: miseAJour.motif, auteur, versionDejaFigee: !!miseAJour.versionDejaFigee });
    if (r.erreur) { setMiseAJour((m) => ({ ...m, enCours: false, erreur: `Mise à jour impossible : ${r.erreur}.` })); return; }
    setMiseAJour(null);
    setValidation({ enCours: false, erreur: null, manquants: null, avertissement: null, versionDejaFigee: false });
    synchroniserEtapeFicheSecurite({ chantierId: chantier.id, auteur }); // tâche 7 : étape du cycle de vie
    charger();
  };

  // ── Tâche 9b : « Dossier de contrôle » (ZIP) ──
  // Bouton actif seulement s'il existe une version validée avec son PDF ;
  // sinon désactivé avec la raison. Fichiers illisibles : listés dans
  // A_LIRE.txt (dans le ZIP) ET affichés ici, jamais d'échec silencieux.
  const etatDossier = !versionsContenu.charge ? { ok: false, raison: "chargement des versions…" }
    : versionsContenu.erreur ? { ok: false, raison: `versions illisibles (${versionsContenu.erreur})` }
    : derniereVersionPourDossier(versionsContenu.liste);
  const telechargerDossier = async () => {
    setDossier({ enCours: true, erreur: null, resultat: null });
    const r = await preparerDossierControle({ ficheId, chantierNom: chantier.nom, estAdmin: profil?.role === "admin" });
    if (r.erreur) { setDossier({ enCours: false, erreur: r.erreur, resultat: null }); return; }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url; a.download = r.nom; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setDossier({ enCours: false, erreur: null, resultat: r });
  };
  const blocDossierControle = () => (
    <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.border}`, fontSize: 12.5, color: T.textSub }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={telechargerDossier} disabled={!etatDossier.ok || dossier.enCours}
          title={etatDossier.ok ? "ZIP : PDF de la dernière version validée et ses justificatifs" : etatDossier.raison}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", minHeight: 38, borderRadius: RADIUS.md,
            border: `1px solid ${etatDossier.ok ? acc.border : T.border}`, background: etatDossier.ok ? acc.bg10 : "transparent",
            color: etatDossier.ok ? acc.accent : T.textMuted, fontWeight: 700, fontSize: 13, cursor: etatDossier.ok && !dossier.enCours ? "pointer" : "default", fontFamily: "inherit" }}>
          <Icon as={Download} size={15}/> {dossier.enCours ? "Préparation du dossier…" : "Dossier de contrôle"}
        </button>
        <span>
          {etatDossier.ok
            ? `PDF de la v${etatDossier.version.version} validée et ses justificatifs (chantier et espace entreprise)${profil?.role === "admin" ? ", aptitudes médicales comprises (administrateur)" : ""}, en un fichier ZIP.`
            : `Indisponible : ${etatDossier.raison}.`}
        </span>
      </div>
      {dossier.erreur && <div style={{ marginTop: 6, color: ROUGE, fontWeight: 600 }}>Dossier non préparé : {dossier.erreur}.</div>}
      {dossier.resultat && (dossier.resultat.manquants.length === 0 ? (
        <div style={{ marginTop: 6, color: VERT, fontWeight: 600 }}>Dossier téléchargé : {dossier.resultat.nbDocuments} document{dossier.resultat.nbDocuments > 1 ? "s" : ""} (v{dossier.resultat.version}).</div>
      ) : (
        <div style={{ marginTop: 6, color: ROUGE, fontWeight: 600 }}>
          Dossier téléchargé INCOMPLET : {dossier.resultat.manquants.length} document{dossier.resultat.manquants.length > 1 ? "s" : ""} illisible{dossier.resultat.manquants.length > 1 ? "s" : ""}, listé{dossier.resultat.manquants.length > 1 ? "s" : ""} dans A_LIRE.txt :
          <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{dossier.resultat.manquants.map((m, i) => <li key={i}>{m.libelle} — {m.raison}</li>)}</ul>
        </div>
      ))}
    </div>
  );

  // ── Tâche 8 : accueil de l'équipe (par version) et mise à jour proposée ──
  const idxVersions = indexVersions(versionsContenu.liste || []);
  const versionCourante = versionValideeCourante(lecture.ligne, idxVersions);
  const groupesAccueil = accueilParVersion(sigs.liste || [], { versionCourante, versions: idxVersions });
  const resignature = (() => {
    const v = lecture.ligne?.version;
    if (!v || v < 2 || !idxVersions[v] || !idxVersions[v - 1]) return null;
    return quiDoitResigner({ contenuSigne: idxVersions[v - 1].contenu, contenuCourant: idxVersions[v].contenu });
  })();
  const propMaj = sourcesPre.charge && sourcesPre.donnees && batiment.charge && justifs.charge && justifsEnt.charge && ligneEnregistree
    ? propositionsMiseAJour({
      fiche: ligneEnregistree, lots, aujourdhui, justificatifs: justifs.erreur ? null : justifs.liste,
      justificatifsEntreprise: !justifsEnt.charge || justifsEnt.erreur ? null : justifsEnt.liste,
      sources: { ...sourcesPre.donnees, batiment: { ligne: batiment.ligne, erreur: batiment.erreur } },
    })
    : null;
  const ouvrirMiseAJour = (motifPropose = "") => {
    setMiseAJour({ motif: motifPropose, enCours: false, erreur: null, versionDejaFigee: false });
    setTimeout(() => formMajRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 50);
  };
  // Ouverture depuis le panneau de l'opération avec « Mettre à jour » : le
  // formulaire s'ouvre avec le motif proposé (modifiable), rien n'est écrit.
  useEffect(() => {
    if (!miseAJourDemandeeRef.current || !propMaj || !["validee", "a_mettre_a_jour"].includes(lecture.ligne?.statut)) return;
    miseAJourDemandeeRef.current = false;
    ouvrirMiseAJour(propMaj.motif);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propMaj?.motif, lecture.ligne?.statut]);
  const prepMarquage = propMaj?.raisons.length ? preparerAMettreAJour({ fiche: lecture.ligne, chantier, motif: propMaj.motif, auteur }) : null;
  const marquer = async () => {
    if (!prepMarquage?.ok) return;
    if (!window.confirm(`Marquer la fiche v${lecture.ligne.version} « à mettre à jour » ?\n\nLe chantier continue. La fiche reste valable en lecture et au PDF, mais tant que la nouvelle version n'est pas validée, les ouvriers ne peuvent plus signer l'accueil depuis leur téléphone (la base n'accepte leur signature que sur une fiche validée). L'accueil d'un sous-traitant reste possible ici.`)) return;
    setMarquage({ enCours: true, erreur: null, avertissement: null });
    const r = await marquerAMettreAJour({ fiche: lecture.ligne, prep: prepMarquage });
    setMarquage({ enCours: false, erreur: r.erreur ? `Passage impossible : ${r.erreur}.` : null, avertissement: r.avertissement || null });
    if (!r.erreur) { synchroniserEtapeFicheSecurite({ chantierId: chantier.id, auteur }); charger(); }
  };
  const signerAccueilSousTraitant = async (v) => {
    const r = await signerAccueil({
      ficheId: lecture.ligne.id, chantierId: chantier.id, version: versionCourante.version, empreinte: versionCourante.empreinte,
      nom: v.nom, entreprise: v.entreprise, png: v.png, sansCompte: true, statutsPermis: ["validee", "a_mettre_a_jour"],
    });
    if (r.erreur) return `Signature non enregistrée : ${r.erreur}.`;
    setAccueilOuvert(false);
    await rechargerSignatures();
    return null;
  };

  const styles = {
    label: { fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, marginBottom: 4, display: "block" },
    input: {
      width: "100%", boxSizing: "border-box", padding: "9px 10px", minHeight: 38, borderRadius: 8, border: `1px solid ${T.border}`,
      background: T.inputBg || T.surface, color: T.text, fontFamily: "inherit", fontSize: 13.5, outline: "none",
    },
    lecture: { fontSize: 13.5, color: T.text, fontWeight: 600 },
  };
  const champ = (cle) => ({
    value: form?.donnees?.[cle] ?? "", disabled: !modifiable, style: styles.input,
    onChange: (e) => { const v = e.target.value; modifier((f) => ({ ...f, donnees: { ...f.donnees, [cle]: v } })); },
  });

  const p1 = pointParNumero(1), p2 = pointParNumero(2), p3 = pointParNumero(3);
  const b = batiment.ligne;
  const lotsInconnus = (form?.donnees?.lots || []).filter((id) => !lots.some((l) => l.id === id));

  return (
    <div role="dialog" aria-label={`Fiche sécurité — ${chantier.nom}`} style={{ position: "fixed", inset: 0, zIndex: 810, background: T.bg || T.surface, display: "flex", flexDirection: "column" }}>
      <style>{`
        @media(max-width:820px) { .fsc-grille { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }
        @media(max-width:600px) { .fsc-grille, .fsc-cases, .fsc-entreprise { grid-template-columns: 1fr !important; } .fsc-large { grid-column: auto !important; } }
      `}</style>

      {/* ── Barre du haut : retour, titre, indicateur ── */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
        <button onClick={fermer} style={{
          display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", minHeight: 40,
          borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent",
          color: T.textSub, fontWeight: 700, fontSize: FONT.sm.size, cursor: "pointer", fontFamily: "inherit",
        }}><Icon as={ArrowLeft} size={15}/> Opération</button>
        <Icon as={ShieldCheck} size={18} color={acc.accent}/>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontWeight: 800, fontSize: FONT.lg.size, color: T.text }}>Fiche sécurité — {chantier.nom}</div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{op.nom}</div>
        </div>
        <span aria-live="polite" style={{ fontSize: 12.5, fontWeight: 700, color: couleurIndic }}>{indic.texte}</span>
      </div>

      <div style={{ overflowY: "auto", flex: 1 }}>
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "16px 16px 40px" }}>
          {!lecture.charge ? (
            <div style={{ color: T.textMuted, fontStyle: "italic" }}>Chargement de la fiche…</div>
          ) : lecture.erreur ? (
            <div style={{ color: ROUGE, fontWeight: 600 }}>
              Fiche illisible ({lecture.erreur}).{" "}
              <button onClick={charger} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Réessayer</button>
            </div>
          ) : (
            <>
              {/* Messages : lecture seule, structure, erreurs d'enregistrement */}
              {!mode.modifiable && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: "rgba(91,106,138,.12)", border: "1px solid rgba(91,106,138,.4)", color: T.textSub }}>
                  {mode.raison}
                </div>
              )}
              {[...structure.bloquantes, ...structure.avertissements].length > 0 && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.45)", color: ORANGE }}>
                  {[...structure.bloquantes, ...structure.avertissements].map((m, i) => <div key={i}>{m}</div>)}
                </div>
              )}
              {enreg.etat === "erreur" && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: "rgba(225,90,90,.12)", border: "1px solid rgba(225,90,90,.4)", color: ROUGE }}>
                  {enreg.messages.map((m, i) => <div key={i}>{m}</div>)}
                  {enreg.conflit ? (
                    <div style={{ marginTop: 6 }}>
                      Vos dernières modifications ne sont pas enregistrées (elles restent affichées).{" "}
                      <button onClick={() => { if (window.confirm("Recharger la fiche enregistrée ? Les modifications affichées non enregistrées seront perdues.")) charger(); }}
                        style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Recharger la fiche</button>
                    </div>
                  ) : (
                    <button onClick={() => sauver()} style={{ marginTop: 6, border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>Réessayer l'enregistrement</button>
                  )}
                </div>
              )}
              {lecture.ligne && blocDossierControle()}
              {messageDoc && (
                <div style={{ marginBottom: 12, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>{messageDoc}</div>
              )}
              {divergences.length > 0 && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5,
                  background: statutFiche === "brouillon" ? "rgba(245,166,35,.12)" : "rgba(91,106,138,.10)",
                  border: `1px solid ${statutFiche === "brouillon" ? "rgba(245,166,35,.45)" : "rgba(91,106,138,.4)"}`, color: T.text }}>
                  <div style={{ fontWeight: 800, marginBottom: 4, color: statutFiche === "brouillon" ? ORANGE : T.textSub }}>
                    {statutFiche === "brouillon"
                      ? "Les données du chantier ont changé depuis les réponses enregistrées : à revoir"
                      : "Pour information : les données du chantier ne correspondent plus à cette version (aucune modification faite ; « Mettre à jour » pour en tenir compte)"}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>{divergences.map((d, i) => <li key={i}>Point {d.numero} — {d.message}</li>)}</ul>
                </div>
              )}
              {/* Tâche 8 : mise à jour proposée (fiche validée ou à mettre à jour) — rien n'est écrit sans clic. */}
              {propMaj?.applicable && (propMaj.raisons.length > 0 || propMaj.impossibles.length > 0) && (
                <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, background: "rgba(245,166,35,.12)", border: "1px solid rgba(245,166,35,.45)", color: T.text }}>
                  {propMaj.raisons.length > 0 && (
                    <>
                      <div style={{ fontWeight: 800, marginBottom: 4, color: ORANGE }}>Mise à jour proposée :</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>{propMaj.raisons.map((x, i) => <li key={i}>{x.message}</li>)}</ul>
                    </>
                  )}
                  {propMaj.impossibles.map((m, i) => <div key={`i${i}`} style={{ marginTop: 4, color: ROUGE, fontWeight: 600 }}>Non vérifié : {m}.</div>)}
                  {propMaj.raisons.length > 0 && (
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                      {!miseAJour && (
                        <button onClick={() => ouvrirMiseAJour(propMaj.motif)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                          <Icon as={PenLine} size={14}/> Mettre à jour
                        </button>
                      )}
                      {prepMarquage?.ok && (
                        <button onClick={marquer} disabled={marquage.enCours} title="Le chantier continue ; la fiche est signalée « à mettre à jour » jusqu'à la validation de la version suivante."
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                          {marquage.enCours ? "Enregistrement…" : "Marquer « à mettre à jour »"}
                        </button>
                      )}
                    </div>
                  )}
                  {marquage.erreur && <div style={{ marginTop: 6, color: ROUGE, fontWeight: 600 }}>{marquage.erreur}</div>}
                  {marquage.avertissement && <div style={{ marginTop: 6, color: ORANGE, fontWeight: 600 }}>{marquage.avertissement}</div>}
                </div>
              )}
              {enreg.etat === "enregistre" && enreg.messages.length > 0 && (
                <div style={{ marginBottom: 12, fontSize: 12.5, color: ORANGE }}>{enreg.messages.map((m, i) => <div key={i}>{m}</div>)}</div>
              )}

              {/* ── Bandeau d'identification ── */}
              <section style={{ borderRadius: RADIUS.xl, background: "#1a1f2e", color: "#fff", padding: "16px 18px", marginBottom: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#ffc200", fontWeight: 800 }}>Fiche de préparation sécurité chantier</div>
                <div style={{ fontSize: FONT.xl.size, fontWeight: 800, marginTop: 4 }}>{chantier.nom}</div>
                <div className="fsc-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12, fontSize: 12.5 }}>
                  {[
                    ["Opération", op.nom],
                    ["Adresse", op.adresse || NON_RENSEIGNE],
                    ["Fiche", `${LIBELLES_STATUT_FICHE[lecture.ligne.statut] || `statut inconnu (${lecture.ligne.statut})`} · v${lecture.ligne.version ?? "?"}`],
                    ["Points renseignés", nbPoints === null ? `?/${NB_POINTS_FICHE}` : `${nbPoints}/${NB_POINTS_FICHE}`],
                  ].map(([k, v]) => (
                    <div key={k}><div style={{ color: "#9aa5c0", fontSize: 11 }}>{k}</div><div style={{ fontWeight: 700 }}>{v}</div></div>
                  ))}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 12 }} aria-label="Points complétés">
                  {etatPoints.map((p) => (
                    <span key={p.numero} title={`${p.numero}. ${p.titre} — ${p.complete ? "complété" : "à compléter"}`} style={{
                      minWidth: 26, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: p.complete ? "#ffc200" : "transparent", color: p.complete ? "#1a1f2e" : "#9aa5c0", border: `1px solid ${p.complete ? "#ffc200" : "#4a5568"}`,
                    }}>{p.numero}</span>
                  ))}
                </div>
                {statutFiche === "brouillon" && (
                  <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: etat.peutValider ? "#86efac" : "#ffc200" }}>
                    {etat.resume} — détail dans « Signatures et validation », en bas de la fiche.
                  </div>
                )}
              </section>

              {/* ── Point 1 : intervenants ── */}
              <Carte T={T} numero={1} titre={p1.titre} objet={p1.objet}>
                {propositionDe(1, propositions?.points.p1.valeurs.entreprises?.length ? (
                  <div style={{ marginTop: 4 }}>Entreprises proposées : {propositions.points.p1.valeurs.entreprises.map((e) => e.nom).join(", ")}
                    {propositions.points.p1.valeurs.personnes?.length ? ` · personnes de Profero au planning : ${propositions.points.p1.valeurs.personnes.join(", ")}` : ""}</div>
                ) : null)}
                <div className="fsc-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                  <div>
                    <label style={styles.label}>Responsable du chantier</label>
                    <input value={form.responsable.nom} disabled={!modifiable} style={styles.input} placeholder={modifiable ? "Nom" : ""}
                      onChange={(e) => { const v = e.target.value; modifier((f) => ({ ...f, responsable: { ...f.responsable, nom: v } })); }}/>
                  </div>
                  <div>
                    <label style={styles.label}>Téléphone du responsable</label>
                    <input value={form.responsable.telephone} disabled={!modifiable} style={styles.input} inputMode="tel"
                      onChange={(e) => { const v = e.target.value; modifier((f) => ({ ...f, responsable: { ...f.responsable, telephone: v } })); }}/>
                  </div>
                  <div>
                    <label style={styles.label}>Client</label>
                    <div style={styles.lecture}>{texteClient}</div>
                  </div>
                  <div>
                    <label style={styles.label}>Adresse du chantier</label>
                    <div style={styles.lecture}>{op.adresse || `${NON_RENSEIGNE} — à saisir sur l'opération`}</div>
                  </div>
                </div>

                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 0.6, textTransform: "uppercase", margin: "14px 0 6px" }}>Entreprises intervenantes</div>
                {form.entreprises.length === 0 && (
                  <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginBottom: 6 }}>Aucune entreprise saisie.</div>
                )}
                {form.entreprises.map((e, i) => (
                  <div key={e.id} className="fsc-entreprise" style={{ display: "grid", gridTemplateColumns: "1.3fr 1.2fr 1fr 1fr auto", gap: 8, marginBottom: 8, alignItems: "end" }}>
                    {[["nom", "Entreprise"], ["activite", "Lots / activité"], ["contact", "Contact"], ["telephone", "Téléphone"]].map(([k, lib]) => (
                      <div key={k}>
                        {i === 0 && <label style={styles.label}>{lib}</label>}
                        <input value={e[k]} disabled={!modifiable} style={styles.input} aria-label={lib} placeholder={i > 0 ? lib : ""}
                          onChange={(ev) => { const v = ev.target.value; modifier((f) => ({ ...f, entreprises: f.entreprises.map((x) => (x.id === e.id ? { ...x, [k]: v } : x)) })); }}/>
                      </div>
                    ))}
                    {modifiable ? (
                      <button title="Retirer cette entreprise" onClick={() => modifier((f) => ({ ...f, entreprises: f.entreprises.filter((x) => x.id !== e.id) }))}
                        style={{ minHeight: 38, padding: "0 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMuted, cursor: "pointer" }}>
                        <Icon as={Trash2} size={15}/>
                      </button>
                    ) : <span/>}
                  </div>
                ))}
                {modifiable && (
                  <button onClick={() => modifier((f) => ({ ...f, entreprises: [...f.entreprises, { id: nouvelId(), nom: "", activite: "", contact: "", telephone: "" }] }))}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit" }}>
                    <Icon as={Plus} size={14}/> Ajouter une entreprise
                  </button>
                )}
                <Justificatifs T={T} acc={acc} point={p1} ctx={ctxJustifs} styles={styles} concerne/>
              </Carte>

              {/* ── Point 2 : données de base ── */}
              <Carte T={T} numero={2} titre={p2.titre} objet={p2.objet}>
                {propositionDe(2)}
                <label style={styles.label}>Lots prévus</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {[...lots.map((l) => ({ id: l.id, label: l.label })), ...lotsInconnus.map((id) => ({ id, label: `lot inconnu (${id})` }))].map((l) => {
                    const coche = form.donnees.lots.includes(l.id);
                    return (
                      <label key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 11px", minHeight: 36, boxSizing: "border-box", borderRadius: RADIUS.pill,
                        border: `1px solid ${coche ? acc.border : T.border}`, background: coche ? acc.bg10 : "transparent", fontSize: 12.5, color: coche ? acc.accent : T.textSub, fontWeight: 600, cursor: modifiable ? "pointer" : "default" }}>
                        <input type="checkbox" checked={coche} disabled={!modifiable} style={{ accentColor: acc.accent }}
                          onChange={(e) => { const ok = e.target.checked; modifier((f) => ({ ...f, donnees: { ...f.donnees, lots: ok ? [...f.donnees.lots, l.id] : f.donnees.lots.filter((x) => x !== l.id) } })); }}/>
                        {l.label}
                      </label>
                    );
                  })}
                </div>
                <div className="fsc-grille" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                  <div><label style={styles.label}>Début prévu</label><input type="date" {...champ("date_debut")}/></div>
                  <div><label style={styles.label}>Fin prévue</label><input type="date" {...champ("date_fin")}/></div>
                  <div><label style={styles.label}>Dépose des sanitaires</label><input type="date" {...champ("date_depose_sanitaires")}/></div>
                  <div><label style={styles.label}>Effectif maximum simultané</label><input type="number" min={1} max={500} step={1} inputMode="numeric" placeholder={NON_RENSEIGNE} {...champ("effectif_max")}/></div>
                  <div>
                    <label style={styles.label}>Logement occupé pendant les travaux</label>
                    <select {...champ("site_occupe")}>
                      <option value="">{NON_RENSEIGNE}</option><option value="oui">oui</option><option value="non">non</option>
                    </select>
                  </div>
                  <div className="fsc-large" style={{ gridColumn: "span 3" }}>
                    <label style={styles.label}>Accès, stationnement, livraisons</label>
                    <input {...champ("acces")}/>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={styles.label}>Observations</label>
                    <textarea rows={2} {...champ("observations")} style={{ ...styles.input, resize: "vertical" }}/>
                  </div>
                </div>

                {/* Bâtiment : saisi sur l'opération, repris ici en lecture */}
                <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: RADIUS.lg, border: `1px dashed ${T.border}`, background: T.card }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                    <Icon as={Building2} size={14} color={acc.accent}/>
                    <span style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, letterSpacing: 0.6, textTransform: "uppercase", flex: 1 }}>Bâtiment (commun à l'opération)</span>
                    <button onClick={fermer} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", fontSize: 12.5 }}>
                      Modifier dans le bloc Bâtiment de l'opération
                    </button>
                  </div>
                  {!batiment.charge ? (
                    <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic" }}>Chargement…</div>
                  ) : batiment.erreur ? (
                    <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>Données du bâtiment illisibles ({batiment.erreur}).</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", fontSize: 12.5, color: T.textSub }}>
                      {!b && <span style={{ fontStyle: "italic", color: ORANGE, width: "100%" }}>Rien n'a encore été saisi pour ce bâtiment.</span>}
                      <span>Permis de construire : <b style={{ color: T.text }}>{b?.date_permis_construire ? new Date(`${b.date_permis_construire}T00:00:00`).toLocaleDateString("fr-FR") : NON_RENSEIGNE}</b></span>
                      <span>Avant le 1er juillet 1997 : <b style={{ color: T.text }}>{texteAvantDate(b?.avant_1997, b?.date_permis_construire)}</b></span>
                      <span>Avant 1949 : <b style={{ color: T.text }}>{texteAvantDate(b?.avant_1949, b?.date_permis_construire)}</b></span>
                      <span>Copropriété : <b style={{ color: T.text }}>{texteOuiNon(b?.copropriete)}</b></span>
                      <span>Étage : <b style={{ color: T.text }}>{texteEtage(b?.etage)}</b></span>
                      <span>Ascenseur utilisable : <b style={{ color: T.text }}>{texteOuiNon(b?.ascenseur_utilisable)}</b></span>
                      <span>Repérage amiante : <b style={{ color: T.text }}>{b ? libelleReperageAmiante(b.reperage_amiante_statut) : NON_RENSEIGNE}</b></span>
                      {b?.notes && <span style={{ width: "100%" }}>Notes : {b.notes}</span>}
                    </div>
                  )}
                </div>
                <Justificatifs T={T} acc={acc} point={p2} ctx={ctxJustifs} styles={styles} concerne/>
              </Carte>

              {/* ── Points 4 à 12 ── */}
              {POINTS_CARTES.map((p) => (
                <CartePoint key={p.cle} T={T} acc={acc} point={p} reponse={form.reponses[p.cle]} modifiable={modifiable} styles={styles} ctxJustifs={ctxJustifs}
                  proposition={propositionDe(p.numero, extraProposition(p.numero))}
                  onChange={(chg) => modifier((f) => {
                    const g = modifierPoint(f, p.cle, chg, { auteur, maintenant: new Date().toISOString() });
                    // Un choix de statut garde la trace de la proposition vue à ce moment-là.
                    return chg.statut !== undefined ? estampillerProposition(g, p.cle, propositions?.points[p.cle]) : g;
                  })}/>
              ))}

              {/* ── Point 3 : synthèse des risques ── */}
              <Carte T={T} numero={3} titre={p3.titre} objet={p3.objet}>
                {propositionDe(3, propositions?.points.p3.valeurs.risques?.length ? (
                  <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>{propositions.points.p3.valeurs.risques.map((r, i) => <li key={i}>{r}</li>)}</ol>
                ) : null)}
                {Array.from({ length: Math.max(NB_LIGNES_SYNTHESE, form.synthese.length) }).map((_, i) => {
                  const l = form.synthese[i];
                  if (l !== undefined && typeof l !== "string") {
                    return <div key={i} style={{ fontSize: 12.5, color: T.textMuted, marginBottom: 8 }}>Ligne {i + 1} : forme inattendue, conservée telle quelle.</div>;
                  }
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontWeight: 800, color: T.textMuted, width: 16 }}>{i + 1}.</span>
                      <input value={l || ""} disabled={!modifiable} style={styles.input}
                        placeholder={modifiable ? (i === 0 ? "Risque principal et consigne (ex. : chute de hauteur — PIRL obligatoire)" : "Risque suivant") : ""}
                        onChange={(e) => { const v = e.target.value; modifier((f) => { const s = [...f.synthese]; while (s.length <= i) s.push(""); s[i] = v; return { ...f, synthese: s }; }); }}/>
                    </div>
                  );
                })}
                <Justificatifs T={T} acc={acc} point={p3} ctx={ctxJustifs} styles={styles} concerne/>
              </Carte>

              {/* ── Signatures et validation (tâche 4) ── */}
              <Carte T={T} numero={null} titre="Signatures et validation"
                objet="La signature se fait en dernier : toute modification de la fiche après une signature demande de signer à nouveau.">
                {statutFiche === "brouillon" ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: etat.peutValider ? VERT : ORANGE, marginBottom: 4 }}>{etat.resume}</div>
                    <div style={{ fontSize: 11.5, color: T.textMuted, marginBottom: 10 }}>
                      Le chiffre « n/12 » (bandeau et pastille) compte un point dès qu'il a quelque chose. Pour valider, chaque point doit être complet,
                      les justificatifs requis joints et non expirés, la condition amiante remplie, puis les deux signatures faites sur le contenu actuel.
                    </div>
                    {etat.nbManquants > 0 && (
                      <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 12.5, background: "rgba(245,166,35,.10)", border: "1px solid rgba(245,166,35,.4)", color: T.text }}>
                        <div style={{ fontWeight: 800, marginBottom: 4 }}>Ce qui manque pour valider</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {etat.bloquants.map((m, i) => <li key={`b${i}`} style={{ color: ROUGE, fontWeight: 600 }}>{m}</li>)}
                          {etat.pointsIncomplets.map((p) => <li key={`p${p.numero}`}>Point {p.numero} — {p.titre} : {p.manquants.join(", ")}</li>)}
                          {etat.justificatifsManquants.map((j) => <li key={`j${j.numero}${j.type_code}`}>Point {j.numero} : {j.libelle} ({j.raison === "expire" ? "expiré" : "à joindre"})</li>)}
                          {etat.signaturesManquantes.map((m, i) => <li key={`s${i}`}>{m}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, fontSize: 13, background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.4)", color: T.text }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
                      <Icon as={CheckCircle2} size={16} color={VERT}/>
                      {statutFiche === "validee" ? `Fiche validée — v${lecture.ligne.version}` : `Fiche ${LIBELLES_STATUT_FICHE[statutFiche] || statutFiche} — v${lecture.ligne.version}`}
                    </div>
                    {lecture.ligne.validee_le && (
                      <div style={{ marginTop: 4, color: T.textSub }}>
                        Validée le {dateHeureFr(lecture.ligne.validee_le)}{lecture.ligne.validee_par ? ` par ${lecture.ligne.validee_par}` : ""}
                        {empreintesVersions[lecture.ligne.version] ? ` · empreinte ${empreinteCourte(empreintesVersions[lecture.ligne.version])}…` : ""}
                      </div>
                    )}
                    {versions.charge && !versions.erreur && statutFiche === "validee" && !empreintesVersions[lecture.ligne.version] && (
                      <div style={{ marginTop: 4, color: ROUGE, fontWeight: 600 }}>Version figée introuvable pour la v{lecture.ligne.version}.</div>
                    )}
                    {(versions.liste || []).filter((v) => v.version === lecture.ligne.version).map((v) => (
                      <div key={v.id} style={{ marginTop: 6, fontSize: 12.5 }}>{pdfVersion(v)}</div>
                    ))}
                  </div>
                )}

                {/* Signatures requises de la version en cours */}
                {sigs.charge && sigs.erreur ? (
                  <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600, marginBottom: 10 }}>Signatures illisibles ({sigs.erreur}).</div>
                ) : (
                  <div className="fsc-grille" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
                    {etat.signatures.map((sg) => {
                      const sigVersion = statutFiche !== "brouillon"
                        ? (sigs.liste || []).filter((x) => x.type === sg.type && x.version === lecture.ligne.version && x.empreinte_version === empreintesVersions[lecture.ligne.version]).slice(-1)[0] || null
                        : sg.signature;
                      const signee = statutFiche !== "brouillon" ? !!sigVersion : sg.etat === "signee";
                      const couleur = signee ? VERT : sg.etat === "contenu_modifie" && statutFiche === "brouillon" ? ROUGE : ORANGE;
                      return (
                        <div key={sg.type} style={{ border: `1px solid ${T.border}`, borderRadius: RADIUS.lg, padding: "10px 12px" }}>
                          <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{sg.libelle}</div>
                          {!sigs.charge ? (
                            <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginTop: 4 }}>Chargement…</div>
                          ) : sigVersion ? (
                            <div style={{ marginTop: 4, fontSize: 13, color: T.text }}>
                              <b>{sigVersion.signataire_nom}</b>{sigVersion.signataire_entreprise ? ` — ${sigVersion.signataire_entreprise}` : ""}
                              <div style={{ fontSize: 12, color: T.textMuted }}>le {dateHeureFr(sigVersion.signe_le)} ·{" "}
                                <button onClick={() => ouvrirImageSignature(sigVersion)} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", fontSize: 12 }}>voir la signature</button>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: couleur }}>
                                {signee ? "valable pour cette version" : "la fiche a changé depuis : à signer de nouveau"}
                              </div>
                            </div>
                          ) : (
                            <div style={{ marginTop: 4, fontSize: 12.5, color: couleur, fontWeight: 700 }}>{statutFiche === "brouillon" ? "à signer" : "non signée sur cette version"}</div>
                          )}
                          {statutFiche === "brouillon" && modifiable && !signee && (
                            <button onClick={() => setSignatureOuverte(sg.type)} disabled={!etat.peutSigner || !enregistrementAJour}
                              title={!etat.peutSigner ? "La fiche doit être complète avant de signer" : !enregistrementAJour ? "Enregistrement en cours" : undefined}
                              style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", minHeight: 40, borderRadius: RADIUS.md,
                                border: `1px solid ${etat.peutSigner && enregistrementAJour ? acc.border : T.border}`, background: etat.peutSigner && enregistrementAJour ? acc.bg10 : "transparent",
                                color: etat.peutSigner && enregistrementAJour ? acc.accent : T.textMuted, fontWeight: 700, fontSize: 12.5, cursor: etat.peutSigner && enregistrementAJour ? "pointer" : "default", fontFamily: "inherit" }}>
                              <Icon as={PenLine} size={14}/> Signer
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {statutFiche === "brouillon" && modifiable && !etat.peutSigner && etat.contenuComplet === false && (
                  <div style={{ fontSize: 11.5, color: T.textMuted, fontStyle: "italic", marginBottom: 10 }}>Les signatures s'ouvrent quand la fiche est complète (liste ci-dessus).</div>
                )}
                {empreinte.erreur && <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600, marginBottom: 10 }}>Empreinte du contenu non calculable ({empreinte.erreur}).</div>}

                {validation.erreur && (
                  <div style={{ marginBottom: 10, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>
                    {validation.erreur}
                    {validation.versionDejaFigee && (
                      <div style={{ marginTop: 4, color: T.textSub, fontWeight: 500 }}>
                        Pour continuer, ouvrez une nouvelle version (motif demandé) :{" "}
                        <button onClick={() => setMiseAJour({ motif: "", enCours: false, erreur: null, versionDejaFigee: true })} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}>passer en v{lecture.ligne.version + 1}</button>
                      </div>
                    )}
                  </div>
                )}
                {validation.avertissement && <div style={{ marginBottom: 10, fontSize: 12.5, color: ORANGE, fontWeight: 600 }}>{validation.avertissement}</div>}
                {pdfEtat.message && <div style={{ marginBottom: 10, fontSize: 12.5, color: ORANGE, fontWeight: 600 }}>{pdfEtat.message}</div>}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  {statutFiche === "brouillon" && (
                    <button onClick={apercu} disabled={!apercuPossible || pdfEtat.apercu || !enregistrementAJour}
                      title="Aperçu non stocké, marqué « BROUILLON — non validé » : à ne pas présenter lors d'un contrôle"
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", minHeight: 44, borderRadius: RADIUS.md,
                        border: `1px solid ${T.border}`, background: "transparent", color: apercuPossible && enregistrementAJour ? T.textSub : T.textMuted,
                        fontWeight: 700, fontSize: 13.5, cursor: apercuPossible && enregistrementAJour ? "pointer" : "default", fontFamily: "inherit" }}>
                      <Icon as={FileDown} size={16}/> {pdfEtat.apercu ? "Préparation de l'aperçu…" : "Aperçu PDF (brouillon)"}
                    </button>
                  )}
                  {statutFiche === "brouillon" && modifiable && (
                    <button onClick={valider} disabled={!etat.peutValider || !enregistrementAJour || validation.enCours}
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", minHeight: 44, borderRadius: RADIUS.md,
                        border: `1px solid ${etat.peutValider && enregistrementAJour ? VERT : T.border}`, background: etat.peutValider && enregistrementAJour ? "rgba(34,197,94,.14)" : "transparent",
                        color: etat.peutValider && enregistrementAJour ? VERT : T.textMuted, fontWeight: 800, fontSize: 14, cursor: etat.peutValider && enregistrementAJour ? "pointer" : "default", fontFamily: "inherit" }}>
                      <Icon as={CheckCircle2} size={16}/> {validation.enCours ? "Validation…" : "Valider la fiche"}
                    </button>
                  )}
                  {["validee", "a_mettre_a_jour"].includes(statutFiche) && !miseAJour && (
                    <button onClick={() => ouvrirMiseAJour(propMaj?.motif || "")}
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 18px", minHeight: 44, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                      <Icon as={PenLine} size={16}/> Mettre à jour
                    </button>
                  )}
                </div>

                {miseAJour && (
                  <div ref={formMajRef} style={{ marginTop: 12, padding: "10px 12px", borderRadius: RADIUS.lg, border: `1px solid ${T.border}`, background: T.card || "transparent" }}>
                    <label style={styles.label}>Motif de la mise à jour (obligatoire) — la fiche repassera en brouillon en v{lecture.ligne.version + 1}, à signer et valider de nouveau</label>
                    <textarea rows={2} value={miseAJour.motif} disabled={miseAJour.enCours} style={{ ...styles.input, resize: "vertical" }}
                      placeholder="Ex. : nouveau sous-traitant électricité à partir de la semaine prochaine"
                      onChange={(e) => { const v = e.target.value; setMiseAJour((m) => ({ ...m, motif: v })); }}/>
                    {miseAJour.erreur && <div style={{ marginTop: 6, fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>{miseAJour.erreur}</div>}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                      <button onClick={() => setMiseAJour(null)} disabled={miseAJour.enCours} style={{ padding: "8px 14px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${T.border}`, background: "transparent", color: T.textSub, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Annuler</button>
                      <button onClick={lancerMiseAJour} disabled={miseAJour.enCours || miseAJour.motif.trim().length < MOTIF_MIN}
                        style={{ padding: "8px 14px", minHeight: 38, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                        {miseAJour.enCours ? "Ouverture…" : `Ouvrir la v${lecture.ligne.version + 1}`}
                      </button>
                    </div>
                  </div>
                )}
              </Carte>

              {/* ── Tâche 8 : accueil de l'équipe, par version ── */}
              <Carte T={T} numero={null} titre="Accueil de l'équipe"
                objet="Chaque intervenant signe l'accueil sur la version validée. Une signature d'une version précédente reste valable si les points 3 à 12 n'ont pas changé.">
                {resignature && (
                  <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 8 }}>
                    v{lecture.ligne.version} par rapport à la v{lecture.ligne.version - 1} : « Établie par » et « Chef d'équipe » re-signent à chaque version. {resignature.raison}
                  </div>
                )}
                {statutFiche === "brouillon" && (
                  <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>
                    La signature d'accueil s'ouvre quand la fiche est validée (ouvriers sur leur téléphone, sous-traitants ici sur la tablette).
                  </div>
                )}
                {statutFiche === "a_mettre_a_jour" && (
                  <div style={{ fontSize: 12.5, color: ORANGE, fontWeight: 600, marginBottom: 8 }}>
                    Fiche « à mettre à jour » : les ouvriers ne peuvent pas signer l'accueil depuis leur téléphone tant que la nouvelle version n'est pas validée.
                  </div>
                )}
                {(sigs.erreur || versionsContenu.erreur) && (
                  <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600, marginBottom: 8 }}>Signatures d'accueil illisibles ({sigs.erreur || versionsContenu.erreur}).</div>
                )}
                {sigs.charge && versionsContenu.charge && !sigs.erreur && !versionsContenu.erreur && (
                  groupesAccueil.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: T.textMuted, fontStyle: "italic", marginBottom: 8 }}>Aucune signature d'accueil.</div>
                  ) : groupesAccueil.map((g) => (
                    <div key={g.version} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>v{g.version} — {g.signatures.length} signature{g.signatures.length > 1 ? "s" : ""}</div>
                      {g.signatures.map((x) => (
                        <div key={x.id} style={{ fontSize: 12.5, color: T.textSub, padding: "3px 0", borderBottom: `1px solid ${T.border}` }}>
                          <b style={{ color: T.text }}>{x.signataire_nom}</b>{x.signataire_entreprise ? ` (${x.signataire_entreprise})` : ""} — {dateHeureFr(x.signe_le)}
                          {" "}· {x.auth_user_id ? "compte connecté" : "sans compte, signée au bureau"} ·{" "}
                          <span style={{ fontWeight: 700, color: x.valable ? VERT : x.etat === "en_attente" ? T.textSub : ROUGE }}>{x.libelle}</span> ·{" "}
                          <button onClick={() => ouvrirImageSignature(x)} style={{ border: "none", background: "transparent", color: acc.accent, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0, textDecoration: "underline", fontSize: 12 }}>voir la signature</button>
                        </div>
                      ))}
                    </div>
                  ))
                )}
                {["validee", "a_mettre_a_jour"].includes(statutFiche) && (
                  versionCourante ? (
                    <button onClick={() => setAccueilOuvert(true)} style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", minHeight: 40, borderRadius: RADIUS.md, border: `1px solid ${acc.border}`, background: acc.bg10, color: acc.accent, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                      <Icon as={PenLine} size={14}/> Faire signer l'accueil (sous-traitant sans compte)
                    </button>
                  ) : versionsContenu.charge && !versionsContenu.erreur ? (
                    <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>Version figée v{lecture.ligne.version} introuvable : signature d'accueil impossible.</div>
                  ) : null
                )}
              </Carte>

              {/* ── Historique : versions figées et toutes les signatures ── */}
              {((versions.liste || []).length > 0 || (sigs.liste || []).length > 0 || versions.erreur) && (
                <Carte T={T} numero={null} titre="Mises à jour et signatures" objet="Versions figées (jamais modifiées) et signatures de chaque version.">
                  {versions.erreur && <div style={{ fontSize: 12.5, color: ROUGE, fontWeight: 600 }}>Versions illisibles ({versions.erreur}).</div>}
                  {(versions.liste || []).map((v) => (
                    <div key={v.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5, color: T.text, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                      <Icon as={History} size={14} color={T.textMuted}/>
                      <b>v{v.version}</b>
                      <span style={{ color: T.textSub }}>validée le {dateHeureFr(v.cree_le)}{v.cree_par ? ` par ${v.cree_par}` : ""}</span>
                      {v.motif_changement && <span style={{ color: T.textSub }}>— motif : {v.motif_changement}</span>}
                      <span style={{ color: T.textMuted }}>empreinte {empreinteCourte(v.empreinte)}…</span>
                      <span style={{ marginLeft: "auto" }}>{pdfVersion(v)}</span>
                    </div>
                  ))}
                  {(sigs.liste || []).filter((x) => x.type !== "accueil").length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {(sigs.liste || []).filter((x) => x.type !== "accueil").map((x) => (
                        <div key={x.id} style={{ fontSize: 12, color: T.textSub, padding: "2px 0" }}>
                          {x.type === "etablie_par" ? "Établie par" : "Chef d'équipe"} : <b style={{ color: T.text }}>{x.signataire_nom}</b>
                          {x.signataire_entreprise ? ` (${x.signataire_entreprise})` : ""} — {dateHeureFr(x.signe_le)} —{" "}
                          {libelleSignature(x, { fiche: lecture.ligne, empreinteCourante: statutFiche === "brouillon" ? empreinte.valeur : null, empreintesVersions })}
                        </div>
                      ))}
                    </div>
                  )}
                </Carte>
              )}
            </>
          )}
        </div>
      </div>
      {signatureOuverte && lecture.ligne && (
        <SignatureFicheSecurite T={T} acc={acc}
          libelle={SIGNATURES_REQUISES.find((x) => x.type === signatureOuverte)?.libelle || signatureOuverte}
          version={lecture.ligne.version} empreinte={empreinte.valeur}
          synthese={ligneEnregistree?.synthese_risques || []}
          nomConnecte={auteur || ""} pourMoiParDefaut={signatureOuverte === "etablie_par"}
          entrepriseParDefaut={signatureOuverte === "etablie_par" ? "Profero" : ""}
          onSigner={(v) => signer(signatureOuverte, v)} onAnnuler={() => setSignatureOuverte(null)}/>
      )}
      {accueilOuvert && versionCourante && (() => {
        const lu = lectureOuvrier(versionCourante.contenu);
        return (
          <SignatureFicheSecurite T={T} acc={acc} libelle="Accueil (sous-traitant)"
            version={versionCourante.version} empreinte={versionCourante.empreinte}
            synthese={lu.risques}
            consignes={lu.ok && lu.points.length ? (
              <div style={{ marginTop: 8, fontSize: 13, color: T.text }}>
                <div style={{ fontSize: FONT.xs.size, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Consignes</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {lu.points.map((p) => <li key={p.numero}><b>{p.titre}</b>{p.consignes.length ? ` : ${p.consignes.join(" ; ")}` : ""}{p.mesures ? ` — ${p.mesures}` : ""}</li>)}
                </ul>
              </div>
            ) : null}
            nomConnecte=""
            note={`Signature d'accueil sur la v${versionCourante.version}, prise sur cet appareil pour une personne sans compte (aucun compte rattaché).`}
            onSigner={signerAccueilSousTraitant} onAnnuler={() => setAccueilOuvert(false)}/>
        );
      })()}
    </div>
  );
}
