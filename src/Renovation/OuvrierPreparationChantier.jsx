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
} from "lucide-react";
import { MobileCard, MobileEmptyState, Pill, SummaryBar } from "../mobileUI";
import {
  phasesVisibles, phaseParDefaut, compterTaches, etatOuvrage, etatTache,
  avancementAffichable, formaterQuantite, ecranModele, PHASE_A_ORGANISER,
} from "./preparationChantier";

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

export default function OuvrierPreparationChantier({ chantier, T, accent = "#FFC200", onRetour }) {
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

  injecterStyles();

  // Changer d'ouvrage remet sa liste de matériaux à l'état réduit.
  const ouvrirOuvrage = (cle) => {
    setOuvrageOuvert(prev => (prev === cle ? null : cle));
    setMatsDeplies(false);
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

  // Appel à chaque ouverture de l'écran (le composant est monté/démonté par
  // le parent), et à chaque changement de chantier.
  useEffect(() => { charger(true); }, [charger]);

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
          onClick={() => { setPhaseOuverte(ouvert ? null : p.id); setOuvrageOuvert(null); setMatsDeplies(false); }}
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
