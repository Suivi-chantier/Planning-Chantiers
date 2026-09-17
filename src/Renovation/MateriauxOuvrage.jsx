// ─────────────────────────────────────────────────────────────────────────────
// MateriauxOuvrage — éditeur des matériaux d'UN ouvrage, dans la modale du
// phasage conducteur (PhasageV2.jsx). Écran BUREAU : il affiche donc prix et
// fournisseurs, que le conducteur voit déjà ailleurs.
//
// Écrit dans phasages.ouvrages[].materiaux_liens via le chemin existant
// (updateOuvrages → scheduleSave) : pas de table, pas de RPC d'écriture,
// l'auto-save du phasage fait la sauvegarde. Les modifications sont propres
// au chantier — la bibliothèque centrale (materiaux_bibliotheque) n'est
// JAMAIS écrite d'ici, seulement lue pour résoudre nom, unité, référence,
// fournisseur et prix.
//
// Les règles (normalisation, doublons, conservation de commande_le, total)
// vivent dans le module pur materiauxLiens.mjs, couvert par
// scripts/verif-materiaux-liens.mjs. Ce fichier ne fait que l'interface.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useMemo } from "react";
import { Icon, InputNombre } from "../ui";
import { RADIUS, FONT } from "../constants";
import { Plus, X, Search, Trash2, ShoppingCart, AlertTriangle } from "lucide-react";
import {
  liensUtilisables, ajouterLien, modifierQuantiteLien, retirerLien,
  quantiteTotale,
} from "./materiauxLiens";

// Au-delà, on n'affiche pas : 565 matériaux dans une modale ne se parcourent
// pas à l'œil, ils se cherchent.
const MAX_RESULTATS = 8;

const norm = (s) => (s || "").toString().toLowerCase()
  .normalize("NFD").replace(/\p{Diacritic}/gu, "");

const nb2 = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function MateriauxOuvrage({
  ouvrage, materiaux = [], onChangeLiens, onRecalculerCout,
  T, accent = "#FFC200", onAccent = "#fff",
}) {
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [recherche, setRecherche]     = useState("");
  const [choisi, setChoisi]           = useState(null); // matériau sélectionné avant validation
  const [qteNouvelle, setQteNouvelle] = useState(1);
  const [modifie, setModifie]         = useState(false);

  // Base d'écriture : le tableau BRUT. On ne repart jamais de la liste filtrée,
  // sinon une entrée bizarre (null, sans materiau_id) disparaîtrait en silence
  // à la première modification d'un autre lien.
  const liensBruts = Array.isArray(ouvrage?.materiaux_liens) ? ouvrage.materiaux_liens : [];
  const liens      = liensUtilisables(liensBruts);

  const parId = useMemo(() => {
    const m = new Map();
    (materiaux || []).forEach(x => { if (x && x.id != null) m.set(String(x.id), x); });
    return m;
  }, [materiaux]);

  const uniteOuvrage = ouvrage?.unite || "U";

  // Applique un nouveau tableau de liens. `null` = opération refusée par les
  // règles (doublon, quantité inexploitable) : on ne touche à rien.
  const appliquer = (next) => {
    if (!next) return false;
    onChangeLiens(next);
    setModifie(true);
    return true;
  };

  // ── Recherche pour l'ajout ────────────────────────────────────────────────
  const resultats = useMemo(() => {
    const q = norm(recherche).trim();
    const dejaLies = new Set(liens.map(l => String(l.materiau_id)));
    const base = (materiaux || []).filter(m => m && m.id != null && !dejaLies.has(String(m.id)));
    if (!q) return { liste: [], total: base.length, vierge: true };
    const trouves = base.filter(m =>
      norm(m.nom).includes(q) || norm(m.reference).includes(q) ||
      norm(m.categorie).includes(q) || norm(m.fournisseur).includes(q));
    return { liste: trouves.slice(0, MAX_RESULTATS), total: trouves.length, vierge: false };
  }, [recherche, materiaux, liens]);

  const fermerAjout = () => { setAjoutOuvert(false); setRecherche(""); setChoisi(null); setQteNouvelle(1); };

  const validerAjout = () => {
    if (!choisi) return;
    const ok = appliquer(ajouterLien(liensBruts, choisi.id, qteNouvelle));
    if (!ok) { window.alert("Quantité invalide, ou matériau déjà rattaché à cet ouvrage."); return; }
    fermerAjout();
  };

  const supprimer = (ml, m) => {
    const message = ml.commande_le
      ? "Ce matériau est marqué comme commandé. Le retirer de l'ouvrage ne supprime pas la commande déjà passée. Continuer ?"
      : `Retirer « ${m ? m.nom : "ce matériau introuvable"} » des matériaux de cet ouvrage ?`;
    if (!window.confirm(message)) return;
    appliquer(retirerLien(liensBruts, ml.materiau_id));
  };

  // ── Coût total indicatif — identique au calcul d'avant l'éditeur ──────────
  const totalCout = liens.reduce((s, ml) => {
    const m = parId.get(String(ml.materiau_id));
    const qTot = quantiteTotale(ouvrage?.quantite, ml.quantite) ?? 0;
    return s + qTot * (parseFloat(m?.prix_unitaire) || 0);
  }, 0);

  // ── Styles ────────────────────────────────────────────────────────────────
  const boite  = { background: T.card, border: `1px solid ${T.border}`, borderRadius: RADIUS.md, overflow: "hidden" };
  const ligne  = { padding: "9px 10px", borderTop: `1px solid ${T.sectionDivider || T.border}` };
  const meta   = { fontSize: FONT.xs.size, color: T.textMuted, marginTop: 2 };
  const btnIco = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: RADIUS.sm, border: `1px solid ${T.border}`, background: T.surface, color: T.textMuted, cursor: "pointer", flexShrink: 0 };
  const champ  = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: RADIUS.sm, color: T.text, fontFamily: "inherit", fontSize: FONT.xs.size + 1, padding: "5px 8px" };

  return (
    <div style={boite}>
      {/* ── Liste des matériaux ── */}
      {liens.length === 0 && (
        <div style={{ padding: "12px 10px", fontSize: FONT.xs.size + 1, color: T.textMuted, fontStyle: "italic" }}>
          Aucun matériau rattaché à cet ouvrage.
        </div>
      )}

      {liens.map((ml, i) => {
        const m = parId.get(String(ml.materiau_id));
        const introuvable = !m;
        const total = quantiteTotale(ouvrage?.quantite, ml.quantite);
        const prixU = parseFloat(m?.prix_unitaire);
        return (
          <div key={String(ml.materiau_id)} style={{ ...ligne, borderTop: i === 0 ? "none" : ligne.borderTop }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: FONT.xs.size + 2, fontWeight: 700,
                  color: introuvable ? "#c0392b" : T.text,
                  fontStyle: introuvable ? "italic" : "normal",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {introuvable ? "Matériau introuvable" : m.nom}
                </div>
                <div style={meta}>
                  {introuvable
                    ? "Retiré de la bibliothèque — la ligne est conservée, seule sa suppression est possible."
                    : [
                        m.reference ? `Réf. ${m.reference}` : null,
                        m.fournisseur || null,
                        Number.isFinite(prixU) && prixU > 0 ? `${nb2(prixU)} €/${m.unite || "U"}` : null,
                      ].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {ml.commande_le && (
                <span title={`Commandé le ${String(ml.commande_le).slice(0, 10).split("-").reverse().join("/")}`}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
                    padding: "2px 7px", borderRadius: RADIUS.pill, border: "1px solid #22c55e55",
                    background: "#22c55e14", color: "#1e8e4e", fontSize: FONT.xs.size, fontWeight: 700,
                  }}>
                  <Icon as={ShoppingCart} size={11} strokeWidth={2.4}/> Commandé
                </span>
              )}
              <button onClick={() => supprimer(ml, m)} title="Retirer ce matériau de l'ouvrage"
                style={{ ...btnIco, color: "#c0392b", borderColor: "#c0392b33" }}>
                <Icon as={Trash2} size={13}/>
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7, flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.xs.size, color: T.textSub }}>
                Quantité pour 1 {uniteOuvrage}
              </span>
              {introuvable ? (
                <span style={{ ...champ, color: T.textMuted, minWidth: 64, textAlign: "center" }}>
                  {ml.quantite ?? "—"}
                </span>
              ) : (
                <InputNombre valeur={ml.quantite ?? ""} vide={null}
                  onValeur={n => appliquer(modifierQuantiteLien(liensBruts, ml.materiau_id, n))}
                  style={{ ...champ, width: 74, textAlign: "center" }}/>
              )}
              <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{m?.unite || ""}</span>
              <span style={{ marginLeft: "auto", fontSize: FONT.xs.size + 1, color: T.textSub }}>
                Total&nbsp;:&nbsp;
                <b style={{ color: T.text }}>
                  {total === null || total === 0 ? "—" : `${nb2(total)} ${m?.unite || ""}`}
                </b>
              </span>
            </div>
          </div>
        );
      })}

      {/* ── Ajout d'un matériau ── */}
      <div style={{ ...ligne, borderTop: `1px solid ${T.border}`, background: T.surface }}>
        {!ajoutOuvert ? (
          <button onClick={() => setAjoutOuvert(true)} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 11px", borderRadius: RADIUS.sm, border: `1px dashed ${accent}88`,
            background: `${accent}14`, color: T.text, fontFamily: "inherit",
            fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
          }}>
            <Icon as={Plus} size={13} strokeWidth={2.6}/> Ajouter un matériau
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon as={Search} size={13} style={{ color: T.textMuted, flexShrink: 0 }}/>
              <input autoFocus value={recherche} onChange={e => { setRecherche(e.target.value); setChoisi(null); }}
                placeholder="Chercher : nom, référence, catégorie, fournisseur…"
                style={{ ...champ, flex: 1, minWidth: 0 }}/>
              <button onClick={fermerAjout} title="Annuler" style={btnIco}><Icon as={X} size={13}/></button>
            </div>

            {choisi ? (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                padding: "7px 9px", borderRadius: RADIUS.sm,
                border: `1px solid ${accent}66`, background: `${accent}10`,
              }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text }}>{choisi.nom}</div>
                  <div style={meta}>
                    {[choisi.reference ? `Réf. ${choisi.reference}` : null, choisi.fournisseur || null]
                      .filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <span style={{ fontSize: FONT.xs.size, color: T.textSub }}>Quantité pour 1 {uniteOuvrage}</span>
                <InputNombre valeur={qteNouvelle} vide={null} onValeur={n => setQteNouvelle(n)}
                  style={{ ...champ, width: 74, textAlign: "center" }}/>
                <span style={{ fontSize: FONT.xs.size, color: T.textMuted }}>{choisi.unite || "U"}</span>
                <button onClick={validerAjout} style={{
                  padding: "6px 12px", borderRadius: RADIUS.sm, border: "none",
                  background: accent, color: onAccent, fontFamily: "inherit",
                  fontSize: FONT.xs.size + 1, fontWeight: 700, cursor: "pointer",
                }}>Ajouter</button>
              </div>
            ) : resultats.vierge ? (
              <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                {resultats.total} matériau{resultats.total > 1 ? "x" : ""} disponible{resultats.total > 1 ? "s" : ""} — tapez pour chercher.
              </div>
            ) : resultats.liste.length === 0 ? (
              <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                Aucun matériau ne correspond (les matériaux déjà rattachés sont exclus).
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {resultats.liste.map(m => (
                  <button key={String(m.id)} onClick={() => { setChoisi(m); setQteNouvelle(1); }} style={{
                    display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                    padding: "6px 9px", borderRadius: RADIUS.sm,
                    border: `1px solid ${T.border}`, background: T.card,
                    fontFamily: "inherit", cursor: "pointer", width: "100%",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: FONT.xs.size + 1, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.nom}</div>
                      <div style={meta}>
                        {[m.reference ? `Réf. ${m.reference}` : null, m.fournisseur || null, m.unite ? `en ${m.unite}` : null]
                          .filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <Icon as={Plus} size={14} style={{ color: T.textMuted, flexShrink: 0 }}/>
                  </button>
                ))}
                {resultats.total > resultats.liste.length && (
                  <div style={{ fontSize: FONT.xs.size, color: T.textMuted, fontStyle: "italic" }}>
                    {resultats.total - resultats.liste.length} autre{resultats.total - resultats.liste.length > 1 ? "s" : ""} résultat{resultats.total - resultats.liste.length > 1 ? "s" : ""} — précisez la recherche.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Pied : coût indicatif + rappel ── */}
      {liens.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, flexWrap: "wrap",
          padding: "8px 10px", borderTop: `1px solid ${T.border}`, background: T.surface,
        }}>
          <div style={{ fontSize: FONT.xs.size + 1, color: T.textMuted, fontWeight: 600 }}>Total calculé</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: FONT.sm.size, fontWeight: 800, color: T.text }}>{nb2(totalCout)} €</div>
            <button
              onClick={() => { onRecalculerCout(parseFloat(totalCout.toFixed(2))); setModifie(false); }}
              disabled={!(totalCout > 0)}
              title="Recopier ce total dans le champ Coût matériaux"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 10px", borderRadius: RADIUS.sm, border: "none",
                background: totalCout > 0 ? accent : T.border, color: onAccent,
                fontFamily: "inherit", fontSize: FONT.xs.size + 1, fontWeight: 700,
                cursor: totalCout > 0 ? "pointer" : "default", opacity: totalCout > 0 ? 1 : .5,
              }}>
              Recalculer
            </button>
          </div>
        </div>
      )}

      {/* Rappel discret : l'éditeur ne touche JAMAIS au coût de lui-même. */}
      {modifie && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "7px 10px", borderTop: `1px solid ${T.border}`,
          background: "#f59e0b12", color: "#b97a10",
          fontSize: FONT.xs.size, fontWeight: 600,
        }}>
          <Icon as={AlertTriangle} size={12} strokeWidth={2.4}/>
          Matériaux modifiés — recalculer le coût si nécessaire.
        </div>
      )}
    </div>
  );
}
