// ─────────────────────────────────────────────────────────────────────────────
// ESPACE OUVRIER — écran « Préparation du chantier ».
//
// Niveau 4 de la navigation par état de OuvrierChantiers :
//   Opérations → Chantiers → Détail du chantier → PRÉPARATION
// Aucun routeur d'URL, aucun onglet supplémentaire : le parent garde son
// chantier et son opération, cet écran reçoit juste un callback de retour.
//
// SOURCE DE DONNÉES UNIQUE : la RPC ouvrier_preparation_chantier
// (sql/202609_ouvrier_preparation_chantier.sql). Cet écran ne lit JAMAIS
// phasages, materiaux_bibliotheque ni planning_config — ces tables sont
// bureau-only, et la RPC est précisément le guichet qui en extrait un
// sous-ensemble sans prix, sans coût, sans marge et sans heures vendues.
//
// Lecture seule : aucune case à cocher, aucun avancement modifiable, aucune
// écriture. Pas d'abonnement temps réel non plus — les modifications du
// conducteur apparaissent à l'actualisation, ce que l'en-tête annonce.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { supabase } from "../supabase";
import { Icon } from "../ui";
import { RADIUS } from "../constants";
import {
  ArrowLeft, RefreshCw, ClipboardList, Package, ListChecks, ChevronRight,
  ChevronDown, AlertTriangle, Info, CheckCircle2, Circle, Loader, ShoppingCart,
  Search, Plus, X, Send, Clock,
} from "lucide-react";
import { MobileCard, MobileEmptyState, Pill, SummaryBar } from "../mobileUI";
import {
  phasesVisibles, phaseParDefaut, compterTaches, etatOuvrage, etatTache,
  avancementAffichable, formaterQuantite, ecranModele, PHASE_A_ORGANISER,
} from "./preparationChantier";
import {
  validerQuantite, validerChoixMateriau, grouperParOuvrage, doublonLocal,
  reponseObsolete, PRECISION_MAX,
} from "./suggestionsMateriaux";

// Messages rendus à l'ouvrier pour chaque code renvoyé par la RPC. Le détail
// technique, lui, reste dans la console.
const MESSAGES_ENVOI = {
  doublon:             "Cette suggestion est déjà en attente pour cet ouvrage.",
  quantite_invalide:   "Indique une quantité supérieure à zéro.",
  source_invalide:     "Choisis soit un matériau de la bibliothèque, soit une saisie libre.",
  unite_requise:       "Indique l'unité.",
  materiau_inconnu:    "Ce matériau n'existe plus dans la bibliothèque.",
  ouvrage_inconnu:     "Cet ouvrage n'a pas pu être retrouvé. Actualise la préparation.",
  phasage_introuvable: "La préparation de ce chantier a changé. Actualise l'écran.",
};
const MESSAGE_REFUS   = "Ton compte ne permet pas d'envoyer une suggestion.";
const MESSAGE_GENERIQUE = "L'envoi n'a pas abouti. Vérifie ta connexion et réessaie.";

const dateFr = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
};

const GRIS = "#94a3b8";

// Nombre de matériaux affichés d'emblée. Au-delà, le reste est replié :
// certains ouvrages en comptent plus de trente, et dérouler la liste entière
// transforme la phase en tunnel vertical.
const MATERIAUX_VISIBLES = 5;
// Lignes de libellé montrées avant repli. Les libellés viennent des devis et
// font couramment 8 à 15 lignes.
const LIGNES_LIBELLE = 3;

// Accords simples. Centraliser ici évite de réécrire la même ternaire partout
// et de laisser passer un « 0/6 terminée ».
const s  = (n) => (n > 1 ? "s" : "");
const sx = (n) => (n > 1 ? "x" : "");

// Anneau de focus : sur mobile, le contour noir du navigateur restait affiché
// après un simple appui. On le supprime au focus ordinaire et on le rend au
// focus CLAVIER (:focus-visible), dans la couleur passée en --prep-focus —
// l'accessibilité est préservée, le contour parasite disparaît.
const STYLE_INJECTE = { current: false };
function injecterStyles() {
  if (STYLE_INJECTE.current || typeof document === "undefined") return;
  STYLE_INJECTE.current = true;
  const el = document.createElement("style");
  el.textContent = `
    .prep-btn { -webkit-tap-highlight-color: transparent; }
    .prep-btn:focus { outline: none; }
    .prep-btn:focus-visible {
      outline: 2px solid var(--prep-focus, #5b8af5);
      outline-offset: -2px;
    }
  `;
  document.head.appendChild(el);
}

// Libellé d'ouvrage : limité à LIGNES_LIBELLE lignes, jamais tronqué dans les
// données. Le bouton « Voir le descriptif complet » n'apparaît que si le texte
// DÉBORDE RÉELLEMENT — mesuré sur le DOM (scrollHeight vs clientHeight), pas
// deviné à partir d'un nombre de caractères, qui dépendrait de la largeur de
// l'écran et de la longueur des mots.
function LibelleOuvrage({ libelle, ouvert, T }) {
  const ref = useRef(null);
  const [deborde, setDeborde] = useState(false);
  const [deplie, setDeplie]   = useState(false);

  // Refermer l'ouvrage remet son descriptif à l'état réduit : en le rouvrant,
  // on retrouve toujours la même chose.
  useEffect(() => { if (!ouvert) setDeplie(false); }, [ouvert]);

  useLayoutEffect(() => {
    // En mode déplié la mesure n'a plus de sens (le texte n'est plus borné) :
    // on garde la dernière valeur connue, sinon le bouton disparaîtrait.
    if (deplie) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    const mesurer = () => setDeborde(el.scrollHeight > el.clientHeight + 1);
    mesurer();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(mesurer); // rotation, changement de largeur
    ro.observe(el);
    return () => ro.disconnect();
  }, [libelle, deplie, ouvert]);

  const clamp = deplie ? {} : {
    display: "-webkit-box",
    WebkitLineClamp: LIGNES_LIBELLE,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };

  return (
    <>
      <div ref={ref} style={{ fontSize: 14, fontWeight: 800, color: T.text, lineHeight: 1.35, ...clamp }}>
        {libelle}
      </div>
      {ouvert && deborde && (
        <button className="prep-btn"
          onClick={(e) => { e.stopPropagation(); setDeplie(v => !v); }}
          style={{
            marginTop: 4, padding: 0, border: "none", background: "transparent",
            color: T.textSub, fontFamily: "inherit", fontSize: 12,
            fontWeight: 700, textDecoration: "underline", cursor: "pointer",
          }}>
          {deplie ? "Réduire le descriptif" : "Voir le descriptif complet"}
        </button>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Formulaire « Suggérer un matériau », rendu DANS la carte d'un ouvrage.
// Deux modes exclusifs : un matériau de la bibliothèque (cherché par RPC) ou
// une saisie libre. La validation locale sert le confort ; la RPC revalide
// tout côté serveur — source, unité, appartenance de l'ouvrage, auteur, date
// et statut sont imposés là-bas, jamais ici.
// ─────────────────────────────────────────────────────────────────────────────
function FormulaireSuggestion({
  chantierId, ouvrageId, suggestionsOuvrage, T, accent, preview, onFerme, onEnvoye,
}) {
  const [mode, setMode]           = useState("recherche"); // recherche | libre
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  const [choisi, setChoisi]       = useState(null);
  const [designation, setDesignation] = useState("");
  const [uniteLibre, setUniteLibre]   = useState("");
  const [quantite, setQuantite]   = useState("");
  const [precision, setPrecision] = useState("");
  const [envoi, setEnvoi]         = useState(false);
  const [erreur, setErreur]       = useState(null);
  const seq = useRef(0);

  // Recherche débouncée. `seq` empêche qu'une réponse lente écrase le
  // résultat d'une frappe plus récente.
  useEffect(() => {
    if (mode !== "recherche" || choisi) return undefined;
    const q = recherche.trim();
    if (q.length < 2) { setResultats([]); setChercheEnCours(false); return undefined; }
    const mien = ++seq.current;
    setChercheEnCours(true);
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.rpc("ouvrier_rechercher_materiaux", { p_recherche: q });
        if (reponseObsolete(mien, seq.current)) return;
        if (error) { console.error("ouvrier_rechercher_materiaux:", error); setResultats([]); }
        else setResultats(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!reponseObsolete(mien, seq.current)) { console.error("recherche matériaux:", e); setResultats([]); }
      } finally {
        if (!reponseObsolete(mien, seq.current)) setChercheEnCours(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [recherche, mode, choisi]);

  // Changer de mode n'emporte jamais silencieusement les champs de l'autre
  // mode : on les vide explicitement.
  const versLibre = () => {
    setMode("libre"); setChoisi(null); setRecherche(""); setResultats([]); setErreur(null);
  };
  const versRecherche = () => {
    setMode("recherche"); setDesignation(""); setUniteLibre(""); setErreur(null);
  };

  const uniteAffichee = mode === "libre" ? uniteLibre.trim() : (choisi?.unite || "");

  const envoyer = async () => {
    if (envoi || preview) return;
    setErreur(null);
    const choix = validerChoixMateriau({
      materiau: mode === "recherche" ? choisi : null,
      designation: mode === "libre" ? designation : "",
      unite: mode === "libre" ? uniteLibre : "",
    });
    if (!choix.ok) { setErreur(choix.erreur); return; }
    const q = validerQuantite(quantite);
    if (!q.ok) { setErreur(q.erreur); return; }
    if (doublonLocal(suggestionsOuvrage, {
      materiau: mode === "recherche" ? choisi : null,
      designation: mode === "libre" ? designation : "",
    })) { setErreur(MESSAGES_ENVOI.doublon); return; }

    setEnvoi(true);
    try {
      const { data, error } = await supabase.rpc("ouvrier_suggerer_materiau", {
        p_chantier_id: chantierId,
        p_ouvrage_id: ouvrageId,
        p_materiau_id: choix.mode === "bibliotheque" ? choix.materiau_id : null,
        p_designation_libre: choix.mode === "libre" ? choix.designation_libre : null,
        p_unite: choix.mode === "libre" ? choix.unite : null,
        p_quantite_totale: q.valeur,
        p_precision: precision.trim() || null,
      });
      if (error) { console.error("ouvrier_suggerer_materiau:", error); setErreur(MESSAGE_GENERIQUE); return; }
      if (!data) { setErreur(MESSAGE_REFUS); return; }          // null = compte non autorisé
      if (data.ok !== true) { setErreur(MESSAGES_ENVOI[data.code] || MESSAGE_GENERIQUE); return; }
      onEnvoye();                                               // recharge les seules suggestions
    } catch (e) {
      console.error("ouvrier_suggerer_materiau:", e);
      setErreur(MESSAGE_GENERIQUE);
    } finally {
      setEnvoi(false);   // la saisie est conservée : en cas d'erreur, rien n'est perdu
    }
  };

  const champ = {
    width: "100%", boxSizing: "border-box",
    background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm,
    color: T.text, fontFamily: "inherit", fontSize: 13.5, padding: "8px 10px",
  };
  const label = { fontSize: 11.5, fontWeight: 800, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.4 };
  const lien  = {
    padding: 0, border: "none", background: "transparent", color: T.textSub,
    fontFamily: "inherit", fontSize: 12, fontWeight: 700,
    textDecoration: "underline", cursor: "pointer",
  };

  return (
    <div style={{ padding: "10px 11px", borderTop: `1px solid ${T.border}`, background: T.card,
      display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...label, flex: 1 }}>Suggérer un matériau</span>
        <button className="prep-btn" onClick={onFerme} title="Fermer"
          style={{ ...lien, textDecoration: "none", display: "inline-flex" }}>
          <Icon as={X} size={15}/>
        </button>
      </div>

      {mode === "recherche" ? (
        <>
          {choisi ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
              borderRadius: RADIUS.sm, border: `1px solid ${accent}66`, background: `${accent}12` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>{choisi.nom}</div>
                <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>
                  {[choisi.reference ? `Réf. ${choisi.reference}` : null, choisi.fournisseur || null,
                    choisi.unite ? `en ${choisi.unite}` : null].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <button className="prep-btn" onClick={() => setChoisi(null)} disabled={envoi} style={lien}>Changer</button>
            </div>
          ) : (
            <>
              <div>
                <div style={label}>Rechercher dans la bibliothèque</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <Icon as={Search} size={14} style={{ color: T.textMuted, flexShrink: 0 }}/>
                  <input value={recherche} onChange={e => setRecherche(e.target.value)} disabled={envoi}
                    placeholder="Nom ou référence (2 caractères minimum)" style={champ}/>
                </div>
              </div>
              {chercheEnCours && (
                <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>Recherche…</div>
              )}
              {!chercheEnCours && recherche.trim().length >= 2 && resultats.length === 0 && (
                <div style={{ fontSize: 12, color: T.textMuted, fontStyle: "italic" }}>
                  Aucun matériau trouvé dans la bibliothèque.
                </div>
              )}
              {resultats.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {resultats.map(m => (
                    <button key={m.id} className="prep-btn" onClick={() => setChoisi(m)} disabled={envoi}
                      style={{ display: "flex", textAlign: "left", padding: "7px 9px", borderRadius: RADIUS.sm,
                        border: `1px solid ${T.border}`, background: T.surface, fontFamily: "inherit",
                        cursor: "pointer", width: "100%" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nom}</div>
                        <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 2 }}>
                          {[m.reference ? `Réf. ${m.reference}` : null, m.fournisseur || null,
                            m.unite ? `en ${m.unite}` : null].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <Icon as={Plus} size={14} style={{ color: T.textMuted, flexShrink: 0 }}/>
                    </button>
                  ))}
                </div>
              )}
              <button className="prep-btn" onClick={versLibre} disabled={envoi} style={lien}>
                Le matériau n'est pas dans la bibliothèque
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <div>
            <div style={label}>Désignation</div>
            <input value={designation} onChange={e => setDesignation(e.target.value)} disabled={envoi}
              placeholder="Ce qu'il faut commander" style={{ ...champ, marginTop: 4 }} maxLength={200}/>
          </div>
          <div>
            <div style={label}>Unité</div>
            <input value={uniteLibre} onChange={e => setUniteLibre(e.target.value)} disabled={envoi}
              placeholder="sac, m², U…" style={{ ...champ, marginTop: 4, width: 110 }} maxLength={20}/>
          </div>
          <button className="prep-btn" onClick={versRecherche} disabled={envoi} style={lien}>
            Revenir à la recherche dans la bibliothèque
          </button>
        </>
      )}

      <div>
        <div style={label}>Quantité totale nécessaire</div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
          <input value={quantite} onChange={e => setQuantite(e.target.value)} disabled={envoi}
            inputMode="decimal" placeholder="0" style={{ ...champ, width: 110 }} maxLength={15}/>
          <span style={{ fontSize: 13, color: T.textSub }}>{uniteAffichee || "—"}</span>
        </div>
        <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 3 }}>
          Pour tout le chantier, pas par unité d'ouvrage.
        </div>
      </div>

      <div>
        <div style={label}>Précision pour le conducteur (facultatif)</div>
        <textarea value={precision} onChange={e => setPrecision(e.target.value)} disabled={envoi}
          rows={2} maxLength={PRECISION_MAX} placeholder="Où, pourquoi, quelle finition…"
          style={{ ...champ, marginTop: 4, resize: "vertical" }}/>
      </div>

      {erreur && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5,
          fontWeight: 700, color: "#c0392b" }}>
          <Icon as={AlertTriangle} size={13} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }}/>
          {erreur}
        </div>
      )}

      {preview && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12,
          color: T.textMuted, fontStyle: "italic" }}>
          <Icon as={Info} size={12} style={{ flexShrink: 0, marginTop: 2 }}/>
          L'aperçu administrateur ne permet pas d'envoyer une suggestion.
        </div>
      )}

      <button className="prep-btn" onClick={envoyer} disabled={envoi || preview}
        style={{
          width: "100%", padding: "10px", borderRadius: RADIUS.md, border: "none",
          background: (envoi || preview) ? T.border : accent,
          color: (envoi || preview) ? T.textMuted : "#1a1f2e",
          fontFamily: "inherit", fontSize: 13.5, fontWeight: 800,
          cursor: (envoi || preview) ? "default" : "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
        <Icon as={envoi ? Loader : Send} size={14} strokeWidth={2.3}/>
        {envoi ? "Envoi…" : "Envoyer la suggestion"}
      </button>
    </div>
  );
}

export default function OuvrierPreparationChantier({ chantier, T, accent = "#FFC200", onRetour, preview = false }) {
  const [payload, setPayload]   = useState(null);   // dernier payload affichable
  const [chargement, setChargement] = useState(true); // premier chargement
  const [actualise, setActualise]   = useState(false); // actualisation en cours
  const [erreur, setErreur]     = useState(false);
  const [okMessage, setOkMessage] = useState(false);
  const [phaseOuverte, setPhaseOuverte]     = useState(null);
  const [ouvrageOuvert, setOuvrageOuvert]   = useState(null);
  // Liste de matériaux dépliée pour l'ouvrage ouvert. Un seul ouvrage étant
  // ouvert à la fois, un booléen suffit — et refermer remet la liste réduite.
  const [matsDeplies, setMatsDeplies]       = useState(false);
  // Suggestions EN ATTENTE du chantier, regroupées par ouvrage. Chargées par
  // leur propre RPC : envoyer une suggestion ne recharge jamais toute la
  // préparation, seulement cette liste.
  const [suggestions, setSuggestions] = useState({});
  const [formOuvert, setFormOuvert]   = useState(null); // clé phase::ouvrage
  const [okSuggestion, setOkSuggestion] = useState(false);

  injecterStyles();

  // Changer d'ouvrage remet sa liste de matériaux à l'état réduit.
  const ouvrirOuvrage = (cle) => {
    setOuvrageOuvert(prev => (prev === cle ? null : cle));
    setMatsDeplies(false);
    setFormOuvert(null);   // refermer un ouvrage referme son formulaire
  };

  // Un seul chemin de chargement, utilisé au montage ET par « Actualiser ».
  // Pendant une actualisation, l'ancien contenu reste à l'écran : on ne vide
  // jamais la préparation d'un ouvrier qui est en train de la lire.
  const charger = useCallback(async (estPremier) => {
    if (estPremier) setChargement(true); else setActualise(true);
    setOkMessage(false);
    try {
      const { data, error } = await supabase.rpc("ouvrier_preparation_chantier", {
        p_chantier_id: chantier?.id,
      });
      // data null = compte sans profil applicatif actif (garde de la RPC).
      if (error || !data) {
        // Le détail technique va à la console, jamais à l'écran de l'ouvrier.
        console.error("ouvrier_preparation_chantier:", error || "réponse vide");
        if (estPremier || !payload) { setErreur(true); setPayload(null); }
        else setErreur(true); // on garde l'ancien contenu sous le bandeau d'erreur
        return;
      }
      setErreur(false);
      setPayload(data);
      // La phase dépliée est recalculée à chaque chargement : après une
      // actualisation, l'ouvrier retombe sur la première phase en retard.
      setPhaseOuverte(phaseParDefaut(data));
      setOuvrageOuvert(null);
      if (!estPremier) {
        setOkMessage(true);
        setTimeout(() => setOkMessage(false), 2500);
      }
    } catch (e) {
      console.error("ouvrier_preparation_chantier:", e);
      setErreur(true);
      if (estPremier) setPayload(null);
    } finally {
      setChargement(false);
      setActualise(false);
    }
  }, [chantier?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Suggestions en attente : chargement indépendant de la préparation. Un
  // échec ici ne doit pas priver l'ouvrier de sa préparation.
  const chargerSuggestions = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("ouvrier_suggestions_chantier", {
        p_chantier_id: chantier?.id,
      });
      if (error || !Array.isArray(data)) {
        if (error) console.error("ouvrier_suggestions_chantier:", error);
        setSuggestions({});
        return;
      }
      setSuggestions(grouperParOuvrage(data));
    } catch (e) {
      console.error("ouvrier_suggestions_chantier:", e);
      setSuggestions({});
    }
  }, [chantier?.id]);

  // Appel à chaque ouverture de l'écran (le composant est monté/démonté par
  // le parent), et à chaque changement de chantier.
  useEffect(() => { charger(true); }, [charger]);
  useEffect(() => { chargerSuggestions(); }, [chargerSuggestions]);

  // ── Styles partagés ───────────────────────────────────────────────────────
  const carteStyle = { padding: "12px 14px" };
  const libelle = { fontSize: 12, color: T.textSub };
  const muted   = { fontSize: 12, color: T.textMuted };

  const boutonRetour = (
    <button onClick={onRetour} style={{
      alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 7,
      background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: "9px 14px", color: T.textSub, cursor: "pointer",
      fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
    }}>
      <Icon as={ArrowLeft} size={15}/> Retour au chantier
    </button>
  );

  const visibles = payload ? phasesVisibles(payload) : [];
  const ecran    = payload ? ecranModele(payload) : null;
  const compteurs = payload?.compteurs || {};

  const enTete = (
    <MobileCard T={T} accent={accent} style={{ padding: "13px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon as={ClipboardList} size={16} color={accent} strokeWidth={2.3}/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>
            Préparation du chantier
          </div>
          <div style={{ ...muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {chantier?.nom || payload?.chantier_nom || ""}
          </div>
        </div>
        <button onClick={() => charger(false)} disabled={actualise || chargement}
          title="Recharger la préparation"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.md,
            padding: "7px 11px", color: T.textSub, fontFamily: "inherit",
            fontSize: 12.5, fontWeight: 700,
            cursor: (actualise || chargement) ? "default" : "pointer",
            opacity: (actualise || chargement) ? 0.5 : 1,
          }}>
          <Icon as={actualise ? Loader : RefreshCw} size={13} strokeWidth={2.4}/>
          {actualise ? "…" : "Actualiser"}
        </button>
      </div>

      {payload && !ecran && (
        <div style={{ marginTop: 11 }}>
          <SummaryBar T={T} items={[
            { label: visibles.length > 1 ? "Phases" : "Phase", value: String(visibles.length), color: accent, icon: ListChecks },
            { label: "Ouvrages", value: String(compteurs.ouvrages_uniques ?? "—"), color: "#5b8af5", icon: Package },
            { label: "Tâches",   value: String(compteurs.taches ?? "—"),           color: "#8b5cf6", icon: ClipboardList },
          ]}/>
          {/* Le compteur affiché est celui des phases VISIBLES. Les phases
              sans ouvrage restent masquées et hors comptage, mais on ne le
              dit plus : sur le terrain, cette phrase n'apportait rien. */}
        </div>
      )}

      <div style={{ ...muted, marginTop: 9, display: "flex", alignItems: "center", gap: 5 }}>
        <Icon as={Info} size={12} style={{ flexShrink: 0 }}/>
        Les modifications du conducteur apparaissent après actualisation.
      </div>
      {okMessage && (
        <div style={{ marginTop: 7, fontSize: 12, fontWeight: 700, color: "#1e8e4e",
          display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={CheckCircle2} size={12} strokeWidth={2.5}/> Préparation à jour.
        </div>
      )}
      {okSuggestion && (
        <div style={{ marginTop: 7, fontSize: 12, fontWeight: 700, color: "#1e8e4e",
          display: "flex", alignItems: "center", gap: 5 }}>
          <Icon as={CheckCircle2} size={12} strokeWidth={2.5}/> Suggestion envoyée au conducteur.
        </div>
      )}
    </MobileCard>
  );

  // ── Une tâche ─────────────────────────────────────────────────────────────
  const ligneTache = (t) => {
    const e = etatTache(t);
    const pct = avancementAffichable(t);
    return (
      <div key={t.id || t.nom} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 10px", borderTop: `1px solid ${T.border}`,
      }}>
        <Icon as={e.cle === "terminee" ? CheckCircle2 : Circle} size={14}
          style={{ color: e.couleur, flexShrink: 0 }} strokeWidth={2.2}/>
        <span style={{
          flex: 1, minWidth: 0, fontSize: 13.5, color: T.text,
          textDecoration: e.cle === "terminee" ? "line-through" : "none",
          opacity: e.cle === "terminee" ? 0.65 : 1,
        }}>{t.nom}</span>
        {pct !== null && <span style={{ fontSize: 12, fontWeight: 700, color: e.couleur }}>{pct} %</span>}
        <Pill color={e.couleur}>{e.label}</Pill>
      </div>
    );
  };

  // ── Un matériau ───────────────────────────────────────────────────────────
  const ligneMateriau = (m, i) => {
    const total = formaterQuantite(m.quantite_totale);
    const parU  = formaterQuantite(m.quantite_par_unite);
    return (
      <div key={`${m.materiau_id || "x"}-${i}`} style={{
        padding: "9px 10px", borderTop: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13.5, fontWeight: 700,
              color: m.introuvable ? "#c0392b" : T.text,
              fontStyle: m.introuvable ? "italic" : "normal",
            }}>
              {m.introuvable ? "Matériau introuvable" : m.nom}
            </div>
            <div style={{ ...muted, marginTop: 2 }}>
              {[m.reference ? `Réf. ${m.reference}` : null, m.fournisseur || null]
                .filter(Boolean).join(" · ") || (m.introuvable ? "Retiré de la bibliothèque" : "—")}
            </div>
          </div>
          {m.commande_le && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
              padding: "2px 7px", borderRadius: 999, border: "1px solid #22c55e55",
              background: "#22c55e14", color: "#1e8e4e", fontSize: 11, fontWeight: 700,
            }}>
              <Icon as={ShoppingCart} size={10} strokeWidth={2.4}/> Commandé
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: total === null ? T.textMuted : T.text }}>
            {total === null ? "Quantité totale à définir" : `${total} ${m.unite || ""}`.trim()}
          </span>
          {parU !== null && (
            <span style={muted}>soit {parU} {m.unite || ""} par unité d'ouvrage</span>
          )}
        </div>
      </div>
    );
  };

  // ── Un ouvrage ────────────────────────────────────────────────────────────
  const carteOuvrage = (o, phaseId, couleurPhase) => {
    const cle = `${phaseId}::${o.id}`;
    const ouvert = ouvrageOuvert === cle;
    const e = etatOuvrage(o);
    const nbT = (o.taches || []).length;
    const mats = o.materiaux || [];
    // Limitation d'AFFICHAGE seulement : l'ordre reçu est conservé, rien n'est
    // agrégé, réordonné ni retiré des données.
    const matsAffiches = (ouvert && !matsDeplies && mats.length > MATERIAUX_VISIBLES)
      ? mats.slice(0, MATERIAUX_VISIBLES) : mats;
    const restants = mats.length - matsAffiches.length;
    return (
      <div key={cle} style={{
        // Ouvert, la carte prend la couleur de la phase plutôt qu'un contour
        // appuyé : on voit où l'on est sans que le bloc écrase la liste.
        border: `1px solid ${ouvert ? `${couleurPhase}66` : T.border}`,
        borderRadius: RADIUS.md,
        background: T.surface, overflow: "hidden",
      }}>
        <button className="prep-btn" onClick={() => ouvrirOuvrage(cle)}
          style={{
            width: "100%", textAlign: "left", display: "flex", alignItems: "flex-start", gap: 9,
            padding: "10px 11px", border: "none", background: "transparent",
            fontFamily: "inherit", cursor: "pointer", borderRadius: RADIUS.md,
            "--prep-focus": couleurPhase,
          }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Le code reste sur sa propre ligne : il ne doit jamais être
                emporté par le repli du libellé. */}
            {o.code_ouvrage && (
              <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textMuted, letterSpacing: 0.3, marginBottom: 2 }}>
                {o.code_ouvrage}
              </div>
            )}
            <LibelleOuvrage libelle={o.libelle} ouvert={ouvert} T={T}/>
            <div style={{ ...muted, marginTop: 3 }}>
              {[
                o.quantite !== null && o.quantite !== undefined
                  ? `${formaterQuantite(o.quantite) ?? "?"} ${o.unite || ""}`.trim() : null,
                `${nbT} tâche${s(nbT)} dans cette phase`,
                mats.length > 0 ? `${mats.length} matériau${sx(mats.length)}` : null,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Pill color={e.couleur}>{e.label}</Pill>
          <Icon as={ouvert ? ChevronDown : ChevronRight} size={16}
            style={{ color: T.textMuted, flexShrink: 0, marginTop: 2 }}/>
        </button>

        {ouvert && (
          <div>
            {/* 1 — Tâches de CETTE phase */}
            <div style={{
              padding: "7px 11px", background: T.card,
              borderTop: `1px solid ${T.border}`,
              fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
              textTransform: "uppercase", color: T.textMuted,
            }}>
              Tâches de cette phase
            </div>
            {nbT === 0 ? (
              <div style={{ padding: "10px 11px", fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
                Aucune tâche définie pour cet ouvrage
              </div>
            ) : (o.taches || []).map(ligneTache)}

            {/* 2 — Matériaux de l'OUVRAGE ENTIER. La mention est obligatoire :
                   un ouvrage peut apparaître dans plusieurs phases, et ses
                   matériaux y sont répétés — ils ne se commandent qu'une fois. */}
            <div style={{
              padding: "7px 11px", background: T.card,
              borderTop: `1px solid ${T.border}`,
              fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
              textTransform: "uppercase", color: T.textMuted,
            }}>
              {o.materiaux_portee === "ouvrage_complet"
                ? "Matériaux prévus pour l'ensemble de cet ouvrage"
                : "Matériaux prévus"}
            </div>
            {mats.length === 0 ? (
              <div style={{ padding: "10px 11px", fontSize: 13, color: T.textMuted, fontStyle: "italic" }}>
                Aucun matériau prévu pour cet ouvrage
              </div>
            ) : (
              <>
                {matsAffiches.map(ligneMateriau)}
                {(restants > 0 || matsDeplies) && mats.length > MATERIAUX_VISIBLES && (
                  <button className="prep-btn"
                    onClick={() => setMatsDeplies(v => !v)}
                    style={{
                      width: "100%", padding: "9px 11px",
                      border: "none", borderTop: `1px solid ${T.border}`,
                      background: T.card, color: T.textSub, fontFamily: "inherit",
                      fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                      "--prep-focus": couleurPhase,
                    }}>
                    {restants > 0 ? `Voir les ${restants} autres matériaux` : "Réduire la liste"}
                  </button>
                )}
              </>
            )}

            {/* ── Suggérer un matériau ── */}
            {/* Seulement sur une préparation exploitable et un ouvrage
                identifié : sans id d'ouvrage, la RPC refuserait de toute façon. */}
            {payload?.modele === "v2" && o.id && (
              formOuvert === cle ? (
                <FormulaireSuggestion
                  chantierId={chantier?.id} ouvrageId={o.id}
                  suggestionsOuvrage={suggestions[String(o.id)] || []}
                  T={T} accent={accent} preview={preview}
                  onFerme={() => setFormOuvert(null)}
                  onEnvoye={async () => {
                    setFormOuvert(null);
                    await chargerSuggestions();
                    setOkSuggestion(true);
                    setTimeout(() => setOkSuggestion(false), 3000);
                  }}/>
              ) : (
                <button className="prep-btn" onClick={() => setFormOuvert(cle)}
                  style={{
                    width: "100%", padding: "9px 11px",
                    border: "none", borderTop: `1px solid ${T.border}`,
                    background: T.card, color: T.textSub, fontFamily: "inherit",
                    fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    "--prep-focus": couleurPhase,
                  }}>
                  <Icon as={Plus} size={13} strokeWidth={2.5}/> Suggérer un matériau
                </button>
              )
            )}

            {/* ── Suggestions déjà envoyées ── */}
            {/* Volontairement SOUS le formulaire et SÉPARÉES des matériaux
                prévus : elles ne sont pas encore validées par le conducteur. */}
            {(suggestions[String(o.id)] || []).length > 0 && (
              <>
                <div style={{
                  padding: "7px 11px", background: T.card,
                  borderTop: `1px solid ${T.border}`,
                  fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                  textTransform: "uppercase", color: T.textMuted,
                }}>
                  Suggestions en attente
                </div>
                {(suggestions[String(o.id)] || []).map(sg => {
                  const q = formaterQuantite(sg.quantite_totale);
                  return (
                    <div key={sg.id} style={{ padding: "9px 11px", borderTop: `1px solid ${T.border}` }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{sg.designation}</div>
                          {sg.reference && (
                            <div style={{ ...muted, marginTop: 2 }}>Réf. {sg.reference}</div>
                          )}
                        </div>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                          padding: "2px 7px", borderRadius: 999, border: "1px solid #e0a80055",
                          background: "#e0a80014", color: "#b97a10", fontSize: 11, fontWeight: 700,
                        }}>
                          <Icon as={Clock} size={10} strokeWidth={2.4}/> En attente
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: T.text }}>
                          {q === null ? "—" : `${q} ${sg.unite || ""}`.trim()}
                        </span>
                        <span style={muted}>envoyée le {dateFr(sg.cree_le)}</span>
                      </div>
                      {sg.precision && (
                        <div style={{ ...muted, marginTop: 4, fontStyle: "italic" }}>« {sg.precision} »</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Une phase ─────────────────────────────────────────────────────────────
  const cartePhase = (p, index) => {
    const ouvert = phaseOuverte === p.id;
    const synth  = p.synthetique || p.id === PHASE_A_ORGANISER;
    const couleur = synth ? GRIS : (p.couleur || accent);
    const { total, terminees } = compterTaches(p);
    const nbO = (p.ouvrages || []).length;
    return (
      <MobileCard key={p.id} T={T} accent={couleur} style={{ padding: 0, overflow: "hidden" }}>
        <button className="prep-btn"
          onClick={() => { setPhaseOuverte(ouvert ? null : p.id); setOuvrageOuvert(null); setMatsDeplies(false); setFormOuvert(null); }}
          style={{
            width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10,
            padding: "12px 13px", border: "none", background: "transparent",
            fontFamily: "inherit", cursor: "pointer", borderRadius: RADIUS.lg,
            "--prep-focus": couleur,
          }}>
          <div style={{
            width: 30, height: 30, borderRadius: 10, flexShrink: 0,
            background: synth ? `${GRIS}22` : `linear-gradient(135deg, ${couleur}, ${couleur}c0)`,
            color: synth ? GRIS : "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800,
            border: synth ? `1px dashed ${GRIS}` : "none",
          }}>
            {synth ? <Icon as={AlertTriangle} size={14}/> : index + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{p.nom}</div>
            <div style={{ ...muted, marginTop: 2 }}>
              {synth
                ? "Éléments pas encore classés par le conducteur"
                : [
                    `${nbO} ouvrage${s(nbO)}`,
                    total > 0 ? `${total} tâche${s(total)}` : null,
                    // L'accord suit le TOTAL, pas le compte des terminées :
                    // « 0/6 terminées », « 1/1 terminée ».
                    total > 0 ? `${terminees}/${total} terminée${s(total)}` : null,
                  ].filter(Boolean).join(" · ")}
            </div>
            {synth && (
              <div style={{ ...muted, marginTop: 2 }}>
                {nbO} ouvrage{s(nbO)}
                {total > 0 ? ` · ${terminees}/${total} tâche${s(total)} terminée${s(total)}` : ""}
              </div>
            )}
          </div>
          <Icon as={ouvert ? ChevronDown : ChevronRight} size={17}
            style={{ color: T.textMuted, flexShrink: 0 }}/>
        </button>

        {ouvert && (
          <div style={{
            display: "flex", flexDirection: "column", gap: 8,
            padding: "0 11px 12px", background: synth ? `${GRIS}0A` : "transparent",
          }}>
            {(p.ouvrages || []).map(o => carteOuvrage(o, p.id, couleur))}
          </div>
        )}
      </MobileCard>
    );
  };

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {boutonRetour}
      {enTete}

      {/* Chargement initial : squelette sobre, cohérent avec le reste de
          l'espace mobile (même libellé que les autres écrans ouvriers). */}
      {chargement && !payload && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: "28px 24px", textAlign: "center", color: T.textMuted, fontSize: 13, letterSpacing: 2 }}>
            CHARGEMENT…
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              height: 64, borderRadius: RADIUS.lg, background: T.card,
              border: `1px solid ${T.border}`, opacity: 1 - i * 0.25,
            }}/>
          ))}
        </div>
      )}

      {/* Erreur : message générique, aucun détail technique à l'écran. */}
      {erreur && (
        <MobileCard T={T} accent="#c0392b">
          <MobileEmptyState T={T} icon={AlertTriangle} title="Préparation indisponible"
            hint="Les données n'ont pas pu être chargées. Vérifie ta connexion, puis réessaie."/>
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <button onClick={() => charger(!payload)} disabled={actualise} style={{
              padding: "9px 18px", borderRadius: RADIUS.md, border: "none",
              background: accent, color: "#1a1f2e", fontFamily: "inherit",
              fontSize: 13.5, fontWeight: 800, cursor: actualise ? "default" : "pointer",
              opacity: actualise ? 0.5 : 1,
            }}>Réessayer</button>
          </div>
        </MobileCard>
      )}

      {/* Modèle non affichable : legacy_v1, vide, absent, ambigu, inconnu. */}
      {!chargement && payload && ecran && (
        <MobileCard T={T} accent={ecran.ton === "alerte" ? "#f59e0b" : GRIS}>
          <MobileEmptyState T={T}
            icon={ecran.ton === "alerte" ? AlertTriangle : Info}
            title={ecran.titre} hint={ecran.texte}/>
        </MobileCard>
      )}

      {/* Préparation (modele = v2) */}
      {!chargement && payload && !ecran && visibles.length === 0 && (
        <MobileCard T={T}>
          <MobileEmptyState T={T} icon={ClipboardList} title="Rien à préparer pour l'instant"
            hint="Aucune phase de ce chantier ne contient d'ouvrage. Le conducteur n'a pas encore organisé le travail."/>
        </MobileCard>
      )}

      {!chargement && payload && !ecran && visibles.map(cartePhase)}
    </div>
  );
}
