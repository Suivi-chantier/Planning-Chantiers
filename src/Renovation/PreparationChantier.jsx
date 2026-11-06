// Préparer le chantier — parcours guidé plein écran, lancé depuis Phasage V2.
// Étapes « Les pièces », « Où se fait chaque ouvrage »
// (PreparationRepartition.jsx) et « Consignes & plans »
// (PreparationConsignes.jsx), précédées de « Point de départ »
// (PreparationDepart.jsx : copie depuis un autre logement de l'opération).
// Calculs : preparationChantierV1.mjs (module pur) et piecesPhasageV1.mjs.
// AUCUNE écriture Supabase ici : on reçoit les fonctions d'écriture de
// Phasage V2 (saveMeta, updateOuvrages), qui passent par sa file d'attente
// avec révision (verrou optimiste) et son journal d'avancement.
// Phasage V2 transmet aussi l'état de sa sauvegarde (`etatSauvegarde`,
// `conflit`) : « Enregistrer et quitter » ne ferme le parcours qu'une fois
// l'écriture confirmée, et jamais en silence si la sauvegarde est en pause.
import React, { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, ChevronRight, ClipboardList, Pencil, X, Check, AlertTriangle } from "lucide-react";
import { THEMES, FONT, RADIUS } from "../constants";
import { Icon } from "../ui";
import { ajouterPiece, renommerPiece, deplacerPiece, supprimerPiece, detacherPiece, piecesDuPhasage } from "./piecesPhasageV1";
import { ETAPES, PIECES_RAPIDES, etapeReprise, majPreparation, piecesRetirees, preparationDuPhasage, marquerOuvragePlace, remplacerOuvrage, piecesPourEnregistrement, marquerPreparationTerminee } from "./preparationChantierV1";
import PreparationRepartition from "./PreparationRepartition";
import PreparationConsignes from "./PreparationConsignes";
import PreparationDepart from "./PreparationDepart";
import { copierPreparation, compterPiecesACreer, preparationApresCopie, retirerProposition } from "./preparationCopieV1";

// Étapes déjà utilisables dans cette version du parcours.
const ETAPES_DISPONIBLES = ["depart", "pieces", "repartition", "consignes"];
const rid = () => Math.random().toString(36).slice(2, 10);
const memeNom = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
const TOUCHE = 34; // hauteur des boutons, alignée sur le reste de l'appli
const DELAI_MIN_FERMETURE = 1200; // > 800 ms d'attente de la sauvegarde des ouvrages dans Phasage V2
const DELAI_MAX_FERMETURE = 20000;
const MSG_CONFLIT = "Enregistrement en pause : le phasage a été modifié ailleurs (autre poste ou autre personne). "
  + "Pour protéger ces modifications, plus rien n'est enregistré depuis ce parcours. Le parcours reste ouvert. "
  + "Pour reprendre : « Quitter sans enregistrer », puis « Recharger la version récente » dans Phasage V2, et rouvrez « Préparer le chantier ».";

export default function PreparationChantier({ chantierNom, chantierId = null, logementsOperation = [], meta, ouvrages = [], auteur = null, heuresPointees = null, conflit = false, etatSauvegarde = "saved", onSaveMeta, onOuvragesChange, onFermer, T: theme }) {
  const T = theme || THEMES.dark;
  const accent = T.accent;
  // Texte sur fond d'accent : foncé sur le jaune (sombre), blanc sur le bleu (clair).
  const surAccent = T.bg === THEMES.light.bg ? "#fff" : "#111318";
  const piecesInitiales = piecesDuPhasage(meta);   // dernière liste enregistrée
  // Première ouverture (aucune étape enregistrée, aucune pièce) : « Point de
  // départ » ; sinon reprise à l'étape enregistrée.
  const [etape, setEtape] = useState(() => (meta?.preparation?.etape || piecesInitiales.length
    ? etapeReprise(meta, ETAPES_DISPONIBLES) : "depart"));
  const [pieces, setPieces] = useState(piecesInitiales);
  const [prep, setPrep] = useState(() => preparationDuPhasage(meta));
  const [modifie, setModifie] = useState(false);
  const [autre, setAutre] = useState(null);           // texte de « + Autre pièce » (null = fermé)
  const [renommage, setRenommage] = useState(null);   // { id, nom } en cours
  const [enregistrement, setEnregistrement] = useState(false);
  const [message, setMessage] = useState("");         // bandeau d'alerte (conflit, échec)
  const [info, setInfo] = useState("");               // bandeau neutre (résultat de la copie)
  const [attenteFermeture, setAttenteFermeture] = useState(null); // horodatage de la demande de fermeture
  const onFermerRef = useRef(onFermer);
  onFermerRef.current = onFermer;

  const changer = (next) => { setPieces(next); setModifie(true); };
  // Variante fonctionnelle (consignes, photos envoyées en arrière-plan) :
  // part toujours de la dernière liste, pour ne perdre aucune saisie.
  const majPieces = (f) => { setPieces(prev => f(prev)); setModifie(true); };
  const ajouter = (nom) => changer(ajouterPiece(pieces, nom, rid()));
  const nbTachesDe = (id) => ouvrages.reduce((s, o) => s + (o.taches || []).filter(t => t.piece_id === id).length, 0);
  const retirer = (p) => {
    const n = nbTachesDe(p.id);
    const msg = n > 0
      ? `Retirer « ${p.nom} » ? ${n} tâche${n > 1 ? "s" : ""} rattachée${n > 1 ? "s" : ""} à cette pièce redeviendr${n > 1 ? "ont" : "a"} « sans pièce » à l'enregistrement.`
      : `Retirer « ${p.nom} » ?`;
    if (window.confirm(msg)) changer(supprimerPiece(pieces, p.id));
  };
  const validerRenommage = () => {
    if (!renommage) return;
    const n = renommage.nom.trim();
    if (n && !pieces.some(p => p.id !== renommage.id && memeNom(p.nom, n))) changer(renommerPiece(pieces, renommage.id, n));
    setRenommage(null);
  };
  const validerAutre = () => {
    if (autre && autre.trim()) ajouter(autre);
    setAutre(null);
  };

  // Sauvegarde en pause dans Phasage V2 : on le dit, on n'écrit rien, on reste ouvert.
  const bloqueParConflit = () => { if (!conflit) return false; setMessage(MSG_CONFLIT); return true; };

  // Écriture unique de meta (pièces + préparation) : deux saveMeta successifs
  // se perdraient un patch. Les tâches des pièces retirées redeviennent
  // « sans pièce » (detacherPiece). Renvoie la préparation enregistrée, ou
  // null si Phasage V2 n'a pas pu écrire.
  const ecrire = async ({ etape: e, base = prep, ouvragesBase = ouvrages, piecesAEcrire = pieces }) => {
    let ouvs = ouvragesBase;
    let detache = false;
    piecesRetirees(piecesInitiales, piecesAEcrire).forEach(id => {
      if (ouvs.some(o => (o.taches || []).some(t => t.piece_id === id))) { ouvs = detacherPiece(ouvs, id); detache = true; }
    });
    const nouvelle = majPreparation(base, { etape: e, maj_le: new Date().toISOString(), par: auteur });
    // Liste complète des pièces (id, nom, consignes, photos) : jamais un patch partiel.
    const r = await onSaveMeta({ pieces: piecesPourEnregistrement(piecesAEcrire), preparation: nouvelle });
    if (r === false) return null;
    if (detache) onOuvragesChange(ouvs);
    setPrep(nouvelle);
    setModifie(false);
    return nouvelle;
  };

  // terminer : « Terminer la préparation » (étape Consignes & plans) marque
  // en plus la préparation comme faite.
  const enregistrerEtQuitter = async ({ terminer = false } = {}) => {
    if (enregistrement) return;
    if (bloqueParConflit()) return;
    setMessage("");
    setEnregistrement(true);
    try {
      const ok = await ecrire({ etape, base: terminer ? marquerPreparationTerminee(prep) : prep });
      if (!ok) { setMessage("L'enregistrement n'a pas abouti. Le parcours reste ouvert : réessayez."); setEnregistrement(false); return; }
      setAttenteFermeture(Date.now());   // fermeture quand Phasage V2 confirme (effet ci-dessous)
    } catch (err) {
      console.warn("Préparer le chantier — enregistrement :", err);
      setMessage("L'enregistrement n'a pas abouti. Le parcours reste ouvert : réessayez.");
      setEnregistrement(false);
    }
  };

  // Fermeture seulement quand la sauvegarde de Phasage V2 est confirmée.
  useEffect(() => {
    if (!attenteFermeture) return undefined;
    const arreter = (msg) => { setAttenteFermeture(null); setEnregistrement(false); setMessage(msg); };
    if (conflit || etatSauvegarde === "conflit") { arreter(MSG_CONFLIT); return undefined; }
    if (etatSauvegarde === "error") { arreter("L'enregistrement n'a pas abouti. Le parcours reste ouvert : réessayez."); return undefined; }
    const ecoule = Date.now() - attenteFermeture;
    if (etatSauvegarde === "saved") {
      const t = setTimeout(() => onFermerRef.current(), Math.max(0, DELAI_MIN_FERMETURE - ecoule));
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => arreter("L'enregistrement n'est pas encore confirmé (connexion lente ?). Le parcours reste ouvert : réessayez dans un instant."), Math.max(0, DELAI_MAX_FERMETURE - ecoule));
    return () => clearTimeout(t);
  }, [attenteFermeture, etatSauvegarde, conflit]);

  const fermerSansEnregistrer = () => {
    if (modifie && !window.confirm("Quitter sans enregistrer ? Les pièces, consignes et photos ajoutées ou modifiées depuis le dernier enregistrement seront perdues.")) return;
    onFermer();
  };

  // « Les pièces » → « Où se fait chaque ouvrage » : les pièces sont
  // enregistrées d'abord (les tâches ne peuvent viser que des pièces connues).
  const continuerVersRepartition = async () => {
    if (enregistrement || bloqueParConflit()) return;
    setMessage("");
    setEnregistrement(true);
    try {
      const ok = await ecrire({ etape: "repartition" });
      if (!ok) { setMessage("Les pièces n'ont pas pu être enregistrées. Réessayez."); return; }
      setEtape("repartition");
    } catch (err) {
      console.warn("Préparer le chantier — pièces :", err);
      setMessage("Les pièces n'ont pas pu être enregistrées. Réessayez.");
    } finally {
      setEnregistrement(false);
    }
  };

  // « Où se fait chaque ouvrage » → « Consignes & plans » : l'étape est
  // notée (reprise) ; les ouvrages validés sont déjà enregistrés.
  const continuerVersConsignes = async () => {
    if (enregistrement || bloqueParConflit()) return;
    setMessage("");
    setEnregistrement(true);
    try {
      const ok = await ecrire({ etape: "consignes" });
      if (!ok) { setMessage("L'enregistrement n'a pas abouti. Réessayez."); return; }
      setEtape("consignes");
    } catch (err) {
      console.warn("Préparer le chantier — consignes :", err);
      setMessage("L'enregistrement n'a pas abouti. Réessayez.");
    } finally {
      setEnregistrement(false);
    }
  };

  // Validation d'un ouvrage (étape répartition) : tâches par updateOuvrages,
  // puis ouvrage marqué « placé » dans meta.preparation.
  const validerOuvrage = async (ouvrageId, ouvrageModifie, mode) => {
    if (bloqueParConflit()) return { ok: false };
    setMessage("");
    try {
      let ouvs = ouvrages;
      if (ouvrageModifie) { ouvs = remplacerOuvrage(ouvrages, ouvrageModifie); onOuvragesChange(ouvs); }
      // La proposition reprise d'un autre logement est consommée à la validation.
      const nouvelle = await ecrire({ etape: "repartition", base: retirerProposition(marquerOuvragePlace(prep, ouvrageId, mode), ouvrageId), ouvragesBase: ouvs });
      if (!nouvelle) { setMessage("L'ouvrage n'a pas pu être marqué « placé ». Réessayez."); return { ok: false }; }
      return { ok: true, preparation: nouvelle };
    } catch (err) {
      console.warn("Préparer le chantier — répartition :", err);
      setMessage("L'enregistrement n'a pas abouti. Réessayez.");
      return { ok: false };
    }
  };

  // « Point de départ » → copie depuis un autre logement : pièces (nouveaux
  // identifiants), consignes, photos si cochées, et PROPOSITIONS de
  // répartition (vérifiées et validées ouvrage par ouvrage à l'étape 3).
  // Une seule écriture meta (pièces + préparation) ; aucune tâche modifiée.
  const copierDepuis = async (source, options) => {
    if (enregistrement || bloqueParConflit()) return;
    setMessage(""); setInfo("");
    const existants = new Set(pieces.map(p => String(p.id)));
    const n = compterPiecesACreer(piecesDuPhasage(source.meta), pieces);
    const ids = [];
    while (ids.length < n) { const id = rid(); if (!existants.has(id) && !ids.includes(id)) ids.push(id); }
    const res = copierPreparation(source, { meta: { ...meta, pieces, preparation: prep }, ouvrages }, { options, nouveauxIds: ids, heuresPointees });
    if (!res.ok) { setMessage(`La copie n'a pas pu être préparée : ${res.erreur}`); return; }
    setEnregistrement(true);
    try {
      const base = preparationApresCopie(prep, res, { source, options, le: new Date().toISOString() });
      const ok = await ecrire({ etape: "pieces", base, piecesAEcrire: res.pieces });
      if (!ok) { setMessage("La copie n'a pas pu être enregistrée. Réessayez."); return; }
      setPieces(res.pieces);
      const r = res.resume;
      setInfo(`Copié depuis ${source.nom} : ${r.pieces} pièce${r.pieces > 1 ? "s" : ""}. `
        + (options.repartition ? `${r.propositions} répartition${r.propositions > 1 ? "s" : ""} proposée${r.propositions > 1 ? "s" : ""}, à vérifier et valider à l'étape 3 ; `
          + `${r.sansCorrespondance} ouvrage${r.sansCorrespondance > 1 ? "s" : ""} sans équivalent (à placer)${r.ambigus ? `, dont ${r.ambigus} ambigu${r.ambigus > 1 ? "s" : ""}` : ""}. ` : "")
        + "Vérifiez les pièces puis continuez.");
      setEtape("pieces");
    } catch (err) {
      console.warn("Préparer le chantier — copie :", err);
      setMessage("La copie n'a pas pu être enregistrée. Réessayez.");
    } finally {
      setEnregistrement(false);
    }
  };

  const btn = (plein = false) => ({
    minHeight: TOUCHE, padding: "0 14px", borderRadius: RADIUS.md, fontFamily: "inherit",
    fontSize: FONT.sm.size, fontWeight: 700, cursor: "pointer",
    border: `1px solid ${plein ? accent : T.border}`,
    background: plein ? accent : "transparent", color: plein ? surAccent : T.text,
  });
  const btnIcone = { width: TOUCHE, height: TOUCHE, border: "none", background: "transparent", color: T.textSub, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm };
  const champ = { minHeight: TOUCHE, boxSizing: "border-box", padding: "0 12px", borderRadius: RADIUS.sm, border: `1px solid ${T.fieldBorder || T.border}`, background: T.inputBg || T.card, color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size + 1 };
  const titreSection = { color: T.textSub, fontSize: FONT.xs.size, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 };

  return (
    // Même présentation que les fenêtres du Phasage : fond assombri, fenêtre
    // centrée (surface, bord fin, coins de 14 px), en-tête icône + titre +
    // sous-titre, boutons compacts. Grande fenêtre : le parcours a plusieurs
    // colonnes (liste des ouvrages, répartition).
    <div style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div role="dialog" aria-modal="true" aria-label="Préparer le chantier"
      style={{ width: "min(1240px, 100%)", height: "min(920px, 100%)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)", overflow: "hidden", color: T.text, display: "flex", flexDirection: "column", fontFamily: "inherit" }}>
      {/* En-tête */}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ width: 30, height: 30, borderRadius: RADIUS.md, flexShrink: 0, background: `color-mix(in srgb, ${accent} 20%, transparent)`, color: accent,
          display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Icon as={ClipboardList} size={16}/>
        </span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: T.text }}>Préparer le chantier</div>
          <div style={{ fontSize: FONT.xs.size, color: T.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chantierNom || "Chantier"} · pièces, répartition des ouvrages et consignes pour les ouvriers
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={fermerSansEnregistrer} style={btn()}>Quitter sans enregistrer</button>
          <button onClick={() => enregistrerEtQuitter()} disabled={enregistrement} style={{ ...btn(true), opacity: enregistrement ? 0.6 : 1 }}>
            {enregistrement ? "Enregistrement…" : "Enregistrer et quitter"}
          </button>
        </div>
      </header>

      {/* Étapes */}
      <nav aria-label="Étapes" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "8px 20px", borderBottom: `1px solid ${T.sectionDivider || T.border}`, background: T.card }}>
        {ETAPES.map((e, i) => {
          const active = e.id === etape;
          const dispo = ETAPES_DISPONIBLES.includes(e.id);
          return (
            <React.Fragment key={e.id}>
              {i > 0 && <Icon as={ChevronRight} size={14} style={{ color: T.textMuted, flexShrink: 0 }}/>}
              <div aria-current={active ? "step" : undefined} title={dispo ? e.label : `${e.label} : bientôt disponible`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: RADIUS.md,
                  background: active ? (T.tagBg || "rgba(255,194,0,0.14)") : "transparent",
                  color: active ? (T.tagColor || accent) : T.textSub, fontWeight: active ? 700 : 500, fontSize: FONT.sm.size, opacity: dispo ? 1 : 0.65 }}>
                <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: FONT.xs.size, fontWeight: 700,
                  background: active ? accent : "transparent", color: active ? surAccent : T.textSub, border: active ? "none" : `1px solid ${T.textMuted}` }}>{i + 1}</span>
                {e.label}
                {!dispo && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: RADIUS.pill, border: `1px solid ${T.border}`, color: T.textMuted }}>bientôt</span>}
              </div>
            </React.Fragment>
          );
        })}
      </nav>

      {message && (
        <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 20px", background: "#e15a5a18", borderBottom: "1px solid #e15a5a55", color: T.text, fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
          <Icon as={AlertTriangle} size={15} style={{ color: "#e15a5a", flexShrink: 0, marginTop: 2 }}/>
          <span style={{ flex: 1 }}>{message}</span>
          <button onClick={() => setMessage("")} aria-label="Masquer le message" style={btnIcone}><Icon as={X} size={15}/></button>
        </div>
      )}

      {info && etape !== "depart" && (
        <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 20px", background: T.tagBg || "transparent", borderBottom: `1px solid ${T.border}`, color: T.text, fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
          <span style={{ flex: 1 }}>{info}</span>
          <button onClick={() => setInfo("")} aria-label="Masquer le message" style={btnIcone}><Icon as={X} size={15}/></button>
        </div>
      )}

      <main style={{ flex: 1, overflowY: "auto" }}>
        {etape === "depart" && (
          <PreparationDepart logementsOperation={logementsOperation} ouvrages={ouvrages} aDejaDesPieces={pieces.length > 0}
            enregistrement={enregistrement} onCopier={copierDepuis} onPartirDeZero={() => setEtape("pieces")}
            T={T} accent={accent} surAccent={surAccent}/>
        )}
        {etape === "consignes" && (
          <PreparationConsignes pieces={pieces} ouvrages={ouvrages} preparation={prep} chantierId={chantierId}
            onMajPieces={majPieces} T={T} accent={accent} surAccent={surAccent}/>
        )}
        {etape === "repartition" && (
          <PreparationRepartition ouvrages={ouvrages} pieces={pieces} preparation={prep} heuresPointees={heuresPointees}
            onValider={validerOuvrage} onRetourPieces={() => setEtape("pieces")} T={T} accent={accent} surAccent={surAccent}/>
        )}
        {/* Étape « Les pièces » */}
        {etape === "pieces" && <div style={{ width: "100%", maxWidth: 860, margin: "0 auto", padding: "20px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, fontSize: FONT.xl.size, fontWeight: 800, letterSpacing: -0.2 }}>Quelles pièces dans ce logement ?</h1>
            <p style={{ margin: 0, color: T.textSub, fontSize: FONT.sm.size + 1, lineHeight: 1.5 }}>
              Touche une pièce pour l'ajouter. L'ordre de la liste sera l'ordre de visite sur le téléphone des ouvriers.
            </p>
          </div>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={titreSection}>Ajout rapide</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {PIECES_RAPIDES.map(nom => {
                const deja = pieces.some(p => memeNom(p.nom, nom));
                return (
                  <button key={nom} onClick={() => !deja && ajouter(nom)} aria-pressed={deja} disabled={deja}
                    title={deja ? "Déjà dans la liste" : `Ajouter « ${nom} »`}
                    style={{ minHeight: TOUCHE, padding: "0 16px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT.sm.size + 1, cursor: deja ? "default" : "pointer",
                      border: `1px solid ${deja ? accent : T.border}`, background: deja ? (T.tagBg || "transparent") : T.card, color: deja ? accent : T.text,
                      display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {deja && <Icon as={Check} size={15}/>}{nom}
                  </button>
                );
              })}
              {autre == null ? (
                <button onClick={() => setAutre("")}
                  style={{ minHeight: TOUCHE, padding: "0 16px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT.sm.size + 1, cursor: "pointer", border: `1px dashed ${T.textMuted}`, background: "transparent", color: T.text }}>
                  + Autre pièce…
                </button>
              ) : (
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  <input autoFocus value={autre} onChange={e => setAutre(e.target.value)} placeholder="Nom de la pièce"
                    onKeyDown={e => { if (e.key === "Enter") validerAutre(); if (e.key === "Escape") setAutre(null); }}
                    aria-label="Nom de la nouvelle pièce" style={{ ...champ, width: 220 }}/>
                  <button onClick={validerAutre} style={btn(true)}>Ajouter</button>
                  <button onClick={() => setAutre(null)} style={btn()}>Annuler</button>
                </span>
              )}
            </div>
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={titreSection}>Pièces du logement · {pieces.length}</div>
            {pieces.length === 0 && (
              <div style={{ color: T.textSub, fontSize: FONT.sm.size, padding: "14px 16px", border: `1px dashed ${T.border}`, borderRadius: RADIUS.md }}>
                Aucune pièce pour l'instant. Touche une pièce ci-dessus pour commencer.
              </div>
            )}
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {pieces.map((p, i) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "6px 8px 6px 14px" }}>
                  <span style={{ width: 24, color: T.textSub, fontSize: FONT.sm.size }}>{i + 1}</span>
                  {renommage?.id === p.id ? (
                    <>
                      <input autoFocus value={renommage.nom} onChange={e => setRenommage({ id: p.id, nom: e.target.value })}
                        onKeyDown={e => { if (e.key === "Enter") validerRenommage(); if (e.key === "Escape") setRenommage(null); }}
                        aria-label={`Nouveau nom pour ${p.nom}`} style={{ ...champ, flex: 1, minWidth: 0 }}/>
                      <button onClick={validerRenommage} aria-label="Valider le nom" style={{ ...btnIcone, color: accent }}><Icon as={Check} size={15}/></button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, minWidth: 0, fontSize: FONT.base.size, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{p.nom}</span>
                      <button onClick={() => setRenommage({ id: p.id, nom: p.nom })} aria-label={`Renommer ${p.nom}`} style={btnIcone}><Icon as={Pencil} size={15}/></button>
                    </>
                  )}
                  <button onClick={() => changer(deplacerPiece(pieces, p.id, -1))} disabled={i === 0} aria-label={`Monter ${p.nom}`} style={{ ...btnIcone, opacity: i === 0 ? 0.3 : 1 }}><Icon as={ChevronUp} size={16}/></button>
                  <button onClick={() => changer(deplacerPiece(pieces, p.id, 1))} disabled={i === pieces.length - 1} aria-label={`Descendre ${p.nom}`} style={{ ...btnIcone, opacity: i === pieces.length - 1 ? 0.3 : 1 }}><Icon as={ChevronDown} size={16}/></button>
                  <button onClick={() => retirer(p)} aria-label={`Retirer ${p.nom}`} style={btnIcone}><Icon as={X} size={15}/></button>
                </li>
              ))}
            </ol>
          </section>

        </div>}
      </main>

      {/* Pied : navigation entre les étapes */}
      <footer style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, padding: "12px 20px", borderTop: `1px solid ${T.border}`, background: T.surface }}>
        {etape === "repartition" && <button onClick={() => setEtape("pieces")} style={btn()}>Retour aux pièces</button>}
        {etape === "consignes" && <button onClick={() => setEtape("repartition")} style={btn()}>Retour : où se fait chaque ouvrage</button>}
        {etape === "pieces" && <button onClick={() => setEtape("depart")} style={btn()}>Retour : point de départ</button>}
        {etape === "depart" && <span/>}
        {etape === "pieces" && (
          <button onClick={continuerVersRepartition} disabled={enregistrement || pieces.length === 0}
            title={pieces.length === 0 ? "Ajoute au moins une pièce" : undefined}
            style={{ ...btn(true), opacity: enregistrement || pieces.length === 0 ? 0.5 : 1 }}>
            Continuer : où se fait chaque ouvrage
          </button>
        )}
        {etape === "repartition" && (
          <button onClick={continuerVersConsignes} disabled={enregistrement} style={{ ...btn(true), opacity: enregistrement ? 0.5 : 1 }}>
            Continuer : consignes & plans
          </button>
        )}
        {etape === "consignes" && (
          <button onClick={() => enregistrerEtQuitter({ terminer: true })} disabled={enregistrement} style={{ ...btn(true), opacity: enregistrement ? 0.5 : 1 }}>
            {enregistrement ? "Enregistrement…" : "Terminer la préparation"}
          </button>
        )}
      </footer>
    </div>
    </div>
  );
}
