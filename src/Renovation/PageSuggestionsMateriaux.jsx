// ─────────────────────────────────────────────────────────────────────────────
// BUREAU — « Suggestions de matériaux » : consulter et traiter ce que les
// ouvriers signalent depuis la préparation de chantier.
//
// Un SEUL composant sert les deux entrées :
//   • la page centrale (toutes les suggestions) ;
//   • l'entrée d'une fiche chantier, avec chantierId imposé.
// Il n'existe pas de seconde implémentation.
//
// Toutes les opérations passent par des RPC. La table
// suggestions_materiaux_ouvriers n'est JAMAIS lue ni écrite en direct :
// aucun supabase.from() sur elle ici. Les deux seuls accès directs à une
// table sont la création d'une fiche matériau (réservée au bureau) et la
// liste des fournisseurs, tous deux repris de la bibliothèque existante.
//
// L'éditeur de fiche matériau est ArticleModal, IMPORTÉ de
// PageBibliothequeMateriaux : c'est le vrai workflow de la bibliothèque, pas
// une copie. Aucune référence n'est créée en arrière-plan, aucun prix n'est
// inventé — le conducteur remplit la fiche lui-même.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { FONT, RADIUS, getBranchAccent } from "../constants";
import {
  Lightbulb, RefreshCw, Search, Plus, X, Check, AlertTriangle, Info,
  Building2, Package, User, Clock, CheckCircle2, XCircle, Loader,
} from "lucide-react";
import { ArticleModal } from "./PageBibliothequeMateriaux";
import {
  FILTRES, LIBELLES_STATUT, ACTIONS_EXISTANT, filtreValide, estTraitable,
  quantiteOuvrageUtilisable, preremplissageParUnite, totalDepuisParUnite,
  lienExistant, resultatAcceptation, validerQuantitePositive,
} from "./suggestionsConducteur";
import { reponseObsolete } from "./suggestionsMateriaux.mjs";

// Messages rendus à l'utilisateur pour chaque code des RPC. Le détail
// technique reste en console.
const MESSAGES = {
  deja_traitee:        "Cette suggestion vient d'être traitée par quelqu'un d'autre.",
  suggestion_inconnue: "Cette suggestion n'existe plus.",
  phasage_introuvable: "Le phasage de ce chantier est introuvable.",
  ouvrage_introuvable: "Cet ouvrage n'existe plus dans le phasage.",
  materiau_inconnu:    "Ce matériau n'existe pas dans la bibliothèque.",
  quantite_invalide:   "La quantité n'est pas exploitable.",
  action_requise:      "Ce matériau est déjà prévu : choisis d'ajouter ou de remplacer.",
  motif_requis:        "Le motif est obligatoire.",
  conflit:             "Le phasage a changé pendant le traitement. Recharge la liste et recommence.",
};
const MESSAGE_REFUS_DROIT = "Ton compte ne permet pas de traiter les suggestions.";
const MESSAGE_GENERIQUE   = "L'opération n'a pas abouti. Vérifie ta connexion et réessaie.";

const dateFr = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
};
const nb = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)))
  ? null : String(Math.round(Number(n) * 10000) / 10000).replace(".", ",");

// ─────────────────────────────────────────────────────────────────────────────
// Modale de validation avant acceptation
// ─────────────────────────────────────────────────────────────────────────────
function ModaleTraitement({ suggestion, T, acc, onFerme, onTraitee }) {
  const ouvrage = suggestion.ouvrage || {};
  const qOuvrageOk = quantiteOuvrageUtilisable(ouvrage.quantite);

  const [materiau, setMateriau]     = useState(suggestion.materiau || null);
  const [recherche, setRecherche]   = useState("");
  const [resultats, setResultats]   = useState([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  const [creation, setCreation]     = useState(false);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [parUnite, setParUnite]     = useState(() => {
    const p = preremplissageParUnite(suggestion.quantite_totale, ouvrage.quantite);
    return p === null ? "" : String(p).replace(".", ",");
  });
  const [action, setAction]   = useState(null);   // aucune valeur par défaut
  const [envoi, setEnvoi]     = useState(false);
  const [erreur, setErreur]   = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    supabase.from("fournisseurs").select("id,nom").order("nom")
      .then(({ data }) => setFournisseurs(data || []));
  }, []);

  // Recherche débouncée, avec garde anti-réponse obsolète.
  useEffect(() => {
    const q = recherche.trim();
    if (q.length < 2) { setResultats([]); setChercheEnCours(false); return undefined; }
    const mien = ++seq.current;
    setChercheEnCours(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("ouvrier_rechercher_materiaux", { p_recherche: q });
        if (reponseObsolete(mien, seq.current)) return;
        if (error) { console.error("recherche matériaux:", error); setResultats([]); }
        else setResultats(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!reponseObsolete(mien, seq.current)) { console.error("recherche matériaux:", e); setResultats([]); }
      } finally {
        if (!reponseObsolete(mien, seq.current)) setChercheEnCours(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [recherche]);

  const existant = useMemo(() => lienExistant(ouvrage, materiau?.id), [ouvrage, materiau]);
  // Une action choisie n'a plus de sens si le matériau change.
  useEffect(() => { setAction(null); }, [materiau?.id]);

  const apercu = resultatAcceptation({ existant, action, quantiteParUnite: parUnite });
  const totalObtenu = totalDepuisParUnite(parUnite, ouvrage.quantite);

  // Création d'une fiche matériau : ArticleModal fait la saisie, on récupère
  // la ligne créée pour la sélectionner aussitôt. Aucun prix par défaut.
  const creerMateriau = async (draft) => {
    const payload = {
      nom: draft.nom?.trim(),
      reference: draft.reference?.trim() || null,
      fournisseur: draft.fournisseur?.trim() || null,
      fournisseur_id: draft.fournisseur_id || null,
      categorie: draft.categorie || null,
      prix_unitaire: draft.prix_unitaire ? parseFloat(draft.prix_unitaire) : null,
      unite: draft.unite || "U",
      stock_min: draft.stock_min ? parseInt(draft.stock_min, 10) : null,
      lien_fournisseur: draft.lien_fournisseur?.trim() || null,
      photo_url: draft.photo_url?.trim() || null,
      notes: draft.notes?.trim() || null,
    };
    const { data, error } = await supabase
      .from("materiaux_bibliotheque").insert(payload).select("id,nom,reference,unite,fournisseur").single();
    if (error) { console.error("création matériau:", error); setErreur("Le matériau n'a pas pu être créé."); return; }
    setCreation(false);
    setMateriau(data);
    setRecherche("");
    setResultats([]);
  };

  const accepter = async () => {
    if (envoi) return;
    setErreur(null);
    if (!materiau?.id) { setErreur("Choisis le matériau à ajouter à l'ouvrage."); return; }
    if (!apercu.ok) { setErreur(apercu.erreur); return; }
    setEnvoi(true);
    try {
      const { data, error } = await supabase.rpc("conducteur_accepter_suggestion_materiau", {
        p_suggestion_id: suggestion.id,
        p_materiau_id: materiau.id,
        p_quantite_par_unite: validerQuantitePositive(parUnite).valeur,
        p_action_existant: existant ? action : "nouveau",
      });
      if (error) { console.error("accepter suggestion:", error); setErreur(MESSAGE_GENERIQUE); return; }
      if (!data) { setErreur(MESSAGE_REFUS_DROIT); return; }
      if (data.ok !== true) { setErreur(MESSAGES[data.code] || MESSAGE_GENERIQUE); return; }
      onTraitee("Suggestion acceptée : le matériau est ajouté à l'ouvrage.");
    } catch (e) {
      console.error("accepter suggestion:", e);
      setErreur(MESSAGE_GENERIQUE);
    } finally { setEnvoi(false); }   // la saisie reste en place en cas d'erreur
  };

  const champ = {
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm,
    color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, padding: "8px 10px",
  };
  const libelle = { fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.4 };
  const bloc = { background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, padding: "10px 12px" };

  return (
    <>
      <div onClick={envoi ? undefined : onFerme} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(5px)", zIndex: 900,
      }}/>
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(620px, calc(100vw - 24px))", maxHeight: "calc(100vh - 48px)",
        overflowY: "auto", zIndex: 901,
        background: T.modal || T.surface, borderRadius: RADIUS.xl,
        border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "14px 18px",
          borderBottom: `1px solid ${T.sectionDivider || T.border}`, position: "sticky", top: 0,
          background: T.modal || T.surface, zIndex: 1,
        }}>
          <Icon as={Lightbulb} size={17} color={acc.accent}/>
          <div style={{ flex: 1, fontSize: FONT.base.size, fontWeight: 800, color: T.text }}>
            Traiter la suggestion
          </div>
          <button onClick={onFerme} disabled={envoi} style={{
            border: "none", background: "transparent", color: T.textMuted, cursor: "pointer", padding: 4,
          }}><Icon as={X} size={17}/></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Contexte */}
          <div style={bloc}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: FONT.sm.size, color: T.textSub }}>
              <span><Icon as={Building2} size={12}/> {suggestion.chantier_nom || suggestion.chantier_id}</span>
              <span><Icon as={User} size={12}/> {suggestion.auteur?.nom || "—"}</span>
              <span><Icon as={Clock} size={12}/> {dateFr(suggestion.cree_le)}</span>
            </div>
            <div style={{ marginTop: 8, fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>
              {ouvrage.code ? <span style={{ color: T.textMuted }}>{ouvrage.code} · </span> : null}
              {ouvrage.libelle || "(ouvrage sans libellé)"}
            </div>
            <div style={{ marginTop: 3, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
              Quantité de l'ouvrage : {qOuvrageOk ? `${nb(ouvrage.quantite)} ${ouvrage.unite || ""}`.trim() : "non renseignée"}
            </div>
          </div>

          {/* Demande de l'ouvrier */}
          <div style={bloc}>
            <div style={libelle}>Demande de l'ouvrier</div>
            <div style={{ marginTop: 5, fontSize: FONT.base.size, fontWeight: 800, color: T.text }}>
              {suggestion.materiau?.nom || suggestion.designation_libre}
            </div>
            <div style={{ marginTop: 3, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
              Quantité totale demandée : <b style={{ color: T.text }}>{nb(suggestion.quantite_totale)} {suggestion.unite}</b>
              {!suggestion.materiau && " · saisie libre"}
            </div>
            {suggestion.precision && (
              <div style={{ marginTop: 6, fontSize: FONT.sm.size, color: T.textSub, fontStyle: "italic" }}>
                « {suggestion.precision} »
              </div>
            )}
          </div>

          {/* Matériau retenu */}
          <div>
            <div style={libelle}>Matériau qui sera ajouté à l'ouvrage</div>
            {!suggestion.materiau && !materiau && (
              <div style={{
                marginTop: 5, padding: "8px 10px", borderRadius: RADIUS.sm,
                background: "#f59e0b12", border: "1px solid #f59e0b44",
                fontSize: FONT.xs.size + 1, color: "#b97a10", fontWeight: 600,
              }}>
                Cette suggestion est une saisie libre : elle doit être rattachée à un matériau
                de la bibliothèque, existant ou créé maintenant, avant d'être acceptée.
              </div>
            )}
            {materiau ? (
              <div style={{
                marginTop: 5, display: "flex", alignItems: "center", gap: 10,
                padding: "9px 11px", borderRadius: RADIUS.sm,
                border: `1px solid ${acc.accent}66`, background: `${acc.accent}12`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>{materiau.nom}</div>
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 }}>
                    {[materiau.reference ? `Réf. ${materiau.reference}` : null, materiau.fournisseur || null,
                      materiau.unite ? `en ${materiau.unite}` : null].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <button onClick={() => setMateriau(null)} disabled={envoi} style={{
                  border: "none", background: "transparent", color: T.textSub,
                  fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                  textDecoration: "underline", cursor: "pointer",
                }}>Changer</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                  <Icon as={Search} size={14} style={{ color: T.textMuted, flexShrink: 0 }}/>
                  <input value={recherche} onChange={e => setRecherche(e.target.value)} disabled={envoi}
                    placeholder="Chercher un matériau (nom ou référence)"
                    style={{ ...champ, flex: 1, minWidth: 0 }}/>
                </div>
                {chercheEnCours && <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 5, fontStyle: "italic" }}>Recherche…</div>}
                {resultats.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    {resultats.map(m => (
                      <button key={m.id} onClick={() => setMateriau(m)} disabled={envoi} style={{
                        display: "flex", alignItems: "center", gap: 8, textAlign: "left", width: "100%",
                        padding: "7px 10px", borderRadius: RADIUS.sm, border: `1px solid ${T.border}`,
                        background: T.surface, fontFamily: "inherit", cursor: "pointer",
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>{m.nom}</div>
                          <div style={{ fontSize: FONT.xs.size, color: T.textMuted }}>
                            {[m.reference ? `Réf. ${m.reference}` : null, m.fournisseur || null,
                              m.unite ? `en ${m.unite}` : null].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </div>
                        <Icon as={Plus} size={14} style={{ color: T.textMuted }}/>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setCreation(true)} disabled={envoi} style={{
                  marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 12px", borderRadius: RADIUS.sm, border: `1px dashed ${acc.accent}88`,
                  background: `${acc.accent}12`, color: T.text, fontFamily: "inherit",
                  fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
                }}>
                  <Icon as={Plus} size={13}/> Créer ce matériau dans la bibliothèque
                </button>
              </>
            )}
          </div>

          {/* Quantités */}
          <div style={bloc}>
            <div style={libelle}>Quantités</div>
            <div style={{ marginTop: 6, fontSize: FONT.sm.size, color: T.textSub }}>
              Quantité totale demandée : <b style={{ color: T.text }}>{nb(suggestion.quantite_totale)} {suggestion.unite}</b>
            </div>
            {!qOuvrageOk && (
              <div style={{
                marginTop: 7, padding: "8px 10px", borderRadius: RADIUS.sm,
                background: "#f59e0b12", border: "1px solid #f59e0b44",
                fontSize: FONT.xs.size + 1, color: "#b97a10", fontWeight: 600,
              }}>
                La quantité de cet ouvrage n'est pas renseignée : la conversion automatique
                est impossible. Saisis toi-même la quantité par unité d'ouvrage.
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.sm.size, color: T.textSub }}>Quantité par unité d'ouvrage</span>
              <input value={parUnite} onChange={e => setParUnite(e.target.value)} disabled={envoi}
                inputMode="decimal" style={{ ...champ, width: 120 }}/>
              <span style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>{materiau?.unite || suggestion.unite}</span>
            </div>
            {qOuvrageOk && totalObtenu !== null && (
              <div style={{ marginTop: 5, fontSize: FONT.xs.size + 1, color: T.textMuted }}>
                soit <b style={{ color: T.text }}>{nb(totalObtenu)}</b> au total pour l'ouvrage
                {Math.abs(totalObtenu - Number(suggestion.quantite_totale)) > 1e-9 && (
                  <span style={{ color: "#b97a10", fontWeight: 700 }}>
                    {" "}— l'arrondi ne retombe pas exactement sur les {nb(suggestion.quantite_totale)} demandés.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Matériau déjà prévu */}
          {existant && (
            <div style={{ ...bloc, borderColor: "#f59e0b66", background: "#f59e0b0e" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT.sm.size, fontWeight: 800, color: "#b97a10" }}>
                <Icon as={AlertTriangle} size={14}/> Ce matériau est déjà prévu sur cet ouvrage
              </div>
              <div style={{ marginTop: 6, fontSize: FONT.xs.size + 1, color: T.textSub }}>
                Déjà prévu : <b style={{ color: T.text }}>{nb(existant.quantite)}</b> par unité
                {qOuvrageOk && totalDepuisParUnite(existant.quantite, ouvrage.quantite) !== null && (
                  <> (soit {nb(totalDepuisParUnite(existant.quantite, ouvrage.quantite))} au total)</>
                )}
                {" · "}Suggestion : <b style={{ color: T.text }}>{nb(suggestion.quantite_totale)} {suggestion.unite}</b> au total
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
                {Object.entries(ACTIONS_EXISTANT).map(([cle, texte]) => (
                  <label key={cle} style={{
                    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                    fontSize: FONT.sm.size, color: T.text,
                  }}>
                    <input type="radio" name="action-existant" checked={action === cle}
                      onChange={() => setAction(cle)} disabled={envoi}/>
                    {texte}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Résultat final */}
          {materiau && apercu.ok && (
            <div style={{
              padding: "9px 12px", borderRadius: RADIUS.md,
              background: "#22c55e12", border: "1px solid #22c55e44",
              fontSize: FONT.sm.size, color: "#1e8e4e", fontWeight: 700,
            }}>
              <Icon as={CheckCircle2} size={13}/>{" "}
              Après validation : <b>{materiau.nom}</b> sera prévu à <b>{nb(apercu.finale)}</b> par unité d'ouvrage
              {qOuvrageOk && <> , soit <b>{nb(totalDepuisParUnite(apercu.finale, ouvrage.quantite))}</b> au total</>}.
            </div>
          )}

          {erreur && (
            <div style={{ display: "flex", gap: 6, fontSize: FONT.sm.size, fontWeight: 700, color: "#c0392b" }}>
              <Icon as={AlertTriangle} size={14} style={{ flexShrink: 0, marginTop: 1 }}/>{erreur}
            </div>
          )}
        </div>

        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 10, padding: "13px 18px",
          borderTop: `1px solid ${T.sectionDivider || T.border}`,
          position: "sticky", bottom: 0, background: T.modal || T.surface,
        }}>
          <button onClick={onFerme} disabled={envoi} style={{
            padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.sm.size, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={accepter} disabled={envoi || !materiau || !apercu.ok} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 20px", borderRadius: RADIUS.md, border: "none",
            background: (!envoi && materiau && apercu.ok) ? acc.accent : T.border,
            color: (!envoi && materiau && apercu.ok) ? acc.onAccent : T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            cursor: (!envoi && materiau && apercu.ok) ? "pointer" : "not-allowed",
          }}>
            <Icon as={envoi ? Loader : Check} size={13}/>
            {envoi ? "Validation…" : "Valider et ajouter à l'ouvrage"}
          </button>
        </div>
      </div>

      {/* Le VRAI éditeur de fiche matériau, réutilisé tel quel. */}
      {creation && (
        <ArticleModal
          article={{ nom: suggestion.designation_libre || "", unite: suggestion.unite || "U" }}
          fournisseurs={fournisseurs} T={T} acc={acc}
          onClose={() => setCreation(false)}
          onSave={creerMateriau}/>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modale de refus — ne touche jamais le phasage.
// ─────────────────────────────────────────────────────────────────────────────
function ModaleRefus({ suggestion, T, acc, onFerme, onTraitee }) {
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  const refuser = async () => {
    if (envoi) return;
    setErreur(null);
    if (!motif.trim()) { setErreur("Explique le refus : l'ouvrier verra ce motif."); return; }
    setEnvoi(true);
    try {
      const { data, error } = await supabase.rpc("conducteur_refuser_suggestion_materiau", {
        p_suggestion_id: suggestion.id, p_motif: motif,
      });
      if (error) { console.error("refuser suggestion:", error); setErreur(MESSAGE_GENERIQUE); return; }
      if (!data) { setErreur(MESSAGE_REFUS_DROIT); return; }
      if (data.ok !== true) { setErreur(MESSAGES[data.code] || MESSAGE_GENERIQUE); return; }
      onTraitee("Suggestion refusée. Le phasage n'a pas été modifié.");
    } catch (e) {
      console.error("refuser suggestion:", e);
      setErreur(MESSAGE_GENERIQUE);
    } finally { setEnvoi(false); }   // le motif saisi est conservé
  };

  return (
    <>
      <div onClick={envoi ? undefined : onFerme} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(5px)", zIndex: 900,
      }}/>
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: "min(480px, calc(100vw - 24px))", zIndex: 901,
        background: T.modal || T.surface, borderRadius: RADIUS.xl,
        border: `1px solid ${T.border}`, boxShadow: "0 24px 60px rgba(0,0,0,0.4)", padding: 18,
      }}>
        <div style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text }}>Refuser la suggestion</div>
        <div style={{ marginTop: 6, fontSize: FONT.sm.size, color: T.textSub }}>
          {suggestion.materiau?.nom || suggestion.designation_libre} — {nb(suggestion.quantite_totale)} {suggestion.unite}
        </div>
        <div style={{ marginTop: 12, fontSize: 11, fontWeight: 800, color: T.textMuted, textTransform: "uppercase" }}>
          Motif (obligatoire)
        </div>
        <textarea value={motif} onChange={e => setMotif(e.target.value)} disabled={envoi}
          rows={3} maxLength={500} placeholder="Pourquoi cette demande n'est pas retenue"
          style={{
            width: "100%", boxSizing: "border-box", marginTop: 5, resize: "vertical",
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm,
            color: T.text, fontFamily: "inherit", fontSize: FONT.sm.size, padding: "8px 10px",
          }}/>
        {erreur && (
          <div style={{ marginTop: 8, fontSize: FONT.sm.size, fontWeight: 700, color: "#c0392b" }}>{erreur}</div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
          <button onClick={onFerme} disabled={envoi} style={{
            padding: "9px 18px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.sm.size, cursor: "pointer",
          }}>Annuler</button>
          <button onClick={refuser} disabled={envoi || !motif.trim()} style={{
            padding: "9px 20px", borderRadius: RADIUS.md, border: "none",
            background: motif.trim() && !envoi ? "#c0392b" : T.border,
            color: motif.trim() && !envoi ? "#fff" : T.textMuted,
            fontFamily: "inherit", fontSize: FONT.sm.size, fontWeight: 800,
            cursor: motif.trim() && !envoi ? "pointer" : "not-allowed",
          }}>{envoi ? "Refus…" : "Confirmer le refus"}</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Écran principal — sert la page centrale ET l'entrée d'une fiche chantier.
// ─────────────────────────────────────────────────────────────────────────────
export default function PageSuggestionsMateriaux({
  T, branch = "renovation", chantierId = null, chantierNom = null, onRetour = null,
}) {
  const acc = getBranchAccent(branch);
  const [filtre, setFiltre] = useState("en_attente");
  const [liste, setListe]   = useState(null);     // null = jamais chargé
  const [chargement, setChargement] = useState(true);
  const [actualise, setActualise]   = useState(false);
  const [erreur, setErreur]   = useState(false);
  const [message, setMessage] = useState(null);
  const [traiter, setTraiter] = useState(null);
  const [refuser, setRefuser] = useState(null);
  const seq = useRef(0);

  const charger = useCallback(async (premier) => {
    if (premier) setChargement(true); else setActualise(true);
    const mien = ++seq.current;
    try {
      const { data, error } = await supabase.rpc("conducteur_lister_suggestions_materiaux", {
        p_chantier_id: chantierId, p_statut: filtre,
      });
      if (reponseObsolete(mien, seq.current)) return;   // filtre changé entre-temps
      if (error || !Array.isArray(data)) {
        if (error) console.error("lister suggestions:", error);
        setErreur(true);
        if (premier) setListe(null);
        return;
      }
      setErreur(false);
      setListe(data);
    } catch (e) {
      if (!reponseObsolete(mien, seq.current)) { console.error("lister suggestions:", e); setErreur(true); }
    } finally {
      if (!reponseObsolete(mien, seq.current)) { setChargement(false); setActualise(false); }
    }
  }, [chantierId, filtre]);

  useEffect(() => { charger(liste === null); }, [charger]); // eslint-disable-line react-hooks/exhaustive-deps

  const apresTraitement = async (texte) => {
    setTraiter(null); setRefuser(null);
    setMessage(texte);
    setTimeout(() => setMessage(null), 4000);
    await charger(false);   // la suggestion quitte « En attente », compteurs à jour
  };

  const carte = (s) => {
    const traitable = estTraitable(s);
    return (
      <div key={s.id} style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.lg,
        padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text }}>
              {s.materiau?.nom || s.designation_libre}
              {!s.materiau && (
                <span style={{ marginLeft: 8, fontSize: FONT.xs.size, fontWeight: 700, color: "#b97a10" }}>
                  saisie libre
                </span>
              )}
            </div>
            <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, marginTop: 2 }}>
              {[s.materiau?.reference ? `Réf. ${s.materiau.reference}` : null,
                s.materiau?.fournisseur || null].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <div style={{ fontSize: FONT.base.size, fontWeight: 800, color: T.text, whiteSpace: "nowrap" }}>
            {nb(s.quantite_totale)} {s.unite}
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: FONT.xs.size + 1, color: T.textSub }}>
          {!chantierId && <span><Icon as={Building2} size={11}/> {s.chantier_nom || s.chantier_id}</span>}
          <span><Icon as={Package} size={11}/> {[s.ouvrage?.code, s.ouvrage?.libelle].filter(Boolean).join(" · ") || "ouvrage inconnu"}</span>
          <span><Icon as={User} size={11}/> {s.auteur?.nom || "—"}</span>
          <span><Icon as={Clock} size={11}/> {dateFr(s.cree_le)}</span>
        </div>

        {s.precision && (
          <div style={{ fontSize: FONT.sm.size, color: T.textSub, fontStyle: "italic" }}>« {s.precision} »</div>
        )}

        {s.traitement && (
          <div style={{
            fontSize: FONT.xs.size + 1, color: T.textMuted,
            borderTop: `1px solid ${T.sectionDivider || T.border}`, paddingTop: 7,
          }}>
            {s.statut === "acceptee"
              ? <><Icon as={CheckCircle2} size={11} style={{ color: "#22c55e" }}/> Acceptée</>
              : <><Icon as={XCircle} size={11} style={{ color: "#c0392b" }}/> Refusée</>}
            {" "}par {s.traitement.par || "—"} le {dateFr(s.traitement.le)}
            {s.traitement.motif_refus && <> — « {s.traitement.motif_refus} »</>}
          </div>
        )}

        {traitable && (
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button onClick={() => setRefuser(s)} style={{
              padding: "7px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
              background: "transparent", color: T.textSub, fontFamily: "inherit",
              fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
            }}>Refuser</button>
            <button onClick={() => setTraiter(s)} style={{
              padding: "7px 16px", borderRadius: RADIUS.md, border: "none",
              background: acc.accent, color: acc.onAccent, fontFamily: "inherit",
              fontSize: FONT.xs.size + 1, fontWeight: 800, cursor: "pointer",
            }}>Traiter</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {onRetour && (
          <button onClick={onRetour} style={{
            padding: "7px 14px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
            background: "transparent", color: T.textSub, fontFamily: "inherit",
            fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
          }}>← Retour</button>
        )}
        <Icon as={Lightbulb} size={19} color={acc.accent}/>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: FONT.lg.size, fontWeight: 800, color: T.text }}>Suggestions de matériaux</div>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted }}>
            {chantierId ? `Chantier ${chantierNom || chantierId}` : "Tous les chantiers"}
            {Array.isArray(liste) && ` · ${liste.length} ${liste.length > 1 ? "suggestions" : "suggestion"}`}
          </div>
        </div>
        <button onClick={() => charger(false)} disabled={actualise || chargement} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 13px", borderRadius: RADIUS.md, border: `1px solid ${T.border}`,
          background: T.surface, color: T.textSub, fontFamily: "inherit",
          fontSize: FONT.xs.size + 1, fontWeight: 700,
          cursor: (actualise || chargement) ? "default" : "pointer",
          opacity: (actualise || chargement) ? 0.5 : 1,
        }}>
          <Icon as={actualise ? Loader : RefreshCw} size={13}/>{actualise ? "…" : "Actualiser"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {FILTRES.map(f => {
          const actif = filtre === f.cle;
          return (
            <button key={f.cle} onClick={() => setFiltre(filtreValide(f.cle))} style={{
              padding: "6px 14px", borderRadius: RADIUS.pill,
              border: `1px solid ${actif ? acc.accent : T.border}`,
              background: actif ? `${acc.accent}1a` : "transparent",
              color: actif ? T.text : T.textSub, fontFamily: "inherit",
              fontSize: FONT.xs.size + 1, fontWeight: actif ? 800 : 600, cursor: "pointer",
            }}>{f.label}</button>
          );
        })}
      </div>

      {message && (
        <div style={{
          padding: "9px 12px", borderRadius: RADIUS.md,
          background: "#22c55e12", border: "1px solid #22c55e44",
          fontSize: FONT.sm.size, fontWeight: 700, color: "#1e8e4e",
        }}><Icon as={CheckCircle2} size={13}/> {message}</div>
      )}

      {chargement && liste === null && (
        <div style={{ padding: "40px 20px", textAlign: "center", color: T.textMuted, fontSize: FONT.sm.size, letterSpacing: 2 }}>
          CHARGEMENT…
        </div>
      )}

      {erreur && (
        <div style={{
          padding: "16px", borderRadius: RADIUS.lg, textAlign: "center",
          background: T.surface, border: "1px solid #c0392b44",
        }}>
          <div style={{ fontSize: FONT.sm.size, fontWeight: 700, color: T.text }}>
            Les suggestions n'ont pas pu être chargées.
          </div>
          <button onClick={() => charger(liste === null)} style={{
            marginTop: 10, padding: "8px 18px", borderRadius: RADIUS.md, border: "none",
            background: acc.accent, color: acc.onAccent, fontFamily: "inherit",
            fontSize: FONT.sm.size, fontWeight: 800, cursor: "pointer",
          }}>Réessayer</button>
        </div>
      )}

      {Array.isArray(liste) && liste.length === 0 && !chargement && (
        <div style={{
          padding: "34px 20px", textAlign: "center", borderRadius: RADIUS.lg,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Icon as={Info} size={22} style={{ color: T.textMuted }}/>
          <div style={{ marginTop: 8, fontSize: FONT.sm.size, color: T.textSub }}>
            {filtre === "en_attente"
              ? "Aucune suggestion en attente."
              : `Aucune suggestion ${LIBELLES_STATUT[filtre].toLowerCase()}.`}
          </div>
        </div>
      )}

      {Array.isArray(liste) && liste.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{liste.map(carte)}</div>
      )}

      {traiter && (
        <ModaleTraitement suggestion={traiter} T={T} acc={acc}
          onFerme={() => setTraiter(null)} onTraitee={apresTraitement}/>
      )}
      {refuser && (
        <ModaleRefus suggestion={refuser} T={T} acc={acc}
          onFerme={() => setRefuser(null)} onTraitee={apresTraitement}/>
      )}
    </div>
  );
}
